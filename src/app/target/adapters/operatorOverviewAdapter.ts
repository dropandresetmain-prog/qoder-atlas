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

export interface OverviewFocusOption {
  tripRef: string;
  label: string;
  caseRef?: string;
  /** Plain what-changed sentence already presented for the attention queue. */
  context?: string;
}
export interface ProductSurfaceModel {
  title: string; summaryHtml: string; attentionHtml: string; attentionCount: number;
  rosterHtml: string; rosterCount: number; itemsHtml: string;
  focusOptions: readonly OverviewFocusOption[];
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
/**
 * Readiness labels read as one sentence beside a number, so the shared
 * title-cased bucket label is normalised for this row only. The shared
 * `MANAGED_TRAVEL_LABEL` vocabulary is left untouched.
 */
function tileLabel(label: string): string {
  return label.replace(/(\S)\s+(\S)/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`);
}
/** Buckets that only add noise when empty are dropped; the two that an operator reads even at zero always stay. */
const ALWAYS_SHOWN = new Set(['confirmed', 'needs-attention']);
function summaryTiles(counted: ReturnType<typeof countedSet>): string {
  return BUCKETS.map(({ key, label, tone, count }) => {
    const n = count(counted.counts);
    if (n === 0 && !ALWAYS_SHOWN.has(key)) return '';
    return `<div class="readout-bucket tone-${tone}${key === 'needs-attention' && n > 0 ? ' is-attention' : ''}" data-test="summary-${tone}" data-summary-key="${key}"><strong class="tile-count">${n}</strong><span class="tile-label">${e(tileLabel(label))}</span></div>`;
  }).filter(Boolean).join('');
}
function barWidth(count: number, total: number): string {
  if (total <= 0 || count <= 0) return '0';
  return ((count / total) * 100).toFixed(2);
}
/** Compact readiness under the graph. Counts stay authoritative; no fleet hero. */
function compactReadiness(counted: ReturnType<typeof countedSet>): string {
  const c = counted.counts;
  const watching = c.atRisk + c.recovering;
  const total = counted.total;
  return `<div class="v5-readiness" data-test="overview-readiness"><div class="v5-readiness-title"><h2>Managed travel readiness</h2>
    <button type="button" class="v5-text-button" data-switch-overview="participants">${total} participants →</button></div>
    <div class="v5-readiness-bar" role="img" aria-label="Managed travel readiness">
      <span class="seg-ok" style="width:${barWidth(c.ready, total)}%"></span>
      <span class="seg-bad" style="width:${barWidth(c.disrupted, total)}%"></span>
      <span class="seg-watch" style="width:${barWidth(watching, total)}%"></span>
      <span class="seg-unk" style="width:${barWidth(c.unknown, total)}%"></span>
    </div>
    <div class="readout-buckets" data-test="product-summary-tiles">${summaryTiles(counted)}</div></div>`;
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
    <div><div class="q-state tone-${operationalStatusTone(item.status)}"><i aria-hidden="true"></i>${e(operationalStatusLabel(item.status))}</div>
    <div class="q-name">${e(item.travellerLabel)}</div><div class="q-issue">${e(issue)}</div>
    ${item.unresolvedUncertainty.length ? `<p class="b-extra">${e(item.unresolvedUncertainty.join(' · '))}</p>` : ''}</div>
    <div class="b-right"><span class="sr-only">Trip viability: ${e(remainderViabilityLabel(item.remainderViability))}</span>
      ${item.caseRef ? '<span class="case-open" data-test="attention-open-case">Open case →</span>' : ''}</div>`;
  const attrs = `data-trip-ref="${e(item.tripRef)}" data-test="overview-item"${item.caseRef ? ` data-case-ref="${e(item.caseRef)}"` : ''}`;
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
  const summaryHtml = compactReadiness(counted);
  const queue = dedupeQueue(view.items);
  const decisionNote = decisions > 0
    ? `<p class="sub" data-test="decisions-needed">${decisions === 1 ? 'One case is' : `${decisions} cases are`} waiting on your decision.</p>`
    : '';
  const attentionHtml = `${decisionNote}${queue.length ? `<div class="queue" data-test="product-overview-queue">${queue.map(overviewItemRow).join('')}</div>`
    : '<p class="empty-note" data-test="no-open-cases">Nothing needs attention right now.</p>'}`;
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
  const focusOptions = queue.map((item) => {
    const context = plainChangeText(item.whatChanged) ?? plainChangeText(item.recoveryActivity);
    return {
      tripRef: item.tripRef,
      label: item.travellerLabel,
      ...(item.caseRef ? { caseRef: item.caseRef } : {}),
      ...(context ? { context } : {}),
    };
  });
  return { title: 'Operations overview', summaryHtml, attentionHtml, attentionCount: queue.length,
    rosterHtml, rosterCount: roster.length, itemsHtml: `${attentionHtml}${rosterHtml}`, focusOptions };
}
export function overviewCountedTotal(view: OperatorOverview): number { return countedSet(view).total; }
