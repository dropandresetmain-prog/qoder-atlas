/**
 * NORTHSTAR M8 — internal ProgrammeItem schedule execution.
 *
 * Planner never mutates ProgrammeItem directly. Path:
 * current viability → ActionIntent → scoped authority → expected revision →
 * durable execution record → M4 updateProgrammeItemSchedule → internal
 * observation receipt → reassessment.
 */
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { updateProgrammeItemSchedule } from '../commands/programmeCommands.ts';
import { createPreparedExecutionAttempt, authorizeDispatch, type DispatchAuthorizationInput, type M8CommandIdentity } from '../commands/m8AuthorityCommands.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import { randomUUID } from 'node:crypto';
import { DomainCommandEnvelopeSchema } from '../../../contracts/v2/command/domainCommand.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt } from '../commandSupport.ts';

export async function executeInternalProgrammeItemSchedule(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    authorization: DispatchAuthorizationInput;
    planId: string;
    intentId: string;
    attemptNumber: number;
    logicalOperationKey: string;
    requestFingerprint: string;
    programmeId: string;
    programmeItemId: string;
    expectedProgrammeRevision: number;
    schedule: {
      window?: { start: string; end: string };
      placeId?: string | null;
      timeZone?: string;
    };
  },
): Promise<ExecuteOutcome<{ attemptId: string; observationId: string; programmeRevision?: number }>> {
  const auth = authorizeDispatch(params.authorization);
  if (!auth.allowed) {
    return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: `authority denied: ${auth.reason}`, subjectRefs: [] } };
  }

  const prepared = await createPreparedExecutionAttempt(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `${params.idempotencyKey}:prepare`,
    planId: params.planId,
    intentId: params.intentId,
    attemptNumber: params.attemptNumber,
    logicalOperationKey: params.logicalOperationKey,
    requestFingerprint: params.requestFingerprint,
  });
  if (!prepared.ok) return prepared;

  // Durable claim before mutation: PREPARED → CLAIMED → DISPATCHING → DISPATCHED.
  const claimToken = randomUUID();
  const claimEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'EXECUTION_INTERNAL_CLAIMED',
    schemaVersion: '1',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `${params.idempotencyKey}:claim`,
    canonicalPayloadHash: canonicalPayloadHash({ attemptId: prepared.value.attemptId, claimToken }),
    expectedAggregateRevisions: [],
    typedPayload: { attemptId: prepared.value.attemptId, claimToken },
    evidenceRefs: [],
  });
  const claimed = await uow.execute<{ fencingToken: number }>(claimEnvelope, async () => {
    const client = currentTransactionClient();
    const moved = await client.query<{ fencing_token: string }>(
      `UPDATE execution_attempts
          SET status = 'CLAIMED', claim_token = $3, fencing_token = fencing_token + 1,
              lease_expires_at = now() + interval '60 seconds', updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'PREPARED'
        RETURNING fencing_token`,
      [params.workspaceId, prepared.value.attemptId, claimToken],
    );
    if ((moved.rowCount ?? 0) === 0) {
      return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'failed to claim prepared attempt', subjectRefs: [] } };
    }
    await client.query(
      `UPDATE execution_attempts SET status = 'DISPATCHING', updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'CLAIMED' AND claim_token = $3`,
      [params.workspaceId, prepared.value.attemptId, claimToken],
    );
    await client.query(
      `UPDATE execution_attempts SET status = 'DISPATCHED', updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'DISPATCHING' AND claim_token = $3`,
      [params.workspaceId, prepared.value.attemptId, claimToken],
    );
    const fencingToken = Number(moved.rows[0]!.fencing_token);
    const value = { fencingToken };
    await appendAuditTrail({ envelope: claimEnvelope, advanced: [], destinationKind: 'EXECUTION_ATTEMPT', payload: value });
    return {
      ok: true,
      value,
      receipt: buildReceipt({ envelope: claimEnvelope, value, advanced: [], committedAt: new Date().toISOString() }),
    };
  });
  if (!claimed.ok) return claimed;

  const scheduleResult = await updateProgrammeItemSchedule(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `${params.idempotencyKey}:schedule`,
    programmeId: params.programmeId,
    programmeItemId: params.programmeItemId,
    expectedProgrammeRevision: params.expectedProgrammeRevision,
    ...(params.schedule.window !== undefined ? { window: params.schedule.window } : {}),
    ...(params.schedule.placeId !== undefined ? { placeId: params.schedule.placeId } : {}),
    ...(params.schedule.timeZone !== undefined ? { timeZone: params.schedule.timeZone } : {}),
  });
  if (!scheduleResult.ok) return scheduleResult;

  const observationId = randomUUID();
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'EXECUTION_INTERNAL_OBSERVED',
    schemaVersion: '1',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `${params.idempotencyKey}:observe`,
    canonicalPayloadHash: canonicalPayloadHash({ observationId, attemptId: prepared.value.attemptId }),
    expectedAggregateRevisions: [],
    typedPayload: { observationId, attemptId: prepared.value.attemptId },
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();
  return uow.execute(envelope, async () => {
    const client = currentTransactionClient();
    await client.query(
      `UPDATE execution_attempts
          SET status = 'OBSERVED_SUCCESS', updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'DISPATCHED' AND claim_token = $3`,
      [params.workspaceId, prepared.value.attemptId, claimToken],
    );
    await client.query(
      `INSERT INTO execution_observations (
         workspace_id, id, attempt_id, action_intent_id, origin, command_receipt_ref,
         observed_at, owned_subject_refs, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,'INTERNAL_COMMAND_RECEIPT',$5,now(),$6::jsonb,$7)`,
      [
        params.workspaceId, observationId, prepared.value.attemptId, params.intentId,
        scheduleResult.receipt.idempotencyKey,
        JSON.stringify([{ kind: 'PROGRAMME_ITEM', id: params.programmeItemId }]),
        params.actorPrincipalId,
      ],
    );
    await client.query(
      `UPDATE action_intents SET status = 'COMPLETED', updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, params.intentId],
    );
    const value = {
      attemptId: prepared.value.attemptId,
      observationId,
      programmeRevision: params.expectedProgrammeRevision + 1,
    };
    await appendAuditTrail({ envelope, advanced: [], destinationKind: 'EXECUTION_ATTEMPT', payload: value });
    return {
      ok: true,
      value,
      receipt: buildReceipt({ envelope, value, advanced: [], committedAt }),
    };
  });
}
