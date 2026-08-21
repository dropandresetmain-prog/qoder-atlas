/**
 * F2 — provider-neutral capability seams (FR-08, ARCHITECTURE.md §13).
 * Atlas is one FlightCapability adapter; the domain never depends on it.
 * All methods return structured CapabilityResult envelopes — external
 * failure is data, not a crash (NFR-03).
 */
import type {
  DurationEstimate,
  EntityId,
  FactAuthority,
  IsoDateTime,
  Money,
  SourceKind,
  UncertaintyRecord,
} from '../domain/common.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { MutationProposal } from '../operational/mutation.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { CapabilityFamily } from '../operational/strategy.ts';
import type { CapabilityOperation, SideEffectLevel } from '../operational/intent.ts';
import type { AdapterMode, CapabilityResult } from './envelope.ts';

/** Provider/authority system reference (airport codes, booking systems...). */
export interface ExternalRef {
  system: string;
  value: string;
}

export interface CapabilityDescriptor {
  family: CapabilityFamily;
  providerId: string;
  mode: AdapterMode;
  supportedOperations: CapabilityOperation[];
  /** Highest side-effect level this adapter can perform. */
  maxSideEffectLevel: SideEffectLevel;
}

// ---------------------------------------------------------------------------
// Flight
// ---------------------------------------------------------------------------

export interface FlightSearchQuery {
  origin: ExternalRef;
  destination: ExternalRef;
  /** Local departure date at origin (YYYY-MM-DD). */
  departureDate: string;
  passengers: { adults: number; children?: number; infants?: number };
  cabinClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'ANY';
  maxStops?: number;
}

export interface FlightSegmentView {
  carrierCode?: string;
  flightNumber?: string;
  origin: ExternalRef;
  destination: ExternalRef;
  departure: IsoDateTime;
  arrival: IsoDateTime;
  cabin?: string;
}

export interface FlightOffer {
  /** Opaque provider workflow identifier — preserved exactly, never reinterpreted. */
  offerId: string;
  segments: FlightSegmentView[];
  totalPrice: Money;
  fareFamily?: string;
  availability: 'AVAILABLE' | 'LIMITED' | 'UNKNOWN';
  expiresAt?: IsoDateTime;
}

export interface FlightSearchOutcome {
  offers: FlightOffer[];
}

export interface FlightVerifyQuery {
  offerId: string;
  /** Opaque provider workflow state carried between search and verify. */
  workflowState?: Record<string, unknown>;
}

export interface FlightVerifyOutcome {
  status: 'VERIFIED' | 'PRICE_CHANGED' | 'UNAVAILABLE';
  updatedPrice?: Money;
  priceDelta?: Money;
  bookingRequirements?: string[];
  workflowState?: Record<string, unknown>;
}

export interface FareRulesOutcome {
  change?: { allowed: boolean; fee?: Money; notes?: string };
  refund?: { refundable: boolean; fee?: Money; deadline?: IsoDateTime; notes?: string };
  noShow?: { consequence: string; fee?: Money };
  baggageIncluded?: string[];
}

export interface FlightCapability {
  readonly descriptor: CapabilityDescriptor;
  searchFlights(query: FlightSearchQuery): Promise<CapabilityResult<FlightSearchOutcome>>;
  verifyOffer(query: FlightVerifyQuery): Promise<CapabilityResult<FlightVerifyOutcome>>;
  getFareRules(query: FlightVerifyQuery): Promise<CapabilityResult<FareRulesOutcome>>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RoutingQuery {
  origin: { externalRef?: ExternalRef; coordinates?: { latitude: number; longitude: number } };
  destination: { externalRef?: ExternalRef; coordinates?: { latitude: number; longitude: number } };
  mode?: 'DRIVE' | 'TRANSIT' | 'WALK';
  departAt?: IsoDateTime;
}

export interface RouteContext {
  duration: DurationEstimate;
  distanceKm?: number;
  trafficCondition?: 'UNKNOWN' | 'LIGHT' | 'MODERATE' | 'HEAVY';
  notes?: string;
}

export interface RoutingCapability {
  readonly descriptor: CapabilityDescriptor;
  getRouteContext(query: RoutingQuery): Promise<CapabilityResult<RouteContext>>;
}

// ---------------------------------------------------------------------------
// Hotel
// ---------------------------------------------------------------------------

/**
 * Hotel capability works from imported booking/policy data; transactional
 * modify/cancel may be simulated at the provider boundary (ADR-007).
 */
export interface StayContextQuery {
  stayElementId: EntityId;
}

export interface StayContext {
  propertyName?: string;
  checkInWindow?: { start?: IsoDateTime; end?: IsoDateTime };
  noShowCutoff?: IsoDateTime;
  lateArrivalSupported?: boolean;
  cancellation?: { refundable: boolean; deadline?: IsoDateTime; fee?: Money };
}

export interface HotelActionQuery {
  stayElementId: EntityId;
  reason?: string;
  /** Requested new times for modifyStay. */
  newCheckIn?: IsoDateTime;
  newCheckOut?: IsoDateTime;
}

export interface HotelActionOutcome {
  confirmed: boolean;
  reference?: string;
  fee?: Money;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

export interface HotelCapability {
  readonly descriptor: CapabilityDescriptor;
  getStayContext(query: StayContextQuery): Promise<CapabilityResult<StayContext>>;
  modifyStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>>;
  cancelStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>>;
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export interface ResearchFinding {
  statement: string;
  /** Legal facts need authoritative sourcing; estimates keep uncertainty. */
  kind: 'LEGAL_ENTRY_FACT' | 'OPERATIONAL_ESTIMATE';
  authority: FactAuthority;
  sourceUris: string[];
  confidence?: number;
  uncertainty?: string;
}

export interface EntryResearchQuery {
  destinationCountryCode: string;
  nationalityCodes: string[];
  travelDate?: string;
}

export interface LocalContextResearchQuery {
  topic: string;
  placeRef?: ExternalRef;
}

export interface ResearchOutcome {
  findings: ResearchFinding[];
}

export interface ResearchCapability {
  readonly descriptor: CapabilityDescriptor;
  researchEntryRequirements(query: EntryResearchQuery): Promise<CapabilityResult<ResearchOutcome>>;
  researchLocalContext(query: LocalContextResearchQuery): Promise<CapabilityResult<ResearchOutcome>>;
}

// ---------------------------------------------------------------------------
// Source ingestion
// ---------------------------------------------------------------------------

export interface SourceInput {
  /** Reuse an existing source record, or let ingestion create one. */
  sourceId?: EntityId;
  kind: SourceKind;
  title?: string;
  uri?: string;
  content?: string;
  /** Already-structured payloads take the deterministic mapping path. */
  structured?: Record<string, unknown>;
}

/**
 * Ingestion output is always proposals/rules/signals — never direct state
 * writes (FR-02/FR-04).
 */
export interface IngestionOutcome {
  sourceId: EntityId;
  proposals: MutationProposal[];
  ruleSets: RuleSet[];
  signals: TripSignal[];
  uncertainties: UncertaintyRecord[];
}

export interface SourceIngestionCapability {
  readonly descriptor: CapabilityDescriptor;
  ingest(input: SourceInput): Promise<CapabilityResult<IngestionOutcome>>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface CapabilityRegistry {
  list(): CapabilityDescriptor[];
  forFamily(family: CapabilityFamily): CapabilityDescriptor[];
}
