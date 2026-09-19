import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import {
  submitChangeRequest,
  transitionChangeRequest,
  loadChangeRequest,
} from '../../persistence/postgres/commands/changeRequestCommands.ts';
import { recordSource } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import {
  completeChangeSignal,
  recordChangeSignal,
} from '../../persistence/postgres/commands/changeSignalCommands.ts';
import { openRecoveryCase } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import { attachCaseSubjects } from '../../persistence/postgres/commands/caseLifecycleCommands.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import {
  SubmitChangeRequestPayloadSchema,
  targetLinksForDesiredChange,
  type ChangeRequestRecord,
  type DesiredChangeTarget,
} from '../../contracts/v2/change/changeRequest.ts';
import type { ChangeRequestIntentKind, ChangeRequestUrgency, FundingDeclaration } from '../../contracts/v2/change/changeRequest.ts';
import type { ApplicationError } from '../../contracts/v2/product/readModels.ts';
import { InstantSchema } from '../../domain/v2/shared/time.ts';
import { typedConflict, type TypedConflict } from '../../domain/v2/shared/errors.ts';

/**
 * The request boundary receives identity and time from the composed server.
 * It deliberately has no HTTP or authentication dependency.
 *
 * Terra's coordinator is still being reconciled with the request-basis
 * extension, so this is the narrow port the composition root injects for now.
 */
export interface ChangeRequestAdmissionPlanner {
  planCase(input: {
    recoveryCaseId: string;
    reason: 'OPERATOR_REQUEST';
    /** The coordinator loads and validates this canonical request itself. */
    changeRequestId: string;
  }): Promise<unknown>;
}

export interface ChangeRequestAdmissionInput {
  workspaceId: string;
  /** Server-resolved principal. This module never reads a request header. */
  principalId: string;
  journeyId: string;
  sourceUtterance: string;
  intentKind: ChangeRequestIntentKind;
  urgency: ChangeRequestUrgency;
  desiredTarget: z.input<typeof SubmitChangeRequestPayloadSchema>['desiredTarget'];
  fundingDeclaration?: FundingDeclaration;
  idempotencyKey: string;
  /** Trusted server time, pinned for authorization and all created records. */
  now: string;
}

export interface ChangeRequestAdmissionDeps {
  pool: Pool;
  uow: () => PgUnitOfWork;
  planner: ChangeRequestAdmissionPlanner;
}

export interface ChangeRequestAdmissionValue {
  sourceRecordId: string;
  changeRequestId: string;
  changeSignalId: string;
  recoveryCaseId: string;
  lifecycle: 'ACCEPTED_FOR_PLANNING';
  planning:
    | { status: 'PLANNED'; result: unknown }
    | { status: 'RETRYABLE_FAILURE'; error: ApplicationError };
}

export type ChangeRequestAdmissionOutcome =
  | { ok: true; value: ChangeRequestAdmissionValue }
  | { ok: false; conflict: TypedConflict };

const Uuid = z.string().uuid();

const REFUSAL = (message: string, subjectRefs: TypedConflict['subjectRefs'] = []): ChangeRequestAdmissionOutcome => ({
  ok: false,
  conflict: typedConflict('VALIDATION_FAILED', message, subjectRefs),
});

function requestIds(workspaceId: string, idempotencyKey: string) {
  const identity = `${workspaceId}|change-request-admission|${idempotencyKey}`;
  return {
    sourceRecordId: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${identity}|source`),
    changeRequestId: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${identity}|request`),
    changeSignalId: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${identity}|signal`),
    recoveryCaseId: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${identity}|case`),
  };
}

function contentHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function commandConflict(outcome: { ok: false; conflict: TypedConflict }): ChangeRequestAdmissionOutcome {
  return { ok: false, conflict: outcome.conflict };
}

async function loadJourneyTraveller(pool: Pool, workspaceId: string, journeyId: string): Promise<string | undefined> {
  const result = await pool.query<{ traveller_id: string }>(
    'SELECT traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2',
    [workspaceId, journeyId],
  );
  return result.rows[0]?.traveller_id;
}

/** The same exact grant predicate as submitChangeRequest, evaluated before source capture. */
async function hasCurrentRequestGrant(
  pool: Pool,
  args: { workspaceId: string; principalId: string; travellerId: string; journeyId: string; at: string },
): Promise<boolean> {
  const principal = await pool.query<{ status: string }>(
    'SELECT status FROM principals WHERE workspace_id = $1 AND id = $2',
    [args.workspaceId, args.principalId],
  );
  if (principal.rows[0]?.status !== 'ACTIVE') return false;
  const grant = await pool.query<{ id: string }>(
    `SELECT g.id
       FROM authority_grants g
       JOIN grant_actions a ON a.workspace_id = g.workspace_id AND a.grant_id = g.id AND a.action_kind = $6
       JOIN grant_scopes s ON s.workspace_id = g.workspace_id AND s.grant_id = g.id
      WHERE g.workspace_id = $1 AND g.principal_id = $2
        AND g.represented_party_kind = 'TRAVELLER' AND g.represented_party_id = $3
        AND s.scope_kind = 'JOURNEY' AND s.scope_id = $4
        AND g.issued_at <= $5::timestamptz
        AND (g.expires_at IS NULL OR g.expires_at > $5::timestamptz)
        AND (g.revoked_at IS NULL OR g.revoked_at > $5::timestamptz)
      LIMIT 1`,
    [args.workspaceId, args.principalId, args.travellerId, args.journeyId, args.at, 'change.request.submit'],
  );
  return Boolean(grant.rows[0]);
}

async function validateTargetLinks(pool: Pool, workspaceId: string, target: DesiredChangeTarget): Promise<string | undefined> {
  for (const link of targetLinksForDesiredChange(target)) {
    const found = await pool.query<{ id: string }>(
      'SELECT id FROM domain_subjects WHERE workspace_id = $1 AND id = $2 AND kind = $3',
      [workspaceId, link.targetRef.id, link.targetRef.kind],
    );
    if (!found.rows[0]) return `target ${link.targetRef.kind}:${link.targetRef.id} does not exist with its required kind`;
  }
  return undefined;
}

/**
 * Admit one typed traveller change request and hand the accepted case to the
 * existing planner. Every application-owned identity is derived from the
 * stable key, so a retry resumes a durable prefix instead of creating a new
 * source, request, signal, or case. This function never changes canonical
 * journey, service, reservation, or objective state.
 */
export async function admitChangeRequest(
  deps: ChangeRequestAdmissionDeps,
  input: ChangeRequestAdmissionInput,
): Promise<ChangeRequestAdmissionOutcome> {
  for (const [label, value] of [
    ['workspaceId', input.workspaceId],
    ['principalId', input.principalId],
    ['journeyId', input.journeyId],
  ] as const) {
    if (!Uuid.safeParse(value).success) return REFUSAL(`${label} must be a UUID`);
  }
  if (!input.idempotencyKey.trim()) return REFUSAL('idempotencyKey must not be empty');
  const parsed = SubmitChangeRequestPayloadSchema.safeParse({
    changeRequestId: requestIds(input.workspaceId, input.idempotencyKey).changeRequestId,
    representedTravellerId: '00000000-0000-0000-0000-000000000000',
    journeyId: input.journeyId,
    sourceRecordId: requestIds(input.workspaceId, input.idempotencyKey).sourceRecordId,
    sourceUtterance: input.sourceUtterance,
    submittedAt: input.now,
    intentKind: input.intentKind,
    urgency: input.urgency,
    desiredTarget: input.desiredTarget,
    fundingDeclaration: input.fundingDeclaration,
  });
  if (!parsed.success) return REFUSAL(parsed.error.message);
  const parsedNow = InstantSchema.safeParse(input.now);
  if (!parsedNow.success) return REFUSAL(parsedNow.error.message);
  const now = parsedNow.data;
  const ids = requestIds(input.workspaceId, input.idempotencyKey);
  const travellerId = await loadJourneyTraveller(deps.pool, input.workspaceId, input.journeyId);
  if (!travellerId) return REFUSAL(`journey ${input.journeyId} does not exist`, [{ kind: 'JOURNEY', id: input.journeyId }]);

  if (!(await hasCurrentRequestGrant(deps.pool, {
    workspaceId: input.workspaceId, principalId: input.principalId,
    travellerId, journeyId: input.journeyId, at: now,
  }))) {
    return REFUSAL(
      `principal ${input.principalId} lacks a current change.request.submit grant representing traveller ${travellerId} over journey ${input.journeyId}`,
      [{ kind: 'PRINCIPAL', id: input.principalId }, { kind: 'TRAVELLER', id: travellerId }, { kind: 'JOURNEY', id: input.journeyId }],
    );
  }
  const targetError = await validateTargetLinks(deps.pool, input.workspaceId, parsed.data.desiredTarget);
  if (targetError) return REFUSAL(targetError);

  const identity = { workspaceId: input.workspaceId, actorPrincipalId: input.principalId };
  const source = await recordSource(deps.uow(), {
    ...identity,
    idempotencyKey: `change-request-admission:source:${input.idempotencyKey}`,
    sourceId: ids.sourceRecordId,
    sourceIdentity: `change-request:${ids.changeRequestId}`,
    receivedAt: now,
    contentHash: contentHash(input.sourceUtterance),
    contentType: 'text/plain',
    captureMetadata: { intake: 'TRAVELLER_CHANGE_REQUEST', requestKey: input.idempotencyKey },
  });
  if (!source.ok) return commandConflict(source);

  const submitted = await submitChangeRequest(deps.uow(), {
    ...identity,
    idempotencyKey: `change-request-admission:request:${input.idempotencyKey}`,
    changeRequestId: ids.changeRequestId,
    representedTravellerId: travellerId,
    journeyId: input.journeyId,
    sourceRecordId: ids.sourceRecordId,
    sourceUtterance: input.sourceUtterance,
    submittedAt: now,
    intentKind: input.intentKind,
    urgency: input.urgency,
    desiredTarget: input.desiredTarget,
    fundingDeclaration: input.fundingDeclaration,
  }, { authorizationNow: () => now });
  if (!submitted.ok) return commandConflict(submitted);

  const request = await loadChangeRequest(deps.pool, input.workspaceId, ids.changeRequestId);
  if (!request) return REFUSAL(`change request ${ids.changeRequestId} was not readable after submission`, [{ kind: 'CHANGE_REQUEST', id: ids.changeRequestId }]);
  let accepted: ChangeRequestRecord = request;
  if (request.lifecycle === 'SUBMITTED') {
    const transitioned = await transitionChangeRequest(deps.uow(), {
      ...identity,
      idempotencyKey: `change-request-admission:accept:${input.idempotencyKey}`,
      changeRequestId: ids.changeRequestId,
      expectedRevision: request.revision,
      from: 'SUBMITTED',
      to: 'ACCEPTED_FOR_PLANNING',
      transitionedAt: now,
    }, { authorizationNow: () => now });
    if (!transitioned.ok) return commandConflict(transitioned);
    accepted = (await loadChangeRequest(deps.pool, input.workspaceId, ids.changeRequestId)) ?? request;
  }
  if (accepted.lifecycle !== 'ACCEPTED_FOR_PLANNING') {
    return REFUSAL(`change request ${ids.changeRequestId} is ${accepted.lifecycle}; it cannot enter planning`, [{ kind: 'CHANGE_REQUEST', id: ids.changeRequestId }]);
  }

  const signal = await recordChangeSignal(deps.uow(), {
    ...identity,
    idempotencyKey: `change-request-admission:signal:${input.idempotencyKey}`,
    changeSignalId: ids.changeSignalId,
    originKind: 'TRAVELLER_INPUT',
    originKey: `change-request:${ids.changeRequestId}`,
    changeType: 'CHANGE_REQUEST_SUBMITTED',
    contentHash: contentHash(`${ids.changeRequestId}|${accepted.revision}|${input.sourceUtterance}`),
    receivedAt: now,
    sourceRecordId: ids.sourceRecordId,
    subjects: [
      { kind: 'JOURNEY', id: input.journeyId, role: 'REQUEST_SCOPE' },
      { kind: 'TRAVELLER', id: travellerId, role: 'REPRESENTED_TRAVELLER' },
      { kind: 'CHANGE_REQUEST', id: ids.changeRequestId, role: 'REQUEST' },
    ],
    summary: { changeRequestId: ids.changeRequestId, lifecycle: accepted.lifecycle },
  });
  if (!signal.ok) return commandConflict(signal);

  const signalUow = deps.uow().underChangeSignal(ids.changeSignalId);
  const opened = await openRecoveryCase(signalUow, {
    ...identity,
    idempotencyKey: `change-request-admission:case:${input.idempotencyKey}`,
    caseId: ids.recoveryCaseId,
    openedAt: now,
  });
  if (!opened.ok) return commandConflict(opened);
  const linked = await attachCaseSubjects(signalUow, {
    ...identity,
    idempotencyKey: `change-request-admission:link:${input.idempotencyKey}`,
    caseId: ids.recoveryCaseId,
    subjects: [
      { kind: 'JOURNEY', id: input.journeyId, role: 'REQUEST_SCOPE' },
      { kind: 'TRAVELLER', id: travellerId, role: 'REPRESENTED_TRAVELLER' },
      { kind: 'CHANGE_REQUEST', id: ids.changeRequestId, role: 'REQUEST' },
    ],
    changeSignalIds: [ids.changeSignalId],
  });
  if (!linked.ok) return commandConflict(linked);
  const completed = await completeChangeSignal(deps.uow(), {
    ...identity,
    idempotencyKey: `change-request-admission:signal-complete:${input.idempotencyKey}`,
    changeSignalId: ids.changeSignalId,
    completedAt: now,
  });
  if (!completed.ok) return commandConflict(completed);

  try {
    const result = await deps.planner.planCase({
      recoveryCaseId: ids.recoveryCaseId,
      reason: 'OPERATOR_REQUEST',
      changeRequestId: accepted.id,
    });
    return {
      ok: true,
      value: {
        sourceRecordId: ids.sourceRecordId,
        changeRequestId: ids.changeRequestId,
        changeSignalId: ids.changeSignalId,
        recoveryCaseId: ids.recoveryCaseId,
        lifecycle: 'ACCEPTED_FOR_PLANNING',
        planning: { status: 'PLANNED', result },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: true,
      value: {
        sourceRecordId: ids.sourceRecordId,
        changeRequestId: ids.changeRequestId,
        changeSignalId: ids.changeSignalId,
        recoveryCaseId: ids.recoveryCaseId,
        lifecycle: 'ACCEPTED_FOR_PLANNING',
        planning: {
          status: 'RETRYABLE_FAILURE',
          error: { code: 'PLAN_PERSIST_FAILED', message, mutatesState: false },
        },
      },
    };
  }
}
