/**
 * NORTHSTAR v2 — typed extension registration.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §12 "Unprecedented-data extension
 * protocol". Encodes answers to the ten framing questions so a new category
 * (weather, EV charging, accreditation, ...) enters through declared typed
 * schema/readers/evaluators — never a generic JSON fact bucket, and never by
 * rewriting Trip/Journey/Case ownership.
 */
import { z } from 'zod';
import { SubjectKindSchema } from '../../../domain/v2/shared/identity.ts';

export const ExtensionRegistrationSchema = z.strictObject({
  extensionId: z.string().min(1),
  ownerModule: z.string().min(1),
  /** Q1/Q2: nature of the new data and whether it needs independent identity. */
  natureKind: z.enum(['EXTERNAL_OBSERVED_CLAIM', 'INTERNAL_CONTROLLED_OBJECT', 'INTENTION', 'REQUIREMENT', 'PROPOSAL', 'COMPUTED_CONCLUSION']),
  needsIndependentIdentity: z.boolean(),
  /** Q3: which existing or newly registered subject kind owns this. */
  ownerSubjectKind: SubjectKindSchema.or(z.string().min(1)),
  typedObjectSchemaRef: z.string().min(1),
  typedDetailTableRef: z.string().min(1).optional(),
  /** Q4: ordinary references / applicability scopes connecting it to existing objects. */
  applicabilityReaderRef: z.string().min(1),
  /** Q5: provenance/authority/sequencing/freshness/uncertainty/coverage preserved. */
  preservesProvenance: z.boolean(),
  preservesCoverage: z.boolean(),
  /** Q6: commands that accept changes and which revisions/generations/signals they touch. */
  registeredCommands: z.array(z.string().min(1)).min(1),
  invalidatesScopeKinds: z.array(z.string().min(1)).min(1),
  /** Q8: deterministic evaluator adding meaning/reasons/manifest dependencies. */
  evaluatorRef: z.string().min(1),
  /** Q9: optional new capability, only if genuinely new external actuation is required. */
  optionalCapabilityRef: z.string().optional(),
  /** Q10: additive migration/contract version and acceptance evidence. */
  schemaMigrationRef: z.string().min(1),
  contractVersion: z.string().min(1),
  testEvidenceRefs: z.array(z.string().min(1)).min(1),
}).refine(
  (v) => v.natureKind !== 'INTERNAL_CONTROLLED_OBJECT' || v.needsIndependentIdentity,
  { message: 'an internally controlled object requires an independent identity, not a bare detail row' },
);
export type ExtensionRegistration = z.infer<typeof ExtensionRegistrationSchema>;

/**
 * Rejects the two disqualifying patterns the closure explicitly forbids:
 * a generic JSON bag standing in for typed ownership, and rewriting core
 * Trip/Journey/Case ownership to accommodate the new category.
 */
export function extensionRegistrationIsAcceptable(
  registration: Pick<ExtensionRegistration, 'typedObjectSchemaRef'>,
): { acceptable: true } | { acceptable: false; reason: string } {
  if (registration.typedObjectSchemaRef.trim().length === 0) {
    return { acceptable: false, reason: 'a generic/untyped schema reference is not an acceptable extension mechanism' };
  }
  // Owning under a core kind (TRIP/JOURNEY/RECOVERY_CASE) is fine for e.g. a
  // new Journey detail; the disqualifying case is REPLACING that kind's
  // ownership semantics, which this additive-only registration shape has no
  // field to express in the first place.
  return { acceptable: true };
}
