/**
 * NORTHSTAR v2 — M3 typed repository seams.
 *
 * These ports are intentionally narrower than a generic aggregate store. A
 * Reservation owns lines and allocations; a Journey only owns intent. External
 * records, capability observations, commercial eligibility and exact financial
 * evidence have separate owners and therefore separate methods.
 */
import type { ActorContext } from './people.ts';
import type {
  BudgetCommitment,
  CommercialAgreement,
  Offer,
  Reservation,
  ReservationAllocation,
  ReservationLine,
  Resource,
  ServiceEntitlement,
  TransportService,
} from '../../../domain/v2/arrangements/reservation.ts';
import type { ExactMoney, FxObservation } from '../../../domain/v2/shared/money.ts';
import type { Instant, InstantInterval } from '../../../domain/v2/shared/time.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';

export type TransportObservationField = 'PUBLISHED' | 'ESTIMATED' | 'ACTUAL';

export interface TransportScheduleObservation {
  field: TransportObservationField;
  departure?: Instant;
  arrival?: Instant;
  observedAt: Instant;
  evidenceId: string;
}

export type ResourceDetail =
  | { resourceType: 'VEHICLE' }
  | { resourceType: 'ROOM'; bedConfiguration?: string }
  | { resourceType: 'EQUIPMENT' };

export type ReservationLineDetail =
  | { productType: 'TRANSPORT'; transportServiceId: string }
  | {
      productType: 'STAY';
      stayInterval?: InstantInterval;
      resourceId?: string;
      placeId?: string;
      occupancy?: Record<string, unknown>;
    }
  | {
      productType: 'RESOURCE_USE';
      resourceId: string;
      useInterval?: InstantInterval;
      placeId?: string;
    };

export interface NewReservationLine {
  line: ReservationLine;
  detail: ReservationLineDetail;
  actor: ActorContext;
}

export interface ReservationLineObservation {
  observedStatus: ReservationLine['observedStatus'];
  observedStatusAt?: Instant;
  observationEvidenceId?: string;
  observedTerms?: Record<string, unknown>;
}

export interface ExternalConnectionRecord {
  id: string;
  organisationId?: string;
  providerKind: string;
  authRef?: { contentHash: string; storageRef: string; accessPolicyId: string };
  capabilityConfiguration?: Record<string, unknown>;
}

export type ExternalIdentityState =
  | 'LINKED'
  | 'UNVERIFIED'
  | 'QUARANTINED_UNKNOWN'
  | 'QUARANTINED_AMBIGUOUS';

export interface ExternalRecordRecord {
  id: string;
  connectionId: string;
  recordType: string;
  externalId: string;
  identityState: ExternalIdentityState;
  quarantineReason?: string;
  sourceSequence?: number;
  sourceVersion?: string;
  observedAt?: Instant;
  payloadHash?: string;
}

export interface ExternalRecordLinkRecord {
  id: string;
  externalRecordId: string;
  canonicalSubject: TypedRef;
  linkKind: 'SYSTEM_OF_RECORD' | 'CORRELATED' | 'OBSERVED_BY';
  evidenceId: string;
  linkedAt?: Instant;
}

export interface OwnershipBindingRecord {
  id: string;
  subject: TypedRef;
  fieldGroup: string;
  ownerKind: 'INTERNAL' | 'EXTERNAL';
  connectionId?: string;
  sourceId?: string;
  bindingState: 'PROPOSED' | 'CURRENT' | 'HISTORICAL';
  effectiveFrom: Instant;
  effectiveUntil?: Instant;
  evidenceId?: string;
}

export type ProviderCapabilityKind =
  | 'OBSERVE'
  | 'CREATE'
  | 'MODIFY'
  | 'SERVICE'
  | 'SPLIT'
  | 'CANCEL'
  | 'REFUND'
  | 'EXCHANGE';

export interface ProviderCapabilityRecord {
  id: string;
  connectionId: string;
  capabilityKind: ProviderCapabilityKind;
  recordType: string;
  supported: boolean;
  providerDetails?: Record<string, unknown>;
  observedAt: Instant;
  observationEvidenceId?: string;
}

export interface AccountingDimensionRecord {
  id: string;
  organisationId: string;
  namespace: 'COST_CENTRE' | 'PROJECT' | 'DEPARTMENT' | 'TRIP_PURPOSE' | 'CLIENT' | 'OTHER';
  externalKey: string;
  displayName: string;
  validFrom?: string;
  validUntil?: string;
}

export interface AccountingAssignmentRecord {
  id: string;
  dimensionId: string;
  subject: TypedRef;
  allocationBasis: string;
  validFrom?: Instant;
  validUntil?: Instant;
}

export interface BudgetRecord {
  id: string;
  organisationId: string;
  purpose: string;
  amount: ExactMoney;
  validFrom?: Instant;
  validUntil?: Instant;
}

export interface BudgetEntryRecord {
  id: string;
  entryKind: 'HOLD' | 'SETTLEMENT' | 'RELEASE';
  amount: ExactMoney;
  evidenceId?: string;
  entryAt?: Instant;
}

export interface CostAllocationRecord {
  id: string;
  reservationId?: string;
  /** Opaque until M8 owns action_intents. */
  actionIntentId?: string;
  payerOrganisationId?: string;
  payerTravellerId?: string;
  entryKind: 'INTENDED' | 'ACTUAL';
  amount: ExactMoney;
  fxObservationId?: string;
  accountingDimensionId?: string;
  evidenceId?: string;
  occurredAt?: Instant;
}

export interface TransportServiceRepository {
  create(params: { service: TransportService; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, serviceId: string): Promise<TransportService | undefined>;
  recordObservation(params: {
    workspaceId: string;
    serviceId: string;
    observation: TransportScheduleObservation;
    actor: ActorContext;
  }): Promise<'APPLIED' | 'STALE'>;
}

export interface ResourceRepository {
  create(params: { resource: Resource; detail: ResourceDetail; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, resourceId: string): Promise<Resource | undefined>;
}

export interface ReservationRepository {
  create(params: { reservation: Reservation; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, reservationId: string): Promise<Reservation | undefined>;
  listLines(workspaceId: string, reservationId: string): Promise<ReservationLine[]>;
  addLine(params: NewReservationLine): Promise<void>;
  recordLineObservation(params: {
    workspaceId: string;
    lineId: string;
    observation: ReservationLineObservation;
    actor: ActorContext;
  }): Promise<'APPLIED' | 'STALE'>;
  listAllocations(workspaceId: string, reservationId: string): Promise<ReservationAllocation[]>;
  addAllocation(params: { allocation: ReservationAllocation; actor: ActorContext }): Promise<void>;
  journeyItemTraveller(workspaceId: string, journeyItemId: string): Promise<string | undefined>;
}

export interface EntitlementRepository {
  create(params: { entitlement: ServiceEntitlement; actor: ActorContext }): Promise<void>;
  load(workspaceId: string, entitlementId: string): Promise<ServiceEntitlement | undefined>;
  linkLine(params: { entitlementId: string; lineId: string; componentId?: string; actor: ActorContext }): Promise<void>;
  linkTraveller(params: { entitlementId: string; travellerId: string; actor: ActorContext }): Promise<void>;
  addComponent(params: {
    id: string;
    entitlementId: string;
    componentType: string;
    componentStatus: string;
    exchangedFromComponentId?: string;
    actor: ActorContext;
  }): Promise<void>;
}

export interface OfferRepository {
  create(params: { offer: Offer; actor: ActorContext }): Promise<void>;
  addItem(params: {
    id: string;
    offerId: string;
    detail: ReservationLineDetail;
    amount: ExactMoney;
    actor: ActorContext;
  }): Promise<void>;
  addEligibility(params: {
    id: string;
    offerId: string;
    travellerId?: string;
    organisationId?: string;
    agreementScopeId?: string;
    actor: ActorContext;
  }): Promise<void>;
}

export interface CommercialAgreementRepository {
  create(params: { agreement: CommercialAgreement; actor: ActorContext }): Promise<void>;
  appendVersion(params: {
    id: string;
    agreementId: string;
    editionNumber: number;
    publishedAt: Instant;
    effectiveWindow?: InstantInterval;
    publishedTerms: Record<string, unknown>;
    actor: ActorContext;
  }): Promise<void>;
  addScope(params: {
    id: string;
    agreementVersionId: string;
    eligibleOrganisationId?: string;
    scopeKind: 'ACCOUNT' | 'NEGOTIATED_RATE' | 'CORPORATE_CODE' | 'OTHER';
    scopeReference?: string;
    validFrom?: Instant;
    validUntil?: Instant;
    actor: ActorContext;
  }): Promise<void>;
}

export interface ExternalIntegrationRepository {
  createConnection(params: { connection: ExternalConnectionRecord; actor: ActorContext }): Promise<void>;
  findRecord(params: { workspaceId: string; connectionId: string; recordType: string; externalId: string }): Promise<{ id: string } | undefined>;
  createOrObserveRecord(params: { record: ExternalRecordRecord; actor: ActorContext }): Promise<'APPLIED' | 'STALE'>;
  linkRecord(params: { link: ExternalRecordLinkRecord; actor: ActorContext }): Promise<void>;
  createOwnershipBinding(params: { binding: OwnershipBindingRecord; actor: ActorContext }): Promise<void>;
  activateOwnershipBinding(params: { bindingId: string; actor: ActorContext }): Promise<void>;
  recordCapability(params: { capability: ProviderCapabilityRecord; actor: ActorContext }): Promise<'APPLIED' | 'STALE'>;
}

export interface AccountingRepository {
  createDimension(params: { dimension: AccountingDimensionRecord; actor: ActorContext }): Promise<void>;
  assignDimension(params: { assignment: AccountingAssignmentRecord; actor: ActorContext }): Promise<void>;
  createBudget(params: { budget: BudgetRecord; actor: ActorContext }): Promise<void>;
  createCommitment(params: { commitment: BudgetCommitment; actor: ActorContext }): Promise<void>;
  addBudgetEntry(params: { workspaceId: string; commitmentId: string; entry: BudgetEntryRecord; actor: ActorContext }): Promise<void>;
  createCostAllocation(params: { allocation: CostAllocationRecord; actor: ActorContext }): Promise<void>;
  recordFxObservation(params: { observation: FxObservation; actor: ActorContext }): Promise<void>;
}

export interface ArrangementRepositories {
  transportServices: TransportServiceRepository;
  resources: ResourceRepository;
  reservations: ReservationRepository;
  entitlements: EntitlementRepository;
  offers: OfferRepository;
  agreements: CommercialAgreementRepository;
  external: ExternalIntegrationRepository;
  accounting: AccountingRepository;
}

export type { ActorContext };
