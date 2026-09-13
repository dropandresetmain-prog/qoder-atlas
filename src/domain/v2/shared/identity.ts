/**
 * NORTHSTAR v2 — identity, ownership and typed-reference primitives.
 *
 * Materializes DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4/§5 and
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §1/§2: `domain_subjects` is a narrow
 * identity/ownership registry with no business payload, `aggregate_heads`
 * is the single current-revision counter per mutable root, and ordinary
 * relationships use typed references — never a generic polymorphic FK or
 * EAV bucket. This module is schema/type only; it is not imported by
 * production runtime composition during M0 (see docs/refactor/CONTRACTS.md).
 */
import { z } from 'zod';

export const WorkspaceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/);
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const SubjectIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-:.]*$/);
export type SubjectId = z.infer<typeof SubjectIdSchema>;

/**
 * Closed set of aggregate/subject kinds the identity registry recognizes.
 * Additive extensions (F16) register a new kind here plus their own typed
 * table; they never reuse an unrelated kind to avoid a migration.
 */
export const SubjectKindSchema = z.enum([
  'WORKSPACE',
  'ORGANISATION',
  'PRINCIPAL',
  'TRAVELLER',
  'TRAVELLER_RELATIONSHIP',
  'RESPONSIBILITY_ASSIGNMENT',
  'AUTHORITY_GRANT',
  'TRIP',
  'JOURNEY',
  'JOURNEY_ITEM',
  'COORDINATION_GROUP',
  'SUPPORT_ASSIGNMENT',
  'TRANSPORT_SERVICE',
  'RESOURCE',
  'RESERVATION',
  'RESERVATION_LINE',
  'SERVICE_ENTITLEMENT',
  'OFFER',
  'COMMERCIAL_AGREEMENT',
  'BUDGET',
  'EVENT',
  'PROGRAMME',
  'PROGRAMME_ITEM',
  'PARTICIPATION',
  'PLACE',
  'GEOGRAPHIC_AREA',
  'JURISDICTION',
  'OBJECTIVE',
  'CONSTRAINT_DEFINITION',
  'RULE_SET',
  'PREFERENCE',
  'SOURCE_RECORD',
  'EVIDENCE_RECORD',
  'INFORMATION_RECORD',
  'INFORMATION_VERSION',
  'EXTERNAL_CONNECTION',
  'EXTERNAL_RECORD',
  'OWNERSHIP_BINDING',
  'CHANGE_REQUEST',
  'CHANGE_SIGNAL',
  'RECOVERY_CASE',
  'RECOVERY_STRATEGY',
  'ASSESSMENT',
  'ACTION_PLAN',
  'ACTION_INTENT',
  'AUTHORITY_DECISION',
  'APPROVAL',
  'EXECUTION_ATTEMPT',
]);
export type SubjectKind = z.infer<typeof SubjectKindSchema>;

/**
 * A typed reference into the identity registry. Concrete relations still use
 * concrete typed FKs in the logical schema; this shape exists only for
 * legitimately cross-kind references (case subjects, evidence subjects,
 * assessment inputs) per DATA_STRUCTURE_LOGICAL_SCHEMA.md §1.
 */
export const TypedRefSchema = z.strictObject({
  kind: SubjectKindSchema,
  id: SubjectIdSchema,
});
export type TypedRef = z.infer<typeof TypedRefSchema>;

export function sameRef(a: TypedRef, b: TypedRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * A mutable root's single current revision counter
 * (`aggregate_heads.revision`, bigint in the physical schema — modelled here
 * as a non-negative integer contract value; revision >= 1 once created).
 */
export const RootRevisionSchema = z.strictObject({
  aggregateRef: TypedRefSchema,
  revision: z.number().int().min(1),
});
export type RootRevision = z.infer<typeof RootRevisionSchema>;

/** A command's expectation about a root's revision before it may proceed. */
export const ExpectedRevisionSchema = z.strictObject({
  aggregateRef: TypedRefSchema,
  expectedRevision: z.number().int().min(1),
});
export type ExpectedRevision = z.infer<typeof ExpectedRevisionSchema>;

/**
 * A scope's insertion/coverage generation counter (`scope_generations`).
 * Distinct from an aggregate's own revision: a matching new member, rule or
 * publication increments the scope generation even when no previously read
 * row changed (DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §6).
 */
export const ScopeKindSchema = z.enum([
  'WORKSPACE',
  'TRIP',
  'JOURNEY',
  'COORDINATION_GROUP',
  'PROGRAMME',
  'ORGANISATION_RULES',
  'ORGANISATION_GRANTS',
  'GEOGRAPHY',
  'INFORMATION_TOPIC',
]);
export type ScopeKind = z.infer<typeof ScopeKindSchema>;

export const ScopeGenerationRefSchema = z.strictObject({
  scopeKind: ScopeKindSchema,
  scopeId: SubjectIdSchema,
  generation: z.number().int().min(0),
});
export type ScopeGenerationRef = z.infer<typeof ScopeGenerationRefSchema>;

/**
 * Field-group ownership binding (`ownership_bindings`). At most one
 * `CURRENT` binding per `(subjectRef, fieldGroup)`; a `PROPOSED` binding
 * never activates by time alone — only an authorized reconciliation command
 * makes it `CURRENT` and the prior one `HISTORICAL`. No current binding does
 * not imply internal ownership.
 */
export const OwnerKindSchema = z.enum(['INTERNAL', 'EXTERNAL']);
export type OwnerKind = z.infer<typeof OwnerKindSchema>;

export const BindingStateSchema = z.enum(['PROPOSED', 'CURRENT', 'HISTORICAL']);
export type BindingState = z.infer<typeof BindingStateSchema>;

export const OwnershipBindingSchema = z.strictObject({
  id: SubjectIdSchema,
  subjectRef: TypedRefSchema,
  fieldGroup: z.string().min(1),
  ownerKind: OwnerKindSchema,
  connectionId: SubjectIdSchema.optional(),
  bindingState: BindingStateSchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
  effectiveUntil: z.iso.datetime({ offset: true }).optional(),
});
export type OwnershipBinding = z.infer<typeof OwnershipBindingSchema>;

/**
 * Protected reference to raw credential/document content. The value never
 * appears in ordinary rows, logs or prompts — only a hash and an
 * access-controlled pointer (DATA_STRUCTURE_LOGICAL_SCHEMA.md §1/§2).
 */
export const ProtectedDataRefSchema = z.strictObject({
  contentHash: z.string().min(1),
  storageRef: z.string().min(1),
  accessPolicyId: z.string().min(1),
});
export type ProtectedDataRef = z.infer<typeof ProtectedDataRefSchema>;
