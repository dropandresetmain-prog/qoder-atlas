#!/usr/bin/env node
/**
 * M10 / C5 — backup + restore rehearsal for migrated target state.
 *
 * Proves that a real migrated PostgreSQL target survives a dump, a genuine
 * destruction of the database, and a restore — with migration identity intact,
 * not merely "some rows came back".
 *
 * Why this script stands up its OWN database: the shared integration instance
 * (docker-compose.postgres-test.yml, northstar-postgres-test) mounts `tmpfs`
 * over /var/lib/postgresql/data. A restore into a non-durable, RAM-backed data
 * directory is not restore evidence, and other worktrees run tests against that
 * container concurrently. So this rehearsal creates a distinct container on a
 * distinct port over a NAMED DOCKER VOLUME, and never touches the shared one.
 *
 * Everything downstream of the container is the repo's own code: `runMigrations`
 * builds the schema, and the dataset is produced by driving the real migration
 * tooling (`exportLegacyDataset` -> `importLegacyBundle` ->
 * `recomputeMigratedState`) over a throwaway SQLite fixture. No hand-written
 * target rows, because a hand-written row proves nothing about the migration.
 *
 * Exit 0 = every named check passed, 1 = at least one failed. The full check
 * output is also written to docs/refactor/evidence/m10-backup-restore-output.txt
 * so the run is preserved as C5 evidence.
 *
 * Usage:
 *   node scripts/m10-cutover-and-restore-rehearsal.mjs
 *   $env:M10_KEEP_RESTORE_ENV = '1'   # leave the container+volume up afterwards
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Isolated instance identity — deliberately distinct from the shared one
// ---------------------------------------------------------------------------

const CONTAINER_NAME = 'northstar-postgres-m10-restore';
const VOLUME_NAME = 'northstar-m10-restore-data';
const IMAGE = 'postgis/postgis:16-3.4';
const DATA_DIR = '/var/lib/postgresql/data';
const HOST = '127.0.0.1';
const PORT = process.env.M10_RESTORE_PORT ?? '55433';
const DB = 'northstar_m10_restore';
const DB_USER = 'northstar_m10_restore';
const DB_PASSWORD = 'northstar_m10_restore';
const DUMP_PATH_IN_CONTAINER = '/tmp/m10-target.dump';

// The app's migration runner and every repository read their connection from
// `PG_TARGET_*`/`PGTEST_*` (src/persistence/postgres/config.ts). Setting the
// PG_TARGET_* tier — which config.ts checks first — points the repo's own code
// at THIS instance and overrides any PGTEST_* the operator's shell already has
// aimed at the shared tmpfs container.
process.env.PG_TARGET_HOST = HOST;
process.env.PG_TARGET_PORT = PORT;
process.env.PG_TARGET_DATABASE = DB;
process.env.PG_TARGET_USER = DB_USER;
process.env.PG_TARGET_PASSWORD = DB_PASSWORD;

const { loadPostgresTargetConfig } = await import('../src/persistence/postgres/config.ts');
const { createTargetPool } = await import('../src/persistence/postgres/pool.ts');
const { runMigrations } = await import('../src/persistence/postgres/migrate.ts');
const { exportLegacyDataset } = await import('../src/migration/legacyExporter.ts');
const { importLegacyBundle } = await import('../src/migration/legacyImporter.ts');
const { recomputeMigratedState } = await import('../src/migration/recomputeMigratedState.ts');
const { reconcileMigration, renderReconciliationReport } = await import('../src/migration/reconcileMigration.ts');

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../src/persistence/postgres/migrations/', import.meta.url),
);
const RECONCILIATION_MD = fileURLToPath(
  new URL('../docs/refactor/evidence/m10-reconciliation-report.md', import.meta.url),
);
const RECONCILIATION_JSON = fileURLToPath(
  new URL('../docs/refactor/evidence/m10-reconciliation-report.json', import.meta.url),
);

const OUTPUT_FILE = fileURLToPath(
  new URL('../docs/refactor/evidence/m10-backup-restore-output.txt', import.meta.url),
);

/** Throwaway fixture dataset identity — never a deployment name. */
const DATASET = 'legacy-deployment-m10-restore-rehearsal';
const EXPORT_CUTOFF = '2026-03-01T00:00:00Z';
const IMPORT_NOW = '2026-03-02T09:00:00Z';

/** Domain tables whose migrated row counts must survive the restore byte-for-byte. */
const DOMAIN_TABLES = Object.freeze([
  'organisations',
  'travellers',
  'trips',
  'journeys',
  'constraint_definitions',
  'evidence_records',
  'source_records',
]);

// ---------------------------------------------------------------------------
// Output capture — every line goes to stdout AND the evidence file
// ---------------------------------------------------------------------------

const transcript = [];

function say(line = '') {
  transcript.push(line);
  console.log(line);
}

function flushTranscript() {
  mkdirSync(join(OUTPUT_FILE, '..'), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${transcript.join('\n')}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Process + docker helpers
// ---------------------------------------------------------------------------

function exec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function execOrThrow(command, args) {
  const result = exec(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`.trim(),
    );
  }
  return result;
}

function docker(args) {
  return exec('docker', args);
}

function dockerOrThrow(args) {
  return execOrThrow('docker', args);
}

/** Remove any leftovers from an earlier interrupted rehearsal. Our names only. */
function removeIsolatedInstance() {
  docker(['rm', '-f', CONTAINER_NAME]);
  docker(['volume', 'rm', '-f', VOLUME_NAME]);
}

function startIsolatedInstance() {
  dockerOrThrow(['volume', 'create', VOLUME_NAME]);
  dockerOrThrow([
    'run',
    '-d',
    '--name',
    CONTAINER_NAME,
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e',
    `POSTGRES_DB=${DB}`,
    '-p',
    `${HOST}:${PORT}:5432`,
    '-v',
    `${VOLUME_NAME}:${DATA_DIR}`,
    IMAGE,
  ]);
}

/**
 * Confirms the data directory really is a named volume. A rehearsal that
 * silently ran on tmpfs would report PASS while proving nothing, so the
 * durability property is asserted rather than assumed from the run flags.
 */
function describeStorage() {
  const inspected = dockerOrThrow([
    'inspect',
    '-f',
    '{{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}} {{end}}tmpfs={{.HostConfig.Tmpfs}}',
    CONTAINER_NAME,
  ]).stdout;
  const [mounts, tmpfs = ''] = inspected.split('tmpfs=');
  const volumeBacked = mounts.includes(`volume:${VOLUME_NAME}:${DATA_DIR}`);
  return { inspected, durable: volumeBacked && !tmpfs.includes(DATA_DIR) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The postgres/postgis images run init scripts against a TEMPORARY server, stop
 * it, then exec the real one — so a single successful ping can be the dying
 * temporary server. Same approach as postgres-integration/harness.ts: a
 * throwaway Client per attempt (never a possibly-dead pooled connection) and two
 * consecutive successes ~1s apart before the server is called stable.
 */
async function waitUntilReady(config, maxAttempts = 60) {
  let consecutiveSuccesses = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: false,
      connectionTimeoutMillis: 2000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= 2) return attempt;
    } catch {
      consecutiveSuccesses = 0;
    } finally {
      await client.end().catch(() => undefined);
    }
    await sleep(1000);
  }
  throw new Error(
    `PostgreSQL at ${config.host}:${config.port}/${config.database} did not stabilize after ${maxAttempts} attempts`,
  );
}

// ---------------------------------------------------------------------------
// Throwaway legacy fixture
// ---------------------------------------------------------------------------

const tempDirs = [];

/**
 * A minimal legacy SQLite dataset with the two properties the rehearsal needs:
 * one single-traveller trip that migrates deterministically (and whose TEMPORAL
 * constraint maps to a registered target evaluator, so there is derived state to
 * recompute), and one multi-traveller trip whose element ownership is unprovable
 * and therefore quarantined. Mirrors the table DDL exercised by
 * postgres-integration/m10LegacyMigration.pgtest.ts.
 */
function buildLegacyFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'm10-restore-'));
  tempDirs.push(dir);
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
  // Explicit source-side home currency: the rehearsal must prove real currency
  // mapping rather than a fabricated default.
  entity.run(
    'ORGANISATION',
    'org-fixture',
    JSON.stringify({ id: 'org-fixture', name: 'Fixture Operator Ltd', homeCurrency: 'SGD' }),
  );
  entity.run('TRAVELLER', 'trav-single', JSON.stringify({ id: 'trav-single', displayName: 'Fixture Traveller One' }));
  entity.run('TRAVELLER', 'trav-multi-a', JSON.stringify({ id: 'trav-multi-a', displayName: 'Fixture Traveller Two' }));
  entity.run('TRAVELLER', 'trav-multi-b', JSON.stringify({ id: 'trav-multi-b', displayName: 'Fixture Traveller Three' }));

  // Zoned places, so the booked leg below has real endpoints and the
  // reconciliation's provider/obligation checks are not vacuous.
  entity.run(
    'PLACE',
    'place-depart',
    JSON.stringify({ id: 'place-depart', name: 'Fixture Departure Airport', kind: 'AIRPORT', timezone: 'Europe/London' }),
  );
  entity.run(
    'PLACE',
    'place-arrive',
    JSON.stringify({ id: 'place-arrive', name: 'Fixture Arrival Airport', kind: 'AIRPORT', timezone: 'Europe/Lisbon' }),
  );

  // TEMPORAL + minBufferMinutes maps to a registered target constraint type, so
  // the migrated Journey has something for the real evaluator to assess.
  entity.run(
    'CONSTRAINT',
    'con-buffer',
    JSON.stringify({
      id: 'con-buffer',
      kind: 'TEMPORAL',
      hardness: 'HARD',
      evaluator: 'DETERMINISTIC',
      status: 'FAIL',
      description: 'arrival must precede the commitment with a readiness buffer',
      refs: [{ entityType: 'TRIP_ELEMENT', id: 'el-single-arrival' }],
      parameters: { minBufferMinutes: 90 },
    }),
  );

  const trip = db.prepare('INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)');
  trip.run(
    'trip-single',
    3,
    JSON.stringify({
      id: 'trip-single',
      label: 'Single-traveller fixture trip',
      travellerIds: ['trav-single'],
      operatorOrganisationId: 'org-fixture',
      elements: [
        {
          id: 'el-single-arrival',
          tripId: 'trip-single',
          elementKind: 'TRANSPORT_LEG',
          importance: 'CRITICAL',
          flexibility: 'FIXED',
          reservationState: 'CONFIRMED',
          status: 'VALID',
          data: {
            mode: 'AIR',
            originPlaceId: 'place-depart',
            destinationPlaceId: 'place-arrive',
            scheduledDeparture: { value: '2026-02-19T07:00:00Z' },
            scheduledArrival: { value: '2026-02-19T09:30:00Z' },
            bookingRef: { system: 'atlas', reference: 'FIXTURE-PNR-1' },
            carrierRef: { system: 'iata', value: 'ZZ' },
          },
        },
        {
          // CHANGED: the supplier moved this and the legacy runtime never
          // reconciled it. Present so the rehearsal's UNCERTAINTY_PRESERVED
          // check has real uncertainty to account for rather than passing
          // over an empty set.
          id: 'el-single-return',
          tripId: 'trip-single',
          elementKind: 'TRANSPORT_LEG',
          importance: 'CRITICAL',
          flexibility: 'CHANGEABLE',
          reservationState: 'CHANGED',
          status: 'UNKNOWN',
          data: {
            mode: 'AIR',
            originPlaceId: 'place-arrive',
            destinationPlaceId: 'place-depart',
            scheduledDeparture: { value: '2026-02-22T18:00:00Z' },
            scheduledArrival: { value: '2026-02-22T20:30:00Z' },
            bookingRef: { system: 'atlas', reference: 'FIXTURE-PNR-2' },
            carrierRef: { system: 'iata', value: 'ZZ' },
          },
        },
      ],
      updatedAt: '2026-02-10T10:00:00Z',
    }),
    '2026-02-10T10:00:00Z',
  );
  trip.run(
    'trip-multi',
    2,
    JSON.stringify({
      id: 'trip-multi',
      label: 'Multi-traveller fixture trip with unallocated elements',
      travellerIds: ['trav-multi-a', 'trav-multi-b'],
      elements: [
        { id: 'el-multi-transport', kind: 'FLIGHT' },
        { id: 'el-multi-stay', kind: 'STAY', guests: 2 },
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
    'operator confirmed the single-traveller itinerary',
  );
  db.prepare('INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)').run(
    '2026-02-10T11:00:00Z',
    'operator:fixture',
    'TRIP_UPDATED',
    'trip-single',
    JSON.stringify({ change: 'label' }),
  );

  db.close();
  return path;
}

// ---------------------------------------------------------------------------
// Target-state snapshot
// ---------------------------------------------------------------------------

async function countRows(pool, table, workspaceId) {
  const result = await pool.query(
    `SELECT count(*)::text AS count FROM ${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

/** Everything the restore has to reproduce exactly. */
async function snapshotMigratedState(pool, workspaceId, runId) {
  const mappings = await pool.query(
    `SELECT source_dataset, source_type, source_id, target_kind, target_id::text AS target_id
       FROM legacy_id_map
      WHERE workspace_id = $1
      ORDER BY source_type, source_id`,
    [workspaceId],
  );
  const run = await pool.query(
    `SELECT id::text AS id, dataset_hash, exporter_version, importer_version, status,
            reconciliation_exceptions::text AS reconciliation_exceptions
       FROM migration_runs WHERE id = $1`,
    [runId],
  );
  const runRow = run.rows[0];
  if (runRow === undefined) throw new Error(`migration run ${runId} not readable before backup`);
  const exceptions = JSON.parse(runRow.reconciliation_exceptions);

  const counts = {};
  for (const table of DOMAIN_TABLES) counts[table] = await countRows(pool, table, workspaceId);

  return {
    mappings: mappings.rows.map(
      (row) =>
        `${row.source_dataset}|${row.source_type}|${row.source_id}|${row.target_kind}|${row.target_id}`,
    ),
    run: {
      id: runRow.id,
      datasetHash: runRow.dataset_hash,
      exporterVersion: runRow.exporter_version,
      importerVersion: runRow.importer_version,
      status: runRow.status,
      exceptionCount: exceptions.length,
      classifications: exceptions.map((entry) => entry.classification).sort(),
    },
    counts,
    assessments: await countRows(pool, 'assessments', workspaceId),
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed, detail });
  say(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}


function summarise() {
  const nameWidth = Math.max(...checks.map((entry) => entry.name.length), 6);
  say();
  say('SUMMARY');
  say(`${'check'.padEnd(nameWidth)}  result`);
  say(`${'-'.repeat(nameWidth)}  ------`);
  for (const entry of checks) {
    say(`${entry.name.padEnd(nameWidth)}  ${entry.passed ? 'PASS' : 'FAIL'}`);
  }
  const failed = checks.filter((entry) => !entry.passed);
  say();
  say(
    failed.length === 0
      ? `VERDICT: PASS — ${checks.length}/${checks.length} checks passed; migrated target state survived backup, destruction and restore`
      : `VERDICT: FAIL — ${failed.length}/${checks.length} check(s) failed: ${failed.map((entry) => entry.name).join(', ')}`,
  );
  return failed.length === 0;
}

// ---------------------------------------------------------------------------
// Rehearsal
// ---------------------------------------------------------------------------

async function rehearse() {
  const config = loadPostgresTargetConfig();

  say('M10 / C5 backup + restore rehearsal');
  say(`started at            ${new Date().toISOString()}`);
  say(`isolated container    ${CONTAINER_NAME} (${IMAGE})`);
  say(`isolated endpoint     ${config.host}:${config.port}/${config.database}`);
  say(`named docker volume   ${VOLUME_NAME} -> ${DATA_DIR}`);
  say('shared tmpfs instance northstar-postgres-test: untouched by this script');
  say();

  // --- 1. isolated, volume-backed instance ---------------------------------
  removeIsolatedInstance();
  startIsolatedInstance();
  const storage = describeStorage();
  check(
    'isolated_instance_is_volume_backed',
    storage.durable,
    `container mounts: ${storage.inspected}`,
  );
  const attempts = await waitUntilReady(config);
  say(`server stable after ${attempts} readiness attempt(s) (two consecutive connections required)`);

  let pool = createTargetPool(config);

  // --- 2. schema via the repo's own runner ---------------------------------
  const migrated = await runMigrations(pool, MIGRATIONS_DIR);
  say(`runMigrations applied ${migrated.applied.length} migration(s) from src/persistence/postgres/migrations/`);

  // --- 3. seed by driving the real migration tooling -----------------------
  const workspaceId = await (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO workspaces (id, name) VALUES (gen_random_uuid(), $1) RETURNING id::text AS id',
        ['M10 backup/restore rehearsal'],
      );
      await client.query('COMMIT');
      return created.rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })();
  const actorId = 'principal:m10-restore-rehearsal';
  say(`workspace ${workspaceId} created (actor ${actorId})`);

  const bundle = exportLegacyDataset({
    sqlitePath: buildLegacyFixture(),
    sourceIdentity: DATASET,
    exportCutoff: EXPORT_CUTOFF,
    now: () => '2026-03-01T12:00:00Z',
  });
  say(`exportLegacyDataset produced datasetHash ${bundle.datasetHash} (${bundle.exporterVersion})`);

  const imported = await importLegacyBundle(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    bundle,
    now: () => IMPORT_NOW,
  });
  if (imported.status !== 'COMPLETED') {
    throw new Error(`import did not complete: ${imported.status} ${JSON.stringify(imported.progress)}`);
  }
  say(
    `importLegacyBundle run ${imported.runId}: imported=${imported.progress.recordsImported} ` +
      `quarantined=${imported.progress.recordsQuarantined} deferred=${imported.progress.recordsDeferred} ` +
      `exceptions=${imported.exceptions.length}`,
  );

  const recompute = await recomputeMigratedState(pool, {
    workspaceId,
    actorPrincipalId: actorId,
    runId: imported.runId,
    sourceDataset: DATASET,
    now: IMPORT_NOW,
  });
  if (recompute.assessments.length === 0) {
    throw new Error('recomputeMigratedState produced no assessment, so there is nothing to prove about restore');
  }
  const witnessAssessmentId = recompute.assessments[0].assessmentId;
  say(
    `recomputeMigratedState assessed ${recompute.journeySubjects.length} migrated Journey(s), ` +
      `${recompute.assessments.length} assessment(s); witness ${witnessAssessmentId}`,
  );

  // --- 3b. reconcile: the cutover decision point ---------------------------
  const report = await reconcileMigration(pool, {
    workspaceId,
    runId: imported.runId,
    bundle,
    now: IMPORT_NOW,
    importStartedAt: IMPORT_NOW,
  });
  mkdirSync(dirname(RECONCILIATION_MD), { recursive: true });
  writeFileSync(RECONCILIATION_MD, renderReconciliationReport(report), 'utf8');
  writeFileSync(RECONCILIATION_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  say();
  say(`reconcileMigration verdict ${report.verdict} (${report.reconcilerVersion})`);
  for (const entry of report.checks) say(`  ${entry.status.padEnd(9)} ${entry.id}`);
  say(`  report written to docs/refactor/evidence/m10-reconciliation-report.{md,json}`);

  const failedChecks = report.checks.filter((entry) => entry.status === 'FAIL');
  check(
    'reconciliation_semantic_checks_pass',
    failedChecks.length === 0,
    failedChecks.length === 0
      ? `${report.checks.length}/${report.checks.length} semantic checks passed`
      : `failed: ${failedChecks.map((entry) => `${entry.id} (${entry.detail})`).join('; ')}`,
  );

  // A blocker is acceptable; an *unowned* blocker is not. The rehearsal's job
  // is to prove that everything outstanding has a named owner and a stated
  // safety impact, so the cutover decision is informed rather than hopeful.
  const unowned = report.exceptions.filter(
    (entry) => entry.owner.trim() === '' || entry.safetyImpact.trim() === '' || entry.affectedScope.trim() === '',
  );
  check(
    'every_exception_is_owned',
    unowned.length === 0,
    unowned.length === 0
      ? `${report.exceptions.length} exception(s), all carrying owner, scope and safety impact`
      : `${unowned.length} exception(s) lack an owner, scope or safety impact`,
  );

  // --- 3c. activation blockers ----------------------------------------------
  const activationBlockers = report.exceptions.filter((entry) => entry.blocksCutover);
  say();
  say(`activation blockers: ${activationBlockers.length}`);
  for (const entry of activationBlockers) {
    say(`  [${entry.classification}] ${entry.sourceType}/${entry.sourceId}`);
    say(`      scope: ${entry.affectedScope}`);
    say(`      owner: ${entry.owner}`);
  }
  if (activationBlockers.length === 0) say('  none — no scope is held back by an unresolved migration finding');

  const before = await snapshotMigratedState(pool, workspaceId, imported.runId);
  say();
  say('pre-backup state');
  say(`  legacy_id_map mappings   ${before.mappings.length}`);
  say(`  migration run            ${before.run.id} ${before.run.status} ${before.run.datasetHash}`);
  say(`  reconciliation exceptions ${before.run.exceptionCount} [${before.run.classifications.join(', ')}]`);
  for (const table of DOMAIN_TABLES) say(`  ${table.padEnd(24)} ${before.counts[table]}`);
  say(`  assessments              ${before.assessments}`);
  say();

  // --- 4. backup ------------------------------------------------------------
  await pool.end();
  dockerOrThrow([
    'exec',
    CONTAINER_NAME,
    'pg_dump',
    '-U',
    DB_USER,
    '-d',
    DB,
    '-Fc',
    '-f',
    DUMP_PATH_IN_CONTAINER,
  ]);
  const dumpBytes = dockerOrThrow([
    'exec',
    CONTAINER_NAME,
    'stat',
    '-c',
    '%s',
    DUMP_PATH_IN_CONTAINER,
  ]).stdout;
  say(`pg_dump -Fc wrote ${dumpBytes} bytes to ${DUMP_PATH_IN_CONTAINER} inside the container`);

  // --- 5. prove destruction -------------------------------------------------
  const psql = (sql, database) => [
    'exec',
    CONTAINER_NAME,
    'psql',
    '-U',
    DB_USER,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ];
  dockerOrThrow(psql(`DROP DATABASE "${DB}" WITH (FORCE)`, 'postgres'));
  dockerOrThrow(psql(`CREATE DATABASE "${DB}"`, 'postgres'));
  say(`database ${DB} dropped and recreated empty`);

  pool = createTargetPool(config);
  const destroyed = await pool.query(
    `SELECT to_regclass('public.legacy_id_map') IS NULL AS mappings_gone,
            to_regclass('public.migration_runs') IS NULL AS runs_gone,
            (SELECT count(*)::text FROM information_schema.tables
              WHERE table_schema = 'public') AS public_tables`,
  );
  const destroyedRow = destroyed.rows[0];
  check(
    'target_database_destroyed_before_restore',
    destroyedRow.mappings_gone === true && destroyedRow.runs_gone === true,
    `legacy_id_map gone=${destroyedRow.mappings_gone}, migration_runs gone=${destroyedRow.runs_gone}, ` +
      `public tables remaining=${destroyedRow.public_tables}`,
  );
  await pool.end();

  // --- 6. restore -----------------------------------------------------------
  const restore = docker([
    'exec',
    CONTAINER_NAME,
    'pg_restore',
    '-U',
    DB_USER,
    '-d',
    DB,
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    DUMP_PATH_IN_CONTAINER,
  ]);
  check(
    'pg_restore_completed_without_error',
    restore.status === 0,
    restore.status === 0
      ? `pg_restore exited 0${restore.stderr === '' ? '' : ` (stderr: ${restore.stderr})`}`
      : `pg_restore exited ${restore.status}: ${restore.stderr || restore.stdout}`,
  );

  // --- 7. verify -------------------------------------------------------------
  pool = createTargetPool(config);
  let after;
  try {
    after = await snapshotMigratedState(pool, workspaceId, imported.runId);
  } catch (error) {
    // A post-restore read that cannot even run is a failure of every state
    // check, not an abort that hides which properties were being verified.
    const detail = `post-restore read failed: ${error instanceof Error ? error.message : String(error)}`;
    for (const name of [
      'legacy_id_map_mappings_survive_identically',
      'migration_run_identity_survives',
      'imported_domain_state_row_counts_survive',
      'recomputed_assessment_survives',
      'append_only_trigger_survives',
    ]) {
      check(name, false, detail);
    }
    await pool.end();
    return;
  }

  const mappingsIdentical =
    after.mappings.length === before.mappings.length &&
    before.mappings.every((mapping, index) => after.mappings[index] === mapping);
  check(
    'legacy_id_map_mappings_survive_identically',
    mappingsIdentical,
    `${after.mappings.length}/${before.mappings.length} (source_dataset, source_type, source_id, target_kind, target_id) ` +
      `tuples identical${mappingsIdentical ? '' : `; first divergence at ${after.mappings.find((mapping, index) => mapping !== before.mappings[index]) ?? '(missing rows)'}`}`,
  );

  const runIdentical =
    after.run.id === before.run.id &&
    after.run.datasetHash === before.run.datasetHash &&
    after.run.exporterVersion === before.run.exporterVersion &&
    after.run.importerVersion === before.run.importerVersion &&
    after.run.status === before.run.status &&
    after.run.exceptionCount === before.run.exceptionCount &&
    after.run.classifications.join(',') === before.run.classifications.join(',');
  check(
    'migration_run_identity_survives',
    runIdentical,
    `run ${after.run.id} status=${after.run.status} dataset_hash=${after.run.datasetHash} ` +
      `exporter=${after.run.exporterVersion} importer=${after.run.importerVersion} ` +
      `exceptions=${after.run.exceptionCount}/${before.run.exceptionCount} [${after.run.classifications.join(', ')}]`,
  );

  const countMismatches = DOMAIN_TABLES.filter((table) => after.counts[table] !== before.counts[table]);
  check(
    'imported_domain_state_row_counts_survive',
    countMismatches.length === 0,
    countMismatches.length === 0
      ? DOMAIN_TABLES.map((table) => `${table}=${after.counts[table]}`).join(' ')
      : countMismatches
          .map((table) => `${table}: before=${before.counts[table]} after=${after.counts[table]}`)
          .join('; '),
  );

  const witness = await pool.query(
    'SELECT count(*)::text AS count FROM assessments WHERE workspace_id = $1 AND id = $2',
    [workspaceId, witnessAssessmentId],
  );
  const witnessPresent = Number(witness.rows[0]?.count ?? '0') === 1;
  check(
    'recomputed_assessment_survives',
    after.assessments === before.assessments && after.assessments > 0 && witnessPresent,
    `assessments=${after.assessments}/${before.assessments}, witness ${witnessAssessmentId} present=${witnessPresent}`,
  );

  const trigger = await pool.query(
    `SELECT tgname, tgrelid::regclass::text AS table_name, tgenabled
       FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`,
    ['legacy_id_map_immutable'],
  );
  const triggerRow = trigger.rows[0];
  check(
    'append_only_trigger_survives',
    triggerRow !== undefined && triggerRow.table_name === 'legacy_id_map',
    triggerRow === undefined
      ? 'pg_trigger has no legacy_id_map_immutable row after restore'
      : `${triggerRow.tgname} on ${triggerRow.table_name} (tgenabled=${triggerRow.tgenabled})`,
  );

  await pool.end();
}


// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

let passed = false;
try {
  await rehearse();
  passed = summarise();
} catch (error) {
  say();
  say(`ABORTED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  passed = false;
  if (checks.length > 0) summarise();
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  if (process.env.M10_KEEP_RESTORE_ENV === '1') {
    say();
    say(`M10_KEEP_RESTORE_ENV=1 — leaving ${CONTAINER_NAME} and volume ${VOLUME_NAME} in place for inspection`);
  } else {
    removeIsolatedInstance();
    say();
    say(`cleaned up container ${CONTAINER_NAME} and named volume ${VOLUME_NAME}`);
  }
  say('evidence written to docs/refactor/evidence/m10-backup-restore-output.txt');
  flushTranscript();
  process.exitCode = passed ? 0 : 1;
}
