/**
 * F2 — provider-neutral capability seams (FR-08, ARCHITECTURE.md §13).
 * Atlas is one FlightCapability adapter; the domain never depends on it.
 * All methods return structured CapabilityResult envelopes — external
 * failure is data, not a crash (NFR-03).
 */
import { z } from 'zod';
import type {
  DurationEstimate,
  EntityId,
  FactAuthority,
  IsoDateTime,
  Money,
  SourceKind,
  UncertaintyRecord,
} from '../domain/common.ts';
import { IsoDateTimeSchema } from '../domain/common.ts';
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

// ---------------------------------------------------------------------------
// Flight transaction (G3R-R0 / ADR-042..044)
// ---------------------------------------------------------------------------
//
// Provider-neutral seams for the proven forward lifecycle
// (create -> pay -> retrieve) and the cancellation lifecycle
// (quote -> submit -> status), plus the external provider-event intake
// normalizer seam. Provider wire shapes (endpoint names, status codes,
// passenger name conventions) are adapter-private: only these generic
// shapes cross into the application.

/**
 * Provider-neutral passenger identity. Adapters map to whatever name/date
 * representation the provider requires; the application never formats
 * provider-specific wire values itself.
 */
export interface FlightPassengerInput {
  givenName: string;
  familyName: string;
  /** Date of birth when the provider requires it (YYYY-MM-DD). */
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  /** ICAO/IATA nationality code when the provider requires it. */
  nationality?: string;
}

/** Provider-neutral booking contact details. */
export interface FlightContactInput {
  name: string;
  email?: string;
  phone?: string;
}

/**
 * Create a flight order from a VERIFIED offer. The verified outcome's opaque
 * workflow state is carried forward exactly; the result is a held/reserved
 * order that may expire (holdExpiresAt) and that moves NO money.
 */
export interface FlightOrderCreateQuery {
  offerId: string;
  passengers: FlightPassengerInput[];
  contact: FlightContactInput;
  /** Opaque provider workflow state carried from verify, preserved exactly. */
  workflowState?: Record<string, unknown>;
  /**
   * Caller-owned idempotency key. Required: this is the one operation most
   * exposed to duplicate-create risk, and it is what lets an executor
   * retrieve-before-recreate after a timeout instead of blindly re-issuing
   * create (ADR-042).
   */
  clientReference: string;
}

/**
 * Opaque provider workflow state for consequential flight transactions
 * (order refs, cancellation quote handles, tracking codes). Never
 * reinterpreted by the application; persisted for reconciliation.
 *
 * This state is owned by adapter/executor/reconciliation layers only — it
 * must never be read by domain or planner code, and never rendered to a
 * user-facing surface. The catchall lets adapter-specific reconciliation
 * fields survive round-trip without reinterpretation, but the surrounding
 * refinement rejects credential/PII/card-shaped keys outright so this seam
 * can never become a leakage path for raw payment or auth material.
 */
export const FlightTransactionStateSchema = z
  .strictObject({
    /** Opaque provider order/booking reference; never reinterpreted. */
    orderRef: z.string().optional(),
    /** Provider PNR/record locator if the provider exposes one. */
    providerRecordLocator: z.string().optional(),
    /** Issued ticket identifiers once the provider observes them. */
    ticketRefs: z.array(z.string()).optional(),
    /** Expiry of an unpaid hold, when the provider reports one. */
    holdExpiresAt: IsoDateTimeSchema.optional(),
    /** Opaque provider cancellation quote handle (quote -> submit). */
    cancellationQuoteRef: z.string().optional(),
    /** Opaque provider cancellation request/tracking reference. */
    cancellationRequestRef: z.string().optional(),
    /** Provider-reported expected confirmation instant (informational). */
    expectedConfirmationAt: IsoDateTimeSchema.optional(),
  })
  .catchall(z.unknown())
  .superRefine((value, ctx) => {
    const forbiddenKeys = [
      'pan',
      'cardNumber',
      'cardNum',
      'cvv',
      'cv2',
      'expiryMonth',
      'expiryYear',
      'access_token',
      'authorization',
      'secret',
    ];
    for (const key of forbiddenKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `transaction state must not carry credential/PII/card field ${key}`,
        });
      }
    }
  });
export type FlightTransactionState = z.infer<typeof FlightTransactionStateSchema>;

/** Provider-observed lifecycle state of a flight order. */
export const FlightOrderStatusSchema = z.enum([
  /** Created/reserved, payment not yet accepted. */
  'HELD',
  /** Payment accepted; ticketing may still be asynchronous. */
  'PAID',
  /** Provider reports ticketing in progress. */
  'TICKETING',
  /** Provider observes issued ticket(s). */
  'TICKETED',
  /** Provider observes the order as cancelled. */
  'CANCELLED',
  /** Provider observes creation/payment failure or expiry. */
  'FAILED',
  /** No trustworthy provider observation available. */
  'UNKNOWN',
]);
export type FlightOrderStatus = z.infer<typeof FlightOrderStatusSchema>;

export interface FlightOrderOutcome {
  /** Provider-observed order lifecycle state; acceptance != final state. */
  status: FlightOrderStatus;
  transactionState?: FlightTransactionState;
  totalPrice?: Money;
  /** Structured outcome of any embedded fulfilment attempt (pay/observe). */
  detail?: string;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

export interface FlightOrderRetrieveQuery {
  /** Opaque provider order reference returned by create/pay. */
  orderRef: string;
  clientReference?: string;
}

export interface FlightOrderStatusView {
  orderRef: string;
  status: FlightOrderStatus;
  transactionState?: FlightTransactionState;
  totalPrice?: Money;
  /** Last provider-observed instant for freshness reasoning. */
  observedAt?: IsoDateTime;
  detail?: string;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

/**
 * Payment/fulfilment of an existing order. The contract carries ONLY an
 * opaque, pre-authorised payment reference (e.g. a provider test-balance
 * method or a corporate virtual-card/MoR handle) — raw card data (PAN/CVV)
 * can never cross this seam (test-enforced).
 */
export interface FlightOrderPayQuery {
  orderRef: string;
  /** Opaque payment handle resolved/owned outside this contract. */
  paymentRef: string;
  /**
   * Deterministic price-drift ceiling that authority approved for this
   * payment (ADR-042). The executor MUST compare the provider-reported
   * payable total from `createOrder` against this ceiling before calling
   * `payOrder`: if the payable total exceeds `authorisedAmount`, the
   * currency differs, or no total is reported, the executor MUST NOT pay —
   * it re-enters deterministic viability/authority with the observed price,
   * leaving the order HELD. `ActionIntent.priceDelta` is a delta, not the
   * payable ceiling, and must never be used for this comparison.
   */
  authorisedAmount: Money;
  clientReference?: string;
}

/**
 * Pre-action cancellation information. A provider that does not support
 * cancellation reports UNSUPPORTED as a normal structured outcome — never
 * an exception. Acceptance of a submission is NOT final cancellation.
 */
export const FlightCancellationAvailabilitySchema = z.enum([
  'AVAILABLE',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'UNKNOWN',
]);
export type FlightCancellationAvailability =
  z.infer<typeof FlightCancellationAvailabilitySchema>;

export interface FlightCancellationQuoteQuery {
  orderRef: string;
  clientReference?: string;
}

export interface FlightCancellationQuoteOutcome {
  availability: FlightCancellationAvailability;
  /** Provider-reported deadline/window for the cancellation, if any. */
  deadline?: IsoDateTime;
  /** Amount expected to be returned, where the provider quotes one. */
  expectedReturn?: Money;
  /** Provider-stated conditions/limitations, surfaced verbatim. */
  conditions?: string[];
  transactionState?: FlightTransactionState;
  detail?: string;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

/** Consequential submission; requires the quote handle when the provider issues one. */
export interface FlightCancellationSubmitQuery {
  orderRef: string;
  /** Quote handle from the eligibility/quote step, when provider-issued. */
  cancellationQuoteRef?: string;
  clientReference?: string;
}

/** Provider-observed cancellation processing state. */
export const FlightCancellationStatusSchema = z.enum([
  /** Provider accepted the request; processing not yet observed complete. */
  'REQUEST_ACCEPTED',
  /** Provider reports cancellation still in progress. */
  'PROCESSING',
  /** Provider observes the booking as cancelled. */
  'CANCELLED',
  /** Provider rejected/failed the cancellation. */
  'REJECTED',
  'UNKNOWN',
]);
export type FlightCancellationStatus = z.infer<typeof FlightCancellationStatusSchema>;

export interface FlightCancellationSubmitOutcome {
  /**
   * Submission acceptance state only. Provider acceptance must NEVER be
   * treated as observed final cancellation or as trip recovery; the
   * cancellation status must be retrieved/observed separately.
   */
  status: FlightCancellationStatus;
  transactionState?: FlightTransactionState;
  detail?: string;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

export interface FlightCancellationStatusQuery {
  orderRef: string;
  cancellationRequestRef?: string;
  clientReference?: string;
}

export interface FlightCancellationStatusView {
  orderRef: string;
  status: FlightCancellationStatus;
  transactionState?: FlightTransactionState;
  expectedReturn?: Money;
  observedAt?: IsoDateTime;
  detail?: string;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

/**
 * Transactional flight capability (G3R-R0 / ADR-042..043). Read-only
 * discovery stays on FlightCapability. Within this interface, methods split
 * by side-effect level, not uniformly: `createOrder` / `payOrder` /
 * `submitCancellation` are consequential and reachable ONLY through the
 * ActionIntent -> authority -> executor path, never through planner tool
 * requests. `retrieveOrder` / `quoteCancellation` / `retrieveCancellationStatus`
 * are read-only and planner-requestable via `flight.order_status` /
 * `flight.cancel_quote` / `flight.cancel_status` respectively (subset
 * invariant test-enforced).
 *
 * Adapters that do not support an operation return a structured
 * CapabilityResult failure (category UNAVAILABLE) — never throw, never
 * silently succeed.
 */
export interface FlightTransactionCapability {
  readonly descriptor: CapabilityDescriptor;
  createOrder(query: FlightOrderCreateQuery): Promise<CapabilityResult<FlightOrderOutcome>>;
  payOrder(query: FlightOrderPayQuery): Promise<CapabilityResult<FlightOrderOutcome>>;
  retrieveOrder(query: FlightOrderRetrieveQuery): Promise<CapabilityResult<FlightOrderStatusView>>;
  quoteCancellation(
    query: FlightCancellationQuoteQuery,
  ): Promise<CapabilityResult<FlightCancellationQuoteOutcome>>;
  submitCancellation(
    query: FlightCancellationSubmitQuery,
  ): Promise<CapabilityResult<FlightCancellationSubmitOutcome>>;
  retrieveCancellationStatus(
    query: FlightCancellationStatusQuery,
  ): Promise<CapabilityResult<FlightCancellationStatusView>>;
}

// ---------------------------------------------------------------------------
// External provider events (G3R-R0 / ADR-044)
// ---------------------------------------------------------------------------
//
// Provider-neutral intake seam for externally delivered flight events
// (webhook/incident feeds). Raw payloads stay outside trip state; only the
// normalized envelope crosses into the application, and it carries the
// provider's own authority — an unauthenticated push arrives as ASSERTED at
// best. AUTHORITATIVE is excluded from `providerAuthority` at the schema
// itself (ExternalProviderEventEnvelopeSchema below): the envelope cannot
// self-declare authoritative trust, full stop — this is not a downstream
// convention or safeguard elsewhere, it is enforced right here.

/** Generic category of an external provider event; no provider names. */
export const ProviderEventCategorySchema = z.enum([
  'FLIGHT_SCHEDULE_CHANGE',
  'FLIGHT_CANCELLATION',
  'FLIGHT_DELAY',
  'TICKETING',
  'ORDER_STATE_CHANGE',
  'OTHER',
]);
export type ProviderEventCategory = z.infer<typeof ProviderEventCategorySchema>;

/**
 * Provider-neutral external event envelope. Persisted as inbox evidence
 * before normalization; identity is providerId + providerEventId for
 * delivery idempotency.
 */
export const ExternalProviderEventEnvelopeSchema = z.strictObject({
  /** Adapter/provider identity that delivered the event. */
  providerId: z.string().min(1),
  /** Provider-side event id for idempotency/deduplication. */
  providerEventId: z.string().min(1),
  receivedAt: IsoDateTimeSchema,
  /** Provider-supplied occurrence instant when present. */
  occurredAt: IsoDateTimeSchema.optional(),
  /** Provider booking/order references for correlation, where supplied. */
  providerOrderRefs: z.array(z.string()).default([]),
  category: ProviderEventCategorySchema,
  /**
   * Provider-side delivery confidence, if the provider states one. Excludes
   * AUTHORITATIVE at the schema itself: an externally delivered envelope can
   * never self-declare authoritative trust (ADR-044) — that ceiling is
   * enforced here, not by a downstream convention or safeguard elsewhere.
   */
  providerAuthority: z.enum(['CONNECTED', 'ASSERTED', 'INFERRED']).optional(),
  /**
   * Normalized payload; provider-specific raw payloads stay in the inbox
   * store/recording, never here.
   */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ExternalProviderEventEnvelope = z.infer<
  typeof ExternalProviderEventEnvelopeSchema
>;

/**
 * Normalizes one raw external provider event into the generic envelope plus
 * the TripSignal it should feed. The adapter owns all provider-specific
 * parsing; the application receives only these provider-neutral shapes.
 * Trust handling (ADR-044): events from delivery channels without
 * authentication MUST be normalized at providerAuthority ASSERTED at best,
 * and downstream authority/truth-resolution keeps them from outranking
 * observed provider state.
 */
export interface ExternalFlightEventNormalizer {
  readonly providerId: string;
  /** Structured failure for unparseable/duplicate payloads; never throws. */
  normalize(raw: unknown): Promise<
    CapabilityResult<{ envelope: ExternalProviderEventEnvelope; signals: TripSignal[] }>
  >;
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
 * Hotel capability covers BOTH imported booking/policy context (getStayContext)
 * and a provider-neutral transactional surface (search/quote/book/retrieve,
 * modify/cancel where the provider supports them). Transactional modify/cancel
 * may be simulated at the provider boundary (ADR-007); providers without
 * in-place modification are handled as cancel + rebook inside the adapter.
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

/** Provider-opaque location input: external ref or coordinates + radius. */
export interface HotelSearchQuery {
  location: {
    externalRef?: ExternalRef;
    coordinates?: { latitude: number; longitude: number; radiusKm?: number };
  };
  /** Local dates at the property (YYYY-MM-DD). */
  checkInDate: string;
  checkOutDate: string;
  guests?: { adults: number; children?: number };
  rooms?: number;
}

export interface HotelPropertyView {
  /** Opaque provider identifier — preserved exactly, never reinterpreted. */
  propertyId: string;
  name: string;
  address?: string;
  coordinates?: { latitude: number; longitude: number };
  externalRefs?: ExternalRef[];
}

export interface HotelRateView {
  /** Opaque provider rate/offer identifier. */
  rateId: string;
  propertyId: string;
  roomDescription?: string;
  totalPrice: Money;
  /** Provider-neutral cancellation posture. */
  refundable: boolean;
  cancellationDeadline?: IsoDateTime;
  cancellationFee?: Money;
  availability: 'AVAILABLE' | 'LIMITED' | 'UNKNOWN';
  expiresAt?: IsoDateTime;
}

export interface HotelSearchOutcome {
  properties: HotelPropertyView[];
  rates: HotelRateView[];
}

export interface HotelQuoteQuery {
  rateId: string;
  /** Opaque provider workflow state carried between search and quote. */
  workflowState?: Record<string, unknown>;
}

export interface HotelQuoteOutcome {
  status: 'QUOTED' | 'PRICE_CHANGED' | 'UNAVAILABLE';
  quotedPrice?: Money;
  priceDelta?: Money;
  /** Handle required by bookStay; provider-opaque. */
  quoteId?: string;
  workflowState?: Record<string, unknown>;
}

export interface HotelBookQuery {
  quoteId: string;
  /** Guest identity sufficient for the provider; adapter maps specifics. */
  guestNames: string[];
  /** Opaque provider payment handle (balance/card/virtual); never raw card data. */
  paymentRef?: string;
  /** Idempotency / reconciliation reference owned by the caller. */
  clientReference?: string;
}

export interface HotelBookingOutcome {
  confirmed: boolean;
  bookingId?: string;
  providerConfirmationCode?: string;
  totalPrice?: Money;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

export interface HotelRetrieveQuery {
  bookingId: string;
}

export interface HotelBookingStatusView {
  bookingId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'UNKNOWN';
  propertyName?: string;
  checkIn?: IsoDateTime;
  checkOut?: IsoDateTime;
  cancellationFee?: Money;
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
  /** Imported-booking context (Checkpoint-C surface; unchanged). */
  getStayContext(query: StayContextQuery): Promise<CapabilityResult<StayContext>>;
  /** Transactional discovery/quote/book/retrieve (Northstar initial planning). */
  searchHotels(query: HotelSearchQuery): Promise<CapabilityResult<HotelSearchOutcome>>;
  quoteRate(query: HotelQuoteQuery): Promise<CapabilityResult<HotelQuoteOutcome>>;
  bookStay(query: HotelBookQuery): Promise<CapabilityResult<HotelBookingOutcome>>;
  retrieveBooking(query: HotelRetrieveQuery): Promise<CapabilityResult<HotelBookingStatusView>>;
  /**
   * In-place modification where the provider supports it; adapters without it
   * implement this as cancel + rebook and report so in the outcome.
   */
  modifyStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>>;
  cancelStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>>;
}

// ---------------------------------------------------------------------------
// Ground transfer (transactional inventory; routing context stays in Routing)
// ---------------------------------------------------------------------------

export interface TransferSearchQuery {
  pickup: { externalRef?: ExternalRef; coordinates?: { latitude: number; longitude: number }; addressText?: string };
  dropoff: { externalRef?: ExternalRef; coordinates?: { latitude: number; longitude: number }; addressText?: string };
  pickupAt: IsoDateTime;
  passengers: number;
}

export interface TransferOptionView {
  /** Opaque provider option identifier. */
  optionId: string;
  vehicleClass?: string;
  totalPrice: Money;
  availability: 'AVAILABLE' | 'LIMITED' | 'UNKNOWN';
  expiresAt?: IsoDateTime;
}

export interface TransferSearchOutcome {
  options: TransferOptionView[];
}

export interface TransferQuoteQuery {
  optionId: string;
  workflowState?: Record<string, unknown>;
}

export interface TransferQuoteOutcome {
  status: 'QUOTED' | 'PRICE_CHANGED' | 'UNAVAILABLE';
  quotedPrice?: Money;
  quoteId?: string;
  workflowState?: Record<string, unknown>;
}

export interface TransferBookQuery {
  quoteId: string;
  passengerNames: string[];
  paymentRef?: string;
  clientReference?: string;
}

export interface TransferBookingOutcome {
  confirmed: boolean;
  bookingId?: string;
  provenance: 'LIVE' | 'REPLAY' | 'SIMULATED';
}

export interface TransferRetrieveQuery {
  bookingId: string;
}

export interface TransferBookingStatusView {
  bookingId: string;
  status: 'CONFIRMED' | 'AMENDED' | 'CANCELLED' | 'COMPLETED' | 'UNKNOWN';
  pickupAt?: IsoDateTime;
  cancellationFee?: Money;
}

export interface TransferAmendQuery {
  bookingId: string;
  newPickupAt?: IsoDateTime;
  newPassengers?: number;
}

export interface TransferActionQuery {
  bookingId: string;
  reason?: string;
}

export interface TransferCapability {
  readonly descriptor: CapabilityDescriptor;
  searchTransfers(query: TransferSearchQuery): Promise<CapabilityResult<TransferSearchOutcome>>;
  quoteTransfer(query: TransferQuoteQuery): Promise<CapabilityResult<TransferQuoteOutcome>>;
  bookTransfer(query: TransferBookQuery): Promise<CapabilityResult<TransferBookingOutcome>>;
  retrieveBooking(query: TransferRetrieveQuery): Promise<CapabilityResult<TransferBookingStatusView>>;
  /** Provider-dependent: adapters without amendment implement amend as cancel + rebook. */
  amendBooking(query: TransferAmendQuery): Promise<CapabilityResult<TransferBookingOutcome>>;
  cancelBooking(query: TransferActionQuery): Promise<CapabilityResult<TransferBookingOutcome>>;
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
