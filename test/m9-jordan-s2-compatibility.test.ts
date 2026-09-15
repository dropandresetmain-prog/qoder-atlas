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
  JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS,
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

describe('M9 Jordan S2 read-model compatibility (CK1 audit)', () => {
  test('Jordan S2 compatible — no CK1 reopening required', () => {
    assert.equal(jordanS2ScenarioFoundation.kind, JORDAN_S2_SCENARIO_KIND);
    assert.equal(jordanS2ScenarioFoundation.signalOrigin, 'PROVIDER_PROGRESSIVE_DELAY');
    assert.equal(jordanS2ScenarioFoundation.scope.journeyCount, 1);
    assert.equal(jordanS2ScenarioFoundation.scope.programmeWideRecovery, false);
    assert.equal(jordanS2ScenarioFoundation.recovery.multiActionStrategy, true);
    assert.equal(jordanS2ScenarioFoundation.recovery.partialExecutionVisible, true);
    assert.equal(jordanS2ScenarioFoundation.recovery.providerSuccessDoesNotResolveCase, true);
    assert.equal(jordanS2ScenarioFoundation.productSurfaces.usesSharedReadModels, true);
    assert.equal(jordanS2ScenarioFoundation.productSurfaces.dedicatedHeroUi, false);
    assert.equal(jordanS2ScenarioFoundation.pendingEvidence.atlasFlightFacts, 'PENDING');
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

  test('CK2 additive multi-action fields are recorded, not implemented in CK1', () => {
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.length >= 4);
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.some((f) => f.includes('recoveryActions')));
    assert.ok(JORDAN_S2_CK2_ADDITIVE_READMODEL_FIELDS.some((f) => f.includes('partialRecovery')));
  });
});
