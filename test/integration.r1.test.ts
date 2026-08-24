/**
 * R1/PL-3 evidence — generic runtime disruption/reset flow.
 *
 * Proves, over the real HTTP surface with ZERO provider/model credentials:
 * - the composed runtime boots the deterministic fallback planner (REPLAY,
 *   credential-free) and completes the whole recovery loop through generic
 *   runtime endpoints (TripSignal -> impact -> planning -> authority ->
 *   approval -> simulated execution -> observation -> verified RESOLVED),
 *   with no scenario-specific endpoints and no manual state surgery;
 * - wrong-principal approval and malformed bodies are refused structurally;
 * - deterministic reset/reseed restores the exact seeded starting state;
 * - the same instant sequence on two fresh stores yields identical trip state;
 * - a persisted runtime survives process restart through SQLite.
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
import { loadScenario } from '../src/scenarios/loader.ts';
import type { TransportLeg } from '../src/domain/elements.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

const PLAN_AT = '2026-09-12T18:30:00+09:00';
const BEGIN_AT = '2026-09-12T18:40:00+09:00';
const DECIDE_AT = '2026-09-12T18:50:00+09:00';
const EXECUTE_AT = '2026-09-12T18:55:00+09:00';
const RESET_AT = '2026-09-12T23:00:00+09:00';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Drive one full credential-free runtime loop against a composed server. */
async function runRuntimeLoop(base: string, scenarioDir: string) {
  const spec = loadScenario(scenarioDir);
  const disruption = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
  assert.equal(disruption.status, 200);
  const caseId = disruption.body['caseId'] as string;
  assert.equal(caseId, `case-${spec.trip.id}-${spec.disruption.signal.id}`);

  const plan = await postJson(base, '/api/runtime/plan', { caseId, at: PLAN_AT });
  assert.equal(plan.status, 200);
  const bestStrategyId = plan.body['bestStrategyId'] as string;
  assert.ok(bestStrategyId, 'planning must rank a feasible strategy first');

  const begin = await postJson(base, '/api/runtime/begin', { caseId, strategyId: bestStrategyId, at: BEGIN_AT });
  assert.equal(begin.status, 200);
  assert.equal(begin.body['outcome'], 'REQUIRES_TRAVELLER');
  const intentId = begin.body['intentId'] as string;

  const decide = await postJson(base, '/api/runtime/decide', {
    caseId,
    intentId,
    decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0] },
    verdict: 'APPROVED',
    at: DECIDE_AT,
  });
  assert.equal(decide.status, 200);

  const execute = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: EXECUTE_AT });
  assert.equal(execute.status, 200);
  assert.equal(execute.body['caseStatus'], 'RESOLVED');
  return { caseId, intentId, bestStrategyId };
}

test('R1: credential-free runtime flow completes disruption -> recovery -> reset over HTTP', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  assert.equal(composed.plannerMode, 'DETERMINISTIC_FALLBACK', 'no credentials -> deterministic fallback planner');
  assert.ok(composed.seededScenarioIds.length >= 2, 'both scenario bundles seeded generically');

  const spec = loadScenario(SCENARIO_A_DIR);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    // Root surface advertises the runtime flow; checkpoint string updated.
    const root = (await (await fetch(`${base}/`)).json()) as { checkpoint: string; surfaces: string[] };
    assert.match(root.checkpoint, /C candidate/);
    assert.ok(root.surfaces.includes('/api/runtime/state'));

    // Runtime state pre-disruption: seeded trips, no open cases.
    const state = (await (await fetch(`${base}/api/runtime/state`)).json()) as {
      trips: Array<{ tripId: string }>;
      openCases: Array<{ caseId: string }>;
    };
    // Programme-scale demo: the two scenario trips plus the seeded programme
    // cohort boot together; the store must start with no open cases.
    assert.ok(state.trips.length >= 2);
    assert.ok(state.trips.some((trip) => trip.tripId === spec.trip.id));
    assert.equal(state.openCases.length, 0);

    // Boundary validation: malformed bodies are refused structurally.
    assert.equal((await postJson(base, '/api/runtime/disruption', { kind: 'NOT_A_KIND' })).status, 400);
    assert.equal((await postJson(base, '/api/runtime/plan', { caseId: 'x' })).status, 400);
    const badRoute = await fetch(`${base}/api/runtime/unknown-action`, { method: 'POST', body: '{}' });
    assert.equal(badRoute.status, 404);
    const stateMethod = await fetch(`${base}/api/runtime/state`, { method: 'POST', body: '{}' });
    assert.equal(stateMethod.status, 405);

    // Full loop through the generic runtime endpoints.
    const { caseId } = await runRuntimeLoop(base, SCENARIO_A_DIR);

    // Read models reflect the verified resolution (real projections).
    const dashboard = (await (await fetch(`${base}/api/operator/dashboard`)).json()) as {
      trips: Array<{ tripId: string; status: string }>;
    };
    const resolved = dashboard.trips.find((trip) => trip.tripId === spec.trip.id)!;
    assert.equal(resolved.status, 'RESOLVED');
    const travellerView = (await (await fetch(`${base}/api/traveller/${spec.trip.id}`)).json()) as {
      remainderViable: string;
    };
    assert.equal(travellerView.remainderViable, 'VIABLE');

    // Only the frozen runtime actions exist — arbitrary routes 404.
    const unknown = await postJson(base, '/api/runtime/something-else', {});
    assert.equal(unknown.status, 404, 'no scenario-specific runtime routes exist');

    // Audit chain survives on the trip subject.
    const detail = (await (await fetch(`${base}/api/cases/${caseId}`)).json()) as {
      status: string;
      resolution?: { outcome: string };
    };
    assert.equal(detail.status, 'RESOLVED');
    assert.equal(detail.resolution?.outcome, 'FULLY_RECOVERED');

    // Deterministic reset/reseed restores the exact seeded start.
    const reset = await postJson(base, '/api/runtime/reset', { at: RESET_AT });
    assert.equal(reset.status, 200);
    assert.deepEqual((reset.body['tripIds'] as string[]).sort(), [...state.trips.map((t) => t.tripId)].sort());

    const afterReset = (await (await fetch(`${base}/api/runtime/state`)).json()) as {
      openCases: unknown[];
    };
    assert.equal(afterReset.openCases.length, 0);
    const restoredLeg = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(spec.trip.id) as { data: string };
    const restoredTrip = JSON.parse(restoredLeg.data) as { elements: TransportLeg[] };
    const outbound = restoredTrip.elements.find((element) => element.id === 'el_a_flight_out') as TransportLeg;
    assert.equal(outbound.reservationState, 'CONFIRMED', 'reset restores the pristine trip');

    const resetDashboard = (await (await fetch(`${base}/api/operator/dashboard`)).json()) as {
      trips: Array<{ tripId: string; status: string }>;
    };
    const scenarioRows = resetDashboard.trips.filter((trip) => trip.tripId === spec.trip.id);
    assert.ok(scenarioRows.every((trip) => trip.status === 'READY'), 'scenario trips reset pristine');
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

test('R1: wrong-principal and replayed decision boundaries are enforced at runtime', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const spec = loadScenario(SCENARIO_A_DIR);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  try {
    const disruption = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
    const caseId = disruption.body['caseId'] as string;
    const plan = await postJson(base, '/api/runtime/plan', { caseId, at: PLAN_AT });
    const bestStrategyId = plan.body['bestStrategyId'] as string;
    const begin = await postJson(base, '/api/runtime/begin', { caseId, strategyId: bestStrategyId, at: BEGIN_AT });
    const intentId = begin.body['intentId'] as string;

    // Organisation principal cannot settle a REQUIRES_TRAVELLER decision.
    const wrong = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'ORGANISATION', id: spec.context.organisations[0]!.id },
      verdict: 'APPROVED',
      at: DECIDE_AT,
    });
    assert.equal(wrong.status, 409);
    assert.equal((wrong.body as { error: string }).error, 'approval_rejected');

    // Executing without a recorded approval hits the deterministic gate.
    const refused = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: EXECUTE_AT });
    assert.equal(refused.status, 200);
    assert.equal(refused.body['executed'], false);
    assert.ok((refused.body['gateIssues'] as string[]).length > 0, 'gate refuses unapproved execution');

    // The right principal settles it.
    const decide = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0] },
      verdict: 'APPROVED',
      at: DECIDE_AT,
    });
    assert.equal(decide.status, 200);
    const execute = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: EXECUTE_AT });
    assert.equal(execute.body['caseStatus'], 'RESOLVED');

    // A second execution of the same intent is refused by the lifecycle.
    const repeat = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: EXECUTE_AT });
    assert.equal(repeat.status, 409);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

test('R1: the runtime loop is deterministic across identical runs and survives restart', async () => {
  const spec = loadScenario(SCENARIO_A_DIR);

  // Determinism: identical instant sequences on fresh stores -> identical trip state.
  async function runOnce(): Promise<string> {
    const composed = await composeAppRuntime(runtimeConfig);
    const server = createAppServer(runtimeConfig, composed.endpoints);
    await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      await runRuntimeLoop(base, SCENARIO_A_DIR);
      const row = composed.db.prepare('SELECT data FROM trips WHERE id = ?').get(spec.trip.id) as { data: string };
      return row.data;
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
      composed.db.close();
    }
  }
  const firstRun = await runOnce();
  const secondRun = await runOnce();
  assert.equal(firstRun, secondRun, 'identical runtime inputs must produce identical authoritative trip state');

  // Restart: a persisted runtime reconstructs everything from SQLite.
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-r1-'));
  const dbPath = join(dbDir, 'app.sqlite');
  const fileConfig = AppConfigSchema.parse({ ...runtimeConfig, sqlitePath: dbPath });
  const first = await composeAppRuntime(fileConfig);
  const firstServer = createAppServer(fileConfig, first.endpoints);
  await new Promise<void>((resolvePromise) => firstServer.listen(0, resolvePromise));
  await runRuntimeLoop(`http://localhost:${(firstServer.address() as AddressInfo).port}`, SCENARIO_A_DIR);
  await new Promise<void>((resolvePromise, reject) =>
    firstServer.close((error) => (error ? reject(error) : resolvePromise())),
  );
  first.db.close();

  const restarted = await composeAppRuntime(fileConfig);
  try {
    assert.deepEqual(restarted.seededScenarioIds, [], 'restart must not reseed populated state');
    const recoveredTrip = JSON.parse(
      (restarted.db.prepare('SELECT data FROM trips WHERE id = ?').get(spec.trip.id) as { data: string }).data,
    ) as { elements: TransportLeg[] };
    const leg = recoveredTrip.elements.find((element) => element.id === 'el_a_flight_out') as TransportLeg;
    assert.equal(leg.reservationState, 'CONFIRMED', 'recovered replacement persists across restart');
    const cases = restarted.db.prepare('SELECT status FROM cases').all() as Array<{ status: string }>;
    assert.ok(cases.some((row) => row.status === 'RESOLVED'));
  } finally {
    restarted.db.close();
  }
});
