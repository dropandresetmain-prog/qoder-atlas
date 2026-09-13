import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace, renameWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';

describe('M1 tenant/subtype integrity (real PostgreSQL)', () => {
  test('workspace FK prevents a domain_subjects row from pointing at another workspace\'s aggregate', async () => {
    const pool = await sharedTestPool();
    const workspaceA = freshWorkspaceId();
    const workspaceB = freshWorkspaceId();
    const uowA = new PgUnitOfWork(pool, workspaceA);
    const resultA = await registerWorkspace(uowA, { actorPrincipalId: 'tester', idempotencyKey: randomUUID(), name: 'Workspace A', workspaceId: workspaceA });
    assert.ok(resultA.ok);

    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceB, 'Workspace B']);

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'WORKSPACE', $3)`,
          [workspaceB, randomUUID(), workspaceA],
        ),
      /violates foreign key constraint|domain_subjects_aggregate_fk/i,
    );
  });

  test('aggregate_heads FK rejects an unknown workspace_id', async () => {
    const pool = await sharedTestPool();
    await assert.rejects(
      () =>
        pool.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [
          randomUUID(),
          randomUUID(),
        ]),
      /violates foreign key constraint/i,
    );
  });

  test('the workspace-partition FK itself already blocks a WORKSPACE subject with no matching workspaces row', async () => {
    // For the WORKSPACE kind specifically, workspace_id = id by construction,
    // so aggregate_heads/domain_subjects's ordinary `workspace_id REFERENCES
    // workspaces(id)` FK already requires a `workspaces` row to exist for
    // that id before either table can be written at all — the subtype
    // trigger's own "no workspaces row" branch is unreachable for this kind
    // and exists only as defense-in-depth (see migration 0003's comment).
    // This test proves the FK path fails closed on its own.
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () =>
          client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $1, 1)', [
            workspaceId,
          ]),
        /violates foreign key constraint/i,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  test('subtype trigger rejects a WORKSPACE subject whose id does not equal its own workspace_id', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const otherId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Mismatched']);
      await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [
        workspaceId,
        otherId,
      ]);
      await client.query(
        `INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'WORKSPACE', $2)`,
        [workspaceId, otherId],
      );
      await assert.rejects(() => client.query('COMMIT'), /subtype violation/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  test('aggregate_heads uses exactly one authoritative revision row across the command lifecycle', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    await registerWorkspace(uow, { actorPrincipalId: 'tester', idempotencyKey: randomUUID(), name: 'Rev Co', workspaceId });
    await renameWorkspace(uow, { workspaceId, actorPrincipalId: 'tester', idempotencyKey: randomUUID(), name: 'Rev Co 2', expectedRevision: 1 });

    const heads = await pool.query('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $1', [workspaceId]);
    assert.equal(heads.rows.length, 1);
    assert.equal(Number(heads.rows[0].revision), 2);
  });
});
