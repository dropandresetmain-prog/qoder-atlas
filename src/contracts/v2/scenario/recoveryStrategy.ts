/**
 * NORTHSTAR v2 — RecoveryStrategy (M7).
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.6/§10, LOGICAL_SCHEMA §7.
 * A RecoveryStrategy is an immutable, versioned candidate scenario. Editing
 * creates a new version. Evaluation uses an isolated overlay over a captured
 * WorldSnapshot; the strategy never mutates canonical current-world rows.
 *
 * Executable viability is a counterfactual comparison, not "every reached
 * subject is PASS". Blocking case conditions must become PASS; no reached
 * subject may be made worse; newly introduced or action-critical UNKNOWN is
 * not executable; unchanged pre-existing FAIL/UNKNOWN does not veto and is
 * not treated as healed. Stale base manifests must be reevaluated before compile.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';
import { AssessmentVerdictSchema, AssessmentResultSchema } from '../assessment/assessmentManifest.ts';
import { WorldSnapshotManifestSchema } from '../scope/readScope.ts';
import { ScenarioChangeSchema } from './scenarioChange.ts';

export const RecoveryStrategyStatusSchema = z.enum([
  'PROPOSED',
  'EVALUATED',
  'SELECTED',
  'REJECTED',
  'SUPERSEDED',
]);
export type RecoveryStrategyStatus = z.infer<typeof RecoveryStrategyStatusSchema>;

/**
 * Whether a strategy may be compiled into an ActionPlan.
 * UNKNOWN candidate assessments are never executable.
 */
export const StrategyViabilitySchema = z.enum([
  'VIABLE',
  'NOT_VIABLE',
  'NOT_EXECUTABLE',
  'STALE_BASE',
  'REJECTED',
]);
export type StrategyViability = z.infer<typeof StrategyViabilitySchema>;

export const StrategyAssumptionSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1).max(2048),
  subjectRef: TypedRefSchema.optional(),
});
export type StrategyAssumption = z.infer<typeof StrategyAssumptionSchema>;

export const RequiredUnknownSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1).max(2048),
  subjectRef: TypedRefSchema.optional(),
});
export type RequiredUnknown = z.infer<typeof RequiredUnknownSchema>;

export const SubjectAssessmentSummarySchema = z.strictObject({
  subjectRef: TypedRefSchema,
  assessmentId: SubjectIdSchema,
  overallVerdict: AssessmentVerdictSchema,
});
export type SubjectAssessmentSummary = z.infer<typeof SubjectAssessmentSummarySchema>;

export const RecoveryStrategySchema = z.strictObject({
  id: SubjectIdSchema,
  recoveryCaseId: SubjectIdSchema,
  /** Immutable content version; edits mint a new version, never rewrite this one. */
  strategyVersion: z.number().int().min(1),
  status: RecoveryStrategyStatusSchema,
  /** Manifest of the current-world snapshot this strategy was proposed against. */
  baseManifest: WorldSnapshotManifestSchema,
  basisAssessmentId: SubjectIdSchema,
  affectedSubjectRefs: z.array(TypedRefSchema).min(1),
  scenarioChange: ScenarioChangeSchema,
  assumptions: z.array(StrategyAssumptionSchema).default([]),
  requiredUnknowns: z.array(RequiredUnknownSchema).default([]),
  /** Per-subject candidate assessments produced by the same M6 registry. */
  candidateAssessments: z.array(SubjectAssessmentSummarySchema).default([]),
  /** Optional full results retained for review (bounded by caller). */
  candidateAssessmentResults: z.array(AssessmentResultSchema).default([]),
  /**
   * Whole-strategy viability after comparing overlay assessments to the same
   * subjects on the un-overlaid captured world. NOT_EXECUTABLE when a
   * required unknown remains, a blocking subject is UNKNOWN, or a reached
   * subject newly becomes UNKNOWN.
   */
  viability: StrategyViabilitySchema,
  /** Authority scopes M8 must satisfy before dispatch (represented, not granted). */
  requiredAuthorityScopes: z.array(z.string().min(1)).default([]),
  createdAt: InstantSchema,
  evaluatedAt: InstantSchema.optional(),
  rejectionReason: z.string().max(2048).optional(),
});
export type RecoveryStrategy = z.infer<typeof RecoveryStrategySchema>;

/**
 * Why a strategy is not VIABLE. Codes are closed so callers can report the
 * vetoing subjects without treating unchanged unrelated FAIL/UNKNOWN as a
 * rejection reason.
 */
export const StrategyViabilityDecisionCodeSchema = z.enum([
  'NO_SUBJECTS',
  'REQUIRED_UNKNOWNS',
  'MISSING_MUST_PASS_SUBJECT',
  'UNRESOLVED_FAIL',
  'UNRESOLVED_UNKNOWN',
  'REGRESSION_FAIL',
  'INTRODUCED_UNKNOWN',
]);
export type StrategyViabilityDecisionCode = z.infer<typeof StrategyViabilityDecisionCodeSchema>;

export interface StrategySubjectVerdict {
  subjectRef: { kind: string; id: string };
  baseline?: 'PASS' | 'FAIL' | 'UNKNOWN';
  candidate: 'PASS' | 'FAIL' | 'UNKNOWN';
  /** True when this subject is a blocking recovery condition that must become PASS. */
  mustPass: boolean;
}

export interface StrategyViabilityDecision {
  code: StrategyViabilityDecisionCode;
  subjectRef?: { kind: string; id: string };
  baseline?: 'PASS' | 'FAIL' | 'UNKNOWN';
  candidate?: 'PASS' | 'FAIL' | 'UNKNOWN';
}

export interface StrategyViabilityOutcome {
  viability: StrategyViability;
  decisions: StrategyViabilityDecision[];
}

function introducedUnknown(
  baseline: StrategySubjectVerdict['baseline'],
  candidate: StrategySubjectVerdict['candidate'],
): boolean {
  return candidate === 'UNKNOWN' && baseline !== 'UNKNOWN';
}

function regressionToFail(
  baseline: StrategySubjectVerdict['baseline'],
  candidate: StrategySubjectVerdict['candidate'],
): boolean {
  return candidate === 'FAIL' && baseline !== 'FAIL';
}

/**
 * Map per-subject baseline vs candidate M6 verdicts into strategy-level
 * viability.
 *
 * Closure answers who must be reassessed. This function answers whether the
 * candidate is an executable recovery:
 *   - every `mustPass` subject is PASS in the candidate;
 *   - no reached subject's overall verdict worsens (PASS/UNKNOWN → FAIL, or
 *     newly introduced UNKNOWN);
 *   - required unknowns remain non-executable;
 *   - unchanged FAIL/UNKNOWN on a non-must-pass subject is neither a veto
 *     nor a healing claim.
 */
export function strategyViabilityFromSubjectVerdicts(
  subjects: readonly StrategySubjectVerdict[],
  requiredUnknownCount: number,
): StrategyViabilityOutcome {
  const decisions: StrategyViabilityDecision[] = [];
  if (subjects.length === 0) {
    return { viability: 'NOT_EXECUTABLE', decisions: [{ code: 'NO_SUBJECTS' }] };
  }
  if (requiredUnknownCount > 0) {
    decisions.push({ code: 'REQUIRED_UNKNOWNS' });
  }
  for (const subject of subjects) {
    if (subject.mustPass) {
      if (subject.candidate === 'FAIL') {
        decisions.push({
          code: 'UNRESOLVED_FAIL',
          subjectRef: subject.subjectRef,
          baseline: subject.baseline,
          candidate: subject.candidate,
        });
      } else if (subject.candidate !== 'PASS') {
        decisions.push({
          code: 'UNRESOLVED_UNKNOWN',
          subjectRef: subject.subjectRef,
          baseline: subject.baseline,
          candidate: subject.candidate,
        });
      }
    } else if (regressionToFail(subject.baseline, subject.candidate)) {
      decisions.push({
        code: 'REGRESSION_FAIL',
        subjectRef: subject.subjectRef,
        baseline: subject.baseline,
        candidate: subject.candidate,
      });
    }
    if (introducedUnknown(subject.baseline, subject.candidate) && !(subject.mustPass && subject.candidate !== 'PASS')) {
      decisions.push({
        code: 'INTRODUCED_UNKNOWN',
        subjectRef: subject.subjectRef,
        baseline: subject.baseline,
        candidate: subject.candidate,
      });
    }
  }
  const viability: StrategyViability = decisions.some(
    (d) => d.code === 'UNRESOLVED_FAIL' || d.code === 'REGRESSION_FAIL',
  )
    ? 'NOT_VIABLE'
    : decisions.length > 0
      ? 'NOT_EXECUTABLE'
      : 'VIABLE';
  return { viability, decisions };
}
