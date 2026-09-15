/**
 * M9 — bilateral programme time-swap preview surface.
 * Emphasises that the preview never mutates authoritative state and shows
 * current vs proposed windows with participant verdicts.
 */
import type { BilateralProgrammeTimeSwapPreview } from '../../app/target/programmeTimeSwapPreview.ts';
import { assessmentToneClass } from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { escapeHtml } from '../html.ts';

function formatWindow(window: { start: string; end: string }): string {
  return `${window.start} → ${window.end}`;
}

function itemBox(
  label: string,
  item: BilateralProgrammeTimeSwapPreview['current']['itemA'],
  tone: 'current' | 'proposed',
): string {
  const boxClass = tone === 'proposed' ? 'cc-box to' : 'cc-box';
  return `
    <div class="${boxClass}">
      <p class="kv-label">${escapeHtml(label)}</p>
      <p class="cc-when">${escapeHtml(item.title)}</p>
      <p class="cc-where">${escapeHtml(item.participantLabel)} · ${escapeHtml(item.itemRef)}</p>
      <div class="cc-slot">
        <span class="cc-slot-k">Window</span>
        <span class="cc-slot-v">${escapeHtml(formatWindow(item.window))}</span>
      </div>
    </div>`;
}

function projectionRows(
  projections: BilateralProgrammeTimeSwapPreview['current']['projections'],
  testPrefix: string,
): string {
  return projections
    .map(
      (projection) => `
      <div class="impact-row" data-test="${testPrefix}-projection">
        <span class="i-count">${projection.verdict === 'PASS' ? '✓' : projection.verdict === 'FAIL' ? '✕' : '?'}</span>
        <div>
          <strong>${escapeHtml(projection.personLabel)}</strong>
          <p class="b-extra">${escapeHtml(projection.itemRef)} · ${badge(projection.verdict, assessmentToneClass(projection.verdict))}</p>
          ${projection.detail ? `<p class="b-extra">${escapeHtml(projection.detail)}</p>` : ''}
        </div>
      </div>`,
    )
    .join('');
}

function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(label)}</span>`;
}

export function renderProductProgrammePreview(preview: BilateralProgrammeTimeSwapPreview): string {
  const acceptedTone = preview.previewAccepted ? 'ok' : 'alert';
  return `
<main class="shell product-programme-preview" data-test="product-programme-preview">
  <div class="preview-banner" data-test="preview-non-mutation">
    <span class="pb-dot" aria-hidden="true"></span>
    Preview only — does not change authoritative programme state
  </div>
  <div class="page-head">
    <h1>Programme time swap preview</h1>
    <p class="sub">Compare current windows with the proposed exchange before committing anything.</p>
    <p class="meta" data-mutates-authoritative-state="${String(preview.mutatesAuthoritativeState)}">mutatesAuthoritativeState: ${String(preview.mutatesAuthoritativeState)}</p>
  </div>
  <section class="section" data-test="preview-current">
    <h2>Current</h2>
    <div class="change-compare">
      ${itemBox('Item A', preview.current.itemA, 'current')}
      <div class="cc-arrow" aria-hidden="true">↔</div>
      ${itemBox('Item B', preview.current.itemB, 'current')}
    </div>
    ${projectionRows(preview.current.projections, 'current')}
  </section>
  <section class="section" data-test="preview-proposed">
    <h2>Proposed</h2>
    <div class="change-compare">
      ${itemBox('Item A', preview.proposed.itemA, 'proposed')}
      <div class="cc-arrow" aria-hidden="true">↔</div>
      ${itemBox('Item B', preview.proposed.itemB, 'proposed')}
    </div>
    ${projectionRows(preview.proposed.projections, 'proposed')}
  </section>
  <div class="callout tone-${acceptedTone}" data-test="preview-verdict">
    <p class="callout-title">Preview verdict</p>
    <p>
      Both parties viable: ${preview.bothPartiesProjectedViable ? 'yes' : 'no'} ·
      Others remain viable: ${preview.othersRemainViable ? 'yes' : 'no'} ·
      Preview accepted: ${preview.previewAccepted ? 'yes' : 'no'}
    </p>
  </div>
</main>`;
}
