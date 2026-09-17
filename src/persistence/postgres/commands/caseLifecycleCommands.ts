/**
 * Case lifecycle commands (T3/B1): linkage and guarded transitions.
 *
 * `openRecoveryCase` (m8AuthorityCommands.ts) creates the case root but
 * nothing in the command surface attached subjects or change signals to it —
 * tests inserted `case_subjects` rows with raw SQL. This module closes that
 * seam: one idempotent command that links assessed subjects and the change
 * signal(s) that caused the escalation to a case. Rows are append-only and
 * conflict-free (ON CONFLICT DO NOTHING), so replays and concurrent
 * escalation passes converge on the same state.
 *
 * The case root's revision is not advanced: the 0122/0123 EVALUATION_LIFECYCLE
 * triggers on `case_subjects` already move the case's read-model cursor, and
 * linkage is not a lifecycle transition.
 */
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { SubjectKindSchema, type SubjectKind, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt } from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';

const SCHEMA_VERSION = '1';
const Uuid = z.string().uuid();

export interface CaseLinkageCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

const attachInput = z.strictObject({
  caseId: Uuid,
  subjects: z.array(z.strictObject({ kind: SubjectKindSchema, id: Uuid, role: z.string().min(1).max(128) })).max(256).default([]),
  changeSignalIds: z.array(Uuid).max(64).default([]),
});

export interface AttachCaseSubjectsParams extends CaseLinkageCommandContext {
  caseId: string;
  subjects?: { kind: SubjectKind; id: string; role: string }[];
  changeSignalIds?: string[];
}

export interface CaseLinkageResult {
  caseId: string;
  subjectsAttached: number;
  signalsLinked: number;
}

/** Links subjects and change signals to an existing, non-terminal case. Idempotent. */
export async function attachCaseSubjects(uow: UnitOfWork, params: AttachCaseSubjectsParams): Promise<ExecuteOutcome<CaseLinkageResult>> {
  const parsed = attachInput.safeParse({ caseId: params.caseId, subjects: params.subjects, changeSignalIds: params.changeSignalIds });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const caseRef: TypedRef = { kind: 'RECOVERY_CASE', id: input.caseId };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_CASE_LINKED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(input),
    typedPayload: input,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();
  try {
    return await uow.execute<CaseLinkageResult>(envelope, async () => {
      const client = currentTransactionClient();
      const existing = await client.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [params.workspaceId, input.caseId],
      );
      const row = existing.rows[0];
      if (!row) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case ${input.caseId} does not exist`, [caseRef]) };
      if (['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'].includes(row.lifecycle_status)) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case ${input.caseId} is ${row.lifecycle_status}; new work opens a new case`, [caseRef]) };
      }
      let subjectsAttached = 0;
      for (const subject of input.subjects) {
        const inserted = await client.query(
          `INSERT INTO case_subjects (workspace_id, recovery_case_id, subject_kind, subject_id, role)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [params.workspaceId, input.caseId, subject.kind, subject.id, subject.role],
        );
        subjectsAttached += inserted.rowCount ?? 0;
      }
      let signalsLinked = 0;
      for (const signalId of input.changeSignalIds) {
        const inserted = await client.query(
          `INSERT INTO case_signals (workspace_id, recovery_case_id, change_signal_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [params.workspaceId, input.caseId, signalId],
        );
        signalsLinked += inserted.rowCount ?? 0;
      }
      const value: CaseLinkageResult = { caseId: input.caseId, subjectsAttached, signalsLinked };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RECOVERY_CASE', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [], committedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [caseRef]) };
  }
}

/**
 * Guarded lifecycle transitions between the non-terminal working phases
 * (closure §9 phase machine projected onto 0100's lifecycle vocabulary).
 * Terminal states are reached only through their own commands
 * (`resolveRecoveryCase`), never here. Transitions require guards, not just
 * enum permission: the caller states the phase it observed (`from`), and the
 * command refuses when the case has moved on.
 */
export const CASE_PHASE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  OPEN: ['PLANNING'],
  PLANNING: ['AWAITING_AUTHORITY', 'OPEN'],
  AWAITING_AUTHORITY: ['EXECUTING', 'PLANNING'],
  EXECUTING: ['PLANNING', 'AWAITING_AUTHORITY'],
};

export interface TransitionRecoveryCaseParams extends CaseLinkageCommandContext {
  caseId: string;
  from: string;
  to: string;
  /** Recorded in the audit trail; e.g. 'strategies persisted', 'plan approved'. */
  reason: string;
}

export async function transitionRecoveryCase(uow: UnitOfWork, params: TransitionRecoveryCaseParams): Promise<ExecuteOutcome<{ caseId: string; from: string; to: string }>> {
  const parsed = z.strictObject({ caseId: Uuid, from: z.string().min(1), to: z.string().min(1), reason: z.string().min(1).max(512) })
    .safeParse({ caseId: params.caseId, from: params.from, to: params.to, reason: params.reason });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const caseRef: TypedRef = { kind: 'RECOVERY_CASE', id: input.caseId };
  if (!(CASE_PHASE_TRANSITIONS[input.from] ?? []).includes(input.to)) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `recovery case transition ${input.from} -> ${input.to} is not permitted`, [caseRef]) };
  }
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RECOVERY_CASE_PHASE_CHANGED',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(input),
    typedPayload: input,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();
  try {
    return await uow.execute<{ caseId: string; from: string; to: string }>(envelope, async () => {
      const client = currentTransactionClient();
      const updated = await client.query(
        `UPDATE recovery_cases SET lifecycle_status = $3 WHERE workspace_id = $1 AND id = $2 AND lifecycle_status = $4`,
        [params.workspaceId, input.caseId, input.to, input.from],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        const current = await client.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [params.workspaceId, input.caseId]);
        const observed = current.rows[0]?.lifecycle_status ?? 'MISSING';
        return { ok: false, conflict: typedConflict('STALE_AGGREGATE_REVISION', `recovery case ${input.caseId} is ${observed}, expected ${input.from}`, [caseRef]) };
      }
      const value = { caseId: input.caseId, from: input.from, to: input.to };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RECOVERY_CASE', payload: { ...value, reason: input.reason } });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [], committedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [caseRef]) };
  }
}
