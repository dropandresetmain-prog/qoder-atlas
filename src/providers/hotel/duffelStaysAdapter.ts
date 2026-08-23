/**
 * C5 — Duffel Stays-shaped HotelCapability adapter (synthetic, REPLAY-first).
 *
 * Wave 1 probe verdict: Duffel Stays signup was manually blocked, so the
 * shape is REPLAY-first — there is no real credentials path in this build.
 * The LIVE HTTP seam targets a Duffel-like stays surface (base URL + API
 * key) but fails closed when credentials are absent.
 *
 * Operations (all are money-moving except the imported-booking context):
 *  - getStayContext   (READ_ONLY, Checkpoint-C surface, no provider call
 *                      in REPLAY; LIVE just retrieves an existing booking
 *                      by reference)
 *  - searchHotels     (READ_ONLY)
 *  - quoteRate        (READ_ONLY, returns a quoteId/handle for bookStay)
 *  - bookStay         (BOOKING_SIDE_EFFECT, provenance REPLAY/SIMULATED)
 *  - retrieveBooking  (READ_ONLY)
 *  - modifyStay       (BOOKING_SIDE_EFFECT, provenance REPLAY/SIMULATED)
 *  - cancelStay       (BOOKING_SIDE_EFFECT, provenance REPLAY/SIMULATED)
 *
 * Money-moving operations never produce authoritative state changes from
 * the adapter itself: they return a structured outcome with provenance and
 * an opaque reference, and the operational layer must wrap them in
 * ActionIntents before any persistence.
 */
import { type AdapterMode, type CapabilityResult, type ProviderAdapter } from '../../contracts/envelope.ts';
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

export const DUFFEL_STAYS_PROVIDER_ID = 'duffel-stays';

/**
 * Synthetic default endpoint; real deployments override via DUFFEL_STAYS_BASE_URL.
 * The default target is intentionally a placeholder host so accidental LIVE
 * calls without credentials fail closed at the network layer too.
 */
const DEFAULT_DUFFEL_STAYS_BASE_URL = 'https://stays.duffel.example/v2';

/** Raw body shapes for a Duffel-like stays API. The schema is intentionally
 *  permissive (zod object) — recordings may carry extra provider fields; the
 *  normalizer consumes only the documented projection. */
export interface DuffelStaysSearchRaw {
  data?: {
    properties?: Array<DuffelStaysPropertyRaw>;
    rates?: Array<DuffelStaysRateRaw>;
  };
}

export interface DuffelStaysPropertyRaw {
  id?: string;
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  external_refs?: Array<{ system: string; value: string }>;
}

export interface DuffelStaysRateRaw {
  id?: string;
  property_id?: string;
  room_description?: string;
  total_amount?: string | number;
  total_currency?: string;
  refundable?: boolean;
  cancellation_deadline?: string;
  cancellation_fee_amount?: string | number;
  cancellation_fee_currency?: string;
  availability?: 'AVAILABLE' | 'LIMITED' | 'UNKNOWN';
  expires_at?: string;
}

export interface DuffelStaysQuoteRaw {
  data?: {
    status?: 'QUOTED' | 'PRICE_CHANGED' | 'UNAVAILABLE';
    quoted_amount?: string | number;
    quoted_currency?: string;
    original_amount?: string | number;
    original_currency?: string;
    quote_id?: string;
  };
}

export interface DuffelStaysBookRaw {
  data?: {
    confirmed?: boolean;
    booking_id?: string;
    provider_confirmation_code?: string;
    total_amount?: string | number;
    total_currency?: string;
  };
}

export interface DuffelStaysRetrieveRaw {
  data?: {
    booking_id?: string;
    status?: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'UNKNOWN';
    property_name?: string;
    check_in?: string;
    check_out?: string;
    cancellation_fee_amount?: string | number;
    cancellation_fee_currency?: string;
  };
}

export interface DuffelStaysCancelRaw {
  data?: {
    confirmed?: boolean;
    reference?: string;
    fee_amount?: string | number;
    fee_currency?: string;
  };
}

export interface DuffelStaysModifyRaw {
  data?: {
    confirmed?: boolean;
    reference?: string;
    fee_amount?: string | number;
    fee_currency?: string;
  };
}

export interface DuffelStaysStayContextRaw {
  data?: {
    property_name?: string;
    check_in_window_start?: string;
    check_in_window_end?: string;
    no_show_cutoff?: string;
    late_arrival_supported?: boolean;
    cancellation_refundable?: boolean;
    cancellation_deadline?: string;
    cancellation_fee_amount?: string | number;
    cancellation_fee_currency?: string;
  };
}

export interface DuffelStaysAdapterOptions {
  mode: AdapterMode;
  store: RecordingStore;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * The DuffelStays adapter is honest about side-effect level: it advertises
 * MONEY_MOVING on the descriptor because book/modify/cancel exist and move
 * money against the provider.
 */
export class DuffelStaysAdapter implements HotelCapability {
  readonly descriptor: CapabilityDescriptor;
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DuffelStaysAdapterOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.descriptor = {
      family: 'HOTEL',
      providerId: DUFFEL_STAYS_PROVIDER_ID,
      mode: options.mode,
      supportedOperations: [
        'hotel.context',
        'hotel.search',
        'hotel.quote',
        'hotel.book',
        'hotel.modify',
        'hotel.cancel',
        'hotel.retrieve',
      ],
      maxSideEffectLevel: 'MONEY_MOVING',
    };
  }

  async getStayContext(query: StayContextQuery): Promise<CapabilityResult<StayContext>> {
    const adapter: ProviderAdapter<StayContextQuery, DuffelStaysStayContextRaw, StayContext> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
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
    const adapter: ProviderAdapter<HotelSearchQuery, DuffelStaysSearchRaw, HotelSearchOutcome> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
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
    const adapter: ProviderAdapter<HotelQuoteQuery, DuffelStaysQuoteRaw, HotelQuoteOutcome> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
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
    const adapter: ProviderAdapter<HotelBookQuery, DuffelStaysBookRaw, HotelBookingOutcome> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
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
    const adapter: ProviderAdapter<HotelRetrieveQuery, DuffelStaysRetrieveRaw, HotelBookingStatusView> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchRetrieveRaw(request),
      normalize: normalizeRetrieve,
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'retrieve',
      secrets: this.secrets(),
    });
  }

  async modifyStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
    const adapter: ProviderAdapter<HotelActionQuery, DuffelStaysModifyRaw, HotelActionOutcome> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.fetchModifyRaw(request),
      normalize: (raw) => normalizeModify(raw, this.mode),
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'modify',
      secrets: this.secrets(),
    });
  }

  async cancelStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
    const adapter: ProviderAdapter<HotelActionQuery, DuffelStaysCancelRaw, HotelActionOutcome> = {
      providerId: DUFFEL_STAYS_PROVIDER_ID,
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

  private liveConfigured(): { baseUrl: string; apiKey: string } {
    if (this.mode === 'REPLAY') {
      throw capabilityFailure(
        'PROVIDER_ERROR',
        'duffel_stays_live_call_in_replay',
        'REPLAY must not call the provider',
      );
    }
    if (!this.baseUrl || !this.apiKey) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'duffel_stays_missing_credentials',
        'Duffel Stays LIVE/RECORD requires DUFFEL_STAYS_BASE_URL and DUFFEL_STAYS_API_KEY',
      );
    }
    return { baseUrl: this.baseUrl, apiKey: this.apiKey };
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const { baseUrl, apiKey } = this.liveConfigured();
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'duffel-version': '2024-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw capabilityFailure('TIMEOUT', 'duffel_stays_timeout', 'Duffel Stays timed out', true);
      }
      throw capabilityFailure(
        'NETWORK',
        'duffel_stays_network_error',
        `Duffel Stays unreachable: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw capabilityFailure('AUTH', `duffel_stays_http_${response.status}`, 'Duffel Stays rejected the API key');
      }
      if (response.status === 429) {
        throw capabilityFailure('RATE_LIMITED', 'duffel_stays_http_429', 'Duffel Stays rate limited', true);
      }
      if (response.status >= 500) {
        throw capabilityFailure(
          'PROVIDER_ERROR',
          `duffel_stays_http_${response.status}`,
          `Duffel Stays failed with HTTP ${response.status}`,
          true,
        );
      }
      throw capabilityFailure(
        'PROVIDER_ERROR',
        `duffel_stays_http_${response.status}`,
        `Duffel Stays failed: ${text.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw capabilityFailure('PROVIDER_ERROR', 'duffel_stays_non_json', 'Duffel Stays returned a non-JSON body');
    }
  }

  private fetchSearchRaw(query: HotelSearchQuery): Promise<DuffelStaysSearchRaw> {
    return this.post<DuffelStaysSearchRaw>('/stays/search', {
      location: query.location,
      check_in_date: query.checkInDate,
      check_out_date: query.checkOutDate,
      guests: query.guests ?? { adults: 1 },
      rooms: query.rooms ?? 1,
    });
  }

  private fetchQuoteRaw(query: HotelQuoteQuery): Promise<DuffelStaysQuoteRaw> {
    return this.post<DuffelStaysQuoteRaw>('/stays/quotes', {
      rate_id: query.rateId,
      ...(query.workflowState ? { workflow_state: query.workflowState } : {}),
    });
  }

  private fetchBookRaw(query: HotelBookQuery): Promise<DuffelStaysBookRaw> {
    return this.post<DuffelStaysBookRaw>('/stays/bookings', {
      quote_id: query.quoteId,
      guest_names: query.guestNames,
      ...(query.paymentRef ? { payment_ref: query.paymentRef } : {}),
      ...(query.clientReference ? { client_reference: query.clientReference } : {}),
    });
  }

  private fetchRetrieveRaw(query: HotelRetrieveQuery): Promise<DuffelStaysRetrieveRaw> {
    return this.post<DuffelStaysRetrieveRaw>(`/stays/bookings/${encodeURIComponent(query.bookingId)}/retrieve`, {});
  }

  private fetchModifyRaw(query: HotelActionQuery): Promise<DuffelStaysModifyRaw> {
    return this.post<DuffelStaysModifyRaw>(
      `/stays/bookings/${encodeURIComponent(query.stayElementId)}/modify`,
      {
        ...(query.reason ? { reason: query.reason } : {}),
        ...(query.newCheckIn ? { new_check_in: query.newCheckIn } : {}),
        ...(query.newCheckOut ? { new_check_out: query.newCheckOut } : {}),
      },
    );
  }

  private fetchCancelRaw(query: HotelActionQuery): Promise<DuffelStaysCancelRaw> {
    return this.post<DuffelStaysCancelRaw>(
      `/stays/bookings/${encodeURIComponent(query.stayElementId)}/cancel`,
      {
        ...(query.reason ? { reason: query.reason } : {}),
      },
    );
  }

  private fetchStayContextRaw(query: StayContextQuery): Promise<DuffelStaysStayContextRaw> {
    return this.post<DuffelStaysStayContextRaw>(
      `/stays/bookings/${encodeURIComponent(query.stayElementId)}/context`,
      {},
    );
  }

  private secrets(): string[] {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0 ? [this.apiKey] : [];
  }
}

export const DUFFEL_STAYS_DEFAULT_BASE_URL = DEFAULT_DUFFEL_STAYS_BASE_URL;

// ---------------------------------------------------------------------------
// Normalization (deterministic projection of provider-shaped raw data)
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

export function normalizeSearch(raw: DuffelStaysSearchRaw): HotelSearchOutcome {
  const properties: HotelPropertyView[] = [];
  for (const p of raw.data?.properties ?? []) {
    if (typeof p.id !== 'string' || p.id.length === 0) continue;
    if (typeof p.name !== 'string' || p.name.length === 0) continue;
    const view: HotelPropertyView = {
      propertyId: p.id,
      name: p.name,
      ...(p.address ? { address: p.address } : {}),
      ...(typeof p.latitude === 'number' && typeof p.longitude === 'number'
        ? { coordinates: { latitude: p.latitude, longitude: p.longitude } }
        : {}),
      ...(p.external_refs && p.external_refs.length > 0
        ? { externalRefs: p.external_refs.map((ref) => ({ system: ref.system, value: ref.value })) }
        : {}),
    };
    properties.push(view);
  }
  const rates: HotelRateView[] = [];
  for (const r of raw.data?.rates ?? []) {
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    if (typeof r.property_id !== 'string' || r.property_id.length === 0) continue;
    const amount = toNumber(r.total_amount);
    const currency = toCurrency(r.total_currency);
    if (amount === undefined || currency === undefined) continue;
    const feeAmount = toNumber(r.cancellation_fee_amount);
    const feeCurrency = toCurrency(r.cancellation_fee_currency);
    const view: HotelRateView = {
      rateId: r.id,
      propertyId: r.property_id,
      totalPrice: { amount, currency },
      refundable: r.refundable === true,
      availability: r.availability ?? 'UNKNOWN',
      ...(r.room_description ? { roomDescription: r.room_description } : {}),
      ...(r.cancellation_deadline ? { cancellationDeadline: r.cancellation_deadline } : {}),
      ...(feeAmount !== undefined && feeCurrency !== undefined
        ? { cancellationFee: { amount: feeAmount, currency: feeCurrency } }
        : {}),
      ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
    };
    rates.push(view);
  }
  return { properties, rates };
}

export function normalizeQuote(raw: DuffelStaysQuoteRaw): HotelQuoteOutcome {
  const data = raw.data ?? {};
  const status = data.status ?? 'UNAVAILABLE';
  if (status === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE' };
  }
  const quotedAmount = toNumber(data.quoted_amount);
  const quotedCurrency = toCurrency(data.quoted_currency);
  const originalAmount = toNumber(data.original_amount);
  const originalCurrency = toCurrency(data.original_currency);
  const outcome: HotelQuoteOutcome = { status };
  if (quotedAmount !== undefined && quotedCurrency !== undefined) {
    outcome.quotedPrice = { amount: quotedAmount, currency: quotedCurrency };
  }
  if (
    status === 'PRICE_CHANGED' &&
    quotedAmount !== undefined &&
    quotedCurrency !== undefined &&
    originalAmount !== undefined &&
    originalCurrency !== undefined &&
    quotedCurrency === originalCurrency
  ) {
    outcome.priceDelta = { amount: Math.round((quotedAmount - originalAmount) * 100) / 100, currency: quotedCurrency };
  }
  if (typeof data.quote_id === 'string' && data.quote_id.length > 0) {
    outcome.quoteId = data.quote_id;
  }
  return outcome;
}

export function normalizeBook(raw: DuffelStaysBookRaw, mode: AdapterMode): HotelBookingOutcome {
  const data = raw.data ?? {};
  const outcome: HotelBookingOutcome = {
    confirmed: data.confirmed === true,
    provenance: mode === 'REPLAY' ? 'REPLAY' : 'SIMULATED',
  };
  if (typeof data.booking_id === 'string' && data.booking_id.length > 0) {
    outcome.bookingId = data.booking_id;
  }
  if (typeof data.provider_confirmation_code === 'string' && data.provider_confirmation_code.length > 0) {
    outcome.providerConfirmationCode = data.provider_confirmation_code;
  }
  const amount = toNumber(data.total_amount);
  const currency = toCurrency(data.total_currency);
  if (amount !== undefined && currency !== undefined) {
    outcome.totalPrice = { amount, currency };
  }
  return outcome;
}

export function normalizeRetrieve(raw: DuffelStaysRetrieveRaw): HotelBookingStatusView {
  const data = raw.data ?? {};
  const view: HotelBookingStatusView = {
    bookingId: typeof data.booking_id === 'string' ? data.booking_id : '',
    status: data.status ?? 'UNKNOWN',
  };
  if (typeof data.property_name === 'string' && data.property_name.length > 0) {
    view.propertyName = data.property_name;
  }
  if (typeof data.check_in === 'string' && data.check_in.length > 0) {
    view.checkIn = data.check_in;
  }
  if (typeof data.check_out === 'string' && data.check_out.length > 0) {
    view.checkOut = data.check_out;
  }
  const amount = toNumber(data.cancellation_fee_amount);
  const currency = toCurrency(data.cancellation_fee_currency);
  if (amount !== undefined && currency !== undefined) {
    view.cancellationFee = { amount, currency };
  }
  return view;
}

export function normalizeCancel(raw: DuffelStaysCancelRaw, mode: AdapterMode): HotelActionOutcome {
  const data = raw.data ?? {};
  const outcome: HotelActionOutcome = {
    confirmed: data.confirmed === true,
    provenance: mode === 'REPLAY' ? 'REPLAY' : 'SIMULATED',
  };
  if (typeof data.reference === 'string' && data.reference.length > 0) {
    outcome.reference = data.reference;
  }
  const amount = toNumber(data.fee_amount);
  const currency = toCurrency(data.fee_currency);
  if (amount !== undefined && currency !== undefined) {
    outcome.fee = { amount, currency };
  }
  return outcome;
}

export function normalizeModify(raw: DuffelStaysModifyRaw, mode: AdapterMode): HotelActionOutcome {
  // Same shape as cancel in this adapter; semantic differs upstream.
  return normalizeCancel(
    {
      data: {
        confirmed: raw.data?.confirmed,
        reference: raw.data?.reference,
        fee_amount: raw.data?.fee_amount,
        fee_currency: raw.data?.fee_currency,
      },
    },
    mode,
  );
}

export function normalizeStayContext(raw: DuffelStaysStayContextRaw): StayContext {
  const data = raw.data ?? {};
  const context: StayContext = {};
  if (typeof data.property_name === 'string' && data.property_name.length > 0) {
    context.propertyName = data.property_name;
  }
  if (typeof data.check_in_window_start === 'string' || typeof data.check_in_window_end === 'string') {
    context.checkInWindow = {
      ...(typeof data.check_in_window_start === 'string' ? { start: data.check_in_window_start } : {}),
      ...(typeof data.check_in_window_end === 'string' ? { end: data.check_in_window_end } : {}),
    };
  }
  if (typeof data.no_show_cutoff === 'string' && data.no_show_cutoff.length > 0) {
    context.noShowCutoff = data.no_show_cutoff;
  }
  if (typeof data.late_arrival_supported === 'boolean') {
    context.lateArrivalSupported = data.late_arrival_supported;
  }
  if (
    typeof data.cancellation_refundable === 'boolean' ||
    typeof data.cancellation_deadline === 'string' ||
    (toNumber(data.cancellation_fee_amount) !== undefined && toCurrency(data.cancellation_fee_currency) !== undefined)
  ) {
    const cancellation: StayContext['cancellation'] = {
      refundable: data.cancellation_refundable === true,
    };
    if (typeof data.cancellation_deadline === 'string' && data.cancellation_deadline.length > 0) {
      cancellation.deadline = data.cancellation_deadline;
    }
    const feeAmount = toNumber(data.cancellation_fee_amount);
    const feeCurrency = toCurrency(data.cancellation_fee_currency);
    if (feeAmount !== undefined && feeCurrency !== undefined) {
      cancellation.fee = { amount: feeAmount, currency: feeCurrency };
    }
    context.cancellation = cancellation;
  }
  return context;
}
