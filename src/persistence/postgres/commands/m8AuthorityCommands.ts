/**
 * NORTHSTAR M8 — PostgreSQL commands for recovery cases, action plans/intents,
 * authority decisions/approvals, budget-protected holds, and execution attempts.
 */
import { randomUUID } from 'node:crypto';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ExpectedRevision, TypedRef } from '../../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import type { ExactMoney } from '../../../domain/v2/shared/money.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  lockedRevisionOf,
  missingHeadConflict,
  registerChildSubject,
  staleRevisionConflict,
  type AdvancedRoot,
} from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { computeEnvelopeFingerprint, type EnvelopeFingerprintInput } from '../../../resolution/authority/envelope.ts';
import { admitBudgetHold } from '../../../resolution/budget/protect.ts';
import { computeRequestFingerprint, canTransitionExecutionStatus, type DurableExecutionStatus } from '../../../resolution/execution/stateMachine.ts';
import { evaluateConsequentialAuthorization } from '../../../resolution/authority/authorize.ts';
import type { AssessmentView } from '../world/pgAssessments.ts';
import type { AuthorityEnvelope, Approval, ApprovalRevocation, AuthorityDecision } from '../../../contracts/v2/authority/authorityEnvelope.ts';
import type { AuthorityGrant } from '../../../domain/v2/people/traveller.ts';

const SCHEMA_VERSION = '1';

export interface M8CommandIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

type BodyResult<R> =
  | { ok: true; value: R; advanced: AdvancedRoot[] }
  | { ok: false; conflict: TypedConflict };

interface SubmitSpec<R> {
  uow: UnitOfWork;
  identity: M8CommandIdentity;
  commandType: string;
  destinationKind: string;
  payload: unknown;
  expectedAggregateRevisions?: ExpectedRevision[];
  refs: TypedRef[];
  body: (ctx: { envelope: DomainCommandEnvelope; lockedHeads: { aggregateRef: TypedRef; revision: number }[] }) => Promise<BodyResult<R>>;
}

function ref(kind: TypedRef['kind'], id: string): TypedRef {
  return { kind, id };
}

function rootCreated(aggregateRef: TypedRef): AdvancedRoot {
  return { aggregateRef, beforeRevision: null, afterRevision: 1 };
}

async function submit<R>(spec: SubmitSpec<R>): Promise<ExecuteOutcome<R>> {
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: spec.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: spec.identity.workspaceId,
    actorPrincipalId: spec.identity.actorPrincipalId,
    idempotencyKey: spec.identity.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(spec.payload),
    expectedAggregateRevisions: spec.expectedAggregateRevisions ?? [],
    typedPayload: spec.payload,
    evidenceRefs: [],
  });
  const committedAt = new Date().toISOString();
  try {
    return await spec.uow.execute<R>(envelope, async ({ lockedHeads }) => {
      const outcome = await spec.body({ envelope, lockedHeads });
      if (!outcome.ok) return outcome;
      await appendAuditTrail({
        envelope,
        advanced: outcome.advanced,
        destinationKind: spec.destinationKind,
        payload: outcome.value,
      });
      return {
        ok: true,
        value: outcome.value,
        receipt: buildReceipt({ envelope, value: outcome.value, advanced: outcome.advanced, committedAt }),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, spec.refs) };
  }
}

export async function openRecoveryCase(
  uow: UnitOfWork,
  params: M8CommandIdentity & { caseId?: string; openedAt: string },
): Promise<ExecuteOutcome<{ caseId: string }>> {
  const caseId = params.caseId ?? randomUUID();
  const caseRef = ref('RECOVERY_CASE', caseId);
  return submit({
    uow, identity: params, commandType: 'RECOVERY_CASE_OPENED', destinationKind: 'RECOVERY_CASE',
    payload: { caseId, openedAt: params.openedAt }, refs: [caseRef],
    body: async () => {
      const client = currentTransactionClient();
      await createRoot({ workspaceId: params.workspaceId, id: caseId, kind: 'RECOVERY_CASE' });
      await client.query(
        `INSERT INTO recovery_cases (workspace_id, id, lifecycle_status, opened_at, created_by_actor_id)
         VALUES ($1, $2, 'OPEN', $3::timestamptz, $4)`,
        [params.workspaceId, caseId, params.openedAt, params.actorPrincipalId],
      );
      return { ok: true, value: { caseId }, advanced: [rootCreated(caseRef)] };
    },
  });
}

export async function createActionPlanWithIntent(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    planId?: string;
    intentId?: string;
    recoveryCaseId: string;
    scenarioChangeId: string;
    planVersion?: number;
    operationNamespace: string;
    capabilityRef: string;
    subjectRefs: TypedRef[];
    expectedObservations: string[];
    costEstimate?: ExactMoney;
    basisAssessmentId?: string;
  },
): Promise<ExecuteOutcome<{ planId: string; intentId: string }>> {
  const planId = params.planId ?? randomUUID();
  const intentId = params.intentId ?? randomUUID();
  const version = params.planVersion ?? 1;
  const planRef = ref('ACTION_PLAN', planId);
  return submit({
    uow, identity: params, commandType: 'ACTION_PLAN_CREATED', destinationKind: 'ACTION_PLAN',
    payload: { planId, intentId, recoveryCaseId: params.recoveryCaseId, version }, refs: [planRef],
    body: async () => {
      const client = currentTransactionClient();
      await createRoot({ workspaceId: params.workspaceId, id: planId, kind: 'ACTION_PLAN' });
      await client.query(
        `INSERT INTO action_plans (workspace_id, id, recovery_case_id, scenario_change_id, version, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [params.workspaceId, planId, params.recoveryCaseId, params.scenarioChangeId, version, params.actorPrincipalId],
      );
      await registerChildSubject({ workspaceId: params.workspaceId, id: intentId, kind: 'ACTION_INTENT', aggregateId: planId });
      await client.query(
        `INSERT INTO action_intents (
           workspace_id, id, action_plan_id, version, operation_namespace, capability_ref,
           subject_refs, expected_observations, cost_amount, cost_currency, status,
           basis_assessment_id, compensation_supported, created_by_actor_id
         ) VALUES ($1,$2,$3,1,$4,$5,$6::jsonb,$7::jsonb,$8,$9,'PROPOSED',$10,false,$11)`,
        [
          params.workspaceId, intentId, planId, params.operationNamespace, params.capabilityRef,
          JSON.stringify(params.subjectRefs), JSON.stringify(params.expectedObservations),
          params.costEstimate?.amount ?? null, params.costEstimate?.currency ?? null,
          params.basisAssessmentId ?? null, params.actorPrincipalId,
        ],
      );
      return { ok: true, value: { planId, intentId }, advanced: [rootCreated(planRef)] };
    },
  });
}

export async function prepareActionIntentDispatchIdentity(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    planId: string;
    intentId: string;
    expectedPlanRevision: number;
    logicalOperationKey: string;
    requestPayload: unknown;
  },
): Promise<ExecuteOutcome<{ requestFingerprint: string }>> {
  const requestFingerprint = computeRequestFingerprint(params.requestPayload);
  const planRef = ref('ACTION_PLAN', params.planId);
  return submit({
    uow, identity: params, commandType: 'ACTION_INTENT_DISPATCH_PREPARED', destinationKind: 'ACTION_INTENT',
    payload: { intentId: params.intentId, logicalOperationKey: params.logicalOperationKey, requestFingerprint },
    expectedAggregateRevisions: [{ aggregateRef: planRef, expectedRevision: params.expectedPlanRevision }],
    refs: [planRef],
    body: async ({ lockedHeads }) => {
      const client = currentTransactionClient();
      const before = lockedRevisionOf(lockedHeads, params.planId);
      if (before === undefined) return { ok: false, conflict: missingHeadConflict(planRef) };
      const after = await advanceHead({ workspaceId: params.workspaceId, aggregateId: params.planId, fromRevision: before });
      if (after === undefined) return { ok: false, conflict: staleRevisionConflict(planRef, before) };
      const existing = await client.query<{ logical_operation_key: string | null; request_fingerprint: string | null }>(
        'SELECT logical_operation_key, request_fingerprint FROM action_intents WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [params.workspaceId, params.intentId],
      );
      const row = existing.rows[0];
      if (!row) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'action intent missing', [planRef]) };
      if (row.logical_operation_key && row.logical_operation_key !== params.logicalOperationKey) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'logical operation key already bound differently', [planRef]) };
      }
      if (row.request_fingerprint && row.request_fingerprint !== requestFingerprint) {
        return { ok: false, conflict: typedConflict('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'same intent identity with different fingerprint', [planRef]) };
      }
      await client.query(
        `UPDATE action_intents
            SET logical_operation_key = $3, request_fingerprint = $4, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.intentId, params.logicalOperationKey, requestFingerprint],
      );
      return {
        ok: true,
        value: { requestFingerprint },
        advanced: [{ aggregateRef: planRef, beforeRevision: before, afterRevision: after }],
      };
    },
  });
}

export async function issueAuthorityDecision(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    decisionId?: string;
    envelopeInput: EnvelopeFingerprintInput;
    requirements: Array<{ id?: string; actorRole: string; requiredPartyRef?: TypedRef }>;
    groupOperator?: 'AND' | 'OR';
    issuedAt: string;
    expiresAt?: string;
  },
): Promise<ExecuteOutcome<{ decisionId: string; fingerprint: string; requirementIds: string[] }>> {
  const decisionId = params.decisionId ?? randomUUID();
  const fingerprint = computeEnvelopeFingerprint(params.envelopeInput);
  const requirementIds = params.requirements.map((r) => r.id ?? randomUUID());
  const decisionRef = ref('AUTHORITY_DECISION', decisionId);
  return submit({
    uow, identity: params, commandType: 'AUTHORITY_DECISION_ISSUED', destinationKind: 'AUTHORITY_DECISION',
    payload: { decisionId, fingerprint, envelopeInput: params.envelopeInput }, refs: [decisionRef],
    body: async () => {
      const client = currentTransactionClient();
      const input = params.envelopeInput;
      await createRoot({ workspaceId: params.workspaceId, id: decisionId, kind: 'AUTHORITY_DECISION' });
      await client.query(
        `INSERT INTO authority_decisions (
           workspace_id, id, action_plan_id, action_plan_version, action_intent_id, action_intent_version,
           group_operator, envelope_fingerprint, scope, limits, grant_refs, rule_inputs, issued_at, expires_at, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::timestamptz,$14::timestamptz,$15)`,
        [
          params.workspaceId, decisionId, input.actionPlanId, input.actionPlanVersion, input.actionIntentId, input.actionIntentVersion,
          params.groupOperator ?? 'AND', fingerprint, JSON.stringify(input.scope),
          input.limits ? JSON.stringify(input.limits) : null,
          JSON.stringify(input.grantRefs), JSON.stringify(input.ruleInputs),
          params.issuedAt, params.expiresAt ?? null, params.actorPrincipalId,
        ],
      );
      for (let i = 0; i < params.requirements.length; i++) {
        const req = params.requirements[i]!;
        await client.query(
          `INSERT INTO approval_requirements (workspace_id, id, decision_id, actor_role, required_party_kind, required_party_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            params.workspaceId, requirementIds[i]!, decisionId, req.actorRole,
            req.requiredPartyRef?.kind ?? null, req.requiredPartyRef?.id ?? null,
          ],
        );
      }
      return { ok: true, value: { decisionId, fingerprint, requirementIds }, advanced: [rootCreated(decisionRef)] };
    },
  });
}

export async function recordApproval(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    approvalId?: string;
    decisionId: string;
    requirementId: string;
    envelopeFingerprint: string;
    scope: TypedRef[];
    approvedAt: string;
    amountLimit?: ExactMoney;
  },
): Promise<ExecuteOutcome<{ approvalId: string }>> {
  const approvalId = params.approvalId ?? randomUUID();
  const decisionRef = ref('AUTHORITY_DECISION', params.decisionId);
  return submit({
    uow, identity: params, commandType: 'APPROVAL_RECORDED', destinationKind: 'APPROVAL',
    payload: { approvalId, decisionId: params.decisionId, requirementId: params.requirementId, envelopeFingerprint: params.envelopeFingerprint },
    refs: [decisionRef],
    body: async () => {
      const client = currentTransactionClient();
      await registerChildSubject({
        workspaceId: params.workspaceId, id: approvalId, kind: 'APPROVAL', aggregateId: params.decisionId,
      });
      await client.query(
        `INSERT INTO approvals (
           workspace_id, id, requirement_id, decision_id, approver_principal_id, envelope_fingerprint,
           scope, amount_limit_amount, amount_limit_currency, approved_at, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::timestamptz,$11)`,
        [
          params.workspaceId, approvalId, params.requirementId, params.decisionId, params.actorPrincipalId,
          params.envelopeFingerprint, JSON.stringify(params.scope),
          params.amountLimit?.amount ?? null, params.amountLimit?.currency ?? null,
          params.approvedAt, params.actorPrincipalId,
        ],
      );
      return { ok: true, value: { approvalId }, advanced: [] };
    },
  });
}

export async function revokeApproval(
  uow: UnitOfWork,
  params: M8CommandIdentity & { revocationId?: string; approvalId: string; revokedAt: string },
): Promise<ExecuteOutcome<{ revocationId: string }>> {
  const revocationId = params.revocationId ?? randomUUID();
  return submit({
    uow, identity: params, commandType: 'APPROVAL_REVOKED', destinationKind: 'APPROVAL',
    payload: { revocationId, approvalId: params.approvalId }, refs: [],
    body: async () => {
      const client = currentTransactionClient();
      await client.query(
        `INSERT INTO approval_revocations (workspace_id, id, approval_id, revoked_at, revoked_by_principal_id, created_by_actor_id)
         VALUES ($1,$2,$3,$4::timestamptz,$5::uuid,$6)`,
        [params.workspaceId, revocationId, params.approvalId, params.revokedAt, params.actorPrincipalId, params.actorPrincipalId],
      );
      return { ok: true, value: { revocationId }, advanced: [] };
    },
  });
}

export async function holdBudgetForIntent(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    budgetId: string;
    expectedBudgetRevision: number;
    actionIntentId: string;
    requested: ExactMoney;
    approvedCeiling?: ExactMoney;
    commitmentId?: string;
  },
): Promise<ExecuteOutcome<{ commitmentId: string; holdAmount: ExactMoney; budgetRevision: number }>> {
  const commitmentId = params.commitmentId ?? randomUUID();
  const budgetRef = ref('BUDGET', params.budgetId);
  return submit({
    uow, identity: params, commandType: 'BUDGET_HOLD_CREATED', destinationKind: 'BUDGET',
    payload: { budgetId: params.budgetId, actionIntentId: params.actionIntentId, requested: params.requested, commitmentId },
    expectedAggregateRevisions: [{ aggregateRef: budgetRef, expectedRevision: params.expectedBudgetRevision }],
    refs: [budgetRef],
    body: async ({ lockedHeads }) => {
      const client = currentTransactionClient();
      const budget = await client.query<{ amount: string; currency: string }>(
        'SELECT amount::text AS amount, currency FROM budgets WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [params.workspaceId, params.budgetId],
      );
      const b = budget.rows[0];
      if (!b) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'budget missing', [budgetRef]) };
      const commitments = await client.query<{ id: string; action_intent_id: string; amount: string; currency: string; status: 'HELD' | 'SETTLED' | 'RELEASED' }>(
        `SELECT id, action_intent_id, amount::text AS amount, currency, status
           FROM budget_commitments
          WHERE workspace_id = $1 AND budget_id = $2 AND status IN ('HELD', 'SETTLED')
          FOR UPDATE`,
        [params.workspaceId, params.budgetId],
      );
      const admission = admitBudgetHold({
        budget: { id: params.budgetId, amount: { amount: b.amount, currency: b.currency }, currency: b.currency },
        activeCommitments: commitments.rows.map((c) => ({
          id: c.id,
          actionIntentId: c.action_intent_id,
          amount: { amount: c.amount, currency: c.currency },
          status: c.status,
        })),
        actionIntentId: params.actionIntentId,
        requested: params.requested,
        ...(params.approvedCeiling ? { approvedCeiling: params.approvedCeiling } : {}),
      });
      if (!admission.ok) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `${admission.reason}:${admission.detail ?? ''}`, [budgetRef]) };
      }
      const before = lockedRevisionOf(lockedHeads, params.budgetId);
      if (before === undefined) return { ok: false, conflict: missingHeadConflict(budgetRef) };
      const after = await advanceHead({ workspaceId: params.workspaceId, aggregateId: params.budgetId, fromRevision: before });
      if (after === undefined) return { ok: false, conflict: staleRevisionConflict(budgetRef, before) };
      await client.query(
        `INSERT INTO budget_commitments
           (workspace_id, id, budget_id, action_intent_id, amount, currency, status, created_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,'HELD',$7)`,
        [params.workspaceId, commitmentId, params.budgetId, params.actionIntentId, admission.holdAmount.amount, admission.holdAmount.currency, params.actorPrincipalId],
      );
      await client.query(
        `INSERT INTO budget_entries
           (workspace_id, id, commitment_id, entry_kind, amount, currency, created_by_actor_id)
         VALUES ($1,$2,$3,'HOLD',$4,$5,$6)`,
        [params.workspaceId, randomUUID(), commitmentId, admission.holdAmount.amount, admission.holdAmount.currency, params.actorPrincipalId],
      );
      return {
        ok: true,
        value: { commitmentId, holdAmount: admission.holdAmount, budgetRevision: after },
        advanced: [{ aggregateRef: budgetRef, beforeRevision: before, afterRevision: after }],
      };
    },
  });
}

export async function createPreparedExecutionAttempt(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    attemptId?: string;
    planId: string;
    intentId: string;
    attemptNumber: number;
    logicalOperationKey: string;
    requestFingerprint: string;
    providerOperationKey?: string;
  },
): Promise<ExecuteOutcome<{ attemptId: string }>> {
  const attemptId = params.attemptId ?? randomUUID();
  const planRef = ref('ACTION_PLAN', params.planId);
  return submit({
    uow, identity: params, commandType: 'EXECUTION_ATTEMPT_PREPARED', destinationKind: 'EXECUTION_ATTEMPT',
    payload: {
      attemptId, intentId: params.intentId, attemptNumber: params.attemptNumber,
      logicalOperationKey: params.logicalOperationKey, requestFingerprint: params.requestFingerprint,
    },
    refs: [planRef],
    body: async () => {
      const client = currentTransactionClient();
      const prior = await client.query<{ request_fingerprint: string; status: string; id: string }>(
        `SELECT id, request_fingerprint, status FROM execution_attempts
          WHERE workspace_id = $1 AND logical_operation_key = $2`,
        [params.workspaceId, params.logicalOperationKey],
      );
      const conflict = prior.rows.find((r) => r.request_fingerprint !== params.requestFingerprint);
      if (conflict) {
        return { ok: false, conflict: typedConflict('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', `attempt ${conflict.id}`, [planRef]) };
      }
      const unresolved = prior.rows.find((r) =>
        ['CLAIMED', 'DISPATCHING', 'DISPATCHED', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(r.status),
      );
      if (unresolved) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `reconcile attempt ${unresolved.id} before new dispatch`, [planRef]) };
      }
      await registerChildSubject({
        workspaceId: params.workspaceId, id: attemptId, kind: 'EXECUTION_ATTEMPT', aggregateId: params.planId,
      });
      await client.query(
        `INSERT INTO execution_attempts (
           workspace_id, id, action_intent_id, attempt_number, logical_operation_key, request_fingerprint,
           status, provider_operation_key, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'PREPARED',$7,$8)`,
        [
          params.workspaceId, attemptId, params.intentId, params.attemptNumber,
          params.logicalOperationKey, params.requestFingerprint,
          params.providerOperationKey ?? null, params.actorPrincipalId,
        ],
      );
      await client.query(
        `UPDATE action_intents SET status = 'EXECUTING', updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.intentId],
      );
      return { ok: true, value: { attemptId }, advanced: [] };
    },
  });
}

export type DispatchAuthorizationInput = {
  assessmentView: AssessmentView;
  envelopeInput: EnvelopeFingerprintInput;
  envelope: AuthorityEnvelope;
  decision: AuthorityDecision;
  approvals: Approval[];
  revocations: ApprovalRevocation[];
  grants: AuthorityGrant[];
  requiredActionKind: string;
  principalId: string;
  now: string;
  requestedAmount?: ExactMoney;
};

export function authorizeDispatch(input: DispatchAuthorizationInput) {
  return evaluateConsequentialAuthorization(input);
}

export async function transitionExecutionAttempt(
  poolClient: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> },
  params: {
    workspaceId: string;
    attemptId: string;
    from: DurableExecutionStatus;
    to: DurableExecutionStatus;
    claimToken?: string;
    fencingToken?: number;
    requestRef?: string;
    responseRef?: string;
    lastError?: string;
  },
): Promise<'APPLIED' | 'FENCED' | 'ILLEGAL'> {
  if (!canTransitionExecutionStatus(params.from, params.to)) return 'ILLEGAL';
  const result = await poolClient.query(
    `UPDATE execution_attempts
        SET status = $4, request_ref = COALESCE($5, request_ref), response_ref = COALESCE($6, response_ref),
            last_error = COALESCE($7, last_error), updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND status = $3
        AND ($8::text IS NULL OR (claim_token = $8 AND fencing_token = $9))`,
    [
      params.workspaceId, params.attemptId, params.from, params.to,
      params.requestRef ?? null, params.responseRef ?? null, params.lastError ?? null,
      params.claimToken ?? null, params.fencingToken ?? null,
    ],
  );
  return (result.rowCount ?? 0) > 0 ? 'APPLIED' : 'FENCED';
}
