/**
 * Auto-refresh polling for the operator Overview surface.
 *
 * Renders an inline <script> that periodically fetches the authoritative
 * HTML shell for the Overview. No business logic, no status inference —
 * readiness/affected-set truth comes only from authoritative snapshots.
 *
 * Presentation rules (Founder T2):
 * - While `data-assessment-lifecycle="RECONCILING"` (backend aggregate of
 *   PENDING_REASSESSMENT subjects), hold the last SETTLED DOM and show the
 *   quiet reconciling indicator. Do not paint transient UNKNOWN collapses.
 * - When SETTLED, swap only if `data-stable-revision` (projectionRevision)
 *   changed. Unchanged settled polls must not visibly redraw.
 *
 * Cursor note: the JSON OperatorOverview view exposes changeCursor and
 * changedVisibleRefs, but the HTML rendering path embeds stable-revision +
 * assessment-lifecycle markers instead. Plain full fetches remain truthful;
 * sinceCursor is not required for the hold/skip-swap behaviour.
 */

/**
 * Return an inline <script> that polls the Overview endpoint and swaps
 * the page regions with the authoritative response. No-ops on pages that
 * lack the dashboard marker.
 */
export function renderOverviewPollingScript(options?: { intervalMs?: number }): string {
  const interval = options?.intervalMs ?? 2000;
  // The script content is plain inline JS — no template interpolation of
  // untrusted values, no backticks inside the script body.
  return `<script>
(function() {
  'use strict';
  // Only run on the dashboard surface.
  var marker = document.querySelector('main[data-test="product-operator-overview"]');
  if (!marker) return;

  // Guard against double-init (e.g. if the script is included twice).
  if (window.__northstarPollStarted) return;
  window.__northstarPollStarted = true;

  var inFlight = false;
  var pollUrl = '/api/v2/operator/overview?format=html';

  // Last SETTLED snapshot's stable revision that was applied to the DOM.
  // Used only to skip no-op redraws — never to invent readiness.
  var lastAppliedRevision = marker.getAttribute('data-stable-revision');
  var lastAppliedLifecycle = marker.getAttribute('data-assessment-lifecycle') || 'SETTLED';

  // The simulated-airline-update trigger's last response-derived status text
  // (set only from real HTTP outcomes of the operator's own click). It is
  // re-applied to the fresh DOM after each swap so the operator's latest
  // truthful feedback stays visible; it is never invented from business state.
  var lastTriggerStatus = null;
  var triggerApplyInFlight = false;

  function applyTriggerStatus() {
    if (lastTriggerStatus === null) return;
    var box = document.querySelector('[data-test="simulated-airline-update"]');
    var status = box ? box.querySelector('[data-test="simulated-airline-update-status"]') : null;
    if (status) status.textContent = lastTriggerStatus;
    var button = box ? box.querySelector('[data-test="simulated-airline-update-apply"]') : null;
    if (button && triggerApplyInFlight) button.disabled = true;
  }

  function setReconcilingIndicator(active) {
    var el = document.querySelector('[data-test="overview-reconciling"]');
    if (!el) return;
    if (active) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function swapRegions(doc) {
    var newMain = doc.querySelector('main[data-test="product-operator-overview"]');
    var curMain = document.querySelector('main[data-test="product-operator-overview"]');
    if (newMain && curMain) {
      // User-opened disclosures must survive the swap: remember the airline
      // update section's open state and restore it on the fresh node.
      var curUpdate = curMain.querySelector('[data-test="simulated-airline-update"]');
      var updateWasOpen = curUpdate ? curUpdate.hasAttribute('open') : false;
      curMain.outerHTML = newMain.outerHTML;
      if (updateWasOpen) {
        var newUpdate = document.querySelector('main[data-test="product-operator-overview"] [data-test="simulated-airline-update"]');
        if (newUpdate) newUpdate.setAttribute('open', '');
      }
    }
    // Swap the topbar so the decision count in nav stays current.
    var newTopbar = doc.querySelector('header.topbar');
    var curTopbar = document.querySelector('header.topbar');
    if (newTopbar && curTopbar) {
      curTopbar.outerHTML = newTopbar.outerHTML;
    }
  }

  function restoreProfileMenuState(wasOpen) {
    if (!wasOpen) return;
    var menu = document.querySelector('details.profile-menu');
    if (menu) menu.setAttribute('open', '');
  }

  function refresh() {
    if (inFlight) return;
    inFlight = true;

    // Remember profile menu open state before swap.
    var profileMenu = document.querySelector('details.profile-menu');
    var profileWasOpen = profileMenu ? profileMenu.hasAttribute('open') : false;

    fetch(pollUrl, { headers: { 'Accept': 'text/html' } })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var parsedMain = doc.querySelector('main[data-test="product-operator-overview"]');
        if (!parsedMain) throw new Error('No overview main in response');

        var lifecycle = parsedMain.getAttribute('data-assessment-lifecycle') || 'SETTLED';
        var revision = parsedMain.getAttribute('data-stable-revision');

        // Authoritative RECONCILING: hold the last SETTLED presentation and
        // surface only the lifecycle indicator. Do not paint partial UNKNOWN
        // readiness collapses while reassessment work is open.
        if (lifecycle === 'RECONCILING') {
          setReconcilingIndicator(true);
          lastAppliedLifecycle = 'RECONCILING';
          applyTriggerStatus();
          var held = document.querySelector('main[data-test="product-operator-overview"]');
          if (held) held.classList.remove('is-stale');
          return;
        }

        // SETTLED + same stable revision as last applied paint → no DOM swap.
        if (
          lastAppliedLifecycle === 'SETTLED' &&
          revision !== null &&
          lastAppliedRevision !== null &&
          revision === lastAppliedRevision
        ) {
          setReconcilingIndicator(false);
          applyTriggerStatus();
          var same = document.querySelector('main[data-test="product-operator-overview"]');
          if (same) same.classList.remove('is-stale');
          return;
        }

        swapRegions(doc);
        restoreProfileMenuState(profileWasOpen);
        applyTriggerStatus();
        setReconcilingIndicator(false);
        lastAppliedRevision = revision;
        lastAppliedLifecycle = 'SETTLED';
        var m = document.querySelector('main[data-test="product-operator-overview"]');
        if (m) m.classList.remove('is-stale');
      })
      .catch(function(err) {
        // Keep the last authoritative content; never blank the page.
        var m = document.querySelector('main[data-test="product-operator-overview"]');
        if (m) m.classList.add('is-stale');
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[northstar] overview poll failed:', err.message || err);
        }
      })
      .then(function() {
        inFlight = false;
      });
  }

  // Expose for other scripts (e.g. a form trigger) to call immediately.
  window.__northstarRefreshOverview = refresh;

  // Simulated airline update trigger (event delegation survives the poll
  // swapping <main> wholesale — listeners live on document, not the node).
  document.addEventListener('click', function(event) {
    var button = event.target && event.target.closest
      ? event.target.closest('[data-test="simulated-airline-update-apply"]')
      : null;
    if (!button) return;
    event.preventDefault();
    var box = button.closest('[data-test="simulated-airline-update"]');
    var status = box ? box.querySelector('[data-test="simulated-airline-update-status"]') : null;
    var configured = box ? box.getAttribute('data-configured') === 'true' : false;
    if (!configured) return;
    button.disabled = true;
    triggerApplyInFlight = true;
    if (status) {
      lastTriggerStatus = 'Applying…';
      status.textContent = lastTriggerStatus;
    }
    fetch('/api/v2/demo/provider-event/airline-rebooking', { method: 'POST', headers: { 'Accept': 'application/json' } })
      .then(function(r) {
        return r.text().then(function(text) {
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { /* non-JSON error body */ }
          return { ok: r.ok, status: r.status, body: parsed, raw: text };
        });
      })
      .then(function(r) {
        triggerApplyInFlight = false;
        if (r.ok) {
          lastTriggerStatus = r.body && r.body.status === 'ALREADY_APPLIED'
            ? 'Already applied. No duplicate incident created.'
            : 'Applied. Authoritative state will refresh automatically.';
          if (status) status.textContent = lastTriggerStatus;
          refresh();
        } else {
          var code = r.body && r.body.code ? r.body.code + ': ' : '';
          var message = r.body && r.body.message ? r.body.message : r.raw;
          lastTriggerStatus = 'The simulated update was not applied. ' + code + message;
          if (status) status.textContent = lastTriggerStatus;
          button.disabled = false;
        }
      })
      .catch(function() {
        triggerApplyInFlight = false;
        lastTriggerStatus = 'The simulated update was not applied. Network error.';
        if (status) status.textContent = lastTriggerStatus;
        button.disabled = false;
      });
  });

  setInterval(refresh, ${interval});
})();
</script>`;
}
