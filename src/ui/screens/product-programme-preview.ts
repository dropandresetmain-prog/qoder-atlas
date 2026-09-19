/**
 * Programme time-swap preview surface (disclosed, preview-only).
 *
 * Emphasises that nothing is applied: it shows each session's current window
 * beside the proposed exchange, and how each affected person fares under both.
 * Windows are shown in their own offset; people are named, never referenced by
 * id. The banner and the `data-mutates-authoritative-state` marker carry the
 * preview-only semantics from the backend flag.
 */
import type { BilateralProgrammeTimeSwapPreview } from '../../app/target/programmeTimeSwapPreview.ts';
import { assessmentToneClass } from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { formatWindowRange } from '../../app/target/adapters/programmeAdapter.ts';
import { CHECK_RESULT_LABEL, scrubText, sentenceCase } from '../../app/target/adapters/surfaceLabels.ts';
import { escapeHtml } from '../html.ts';

type Item = BilateralProgrammeTimeSwapPreview['current']['itemA'];

function itemBox(role: string, item: Item, proposed: boolean): string {
  return `
    <div class="${proposed ? 'cc-box to' : 'cc-box'}">
      <p class="kv-label">${escapeHtml(role)}</p>
      <p class="cc-when">${escapeHtml(scrubText(item.title) || 'Programme session')}</p>
      <p class="cc-where">${escapeHtml(scrubText(item.participantLabel) || 'Attendee')}</p>
      <div class="cc-slot">
        <span class="cc-slot-k">Time</span>
        <span class="cc-slot-v">${escapeHtml(formatWindowRange(item.window))}</span>
      </div>
    </div>`;
}

function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(label)}</span>`;
}

function technicalOutcome(verdict: BilateralProgrammeTimeSwapPreview['current']['projections'][number]['verdict']): string {
  return `<details class="technical-details"><summary>Technical details</summary><span>${escapeHtml(verdict)}</span></details>`;
}

function projectionRows(
  projections: BilateralProgrammeTimeSwapPreview['current']['projections'],
  testPrefix: string,
): string {
  return projections
    .map((projection) => {
      const detail = projection.detail ? sentenceCase(scrubText(projection.detail)) : '';
      return `
      <div class="impact-row" data-test="${testPrefix}-projection">
        <span class="i-count" aria-hidden="true">${projection.verdict === 'PASS' ? '✓' : projection.verdict === 'FAIL' ? '✕' : '?'}</span>
        <div>
          <strong>${escapeHtml(scrubText(projection.personLabel) || 'Attendee')}</strong>
          <p class="b-extra">${badge(CHECK_RESULT_LABEL[projection.verdict], assessmentToneClass(projection.verdict))}${technicalOutcome(projection.verdict)}</p>
          ${detail ? `<p class="b-extra">${escapeHtml(detail)}</p>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function renderProductProgrammePreview(preview: BilateralProgrammeTimeSwapPreview): string {
  const acceptedTone = preview.previewAccepted ? 'ok' : 'alert';
  return `
<main class="shell product-programme-preview" data-test="product-programme-preview" data-mutates-authoritative-state="${String(preview.mutatesAuthoritativeState)}">
  <div class="preview-banner" data-test="preview-non-mutation">
    <span class="pb-dot" aria-hidden="true"></span>
    Preview only — this does not change authoritative programme state
    <details class="technical-details"><summary>Technical details</summary><span>mutatesAuthoritativeState: false</span></details>
  </div>
  <div class="page-head">
    <h1>Programme time swap preview</h1>
    <p class="sub">See how exchanging these session times would affect attendees. Nothing changes during the preview.</p>
  </div>
  <section class="section" data-test="preview-current" data-poll-region="preview-current">
    <h2>Current</h2>
    <div class="change-compare">
      ${itemBox('Session A', preview.current.itemA, false)}
      <div class="cc-arrow" aria-hidden="true">↔</div>
      ${itemBox('Session B', preview.current.itemB, false)}
    </div>
    ${projectionRows(preview.current.projections, 'current')}
  </section>
  <section class="section" data-test="preview-proposed" data-poll-region="preview-proposed">
    <h2>Proposed time swap</h2>
    <div class="change-compare">
      ${itemBox('Session A', preview.proposed.itemA, true)}
      <div class="cc-arrow" aria-hidden="true">↔</div>
      ${itemBox('Session B', preview.proposed.itemB, true)}
    </div>
    ${projectionRows(preview.proposed.projections, 'proposed')}
  </section>
  <div class="callout tone-${acceptedTone}" data-test="preview-verdict">
    <p class="callout-title">${preview.previewAccepted ? 'This swap works for everyone checked' : 'This swap does not work as proposed'}</p>
    <p>
      Both attendees can still make their sessions: ${yesNo(preview.bothPartiesProjectedViable)} ·
      Everyone else is unaffected: ${yesNo(preview.othersRemainViable)}
    </p>
    <p class="footnote">Nothing has been changed. This surface only previews a bilateral time swap; applying programme changes is not available here.</p>
  </div>
</main>`;
}
