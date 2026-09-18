/**
 * R1 L6 — C4 must not damage the B2 safety story.
 *
 *   provider-bound attempt -> LOST_RESPONSE -> OUTCOME_UNKNOWN
 *   -> C4 wake (x N) -> NO second provider mutation
 *   -> existing reconciliation owner (PgExecutionWorker.reconcileUnknown)
 *   -> authoritative observation -> C4 decides from the new truth.
 *
 * The provider MUTATION is the injected dispatcher and every test counts its
 * calls; reconciliation lookups are read-only and counted separately. C4 owns
 * neither: it WAITs while an outcome is unknown or work is incomplete, and only
 * RESOLVEs through the deterministic gate once the outcome is reconciled and the
 * case's subject is CURRENT + PASS. It never plans here (a spy planner records
 * any call) and never approves, dispatches or retries.
 *
 * Fixture: the same provider-bound single-intent plan + stored authority the M8
 * execution proofs use, attached to a RecoveryCase whose JOURNEY subject C4 can
 * see. (The runtime approval path composes only internal capabilities today; an
 * external SELECT_OFFER approval is not part of R1.)
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedTraveller, seedTrip } from './m2Seed.ts';
import { seedOrganisation } from './m3Seed.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { createPrincipal } from '../src/persistence/postgres/commands/peopleCommands.ts';
import { attachCaseSubjects } from '../src/persistence/postgres/commands/caseLifecycleCommands.ts';
import { openRecoveryCase, persistActionPlan, createPreparedExecutionAttempt } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { computeRequestFingerprint } from '../src/resolution/execution/stateMachine.ts';
import { runRecoveryProgressionPass } from '../src/app/target/recoveryProgressionPass.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { listRecoveryCaseAttention } from '../src/persistence/postgres/commands/caseAttentionCommands.ts';
import type { ActionPlan } from '../src/contracts/v2/action/actionPlan.ts';
import type { RecoveryPlanningCoordinator, RecoveryPlanningInput } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import {
  GATE_NOW,
  persistStrategyChangeRow,
  prepareParams,
  seedStoredExecutionAuthority,
  tripBaseManifest,
  bootstrapTestGrantIssuer,
} from './m8ExecutionGateHelpers.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: { kind: string; message: string } }): T {
  if (!outcome.ok || outcome.value === undefined) assert.fail(`${outcome.conflict?.kind}: ${outcome.conflict?.message}`);
  return outcome.value;
}

async function fixture() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'R1 unknown outcome');
  const organisationId = await seedOrganisation(seed, 'USD');
  const traveller = await seedTraveller(seed, { displayName: 'Unknown Outcome Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  await commitSeed(seed);
  const ws = seed.workspaceId;
  const uow = () => new PgUnitOfWork(pool, ws);
  const principalId = randomUUID();
  mustOk(await createPrincipal(uow(), {
    workspaceId: ws, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), principalId,
    actorType: 'HUMAN', authIssuer: 'https://issuer.invalid/r1-unknown', authSubject: principalId,
  }));
  const opened = mustOk(await openRecoveryCase(uow(), { workspaceId: ws, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: GATE_NOW }));
  mustOk(await attachCaseSubjects(uow(), {
    workspaceId: ws, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), caseId: opened.caseId,
    subjects: [{ kind: 'JOURNEY', id: journeyId, role: 'AFFECTED' }],
  }));

  // A provider-bound (external) single-intent plan with the shape M7's compiler produces.
  const intentId = randomUUID();
  const planId = randomUUID();
  const scenarioChangeId = randomUUID();
  const recoveryStrategyId = randomUUID();
  const plan: ActionPlan = {
    id: planId, recoveryCaseId: opened.caseId, scenarioChangeId,
    intents: [{
      id: intentId, actionPlanId: planId, operationNamespace: 'provider:test', logicalOperationKey: `op-r1-unknown-${intentId}`,
      requestFingerprint: computeRequestFingerprint({ intentId }), capabilityRef: 'SERVICE:RESERVATION',
      subjectRefs: [{ kind: 'ORGANISATION', id: organisationId }], expectedRevisions: [], preconditions: [], requiredAuthorityScopes: [],
      expectedObservations: ['booking_status'], costEstimate: { amount: '40.00', currency: 'USD' },
      compensationPolicy: { supported: false, requiresSeparateAuthority: true }, status: 'PROPOSED',
    }],
    dependencies: [],
  };
  await persistStrategyChangeRow(pool, ws, seed.actorId, opened.caseId, {
    id: scenarioChangeId, recoveryStrategyId, strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }], effects: [],
  }, { baseManifest: tripBaseManifest(tripId, 1), candidateSummaries: [{ subjectRef: { kind: 'JOURNEY', id: journeyId } }] });
  const persisted = mustOk(await persistActionPlan(uow(), { workspaceId: ws, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), plan, recoveryStrategyId }));
  const budgetId = randomUUID();
  mustOk(await createBudget(uow(), {
    workspaceId: ws, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
    budget: { id: budgetId, organisationId, purpose: 'travel', amount: { amount: '100.00', currency: 'USD' } },
  }));
  const issuerPrincipalId = await bootstrapTestGrantIssuer(pool, ws, seed.actorId, GATE_NOW, [
    { kind: 'ORGANISATION', id: organisationId }, { kind: 'TRIP', id: tripId }, { kind: 'JOURNEY', id: journeyId }, { kind: 'ACTION_INTENT', id: persisted.intentIds[0]! },
  ]);
  await seedStoredExecutionAuthority({
    pool, workspaceId: ws, actorId: seed.actorId, principalId, planId: persisted.planId, intentId: persisted.intentIds[0]!,
    scope: [{ kind: 'ORGANISATION', id: organisationId }], representedPartyRef: { kind: 'ORGANISATION', id: organisationId },
    cost: { amount: '40.00', currency: 'USD' }, budgetId, budgetRevision: 1,
    assessmentSubject: { kind: 'JOURNEY', id: journeyId }, assessmentTripId: tripId, issuerPrincipalId,
  });

  // The provider-bound attempt, driven to OUTCOME_UNKNOWN by a lost response.
  mustOk(await createPreparedExecutionAttempt(uow(), prepareParams({ workspaceId: ws, actorId: seed.actorId, planId: persisted.planId, intentId: persisted.intentIds[0]!, principalId })));
  const worker = new PgExecutionWorker(pool, { actorId: 'r1-unknown-outcome-worker' });
  const claim = await worker.claimNext(ws);
  assert.ok(claim);
  let mutations = 0;
  const lost = await worker.dispatchClaimed(claim, {
    principalId, now: GATE_NOW, observed: { capabilityKind: 'BOOK', supported: true },
    dispatcher: async () => { mutations += 1; return { kind: 'LOST_RESPONSE', requestRef: 'req-r1-unknown' }; },
  });
  assert.equal(lost.outcome, 'OUTCOME_UNKNOWN');
  assert.equal(mutations, 1);

  const planCalls: RecoveryPlanningInput[] = [];
  const planner: RecoveryPlanningCoordinator = { async planCase(input) { planCalls.push(input); throw new Error('C4 must not plan here'); } };
  const wake = () => runRecoveryProgressionPass({ pool, workspaceId: ws, actorPrincipalId: seed.actorId, uow, planner, now: GATE_NOW });
  const statuses = async () => (await pool.query<{ status: string }>('SELECT status FROM execution_attempts WHERE workspace_id = $1 ORDER BY attempt_number', [ws])).rows.map((r) => r.status);
  const caseStatus = async () => (await pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [ws, opened.caseId])).rows[0]!.lifecycle_status;
  return {
    pool, ws, uow, worker, claim, planCalls, wake, statuses, caseStatus, caseId: opened.caseId,
    planId: persisted.planId, intentId: persisted.intentIds[0]!, principalId, actorId: seed.actorId, mutations: () => mutations,
  };
}

describe('R1 unknown outcome / reconciliation safety under C4', () => {
  test('OUTCOME_UNKNOWN: repeated C4 wakes WAIT, never plan, and never cause a second provider mutation', async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i += 1) {
      const report = await f.wake();
      assert.equal(report.candidates, 1);
      assert.equal(report.outcomes[0]!.decision, 'WAIT', JSON.stringify(report.outcomes));
      assert.equal(report.outcomes[0]!.reasonCode, 'authority_or_execution_pending');
      assert.equal(report.outcomes[0]!.dispatch, 'NONE');
    }
    assert.equal(f.mutations(), 1, 'C4 never dispatches or retries a provider call');
    assert.deepEqual(await f.statuses(), ['OUTCOME_UNKNOWN'], 'C4 created no attempt');
    assert.equal(f.planCalls.length, 0);
    assert.equal((await listRecoveryCaseAttention(f.pool, f.ws, f.caseId)).length, 0);
    assert.notEqual(await f.caseStatus(), 'RESOLVED');
    // The internal execution owner does not pick up a provider-bound intent either.
    assert.equal((await runInternalExecutionPass({ pool: f.pool, workspaceId: f.ws, actorPrincipalId: f.actorId, uow: f.uow, executorPrincipalId: f.principalId, now: GATE_NOW })).candidates, 0);

    // The B2 guard itself still holds: a blind redispatch attempt is refused while unknown.
    const blind = await createPreparedExecutionAttempt(f.uow(), prepareParams({ workspaceId: f.ws, actorId: f.actorId, planId: f.planId, intentId: f.intentId, principalId: f.principalId, attemptNumber: 2 }));
    assert.equal(blind.ok, false);
    assert.equal(f.mutations(), 1);
  });

  test('still unknown after a reconciliation lookup => still WAIT, still one provider mutation', async () => {
    const f = await fixture();
    let lookups = 0;
    const outcome = await f.worker.reconcileUnknown({ ...f.claim, status: 'OUTCOME_UNKNOWN' }, async () => { lookups += 1; return { kind: 'STILL_UNKNOWN' }; });
    assert.equal(lookups, 1);
    assert.ok(['OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(outcome.outcome), outcome.outcome);
    const report = await f.wake();
    assert.equal(report.outcomes[0]!.decision, 'WAIT', JSON.stringify(report.outcomes));
    assert.equal(f.mutations(), 1);
    assert.equal(f.planCalls.length, 0);
  });

  test('authoritative FAILURE observed: no retry by C4; the intent stays incomplete so the case WAITs, unresolved', async () => {
    const f = await fixture();
    const outcome = await f.worker.reconcileUnknown({ ...f.claim, status: 'OUTCOME_UNKNOWN' }, async () => ({ kind: 'FOUND_FAILURE', error: 'provider reports no booking exists' }));
    assert.equal(outcome.outcome, 'OBSERVED_FAILURE');
    for (let i = 0; i < 2; i += 1) {
      const report = await f.wake();
      assert.equal(report.outcomes[0]!.decision, 'WAIT', JSON.stringify(report.outcomes));
      assert.equal(report.resolved, 0);
    }
    assert.equal(f.mutations(), 1, 'retrying a failed provider action is the execution owner\'s policy, never C4\'s');
    assert.deepEqual(await f.statuses(), ['OBSERVED_FAILURE']);
    assert.equal(f.planCalls.length, 0);
    assert.notEqual(await f.caseStatus(), 'RESOLVED');
  });

  test('authoritative SUCCESS observed: only now does C4 RESOLVE (through the gate), still with one provider mutation', async () => {
    const f = await fixture();
    let lookups = 0;
    const outcome = await f.worker.reconcileUnknown({ ...f.claim, status: 'OUTCOME_UNKNOWN' }, async () => {
      lookups += 1;
      return { kind: 'FOUND_SUCCESS', responseRef: 'rsp-r1-unknown', sourceOwnedFields: { status: 'CONFIRMED' } };
    });
    assert.equal(outcome.outcome, 'OBSERVED_SUCCESS');
    assert.equal(lookups, 1);
    const report = await f.wake();
    assert.equal(report.outcomes[0]!.decision, 'RESOLVE', JSON.stringify(report.outcomes));
    assert.equal(report.resolved, 1);
    assert.equal(await f.caseStatus(), 'RESOLVED');
    assert.equal(f.mutations(), 1, 'reconciliation is a read-only lookup, not a second mutation');
    assert.equal(f.planCalls.length, 0);
    assert.equal((await f.wake()).candidates, 0, 'a resolved case is never progressed again');
  });
});
