import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace, renameWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';

describe('M1 expected-revision CAS and concurrent writers (real PostgreSQL, independent connections)', () => {
  test('a stale expected revision fails with a typed conflict and changes nothing', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey: randomUUID(), name: 'Stale Co', workspaceId });

    const result = await renameWorkspace(uow, {
      workspaceId,
      actorPrincipalId: 'tester',
      idempotencyKey: randomUUID(),
      name: 'Should Not Apply',
      expectedRevision: 999,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.conflict.kind, 'STALE_AGGREGATE_REVISION');

    const row = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    assert.equal(row.rows[0]?.name, 'Stale Co');
  });

  test('equal-revision reuse after a commit is impossible — no lost update from sequential same-revision attempts', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey: randomUUID(), name: 'Equal Co', workspaceId });

    const first = await renameWorkspace(uow, {
      workspaceId,
      actorPrincipalId: 'tester',
      idempotencyKey: randomUUID(),
      name: 'Winner',
      expectedRevision: 1,
    });
    assert.equal(first.ok, true);

    const second = await renameWorkspace(uow, {
      workspaceId,
      actorPrincipalId: 'tester',
      idempotencyKey: randomUUID(),
      name: 'Should Also Not Apply',
      expectedRevision: 1, // same revision the first command also started from
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.conflict.kind, 'STALE_AGGREGATE_REVISION');

    const row = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    assert.equal(row.rows[0]?.name, 'Winner');
  });

  test('concurrent writers racing on the same expected revision: exactly one wins, no lost update (2 independent connections)', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const setupUow = new PgUnitOfWork(pool, workspaceId);
    await registerWorkspace(setupUow, { actorPrincipalId: 'tester', idempotencyKey: randomUUID(), name: 'Race Co', workspaceId });

    // Two independent UnitOfWork instances over the SAME pool: each `execute`
    // call checks out its own PoolClient (see PgUnitOfWork.execute), so this
    // genuinely exercises two separate PostgreSQL connections concurrently.
    const uowConnA = new PgUnitOfWork(pool, workspaceId);
    const uowConnB = new PgUnitOfWork(pool, workspaceId);

    const [resultA, resultB] = await Promise.all([
      renameWorkspace(uowConnA, {
        workspaceId,
        actorPrincipalId: 'writer-a',
        idempotencyKey: randomUUID(),
        name: 'Writer A wins',
        expectedRevision: 1,
      }),
      renameWorkspace(uowConnB, {
        workspaceId,
        actorPrincipalId: 'writer-b',
        idempotencyKey: randomUUID(),
        name: 'Writer B wins',
        expectedRevision: 1,
      }),
    ]);

    const outcomes = [resultA, resultB];
    const succeeded = outcomes.filter((r) => r.ok);
    const conflicted = outcomes.filter((r) => !r.ok);
    assert.equal(succeeded.length, 1, 'exactly one concurrent writer must win');
    assert.equal(conflicted.length, 1, 'exactly one concurrent writer must be told to retry');
    if (!conflicted[0]!.ok) assert.equal(conflicted[0]!.conflict.kind, 'STALE_AGGREGATE_REVISION');

    const finalHead = await pool.query('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $1', [workspaceId]);
    assert.equal(Number(finalHead.rows[0].revision), 2, 'revision must have advanced exactly once, not twice');

    const finalRow = await pool.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    const winningName = succeeded[0]!.ok ? (succeeded[0] as { value: { name: string } }).value.name : undefined;
    assert.equal(finalRow.rows[0]?.name, winningName, 'the persisted name must be the winner\'s, not silently overwritten or averaged');
  });
});
