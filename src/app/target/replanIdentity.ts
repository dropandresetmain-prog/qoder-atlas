/**
 * M9 IN-1 — frozen re-plan / retry / reconciliation identity rules.
 *
 * These rules are product/runtime law. Do not weaken known-success protection
 * or invent a second ActionIntent representation.
 *
 * ## Logical operation identity
 *
 * `logicalOperationKey` is **effect-scoped** (e.g. `select-offer:item:offer`).
 * It identifies the consequential operation across retries and plans.
 * It does **not** include strategyVersion — the same effect after a new
 * strategy remains the same logical operation.
 *
 * ## Retry identity
 *
 * Same `logicalOperationKey` + same `requestFingerprint` → same attempt lineage.
 * In-progress / OUTCOME_UNKNOWN attempts must be reconciled before a new
 * dispatch; prepare returns the known attempt (replay) or blocks.
 *
 * ## Reconciliation identity
 *
 * Reconciliation continues the same execution_attempt row for the same
 * logicalOperationKey + requestFingerprint. It never mints a new irreversible
 * dispatch identity.
 *
 * ## New strategy / new operation
 *
 * A new RecoveryStrategy version may compile a new ActionPlan / ActionIntent
 * for the same effect-scoped key (intent uniqueness is per plan after 0120).
 * Prepare/dispatch still:
 *   - replays known success for the same fingerprint;
 *   - denies a different fingerprint when a live/success attempt exists
 *     (IDEMPOTENCY_KEY_PAYLOAD_MISMATCH / live unique index);
 *   - allows a new attempt after confirmed OBSERVED_FAILURE / FAILED only.
 *
 * ## Known-success replay
 *
 * OBSERVED_SUCCESS / COMPLETED / RECONCILED for (logicalOperationKey,
 * requestFingerprint) → prepare returns replayed=true and does not insert a
 * second attempt. New planning must not accidentally repurchase a known-success
 * action: a different fingerprint against a successful logical key is blocked.
 */
export const M9_REPLAN_IDENTITY = {
  version: 1 as const,
  logicalOperationScope: 'effect' as const,
  intentUniqueness: 'per_action_plan' as const,
  retryPreservesLogicalKeyAndFingerprint: true,
  reconciliationContinuesAttempt: true,
  newStrategyMayPersistSameLogicalKey: true,
  knownSuccessBlocksNewDispatch: true,
  confirmedFailureAllowsNewAttempt: true,
} as const;

export type ReplanIdentityClass =
  | 'RETRY_SAME_OPERATION'
  | 'RECONCILE_SAME_ATTEMPT'
  | 'NEW_STRATEGY_SAME_EFFECT'
  | 'NEW_EFFECT'
  | 'KNOWN_SUCCESS_REPLAY'
  | 'BLOCKED_AFTER_SUCCESS_DIFFERENT_FINGERPRINT';

export function classifyReplanIdentity(input: {
  priorLogicalOperationKey: string | null | undefined;
  priorRequestFingerprint: string | null | undefined;
  nextLogicalOperationKey: string;
  nextRequestFingerprint: string;
  priorAttemptStatus?: string | null;
}): ReplanIdentityClass {
  const priorKey = input.priorLogicalOperationKey ?? null;
  const priorFp = input.priorRequestFingerprint ?? null;
  if (!priorKey) return 'NEW_EFFECT';
  if (priorKey !== input.nextLogicalOperationKey) return 'NEW_EFFECT';
  if (priorFp === input.nextRequestFingerprint) {
    if (input.priorAttemptStatus && ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'].includes(input.priorAttemptStatus)) {
      return 'KNOWN_SUCCESS_REPLAY';
    }
    if (input.priorAttemptStatus && ['OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', 'DISPATCHED', 'DISPATCHING', 'CLAIMED', 'PREPARED'].includes(input.priorAttemptStatus)) {
      return 'RECONCILE_SAME_ATTEMPT';
    }
    return 'RETRY_SAME_OPERATION';
  }
  if (input.priorAttemptStatus && ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'].includes(input.priorAttemptStatus)) {
    return 'BLOCKED_AFTER_SUCCESS_DIFFERENT_FINGERPRINT';
  }
  return 'NEW_STRATEGY_SAME_EFFECT';
}
