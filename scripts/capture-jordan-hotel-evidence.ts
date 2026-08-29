/**
 * Captures genuine Nuitée sandbox evidence for the two stays Jordan's whole-trip
 * recovery must act on, and writes the provider-shaped recordings into the
 * committed REPLAY corpus under fixtures/recordings/nuitee.
 *
 *   1. Narita overnight (the actual required night: in 2026-09-29, out 09-30)
 *      search -> quote -> book -> retrieve -> cancel
 *   2. Singapore baseline stay at the existing Concorde provider identity
 *      search -> quote -> book -> retrieve -> stay context -> cancel
 *
 * The Singapore booking exists to obtain a REAL provider booking id: the
 * generic hotel executor cancels a displaced stay by its provider reference,
 * and a declared programme itinerary item has no such identity. The id is
 * reported for the fixture to reference; nothing here invents one.
 *
 * Search/quote requests carry no per-run identity, so the app resolves those
 * same recordings in REPLAY. book/retrieve/cancel are captured as genuine
 * completed-transaction evidence; the app's own RECORD pass writes the ones its
 * intent identity will actually request.
 *
 * Every chain cancels what it books, so no sandbox reservation survives.
 *
 * Requires NUITEE_API_KEY (falls back to .env.local).
 *
 * Run: `node --experimental-strip-types scripts/capture-jordan-hotel-evidence.ts`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NuiteeAdapter } from '../src/providers/hotel/nuiteeAdapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { parseEnvFile } from '../src/config/config.ts';
import type {
  HotelActionQuery,
  HotelBookQuery,
  HotelQuoteQuery,
  HotelRetrieveQuery,
  HotelSearchQuery,
  StayContextQuery,
} from '../src/contracts/capabilities.ts';

const GUEST_NAME = 'Northstar Replay';
const CLIENT_REFERENCE = 'qoder-atlas-jordan-hotel-evidence';
const REPORT_PATH = join('output', 'jordan-hotel-evidence', 'report.json');

/**
 * The Narita hub coordinates already proven searchable by
 * scripts/wave4r-s2-hub-hotels.ts. Deliberately no radius: a programme Place
 * carries only latitude/longitude, and the planner forwards exactly that, so
 * the adapter's own default radius applies to both this capture and the app.
 */
const NARITA_SEARCH: HotelSearchQuery = {
  location: { coordinates: { latitude: 35.772, longitude: 140.3929 } },
  checkInDate: '2026-09-29',
  checkOutDate: '2026-09-30',
  guests: { adults: 1 },
  rooms: 1,
};

/** Concorde Hotel Singapore, the property Jordan's declared stay already names. */
const SINGAPORE_SEARCH: HotelSearchQuery = {
  location: { externalRef: { system: 'nuitee-hotel-id', value: 'lp21d9f' } },
  checkInDate: '2026-09-30',
  checkOutDate: '2026-10-03',
  guests: { adults: 1 },
  rooms: 1,
};

function envForCapture(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    Object.assign(env, parseEnvFile(readFileSync('.env.local', 'utf8')));
  } catch {
    // .env.local is optional; process.env may carry the credentials.
  }
  for (const key of ['NUITEE_API_KEY', 'NUITEE_SEARCH_BASE_URL', 'NUITEE_BOOKING_BASE_URL']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  const env = envForCapture();
  const apiKey = env.NUITEE_API_KEY;
  if (!apiKey) fail('NUITEE_API_KEY is required for a genuine capture (set it in .env.local).');

  const store = new FileRecordingStore({
    readDirs: [join('fixtures', 'recordings')],
    writeDir: join('fixtures', 'recordings'),
  });
  const adapter = new NuiteeAdapter({
    mode: 'RECORD',
    store,
    apiKey,
    ...(env.NUITEE_SEARCH_BASE_URL ? { searchBaseUrl: env.NUITEE_SEARCH_BASE_URL } : {}),
    ...(env.NUITEE_BOOKING_BASE_URL ? { bookingBaseUrl: env.NUITEE_BOOKING_BASE_URL } : {}),
  });

  /**
   * Deterministic selection over normalized provider output: prefer a
   * refundable rate, cheapest first, so the capture never depends on provider
   * result ordering. No property name is chosen by this script.
   */
  const pickRate = (rates: { rateId: string; refundable: boolean; totalPrice: { amount: number } }[]) => {
    const byPrice = (a: typeof rates[number], b: typeof rates[number]) => a.totalPrice.amount - b.totalPrice.amount;
    const refundable = rates.filter((rate) => rate.refundable).sort(byPrice);
    return refundable[0] ?? [...rates].sort(byPrice)[0];
  };

  const chain = async (label: string, searchQuery: HotelSearchQuery, withStayContext: boolean) => {
    log(`\n=== ${label} ===`);

    const search = await adapter.searchHotels(searchQuery);
    if (!search.ok) fail(`${label}: search failed ${JSON.stringify(search.error)}`);
    const { properties, rates } = search.data;
    log(`search ok recording=${search.meta.recordingId} properties=${properties.length} rates=${rates.length}`);
    if (rates.length === 0) fail(`${label}: provider returned no rates`);

    const rate = pickRate(rates);
    const property = properties.find((candidate) => candidate.propertyId === rate.propertyId);
    if (!rate) fail(`${label}: no selectable rate`);
    log(
      `selected property=${property?.name ?? rate.propertyId} rateId=${rate.rateId} ` +
        `total=${rate.totalPrice.amount} ${rate.totalPrice.currency} refundable=${rate.refundable}`,
    );

    const quoteQuery: HotelQuoteQuery = { rateId: rate.rateId };
    const quote = await adapter.quoteRate(quoteQuery);
    if (!quote.ok) fail(`${label}: quote failed ${JSON.stringify(quote.error)}`);
    if (!quote.data.quoteId) fail(`${label}: quote returned no handle ${JSON.stringify(quote.data)}`);
    log(`quote ok recording=${quote.meta.recordingId} status=${quote.data.status} quoteId=${quote.data.quoteId}`);

    const bookQuery: HotelBookQuery = {
      quoteId: quote.data.quoteId,
      guestNames: [GUEST_NAME],
      clientReference: CLIENT_REFERENCE,
    };
    const book = await adapter.bookStay(bookQuery);
    if (!book.ok) fail(`${label}: book failed ${JSON.stringify(book.error)}`);
    if (!book.data.confirmed || !book.data.bookingId) {
      fail(`${label}: book not confirmed ${JSON.stringify(book.data)}`);
    }
    log(
      `book ok recording=${book.meta.recordingId} bookingId=${book.data.bookingId} ` +
        `confirmationCode=${book.data.providerConfirmationCode ?? '(none)'}`,
    );

    const retrieveQuery: HotelRetrieveQuery = { bookingId: book.data.bookingId };
    const retrieve = await adapter.retrieveBooking(retrieveQuery);
    if (!retrieve.ok) fail(`${label}: retrieve failed ${JSON.stringify(retrieve.error)}`);
    log(`retrieve ok recording=${retrieve.meta.recordingId} status=${retrieve.data.status}`);
    if (retrieve.data.status !== 'CONFIRMED') fail(`${label}: observed ${retrieve.data.status}, not CONFIRMED`);

    let stayContext: { recordingId?: string } | undefined;
    if (withStayContext) {
      const stayContextQuery: StayContextQuery = { stayElementId: book.data.bookingId };
      const context = await adapter.getStayContext(stayContextQuery);
      if (!context.ok) fail(`${label}: stay context failed ${JSON.stringify(context.error)}`);
      stayContext = { recordingId: context.meta.recordingId };
      log(`stay context ok recording=${context.meta.recordingId}`);
    }

    // Clean the sandbox reservation up. Its recording stays, which is what a
    // displaced-stay cancellation in REPLAY needs to observe.
    const cancelQuery: HotelActionQuery = { stayElementId: book.data.bookingId, reason: 'capture-completion' };
    const cancel = await adapter.cancelStay(cancelQuery);
    if (!cancel.ok) fail(`${label}: cancel failed ${JSON.stringify(cancel.error)}`);
    log(`cancel ok recording=${cancel.meta.recordingId} confirmed=${cancel.data.confirmed}`);

    return {
      searchQuery,
      searchRecordingId: search.meta.recordingId,
      property: property
        ? {
            propertyId: property.propertyId,
            name: property.name,
            externalRefs: property.externalRefs ?? [],
            coordinates: property.coordinates ?? null,
          }
        : null,
      selectedRate: { rateId: rate.rateId, totalPrice: rate.totalPrice, refundable: rate.refundable },
      quoteRecordingId: quote.meta.recordingId,
      quoteId: quote.data.quoteId,
      quotedPrice: quote.data.quotedPrice ?? null,
      bookRecordingId: book.meta.recordingId,
      bookingId: book.data.bookingId,
      providerConfirmationCode: book.data.providerConfirmationCode ?? null,
      retrieveRecordingId: retrieve.meta.recordingId,
      ...(stayContext ? { stayContextRecordingId: stayContext.recordingId } : {}),
      cancelRecordingId: cancel.meta.recordingId,
    };
  };

  const narita = await chain('Narita overnight 2026-09-29 -> 09-30', NARITA_SEARCH, false);
  const singapore = await chain('Singapore baseline stay 2026-09-30 -> 10-03', SINGAPORE_SEARCH, true);

  mkdirSync(join('output', 'jordan-hotel-evidence'), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'RECORD against the Nuitée sandbox; every booking cancelled after capture',
        narita,
        singapore,
      },
      null,
      2,
    ),
    'utf8',
  );
  log(`\nwrote ${REPORT_PATH}`);
  log(`Singapore provider booking id for the fixture: ${singapore.bookingId}`);
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
