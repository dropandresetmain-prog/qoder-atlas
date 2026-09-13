/**
 * Shared PostgreSQL test-harness helpers for the M1 integration suite.
 * Requires an isolated PostGIS-enabled instance — start it with
 * `npm run db:postgres:up` (docker-compose.postgres-test.yml) before running
 * `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadPostgresTargetConfig, type PostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { createTargetPool, type Pool } from '../src/persistence/postgres/pool.ts';
import { runMigrations } from '../src/persistence/postgres/migrate.ts';

export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../src/persistence/postgres/migrations/', import.meta.url),
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The official postgres/postgis Docker images start a TEMPORARY server to
 * run init scripts (creating the postgis template/extensions), stop it, then
 * exec the real long-running server. `pg_isready` can report the temporary
 * server as ready, so `docker compose up --wait`'s healthcheck can pass
 * moments before the real cutover — during which a plain connection attempt
 * gets `Connection terminated unexpectedly`. Each attempt here opens a
 * throwaway `Client` (never reusing a possibly-now-dead pooled connection)
 * and requires two consecutive successes 1s apart before declaring the real
 * server stable, so a lucky single ping during the temporary server's last
 * moment can't fool it.
 */
async function waitUntilReady(config: PostgresTargetConfig, maxAttempts = 40): Promise<void> {
  let consecutiveSuccesses = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 2000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      consecutiveSuccesses++;
      if (consecutiveSuccesses >= 2) return;
    } catch {
      consecutiveSuccesses = 0;
    } finally {
      await client.end().catch(() => undefined);
    }
    await sleep(750);
  }
  throw new Error(
    `PostgreSQL at ${config.host}:${config.port}/${config.database} did not stabilize after ${maxAttempts} attempts`,
  );
}

let sharedPoolPromise: Promise<Pool> | undefined;

/** One migrated pool per test-file process, shared across that file's test cases. */
export async function sharedTestPool(): Promise<Pool> {
  sharedPoolPromise ??= (async () => {
    const config = loadPostgresTargetConfig();
    await waitUntilReady(config);
    const pool = createTargetPool(config);
    await runMigrations(pool, MIGRATIONS_DIR);
    return pool;
  })();
  return sharedPoolPromise;
}

export function freshWorkspaceId(): string {
  return randomUUID();
}

/**
 * A separate, throwaway PostgreSQL DATABASE (not just a workspace row) for
 * tests that need to prove migration behaviour from a truly empty schema —
 * e.g. "ordered migrations create the target foundation from an empty
 * database" and checksum/failure tests that must not disturb the shared
 * per-workspace test pool above.
 */
export async function createEphemeralDatabase(): Promise<{
  pool: Pool;
  databaseName: string;
  drop: () => Promise<void>;
}> {
  const base = loadPostgresTargetConfig();
  await waitUntilReady(base);
  const adminPool = createTargetPool(base);
  const databaseName = `northstar_m1_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  await adminPool.end();

  const pool = createTargetPool({ ...base, database: databaseName });
  return {
    pool,
    databaseName,
    async drop() {
      await pool.end();
      const admin2 = createTargetPool(base);
      try {
        await admin2.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } finally {
        await admin2.end();
      }
    },
  };
}
