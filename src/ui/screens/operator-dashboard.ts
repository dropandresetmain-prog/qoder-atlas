/**
 * E2 — operator dashboard: the opening/demo hero surface.
 *
 * Layout (docs/DESIGN.md): one ink readout (on-track count) + the fleet dot
 * grid (every trip at a glance), then the "Decisions needed" queue, then the
 * full roster ordered attention-first. Colour means state only: a healthy
 * trip is green, grey means unconfirmed/unbooked — never "fine".
 *
 * Pure function of the frozen OperatorDashboardView envelope; no scenario
 * logic, no fabricated freshness.
 */
import type {
  OperatorDashboardView,
  OperatorDecisionRequest,
  OperatorTripView,
  ReadModelEnvelope,
  ReadModelStatus,
} from '../../contracts/readmodels.ts';
import { STATUS_LABEL } from '../copy.ts';
import { escapeHtml, formatInstant, formatMoney } from '../html.ts';
import { errorPanel, loadingPanel, statusBadge } from '../components.ts';

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
  const watching = trips.filter((t) => t.status === 'AT_RISK' || t.status === 'NEEDS_TRAVELLER_INFO').length;
  const working = trips.filter((t) => t.status === 'RECOVERING' || t.status === 'CHANGE_REQUESTED' || t.status === 'PLANNING').length;
  const unknown = trips.filter((t) => t.status === 'UNKNOWN').length;
  const decisions = view.summary.awaitingDecision;
  return `
  <div class="readout-ink">
    <div class="ri-label">On track</div>
    <div class="big big-settle">${onTrack}<span class="unit">/${trips.length}</span></div>
    <div class="sub">
      <span class="seg-warn">${watching} watching</span><span class="dot">·</span>
      <span class="${decisions > 0 ? 'seg-bad' : 'seg-dim'}">${decisions} need a decision</span><span class="dot">·</span>
      <span class="seg-dim">${working} in recovery</span><span class="dot">·</span>
      <span class="seg-dim">${unknown} unconfirmed</span>
    </div>
  </div>`;
}

function fleetGrid(view: OperatorDashboardView): string {
  const sorted = sortByUrgency(view.trips);
  const cells = sorted
    .map((trip, i) => {
      const label = `${trip.label ?? trip.tripId} — ${STATUS_LABEL[trip.status]}`;
      return `<i class="${FLEET_CELL[trip.status]}" style="--i:${i}" data-fleet-status="${escapeHtml(trip.status)}" title="${escapeHtml(label)}"></i>`;
    })
    .join('');
  return `
  <div class="readout-fleet">
    <div class="fc-head"><span>Fleet · ${view.trips.length} trips</span><span class="fc-live">Live</span></div>
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
  const when = decision.requestedAt ? formatInstant(decision.requestedAt) : 'timing unconfirmed';
  return `
  <div class="qrow" style="--i:${index}" data-case-id="${escapeHtml(decision.caseId)}">
    <span class="q-glyph ${glyphClass}" aria-hidden="true">${glyph}</span>
    <span class="q-name">${escapeHtml(trip.label ?? trip.tripId)}</span>
    <span class="q-issue">${escapeHtml(decision.description)}${amount}</span>
    <span class="q-time">${escapeHtml(when)}</span>
  </div>`;
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

function tripRow(trip: OperatorTripView, index: number): string {
  const sub = [trip.travellerNames.join(', '), trip.anchorEventName].filter(Boolean).join(' · ');
  const extras: string[] = [];
  if (trip.systemActivity.length > 0) extras.push(`Working: ${trip.systemActivity.join(' · ')}`);
  if (trip.uncertainties.length > 0) extras.push(`Still unclear: ${trip.uncertainties.join(' · ')}`);
  const extraLine = extras.length > 0 ? `<div class="b-extra">${escapeHtml(extras.join(' — '))}</div>` : '';
  return `
  <div class="brow" style="--i:${index}" data-trip-id="${escapeHtml(trip.tripId)}" data-status="${escapeHtml(trip.status)}">
    <span class="b-dot ${FLEET_CELL[trip.status]}" aria-hidden="true"></span>
    <div>
      <div class="b-name">${escapeHtml(trip.label ?? trip.tripId)}</div>
      ${sub ? `<div class="b-extra">${escapeHtml(sub)}</div>` : ''}
    </div>
    <div>
      <div class="b-issue">${tripRowIssue(trip)}</div>
      ${extraLine}
    </div>
    <div class="b-right">
      ${statusBadge(trip.status)}
      <div class="b-time">${escapeHtml(formatInstant(trip.updatedAt))}</div>
    </div>
  </div>`;
}

/** Dashboard body from a loaded view (also used directly by tests). */
export function renderOperatorDashboardBody(view: OperatorDashboardView): string {
  const sorted = sortByUrgency(view.trips);
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
    <h2>All trips <span class="count">${view.trips.length}</span></h2>
    <div class="board stagger">${sorted.map(tripRow).join('')}</div>
  </section>
  <p class="footnote">Statuses update when the underlying bookings are confirmed, not when a message is sent.</p>
</main>`;
}

/** Full dashboard screen from the frozen envelope; honest about loading/error. */
export function renderOperatorDashboard(envelope: ReadModelEnvelope<OperatorDashboardView>): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Loading the trip overview', 'We are gathering the latest confirmed trip information.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('The trip overview is unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('The trip overview is unavailable right now')}</main>`;
  }
  return renderOperatorDashboardBody(envelope.data);
}
