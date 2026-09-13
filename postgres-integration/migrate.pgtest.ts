import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runMigrations,
  migrationStatus,
  MigrationChecksumDriftError,
  MigrationApplyError,
  loadMigrationFiles,
} from '../src/persistence/postgres/migrate.ts';
import { createEphemeralDatabase, MIGRATIONS_DIR } from './harness.ts';

describe('M1 migration runner (real PostgreSQL, empty database each time)', () => {
  test('ordered migrations create the target foundation from an empty database', async () => {
    const db = await createEphemeralDatabase();
    try {
      const result = await runMigrations(db.pool, MIGRATIONS_DIR);
      assert.equal(result.alreadyApplied.length, 0);
      assert.deepEqual(
        result.applied,
        loadMigrationFiles(MIGRATIONS_DIR).map((f) => f.version),
      );

      const tables = await db.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
      );
      const names = tables.rows.map((r) => r.table_name);
      for (const expected of [
        'workspaces',
        'subject_kinds',
        'domain_subjects',
        'aggregate_heads',
        'command_receipts',
        'change_records',
        'scope_kinds',
        'scope_generations',
        'inbox_deliveries',
        'inbox_delivery_conflicts',
        'inbox_work',
        'outbox',
        'legacy_id_map',
        'migration_runs',
        'schema_migrations',
      ]) {
        assert.ok(names.includes(expected), `expected table ${expected} to exist, got: ${names.join(', ')}`);
      }

      const postgis = await db.pool.query<{ postgis_version: string }>('SELECT postgis_version()');
      assert.ok(postgis.rows[0]?.postgis_version, 'PostGIS extension must be installed');
    } finally {
      await db.drop();
    }
  });

  test('re-running migrations on an already-migrated database is a no-op (supported predecessor path: current -> current)', async () => {
    const db = await createEphemeralDatabase();
    try {
      const first = await runMigrations(db.pool, MIGRATIONS_DIR);
      assert.ok(first.applied.length > 0);
      const second = await runMigrations(db.pool, MIGRATIONS_DIR);
      assert.deepEqual(second.applied, []);
      assert.deepEqual(second.alreadyApplied, first.applied);
    } finally {
      await db.drop();
    }
  });

  test('a failing migration is rolled back and never recorded as applied', async () => {
    const db = await createEphemeralDatabase();
    const tmpDir = mkdtempSync(join(tmpdir(), 'northstar-m1-migrations-'));
    try {
      for (const file of readdirSync(MIGRATIONS_DIR)) {
        cpSync(join(MIGRATIONS_DIR, file), join(tmpDir, file));
      }
      // Inject a broken migration after the real ones (0001-0009) that
      // references a nonexistent table so it fails mid-migration. Must match
      // the runner's `^\d{4}_.+\.sql$` naming convention to be picked up.
      writeFileSync(
        join(tmpDir, '0099_broken.sql'),
        'CREATE TABLE this_is_fine (id uuid PRIMARY KEY);\nALTER TABLE this_does_not_exist ADD COLUMN x text;\n',
      );

      await assert.rejects(() => runMigrations(db.pool, tmpDir), MigrationApplyError);

      const applied = await db.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
      assert.ok(!applied.rows.some((r) => r.version === '0099'), '0099 must not be recorded as applied');
      const brokenTable = await db.pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'this_is_fine'`,
      );
      assert.equal(brokenTable.rows.length, 0, 'this_is_fine must not exist — the whole failing migration rolled back');
    } finally {
      await db.drop();
    }
  });

  test('checksum drift on an already-applied migration fails visibly and applies nothing further', async () => {
    const db = await createEphemeralDatabase();
    try {
      await runMigrations(db.pool, MIGRATIONS_DIR);
      await db.pool.query(`UPDATE schema_migrations SET checksum = 'corrupted-checksum' WHERE version = '0002'`);

      await assert.rejects(() => runMigrations(db.pool, MIGRATIONS_DIR), MigrationChecksumDriftError);

      const status = await migrationStatus(db.pool, MIGRATIONS_DIR);
      assert.ok(status.driftedVersions.includes('0002'));
    } finally {
      await db.drop();
    }
  });
});
