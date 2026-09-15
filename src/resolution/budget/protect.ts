/**
 * NORTHSTAR M8 — durable budget commitment admission (exact money).
 *
 * Prevents concurrent overspend using SERIALIZABLE + FOR UPDATE on the budget
 * row and exact integer minor-unit arithmetic from the shared I-10 seam.
 * Currency mismatch, missing FX, and stale quotes are rejected — never coerced.
 */
import {
  addExactMoney,
  compareExactMoney,
  convertExactMoney,
  type ExactMoney,
  type FxObservation,
} from '../../domain/v2/shared/money.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';

export interface BudgetRow {
  id: string;
  amount: ExactMoney;
  currency: string;
}

export interface ExistingCommitment {
  id: string;
  actionIntentId: string;
  amount: ExactMoney;
  status: 'HELD' | 'SETTLED' | 'RELEASED';
}

export type BudgetAdmissionResult =
  | { ok: true; holdAmount: ExactMoney; remainingAfter: ExactMoney }
  | {
      ok: false;
      reason:
        | 'CURRENCY_MISMATCH'
        | 'FX_REQUIRED'
        | 'INSUFFICIENT_BUDGET'
        | 'DUPLICATE_COMMITMENT'
        | 'QUOTE_CHANGED';
      detail?: string;
    };

/**
 * Pure admission check. Caller must hold a locked budget row and the set of
 * active (HELD|SETTLED) commitments read inside the same transaction.
 */
export function admitBudgetHold(params: {
  budget: BudgetRow;
  activeCommitments: ExistingCommitment[];
  actionIntentId: string;
  requested: ExactMoney;
  approvedCeiling?: ExactMoney;
  fx?: FxObservation;
  now?: Instant;
}): BudgetAdmissionResult {
  const duplicate = params.activeCommitments.find((c) => c.actionIntentId === params.actionIntentId && c.status !== 'RELEASED');
  if (duplicate) {
    return { ok: false, reason: 'DUPLICATE_COMMITMENT', detail: duplicate.id };
  }

  let hold = params.requested;
  if (params.requested.currency !== params.budget.amount.currency) {
    const converted = convertExactMoney(
      params.requested,
      params.budget.amount.currency as ExactMoney['currency'],
      params.fx,
      params.now ? { now: params.now } : undefined,
    );
    if (!converted.ok) {
      return { ok: false, reason: 'FX_REQUIRED', detail: converted.reason };
    }
    hold = converted.money;
  }

  if (params.approvedCeiling) {
    if (params.approvedCeiling.currency !== hold.currency) {
      return { ok: false, reason: 'CURRENCY_MISMATCH', detail: 'approved ceiling currency differs from budget' };
    }
    if (compareExactMoney(hold, params.approvedCeiling) > 0) {
      return { ok: false, reason: 'QUOTE_CHANGED', detail: 'requested hold exceeds approved amount ceiling' };
    }
  }

  let used: ExactMoney = { amount: '0', currency: params.budget.amount.currency };
  for (const c of params.activeCommitments) {
    if (c.status === 'RELEASED') continue;
    if (c.amount.currency !== params.budget.amount.currency) {
      return { ok: false, reason: 'CURRENCY_MISMATCH', detail: `commitment ${c.id} currency mismatch` };
    }
    used = addExactMoney(used, c.amount);
  }
  const total = addExactMoney(used, hold);
  if (compareExactMoney(total, params.budget.amount) > 0) {
    return { ok: false, reason: 'INSUFFICIENT_BUDGET', detail: `need ${total.amount} of ${params.budget.amount.amount}` };
  }
  return { ok: true, holdAmount: hold, remainingAfter: subtractExact(params.budget.amount, total) };
}

function subtractExact(a: ExactMoney, b: ExactMoney): ExactMoney {
  return addExactMoney(a, { amount: b.amount.startsWith('-') ? b.amount.slice(1) : `-${b.amount}`, currency: b.currency });
}
