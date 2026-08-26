/**
 * Northstar — Frankfurter FX adapter (ADR-052 supplement).
 *
 * Frankfurter (api.frankfurter.dev) publishes free, key-less reference rates
 * sourced from the European Central Bank; SGD is among its ~30 supported
 * official currencies, so an SGD quote is ECB-reference evidence rather than
 * a scraped market feed. The adapter is provider-neutral at the seam: it maps
 * raw Frankfurter responses into the SAME `FxRateEvidence` shape every other
 * source produces and feeds the identical deterministic conversion/authority
 * path — LIVE/RECORD/REPLAY share one normalization with no demo branch.
 *
 * Safety model (ADR-045/ADR-052 unchanged):
 *  - a failed/absent provider response is structured failure DATA; the
 *    resolver layers it UNDER organisation budget FX and both fail closed;
 *  - evidence is dated by the PROVIDER's own reference date (`date` field),
 *    never the fetch instant, so staleness judgement stays honest;
 *  - authority stays CONNECTED (a connected external reference source under
 *    the fact ladder): it may support policy comparison but never outranks
 *    AUTHORITATIVE organisation budget rulings at equal freshness.
 *  - No LLM arithmetic; no post-authority FX movement can raise spend.
 */
import { z } from 'zod';
import type { AdapterMode, CapabilityResult, ProviderAdapter } from '../../contracts/envelope.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';
import type { FxRateEvidence } from '../../engine/fx.ts';

export const FRANKFURTER_PROVIDER_ID = 'frankfurter';
export const FRANKFURTER_DEFAULT_BASE_URL = 'https://api.frankfurter.dev/v1';

/** Wire shape of `GET /v1/{date}|latest?base=..&symbols=..` (verified live). */
export const FrankfurterRateResponseSchema = z.strictObject({
  amount: z.number().positive(),
  base: z.string().regex(/^[A-Z]{3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive()),
});
export type FrankfurterRateResponse = z.infer<typeof FrankfurterRateResponseSchema>;

/** Normalized outcome of one Frankfurter lookup. */
export interface FxQuoteOutcome {
  /** Evidence records for every requested quote currency that came back. */
  rates: FxRateEvidence[];
}

/** Deterministic lookup request; also the recording-key projection. */
export interface FxQuoteRequest {
  baseCurrency: string;
  homeCurrency: string;
  /**
   * Reference date to request (`YYYY-MM-DD`). Omitted => `latest` endpoint.
   * The provider clamps future dates to its most recent business day, which
   * the resolver's temporal checks then judge honestly — a "future" fetch can
   * only ever return PAST reference data.
   */
  date?: string;
}

export interface FrankfurterFxAdapterOptions {
  mode: AdapterMode;
  store: RecordingStore;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Key-less read-only FX adapter over the generic LIVE/RECORD/REPLAY runner.
 * Every mode funnels through `runAdapter`, so RECORD persists a sanitized raw
 * payload and REPLAY loads it, while `normalizeFrankfurterResponse` runs
 * identically in all three modes.
 */
export class FrankfurterFxAdapter {
  readonly descriptor = {
    family: 'FX' as const,
    providerId: FRANKFURTER_PROVIDER_ID,
    mode: undefined as unknown as AdapterMode,
  };
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: FrankfurterFxAdapterOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.baseUrl = options.baseUrl ?? FRANKFURTER_DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl;
    this.descriptor.mode = options.mode;
  }

  async quote(request: FxQuoteRequest): Promise<CapabilityResult<FxQuoteOutcome>> {
    const adapter: ProviderAdapter<FxQuoteRequest, FrankfurterRateResponse, FxQuoteOutcome> = {
      providerId: FRANKFURTER_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: (r) => this.obtainRaw(r),
      normalize: normalizeFrankfurterResponse,
    };
    return runAdapter(adapter, this.store, request, { operation: 'fx.latest' });
  }

  /**
   * LIVE/RECORD hit the public API (no credentials exist); REPLAY never does.
   * The URL embeds only the currency pair + reference date, which is exactly
   * what the deterministic recording key hashes — same request, same key,
   * reproducible replay.
   */
  private async obtainRaw(request: FxQuoteRequest): Promise<FrankfurterRateResponse> {
    if (this.mode === 'REPLAY') {
      // Unreachable through quote() — runAdapter loads recordings before
      // obtainRaw — but kept as an explicit invariant guard.
      throw capabilityFailure(
        'PROVIDER_ERROR',
        'frankfurter_live_call_in_replay',
        'REPLAY must not call the provider',
      );
    }
    const path = request.date ?? 'latest';
    const url =
      `${this.baseUrl}/${path}?base=${encodeURIComponent(request.baseCurrency)}` +
      `&symbols=${encodeURIComponent(request.homeCurrency)}`;
    let response: Response;
    try {
      response = await (this.fetchImpl ?? fetch)(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw capabilityFailure(
        'NETWORK',
        'frankfurter_unreachable',
        `frankfurter request failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    if (!response.ok) {
      throw capabilityFailure(
        response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
        'frankfurter_http_error',
        `frankfurter responded ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }
    const parsed = FrankfurterRateResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw capabilityFailure(
        'PROVIDER_ERROR',
        'invalid_raw_response',
        `frankfurter payload failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
    }
    return parsed.data;
  }
}

/**
 * The single normalization shared by LIVE, RECORD and REPLAY. One raw
 * response becomes one evidence record per returned quote currency; the
 * observedAt instant is midnight UTC of the PROVIDER's reference date (the
 * honest observation time of an ECB daily fixing), and provenance names the
 * frankfurter source id plus CONNECTED authority.
 */
export function normalizeFrankfurterResponse(raw: FrankfurterRateResponse): FxQuoteOutcome {
  const observedAt = `${raw.date}T00:00:00Z`;
  const rates: FxRateEvidence[] = Object.entries(raw.rates).map(([quoteCurrency, rate]) => ({
    id: `fx_${FRANKFURTER_PROVIDER_ID}_${raw.base}_${quoteCurrency}_${raw.date}`.toLowerCase(),
    baseCurrency: raw.base,
    homeCurrency: quoteCurrency,
    rate,
    sourceId: `src_frankfurter_${raw.date}`,
    authority: 'CONNECTED' as const,
    observedAt,
  }));
  return { rates };
}
