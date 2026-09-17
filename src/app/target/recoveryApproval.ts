/**
 * Recovery approval composition (B1): persisted strategy -> ActionPlan ->
 * authority decision -> approval by a real principal.
 *
 *   VIABLE strategy (stored)            — the reviewed basis
 *   -> compileActionPlan with currentness (STALE base refuses)
 *   -> persistActionPlan (one plan per strategy, deterministic identity)
 *   -> per intent: deterministic required scope (loadRequiredAuthorityScope)
 *      -> approver must already hold `action.intent.authorize` over it and
 *         the runtime executor must hold `action.intent.dispatch` over it
 *         (both verified here so a missing grant is a refusal, not a
 *         surprise at dispatch)
 *      -> issueAuthorityDecision with the envelope the stored gate rebuilds
 *      -> recordApproval by the approving principal
 *   -> case phase -> EXECUTING.
 *
 * Nothing executes here. The stored execution gate re-derives everything
 * from these rows at dispatch time; this composition only produces them.
 * Costed intents (budget holds) are outside B1: refused explicitly.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { ApplicationError } from '../../contracts/v2/product/readModels.ts';
import { RecoveryStrategySchema, type RecoveryStrategy } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { ActionPlan } from '../../contracts/v2/action/actionPlan.ts';
import { PgCurrentStateReader } from '../../persistence/postgres/world/pgCurrentState.ts';
import { persistActionPlan, issueAuthorityDecision, recordApproval } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import { buildEnvelopeInput, loadRequiredAuthorityScope, loadStoredIntent, loadGrantsForPrincipal } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import { AUTHORIZE_ACTION_KIND, DISPATCH_ACTION_KIND, scopeCoversRequired } from '../../resolution/authority/authorize.ts';
import { computeEnvelopeFingerprint } from '../../resolution/authority/envelope.ts';
import { compileActionPlan } from '../../resolution/planning/compiler.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';
import { advanceCasePhase } from './recoveryPlanning.ts';
import { applicationError } from './applicationCommands.ts';

export const APPROVAL_ACTOR_ROLE = 'CASE_OWNER';

export interface ApprovalContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  now?: string;
  /** The runtime principal that will dispatch (holds `action.intent.dispatch`). */
  executorPrincipalId: string;
}

export interface ApprovalReport {
  caseId: string;
  strategyId: string;
  planId: string;
  approverPrincipalId: string;
  intents: { intentId: string; decisionId: string; approvalId: string; requiredScope: TypedRef[] }[];
  caseStatus: string;
}

export type ApprovalOutcome = { ok: true; report: ApprovalReport } | { ok: false; error: ApplicationError };

async function loadStrategy(pool: Pool, workspaceId: string, strategyId: string): Promise<RecoveryStrategy | undefined> {
  const row = (await pool.query<{
    id: string; recovery_case_id: string; strategy_version: number; status: string; viability: string; basis_assessment_id: string | null;
    base_manifest: unknown; scenario_change: unknown; assumptions: unknown; required_unknowns: unknown; candidate_assessment_summaries: unknown;
    required_authority_scopes: unknown; rejection_reason: string | null; created_at: Date; evaluated_at: Date | null;
  }>(
    'SELECT * FROM recovery_strategies WHERE workspace_id = $1 AND id = $2',
    [workspaceId, strategyId],
  )).rows[0];
  if (!row) return undefined;
  const scenarioChange = row.scenario_change as { affectedSubjectRefs?: TypedRef[] };
  return RecoveryStrategySchema.parse({
    id: row.id,
    recoveryCaseId: row.recovery_case_id,
    strategyVersion: row.strategy_version,
    status: row.status,
    baseManifest: row.base_manifest,
    basisAssessmentId: row.basis_assessment_id,
    affectedSubjectRefs: scenarioChange.affectedSubjectRefs ?? [],
    scenarioChange: row.scenario_change,
    assumptions: row.assumptions,
    requiredUnknowns: row.required_unknowns,
    candidateAssessments: row.candidate_assessment_summaries,
    candidateAssessmentResults: [],
    viability: row.viability,
    requiredAuthorityScopes: row.required_authority_scopes,
    createdAt: row.created_at.toISOString(),
    ...(row.evaluated_at ? { evaluatedAt: row.evaluated_at.toISOString() } : {}),
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
  });
}

/** The plan already persisted for this strategy, if any (retry safety: never compile a second plan for the same basis). */
async function existingPlan(pool: Pool, workspaceId: string, strategyId: string): Promise<{ planId: string; intentIds: string[] } | undefined> {
  const plan = (await pool.query<{ id: string }>('SELECT id FROM action_plans WHERE workspace_id = $1 AND recovery_strategy_id = $2 ORDER BY created_at LIMIT 1', [workspaceId, strategyId])).rows[0];
  if (!plan) return undefined;
  const intents = await pool.query<{ id: string }>('SELECT id FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2 ORDER BY created_at, id', [workspaceId, plan.id]);
  return { planId: plan.id, intentIds: intents.rows.map((r) => r.id) };
}

async function programmeOwnership(pool: Pool, workspaceId: string, plan: RecoveryStrategy): Promise<Map<string, string>> {
  const itemIds = plan.scenarioChange.effects.flatMap((e) => (e.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME' ? [e.programmeItemId] : []));
  if (itemIds.length === 0) return new Map();
  const rows = await pool.query<{ id: string; programme_id: string }>('SELECT id, programme_id FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [workspaceId, itemIds]);
  return new Map(rows.rows.map((r) => [r.id, r.programme_id]));
}

export async function approveRecoveryStrategy(
  ctx: ApprovalContext,
  input: { caseId: string; strategyId: string; approverPrincipalId: string },
): Promise<ApprovalOutcome> {
  const now = ctx.now ?? new Date().toISOString();
  const strategy = await loadStrategy(ctx.pool, ctx.workspaceId, input.strategyId);
  if (!strategy || strategy.recoveryCaseId !== input.caseId) return { ok: false, error: applicationError('STRATEGY_NOT_FOUND', `strategy ${input.strategyId} is not a candidate of case ${input.caseId}`) };
  if (strategy.viability !== 'VIABLE') return { ok: false, error: applicationError('STRATEGY_NOT_VIABLE', `strategy ${input.strategyId} is ${strategy.viability}`) };
  const caseRow = (await ctx.pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [ctx.workspaceId, input.caseId])).rows[0];
  if (!caseRow) return { ok: false, error: applicationError('CASE_NOT_FOUND', `recovery case ${input.caseId} does not exist`) };
  if (['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'].includes(caseRow.lifecycle_status)) return { ok: false, error: applicationError('CASE_NOT_OPEN', `recovery case ${input.caseId} is ${caseRow.lifecycle_status}`) };

  // 1. Plan: the persisted, versioned execution basis (compile once per strategy).
  let planId: string;
  let intentIds: string[];
  const existing = await existingPlan(ctx.pool, ctx.workspaceId, strategy.id);
  if (existing) {
    planId = existing.planId;
    intentIds = existing.intentIds;
  } else {
    const currentState = await new PgCurrentStateReader(ctx.pool).loadFor(ctx.workspaceId, strategy.baseManifest);
    const compiled = compileActionPlan({
      strategy,
      now,
      currentState,
      actionPlanId: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${strategy.id}|plan`),
      programmeItemOwnership: await programmeOwnership(ctx.pool, ctx.workspaceId, strategy),
    });
    if (!compiled.ok) {
      const code = compiled.conflict.kind === 'STALE_AGGREGATE_REVISION' ? 'STRATEGY_BASE_STALE' : 'PLAN_COMPILE_FAILED';
      return { ok: false, error: applicationError(code, `${compiled.conflict.kind}: ${compiled.conflict.message}`) };
    }
    const plan: ActionPlan = compiled.value.plan;
    if (plan.intents.some((i) => i.costEstimate !== undefined)) {
      return { ok: false, error: applicationError('BUDGET_HOLD_REQUIRED', 'costed intents require a budget hold, which this approval path does not yet compose') };
    }
    const persisted = await persistActionPlan(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `approval:plan:${strategy.id}`,
      plan,
      recoveryStrategyId: strategy.id,
    });
    if (!persisted.ok) return { ok: false, error: applicationError('PLAN_PERSIST_FAILED', `${persisted.conflict.kind}: ${persisted.conflict.message}`) };
    planId = persisted.value.planId;
    intentIds = persisted.value.intentIds;
  }

  // 2. Authority per intent: deterministic scope, real grants, decision, approval.
  const approverGrants = await loadGrantsForPrincipal(ctx.pool, ctx.workspaceId, input.approverPrincipalId, now);
  const executorGrants = await loadGrantsForPrincipal(ctx.pool, ctx.workspaceId, ctx.executorPrincipalId, now);
  const intents: ApprovalReport['intents'] = [];
  for (const intentId of intentIds) {
    const required = await loadRequiredAuthorityScope(ctx.pool, ctx.workspaceId, intentId);
    if ('allowed' in required) return { ok: false, error: applicationError('AUTHORITY_SCOPE_UNRESOLVED', `${required.reason}${required.detail ? `: ${required.detail}` : ''}`) };
    const approverCovers = approverGrants.some((g) => g.principalId === input.approverPrincipalId && g.actions.includes(AUTHORIZE_ACTION_KIND) && g.revokedAt === undefined && scopeCoversRequired(g.scopes, required));
    if (!approverCovers) return { ok: false, error: applicationError('APPROVER_UNAUTHORIZED', `principal ${input.approverPrincipalId} holds no live ${AUTHORIZE_ACTION_KIND} grant covering ${required.map((r) => `${r.kind}:${r.id}`).join(', ')}`) };
    const executorCovers = executorGrants.some((g) => g.principalId === ctx.executorPrincipalId && g.actions.includes(DISPATCH_ACTION_KIND) && g.revokedAt === undefined && scopeCoversRequired(g.scopes, required));
    if (!executorCovers) return { ok: false, error: applicationError('DISPATCHER_UNAUTHORIZED', `runtime executor ${ctx.executorPrincipalId} holds no live ${DISPATCH_ACTION_KIND} grant covering the required scope`) };

    const stored = await loadStoredIntent(ctx.pool, ctx.workspaceId, intentId);
    if (!stored) return { ok: false, error: applicationError('INTENT_MISSING', `stored intent ${intentId} is incomplete`) };
    const envelopeInput = buildEnvelopeInput(stored, { scope: required, grantRefs: [], ruleInputs: [], limits: null }, [{ actorRole: APPROVAL_ACTOR_ROLE }]);
    const decisionId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${intentId}|decision|${computeEnvelopeFingerprint(envelopeInput)}`);
    const decision = await issueAuthorityDecision(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `approval:decision:${decisionId}`,
      decisionId,
      envelopeInput,
      requirements: [{ id: deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${decisionId}|requirement|${APPROVAL_ACTOR_ROLE}`), actorRole: APPROVAL_ACTOR_ROLE }],
      issuedAt: now,
    });
    if (!decision.ok) return { ok: false, error: applicationError('AUTHORITY_DECISION_FAILED', `${decision.conflict.kind}: ${decision.conflict.message}`) };
    const approvalId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${decisionId}|approval|${input.approverPrincipalId}`);
    const approval = await recordApproval(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: input.approverPrincipalId,
      idempotencyKey: `approval:approve:${approvalId}`,
      approvalId,
      decisionId: decision.value.decisionId,
      requirementId: decision.value.requirementIds[0]!,
      envelopeFingerprint: decision.value.fingerprint,
      scope: required,
      approvedAt: now,
    });
    if (!approval.ok) return { ok: false, error: applicationError('APPROVAL_FAILED', `${approval.conflict.kind}: ${approval.conflict.message}`) };
    intents.push({ intentId, decisionId: decision.value.decisionId, approvalId: approval.value.approvalId, requiredScope: required });
  }

  const caseStatus = await advanceCasePhase(ctx, input.caseId, 'EXECUTING', 'plan approved');
  return { ok: true, report: { caseId: input.caseId, strategyId: strategy.id, planId, approverPrincipalId: input.approverPrincipalId, intents, caseStatus } };
}
