/**
 * D2/D3 — strict Zod schemas for every Model Studio output consumed by the
 * intelligence lane (FR-03, FR-07, FR-17). All schemas are strict: unknown
 * keys (e.g. an attempted ActionIntent field) are rejected, and every
 * rejection fails closed — invalid model output is never repaired by
 * guessing (NFR-03).
 */
import { z } from 'zod';
import { EntityRefSchema } from '../domain/common.ts';
import { PreferenceOriginKindSchema } from '../domain/preferences.ts';
import { MutationOperationSchema } from '../operational/mutation.ts';
import { CapabilityFamilySchema, ToolOperationSchema } from '../operational/strategy.ts';

// ---------------------------------------------------------------------------
// D2 — interpretation outputs
// ---------------------------------------------------------------------------

export const ObjectiveInterpretationModelSchema = z.strictObject({
  /** Absent when the input carries no recoverable objective. */
  objective: z.string().optional(),
  /** True when the traveller/operator stated the objective explicitly. */
  explicit: z.boolean(),
  /** Origin class of an explicit statement; absent for latent readings. */
  originKind: PreferenceOriginKindSchema.optional(),
  ambiguities: z.array(z.string()).default([]),
  insufficientEvidence: z.boolean().default(false),
});
export type ObjectiveInterpretationModel = z.infer<typeof ObjectiveInterpretationModelSchema>;

export const ExplicitInstructionModelSchema = z.strictObject({
  statement: z.string(),
  /** What the instruction asks to happen (verb phrase). */
  action: z.string(),
  subjectRef: EntityRefSchema.optional(),
  /** True when no actionable instruction exists in the input. */
  none: z.boolean().default(false),
});
export type ExplicitInstructionModel = z.infer<typeof ExplicitInstructionModelSchema>;

export const ExplicitInstructionsModelSchema = z.strictObject({
  instructions: z.array(ExplicitInstructionModelSchema).default([]),
});
export type ExplicitInstructionsModel = z.infer<typeof ExplicitInstructionsModelSchema>;

/**
 * Accessibility and legal/entry items are REQUIREMENTS (constraints), never
 * latent preferences — the classifier must mark them, and deterministic
 * resolution reclassifies them defensively regardless.
 */
export const PreferenceClassificationSchema = z.enum([
  'COMFORT_PREFERENCE',
  'ACCESSIBILITY_REQUIREMENT',
  'LEGAL_OR_ENTRY_REQUIREMENT',
]);
export type PreferenceClassification = z.infer<typeof PreferenceClassificationSchema>;

export const PreferenceCandidateModelSchema = z.strictObject({
  classification: PreferenceClassificationSchema,
  statement: z.string(),
  /** Observable evidence for a latent inference; quote for explicit text. */
  evidence: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  /** Explicit statements this candidate conflicts with, when any. */
  conflictsWith: z.array(z.string()).default([]),
});
export type PreferenceCandidateModel = z.infer<typeof PreferenceCandidateModelSchema>;

export const LatentPreferenceCandidatesModelSchema = z.strictObject({
  candidates: z.array(PreferenceCandidateModelSchema).default([]),
  requirementStatements: z.array(z.string()).default([]),
});
export type LatentPreferenceCandidatesModel = z.infer<typeof LatentPreferenceCandidatesModelSchema>;

export const ConsequenceImpactSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
export type ConsequenceImpact = z.infer<typeof ConsequenceImpactSchema>;

export const ConsequenceAssessmentModelSchema = z.strictObject({
  subjectRef: EntityRefSchema.optional(),
  consequence: z.string(),
  impact: ConsequenceImpactSchema,
  confidence: z.number().min(0).max(1).optional(),
  /** Semantic judgments retain their uncertainty; never asserted as fact. */
  uncertainty: z.string().optional(),
});
export type ConsequenceAssessmentModel = z.infer<typeof ConsequenceAssessmentModelSchema>;

export const ConsequenceAssessmentsModelSchema = z.strictObject({
  assessments: z.array(ConsequenceAssessmentModelSchema).default([]),
});
export type ConsequenceAssessmentsModel = z.infer<typeof ConsequenceAssessmentsModelSchema>;

export const UncertaintyStatementModelSchema = z.strictObject({
  statement: z.string(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  aboutRef: EntityRefSchema.optional(),
});
export type UncertaintyStatementModel = z.infer<typeof UncertaintyStatementModelSchema>;

export const UncertaintyIdentificationModelSchema = z.strictObject({
  uncertainties: z.array(UncertaintyStatementModelSchema).default([]),
});
export type UncertaintyIdentificationModel = z.infer<typeof UncertaintyIdentificationModelSchema>;

// ---------------------------------------------------------------------------
// D2 — research outputs
// ---------------------------------------------------------------------------

export const ResearchFindingKindSchema = z.enum(['LEGAL_ENTRY_FACT', 'OPERATIONAL_ESTIMATE']);
export type ResearchFindingKind = z.infer<typeof ResearchFindingKindSchema>;

export const ResearchFindingAuthorityClaimSchema = z.enum(['AUTHORITATIVE', 'CONNECTED', 'ASSERTED', 'INFERRED']);
export type ResearchFindingAuthorityClaim = z.infer<typeof ResearchFindingAuthorityClaimSchema>;

export const RawResearchFindingModelSchema = z.strictObject({
  statement: z.string(),
  kind: ResearchFindingKindSchema,
  authorityClaim: ResearchFindingAuthorityClaimSchema,
  /** Sources backing the statement; legal facts additionally require them. */
  sourceUris: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  uncertainty: z.string().optional(),
});
export type RawResearchFindingModel = z.infer<typeof RawResearchFindingModelSchema>;

export const RawResearchFindingsModelSchema = z.strictObject({
  findings: z.array(RawResearchFindingModelSchema).default([]),
  insufficientEvidence: z.boolean().default(false),
});
export type RawResearchFindingsModel = z.infer<typeof RawResearchFindingsModelSchema>;

// ---------------------------------------------------------------------------
// D3 — planner output (validated before ids/timestamps are assigned
// deterministically, then mapped onto the frozen F2 PlannerOutput contract)
// ---------------------------------------------------------------------------

/** The planner asks the orchestrator to fulfil these; ids are assigned here. */
export const PlannerToolRequestModelSchema = z.strictObject({
  capability: CapabilityFamilySchema,
  operation: ToolOperationSchema,
  parameters: z.record(z.string(), z.unknown()).default({}),
  purpose: z.string(),
});
export type PlannerToolRequestModel = z.infer<typeof PlannerToolRequestModelSchema>;

/**
 * Candidate operations are hypothetical overlay operations only (FR-09). The
 * mutation service validates payloads before any state change; the planner
 * never touches authoritative state.
 */
export const PlannerCandidateOperationModelSchema = MutationOperationSchema;
export type PlannerCandidateOperationModel = z.infer<typeof PlannerCandidateOperationModelSchema>;

export const PlannerStrategyModelSchema = z.strictObject({
  summary: z.string(),
  candidateOperations: z.array(PlannerCandidateOperationModelSchema).default([]),
  toolRequests: z.array(PlannerToolRequestModelSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  expectedOutcomes: z.array(z.string()).default([]),
  costImpact: z
    .strictObject({
      amount: z.number(),
      currency: z.string().length(3),
    })
    .optional(),
});
export type PlannerStrategyModel = z.infer<typeof PlannerStrategyModelSchema>;

export const PlannerUncertaintyModelSchema = z.strictObject({
  statement: z.string(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  aboutRef: EntityRefSchema.optional(),
});
export type PlannerUncertaintyModel = z.infer<typeof PlannerUncertaintyModelSchema>;

export const PlannerModelOutputSchema = z.strictObject({
  strategies: z.array(PlannerStrategyModelSchema).default([]),
  toolRequests: z.array(PlannerToolRequestModelSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  uncertainties: z.array(PlannerUncertaintyModelSchema).default([]),
  rationale: z.string().optional(),
});
export type PlannerModelOutput = z.infer<typeof PlannerModelOutputSchema>;
