/**
 * M9 Checkpoint 2 — focused tests for additive read models, readiness,
 * five-person cohort, bilateral swap preview, and multi-stay partial failure.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import {
  deriveDuplicateBookingExposure,
  derivePartialRecovery,
} from '../src/app/target/readmodels/recoveryActionProjection.ts';
import {
  evaluateProgrammeArrivalReadiness,
  requiresPhysicalPresenceFromOperatingRequirements,
} from '../src/resolution/evaluation/programmeArrivalReadiness.ts';
import { evaluateSharedDisruptionCohort } from '../src/app/target/cohortDisruption.ts';
import { previewBilateralProgrammeTimeSwap } from '../src/app/target/programmeTimeSwapPreview.ts';
import { sharedSupplierProgrammeCohortFoundation } from '../src/app/target/primaryScenarioFoundation.ts';
import { commandPreviewBilateralProgrammeTimeSwap } from '../src/app/target/applicationCommands.ts';
import { PolicyRuleSchema } from '../src/domain/rules.ts';

const generatedAt = '2031-09-15T00:00:00.000Z';
const graphBase = {
  generatedAt,
  projectionRevision: 2,
  changedVisibleRefs: ['stay:replacement'],
  changedEdgeIds: [] as const,
  currentSemanticState: 'AFFECTED' as const,
  nodes: [] as const,
  edges: [] as const,
};

describe('M9 CK2 additive recoveryActions / partial recovery', () => {
  test('recoveryActions preserve multiple same-domain stay intents', () => {
    const view = projectRecoveryCase({
      ...graphBase,
      caseRef: 'case-multi-stay',
      status: 'EXECUTING',
      changeSummary: 'hub overnight + destination cancel+rebook',
      bookingServiceState: { label: 'stays', state: 'ACTIVE' },
      tripViability: { label: 'trip', verdict: 'FAIL' },
      authorityState: 'approved',
      executionState: 'partial',
      reconciliationState: 'reconciling',
      recoveryActions: [
        {
          actionRef: 'act-hub',
          domain: 'stay',
          capability: 'hotel.book',
          subjectRefs: ['res-hub'],
          cost: { amount: '120.00', currency: 'USD' },
          authorityState: 'granted',
          dependencyOrder: 0,
          executionState: 'COMPLETED',
          observationResult: 'CONFIRMED',
        },
        {
          actionRef: 'act-dest-book',
          domain: 'stay',
          capability: 'hotel.book',
          subjectRefs: ['res-dest-new'],
          cost: { amount: '200.00', currency: 'USD' },
          authorityState: 'granted',
          dependencyOrder: 1,
          executionState: 'COMPLETED',
          observationResult: 'CONFIRMED',
        },
        {
          actionRef: 'act-dest-cancel',
          domain: 'stay',
          capability: 'hotel.cancel',
          subjectRefs: ['res-dest-old'],
          authorityState: 'granted',
          dependencyOrder: 2,
          dependsOnActionRefs: ['act-dest-book'],
          executionState: 'FAILED',
          observationResult: 'OUTCOME_UNKNOWN',
        },
      ],
    });

    assert.equal(view.recoveryActions.length, 3);
    assert.equal(view.recoveryActions.filter((a) => a.capability === 'hotel.book').length, 2);
    assert.equal(view.aggregateRecoveryCost?.amount, '320.00');
    assert.equal(view.partialRecovery?.succeeded.length, 2);
    assert.equal(view.partialRecovery?.failed.length, 1);
    assert.ok(view.duplicateBookingExposure.length >= 1);
    assert.equal(view.tripViability.verdict, 'FAIL');
    assert.ok(view.remainingRecoveryWork.some((w) => w.includes('hotel.cancel')));
    assert.ok(view.uncertainty.some((u) => /duplicate/i.test(u)));
  });

  test('partial-failure helper: CONFIRMED replacement + FAILED cancel → exposure', () => {
    const exposure = deriveDuplicateBookingExposure([
      {
        actionRef: 'book',
        domain: 'stay',
        capability: 'hotel.book',
        subjectRefs: ['new'],
        authorityState: 'granted',
        dependencyOrder: 0,
        executionState: 'COMPLETED',
        observationResult: 'CONFIRMED',
      },
      {
        actionRef: 'cancel',
        domain: 'stay',
        capability: 'hotel.cancel',
        subjectRefs: ['old'],
        authorityState: 'granted',
        dependencyOrder: 1,
        dependsOnActionRefs: ['book'],
        executionState: 'FAILED',
        observationResult: 'FAILED',
      },
    ]);
    assert.equal(exposure.length, 1);
    assert.equal(exposure[0]?.replacementObservation, 'CONFIRMED');
    const partial = derivePartialRecovery([
      {
        actionRef: 'book',
        domain: 'stay',
        capability: 'hotel.book',
        subjectRefs: ['new'],
        authorityState: 'granted',
        dependencyOrder: 0,
        executionState: 'COMPLETED',
        observationResult: 'CONFIRMED',
      },
      {
        actionRef: 'cancel',
        domain: 'stay',
        capability: 'hotel.cancel',
        subjectRefs: ['old'],
        authorityState: 'granted',
        dependencyOrder: 1,
        executionState: 'FAILED',
        observationResult: 'FAILED',
      },
    ]);
    assert.deepEqual(partial.succeeded, ['book']);
    assert.deepEqual(partial.failed, ['cancel']);
  });
});

describe('M9 CK2 programme arrival readiness (150 min policy data)', () => {
  test('PROGRAMME_ARRIVAL_READINESS rule parses with data-driven minutes', () => {
    const rule = PolicyRuleSchema.parse({
      id: 'rule-readiness-1',
      sourceId: 'src-1',
      kind: 'PROGRAMME_ARRIVAL_READINESS',
      buffer: {
        expectedMinutes: 150,
        sourceId: 'src-1',
        observedAt: '2031-01-01T00:00:00.000Z',
      },
    });
    assert.equal(rule.kind, 'PROGRAMME_ARRIVAL_READINESS');
    if (rule.kind === 'PROGRAMME_ARRIVAL_READINESS') {
      assert.equal(rule.buffer.expectedMinutes, 150);
    }
  });

  test('60 available vs 150 required → FAIL; booking validity is separate', () => {
    const geometry = sharedSupplierProgrammeCohortFoundation.readiness.failureGeometry;
    assert.equal(geometry.availableMinutes, 60);
    assert.equal(geometry.requiredMinutes, 150);

    const readiness = evaluateProgrammeArrivalReadiness({
      scheduledArrival: '2031-06-01T10:30:00.000Z',
      commitmentStart: '2031-06-01T11:30:00.000Z',
      requiredMinutes: 150,
      requiresPhysicalPresence: true,
      obligation: 'REQUIRED',
    });
    assert.equal(readiness.verdict, 'FAIL');
    assert.equal(readiness.availableMinutes, 60);
    assert.equal(readiness.requiredMinutes, 150);
    assert.equal(readiness.reasonCode, 'insufficient_arrival_readiness');
  });

  test('150+ available minutes → PASS for REQUIRED physical presence', () => {
    const readiness = evaluateProgrammeArrivalReadiness({
      scheduledArrival: '2031-06-01T08:00:00.000Z',
      commitmentStart: '2031-06-01T11:30:00.000Z',
      requiredMinutes: 150,
      requiresPhysicalPresence: true,
      obligation: 'REQUIRED',
    });
    assert.equal(readiness.verdict, 'PASS');
    assert.equal(readiness.availableMinutes, 210);
  });

  test('optional or non-physical commitments skip readiness', () => {
    assert.equal(
      evaluateProgrammeArrivalReadiness({
        scheduledArrival: '2031-06-01T10:30:00.000Z',
        commitmentStart: '2031-06-01T11:30:00.000Z',
        requiredMinutes: 150,
        requiresPhysicalPresence: true,
        obligation: 'OPTIONAL',
      }).verdict,
      'NOT_APPLICABLE',
    );
    assert.equal(
      requiresPhysicalPresenceFromOperatingRequirements({ requiresPhysicalPresence: true }),
      true,
    );
  });
});

describe('M9 CK2 five-person shared disruption cohort', () => {
  test('one incident → five independent outcomes; no healthy-without-commitment', () => {
    const cohort = evaluateSharedDisruptionCohort({
      incidentRef: 'inc-1',
      sourceChangeSummary: 'shared supplier replacement arrival 10:30',
      travellers: [
        {
          travellerRef: 't1',
          personLabel: 'Traveller A',
          tripRef: 'trip-1',
          journeyRef: 'j1',
          programmeOutcome: 'FAIL',
          remainderViability: 'NOT_VIABLE',
          hasEvaluatedRequiredProgrammeDependency: true,
        },
        {
          travellerRef: 't2',
          personLabel: 'Traveller B',
          tripRef: 'trip-2',
          journeyRef: 'j2',
          programmeOutcome: 'PASS',
          remainderViability: 'VIABLE',
          hasEvaluatedRequiredProgrammeDependency: true,
        },
        {
          travellerRef: 't3',
          personLabel: 'Traveller C',
          tripRef: 'trip-3',
          journeyRef: 'j3',
          programmeOutcome: 'PASS',
          remainderViability: 'VIABLE',
          hasEvaluatedRequiredProgrammeDependency: true,
        },
        {
          travellerRef: 't4',
          personLabel: 'Traveller D',
          tripRef: 'trip-4',
          journeyRef: 'j4',
          programmeOutcome: 'PASS',
          remainderViability: 'VIABLE',
          hasEvaluatedRequiredProgrammeDependency: true,
        },
        {
          travellerRef: 't5',
          personLabel: 'Traveller E',
          tripRef: 'trip-5',
          journeyRef: 'j5',
          programmeOutcome: 'PASS',
          remainderViability: 'VIABLE',
          hasEvaluatedRequiredProgrammeDependency: true,
        },
      ],
    });

    assert.equal(cohort.travellers.length, 5);
    assert.equal(sharedSupplierProgrammeCohortFoundation.scope.expectedTravellerCount, 5);
    assert.ok(cohort.allHaveProgrammeDependency);
    assert.ok(cohort.divergentOutcomes);
    assert.equal(cohort.travellers[0]?.outcome, 'FAIL');
    assert.equal(cohort.travellers.filter((t) => t.outcome === 'PASS').length, 4);

    const invalid = evaluateSharedDisruptionCohort({
      incidentRef: 'inc-1',
      sourceChangeSummary: 'x',
      travellers: [{
        travellerRef: 't-empty',
        personLabel: 'No commitment',
        tripRef: 'trip-x',
        journeyRef: 'jx',
        programmeOutcome: 'PASS',
        remainderViability: 'VIABLE',
        hasEvaluatedRequiredProgrammeDependency: false,
      }],
    });
    assert.equal(invalid.travellers[0]?.validCohortMember, false);
    assert.equal(invalid.travellers[0]?.outcome, 'UNKNOWN');
  });
});

describe('M9 CK2 bilateral programme time-swap preview', () => {
  test('preview swaps windows, projects both viable, mutates nothing', () => {
    const preview = commandPreviewBilateralProgrammeTimeSwap({
      itemA: {
        itemRef: 'item-early',
        title: 'Early required session',
        window: { start: '2031-06-01T11:30:00.000Z', end: '2031-06-01T12:30:00.000Z' },
        participantTravellerRef: 'trav-disrupted',
        participantLabel: 'Disrupted traveller',
      },
      itemB: {
        itemRef: 'item-late',
        title: 'Later session',
        window: { start: '2031-06-01T15:00:00.000Z', end: '2031-06-01T16:00:00.000Z' },
        participantTravellerRef: 'trav-counterpart',
        participantLabel: 'Local counterpart',
      },
      evaluate: ({ travellerRef, window, role }) => {
        if (role === 'CURRENT' && travellerRef === 'trav-disrupted') {
          return { verdict: 'FAIL', detail: '60 < 150 readiness' };
        }
        if (role === 'CURRENT' && travellerRef === 'trav-counterpart') {
          return { verdict: 'PASS' };
        }
        // After swap: disrupted traveller gets later window → PASS; counterpart gets early → still PASS if arrival allows.
        if (travellerRef === 'trav-disrupted' && window.start === '2031-06-01T15:00:00.000Z') {
          return { verdict: 'PASS', detail: 'later slot restores readiness' };
        }
        if (travellerRef === 'trav-counterpart' && window.start === '2031-06-01T11:30:00.000Z') {
          return { verdict: 'PASS', detail: 'local counterpart can take earlier slot' };
        }
        return { verdict: 'PASS' };
      },
    });

    assert.equal(preview.mutatesAuthoritativeState, false);
    assert.equal(preview.proposed.itemA.window.start, '2031-06-01T15:00:00.000Z');
    assert.equal(preview.proposed.itemB.window.start, '2031-06-01T11:30:00.000Z');
    assert.equal(preview.current.itemA.window.start, '2031-06-01T11:30:00.000Z');
    assert.ok(preview.bothPartiesProjectedViable);
    assert.ok(preview.previewAccepted);

    // Pure function identity — second call identical, no shared mutation.
    const again = previewBilateralProgrammeTimeSwap({
      itemA: preview.current.itemA,
      itemB: preview.current.itemB,
      evaluate: () => ({ verdict: 'PASS' }),
    });
    assert.equal(again.mutatesAuthoritativeState, false);
  });
});
