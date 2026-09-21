import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRecoveryCosts } from '../src/resolution/planning/recoveryCostComparison.ts';
import type { FxRateEvidence } from '../src/engine/fx.ts';
import type { ScenarioEffect } from '../src/contracts/v2/scenario/scenarioChange.ts';

const at = '2030-01-01T00:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function rate(n: number, baseCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY', homeCurrency = 'SGD', authority: FxRateEvidence['authority'] = 'CONNECTED', observedAt = at): FxRateEvidence {
  const key = Math.round(n * 1000);
  return { id: id(key), baseCurrency, homeCurrency, rate: n === 1 ? 1 : n, sourceId: id(key + 100), authority, observedAt };
}

const effects: ScenarioEffect[] = [
  { effectKind: 'SELECT_OFFER', journeyItemId: id(1), offerId: id(2), offerPrice: { amount: '100.00', currency: 'USD' } },
  { effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: id(3), journeyId: id(4), orderKey: '020', offerId: id(5), offerPrice: { amount: '200.00', currency: 'EUR' }, visit: { kind: 'EXISTING', visitId: id(6) } },
  { effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: id(7), journeyId: id(4), orderKey: '030', offerId: id(8), offerPrice: { amount: '300.00', currency: 'EUR' }, visit: { kind: 'EXISTING', visitId: id(6) } },
  { effectKind: 'CANCEL_STAY', journeyItemId: id(9), reservationLineId: id(10), cancellationPenalty: { amount: '50.00', currency: 'GBP' } },
  { effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: id(11) },
];

function failureCode(result: ReturnType<typeof compareRecoveryCosts>) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected comparison failure');
  return result.code;
}

test('compares flight, stays, and policy penalty in exact home currency while preserving provider amounts', () => {
  const result = compareRecoveryCosts({ effects, homeCurrency: 'SGD', rates: [rate(1.35, 'USD', 'SGD', 'CONNECTED', '2029-12-31T00:00:00.000Z'), rate(1.45, 'EUR'), rate(1.7, 'GBP')], comparedAt: at });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.totalHomeAmount, { amount: '945.00', currency: 'SGD' });
  assert.deepEqual(result.newSpendHomeAmount, { amount: '860.00', currency: 'SGD' });
  assert.deepEqual(result.potentialLossHomeAmount, { amount: '85.00', currency: 'SGD' });
  assert.deepEqual(result.lines.map((line) => line.homeAmount), [
    { amount: '135.00', currency: 'SGD' },
    { amount: '290.00', currency: 'SGD' },
    { amount: '435.00', currency: 'SGD' },
    { amount: '85.00', currency: 'SGD' },
  ]);
  assert.equal(result.lines[3]!.kind, 'POLICY_PENALTY_ESTIMATE');
  assert.equal(result.lines[3]!.observed, false);
  assert.deepEqual(effects[0], { effectKind: 'SELECT_OFFER', journeyItemId: id(1), offerId: id(2), offerPrice: { amount: '100.00', currency: 'USD' } });
});

test('selects trusted authority on an equal timestamp and uses exact half-away rounding', () => {
  const tie = compareRecoveryCosts({
    effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: id(20), offerId: id(21), offerPrice: { amount: '100.00', currency: 'USD' } }],
    homeCurrency: 'SGD',
    rates: [rate(1.234, 'USD', 'SGD', 'CONNECTED'), rate(1.235, 'USD', 'SGD', 'AUTHORITATIVE')],
    comparedAt: at,
  });
  assert.equal(tie.ok, true);
  if (tie.ok) {
    assert.deepEqual(tie.lines[0]!.homeAmount, { amount: '123.50', currency: 'SGD' });
    assert.equal(tie.lines[0]!.fxEvidenceId, id(1235));
  }
  const rounded = compareRecoveryCosts({
    effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: id(22), offerId: id(23), offerPrice: { amount: '123', currency: 'JPY' } }],
    homeCurrency: 'USD',
    rates: [rate(0.0091, 'JPY', 'USD')],
    comparedAt: at,
  });
  assert.equal(rounded.ok, true);
  if (rounded.ok) assert.deepEqual(rounded.totalHomeAmount, { amount: '1.12', currency: 'USD' });
});

test('fails closed for missing, future, stale, and untrusted FX evidence', () => {
  const effect: ScenarioEffect = { effectKind: 'SELECT_OFFER', journeyItemId: id(30), offerId: id(31), offerPrice: { amount: '10.00', currency: 'USD' } };
  const result = (rates: FxRateEvidence[]) => compareRecoveryCosts({ effects: [effect], homeCurrency: 'SGD', rates, comparedAt: at });
  assert.equal(failureCode(result([])), 'MISSING_RATE_EVIDENCE');
  assert.equal(failureCode(result([rate(1.3, 'USD', 'SGD', 'CONNECTED', '2030-01-02T00:00:00.000Z')])), 'FUTURE_RATE_EVIDENCE');
  assert.equal(failureCode(result([{ ...rate(1.3, 'USD'), validUntil: '2029-12-31T00:00:00.000Z' }])), 'STALE_RATE_EVIDENCE');
  assert.equal(failureCode(result([rate(1.3, 'USD', 'SGD', 'ASSERTED')])), 'UNTRUSTED_RATE_EVIDENCE');
  const same = compareRecoveryCosts({ effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: id(32), offerId: id(33), offerPrice: { amount: '10.00', currency: 'SGD' } }], homeCurrency: 'SGD', rates: [], comparedAt: at });
  assert.equal(same.ok, true);
});

test('requires a captured SELECT_OFFER price and rejects unsupported rate precision', () => {
  const missingPrice = compareRecoveryCosts({ effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: id(40), offerId: id(41) }], homeCurrency: 'SGD', rates: [], comparedAt: at });
  assert.equal(failureCode(missingPrice), 'MISSING_EFFECT_PRICE');
  const invalidRate = compareRecoveryCosts({ effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: id(42), offerId: id(43), offerPrice: { amount: '10.00', currency: 'USD' } }], homeCurrency: 'SGD', rates: [rate(1e-7, 'USD')], comparedAt: at });
  assert.equal(failureCode(invalidRate), 'INVALID_RATE_PRECISION');
});

test('a zero cancellation penalty is zero potential loss, not a missing price', () => {
  const result = compareRecoveryCosts({
    effects: [{ effectKind: 'CANCEL_STAY', journeyItemId: id(50), reservationLineId: id(51), cancellationPenalty: { amount: '0.00', currency: 'SGD' } }],
    homeCurrency: 'SGD',
    rates: [],
    comparedAt: at,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.lines[0]!.kind, 'POLICY_PENALTY_ESTIMATE');
  assert.deepEqual(result.potentialLossHomeAmount, { amount: '0.00', currency: 'SGD' });
  assert.deepEqual(result.totalHomeAmount, { amount: '0.00', currency: 'SGD' });
  assert.deepEqual(result.newSpendHomeAmount, { amount: '0', currency: 'SGD' });
});
