/**
 * R4 — demo reset gate is workspace/demo scoped and refuses when disabled.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoResetGate, EXCLUDED_TABLES } from '../src/app/demo/demoReset.ts';

test('demoResetGate closed without dataset directory', () => {
  const gate = demoResetGate({ NORTHSTAR_DEMO_RESET: '1' } as NodeJS.ProcessEnv);
  assert.equal(gate.open, false);
  if (!gate.open) assert.equal(gate.code, 'DEMO_DATASET_NOT_CONFIGURED');
});

test('demoResetGate closed when explicitly disabled', () => {
  const gate = demoResetGate({
    NORTHSTAR_DEMO_RESET: '0',
    NORTHSTAR_DEMO_DATASET_DIR: 'datasets/ait-summit-2026',
  } as NodeJS.ProcessEnv);
  assert.equal(gate.open, false);
  if (!gate.open) assert.equal(gate.code, 'DEMO_RESET_DISABLED');
});

test('excluded tables never include arbitrary production tables', () => {
  assert.ok(EXCLUDED_TABLES.has('legacy_id_map'));
  assert.ok(!EXCLUDED_TABLES.has('travellers'));
  assert.ok(!EXCLUDED_TABLES.has('workspaces'));
});
