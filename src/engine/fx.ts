/**
 * Northstar — generic FX / home-currency normalization (provider-neutral).
 *
 * Provider quotes arrive in arbitrary currency; organisation policy is stated
 * in a configurable home currency. This module converts deterministically
 * between them using EVIDENCED rates only: every conversion carries the rate
 * evidence it used, and every failure mode fails closed.
 *
 * Invariants (ADR-052):
 *  - No LLM anywhere on this path; no live FX calls from deterministic code.
 *    Rates are evidence records with provenance and an effective period.
 *  - ADR-045 preserved: missing, stale or untrusted rate evidence means
 *    "cannot compare" -> the caller must fail closed. Nothing here invents a
 *    rate, a default of 1, or an assumption that currencies match.
 *  - Same-currency amounts need no rate and never touch this module's
 *    evidence requirements — identity is exact.
 *  - Rounding is deterministic half-away-from-zero at a fixed scale so an
 *    identical input set always produces the identical normalized amount.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  FactAuthoritySchema,
  IsoDateTimeSchema,
  instantMillis,
  type Money,
} from '../domain/common.ts';

/** Currencies are ISO-4217-shaped uppercase triplets at every boundary. */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/**
 * One evidenced FX observation: how much HOME currency one unit of BASE buys
 * (quote-style rate, base->home). Provenance mirrors the fact ladder: only
 * AUTHORITATIVE/CONNECTED evidence may support a policy comparison; ASSERTED
 * or INFERRED rates are untrusted for authority purposes and fail closed in
 * `fxNormalizationFor`.
 */
export const FxRateEvidenceSchema = z.strictObject({
  id: EntityIdSchema,
  baseCurrency: CurrencyCodeSchema,
  homeCurrency: CurrencyCodeSchema,
  /** Home units per one base unit; strictly positive by construction. */
  rate: z.number().positive(),
  sourceId: EntityIdSchema,
  authority: FactAuthoritySchema,
  observedAt: IsoDateTimeSchema,
  /**
   * Effective period of this observation. A rate with no validUntil is valid
   * indefinitely from observedAt — the evidence itself says so; staleness is
   * always judged against the comparison instant, never a wall clock.
   */
  validUntil: IsoDateTimeSchema.optional(),
});
export type FxRateEvidence = z.infer<typeof FxRateEvidenceSchema>;

/**
 * Deterministic Money conversion into a TARGET currency. Half-away-from-zero
 * rounding at the given decimal scale keeps identical inputs on identical
 * outputs and keeps negative deltas honest. The result carries `target`
 * currency — a conversion that kept the source currency would misstate every
 * downstream comparison.
 */
export function convertMoney(amount: Money, rate: number, target: CurrencyCode, decimals = 2): Money {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`FX rate must be finite and positive, got ${rate}`);
  }
  const factor = 10 ** decimals;
  const converted = amount.amount * rate;
  const rounded =
    converted >= 0 ? Math.floor(converted * factor + 0.5) : Math.ceil(converted * factor - 0.5);
  return { amount: rounded / factor, currency: target };
}

/** True when the evidence was observed by `at` and has not expired. */
export function isFxRateEffective(
  rate: FxRateEvidence,
  at: string,
): boolean {
  if (instantMillis(rate.observedAt) > instantMillis(at)) return false;
  return !(rate.validUntil !== undefined && instantMillis(rate.validUntil) < instantMillis(at));
}

export interface FxResolution {
  rate: number;
  evidenceId: string;
}

/**
 * Pick the governing rate for base->home at instant `at` from an ordered
 * candidate list: freshest observation wins; ties break on descending
 * authority then evidence id so the outcome is total-order deterministic.
 * Expired/not-yet-effective entries are skipped entirely.
 */
export function effectiveFxRate(
  candidates: readonly FxRateEvidence[],
  at: string,
): FxResolution | undefined {
  let best: FxRateEvidence | undefined;
  for (const candidate of candidates) {
    if (!isFxRateEffective(candidate, at)) continue;
    if (
      best === undefined ||
      instantMillis(candidate.observedAt) > instantMillis(best.observedAt) ||
      (instantMillis(candidate.observedAt) === instantMillis(best.observedAt) &&
        FACT_AUTHORITY_ORDER(candidate.authority) > FACT_AUTHORITY_ORDER(best.authority)) ||
      (instantMillis(candidate.observedAt) === instantMillis(best.observedAt) &&
        candidate.authority === best.authority &&
        candidate.id > best.id)
    ) {
      best = candidate;
    }
  }
  return best ? { rate: best.rate, evidenceId: best.id } : undefined;
}

function FACT_AUTHORITY_ORDER(authority: FxRateEvidence['authority']): number {
  switch (authority) {
    case 'AUTHORITATIVE':
      return 3;
    case 'CONNECTED':
      return 2;
    case 'ASSERTED':
      return 1;
    case 'INFERRED':
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Spend normalization: the single seam authority consumes
// ---------------------------------------------------------------------------

/** Why a provider-currency spend could not be normalized into home currency. */
export const FX_FAILURE_CODES = ['no_rate_evidence', 'rate_expired', 'rate_untrusted'] as const;
export type FxNormalizationCode = (typeof FX_FAILURE_CODES)[number];

export interface FxNormalizedSpend {
  /** The spend restated in the organisation home currency. */
  homeSpend: Money;
  /** The ORIGINAL provider-currency amount/currency, untouched. */
  providerAmount: Money;
  rate?: number;
  fxSourceId?: string;
}

export interface FxNormalizationFailure {
  code: FxNormalizationCode;
  reason: string;
  /** Evidence ids considered but rejected, when any existed. */
  rejectedEvidenceIds?: string[];
}

export type FxNormalizationOutcome = FxNormalizedSpend | FxNormalizationFailure;

function isFailure(outcome: FxNormalizationOutcome): outcome is FxNormalizationFailure {
  return typeof (outcome as FxNormalizationFailure).code === 'string';
}

const MIN_POLICY_AUTHORITY: Record<FxRateEvidence['authority'], boolean> = {
  AUTHORITATIVE: true,
  CONNECTED: true,
  ASSERTED: false,
  INFERRED: false,
};

/**
 * Normalize a provider-currency gross spend into the organisation home
 * currency at instant `at`, using only evidenced, effective, sufficiently
 * trusted rates. Same-currency spends normalize identically without any
 * evidence. Every failure mode is structured data for the caller to fail
 * closed on — nothing here guesses.
 *
 * The returned record ALWAYS preserves `providerAmount`: the executor pays
 * the provider charge in the provider currency against the original frozen
 * exposure, never against the normalized restatement.
 */
export function fxNormalizeSpend(input: {
  providerSpend: Money;
  homeCurrency: CurrencyCode;
  at: string;
  candidates: readonly FxRateEvidence[];
}): FxNormalizationOutcome {
  const { providerSpend, homeCurrency, at } = input;
  if (providerSpend.currency === homeCurrency) {
    // Identity restatement: exact, evidence-free. Returned as a SUCCESS
    // outcome (no failure code) so callers treat it uniformly as normalized.
    return {
      homeSpend: providerSpend,
      providerAmount: providerSpend,
    };
  }

  const matching = input.candidates.filter(
    (candidate) =>
      candidate.baseCurrency === providerSpend.currency && candidate.homeCurrency === homeCurrency,
  );
  if (matching.length === 0) {
    return { code: 'no_rate_evidence', reason: `no evidenced ${providerSpend.currency}->${homeCurrency} rate available` };
  }

  const resolution = effectiveFxRate(matching, at);
  if (!resolution) {
    return {
      code: 'rate_expired',
      reason:
        `all ${matching.length} evidenced ${providerSpend.currency}->${homeCurrency} rate(s) are outside their ` +
        `effective period at ${at}`,
      rejectedEvidenceIds: matching.map((candidate) => candidate.id),
    };
  }

  const chosen = matching.find((candidate) => candidate.id === resolution.evidenceId)!;
  if (!MIN_POLICY_AUTHORITY[chosen.authority]) {
    return {
      code: 'rate_untrusted',
      reason:
        `governing ${providerSpend.currency}->${homeCurrency} rate ${chosen.id} carries authority ` +
        `${chosen.authority}, which cannot support a deterministic policy comparison`,
      rejectedEvidenceIds: [chosen.id],
    };
  }

  const homeSpend = convertMoney(providerSpend, resolution.rate, homeCurrency);
  return {
    homeSpend,
    providerAmount: providerSpend,
    rate: resolution.rate,
    fxSourceId: resolution.evidenceId,
  };
}

export { isFailure as isFxNormalizationFailure };

/**
 * Resolve the home currency for a trip context: each governed ORGANISATION
 * rule-set owner states its home currency; alphabetical owner order makes the
 * outcome deterministic, disagreement between owners fails closed (the
 * caller treats undefined as "cannot normalize"). Trips with no owning
 * organisation have no home currency and stay unnormalized — no global
 * default exists anywhere in engine logic.
 */
export function resolveHomeCurrency(input: {
  organisations: ReadonlyArray<{ id: string; homeCurrency?: string }>;
  governedByRuleSetIds: readonly string[];
  ruleSets: ReadonlyArray<{ id: string; ownerOrganisationId?: string }>;
}): CurrencyCode | undefined {
  const owned = new Map<string, string>();
  for (const ruleSet of input.ruleSets) {
    const owner = ruleSet.ownerOrganisationId;
    if (!owner || !input.governedByRuleSetIds.includes(ruleSet.id)) continue;
    for (const organisation of input.organisations) {
      if (organisation.id === owner && organisation.homeCurrency) owned.set(organisation.id, organisation.homeCurrency);
    }
  }
  if (owned.size === 0) return undefined;
  const sorted = [...owned.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const first = sorted[0]![1];
  return sorted.every(([, value]) => value === first) ? first : undefined;
}
