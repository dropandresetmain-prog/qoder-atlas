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

export const PostgresTargetConfigSchema = z.object({
  host: z.string().min(1).default('localhost'),
  port: z.coerce.number().int().positive().max(65535).default(55432),
  database: z.string().min(1).default('northstar_test'),
  user: z.string().min(1).default('northstar_test'),
  password: z.string().min(1).default('northstar_test'),
  ssl: z.coerce.boolean().default(false),
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
