/**
 * C1 evidence — provider foundation: LIVE/RECORD/REPLAY share one normalize
 * path, recordings are sanitized + deterministic, provider failure is
 * structured data (T-ADAPTER: mode/error/sanitization).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderAdapter } from '../src/contracts/envelope.ts';
import {
  CapabilityFailure,
  FileRecordingStore,
  REDACTED,
  capabilityFailure,
  canonicalJson,
  containsAnySecret,
  recordingIdFor,
  runAdapter,
  sanitizeRaw,
  toCapabilityError,
} from '../src/providers/index.ts';

interface FakeRaw {
  value: string;
  token?: string;
}

function makeAdapter(
  mode: 'LIVE' | 'RECORD' | 'REPLAY',
  obtain: () => Promise<FakeRaw>,
): ProviderAdapter<{ key: string }, FakeRaw, string> {
  return {
    providerId: 'provider-x',
    mode,
    obtainRaw: obtain,
    normalize: (raw) => raw.value.toUpperCase(),
  };
}

const REQUEST = { key: 'req-1' };

function emptyStore(): FileRecordingStore {
  return new FileRecordingStore({ readDirs: [], writeDir: mkdtempSync(join(tmpdir(), 'rec-')) });
}

test('C1: LIVE runs provider raw through normalize without recording', async () => {
  const adapter = makeAdapter('LIVE', async () => ({ value: 'live' }));
  const result = await runAdapter(adapter, emptyStore(), REQUEST, { operation: 'search' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data, 'LIVE');
    assert.equal(result.meta.mode, 'LIVE');
    assert.equal(result.meta.recordingId, undefined);
    assert.equal(typeof result.meta.latencyMs, 'number');
  }
});

test('C1: RECORD persists a sanitized recording and uses the same normalizer', async () => {
  const writeDir = mkdtempSync(join(tmpdir(), 'rec-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const adapter = makeAdapter('RECORD', async () => ({ value: 'recorded', token: 'sekret-123' }));

  const result = await runAdapter(adapter, store, REQUEST, {
    operation: 'search',
    secrets: ['sekret-123'],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data, 'RECORDED');
  assert.equal(result.meta.mode, 'RECORD');
  const recordingId = result.meta.recordingId;
  assert.ok(recordingId);

  const path = join(writeDir, 'provider-x', 'search', `${recordingId}.json`);
  assert.ok(existsSync(path));
  const fileText = readFileSync(path, 'utf8');
  assert.ok(!fileText.includes('sekret-123'), 'secret must not appear in the recording');
  assert.ok(fileText.includes(REDACTED));
  const parsed: { sanitized: boolean; raw: FakeRaw } = JSON.parse(fileText);
  assert.equal(parsed.sanitized, true);
  assert.equal(parsed.raw.token, REDACTED);
  assert.equal(parsed.raw.value, 'recorded');
});

test('C1: REPLAY loads the recorded raw payload and runs the identical normalizer', async () => {
  const writeDir = mkdtempSync(join(tmpdir(), 'rec-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const recorded = makeAdapter('RECORD', async () => ({ value: 'replay-me' }));
  const recordResult = await runAdapter(recorded, store, REQUEST, { operation: 'search' });
  assert.equal(recordResult.ok, true);

  const replay = makeAdapter('REPLAY', async () => {
    throw new Error('REPLAY must never call the provider');
  });
  const result = await runAdapter(replay, store, REQUEST, { operation: 'search' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data, 'REPLAY-ME');
    assert.equal(result.meta.mode, 'REPLAY');
    assert.equal(result.meta.recordingId, recordResult.ok ? recordResult.meta.recordingId : undefined);
  }
});

test('C1: recording ids are deterministic per provider/operation/request', () => {
  const a = recordingIdFor('provider-x', 'search', { b: 2, a: 1 });
  const b = recordingIdFor('provider-x', 'search', { a: 1, b: 2 });
  const c = recordingIdFor('provider-x', 'verify', { a: 1, b: 2 });
  assert.equal(a, b, 'key order must not matter');
  assert.notEqual(a, c, 'operation must change the id');
});

test('C1: canonicalJson sorts object keys recursively', () => {
  assert.equal(canonicalJson({ b: [ { z: 1, a: 2 } ], a: 1 }), '{"a":1,"b":[{"a":2,"z":1}]}');
});

test('C1: REPLAY with a missing recording is a structured UNAVAILABLE result', async () => {
  const adapter = makeAdapter('REPLAY', async () => ({ value: 'never' }));
  const result = await runAdapter(adapter, emptyStore(), REQUEST, { operation: 'search' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'UNAVAILABLE');
    assert.equal(result.error.code, 'recording_not_found');
    assert.equal(result.meta.mode, 'REPLAY');
  }
});

test('C1: structured CapabilityFailure from the provider boundary passes through', async () => {
  const adapter = makeAdapter('LIVE', async () => {
    throw capabilityFailure('AUTH', 'bad_credentials', 'provider rejected credentials', false);
  });
  const result = await runAdapter(adapter, emptyStore(), REQUEST, { operation: 'search' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'AUTH');
    assert.equal(result.error.code, 'bad_credentials');
    assert.equal(result.error.retryable, false);
  }
});

test('C1: NOT_CONFIGURED is the structured result when credentials are absent', async () => {
  const adapter = makeAdapter('LIVE', async () => {
    throw capabilityFailure('NOT_CONFIGURED', 'missing_credentials', 'no credentials configured');
  });
  const result = await runAdapter(adapter, emptyStore(), REQUEST, { operation: 'search' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'NOT_CONFIGURED');
});

test('C1: unexpected provider exceptions become structured data, never a crash', async () => {
  const adapter = makeAdapter('LIVE', async () => {
    throw new Error('fetch failed');
  });
  const result = await runAdapter(adapter, emptyStore(), REQUEST, { operation: 'search' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'NETWORK');
    assert.equal(result.error.retryable, true);
  }
});

test('C1: malformed raw payload failing normalization is structured, not thrown', async () => {
  const adapter: ProviderAdapter<{ key: string }, unknown, string> = {
    providerId: 'provider-x',
    mode: 'LIVE',
    obtainRaw: async () => ({ nonsense: true }),
    normalize: (raw) => {
      const value = (raw as { value?: unknown }).value;
      if (typeof value !== 'string') throw new Error('missing value');
      return value;
    },
  };
  const result = await runAdapter(adapter, emptyStore(), REQUEST, { operation: 'search' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'PROVIDER_ERROR');
    assert.equal(result.error.code, 'invalid_raw_response');
  }
});

test('C1: error classification maps timeouts and generic errors', () => {
  assert.equal(toCapabilityError(new Error('The operation timed out')).category, 'TIMEOUT');
  assert.equal(toCapabilityError(new Error('getaddrinfo ENOTFOUND host')).category, 'NETWORK');
  assert.equal(toCapabilityError(new Error('boom')).category, 'PROVIDER_ERROR');
  assert.equal(toCapabilityError('weird').category, 'PROVIDER_ERROR');
  const failure = capabilityFailure('RATE_LIMITED', 'slow_down', 'too many requests', true);
  assert.ok(failure instanceof CapabilityFailure);
  assert.equal(toCapabilityError(failure).category, 'RATE_LIMITED');
});

test('C1: sanitization redacts secrets and keeps provider shape', () => {
  const raw = { auth: { id: 'cid-1', secret: 'shh' }, list: ['shh', 'ok'] };
  const sanitized = sanitizeRaw(raw, ['cid-1', 'shh']) as typeof raw;
  assert.equal(sanitized.auth.id, REDACTED);
  assert.equal(sanitized.auth.secret, REDACTED);
  assert.deepEqual(sanitized.list, [REDACTED, 'ok']);
  assert.equal(containsAnySecret(sanitized, ['cid-1', 'shh']), false);
  assert.equal(containsAnySecret(raw, ['shh']), true);
  assert.equal(sanitizeRaw(raw, []), raw, 'no secrets means untouched payload');
});

test('C1: read-only store refuses RECORD writes with a structured error', async () => {
  const store = new FileRecordingStore({ readDirs: [] });
  const adapter = makeAdapter('RECORD', async () => ({ value: 'x' }));
  const result = await runAdapter(adapter, store, REQUEST, { operation: 'search' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'recording_write_failed');
});
