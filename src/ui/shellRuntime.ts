/**
 * The operator shell's ONE client runtime: delegated controls + region-patching
 * poller. Emitted once per full page load by `renderPage` (never inside
 * `<main>`), so it is never replaced by a patch and never re-executed.
 *
 * Source of truth: the functions below are plain JS-compatible functions.
 * The pure ones (`hashString`, `planRegionPatch`, `revisionUnchanged`,
 * `actionKey`) are imported directly by the unit tests AND stringified into
 * the browser script, so the tested code is the shipped code.
 *
 * ── Interaction contract (attribute names, frozen for all lanes) ───────────
 * Controls (document-level delegation on `[data-action]`):
 *   data-action="recover|decline|escalate|reset-demo|trigger-disruption"
 *   data-case-ref="<caseId>"           on the control or any ancestor
 *   data-strategy-ref="<strategyId>"   recover: approve this persisted
 *                                      strategy; absent = ask for options
 *   data-endpoint="<url>"              optional override of the POST target
 *   data-confirm="<text>"              optional confirm() before the request
 *   [data-action-status]               sibling status node (nearest ancestor
 *                                      scope that contains one) receiving
 *                                      progress / outcome / error text
 *   Legacy overview trigger `[data-test=simulated-airline-update-apply]` is
 *   mapped onto `trigger-disruption` until the overview emits data-action.
 * Polling:
 *   <main data-projection-revision | data-stable-revision>   revision guard
 *   <main data-poll-url>               optional poll URL override
 *   <main data-change-cursor>          only echoed back as `sinceCursor`
 *   data-poll-region="<name>"          patched only when its hash changed
 *   data-region-key="<key>"            stable identity for open <details>
 *   data-poll-ignore                   excluded from region hashing
 *   data-graph-scene-hash="<hash>"     on a region with a `.fg-canvas`: the
 *                                      ONLY signal that may replace the graph
 *   data-scroll-key="<key>"            inner scroll position preserved
 * After a patch the runtime dispatches `northstar:patched` on `document`
 * (detail.regions = names patched) and calls `window.__northstarInitGraphs`
 * and `window.__northstarApplyOriginalCurrent` when a graph region changed.
 */

// Browser globals used only inside the stringified runtime (no DOM lib here).
declare const window: any;
declare const document: any;
declare const DOMParser: any;
declare const CustomEvent: any;

/** FNV-1a 32-bit, hex. Deterministic, dependency-free, browser + Node. */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export interface RegionMeta {
  hash: string;
  /** Present only on graph regions that carry a scene marker. */
  scene?: string | null;
  /** True when the region contains a graph canvas. */
  graph?: boolean;
}

export interface PatchPlan {
  patch: string[];
  add: string[];
  remove: string[];
  /** Graph regions left untouched because their scene marker was unchanged. */
  heldGraph: string[];
}

/**
 * Decide which regions to patch. A region with a scene marker on both sides is
 * judged by the marker ALONE (its DOM is never replaced otherwise); every other
 * region is judged by its content hash.
 */
export function planRegionPatch(
  current: Record<string, RegionMeta>,
  next: Record<string, RegionMeta>,
): PatchPlan {
  const plan: PatchPlan = { patch: [], add: [], remove: [], heldGraph: [] };
  for (const name of Object.keys(next)) {
    const cur = current[name];
    const nxt = next[name]!;
    if (!cur) {
      plan.add.push(name);
      continue;
    }
    const hasScene = cur.scene != null && nxt.scene != null;
    if (cur.graph && hasScene) {
      if (cur.scene !== nxt.scene) plan.patch.push(name);
      else plan.heldGraph.push(name);
      continue;
    }
    if (cur.hash !== nxt.hash) plan.patch.push(name);
  }
  for (const name of Object.keys(current)) {
    if (!(name in next)) plan.remove.push(name);
  }
  return plan;
}

/** True only when both revisions are known and equal. */
export function revisionUnchanged(current: string | null, next: string | null): boolean {
  return current !== null && next !== null && current === next;
}

/** In-flight identity for a control: survives the node being replaced. */
export function actionKey(action: string, caseRef: string | null, strategyRef: string | null): string {
  return [action, caseRef || '', strategyRef || ''].join('|');
}

/**
 * The browser runtime. `config` = { intervalMs }. Uses only ES5-era syntax and
 * DOM APIs so the stringified body runs anywhere a page can.
 */
function northstarShellRuntime(config: { intervalMs: number }): void {
  'use strict';
  if ((window as any).__northstarShellStarted) return;
  (window as any).__northstarShellStarted = true;

  var pollCfg = (window as any).__northstarPollConfig || {};
  var interval = pollCfg.intervalMs || config.intervalMs;
  var TERMINAL = ['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'];

  // ───────────────────────── in-flight control state ─────────────────────────
  // key -> { state: 'pending' | 'done' | 'error', message: string, sticky: boolean }
  var actionState: any = {};

  function attr(el: any, name: string): string | null {
    return el && el.getAttribute ? el.getAttribute(name) : null;
  }
  function inheritedAttr(el: any, name: string): string | null {
    var holder = el && el.closest ? el.closest('[' + name + ']') : null;
    return holder ? holder.getAttribute(name) : null;
  }
  function keyOf(el: any): string {
    var action = attr(el, 'data-action') || 'trigger-disruption';
    return actionKey(action, inheritedAttr(el, 'data-case-ref'), attr(el, 'data-strategy-ref'));
  }
  function statusNodeFor(el: any): any {
    var scope = el.parentElement;
    while (scope) {
      var found = scope.querySelector('[data-action-status]');
      if (found) return found;
      if (scope.tagName === 'MAIN' || scope.tagName === 'BODY') break;
      scope = scope.parentElement;
    }
    var legacy = el.closest('[data-test="simulated-airline-update"]');
    return legacy ? legacy.querySelector('[data-test="simulated-airline-update-status"]') : null;
  }
  function allControls(): any[] {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-action],[data-test="simulated-airline-update-apply"]'),
    );
  }
  /** Re-apply in-flight state onto (possibly freshly patched) controls. */
  function reapplyActionState(): void {
    var controls = allControls();
    for (var i = 0; i < controls.length; i += 1) {
      var el = controls[i];
      var st = actionState[keyOf(el)];
      if (!st) continue;
      var busy = st.state === 'pending' || (st.state === 'done' && st.sticky);
      if (busy && !el.disabled) el.disabled = true;
      if (busy && attr(el, 'aria-busy') !== 'true' && st.state === 'pending') el.setAttribute('aria-busy', 'true');
      var status = statusNodeFor(el);
      if (status && st.message && status.textContent !== st.message) status.textContent = st.message;
    }
  }
  function setState(el: any, key: string, state: string, message: string, sticky: boolean): void {
    actionState[key] = { state: state, message: message, sticky: sticky };
    if (el && el.isConnected === false) el = null;
    reapplyActionState();
    if (state !== 'pending') {
      var controls = allControls();
      for (var i = 0; i < controls.length; i += 1) {
        var c = controls[i];
        if (keyOf(c) !== key) continue;
        var stay = state === 'done' && sticky;
        if (!stay) {
          c.disabled = false;
          c.removeAttribute('aria-busy');
        }
      }
    }
  }

  function readBody(response: any): Promise<any> {
    return response.text().then(function (text: string) {
      var parsed: any = null;
      try { parsed = JSON.parse(text); } catch (e) { /* non-JSON error body */ }
      return { ok: response.ok, status: response.status, body: parsed, raw: text };
    });
  }
  function failureText(r: any, fallback: string): string {
    if (r.status === 404 || r.status === 405 || r.status === 501) {
      return 'This is not available in this environment yet.';
    }
    var b = r.body;
    var message = b && b.error && b.error.message ? b.error.message : b && b.message ? b.message : '';
    return message ? fallback + ' ' + message : fallback + ' (HTTP ' + r.status + ')';
  }

  var PLAN_OUTCOMES: any = {
    AWAITING_AUTHORITY: 'Options are ready for your decision.',
    NEEDS_EVIDENCE_OR_DECISION: 'More evidence or a human decision is needed.',
    NO_RECOVERY_FOUND: 'No recovery option was found.',
    STALE_RETRY_REQUIRED: 'The case changed while planning; it will be tried again.',
  };

  /** Describe one control click as a request. */
  function describe(el: any): any {
    var action = attr(el, 'data-action');
    if (!action && attr(el, 'data-test') === 'simulated-airline-update-apply') action = 'trigger-disruption';
    var caseRef = inheritedAttr(el, 'data-case-ref');
    var strategy = attr(el, 'data-strategy-ref');
    var endpoint = attr(el, 'data-endpoint');
    var confirmText = attr(el, 'data-confirm');
    var caseBase = caseRef ? '/api/v2/cases/' + encodeURIComponent(caseRef) : '';
    if (action === 'recover') {
      if (!caseRef) return null;
      return strategy
        ? {
            url: endpoint || caseBase + '/strategies/' + encodeURIComponent(strategy) + '/approve',
            progress: 'Approving and starting the recovery…',
            fail: 'The recovery could not be started.',
            sticky: true,
            ok: function () { return 'Approved. The recovery is being carried out and re-checked.'; },
          }
        : {
            url: endpoint || caseBase + '/strategies',
            progress: 'Looking for recovery options…',
            fail: 'Recovery options could not be prepared.',
            sticky: false,
            ok: function (b: any) {
              var outcome = b && b.result && b.result.outcome;
              return PLAN_OUTCOMES[outcome] || 'Planning finished.';
            },
          };
    }
    if (action === 'decline' || action === 'escalate') {
      if (!caseRef && !endpoint) return null;
      return {
        url: endpoint || caseBase + '/' + action,
        progress: action === 'decline' ? 'Recording your decision…' : 'Passing this to a person…',
        fail: action === 'decline' ? 'The decision could not be recorded.' : 'The case could not be escalated.',
        sticky: true,
        ok: function () { return action === 'decline' ? 'Declined.' : 'Escalated to a person.'; },
      };
    }
    if (action === 'reset-demo') {
      return {
        url: endpoint || '/api/v2/demo/reset',
        confirm: confirmText || 'Reset the demo to its starting state? This clears every case and decision.',
        progress: 'Resetting the demo. This takes about a minute; please keep this page open.',
        blocking: true,
        fail: 'The demo could not be reset.',
        sticky: true,
        redirect: '/operator',
        ok: function () { return 'Demo reset. Returning to the overview…'; },
      };
    }
    if (action === 'trigger-disruption') {
      var box = el.closest('[data-test="simulated-airline-update"]');
      if (box && box.getAttribute('data-configured') === 'false') return null;
      return {
        url: endpoint || '/api/v2/demo/provider-event/airline-rebooking',
        // Zero body bytes: the handler loads the disclosed event file. A JSON
        // '{}' body is treated as direct delivery and fails validation.
        emptyBody: true,
        progress: 'Applying…',
        fail: 'The simulated update was not applied.',
        sticky: false,
        ok: function (b: any) {
          return b && b.status === 'ALREADY_APPLIED'
            ? 'Already applied. No duplicate incident created.'
            : 'Applied. This page will refresh automatically.';
        },
      };
    }
    return null;
  }

  /** Page-level busy state for long-running actions (demo reset takes ~1 min). */
  function showBusyOverlay(message: string): void {
    var overlay = document.querySelector('[data-busy-overlay]');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-busy-overlay', '');
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-live', 'assertive');
      overlay.setAttribute('aria-busy', 'true');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.72);color:#fff;font:600 18px/1.4 system-ui,sans-serif;text-align:center;padding:24px';
      var box = document.createElement('div');
      box.setAttribute('data-busy-overlay-text', '');
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
    var text = overlay.querySelector('[data-busy-overlay-text]');
    if (text) text.textContent = message;
  }
  function hideBusyOverlay(): void {
    var overlay = document.querySelector('[data-busy-overlay]');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  document.addEventListener('click', function (event: any) {
    var target = event.target;
    var el = target && target.closest
      ? target.closest('[data-action],[data-test="simulated-airline-update-apply"]')
      : null;
    if (!el) return;
    var spec = describe(el);
    if (!spec) return;
    event.preventDefault();
    var key = keyOf(el);
    var existing = actionState[key];
    if (existing && (existing.state === 'pending' || (existing.state === 'done' && existing.sticky))) return;
    if (spec.confirm && !window.confirm(spec.confirm)) return;
    setState(el, key, 'pending', spec.progress, false);
    if (spec.blocking) showBusyOverlay(spec.progress);
    var init: any = { method: 'POST', headers: { 'Accept': 'application/json' } };
    if (!spec.emptyBody) {
      init.headers['Content-Type'] = 'application/json';
      init.body = '{}';
    }
    fetch(spec.url, init)
      .then(readBody)
      .then(function (r: any) {
        if (!r.ok) {
          if (spec.blocking) hideBusyOverlay();
          setState(el, key, 'error', failureText(r, spec.fail), false);
          return;
        }
        setState(el, key, 'done', spec.ok(r.body), spec.sticky);
        if (spec.redirect) {
          window.location.assign(spec.redirect);
          return;
        }
        return refresh(true);
      })
      .catch(function () {
        if (spec.blocking) hideBusyOverlay();
        setState(el, key, 'error', spec.fail + ' Check the connection and try again.', false);
      });
  });

  // ───────────────────────────── region patching ─────────────────────────────
  function regionHash(node: any): string {
    var probe = node.cloneNode(true);
    var ignored = probe.querySelectorAll('[data-poll-ignore]');
    for (var i = 0; i < ignored.length; i += 1) ignored[i].remove();
    return hashString(probe.innerHTML);
  }
  function regionMeta(node: any): any {
    var canvas = node.querySelector('.fg-canvas');
    var marker = node.getAttribute('data-graph-scene-hash');
    if (marker === null && canvas) marker = canvas.getAttribute('data-graph-scene-hash');
    if (marker === null) {
      var inner = node.querySelector('[data-graph-scene-hash]');
      if (inner) marker = inner.getAttribute('data-graph-scene-hash');
    }
    return { hash: regionHash(node), scene: marker, graph: !!canvas || marker !== null };
  }
  function collect(root: any): any {
    var out: any = {};
    var nodes = root.querySelectorAll('[data-poll-region]');
    for (var i = 0; i < nodes.length; i += 1) out[nodes[i].getAttribute('data-poll-region')] = nodes[i];
    return out;
  }
  // Content hash last APPLIED per live region node (client-side edits such as
  // opened <details> or status text must not look like server changes).
  var appliedMeta: any = {};
  var mainHash: string | null = null;
  function primeApplied(): void {
    var live = collect(document);
    for (var name in live) if (!(name in appliedMeta)) appliedMeta[name] = regionMeta(live[name]);
  }

  function detailsKey(d: any): string | null {
    return attr(d, 'data-region-key') || attr(d, 'data-test') || attr(d, 'data-details-ref');
  }
  function focusKey(el: any): string | null {
    if (!el || el === document.body) return null;
    return el.id
      || attr(el, 'data-region-key')
      || (attr(el, 'data-action') ? 'action:' + keyOf(el) : null)
      || attr(el, 'data-test');
  }
  function findByFocusKey(root: any, key: string): any {
    var all = root.querySelectorAll('[id],[data-region-key],[data-action],[data-test]');
    for (var i = 0; i < all.length; i += 1) if (focusKey(all[i]) === key) return all[i];
    return null;
  }
  function captureUi(regionNode: any): any {
    var open: string[] = [];
    var ds = regionNode.querySelectorAll('details[open]');
    for (var i = 0; i < ds.length; i += 1) { var k = detailsKey(ds[i]); if (k) open.push(k); }
    var scrolls: any = {};
    var sc = regionNode.querySelectorAll('[data-scroll-key]');
    for (var j = 0; j < sc.length; j += 1) scrolls[sc[j].getAttribute('data-scroll-key')] = sc[j].scrollTop;
    var active = document.activeElement;
    var focus = active && regionNode.contains(active) ? focusKey(active) : null;
    var values: any = {};
    var fields = regionNode.querySelectorAll('input[id],textarea[id]');
    for (var m = 0; m < fields.length; m += 1) {
      if (fields[m].value !== fields[m].defaultValue) values[fields[m].id] = fields[m].value;
    }
    return { open: open, scrolls: scrolls, focus: focus, values: values };
  }
  function restoreUi(regionNode: any, ui: any): void {
    var ds = regionNode.querySelectorAll('details');
    for (var i = 0; i < ds.length; i += 1) {
      var k = detailsKey(ds[i]);
      if (k && ui.open.indexOf(k) !== -1 && !ds[i].hasAttribute('open')) ds[i].setAttribute('open', '');
    }
    var sc = regionNode.querySelectorAll('[data-scroll-key]');
    for (var j = 0; j < sc.length; j += 1) {
      var sk = sc[j].getAttribute('data-scroll-key');
      if (sk in ui.scrolls) sc[j].scrollTop = ui.scrolls[sk];
    }
    for (var id in ui.values) { var f = document.getElementById(id); if (f && regionNode.contains(f)) f.value = ui.values[id]; }
    if (ui.focus) {
      var target = findByFocusKey(regionNode, ui.focus);
      if (target && target.focus) target.focus({ preventScroll: true });
    }
  }

  function adoptNode(newNode: any): any {
    return document.importNode(newNode, true);
  }
  function replaceRegion(liveNode: any, freshNode: any): void {
    var ui = captureUi(liveNode);
    var adopted = adoptNode(freshNode);
    liveNode.replaceWith(adopted);
    restoreUi(adopted, ui);
  }
  function insertRegion(name: string, freshRoot: any, freshNode: any, live: any): void {
    var adopted = adoptNode(freshNode);
    var order = freshRoot.querySelectorAll('[data-poll-region]');
    var idx = -1;
    for (var i = 0; i < order.length; i += 1) if (order[i] === freshNode) idx = i;
    for (var p = idx - 1; p >= 0; p -= 1) {
      var prev = live[order[p].getAttribute('data-poll-region')];
      if (prev && prev.isConnected) { prev.insertAdjacentElement('afterend', adopted); return; }
    }
    for (var n = idx + 1; n < order.length; n += 1) {
      var next = live[order[n].getAttribute('data-poll-region')];
      if (next && next.isConnected) { next.insertAdjacentElement('beforebegin', adopted); return; }
    }
    var mainEl = document.querySelector('main');
    if (mainEl) mainEl.appendChild(adopted);
  }
  function syncMainAttributes(liveMain: any, freshMain: any): void {
    var names = ['data-projection-revision', 'data-stable-revision', 'data-change-cursor', 'data-case-status',
      'data-assessment-lifecycle', 'data-assessment-pending-count'];
    for (var i = 0; i < names.length; i += 1) {
      var v = freshMain.getAttribute(names[i]);
      if (v !== null && liveMain.getAttribute(names[i]) !== v) liveMain.setAttribute(names[i], v);
    }
  }
  function afterPatch(names: string[], graphChanged: boolean): void {
    if (graphChanged) {
      if ((window as any).__northstarInitGraphs) (window as any).__northstarInitGraphs();
      if ((window as any).__northstarApplyOriginalCurrent) (window as any).__northstarApplyOriginalCurrent();
    }
    reapplyActionState();
    document.dispatchEvent(new CustomEvent('northstar:patched', { detail: { regions: names } }));
  }

  // During RECONCILING, still show CURRENT world-state (changed services,
  // directly affected travellers / checking membership). Hold derived
  // readiness counts and attention verdicts at the last SETTLED paint.
  var RECONCILE_WORLD_REGIONS: any = {
    'overview-graph': true,
    'overview-roster': true,
  };

  function applyFresh(doc: any, allowRegions?: any): void {
    var liveMain = document.querySelector('main');
    var freshMain = doc.querySelector('main');
    if (!liveMain || !freshMain) return;
    var scrollY = window.scrollY;
    var liveRegions = collect(document);
    var freshRegions = collect(doc);
    var patched: string[] = [];
    var graphChanged = false;
    function allowed(name: string): boolean {
      return !allowRegions || !!allowRegions[name];
    }

    if (Object.keys(liveRegions).length === 0) {
      // Backwards-compatible path: no regions declared. Patch main's CHILDREN
      // only (never the <main> element itself), and only if content changed.
      // Selective reconcile has no meaning without named regions — hold paint.
      if (allowRegions) {
        syncMainAttributes(liveMain, freshMain);
        return;
      }
      var fallbackHash = hashString(freshMain.innerHTML);
      if (mainHash !== null && mainHash === fallbackHash) return;
      var ui = captureUi(liveMain);
      liveMain.innerHTML = freshMain.innerHTML;
      restoreUi(liveMain, ui);
      mainHash = fallbackHash;
      primeApplied();
      syncMainAttributes(liveMain, freshMain);
      graphChanged = true;
      patched.push('main');
    } else {
      var freshMeta: any = {};
      for (var name in freshRegions) freshMeta[name] = regionMeta(freshRegions[name]);
      var plan: any = planRegionPatch(appliedMeta, freshMeta);
      var i: number;
      for (i = 0; i < plan.patch.length; i += 1) {
        var pn: string = plan.patch[i];
        if (!liveRegions[pn] || !allowed(pn)) continue;
        replaceRegion(liveRegions[pn], freshRegions[pn]);
        appliedMeta[pn] = freshMeta[pn];
        if (freshMeta[pn].graph) graphChanged = true;
        patched.push(pn);
      }
      for (i = 0; i < plan.add.length; i += 1) {
        var an: string = plan.add[i];
        if (!allowed(an)) continue;
        var existing = collect(document)[an];
        if (existing) replaceRegion(existing, freshRegions[an]);
        else insertRegion(an, doc, freshRegions[an], collect(document));
        appliedMeta[an] = freshMeta[an];
        if (freshMeta[an].graph) graphChanged = true;
        patched.push(an);
      }
      for (i = 0; i < plan.remove.length; i += 1) {
        var rn: string = plan.remove[i];
        if (!allowed(rn)) continue;
        if (liveRegions[rn]) liveRegions[rn].remove();
        delete appliedMeta[rn];
        patched.push(rn);
      }
      // Held graph regions keep their DOM; still record the applied hash so a
      // later scene change is compared against the freshest marker — but only
      // for regions we are allowed to advance during this paint.
      for (i = 0; i < plan.heldGraph.length; i += 1) {
        var hn: string = plan.heldGraph[i];
        if (allowed(hn)) appliedMeta[hn] = freshMeta[hn];
      }
      syncMainAttributes(liveMain, freshMain);
    }
    if (patched.length > 0 && Math.abs(window.scrollY - scrollY) > 1) window.scrollTo(window.scrollX, scrollY);
    if (patched.length > 0) afterPatch(patched, graphChanged);
  }

  // ─────────────────────────────────── poller ────────────────────────────────
  var inFlight = false;
  var lastCursor: string | null = null;
  function liveMain(): any { return document.querySelector('main'); }
  function pollUrl(): string | null {
    var m = liveMain();
    if (!m) return null;
    var explicit = attr(m, 'data-poll-url');
    var base: string | null = explicit || (attr(m, 'data-test') === 'product-recovery-case' ? pollCfg.pollUrl || null : null);
    if (!base && attr(m, 'data-test') === 'product-operator-overview') base = '/api/v2/operator/overview?format=html';
    if (!base && attr(m, 'data-test') === 'product-recovery-case') {
      var ref = attr(m, 'data-case-ref') || pollCfg.caseRef;
      if (ref) base = '/api/v2/cases/' + encodeURIComponent(ref) + '?format=html';
    }
    if (!base) return null;
    var cursor = lastCursor || attr(m, 'data-change-cursor');
    if (cursor) base += (base.indexOf('?') === -1 ? '?' : '&') + (pollCfg.cursorParam || 'sinceCursor') + '=' + encodeURIComponent(cursor);
    return base;
  }
  function setReconciling(active: boolean): void {
    var el = document.querySelector('[data-test="overview-reconciling"]');
    if (!el) return;
    if (active && el.hasAttribute('hidden')) el.removeAttribute('hidden');
    if (!active && !el.hasAttribute('hidden')) el.setAttribute('hidden', '');
  }

  function refresh(force?: boolean): Promise<void> {
    if (!force && document.hidden) return Promise.resolve();
    var m = liveMain();
    if (!m) return Promise.resolve();
    var status = attr(m, 'data-case-status');
    if (!force && status && TERMINAL.indexOf(status) !== -1) return Promise.resolve();
    var url = pollUrl();
    if (!url || inFlight) return Promise.resolve();
    inFlight = true;
    return fetch(url, { headers: { 'Accept': 'text/html' } })
      .then(function (r: any) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html: string) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var freshMain = doc.querySelector('main');
        if (!freshMain) throw new Error('No main in response');
        var cur = liveMain();
        if (!cur) return;
        var fresh = attr(freshMain, 'data-projection-revision') || attr(freshMain, 'data-stable-revision');
        var live = attr(cur, 'data-projection-revision') || attr(cur, 'data-stable-revision');
        var cursor = attr(freshMain, 'data-change-cursor');
        if (cursor) lastCursor = cursor; // echo only; never a redraw signal
        if (attr(freshMain, 'data-assessment-lifecycle') === 'RECONCILING') {
          setReconciling(true);
          if (cur.classList.contains('is-stale')) cur.classList.remove('is-stale');
          // Presentation-only: paint CURRENT service/traveller facts while
          // holding derived readiness/attention at last SETTLED.
          applyFresh(doc, RECONCILE_WORLD_REGIONS);
          return;
        }
        setReconciling(false);
        if (cur.classList.contains('is-stale')) cur.classList.remove('is-stale');
        if (revisionUnchanged(live, fresh)) return;
        applyFresh(doc);
      })
      .catch(function (err: any) {
        var cur = liveMain();
        if (cur && !cur.classList.contains('is-stale')) cur.classList.add('is-stale');
        if (typeof console !== 'undefined' && console.warn) console.warn('[northstar] poll failed:', err && err.message ? err.message : err);
      })
      .then(function () {
        inFlight = false;
        // Non-sticky controls come back after the refresh that reflects them.
        for (var key in actionState) {
          var st = actionState[key];
          if (st.state === 'done' && !st.sticky) { actionState[key] = { state: 'idle', message: st.message, sticky: false }; }
        }
        reapplyControlsIdle();
      });
  }
  function reapplyControlsIdle(): void {
    var controls = allControls();
    for (var i = 0; i < controls.length; i += 1) {
      var st = actionState[keyOf(controls[i])];
      if (st && st.state === 'idle') { controls[i].disabled = false; controls[i].removeAttribute('aria-busy'); }
    }
  }

  (window as any).__northstarRefresh = function () { return refresh(true); };
  (window as any).__northstarRefreshCase = (window as any).__northstarRefresh;
  (window as any).__northstarRefreshOverview = (window as any).__northstarRefresh;

  primeApplied();
  var startMain = liveMain();
  if (startMain && Object.keys(collect(document)).length === 0) mainHash = hashString(startMain.innerHTML);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
  if (pollUrl() !== null) setInterval(function () { refresh(false); }, interval);
}

/** The inline script emitted once by the shell. */
export function renderShellRuntimeScript(options: { intervalMs: number }): string {
  const helpers = [hashString, planRegionPatch, revisionUnchanged, actionKey]
    .map((fn) => fn.toString())
    .join('\n');
  return `<script data-shell-runtime>
(function() {
${helpers}
var __run = ${northstarShellRuntime.toString()};
__run(${JSON.stringify({ intervalMs: options.intervalMs })});
})();
</script>`;
}
