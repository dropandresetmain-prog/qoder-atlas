/**
 * M10 Phase 3 — the ONLY sanctioned way to touch a legacy SQLite dataset.
 *
 * NORTHSTAR has one runtime and it is PostgreSQL. SQLite survives solely as
 * offline, read-only migration input, so this module is deliberately NOT
 * reachable from `src/main.ts`, `src/app/**` or `src/server/**` — see
 * `test/m10-runtime-purge.test.ts`, which walks the real import graph and
 * fails if any normal-execution file reaches it.
 *
 * The connection is opened `readOnly`, which makes SQLite itself reject
 * every write attempt (verified: `INSERT` and even
 * `PRAGMA journal_mode = WAL` both fail with "attempt to write a readonly
 * database"). That is why this module must not go through
 * `persistence/database.ts#openDatabase`: that function writes — WAL pragma,
 * `CREATE TABLE IF NOT EXISTS` DDL and a `schema_meta` upsert — before any
 * read happens, which would mutate the frozen migration source.
 *
 * Rows are read raw rather than through the legacy repositories' zod
 * re-parse, so a single corrupt legacy row becomes a quarantine candidate
 * instead of aborting the export.
 */
import { DatabaseSync } from 'node:sqlite';

/** A raw legacy row, before any category mapping or schema interpretation. */
export interface LegacyRawRow {
  [column: string]: string | number | bigint | null | Uint8Array;
}

export interface LegacySqliteSource {
  /** Table names actually present in this dataset, sorted. */
  tables(): string[];
  /** `schema_meta` value, or undefined when the key (or the table) is absent. */
  meta(key: string): string | undefined;
  /**
   * Read every row of `table`. Returns an empty array when the table is
   * absent: the app-owned legacy tables (`preferences`, `booking_dossiers`,
   * `fx_rates`, `provider_event_inbox`) were created lazily on first write,
   * so a real dataset legitimately may not have them.
   */
  rows(table: string, columns: readonly string[]): LegacyRawRow[];
  close(): void;
}

/**
 * Open a legacy dataset read-only. Throws if the file does not exist —
 * `readOnly` mode will not create one, which is the behaviour we want: a
 * missing migration source is an operator error, not an empty export.
 */
export function openLegacySqliteSource(path: string): LegacySqliteSource {
  const db = new DatabaseSync(path, { readOnly: true });

  const presentTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );

  return {
    tables() {
      return [...presentTables].sort();
    },
    meta(key) {
      if (!presentTables.has('schema_meta')) return undefined;
      const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },
    rows(table, columns) {
      if (!presentTables.has(table)) return [];
      // Column list is exporter-owned (never caller/request-derived), so
      // there is no injection surface here; SQLite has no parameter form for
      // identifiers.
      const projection = columns.join(', ');
      return db.prepare(`SELECT ${projection} FROM ${table}`).all() as LegacyRawRow[];
    },
    close() {
      db.close();
    },
  };
}
