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
import { CHECK_RESULT_LABEL, scrubText, sentenceCase } from '../../app/target/adapters/surfaceLabels.ts';
import { escapeHtml } from '../html.ts';

type Item = BilateralProgrammeTimeSwapPreview['current']['itemA'];

function itemBox(role: string, item: Item, proposed: boolean): string {
  const labels = item.participantLabels?.filter(Boolean) ?? [];
  const attendeeSummary = labels.length === 0
    ? scrubText(item.participantLabel) || 'No attendees recorded'
    : `${labels.length} ${labels.length === 1 ? 'attendee' : 'attendees'} · ${labels.join(', ')}`;
  return `
    <div class="${proposed ? 'cc-box to' : 'cc-box'}">
      <p class="kv-label">${escapeHtml(role)}</p>
      <p class="cc-when">${escapeHtml(scrubText(item.title) || 'Programme session')}</p>
      <p class="cc-where">${escapeHtml(attendeeSummary)}</p>
      <div class="cc-slot">
        <span class="cc-slot-k">Time</span>
        <span class="cc-slot-v">${escapeHtml(formatWindow(item))}</span>
      </div>
    </div>`;
}

function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone?.trim()) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format();
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function formatWindowInstant(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `${iso} UTC`;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

function formatWindow(item: Item): string {
  const timeZone = resolveTimeZone(item.timeZone);
  return `${formatWindowInstant(item.window.start, timeZone)}–${formatWindowInstant(item.window.end, timeZone)}`;
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

function projectedOutcome(
  projections: BilateralProgrammeTimeSwapPreview['proposed']['projections'],
  include: (projection: BilateralProgrammeTimeSwapPreview['proposed']['projections'][number]) => boolean,
): 'yes' | 'no' | 'unknown' {
  const selected = projections.filter(include);
  if (selected.length === 0) return 'unknown';
  if (selected.some((projection) => projection.verdict === 'FAIL')) return 'no';
  if (selected.some((projection) => projection.verdict === 'UNKNOWN')) return 'unknown';
  return 'yes';
}

function outcomeLabel(value: 'yes' | 'no' | 'unknown'): string {
  return value;
}

export function renderProductProgrammePreview(preview: BilateralProgrammeTimeSwapPreview): string {
  const acceptedTone = preview.previewAccepted ? 'ok' : 'alert';
  const partiesOutcome = projectedOutcome(preview.proposed.projections, (projection) => projection.itemRef !== 'OTHER');
  const othersOutcome = projectedOutcome(preview.proposed.projections, (projection) => projection.itemRef === 'OTHER');
  const hasUnknownOutcome = partiesOutcome === 'unknown' || othersOutcome === 'unknown';
  const verdictTitle = preview.previewAccepted
    ? hasUnknownOutcome
      ? 'This swap is viable with some information still unknown'
      : 'This swap works for everyone checked'
    : hasUnknownOutcome
      ? 'This swap needs more information'
      : 'This swap does not work as proposed';
  const othersLabel = preview.proposed.projections.some((projection) => projection.itemRef === 'OTHER')
    ? outcomeLabel(othersOutcome)
    : 'not separately assessed';
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
    <p class="callout-title">${verdictTitle}</p>
    <p>
      Both session groups remain viable: ${outcomeLabel(partiesOutcome)} ·
      Other linked journeys remain viable: ${othersLabel}
    </p>
    <p class="footnote">Nothing has been changed. A viable swap linked to a recovery case can be prepared for approval. NORTHSTAR checks permission and the latest trip state before applying it.</p>
  </div>
</main>`;
}
