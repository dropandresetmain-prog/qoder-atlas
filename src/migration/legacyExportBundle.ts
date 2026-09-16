/**
 * M10 Phase 3 — the migration bundle contract: the only artefact that
 * crosses from the offline SQLite reader into the PostgreSQL importer.
 *
 * Everything the importer needs to decide identity, idempotency and
 * conflicts must be in here, because the importer never opens SQLite. That
 * means: dataset identity, export cutoff, exporter/format version, a
 * deterministic dataset hash, and a per-record source hash.
 */
import { z } from 'zod';
import { InstantSchema } from '../domain/v2/shared/time.ts';
import { MigrationCategoryDecisionSchema } from '../contracts/v2/migration/migrationEnvelope.ts';

/** Bumped when the bundle's *shape* changes; participates in the dataset hash. */
export const BUNDLE_FORMAT_VERSION = '1';

/**
 * One legacy record, category-tagged but not yet interpreted. `payload` is
 * whatever the legacy row held; the exporter does not reshape it, so
 * transformation decisions stay with the importer where the target ontology
 * lives.
 */
export const MigrationSourceRecordSchema = z.strictObject({
  /** Stable legacy identity, e.g. `entities.TRAVELLER`. Keyed on by `legacy_id_map.source_type`. */
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  /** Replay order within the category — legacy chronology where the source had any. */
  sourceOrderingKey: z.string().min(1),
  payload: z.unknown(),
  /**
   * Set only when the legacy `data` column was not parseable JSON. The bytes
   * are preserved verbatim so the importer can quarantine with evidence
   * rather than the exporter silently dropping a row.
   */
  rawUnparseableText: z.string().optional(),
  /** Hash of this record's content. Drives IDEMPOTENT_REPLAY vs. CONFLICT. */
  sourceHash: z.string().min(1),
  /**
   * The legacy instant this row carried, when its table had one. Archived
   * history is asserted `observedAt` this instant rather than at import
   * wall-clock, so a migrated observation keeps the age it actually has.
   */
  sourceTimestamp: z.string().optional(),
});
export type MigrationSourceRecord = z.infer<typeof MigrationSourceRecordSchema>;

export const MigrationBundleCategorySchema = z.strictObject({
  categoryId: z.string().min(1),
  sourceTable: z.string().min(1),
  decision: MigrationCategoryDecisionSchema,
  /** False when the legacy table carries no timestamp the cutoff could filter on. */
  cutoffApplied: z.boolean(),
  /** True when the table was absent from this dataset (lazily-created app tables). */
  sourceTableAbsent: z.boolean(),
  records: z.array(MigrationSourceRecordSchema),
});
export type MigrationBundleCategory = z.infer<typeof MigrationBundleCategorySchema>;

/**
 * A read anomaly found in the frozen source. Never a reason to fail the
 * export — the whole point is to surface the dataset's real condition so
 * reconciliation can own it.
 */
export const MigrationSourceAnomalySchema = z.strictObject({
  categoryId: z.string().min(1),
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  reason: z.string().min(1),
});
export type MigrationSourceAnomaly = z.infer<typeof MigrationSourceAnomalySchema>;

export const MigrationBundleSchema = z.strictObject({
  bundleFormatVersion: z.literal(BUNDLE_FORMAT_VERSION),
  exporterVersion: z.string().min(1),
  dataset: z.strictObject({
    sourceSystem: z.string().min(1),
    /** Operator-supplied identity of the dataset being migrated (deployment/file identity). */
    sourceIdentity: z.string().min(1),
    /** Legacy `schema_meta.schema_version`, when the dataset recorded one. */
    legacySchemaVersion: z.string().optional(),
    /** Freeze boundary: records newer than this are excluded where a timestamp exists. */
    exportCutoff: InstantSchema,
    /** Wall-clock export time. Deliberately OUTSIDE the dataset hash. */
    exportedAt: InstantSchema,
  }),
  tablesPresent: z.array(z.string()),
  categories: z.array(MigrationBundleCategorySchema),
  sourceAnomalies: z.array(MigrationSourceAnomalySchema),
  /**
   * Content identity of this dataset. Covers format version, dataset
   * identity, cutoff and every record — but NOT `exportedAt` or
   * `exporterVersion`, so re-exporting unchanged data is byte-stable and
   * therefore an idempotent replay rather than a spurious conflict.
   */
  datasetHash: z.string().min(1),
});
export type MigrationBundle = z.infer<typeof MigrationBundleSchema>;

/** Total records across categories — the importer's progress denominator. */
export function bundleRecordCount(bundle: MigrationBundle): number {
  return bundle.categories.reduce((total, category) => total + category.records.length, 0);
}

/**
 * Every record in deterministic replay order: category order as emitted by
 * the exporter (already sorted), then `sourceOrderingKey`. The importer
 * relies on this being stable across runs so `progress` offsets from an
 * interrupted run still mean the same thing on resume.
 */
export function bundleRecordsInReplayOrder(
  bundle: MigrationBundle,
): { category: MigrationBundleCategory; record: MigrationSourceRecord }[] {
  return bundle.categories.flatMap((category) =>
    category.records.map((record) => ({ category, record })),
  );
}
