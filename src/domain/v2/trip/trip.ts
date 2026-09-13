/**
 * NORTHSTAR v2 — Trip/Journey canonical shapes.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.2, DATA_STRUCTURE_LOGICAL_SCHEMA.md §3.
 * Trip is a shared undertaking; Journey is exactly one Traveller's independent
 * itinerary within exactly one Trip. Splitting routes midway changes
 * JourneyItems/allocations, never identity. No universal Trip itinerary and
 * no averaged eligibility.
 */
import { z } from 'zod';
import { SubjectIdSchema, WorkspaceIdSchema } from '../shared/identity.ts';
import { InstantIntervalSchema } from '../shared/time.ts';

export const LifecycleStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;

// Membership (>=1 Journey while active) is a cross-table invariant enforced
// by the command handler/DB constraint, not expressible on this shape alone.
export const TripSchema = z.strictObject({
  id: SubjectIdSchema,
  workspaceId: WorkspaceIdSchema,
  revision: z.number().int().min(1),
  purpose: z.string().min(1),
  lifecycleStatus: LifecycleStatusSchema,
  intendedWindow: InstantIntervalSchema.optional(),
  businessContextOrganisationId: SubjectIdSchema.optional(),
});
export type Trip = z.infer<typeof TripSchema>;

export const JourneySchema = z.strictObject({
  id: SubjectIdSchema,
  workspaceId: WorkspaceIdSchema,
  revision: z.number().int().min(1),
  tripId: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  lifecycleStatus: LifecycleStatusSchema,
  intendedWindow: InstantIntervalSchema.optional(),
  responsibilityOrganisationId: SubjectIdSchema.optional(),
});
export type Journey = z.infer<typeof JourneySchema>;

/** Unique (tripId, travellerId) — enforced by the target DB; validated again here for fixture tests. */
export function journeysAreUniquePerTraveller(journeys: Journey[]): boolean {
  const seen = new Set<string>();
  for (const j of journeys) {
    const key = `${j.tripId}::${j.travellerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export const JourneyItemKindSchema = z.enum(['TRANSPORT', 'STAY', 'ENGAGEMENT', 'RESOURCE_USE']);
export type JourneyItemKind = z.infer<typeof JourneyItemKindSchema>;

export const JourneyItemLifecycleSchema = z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'DROPPED']);
export type JourneyItemLifecycle = z.infer<typeof JourneyItemLifecycleSchema>;

const JourneyItemBaseSchema = z.object({
  id: SubjectIdSchema,
  journeyId: SubjectIdSchema,
  orderKey: z.string().min(1),
  lifecycleStatus: JourneyItemLifecycleSchema,
  flexible: z.boolean().default(false),
  intendedWindow: InstantIntervalSchema.optional(),
});

export const TransportItemDetailSchema = JourneyItemBaseSchema.extend({
  kind: z.literal('TRANSPORT'),
  desiredOriginPlaceId: SubjectIdSchema,
  desiredDestinationPlaceId: SubjectIdSchema,
  selectedServiceId: SubjectIdSchema.optional(), // observed fulfilment context; not owned schedule truth
}).strict();

export const StayItemDetailSchema = JourneyItemBaseSchema.extend({
  kind: z.literal('STAY'),
  intendedPlaceId: SubjectIdSchema,
  requiredNights: z.number().int().positive(),
  occupancyNeeds: z.record(z.string(), z.unknown()).optional(),
}).strict();

/**
 * Engagement references EITHER a Programme Participation OR a standalone
 * appointment — never both (DATA_STRUCTURE_LOGICAL_SCHEMA.md §3, constraint #4).
 */
export const EngagementItemDetailSchema = JourneyItemBaseSchema.extend({
  kind: z.literal('ENGAGEMENT'),
  participationId: SubjectIdSchema.optional(),
  standaloneTitle: z.string().optional(),
  standaloneWindow: InstantIntervalSchema.optional(),
})
  .strict()
  .refine(
    (v) =>
      (v.participationId !== undefined) !==
      (v.standaloneTitle !== undefined || v.standaloneWindow !== undefined),
    { message: 'engagement must reference participation XOR carry standalone appointment fields' },
  );

export const ResourceUseItemDetailSchema = JourneyItemBaseSchema.extend({
  kind: z.literal('RESOURCE_USE'),
  resourceId: SubjectIdSchema.optional(),
  intendedLocationPlaceId: SubjectIdSchema.optional(),
  useRequirements: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const JourneyItemSchema = z.discriminatedUnion('kind', [
  TransportItemDetailSchema,
  StayItemDetailSchema,
  EngagementItemDetailSchema,
  ResourceUseItemDetailSchema,
]);
export type JourneyItem = z.infer<typeof JourneyItemSchema>;

export const IntendedVisitSchema = z.strictObject({
  id: SubjectIdSchema,
  journeyId: SubjectIdSchema,
  jurisdictionId: SubjectIdSchema,
  purpose: z.string().min(1),
  intendedDates: InstantIntervalSchema,
  transitIntent: z.boolean().default(false),
});
export type IntendedVisit = z.infer<typeof IntendedVisitSchema>;

export const CredentialSelectionSchema = z.strictObject({
  id: SubjectIdSchema,
  journeyId: SubjectIdSchema,
  credentialId: SubjectIdSchema,
  credentialVersionId: SubjectIdSchema,
  scopeIntendedVisitIds: z.array(SubjectIdSchema).min(1),
  selectedByCommandId: SubjectIdSchema,
});
export type CredentialSelection = z.infer<typeof CredentialSelectionSchema>;

export const CoordinationGroupSchema = z.strictObject({
  id: SubjectIdSchema,
  workspaceId: WorkspaceIdSchema,
  revision: z.number().int().min(1),
  name: z.string().min(1),
  lifecycleStatus: LifecycleStatusSchema,
  effectiveRange: InstantIntervalSchema.optional(),
});
export type CoordinationGroup = z.infer<typeof CoordinationGroupSchema>;

export const GroupMembershipSchema = z.strictObject({
  id: SubjectIdSchema,
  coordinationGroupId: SubjectIdSchema,
  journeyId: SubjectIdSchema,
  effectiveRange: InstantIntervalSchema.optional(),
  scopeItemIds: z.array(SubjectIdSchema).optional(),
});
export type GroupMembership = z.infer<typeof GroupMembershipSchema>;
