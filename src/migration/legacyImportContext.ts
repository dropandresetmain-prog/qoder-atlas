/**
 * Shared surface for legacy import category handlers.
 *
 * Split out of `legacyImporter.ts` so Phase 5's handlers can live beside each
 * other without the orchestrator growing to a thousand lines, and so handlers
 * cannot reach the run orchestration they are called from.
 *
 * OFFLINE MIGRATION ONLY. Never reachable from normal app composition; see
 * `test/m10-runtime-purge.test.ts`.
 */

import type { MigrationSourceRecord } from './legacyExportBundle.ts';
import type { MigrationReconciliationException } from './migrationRunStore.ts';
import type { Pool } from '../persistence/postgres/pool.ts';
import { PgUnitOfWork } from '../persistence/postgres/pgUnitOfWork.ts';
import { recordSource, recordEvidence } from '../persistence/postgres/commands/knowledgeCommands.ts';
import type { TypedConflict } from '../domain/v2/shared/errors.ts';

export type RecordException = Omit<MigrationReconciliationException, 'categoryId' | 'sourceType' | 'sourceId'>;

/**
 * `extraExceptions` exists because one legacy row can raise several distinct
 * findings — a trip migrates, and three of its elements each fail
 * differently. Collapsing those into the row's single outcome would hide
 * exactly the detail reconciliation is for.
 */
export type RecordOutcome =
  | { kind: 'IMPORTED'; targetKind: string; targetId: string; note: string; extraExceptions?: RecordException[] }
  /** Imported, but deliberately not represented as a target subject (history only). */
  | { kind: 'ARCHIVED'; note: string; evidenceId?: string; extraExceptions?: RecordException[] }
  | { kind: 'QUARANTINED'; exception: RecordException; extraExceptions?: RecordException[] }
  | { kind: 'DEFERRED'; reason: string };

export interface ImportContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  runId: string;
  datasetHash: string;
  sourceDataset: string;
  runEvidenceId: string;
  now: string;
  /** The `source_records` row capturing the legacy dataset for this run. */
  runSourceId: string;
  /** legacy trip element id -> owning legacy trip id(s), built from the bundle. */
  tripElementOwners: Map<string, string[]>;
  resolve(sourceType: string, sourceId: string): Promise<{ targetKind: string; targetId: string } | undefined>;
  idempotencyKey(record: MigrationSourceRecord, step: string): string;
  /**
   * The target id this record's `step` will always produce. Derived, not
   * random, so a command re-issued after a crash replays with an identical
   * payload instead of tripping the idempotency ledger's payload check.
   */
  targetId(record: MigrationSourceRecord, step: string): string;
  uow(): PgUnitOfWork;
}

export type CategoryHandler = (ctx: ImportContext, record: MigrationSourceRecord) => Promise<RecordOutcome>;

export function conflictText(conflict: TypedConflict | undefined): string {
  return conflict === undefined ? 'unknown conflict' : `${conflict.kind}: ${conflict.message}`;
}

export function asObject(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The single unreadable-payload quarantine, so every category words it the
 * same way and none of them silently treats an unparseable row as empty.
 */
export function unreadable(
  record: MigrationSourceRecord,
  what: string,
  safetyImpact: string,
  blocksCutover: boolean,
): RecordOutcome {
  return {
    kind: 'QUARANTINED',
    exception: {
      classification: 'QUARANTINED_UNREADABLE_SOURCE',
      reason: `legacy ${what} payload is not readable as an object`,
      affectedScope: `${what} ${record.sourceId}`,
      safetyImpact,
      owner: 'migration owner',
      blocksCutover,
    },
  };
}

export interface ArchiveRequest {
  /** Historical assertion type, e.g. `LEGACY_AUDIT_ENTRY`. */
  assertionType: string;
  /** Why this is history and what it does NOT establish. */
  provenance: string;
  /**
   * The migrated target subject this history belongs to. When absent, the
   * legacy record is captured as its own `source_records` row and the
   * evidence cites that: a provider delivery or an FX quote is a raw capture
   * in its own right, so it needs no invented correlation to be preserved.
   */
  subject?: { kind: string; id: string };
  /** Legacy observation instant when the source carries one. */
  observedAt?: string;
  /** Distinguishes the capture in `source_records.content_type`. */
  contentKind?: string;
}

/**
 * Preserve a legacy record as immutable target evidence.
 *
 * This is how every ARCHIVE decision in the frozen matrix is executed: the
 * content survives with real provenance, and nothing about it is presented as
 * current truth.
 */
export async function archiveLegacyRecord(
  ctx: ImportContext,
  record: MigrationSourceRecord,
  request: ArchiveRequest,
): Promise<{ ok: true; evidenceId: string; sourceId?: string } | { ok: false; outcome: RecordOutcome }> {
  const sourceIds = [ctx.runSourceId];
  let capturedSourceId: string | undefined;
  let subject = request.subject;

  if (subject === undefined) {
    const capture = await recordSource(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: ctx.idempotencyKey(record, 'archive-capture'),
      sourceId: ctx.targetId(record, 'archive-capture'),
      sourceIdentity: `legacy:${ctx.sourceDataset}:${record.sourceType}:${record.sourceId}`,
      receivedAt: request.observedAt ?? ctx.now,
      contentHash: record.sourceHash,
      contentType: `application/x-northstar-legacy+${request.contentKind ?? record.sourceType}`,
    });
    if (!capture.ok) {
      return {
        ok: false,
        outcome: {
          kind: 'QUARANTINED',
          exception: {
            classification: 'TARGET_REJECTED_WRITE',
            reason: `target rejected the archival capture — ${conflictText(capture.conflict)}`,
            affectedScope: `${record.sourceType} ${record.sourceId}`,
            safetyImpact: 'the legacy record would be lost rather than archived',
            owner: 'migration owner',
            blocksCutover: true,
          },
        },
      };
    }
    capturedSourceId = capture.value.sourceId;
    sourceIds.unshift(capturedSourceId);
    subject = { kind: 'SOURCE_RECORD', id: capturedSourceId };
  }

  const evidence = await recordEvidence(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'archive-evidence'),
    evidenceId: ctx.targetId(record, 'archive-evidence'),
    assertionType: request.assertionType,
    observedAt: request.observedAt ?? ctx.now,
    schemaVersion: '1',
    sourceIds,
    subjectRefs: [subject],
    interpretationProvenance: request.provenance,
  });
  if (!evidence.ok) {
    return {
      ok: false,
      outcome: {
        kind: 'QUARANTINED',
        exception: {
          classification: 'TARGET_REJECTED_WRITE',
          reason: `target rejected ${request.assertionType} evidence — ${conflictText(evidence.conflict)}`,
          affectedScope: `${record.sourceType} ${record.sourceId}`,
          safetyImpact: 'the legacy record would be lost rather than archived',
          owner: 'migration owner',
          blocksCutover: true,
        },
      },
    };
  }

  return { ok: true, evidenceId: evidence.value.evidenceId, sourceId: capturedSourceId };
}
