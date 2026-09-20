import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppConfigSchema } from '../src/config/config.ts';
import { FileRecordingStore, NuiteeAdapter } from '../src/providers/index.ts';
import { composeTargetHotelResearch, withExplicitHotelGuestNationality } from '../src/app/targetHotelResearch.ts';
import type { PlanningToolRequest } from '../src/contracts/v2/planning/planningTool.ts';

function config(adapterMode: 'LIVE' | 'RECORD' | 'REPLAY', nuitee: Record<string, string> = {}) {
  return AppConfigSchema.parse({
    environment: 'local',
    logLevel: 'info',
    adapterMode,
    httpPort: 8787,
    sqlitePath: ':memory:',
    recordingsDir: 'recordings',
    fixturesDir: 'fixtures',
    intelligenceProvider: 'model_studio',
    providers: { atlas: {}, modelStudio: {}, openRouter: {}, googleRoutes: {}, nuitee, frankfurter: {} },
  });
}

function request(operation: 'hotel.search' | 'hotel.quote', parameters: Record<string, unknown>): PlanningToolRequest {
  return {
    id: randomUUID(),
    capability: 'HOTEL',
    operation,
    parameters,
    purpose: 'bounded hotel research',
    evidenceGapCode: 'hotel_research',
    round: 1,
  };
}

test('target HOTEL composition fails closed without LIVE Nuitée credentials', () => {
  assert.equal(composeTargetHotelResearch(config('LIVE'), process.cwd()), undefined);
  const replay = composeTargetHotelResearch(config('REPLAY'), process.cwd());
  assert.equal(replay?.metadata.family, 'HOTEL');
  assert.equal(replay?.metadata.guestNationalityRequired, true);
  assert.deepEqual(replay?.metadata.readOnlyOperations, ['hotel.context', 'hotel.search', 'hotel.quote', 'hotel.retrieve']);
});

test('target HOTEL search requires an explicit uppercase two-letter nationality', async () => {
  const adapter = withExplicitHotelGuestNationality(new NuiteeAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: ['fixtures/recordings'] }),
  }));
  const base = {
    location: { coordinates: { latitude: 1.2839, longitude: 103.8607, radiusKm: 5 } },
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    guests: { adults: 1 },
    rooms: 1,
  };
  const missing = await adapter.searchHotels(base);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'guest_nationality_required');
  const malformed = await adapter.searchHotels({ ...base, guestNationality: 'sg' });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error.code, 'guest_nationality_required');
});

test('target HOTEL RECORD and REPLAY share Nuitee normalization through the planning bridge', async () => {
  const searchRaw = JSON.parse(readFileSync('fixtures/recordings/nuitee/search/rec_1b93b06751de490f642638fdfce8408f.json', 'utf8')) as { raw: unknown };
  const quoteRaw = JSON.parse(readFileSync('fixtures/recordings/nuitee/quote/rec_093fc711f12a3f62bd3a2e823003ff4b.json', 'utf8')) as { raw: unknown };
  const writeDir = mkdtempSync(join(tmpdir(), 'a3-target-hotel-research-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const fetchImpl: typeof fetch = async (input) => new Response(
    JSON.stringify(String(input).includes('/rates/prebook') ? quoteRaw.raw : searchRaw.raw),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  const recorded = composeTargetHotelResearch(config('RECORD', { apiKey: 'test-key' }), process.cwd(), { recordingStore: store, fetchImpl });
  assert.ok(recorded);
  const search = await recorded.transport(request('hotel.search', {
    location: { coordinates: { latitude: 1.2839, longitude: 103.8607, radiusKm: 5 } },
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    guests: { adults: 1 },
    rooms: 1,
    guestNationality: 'SG',
  }));
  assert.equal(search.status, 'SUCCEEDED');
  assert.equal(search.provenance.mode, 'RECORD');
  const rates = (search.normalizedEvidence as { rates: Array<{ rateId: string; totalPrice: { amount: number } }> }).rates;
  assert.ok(rates.length > 0);
  const quote = await recorded.transport(request('hotel.quote', { rateId: rates[0]!.rateId }));
  assert.equal(quote.status, 'SUCCEEDED');
  assert.equal(quote.provenance.mode, 'RECORD');

  const replayed = composeTargetHotelResearch(config('REPLAY'), process.cwd(), { recordingStore: store });
  assert.ok(replayed);
  const replaySearch = await replayed.transport(request('hotel.search', {
    location: { coordinates: { latitude: 1.2839, longitude: 103.8607, radiusKm: 5 } },
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    guests: { adults: 1 },
    rooms: 1,
    guestNationality: 'SG',
  }));
  assert.equal(replaySearch.status, 'SUCCEEDED');
  assert.equal(replaySearch.provenance.mode, 'REPLAY');
  assert.deepEqual(replaySearch.normalizedEvidence, search.normalizedEvidence);
});
