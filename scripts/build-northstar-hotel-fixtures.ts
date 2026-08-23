/**
 * Generates the genuine Nuitée (liteAPI) recording corpus under
 * fixtures/recordings/nuitee by running the real NuiteeAdapter in RECORD
 * mode against the liteAPI sandbox (RV-N7, WP-R4-REDO).
 *
 * Unlike the old Duffel Stays fixture generator (which wrote hand-authored
 * synthetic payloads), every recording here is a real provider exchange:
 * search -> quote(prebook) -> book -> retrieve -> stay context -> cancel,
 * chained on actual sandbox identifiers. The chain completes by cancelling
 * the sandbox booking, so no reservation survives the capture.
 *
 * Because recording ids hash the exact query object, the frozen query
 * literals are emitted to test/fixtures/nuitee-hotel-queries.ts so REPLAY
 * tests resolve the identical recordings.
 *
 * Requires NUITEE_API_KEY (falls back to .env.local); NUITEE_SEARCH_BASE_URL
 * and NUITEE_BOOKING_BASE_URL are optional (adapter defaults to the real
 * Nuitee Connect hosts).
 *
 * Run: `node --experimental-strip-types scripts/build-northstar-hotel-fixtures.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NuiteeAdapter } from '../src/providers/hotel/nuiteeAdapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { parseEnvFile } from '../src/config/config.ts';
import type {
  HotelBookQuery,
  HotelQuoteQuery,
  HotelRetrieveQuery,
  HotelSearchQuery,
  HotelActionQuery,
  StayContextQuery,
} from '../src/contracts/capabilities.ts';

const FIXTURES_DIR = 'fixtures';
const QUERIES_EMIT_PATH = join('test', 'fixtures', 'nuitee-hotel-queries.ts');
const GUEST_NAME = 'Northstar Replay';
const CLIENT_REFERENCE = 'qoder-atlas-rv-n7';

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

async function main(): Promise<void> {
  const env = envForCapture();
  const apiKey = env.NUITEE_API_KEY;
  if (!apiKey) fail('NUITEE_API_KEY is required for a genuine capture (set it in .env.local).');

  const store = new FileRecordingStore({ readDirs: [], writeDir: join(FIXTURES_DIR, 'recordings') });
  const adapter = new NuiteeAdapter({
    mode: 'RECORD',
    store,
    apiKey,
    ...(env.NUITEE_SEARCH_BASE_URL ? { searchBaseUrl: env.NUITEE_SEARCH_BASE_URL } : {}),
    ...(env.NUITEE_BOOKING_BASE_URL ? { bookingBaseUrl: env.NUITEE_BOOKING_BASE_URL } : {}),
  });

  // Frozen search query: generic inputs only (coordinates, dates, party
  // size). All provider identifiers below are discovered from the live
  // sandbox chain, never invented.
  const searchQuery: HotelSearchQuery = {
    location: { coordinates: { latitude: 1.2839, longitude: 103.8607, radiusKm: 5 } },
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    guests: { adults: 1 },
    rooms: 1,
  };

  // 1. search
  const searchResult = await adapter.searchHotels(searchQuery);
  if (!searchResult.ok) {
    fail(`search failed: ${JSON.stringify(searchResult.error)}`);
  }
  process.stdout.write(
    `search ok (recording ${searchResult.meta.recordingId}): ` +
      `${searchResult.data.properties.length} properties, ${searchResult.data.rates.length} rates\n`,
  );
  const rate = searchResult.data.rates.find((candidate) => candidate.refundable) ?? searchResult.data.rates[0];
  if (!rate) fail('search returned no rates; cannot chain a genuine capture');

  // 2. quote (prebook) on the offerId surfaced by search
  const quoteQuery: HotelQuoteQuery = { rateId: rate.rateId };
  const quoteResult = await adapter.quoteRate(quoteQuery);
  if (!quoteResult.ok) fail(`quote failed: ${JSON.stringify(quoteResult.error)}`);
  const quote = quoteResult.data;
  if (!quote.quoteId) fail(`quote returned no quoteId: ${JSON.stringify(quote)}`);
  process.stdout.write(
    `quote ok (recording ${quoteResult.meta.recordingId}): status=${quote.status} quoteId=${quote.quoteId}\n`,
  );

  // 3. book with the prebook handle
  const bookQuery: HotelBookQuery = {
    quoteId: quote.quoteId,
    guestNames: [GUEST_NAME],
    clientReference: CLIENT_REFERENCE,
  };
  const bookResult = await adapter.bookStay(bookQuery);
  if (!bookResult.ok) fail(`book failed: ${JSON.stringify(bookResult.error)}`);
  const booking = bookResult.data;
  if (!booking.confirmed || !booking.bookingId) fail(`book not confirmed: ${JSON.stringify(booking)}`);
  process.stdout.write(
    `book ok (recording ${bookResult.meta.recordingId}): bookingId=${booking.bookingId} ` +
      `hotelConfirmationCode=${booking.providerConfirmationCode ?? '(none)'}\n`,
  );

  // 4. retrieve the live booking
  const retrieveQuery: HotelRetrieveQuery = { bookingId: booking.bookingId };
  const retrieveResult = await adapter.retrieveBooking(retrieveQuery);
  if (!retrieveResult.ok) fail(`retrieve failed: ${JSON.stringify(retrieveResult.error)}`);
  if (retrieveResult.data.status !== 'CONFIRMED') {
    fail(`retrieve expected CONFIRMED, got ${retrieveResult.data.status}`);
  }
  process.stdout.write(`retrieve ok (recording ${retrieveResult.meta.recordingId}): CONFIRMED\n`);

  // 5. stay context for the same booking (imported-booking surface)
  const stayContextQuery: StayContextQuery = { stayElementId: booking.bookingId };
  const stayContextResult = await adapter.getStayContext(stayContextQuery);
  if (!stayContextResult.ok) fail(`stay context failed: ${JSON.stringify(stayContextResult.error)}`);
  process.stdout.write(`stay context ok (recording ${stayContextResult.meta.recordingId})\n`);

  // 6. cancel the sandbox booking so no reservation survives the capture
  const cancelQuery: HotelActionQuery = { stayElementId: booking.bookingId, reason: 'capture-completion' };
  const cancelResult = await adapter.cancelStay(cancelQuery);
  if (!cancelResult.ok) fail(`cancel failed: ${JSON.stringify(cancelResult.error)}`);
  if (!cancelResult.data.confirmed) fail(`cancel not confirmed: ${JSON.stringify(cancelResult.data)}`);
  process.stdout.write(
    `cancel ok (recording ${cancelResult.meta.recordingId}): reference=${cancelResult.data.reference ?? booking.bookingId}\n`,
  );

  // Emit the frozen query literals the REPLAY tests consume. Recording ids
  // are deterministic hashes of these exact objects.
  const queriesModule = `/**
 * Frozen Nuitée capture query literals (RV-N7, WP-R4-REDO).
 *
 * GENERATED by scripts/build-northstar-hotel-fixtures.ts — do not edit.
 * These are the exact query objects that produced the committed recordings
 * under fixtures/recordings/nuitee; recording ids hash them, so REPLAY
 * resolves only when the objects match byte-for-byte. Provider identifiers
 * below are genuine sandbox values captured at generation time.
 */
import type {
  HotelActionQuery,
  HotelBookQuery,
  HotelQuoteQuery,
  HotelRetrieveQuery,
  HotelSearchQuery,
  StayContextQuery,
} from '../../src/contracts/capabilities.ts';

export const NUITEE_CAPTURE_SEARCH_QUERY: HotelSearchQuery = ${JSON.stringify(searchQuery, null, 2)};

export const NUITEE_CAPTURE_QUOTE_QUERY: HotelQuoteQuery = ${JSON.stringify(quoteQuery, null, 2)};

export const NUITEE_CAPTURE_BOOK_QUERY: HotelBookQuery = ${JSON.stringify(bookQuery, null, 2)};

export const NUITEE_CAPTURE_RETRIEVE_QUERY: HotelRetrieveQuery = ${JSON.stringify(retrieveQuery, null, 2)};

export const NUITEE_CAPTURE_STAY_CONTEXT_QUERY: StayContextQuery = ${JSON.stringify(stayContextQuery, null, 2)};

export const NUITEE_CAPTURE_CANCEL_QUERY: HotelActionQuery = ${JSON.stringify(cancelQuery, null, 2)};
`;
  writeFileSync(QUERIES_EMIT_PATH, queriesModule, 'utf8');
  process.stdout.write(`wrote ${QUERIES_EMIT_PATH}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
