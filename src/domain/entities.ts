/**
 * F1 — core entities: Organisation, Traveller, AnchorEvent, Place.
 * ADR-010/ADR-011: AnchorEvent optional; behaviour derives from
 * policies/permissions, never from `if operator-type` branches.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  FactSchema,
  IsoDateTimeSchema,
} from './common.ts';

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

/**
 * Descriptive governance roles. Behaviour derives from RuleSet/permissions,
 * not from the role list itself (ARCHITECTURE.md §3).
 */
export const OrganisationRoleSchema = z.enum([
  'OPERATOR',
  'POLICY_OWNER',
  'APPROVER',
  'PAYER',
  'DUTY_OF_CARE',
  'EVENT_ORGANISER',
]);
export type OrganisationRole = z.infer<typeof OrganisationRoleSchema>;

export const OrganisationSchema = z.strictObject({
  id: EntityIdSchema,
  name: z.string(),
  roles: z.array(OrganisationRoleSchema).default([]),
  contact: z.string().optional(),
});
export type Organisation = z.infer<typeof OrganisationSchema>;

// ---------------------------------------------------------------------------
// Traveller
// ---------------------------------------------------------------------------

export const AccessibilityRequirementKindSchema = z.enum([
  'MOBILITY',
  'VISUAL',
  'HEARING',
  'COGNITIVE',
  'MEDICAL',
  'OTHER',
]);
export type AccessibilityRequirementKind = z.infer<typeof AccessibilityRequirementKindSchema>;

/** Accessibility is a requirement, never a preference (PRODUCT_SPEC). */
export const AccessibilityRequirementSchema = z.strictObject({
  id: EntityIdSchema,
  kind: AccessibilityRequirementKindSchema,
  statement: z.string(),
  sourceId: EntityIdSchema,
});
export type AccessibilityRequirement = z.infer<typeof AccessibilityRequirementSchema>;

export const PassportContextSchema = z.strictObject({
  countryCode: z.string().length(2).or(z.string().length(3)),
  expiresAt: IsoDateTimeSchema.optional(),
});
export type PassportContext = z.infer<typeof PassportContextSchema>;

/**
 * Who is responsible for arranging this traveller's travel, AS DECLARED BY
 * THE ORGANISER (or the import adapter) at intake. This is explicit
 * domain/intake truth: it must never be inferred from home-location text,
 * airport codes, or any other incidental value.
 *
 * - NORTHSTAR_ARRANGED — Northstar books and manages travel for this person.
 * - SELF_OR_OTHER_ARRANGED — the traveller (or a third party) arranges
 *   their own travel; includes local travellers who need no travel.
 * - UNSPECIFIED — not declared; stays explicit uncertainty at promotion and
 *   is reported as "unspecified" in organiser-facing counts, never guessed.
 */
export const TravelArrangementSchema = z.enum([
  'NORTHSTAR_ARRANGED',
  'SELF_OR_OTHER_ARRANGED',
  'UNSPECIFIED',
]);
export type TravelArrangement = z.infer<typeof TravelArrangementSchema>;

export const TravellerSchema = z.strictObject({
  id: EntityIdSchema,
  name: z.string(),
  homePlaceId: EntityIdSchema.optional(),
  /** Explicit intake declaration of who arranges this traveller's travel. */
  travelArrangement: TravelArrangementSchema.optional(),
  nationalityCodes: FactSchema(z.array(z.string())).optional(),
  passports: FactSchema(z.array(PassportContextSchema)).optional(),
  accessibilityRequirements: z.array(AccessibilityRequirementSchema).default([]),
  /** RuleSet ids of insurance policies covering this traveller (FR-18). */
  insuranceRuleSetIds: z.array(EntityIdSchema).default([]),
  communicationPreference: z.string().optional(),
  loyaltyContext: z.array(z.string()).default([]),
});
export type Traveller = z.infer<typeof TravellerSchema>;

// ---------------------------------------------------------------------------
// AnchorEvent
// ---------------------------------------------------------------------------

export const AnchorEventKindSchema = z.enum([
  'CONFERENCE',
  'CONCERT',
  'RETREAT',
  'TOURNAMENT',
  'WEDDING',
  'OFFSITE',
  'TRADE_MISSION',
  'OTHER',
]);
export type AnchorEventKind = z.infer<typeof AnchorEventKindSchema>;

/**
 * Generic classes of shared programme items. Deliberately event-neutral:
 * SESSION covers talks/matches/performances/meetings; SOCIAL covers meals
 * and receptions; LOGISTICS covers shared transport windows/check-ins.
 */
export const AnchorCommitmentKindSchema = z.enum(['SESSION', 'SOCIAL', 'LOGISTICS', 'OTHER']);
export type AnchorCommitmentKind = z.infer<typeof AnchorCommitmentKindSchema>;

/**
 * A shared, addressable programme item of an AnchorEvent (ADR-034). Many
 * traveller Engagements across different Trips may reference one commitment
 * via `Engagement.data.anchorCommitmentId`, so a commitment change can be
 * fanned out into ordinary per-Trip processing.
 *
 * Commitments carry NO importance/hardness: how binding a commitment is
 * differs per traveller and lives on each Engagement (`importance`), never
 * globally on the event.
 */
export const AnchorCommitmentSchema = z.strictObject({
  id: EntityIdSchema,
  anchorEventId: EntityIdSchema,
  title: z.string(),
  kind: AnchorCommitmentKindSchema.default('OTHER'),
  placeId: EntityIdSchema.optional(),
  startsAt: FactSchema(IsoDateTimeSchema),
  endsAt: FactSchema(IsoDateTimeSchema).optional(),
  sourceId: EntityIdSchema.optional(),
});
export type AnchorCommitment = z.infer<typeof AnchorCommitmentSchema>;

export const AnchorEventSchema = z.strictObject({
  id: EntityIdSchema,
  name: z.string(),
  kind: AnchorEventKindSchema,
  placeId: EntityIdSchema.optional(),
  window: z.strictObject({
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
  }),
  organiserOrganisationId: EntityIdSchema.optional(),
  /** Organiser instructions/briefing, with provenance. */
  instructions: FactSchema(z.string()).optional(),
  /** Shared programme items; trips link via Engagement.anchorCommitmentId. */
  commitments: z.array(AnchorCommitmentSchema).default([]),
  sourceIds: z.array(EntityIdSchema).default([]),
});
export type AnchorEvent = z.infer<typeof AnchorEventSchema>;

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

export const PlaceKindSchema = z.enum([
  'AIRPORT',
  'RAIL_STATION',
  'FERRY_TERMINAL',
  'HOTEL',
  'VENUE',
  'CITY',
  'DISTRICT',
  'ADDRESS',
  'OTHER',
]);
export type PlaceKind = z.infer<typeof PlaceKindSchema>;

/**
 * Relevant trip locations only — not a world geography graph
 * (ARCHITECTURE.md §3). External refs carry provider/authority codes
 * (airport codes etc.) without baking provider semantics into the domain.
 */
export const PlaceSchema = z.strictObject({
  id: EntityIdSchema,
  name: z.string().optional(),
  kind: PlaceKindSchema,
  timezone: z.string().optional(),
  coordinates: z
    .strictObject({ latitude: z.number(), longitude: z.number() })
    .optional(),
  externalRefs: z
    .array(z.strictObject({ system: z.string(), value: z.string() }))
    .default([]),
  /**
   * G3R-Closure fix C — generic transport-gateway association: this place is
   * SERVED BY the listed gateway places (Place -> servedBy -> gateway).
   * Carries no scenario semantics: an event venue can be served by an
   * AIRPORT, a hotel by a RAIL_STATION, a city by any of them. Resolution
   * stays fail-closed — an association whose target lacks the needed
   * provider-facing ref contributes nothing and is never guessed away.
   */
  servedByPlaceIds: z.array(EntityIdSchema).default([]).optional(),
});
export type Place = z.infer<typeof PlaceSchema>;
