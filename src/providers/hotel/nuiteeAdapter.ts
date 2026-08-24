/**
 * C5 — Nuitée (liteAPI) HotelCapability adapter (RV-N7, WP-R4-REDO).
 *
 * Provider decision: Duffel Stays was the documented first choice but is not
 * available in Singapore, so the IMPLEMENTATION_PLAN Section 13 fallback
 * clause ("Duffel Stays first, Nuitée fallback if empirical access fails")
 * fired. docs/reality-validation/02_HOTEL_PROVIDER_DECISION.md §10 grades
 * Nuitée / liteAPI as USE_SANDBOX + USE_LIVE.
 *
 * Endpoint surface (docs.liteapi.travel, Nuitee Connect v3):
 *  - search  POST {searchBase}/hotels/rates      (properties + rates in one call)
 *  - quote   POST {bookingBase}/rates/prebook    (offerId -> prebookId)
 *  - book    POST {bookingBase}/rates/book       (prebookId -> bookingId)
 *  - retrieve GET {bookingBase}/bookings/{id}
 *  - cancel  PUT  {bookingBase}/bookings/{id}
 * Auth header: X-API-Key. LIVE/RECORD fail closed with NOT_CONFIGURED when
 * no NUITEE_API_KEY is configured.
 *
 * Operation notes against the frozen HotelCapability:
 *  - searchHotels returns one HotelRateView per room type; rateId carries
 *    the provider offerId, which is exactly what quoteRate needs (opaque,
 *    never reinterpreted).
 *  - quoteRate maps prebook; priceDifferencePercent != 0 -> PRICE_CHANGED.
 *  - bookStay uses the account's stored-card method (ACC_CREDIT_CARD); the
 *    frozen HotelBookQuery carries no payment data and never will.
 *  - modifyStay is NOT served by liteAPI (its amend endpoint only edits
 *    guest names; date changes are cancel + rebook). Per the work package
 *    it returns a structured CapabilityResult failure — the interface never
 *    widens.
 *
 * Money-moving operations never produce authoritative state changes from
 * the adapter itself: they return a structured outcome with provenance and
 * an opaque reference, and the operational layer must wrap them in
 * ActionIntents before any persistence.
 */
import { type AdapterMode, type CapabilityResult, type ProviderAdapter } from '../../contracts/envelope.ts';
import { capabilityError } from '../../contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  HotelActionOutcome,
  HotelActionQuery,
  HotelBookQuery,
  HotelBookingOutcome,
  HotelBookingStatusView,
  HotelCapability,
  HotelPropertyView,
  HotelQuoteOutcome,
  HotelQuoteQuery,
  HotelRateView,
  HotelRetrieveQuery,
  HotelSearchOutcome,
  HotelSearchQuery,
  StayContext,
  StayContextQuery,
} from '../../contracts/capabilities.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';

export const NUITEE_PROVIDER_ID = 'nuitee';

/**
 * Real Nuitee Connect v3 hosts (docs.liteapi.travel). Search/content/rates
 * live on the api host; prebook/book/retrieve/cancel on the book host.
 * LIVE/RECORD still fail closed with NOT_CONFIGURED when no key is set, so
 * the real hosts are never reached by accident.
 */
export const NUITEE_DEFAULT_SEARCH_BASE_URL = 'https://api.liteapi.travel/v3.0';
export const NUITEE_DEFAULT_BOOKING_BASE_URL = 'https://book.liteapi.travel/v3.0';

/** ExternalRef system carrying a provider-native hotel id (rate re-search). */
export const NUITEE_HOTEL_ID_REF_SYSTEM = 'nuitee-hotel-id';

/** Provider inputs the frozen HotelSearchQuery cannot express. Documented,
 *  deterministic adapter defaults — never guesses per request. */
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_GUEST_NATIONALITY = 'US';
/** Contact details required by the provider booking schema; the frozen
 *  HotelBookQuery carries names only, so the adapter supplies neutral
 *  booker-of-record plumbing (overridable for other deployments). */
const DEFAULT_BOOKING_CONTACT_EMAIL = 'booker@example.com';
const DEFAULT_BOOKING_CONTACT_PHONE = '0000000000';
/** Sandbox/account stored-card payment method (no raw card data crosses
 *  this seam; sandbox bookings are simulated and never charged). */
const BOOKING_PAYMENT_METHOD = 'ACC_CREDIT_CARD';
/** Bounded rate fan-out per property keeps recordings and responses sane. */
const MAX_RATES_PER_HOTEL = 3;
/** Default search extent when coordinates arrive without a radius. */
const DEFAULT_COORDINATE_RADIUS_METERS = 5000;

// ---------------------------------------------------------------------------
// Raw provider shapes (Nuitee Connect v3). Schemas are intentionally
// permissive — recordings may carry extra provider fields; the normalizer
// consumes only the documented projection.
// ---------------------------------------------------------------------------

export interface NuiteeMoneyRaw {
  amount?: number | string;
  currency?: string;
}

export interface NuiteeCancelPolicyInfoRaw {
  cancelTime?: string;
  amount?: number;
  currency?: string;
  type?: string;
  timezone?: string;
}

export interface NuiteeRateRaw {
  rateId?: string;
  occupancyNumber?: number;
  name?: string;
  boardType?: string;
  boardName?: string;
  maxOccupancy?: number;
  /** Search/prebook return an ARRAY of totals; book/retrieve return a
   *  single OBJECT — both shapes are real and both are consumed. */
  retailRate?: { total?: NuiteeMoneyRaw | NuiteeMoneyRaw[] };
  cancellationPolicies?: {
    cancelPolicyInfos?: NuiteeCancelPolicyInfoRaw[];
    hotelRemarks?: unknown[];
    refundableTag?: string;
  };
  paymentTypes?: string[];
}

export interface NuiteeRoomTypeRaw {
  roomTypeId?: string;
  name?: string;
  offerId?: string;
  supplier?: string;
  rates?: NuiteeRateRaw[];
}

/** POST /hotels/rates response: rate results plus hotel content. */
export interface NuiteeSearchRaw {
  data?: Array<{ hotelId?: string; roomTypes?: NuiteeRoomTypeRaw[] }>;
  hotels?: Array<{
    id?: string;
    name?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  }>;
  sandbox?: boolean;
}

/** POST /rates/prebook response. The change flags may sit on the envelope
 *  or inside data depending on API version; normalization checks both. */
export interface NuiteePrebookRaw {
  data?: {
    prebookId?: string;
    offerId?: string;
    hotelId?: string;
    checkin?: string;
    checkout?: string;
    currency?: string;
    roomTypes?: NuiteeRoomTypeRaw[];
    priceDifferencePercent?: number;
    cancellationChanged?: boolean;
    boardChanged?: boolean;
  };
  priceDifferencePercent?: number;
  cancellationChanged?: boolean;
  boardChanged?: boolean;
}

/** POST /rates/book response. Pricing sits either under roomTypes
 *  (prebook-shaped) or under bookedRooms[].rate (observed booking shape). */
export interface NuiteeBookRaw {
  data?: {
    bookingId?: string;
    clientReference?: string;
    status?: string;
    hotelConfirmationCode?: string;
    hotelId?: string;
    checkin?: string;
    checkout?: string;
    currency?: string;
    roomTypes?: NuiteeRoomTypeRaw[];
    bookedRooms?: Array<{ rate?: NuiteeRateRaw }>;
  };
}

/** GET /bookings/{bookingId} response (retrieve + stay-context source). */
export interface NuiteeRetrieveRaw {
  data?: {
    bookingId?: string;
    clientReference?: string;
    status?: string;
    hotelConfirmationCode?: string;
    hotelId?: string;
    hotelName?: string;
    checkin?: string;
    checkout?: string;
    currency?: string;
    roomTypes?: NuiteeRoomTypeRaw[];
    cancellationPolicies?: {
      cancelPolicyInfos?: NuiteeCancelPolicyInfoRaw[];
      refundableTag?: string;
    };
  };
}

/** PUT /bookings/{bookingId} (cancel) response. */
export interface NuiteeCancelRaw {
  data?: {
    bookingId?: string;
    status?: string;
    cancellation_fee?: number;
    refund_amount?: number;
    currency?: string;
  };
}

export interface NuiteeAdapterOptions {
  mode: AdapterMode;
  store: RecordingStore;
  searchBaseUrl?: string;
  bookingBaseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Overrides for the documented booking-contact defaults. */
  bookingContactEmail?: string;
  bookingContactPhone?: string;
}

/**
 * The Nuitée adapter is honest about side-effect level: it advertises
 * MONEY_MOVING because book/cancel exist and move money against the
 * provider (sandbox bookings are simulated by the provider).
 */
export class NuiteeAdapter implements HotelCapability {
  readonly descriptor: CapabilityDescriptor;
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly searchBaseUrl?: string;
  private readonly bookingBaseUrl?: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly bookingContactEmail: string;
  private readonly bookingContactPhone: string;

  constructor(options: NuiteeAdapterOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.searchBaseUrl = options.searchBaseUrl;
    this.bookingBaseUrl = options.bookingBaseUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.bookingContactEmail = options.bookingContactEmail ?? DEFAULT_BOOKING_CONTACT_EMAIL;
    this.bookingContactPhone = options.bookingContactPhone ?? DEFAULT_BOOKING_CONTACT_PHONE;
    this.descriptor = {
      family: 'HOTEL',
      providerId: NUITEE_PROVIDER_ID,
      mode: options.mode,
      // 'hotel.modify' is intentionally absent: liteAPI has no in-place
      // stay modification (modifyStay returns a structured failure).
      supportedOperations: [
        'hotel.context',
        'hotel.search',
        'hotel.quote',
        'hotel.book',
        'hotel.cancel',
        'hotel.retrieve',
      ],
      maxSideEffectLevel: 'MONEY_MOVING',
    };
  }

  async getStayContext(query: StayContextQuery): Promise<CapabilityResult<StayContext>> {
    const adapter: ProviderAdapter<StayContextQuery, NuiteeRetrieveRaw, StayContext> = {
      providerId: NUITEE_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchStayContextRaw(request),
      normalize: normalizeStayContext,
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'stay_context',
      secrets: this.secrets(),
    });
  }

  async searchHotels(query: HotelSearchQuery): Promise<CapabilityResult<HotelSearchOutcome>> {
    const adapter: ProviderAdapter<HotelSearchQuery, NuiteeSearchRaw, HotelSearchOutcome> = {
      providerId: NUITEE_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchSearchRaw(request),
      normalize: normalizeSearch,
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'search',
      secrets: this.secrets(),
    });
  }

  async quoteRate(query: HotelQuoteQuery): Promise<CapabilityResult<HotelQuoteOutcome>> {
    const adapter: ProviderAdapter<HotelQuoteQuery, NuiteePrebookRaw, HotelQuoteOutcome> = {
      providerId: NUITEE_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchQuoteRaw(request),
      normalize: normalizeQuote,
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'quote',
      secrets: this.secrets(),
    });
  }

  async bookStay(query: HotelBookQuery): Promise<CapabilityResult<HotelBookingOutcome>> {
    const adapter: ProviderAdapter<HotelBookQuery, NuiteeBookRaw, HotelBookingOutcome> = {
      providerId: NUITEE_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchBookRaw(request),
      normalize: (raw) => normalizeBook(raw, this.mode),
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'book',
      secrets: this.secrets(),
    });
  }

  async retrieveBooking(query: HotelRetrieveQuery): Promise<CapabilityResult<HotelBookingStatusView>> {
    const adapter: ProviderAdapter<HotelRetrieveQuery, NuiteeRetrieveRaw, HotelBookingStatusView> = {
      providerId: NUITEE_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchRetrieveRaw(request),
      normalize: normalizeRetrieve,
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'retrieve',
      secrets: this.secrets(),
    });
  }

  /**
   * liteAPI cannot modify a stay in place (its amend endpoint only edits
   * guest names; date changes are cancel + rebook and a rebook needs a
   * fresh search/quote/book cycle that HotelActionQuery cannot carry).
   * Structured failure is the honest surface — the contract never widens.
   */
  async modifyStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
    return capabilityError<HotelActionOutcome>(
      {
        category: 'UNAVAILABLE',
        code: 'nuitee_modify_not_supported',
        message:
          'Nuitée/liteAPI has no in-place stay modification; the provider workflow is cancel + rebook ' +
          `(stayElementId ${query.stayElementId} untouched)`,
      },
      { providerId: NUITEE_PROVIDER_ID, mode: this.mode, requestedAt: new Date().toISOString() },
    );
  }

  async cancelStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
    const adapter: ProviderAdapter<HotelActionQuery, NuiteeCancelRaw, HotelActionOutcome> = {
      providerId: NUITEE_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchCancelRaw(request),
      normalize: (raw) => normalizeCancel(raw, this.mode),
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'cancel',
      secrets: this.secrets(),
    });
  }

  // ---------------------------------------------------------------------------
  // LIVE HTTP seam
  // ---------------------------------------------------------------------------

  private liveConfigured(): { searchBaseUrl: string; bookingBaseUrl: string; apiKey: string } {
    if (this.mode === 'REPLAY') {
      throw capabilityFailure(
        'PROVIDER_ERROR',
        'nuitee_live_call_in_replay',
        'REPLAY must not call the provider',
      );
    }
    if (!this.apiKey) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'nuitee_missing_credentials',
        'Nuitée LIVE/RECORD requires NUITEE_API_KEY (and optionally NUITEE_SEARCH_BASE_URL / NUITEE_BOOKING_BASE_URL)',
      );
    }
    return {
      searchBaseUrl: this.searchBaseUrl ?? NUITEE_DEFAULT_SEARCH_BASE_URL,
      bookingBaseUrl: this.bookingBaseUrl ?? NUITEE_DEFAULT_BOOKING_BASE_URL,
      apiKey: this.apiKey,
    };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    baseUrl: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const { apiKey } = this.liveConfigured();
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'X-API-Key': apiKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw capabilityFailure('TIMEOUT', 'nuitee_timeout', 'Nuitée timed out', true);
      }
      throw capabilityFailure(
        'NETWORK',
        'nuitee_network_error',
        `Nuitée unreachable (${error instanceof Error ? error.name : 'unknown'})`,
        true,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw capabilityFailure('AUTH', `nuitee_http_${response.status}`, 'Nuitée rejected the API key');
      }
      if (response.status === 429) {
        throw capabilityFailure('RATE_LIMITED', 'nuitee_http_429', 'Nuitée rate limited', true);
      }
      if (response.status >= 500) {
        throw capabilityFailure(
          'PROVIDER_ERROR',
          `nuitee_http_${response.status}`,
          `Nuitée failed with HTTP ${response.status}`,
          true,
        );
      }
      // P0.3: raw error bodies are never echoed — they can carry PII or
      // echoed credentials; the structured HTTP-status code is enough.
      throw capabilityFailure(
        'PROVIDER_ERROR',
        `nuitee_http_${response.status}`,
        `Nuitée failed (HTTP ${response.status})`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw capabilityFailure('PROVIDER_ERROR', 'nuitee_non_json', 'Nuitée returned a non-JSON body');
    }
  }

  private fetchSearchRaw(query: HotelSearchQuery): Promise<NuiteeSearchRaw> {
    const { searchBaseUrl } = this.liveConfigured();
    const body: Record<string, unknown> = {
      checkin: query.checkInDate,
      checkout: query.checkOutDate,
      currency: DEFAULT_CURRENCY,
      guestNationality: DEFAULT_GUEST_NATIONALITY,
      occupancies: buildOccupancies(query),
      maxRatesPerHotel: MAX_RATES_PER_HOTEL,
      includeHotelData: true,
    };
    const location = query.location;
    if (location.coordinates) {
      body.latitude = location.coordinates.latitude;
      body.longitude = location.coordinates.longitude;
      body.radius =
        typeof location.coordinates.radiusKm === 'number'
          ? Math.max(1, Math.round(location.coordinates.radiusKm * 1000))
          : DEFAULT_COORDINATE_RADIUS_METERS;
    } else if (location.externalRef && location.externalRef.system === NUITEE_HOTEL_ID_REF_SYSTEM) {
      body.hotelIds = [location.externalRef.value];
    } else {
      throw capabilityFailure(
        'INVALID_REQUEST',
        'nuitee_location_not_mappable',
        'hotel search location must be coordinates or a nuitee-hotel-id external ref',
      );
    }
    return this.request<NuiteeSearchRaw>('POST', searchBaseUrl, '/hotels/rates', body);
  }

  private fetchQuoteRaw(query: HotelQuoteQuery): Promise<NuiteePrebookRaw> {
    const { bookingBaseUrl } = this.liveConfigured();
    return this.request<NuiteePrebookRaw>('POST', bookingBaseUrl, '/rates/prebook', {
      offerId: query.rateId,
      usePaymentSdk: false,
    });
  }

  private fetchBookRaw(query: HotelBookQuery): Promise<NuiteeBookRaw> {
    const { bookingBaseUrl } = this.liveConfigured();
    const names = query.guestNames.length > 0 ? query.guestNames : ['Guest'];
    const holder = splitGuestName(names[0]!);
    const body: Record<string, unknown> = {
      prebookId: query.quoteId,
      holder: {
        firstName: holder.firstName,
        lastName: holder.lastName,
        email: this.bookingContactEmail,
        phone: this.bookingContactPhone,
      },
      guests: names.map((name, index) => ({
        occupancyNumber: index + 1,
        ...splitGuestName(name),
        email: this.bookingContactEmail,
      })),
      payment: { method: BOOKING_PAYMENT_METHOD },
    };
    if (query.clientReference) body.clientReference = query.clientReference;
    return this.request<NuiteeBookRaw>('POST', bookingBaseUrl, '/rates/book', body);
  }

  private fetchRetrieveRaw(query: HotelRetrieveQuery): Promise<NuiteeRetrieveRaw> {
    const { bookingBaseUrl } = this.liveConfigured();
    return this.request<NuiteeRetrieveRaw>('GET', bookingBaseUrl, `/bookings/${encodeURIComponent(query.bookingId)}`);
  }

  private fetchCancelRaw(query: HotelActionQuery): Promise<NuiteeCancelRaw> {
    const { bookingBaseUrl } = this.liveConfigured();
    return this.request<NuiteeCancelRaw>('PUT', bookingBaseUrl, `/bookings/${encodeURIComponent(query.stayElementId)}`);
  }

  private fetchStayContextRaw(query: StayContextQuery): Promise<NuiteeRetrieveRaw> {
    const { bookingBaseUrl } = this.liveConfigured();
    return this.request<NuiteeRetrieveRaw>(
      'GET',
      bookingBaseUrl,
      `/bookings/${encodeURIComponent(query.stayElementId)}`,
    );
  }

  private secrets(): string[] {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0 ? [this.apiKey] : [];
  }
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toCurrency(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length !== 3) return undefined;
  return value.toUpperCase();
}

/** Split a full guest name into the provider's firstName/lastName pair. */
export function splitGuestName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return { firstName: 'Guest', lastName: 'Guest' };
  const firstName = parts[0]!;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : 'Guest';
  return { firstName, lastName };
}

/**
 * The frozen HotelSearchQuery carries rooms + adult/child counts. liteAPI
 * wants per-room occupancies with explicit child AGES; a child count
 * without ages is missing evidence, so it fails closed instead of
 * fabricating ages.
 */
function buildOccupancies(query: HotelSearchQuery): Array<Record<string, unknown>> {
  const adults = query.guests?.adults ?? 1;
  const children = query.guests?.children ?? 0;
  if (children > 0) {
    throw capabilityFailure(
      'INVALID_REQUEST',
      'nuitee_child_ages_required',
      'Nuitée requires per-child ages; the frozen search query carries only a child count',
    );
  }
  const rooms = Math.max(1, query.rooms ?? 1);
  return Array.from({ length: rooms }, () => ({ adults }));
}

function sumRetailTotals(roomTypes: NuiteeRoomTypeRaw[] | undefined): { amount: number; currency: string } | undefined {
  let amount = 0;
  let currency: string | undefined;
  let found = false;
  for (const roomType of roomTypes ?? []) {
    for (const rate of roomType.rates ?? []) {
      const totals = rate.retailRate?.total;
      const totalList = Array.isArray(totals) ? totals : totals !== undefined ? [totals] : [];
      for (const total of totalList) {
        const totalAmount = toNumber(total.amount);
        const totalCurrency = toCurrency(total.currency);
        if (totalAmount === undefined || totalCurrency === undefined) continue;
        if (currency !== undefined && totalCurrency !== currency) return undefined;
        currency = totalCurrency;
        amount += totalAmount;
        found = true;
      }
    }
  }
  if (!found || currency === undefined) return undefined;
  return { amount: Math.round(amount * 100) / 100, currency };
}

/**
 * liteAPI cancel deadlines arrive as `YYYY-MM-DD HH:mm:ss` with a separate
 * timezone field (observed: GMT). The contract wants IsoDateTime with an
 * offset, so GMT/UTC values are mapped deterministically; anything the
 * mapping cannot honor stays out instead of becoming invented certainty.
 */
function toIsoDeadline(value: unknown, timezone: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?$/.test(value)) {
    return value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/);
  if (match && (timezone === 'GMT' || timezone === 'UTC')) {
    return `${match[1]}T${match[2]}Z`;
  }
  return undefined;
}

/**
 * Provider-neutral cancellation posture from cancelPolicyInfos:
 * deadline = latest zero-penalty cancelTime; fee = first positive penalty.
 */
function cancellationPosture(infos: NuiteeCancelPolicyInfoRaw[] | undefined): {
  deadline?: string;
  fee?: { amount: number; currency: string };
} {
  const deadlineInfos = (infos ?? [])
    .filter((info) => typeof info.cancelTime === 'string' && toNumber(info.amount) === 0)
    .sort((a, b) => String(a.cancelTime).localeCompare(String(b.cancelTime)));
  const penaltyInfo = (infos ?? []).find((info) => {
    const amount = toNumber(info.amount);
    return amount !== undefined && amount > 0;
  });
  const lastDeadline = deadlineInfos.length > 0 ? deadlineInfos[deadlineInfos.length - 1]! : undefined;
  const deadline = lastDeadline ? toIsoDeadline(lastDeadline.cancelTime, lastDeadline.timezone) : undefined;
  const penaltyAmount = penaltyInfo ? toNumber(penaltyInfo.amount) : undefined;
  const penaltyCurrency = penaltyInfo ? toCurrency(penaltyInfo.currency) : undefined;
  return {
    ...(deadline ? { deadline } : {}),
    ...(penaltyAmount !== undefined && penaltyCurrency !== undefined
      ? { fee: { amount: penaltyAmount, currency: penaltyCurrency } }
      : {}),
  };
}

function roomDescriptionFor(roomType: NuiteeRoomTypeRaw): string | undefined {
  const rate = roomType.rates?.[0];
  const name = rate?.name ?? roomType.name;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const board = rate?.boardName;
  return typeof board === 'string' && board.length > 0 && board !== name ? `${name} (${board})` : name;
}

// ---------------------------------------------------------------------------
// Normalization (deterministic projection of provider-shaped raw data)
// ---------------------------------------------------------------------------

export function normalizeSearch(raw: NuiteeSearchRaw): HotelSearchOutcome {
  const properties: HotelPropertyView[] = [];
  for (const hotel of raw.hotels ?? []) {
    if (typeof hotel.id !== 'string' || hotel.id.length === 0) continue;
    if (typeof hotel.name !== 'string' || hotel.name.length === 0) continue;
    const view: HotelPropertyView = {
      propertyId: hotel.id,
      name: hotel.name,
      externalRefs: [{ system: NUITEE_HOTEL_ID_REF_SYSTEM, value: hotel.id }],
    };
    if (typeof hotel.address === 'string' && hotel.address.length > 0) view.address = hotel.address;
    if (typeof hotel.latitude === 'number' && typeof hotel.longitude === 'number') {
      view.coordinates = { latitude: hotel.latitude, longitude: hotel.longitude };
    }
    properties.push(view);
  }

  const rates: HotelRateView[] = [];
  for (const hotel of raw.data ?? []) {
    const propertyId = typeof hotel.hotelId === 'string' ? hotel.hotelId : '';
    if (propertyId.length === 0) continue;
    for (const roomType of hotel.roomTypes ?? []) {
      const offerId = typeof roomType.offerId === 'string' ? roomType.offerId : '';
      if (offerId.length === 0) continue;
      const totalPrice = sumRetailTotals([roomType]);
      if (totalPrice === undefined) continue;
      const rate = roomType.rates?.[0];
      const policies = rate?.cancellationPolicies;
      const posture = cancellationPosture(policies?.cancelPolicyInfos);
      const view: HotelRateView = {
        // The offerId is the opaque handle quoteRate/book need; preserved
        // exactly, never reinterpreted.
        rateId: offerId,
        propertyId,
        totalPrice,
        refundable: policies?.refundableTag === 'RFN',
        availability: 'AVAILABLE',
      };
      const description = roomDescriptionFor(roomType);
      if (description) view.roomDescription = description;
      if (posture.deadline) view.cancellationDeadline = posture.deadline;
      if (posture.fee) view.cancellationFee = posture.fee;
      rates.push(view);
    }
  }
  return { properties, rates };
}

export function normalizeQuote(raw: NuiteePrebookRaw): HotelQuoteOutcome {
  const data = raw.data ?? {};
  const prebookId = typeof data.prebookId === 'string' && data.prebookId.length > 0 ? data.prebookId : undefined;
  if (prebookId === undefined) return { status: 'UNAVAILABLE' };
  const differencePercent = toNumber(raw.priceDifferencePercent ?? data.priceDifferencePercent);
  const status = differencePercent !== undefined && differencePercent !== 0 ? 'PRICE_CHANGED' : 'QUOTED';
  const outcome: HotelQuoteOutcome = { status, quoteId: prebookId };
  const quotedPrice = sumRetailTotals(data.roomTypes);
  if (quotedPrice) outcome.quotedPrice = quotedPrice;
  return outcome;
}

export function normalizeBook(raw: NuiteeBookRaw, mode: AdapterMode): HotelBookingOutcome {
  const data = raw.data ?? {};
  const outcome: HotelBookingOutcome = {
    confirmed: data.status === 'CONFIRMED',
    provenance: mode === 'REPLAY' ? 'REPLAY' : 'LIVE',
  };
  if (typeof data.bookingId === 'string' && data.bookingId.length > 0) {
    outcome.bookingId = data.bookingId;
  }
  if (typeof data.hotelConfirmationCode === 'string' && data.hotelConfirmationCode.length > 0) {
    outcome.providerConfirmationCode = data.hotelConfirmationCode;
  }
  const totalPrice =
    sumRetailTotals(data.roomTypes) ??
    sumRetailTotals(data.bookedRooms?.map((room) => ({ rates: room.rate ? [room.rate] : [] })));
  if (totalPrice) outcome.totalPrice = totalPrice;
  return outcome;
}

export function mapBookingStatus(status: unknown): HotelBookingStatusView['status'] {
  if (status === 'CONFIRMED') return 'CONFIRMED';
  if (status === 'CANCELLED' || status === 'CANCELLED_WITH_CHARGES') return 'CANCELLED';
  if (status === 'COMPLETED') return 'COMPLETED';
  return 'UNKNOWN';
}

/** liteAPI stay dates are often date-only; the contract wants IsoDateTime,
 *  so date-only values are omitted rather than padded with invented times. */
function toIsoDateTimeOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : undefined;
}

export function normalizeRetrieve(raw: NuiteeRetrieveRaw): HotelBookingStatusView {
  const data = raw.data ?? {};
  const view: HotelBookingStatusView = {
    bookingId: typeof data.bookingId === 'string' ? data.bookingId : '',
    status: mapBookingStatus(data.status),
  };
  if (typeof data.hotelName === 'string' && data.hotelName.length > 0) {
    view.propertyName = data.hotelName;
  }
  const checkIn = toIsoDateTimeOrUndefined(data.checkin);
  if (checkIn) view.checkIn = checkIn;
  const checkOut = toIsoDateTimeOrUndefined(data.checkout);
  if (checkOut) view.checkOut = checkOut;
  const posture = cancellationPosture(data.cancellationPolicies?.cancelPolicyInfos);
  if (posture.fee) view.cancellationFee = posture.fee;
  return view;
}

export function normalizeCancel(raw: NuiteeCancelRaw, mode: AdapterMode): HotelActionOutcome {
  const data = raw.data ?? {};
  const outcome: HotelActionOutcome = {
    confirmed: data.status === 'CANCELLED' || data.status === 'CANCELLED_WITH_CHARGES',
    provenance: mode === 'REPLAY' ? 'REPLAY' : 'LIVE',
  };
  if (typeof data.bookingId === 'string' && data.bookingId.length > 0) {
    outcome.reference = data.bookingId;
  }
  const feeAmount = toNumber(data.cancellation_fee);
  const feeCurrency = toCurrency(data.currency);
  if (feeAmount !== undefined && feeCurrency !== undefined) {
    outcome.fee = { amount: feeAmount, currency: feeCurrency };
  }
  return outcome;
}

export function normalizeStayContext(raw: NuiteeRetrieveRaw): StayContext {
  const data = raw.data ?? {};
  const context: StayContext = {};
  if (typeof data.hotelName === 'string' && data.hotelName.length > 0) {
    context.propertyName = data.hotelName;
  }
  const checkIn = toIsoDateTimeOrUndefined(data.checkin);
  const checkOut = toIsoDateTimeOrUndefined(data.checkout);
  if (checkIn || checkOut) {
    context.checkInWindow = {
      ...(checkIn ? { start: checkIn } : {}),
      ...(checkOut ? { end: checkOut } : {}),
    };
  }
  const policies = data.cancellationPolicies;
  if (policies && typeof policies.refundableTag === 'string') {
    const posture = cancellationPosture(policies.cancelPolicyInfos);
    const cancellation: NonNullable<StayContext['cancellation']> = {
      refundable: policies.refundableTag === 'RFN',
    };
    if (posture.deadline) cancellation.deadline = posture.deadline;
    if (posture.fee) cancellation.fee = posture.fee;
    context.cancellation = cancellation;
  }
  return context;
}
