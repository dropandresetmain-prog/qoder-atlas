/**
 * NORTHSTAR v2 — typed conflict/error semantics.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.1: "A conflict is a typed
 * stale-revision outcome, not an unconditional upsert." This module gives
 * every command/execution/authority boundary one closed vocabulary of typed
 * failures so callers can branch on `kind` instead of parsing messages.
 */
import { z } from 'zod';
import { TypedRefSchema } from './identity.ts';

export const TypedConflictKindSchema = z.enum([
  'STALE_AGGREGATE_REVISION',
  'SCOPE_GENERATION_MISMATCH',
  'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
  'DUPLICATE_REGISTRATION',
  'VALIDATION_FAILED',
  'AUTHORITY_DENIED',
  'CAPABILITY_UNSUPPORTED',
  'EXTERNAL_IDENTITY_UNKNOWN',
  'EXTERNAL_IDENTITY_AMBIGUOUS',
  'DISPATCH_OUTCOME_UNKNOWN',
  'OWNERSHIP_NOT_HELD',
  'REQUIREMENT_WOULD_BE_RELAXED',
  'ACYCLIC_GRAPH_VIOLATION',
  'CANDIDATE_CANNOT_BECOME_FACT',
]);
export type TypedConflictKind = z.infer<typeof TypedConflictKindSchema>;

export const TypedConflictSchema = z.strictObject({
  kind: TypedConflictKindSchema,
  message: z.string().min(1),
  subjectRefs: z.array(TypedRefSchema).default([]),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type TypedConflict = z.infer<typeof TypedConflictSchema>;

export function typedConflict(
  kind: TypedConflictKind,
  message: string,
  subjectRefs: TypedConflict['subjectRefs'] = [],
  details?: TypedConflict['details'],
): TypedConflict {
  return { kind, message, subjectRefs, details };
}

/** Discriminated result used by command/execution handlers instead of throwing for expected outcomes. */
export type TypedResult<T> = { ok: true; value: T } | { ok: false; conflict: TypedConflict };

export function ok<T>(value: T): TypedResult<T> {
  return { ok: true, value };
}

export function conflict<T>(c: TypedConflict): TypedResult<T> {
  return { ok: false, conflict: c };
}
