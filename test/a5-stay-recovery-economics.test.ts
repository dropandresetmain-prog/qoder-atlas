/**
 * Destination-stay recovery economics: current cancellation fee, future penalty
 * and recoverable booking value are distinct, and recoverable value is taken
 * only from the existing booking's confirmed total.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStayContext, type NuiteeRetrieveRaw } from '../src/providers/hotel/nuiteeAdapter.ts';
import { evaluateStayCancellationPenalty } from '../src/app/targetHotelCompanionPlanning.ts';
import { compareRecoveryCosts, safeRecoveryCostMinorUnits } from '../src/resolution/planning/recoveryCostComparison.ts';
import { selectRecommendation } from '../src/resolution/planning/comparator.ts';
import type { ScenarioEffect } from '../src/contracts/v2/scenario/scenarioChange.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLANNING_NOW = '2026-09-29T12:30:00.000Z';
const AFTER_DEADLINE = '2026-09-30T00:00:01.000Z';

/** Provider-shaped retrieve of a refundable booking whose single tier is the full price after a deadline. */
function retrieve(total: number, options: { status?: string; deadline?: string } = {}): NuiteeRetrieveRaw {
  const policy = {
    cancelPolicyInfos: [{ cancelTime: '2026-09-29 23:59:59', amount: total, type: 'amount', timezone: 'GMT', currency: 'USD' }],
    refundableTag: 'RFN',
  };
  return {
    data: {
      bookingId: 'booking-under-test',
      status: options.status ?? 'CONFIRMED',
      hotelId: 'property-under-test',
      hotelName: 'Property under test',
      checkin: '2026-09-29',
      checkout: '2026-10-03',
      price: total,
      currency: 'USD',
      lastFreeCancellationDate: options.deadline ?? '2026-09-29T23:59:59Z',
      cancellationPolicies: policy,
    },
  };
}

function cancelEffect(context: ReturnType<typeof normalizeStayContext>, now: string): Extract<ScenarioEffect, { effectKind: 'CANCEL_STAY' }> {
  const evaluated = evaluateStayCancellationPenalty(context, now);
  assert.ok(evaluated);
  return {
    effectKind: 'CANCEL_STAY',
    journeyItemId: id(1),
    reservationLineId: id(2),
    cancellationPenalty: evaluated.amount,
    cancellationPenaltyBasis: evaluated.basis,
    ...(evaluated.freeCancellationUntil ? { freeCancellationUntil: evaluated.freeCancellationUntil } : {}),
    ...(evaluated.scheduledCancellationPenalty ? { scheduledCancellationPenalty: evaluated.scheduledCancellationPenalty } : {}),
    ...(evaluated.recoverableStayCredit ? { recoverableStayCredit: evaluated.recoverableStayCredit } : {}),
    ...(evaluated.recoverableStayCreditBasis ? { recoverableStayCreditBasis: evaluated.recoverableStayCreditBasis } : {}),
  };
}

const flight: ScenarioEffect = { effectKind: 'SELECT_OFFER', journeyItemId: id(10), offerId: id(11), offerPrice: { amount: '116.96', currency: 'USD' } };
const overnight: ScenarioEffect = {
  effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: id(12), journeyId: id(13), orderKey: '015', offerId: id(14),
  offerPrice: { amount: '35.18', currency: 'USD' }, visit: { kind: 'EXISTING', visitId: id(15) },
};
const replacementStay: ScenarioEffect = {
  effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId: id(16), journeyId: id(13), orderKey: '025', offerId: id(17),
  offerPrice: { amount: '698.83', currency: 'USD' }, visit: { kind: 'EXISTING', visitId: id(18) },
};

function net(effects: ScenarioEffect[]) {
  const result = compareRecoveryCosts({ effects, homeCurrency: 'USD', rates: [], comparedAt: PLANNING_NOW });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('comparison unavailable');
  return result;
}

test('Phase A: open free window → current fee 0, future penalty separate, recoverable = confirmed total', () => {
  const context = normalizeStayContext(retrieve(976.04));
  assert.deepEqual(context.bookedTotal, { amount: 976.04, currency: 'USD' });
  assert.equal(context.noShowCutoff, undefined, 'provider has no machine-readable no-show term; none is invented');
  assert.equal(context.lateArrivalSupported, undefined);
  const evaluated = evaluateStayCancellationPenalty(context, PLANNING_NOW);
  assert.deepEqual(evaluated?.amount, { amount: '0', currency: 'USD' });
  assert.equal(evaluated?.freeCancellationUntil, '2026-09-29T23:59:59Z');
  assert.deepEqual(evaluated?.scheduledCancellationPenalty, { amount: '976.04', currency: 'USD' });
  assert.deepEqual(evaluated?.recoverableStayCredit, { amount: '976.04', currency: 'USD' });
});

test('Phase A: after the deadline the fee is current and nothing is recoverable', () => {
  const evaluated = evaluateStayCancellationPenalty(normalizeStayContext(retrieve(976.04)), AFTER_DEADLINE);
  assert.deepEqual(evaluated?.amount, { amount: '976.04', currency: 'USD' });
  assert.equal(evaluated?.scheduledCancellationPenalty, undefined);
  assert.deepEqual(evaluated?.recoverableStayCredit, { amount: '0.00', currency: 'USD' });
});

test('Phase A: an unconfirmed booking establishes no recoverable value', () => {
  const evaluated = evaluateStayCancellationPenalty(normalizeStayContext(retrieve(976.04, { status: 'PENDING' })), PLANNING_NOW);
  assert.ok(evaluated);
  assert.equal(evaluated.recoverableStayCredit, undefined);
});

test('Phase A: the future penalty alone never produces displaced-stay credit', () => {
  const effect = cancelEffect(normalizeStayContext(retrieve(976.04)), PLANNING_NOW);
  const { recoverableStayCredit: _credit, recoverableStayCreditBasis: _basis, ...penaltyOnly } = effect;
  const result = net([penaltyOnly]);
  assert.deepEqual(result.creditHomeAmount, { amount: '0', currency: 'USD' });
  assert.equal(result.lines.some((line) => line.kind === 'DISPLACED_STAY_CREDIT'), false);
});

test('Phase B: rebook vs keep economics from the confirmed booking', () => {
  const cancel = cancelEffect(normalizeStayContext(retrieve(976.04)), PLANNING_NOW);
  const pathA = net([flight, overnight, replacementStay, cancel]);
  const pathB = net([flight, overnight]);
  assert.deepEqual(pathA.newSpendHomeAmount, { amount: '850.97', currency: 'USD' });
  assert.deepEqual(pathA.potentialLossHomeAmount, { amount: '0.00', currency: 'USD' });
  assert.deepEqual(pathA.creditHomeAmount, { amount: '976.04', currency: 'USD' });
  assert.deepEqual(pathA.totalHomeAmount, { amount: '-125.07', currency: 'USD' });
  assert.deepEqual(pathB.totalHomeAmount, { amount: '152.14', currency: 'USD' });
});

test('Phase B: after the free-cancel deadline, full forfeiture nets to the new spend alone (no double count)', () => {
  // bookedTotal === current fee (full forfeiture): recoverableStayCredit is
  // established at exactly 0. The cancellation fee must not additionally be
  // added on top of a zero credit — that would double the cancellation loss
  // (once as POLICY_PENALTY_ESTIMATE, once by not crediting it back).
  const context = normalizeStayContext(retrieve(955.69));
  const cancel = cancelEffect(context, AFTER_DEADLINE);
  assert.deepEqual(cancel.cancellationPenalty, { amount: '955.69', currency: 'USD' });
  assert.deepEqual(cancel.recoverableStayCredit, { amount: '0.00', currency: 'USD' });
  const pathA = net([flight, overnight, replacementStay, cancel]);
  assert.deepEqual(pathA.newSpendHomeAmount, { amount: '850.97', currency: 'USD' });
  // Still visible for the operator as the current loss, just not double-counted.
  assert.deepEqual(pathA.potentialLossHomeAmount, { amount: '955.69', currency: 'USD' });
  assert.deepEqual(pathA.creditHomeAmount, { amount: '0', currency: 'USD' });
  assert.deepEqual(pathA.totalHomeAmount, { amount: '850.97', currency: 'USD' }, 'must equal newSpend, not newSpend + 955.69');
});

test('Phase B: a different confirmed amount drives the credit, not a quote or stale fixture value', () => {
  const confirmed = cancelEffect(normalizeStayContext(retrieve(981.1)), PLANNING_NOW);
  assert.deepEqual(confirmed.recoverableStayCredit, { amount: '981.10', currency: 'USD' });
  assert.deepEqual(net([flight, overnight, replacementStay, confirmed]).totalHomeAmount, { amount: '-130.13', currency: 'USD' });
  // A historical booking's total can only matter if it is the booking being cancelled.
  const stale = cancelEffect(normalizeStayContext(retrieve(670.77)), PLANNING_NOW);
  assert.notDeepEqual(stale.recoverableStayCredit, confirmed.recoverableStayCredit);
  assert.equal(JSON.stringify(confirmed).includes('670.77'), false);
});

test('Phase B: the comparator picks the lower net cost among viable candidates, whichever it is', () => {
  const cancel = cancelEffect(normalizeStayContext(retrieve(976.04)), PLANNING_NOW);
  const minor = (effects: ScenarioEffect[]) => safeRecoveryCostMinorUnits(net(effects).totalHomeAmount)!;
  const candidates = [
    { strategyRef: id(100), recoveryCaseId: id(99), viability: 'VIABLE' as const, stale: false },
    { strategyRef: id(101), recoveryCaseId: id(99), viability: 'VIABLE' as const, stale: false },
  ];
  const facts = (a: number, b: number) => [
    { strategyRef: id(100), worseCount: 0, betterCount: 1, blastRadiusSize: 4, declaredCostMinorUnits: a },
    { strategyRef: id(101), worseCount: 0, betterCount: 1, blastRadiusSize: 2, declaredCostMinorUnits: b },
  ];
  const rebook = minor([flight, overnight, replacementStay, cancel]);
  const keep = minor([flight, overnight]);
  assert.equal(selectRecommendation({ recoveryCaseId: id(99), viableCandidates: candidates, facts: facts(rebook, keep), comparatorVersion: 't' })?.recommendedStrategyRef, id(100));
  // Expensive replacement: keeping the stay becomes cheaper and wins with no code change.
  const expensiveStay: ScenarioEffect = { ...replacementStay, offerPrice: { amount: '1500.00', currency: 'USD' } } as ScenarioEffect;
  const rebookExpensive = minor([flight, overnight, expensiveStay, cancel]);
  assert.equal(selectRecommendation({ recoveryCaseId: id(99), viableCandidates: candidates, facts: facts(rebookExpensive, keep), comparatorVersion: 't' })?.recommendedStrategyRef, id(101));
});
