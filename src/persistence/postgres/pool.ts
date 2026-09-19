/**
 * Pool construction for the isolated PostgreSQL target composition.
 *
 * `pg` (node-postgres) v8 is the chosen driver: maintained, explicit
 * parameterized SQL (`$1..$n` placeholders — no string interpolation of
 * values anywhere in this tree), and explicit transaction control via a
 * checked-out `Client`/`PoolClient` (`BEGIN`/`COMMIT`/`ROLLBACK`), rather than
 * an ORM that would hide the CAS/idempotency/transaction invariants this
 * milestone exists to make explicit.
 */
import pg from 'pg';
import type { PostgresTargetConfig } from './config.ts';

const { Pool } = pg;
export type { Pool, PoolClient } from 'pg';

/**
 * A PostgreSQL restart/crash or a dropped socket surfaces as an 'error' event
 * on the affected client. node-postgres only listens for that on IDLE clients;
 * while a client is checked out no listener exists, and an unhandled 'error'
 * event terminates the whole Node process. Both listeners below log and
 * swallow the event: the in-flight query still rejects with the same error
 * (so callers see a normal failure and their finally-release runs), and
 * the broken client is discarded by the pool instead of taking the runtime down.
 */
export function attachPoolErrorGuards(pool: pg.Pool, log: (message: string) => void = (m) => console.error(m)): pg.Pool {
  const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  pool.on('error', (error) => log(`[pg] idle client error (client discarded): ${describe(error)}`));
  pool.on('connect', (client) => {
    client.on('error', (error) => log(`[pg] client connection error (client discarded): ${describe(error)}`));
  });
  return pool;
}

export function createTargetPool(config: PostgresTargetConfig): pg.Pool {
  return attachPoolErrorGuards(new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: config.poolMax,
  }));
}
