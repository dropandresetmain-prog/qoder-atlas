/**
 * F1 — MutationProposal with a bounded operation vocabulary (ARCHITECTURE.md
 * §8, FR-04). AI/provider input is always a proposal; deterministic services
 * validate identity/conflict/authority before any state change.
 * Unknown entity types and unknown operation kinds are rejected by schema.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  EntityRefSchema,
  EntityTypeSchema,
  IsoDateTimeSchema,
  type EntityType,
} from '../domain/common.ts';
import { ConstraintSchema } from '../domain/constraints.ts';
import { OrganisationSchema, TravellerSchema, AnchorEventSchema, PlaceSchema } from '../domain/entities.ts';
import { TripElementSchema } from '../domain/elements.ts';
import { RuleSetSchema } from '../domain/rules.ts';
import { TripSchema, TripObjectiveSchema, TripRelationSchema, ObjectiveHardnessSchema } from '../domain/trip.ts';

export const MutationOriginSchema = z.enum(['AI', 'PROVIDER', 'HUMAN', 'SYSTEM']);
export type MutationOrigin = z.infer<typeof MutationOriginSchema>;

export const MutationOperationKindSchema = z.enum([
  'UPSERT_ENTITY',
  'UPSERT_FACT',
  'ADD_RELATION',
  'REMOVE_RELATION',
  'UPSERT_CONSTRAINT',
  'WAIVE_OR_REPRIORITIZE_OBJECTIVE',
]);
export type MutationOperationKind = z.infer<typeof MutationOperationKindSchema>;

export const MutationOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('UPSERT_ENTITY'),
    entityType: EntityTypeSchema,
    /** Present for update; absent means the deterministic resolver must create identity. */
    id: EntityIdSchema.optional(),
    /** Validated against ENTITY_SCHEMA_BY_TYPE[entityType] by the mutation service. */
    data: z.unknown(),
  }),
  z.strictObject({
    op: z.literal('UPSERT_FACT'),
    target: EntityRefSchema,
    /** Dot-path of the fact field on the target entity (e.g. "data.checkIn"). */
    factPath: z.string(),
    value: z.unknown(),
    sourceId: EntityIdSchema,
    authority: z.enum(['AUTHORITATIVE', 'CONNECTED', 'ASSERTED', 'INFERRED']),
  }),
  z.strictObject({
    op: z.literal('ADD_RELATION'),
    tripId: EntityIdSchema,
    relation: TripRelationSchema,
  }),
  z.strictObject({
    op: z.literal('REMOVE_RELATION'),
    tripId: EntityIdSchema,
    relation: TripRelationSchema,
  }),
  z.strictObject({
    op: z.literal('UPSERT_CONSTRAINT'),
    constraint: ConstraintSchema,
  }),
  z.strictObject({
    op: z.literal('WAIVE_OR_REPRIORITIZE_OBJECTIVE'),
    objectiveId: EntityIdSchema,
    action: z.enum(['WAIVE', 'REPRIORITY']),
    newHardness: ObjectiveHardnessSchema.optional(),
    /** Authorised explicit instruction evidence (FR-03). */
    by: EntityRefSchema,
    reason: z.string().optional(),
  }),
]);
export type MutationOperation = z.infer<typeof MutationOperationSchema>;

export const MutationProposalSchema = z.strictObject({
  id: EntityIdSchema,
  origin: MutationOriginSchema,
  actorRef: EntityRefSchema.optional(),
  sourceId: EntityIdSchema.optional(),
  rationale: z.string().optional(),
  requestedAt: IsoDateTimeSchema,
  operations: z.array(MutationOperationSchema).min(1),
});
export type MutationProposal = z.infer<typeof MutationProposalSchema>;

/**
 * Deterministic entity-payload validation registry. The mutation service
 * validates every UPSERT_ENTITY payload against this map; entity types not
 * present here are rejected (no silent extension, no scenario-specific types).
 */
export const ENTITY_SCHEMA_BY_TYPE = {
  ORGANISATION: OrganisationSchema,
  TRAVELLER: TravellerSchema,
  ANCHOR_EVENT: AnchorEventSchema,
  TRIP: TripSchema,
  TRIP_ELEMENT: TripElementSchema,
  TRIP_OBJECTIVE: TripObjectiveSchema,
  PLACE: PlaceSchema,
  RULE_SET: RuleSetSchema,
  CONSTRAINT: ConstraintSchema,
} as const satisfies Record<EntityType, z.ZodType>;
