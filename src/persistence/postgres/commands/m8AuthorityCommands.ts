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
import { canTransitionExecutionStatus, type DurableExecutionStatus } from '../../../resolution/execution/stateMachine.ts';
import { evaluateApproverAuthority, evaluateConsequentialAuthorization, scopeCoversRequired } from '../../../resolution/authority/authorize.ts';
import type { AssessmentView } from '../world/pgAssessments.ts';
import type { AuthorityEnvelope, Approval, ApprovalRevocation, AuthorityDecision } from '../../../contracts/v2/authority/authorityEnvelope.ts';
import type { AuthorityGrant } from '../../../domain/v2/people/traveller.ts';
import { ActionPlanSchema, validateActionPlanAcyclic, type ActionPlan } from '../../../contracts/v2/action/actionPlan.ts';
import {
  evaluateStoredExecutionGate,
  findBlockingAttempt,
  findKnownSuccessAttempt,
  loadRequiredAuthorityScope,
} from '../execution/storedExecutionGate.ts';
import type { Pool } from '../pool.ts';

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

/**
 * Persists a fully compiled M7 `ActionPlan` (src/resolution/planning/compiler.ts
 * output) verbatim — every ActionIntent field (status, compensationPolicy,
 * logicalOperationKey, requestFingerprint, ...) comes from the compiler, not
 * from this command. M8 does not mint a second ActionIntent representation;
 * this is the persistence adapter for the one frozen model
 * (src/contracts/v2/action/actionPlan.ts). See
 * docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md §4.
 */
export async function persistActionPlan(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    plan: ActionPlan;
    recoveryStrategyId?: string;
    planVersion?: number;
  },
): Promise<ExecuteOutcome<{ planId: string; intentIds: string[] }>> {
  let plan: ActionPlan;
  try {
    plan = ActionPlanSchema.parse(params.plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, []) };
  }
  const acyclic = validateActionPlanAcyclic(plan);
  if (!acyclic.ok) return acyclic;
  const planVersion = params.planVersion ?? 1;
  const planRef = ref('ACTION_PLAN', plan.id);
  const intentIds = plan.intents.map((i) => i.id);
  return submit({
    uow, identity: params, commandType: 'ACTION_PLAN_CREATED', destinationKind: 'ACTION_PLAN',
    payload: { planId: plan.id, intentIds, recoveryCaseId: plan.recoveryCaseId, planVersion }, refs: [planRef],
    body: async () => {
      const client = currentTransactionClient();
      await createRoot({ workspaceId: params.workspaceId, id: plan.id, kind: 'ACTION_PLAN' });
      await client.query(
        `INSERT INTO action_plans (workspace_id, id, recovery_case_id, scenario_change_id, recovery_strategy_id, plan_version, created_by_actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          params.workspaceId, plan.id, plan.recoveryCaseId, plan.scenarioChangeId,
          params.recoveryStrategyId ?? null, planVersion, params.actorPrincipalId,
        ],
      );
      for (const intent of plan.intents) {
        await registerChildSubject({ workspaceId: params.workspaceId, id: intent.id, kind: 'ACTION_INTENT', aggregateId: plan.id });
        await client.query(
          `INSERT INTO action_intents (
             workspace_id, id, action_plan_id, operation_namespace, logical_operation_key, request_fingerprint,
             source_effect_index, source_effect_fingerprint,
             capability_ref, subject_refs, expected_revisions, preconditions, offer_fingerprint,
             cost_amount, cost_currency, limits, required_authority_scopes, expected_observations,
             compensation_supported, compensation_requires_separate_authority, compensation_description,
             status, created_by_actor_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23)`,
          [
            params.workspaceId, intent.id, plan.id, intent.operationNamespace,
            intent.logicalOperationKey ?? null, intent.requestFingerprint ?? null,
            intent.sourceEffectIndex ?? null, intent.sourceEffectFingerprint ?? null,
            intent.capabilityRef, JSON.stringify(intent.subjectRefs), JSON.stringify(intent.expectedRevisions),
            JSON.stringify(intent.preconditions), intent.offerFingerprint ?? null,
            intent.costEstimate?.amount ?? null, intent.costEstimate?.currency ?? null,
            intent.limits ? JSON.stringify(intent.limits) : null,
            JSON.stringify(intent.requiredAuthorityScopes), JSON.stringify(intent.expectedObservations),
            intent.compensationPolicy.supported, intent.compensationPolicy.requiresSeparateAuthority,
            intent.compensationPolicy.description ?? null, intent.status, params.actorPrincipalId,
          ],
        );
      }
      for (const dep of plan.dependencies) {
        await client.query(
          `INSERT INTO action_dependencies (workspace_id, action_plan_id, from_action_intent_id, to_action_intent_id)
           VALUES ($1,$2,$3,$4)`,
          [params.workspaceId, plan.id, dep.fromActionIntentId, dep.toActionIntentId],
        );
      }
      return { ok: true, value: { planId: plan.id, intentIds }, advanced: [rootCreated(planRef)] };
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
      const required = await loadRequiredAuthorityScope(client, params.workspaceId, input.actionIntentId);
      if ('allowed' in required && required.allowed === false) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `${required.reason}${required.detail ? `: ${required.detail}` : ''}`, [decisionRef]),
        };
      }
      if (!scopeCoversRequired(input.scope, required as TypedRef[])) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            'DECISION_SCOPE_INSUFFICIENT: decision scope does not cover required authority subjects',
            [decisionRef],
          ),
        };
      }
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
      const requirement = await client.query<{
        actor_role: string;
        required_party_kind: string | null;
        required_party_id: string | null;
      }>(
        `SELECT actor_role, required_party_kind, required_party_id
           FROM approval_requirements
          WHERE workspace_id = $1 AND decision_id = $2 AND id = $3`,
        [params.workspaceId, params.decisionId, params.requirementId],
      );
      const req = requirement.rows[0];
      if (!req) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', 'approval requirement missing', [decisionRef]),
        };
      }
      const decisionRow = await client.query<{ scope: unknown; action_intent_id: string }>(
        `SELECT scope, action_intent_id FROM authority_decisions WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.decisionId],
      );
      const envelopeScopes = Array.isArray(decisionRow.rows[0]?.scope)
        ? decisionRow.rows[0]!.scope as TypedRef[]
        : [];
      const intentId = decisionRow.rows[0]?.action_intent_id;
      if (!intentId) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', 'authority decision missing action intent', [decisionRef]),
        };
      }
      const required = await loadRequiredAuthorityScope(client, params.workspaceId, intentId);
      if ('allowed' in required && required.allowed === false) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `${required.reason}${required.detail ? `: ${required.detail}` : ''}`, [decisionRef]),
        };
      }
      const requiredAuthorityScopes = required as TypedRef[];
      if (!scopeCoversRequired(envelopeScopes, requiredAuthorityScopes)) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', 'DECISION_SCOPE_INSUFFICIENT: decision scope does not cover required authority subjects', [decisionRef]),
        };
      }
      const grantRows = await client.query<{
        id: string;
        principal_id: string;
        represented_party_kind: string;
        represented_party_id: string;
        issued_by_principal_id: string;
        issued_at: Date;
        expires_at: Date | null;
        revoked_at: Date | null;
        action_kinds: string[] | null;
        scope_refs: { kind: TypedRef['kind']; id: string }[] | null;
      }>(
        `SELECT g.id, g.principal_id, g.represented_party_kind, g.represented_party_id,
                g.issued_by_principal_id, g.issued_at, g.expires_at, g.revoked_at,
                (SELECT COALESCE(array_agg(a.action_kind ORDER BY a.action_kind), '{}')
                   FROM grant_actions a WHERE a.workspace_id = g.workspace_id AND a.grant_id = g.id) AS action_kinds,
                (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.scope_kind, 'id', s.scope_id)
                                           ORDER BY s.scope_kind, s.scope_id), '[]'::jsonb)
                   FROM grant_scopes s WHERE s.workspace_id = g.workspace_id AND s.grant_id = g.id) AS scope_refs
           FROM authority_grants g
          WHERE g.workspace_id = $1 AND g.principal_id = $2`,
        [params.workspaceId, params.actorPrincipalId],
      );
      const grants = grantRows.rows.map((row) => ({
        id: row.id,
        principalId: row.principal_id,
        representedPartyRef: { kind: row.represented_party_kind as TypedRef['kind'], id: row.represented_party_id },
        issuedByPrincipalId: row.issued_by_principal_id,
        issuedAt: row.issued_at.toISOString(),
        ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
        ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
        actions: row.action_kinds ?? [],
        scopes: (row.scope_refs ?? []).map((s) => ({ kind: s.kind, id: s.id })),
      }));
      const denied = evaluateApproverAuthority({
        approval: {
          id: approvalId,
          requirementId: params.requirementId,
          approverPrincipalId: params.actorPrincipalId,
          envelopeFingerprint: params.envelopeFingerprint,
          scope: params.scope,
          approvedAt: params.approvedAt,
        },
        requirement: {
          id: params.requirementId,
          actorRole: req.actor_role,
          ...(req.required_party_kind && req.required_party_id
            ? { requiredPartyRef: { kind: req.required_party_kind as TypedRef['kind'], id: req.required_party_id } }
            : {}),
        },
        requiredAuthorityScopes,
        grants,
        now: params.approvedAt,
      });
      if (denied && !denied.allowed) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `${denied.reason}${denied.detail ? `: ${denied.detail}` : ''}`, [decisionRef]),
        };
      }
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
    /** Ignored when intent has stored cost — authoritative amount comes from action_intents. */
    requested?: ExactMoney;
    approvedCeiling?: ExactMoney;
    commitmentId?: string;
  },
): Promise<ExecuteOutcome<{ commitmentId: string; holdAmount: ExactMoney; budgetRevision: number }>> {
  const commitmentId = params.commitmentId ?? randomUUID();
  const budgetRef = ref('BUDGET', params.budgetId);
  const intentRef = ref('ACTION_INTENT', params.actionIntentId);
  return submit({
    uow, identity: params, commandType: 'BUDGET_HOLD_CREATED', destinationKind: 'BUDGET',
    payload: { budgetId: params.budgetId, actionIntentId: params.actionIntentId, commitmentId },
    expectedAggregateRevisions: [{ aggregateRef: budgetRef, expectedRevision: params.expectedBudgetRevision }],
    refs: [budgetRef, intentRef],
    body: async ({ lockedHeads }) => {
      const client = currentTransactionClient();
      const intentCost = await client.query<{ cost_amount: string | null; cost_currency: string | null }>(
        `SELECT cost_amount::text AS cost_amount, cost_currency
           FROM action_intents WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.actionIntentId],
      );
      const costRow = intentCost.rows[0];
      if (!costRow) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'action intent missing', [intentRef]) };
      }
      const requested: ExactMoney | undefined = costRow.cost_amount && costRow.cost_currency
        ? { amount: costRow.cost_amount, currency: costRow.cost_currency }
        : params.requested;
      if (!requested) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'uncosted intent has no hold amount', [intentRef]) };
      }
      if (params.requested && costRow.cost_amount && costRow.cost_currency) {
        if (params.requested.currency !== costRow.cost_currency
          || params.requested.amount !== costRow.cost_amount) {
          return {
            ok: false,
            conflict: typedConflict('VALIDATION_FAILED', 'requested hold must match stored intent cost', [intentRef]),
          };
        }
      }
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
        requested,
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

/**
 * Dispatch identity (logicalOperationKey/requestFingerprint) is never taken
 * from the caller — it is read from the already-compiled, immutable
 * ActionIntent row (see persistActionPlan above; M7's compiler sets both at
 * plan-compile time). This also means action_intents is never UPDATEd here:
 * `action_intents.status` is a write-once planning disposition, and the real
 * execution truth is execution_attempts.status (ExecutionAttemptStatus).
 * See docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md §4.
 */
export async function createPreparedExecutionAttempt(
  uow: UnitOfWork,
  params: M8CommandIdentity & {
    attemptId?: string;
    planId: string;
    intentId: string;
    attemptNumber: number;
    providerOperationKey?: string;
    principalId: string;
    now: string;
  },
): Promise<ExecuteOutcome<{ attemptId: string; replayed?: boolean; knownSuccess?: boolean; authorityDecisionId?: string }>> {
  const attemptId = params.attemptId ?? randomUUID();
  const planRef = ref('ACTION_PLAN', params.planId);
  const intentRef = ref('ACTION_INTENT', params.intentId);
  return submit({
    uow, identity: params, commandType: 'EXECUTION_ATTEMPT_PREPARED', destinationKind: 'EXECUTION_ATTEMPT',
    payload: { attemptId, intentId: params.intentId, attemptNumber: params.attemptNumber },
    refs: [planRef, intentRef],
    body: async (): Promise<BodyResult<{ attemptId: string; replayed?: boolean; knownSuccess?: boolean }>> => {
      const client = currentTransactionClient();
      const pool = client as unknown as Pool;
      // Known-success replay must short-circuit before the currentness gate:
      // a prior OBSERVED_SUCCESS may itself have advanced aggregates the
      // strategy base manifest still names. Replaying that identity is not a
      // new consequential dispatch.
      const storedIntent = await pool.query<{
        logical_operation_key: string | null; request_fingerprint: string | null;
      }>(
        `SELECT logical_operation_key, request_fingerprint FROM action_intents
          WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.intentId],
      );
      const intentKeys = storedIntent.rows[0];
      if (intentKeys?.logical_operation_key && intentKeys.request_fingerprint) {
        const knownSuccessEarly = await findKnownSuccessAttempt(
          client, params.workspaceId, intentKeys.logical_operation_key, intentKeys.request_fingerprint,
        );
        if (knownSuccessEarly) {
          return {
            ok: true,
            value: { attemptId: knownSuccessEarly.id, replayed: true, knownSuccess: true },
            advanced: [],
          };
        }
      }

      const gate = await evaluateStoredExecutionGate(pool, {
        workspaceId: params.workspaceId,
        intentId: params.intentId,
        principalId: params.principalId,
        now: params.now,
      });
      if (!gate.allowed) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `${gate.reason}${gate.detail ? `: ${gate.detail}` : ''}`, [planRef]),
        };
      }
      const logicalOperationKey = gate.intent.logicalOperationKey;
      const requestFingerprint = gate.intent.requestFingerprint;

      const knownSuccess = await findKnownSuccessAttempt(client, params.workspaceId, logicalOperationKey, requestFingerprint);
      if (knownSuccess) {
        return { ok: true, value: { attemptId: knownSuccess.id, replayed: true, knownSuccess: true }, advanced: [] };
      }

      const blocking = await findBlockingAttempt(client, params.workspaceId, logicalOperationKey, requestFingerprint);
      if (blocking && blocking.request_fingerprint !== requestFingerprint) {
        return {
          ok: false,
          conflict: typedConflict('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', `attempt ${blocking.id}`, [planRef]),
        };
      }
      if (blocking && blocking.request_fingerprint === requestFingerprint) {
        if (['PREPARED', 'CLAIMED', 'DISPATCHING', 'DISPATCHED', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(blocking.status)) {
          return {
            ok: false,
            conflict: typedConflict('VALIDATION_FAILED', `reconcile attempt ${blocking.id} before new dispatch`, [planRef]),
          };
        }
        return { ok: true, value: { attemptId: blocking.id, replayed: true, knownSuccess: true }, advanced: [] };
      }

      // M7's ActionPlan DAG (action_dependencies) is honored here: a downstream
      // intent may not prepare a dispatch attempt until every intent it depends
      // on has a terminal-success execution_attempts row. A failed prerequisite
      // permanently blocks the dependant (never silently skipped); an
      // in-progress/not-yet-attempted prerequisite blocks until it resolves.
      const deps = await client.query<{ from_action_intent_id: string; satisfied: boolean; failed: boolean }>(
        `SELECT d.from_action_intent_id,
                bool_or(
                  ea.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
                  AND (
                    -- Existing internal commands have their canonical receipt
                    -- observation path. Externally owned actions require the
                    -- A4 immutable observation→canonical-application bridge.
                    EXISTS (
                      SELECT 1 FROM action_intents prerequisite_intent
                       WHERE prerequisite_intent.workspace_id = d.workspace_id
                         AND prerequisite_intent.id = d.from_action_intent_id
                         AND prerequisite_intent.capability_ref NOT LIKE 'external:%'
                    )
                    OR EXISTS (
                      SELECT 1 FROM selected_plan_canonical_applications application
                      JOIN command_receipts canonical_receipt
                        ON canonical_receipt.workspace_id = application.workspace_id
                       AND canonical_receipt.command_namespace = application.command_namespace
                       AND canonical_receipt.idempotency_key = application.idempotency_key
                       WHERE application.workspace_id = d.workspace_id AND application.attempt_id = ea.id
                    )
                  )
                ) AS satisfied,
                bool_or(ea.status IN ('OBSERVED_FAILURE', 'FAILED')) AS failed
           FROM action_dependencies d
           LEFT JOIN execution_attempts ea
             ON ea.workspace_id = d.workspace_id AND ea.action_intent_id = d.from_action_intent_id
          WHERE d.workspace_id = $1 AND d.to_action_intent_id = $2
          GROUP BY d.from_action_intent_id`,
        [params.workspaceId, params.intentId],
      );
      const failedPrerequisite = deps.rows.find((d) => d.failed);
      if (failedPrerequisite) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `prerequisite intent ${failedPrerequisite.from_action_intent_id} failed; dependant is blocked`, [planRef]),
        };
      }
      const unresolvedPrerequisite = deps.rows.find((d) => !d.satisfied);
      if (unresolvedPrerequisite) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `prerequisite intent ${unresolvedPrerequisite.from_action_intent_id} has not completed; downstream dispatch blocked`, [planRef]),
        };
      }
      await registerChildSubject({
        workspaceId: params.workspaceId, id: attemptId, kind: 'EXECUTION_ATTEMPT', aggregateId: params.planId,
      });
      await client.query(
        `INSERT INTO execution_attempts (
           workspace_id, id, action_intent_id, attempt_number, logical_operation_key, request_fingerprint,
           status, provider_operation_key, authority_decision_id, gating_principal_id, created_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'PREPARED',$7,$8,$9,$10)`,
        [
          params.workspaceId, attemptId, params.intentId, params.attemptNumber,
          logicalOperationKey, requestFingerprint,
          params.providerOperationKey ?? null, gate.authorityDecisionId, params.principalId,
          params.actorPrincipalId,
        ],
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
  /** Deterministic subjects the intent acts on (AN-7R). */
  requiredAuthorityScopes: TypedRef[];
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
