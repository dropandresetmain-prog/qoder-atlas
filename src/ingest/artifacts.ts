/**
 * B1/B2 — ingestion artifact accumulation.
 * Ingestion output is only proposals/rule-sets/signals/uncertainties; nothing
 * here can mutate authoritative trip state directly (FR-02/FR-04).
 */
import {
  UncertaintyRecordSchema,
  type EntityRef,
  type IsoDateTime,
  type SourceKind,
  type SourceRecord,
  type UncertaintyRecord,
} from '../domain/common.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { MutationOrigin, MutationOperation, MutationProposal } from '../operational/mutation.ts';
import { MutationProposalSchema } from '../operational/mutation.ts';
import type { TripSignal } from '../operational/signal.ts';
import { hashId } from './ids.ts';
import type { IngestionContext } from './source.ts';

export interface IngestionArtifacts {
  proposals: MutationProposal[];
  ruleSets: RuleSet[];
  signals: TripSignal[];
  uncertainties: UncertaintyRecord[];
}

export interface NormalizationEnv {
  source: SourceRecord;
  context: IngestionContext;
  /** Instant used for fact observations and proposal timestamps. */
  now: IsoDateTime;
}

export function emptyArtifacts(): IngestionArtifacts {
  return { proposals: [], ruleSets: [], signals: [], uncertainties: [] };
}

export function mergeArtifacts(target: IngestionArtifacts, ...more: IngestionArtifacts[]): IngestionArtifacts {
  for (const a of more) {
    target.proposals.push(...a.proposals);
    target.ruleSets.push(...a.ruleSets);
    target.signals.push(...a.signals);
    target.uncertainties.push(...a.uncertainties);
  }
  return target;
}

export function hasSubstance(a: IngestionArtifacts): boolean {
  return a.proposals.length > 0 || a.ruleSets.length > 0 || a.signals.length > 0;
}

/** Record missing/ambiguous information as explicit uncertainty — never guess. */
export function addUncertainty(
  artifacts: IngestionArtifacts,
  env: NormalizationEnv,
  statement: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM',
  aboutRefs: EntityRef[] = [],
): void {
  artifacts.uncertainties.push(
    UncertaintyRecordSchema.parse({
      id: hashId('unc', env.source.id, severity, statement),
      statement,
      aboutRefs,
      sourceId: env.source.id,
      severity,
    }),
  );
}

/** Deterministic proposal origin from the source kind on structured paths. */
export function deterministicProposalOrigin(kind: SourceKind): MutationOrigin {
  if (kind === 'MANUAL') return 'HUMAN';
  if (kind === 'PROVIDER_STATE') return 'PROVIDER';
  return 'SYSTEM';
}

/** Build a validated proposal with deterministic identity. */
export function buildProposal(
  env: NormalizationEnv,
  origin: MutationOrigin,
  operations: MutationOperation[],
  rationale: string,
): MutationProposal | undefined {
  if (operations.length === 0) return undefined;
  const fingerprint = operations.map((op) => JSON.stringify(op)).join('|');
  return MutationProposalSchema.parse({
    id: hashId('proposal', env.source.id, fingerprint),
    origin,
    sourceId: env.source.id,
    rationale,
    requestedAt: env.now,
    operations,
  });
}

/** Push a proposal into artifacts when it has operations. */
export function pushProposal(
  artifacts: IngestionArtifacts,
  env: NormalizationEnv,
  origin: MutationOrigin,
  operations: MutationOperation[],
  rationale: string,
): void {
  const proposal = buildProposal(env, origin, operations, rationale);
  if (proposal) artifacts.proposals.push(proposal);
}
