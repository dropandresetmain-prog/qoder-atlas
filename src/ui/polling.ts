/**
 * Auto-refresh polling for the operator Overview surface.
 *
 * Renders an inline <script> that periodically fetches the authoritative
 * HTML shell for the Overview and swaps the <main> and topbar regions
 * wholesale. No business logic, no status inference — the server response
 * wins completely.
 *
 * Cursor note: the JSON OperatorOverview view exposes changeCursor and
 * changedVisibleRefs, but the HTML rendering path (renderInShell →
 * renderPage → renderProductOperatorOverview) does NOT embed the cursor
 * in the markup. Rather than build a JSON+HTML hybrid, this script does
 * plain full fetches without sinceCursor. The server always returns the
 * complete authoritative snapshot, so this is truthful and correct.
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
        swapRegions(doc);
        restoreProfileMenuState(profileWasOpen);
        applyTriggerStatus();
        // Clear stale marker if it was set from a prior failure.
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
