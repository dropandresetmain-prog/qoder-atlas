/**
 * C3 evidence — Google Routes optional adapter (T-ADAPTER routing): replay
 * normalization, LIVE/REPLAY equivalence, missing-key and network fallback
 * as structured data, no application crash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileRecordingStore } from '../src/providers/index.ts';
import { GoogleRoutesAdapter, normalizeRouteContext } from '../src/providers/googleRoutes/adapter.ts';
import type { RoutingQuery } from '../src/contracts/capabilities.ts';

const FIXTURES = 'fixtures/recordings';

const ROUTING_QUERY: RoutingQuery = {
  origin: { coordinates: { latitude: 14.5995, longitude: 120.9842 } },
  destination: { coordinates: { latitude: 14.5547, longitude: 121.0244 } },
  mode: 'DRIVE',
  departAt: '2026-09-05T08:00:00Z',
};

function fixtureStore(): FileRecordingStore {
  return new FileRecordingStore({ readDirs: [FIXTURES] });
}

test('C3: REPLAY normalizes the curated route recording with provenance', async () => {
  const adapter = new GoogleRoutesAdapter({ mode: 'REPLAY', store: fixtureStore() });
  const result = await adapter.getRouteContext(ROUTING_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.meta.mode, 'REPLAY');
  assert.ok(result.meta.recordingId);

  const context = result.data;
  assert.equal(context.duration.expectedMinutes, 23);
  assert.equal(context.duration.minimumMinutes, 15);
  assert.equal(context.duration.conservativeMinutes, 23);
  assert.ok(context.duration.sourceId.startsWith('src:google-routes:rec_'));
  assert.equal(context.distanceKm, 15.4);
  assert.equal(context.trafficCondition, 'HEAVY');
});

test('C3: LIVE/REPLAY equivalence — identical raw yields identical normalized route context', async () => {
  const raw = { routes: [{ duration: '600s', durationInTraffic: '720s', distanceMeters: 8000 }] };
  const writeDir = mkdtempSync(join(tmpdir(), 'google-rec-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () => new Response(JSON.stringify(raw), { status: 200 });

  const recordAdapter = new GoogleRoutesAdapter({
    mode: 'RECORD',
    store,
    apiKey: 'test-key',
    fetchImpl: stubFetch,
  });
  const liveSide = await recordAdapter.getRouteContext(ROUTING_QUERY);
  assert.equal(liveSide.ok, true);

  const replaySide = await new GoogleRoutesAdapter({ mode: 'REPLAY', store }).getRouteContext(ROUTING_QUERY);
  assert.equal(replaySide.ok, true);

  if (liveSide.ok && replaySide.ok) {
    // observedAt differs by construction (observation instant); the route
    // facts themselves must be identical.
    assert.deepEqual(
      { ...replaySide.data, duration: { ...replaySide.data.duration, observedAt: '' } },
      { ...liveSide.data, duration: { ...liveSide.data.duration, observedAt: '' } },
    );
    assert.equal(replaySide.meta.recordingId, liveSide.meta.recordingId);
  }
});

test('C3: missing API key is a structured NOT_CONFIGURED result, not a crash', async () => {
  const adapter = new GoogleRoutesAdapter({ mode: 'LIVE', store: fixtureStore() });
  const result = await adapter.getRouteContext(ROUTING_QUERY);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'NOT_CONFIGURED');
    assert.equal(result.error.code, 'google_routes_missing_key');
  }
});

test('C3: network failure and HTTP failures are structured results', async () => {
  const base = { mode: 'LIVE' as const, store: fixtureStore(), apiKey: 'test-key' };

  const offline = new GoogleRoutesAdapter({
    ...base,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const networkResult = await offline.getRouteContext(ROUTING_QUERY);
  assert.equal(networkResult.ok, false);
  if (!networkResult.ok) {
    assert.equal(networkResult.error.category, 'NETWORK');
    assert.equal(networkResult.error.retryable, true);
  }

  const forbidden = new GoogleRoutesAdapter({
    ...base,
    fetchImpl: async () => new Response('{"error":"permission denied"}', { status: 403 }),
  });
  const authResult = await forbidden.getRouteContext(ROUTING_QUERY);
  assert.equal(authResult.ok, false);
  if (!authResult.ok) assert.equal(authResult.error.category, 'AUTH');

  const empty = new GoogleRoutesAdapter({
    ...base,
    fetchImpl: async () => new Response(JSON.stringify({ routes: [] }), { status: 200 }),
  });
  const emptyResult = await empty.getRouteContext(ROUTING_QUERY);
  assert.equal(emptyResult.ok, false);
  if (!emptyResult.ok) assert.equal(emptyResult.error.code, 'invalid_raw_response');
});

test('C3: invalid query is rejected without a provider call', async () => {
  let called = false;
  const adapter = new GoogleRoutesAdapter({
    mode: 'LIVE',
    store: fixtureStore(),
    apiKey: 'test-key',
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });
  const noLocation = await adapter.getRouteContext({ origin: {}, destination: ROUTING_QUERY.destination });
  assert.equal(noLocation.ok, false);
  const wrongSystem = await adapter.getRouteContext({
    origin: { externalRef: { system: 'IATA', value: 'MNL' } },
    destination: ROUTING_QUERY.destination,
  });
  assert.equal(wrongSystem.ok, false);
  assert.equal(called, false);
});

test('C3: traffic classification thresholds are deterministic', () => {
  const observedAt = '2026-09-05T08:00:00Z';
  const sourceId = 'src:google-routes:rec_test';
  const heavy = normalizeRouteContext({ routes: [{ duration: '100s', durationInTraffic: '200s' }] }, observedAt, sourceId);
  assert.equal(heavy.trafficCondition, 'HEAVY');
  const moderate = normalizeRouteContext({ routes: [{ duration: '100s', durationInTraffic: '120s' }] }, observedAt, sourceId);
  assert.equal(moderate.trafficCondition, 'MODERATE');
  const light = normalizeRouteContext({ routes: [{ duration: '100s', durationInTraffic: '100s' }] }, observedAt, sourceId);
  assert.equal(light.trafficCondition, 'LIGHT');
  const noTraffic = normalizeRouteContext({ routes: [{ duration: '100s' }] }, observedAt, sourceId);
  assert.equal(noTraffic.trafficCondition, undefined);
  assert.equal(noTraffic.duration.conservativeMinutes, Math.ceil(Math.round(100 / 60) * 1.25));
});
