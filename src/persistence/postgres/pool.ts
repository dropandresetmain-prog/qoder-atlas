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

export function createTargetPool(config: PostgresTargetConfig): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: config.poolMax,
  });
}
