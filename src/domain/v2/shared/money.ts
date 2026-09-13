/**
 * NORTHSTAR v2 — exact monetary semantics.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: exact decimal amounts and currency
 * codes; no floating-point JS arithmetic for consequential monetary
 * decisions. Amounts are carried as decimal strings so JSON transport never
 * loses precision; arithmetic helpers use integer minor units internally.
 */
import { z } from 'zod';

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

function toMinorUnits(amount: DecimalAmount, exponent: number): bigint {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, frac = ''] = unsigned.split('.');
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

/** Adds two exact amounts of the SAME currency at the given decimal exponent. Throws on currency mismatch. */
export function addExactMoney(a: ExactMoney, b: ExactMoney, exponent = 2): ExactMoney {
  if (a.currency !== b.currency) {
    throw new RangeError(`cannot add ${a.currency} to ${b.currency} without a dated FX conversion`);
  }
  const sum = toMinorUnits(a.amount, exponent) + toMinorUnits(b.amount, exponent);
  return { amount: fromMinorUnits(sum, exponent), currency: a.currency };
}

export function compareExactMoney(a: ExactMoney, b: ExactMoney, exponent = 2): -1 | 0 | 1 {
  if (a.currency !== b.currency) {
    throw new RangeError(`cannot compare ${a.currency} to ${b.currency} without a dated FX conversion`);
  }
  const diff = toMinorUnits(a.amount, exponent) - toMinorUnits(b.amount, exponent);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}
