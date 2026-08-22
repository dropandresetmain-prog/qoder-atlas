/**
 * E2 — operator dashboard: the opening/demo hero surface.
 *
 * Answers the operator journey: who is ready / at risk / disrupted, what
 * changed, what the system is doing, what decisions are pending, what is
 * uncertain, and whether trips are actually recovered. Pure function of the
 * frozen OperatorDashboardView envelope; no scenario logic.
 */
import type {
  OperatorDashboardSummary,
  OperatorDashboardView,
  OperatorDecisionRequest,
  OperatorTripView,
  ReadModelEnvelope,
  ReadModelStatus,
} from '../../contracts/readmodels.ts';
import type { StatusTone } from '../copy.ts';
import { STATUS_TONE } from '../copy.ts';
import { escapeHtml, formatInstant, formatMoney } from '../html.ts';
import {
  bulletList,
  errorPanel,
  loadingPanel,
  statusBadge,
  toneClass,
  uncertaintyList,
} from '../components.ts';

/** Urgency ordering for trip cards; deterministic, status-driven only. */
const STATUS_PRIORITY: Record<ReadModelStatus, number> = {
  DISRUPTED: 0,
  AT_RISK: 1,
  RECOVERING: 2,
  UNKNOWN: 3,
  READY: 4,
  RESOLVED: 5,
};

const RESPONSE_STATUS_LABEL: Record<NonNullable<OperatorTripView['travellerResponseStatus']>, string> = {
  AWAITING: 'Waiting for the traveller to respond',
  RESPONDED: 'The traveller has responded',
  NOT_REQUIRED: '',
};

function tile(label: string, count: number, tone: StatusTone, attention = false): string {
  return `
  <div class="${toneClass(tone, 'tile')}${attention ? ' is-attention' : ''}">
    <div class="tile-count">${count}</div>
    <div class="tile-label">${escapeHtml(label)}</div>
  </div>`;
}

function summaryTiles(summary: OperatorDashboardSummary, resolvedCount: number): string {
  return `
  <section class="tiles" aria-label="Trip readiness summary">
    ${tile('Ready', summary.ready, 'ok')}
    ${tile('At risk', summary.atRisk, 'watch', summary.atRisk > 0)}
    ${tile('Needs attention', summary.disrupted, 'alert', summary.disrupted > 0)}
    ${tile('Recovery under way', summary.recovering, 'active', summary.recovering > 0)}
    ${tile('Recovered', resolvedCount, 'done')}
    ${tile('Decisions needed', summary.awaitingDecision, 'neutral', summary.awaitingDecision > 0)}
  </section>`;
}

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

function decisionsPanel(rows: PendingDecisionRow[]): string {
  if (rows.length === 0) return '';
  const items = rows
    .map(({ trip, decision }) => {
      const amount = decision.amount ? ` · ${escapeHtml(formatMoney(decision.amount))}` : '';
      const kind = decision.decisionType === 'APPROVAL' ? 'Approval' : 'Input needed';
      return `<li><strong>${escapeHtml(trip.label ?? trip.tripId)}</strong> — ${escapeHtml(decision.description)} <span class="chip">${escapeHtml(kind)}</span>${amount}</li>`;
    })
    .join('');
  return `
  <section class="section" aria-label="Pending decisions">
    <h2>Decisions needed</h2>
    <div class="panel callout tone-watch" data-ui-section="pending-decisions">
      <ul class="plain-list">${items}</ul>
    </div>
  </section>`;
}

function tripCard(trip: OperatorTripView): string {
  const tone = STATUS_TONE[trip.status];
  const changedCallout = trip.whatChanged
    ? `<div class="${toneClass(tone, 'callout')}"><p class="callout-title">What changed</p><p>${escapeHtml(trip.whatChanged)}</p></div>`
    : '';
  const eventRow = trip.anchorEventName
    ? `<div class="kv"><p class="kv-label">Event</p><p>${escapeHtml(trip.anchorEventName)}</p></div>`
    : '';
  const decisions = trip.pendingDecisions
    .map(
      (decision) =>
        `<li>${escapeHtml(decision.description)}${decision.amount ? ` (${escapeHtml(formatMoney(decision.amount))})` : ''}</li>`,
    )
    .join('');
  const decisionsBlock = decisions
    ? `<div class="kv"><p class="kv-label">Decision needed</p><ul class="plain-list">${decisions}</ul></div>`
    : '';
  const affectedBlock =
    trip.affectedItems.length > 0
      ? `<div class="kv"><p class="kv-label">Also affected</p>${bulletList(trip.affectedItems, '')}</div>`
      : '';
  const activityBlock =
    trip.systemActivity.length > 0
      ? `<div class="kv"><p class="kv-label">What we are doing</p>${bulletList(trip.systemActivity, '')}</div>`
      : '';
  const resolutionBlock = trip.resolutionSummary
    ? `<div class="kv"><p class="kv-label">Outcome</p><div class="callout tone-ok"><p>${escapeHtml(trip.resolutionSummary)}</p></div></div>`
    : '';
  const responseLabel = trip.travellerResponseStatus ? RESPONSE_STATUS_LABEL[trip.travellerResponseStatus] : '';
  const responseBlock = responseLabel ? `<p class="card-sub">${escapeHtml(responseLabel)}</p>` : '';

  return `
  <article class="card trip-card status-${trip.status.toLowerCase()}" data-trip-id="${escapeHtml(trip.tripId)}" data-status="${escapeHtml(trip.status)}">
    <div class="card-head">
      <div>
        <h3 class="card-title">${escapeHtml(trip.label ?? trip.tripId)}</h3>
        <p class="card-sub">${escapeHtml(trip.travellerNames.join(', '))}</p>
      </div>
      ${statusBadge(trip.status)}
    </div>
    ${eventRow}
    ${changedCallout}
    ${affectedBlock}
    ${activityBlock}
    ${decisionsBlock}
    ${uncertaintyList(trip.uncertainties)}
    ${resolutionBlock}
    ${responseBlock}
    <p class="card-foot">Updated ${escapeHtml(formatInstant(trip.updatedAt))}</p>
  </article>`;
}

/** Dashboard body from a loaded view (also used directly by tests). */
export function renderOperatorDashboardBody(view: OperatorDashboardView): string {
  const resolvedCount = view.trips.filter((trip) => trip.status === 'RESOLVED').length;
  const sorted = [...view.trips].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return diff !== 0 ? diff : a.tripId.localeCompare(b.tripId);
  });
  return `
<main class="shell">
  <div class="page-head">
    <h1>Operations overview</h1>
    <p class="sub">Every managed trip, ordered by what needs attention first.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  ${summaryTiles(view.summary, resolvedCount)}
  ${decisionsPanel(collectPendingDecisions(view))}
  <section class="section" aria-label="Trips">
    <div class="trip-grid">
      ${sorted.map(tripCard).join('\n')}
    </div>
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
