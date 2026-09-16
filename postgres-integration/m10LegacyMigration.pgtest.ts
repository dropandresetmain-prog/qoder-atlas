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
  `);
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', '2');

  const entity = db.prepare('INSERT INTO entities (entity_type, id, data) VALUES (?, ?, ?)');
  entity.run('ORGANISATION', 'org-legacy', JSON.stringify({ id: 'org-legacy', name: 'Legacy Operations Ltd' }));
  entity.run('TRAVELLER', 'trav-solo', JSON.stringify({ id: 'trav-solo', displayName: 'Solo Traveller' }));
  entity.run('TRAVELLER', 'trav-pair-a', JSON.stringify({ id: 'trav-pair-a', displayName: 'Pair Traveller A' }));
  entity.run('TRAVELLER', 'trav-pair-b', JSON.stringify({ id: 'trav-pair-b', displayName: 'Pair Traveller B' }));

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
      elements: [{ id: 'el-solo-arrival', kind: 'FLIGHT' }],
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
