/**
 * A5.1 — Demo Console top-bar popover.
 *
 * Replaces the `Demo Console` link's navigation to `/demo/control` with an
 * anchored popover that reuses the SAME `/api/v2/demo/*` endpoints. Reset
 * Demo is delegated to the shell runtime's existing `data-action="reset-demo"`
 * handling (confirm + blocking overlay + redirect) — this module only
 * supplies the popover chrome and the client-side trigger-delay countdown.
 *
 * Countdown state lives at this (persistent, once-per-page-load) script
 * level, not inside the popover DOM, so it survives the popover closing.
 * The wait is real wall-clock `setTimeout`/`setInterval` only: no backend
 * call happens until the countdown reaches zero, and nothing here touches
 * the evaluation clock, scenario timestamps or provider payloads.
 *
 * The pure reducer functions below are unit-tested directly (`node:test`)
 * and also embedded verbatim (via `.toString()`) into the shipped browser
 * script, so the tested code is the shipped code — the same discipline
 * `shellRuntime.ts` uses for its pure helpers.
 */

export type CountdownPhase = 'counting' | 'triggering' | 'done';

export interface PendingTrigger {
  controlId: string;
  label: string;
  phase: CountdownPhase;
  secondsLeft: number;
  ok?: boolean;
  message?: string;
}

export type PendingState = PendingTrigger | null;

export const TRIGGER_DELAY_OPTIONS = [0, 3, 5] as const;
export const DEFAULT_TRIGGER_DELAY_SECONDS = 5;

/** `select`/radio value ("off"|"3"|"5"|anything unrecognised) -> delay seconds. */
export function parseTriggerDelay(value: string | null | undefined): number {
  if (value == null) return DEFAULT_TRIGGER_DELAY_SECONDS;
  if (value === 'off' || value === '0') return 0;
  const n = Number(value);
  return TRIGGER_DELAY_OPTIONS.includes(n as 0 | 3 | 5) ? n : DEFAULT_TRIGGER_DELAY_SECONDS;
}

/** A label fit for the countdown line ("Trigger configured airline disruption" -> "configured airline disruption"). */
export function countdownDisplayLabel(label: string): string {
  return label.replace(/^trigger\s+/i, '').trim() || label;
}

/** Only one control may be queued/counting/triggering at a time. */
export function canQueueNewTrigger(state: PendingState): boolean {
  return state === null;
}

/** Start a countdown (or, for a zero delay, go straight to 'triggering'). */
export function beginCountdown(controlId: string, label: string, delaySeconds: number): PendingTrigger {
  return delaySeconds > 0
    ? { controlId, label, phase: 'counting', secondsLeft: delaySeconds }
    : { controlId, label, phase: 'triggering', secondsLeft: 0 };
}

/** Advance one second. No-op outside 'counting'. Reaching zero flips to 'triggering'. */
export function tickCountdown(state: PendingState): PendingState {
  if (!state || state.phase !== 'counting') return state;
  const next = state.secondsLeft - 1;
  return next <= 0
    ? { ...state, phase: 'triggering', secondsLeft: 0 }
    : { ...state, secondsLeft: next };
}

/** Cancel only while still counting down (a Trigger already in flight cannot be cancelled). */
export function cancelCountdown(state: PendingState): PendingState {
  if (!state || state.phase !== 'counting') return state;
  return null;
}

/** Record the apply request's outcome. No-op outside 'triggering'. */
export function completeTrigger(state: PendingState, ok: boolean, message: string): PendingState {
  if (!state || state.phase !== 'triggering') return state;
  return { ...state, phase: 'done', ok, message };
}

/**
 * The popover + countdown browser script. Emitted once per full operator
 * page load (outside `<main>`, alongside the shell runtime), so it is never
 * duplicated by a region patch and countdown state outlives the popover
 * closing.
 */
export function renderDemoConsolePopoverScript(): string {
  // The stringified functions below close over these two constants; they
  // must be declared in the shipped script too, not just imported here.
  const constants = `var TRIGGER_DELAY_OPTIONS = ${JSON.stringify(TRIGGER_DELAY_OPTIONS)};\n`
    + `var DEFAULT_TRIGGER_DELAY_SECONDS = ${JSON.stringify(DEFAULT_TRIGGER_DELAY_SECONDS)};`;
  const helpers = [
    parseTriggerDelay,
    countdownDisplayLabel,
    canQueueNewTrigger,
    beginCountdown,
    tickCountdown,
    cancelCountdown,
    completeTrigger,
  ].map((fn) => fn.toString()).join('\n');

  return `<script data-demo-console-runtime>
(function () {
  'use strict';
  if (window.__northstarDemoConsoleStarted) return;
  window.__northstarDemoConsoleStarted = true;

${constants}
${helpers}

  // The shell runtime may region-patch the shell-topbar poll region (e.g.
  // when the decision count changes) and replace this widget's DOM
  // wholesale. A one-time querySelector cached in a variable would then
  // point at a detached node with no listeners. So: never cache toggle/pop/
  // overlay elements -- resolve them fresh on every use, and drive every
  // interaction through document-level delegation (document itself is
  // never replaced). Loaded-state lives on the popover node itself
  // (its data-dc-loaded attribute), not in a module variable, so a freshly
  // swapped-in (unloaded) popover self-heals by refetching on next open.
  function getToggle() { return document.querySelector('[data-demo-console-toggle]'); }
  function getPop() { return document.querySelector('[data-demo-console-pop]'); }
  function getOverlay() { return document.querySelector('[data-demo-console-overlay]'); }
  function getControlsBox() { var pop = getPop(); return pop ? pop.querySelector('[data-demo-console-controls]') : null; }

  var pending = null; // PendingState
  var tickTimer = null;
  var clearTimer = null;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function currentDelay() {
    var pop = getPop();
    var checked = pop ? pop.querySelector('input[name="dc-delay"]:checked') : null;
    return parseTriggerDelay(checked ? checked.value : null);
  }

  // ── popover open/close ────────────────────────────────────────────────
  function openPopover() {
    var pop = getPop();
    var toggle = getToggle();
    if (!pop || !toggle) return;
    pop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (pop.getAttribute('data-dc-loaded') !== '1') loadControls();
    renderPendingIntoPopover();
  }
  function closePopover() {
    var pop = getPop();
    var toggle = getToggle();
    if (pop) pop.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  function togglePopover() {
    var pop = getPop();
    if (!pop) return;
    if (pop.hidden) openPopover(); else closePopover();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var toggle = getToggle();
    var pop = getPop();
    var overlay = getOverlay();
    if (toggle && toggle.contains(target)) {
      event.preventDefault();
      togglePopover();
      return;
    }
    if (pop && !pop.hidden) {
      if (pop.contains(target)) {
        var trigger = target.closest ? target.closest('[data-demo-console="trigger"]') : null;
        if (trigger) {
          beginTrigger(trigger.getAttribute('data-control-id'), trigger.getAttribute('data-control-label') || trigger.textContent || '');
          return;
        }
        var preflightBtn = target.closest ? target.closest('[data-demo-console="preflight"]') : null;
        if (preflightBtn) {
          runPreflight(preflightBtn);
          return;
        }
        return; // other clicks inside the popover (radios, etc.) are not outside-clicks
      }
      closePopover();
    }
    if (overlay && !overlay.hidden) {
      var cancelBtn = target.closest ? target.closest('[data-demo-console-overlay-cancel]') : null;
      if (cancelBtn && pending && pending.phase === 'counting') {
        stopTicking();
        pending = cancelCountdown(pending);
        renderOverlay();
        renderPendingIntoPopover();
      }
    }
  });
  document.addEventListener('keydown', function (event) {
    var pop = getPop();
    if (event.key === 'Escape' && pop && !pop.hidden) {
      closePopover();
      var toggle = getToggle();
      if (toggle) toggle.focus();
    }
  });

  // ── control catalog (data-driven; same GET the standalone page uses) ───
  function loadControls() {
    var box = getControlsBox();
    var pop = getPop();
    if (!box) return;
    box.innerHTML = '<p class="dc-note">Loading controls…</p>';
    fetch('/api/v2/demo/controls', { headers: { accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        var freshBox = getControlsBox();
        var freshPop = getPop();
        if (!freshBox) return;
        if (!r.ok) {
          freshBox.innerHTML = '<p class="dc-note dc-status is-err">' + escapeHtml((r.body && r.body.message) || 'Controls unavailable.') + '</p>';
          return;
        }
        if (freshPop) freshPop.setAttribute('data-dc-loaded', '1');
        renderControls(r.body.controls || []);
      })
      .catch(function (err) {
        var freshBox = getControlsBox();
        if (freshBox) freshBox.innerHTML = '<p class="dc-note dc-status is-err">' + escapeHtml(err && err.message ? err.message : 'Controls unavailable.') + '</p>';
      });
    void pop;
  }
  function renderControls(controls) {
    var box = getControlsBox();
    if (!box) return;
    if (controls.length === 0) {
      box.innerHTML = '<p class="dc-note">No demo controls are configured.</p>';
      return;
    }
    var groups = [];
    var byGroup = {};
    for (var i = 0; i < controls.length; i += 1) {
      var c = controls[i];
      if (c.presentation === 'debug') continue;
      if (!byGroup[c.group]) { byGroup[c.group] = []; groups.push(c.group); }
      byGroup[c.group].push(c);
    }
    var html = '';
    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      html += '<section class="dc-group" data-test="demo-console-pop-group" data-group="' + escapeHtml(group) + '"><h3>' + escapeHtml(group) + '</h3>';
      for (var j = 0; j < byGroup[group].length; j += 1) {
        var ctrl = byGroup[group][j];
        html += '<div class="dc-control" data-control-id="' + escapeHtml(ctrl.id) + '">'
          + '<button type="button" data-demo-console="trigger" data-control-id="' + escapeHtml(ctrl.id) + '" data-control-label="' + escapeHtml(ctrl.label) + '" data-test="demo-console-pop-trigger-' + escapeHtml(ctrl.id) + '" title="' + escapeHtml(ctrl.description || '') + '">' + escapeHtml(ctrl.label) + '</button>'
          + '</div>';
      }
      html += '</section>';
    }
    box.innerHTML = html;
    applyPendingDisabledState();
  }

  // ── trigger delay + countdown ───────────────────────────────────────────
  function applyPendingDisabledState() {
    var pop = getPop();
    if (!pop) return;
    var triggers = pop.querySelectorAll('[data-demo-console="trigger"]');
    var busy = pending !== null;
    for (var i = 0; i < triggers.length; i += 1) triggers[i].disabled = busy;
  }
  function renderPendingIntoPopover() {
    var pop = getPop();
    var note = pop ? pop.querySelector('[data-demo-console-pending-note]') : null;
    if (!note) return;
    if (pending && (pending.phase === 'counting' || pending.phase === 'triggering')) {
      note.hidden = false;
      note.textContent = countdownDisplayLabel(pending.label) + ' is queued. Cancel it from the status bar to choose another control.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
    applyPendingDisabledState();
  }

  function renderOverlay() {
    var overlay = getOverlay();
    if (!overlay) return;
    var text = overlay.querySelector('[data-demo-console-overlay-text]');
    var cancel = overlay.querySelector('[data-demo-console-overlay-cancel]');
    if (!pending) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    var name = countdownDisplayLabel(pending.label);
    if (pending.phase === 'counting') {
      if (text) text.textContent = name + ' in ' + pending.secondsLeft + '…';
      if (cancel) cancel.hidden = false;
    } else if (pending.phase === 'triggering') {
      if (text) text.textContent = 'Triggering ' + name + '…';
      if (cancel) cancel.hidden = true;
    } else if (pending.phase === 'done') {
      if (text) text.textContent = (pending.ok ? '' : 'Failed: ') + (pending.message || (pending.ok ? 'Applied.' : 'The trigger failed.'));
      overlay.className = 'dc-overlay ' + (pending.ok ? 'is-ok' : 'is-err');
      if (cancel) cancel.hidden = true;
    }
    if (pending.phase !== 'done') overlay.className = 'dc-overlay';
  }

  function stopTicking() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function scheduleAutoClear() {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(function () {
      pending = null;
      clearTimer = null;
      renderOverlay();
      renderPendingIntoPopover();
    }, 4000);
  }

  function fireApply() {
    var controlId = pending.controlId;
    fetch('/api/v2/demo/controls/' + encodeURIComponent(controlId) + '/apply', {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        var message = r.ok ? (r.body && r.body.detail ? r.body.detail : 'Applied.') : ((r.body && r.body.message) || 'The trigger failed.');
        pending = completeTrigger(pending, !!r.ok, message);
        renderOverlay();
        renderPendingIntoPopover();
        scheduleAutoClear();
      })
      .catch(function (err) {
        pending = completeTrigger(pending, false, err && err.message ? err.message : 'The trigger failed.');
        renderOverlay();
        renderPendingIntoPopover();
        scheduleAutoClear();
      });
  }

  function startTicking() {
    stopTicking();
    tickTimer = setInterval(function () {
      pending = tickCountdown(pending);
      renderOverlay();
      if (pending && pending.phase === 'triggering') {
        stopTicking();
        fireApply();
      }
    }, 1000);
  }

  function beginTrigger(controlId, label) {
    if (!canQueueNewTrigger(pending)) return;
    var delay = currentDelay();
    pending = beginCountdown(controlId, label, delay);
    closePopover();
    renderOverlay();
    renderPendingIntoPopover();
    if (pending.phase === 'triggering') {
      fireApply();
    } else {
      startTicking();
    }
  }

  // (Trigger/preflight/cancel clicks are handled by the single delegated
  // document click listener above, so they keep working after a region
  // patch replaces this widget's DOM.)

  // ── preflight (concise status in the popover, no delay applies here) ───
  function runPreflight(btn) {
    var pop = getPop();
    var status = pop ? pop.querySelector('[data-demo-console-status="preflight"]') : null;
    var detail = pop ? pop.querySelector('[data-demo-console-detail="preflight"]') : null;
    btn.disabled = true;
    if (status) { status.textContent = 'Running…'; status.className = 'dc-status'; }
    fetch('/api/v2/demo/preflight', { method: 'POST', headers: { accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; }); })
      .then(function (r) {
        if (detail) detail.textContent = JSON.stringify(r.body, null, 2);
        if (!r.ok) {
          if (status) { status.textContent = (r.body && r.body.message) || ('HTTP ' + r.status); status.className = 'dc-status is-err'; }
          return;
        }
        var summary = r.body.summary || {};
        var line = (r.body.ok ? 'PASS' : 'FAIL')
          + ' · required: ' + ((summary.requiredFailed || []).join(', ') || 'none')
          + ' · advisory: ' + ((summary.advisoryFailed || []).join(', ') || 'none');
        if (status) { status.textContent = line; status.className = 'dc-status ' + (r.body.ok ? 'is-ok' : 'is-err'); }
      })
      .catch(function (err) {
        if (status) { status.textContent = err && err.message ? err.message : 'Preflight failed.'; status.className = 'dc-status is-err'; }
      })
      .finally(function () { btn.disabled = false; });
  }
})();
</script>`;
}
