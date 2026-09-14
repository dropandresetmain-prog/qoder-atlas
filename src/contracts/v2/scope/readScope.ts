/**
 * NORTHSTAR v2 — ReadScope and WorldSnapshot.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.2. A WorldSnapshot is a read-only
 * consistent slice plus the COMPLETE manifest of what was read, what scope
 * generations were examined, and what coverage limitations apply. Missing
 * coverage is represented explicitly — it is never silently treated as
 * "nothing relevant exists".
 */
import { z } from 'zod';
import { SubjectIdSchema, TypedRefSchema, ScopeGenerationRefSchema, RootRevisionSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';

export const ReadScopeRequestSchema = z.strictObject({
  subjectRefs: z.array(TypedRefSchema).default([]),
  scopeKinds: z.array(ScopeGenerationRefSchema.shape.scopeKind).default([]),
  asOf: InstantSchema.optional(),
});
export type ReadScopeRequest = z.infer<typeof ReadScopeRequestSchema>;

export const CoverageRecordSchema = z.strictObject({
  readerId: z.string().min(1),
  queryBoundsDescription: z.string().min(1),
  editionsRead: z.array(z.string()).default([]),
  watermark: z.string().optional(),
  limitations: z.array(z.string()).default([]),
});
export type CoverageRecord = z.infer<typeof CoverageRecordSchema>;

/** Present even for an empty result set — an empty query result is evidence, not proof of safety. */
export const MissingCoverageSchema = z.strictObject({
  subjectRef: TypedRefSchema.optional(),
  scopeDescription: z.string().min(1),
  reason: z.enum(['NO_READER_REGISTERED', 'READER_UNAVAILABLE', 'SOURCE_INCOMPLETE', 'NOT_YET_EVALUATED']),
});
export type MissingCoverage = z.infer<typeof MissingCoverageSchema>;

/**
 * M6 additive (CONTRACTS.md §7): identity of the consistent read that produced
 * a manifest. Optional so C0-shaped manifests stay valid.
 */
export const SnapshotCaptureSchema = z.strictObject({
  isolation: z.literal('REPEATABLE_READ'),
  readOnly: z.literal(true),
  /** Database snapshot identifier of the read transaction (PostgreSQL `pg_current_snapshot()`). */
  databaseSnapshot: z.string().min(1),
  capturedAt: InstantSchema,
  modelVersion: z.string().min(1),
});
export type SnapshotCapture = z.infer<typeof SnapshotCaptureSchema>;

export const WorldSnapshotManifestSchema = z.strictObject({
  evaluatedAt: InstantSchema,
  capture: SnapshotCaptureSchema.optional(),
  evaluatorVersions: z.array(z.strictObject({ evaluatorId: z.string().min(1), version: z.string().min(1) })).default([]),
  aggregateReads: z.array(RootRevisionSchema).default([]),
  scopeReads: z.array(ScopeGenerationRefSchema).default([]),
  evidenceReads: z.array(SubjectIdSchema).default([]),
  coverageReads: z.array(CoverageRecordSchema).default([]),
  missingCoverage: z.array(MissingCoverageSchema).default([]),
  nextInvalidationAt: InstantSchema.optional(),
});
export type WorldSnapshotManifest = z.infer<typeof WorldSnapshotManifestSchema>;

/** Generic wrapper: a captured, read-only, immutable-for-the-duration-of-evaluation world slice. */
export const WorldSnapshotSchema = z.strictObject({
  manifest: WorldSnapshotManifestSchema,
  typedObjects: z.record(z.string(), z.array(z.unknown())),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

/**
 * Currentness check: a snapshot is stale if any read root has since advanced,
 * any read scope generation has since advanced, or the clock has passed
 * nextInvalidationAt. This can run without trusting any UI cache.
 */
export function isSnapshotCurrent(
  manifest: WorldSnapshotManifest,
  currentHeadsByRefKey: Map<string, number>,
  currentScopeGenerationsByKey: Map<string, number>,
  now: string,
): boolean {
  for (const read of manifest.aggregateReads) {
    const key = `${read.aggregateRef.kind}:${read.aggregateRef.id}`;
    const current = currentHeadsByRefKey.get(key);
    if (current !== undefined && current !== read.revision) return false;
  }
  for (const scope of manifest.scopeReads) {
    const key = `${scope.scopeKind}:${scope.scopeId}`;
    const current = currentScopeGenerationsByKey.get(key);
    if (current !== undefined && current !== scope.generation) return false;
  }
  if (manifest.nextInvalidationAt !== undefined && Date.parse(now) >= Date.parse(manifest.nextInvalidationAt)) {
    return false;
  }
  return true;
}
