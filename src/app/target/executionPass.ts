/**
 * Internal execution pass (B1): approved intents -> durable execution ->
 * observation -> canonical update, through the existing gated executor.
 *
 * Reconcile-from-state, like escalation: each pass asks the database which
 * internal-capability intents are authorised (decision + approval), have
 * every prerequisite intent observed successful, hold no success attempt yet
 * and no in-flight/blocking attempt, and have not exhausted their bounded
 * attempts. Each is executed through `executeInternalProgrammeItemSchedule`,
 * which runs the stored execution gate (authority, currentness, scope),
 * records the durable attempt and the observation, and applies the canonical
 * mutation in the same transaction. The M6 triggers then invalidate every
 * assessment that read the mutated programme, and the reassessment worker
 * produces the fresh truth the resolution gate needs.
 *
 * External capabilities are not dispatched here (B2: PgExecutionWorker +
 * provider dispatcher). A failed attempt is left visible; after
 * `maxAttempts` the intent is no longer retried and the case stays
 * EXECUTING with the failure on record — never silently recovered.
 *
 * One candidate set per pass, deliberately. A mutation invalidates the
 * assessments the next intent's gate must see CURRENT, so a dependent intent
 * is DEFERRED (not failed) until the reassessment worker has settled the
 * world; the boot root re-runs this pass right after every drain.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { executeInternalProgrammeItemSchedule } from '../../persistence/postgres/execution/internalProgrammeExecutor.ts';
import { INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY } from '../../persistence/postgres/execution/storedExecutionGate.ts';

export interface ExecutionPassContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  /** Principal holding `action.intent.dispatch`; the gating principal of every attempt. */
  executorPrincipalId: string;
  now?: string;
  maxAttempts?: number;
}

export interface ExecutionOutcome {
  caseId: string;
  planId: string;
  intentId: string;
  attemptNumber: number;
  result: 'EXECUTED' | 'REPLAYED' | 'DEFERRED' | 'FAILED';
  detail?: string;
}

export interface ExecutionPassReport {
  at: string;
  candidates: number;
  executed: number;
  deferred: number;
  failed: number;
  outcomes: ExecutionOutcome[];
}

interface CandidateIntent {
  case_id: string;
  plan_id: string;
  intent_id: string;
  attempts: number;
}

const SUCCESS = ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'];
const IN_FLIGHT = ['PREPARED', 'CLAIMED', 'DISPATCHING', 'DISPATCHED', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'];

async function loadCandidates(pool: Pool, workspaceId: string, maxAttempts: number): Promise<CandidateIntent[]> {
  const result = await pool.query<CandidateIntent>(
    `SELECT ap.recovery_case_id AS case_id, ap.id AS plan_id, ai.id AS intent_id,
            (SELECT count(*)::int FROM execution_attempts ea WHERE ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id) AS attempts
       FROM action_intents ai
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
       JOIN recovery_cases rc ON rc.workspace_id = ap.workspace_id AND rc.id = ap.recovery_case_id
      WHERE ai.workspace_id = $1
        AND ai.capability_ref = $2
        AND rc.lifecycle_status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')
        -- authorised: a decision with at least one approval
        AND EXISTS (SELECT 1 FROM authority_decisions d JOIN approvals a ON a.workspace_id = d.workspace_id AND a.decision_id = d.id
                     WHERE d.workspace_id = ai.workspace_id AND d.action_intent_id = ai.id)
        -- not yet successful, nothing in flight
        AND NOT EXISTS (SELECT 1 FROM execution_attempts ea WHERE ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id AND ea.status = ANY($3::text[]))
        AND NOT EXISTS (SELECT 1 FROM execution_attempts ea WHERE ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id AND ea.status = ANY($4::text[]))
        -- every prerequisite observed successful
        AND NOT EXISTS (
          SELECT 1 FROM action_dependencies d
           WHERE d.workspace_id = ai.workspace_id AND d.to_action_intent_id = ai.id
             AND NOT EXISTS (SELECT 1 FROM execution_attempts pe WHERE pe.workspace_id = d.workspace_id AND pe.action_intent_id = d.from_action_intent_id AND pe.status = ANY($3::text[])))
        AND (SELECT count(*) FROM execution_attempts ea WHERE ea.workspace_id = ai.workspace_id AND ea.action_intent_id = ai.id) < $5
      ORDER BY ap.created_at, ai.created_at, ai.id`,
    [workspaceId, INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY, SUCCESS, IN_FLIGHT, maxAttempts],
  );
  return result.rows;
}

export async function runInternalExecutionPass(ctx: ExecutionPassContext): Promise<ExecutionPassReport> {
  const now = ctx.now ?? new Date().toISOString();
  const maxAttempts = ctx.maxAttempts ?? 3;
  const report: ExecutionPassReport = { at: now, candidates: 0, executed: 0, deferred: 0, failed: 0, outcomes: [] };
  const candidates = await loadCandidates(ctx.pool, ctx.workspaceId, maxAttempts);
  report.candidates = candidates.length;
  {
    for (const candidate of candidates) {
      const attemptNumber = candidate.attempts + 1;
      const outcome: ExecutionOutcome = { caseId: candidate.case_id, planId: candidate.plan_id, intentId: candidate.intent_id, attemptNumber, result: 'FAILED' };
      try {
        const executed = await executeInternalProgrammeItemSchedule(ctx.pool, ctx.uow(), {
          workspaceId: ctx.workspaceId,
          actorPrincipalId: ctx.actorPrincipalId,
          idempotencyKey: `execution:${candidate.intent_id}:${attemptNumber}`,
          planId: candidate.plan_id,
          intentId: candidate.intent_id,
          attemptNumber,
          principalId: ctx.executorPrincipalId,
          now,
        });
        if (executed.ok) {
          outcome.result = executed.value.replayed ? 'REPLAYED' : 'EXECUTED';
          report.executed += 1;
        } else if (executed.conflict.message.includes('ASSESSMENT_NOT_CURRENT')) {
          // The world is being reassessed (typically because a prerequisite
          // intent just mutated it). Not a failure: the next pass, after the
          // drain, sees CURRENT assessments and the gate decides again.
          outcome.result = 'DEFERRED';
          outcome.detail = `${executed.conflict.kind}: ${executed.conflict.message}`;
          report.deferred += 1;
        } else {
          outcome.detail = `${executed.conflict.kind}: ${executed.conflict.message}`;
          report.failed += 1;
        }
      } catch (error) {
        outcome.detail = error instanceof Error ? error.message : String(error);
        report.failed += 1;
      }
      report.outcomes.push(outcome);
    }
  }
  return report;
}
