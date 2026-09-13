/**
 * NORTHSTAR v2 — programmes and geography.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.4, DATA_STRUCTURE_LOGICAL_SCHEMA.md §5.
 * ProgrammeItem time is genuine domain state, not a copy. Participation
 * requires no Journey (local participants are first-class). Geography and
 * jurisdiction are explicitly distinct concepts.
 */
import { z } from 'zod';
import { SubjectIdSchema } from '../shared/identity.ts';
import { InstantIntervalSchema, IanaTimeZoneSchema } from '../shared/time.ts';

export const EventSchema = z.strictObject({
  id: SubjectIdSchema,
  revision: z.number().int().min(1),
  title: z.string().min(1),
  organiserOrganisationId: SubjectIdSchema.optional(),
  lifecycleStatus: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
});
export type Event = z.infer<typeof EventSchema>;

export const ProgrammeSchema = z.strictObject({
  id: SubjectIdSchema,
  revision: z.number().int().min(1),
  eventId: SubjectIdSchema,
  title: z.string().min(1),
  lifecycleStatus: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
});
export type Programme = z.infer<typeof ProgrammeSchema>;

export const ProgrammeItemLifecycleSchema = z.enum(['DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED']);
export type ProgrammeItemLifecycle = z.infer<typeof ProgrammeItemLifecycleSchema>;

export const ProgrammeItemSchema = z.strictObject({
  id: SubjectIdSchema,
  programmeId: SubjectIdSchema,
  title: z.string().min(1),
  itemType: z.string().min(1),
  placeId: SubjectIdSchema.optional(),
  window: InstantIntervalSchema.optional(),
  timeZone: IanaTimeZoneSchema.optional(),
  lifecycleStatus: ProgrammeItemLifecycleSchema,
  operatingRequirements: z.record(z.string(), z.unknown()).optional(),
});
export type ProgrammeItem = z.infer<typeof ProgrammeItemSchema>;

/** Unique (programmeItemId, travellerId). Multiple roles permitted via ParticipationRole. */
export const ParticipationSchema = z.strictObject({
  id: SubjectIdSchema,
  programmeItemId: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  obligation: z.enum(['REQUIRED', 'OPTIONAL', 'INFORMED']),
  preparationWindow: InstantIntervalSchema.optional(),
  releaseWindow: InstantIntervalSchema.optional(),
  accepted: z.boolean().default(false),
  attended: z.boolean().optional(),
});
export type Participation = z.infer<typeof ParticipationSchema>;

export const ParticipationRoleSchema = z.strictObject({
  participationId: SubjectIdSchema,
  role: z.string().min(1),
});
export type ParticipationRole = z.infer<typeof ParticipationRoleSchema>;

/** References the schedule owner's window rather than copying it as a second truth. */
export const ResourceAssignmentSchema = z.strictObject({
  id: SubjectIdSchema,
  activityId: SubjectIdSchema, // ProgrammeItem or JourneyItem id, kind-checked at command time
  resourceId: SubjectIdSchema,
  quantity: z.number().int().positive().default(1),
  lifecycleStatus: z.enum(['PROPOSED', 'CONFIRMED', 'RELEASED']),
});
export type ResourceAssignment = z.infer<typeof ResourceAssignmentSchema>;

export const PlaceSchema = z.strictObject({
  id: SubjectIdSchema,
  name: z.string().min(1),
  placeType: z.string().min(1),
  timeZone: IanaTimeZoneSchema,
  coordinates: z.strictObject({ lat: z.number(), lng: z.number() }).optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Versioned geometry editions preserve geography history; PostGIS geometry/CRS contract is settled at M1. */
export const GeographicAreaVersionSchema = z.strictObject({
  id: SubjectIdSchema,
  areaId: SubjectIdSchema,
  validFrom: z.iso.date(),
  validUntil: z.iso.date().optional(),
  geometryRef: z.string().min(1), // opaque pointer to the PostGIS geometry payload at M1
  evidenceId: SubjectIdSchema,
});
export type GeographicAreaVersion = z.infer<typeof GeographicAreaVersionSchema>;

/** Legal/entry regime — explicitly distinct from a geographic country code or an airport. */
export const JurisdictionSchema = z.strictObject({
  id: SubjectIdSchema,
  name: z.string().min(1),
  regimeKind: z.enum(['COUNTRY', 'SUPRANATIONAL', 'SUBNATIONAL']),
});
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

export const JurisdictionAreaSchema = z.strictObject({
  jurisdictionId: SubjectIdSchema,
  areaVersionId: SubjectIdSchema,
  validFrom: z.iso.date(),
  validUntil: z.iso.date().optional(),
});
export type JurisdictionArea = z.infer<typeof JurisdictionAreaSchema>;
