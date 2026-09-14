/**
 * NORTHSTAR v2 — exact monetary semantics.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: exact decimal amounts and currency
 * codes; no floating-point JS arithmetic for consequential monetary
 * decisions. Amounts are carried as decimal strings so JSON transport never
 * loses precision; arithmetic helpers use integer minor units internally.
 *
 * I-10 (pre-M8): one shared seam for currency minor-unit exponents, exact
 * multiply, and sourced FX conversion. Funding evaluation and M8 budget
 * commitments must call these helpers — never a local BigInt copy.
 */
import { z } from 'zod';
import type { Instant } from './time.ts';
import { compareInstants } from './time.ts';

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/** Exact decimal amount as a string, e.g. "1234.56". No binary float. */
export const DecimalAmountSchema = z.string().regex(/^-?\d+(\.\d+)?$/);
export type DecimalAmount = z.infer<typeof DecimalAmountSchema>;

export const ExactMoneySchema = z.strictObject({
  amount: DecimalAmountSchema,
  currency: CurrencyCodeSchema,
});
export type ExactMoney = z.infer<typeof ExactMoneySchema>;

/** Immutable dated FX evidence (`fx_observations`). Unique per source+pair+edition upstream. */
export const FxObservationSchema = z.strictObject({
  id: z.string().min(1),
  baseCurrency: CurrencyCodeSchema,
  quoteCurrency: CurrencyCodeSchema,
  rate: DecimalAmountSchema,
  asOf: z.iso.datetime({ offset: true }),
  sourceId: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type FxObservation = z.infer<typeof FxObservationSchema>;

/**
 * Explicit rounding for exact decimal scale-down. Half values move away from
 * zero (…5 → larger magnitude). No banker's rounding, no float.
 */
export const MoneyRoundingPolicySchema = z.literal('HALF_AWAY_FROM_ZERO');
export type MoneyRoundingPolicy = z.infer<typeof MoneyRoundingPolicySchema>;
export const DEFAULT_MONEY_ROUNDING: MoneyRoundingPolicy = 'HALF_AWAY_FROM_ZERO';

/**
 * ISO 4217 minor-unit exponents for currencies this product must handle
 * correctly. Most ISO codes use 2; zero-decimal (JPY) and three-decimal
 * (KWD) currencies are listed explicitly. Unlisted codes default to 2 —
 * callers that need a non-default exponent for a rare code must extend this
 * table rather than invent local arithmetic.
 */
const CURRENCY_EXPONENTS: Readonly<Record<string, 0 | 2 | 3>> = {
  // 0-decimal
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  // 3-decimal
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
  // 2-decimal (explicit common set; others also default to 2)
  USD: 2,
  SGD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2,
  HKD: 2,
  NZD: 2,
  MYR: 2,
};

/** Authoritative minor-unit exponent for a currency code. */
export function currencyExponent(currency: CurrencyCode): 0 | 2 | 3 {
  return CURRENCY_EXPONENTS[currency] ?? 2;
}

function toMinorUnits(amount: DecimalAmount, exponent: number): bigint {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, frac = ''] = unsigned.split('.');
  if (frac.length > exponent) {
    throw new RangeError(
      `amount ${amount} has more than ${exponent} fractional digit(s) for this currency exponent`,
    );
  }
  const paddedFrac = (frac + '0'.repeat(exponent)).slice(0, exponent);
  const digits = `${whole}${paddedFrac}`;
  const value = BigInt(digits === '' ? '0' : digits);
  return negative ? -value : value;
}

function fromMinorUnits(minor: bigint, exponent: number): DecimalAmount {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const digits = abs.toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent) || '0';
  const frac = exponent > 0 ? digits.slice(digits.length - exponent) : '';
  const body = frac.length > 0 ? `${whole}.${frac}` : whole;
  return negative ? `-${body}` : body;
}

/**
 * Exact decimal × decimal multiply, scaled to `resultExponent` minor units.
 * Uses BigInt only; rounding is HALF_AWAY_FROM_ZERO.
 */
export function multiplyExactDecimal(
  amount: DecimalAmount,
  rate: DecimalAmount,
  resultExponent: number,
  rounding: MoneyRoundingPolicy = DEFAULT_MONEY_ROUNDING,
): DecimalAmount {
  if (rounding !== 'HALF_AWAY_FROM_ZERO') {
    throw new RangeError(`unsupported money rounding policy: ${rounding as string}`);
  }
  const negative = amount.startsWith('-') !== rate.startsWith('-');
  const a = amount.replace('-', '');
  const r = rate.replace('-', '');
  const [aWhole, aFrac = ''] = a.split('.');
  const [rWhole, rFrac = ''] = r.split('.');
  const aDigits = BigInt(`${aWhole}${aFrac}` || '0');
  const rDigits = BigInt(`${rWhole}${rFrac}` || '0');
  const totalFracDigits = aFrac.length + rFrac.length;
  const product = aDigits * rDigits;
  const scaleDown = totalFracDigits - resultExponent;
  let scaled: bigint;
  if (scaleDown <= 0) {
    scaled = product * 10n ** BigInt(-scaleDown);
  } else {
    const divisor = 10n ** BigInt(scaleDown);
    const half = divisor / 2n;
    scaled = (product + half) / divisor;
  }
  const magnitude = fromMinorUnits(scaled, resultExponent);
  return negative && scaled !== 0n ? `-${magnitude}` : magnitude;
}

export type FxConversionFailure =
  | 'MISSING_FX'
  | 'EXPIRED_FX'
  | 'ORIENTATION_MISMATCH'
  | 'CURRENCY_MISMATCH';

export type FxConversionResult =
  | { ok: true; money: ExactMoney; fxObservationId: string }
  | { ok: false; reason: FxConversionFailure };

/**
 * Convert `amount` into `targetCurrency` using sourced FX evidence.
 *
 * Rate semantics match `FxObservation`: one unit of `baseCurrency` buys
 * `rate` units of `quoteCurrency`. Orientation must be
 * base=source currency, quote=target currency. Same-currency conversion
 * normalises to the target exponent and does not require FX evidence.
 */
export function convertExactMoney(
  amount: ExactMoney,
  targetCurrency: CurrencyCode,
  fx: FxObservation | undefined,
  options?: { now?: Instant; rounding?: MoneyRoundingPolicy },
): FxConversionResult {
  const targetExponent = currencyExponent(targetCurrency);
  if (amount.currency === targetCurrency) {
    const normalised = fromMinorUnits(toMinorUnits(amount.amount, targetExponent), targetExponent);
    return { ok: true, money: { amount: normalised, currency: targetCurrency }, fxObservationId: fx?.id ?? '' };
  }
  if (!fx) return { ok: false, reason: 'MISSING_FX' };
  if (fx.baseCurrency !== amount.currency || fx.quoteCurrency !== targetCurrency) {
    return { ok: false, reason: 'ORIENTATION_MISMATCH' };
  }
  if (options?.now !== undefined && fx.expiresAt !== undefined && compareInstants(options.now, fx.expiresAt) >= 0) {
    return { ok: false, reason: 'EXPIRED_FX' };
  }
  const converted = multiplyExactDecimal(
    amount.amount,
    fx.rate,
    targetExponent,
    options?.rounding ?? DEFAULT_MONEY_ROUNDING,
  );
  return {
    ok: true,
    money: { amount: converted, currency: targetCurrency },
    fxObservationId: fx.id,
  };
}

/** Adds two exact amounts of the SAME currency. Uses the currency's minor-unit exponent when omitted. */
export function addExactMoney(a: ExactMoney, b: ExactMoney, exponent?: number): ExactMoney {
  if (a.currency !== b.currency) {
    throw new RangeError(`cannot add ${a.currency} to ${b.currency} without a dated FX conversion`);
  }
  const exp = exponent ?? currencyExponent(a.currency);
  const sum = toMinorUnits(a.amount, exp) + toMinorUnits(b.amount, exp);
  return { amount: fromMinorUnits(sum, exp), currency: a.currency };
}

export function compareExactMoney(a: ExactMoney, b: ExactMoney, exponent?: number): -1 | 0 | 1 {
  if (a.currency !== b.currency) {
    throw new RangeError(`cannot compare ${a.currency} to ${b.currency} without a dated FX conversion`);
  }
  const exp = exponent ?? currencyExponent(a.currency);
  const diff = toMinorUnits(a.amount, exp) - toMinorUnits(b.amount, exp);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/** True when `a` is strictly less than `b` in the same currency. */
export function exactMoneyLessThan(a: ExactMoney, b: ExactMoney): boolean {
  return compareExactMoney(a, b) < 0;
}
