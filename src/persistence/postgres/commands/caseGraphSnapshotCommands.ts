/**
 * Recovery case Original graph snapshot commands (migration 0127).
 *
 * The Original is the ONE immutable, semantic, first-truthful focused Case graph.
 * Capture is `INSERT ... ON CONFLICT DO NOTHING` on (workspace, case, ORIGINAL):
 * the first capture wins and every later attempt — retry, duplicate wake, a
 * "better" graph — is a reported no-op, never an overwrite (the table also
 * refuses UPDATE/DELETE). Like attention it is case-owned presentation evidence
 * that does not advance the case root's aggregate revision (`advanced: []`); the
 * 0127 EVALUATION_LIFECYCLE trigger moves the case's read-model cursor instead.
 */
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import {
  OriginalFocusedGraphViewSchema,
  OriginalGraphSnapshotPayloadSchema,
  ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION,
  type OriginalFocusedGraphView,
  type OriginalGraphSnapshotPayload,
} from '../../../contracts/v2/product/readModels.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt, type Queryable } from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';

const COMMAND_SCHEMA_VERSION = '1';
const Uuid = z.string().uuid();

export interface CaptureOriginalCaseGraphParams {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  caseId: string;
  basisAssessmentId?: string;
  capturedAt: string;
  payload: OriginalGraphSnapshotPayload;
}

export interface CaptureOriginalCaseGraphResult {
  /** False when an Original already existed: nothing was written. */
  captured: boolean;
}

const captureInput = z.strictObject({
  caseId: Uuid,
  basisAssessmentId: Uuid.optional(),
  capturedAt: z.string().datetime({ offset: true }),
  payload: OriginalGraphSnapshotPayloadSchema,
});

export async function captureOriginalCaseGraphSnapshot(
  uow: UnitOfWork,
  params: CaptureOriginalCaseGraphParams,
): Promise<ExecuteOutcome<CaptureOriginalCaseGraphResult>> {
  const parsed = captureInput.safeParse({
    caseId: params.caseId,
    basisAssessmentId: params.basisAssessmentId,
    capturedAt: params.capturedAt,
    payload: params.payload,
  });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const caseRef: TypedRef = { kind: 'RECOVERY_CASE', id: input.caseId };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_CASE_ORIGINAL_GRAPH_CAPTURED',
    schemaVersion: COMMAND_SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(input),
    ...(input.basisAssessmentId ? { basisAssessmentId: input.basisAssessmentId } : {}),
    typedPayload: input,
    evidenceRefs: [],
  });
  try {
    return await uow.execute<CaptureOriginalCaseGraphResult>(envelope, async () => {
      const client = currentTransactionClient();
      const caseRow = await client.query(
        'SELECT 1 FROM recovery_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [params.workspaceId, input.caseId],
      );
      if (caseRow.rowCount === 0) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case ${input.caseId} does not exist`, [caseRef]) };
      }
      const inserted = await client.query(
        `INSERT INTO recovery_case_graph_snapshots
           (workspace_id, recovery_case_id, snapshot_kind, schema_version, basis_assessment_id, snapshot, captured_at, created_by_actor_id)
         VALUES ($1, $2, 'ORIGINAL', $3, $4, $5::jsonb, $6::timestamptz, $7)
         ON CONFLICT (workspace_id, recovery_case_id, snapshot_kind) DO NOTHING`,
        [
          params.workspaceId, input.caseId, ORIGINAL_GRAPH_SNAPSHOT_SCHEMA_VERSION,
          input.basisAssessmentId ?? null, JSON.stringify(input.payload), input.capturedAt, params.actorPrincipalId,
        ],
      );
      const value: CaptureOriginalCaseGraphResult = { captured: (inserted.rowCount ?? 0) === 1 };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RECOVERY_CASE', payload: { ...value } });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [], committedAt: input.capturedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [caseRef]) };
  }
}

export async function hasOriginalCaseGraphSnapshot(client: Queryable, workspaceId: string, caseId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM recovery_case_graph_snapshots WHERE workspace_id = $1 AND recovery_case_id = $2 AND snapshot_kind = 'ORIGINAL'`,
    [workspaceId, caseId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Reads the case's Original through the strict typed schema; `undefined` when none was captured. */
export async function loadOriginalCaseGraphSnapshot(
  client: Queryable,
  workspaceId: string,
  caseId: string,
): Promise<OriginalFocusedGraphView | undefined> {
  const r = await client.query<{
    snapshot: unknown;
    captured_at: Date | string;
    basis_assessment_id: string | null;
  }>(
    `SELECT snapshot, captured_at, basis_assessment_id FROM recovery_case_graph_snapshots
      WHERE workspace_id = $1 AND recovery_case_id = $2 AND snapshot_kind = 'ORIGINAL'`,
    [workspaceId, caseId],
  );
  const row = r.rows[0];
  if (!row) return undefined;
  const payload = OriginalGraphSnapshotPayloadSchema.parse(row.snapshot);
  return OriginalFocusedGraphViewSchema.parse({
    capturedAt: new Date(row.captured_at).toISOString(),
    ...(row.basis_assessment_id ? { basisAssessmentRef: row.basis_assessment_id } : {}),
    ...payload,
  });
}
