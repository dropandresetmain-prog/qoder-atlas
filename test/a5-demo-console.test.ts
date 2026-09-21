/**
 * A5.1 Demo Console — pure catalog / gate / control-model proofs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { demoResetGate } from '../src/app/demo/demoReset.ts';
import {
  findDemoControl,
  loadDemoControlCatalog,
} from '../src/app/demo/demoControlCatalog.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROLS = join(ROOT, 'data/ait-demo-input-pack/demo-controls.json');
const TIMELINE = join(ROOT, 'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json');
const DISRUPTION = join(
  ROOT,
  'data/ait-demo-input-pack/scenarios/s1-supplier-disruption/inputs/airline-schedule-change-id7159.json',
);

test('demo console gate closed without dataset / when disabled', () => {
  assert.equal(demoResetGate({
    NORTHSTAR_DEMO_DATASET_DIR: '',
    APP_ENVIRONMENT: 'local',
  } as NodeJS.ProcessEnv).open, false);
  assert.equal(demoResetGate({
    NORTHSTAR_DEMO_DATASET_DIR: 'fixtures/programmes/example',
    NORTHSTAR_DEMO_RESET: 'disabled',
    APP_ENVIRONMENT: 'local',
  } as NodeJS.ProcessEnv).open, false);
});

test('demo console catalog lists configured controls without scenario branching', () => {
  const catalog = loadDemoControlCatalog({
    NORTHSTAR_DEMO_CONTROLS_FILE: CONTROLS,
    NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE: DISRUPTION,
    NORTHSTAR_DEMO_PROGRESSIVE_DELAY_TIMELINE: TIMELINE,
  } as NodeJS.ProcessEnv, ROOT);

  assert.ok(catalog.controls.length >= 5);
  const airline = findDemoControl(catalog, 'airline-disruption-configured');
  assert.ok(airline);
  assert.equal(airline!.kind, 'PROVIDER_EVENT');
  assert.equal(airline!.variant, 'CONFIGURED_AIRLINE_REBOOKING');

  const d1 = findDemoControl(catalog, 'delay_begins_connection_viable');
  assert.ok(d1);
  assert.equal(d1!.variant, 'TIMELINE_PROVIDER_STAGE');
  assert.equal(d1!.stageId, 'delay_begins_connection_viable');

  const overnight = findDemoControl(catalog, 'overnight_narita_necessary');
  assert.ok(overnight);
  assert.equal(overnight!.kind, 'EVALUATION_CLOCK_ADVANCE');
  assert.equal(overnight!.variant, 'TIMELINE_CLOCK_STAGE');

  assert.equal(findDemoControl(catalog, 'does-not-exist'), undefined);
});

test('demo console drops airline control when disruption file unset', () => {
  const catalog = loadDemoControlCatalog({
    NORTHSTAR_DEMO_CONTROLS_FILE: CONTROLS,
    NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE: '',
    NORTHSTAR_DEMO_PROGRESSIVE_DELAY_TIMELINE: TIMELINE,
  } as NodeJS.ProcessEnv, ROOT);
  assert.equal(findDemoControl(catalog, 'airline-disruption-configured'), undefined);
  assert.ok(findDemoControl(catalog, 'delay_begins_connection_viable'));
});

test('demo console synthesizes controls from configured sources without catalog file', () => {
  const catalog = loadDemoControlCatalog({
    NORTHSTAR_DEMO_CONTROLS_FILE: '',
    NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE: DISRUPTION,
    NORTHSTAR_DEMO_PROGRESSIVE_DELAY_TIMELINE: TIMELINE,
  } as NodeJS.ProcessEnv, ROOT);
  assert.ok(catalog.controls.some((c) => c.variant === 'CONFIGURED_AIRLINE_REBOOKING'));
  assert.ok(catalog.controls.some((c) => c.variant === 'TIMELINE_PROVIDER_STAGE'));
  assert.ok(catalog.controls.some((c) => c.variant === 'TIMELINE_CLOCK_STAGE'));
});
