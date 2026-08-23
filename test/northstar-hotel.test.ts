/**
 * RV-N7 — Nuitée (liteAPI) HotelCapability evidence (WP-R4-REDO).
 *
 * Duffel Stays was the documented first choice but is unavailable in
 * Singapore, so the IMPLEMENTATION_PLAN Section 13 fallback clause fired;
 * this suite proves the Nuitée adapter behind the frozen HotelCapability.
 *
 * The REPLAY corpus under fixtures/recordings/nuitee is a GENUINE capture:
 * scripts/build-northstar-hotel-fixtures.ts ran the adapter in RECORD mode
 * against the liteAPI sandbox (search -> quote -> book -> retrieve ->
 * stay context -> cancel) and persisted the sanitized exchanges. The
 * frozen query literals live in test/fixtures/nuitee-hotel-queries.ts.
 *
 * Proves, on the real NuiteeAdapter:
 *  - REPLAY search/quote/book/retrieve/cancel round trip is deterministic
 *    and uses the same normalizer as the LIVE/RECORD path;
 *  - modifyStay returns a structured UNAVAILABLE failure (liteAPI has no
 *    in-place modification) — the frozen interface never widens;
 *  - LIVE/RECORD without credentials returns NOT_CONFIGURED — never
 *    reaches the network, never crashes;
 *  - RECORD writes sanitized recordings (credential material absent);
 *  - money-moving outcomes carry honest provenance and the descriptor is
 *    honest about MONEY_MOVING and its supported operations;
 *  - getStayContext works for imported-booking references;
 *  - an unknown bookingId still yields a structured CapabilityResult —
 *    never a crash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileRecordingStore,
  NuiteeAdapter,
  NUITEE_PROVIDER_ID,
  containsAnySecret,
} from '../src/providers/index.ts';
import type { HotelBookQuery, HotelSearchQuery } from '../src/contracts/capabilities.ts';
import {
  NUITEE_CAPTURE_BOOK_QUERY,
  NUITEE_CAPTURE_CANCEL_QUERY,
  NUITEE_CAPTURE_QUOTE_QUERY,
  NUITEE_CAPTURE_RETRIEVE_QUERY,
  NUITEE_CAPTURE_SEARCH_QUERY,
  NUITEE_CAPTURE_STAY_CONTEXT_QUERY,
} from './fixtures/nuitee-hotel-queries.ts';

const TEST_FIXTURES = 'fixtures/recordings';

// Genuine sandbox identifiers from the committed capture (Concorde Hotel
// Singapore, booking 940nnns93); see the fixture recordings.
const CAPTURED_HOTEL_ID = 'lp21d9f';
const CAPTURED_HOTEL_NAME = 'Concorde Hotel Singapore';
const CAPTURED_PREBOOK_ID = 'aVFthZabE';
const CAPTURED_BOOKING_ID = '940nnns93';

function replayStore(): FileRecordingStore {
  return new FileRecordingStore({ readDirs: [TEST_FIXTURES] });
}

function replayAdapter(): NuiteeAdapter {
  return new NuiteeAdapter({ mode: 'REPLAY', store: replayStore() });
}

test('RV-N7 hotel: descriptor is honest about side-effect level and supported operations', () => {
  const adapter = replayAdapter();
  assert.equal(adapter.descriptor.family, 'HOTEL');
  assert.equal(adapter.descriptor.providerId, NUITEE_PROVIDER_ID);
  assert.equal(adapter.descriptor.mode, 'REPLAY');
  assert.equal(adapter.descriptor.maxSideEffectLevel, 'MONEY_MOVING');
  for (const op of ['hotel.context', 'hotel.search', 'hotel.quote', 'hotel.book', 'hotel.cancel', 'hotel.retrieve'] as const) {
    assert.ok(adapter.descriptor.supportedOperations.includes(op), `missing op: ${op}`);
  }
  // liteAPI has no in-place stay modification; the adapter says so.
  assert.ok(!adapter.descriptor.supportedOperations.includes('hotel.modify'), 'modify must not be advertised');
});

test('RV-N7 hotel: REPLAY search replays the genuine sandbox corpus', async () => {
  const result = await replayAdapter().searchHotels(NUITEE_CAPTURE_SEARCH_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.meta.mode, 'REPLAY');
  assert.equal(result.meta.providerId, NUITEE_PROVIDER_ID);
  assert.ok(result.meta.recordingId?.startsWith('rec_'));
  assert.ok(result.data.properties.length > 0, 'genuine search returned properties');
  const captured = result.data.properties.find((property) => property.propertyId === CAPTURED_HOTEL_ID);
  assert.ok(captured, 'captured hotel present in the replayed corpus');
  assert.equal(captured!.name, CAPTURED_HOTEL_NAME);
  assert.ok(
    captured!.externalRefs?.some((ref) => ref.system === 'nuitee-hotel-id' && ref.value === CAPTURED_HOTEL_ID),
    'provider-native hotel id preserved as an external ref',
  );
  const capturedRate = result.data.rates.find((rate) => rate.rateId === NUITEE_CAPTURE_QUOTE_QUERY.rateId);
  assert.ok(capturedRate, 'the quoted/booked offer is present in the search results');
  assert.equal(capturedRate!.propertyId, CAPTURED_HOTEL_ID);
  assert.equal(capturedRate!.totalPrice.currency, 'USD');
  assert.ok(capturedRate!.totalPrice.amount > 0);
});

test('RV-N7 hotel: REPLAY quote returns the genuine prebook handle', async () => {
  const result = await replayAdapter().quoteRate(NUITEE_CAPTURE_QUOTE_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.status, 'QUOTED');
  assert.equal(result.data.quoteId, CAPTURED_PREBOOK_ID);
  assert.deepEqual(result.data.quotedPrice, { amount: 569.4, currency: 'USD' });
});

test('RV-N7 hotel: REPLAY book returns the confirmed sandbox booking with REPLAY provenance', async () => {
  const result = await replayAdapter().bookStay(NUITEE_CAPTURE_BOOK_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.confirmed, true);
  assert.equal(result.data.bookingId, CAPTURED_BOOKING_ID);
  assert.equal(result.data.providerConfirmationCode, 'test');
  assert.equal(result.data.provenance, 'REPLAY');
  assert.deepEqual(result.data.totalPrice, { amount: 569.4, currency: 'USD' });
});

test('RV-N7 hotel: REPLAY retrieve returns the CONFIRMED status view', async () => {
  const result = await replayAdapter().retrieveBooking(NUITEE_CAPTURE_RETRIEVE_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.status, 'CONFIRMED');
  assert.equal(result.data.bookingId, CAPTURED_BOOKING_ID);
  assert.equal(result.data.propertyName, CAPTURED_HOTEL_NAME);
  // The provider returned date-only stay dates; the contract wants
  // IsoDateTime, so the honest surface omits them rather than inventing times.
  assert.equal(result.data.checkIn, undefined);
  assert.equal(result.data.checkOut, undefined);
  assert.deepEqual(result.data.cancellationFee, { amount: 569.4, currency: 'USD' });
});

test('RV-N7 hotel: REPLAY cancel returns a confirmed cancel outcome with REPLAY provenance', async () => {
  const result = await replayAdapter().cancelStay(NUITEE_CAPTURE_CANCEL_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  assert.equal(result.data.confirmed, true);
  assert.equal(result.data.reference, CAPTURED_BOOKING_ID);
  assert.deepEqual(result.data.fee, { amount: 0, currency: 'USD' });
  assert.equal(result.data.provenance, 'REPLAY');
});

test('RV-N7 hotel: REPLAY getStayContext honors Checkpoint-C semantics', async () => {
  const result = await replayAdapter().getStayContext(NUITEE_CAPTURE_STAY_CONTEXT_QUERY);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  const ctx = result.data;
  assert.equal(ctx.propertyName, CAPTURED_HOTEL_NAME);
  assert.equal(ctx.cancellation?.refundable, true);
  assert.deepEqual(ctx.cancellation?.fee, { amount: 569.4, currency: 'USD' });
  // The captured rate has a penalty-only policy: no zero-fee window exists,
  // so no deadline is fabricated.
  assert.equal(ctx.cancellation?.deadline, undefined);
});

test('RV-N7 hotel: modifyStay is a structured UNAVAILABLE failure (liteAPI cannot modify in place)', async () => {
  const result = await replayAdapter().modifyStay({ stayElementId: CAPTURED_BOOKING_ID });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.category, 'UNAVAILABLE');
  assert.equal(result.error.code, 'nuitee_modify_not_supported');
  assert.equal(result.meta.providerId, NUITEE_PROVIDER_ID);
});

test('RV-N7 hotel: unknown bookingId produces a structured result (no crash)', async () => {
  const result = await replayAdapter().retrieveBooking({ bookingId: 'no-such-booking' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.category, 'UNAVAILABLE');
  assert.equal(result.error.code, 'recording_not_found');
});

test('RV-N7 hotel: LIVE without credentials fails closed, never reaches the network', async () => {
  let fetchCalled = false;
  const adapter = new NuiteeAdapter({
    mode: 'LIVE',
    store: replayStore(),
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    },
  });
  const result = await adapter.searchHotels(NUITEE_CAPTURE_SEARCH_QUERY);
  assert.equal(result.ok, false);
  assert.equal(fetchCalled, false, 'no network call may execute in LIVE without credentials');
  if (result.ok) return;
  assert.equal(result.error.category, 'NOT_CONFIGURED');
  assert.equal(result.error.code, 'nuitee_missing_credentials');
  assert.equal(result.meta.providerId, NUITEE_PROVIDER_ID);
  assert.equal(result.meta.mode, 'LIVE');
});

test('RV-N7 hotel: RECORD mode writes sanitized recordings (no credential material)', async () => {
  const injectedSecret = 'nuitee-secret-do-not-persist';
  const liveRaw = {
    data: [
      {
        hotelId: 'hotel_recorded_001',
        roomTypes: [
          {
            offerId: 'offer_recorded_001',
            rates: [
              {
                name: 'Recorded Room',
                retailRate: { total: [{ amount: 200, currency: 'USD' }] },
                cancellationPolicies: { refundableTag: 'NRFN', cancelPolicyInfos: [] },
              },
            ],
          },
        ],
      },
    ],
    hotels: [{ id: 'hotel_recorded_001', name: 'Hotel-Recorded-001' }],
    msg: `probe ${injectedSecret}`,
    sandbox: true,
  };

  const writeDir = mkdtempSync(join(tmpdir(), 'rv-n7-nuitee-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () => new Response(JSON.stringify(liveRaw), { status: 200 });

  const adapter = new NuiteeAdapter({
    mode: 'RECORD',
    store,
    searchBaseUrl: 'https://api.liteapi.example/v3.0',
    bookingBaseUrl: 'https://book.liteapi.example/v3.0',
    apiKey: injectedSecret,
    fetchImpl: stubFetch,
  });

  const query: HotelSearchQuery = {
    location: { coordinates: { latitude: 1.28, longitude: 103.85, radiusKm: 2 } },
    checkInDate: '2026-11-01',
    checkOutDate: '2026-11-03',
    guests: { adults: 1 },
    rooms: 1,
  };
  const result = await adapter.searchHotels(query);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? undefined : result.error));
  if (!result.ok) return;
  const recordingPath = join(writeDir, 'nuitee', 'search', `${result.meta.recordingId}.json`);
  assert.ok(existsSync(recordingPath), 'recording must be persisted');
  const persisted = JSON.parse(readFileSync(recordingPath, 'utf8')) as { raw: unknown; sanitized: boolean };
  assert.equal(persisted.sanitized, true);
  assert.equal(containsAnySecret(persisted.raw, [injectedSecret]), false);
  const serialized = JSON.stringify(persisted.raw);
  assert.ok(!serialized.includes(injectedSecret), 'secret leak check');
});

test('RV-N7 hotel: REPLAY and RECORD share one normalizer (byte-identical for same raw)', async () => {
  const liveRaw = {
    data: [
      {
        hotelId: 'hotel_equiv_001',
        roomTypes: [
          {
            offerId: 'offer_equiv_001',
            rates: [
              {
                name: 'Equiv Room',
                boardName: 'Breakfast',
                retailRate: { total: [{ amount: 150, currency: 'USD' }] },
                cancellationPolicies: {
                  refundableTag: 'RFN',
                  cancelPolicyInfos: [
                    { cancelTime: '2026-11-30 12:00:00', amount: 0, currency: 'USD', timezone: 'GMT' },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
    hotels: [{ id: 'hotel_equiv_001', name: 'Hotel-Equiv-001' }],
    sandbox: true,
  };

  const writeDir = mkdtempSync(join(tmpdir(), 'rv-n7-equiv-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () => new Response(JSON.stringify(liveRaw), { status: 200 });

  const recordAdapter = new NuiteeAdapter({
    mode: 'RECORD',
    store,
    searchBaseUrl: 'https://api.liteapi.example/v3.0',
    apiKey: 'cid',
    fetchImpl: stubFetch,
  });
  const query: HotelSearchQuery = {
    location: { coordinates: { latitude: 1.3, longitude: 103.86 } },
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-04',
    guests: { adults: 2 },
    rooms: 1,
  };
  const liveSide = await recordAdapter.searchHotels(query);
  assert.equal(liveSide.ok, true);
  if (!liveSide.ok) return;

  const replaySide = await new NuiteeAdapter({ mode: 'REPLAY', store }).searchHotels(query);
  assert.equal(replaySide.ok, true);
  if (!replaySide.ok) return;

  assert.deepEqual(replaySide.data, liveSide.data);
  assert.equal(replaySide.meta.recordingId, liveSide.meta.recordingId);
  // The GMT cancel deadline is mapped to a real IsoDateTime.
  assert.equal(replaySide.data.rates[0]!.cancellationDeadline, '2026-11-30T12:00:00Z');
  assert.equal(replaySide.data.rates[0]!.refundable, true);
});

test('RV-N7 hotel: RECORD book carries LIVE provenance at a genuine provider boundary', async () => {
  const liveRaw = {
    data: {
      bookingId: 'booking_live_001',
      status: 'CONFIRMED',
      hotelConfirmationCode: 'CONF-LIVE-001',
      roomTypes: [
        {
          rates: [
            { retailRate: { total: { amount: 200, currency: 'USD' } } },
          ],
        },
      ],
    },
    sandbox: true,
  };
  const writeDir = mkdtempSync(join(tmpdir(), 'rv-n7-live-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const stubFetch: typeof fetch = async () => new Response(JSON.stringify(liveRaw), { status: 200 });
  const adapter = new NuiteeAdapter({
    mode: 'RECORD',
    store,
    bookingBaseUrl: 'https://book.liteapi.example/v3.0',
    apiKey: 'cid',
    fetchImpl: stubFetch,
  });
  const query: HotelBookQuery = { quoteId: 'prebook_live_001', guestNames: ['Guest One'] };
  const result = await adapter.bookStay(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.provenance, 'LIVE');
  assert.equal(result.data.bookingId, 'booking_live_001');
  assert.deepEqual(result.data.totalPrice, { amount: 200, currency: 'USD' });
});
