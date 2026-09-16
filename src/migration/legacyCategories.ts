/**
 * M10 Phase 3 — the legacy source-category catalog.
 *
 * One declarative entry per real legacy store, carrying its frozen migration
 * decision from `docs/IMPLEMENTATION_PLAN.md` §16 /
 * `docs/refactor/evidence/M10_MIGRATION_CONTRACT.md`. Adding a legacy store
 * to the migration means adding a row here, not editing the exporter.
 *
 * Deliberately covers stores whose *runtime* disposition is RETIRE
 * (preferences, booking dossiers, FX evidence, the provider event inbox):
 * retiring a legacy subsystem does not license discarding its deployed data.
 * They are migration source categories, not capabilities to rebuild inside
 * PostgreSQL.
 */
import type { MigrationCategoryDecision } from '../contracts/v2/migration/migrationEnvelope.ts';
import type { LegacyRawRow, LegacySqliteSource } from './legacySqliteSource.ts';

/** A legacy row lifted out of SQLite, before hashing/canonicalisation. */
export interface ExtractedLegacyRecord {
  sourceId: string;
  sourceOrderingKey: string;
  /** Raw JSON text to parse, when the store kept its state in a JSON column. */
  payloadText?: string;
  /** Already-structured payload, for stores spread across several columns. */
  payloadValue?: unknown;
  /** Instant used for cutoff filtering; absent when the store has no timestamp. */
  timestamp?: string;
}

export interface LegacyCategorySpec {
  categoryId: string;
  sourceTable: string;
  /** `legacy_id_map.source_type` value — stable legacy identity namespace. */
  sourceType: string;
  decision: MigrationCategoryDecision;
  /** Whether rows carry a timestamp the export cutoff can filter on. */
  timestamped: boolean;
  extract(source: LegacySqliteSource): ExtractedLegacyRecord[];
}

/** A single legacy column value; `undefined` when the column was absent. */
type LegacyCell = LegacyRawRow[string] | undefined;

function text(value: LegacyCell): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requireText(value: LegacyCell, column: string): string {
  const asText = text(value);
  if (asText === undefined || asText.length === 0) {
    throw new Error(`legacy row is missing required column "${column}"`);
  }
  return asText;
}

/** The frozen `entities` table holds several entity types in one table. */
function entityCategory(
  entityType: string,
  decision: MigrationCategoryDecision,
): LegacyCategorySpec {
  return {
    categoryId: entityType,
    sourceTable: 'entities',
    sourceType: `entities.${entityType}`,
    decision,
    timestamped: false,
    extract(source) {
      return source
        .rows('entities', ['entity_type', 'id', 'data'])
        .filter((row) => text(row.entity_type) === entityType)
        .map((row) => {
          const id = requireText(row.id, 'id');
          return { sourceId: id, sourceOrderingKey: id, payloadText: requireText(row.data, 'data') };
        });
    },
  };
}

/**
 * Catalog order IS migration dependency order, and the exporter emits
 * categories in exactly this order. A category may only reference target
 * subjects produced by a category above it — e.g. constraints resolve their
 * owning Journey, so they must follow TRIP. Keeping one ordering (rather
 * than a separate import order) means the bundle's canonical replay order
 * and the importer's execution order cannot drift apart, which is what makes
 * a resume index meaningful.
 */
export const LEGACY_CATEGORIES: readonly LegacyCategorySpec[] = [
  entityCategory('ORGANISATION', 'MIGRATE_TRANSFORM'),
  entityCategory('TRAVELLER', 'MIGRATE_TRANSFORM'),
  entityCategory('PLACE', 'MIGRATE_TRANSFORM'),
  entityCategory('ANCHOR_EVENT', 'MIGRATE_TRANSFORM'),
  entityCategory('RULE_SET', 'MIGRATE_TRANSFORM'),
  {
    categoryId: 'TRIP',
    sourceTable: 'trips',
    sourceType: 'trips',
    decision: 'MIGRATE_THEN_RECONCILE',
    timestamped: true,
    extract(source) {
      return source.rows('trips', ['id', 'version', 'data', 'updated_at']).map((row) => {
        const id = requireText(row.id, 'id');
        const updatedAt = requireText(row.updated_at, 'updated_at');
        return {
          sourceId: id,
          sourceOrderingKey: `${updatedAt}#${id}`,
          payloadText: requireText(row.data, 'data'),
          timestamp: updatedAt,
        };
      });
    },
  },
  // Definition migrates normally; the persisted PASS/FAIL/UNKNOWN status is
  // archived as historical evidence and recomputed — see legacyImporter.ts.
  // Follows TRIP because a constraint's target owner is a migrated Journey.
  entityCategory('CONSTRAINT', 'TRANSFORM_AND_REASSESS'),
  {
    categoryId: 'RECOVERY_CASE',
    sourceTable: 'cases',
    sourceType: 'cases',
    decision: 'MIGRATE_THEN_RECONCILE',
    timestamped: true,
    extract(source) {
      return source
        .rows('cases', ['id', 'trip_id', 'status', 'version', 'data', 'updated_at'])
        .map((row) => {
          const id = requireText(row.id, 'id');
          const updatedAt = requireText(row.updated_at, 'updated_at');
          return {
            sourceId: id,
            sourceOrderingKey: `${updatedAt}#${id}`,
            payloadText: requireText(row.data, 'data'),
            timestamp: updatedAt,
          };
        });
    },
  },
  {
    categoryId: 'SIGNAL',
    sourceTable: 'signals',
    sourceType: 'signals',
    decision: 'MIGRATE_TRANSFORM',
    timestamped: true,
    extract(source) {
      return source.rows('signals', ['id', 'trip_id', 'occurred_at', 'data']).map((row) => {
        const id = requireText(row.id, 'id');
        const occurredAt = requireText(row.occurred_at, 'occurred_at');
        return {
          sourceId: id,
          sourceOrderingKey: `${occurredAt}#${id}`,
          payloadText: requireText(row.data, 'data'),
          timestamp: occurredAt,
        };
      });
    },
  },
  {
    categoryId: 'SOURCE_RECORD',
    sourceTable: 'sources',
    sourceType: 'sources',
    decision: 'MIGRATE_TRANSFORM',
    timestamped: true,
    extract(source) {
      const contents = new Map(
        source
          .rows('source_contents', ['source_id', 'content'])
          .map((row) => [requireText(row.source_id, 'source_id'), text(row.content)] as const),
      );
      return source.rows('sources', ['id', 'kind', 'retrieved_at', 'data']).map((row) => {
        const id = requireText(row.id, 'id');
        const retrievedAt = requireText(row.retrieved_at, 'retrieved_at');
        // Content lives in a separate table but is the same evidential fact:
        // exporting them apart would let one migrate without the other.
        return {
          sourceId: id,
          sourceOrderingKey: `${retrievedAt}#${id}`,
          payloadValue: {
            record: safeJson(requireText(row.data, 'data')),
            content: contents.get(id) ?? null,
          },
          timestamp: retrievedAt,
        };
      });
    },
  },
  {
    categoryId: 'AUDIT_HISTORY',
    sourceTable: 'audit',
    sourceType: 'audit',
    decision: 'ARCHIVE_AS_IMMUTABLE_HISTORY',
    timestamped: true,
    extract(source) {
      return source
        .rows('audit', ['id', 'occurred_at', 'actor', 'action', 'subject', 'payload'])
        .map((row) => {
          // `audit.id` is an AUTOINCREMENT integer, the only identity this
          // append-only table has.
          if (typeof row.id !== 'number' && typeof row.id !== 'bigint') {
            throw new Error(`legacy audit row has a non-numeric id: ${String(row.id)}`);
          }
          const id = String(row.id);
          const occurredAt = requireText(row.occurred_at, 'occurred_at');
          return {
            sourceId: id,
            sourceOrderingKey: `${occurredAt}#${id.padStart(20, '0')}`,
            payloadValue: {
              occurredAt,
              actor: requireText(row.actor, 'actor'),
              action: requireText(row.action, 'action'),
              subject: text(row.subject) ?? null,
              payload: safeJson(requireText(row.payload, 'payload')),
            },
            timestamp: occurredAt,
          };
        });
    },
  },
  {
    categoryId: 'BOOKING_DOSSIER',
    sourceTable: 'booking_dossiers',
    sourceType: 'booking_dossiers',
    decision: 'MIGRATE_TRANSFORM',
    timestamped: false,
    extract(source) {
      return source
        .rows('booking_dossiers', ['traveller_id', 'flight_data', 'hotel_data'])
        .map((row) => {
          const travellerId = requireText(row.traveller_id, 'traveller_id');
          const flight = text(row.flight_data);
          const hotel = text(row.hotel_data);
          return {
            sourceId: travellerId,
            sourceOrderingKey: travellerId,
            payloadValue: {
              travellerId,
              flight: flight === undefined ? null : safeJson(flight),
              hotel: hotel === undefined ? null : safeJson(hotel),
            },
          };
        });
    },
  },
  {
    categoryId: 'PREFERENCE',
    sourceTable: 'preferences',
    sourceType: 'preferences',
    decision: 'MIGRATE_TRANSFORM',
    timestamped: false,
    extract(source) {
      return source.rows('preferences', ['id', 'traveller_id', 'trip_id', 'data']).map((row) => {
        const id = requireText(row.id, 'id');
        return { sourceId: id, sourceOrderingKey: id, payloadText: requireText(row.data, 'data') };
      });
    },
  },
  {
    categoryId: 'FX_RATE_EVIDENCE',
    sourceTable: 'fx_rates',
    sourceType: 'fx_rates',
    decision: 'ARCHIVE_AS_IMMUTABLE_HISTORY',
    timestamped: false,
    extract(source) {
      return source
        .rows('fx_rates', ['rate_id', 'base_currency', 'home_currency', 'data'])
        .map((row) => {
          const rateId = requireText(row.rate_id, 'rate_id');
          return {
            sourceId: rateId,
            sourceOrderingKey: rateId,
            payloadText: requireText(row.data, 'data'),
          };
        });
    },
  },
  {
    categoryId: 'PROVIDER_EVENT_INBOX',
    sourceTable: 'provider_event_inbox',
    sourceType: 'provider_event_inbox',
    decision: 'ARCHIVE_AS_IMMUTABLE_HISTORY',
    timestamped: true,
    extract(source) {
      return source
        .rows('provider_event_inbox', [
          'provider_id',
          'provider_event_id',
          'received_at',
          'raw_payload',
          'processed_status',
          'processed_outcome',
        ])
        .map((row) => {
          const providerId = requireText(row.provider_id, 'provider_id');
          const providerEventId = requireText(row.provider_event_id, 'provider_event_id');
          const receivedAt = requireText(row.received_at, 'received_at');
          const outcome = text(row.processed_outcome);
          return {
            // Composite delivery identity — exactly the key the legacy inbox
            // deduplicated on, so migration inherits its dedup semantics.
            sourceId: `${providerId}:${providerEventId}`,
            sourceOrderingKey: `${receivedAt}#${providerId}:${providerEventId}`,
            payloadValue: {
              providerId,
              providerEventId,
              receivedAt,
              rawPayload: safeJson(requireText(row.raw_payload, 'raw_payload')),
              processedStatus: text(row.processed_status) ?? null,
              processedOutcome: outcome === undefined ? null : safeJson(outcome),
            },
            timestamp: receivedAt,
          };
        });
    },
  },
];

/**
 * Parse nested JSON tolerantly. A nested blob that will not parse is kept as
 * a marked wrapper rather than thrown away: the exporter's job is to hand
 * the dataset's real condition to reconciliation, not to sanitise it.
 */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __unparseableLegacyJson: raw };
  }
}
