/**
 * Bounded selected-plan continuation evidence.
 *
 * This is deliberately not a planner: it evaluates the exact remaining source
 * effects of an already-authorized ActionPlan after canonical prerequisite
 * application. The caller supplies a newly captured PostgreSQL world and the
 * same resolved offer facts; this module calls RC-6 itself and persists only
 * its bounded result plus receipts and revision accounting.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../pool.ts';
import type { WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import type { ScenarioChange, ScenarioEffect } from '../../../contracts/v2/scenario/scenarioChange.ts';
import type { CapturedWorld } from '../../../resolution/world/world.ts';
import type { EvaluatorRegistry } from '../../../resolution/evaluation/assess.ts';
import type { ResolvedOffer, ResolvedStayOffer } from '../../../resolution/scenarios/overlay.ts';
import { evaluateRecoveryStrategy, type EvaluateStrategyResult } from '../../../resolution/scenarios/evaluate.ts';
import type { TypedResult } from '../../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { WorldSnapshotManifestSchema } from '../../../contracts/v2/scope/readScope.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface ContinuationPrerequisiteReceipt {
  attemptId: string;
  actionIntentId: string;
  status: 'OBSERVED_SUCCESS' | 'COMPLETED' | 'RECONCILED';
  /** Immutable command_receipts key for canonical application after observation. */
  canonicalReceipt: { commandNamespace: string; idempotencyKey: string; commandRef?: string };
}

export interface AccountedRevision {
  aggregateRef: TypedRef;
  beforeRevision: number;
  afterRevision: number;
  prerequisiteAttemptId: string;
}

export interface AccountedScopeGeneration {
  scopeKind: string;
  scopeId: string;
  beforeGeneration: number;
  afterGeneration: number;
  prerequisiteAttemptId: string;
}

export interface ResidualEvaluationInput {
  recoveryCaseId: string;
  strategyId: string;
  strategyVersion: number;
  basisAssessmentId: string;
  sourceScenarioChange: ScenarioChange;
  residualEffects: readonly ScenarioEffect[];
  currentWorld: CapturedWorld;
  registry: EvaluatorRegistry;
  now: string;
  resolvedOffers?: readonly ResolvedOffer[];
  resolvedStayOffers?: readonly ResolvedStayOffer[];
  resolveSubjectRefs: readonly TypedRef[];
}

function effectFingerprint(effect: ScenarioEffect): string {
  return createHash('sha256').update(JSON.stringify(effect)).digest('hex');
}

/** Calls the existing deterministic RC-6 implementation for exact residual effects. */
export function evaluateSelectedPlanResidual(input: ResidualEvaluationInput): TypedResult<EvaluateStrategyResult> {
  const residual = {
    ...input.sourceScenarioChange,
    effects: [...input.residualEffects],
  };
  return evaluateRecoveryStrategy({
    recoveryCaseId: input.recoveryCaseId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    baseWorld: input.currentWorld,
    baseManifest: input.currentWorld.manifest,
    basisAssessmentId: input.basisAssessmentId,
    scenarioChange: residual,
    now: input.now,
    registry: input.registry,
    ...(input.resolvedOffers ? { resolvedOffers: input.resolvedOffers } : {}),
    ...(input.resolvedStayOffers ? { resolvedStayOffers: input.resolvedStayOffers } : {}),
    resolveSubjectRefs: input.resolveSubjectRefs,
  });
}

export interface PersistSelectedPlanContinuationInput {
  workspaceId: string;
  actorId: string;
  actionPlanId: string;
  nextActionIntentId: string;
  sourceStrategyId: string;
  /** Fresh canonical capture + exact residual effects for the RC-6 call. */
  evaluationInput: ResidualEvaluationInput;
  prerequisites: readonly ContinuationPrerequisiteReceipt[];
  accountedRevisions: readonly AccountedRevision[];
  accountedScopeGenerations?: readonly AccountedScopeGeneration[];
  freshManifest: WorldSnapshotManifest;
  viabilityEvidenceRefs: readonly string[];
  expiresAt: string;
}

/**
 * Stores a checkpoint only after this module runs RC-6 and finds the exact
 * residual candidate viable. No caller-proclaimed viability input exists.
 */
export async function persistSelectedPlanContinuation(
  db: Queryable,
  input: PersistSelectedPlanContinuationInput,
): Promise<{ ok: true; checkpointId: string } | { ok: false; reason: string }> {
  if (input.evaluationInput.strategyId !== input.sourceStrategyId) return { ok: false, reason: 'STRATEGY_ID_MISMATCH' };
  const manifest = WorldSnapshotManifestSchema.safeParse(input.evaluationInput.currentWorld.manifest);
  if (!manifest.success) return { ok: false, reason: 'INVALID_FRESH_MANIFEST' };
  const evaluation = evaluateSelectedPlanResidual(input.evaluationInput);
  if (!evaluation.ok || evaluation.value.strategy.viability !== 'VIABLE') {
    return { ok: false, reason: 'RESIDUAL_RC6_NOT_VIABLE' };
  }
  if (input.prerequisites.length === 0 || input.prerequisites.some((receipt) => !receipt.canonicalReceipt.commandNamespace.trim() || !receipt.canonicalReceipt.idempotencyKey.trim())) {
    return { ok: false, reason: 'CANONICAL_RECEIPT_REQUIRED' };
  }
  if (input.evaluationInput.residualEffects.length === 0) return { ok: false, reason: 'NO_RESIDUAL_EFFECTS' };
  const checkpointId = randomUUID();
  try {
    const persistedPrerequisites = await db.query<{
      id: string; action_intent_id: string; status: string; command_namespace: string; idempotency_key: string; committed_revisions: unknown;
    }>(
      `SELECT ea.id, ea.action_intent_id, ea.status, receipt.command_namespace, receipt.idempotency_key, receipt.committed_revisions
         FROM execution_attempts ea
         JOIN LATERAL jsonb_array_elements($2::jsonb) entry ON entry->>'attemptId' = ea.id::text
         JOIN command_receipts receipt ON receipt.workspace_id = ea.workspace_id
          AND receipt.command_namespace = entry->'canonicalReceipt'->>'commandNamespace'
          AND receipt.idempotency_key = entry->'canonicalReceipt'->>'idempotencyKey'
        WHERE ea.workspace_id = $1 AND ea.id = ANY($3::uuid[])`,
      [input.workspaceId, JSON.stringify(input.prerequisites), input.prerequisites.map((receipt) => receipt.attemptId)],
    );
    if (persistedPrerequisites.rows.length !== input.prerequisites.length) return { ok: false, reason: 'PREREQUISITE_RECEIPT_NOT_PERSISTED' };
    const rowsByAttempt = new Map(persistedPrerequisites.rows.map((row) => [row.id, row]));
    if (!input.prerequisites.every((receipt) => {
      const row = rowsByAttempt.get(receipt.attemptId);
      return row?.action_intent_id === receipt.actionIntentId && row.status === receipt.status
        && row.command_namespace === receipt.canonicalReceipt.commandNamespace
        && row.idempotency_key === receipt.canonicalReceipt.idempotencyKey;
    })) return { ok: false, reason: 'PREREQUISITE_STATUS_OR_RECEIPT_MISMATCH' };

    const source = await db.query<{ base_manifest: unknown }>(
      'SELECT base_manifest FROM recovery_strategies WHERE workspace_id = $1 AND id = $2', [input.workspaceId, input.sourceStrategyId],
    );
    const sourceManifest = WorldSnapshotManifestSchema.safeParse(source.rows[0]?.base_manifest);
    if (!sourceManifest.success) return { ok: false, reason: 'SOURCE_MANIFEST_MISSING' };
    if (!allOriginalChangesAccounted(sourceManifest.data, manifest.data, input.accountedRevisions, input.accountedScopeGenerations ?? [])) {
      return { ok: false, reason: 'UNACCOUNTED_BASE_REVISION_CHANGE' };
    }
    if (!input.accountedRevisions.every((accounted) => {
      const prerequisite = input.prerequisites.find((receipt) => receipt.attemptId === accounted.prerequisiteAttemptId);
      const row = prerequisite ? rowsByAttempt.get(prerequisite.attemptId) : undefined;
      const revisions = Array.isArray(row?.committed_revisions) ? row.committed_revisions as Array<{ aggregateRef?: TypedRef; expectedRevision?: number }> : [];
      return revisions.some((revision) => revision.aggregateRef?.kind === accounted.aggregateRef.kind
        && revision.aggregateRef.id === accounted.aggregateRef.id && revision.expectedRevision === accounted.afterRevision);
    })) return { ok: false, reason: 'ACCOUNTED_REVISION_NOT_IN_CANONICAL_RECEIPT' };
    await db.query(
      `INSERT INTO selected_plan_continuation_checkpoints (
         workspace_id, id, action_plan_id, next_action_intent_id, source_strategy_id,
         source_effect_manifest, residual_effect_fingerprints, prerequisite_receipts,
         accounted_revisions, fresh_manifest, viability_evidence_refs, expires_at, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::timestamptz,$13)`,
      [
        input.workspaceId, checkpointId, input.actionPlanId, input.nextActionIntentId, input.sourceStrategyId,
        JSON.stringify(input.evaluationInput.sourceScenarioChange.effects.map((effect, index) => ({ index, fingerprint: effectFingerprint(effect) }))),
        JSON.stringify(input.evaluationInput.residualEffects.map(effectFingerprint)), JSON.stringify(input.prerequisites),
        JSON.stringify({ aggregates: input.accountedRevisions, scopes: input.accountedScopeGenerations ?? [] }), JSON.stringify(manifest.data), JSON.stringify([...input.viabilityEvidenceRefs]),
        input.expiresAt, input.actorId,
      ],
    );
    return { ok: true, checkpointId };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface StoredContinuationCheckpoint {
  id: string;
  freshManifest: WorldSnapshotManifest;
  prerequisites: ContinuationPrerequisiteReceipt[];
  residualEffectFingerprints: string[];
  expiresAt: string;
}

function allOriginalChangesAccounted(
  source: WorldSnapshotManifest, fresh: WorldSnapshotManifest,
  aggregateAccounting: readonly AccountedRevision[], scopeAccounting: readonly AccountedScopeGeneration[],
): boolean {
  const freshAggregates = new Map(fresh.aggregateReads.map((read) => [`${read.aggregateRef.kind}:${read.aggregateRef.id}`, read]));
  for (const base of source.aggregateReads) {
    const current = freshAggregates.get(`${base.aggregateRef.kind}:${base.aggregateRef.id}`);
    if (!current) return false;
    if (current.revision !== base.revision && !aggregateAccounting.some((entry) => entry.aggregateRef.kind === base.aggregateRef.kind
      && entry.aggregateRef.id === base.aggregateRef.id && entry.beforeRevision === base.revision && entry.afterRevision === current.revision)) return false;
  }
  const freshScopes = new Map(fresh.scopeReads.map((read) => [`${read.scopeKind}:${read.scopeId}`, read]));
  for (const base of source.scopeReads) {
    const current = freshScopes.get(`${base.scopeKind}:${base.scopeId}`);
    if (!current) return false;
    if (current.generation !== base.generation && !scopeAccounting.some((entry) => entry.scopeKind === base.scopeKind
      && entry.scopeId === base.scopeId && entry.beforeGeneration === base.generation && entry.afterGeneration === current.generation)) return false;
  }
  return true;
}

export async function loadCurrentSelectedPlanContinuation(
  db: Queryable, workspaceId: string, intentId: string, now: string,
): Promise<StoredContinuationCheckpoint | undefined> {
  const result = await db.query<{
    id: string; fresh_manifest: unknown; prerequisite_receipts: unknown;
    residual_effect_fingerprints: unknown; expires_at: Date;
  }>(
    `SELECT id, fresh_manifest, prerequisite_receipts, residual_effect_fingerprints, expires_at
       FROM selected_plan_continuation_checkpoints
      WHERE workspace_id = $1 AND next_action_intent_id = $2 AND expires_at > $3::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, intentId, now],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const manifest = WorldSnapshotManifestSchema.safeParse(row.fresh_manifest);
  if (!manifest.success || !Array.isArray(row.prerequisite_receipts) || !Array.isArray(row.residual_effect_fingerprints)) return undefined;
  const prerequisites = row.prerequisite_receipts.filter((value): value is ContinuationPrerequisiteReceipt =>
    value !== null && typeof value === 'object'
      && typeof (value as ContinuationPrerequisiteReceipt).attemptId === 'string'
      && typeof (value as ContinuationPrerequisiteReceipt).actionIntentId === 'string'
      && typeof (value as ContinuationPrerequisiteReceipt).canonicalReceipt?.commandNamespace === 'string'
      && typeof (value as ContinuationPrerequisiteReceipt).canonicalReceipt?.idempotencyKey === 'string'
      && ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'].includes((value as ContinuationPrerequisiteReceipt).status),
  );
  if (prerequisites.length !== row.prerequisite_receipts.length || prerequisites.some((receipt) => !receipt.canonicalReceipt.commandNamespace.trim() || !receipt.canonicalReceipt.idempotencyKey.trim())) return undefined;
  return {
    id: row.id, freshManifest: manifest.data, prerequisites,
    residualEffectFingerprints: row.residual_effect_fingerprints.filter((value): value is string => typeof value === 'string'),
    expiresAt: row.expires_at.toISOString(),
  };
}
