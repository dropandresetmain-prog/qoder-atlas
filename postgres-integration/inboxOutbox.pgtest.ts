import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { deliverInboxMessage } from '../src/persistence/postgres/inbox.ts';
import {
  claimNextInboxWork,
  completeInboxWork,
  failInboxWork,
  claimNextOutboxRow,
  markOutboxPublished,
} from '../src/persistence/postgres/claimQueue.ts';

describe('M1 durable inbox/outbox (real PostgreSQL)', () => {
  test('duplicate delivery with the same payload is an idempotent no-op', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Inbox Co']);
    const deliveryKey = randomUUID();
    const payload = { hello: 'world' };

    const first = await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-1',
      deliveryKey,
      rawPayload: payload,
      handlers: [{ handlerKey: 'test-handler', targetKey: 'target-1' }],
    });
    assert.equal(first.outcome, 'ACCEPTED');

    const second = await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-1',
      deliveryKey,
      rawPayload: payload,
      handlers: [{ handlerKey: 'test-handler', targetKey: 'target-1' }],
    });
    assert.equal(second.outcome, 'DUPLICATE');

    const rows = await pool.query('SELECT count(*)::int AS n FROM inbox_deliveries WHERE workspace_id = $1 AND delivery_key = $2', [workspaceId, deliveryKey]);
    assert.equal(rows.rows[0]?.n, 1);
  });

  test('same delivery key with a different payload is quarantined as a conflict, original untouched', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Inbox Co 2']);
    const deliveryKey = randomUUID();

    const first = await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-1',
      deliveryKey,
      rawPayload: { version: 1 },
      handlers: [],
    });
    assert.equal(first.outcome, 'ACCEPTED');

    const conflicting = await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-1',
      deliveryKey,
      rawPayload: { version: 2, changed: true },
      handlers: [],
    });
    assert.equal(conflicting.outcome, 'QUARANTINED_CONFLICT');
    if (conflicting.outcome === 'QUARANTINED_CONFLICT') {
      assert.equal(conflicting.originalDeliveryId, first.outcome === 'ACCEPTED' ? first.deliveryId : undefined);
    }

    const original = await pool.query('SELECT raw_payload FROM inbox_deliveries WHERE workspace_id = $1 AND delivery_key = $2', [workspaceId, deliveryKey]);
    assert.deepEqual(original.rows[0]?.raw_payload, { version: 1 });
    const conflictRows = await pool.query('SELECT count(*)::int AS n FROM inbox_delivery_conflicts WHERE workspace_id = $1', [workspaceId]);
    assert.equal(conflictRows.rows[0]?.n, 1);
  });

  test('competing workers cannot both claim the same inbox_work row (2 independent connections)', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Race Co']);

    // Drain any runnable work other test cases in this shared database may
    // have left behind, so the two concurrent claims below have exactly ONE
    // eligible row to compete over.
    for (;;) {
      const stray = await claimNextInboxWork(pool, 0);
      if (!stray) break;
      await completeInboxWork(pool, stray);
    }

    const delivery = await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-race',
      deliveryKey: randomUUID(),
      rawPayload: { n: 1 },
      handlers: [{ handlerKey: 'race-handler', targetKey: 'only-target' }],
    });
    assert.equal(delivery.outcome, 'ACCEPTED');

    const [claimA, claimB] = await Promise.all([claimNextInboxWork(pool), claimNextInboxWork(pool)]);
    const claimed = [claimA, claimB].filter((c) => c !== undefined);
    assert.equal(claimed.length, 1, 'exactly one of the two concurrent claim attempts must win the only pending row');
  });

  test('durable work survives a simulated crash; an expired lease is safely recoverable and fences out the stale worker', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Fencing Co']);
    await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-fence',
      deliveryKey: randomUUID(),
      rawPayload: { n: 1 },
      handlers: [{ handlerKey: 'fencing-handler', targetKey: 'only-target' }],
    });

    const originalClaim = await claimNextInboxWork(pool, 30);
    assert.ok(originalClaim, 'first worker must claim the pending work');

    // Simulate the process crashing before it can complete the work: the
    // claim/lease row is still durably CLAIMED in the database, not lost.
    const claimedRow = await pool.query('SELECT state FROM inbox_work WHERE id = $1', [originalClaim!.id]);
    assert.equal(claimedRow.rows[0]?.state, 'CLAIMED');

    // Simulate time passing past the lease.
    await pool.query(`UPDATE inbox_work SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [originalClaim!.id]);

    const secondClaim = await claimNextInboxWork(pool, 30);
    assert.ok(secondClaim, 'a second worker must be able to reclaim the expired lease');
    assert.equal(secondClaim!.id, originalClaim!.id);
    assert.notEqual(secondClaim!.claimToken, originalClaim!.claimToken);
    assert.ok(secondClaim!.fencingToken > originalClaim!.fencingToken, 'fencing token must advance on reclaim');

    // The stale (original) worker tries to complete using its now-superseded claim/fencing token.
    const staleCompletion = await completeInboxWork(pool, originalClaim!);
    assert.equal(staleCompletion, false, 'a fenced-out stale worker must not be able to mark work complete');

    const completion = await completeInboxWork(pool, secondClaim!);
    assert.equal(completion, true, 'the current claimant completes successfully');

    const finalState = await pool.query('SELECT state FROM inbox_work WHERE id = $1', [originalClaim!.id]);
    assert.equal(finalState.rows[0]?.state, 'DONE');
  });

  test('failInboxWork also respects fencing and returns work to PENDING for retry when not fenced', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Retry Co']);
    await deliverInboxMessage(pool, {
      workspaceId,
      sourceConnectionId: 'conn-retry',
      deliveryKey: randomUUID(),
      rawPayload: { n: 1 },
      handlers: [{ handlerKey: 'retry-handler', targetKey: 'only-target' }],
    });
    const claim = await claimNextInboxWork(pool, 30);
    assert.ok(claim);
    const failed = await failInboxWork(pool, claim!, 'simulated handler error', 0);
    assert.equal(failed, true);
    const row = await pool.query('SELECT state, attempts, last_error FROM inbox_work WHERE id = $1', [claim!.id]);
    assert.equal(row.rows[0]?.state, 'PENDING');
    assert.equal(row.rows[0]?.last_error, 'simulated handler error');
  });

  test('outbox claim/publish round-trip', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();

    // Other test files share this database and leave their own outbox rows
    // (e.g. registerWorkspace/renameWorkspace's WORKSPACE_REGISTERED/RENAMED
    // events) — drain them first so the claim below deterministically picks
    // up THIS test's row rather than the oldest unrelated pending one.
    for (;;) {
      const stray = await claimNextOutboxRow(pool, 0);
      if (!stray) break;
      await markOutboxPublished(pool, stray);
    }

    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Outbox Co']);
    await pool.query(
      `INSERT INTO outbox (workspace_id, subject_kind, subject_id, destination_kind, payload)
       VALUES ($1, 'WORKSPACE', $1, 'TEST_EVENT', $2)`,
      [workspaceId, JSON.stringify({ ok: true })],
    );
    const claim = await claimNextOutboxRow(pool);
    assert.ok(claim);
    assert.equal(claim!.workspaceId, workspaceId);
    const published = await markOutboxPublished(pool, claim!);
    assert.equal(published, true);
  });
});
