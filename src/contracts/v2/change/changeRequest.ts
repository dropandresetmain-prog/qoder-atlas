import { z } from 'zod';
import { ChangeRequestLifecycleSchema, ChangeRequestTargetRoleSchema } from '../../../domain/v2/change/changeRequest.ts';
import { TypedRefSchema, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';

export const ChangeRequestIntentKindSchema = z.enum([
  'ADJUST_TRIP_WINDOW',
  'CHANGE_TRANSPORT_SCHEDULE',
  'CHANGE_STAY',
  'CANCEL_BOOKING',
  'ADJUST_OBJECTIVE',
  'OTHER',
]);
export type ChangeRequestIntentKind = z.infer<typeof ChangeRequestIntentKindSchema>;

export const ChangeRequestUrgencySchema = z.enum(['HARD_INSTRUCTION', 'SOFT_PREFERENCE']);
export type ChangeRequestUrgency = z.infer<typeof ChangeRequestUrgencySchema>;

export const FundingDeclarationSchema = z.enum(['EVENT_FUNDED', 'TRAVELLER_FUNDED', 'SPLIT', 'UNKNOWN']);
export type FundingDeclaration = z.infer<typeof FundingDeclarationSchema>;

const ExternalReferenceSchema = z.strictObject({
  system: z.string().min(1).max(128),
  value: z.string().min(1).max(512),
});
const Uuid = z.string().uuid();

const ObjectiveEffectSchema = z.strictObject({
  objectiveId: Uuid,
  effect: z.enum(['WAIVE', 'REPRIORITY']),
  newHardness: z.enum(['HARD', 'SOFT']).optional(),
  reason: z.string().min(1).max(2048).optional(),
});

/**
 * A declarative desired state only. UUID fields are deliberately narrow and
 * become validated, normalized target links at submission; external locators
 * remain opaque evidence for later planning.
 */
export const DesiredChangeTargetSchema = z.strictObject({
  arriveBy: InstantSchema.optional(),
  departAfter: InstantSchema.optional(),
  departureOrigin: ExternalReferenceSchema.optional(),
  preserveReturnDestination: ExternalReferenceSchema.optional(),
  preferredStayProximityPlaceId: Uuid.optional(),
  stayCheckOut: InstantSchema.optional(),
  stayPlaceExternalRef: ExternalReferenceSchema.optional(),
  preferredStayPlaceId: Uuid.optional(),
  guests: z.number().int().positive().max(64).optional(),
  travelWithTravellerIds: z.array(Uuid).max(64).default([]),
  transport: z.strictObject({
    preferDirect: z.boolean().optional(),
    earliestDeparture: InstantSchema.optional(),
    latestDeparture: InstantSchema.optional(),
  }).optional(),
  objectiveEffects: z.array(ObjectiveEffectSchema).max(64).default([]),
}).superRefine((value, ctx) => {
  const hasTransportDelta = value.transport !== undefined && Object.keys(value.transport).length > 0;
  if (!value.arriveBy && !value.departAfter && !value.departureOrigin && !value.preserveReturnDestination
    && !value.preferredStayProximityPlaceId && !value.stayCheckOut && !value.stayPlaceExternalRef
    && !value.preferredStayPlaceId && !value.guests && value.travelWithTravellerIds.length === 0
    && value.objectiveEffects.length === 0 && !hasTransportDelta) {
    ctx.addIssue({ code: 'custom', message: 'desired target must contain at least one change' });
  }
  if (new Set(value.travelWithTravellerIds).size !== value.travelWithTravellerIds.length) {
    ctx.addIssue({ code: 'custom', message: 'travelWithTravellerIds must be unique' });
  }
  const objectives = value.objectiveEffects.map((effect) => effect.objectiveId);
  if (new Set(objectives).size !== objectives.length) {
    ctx.addIssue({ code: 'custom', message: 'objectiveEffects may name each objective once' });
  }
  if (value.transport?.earliestDeparture && value.transport.latestDeparture
    && Date.parse(value.transport.earliestDeparture) > Date.parse(value.transport.latestDeparture)) {
    ctx.addIssue({ code: 'custom', path: ['transport', 'latestDeparture'], message: 'transport earliestDeparture must not be after latestDeparture' });
  }
});
export type DesiredChangeTarget = z.infer<typeof DesiredChangeTargetSchema>;

export const SubmitChangeRequestPayloadSchema = z.strictObject({
  changeRequestId: Uuid,
  representedTravellerId: Uuid,
  journeyId: Uuid,
  sourceRecordId: Uuid,
  sourceUtterance: z.string().min(1).max(16384),
  submittedAt: InstantSchema,
  intentKind: ChangeRequestIntentKindSchema,
  urgency: ChangeRequestUrgencySchema,
  desiredTarget: DesiredChangeTargetSchema,
  fundingDeclaration: FundingDeclarationSchema.optional(),
});
export type SubmitChangeRequestPayload = z.infer<typeof SubmitChangeRequestPayloadSchema>;

export interface ChangeRequestTargetLink {
  role: z.infer<typeof ChangeRequestTargetRoleSchema>;
  targetRef: TypedRef;
}

/** Deterministic bridge from the typed payload to explicit target relations. */
export function targetLinksForDesiredChange(target: DesiredChangeTarget): ChangeRequestTargetLink[] {
  const links: ChangeRequestTargetLink[] = [];
  if (target.preferredStayProximityPlaceId) links.push({ role: 'STAY_PROXIMITY_PLACE', targetRef: { kind: 'PLACE', id: target.preferredStayProximityPlaceId } });
  if (target.preferredStayPlaceId) links.push({ role: 'STAY_PLACE', targetRef: { kind: 'PLACE', id: target.preferredStayPlaceId } });
  for (const id of target.travelWithTravellerIds) links.push({ role: 'TRAVEL_WITH_TRAVELLER', targetRef: { kind: 'TRAVELLER', id } });
  for (const effect of target.objectiveEffects) links.push({ role: 'OBJECTIVE_EFFECT', targetRef: { kind: 'OBJECTIVE', id: effect.objectiveId } });
  return links.sort((a, b) => `${a.role}:${a.targetRef.id}`.localeCompare(`${b.role}:${b.targetRef.id}`));
}

export const ChangeRequestRecordSchema = z.strictObject({
  id: Uuid,
  requesterPrincipalId: Uuid,
  representedTravellerId: Uuid,
  journeyId: Uuid,
  lifecycle: ChangeRequestLifecycleSchema,
  /** Aggregate-head revision used for lifecycle CAS/currentness. */
  revision: z.number().int().min(1),
  /** Immutable submitted-content revision selected by this record. */
  contentRevision: z.number().int().min(1),
  sourceRecordId: Uuid,
  sourceUtterance: z.string(),
  submittedAt: InstantSchema,
  intentKind: ChangeRequestIntentKindSchema,
  urgency: ChangeRequestUrgencySchema,
  desiredTarget: DesiredChangeTargetSchema,
  fundingDeclaration: FundingDeclarationSchema.optional(),
  targets: z.array(z.strictObject({ role: ChangeRequestTargetRoleSchema, targetRef: TypedRefSchema })),
});
export type ChangeRequestRecord = z.infer<typeof ChangeRequestRecordSchema>;
