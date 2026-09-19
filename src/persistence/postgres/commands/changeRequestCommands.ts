import { z } from 'zod';
import {
  SubmitChangeRequestPayloadSchema,
  targetLinksForDesiredChange,
  type ChangeRequestRecord,
} from '../../../contracts/v2/change/changeRequest.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { ChangeRequestLifecycleSchema, CHANGE_REQUEST_TRANSITIONS, type ChangeRequestLifecycle } from '../../../domain/v2/change/changeRequest.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { advanceHead, appendAuditTrail, buildReceipt, createRoot, staleRevisionConflict, type AdvancedRoot, type Queryable } from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgChangeRequestRepository } from '../repositories/pgChangeRequestRepository.ts';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';

const SCHEMA_VERSION = '1';
const Uuid = z.string().uuid();
const REQUEST_ACTION = 'change.request.submit';

export interface ChangeRequestCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

/** Internal clock injection keeps authorization time out of the request payload. */
export interface ChangeRequestCommandOptions {
  authorizationNow?: () => string;
}

function trustedAuthorizationNow(options: ChangeRequestCommandOptions): string {
  return InstantSchema.parse(options.authorizationNow?.() ?? new Date().toISOString());
}

export interface SubmitChangeRequestParams extends ChangeRequestCommandContext {
  changeRequestId: string;
  representedTravellerId: string;
  journeyId: string;
  sourceRecordId: string;
  sourceUtterance: string;
  submittedAt: string;
  intentKind: z.input<typeof SubmitChangeRequestPayloadSchema>['intentKind'];
  urgency: z.input<typeof SubmitChangeRequestPayloadSchema>['urgency'];
  desiredTarget: z.input<typeof SubmitChangeRequestPayloadSchema>['desiredTarget'];
  fundingDeclaration?: z.input<typeof SubmitChangeRequestPayloadSchema>['fundingDeclaration'];
}

export interface SubmitChangeRequestResult {
  changeRequestId: string;
  lifecycle: 'SUBMITTED';
  revision: 1;
}

export interface TransitionChangeRequestParams extends ChangeRequestCommandContext {
  changeRequestId: string;
  expectedRevision: number;
  from: ChangeRequestLifecycle;
  to: ChangeRequestLifecycle;
  transitionedAt: string;
}

export interface TransitionChangeRequestResult {
  changeRequestId: string;
  lifecycle: ChangeRequestLifecycle;
  revision: number;
}

function authorityDenied(message: string, refs: TypedRef[]): TypedConflict {
  return typedConflict('AUTHORITY_DENIED', message, refs);
}

/** A request grant is intentionally distinct from action authorization. */
async function assertCurrentRequestAuthority(
  db: Queryable,
  args: { workspaceId: string; actorPrincipalId: string; travellerId: string; journeyId: string; at: string },
): Promise<TypedConflict | undefined> {
  const principal = await db.query<{ status: string }>(
    'SELECT status FROM principals WHERE workspace_id = $1 AND id = $2',
    [args.workspaceId, args.actorPrincipalId],
  );
  if (principal.rows[0]?.status !== 'ACTIVE') {
    return authorityDenied(`requester principal ${args.actorPrincipalId} is not ACTIVE`, [{ kind: 'PRINCIPAL', id: args.actorPrincipalId }]);
  }
  const grant = await db.query<{ id: string }>(
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
    [args.workspaceId, args.actorPrincipalId, args.travellerId, args.journeyId, args.at, REQUEST_ACTION],
  );
  if (!grant.rows[0]) {
    return authorityDenied(
      `principal ${args.actorPrincipalId} lacks a current ${REQUEST_ACTION} grant representing traveller ${args.travellerId} over journey ${args.journeyId}`,
      [{ kind: 'PRINCIPAL', id: args.actorPrincipalId }, { kind: 'TRAVELLER', id: args.travellerId }, { kind: 'JOURNEY', id: args.journeyId }],
    );
  }
  return undefined;
}

async function assertJourneyScope(
  db: Queryable,
  workspaceId: string,
  travellerId: string,
  journeyId: string,
): Promise<TypedConflict | undefined> {
  const journey = await db.query<{ traveller_id: string }>(
    'SELECT traveller_id FROM journeys WHERE workspace_id = $1 AND id = $2', [workspaceId, journeyId],
  );
  if (!journey.rows[0]) return typedConflict('VALIDATION_FAILED', `journey ${journeyId} does not exist`, [{ kind: 'JOURNEY', id: journeyId }]);
  if (journey.rows[0].traveller_id !== travellerId) {
    return typedConflict('VALIDATION_FAILED', `journey ${journeyId} is not the named traveller's journey`, [{ kind: 'JOURNEY', id: journeyId }, { kind: 'TRAVELLER', id: travellerId }]);
  }
  return undefined;
}

async function assertSourceAndTargets(
  db: Queryable,
  args: { workspaceId: string; sourceRecordId: string; target: z.output<typeof SubmitChangeRequestPayloadSchema>['desiredTarget'] },
): Promise<TypedConflict | undefined> {
  const source = await db.query<{ id: string }>('SELECT id FROM source_records WHERE workspace_id = $1 AND id = $2', [args.workspaceId, args.sourceRecordId]);
  if (!source.rows[0]) return typedConflict('VALIDATION_FAILED', `source record ${args.sourceRecordId} does not exist`, []);
  for (const target of targetLinksForDesiredChange(args.target)) {
    const found = await db.query<{ id: string }>(
      'SELECT id FROM domain_subjects WHERE workspace_id = $1 AND id = $2 AND kind = $3',
      [args.workspaceId, target.targetRef.id, target.targetRef.kind],
    );
    if (!found.rows[0]) {
      return typedConflict('VALIDATION_FAILED', `target ${target.targetRef.kind}:${target.targetRef.id} does not exist with its required kind`, [target.targetRef]);
    }
  }
  return undefined;
}

function submissionEnvelope(context: ChangeRequestCommandContext, payload: z.output<typeof SubmitChangeRequestPayloadSchema>): DomainCommandEnvelope {
  return DomainCommandEnvelopeSchema.parse({
    commandType: 'CHANGE_REQUEST_SUBMITTED', schemaVersion: SCHEMA_VERSION,
    workspaceId: context.workspaceId, actorPrincipalId: context.actorPrincipalId,
    representedPartyId: payload.representedTravellerId, idempotencyKey: context.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload), typedPayload: payload, evidenceRefs: [],
  });
}

/** Persists desired state only; this command deliberately does not plan or mutate travel/provider state. */
export async function submitChangeRequest(
  uow: UnitOfWork,
  params: SubmitChangeRequestParams,
  options: ChangeRequestCommandOptions = {},
): Promise<ExecuteOutcome<SubmitChangeRequestResult>> {
  const parsed = SubmitChangeRequestPayloadSchema.safeParse({
    changeRequestId: params.changeRequestId,
    representedTravellerId: params.representedTravellerId,
    journeyId: params.journeyId,
    sourceRecordId: params.sourceRecordId,
    sourceUtterance: params.sourceUtterance,
    submittedAt: params.submittedAt,
    intentKind: params.intentKind,
    urgency: params.urgency,
    desiredTarget: params.desiredTarget,
    fundingDeclaration: params.fundingDeclaration,
  });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const requestRef: TypedRef = { kind: 'CHANGE_REQUEST', id: input.changeRequestId };
  const envelope = submissionEnvelope(params, input);
  try {
    const authorizationAt = trustedAuthorizationNow(options);
    return await uow.execute(envelope, async () => {
      const db = currentTransactionClient();
      const scopeDenied = await assertJourneyScope(db, params.workspaceId, input.representedTravellerId, input.journeyId);
      if (scopeDenied) return { ok: false, conflict: scopeDenied };
      const authorityDeniedResult = await assertCurrentRequestAuthority(db, {
        workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId,
        travellerId: input.representedTravellerId, journeyId: input.journeyId, at: authorizationAt,
      });
      if (authorityDeniedResult) return { ok: false, conflict: authorityDeniedResult };
      const sourceDenied = await assertSourceAndTargets(db, { workspaceId: params.workspaceId, sourceRecordId: input.sourceRecordId, target: input.desiredTarget });
      if (sourceDenied) return { ok: false, conflict: sourceDenied };

      await createRoot({ workspaceId: params.workspaceId, id: input.changeRequestId, kind: 'CHANGE_REQUEST' });
      await db.query(
        `INSERT INTO change_requests (workspace_id, id, requester_principal_id, represented_traveller_id, journey_id, lifecycle_status, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, 'SUBMITTED', $6)`,
        [params.workspaceId, input.changeRequestId, params.actorPrincipalId, input.representedTravellerId, input.journeyId, params.actorPrincipalId],
      );
      await db.query(
        `INSERT INTO change_request_revisions
           (workspace_id, change_request_id, revision, intent_kind, urgency, desired_target, funding_declaration, source_utterance, source_record_id, submitted_at, created_by_actor_id)
         VALUES ($1, $2, 1, $3, $4, $5::jsonb, $6, $7, $8, $9::timestamptz, $10)`,
        [params.workspaceId, input.changeRequestId, input.intentKind, input.urgency, JSON.stringify(input.desiredTarget), input.fundingDeclaration ?? null,
          input.sourceUtterance, input.sourceRecordId, input.submittedAt, params.actorPrincipalId],
      );
      for (const target of targetLinksForDesiredChange(input.desiredTarget)) {
        await db.query(
          `INSERT INTO change_request_targets (workspace_id, change_request_id, request_revision, target_role, target_kind, target_id)
           VALUES ($1, $2, 1, $3, $4, $5)`,
          [params.workspaceId, input.changeRequestId, target.role, target.targetRef.kind, target.targetRef.id],
        );
      }
      const value: SubmitChangeRequestResult = { changeRequestId: input.changeRequestId, lifecycle: 'SUBMITTED', revision: 1 };
      const advanced: AdvancedRoot[] = [{ aggregateRef: requestRef, beforeRevision: null, afterRevision: 1 }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'CHANGE_REQUEST', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced, committedAt: input.submittedAt }) };
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict(code === '23505' ? 'DUPLICATE_REGISTRATION' : 'VALIDATION_FAILED', message, [requestRef]) };
  }
}

const transitionInput = z.strictObject({
  changeRequestId: Uuid,
  expectedRevision: z.number().int().min(1),
  from: ChangeRequestLifecycleSchema,
  to: ChangeRequestLifecycleSchema,
  transitionedAt: InstantSchema,
});

/** Lifecycle handling is an explicit CAS and remains request-only. */
export async function transitionChangeRequest(
  uow: UnitOfWork,
  params: TransitionChangeRequestParams,
  options: ChangeRequestCommandOptions = {},
): Promise<ExecuteOutcome<TransitionChangeRequestResult>> {
  const parsed = transitionInput.safeParse({
    changeRequestId: params.changeRequestId,
    expectedRevision: params.expectedRevision,
    from: params.from,
    to: params.to,
    transitionedAt: params.transitionedAt,
  });
  if (!parsed.success) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', parsed.error.message, []) };
  const input = parsed.data;
  const requestRef: TypedRef = { kind: 'CHANGE_REQUEST', id: input.changeRequestId };
  if (!CHANGE_REQUEST_TRANSITIONS[input.from].includes(input.to)) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `change request transition ${input.from} -> ${input.to} is not permitted`, [requestRef]) };
  }
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'CHANGE_REQUEST_LIFECYCLE_CHANGED', schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId, idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(input), expectedAggregateRevisions: [{ aggregateRef: requestRef, expectedRevision: input.expectedRevision }],
    typedPayload: input, evidenceRefs: [],
  });
  try {
    const authorizationAt = trustedAuthorizationNow(options);
    return await uow.execute(envelope, async ({ lockedHeads }) => {
      const db = currentTransactionClient();
      const request = await new PgChangeRequestRepository(db).loadChangeRequest(params.workspaceId, input.changeRequestId);
      if (!request) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `change request ${input.changeRequestId} does not exist`, [requestRef]) };
      const authorityDeniedResult = await assertCurrentRequestAuthority(db, {
        workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId,
        travellerId: request.representedTravellerId, journeyId: request.journeyId, at: authorizationAt,
      });
      if (authorityDeniedResult) return { ok: false, conflict: authorityDeniedResult };
      if (request.lifecycle !== input.from) {
        return { ok: false, conflict: typedConflict('STALE_AGGREGATE_REVISION', `change request ${input.changeRequestId} is ${request.lifecycle}, expected ${input.from}`, [requestRef]) };
      }
      const nextRevision = await advanceHead({ workspaceId: params.workspaceId, aggregateId: input.changeRequestId, fromRevision: input.expectedRevision });
      if (!nextRevision) return { ok: false, conflict: staleRevisionConflict(requestRef, input.expectedRevision) };
      await db.query(
        `UPDATE change_requests SET lifecycle_status = $3, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND lifecycle_status = $4`,
        [params.workspaceId, input.changeRequestId, input.to, input.from],
      );
      const value: TransitionChangeRequestResult = { changeRequestId: input.changeRequestId, lifecycle: input.to, revision: nextRevision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: requestRef, beforeRevision: input.expectedRevision, afterRevision: nextRevision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'CHANGE_REQUEST', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced, committedAt: input.transitionedAt }) };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, [requestRef]) };
  }
}

/** Clean read function for consumers that need the submitted desire without planning it. */
export async function loadChangeRequest(db: Queryable, workspaceId: string, changeRequestId: string): Promise<ChangeRequestRecord | undefined> {
  return new PgChangeRequestRepository(db).loadChangeRequest(workspaceId, changeRequestId);
}
