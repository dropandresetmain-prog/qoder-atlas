/**
 * M10 runtime purge — live proof that normal NORTHSTAR operation boots and
 * serves real requests with NO legacy SQLite database available at all
 * (unset `SQLITE_PATH`, and the working directory has no `data/app.sqlite`
 * either — this process never calls `openDatabase`, so there is nothing to
 * even be absent, but we assert the composition path taken is real
 * PostgreSQL, not a silently-skipped no-op).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sharedTestPool } from './harness.ts';
import { composeTargetBoot } from '../src/app/composeTargetBoot.ts';
import { createTargetAppServer } from '../src/server/targetHttp.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

test('normal boot works end-to-end with no SQLite database reachable', async () => {
  // Ensure this process cannot see a legacy SQLite path even if one existed
  // in the environment inherited from the test runner.
  const env = { ...process.env };
  delete env.SQLITE_PATH;
  env.PG_TARGET_WORKSPACE_ID = randomUUID();
  env.NORTHSTAR_DEMO_DATASET_DIR = '';
  // Route the target config at the already-migrated shared test database
  // rather than requiring a fresh one for this focused boot proof.
  await sharedTestPool(); // ensures migrations have run on PGTEST_DB before boot reuses it

  const boot = await composeTargetBoot(env, { applyDotenvFiles: false });
  const server = createTargetAppServer(
    { environment: boot.config.environment, workspaceId: boot.config.workspaceId },
    boot.endpoints,
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { runtime: string };
    assert.equal(healthBody.runtime, 'POSTGRES_TARGET');

    const targetHealth = await fetch(`${base}/api/v2/health`);
    assert.equal(targetHealth.status, 200);
    const targetHealthBody = await targetHealth.json() as {
      kind: string;
      sqliteAuthoritativeFallback: boolean;
      workspaceId: string;
      runtimeServices: Array<{ name: string; state: string }>;
    };
    assert.equal(targetHealthBody.kind, 'TARGET_POSTGRES');
    assert.equal(targetHealthBody.sqliteAuthoritativeFallback, false);
    assert.equal(targetHealthBody.workspaceId, boot.config.workspaceId);
    // R0: the real runtime composition root actually started its background
    // services — this boots the real composition, not a stub health payload.
    assert.ok(
      targetHealthBody.runtimeServices.some((service) => service.name === 'reassessment' && service.state === 'RUNNING'),
      `expected a running "reassessment" runtime service, got ${JSON.stringify(targetHealthBody.runtimeServices)}`,
    );

    const root = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/api/v2/operator/overview?format=html');

    const overview = await fetch(`${base}/api/v2/operator/overview`);
    assert.equal(overview.status, 200);
    const overviewBody = await overview.json() as { items: unknown[] };
    assert.ok(Array.isArray(overviewBody.items));

    // Demo reset is a real PostgreSQL-backed product capability reachable
    // over HTTP — not a stub, not SQLite. When a demo dataset is configured
    // on process.env the handler returns the workspace reset envelope; otherwise
    // it seeds the small placeholder world (two travellers). Either path proves
    // the target composition owns reset on PostgreSQL.
    const reset = await fetch(`${base}/api/v2/demo/reset`, { method: 'POST' });
    assert.equal(reset.status, 200);
    const resetBody = await reset.json() as {
      travellers?: unknown[];
      ok?: boolean;
      workspaceId?: string;
      baselineEvaluated?: number;
    };
    if (Array.isArray(resetBody.travellers)) {
      assert.equal(resetBody.travellers.length, 2);
    } else {
      assert.equal(resetBody.ok, true);
      assert.equal(typeof resetBody.workspaceId, 'string');
      assert.ok((resetBody.baselineEvaluated ?? 0) >= 0);
    }

    // `/operator` is the current PostgreSQL product alias, not the retired
    // SQLite composition. Prove it reaches the same target overview handler.
    const operator = await fetch(`${base}/operator`, { redirect: 'manual' });
    assert.equal(operator.status, 302);
    assert.equal(operator.headers.get('location'), '/api/v2/operator/overview?format=html');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await boot.close();
  }
});
