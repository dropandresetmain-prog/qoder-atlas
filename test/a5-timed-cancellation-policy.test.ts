/**
 * Timed cancellation policy: a positive cancelPolicyInfos tier becomes
 * effective at its cancelTime. Before that instant (and before
 * lastFreeCancellationDate when stated), current cancellation loss is zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeStayContext } from '../src/providers/hotel/nuiteeAdapter.ts';
import { evaluateStayCancellationPenalty } from '../src/app/targetHotelCompanionPlanning.ts';
import { compareRecoveryCosts } from '../src/resolution/planning/recoveryCostComparison.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const D3 = '2026-09-29T12:30:00.000Z'; // 2026-09-29T21:30+09:00
const AFTER = '2026-09-30T00:00:00.000Z';

function loadRetrieve(name: string) {
  return JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'recordings', 'nuitee', 'retrieve', name), 'utf8')) as {
    raw: Parameters<typeof normalizeStayContext>[0];
  };
}

test('confirmed lyf retrieve: free until deadline; fee is post-deadline exposure', () => {
  const recording = loadRetrieve('rec_09c4c22e006e5e2df8408247c4716fe8.json');
  const context = normalizeStayContext(recording.raw);
  assert.equal(context.cancellation?.refundable, true);
  assert.equal(context.cancellation?.deadline, '2026-09-29T23:59:59Z');
  assert.deepEqual(context.cancellation?.fee, { amount: 670.77, currency: 'USD' });
});

test('D3 now is before free-cancel deadline so current loss is USD 0', () => {
  const recording = loadRetrieve('rec_09c4c22e006e5e2df8408247c4716fe8.json');
  const context = normalizeStayContext(recording.raw);
  const atD3 = evaluateStayCancellationPenalty({ cancellation: context.cancellation }, D3);
  assert.ok(atD3);
  assert.deepEqual(atD3.amount, { amount: '0', currency: 'USD' });
  assert.equal(atD3.freeCancellationUntil, '2026-09-29T23:59:59Z');
  assert.deepEqual(atD3.scheduledCancellationPenalty, { amount: '670.77', currency: 'USD' });

  const afterDeadline = evaluateStayCancellationPenalty({ cancellation: context.cancellation }, AFTER);
  assert.ok(afterDeadline);
  assert.deepEqual(afterDeadline.amount, { amount: '670.77', currency: 'USD' });
  assert.equal(afterDeadline.scheduledCancellationPenalty, undefined);
  assert.equal(atD3.recoverableStayCredit, undefined, 'no booked total supplied: no refund is invented from the penalty');
});

test('recoverable booking value comes from the confirmed booked total, not the future penalty', () => {
  const context = normalizeStayContext(loadRetrieve('rec_09c4c22e006e5e2df8408247c4716fe8.json').raw);
  assert.deepEqual(context.bookedTotal, { amount: 670.77, currency: 'USD' });
  const atD3 = evaluateStayCancellationPenalty(context, D3);
  assert.deepEqual(atD3?.recoverableStayCredit, { amount: '670.77', currency: 'USD' });
  assert.equal(atD3?.recoverableStayCreditBasis, 'CONFIRMED_BOOKING_TOTAL_LESS_CURRENT_FEE');
  const afterDeadline = evaluateStayCancellationPenalty(context, AFTER);
  assert.deepEqual(afterDeadline?.recoverableStayCredit, { amount: '0.00', currency: 'USD' }, 'full post-deadline fee leaves nothing to recover');
});

test('recovery cost comparison uses current zero loss, not scheduled exposure', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const currentZero = compareRecoveryCosts({
    effects: [
      {
        effectKind: 'CANCEL_STAY',
        journeyItemId: id(1),
        reservationLineId: id(2),
        cancellationPenalty: { amount: '0', currency: 'USD' },
        freeCancellationUntil: '2026-09-29T23:59:59Z',
        scheduledCancellationPenalty: { amount: '670.77', currency: 'USD' },
      },
      {
        effectKind: 'ADD_JOURNEY_STAY',
        proposedJourneyItemId: id(3),
        journeyId: id(4),
        orderKey: '020',
        offerId: id(5),
        offerPrice: { amount: '200.00', currency: 'USD' },
        visit: { kind: 'EXISTING', visitId: id(6) },
      },
    ],
    homeCurrency: 'SGD',
    rates: [{
      id: id(10),
      baseCurrency: 'USD',
      homeCurrency: 'SGD',
      rate: 1.35,
      sourceId: id(11),
      authority: 'CONNECTED',
      observedAt: '2026-09-01T00:00:00+08:00',
    }],
    comparedAt: D3,
  });
  assert.equal(currentZero.ok, true);
  if (!currentZero.ok) return;
  assert.deepEqual(currentZero.potentialLossHomeAmount, { amount: '0.00', currency: 'SGD' });
  assert.deepEqual(currentZero.newSpendHomeAmount, { amount: '270.00', currency: 'SGD' });
  assert.deepEqual(currentZero.creditHomeAmount, { amount: '0', currency: 'SGD' }, 'the future penalty is never a refund');
  assert.deepEqual(currentZero.totalHomeAmount, { amount: '270.00', currency: 'SGD' });
  assert.equal(currentZero.lines.some((line) => line.kind === 'DISPLACED_STAY_CREDIT'), false);

  const afterDeadline = compareRecoveryCosts({
    effects: [{
      effectKind: 'CANCEL_STAY',
      journeyItemId: id(1),
      reservationLineId: id(2),
      cancellationPenalty: { amount: '670.77', currency: 'USD' },
    }],
    homeCurrency: 'SGD',
    rates: [{
      id: id(10),
      baseCurrency: 'USD',
      homeCurrency: 'SGD',
      rate: 1.35,
      sourceId: id(11),
      authority: 'CONNECTED',
      observedAt: '2026-09-01T00:00:00+08:00',
    }],
    comparedAt: AFTER,
  });
  assert.equal(afterDeadline.ok, true);
  if (!afterDeadline.ok) return;
  assert.deepEqual(afterDeadline.potentialLossHomeAmount, { amount: '905.54', currency: 'SGD' });
});
