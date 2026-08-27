/**
 * E2 — operator dashboard: the opening/demo hero surface.
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
import { escapeHtml, formatInstant, formatMoney, formatRosterTime, formatShort, encodeUri } from '../html.ts';
import { errorPanel, loadingPanel, miniChainRow, statusBadge } from '../components.ts';

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

const FLEET_CELL: Record<ReadModelStatus, string> = {
  READY: 'd-ok',
  RESOLVED: 'd-ok',
  AT_RISK: 'd-watch',
  NEEDS_TRAVELLER_INFO: 'd-watch',
  CHANGE_REQUESTED: 'd-watch',
  DISRUPTED: 'd-bad',
  RECOVERING: 'd-active',
  PLANNING: 'd-active',
  UNKNOWN: 'd-unconfirmed',
};

export interface OperatorDashboardAugmentations {
  chainFor?: (trip: OperatorTripView) => readonly ChainLinkView[] | undefined;
  roleFor?: (trip: OperatorTripView) => string | undefined;
  programmeHref?: string;
  demoReset?: { action: string; label: string };
}

function sortByUrgency(trips: readonly OperatorTripView[]): OperatorTripView[] {
  return [...trips].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return diff !== 0 ? diff : a.tripId.localeCompare(b.tripId);
  });
}

function fleetCellClass(trip: OperatorTripView): string {
  if (trip.travelArrangement === 'SELF_OR_OTHER_ARRANGED') return 'd-local';
  return FLEET_CELL[trip.status];
}

function readoutBlock(view: OperatorDashboardView): string {
  const counts = view.arrangementCounts;
  const managedTotal = counts.northstarArranged;
  const confirmed = view.summary.managedConfirmed;
  const trips = view.trips;
  const watching = trips.filter((t) => t.status === 'AT_RISK' || t.status === 'NEEDS_TRAVELLER_INFO').length;
  const attention = trips.filter((t) => t.status === 'DISRUPTED').length;
  const recovering = trips.filter((t) => t.status === 'RECOVERING' || t.status === 'CHANGE_REQUESTED').length;
  const unconfirmed = trips.filter((t) => t.status === 'UNKNOWN' || t.status === 'PLANNING').length;
  const awaiting = view.summary.awaitingDecision;
  const segments = [
    attention > 0 ? `<span class="seg-bad">${attention} needs attention</span>` : '',
    watching > 0 ? `<span class="seg-warn">${watching} watching</span>` : '',
    recovering > 0 ? `<span class="seg-ok">${recovering} in recovery</span>` : '',
    awaiting > 0 ? `<span class="seg-warn">${awaiting} awaiting decision</span>` : '',
    unconfirmed > 0 ? `<span class="seg-dim">${unconfirmed} unconfirmed</span>` : '',
  ].filter(Boolean).join(' · ');
  const context = `${counts.northstarArranged} travelling · ${counts.selfOrOtherArranged} local · ${counts.total} speakers total`;
  return `
    <div class="readout-ink">
      <p class="ri-label">Managed travel readiness</p>
      <div class="big big-settle">${confirmed}<span class="unit">/${managedTotal}</span></div>
      <p class="ri-confirmed-word">Confirmed</p>
      <p class="sub ri-scale">${escapeHtml(context)}</p>
      ${segments ? `<p class="sub">${segments}</p>` : ''}
    </div>`;
}

function fleetGrid(view: OperatorDashboardView): string {
  const sorted = sortByUrgency(view.trips);
  const cells = sorted
    .map((trip, i) => {
      const label = `${trip.label ?? trip.tripId} — ${STATUS_LABEL[trip.status]}`;
      return `<i class="${fleetCellClass(trip)}" style="--i:${i}" data-fleet-trip="${escapeHtml(trip.tripId)}" data-fleet-status="${escapeHtml(trip.status)}" title="${escapeHtml(label)}"></i>`;
    })
    .join('');
  return `
    <div class="readout-fleet">
      <div class="fc-head"><span class="fc-title">Fleet · ${view.trips.length} participants</span><span class="fc-live">Live</span></div>
      <div class="dotgrid" role="img" aria-label="All participants at a glance, ordered by what needs attention first">${cells}</div>
      <div class="legend">
        <span><i class="l-ok"></i>Confirmed / recovered</span>
        <span><i class="l-watch"></i>Watching</span>
        <span><i class="l-bad"></i>Needs attention</span>
        <span><i class="l-active"></i>Recovery under way</span>
        <span><i class="l-unconfirmed"></i>Unconfirmed</span>
        <span><i class="l-local"></i>Local / self-arranged</span>
      </div>
    </div>`;
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

function decisionRow({ trip, decision }: PendingDecisionRow, index: number): string {
  const isApproval = decision.decisionType === 'APPROVAL';
  const glyph = isApproval ? '!' : '?';
  const glyphClass = isApproval ? 'g-bad' : 'g-warn';
  const amount = decision.amount ? ` · ${escapeHtml(formatMoney(decision.amount))}` : '';
  const when = decision.requestedAt ? formatShort(decision.requestedAt) : 'timing unconfirmed';
  return `
  <a href="/operator/cases/${encodeUri(decision.caseId)}" class="qrow" style="--i:${Math.min(index, 13)}" data-case-id="${escapeHtml(decision.caseId)}" data-test="decision-link">
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

function rosterSearchField(): string {
  return `
  <div class="roster-search">
    <label class="visually-hidden" for="roster-filter">Search roster</label>
    <input type="search" id="roster-filter" class="roster-search-input" placeholder="Search travellers…" data-test="roster-search" autocomplete="off">
  </div>`;
}

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
  const caseHref = trip.activeCaseId ? `/operator/cases/${encodeUri(trip.activeCaseId)}` : `/traveller?trip=${encodeUri(trip.tripId)}`;
  const rowTag = trip.activeCaseId ? 'a' : 'div';
  const rowAttrs = trip.activeCaseId
    ? `href="${escapeHtml(caseHref)}" class="brow brow-actionable" data-test="case-row-link"`
    : `class="brow"`;
  const showInteraction = `<a href="/traveller?trip=${encodeUri(trip.tripId)}" class="btn btn-ghost btn-sm" data-test="show-interaction">Show interaction</a>`;
  return `
  <${rowTag} ${rowAttrs} style="--i:${Math.min(index, 13)}" data-trip-id="${escapeHtml(trip.tripId)}" data-status="${escapeHtml(trip.status)}" data-roster-name="${escapeHtml(name.toLowerCase())}">
    <span class="b-dot ${fleetCellClass(trip)}" aria-hidden="true"></span>
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
      ${showInteraction}
      ${statusBadge(trip.status)}
      <div class="b-time">${escapeHtml(formatRosterTime(trip.updatedAt, view.generatedAt))}</div>
    </div>
  </${rowTag}>`;
}

function rosterFootnote(hasMiniChains: boolean): string {
  const legend = hasMiniChains
    ? `<br>Row marks — ✈ flight · ⇄ ground · ⌂ stay · ✦ commitment. Colour shows state: confirmed · proposed · at risk · broken · not booked · unconfirmed.`
    : '';
  return `<p class="footnote">Statuses update when the underlying bookings are confirmed, not when a message is sent.${legend}</p>`;
}

export function renderOperatorDashboardBody(
  view: OperatorDashboardView,
  augment: OperatorDashboardAugmentations = {},
): string {
  const sorted = sortByUrgency(view.trips);
  const hasMiniChains = sorted.some((trip) => (augment.chainFor?.(trip)?.length ?? 0) > 0);
  const rosterLink = augment.programmeHref
    ? `<a class="h2-link" href="${escapeHtml(augment.programmeHref)}">Full roster on the programme page →</a>`
    : '';
  const demoReset = augment.demoReset
    ? `<form class="demo-reset-form" method="post" action="${escapeHtml(augment.demoReset.action)}" data-test="demo-reset-form">
    <button type="submit" class="demo-reset-btn" data-test="demo-reset-btn">${escapeHtml(augment.demoReset.label)}</button>
  </form>`
    : '';
  return `
<main class="shell">
  <div class="page-head">
    <h1>Operations overview</h1>
    <p class="sub">Every managed trip, ordered by what needs attention first.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
    ${demoReset}
  </div>
  <div class="readout">
${readoutBlock(view)}
${fleetGrid(view)}
  </div>
  ${decisionsPanel(collectPendingDecisions(view))}
  <section class="section" aria-label="Trips">
    <h2>All travellers <span class="count">${view.trips.length}</span>${rosterLink}</h2>
    ${rosterSearchField()}
    <div class="board stagger" id="roster-board" data-test="roster-board">${sorted.map((trip, i) => tripRow(trip, i, view, augment)).join('')}</div>
    ${rosterFootnote(hasMiniChains)}
  </section>
  <script>
  (function(){
    var input = document.getElementById('roster-filter');
    var board = document.getElementById('roster-board');
    if (!input || !board) return;
    input.addEventListener('input', function(){
      var q = (input.value || '').trim().toLowerCase();
      board.querySelectorAll('[data-roster-name]').forEach(function(row){
        var name = row.getAttribute('data-roster-name') || '';
        row.style.display = !q || name.indexOf(q) !== -1 ? '' : 'none';
      });
    });
  })();
  </script>
</main>`;
}

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
