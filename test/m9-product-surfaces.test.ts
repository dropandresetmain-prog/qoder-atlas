/**
 * M9 — focused product surface renderer tests.
 * Hand-built v2 views; assert truthful strings without scenario fixture names.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  IncidentProgrammeView,
  OperatorOverview,
  ProgrammeSchedule,
  RecoveryCaseView,
  TravellerTripView,
} from '../src/contracts/v2/product/readModels.ts';
import type { BilateralProgrammeTimeSwapPreview } from '../src/app/target/programmeTimeSwapPreview.ts';
import { adaptOperatorOverviewToDashboard } from '../src/app/target/adapters/operatorOverviewAdapter.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';
import { renderProductIncidentProgramme } from '../src/ui/screens/product-incident-programme.ts';
import { renderProductTravellerTrip } from '../src/ui/screens/product-traveller-trip.ts';
import { renderProductProgrammePreview } from '../src/ui/screens/product-programme-preview.ts';
import { renderProductProgrammeSchedule } from '../src/ui/screens/product-programme-schedule.ts';
import { programmeItemCommandRef } from '../src/ui/programme-time-swap-controller.ts';

const generatedAt = '2031-09-15T08:00:00.000Z';

const changeAwareness = {
  projectionRevision: 1,
  changedVisibleRefs: ['item-1'],
  changedEdgeIds: [],
  currentSemanticState: 'AFFECTED' as const,
};

const ldg = {
  scope: 'DASHBOARD' as const,
  nodes: [],
  edges: [],
  change: changeAwareness,
};

function fivePersonOverview(): OperatorOverview {
  return {
    generatedAt,
    summary: { ready: 1, atRisk: 1, disrupted: 1, recovering: 1, unknown: 1 },
    items: [
      { tripRef: 'trip-1', travellerLabel: 'Traveller one', status: 'READY', remainderViability: 'VIABLE', affectedPeople: [], affectedItems: [], decisionRequired: false, unresolvedUncertainty: [] },
      { tripRef: 'trip-2', travellerLabel: 'Traveller two', status: 'AT_RISK', remainderViability: 'AT_RISK', affectedPeople: [], affectedItems: [], decisionRequired: false, unresolvedUncertainty: [] },
      { tripRef: 'trip-3', travellerLabel: 'Traveller three', status: 'DISRUPTED', remainderViability: 'NOT_VIABLE', affectedPeople: [], affectedItems: [], decisionRequired: true, unresolvedUncertainty: ['Timing unconfirmed'] },
      { tripRef: 'trip-4', travellerLabel: 'Traveller four', status: 'RECOVERING', remainderViability: 'AT_RISK', affectedPeople: [], affectedItems: [], decisionRequired: false, unresolvedUncertainty: [] },
      { tripRef: 'trip-5', travellerLabel: 'Traveller five', status: 'UNKNOWN', remainderViability: 'UNKNOWN', affectedPeople: [], affectedItems: [], decisionRequired: false, unresolvedUncertainty: [] },
    ],
    population: [],
    populationSummary: { total: 0, ready: 0, atRisk: 0, disrupted: 0, recovering: 0, unknown: 0, notAssessed: 0 },
    populationAssessmentLifecycle: { state: 'SETTLED', pendingCount: 0 },
    ldg,
    change: changeAwareness,
  };
}

function recoveryCaseView(): RecoveryCaseView {
  return {
    generatedAt,
    caseRef: 'case-1',
    causalPath: [],
    status: 'EXECUTING',
    changeSummary: 'A booked service changed and recovery is under way.',
    subjectLabels: {},
    bookingServiceState: { label: 'Transport booking', state: 'AFFECTED', detail: 'Replacement confirmed' },
    tripViability: { label: 'Remaining trip', verdict: 'FAIL', detail: 'Commitment still at risk' },
    affectedItems: ['booking-1'],
    strategies: [],
    authorityState: 'Approved',
    executionState: 'Partial',
    reconciliationState: 'Reconciling',
    uncertainty: ['Displaced cancellation outcome unknown'],
    connectionProgression: 'EXECUTING_COORDINATED_RECOVERY',
    recoveryActions: [
      {
        actionRef: 'act-book',
        domain: 'stay',
        capability: 'hotel.book',
        subjectRefs: ['stay-new'],
        authorityState: 'granted',
        dependencyOrder: 0,
        dependsOnActionRefs: [],
        uncertainty: [],
        executionState: 'COMPLETED',
        observationResult: 'CONFIRMED',
      },
      {
        actionRef: 'act-cancel',
        domain: 'stay',
        capability: 'hotel.cancel',
        subjectRefs: ['stay-old'],
        authorityState: 'granted',
        dependencyOrder: 1,
        dependsOnActionRefs: ['act-book'],
        uncertainty: ['Cancellation outcome unknown'],
        executionState: 'FAILED',
        observationResult: 'OUTCOME_UNKNOWN',
      },
    ],
    partialRecovery: { succeeded: ['act-book'], failed: ['act-cancel'], pending: [] },
    attention: [],
    duplicateBookingExposure: [
      {
        replacementActionRef: 'act-book',
        displacedSubjectRef: 'stay-old',
        replacementObservation: 'CONFIRMED',
        displacedCancellationObservation: 'OUTCOME_UNKNOWN',
        detail: 'Both stays may be active until cancellation is confirmed.',
      },
    ],
    remainingRecoveryWork: ['Complete displaced stay cancellation'],
    ldg: { ...ldg, scope: 'FOCUSED_CASE' },
    change: changeAwareness,
  };
}

function incidentProgrammeView(): IncidentProgrammeView {
  return {
    generatedAt,
    incidentRef: 'incident-1',
    sourceChangeSummary: 'Shared supplier change affected multiple travellers.',
    affectedSet: Array.from({ length: 5 }, (_, i) => ({
      personLabel: `Traveller ${i + 1}`,
      tripRef: `trip-${i + 1}`,
      outcome: i === 2 ? ('FAIL' as const) : ('PASS' as const),
      remainderViability: i === 2 ? ('NOT_VIABLE' as const) : ('VIABLE' as const),
    })),
    programmeCommitments: [
      { itemRef: 'commit-1', label: 'Opening session', windowLabel: '09:00–10:00', state: 'AFFECTED' },
      { itemRef: 'commit-2', label: 'Workshop block', windowLabel: '14:00–16:00', state: 'HEALTHY' },
    ],
    currentProgrammeState: 'Original schedule holds for most commitments.',
    proposedProgrammeState: 'Shift workshop block after transport recovery completes.',
    ldg: { ...ldg, scope: 'INCIDENT_PROGRAMME' },
    change: changeAwareness,
  };
}

function travellerTripView(): TravellerTripView {
  return {
    generatedAt,
    tripRef: 'trip-1',
    amIOkay: 'UNKNOWN',
    whatChanged: 'Your transport booking changed.',
    whatMattersNow: 'Protect your next commitment.',
    whatNorthstarIsDoing: 'Checking recovery options.',
    whatDoYouNeedFromMe: 'No action needed yet.',
    doesTheRestWork: 'AT_RISK',
    change: changeAwareness,
  };
}

function programmePreview(): BilateralProgrammeTimeSwapPreview {
  const windowA = { start: '2031-09-15T09:00:00.000Z', end: '2031-09-15T10:00:00.000Z' };
  const windowB = { start: '2031-09-15T14:00:00.000Z', end: '2031-09-15T15:00:00.000Z' };
  return {
    mutatesAuthoritativeState: false,
    current: {
      itemA: { itemRef: 'item-a', title: 'Morning slot', window: windowA, participantTravellerRef: 'trav-a', participantLabel: 'Participant A' },
      itemB: { itemRef: 'item-b', title: 'Afternoon slot', window: windowB, participantTravellerRef: 'trav-b', participantLabel: 'Participant B' },
      projections: [
        { travellerRef: 'trav-a', personLabel: 'Participant A', itemRef: 'item-a', verdict: 'PASS' },
        { travellerRef: 'trav-b', personLabel: 'Participant B', itemRef: 'item-b', verdict: 'PASS' },
      ],
    },
    proposed: {
      itemA: { itemRef: 'item-a', title: 'Morning slot', window: windowB, participantTravellerRef: 'trav-a', participantLabel: 'Participant A' },
      itemB: { itemRef: 'item-b', title: 'Afternoon slot', window: windowA, participantTravellerRef: 'trav-b', participantLabel: 'Participant B' },
      projections: [
        { travellerRef: 'trav-a', personLabel: 'Participant A', itemRef: 'item-a', verdict: 'PASS' },
        { travellerRef: 'trav-b', personLabel: 'Participant B', itemRef: 'item-b', verdict: 'FAIL', detail: 'Arrival readiness not met' },
      ],
    },
    bothPartiesProjectedViable: false,
    othersRemainViable: true,
    previewAccepted: false,
  };
}

function programmeSchedule(): ProgrammeSchedule {
  return {
    generatedAt,
    eventTitle: 'Synthetic programme',
    populationSummary: { total: 3, withJourney: 3, withoutJourney: 0, ready: 1, disrupted: 1, unknown: 1 },
    travellers: [
      { travellerRef: 'TRAVELLER:trav-a', label: 'Traveller A', journeyRefs: ['journey-a'], caseRefs: [], status: 'READY', assessmentStatus: 'CURRENT' },
      { travellerRef: 'TRAVELLER:trav-b', label: 'Traveller B', journeyRefs: ['journey-b'], caseRefs: ['case-b'], status: 'DISRUPTED', assessmentStatus: 'CURRENT' },
      { travellerRef: 'TRAVELLER:trav-c', label: 'Traveller C', journeyRefs: ['journey-c'], caseRefs: [], status: 'UNKNOWN', assessmentStatus: 'STALE', missingInformation: ['The readiness check needs refreshing.'] },
    ],
    endangeredCommitments: [{
      commitmentRef: 'PROGRAMME_ITEM:item-b',
      label: 'Afternoon session',
      reason: 'One or more current readiness checks show this commitment is endangered.',
      affectedTravellerRefs: ['TRAVELLER:trav-b'],
      affectedTravellerLabels: ['Traveller B'],
      caseRefs: ['case-b'],
    }],
    missingInformation: [{ travellerRef: 'TRAVELLER:trav-c', label: 'Traveller C', reason: 'The readiness check needs refreshing.' }],
    items: [
      {
        itemRef: 'PROGRAMME_ITEM:item-a', label: 'Morning session', itemType: 'SESSION', lifecycleStatus: 'SCHEDULED',
        requiredParticipants: 2, optionalParticipants: 0, requiresPhysicalPresence: true,
        windowStart: '2031-09-15T09:00:00.000Z', windowEnd: '2031-09-15T10:00:00.000Z',
      },
      {
        itemRef: 'PROGRAMME_ITEM:item-b', label: 'Afternoon session', itemType: 'SESSION', lifecycleStatus: 'SCHEDULED',
        requiredParticipants: 2, optionalParticipants: 1, requiresPhysicalPresence: true,
        windowStart: '2031-09-15T14:00:00.000Z', windowEnd: '2031-09-15T15:00:00.000Z',
      },
      {
        itemRef: 'PROGRAMME_ITEM:item-c', label: 'Time to be set', itemType: 'SESSION', lifecycleStatus: 'PLANNED',
        requiredParticipants: 1, optionalParticipants: 0, requiresPhysicalPresence: false,
      },
    ],
  };
}

describe('M9 product surface renderers', () => {
  test('operator overview adapter surfaces five travellers and summary buckets', () => {
    const view = fivePersonOverview();
    const surface = adaptOperatorOverviewToDashboard(view);
    const html = renderProductOperatorOverview(view);

    assert.equal(surface.title, 'Operations overview');
    assert.match(surface.summaryHtml, /tile-count">1</);
    assert.match(surface.itemsHtml, /Traveller five/);
    assert.match(html, /product-operator-overview/);
    assert.match(html, /5 participants/);
    assert.match(html, /Decision required/);
    assert.doesNotMatch(html, /Sarah|Daniel|airport/i);
  });

  test('recovery case keeps booking state separate from trip FAIL and shows duplicate exposure', () => {
    const html = renderProductRecoveryCase(recoveryCaseView());

    // R4 Case IA: plain-language hierarchy; technical dump stays progressive.
    assert.match(html, /data-test="product-recovery-case"/);
    assert.match(html, /data-test="back-to-overview"/);
    assert.match(html, /data-test="focused-case-graph-section"/);
    assert.match(html, /data-test="technical-details"/);
    assert.match(html, /Recovery under way|Applying the approved recovery|EXECUTING/);
    assert.doesNotMatch(html, /Sarah|Daniel|airport/i);
    // Raw lifecycle enums must not dominate primary copy; technical details may hold them.
    const primary = html.slice(0, html.indexOf('data-test="technical-details"'));
    assert.doesNotMatch(primary, /AWAITING_AUTHORITY|EVALUATED/);
  });

  test('incident programme shows five affected travellers and programme state compare', () => {
    const html = renderProductIncidentProgramme(incidentProgrammeView());

    assert.match(html, /Affected travellers/);
    assert.match(html, /Traveller 5/);
    assert.match(html, />FAIL</);
    assert.match(html, />PASS</);
    assert.match(html, /Current programme/);
    assert.match(html, /Proposed programme/);
    assert.match(html, /Opening session/);
    assert.doesNotMatch(html, /Sarah|Daniel|airport/i);
  });

  test('traveller trip answers viability and change questions plainly', () => {
    const html = renderProductTravellerTrip(travellerTripView());

    assert.match(html, /Still checking|You are okay|You need attention/);
    assert.match(html, /What Northstar is doing/);
    assert.match(html, /May be affected|Looks good|Does not work yet/);
    assert.match(html, /Protect your next commitment/);
    assert.doesNotMatch(html, /Sarah|Daniel|airport/i);
  });

  test('programme preview emphasises non-mutation and shows PASS vs FAIL', () => {
    const html = renderProductProgrammePreview(programmePreview());

    assert.match(html, /does not change authoritative programme state/i);
    assert.match(html, /mutatesAuthoritativeState: false/);
    assert.match(html, />PASS</);
    assert.match(html, />FAIL</);
    assert.match(html, /Preview only/);
    assert.match(html, /Current/);
    assert.match(html, /Proposed/);
    assert.doesNotMatch(html, /Sarah|Daniel|airport/i);
  });

  test('programme schedule offers a truthful bilateral time-swap preview for eligible items', () => {
    const html = renderProductProgrammeSchedule(programmeSchedule());

    assert.match(html, /data-test="programme-time-swap"/);
    assert.match(html, /data-programme-item-a/);
    assert.match(html, /data-programme-item-b/);
    assert.match(html, /value="PROGRAMME_ITEM:item-a"/);
    assert.match(html, /value="PROGRAMME_ITEM:item-b"/);
    assert.doesNotMatch(html, /value="PROGRAMME_ITEM:item-c"/);
    assert.match(html, /api\/v2\/programme\/time-swap\/preview\?format=html/);
    assert.match(html, /See how exchanging these session times would affect attendees/i);
    assert.match(html, /Your programme was not changed/);
  });

  test('programme schedule keeps population context, deduplicates endangered commitments, and links real people and cases', () => {
    const html = renderProductProgrammeSchedule(programmeSchedule());

    assert.match(html, /3 people · 3 journeys recorded · 0 without a journey record/);
    assert.match(html, /data-test="programme-roster"/);
    assert.match(html, /data-programme-traveller-search/);
    assert.match(html, /href="\/traveller\?trip=journey-a"/);
    assert.match(html, /href="\/operator\/cases\/case-b"/);
    assert.equal((html.match(/data-test="programme-endangered-item"/g) ?? []).length, 1);
    assert.match(html, /Missing traveller information/);
    assert.match(html, /The readiness check needs refreshing/);
  });

  test('programme item refs are normalized for the command while raw ids remain valid', () => {
    assert.equal(programmeItemCommandRef('PROGRAMME_ITEM:item-a'), 'item-a');
    assert.equal(programmeItemCommandRef('item-b'), 'item-b');
  });
});

describe('M9 operator surfaces consume the single semantic boundary', () => {
  test('operator overview never claims an evaluation lifecycle the read model did not supply', () => {
    const model = adaptOperatorOverviewToDashboard(fivePersonOverview());
    const html = `${model.summaryHtml}${model.itemsHtml}`;
    // UNKNOWN viability is not "still checking"; AT_RISK is not "may be affected".
    assert.doesNotMatch(html, /Still checking|May be affected/);
    assert.match(html, /Viability unknown/);
    assert.match(html, />At risk</);
  });

  test('operator overview queue never draws RECOVERING as a confirmed check', () => {
    const { itemsHtml } = adaptOperatorOverviewToDashboard(fivePersonOverview());
    const glyphFor = (tripRef: string): string => {
      const row = itemsHtml.slice(itemsHtml.indexOf(`data-trip-ref="${tripRef}"`));
      const match = /q-glyph ([a-z-]+)" aria-hidden="true">([^<]+)</.exec(row);
      assert.ok(match, `glyph for ${tripRef}`);
      return `${match[1]} ${match[2]}`;
    };
    assert.equal(glyphFor('trip-1'), 'g-ok ✓');
    assert.equal(glyphFor('trip-2'), 'g-warn ▲');
    assert.equal(glyphFor('trip-3'), 'g-bad ✕');
    assert.equal(glyphFor('trip-4'), 'g-active …');
    assert.equal(glyphFor('trip-5'), 'g-unk ?');
  });

  test('incident programme commitment dots keep UNKNOWN and ACTIVE out of brass', () => {
    const view = incidentProgrammeView();
    const states = ['HEALTHY', 'CHANGED', 'AFFECTED', 'FAILED', 'PROPOSED', 'ACTIVE', 'UNKNOWN', 'RECOVERED'] as const;
    const html = renderProductIncidentProgramme({
      ...view,
      programmeCommitments: states.map((state) => ({ itemRef: `commit-${state}`, label: state, state })),
    });
    const expected: Record<(typeof states)[number], string> = {
      HEALTHY: 'd-ok', CHANGED: 'd-watch', AFFECTED: 'd-watch', FAILED: 'd-bad',
      PROPOSED: 'd-watch', ACTIVE: 'd-active', UNKNOWN: 'd-unconfirmed', RECOVERED: 'd-ok',
    };
    for (const state of states) {
      const item = html.slice(html.indexOf(`data-item-ref="commit-${state}"`));
      assert.ok(item.includes(`<span class="dot ${expected[state]}">`) && item.indexOf(`<span class="dot ${expected[state]}">`) < item.indexOf('</div>'),
        `commitment dot for ${state}`);
    }
    assert.doesNotMatch(html, /Still checking|May be affected/);
  });
});
