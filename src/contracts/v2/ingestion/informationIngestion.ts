/**
 * NORTHSTAR v2 — information ingestion contract.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §7, DATA_STRUCTURE_LOGICAL_SCHEMA.md §6.
 * Every ingested publication carries publisher lineage, source-native
 * fields, sequencing, evidence, scope and coverage. An adapter never
 * collapses these into one normalized severity value that erases dissent.
 */
import { z } from 'zod';
import { SubjectIdSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema, InstantIntervalSchema } from '../../../domain/v2/shared/time.ts';
import { InformationVersionSubtypeSchema } from '../../../domain/v2/knowledge/information.ts';

export const IngestionEnvelopeSchema = z.strictObject({
  publisherOrganisationId: SubjectIdSchema.optional(),
  informationRecordId: SubjectIdSchema,
  externalPublicationKey: z.string().min(1),
  subtype: InformationVersionSubtypeSchema,
  externalEditionSequence: z.number().int().min(0),
  sourceNativeFields: z.record(z.string(), z.unknown()),
  issuedAt: InstantSchema,
  receivedAt: InstantSchema,
  observedAt: InstantSchema,
  effectiveWindow: InstantIntervalSchema.optional(),
  evidenceId: SubjectIdSchema,
  scopeAreaVersionIds: z.array(SubjectIdSchema).default([]),
  scopeJurisdictionIds: z.array(SubjectIdSchema).default([]),
  populationPredicate: z.string().optional(),
  coverageId: SubjectIdSchema,
  normalizationVersion: z.string().min(1),
});
export type IngestionEnvelope = z.infer<typeof IngestionEnvelopeSchema>;

/**
 * Duplicate external key with a DIFFERENT payload hash is a conflict
 * requiring reconciliation — never a silent overwrite. Out-of-order receipt
 * cannot automatically win over an already-accepted later edition.
 */
export function ingestionIsAcceptable(
  incoming: { externalEditionSequence: number; payloadHash: string },
  existing: { externalEditionSequence: number; payloadHash: string } | undefined,
): { accept: true } | { accept: false; reason: 'DUPLICATE_SEQUENCE_HASH_MISMATCH' | 'OUT_OF_ORDER' } {
  if (existing === undefined) return { accept: true };
  if (incoming.externalEditionSequence === existing.externalEditionSequence) {
    return incoming.payloadHash === existing.payloadHash
      ? { accept: true }
      : { accept: false, reason: 'DUPLICATE_SEQUENCE_HASH_MISMATCH' };
  }
  if (incoming.externalEditionSequence < existing.externalEditionSequence) {
    return { accept: false, reason: 'OUT_OF_ORDER' };
  }
  return { accept: true };
}
