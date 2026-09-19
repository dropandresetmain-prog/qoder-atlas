import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficialDocumentReader } from '../src/providers/research/officialDocuments.ts';
import type { Recording } from '../src/contracts/envelope.ts';
import type { RecordingStore } from '../src/providers/recordingStore.ts';

const catalog = [{ id: 'entry-policy', publisher: 'Public authority', url: 'https://authority.example/entry' }];
function memoryStore(): RecordingStore {
  const recordings = new Map<string, Recording>();
  return { async load(_provider, _operation, id) { return recordings.get(id); }, async save(recording) { recordings.set(recording.id, recording); } };
}

test('record and replay preserve fetched document provenance and identical sanitized evidence', async () => {
  const store = memoryStore();
  let calls = 0;
  const fetchImpl = (async (url, options) => {
    calls++;
    assert.equal(url, catalog[0]!.url);
    assert.equal(options?.redirect, 'manual');
    return new Response('<style>hidden</style><h1>Entry &amp; transit</h1><p>One day &#x2014; temporary visit.</p><script>bad()</script><p>contact@authority.example</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  const recorded = await new OfficialDocumentReader({ catalog, mode: 'RECORD', store, fetchImpl }).read('entry-policy');
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;
  assert.match(recorded.data.text, /Entry & transit One day — temporary visit/);
  assert.doesNotMatch(recorded.data.text, /bad\(\)|hidden|contact@/);
  assert.match(recorded.data.contentSha256, /^[a-f0-9]{64}$/);
  const replayed = await new OfficialDocumentReader({ catalog, mode: 'REPLAY', store, fetchImpl }).read('entry-policy');
  assert.equal(replayed.ok, true);
  if (!replayed.ok) return;
  assert.deepEqual(replayed.data, recorded.data);
  assert.equal(replayed.meta.mode, 'REPLAY');
  assert.equal(recorded.meta.mode, 'RECORD');
  assert.equal(calls, 1);
  assert.equal('verdict' in recorded.data, false);
});

test('unconfigured source and invalid catalog cannot reach the network', async () => {
  const store = memoryStore();
  const fetchImpl = (async () => { throw new Error('network must not run'); }) as typeof fetch;
  const missing = await new OfficialDocumentReader({ catalog, mode: 'LIVE', store, fetchImpl }).read('https://unconfigured.example');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'document_source_not_configured');
  assert.throws(() => new OfficialDocumentReader({ catalog: [...catalog, ...catalog], mode: 'LIVE', store }));
  assert.throws(() => new OfficialDocumentReader({ catalog: [{ ...catalog[0]!, url: 'http://authority.example' }], mode: 'LIVE', store }));
});

test('redirects, unsupported content and oversized documents fail without a false evidence result', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: 'https://other.example/entry' } }),
    new Response('binary', { headers: { 'Content-Type': 'application/pdf' } }),
    new Response('x'.repeat(1_048_577), { headers: { 'Content-Type': 'text/plain' } }),
    new Response('<script>nothing readable</script>', { headers: { 'Content-Type': 'text/html' } }),
  ]) {
    let calls = 0;
    const result = await new OfficialDocumentReader({ catalog, mode: 'LIVE', store: memoryStore(), fetchImpl: (async () => { calls++; return response; }) as typeof fetch }).read('entry-policy');
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  }
});

test('missing replay evidence stays unavailable without using a live fallback', async () => {
  const result = await new OfficialDocumentReader({ catalog, mode: 'REPLAY', store: memoryStore(), fetchImpl: (async () => { assert.fail('replay must not fetch'); }) as typeof fetch }).read('entry-policy');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'recording_not_found');
});
