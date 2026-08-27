/**
 * E2 — operator dashboard: the opening/demo hero surface.
 *
 * R3D: managed-travel presentation collapses to four buckets; fleet sorts by
 * earliest upcoming commitment; roster paginates 10 rows with attention sort.
 */
import type {
  OperatorDashboardView,
  OperatorDecisionRequest,
  OperatorTripView,
  ReadModelEnvelope,
} from '../../contracts/readmodels.ts';
import type { IsoDateTime } from '../../domain/common.ts';
import type { ChainLinkView } from '../case-view-model.ts';
import {
  OVERVIEW_ROSTER_PAGE_SIZE,
  compareByAttentionThenId,
  compareByEarliestCommitment,
  countManagedTravelBuckets,
  fleetCellClassFor,
  mapManagedTravelPresentation,
  MANAGED_TRAVEL_LABEL,
  type ManagedTravelPresentationInput,
} from '../presentationState.ts';
import { escapeHtml, formatInstant, formatMoney, formatRosterTime, formatShort, encodeUri } from '../html.ts';
import { errorPanel, loadingPanel, miniChainRow, statusBadge } from '../components.ts';

export interface OperatorDashboardAugmentations {
  chainFor?: (trip: OperatorTripView) => readonly ChainLinkView[] | undefined;
  roleFor?: (trip: OperatorTripView) => string | undefined;
  /** Earliest upcoming commitment instant for fleet ordering (presentation only). */
  earliestCommitmentAtFor?: (trip: OperatorTripView) => IsoDateTime | undefined;
  programmeHref?: string;
  demoReset?: { action: string; label: string };
}

function presentationInput(trip: OperatorTripView): ManagedTravelPresentationInput {
  return {
    status: trip.status,
    ...(trip.travelArrangement ? { travelArrangement: trip.travelArrangement } : {}),
    pendingDecisionCount: trip.pendingDecisions.length,
    ...(trip.travellerResponseStatus ? { travellerResponseStatus: trip.travellerResponseStatus } : {}),
  };
}

function fleetCellClass(trip: OperatorTripView): string {
  return fleetCellClassFor(presentationInput(trip));
}

function sortFleetByCommitment(
  trips: readonly OperatorTripView[],
  augment: OperatorDashboardAugmentations,
): OperatorTripView[] {
  return [...trips].sort((a, b) =>
    compareByEarliestCommitment(
      { tripId: a.tripId, earliestCommitmentAt: augment.earliestCommitmentAtFor?.(a) },
      { tripId: b.tripId, earliestCommitmentAt: augment.earliestCommitmentAtFor?.(b) },
    ),
  );
}

function sortRosterByAttention(trips: readonly OperatorTripView[]): OperatorTripView[] {
  return [...trips].sort((a, b) =>
    compareByAttentionThenId(
      { tripId: a.tripId, ...presentationInput(a) },
      { tripId: b.tripId, ...presentationInput(b) },
    ),
  );
}

function readoutBlock(view: OperatorDashboardView): string {
  const counts = view.arrangementCounts;
  const managedTotal = counts.northstarArranged;
  const buckets = countManagedTravelBuckets(view.trips.map(presentationInput));
  const confirmed = buckets.confirmed;
  const segments = [
    buckets.needsAttention > 0
      ? `<span class="seg-bad">${buckets.needsAttention} needs attention</span>`
      : '',
    buckets.watching > 0 ? `<span class="seg-warn">${buckets.watching} watching</span>` : '',
    buckets.unconfirmed > 0
      ? `<span class="seg-dim">${buckets.unconfirmed} unconfirmed</span>`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const context = `${counts.northstarArranged} Northstar-managed · ${counts.selfOrOtherArranged} local/self · ${counts.total} participants`;
  return `
    <div class="readout-ink">
      <p class="ri-label">Managed travel readiness</p>
      <div class="big big-settle">${confirmed}<span class="unit">/${managedTotal}</span></div>
      <p class="ri-confirmed-word">Confirmed</p>
      <p class="sub ri-scale">${escapeHtml(context)}</p>
      ${segments ? `<p class="sub" data-test="managed-presentation-segments">${segments}</p>` : ''}
    </div>`;
}

function fleetGrid(view: OperatorDashboardView, augment: OperatorDashboardAugmentations): string {
  const sorted = sortFleetByCommitment(view.trips, augment);
  const cells = sorted
    .map((trip, i) => {
      const bucket = fleetCellClass(trip);
      const presentation =
        trip.travelArrangement === 'SELF_OR_OTHER_ARRANGED'
          ? 'Local / self-arranged'
          : MANAGED_TRAVEL_LABEL[mapManagedTravelPresentation(presentationInput(trip))];
      const label = `${trip.label ?? trip.tripId} — ${presentation}`;
      return `<i class="${bucket}" style="--i:${i}" data-fleet-trip="${escapeHtml(trip.tripId)}" data-fleet-status="${escapeHtml(trip.status)}" data-fleet-presentation="${escapeHtml(trip.travelArrangement === 'SELF_OR_OTHER_ARRANGED' ? 'LOCAL' : mapManagedTravelPresentation(presentationInput(trip)))}" title="${escapeHtml(label)}"></i>`;
    })
    .join('');
  return `
    <div class="readout-fleet">
      <div class="fc-head"><span class="fc-title">Fleet · ${view.trips.length} participants</span><span class="fc-live">Live</span></div>
      <div class="dotgrid" role="img" aria-label="All participants at a glance, ordered by earliest upcoming commitment" data-test="fleet-grid" data-fleet-count="${view.trips.length}">${cells}</div>
      <div class="legend" data-test="fleet-legend">
        <span><i class="l-ok"></i>Confirmed</span>
        <span><i class="l-bad"></i>Needs Attention</span>
        <span><i class="l-watch"></i>Watching</span>
        <span><i class="l-unconfirmed"></i>Unconfirmed</span>
        <span><i class="l-local"></i>Local / self-arranged</span>
      </div>
    </div>`;
}

interface AttentionRow {
  trip: OperatorTripView;
  caseId: string;
  description: string;
  tone: 'approval' | 'attention' | 'traveller';
  amount?: OperatorDecisionRequest['amount'];
  requestedAt?: OperatorDecisionRequest['requestedAt'];
}

function collectAttentionRows(view: OperatorDashboardView): AttentionRow[] {
  const rows: AttentionRow[] = [];
  const seenCases = new Set<string>();

  for (const trip of view.trips) {
    for (const decision of trip.pendingDecisions) {
      seenCases.add(decision.caseId);
      rows.push({
        trip,
        caseId: decision.caseId,
        description: decision.description,
        tone: decision.decisionType === 'APPROVAL' ? 'approval' : 'traveller',
        ...(decision.amount ? { amount: decision.amount } : {}),
        ...(decision.requestedAt ? { requestedAt: decision.requestedAt } : {}),
      });
    }
  }

  // Surface critical/impacted trips with open cases even before an approval ask
  // exists — otherwise organisers must search to find them.
  for (const trip of sortRosterByAttention(view.trips)) {
    if (!trip.activeCaseId || seenCases.has(trip.activeCaseId)) continue;
    const presentation = mapManagedTravelPresentation(presentationInput(trip));
    if (presentation !== 'NEEDS_ATTENTION' && trip.status !== 'DISRUPTED') continue;
    seenCases.add(trip.activeCaseId);
    rows.push({
      trip,
      caseId: trip.activeCaseId,
      description:
        trip.whatChanged ??
        'Trip is impacted and needs Northstar recovery attention.',
      tone: 'attention',
      requestedAt: trip.updatedAt,
    });
  }

  return rows;
}

function sanitizeOverviewCopy(text: string): string {
  return text
    .replace(/\bel-trip-[a-z0-9-]+/gi, 'linked engagement')
    .replace(/\btrip-[a-z0-9-]+/gi, 'trip')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:+.-]+/g, (iso) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
      if (!match) return iso;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} · ${match[4]}:${match[5]}`;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function attentionRow(row: AttentionRow, index: number): string {
  const glyph = row.tone === 'approval' ? '!' : row.tone === 'traveller' ? '?' : '✕';
  const glyphClass = row.tone === 'approval' ? 'g-bad' : row.tone === 'traveller' ? 'g-warn' : 'g-bad';
  const amount = row.amount ? ` · ${escapeHtml(formatMoney(row.amount))}` : '';
  const when = row.requestedAt ? formatShort(row.requestedAt) : 'timing unconfirmed';
  const name =
    row.trip.travellerNames.length > 0
      ? row.trip.travellerNames.join(', ')
      : (row.trip.label ?? 'Linked participant');
  return `
  <a href="/operator/cases/${encodeUri(row.caseId)}" class="qrow" style="--i:${Math.min(index, 13)}" data-case-id="${escapeHtml(row.caseId)}" data-attention-tone="${escapeHtml(row.tone)}" data-test="decision-link">
    <span class="q-glyph ${glyphClass}" aria-hidden="true">${glyph}</span>
    <span class="q-name">${escapeHtml(name)}</span>
    <span class="q-issue">${escapeHtml(sanitizeOverviewCopy(row.description))}${amount}</span>
    <span class="q-time">${escapeHtml(when)}</span>
  </a>`;
}

function attentionPanel(rows: AttentionRow[]): string {
  if (rows.length === 0) return '';

  const scheduleChange = /airline changed the flight schedule/i;
  const shared = rows.filter((row) => scheduleChange.test(row.description));
  const rest = rows.filter((row) => !scheduleChange.test(row.description));

  const sharedBlock =
    shared.length >= 2
      ? (() => {
          const critical = shared.filter((row) => {
            const presentation = mapManagedTravelPresentation(presentationInput(row.trip));
            return presentation === 'NEEDS_ATTENTION' || row.trip.status === 'DISRUPTED';
          });
          const viableOrWatching = shared.length - critical.length;
          const header = `
  <div class="qrow qrow-group" data-test="shared-incident-group" data-attention-tone="attention">
    <span class="q-glyph g-bad" aria-hidden="true">✕</span>
    <span class="q-name">Shared airline change</span>
    <span class="q-issue">One airline change · ${shared.length} different trip consequences · ${viableOrWatching} still workable · ${critical.length} critical</span>
    <span class="q-time"></span>
  </div>`;
          const children = shared
            .map((row, index) => {
              const presentation = mapManagedTravelPresentation(presentationInput(row.trip));
              const outcome =
                presentation === 'NEEDS_ATTENTION' || row.trip.status === 'DISRUPTED'
                  ? 'Critical — travel cannot protect the commitment'
                  : presentation === 'WATCHING'
                    ? 'Watching — schedule changed; trip still workable'
                    : 'Viable after the same airline change';
              return attentionRow(
                {
                  ...row,
                  description: outcome,
                },
                index,
              );
            })
            .join('');
          return `${header}${children}`;
        })()
      : shared.map((row, index) => attentionRow(row, index)).join('');

  const otherRows = rest.map((row, index) => attentionRow(row, index + shared.length)).join('');

  return `
  <section class="section" aria-label="Needs attention" data-test="attention-queue">
    <h2>Needs attention <span class="count c-alert">${rows.length}</span></h2>
    <div class="queue stagger" data-ui-section="pending-decisions">${sharedBlock}${otherRows}</div>
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
  const raw = trip.whatChanged || trip.resolutionSummary;
  if (raw) {
    return escapeHtml(sanitizeOverviewCopy(raw));
  }
  const bucket = mapManagedTravelPresentation(presentationInput(trip));
  return escapeHtml(MANAGED_TRAVEL_LABEL[bucket]);
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
  const caseId = trip.activeCaseId ?? trip.historyCaseId;
  const caseHref = caseId
    ? `/operator/cases/${encodeUri(caseId)}`
    : `/traveller?trip=${encodeUri(trip.tripId)}`;
  const rowTag = caseId ? 'a' : 'div';
  const rowAttrs = caseId
    ? `href="${escapeHtml(caseHref)}" class="brow brow-actionable" data-test="${trip.activeCaseId ? 'case-row-link' : 'case-history-link'}"`
    : `class="brow"`;
  const showInteraction = `<a href="/traveller?trip=${encodeUri(trip.tripId)}" class="btn btn-ghost btn-sm" data-test="show-interaction">Show interaction</a>`;
  const presentation = mapManagedTravelPresentation(presentationInput(trip));
  return `
  <${rowTag} ${rowAttrs} style="--i:${Math.min(index, 13)}" data-trip-id="${escapeHtml(trip.tripId)}" data-status="${escapeHtml(trip.status)}" data-presentation="${escapeHtml(presentation)}" data-roster-name="${escapeHtml(name.toLowerCase())}">
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
    ? `<br>Row marks — ✈ flight · ⇄ ground · ⌂ stay · ✦ commitment. Colour shows state: confirmed · proposed · at risk · impacted · not booked · unconfirmed.`
    : '';
  return `<p class="footnote">Statuses update when the underlying bookings are confirmed, not when a message is sent.${legend}</p>`;
}

function rosterPaginationControls(): string {
  return `
  <div class="roster-pagination" data-test="roster-pagination" hidden>
    <button type="button" class="btn btn-ghost btn-sm" data-roster-prev data-test="roster-prev">Previous</button>
    <span class="roster-page-label" data-roster-page-label data-test="roster-page-label"></span>
    <button type="button" class="btn btn-ghost btn-sm" data-roster-next data-test="roster-next">Next</button>
  </div>`;
}

function rosterClientScript(pageSize: number): string {
  return `
  <script>
  (function(){
    var input = document.getElementById('roster-filter');
    var board = document.getElementById('roster-board');
    var pagination = document.querySelector('[data-test="roster-pagination"]');
    var prev = document.querySelector('[data-roster-prev]');
    var next = document.querySelector('[data-roster-next]');
    var label = document.querySelector('[data-roster-page-label]');
    if (!board) return;
    var pageSize = ${pageSize};
    var page = 0;
    var participantTotalAttr = board.getAttribute('data-participant-total');
    var participantTotal = participantTotalAttr ? Number(participantTotalAttr) : NaN;

    function visibleRows() {
      var q = input ? (input.value || '').trim().toLowerCase() : '';
      return Array.prototype.slice.call(board.querySelectorAll('[data-roster-name]')).filter(function(row){
        var name = row.getAttribute('data-roster-name') || '';
        var match = !q || name.indexOf(q) !== -1;
        row.setAttribute('data-roster-match', match ? '1' : '0');
        return match;
      });
    }

    function render() {
      var matched = visibleRows();
      var pages = Math.max(1, Math.ceil(matched.length / pageSize));
      if (page >= pages) page = pages - 1;
      if (page < 0) page = 0;
      var start = page * pageSize;
      var end = start + pageSize;
      Array.prototype.slice.call(board.querySelectorAll('[data-roster-name]')).forEach(function(row){
        var match = row.getAttribute('data-roster-match') === '1';
        var idx = matched.indexOf(row);
        var onPage = match && idx >= start && idx < end;
        row.style.display = onPage ? '' : 'none';
      });
      if (pagination) {
        pagination.hidden = matched.length <= pageSize;
        var countLabel = (!qFilter() && Number.isFinite(participantTotal) && participantTotal > 0)
          ? participantTotal
          : matched.length;
        if (label) label.textContent = 'Page ' + (page + 1) + ' of ' + pages + ' · ' + countLabel + ' participants';
        if (prev) prev.disabled = page <= 0;
        if (next) next.disabled = page >= pages - 1;
      }
    }

    function qFilter() {
      return input ? (input.value || '').trim().length > 0 : false;
    }

    if (input) input.addEventListener('input', function(){ page = 0; render(); });
    if (prev) prev.addEventListener('click', function(){ page -= 1; render(); });
    if (next) next.addEventListener('click', function(){ page += 1; render(); });
    render();
  })();
  </script>`;
}

export function renderOperatorDashboardBody(
  view: OperatorDashboardView,
  augment: OperatorDashboardAugmentations = {},
): string {
  const rosterSorted = sortRosterByAttention(view.trips);
  const hasMiniChains = rosterSorted.some((trip) => (augment.chainFor?.(trip)?.length ?? 0) > 0);
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
    <p class="sub">Managed travel readiness across the programme — urgent work stays in the list below.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
    ${demoReset}
  </div>
  <div class="readout">
${readoutBlock(view)}
${fleetGrid(view, augment)}
  </div>
  ${attentionPanel(collectAttentionRows(view))}
  <section class="section" aria-label="Trips">
    <h2>All participants <span class="count">${view.arrangementCounts.total || view.trips.length}</span>${rosterLink}</h2>
    ${rosterSearchField()}
    <div class="board stagger" id="roster-board" data-test="roster-board" data-page-size="${OVERVIEW_ROSTER_PAGE_SIZE}" data-participant-total="${view.arrangementCounts.total}">${rosterSorted.map((trip, i) => tripRow(trip, i, view, augment)).join('')}</div>
    ${rosterPaginationControls()}
    ${rosterFootnote(hasMiniChains)}
  </section>
  ${rosterClientScript(OVERVIEW_ROSTER_PAGE_SIZE)}
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

