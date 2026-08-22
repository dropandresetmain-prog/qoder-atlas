/**
 * I1 evidence — source/profile -> validated persistent Trip.
 *
 * Proves: generic bundle seeding through the frozen mutation path,
 * provenance retention, SQLite persistence across restart, all-or-nothing
 * rejection of invalid proposals, explicit-vs-latent preference precedence
 * survival, ingestion never mutating authoritative state directly, and the
 * Lane D Model Studio client wired onto Lane B's extraction seam with
 * fail-safe behavior for invalid/unconfigured model output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { preferencePrecedence } from '../src/domain/preferences.ts';
import type { MutationProposal } from '../src/operational/mutation.ts';
import { createSourceIngestionCapability } from '../src/ingest/pipeline.ts';
import { ModelStudioClient, ScriptedModelTransport } from '../src/intelligence/client.ts';
import {
  SqlitePreferenceStore,
  buildTripSnapshot,
  modelStudioExtractionClient,
  seedScenarioBundle,
} from '../src/app/index.ts';

const FIXTURES_ROOT = resolve('fixtures/scenarios');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'anchor-event-speaker');
const SCENARIO_B_DIR = join(FIXTURES_ROOT, 'corporate-tmc');

function createHarness(dbPath = ':memory:') {
  const db = openDatabase(dbPath);
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const snapshotDeps = { trips, entities, preferences, sources };
  return { db, trips, entities, sources, audit, preferences, mutations, snapshotDeps };
}

test('i1: both scenario bundles seed through the same generic validated path', async () => {
  const harness = createHarness();
  for (const dir of [SCENARIO_A_DIR, SCENARIO_B_DIR]) {
    const outcome = await seedScenarioBundle(
      { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
      dir,
    );
    const spec = loadScenario(dir);
    assert.equal(outcome.tripId, spec.trip.id);
    assert.ok(outcome.appliedOperationCount > 0);
    const trip = await harness.trips.getTrip(spec.trip.id);
    assert.ok(trip, `trip ${spec.trip.id} persisted`);
    assert.equal(trip!.elements.length, spec.trip.elements.length);
    // Version was bumped by the mutation service, not copied from the bundle.
    assert.ok(trip!.version >= 1);
  }
  assert.equal((await harness.trips.listTrips()).length, 2);
});

test('i1: provenance is retained — sources, raw content and audit trail persist', async () => {
  const harness = createHarness();
  const outcome = await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );
  const spec = loadScenario(SCENARIO_A_DIR);

  for (const source of spec.context.sources) {
    const record = await harness.sources.getSource(source.id);
    assert.ok(record, `source ${source.id} persisted`);
    assert.equal(record!.kind, source.kind);
    assert.equal(record!.authority, source.authority);
    if (source.contentRef) {
      const content = await harness.sources.getSourceContent(source.id);
      assert.ok(content && content.length > 0, `raw content stored for ${source.id}`);
    }
  }

  // Trip facts still cite their original sources.
  const trip = await harness.trips.getTrip(outcome.tripId);
  const element = trip!.elements.find((e) => e.elementKind === 'TRANSPORT_LEG');
  assert.ok(element && element.elementKind === 'TRANSPORT_LEG');
  const departure = element!.data.scheduledDeparture;
  assert.ok(departure && outcome.sourceIds.includes(departure.sourceId));

  const seeded = await harness.audit.query({ action: 'SCENARIO_SEEDED' });
  assert.equal(seeded.length, 1);
  const applied = await harness.audit.query({ action: 'MUTATION_APPLIED', subject: outcome.tripId });
  assert.ok(applied.length >= 1);
});

test('i1: snapshot reconstructs from persisted state with precedence-ordered preferences', async () => {
  const harness = createHarness();
  const outcome = await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );
  const spec = loadScenario(SCENARIO_A_DIR);
  const snapshot = await buildTripSnapshot(harness.snapshotDeps, outcome.tripId, spec.trip.updatedAt);

  assert.equal(snapshot.tripId, outcome.tripId);
  assert.equal(snapshot.tripVersion, (await harness.trips.getTrip(outcome.tripId))!.version);
  assert.deepEqual(snapshot.travellers.map((t) => t.id).sort(), [...spec.trip.travellerIds].sort());
  assert.ok(snapshot.places.length > 0);
  assert.ok(snapshot.constraints.length >= spec.constraints.length);
  assert.ok(snapshot.ruleSets.length > 0);
  if (spec.trip.anchorEventId) assert.ok(snapshot.anchorEvent);

  // Preference precedence survives integration: higher ranks first.
  assert.equal(snapshot.preferences.length, spec.context.preferences.length);
  for (let i = 1; i < snapshot.preferences.length; i += 1) {
    assert.ok(
      preferencePrecedence(snapshot.preferences[i - 1]!) >= preferencePrecedence(snapshot.preferences[i]!),
      'preferences must be ordered by descending precedence',
    );
  }

  // Source metadata only: referenced sources resolved, payloads absent.
  assert.ok(snapshot.sourceRecords.length > 0);
  for (const record of snapshot.sourceRecords) {
    assert.ok(outcome.sourceIds.includes(record.id));
    assert.equal((record as Record<string, unknown>)['content'], undefined);
  }
});

test('i1: trip, sources and preferences reload identically after restart', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-i1-restart-'));
  const dbPath = join(dbDir, 'app.sqlite');

  const first = createHarness(dbPath);
  const outcome = await seedScenarioBundle(
    { mutations: first.mutations, sources: first.sources, preferences: first.preferences, audit: first.audit },
    SCENARIO_A_DIR,
  );
  const spec = loadScenario(SCENARIO_A_DIR);
  const tripBefore = await first.trips.getTrip(outcome.tripId);
  const snapshotBefore = await buildTripSnapshot(first.snapshotDeps, outcome.tripId, spec.trip.updatedAt);
  const contentBefore = await first.sources.getSourceContent(outcome.sourceIds[0]!);
  first.db.close();

  // Full process-boundary simulation: brand-new database handle and repos.
  const second = createHarness(dbPath);
  const tripAfter = await second.trips.getTrip(outcome.tripId);
  assert.deepEqual(tripAfter, tripBefore);
  const snapshotAfter = await buildTripSnapshot(second.snapshotDeps, outcome.tripId, spec.trip.updatedAt);
  assert.deepEqual(snapshotAfter, snapshotBefore);
  assert.deepEqual(await second.sources.getSourceContent(outcome.sourceIds[0]!), contentBefore);
  assert.equal((await second.audit.query({ action: 'SCENARIO_SEEDED' })).length, 1);
  second.db.close();
});

test('i1: an invalid proposal mutates nothing (all-or-nothing)', async () => {
  const harness = createHarness();
  await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );
  const tripsBefore = await harness.trips.listTrips();

  const proposal: MutationProposal = {
    id: 'prop-i1-invalid',
    origin: 'AI',
    requestedAt: '2026-08-20T00:00:00Z',
    rationale: 'mixed valid/invalid operations must be rejected as a unit',
    operations: [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'PLACE',
        id: 'place_i1_valid',
        data: { id: 'place_i1_valid', kind: 'AIRPORT' },
      },
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRAVELLER',
        id: 'traveller_i1_invalid',
        // Missing required traveller fields — schema-invalid payload.
        data: { id: 'traveller_i1_invalid' },
      },
    ],
  };
  const outcome = await harness.mutations.applyProposal(proposal);
  assert.equal(outcome.accepted, false);
  assert.ok(outcome.issues.length > 0);

  // Neither the valid nor the invalid operation may have landed.
  assert.equal(await harness.entities.get('PLACE', 'place_i1_valid'), undefined);
  assert.equal(await harness.entities.get('TRAVELLER', 'traveller_i1_invalid'), undefined);
  assert.deepEqual(await harness.trips.listTrips(), tripsBefore);
  const rejected = await harness.audit.query({ action: 'MUTATION_REJECTED' });
  assert.ok(rejected.length >= 1);
});

test('i1: ingestion emits proposals/signals only — state changes only via MutationService', async () => {
  const harness = createHarness();
  const outcome = await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );
  const tripBefore = await harness.trips.getTrip(outcome.tripId);

  const ingestion = createSourceIngestionCapability({
    sourceRepository: harness.sources,
    context: { tripId: outcome.tripId },
    clock: () => '2026-08-20T06:00:00Z',
  });

  // Provider state: deterministic signal, never a direct state change.
  const providerState = await ingestion.ingest({
    kind: 'PROVIDER_STATE',
    title: 'provider flight state',
    structured: { schema: 'PROVIDER_FLIGHT_STATE', payload: { status: 'CANCELLED', occurredAt: '2026-08-20T05:55:00Z' } },
  });
  assert.ok(providerState.ok);
  if (providerState.ok) {
    assert.equal(providerState.data.signals.length, 1);
    assert.equal(providerState.data.signals[0]!.kind, 'FLIGHT_CANCELLATION');
    assert.equal(providerState.data.proposals.length, 0);
  }
  assert.deepEqual(await harness.trips.getTrip(outcome.tripId), tripBefore);

  // Structured booking confirmation: proposals only; applying them through
  // the mutation service is the sole path into authoritative state.
  const booking = await ingestion.ingest({
    kind: 'BOOKING_CONFIRMATION',
    title: 'replacement flight confirmation',
    structured: {
      schema: 'FLIGHT_BOOKING',
      payload: {
        carrierCode: 'XX',
        flightNumber: '123',
        origin: { code: 'AAA', timezone: 'UTC' },
        destination: { code: 'BBB', timezone: 'UTC' },
        departure: '2026-08-21T09:00:00Z',
        arrival: '2026-08-21T13:00:00Z',
        bookingReference: 'I1REF',
        bookingStatus: 'CONFIRMED',
      },
    },
  });
  assert.ok(booking.ok);
  if (!booking.ok) return;
  assert.ok(booking.data.proposals.length >= 1);
  for (const proposal of booking.data.proposals) {
    const applied = await harness.mutations.applyProposal(proposal);
    assert.equal(applied.accepted, true, `proposal ${proposal.id} must apply`);
  }
  const tripAfter = await harness.trips.getTrip(outcome.tripId);
  assert.equal(tripAfter!.elements.length, tripBefore!.elements.length + 1);
  const newElement = tripAfter!.elements.find((e) => !tripBefore!.elements.some((b) => b.id === e.id));
  assert.ok(newElement && newElement.elementKind === 'TRANSPORT_LEG');
  if (newElement!.elementKind === 'TRANSPORT_LEG') {
    // Provenance: the new fact cites the ingested source, not the pipeline.
    assert.equal(newElement!.data.scheduledDeparture!.sourceId, booking.data.sourceId);
    assert.equal(newElement!.data.bookingRef!.reference, 'I1REF');
  }
});

test('i1: Model Studio client serves Lane B extraction seam and fails safe', async () => {
  const validFlightJson = JSON.stringify({
    carrierCode: 'YY',
    flightNumber: '456',
    origin: { code: 'CCC' },
    destination: { code: 'DDD' },
    departure: '2026-08-22T08:00:00Z',
    arrival: '2026-08-22T11:30:00Z',
    bookingStatus: 'CONFIRMED',
  });

  // Valid scripted output passes the same validation as live output.
  const replayClient = new ModelStudioClient({ transport: new ScriptedModelTransport([validFlightJson]) });
  const replayExtraction = modelStudioExtractionClient(replayClient);
  const okResult = await replayExtraction.extract({
    task: 'FLIGHT_BOOKING',
    sourceKind: 'BOOKING_CONFIRMATION',
    content: 'confirmation text',
  });
  assert.ok(okResult.ok);

  // Malformed model output: structured failure, no throw, no guessing.
  const invalidClient = new ModelStudioClient({ transport: new ScriptedModelTransport(['this is not json']) });
  const invalidResult = await modelStudioExtractionClient(invalidClient).extract({
    task: 'FLIGHT_BOOKING',
    sourceKind: 'BOOKING_CONFIRMATION',
    content: 'confirmation text',
  });
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) assert.ok(invalidResult.reason.includes('INVALID_OUTPUT'));

  // Unconfigured client: credential-free REPLAY boot stays safe.
  const unconfigured = new ModelStudioClient({});
  const notConfigured = await modelStudioExtractionClient(unconfigured).extract({
    task: 'FLIGHT_BOOKING',
    sourceKind: 'BOOKING_CONFIRMATION',
    content: 'confirmation text',
  });
  assert.equal(notConfigured.ok, false);
  if (!notConfigured.ok) assert.ok(notConfigured.reason.includes('NOT_CONFIGURED'));

  // End-to-end through the pipeline: text source -> model seam -> proposals.
  const harness = createHarness();
  const seeded = await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );
  const pipelineClient = new ModelStudioClient({ transport: new ScriptedModelTransport([validFlightJson]) });
  const ingestion = createSourceIngestionCapability({
    extractionClient: modelStudioExtractionClient(pipelineClient),
    sourceRepository: harness.sources,
    context: { tripId: seeded.tripId },
    clock: () => '2026-08-20T07:00:00Z',
  });
  const result = await ingestion.ingest({
    kind: 'BOOKING_CONFIRMATION',
    title: 'emailed confirmation',
    content: 'Please find your flight confirmation attached...',
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.ok(result.data.proposals.length >= 1, 'text source must yield validated proposals via the model seam');
  }
});
