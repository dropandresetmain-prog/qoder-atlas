/**
 * Bounded selected-plan continuation evidence.
 *
 * This is deliberately not a planner: it evaluates the exact remaining source
 * effects of an already-authorized ActionPlan after canonical prerequisite
 * application. The caller supplies a newly captured PostgreSQL world and the
 * same resolved offer facts; this module calls RC-6 itself and persists only
 * its bounded result plus receipts and revision accounting.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../pool.ts';
import type { WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import { ScenarioChangeSchema, type ScenarioChange, type ScenarioEffect } from '../../../contracts/v2/scenario/scenarioChange.ts';
import type { CapturedWorld } from '../../../resolution/world/world.ts';
import type { EvaluatorRegistry } from '../../../resolution/evaluation/assess.ts';
import type { ResolvedOffer, ResolvedStayOffer } from '../../../resolution/scenarios/overlay.ts';
import { evaluateRecoveryStrategy, type EvaluateStrategyResult } from '../../../resolution/scenarios/evaluate.ts';
import type { TypedResult } from '../../../domain/v2/shared/errors.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { WorldSnapshotManifestSchema } from '../../../contracts/v2/scope/readScope.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';

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
  return canonicalPayloadHash(effect);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalPayloadHash(left) === canonicalPayloadHash(right);
}

interface AuthoritativeResidual {
  recoveryCaseId: string;
  scenarioChange: ScenarioChange;
  residualEffects: ScenarioEffect[];
  prerequisiteIntentIds: Set<string>;
}

async function deriveCanonicalRevisionAccounting(
  db: Queryable, workspaceId: string, source: WorldSnapshotManifest, fresh: WorldSnapshotManifest,
  prerequisiteAttemptIds: readonly string[],
): Promise<AccountedRevision[] | undefined> {
  const freshAggregates = new Map(fresh.aggregateReads.map((read) => [`${read.aggregateRef.kind}:${read.aggregateRef.id}`, read]));
  const freshScopes = new Map(fresh.scopeReads.map((read) => [`${read.scopeKind}:${read.scopeId}`, read]));
  const derived: AccountedRevision[] = [];
  for (const base of source.aggregateReads) {
    const current = freshAggregates.get(`${base.aggregateRef.kind}:${base.aggregateRef.id}`);
    if (!current) return undefined;
    if (current.revision === base.revision) continue;
    const changes = await db.query<{ attempt_id: string; before_revision: string | null; after_revision: string }>(
      `SELECT application.attempt_id, change.before_revision::text, change.after_revision::text
         FROM change_records change
         JOIN selected_plan_canonical_applications application
           ON application.workspace_id = change.workspace_id
          AND application.command_namespace = change.command_namespace
          AND application.idempotency_key = change.idempotency_key
        WHERE change.workspace_id = $1 AND change.subject_kind = $2 AND change.subject_id = $3
          AND application.attempt_id = ANY($4::uuid[])
          AND change.after_revision > $5 AND change.after_revision <= $6
        ORDER BY change.after_revision ASC`,
      [workspaceId, base.aggregateRef.kind, base.aggregateRef.id, prerequisiteAttemptIds, base.revision, current.revision],
    );
    let expected = base.revision;
    for (const change of changes.rows) {
      if (Number(change.before_revision) !== expected || Number(change.after_revision) !== expected + 1) return undefined;
      derived.push({ aggregateRef: base.aggregateRef, beforeRevision: expected, afterRevision: expected + 1, prerequisiteAttemptId: change.attempt_id });
      expected += 1;
    }
    if (expected !== current.revision) return undefined;
  }
  for (const base of source.scopeReads) {
    const current = freshScopes.get(`${base.scopeKind}:${base.scopeId}`);
    if (!current) return undefined;
    if (current.generation === base.generation) continue;
    // Journey-item canonical commands advance the Journey scope exactly once
    // per Journey head advance. Other scope classes have no immutable command
    // provenance in this schema and therefore remain fail-closed.
    const matchingJourneyChanges = derived.filter((entry) => entry.aggregateRef.kind === 'JOURNEY'
      && entry.aggregateRef.id === base.scopeId).length;
    if (base.scopeKind !== 'JOURNEY' || current.generation - base.generation !== matchingJourneyChanges) return undefined;
  }
  const freshEvidence = new Set(fresh.evidenceReads);
  if (source.evidenceReads.some((evidenceId) => !freshEvidence.has(evidenceId))) return undefined;
  return derived;
}

async function loadAuthoritativeResidual(
  db: Queryable, workspaceId: string, actionPlanId: string, nextIntentId: string, strategyId: string,
): Promise<AuthoritativeResidual | undefined> {
  const source = await db.query<{ recovery_case_id: string; scenario_change: unknown }>(
    `SELECT strategy.recovery_case_id, strategy.scenario_change
       FROM action_plans plan
       JOIN recovery_strategies strategy ON strategy.workspace_id = plan.workspace_id AND strategy.id = plan.recovery_strategy_id
      WHERE plan.workspace_id = $1 AND plan.id = $2 AND plan.recovery_strategy_id = $3`,
    [workspaceId, actionPlanId, strategyId],
  );
  const sourceRow = source.rows[0];
  const scenario = ScenarioChangeSchema.safeParse(sourceRow?.scenario_change);
  if (!sourceRow || !scenario.success || scenario.data.recoveryStrategyId !== strategyId) return undefined;
  const intents = await db.query<{ id: string; source_effect_index: number | null; source_effect_fingerprint: string | null; canonical_applied: boolean }>(
    `SELECT intent.id, intent.source_effect_index, intent.source_effect_fingerprint,
            EXISTS (
              SELECT 1 FROM execution_attempts attempt
              JOIN selected_plan_canonical_applications application
                ON application.workspace_id = attempt.workspace_id AND application.attempt_id = attempt.id
              JOIN command_receipts receipt ON receipt.workspace_id = application.workspace_id
                AND receipt.command_namespace = application.command_namespace AND receipt.idempotency_key = application.idempotency_key
             WHERE attempt.workspace_id = intent.workspace_id AND attempt.action_intent_id = intent.id
               AND attempt.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
            ) AS canonical_applied
       FROM action_intents intent
      WHERE intent.workspace_id = $1 AND intent.action_plan_id = $2
      ORDER BY intent.source_effect_index ASC`,
    [workspaceId, actionPlanId],
  );
  if (intents.rows.length !== scenario.data.effects.length) return undefined;
  for (let index = 0; index < intents.rows.length; index += 1) {
    const intent = intents.rows[index]!;
    const effect = scenario.data.effects[index]!;
    if (intent.source_effect_index !== index || intent.source_effect_fingerprint !== effectFingerprint(effect)) return undefined;
  }
  const next = intents.rows.find((intent) => intent.id === nextIntentId);
  if (!next || next.canonical_applied) return undefined;
  const residualEffects = intents.rows.filter((intent) => !intent.canonical_applied)
    .map((intent) => scenario.data.effects[intent.source_effect_index!]!);
  const dependencies = await db.query<{ from_action_intent_id: string; to_action_intent_id: string }>(
    'SELECT from_action_intent_id, to_action_intent_id FROM action_dependencies WHERE workspace_id = $1 AND to_action_intent_id = ANY($2::uuid[])',
    [workspaceId, intents.rows.map((intent) => intent.id)],
  );
  const required = new Set<string>();
  const frontier = [nextIntentId];
  while (frontier.length > 0) {
    const target = frontier.pop()!;
    for (const edge of dependencies.rows.filter((candidate) => candidate.to_action_intent_id === target)) {
      if (!required.has(edge.from_action_intent_id)) {
        required.add(edge.from_action_intent_id);
        frontier.push(edge.from_action_intent_id);
      }
    }
  }
  const byId = new Map(intents.rows.map((intent) => [intent.id, intent]));
  if ([...required].some((id) => !byId.get(id)?.canonical_applied)) return undefined;
  return { recoveryCaseId: sourceRow.recovery_case_id, scenarioChange: scenario.data, residualEffects, prerequisiteIntentIds: required };
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
 * Called from the canonical-application transaction after an observed provider
 * result is applied. The receipt FK is deferred so the command may register
 * this bridge before PgUnitOfWork appends its immutable receipt at commit.
 */
export async function recordSelectedPlanCanonicalApplication(
  db: Queryable,
  input: {
    workspaceId: string;
    actorId: string;
    attemptId: string;
    actionPlanId: string;
    actionIntentId: string;
    commandNamespace: string;
    idempotencyKey: string;
    source: { kind: 'EXTERNAL_PROVIDER'; observationId: string } | { kind: 'INTERNAL_COMMAND' };
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const attempt = await db.query<{ id: string; capability_ref: string }>(
    `SELECT ea.id, ai.capability_ref
       FROM execution_attempts ea
       JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
      WHERE ea.workspace_id = $1 AND ea.id = $2 AND ai.action_plan_id = $3 AND ea.action_intent_id = $4`,
    [input.workspaceId, input.attemptId, input.actionPlanId, input.actionIntentId],
  );
  const storedAttempt = attempt.rows[0];
  if (!storedAttempt) return { ok: false, reason: 'CANONICAL_APPLICATION_ATTEMPT_MISMATCH' };
  const requiresProviderObservation = storedAttempt.capability_ref.startsWith('external:');
  if (requiresProviderObservation !== (input.source.kind === 'EXTERNAL_PROVIDER')) {
    return { ok: false, reason: 'CANONICAL_APPLICATION_SOURCE_KIND_MISMATCH' };
  }
  if (input.source.kind === 'EXTERNAL_PROVIDER') {
    const observation = await db.query<{ id: string }>(
      `SELECT id FROM execution_observations
        WHERE workspace_id = $1 AND id = $2 AND attempt_id = $3 AND action_intent_id = $4
          AND origin = 'EXTERNAL_PROVIDER'`,
      [input.workspaceId, input.source.observationId, input.attemptId, input.actionIntentId],
    );
    if (!observation.rows[0]) return { ok: false, reason: 'CANONICAL_APPLICATION_OBSERVATION_MISMATCH' };
  }
  try {
    await db.query(
      `INSERT INTO selected_plan_canonical_applications (
         workspace_id, attempt_id, application_origin, source_observation_id, command_namespace,
         idempotency_key, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.workspaceId, input.attemptId, input.source.kind,
        input.source.kind === 'EXTERNAL_PROVIDER' ? input.source.observationId : null,
        input.commandNamespace, input.idempotencyKey, input.actorId],
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
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
  if (!sameJson(input.freshManifest, manifest.data)) return { ok: false, reason: 'FRESH_MANIFEST_MISMATCH' };
  const authoritative = await loadAuthoritativeResidual(
    db, input.workspaceId, input.actionPlanId, input.nextActionIntentId, input.sourceStrategyId,
  );
  if (!authoritative) return { ok: false, reason: 'STORED_PLAN_RESIDUAL_MISMATCH' };
  if (input.evaluationInput.recoveryCaseId !== authoritative.recoveryCaseId
    || input.evaluationInput.strategyVersion !== authoritative.scenarioChange.strategyVersion
    || input.evaluationInput.basisAssessmentId !== authoritative.scenarioChange.basisAssessmentId
    || !sameJson(input.evaluationInput.sourceScenarioChange, authoritative.scenarioChange)
    || !sameJson(input.evaluationInput.residualEffects, authoritative.residualEffects)) {
    return { ok: false, reason: 'CALLER_RESIDUAL_MISMATCH' };
  }
  const evaluation = evaluateSelectedPlanResidual({
    ...input.evaluationInput,
    recoveryCaseId: authoritative.recoveryCaseId,
    sourceScenarioChange: authoritative.scenarioChange,
    residualEffects: authoritative.residualEffects,
  });
  if (!evaluation.ok || evaluation.value.strategy.viability !== 'VIABLE') {
    return { ok: false, reason: 'RESIDUAL_RC6_NOT_VIABLE' };
  }
  if (input.prerequisites.length === 0 || input.prerequisites.some((receipt) => !receipt.canonicalReceipt.commandNamespace.trim() || !receipt.canonicalReceipt.idempotencyKey.trim())) {
    return { ok: false, reason: 'CANONICAL_RECEIPT_REQUIRED' };
  }
  if (authoritative.residualEffects.length === 0) return { ok: false, reason: 'NO_RESIDUAL_EFFECTS' };
  if (input.prerequisites.length !== authoritative.prerequisiteIntentIds.size
    || new Set(input.prerequisites.map((receipt) => receipt.actionIntentId)).size !== input.prerequisites.length
    || input.prerequisites.some((receipt) => !authoritative.prerequisiteIntentIds.has(receipt.actionIntentId))) {
    return { ok: false, reason: 'PREREQUISITE_GRAPH_MISMATCH' };
  }
  const checkpointId = randomUUID();
  try {
    const persistedPrerequisites = await db.query<{
      id: string; action_intent_id: string; status: string; command_namespace: string; idempotency_key: string; committed_revisions: unknown;
    }>(
      `SELECT ea.id, ea.action_intent_id, ea.status, receipt.command_namespace, receipt.idempotency_key, receipt.committed_revisions
         FROM execution_attempts ea
         JOIN action_intents attempted_intent
           ON attempted_intent.workspace_id = ea.workspace_id AND attempted_intent.id = ea.action_intent_id
         JOIN LATERAL jsonb_array_elements($2::jsonb) entry ON entry->>'attemptId' = ea.id::text
         JOIN selected_plan_canonical_applications application
           ON application.workspace_id = ea.workspace_id AND application.attempt_id = ea.id
         JOIN command_receipts receipt ON receipt.workspace_id = ea.workspace_id
          AND receipt.command_namespace = application.command_namespace
          AND receipt.idempotency_key = application.idempotency_key
          AND receipt.command_namespace = entry->'canonicalReceipt'->>'commandNamespace'
          AND receipt.idempotency_key = entry->'canonicalReceipt'->>'idempotencyKey'
        WHERE ea.workspace_id = $1 AND ea.id = ANY($3::uuid[]) AND attempted_intent.action_plan_id = $4`,
      [input.workspaceId, JSON.stringify(input.prerequisites), input.prerequisites.map((receipt) => receipt.attemptId), input.actionPlanId],
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
    const derivedAccounting = await deriveCanonicalRevisionAccounting(
      db, input.workspaceId, sourceManifest.data, manifest.data, input.prerequisites.map((receipt) => receipt.attemptId),
    );
    if (!derivedAccounting) return { ok: false, reason: 'UNACCOUNTED_BASE_REVISION_CHANGE' };
    if (!sameJson(input.accountedRevisions, derivedAccounting) || (input.accountedScopeGenerations?.length ?? 0) !== 0) {
      return { ok: false, reason: 'ACCOUNTING_NOT_CANONICAL' };
    }
    await db.query(
      `INSERT INTO selected_plan_continuation_checkpoints (
         workspace_id, id, action_plan_id, next_action_intent_id, source_strategy_id,
         source_effect_manifest, residual_effect_fingerprints, prerequisite_receipts,
         accounted_revisions, fresh_manifest, viability_evidence_refs, expires_at, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::timestamptz,$13)`,
      [
        input.workspaceId, checkpointId, input.actionPlanId, input.nextActionIntentId, input.sourceStrategyId,
        JSON.stringify(authoritative.scenarioChange.effects.map((effect, index) => ({ index, fingerprint: effectFingerprint(effect) }))),
        JSON.stringify(authoritative.residualEffects.map(effectFingerprint)), JSON.stringify(input.prerequisites),
        JSON.stringify({ aggregates: derivedAccounting, scopes: [] }), JSON.stringify(manifest.data), JSON.stringify([...input.viabilityEvidenceRefs]),
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
  // Evidence is immutable, but an exact continuation must still carry every
  // source evidence reference forward. A fresh capture that no longer has a
  // terms/legal evidence dependency is a different decision basis, not a
  // continuation of the selected plan.
  const freshEvidence = new Set(fresh.evidenceReads);
  if (source.evidenceReads.some((evidenceId) => !freshEvidence.has(evidenceId))) return false;
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
