/**
 * Checkpoint 0 / I-10 — shared exact money, currency exponents, FX conversion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addExactMoney,
  compareExactMoney,
  convertExactMoney,
  currencyExponent,
  multiplyExactDecimal,
  type FxObservation,
} from '../src/domain/v2/shared/money.ts';

const NOW = '2031-05-01T00:00:00.000Z';

function fx(partial: Partial<FxObservation> & Pick<FxObservation, 'baseCurrency' | 'quoteCurrency' | 'rate'>): FxObservation {
  return {
    id: partial.id ?? 'fx-1',
    baseCurrency: partial.baseCurrency,
    quoteCurrency: partial.quoteCurrency,
    rate: partial.rate,
    asOf: partial.asOf ?? '2031-01-01T00:00:00.000Z',
    sourceId: partial.sourceId ?? 'src-1',
    ...(partial.expiresAt ? { expiresAt: partial.expiresAt } : {}),
  };
}

test('I-10: currency exponents cover 0 / 2 / 3 decimal currencies', () => {
  assert.equal(currencyExponent('JPY'), 0);
  assert.equal(currencyExponent('USD'), 2);
  assert.equal(currencyExponent('SGD'), 2);
  assert.equal(currencyExponent('KWD'), 3);
});

test('I-10: JPY (0 decimals) adds and compares without inventing fractional yen', () => {
  const sum = addExactMoney({ amount: '1000', currency: 'JPY' }, { amount: '250', currency: 'JPY' });
  assert.deepEqual(sum, { amount: '1250', currency: 'JPY' });
  assert.equal(compareExactMoney({ amount: '1000', currency: 'JPY' }, { amount: '999', currency: 'JPY' }), 1);
  assert.throws(() => addExactMoney({ amount: '1000.5', currency: 'JPY' }, { amount: '1', currency: 'JPY' }));
});

test('I-10: SGD/USD (2 decimals) retain exact minor units without float drift', () => {
  const sum = addExactMoney({ amount: '10.10', currency: 'SGD' }, { amount: '0.05', currency: 'SGD' });
  assert.deepEqual(sum, { amount: '10.15', currency: 'SGD' });
  const huge = addExactMoney({ amount: '9007199254740992.10', currency: 'USD' }, { amount: '0.90', currency: 'USD' });
  assert.deepEqual(huge, { amount: '9007199254740993.00', currency: 'USD' });
});

test('I-10: KWD (3 decimals) preserves fils precision', () => {
  const sum = addExactMoney({ amount: '1.005', currency: 'KWD' }, { amount: '0.010', currency: 'KWD' });
  assert.deepEqual(sum, { amount: '1.015', currency: 'KWD' });
  assert.equal(compareExactMoney({ amount: '1.005', currency: 'KWD' }, { amount: '1.004', currency: 'KWD' }), 1);
});

test('I-10: HALF_AWAY_FROM_ZERO rounding at the boundary', () => {
  assert.equal(multiplyExactDecimal('1.005', '1', 2), '1.01');
  assert.equal(multiplyExactDecimal('1.004', '1', 2), '1.00');
  assert.equal(multiplyExactDecimal('-1.005', '1', 2), '-1.01');
  assert.equal(multiplyExactDecimal('100', '0.915', 2), '91.50');
  assert.equal(multiplyExactDecimal('1', '1.005', 3), '1.005');
});

test('I-10: cross-currency conversion requires sourced FX and uses target exponent', () => {
  const usdToJpy = convertExactMoney(
    { amount: '10.00', currency: 'USD' },
    'JPY',
    fx({ baseCurrency: 'USD', quoteCurrency: 'JPY', rate: '150.4' }),
    { now: NOW },
  );
  assert.equal(usdToJpy.ok, true);
  if (usdToJpy.ok) assert.deepEqual(usdToJpy.money, { amount: '1504', currency: 'JPY' });

  const usdToKwd = convertExactMoney(
    { amount: '10.00', currency: 'USD' },
    'KWD',
    fx({ baseCurrency: 'USD', quoteCurrency: 'KWD', rate: '0.30715' }),
    { now: NOW },
  );
  assert.equal(usdToKwd.ok, true);
  if (usdToKwd.ok) assert.deepEqual(usdToKwd.money, { amount: '3.072', currency: 'KWD' });
});

test('I-10: missing / expired / mis-oriented FX remains not-authorised (UNKNOWN)', () => {
  assert.equal(
    convertExactMoney({ amount: '10.00', currency: 'USD' }, 'EUR', undefined, { now: NOW }).ok,
    false,
  );
  const expired = convertExactMoney(
    { amount: '10.00', currency: 'USD' },
    'EUR',
    fx({ baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.9', expiresAt: '2030-01-01T00:00:00.000Z' }),
    { now: NOW },
  );
  assert.deepEqual(expired, { ok: false, reason: 'EXPIRED_FX' });
  const wrongWay = convertExactMoney(
    { amount: '10.00', currency: 'USD' },
    'EUR',
    fx({ baseCurrency: 'EUR', quoteCurrency: 'USD', rate: '1.1' }),
    { now: NOW },
  );
  assert.deepEqual(wrongWay, { ok: false, reason: 'ORIENTATION_MISMATCH' });
});
