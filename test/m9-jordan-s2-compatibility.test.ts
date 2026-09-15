/**
 * M9 Jordan S2 — Checkpoint 1 read-model compatibility audit.
 *
 * Verdict: Jordan S2 compatible — no CK1 reopening required.
 *
 * Progressive SAFE / AT_RISK / IMPOSSIBLE maps onto existing generic enums
 * (ProductOperationalStatus, RemainderViability, AssessmentTone, LdgSemanticState).
 * Do not invent a Jordan-only status field.
 *
 * Additive generic fields (multi-action / partial recovery) are recorded for
 * Checkpoint 2 start — see JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.
 * Do not build Jordan fixtures until Atlas + Nuitée evidence arrives.
 * Do not start Sarah Checkpoint 2 until Sarah product handoff arrives.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jordanS2ScenarioFoundation,
  JORDAN_S2_ACCEPTANCE_MULTI_STAY,
  JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS,
  JORDAN_S2_MULTI_STAY_AUDIT_VERDICT,
  JORDAN_S2_SCENARIO_KIND,
} from '../src/app/target/secondScenarioFoundation.ts';
import {
  ProductOperationalStatusSchema,
  RemainderViabilitySchema,
  AssessmentToneSchema,
  LdgSemanticStateSchema,
  LdgNodeKindSchema,
  RecoveryCaseViewSchema,
  TravellerTripViewSchema,
} from '../src/contracts/v2/product/readModels.ts';
import {
  ActionPlanSchema,
  validateActionPlanAcyclic,
} from '../src/contracts/v2/action/actionPlan.ts';

describe('M9 Jordan S2 read-model compatibility (CK1 audit)', () => {
  test('Jordan S2 compatible — no CK1 reopening required', () => {
    assert.equal(jordanS2ScenarioFoundation.kind, JORDAN_S2_SCENARIO_KIND);
    assert.equal(jordanS2ScenarioFoundation.signalOrigin, 'PROVIDER_PROGRESSIVE_DELAY');
    assert.equal(jordanS2ScenarioFoundation.scope.journeyCount, 1);
    assert.equal(jordanS2ScenarioFoundation.scope.programmeWideRecovery, false);
    assert.equal(jordanS2ScenarioFoundation.recovery.multiActionStrategy, true);
    assert.equal(jordanS2ScenarioFoundation.recovery.partialExecutionVisible, true);
    assert.equal(jordanS2ScenarioFoundation.recovery.providerSuccessDoesNotResolveCase, true);
    assert.equal(jordanS2ScenarioFoundation.recovery.multipleStayActionsPerStrategy, true);
    assert.equal(jordanS2ScenarioFoundation.productSurfaces.usesSharedReadModels, true);
    assert.equal(jordanS2ScenarioFoundation.productSurfaces.dedicatedHeroUi, false);
    assert.equal(jordanS2ScenarioFoundation.pendingEvidence.atlasFlightFacts, 'PENDING');
  });

  test('multi-stay Jordan requirement compatible — no CK1 reopen', () => {
    assert.equal(
      JORDAN_S2_MULTI_STAY_AUDIT_VERDICT,
      'multi-stay Jordan requirement compatible — no CK1 reopen.',
    );
    assert.equal(jordanS2ScenarioFoundation.recovery.cancelDisplacedAfterReplacementConfirmed, true);
    assert.equal(jordanS2ScenarioFoundation.recovery.duplicateStayExposureMustRemainVisible, true);

    // Domain ActionPlan already supports multiple stay intents + cancel-after-book deps.
    const plan = ActionPlanSchema.parse({
      id: 'plan-1',
      recoveryCaseId: 'case-1',
      scenarioChangeId: 'sc-1',
      intents: [
        {
          id: 'intent-hub-overnight',
          actionPlanId: 'plan-1',
          operationNamespace: 'stay',
          capabilityRef: 'hotel.book',
          subjectRefs: [{ kind: 'RESERVATION', id: 'hub-overnight-new' }],
          expectedObservations: ['CONFIRMED'],
          compensationPolicy: { supported: true, requiresSeparateAuthority: true },
          status: 'PROPOSED',
        },
        {
          id: 'intent-dest-book',
          actionPlanId: 'plan-1',
          operationNamespace: 'stay',
          capabilityRef: 'hotel.book',
          subjectRefs: [{ kind: 'RESERVATION', id: 'destination-replacement' }],
          costEstimate: { amount: '100.00', currency: 'USD' },
          expectedObservations: ['CONFIRMED'],
          compensationPolicy: { supported: true, requiresSeparateAuthority: true },
          status: 'PROPOSED',
        },
        {
          id: 'intent-dest-cancel',
          actionPlanId: 'plan-1',
          operationNamespace: 'stay',
          capabilityRef: 'hotel.cancel',
          subjectRefs: [{ kind: 'RESERVATION', id: 'destination-displaced' }],
          expectedObservations: ['CANCELLED'],
          compensationPolicy: { supported: false, requiresSeparateAuthority: true },
          status: 'PROPOSED',
        },
      ],
      dependencies: [
        { fromActionIntentId: 'intent-dest-book', toActionIntentId: 'intent-dest-cancel' },
      ],
    });
    assert.equal(plan.intents.filter((i) => i.capabilityRef.startsWith('hotel.')).length, 3);
    assert.equal(validateActionPlanAcyclic(plan).ok, true);

    // Singular bookingServiceState rollup must not be treated as hotel=recovered
    // when trip remains unresolved (duplicate / displaced cancel unknown).
    const partial = RecoveryCaseViewSchema.parse({
      generatedAt: '2031-09-01T00:00:00.000Z',
      caseRef: 'case-multi-stay',
      status: 'EXECUTING',
      changeSummary: 'hub overnight + destination cancel+rebook partial',
      bookingServiceState: {
        label: 'destination replacement',
        state: 'RECOVERED',
        detail: 'replacement CONFIRMED; displaced cancellation OUTCOME_UNKNOWN',
      },
      tripViability: {
        label: 'whole trip',
        verdict: 'FAIL',
        detail: 'duplicate stay exposure; displaced booking still active or uncertain',
      },
      affectedItems: ['hub overnight', 'destination stay'],
      strategies: [],
      authorityState: 'approved',
      executionState: 'partial',
      reconciliationState: 'reconciling',
      uncertainty: [
        'displaced destination cancellation OUTCOME_UNKNOWN',
        'potential duplicate-booking/cost exposure',
      ],
      ldg: {
        scope: 'FOCUSED_CASE',
        nodes: [],
        edges: [],
        change: {
          projectionRevision: 1,
          changedVisibleRefs: [],
          currentSemanticState: 'AFFECTED',
        },
      },
      change: {
        projectionRevision: 1,
        changedVisibleRefs: ['stay:replacement'],
        currentSemanticState: 'AFFECTED',
      },
    });
    assert.equal(partial.bookingServiceState.state, 'RECOVERED');
    assert.equal(partial.tripViability.verdict, 'FAIL');
    assert.equal(partial.status, 'EXECUTING');
    assert.ok(partial.uncertainty.some((u) => u.includes('duplicate')));
  });

  test('existing enums express SAFE / AT_RISK / IMPOSSIBLE without Jordan-only fields', () => {
    // SAFE
    assert.equal(ProductOperationalStatusSchema.parse('READY'), 'READY');
    assert.equal(RemainderViabilitySchema.parse('VIABLE'), 'VIABLE');
    assert.equal(AssessmentToneSchema.parse('PASS'), 'PASS');
    assert.equal(LdgSemanticStateSchema.parse('HEALTHY'), 'HEALTHY');
    // AT_RISK
    assert.equal(ProductOperationalStatusSchema.parse('AT_RISK'), 'AT_RISK');
    assert.equal(RemainderViabilitySchema.parse('AT_RISK'), 'AT_RISK');
    assert.equal(LdgSemanticStateSchema.parse('AFFECTED'), 'AFFECTED');
    // IMPOSSIBLE
    assert.equal(ProductOperationalStatusSchema.parse('DISRUPTED'), 'DISRUPTED');
    assert.equal(RemainderViabilitySchema.parse('NOT_VIABLE'), 'NOT_VIABLE');
    assert.equal(AssessmentToneSchema.parse('FAIL'), 'FAIL');
    assert.equal(LdgSemanticStateSchema.parse('FAILED'), 'FAILED');
  });

  test('LDG node kinds cover multi-domain blast radius without Jordan-specific graph', () => {
    for (const kind of [
      'DISRUPTION',
      'SERVICE_BOOKING',
      'TIMING',
      'TRANSFER_STAY',
      'PROGRAMME_COMMITMENT',
      'RECOVERY_PROPOSAL',
    ] as const) {
      assert.equal(LdgNodeKindSchema.parse(kind), kind);
    }
  });

  test('RecoveryCase keeps booking success separate from whole-trip viability (partial recovery basis)', () => {
    const view = RecoveryCaseViewSchema.parse({
      generatedAt: '2031-09-01T00:00:00.000Z',
      caseRef: 'case-1',
      status: 'EXECUTING',
      changeSummary: 'progressive connection loss',
      bookingServiceState: { label: 'replacement flight', state: 'HEALTHY', detail: 'confirmed' },
      tripViability: { label: 'whole trip', verdict: 'FAIL', detail: 'downstream stay unresolved' },
      affectedItems: ['onward travel', 'overnight stay', 'downstream stay'],
      strategies: [],
      authorityState: 'approved',
      executionState: 'partial',
      reconciliationState: 'reconciling',
      uncertainty: ['downstream stay outcome unknown'],
      ldg: {
        scope: 'FOCUSED_CASE',
        nodes: [],
        edges: [],
        change: {
          projectionRevision: 1,
          changedVisibleRefs: [],
          currentSemanticState: 'AFFECTED',
        },
      },
      change: {
        projectionRevision: 1,
        changedVisibleRefs: ['booking:replacement'],
        previousSemanticState: 'FAILED',
        currentSemanticState: 'AFFECTED',
      },
    });
    assert.equal(view.bookingServiceState.state, 'HEALTHY');
    assert.equal(view.tripViability.verdict, 'FAIL');
  });

  test('TravellerTrip answers Jordan questions via generic fields (no Jordan-specific keys)', () => {
    const view = TravellerTripViewSchema.parse({
      generatedAt: '2031-09-01T00:00:00.000Z',
      tripRef: 'trip-1',
      amIOkay: 'NO',
      whatChanged: 'First leg delayed; connection now impossible',
      whatMattersNow: 'Overnight stay and replacement onward travel',
      whatNorthstarIsDoing: 'Planning coordinated recovery across travel and stay',
      whatDoYouNeedFromMe: 'Approval for recovery cost',
      doesTheRestWork: 'NOT_VIABLE',
      change: {
        projectionRevision: 2,
        changedVisibleRefs: ['connection'],
        previousSemanticState: 'AFFECTED',
        currentSemanticState: 'FAILED',
      },
    });
    assert.equal(view.amIOkay, 'NO');
    assert.ok(!('jordan' in view));
    assert.ok(!JSON.stringify(view).includes('LAX'));
  });

  test('CK2 additive multi-action / multi-stay fields are now projected on RecoveryCaseView', () => {
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.length >= 6);
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.some((f) => f.includes('recoveryActions')));
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.some((f) => f.includes('partialRecovery')));
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.some((f) => f.includes('duplicateBookingExposure')));
    assert.ok(JORDAN_S2_ACCEPTANCE_MULTI_STAY.some((a) => a.includes('partial-failure')));
    const view = RecoveryCaseViewSchema.parse({
      generatedAt: '2031-09-01T00:00:00.000Z',
      caseRef: 'case-ck2',
      status: 'EXECUTING',
      changeSummary: 'multi-stay',
      bookingServiceState: { label: 'stays', state: 'ACTIVE' },
      tripViability: { label: 'trip', verdict: 'FAIL' },
      affectedItems: [],
      strategies: [],
      authorityState: 'approved',
      executionState: 'partial',
      reconciliationState: 'reconciling',
      uncertainty: [],
      recoveryActions: [{
        actionRef: 'a1',
        domain: 'stay',
        capability: 'hotel.book',
        subjectRefs: ['r1'],
        authorityState: 'granted',
        dependencyOrder: 0,
        dependsOnActionRefs: [],
        executionState: 'COMPLETED',
        observationResult: 'CONFIRMED',
        uncertainty: [],
      }],
      remainingRecoveryWork: [],
      duplicateBookingExposure: [],
      connectionProgression: 'EXECUTING_COORDINATED_RECOVERY',
      ldg: {
        scope: 'FOCUSED_CASE',
        nodes: [],
        edges: [],
        change: { projectionRevision: 1, changedVisibleRefs: [], currentSemanticState: 'AFFECTED' },
      },
      change: { projectionRevision: 1, changedVisibleRefs: [], currentSemanticState: 'AFFECTED' },
    });
    assert.equal(view.recoveryActions.length, 1);
    assert.equal(view.connectionProgression, 'EXECUTING_COORDINATED_RECOVERY');
  });
});
