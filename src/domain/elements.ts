/**
 * F1 — TripElement ontology (ADR-011).
 *
 * Importance, flexibility and reservation state are orthogonal dimensions.
 * Example the contracts must express: an airport->hotel transfer can be
 * REQUIRED + FLEXIBLE + reservation NONE (on-demand), so recovery can change
 * *how* a need is fulfilled without pretending a booking exists.
 */
import { z } from 'zod';
import {
  DurationEstimateSchema,
  EntityIdSchema,
  FactSchema,
  IsoDateTimeSchema,
} from './common.ts';

export const ImportanceSchema = z.enum(['REQUIRED', 'PREFERRED', 'OPTIONAL']);
export type Importance = z.infer<typeof ImportanceSchema>;

export const FlexibilitySchema = z.enum(['FIXED', 'CHANGEABLE', 'FLEXIBLE']);
export type Flexibility = z.infer<typeof FlexibilitySchema>;

export const ReservationStateSchema = z.enum([
  'NONE',
  'HELD',
  'CONFIRMED',
  'CHANGED',
  'CANCELLED',
  'COMPLETED',
  'UNKNOWN',
]);
export type ReservationState = z.infer<typeof ReservationStateSchema>;

/** Operational health after deterministic propagation (FR-06). */
export const ElementHealthSchema = z.enum(['VALID', 'AT_RISK', 'INVALID', 'UNKNOWN']);
export type ElementHealth = z.infer<typeof ElementHealthSchema>;

export const TransportModeSchema = z.enum([
  'FLIGHT',
  'TRAIN',
  'FERRY',
  'PUBLIC_TRANSIT',
  'TAXI_OR_RIDEHAIL',
  'PRIVATE_TRANSFER',
  'CAR_RENTAL',
  'WALKING',
  'OTHER',
]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

/** Provider-neutral booking reference; provider-specific fields live in adapters. */
export const BookingRefSchema = z.strictObject({
  system: z.string(),
  reference: z.string(),
});
export type BookingRef = z.infer<typeof BookingRefSchema>;

const TripElementBaseSchema = z.strictObject({
  id: EntityIdSchema,
  tripId: EntityIdSchema,
  importance: ImportanceSchema,
  flexibility: FlexibilitySchema,
  reservationState: ReservationStateSchema,
  /**
   * Derived by deterministic evaluation. Unevaluated elements default to
   * UNKNOWN: missing evidence must never become fabricated VALID certainty.
   */
  status: ElementHealthSchema.default('UNKNOWN'),
  dependsOn: z.array(EntityIdSchema).default([]),
  governedByRuleSetIds: z.array(EntityIdSchema).default([]),
  notes: z.string().optional(),
});

export const TransportLegSchema = TripElementBaseSchema.extend({
  elementKind: z.literal('TRANSPORT_LEG'),
  data: z.strictObject({
    mode: TransportModeSchema,
    originPlaceId: EntityIdSchema,
    destinationPlaceId: EntityIdSchema,
    /** Absent for unbooked/on-demand legs — no fabricated schedules. */
    scheduledDeparture: FactSchema(IsoDateTimeSchema).optional(),
    scheduledArrival: FactSchema(IsoDateTimeSchema).optional(),
    bookingRef: BookingRefSchema.optional(),
    /** How the need is fulfilled when no booking exists (on-demand legs). */
    durationEstimate: DurationEstimateSchema.optional(),
    carrierRef: z.strictObject({ system: z.string(), value: z.string() }).optional(),
  }),
});
export type TransportLeg = z.infer<typeof TransportLegSchema>;

export const StaySchema = TripElementBaseSchema.extend({
  elementKind: z.literal('STAY'),
  data: z.strictObject({
    placeId: EntityIdSchema,
    checkIn: FactSchema(IsoDateTimeSchema),
    checkOut: FactSchema(IsoDateTimeSchema),
    bookingRef: BookingRefSchema.optional(),
    /**
     * Generic party size staying in the room (occupancy). Absent = unknown/
     * undeclared, never inferred to 1. Enables generic accommodation-change
     * reasoning ("more people now need the room") without companion or
     * relationship semantics.
     */
    guests: z.number().int().positive().optional(),
    /** RuleSet ids for hotel/supplier policies (no-show, reception hours...). */
    policyRuleSetIds: z.array(EntityIdSchema).default([]),
  }),
});
export type Stay = z.infer<typeof StaySchema>;

export const EngagementSchema = TripElementBaseSchema.extend({
  elementKind: z.literal('ENGAGEMENT'),
  data: z.strictObject({
    title: z.string(),
    placeId: EntityIdSchema.optional(),
    startsAt: FactSchema(IsoDateTimeSchema),
    endsAt: FactSchema(IsoDateTimeSchema).optional(),
    anchorEventId: EntityIdSchema.optional(),
    /**
     * Shared programme item this engagement refers to (ADR-034). Commitment
     * changes fan out via this id; the per-traveller binding strength lives
     * in the element's own `importance`, never on the commitment itself.
     */
    anchorCommitmentId: EntityIdSchema.optional(),
    participantRole: z.string().optional(),
  }),
});
export type Engagement = z.infer<typeof EngagementSchema>;

export const TripElementSchema = z.discriminatedUnion('elementKind', [
  TransportLegSchema,
  StaySchema,
  EngagementSchema,
]);
export type TripElement = z.infer<typeof TripElementSchema>;

export const TripElementKindSchema = z.enum(['TRANSPORT_LEG', 'STAY', 'ENGAGEMENT']);
export type TripElementKind = z.infer<typeof TripElementKindSchema>;
