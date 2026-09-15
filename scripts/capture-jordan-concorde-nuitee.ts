/**
 * Capture genuine Nuitée Concorde (lp21d9f) lifecycle evidence for Jordan S2
 * WiT seed: baseline 29 Sep→3 Oct and recovered 30 Sep→3 Oct.
 *
 * Does NOT overwrite the generic RV-N7 capture query module.
 * Prefer refundable rates; guest nationality SG (Jordan).
 * Never invent refunds/economics if provider omits them.
 *
 * Run: `node --experimental-strip-types scripts/capture-jordan-concorde-nuitee.ts`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
} from '../src/contracts/capabilities.ts';

const FIXTURES_DIR = 'fixtures';
const REPORT_PATH = join('docs', 'work', 'WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md');
const HOTEL_ID = 'lp21d9f';
const GUEST_NAME = 'Jordan Hale';
const CLIENT_REFERENCE = 'qoder-atlas-wit-jordan-concorde';

type WindowSpec = { label: string; checkInDate: string; checkOutDate: string };

const WINDOWS: WindowSpec[] = [
  { label: 'baseline', checkInDate: '2026-09-29', checkOutDate: '2026-10-03' },
  { label: 'recovered', checkInDate: '2026-09-30', checkOutDate: '2026-10-03' },
];

function envForCapture(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    Object.assign(env, parseEnvFile(readFileSync('.env.local', 'utf8')));
  } catch {
    // optional
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

async function captureWindow(
  adapter: NuiteeAdapter,
  window: WindowSpec,
): Promise<Record<string, unknown>> {
  const searchQuery: HotelSearchQuery = {
    location: { externalRef: { system: 'nuitee-hotel-id', value: HOTEL_ID } },
    checkInDate: window.checkInDate,
    checkOutDate: window.checkOutDate,
    guests: { adults: 1 },
    rooms: 1,
    guestNationality: 'SG',
  };

  const searchResult = await adapter.searchHotels(searchQuery);
  if (!searchResult.ok) {
    return { window: window.label, ok: false, stage: 'search', error: searchResult.error };
  }
  const rates = searchResult.data.rates.filter((r) => r.propertyId === HOTEL_ID);
  const pool = rates.length > 0 ? rates : searchResult.data.rates;
  const rate = pool.find((r) => r.refundable) ?? pool[0];
  if (!rate) {
    return {
      window: window.label,
      ok: false,
      stage: 'search',
      error: 'no rates',
      searchRecordingId: searchResult.meta.recordingId,
    };
  }

  const quoteResult = await adapter.quoteRate({ rateId: rate.rateId } satisfies HotelQuoteQuery);
  if (!quoteResult.ok) {
    return {
      window: window.label,
      ok: false,
      stage: 'quote',
      error: quoteResult.error,
      searchRecordingId: searchResult.meta.recordingId,
      rateId: rate.rateId,
      refundable: rate.refundable,
      totalPrice: rate.totalPrice,
    };
  }
  const quote = quoteResult.data;
  if (!quote.quoteId) {
    return { window: window.label, ok: false, stage: 'quote', error: 'no quoteId' };
  }

  const bookResult = await adapter.bookStay({
    quoteId: quote.quoteId,
    guestNames: [GUEST_NAME],
    clientReference: `${CLIENT_REFERENCE}-${window.label}`,
  } satisfies HotelBookQuery);
  if (!bookResult.ok || !bookResult.data.confirmed || !bookResult.data.bookingId) {
    return {
      window: window.label,
      ok: false,
      stage: 'book',
      error: bookResult.ok ? bookResult.data : bookResult.error,
      searchRecordingId: searchResult.meta.recordingId,
      quoteRecordingId: quoteResult.meta.recordingId,
    };
  }
  const bookingId = bookResult.data.bookingId;

  const retrieveResult = await adapter.retrieveBooking({
    bookingId,
  } satisfies HotelRetrieveQuery);

  const cancelResult = await adapter.cancelStay({
    stayElementId: bookingId,
    reason: 'wit-jordan-concorde-capture',
  } satisfies HotelActionQuery);

  return {
    window: window.label,
    ok: true,
    checkInDate: window.checkInDate,
    checkOutDate: window.checkOutDate,
    hotelId: HOTEL_ID,
    rateId: rate.rateId,
    refundable: rate.refundable,
    totalPrice: rate.totalPrice,
    quoteId: quote.quoteId,
    bookingId,
    hotelConfirmationCode: bookResult.data.providerConfirmationCode,
    searchRecordingId: searchResult.meta.recordingId,
    quoteRecordingId: quoteResult.meta.recordingId,
    bookRecordingId: bookResult.meta.recordingId,
    retrieveRecordingId: retrieveResult.ok ? retrieveResult.meta.recordingId : undefined,
    retrieveStatus: retrieveResult.ok ? retrieveResult.data.status : retrieveResult.error,
    cancelRecordingId: cancelResult.ok ? cancelResult.meta.recordingId : undefined,
    cancelConfirmed: cancelResult.ok ? cancelResult.data.confirmed : false,
    cancelPayload: cancelResult.ok ? cancelResult.data : cancelResult.error,
    note: 'Guest nationality for search uses adapter default unless provider body exposes SG; rates excluding SG must be rejected manually if observed in raw recording.',
  };
}

async function main(): Promise<void> {
  const env = envForCapture();
  const apiKey = env.NUITEE_API_KEY;
  if (!apiKey) fail('NUITEE_API_KEY required');

  const store = new FileRecordingStore({
    readDirs: [],
    writeDir: join(FIXTURES_DIR, 'recordings'),
  });
  const adapter = new NuiteeAdapter({
    mode: 'RECORD',
    store,
    apiKey,
    ...(env.NUITEE_SEARCH_BASE_URL ? { searchBaseUrl: env.NUITEE_SEARCH_BASE_URL } : {}),
    ...(env.NUITEE_BOOKING_BASE_URL ? { bookingBaseUrl: env.NUITEE_BOOKING_BASE_URL } : {}),
  });

  const results: Record<string, unknown>[] = [];
  for (const window of WINDOWS) {
    process.stdout.write(`capturing ${window.label} ${window.checkInDate}→${window.checkOutDate}...\n`);
    const result = await captureWindow(adapter, window);
    results.push(result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  const md = `# Jordan Concorde Nuitée capture report

Generated by \`scripts/capture-jordan-concorde-nuitee.ts\`.

Hotel: Concorde Hotel Singapore (\`${HOTEL_ID}\`)
Guest name used: ${GUEST_NAME}
Nationality intent: SG (Jordan). Adapter search body may still send its default nationality — inspect recordings; do not use rates that explicitly exclude Singapore citizens/PR.

## Results

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`

## Provenance

Each recording under \`fixtures/recordings/nuitee/\` is a real sandbox exchange.
Economics/refund fields are only as returned by the provider — never fabricated.
`;
  mkdirSync(join('docs', 'work'), { recursive: true });
  writeFileSync(REPORT_PATH, md, 'utf8');
  process.stdout.write(`wrote ${REPORT_PATH}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
