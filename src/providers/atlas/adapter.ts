/**
 * C2 — Atlas direct-API FlightCapability adapter (read-only surface).
 *
 * Implemented endpoints: search.do, verify.do (verify also carries the
 * fare/change/refund/no-show rule block needed by recovery). Transactional
 * surfaces (order.do, payment, ticketing, changes/cancels) are intentionally
 * not implemented. The adapter only maps between Atlas wire shapes and the
 * frozen provider-neutral contracts; viability/policy decisions stay in core.
 */
import type { AdapterMode, CapabilityResult, ProviderAdapter } from '../../contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  FareRulesOutcome,
  FlightCapability,
  FlightSearchOutcome,
  FlightSearchQuery,
  FlightVerifyOutcome,
  FlightVerifyQuery,
} from '../../contracts/capabilities.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';
import { AtlasClient, assertProviderSuccess } from './client.ts';
import {
  normalizeFareRules,
  normalizeSearch,
  normalizeVerify,
  type PassengerCounts,
} from './normalize.ts';
import {
  AtlasSearchBodySchema,
  AtlasVerifyBodySchema,
  type AtlasSearchBody,
  type AtlasVerifyBody,
} from './types.ts';

export const ATLAS_PROVIDER_ID = 'atlas';

const VERIFY_MAX_RESPONSE_TIME_MS = 15_000;

export interface AtlasAdapterOptions {
  mode: AdapterMode;
  store: RecordingStore;
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class AtlasFlightAdapter implements FlightCapability {
  readonly descriptor: CapabilityDescriptor;
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly baseUrl?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: typeof fetch;
  /** Passenger counts per offer, remembered from search for verify pricing. */
  private readonly offerPassengers = new Map<string, PassengerCounts>();

  constructor(options: AtlasAdapterOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;
    this.descriptor = {
      family: 'FLIGHT',
      providerId: ATLAS_PROVIDER_ID,
      mode: options.mode,
      supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'],
      maxSideEffectLevel: 'READ_ONLY',
    };
  }

  async searchFlights(query: FlightSearchQuery): Promise<CapabilityResult<FlightSearchOutcome>> {
    const validation = validateSearchQuery(query, this.mode);
    if (validation) return validation;

    const passengers: PassengerCounts = {
      adults: query.passengers.adults,
      ...(query.passengers.children === undefined ? {} : { children: query.passengers.children }),
      ...(query.passengers.infants === undefined ? {} : { infants: query.passengers.infants }),
    };
    const adapter: ProviderAdapter<FlightSearchQuery, AtlasSearchBody, FlightSearchOutcome> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => {
        const body = await this.post('/search.do', {
          cid: this.clientId,
          tripType: '1',
          adultNum: request.passengers.adults,
          childNum: request.passengers.children ?? 0,
          infantNum: request.passengers.infants ?? 0,
          fromCity: request.origin.value.toUpperCase(),
          toCity: request.destination.value.toUpperCase(),
          fromDate: request.departureDate.replaceAll('-', ''),
        });
        return AtlasSearchBodySchema.parse(body);
      },
      normalize: (raw) => normalizeSearch(raw, passengers),
    };

    const result = await runAdapter(adapter, this.store, query, {
      operation: 'search',
      secrets: this.secrets(),
    });
    if (result.ok) {
      for (const offer of result.data.offers) {
        this.offerPassengers.set(offer.offerId, passengers);
      }
    }
    return result;
  }

  async verifyOffer(query: FlightVerifyQuery): Promise<CapabilityResult<FlightVerifyOutcome>> {
    const passengers = this.offerPassengers.get(query.offerId);
    const adapter: ProviderAdapter<FlightVerifyQuery, AtlasVerifyBody, FlightVerifyOutcome> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.verifyRaw(request),
      normalize: (raw) => normalizeVerify(raw, passengers),
    };
    return runAdapter(adapter, this.store, { offerId: query.offerId }, {
      operation: 'verify',
      secrets: this.secrets(),
    });
  }

  async getFareRules(query: FlightVerifyQuery): Promise<CapabilityResult<FareRulesOutcome>> {
    const adapter: ProviderAdapter<FlightVerifyQuery, AtlasVerifyBody, FareRulesOutcome> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.verifyRaw(request),
      normalize: (raw) => normalizeFareRules(raw.routing?.rule),
    };
    return runAdapter(adapter, this.store, { offerId: query.offerId }, {
      operation: 'fare_rules',
      secrets: this.secrets(),
    });
  }

  private async verifyRaw(query: FlightVerifyQuery): Promise<AtlasVerifyBody> {
    const body = await this.post('/verify.do', {
      routingIdentifier: query.offerId,
      maxResponseTime: VERIFY_MAX_RESPONSE_TIME_MS,
    });
    return AtlasVerifyBodySchema.parse(body);
  }

  private async post(endpoint: '/search.do' | '/verify.do', body: Record<string, unknown>): Promise<unknown> {
    const client = this.liveClient();
    const raw = await client.post(endpoint, body);
    assertProviderSuccess(raw, endpoint);
    return raw;
  }

  private liveClient(): AtlasClient {
    if (this.mode === 'REPLAY') {
      throw capabilityFailure('PROVIDER_ERROR', 'atlas_live_call_in_replay', 'REPLAY must not call the provider');
    }
    if (!this.baseUrl || !this.clientId || !this.clientSecret) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'atlas_missing_credentials',
        'Atlas LIVE/RECORD requires ATLAS_BASE_URL, ATLAS_CLIENT_ID and ATLAS_CLIENT_SECRET',
      );
    }
    return new AtlasClient({
      baseUrl: this.baseUrl,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
    });
  }

  private secrets(): string[] {
    return [this.clientId, this.clientSecret].filter((value): value is string => typeof value === 'string');
  }
}

const IATA_CODE = /^[A-Za-z]{3}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateSearchQuery(
  query: FlightSearchQuery,
  mode: AdapterMode,
): CapabilityResult<FlightSearchOutcome> | undefined {
  const problems: string[] = [];
  if (!IATA_CODE.test(query.origin.value)) problems.push(`origin code is not a 3-letter code: ${query.origin.value}`);
  if (!IATA_CODE.test(query.destination.value)) {
    problems.push(`destination code is not a 3-letter code: ${query.destination.value}`);
  }
  if (!LOCAL_DATE.test(query.departureDate)) problems.push(`departureDate is not YYYY-MM-DD: ${query.departureDate}`);
  if (query.passengers.adults < 1) problems.push('at least one adult is required');
  if (problems.length > 0) {
    return {
      ok: false,
      error: { category: 'INVALID_REQUEST', code: 'invalid_search_query', message: problems.join('; ') },
      meta: { providerId: ATLAS_PROVIDER_ID, mode, requestedAt: new Date().toISOString() },
    };
  }
  return undefined;
}
