/**
 * ChangeSignal commands (R0, migration 0124).
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.6: a ChangeSignal is an immutable
 * causal notification — "validated ingestion or domain command emits it; it
 * is not the current world state". It is the spine every consequence hangs
 * from: commands executed under a signal (PgUnitOfWork.underChangeSignal) tag
 * their `change_records` and the M6 reassessment work they trigger with the
 * signal id, so "these assessments were re-evaluated because of this change"
 * is a database fact, not an inference.
 *
 * Two commands, both idempotent through the normal command protocol:
 *
 *  - `recordChangeSignal` — registers the signal once per (origin kind,
 *    origin key). Same origin key + same content hash = replay; a different
 *    content hash is a `DUPLICATE_REGISTRATION` conflict (the caller decides
 *    how to surface it — e.g. IDEMPOTENCY_KEY_PAYLOAD_MISMATCH).
 *  - `completeChangeSignal` — records the durable "applied" fact as a
 *    separate immutable row. Presence means every required application step
 *    committed; absence means in progress. This replaces ad-hoc completion
 *    markers stored as world knowledge.
 *
 * Nothing here is provider- or scenario-specific: origin kind, origin key,
 * change type and subjects are caller-supplied typed inputs.
 */
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { SubjectKindSchema, type SubjectKind, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt, createRoot, type AdvancedRoot, type Queryable } from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';

const SCHEMA_VERSION = '1';
const Uuid = z.string().uuid();

export interface ChangeSignalCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

const changeSignalInput = z.strictObject({
  changeSignalId: Uuid,
  originKind: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  originKey: z.string().min(1).max(512),
  changeType: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  contentHash: z.string().min(1),
  receivedAt: InstantSchema,
  sourceConnectionId: Uuid.optional(),
  sourceRecordId: Uuid.optional(),
  evidenceId: Uuid.optional(),
  subjects: z
    .array(z.strictObject({ kind: SubjectKindSchema, id: Uuid, role: z.string().min(1).max(128) }))
    .max(256)
    .default([]),
  summary: z.record(z.string(), z.unknown()).default({}),
});

export interface RecordChangeSignalParams extends ChangeSignalCommandContext {
  /** Caller-minted (deterministic per origin) so retries and replays share one identity. */
  changeSignalId: string;
  originKind: string;
  originKey: string;
  changeType: string;
  contentHash: string;
  receivedAt: string;
  sourceConnectionId?: string;
  sourceRecordId?: string;
  evidenceId?: string;
  subjects?: { kind: SubjectKind; id: string; role: string }[];
  summary?: Record<string, unknown>;
}

export interface ChangeSignalRecordedResult {
  changeSignalId: string;
  revision: number;
}

export interface CompleteChangeSignalParams extends ChangeSignalCommandContext {
  changeSignalId: string;
  completedAt: string;
}

export interface ChangeSignalCompletedResult {
  changeSignalId: string;
  outcome: 'APPLIED';
}

export interface ChangeSignalRow {
  id: string;
  originKind: string;
  originKey: string;
  changeType: string;
  contentHash: string;
  receivedAt: string;
  sourceConnectionId: string | null;
  sourceRecordId: string | null;
  evidenceId: string | null;
  summary: Record<string, unknown>;
  completedAt: string | null;
}

interface SubmitSpec<R> {
  uow: UnitOfWork;
  commandType: string;
  destinationKind: string;
  context: ChangeSignalCommandContext;
  payload: Record<string, unknown>;
  refs: TypedRef[];
  body: () => Promise<{ ok: true; value: R; advanced: AdvancedRoot[] } | { ok: false; conflict: ReturnType<typeof typedConflict> }>;
}

async function submit<R>(spec: SubmitSpec<R>): Promise<ExecuteOutcome<R>> {
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: spec.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: spec.context.workspaceId,
    actorPrincipalId: spec.context.actorPrincipalId,
    idempotencyKey: spec.context.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(spec.payload),
    typedPayload: spec.payload,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();
  try {
    return await spec.uow.execute<R>(envelope, async () => {
      const outcome = await spec.body();
      if (!outcome.ok) return outcome;
      await appendAuditTrail({ envelope, advanced: outcome.advanced, destinationKind: spec.destinationKind, payload: outcome.value });
      return { ok: true, value: outcome.value, receipt: buildReceipt({ envelope, value: outcome.value, advanced: outcome.advanced, committedAt }) };
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === '23505') return { ok: false, conflict: typedConflict('DUPLICATE_REGISTRATION', message, spec.refs) };
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, spec.refs) };
  }
}

/** Registers a change signal once per origin identity; a replay of the same identity and substance returns the original receipt. */
export async function recordChangeSignal(uow: UnitOfWork, params: RecordChangeSignalParams): Promise<ExecuteOutcome<ChangeSignalRecordedResult>> {
  const parsed = changeSignalInput.safeParse({
    changeSignalId: params.changeSignalId, originKind: params.originKind, originKey: params.originKey, changeType: params.changeType,
    contentHash: params.contentHash, receivedAt: params.receivedAt, sourceConnectionId: params.sourceConnectionId,
    sourceRecordId: params.sourceRecordId, evidenceId: params.evidenceId, subjects: params.subjects, summary: params.summary,
  });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const signalRef: TypedRef = { kind: 'CHANGE_SIGNAL', id: input.changeSignalId };
  return submit({
    uow, commandType: 'CHANGE_SIGNAL_RECORDED', destinationKind: 'CHANGE_SIGNAL', context: params, payload: input, refs: [signalRef],
    body: async () => {
      const client = currentTransactionClient();
      // Same origin identity already registered: same substance is a replay of
      // a previous (possibly differently keyed) delivery; different substance
      // is a genuine conflict. Either way this command writes nothing.
      const existing = await client.query<{ id: string; content_hash: string }>(
        'SELECT id, content_hash FROM change_signals WHERE workspace_id = $1 AND origin_kind = $2 AND origin_key = $3',
        [params.workspaceId, input.originKind, input.originKey],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.content_hash !== input.contentHash) {
          return { ok: false, conflict: typedConflict('DUPLICATE_REGISTRATION', `change signal ${input.originKind}:${input.originKey} already registered with a different content hash`, [{ kind: 'CHANGE_SIGNAL', id: row.id }]) };
        }
        return { ok: true, value: { changeSignalId: row.id, revision: 1 }, advanced: [] };
      }
      await createRoot({ workspaceId: params.workspaceId, id: input.changeSignalId, kind: 'CHANGE_SIGNAL' });
      await client.query(
        `INSERT INTO change_signals (workspace_id, id, origin_kind, origin_key, change_type, content_hash, received_at,
                                     source_connection_id, source_record_id, evidence_id, summary, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11::jsonb, $12)`,
        [params.workspaceId, input.changeSignalId, input.originKind, input.originKey, input.changeType, input.contentHash, input.receivedAt,
          input.sourceConnectionId ?? null, input.sourceRecordId ?? null, input.evidenceId ?? null, JSON.stringify(input.summary), params.actorPrincipalId],
      );
      for (const subject of input.subjects) {
        await client.query(
          `INSERT INTO signal_subjects (workspace_id, change_signal_id, subject_kind, subject_id, role) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [params.workspaceId, input.changeSignalId, subject.kind, subject.id, subject.role],
        );
      }
      return {
        ok: true,
        value: { changeSignalId: input.changeSignalId, revision: 1 },
        advanced: [{ aggregateRef: signalRef, beforeRevision: null, afterRevision: 1 }],
      };
    },
  });
}

/** Records the durable "applied" fact for a signal. Idempotent: a second completion of the same signal is a no-op replay. */
export async function completeChangeSignal(uow: UnitOfWork, params: CompleteChangeSignalParams): Promise<ExecuteOutcome<ChangeSignalCompletedResult>> {
  const parsed = z.strictObject({ changeSignalId: Uuid, completedAt: InstantSchema }).safeParse({ changeSignalId: params.changeSignalId, completedAt: params.completedAt });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const signalRef: TypedRef = { kind: 'CHANGE_SIGNAL', id: parsed.data.changeSignalId };
  return submit({
    uow, commandType: 'CHANGE_SIGNAL_COMPLETED', destinationKind: 'CHANGE_SIGNAL', context: params, payload: parsed.data, refs: [signalRef],
    body: async () => {
      const client = currentTransactionClient();
      const signal = await client.query<{ id: string }>('SELECT id FROM change_signals WHERE workspace_id = $1 AND id = $2', [params.workspaceId, parsed.data.changeSignalId]);
      if (!signal.rows[0]) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `change signal ${parsed.data.changeSignalId} is not registered`, [signalRef]) };
      await client.query(
        `INSERT INTO change_signal_completions (workspace_id, change_signal_id, completed_at, outcome, created_by_actor_id)
         VALUES ($1, $2, $3::timestamptz, 'APPLIED', $4)
         ON CONFLICT (workspace_id, change_signal_id) DO NOTHING`,
        [params.workspaceId, parsed.data.changeSignalId, parsed.data.completedAt, params.actorPrincipalId],
      );
      return { ok: true, value: { changeSignalId: parsed.data.changeSignalId, outcome: 'APPLIED' as const }, advanced: [] };
    },
  });
}

/** Read helper: one signal by id, with its completion (if any). */
export async function loadChangeSignal(db: Queryable, workspaceId: string, changeSignalId: string): Promise<ChangeSignalRow | undefined> {
  const result = await db.query<{
    id: string; origin_kind: string; origin_key: string; change_type: string; content_hash: string; received_at: Date;
    source_connection_id: string | null; source_record_id: string | null; evidence_id: string | null; summary: Record<string, unknown>; completed_at: Date | null;
  }>(
    `SELECT s.id, s.origin_kind, s.origin_key, s.change_type, s.content_hash, s.received_at, s.source_connection_id, s.source_record_id, s.evidence_id, s.summary,
            c.completed_at
       FROM change_signals s
       LEFT JOIN change_signal_completions c ON c.workspace_id = s.workspace_id AND c.change_signal_id = s.id
      WHERE s.workspace_id = $1 AND s.id = $2`,
    [workspaceId, changeSignalId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id, originKind: row.origin_kind, originKey: row.origin_key, changeType: row.change_type, contentHash: row.content_hash,
    receivedAt: row.received_at.toISOString(), sourceConnectionId: row.source_connection_id, sourceRecordId: row.source_record_id,
    evidenceId: row.evidence_id, summary: row.summary, completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/** Read helper: the signal registered for an origin identity, if any. */
export async function findChangeSignalByOrigin(db: Queryable, workspaceId: string, originKind: string, originKey: string): Promise<ChangeSignalRow | undefined> {
  const result = await db.query<{ id: string }>(
    'SELECT id FROM change_signals WHERE workspace_id = $1 AND origin_kind = $2 AND origin_key = $3',
    [workspaceId, originKind, originKey],
  );
  const row = result.rows[0];
  return row ? loadChangeSignal(db, workspaceId, row.id) : undefined;
}
