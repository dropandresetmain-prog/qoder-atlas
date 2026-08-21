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
  'OTHER',
]);
export type SignalKind = z.infer<typeof SignalKindSchema>;

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
