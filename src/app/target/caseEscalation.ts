/**
 * Case escalation pass (T3): assessment -> RecoveryCase, generically.
 *
 * The runtime had no seam that turned a blocking FAIL into recovery work;
 * cases were opened by hand (HTTP or test). This pass is that seam, and it is
 * deliberately a *reconciliation from state* rather than an event handler:
 * every run asks the database which subjects currently hold a latest FAIL
 * assessment that no open case covers, decides with the pure escalation
 * policy, and applies the decision through normal idempotent commands. It is
 * therefore durable (nothing is lost if a process dies between an
 * assessment commit and this pass), self-healing (the next run picks it up)
 * and safe to run concurrently or repeatedly (deterministic case identity +
 * idempotency keys + ON CONFLICT DO NOTHING linkage).
 *
 * Provenance: the assessment that escalates was produced by a
 * `scheduled_reassessments` unit whose `change_signal_id` (migration 0124)
 * names the change that caused it; that signal is linked to the case through
 * `case_signals`, so the case's cause is a database fact.
 *
 * Nothing here knows a scenario, traveller, route or provider.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { SubjectKind, TypedRef } from '../../domain/v2/shared/identity.ts';
import { currentAssessmentView } from '../../persistence/postgres/world/pgAssessments.ts';
import { openRecoveryCase } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import { attachCaseSubjects } from '../../persistence/postgres/commands/caseLifecycleCommands.ts';
import { decideEscalation, type EscalationDecision } from '../../resolution/escalation/policy.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';

/** Deterministic case identity for (workspace, subject, assessment): a retry or a second runner mints the same id. */
export function escalationCaseId(workspaceId: string, subject: TypedRef, assessmentId: string): string {
  return deterministicUuid(RUNTIME_ID_NAMESPACES.escalation, `${workspaceId}|escalation|${subject.kind}|${subject.id}|${assessmentId}`);
}

export interface CaseEscalationContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  /** Injected clock for currentness; defaults to wall clock. */
  now?: string;
  /** Subject kinds the policy is applied to. Default: assessed JOURNEY subjects. */
  subjectKinds?: readonly SubjectKind[];
}

export interface CaseEscalationOutcome {
  subject: TypedRef;
  assessmentId: string;
  decision: EscalationDecision['action'];
  caseId?: string;
  changeSignalId?: string;
  error?: string;
}

export interface CaseEscalationReport {
  at: string;
  candidates: number;
  opened: number;
  attached: number;
  none: number;
  failed: number;
  outcomes: CaseEscalationOutcome[];
}

interface CandidateRow {
  subject_kind: string;
  subject_id: string;
  assessment_id: string;
  change_signal_id: string | null;
}

/**
 * Latest VIABILITY assessments with overall FAIL whose (subject, assessment)
 * pair has not already been linked to a case by this pass. Coverage by an
 * open case is decided by the policy, not by this query, so an ATTACH of a
 * newer FAIL assessment (and its signal) to an existing case still happens.
 */
async function loadCandidates(pool: Pool, workspaceId: string, subjectKinds: readonly SubjectKind[]): Promise<CandidateRow[]> {
  const result = await pool.query<CandidateRow>(
    `SELECT a.subject_kind, a.subject_id, a.id AS assessment_id,
            (SELECT w.change_signal_id FROM scheduled_reassessments w
              WHERE w.workspace_id = a.workspace_id AND w.result_assessment_id = a.id LIMIT 1) AS change_signal_id
       FROM assessments a
      WHERE a.workspace_id = $1 AND a.kind = 'VIABILITY' AND a.overall_verdict = 'FAIL'
        AND a.subject_kind = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM assessments s WHERE s.workspace_id = a.workspace_id AND s.supersedes_assessment_id = a.id)
        AND NOT EXISTS (
          SELECT 1 FROM command_receipts r
           WHERE r.workspace_id = a.workspace_id AND r.command_namespace = 'RECOVERY_CASE_LINKED'
             AND r.idempotency_key = 'escalation:' || a.subject_kind || ':' || a.subject_id::text || ':' || a.id::text)
      ORDER BY a.evaluated_at, a.subject_kind, a.subject_id`,
    [workspaceId, [...subjectKinds]],
  );
  return result.rows;
}

async function loadCasesForSubject(pool: Pool, workspaceId: string, subject: TypedRef): Promise<{ caseId: string; lifecycleStatus: string }[]> {
  const result = await pool.query<{ id: string; lifecycle_status: string }>(
    `SELECT rc.id, rc.lifecycle_status
       FROM case_subjects cs
       JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
      WHERE cs.workspace_id = $1 AND cs.subject_kind = $2 AND cs.subject_id = $3
      ORDER BY rc.opened_at, rc.id`,
    [workspaceId, subject.kind, subject.id],
  );
  return result.rows.map((r) => ({ caseId: r.id, lifecycleStatus: r.lifecycle_status }));
}

export async function runCaseEscalation(ctx: CaseEscalationContext): Promise<CaseEscalationReport> {
  const now = ctx.now ?? new Date().toISOString();
  const subjectKinds = ctx.subjectKinds ?? ['JOURNEY'];
  const candidates = await loadCandidates(ctx.pool, ctx.workspaceId, subjectKinds);
  const report: CaseEscalationReport = { at: now, candidates: candidates.length, opened: 0, attached: 0, none: 0, failed: 0, outcomes: [] };

  for (const candidate of candidates) {
    const subject: TypedRef = { kind: candidate.subject_kind as SubjectKind, id: candidate.subject_id };
    const outcome: CaseEscalationOutcome = { subject, assessmentId: candidate.assessment_id, decision: 'NONE' };
    if (candidate.change_signal_id) outcome.changeSignalId = candidate.change_signal_id;
    try {
      const view = await currentAssessmentView(ctx.pool, ctx.workspaceId, subject, 'VIABILITY', now);
      if (!view.assessment || view.assessment.id !== candidate.assessment_id) {
        // Superseded between the candidate query and now: the newer assessment is its own candidate.
        report.none += 1;
        report.outcomes.push(outcome);
        continue;
      }
      const decision = decideEscalation({ assessment: view.assessment, status: view.status, casesForSubject: await loadCasesForSubject(ctx.pool, ctx.workspaceId, subject) });
      outcome.decision = decision.action;
      if (decision.action === 'NONE') {
        report.none += 1;
        report.outcomes.push(outcome);
        continue;
      }
      let caseId: string;
      if (decision.action === 'OPEN') {
        caseId = escalationCaseId(ctx.workspaceId, subject, candidate.assessment_id);
        const opened = await openRecoveryCase(ctx.uow(), {
          workspaceId: ctx.workspaceId,
          actorPrincipalId: ctx.actorPrincipalId,
          idempotencyKey: `escalation:open:${caseId}`,
          caseId,
          openedAt: now,
        });
        if (!opened.ok) throw new Error(`open case: ${opened.conflict.kind}: ${opened.conflict.message}`);
      } else {
        caseId = decision.caseId;
      }
      const linked = await attachCaseSubjects(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        // The candidate query excludes (subject, assessment) pairs that carry this receipt.
        idempotencyKey: `escalation:${subject.kind}:${subject.id}:${candidate.assessment_id}`,
        caseId,
        subjects: [{ kind: subject.kind, id: subject.id, role: 'affected' }],
        changeSignalIds: candidate.change_signal_id ? [candidate.change_signal_id] : [],
      });
      if (!linked.ok) throw new Error(`link case: ${linked.conflict.kind}: ${linked.conflict.message}`);
      outcome.caseId = caseId;
      if (decision.action === 'OPEN') report.opened += 1;
      else report.attached += 1;
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      report.failed += 1;
    }
    report.outcomes.push(outcome);
  }
  return report;
}
