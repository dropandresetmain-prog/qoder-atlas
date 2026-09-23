/**
 * TEST-ONLY AiT fixture clone infrastructure (productionized).
 *
 * Builds one migrated + provisioned + baseline-evaluated PostgreSQL database
 * per suite invocation that needs it, freezes it, then creates isolated clones
 * via `CREATE DATABASE … TEMPLATE`.
 *
 * Must not be imported from production application code.
 */
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadPostgresTargetConfig, type PostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { createTargetPool, type Pool } from '../src/persistence/postgres/pool.ts';
import {
  assertDisposableDatabaseName as assertDisposableDatabaseNamePrimitive,
  cloneDatabaseFromTemplate,
  createEmptyDatabase,
  dropDisposableDatabase,
  freezeTemplateDatabase,
  makeDisposableName,
} from '../src/persistence/postgres/databaseTemplateClone.ts';
import { runMigrations } from '../src/persistence/postgres/migrate.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import { provisionDataset } from '../src/app/demo/provisionDataset.ts';
import { provisionDatasetSandboxInputsIfEnabled } from '../src/app/demo/sandboxExecutionInputs.ts';
import { prepareBaselineExistingVisits } from '../src/app/demo/prepareBaselineExistingVisits.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { loadConfig } from '../src/config/config.ts';
import { provisionWorkspaceAuthority, workspacePrincipalId } from '../src/app/target/workspaceAuthority.ts';
import { MIGRATIONS_DIR } from './harness.ts';

/** Fixed workspace identity so DatasetIdentityMinter IDs are reproducible across fresh builds. */
export const AIT_FIXTURE_WORKSPACE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';
export const AIT_FIXTURE_ACTOR = 'principal:ait-fixture-builder';
/** Pinned evaluation instant — wall-clock must not enter the baseline fixture.
 * Must be on/after reviewed official-document REPLAY observations (~2026-09-21)
 * and inside reviewed entry policy effective windows (from 2026-09-20), but
 * before the progressive-delay disruption timeline (from 2026-09-28). */
export const AIT_FIXTURE_NOW = '2026-09-22T12:00:00.000Z';
export const AIT_BUNDLE_DIR = fileURLToPath(
  new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url),
);

/** Synthetic sandbox + reviewed-visit readiness required for truthful Jordan baseline PASS. */
const AIT_FIXTURE_SANDBOX_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  ATLAS_ENV: 'sandbox',
  NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1',
  ADAPTER_MODE: process.env.ADAPTER_MODE?.trim() || 'REPLAY',
};

async function prepareAitBaselineReadiness(
  pool: Pool,
  workspaceId: string,
  datasetKey: string,
  now: string,
  actorPrincipalId: string = AIT_FIXTURE_ACTOR,
): Promise<void> {
  await provisionDatasetSandboxInputsIfEnabled({
    pool,
    uow: () => new PgUnitOfWork(pool, workspaceId),
    workspaceId,
    actorPrincipalId,
    datasetDirectory: AIT_BUNDLE_DIR,
    datasetKey,
    env: AIT_FIXTURE_SANDBOX_ENV,
  });
  await provisionWorkspaceAuthority({
    pool,
    uow: () => new PgUnitOfWork(pool, workspaceId),
    workspaceId,
    actorPrincipalId,
    now,
  });
  await prepareBaselineExistingVisits({
    pool,
    workspaceId,
    actorPrincipalId,
    reviewerPrincipalId: workspacePrincipalId(workspaceId, 'operator'),
    uow: () => new PgUnitOfWork(pool, workspaceId),
    config: loadConfig(AIT_FIXTURE_SANDBOX_ENV),
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    datasetDirectory: AIT_BUNDLE_DIR,
    now,
  });
}

/** Disposable fixture DB prefix — never a working mutable test DB. */
export const AIT_FIXTURE_DB_PREFIX = 'ns_ait_fx_';
/** Disposable clone DB prefix. */
export const AIT_CLONE_DB_PREFIX = 'ns_ait_cl_';

export type AitWorldMode = 'fresh' | 'clone';

export interface AitFixtureHandle {
  databaseName: string;
  workspaceId: string;
  datasetKey: string;
  contentHash: string;
  buildMs: number;
  baselineEvaluated: number;
  /** Admin-side drop; terminates connections and drops the fixture DB. */
  drop: () => Promise<void>;
}

export interface AitCloneHandle {
  pool: Pool;
  databaseName: string;
  workspaceId: string;
  cloneMs: number;
  postgresOverrides: Partial<PostgresTargetConfig>;
  drop: () => Promise<void>;
}

export interface LogicalBaselineFingerprint {
  /** sha256 of canonical JSON over authoritative logical rows (IDs included when deterministic). */
  digest: string;
  /** Human-readable summary for diagnostics. */
  summary: Record<string, unknown>;
  /** Fields intentionally excluded from the digest (documented nondeterminism). */
  ignoredFields: string[];
}

export function isAitFixtureDatabaseName(databaseName: string): boolean {
  return databaseName.startsWith(AIT_FIXTURE_DB_PREFIX);
}

export function isAitCloneDatabaseName(databaseName: string): boolean {
  return databaseName.startsWith(AIT_CLONE_DB_PREFIX);
}

export function assertDisposableDatabaseName(
  databaseName: string,
  kind: 'fixture' | 'clone',
): void {
  const prefix = kind === 'fixture' ? AIT_FIXTURE_DB_PREFIX : AIT_CLONE_DB_PREFIX;
  assertDisposableDatabaseNamePrimitive(databaseName, prefix);
}

/** Working pools must never point at the frozen fixture template. */
export function assertWorkingDatabaseNotFixture(
  workingDatabaseName: string,
  fixtureDatabaseName: string,
): void {
  if (workingDatabaseName === fixtureDatabaseName || isAitFixtureDatabaseName(workingDatabaseName)) {
    throw new Error(
      `working database must not be the AiT fixture (working="${workingDatabaseName}", fixture="${fixtureDatabaseName}")`,
    );
  }
}

function baseConfig(): PostgresTargetConfig {
  return loadPostgresTargetConfig();
}

async function dropDatabase(databaseName: string, kind: 'fixture' | 'clone'): Promise<void> {
  const prefix = kind === 'fixture' ? AIT_FIXTURE_DB_PREFIX : AIT_CLONE_DB_PREFIX;
  await dropDisposableDatabase(databaseName, prefix);
}

/**
 * Freeze a fixture database so ordinary test sessions cannot connect/mutate it.
 * Superuser can still CONNECT for DROP / CREATE DATABASE TEMPLATE (no session on fixture needed).
 */
export async function freezeFixtureDatabase(databaseName: string): Promise<void> {
  assertDisposableDatabaseName(databaseName, 'fixture');
  await freezeTemplateDatabase(databaseName, AIT_FIXTURE_DB_PREFIX);
}

export async function dropAitFixtureDatabase(databaseName: string): Promise<void> {
  await dropDatabase(databaseName, 'fixture');
}

export async function dropAitCloneDatabase(databaseName: string): Promise<void> {
  await dropDatabase(databaseName, 'clone');
}

export async function buildAitFixtureDatabase(options?: {
  databaseName?: string;
  runBaseline?: boolean;
}): Promise<AitFixtureHandle> {
  const databaseName = options?.databaseName ?? makeDisposableName(AIT_FIXTURE_DB_PREFIX);
  assertDisposableDatabaseName(databaseName, 'fixture');
  const runBaseline = options?.runBaseline !== false;
  const workspaceId = AIT_FIXTURE_WORKSPACE_ID;
  const started = performance.now();

  await createEmptyDatabase(databaseName);
  const pool = createTargetPool({ ...baseConfig(), database: databaseName });
  let baselineEvaluated = 0;
  let contentHash = '';
  let datasetKey = '';

  try {
    await runMigrations(pool, MIGRATIONS_DIR);
    const dataset = await loadDataset(AIT_BUNDLE_DIR);
    datasetKey = dataset.datasetKey;
    contentHash = dataset.contentHash;

    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
      workspaceId,
      `ait-canonical-fixture:${dataset.datasetKey}`,
    ]);

    const outcome = await provisionDataset({
      pool,
      workspaceId,
      actorPrincipalId: AIT_FIXTURE_ACTOR,
      dataset,
    });
    if (outcome.status !== 'MATERIALIZED') {
      throw new Error(`expected MATERIALIZED fixture provision, got ${outcome.status}`);
    }

    if (runBaseline) {
      await prepareAitBaselineReadiness(pool, workspaceId, dataset.datasetKey, AIT_FIXTURE_NOW);
      const baseline = await runBaselineEvaluation({
        pool,
        workspaceId,
        actorPrincipalId: AIT_FIXTURE_ACTOR,
        now: AIT_FIXTURE_NOW,
      });
      baselineEvaluated = baseline.evaluated;
      if (baselineEvaluated <= 0) {
        throw new Error('fixture baseline evaluation assessed zero journeys');
      }
    }
  } finally {
    await pool.end();
  }

  await freezeFixtureDatabase(databaseName);
  const buildMs = performance.now() - started;

  return {
    databaseName,
    workspaceId,
    datasetKey,
    contentHash,
    buildMs,
    baselineEvaluated,
    async drop() {
      await dropDatabase(databaseName, 'fixture');
    },
  };
}

/** Create an isolated database from a frozen AiT fixture via TEMPLATE cloning. */
export async function cloneAitFixtureDatabase(
  fixtureDatabaseName: string,
  options?: { databaseName?: string },
): Promise<AitCloneHandle> {
  if (!isAitFixtureDatabaseName(fixtureDatabaseName)) {
    throw new Error(
      `clone source must be an AiT fixture (${AIT_FIXTURE_DB_PREFIX}*), got "${fixtureDatabaseName}"`,
    );
  }
  const databaseName = options?.databaseName ?? makeDisposableName(AIT_CLONE_DB_PREFIX);
  assertDisposableDatabaseName(databaseName, 'clone');
  assertWorkingDatabaseNotFixture(databaseName, fixtureDatabaseName);

  const started = performance.now();
  await cloneDatabaseFromTemplate(fixtureDatabaseName, databaseName, {
    sourceRequiredPrefix: AIT_FIXTURE_DB_PREFIX,
    targetRequiredPrefix: AIT_CLONE_DB_PREFIX,
  });
  const cloneMs = performance.now() - started;
  const postgresOverrides: Partial<PostgresTargetConfig> = { database: databaseName };
  const pool = createTargetPool({ ...baseConfig(), ...postgresOverrides });

  return {
    pool,
    databaseName,
    workspaceId: AIT_FIXTURE_WORKSPACE_ID,
    cloneMs,
    postgresOverrides,
    async drop() {
      // Swallow late 'terminating connection' events from backends we force-close.
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
      await dropDatabase(databaseName, 'clone');
    },
  };
}

/**
 * Logical fingerprint of an AiT baseline world.
 *
 * Ignores only fields that are legitimately nondeterministic / irrelevant to
 * semantic equivalence of a cloned baseline:
 * - assessments.id / assessment_results timestamps (assessmentId = randomUUID)
 * - source_records.received_at for the dataset marker (wall clock at provision)
 * - outbox created_at / id ordering noise beyond payload identity where needed
 *
 * Includes deterministic domain IDs (DatasetIdentityMinter), topology counts,
 * external identity maps, verdicts by subject, inbox/outbox row shapes by
 * workspace, and aggregate revision heads.
 */
export async function fingerprintAitBaseline(
  pool: Pool,
  workspaceId: string,
): Promise<LogicalBaselineFingerprint> {
  const ignoredFields = [
    'assessments.id (randomUUID at evaluateImpact)',
    'assessments.evaluated_at / created_at (covered via subject+kind+verdict)',
    'source_records.received_at',
    'outbox.id / created_at / payload / subject_id (payloads embed assessment UUIDs; fingerprint uses subject_kind+destination+state multiplicity)',
    'inbox_deliveries.id / received_at',
    'command_receipts.committed_at / result_ref / payload_hash (dataset-marker payload embeds wall-clock receivedAt)',
    'aggregate_heads rows whose aggregate_id is an assessments.id (random assessment UUIDs)',
    'aggregate_heads.created_at / updated_at',
  ];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  };

  const workspace = await q(`SELECT id, name FROM workspaces WHERE id = $1`, [workspaceId]);
  const counts = await q<{ table_name: string; n: string }>(
    `
    SELECT * FROM (
      VALUES
        ('organisations', (SELECT count(*)::text FROM organisations WHERE workspace_id = $1)),
        ('events', (SELECT count(*)::text FROM events WHERE workspace_id = $1)),
        ('programmes', (SELECT count(*)::text FROM programmes WHERE workspace_id = $1)),
        ('programme_items', (SELECT count(*)::text FROM programme_items WHERE workspace_id = $1)),
        ('travellers', (SELECT count(*)::text FROM travellers WHERE workspace_id = $1)),
        ('trips', (SELECT count(*)::text FROM trips WHERE workspace_id = $1)),
        ('journeys', (SELECT count(*)::text FROM journeys WHERE workspace_id = $1)),
        ('journey_items', (SELECT count(*)::text FROM journey_items WHERE workspace_id = $1)),
        ('participations', (SELECT count(*)::text FROM participations WHERE workspace_id = $1)),
        ('transport_services', (SELECT count(*)::text FROM transport_services WHERE workspace_id = $1)),
        ('reservations', (SELECT count(*)::text FROM reservations WHERE workspace_id = $1)),
        ('reservation_lines', (SELECT count(*)::text FROM reservation_lines WHERE workspace_id = $1)),
        ('reservation_allocations', (SELECT count(*)::text FROM reservation_allocations WHERE workspace_id = $1)),
        ('external_records', (SELECT count(*)::text FROM external_records WHERE workspace_id = $1)),
        ('external_record_links', (SELECT count(*)::text FROM external_record_links WHERE workspace_id = $1)),
        ('source_records', (SELECT count(*)::text FROM source_records WHERE workspace_id = $1)),
        ('assessments', (SELECT count(*)::text FROM assessments WHERE workspace_id = $1)),
        ('assessment_subjects', (SELECT count(*)::text FROM assessment_subjects WHERE workspace_id = $1)),
        ('assessment_inputs', (SELECT count(*)::text FROM assessment_inputs WHERE workspace_id = $1)),
        ('recovery_cases', (SELECT count(*)::text FROM recovery_cases WHERE workspace_id = $1)),
        ('outbox', (SELECT count(*)::text FROM outbox WHERE workspace_id = $1)),
        ('inbox_deliveries', (SELECT count(*)::text FROM inbox_deliveries WHERE workspace_id = $1)),
        ('command_receipts', (SELECT count(*)::text FROM command_receipts WHERE workspace_id = $1)),
        ('aggregate_heads', (SELECT count(*)::text FROM aggregate_heads WHERE workspace_id = $1))
    ) AS t(table_name, n)
    ORDER BY table_name
    `,
    [workspaceId],
  );

  const orgs = await q(
    `SELECT id, legal_name, display_name, default_currency_code, lifecycle_status
       FROM organisations WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  const events = await q(
    `SELECT id, organiser_organisation_id, title, lifecycle_status
       FROM events WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  const programmes = await q(
    `SELECT id, event_id, title, lifecycle_status
       FROM programmes WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  const travellers = await q(
    `SELECT id, display_name_ref, lifecycle_status
       FROM travellers WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  const journeys = await q(
    `SELECT id, trip_id, traveller_id FROM journeys WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  const transport = await q(
    `SELECT id, operator, mode, origin_place_id, destination_place_id,
            published_departure, published_arrival
       FROM transport_services WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  const externalLinks = await q(
    `SELECT er.connection_id, er.record_type, er.external_id,
            l.canonical_subject_kind, l.canonical_subject_id, l.link_kind
       FROM external_record_links l
       JOIN external_records er
         ON er.workspace_id = l.workspace_id AND er.id = l.external_record_id
      WHERE l.workspace_id = $1 AND l.superseded_at IS NULL
      ORDER BY er.connection_id, er.record_type, er.external_id, l.canonical_subject_id`,
    [workspaceId],
  );
  const sourceMarkers = await q(
    `SELECT source_identity, content_hash, content_type
       FROM source_records WHERE workspace_id = $1
      ORDER BY source_identity, content_hash`,
    [workspaceId],
  );
  const verdicts = await q(
    `SELECT subject_kind, subject_id, kind, overall_verdict
       FROM assessments WHERE workspace_id = $1
      ORDER BY subject_kind, subject_id, kind, overall_verdict`,
    [workspaceId],
  );
  const dimensionResults = await q(
    `SELECT a.subject_kind, a.subject_id, a.kind AS assessment_kind,
            r.dimension, r.verdict, r.applicable, r.blocking
       FROM assessment_results r
       JOIN assessments a
         ON a.workspace_id = r.workspace_id AND a.id = r.assessment_id
      WHERE r.workspace_id = $1
      ORDER BY a.subject_kind, a.subject_id, a.kind, r.dimension, r.verdict`,
    [workspaceId],
  );
  const heads = await q(
    `SELECT h.aggregate_id, h.revision
       FROM aggregate_heads h
      WHERE h.workspace_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
           WHERE a.workspace_id = h.workspace_id AND a.id = h.aggregate_id
        )
      ORDER BY h.aggregate_id`,
    [workspaceId],
  );
  // Multiplicity of outbox envelopes without payload bytes (payloads embed random assessment ids).
  const outbox = await q(
    `SELECT subject_kind, destination_kind, state, count(*)::int AS n
       FROM outbox WHERE workspace_id = $1
      GROUP BY subject_kind, destination_kind, state
      ORDER BY subject_kind, destination_kind, state`,
    [workspaceId],
  );
  const inbox = await q(
    `SELECT source_connection_id, delivery_key, payload_hash
       FROM inbox_deliveries WHERE workspace_id = $1
      ORDER BY source_connection_id, delivery_key, payload_hash`,
    [workspaceId],
  );
  const receipts = await q(
    `SELECT command_namespace, idempotency_key
       FROM command_receipts WHERE workspace_id = $1
      ORDER BY command_namespace, idempotency_key`,
    [workspaceId],
  );
  const recoveryCases = await q(
    `SELECT id, lifecycle_status, resolution_kind
       FROM recovery_cases WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );

  const logical = {
    workspace,
    counts: Object.fromEntries(counts.map((row) => [row.table_name, Number(row.n)])),
    orgs,
    events,
    programmes,
    travellers,
    journeys,
    transport,
    externalLinks,
    sourceMarkers,
    verdicts,
    dimensionResults,
    heads,
    outbox,
    inbox,
    receipts,
    recoveryCases,
  };

  const canonical = JSON.stringify(logical);
  const digest = createHash('sha256').update(canonical).digest('hex');

  return {
    digest,
    summary: {
      workspaceId,
      counts: logical.counts,
      verdictCount: verdicts.length,
      outboxTopics: outbox.length,
      inboxRows: inbox.length,
      recoveryCaseCount: recoveryCases.length,
    },
    ignoredFields,
  };
}

/**
 * Provision a fresh AiT baseline into a throwaway database (control path for
 * equivalence). Same fixed workspace / actor / now as the fixture builder.
 */
export async function buildFreshAitBaselineDatabase(): Promise<{
  pool: Pool;
  databaseName: string;
  workspaceId: string;
  buildMs: number;
  drop: () => Promise<void>;
}> {
  const databaseName = makeDisposableName(`${AIT_FIXTURE_DB_PREFIX}fresh_`, 12);
  assertDisposableDatabaseName(databaseName, 'fixture');
  const workspaceId = AIT_FIXTURE_WORKSPACE_ID;
  const started = performance.now();
  await createEmptyDatabase(databaseName);
  const pool = createTargetPool({ ...baseConfig(), database: databaseName });
  await runMigrations(pool, MIGRATIONS_DIR);
  const dataset = await loadDataset(AIT_BUNDLE_DIR);
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
    workspaceId,
    `ait-canonical-fixture:${dataset.datasetKey}`,
  ]);
  const outcome = await provisionDataset({
    pool,
    workspaceId,
    actorPrincipalId: AIT_FIXTURE_ACTOR,
    dataset,
  });
  if (outcome.status !== 'MATERIALIZED') {
    throw new Error(`fresh control expected MATERIALIZED, got ${outcome.status}`);
  }
  await prepareAitBaselineReadiness(pool, workspaceId, dataset.datasetKey, AIT_FIXTURE_NOW);
  await runBaselineEvaluation({
    pool,
    workspaceId,
    actorPrincipalId: AIT_FIXTURE_ACTOR,
    now: AIT_FIXTURE_NOW,
  });
  return {
    pool,
    databaseName,
    workspaceId,
    buildMs: performance.now() - started,
    async drop() {
      await pool.end().catch(() => undefined);
      await dropDatabase(databaseName, 'fixture');
    },
  };
}

/**
 * Resolve world mode:
 * - explicit `NORTHSTAR_PG_AIT_WORLD=fresh|clone` wins;
 * - otherwise, if the suite prepared `NORTHSTAR_AIT_FIXTURE_DB`, default to clone;
 * - otherwise fresh (focused single-file runs without suite fixture).
 */
export function aitWorldModeFromEnv(env: NodeJS.ProcessEnv = process.env): AitWorldMode {
  const raw = (env.NORTHSTAR_PG_AIT_WORLD ?? '').trim().toLowerCase();
  if (raw === 'fresh') return 'fresh';
  if (raw === 'clone') return 'clone';
  if ((env.NORTHSTAR_AIT_FIXTURE_DB ?? '').trim()) return 'clone';
  return 'fresh';
}

/**
 * Minimal setup seam for pilot tests: fresh provision in the shared pool DB,
 * or clone from a pre-built fixture named by NORTHSTAR_AIT_FIXTURE_DB.
 *
 * Clone mode requires NORTHSTAR_AIT_FIXTURE_DB. Each call returns an isolated
 * clone database; caller must drop it.
 */
export async function obtainAitSummitWorld(params: {
  mode?: AitWorldMode;
  actorPrincipalId: string;
  /** When true (default), run baseline on fresh path / require it on clone. */
  includeBaseline?: boolean;
  /** Optional pinned evaluation instant for fresh-path baseline (B1 uses a fixed NOW). */
  baselineNow?: string;
  /** Shared pool used only for fresh mode (existing test pattern). */
  sharedPool?: Pool;
  dataset?: LoadedDataset;
  fixtureDatabaseName?: string;
}): Promise<{
  mode: AitWorldMode;
  pool: Pool;
  workspaceId: string;
  connectionId: string;
  provisionStatus: 'MATERIALIZED' | 'CLONED';
  baselineEvaluated: number | undefined;
  postgresOverrides: Partial<PostgresTargetConfig>;
  /** Fresh mode: no-op (workspace lives in shared DB). Clone mode: drop clone DB. */
  dispose: () => Promise<void>;
  setupMs: number;
}> {
  const mode = params.mode ?? aitWorldModeFromEnv();
  const includeBaseline = params.includeBaseline !== false;
  const started = performance.now();

  if (mode === 'clone') {
    const fixture =
      params.fixtureDatabaseName ??
      (process.env.NORTHSTAR_AIT_FIXTURE_DB ?? '').trim();
    if (!fixture) {
      throw new Error('clone mode requires NORTHSTAR_AIT_FIXTURE_DB or fixtureDatabaseName');
    }
    const clone = await cloneAitFixtureDatabase(fixture);
    assertWorkingDatabaseNotFixture(clone.databaseName, fixture);
    const connectionResult = await clone.pool.query<{ connection_id: string }>(
      `SELECT DISTINCT connection_id FROM external_records WHERE workspace_id = $1 LIMIT 1`,
      [clone.workspaceId],
    );
    if (connectionResult.rowCount !== 1) {
      throw new Error('cloned fixture missing provisioning connection');
    }
    let baselineEvaluated: number | undefined;
    if (includeBaseline) {
      const assessed = await clone.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM assessment_subjects WHERE workspace_id = $1 AND subject_kind = 'JOURNEY'`,
        [clone.workspaceId],
      );
      baselineEvaluated = Number(assessed.rows[0]!.n);
      if (baselineEvaluated <= 0) {
        throw new Error('cloned fixture missing baseline assessments');
      }
    }
    return {
      mode,
      pool: clone.pool,
      workspaceId: clone.workspaceId,
      connectionId: connectionResult.rows[0]!.connection_id,
      provisionStatus: 'CLONED',
      baselineEvaluated,
      postgresOverrides: clone.postgresOverrides,
      setupMs: performance.now() - started,
      dispose: () => clone.drop(),
    };
  }

  // Fresh path — preserve existing semantics (random workspace in shared DB).
  const pool = params.sharedPool;
  if (!pool) throw new Error('fresh mode requires sharedPool');
  const dataset = params.dataset ?? (await loadDataset(AIT_BUNDLE_DIR));
  const workspaceId = randomUUID();
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
    workspaceId,
    `ait-fresh-world:${workspaceId}`,
  ]);
  const outcome = await provisionDataset({
    pool,
    workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    dataset,
  });
  if (outcome.status !== 'MATERIALIZED') {
    throw new Error(`fresh provision expected MATERIALIZED, got ${outcome.status}`);
  }
  const connectionResult = await pool.query<{ connection_id: string }>(
    `SELECT DISTINCT connection_id FROM external_records WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId],
  );
  if (connectionResult.rowCount !== 1) {
    throw new Error('fresh world missing provisioning connection');
  }
  let baselineEvaluated: number | undefined;
  if (includeBaseline) {
    await prepareAitBaselineReadiness(
      pool,
      workspaceId,
      dataset.datasetKey,
      params.baselineNow ?? new Date().toISOString(),
      params.actorPrincipalId,
    );
    const baseline = await runBaselineEvaluation({
      pool,
      workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      ...(params.baselineNow ? { now: params.baselineNow } : {}),
    });
    baselineEvaluated = baseline.evaluated;
  }
  return {
    mode,
    pool,
    workspaceId,
    connectionId: connectionResult.rows[0]!.connection_id,
    provisionStatus: 'MATERIALIZED',
    baselineEvaluated,
    postgresOverrides: {},
    setupMs: performance.now() - started,
    dispose: async () => undefined,
  };
}
