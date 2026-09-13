/**
 * NORTHSTAR v2 — services, reservations and commercial context.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.3, DATA_STRUCTURE_LOGICAL_SCHEMA.md §4.
 * A canonical Reservation owns lines and allocations once; a shared booking
 * can span Trips. Requested changes never overwrite supplier-observed fields;
 * only an accepted owner observation does.
 */
import { z } from 'zod';
import { SubjectIdSchema } from '../shared/identity.ts';
import { InstantSchema, InstantIntervalSchema } from '../shared/time.ts';
import { ExactMoneySchema } from '../shared/money.ts';

export const ObservedInstantSchema = z.strictObject({
  value: InstantSchema,
  observedAt: InstantSchema,
  sourceId: SubjectIdSchema,
});
export type ObservedInstant = z.infer<typeof ObservedInstantSchema>;

/** Published/estimated/actual are separate observed field groups — never overwrite published with estimate. */
export const TransportServiceSchema = z.strictObject({
  id: SubjectIdSchema,
  revision: z.number().int().min(1),
  mode: z.enum(['AIR', 'RAIL', 'ROAD', 'SEA']),
  operator: z.string().min(1),
  originPlaceId: SubjectIdSchema,
  destinationPlaceId: SubjectIdSchema,
  publishedDeparture: ObservedInstantSchema.optional(),
  estimatedDeparture: ObservedInstantSchema.optional(),
  actualDeparture: ObservedInstantSchema.optional(),
  publishedArrival: ObservedInstantSchema.optional(),
  estimatedArrival: ObservedInstantSchema.optional(),
  actualArrival: ObservedInstantSchema.optional(),
});
export type TransportService = z.infer<typeof TransportServiceSchema>;

export const ResourceSchema = z.strictObject({
  id: SubjectIdSchema,
  resourceType: z.enum(['VEHICLE', 'ROOM', 'EQUIPMENT']),
  placeId: SubjectIdSchema.optional(),
  capacity: z.number().int().positive().optional(),
  operatingProperties: z.record(z.string(), z.unknown()).optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

export const ReservationSchema = z.strictObject({
  id: SubjectIdSchema,
  revision: z.number().int().min(1),
  reservationType: z.enum(['TRANSPORT', 'STAY', 'RESOURCE_USE', 'MIXED']),
  responsibleOrganisationId: SubjectIdSchema.optional(),
  externalConnectionId: SubjectIdSchema.optional(),
  externalRecordId: SubjectIdSchema.optional(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const ReservationLineStatusSchema = z.enum([
  'HELD',
  'CONFIRMED',
  'CANCELLED',
  'FULFILLED',
  'UNKNOWN',
]);
export type ReservationLineStatus = z.infer<typeof ReservationLineStatusSchema>;

export const ReservationLineSchema = z.strictObject({
  id: SubjectIdSchema,
  reservationId: SubjectIdSchema,
  productType: z.enum(['TRANSPORT', 'STAY', 'RESOURCE_USE']),
  observedStatus: ReservationLineStatusSchema,
  transportServiceId: SubjectIdSchema.optional(),
  resourceId: SubjectIdSchema.optional(),
  stayInterval: InstantIntervalSchema.optional(),
  observationEvidenceId: SubjectIdSchema,
});
export type ReservationLine = z.infer<typeof ReservationLineSchema>;

/** A single reservation line can allocate to several different travellers with different roles/quantities. */
export const ReservationAllocationSchema = z.strictObject({
  id: SubjectIdSchema,
  reservationLineId: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  journeyItemId: SubjectIdSchema.optional(),
  allocationRole: z.string().min(1),
  quantity: z.number().int().positive().default(1),
});
export type ReservationAllocation = z.infer<typeof ReservationAllocationSchema>;

/**
 * Constraint checklist #5: when an allocation names a JourneyItem, that
 * item's owning Journey traveller must equal the allocation's traveller.
 */
export function allocationMatchesJourneyTraveller(
  allocation: Pick<ReservationAllocation, 'travellerId' | 'journeyItemId'>,
  journeyItemOwnerTravellerId: string | undefined,
): boolean {
  if (allocation.journeyItemId === undefined) return true;
  return journeyItemOwnerTravellerId === allocation.travellerId;
}

/** Confirmation is not issuance. Exchange preserves the predecessor's history. */
export const ServiceEntitlementSchema = z.strictObject({
  id: SubjectIdSchema,
  issuerOrganisationId: SubjectIdSchema.optional(),
  entitlementType: z.enum(['TICKET', 'COUPON', 'VOUCHER']),
  observedStatus: z.enum(['ISSUED', 'ACTIVE', 'USED', 'EXCHANGED', 'VOID', 'REVOKED']),
  protectedIdentifier: z.string().optional(),
  exchangedFromEntitlementId: SubjectIdSchema.optional(),
  evidenceId: SubjectIdSchema,
});
export type ServiceEntitlement = z.infer<typeof ServiceEntitlementSchema>;

/** Immutable quote. Never edit an old quote into a booking — capture a new one instead. */
export const OfferSchema = z.strictObject({
  id: SubjectIdSchema,
  accountId: SubjectIdSchema.optional(),
  sourceId: SubjectIdSchema,
  price: ExactMoneySchema,
  terms: z.record(z.string(), z.unknown()).optional(),
  eligiblePartyRef: SubjectIdSchema.optional(),
  quotedAt: InstantSchema,
  expiresAt: InstantSchema,
  fingerprint: z.string().min(1),
});
export type Offer = z.infer<typeof OfferSchema>;

export function isOfferExpired(offer: Offer, at: string): boolean {
  return Date.parse(at) >= Date.parse(offer.expiresAt);
}

export const CommercialAgreementSchema = z.strictObject({
  id: SubjectIdSchema,
  revision: z.number().int().min(1),
  organisationId: SubjectIdSchema,
  publishedTerms: z.record(z.string(), z.unknown()),
  eligibleAccountIds: z.array(SubjectIdSchema).default([]),
  effectiveWindow: InstantIntervalSchema.optional(),
});
export type CommercialAgreement = z.infer<typeof CommercialAgreementSchema>;

export const BudgetCommitmentStatusSchema = z.enum(['HELD', 'SETTLED', 'RELEASED']);
export type BudgetCommitmentStatus = z.infer<typeof BudgetCommitmentStatusSchema>;

/** Unknown external outcome retains its hold — never released as if the action failed. */
export const BudgetCommitmentSchema = z.strictObject({
  id: SubjectIdSchema,
  budgetId: SubjectIdSchema,
  actionIntentId: SubjectIdSchema,
  amount: ExactMoneySchema,
  status: BudgetCommitmentStatusSchema,
});
export type BudgetCommitment = z.infer<typeof BudgetCommitmentSchema>;
