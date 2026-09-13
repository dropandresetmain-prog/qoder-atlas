/**
 * Shared command-support primitives (M2).
 *
 * M1's `workspaceCommands.ts` proved the shape of a handler end to end; M2 has
 * eleven subject kinds and ~30 tables, so the identical four steps — register
 * identity, CAS the head, append history + outbox, build the receipt — are
 * lifted here rather than copy-pasted per handler. SQL stays inside
 * `src/persistence/postgres/**` (M1 acceptance: no direct SQL in the engine),
 * and every function runs on the ambient transaction client installed by
 * `PgUnitOfWork.execute`, so a handler's writes and its audit trail are one
 * atomic unit.
 *
 * Order matters in exactly one place: `aggregate_heads` and `domain_subjects`
 * reference each other through DEFERRABLE INITIALLY DEFERRED circular FKs, so
 * the head row is always inserted before the subject row. Subtype enforcement
 * (the 0010 registry dispatcher) fires at COMMIT, which is what lets a handler
 * insert a typed row before or after registering its subject.
 */
import { createHash } from 'node:crypto';
import type { RootRevision, SubjectKind, TypedRef } from '../../domain/v2/shared/identity.ts';
import type { TypedConflict } from '../../domain/v2/shared/errors.ts';
import { typedConflict } from '../../domain/v2/shared/errors.ts';
import {
  serializeCommandResult,
  type CommandReceipt,
  type DomainCommandEnvelope,
} from '../../contracts/v2/command/domainCommand.ts';
import { currentTransactionClient } from './transactionContext.ts';
import type { Pool, PoolClient } from './pool.ts';

/** One root whose revision a command moved, recorded for audit + receipt. */
export interface AdvancedRoot {
  aggregateRef: TypedRef;
  beforeRevision: number | null;
  afterRevision: number;
}

/**
 * Anything that can run a parameterized statement. Write-side code takes the
 * ambient transaction client; the frozen `UnitOfWork` exposes no read-only
 * transaction, so read-side query classes accept a `Queryable` (pool or
 * client) injected by the caller. That omission is recorded as an
 * architecture gap in docs/refactor/evidence/M2.md rather than patched into
 * the accepted interface.
 */
export type Queryable = Pool | PoolClient;

/**
 * Creates a mutable root: its single revision counter and its registry
 * identity, with the root as its own aggregate. Callers must have generated the
 * id *outside* the `execute` callback — this function must stay replay-safe
 * across bounded serializable retries (C1 amendment c).
 */
export async function createRoot(params: {
  workspaceId: string;
  id: string;
  kind: SubjectKind;
}): Promise<void> {
  const client = currentTransactionClient();
  await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [
    params.workspaceId,
    params.id,
  ]);
  await client.query(
    'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $2)',
    [params.workspaceId, params.id, params.kind],
  );
}

/**
 * Registers a child subject under an existing root. The child deliberately gets
 * no `aggregate_heads` row: the root is the only revision counter, so N children
 * cannot drift into N concurrently-versioned aggregates. The kind's subtype
 * checker (0010) is what proves the child's typed row exists.
 */
export async function registerChildSubject(params: {
  workspaceId: string;
  id: string;
  kind: SubjectKind;
  aggregateId: string;
}): Promise<void> {
  const client = currentTransactionClient();
  await client.query(
    'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
    [params.workspaceId, params.id, params.kind, params.aggregateId],
  );
}

/**
 * Compare-and-set revision advance. Returns the new revision, or `undefined`
 * when the counter moved underneath the caller — the handler must translate
 * that into a typed conflict rather than writing again.
 */
export async function advanceHead(params: {
  workspaceId: string;
  aggregateId: string;
  fromRevision: number;
}): Promise<number | undefined> {
  const client = currentTransactionClient();
  const nextRevision = params.fromRevision + 1;
  const result = await client.query(
    `UPDATE aggregate_heads SET revision = $1, updated_at = now()
      WHERE workspace_id = $2 AND aggregate_id = $3 AND revision = $4`,
    [nextRevision, params.workspaceId, params.aggregateId, params.fromRevision],
  );
  return result.rowCount === 1 ? nextRevision : undefined;
}

/** Current revision of a root, or `undefined` when it has no head at all. */
export async function headRevisionOf(workspaceId: string, aggregateId: string): Promise<number | undefined> {
  const client = currentTransactionClient();
  const result = await client.query<{ revision: string }>(
    'SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2',
    [workspaceId, aggregateId],
  );
  const row = result.rows[0];
  return row ? Number(row.revision) : undefined;
}

/**
 * Appends one `change_records` row and one `outbox` row per advanced root,
 * keyed by the command's own (namespace, idempotency key). Both tables have a
 * deferred FK into `command_receipts`, which `PgUnitOfWork` inserts after the
 * handler returns — that ordering is intentional and only safe because the FKs
 * are `INITIALLY DEFERRED`.
 */
export async function appendAuditTrail(params: {
  envelope: DomainCommandEnvelope;
  advanced: AdvancedRoot[];
  destinationKind: string;
  payload: unknown;
}): Promise<void> {
  const client = currentTransactionClient();
  for (const root of params.advanced) {
    await client.query(
      `INSERT INTO change_records
         (workspace_id, command_namespace, idempotency_key, actor_principal_id, represented_party_id,
          subject_kind, subject_id, before_revision, after_revision, evidence_refs, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        params.envelope.workspaceId,
        params.envelope.commandType,
        params.envelope.idempotencyKey,
        params.envelope.actorPrincipalId,
        params.envelope.representedPartyId ?? null,
        root.aggregateRef.kind,
        root.aggregateRef.id,
        root.beforeRevision,
        root.afterRevision,
        JSON.stringify(params.envelope.evidenceRefs),
        params.envelope.commandType,
      ],
    );
    await client.query(
      `INSERT INTO outbox (workspace_id, subject_kind, subject_id, destination_kind, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.envelope.workspaceId,
        root.aggregateRef.kind,
        root.aggregateRef.id,
        params.destinationKind,
        JSON.stringify(params.payload),
      ],
    );
  }
}

/**
 * Builds the committed receipt. `committedRevisions` carries the revision each
 * root reached, so a later command can cite this receipt as its basis.
 * `resultRef` is the JSON-encoded result itself — replay decodes it instead of
 * re-running the handler (post-C0 clarification recorded in
 * docs/refactor/CONTRACTS.md).
 */
export function buildReceipt<T>(params: {
  envelope: DomainCommandEnvelope;
  value: T;
  advanced: AdvancedRoot[];
  committedAt?: string;
}): CommandReceipt {
  return {
    workspaceId: params.envelope.workspaceId,
    commandNamespace: params.envelope.commandType,
    idempotencyKey: params.envelope.idempotencyKey,
    payloadHash: params.envelope.canonicalPayloadHash,
    resultRef: serializeCommandResult(params.value),
    committedRevisions: params.advanced.map((root) => ({
      aggregateRef: root.aggregateRef,
      expectedRevision: root.afterRevision,
    })),
    committedAt: params.committedAt ?? new Date().toISOString(),
  };
}

/**
 * Deterministic reference for the command that produced a row, used where a
 * table stores provenance as text (e.g. `credential_selections.selected_by_command_id`).
 * Derived only from envelope identity fields, so a serializable retry of the
 * same command derives the same value (C1 amendment c).
 */
export function derivedCommandRef(envelope: DomainCommandEnvelope): string {
  const digest = createHash('sha256')
    .update(`${envelope.workspaceId}|${envelope.commandType}|${envelope.idempotencyKey}`, 'utf8')
    .digest('hex');
  return `cmd-${digest.slice(0, 32)}`;
}

/** CAS failure mapped to the frozen conflict vocabulary. */
export function staleRevisionConflict(ref: TypedRef, expectedRevision: number): TypedConflict {
  return typedConflict(
    'STALE_AGGREGATE_REVISION',
    `aggregate_heads revision changed concurrently for ${ref.kind}:${ref.id} at revision ${expectedRevision}`,
    [ref],
  );
}

/** Root-not-found mapped to the same vocabulary the idempotency layer uses. */
export function missingHeadConflict(ref: TypedRef): TypedConflict {
  return typedConflict('STALE_AGGREGATE_REVISION', `${ref.kind}:${ref.id} has no aggregate head`, [ref]);
}

/**
 * Reads the locked revision of one root from an `execute` context. Handlers that
 * declare an expected revision may rely on `PgUnitOfWork` having verified it, so
 * a miss here is a programming error surfaced as a conflict, not a silent 1.
 */
export function lockedRevisionOf(lockedHeads: RootRevision[], aggregateId: string): number | undefined {
  const found = lockedHeads.find((head) => head.aggregateRef.id === aggregateId);
  return found?.revision;
}
