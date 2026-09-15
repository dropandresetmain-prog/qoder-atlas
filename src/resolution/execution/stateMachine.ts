/**
 * NORTHSTAR M8 — durable execution attempt transitions and idempotency gates.
 *
 * Semantics (mapped to durable statuses):
 * - PREPARED: local intent/attempt persisted before any network call
 * - CLAIMED: worker holds lease
 * - DISPATCHING: about to call provider (crash ⇒ possibly sent)
 * - DISPATCHED: request may have left the process; observation pending
 * - OUTCOME_UNKNOWN: response lost / timeout — reconcile before retry
 * - OBSERVED_SUCCESS / OBSERVED_FAILURE: source-owned observation accepted
 * - RECONCILIATION_REQUIRED: lookup/reconcile needed
 * - RECONCILED / COMPLETED / FAILED: terminal workflow states
 *
 * Lease expiry never proves a resend is safe.
 */
import { createHash } from 'node:crypto';
import {
  canDispatchNewAttempt,
  type ExecutionAttempt,
} from '../../contracts/v2/execution/execution.ts';

export const EXECUTION_STATUSES = [
  'PREPARED',
  'CLAIMED',
  'DISPATCHING',
  'DISPATCHED',
  'OUTCOME_UNKNOWN',
  'OBSERVED_SUCCESS',
  'OBSERVED_FAILURE',
  'RECONCILIATION_REQUIRED',
  'RECONCILED',
  'COMPLETED',
  'FAILED',
] as const;

export type DurableExecutionStatus = (typeof EXECUTION_STATUSES)[number];

const ALLOWED: Record<DurableExecutionStatus, ReadonlySet<DurableExecutionStatus>> = {
  PREPARED: new Set(['CLAIMED', 'FAILED']),
  CLAIMED: new Set(['DISPATCHING', 'PREPARED', 'FAILED']),
  DISPATCHING: new Set(['DISPATCHED', 'OUTCOME_UNKNOWN', 'OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'FAILED', 'RECONCILIATION_REQUIRED']),
  DISPATCHED: new Set(['OUTCOME_UNKNOWN', 'OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'RECONCILIATION_REQUIRED']),
  OUTCOME_UNKNOWN: new Set(['RECONCILIATION_REQUIRED', 'OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'RECONCILED']),
  RECONCILIATION_REQUIRED: new Set(['OBSERVED_SUCCESS', 'OBSERVED_FAILURE', 'RECONCILED', 'OUTCOME_UNKNOWN']),
  OBSERVED_SUCCESS: new Set(['RECONCILED', 'COMPLETED']),
  OBSERVED_FAILURE: new Set(['RECONCILED', 'FAILED', 'COMPLETED']),
  RECONCILED: new Set(['COMPLETED', 'FAILED']),
  COMPLETED: new Set(),
  FAILED: new Set(),
};

export function canTransitionExecutionStatus(
  from: DurableExecutionStatus,
  to: DurableExecutionStatus,
): boolean {
  return ALLOWED[from]?.has(to) === true;
}

export function assertExecutionTransition(
  from: DurableExecutionStatus,
  to: DurableExecutionStatus,
): void {
  if (!canTransitionExecutionStatus(from, to)) {
    throw new RangeError(`illegal execution transition ${from} -> ${to}`);
  }
}

/** Statuses that mean a network call may already have occurred. */
export function mayHaveBeenSent(status: DurableExecutionStatus): boolean {
  return status === 'DISPATCHING' || status === 'DISPATCHED' || status === 'OUTCOME_UNKNOWN' || status === 'RECONCILIATION_REQUIRED';
}

/** Lease expiry alone never authorises a fresh irreversible dispatch. */
export function leaseExpiryAllowsBlindRetry(_status: DurableExecutionStatus): false {
  return false;
}

export function computeRequestFingerprint(payload: unknown): string {
  const canonical = JSON.stringify(payload, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
    }
    return v;
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export type IdempotencyCheckResult =
  | { ok: true; kind: 'NEW' | 'SAFE_REPLAY' }
  | { ok: false; kind: 'FINGERPRINT_CONFLICT'; reason: string };

/**
 * Same idempotency/logical key + same fingerprint ⇒ safe replay.
 * Same key + different fingerprint ⇒ reject.
 */
export function checkRequestIdempotency(params: {
  logicalOperationKey: string;
  requestFingerprint: string;
  priorAttempts: ExecutionAttempt[];
}): IdempotencyCheckResult {
  const prior = params.priorAttempts.filter((a) => a.logicalOperationKey === params.logicalOperationKey);
  if (prior.length === 0) return { ok: true, kind: 'NEW' };
  const mismatch = prior.find((a) => a.requestFingerprint !== params.requestFingerprint);
  if (mismatch) {
    return {
      ok: false,
      kind: 'FINGERPRINT_CONFLICT',
      reason: `logical operation ${params.logicalOperationKey} already used with a different request fingerprint`,
    };
  }
  const gate = canDispatchNewAttempt(prior, params.logicalOperationKey);
  if (!gate.allowed) {
    return { ok: false, kind: 'FINGERPRINT_CONFLICT', reason: gate.reason };
  }
  return { ok: true, kind: 'SAFE_REPLAY' };
}

/**
 * Unknown / dispatched outcomes must be reconciled before a new dispatch of
 * the same logical operation. Extends the frozen canDispatchNewAttempt rule
 * to durable CLAIMED/DISPATCHING/RECONCILIATION_REQUIRED statuses.
 */
export function canDispatchAfterReconciliation(params: {
  logicalOperationKey: string;
  priorStatuses: Array<{ logicalOperationKey: string; status: DurableExecutionStatus; id: string }>;
}): { allowed: true } | { allowed: false; reason: string } {
  const same = params.priorStatuses.filter((a) => a.logicalOperationKey === params.logicalOperationKey);
  const blocking = same.find((a) =>
    a.status === 'OUTCOME_UNKNOWN'
    || a.status === 'DISPATCHED'
    || a.status === 'DISPATCHING'
    || a.status === 'CLAIMED'
    || a.status === 'RECONCILIATION_REQUIRED',
  );
  if (blocking) {
    return {
      allowed: false,
      reason: `attempt ${blocking.id} status ${blocking.status} requires reconciliation before redispatch`,
    };
  }
  return { allowed: true };
}
