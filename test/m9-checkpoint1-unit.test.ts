/**
 * M9 Checkpoint 1 — focused unit proofs (no PostgreSQL required).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReplanIdentity, M9_REPLAN_IDENTITY } from '../src/app/target/replanIdentity.ts';
import {
  denyDirectObjectiveDisposition,
  M9_OBJECTIVE_DISPOSITION_API_EXPOSED,
} from '../src/app/target/objectiveDispositionBoundary.ts';
import {
  acceptProviderShapedDemoEvent,
  applicationError,
  commandDirectObjectiveDisposition,
} from '../src/app/target/applicationCommands.ts';
import { proposedCoversRequired } from '../src/app/target/grantIssuance.ts';
import { travellerInitiatedScenarioFoundation } from '../src/app/target/secondScenarioFoundation.ts';

describe('M9 IN-1 replan identity', () => {
  test('frozen rules preserve effect-scoped logical keys and known-success protection', () => {
    assert.equal(M9_REPLAN_IDENTITY.logicalOperationScope, 'effect');
    assert.equal(M9_REPLAN_IDENTITY.intentUniqueness, 'per_action_plan');
    assert.equal(M9_REPLAN_IDENTITY.knownSuccessBlocksNewDispatch, true);
    assert.equal(M9_REPLAN_IDENTITY.newStrategyMayPersistSameLogicalKey, true);
  });

  test('classifies retry, reconcile, new strategy, and blocked repurchase', () => {
    assert.equal(
      classifyReplanIdentity({
        priorLogicalOperationKey: 'select-offer:a:b',
        priorRequestFingerprint: 'fp1',
        nextLogicalOperationKey: 'select-offer:a:b',
        nextRequestFingerprint: 'fp1',
        priorAttemptStatus: 'PREPARED',
      }),
      'RECONCILE_SAME_ATTEMPT',
    );
    assert.equal(
      classifyReplanIdentity({
        priorLogicalOperationKey: 'select-offer:a:b',
        priorRequestFingerprint: 'fp1',
        nextLogicalOperationKey: 'select-offer:a:b',
        nextRequestFingerprint: 'fp1',
        priorAttemptStatus: 'OBSERVED_SUCCESS',
      }),
      'KNOWN_SUCCESS_REPLAY',
    );
    assert.equal(
      classifyReplanIdentity({
        priorLogicalOperationKey: 'select-offer:a:b',
        priorRequestFingerprint: 'fp1',
        nextLogicalOperationKey: 'select-offer:a:b',
        nextRequestFingerprint: 'fp2',
        priorAttemptStatus: 'OBSERVED_FAILURE',
      }),
      'NEW_STRATEGY_SAME_EFFECT',
    );
    assert.equal(
      classifyReplanIdentity({
        priorLogicalOperationKey: 'select-offer:a:b',
        priorRequestFingerprint: 'fp1',
        nextLogicalOperationKey: 'select-offer:a:b',
        nextRequestFingerprint: 'fp2',
        priorAttemptStatus: 'OBSERVED_SUCCESS',
      }),
      'BLOCKED_AFTER_SUCCESS_DIFFERENT_FINGERPRINT',
    );
  });
});

describe('M9 objective disposition boundary', () => {
  test('terminal disposition is not exposed and requires authorised ActionIntent', () => {
    assert.equal(M9_OBJECTIVE_DISPOSITION_API_EXPOSED, false);
    assert.equal(denyDirectObjectiveDisposition({ disposition: 'WAIVED', viaAuthorisedActionIntent: false }).allowed, false);
    assert.equal(denyDirectObjectiveDisposition({ disposition: 'CLOSED_WITH_LOSS', viaAuthorisedActionIntent: false }).allowed, false);
    assert.equal(denyDirectObjectiveDisposition({ disposition: 'WAIVED', viaAuthorisedActionIntent: true }).allowed, true);
    const denied = commandDirectObjectiveDisposition({ disposition: 'WAIVED', viaAuthorisedActionIntent: false });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.mutatesState, false);
  });
});

describe('M9 R-10 grant scope covering', () => {
  test('caller cannot loosen required scope', () => {
    const required = [{ kind: 'JOURNEY' as const, id: '11111111-1111-4111-8111-111111111111' }];
    const weaker = [{ kind: 'ORGANISATION' as const, id: '22222222-2222-4222-8222-222222222222' }];
    const exact = required;
    assert.equal(proposedCoversRequired(weaker, required), false);
    assert.equal(proposedCoversRequired(exact, required), true);
    assert.equal(proposedCoversRequired([...exact, ...weaker], required), true);
  });
});

describe('M9 demo ingress + errors', () => {
  test('provider-shaped demo event never mutates and requires disclosure', () => {
    const ok = acceptProviderShapedDemoEvent({
      providerId: 'atlas',
      providerEventId: 'evt-1',
      receivedAt: '2031-01-01T00:00:00.000Z',
      payload: { type: 'schedule_change' },
      disclosedAsSimulatedDemoInput: true,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.next, 'NORMALISE_AND_PROCESS_SIGNAL');
  });

  test('application errors never claim mutation', () => {
    const err = applicationError('ACTION_SUCCEEDED_TRIP_INVALID', 'booking ok; journey still FAIL');
    assert.equal(err.mutatesState, false);
  });
});

describe('M9 second scenario foundation', () => {
  test('Jordan S2 progressive individual disruption differs from Sarah programme cohort', () => {
    assert.equal(travellerInitiatedScenarioFoundation.signalOrigin, 'PROVIDER_PROGRESSIVE_DELAY');
    assert.equal(travellerInitiatedScenarioFoundation.scope.journeyCount, 1);
    assert.equal(travellerInitiatedScenarioFoundation.scope.programmeWideRecovery, false);
    assert.equal(travellerInitiatedScenarioFoundation.productSurfaces.usesSharedReadModels, true);
    assert.equal(travellerInitiatedScenarioFoundation.productSurfaces.dedicatedHeroUi, false);
    assert.equal(travellerInitiatedScenarioFoundation.recovery.multiActionStrategy, true);
  });
});
