/**
 * Hero lifecycle convergence over the populated demo world.
 *
 * Proves approval is not recovery, exclusive CTAs, Sarah post-commit
 * terminal projection, decline does not execute, and reload/reopen.
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
const EVENT = () => resolvePopulatedDemoAnchorEventId();

const HERO_TRIPS = {
  s2: 'trip-trv-evt-ait-2026-ait-draft-09',
  s1: 'trip-trv-evt-ait-2026-ait-draft-14',
  s5: 'trip-trv-evt-ait-2026-ait-draft-35',
  s7: 'trip-trv-evt-ait-2026-ait-draft-38',
} as const;

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

async function getHtml(base: string, path: string): Promise<string> {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, `${path} ${response.status}`);
  return response.text();
}

async function resetPopulated(base: string): Promise<void> {
  const reset = await postJson(base, '/api/demo/reset');
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
}

async function operatorDashboard(base: string): Promise<OperatorDashboardView> {
  const response = await getJson(base, `/api/operator/dashboard?event=${encodeURIComponent(EVENT())}`);
  assert.equal(response.status, 200);
  return response.body as unknown as OperatorDashboardView;
}

function tripRow(view: OperatorDashboardView, tripId: string): OperatorTripView | undefined {
  return view.trips.find((row) => row.tripId === tripId);
}

function assertNoRecoveryCtas(html: string, label: string): void {
  assert.doesNotMatch(html, /data-test="resolve-northstar-btn"/, `${label}: Resolve must be absent`);
  assert.doesNotMatch(html, /data-test="begin-strategy-btn"/, `${label}: Begin must be absent`);
  assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/, `${label}: Execute must be absent`);
  assert.doesNotMatch(html, /data-test="organisation-approve-form"/, `${label}: Approve must be absent`);
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
    evidenceDir: resolve('output', 'lifecycle-convergence'),
  });
  const failed = result.evidence.steps.filter((step) => !step.ok);
  assert.equal(failed.length, 0, `${manifestPath} ${startAtStepId}: ${JSON.stringify(failed)}`);
}

async function pendingAuthority(base: string, tripId: string): Promise<{ caseId: string; intentId: string }> {
  const row = tripRow(await operatorDashboard(base), tripId);
  assert.ok(row?.activeCaseId, `no active case for ${tripId}`);
  const detail = await getJson(base, `/api/cases/${row.activeCaseId}`);
  const approval = detail.body['approval'] as { intentId?: string; state?: string } | undefined;
  assert.equal(approval?.state, 'PENDING', `${tripId} approval is not pending`);
  assert.ok(approval.intentId);
  return { caseId: row.activeCaseId, intentId: approval.intentId };
}

test('lifecycle: Jordan plan → begin → approve → execute resolves without missed-flight report', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await resetPopulated(base);
    const row = tripRow(await operatorDashboard(base), HERO_TRIPS.s2);
    assert.ok(row?.activeCaseId, 'Jordan case at pre-emptive entry');
    const caseId = row.activeCaseId!;

    const planned = await postJson(base, '/api/runtime/plan', {
      caseId,
      at: '2026-09-29T12:40:00+09:00',
    });
    assert.equal(planned.status, 200, JSON.stringify(planned.body));
    assert.ok(planned.body['bestStrategyId'], 'plan must rank a connection-viable best strategy');

    const began = await postJson(base, '/api/runtime/begin', {
      caseId,
      strategyId: planned.body['bestStrategyId'],
      at: '2026-09-29T12:45:00+09:00',
    });
    assert.equal(began.status, 200, JSON.stringify(began.body));
    const intentId = began.body['intentId'] as string;
    assert.ok(intentId);

    const decided = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'ORGANISATION', id: 'org-ait-organiser' },
      verdict: 'APPROVED',
      at: '2026-09-29T12:50:00+09:00',
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.notEqual(decided.body['caseStatus'], 'RESOLVED', 'approval must not resolve the case');

    // ONE organiser approval authorises the whole disclosed recovery
    // (I4/PR-10 demo-contract fix): the SAME execute call runs the flight
    // rebooking, then — under that SAME recovery approval envelope, no
    // second human decision — internally plans, stages and executes the
    // still-required Narita overnight hotel too, and the case resolves.
    const executed = await postJson(base, '/api/runtime/execute', {
      caseId,
      intentId,
      at: '2026-09-29T13:00:00+09:00',
    });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    assert.equal(
      executed.body['caseStatus'],
      'RESOLVED',
      `the ONE approval must carry the internally-sequential Narita hotel booking through to resolution: ${JSON.stringify(executed.body)}`,
    );
    assert.equal(executed.body['resolutionOutcome'], 'FULLY_RECOVERED', JSON.stringify(executed.body));

    const resolvedHtml = await getHtml(base, `/operator/cases/${caseId}`);
    assert.match(resolvedHtml, /data-test="case-phase-resolved"/);
    assertNoRecoveryCtas(resolvedHtml, 'Jordan after execute');

    const traveller = await getJson(base, `/api/traveller/${HERO_TRIPS.s2}`);
    assert.equal(traveller.body['remainderViable'], 'VIABLE');
    assert.equal(traveller.body['status'], 'RESOLVED');

    const dash = await operatorDashboard(base);
    const jordan = tripRow(dash, HERO_TRIPS.s2);
    assert.equal(jordan?.status, 'RESOLVED');
    assert.equal(jordan?.remainderViable, 'VIABLE');
    assert.ok(jordan?.historyCaseId);
    assert.equal(jordan?.activeCaseId, undefined);

    const overview = await getHtml(base, `/operator?event=${encodeURIComponent(EVENT())}`);
    assert.match(overview, new RegExp(`data-trip-id="${HERO_TRIPS.s2}"[^>]*data-presentation="CONFIRMED"`));
    const reloaded = await getHtml(base, `/operator/cases/${caseId}`);
    assert.match(reloaded, /data-test="case-phase-resolved"/);
    assertNoRecoveryCtas(reloaded, 'Jordan reopen');
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});

async function jordanIntentAfterBegin(base: string): Promise<{ caseId: string; intentId: string }> {
  const row = tripRow(await operatorDashboard(base), HERO_TRIPS.s2);
  assert.ok(row?.activeCaseId);
  const caseId = row.activeCaseId!;
  const planned = await postJson(base, '/api/runtime/plan', { caseId, at: '2026-09-29T12:40:00+09:00' });
  assert.equal(planned.status, 200);
  const began = await postJson(base, '/api/runtime/begin', {
    caseId,
    strategyId: planned.body['bestStrategyId'],
    at: '2026-09-29T12:45:00+09:00',
  });
  assert.equal(began.status, 200);
  return { caseId, intentId: began.body['intentId'] as string };
}

test('lifecycle: Decline does not execute Jordan recovery', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await resetPopulated(base);
    const { caseId, intentId } = await jordanIntentAfterBegin(base);
    const declined = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'ORGANISATION', id: 'org-ait-organiser' },
      verdict: 'DECLINED',
      at: '2026-09-22T12:00:00+08:00',
    });
    assert.equal(declined.status, 200, JSON.stringify(declined.body));
    assert.notEqual(declined.body['caseStatus'], 'RESOLVED');

    const html = await getHtml(base, `/operator/cases/${caseId}`);
    assert.doesNotMatch(html, /data-test="execute-approved-strategy-btn"/);
    assert.doesNotMatch(html, /data-test="case-phase-resolved"/);
    const traveller = await getJson(base, `/api/traveller/${HERO_TRIPS.s2}`);
    assert.notEqual(traveller.body['remainderViable'], 'VIABLE');
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});

test('lifecycle: Oliver approval exposes Execute then terminal Confirmed', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await resetPopulated(base);
    const { caseId, intentId } = await pendingAuthority(base, HERO_TRIPS.s7);
    const pendingHtml = await getHtml(base, `/operator/cases/${caseId}`);
    assert.doesNotMatch(pendingHtml, /data-test="resolve-northstar-btn"/);
    assert.doesNotMatch(pendingHtml, /data-test="execute-approved-strategy-btn"/);

    const decided = await postJson(base, '/api/runtime/decide', {
      caseId,
      intentId,
      decidedBy: { entityType: 'ORGANISATION', id: 'org-ait-organiser' },
      verdict: 'APPROVED',
      at: '2026-09-22T12:00:00+08:00',
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    const approvedHtml = await getHtml(base, `/operator/cases/${caseId}`);
    assert.match(approvedHtml, /data-test="execute-approved-strategy-btn"/);

    const executed = await postJson(base, '/api/runtime/execute', {
      caseId,
      intentId,
      at: '2026-09-22T12:05:00+08:00',
    });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    const resolvedHtml = await getHtml(base, `/operator/cases/${caseId}`);
    assert.match(resolvedHtml, /data-test="case-phase-resolved"/);
    assertNoRecoveryCtas(resolvedHtml, 'Oliver after execute');
    const dash = await operatorDashboard(base);
    const oliver = tripRow(dash, HERO_TRIPS.s7);
    assert.equal(oliver?.status, 'RESOLVED');
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});

test('lifecycle: Sarah programme commit resolves the same trip with no second Resolve CTA', async () => {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await resetPopulated(base);
    const before = tripRow(await operatorDashboard(base), HERO_TRIPS.s1);
    assert.ok(before?.activeCaseId, 'Sarah has an open case before commit');
    const beforeHtml = await getHtml(base, `/operator/cases/${before.activeCaseId}`);
    assert.doesNotMatch(beforeHtml, /data-test="case-phase-resolved"/);

    await continueManifest(base, 'fixtures/acceptance/manifests/s1-s3-continuity.json', 's3_commit');

    const traveller = await getJson(base, `/api/traveller/${HERO_TRIPS.s1}`);
    assert.equal(traveller.body['remainderViable'], 'VIABLE');
    const dash = await operatorDashboard(base);
    const sarah = tripRow(dash, HERO_TRIPS.s1);
    assert.equal(sarah?.status, 'RESOLVED', JSON.stringify(sarah));
    assert.equal(sarah?.activeCaseId, undefined);
    assert.ok(sarah?.historyCaseId, 'resolved Sarah remains reopenable from Overview');

    const caseHtml = await getHtml(base, `/operator/cases/${sarah.historyCaseId}`);
    assert.match(caseHtml, /data-test="case-phase-resolved"/);
    assertNoRecoveryCtas(caseHtml, 'Sarah after programme commit');
    const overview = await getHtml(base, `/operator?event=${encodeURIComponent(EVENT())}`);
    assert.match(overview, new RegExp(`data-trip-id="${HERO_TRIPS.s1}"[^>]*data-presentation="CONFIRMED"`));
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
});
