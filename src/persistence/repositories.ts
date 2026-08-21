/**
 * A1 — SQLite implementations of the frozen repository seams
 * (`src/contracts/repositories.ts`). Rich state stays JSON-friendly
 * (ADR-009/ADR-020); every write is schema-validated at the boundary and
 * every read is re-parsed so stored corruption fails loudly (NFR-04).
 *
 * Version/coherency: saving a Trip/Case with a version lower than the stored
 * one is rejected — stale snapshots never overwrite newer authoritative
 * state. Saving an equal version is an idempotent no-op.
 */
import type { DatabaseSync } from 'node:sqlite';
import { instantMillis } from '../domain/common.ts';
import { SourceRecordSchema, type SourceKind, type SourceRecord } from '../domain/common.ts';
import { TripSchema, type Trip } from '../domain/trip.ts';
import { RecoveryCaseSchema, type RecoveryCase } from '../operational/case.ts';
import { TripSignalSchema, type TripSignal } from '../operational/signal.ts';
import type {
  AuditEntry,
  AuditQuery,
  AuditRepository,
  CaseRepository,
  SignalRepository,
  SourceRepository,
  TripRepository,
  TripSummary,
} from '../contracts/repositories.ts';

/** Thrown when a save would roll persisted state back to an older version. */
export class StaleVersionError extends Error {
  constructor(store: string, id: string, storedVersion: number, incomingVersion: number) {
    super(
      `${store} ${id}: stored version ${storedVersion} is newer than incoming version ${incomingVersion}`,
    );
    this.name = 'StaleVersionError';
  }
}

export class SqliteTripRepository implements TripRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async saveTrip(trip: Trip): Promise<void> {
    const validated = TripSchema.parse(trip);
    const existing = this.db.prepare('SELECT version FROM trips WHERE id = ?').get(validated.id) as
      | { version: number }
      | undefined;
    if (existing && existing.version > validated.version) {
      throw new StaleVersionError('trip', validated.id, existing.version, validated.version);
    }
    this.db
      .prepare(
        `INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(validated.id, validated.version, JSON.stringify(validated), validated.updatedAt);
  }

  async getTrip(tripId: string): Promise<Trip | undefined> {
    const row = this.db.prepare('SELECT data FROM trips WHERE id = ?').get(tripId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    return TripSchema.parse(JSON.parse(row.data));
  }

  async listTrips(): Promise<TripSummary[]> {
    const rows = this.db.prepare('SELECT data FROM trips').all() as Array<{
      data: string;
    }>;
    const trips = rows.map((row) => TripSchema.parse(JSON.parse(row.data)));
    trips.sort((a, b) => instantMillis(a.updatedAt) - instantMillis(b.updatedAt));
    return trips.map((trip) => ({
      tripId: trip.id,
      label: trip.label,
      travellerIds: trip.travellerIds,
      anchorEventId: trip.anchorEventId,
      viability: trip.viability,
      updatedAt: trip.updatedAt,
    }));
  }
}

export class SqliteCaseRepository implements CaseRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async saveCase(recoveryCase: RecoveryCase): Promise<void> {
    const validated = RecoveryCaseSchema.parse(recoveryCase);
    const existing = this.db.prepare('SELECT version FROM cases WHERE id = ?').get(validated.id) as
      | { version: number }
      | undefined;
    if (existing && existing.version > validated.version) {
      throw new StaleVersionError('case', validated.id, existing.version, validated.version);
    }
    this.db
      .prepare(
        `INSERT INTO cases (id, trip_id, status, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET trip_id = excluded.trip_id, status = excluded.status,
           version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(
        validated.id,
        validated.tripId,
        validated.status,
        validated.version,
        JSON.stringify(validated),
        validated.updatedAt,
      );
  }

  async getCase(caseId: string): Promise<RecoveryCase | undefined> {
    const row = this.db.prepare('SELECT data FROM cases WHERE id = ?').get(caseId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    return RecoveryCaseSchema.parse(JSON.parse(row.data));
  }

  async listCasesForTrip(tripId: string): Promise<RecoveryCase[]> {
    const rows = this.db
      .prepare('SELECT data FROM cases WHERE trip_id = ?')
      .all(tripId) as Array<{ data: string }>;
    const cases = rows.map((row) => RecoveryCaseSchema.parse(JSON.parse(row.data)));
    return cases.sort((a, b) => instantMillis(a.updatedAt) - instantMillis(b.updatedAt));
  }

  async listOpenCases(): Promise<RecoveryCase[]> {
    const rows = this.db
      .prepare('SELECT data FROM cases WHERE status != ?')
      .all('RESOLVED') as Array<{ data: string }>;
    const cases = rows.map((row) => RecoveryCaseSchema.parse(JSON.parse(row.data)));
    return cases.sort((a, b) => instantMillis(a.updatedAt) - instantMillis(b.updatedAt));
  }
}

export class SqliteSignalRepository implements SignalRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async saveSignal(signal: TripSignal): Promise<void> {
    const validated = TripSignalSchema.parse(signal);
    this.db
      .prepare(
        `INSERT INTO signals (id, trip_id, occurred_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET trip_id = excluded.trip_id, occurred_at = excluded.occurred_at, data = excluded.data`,
      )
      .run(validated.id, validated.tripId ?? null, validated.occurredAt, JSON.stringify(validated));
  }

  async getSignal(signalId: string): Promise<TripSignal | undefined> {
    const row = this.db.prepare('SELECT data FROM signals WHERE id = ?').get(signalId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    return TripSignalSchema.parse(JSON.parse(row.data));
  }

  async listSignalsForTrip(tripId: string): Promise<TripSignal[]> {
    const rows = this.db
      .prepare('SELECT data FROM signals WHERE trip_id = ? ORDER BY occurred_at ASC')
      .all(tripId) as Array<{ data: string }>;
    const signals = rows.map((row) => TripSignalSchema.parse(JSON.parse(row.data)));
    // Chronological ordering must be instant-based (ADR-023): offsets differ.
    return signals.sort((a, b) => instantMillis(a.occurredAt) - instantMillis(b.occurredAt));
  }
}

export class SqliteSourceRepository implements SourceRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async saveSource(source: SourceRecord): Promise<void> {
    const validated = SourceRecordSchema.parse(source);
    this.db
      .prepare(
        `INSERT INTO sources (id, kind, retrieved_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, retrieved_at = excluded.retrieved_at, data = excluded.data`,
      )
      .run(validated.id, validated.kind, validated.retrievedAt, JSON.stringify(validated));
  }

  async getSource(sourceId: string): Promise<SourceRecord | undefined> {
    const row = this.db.prepare('SELECT data FROM sources WHERE id = ?').get(sourceId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    return SourceRecordSchema.parse(JSON.parse(row.data));
  }

  async listSources(kind?: SourceKind): Promise<SourceRecord[]> {
    const rows = (
      kind === undefined
        ? this.db.prepare('SELECT data FROM sources').all()
        : this.db.prepare('SELECT data FROM sources WHERE kind = ?').all(kind)
    ) as Array<{ data: string }>;
    const sources = rows.map((row) => SourceRecordSchema.parse(JSON.parse(row.data)));
    return sources.sort((a, b) => instantMillis(a.retrievedAt) - instantMillis(b.retrievedAt));
  }

  async saveSourceContent(sourceId: string, content: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO source_contents (source_id, content) VALUES (?, ?)
         ON CONFLICT(source_id) DO UPDATE SET content = excluded.content`,
      )
      .run(sourceId, content);
  }

  async getSourceContent(sourceId: string): Promise<string | undefined> {
    const row = this.db
      .prepare('SELECT content FROM source_contents WHERE source_id = ?')
      .get(sourceId) as { content: string } | undefined;
    return row?.content;
  }
}

export class SqliteAuditRepository implements AuditRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async append(entry: AuditEntry): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        entry.occurredAt,
        entry.actor,
        entry.action,
        entry.subject ?? null,
        JSON.stringify(entry.payload),
      );
  }

  async query(filter: AuditQuery): Promise<AuditEntry[]> {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.subject !== undefined) {
      clauses.push('subject = ?');
      params.push(filter.subject);
    }
    if (filter.action !== undefined) {
      clauses.push('action = ?');
      params.push(filter.action);
    }
    const sql = `SELECT occurred_at, actor, action, subject, payload FROM audit
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}`;
    const rows = this.db.prepare(sql).all(...params) as Array<{
      occurred_at: string;
      actor: string;
      action: string;
      subject: string | null;
      payload: string;
    }>;
    let entries = rows.map((row) => ({
      occurredAt: row.occurred_at,
      actor: row.actor,
      action: row.action,
      subject: row.subject ?? undefined,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
    if (filter.since !== undefined) {
      // Instant comparison, not lexicographic (ADR-023).
      entries = entries.filter((entry) => instantMillis(entry.occurredAt) >= instantMillis(filter.since as string));
    }
    entries.sort((a, b) => instantMillis(b.occurredAt) - instantMillis(a.occurredAt));
    if (filter.limit !== undefined) {
      entries = entries.slice(0, filter.limit);
    }
    return entries;
  }
}
