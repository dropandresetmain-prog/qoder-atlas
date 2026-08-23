/**
 * Northstar RV-N4 — deterministic mixed-funding allocation (ADR-037).
 *
 * Combines FUNDED_WINDOW policy rules with the cost's temporal anchor to
 * decide who pays. The allocation is deterministic evidence for the
 * authority step: no model call, no assumption. Absent a governing
 * FUNDED_WINDOW rule the allocation stays unresolved (empty) — authority
 * must treat that as UNKNOWN, never as event-funded.
 *
 * Semantics:
 * - costs accruing inside a covered window are the `coveredBy` payer's
 *   responsibility;
 * - incremental costs outside every covered window fall to the rule's
 *   `incrementalPayer`;
 * - multiple windows: the first rule whose window CONTAINS the anchor in
 *   input order governs (deterministic rule order, same discipline as the
 *   authority engine). A window that merely fails to contain the anchor
 *   never decides who pays — the payer must not depend on array order
 *   (REV-2 WP-R5);
 * - the traveller's funding declaration is a desire, not an allocation: it
 *   never overrides rule-derived allocation, but when no rule governs it is
 *   recorded as the declaration evidence instead of being silently dropped.
 */
import type { EntityId, IsoDateTime, Money } from '../domain/common.ts';
import { compareInstants } from '../domain/common.ts';
import type { PolicyRule, Payer } from '../domain/rules.ts';
import type { FundingDeclaration } from '../contracts/changeRequest.ts';
import type { CostAllocation } from '../operational/intent.ts';

export interface CostAllocationInput {
  /** Rules in governing order (rule-set context order, array order within). */
  rules: PolicyRule[];
  /** Incremental cost of the contemplated action. */
  priceDelta: Money;
  /**
   * When the cost accrues (e.g. the extension date the extra night falls on,
   * or the change date for rebooking). Costs without a temporal anchor pass
   * undefined and are never window-matched: they stay unallocated unless a
   * rule explicitly covers unanchored costs, so authority sees UNKNOWN.
   */
  costAccruesAt?: IsoDateTime;
  /** The traveller's own declaration; evidence only. */
  fundingDeclaration?: FundingDeclaration;
}

/**
 * Deterministic payer allocation. Returns undefined when no FUNDED_WINDOW
 * rule can decide — that absence IS the UNKNOWN state (contract: absent
 * allocation means allocation has not been computed).
 */
export function allocateCost(input: CostAllocationInput): CostAllocation | undefined {
  const fundedWindows = input.rules.filter((rule) => rule.kind === 'FUNDED_WINDOW');
  if (fundedWindows.length === 0) return undefined;

  for (const rule of fundedWindows) {
    if (rule.kind !== 'FUNDED_WINDOW') continue;
    const inside = isInFundedWindow(rule.windowStart, rule.windowEnd, input.costAccruesAt);
    // Only a window that CONTAINS the anchor governs. Returning on the
    // first rule that merely CAN decide (anchor present but outside) made
    // the payer depend on array order — id sort, in practice (REV-2 WP-R5).
    if (inside === true) return allocation(input.priceDelta, rule.coveredBy, [rule.id]);
  }
  // No window contains the anchor. With an anchor present the cost accrues
  // outside every covered window: it falls to the incremental payer of the
  // first governing rule in input order (the documented contract). Without
  // an anchor no window can decide at all — allocation stays unresolved.
  if (!input.costAccruesAt) return undefined;
  const governing = fundedWindows[0];
  if (!governing || governing.kind !== 'FUNDED_WINDOW') return undefined;
  return allocation(input.priceDelta, governing.incrementalPayer, [governing.id]);
}

function isInFundedWindow(
  windowStart: IsoDateTime | undefined,
  windowEnd: IsoDateTime | undefined,
  costAccruesAt: IsoDateTime | undefined,
): boolean | undefined {
  if (!costAccruesAt) return undefined;
  if (windowStart && compareInstants(costAccruesAt, windowStart) < 0) return false;
  if (windowEnd && compareInstants(costAccruesAt, windowEnd) > 0) return false;
  return true;
}

function allocation(priceDelta: Money, payer: Payer, derivedFromRuleIds: EntityId[]): CostAllocation {
  if (payer === 'TRAVELLER') {
    return { incrementalAmount: priceDelta, incrementalPayer: payer, derivedFromRuleIds };
  }
  return { coveredAmount: priceDelta, coveredBy: payer, derivedFromRuleIds };
}

/**
 * Human-readable evidence line for read models/audit. Deterministic; mirrors
 * the allocation decision without re-deriving it independently.
 */
export function describeAllocation(allocation: CostAllocation | undefined): string {
  if (!allocation) return 'funding allocation unresolved — no governing funded-window rule';
  if (allocation.coveredAmount && allocation.coveredBy) {
    return `${allocation.coveredAmount.amount} ${allocation.coveredAmount.currency} covered by ${payerLabel(allocation.coveredBy)}`;
  }
  if (allocation.incrementalAmount && allocation.incrementalPayer) {
    return `${allocation.incrementalAmount.amount} ${allocation.incrementalAmount.currency} payable by ${payerLabel(allocation.incrementalPayer)}`;
  }
  return 'funding allocation unresolved';
}

function payerLabel(payer: Payer): string {
  switch (payer) {
    case 'EVENT_ORGANISATION':
      return 'the event organisation';
    case 'ORGANISATION':
      return 'the organisation';
    case 'TRAVELLER':
      return 'the traveller';
    default:
      return 'another payer';
  }
}
