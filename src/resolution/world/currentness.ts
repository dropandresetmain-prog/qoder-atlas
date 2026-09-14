/**
 * NORTHSTAR M6 — manifest currentness with structured staleness reasons.
 *
 * The C0 helper `isSnapshotCurrent` (contracts/v2/scope/readScope.ts) treats a
 * key the caller did not supply as current. M6 never relies on that: the
 * current state is loaded for exactly the manifest's keys, a read aggregate
 * that no longer has a head is STALE, a scope with no row is generation 0 (so
 * a first insertion into a never-advanced scope is detected), and the clock is
 * injected. The result says why, so a caller never has to trust a UI cache or
 * parse text to know what went stale.
 */
import type { ScopeKind, SubjectKind, TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { compareInstants } from '../../domain/v2/shared/time.ts';
import type { WorldSnapshotManifest } from '../../contracts/v2/scope/readScope.ts';

export type StalenessReason =
  | { kind: 'AGGREGATE_ADVANCED'; aggregateRef: TypedRef; readRevision: number; currentRevision: number }
  | { kind: 'AGGREGATE_MISSING'; aggregateRef: TypedRef; readRevision: number }
  | { kind: 'SCOPE_ADVANCED'; scopeKind: ScopeKind; scopeId: string; readGeneration: number; currentGeneration: number }
  | { kind: 'CLOCK_EXPIRED'; nextInvalidationAt: Instant; now: Instant };

export interface CurrentState {
  /** `KIND:id` of each read aggregate root -> current revision; absent means the head no longer exists. */
  heads: ReadonlyMap<string, number>;
  /** `SCOPE_KIND:scopeId` -> current generation; absent means generation 0. */
  scopes: ReadonlyMap<string, number>;
}

export interface CurrentnessVerdict {
  current: boolean;
  reasons: StalenessReason[];
}

export function aggregateKey(ref: { kind: SubjectKind; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

export function scopeKey(scope: { scopeKind: ScopeKind; scopeId: string }): string {
  return `${scope.scopeKind}:${scope.scopeId}`;
}

export function assessManifestCurrentness(manifest: WorldSnapshotManifest, state: CurrentState, now: Instant): CurrentnessVerdict {
  const reasons: StalenessReason[] = [];
  for (const read of manifest.aggregateReads) {
    const current = state.heads.get(aggregateKey(read.aggregateRef));
    if (current === undefined) {
      reasons.push({ kind: 'AGGREGATE_MISSING', aggregateRef: read.aggregateRef, readRevision: read.revision });
    } else if (current !== read.revision) {
      reasons.push({ kind: 'AGGREGATE_ADVANCED', aggregateRef: read.aggregateRef, readRevision: read.revision, currentRevision: current });
    }
  }
  for (const read of manifest.scopeReads) {
    const current = state.scopes.get(scopeKey(read)) ?? 0;
    if (current !== read.generation) {
      reasons.push({ kind: 'SCOPE_ADVANCED', scopeKind: read.scopeKind, scopeId: read.scopeId, readGeneration: read.generation, currentGeneration: current });
    }
  }
  if (manifest.nextInvalidationAt !== undefined && compareInstants(now, manifest.nextInvalidationAt) >= 0) {
    reasons.push({ kind: 'CLOCK_EXPIRED', nextInvalidationAt: manifest.nextInvalidationAt, now });
  }
  return { current: reasons.length === 0, reasons };
}

/** Port: loads current heads/generations for exactly a manifest's keys. */
export interface CurrentStateReader {
  loadFor(workspaceId: string, manifest: WorldSnapshotManifest): Promise<CurrentState>;
}
