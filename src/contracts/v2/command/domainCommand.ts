/**
 * NORTHSTAR v2 — DomainCommand envelope and typed result.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.1. Every mutation enters through this
 * envelope: expected revisions, idempotency, and (for reviewed changes) the
 * immutable assessment/plan basis that was actually evaluated. A command
 * cannot implicitly reuse an old approval by substituting freshly read
 * generations for the ones its basis recorded.
 */
import { z } from 'zod';
import { WorkspaceIdSchema, SubjectIdSchema, ExpectedRevisionSchema, ScopeGenerationRefSchema } from '../../../domain/v2/shared/identity.ts';
import { TypedConflictSchema } from '../../../domain/v2/shared/errors.ts';

export const DomainCommandEnvelopeSchema = z.strictObject({
  commandType: z.string().min(1),
  schemaVersion: z.string().min(1),
  workspaceId: WorkspaceIdSchema,
  actorPrincipalId: SubjectIdSchema,
  representedPartyId: SubjectIdSchema.optional(),
  idempotencyKey: z.string().min(1),
  canonicalPayloadHash: z.string().min(1),
  expectedAggregateRevisions: z.array(ExpectedRevisionSchema).default([]),
  expectedScopeGenerations: z.array(ScopeGenerationRefSchema).default([]),
  /** Required when this command executes a previously reviewed/assessed change. */
  basisAssessmentId: SubjectIdSchema.optional(),
  basisPlanVersion: z.number().int().min(1).optional(),
  typedPayload: z.unknown(),
  causationId: SubjectIdSchema.optional(),
  correlationId: SubjectIdSchema.optional(),
  evidenceRefs: z.array(SubjectIdSchema).default([]),
});
export type DomainCommandEnvelope = z.infer<typeof DomainCommandEnvelopeSchema>;

export const CommandReceiptSchema = z.strictObject({
  workspaceId: WorkspaceIdSchema,
  commandNamespace: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payloadHash: z.string().min(1),
  /**
   * JSON serialization of the committed command result. This remains named
   * `resultRef` for the frozen receipt shape, but it is not an opaque pointer:
   * equal-key replay decodes this exact value without re-running the handler.
   */
  resultRef: z.string().min(1).refine((value) => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, 'resultRef must be valid JSON'),
  committedRevisions: z.array(ExpectedRevisionSchema),
  committedAt: z.iso.datetime({ offset: true }),
});
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

/** Serializes a JSON-compatible committed result for durable replay. */
export function serializeCommandResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new Error('command result must be JSON-compatible for idempotent replay');
  }
  return serialized;
}

/** Decodes a result previously validated by CommandReceiptSchema and the database constraint. */
export function parseCommandResult(value: string): unknown {
  return JSON.parse(value);
}

/** Typed outcome — never an unconditional upsert. Exactly one branch is populated. */
export const DomainCommandResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('COMMITTED'), receipt: CommandReceiptSchema }),
  z.strictObject({ status: z.literal('CONFLICT'), conflict: TypedConflictSchema }),
  z.strictObject({ status: z.literal('REJECTED'), conflict: TypedConflictSchema }),
]);
export type DomainCommandResult = z.infer<typeof DomainCommandResultSchema>;

/**
 * A repeat submission with the SAME idempotency key must hash-match the
 * original payload to be treated as a safe replay.
 */
export function idempotentReplayIsSafe(
  storedPayloadHash: string,
  incomingPayloadHash: string,
): boolean {
  return storedPayloadHash === incomingPayloadHash;
}
