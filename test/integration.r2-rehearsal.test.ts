/**
 * R2.3 — eight-scenario operational rehearsal from populated Overview entry.
 *
 * One pass: reset → verify all entry states on the operator dashboard →
 * continue each scenario through its remaining manifest steps → reset restores entry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { runAcceptanceManifest } from '../src/acceptance/runner.ts';
import { resolvePopulatedDemoAnchorEventId } from '../src/app/demoWorld.ts';
import type { OperatorDashboardView, OperatorTripView } from '../src/contracts/readmodels.ts';

const FIXTURES_ROOT = resolve('fixtures');
const CWD = resolve('.');

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

const HERO_TRIPS = {
  s2: 'trip-trv-evt-ait-2026-ait-draft-09',
  s1: 'trip-trv-evt-ait-2026-ait-draft-14',
  s4: 'trip-trv-evt-ait-2026-ait-draft-34',
  s5: 'trip-trv-evt-ait-2026-ait-draft-35',
  s6: 'trip-trv-evt-ait-2026-ait-draft-31',
  s7: 'trip-trv-evt-ait-2026-ait-draft-38',
  s8: 'trip-trv-evt-ait-2026-ait-draft-30',
} as const;

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

async function resetPopulated(base: string): Promise<void> {
  const reset = await postJson(base, '/api/demo/reset');
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body['ok'], true);
}

async function operatorDashboard(base: string, eventId: string): Promise<OperatorDashboardView> {
  const response = await getJson(base, `/api/operator/dashboard?event=${encodeURIComponent(eventId)}`);
  assert.equal(response.status, 200);
  return response.body as unknown as OperatorDashboardView;
}

function tripRow(view: OperatorDashboardView, tripId: string): OperatorTripView | undefined {
  return view.trips.find((row) => row.tripId === tripId);
}

async function continueManifest(
  base: string,
  manifestPath: string,
  startAtStepId: string,
  initialBindings?: Record<string, string>,
  stopBeforeStepIds?: readonly string[],
): Promise<void> {
  const result = await runAcceptanceManifest({
    manifestPath,
    cwd: CWD,
    baseUrl: base,
    skipPreflight: true,
    config: demoConfig,
    startAtStepId,
    ...(initialBindings ? { initialBindings } : {}),
    ...(stopBeforeStepIds ? { stopBeforeStepIds } : {}),
    skipAssertions: false,
    evidenceDir: resolve('output', 'demo-r2-rehearsal'),
  });
  const failed = result.evidence.steps.filter((step) => !step.ok);
  assert.equal(failed.length, 0, `${manifestPath} from ${startAtStepId}: ${JSON.stringify(failed)}`);
}

async function caseBinding(base: string, tripId: string): Promise<{ caseId: string }> {
  const eventId = resolvePopulatedDemoAnchorEventId();
  const row = tripRow(await operatorDashboard(base, eventId), tripId);
  assert.ok(row?.activeCaseId, `no active case for ${tripId}`);
  return { caseId: row.activeCaseId };
}

async function authorityBindings(base: string, tripId: string): Promise<{ caseId: string; intentId: string }> {
  const eventId = resolvePopulatedDemoAnchorEventId();
  const row = tripRow(await operatorDashboard(base, eventId), tripId);
  assert.ok(row?.activeCaseId, `no active case for ${tripId}`);
  const detail = await getJson(base, `/api/cases/${row.activeCaseId}`);
  assert.equal(detail.status, 200);
  const approval = detail.body['approval'] as { intentId?: string } | undefined;
  assert.ok(approval?.intentId, `no pending intent for case ${row.activeCaseId}`);
  return { caseId: row.activeCaseId, intentId: approval.intentId! };
}

test('R2.3: populated Overview entry states for S1–S8', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const eventId = resolvePopulatedDemoAnchorEventId();

  try {
    await resetPopulated(base);
    const view = await operatorDashboard(base, eventId);

    const sarah = await getJson(base, `/api/traveller/${HERO_TRIPS.s1}`);
    assert.equal(sarah.body['remainderViable'], 'NOT_VIABLE');
    assert.ok(tripRow(view, HERO_TRIPS.s1)?.activeCaseId, 'S1 Sarah case linkable from Overview');

    const jordanRow = tripRow(view, HERO_TRIPS.s2);
    assert.ok(jordanRow?.activeCaseId, 'S2 Jordan case linkable from Overview');
    assert.equal(jordanRow?.status, 'DISRUPTED', 'S2 Jordan prefix stops at pre-emptive disruption beat');
    const jordanDetail = await getJson(base, `/api/cases/${jordanRow!.activeCaseId}`);
    assert.equal((jordanDetail.body['options'] as unknown[] | undefined)?.length ?? 0, 0, 'S2 Jordan has not been planned yet at demo entry');
    const approvals = await getJson(base, '/api/wave/approvals');
    const jordanPending = (approvals.body['pending'] as Array<{ tripId: string }>).some(
      (row) => row.tripId === HERO_TRIPS.s2,
    );
    assert.ok(!jordanPending, 'S2 Jordan must not land directly at organiser approval');

    const ethan = tripRow(view, HERO_TRIPS.s4);
    assert.ok(ethan?.activeCaseId, 'S4 Ethan case linkable from Overview');

    const jonas = tripRow(view, HERO_TRIPS.s5);
    assert.ok(jonas?.activeCaseId, 'S5 Jonas case linkable from Overview');

    const hannah = tripRow(view, HERO_TRIPS.s6);
    assert.ok(hannah?.activeCaseId, 'S6 Hannah case linkable from Overview');

    const oliver = tripRow(view, HERO_TRIPS.s7);
    assert.ok(oliver?.activeCaseId, 'S7 Oliver case linkable from Overview');

    const mei = tripRow(view, HERO_TRIPS.s8);
    assert.ok(mei?.activeCaseId, 'S8 Mei Ling case linkable from Overview');

    const travellerCase = await getJson(base, `/api/cases/${mei!.activeCaseId}`);
    assert.equal(travellerCase.status, 200);
    assert.equal(travellerCase.body['status'], 'DISRUPTED');
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});

test('R2.3: continue hero flows from populated entry (S2,S5,S7,S1→S3) and reset restores entry', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await resetPopulated(base);

    await continueManifest(
      base,
      'fixtures/acceptance/manifests/s5-stay-until-sunday.json',
      'decide',
      await authorityBindings(base, HERO_TRIPS.s5),
    );
    const jonasAfter = await getJson(base, `/api/traveller/${HERO_TRIPS.s5}`);
    assert.equal(jonasAfter.body['remainderViable'], 'VIABLE');

    await continueManifest(
      base,
      'fixtures/acceptance/manifests/s7-origin-tokyo.json',
      'decide',
      await authorityBindings(base, HERO_TRIPS.s7),
    );
    const oliverCase = await getJson(base, `/api/traveller/${HERO_TRIPS.s7}`);
    assert.equal(oliverCase.status, 200);

    await continueManifest(
      base,
      'fixtures/acceptance/manifests/s1-s3-continuity.json',
      's3_preview',
      undefined,
      ['observe_mid_preview'],
    );
    const sarahMid = await getJson(base, `/api/traveller/${HERO_TRIPS.s1}`);
    assert.equal(sarahMid.body['remainderViable'], 'NOT_VIABLE', 'preview must not mutate viability');

    await continueManifest(
      base,
      'fixtures/acceptance/manifests/s1-s3-continuity.json',
      's3_commit',
    );
    const sarahFinal = await getJson(base, `/api/traveller/${HERO_TRIPS.s1}`);
    assert.equal(sarahFinal.body['remainderViable'], 'VIABLE');

    // S2 end-to-end uses the full manifest (REPLAY recordings) — populated prefix
    // intentionally stops at J-03 pre-emptive disruption for judge entry.
    await continueManifest(
      base,
      'fixtures/acceptance/manifests/s2-missed-connection.json',
      'reset',
      undefined,
      ['decide_recovery'],
    );
    await continueManifest(
      base,
      'fixtures/acceptance/manifests/s2-missed-connection.json',
      'decide_recovery',
      await authorityBindings(base, HERO_TRIPS.s2),
    );
    const jordanAfter = await getJson(base, `/api/traveller/${HERO_TRIPS.s2}`);
    assert.equal(jordanAfter.body['remainderViable'], 'VIABLE');

    await resetPopulated(base);
    const sarahRestored = await getJson(base, `/api/traveller/${HERO_TRIPS.s1}`);
    assert.equal(sarahRestored.body['remainderViable'], 'NOT_VIABLE');
    const eventId = resolvePopulatedDemoAnchorEventId();
    const jordanRestored = tripRow(await operatorDashboard(base, eventId), HERO_TRIPS.s2);
    assert.equal(jordanRestored?.status, 'DISRUPTED', 'reset restores S2 pre-emptive disruption entry');
    const jordanCase = await getJson(base, `/api/cases/${jordanRestored!.activeCaseId}`);
    assert.equal((jordanCase.body['options'] as unknown[] | undefined)?.length ?? 0, 0);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});

test('R2.3: S4 infeasible planning and S6 open planning remain honest from populated entry', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await resetPopulated(base);

    const ethanRow = tripRow(await operatorDashboard(base, resolvePopulatedDemoAnchorEventId()), HERO_TRIPS.s4);
    assert.ok(ethanRow?.activeCaseId);
    const ethanCase = await getJson(base, `/api/cases/${ethanRow!.activeCaseId}`);
    assert.equal(ethanCase.body['status'], 'CHANGE_REQUESTED');
    const ethanOptions = ethanCase.body['options'] as Array<{ verdict: string }>;
    assert.ok(ethanOptions.length >= 1);
    assert.ok(ethanOptions.every((option) => option.verdict === 'NOT_VIABLE'), 'S4 corridor options rejected');

    const hannahRow = tripRow(await operatorDashboard(base, resolvePopulatedDemoAnchorEventId()), HERO_TRIPS.s6);
    assert.ok(hannahRow?.activeCaseId);
    const hannahCase = await getJson(base, `/api/cases/${hannahRow!.activeCaseId}`);
    assert.equal(hannahCase.body['status'], 'CHANGE_REQUESTED');
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});
