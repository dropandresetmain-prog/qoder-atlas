/**
 * RV-N7 — Duffel Stays-shaped HotelCapability evidence (Northstar Wave 2).
 *
 * Proves, on the real DuffelStaysAdapter:
 *  - REPLAY search/quote/book/retrieve/cancel/modify round trip is
 *    deterministic and uses the same normalizer as the LIVE/RECORD path;
 *  - LIVE/RECORD without credentials returns a structured NOT_CONFIGURED
 *    result — never reaches the network, never crashes;
 *  - RECORD writes sanitized recordings (credential material absent);
 *  - bookStay/modifyStay/cancelStay carry honest provenance and an honest
 *    maxSideEffectLevel on the descriptor;
 *  - getStayContext works for imported-booking references;
 *  - unknown bookingId still produces a structured CapabilityResult — a
 *    UNKNOWN status, not a crash, not a not-found exception.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileRecordingStore,
  DuffelStaysAdapter,
  DUFFEL_STAYS_PROVIDER_ID,
  containsAnySecret,
} from '../src/providers/index.ts';
import type {
  HotelBookQuery,
  HotelQuoteQuery,
  HotelRetrieveQuery,
  HotelSearchQuery,
  StayContextQuery,
  HotelActionQuery,
} from '../src/contracts/capabilities.ts';

const TEST_FIXTURES = 'test/fixtures/recordings';

const SEARCH_QUERY: HotelSearchQuery = {
  location: { externalRef: { system: 'city_code', value: 'STAY-CT-001' } },
  checkInDate: '2026-10-01',
  checkOutDate: '2026-10-04',
  guests: { adults: 1 },
  rooms: 1,
};

const RATE_ID = 'rate_synthetic_001';
const QUOTE_ID = 'quote_synthetic_001';
const STAY_ELEMENT_ID = 'stay_booking_001';
const UNKNOWN_BOOKING_ID = 'unknown-booking-id';

function replayStore(): FileRecordingStore {
  return new FileRecordingStore({ readDirs: [TEST_FIXTURES] });
}

function replayAdapter(): DuffelStaysAdapter {
  return new DuffelStaysAdapter({ mode: 'REPLAY', store: replayStore() });
}

test('RV-N7 hotel: descriptor is honest about side-effect level and supported operations', () => {
  const adapter = replayAdapter();
  assert.equal(adapter.descriptor.family, 'HOTEL');
  assert.equal(adapter.descriptor.providerId, DUFFEL_STAYS_PROVIDER_ID);
  assert.equal(adapter.descriptor.mode, 'REPLAY');
  assert.equal(adapter.descriptor.maxSideEffectLevel, 'MONEY_MOVING');
  for (const op of ['hotel.context', 'hotel.search', 'hotel.quote', 'hotel.book', 'hotel.modify', 'hotel.cancel', 'hotel.retrieve'] as const) {
    assert.ok(adapter.descriptor.supportedOperations.includes(op), `missing op: ${op}`);
  }
});

test('RV-N7 hotel: REPLAY search returns synthetic properties and rates', async () => {
  const result = await replayAdapter().searchHotels(SEARCH_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.meta.mode, 'REPLAY');
  assert.equal(result.meta.providerId, DUFFEL_STAYS_PROVIDER_ID);
  assert.ok(result.meta.recordingId?.startsWith('rec_'));
  assert.equal(result.data.properties.length, 1);
  assert.equal(result.data.properties[0]!.name, 'Property-Synthetic-001');
  assert.equal(result.data.rates.length, 1);
  assert.equal(result.data.rates[0]!.rateId, RATE_ID);
  assert.deepEqual(result.data.rates[0]!.totalPrice, { amount: 300, currency: 'USD' });
  assert.equal(result.data.rates[0]!.refundable, true);
});

test('RV-N7 hotel: REPLAY quote returns a quoteId for bookStay', async () => {
  const result = await replayAdapter().quoteRate({ rateId: RATE_ID } as HotelQuoteQuery);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.status, 'QUOTED');
  assert.deepEqual(result.data.quotedPrice, { amount: 300, currency: 'USD' });
  assert.equal(result.data.quoteId, QUOTE_ID);
});

test('RV-N7 hotel: REPLAY book returns a confirmed booking with REPLAY provenance', async () => {
  const query: HotelBookQuery = { quoteId: QUOTE_ID, guestNames: ['Synthetic Guest'] };
  const result = await replayAdapter().bookStay(query);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.confirmed, true);
  assert.equal(result.data.bookingId, STAY_ELEMENT_ID);
  assert.equal(result.data.provenance, 'REPLAY');
  assert.equal(result.data.providerConfirmationCode, 'CONF-XYZ-001');
  assert.deepEqual(result.data.totalPrice, { amount: 300, currency: 'USD' });
});

test('RV-N7 hotel: REPLAY retrieve returns a CONFIRMED status view', async () => {
  const query: HotelRetrieveQuery = { bookingId: STAY_ELEMENT_ID };
  const result = await replayAdapter().retrieveBooking(query);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.status, 'CONFIRMED');
  assert.equal(result.data.propertyName, 'Property-Synthetic-001');
  assert.equal(result.data.checkIn, '2026-10-01T15:00:00+08:00');
  assert.equal(result.data.checkOut, '2026-10-04T11:00:00+08:00');
});

test('RV-N7 hotel: REPLAY cancel returns a confirmed cancel outcome with REPLAY provenance', async () => {
  const query: HotelActionQuery = { stayElementId: STAY_ELEMENT_ID };
  const result = await replayAdapter().cancelStay(query);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.confirmed, true);
  assert.equal(result.data.reference, 'cancel-ref-001');
  assert.equal(result.data.provenance, 'REPLAY');
});

test('RV-N7 hotel: REPLAY modify returns a confirmed modify outcome with REPLAY provenance', async () => {
  const query: HotelActionQuery = { stayElementId: STAY_ELEMENT_ID };
  const result = await replayAdapter().modifyStay(query);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.confirmed, true);
  assert.equal(result.data.reference, 'modify-ref-001');
  assert.equal(result.data.provenance, 'REPLAY');
});

test('RV-N7 hotel: REPLAY getStayContext honors Checkpoint-C semantics', async () => {
  const query: StayContextQuery = { stayElementId: STAY_ELEMENT_ID };
  const result = await replayAdapter().getStayContext(query);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  const ctx = result.data;
  assert.equal(ctx.propertyName, 'Property-Synthetic-001');
  assert.equal(ctx.checkInWindow?.start, '2026-10-01T14:00:00+08:00');
  assert.equal(ctx.checkInWindow?.end, '2026-10-02T02:00:00+08:00');
  assert.equal(ctx.lateArrivalSupported, true);
  assert.equal(ctx.cancellation?.refundable, true);
});

test('RV-N7 hotel: unknown bookingId produces a structured UNKNOWN status (no crash)', async () => {
  const result = await replayAdapter().retrieveBooking({ bookingId: UNKNOWN_BOOKING_ID });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.status, 'UNKNOWN');
  assert.equal(result.data.bookingId, UNKNOWN_BOOKING_ID);
});

test('RV-N7 hotel: LIVE without credentials fails closed, never reaches the network', async () => {
  let fetchCalled = false;
  const adapter = new DuffelStaysAdapter({
    mode: 'LIVE',
    store: replayStore(),
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    },
  });
  const result = await adapter.searchHotels(SEARCH_QUERY);
  assert.equal(result.ok, false);
  assert.equal(fetchCalled, false, 'no network call may execute in LIVE without credentials');
  if (result.ok) return;
  assert.equal(result.error.category, 'NOT_CONFIGURED');
  assert.equal(result.error.code, 'duffel_stays_missing_credentials');
  assert.equal(result.meta.providerId, DUFFEL_STAYS_PROVIDER_ID);
  assert.equal(result.meta.mode, 'LIVE');
});

test('RV-N7 hotel: RECORD mode writes sanitized recordings (no credential material)', async () => {
  const injectedSecret = 'duffel-secret-do-not-persist';
  const liveRaw = {
    data: {
      properties: [
        {
          id: 'prop_recorded_001',
          name: 'Property-Recorded-001',
          external_refs: [{ system: 'city_code', value: 'STAY-CT-002' }],
        },
      ],
      rates: [
        {
          id: 'rate_recorded_001',
          property_id: 'prop_recorded_001',
          total_amount: '200.00',
          total_currency: 'USD',
          refundable: false,
        },
      ],
      msg: `probe ${injectedSecret}`,
    },
  };

  const writeDir = mkdtempSync(join(tmpdir(), 'rv-n7-hotel-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () =>
    new Response(JSON.stringify(liveRaw), { status: 200 });

  const adapter = new DuffelStaysAdapter({
    mode: 'RECORD',
    store,
    baseUrl: 'https://stays.duffel.example/v2',
    apiKey: injectedSecret,
    fetchImpl: stubFetch,
  });

  const query: HotelSearchQuery = {
    location: { externalRef: { system: 'city_code', value: 'STAY-CT-002' } },
    checkInDate: '2026-11-01',
    checkOutDate: '2026-11-03',
    guests: { adults: 1 },
    rooms: 1,
  };
  const result = await adapter.searchHotels(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const recordingPath = join(writeDir, 'duffel-stays', 'search', `${result.meta.recordingId}.json`);
  assert.ok(existsSync(recordingPath), 'recording must be persisted');
  const persisted = JSON.parse(readFileSync(recordingPath, 'utf8')) as { raw: unknown; sanitized: boolean };
  assert.equal(persisted.sanitized, true);
  assert.equal(containsAnySecret(persisted.raw, [injectedSecret]), false);
  const serialized = JSON.stringify(persisted.raw);
  assert.ok(!serialized.includes(injectedSecret), 'secret leak check');
});

test('RV-N7 hotel: REPLAY and RECORD share one normalizer (byte-identical for same raw)', async () => {
  const liveRaw = {
    data: {
      properties: [
        {
          id: 'prop_equiv_001',
          name: 'Property-Equiv-001',
          external_refs: [{ system: 'city_code', value: 'STAY-CT-003' }],
        },
      ],
      rates: [
        {
          id: 'rate_equiv_001',
          property_id: 'prop_equiv_001',
          total_amount: '150.00',
          total_currency: 'USD',
          refundable: true,
          availability: 'LIMITED',
        },
      ],
    },
  };

  const writeDir = mkdtempSync(join(tmpdir(), 'rv-n7-equiv-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () =>
    new Response(JSON.stringify(liveRaw), { status: 200 });

  const recordAdapter = new DuffelStaysAdapter({
    mode: 'RECORD',
    store,
    baseUrl: 'https://stays.duffel.example/v2',
    apiKey: 'cid',
    fetchImpl: stubFetch,
  });
  const query: HotelSearchQuery = {
    location: { externalRef: { system: 'city_code', value: 'STAY-CT-003' } },
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-04',
    guests: { adults: 2 },
    rooms: 1,
  };
  const liveSide = await recordAdapter.searchHotels(query);
  assert.equal(liveSide.ok, true);
  if (!liveSide.ok) return;

  const replaySide = await new DuffelStaysAdapter({
    mode: 'REPLAY',
    store,
  }).searchHotels(query);
  assert.equal(replaySide.ok, true);
  if (!replaySide.ok) return;

  assert.deepEqual(replaySide.data, liveSide.data);
  assert.equal(replaySide.meta.recordingId, liveSide.meta.recordingId);
});

test('RV-N7 hotel: LIVE/RECORD produce SIMULATED provenance for money-moving outcomes', async () => {
  const liveRaw = {
    data: {
      confirmed: true,
      booking_id: 'booking_live_001',
      provider_confirmation_code: 'CONF-LIVE-001',
      total_amount: '200.00',
      total_currency: 'USD',
    },
  };
  const writeDir = mkdtempSync(join(tmpdir(), 'rv-n7-live-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () =>
    new Response(JSON.stringify(liveRaw), { status: 200 });
  const adapter = new DuffelStaysAdapter({
    mode: 'RECORD',
    store,
    baseUrl: 'https://stays.duffel.example/v2',
    apiKey: 'cid',
    fetchImpl: stubFetch,
  });
  const result = await adapter.bookStay({ quoteId: 'quote_live_001', guestNames: ['Guest One'] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.provenance, 'SIMULATED');
  assert.equal(result.data.bookingId, 'booking_live_001');
});
