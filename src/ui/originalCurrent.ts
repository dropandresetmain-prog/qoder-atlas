/**
 * R2 — Original ↔ Current toggle for the focused Case graph.
 *
 * ORIGINAL is the persisted, immutable first-truthful focused graph of the case
 * (`RecoveryCaseView.originalFocusedGraph`, migration 0127), rendered by the SAME
 * V5.6 renderer as CURRENT from its stored semantic snapshot. CURRENT is always the
 * live authoritative graph (`view.ldg`) and never reads the snapshot.
 *
 * Nothing here captures, stores or infers an Original: the browser performs no
 * capture, no browser-storage write of any kind, and no memory-first-seen
 * substitute. When a case has no stored Original (e.g. it pre-dates the snapshot or
 * has not yet had a settled failing assessment) the Original tab shows an honest
 * unavailable state — Current is never presented as Original.
 *
 * The toggle script is pure display state. It uses a delegated listener plus
 * `window.__northstarApplyOriginalCurrent()` so the selected tab survives the
 * polling swap that replaces the case markup.
 */

import { escapeHtml } from './html.ts';

export interface OriginalPanelInput {
  /** Server-rendered graph of the stored Original snapshot. */
  readonly graphHtml: string;
  /** Human-readable capture time, e.g. `19 Sep 2026, 14:03 UTC`. */
  readonly capturedLabel: string;
  /** Machine-readable capture time for `<time datetime>`. */
  readonly capturedAt: string;
}

export interface OriginalCurrentRegionInput {
  readonly currentHtml: string;
  /** Absent when the case has no persisted Original. */
  readonly original?: OriginalPanelInput;
}

export const ORIGINAL_CURRENT_CSS = `
.oc-toggle { margin: 8px 0 4px; }
.oc-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--surface-2, rgba(127,127,127,.12)); margin-bottom: 10px; }
.oc-tab { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 8px; cursor: pointer; opacity: .75; }
.oc-tab:hover { opacity: 1; }
.oc-tab.active { background: var(--surface, #fff); box-shadow: 0 1px 2px rgba(0,0,0,.18); opacity: 1; }
.oc-tab:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.oc-caption { margin: 0 0 8px; font-size: 13px; opacity: .8; }
.oc-panel[hidden] { display: none; }
.oc-unavailable { padding: 18px 20px; border: 1px dashed rgba(127,127,127,.5); border-radius: 12px; }
.oc-unavailable p { margin: 0 0 6px; }
`;

export function buildOriginalCurrentRegion(input: OriginalCurrentRegionInput): string {
  const { currentHtml, original } = input;
  const originalPanel = original
    ? `<p class="oc-caption" data-test="original-caption">The graph as it stood when the trip first failed — captured <time datetime="${escapeHtml(original.capturedAt)}">${escapeHtml(original.capturedLabel)}</time>. It never changes.</p>
      ${original.graphHtml}`
    : `<div class="oc-unavailable" data-test="original-unavailable">
        <p><strong>Original graph unavailable</strong></p>
        <p class="meta">No original graph was stored for this case, so there is nothing to compare against. Current is not a substitute.</p>
      </div>`;

  return `
<style>${ORIGINAL_CURRENT_CSS}</style>
<div class="oc-toggle" data-test="original-current-toggle">
  <div class="oc-tabs" role="tablist" aria-label="Graph version">
    <button type="button" role="tab" class="oc-tab active" data-oc-view="current" aria-selected="true">Current</button>
    <button type="button" role="tab" class="oc-tab" data-oc-view="original" aria-selected="false">Original</button>
  </div>
  <div class="oc-panel oc-current active" data-test="current-panel" data-oc-panel="current">
    <p class="oc-caption">Live — always the current authoritative state.</p>
    ${currentHtml}
  </div>
  <div class="oc-panel oc-original" data-test="original-panel" data-oc-panel="original" hidden>
    ${originalPanel}
  </div>
</div>`;
}

/**
 * Inline script: display-only tab switching. Safe to emit once; re-applicable
 * after a polling swap via `window.__northstarApplyOriginalCurrent()`.
 */
export function originalCurrentToggleScript(): string {
  return `<script>
(function() {
  'use strict';
  if (window.__northstarOriginalCurrentStarted) return;
  window.__northstarOriginalCurrentStarted = true;

  // Display-only, in-memory: which tab the operator is looking at.
  var selected = 'current';

  function apply() {
    var region = document.querySelector('[data-test="original-current-toggle"]');
    if (!region) return;
    var tabs = region.querySelectorAll('[data-oc-view]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-oc-view') === selected;
      tabs[i].classList.toggle('active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var panels = region.querySelectorAll('[data-oc-panel]');
    for (var j = 0; j < panels.length; j++) {
      var show = panels[j].getAttribute('data-oc-panel') === selected;
      if (show) panels[j].removeAttribute('hidden'); else panels[j].setAttribute('hidden', '');
      if (show && window.__northstarShowGraphs) window.__northstarShowGraphs(panels[j]);
    }
  }
  window.__northstarApplyOriginalCurrent = apply;

  document.addEventListener('click', function(event) {
    var target = event.target;
    var tab = target && target.closest ? target.closest('[data-oc-view]') : null;
    if (!tab) return;
    selected = tab.getAttribute('data-oc-view') === 'original' ? 'original' : 'current';
    apply();
  });
})();
</script>`;
}
