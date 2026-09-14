/**
 * M3 reverse lookups used by M6 evaluation and later servicing flows.
 *
 * Each method is workspace-scoped and returns a typed identifying tuple. The
 * query layer does not decide authority or viability and never treats a missing
 * provider capability or identity link as a positive fact.
 */
import type { ExactMoney } from '../../../domain/v2/shared/money.ts';
import type { Instant, InstantInterval } from '../../../domain/v2/shared/time.ts';
import type { ExternalIdentityState, ProviderCapabilityKind } from './arrangements.ts';

export interface ReservationAllocationHit {
  reservationId: string;
  lineId: string;
  allocationId: string;
  travellerId: string;
  journeyItemId: string | null;
  journeyId: string | null;
  tripId: string | null;
  allocationRole: string;
  quantity: number;
}

export interface ReservationLineHit {
  reservationId: string;
  lineId: string;
  productType: 'TRANSPORT' | 'STAY' | 'RESOURCE_USE';
  observedStatus: string;
  observedStatusAt: Instant | null;
  transportServiceId: string | null;
  resourceId: string | null;
  stayInterval: InstantInterval | null;
}

export interface EntitlementHit {
  entitlementId: string;
  entitlementType: 'TICKET' | 'COUPON' | 'VOUCHER';
  observedStatus: string;
  observedStatusAt: Instant | null;
  lineId: string | null;
  travellerId: string | null;
}

export interface OfferHit {
  offerId: string;
  sourceId: string;
  price: ExactMoney;
  terms: Record<string, unknown> | null;
  quotedAt: Instant;
  expiresAt: Instant;
  fingerprint: string;
  eligibleTravellerIds: string[];
  eligibleOrganisationIds: string[];
  eligibleAgreementScopeIds: string[];
}

export interface ExternalRecordHit {
  recordId: string;
  connectionId: string;
  recordType: string;
  externalId: string;
  identityState: ExternalIdentityState;
  quarantineReason: string | null;
  observedAt: Instant | null;
  canonicalSubjectId: string | null;
  canonicalSubjectKind: string | null;
}

export interface ProviderCapabilityHit {
  connectionId: string;
  capabilityKind: ProviderCapabilityKind;
  recordType: string;
  supported: boolean;
  providerDetails: Record<string, unknown> | null;
  observedAt: Instant;
  observationEvidenceId: string | null;
}

export interface CostAllocationHit {
  allocationId: string;
  reservationId: string | null;
  entryKind: 'INTENDED' | 'ACTUAL';
  amount: ExactMoney;
  fxObservationId: string | null;
  evidenceId: string | null;
  occurredAt: Instant | null;
}

export interface FxObservationHit {
  observationId: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  asOf: Instant;
  sourceId: string;
  edition: string;
  expiresAt: Instant | null;
}

export interface ArrangementReadQueries {
  allocationsForReservation(workspaceId: string, reservationId: string): Promise<ReservationAllocationHit[]>;
  linesForReservation(workspaceId: string, reservationId: string): Promise<ReservationLineHit[]>;
  linesForTransportService(workspaceId: string, serviceId: string): Promise<ReservationLineHit[]>;
  reservationsForTraveller(workspaceId: string, travellerId: string): Promise<string[]>;
  entitlementsForLine(workspaceId: string, lineId: string): Promise<EntitlementHit[]>;
  offersEligibleFor(
    workspaceId: string,
    context: { at: Instant; travellerId?: string; organisationIds?: string[]; agreementScopeIds?: string[] },
  ): Promise<OfferHit[]>;
  externalRecordsForSubject(workspaceId: string, subjectId: string, subjectKind: string): Promise<ExternalRecordHit[]>;
  quarantinedExternalRecords(workspaceId: string, connectionId?: string): Promise<ExternalRecordHit[]>;
  providerCapability(
    workspaceId: string,
    connectionId: string,
    capabilityKind: ProviderCapabilityKind,
    recordType: string,
  ): Promise<ProviderCapabilityHit | undefined>;
  costAllocationsForReservation(workspaceId: string, reservationId: string): Promise<CostAllocationHit[]>;
  fxObservationsForPair(workspaceId: string, baseCurrency: string, quoteCurrency: string, at?: Instant): Promise<FxObservationHit[]>;
}
