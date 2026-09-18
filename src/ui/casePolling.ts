/**
 * R2 — Case page polling for authoritative snapshot refresh.
 *
 * Mirrors the Overview polling pattern (src/ui/polling.ts) but scoped to the
 * focused Case surface. Polls GET /api/v2/cases/<caseRef>?format=html with
 * sinceCursor echo, applies complete snapshots, preserves user-opened <details>
 * state, and pauses when the case is terminal or the document is hidden.
 *
 * Contract: docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md §4
 * - No WebSockets, no SSE
 * - Poll complete authoritative snapshot every few seconds (default 4000ms)
 * - Apply every snapshot; skipped intermediate revisions are safe (each is complete truth)
 * - Echo changeCursor as sinceCursor on next poll (FIG-3 at-least-once rule)
 * - Revision-unchanged + settled = skip DOM swap (no-op redraw guard)
 * - Preserve user-opened <details> state across swaps
 * - Pause when document.hidden or case is terminal
 */

/**
 * Return an inline <script> that polls the Case endpoint and swaps the case
 * main region with the authoritative response. No-ops on pages that lack the
 * case marker.
 *
 * Required data attributes on the server-rendered page:
 * - `data-test="product-recovery-case"` on <main>
 * - `data-case-ref="<caseRef>"` on <main>
 * - `data-change-cursor="<cursor>"` on <main> (optional; first poll omits sinceCursor)
 * - `data-projection-revision="<revision>"` on <main>
 * - `data-case-status="<status>"` on <main> (OPEN/PLANNING/AWAITING_AUTHORITY/EXECUTING/RESOLVED/CLOSED/CANCELLED/SUPERSEDED)
 */
export function casePollingScript(options: { caseRef: string; intervalMs?: number }): string {
  const interval = options.intervalMs ?? 4000;
  const caseRef = options.caseRef;

  return `<script>
(function() {
  'use strict';
  // Only run on the case surface.
  var marker = document.querySelector('main[data-test="product-recovery-case"]');
  if (!marker) return;

  // Guard against double-init.
  if (window.__northstarCasePollStarted) return;
  window.__northstarCasePollStarted = true;

  var inFlight = false;
  var caseRef = ${JSON.stringify(caseRef)};
  var basePollUrl = '/api/v2/cases/' + encodeURIComponent(caseRef) + '?format=html';

  // Last applied snapshot's cursor and revision for sinceCursor echo and
  // no-op redraw guard.
  var lastAppliedCursor = marker.getAttribute('data-change-cursor');
  var lastAppliedRevision = marker.getAttribute('data-projection-revision');

  // Terminal statuses: polling pauses when the case reaches one.
  var TERMINAL_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'];

  function isTerminal(status) {
    return TERMINAL_STATUSES.indexOf(status) !== -1;
  }

  function swapMain(doc) {
    var newMain = doc.querySelector('main[data-test="product-recovery-case"]');
    var curMain = document.querySelector('main[data-test="product-recovery-case"]');
    if (newMain && curMain) {
      // Preserve user-opened <details> state across the swap.
      var openDetails = curMain.querySelectorAll('details[open]');
      var openDetailsRefs = [];
      for (var i = 0; i < openDetails.length; i++) {
        var det = openDetails[i];
        var ref = det.getAttribute('data-test') || det.getAttribute('data-details-ref');
        if (ref) openDetailsRefs.push(ref);
      }

      // Swap the entire main region (complete snapshot discipline).
      curMain.outerHTML = newMain.outerHTML;

      // Restore open state for matching details elements.
      for (var j = 0; j < openDetailsRefs.length; j++) {
        var ref = openDetailsRefs[j];
        var newDet = document.querySelector('main[data-test="product-recovery-case"] [data-test="' + ref + '"]')
          || document.querySelector('main[data-test="product-recovery-case"] [data-details-ref="' + ref + '"]');
        if (newDet && newDet.tagName === 'DETAILS') {
          newDet.setAttribute('open', '');
        }
      }
    }
  }

  function refresh() {
    // Pause when document is hidden or case is terminal.
    if (document.hidden) return;
    var curMain = document.querySelector('main[data-test="product-recovery-case"]');
    if (!curMain) return;
    var status = curMain.getAttribute('data-case-status');
    if (status && isTerminal(status)) return;

    if (inFlight) return;
    inFlight = true;

    // Build poll URL with sinceCursor echo (omit on first poll).
    var pollUrl = basePollUrl;
    if (lastAppliedCursor) {
      pollUrl += '&sinceCursor=' + encodeURIComponent(lastAppliedCursor);
    }

    fetch(pollUrl, { headers: { 'Accept': 'text/html' } })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var parsedMain = doc.querySelector('main[data-test="product-recovery-case"]');
        if (!parsedMain) throw new Error('No case main in response');

        var newCursor = parsedMain.getAttribute('data-change-cursor');
        var newRevision = parsedMain.getAttribute('data-projection-revision');

        // No-op redraw guard: if cursor and revision are unchanged, skip the swap.
        if (
          newCursor !== null &&
          newRevision !== null &&
          lastAppliedCursor !== null &&
          lastAppliedRevision !== null &&
          newCursor === lastAppliedCursor &&
          newRevision === lastAppliedRevision
        ) {
          return;
        }

        // Apply the complete snapshot.
        swapMain(doc);

        // Update last-applied cursor and revision for next poll.
        lastAppliedCursor = newCursor;
        lastAppliedRevision = newRevision;
      })
      .catch(function(err) {
        // Keep the last authoritative content; never blank the page.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[northstar] case poll failed:', err.message || err);
        }
      })
      .then(function() {
        inFlight = false;
      });
  }

  // Expose for external triggers (e.g. operator controls that POST and want
  // an immediate refresh).
  window.__northstarRefreshCase = refresh;

  // Pause/resume on visibility change.
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) refresh();
  });

  setInterval(refresh, ${interval});
})();
</script>`;
}
