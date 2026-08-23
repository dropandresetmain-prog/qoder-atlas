/**
 * REV-2 WP-R4-REDO — Hotel Minimum: the Nuitée (liteAPI) adapter must be WIRED.
 *
 * Successor of the WP-R4 Duffel Stays suite. Duffel Stays is unavailable in
 * Singapore, so the IMPLEMENTATION_PLAN Section 13 fallback clause fired and
 * Nuitée takes the hotel seam; the fixtures/recordings/nuitee corpus is a
 * genuine liteAPI sandbox capture (scripts/build-northstar-hotel-fixtures.ts).
 *
 * Post-fix expectations (credential-free):
 *  - NUITEE_API_KEY / NUITEE_SEARCH_BASE_URL / NUITEE_BOOKING_BASE_URL are
 *    registered config names following the Atlas pattern, with
 *    hasLiveCredentials('nuitee');
 *  - the adapter's default base URLs are the real Nuitee Connect hosts, and
 *    LIVE/RECORD still fail closed with NOT_CONFIGURED without credentials;
 *  - the COMPOSED app injects the adapter: its capability descriptors
 *    include the HOTEL family, and dispatching hotel.search through the
 *    same tool dispatcher the planning loop uses replays the committed
 *    fixtures/recordings/nuitee corpus — not only the unit test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { AppConfigSchema, hasLiveCredentials, loadConfig } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { dispatchToolRequest } from '../src/app/dispatch.ts';
import {
  NUITEE_DEFAULT_BOOKING_BASE_URL,
  NUITEE_DEFAULT_SEARCH_BASE_URL,
  NUITEE_PROVIDER_ID,
} from '../src/providers/hotel/nuiteeAdapter.ts';
import {
  NUITEE_CAPTURE_QUOTE_QUERY,
  NUITEE_CAPTURE_RETRIEVE_QUERY,
  NUITEE_CAPTURE_SEARCH_QUERY,
} from './fixtures/nuitee-hotel-queries.ts';

test('rev2-r4: NUITEE_* variables register as config with hasLiveCredentials', () => {
  // Absent credentials: the app still loads, and nuitee is not live.
  const bare = loadConfig({}, tmpdir());
  assert.equal(hasLiveCredentials(bare, 'nuitee'), false, 'no key -> not live');

  // Present credentials: live becomes true. Both base URLs default to the
  // real Nuitee Connect hosts, so the API key alone is sufficient.
  const credentialed = loadConfig(
    {
      NUITEE_API_KEY: 'sand_example',
      NUITEE_SEARCH_BASE_URL: 'https://api.liteapi.travel/v3.0',
      NUITEE_BOOKING_BASE_URL: 'https://book.liteapi.travel/v3.0',
    },
    tmpdir(),
  );
  assert.equal(credentialed.providers.nuitee.apiKey, 'sand_example');
  assert.equal(credentialed.providers.nuitee.searchBaseUrl, 'https://api.liteapi.travel/v3.0');
  assert.equal(credentialed.providers.nuitee.bookingBaseUrl, 'https://book.liteapi.travel/v3.0');
  assert.equal(hasLiveCredentials(credentialed, 'nuitee'), true, 'key -> live');

  const keyOnly = loadConfig({ NUITEE_API_KEY: 'sand_example' }, tmpdir());
  assert.equal(hasLiveCredentials(keyOnly, 'nuitee'), true, 'default hosts make the key sufficient');
});

test('rev2-r4: adapter default base URLs are the real Nuitee Connect hosts', () => {
  assert.equal(NUITEE_DEFAULT_SEARCH_BASE_URL, 'https://api.liteapi.travel/v3.0');
  assert.equal(NUITEE_DEFAULT_BOOKING_BASE_URL, 'https://book.liteapi.travel/v3.0');
});

test('rev2-r4: composed app wires the hotel adapter and replays the genuine corpus', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: resolve('fixtures'),
    providers: { atlas: {}, modelStudio: {}, googleRoutes: {}, nuitee: {} },
  });
  const composed = await composeAppRuntime(config);
  try {
    // The descriptor surface advertises the HOTEL family in REPLAY.
    const hotelDescriptor = composed.capabilityDescriptors.find((descriptor) => descriptor.family === 'HOTEL');
    assert.ok(hotelDescriptor, 'the composed app advertises a HOTEL capability');
    assert.equal(hotelDescriptor!.providerId, NUITEE_PROVIDER_ID);
    assert.equal(hotelDescriptor!.mode, 'REPLAY');

    // The SAME dispatcher the planning loop uses serves hotel.search from
    // the committed fixtures/recordings/nuitee corpus.
    const search = await dispatchToolRequest(composed.capabilities, {
      id: 'tool-hotel-search',
      capability: 'HOTEL',
      operation: 'hotel.search',
      parameters: { ...NUITEE_CAPTURE_SEARCH_QUERY },
      purpose: 'regression: composed app replays the genuine hotel corpus',
    });
    assert.equal(search.ok, true, JSON.stringify(search.ok ? undefined : search.error));
    if (search.ok) {
      assert.equal(search.providerId, NUITEE_PROVIDER_ID);
      const properties = search.data['properties'] as Array<{ propertyId: string; name: string }>;
      assert.ok(properties.length > 0);
      assert.ok(properties.some((property) => property.propertyId === 'lp21d9f'));
      assert.ok(search.recordingId?.startsWith('rec_'), 'replay is recording-bound');
    }

    // Quote and retrieve replay through the same seam with the genuine
    // captured identifiers.
    const quote = await dispatchToolRequest(composed.capabilities, {
      id: 'tool-hotel-quote',
      capability: 'HOTEL',
      operation: 'hotel.quote',
      parameters: { rateId: NUITEE_CAPTURE_QUOTE_QUERY.rateId },
      purpose: 'regression: quote replays',
    });
    assert.equal(quote.ok, true, JSON.stringify(quote.ok ? undefined : quote.error));
    if (quote.ok) {
      assert.equal(quote.data['status'], 'QUOTED');
    }

    const retrieve = await dispatchToolRequest(composed.capabilities, {
      id: 'tool-hotel-retrieve',
      capability: 'HOTEL',
      operation: 'hotel.retrieve',
      parameters: { bookingId: NUITEE_CAPTURE_RETRIEVE_QUERY.bookingId },
      purpose: 'regression: retrieve replays',
    });
    assert.equal(retrieve.ok, true, JSON.stringify(retrieve.ok ? undefined : retrieve.error));
    if (retrieve.ok) {
      assert.equal(retrieve.data['status'], 'CONFIRMED');
    }
  } finally {
    composed.db.close();
  }
});
