/**
 * SQLite persistence foundation (F0).
 *
 * ADR-009: SQLite behind repository interfaces; rich trip/case state stays
 * JSON-friendly. Logical stores per ARCHITECTURE.md §16: trips, cases,
 * signals/events, sources, audit. Lane A1 owns the repository implementations
 * built on top of this skeleton.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SCHEMA_VERSION = 2;

/**
 * JSON-friendly logical stores. Lane A1 may evolve column sets as long as the
 * repository interfaces in `src/contracts/repositories.ts` stay stable.
 *
 * A1 additions: `entities` (context entities + constraints outside the Trip
 * aggregate) and `source_contents` (raw content kept outside trip state).
 */
const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  trip_id TEXT,
  occurred_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_contents (
  source_id TEXT PRIMARY KEY,
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  entity_type TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (entity_type, id)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_trip ON cases (trip_id);
CREATE INDEX IF NOT EXISTS idx_signals_trip ON signals (trip_id);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit (subject);
`;

/** Open (and migrate) a SQLite database. `:memory:` is supported for tests. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(DDL);
  db.prepare(
    'INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('schema_version', String(SCHEMA_VERSION));
  return db;
}

/** Simple key/value helper over `schema_meta` for small runtime metadata. */
export function kvGet(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/**
 * Run `work` inside an IMMEDIATE transaction. Any thrown error rolls the
 * whole unit of work back — authoritative mutations are all-or-nothing.
 */
export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
