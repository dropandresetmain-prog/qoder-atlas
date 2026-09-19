/**
 * R4-F2 — transport Recover is truthful AND executable through the Atlas
 * SANDBOX adapter seam (`external:offer.select`).
 *
 * Scenario: the R1 "broken connection" world (no programme; Sarah's internal
 * programme recovery is a different world and is untouched). A viable
 * SELECT_OFFER strategy is recommended from REPLAY research; then:
 *
 *   AI/proposal -> RC-6 viability -> [preflight] -> approval (authority decision +
 *   approval + HELD budget) -> stored gate -> durable PREPARED/DISPATCHING attempt
 *   -> Atlas (scripted transaction capability standing in for the sandbox) ->
 *   observe -> classify -> reconcile -> canonical update -> reassess -> RESOLVED.
 *
 * The provider is a scripted FlightTransactionCapability that COUNTS every call
 * and records the attempt row's status at the instant of each mutation (proof
 * that DISPATCHING is durable BEFORE network). The real sandbox run is a
 * separate opt-in script (scripts/r4-atlas-sandbox-run.ts).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sharedTestPool } from './harness.ts';
import { plannedTransportCase } from './r4TransportWorld.ts';
import { approveRecoveryStrategy, externalExecutionBlockerForStrategyId } from '../src/app/target/recoveryApproval.ts';
import { recordTravellerBookingIdentity } from '../src/persistence/postgres/execution/providerExecutionInputs.ts';
import {
  EXTERNAL_OFFER_SELECT_STATEMENTS, externalRecordIdForOrder, runExternalExecutionCycle, runExternalOfferExecutionPass, runExternalReconciliation, type ExternalOfferExecutionDeps,
} from '../src/app/target/externalOfferExecution.ts';
import { findExternalExecutionResetBlocker, resetDemoWorkspace } from '../src/app/demo/demoReset.ts';
import { tryAcquireWorkspaceOperationLease } from '../src/app/target/workspaceOperationLease.ts';
import { ATLAS_SANDBOX_BALANCE_PAYMENT_REF } from '../src/providers/atlas/transactionAdapter.ts';
import { capabilityError, capabilityOk } from '../src/contracts/envelope.ts';
import type { CapabilityMeta } from '../src/contracts/envelope.ts';
import type { FlightOrderOutcome, FlightOrderStatus, FlightTransactionCapability } from '../src/contracts/capabilities.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Scripted Atlas transaction capability: counts every provider call and records
// the durable attempt status observed AT THE INSTANT of each mutation.
// ---------------------------------------------------------------------------

interface Script {
  verify?: 'VERIFIED' | 'PRICE_CHANGED' | 'UNAVAILABLE';
  create?: 'OK' | 'TIMEOUT';
  payable?: number;
  pay?: 'OK' | 'TIMEOUT';
  /** Status the provider reports on retrieve calls. */
  retrieve?: FlightOrderStatus;
}

function scriptedProvider(pool: Pool, workspaceId: string, script: Script) {
  const calls = { verify: 0, create: 0, pay: 0, retrieve: 0 };
  const statusesAtMutation: string[][] = [];
  const meta = (): CapabilityMeta => ({ providerId: 'atlas', mode: 'REPLAY', requestedAt: new Date().toISOString() });
  const attemptStatuses = async (): Promise<string[]> =>
    (await pool.query<{ status: string }>('SELECT status FROM execution_attempts WHERE workspace_id = $1 ORDER BY created_at', [workspaceId])).rows.map((r) => r.status);
  const orderOutcome = (status: FlightOrderStatus, withPrice: boolean): FlightOrderOutcome => ({
    status, provenance: 'REPLAY',
    ...(withPrice ? { totalPrice: { amount: script.payable ?? 10, currency: 'USD' } } : {}),
    transactionState: { orderRef: 'ORDER-1' },
  });
  const transactions: FlightTransactionCapability = {
    descriptor: { family: 'FLIGHT', providerId: 'atlas', mode: 'REPLAY', supportedOperations: [], maxSideEffectLevel: 'MONEY_MOVING' },
    async createOrder() {
      calls.create += 1;
      statusesAtMutation.push(await attemptStatuses());
      if (script.create === 'TIMEOUT') return capabilityError({ category: 'TIMEOUT', code: 'timeout', message: 'timed out' }, meta());
      return capabilityOk(orderOutcome('HELD', true), meta());
    },
    async payOrder() {
      calls.pay += 1;
      statusesAtMutation.push(await attemptStatuses());
      if (script.pay === 'TIMEOUT') return capabilityError({ category: 'TIMEOUT', code: 'timeout', message: 'timed out' }, meta());
      return capabilityOk(orderOutcome('PAID', true), meta());
    },
    async retrieveOrder(query) {
      calls.retrieve += 1;
      return capabilityOk({ orderRef: query.orderRef, status: script.retrieve ?? 'TICKETED', provenance: 'REPLAY' as const, totalPrice: { amount: script.payable ?? 10, currency: 'USD' } }, meta());
    },
    async quoteCancellation() { throw new Error('cancellation is not reachable from offer selection'); },
    async submitCancellation() { throw new Error('cancellation is not reachable from offer selection'); },
    async retrieveCancellationStatus() { throw new Error('cancellation is not reachable from offer selection'); },
  };
  const flight = {
    async verifyOffer() {
      calls.verify += 1;
      const status = script.verify ?? 'VERIFIED';
      return capabilityOk({ status, workflowState: { sessionId: 'session-1' } }, meta());
    },
  };
  const deps: ExternalOfferExecutionDeps = {
    flight, transactions, mode: 'RECORD', paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
    ticketingPoll: { attempts: 2, delayMs: 0 }, sleep: async () => undefined,
  };
  return { calls, statusesAtMutation, deps };
}

describe('R4-F2 transport Recover through the Atlas sandbox seam (real PostgreSQL)', () => {
  test('truthful preflight: Recover is refused with an explicit reason — never approved-then-CAPABILITY_UNSUPPORTED — and nothing runs', async () => {
    const f = await plannedTransportCase('R4F2 preflight', { identity: false, budget: false });
    const uow = () => f.c.app.unitOfWork();
    const base = { pool: f.c.pool, workspaceId: f.ws, actorPrincipalId: f.c.world.actorId, uow, now: f.c.now, executorPrincipalId: f.c.executorPrincipalId };
    const input = { caseId: f.c.caseId, strategyId: f.strategyId, approverPrincipalId: f.c.operatorPrincipalId };

    // 0. The protected binding was written by the coordinator, not by any approval path.
    assert.equal(await f.count('SELECT count(*)::text AS n FROM offer_execution_bindings WHERE workspace_id = $1'), 1);

    // The read model (what Recover is offered from) uses the SAME probe: an explicit blocker per option.
    assert.equal((await externalExecutionBlockerForStrategyId(f.c.pool, f.ws, f.strategyId, undefined))?.code, 'EXTERNAL_EXECUTION_NOT_COMPOSED');
    assert.equal((await externalExecutionBlockerForStrategyId(f.c.pool, f.ws, f.strategyId, EXTERNAL_OFFER_SELECT_STATEMENTS))?.code, 'EXECUTION_INPUTS_UNAVAILABLE');

    // 1. Execution capability not composed => explicit reason.
    const notComposed = await approveRecoveryStrategy(base, input);
    assert.equal(notComposed.ok, false);
    if (!notComposed.ok) assert.equal(notComposed.error.code, 'EXTERNAL_EXECUTION_NOT_COMPOSED');

    // 2. Composed, but the traveller has no protected booking identity => explicit reason.
    const noIdentity = await approveRecoveryStrategy({ ...base, externalCapabilities: EXTERNAL_OFFER_SELECT_STATEMENTS }, input);
    assert.equal(noIdentity.ok, false);
    if (!noIdentity.ok) {
      assert.equal(noIdentity.error.code, 'EXECUTION_INPUTS_UNAVAILABLE');
      assert.match(noIdentity.error.message, /BOOKING_IDENTITY_MISSING/);
    }

    // 3. Identity present, no budget => explicit reason.
    await recordTravellerBookingIdentity(f.c.pool, { workspaceId: f.ws, actorId: f.c.world.actorId, travellerId: f.c.world.people[0]!.travellerId, gender: 'FEMALE' });
    const noEmail = await approveRecoveryStrategy({ ...base, externalCapabilities: EXTERNAL_OFFER_SELECT_STATEMENTS }, input);
    assert.equal(noEmail.ok, false);
    if (!noEmail.ok) assert.match(noEmail.error.message, /CONTACT_EMAIL_MISSING/);
    await f.c.pool.query('UPDATE traveller_booking_identities SET contact_email = $3 WHERE workspace_id = $1 AND traveller_id = $2', [f.ws, f.c.world.people[0]!.travellerId, 'r4.traveller@example.com']);
    const noBudget = await approveRecoveryStrategy({ ...base, externalCapabilities: EXTERNAL_OFFER_SELECT_STATEMENTS }, input);
    assert.equal(noBudget.ok, false);
    if (!noBudget.ok) assert.equal(noBudget.error.code, 'BUDGET_UNAVAILABLE');

    // No authority minted, no plan, no attempt, and the execution pass has nothing to do.
    assert.equal(await f.count('SELECT count(*)::text AS n FROM action_plans WHERE workspace_id = $1'), 0);
    assert.equal(await f.count('SELECT count(*)::text AS n FROM authority_decisions WHERE workspace_id = $1'), 0);
    const provider = scriptedProvider(f.c.pool, f.ws, {});
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.candidates, 0);
    assert.deepEqual(provider.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 });
    await f.c.app.close();
  });

  test('happy path: approve -> durable attempt BEFORE network -> exactly one order + one payment -> observed -> canonical update -> reassess -> RESOLVED; no redispatch', async () => {
    const f = await plannedTransportCase('R4F2 happy');
    const provider = scriptedProvider(f.c.pool, f.ws, { payable: 5 });
    const before = await f.selectedService();
    assert.equal(await externalExecutionBlockerForStrategyId(f.c.pool, f.ws, f.strategyId, EXTERNAL_OFFER_SELECT_STATEMENTS), undefined, 'a runnable option carries no blocker: Recover is truthful');

    // Nothing runs before approval: no decision/approval => no candidate => no provider call.
    assert.equal((await runExternalOfferExecutionPass(f.execCtx(provider.deps))).candidates, 0);
    assert.deepEqual(provider.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 });

    const approved = await f.approveNoDrain();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    if (!approved.ok) return;
    // The approval's budget hold invalidated the journey assessment: execution DEFERS (no attempt, no network)
    // until reassessment settles, then the gate sees CURRENT truth.
    const early = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(early.deferred, 1, JSON.stringify(early.outcomes));
    assert.deepEqual(provider.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 });
    await f.c.drain();
    const stored = await f.c.pool.query<{ capability_ref: string; cost_amount: string }>('SELECT capability_ref, cost_amount::text AS cost_amount FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2', [f.ws, approved.report.planId]);
    assert.deepEqual(stored.rows.map((r) => r.capability_ref), ['external:offer.select']);
    assert.equal(await f.count(`SELECT count(*)::text AS n FROM budget_commitments WHERE workspace_id = $1 AND status = 'HELD'`), 1, 'costed intent holds budget');
    assert.equal(await f.count('SELECT count(*)::text AS n FROM execution_attempts WHERE workspace_id = $1'), 0, 'approval executes nothing');

    // Ceiling is the authority-frozen cost: make the scripted payable equal to it.
    const ceiling = Number(stored.rows[0]!.cost_amount);
    const live = scriptedProvider(f.c.pool, f.ws, { payable: ceiling });
    const report = await runExternalOfferExecutionPass(f.execCtx(live.deps));
    assert.equal(report.executed, 1, JSON.stringify(report.outcomes));
    assert.deepEqual(live.calls, { verify: 1, create: 1, pay: 1, retrieve: live.calls.retrieve }, 'exactly one order creation and one payment');
    // Durable attempt written before network: at BOTH mutations the attempt row already read DISPATCHING.
    assert.deepEqual(live.statusesAtMutation, [['DISPATCHING'], ['DISPATCHING']]);
    const [attempt] = await f.attempts();
    assert.equal(attempt!.status, 'OBSERVED_SUCCESS');
    const observation = await f.c.pool.query<{ external_record_id: string; origin: string; ref: string }>(`SELECT external_record_id, origin, source_owned_fields->>'providerOrderRef' AS ref FROM execution_observations WHERE workspace_id = $1`, [f.ws]);
    assert.deepEqual(observation.rows.map((r) => [r.origin, r.ref]), [['EXTERNAL_PROVIDER', 'ORDER-1']], 'provider result observed');
    assert.equal(observation.rows[0]!.external_record_id, externalRecordIdForOrder('ORDER-1'));

    // Canonical update: the journey item now selects a new confirmed service.
    const after = await f.selectedService();
    assert.notDeepEqual(after, before);
    const created = after.filter((id) => !before.includes(id));
    assert.equal(created.length, 1, 'exactly one new service selected');
    assert.equal(await f.count(`SELECT count(*)::text AS n FROM reservations WHERE workspace_id = $1 AND observed_status = 'CONFIRMED' AND id IN (SELECT rl.reservation_id FROM reservation_lines rl JOIN transport_line_details d ON d.workspace_id = rl.workspace_id AND d.line_id = rl.id WHERE rl.workspace_id = $1 AND d.transport_service_id = $2::uuid)`, created[0]), 1, 'a CONFIRMED reservation backs the new service');

    // No blind redispatch: further passes do nothing and the provider is not called again.
    for (let i = 0; i < 3; i += 1) assert.equal((await runExternalOfferExecutionPass(f.execCtx(live.deps))).candidates, 0);
    assert.deepEqual([live.calls.verify, live.calls.create, live.calls.pay], [1, 1, 1]);

    // Reassessment sees the mutated aggregate; C4 resolves from CURRENT truth.
    await f.c.drain();
    assert.equal(await f.c.verdict(f.c.world.people[0]!.journeyId), 'PASS');
    await f.wake();
    const status = await f.c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [f.ws, f.c.caseId]);
    assert.equal(status.rows[0]!.lifecycle_status, 'RESOLVED');
    await f.c.app.close();
  });

  test('provider says PRICE_CHANGED at verify: classified OBSERVED_FAILURE, no mutation, no retry, state unchanged, case not resolved', async () => {
    const f = await plannedTransportCase('R4F2 price changed');
    { const a = await f.approve(); assert.equal(a.ok, true, JSON.stringify(a)); }
    const provider = scriptedProvider(f.c.pool, f.ws, { verify: 'PRICE_CHANGED' });
    const before = await f.selectedService();
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.failed, 1, JSON.stringify(report.outcomes));
    assert.deepEqual(provider.calls, { verify: 1, create: 0, pay: 0, retrieve: 0 });
    assert.deepEqual((await f.attempts()).map((a) => a.status), ['OBSERVED_FAILURE']);
    for (let i = 0; i < 2; i += 1) assert.equal((await runExternalOfferExecutionPass(f.execCtx(provider.deps))).candidates, 0, 'a failed attempt is never blindly retried');
    assert.equal(provider.calls.verify, 1);
    assert.deepEqual(await f.selectedService(), before, 'no fake success in canonical state');
    await f.wake();
    const status = await f.c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [f.ws, f.c.caseId]);
    assert.notEqual(status.rows[0]!.lifecycle_status, 'RESOLVED');
    await f.c.app.close();
  });

  test('payable above the authority-frozen ceiling: order held, payment NEVER issued', async () => {
    const f = await plannedTransportCase('R4F2 ceiling');
    { const a = await f.approve(); assert.equal(a.ok, true, JSON.stringify(a)); }
    const provider = scriptedProvider(f.c.pool, f.ws, { payable: 1_000_000 });
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.failed, 1, JSON.stringify(report.outcomes));
    assert.deepEqual([provider.calls.create, provider.calls.pay], [1, 0]);
    assert.match(report.outcomes[0]!.detail ?? '', /payable_exceeds_ceiling/);
    await f.c.app.close();
  });

  test('lost create response => OUTCOME_UNKNOWN; repeated passes never redispatch; reconcile with no order ref stays unknown (human-owned)', async () => {
    const f = await plannedTransportCase('R4F2 unknown create');
    { const a = await f.approve(); assert.equal(a.ok, true, JSON.stringify(a)); }
    const provider = scriptedProvider(f.c.pool, f.ws, { create: 'TIMEOUT' });
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.unknown, 1, JSON.stringify(report.outcomes));
    assert.deepEqual((await f.attempts()).map((a) => a.status), ['OUTCOME_UNKNOWN']);
    for (let i = 0; i < 3; i += 1) assert.equal((await runExternalOfferExecutionPass(f.execCtx(provider.deps))).candidates, 0);
    assert.equal(provider.calls.create, 1, 'unknown outcome is never blindly redispatched');
    const reconciled = await runExternalReconciliation(f.execCtx(provider.deps));
    assert.equal(reconciled.reconciled, 0);
    assert.equal(reconciled.stillUnknown, 1);
    assert.equal(provider.calls.create, 1);
    assert.equal(provider.calls.pay, 0);
    await f.wake();
    const status = await f.c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [f.ws, f.c.caseId]);
    assert.notEqual(status.rows[0]!.lifecycle_status, 'RESOLVED');
    await f.c.app.close();
  });

  test('lost pay response => OUTCOME_UNKNOWN with the order ref; reconcile (read-only) observes TICKETED => canonical update; still one create and one pay', async () => {
    const f = await plannedTransportCase('R4F2 unknown pay');
    const approved = await f.approve();
    assert.equal(approved.ok, true);
    const cost = (await f.c.pool.query<{ cost_amount: string }>('SELECT cost_amount::text AS cost_amount FROM action_intents WHERE workspace_id = $1', [f.ws])).rows[0]!.cost_amount;
    const provider = scriptedProvider(f.c.pool, f.ws, { payable: Number(cost), pay: 'TIMEOUT', retrieve: 'PAID' });
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.unknown, 1, JSON.stringify(report.outcomes));
    const [unknown] = await f.attempts();
    assert.equal(unknown!.status, 'OUTCOME_UNKNOWN');
    assert.equal(unknown!.request_ref, 'atlas:order:ORDER-1', 'the order ref is persisted so reconciliation can look it up');
    const before = await f.selectedService();

    // Provider still reports PAID (not yet ticketed): stays unknown, nothing redispatched.
    const still = await runExternalReconciliation(f.execCtx(provider.deps));
    assert.equal(still.stillUnknown, 1);
    assert.deepEqual(await f.selectedService(), before);

    // Provider now reports TICKETED: reconciliation observes success and applies the canonical update.
    const ticketed = scriptedProvider(f.c.pool, f.ws, { payable: Number(cost), retrieve: 'TICKETED' });
    const done = await runExternalReconciliation(f.execCtx(ticketed.deps));
    assert.equal(done.reconciled, 1);
    assert.equal(done.canonicalUpdates, 1);
    assert.deepEqual((await f.attempts()).map((a) => a.status), ['OBSERVED_SUCCESS']);
    assert.notDeepEqual(await f.selectedService(), before);
    assert.deepEqual([provider.calls.create, provider.calls.pay, ticketed.calls.create, ticketed.calls.pay], [1, 1, 0, 0], 'reconciliation never mutates');
    await f.c.app.close();
  });
});

describe('A3 external execution and demo reset exclusion (real PostgreSQL)', () => {
  const resetEnv = {
    APP_ENVIRONMENT: 'local',
    NORTHSTAR_DEMO_RESET: '1',
    NORTHSTAR_DEMO_DATASET_DIR: resolve('fixtures/programmes/ait-summit-2026'),
  } as NodeJS.ProcessEnv;

  test('every external attempt status blocks reset, while an internal programme attempt does not', async () => {
    const f = await plannedTransportCase('A3 reset external status');
    const approved = await f.approve();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const provider = scriptedProvider(f.c.pool, f.ws, { verify: 'PRICE_CHANGED' });
    await runExternalOfferExecutionPass(f.execCtx(provider.deps));

    for (const status of [
      'PREPARED', 'CLAIMED', 'DISPATCHING', 'DISPATCHED', 'OUTCOME_UNKNOWN',
      'RECONCILIATION_REQUIRED', 'OBSERVED_SUCCESS', 'OBSERVED_FAILURE',
      'RECONCILED', 'COMPLETED', 'FAILED',
    ]) {
      await f.c.pool.query('UPDATE execution_attempts SET status = $2 WHERE workspace_id = $1', [f.ws, status]);
      const blocker = await findExternalExecutionResetBlocker(f.c.pool, f.ws);
      assert.deepEqual(blocker, { capabilityRef: 'external:offer.select', status });
    }

    await f.c.pool.query(
      `UPDATE execution_attempts
          SET status = 'OUTCOME_UNKNOWN', request_ref = 'atlas:order:ORDER-1'
        WHERE workspace_id = $1`,
      [f.ws],
    );
    const reset = await resetDemoWorkspace({
      pool: f.c.pool, uow: () => f.c.app.unitOfWork(), workspaceId: f.ws, env: resetEnv,
    });
    assert.equal(reset.status, 'REFUSED');
    if (reset.status === 'REFUSED') assert.equal(reset.code, 'EXTERNAL_EXECUTION_HISTORY_PRESENT');
    assert.deepEqual(await f.attempts(), [{ status: 'OUTCOME_UNKNOWN', request_ref: 'atlas:order:ORDER-1', attempt_number: 1 }], 'refused reset preserves the durable reconciliation reference');
    await f.c.app.close();

    const internal = await plannedTransportCase('A3 reset internal attempt');
    const strategy = (await internal.c.pool.query<{ id: string; scenario_change_id: string }>(
      `SELECT id, scenario_change->>'id' AS scenario_change_id
         FROM recovery_strategies WHERE workspace_id = $1 AND recovery_case_id = $2 LIMIT 1`,
      [internal.ws, internal.c.caseId],
    )).rows[0]!;
    const planId = randomUUID();
    const intentId = randomUUID();
    await internal.c.pool.query(
      `INSERT INTO action_plans (workspace_id, id, recovery_case_id, scenario_change_id, recovery_strategy_id, created_by_actor_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [internal.ws, planId, internal.c.caseId, strategy.scenario_change_id, strategy.id, internal.c.world.actorId],
    );
    await internal.c.pool.query(
      `INSERT INTO action_intents (
         workspace_id, id, action_plan_id, operation_namespace, logical_operation_key, request_fingerprint,
         capability_ref, subject_refs, expected_observations, compensation_supported,
         compensation_requires_separate_authority, status, created_by_actor_id
       ) VALUES ($1,$2,$3,'internal.programme',$4,$5,'internal:programme.schedule',$6::jsonb,$7::jsonb,false,true,'AUTHORIZED',$8)`,
      [
        internal.ws, intentId, planId, `programme:${intentId}`, `fingerprint:${intentId}`,
        JSON.stringify([{ kind: 'PROGRAMME_ITEM', id: randomUUID() }]),
        JSON.stringify(['INTERNAL_COMMAND_RECEIPT:programme_schedule']), internal.c.world.actorId,
      ],
    );
    await internal.c.pool.query(
      `INSERT INTO execution_attempts (
         workspace_id, id, action_intent_id, attempt_number, logical_operation_key, request_fingerprint, status, created_by_actor_id
       ) VALUES ($1,$2,$3,1,$4,$5,'COMPLETED',$6)`,
      [internal.ws, randomUUID(), intentId, `programme:${intentId}`, `fingerprint:${intentId}`, internal.c.world.actorId],
    );
    assert.equal(await findExternalExecutionResetBlocker(internal.c.pool, internal.ws), undefined, 'internal programme execution does not consume the persistent demo reset');
    await internal.c.app.close();
  });

  test('reset is denied while a provider call holds the workspace lease, without deleting state', async () => {
    const f = await plannedTransportCase('A3 reset concurrent provider');
    const approved = await f.approve();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const provider = scriptedProvider(f.c.pool, f.ws, { payable: 5 });
    const baseVerify = provider.deps.flight.verifyOffer;
    let entered!: () => void;
    const enteredProviderCall = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    let release!: () => void;
    const releaseProviderCall = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    provider.deps.flight.verifyOffer = async (input) => {
      entered();
      await releaseProviderCall;
      return baseVerify(input);
    };

    const running = runExternalExecutionCycle(f.execCtx(provider.deps));
    await enteredProviderCall;
    const attemptsBefore = await f.count('SELECT count(*)::text AS n FROM execution_attempts WHERE workspace_id = $1');
    const reset = await resetDemoWorkspace({
      pool: f.c.pool, uow: () => f.c.app.unitOfWork(), workspaceId: f.ws, env: resetEnv,
    });
    assert.equal(reset.status, 'IN_PROGRESS');
    assert.equal(await f.count('SELECT count(*)::text AS n FROM execution_attempts WHERE workspace_id = $1'), attemptsBefore, 'reset did not delete the live attempt');
    release();
    const cycle = await running;
    assert.equal(cycle.leaseUnavailable, false);
    assert.equal(provider.calls.create, 1, 'the already-live cycle, not reset, owns the one provider create');
    await f.c.app.close();
  });

  test('an external cycle that cannot acquire the reset lease loads no candidates and makes no provider call', async () => {
    const f = await plannedTransportCase('A3 reset queued external pass');
    const approved = await f.approve();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const provider = scriptedProvider(f.c.pool, f.ws, { payable: 5 });
    const lease = await tryAcquireWorkspaceOperationLease(f.c.pool, f.ws);
    assert.ok(lease);
    try {
      const cycle = await runExternalExecutionCycle(f.execCtx(provider.deps));
      assert.equal(cycle.leaseUnavailable, true);
      assert.equal(cycle.report.candidates, 0);
      assert.deepEqual(provider.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 });
    } finally {
      await lease.release();
    }
    await f.c.app.close();
  });
});
