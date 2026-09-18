/**
 * Recovery case attention commands (migration 0126) — the durable surface for
 * the C8 ESCALATE decision.
 *
 * Attention is Case-owned, orthogonal to the case lifecycle phase, and never a
 * canonical mutation: opening it does not advance the case, approve anything or
 * imply resolution. It is idempotent per (case, basis assessment, reason), so
 * duplicate progression wakes converge on one row. Like case linkage, it does
 * not advance the case root's aggregate revision (`advanced: []`); the 0126
 * EVALUATION_LIFECYCLE trigger moves the case's read-model cursor instead.
 */
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import {
  RecoveryCaseAttentionReasonSchema,
  RecoveryCaseAttentionResolutionSchema,
  type RecoveryCaseAttentionReason,
  type RecoveryCaseAttentionRecord,
  type RecoveryCaseAttentionResolution,
} from '../../../contracts/v2/planning/recoveryCaseAttention.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from '../../../app/target/deterministicId.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt, type Queryable } from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';

const SCHEMA_VERSION = '1';
const Uuid = z.string().uuid();
const TERMINAL = ['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'];

export interface CaseAttentionCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

/** Deterministic identity: what the attention is for, never when it was minted. */
export function recoveryCaseAttentionId(workspaceId: string, caseId: string, basisAssessmentId: string, reason: RecoveryCaseAttentionReason): string {
  return deterministicUuid(RUNTIME_ID_NAMESPACES.escalation, `${workspaceId}|case-attention|${caseId}|${basisAssessmentId}|${reason}`);
}

export interface OpenRecoveryCaseAttentionParams extends CaseAttentionCommandContext {
  caseId: string;
  basisAssessmentId: string;
  reason: RecoveryCaseAttentionReason;
  openedAt?: string;
}

export interface OpenRecoveryCaseAttentionResult {
  attentionId: string;
  /** False on a replay: the record already existed. */
  created: boolean;
  status: 'OPEN' | 'RESOLVED';
}

const openInput = z.strictObject({ caseId: Uuid, basisAssessmentId: Uuid, reason: RecoveryCaseAttentionReasonSchema });

/** Opens (or re-reads) the attention record for a case + settled basis + reason. */
export async function openRecoveryCaseAttention(
  uow: UnitOfWork,
  params: OpenRecoveryCaseAttentionParams,
): Promise<ExecuteOutcome<OpenRecoveryCaseAttentionResult>> {
  const parsed = openInput.safeParse({ caseId: params.caseId, basisAssessmentId: params.basisAssessmentId, reason: params.reason });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const caseRef: TypedRef = { kind: 'RECOVERY_CASE', id: input.caseId };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_CASE_ATTENTION_OPENED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(input),
    basisAssessmentId: input.basisAssessmentId,
    typedPayload: input,
    evidenceRefs: [],
  });
  const openedAt = params.openedAt ?? new Date().toISOString();
  const attentionId = recoveryCaseAttentionId(params.workspaceId, input.caseId, input.basisAssessmentId, input.reason);
  try {
    return await uow.execute<OpenRecoveryCaseAttentionResult>(envelope, async () => {
      const client = currentTransactionClient();
      const caseRow = await client.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [params.workspaceId, input.caseId],
      );
      const status = caseRow.rows[0]?.lifecycle_status;
      if (!status) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case ${input.caseId} does not exist`, [caseRef]) };
      if (TERMINAL.includes(status)) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case ${input.caseId} is ${status}; attention is not opened on a terminal case`, [caseRef]) };
      }
      const inserted = await client.query(
        `INSERT INTO recovery_case_attention (workspace_id, id, recovery_case_id, basis_assessment_id, reason_code, status, opened_at, opened_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, 'OPEN', $6::timestamptz, $7)
         ON CONFLICT (workspace_id, recovery_case_id, basis_assessment_id, reason_code) DO NOTHING`,
        [params.workspaceId, attentionId, input.caseId, input.basisAssessmentId, input.reason, openedAt, params.actorPrincipalId],
      );
      const existing = await client.query<{ id: string; status: 'OPEN' | 'RESOLVED' }>(
        `SELECT id, status FROM recovery_case_attention
          WHERE workspace_id = $1 AND recovery_case_id = $2 AND basis_assessment_id = $3 AND reason_code = $4`,
        [params.workspaceId, input.caseId, input.basisAssessmentId, input.reason],
      );
      const row = existing.rows[0]!;
      const value: OpenRecoveryCaseAttentionResult = { attentionId: row.id, created: (inserted.rowCount ?? 0) === 1, status: row.status };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RECOVERY_CASE', payload: { ...value, reason: input.reason } });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [], committedAt: openedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [caseRef]) };
  }
}

/**
 * Resolves OPEN attention rows in the caller's transaction. `keepBasisAssessmentId`
 * spares attention bound to the CURRENT basis (used when a newer basis supersedes
 * stale attention); omit it to clear everything (case resolution).
 */
export async function resolveOpenCaseAttention(
  client: Queryable,
  args: {
    workspaceId: string;
    caseId: string;
    actorPrincipalId: string;
    resolution: RecoveryCaseAttentionResolution;
    resolvedAt: string;
    keepBasisAssessmentId?: string;
  },
): Promise<number> {
  const result = await client.query(
    `UPDATE recovery_case_attention
        SET status = 'RESOLVED', resolved_at = $4::timestamptz, resolved_by_actor_id = $5, resolution_code = $6
      WHERE workspace_id = $1 AND recovery_case_id = $2 AND status = 'OPEN'
        AND ($3::uuid IS NULL OR basis_assessment_id <> $3::uuid)`,
    [args.workspaceId, args.caseId, args.keepBasisAssessmentId ?? null, args.resolvedAt, args.actorPrincipalId, args.resolution],
  );
  return result.rowCount ?? 0;
}

export interface ResolveRecoveryCaseAttentionParams extends CaseAttentionCommandContext {
  caseId: string;
  resolution: RecoveryCaseAttentionResolution;
  /** Required for `basis_superseded`: the current settled basis whose own attention is kept. */
  currentBasisAssessmentId?: string;
  resolvedAt?: string;
}

const resolveInput = z.strictObject({
  caseId: Uuid,
  resolution: RecoveryCaseAttentionResolutionSchema,
  currentBasisAssessmentId: Uuid.optional(),
});

/** Clears open attention when the case progresses past it. Idempotent (0 rows on replay). */
export async function resolveRecoveryCaseAttention(
  uow: UnitOfWork,
  params: ResolveRecoveryCaseAttentionParams,
): Promise<ExecuteOutcome<{ caseId: string; resolved: number }>> {
  const parsed = resolveInput.safeParse({ caseId: params.caseId, resolution: params.resolution, currentBasisAssessmentId: params.currentBasisAssessmentId });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const caseRef: TypedRef = { kind: 'RECOVERY_CASE', id: input.caseId };
  if (input.resolution === 'basis_superseded' && !input.currentBasisAssessmentId) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'basis_superseded requires the current basis assessment', [caseRef]) };
  }
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_CASE_ATTENTION_RESOLVED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(input),
    typedPayload: input,
    evidenceRefs: [],
  });
  const resolvedAt = params.resolvedAt ?? new Date().toISOString();
  try {
    return await uow.execute<{ caseId: string; resolved: number }>(envelope, async () => {
      const client = currentTransactionClient();
      const resolved = await resolveOpenCaseAttention(client, {
        workspaceId: params.workspaceId,
        caseId: input.caseId,
        actorPrincipalId: params.actorPrincipalId,
        resolution: input.resolution,
        resolvedAt,
        ...(input.currentBasisAssessmentId ? { keepBasisAssessmentId: input.currentBasisAssessmentId } : {}),
      });
      const value = { caseId: input.caseId, resolved };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RECOVERY_CASE', payload: { ...value, resolution: input.resolution } });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [], committedAt: resolvedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [caseRef]) };
  }
}

interface AttentionRow {
  id: string;
  recovery_case_id: string;
  basis_assessment_id: string;
  reason_code: string;
  status: string;
  opened_at: Date;
  resolved_at: Date | null;
  resolution_code: string | null;
}

/** Read helper: every attention record for a case, oldest first (stable). */
export async function listRecoveryCaseAttention(db: Queryable, workspaceId: string, caseId: string): Promise<RecoveryCaseAttentionRecord[]> {
  const rows = await db.query<AttentionRow>(
    `SELECT id, recovery_case_id, basis_assessment_id, reason_code, status, opened_at, resolved_at, resolution_code
       FROM recovery_case_attention WHERE workspace_id = $1 AND recovery_case_id = $2
      ORDER BY opened_at ASC, reason_code ASC, id ASC`,
    [workspaceId, caseId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    recoveryCaseId: row.recovery_case_id,
    basisAssessmentId: row.basis_assessment_id,
    reasonCode: row.reason_code as RecoveryCaseAttentionReason,
    status: row.status as 'OPEN' | 'RESOLVED',
    openedAt: row.opened_at.toISOString(),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at.toISOString() } : {}),
    ...(row.resolution_code ? { resolutionCode: row.resolution_code as RecoveryCaseAttentionResolution } : {}),
  }));
}
