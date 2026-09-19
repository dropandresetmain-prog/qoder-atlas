/**
 * M9 — adapt v2 OperatorOverview read models into presentation-safe surface
 * fragments. UI renderers consume ProductSurfaceModel instead of reconstructing
 * business logic from raw tables.
 */
import type {
  AssessmentTone,
  LdgSemanticState,
  OperatorOverview,
  OperatorOverviewItem,
  ProductOperationalStatus,
  RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';
import { escapeHtml } from '../../../ui/html.ts';
import { caseHref } from '../productShell.ts';
import {
  presentAssessment, presentGraphState, presentOperationalStatus, presentViability,
} from '../../../ui/semantics/adapter.ts';
import { TONE_DOT_CLASS } from '../../../ui/semantics/grammar.ts';
import { MANAGED_TRAVEL_LABEL } from '../../../ui/presentationState.ts';
import type { VisualTone } from '../../../ui/semantics/model.ts';

/** Presentation-safe dashboard surface — HTML fragments the UI can compose. */
export interface ProductSurfaceModel {
  title: string;
  summaryHtml: string;
  /** "Needs attention": the case queue, one row per case. Empty note when nothing is open. */
  attentionHtml: string;
  /** Number of rows in the attention queue (after de-duplication by case). */
  attentionCount: number;
  /** "All travellers": the whole managed population; never replaced by the queue. */
  rosterHtml: string;
  /** Number of rows in the roster. */
  rosterCount: number;
  /** attention + roster, kept for callers that render the lower half as one block. */
  itemsHtml: string;
}

export function operationalStatusLabel(status: ProductOperationalStatus): string {
  return presentOperationalStatus(status).label;
}

export function operationalStatusTone(status: ProductOperationalStatus): VisualTone {
  return presentOperationalStatus(status).tone;
}

export function assessmentToneClass(tone: AssessmentTone): VisualTone {
  return presentAssessment(tone).tone;
}

export function ldgSemanticTone(state: LdgSemanticState): VisualTone {
  return presentGraphState(state).tone;
}

export function remainderViabilityTone(viability: RemainderViability): VisualTone {
  return presentViability(viability).tone;
}

/** Operator-facing viability wording comes from the single boundary, never traveller copy. */
export function remainderViabilityLabel(viability: RemainderViability): string {
  return presentViability(viability).label;
}

export function semanticToneDotClass(tone: VisualTone): string {
  return TONE_DOT_CLASS[tone];
}

/**
 * The four managed-travel buckets the operator has always read the programme
 * by. Each is a sum of the authoritative status counts — a grouping for
 * reading, never a recalculation of anyone's status.
 */
const BUCKETS: readonly {
  key: string;
  label: string;
  tone: VisualTone;
  count: (counts: Record<keyof OperatorOverview['summary'], number>) => number;
}[] = [
  { key: 'confirmed', label: MANAGED_TRAVEL_LABEL.CONFIRMED, tone: 'ok', count: (c) => c.ready },
  { key: 'needs-attention', label: MANAGED_TRAVEL_LABEL.NEEDS_ATTENTION, tone: 'alert', count: (c) => c.disrupted },
  { key: 'watching', label: MANAGED_TRAVEL_LABEL.WATCHING, tone: 'watch', count: (c) => c.atRisk + c.recovering },
  { key: 'unconfirmed', label: MANAGED_TRAVEL_LABEL.UNCONFIRMED, tone: 'neutral', count: (c) => c.unknown },
];

/**
 * The counted set.
 *
 * `items` is the case-driven queue, so before any RecoveryCase exists it is
 * empty — and reading the headline count, tiles and fleet grid from it made a
 * fully-populated world render as "0 / 0, no trips in scope". When the read
 * model supplies a population, these surfaces count the population instead,
 * which is the authoritative answer to "whose travel is in scope". `items`
 * keeps owning the work queue below.
 *
 * Both collections carry the same status vocabulary from the same backend, so
 * this is a choice of which authoritative set to count — never a
 * recalculation of anyone's status.
 */
function countedSet(view: OperatorOverview): {
  total: number;
  counts: Record<keyof OperatorOverview['summary'], number>;
  dots: readonly { label: string; status: ProductOperationalStatus; ref: string }[];
} {
  if (view.population.length > 0) {
    const { populationSummary: summary } = view;
    return {
      total: summary.total,
      counts: {
        ready: summary.ready,
        atRisk: summary.atRisk,
        disrupted: summary.disrupted,
        recovering: summary.recovering,
        unknown: summary.unknown,
      },
      dots: view.population.map((entry) => ({
        label: entry.travellerLabel,
        status: entry.status,
        ref: entry.journeyRef,
      })),
    };
  }
  return {
    total: view.items.length,
    counts: { ...view.summary },
    dots: view.items.map((item) => ({ label: item.travellerLabel, status: item.status, ref: item.tripRef })),
  };
}

function summaryTiles(counted: ReturnType<typeof countedSet>): string {
  return BUCKETS
    .map(({ key, label, tone, count }) => {
      const n = count(counted.counts);
      const attention = key === 'needs-attention' && n > 0;
      return `<div class="tile tone-${tone}${attention ? ' is-attention' : ''}" data-test="summary-${tone}" data-summary-key="${key}"><div class="tile-count">${n}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
    })
    .join('');
}

function fleetDot(dot: ReturnType<typeof countedSet>['dots'][number], index: number): string {
  const dotClass = semanticToneDotClass(operationalStatusTone(dot.status));
  const label = `${dot.label} — ${operationalStatusLabel(dot.status)}`;
  return `<i class="${dotClass}" style="--i:${index}" title="${escapeHtml(label)}" data-trip-ref="${escapeHtml(dot.ref)}"></i>`;
}

// Keyed by boundary tone so RECOVERING (active) is never drawn as a confirmed check.
const QUEUE_GLYPH: Record<VisualTone, { className: string; char: string }> = {
  ok: { className: 'g-ok', char: '✓' },
  watch: { className: 'g-warn', char: '▲' },
  alert: { className: 'g-bad', char: '✕' },
  active: { className: 'g-active', char: '…' },
  neutral: { className: 'g-unk', char: '?' },
};

function queueGlyph(item: OperatorOverviewItem): { className: string; char: string } {
  // decisionRequired is a supplied read-model flag, not an inferred state.
  return item.decisionRequired ? QUEUE_GLYPH.alert : QUEUE_GLYPH[operationalStatusTone(item.status)];
}

/**
 * A queue row, made navigable when — and only when — the read model already
 * knows which case owns it.
 *
 * FB1-2: the founder could see a disrupted traveller on Overview and had no
 * way to open their case; the only route in was a hand-pasted API URL. The
 * `caseRef` used here is the authoritative case id the v2 read model already
 * carries. Nothing derives case ownership in the browser, and a row with no
 * case stays a plain row rather than growing an invented link.
 */
function queueRowShell(
  caseRef: string | undefined,
  attributes: string,
  bodyHtml: string,
): string {
  return caseRef === undefined
    ? `<div class="qrow" ${attributes}>${bodyHtml}</div>`
    : `<a class="qrow" href="${escapeHtml(caseHref(caseRef))}" ${attributes} data-test-case-link="${escapeHtml(caseRef)}">${bodyHtml}</a>`;
}

function overviewItemRow(item: OperatorOverviewItem): string {
  const issue =
    item.whatChanged ??
    item.recoveryActivity ??
    (item.decisionRequired ? 'Decision required before recovery can continue.' : 'No open issues reported.');
  const viability = `<span class="badge tone-${remainderViabilityTone(item.remainderViability)}">${escapeHtml(remainderViabilityLabel(item.remainderViability))}</span>`;
  const glyph = queueGlyph(item);
  const uncertainty =
    item.unresolvedUncertainty.length > 0
      ? `<p class="b-extra">${escapeHtml(item.unresolvedUncertainty.join(' · '))}</p>`
      : '';
  return queueRowShell(
    item.caseRef,
    `data-trip-ref="${escapeHtml(item.tripRef)}" data-test="overview-item"`,
    `
      <span class="q-glyph ${glyph.className}" aria-hidden="true">${glyph.char}</span>
      <div>
        <div class="q-name">${escapeHtml(item.travellerLabel)}</div>
        <div class="q-issue">${escapeHtml(issue)}</div>
        ${uncertainty}
      </div>
      <div class="b-right">${viability}</div>`,
  );
}

function readoutSegments(counted: ReturnType<typeof countedSet>): string {
  const attention = counted.counts.disrupted;
  const watching = counted.counts.atRisk + counted.counts.recovering;
  const unconfirmed = counted.counts.unknown;
  const parts = [
    attention > 0 ? `<span class="seg-bad">${attention} need${attention === 1 ? 's' : ''} attention</span>` : '<span class="seg-ok">Nobody needs attention</span>',
    watching > 0 ? `<span class="seg-watch">${watching} watching</span>` : '',
    unconfirmed > 0 ? `<span class="seg-unk">${unconfirmed} unconfirmed</span>` : '',
  ].filter(Boolean);
  return parts.join('');
}

function readoutBlock(counted: ReturnType<typeof countedSet>): string {
  return `
    <div class="readout-ink">
      <p class="ri-label">Managed travel readiness</p>
      <div class="big big-settle">${counted.counts.ready}<span class="unit">/${counted.total}</span></div>
      <p class="ri-confirmed-word">Confirmed</p>
      <p class="sub ri-scale" data-test="managed-presentation-segments">${readoutSegments(counted)}</p>
    </div>`;
}

function fleetGrid(counted: ReturnType<typeof countedSet>): string {
  const cells = counted.dots.map((dot, i) => fleetDot(dot, i)).join('');
  return `
    <div class="readout-fleet">
      <div class="fc-head"><span class="fc-title">${counted.total} participants</span><span class="fc-live">Live</span></div>
      <div class="dotgrid" role="img" aria-label="Participants at a glance" data-test="product-fleet-grid">${cells}</div>
      <div class="legend">
        <span><i class="l-ok"></i>${escapeHtml(MANAGED_TRAVEL_LABEL.CONFIRMED)}</span>
        <span><i class="l-bad"></i>${escapeHtml(MANAGED_TRAVEL_LABEL.NEEDS_ATTENTION)}</span>
        <span><i class="l-watch"></i>${escapeHtml(MANAGED_TRAVEL_LABEL.WATCHING)}</span>
        <span><i class="l-unconfirmed"></i>${escapeHtml(MANAGED_TRAVEL_LABEL.UNCONFIRMED)}</span>
      </div>
    </div>`;
}

/**
 * A roster row for one member of the population. `evaluation` is surfaced as
 * supplied, so a subject with no current assessment says so instead of
 * appearing as a confident verdict. When an open case already covers this
 * subject the row carries the case's own plain-language change, so the roster
 * shows the disrupted traveller visibly changed rather than as a healthy dot.
 */
function populationRow(entry: OperatorOverview['population'][number], issueOverride?: string): string {
  const dotClass = semanticToneDotClass(operationalStatusTone(entry.status));
  const evaluationNote = entry.evaluation === 'CURRENT'
    ? ''
    : `<p class="b-extra">Assessment ${escapeHtml(entry.evaluation.toLowerCase().split('_').join(' '))}</p>`;
  const issue = issueOverride ?? `${operationalStatusLabel(entry.status)} · ${entry.obligation === 'REQUIRED' ? 'Required commitment' : 'Optional commitment'}`;
  return queueRowShell(
    entry.caseRef,
    `data-test="population-row" data-journey-ref="${escapeHtml(entry.journeyRef)}" data-status="${entry.status}"`,
    `
      <span class="q-glyph" aria-hidden="true"><i class="${dotClass}"></i></span>
      <div>
        <div class="q-name">${escapeHtml(entry.travellerLabel)}</div>
        <div class="q-issue">${escapeHtml(issue)}</div>
        ${evaluationNote}
      </div>
      <div class="b-right"><span class="badge tone-${operationalStatusTone(entry.status)}">${escapeHtml(operationalStatusLabel(entry.status))}</span>${entry.caseRef ? '<span class="b-extra">Open case</span>' : ''}</div>`,
  );
}

const ROSTER_RANK: Record<ProductOperationalStatus, number> = {
  DISRUPTED: 0, RECOVERING: 1, AT_RISK: 2, UNKNOWN: 3, READY: 4,
};

/**
 * The attention queue, one row per case. Several subjects can hang off one
 * case, and the queue is about work rather than people, so rows are
 * de-duplicated by case (an item with no case is keyed by its own trip).
 */
function dedupeQueue(items: readonly OperatorOverviewItem[]): OperatorOverviewItem[] {
  const seen = new Set<string>();
  const out: OperatorOverviewItem[] = [];
  for (const item of items) {
    const key = item.caseRef ? `case:${item.caseRef}` : `trip:${item.tripRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * The roster: the WHOLE population, de-duplicated by traveller and ordered by
 * what needs attention first. A case row in the queue never removes anyone
 * from here — the queue routes work, the roster answers "whose travel is this".
 */
function rosterEntries(view: OperatorOverview, queue: readonly OperatorOverviewItem[]): { entry: OperatorOverview['population'][number]; issue?: string }[] {
  const byCase = new Map<string, OperatorOverviewItem>();
  const byJourney = new Map<string, OperatorOverviewItem>();
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
    const issue = item?.whatChanged ?? item?.recoveryActivity;
    rows.push({ entry, ...(issue ? { issue } : {}) });
  }
  return rows.sort((a, b) =>
    ROSTER_RANK[a.entry.status] - ROSTER_RANK[b.entry.status]
    || a.entry.travellerLabel.localeCompare(b.entry.travellerLabel)
    || a.entry.journeyRef.localeCompare(b.entry.journeyRef));
}

export const ROSTER_PAGE_SIZE = 10;

/** Adapt OperatorOverview into dashboard HTML fragments for product surfaces. */
export function adaptOperatorOverviewToDashboard(view: OperatorOverview): ProductSurfaceModel {
  const decisionsNeeded = view.items.filter((item) => item.decisionRequired).length;
  const counted = countedSet(view);
  const eventLine = view.eventContext
    ? `<p class="sub" data-test="event-context">${escapeHtml(view.eventContext.title)}${view.eventContext.organiserLabel ? ` · ${escapeHtml(view.eventContext.organiserLabel)}` : ''}</p>`
    : '';
  const summaryHtml = `
    ${eventLine}
    <div class="readout">
      ${readoutBlock(counted)}
      ${fleetGrid(counted)}
    </div>
    <div class="tiles" data-test="product-summary-tiles">${summaryTiles(counted)}</div>
    ${decisionsNeeded > 0 ? `<div class="callout tone-alert" data-test="decisions-needed"><p class="callout-title">${decisionsNeeded} decision${decisionsNeeded === 1 ? '' : 's'} needed</p><p>Recovery is blocked until an operator approves the pending work.</p></div>` : ''}`;

  // Two answers to two different questions, always both: what needs me (the
  // case queue) and whose travel this is (the whole population).
  const queue = dedupeQueue(view.items);
  const attentionHtml = queue.length > 0
    ? `<div class="queue" data-test="product-overview-queue">${queue.map(overviewItemRow).join('')}</div>`
    : '<p class="empty-note" data-test="no-open-cases">Nothing needs attention right now.</p>';

  const roster = rosterEntries(view, queue);
  const rosterRows = roster
    .map(({ entry, issue }, index) => {
      const row = populationRow(entry, issue);
      // Only the first page is visible before the client controller runs; the
      // rest stay in the document so search and paging work over everything.
      return index < ROSTER_PAGE_SIZE ? row : row.replace(' data-test="population-row"', ' data-test="population-row" hidden');
    })
    .join('');
  const rosterHtml = roster.length > 0
    ? `<div class="queue" data-roster data-page-size="${ROSTER_PAGE_SIZE}" data-test="product-population-queue">${rosterRows}</div>`
    : '<p class="empty-note">No trips in scope.</p>';

  return {
    title: 'Operations overview',
    summaryHtml,
    attentionHtml,
    attentionCount: queue.length,
    rosterHtml,
    rosterCount: roster.length,
    itemsHtml: `${attentionHtml}${rosterHtml}`,
  };
}

/** Total in the counted set, for the surface's own heading. */
export function overviewCountedTotal(view: OperatorOverview): number {
  return countedSet(view).total;
}
