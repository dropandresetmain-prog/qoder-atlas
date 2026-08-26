/**
 * Final-demo runtime convergence: baseline viability, programme-scoped world
 * seed, and demo hero launcher wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { createAppServer } from '../src/server/http.ts';
import { resolveWorldSeedMode, shouldBootSeedScenario, loadWorldSeedPolicy } from '../src/app/worldSeed.ts';
import { DEMO_HERO_WORKFLOWS, demoHeroWorkflow } from '../src/app/demoHeroes.ts';
import { join, resolve } from 'node:path';

const FIXTURES = resolve('fixtures');

function programmeConfig(sqlitePath: string, worldSeedMode?: 'full' | 'programme') {
  return AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath,
    fixturesDir: 'fixtures',
    ...(worldSeedMode ? { worldSeedMode } : {}),
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
}

test('world-seed: acceptance harness scenarios are skipped in programme mode', () => {
  assert.equal(resolveWorldSeedMode({ environment: 'demo' }), 'programme');
  assert.equal(resolveWorldSeedMode({ environment: 'local' }), 'full');
  assert.equal(
    resolveWorldSeedMode({ environment: 'local', worldSeedMode: 'programme' }),
    'programme',
  );

  const harnessA = join(FIXTURES, 'scenarios', 'anchor-event-speaker');
  const harnessB = join(FIXTURES, 'scenarios', 'corporate-tmc');
  assert.equal(loadWorldSeedPolicy(harnessA).role, 'acceptance_harness');
  assert.equal(loadWorldSeedPolicy(harnessB).role, 'acceptance_harness');
  assert.equal(shouldBootSeedScenario(harnessA, 'programme'), false);
  assert.equal(shouldBootSeedScenario(harnessA, 'full'), true);
});

test('fresh programme-mode seed: 67 AiT trips, baseline viability reconciled, no harness pollution', async () => {
  const composed = await composeAppRuntime(programmeConfig(':memory:', 'programme'));
  try {
    const summaries = await composed.readDeps.snapshot.trips.listTrips();
    assert.equal(summaries.length, 67, 'programme-mode boot seeds only the AiT programme');
    assert.deepEqual(composed.seededScenarioIds, []);
    assert.equal(composed.seededProgrammes.length, 1);
    assert.equal(composed.seededProgrammes[0]?.promotedCount, 67);

    const dashboard = await composed.endpoints.operatorDashboard(composed.endpoints.now(), {
      anchorEventId: composed.seededProgrammes[0]!.anchorEventId,
    });
    assert.equal(dashboard.trips.length, 67);

    const heroes = ['Jordan Hale', 'Sarah Lim', 'Jonas Berg', 'Oliver Bennett'];
    const names = new Set(dashboard.trips.flatMap((trip) => trip.travellerNames));
    for (const hero of heroes) {
      assert.ok(names.has(hero), `hero ${hero} present in operator world`);
    }

    let viableOrRisk = 0;
    let unknown = 0;
    let ready = 0;
    for (const summary of summaries) {
      const trip = await composed.readDeps.snapshot.trips.getTrip(summary.tripId);
      assert.ok(trip);
      if (trip.viability === 'UNKNOWN') unknown += 1;
      else viableOrRisk += 1;
      if (trip.viability === 'VIABLE') {
        // VIABLE is the only path to READY without an open case
        ready += 1;
      }
    }
    assert.ok(viableOrRisk > 0, 'at least some trips received determinate baseline viability');
    assert.ok(unknown > 0, 'engagement-only / insufficient-evidence trips remain UNKNOWN');
    assert.ok(ready > 0, 'confirmed travel baselines can evaluate to VIABLE/READY');
    assert.equal(dashboard.summary.ready, ready);
  } finally {
    composed.db.close();
  }
});

test('demo hero catalog exposes S1-S3, S2, S5, S7 with stop-before authority boundaries', () => {
  assert.deepEqual(
    DEMO_HERO_WORKFLOWS.map((w) => w.id).sort(),
    ['s1-s3', 's2', 's5', 's7'].sort(),
  );
  assert.ok(demoHeroWorkflow('s5')?.stopBeforeStepIds.includes('decide'));
  assert.ok(demoHeroWorkflow('s2')?.stopBeforeStepIds.includes('decide_recovery'));
  assert.ok(demoHeroWorkflow('s7')?.stopBeforeStepIds.includes('decide'));
  assert.deepEqual(demoHeroWorkflow('s1-s3')?.stopBeforeStepIds, []);
});

test('demo panel and launch endpoint are wired for final heroes', async () => {
  const config = programmeConfig(':memory:', 'programme');
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const panel = await fetch(`${base}/demo`);
    assert.equal(panel.status, 200);
    const html = await panel.text();
    assert.match(html, /Final hero workflows/);
    assert.match(html, /data-workflow="s2"/);
    assert.match(html, /data-workflow="s5"/);
    assert.match(html, /data-workflow="s7"/);
    assert.match(html, /data-workflow="s1-s3"/);
    assert.match(html, /\/api\/demo\/launch/);

    assert.ok(composed.endpoints.demo?.launchHero);
    assert.ok(composed.endpoints.demo?.heroWorkflows?.().some((h) => h.id === 's5'));
  } finally {
    await new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done())));
    composed.db.close();
  }
});
