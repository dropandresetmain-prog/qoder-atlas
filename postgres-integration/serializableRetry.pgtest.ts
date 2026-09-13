import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';

describe('M1 SERIALIZABLE predicate conflict + bounded retry (real PostgreSQL, independent connections)', () => {
  test('two concurrent scope-generation advances on the same scope both eventually succeed with no lost update', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Scope Co']);

    const scopeRef = { scopeKind: 'WORKSPACE' as const, scopeId: workspaceId };
    const uowA = new PgUnitOfWork(pool, workspaceId);
    const uowB = new PgUnitOfWork(pool, workspaceId);

    const runAdvance = (uow: PgUnitOfWork, actor: string) =>
      uow.execute(
        {
          commandType: 'TEST_ADVANCE_SCOPE',
          schemaVersion: '1',
          workspaceId,
          actorPrincipalId: actor,
          idempotencyKey: randomUUID(),
          canonicalPayloadHash: 'n/a',
          expectedAggregateRevisions: [],
          expectedScopeGenerations: [],
          evidenceRefs: [],
          typedPayload: {},
        },
        async () => {
          const generation = await uow.scopes.advance(scopeRef);
          return {
            ok: true as const,
            value: { generation },
            receipt: {
              workspaceId,
              commandNamespace: 'TEST_ADVANCE_SCOPE',
              idempotencyKey: randomUUID(),
              payloadHash: 'n/a',
              resultRef: JSON.stringify({ generation }),
              committedRevisions: [],
              committedAt: new Date().toISOString(),
            },
          };
        },
      );

    // If PgUnitOfWork.execute's bounded SERIALIZABLE retry did not work, one
    // of these two would reject with an unhandled 40001 serialization_failure
    // instead of resolving — Promise.all would then reject the whole test.
    const [resultA, resultB] = await Promise.all([runAdvance(uowA, 'writer-a'), runAdvance(uowB, 'writer-b')]);

    assert.ok(resultA.ok, 'writer A must eventually succeed (directly or via automatic retry)');
    assert.ok(resultB.ok, 'writer B must eventually succeed (directly or via automatic retry)');

    const generations = [resultA, resultB].map((r) => (r.ok ? (r.value as { generation: number }).generation : -1));
    assert.deepEqual([...generations].sort(), [1, 2], 'both increments must be applied — no lost update');

    const finalRow = await pool.query(
      'SELECT generation FROM scope_generations WHERE workspace_id = $1 AND scope_kind = $2 AND scope_id = $3',
      [workspaceId, scopeRef.scopeKind, scopeRef.scopeId],
    );
    assert.equal(Number(finalRow.rows[0]?.generation), 2);
  });
});
