import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import {
  DEMO_HERO_WORKFLOWS,
  DEMO_SCENARIO_REHEARSALS,
} from '../src/app/demoHeroes.ts';
import { renderOperatorDashboardBody } from '../src/ui/screens/operator-dashboard.ts';
import { renderProgrammeBody } from '../src/ui/screens/operator-programme.ts';
import { renderDemoPanel } from '../src/ui/screens/demo-panel.ts';
import { healthyProgramme, operatorDashboard } from '../src/ui/fixtures/readmodels.ts';

const NOW = '2026-10-01T12:00:00+08:00' as const;

test('final demo usability: programme traveller names link to traveller detail without requiring an active case', () => {
  const travellerWithoutCase = healthyProgramme.travellers.find((row) => row.activeCaseIds.length === 0);
  assert.ok(travellerWithoutCase, 'fixture includes a traveller without an active case');
  const html = renderProgrammeBody(healthyProgramme);
  assert.match(
    html,
    new RegExp(`href="/traveller\\?trip=${travellerWithoutCase!.tripId}"`),
    'traveller without case must expose a traveller-detail link',
  );
  assert.match(html, /data-test="programme-traveller-link"/);
});

test('final demo usability: programme keeps recovery case separately discoverable when one exists', () => {
  const travellerWithCase = healthyProgramme.travellers.find((row) => row.activeCaseIds.length > 0);
  assert.ok(travellerWithCase, 'fixture includes a traveller with an active case');
  const html = renderProgrammeBody(healthyProgramme);
  const caseId = travellerWithCase!.activeCaseIds[0]!;
  assert.match(html, new RegExp(`href="/operator/cases/${caseId}"`), 'active recovery case remains linked');
  assert.match(html, new RegExp(`href="/traveller\\?trip=${travellerWithCase!.tripId}"`), 'traveller link coexists with case link');
  assert.match(html, /data-test="programme-case-link"/);
});

test('final demo usability: operator overview exposes traveller detail for normal managed trips', () => {
  const html = renderOperatorDashboardBody(operatorDashboard);
  for (const trip of operatorDashboard.trips) {
    assert.match(
      html,
      new RegExp(`href="/traveller\\?trip=${trip.tripId}"`),
      `trip ${trip.tripId} must link to traveller detail`,
    );
  }
  assert.match(html, /data-test="trip-link"/);
});

test('final demo usability: operator overview keeps active recovery case separately discoverable', () => {
  const activeCaseId = 'case-active-operator';
  const tripId = operatorDashboard.trips[0]!.tripId;
  const html = renderOperatorDashboardBody({
    ...operatorDashboard,
    trips: operatorDashboard.trips.map((trip, index) =>
      index === 0 ? { ...trip, activeCaseId } : trip,
    ),
  });
  assert.match(html, new RegExp(`href="/operator/cases/${activeCaseId}"`), 'active case remains linked');
  assert.match(html, new RegExp(`href="/traveller\\?trip=${tripId}"`), 'traveller link coexists with case link');
  assert.match(html, /data-test="case-link"/);
});

test('final demo usability: demo panel renders S1–S8 scenario rehearsal controls from acceptance manifests', () => {
  const html = renderDemoPanel({
    adapterMode: 'REPLAY',
    plannerMode: 'DETERMINISTIC_FALLBACK',
    scenarioNames: [],
    scenarioRehearsals: DEMO_SCENARIO_REHEARSALS.map((rehearsal) => ({
      id: rehearsal.id,
      title: rehearsal.title,
      description: rehearsal.description,
      scenarioId: rehearsal.scenarioId ?? rehearsal.id,
    })),
    heroWorkflows: DEMO_HERO_WORKFLOWS.map((hero) => ({
      id: hero.id,
      title: hero.title,
      description: hero.description,
    })),
    programmeEventId: 'evt-ait-2026',
  });
  assert.match(html, /Scenario rehearsal/i);
  for (const scenarioId of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) {
    assert.match(html, new RegExp(`data-scenario="${scenarioId}"`), `${scenarioId} rehearsal control expected`);
  }
  assert.match(html, /Final video flows/i);
  assert.match(html, /data-workflow="s2"/);
  assert.match(html, /data-workflow="s1-s3"/);
  assert.match(html, /data-workflow="s7"/);
  assert.match(html, /data-workflow="s5"/);
});

test('final demo usability: served /demo exposes rehearsal and hero launch affordances', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: 'fixtures',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const html = await (await fetch(`${base}/demo`)).text();
    assert.match(html, /Scenario rehearsal/i);
    for (const scenarioId of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) {
      assert.match(html, new RegExp(`data-scenario="${scenarioId}"`), `${scenarioId} must appear on /demo`);
    }
    assert.match(html, /Final video flows/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    composed.db.close();
  }
});

test('final demo usability: integrated programme and operator pages expose human traveller navigation', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: 'fixtures',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const programmeHtml = await (await fetch(`${base}/programme?event=evt-ait-2026&at=${encodeURIComponent(NOW)}`)).text();
    assert.match(programmeHtml, /href="\/traveller\?trip=/);
    assert.match(programmeHtml, /data-test="programme-traveller-link"/);

    const overviewHtml = await (await fetch(`${base}/operator?event=evt-ait-2026&at=${encodeURIComponent(NOW)}`)).text();
    assert.match(overviewHtml, /href="\/traveller\?trip=/);
    assert.match(overviewHtml, /data-test="trip-link"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    composed.db.close();
  }
});

interface DemoLaunchResponse {
  workflowId: string;
  scenarioId: string;
  title: string;
  ok: boolean;
  stoppedBefore: string[];
  stepsRun: number;
  steps: Array<{ id: string; ok: boolean; error?: string }>;
  inspectPaths: string[];
  evidencePath?: string;
  error?: string;
}

function programmeReplayConfig(sqlitePath: string) {
  return AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath,
    fixturesDir: 'fixtures',
    worldSeedMode: 'programme',
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
}

test('final demo usability: S4 rehearsal executes through the deployed demo launch HTTP path', async () => {
  const config = programmeReplayConfig(':memory:');
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/api/demo/launch?workflow=rehearsal-s4`, { method: 'POST' });
    assert.equal(response.status, 200, 'S4 rehearsal launch must succeed over HTTP');
    const body = await response.json() as DemoLaunchResponse;
    assert.equal(body.workflowId, 'rehearsal-s4');
    assert.equal(body.scenarioId, 'S4');
    assert.equal(body.ok, true, 'manifest run must complete without failed steps');
    assert.ok(body.stepsRun > 0, 'at least one manifest step must execute');
    assert.ok(Array.isArray(body.inspectPaths) && body.inspectPaths.length > 0);
    assert.ok(body.inspectPaths.includes('/programme?event=evt-ait-2026'));
    assert.ok(body.inspectPaths.includes('/operator?event=evt-ait-2026'));
    assert.ok(
      body.inspectPaths.some((path) => path.startsWith('/traveller?trip=')),
      'inspect paths must include the affected traveller trip',
    );
    assert.ok(body.inspectPaths.includes('/decisions'));
    assert.deepEqual(body.stoppedBefore, [], 'S4 is a full rehearsal without stop-before authority');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    composed.db.close();
  }
});
