/**
 * I1 — preference persistence owned by the application layer.
 *
 * Preference is intentionally NOT part of the frozen entity registry
 * (ENTITY_SCHEMA_BY_TYPE) — preferences are traveller guidance, not
 * authoritative graph entities, and the frozen contracts cannot express them
 * as entities. Convenience is not an architecture gap: the application layer
 * owns this dedicated table in the same SQLite database, while preference
 * content and precedence semantics stay frozen in `src/domain/preferences.ts`.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { EntityId } from '../domain/common.ts';
import {
  PreferenceSchema,
  preferencePrecedence,
  type Preference,
} from '../domain/preferences.ts';

export interface PreferenceStore {
  save(preference: Preference): Promise<void>;
  /**
   * Preferences in scope for a trip: trip-scoped plus persistent
   * (trip-agnostic) preferences of the trip's travellers. Deterministically
   * ordered: higher precedence first, then by id.
   */
  listForTrip(tripId: EntityId, travellerIds: EntityId[]): Promise<Preference[]>;
  listAll(): Promise<Preference[]>;
}

export class SqlitePreferenceStore implements PreferenceStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    // Application-owned table; the frozen schema in persistence/database.ts
    // is untouched. Content is re-validated on every read.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        id TEXT PRIMARY KEY,
        traveller_id TEXT NOT NULL,
        trip_id TEXT,
        data TEXT NOT NULL
      );
    `);
  }

  async save(preference: Preference): Promise<void> {
    const validated = PreferenceSchema.parse(preference);
    this.db
      .prepare(
        `INSERT INTO preferences (id, traveller_id, trip_id, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET traveller_id = excluded.traveller_id,
           trip_id = excluded.trip_id, data = excluded.data`,
      )
      .run(validated.id, validated.travellerId, validated.tripId ?? null, JSON.stringify(validated));
  }

  async listForTrip(tripId: EntityId, travellerIds: EntityId[]): Promise<Preference[]> {
    if (travellerIds.length === 0) return [];
    const placeholders = travellerIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT data FROM preferences
         WHERE traveller_id IN (${placeholders}) AND (trip_id IS NULL OR trip_id = ?)`,
      )
      .all(...travellerIds, tripId) as Array<{ data: string }>;
    return sortDeterministically(rows.map((row) => PreferenceSchema.parse(JSON.parse(row.data))));
  }

  async listAll(): Promise<Preference[]> {
    const rows = this.db.prepare('SELECT data FROM preferences').all() as Array<{ data: string }>;
    return sortDeterministically(rows.map((row) => PreferenceSchema.parse(JSON.parse(row.data))));
  }
}

/** Precedence descending, id ascending — identical input, identical order. */
function sortDeterministically(preferences: Preference[]): Preference[] {
  return preferences.sort((a, b) => {
    const diff = preferencePrecedence(b) - preferencePrecedence(a);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
