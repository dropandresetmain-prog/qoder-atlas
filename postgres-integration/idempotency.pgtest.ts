import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';

describe('M1 command idempotency (real PostgreSQL)', () => {
  test('replaying the same idempotency key with an equal payload returns the original receipt, without a duplicate write', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    const idempotencyKey = randomUUID();

    const first = await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey, name: 'Idem Co', workspaceId });
    assert.ok(first.ok);

    // A second call with the SAME idempotencyKey/workspaceId/name would hit a
    // primary-key violation on `workspaces` if the replay short-circuit did
    // not work — so a clean ok:true here IS the proof no duplicate INSERT ran.
    const second = await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey, name: 'Idem Co', workspaceId });
    assert.ok(second.ok);
    if (first.ok && second.ok) {
      assert.deepEqual(second.value, first.value);
      assert.equal(second.receipt.committedAt, first.receipt.committedAt, 'replay must return the ORIGINAL committed_at, not a new one');
    }

    const rows = await pool.query('SELECT count(*)::int AS n FROM workspaces WHERE id = $1', [workspaceId]);
    assert.equal(rows.rows[0]?.n, 1);
    const receiptRows = await pool.query(
      'SELECT count(*)::int AS n FROM command_receipts WHERE workspace_id = $1 AND idempotency_key = $2',
      [workspaceId, idempotencyKey],
    );
    assert.equal(receiptRows.rows[0]?.n, 1, 'exactly one immutable receipt row, never a second insert');
  });

  test('reusing an idempotency key with a different payload hash fails without touching domain state', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    const idempotencyKey = randomUUID();

    const first = await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey, name: 'Original Name', workspaceId });
    assert.ok(first.ok);

    const second = await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey, name: 'Different Name', workspaceId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.conflict.kind, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');

    const row = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    assert.equal(row.rows[0]?.name, 'Original Name');
  });
});
