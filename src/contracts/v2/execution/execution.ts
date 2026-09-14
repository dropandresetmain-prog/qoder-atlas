/**
 * NORTHSTAR v2 — Execution attempts and observations.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §10, DATA_STRUCTURE_LOGICAL_SCHEMA.md §7/§11.3.
 * The logical operation identity belongs to the ActionIntent and is reused
 * across attempts. A timeout enters OUTCOME_UNKNOWN and must be reconciled
 * through lookup/observation before any resend — it can never be discarded
 * as an ordinary retry failure. Observation updates ONLY source-owned
 * fields; a candidate/proposed value can never masquerade as an observation.
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';

export const ExecutionAttemptStatusSchema = z.enum([
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
]);
export type ExecutionAttemptStatus = z.infer<typeof ExecutionAttemptStatusSchema>;

export const ExecutionAttemptSchema = z.strictObject({
  id: SubjectIdSchema,
  actionIntentId: SubjectIdSchema,
  attemptNumber: z.number().int().min(1),
  logicalOperationKey: z.string().min(1),
  requestFingerprint: z.string().min(1),
  claimToken: z.string().min(1),
  fencingToken: z.number().int().min(0),
  leaseExpiresAt: InstantSchema,
  status: ExecutionAttemptStatusSchema,
  requestRef: z.string().optional(),
  responseRef: z.string().optional(),
});
export type ExecutionAttempt = z.infer<typeof ExecutionAttemptSchema>;

/**
 * Discriminated by origin: an EXTERNAL observation MUST carry an
 * externalRecordId and sourceId from the provider adapter boundary. An
 * INTERNAL observation is the command's own committed receipt — there is no
 * third variant that lets a proposed/candidate field become "observed"
 * without either a provider adapter or a committed internal transaction.
 */
export const ExecutionObservationSchema = z.discriminatedUnion('origin', [
  z.strictObject({
    origin: z.literal('EXTERNAL_PROVIDER'),
    id: SubjectIdSchema,
    attemptId: SubjectIdSchema,
    actionIntentId: SubjectIdSchema,
    externalRecordId: SubjectIdSchema,
    sourceOwnedFields: z.record(z.string(), z.unknown()),
    observedAt: InstantSchema,
    ownedSubjectRefs: z.array(TypedRefSchema).min(1),
  }),
  z.strictObject({
    origin: z.literal('INTERNAL_COMMAND_RECEIPT'),
    id: SubjectIdSchema,
    attemptId: SubjectIdSchema,
    actionIntentId: SubjectIdSchema,
    commandReceiptRef: z.string().min(1),
    observedAt: InstantSchema,
    ownedSubjectRefs: z.array(TypedRefSchema).min(1),
  }),
]);
export type ExecutionObservation = z.infer<typeof ExecutionObservationSchema>;

/**
 * A stale/out-of-order observation retains its evidence but never overwrites
 * a newer accepted observation for the same subject/field-group.
 */
export function observationSupersedes(
  incoming: ExecutionObservation,
  existing: ExecutionObservation | undefined,
): boolean {
  if (existing === undefined) return true;
  return Date.parse(incoming.observedAt) > Date.parse(existing.observedAt);
}

/**
 * Reconciliation gate: an OUTCOME_UNKNOWN attempt must be looked up/observed
 * before a new dispatch reuses the same logical operation key. This function
 * expresses that policy so callers cannot skip it by constructing a fresh
 * attempt with a new key for what is actually the same operation.
 */
export function canDispatchNewAttempt(
  priorAttempts: ExecutionAttempt[],
  logicalOperationKey: string,
): { allowed: true } | { allowed: false; reason: string } {
  const sameOperation = priorAttempts.filter((a) => a.logicalOperationKey === logicalOperationKey);
  const unresolved = sameOperation.find(
    (a) =>
      a.status === 'OUTCOME_UNKNOWN'
      || a.status === 'DISPATCHED'
      || a.status === 'DISPATCHING'
      || a.status === 'CLAIMED'
      || a.status === 'RECONCILIATION_REQUIRED',
  );
  if (unresolved !== undefined) {
    return { allowed: false, reason: `attempt ${unresolved.id} for this logical operation is unresolved; reconcile before redispatch` };
  }
  return { allowed: true };
}
