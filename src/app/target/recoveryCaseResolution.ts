/**
 * M9 — deterministic RecoveryCase resolution gate.
 *
 * A case becomes RESOLVED / RECOVERED only when current authoritative state
 * proves the affected scope is valid. Success of API, provider, programme
 * command, approval, accepted loss, or planner viability alone is insufficient.
 */
import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';
import { currentAssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';

export type ResolutionDenialReason =
  | 'CASE_NOT_FOUND'
  | 'CASE_NOT_OPEN'
  | 'NO_AFFECTED_SUBJECTS'
  | 'ASSESSMENT_NOT_CURRENT'
  | 'BLOCKING_FAIL'
  | 'BLOCKING_UNKNOWN'
  | 'REQUIRED_PERSON_MISSING'
  | 'EXECUTION_NOT_RECONCILED'
  | 'PROPOSED_STATE_ONLY'
  | 'ACTION_INTENT_NOT_COMPLETE'
  | 'CONSTRAINT_NOT_SATISFIED';

export interface ResolutionGateInput {
  workspaceId: string;
  recoveryCaseId: string;
  now: string;
  /**
   * Traveller/Journey refs that must be included in the recovered scope.
   * Empty means "all case subjects of role affected".
   */
  requiredAffectedPeople?: TypedRef[];
}

export type ResolutionGateResult =
  | {
      allowed: true;
      resolutionKind: 'RECOVERED';
      summary: string;
      subjectVerdicts: Array<{ subjectRef: TypedRef; verdict: string; assessmentId: string }>;
    }
  | {
      allowed: false;
      reason: ResolutionDenialReason;
      detail: string;
      subjectVerdicts?: Array<{ subjectRef: TypedRef; verdict: string; status: string }>;
    };

type Queryable = Pick<Pool | PoolClient, 'query'>;

async function loadCaseSubjects(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
): Promise<Array<{ kind: string; id: string; role: string }>> {
  const result = await db.query<{ subject_kind: string; subject_id: string; role: string }>(
    `SELECT subject_kind, subject_id, role
       FROM case_subjects
      WHERE workspace_id = $1 AND recovery_case_id = $2`,
    [workspaceId, recoveryCaseId],
  );
  return result.rows.map((row) => ({ kind: row.subject_kind, id: row.subject_id, role: row.role }));
}

async function loadAssessableSubjects(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
): Promise<TypedRef[]> {
  // Resolution judges the case's blocking subjects. Overlay-reached extras
  // were compared for regression at planning time; unchanged co-participants
  // must not keep a recovered case open.
  const subjects = await loadCaseSubjects(db, workspaceId, recoveryCaseId);
  const map = new Map<string, TypedRef>();
  for (const subject of subjects) {
    if (subject.kind !== 'JOURNEY' && subject.kind !== 'TRIP') continue;
    const ref: TypedRef = { kind: subject.kind as 'JOURNEY' | 'TRIP', id: subject.id };
    map.set(`${ref.kind}:${ref.id}`, ref);
  }
  return [...map.values()];
}

async function hasUnreconciledExecution(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `SELECT ea.id
       FROM execution_attempts ea
       JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
      WHERE ea.workspace_id = $1
        AND ap.recovery_case_id = $2
        AND ea.status IN (
          'PREPARED', 'CLAIMED', 'DISPATCHING', 'DISPATCHED',
          'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'
        )
      LIMIT 1`,
    [workspaceId, recoveryCaseId],
  );
  return result.rows.length > 0;
}

/**
 * I1 (C4 finding): a case with a RecoveryStrategy/ActionPlan that contains
 * consequential mandatory work must not resolve until that work reaches an
 * observed-success execution outcome. `action_intents.status` is set once at
 * plan-compile time (`compileActionPlan` always writes 'PROPOSED') and the
 * table is immutable thereafter (0102's `action_intents_immutable` trigger),
 * so completion can never be read from that column — it is read from the
 * durable `execution_attempts` state machine (M8), same success set already
 * used by `hasAuthoritativeObservedSuccess` below, applied per-intent. This
 * holds even when no execution_attempts row exists yet at all (authorised
 * but never dispatched). A case with no action_plans/action_intents is
 * unaffected — passive resolution from authoritative current assessments
 * remains available.
 */
async function hasIncompleteMandatoryActions(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `SELECT ai.id
       FROM action_intents ai
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
      WHERE ai.workspace_id = $1
        AND ap.recovery_case_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM execution_attempts ea
           WHERE ea.workspace_id = ai.workspace_id
             AND ea.action_intent_id = ai.id
             AND ea.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
        )
      LIMIT 1`,
    [workspaceId, recoveryCaseId],
  );
  return result.rows.length > 0;
}

async function hasAuthoritativeObservedSuccess(
  db: Queryable,
  workspaceId: string,
  recoveryCaseId: string,
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `SELECT ea.id
       FROM execution_attempts ea
       JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
       JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
      WHERE ea.workspace_id = $1
        AND ap.recovery_case_id = $2
        AND ea.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
      LIMIT 1`,
    [workspaceId, recoveryCaseId],
  );
  return result.rows.length > 0;
}

/**
 * Evaluate whether the recovery case may resolve as RECOVERED.
 * Does not mutate state — pair with `resolveRecoveryCase` command to commit.
 */
export async function evaluateRecoveryCaseResolution(
  db: Queryable,
  input: ResolutionGateInput,
): Promise<ResolutionGateResult> {
  const caseRow = await db.query<{ lifecycle_status: string }>(
    `SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
    [input.workspaceId, input.recoveryCaseId],
  );
  const lifecycle = caseRow.rows[0]?.lifecycle_status;
  if (!lifecycle) {
    return { allowed: false, reason: 'CASE_NOT_FOUND', detail: `case ${input.recoveryCaseId} not found` };
  }
  if (['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED'].includes(lifecycle)) {
    return { allowed: false, reason: 'CASE_NOT_OPEN', detail: `case lifecycle is ${lifecycle}` };
  }

  const subjects = await loadAssessableSubjects(db, input.workspaceId, input.recoveryCaseId);
  if (subjects.length === 0) {
    return { allowed: false, reason: 'NO_AFFECTED_SUBJECTS', detail: 'no JOURNEY/TRIP subjects in case/strategy scope' };
  }

  if (input.requiredAffectedPeople && input.requiredAffectedPeople.length > 0) {
    const present = new Set(subjects.map((s) => `${s.kind}:${s.id}`));
    for (const required of input.requiredAffectedPeople) {
      if (!present.has(`${required.kind}:${required.id}`)) {
        return {
          allowed: false,
          reason: 'REQUIRED_PERSON_MISSING',
          detail: `required affected subject ${required.kind}:${required.id} not in resolution scope`,
        };
      }
    }
  }

  if (await hasUnreconciledExecution(db, input.workspaceId, input.recoveryCaseId)) {
    return {
      allowed: false,
      reason: 'EXECUTION_NOT_RECONCILED',
      detail: 'open or unknown execution attempts remain; reconcile before resolution',
    };
  }

  if (await hasIncompleteMandatoryActions(db, input.workspaceId, input.recoveryCaseId)) {
    return {
      allowed: false,
      reason: 'ACTION_INTENT_NOT_COMPLETE',
      detail: 'case has an action plan with an action intent that has not reached an observed-success execution outcome',
    };
  }

  // Proposed-only programme/strategy state (no observed authoritative success)
  // cannot resolve the case by itself.
  const strategies = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM recovery_strategies
      WHERE workspace_id = $1 AND recovery_case_id = $2
      ORDER BY strategy_version DESC LIMIT 1`,
    [input.workspaceId, input.recoveryCaseId],
  );
  const latest = strategies.rows[0];
  if (latest && ['PROPOSED', 'EVALUATED'].includes(latest.status)) {
    const observed = await hasAuthoritativeObservedSuccess(db, input.workspaceId, input.recoveryCaseId);
    if (!observed) {
      return {
        allowed: false,
        reason: 'PROPOSED_STATE_ONLY',
        detail: 'strategy remains proposed/evaluated without observed authoritative execution',
      };
    }
  }

  const subjectVerdicts: Array<{ subjectRef: TypedRef; verdict: string; assessmentId: string; status: string }> = [];
  for (const subject of subjects) {
    const view = await currentAssessmentView(
      db as Pool,
      input.workspaceId,
      subject,
      'VIABILITY',
      input.now,
    );
    if (view.status !== 'CURRENT' || !view.assessment) {
      return {
        allowed: false,
        reason: 'ASSESSMENT_NOT_CURRENT',
        detail: `${subject.kind}:${subject.id} assessment status=${view.status}`,
        subjectVerdicts: subjectVerdicts.map((v) => ({
          subjectRef: v.subjectRef,
          verdict: v.verdict,
          status: v.status,
        })),
      };
    }
    const verdict = view.assessment.overallVerdict;
    subjectVerdicts.push({
      subjectRef: subject,
      verdict,
      assessmentId: view.assessment.id,
      status: view.status,
    });
    if (verdict === 'FAIL') {
      return {
        allowed: false,
        reason: 'BLOCKING_FAIL',
        detail: `${subject.kind}:${subject.id} overallVerdict=FAIL (action success does not imply recovered trip)`,
        subjectVerdicts: subjectVerdicts.map((v) => ({
          subjectRef: v.subjectRef,
          verdict: v.verdict,
          status: v.status,
        })),
      };
    }
    if (verdict === 'UNKNOWN') {
      return {
        allowed: false,
        reason: 'BLOCKING_UNKNOWN',
        detail: `${subject.kind}:${subject.id} overallVerdict=UNKNOWN`,
        subjectVerdicts: subjectVerdicts.map((v) => ({
          subjectRef: v.subjectRef,
          verdict: v.verdict,
          status: v.status,
        })),
      };
    }
    if (verdict !== 'PASS') {
      return {
        allowed: false,
        reason: 'CONSTRAINT_NOT_SATISFIED',
        detail: `${subject.kind}:${subject.id} unexpected verdict ${verdict}`,
      };
    }
  }

  return {
    allowed: true,
    resolutionKind: 'RECOVERED',
    summary: `All ${subjectVerdicts.length} case JOURNEY/TRIP subjects CURRENT+PASS after observation/reassessment`,
    subjectVerdicts: subjectVerdicts.map((v) => ({
      subjectRef: v.subjectRef,
      verdict: v.verdict,
      assessmentId: v.assessmentId,
    })),
  };
}
