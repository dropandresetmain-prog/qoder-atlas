/**
 * M10 Phase 3 — offline legacy exporter proofs.
 *
 * This is the one place SQLite is legitimately under test in forward M10
 * work: the exporter's entire job is to read the frozen legacy migration
 * input, so a SQLite fixture IS the boundary under test. That does not make
 * SQLite a runtime — `test/m10-runtime-purge.test.ts` separately proves no
 * normal-execution path can reach it.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPORTER_VERSION,
  exportLegacyDataset,
  serialiseBundle,
} from '../src/migration/legacyExporter.ts';
import { openLegacySqliteSource } from '../src/migration/legacySqliteSource.ts';
import { bundleRecordCount } from '../src/migration/legacyExportBundle.ts';
import { LEGACY_CATEGORIES } from '../src/migration/legacyCategories.ts';

const CUTOFF = '2026-03-01T00:00:00Z';

const workDirs: string[] = [];

after(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A legacy dataset built through raw DDL matching `persistence/database.ts`
 * plus the four lazily-created app-owned tables. Written raw rather than via
 * `openDatabase`/the legacy repositories so the fixture can contain the
 * imperfect data a real deployment has — a corrupt payload, a
 * multi-traveller trip — which validating writers would refuse to store.
 */
function buildLegacyFixture(options: { includeAppTables: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'm10-legacy-'));
  workDirs.push(dir);
  const path = join(dir, 'legacy.db');
  const db = new DatabaseSync(path);

  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trips (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE cases (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE signals (id TEXT PRIMARY KEY, trip_id TEXT, occurred_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, retrieved_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE source_contents (source_id TEXT PRIMARY KEY, content TEXT NOT NULL);
    CREATE TABLE entities (entity_type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity_type, id));
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT, payload TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', '2');

  const insertEntity = db.prepare('INSERT INTO entities (entity_type, id, data) VALUES (?, ?, ?)');
  insertEntity.run('ORGANISATION', 'org-1', JSON.stringify({ id: 'org-1', name: 'Legacy Org' }));
  insertEntity.run('TRAVELLER', 'trav-1', JSON.stringify({ id: 'trav-1', displayName: 'Traveller One' }));
  insertEntity.run('TRAVELLER', 'trav-2', JSON.stringify({ id: 'trav-2', displayName: 'Traveller Two' }));
  insertEntity.run(
    'CONSTRAINT',
    'con-1',
    JSON.stringify({ id: 'con-1', label: 'Arrive before opening', status: 'FAIL', subjectId: 'trip-single' }),
  );
  // Deliberately corrupt: a real dataset can hold a row no validator would
  // have accepted. The exporter must preserve it, not drop or repair it.
  insertEntity.run('PLACE', 'place-broken', '{ this is not json');

  const insertTrip = db.prepare('INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)');
  insertTrip.run(
    'trip-single',
    3,
    JSON.stringify({ id: 'trip-single', travellerIds: ['trav-1'], label: 'Single traveller trip', elements: [] }),
    '2026-02-01T10:00:00Z',
  );
  insertTrip.run(
    'trip-multi',
    5,
    JSON.stringify({
      id: 'trip-multi',
      travellerIds: ['trav-1', 'trav-2'],
      label: 'Multi traveller trip',
      elements: [{ id: 'el-1', kind: 'FLIGHT' }],
    }),
    '2026-02-02T10:00:00Z',
  );
  // After the freeze boundary — must be excluded by the cutoff.
  insertTrip.run(
    'trip-after-cutoff',
    1,
    JSON.stringify({ id: 'trip-after-cutoff', travellerIds: ['trav-1'], label: 'Later', elements: [] }),
    '2026-06-01T10:00:00Z',
  );

  db.prepare('INSERT INTO cases (id, trip_id, status, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'case-1',
    'trip-single',
    'OPEN',
    2,
    JSON.stringify({ id: 'case-1', tripId: 'trip-single', status: 'OPEN' }),
    '2026-02-03T10:00:00Z',
  );
  db.prepare('INSERT INTO signals (id, trip_id, occurred_at, data) VALUES (?, ?, ?, ?)').run(
    'sig-1',
    'trip-single',
    '2026-02-01T09:00:00Z',
    JSON.stringify({ id: 'sig-1', tripId: 'trip-single', kind: 'DELAY' }),
  );
  db.prepare('INSERT INTO sources (id, kind, retrieved_at, data) VALUES (?, ?, ?, ?)').run(
    'src-1',
    'OPERATOR',
    '2026-01-15T08:00:00Z',
    JSON.stringify({ id: 'src-1', kind: 'OPERATOR' }),
  );
  db.prepare('INSERT INTO source_contents (source_id, content) VALUES (?, ?)').run('src-1', 'raw operator note');
  const insertAudit = db.prepare(
    'INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)',
  );
  insertAudit.run('2026-02-01T11:00:00Z', 'operator:a', 'TRIP_UPDATED', 'trip-single', JSON.stringify({ n: 1 }));
  insertAudit.run('2026-02-04T11:00:00Z', 'operator:b', 'CASE_APPROVED', 'case-1', JSON.stringify({ n: 2 }));

  if (options.includeAppTables) {
    db.exec(`
      CREATE TABLE booking_dossiers (traveller_id TEXT PRIMARY KEY, flight_data TEXT, hotel_data TEXT);
      CREATE TABLE preferences (id TEXT PRIMARY KEY, traveller_id TEXT NOT NULL, trip_id TEXT, data TEXT NOT NULL);
      CREATE TABLE fx_rates (base_currency TEXT NOT NULL, home_currency TEXT NOT NULL, rate_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (rate_id));
      CREATE TABLE provider_event_inbox (provider_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, received_at TEXT NOT NULL, raw_payload TEXT NOT NULL, processed_status TEXT, processed_outcome TEXT, PRIMARY KEY (provider_id, provider_event_id));
    `);
    db.prepare('INSERT INTO booking_dossiers (traveller_id, flight_data, hotel_data) VALUES (?, ?, ?)').run(
      'trav-1',
      JSON.stringify({ travellerId: 'trav-1', passengers: [{ givenName: 'One', familyName: 'Traveller' }] }),
      null,
    );
    db.prepare('INSERT INTO preferences (id, traveller_id, trip_id, data) VALUES (?, ?, ?, ?)').run(
      'pref-1',
      'trav-1',
      null,
      JSON.stringify({ id: 'pref-1', travellerId: 'trav-1', kind: 'SEAT', value: 'AISLE' }),
    );
    db.prepare('INSERT INTO fx_rates (base_currency, home_currency, rate_id, data) VALUES (?, ?, ?, ?)').run(
      'EUR',
      'USD',
      'fx-1',
      JSON.stringify({ id: 'fx-1', baseCurrency: 'EUR', homeCurrency: 'USD', rate: '1.09' }),
    );
    db.prepare(
      'INSERT INTO provider_event_inbox (provider_id, provider_event_id, received_at, raw_payload, processed_status) VALUES (?, ?, ?, ?, ?)',
    ).run('atlas', 'evt-1', '2026-02-05T07:00:00Z', JSON.stringify({ pnr: 'AAA111' }), 'PROCESSED');
  }

  db.close();
  return path;
}

function fileFingerprint(path: string): string {
  const stats = statSync(path);
  return `${stats.size}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

test('exporter reads the legacy dataset and captures every source category', () => {
  const path = buildLegacyFixture({ includeAppTables: true });
  const bundle = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: CUTOFF,
  });

  assert.equal(bundle.exporterVersion, EXPORTER_VERSION);
  assert.equal(bundle.dataset.sourceIdentity, 'legacy-deployment-a');
  assert.equal(bundle.dataset.legacySchemaVersion, '2');

  // No category may be silently missing from the catalog's coverage.
  assert.deepEqual(
    bundle.categories.map((category) => category.categoryId).sort(),
    LEGACY_CATEGORIES.map((spec) => spec.categoryId).sort(),
  );

  const byId = new Map(bundle.categories.map((category) => [category.categoryId, category]));
  assert.deepEqual(
    byId.get('TRAVELLER')?.records.map((record) => record.sourceId),
    ['trav-1', 'trav-2'],
  );
  assert.deepEqual(byId.get('PREFERENCE')?.records.map((record) => record.sourceId), ['pref-1']);
  assert.deepEqual(byId.get('BOOKING_DOSSIER')?.records.map((record) => record.sourceId), ['trav-1']);
  assert.deepEqual(byId.get('FX_RATE_EVIDENCE')?.records.map((record) => record.sourceId), ['fx-1']);
  assert.deepEqual(
    byId.get('PROVIDER_EVENT_INBOX')?.records.map((record) => record.sourceId),
    ['atlas:evt-1'],
  );

  // Source record and its separately-stored content travel together.
  const sourceRecord = byId.get('SOURCE_RECORD')?.records[0];
  assert.deepEqual(sourceRecord?.payload, {
    record: { id: 'src-1', kind: 'OPERATOR' },
    content: 'raw operator note',
  });

  // Audit history is append-only integer-keyed; both entries survive in order.
  assert.deepEqual(byId.get('AUDIT_HISTORY')?.records.map((record) => record.sourceId), ['1', '2']);
});

test('export cutoff excludes records after the freeze boundary', () => {
  const path = buildLegacyFixture({ includeAppTables: true });
  const bundle = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: CUTOFF,
  });
  const trips = bundle.categories.find((category) => category.categoryId === 'TRIP');
  assert.deepEqual(trips?.records.map((record) => record.sourceId), ['trip-single', 'trip-multi']);
  assert.equal(trips?.cutoffApplied, true);

  // A later cutoff includes it — proving exclusion was the cutoff, not a bug.
  const laterBundle = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: '2026-12-01T00:00:00Z',
  });
  assert.deepEqual(
    laterBundle.categories.find((category) => category.categoryId === 'TRIP')?.records.map((r) => r.sourceId),
    ['trip-single', 'trip-multi', 'trip-after-cutoff'],
  );
  assert.notEqual(laterBundle.datasetHash, bundle.datasetHash);
});

test('an unparseable legacy payload is preserved verbatim and reported, never dropped', () => {
  const path = buildLegacyFixture({ includeAppTables: true });
  const bundle = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: CUTOFF,
  });

  const place = bundle.categories.find((category) => category.categoryId === 'PLACE');
  const broken = place?.records.find((record) => record.sourceId === 'place-broken');
  assert.ok(broken, 'the corrupt row is still exported');
  assert.equal(broken.payload, null);
  assert.equal(broken.rawUnparseableText, '{ this is not json');
  assert.ok(broken.sourceHash.length > 0, 'a corrupt row still gets a stable source hash');

  const anomaly = bundle.sourceAnomalies.find((entry) => entry.sourceId === 'place-broken');
  assert.ok(anomaly, 'the anomaly is reported for reconciliation to own');
  assert.match(anomaly.reason, /not parseable JSON/);
});

test('export is deterministic: same dataset, same hash and same content', () => {
  const path = buildLegacyFixture({ includeAppTables: true });
  const request = {
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: CUTOFF,
  };
  const first = exportLegacyDataset({ ...request, now: () => '2026-03-02T00:00:00Z' });
  const second = exportLegacyDataset({ ...request, now: () => '2026-09-16T12:00:00Z' });

  assert.equal(first.datasetHash, second.datasetHash, 'wall-clock export time must not affect dataset identity');
  assert.equal(
    serialiseBundle({ ...first, dataset: { ...first.dataset, exportedAt: 'PINNED' } }),
    serialiseBundle({ ...second, dataset: { ...second.dataset, exportedAt: 'PINNED' } }),
    'bundle content is byte-identical apart from the wall clock',
  );
});

test('changing one legacy row changes that record hash and the dataset hash', () => {
  const path = buildLegacyFixture({ includeAppTables: true });
  const before = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: CUTOFF,
  });

  const writable = new DatabaseSync(path);
  writable
    .prepare('UPDATE trips SET data = ? WHERE id = ?')
    .run(
      JSON.stringify({ id: 'trip-single', travellerIds: ['trav-1'], label: 'Renamed by an operator', elements: [] }),
      'trip-single',
    );
  writable.close();

  const after = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-a',
    exportCutoff: CUTOFF,
  });

  const recordHash = (bundle: typeof before, sourceId: string) =>
    bundle.categories
      .find((category) => category.categoryId === 'TRIP')
      ?.records.find((record) => record.sourceId === sourceId)?.sourceHash;

  assert.notEqual(recordHash(after, 'trip-single'), recordHash(before, 'trip-single'));
  assert.equal(recordHash(after, 'trip-multi'), recordHash(before, 'trip-multi'), 'untouched rows keep their hash');
  assert.notEqual(after.datasetHash, before.datasetHash);
});

test('exporting performs zero writes to the legacy source', () => {
  const path = buildLegacyFixture({ includeAppTables: true });
  const fingerprintBefore = fileFingerprint(path);

  exportLegacyDataset({ sqlitePath: path, sourceIdentity: 'legacy-deployment-a', exportCutoff: CUTOFF });
  exportLegacyDataset({ sqlitePath: path, sourceIdentity: 'legacy-deployment-a', exportCutoff: CUTOFF });

  assert.equal(fileFingerprint(path), fingerprintBefore, 'the legacy database file is byte-identical after export');
});

test('read-only is enforced by SQLite, and an absent table reads as empty', () => {
  const path = buildLegacyFixture({ includeAppTables: true });

  const source = openLegacySqliteSource(path);
  try {
    assert.deepEqual(source.rows('nonexistent_table', ['id']), [], 'an absent table reads as empty, not an error');
    assert.ok(source.tables().includes('trips'));
  } finally {
    source.close();
  }

  // The mode `openLegacySqliteSource` opens with, exercised directly: SQLite
  // itself refuses both a write and the WAL pragma that
  // `persistence/database.ts#openDatabase` would have issued on open — which
  // is precisely why the exporter must not use `openDatabase`.
  const readOnly = new DatabaseSync(path, { readOnly: true });
  try {
    assert.throws(() => readOnly.exec("UPDATE trips SET version = 99 WHERE id = 'trip-single'"), /readonly/i);
    assert.throws(() => readOnly.exec('PRAGMA journal_mode = WAL'), /readonly/i);
  } finally {
    readOnly.close();
  }
});

test('a dataset without the lazily-created app tables exports cleanly', () => {
  const path = buildLegacyFixture({ includeAppTables: false });
  const bundle = exportLegacyDataset({
    sqlitePath: path,
    sourceIdentity: 'legacy-deployment-b',
    exportCutoff: CUTOFF,
  });

  for (const categoryId of ['PREFERENCE', 'BOOKING_DOSSIER', 'FX_RATE_EVIDENCE', 'PROVIDER_EVENT_INBOX']) {
    const category = bundle.categories.find((entry) => entry.categoryId === categoryId);
    assert.equal(category?.sourceTableAbsent, true, `${categoryId} is reported absent, not silently empty`);
    assert.deepEqual(category?.records, []);
  }
  assert.ok(bundleRecordCount(bundle) > 0);
});
