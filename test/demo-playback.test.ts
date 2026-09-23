import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, type AppConfig } from '../src/config/config.ts';
import {
  DEFAULT_JORDAN_VIDEO_PLAYBACK_CORPUS,
  evaluateDemoPlaybackPreflight,
  isDemoPlaybackActive,
  researchModeAllowsProtectedExecution,
} from '../src/config/demoPlayback.ts';
import { applyDemoProfileToEnv, PLAYBACK_DEMO_PROFILE_OVERLAY } from '../src/config/demoProfiles.ts';
import { composeOfferExecution } from '../src/app/target/externalOfferExecution.ts';
import { composeStayExecution } from '../src/app/target/externalStayExecution.ts';
import { FrankfurterFxAdapter } from '../src/providers/frankfurter/adapter.ts';
import { createAppRecordingStore } from '../src/providers/recordingStoreFactory.ts';

const ROOT = join(import.meta.dirname, '..');
const CP6_CORPUS = join(ROOT, DEFAULT_JORDAN_VIDEO_PLAYBACK_CORPUS);

function playbackEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return applyDemoProfileToEnv({
    APP_ENVIRONMENT: 'local',
    NORTHSTAR_DEMO_PROFILE: 'playback',
    NORTHSTAR_DEMO_PLAYBACK: '1',
    ...overrides,
  }) as Record<string, string>;
}

test('demo playback preflight fails closed outside local/dev/demo', () => {
  const env = playbackEnv();
  const config = loadConfig(env);
  const preflight = evaluateDemoPlaybackPreflight(
    { ...config, environment: 'production' as AppConfig['environment'] },
    env,
  );
  assert.equal(preflight.ok, false);
  assert.match(preflight.issues.join(' '), /APP_ENVIRONMENT/);
});

test('demo playback preflight requires isolated corpus', () => {
  const env = {
    NORTHSTAR_DEMO_PLAYBACK: '1',
    ADAPTER_MODE: 'REPLAY',
    APP_ENVIRONMENT: 'local',
    RECORDINGS_DIR: 'fixtures/recordings',
  };
  const config = loadConfig(env);
  const preflight = evaluateDemoPlaybackPreflight(config, env);
  assert.equal(preflight.ok, false);
  assert.match(preflight.issues.join(' '), /corpus-isolated/i);
});

test('normal REPLAY without demo playback refuses protected execution research mode', () => {
  const config = loadConfig({ APP_ENVIRONMENT: 'local', ADAPTER_MODE: 'REPLAY' });
  assert.equal(researchModeAllowsProtectedExecution('REPLAY', config, { NORTHSTAR_DEMO_PLAYBACK: '0' }), false);
  assert.equal(composeOfferExecution(config, ROOT), undefined);
  assert.equal(composeStayExecution(config, ROOT), undefined);
});

test('demo playback composes sandbox REPLAY offer and stay execution', () => {
  const env = playbackEnv();
  const config = loadConfig(env);
  assert.equal(isDemoPlaybackActive(config, env), true);
  const offer = composeOfferExecution(config, ROOT);
  const stay = composeStayExecution(config, ROOT);
  assert.ok(offer);
  assert.ok(stay);
  assert.equal(offer!.mode, 'REPLAY');
  assert.equal(stay!.mode, 'REPLAY');
});

test('demo playback allows REPLAY research bindings at approval probe', () => {
  const config = loadConfig(playbackEnv());
  assert.equal(researchModeAllowsProtectedExecution('REPLAY', config, playbackEnv()), true);
});

test('recorded Atlas transaction evidence is wired in CP6 staging corpus', () => {
  const raw = JSON.parse(
    readFileSync(join(CP6_CORPUS, 'atlas/order_create/rec_3580f252fa33262615ca2e28b259dbce.json'), 'utf8'),
  ).raw;
  const env = playbackEnv();
  const config = loadConfig(env);
  assert.ok(composeOfferExecution(config, ROOT));
  assert.equal(raw.orderNo, 'TESTA20260924021509634');
});

test('recorded Nuitée book payload is present in CP6 staging corpus', () => {
  const raw = JSON.parse(
    readFileSync(join(CP6_CORPUS, 'nuitee/book/rec_b9aed078baa79b73e2a7a0b759cac87f.json'), 'utf8'),
  ).raw;
  assert.equal(raw.data.status, 'CONFIRMED');
  assert.ok(raw.data.bookingId);
});

test('REPLAY frankfurter quote uses corpus normalization with zero fetch', async () => {
  const env = playbackEnv({ NORTHSTAR_DEMO_PLAYBACK_SPEED: '1000' });
  const config = loadConfig(env);
  const store = createAppRecordingStore({
    recordingsDir: config.recordingsDir,
    fixturesDir: config.fixturesDir,
    cwd: ROOT,
    adapterMode: 'REPLAY',
  });
  const frankfurter = new FrankfurterFxAdapter({ mode: 'REPLAY', store });
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 500 });
  };
  try {
    const result = await frankfurter.quote({ baseCurrency: 'USD', homeCurrency: 'SGD' });
    assert.equal(fetchCalls, 0);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.meta.mode, 'REPLAY');
      assert.equal(result.data.rates[0]?.homeCurrency, 'SGD');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('playback profile overlay matches CP6 staging corpus path', () => {
  assert.equal(PLAYBACK_DEMO_PROFILE_OVERLAY.RECORDINGS_DIR, DEFAULT_JORDAN_VIDEO_PLAYBACK_CORPUS);
});

test('resolveOfferExecutionInputsForStrategy still refuses REPLAY without playback gate', async () => {
  const env = { APP_ENVIRONMENT: 'local', ADAPTER_MODE: 'REPLAY', NORTHSTAR_DEMO_PLAYBACK: '0' };
  const config = loadConfig({ ...env, demoPlayback: false });
  assert.equal(researchModeAllowsProtectedExecution('REPLAY', config, env), false);
});
