/**
 * R4-F3 — demo reset is single-flight (server) and shows an obvious busy state (client).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetDemoWorkspace } from '../src/app/demo/demoReset.ts';
import { renderShellRuntimeScript } from '../src/ui/shellRuntime.ts';

const env = {
  NORTHSTAR_DEMO_DATASET_DIR: 'fixtures/programmes/ait-summit-2026',
  APP_ENVIRONMENT: 'local',
  NORTHSTAR_DEMO_RESET: '',
} as NodeJS.ProcessEnv;

test('a second reset while one is running is refused immediately without a pool connection', async () => {
  let connects = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const pool = {
    connect: async () => {
      connects += 1;
      await firstGate;
      throw new Error('stop after gate');
    },
  } as never;
  const params = { pool, uow: (() => undefined) as never, workspaceId: 'ws-single-flight', env };

  const first = resetDemoWorkspace(params).catch((error: Error) => error);
  const second = await resetDemoWorkspace(params);
  assert.equal(second.status, 'IN_PROGRESS');
  assert.equal(connects, 1, 'the duplicate must not touch the pool');

  // A different workspace is not blocked by this one.
  const other = resetDemoWorkspace({ ...params, workspaceId: 'ws-other' }).catch((error: Error) => error);
  await Promise.resolve();
  assert.equal(connects, 2);

  releaseFirst();
  assert.ok((await first) instanceof Error);
  await other;

  // The guard is cleared once the first attempt ends, even by failure.
  const third = resetDemoWorkspace(params).catch((error: Error) => error);
  assert.equal(connects, 3);
  await third;
});

test('client reset control is single-flight with a page-level busy overlay', () => {
  const script = renderShellRuntimeScript({ intervalMs: 4000 });
  assert.ok(script.includes('data-busy-overlay'));
  assert.ok(script.includes('takes about a minute'));
  // An already-pending control key ignores further clicks.
  assert.ok(/existing\.state\s*===\s*["']pending["']/.test(script));
  // The overlay is removed when the request fails so the user can retry.
  assert.match(script, /hideBusyOverlay\(\)/);
});
