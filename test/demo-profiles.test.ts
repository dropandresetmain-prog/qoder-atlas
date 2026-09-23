import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, mergeEnvWithDotenvFiles } from '../src/config/config.ts';
import {
  applyDemoProfileToEnv,
  evaluateRecordProfilePreflight,
  RECORD_DEMO_PROFILE_OVERLAY,
} from '../src/config/demoProfiles.ts';
import { ATLAS_SANDBOX_HOST } from '../src/providers/atlas/transactionAdapter.ts';

function emptyCwd(): string {
  return mkdtempSync(join(tmpdir(), 'northstar-demo-profile-'));
}

test('demo profile: unset leaves REPLAY and does not force sandbox inputs', () => {
  const cwd = emptyCwd();
  try {
    const config = loadConfig({}, cwd);
    assert.equal(config.adapterMode, 'REPLAY');
    assert.equal(config.providers.atlas.env, 'sandbox');
    const merged = mergeEnvWithDotenvFiles({}, cwd);
    assert.notEqual(merged.NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS, '1');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('demo profile: record forces RECORD sandbox markers over sticky REPLAY file', () => {
  const cwd = emptyCwd();
  try {
    const merged = mergeEnvWithDotenvFiles(
      { NORTHSTAR_DEMO_PROFILE: 'record' },
      cwd,
    );
    assert.equal(merged.ADAPTER_MODE, RECORD_DEMO_PROFILE_OVERLAY.ADAPTER_MODE);
    assert.equal(merged.ATLAS_ENV, 'sandbox');
    assert.equal(merged.NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS, '1');

    const config = loadConfig({ NORTHSTAR_DEMO_PROFILE: 'record' }, cwd);
    assert.equal(config.adapterMode, 'RECORD');
    assert.equal(config.providers.atlas.env, 'sandbox');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('demo profile: record preflight rejects non-sandbox Atlas host', () => {
  const cwd = emptyCwd();
  try {
    const env = applyDemoProfileToEnv({
      NORTHSTAR_DEMO_PROFILE: 'record',
      ATLAS_BASE_URL: 'https://api.production.example',
      ATLAS_CLIENT_ID: 'client',
      ATLAS_CLIENT_SECRET: 'secret',
      NUITEE_API_KEY: 'sand_key',
    });
    const config = loadConfig(env, cwd);
    assert.equal(config.adapterMode, 'RECORD');
    const preflight = evaluateRecordProfilePreflight(config);
    assert.equal(preflight.ok, false);
    assert.match(preflight.issues.join('\n'), new RegExp(ATLAS_SANDBOX_HOST));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('demo profile: record preflight passes with sandbox Atlas + Nuitée key names only', () => {
  const cwd = emptyCwd();
  try {
    const config = loadConfig(
      {
        NORTHSTAR_DEMO_PROFILE: 'record',
        ATLAS_BASE_URL: `https://${ATLAS_SANDBOX_HOST}`,
        ATLAS_CLIENT_ID: 'founder-client',
        ATLAS_CLIENT_SECRET: 'founder-secret',
        NUITEE_API_KEY: 'sand_example',
      },
      cwd,
    );
    const preflight = evaluateRecordProfilePreflight(config);
    assert.equal(preflight.ok, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
