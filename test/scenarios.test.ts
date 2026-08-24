/**
 * F3 evidence — acceptance scenario schema-load assertions.
 * Both scenarios load through the SAME F1/F2 contracts and the same
 * ScenarioSpec schema; any divergence in required shape would fail here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  loadScenario,
  listScenarioDirs,
  missingSourceFiles,
  ScenarioLoadError,
} from '../src/scenarios/loader.ts';
import type { ScenarioSpec } from '../src/scenarios/spec.ts';
import { TripElementKindSchema } from '../src/domain/elements.ts';
import { PolicyRuleKindSchema } from '../src/domain/rules.ts';

const FIXTURES_ROOT = resolve('fixtures/scenarios');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'anchor-event-speaker');
const SCENARIO_B_DIR = join(FIXTURES_ROOT, 'corporate-tmc');

function loadBoth(): [ScenarioSpec, ScenarioSpec] {
  return [loadScenario(SCENARIO_A_DIR), loadScenario(SCENARIO_B_DIR)];
}

test('scenarios: both bundles load through the identical ScenarioSpec schema', () => {
  const [a, b] = loadBoth();
  assert.equal(a.scenarioId, 'scenario-anchor-event-speaker');
  assert.equal(b.scenarioId, 'scenario-corporate-tmc');
  for (const spec of [a, b]) {
    assert.ok(spec.trip.travellerIds.length >= 1);
    assert.ok(spec.trip.elements.length >= 4);
    assert.ok(spec.trip.objectives.length >= 1);
    assert.ok(spec.constraints.length >= 1);
    assert.ok(spec.disruption.signal.id);
  }
});

test('scenarios: referential integrity and source files hold for both', () => {
  for (const dir of [SCENARIO_A_DIR, SCENARIO_B_DIR]) {
    const spec = loadScenario(dir);
    assert.deepEqual(missingSourceFiles(dir, spec), [], `missing source files in ${dir}`);
  }
});

test('scenarios: A and B are materially different, not renamed copies', () => {
  const [a, b] = loadBoth();

  // Governance: A is organiser-governed with an AnchorEvent; B is TMC + employer
  // with no anchor event at all.
  assert.equal(a.context.anchorEvents.length, 1);
  assert.equal(b.context.anchorEvents.length, 0);
  assert.equal(a.trip.anchorEventId, a.context.anchorEvents[0]?.id);
  assert.equal(b.trip.anchorEventId, undefined);

  const aOrgKinds = new Set(a.context.organisations.flatMap((o) => o.roles));
  const bOrgKinds = new Set(b.context.organisations.flatMap((o) => o.roles));
  assert.ok(aOrgKinds.has('EVENT_ORGANISER'));
  assert.ok(!bOrgKinds.has('EVENT_ORGANISER'));
  assert.ok(bOrgKinds.has('OPERATOR'));
  assert.equal(b.context.organisations.length, 2);

  // Policy/approval path differs.
  assert.equal(a.expectations.authority.expectedOutcome, 'REQUIRES_TRAVELLER');
  assert.equal(b.expectations.authority.expectedOutcome, 'REQUIRES_ORGANISATION_APPROVER');

  // Resolution outcome differs.
  assert.equal(a.expectations.recovery.expectedResolution, 'FULLY_RECOVERED');
  assert.equal(b.expectations.recovery.expectedResolution, 'RECOVERED_WITH_LOSS');
  assert.deepEqual(b.expectations.recovery.remainingLossObjectiveIds, ['obj_b_return']);
  assert.deepEqual(a.expectations.recovery.remainingLossObjectiveIds, []);

  // Supplier mix differs: A has an insurance RuleSet and an on-demand transfer;
  // B has refundable hotel terms and a confirmed private transfer.
  const aRuleKinds = a.context.ruleSets.map((r) => r.kind);
  const bRuleKinds = b.context.ruleSets.map((r) => r.kind);
  assert.ok(aRuleKinds.includes('INSURANCE'));
  assert.ok(!bRuleKinds.includes('INSURANCE'));

  const aTransfer = a.trip.elements.find((e) => e.id === 'el_a_transfer');
  assert.ok(aTransfer && aTransfer.elementKind === 'TRANSPORT_LEG');
  if (aTransfer?.elementKind === 'TRANSPORT_LEG') {
    assert.equal(aTransfer.reservationState, 'NONE');
    assert.equal(aTransfer.flexibility, 'FLEXIBLE');
  }
  const bTransfer = b.trip.elements.find((e) => e.id === 'el_b_transfer_out');
  assert.ok(bTransfer && bTransfer.elementKind === 'TRANSPORT_LEG');
  if (bTransfer?.elementKind === 'TRANSPORT_LEG') {
    assert.equal(bTransfer.reservationState, 'CONFIRMED');
    assert.equal(bTransfer.data.mode, 'PRIVATE_TRANSFER');
  }

  // Routes/cities differ (checked via place identity, not content).
  const aPlaces = new Set(a.context.places.map((p) => p.id));
  const bPlaces = new Set(b.context.places.map((p) => p.id));
  assert.equal([...aPlaces].some((p) => bPlaces.has(p)), false);
});

test('scenarios: both use only the closed generic vocabularies', () => {
  const [a, b] = loadBoth();
  const elementKinds = new Set(TripElementKindSchema.options);
  const ruleKinds = new Set(PolicyRuleKindSchema.options);
  for (const spec of [a, b]) {
    for (const element of spec.trip.elements) {
      assert.ok(elementKinds.has(element.elementKind), `unexpected element kind ${element.elementKind}`);
    }
    for (const ruleSet of spec.context.ruleSets) {
      for (const rule of ruleSet.rules) {
        assert.ok(ruleKinds.has(rule.kind), `unexpected rule kind ${rule.kind}`);
      }
    }
  }
});

test('scenarios: preference reprioritisation is explicit and post-disruption', () => {
  const [a, b] = loadBoth();
  const aInstruction = a.disruption.postDisruptionPreferences[0];
  assert.equal(aInstruction?.origin.kind, 'EXPLICIT_INSTRUCTION');
  const bInstruction = b.disruption.postDisruptionPreferences[0];
  assert.equal(bInstruction?.origin.kind, 'EXPLICIT_INSTRUCTION');
  // And each trip also carries a non-instruction preference (latent/persistent).
  assert.equal(a.context.preferences[0]?.origin.kind, 'LATENT_INFERRED');
  assert.equal(b.context.preferences[0]?.origin.kind, 'EXPLICIT_PERSISTENT');
});

test('scenarios: discovery lists every directory carrying a scenario.json', () => {
  // Discovery is presence-based (a scenario.json file), not schema-aware: it
  // also finds the four lightweight DR-9 S1-S4 generic acceptance packs
  // alongside the two full engine ScenarioSpec bundles (anchor-event-speaker,
  // corporate-tmc) — boot/reset seeding is what filters to engine-loadable
  // bundles (see compose.ts / runtime.ts reset()).
  const dirs = listScenarioDirs(FIXTURES_ROOT);
  assert.equal(dirs.length, 6);
});

test('loader: dangling references fail schema-load instead of silently loading', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-bad-'));
  const good = loadScenario(SCENARIO_A_DIR);
  const broken = JSON.parse(JSON.stringify(good)) as ScenarioSpec;
  broken.trip.elements[0]!.dependsOn = ['el_does_not_exist'];
  // dependsOn is not reference-checked; break a checked reference instead.
  broken.expectations.impact.directFailureElementIds = ['el_does_not_exist'];
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(broken));
  assert.throws(
    () => loadScenario(dir),
    (err: unknown) => err instanceof ScenarioLoadError && err.issues.length > 0,
  );
});

test('loader: schema-invalid bundle reports field-level issues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-invalid-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ scenarioId: 'x' }));
  assert.throws(
    () => loadScenario(dir),
    (err: unknown) => err instanceof ScenarioLoadError && err.issues.some((i) => i.startsWith('title')),
  );
});
