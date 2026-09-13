/**
 * Ordered, checksummed SQL migration runner for the M1 PostgreSQL
 * foundation.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: "Use ordered, checksummed migrations
 * and a schema_migrations ledger. Never overwrite a global version number to
 * pretend all migrations ran." This runner:
 *  - bootstraps `schema_migrations` via an idempotent CREATE TABLE IF NOT
 *    EXISTS (it cannot itself be a checksummed migration — nothing exists to
 *    checksum against before the ledger exists);
 *  - re-verifies the checksum of every ALREADY-applied migration on every
 *    run, throwing before applying anything else if drift is found;
 *  - applies each pending migration inside its own transaction; a failing
 *    statement rolls back that migration's DDL and is never recorded as
 *    applied (Postgres DDL is transactional, so a partial migration never
 *    leaves half-created objects behind).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

export interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  checksum: string;
  appliedAt: string;
}

export class MigrationChecksumDriftError extends Error {
  readonly version: string;
  readonly recordedChecksum: string;
  readonly fileChecksum: string;

  constructor(version: string, recordedChecksum: string, fileChecksum: string) {
    super(
      `schema_migrations checksum drift for ${version}: recorded=${recordedChecksum} file=${fileChecksum}. ` +
        'Refusing to apply further migrations — the ledger no longer matches the migration files on disk.',
    );
    this.name = 'MigrationChecksumDriftError';
    this.version = version;
    this.recordedChecksum = recordedChecksum;
    this.fileChecksum = fileChecksum;
  }
}

export class MigrationApplyError extends Error {
  readonly version: string;

  constructor(version: string, cause: unknown) {
    super(`migration ${version} failed and was rolled back: ${(cause as Error)?.message ?? String(cause)}`, { cause });
    this.name = 'MigrationApplyError';
    this.version = version;
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const VERSION_PATTERN = /^(\d{4})_.+\.sql$/;

export function loadMigrationFiles(migrationsDir: string): MigrationFile[] {
  const entries = readdirSync(migrationsDir).filter((name) => VERSION_PATTERN.test(name));
  const files = entries.map((filename) => {
    const match = VERSION_PATTERN.exec(filename);
    if (!match) throw new Error(`unreachable: ${filename} failed to match after filter`);
    const version = match[1] as string;
    const sql = readFileSync(join(migrationsDir, filename), 'utf8');
    return { version, filename, sql, checksum: sha256(sql) };
  });
  files.sort((a, b) => a.version.localeCompare(b.version));
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.version)) {
      throw new Error(`duplicate migration version ${file.version} (${file.filename})`);
    }
    seen.add(file.version);
  }
  return files;
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function loadAppliedMigrations(client: PoolClient): Promise<Map<string, AppliedMigration>> {
  const result = await client.query<{ version: string; checksum: string; applied_at: string }>(
    'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version',
  );
  const map = new Map<string, AppliedMigration>();
  for (const row of result.rows) {
    map.set(row.version, { version: row.version, checksum: row.checksum, appliedAt: row.applied_at });
  }
  return map;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Applies every pending migration in `migrationsDir` to `pool`, in order.
 * Verifies checksums of already-applied migrations first and throws
 * {@link MigrationChecksumDriftError} without applying anything if drift is
 * found. A failing migration throws {@link MigrationApplyError}; every
 * migration strictly before it remains applied and recorded, and nothing
 * from the failing migration or after it is applied or recorded.
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<MigrateResult> {
  const files = loadMigrationFiles(migrationsDir);

  const bootstrapClient = await pool.connect();
  let applied: Map<string, AppliedMigration>;
  try {
    await ensureLedger(bootstrapClient);
    applied = await loadAppliedMigrations(bootstrapClient);
  } finally {
    bootstrapClient.release();
  }

  for (const file of files) {
    const recorded = applied.get(file.version);
    if (recorded && recorded.checksum !== file.checksum) {
      throw new MigrationChecksumDriftError(file.version, recorded.checksum, file.checksum);
    }
  }

  const alreadyApplied: string[] = [];
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file.version)) {
      alreadyApplied.push(file.version);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(file.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        file.version,
        file.checksum,
      ]);
      await client.query('COMMIT');
      newlyApplied.push(file.version);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new MigrationApplyError(file.version, error);
    } finally {
      client.release();
    }
  }

  return { applied: newlyApplied, alreadyApplied };
}

/** Read-only status check — never applies or mutates anything. */
export async function migrationStatus(
  pool: Pool,
  migrationsDir: string,
): Promise<{ pending: string[]; applied: AppliedMigration[]; driftedVersions: string[] }> {
  const files = loadMigrationFiles(migrationsDir);
  const client = await pool.connect();
  try {
    await ensureLedger(client);
    const appliedMap = await loadAppliedMigrations(client);
    const drifted: string[] = [];
    const pending: string[] = [];
    for (const file of files) {
      const recorded = appliedMap.get(file.version);
      if (!recorded) {
        pending.push(file.version);
      } else if (recorded.checksum !== file.checksum) {
        drifted.push(file.version);
      }
    }
    return { pending, applied: [...appliedMap.values()], driftedVersions: drifted };
  } finally {
    client.release();
  }
}
