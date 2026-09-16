/**
 * M10 Phase 3 — offline, read-only legacy exporter.
 *
 * Produces a deterministic migration bundle from a frozen legacy SQLite
 * dataset. Guarantees, each covered by a focused test in
 * `test/m10-legacy-exporter.test.ts`:
 *
 *  - zero writes to the source (SQLite-enforced, see legacySqliteSource.ts);
 *  - zero provider dispatch (trivially: this module imports no provider);
 *  - unreachable from normal app composition (`test/m10-runtime-purge.test.ts`);
 *  - a stable `datasetHash` and byte-identical content for an unchanged
 *    dataset (everything except the wall-clock `dataset.exportedAt`), hence
 *    idempotent re-import;
 *  - every category captured, including stores whose runtime disposition is
 *    RETIRE — retiring a subsystem does not license discarding its data;
 *  - safe to rerun (it is a pure read).
 */
import { createHash } from 'node:crypto';
import { openLegacySqliteSource, type LegacySqliteSource } from './legacySqliteSource.ts';
import { LEGACY_CATEGORIES, type LegacyCategorySpec } from './legacyCategories.ts';
import {
  BUNDLE_FORMAT_VERSION,
  MigrationBundleSchema,
  type MigrationBundle,
  type MigrationBundleCategory,
  type MigrationSourceAnomaly,
  type MigrationSourceRecord,
} from './legacyExportBundle.ts';

export const EXPORTER_VERSION = 'northstar-legacy-exporter/1.0.0';
export const LEGACY_SOURCE_SYSTEM = 'northstar-legacy-sqlite';

export interface LegacyExportRequest {
  /** Path to the frozen legacy database file. Opened read-only. */
  sqlitePath: string;
  /**
   * Operator-supplied identity of the dataset being migrated. This is what
   * `legacy_id_map.source_dataset` records, so re-exporting the same
   * deployment must reuse the same value or idempotency is lost.
   */
  sourceIdentity: string;
  /** Freeze boundary. Timestamped records after this instant are excluded. */
  exportCutoff: string;
  /** Injectable clock so tests can prove `exportedAt` never affects the hash. */
  now?: () => string;
}

/**
 * Recursively key-sorted JSON, so two semantically identical payloads hash
 * identically regardless of the order SQLite/`JSON.parse` produced.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value) ?? null);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Instant comparison must be offset-aware, never lexicographic (ADR-023). */
function instantMillis(instant: string): number {
  return Date.parse(instant);
}

interface CategoryExport {
  category: MigrationBundleCategory;
  anomalies: MigrationSourceAnomaly[];
}

function exportCategory(
  spec: LegacyCategorySpec,
  source: LegacySqliteSource,
  cutoffMillis: number,
): CategoryExport {
  const anomalies: MigrationSourceAnomaly[] = [];
  const sourceTableAbsent = !source.tables().includes(spec.sourceTable);
  const records: MigrationSourceRecord[] = [];

  for (const extracted of spec.extract(source)) {
    if (spec.timestamped) {
      const millis = instantMillis(extracted.timestamp ?? '');
      if (Number.isNaN(millis)) {
        // Cannot be placed relative to the freeze boundary, so it cannot be
        // safely included or excluded — surface it, keep it, quarantine later.
        anomalies.push({
          categoryId: spec.categoryId,
          sourceType: spec.sourceType,
          sourceId: extracted.sourceId,
          reason: `unparseable timestamp "${extracted.timestamp ?? ''}" — cannot be evaluated against the export cutoff`,
        });
      } else if (millis > cutoffMillis) {
        continue; // after the freeze boundary: not part of this dataset
      }
    }

    let payload: unknown;
    let rawUnparseableText: string | undefined;
    if (extracted.payloadText !== undefined) {
      try {
        payload = JSON.parse(extracted.payloadText) as unknown;
      } catch (error) {
        rawUnparseableText = extracted.payloadText;
        payload = null;
        anomalies.push({
          categoryId: spec.categoryId,
          sourceType: spec.sourceType,
          sourceId: extracted.sourceId,
          reason: `legacy payload is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      payload = extracted.payloadValue;
    }

    records.push({
      sourceType: spec.sourceType,
      sourceId: extracted.sourceId,
      sourceOrderingKey: extracted.sourceOrderingKey,
      payload,
      ...(rawUnparseableText === undefined ? {} : { rawUnparseableText }),
      sourceHash: sha256(canonicalJson({ payload, rawUnparseableText: rawUnparseableText ?? null })),
    });
  }

  // Canonical ordering: chronology where the legacy store had it, then id as
  // the tie-break, so equal-timestamp rows still order identically every run.
  records.sort((a, b) =>
    a.sourceOrderingKey === b.sourceOrderingKey
      ? a.sourceId < b.sourceId
        ? -1
        : a.sourceId > b.sourceId
          ? 1
          : 0
      : a.sourceOrderingKey < b.sourceOrderingKey
        ? -1
        : 1,
  );
  anomalies.sort((a, b) => (`${a.categoryId}#${a.sourceId}` < `${b.categoryId}#${b.sourceId}` ? -1 : 1));

  return {
    category: {
      categoryId: spec.categoryId,
      sourceTable: spec.sourceTable,
      decision: spec.decision,
      cutoffApplied: spec.timestamped,
      sourceTableAbsent,
      records,
    },
    anomalies,
  };
}

/**
 * Content identity of the dataset. Excludes `exportedAt` and
 * `exporterVersion` on purpose: re-exporting unchanged data must hash
 * identically, or every replay would look like a reconciliation conflict.
 * `bundleFormatVersion` IS included, because a shape change is a content
 * change.
 */
function computeDatasetHash(
  bundle: Omit<MigrationBundle, 'datasetHash'>,
): string {
  return sha256(
    canonicalJson({
      bundleFormatVersion: bundle.bundleFormatVersion,
      sourceSystem: bundle.dataset.sourceSystem,
      sourceIdentity: bundle.dataset.sourceIdentity,
      legacySchemaVersion: bundle.dataset.legacySchemaVersion ?? null,
      exportCutoff: bundle.dataset.exportCutoff,
      categories: bundle.categories,
      sourceAnomalies: bundle.sourceAnomalies,
    }),
  );
}

/** Export a frozen legacy dataset. Pure read; safe to rerun at any time. */
export function exportLegacyDataset(request: LegacyExportRequest): MigrationBundle {
  const cutoffMillis = instantMillis(request.exportCutoff);
  if (Number.isNaN(cutoffMillis)) {
    throw new Error(`exportCutoff "${request.exportCutoff}" is not a parseable instant`);
  }

  const source = openLegacySqliteSource(request.sqlitePath);
  try {
    const exports = LEGACY_CATEGORIES.map((spec) => exportCategory(spec, source, cutoffMillis));
    const legacySchemaVersion = source.meta('schema_version');

    const withoutHash: Omit<MigrationBundle, 'datasetHash'> = {
      bundleFormatVersion: BUNDLE_FORMAT_VERSION,
      exporterVersion: EXPORTER_VERSION,
      dataset: {
        sourceSystem: LEGACY_SOURCE_SYSTEM,
        sourceIdentity: request.sourceIdentity,
        ...(legacySchemaVersion === undefined ? {} : { legacySchemaVersion }),
        exportCutoff: request.exportCutoff,
        exportedAt: (request.now ?? (() => new Date().toISOString()))(),
      },
      tablesPresent: source.tables(),
      categories: exports.map((entry) => entry.category),
      sourceAnomalies: exports.flatMap((entry) => entry.anomalies),
    };

    return MigrationBundleSchema.parse({
      ...withoutHash,
      datasetHash: computeDatasetHash(withoutHash),
    });
  } finally {
    source.close();
  }
}

/** Canonical serialisation — the on-disk/over-the-wire form of a bundle. */
export function serialiseBundle(bundle: MigrationBundle): string {
  return canonicalJson(bundle);
}
