/**
 * Northstar RV-N0 — programme traveller intake contract (ADR-035).
 *
 * One normalized intake surface for every onboarding path:
 *   - manual single-traveller entry
 *   - later add/update of one traveller
 *   - bulk CSV/XLSX import (adapters parse; this contract is NOT CSV-shaped)
 *   - LLM-assisted mapping from a messy event brief / traveller list
 *
 * Drafts are PRE-AUTHORITATIVE. AI or parsers may populate them from anything,
 * but only deterministic validation + an explicit promotion step (through the
 * frozen MutationService proposal path) ever creates authoritative Traveller /
 * Trip state. A draft alone can never write trip state.
 */
import { z } from 'zod';
import { DurationEstimateSchema, EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { TravelArrangementSchema, type TravelArrangement } from '../domain/entities.ts';

export { TravelArrangementSchema, type TravelArrangement };

/**
 * How this draft entered the system. Deterministic promotion rules may treat
 * provenance classes differently (e.g. LLM-mapped drafts require review),
 * but the authoritative gate is the promotion step, not this field.
 */
export const IntakeChannelSchema = z.enum([
  'MANUAL_ENTRY',
  'BULK_IMPORT',
  'LLM_MAPPED',
  'LATER_UPDATE',
]);
export type IntakeChannel = z.infer<typeof IntakeChannelSchema>;

/**
 * Deterministic identity hints used to resolve a draft against an existing
 * Traveller. None are mandatory; the promotion resolver decides matches and
 * records unresolved ambiguity as uncertainty rather than guessing.
 */
export const TravellerIdentityHintSchema = z.strictObject({
  email: z.string().optional(),
  phoneE164: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  passportNumber: z.string().optional(),
});
export type TravellerIdentityHint = z.infer<typeof TravellerIdentityHintSchema>;

/** Generic external place reference resolved against programme places. */
export const ExternalPlaceRefSchema = z.strictObject({ system: z.string(), value: z.string() });
export type ExternalPlaceRef = z.infer<typeof ExternalPlaceRefSchema>;

const ReservationStateValueSchema = z.enum([
  'NONE',
  'HELD',
  'CONFIRMED',
  'CHANGED',
  'CANCELLED',
  'COMPLETED',
  'UNKNOWN',
]);

/**
 * One declared travel item (ADR-035 extension): a flight/train leg or a stay.
 * Discriminated by `itemKind`; every field except the discriminator is
 * optional so sparse bookings are representable. No scenario or provider
 * semantics — `bookingRef` uses the neutral system/reference pair the event
 * ingress correlates against.
 */
export const DeclaredTravelItemSchema = z.discriminatedUnion('itemKind', [
  z.strictObject({
    itemKind: z.literal('TRANSPORT_LEG'),
    mode: z.string().min(1),
    originRef: ExternalPlaceRefSchema.optional(),
    destinationRef: ExternalPlaceRefSchema.optional(),
    scheduledDeparture: IsoDateTimeSchema.optional(),
    scheduledArrival: IsoDateTimeSchema.optional(),
    bookingRef: z.strictObject({ system: z.string(), reference: z.string() }).optional(),
    carrierRef: z.strictObject({ system: z.string(), value: z.string() }).optional(),
    durationEstimate: DurationEstimateSchema.optional(),
    /** Declarative element attributes from the source; defaults apply at promotion. */
    flexibility: z.enum(['FIXED', 'CHANGEABLE', 'FLEXIBLE']).default('CHANGEABLE'),
    reservationState: ReservationStateValueSchema.default('CONFIRMED'),
  }),
  z.strictObject({
    itemKind: z.literal('STAY'),
    stayPlaceRef: ExternalPlaceRefSchema.optional(),
    checkIn: IsoDateTimeSchema.optional(),
    checkOut: IsoDateTimeSchema.optional(),
    bookingRef: z.strictObject({ system: z.string(), reference: z.string() }).optional(),
    /** Generic occupancy statement (party size); no companion semantics here. */
    guests: z.number().int().positive().optional(),
    reservationState: ReservationStateValueSchema.default('CONFIRMED'),
  }),
]);
export type DeclaredTravelItem = z.infer<typeof DeclaredTravelItemSchema>;

/**
 * Organiser-declared binding strength for one of this traveller's commitments.
 * Importance lives per traveller on the Engagement (ADR-034) — never on the
 * shared commitment.
 */
export const EngagementImportanceSchema = z.strictObject({
  commitmentId: EntityIdSchema,
  role: z.string().optional(),
  importance: z.enum(['REQUIRED', 'PREFERRED', 'OPTIONAL']),
  flexibility: z.enum(['FIXED', 'CHANGEABLE', 'FLEXIBLE']),
});
export type EngagementImportance = z.infer<typeof EngagementImportanceSchema>;

/**
 * One traveller as supplied by the organiser. Every field except a display
 * name is optional so sparse/messy intake is representable; missing facts
 * become explicit uncertainty at promotion, never fabricated values.
 */
export const ProgrammeTravellerDraftSchema = z.strictObject({
  /** Draft-local id; authoritative EntityIds are assigned only at promotion. */
  draftId: EntityIdSchema,
  displayName: z.string(),
  identity: TravellerIdentityHintSchema.default({}),
  /** Home city/airport hint, free text — resolved against Place at promotion. */
  homeLocationText: z.string().optional(),
  nationalityCodes: z.array(z.string()).default([]),
  /** Accessibility statements as stated; classification happens downstream. */
  accessibilityStatements: z.array(z.string()).default([]),
  /** Free-form notes from the source (dietary, loyalty, special handling). */
  notes: z.array(z.string()).default([]),
  /** Which shared programme items this traveller participates in. */
  anchorCommitmentIds: z.array(EntityIdSchema).default([]),
  /**
   * Explicit declaration of who arranges this traveller's travel. Absent =
   * not declared: promotion records it as UNSPECIFIED uncertainty — it is
   * NEVER inferred from homeLocationText, airport codes, or fixture values.
   */
  travelArrangement: TravelArrangementSchema.optional(),
  /**
   * Declared booked/arranged transport and accommodation facts for this
   * traveller, as supplied by the source (organiser roster, confirmation
   * import). Each entry materializes at promotion as one TRANSPORT_LEG or
   * STAY element with CONNECTED authority — the draft is evidence, never
   * authoritative state. Place references use generic external-ref pairs
   * (system + value), resolved against programme places; an unresolvable ref
   * stays an explicit issue, never a guessed place.
   */
  declaredTravel: z.array(DeclaredTravelItemSchema).optional(),
  /**
   * Per-commitment importance/flexibility declarations from the organiser
   * (e.g. "this traveller HOSTS the opening, REQUIRED"). Applied to the
   * corresponding promoted Engagement; absent entries keep the intake
   * default (PREFERRED/CHANGEABLE).
   */
  engagementImportance: z.array(EngagementImportanceSchema).optional(),
});
export type ProgrammeTravellerDraft = z.infer<typeof ProgrammeTravellerDraftSchema>;

/**
 * A batch of traveller drafts for one programme, however it was produced.
 * Bulk and LLM paths both land here; equivalence between channels is a
 * promotion-time property, not a schema difference.
 */
export const ProgrammeImportDraftSchema = z.strictObject({
  id: EntityIdSchema,
  anchorEventId: EntityIdSchema,
  channel: IntakeChannelSchema,
  /** Source the drafts were produced from (uploaded file, brief, manual). */
  sourceId: EntityIdSchema,
  receivedAt: IsoDateTimeSchema,
  travellers: z.array(ProgrammeTravellerDraftSchema).default([]),
  /** Statements the mapper could not resolve into drafts. */
  unresolvedStatements: z.array(z.string()).default([]),
});
export type ProgrammeImportDraft = z.infer<typeof ProgrammeImportDraftSchema>;


/**
 * Result of deterministic promotion of one draft. Promotion is the ONLY path
 * from draft to authoritative state; failures stay as issues/uncertainty.
 */
export const PromotionOutcomeSchema = z.strictObject({
  draftId: EntityIdSchema,
  promoted: z.boolean(),
  travellerId: EntityIdSchema.optional(),
  tripId: EntityIdSchema.optional(),
  issues: z.array(z.string()).default([]),
});
export type PromotionOutcome = z.infer<typeof PromotionOutcomeSchema>;
