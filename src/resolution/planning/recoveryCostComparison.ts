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

export type RecoveryCostKind =
  | 'SELECT_OFFER'
  | 'ADD_JOURNEY_STAY'
  | 'POLICY_PENALTY_ESTIMATE'
  | 'DISPLACED_STAY_CREDIT';

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
   * Recovered value of a displaced existing booking (its confirmed total less
   * the current cancellation fee). Subtracted when forming net cost.
   */
  creditHomeAmount: ExactMoney;
  /**
   * Net recovery economics in home currency:
   * new spend + cancellation fee − displaced-stay credit.
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

function negateExactMoney(amount: ExactMoney): ExactMoney {
  if (/^-?0+(?:\.0+)?$/.test(amount.amount)) {
    return { amount: amount.amount.replace(/^-/, ''), currency: amount.currency };
  }
  return {
    amount: amount.amount.startsWith('-') ? amount.amount.slice(1) : `-${amount.amount}`,
    currency: amount.currency,
  };
}

interface EffectCostLine {
  kind: RecoveryCostKind;
  amount: ExactMoney;
  observed: boolean;
  /**
   * Whether this line's home amount contributes to totalHomeAmount. Once a
   * CANCEL_STAY effect's recoverableStayCredit is established (bookedTotal is
   * known, even if the credit nets to zero under full forfeiture), the credit
   * line already carries the fee's net economic effect (bookedTotal − fee).
   * Also counting the raw current-fee (POLICY_PENALTY_ESTIMATE) line toward
   * the total would double the cancellation loss. The fee still contributes
   * to potentialLossHomeAmount for display so the current loss stays visible
   * on its own — it just does not additionally reduce/inflate the net total.
   */
  countsTowardTotal: boolean;
}

function effectCosts(effect: ScenarioEffect): EffectCostLine[] {
  switch (effect.effectKind) {
    case 'SELECT_OFFER':
      if (!effect.offerPrice) return [];
      return [{ kind: 'SELECT_OFFER', amount: effect.offerPrice, observed: false, countsTowardTotal: true }];
    case 'ADD_JOURNEY_STAY':
      return [{ kind: 'ADD_JOURNEY_STAY', amount: effect.offerPrice, observed: false, countsTowardTotal: true }];
    case 'CANCEL_STAY': {
      const credit = effect.recoverableStayCredit;
      const creditEstablished = credit !== undefined;
      const lines: EffectCostLine[] = [
        {
          kind: 'POLICY_PENALTY_ESTIMATE',
          amount: effect.cancellationPenalty,
          observed: false,
          countsTowardTotal: !creditEstablished,
        },
      ];
      // Credit comes only from the existing booking's recoverable value. The
      // future (post-deadline) penalty is exposure, never a refund.
      if (credit && !/^-?0+(?:\.0+)?$/.test(credit.amount) && !credit.amount.startsWith('-')) {
        lines.push({ kind: 'DISPLACED_STAY_CREDIT', amount: credit, observed: false, countsTowardTotal: true });
      }
      return lines;
    }
    default:
      return [];
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
  const costs: EffectCostLine[] = [];
  for (const rawEffect of input.effects) {
    const parsed = ScenarioEffectSchema.safeParse(rawEffect);
    if (!parsed.success) return unavailable('INVALID_INPUT', 'scenario effects must be validated closed effects');
    if (parsed.data.effectKind === 'SELECT_OFFER' && !parsed.data.offerPrice) {
      return unavailable('MISSING_EFFECT_PRICE', 'SELECT_OFFER has no captured offer price');
    }
    costs.push(...effectCosts(parsed.data));
  }
  let newSpendHomeAmount: ExactMoney = { amount: '0', currency: input.homeCurrency };
  let potentialLossHomeAmount: ExactMoney = { amount: '0', currency: input.homeCurrency };
  let creditHomeAmount: ExactMoney = { amount: '0', currency: input.homeCurrency };
  // Accumulated independently of the three display buckets above: a line
  // that is excluded from the net total (countsTowardTotal: false) still
  // shows up in its display bucket — e.g. a current cancellation fee once
  // netted into an established recoverableStayCredit — so the operator can
  // see the loss without it also shifting the net recovery cost.
  let totalHomeAmount: ExactMoney = { amount: '0', currency: input.homeCurrency };
  const lines: RecoveryCostLine[] = [];
  const selectedFxEvidence: string[] = [];
  for (const cost of costs) {
    const converted = convertLine(cost.amount, input.homeCurrency, input.comparedAt, parsedRates);
    if (!converted.ok) return converted;
    try {
      if (cost.kind === 'POLICY_PENALTY_ESTIMATE') {
        potentialLossHomeAmount = addExactMoney(potentialLossHomeAmount, converted.homeAmount);
        if (cost.countsTowardTotal) totalHomeAmount = addExactMoney(totalHomeAmount, converted.homeAmount);
      } else if (cost.kind === 'DISPLACED_STAY_CREDIT') {
        creditHomeAmount = addExactMoney(creditHomeAmount, converted.homeAmount);
        if (cost.countsTowardTotal) totalHomeAmount = addExactMoney(totalHomeAmount, negateExactMoney(converted.homeAmount));
      } else {
        newSpendHomeAmount = addExactMoney(newSpendHomeAmount, converted.homeAmount);
        if (cost.countsTowardTotal) totalHomeAmount = addExactMoney(totalHomeAmount, converted.homeAmount);
      }
    } catch {
      return unavailable('UNSUPPORTED_MONEY_PRECISION', 'an amount exceeds the supported currency precision');
    }
    if (converted.fxEvidenceId && !selectedFxEvidence.includes(converted.fxEvidenceId)) selectedFxEvidence.push(converted.fxEvidenceId);
    lines.push({ kind: cost.kind, providerAmount: cost.amount, homeAmount: converted.homeAmount, ...(converted.fxEvidenceId ? { fxEvidenceId: converted.fxEvidenceId } : {}), observed: cost.observed });
  }
  return {
    ok: true,
    homeCurrency: input.homeCurrency,
    newSpendHomeAmount,
    potentialLossHomeAmount,
    creditHomeAmount,
    totalHomeAmount,
    lines,
    selectedFxEvidence,
    comparedAt: input.comparedAt,
  };
}
