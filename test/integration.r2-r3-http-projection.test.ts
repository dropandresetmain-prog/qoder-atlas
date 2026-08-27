/**
 * R2/R3 integration — HTTP projection wiring and case URL safety.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import type { AppEndpoints } from '../src/server/http.ts';
import { projectDecisionsPage } from '../src/app/decisionsPresentation.ts';
import { projectProgrammeActivityPage } from '../src/app/activityPresentation.ts';
import { caseAwaitingOrganisationApproval, operatorDashboard } from '../src/ui/fixtures/readmodels.ts';

const NOW = '2026-10-01T12:00:00+08:00' as const;

const demoConfig = AppConfigSchema.parse({
  environment: 'demo',
  worldSeedMode: 'programme',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: 'fixtures',
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
});

async function withComposedServer(
  run: (base: string, composed: Awaited<ReturnType<typeof composeAppRuntime>>) => Promise<void>,
): Promise<void> {
  const composed = await composeAppRuntime(demoConfig);
  const server = createAppServer(demoConfig, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(base, composed);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }
}

test('R3A HTTP: composed runtime wires decisionsPage and activityPage endpoints', async () => {
  const composed = await composeAppRuntime(demoConfig);
  try {
    assert.equal(typeof composed.endpoints.decisionsPage, 'function');
    assert.equal(typeof composed.endpoints.activityPage, 'function');
    const at = composed.endpoints.now();
    const decisions = await composed.endpoints.decisionsPage!(at);
    const activity = await composed.endpoints.activityPage!(at);
    assert.ok(Array.isArray(decisions.pending));
    assert.ok(Array.isArray(decisions.decided));
    assert.ok(Array.isArray(activity.days));
  } finally {
    composed.db.close();
  }
});

test('R3A HTTP: /decisions and /activity prefer rich projections over legacy mappers', async () => {
  await withComposedServer(async (base, composed) => {
    await fetch(`${base}/api/demo/reset`, { method: 'POST' });
    const at = composed.endpoints.now();
    const projected = await projectDecisionsPage(composed.readDeps, at);
    const decisionsHtml = await (await fetch(`${base}/decisions`)).text();
    assert.match(decisionsHtml, /data-ui-screen="decisions"/);
    assert.match(decisionsHtml, /Decided recently/);
    assert.match(decisionsHtml, /Waiting on/);
    if (projected.pending.length > 0) {
      const first = projected.pending[0]!;
      assert.match(decisionsHtml, new RegExp(escapeRegex(first.travellerName)));
      if (first.waitingOn) {
        assert.match(decisionsHtml, new RegExp(escapeRegex(first.waitingOn)));
      }
    }

    const projectedActivity = await projectProgrammeActivityPage(composed.readDeps, at);
    const activityHtml = await (await fetch(`${base}/activity`)).text();
    assert.match(activityHtml, /data-ui-screen="activity"/);
    if (projectedActivity.days.length > 0) {
      const sample = projectedActivity.days[0]!.items[0];
      if (sample?.text) {
        assert.match(activityHtml, new RegExp(escapeRegex(sample.text)));
      }
    }
  });
});

test('R3B HTTP: colon-containing case IDs are encoded in links and decoded in routes', async () => {
  const colonCaseId = 'case:hero:colon-test';
  const dashboard = structuredClone(operatorDashboard);
  dashboard.trips[0] = {
    ...dashboard.trips[0]!,
    activeCaseId: colonCaseId,
    status: 'DISRUPTED',
  };
  const endpoints: AppEndpoints = {
    now: () => NOW,
    operatorDashboard: async () => dashboard,
    caseDetail: async (caseId) => (caseId === colonCaseId ? caseAwaitingOrganisationApproval : undefined),
    travellerTrip: async () => undefined,
    firstTripId: async () => undefined,
    travellerDecision: async () => ({ accepted: false }),
  };
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: 'fixtures',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const server = createAppServer(config, endpoints);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const overview = await (await fetch(`${base}/operator`)).text();
    assert.match(overview, /href="\/operator\/cases\/case%3Ahero%3Acolon-test"/);

    const encodedPath = `/operator/cases/${encodeURIComponent(colonCaseId)}`;
    const casePage = await fetch(`${base}${encodedPath}`);
    assert.equal(casePage.status, 200);
    const caseHtml = await casePage.text();
    assert.match(caseHtml, /Mia Chen/);
    assert.match(caseHtml, /data-test="primary-action-panel"|What to do next/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
