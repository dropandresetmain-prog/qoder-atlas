/**
 * A5 provider-stay-baseline bootstrap (src/app/demo/providerStayBaseline.ts)
 * against a stub HotelCapability — no network, no recordings. Proves the
 * documented lifecycle: pristine clone -> book/replay at the provider -> read
 * confirmed terms -> attach as an observed HOTEL_BOOKING linked to the
 * canonical reservation, idempotently, with client-reference recovery and
 * the documented structured failure modes.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapProviderStayBaseline,
  findAttachedProviderStayBooking,
  NUITEE_PROVIDER_KIND,
  PROVIDER_STAY_RECORD_TYPE,
  type ProviderStayBaselineBinding,
} from '../src/app/demo/providerStayBaseline.ts';
import type {
  HotelBookingLookupOutcome,
  HotelBookingOutcome,
  HotelBookQuery,
  HotelCapability,
  HotelPropertyView,
  HotelQuoteOutcome,
  HotelRateView,
  StayContext,
} from '../src/contracts/capabilities.ts';
import { capabilityOk, type AdapterMode, type CapabilityResult } from '../src/contracts/envelope.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import {
  buildAitFixtureDatabase,
  cloneAitFixtureDatabase,
  type AitCloneHandle,
  type AitFixtureHandle,
} from './aitFixtureClone.ts';

const ACTOR = 'principal:a5-provider-stay-baseline';
const OBSERVED_AT = '2026-09-29T00:00:00.000Z';

/** The binding configured in fixtures/programmes/ait-summit-2026/recovery-research.json. */
const BASE_BINDING: ProviderStayBaselineBinding = {
  sourceBookingReference: 'ait-draft-09-destination-stay',
  propertyExternalRef: { system: 'nuitee-hotel-id', value: 'lp6d67d' },
  guestNationality: 'SG',
  guests: { adults: 1, rooms: 1 },
};

type HotelStub = Pick<
  HotelCapability,
  'searchHotels' | 'quoteRate' | 'bookStay' | 'getStayContext' | 'findBookingsByClientReference'
>;

interface StubOverrides {
  properties?: HotelPropertyView[];
  rates?: HotelRateView[];
  quote?: CapabilityResult<HotelQuoteOutcome>;
  booking?: CapabilityResult<HotelBookingOutcome>;
  context?: CapabilityResult<StayContext>;
  lookup?: CapabilityResult<HotelBookingLookupOutcome>;
}

function stubMeta(mode: AdapterMode) {
  return { providerId: 'stub-nuitee', mode, requestedAt: new Date().toISOString() };
}

function defaultRates(): HotelRateView[] {
  return [
    {
      rateId: 'rate-refundable',
      propertyId: 'lp6d67d',
      totalPrice: { amount: 980.00, currency: 'USD' },
      refundable: true,
      availability: 'AVAILABLE',
    },
    {
      rateId: 'rate-nonrefundable-cheaper',
      propertyId: 'lp6d67d',
      totalPrice: { amount: 700.00, currency: 'USD' },
      refundable: false,
      availability: 'AVAILABLE',
    },
  ];
}

function defaultContext(): StayContext {
  return {
    bookedTotal: { amount: 976.04, currency: 'USD' },
    cancellation: {
      refundable: true,
      deadline: '2026-09-29T23:59:59Z',
      fee: { amount: 976.04, currency: 'USD' },
    },
  };
}

function createStubHotel(overrides: StubOverrides = {}, mode: AdapterMode = 'RECORD') {
  const calls = { search: 0, quote: 0, book: 0, context: 0, lookup: 0 };
  let lastBookQuery: HotelBookQuery | undefined;
  const hotel: HotelStub = {
    async searchHotels() {
      calls.search += 1;
      return capabilityOk(
        { properties: overrides.properties ?? [{ propertyId: 'lp6d67d', name: 'Stub Property' }], rates: overrides.rates ?? defaultRates() },
        stubMeta(mode),
      );
    },
    async quoteRate() {
      calls.quote += 1;
      return overrides.quote ?? capabilityOk({ status: 'QUOTED', quoteId: 'quote-1' }, stubMeta(mode));
    },
    async bookStay(query) {
      calls.book += 1;
      lastBookQuery = query;
      return overrides.booking ?? capabilityOk({ confirmed: true, bookingId: 'stub-booking-1', provenance: 'SIMULATED' }, stubMeta(mode));
    },
    async getStayContext() {
      calls.context += 1;
      return overrides.context ?? capabilityOk(defaultContext(), stubMeta(mode));
    },
    async findBookingsByClientReference() {
      calls.lookup += 1;
      return overrides.lookup ?? capabilityOk({ bookings: [] }, stubMeta(mode));
    },
  };
  return { hotel, calls, getLastBookQuery: () => lastBookQuery };
}

function baselineInput(params: {
  clone: AitCloneHandle;
  hotel: HotelStub;
  mode?: AdapterMode;
  binding?: ProviderStayBaselineBinding;
}) {
  const { clone, hotel, mode = 'RECORD' as AdapterMode, binding = BASE_BINDING } = params;
  return {
    pool: clone.pool,
    uow: () => new PgUnitOfWork(clone.pool, clone.workspaceId),
    workspaceId: clone.workspaceId,
    actorPrincipalId: ACTOR,
    hotel,
    mode,
    binding,
    observedAt: OBSERVED_AT,
  };
}

async function connectionCount(clone: AitCloneHandle): Promise<number> {
  const rows = await clone.pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM external_connections WHERE workspace_id = $1 AND provider_kind = $2`,
    [clone.workspaceId, NUITEE_PROVIDER_KIND],
  );
  return Number(rows.rows[0]!.n);
}

describe('A5 provider stay baseline (stub HotelCapability)', () => {
  let fixture: AitFixtureHandle | undefined;

  before(async () => {
    fixture = await buildAitFixtureDatabase({ runBaseline: true });
  });

  after(async () => {
    await fixture?.drop().catch(() => undefined);
  });

  test('RECORD-mode happy path attaches the refundable rate and is idempotent on retry', async () => {
    const clone = await cloneAitFixtureDatabase(fixture!.databaseName);
    try {
      const stub = createStubHotel();
      const first = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'RECORD' }));
      assert.equal(first.ok, true, JSON.stringify(first));
      if (!first.ok) return;
      assert.equal(first.status, 'ATTACHED');
      assert.equal(first.bookingId, 'stub-booking-1');
      assert.equal(first.checkInDate, '2026-09-29');
      assert.equal(first.checkOutDate, '2026-10-03');
      assert.equal(stub.calls.search, 1);
      assert.equal(stub.calls.quote, 1);
      assert.equal(stub.calls.book, 1);
      assert.equal(stub.calls.context, 1);
      const bookQuery = stub.getLastBookQuery();
      assert.ok(bookQuery, 'bookStay was called');
      assert.ok(bookQuery!.clientReference?.startsWith('ns-baseline-'), bookQuery!.clientReference);
      assert.ok(bookQuery!.guestNames.length > 0, JSON.stringify(bookQuery!.guestNames));

      assert.equal(await connectionCount(clone), 1);
      const attachedBookingId = await findAttachedProviderStayBooking(clone.pool, clone.workspaceId, first.reservationId);
      assert.equal(attachedBookingId, 'stub-booking-1');

      // Idempotency: calling again must not repeat any provider transaction.
      const second = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'RECORD' }));
      assert.equal(second.ok, true, JSON.stringify(second));
      if (!second.ok) return;
      assert.equal(second.status, 'ALREADY_ATTACHED');
      assert.equal(second.bookingId, 'stub-booking-1');
      assert.equal(stub.calls.search, 1, 'no additional search call on retry');
      assert.equal(stub.calls.quote, 1, 'no additional quote call on retry');
      assert.equal(stub.calls.book, 1, 'no additional book call on retry');
      assert.equal(await connectionCount(clone), 1);
    } finally {
      await clone.drop();
    }
  });

  test('a client-reference lookup hit attaches without search/quote/book', async () => {
    const clone = await cloneAitFixtureDatabase(fixture!.databaseName);
    try {
      const stub = createStubHotel({
        lookup: capabilityOk({ bookings: [{ bookingId: 'stub-booking-recovered', clientReference: 'ns-baseline-recovered' }] }, stubMeta('RECORD')),
      });
      const result = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'RECORD' }));
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) return;
      assert.equal(result.status, 'ATTACHED');
      assert.equal(result.bookingId, 'stub-booking-recovered');
      assert.equal(stub.calls.lookup, 1);
      assert.equal(stub.calls.search, 0);
      assert.equal(stub.calls.quote, 0);
      assert.equal(stub.calls.book, 0);
      assert.equal(stub.calls.context, 1, 'confirmed terms are still read for the recovered booking');
    } finally {
      await clone.drop();
    }
  });

  test('REPLAY mode recovers via recorded booking_lookup before booking', async () => {
    const clone = await cloneAitFixtureDatabase(fixture!.databaseName);
    try {
      const stub = createStubHotel({
        lookup: capabilityOk({ bookings: [{ bookingId: 'replay-lookup-1' }] }, stubMeta('REPLAY')),
      }, 'REPLAY');
      const result = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'REPLAY' }));
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) return;
      assert.equal(result.status, 'ATTACHED');
      assert.equal(stub.calls.lookup, 1, 'REPLAY uses the recording-backed client-reference lookup');
      assert.equal(stub.calls.search, 0);
      assert.equal(stub.calls.book, 0);
      assert.equal(stub.calls.context, 1);
    } finally {
      await clone.drop();
    }
  });

  test('REPLAY mode books when booking_lookup misses', async () => {
    const clone = await cloneAitFixtureDatabase(fixture!.databaseName);
    try {
      const stub = createStubHotel({
        lookup: capabilityOk({ bookings: [] }, stubMeta('REPLAY')),
      }, 'REPLAY');
      const result = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'REPLAY' }));
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) return;
      assert.equal(result.status, 'ATTACHED');
      assert.equal(stub.calls.lookup, 1);
      assert.equal(stub.calls.search, 1);
      assert.equal(stub.calls.book, 1);
    } finally {
      await clone.drop();
    }
  });

  test('a booking record without a confirmed total fails PROVIDER_CONTEXT_FAILED and attaches nothing', async () => {
    const clone = await cloneAitFixtureDatabase(fixture!.databaseName);
    try {
      const stub = createStubHotel({
        context: capabilityOk({} as StayContext, stubMeta('RECORD')),
      });
      const result = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'RECORD' }));
      assert.equal(result.ok, false, JSON.stringify(result));
      if (result.ok) return;
      assert.equal(result.code, 'PROVIDER_CONTEXT_FAILED');
      assert.equal(await connectionCount(clone), 0);

      const rows = await clone.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM external_records WHERE workspace_id = $1 AND record_type = $2`,
        [clone.workspaceId, PROVIDER_STAY_RECORD_TYPE],
      );
      assert.equal(Number(rows.rows[0]!.n), 0, 'no HOTEL_BOOKING external record was created');
    } finally {
      await clone.drop();
    }
  });

  test('an unknown source booking reference fails STAY_NOT_FOUND', async () => {
    const clone = await cloneAitFixtureDatabase(fixture!.databaseName);
    try {
      const stub = createStubHotel();
      const binding: ProviderStayBaselineBinding = {
        ...BASE_BINDING,
        sourceBookingReference: 'no-such-source-booking-reference',
      };
      const result = await bootstrapProviderStayBaseline(baselineInput({ clone, hotel: stub.hotel, mode: 'RECORD', binding }));
      assert.equal(result.ok, false, JSON.stringify(result));
      if (result.ok) return;
      assert.equal(result.code, 'STAY_NOT_FOUND');
      assert.equal(stub.calls.search, 0);
      assert.equal(stub.calls.book, 0);
    } finally {
      await clone.drop();
    }
  });
});
