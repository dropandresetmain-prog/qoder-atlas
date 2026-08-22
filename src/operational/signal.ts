/**
 * F1 — TripSignal: normalized incoming change/event (FR-04).
 * Signals never mutate state directly; they feed validated mutation proposals.
 */
import { z } from 'zod';
import { EntityIdSchema, EntityRefSchema, FactAuthoritySchema, IsoDateTimeSchema } from '../domain/common.ts';

export const SignalKindSchema = z.enum([
  'FLIGHT_CANCELLATION',
  'FLIGHT_SCHEDULE_CHANGE',
  'FLIGHT_DELAY',
  'BOOKING_STATE_CHANGE',
  'PROVIDER_EVENT',
  'WEATHER_EVENT',
  'TRAVELLER_INPUT',
  'OPERATOR_INPUT',
  /**
   * A shared AnchorEvent commitment changed (time/place/cancellation). No
   * provider state is involved: the subject is the commitment itself, and
   * fan-out turns it into ordinary per-Trip impact/recovery processing for
   * every Engagement linked via anchorCommitmentId. Never reuse a provider
   * signal kind (e.g. FLIGHT_SCHEDULE_CHANGE) for event-side changes.
   */
  'ANCHOR_COMMITMENT_CHANGE',
  'OTHER',
]);
export type SignalKind = z.infer<typeof SignalKindSchema>;

/**
 * Normalized payload shape for ANCHOR_COMMITMENT_CHANGE signals. Carried in
 * `TripSignal.payload` and validated by the programme fan-out coordinator
 * before any Trip-level processing; signals failing this shape are evidence
 * of an invalid event change, not silently reinterpreted.
 */
export const AnchorCommitmentChangePayloadSchema = z.strictObject({
  anchorEventId: EntityIdSchema,
  commitmentId: EntityIdSchema,
  changeKind: z.enum(['RESCHEDULED', 'RELOCATED', 'CANCELLED', 'OTHER']),
  newStartsAt: IsoDateTimeSchema.optional(),
  newEndsAt: IsoDateTimeSchema.optional(),
  newPlaceId: EntityIdSchema.optional(),
  summary: z.string().optional(),
});
export type AnchorCommitmentChangePayload = z.infer<typeof AnchorCommitmentChangePayloadSchema>;

export const TripSignalSchema = z.strictObject({
  id: EntityIdSchema,
  kind: SignalKindSchema,
  occurredAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema.optional(),
  /** Where the signal came from; authority gates downstream trust. */
  sourceId: EntityIdSchema,
  authority: FactAuthoritySchema,
  confidence: z.number().min(0).max(1).optional(),
  tripId: EntityIdSchema.optional(),
  /** Primary affected entity when known; UNKNOWN is acceptable. */
  subjectRef: EntityRefSchema.optional(),
  summary: z.string().optional(),
  /** Structured, provider-neutral payload (e.g. new schedule times). */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type TripSignal = z.infer<typeof TripSignalSchema>;
