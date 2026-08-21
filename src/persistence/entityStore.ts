/**
 * A1 — persistence for context entities that live outside the Trip
 * aggregate (organisations, travellers, anchor events, places, rule sets)
 * plus standalone constraints. The frozen repository seams cover
 * Trip/Case/Signal/Source/Audit; this store is Lane A's supporting seam for
 * snapshot assembly, constraint evaluation and authority context.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ENTITY_SCHEMA_BY_TYPE } from '../operational/mutation.ts';
import type { EntityType } from '../domain/common.ts';
import type { ContextEntity } from '../engine/applyOperations.ts';

/** Entity types stored here; trips live in the TripRepository instead. */
const STORED_TYPES: readonly EntityType[] = [
  'ORGANISATION',
  'TRAVELLER',
  'ANCHOR_EVENT',
  'PLACE',
  'RULE_SET',
  'CONSTRAINT',
];

export interface EntityStore {
  upsert(entry: ContextEntity): Promise<void>;
  get(entityType: EntityType, id: string): Promise<ContextEntity | undefined>;
  list(entityType: EntityType): Promise<ContextEntity[]>;
}

export class SqliteEntityStore implements EntityStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async upsert(entry: ContextEntity): Promise<void> {
    if (!STORED_TYPES.includes(entry.entityType)) {
      throw new Error(`entity store does not hold ${entry.entityType}`);
    }
    const schema = ENTITY_SCHEMA_BY_TYPE[entry.entityType] as z.ZodType;
    const validated = schema.parse(entry.entity);
    const id = (validated as { id: string }).id;
    this.db
      .prepare(
        `INSERT INTO entities (entity_type, id, data) VALUES (?, ?, ?)
         ON CONFLICT(entity_type, id) DO UPDATE SET data = excluded.data`,
      )
      .run(entry.entityType, id, JSON.stringify(validated));
  }

  async get(entityType: EntityType, id: string): Promise<ContextEntity | undefined> {
    const row = this.db
      .prepare('SELECT data FROM entities WHERE entity_type = ? AND id = ?')
      .get(entityType, id) as { data: string } | undefined;
    if (!row) return undefined;
    return parseEntry(entityType, row.data);
  }

  async list(entityType: EntityType): Promise<ContextEntity[]> {
    const rows = this.db
      .prepare('SELECT data FROM entities WHERE entity_type = ?')
      .all(entityType) as Array<{ data: string }>;
    return rows.map((row) => parseEntry(entityType, row.data));
  }
}

function parseEntry(entityType: EntityType, data: string): ContextEntity {
  const schema = ENTITY_SCHEMA_BY_TYPE[entityType] as z.ZodType;
  const entity = schema.parse(JSON.parse(data));
  return { entityType, entity } as ContextEntity;
}
