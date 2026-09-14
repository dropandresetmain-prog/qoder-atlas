/**
 * NORTHSTAR v2 — knowledge, provenance and requirements.
 *
 * These are domain shapes and deterministic admission helpers. They do not
 * decide entry or travel feasibility; M6 evaluates an encounter over a
 * particular Journey, credential selection, history and this captured input.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema } from '../shared/identity.ts';
import { compareInstants, InstantSchema, InstantIntervalSchema } from '../shared/time.ts';

export const ObjectiveDispositionSchema = z.enum(['ACTIVE', 'ACHIEVED', 'WAIVED', 'CLOSED_WITH_LOSS']);
export type ObjectiveDisposition = z.infer<typeof ObjectiveDispositionSchema>;

export const ObjectiveOwnerKindSchema = z.enum(['TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME']);
export type ObjectiveOwnerKind = z.infer<typeof ObjectiveOwnerKindSchema>;

export const ObjectiveSuccessPredicateKindSchema = z.enum([
  'STATEMENT',
  'ARRIVAL_BY',
  'ATTEND',
  'COMPLETE_ITEMS',
  'BOUND_SPEND',
]);
export type ObjectiveSuccessPredicateKind = z.infer<typeof ObjectiveSuccessPredicateKindSchema>;

/** Measurable target refs for an Objective (schema §6). Immutable once recorded. */
export const ObjectiveTargetSchema = z.strictObject({
  label: z.string().min(1).max(256),
  targetKind: z.enum(['SUBJECT', 'PLACE', 'TIME', 'MONEY', 'QUANTITY']),
  subject: TypedRefSchema.optional(),
  placeId: SubjectIdSchema.optional(),
  atOrBefore: InstantSchema.optional(),
  amountMinor: z.number().int().min(0).optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
});
export type ObjectiveTarget = z.infer<typeof ObjectiveTargetSchema>;

export const ObjectiveSchema = z.strictObject({
  id: SubjectIdSchema,
  ownerKind: ObjectiveOwnerKindSchema,
  ownerId: SubjectIdSchema,
  successPredicate: z.string().min(1).max(2048),
  /** Typed success predicate kind (I-7). STATEMENT remains the prose-only default. */
  successPredicateKind: ObjectiveSuccessPredicateKindSchema.default('STATEMENT'),
  hardness: z.enum(['HARD', 'SOFT']),
  priority: z.number().int().min(0),
  disposition: ObjectiveDispositionSchema.default('ACTIVE'),
  dispositionEvidenceId: SubjectIdSchema.optional(),
  targets: z.array(ObjectiveTargetSchema).default([]),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

/** Registered typed requirement. No PASS/FAIL/UNKNOWN field lives here. */
export const ConstraintDefinitionSchema = z.strictObject({
  id: SubjectIdSchema,
  registeredType: z.string().regex(/^[a-z][a-z0-9_]*$/),
  hardness: z.enum(['HARD', 'SOFT']),
  ownerRef: TypedRefSchema,
  operands: z.record(z.string(), z.unknown()),
  provenanceEvidenceId: SubjectIdSchema.optional(),
});
export type ConstraintDefinition = z.infer<typeof ConstraintDefinitionSchema>;

export const RuleSetVersionStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN']);
export type RuleSetVersionStatus = z.infer<typeof RuleSetVersionStatusSchema>;

export type RuleExpression =
  | { operator: 'ALL'; operands: RuleExpression[] }
  | { operator: 'ANY'; operands: RuleExpression[] }
  | { operator: 'NOT'; operand: RuleExpression }
  | { operator: 'PREDICATE'; predicateId: string; parameters: Record<string, unknown> };

const ruleExpressionBase: z.ZodType<RuleExpression> = z.lazy(() =>
  z.discriminatedUnion('operator', [
    z.strictObject({ operator: z.literal('ALL'), operands: z.array(ruleExpressionBase).min(1).max(32) }),
    z.strictObject({ operator: z.literal('ANY'), operands: z.array(ruleExpressionBase).min(1).max(32) }),
    z.strictObject({ operator: z.literal('NOT'), operand: ruleExpressionBase }),
    z.strictObject({
      operator: z.literal('PREDICATE'),
      predicateId: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
      parameters: z.record(z.string(), z.unknown()).default({}),
    }),
  ]),
);

const FORBIDDEN_PARAMETER_KEYS = new Set(['code', 'eval', 'expression', 'javascript', 'js', 'program', 'script', 'sql']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Bounded JSON parameters are data only; executable-looking fields are rejected. */
export function boundedRuleParameterIssue(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return 'rule parameters exceed the maximum nesting depth';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > 2048) return 'rule parameter string is too long';
    return undefined;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'rule parameters must contain finite numbers';
  if (Array.isArray(value)) {
    if (value.length > 32) return 'rule parameter arrays are limited to 32 values';
    for (const item of value) {
      const issue = boundedRuleParameterIssue(item, depth + 1);
      if (issue) return issue;
    }
    return undefined;
  }
  if (!isPlainRecord(value)) return 'rule parameters must be JSON data';
  const keys = Object.keys(value);
  if (keys.length > 32) return 'rule parameter objects are limited to 32 keys';
  for (const key of keys) {
    if (FORBIDDEN_PARAMETER_KEYS.has(key.toLowerCase())) return `executable parameter key ${key} is not allowed`;
    const issue = boundedRuleParameterIssue(value[key], depth + 1);
    if (issue) return issue;
  }
  return undefined;
}

function ruleExpressionIssue(value: unknown, depth = 0): string | undefined {
  if (depth > 32) return 'rule expression exceeds the maximum depth';
  if (!isPlainRecord(value) || typeof value.operator !== 'string') return 'rule expression must be an operator object';
  if (value.operator === 'ALL' || value.operator === 'ANY') {
    if (!Array.isArray(value.operands) || value.operands.length < 1 || value.operands.length > 32) {
      return `${value.operator} requires 1 to 32 operands`;
    }
    const keys = Object.keys(value);
    if (keys.some((key) => key !== 'operator' && key !== 'operands')) return 'rule expression contains unknown keys';
    for (const operand of value.operands) {
      const issue = ruleExpressionIssue(operand, depth + 1);
      if (issue) return issue;
    }
    return undefined;
  }
  if (value.operator === 'NOT') {
    if (!('operand' in value)) return 'NOT requires one operand';
    if (Object.keys(value).some((key) => key !== 'operator' && key !== 'operand')) return 'rule expression contains unknown keys';
    return ruleExpressionIssue(value.operand, depth + 1);
  }
  if (value.operator === 'PREDICATE') {
    if (typeof value.predicateId !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(value.predicateId)) {
      return 'PREDICATE requires a registered-safe predicate id';
    }
    if (!('parameters' in value) || !isPlainRecord(value.parameters)) return 'PREDICATE requires object parameters';
    if (Object.keys(value).some((key) => !['operator', 'predicateId', 'parameters'].includes(key))) {
      return 'rule expression contains unknown keys';
    }
    return boundedRuleParameterIssue(value.parameters);
  }
  return `unsupported rule operator ${value.operator}`;
}

/** Structural schema plus recursive bounds and executable-field rejection. */
export const RuleExpressionSchema = ruleExpressionBase.superRefine((value, context) => {
  const issue = ruleExpressionIssue(value);
  if (issue) context.addIssue({ code: 'custom', message: issue });
});

export interface RulePredicateRegistry {
  has(predicateId: string): boolean;
}

export function rulePredicateRegistry(predicateIds: Iterable<string>): RulePredicateRegistry {
  const ids = new Set(predicateIds);
  return { has: (predicateId) => ids.has(predicateId) };
}

/**
 * Deterministic admission gate. A syntactically valid predicate is not
 * executable until its evaluator has explicitly registered the identifier.
 */
export function validateRuleExpression(
  input: unknown,
  registry?: RulePredicateRegistry,
): { ok: true; value: RuleExpression } | { ok: false; issues: string[] } {
  const parsed = RuleExpressionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };
  const issues: string[] = [];
  const visit = (expression: RuleExpression): void => {
    if (expression.operator === 'PREDICATE') {
      if (registry && !registry.has(expression.predicateId)) issues.push(`predicate ${expression.predicateId} is not registered`);
      return;
    }
    if (expression.operator === 'NOT') visit(expression.operand);
    else expression.operands.forEach(visit);
  };
  visit(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data };
}

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
  ownerRef: TypedRefSchema,
  preferenceKind: z.string().min(1).max(256),
  source: z.enum(['EXPLICIT', 'INFERRED']),
  value: z.record(z.string(), z.unknown()),
  effectiveWindow: InstantIntervalSchema.optional(),
  supersedesPreferenceId: SubjectIdSchema.optional(),
  evidenceId: SubjectIdSchema.optional(),
});
export type Preference = z.infer<typeof PreferenceSchema>;

export function preferencePrecedence(source: Preference['source']): 2 | 1 {
  return source === 'EXPLICIT' ? 2 : 1;
}

export function preferExplicitPreferences<T extends Pick<Preference, 'source'>>(preferences: T[]): T[] {
  return [...preferences].sort((a, b) => preferencePrecedence(b.source) - preferencePrecedence(a.source));
}

export const SourceRecordV2Schema = z.strictObject({
  id: SubjectIdSchema,
  sourceIdentity: z.string().min(1),
  receivedAt: InstantSchema,
  contentHash: z.string().min(1),
  contentType: z.string().min(1),
  protectedLocationRef: z.string().min(1).optional(),
});
export type SourceRecordV2 = z.infer<typeof SourceRecordV2Schema>;

export const EvidenceRecordSchema = z.strictObject({
  id: SubjectIdSchema,
  assertionType: z.string().min(1),
  observedAt: InstantSchema,
  issuedAt: InstantSchema.optional(),
  schemaVersion: z.string().min(1),
  sourceIds: z.array(SubjectIdSchema).min(1),
  subjectRefs: z.array(TypedRefSchema).min(1),
  interpretationProvenance: z.string().max(2048).optional(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const InformationRecordSchema = z.strictObject({
  id: SubjectIdSchema,
  publisherOrganisationId: SubjectIdSchema.optional(),
  externalPublicationKey: z.string().min(1),
  topic: z.string().min(1),
  sourceConnectionIdentity: z.string().min(1).optional(),
});
export type InformationRecord = z.infer<typeof InformationRecordSchema>;

export const InformationVersionSubtypeSchema = z.enum(['ADVISORY', 'CONDITION', 'REGULATORY']);
export type InformationVersionSubtype = z.infer<typeof InformationVersionSubtypeSchema>;

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
  sourceNativeSeverity: z.string().max(256).optional(),
  payloadHash: z.string().min(16).optional(),
  normalizationVersion: z.string().min(1).optional(),
  regulatoryRuleSetVersionId: SubjectIdSchema.optional(),
}).superRefine((value, context) => {
  if (value.subtype === 'REGULATORY' && value.regulatoryRuleSetVersionId === undefined) {
    context.addIssue({ code: 'custom', message: 'a REGULATORY information version must reference its exact RuleSetVersion' });
  }
  if (value.supersedesInformationVersionId && value.retractsInformationVersionId) {
    context.addIssue({ code: 'custom', message: 'an information version may supersede or retract, not both' });
  }
});
export type InformationVersion = z.infer<typeof InformationVersionSchema>;

export const InformationScopeSchema = z.strictObject({
  id: SubjectIdSchema,
  informationVersionId: SubjectIdSchema,
  areaVersionId: SubjectIdSchema.optional(),
  jurisdictionId: SubjectIdSchema.optional(),
  populationPredicate: z.string().min(1).optional(),
  populationParameters: z.record(z.string(), z.unknown()).default({}),
  subjectRef: TypedRefSchema.optional(),
  purpose: z.string().max(256).optional(),
  serviceCategory: z.string().max(256).optional(),
  effectiveExposure: InstantIntervalSchema,
}).superRefine((value, context) => {
  if (!value.areaVersionId && !value.jurisdictionId && !value.populationPredicate && !value.subjectRef && !value.purpose && !value.serviceCategory) {
    context.addIssue({ code: 'custom', message: 'an information scope must contain at least one structured applicability operand' });
  }
  if (!value.populationPredicate && Object.keys(value.populationParameters).length > 0) {
    context.addIssue({ code: 'custom', message: 'population parameters require a registered population predicate' });
  }
});
export type InformationScope = z.infer<typeof InformationScopeSchema>;

export const KnowledgeCoverageCompletenessSchema = z.enum([
  'COMPLETE', 'INCOMPLETE', 'UNKNOWN', 'UNSUPPORTED_CATEGORY', 'SOURCE_UNAVAILABLE',
]);
export type KnowledgeCoverageCompleteness = z.infer<typeof KnowledgeCoverageCompletenessSchema>;

export const KnowledgeCoverageSchema = z.strictObject({
  id: SubjectIdSchema,
  queryBounds: z.record(z.string(), z.unknown()),
  queryBoundsVersion: z.string().min(1).default('knowledge-coverage/1'),
  topic: z.string().min(1),
  edition: z.string().min(1),
  watermark: z.string().optional(),
  completeness: KnowledgeCoverageCompletenessSchema.default('UNKNOWN'),
  completenessLimitations: z.array(z.string().min(1)).max(16).default([]),
  expiresAt: InstantSchema.optional(),
  evidenceId: SubjectIdSchema.optional(),
}).superRefine((value, context) => {
  if (value.completeness === 'COMPLETE' && value.completenessLimitations.length > 0) {
    context.addIssue({ code: 'custom', message: 'complete coverage cannot carry completeness limitations' });
  }
  if (value.completeness === 'UNSUPPORTED_CATEGORY' && value.completenessLimitations.length === 0) {
    context.addIssue({ code: 'custom', message: 'unsupported coverage must explain its limitation' });
  }
});
export type KnowledgeCoverage = z.infer<typeof KnowledgeCoverageSchema>;

export function informationVersionAppliesAt(version: Pick<InformationVersion, 'effectiveWindow'>, at: string): boolean {
  return version.effectiveWindow === undefined
    ? true
    : compareInstants(at, version.effectiveWindow.start) >= 0 && compareInstants(at, version.effectiveWindow.end) < 0;
}

export function informationVersionTemporalStatus(
  version: Pick<InformationVersion, 'effectiveWindow' | 'retractsInformationVersionId'>,
  at: string,
): 'EFFECTIVE' | 'FUTURE_EFFECTIVE' | 'EXPIRED' | 'RETRACTED' {
  if (version.retractsInformationVersionId) return 'RETRACTED';
  if (!version.effectiveWindow) return 'EFFECTIVE';
  if (compareInstants(at, version.effectiveWindow.start) < 0) return 'FUTURE_EFFECTIVE';
  if (compareInstants(at, version.effectiveWindow.end) >= 0) return 'EXPIRED';
  return 'EFFECTIVE';
}

export function coverageSupportsUnqualifiedPass(coverage: Pick<KnowledgeCoverage, 'completeness' | 'completenessLimitations'>): boolean {
  return coverage.completeness === 'COMPLETE' && coverage.completenessLimitations.length === 0;
}

/** Same sequence + different normalized content is a conflict, never an overwrite. */
export function informationEditionPayloadConflict(
  incoming: Pick<InformationVersion, 'externalEditionSequence' | 'payloadHash'>,
  existing: Pick<InformationVersion, 'externalEditionSequence' | 'payloadHash'> | undefined,
): boolean {
  return existing !== undefined
    && incoming.externalEditionSequence === existing.externalEditionSequence
    && incoming.payloadHash !== undefined
    && existing.payloadHash !== undefined
    && incoming.payloadHash !== existing.payloadHash;
}
