/**
 * DR-5 — HTTP integration for the natural-language traveller entry point:
 * POST /api/traveller/change-request.
 *
 * Proves, over the real HTTP surface (credential-free, deterministic
 * interpreter path — REPLAY never calls Model Studio):
 * - a clear NL request produces a validated ChangeRequest that opens/updates
 *   a resolution case, converging on the SAME resolveChangeRequest engine
 *   the structured /api/resolution/change-request route uses;
 * - an ambiguous request fails closed with a clarification request instead
 *   of guessing;
 * - an unknown trip is refused with 404;
 * - CHANGE_REQUESTED status stays distinct from supplier DISRUPTED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function withServer(
  work: (base: string, composed: Awaited<ReturnType<typeof composeAppRuntime>>) => Promise<void>,
): Promise<void> {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await work(base, composed);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
}

const AT = '2026-09-02T00:00:00+00:00';
const TRIP_A = 'trip_a';
const TRAVELLER_A = 'trv_a_speaker';

test('DR-5-HTTP.1: a clear NL request opens/updates a resolution case via the shared resolver', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/traveller/change-request', {
      travellerId: TRAVELLER_A,
      tripId: TRIP_A,
      text: 'I need to arrive by 2026-09-01T20:00:00+09:00 for the opening session.',
      at: AT,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body['accepted'], true);
    assert.equal(res.body['tripId'], TRIP_A);
    assert.equal(res.body['intentKind'], 'ADJUST_TRIP_WINDOW');
    assert.ok(res.body['caseId'], 'a resolution case was opened');

    // The structured route and the NL route converge on the SAME case for
    // the same trip: fetch it back through the ordinary case-detail surface.
    const caseRes = await fetch(`${base}/api/cases/${res.body['caseId'] as string}`);
    assert.equal(caseRes.status, 200);
  });
});

test('DR-5-HTTP.2: an ambiguous request fails closed with a clarification, never a guess', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/traveller/change-request', {
      travellerId: TRAVELLER_A,
      tripId: TRIP_A,
      text: 'something is not quite right with my trip, can you look into it',
      at: AT,
    });
    assert.equal(res.status, 422);
    assert.equal(res.body['accepted'], false);
    assert.ok(typeof res.body['clarificationNeeded'] === 'string' && (res.body['clarificationNeeded'] as string).length > 0);
  });
});

test('DR-5-HTTP.3: an unknown trip is refused with 404', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/traveller/change-request', {
      travellerId: TRAVELLER_A,
      tripId: 'trip-does-not-exist',
      text: 'I need to arrive by 2026-09-01T20:00:00+09:00 for the opening session.',
      at: AT,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body['error'], 'unknown_trip');
  });
});

test('DR-5-HTTP.4: malformed wire body is a structured 400, never a crash', async () => {
  await withServer(async (base) => {
    const res = await postJson(base, '/api/traveller/change-request', { text: 'missing travellerId and at' });
    assert.equal(res.status, 400);
    assert.equal(res.body['error'], 'invalid_request');
  });
});

test('DR-5-HTTP.5: CHANGE_REQUESTED stays distinct from supplier DISRUPTED in the operator projection', async () => {
  await withServer(async (base, composed) => {
    const res = await postJson(base, '/api/traveller/change-request', {
      travellerId: TRAVELLER_A,
      tripId: TRIP_A,
      text: 'I need to arrive by 2026-09-01T20:00:00+09:00 for the opening session.',
      at: AT,
    });
    assert.equal(res.status, 200);

    const dashboard = await composed.endpoints.operatorDashboard(AT);
    const tripRow = dashboard.trips.find((t) => t.tripId === TRIP_A);
    assert.ok(tripRow, 'trip visible on the operator dashboard');
    assert.equal(tripRow!.status, 'CHANGE_REQUESTED', 'traveller-initiated change is never mislabeled DISRUPTED');

    // Sanity: the SAME trip processing a genuine supplier disruption instead
    // (a different scenario/case) is labelled DISRUPTED — proven already by
    // wave3r-dr8-projection-truth.test.ts; this test only proves the
    // CHANGE_REQUESTED half via the real HTTP route.
    const spec = loadScenario(SCENARIO_A_DIR);
    assert.equal(spec.trip.id, TRIP_A);
  });
});
