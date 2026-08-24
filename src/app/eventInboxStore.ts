/**
 * DR-3 — application-owned raw provider-event inbox (compose.ts integration
 * seam), mirroring the dossierStore.ts idiom: a lazily-created SQLite table
 * outside the frozen persistence schema, since raw provider delivery
 * evidence is not an authoritative graph entity.
 *
 * Every delivered event is persisted here BEFORE any normalization/
 * processing happens, keyed by (providerId, providerEventId) so a duplicate
 * delivery is detected deterministically — never by re-deriving identity
 * from the payload content. This is what makes "duplicate provider event id
 * does not create duplicate signal/case/action" provable: processing only
 * ever proceeds past a delivery this store has never seen before.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { IsoDateTime } from '../domain/common.ts';

export interface RawProviderEventRecord {
  providerId: string;
  providerEventId: string;
  receivedAt: IsoDateTime;
  /** Raw wire payload exactly as delivered; provider-specific shape. */
  rawPayload: unknown;
}

export interface RecordDeliveryOutcome {
  /** False when this exact (providerId, providerEventId) was already recorded. */
  inserted: boolean;
  firstSeenAt: IsoDateTime;
}

export interface EventInboxStore {
  /** Persist the raw delivery. Must be called before any processing. */
  recordDelivery(record: RawProviderEventRecord): Promise<RecordDeliveryOutcome>;
  /** Record the outcome of processing a previously-inserted delivery. */
  markProcessed(
    providerId: string,
    providerEventId: string,
    outcome: { status: string; signalId?: string; caseId?: string; tripId?: string; error?: string },
  ): Promise<void>;
}

export class SqliteEventInboxStore implements EventInboxStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    // Application-owned table; the frozen persistence schema is untouched.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_event_inbox (
        provider_id TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        processed_status TEXT,
        processed_outcome TEXT,
        PRIMARY KEY (provider_id, provider_event_id)
      );
    `);
  }

  async recordDelivery(record: RawProviderEventRecord): Promise<RecordDeliveryOutcome> {
    const inserted = this.db
      .prepare(
        `INSERT INTO provider_event_inbox (provider_id, provider_event_id, received_at, raw_payload)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_id, provider_event_id) DO NOTHING`,
      )
      .run(record.providerId, record.providerEventId, record.receivedAt, JSON.stringify(record.rawPayload));
    if (inserted.changes > 0) {
      return { inserted: true, firstSeenAt: record.receivedAt };
    }
    const existing = this.db
      .prepare(`SELECT received_at FROM provider_event_inbox WHERE provider_id = ? AND provider_event_id = ?`)
      .get(record.providerId, record.providerEventId) as { received_at: string } | undefined;
    return { inserted: false, firstSeenAt: (existing?.received_at ?? record.receivedAt) as IsoDateTime };
  }

  async markProcessed(
    providerId: string,
    providerEventId: string,
    outcome: { status: string; signalId?: string; caseId?: string; tripId?: string; error?: string },
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE provider_event_inbox SET processed_status = ?, processed_outcome = ?
         WHERE provider_id = ? AND provider_event_id = ?`,
      )
      .run(outcome.status, JSON.stringify(outcome), providerId, providerEventId);
  }
}
