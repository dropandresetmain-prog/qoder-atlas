/**
 * Generates sanitized, deterministic Duffel Stays recording fixtures under
 * the curated corpus (fixtures/recordings/duffel-stays), replayable by both
 * test/northstar-hotel.test.ts and the composed application (REV-2 WP-R4).
 *
 * Run: `node --experimental-strip-types scripts/build-northstar-hotel-fixtures.ts`
 * Idempotent: writes the same bytes every time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recordingIdFor } from '../src/providers/recordingStore.ts';

const PROVIDER = 'duffel-stays';
const RECORDED_AT = '2026-08-23T00:00:00.000Z';

const SEARCH_QUERY = {
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

const searchRaw = {
  data: {
    properties: [
      {
        id: 'prop_synthetic_001',
        name: 'Property-Synthetic-001',
        address: '1 Synthetic Way, Synthetic City',
        latitude: 1.3,
        longitude: 103.8,
        external_refs: [{ system: 'city_code', value: 'STAY-CT-001' }],
      },
    ],
    rates: [
      {
        id: RATE_ID,
        property_id: 'prop_synthetic_001',
        room_description: 'Standard room',
        total_amount: '300.00',
        total_currency: 'USD',
        refundable: true,
        cancellation_deadline: '2026-09-30T23:59:00Z',
        cancellation_fee_amount: '0',
        cancellation_fee_currency: 'USD',
        availability: 'AVAILABLE',
        expires_at: '2026-08-24T00:00:00Z',
      },
    ],
  },
};

const quoteRaw = {
  data: {
    status: 'QUOTED',
    quoted_amount: '300.00',
    quoted_currency: 'USD',
    quote_id: QUOTE_ID,
  },
};

const bookRaw = {
  data: {
    confirmed: true,
    booking_id: STAY_ELEMENT_ID,
    provider_confirmation_code: 'CONF-XYZ-001',
    total_amount: '300.00',
    total_currency: 'USD',
  },
};

const retrieveRaw = {
  data: {
    booking_id: STAY_ELEMENT_ID,
    status: 'CONFIRMED',
    property_name: 'Property-Synthetic-001',
    check_in: '2026-10-01T15:00:00+08:00',
    check_out: '2026-10-04T11:00:00+08:00',
  },
};

const cancelRaw = {
  data: {
    confirmed: true,
    reference: 'cancel-ref-001',
    fee_amount: '0',
    fee_currency: 'USD',
  },
};

const modifyRaw = {
  data: {
    confirmed: true,
    reference: 'modify-ref-001',
    fee_amount: '0',
    fee_currency: 'USD',
  },
};

const stayContextRaw = {
  data: {
    property_name: 'Property-Synthetic-001',
    check_in_window_start: '2026-10-01T14:00:00+08:00',
    check_in_window_end: '2026-10-02T02:00:00+08:00',
    no_show_cutoff: '2026-10-02T03:00:00+08:00',
    late_arrival_supported: true,
    cancellation_refundable: true,
    cancellation_deadline: '2026-09-30T23:59:00Z',
    cancellation_fee_amount: '0',
    cancellation_fee_currency: 'USD',
  },
};

const unknownRetrieveRaw = {
  data: {
    booking_id: UNKNOWN_BOOKING_ID,
    status: 'UNKNOWN',
  },
};

const cases: Array<{ operation: string; request: unknown; raw: unknown }> = [
  { operation: 'search', request: SEARCH_QUERY, raw: searchRaw },
  { operation: 'quote', request: { rateId: RATE_ID }, raw: quoteRaw },
  { operation: 'book', request: { quoteId: QUOTE_ID, guestNames: ['Synthetic Guest'] }, raw: bookRaw },
  { operation: 'retrieve', request: { bookingId: STAY_ELEMENT_ID }, raw: retrieveRaw },
  { operation: 'cancel', request: { stayElementId: STAY_ELEMENT_ID }, raw: cancelRaw },
  { operation: 'modify', request: { stayElementId: STAY_ELEMENT_ID }, raw: modifyRaw },
  { operation: 'stay_context', request: { stayElementId: STAY_ELEMENT_ID }, raw: stayContextRaw },
  { operation: 'retrieve', request: { bookingId: UNKNOWN_BOOKING_ID }, raw: unknownRetrieveRaw },
];

for (const { operation, request, raw } of cases) {
  const id = recordingIdFor(PROVIDER, operation, request);
  const relativePath = `${PROVIDER}/${operation}/${id}.json`;
  const path = join('fixtures', 'recordings', relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const recording = {
    id,
    providerId: PROVIDER,
    operation,
    recordedAt: RECORDED_AT,
    sanitized: true as const,
    raw,
  };
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${path} (id=${id})\n`);
}
