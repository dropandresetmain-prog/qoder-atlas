/** Presentation of supplied Overview counts, work queue and full population. */
import type {
  AssessmentTone, LdgSemanticState, OperatorOverview, OperatorOverviewItem,
  ProductOperationalStatus, RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';
import { escapeHtml } from '../../../ui/html.ts';
import { caseHref, travellerHref } from '../productShell.ts';
import { plainChangeText } from './surfaceLabels.ts';
import { presentAssessment, presentGraphState, presentOperationalStatus, presentViability } from '../../../ui/semantics/adapter.ts';
import { TONE_DOT_CLASS } from '../../../ui/semantics/grammar.ts';
import { MANAGED_TRAVEL_LABEL } from '../../../ui/presentationState.ts';
import type { VisualTone } from '../../../ui/semantics/model.ts';

export interface ProductSurfaceModel {
  title: string; summaryHtml: string; attentionHtml: string; attentionCount: number;
  rosterHtml: string; rosterCount: number; itemsHtml: string;
}
export function operationalStatusLabel(status: ProductOperationalStatus): string { return presentOperationalStatus(status).label; }
export function operationalStatusTone(status: ProductOperationalStatus): VisualTone { return presentOperationalStatus(status).tone; }
export function assessmentToneClass(tone: AssessmentTone): VisualTone { return presentAssessment(tone).tone; }
export function ldgSemanticTone(state: LdgSemanticState): VisualTone { return presentGraphState(state).tone; }
export function remainderViabilityTone(viability: RemainderViability): VisualTone { return presentViability(viability).tone; }
export function remainderViabilityLabel(viability: RemainderViability): string { return presentViability(viability).label; }
export function semanticToneDotClass(tone: VisualTone): string { return TONE_DOT_CLASS[tone]; }
const e = escapeHtml;

/** Count the supplied population, not the (legitimately empty) case queue. */
function countedSet(view: OperatorOverview) {
  if (view.population.length > 0) {
    const s = view.populationSummary;
    return { total: s.total, counts: { ready: s.ready, atRisk: s.atRisk, disrupted: s.disrupted, recovering: s.recovering, unknown: s.unknown },
      dots: view.population.map((p) => ({ label: p.travellerLabel, status: p.status, ref: p.journeyRef })) };
  }
  return { total: view.items.length, counts: { ...view.summary },
    dots: view.items.map((p) => ({ label: p.travellerLabel, status: p.status, ref: p.tripRef })) };
}
const BUCKETS: readonly { key: string; label: string; tone: VisualTone; count: (c: OperatorOverview['summary']) => number }[] = [
  { key: 'confirmed', label: MANAGED_TRAVEL_LABEL.CONFIRMED, tone: 'ok', count: (c) => c.ready },
  { key: 'needs-attention', label: MANAGED_TRAVEL_LABEL.NEEDS_ATTENTION, tone: 'alert', count: (c) => c.disrupted },
  { key: 'watching', label: MANAGED_TRAVEL_LABEL.WATCHING, tone: 'watch', count: (c) => c.atRisk + c.recovering },
  { key: 'unconfirmed', label: MANAGED_TRAVEL_LABEL.UNCONFIRMED, tone: 'neutral', count: (c) => c.unknown },
];
function summaryTiles(counted: ReturnType<typeof countedSet>): string {
  return BUCKETS.map(({ key, label, tone, count }) => {
    const n = count(counted.counts);
    return `<div class="tile tone-${tone}${key === 'needs-attention' && n > 0 ? ' is-attention' : ''}" data-test="summary-${tone}" data-summary-key="${key}"><div class="tile-count">${n}</div><div class="tile-label">${e(label)}</div></div>`;
  }).join('');
}
function readoutSegments(counted: ReturnType<typeof countedSet>): string {
  const c = counted.counts, watching = c.atRisk + c.recovering;
  return [c.disrupted ? `<span class="seg-bad">${c.disrupted} need${c.disrupted === 1 ? 's' : ''} attention</span>` : '<span class="seg-ok">Nobody needs attention</span>',
    watching ? `<span class="seg-watch">${watching} watching</span>` : '',
    c.unknown ? `<span class="seg-unk">${c.unknown} unconfirmed</span>` : ''].join('');
}
function fleetGrid(counted: ReturnType<typeof countedSet>): string {
  const cells = counted.dots.map((dot, index) => `<i class="${semanticToneDotClass(operationalStatusTone(dot.status))}" style="--i:${index}" title="${e(`${dot.label} — ${operationalStatusLabel(dot.status)}`)}" data-trip-ref="${e(dot.ref)}"></i>`).join('');
  return `<div class="readout-fleet"><div class="fc-head"><span class="fc-title">${counted.total} participants</span><span class="fc-live">Live</span></div>
    <div class="dotgrid" role="img" aria-label="Participants at a glance" data-test="product-fleet-grid">${cells}</div>
    <div class="legend"><span><i class="l-ok"></i>${e(MANAGED_TRAVEL_LABEL.CONFIRMED)}</span><span><i class="l-bad"></i>${e(MANAGED_TRAVEL_LABEL.NEEDS_ATTENTION)}</span><span><i class="l-watch"></i>${e(MANAGED_TRAVEL_LABEL.WATCHING)}</span><span><i class="l-unconfirmed"></i>${e(MANAGED_TRAVEL_LABEL.UNCONFIRMED)}</span></div></div>`;
}
const QUEUE_GLYPH: Record<VisualTone, { className: string; char: string }> = {
  ok: { className: 'g-ok', char: '✓' }, watch: { className: 'g-warn', char: '▲' },
  alert: { className: 'g-bad', char: '✕' }, active: { className: 'g-active', char: '…' }, neutral: { className: 'g-unk', char: '?' },
};
function overviewItemRow(item: OperatorOverviewItem): string {
  const issue = plainChangeText(item.whatChanged) ?? plainChangeText(item.recoveryActivity)
    ?? (item.decisionRequired ? 'Decision required before recovery can continue.' : 'No open issues reported.');
  const glyph = item.decisionRequired ? QUEUE_GLYPH.alert : QUEUE_GLYPH[operationalStatusTone(item.status)];
  const body = `<span class="q-glyph ${glyph.className}" aria-hidden="true">${glyph.char}</span>
    <div><div class="q-name">${e(item.travellerLabel)}</div><div class="q-issue">${e(issue)}</div>
    ${item.unresolvedUncertainty.length ? `<p class="b-extra">${e(item.unresolvedUncertainty.join(' · '))}</p>` : ''}</div>
    <div class="b-right"><span class="badge tone-${operationalStatusTone(item.status)}">${e(operationalStatusLabel(item.status))}</span>
      <span class="sr-only">Trip viability: ${e(remainderViabilityLabel(item.remainderViability))}</span>
      ${item.caseRef ? '<span class="case-open" data-test="attention-open-case">Open case →</span>' : ''}</div>`;
  const attrs = `data-trip-ref="${e(item.tripRef)}" data-test="overview-item"`;
  // The complete row is the link. Do not nest an anchor/button inside it.
  return item.caseRef ? `<a class="qrow" href="${e(caseHref(item.caseRef))}" ${attrs} data-test-case-link="${e(item.caseRef)}">${body}</a>`
    : `<div class="qrow" ${attrs}>${body}</div>`;
}
function populationRow(entry: OperatorOverview['population'][number], issueOverride?: string): string {
  const issue = issueOverride ?? `${operationalStatusLabel(entry.status)} · ${entry.obligation === 'REQUIRED' ? 'Required commitment' : 'Optional commitment'}`;
  const evaluation = entry.evaluation === 'CURRENT' ? '' : `<p class="b-extra">Assessment ${e(entry.evaluation.toLowerCase().split('_').join(' '))}</p>`;
  return `<div class="qrow" data-test="population-row" data-journey-ref="${e(entry.journeyRef)}" data-status="${entry.status}">
    <span class="q-glyph" aria-hidden="true"><i class="${semanticToneDotClass(operationalStatusTone(entry.status))}"></i></span>
    <div><div class="q-name">${e(entry.travellerLabel)}</div><div class="q-issue">${e(issue)}</div>${evaluation}</div>
    <div class="b-right"><span class="badge tone-${operationalStatusTone(entry.status)}">${e(operationalStatusLabel(entry.status))}</span>
      <span class="roster-actions">${entry.caseRef ? `<a class="case-open" href="${e(caseHref(entry.caseRef))}" data-test="population-case-link">Open case</a><span aria-hidden="true">·</span>` : ''}
      <a class="traveller-link" href="${e(travellerHref(entry.journeyRef))}" data-test="population-traveller-link" data-journey-ref="${e(entry.journeyRef)}">Traveller view</a></span></div></div>`;
}
const ROSTER_RANK: Record<ProductOperationalStatus, number> = { DISRUPTED: 0, RECOVERING: 1, AT_RISK: 2, UNKNOWN: 3, READY: 4 };
function dedupeQueue(items: readonly OperatorOverviewItem[]): OperatorOverviewItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.caseRef ? `case:${item.caseRef}` : `trip:${item.tripRef}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
/** Keep every population member; a case in the work queue does not remove them. */
function rosterEntries(view: OperatorOverview, queue: readonly OperatorOverviewItem[]) {
  const byCase = new Map<string, OperatorOverviewItem>(), byJourney = new Map<string, OperatorOverviewItem>();
  for (const item of queue) {
    if (item.caseRef && !byCase.has(item.caseRef)) byCase.set(item.caseRef, item);
    for (const ref of item.affectedItems) if (!byJourney.has(ref)) byJourney.set(ref, item);
    if (!byJourney.has(item.tripRef)) byJourney.set(item.tripRef, item);
  }
  const seen = new Set<string>();
  const rows: { entry: OperatorOverview['population'][number]; issue?: string }[] = [];
  for (const entry of view.population) {
    if (seen.has(entry.journeyRef)) continue;
    seen.add(entry.journeyRef);
    const item = (entry.caseRef ? byCase.get(entry.caseRef) : undefined) ?? byJourney.get(entry.journeyRef);
    const issue = plainChangeText(item?.whatChanged) ?? plainChangeText(item?.recoveryActivity);
    rows.push({ entry, ...(issue ? { issue } : {}) });
  }
  return rows.sort((a, b) => ROSTER_RANK[a.entry.status] - ROSTER_RANK[b.entry.status]
    || a.entry.travellerLabel.localeCompare(b.entry.travellerLabel) || a.entry.journeyRef.localeCompare(b.entry.journeyRef));
}
export const ROSTER_PAGE_SIZE = 10;
export function adaptOperatorOverviewToDashboard(view: OperatorOverview): ProductSurfaceModel {
  const counted = countedSet(view), decisions = view.items.filter((item) => item.decisionRequired).length;
  const eventLine = view.eventContext ? `<p class="sub" data-test="event-context">${e(view.eventContext.title)}${view.eventContext.organiserLabel ? ` · ${e(view.eventContext.organiserLabel)}` : ''}</p>` : '';
  const summaryHtml = `${eventLine}<div class="readout"><div class="readout-ink"><p class="ri-label">Managed travel readiness</p>
    <div class="big big-settle">${counted.counts.ready}<span class="unit">/${counted.total}</span></div><p class="ri-confirmed-word">Confirmed</p>
    <p class="sub ri-scale" data-test="managed-presentation-segments">${readoutSegments(counted)}</p></div>${fleetGrid(counted)}</div>
    <div class="tiles" data-test="product-summary-tiles">${summaryTiles(counted)}</div>
    ${decisions ? `<div class="callout tone-alert" data-test="decisions-needed"><p class="callout-title">${decisions} decision${decisions === 1 ? '' : 's'} needed</p><p>Open an affected case to review the proposed recovery and approval requirements.</p></div>` : ''}`;
  const queue = dedupeQueue(view.items);
  const attentionHtml = queue.length ? `<div class="queue" data-test="product-overview-queue">${queue.map(overviewItemRow).join('')}</div>`
    : '<p class="empty-note" data-test="no-open-cases">Nothing needs attention right now.</p>';
  const roster = rosterEntries(view, queue);
  const rows = roster.map(({ entry, issue }, index) => {
    const row = populationRow(entry, issue);
    return index < ROSTER_PAGE_SIZE ? row : row.replace(' data-test="population-row"', ' data-test="population-row" hidden style="display:none"');
  }).join('');
  const rosterHtml = roster.length ? `<div class="roster-tools" data-test="roster-tools">
    <label class="roster-search"><span class="sr-only">Search participants</span><input class="roster-search-input" type="search" data-roster-search data-test="roster-search" placeholder="Search participants" autocomplete="off"></label>
    <span class="roster-status" data-roster-status role="status" aria-live="polite"></span>
    <span class="roster-pagination" data-test="roster-pagination"><button type="button" class="btn btn-ghost" data-roster-prev aria-label="Previous participants">Previous</button><button type="button" class="btn btn-ghost" data-roster-next aria-label="Next participants">Next</button></span></div>
    <div class="queue" data-roster data-page-size="${ROSTER_PAGE_SIZE}" data-test="product-population-queue">${rows}</div>` : '<p class="empty-note">No trips in scope.</p>';
  return { title: 'Operations overview', summaryHtml, attentionHtml, attentionCount: queue.length,
    rosterHtml, rosterCount: roster.length, itemsHtml: `${attentionHtml}${rosterHtml}` };
}
export function overviewCountedTotal(view: OperatorOverview): number { return countedSet(view).total; }
