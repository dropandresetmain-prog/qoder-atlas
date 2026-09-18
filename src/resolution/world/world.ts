/**
 * NORTHSTAR M6 — captured world slice.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.2: a read-only, internally consistent
 * world captured inside ONE PostgreSQL snapshot (REPEATABLE READ, READ ONLY),
 * plus the complete manifest of what was read. Pure evaluators consume this
 * value only; they never read a repository. Every field is JSON-compatible so
 * a snapshot can be persisted, replayed and diffed.
 *
 * Rows are the canonical owners' state, not copies: Journey/JourneyItem carry
 * intent, TransportService/ReservationLine carry supplier observations,
 * ProgrammeItem carries the programme schedule, InformationVersion carries
 * publisher knowledge. Effective views are derived later (effectiveItinerary).
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { WorldSnapshotManifest } from '../../contracts/v2/scope/readScope.ts';
import type { DependencyEdge } from '../../contracts/v2/assessment/explanation.ts';
import type { RuleExpression } from '../../domain/v2/knowledge/information.ts';
import type { ExternalRef } from '../../contracts/capabilities.ts';

export const WORLD_MODEL_VERSION = 'm6-world/1';

export interface WorldCapture {
  isolation: 'REPEATABLE_READ';
  readOnly: true;
  /** `pg_current_snapshot()` of the read transaction — evidence that every row came from one snapshot. */
  databaseSnapshot: string;
  capturedAt: Instant;
  modelVersion: string;
}

/** ---- people ---------------------------------------------------------- */
export interface WTraveller { id: string; revision: number; lifecycleStatus: string }
export interface WProfileAssertion { id: string; travellerId: string; assertionType: string; effectiveFrom: string; effectiveTo: string | null; value: Record<string, unknown>; evidenceId: string; superseded: boolean }
export interface WCredential { id: string; travellerId: string; kind: string; issuerCountry: string; currentVersionId: string }
export interface WCredentialVersion {
  id: string; credentialId: string; kind: string; editionNumber: number; issueDate: string; expiryDate: string | null;
  issuerStatus: string; physicallyAvailable: boolean | null; evidenceId: string;
  /** Typed detail fields relevant to entry; never the protected document number. */
  issuingStateCode: string | null; visaClass: string | null; permittedActivities: string[]; entriesAllowed: number | null; permittedStayDays: number | null;
}
export interface WCredentialLink { credentialId: string; relatedCredentialId: string; travellerId: string; linkType: string; effectiveFrom: string; effectiveTo: string | null; evidenceId: string }
export interface WTravelHistory { id: string; travellerId: string; jurisdictionId: string; entryDate: string | null; exitDate: string | null; coverageClaim: string; evidenceId: string }
export interface WOrganisation { id: string; revision: number; defaultCurrencyCode: string | null }

/** ---- travel ---------------------------------------------------------- */
export interface WTrip { id: string; revision: number; purpose: string; lifecycleStatus: string; intendedWindow: { start: Instant; end: Instant } | null; businessContextOrganisationId: string | null }
export interface WJourney { id: string; revision: number; tripId: string; travellerId: string; lifecycleStatus: string; intendedWindow: { start: Instant; end: Instant } | null; responsibilityOrganisationId: string | null }
export interface WJourneyItem {
  id: string; journeyId: string; kind: 'TRANSPORT' | 'STAY' | 'ENGAGEMENT' | 'RESOURCE_USE'; orderKey: string; lifecycleStatus: string; flexible: boolean;
  intendedWindow: { start: Instant; end: Instant } | null;
  desiredOriginPlaceId: string | null; desiredDestinationPlaceId: string | null; selectedServiceId: string | null;
  intendedPlaceId: string | null; requiredNights: number | null;
  participationId: string | null; standaloneTitle: string | null; standaloneWindow: { start: Instant; end: Instant } | null;
  resourceId: string | null; intendedLocationPlaceId: string | null;
}
export interface WIntendedVisit { id: string; journeyId: string; jurisdictionId: string; purpose: string; intended: { start: Instant; end: Instant }; transitIntent: boolean }
export interface WCredentialSelection { id: string; journeyId: string; credentialId: string; credentialVersionId: string; intendedVisitIds: string[] }
export interface WCoordinationGroup { id: string; revision: number; name: string; lifecycleStatus: string; effective: { start: Instant | null; end: Instant | null } }
export interface WGroupMembership { id: string; groupId: string; journeyId: string; effective: { start: Instant | null; end: Instant | null }; scopeItemIds: string[] }
export interface WAccompanimentRequirement { id: string; version: number; supportedTravellerId: string; coverage: { start: Instant; end: Instant }; minimumSimultaneousSupporters: number; maximumHandoffGapMinutes: number; eligibleSupporterTravellerIds: string[]; provenanceEvidenceId: string | null; latestVersion: boolean }
export interface WSupportAssignment { id: string; revision: number; requirementId: string; requirementVersion: number; lifecycleStatus: string; assigneeTravellerIds: string[]; scopes: { supporterTravellerId: string; start: Instant; end: Instant }[]; handoffs: { fromSupporterTravellerId: string; toSupporterTravellerId: string; at: Instant }[] }

/** ---- arrangements ---------------------------------------------------- */
export interface WObservedTime { value: Instant; observedAt: Instant; evidenceId: string | null }
export interface WTransportService {
  id: string; revision: number; mode: string; operator: string; originPlaceId: string; destinationPlaceId: string;
  published: { departure: WObservedTime | null; arrival: WObservedTime | null };
  estimated: { departure: WObservedTime | null; arrival: WObservedTime | null };
  actual: { departure: WObservedTime | null; arrival: WObservedTime | null };
  /** Planning-only provider evidence. Never a canonical service or booking. */
  researchedOffer?: {
    rawOfferId: string;
    providerId?: string;
    provenance: { mode: 'LIVE' | 'RECORD' | 'REPLAY' | 'INTERNAL'; observedAt: Instant; sourceRefs: string[]; recordingRef?: string };
    commercial: { amount: number; currency: string; availability: 'AVAILABLE' | 'LIMITED' | 'UNKNOWN'; fareFamily?: string; expiresAt?: Instant };
    segments: readonly { carrierCode?: string; flightNumber?: string; origin: ExternalRef; destination: ExternalRef; departure: Instant; arrival: Instant; cabin?: string }[];
    uncertainty: readonly { code: string; summary: string }[];
  };
}
export interface WResource { id: string; revision: number; resourceType: string; locationPlaceId: string | null; capacity: number | null }
export interface WReservation { id: string; revision: number; reservationType: string; observedStatus: string; observedStatusAt: Instant | null; responsibleOrganisationId: string | null; responsibleTravellerId: string | null }
export interface WReservationLine {
  id: string; reservationId: string; productType: 'TRANSPORT' | 'STAY' | 'RESOURCE_USE'; observedStatus: string; observedStatusAt: Instant | null; evidenceId: string | null;
  transportServiceId: string | null; resourceId: string | null; placeId: string | null; interval: { start: Instant; end: Instant } | null;
}
export interface WAllocation { id: string; reservationId: string; lineId: string; travellerId: string; journeyItemId: string | null; role: string; quantity: number }
export interface WEntitlement { id: string; entitlementType: string; observedStatus: string; observedStatusAt: Instant | null; lineIds: string[]; travellerIds: string[]; evidenceId: string | null }
export interface WBudget { id: string; revision: number; organisationId: string; amount: string; currency: string; valid: { start: Instant | null; end: Instant | null } }
export interface WBudgetCommitment { id: string; budgetId: string; amount: string; currency: string; status: string }
export interface WCostAllocation { id: string; reservationId: string | null; payerOrganisationId: string | null; payerTravellerId: string | null; entryKind: string; amount: string; currency: string; fxObservationId: string | null; evidenceId: string | null }
export interface WFxObservation { id: string; baseCurrency: string; quoteCurrency: string; rate: string; asOf: Instant; expiresAt: Instant | null; edition: string }

/** ---- programmes and geography ------------------------------------------ */
export interface WProgramme { id: string; revision: number; eventId: string; title: string; lifecycleStatus: string }
export interface WProgrammeItem {
  id: string;
  programmeId: string;
  title: string;
  itemType: string;
  placeId: string | null;
  window: { start: Instant; end: Instant } | null;
  lifecycleStatus: string;
  scheduleAuthority: string;
  /** Opaque operating requirements (e.g. requiresPhysicalPresence, readinessBufferMinutes). */
  operatingRequirements: Record<string, unknown> | null;
}
export interface WParticipation { id: string; programmeItemId: string; travellerId: string; obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED'; accepted: boolean; preparationWindow: { start: Instant; end: Instant } | null }
export interface WResourceAssignment { id: string; activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM'; activityId: string; resourceId: string; quantity: number; lifecycleStatus: string }
/** Provider-facing location identifiers captured with the canonical place. */
export interface WPlace { id: string; revision: number; name: string; placeType: string; timeZone: string; hasCoordinates: boolean; externalRefs?: readonly ExternalRef[] }
export interface WJurisdiction { id: string; revision: number; name: string; regimeKind: string }
/** Resolved in the snapshot by PostGIS/membership queries; the evaluator cannot recompute geometry. */
export interface WPlaceJurisdiction { placeId: string; jurisdictionId: string; basis: 'AREA_MEMBERSHIP' | 'SPATIAL_CONTAINMENT'; areaVersionId: string; evidenceId: string | null }

/** ---- knowledge ------------------------------------------------------- */
export interface WObjective {
  id: string; revision: number; owner: TypedRef; successPredicateKind: string; hardness: 'HARD' | 'SOFT'; priority: number;
  disposition: 'ACTIVE' | 'ACHIEVED' | 'WAIVED' | 'CLOSED_WITH_LOSS'; dispositionEvidenceId: string | null;
  targets: { label: string; targetKind: string; subject: TypedRef | null; placeId: string | null; atOrBefore: Instant | null; amountMinor: number | null; currencyCode: string | null }[];
}
export interface WConstraintDefinition {
  id: string; revision: number; registeredType: string; hardness: 'HARD' | 'SOFT'; owner: TypedRef; provenanceEvidenceId: string | null;
  operands: { key: string; kind: string; subject: TypedRef | null; text: string | null; number: string | null; boolean: boolean | null; instant: Instant | null; localDate: string | null }[];
}
export interface WDependency { id: string; from: TypedRef; to: TypedRef; dependencyKind: 'CONNECTS_TO' | 'REQUIRES'; constraintDefinitionId: string | null }
export interface WRuleSetVersion { id: string; ruleSetId: string; revision: number; policyFamily: string; issuer: TypedRef; editionNumber: number; status: string; effective: { start: Instant | null; end: Instant | null }; expression: RuleExpression; rules: { id: string; ruleKey: string; severity: string | null; expression: RuleExpression }[] }
export interface WRuleAssignment { id: string; ruleSetId: string; ruleSetVersionId: string | null; selectCurrentEdition: boolean; organisationId: string | null; subject: TypedRef | null; jurisdictionId: string | null; populationPredicateId: string | null; valid: { start: Instant; end: Instant | null } }
export interface WInformationVersion {
  id: string; recordId: string; revision: number; topic: string; publisherOrganisationId: string | null; subtype: 'ADVISORY' | 'CONDITION' | 'REGULATORY';
  sequence: number; issuedAt: Instant; observedAt: Instant; effective: { start: Instant | null; end: Instant | null }; evidenceId: string;
  supersedesId: string | null; retractsId: string | null; sourceNativeSeverity: string | null; riskTopics: string[];
  conditionType: string | null; regulatoryRuleSetVersionId: string | null; regulatoryJurisdictionId: string | null;
  scopes: { id: string; jurisdictionId: string | null; areaVersionId: string | null; subject: TypedRef | null; purpose: string | null; serviceCategory: string | null; populationPredicateId: string | null; exposure: { start: Instant; end: Instant } }[];
}
export interface WCoverage { id: string; topic: string; queryBounds: Record<string, unknown>; edition: string; watermark: string | null; completeness: string; limitations: string[]; expiresAt: Instant | null; evidenceId: string | null }

/** ---- the slice --------------------------------------------------------- */
export interface CapturedWorld {
  workspaceId: string;
  /** The subjects the caller asked about, and the subjects whose Journeys the closure reached. */
  focus: TypedRef[];
  /** Registered dependency edges discovered while capturing (closure input, not canonical truth). */
  edges: DependencyEdge[];
  capture: WorldCapture;
  manifest: WorldSnapshotManifest;

  travellers: WTraveller[];
  profileAssertions: WProfileAssertion[];
  credentials: WCredential[];
  credentialVersions: WCredentialVersion[];
  credentialLinks: WCredentialLink[];
  travelHistory: WTravelHistory[];
  organisations: WOrganisation[];

  trips: WTrip[];
  journeys: WJourney[];
  journeyItems: WJourneyItem[];
  intendedVisits: WIntendedVisit[];
  credentialSelections: WCredentialSelection[];
  coordinationGroups: WCoordinationGroup[];
  groupMemberships: WGroupMembership[];
  accompanimentRequirements: WAccompanimentRequirement[];
  supportAssignments: WSupportAssignment[];

  transportServices: WTransportService[];
  resources: WResource[];
  reservations: WReservation[];
  reservationLines: WReservationLine[];
  allocations: WAllocation[];
  entitlements: WEntitlement[];
  budgets: WBudget[];
  budgetCommitments: WBudgetCommitment[];
  costAllocations: WCostAllocation[];
  fxObservations: WFxObservation[];

  programmes: WProgramme[];
  programmeItems: WProgrammeItem[];
  participations: WParticipation[];
  resourceAssignments: WResourceAssignment[];
  places: WPlace[];
  jurisdictions: WJurisdiction[];
  placeJurisdictions: WPlaceJurisdiction[];

  objectives: WObjective[];
  constraints: WConstraintDefinition[];
  dependencies: WDependency[];
  ruleSetVersions: WRuleSetVersion[];
  ruleAssignments: WRuleAssignment[];
  informationVersions: WInformationVersion[];
  coverage: WCoverage[];
}
