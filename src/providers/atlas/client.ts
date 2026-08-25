/**
 * C2 — Atlas direct API HTTP client.
 *
 * The client only knows how to talk to Atlas and surface structured errors;
 * it never interprets business policy. Secrets travel in headers only and
 * are never logged or echoed into error messages.
 *
 * DR-2: the endpoint vocabulary now covers the proven transaction surface
 * (order/pay/query + void quotation/submission/status). Environment policy
 * (sandbox-only execution of consequential endpoints) is owned by the
 * transaction adapter, not by this transport.
 */
import { capabilityFailure } from '../runner.ts';

export const ATLAS_READ_ONLY_ENDPOINTS = ['/search.do', '/verify.do', '/event/getPageList.do'] as const;
export type AtlasReadOnlyEndpoint = (typeof ATLAS_READ_ONLY_ENDPOINTS)[number];

/** Consequential order-lifecycle endpoints (adapter-private wire names). */
export const ATLAS_TRANSACTION_ENDPOINTS = [
  '/order.do',
  '/pay.do',
  '/queryOrderDetails.do',
  '/voidQuotation.do',
  '/void.do',
  '/queryVoidOrders.do',
] as const;
export type AtlasTransactionEndpoint = (typeof ATLAS_TRANSACTION_ENDPOINTS)[number];
export type AtlasEndpoint = AtlasReadOnlyEndpoint | AtlasTransactionEndpoint;

export interface AtlasClientConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class AtlasClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AtlasClientConfig) {
    this.baseUrl = validatedBaseUrl(config.baseUrl);
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async post(endpoint: AtlasEndpoint, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-atlas-client-id': this.clientId,
          'x-atlas-client-secret': this.clientSecret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw capabilityFailure('TIMEOUT', 'atlas_timeout', `Atlas ${endpoint} timed out`, true);
      }
      throw capabilityFailure(
        'NETWORK',
        'atlas_network_error',
        `Atlas ${endpoint} unreachable (${error instanceof Error ? error.name : 'unknown'})`,
        true,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw httpStatusFailure(endpoint, response.status);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw capabilityFailure(
        'PROVIDER_ERROR',
        'atlas_non_json_response',
        `Atlas ${endpoint} returned a non-JSON body (HTTP ${response.status})`,
      );
    }
  }
}

export function validatedBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw capabilityFailure('NOT_CONFIGURED', 'atlas_invalid_base_url', 'ATLAS_BASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw capabilityFailure('NOT_CONFIGURED', 'atlas_insecure_base_url', 'ATLAS_BASE_URL must use HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw capabilityFailure(
      'NOT_CONFIGURED',
      'atlas_base_url_credentials',
      'ATLAS_BASE_URL must not embed credentials',
    );
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * P0.3 — provider free text (msg fields, HTTP bodies) is never echoed into
 * CapabilityError messages. Errors carry provider identity + category +
 * structured code + bounded summary only; raw bodies can hold PII or echoed
 * credentials and persist into case/audit state.
 */
function httpStatusFailure(endpoint: string, status: number): never {
  if (status === 401 || status === 403) {
    throw capabilityFailure('AUTH', `atlas_http_${status}`, `Atlas ${endpoint} rejected credentials (HTTP ${status})`);
  }
  if (status === 429) {
    throw capabilityFailure('RATE_LIMITED', 'atlas_http_429', `Atlas ${endpoint} rate limited`, true);
  }
  if (status === 400 || status === 404 || status === 422) {
    throw capabilityFailure('INVALID_REQUEST', `atlas_http_${status}`, `Atlas ${endpoint} rejected the request (HTTP ${status})`);
  }
  throw capabilityFailure(
    'PROVIDER_ERROR',
    `atlas_http_${status}`,
    `Atlas ${endpoint} failed (HTTP ${status})`,
    status >= 500,
  );
}

/** Atlas signals provider-level success with numeric status 0. */
export function assertProviderSuccess(raw: unknown, endpoint: string): void {
  const body = raw as { status?: unknown; msg?: unknown };
  if (body.status !== 0) {
    // P0.3: the provider's free-text msg is never echoed — it can contain PII
    // or echoed credentials. The structured code carries the status for triage.
    throw capabilityFailure(
      'PROVIDER_ERROR',
      `atlas_provider_status_${String(body.status)}`,
      `Atlas ${endpoint} rejected the request (provider status ${String(body.status)})`,
    );
  }
}
