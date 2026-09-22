/**
 * Demo baseline template + working-clone lifecycle for founder Reset.
 *
 * Builds a frozen TEMPLATE database once when baseline identity changes
 * (~70s acceptable), then Reset creates a pristine working clone (~1s)
 * and swaps the live pool onto it without delete+reprovision.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPostgresTargetConfig, type PostgresTargetConfig } from '../../persistence/postgres/config.ts';
import {
  assertDisposableDatabaseName,
  cloneDatabaseFromTemplate,
  createEmptyDatabase,
  dropDisposableDatabase,
  freezeTemplateDatabase,
  makeDisposableName,
} from '../../persistence/postgres/databaseTemplateClone.ts';
import { createTargetPool, type Pool } from '../../persistence/postgres/pool.ts';
import { runMigrations } from '../../persistence/postgres/migrate.ts';
import { createSwappablePool, type SwappablePoolHandle } from '../../persistence/postgres/swappablePool.ts';
import {
  computeDemoBaselineIdentity,
  fingerprintMigrationsDirectory,
  hashOptionalFileContent,
} from './demoBaselineIdentity.ts';
import { loadDataset, datasetDirectoryFromEnv } from './datasetLoader.ts';
import { provisionDataset } from './provisionDataset.ts';
import { provisionDatasetSandboxInputsIfEnabled } from './sandboxExecutionInputs.ts';
import { runBaselineEvaluation } from './baselineEvaluation.ts';
import { provisionWorkspaceAuthority } from '../target/workspaceAuthority.ts';
import { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';

/** Frozen template databases for the product demo baseline. */
export const DEMO_TEMPLATE_DB_PREFIX = 'ns_demo_fx_';
/** Disposable working clones the founder demo mutates. */
export const DEMO_CLONE_DB_PREFIX = 'ns_demo_cl_';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../persistence/postgres/migrations/', import.meta.url));

export interface DemoRuntimeSession {
  templateDatabaseName: string;
  workingDatabaseName: string;
  baselineIdentity: string;
  workspaceId: string;
  datasetKey: string;
  contentHash: string;
  templateBuildMs: number;
  swappable: SwappablePoolHandle;
  postgresConfig: PostgresTargetConfig;
}

let activeSession: DemoRuntimeSession | undefined;

export function getDemoRuntimeSession(): DemoRuntimeSession | undefined {
  return activeSession;
}

/** Bind an already-constructed demo session (tests / advanced boot). */
export function bindDemoRuntimeSession(session: DemoRuntimeSession): void {
  activeSession = session;
}

export function clearDemoRuntimeSession(): void {
  activeSession = undefined;
}

export function demoCloneResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.NORTHSTAR_DEMO_CLONE_RESET ?? '1').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'disabled') return false;
  const environment = (env.APP_ENVIRONMENT ?? 'local').trim().toLowerCase() || 'local';
  return ['local', 'dev', 'demo'].includes(environment) && datasetDirectoryFromEnv(env) !== undefined;
}

async function resolveBaselineIdentity(params: {
  migrationsDir: string;
  datasetDirectory: string;
  datasetContentHash: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ identity: string; sandboxInputsHash?: string; researchConfigHash?: string }> {
  const migrationsFingerprint = fingerprintMigrationsDirectory(params.migrationsDir);
  const sandboxPath = join(params.datasetDirectory, 'sandbox-execution-inputs.json');
  const researchPath = params.env.NORTHSTAR_RECOVERY_RESEARCH_CONFIG?.trim()
    || join(params.datasetDirectory, 'recovery-research.json');
  const sandboxInputsHash = await hashOptionalFileContent(sandboxPath);
  const researchConfigHash = await hashOptionalFileContent(researchPath);
  return {
    identity: computeDemoBaselineIdentity({
      migrationsFingerprint,
      datasetContentHash: params.datasetContentHash,
      ...(sandboxInputsHash ? { sandboxInputsHash } : {}),
      ...(researchConfigHash ? { researchConfigHash } : {}),
    }),
    ...(sandboxInputsHash ? { sandboxInputsHash } : {}),
    ...(researchConfigHash ? { researchConfigHash } : {}),
  };
}

async function findTemplateByIdentity(admin: Pool, identity: string): Promise<string | undefined> {
  // Only reuse databases explicitly frozen as templates. Incomplete builds are
  // ordinary DBs under the same name prefix and must never be cloned as baseline.
  const marker = identity.slice(0, 16);
  const result = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database
      WHERE datname LIKE $1
        AND datistemplate = true
      ORDER BY datname`,
    [`${DEMO_TEMPLATE_DB_PREFIX}${marker}%`],
  );
  return result.rows[0]?.datname;
}

/** Drop leftover incomplete template builds that never reached freeze. */
async function dropOrphanTemplateBuilds(admin: Pool, identity: string): Promise<void> {
  const marker = identity.slice(0, 16);
  const result = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database
      WHERE datname LIKE $1
        AND datistemplate = false`,
    [`${DEMO_TEMPLATE_DB_PREFIX}${marker}%`],
  );
  for (const row of result.rows) {
    console.warn(`[atlas] dropping incomplete demo template build ${row.datname}`);
    await dropDisposableDatabase(row.datname, DEMO_TEMPLATE_DB_PREFIX).catch((error) => {
      console.warn(
        `[atlas] incomplete template drop deferred: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

async function buildTemplateDatabase(params: {
  workspaceId: string;
  datasetDirectory: string;
  migrationsDir: string;
  identity: string;
  env: NodeJS.ProcessEnv;
  actorPrincipalId: string;
}): Promise<{ databaseName: string; datasetKey: string; contentHash: string; buildMs: number; baselineEvaluated: number }> {
  const marker = params.identity.slice(0, 16);
  const databaseName = makeDisposableName(`${DEMO_TEMPLATE_DB_PREFIX}${marker}_`);
  assertDisposableDatabaseName(databaseName, DEMO_TEMPLATE_DB_PREFIX);
  const started = performance.now();
  await createEmptyDatabase(databaseName);
  const pool = createTargetPool({ ...loadPostgresTargetConfig(params.env), database: databaseName });
  let datasetKey = '';
  let contentHash = '';
  let baselineEvaluated = 0;
  try {
    await runMigrations(pool, params.migrationsDir);
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
      params.workspaceId,
      `northstar-demo-template:${params.workspaceId}`,
    ]);
    const dataset = await loadDataset(params.datasetDirectory);
    datasetKey = dataset.datasetKey;
    contentHash = dataset.contentHash;
    const provisioned = await provisionDataset({
      pool,
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      dataset,
    });
    if (provisioned.status !== 'MATERIALIZED' && provisioned.status !== 'ALREADY_PROVISIONED') {
      throw new Error(`demo template provision failed: ${provisioned.status}`);
    }
    await provisionDatasetSandboxInputsIfEnabled({
      pool,
      uow: () => new PgUnitOfWork(pool, params.workspaceId),
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      datasetDirectory: params.datasetDirectory,
      datasetKey,
      env: params.env,
    });
    const baseline = await runBaselineEvaluation({
      pool,
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
    });
    baselineEvaluated = baseline.evaluated;
    await provisionWorkspaceAuthority({
      pool,
      uow: () => new PgUnitOfWork(pool, params.workspaceId),
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      now: new Date().toISOString(),
      operatorAuthSubject: params.env.NORTHSTAR_OPERATOR_AUTH_SUBJECT?.trim() || undefined,
    });
  } finally {
    await pool.end();
  }
  await freezeTemplateDatabase(databaseName, DEMO_TEMPLATE_DB_PREFIX);
  return {
    databaseName,
    datasetKey,
    contentHash,
    buildMs: performance.now() - started,
    baselineEvaluated,
  };
}

/**
 * Ensure a frozen demo template exists for the current baseline identity, then
 * create a working clone and a swappable pool pointed at that clone.
 */
export async function openDemoWorkingClone(params: {
  workspaceId: string;
  env?: NodeJS.ProcessEnv;
  migrationsDir?: string;
}): Promise<DemoRuntimeSession> {
  const env = params.env ?? process.env;
  const datasetDirectory = datasetDirectoryFromEnv(env);
  if (!datasetDirectory) {
    throw new Error('openDemoWorkingClone requires NORTHSTAR_DEMO_DATASET_DIR');
  }
  const migrationsDir = params.migrationsDir
    ?? env.PG_TARGET_MIGRATIONS_DIR?.trim()
    ?? DEFAULT_MIGRATIONS_DIR;
  if (!existsSync(migrationsDir)) {
    throw new Error(`migrations directory not found: ${migrationsDir}`);
  }

  const dataset = await loadDataset(datasetDirectory);
  const { identity } = await resolveBaselineIdentity({
    migrationsDir,
    datasetDirectory,
    datasetContentHash: dataset.contentHash,
    env,
  });

  const adminConfig = loadPostgresTargetConfig(env);
  const admin = createTargetPool(adminConfig);
  let templateDatabaseName: string | undefined;
  let templateBuildMs = 0;
  let datasetKey = dataset.datasetKey;
  let contentHash = dataset.contentHash;
  try {
    await dropOrphanTemplateBuilds(admin, identity);
    templateDatabaseName = await findTemplateByIdentity(admin, identity);
  } finally {
    await admin.end();
  }

  if (!templateDatabaseName) {
    const actorPrincipalId = `northstar-demo-template:${params.workspaceId}`;
    const built = await buildTemplateDatabase({
      workspaceId: params.workspaceId,
      datasetDirectory,
      migrationsDir,
      identity,
      env,
      actorPrincipalId,
    });
    templateDatabaseName = built.databaseName;
    templateBuildMs = built.buildMs;
    datasetKey = built.datasetKey;
    contentHash = built.contentHash;
    console.log(
      `[atlas] demo baseline template built in ${Math.round(templateBuildMs)}ms `
        + `(db=${templateDatabaseName}, identity=${identity.slice(0, 12)}…)`,
    );
  } else {
    console.log(`[atlas] reusing demo baseline template ${templateDatabaseName}`);
  }

  const workingDatabaseName = makeDisposableName(DEMO_CLONE_DB_PREFIX);
  const cloneStarted = performance.now();
  await cloneDatabaseFromTemplate(templateDatabaseName, workingDatabaseName, {
    sourceRequiredPrefix: DEMO_TEMPLATE_DB_PREFIX,
    targetRequiredPrefix: DEMO_CLONE_DB_PREFIX,
  });
  const cloneMs = performance.now() - cloneStarted;
  console.log(`[atlas] demo working clone ready in ${Math.round(cloneMs)}ms (db=${workingDatabaseName})`);

  const postgresConfig = { ...loadPostgresTargetConfig(env), database: workingDatabaseName };
  const swappable = createSwappablePool(postgresConfig);
  const session: DemoRuntimeSession = {
    templateDatabaseName,
    workingDatabaseName,
    baselineIdentity: identity,
    workspaceId: params.workspaceId,
    datasetKey,
    contentHash,
    templateBuildMs,
    swappable,
    postgresConfig,
  };
  activeSession = session;
  return session;
}

/**
 * Create a pristine working clone from the frozen template and swap the live
 * pool onto it. The previous working database is dropped only after the swap.
 */
export async function resetOntoPristineClone(params?: {
  env?: NodeJS.ProcessEnv;
}): Promise<{
  status: 'RESET';
  workspaceId: string;
  previousDatabaseName: string;
  workingDatabaseName: string;
  cloneMs: number;
  swapMs: number;
  dropMs: number;
  timingsMs: Record<string, number>;
  provisioning: 'CLONE_FROM_TEMPLATE';
  baselineEvaluated: number;
  authority: 'PRESERVED_IN_TEMPLATE';
  tables: string[];
  deletedRows: number;
}> {
  const session = activeSession;
  if (!session) {
    throw new Error('demo clone session is not open; cannot reset onto a pristine clone');
  }
  const timingsMs: Record<string, number> = {};
  let phaseStart = Date.now();
  const mark = (phase: string): void => {
    const t = Date.now();
    timingsMs[phase] = t - phaseStart;
    phaseStart = t;
  };

  const nextName = makeDisposableName(DEMO_CLONE_DB_PREFIX);
  const cloneStarted = performance.now();
  await cloneDatabaseFromTemplate(session.templateDatabaseName, nextName, {
    sourceRequiredPrefix: DEMO_TEMPLATE_DB_PREFIX,
    targetRequiredPrefix: DEMO_CLONE_DB_PREFIX,
  });
  const cloneMs = performance.now() - cloneStarted;
  mark('clone');

  const swapStarted = performance.now();
  const { previousDatabaseName, previousPool } = await session.swappable.swapToDatabase(nextName);
  const swapMs = performance.now() - swapStarted;
  session.workingDatabaseName = nextName;
  mark('swap');

  previousPool.on('error', () => undefined);
  await previousPool.end().catch(() => undefined);

  const dropStarted = performance.now();
  await dropDisposableDatabase(previousDatabaseName, DEMO_CLONE_DB_PREFIX).catch((error) => {
    console.warn(`[atlas] previous demo clone drop deferred: ${error instanceof Error ? error.message : String(error)}`);
  });
  const dropMs = performance.now() - dropStarted;
  mark('dropPrevious');

  return {
    status: 'RESET',
    workspaceId: session.workspaceId,
    previousDatabaseName,
    workingDatabaseName: nextName,
    cloneMs,
    swapMs,
    dropMs,
    timingsMs,
    provisioning: 'CLONE_FROM_TEMPLATE',
    baselineEvaluated: -1,
    authority: 'PRESERVED_IN_TEMPLATE',
    tables: [],
    deletedRows: 0,
  };
}
