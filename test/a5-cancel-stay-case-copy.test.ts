/**
 * Case cost copy for a CANCEL_STAY change keeps current fee, future penalty
 * and recoverable booking value textually distinct. Regression for a bug
 * where the summary line showed scheduledCancellationPenalty (future
 * exposure, never a refund) labelled as recovered value.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { changeSummary } from '../src/ui/caseDecisionPresentation.ts';
import type { RecoveryStrategyChangeView } from '../src/contracts/v2/product/readModels.ts';

const BASE: RecoveryStrategyChangeView = {
  effectKind: 'CANCEL_STAY',
  subjectRef: 'RESERVATION_LINE:00000000-0000-4000-8000-000000000001',
  subjectLabel: 'lyf Bugis Singapore',
};

test('changeSummary shows current fee and recovered value, never the future penalty as a refund', () => {
  // D3-shaped: free-cancel deadline has passed, full forfeiture (recoverableStayCredit
  // established at exactly zero), nothing scheduled for later.
  const afterDeadline: RecoveryStrategyChangeView = {
    ...BASE,
    cancellationPenalty: { amount: '955.69', currency: 'USD' },
    recoverableStayCredit: { amount: '0.00', currency: 'USD' },
  };
  const summary = changeSummary(afterDeadline);
  assert.match(summary, /cancellation fee USD 955\.69/);
  assert.match(summary, /recovered booking value USD 0\.00/);
  assert.equal(/cancelled stay value/.test(summary), false, 'must never use the old mislabeled phrase');
});

test('changeSummary never renders scheduledCancellationPenalty as a recovered/refund amount', () => {
  // Open free window: current fee 0, future exposure 955.69, full value recoverable.
  const openWindow: RecoveryStrategyChangeView = {
    ...BASE,
    cancellationPenalty: { amount: '0', currency: 'USD' },
    scheduledCancellationPenalty: { amount: '955.69', currency: 'USD' },
    recoverableStayCredit: { amount: '955.69', currency: 'USD' },
  };
  const summary = changeSummary(openWindow);
  assert.match(summary, /recovered booking value USD 955\.69/);
  // The future penalty must never appear in the compact summary as if it were
  // a recovered/refunded amount (it happens to equal the credit here, but the
  // summary must be built from recoverableStayCredit, not scheduledCancellationPenalty).
  assert.equal(summary.includes('scheduledCancellationPenalty'), false);
});
