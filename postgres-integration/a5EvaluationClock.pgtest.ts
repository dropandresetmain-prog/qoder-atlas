/**
 * A5 CP3 — workspace evaluation clock persistence + worker injection (PostgreSQL).
 *
 * Proves CONTROLLED mode is durable, WALL is default, injected periodic/drain
 * clocks consume controlled_now, and wall-clock-only operational timestamps
 * remain independent of the evaluation clock.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import {
  createWorkspaceEvaluationClock,
  readEvaluationClock,
  writeControlledEvaluationClock,
  writeWallEvaluationClock,
} from '../src/app/target/evaluationClock.ts';
import { createPeriodicService } from '../src/app/runtimeServices.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';

describe('A5 CP3 workspace evaluation clock (PostgreSQL)', () => {
  test('default missing row is WALL; CONTROLLED persists and resolves', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    const registered = await registerWorkspace(uow, {
      actorPrincipalId: 'cp3-clock',
      idempotencyKey: randomUUID(),
      name: 'CP3 Clock',
      workspaceId,
    });
    assert.ok(registered.ok);

    const missing = await readEvaluationClock(pool, workspaceId);
    assert.equal(missing.mode, 'WALL');
    assert.equal(missing.controlledNow, null);

    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    const wallSample = clock.now();
    assert.ok(Date.parse(wallSample) > 0);

    const controlled = '2026-09-29T21:30:00.000Z';
    await clock.advanceTo(controlled);
    assert.equal(clock.snapshot().mode, 'CONTROLLED');
    assert.equal(clock.now(), controlled);

    const reloaded = await createWorkspaceEvaluationClock(pool, workspaceId);
    assert.equal(reloaded.snapshot().mode, 'CONTROLLED');
    assert.equal(reloaded.now(), controlled);

    await clock.useWall();
    assert.equal(clock.snapshot().mode, 'WALL');
    assert.notEqual(clock.now(), controlled);
  });

  test('injected periodic service consumes controlled evaluation clock across wakes', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'cp3-clock',
      idempotencyKey: randomUUID(),
      name: 'CP3 Periodic',
      workspaceId,
    })).ok);

    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    const d1 = '2026-09-28T12:30:00.000Z';
    const d2 = '2026-09-28T15:00:00.000Z';
    const d3 = '2026-09-29T12:00:00.000Z';
    const overnight = '2026-09-29T21:30:00.000Z';

    const seen: string[] = [];
    const service = createPeriodicService({
      name: 'cp3-eval',
      pollMs: 60_000,
      now: () => clock.now(),
      run: async (now) => {
        seen.push(now);
        return { now };
      },
    });

    await clock.advanceTo(d1);
    await service.runNow();
    await clock.advanceTo(d2);
    await service.runNow();
    await clock.advanceTo(d3);
    await service.runNow();
    await clock.advanceTo(overnight);
    await service.runNow();

    assert.deepEqual(seen, [d1, d2, d3, overnight]);
    service.stop();
  });

  test('write helpers enforce CONTROLLED vs WALL semantics', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'cp3-clock',
      idempotencyKey: randomUUID(),
      name: 'CP3 Write',
      workspaceId,
    })).ok);

    const controlled = await writeControlledEvaluationClock(pool, workspaceId, '2026-09-29T21:00:00.000Z');
    assert.equal(controlled.mode, 'CONTROLLED');
    assert.equal(controlled.controlledNow, '2026-09-29T21:00:00.000Z');

    const wall = await writeWallEvaluationClock(pool, workspaceId);
    assert.equal(wall.mode, 'WALL');
    assert.equal(wall.controlledNow, null);
  });

  test('completionClock-style wall stamp stays independent of evaluation clock', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'cp3-clock',
      idempotencyKey: randomUUID(),
      name: 'CP3 Wall Boundary',
      workspaceId,
    })).ok);

    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    await clock.advanceTo('2026-09-29T21:30:00.000Z');
    const evaluationNow = clock.now();
    // Mirrors recoveryPlanningCoordinator completionClock — always wall.
    const completionClock = (): string => new Date().toISOString();
    const operational = completionClock();
    assert.equal(evaluationNow, '2026-09-29T21:30:00.000Z');
    assert.notEqual(operational, evaluationNow);
    assert.ok(Date.parse(operational) > Date.parse('2026-01-01T00:00:00.000Z'));
  });
});
