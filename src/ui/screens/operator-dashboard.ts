/**
 * E2 — operator dashboard: the opening/demo hero surface.
 *
 * Layout (docs/DESIGN.md + approved O1 render): one ink readout (on-track
 * count with the state subline) + the fleet dot grid (every trip at a
 * glance), then the "Decisions needed" queue, then the roster ordered
 * attention-first with per-row mini journey chains. Colour means state
 * only: a healthy trip is green, grey means unconfirmed/unbooked — never
 * "fine".
 *
 * Pure function of the frozen OperatorDashboardView envelope; no scenario
 * logic, no fabricated freshness. Per-row mini chains and role lines are
 * optional augmentations: rendered only when the projection supplies them
 * (see OperatorDashboardAugmentations), never invented by the screen.
 */
import type {
  OperatorDashboardView,
  OperatorDecisionRequest,
  OperatorTripView,
  ReadModelEnvelope,
  ReadModelStatus,
} from '../../contracts/readmodels.ts';
import type { ChainLinkView } from '../case-view-model.ts';
import { STATUS_LABEL } from '../copy.ts';
import { escapeHtml, formatInstant, formatMoney, formatRosterTime, formatShort } from '../html.ts';
import { errorPanel, loadingPanel, miniChainRow, statusBadge } from '../components.ts';

/** Urgency ordering for rows and grid cells; deterministic, status-driven only. */
const STATUS_PRIORITY: Record<ReadModelStatus, number> = {
  DISRUPTED: 0,
  AT_RISK: 1,
  RECOVERING: 2,
  NEEDS_TRAVELLER_INFO: 3,
  CHANGE_REQUESTED: 4,
  UNKNOWN: 5,
  PLANNING: 6,
  READY: 7,
  RESOLVED: 8,
};

/**
 * Fleet-grid cell class per status. Binding colour logic (DESIGN.md §2.2):
 * green = confirmed/healthy, brass = waiting/watching, vermilion = broken,
 * ink = system working, hollow grey = unknown/unbooked (never "fine").
 */
const FLEET_CELL: Record<ReadModelStatus, string> = {
  READY: 'd-ok',
  RESOLVED: 'd-ok',
  AT_RISK: 'd-watch',
  NEEDS_TRAVELLER_INFO: 'd-watch',
  CHANGE_REQUESTED: 'd-watch',
  DISRUPTED: 'd-bad',
  RECOVERING: 'd-active',
  PLANNING: 'd-active',
  UNKNOWN: 'd-empty',
};

/**
 * Optional, additive dashboard data the frozen read model does not carry
 * yet. Screens render them when present and omit the decoration when not —
 * the gap is reported to the integrator instead of being hardcoded around.
 */
export interface OperatorDashboardAugmentations {
  /** Journey chain per trip for the roster mini-chain (flight · transfer · stay · commitment). */
  chainFor?: (trip: OperatorTripView) => readonly ChainLinkView[] | undefined;
  /** Role/organisation line under the traveller name (e.g. from the intake profile). */
  roleFor?: (trip: OperatorTripView) => string | undefined;
  /** Link target for the roster section's "Full roster" shortcut. */
  programmeHref?: string;
}

function sortByUrgency(trips: readonly OperatorTripView[]): OperatorTripView[] {
  return [...trips].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return diff !== 0 ? diff : a.tripId.localeCompare(b.tripId);
  });
}

// ---------------------------------------------------------------------------
// Readout: ink block + fleet grid
// ---------------------------------------------------------------------------

function readoutBlock(view: OperatorDashboardView): string {
  const trips = view.trips;
  const onTrack = trips.filter((t) => t.status === 'READY' || t.status === 'RESOLVED').length;
  const attention = trips.filter((t) => t.status === 'DISRUPTED').length;
  const watching = trips.filter((t) => t.status === 'AT_RISK' || t.status === 'NEEDS_TRAVELLER_INFO').length;
  const recovering = trips.filter((t) => t.status === 'RECOVERING' || t.status === 'CHANGE_REQUESTED').length;
  const planning = trips.filter((t) => t.status === 'PLANNING').length;
  const unknown = trips.filter((t) => t.status === 'UNKNOWN').length;
  const segments = [
    `<span class="seg-bad">${attention} needs attention</span>`,
    `<span class="seg-warn">${watching} watching</span>`,
    `<span class="seg-ok">${recovering} in recovery</span>`,
    planning > 0 ? `<span class="seg-dim">${planning} being planned</span>` : '',
    `<span class="seg-dim">${unknown} unconfirmed</span>`,
  ].filter(Boolean).join(' · ');
  return `
    <div class="readout-ink">
      <p class="ri-label">On track</p>
      <div class="big big-settle">${onTrack}<span class="unit">/${trips.length}</span></div>
      <p class="sub">${segments}</p>
    </div>`;
}

function fleetGrid(view: OperatorDashboardView): string {
  const sorted = sortByUrgency(view.trips);
  const cells = sorted
    .map((trip, i) => {
      const label = `${trip.label ?? trip.tripId} — ${STATUS_LABEL[trip.status]}`;
      return `<i class="${FLEET_CELL[trip.status]}" style="--i:${i}" data-fleet-trip="${escapeHtml(trip.tripId)}" data-fleet-status="${escapeHtml(trip.status)}" title="${escapeHtml(label)}"></i>`;
    })
    .join('');
  return `
    <div class="readout-fleet">
      <div class="fc-head"><span class="fc-title">Fleet · ${view.trips.length} trips</span><span class="fc-live">Live</span></div>
      <div class="dotgrid" role="img" aria-label="All trips at a glance, ordered by what needs attention first">${cells}</div>
      <div class="legend">
        <span><i class="l-ok"></i>Ready / recovered</span>
        <span><i class="l-watch"></i>Watching</span>
        <span><i class="l-bad"></i>Needs attention</span>
        <span><i class="l-active"></i>Recovery under way</span>
        <span><i class="l-empty"></i>Unconfirmed</span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Decisions queue
// ---------------------------------------------------------------------------

interface PendingDecisionRow {
  trip: OperatorTripView;
  decision: OperatorDecisionRequest;
}

function collectPendingDecisions(view: OperatorDashboardView): PendingDecisionRow[] {
  const rows: PendingDecisionRow[] = [];
  for (const trip of view.trips) {
    for (const decision of trip.pendingDecisions) {
      rows.push({ trip, decision });
    }
  }
  return rows;
}

function decisionRow({ trip, decision }: PendingDecisionRow, index: number): string {
  const isApproval = decision.decisionType === 'APPROVAL';
  const glyph = isApproval ? '!' : '?';
  const glyphClass = isApproval ? 'g-bad' : 'g-warn';
  const amount = decision.amount ? ` · ${escapeHtml(formatMoney(decision.amount))}` : '';
  const when = decision.requestedAt ? formatShort(decision.requestedAt) : 'timing unconfirmed';
  return `
  <a href="/operator/cases/${escapeHtml(decision.caseId)}" class="qrow" style="--i:${Math.min(index, 13)}" data-case-id="${escapeHtml(decision.caseId)}" data-test="decision-link">
    <span class="q-glyph ${glyphClass}" aria-hidden="true">${glyph}</span>
    <span class="q-name">${escapeHtml(trip.label ?? trip.tripId)}</span>
    <span class="q-issue">${escapeHtml(decision.description)}${amount}</span>
    <span class="q-time">${escapeHtml(when)}</span>
  </a>`;
}

function decisionsPanel(rows: PendingDecisionRow[]): string {
  if (rows.length === 0) return '';
  return `
  <section class="section" aria-label="Pending decisions">
    <h2>Decisions needed <span class="count c-alert">${rows.length}</span></h2>
    <div class="queue stagger" data-ui-section="pending-decisions">${rows.map(decisionRow).join('')}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function tripRowIssue(trip: OperatorTripView): string {
  if (trip.whatChanged) return escapeHtml(trip.whatChanged);
  if (trip.resolutionSummary) return escapeHtml(trip.resolutionSummary);
  return escapeHtml(STATUS_LABEL[trip.status]);
}

function tripRow(trip: OperatorTripView, index: number, view: OperatorDashboardView, augment: OperatorDashboardAugmentations): string {
  const namedTravellers = trip.travellerNames.length > 0 ? trip.travellerNames.join(', ') : undefined;
  const name = namedTravellers ?? trip.label ?? trip.tripId;
  const roleLine = augment.roleFor?.(trip) ?? trip.anchorEventName ?? (namedTravellers ? trip.label : undefined);
  const chain = augment.chainFor?.(trip);
  const miniChain = chain && chain.length > 0 ? miniChainRow(chain) : '';
  const extras: string[] = [];
  if (trip.systemActivity.length > 0) extras.push(`Working: ${trip.systemActivity.join(' · ')}`);
  if (trip.uncertainties.length > 0) extras.push(`Still unclear: ${trip.uncertainties.join(' · ')}`);
  const extraLine = extras.length > 0 ? `<div class="b-extra">${escapeHtml(extras.join(' — '))}</div>` : '';
  const content = `
    <span class="b-dot ${FLEET_CELL[trip.status]}" aria-hidden="true"></span>
    <div>
      <div class="b-name">${escapeHtml(name)}</div>
      ${roleLine ? `<div class="b-extra">${escapeHtml(roleLine)}</div>` : ''}
      ${miniChain}
    </div>
    <div>
      <div class="b-issue">${tripRowIssue(trip)}</div>
      ${extraLine}
    </div>
    <div class="b-right">
      ${statusBadge(trip.status)}
      <div class="b-time">${escapeHtml(formatRosterTime(trip.updatedAt, view.generatedAt))}</div>
    </div>`;
  const rowAttributes = `class="brow" style="--i:${Math.min(index, 13)}" data-trip-id="${escapeHtml(trip.tripId)}" data-status="${escapeHtml(trip.status)}"`;
  return trip.activeCaseId
    ? `<a href="/operator/cases/${escapeHtml(trip.activeCaseId)}" ${rowAttributes} data-test="trip-link" aria-label="Open operator case for ${escapeHtml(name)}">${content}</a>`
    : `<div ${rowAttributes}>${content}</div>`;
}

function rosterFootnote(hasMiniChains: boolean): string {
  const legend = hasMiniChains
    ? `<br>Row marks — flight · transfer · stay · ✦ commitment: ✓ confirmed · ◌ proposed · ▲ at risk · ✕ broken · ○ not booked · ? unconfirmed.`
    : '';
  return `<p class="footnote">Statuses update when the underlying bookings are confirmed, not when a message is sent.${legend}</p>`;
}

/** Dashboard body from a loaded view (also used directly by tests). */
export function renderOperatorDashboardBody(
  view: OperatorDashboardView,
  augment: OperatorDashboardAugmentations = {},
): string {
  const sorted = sortByUrgency(view.trips);
  const hasMiniChains = sorted.some((trip) => (augment.chainFor?.(trip)?.length ?? 0) > 0);
  const rosterLink = augment.programmeHref
    ? `<a class="h2-link" href="${escapeHtml(augment.programmeHref)}">Full roster on the programme page →</a>`
    : '';
  return `
<main class="shell">
  <div class="page-head">
    <h1>Operations overview</h1>
    <p class="sub">Every managed trip, ordered by what needs attention first.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  <div class="readout">
${readoutBlock(view)}
${fleetGrid(view)}
  </div>
  ${decisionsPanel(collectPendingDecisions(view))}
  <section class="section" aria-label="Trips">
    <h2>All trips <span class="count">${view.trips.length}</span>${rosterLink}</h2>
    <div class="board stagger">${sorted.map((trip, i) => tripRow(trip, i, view, augment)).join('')}</div>
    ${rosterFootnote(hasMiniChains)}
  </section>
</main>`;
}

/** Full dashboard screen from the frozen envelope; honest about loading/error. */
export function renderOperatorDashboard(
  envelope: ReadModelEnvelope<OperatorDashboardView>,
  augment: OperatorDashboardAugmentations = {},
): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Loading the trip overview', 'We are gathering the latest confirmed trip information.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('The trip overview is unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('The trip overview is unavailable right now')}</main>`;
  }
  return renderOperatorDashboardBody(envelope.data, augment);
}
