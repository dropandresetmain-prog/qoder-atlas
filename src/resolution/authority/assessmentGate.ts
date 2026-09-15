/**
 * NORTHSTAR M8 — decision-time assessment currentness gate.
 *
 * C2 pre-M8 condition #3: authority and dispatch must re-check
 * `currentAssessmentView` at the moment a consequential decision is made.
 * STALE / PENDING_REASSESSMENT / UNAVAILABLE / NONE are never treated as
 * current. An earlier approval cannot bypass a non-current assessment.
 */
import type { AssessmentView, AssessmentViewStatus } from '../../persistence/postgres/world/pgAssessments.ts';

export const NON_CURRENT_ASSESSMENT_STATUSES: ReadonlySet<AssessmentViewStatus> = new Set([
  'STALE',
  'PENDING_REASSESSMENT',
  'UNAVAILABLE',
  'NONE',
]);

export type AssessmentGateDenial = {
  allowed: false;
  reason: 'ASSESSMENT_NOT_CURRENT';
  status: AssessmentViewStatus;
  staleness: AssessmentView['staleness'];
};

export type AssessmentGatePass = {
  allowed: true;
  status: 'CURRENT';
  assessment: NonNullable<AssessmentView['assessment']>;
};

export type AssessmentGateResult = AssessmentGatePass | AssessmentGateDenial;

/**
 * Authority / dispatch gate: only CURRENT assessments with a loaded result
 * may authorise a consequential action.
 */
export function requireCurrentAssessmentForDecision(view: AssessmentView): AssessmentGateResult {
  if (view.status !== 'CURRENT' || view.assessment === undefined) {
    return {
      allowed: false,
      reason: 'ASSESSMENT_NOT_CURRENT',
      status: view.status,
      staleness: view.staleness,
    };
  }
  return { allowed: true, status: 'CURRENT', assessment: view.assessment };
}

/** True iff the view may not be used for approval or dispatch. */
export function isAssessmentBlockingAuthority(view: AssessmentView): boolean {
  return !requireCurrentAssessmentForDecision(view).allowed;
}
