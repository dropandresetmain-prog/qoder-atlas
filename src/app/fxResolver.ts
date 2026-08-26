/**
 * Northstar — layered FX resolution: organisation budget FX FIRST,
 * Frankfurter reference rates as supplement (ADR-052).
 *
 * Organisation budget/planning FX is a first-class evidence source: it is
 * what future-dated corporate/event travel must use (a future market rate
 * does not exist and none may be fabricated). Frankfurter supplements it for
 * current/past-dated comparisons. The layering rule is deliberately simple
 * and generic:
 *
 *  1. collect the union of evidence from every configured layer;
 *  2. hand everything to the existing deterministic selector in `fx.ts`,
 *     which picks the freshest effective, sufficiently-trusted observation;
 *  3. return [] when nothing valid exists — the caller fails closed.
 *
 * Because the engine's tie-break prefers higher fact-ladder authority at
 * equal freshness and freshness above all otherwise, an AUTHORITATIVE
 * organisation ruling outranks CONNECTED Frankfurter evidence at the same
 * instant, while a genuinely fresher market fixing supersedes an older
 * budget ruling — exactly the semantics "budget first-class, provider
 * supplements" needs without any source-name branching.
 */
import type { FxRateEvidence } from '../engine/fx.ts';
import { FxRateEvidenceSchema } from '../engine/fx.ts';

export interface LayeredFxResolverOptions {
  /**
   * Application-owned store of organisation-approved budget/rule evidence
   * (seeded from scenario bundles or written by operators).
   */
  budgetRates: { ratesFor(baseCurrency: string, homeCurrency: string): Promise<unknown[]> };
  /**
   * Optional external reference layer (e.g. Frankfurter). Consulted only for
   * lookups at-or-before its own notion of now; never asked to fabricate a
   * rate for a date it does not publish.
   */
  external?: {
    quote(request: { baseCurrency: string; homeCurrency: string; date?: string }): Promise<{
      ok: boolean;
      data?: { rates: unknown[] };
    }>;
    /** Upper bound on the reference date the external layer may be asked for. */
    todayIsoDate: () => string;
  };
}

export class LayeredFxRateResolver {
  private readonly budgetRates: LayeredFxResolverOptions['budgetRates'];
  private readonly external?: LayeredFxResolverOptions['external'];

  constructor(options: LayeredFxResolverOptions) {
    this.budgetRates = options.budgetRates;
    this.external = options.external;
  }

  async ratesFor(baseCurrency: string, homeCurrency: string): Promise<FxRateEvidence[]> {
    const collected: FxRateEvidence[] = [];
    for (const raw of await this.budgetRates.ratesFor(baseCurrency, homeCurrency)) {
      const parsed = FxRateEvidenceSchema.safeParse(raw);
      if (parsed.success) collected.push(parsed.data);
    }
    // Invalid stored rows are dropped wholesale, never partially trusted.
    if (!this.external) return collected;

    const latest = await this.external.quote({ baseCurrency, homeCurrency });
    if (latest.ok && latest.data) {
      for (const raw of latest.data.rates) {
        const parsed = FxRateEvidenceSchema.safeParse(raw);
        if (parsed.success) collected.push(parsed.data);
      }
    }
    // External failure (network/HTTP/schema) contributes NOTHING rather than
    // poisoning good budget evidence; with neither layer producing usable
    // evidence the caller fails closed exactly as before ADR-052's adapter.
    return collected;
  }
}
