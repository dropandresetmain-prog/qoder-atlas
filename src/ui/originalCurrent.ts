/**
 * R2 — Original/Current toggle for the focused Case graph.
 *
 * Contract: docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md §8.2
 *
 * FINDING: The current read model does NOT carry a frozen disruption-time graph
 * snapshot. The available immutable evidence (case cause change-signal received_at,
 * causalPath, planningEvidence.asOf baseline, and the Original graph's node set at
 * disruption time) is partial and has since been updated by reassessments. Fabricating
 * a "true Original" from this partial evidence would be untruthful.
 *
 * Therefore, this implements the SMALLEST truthful mechanism WITHOUT new persistence:
 * a client-side memory-only capture. When the case page first renders in a non-terminal
 * state, the inline script caches the FIRST rendered graph HTML it sees in this page
 * session (memory only, never localStorage/sessionStorage) as 'Original (first seen this
 * session)' with an honest label. The toggle switches between the cached original markup
 * and live current markup, purely display-side, mutating nothing.
 *
 * If no capture exists (e.g. the page loaded after the case was already terminal), the
 * toggle shows an honest empty state: 'Original snapshot not available — capture begins
 * this session'.
 *
 * IMPORTANT: A durable disruption-time snapshot (if product wants true Original across
 * sessions) is a PRIMARY-owned schema decision deferred per contract §8.2. This is NOT
 * that mechanism. This is a bounded, truthful, session-local capture only.
 */

/**
 * Build the Original/Current toggle region markup. Pure helper for SSR or testing.
 *
 * @param currentHtml - The current graph HTML to display
 * @param capturedAt - Optional ISO timestamp of when the original was captured (if any)
 */
export function buildOriginalCurrentRegion(currentHtml: string, capturedAt?: string): string {
  const capturedLabel = capturedAt
    ? `Original (first seen this session · captured ${capturedAt})`
    : 'Original (first seen this session)';

  return `
<div class="original-current-toggle" data-test="original-current-toggle">
  <div class="toggle-controls">
    <button type="button" class="toggle-btn active" data-view="current">Current</button>
    <button type="button" class="toggle-btn" data-view="original">${capturedAt ? capturedLabel : 'Original'}</button>
  </div>
  <div class="toggle-panels">
    <div class="panel current-panel active" data-test="current-panel">
      ${currentHtml}
    </div>
    <div class="panel original-panel" data-test="original-panel" hidden>
      <div class="original-empty-state" data-test="original-empty-state">
        <p>Original snapshot not available — capture begins this session.</p>
        <p class="meta">Refresh the page while the case is open to capture the first seen graph as Original.</p>
      </div>
    </div>
  </div>
</div>`;
}

/**
 * Return an inline <script> that implements the Original/Current toggle.
 *
 * Memory-only capture: on first render of a non-terminal case, cache the graph
 * HTML seen in this page session. Never persist to localStorage/sessionStorage.
 * Toggle switches between cached original and live current, display-side only.
 *
 * Required data attributes on the server-rendered page:
 * - `data-test="product-recovery-case"` on <main>
 * - `data-case-status="<status>"` on <main>
 * - `data-test="focused-case-graph"` on the graph container (or similar selector)
 */
export function originalCurrentToggleScript(): string {
  return `<script>
(function() {
  'use strict';
  var marker = document.querySelector('main[data-test="product-recovery-case"]');
  if (!marker) return;

  // Guard against double-init.
  if (window.__northstarOriginalCurrentStarted) return;
  window.__northstarOriginalCurrentStarted = true;

  // Terminal statuses: do not capture if the case is already terminal.
  var TERMINAL_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'];

  function isTerminal(status) {
    return TERMINAL_STATUSES.indexOf(status) !== -1;
  }

  var status = marker.getAttribute('data-case-status');
  var isTerminalCase = status && isTerminal(status);

  // Memory-only capture of the first graph HTML seen this session.
  var capturedOriginalHtml = null;
  var capturedAt = null;

  // Attempt to capture the graph on first render if the case is not terminal.
  if (!isTerminalCase) {
    var graphContainer = document.querySelector('[data-test="focused-case-graph"]');
    if (graphContainer) {
      capturedOriginalHtml = graphContainer.innerHTML;
      capturedAt = new Date().toISOString();
    }
  }

  // Find or create the toggle region.
  var toggleRegion = document.querySelector('[data-test="original-current-toggle"]');
  if (!toggleRegion) {
    // If the server did not render the toggle region, we cannot proceed.
    // (The server should call buildOriginalCurrentRegion() and include it.)
    return;
  }

  var currentPanel = toggleRegion.querySelector('[data-test="current-panel"]');
  var originalPanel = toggleRegion.querySelector('[data-test="original-panel"]');
  var emptyState = toggleRegion.querySelector('[data-test="original-empty-state"]');
  var buttons = toggleRegion.querySelectorAll('.toggle-btn');

  // If we captured an original, populate the original panel.
  if (capturedOriginalHtml && originalPanel) {
    // Replace the empty state with the captured graph.
    originalPanel.innerHTML = capturedOriginalHtml;

    // Update the Original button label to include the capture timestamp.
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.getAttribute('data-view') === 'original') {
        btn.textContent = 'Original (first seen this session · captured ' + capturedAt + ')';
      }
    }
  }

  // Toggle click handler.
  toggleRegion.addEventListener('click', function(event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('toggle-btn')) return;

    var view = target.getAttribute('data-view');
    if (!view) return;

    // Update button active state.
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].classList.remove('active');
    }
    target.classList.add('active');

    // Show the selected panel.
    if (view === 'current') {
      if (currentPanel) {
        currentPanel.removeAttribute('hidden');
        currentPanel.classList.add('active');
      }
      if (originalPanel) {
        originalPanel.setAttribute('hidden', '');
        originalPanel.classList.remove('active');
      }
    } else if (view === 'original') {
      if (currentPanel) {
        currentPanel.setAttribute('hidden', '');
        currentPanel.classList.remove('active');
      }
      if (originalPanel) {
        originalPanel.removeAttribute('hidden');
        originalPanel.classList.add('active');
      }
    }
  });
})();
</script>`;
}
