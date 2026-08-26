/**
 * R2 — populated demo world integration evidence.
 *
 * Proves single-reset prefix orchestration through real HTTP boundaries:
 * - POST /api/demo/reset builds all eight scenario entry states;
 * - Sarah (S1) NOT_VIABLE; Jordan (S2) awaiting organiser approval;
 * - reset is repeatable; Overview exposes Reset demo control.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import {
  POPULATED_DEMO_PREFIXES,
  resolvePopulatedDemoAnchorEventId,
  resolvePopulatedDemoOverviewPath,
} from '../src/app/demoWorld.ts';

const FIXTURES_ROOT = resolve('fixtures');

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

async function postJson(base: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(base: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function withServer(
  config: typeof demoConfig,
  run: (base: string, composed: Awaited<ReturnType<typeof composeAppRuntime>>) => Promise<void>,
): Promise<void> {
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(base, composed);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
}

test('R2: populated demo reset runs all prefixes and lands Sarah NOT_VIABLE + Jordan awaiting approval', async () => {
  await withServer(demoConfig, async (base) => {
    const reset = await postJson(base, '/api/demo/reset');
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body['ok'], true);
    assert.equal(reset.body['redirectTo'], resolvePopulatedDemoOverviewPath());
    const prefixes = reset.body['prefixes'] as Array<{ prefixId: string; ok: boolean }>;
    assert.equal(prefixes.length, POPULATED_DEMO_PREFIXES.length);
    assert.ok(prefixes.every((row) => row.ok), JSON.stringify(prefixes));

    const sarah = await getJson(base, '/api/traveller/trip-trv-evt-ait-2026-ait-draft-14');
    assert.equal(sarah.status, 200);
    assert.equal(sarah.body['remainderViable'], 'NOT_VIABLE');

    const cases = await getJson(base, '/api/wave/approvals');
    assert.equal(cases.status, 200);
    const pending = cases.body['pending'] as Array<{ caseId: string; tripId: string; status: string }>;
    const jordanPending = pending.find((row) => row.tripId === 'trip-trv-evt-ait-2026-ait-draft-09');
    assert.ok(jordanPending, 'Jordan recovery should await organiser approval');
  });
});

test('R2: populated demo reset is repeatable on a persisted store', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-r2-'));
  const dbPath = join(dbDir, 'app.sqlite');
  const fileConfig = AppConfigSchema.parse({ ...demoConfig, sqlitePath: dbPath });

  await withServer(fileConfig, async (base) => {
    const first = await postJson(base, '/api/demo/reset');
    assert.equal(first.status, 200);
    const sarahFirst = await getJson(base, '/api/traveller/trip-trv-evt-ait-2026-ait-draft-14');
    const firstViability = sarahFirst.body['remainderViable'];

    const second = await postJson(base, '/api/demo/reset');
    assert.equal(second.status, 200);
    const sarahSecond = await getJson(base, '/api/traveller/trip-trv-evt-ait-2026-ait-draft-14');
    assert.equal(sarahSecond.body['remainderViable'], firstViability);
  });
});

test('R2: operator Overview renders Reset demo control and scopes to evt-ait-2026', async () => {
  await withServer(demoConfig, async (base) => {
    await postJson(base, '/api/demo/reset');
    const eventId = resolvePopulatedDemoAnchorEventId();
    const overview = await fetch(`${base}/operator?event=${encodeURIComponent(eventId)}`);
    assert.equal(overview.status, 200);
    const html = await overview.text();
    assert.match(html, /data-test="demo-reset-btn"/);
    assert.match(html, /Reset demo/);
    assert.match(html, /Sarah Lim|Lim, Sarah|ait-draft-14/i);
  });
});

test('R2: demo reset redirect returns populated Overview', async () => {
  await withServer(demoConfig, async (base) => {
    const response = await fetch(`${base}/api/demo/reset?redirect=1`, { method: 'POST', redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), resolvePopulatedDemoOverviewPath());
  });
});
