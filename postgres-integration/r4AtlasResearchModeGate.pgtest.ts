/**
 * R4-F2f (N4) — a REPLAY/SIMULATED-researched binding must never become a live money-moving input.
 *
 * `offer_execution_bindings.research_mode` is durable. The protected execution preflight
 * (`resolveOfferExecutionInputs*`) is the ONE probe behind approval, the execution boundary and the
 * read model, so the gate is enforced identically in all three:
 *   - read model  -> `executionBlocker` FRESH_PROVIDER_QUOTE_REQUIRED (plain language)
 *   - approval    -> refused with the same code before any authority/plan/budget is minted
 *   - execution   -> REFUSED before any attempt or network call (even if an approval already exists)
 * RECORD / LIVE bindings stay eligible subject to the normal gates. An executor that is not
 * LIVE/RECORD never mutates. The price/offer-drift path (PRICE_CHANGED / payable above ceiling)
 * is proved in r4AtlasOfferExecution.pgtest.ts (zero mutation, no retry, re-enter viability/authority).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { plannedTransportCase, stampBindingResearchMode } from './r4TransportWorld.ts';
import { approveRecoveryStrategy, externalExecutionBlockerForStrategyId } from '../src/app/target/recoveryApproval.ts';
import { EXTERNAL_OFFER_SELECT_STATEMENTS, runExternalOfferExecutionPass, type ExternalOfferExecutionDeps } from '../src/app/target/externalOfferExecution.ts';
import { ATLAS_SANDBOX_BALANCE_PAYMENT_REF } from '../src/providers/atlas/transactionAdapter.ts';
import { capabilityOk } from '../src/contracts/envelope.ts';
import type { AdapterMode, CapabilityMeta } from '../src/contracts/envelope.ts';
import type { FlightTransactionCapability } from '../src/contracts/capabilities.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function countingProvider(mode: AdapterMode, payable?: number) {
  const calls = { verify: 0, create: 0, pay: 0, retrieve: 0 };
  const meta = (): CapabilityMeta => ({ providerId: 'atlas', mode, requestedAt: new Date().toISOString() });
  const transactions = {
    descriptor: { family: 'FLIGHT', providerId: 'atlas', mode, supportedOperations: [], maxSideEffectLevel: 'MONEY_MOVING' },
    async createOrder() { calls.create += 1; return capabilityOk({ status: 'HELD' as const, provenance: 'LIVE' as const, transactionState: { orderRef: 'O-1' }, totalPrice: { amount: payable ?? 1, currency: 'USD' } }, meta()); },
    async payOrder() { calls.pay += 1; return capabilityOk({ status: 'PAID' as const, provenance: 'LIVE' as const }, meta()); },
    async retrieveOrder() { calls.retrieve += 1; return capabilityOk({ orderRef: 'O-1', status: 'TICKETED' as const, provenance: 'LIVE' as const }, meta()); },
  } as unknown as FlightTransactionCapability;
  const deps: ExternalOfferExecutionDeps = {
    flight: { async verifyOffer() { calls.verify += 1; return capabilityOk({ status: 'VERIFIED' as const, workflowState: { sessionId: 's' } }, meta()); } } as never,
    transactions, mode, paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF, ticketingPoll: { attempts: 1, delayMs: 0 }, sleep: async () => undefined,
  };
  return { calls, deps };
}
const ZERO = { verify: 0, create: 0, pay: 0, retrieve: 0 };

describe('R4-F2f N4 research-mode gate (real PostgreSQL)', () => {
  test('REPLAY-researched option: read model + approval refuse with FRESH_PROVIDER_QUOTE_REQUIRED; nothing is minted or executed; a RECORD/LIVE quote is eligible', async () => {
    const f = await plannedTransportCase('R4F2f replay binding', { researchMode: 'REPLAY' });
    const blocker = await externalExecutionBlockerForStrategyId(f.c.pool, f.ws, f.strategyId, EXTERNAL_OFFER_SELECT_STATEMENTS);
    assert.equal(blocker?.code, 'FRESH_PROVIDER_QUOTE_REQUIRED');
    assert.match(blocker!.message, /fresh live price check/i);
    assert.doesNotMatch(blocker!.message, /REPLAY|SIMULATED|RECORD|routing/, 'plain language, no internals');

    const refused = await approveRecoveryStrategy(
      { pool: f.c.pool, workspaceId: f.ws, actorPrincipalId: f.c.world.actorId, uow: () => f.c.app.unitOfWork(), now: f.c.now, executorPrincipalId: f.c.executorPrincipalId, externalCapabilities: EXTERNAL_OFFER_SELECT_STATEMENTS },
      { caseId: f.c.caseId, strategyId: f.strategyId, approverPrincipalId: f.c.operatorPrincipalId },
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, 'FRESH_PROVIDER_QUOTE_REQUIRED');
    assert.equal(await f.count('SELECT count(*)::text AS n FROM action_plans WHERE workspace_id = $1'), 0);
    assert.equal(await f.count('SELECT count(*)::text AS n FROM authority_decisions WHERE workspace_id = $1'), 0);
    assert.equal(await f.count('SELECT count(*)::text AS n FROM budget_commitments WHERE workspace_id = $1'), 0);
    const idle = countingProvider('RECORD');
    assert.equal((await runExternalOfferExecutionPass(f.execCtx(idle.deps))).candidates, 0);
    assert.deepEqual(idle.calls, ZERO);

    // SIMULATED is no more live than REPLAY; a provider-backed quote (RECORD/LIVE) is eligible (normal gates still apply).
    await stampBindingResearchMode(f.c.pool, f.ws, 'SIMULATED');
    assert.equal((await externalExecutionBlockerForStrategyId(f.c.pool, f.ws, f.strategyId, EXTERNAL_OFFER_SELECT_STATEMENTS))?.code, 'FRESH_PROVIDER_QUOTE_REQUIRED');
    for (const mode of ['RECORD', 'LIVE'] as const) {
      await stampBindingResearchMode(f.c.pool, f.ws, mode);
      assert.equal(await externalExecutionBlockerForStrategyId(f.c.pool, f.ws, f.strategyId, EXTERNAL_OFFER_SELECT_STATEMENTS), undefined, `${mode} binding is eligible`);
    }
    await f.c.app.close();
  });

  test('execution-time preflight: an already-approved intent whose binding is REPLAY is REFUSED before any attempt or provider call', async () => {
    const f = await plannedTransportCase('R4F2f replay at execution');
    const approved = await f.approve();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    await stampBindingResearchMode(f.c.pool, f.ws, 'REPLAY'); // a replay binding reaches the executor
    const provider = countingProvider('RECORD');
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.candidates, 1);
    assert.equal(report.refused, 1, JSON.stringify(report.outcomes));
    assert.match(report.outcomes[0]!.detail ?? '', /FRESH_PROVIDER_QUOTE_REQUIRED/);
    assert.equal(await f.count('SELECT count(*)::text AS n FROM execution_attempts WHERE workspace_id = $1'), 0, 'no attempt row');
    assert.deepEqual(provider.calls, ZERO, 'no provider call of any kind');

    // With a provider-backed quote the very same approved intent executes under the normal gates.
    await stampBindingResearchMode(f.c.pool, f.ws, 'LIVE');
    const cost = Number((await f.c.pool.query<{ cost_amount: string }>('SELECT cost_amount::text AS cost_amount FROM action_intents WHERE workspace_id = $1', [f.ws])).rows[0]!.cost_amount);
    const live = countingProvider('RECORD', cost);
    const ran = await runExternalOfferExecutionPass(f.execCtx(live.deps));
    assert.equal(ran.executed, 1, JSON.stringify(ran.outcomes));
    assert.deepEqual([live.calls.create, live.calls.pay], [1, 1]);
    await f.c.app.close();
  });

  test('an executor that is not LIVE/RECORD never mutates, even for a RECORD-researched approved intent', async () => {
    const f = await plannedTransportCase('R4F2f replay executor');
    const approved = await f.approve();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const provider = countingProvider('REPLAY');
    const report = await runExternalOfferExecutionPass(f.execCtx(provider.deps));
    assert.equal(report.refused, 1, JSON.stringify(report.outcomes));
    assert.match(report.outcomes[0]!.detail ?? '', /EXECUTOR_MODE_NOT_LIVE/);
    assert.equal(await f.count('SELECT count(*)::text AS n FROM execution_attempts WHERE workspace_id = $1'), 0);
    assert.deepEqual(provider.calls, ZERO);
    await f.c.app.close();
  });
});
