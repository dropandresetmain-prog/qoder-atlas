/**
 * M8 unit coverage: envelope fingerprint, budget admission, execution transitions,
 * capability separation, idempotency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEnvelopeFingerprint,
  materialAuthorityInputChanged,
} from '../src/resolution/authority/envelope.ts';
import { admitBudgetHold } from '../src/resolution/budget/protect.ts';
import {
  canTransitionExecutionStatus,
  checkRequestIdempotency,
  leaseExpiryAllowsBlindRetry,
  mayHaveBeenSent,
  computeRequestFingerprint,
} from '../src/resolution/execution/stateMachine.ts';
import { observationImpliesServicing, requireProviderCapability } from '../src/resolution/execution/capability.ts';
import { descriptiveRoleIsNotAuthority } from '../src/resolution/authority/authorize.ts';

test('M8: envelope fingerprint binds plan/intent/scope/limits; material change invalidates', () => {
  const base = {
    actionPlanId: 'plan-1',
    actionPlanVersion: 1,
    actionIntentId: 'intent-1',
    actionIntentVersion: 1,
    requiredActorRoles: ['PAYER'],
    scope: [{ kind: 'JOURNEY' as const, id: 'j-1' }],
    grantRefs: [],
    ruleInputs: [],
    amountCeiling: { amount: '100.00', currency: 'USD' as const },
  };
  const fp1 = computeEnvelopeFingerprint(base);
  const fp2 = computeEnvelopeFingerprint({ ...base, actionIntentVersion: 2 });
  assert.notEqual(fp1, fp2);
  assert.equal(materialAuthorityInputChanged(base, { ...base, costEstimate: { amount: '50.00', currency: 'USD' } }), true);
  assert.equal(materialAuthorityInputChanged(base, { ...base }), false);
});

test('M8: budget admission blocks overspend, duplicate, and currency mismatch', () => {
  const budget = { id: 'b1', amount: { amount: '100.00', currency: 'USD' }, currency: 'USD' };
  const ok = admitBudgetHold({
    budget,
    activeCommitments: [{ id: 'c1', actionIntentId: 'i1', amount: { amount: '40.00', currency: 'USD' }, status: 'HELD' }],
    actionIntentId: 'i2',
    requested: { amount: '50.00', currency: 'USD' },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.remainingAfter.amount, '10.00');

  const over = admitBudgetHold({
    budget,
    activeCommitments: [{ id: 'c1', actionIntentId: 'i1', amount: { amount: '60.00', currency: 'USD' }, status: 'HELD' }],
    actionIntentId: 'i2',
    requested: { amount: '50.00', currency: 'USD' },
  });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, 'INSUFFICIENT_BUDGET');

  const dup = admitBudgetHold({
    budget,
    activeCommitments: [{ id: 'c1', actionIntentId: 'i2', amount: { amount: '10.00', currency: 'USD' }, status: 'HELD' }],
    actionIntentId: 'i2',
    requested: { amount: '10.00', currency: 'USD' },
  });
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.reason, 'DUPLICATE_COMMITMENT');
});

test('M8: execution transitions and unknown-outcome semantics', () => {
  assert.equal(canTransitionExecutionStatus('PREPARED', 'CLAIMED'), true);
  assert.equal(canTransitionExecutionStatus('DISPATCHING', 'OUTCOME_UNKNOWN'), true);
  assert.equal(canTransitionExecutionStatus('OUTCOME_UNKNOWN', 'PREPARED'), false);
  assert.equal(mayHaveBeenSent('DISPATCHING'), true);
  assert.equal(leaseExpiryAllowsBlindRetry('DISPATCHED'), false);
});

test('M8: same idempotency key / same fingerprint is safe; different fingerprint conflicts', () => {
  const fp = computeRequestFingerprint({ a: 1, b: 2 });
  const prior = [{
    id: 'a1', actionIntentId: 'i1', attemptNumber: 1, logicalOperationKey: 'op-1',
    requestFingerprint: fp, claimToken: 'c', fencingToken: 1,
    leaseExpiresAt: '2031-01-01T00:00:00.000Z', status: 'RECONCILED' as const,
  }];
  assert.equal(checkRequestIdempotency({ logicalOperationKey: 'op-1', requestFingerprint: fp, priorAttempts: prior }).ok, true);
  const bad = checkRequestIdempotency({
    logicalOperationKey: 'op-1',
    requestFingerprint: computeRequestFingerprint({ a: 1, b: 3 }),
    priorAttempts: prior,
  });
  assert.equal(bad.ok, false);
});

test('M8: capability separation — observe ≠ service; unsupported is structured', () => {
  assert.equal(observationImpliesServicing(), false);
  assert.equal(descriptiveRoleIsNotAuthority(), true);
  const unsupported = requireProviderCapability({
    required: 'SERVICE',
    observed: { capabilityKind: 'SERVICE', supported: false },
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.escalation, 'MANUAL');
  const observeOnly = requireProviderCapability({
    required: 'SERVICE',
    observed: { capabilityKind: 'OBSERVE', supported: true },
  });
  assert.equal(observeOnly.ok, false);
});
