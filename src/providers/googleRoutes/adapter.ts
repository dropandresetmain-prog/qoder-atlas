/**
 * C3 — Google Routes (computeRoutes) RoutingCapability adapter.
 *
 * Optional/non-blocking: without GOOGLE_ROUTES_API_KEY (or on network
 * failure) the adapter returns structured unavailable results instead of
 * crashing application logic. Provenance flows through the standard
 * CapabilityMeta/recording path shared with every other adapter.
 */
import { capabilityError, type AdapterMode, type CapabilityResult, type ProviderAdapter } from '../../contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  RouteContext,
  RoutingCapability,
  RoutingQuery,
} from '../../contracts/capabilities.ts';
import { type DurationEstimate, type IsoDateTime } from '../../domain/common.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { recordingIdFor } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';

export const GOOGLE_ROUTES_PROVIDER_ID = 'google-routes';

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.duration,routes.durationInTraffic,routes.distanceMeters';

export interface GoogleRoutesAdapterOptions {
  mode: AdapterMode;
  store: RecordingStore;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ComputeRoutesRaw {
  routes?: Array<{
    duration?: string;
    durationInTraffic?: string;
    distanceMeters?: number;
  }>;
}

export class GoogleRoutesAdapter implements RoutingCapability {
  readonly descriptor: CapabilityDescriptor;
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleRoutesAdapterOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.descriptor = {
      family: 'ROUTING',
      providerId: GOOGLE_ROUTES_PROVIDER_ID,
      mode: options.mode,
      supportedOperations: ['routing.context'],
      maxSideEffectLevel: 'READ_ONLY',
    };
  }

  async getRouteContext(query: RoutingQuery): Promise<CapabilityResult<RouteContext>> {
    const problem = validateQuery(query);
    if (problem) {
      return capabilityError(
        { category: 'INVALID_REQUEST', code: 'invalid_routing_query', message: problem },
        { providerId: GOOGLE_ROUTES_PROVIDER_ID, mode: this.mode, requestedAt: new Date().toISOString() },
      );
    }

    const observedAt = new Date().toISOString();
    const sourceId = `src:${GOOGLE_ROUTES_PROVIDER_ID}:${recordingIdFor(
      GOOGLE_ROUTES_PROVIDER_ID,
      'route_context',
      query,
    )}`;
    const adapter: ProviderAdapter<RoutingQuery, ComputeRoutesRaw, RouteContext> = {
      providerId: GOOGLE_ROUTES_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (request) => this.computeRoutes(request),
      normalize: (raw) => normalizeRouteContext(raw, observedAt, sourceId),
    };
    return runAdapter(adapter, this.store, query, {
      operation: 'route_context',
      secrets: this.apiKey ? [this.apiKey] : [],
    });
  }

  private async computeRoutes(query: RoutingQuery): Promise<ComputeRoutesRaw> {
    if (this.mode === 'REPLAY') {
      throw capabilityFailure('PROVIDER_ERROR', 'google_live_call_in_replay', 'REPLAY must not call the provider');
    }
    if (!this.apiKey) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'google_routes_missing_key',
        'Google Routes requires GOOGLE_ROUTES_API_KEY',
      );
    }

    const body = buildRequestBody(query);
    let response: Response;
    try {
      response = await this.fetchImpl(COMPUTE_ROUTES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask': FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw capabilityFailure('TIMEOUT', 'google_routes_timeout', 'Google Routes timed out', true);
      }
      throw capabilityFailure(
        'NETWORK',
        'google_routes_network_error',
        `Google Routes unreachable: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw capabilityFailure('AUTH', `google_routes_http_${response.status}`, 'Google Routes rejected the API key');
      }
      if (response.status === 429) {
        throw capabilityFailure('RATE_LIMITED', 'google_routes_http_429', 'Google Routes rate limited', true);
      }
      if (response.status === 400) {
        throw capabilityFailure('INVALID_REQUEST', 'google_routes_http_400', `Google Routes: ${text.slice(0, 200)}`);
      }
      throw capabilityFailure(
        'PROVIDER_ERROR',
        `google_routes_http_${response.status}`,
        `Google Routes failed with HTTP ${response.status}`,
        response.status >= 500,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw capabilityFailure('PROVIDER_ERROR', 'google_routes_non_json', 'Google Routes returned a non-JSON body');
    }
    return parsed as ComputeRoutesRaw;
  }
}

function validateQuery(query: RoutingQuery): string | undefined {
  for (const side of ['origin', 'destination'] as const) {
    const point = query[side];
    if (!point.coordinates && !point.externalRef) {
      return `${side} needs coordinates or an externalRef`;
    }
    if (point.externalRef && point.externalRef.system !== 'google_place_id') {
      return `${side} externalRef must use system 'google_place_id'`;
    }
  }
  return undefined;
}

function buildRequestBody(query: RoutingQuery): Record<string, unknown> {
  const mode = query.mode ?? 'DRIVE';
  const body: Record<string, unknown> = {
    origin: locationOf(query.origin),
    destination: locationOf(query.destination),
    travelMode: mode,
  };
  if (mode === 'DRIVE') {
    // Duration-in-traffic needs a departure intent; departAt supplies it.
    body.routingPreference = 'TRAFFIC_AWARE';
    body.departureTime = query.departAt ?? new Date().toISOString();
  }
  return body;
}

function locationOf(point: RoutingQuery['origin']): Record<string, unknown> {
  if (point.coordinates) {
    return {
      location: {
        latLng: { latitude: point.coordinates.latitude, longitude: point.coordinates.longitude },
      },
    };
  }
  return { placeId: point.externalRef!.value };
}

export function normalizeRouteContext(raw: ComputeRoutesRaw, observedAt: IsoDateTime, sourceId: string): RouteContext {
  const route = raw.routes?.[0];
  if (!route) {
    throw new Error('Google Routes returned no routes for this query');
  }
  const expectedSeconds = parseDurationSeconds(route.durationInTraffic ?? route.duration);
  if (expectedSeconds === undefined) {
    throw new Error('Google Routes returned no usable duration');
  }
  const expectedMinutes = Math.max(0, Math.round(expectedSeconds / 60));

  const estimate: DurationEstimate = {
    expectedMinutes,
    sourceId,
    observedAt,
    quality: 'MEDIUM',
  };
  const staticSeconds = parseDurationSeconds(route.duration);
  if (staticSeconds !== undefined) {
    estimate.minimumMinutes = Math.max(0, Math.round(staticSeconds / 60));
    estimate.conservativeMinutes = Math.max(expectedMinutes, Math.ceil((staticSeconds * 1.5) / 60));
  } else {
    estimate.conservativeMinutes = Math.ceil(expectedMinutes * 1.25);
  }

  const context: RouteContext = { duration: estimate };
  if (typeof route.distanceMeters === 'number') {
    context.distanceKm = Math.round((route.distanceMeters / 1000) * 10) / 10;
  }
  const trafficSeconds = parseDurationSeconds(route.durationInTraffic);
  if (trafficSeconds !== undefined) {
    const traffic = trafficConditionOf(staticSeconds, trafficSeconds);
    if (traffic) context.trafficCondition = traffic;
  }
  return context;
}

function parseDurationSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function trafficConditionOf(
  staticSeconds: number | undefined,
  effectiveSeconds: number,
): RouteContext['trafficCondition'] | undefined {
  if (staticSeconds === undefined || staticSeconds <= 0) return undefined;
  const ratio = effectiveSeconds / staticSeconds;
  if (ratio >= 1.5) return 'HEAVY';
  if (ratio >= 1.15) return 'MODERATE';
  if (ratio <= 1.05) return 'LIGHT';
  return 'UNKNOWN';
}
