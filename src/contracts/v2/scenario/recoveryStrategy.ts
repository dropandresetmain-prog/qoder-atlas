/**
 * NORTHSTAR v2 — RecoveryStrategy (M7).
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.6/§10, LOGICAL_SCHEMA §7.
 * A RecoveryStrategy is an immutable, versioned candidate scenario. Editing
 * creates a new version. Evaluation uses an isolated overlay over a captured
 * WorldSnapshot; the strategy never mutates canonical current-world rows.
 *
 * Executable viability requires overall PASS under the M6 registry. UNKNOWN
 * is not executable. Stale base manifests must be reevaluated before compile.
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
   * Whole-strategy viability after evaluating every affected subject reached
   * through registered dependency semantics. NOT_EXECUTABLE when any subject
   * is UNKNOWN or when required unknowns remain.
   */
  viability: StrategyViabilitySchema,
  /** Authority scopes M8 must satisfy before dispatch (represented, not granted). */
  requiredAuthorityScopes: z.array(z.string().min(1)).default([]),
  createdAt: InstantSchema,
  evaluatedAt: InstantSchema.optional(),
  rejectionReason: z.string().max(2048).optional(),
});
export type RecoveryStrategy = z.infer<typeof RecoveryStrategySchema>;

/** Map per-subject M6 verdicts into strategy-level viability. */
export function strategyViabilityFromSubjectVerdicts(
  verdicts: readonly ('PASS' | 'FAIL' | 'UNKNOWN')[],
  requiredUnknownCount: number,
): StrategyViability {
  if (verdicts.length === 0) return 'NOT_EXECUTABLE';
  if (verdicts.some((v) => v === 'FAIL')) return 'NOT_VIABLE';
  if (requiredUnknownCount > 0 || verdicts.some((v) => v === 'UNKNOWN')) return 'NOT_EXECUTABLE';
  if (verdicts.every((v) => v === 'PASS')) return 'VIABLE';
  return 'NOT_EXECUTABLE';
}
