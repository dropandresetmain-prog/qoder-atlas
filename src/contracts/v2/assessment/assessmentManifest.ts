/**
 * NORTHSTAR v2 — AssessmentManifest / AssessmentResult.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.6/§6, DATA_STRUCTURE_LOGICAL_SCHEMA.md §7.
 * Assessments are immutable. PASS/FAIL/UNKNOWN remain distinct — UNKNOWN is
 * never silently promoted to PASS by absence of a matching row.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';
import { WorldSnapshotManifestSchema } from '../scope/readScope.ts';
import { CausalExplanationSchema } from './explanation.ts';

export const AssessmentVerdictSchema = z.enum(['PASS', 'FAIL', 'UNKNOWN']);
export type AssessmentVerdict = z.infer<typeof AssessmentVerdictSchema>;

export const AssessmentKindSchema = z.enum([
  'IMPACT',
  'VIABILITY',
  'ENTRY',
  'SUPPORT',
  'RISK',
  'POLICY',
]);
export type AssessmentKind = z.infer<typeof AssessmentKindSchema>;

/** Names whose eligibility/support/viability was evaluated. Distinct from the manifest's input dependencies. */
export const AssessmentSubjectSchema = z.strictObject({
  subjectRef: TypedRefSchema,
  role: z.string().min(1),
});
export type AssessmentSubject = z.infer<typeof AssessmentSubjectSchema>;

export const AssessmentDimensionSchema = z.strictObject({
  dimension: z.string().min(1),
  verdict: AssessmentVerdictSchema,
  /** Human-readable only. Consumers must use `explanations`, never parse these strings. */
  reasons: z.array(z.string()).default([]),
  /**
   * M6 additive (CONTRACTS.md §7): typed, machine-queryable causes, paths,
   * evidence and uncertainty behind this verdict (./explanation.ts).
   */
  explanations: z.array(CausalExplanationSchema).default([]),
  /** M6 additive: false when the dimension does not apply to the subject; never counted as PASS. */
  applicable: z.boolean().default(true),
  /**
   * M6 additive: whether this dimension may block the overall verdict. An
   * authorised objective loss makes that objective non-blocking; legal,
   * support and other mandatory constraint dimensions stay blocking.
   */
  blocking: z.boolean().default(true),
});
export type AssessmentDimension = z.infer<typeof AssessmentDimensionSchema>;

export const AssessmentResultSchema = z.strictObject({
  id: SubjectIdSchema,
  kind: AssessmentKindSchema,
  evaluatedAt: InstantSchema,
  manifest: WorldSnapshotManifestSchema,
  subjects: z.array(AssessmentSubjectSchema).min(1),
  overallVerdict: AssessmentVerdictSchema,
  dimensions: z.array(AssessmentDimensionSchema).default([]),
  expiresAt: InstantSchema.optional(),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

/**
 * PASS requires every dimension to PASS. Any UNKNOWN dimension makes the
 * whole result UNKNOWN unless a FAIL is also present, in which case FAIL
 * wins — a required uncertainty can never be outvoted into PASS.
 */
export function overallVerdictFromDimensions(dimensions: AssessmentDimension[]): AssessmentVerdict {
  if (dimensions.length === 0) return 'UNKNOWN';
  if (dimensions.some((d) => d.verdict === 'FAIL')) return 'FAIL';
  if (dimensions.some((d) => d.verdict === 'UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

export function isAssessmentCurrent(result: AssessmentResult, now: string): boolean {
  if (result.expiresAt === undefined) return true;
  return Date.parse(now) < Date.parse(result.expiresAt);
}
