/**
 * C2 evidence — Atlas direct adapter (T-ADAPTER): REPLAY normalization of
 * curated provider-shaped recordings, LIVE/REPLAY identical-normalizer
 * equivalence, structured provider failure, workflow-identifier preservation
 * and missing-credential/no-secret paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileRecordingStore, containsAnySecret } from '../src/providers/index.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { atlasScheduleToIso, normalizeVerify } from '../src/providers/atlas/normalize.ts';
import type { FlightSearchQuery } from '../src/contracts/capabilities.ts';

const FIXTURES = 'fixtures/recordings';

const SEARCH_QUERY: FlightSearchQuery = {
  origin: { system: 'IATA', value: 'MNL' },
  destination: { system: 'IATA', value: 'CEB' },
  departureDate: '2026-09-05',
  passengers: { adults: 1 },
};

function fixtureStore(): FileRecordingStore {
  return new FileRecordingStore({ readDirs: [FIXTURES] });
}

function replayAdapter(store = fixtureStore()): AtlasFlightAdapter {
  return new AtlasFlightAdapter({ mode: 'REPLAY', store });
}

function loadOnlyRecording(operation: string): { id: string; raw: Record<string, unknown> } {
  const dir = join(FIXTURES, 'atlas', operation);
  const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  assert.equal(files.length, 1, `expected exactly one curated ${operation} recording`);
  const recording = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as {
    id: string;
    raw: Record<string, unknown>;
  };
  return recording;
}

const VERIFY_OFFER_ID = (
  (loadOnlyRecording('search').raw.routings as Array<{ routingIdentifier: string }>)[0]!
    .routingIdentifier
);

test('C2: REPLAY search normalizes curated recording through the real normalizer', async () => {
  const result = await replayAdapter().searchFlights(SEARCH_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.meta.mode, 'REPLAY');
  assert.ok(result.meta.recordingId);

  const rawRoutings = loadOnlyRecording('search').raw.routings as Array<{
    routingIdentifier: string;
    currency: string;
    adultPrice: number;
    adultTax: number;
    expireTime?: string | null;
    riskSellout?: boolean;
    fromSegments: Array<{ depAirport: string; arrAirport: string; depTime: string; arrTime: string; fareFamily?: string; seatCount?: number }>;
    retSegments?: unknown[];
  }>;
  assert.ok(rawRoutings.length > 0, 'curated fixture must contain routings');
  assert.equal(result.data.offers.length, rawRoutings.length);

  const rawFirst = rawRoutings[0]!;
  const first = result.data.offers[0]!;
  // Opaque provider workflow identifier preserved exactly.
  assert.equal(first.offerId, rawFirst.routingIdentifier);
  const expectedTotal = Math.round((rawFirst.adultPrice + rawFirst.adultTax) * 100) / 100;
  assert.deepEqual(first.totalPrice, { currency: rawFirst.currency, amount: expectedTotal });
  assert.equal(first.segments.length, rawFirst.fromSegments.length + (rawFirst.retSegments?.length ?? 0));
  if (typeof rawFirst.expireTime === 'string') assert.equal(first.expiresAt, rawFirst.expireTime);

  const rawSegment = rawFirst.fromSegments[0]!;
  const segment = first.segments[0]!;
  assert.deepEqual(segment.origin, { system: 'IATA', value: rawSegment.depAirport });
  assert.deepEqual(segment.destination, { system: 'IATA', value: rawSegment.arrAirport });
  assert.equal(segment.departure, atlasScheduleToIso(rawSegment.depTime));
  assert.equal(segment.arrival, atlasScheduleToIso(rawSegment.arrTime));
  if (rawSegment.fareFamily) assert.equal(first.fareFamily, rawSegment.fareFamily);

  const seatCounts = rawFirst.fromSegments.map((s) => s.seatCount).filter((c): c is number => typeof c === 'number');
  const expectedAvailability = rawFirst.riskSellout
    ? 'LIMITED'
    : seatCounts.length > 0 && Math.min(...seatCounts) > 0
      ? 'AVAILABLE'
      : 'UNKNOWN';
  assert.equal(first.availability, expectedAvailability);
});

test('C2: REPLAY verify preserves sessionId verbatim and lists booking requirements', async () => {
  const result = await replayAdapter().verifyOffer({ offerId: VERIFY_OFFER_ID });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;

  const raw = loadOnlyRecording('verify').raw as {
    sessionId?: string;
    priceChange?: { isPriceChange?: boolean };
    bookingRequirement?: Record<string, Record<string, { required?: boolean }>>;
  };
  assert.equal(result.data.status, raw.priceChange?.isPriceChange === true ? 'PRICE_CHANGED' : 'VERIFIED');
  if (raw.sessionId !== undefined) {
    // Opaque provider workflow state preserved verbatim.
    assert.deepEqual(result.data.workflowState, { sessionId: raw.sessionId });
  }
  const expectedRequirements: string[] = [];
  for (const group of Object.keys(raw.bookingRequirement ?? {}).sort()) {
    for (const field of Object.keys(raw.bookingRequirement?.[group] ?? {}).sort()) {
      if (raw.bookingRequirement?.[group]?.[field]?.required === true) {
        expectedRequirements.push(`${group}.${field}`);
      }
    }
  }
  assert.deepEqual(result.data.bookingRequirements ?? [], expectedRequirements);
  assert.ok(expectedRequirements.length > 0, 'sandbox verify exposes booking requirements');
});

test('C2: REPLAY fare rules normalize change/refund/no-show/baggage deterministically', async () => {
  const result = await replayAdapter().getFareRules({ offerId: VERIFY_OFFER_ID });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  const rules = result.data;

  const rawRule = (loadOnlyRecording('fare_rules').raw.routing as {
    rule?: {
      changesRules?: Array<{ changesStatus?: string }>;
      refundRules?: Array<{ refundStatus?: string }>;
      baggageElements?: Array<{ passengerType?: number; baggagePiece?: number; baggageWeight?: number }>;
    };
  }).rule;
  assert.ok(rawRule, 'curated fixture routing must carry a rule block');

  if ((rawRule.changesRules?.length ?? 0) > 0) {
    assert.equal(rules.change?.allowed, rawRule.changesRules!.every((entry) => entry.changesStatus === 'T'));
  }
  if ((rawRule.refundRules?.length ?? 0) > 0) {
    assert.equal(rules.refund?.refundable, rawRule.refundRules!.every((entry) => entry.refundStatus === 'T'));
  }
  if (rules.change?.fee) assert.equal(rules.change.fee.currency.length, 3);
  if (rules.noShow) assert.ok(rules.noShow.consequence.length > 0);

  const adultBaggage = (rawRule.baggageElements ?? []).filter(
    (element) => element.passengerType === 0 && ((element.baggagePiece ?? 0) > 0 || (element.baggageWeight ?? 0) > 0),
  );
  assert.equal(rules.baggageIncluded?.length ?? 0, adultBaggage.length);
});

test('C2: PRICE_CHANGED verify computes updated price and delta from passenger counts', () => {
  const outcome = normalizeVerify(
    {
      status: 0,
      priceChange: {
        isPriceChange: true,
        newAdultPrice: 200,
        newAdultTax: 20,
        originalAdultPrice: 180,
        originalAdultTax: 20,
      },
      routing: {
        routingIdentifier: 'opaque-id',
        currency: 'USD',
        fromSegments: [
          {
            depAirport: 'AAA',
            arrAirport: 'BBB',
            depTime: '202608202000',
            arrTime: '202608202130',
          },
        ],
        retSegments: [],
      },
    },
    { adults: 2 },
  );
  assert.equal(outcome.status, 'PRICE_CHANGED');
  assert.deepEqual(outcome.updatedPrice, { currency: 'USD', amount: 440 });
  assert.deepEqual(outcome.priceDelta, { currency: 'USD', amount: 40 });
});

test('C2: LIVE/REPLAY equivalence — identical raw payload yields identical normalized output', async () => {
  const fixtureRaw = loadOnlyRecording('search').raw;
  const writeDir = mkdtempSync(join(tmpdir(), 'atlas-rec-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });

  const stubFetch: typeof fetch = async (_url, _init) =>
    new Response(JSON.stringify(fixtureRaw), { status: 200 });

  const recordAdapter = new AtlasFlightAdapter({
    mode: 'RECORD',
    store,
    baseUrl: 'https://sandbox.example',
    clientId: 'cid',
    clientSecret: 'csecret',
    fetchImpl: stubFetch,
  });
  const liveSide = await recordAdapter.searchFlights(SEARCH_QUERY);
  assert.equal(liveSide.ok, true);

  const replaySide = await new AtlasFlightAdapter({ mode: 'REPLAY', store }).searchFlights(SEARCH_QUERY);
  assert.equal(replaySide.ok, true);

  if (liveSide.ok && replaySide.ok) {
    assert.deepEqual(replaySide.data, liveSide.data, 'same normalizer must produce identical output');
    assert.equal(replaySide.meta.recordingId, liveSide.meta.recordingId);
  }
});

test('C2: RECORD sanitizes credentials out of persisted recordings', async () => {
  const fixtureRaw = loadOnlyRecording('search').raw;
  const injectedSecret = 'super-secret-client-secret';
  const rawWithSecret = { ...fixtureRaw, msg: `token ${injectedSecret}` };
  const writeDir = mkdtempSync(join(tmpdir(), 'atlas-rec-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async (_url, _init) =>
    new Response(JSON.stringify(rawWithSecret), { status: 200 });

  const adapter = new AtlasFlightAdapter({
    mode: 'RECORD',
    store,
    baseUrl: 'https://sandbox.example',
    clientId: 'cid',
    clientSecret: injectedSecret,
    fetchImpl: stubFetch,
  });
  const result = await adapter.searchFlights(SEARCH_QUERY);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const recordingPath = join(writeDir, 'atlas', 'search', `${result.meta.recordingId}.json`);
  assert.ok(existsSync(recordingPath));
  const persisted = JSON.parse(readFileSync(recordingPath, 'utf8')) as { raw: unknown; sanitized: boolean };
  assert.equal(persisted.sanitized, true);
  assert.equal(containsAnySecret(persisted.raw, [injectedSecret]), false);
});

test('C2: LIVE/RECORD without credentials is a structured NOT_CONFIGURED result', async () => {
  const adapter = new AtlasFlightAdapter({ mode: 'LIVE', store: fixtureStore() });
  const result = await adapter.searchFlights(SEARCH_QUERY);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'NOT_CONFIGURED');
    assert.equal(result.error.code, 'atlas_missing_credentials');
  }
});

test('C2: non-zero provider status becomes structured PROVIDER_ERROR data', async () => {
  const writeDir = mkdtempSync(join(tmpdir(), 'atlas-rec-'));
  const stubFetch: typeof fetch = async (_url, _init) =>
    new Response(JSON.stringify({ status: 5, msg: 'provider rejected the request' }), { status: 200 });
  const adapter = new AtlasFlightAdapter({
    mode: 'LIVE',
    store: new FileRecordingStore({ readDirs: [writeDir], writeDir }),
    baseUrl: 'https://sandbox.example',
    clientId: 'cid',
    clientSecret: 'csecret',
    fetchImpl: stubFetch,
  });
  const result = await adapter.searchFlights(SEARCH_QUERY);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'PROVIDER_ERROR');
    assert.equal(result.error.code, 'atlas_provider_status_5');
    assert.match(result.error.message, /provider rejected the request/);
  }
});

test('C2: HTTP 401 maps to AUTH and network failure maps to NETWORK', async () => {
  const base = {
    store: fixtureStore(),
    baseUrl: 'https://sandbox.example',
    clientId: 'cid',
    clientSecret: 'csecret',
  };
  const unauthorized = new AtlasFlightAdapter({
    ...base,
    mode: 'LIVE',
    fetchImpl: async () => new Response(JSON.stringify({ msg: 'invalid client' }), { status: 401 }),
  });
  const authResult = await unauthorized.verifyOffer({ offerId: 'opaque-id' });
  assert.equal(authResult.ok, false);
  if (!authResult.ok) assert.equal(authResult.error.category, 'AUTH');

  const offline = new AtlasFlightAdapter({
    ...base,
    mode: 'LIVE',
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const networkResult = await offline.verifyOffer({ offerId: 'opaque-id' });
  assert.equal(networkResult.ok, false);
  if (!networkResult.ok) {
    assert.equal(networkResult.error.category, 'NETWORK');
    assert.equal(networkResult.error.retryable, true);
  }
});

test('C2: verify passes the opaque routing identifier through unchanged', async () => {
  const fixtureRaw = loadOnlyRecording('verify').raw;
  let sentBody: Record<string, unknown> | undefined;
  const stubFetch: typeof fetch = async (_url, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(fixtureRaw), { status: 200 });
  };
  const adapter = new AtlasFlightAdapter({
    mode: 'LIVE',
    store: fixtureStore(),
    baseUrl: 'https://sandbox.example',
    clientId: 'cid',
    clientSecret: 'csecret',
    fetchImpl: stubFetch,
  });
  const result = await adapter.verifyOffer({ offerId: VERIFY_OFFER_ID });
  assert.equal(result.ok, true);
  assert.equal(sentBody?.routingIdentifier, VERIFY_OFFER_ID);
});

test('C2: invalid search query is rejected without any provider call', async () => {
  let called = false;
  const adapter = new AtlasFlightAdapter({
    mode: 'LIVE',
    store: fixtureStore(),
    baseUrl: 'https://sandbox.example',
    clientId: 'cid',
    clientSecret: 'csecret',
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });
  const result = await adapter.searchFlights({ ...SEARCH_QUERY, origin: { system: 'IATA', value: 'TOOLONG' } });
  assert.equal(result.ok, false);
  assert.equal(called, false);
  if (!result.ok) assert.equal(result.error.category, 'INVALID_REQUEST');
});
