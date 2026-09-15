/**
 * M9 primary scenario vertical loop + Jordan progression / multi-stay proofs.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrimaryScenarioVerticalLoop } from '../src/app/target/primaryScenarioVerticalLoop.ts';
import {
  JORDAN_CONNECTION_PROGRESSION_PATH,
  mapConnectionProgression,
} from '../src/app/target/readmodels/mapConnectionProgression.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { sharedSupplierProgrammeCohortFoundation } from '../src/app/target/primaryScenarioFoundation.ts';
import { renderProductOperatorOverview } from '../src/ui/screens/product-operator-overview.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';
import { renderProductIncidentProgramme } from '../src/ui/screens/product-incident-programme.ts';
import { renderProductTravellerTrip } from '../src/ui/screens/product-traveller-trip.ts';
import { renderProductProgrammePreview } from '../src/ui/screens/product-programme-preview.ts';

const ARRIVAL = '2031-06-01T10:30:00.000Z';
const EARLY = '2031-06-01T11:30:00.000Z';
const LATE = '2031-06-01T15:00:00.000Z';
const REQUIRED = sharedSupplierProgrammeCohortFoundation.readiness.defaultRequiredMinutes;

describe('M9 primary scenario vertical loop (generic)', () => {
  test('five travellers: one readiness FAIL, four PASS; swap preview; surfaces render', () => {
    const members = [
      {
        travellerRef: 'trav-1',
        personLabel: 'Traveller One',
        tripRef: 'trip-1',
        journeyRef: 'journey-1',
        commitmentStart: EARLY,
        scheduledArrival: ARRIVAL,
        requiresPhysicalPresence: true,
        obligation: 'REQUIRED' as const,
        requiredReadinessMinutes: REQUIRED,
      },
      ...[2, 3, 4, 5].map((n) => ({
        travellerRef: `trav-${n}`,
        personLabel: `Traveller ${n}`,
        tripRef: `trip-${n}`,
        journeyRef: `journey-${n}`,
        commitmentStart: LATE,
        scheduledArrival: ARRIVAL,
        requiresPhysicalPresence: true,
        obligation: 'REQUIRED' as const,
        requiredReadinessMinutes: REQUIRED,
      })),
    ];

    const result = runPrimaryScenarioVerticalLoop({
      incidentRef: 'incident-shared-1',
      members,
      swap: {
        itemA: {
          itemRef: 'item-early',
          title: 'Early required commitment',
          window: { start: EARLY, end: '2031-06-01T12:30:00.000Z' },
          participantTravellerRef: 'trav-1',
          participantLabel: 'Traveller One',
        },
        itemB: {
          itemRef: 'item-late',
          title: 'Later counterpart commitment',
          window: { start: LATE, end: '2031-06-01T16:00:00.000Z' },
          participantTravellerRef: 'trav-local',
          participantLabel: 'Local counterpart',
        },
      },
    });

    assert.equal(result.foundationKind, 'shared_supplier_programme_cohort_disruption');
    assert.equal(result.cohort.travellers.length, 5);
    assert.ok(result.cohort.allHaveProgrammeDependency);
    assert.ok(result.cohort.divergentOutcomes);
    assert.equal(result.readiness.filter((r) => r.verdict === 'FAIL').length, 1);
    assert.equal(result.readiness.filter((r) => r.verdict === 'PASS').length, 4);
    assert.equal(result.readiness[0]?.availableMinutes, 60);
    assert.equal(result.readiness[0]?.requiredMinutes, 150);

    assert.equal(result.disruptedMemberBookingConfirmed, true);
    assert.equal(result.recoveryCasePreview.bookingServiceState.state, 'RECOVERED');
    assert.equal(result.recoveryCasePreview.tripViability.verdict, 'FAIL');
    assert.equal(result.preview.mutatesAuthoritativeState, false);
    assert.ok(result.preview.bothPartiesProjectedViable);
    assert.ok(result.preview.previewAccepted);

    assert.equal(result.incidentView.affectedSet.length, 5);
    assert.equal(result.operatorOverview.items.length, 5);
    assert.equal(result.travellerView.amIOkay, 'NO');

    const htmlCase = renderProductRecoveryCase(result.recoveryCasePreview);
    assert.match(htmlCase, /Whole-trip|trip viability|Journey viability/i);
    assert.match(renderProductOperatorOverview(result.operatorOverview), /Traveller/);
    assert.match(renderProductIncidentProgramme(result.incidentView), /Traveller One/);
    assert.match(renderProductTravellerTrip(result.travellerView), /programme/i);
    assert.match(renderProductProgrammePreview(result.preview), /does not change authoritative/i);

    assert.ok(result.pendingFixtureFields.includes('Fable visual direction (polish only)'));
    assert.equal(result.pendingFixtureFields.length, 1);
    assert.ok(!JSON.stringify(result).includes('Sarah'));
    assert.ok(!JSON.stringify(result).includes('Daniel'));
  });
});

describe('M9 Jordan connection progression + multi-stay unresolved', () => {
  test('SAFE → AT_RISK → IMPOSSIBLE path is mapped generically', () => {
    assert.equal(mapConnectionProgression({ viability: 'VIABLE' }), 'CONNECTION_SAFE');
    assert.equal(mapConnectionProgression({ viability: 'TIGHT' }), 'CONNECTION_AT_RISK');
    assert.equal(mapConnectionProgression({ viability: 'IMPOSSIBLE' }), 'CONNECTION_IMPOSSIBLE');
    assert.ok(JORDAN_CONNECTION_PROGRESSION_PATH.includes('CONNECTION_AT_RISK'));
    assert.ok(JORDAN_CONNECTION_PROGRESSION_PATH.includes('CONNECTION_IMPOSSIBLE'));
  });

  test('partial multi-stay failure keeps case unresolved', () => {
    const view = projectRecoveryCase({
      generatedAt: '2031-09-01T00:00:00.000Z',
      projectionRevision: 3,
      changedVisibleRefs: ['act-dest-cancel'],
      currentSemanticState: 'AFFECTED',
      nodes: [],
      edges: [],
      caseRef: 'case-jordan',
      status: 'EXECUTING',
      changeSummary: 'multi-stay coordinated recovery',
      bookingServiceState: { label: 'destination replacement', state: 'RECOVERED' },
      tripViability: { label: 'whole trip', verdict: 'FAIL' },
      authorityState: 'approved',
      executionState: 'partial',
      reconciliationState: 'reconciling',
      connectionProgression: 'STILL_UNRESOLVED',
      recoveryActions: [
        {
          actionRef: 'hub',
          domain: 'stay',
          capability: 'hotel.book',
          subjectRefs: ['hub-stay'],
          authorityState: 'granted',
          dependencyOrder: 0,
          executionState: 'COMPLETED',
          observationResult: 'CONFIRMED',
        },
        {
          actionRef: 'dest-book',
          domain: 'stay',
          capability: 'hotel.book',
          subjectRefs: ['dest-new'],
          authorityState: 'granted',
          dependencyOrder: 1,
          executionState: 'COMPLETED',
          observationResult: 'CONFIRMED',
        },
        {
          actionRef: 'dest-cancel',
          domain: 'stay',
          capability: 'hotel.cancel',
          subjectRefs: ['dest-old'],
          authorityState: 'granted',
          dependencyOrder: 2,
          dependsOnActionRefs: ['dest-book'],
          executionState: 'FAILED',
          observationResult: 'OUTCOME_UNKNOWN',
        },
      ],
    });
    assert.equal(view.status, 'EXECUTING');
    assert.equal(view.tripViability.verdict, 'FAIL');
    assert.ok(view.duplicateBookingExposure.length >= 1);
    assert.equal(view.connectionProgression, 'STILL_UNRESOLVED');
    assert.equal(view.recoveryActions.filter((a) => a.domain === 'stay').length, 3);
  });
});
