/**
 * Escalation policy (T3) — pure, deterministic, scenario-neutral.
 *
 * Decides whether a subject's CURRENT assessment warrants recovery work:
 * "open/update recovery work only where action/investigation is needed"
 * (docs/ARCHITECTURE.md, consequence propagation). The decision is a
 * function of the assessment and the subject's existing open cases only;
 * it never reads names, routes, fixtures or provider identities.
 *
 * v1 rule:
 *  - only a CURRENT assessment can escalate (STALE / PENDING / NONE never do —
 *    the next reassessment decides);
 *  - overall FAIL with at least one applicable, blocking FAIL dimension
 *    escalates; UNKNOWN never opens a case silently (it is uncertainty, not
 *    a decision);
 *  - a subject already covered by an open case ATTACHes (the new assessment
 *    and its change signal link to that case) instead of opening a second
 *    one — "new disruption after a terminal case opens/links a new case"
 *    (closure §9), so only non-terminal cases count as open.
 */
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { AssessmentViewStatus } from '../../contracts/v2/product/readModels.ts';

export const TERMINAL_CASE_STATUSES: ReadonlySet<string> = new Set(['RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);

export interface OpenCaseForSubject {
  caseId: string;
  lifecycleStatus: string;
}

export interface EscalationInput {
  assessment: AssessmentResult;
  /** Currentness of `assessment` as computed by `currentAssessmentView`. */
  status: AssessmentViewStatus;
  /** Every case currently linked to the assessed subject, any lifecycle. */
  casesForSubject: readonly OpenCaseForSubject[];
}

export type EscalationDecision =
  | { action: 'OPEN'; blockingDimensions: string[]; reasons: string[] }
  | { action: 'ATTACH'; caseId: string; blockingDimensions: string[]; reasons: string[] }
  | { action: 'NONE'; reasons: string[] };

export function blockingFailures(assessment: AssessmentResult): string[] {
  return assessment.dimensions
    .filter((d) => d.applicable && d.blocking && d.verdict === 'FAIL')
    .map((d) => d.dimension)
    .sort();
}

export function decideEscalation(input: EscalationInput): EscalationDecision {
  const reasons: string[] = [];
  if (input.status !== 'CURRENT') {
    return { action: 'NONE', reasons: [`assessment is ${input.status}, not CURRENT`] };
  }
  if (input.assessment.overallVerdict !== 'FAIL') {
    return { action: 'NONE', reasons: [`overall verdict ${input.assessment.overallVerdict} does not require recovery work`] };
  }
  const blockingDimensions = blockingFailures(input.assessment);
  if (blockingDimensions.length === 0) {
    return { action: 'NONE', reasons: ['overall FAIL without an applicable blocking FAIL dimension'] };
  }
  reasons.push(`blocking FAIL: ${blockingDimensions.join(', ')}`);
  const open = [...input.casesForSubject]
    .filter((c) => !TERMINAL_CASE_STATUSES.has(c.lifecycleStatus))
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  if (open.length > 0) {
    reasons.push(`subject already covered by open case ${open[0]!.caseId}`);
    return { action: 'ATTACH', caseId: open[0]!.caseId, blockingDimensions, reasons };
  }
  return { action: 'OPEN', blockingDimensions, reasons };
}
