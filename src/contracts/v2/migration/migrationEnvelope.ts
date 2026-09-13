/**
 * NORTHSTAR v2 — Migration envelope.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §14/§16 migration decision matrix,
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §8 (`legacy_id_map`, `migration_runs`).
 * Preserves dataset identity/hash, original IDs, provenance, source
 * ordering, unknown/ambiguous state and reconciliation needs. A repeat
 * import with a changed payload is a conflict requiring explicit
 * reconciliation, never a silent overwrite.
 */
import { z } from 'zod';
import { SubjectIdSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';

export const MigrationCategoryDecisionSchema = z.enum([
  'TRANSFORM_AND_RESEED',
  'MIGRATE_THEN_RECONCILE',
  'MIGRATE_TRANSFORM',
  'ARCHIVE_AS_IMMUTABLE_HISTORY',
  'TRANSFORM_AND_REASSESS',
  'RECONCILE_BEFORE_DISPATCH',
  'RECOMPUTE_DISCARD_CACHE_ROLE',
  'ARCHIVE_AND_REGENERATE',
  'INVESTIGATE_THEN_TRANSFORM',
  'QUARANTINE_ARCHIVE_REPAIR_WITH_EVIDENCE',
]);
export type MigrationCategoryDecision = z.infer<typeof MigrationCategoryDecisionSchema>;

export const MigrationEnvelopeSchema = z.strictObject({
  datasetSourceSystem: z.string().min(1),
  datasetSourceType: z.string().min(1),
  sourceIdentity: z.string().min(1),
  sourceHash: z.string().min(1),
  originalIds: z.array(z.string()).min(1),
  provenanceDescription: z.string().min(1),
  sourceOrderingKey: z.string().optional(),
  categoryDecision: MigrationCategoryDecisionSchema,
  unknownState: z.strictObject({
    isAmbiguous: z.boolean(),
    reason: z.string().optional(),
  }),
  importerVersion: z.string().min(1),
  targetKind: z.string().min(1),
  targetId: SubjectIdSchema.optional(), // absent while quarantined pending reconciliation
  reconciliationRequired: z.boolean(),
  reconciliationReason: z.string().optional(),
  importedAt: InstantSchema,
});
export type MigrationEnvelope = z.infer<typeof MigrationEnvelopeSchema>;

/** A repeat import with the SAME source identity but a DIFFERENT hash is a conflict, never a silent overwrite. */
export function migrationImportOutcome(
  incoming: { sourceIdentity: string; sourceHash: string },
  existing: { sourceIdentity: string; sourceHash: string } | undefined,
): 'NEW' | 'IDEMPOTENT_REPLAY' | 'CONFLICT_REQUIRES_RECONCILIATION' {
  if (existing === undefined) return 'NEW';
  if (existing.sourceIdentity !== incoming.sourceIdentity) return 'NEW';
  return existing.sourceHash === incoming.sourceHash ? 'IDEMPOTENT_REPLAY' : 'CONFLICT_REQUIRES_RECONCILIATION';
}

/** `legacy_id_map` row: preserves the original mapping for audit/reconciliation tests. */
export const LegacyIdMapEntrySchema = z.strictObject({
  sourceSystem: z.string().min(1),
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  targetKind: z.string().min(1),
  targetId: SubjectIdSchema,
  mappingEvidence: z.string().min(1),
});
export type LegacyIdMapEntry = z.infer<typeof LegacyIdMapEntrySchema>;
