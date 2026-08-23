/**
 * REV-2 WP-R4 — Hotel Minimum: the Duffel Stays adapter must be WIRED.
 *
 * Failing-first regression suite for the Review 2 finding: the complete
 * HotelCapability adapter was unreachable — compose.ts wired only
 * { flight, routing }, dispatch.ts returned capabilityAbsent for every
 * hotel.* operation, no DUFFEL_* names existed in config, the default base
 * URL was a placeholder host, and the REPLAY corpus lived where only the
 * unit test could see it.
 *
 * Post-fix expectations (credential-free):
 *  - DUFFEL_TOKEN / DUFFEL_BASE_URL are registered config names following
 *    the Atlas pattern, with hasLiveCredentials('duffelStays');
 *  - the adapter's default base URL is the real host (Wave-1 plan), and
 *    LIVE/RECORD still fail closed with NOT_CONFIGURED without credentials;
 *  - the COMPOSED app injects the adapter: its capability descriptors
 *    include the HOTEL family, and dispatching hotel.search through the
 *    same tool dispatcher the planning loop uses replays the committed
 *    fixtures/recordings/duffel-stays corpus — not only the unit test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { AppConfigSchema, hasLiveCredentials, loadConfig } from '../src/config/config.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { dispatchToolRequest } from '../src/app/dispatch.ts';
import { DUFFEL_STAYS_DEFAULT_BASE_URL } from '../src/providers/hotel/duffelStaysAdapter.ts';

test('rev2-r4: DUFFEL_TOKEN / DUFFEL_BASE_URL register as config with hasLiveCredentials', () => {
  // Absent credentials: the app still loads, and duffelStays is not live.
  const bare = loadConfig({}, tmpdir());
  assert.equal(hasLiveCredentials(bare, 'duffelStays'), false, 'no token -> not live');

  // Present credentials (Wave-1 frozen names): live becomes true. The base
  // URL defaults to the real host, so the token alone is sufficient.
  const credentialed = loadConfig(
    { DUFFEL_TOKEN: 'duffel_test_example', DUFFEL_BASE_URL: 'https://api.duffel.com' },
    tmpdir(),
  );
  assert.equal(credentialed.providers.duffelStays.token, 'duffel_test_example');
  assert.equal(credentialed.providers.duffelStays.baseUrl, 'https://api.duffel.com');
  assert.equal(hasLiveCredentials(credentialed, 'duffelStays'), true, 'token -> live');

  const tokenOnly = loadConfig({ DUFFEL_TOKEN: 'duffel_test_example' }, tmpdir());
  assert.equal(hasLiveCredentials(tokenOnly, 'duffelStays'), true, 'base URL default makes the token sufficient');
});

test('rev2-r4: adapter default base URL is the real host, never a placeholder', () => {
  assert.equal(DUFFEL_STAYS_DEFAULT_BASE_URL, 'https://api.duffel.com');
});

test('rev2-r4: composed app wires the hotel adapter and replays the committed corpus', async () => {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: resolve('fixtures'),
    providers: { atlas: {}, modelStudio: {}, googleRoutes: {}, duffelStays: {} },
  });
  const composed = await composeAppRuntime(config);
  try {
    // The descriptor surface advertises the HOTEL family in REPLAY.
    const hotelDescriptor = composed.capabilityDescriptors.find((descriptor) => descriptor.family === 'HOTEL');
    assert.ok(hotelDescriptor, 'the composed app advertises a HOTEL capability');
    assert.equal(hotelDescriptor!.providerId, 'duffel-stays');
    assert.equal(hotelDescriptor!.mode, 'REPLAY');

    // The SAME dispatcher the planning loop uses serves hotel.search from
    // the committed fixtures/recordings/duffel-stays corpus.
    const search = await dispatchToolRequest(composed.capabilities, {
      id: 'tool-hotel-search',
      capability: 'HOTEL',
      operation: 'hotel.search',
      parameters: {
        location: { externalRef: { system: 'city_code', value: 'STAY-CT-001' } },
        checkInDate: '2026-10-01',
        checkOutDate: '2026-10-04',
      },
      purpose: 'regression: composed app replays the hotel corpus',
    });
    assert.equal(search.ok, true, JSON.stringify(search.ok ? undefined : search.error));
    if (search.ok) {
      assert.equal(search.providerId, 'duffel-stays');
      const properties = search.data['properties'] as Array<{ name: string }>;
      assert.equal(properties.length, 1);
      assert.equal(properties[0]!.name, 'Property-Synthetic-001');
      assert.ok(search.recordingId?.startsWith('rec_'), 'replay is recording-bound');
    }

    // Quote and retrieve replay through the same seam.
    const quote = await dispatchToolRequest(composed.capabilities, {
      id: 'tool-hotel-quote',
      capability: 'HOTEL',
      operation: 'hotel.quote',
      parameters: { rateId: 'rate_synthetic_001' },
      purpose: 'regression: quote replays',
    });
    assert.equal(quote.ok, true, JSON.stringify(quote.ok ? undefined : quote.error));

    const retrieve = await dispatchToolRequest(composed.capabilities, {
      id: 'tool-hotel-retrieve',
      capability: 'HOTEL',
      operation: 'hotel.retrieve',
      parameters: { bookingId: 'stay_booking_001' },
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
