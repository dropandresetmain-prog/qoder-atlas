/**
 * Reference domain command handlers over `PgUnitOfWork` — the M1 foundation's
 * own proof that a handler can persist typed rows, advance a head, append a
 * change record and an outbox row, and receive a committed receipt, entirely
 * through the `UnitOfWork` boundary with **no SQL outside `src/persistence/postgres/**`**.
 * Nothing under `src/engine/**` may issue SQL directly (M1 acceptance:
 * "domain handlers can operate through the target UoW/repository contracts
 * without direct SQL in the engine").
 *
 * `workspaces` is M1's own root (see docs/work/ACTIVE_TASK.md decision #2) —
 * this is intentionally not a preview of an M2 "organisations" handler.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DomainCommandEnvelopeSchema,
  serializeCommandResult,
  type DomainCommandEnvelope,
  type CommandReceipt,
} from '../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { ExecuteOutcome } from './pgUnitOfWork.ts';
import { typedConflict } from '../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from './canonicalHash.ts';
import { currentTransactionClient } from './transactionContext.ts';

const SCHEMA_VERSION = '1';

const RegisterWorkspacePayloadSchema = z.strictObject({ name: z.string().min(1) });
const RenameWorkspacePayloadSchema = z.strictObject({ name: z.string().min(1) });

export interface WorkspaceCommandResult {
  workspaceId: string;
  name: string;
  revision: number;
}

async function appendChangeRecordAndOutbox(params: {
  envelope: DomainCommandEnvelope;
  subjectId: string;
  beforeRevision: number | null;
  afterRevision: number;
  destinationKind: string;
  outboxPayload: unknown;
}): Promise<void> {
  const client = currentTransactionClient();
  await client.query(
    `INSERT INTO change_records
       (workspace_id, command_namespace, idempotency_key, actor_principal_id, represented_party_id,
        subject_kind, subject_id, before_revision, after_revision, evidence_refs, reason)
     VALUES ($1, $2, $3, $4, $5, 'WORKSPACE', $6, $7, $8, $9, $10)`,
    [
      params.envelope.workspaceId,
      params.envelope.commandType,
      params.envelope.idempotencyKey,
      params.envelope.actorPrincipalId,
      params.envelope.representedPartyId ?? null,
      params.subjectId,
      params.beforeRevision,
      params.afterRevision,
      JSON.stringify(params.envelope.evidenceRefs),
      params.envelope.commandType,
    ],
  );
  await client.query(
    `INSERT INTO outbox (workspace_id, subject_kind, subject_id, destination_kind, payload)
     VALUES ($1, 'WORKSPACE', $2, $3, $4)`,
    [params.envelope.workspaceId, params.subjectId, params.destinationKind, JSON.stringify(params.outboxPayload)],
  );
}

function buildReceipt(envelope: DomainCommandEnvelope, value: WorkspaceCommandResult): CommandReceipt {
  return {
    workspaceId: envelope.workspaceId,
    commandNamespace: envelope.commandType,
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.canonicalPayloadHash,
    resultRef: serializeCommandResult(value),
    committedRevisions: [
      {
        aggregateRef: { kind: 'WORKSPACE', id: value.workspaceId },
        expectedRevision: value.revision,
      },
    ],
    committedAt: new Date().toISOString(),
  };
}

export interface RegisterWorkspaceParams {
  actorPrincipalId: string;
  idempotencyKey: string;
  name: string;
  /** Client-generated per DATA_STRUCTURE_LOGICAL_SCHEMA.md §1 ("Domain identity uses UUIDs"); defaults to a fresh UUID. */
  workspaceId?: string;
}

export async function registerWorkspace(
  uow: UnitOfWork,
  params: RegisterWorkspaceParams,
): Promise<ExecuteOutcome<WorkspaceCommandResult>> {
  const payload = RegisterWorkspacePayloadSchema.parse({ name: params.name });
  const workspaceId = params.workspaceId ?? randomUUID();

  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'REGISTER_WORKSPACE',
    schemaVersion: SCHEMA_VERSION,
    workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    expectedAggregateRevisions: [],
    typedPayload: payload,
  });

  return uow.execute<WorkspaceCommandResult>(envelope, async () => {
    const client = currentTransactionClient();
    await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, payload.name]);
    await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $1, 1)', [
      workspaceId,
    ]);
    await client.query(
      "INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $1, 'WORKSPACE', $1)",
      [workspaceId],
    );
    const value: WorkspaceCommandResult = { workspaceId, name: payload.name, revision: 1 };
    await appendChangeRecordAndOutbox({
      envelope,
      subjectId: workspaceId,
      beforeRevision: null,
      afterRevision: 1,
      destinationKind: 'WORKSPACE_REGISTERED',
      outboxPayload: value,
    });
    return { ok: true, value, receipt: buildReceipt(envelope, value) };
  });
}

export interface RenameWorkspaceParams {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  name: string;
  expectedRevision: number;
}

export async function renameWorkspace(
  uow: UnitOfWork,
  params: RenameWorkspaceParams,
): Promise<ExecuteOutcome<WorkspaceCommandResult>> {
  const payload = RenameWorkspacePayloadSchema.parse({ name: params.name });

  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'RENAME_WORKSPACE',
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    expectedAggregateRevisions: [
      {
        aggregateRef: { kind: 'WORKSPACE', id: params.workspaceId },
        expectedRevision: params.expectedRevision,
      },
    ],
    typedPayload: payload,
  });

  return uow.execute<WorkspaceCommandResult>(envelope, async ({ lockedHeads }) => {
    const head = lockedHeads.find((h) => h.aggregateRef.id === params.workspaceId);
    if (!head) {
      return {
        ok: false,
        conflict: typedConflict('STALE_AGGREGATE_REVISION', `workspace ${params.workspaceId} has no aggregate head`, [
          { kind: 'WORKSPACE', id: params.workspaceId },
        ]),
      };
    }
    const client = currentTransactionClient();
    const nextRevision = head.revision + 1;
    const updateResult = await client.query(
      `UPDATE aggregate_heads SET revision = $1, updated_at = now()
       WHERE workspace_id = $2 AND aggregate_id = $2 AND revision = $3`,
      [nextRevision, params.workspaceId, head.revision],
    );
    if (updateResult.rowCount === 0) {
      return {
        ok: false,
        conflict: typedConflict(
          'STALE_AGGREGATE_REVISION',
          `aggregate_heads revision changed concurrently for workspace ${params.workspaceId}`,
          [{ kind: 'WORKSPACE', id: params.workspaceId }],
        ),
      };
    }
    await client.query('UPDATE workspaces SET name = $1, updated_at = now() WHERE id = $2', [
      payload.name,
      params.workspaceId,
    ]);
    const value: WorkspaceCommandResult = { workspaceId: params.workspaceId, name: payload.name, revision: nextRevision };
    await appendChangeRecordAndOutbox({
      envelope,
      subjectId: params.workspaceId,
      beforeRevision: head.revision,
      afterRevision: nextRevision,
      destinationKind: 'WORKSPACE_RENAMED',
      outboxPayload: value,
    });
    return { ok: true, value, receipt: buildReceipt(envelope, value) };
  });
}
