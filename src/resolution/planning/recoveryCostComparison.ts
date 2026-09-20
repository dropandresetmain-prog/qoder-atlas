import { z } from 'zod';
import { effectiveFxRate, isFxRateEffective, FxRateEvidenceSchema, type FxRateEvidence } from '../../engine/fx.ts';
import { CurrencyCodeSchema, DecimalAmountSchema, addExactMoney, convertExactMoney, currencyExponent, type ExactMoney } from '../../domain/v2/shared/money.ts';
import { ScenarioEffectSchema, type ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';

const ComparisonInstantSchema = z.iso.datetime({ offset: true });
const TRUSTED_AUTHORITIES = new Set<FxRateEvidence['authority']>(['AUTHORITATIVE', 'CONNECTED']);
const MAX_RATE_DECIMAL_PLACES = 18;

function instantMs(value: string): number {
  return Date.parse(value);
}

export type RecoveryCostKind = 'SELECT_OFFER' | 'ADD_JOURNEY_STAY' | 'POLICY_PENALTY_ESTIMATE';

export interface RecoveryCostLine {
  kind: RecoveryCostKind;
  providerAmount: ExactMoney;
  homeAmount: ExactMoney;
  fxEvidenceId?: string;
  /** Cancellation penalties are estimates from policy input, not observed charges. */
  observed: boolean;
}

export interface RecoveryCostComparison {
  ok: true;
  homeCurrency: ExactMoney['currency'];
  /** Confirmed new-purchase spend (replacement offers and stays only). */
  newSpendHomeAmount: ExactMoney;
  /** Maximum cancellation / policy loss exposure — not a confirmed new purchase. */
  potentialLossHomeAmount: ExactMoney;
  /**
   * Maximum total exposure = new spend + potential loss.
   * Do not present this alone as “cost”; prefer the split fields above.
   */
  totalHomeAmount: ExactMoney;
  lines: readonly RecoveryCostLine[];
  selectedFxEvidence: readonly string[];
  comparedAt: string;
}

export type RecoveryCostComparisonUnavailableCode =
  | 'INVALID_INPUT'
  | 'MISSING_EFFECT_PRICE'
  | 'MISSING_RATE_EVIDENCE'
  | 'FUTURE_RATE_EVIDENCE'
  | 'STALE_RATE_EVIDENCE'
  | 'UNTRUSTED_RATE_EVIDENCE'
  | 'INVALID_RATE_PRECISION'
  | 'UNSUPPORTED_MONEY_PRECISION';

export interface RecoveryCostComparisonUnavailable {
  ok: false;
  code: RecoveryCostComparisonUnavailableCode;
  reason: string;
}

export type RecoveryCostComparisonResult = RecoveryCostComparison | RecoveryCostComparisonUnavailable;

/**
 * Converts an exact normalized total to the comparator's number-only minor
 * units only when no precision or safe-integer information is lost.
 */
export function safeRecoveryCostMinorUnits(amount: ExactMoney): number | undefined {
  const parsed = DecimalAmountSchema.safeParse(amount.amount);
  if (!parsed.success) return undefined;
  const negative = amount.amount.startsWith('-');
  const unsigned = negative ? amount.amount.slice(1) : amount.amount;
  const [whole, fraction = ''] = unsigned.split('.');
  const exponent = currencyExponent(amount.currency);
  if (fraction.length > exponent) return undefined;
  try {
    const minor = BigInt(`${whole}${(fraction + '0'.repeat(exponent)).slice(0, exponent)}` || '0');
    const signed = negative ? -minor : minor;
    const value = Number(signed);
    return Number.isSafeInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function rateDecimal(rate: number): string | undefined {
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const text = String(rate);
  if (!DecimalAmountSchema.safeParse(text).success) return undefined;
  const fractional = text.split('.')[1] ?? '';
  if (fractional.length > MAX_RATE_DECIMAL_PLACES) return undefined;
  return text;
}

function effectCost(effect: ScenarioEffect): { kind: RecoveryCostKind; amount: ExactMoney; observed: boolean } | undefined {
  switch (effect.effectKind) {
    case 'SELECT_OFFER':
      if (!effect.offerPrice) return undefined;
      return { kind: 'SELECT_OFFER', amount: effect.offerPrice, observed: false };
    case 'ADD_JOURNEY_STAY':
      return { kind: 'ADD_JOURNEY_STAY', amount: effect.offerPrice, observed: false };
    case 'CANCEL_STAY':
      return { kind: 'POLICY_PENALTY_ESTIMATE', amount: effect.cancellationPenalty, observed: false };
    default:
      return undefined;
  }
}

function unavailable(code: RecoveryCostComparisonUnavailableCode, reason: string): RecoveryCostComparisonUnavailable {
  return { ok: false, code, reason };
}

function convertLine(amount: ExactMoney, homeCurrency: ExactMoney['currency'], at: string, rates: readonly FxRateEvidence[]):
  | { ok: true; homeAmount: ExactMoney; fxEvidenceId?: string }
  | RecoveryCostComparisonUnavailable {
  if (amount.currency === homeCurrency) return { ok: true, homeAmount: amount };
  const matching = rates.filter((rate) => rate.baseCurrency === amount.currency && rate.homeCurrency === homeCurrency);
  if (matching.length === 0) return unavailable('MISSING_RATE_EVIDENCE', `no captured ${amount.currency}->${homeCurrency} rate exists`);
  const future = matching.filter((rate) => instantMs(rate.observedAt) > instantMs(at));
  const effective = matching.filter((rate) => isFxRateEffective(rate, at));
  if (effective.length === 0) {
    return future.length === matching.length
      ? unavailable('FUTURE_RATE_EVIDENCE', `all captured ${amount.currency}->${homeCurrency} rates are observed after ${at}`)
      : unavailable('STALE_RATE_EVIDENCE', `captured ${amount.currency}->${homeCurrency} rates are outside their effective period at ${at}`);
  }
  const trusted = effective.filter((rate) => TRUSTED_AUTHORITIES.has(rate.authority));
  if (trusted.length === 0) return unavailable('UNTRUSTED_RATE_EVIDENCE', `effective ${amount.currency}->${homeCurrency} rates are not trusted for comparison`);
  const resolution = effectiveFxRate(trusted, at);
  if (!resolution) return unavailable('STALE_RATE_EVIDENCE', `no effective ${amount.currency}->${homeCurrency} rate can be selected at ${at}`);
  const selected = trusted.find((rate) => rate.id === resolution.evidenceId)!;
  const decimalRate = rateDecimal(selected.rate);
  if (!decimalRate) return unavailable('INVALID_RATE_PRECISION', `captured FX rate ${selected.id} is not an exactly representable decimal`);
  const observation = {
    id: selected.id,
    baseCurrency: selected.baseCurrency,
    quoteCurrency: selected.homeCurrency,
    rate: decimalRate,
    asOf: selected.observedAt,
    sourceId: selected.sourceId,
    ...(selected.validUntil ? { expiresAt: selected.validUntil } : {}),
  };
  let converted;
  try {
    converted = convertExactMoney(amount, homeCurrency, observation, { now: at });
  } catch {
    return unavailable('UNSUPPORTED_MONEY_PRECISION', 'an amount exceeds the supported currency precision');
  }
  if (!converted.ok) return unavailable('STALE_RATE_EVIDENCE', `captured FX rate ${selected.id} cannot convert at ${at}`);
  return { ok: true, homeAmount: converted.money, fxEvidenceId: selected.id };
}

export function compareRecoveryCosts(input: {
  effects: readonly ScenarioEffect[];
  homeCurrency: string;
  rates: readonly FxRateEvidence[];
  comparedAt: string;
}): RecoveryCostComparisonResult {
  if (!CurrencyCodeSchema.safeParse(input.homeCurrency).success || !ComparisonInstantSchema.safeParse(input.comparedAt).success) {
    return unavailable('INVALID_INPUT', 'home currency and comparison instant must be valid');
  }
  const parsedRates: FxRateEvidence[] = [];
  for (const rate of input.rates) {
    const parsed = FxRateEvidenceSchema.safeParse(rate);
    if (!parsed.success || rateDecimal(rate.rate) === undefined) {
      return unavailable('INVALID_RATE_PRECISION', `captured FX rate ${rate.id} is not an exactly representable decimal`);
    }
    parsedRates.push(rate);
  }
  const costs: Array<{ kind: RecoveryCostKind; amount: ExactMoney; observed: boolean }> = [];
  for (const rawEffect of input.effects) {
    const parsed = ScenarioEffectSchema.safeParse(rawEffect);
    if (!parsed.success) return unavailable('INVALID_INPUT', 'scenario effects must be validated closed effects');
    const cost = effectCost(parsed.data);
    if (parsed.data.effectKind === 'SELECT_OFFER' && !cost) return unavailable('MISSING_EFFECT_PRICE', 'SELECT_OFFER has no captured offer price');
    if (cost) costs.push(cost);
  }
  let newSpendHomeAmount: ExactMoney = { amount: '0', currency: input.homeCurrency };
  let potentialLossHomeAmount: ExactMoney = { amount: '0', currency: input.homeCurrency };
  const lines: RecoveryCostLine[] = [];
  const selectedFxEvidence: string[] = [];
  for (const cost of costs) {
    const converted = convertLine(cost.amount, input.homeCurrency, input.comparedAt, parsedRates);
    if (!converted.ok) return converted;
    try {
      if (cost.kind === 'POLICY_PENALTY_ESTIMATE') {
        potentialLossHomeAmount = addExactMoney(potentialLossHomeAmount, converted.homeAmount);
      } else {
        newSpendHomeAmount = addExactMoney(newSpendHomeAmount, converted.homeAmount);
      }
    } catch {
      return unavailable('UNSUPPORTED_MONEY_PRECISION', 'an amount exceeds the supported currency precision');
    }
    if (converted.fxEvidenceId && !selectedFxEvidence.includes(converted.fxEvidenceId)) selectedFxEvidence.push(converted.fxEvidenceId);
    lines.push({ kind: cost.kind, providerAmount: cost.amount, homeAmount: converted.homeAmount, ...(converted.fxEvidenceId ? { fxEvidenceId: converted.fxEvidenceId } : {}), observed: cost.observed });
  }
  let totalHomeAmount: ExactMoney;
  try {
    totalHomeAmount = addExactMoney(newSpendHomeAmount, potentialLossHomeAmount);
  } catch {
    return unavailable('UNSUPPORTED_MONEY_PRECISION', 'an amount exceeds the supported currency precision');
  }
  return {
    ok: true,
    homeCurrency: input.homeCurrency,
    newSpendHomeAmount,
    potentialLossHomeAmount,
    totalHomeAmount,
    lines,
    selectedFxEvidence,
    comparedAt: input.comparedAt,
  };
}
