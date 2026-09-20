/**
 * NORTHSTAR R1 — Recovery Lifecycle Progression pass (freeze C8 / C4 service).
 *
 * A deliberately boring reconcile-from-PostgreSQL pass. Per wake, per candidate
 * case:
 *
 *   load the case + its CURRENT settled assessments
 *   -> inspect the resolution gate and the case's planning/execution facts
 *   -> project the observed facts onto the frozen pure decision (C8)
 *   -> dispatch ONCE to the existing owner
 *   -> end.
 *
 *   RESOLVE   -> `resolveRecoveryCase` (the deterministic resolution gate re-runs inside)
 *   WAIT      -> nothing
 *   REPLAN    -> `RecoveryPlanningCoordinator.planCase` (against the CURRENT basis)
 *   ESCALATE  -> `openRecoveryCaseAttention` (durable, orthogonal to case phase)
 *
 * No durable workflow cursor, no recursion, no graph engine, no duplicated
 * business state: every input is read from authoritative PostgreSQL rows on each
 * wake and every dispatch is idempotent under the current basis. Delivery is
 * at-least-once; the business progression is idempotent, not exactly-once.
 *
 * It NEVER approves, dispatches or retries a provider action, reconciles a
 * provider outcome, mutates programme/travel state, or marks a case recovered by
 * itself. An unsettled assessment (reassessment pending) is not a basis to act
 * on, so it WAITs.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { SubjectId, TypedRef } from '../../domain/v2/shared/identity.ts';
import type { RecoveryPlanningCoordinator } from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';
import {
  RecoveryCaseAttentionReasonSchema,
  type RecoveryCaseAttentionReason,
} from '../../contracts/v2/planning/recoveryCaseAttention.ts';
import type { RecoveryProgressionDecision } from '../../contracts/v2/planning/recoveryProgression.ts';
import { decideProgressionFromFacts } from '../../resolution/planning/progressionFacts.ts';
import { currentAssessmentView, loadAssessment } from '../../persistence/postgres/world/pgAssessments.ts';
import { resolveRecoveryCase } from '../../persistence/postgres/commands/m9CaseResolutionCommands.ts';
import {
  listRecoveryCaseAttention,
  openRecoveryCaseAttention,
  resolveRecoveryCaseAttention,
} from '../../persistence/postgres/commands/caseAttentionCommands.ts';
import {
  findLatestRecoveryPlanningAttemptForCase,
  findRecoveryPlanningAttemptForBasis,
} from '../../persistence/postgres/commands/r1PlanningAttemptCommands.ts';
import { evaluateRecoveryCaseResolution } from './recoveryCaseResolution.ts';
import { ensureOriginalCaseGraph } from './originalCaseGraphCapture.ts';
import { recoveryPlanningEligibleFromAssessment } from './readmodels/mapConnectionProgression.ts';

/** Upper bound on cases inspected per wake; the report says when it truncated. */
export const PROGRESSION_CANDIDATE_LIMIT = 200;

export interface ProgressionPassContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  /** The existing planning owner (C1). Composed once by the runtime. */
  planner: RecoveryPlanningCoordinator;
  now?: string;
  limit?: number;
}

export type ProgressionDispatch = 'RESOLVED' | 'PLANNED' | 'ATTENTION_OPENED' | 'ATTENTION_EXISTS' | 'NONE' | 'FAILED';

export interface ProgressionOutcome {
  caseId: string;
  status: string;
  /** The frozen C8 decision, or `WAIT` with a pass-level reason when no settled basis exists. */
  decision: RecoveryProgressionDecision;
  reasonCode: string;
  basisAssessmentId?: string;
  dispatch: ProgressionDispatch;
  detail?: string;
}

export interface ProgressionPassReport {
  at: string;
  candidates: number;
  truncated: boolean;
  resolved: number;
  planned: number;
  escalated: number;
  waiting: number;
  failed: number;
  outcomes: ProgressionOutcome[];
}

type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

interface SettledBasis {
  assessmentId: string;
  verdict: Verdict;
}

/**
 * The CURRENT settled basis of a case: FAIL beats UNKNOWN beats PASS, first
 * subject in canonical (kind, id) order — for FAIL this is exactly the
 * coordinator's planning basis (`failing[0]`). `undefined` reason means "not yet
 * settled" (a subject's assessment is not CURRENT) or "no subjects".
 */
async function settledBasis(pool: Pool, workspaceId: string, caseId: string, now: string): Promise<{ basis: SettledBasis } | { unsettled: string }> {
  const subjects = await pool.query<{ subject_kind: string; subject_id: string }>(
    `SELECT DISTINCT subject_kind, subject_id FROM case_subjects
      WHERE workspace_id = $1 AND recovery_case_id = $2 AND subject_kind IN ('JOURNEY', 'TRIP')
      ORDER BY subject_kind, subject_id`,
    [workspaceId, caseId],
  );
  if (subjects.rows.length === 0) return { unsettled: 'no_case_subjects' };
  const found: Record<Verdict, string | undefined> = { FAIL: undefined, UNKNOWN: undefined, PASS: undefined };
  for (const row of subjects.rows) {
    const ref: TypedRef = { kind: row.subject_kind as TypedRef['kind'], id: row.subject_id };
    const view = await currentAssessmentView(pool, workspaceId, ref, 'VIABILITY', now);
    if (view.status !== 'CURRENT' || !view.assessment) return { unsettled: 'assessment_not_settled' };
    const verdict: Verdict = view.assessment.overallVerdict === 'PASS' ? 'PASS' : view.assessment.overallVerdict === 'FAIL' ? 'FAIL' : 'UNKNOWN';
    found[verdict] ??= view.assessment.id;
  }
  for (const verdict of ['FAIL', 'UNKNOWN', 'PASS'] as const) {
    const assessmentId = found[verdict];
    if (assessmentId) return { basis: { assessmentId, verdict } };
  }
  return { unsettled: 'no_case_subjects' };
}

/** Non-terminal cases that have a JOURNEY/TRIP subject, oldest first (deterministic, bounded). */
async function candidateCases(ctx: ProgressionPassContext, limit: number): Promise<{ id: string; lifecycle_status: string }[]> {
  const rows = await ctx.pool.query<{ id: string; lifecycle_status: string }>(
    `SELECT rc.id, rc.lifecycle_status FROM recovery_cases rc
      WHERE rc.workspace_id = $1 AND rc.lifecycle_status IN ('OPEN', 'PLANNING', 'AWAITING_AUTHORITY', 'EXECUTING')
        AND EXISTS (SELECT 1 FROM case_subjects cs WHERE cs.workspace_id = rc.workspace_id AND cs.recovery_case_id = rc.id AND cs.subject_kind IN ('JOURNEY', 'TRIP'))
      ORDER BY rc.opened_at, rc.id
      LIMIT $2`,
    [ctx.workspaceId, limit + 1],
  );
  return rows.rows;
}

/**
 * Is a human approval still outstanding for the plan made against THIS basis? True
 * only while at least one viable strategy of the attempt has not been planned for
 * execution yet. Once every viable option has been approved (and executed or in
 * flight) the attempt no longer "awaits authority": in-flight work is the
 * resolution gate's WAIT, and completed work that left the SAME basis failing has
 * exhausted this basis's options.
 */
async function approvalStillOutstanding(pool: Pool, workspaceId: string, strategyRefs: readonly string[]): Promise<boolean> {
  if (strategyRefs.length === 0) return false;
  const open = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM recovery_strategies s
      WHERE s.workspace_id = $1 AND s.id = ANY($2::uuid[])
        AND NOT EXISTS (SELECT 1 FROM action_plans ap WHERE ap.workspace_id = s.workspace_id AND ap.recovery_strategy_id = s.id)`,
    [workspaceId, strategyRefs],
  );
  return Number(open.rows[0]!.n) > 0;
}

function attentionReasonFor(reasonCode: string, planningOutcome: string | undefined): RecoveryCaseAttentionReason {
  // The coordinator's own verdict that it needs a person outranks the generic mapping.
  if (planningOutcome === 'NEEDS_EVIDENCE_OR_DECISION') return 'human_evidence_or_decision_required';
  return RecoveryCaseAttentionReasonSchema.parse(reasonCode);
}

/** Mutates `outcome` as it learns, so a dispatch failure still reports the decision that was taken. */
async function progressCase(ctx: ProgressionPassContext, row: { id: string; lifecycle_status: string }, now: string, outcome: ProgressionOutcome): Promise<ProgressionOutcome> {

  const settled = await settledBasis(ctx.pool, ctx.workspaceId, row.id, now);
  if ('unsettled' in settled) {
    // Not a decision the frozen precedence can take: there is no settled basis to bind it to.
    outcome.reasonCode = settled.unsettled;
    return outcome;
  }
  const { basis } = settled;
  outcome.basisAssessmentId = basis.assessmentId;

  // R2: the first settled FAILING basis is the first truthful focused Case graph.
  // Freeze it as the immutable Original BEFORE anything is dispatched below, so
  // planning/approval/execution can never precede or mutate it. Idempotent
  // (insert-once); presentation history only — it never feeds a decision here.
  if (basis.verdict === 'FAIL') {
    try {
      await ensureOriginalCaseGraph(ctx, { caseId: row.id, basisAssessmentId: basis.assessmentId, now });
    } catch (error) {
      // Presentation history must never block recovery: report it and retry next wake.
      outcome.detail = `original graph capture failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // A newer settled basis supersedes attention raised against an older one.
  const attention = await listRecoveryCaseAttention(ctx.pool, ctx.workspaceId, row.id);
  if (attention.some((a) => a.status === 'OPEN' && a.basisAssessmentId !== basis.assessmentId)) {
    const cleared = await resolveRecoveryCaseAttention(ctx.uow(), {
      workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: `progression:attention-supersede:${row.id}:${basis.assessmentId}`,
      caseId: row.id, resolution: 'basis_superseded', currentBasisAssessmentId: basis.assessmentId, resolvedAt: now,
    });
    if (!cleared.ok) throw new Error(`attention supersede: ${cleared.conflict.kind}: ${cleared.conflict.message}`);
  }

  const gate = await evaluateRecoveryCaseResolution(ctx.pool, { workspaceId: ctx.workspaceId, recoveryCaseId: row.id, now });
  const attempt = await findRecoveryPlanningAttemptForBasis(ctx.pool, ctx.workspaceId, row.id, basis.assessmentId);
  const basisAssessment = basis.verdict === 'FAIL'
    ? await loadAssessment(ctx.pool, ctx.workspaceId, basis.assessmentId)
    : undefined;
  const planningEligible = basis.verdict === 'FAIL'
    && (basisAssessment ? recoveryPlanningEligibleFromAssessment(basisAssessment) : true);
  const result = decideProgressionFromFacts({
    recoveryCaseId: row.id as SubjectId,
    basisAssessmentId: basis.assessmentId as SubjectId,
    gate,
    // A plan already produced for THIS basis that still awaits a human approval is
    // pending authority; a plan for an older basis, or one already approved, is not.
    authorityOrExecutionPending: basis.verdict === 'FAIL' && attempt?.outcome === 'AWAITING_AUTHORITY'
      && await approvalStillOutstanding(ctx.pool, ctx.workspaceId, attempt.attempt.viableStrategyRefs),
    // One planning attempt per basis: a settled attempt for this basis is never redone.
    // Tight-only connection FAIL stays monitorable (Case open) without REPLAN.
    recoveryRemainsPossible: planningEligible && attempt === undefined,
    currentAssessmentVerdict: basis.verdict,
  });
  outcome.decision = result.decision;
  outcome.reasonCode = result.reasonCode;

  switch (result.decision) {
    case 'WAIT':
      return outcome;

    case 'RESOLVE': {
      const resolved = await resolveRecoveryCase(ctx.uow(), {
        workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `progression:resolve:${row.id}:${basis.assessmentId}`,
        recoveryCaseId: row.id, now,
      });
      if (!resolved.ok) throw new Error(`${resolved.conflict.kind}: ${resolved.conflict.message}`);
      outcome.dispatch = 'RESOLVED';
      outcome.status = 'RESOLVED';
      outcome.detail = resolved.value.summary;
      return outcome;
    }

    case 'REPLAN': {
      const anyAttempt = await findLatestRecoveryPlanningAttemptForCase(ctx.pool, ctx.workspaceId, row.id);
      const planned = await ctx.planner.planCase({ recoveryCaseId: row.id as SubjectId, reason: anyAttempt ? 'REASSESSMENT' : 'CASE_OPENED' });
      outcome.dispatch = 'PLANNED';
      outcome.detail = `planning outcome ${planned.outcome}`
        + (planned.basisAssessmentId && planned.basisAssessmentId !== basis.assessmentId ? ' (planned against a newer basis)' : '');
      return outcome;
    }

    case 'ESCALATE': {
      const opened = await openRecoveryCaseAttention(ctx.uow(), {
        workspaceId: ctx.workspaceId, actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: `progression:attention:${row.id}:${basis.assessmentId}:${attentionReasonFor(result.reasonCode, attempt?.outcome)}`,
        caseId: row.id, basisAssessmentId: basis.assessmentId,
        reason: attentionReasonFor(result.reasonCode, attempt?.outcome), openedAt: now,
      });
      if (!opened.ok) throw new Error(`${opened.conflict.kind}: ${opened.conflict.message}`);
      outcome.dispatch = opened.value.created ? 'ATTENTION_OPENED' : 'ATTENTION_EXISTS';
      return outcome;
    }
  }
}

export async function runRecoveryProgressionPass(ctx: ProgressionPassContext): Promise<ProgressionPassReport> {
  const now = ctx.now ?? new Date().toISOString();
  const limit = ctx.limit ?? PROGRESSION_CANDIDATE_LIMIT;
  const found = await candidateCases(ctx, limit);
  const truncated = found.length > limit;
  const cases = truncated ? found.slice(0, limit) : found;
  const report: ProgressionPassReport = { at: now, candidates: cases.length, truncated, resolved: 0, planned: 0, escalated: 0, waiting: 0, failed: 0, outcomes: [] };
  for (const row of cases) {
    const outcome: ProgressionOutcome = { caseId: row.id, status: row.lifecycle_status, decision: 'WAIT', reasonCode: 'assessment_not_settled', dispatch: 'NONE' };
    try {
      await progressCase(ctx, row, now, outcome);
    } catch (error) {
      outcome.dispatch = 'FAILED';
      outcome.detail = error instanceof Error ? error.message : String(error);
    }
    if (outcome.dispatch === 'FAILED') report.failed += 1;
    else if (outcome.dispatch === 'RESOLVED') report.resolved += 1;
    else if (outcome.dispatch === 'PLANNED') report.planned += 1;
    else if (outcome.dispatch === 'ATTENTION_OPENED' || outcome.dispatch === 'ATTENTION_EXISTS') report.escalated += 1;
    else report.waiting += 1;
    report.outcomes.push(outcome);
  }
  return report;
}
