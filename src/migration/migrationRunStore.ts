/**
 * M10 Phase 4 — bookkeeping over the M1 migration tables (`migration_runs`,
 * `legacy_id_map`, migration `0009`). Schema only until now; this is the
 * first code that writes them.
 *
 * These are deliberately NOT domain aggregates and do not go through
 * `PgUnitOfWork`:
 *  - `legacy_id_map` is append-only (`legacy_id_map_immutable` trigger) and
 *    carries no revision/authority semantics;
 *  - `migration_runs.progress` must survive a record import that rolled
 *    back, which a single enclosing domain transaction would undo along with
 *    the failed record.
 *
 * Nothing here dispatches to a provider, and nothing here can be reached
 * from normal runtime composition.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from '../persistence/postgres/pool.ts';
import { migrationImportOutcome } from '../contracts/v2/migration/migrationEnvelope.ts';

export const IMPORTER_VERSION = 'northstar-legacy-importer/1.0.0';

/**
 * A UUID derived from stable inputs rather than randomness.
 *
 * The migration's own provenance subjects must be content-addressed by the
 * dataset they describe: a random id would make the same dataset produce a
 * different command payload on every invocation, which the idempotency
 * ledger correctly rejects as a payload mismatch under a reused key. Derived
 * ids make re-import a true replay instead.
 *
 * Shaped as a v5 UUID (name-based, SHA-1 in the RFC; SHA-256 truncated here)
 * so it is visibly not a random v4.
 */
export function derivedUuid(namespace: string, name: string): string {
  const digest = createHash('sha256').update(`${namespace}:${name}`, 'utf8').digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The target id a given source record's `step` always produces.
 *
 * Exported because reconciliation needs to recompute the *same* id the importer
 * wrote, so it can check the one specific row a source fact became rather than
 * counting rows and hoping the totals line up. The importer's `ImportContext`
 * delegates here, so there is exactly one derivation and the two cannot drift.
 */
export function migrationTargetId(params: {
  datasetHash: string;
  sourceType: string;
  sourceId: string;
  step: string;
}): string {
  return derivedUuid(
    `northstar:migration:${params.step}`,
    `${params.datasetHash}:${params.sourceType}:${params.sourceId}`,
  );
}

/**
 * Classification vocabulary for a reconciliation exception. Every exception
 * must say what kind of problem it is — a count delta is not a finding.
 */
export const MigrationExceptionClassificationSchema = z.enum([
  /** Source evidence cannot prove the target mapping; never guessed. */
  'QUARANTINED_AMBIGUOUS_IDENTITY',
  /** Multi-traveller legacy trip: element -> Journey ownership unprovable (frozen decision). */
  'QUARANTINED_MULTI_TRAVELLER_ALLOCATION',
  /** Source row is structurally unusable (e.g. unparseable payload). */
  'QUARANTINED_UNREADABLE_SOURCE',
  /** Legacy shape has no deterministic target representation yet. */
  'QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING',
  /** External operation outcome was never observed; stays unknown, never failed. */
  'PRESERVED_UNKNOWN_EXTERNAL_OUTCOME',
  /** Exported but no handler was registered, so nothing was transformed. */
  'DEFERRED_NO_HANDLER',
  /**
   * History preserved as evidence, deliberately NOT re-injected as live
   * target state — replaying a historical signal or case into a live target
   * would re-trigger recovery for events that are long over.
   */
  'ARCHIVED_NOT_REPLAYED_AS_LIVE_STATE',
  /**
   * Content preserved, but the value cannot be migrated without a real
   * protected-content store to hold it (the target stores a
   * ProtectedDataRef triple, never a plaintext value).
   */
  'ARCHIVED_REQUIRES_PROTECTED_CONTENT_STORE',
  /**
   * Content preserved, but activating it in the target needs an input the
   * legacy source never held (e.g. an effective window, a registered rule
   * expression) and which must come from an owner, not a guess.
   */
  'ARCHIVED_REQUIRES_TARGET_POLICY_INPUT',
  /** Same source identity re-presented with a different payload hash. */
  'CONFLICT_SOURCE_CHANGED_SINCE_IMPORT',
  /** The target rejected the write with a typed conflict. */
  'TARGET_REJECTED_WRITE',
]);
export type MigrationExceptionClassification = z.infer<typeof MigrationExceptionClassificationSchema>;

/**
 * The full shape §14's reconciliation checklist demands. Every field is
 * required: an exception without an owner or a cutover-blocking decision is
 * not an owned exception.
 */
export const MigrationReconciliationExceptionSchema = z.strictObject({
  classification: MigrationExceptionClassificationSchema,
  categoryId: z.string().min(1),
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  /**
   * Set when the finding is about one *fact inside* the source record rather
   * than the record as a whole — for a legacy trip element, its element-scoped
   * identity from `legacyTripElementSourceId`. `sourceType`/`sourceId` can only
   * ever name the parent (a trip), so without this field an exception about one
   * element is indistinguishable from an exception about a sibling, and
   * reconciliation cannot tell which specific fact was held back.
   *
   * Optional and deliberately not inferred from `affectedScope`: most findings
   * genuinely apply to a whole record, and free text is not an identity.
   */
  factSourceId: z.string().min(1).optional(),
  reason: z.string().min(1),
  /** What is affected if this is never resolved — scope, not a row count. */
  affectedScope: z.string().min(1),
  safetyImpact: z.string().min(1),
  owner: z.string().min(1),
  blocksCutover: z.boolean(),
});
export type MigrationReconciliationException = z.infer<typeof MigrationReconciliationExceptionSchema>;

export const MigrationRunProgressSchema = z.strictObject({
  /** The run's provenance chain, reused verbatim on resume. */
  provenance: z.strictObject({ sourceId: z.string(), evidenceId: z.string() }).optional(),
  /** Index into the bundle's deterministic replay order. */
  lastCompletedIndex: z.number().int().min(-1),
  recordsImported: z.number().int().min(0),
  recordsReplayed: z.number().int().min(0),
  recordsQuarantined: z.number().int().min(0),
  recordsConflicted: z.number().int().min(0),
  /** Categories the importer does not yet cover. Counted, never hidden. */
  recordsDeferred: z.number().int().min(0),
});
export type MigrationRunProgress = z.infer<typeof MigrationRunProgressSchema>;

export const EMPTY_PROGRESS: MigrationRunProgress = {
  lastCompletedIndex: -1,
  recordsImported: 0,
  recordsReplayed: 0,
  recordsQuarantined: 0,
  recordsConflicted: 0,
  recordsDeferred: 0,
};

export interface MigrationRun {
  runId: string;
  datasetHash: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  progress: MigrationRunProgress;
  /** True when this call adopted an existing run rather than starting one. */
  resumed: boolean;
}

/**
 * Start a run, or resume the existing one for this (workspace, dataset).
 *
 * Resuming is keyed on the dataset hash, so the same dataset never gets two
 * concurrent partial imports, and a *different* dataset is always a new run
 * rather than a silent continuation of someone else's.
 */
export async function startOrResumeMigrationRun(
  pool: Pool,
  params: { workspaceId: string; datasetHash: string; exporterVersion: string; importerVersion?: string },
): Promise<MigrationRun> {
  const importerVersion = params.importerVersion ?? IMPORTER_VERSION;
  const existing = await pool.query<{
    id: string;
    status: MigrationRun['status'];
    progress: unknown;
    importer_version: string;
  }>(
    `SELECT id, status, progress, importer_version FROM migration_runs
     WHERE workspace_id = $1 AND dataset_hash = $2 AND status = 'IN_PROGRESS'
     ORDER BY started_at DESC LIMIT 1`,
    [params.workspaceId, params.datasetHash],
  );

  const resumable = existing.rows[0];
  if (resumable) {
    if (resumable.importer_version !== importerVersion) {
      // A half-imported dataset must not be finished by a different importer:
      // its record-level decisions may no longer mean the same thing.
      throw new Error(
        `migration run ${resumable.id} was started by importer ${resumable.importer_version}, ` +
          `refusing to resume it with ${importerVersion}`,
      );
    }
    return {
      runId: resumable.id,
      datasetHash: params.datasetHash,
      status: resumable.status,
      progress: MigrationRunProgressSchema.parse(resumable.progress),
      resumed: true,
    };
  }

  const created = await pool.query<{ id: string }>(
    `INSERT INTO migration_runs (workspace_id, dataset_hash, exporter_version, importer_version, progress)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [
      params.workspaceId,
      params.datasetHash,
      params.exporterVersion,
      importerVersion,
      JSON.stringify(EMPTY_PROGRESS),
    ],
  );
  const runId = created.rows[0]?.id;
  if (runId === undefined) throw new Error('migration_runs insert returned no id');
  return { runId, datasetHash: params.datasetHash, status: 'IN_PROGRESS', progress: EMPTY_PROGRESS, resumed: false };
}

export async function saveMigrationProgress(
  pool: Pool,
  runId: string,
  progress: MigrationRunProgress,
): Promise<void> {
  await pool.query(`UPDATE migration_runs SET progress = $2::jsonb WHERE id = $1`, [
    runId,
    JSON.stringify(MigrationRunProgressSchema.parse(progress)),
  ]);
}

/** Append an exception. Appending, never replacing: findings accumulate. */
export async function appendReconciliationException(
  pool: Pool,
  runId: string,
  exception: MigrationReconciliationException,
): Promise<void> {
  await pool.query(
    `UPDATE migration_runs
     SET reconciliation_exceptions = reconciliation_exceptions || $2::jsonb
     WHERE id = $1`,
    [runId, JSON.stringify([MigrationReconciliationExceptionSchema.parse(exception)])],
  );
}

export async function appendValidation(
  pool: Pool,
  runId: string,
  validation: { check: string; passed: boolean; detail: string },
): Promise<void> {
  await pool.query(
    `UPDATE migration_runs SET validations = validations || $2::jsonb WHERE id = $1`,
    [runId, JSON.stringify([validation])],
  );
}

export async function finishMigrationRun(
  pool: Pool,
  runId: string,
  status: 'COMPLETED' | 'FAILED',
): Promise<void> {
  await pool.query(`UPDATE migration_runs SET status = $2, completed_at = now() WHERE id = $1`, [
    runId,
    status,
  ]);
}

export async function readMigrationRun(
  pool: Pool,
  runId: string,
): Promise<{
  status: MigrationRun['status'];
  datasetHash: string;
  exporterVersion: string;
  importerVersion: string;
  progress: MigrationRunProgress;
  validations: { check: string; passed: boolean; detail: string }[];
  reconciliationExceptions: MigrationReconciliationException[];
}> {
  const result = await pool.query<{
    status: MigrationRun['status'];
    dataset_hash: string;
    exporter_version: string;
    importer_version: string;
    progress: unknown;
    validations: unknown;
    reconciliation_exceptions: unknown;
  }>(
    `SELECT status, dataset_hash, exporter_version, importer_version, progress, validations, reconciliation_exceptions
     FROM migration_runs WHERE id = $1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`migration run ${runId} not found`);
  return {
    status: row.status,
    datasetHash: row.dataset_hash,
    exporterVersion: row.exporter_version,
    importerVersion: row.importer_version,
    progress: MigrationRunProgressSchema.parse(row.progress),
    validations: z
      .array(z.strictObject({ check: z.string(), passed: z.boolean(), detail: z.string() }))
      .parse(row.validations),
    reconciliationExceptions: z.array(MigrationReconciliationExceptionSchema).parse(row.reconciliation_exceptions),
  };
}

/**
 * What a previous run recorded for one legacy record. `sourceHash` is read
 * back out of `mapping_evidence`, which is where the importer stores the
 * provenance triple that makes replay-vs-conflict decidable.
 */
export interface ExistingLegacyMapping {
  targetKind: string;
  targetId: string;
  sourceHash: string;
  runId: string;
}

const MappingEvidenceSchema = z.strictObject({
  runId: z.string().min(1),
  datasetHash: z.string().min(1),
  sourceHash: z.string().min(1),
  evidenceId: z.string().min(1),
  importerVersion: z.string().min(1),
  note: z.string().min(1),
});

export async function lookupLegacyMapping(
  pool: Pool,
  params: { workspaceId: string; sourceDataset: string; sourceType: string; sourceId: string },
): Promise<ExistingLegacyMapping | undefined> {
  const result = await pool.query<{ target_kind: string; target_id: string; mapping_evidence: string }>(
    `SELECT target_kind, target_id, mapping_evidence FROM legacy_id_map
     WHERE workspace_id = $1 AND source_dataset = $2 AND source_type = $3 AND source_id = $4`,
    [params.workspaceId, params.sourceDataset, params.sourceType, params.sourceId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const evidence = MappingEvidenceSchema.parse(JSON.parse(row.mapping_evidence));
  return {
    targetKind: row.target_kind,
    targetId: row.target_id,
    sourceHash: evidence.sourceHash,
    runId: evidence.runId,
  };
}

export async function insertLegacyMapping(
  pool: Pool,
  params: {
    workspaceId: string;
    sourceDataset: string;
    sourceType: string;
    sourceId: string;
    targetKind: string;
    targetId: string;
    runId: string;
    datasetHash: string;
    sourceHash: string;
    evidenceId: string;
    importerVersion: string;
    note: string;
  },
): Promise<void> {
  const mappingEvidence = JSON.stringify(
    MappingEvidenceSchema.parse({
      runId: params.runId,
      datasetHash: params.datasetHash,
      sourceHash: params.sourceHash,
      evidenceId: params.evidenceId,
      importerVersion: params.importerVersion,
      note: params.note,
    }),
  );
  // ON CONFLICT DO NOTHING, not DO UPDATE: the table is append-only by
  // trigger, and a concurrent/crashed run that already mapped this record
  // established the truth. Re-deciding it here would be the silent overwrite
  // the migration contract forbids.
  await pool.query(
    `INSERT INTO legacy_id_map
       (workspace_id, source_dataset, source_type, source_id, target_kind, target_id, mapping_evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id, source_dataset, source_type, source_id) DO NOTHING`,
    [
      params.workspaceId,
      params.sourceDataset,
      params.sourceType,
      params.sourceId,
      params.targetKind,
      params.targetId,
      mappingEvidence,
    ],
  );
}

/**
 * Decide what to do with a legacy record, using the frozen contract's pure
 * `migrationImportOutcome`. `NEW` imports, `IDEMPOTENT_REPLAY` short-circuits,
 * `CONFLICT_REQUIRES_RECONCILIATION` never writes.
 */
export function decideRecordOutcome(
  incoming: { sourceIdentity: string; sourceHash: string },
  existing: ExistingLegacyMapping | undefined,
): 'NEW' | 'IDEMPOTENT_REPLAY' | 'CONFLICT_REQUIRES_RECONCILIATION' {
  return migrationImportOutcome(
    incoming,
    existing === undefined
      ? undefined
      : { sourceIdentity: incoming.sourceIdentity, sourceHash: existing.sourceHash },
  );
}
