/**
 * PostgreSQL target-persistence configuration (M1).
 *
 * Deliberately NOT part of `src/config/config.ts#loadConfig()` — the target
 * composition is an isolated seam (`composeTargetRuntime.ts`) that nothing in
 * the default SQLite runtime imports. Reading these variables never affects
 * `loadConfig()` behaviour or startup requirements documented in
 * docs/ENVIRONMENT.md's existing "starts with zero variables" contract.
 */
import { z } from 'zod';

/**
 * An environment flag is a string, and `z.coerce.boolean()` reads every
 * non-empty string as `true` — so `PG_TARGET_SSL=false`, exactly as
 * `.env.example` documents it, turned SSL **on** and failed normal boot with
 * "The server does not support SSL connections" against a plain local
 * PostgreSQL.
 *
 * This parses the value the way an operator means it, and refuses anything
 * ambiguous rather than guessing: a typo must not silently decide whether the
 * connection is encrypted.
 */
const TRUE_FLAGS = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_FLAGS = new Set(['false', '0', 'no', 'n', 'off', '']);

const EnvFlagSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (TRUE_FLAGS.has(normalized)) return true;
  if (FALSE_FLAGS.has(normalized)) return false;
  return value;
}, z.boolean({ message: 'expected one of true/false/1/0/yes/no/on/off' }));

export const PostgresTargetConfigSchema = z.object({
  host: z.string().min(1).default('localhost'),
  port: z.coerce.number().int().positive().max(65535).default(55432),
  database: z.string().min(1).default('northstar_test'),
  user: z.string().min(1).default('northstar_test'),
  password: z.string().min(1).default('northstar_test'),
  ssl: EnvFlagSchema.default(false),
  poolMax: z.coerce.number().int().positive().default(10),
  migrationsDir: z.string().min(1).optional(),
});
export type PostgresTargetConfig = z.infer<typeof PostgresTargetConfigSchema>;

/**
 * Loads target-Postgres configuration strictly from `PGTEST_*`/`PG_TARGET_*`
 * environment variables. Never falls back to reading generic `PG*`/`DATABASE_URL`
 * variables — those belong to other tooling and must not accidentally point
 * this isolated foundation at an unrelated database.
 */
export function loadPostgresTargetConfig(env: NodeJS.ProcessEnv = process.env): PostgresTargetConfig {
  return PostgresTargetConfigSchema.parse({
    host: env.PG_TARGET_HOST ?? env.PGTEST_HOST,
    port: env.PG_TARGET_PORT ?? env.PGTEST_PORT,
    database: env.PG_TARGET_DATABASE ?? env.PGTEST_DB,
    user: env.PG_TARGET_USER ?? env.PGTEST_USER,
    password: env.PG_TARGET_PASSWORD ?? env.PGTEST_PASSWORD,
    ssl: env.PG_TARGET_SSL,
    poolMax: env.PG_TARGET_POOL_MAX,
    migrationsDir: env.PG_TARGET_MIGRATIONS_DIR,
  });
}
