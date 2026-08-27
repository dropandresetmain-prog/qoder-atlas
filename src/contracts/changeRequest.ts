/**
 * Northstar RV-N0 — traveller-initiated change contract (ADR-036).
 *
 * A traveller's desire is NEVER authoritative provider state. A ChangeRequest
 * declares a DESIRED TARGET STATE relative to the current authoritative Trip;
 * the shared resolution engine (signal -> impact -> plan -> overlay -> viability
 * -> authority -> execute -> observe) is the only path that can mutate booked
 * state. Provider schedules do not change merely because a traveller asked.
 *
 * The target is declarative and element-agnostic: it states desired temporal
 * windows, location proximity, and objective effects. It deliberately does NOT
 * carry element mutations, booking ids to change, or provider operations —
 * those are derived downstream by the planner against current state. This is
 * what makes the same schema express "arrive earlier + self-fund extension",
 * "later/direct flight" and "hotel closer to venue" without a hidden second
 * modification engine.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  EntityRefSchema,
  FactAuthoritySchema,
  IsoDateTimeSchema,
} from '../domain/common.ts';

/** How the traveller framed the request: binding instruction vs preference. */
export const ChangeRequestUrgencySchema = z.enum(['HARD_INSTRUCTION', 'SOFT_PREFERENCE']);
export type ChangeRequestUrgency = z.infer<typeof ChangeRequestUrgencySchema>;

/**
 * Closed vocabulary of declarative desire kinds. Each maps deterministically
 * onto target-state deltas; the kind is a routing hint, never an executor.
 */
export const ChangeRequestIntentKindSchema = z.enum([
  'ADJUST_TRIP_WINDOW', // arrive earlier / depart later / both
  'CHANGE_TRANSPORT_SCHEDULE', // later flight, direct preference...
  'CHANGE_STAY', // different property / dates / proximity
  'CANCEL_BOOKING',
  'ADJUST_OBJECTIVE', // waive or reprioritize an objective
  'OTHER',
]);
export type ChangeRequestIntentKind = z.infer<typeof ChangeRequestIntentKindSchema>;

/**
 * Declarative target-state deltas. All optional: a request may touch several.
 * `earliestArrivalBefore` / `latestDepartureAfter` widen the trip window;
 * `preferredStayProximityRef` expresses "closer to X" without coordinates;
 * `objectiveEffects` captures waive/reprioritize desires.
 */
export const ResolutionTargetSchema = z.strictObject({
  /** Desired trip-window shift; absence = keep current. */
  arriveBy: IsoDateTimeSchema.optional(),
  departAfter: IsoDateTimeSchema.optional(),
  /**
   * Declared departure-gateway substitution ("I am actually flying from X"):
   * the traveller states a different origin airport for the arrival corridor.
   * A generic external ref (system + value), never a parsed city name; the
   * planner re-plans the corridor from this gateway using ordinary evidence,
   * and an unresolvable value stays an explicit uncertainty — never guessed.
   */
  departureOrigin: z.strictObject({ system: z.string(), value: z.string() }).optional(),
  /**
   * Explicit return-destination preservation ("I will still return to LHR"):
   * a generic airport external ref. When present, origin substitution must
   * not treat a matching return leg as an unverified terminus.
   */
  preserveReturnDestination: z.strictObject({ system: z.string(), value: z.string() }).optional(),
  /** Reference place the stay should be near (e.g. venue Place id). */
  preferredStayProximityRef: EntityRefSchema.optional(),
  /** Desired stay check-out instant (extension or shortening). */
  stayCheckOut: IsoDateTimeSchema.optional(),
  /** Declared replacement property via external ref (system + value). */
  stayPlaceRef: z.strictObject({ system: z.string(), value: z.string() }).optional(),
  /** Declared replacement property via authoritative Place id. */
  preferredStayPlaceId: EntityIdSchema.optional(),
  /** Desired room occupancy; absent = unknown, never inferred. */
  guests: z.number().int().positive().optional(),
  /**
   * Requested cross-traveller association: the traveller wants to travel
   * together with the named peers (shared transport/service grouping).
   * Declarative desire only — whether the grouping is permitted is decided
   * downstream by deterministic TRANSPORT_CONCENTRATION policy against peer
   * trip state; the request itself never creates a grouping.
   */
  travelWithTravellerIds: z.array(EntityIdSchema).optional(),
  /** Desired transport attributes, declarative only. */
  transport: z
    .strictObject({
      preferDirect: z.boolean().optional(),
      earliestDeparture: IsoDateTimeSchema.optional(),
      latestDeparture: IsoDateTimeSchema.optional(),
    })
    .optional(),
  /** Objective-level desires; authority still gates the actual waiver. */
  objectiveEffects: z
    .array(
      z.strictObject({
        objectiveId: EntityIdSchema,
        effect: z.enum(['WAIVE', 'REPRIORITY']),
        newHardness: z.enum(['HARD', 'SOFT']).optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
});
export type ResolutionTarget = z.infer<typeof ResolutionTargetSchema>;

/**
 * Funding declaration attached to a request. Who the traveller expects to pay
 * for any incremental cost. Deterministic allocation (coverage windows, payer
 * rules) reconciles this against policy downstream — the declaration is a
 * desire, not an allocation.
 */
export const FundingDeclarationSchema = z.enum(['EVENT_FUNDED', 'TRAVELLER_FUNDED', 'SPLIT', 'UNKNOWN']);
export type FundingDeclaration = z.infer<typeof FundingDeclarationSchema>;

export const ChangeRequestSchema = z.strictObject({
  id: EntityIdSchema,
  tripId: EntityIdSchema,
  travellerId: EntityIdSchema,
  /** Provenance of the request; authority gates downstream trust. */
  sourceId: EntityIdSchema,
  authority: FactAuthoritySchema,
  issuedAt: IsoDateTimeSchema,
  intentKind: ChangeRequestIntentKindSchema,
  urgency: ChangeRequestUrgencySchema,
  /** The traveller's own words, preserved for audit/display. */
  utterance: z.string().optional(),
  /** Declarative desired target state; engine derives implications. */
  target: ResolutionTargetSchema,
  fundingDeclaration: FundingDeclarationSchema.optional(),
});
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;
