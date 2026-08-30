/**
 * Genericity gate — the engine must stay usable by scenarios that are not the
 * hackathon demo.
 *
 * `anchor-event-speaker` and `corporate-tmc` are deliberately unrelated to the
 * demo world: different organisers, different travellers, different geography,
 * and in corporate-tmc's case no anchor event at all. They also declare no
 * `travelArrangement`, because that field is only ever supplied by a programme
 * roster import.
 *
 * Both bundles are copied into an isolated fixtures root with no programme
 * directory, so every assertion below runs against a world that contains zero
 * demo data. If a projection only works when the demo pack is present, this
 * gate cannot pass — which is the point.
 *
 * This file exists because demo acceptance fixes twice made those bundles
 * vanish from, or read falsely in, generic projections while every demo test
 * stayed green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AppConfigSchema } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { deriveRemainderViability } from '../src/app/readmodels.ts';
import { loadScenario } from '../src/scenarios/loader.ts';

const REPO_FIXTURES = resolve('fixtures');
const BUNDLE_NAMES = ['anchor-event-speaker', 'corporate-tmc'] as const;

/** Generic scenario bundles only — no programmes, no demo recordings. */
function isolatedFixturesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'northstar-genericity-'));
  for (const name of BUNDLE_NAMES) {
    cpSync(join(REPO_FIXTURES, 'scenarios', name), join(root, 'scenarios', name), {
      recursive: true,
    });
  }
  return root;
}

const fixturesDir = isolatedFixturesRoot();
const AT = '2026-09-12T18:10:00+09:00';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir,
  recordingsDir: join(fixturesDir, 'recordings'),
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

const composed = await composeAppRuntime(runtimeConfig);

test.after(() => composed.db.close());

const specs = BUNDLE_NAMES.map((name) => ({
  name,
  spec: loadScenario(join(fixturesDir, 'scenarios', name)),
}));

test('genericity: the world under test carries no demo programme', () => {
  assert.deepEqual(composed.seededProgrammes, [], 'no programme bundle is present');
  assert.equal(composed.seededScenarioIds.length, BUNDLE_NAMES.length);
});

test('genericity: both non-demo bundles seed through the shared bootstrap', () => {
  for (const { name, spec } of specs) {
    assert.ok(
      composed.seededScenarioIds.includes(spec.scenarioId),
      `${name} seeds into the composed runtime`,
    );
  }
});

test('genericity: premise guard — neither bundle declares a programme roster field', () => {
  // If this fails, the visibility assertions below stop proving anything:
  // travelArrangement must stay a programme-import concern, never a
  // precondition for a trip to be visible.
  for (const { name, spec } of specs) {
    assert.ok(spec.context.travellers.length > 0, `${name} has travellers`);
    for (const traveller of spec.context.travellers) {
      assert.equal(
        traveller.travelArrangement,
        undefined,
        `${name} traveller ${traveller.id} must not need travelArrangement`,
      );
    }
  }
});

test('genericity: every generic trip appears in the operator projection', async () => {
  const dashboard = await composed.endpoints.operatorDashboard(AT);
  const projected = new Set(dashboard.trips.map((row) => row.tripId));

  assert.equal(dashboard.trips.length, specs.length, 'both trips project, neither is dropped');

  for (const { name, spec } of specs) {
    assert.ok(projected.has(spec.trip.id), `${name} trip survives the operator projection`);

    const row = dashboard.trips.find((tripRow) => tripRow.tripId === spec.trip.id)!;
    assert.ok(row.travellerNames.length > 0, `${name} row names its travellers`);
    assert.equal(row.travelArrangement, 'UNSPECIFIED', `${name} reads as unspecified`);
    assert.ok(row.status, `${name} row carries a status`);
  }
});

test('genericity: undeclared arrangements never inflate participant totals', async () => {
  const dashboard = await composed.endpoints.operatorDashboard(AT);
  // Absence of the field must not remove a row, and must not be counted as a
  // managed participant either.
  assert.equal(dashboard.arrangementCounts.northstarArranged, 0);
  assert.equal(dashboard.arrangementCounts.selfOrOtherArranged, 0);
  assert.equal(dashboard.arrangementCounts.total, 0);
  assert.equal(dashboard.arrangementCounts.unspecified, 0);
});

test('genericity: both generic trips project a traveller view', async () => {
  for (const { name, spec } of specs) {
    const view = await composed.endpoints.travellerTrip(spec.trip.id, AT);
    assert.ok(view, `${name} traveller view projects`);
    assert.equal(view.tripId, spec.trip.id);
  }
});

function hardness(hardness: 'HARD' | 'SOFT', id: string) {
  return { id, hardness } as never;
}
function verdict(id: string, status: string) {
  return { constraintId: id, status };
}

test('genericity: remainder viability follows current consequences, not a sticky aggregate', () => {
  const hard = hardness('HARD', 'c-hard');
  const soft = hardness('SOFT', 'c-soft');
  const both = [hard, soft];

  // An unresolved hard failure always wins.
  assert.equal(
    deriveRemainderViability(both, [verdict('c-hard', 'FAIL'), verdict('c-soft', 'PASS')], 'DISRUPTED', false),
    'NOT_VIABLE',
  );
  // Nothing has closed this disruption, so the aggregate is still a live hard
  // consequence: a declined recovery must never read as workable.
  assert.equal(deriveRemainderViability(both, [verdict('c-hard', 'PASS')], 'DISRUPTED', false), 'NOT_VIABLE');
  // Once a verified resolution exists, the live evaluations decide the remainder.
  assert.equal(deriveRemainderViability(both, [verdict('c-hard', 'PASS')], 'DISRUPTED', true), 'VIABLE');
  assert.equal(
    deriveRemainderViability(both, [verdict('c-hard', 'PASS'), verdict('c-soft', 'FAIL')], 'DISRUPTED', true),
    'AT_RISK',
    'a soft residual consequence stays visible as risk, never as broken',
  );
  // Uncertainty is never presented as workable.
  assert.equal(
    deriveRemainderViability(both, [verdict('c-hard', 'UNKNOWN'), verdict('c-soft', 'PASS')], 'RECOVERING', true),
    'UNKNOWN',
  );
  assert.equal(deriveRemainderViability(both, [verdict('c-hard', 'PASS')], 'AT_RISK', false), 'AT_RISK');
});
