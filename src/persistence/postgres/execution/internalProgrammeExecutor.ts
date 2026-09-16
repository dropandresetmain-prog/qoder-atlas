/**
 * NORTHSTAR M8 — internal ProgrammeItem schedule execution.
 *
 * Path: stored ActionIntent → canonical execution gate → durable attempt →
 * strategy-stored effect payload → M4 updateProgrammeItemSchedule → observation.
 */
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { Pool } from '../pool.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { updateProgrammeItemSchedule } from '../commands/programmeCommands.ts';
import {
  createPreparedExecutionAttempt,
  transitionExecutionAttempt,
  type M8CommandIdentity,
} from '../commands/m8AuthorityCommands.ts';
import { INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY } from './storedExecutionGate.ts';
import { observedProgrammeRevisionFromPrerequisites } from './programmeRevisionRefresh.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import { randomUUID } from 'node:crypto';
import { DomainCommandEnvelopeSchema } from '../../../contracts/v2/command/domainCommand.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { appendAuditTrail, buildReceipt } from '../commandSupport.ts';

interface StoredProgrammeSchedule {
  programmeId: string;
  programmeItemId: string;
  /**
   * `undefined` when no source (prerequisite observation, the intent's own
   * captured `expectedRevisions`, or the strategy's base manifest) supplies
   * one. No `?? 1` fallback: a missing expected revision is an explicit
   * typed conflict at the caller, never a guessed CAS baseline.
   */
  expectedProgrammeRevision: number | undefined;
  schedule: {
    window?: { start: string; end: string };
    placeId?: string | null;
    timeZone?: string;
  };
}

async function loadStoredProgrammeSchedule(
  db: Pool,
  workspaceId: string,
  planId: string,
  intentId: string,
  programmeItemId: string,
  expectedRevisions: { aggregateRef: { kind: string; id: string }; expectedRevision: number }[],
): Promise<StoredProgrammeSchedule | undefined> {
  const plan = await db.query<{ scenario_change_id: string; recovery_strategy_id: string | null }>(
    'SELECT scenario_change_id, recovery_strategy_id FROM action_plans WHERE workspace_id = $1 AND id = $2',
    [workspaceId, planId],
  );
  const scenarioChangeId = plan.rows[0]?.scenario_change_id;
  if (!scenarioChangeId) return undefined;

  let effects: unknown[] | undefined;
  let baseManifest: { aggregateReads?: { aggregateRef: { kind: string; id: string }; revision: number }[] } | undefined;
  const change = await db.query<{ effects: unknown }>(
    'SELECT effects FROM strategy_changes WHERE workspace_id = $1 AND scenario_change_id = $2',
    [workspaceId, scenarioChangeId],
  );
  if (Array.isArray(change.rows[0]?.effects)) {
    effects = change.rows[0]!.effects as unknown[];
  }
  if (plan.rows[0]?.recovery_strategy_id) {
    const strategy = await db.query<{ scenario_change: { effects?: unknown[] }; base_manifest: unknown }>(
      'SELECT scenario_change, base_manifest FROM recovery_strategies WHERE workspace_id = $1 AND id = $2',
      [workspaceId, plan.rows[0].recovery_strategy_id],
    );
    const embedded = strategy.rows[0]?.scenario_change?.effects;
    if (!effects && Array.isArray(embedded)) effects = embedded;
    const rawManifest = strategy.rows[0]?.base_manifest;
    if (rawManifest && typeof rawManifest === 'object') {
      baseManifest = rawManifest as { aggregateReads?: { aggregateRef: { kind: string; id: string }; revision: number }[] };
    } else if (typeof rawManifest === 'string') {
      try {
        baseManifest = JSON.parse(rawManifest) as typeof baseManifest;
      } catch {
        baseManifest = undefined;
      }
    }
  }
  if (!effects) return undefined;

  type ProgrammeEffect = {
    effectKind?: string;
    programmeItemId?: string;
    proposedWindow?: { start: string; end: string };
    placeId?: string | null;
    timeZone?: string;
  };
  const effect = (effects as ProgrammeEffect[]).find(
    (e) => e.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME' && e.programmeItemId === programmeItemId,
  );
  if (!effect) return undefined;

  const programmeRow = await db.query<{ programme_id: string }>(
    'SELECT programme_id FROM programme_items WHERE workspace_id = $1 AND id = $2',
    [workspaceId, programmeItemId],
  );
  const programmeId = programmeRow.rows[0]?.programme_id;
  if (!programmeId) return undefined;

  const fromIntent = expectedRevisions.find(
    (r) => r.aggregateRef.kind === 'PROGRAMME' && r.aggregateRef.id === programmeId,
  )?.expectedRevision;
  const fromManifest = baseManifest?.aggregateReads?.find(
    (r) => r.aggregateRef.kind === 'PROGRAMME' && r.aggregateRef.id === programmeId,
  )?.revision;
  const fromPrereq = await observedProgrammeRevisionFromPrerequisites(
    db, workspaceId, intentId, programmeId,
  );
  const expectedProgrammeRevision = fromPrereq ?? fromIntent ?? fromManifest;

  return {
    programmeId,
    programmeItemId,
    expectedProgrammeRevision,
    schedule: {
      ...(effect.proposedWindow ? { window: effect.proposedWindow } : {}),
      ...(effect.placeId !== undefined ? { placeId: effect.placeId } : {}),
      ...(effect.timeZone !== undefined ? { timeZone: effect.timeZone } : {}),
    },
  };
}

export async function executeInternalProgrammeItemSchedule(
  pool: Pool,
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    planId: string;
    intentId: string;
    attemptNumber: number;
    principalId: string;
    now: string;
  },
): Promise<ExecuteOutcome<{ attemptId: string; observationId: string; programmeRevision?: number; replayed?: boolean }>> {
  const intentRow = await pool.query<{
    capability_ref: string;
    subject_refs: unknown;
    expected_revisions: unknown;
  }>(
    'SELECT capability_ref, subject_refs, expected_revisions FROM action_intents WHERE workspace_id = $1 AND id = $2',
    [params.workspaceId, params.intentId],
  );
  const intent = intentRow.rows[0];
  if (!intent || intent.capability_ref !== INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY) {
    return {
      ok: false,
      conflict: { kind: 'VALIDATION_FAILED', message: 'intent is not internal programme schedule capability', subjectRefs: [] },
    };
  }
  const subjectRefs = (Array.isArray(intent.subject_refs) ? intent.subject_refs : JSON.parse(String(intent.subject_refs))) as { kind: string; id: string }[];
  const programmeItemRef = subjectRefs.find((s) => s.kind === 'PROGRAMME_ITEM');
  if (!programmeItemRef) {
    return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'stored intent has no PROGRAMME_ITEM subject', subjectRefs: [] } };
  }
  const expectedRevisions = (Array.isArray(intent.expected_revisions)
    ? intent.expected_revisions
    : JSON.parse(String(intent.expected_revisions))) as { aggregateRef: { kind: string; id: string }; expectedRevision: number }[];

  const stored = await loadStoredProgrammeSchedule(
    pool, params.workspaceId, params.planId, params.intentId, programmeItemRef.id, expectedRevisions,
  );
  if (!stored) {
    return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'no stored programme schedule effect for intent', subjectRefs: [] } };
  }
  if (stored.expectedProgrammeRevision === undefined) {
    return {
      ok: false,
      conflict: {
        kind: 'VALIDATION_FAILED',
        message:
          'no expected Programme revision available for intent: no prerequisite observation, ' +
          "captured intent expectedRevisions, or strategy base manifest supplies one — refusing to guess",
        subjectRefs: [{ kind: 'PROGRAMME', id: stored.programmeId }],
      },
    };
  }

  const prepared = await createPreparedExecutionAttempt(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `${params.idempotencyKey}:prepare`,
    planId: params.planId,
    intentId: params.intentId,
    attemptNumber: params.attemptNumber,
    principalId: params.principalId,
    now: params.now,
  });
  if (!prepared.ok) return prepared;
  if (prepared.value.replayed && prepared.value.knownSuccess) {
    const existing = await pool.query<{ observation_id: string }>(
      `SELECT id AS observation_id FROM execution_observations
        WHERE workspace_id = $1 AND attempt_id = $2 ORDER BY observed_at DESC LIMIT 1`,
      [params.workspaceId, prepared.value.attemptId],
    );
    const replayValue = {
      attemptId: prepared.value.attemptId,
      observationId: existing.rows[0]?.observation_id ?? randomUUID(),
      replayed: true as const,
    };
    const replayEnvelope = DomainCommandEnvelopeSchema.parse({
      commandType: 'EXECUTION_INTERNAL_REPLAY',
      schemaVersion: '1',
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      idempotencyKey: `${params.idempotencyKey}:replay`,
      canonicalPayloadHash: canonicalPayloadHash(replayValue),
      expectedAggregateRevisions: [],
      typedPayload: replayValue,
      evidenceRefs: [],
    });
    return uow.execute(replayEnvelope, async () => ({
      ok: true,
      value: replayValue,
      receipt: buildReceipt({ envelope: replayEnvelope, value: replayValue, advanced: [], committedAt: new Date().toISOString() }),
    }));
  }

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
    const fencingToken = Number(moved.rows[0]!.fencing_token);
    const entering = await transitionExecutionAttempt(client, {
      workspaceId: params.workspaceId,
      attemptId: prepared.value.attemptId,
      from: 'CLAIMED',
      to: 'DISPATCHING',
      claimToken,
      fencingToken,
    });
    if (entering !== 'APPLIED') {
      return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'failed to enter DISPATCHING', subjectRefs: [] } };
    }
    await transitionExecutionAttempt(client, {
      workspaceId: params.workspaceId,
      attemptId: prepared.value.attemptId,
      from: 'DISPATCHING',
      to: 'DISPATCHED',
      claimToken,
      fencingToken,
    });
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
    programmeId: stored.programmeId,
    programmeItemId: stored.programmeItemId,
    expectedProgrammeRevision: stored.expectedProgrammeRevision,
    ...(stored.schedule.window !== undefined ? { window: stored.schedule.window } : {}),
    ...(stored.schedule.placeId !== undefined ? { placeId: stored.schedule.placeId } : {}),
    ...(stored.schedule.timeZone !== undefined ? { timeZone: stored.schedule.timeZone } : {}),
  });
  if (!scheduleResult.ok) {
    await transitionExecutionAttempt(pool, {
      workspaceId: params.workspaceId,
      attemptId: prepared.value.attemptId,
      from: 'DISPATCHED',
      to: 'OBSERVED_FAILURE',
      claimToken,
      fencingToken: claimed.value.fencingToken,
      lastError: scheduleResult.conflict.message,
    });
    return scheduleResult;
  }

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
    const moved = await transitionExecutionAttempt(client, {
      workspaceId: params.workspaceId,
      attemptId: prepared.value.attemptId,
      from: 'DISPATCHED',
      to: 'OBSERVED_SUCCESS',
      claimToken,
      fencingToken: claimed.value.fencingToken,
    });
    if (moved !== 'APPLIED') {
      return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'failed to record OBSERVED_SUCCESS', subjectRefs: [] } };
    }
    await client.query(
      `INSERT INTO execution_observations (
         workspace_id, id, attempt_id, action_intent_id, origin, command_receipt_ref,
         observed_at, owned_subject_refs, source_owned_fields, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,'INTERNAL_COMMAND_RECEIPT',$5,now(),$6::jsonb,$7::jsonb,$8)`,
      [
        params.workspaceId, observationId, prepared.value.attemptId, params.intentId,
        scheduleResult.receipt.idempotencyKey,
        JSON.stringify([{ kind: 'PROGRAMME_ITEM', id: stored.programmeItemId }]),
        JSON.stringify({
          programmeId: stored.programmeId,
          programmeRevision: scheduleResult.value.programmeRevision,
        }),
        params.actorPrincipalId,
      ],
    );
    const programmeRevision = scheduleResult.value.programmeRevision;
    const value = {
      attemptId: prepared.value.attemptId,
      observationId,
      programmeRevision,
    };
    await appendAuditTrail({ envelope, advanced: [], destinationKind: 'EXECUTION_ATTEMPT', payload: value });
    return {
      ok: true,
      value,
      receipt: buildReceipt({ envelope, value, advanced: [], committedAt }),
    };
  });
}
