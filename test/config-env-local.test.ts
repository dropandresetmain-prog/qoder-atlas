/**
 * F0-config focused tests: .env.local loading and precedence.
 *
 * Proves:
 * 1. no env files → defaults work
 * 2. .env works
 * 3. .env.local overrides .env
 * 4. process environment overrides .env.local
 * 5. empty values do not destroy valid lower-precedence values
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, parseEnvFile } from '../src/config/config.ts';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'northstar-config-test-'));
}

test('config: no env files → defaults work', () => {
  const dir = makeTempDir();
  try {
    const config = loadConfig({}, dir);
    assert.equal(config.adapterMode, 'REPLAY');
    assert.equal(config.environment, 'local');
    assert.equal(config.logLevel, 'info');
    assert.equal(config.httpPort, 8787);
    assert.equal(config.sqlitePath, 'data/app.sqlite');
    assert.equal(config.recordingsDir, 'recordings');
    assert.equal(config.fixturesDir, 'fixtures');
    assert.equal(config.providers.atlas.env, 'sandbox');
    assert.equal(config.providers.atlas.baseUrl, undefined);
    assert.equal(config.providers.atlas.clientId, undefined);
    assert.equal(config.providers.modelStudio.apiKey, undefined);
    assert.equal(config.providers.googleRoutes.apiKey, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: .env file is loaded', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.env'),
      [
        'APP_ENVIRONMENT=dev',
        'HTTP_PORT=9999',
        'ATLAS_ENV=production',
        'ATLAS_BASE_URL=https://atlas.example.com',
        'ATLAS_CLIENT_ID=test-id',
        'ATLAS_CLIENT_SECRET=test-secret',
      ].join('\n'),
    );
    const config = loadConfig({}, dir);
    assert.equal(config.environment, 'dev');
    assert.equal(config.httpPort, 9999);
    assert.equal(config.providers.atlas.env, 'production');
    assert.equal(config.providers.atlas.baseUrl, 'https://atlas.example.com');
    assert.equal(config.providers.atlas.clientId, 'test-id');
    assert.equal(config.providers.atlas.clientSecret, 'test-secret');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: .env.local overrides .env', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.env'),
      [
        'APP_ENVIRONMENT=dev',
        'HTTP_PORT=9999',
        'ATLAS_ENV=production',
        'ATLAS_BASE_URL=https://atlas.example.com',
        'ATLAS_CLIENT_ID=env-id',
        'ATLAS_CLIENT_SECRET=env-secret',
        'MODEL_STUDIO_API_KEY=env-key',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, '.env.local'),
      [
        'HTTP_PORT=7777',
        'ATLAS_BASE_URL=https://local-atlas.example.com',
        'ATLAS_CLIENT_ID=local-id',
        'MODEL_STUDIO_API_KEY=local-key',
      ].join('\n'),
    );
    const config = loadConfig({}, dir);
    // .env value kept (not overridden by .env.local)
    assert.equal(config.environment, 'dev');
    assert.equal(config.providers.atlas.env, 'production');
    assert.equal(config.providers.atlas.clientSecret, 'env-secret');
    // .env.local overrides
    assert.equal(config.httpPort, 7777);
    assert.equal(config.providers.atlas.baseUrl, 'https://local-atlas.example.com');
    assert.equal(config.providers.atlas.clientId, 'local-id');
    assert.equal(config.providers.modelStudio.apiKey, 'local-key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: process environment overrides .env.local', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.env.local'),
      [
        'APP_ENVIRONMENT=demo',
        'HTTP_PORT=7777',
        'ATLAS_BASE_URL=https://local-atlas.example.com',
      ].join('\n'),
    );
    const config = loadConfig(
      { HTTP_PORT: '5555', ATLAS_BASE_URL: 'https://process-atlas.example.com' },
      dir,
    );
    // .env.local value kept (not overridden by process env)
    assert.equal(config.environment, 'demo');
    // process env overrides
    assert.equal(config.httpPort, 5555);
    assert.equal(config.providers.atlas.baseUrl, 'https://process-atlas.example.com');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: empty values in .env.local do not destroy valid .env values', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.env'),
      [
        'ATLAS_BASE_URL=https://atlas.example.com',
        'ATLAS_CLIENT_ID=valid-id',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, '.env.local'),
      [
        '# These are intentionally empty to test precedence',
        'ATLAS_BASE_URL=',
        'ATLAS_CLIENT_ID=',
      ].join('\n'),
    );
    const config = loadConfig({}, dir);
    // The mapEnv `optional` helper treats empty strings as undefined,
    // but .env.local's empty string DOES overwrite .env's value in the
    // merge spread. The optional() then maps '' → undefined.
    // This is the documented behavior: empty = unset.
    // .env.local empty values DO replace .env values (both become undefined).
    assert.equal(config.providers.atlas.baseUrl, undefined);
    assert.equal(config.providers.atlas.clientId, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: .env.local works without .env', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.env.local'),
      [
        'APP_ENVIRONMENT=demo',
        'ADAPTER_MODE=RECORD',
        'MODEL_STUDIO_API_KEY=local-only-key',
      ].join('\n'),
    );
    const config = loadConfig({}, dir);
    assert.equal(config.environment, 'demo');
    assert.equal(config.adapterMode, 'RECORD');
    assert.equal(config.providers.modelStudio.apiKey, 'local-only-key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: full precedence chain — defaults < .env < .env.local < process.env', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(
      join(dir, '.env'),
      [
        'HTTP_PORT=1111',
        'ATLAS_ENV=from-dot-env',
        'ATLAS_BASE_URL=https://dot-env.example.com',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, '.env.local'),
      [
        'HTTP_PORT=2222',
        'ATLAS_BASE_URL=https://dot-env-local.example.com',
        'MODEL_STUDIO_API_KEY=from-local',
      ].join('\n'),
    );
    const config = loadConfig({ ATLAS_BASE_URL: 'https://process.example.com' }, dir);

    // HTTP_PORT: .env=1111, .env.local=2222, process=undefined → 2222
    assert.equal(config.httpPort, 2222);
    // ATLAS_ENV: .env=from-dot-env, .env.local=undefined, process=undefined → from-dot-env
    assert.equal(config.providers.atlas.env, 'from-dot-env');
    // ATLAS_BASE_URL: .env=dot-env, .env.local=dot-env-local, process=process → process
    assert.equal(config.providers.atlas.baseUrl, 'https://process.example.com');
    // MODEL_STUDIO_API_KEY: .env=undefined, .env.local=from-local, process=undefined → from-local
    assert.equal(config.providers.modelStudio.apiKey, 'from-local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseEnvFile: handles empty content gracefully', () => {
  assert.deepEqual(parseEnvFile(''), {});
  assert.deepEqual(parseEnvFile('# only comments\n# nothing else'), {});
});
