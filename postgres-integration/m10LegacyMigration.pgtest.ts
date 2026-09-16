/**
 * M10 Phases 4/6/7 — the AT23 migration slice against real PostgreSQL.
 *
 * Proves the whole mechanism end to end on one dataset rather than every
 * category horizontally:
 *
 *   read-only SQLite export -> deterministic dataset hash -> migration run
 *   -> target import through real commands -> legacy ID mappings -> a real
 *   evidence chain -> a deterministic successful mapping -> a quarantined
 *   ambiguity -> archived legacy constraint status -> CURRENT assessment
 *   recomputed by the real M6 evaluator -> same bundle re-imported ->
 *   idempotent, zero duplicated target state.
 *
 * Plus the failure paths that make the above trustworthy: a changed source
 * payload conflicts instead of overwriting, and an interrupted run resumes.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { exportLegacyDataset } from '../src/migration/legacyExporter.ts';
import {
  importLegacyBundle,
  LEGACY_CONSTRAINT_STATUS_ASSERTION,
  MIGRATION_PROVENANCE_ASSERTION,
  MigrationInterrupted,
} from '../src/migration/legacyImporter.ts';
import { readMigrationRun } from '../src/migration/migrationRunStore.ts';
import { recomputeMigratedState } from '../src/migration/recomputeMigratedState.ts';
import { reconcileMigration, renderReconciliationReport } from '../src/migration/reconcileMigration.ts';
import { collectUncertainSourceFacts } from '../src/migration/legacyUncertainty.ts';
import { currentAssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';

const CUTOFF = '2026-03-01T00:00:00Z';
const NOW = '2026-03-02T09:00:00Z';
const DATASET = 'legacy-deployment-at23';

const workDirs: string[] = [];

after(async () => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
  const pool = await sharedTestPool();
  await pool.end();
});

/**
 * A legacy dataset with the properties the slice needs to be meaningful:
 * one deterministically migratable single-traveller trip whose constraint
 * maps to a registered target evaluator type, and one multi-traveller trip
 * whose element ownership is genuinely unprovable.
 */
function buildLegacyDataset(options: { renameSingleTrip?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'm10-at23-'));
  workDirs.push(dir);
  const path = join(dir, 'legacy.db');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trips (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE cases (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE signals (id TEXT PRIMARY KEY, trip_id TEXT, occurred_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, retrieved_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE source_contents (source_id TEXT PRIMARY KEY, content TEXT NOT NULL);
    CREATE TABLE entities (entity_type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity_type, id));
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT, payload TEXT NOT NULL);
    CREATE TABLE preferences (id TEXT PRIMARY KEY, traveller_id TEXT, trip_id TEXT, data TEXT NOT NULL);
    CREATE TABLE fx_rates (rate_id TEXT PRIMARY KEY, base_currency TEXT NOT NULL, home_currency TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE booking_dossiers (traveller_id TEXT PRIMARY KEY, flight_data TEXT, hotel_data TEXT);
    CREATE TABLE provider_event_inbox (
      provider_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, received_at TEXT NOT NULL,
      raw_payload TEXT NOT NULL, processed_status TEXT, processed_outcome TEXT,
      PRIMARY KEY (provider_id, provider_event_id)
    );
  `);
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', '2');

  const entity = db.prepare('INSERT INTO entities (entity_type, id, data) VALUES (?, ?, ?)');
  // An explicit source-side home currency: the happy path must prove real
  // mapping, not a default. A second organisation below deliberately omits it.
  entity.run(
    'ORGANISATION',
    'org-legacy',
    JSON.stringify({ id: 'org-legacy', name: 'Legacy Operations Ltd', homeCurrency: 'SGD' }),
  );
  entity.run('TRAVELLER', 'trav-solo', JSON.stringify({ id: 'trav-solo', displayName: 'Solo Traveller' }));
  entity.run('TRAVELLER', 'trav-pair-a', JSON.stringify({ id: 'trav-pair-a', displayName: 'Pair Traveller A' }));
  entity.run('TRAVELLER', 'trav-pair-b', JSON.stringify({ id: 'trav-pair-b', displayName: 'Pair Traveller B' }));

  // Two places migrate; the third has no zone and must not get a guessed one.
  entity.run(
    'PLACE',
    'place-origin',
    JSON.stringify({ id: 'place-origin', name: 'Origin Airport', kind: 'AIRPORT', timezone: 'Europe/London' }),
  );
  entity.run(
    'PLACE',
    'place-venue',
    JSON.stringify({
      id: 'place-venue',
      name: 'Venue Hall',
      kind: 'VENUE',
      timezone: 'Europe/Lisbon',
      coordinates: { latitude: 38.7223, longitude: -9.1393 },
    }),
  );
  entity.run('PLACE', 'place-nozone', JSON.stringify({ id: 'place-nozone', name: 'Unknown Zone Site', kind: 'OTHER' }));

  entity.run(
    'ANCHOR_EVENT',
    'anchor-summit',
    JSON.stringify({
      id: 'anchor-summit',
      name: 'Annual Operations Summit',
      kind: 'CONFERENCE',
      placeId: 'place-venue',
      organiserOrganisationId: 'org-legacy',
      window: { startsAt: '2026-02-20T09:00:00Z', endsAt: '2026-02-20T17:00:00Z' },
      commitments: [
        {
          id: 'commit-keynote',
          anchorEventId: 'anchor-summit',
          title: 'Opening keynote',
          kind: 'SESSION',
          placeId: 'place-venue',
          startsAt: { value: '2026-02-20T09:00:00Z' },
          endsAt: { value: '2026-02-20T10:30:00Z' },
        },
        {
          // Start but no end: the target needs a bounded interval and must not
          // invent a duration.
          id: 'commit-openended',
          anchorEventId: 'anchor-summit',
          title: 'Evening reception',
          kind: 'SOCIAL',
          startsAt: { value: '2026-02-20T19:00:00Z' },
        },
      ],
    }),
  );

  entity.run(
    'RULE_SET',
    'rules-hotel',
    JSON.stringify({ id: 'rules-hotel', name: 'Hotel no-show policy', rules: [{ statement: 'no-show after 18:00 forfeits' }] }),
  );

  // Maps deterministically: TEMPORAL + minBufferMinutes is the arrival-readiness
  // buffer the legacy engine actually implemented.
  entity.run(
    'CONSTRAINT',
    'con-arrival',
    JSON.stringify({
      id: 'con-arrival',
      kind: 'TEMPORAL',
      hardness: 'HARD',
      evaluator: 'DETERMINISTIC',
      status: 'FAIL',
      description: 'arrival must precede the commitment with readiness buffer',
      refs: [{ entityType: 'TRIP_ELEMENT', id: 'el-solo-arrival' }],
      parameters: { minBufferMinutes: 90 },
    }),
  );
  // Does NOT map: no registered target type for a bare LOCATION constraint.
  entity.run(
    'CONSTRAINT',
    'con-location',
    JSON.stringify({
      id: 'con-location',
      kind: 'LOCATION',
      hardness: 'SOFT',
      evaluator: 'SEMANTIC',
      status: 'PASS',
      refs: [{ entityType: 'TRIP_ELEMENT', id: 'el-solo-arrival' }],
    }),
  );

  const trip = db.prepare('INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)');
  trip.run(
    'trip-solo',
    4,
    JSON.stringify({
      id: 'trip-solo',
      label: options.renameSingleTrip === true ? 'Solo trip renamed by an operator' : 'Solo trip',
      travellerIds: ['trav-solo'],
      operatorOrganisationId: 'org-legacy',
      elements: [
        {
          id: 'el-solo-arrival',
          tripId: 'trip-solo',
          elementKind: 'TRANSPORT_LEG',
          importance: 'CRITICAL',
          flexibility: 'FIXED',
          reservationState: 'CONFIRMED',
          status: 'VALID',
          data: {
            mode: 'AIR',
            originPlaceId: 'place-origin',
            destinationPlaceId: 'place-venue',
            scheduledDeparture: { value: '2026-02-19T07:00:00Z' },
            scheduledArrival: { value: '2026-02-19T09:30:00Z' },
            bookingRef: { system: 'atlas', reference: 'PNR123' },
            carrierRef: { system: 'iata', value: 'BA' },
          },
        },
        {
          // The supplier moved it and the legacy runtime never reconciled:
          // must land as UNKNOWN, never as CONFIRMED or CANCELLED.
          id: 'el-solo-stay',
          tripId: 'trip-solo',
          elementKind: 'STAY',
          importance: 'IMPORTANT',
          flexibility: 'FLEXIBLE',
          reservationState: 'CHANGED',
          status: 'UNKNOWN',
          data: {
            placeId: 'place-venue',
            checkIn: { value: '2026-02-19T15:00:00Z' },
            checkOut: { value: '2026-02-21T11:00:00Z' },
            bookingRef: { system: 'nuitee', reference: 'HTL-778' },
            guests: 1,
          },
        },
        {
          id: 'el-solo-onward',
          tripId: 'trip-solo',
          elementKind: 'TRANSPORT_LEG',
          importance: 'OPTIONAL',
          flexibility: 'FLEXIBLE',
          reservationState: 'NONE',
          status: 'UNKNOWN',
          data: { mode: 'ROAD', originPlaceId: 'place-venue', destinationPlaceId: 'place-origin' },
        },
      ],
      updatedAt: '2026-02-10T10:00:00Z',
    }),
    '2026-02-10T10:00:00Z',
  );
  trip.run(
    'trip-pair',
    2,
    JSON.stringify({
      id: 'trip-pair',
      label: 'Two travellers, unallocated elements',
      travellerIds: ['trav-pair-a', 'trav-pair-b'],
      elements: [
        { id: 'el-pair-flight', kind: 'FLIGHT' },
        { id: 'el-pair-stay', kind: 'STAY', guests: 2 },
      ],
      updatedAt: '2026-02-11T10:00:00Z',
    }),
    '2026-02-11T10:00:00Z',
  );

  db.prepare('INSERT INTO sources (id, kind, retrieved_at, data) VALUES (?, ?, ?, ?)').run(
    'src-operator-note',
    'OPERATOR',
    '2026-02-09T08:00:00Z',
    JSON.stringify({ id: 'src-operator-note', kind: 'OPERATOR', retrievedAt: '2026-02-09T08:00:00Z' }),
  );
  db.prepare('INSERT INTO source_contents (source_id, content) VALUES (?, ?)').run(
    'src-operator-note',
    'operator confirmed the solo itinerary by phone',
  );
  db.prepare('INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)').run(
    '2026-02-10T11:00:00Z',
    'operator:legacy',
    'TRIP_UPDATED',
    'trip-solo',
    JSON.stringify({ change: 'label' }),
  );

  db.prepare('INSERT INTO cases (id, trip_id, status, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'case-open',
    'trip-solo',
    'OPEN',
    3,
    JSON.stringify({ id: 'case-open', tripId: 'trip-solo', status: 'OPEN', trigger: 'flight delay' }),
    '2026-02-12T09:00:00Z',
  );
  db.prepare('INSERT INTO cases (id, trip_id, status, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'case-closed',
    'trip-solo',
    'RESOLVED',
    5,
    JSON.stringify({ id: 'case-closed', tripId: 'trip-solo', status: 'RESOLVED' }),
    '2026-02-08T09:00:00Z',
  );

  db.prepare('INSERT INTO signals (id, trip_id, occurred_at, data) VALUES (?, ?, ?, ?)').run(
    'sig-delay',
    'trip-solo',
    '2026-02-12T08:30:00Z',
    JSON.stringify({ id: 'sig-delay', tripId: 'trip-solo', kind: 'SCHEDULE_CHANGE' }),
  );

  const preference = db.prepare('INSERT INTO preferences (id, traveller_id, trip_id, data) VALUES (?, ?, ?, ?)');
  preference.run(
    'pref-explicit',
    'trav-solo',
    'trip-solo',
    JSON.stringify({
      id: 'pref-explicit',
      travellerId: 'trav-solo',
      statement: 'never rebook onto an overnight connection',
      origin: { kind: 'EXPLICIT_INSTRUCTION', issuedAt: '2026-01-05T09:00:00Z', issuedBy: 'trav-solo' },
    }),
  );
  preference.run(
    'pref-latent',
    'trav-solo',
    null,
    JSON.stringify({
      id: 'pref-latent',
      travellerId: 'trav-solo',
      statement: 'seems to favour aisle seats',
      origin: { kind: 'LATENT_INFERRED' },
    }),
  );

  db.prepare('INSERT INTO fx_rates (rate_id, base_currency, home_currency, data) VALUES (?, ?, ?, ?)').run(
    'fx-gbp-eur',
    'GBP',
    'EUR',
    JSON.stringify({ rateId: 'fx-gbp-eur', baseCurrency: 'GBP', homeCurrency: 'EUR', rate: '1.17' }),
  );

  db.prepare('INSERT INTO booking_dossiers (traveller_id, flight_data, hotel_data) VALUES (?, ?, ?)').run(
    'trav-solo',
    JSON.stringify({ passenger: 'SOLO/TRAVELLER', contactEmail: 'solo@example.invalid' }),
    JSON.stringify({ guestName: 'Solo Traveller', paymentRef: 'tok_legacy_9911' }),
  );

  const delivery = db.prepare(
    'INSERT INTO provider_event_inbox (provider_id, provider_event_id, received_at, raw_payload, processed_status, processed_outcome) VALUES (?, ?, ?, ?, ?, ?)',
  );
  delivery.run(
    'atlas',
    'evt-handled',
    '2026-02-12T08:31:00Z',
    JSON.stringify({ type: 'FLIGHT_DELAY', orderRef: 'PNR123' }),
    'PROCESSED',
    JSON.stringify({ signalId: 'sig-delay' }),
  );
  // Never finished processing: its effect on the world is genuinely unknown.
  delivery.run(
    'atlas',
    'evt-pending',
    '2026-02-13T04:00:00Z',
    JSON.stringify({ type: 'SCHEDULE_CHANGE', orderRef: 'PNR123' }),
    'PENDING',
    null,
  );

  db.close();
  return path;
}

function exportDataset(path: string) {
  return exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: DATASET,
    exportCutoff: CUTOFF,
    now: () => '2026-03-01T12:00:00Z',
  });
}

async function freshWorkspace(pool: Pool): Promise<{ workspaceId: string; actorId: string }> {
  const seed = await beginSeed(pool, 'M10 migration rehearsal');
  await commitSeed(seed);
  return { workspaceId: seed.workspaceId, actorId: seed.actorId };
}

async function countRows(pool: Pool, table: string, workspaceId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

let pool: Pool;

before(async () => {
  pool = await sharedTestPool();
});

test('AT23: legacy dataset migrates into PostgreSQL with real evidence, mappings and quarantine', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportDataset(buildLegacyDataset());

  const result = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.resumed, false);
  assert.equal(result.datasetHash, bundle.datasetHash);

  // --- The migration run is real bookkeeping, not a log line ---
  const run = await readMigrationRun(pool, result.runId);
  assert.equal(run.datasetHash, bundle.datasetHash);
  assert.equal(run.exporterVersion, bundle.exporterVersion);
  assert.equal(run.status, 'COMPLETED');

  // --- At least one deterministic successful mapping ---
  const mappings = await pool.query<{ source_type: string; source_id: string; target_kind: string; target_id: string; mapping_evidence: string }>(
    `SELECT source_type, source_id, target_kind, target_id, mapping_evidence FROM legacy_id_map
     WHERE workspace_id = $1 AND source_dataset = $2 ORDER BY source_type, source_id`,
    [workspaceId, DATASET],
  );
  const byKey = new Map(mappings.rows.map((row) => [`${row.source_type}/${row.source_id}`, row]));

  assert.ok(byKey.get('entities.ORGANISATION/org-legacy'), 'organisation mapped');
  assert.ok(byKey.get('entities.TRAVELLER/trav-solo'), 'solo traveller mapped');
  const soloTrip = byKey.get('trips/trip-solo');
  assert.ok(soloTrip, 'single-traveller trip mapped deterministically');
  assert.equal(soloTrip.target_kind, 'TRIP');
  const soloJourney = byKey.get('trips.journey/trip-solo');
  assert.ok(soloJourney, 'the single-traveller trip yielded exactly one Journey');
  assert.equal(soloJourney.target_kind, 'JOURNEY');

  // --- Real evidence chain, not a marker string ---
  const evidence = JSON.parse(soloTrip.mapping_evidence) as { evidenceId: string; datasetHash: string; sourceHash: string };
  assert.equal(evidence.datasetHash, bundle.datasetHash);
  const evidenceRow = await pool.query<{ assertion_type: string; interpretation_provenance: string }>(
    'SELECT assertion_type, interpretation_provenance FROM evidence_records WHERE workspace_id = $1 AND id = $2',
    [workspaceId, evidence.evidenceId],
  );
  assert.equal(evidenceRow.rows[0]?.assertion_type, MIGRATION_PROVENANCE_ASSERTION);
  assert.match(evidenceRow.rows[0]?.interpretation_provenance ?? '', new RegExp(bundle.datasetHash));
  const evidenceSources = await pool.query<{ source_record_id: string }>(
    'SELECT source_record_id FROM evidence_sources WHERE workspace_id = $1 AND evidence_record_id = $2',
    [workspaceId, evidence.evidenceId],
  );
  assert.equal(evidenceSources.rowCount, 1, 'the migration evidence cites the captured legacy dataset');

  // --- The multi-traveller trip is quarantined, never guessed ---
  assert.equal(byKey.has('trips/trip-pair'), false, 'no target state was invented for the ambiguous trip');
  const multiTraveller = run.reconciliationExceptions.find((entry) => entry.sourceId === 'trip-pair');
  assert.ok(multiTraveller, 'the multi-traveller trip is an owned exception');
  assert.equal(multiTraveller.classification, 'QUARANTINED_MULTI_TRAVELLER_ALLOCATION');
  assert.match(multiTraveller.reason, /cannot be proven from source evidence/);
  assert.equal(multiTraveller.blocksCutover, true);
  assert.ok(multiTraveller.owner.length > 0);
  assert.ok(multiTraveller.safetyImpact.length > 0);
  assert.ok(multiTraveller.affectedScope.includes('trav-pair-a'));

  // --- Legacy constraint status is archived as history, and the definition
  //     migrates only where a registered evaluator type exists ---
  const archived = await pool.query<{ interpretation_provenance: string }>(
    `SELECT interpretation_provenance FROM evidence_records
     WHERE workspace_id = $1 AND assertion_type = $2 ORDER BY interpretation_provenance`,
    [workspaceId, LEGACY_CONSTRAINT_STATUS_ASSERTION],
  );
  assert.equal(archived.rowCount, 2, 'both legacy constraint verdicts are archived, mappable or not');
  assert.ok(
    archived.rows.some((row) => /con-arrival held status FAIL/.test(row.interpretation_provenance)),
    'the legacy FAIL verdict is preserved verbatim as history',
  );

  const definitions = await pool.query<{ registered_type: string; hardness: string; owner_kind: string; owner_id: string }>(
    'SELECT registered_type, hardness, owner_kind, owner_id FROM constraint_definitions WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(definitions.rowCount, 1, 'only the constraint with a registered target type became a definition');
  assert.equal(definitions.rows[0]?.registered_type, 'programme_arrival_readiness_minutes');
  assert.equal(definitions.rows[0]?.owner_kind, 'JOURNEY');
  assert.equal(definitions.rows[0]?.owner_id, soloJourney.target_id);

  const unmapped = run.reconciliationExceptions.find((entry) => entry.sourceId === 'con-location');
  assert.ok(unmapped, 'the unmappable constraint is an owned exception');
  assert.equal(unmapped.classification, 'QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING');
  assert.match(unmapped.reason, /fabricate provenance/);

  // --- No legacy verdict leaked into assessments ---
  const assessmentsBefore = await countRows(pool, 'assessments', workspaceId);
  assert.equal(assessmentsBefore, 0, 'import alone creates no assessment: current truth is never migrated');

  // --- Current derived truth is recomputed by the real M6 evaluator ---
  const recompute = await recomputeMigratedState(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    runId: result.runId,
    sourceDataset: DATASET,
    now: NOW,
  });
  assert.equal(recompute.journeySubjects.length, 1);
  assert.equal(recompute.journeySubjects[0]?.id, soloJourney.target_id);
  assert.equal(recompute.assessments.length, 1);

  const view = await currentAssessmentView(
    pool,
    workspaceId,
    { kind: 'JOURNEY', id: soloJourney.target_id },
    'VIABILITY',
    NOW,
  );
  assert.equal(view.status, 'CURRENT', `migrated journey has a CURRENT assessment (${JSON.stringify(view.staleness)})`);
  assert.ok(view.assessment, 'the assessment is readable back through the product path');

  const recomputeValidation = (await readMigrationRun(pool, result.runId)).validations.find(
    (entry) => entry.check === 'DERIVED_STATE_RECOMPUTED',
  );
  assert.ok(recomputeValidation?.passed, 'the recompute is recorded on the migration run as evidence');
});

test('Phase 5: every deployed category lands as real state, archived history or an owned exception', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportDataset(buildLegacyDataset());
  const result = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });
  assert.equal(result.status, 'COMPLETED');

  const run = await readMigrationRun(pool, result.runId);
  const exceptionFor = (sourceId: string) =>
    run.reconciliationExceptions.find((entry) => entry.sourceId === sourceId);
  const mappings = await pool.query<{ source_type: string; source_id: string; target_kind: string; target_id: string }>(
    'SELECT source_type, source_id, target_kind, target_id FROM legacy_id_map WHERE workspace_id = $1 AND source_dataset = $2',
    [workspaceId, DATASET],
  );
  const byKey = new Map(mappings.rows.map((row) => [`${row.source_type}/${row.source_id}`, row]));
  const evidenceByType = async (assertionType: string) =>
    (
      await pool.query<{ interpretation_provenance: string }>(
        'SELECT interpretation_provenance FROM evidence_records WHERE workspace_id = $1 AND assertion_type = $2',
        [workspaceId, assertionType],
      )
    ).rows;

  // --- Geography: zoned places migrate, an unzoned one is never guessed ---
  assert.ok(byKey.get('entities.PLACE/place-origin'), 'a zoned place migrated');
  assert.equal(byKey.has('entities.PLACE/place-nozone'), false, 'no place was given an invented time zone');
  assert.match(exceptionFor('place-nozone')?.reason ?? '', /timezone/);

  // --- Programme: Event + synthesised Programme + items, with the
  //     unbounded commitment archived rather than given a fake duration ---
  assert.ok(byKey.get('entities.ANCHOR_EVENT/anchor-summit'), 'the anchor event migrated');
  const items = await pool.query<{ title: string; lifecycle_status: string; window_start: string | null }>(
    'SELECT title, lifecycle_status, window_start::text AS window_start FROM programme_items WHERE workspace_id = $1 ORDER BY title',
    [workspaceId],
  );
  assert.equal(items.rowCount, 2, 'both legacy commitments became programme items');
  const reception = items.rows.find((row) => row.title === 'Evening reception');
  assert.equal(reception?.window_start, null, 'no window was invented for the open-ended commitment');
  assert.equal(reception?.lifecycle_status, 'DRAFT', 'an unplaceable item is not reported as SCHEDULED');
  assert.equal(items.rows.find((row) => row.title === 'Opening keynote')?.lifecycle_status, 'SCHEDULED');
  assert.equal((await evidenceByType('LEGACY_PROGRAMME_ITEM_WINDOW')).length, 1);

  // --- Arrangements: obligations, statuses and provider refs survive ---
  const reservations = await pool.query<{ id: string; reservation_type: string; observed_status: string; observed_status_at: string | null }>(
    'SELECT id, reservation_type, observed_status, observed_status_at FROM reservations WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(reservations.rowCount, 2, 'both booked elements became reservations; the unbooked one did not');
  const transport = reservations.rows.find((row) => row.reservation_type === 'TRANSPORT');
  assert.equal(transport?.observed_status, 'CONFIRMED');
  assert.ok(transport?.observed_status_at, 'a known status carries the instant it was observed');

  // CHANGED is not CONFIRMED and not CANCELLED. It is not known.
  const stay = reservations.rows.find((row) => row.reservation_type === 'STAY');
  assert.equal(stay?.observed_status, 'UNKNOWN', 'an unreconciled supplier change stays unknown');
  assert.equal(stay?.observed_status_at, null, 'UNKNOWN carries no observation time');
  const changedException = run.reconciliationExceptions.find((entry) => /CHANGED/.test(entry.reason));
  assert.equal(changedException?.classification, 'PRESERVED_UNKNOWN_EXTERNAL_OUTCOME');

  const providerRefs = await evidenceByType('LEGACY_PROVIDER_BOOKING_REF');
  assert.equal(providerRefs.length, 2, 'both provider booking references are preserved');
  assert.ok(providerRefs.some((row) => /PNR123/.test(row.interpretation_provenance)));
  assert.equal((await evidenceByType('LEGACY_UNBOOKED_ELEMENT')).length, 1, 'the unbooked need is archived, not booked');

  // --- Cases: closed history archives quietly, open work is owned ---
  assert.equal((await evidenceByType('LEGACY_RECOVERY_CASE')).length, 2);
  const openCase = exceptionFor('case-open');
  assert.equal(openCase?.classification, 'ARCHIVED_NOT_REPLAYED_AS_LIVE_STATE');
  assert.equal(openCase?.blocksCutover, true, 'unfinished recovery work blocks cutover for its scope');
  assert.equal(exceptionFor('case-closed'), undefined, 'a resolved case needs no owner decision');
  assert.equal(await countRows(pool, 'recovery_cases', workspaceId), 0, 'no case was fabricated without lineage');

  // --- Signals archive with their real age and are never replayed ---
  const signals = await pool.query<{ observed_at: string }>(
    "SELECT observed_at::text FROM evidence_records WHERE workspace_id = $1 AND assertion_type = 'LEGACY_CHANGE_SIGNAL'",
    [workspaceId],
  );
  assert.equal(signals.rowCount, 1);
  assert.match(signals.rows[0]?.observed_at ?? '', /2026-02-12/, 'archived history keeps the age it actually has');

  // --- Preferences: explicit blocks cutover, latent does not ---
  assert.equal((await evidenceByType('LEGACY_PREFERENCE')).length, 2);
  assert.equal(exceptionFor('pref-explicit')?.blocksCutover, true);
  assert.equal(exceptionFor('pref-latent')?.blocksCutover, false);
  assert.equal(await countRows(pool, 'preferences', workspaceId), 0, 'no preference got an invented effective window');

  // --- Dossier PII is preserved but not activated without custody ---
  assert.equal(
    exceptionFor('trav-solo')?.classification,
    'ARCHIVED_REQUIRES_PROTECTED_CONTENT_STORE',
    'dossier content is owned, not silently dropped or faked into a ProtectedDataRef',
  );

  // --- Provider deliveries: settled ones settle, pending stays unknown ---
  assert.equal((await evidenceByType('LEGACY_PROVIDER_EVENT_DELIVERY')).length, 2);
  assert.equal(exceptionFor('atlas:evt-handled'), undefined);
  assert.equal(exceptionFor('atlas:evt-pending')?.classification, 'PRESERVED_UNKNOWN_EXTERNAL_OUTCOME');

  // --- FX and rule sets ---
  assert.equal((await evidenceByType('LEGACY_FX_RATE_OBSERVATION')).length, 1);
  assert.equal(exceptionFor('rules-hotel')?.classification, 'ARCHIVED_REQUIRES_TARGET_POLICY_INPUT');

  // --- Nothing was silently skipped ---
  assert.equal(run.progress.recordsDeferred, 0, 'every exported category has a handler');
});

test('Phase 5: reconciliation answers semantic questions and owns every exception', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportDataset(buildLegacyDataset());
  const importStartedAt = NOW;
  const result = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });
  await recomputeMigratedState(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    runId: result.runId,
    sourceDataset: DATASET,
    now: NOW,
  });

  const report = await reconcileMigration(pool, {
    workspaceId,
    runId: result.runId,
    bundle,
    now: NOW,
    importStartedAt,
  });

  const byId = new Map(report.checks.map((entry) => [entry.id, entry]));
  const statusOf = (id: string) => byId.get(id)?.status;

  // Nothing exported may disappear without a decision recorded about it.
  assert.equal(statusOf('IDENTITY_ACCOUNTED'), 'PASS', byId.get('IDENTITY_ACCOUNTED')?.detail);
  assert.equal(statusOf('JOURNEY_OWNERSHIP_PROVEN'), 'PASS');
  assert.equal(statusOf('PROVIDER_REFS_PRESERVED'), 'PASS', byId.get('PROVIDER_REFS_PRESERVED')?.detail);
  assert.equal(statusOf('EVIDENCE_LINEAGE_INTACT'), 'PASS', byId.get('EVIDENCE_LINEAGE_INTACT')?.detail);
  assert.equal(statusOf('OBLIGATIONS_COMPLETE'), 'PASS', byId.get('OBLIGATIONS_COMPLETE')?.detail);
  assert.equal(statusOf('UNCERTAINTY_PRESERVED'), 'PASS');
  assert.equal(statusOf('MONEY_ACCOUNTED'), 'PASS', byId.get('MONEY_ACCOUNTED')?.detail);
  assert.equal(statusOf('DERIVED_TRUTH_RECOMPUTED'), 'PASS', byId.get('DERIVED_TRUTH_RECOMPUTED')?.detail);
  assert.equal(statusOf('NO_PROVIDER_DISPATCH'), 'PASS', 'migration performed no external action');
  assert.equal(report.checks.filter((entry) => entry.status === 'FAIL').length, 0);

  // Known outstanding work is owned rather than hidden, so the verdict is
  // BLOCKED — the honest answer while a multi-traveller trip and an open case
  // remain unresolved.
  assert.equal(report.verdict, 'BLOCKED');
  assert.ok(report.totals.cutoverBlocking > 0);
  for (const entry of report.exceptions) {
    assert.ok(entry.owner.length > 0, `${entry.classification} names an owner`);
    assert.ok(entry.reason.length > 0);
    assert.ok(entry.affectedScope.length > 0);
    assert.ok(entry.safetyImpact.length > 0);
  }

  // Coverage is per category, and every category that exported anything has a
  // decision reflected in the numbers.
  const coverageFor = (categoryId: string) => report.coverage.find((entry) => entry.categoryId === categoryId);
  assert.ok((coverageFor('TRIP')?.mapped ?? 0) >= 1);
  assert.ok((coverageFor('SIGNAL')?.archived ?? 0) >= 1, 'signals are archived, not mapped as live state');
  assert.equal(coverageFor('TRIP')?.decision, 'MIGRATE_THEN_RECONCILE');
  assert.equal(coverageFor('RECOVERY_CASE')?.decision, 'ARCHIVE_AND_REGENERATE');

  const markdown = renderReconciliationReport(report);
  assert.match(markdown, /^# Migration reconciliation/);
  assert.match(markdown, /\*\*Verdict: BLOCKED\.\*\*/);
  assert.match(markdown, new RegExp(bundle.datasetHash));
  assert.match(markdown, /QUARANTINED_MULTI_TRAVELLER_ALLOCATION/);
  assert.match(markdown, /Blocks cutover:/);
});

test('AT23: re-importing the identical bundle is idempotent and duplicates nothing', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportDataset(buildLegacyDataset());

  const first = await importLegacyBundle(pool, { workspaceId, actorPrincipalId: actorId, bundle, now: () => NOW });
  assert.equal(first.status, 'COMPLETED');

  const snapshot = async () => ({
    travellers: await countRows(pool, 'travellers', workspaceId),
    trips: await countRows(pool, 'trips', workspaceId),
    journeys: await countRows(pool, 'journeys', workspaceId),
    organisations: await countRows(pool, 'organisations', workspaceId),
    constraints: await countRows(pool, 'constraint_definitions', workspaceId),
    mappings: await countRows(pool, 'legacy_id_map', workspaceId),
    evidence: await countRows(pool, 'evidence_records', workspaceId),
    sources: await countRows(pool, 'source_records', workspaceId),
  });
  const before = await snapshot();
  assert.ok(before.journeys >= 1);

  // The exact same bundle, re-presented.
  const second = await importLegacyBundle(pool, { workspaceId, actorPrincipalId: actorId, bundle, now: () => NOW });
  assert.equal(second.status, 'COMPLETED');
  assert.notEqual(second.runId, first.runId, 'a completed run is not reopened; replay is a new run');
  assert.equal(second.progress.recordsImported, 0, 'nothing was imported the second time');
  assert.ok(second.progress.recordsReplayed > 0, 'records were recognised as already imported');

  assert.deepEqual(await snapshot(), before, 'no target row was duplicated by the replay');
  assert.deepEqual(
    second.provenance,
    first.provenance,
    'the replay reuses the original provenance chain rather than minting a second one',
  );
});

test('AT23: the same source identity with a changed payload conflicts and never overwrites', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const original = exportDataset(buildLegacyDataset());
  const first = await importLegacyBundle(pool, { workspaceId, actorPrincipalId: actorId, bundle: original, now: () => NOW });
  assert.equal(first.status, 'COMPLETED');

  const tripPurposeBefore = await pool.query<{ purpose: string }>(
    'SELECT purpose FROM trips WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(tripPurposeBefore.rows[0]?.purpose, 'Solo trip');

  // Same legacy trip id, different content: an operator edited the source
  // after it was migrated.
  const changed = exportDataset(buildLegacyDataset({ renameSingleTrip: true }));
  assert.notEqual(changed.datasetHash, original.datasetHash);

  const second = await importLegacyBundle(pool, { workspaceId, actorPrincipalId: actorId, bundle: changed, now: () => NOW });
  assert.equal(second.status, 'FAILED', 'a run carrying an unresolved conflict does not report COMPLETED');
  assert.equal(second.progress.recordsConflicted, 1);

  const conflict = second.exceptions.find((entry) => entry.classification === 'CONFLICT_SOURCE_CHANGED_SINCE_IMPORT');
  assert.ok(conflict, 'the conflict is an owned exception');
  assert.equal(conflict.sourceId, 'trip-solo');
  assert.match(conflict.reason, /no target state was written/);
  assert.equal(conflict.blocksCutover, true);

  const tripPurposeAfter = await pool.query<{ purpose: string }>(
    'SELECT purpose FROM trips WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(tripPurposeAfter.rows[0]?.purpose, 'Solo trip', 'the already-imported version was not overwritten');
  assert.equal(await countRows(pool, 'trips', workspaceId), 1, 'and no second trip was created');
});

test('AT23: an interrupted import resumes without duplicating completed records', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportDataset(buildLegacyDataset());

  // Deterministic failure injection: die after two records, exactly as a
  // crashed process would, leaving the run IN_PROGRESS.
  const interrupted = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    failAfterRecords: 2,
    now: () => NOW,
  });
  assert.equal(interrupted.status, 'IN_PROGRESS');
  assert.equal(interrupted.progress.lastCompletedIndex, 1, 'progress records exactly what completed');
  const partialMappings = await countRows(pool, 'legacy_id_map', workspaceId);
  assert.ok(partialMappings > 0, 'the records that did complete are durably mapped');

  const resumed = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });
  assert.equal(resumed.resumed, true, 'the same run was adopted, not restarted');
  assert.equal(resumed.runId, interrupted.runId);
  assert.equal(resumed.status, 'COMPLETED');
  assert.equal(resumed.progress.recordsReplayed, 0, 'resume skipped completed records by progress, not by re-importing');

  // The end state matches a clean single-pass run.
  const cleanWorkspace = await freshWorkspace(pool);
  const clean = await importLegacyBundle(pool, {
    workspaceId: cleanWorkspace.workspaceId,
    actorPrincipalId: cleanWorkspace.actorId,
    bundle,
    now: () => NOW,
  });
  assert.equal(clean.status, 'COMPLETED');
  for (const table of ['travellers', 'trips', 'journeys', 'organisations', 'constraint_definitions', 'legacy_id_map']) {
    assert.equal(
      await countRows(pool, table, workspaceId),
      await countRows(pool, table, cleanWorkspace.workspaceId),
      `${table}: interrupted-then-resumed import matches a clean run exactly`,
    );
  }
  assert.equal(resumed.progress.recordsImported, clean.progress.recordsImported);
  assert.equal(resumed.progress.recordsQuarantined, clean.progress.recordsQuarantined);
});

test('MigrationInterrupted is a real interruption, not a swallowed error', () => {
  const error = new MigrationInterrupted(3);
  assert.equal(error.afterRecords, 3);
  assert.match(error.message, /interrupted after 3 record/);
});

// ---------------------------------------------------------------------------
// C5 blocker 1 — organisation currency is mapped, never invented
// ---------------------------------------------------------------------------

const CURRENCY_DATASET = 'legacy-deployment-currency';

/**
 * Three organisations that differ only in their currency evidence, plus a trip
 * that depends on the one which cannot migrate.
 *
 * The legacy field is `homeCurrency` and it is optional: absent genuinely means
 * the organisation had no home-currency normalisation. The target requires
 * `default_currency_code NOT NULL`, so absence cannot be migrated silently and
 * must not be defaulted.
 */
function buildCurrencyDataset(): string {
  const dir = mkdtempSync(join(tmpdir(), 'm10-currency-'));
  workDirs.push(dir);
  const path = join(dir, 'legacy.db');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entities (entity_type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity_type, id));
    CREATE TABLE trips (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', '2');

  const entity = db.prepare('INSERT INTO entities (entity_type, id, data) VALUES (?, ?, ?)');
  entity.run(
    'ORGANISATION',
    'org-sgd',
    JSON.stringify({ id: 'org-sgd', name: 'Singapore Operations Pte', homeCurrency: 'SGD' }),
  );
  // No homeCurrency at all: a legitimate legacy state, not corruption.
  entity.run('ORGANISATION', 'org-none', JSON.stringify({ id: 'org-none', name: 'No Currency Ltd' }));
  // Present but not a supported 3-letter code, so equally unmappable.
  entity.run(
    'ORGANISATION',
    'org-bad',
    JSON.stringify({ id: 'org-bad', name: 'Bad Currency Ltd', homeCurrency: 'sgd' }),
  );
  entity.run('TRAVELLER', 'trav-dep', JSON.stringify({ id: 'trav-dep', displayName: 'Dependent Traveller' }));

  // This trip's business context is the organisation that cannot migrate.
  db.prepare('INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'trip-dependent',
    1,
    JSON.stringify({
      id: 'trip-dependent',
      label: 'Trip scoped to an unmigratable organisation',
      travellerIds: ['trav-dep'],
      operatorOrganisationId: 'org-none',
      elements: [],
    }),
    '2026-02-01T00:00:00Z',
  );

  db.close();
  return path;
}

test('C5 blocker 1: legacy homeCurrency maps exactly, and a missing currency fails closed', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportLegacyDataset({
    sqlitePath: buildCurrencyDataset(),
    sourceIdentity: CURRENCY_DATASET,
    exportCutoff: CUTOFF,
    now: () => '2026-03-01T12:00:00Z',
  });

  const result = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });
  assert.equal(result.status, 'COMPLETED');

  // --- 1. The organisation that had a currency maps it exactly ---
  const orgs = await pool.query<{ legal_name: string; default_currency_code: string }>(
    'SELECT legal_name, default_currency_code FROM organisations WHERE workspace_id = $1 ORDER BY legal_name',
    [workspaceId],
  );
  assert.equal(orgs.rowCount, 1, 'only the organisation with a defensible currency migrated');
  assert.equal(orgs.rows[0]?.legal_name, 'Singapore Operations Pte');
  assert.equal(orgs.rows[0]?.default_currency_code, 'SGD', 'legacy homeCurrency SGD became default_currency_code');

  // --- 2. Nothing was defaulted to USD, which is the actual C5 blocker ---
  const fabricated = await pool.query(
    `SELECT 1 FROM organisations WHERE workspace_id = $1 AND default_currency_code = 'USD'`,
    [workspaceId],
  );
  assert.equal(fabricated.rowCount, 0, 'no organisation was created with a fabricated USD currency');

  // --- 3. Both unmappable organisations are owned exceptions, not silence ---
  const run = await readMigrationRun(pool, result.runId);
  const currencyExceptions = run.reconciliationExceptions.filter(
    (entry) => entry.classification === 'ARCHIVED_REQUIRES_TARGET_POLICY_INPUT' && entry.sourceType === 'entities.ORGANISATION',
  );
  assert.equal(currencyExceptions.length, 2, 'the absent and the invalid currency each raise their own exception');
  for (const exception of currencyExceptions) {
    assert.ok(exception.blocksCutover, 'an organisation nothing can be scoped to blocks its own cutover');
    assert.ok(exception.owner.length > 0, 'the exception names an owner');
    assert.ok(exception.affectedScope.includes('organisation'), 'the exception names its scope');
    assert.ok(exception.safetyImpact.length > 0, 'the exception states the safety impact');
  }
  assert.ok(
    currencyExceptions.some((entry) => entry.sourceId === 'org-none' && /no homeCurrency/.test(entry.reason)),
    'the absent-currency reason names the real legacy field',
  );
  assert.ok(
    currencyExceptions.some((entry) => entry.sourceId === 'org-bad' && /not a supported 3-letter/.test(entry.reason)),
    'the invalid-currency reason explains why it cannot map',
  );

  // --- 4. Source lineage survives for what did not migrate ---
  const archived = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM evidence_records
     WHERE workspace_id = $1 AND assertion_type = 'LEGACY_ORGANISATION'`,
    [workspaceId],
  );
  assert.equal(Number(archived.rows[0]?.count), 2, 'each unmigrated organisation is archived as evidence, not dropped');

  // --- 5. A dependent record fails safely and explicitly ---
  const dependent = run.reconciliationExceptions.find((entry) => entry.sourceId === 'trip-dependent');
  assert.ok(dependent, 'the trip scoped to the unmigratable organisation raised an exception');
  assert.equal(dependent.classification, 'QUARANTINED_AMBIGUOUS_IDENTITY');
  assert.ok(dependent.blocksCutover, 'it blocks cutover rather than migrating without its business party');
  const trips = await pool.query('SELECT 1 FROM trips WHERE workspace_id = $1', [workspaceId]);
  assert.equal(trips.rowCount, 0, 'the dependent trip was not attached to invented state');

  // --- 6. Replay stays deterministic and idempotent ---
  const replay = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });
  assert.equal(replay.status, 'COMPLETED');
  assert.equal(replay.datasetHash, bundle.datasetHash, 'the same source yields the same dataset identity');
  const orgsAfter = await countRows(pool, 'organisations', workspaceId);
  assert.equal(orgsAfter, 1, 'replay duplicated nothing');
  const archivedAfter = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM evidence_records
     WHERE workspace_id = $1 AND assertion_type = 'LEGACY_ORGANISATION'`,
    [workspaceId],
  );
  assert.equal(Number(archivedAfter.rows[0]?.count), 2, 'replay re-archived nothing');
});

// ---------------------------------------------------------------------------
// C5 blocker 2 — UNCERTAINTY_PRESERVED can actually fail
// ---------------------------------------------------------------------------

test('C5 blocker 2: falsely resolving a migrated UNKNOWN makes UNCERTAINTY_PRESERVED fail', async () => {
  const { workspaceId, actorId } = await freshWorkspace(pool);
  const bundle = exportDataset(buildLegacyDataset());
  const importStartedAt = NOW;

  const result = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => NOW,
  });
  assert.equal(result.status, 'COMPLETED');
  await recomputeMigratedState(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    runId: result.runId,
    sourceDataset: DATASET,
    now: NOW,
  });

  // --- The source really does contain uncertainty to preserve ---
  const uncertain = collectUncertainSourceFacts(bundle);
  assert.ok(uncertain.length > 0, 'the fixture carries at least one uncertain source fact');
  assert.ok(
    uncertain.some((fact) => fact.kind === 'RESERVATION_OUTCOME' && fact.legacyValue === 'CHANGED'),
    'a legacy CHANGED reservation is classified as uncertain',
  );

  // --- Happy path: migration preserved it, so the check passes ---
  const before = await reconcileMigration(pool, {
    workspaceId,
    runId: result.runId,
    bundle,
    now: NOW,
    importStartedAt,
  });
  const passing = before.checks.find((entry) => entry.id === 'UNCERTAINTY_PRESERVED');
  assert.ok(passing);
  assert.equal(passing.status, 'PASS', 'uncertainty is genuinely preserved by the import');

  // --- Now falsely resolve the unknown, exactly what must never pass ---
  const unknownLine = await pool.query<{ id: string; reservation_id: string }>(
    `SELECT id, reservation_id FROM reservation_lines
     WHERE workspace_id = $1 AND observed_status = 'UNKNOWN' LIMIT 1`,
    [workspaceId],
  );
  assert.equal(unknownLine.rowCount, 1, 'the migrated uncertain element left an UNKNOWN line to tamper with');
  const evidence = await pool.query<{ id: string }>(
    'SELECT id FROM evidence_records WHERE workspace_id = $1 LIMIT 1',
    [workspaceId],
  );
  // The table's CHECK constraints require a time and evidence for a known
  // status, so a false resolution has to look superficially complete — which
  // is precisely why reconciliation cannot rely on the row looking plausible.
  await pool.query(
    `UPDATE reservation_lines
     SET observed_status = 'CONFIRMED', observed_status_at = $3, observation_evidence_id = $4
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, unknownLine.rows[0]?.id, NOW, evidence.rows[0]?.id],
  );

  const after = await reconcileMigration(pool, {
    workspaceId,
    runId: result.runId,
    bundle,
    now: NOW,
    importStartedAt,
  });
  const failing = after.checks.find((entry) => entry.id === 'UNCERTAINTY_PRESERVED');
  assert.ok(failing);
  assert.equal(failing.status, 'FAIL', 'resolving an unknown the source never observed must fail the check');
  assert.match(failing.detail, /resolved to a status the source never observed/);
  assert.equal(after.verdict, 'BLOCKED', 'a failed semantic check blocks the verdict');
});
