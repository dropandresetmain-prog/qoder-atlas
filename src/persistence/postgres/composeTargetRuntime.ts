/**
 * Isolated target-persistence composition (M1).
 *
 * NOT imported by `src/main.ts` or `src/app/compose.ts` — the default
 * runtime composition continues to use the SQLite path
 * (`src/persistence/database.ts`) unless a caller explicitly imports and
 * invokes this module (test harness, or a future explicit target-mode
 * entrypoint added by a later milestone). This is the construction seam the
 * M1 brief asks for: "Introduce the construction seams needed to select the
 * isolated target persistence implementation without replacing the existing
 * SQLite runtime."
 */
import { loadPostgresTargetConfig, type PostgresTargetConfig } from './config.ts';
import { createTargetPool, type Pool } from './pool.ts';
import { runMigrations, type MigrateResult } from './migrate.ts';
import { PgUnitOfWork } from './pgUnitOfWork.ts';

const DEFAULT_MIGRATIONS_DIR = new URL('./migrations', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export interface TargetRuntime {
  pool: Pool;
  config: PostgresTargetConfig;
  /** Builds a `UnitOfWork` bound to one workspace — see pgAggregateHeadReader.ts's design note. */
  unitOfWorkFor(workspaceId: string): PgUnitOfWork;
  close(): Promise<void>;
}

export async function composeTargetRuntime(
  overrides: Partial<PostgresTargetConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
  options: { pool?: Pool; skipMigrate?: boolean } = {},
): Promise<TargetRuntime & { migrationResult: MigrateResult }> {
  const config = { ...loadPostgresTargetConfig(env), ...overrides };
  const pool = options.pool ?? createTargetPool(config);
  const migrationsDir = config.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const migrationResult = options.skipMigrate
    ? { applied: [], alreadyApplied: [] }
    : await runMigrations(pool, migrationsDir);

  return {
    pool,
    config,
    migrationResult,
    unitOfWorkFor(workspaceId: string) {
      return new PgUnitOfWork(pool, workspaceId);
    },
    async close() {
      await pool.end();
    },
  };
}
