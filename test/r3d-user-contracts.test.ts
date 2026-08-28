/**
 * R3D — human-approved live product presentation contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareByEarliestCommitment,
  countManagedTravelBuckets,
  fleetCellClassFor,
  mapManagedTravelPresentation,
  OVERVIEW_ROSTER_PAGE_SIZE,
  ACTIVITY_PAGE_SIZE,
  CASE_PRIMARY_OPTION_LIMIT,
  MANAGED_TRAVEL_LABEL,
} from '../src/ui/presentationState.ts';
import { renderOperatorDashboardBody } from '../src/ui/screens/operator-dashboard.ts';
import { renderProgrammeBody } from '../src/ui/screens/operator-programme.ts';
import { renderCaseDetailBody } from '../src/ui/screens/operator-case.ts';
import { renderActivityBody } from '../src/ui/screens/operator-activity.ts';
import { renderTravellerTripBody } from '../src/ui/screens/traveller.ts';
import { renderPage } from '../src/ui/page.ts';
import { presentActivity, presentActivityActor, sanitizeActivityCopy } from '../src/app/presentation.ts';
import { earliestUpcomingCommitmentAt } from '../src/app/operatorPresentation.ts';
import { THEME_CSS } from '../src/ui/theme.ts';
import { renderProgrammeChangeEnhancementScript } from '../src/ui/programme-change-interaction.ts';
import type { OperatorDashboardView, ProgrammeView, TravellerTripView } from '../src/contracts/readmodels.ts';
import type { CaseDetailView } from '../src/ui/case-view-model.ts';
import type { ActivityPageView } from '../src/ui/operator-surfaces-view-model.ts';
import type { Trip } from '../src/domain/trip.ts';

const AT = '2026-09-21T09:00:00+08:00';

function overviewFixture(): OperatorDashboardView {
  return {
    generatedAt: AT,
    summary: { ready: 30, atRisk: 2, disrupted: 4, recovering: 3, awaitingDecision: 2, managedConfirmed: 28 },
    arrangementCounts: { total: 67, northstarArranged: 42, selfOrOtherArranged: 25, unspecified: 0 },
    trips: Array.from({ length: 67 }, (_, i) => ({
      tripId: `trip-${String(i).padStart(2, '0')}`,
      travellerNames: [`Traveller ${i}`],
      status: i < 28 ? 'READY' : i < 32 ? 'DISRUPTED' : i < 36 ? 'AT_RISK' : i < 40 ? 'UNKNOWN' : i < 42 ? 'RECOVERING' : 'READY',
      travelArrangement: i < 42 ? 'NORTHSTAR_ARRANGED' : 'SELF_OR_OTHER_ARRANGED',
      affectedItems: [],
      systemActivity: [],
      pendingDecisions:
        i === 30
          ? [{ caseId: 'case-30', decisionType: 'APPROVAL' as const, description: 'Approve rebooking' }]
          : [],
      uncertainties: [],
      updatedAt: AT,
      ...(i === 31 ? { travellerResponseStatus: 'AWAITING' as const } : {}),
      ...(i < 5 ? { activeCaseId: `case-${i}` } : {}),
    })),
  };
}

test('presentation mapping collapses managed travel into four buckets', () => {
  assert.equal(mapManagedTravelPresentation({ status: 'READY' }), 'CONFIRMED');
  assert.equal(mapManagedTravelPresentation({ status: 'RESOLVED' }), 'CONFIRMED');
  assert.equal(mapManagedTravelPresentation({ status: 'DISRUPTED' }), 'NEEDS_ATTENTION');
  assert.equal(
    mapManagedTravelPresentation({ status: 'READY', pendingDecisionCount: 1 }),
    'NEEDS_ATTENTION',
  );
  assert.equal(
    mapManagedTravelPresentation({ status: 'AT_RISK', travellerResponseStatus: 'AWAITING' }),
    'NEEDS_ATTENTION',
  );
  assert.equal(mapManagedTravelPresentation({ status: 'NEEDS_TRAVELLER_INFO' }), 'NEEDS_ATTENTION');
  assert.equal(mapManagedTravelPresentation({ status: 'AT_RISK' }), 'WATCHING');
  assert.equal(mapManagedTravelPresentation({ status: 'RECOVERING' }), 'WATCHING');
  assert.equal(mapManagedTravelPresentation({ status: 'PLANNING' }), 'WATCHING');
  assert.equal(mapManagedTravelPresentation({ status: 'UNKNOWN' }), 'UNCONFIRMED');
  assert.deepEqual(Object.values(MANAGED_TRAVEL_LABEL).sort(), [
    'Confirmed',
    'Needs Attention',
    'Unconfirmed',
    'Watching',
  ]);
});

test('fleet Local cohort is distinct from Unconfirmed filled-grey treatment', () => {
  assert.equal(
    fleetCellClassFor({ status: 'UNKNOWN', travelArrangement: 'SELF_OR_OTHER_ARRANGED' }),
    'd-local',
  );
  assert.equal(fleetCellClassFor({ status: 'UNKNOWN' }), 'd-unconfirmed');
  assert.match(THEME_CSS, /\.dotgrid i\.d-unconfirmed \{ background: var\(--neutral-f\); \}/);
  assert.match(THEME_CSS, /\.dotgrid i::before \{ content: none; display: none; \}/);
  assert.doesNotMatch(THEME_CSS, /\.dotgrid i\.d-unconfirmed \{[^}]*border:/);
});

test('fleet ordering uses earliest upcoming commitment with missing last', () => {
  const ordered = [
    { tripId: 'b', earliestCommitmentAt: '2026-09-22T10:00:00+08:00' },
    { tripId: 'a', earliestCommitmentAt: '2026-09-22T09:00:00+08:00' },
    { tripId: 'z' },
    { tripId: 'm', earliestCommitmentAt: '2026-09-22T09:00:00+08:00' },
  ].sort(compareByEarliestCommitment);
  assert.deepEqual(
    ordered.map((row) => row.tripId),
    ['a', 'm', 'b', 'z'],
  );

  const trip = {
    id: 'trip-x',
    elements: [
      {
        elementKind: 'ENGAGEMENT',
        data: { startsAt: { value: '2026-09-20T08:00:00+08:00' } },
      },
      {
        elementKind: 'ENGAGEMENT',
        data: { startsAt: { value: '2026-09-22T11:00:00+08:00' } },
      },
    ],
  } as unknown as Trip;
  assert.equal(earliestUpcomingCommitmentAt(trip, AT), '2026-09-22T11:00:00+08:00');
  assert.equal(earliestUpcomingCommitmentAt(trip, '2026-09-23T00:00:00+08:00'), undefined);
});

test('overview attention queue surfaces disrupted open cases without requiring search', () => {
  const view = overviewFixture();
  const sarah = view.trips.find((trip) => trip.tripId === 'trip-04');
  assert.ok(sarah);
  sarah.status = 'DISRUPTED';
  sarah.travellerNames = ['Sarah Lim'];
  sarah.activeCaseId = 'case-sarah';
  sarah.whatChanged = 'Airline moved the inbound arrival past the headline slot.';
  sarah.pendingDecisions = [];
  const html = renderOperatorDashboardBody(view);
  assert.match(html, /data-test="attention-queue"/);
  assert.match(html, /Sarah Lim/);
  assert.match(html, /data-case-id="case-sarah"/);
  assert.match(html, /Needs attention/);
});

test('overview contracts: 67/42/25, four labels, fleet, pagination, case-first', () => {
  const view = overviewFixture();
  const buckets = countManagedTravelBuckets(
    view.trips.map((trip) => ({
      status: trip.status,
      travelArrangement: trip.travelArrangement,
      pendingDecisionCount: trip.pendingDecisions.length,
      travellerResponseStatus: trip.travellerResponseStatus,
    })),
  );
  assert.equal(buckets.confirmed + buckets.needsAttention + buckets.watching + buckets.unconfirmed, 42);

  const html = renderOperatorDashboardBody(view, {
    earliestCommitmentAtFor: (trip) => {
      const n = Number(trip.tripId.split('-')[1]);
      return Number.isFinite(n) ? `2026-09-2${String(n % 10)}T10:00:00+08:00` : undefined;
    },
  });
  assert.match(html, /42 Northstar-managed · 25 local\/self · 67 participants/);
  assert.equal((html.match(/data-fleet-trip=/g) ?? []).length, 67);
  assert.match(html, /data-page-size="10"/);
  assert.equal(OVERVIEW_ROSTER_PAGE_SIZE, 10);
  for (const label of ['Confirmed', 'Needs Attention', 'Watching', 'Unconfirmed']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Local \/ self-arranged/);
  assert.doesNotMatch(html, /data-fleet-presentation="RECOVERY/);
  assert.match(html, /data-test="case-row-link"/);
  assert.match(html, /data-test="show-interaction"/);
  assert.match(html, /data-fleet-presentation="UNCONFIRMED"/);
  assert.match(html, /class="d-unconfirmed"/);
});

test('programme summary uses simplified buckets without arithmetic contradiction', () => {
  const view: ProgrammeView = {
    generatedAt: AT,
    anchorEventId: 'evt-1',
    anchorEventName: 'Innovation Summit',
    summary: {
      total: 67,
      ready: 28,
      planning: 2,
      needsTravellerInfo: 1,
      changeRequested: 1,
      atRisk: 4,
      disrupted: 4,
      recovering: 2,
      awaitingDecision: 1,
      resolved: 0,
      unknown: 0,
    },
    arrangementCounts: { total: 67, northstarArranged: 42, selfOrOtherArranged: 25, unspecified: 0 },
    travellers: [
      ...Array.from({ length: 42 }, (_, i) => ({
        tripId: `trip-${i}`,
        travellerId: `trav-${i}`,
        travellerName: `Person ${i}`,
        status: (i < 28
          ? 'READY'
          : i < 32
            ? 'DISRUPTED'
            : i < 36
              ? 'AT_RISK'
              : i < 40
                ? 'UNKNOWN'
                : 'RECOVERING') as ProgrammeView['travellers'][number]['status'],
        activeCaseIds: i < 3 ? [`case-${i}`] : [],
        decisionsRequired: 0,
        uncertainties: [],
        updatedAt: AT,
        travelArrangement: 'NORTHSTAR_ARRANGED' as const,
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        tripId: `local-${i}`,
        travellerId: `local-trav-${i}`,
        travellerName: `Local ${i}`,
        status: 'READY' as const,
        activeCaseIds: [] as string[],
        decisionsRequired: 0,
        uncertainties: [] as string[],
        updatedAt: AT,
        travelArrangement: 'SELF_OR_OTHER_ARRANGED' as const,
      })),
    ],
    endangeredCommitments: [],
    unresolvedUncertainties: [],
  };
  const html = renderProgrammeBody(view, {
    timeline: [
      {
        dateLabel: 'Tue 30 Sep',
        items: [{ key: 'c1', timeLabel: '09:00', title: 'Opening keynote', tone: 'ok' }],
      },
    ],
  });
  assert.match(html, /67 participants · 42 Northstar-managed · 25 local\/self/);
  assert.match(html, /data-summary-key="confirmed"/);
  assert.match(html, /data-summary-key="needs-attention"/);
  assert.match(html, /data-summary-key="watching"/);
  assert.match(html, /data-summary-key="unconfirmed"/);
  assert.match(html, /data-summary-key="local"/);
  // Local READY rows must not inflate Confirmed beyond managed travellers.
  assert.match(html, /data-summary-key="confirmed"[^>]*>[\s\S]*?<div class="tile-count">28<\/div>/);
  assert.match(html, /data-summary-key="local"[^>]*>[\s\S]*?<div class="tile-count">25<\/div>/);
  assert.doesNotMatch(html, /data-summary-key="in-recovery"/);
  assert.doesNotMatch(html, /data-summary-key="being-planned"/);
  assert.match(html, /data-test="programme-case-link"/);
  assert.match(html, /data-timeline-key="c1"/);
  assert.equal((html.match(/data-timeline-key="c1"/g) ?? []).length, 1);
});

test('case selected recovery stages one recommendation with alternatives disclosure', () => {
  const options = Array.from({ length: 6 }, (_, i) => ({
    id: `opt-${i}`,
    title: `Option ${i}`,
    summary: `Summary ${i}`,
    verdict: i === 5 ? ('NOT_VIABLE' as const) : ('VIABLE' as const),
    recommended: i === 0,
    ...(i === 5 ? { rejectionReason: 'Does not meet arrival buffer' } : {}),
  }));
  const view: CaseDetailView = {
    caseId: 'case-1',
    tripId: 'trip-1',
    travellerNames: ['Jordan'],
    status: 'RECOVERING',
    whatChanged: 'Inbound flight cancelled',
    affectedItems: ['Arrival', 'Hotel'],
    checks: [],
    options,
    approval: {
      requestedFrom: 'ORGANISATION',
      state: 'PENDING',
      reason: 'Organisation must approve the recovery.',
      approver: { entityType: 'ORGANISATION', id: 'org-1' },
    },
    actions: [],
    uncertainties: [],
    updatedAt: AT,
  };
  const html = renderCaseDetailBody(view);
  // Impact-first contract: once authority is staged, exactly one selected
  // recovery leads; every alternative stays reachable in the disclosure.
  assert.equal(CASE_PRIMARY_OPTION_LIMIT, 3);
  assert.match(html, /data-options-mode="awaiting_authority"/);
  assert.match(html, /data-primary-option-count="1"/);
  assert.match(html, /data-test="primary-options"/);
  assert.match(html, /data-test="more-options"/);
  assert.match(html, /Other options considered/);
  assert.match(html, /Recommended/);
  assert.equal((html.match(/data-test="strategy-option"/g) ?? []).length, 6);
  assert.match(html, /Does not meet arrival buffer/);
});

test('activity paginates 20 and never surfaces raw Providers actor', () => {
  assert.equal(ACTIVITY_PAGE_SIZE, 20);
  assert.equal(presentActivityActor('Providers'), 'Travel provider');
  assert.equal(presentActivityActor('app:signal'), 'Northstar');
  const view: ActivityPageView = {
    generatedAt: AT,
    days: [
      {
        label: 'Today',
        items: Array.from({ length: 25 }, (_, i) => ({
          who: i === 0 ? 'Travel provider' : 'Northstar',
          text: `Event ${i}`,
          time: '09:00',
          tone: 'work' as const,
          glyph: '·',
        })),
      },
    ],
  };
  const html = renderActivityBody(view);
  assert.match(html, /data-page-size="20"/);
  assert.match(html, /data-test="activity-pagination"/);
  assert.doesNotMatch(html, />Providers</);
  const bodyOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  assert.equal((bodyOnly.match(/data-activity-row/g) ?? []).length, 25);
});

test('traveller choice cards only when a decision is required', () => {
  const withChoice: TravellerTripView = {
    tripId: 'trip-1',
    status: 'DISRUPTED',
    whatChanged: 'Flight cancelled',
    actionsInProgress: [],
    inputRequested: [
      {
        caseId: 'case-1',
        prompt: 'Which option works for you?',
        options: ['Morning flight', 'Evening flight'],
      },
    ],
    remainderViable: 'AT_RISK',
    updatedAt: AT,
  };
  const withoutChoice: TravellerTripView = {
    tripId: 'trip-2',
    status: 'READY',
    actionsInProgress: [],
    inputRequested: [],
    remainderViable: 'VIABLE',
    updatedAt: AT,
  };
  assert.match(renderTravellerTripBody(withChoice), /choice-form/);
  assert.doesNotMatch(renderTravellerTripBody(withoutChoice), /choice-form/);
  assert.doesNotMatch(renderTravellerTripBody(withoutChoice), /optcard/);
});

test('programme-change script renders Now vs Proposed preview contract without native confirm', () => {
  const script = renderProgrammeChangeEnhancementScript();
  assert.match(script, /now-vs-proposed/);
  assert.match(script, /Now/);
  assert.match(script, /Proposed/);
  assert.match(script, /change-preview/);
  assert.match(script, /change-commit/);
  assert.match(script, /data-programme-change-back/);
  assert.match(script, /data-programme-change-confirm/);
  assert.doesNotMatch(script, /window\.confirm/);
});

test('normal product pages omit demo banner; demo tooling may keep it', () => {
  const product = renderPage({ title: 'Overview', active: 'dashboard' }, '<main>ok</main>');
  assert.doesNotMatch(product, /class="demo-banner/);
  assert.doesNotMatch(product, /DEMO MODE/);
  const demo = renderPage(
    { title: 'Demo', active: 'dashboard', demoBanner: { adapterMode: 'REPLAY' } },
    '<main>demo</main>',
  );
  assert.match(demo, /class="demo-banner/);
});

test('case options-ready phase shows Begin, not a second Resolve', () => {
  const options = [
    {
      id: 'opt-0',
      title: 'Evening arrival',
      summary: 'Protects commitment',
      verdict: 'VIABLE' as const,
      recommended: true,
      whyRecommended: 'Keeps the commitment with the least disruption among workable options.',
      costDelta: { amount: 302, currency: 'SGD' },
      costAllocationSummary: '302 SGD payable by the traveller',
    },
    {
      id: 'opt-1',
      title: 'Morning arrival',
      summary: 'Tighter buffer',
      verdict: 'VIABLE' as const,
      costDelta: { amount: 180, currency: 'SGD' },
    },
    {
      id: 'opt-2',
      title: 'Saver via hub',
      summary: 'Misses commitment',
      verdict: 'NOT_VIABLE' as const,
      rejectionReason: 'Lands after the commitment starts',
    },
  ];
  const view: CaseDetailView = {
    caseId: 'case-1',
    tripId: 'trip-1',
    travellerNames: ['Jordan'],
    status: 'DISRUPTED',
    whatChanged: 'Inbound flight cancelled',
    affectedItems: ['Arrival'],
    checks: [],
    options,
    actions: [],
    uncertainties: [],
    updatedAt: AT,
    chain: [
      {
        id: 'leg-1',
        kind: 'Flight',
        label: 'SIN → NRT',
        state: 'BROKEN',
        linkType: 'FLIGHT',
      },
      {
        id: 'leg-2',
        kind: 'Transfer',
        label: 'Airport car',
        state: 'UNKNOWN',
        linkType: 'GROUND',
        detail: 'Pickup unconfirmed',
      },
    ],
  };
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-case-phase="options"/);
  assert.match(html, /data-test="begin-strategy-btn"/);
  assert.doesNotMatch(html, /data-test="resolve-northstar-btn"/);
  // Impact-first contract: option details stay staged behind Begin.
  assert.doesNotMatch(html, /data-case-options-panel/);
  assert.match(html, /Recovery options ready/);
  assert.match(html, />Impacted</);
  assert.doesNotMatch(html, />Broken</);
  assert.match(html, /Transfer confirmation pending/);
  assert.doesNotMatch(html, />Unknown</);
  assert.match(html, /Begin recovery/);
});

test('authority-required case renders human approve; traveller funding is explicit', () => {
  const view: CaseDetailView = {
    caseId: 'case-jonas',
    tripId: 'trip-jonas',
    travellerNames: ['Jonas'],
    status: 'RECOVERING',
    whatChanged: 'Personal hotel extension requested',
    affectedItems: ['Stay'],
    checks: [],
    options: [
      {
        id: 'opt-hotel',
        title: 'Extend stay one night',
        verdict: 'VIABLE',
        recommended: true,
        whyRecommended: 'Satisfies the extension with whole-trip viability.',
        costDelta: { amount: 302.32, currency: 'SGD' },
        costAllocationSummary: '302.32 SGD payable by the traveller',
      },
    ],
    actions: [],
    uncertainties: [],
    updatedAt: AT,
    approval: {
      requestedFrom: 'TRAVELLER',
      state: 'PENDING',
      reason: 'Traveller must confirm the self-funded extension.',
      amount: { amount: 302.32, currency: 'SGD' },
    },
    funding: {
      allocation: {
        incrementalAmount: { amount: 302.32, currency: 'SGD' },
        incrementalPayer: 'TRAVELLER',
        derivedFromRuleIds: ['rule-ait-funded-window'],
      },
      summary: '302.32 SGD payable by the traveller',
    },
    chain: [
      {
        id: 'stay-1',
        kind: 'Stay',
        label: 'Hotel · place-hotel-abc123xyz',
        state: 'PROPOSED',
        linkType: 'STAY',
      },
    ],
  };
  const html = renderCaseDetailBody(view);
  assert.match(html, /data-test="waiting-decision-block"/);
  assert.match(html, /data-test="funding-traveller-incremental"/);
  assert.match(html, /traveller pays|Traveller pays|payable by the traveller|Personal incremental cost/i);
  // Traveller decisions happen on the traveller surface; the operator side
  // shows the honest wait plus the handoff link (never a fake approve).
  assert.match(html, /data-test="waiting-for-traveller"/);
  assert.match(html, /data-test="open-traveller-surface"/);
  assert.match(html, /Hotel/);
  assert.doesNotMatch(html, /place-hotel-abc123xyz/);
});

test('case page script includes Resolve choreography contract', () => {
  const page = renderPage({ title: 'Recovery case', active: 'case' }, '<main data-case-workspace></main>');
  assert.match(page, /Planning a recovery/);
  assert.match(page, /Re-checking the trip/);
  assert.match(page, /ns-resolve/);
  assert.match(page, /prefers-reduced-motion/);
});

test('activity copy humanizes audit projection and strips internal ids', () => {
  assert.equal(
    presentActivity('SIGNAL_PROCESSED', { kind: 'FLIGHT_CANCELLATION' }),
    'reported a flight cancellation',
  );
  assert.equal(presentActivityActor('app:signal-pipeline'), 'Northstar');
  assert.equal(presentActivityActor('Providers'), 'Travel provider');
  assert.equal(
    presentActivityActor('provider', { providerId: 'NUITEE_HOTEL' }),
    'Hotel',
  );
  assert.equal(sanitizeActivityCopy('Stay at place-hotel-riverview confirmed'), 'Stay at Hotel confirmed');
  assert.equal(sanitizeActivityCopy('trip-abc123xyz'), undefined);

  const html = renderActivityBody({
    generatedAt: AT,
    days: [
      {
        label: 'Today · Tue 22 Sep',
        items: [
          {
            who: 'app:recovery-execution',
            text: 'SIGNAL_PROCESSED',
            sub: 'trip-leak-01',
            time: '09:02',
            tone: 'signal',
            glyph: '!',
          },
          {
            who: 'Kenji Mori',
            text: 'replacement return connection confirmed',
            sub: 'Hotel · place-hotel-abc123xyz',
            time: '08:55',
            tone: 'done',
            glyph: '✓',
          },
        ],
      },
      {
        label: 'Yesterday · Mon 21 Sep',
        items: [
          {
            who: 'Northstar',
            text: 'checked recovery options',
            time: '18:34',
            tone: 'work',
            glyph: '◆',
          },
        ],
      },
    ],
  });
  assert.match(html, /data-activity-day/);
  assert.ok(((html.match(/data-activity-day/g) ?? []).length) >= 2);
  assert.match(html, /Kenji Mori/);
  assert.match(html, /Northstar/);
  assert.doesNotMatch(html, /app:recovery-execution/);
  assert.doesNotMatch(html, /SIGNAL_PROCESSED/);
  assert.doesNotMatch(html, /trip-leak-01/);
  assert.doesNotMatch(html, /place-hotel-abc123xyz/);
  assert.match(html, /Hotel/);
});
