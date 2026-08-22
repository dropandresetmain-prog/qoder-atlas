/**
 * C2 — Atlas direct API HTTP client (read-only surface only).
 *
 * The client only knows how to talk to Atlas and surface structured errors;
 * it never interprets business policy. Secrets travel in headers only and
 * are never logged or echoed into error messages.
 */
import { capabilityFailure } from '../runner.ts';

export const ATLAS_READ_ONLY_ENDPOINTS = ['/search.do', '/verify.do'] as const;
export type AtlasReadOnlyEndpoint = (typeof ATLAS_READ_ONLY_ENDPOINTS)[number];

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

  async post(endpoint: AtlasReadOnlyEndpoint, body: Record<string, unknown>): Promise<unknown> {
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
        `Atlas ${endpoint} unreachable: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw httpStatusFailure(endpoint, response.status, text);
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

function httpStatusFailure(endpoint: string, status: number, bodyText: string): never {
  const detail = providerMessage(bodyText) ?? `HTTP ${status}`;
  if (status === 401 || status === 403) {
    throw capabilityFailure('AUTH', `atlas_http_${status}`, `Atlas ${endpoint} rejected credentials: ${detail}`);
  }
  if (status === 429) {
    throw capabilityFailure('RATE_LIMITED', 'atlas_http_429', `Atlas ${endpoint} rate limited`, true);
  }
  if (status === 400 || status === 404 || status === 422) {
    throw capabilityFailure('INVALID_REQUEST', `atlas_http_${status}`, `Atlas ${endpoint}: ${detail}`);
  }
  throw capabilityFailure(
    'PROVIDER_ERROR',
    `atlas_http_${status}`,
    `Atlas ${endpoint} failed: ${detail}`,
    status >= 500,
  );
}

function providerMessage(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { msg?: unknown }).msg === 'string') {
      return (parsed as { msg: string }).msg;
    }
  } catch {
    // Non-JSON error body: fall through to the generic HTTP status message.
  }
  return undefined;
}

/** Atlas signals provider-level success with numeric status 0. */
export function assertProviderSuccess(raw: unknown, endpoint: AtlasReadOnlyEndpoint): void {
  const body = raw as { status?: unknown; msg?: unknown };
  if (body.status !== 0) {
    const msg = typeof body.msg === 'string' && body.msg !== '' ? body.msg : 'provider returned non-zero status';
    throw capabilityFailure(
      'PROVIDER_ERROR',
      `atlas_provider_status_${String(body.status)}`,
      `Atlas ${endpoint}: ${msg}`,
    );
  }
}
