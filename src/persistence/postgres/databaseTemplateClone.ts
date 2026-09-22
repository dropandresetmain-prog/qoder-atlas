/**
 * Reusable PostgreSQL database TEMPLATE primitives (create, freeze, clone, drop).
 *
 * Used by integration-test fixture builders and (via product paths) demo reset
 * handover. Callers supply disposable name prefixes; this module never embeds
 * scenario-specific database names.
 */
import { randomUUID } from 'node:crypto';
import { loadPostgresTargetConfig, type PostgresTargetConfig } from './config.ts';
import { createTargetPool, type Pool } from './pool.ts';

export const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
  'template_postgis',
  'northstar_test',
]);

export function isProtectedDatabaseName(databaseName: string): boolean {
  return PROTECTED_DATABASE_NAMES.has(databaseName) || databaseName.startsWith('template');
}

/**
 * Refuse protected/system databases and require a caller-owned disposable prefix.
 */
export function assertDisposableDatabaseName(databaseName: string, requiredPrefix: string): void {
  if (isProtectedDatabaseName(databaseName)) {
    throw new Error(`refusing to operate on protected database "${databaseName}"`);
  }
  if (!databaseName.startsWith(requiredPrefix)) {
    throw new Error(
      `disposable database must start with ${requiredPrefix}, got "${databaseName}"`,
    );
  }
}

/** Random disposable database name under a caller prefix (hex suffix, no dashes). */
export function makeDisposableName(prefix: string, suffixLength = 16): string {
  if (!prefix) {
    throw new Error('disposable database prefix must be non-empty');
  }
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, suffixLength)}`;
}

/** Pool connected to the configured server admin database (DDL / TEMPLATE ops). */
export function createAdminPool(config?: PostgresTargetConfig): Pool {
  return createTargetPool(config ?? loadPostgresTargetConfig());
}

export function adminPool(): Pool {
  return createAdminPool();
}

export async function terminateDatabaseBackends(admin: Pool, databaseName: string): Promise<void> {
  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()`,
    [databaseName],
  );
}

export async function createEmptyDatabase(databaseName: string): Promise<void> {
  const admin = adminPool();
  try {
    const templates = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname = 'template_postgis'`,
    );
    if (templates.rowCount && templates.rowCount > 0) {
      await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template_postgis`);
    } else {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }
}

/**
 * Freeze a database for use as a TEMPLATE source: revoke ordinary CONNECT and
 * set datistemplate. Superuser can still clone or drop without a session on it.
 */
export async function freezeTemplateDatabase(
  databaseName: string,
  requiredPrefix: string,
): Promise<void> {
  assertDisposableDatabaseName(databaseName, requiredPrefix);
  const admin = adminPool();
  try {
    await terminateDatabaseBackends(admin, databaseName);
    await admin.query(`REVOKE CONNECT ON DATABASE "${databaseName}" FROM PUBLIC`);
    const cfg = loadPostgresTargetConfig();
    await admin.query(`REVOKE CONNECT ON DATABASE "${databaseName}" FROM "${cfg.user}"`).catch(
      () => undefined,
    );
    await admin.query(`UPDATE pg_database SET datistemplate = true WHERE datname = $1`, [
      databaseName,
    ]);
  } finally {
    await admin.end();
  }
}

export async function dropDisposableDatabase(
  databaseName: string,
  requiredPrefix: string,
): Promise<void> {
  assertDisposableDatabaseName(databaseName, requiredPrefix);
  const admin = adminPool();
  try {
    await terminateDatabaseBackends(admin, databaseName);
    await admin
      .query(`UPDATE pg_database SET datistemplate = false WHERE datname = $1`, [databaseName])
      .catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** Clone `targetDatabaseName` from `sourceDatabaseName` via CREATE DATABASE … TEMPLATE. */
export async function cloneDatabaseFromTemplate(
  sourceDatabaseName: string,
  targetDatabaseName: string,
  options: { sourceRequiredPrefix?: string; targetRequiredPrefix: string },
): Promise<void> {
  if (options.sourceRequiredPrefix) {
    assertDisposableDatabaseName(sourceDatabaseName, options.sourceRequiredPrefix);
  } else if (isProtectedDatabaseName(sourceDatabaseName)) {
    throw new Error(`refusing to clone from protected database "${sourceDatabaseName}"`);
  }
  assertDisposableDatabaseName(targetDatabaseName, options.targetRequiredPrefix);

  const admin = adminPool();
  try {
    await terminateDatabaseBackends(admin, sourceDatabaseName);
    await admin.query(`CREATE DATABASE "${targetDatabaseName}" TEMPLATE "${sourceDatabaseName}"`);
  } finally {
    await admin.end();
  }
}
