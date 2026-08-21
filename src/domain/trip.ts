/**
 * F1 — Trip aggregate root: objectives, relations, governance (ADR-012:
 * topology stays small; rule-like conditions live in constraints, not edges).
 */
import { z } from 'zod';
import { EntityIdSchema, EntityRefSchema, IsoDateTimeSchema } from './common.ts';
import { TripElementSchema } from './elements.ts';

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export const ObjectiveHardnessSchema = z.enum(['HARD', 'SOFT']);
export type ObjectiveHardness = z.infer<typeof ObjectiveHardnessSchema>;

export const ObjectiveStatusSchema = z.enum([
  'ACTIVE',
  'REPRIORITY',
  'WAIVED',
  'LOST',
  'ACHIEVED',
]);
export type ObjectiveStatus = z.infer<typeof ObjectiveStatusSchema>;

/**
 * What the trip is supposed to accomplish. Hard objectives can be
 * reprioritized only through an authorised explicit instruction; the
 * reprioritisation record keeps that evidence (FR-03, FR-14).
 */
export const TripObjectiveSchema = z.strictObject({
  id: EntityIdSchema,
  tripId: EntityIdSchema,
  statement: z.string(),
  hardness: ObjectiveHardnessSchema,
  status: ObjectiveStatusSchema.default('ACTIVE'),
  linkedElementIds: z.array(EntityIdSchema).default([]),
  sourceId: EntityIdSchema.optional(),
  reprioritisation: z
    .strictObject({
      at: IsoDateTimeSchema,
      by: EntityRefSchema,
      previousHardness: ObjectiveHardnessSchema,
      reason: z.string().optional(),
    })
    .optional(),
});
export type TripObjective = z.infer<typeof TripObjectiveSchema>;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/**
 * Executable relation vocabulary — deliberately minimal (ADR-012, ADR-026).
 * The prose relations PART_OF, PARTICIPATES_IN, GOVERNED_BY and COVERED_BY
 * from ARCHITECTURE.md §4 are represented by typed aggregate fields
 * (TripElement.tripId, Trip.anchorEventId, Trip.travellerIds,
 * governedByRuleSetIds, insuranceRuleSetIds, AnchorEvent.organiserOrganisationId),
 * not as edges; lanes must not reintroduce them as relations.
 */
export const TripRelationKindSchema = z.enum([
  'CONNECTS_TO',
  'DEPENDS_ON',
  'SHARES_RESOURCE_WITH',
  'REQUIRES',
]);
export type TripRelationKind = z.infer<typeof TripRelationKindSchema>;

export const TripRelationSchema = z.strictObject({
  kind: TripRelationKindSchema,
  from: EntityRefSchema,
  to: EntityRefSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type TripRelation = z.infer<typeof TripRelationSchema>;

// ---------------------------------------------------------------------------
// Trip
// ---------------------------------------------------------------------------

export const TripViabilitySchema = z.enum(['VIABLE', 'AT_RISK', 'DISRUPTED', 'RECOVERING', 'UNKNOWN']);
export type TripViability = z.infer<typeof TripViabilitySchema>;

export const TripSchema = z.strictObject({
  id: EntityIdSchema,
  label: z.string().optional(),
  travellerIds: z.array(EntityIdSchema).min(1),
  operatorOrganisationId: EntityIdSchema.optional(),
  /** Optional shared context (ADR-010); absent for plain corporate trips. */
  anchorEventId: EntityIdSchema.optional(),
  elements: z.array(TripElementSchema).default([]),
  objectives: z.array(TripObjectiveSchema).default([]),
  relations: z.array(TripRelationSchema).default([]),
  governedByRuleSetIds: z.array(EntityIdSchema).default([]),
  viability: TripViabilitySchema.default('UNKNOWN'),
  version: z.number().int().nonnegative().default(0),
  updatedAt: IsoDateTimeSchema,
});
export type Trip = z.infer<typeof TripSchema>;
