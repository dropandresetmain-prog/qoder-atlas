/**
 * NORTHSTAR v2 — machine-queryable assessment explanations (M6).
 *
 * Additive to the C0 AssessmentManifest contract (docs/refactor/CONTRACTS.md
 * §7). `AssessmentDimension.reasons: string[]` stays for human display, but no
 * consumer may derive meaning from it: blast radius, causal paths, failed
 * constraints and uncertainty are carried here as typed values so a UI (M9) or
 * planner (M7) renders and filters them without parsing prose.
 */
import { z } from 'zod';
import { TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';

/**
 * Closed registry of executable dependency semantics (F11). Ordinary FKs are
 * not graph edges; only a registered semantic propagates impact. Adding a
 * member is an additive architecture change with its own reader and tests.
 */
export const DependencySemanticSchema = z.enum([
  // Journey ownership / participation in a Trip.
  'JOURNEY_OF_TRAVELLER',
  'JOURNEY_IN_TRIP',
  'ITEM_OF_JOURNEY',
  // Supplier fulfilment of intent (M3 -> M2).
  'SERVICE_SELECTED_FOR_ITEM',
  'SERVICE_SUPPLIES_LINE',
  'LINE_OF_RESERVATION',
  'LINE_ALLOCATED_TO_TRAVELLER',
  'ALLOCATION_FULFILS_ITEM',
  'ENTITLEMENT_COVERS_LINE',
  // Programme (M4 -> M2).
  'PROGRAMME_ITEM_OF_PROGRAMME',
  'PARTICIPATION_IN_PROGRAMME_ITEM',
  'PARTICIPATION_OF_TRAVELLER',
  'ENGAGEMENT_REFLECTS_PARTICIPATION',
  'RESOURCE_ASSIGNED_TO_ACTIVITY',
  'RESOURCE_USED_BY_LINE',
  // Geography applicability (M4).
  'PLACE_LOCATES_ACTIVITY',
  'JURISDICTION_CONTAINS_PLACE',
  'VISIT_TO_JURISDICTION',
  // Knowledge applicability (M5).
  'INFORMATION_SCOPED_TO_JURISDICTION',
  'INFORMATION_SCOPED_TO_AREA',
  'INFORMATION_SCOPED_TO_SUBJECT',
  'RULE_ASSIGNED_TO_SUBJECT',
  'RULE_ASSIGNED_TO_ORGANISATION',
  'RULE_ASSIGNED_TO_JURISDICTION',
  'PUBLICATION_OF_RULE_SET_VERSION',
  // Support and coordination (M2).
  'SUPPORT_REQUIRED_BY_TRAVELLER',
  'SUPPORT_PROVIDED_BY_TRAVELLER',
  'GROUP_MEMBERSHIP',
  'CREDENTIAL_SELECTED_FOR_JOURNEY',
  'ORGANISATION_RESPONSIBLE_FOR',
  // Requirements owned by subjects (M5).
  'OBJECTIVE_OF_OWNER',
  'CONSTRAINT_OF_OWNER',
  // Explicit `dependencies` rows (closure §5).
  'EXPLICIT_CONNECTS_TO',
  'EXPLICIT_REQUIRES',
]);
export type DependencySemantic = z.infer<typeof DependencySemanticSchema>;

export const DependencyEdgeSchema = z.strictObject({
  semantic: DependencySemanticSchema,
  from: TypedRefSchema,
  to: TypedRefSchema,
});
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;

export const EvidenceRefKindSchema = z.enum([
  'EVIDENCE_RECORD',
  'INFORMATION_VERSION',
  'RULE_SET_VERSION',
  'KNOWLEDGE_COVERAGE',
  'SUPPLIER_OBSERVATION',
  'AGGREGATE_REVISION',
]);
export const EvidenceRefSchema = z.strictObject({
  kind: EvidenceRefKindSchema,
  id: z.string().min(1),
  /** For AGGREGATE_REVISION / SUPPLIER_OBSERVATION: which field group or revision was relied on. */
  detail: z.string().max(256).optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const UncertaintyKindSchema = z.enum([
  'MISSING_INPUT',
  'MISSING_COVERAGE',
  'INCOMPLETE_COVERAGE',
  'UNSUPPORTED_EVALUATION',
  'UNSUPPORTED_CATEGORY',
  'STALE_INPUT',
  'CONFLICTING_SOURCES',
  'UNRESOLVED_LOCATION',
  'UNKNOWN_SUPPLIER_STATE',
]);
export type UncertaintyKind = z.infer<typeof UncertaintyKindSchema>;

export const UncertaintySchema = z.strictObject({
  kind: UncertaintyKindSchema,
  /** Registered machine code, e.g. `minimum_connection_time`, `travel_history`, `payer_home_currency`. */
  code: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  subjectRef: TypedRefSchema.optional(),
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const ExplanationCauseKindSchema = z.enum([
  /** A captured fact of the world (e.g. effective arrival after a required start). */
  'WORLD_STATE',
  /** A change signal / changed subject whose consequence closure reached this subject. */
  'CHANGED_SUBJECT',
  /** An applicable requirement, rule or objective evaluated against the world. */
  'REQUIREMENT',
  /** Missing / incomplete / unsupported information. */
  'MISSING_INFORMATION',
  /** Time alone (expiry, effective date, validity threshold). */
  'CLOCK',
]);

export const ExplanationValueSchema = z.union([z.string().max(512), z.number(), z.boolean(), z.null()]);

export const CausalExplanationSchema = z.strictObject({
  /** Deterministic id: stable hash of the other fields, so re-evaluation of an identical world yields identical ids. */
  id: z.string().min(1),
  evaluatorId: z.string().min(1),
  dimension: z.string().min(1),
  status: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
  /** Registered reason code owned by the evaluator, e.g. `arrival_after_required_start`. */
  reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  cause: z.strictObject({
    kind: ExplanationCauseKindSchema,
    subjectRef: TypedRefSchema.optional(),
  }),
  affectedSubject: TypedRefSchema,
  /** Ordered from cause to affected subject; empty when the cause is the affected subject itself. */
  dependencyPath: z.array(DependencyEdgeSchema).default([]),
  /** Subjects whose state was compared (e.g. the constraint definition, the programme item, the service). */
  relatedSubjects: z.array(TypedRefSchema).default([]),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  /** Typed facts behind the verdict, e.g. `{ requiredBy: <instant>, effectiveArrival: <instant>, slackMinutes: -35 }`. */
  facts: z.record(z.string(), ExplanationValueSchema).default({}),
  uncertainty: z.array(UncertaintySchema).default([]),
  /** When this explanation stops being true by time alone, if known. */
  validUntil: InstantSchema.optional(),
});
export type CausalExplanation = z.infer<typeof CausalExplanationSchema>;
