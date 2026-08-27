/**
 * Hero business-truth pins for Lane ownership (Jonas/Oliver/Jordan/Sarah data).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  filterSearchToRequestedHotels,
  normalizeSearch,
} from '../src/providers/hotel/nuiteeAdapter.ts';
import { interpretChangeRequest } from '../src/app/changeIntake.ts';

test('hero-truth: hotel-id search filtering keeps only requested Concorde property', () => {
  const recording = JSON.parse(
    readFileSync(
      resolve('fixtures/recordings/nuitee/search/rec_f90cef2343dab3cba7425e9cae5580b1.json'),
      'utf8',
    ),
  );
  const full = normalizeSearch(recording.raw);
  assert.ok(full.properties.length > 1, 'recording basket is multi-hotel');
  const filtered = filterSearchToRequestedHotels(full, ['lp21d9f']);
  assert.equal(filtered.properties.length, 1);
  assert.equal(filtered.properties[0]?.propertyId, 'lp21d9f');
  assert.equal(filtered.properties[0]?.name, 'Concorde Hotel Singapore');
  assert.ok(filtered.rates.every((rate) => rate.propertyId === 'lp21d9f'));
  const cheapest = [...filtered.rates].sort((a, b) => a.totalPrice.amount - b.totalPrice.amount)[0];
  assert.equal(cheapest?.totalPrice.amount, 541.83);
  assert.equal(cheapest?.totalPrice.currency, 'USD');
});

test('hero-truth: NL origin change extracts preserveReturnDestination LHR', async () => {
  const result = await interpretChangeRequest(
    {},
    {
      text: 'I am actually flying out of HND to Singapore, not London. I will still return to LHR after the summit.',
      travellerId: 'trv-1',
      tripId: 'trip-1',
      at: '2026-09-18T10:05:00+08:00',
    },
  );
  assert.equal(result.ok, true);
  assert.ok(result.proposal);
  assert.deepEqual(result.proposal?.target.departureOrigin, {
    system: 'airport-code',
    value: 'HND',
  });
  assert.deepEqual(result.proposal?.target.preserveReturnDestination, {
    system: 'airport-code',
    value: 'LHR',
  });
});

test('hero-truth: S2 pack no longer calls viable TR885 inadequate', () => {
  const scenario = JSON.parse(
    readFileSync(
      resolve('data/ait-demo-input-pack/scenarios/s2-missed-connection/scenario.json'),
      'utf8',
    ),
  );
  const inventory = JSON.parse(
    readFileSync(
      resolve(
        'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/recovery-options-inventory.json',
      ),
      'utf8',
    ),
  );
  const manifest = JSON.parse(
    readFileSync(resolve('fixtures/acceptance/manifests/s2-missed-connection.json'), 'utf8'),
  );
  assert.equal(/inadequate/i.test(scenario.note), false);
  assert.equal(/inadequate/i.test(manifest.title), false);
  const tr885 = inventory.routes[0].services.find((s: { flightNumber: string }) => s.flightNumber === 'TR885');
  const tr867 = inventory.routes[0].services.find((s: { flightNumber: string }) => s.flightNumber === 'TR867');
  assert.ok(tr885);
  assert.ok(tr867);
  assert.equal(/inadequate/i.test(JSON.stringify(tr885)), false);
  assert.match(JSON.stringify(tr867), /inadequate/i);
});

test('hero-truth: Jonas data-pack checkout matches canonical 3 Oct 11:00', () => {
  const booked = JSON.parse(
    readFileSync(
      resolve('data/ait-demo-input-pack/scenarios/s5-sunday-extension/inputs/booked-itinerary.json'),
      'utf8',
    ),
  );
  assert.equal(booked.hotel.placeId, 'place-hotel-bayview');
  assert.equal(booked.hotel.checkOut, '2026-10-03T11:00:00+08:00');
});
