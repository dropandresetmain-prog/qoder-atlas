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

export const TravellerSchema = z.strictObject({
  id: EntityIdSchema,
  name: z.string(),
  homePlaceId: EntityIdSchema.optional(),
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
});
export type Place = z.infer<typeof PlaceSchema>;
