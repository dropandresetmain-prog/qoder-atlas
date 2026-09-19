/**
 * R4-F2d (N1) — crash / fault injection for the external Atlas execution path.
 *
 * A "crash" is simulated by a fault point (`ExternalOfferExecutionDeps.faultInjection`) that
 * never resolves: the dispatcher hangs exactly there and never writes another byte, as if the
 * process died. "Restart" is a fresh scripted provider (own call log) + the reconciliation
 * sweep after the dead dispatcher's lease lapsed.
 *
 * Proved here (real PostgreSQL, scripted provider counting every call):
 *   A crash after the create response, before the orderRef checkpoint  -> no ref => unknown, human
 *   B crash after the orderRef checkpoint, before pay                  -> ref durable, read-only reconcile
 *   C crash after a successful pay, before the post-pay observation
 *   D crash after provider ticketing, before the local final outcome write
 *   E every restart performs ZERO create/pay calls (and a live lease is never swept)
 *   F provider TICKETED -> observed success -> canonical update
 *   G provider HELD / unknown / PAID / CANCELLED -> truthful non-success, never assumed
 *   H checkpoint write failure -> the order is never paid
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { plannedTransportCase } from './r4TransportWorld.ts';
import {
  runExternalOfferExecutionPass, runExternalReconciliation, type DispatchFaultPoint, type ExternalOfferExecutionDeps,
} from '../src/app/target/externalOfferExecution.ts';
import { PgExecutionWorker } from '../src/persistence/postgres/execution/pgExecutionWorker.ts';
import { ATLAS_SANDBOX_BALANCE_PAYMENT_REF } from '../src/providers/atlas/transactionAdapter.ts';
import { capabilityOk } from '../src/contracts/envelope.ts';
import type { CapabilityMeta } from '../src/contracts/envelope.ts';
import type { FlightOrderIdentity, FlightOrderOutcome, FlightOrderStatus, FlightTransactionCapability } from '../src/contracts/capabilities.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

/** The provider-side truth that survives a process crash. */
interface ProviderWorld { orderRef?: string; status: FlightOrderStatus; holdExpiresAt?: string; payable: number; payLandsAs?: FlightOrderStatus;
  /** N3: the provider answers create with duplicate detection pointing at this existing order. */
  duplicateRef?: string; identity?: FlightOrderIdentity }

function scriptedProvider(world: ProviderWorld, faultAt?: DispatchFaultPoint, onFault?: () => Promise<void>, hang = true) {
  const calls = { verify: 0, create: 0, pay: 0, retrieve: 0 };
  const meta = (): CapabilityMeta => ({ providerId: 'atlas', mode: 'RECORD', requestedAt: new Date().toISOString() });
  const outcome = (status: FlightOrderStatus): FlightOrderOutcome => ({
    status, provenance: 'LIVE', totalPrice: { amount: world.payable, currency: 'USD' }, transactionState: { orderRef: world.orderRef! },
  });
  const transactions: FlightTransactionCapability = {
    descriptor: { family: 'FLIGHT', providerId: 'atlas', mode: 'RECORD', supportedOperations: [], maxSideEffectLevel: 'MONEY_MOVING' },
    async createOrder() {
      calls.create += 1;
      if (world.duplicateRef) {
        world.orderRef = world.duplicateRef;
        return capabilityOk({ status: 'HELD' as const, provenance: 'LIVE' as const, duplicateOfExisting: { orderRefs: [world.duplicateRef] }, transactionState: { orderRef: world.duplicateRef } }, meta());
      }
      world.orderRef = 'ORDER-1'; world.status = 'HELD';
      return capabilityOk(outcome('HELD'), meta());
    },
    async payOrder() {
      calls.pay += 1;
      world.status = world.payLandsAs ?? 'PAID';
      return capabilityOk(outcome('PAID'), meta());
    },
    async retrieveOrder(query) {
      calls.retrieve += 1;
      return capabilityOk({
        orderRef: query.orderRef, status: world.status, provenance: 'LIVE' as const, totalPrice: { amount: world.payable, currency: 'USD' },
        ...(world.identity ? { identity: world.identity } : {}),
        ...(world.holdExpiresAt ? { transactionState: { orderRef: query.orderRef, holdExpiresAt: world.holdExpiresAt } } : {}),
      }, meta());
    },
    async quoteCancellation() { throw new Error('cancellation is not reachable from offer selection'); },
    async submitCancellation() { throw new Error('cancellation is not reachable from offer selection'); },
    async retrieveCancellationStatus() { throw new Error('cancellation is not reachable from offer selection'); },
  };
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => { reachedResolve = resolve; });
  const deps: ExternalOfferExecutionDeps = {
    flight: { async verifyOffer() { calls.verify += 1; return capabilityOk({ status: 'VERIFIED', workflowState: { sessionId: 'session-1' } }, meta()); } },
    transactions, mode: 'RECORD', paymentRef: ATLAS_SANDBOX_BALANCE_PAYMENT_REF,
    ticketingPoll: { attempts: 2, delayMs: 0 }, sleep: async () => undefined,
    ...(faultAt ? {
      faultInjection: async (point: DispatchFaultPoint) => {
        if (point !== faultAt) return;
        if (onFault) await onFault();
        reachedResolve();
        if (hang) await new Promise<void>(() => undefined); // the process died here: never resumes
      },
    } : {}),
  };
  return { calls, deps, reached };
}

async function setup(label: string) {
  const f = await plannedTransportCase(label);
  const approved = await f.approve();
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const cost = Number((await f.c.pool.query<{ cost_amount: string }>('SELECT cost_amount::text AS cost_amount FROM action_intents WHERE workspace_id = $1', [f.ws])).rows[0]!.cost_amount);
  const attempt = async () => (await f.c.pool.query<{ status: string; request_ref: string | null; last_error: string | null }>(
    'SELECT status, request_ref, last_error FROM execution_attempts WHERE workspace_id = $1 ORDER BY created_at', [f.ws],
  )).rows;
  const expireLease = () => f.c.pool.query(`UPDATE execution_attempts SET lease_expires_at = now() - interval '1 second' WHERE workspace_id = $1`, [f.ws]);
  /** Run the pass until the dispatcher "dies" at the fault point (the pass promise never settles). */
  const crashAt = async (world: ProviderWorld, point: DispatchFaultPoint, onFault?: () => Promise<void>) => {
    const dying = scriptedProvider(world, point, onFault);
    void runExternalOfferExecutionPass(f.execCtx(dying.deps)).catch(() => undefined);
    await dying.reached;
    return dying;
  };
  const status = async () => (await f.c.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [f.ws, f.c.caseId])).rows[0]!.lifecycle_status;
  return { f, cost, attempt, expireLease, crashAt, status };
}

/** Assertions common to every crash: the attempt is DISPATCHING, a live lease is never swept, the attempt is never dispatch-eligible. */
async function assertDeadDispatcher(t: Awaited<ReturnType<typeof setup>>, expectedRef: string | null, dying: ReturnType<typeof scriptedProvider>) {
  const [row] = await t.attempt();
  assert.equal(row!.status, 'DISPATCHING');
  assert.equal(row!.request_ref, expectedRef);
  // E: a live (unexpired) lease is never swept by another process.
  const idle = scriptedProvider({ status: 'HELD', payable: t.cost });
  const early = await runExternalReconciliation(t.f.execCtx(idle.deps));
  assert.deepEqual([early.reconciled, early.stillUnknown], [0, 0]);
  assert.deepEqual(idle.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 });
  assert.equal((await t.attempt())[0]!.status, 'DISPATCHING');
  assert.deepEqual([dying.calls.create, dying.calls.pay], [1, dying.calls.pay]);
}

async function assertNeverDispatchEligible(t: Awaited<ReturnType<typeof setup>>) {
  const idle = scriptedProvider({ status: 'HELD', payable: t.cost });
  for (let i = 0; i < 3; i += 1) assert.equal((await runExternalOfferExecutionPass(t.f.execCtx(idle.deps))).candidates, 0, 'a DISPATCHING/reconciling attempt is never a dispatch candidate');
  assert.equal(await new PgExecutionWorker(t.f.c.pool, { actorId: 'crash-test' }).claimNext(t.f.ws), undefined, 'the generic claimer never reclaims a dispatching attempt');
  assert.deepEqual(idle.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 });
}

/** YYYYMMDDHHmm wall clock of an instant in an IANA zone (what Atlas reports). */
function localWall(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts['year']}${parts['month']}${parts['day']}${parts['hour']}${parts['minute']}`;
}

async function duplicateIdentity(t: Awaited<ReturnType<typeof setup>>, over: Partial<FlightOrderIdentity> = {}): Promise<FlightOrderIdentity> {
  const b = (await t.f.c.pool.query<{ itinerary: { departure: string; arrival: string } }>('SELECT itinerary FROM offer_execution_bindings WHERE workspace_id = $1', [t.f.ws])).rows[0]!.itinerary;
  return {
    passengers: [{ familyName: 'CONNECTION', givenName: 'JANE', gender: 'FEMALE', nationality: 'PH' }],
    contactEmails: ['r4.traveller@example.com'],
    segments: [{ originCode: 'MNL', destinationCode: 'CEB', departureLocal: localWall(b.departure, 'Asia/Manila'), arrivalLocal: localWall(b.arrival, 'Asia/Manila') }],
    ...over,
  };
}

describe('R4-F2e N3 duplicate detection is a pointer, not proof (real PostgreSQL, real expected-terms loader)', () => {
  test('exact intended duplicate (proven from persisted binding + identities) is adopted, checkpointed and paid exactly once', async () => {
    const t = await setup('R4F2e duplicate match');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost, duplicateRef: 'TESTA-EXISTING', payLandsAs: 'TICKETED' };
    world.identity = await duplicateIdentity(t);
    const provider = scriptedProvider(world);
    const report = await runExternalOfferExecutionPass(t.f.execCtx(provider.deps));
    assert.equal(report.executed, 1, JSON.stringify(report.outcomes));
    assert.deepEqual([provider.calls.create, provider.calls.pay], [1, 1]);
    const [row] = await t.attempt();
    assert.equal(row!.status, 'OBSERVED_SUCCESS');
    assert.equal(row!.request_ref, 'atlas:order:TESTA-EXISTING');
    await t.f.c.app.close();
  });

  test('a duplicate that is provably NOT this intents order (wrong traveller) is neither adopted nor paid: OBSERVED_FAILURE, no order ref stored', async () => {
    const t = await setup('R4F2e duplicate mismatch');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost, duplicateRef: 'TESTA-STRANGER' };
    world.identity = await duplicateIdentity(t, { passengers: [{ familyName: 'STRANGER', givenName: 'SAM', gender: 'FEMALE' }] });
    const provider = scriptedProvider(world);
    const report = await runExternalOfferExecutionPass(t.f.execCtx(provider.deps));
    assert.equal(report.failed, 1, JSON.stringify(report.outcomes));
    assert.match(report.outcomes[0]!.detail ?? '', /duplicate_order_mismatch/);
    assert.equal(provider.calls.pay, 0);
    const [row] = await t.attempt();
    assert.equal(row!.status, 'OBSERVED_FAILURE');
    assert.equal(row!.request_ref, null);
    await t.f.c.app.close();
  });

  test('a duplicate whose identity the provider does not expose fails closed: OUTCOME_UNKNOWN for a human, never paid, no reconcile lookup', async () => {
    const t = await setup('R4F2e duplicate insufficient');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost, duplicateRef: 'TESTA-OPAQUE' };
    const provider = scriptedProvider(world);
    const report = await runExternalOfferExecutionPass(t.f.execCtx(provider.deps));
    assert.equal(report.unknown, 1, JSON.stringify(report.outcomes));
    assert.equal(provider.calls.pay, 0);
    const [row] = await t.attempt();
    assert.equal(row!.status, 'OUTCOME_UNKNOWN');
    assert.match(row!.request_ref ?? '', /^atlas:duplicate-unproven:TESTA-OPAQUE:/);
    const retrievesBefore = provider.calls.retrieve;
    const swept = await runExternalReconciliation(t.f.execCtx(provider.deps));
    assert.deepEqual([swept.reconciled, swept.stillUnknown], [0, 1]);
    assert.equal(provider.calls.retrieve, retrievesBefore, 'an unproven pointer is never a reconcile key');
    assert.equal(provider.calls.pay, 0);
    await t.f.c.app.close();
  });
});

describe('R4-F2d N1 crash recovery of the external Atlas execution path (real PostgreSQL)', () => {
  test('A: crash after the create response, BEFORE the orderRef checkpoint => no reference on disk => OUTCOME_UNKNOWN for a human; zero provider calls on restart; never redispatched', async () => {
    const t = await setup('R4F2d crash A');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost };
    const dying = await t.crashAt(world, 'AFTER_CREATE');
    await assertDeadDispatcher(t, null, dying);
    await assertNeverDispatchEligible(t);

    await t.expireLease();
    await assertNeverDispatchEligible(t);
    const restart = scriptedProvider(world);
    const swept = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([swept.reconciled, swept.stillUnknown], [0, 1], 'stale attempt enters reconciliation; without a reference nothing can be looked up');
    const [row] = await t.attempt();
    assert.equal(row!.status, 'RECONCILIATION_REQUIRED');
    assert.match(row!.last_error ?? '', /stale_dispatch_lease_expired/);
    for (let i = 0; i < 2; i += 1) await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual(restart.calls, { verify: 0, create: 0, pay: 0, retrieve: 0 }, 'no reference => not even a read; and never a create or pay');
    assert.equal(dying.calls.pay, 0, 'the crashed dispatcher never paid');
    assert.notEqual(await t.status(), 'RESOLVED');
    await t.f.c.app.close();
  });

  test('B: crash after the orderRef checkpoint, before pay => reference durable; read-only reconcile; HELD stays unknown until the hold lapses, then a truthful failure', async () => {
    const t = await setup('R4F2d crash B');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost };
    const dying = await t.crashAt(world, 'AFTER_CHECKPOINT');
    await assertDeadDispatcher(t, 'atlas:order:ORDER-1', dying);
    assert.equal(dying.calls.pay, 0);
    await t.expireLease();
    await assertNeverDispatchEligible(t);

    // Restart: provider still HELD, hold not lapsed. A single HELD reading cannot exclude an in-flight pay => unknown.
    const restart = scriptedProvider(world);
    const first = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([first.reconciled, first.stillUnknown], [0, 1]);
    assert.equal((await t.attempt())[0]!.status, 'RECONCILIATION_REQUIRED');
    assert.ok(restart.calls.retrieve >= 1, 'reconciliation used the durable reference (read-only)');
    assert.deepEqual([restart.calls.verify, restart.calls.create, restart.calls.pay], [0, 0, 0]);

    // The hold lapses unpaid: nothing can land any more => truthful OBSERVED_FAILURE, no canonical update.
    world.holdExpiresAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const before = await t.f.selectedService();
    const lapsed = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.equal(lapsed.reconciled, 1);
    assert.equal((await t.attempt())[0]!.status, 'OBSERVED_FAILURE');
    assert.deepEqual(await t.f.selectedService(), before);
    assert.deepEqual([restart.calls.verify, restart.calls.create, restart.calls.pay], [0, 0, 0]);
    assert.notEqual(await t.status(), 'RESOLVED');
    await t.f.c.app.close();
  });

  test('C: crash after a SUCCESSFUL pay, before the post-pay observation => reference durable; PAID stays unknown; TICKETED => observed success + canonical update; restart never creates or pays', async () => {
    const t = await setup('R4F2d crash C');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost };
    const dying = await t.crashAt(world, 'AFTER_PAY');
    await assertDeadDispatcher(t, 'atlas:order:ORDER-1', dying);
    assert.equal(dying.calls.pay, 1);
    assert.equal(world.status, 'PAID');
    await t.expireLease();
    await assertNeverDispatchEligible(t);

    const before = await t.f.selectedService();
    const restart = scriptedProvider(world);
    const paid = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([paid.reconciled, paid.stillUnknown, paid.canonicalUpdates], [0, 1, 0], 'PAID is not success: ticketing not yet observed');
    assert.deepEqual(await t.f.selectedService(), before);

    world.status = 'TICKETED'; // the provider finishes ticketing while nobody was watching
    const done = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([done.reconciled, done.canonicalUpdates], [1, 1]);
    assert.equal((await t.attempt())[0]!.status, 'OBSERVED_SUCCESS');
    assert.notDeepEqual(await t.f.selectedService(), before, 'canonical update applied from the observed TICKETED order');
    assert.deepEqual([restart.calls.verify, restart.calls.create, restart.calls.pay], [0, 0, 0], 'E: restart + reconciliation performs zero create/pay calls');
    // Idempotent: further sweeps do nothing.
    const again = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([again.reconciled, again.stillUnknown, again.canonicalUpdates], [0, 0, 0]);
    await t.f.c.app.close();
  });

  test('D: crash after provider ticketing, BEFORE the local final outcome write => reconciliation observes TICKETED and completes locally; zero create/pay', async () => {
    const t = await setup('R4F2d crash D');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost, payLandsAs: 'TICKETED' };
    const dying = await t.crashAt(world, 'BEFORE_FINAL_WRITE');
    await assertDeadDispatcher(t, 'atlas:order:ORDER-1', dying);
    assert.equal(await t.f.count('SELECT count(*)::text AS n FROM execution_observations WHERE workspace_id = $1'), 0, 'the local final outcome was never written');
    await t.expireLease();
    const before = await t.f.selectedService();
    const restart = scriptedProvider(world);
    const done = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([done.reconciled, done.canonicalUpdates], [1, 1]);
    assert.equal((await t.attempt())[0]!.status, 'OBSERVED_SUCCESS');
    assert.equal(await t.f.count('SELECT count(*)::text AS n FROM execution_observations WHERE workspace_id = $1'), 1);
    assert.notDeepEqual(await t.f.selectedService(), before);
    assert.deepEqual([restart.calls.verify, restart.calls.create, restart.calls.pay], [0, 0, 0]);
    assert.equal(dying.calls.create, 1);
    assert.equal(dying.calls.pay, 1);
    await t.f.c.app.close();
  });

  test('G: provider PAID / unknown / HELD => truthful non-success (never assumed); CANCELLED => OBSERVED_FAILURE; no canonical update at any point', async () => {
    const t = await setup('R4F2d crash G');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost };
    await t.crashAt(world, 'AFTER_PAY');
    await t.expireLease();
    const before = await t.f.selectedService();
    const restart = scriptedProvider(world);
    for (const status of ['UNKNOWN', 'HELD', 'PAID', 'TICKETING'] as const) {
      world.status = status;
      const r = await runExternalReconciliation(t.f.execCtx(restart.deps));
      assert.deepEqual([r.reconciled, r.stillUnknown, r.canonicalUpdates], [0, 1, 0], `${status} must stay unknown`);
      assert.equal((await t.attempt())[0]!.status, 'RECONCILIATION_REQUIRED');
    }
    assert.deepEqual(await t.f.selectedService(), before);
    world.status = 'CANCELLED';
    const failed = await runExternalReconciliation(t.f.execCtx(restart.deps));
    assert.deepEqual([failed.reconciled, failed.canonicalUpdates], [1, 0]);
    assert.equal((await t.attempt())[0]!.status, 'OBSERVED_FAILURE');
    assert.deepEqual(await t.f.selectedService(), before);
    assert.deepEqual([restart.calls.verify, restart.calls.create, restart.calls.pay], [0, 0, 0]);
    assert.notEqual(await t.status(), 'RESOLVED');
    await t.f.c.app.close();
  });

  test('H: the reference checkpoint cannot be written (attempt fenced away) => the order is NEVER paid', async () => {
    const t = await setup('R4F2d checkpoint failure');
    const world: ProviderWorld = { status: 'HELD', payable: t.cost };
    // At the instant after create, another process takes the attempt over (fencing token moves on).
    const provider = scriptedProvider(world, 'AFTER_CREATE', async () => {
      await t.f.c.pool.query('UPDATE execution_attempts SET fencing_token = fencing_token + 1 WHERE workspace_id = $1', [t.f.ws]);
    }, false);
    const report = await runExternalOfferExecutionPass(t.f.execCtx(provider.deps));
    assert.equal(provider.calls.create, 1);
    assert.equal(provider.calls.pay, 0, 'no checkpoint => no pay');
    assert.equal(report.executed, 0);
    const [row] = await t.attempt();
    assert.equal(row!.status, 'DISPATCHING', 'the fenced-away dispatcher could not even write its own outcome');
    assert.equal(row!.request_ref, null);
    await t.f.c.app.close();
  });
});
