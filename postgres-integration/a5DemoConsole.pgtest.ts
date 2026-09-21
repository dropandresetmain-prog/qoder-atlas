/**
 * A5.1 Demo Console — PostgreSQL proofs for same-process clock resync,
 * gated routes, control apply, and reset→reapply without process restart.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sharedTestPool, freshWorkspaceId } from './harness.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { registerWorkspace } from '../src/persistence/postgres/workspaceCommands.ts';
import {
  createWorkspaceEvaluationClock,
  readEvaluationClock,
} from '../src/app/target/evaluationClock.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import { findExternalExecutionResetBlocker } from '../src/app/demo/demoReset.ts';
import { createPeriodicService } from '../src/app/runtimeServices.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROLS = join(ROOT, 'data/ait-demo-input-pack/demo-controls.json');
const TIMELINE = join(ROOT, 'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json');

async function callHandler(
  app: TargetApplication,
  method: 'GET' | 'POST',
  path: string,
  envPatch?: NodeJS.ProcessEnv,
): Promise<{ status: number; body: string }> {
  const previous = { ...process.env };
  if (envPatch) {
    for (const [key, value] of Object.entries(envPatch)) {
      if (value === undefined || value === '') delete process.env[key];
      else process.env[key] = value;
    }
  }
  try {
    let status = 0;
    const chunks: string[] = [];
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      end(payload?: string) {
        if (payload) chunks.push(payload);
      },
    } as unknown as ServerResponse;
    const req = {
      method,
      url: path,
      headers: {},
      [Symbol.asyncIterator]: async function* () { /* empty body */ },
    } as unknown as IncomingMessage;
    const handled = await handleTargetProductHttp({ app }, req, res, new URL(path, 'http://localhost'));
    assert.equal(handled, true);
    return { status, body: chunks.join('') };
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

describe('A5.1 Demo Console (PostgreSQL)', () => {
  test('reset refreshes in-process evaluation-clock cache (WALL baseline)', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'demo-console-clock',
      idempotencyKey: randomUUID(),
      name: 'Demo Console Clock',
      workspaceId,
    })).ok);

    const clock = await createWorkspaceEvaluationClock(pool, workspaceId);
    const controlled = '2026-09-29T21:30:00.000Z';
    await clock.advanceTo(controlled);
    assert.equal(clock.snapshot().mode, 'CONTROLLED');
    assert.equal(clock.now(), controlled);

    // Simulate durable wipe performed by demo reset (workspace_evaluation_clocks row gone).
    await pool.query('DELETE FROM workspace_evaluation_clocks WHERE workspace_id = $1', [workspaceId]);
    assert.equal((await readEvaluationClock(pool, workspaceId)).mode, 'WALL');

    // Stale in-memory cache still CONTROLLED until afterDemoReset-equivalent refresh.
    assert.equal(clock.snapshot().mode, 'CONTROLLED');
    assert.equal(clock.now(), controlled);

    const refreshed = await clock.refresh();
    assert.equal(refreshed.mode, 'WALL');
    assert.equal(clock.snapshot().mode, 'WALL');
    assert.notEqual(clock.now(), controlled);

    const seen: string[] = [];
    const service = createPeriodicService({
      name: 'post-reset-wake',
      pollMs: 60_000,
      now: () => clock.now(),
      run: async (now) => {
        seen.push(now);
        return { now };
      },
    });
    await service.runNow();
    assert.equal(seen.length, 1);
    assert.notEqual(seen[0], controlled, 'background wake uses reset/WALL evaluation time');
    service.stop();
  });

  test('demo control routes refuse when gate closed', async () => {
    const workspaceId = freshWorkspaceId();
    const app = await composeTargetApplication({ workspaceId, actorId: 'demo-console-gate' });
    try {
      await app.pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [workspaceId, `demo-console:${workspaceId}`],
      );
      const closed = {
        NORTHSTAR_DEMO_DATASET_DIR: '',
        NORTHSTAR_DEMO_RESET: 'disabled',
        APP_ENVIRONMENT: 'local',
      } as NodeJS.ProcessEnv;

      assert.equal((await callHandler(app, 'GET', '/demo/control', closed)).status, 403);
      assert.equal((await callHandler(app, 'GET', '/api/v2/demo/controls', closed)).status, 403);
      assert.equal((await callHandler(app, 'POST', '/api/v2/demo/controls/delay_begins_connection_viable/apply', closed)).status, 403);
      assert.equal((await callHandler(app, 'POST', '/api/v2/demo/preflight', closed)).status, 403);
    } finally {
      await app.close();
    }
  });

  test('unknown control fails closed; clock control + reset resync works in-process', async () => {
    const workspaceId = freshWorkspaceId();
    const app = await composeTargetApplication({ workspaceId, actorId: 'demo-console-apply' });
    try {
      await app.pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [workspaceId, `demo-console:${workspaceId}`],
      );
      const open = {
        NORTHSTAR_DEMO_DATASET_DIR: join(ROOT, 'fixtures/programmes/ait-summit-2026'),
        NORTHSTAR_DEMO_CONTROLS_FILE: CONTROLS,
        NORTHSTAR_DEMO_PROGRESSIVE_DELAY_TIMELINE: TIMELINE,
        NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE: '',
        APP_ENVIRONMENT: 'local',
        NORTHSTAR_DEMO_RESET: '1',
      } as NodeJS.ProcessEnv;

      const clock = await createWorkspaceEvaluationClock(app.pool, workspaceId);
      app.runtimeHooks = {
        executorPrincipalId: `executor:${workspaceId}`,
        evaluationClock: clock,
        afterDemoReset: async () => { await clock.refresh(); },
      };

      const list = await callHandler(app, 'GET', '/api/v2/demo/controls', open);
      assert.equal(list.status, 200);
      const body = JSON.parse(list.body) as { controls: Array<{ id: string; kind: string }> };
      assert.ok(body.controls.some((c) => c.id === 'overnight_narita_necessary'));
      assert.ok(body.controls.every((c) => c.kind === 'PROVIDER_EVENT' || c.kind === 'EVALUATION_CLOCK_ADVANCE'));

      const unknown = await callHandler(app, 'POST', '/api/v2/demo/controls/not-a-real-control/apply', open);
      assert.equal(unknown.status, 404);
      assert.match(unknown.body, /UNKNOWN_CONTROL/);

      const clockApply = await callHandler(app, 'POST', '/api/v2/demo/controls/overnight_narita_necessary/apply', open);
      assert.equal(clockApply.status, 200, clockApply.body);
      const applied = JSON.parse(clockApply.body) as {
        ok: boolean;
        kind: string;
        evaluationClock: { mode: string; now: string };
      };
      assert.equal(applied.ok, true);
      assert.equal(applied.kind, 'EVALUATION_CLOCK_ADVANCE');
      assert.equal(applied.evaluationClock.mode, 'CONTROLLED');
      assert.equal(clock.snapshot().mode, 'CONTROLLED');

      // Simulate reset wipe + afterDemoReset refresh without full dataset reprovision.
      await app.pool.query('DELETE FROM workspace_evaluation_clocks WHERE workspace_id = $1', [workspaceId]);
      await app.runtimeHooks.afterDemoReset?.();
      assert.equal(clock.snapshot().mode, 'WALL');

      const again = await callHandler(app, 'POST', '/api/v2/demo/controls/overnight_narita_necessary/apply', open);
      assert.equal(again.status, 200, again.body);
      assert.equal(clock.snapshot().mode, 'CONTROLLED');
    } finally {
      await app.close();
    }
  });

  test('external execution history helper remains available for reset refusal', async () => {
    const pool = await sharedTestPool();
    const workspaceId = freshWorkspaceId();
    const uow = new PgUnitOfWork(pool, workspaceId);
    assert.ok((await registerWorkspace(uow, {
      actorPrincipalId: 'demo-console-ext',
      idempotencyKey: randomUUID(),
      name: 'Demo Console Ext',
      workspaceId,
    })).ok);
    assert.equal(await findExternalExecutionResetBlocker(pool, workspaceId), undefined);
  });
});
