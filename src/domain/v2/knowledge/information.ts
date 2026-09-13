/**
 * NORTHSTAR v2 — knowledge, provenance and requirements.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.5/§7, DATA_STRUCTURE_LOGICAL_SCHEMA.md §6.
 * No universal authority ladder chooses a single world truth. Each
 * publisher owns its own continuing lineage; new editions never erase
 * dissenting sources. Coverage/freshness are first-class, separate fields.
 */
import { z } from 'zod';
import { SubjectIdSchema } from '../shared/identity.ts';
import { InstantSchema, InstantIntervalSchema } from '../shared/time.ts';

export const ObjectiveDispositionSchema = z.enum(['ACTIVE', 'ACHIEVED', 'WAIVED', 'CLOSED_WITH_LOSS']);
export type ObjectiveDisposition = z.infer<typeof ObjectiveDispositionSchema>;

export const ObjectiveOwnerKindSchema = z.enum(['TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME']);
export type ObjectiveOwnerKind = z.infer<typeof ObjectiveOwnerKindSchema>;

export const ObjectiveSchema = z.strictObject({
  id: SubjectIdSchema,
  ownerKind: ObjectiveOwnerKindSchema,
  ownerId: SubjectIdSchema,
  successPredicate: z.string().min(1),
  hardness: z.enum(['HARD', 'SOFT']),
  priority: z.number().int().min(0),
  disposition: ObjectiveDispositionSchema,
  dispositionEvidenceId: SubjectIdSchema.optional(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

/** Registered typed requirement. No PASS/FAIL/UNKNOWN field lives here — that is an Assessment. */
export const ConstraintDefinitionSchema = z.strictObject({
  id: SubjectIdSchema,
  registeredType: z.string().min(1),
  hardness: z.enum(['HARD', 'SOFT']),
  ownerRef: SubjectIdSchema,
  operands: z.record(z.string(), z.unknown()),
  provenanceEvidenceId: SubjectIdSchema.optional(),
});
export type ConstraintDefinition = z.infer<typeof ConstraintDefinitionSchema>;

export const RuleSetVersionStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN']);
export type RuleSetVersionStatus = z.infer<typeof RuleSetVersionStatusSchema>;

/** Bounded typed predicate — no eval/arbitrary script/unreviewed AI-produced rule. */
export const RuleExpressionSchema: z.ZodType<RuleExpression> = z.lazy(() =>
  z.discriminatedUnion('operator', [
    z.strictObject({ operator: z.literal('ALL'), operands: z.array(RuleExpressionSchema).min(1) }),
    z.strictObject({ operator: z.literal('ANY'), operands: z.array(RuleExpressionSchema).min(1) }),
    z.strictObject({ operator: z.literal('NOT'), operand: RuleExpressionSchema }),
    z.strictObject({
      operator: z.literal('PREDICATE'),
      predicateId: z.string().min(1),
      parameters: z.record(z.string(), z.unknown()).default({}),
    }),
  ]),
);
export type RuleExpression =
  | { operator: 'ALL'; operands: RuleExpression[] }
  | { operator: 'ANY'; operands: RuleExpression[] }
  | { operator: 'NOT'; operand: RuleExpression }
  | { operator: 'PREDICATE'; predicateId: string; parameters: Record<string, unknown> };

export const RuleSetVersionSchema = z.strictObject({
  id: SubjectIdSchema,
  ruleSetId: SubjectIdSchema,
  editionNumber: z.number().int().min(1),
  status: RuleSetVersionStatusSchema,
  effectiveWindow: InstantIntervalSchema.optional(),
  expression: RuleExpressionSchema,
});
export type RuleSetVersion = z.infer<typeof RuleSetVersionSchema>;

export const PreferenceSchema = z.strictObject({
  id: SubjectIdSchema,
  ownerRef: SubjectIdSchema,
  preferenceKind: z.string().min(1),
  source: z.enum(['EXPLICIT', 'INFERRED']),
  value: z.unknown(),
  effectiveWindow: InstantIntervalSchema.optional(),
});
export type Preference = z.infer<typeof PreferenceSchema>;

export const SourceRecordV2Schema = z.strictObject({
  id: SubjectIdSchema,
  sourceIdentity: z.string().min(1),
  receivedAt: InstantSchema,
  contentHash: z.string().min(1),
  contentType: z.string().min(1),
  protectedLocationRef: z.string().optional(),
});
export type SourceRecordV2 = z.infer<typeof SourceRecordV2Schema>;

export const EvidenceRecordSchema = z.strictObject({
  id: SubjectIdSchema,
  assertionType: z.string().min(1),
  observedAt: InstantSchema,
  issuedAt: InstantSchema.optional(),
  schemaVersion: z.string().min(1),
  sourceIds: z.array(SubjectIdSchema).min(1),
  subjectRefs: z.array(SubjectIdSchema).min(1),
  interpretationProvenance: z.string().optional(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/** Publisher-lineage root. Unique per (publisher, external publication key) upstream. */
export const InformationRecordSchema = z.strictObject({
  id: SubjectIdSchema,
  publisherOrganisationId: SubjectIdSchema.optional(),
  externalPublicationKey: z.string().min(1),
  topic: z.string().min(1),
});
export type InformationRecord = z.infer<typeof InformationRecordSchema>;

export const InformationVersionSubtypeSchema = z.enum(['ADVISORY', 'CONDITION', 'REGULATORY']);
export type InformationVersionSubtype = z.infer<typeof InformationVersionSubtypeSchema>;

/** Immutable edition. Duplicate key + different payload is a conflict, never a silent overwrite. */
export const InformationVersionSchema = z.strictObject({
  id: SubjectIdSchema,
  informationRecordId: SubjectIdSchema,
  subtype: InformationVersionSubtypeSchema,
  externalEditionSequence: z.number().int().min(0),
  issuedAt: InstantSchema,
  receivedAt: InstantSchema,
  observedAt: InstantSchema,
  effectiveWindow: InstantIntervalSchema.optional(),
  evidenceId: SubjectIdSchema,
  supersedesInformationVersionId: SubjectIdSchema.optional(),
  retractsInformationVersionId: SubjectIdSchema.optional(),
  sourceNativeSeverity: z.string().optional(),
  regulatoryRuleSetVersionId: SubjectIdSchema.optional(), // required when subtype === 'REGULATORY'
}).refine(
  (v) => v.subtype !== 'REGULATORY' || v.regulatoryRuleSetVersionId !== undefined,
  { message: 'a REGULATORY information version must reference its exact RuleSetVersion' },
);
export type InformationVersion = z.infer<typeof InformationVersionSchema>;

export const InformationScopeSchema = z.strictObject({
  informationVersionId: SubjectIdSchema,
  areaVersionId: SubjectIdSchema.optional(),
  jurisdictionId: SubjectIdSchema.optional(),
  populationPredicate: z.string().optional(),
  effectiveExposure: InstantIntervalSchema,
});
export type InformationScope = z.infer<typeof InformationScopeSchema>;

/** Evidence for what was actually checked. Incomplete coverage cannot produce an unqualified PASS. */
export const KnowledgeCoverageSchema = z.strictObject({
  id: SubjectIdSchema,
  queryBounds: z.record(z.string(), z.unknown()),
  topic: z.string().min(1),
  edition: z.string().min(1),
  watermark: z.string().optional(),
  completenessLimitations: z.array(z.string()).default([]),
  expiresAt: InstantSchema.optional(),
});
export type KnowledgeCoverage = z.infer<typeof KnowledgeCoverageSchema>;
