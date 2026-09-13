import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';
import { typedConflict } from '../src/domain/v2/shared/errors.ts';
import { currentTransactionClient } from '../src/persistence/postgres/transactionContext.ts';

describe('M1 atomic commit / rollback (real PostgreSQL)', () => {
  test('domain data + head + change record + outbox + receipt commit atomically', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    const idempotencyKey = randomUUID();

    const result = await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey, name: 'Atomic Co', workspaceId });
    assert.ok(result.ok);

    const [ws, head, subject, change, outboxRow, receipt] = await Promise.all([
      pool.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]),
      pool.query('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $1', [workspaceId]),
      pool.query("SELECT 1 FROM domain_subjects WHERE workspace_id = $1 AND id = $1 AND kind = 'WORKSPACE'", [workspaceId]),
      pool.query('SELECT 1 FROM change_records WHERE workspace_id = $1 AND idempotency_key = $2', [workspaceId, idempotencyKey]),
      pool.query("SELECT 1 FROM outbox WHERE workspace_id = $1 AND destination_kind = 'WORKSPACE_REGISTERED'", [workspaceId]),
      pool.query('SELECT 1 FROM command_receipts WHERE workspace_id = $1 AND idempotency_key = $2', [workspaceId, idempotencyKey]),
    ]);
    assert.equal(ws.rows.length, 1, 'workspaces row');
    assert.equal(Number(head.rows[0]?.revision), 1, 'aggregate_heads row at revision 1');
    assert.equal(subject.rows.length, 1, 'domain_subjects row');
    assert.equal(change.rows.length, 1, 'change_records row');
    assert.equal(outboxRow.rows.length, 1, 'outbox row');
    assert.equal(receipt.rows.length, 1, 'command_receipts row');
  });

  test('a failure partway through the transaction body rolls back every write, not just some', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);

    const envelope = {
      commandType: 'TEST_PARTIAL_FAILURE',
      schemaVersion: '1',
      workspaceId,
      actorPrincipalId: 'tester',
      idempotencyKey: randomUUID(),
      canonicalPayloadHash: 'irrelevant-for-this-test',
      expectedAggregateRevisions: [],
      expectedScopeGenerations: [],
      evidenceRefs: [],
      typedPayload: {},
    };

    await assert.rejects(
      () =>
        uow.execute(envelope, async () => {
          const client = currentTransactionClient();
          await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Should Roll Back']);
          await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $1, 1)', [
            workspaceId,
          ]);
          throw new Error('simulated mid-transaction failure after two successful writes');
        }),
      /simulated mid-transaction failure/,
    );

    const ws = await pool.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    const head = await pool.query('SELECT 1 FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $1', [workspaceId]);
    assert.equal(ws.rows.length, 0, 'workspaces insert must have rolled back');
    assert.equal(head.rows.length, 0, 'aggregate_heads insert must have rolled back');
  });

  test('a domain-level conflict returned by fn also persists nothing', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);

    const envelope = {
      commandType: 'TEST_CONFLICT_RETURN',
      schemaVersion: '1',
      workspaceId,
      actorPrincipalId: 'tester',
      idempotencyKey: randomUUID(),
      canonicalPayloadHash: 'irrelevant-for-this-test',
      expectedAggregateRevisions: [],
      expectedScopeGenerations: [],
      evidenceRefs: [],
      typedPayload: {},
    };

    const result = await uow.execute(envelope, async () => {
      const client = currentTransactionClient();
      await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Should Also Roll Back']);
      return { ok: false as const, conflict: typedConflict('VALIDATION_FAILED', 'deliberate test conflict') };
    });
    assert.equal(result.ok, false);

    const ws = await pool.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
    assert.equal(ws.rows.length, 0, 'workspaces insert must have rolled back when fn returns a conflict');
  });
});
