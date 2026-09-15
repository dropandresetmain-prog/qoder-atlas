/**
 * CK2 — derive multi-action / partial-recovery / duplicate-exposure summaries
 * from per-intent facts. Pure; no scenario names.
 */
import type {
  DuplicateBookingExposureView,
  PartialRecoveryView,
  RecoveryActionView,
} from '../../../contracts/v2/product/readModels.ts';
import type { RecoveryActionFact } from './types.ts';

export function projectRecoveryAction(fact: RecoveryActionFact): RecoveryActionView {
  return {
    actionRef: fact.actionRef,
    domain: fact.domain,
    capability: fact.capability,
    subjectRefs: [...fact.subjectRefs],
    ...(fact.cost ? { cost: { ...fact.cost } } : {}),
    authorityState: fact.authorityState,
    ...(fact.approvalState ? { approvalState: fact.approvalState } : {}),
    dependencyOrder: fact.dependencyOrder,
    dependsOnActionRefs: [...(fact.dependsOnActionRefs ?? [])],
    executionState: fact.executionState,
    ...(fact.observationResult ? { observationResult: fact.observationResult } : {}),
    uncertainty: [...(fact.uncertainty ?? [])],
  };
}

export function derivePartialRecovery(actions: readonly RecoveryActionFact[]): PartialRecoveryView {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const pending: string[] = [];
  for (const action of actions) {
    const obs = (action.observationResult ?? '').toUpperCase();
    if (
      action.executionState === 'COMPLETED'
      || obs === 'CONFIRMED'
      || obs === 'CANCELLED'
      || obs === 'SUCCEEDED'
    ) {
      succeeded.push(action.actionRef);
      continue;
    }
    if (
      action.executionState === 'FAILED'
      || obs === 'FAILED'
      || obs === 'OUTCOME_UNKNOWN'
    ) {
      failed.push(action.actionRef);
      continue;
    }
    pending.push(action.actionRef);
  }
  return { succeeded, failed, pending };
}

export function deriveRemainingRecoveryWork(actions: readonly RecoveryActionFact[]): string[] {
  const partial = derivePartialRecovery(actions);
  const work: string[] = [];
  for (const ref of partial.failed) {
    const action = actions.find((a) => a.actionRef === ref);
    work.push(action
      ? `${action.capability} on ${action.subjectRefs.join('|') || action.actionRef} unresolved (${action.observationResult ?? action.executionState})`
      : `${ref} unresolved`);
  }
  for (const ref of partial.pending) {
    const action = actions.find((a) => a.actionRef === ref);
    work.push(action
      ? `${action.capability} pending (${action.executionState})`
      : `${ref} pending`);
  }
  return work;
}

/**
 * Detect replacement CONFIRMED + displaced cancel FAILED/UNKNOWN for same-domain stay.
 * Matching uses dependsOnActionRefs (cancel depends on book) when present.
 */
export function deriveDuplicateBookingExposure(
  actions: readonly RecoveryActionFact[],
): DuplicateBookingExposureView[] {
  const exposures: DuplicateBookingExposureView[] = [];
  const books = actions.filter((a) =>
    a.capability === 'hotel.book' || a.capability.endsWith('.book'));
  const cancels = actions.filter((a) =>
    a.capability === 'hotel.cancel' || a.capability.endsWith('.cancel'));

  for (const cancel of cancels) {
    const obs = (cancel.observationResult ?? '').toUpperCase();
    const cancelFailed = cancel.executionState === 'FAILED'
      || obs === 'FAILED'
      || obs === 'OUTCOME_UNKNOWN'
      || cancel.executionState === 'OUTCOME_UNKNOWN';
    if (!cancelFailed) continue;

    // Cancel depends on replacement book (book → cancel).
    let replacement = books.find((b) => (cancel.dependsOnActionRefs ?? []).includes(b.actionRef));
    if (!replacement && books.length === 1 && cancels.length === 1) {
      replacement = books[0];
    }
    if (!replacement) continue;

    const confirmed = (replacement.observationResult ?? '').toUpperCase() === 'CONFIRMED'
      || replacement.executionState === 'COMPLETED';
    if (!confirmed) continue;

    exposures.push({
      replacementActionRef: replacement.actionRef,
      displacedActionRef: cancel.actionRef,
      displacedSubjectRef: cancel.subjectRefs[0] ?? cancel.actionRef,
      replacementObservation: replacement.observationResult ?? 'CONFIRMED',
      displacedCancellationObservation: cancel.observationResult ?? cancel.executionState,
      detail: 'Replacement stay confirmed while displaced cancellation failed or remains unknown — duplicate booking/cost exposure',
    });
  }
  return exposures;
}

export function sumAggregateRecoveryCost(
  actions: readonly RecoveryActionFact[],
): { amount: string; currency: string } | undefined {
  const withCost = actions.filter((a) => a.cost);
  if (withCost.length === 0) return undefined;
  const currency = withCost[0]!.cost!.currency;
  if (withCost.some((a) => a.cost!.currency !== currency)) return undefined;
  let total = 0n;
  let scale = 0;
  for (const action of withCost) {
    const raw = action.cost!.amount;
    const parts = raw.split('.');
    const frac = parts[1] ?? '';
    scale = Math.max(scale, frac.length);
  }
  for (const action of withCost) {
    const raw = action.cost!.amount;
    const negative = raw.startsWith('-');
    const unsigned = negative ? raw.slice(1) : raw;
    const [whole, frac = ''] = unsigned.split('.');
    const padded = `${whole}${frac.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '') || '0';
    const minor = BigInt(padded);
    total += negative ? -minor : minor;
  }
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const digits = abs.toString().padStart(scale + 1, '0');
  const amount = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return { amount: negative ? `-${amount}` : amount, currency };
}
