/**
 * Bounded selected-plan continuation evidence.
 *
 * Application-owned: fresh PostgreSQL capture, production M6 evaluators,
 * residual reconstruction and revision accounting are derived here from
 * durable plan/attempt/receipt rows. Callers supply identifiers and time only.
 * This is not a planner, workflow engine or generic residual-plan API.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../pool.ts';
import type { WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import { ScenarioChangeSchema, type ScenarioChange, type ScenarioEffect } from '../../../contracts/v2/scenario/scenarioChange.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { WorldSnapshotManifestSchema } from '../../../contracts/v2/scope/readScope.ts';
import { evaluateRecoveryStrategy } from '../../../resolution/scenarios/evaluate.ts';
import { createM6Registry } from '../../../resolution/evaluation/registry.ts';
import { captureWorld } from '../world/pgCurrentState.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const DEFAULT_CHECKPOINT_TTL_MS = 60 * 60 * 1000;

export interface ContinuationPrerequisiteReceipt {
  attemptId: string;
  actionIntentId: string;
  status: 'OBSERVED_SUCCESS' | 'COMPLETED' | 'RECONCILED';
  canonicalReceipt: { commandNamespace: string; idempotencyKey: string; commandRef?: string };
}

export interface AccountedRevision {
  aggregateRef: TypedRef;
  beforeRevision: number;
  afterRevision: number;
  prerequisiteAttemptId: string;
}

export interface StoredContinuationCheckpoint {
  id: string;
  freshManifest: WorldSnapshotManifest;
  prerequisites: ContinuationPrerequisiteReceipt[];
  residualEffectFingerprints: string[];
  expiresAt: string;
}

interface AuthoritativeResidual {
  recoveryCaseId: string;
  scenarioChange: ScenarioChange;
  residualEffects: ScenarioEffect[];
  prerequisiteIntentIds: Set<string>;
  resolveSubjectRefs: TypedRef[];
}

function effectFingerprint(effect: ScenarioEffect): string {
  return canonicalPayloadHash(effect);
}

async function deriveCanonicalRevisionAccounting(
  db: Queryable,
  workspaceId: string,
  source: WorldSnapshotManifest,
  fresh: WorldSnapshotManifest,
  prerequisiteAttemptIds: readonly string[],
): Promise<AccountedRevision[] | undefined> {
  const freshAggregates = new Map(
    fresh.aggregateReads.map((read) => [`${read.aggregateRef.kind}:${read.aggregateRef.id}`, read]),
  );
  const freshScopes = new Map(
    fresh.scopeReads.map((read) => [`${read.scopeKind}:${read.scopeId}`, read]),
  );
  const planId = prerequisiteAttemptIds.length === 0
    ? undefined
    : (await db.query<{ action_plan_id: string }>(
      `SELECT DISTINCT ai.action_plan_id
         FROM execution_attempts ea
         JOIN action_intents ai ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
        WHERE ea.workspace_id = $1 AND ea.id = ANY($2::uuid[])`,
      [workspaceId, prerequisiteAttemptIds],
    )).rows[0]?.action_plan_id;
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
      derived.push({
        aggregateRef: base.aggregateRef,
        beforeRevision: expected,
        afterRevision: expected + 1,
        prerequisiteAttemptId: change.attempt_id,
      });
      expected += 1;
    }
    // Approval-time budget holds for intents on this same plan are intentional
    // selected-plan side effects, not unrelated world drift. They advance BUDGET
    // before any attempt exists, so they cannot join through canonical applications.
    if (expected !== current.revision && base.aggregateRef.kind === 'BUDGET' && planId) {
      const holds = await db.query<{ before_revision: string | null; after_revision: string }>(
        `SELECT change.before_revision::text, change.after_revision::text
           FROM change_records change
           JOIN action_intents ai
             ON ai.workspace_id = change.workspace_id
            AND change.idempotency_key = ('approval:hold:' || ai.id::text || ':' || $3::text)
          WHERE change.workspace_id = $1
            AND change.subject_kind = 'BUDGET'
            AND change.subject_id = $3::uuid
            AND change.command_namespace = 'BUDGET_HOLD_CREATED'
            AND ai.action_plan_id = $2::uuid
            AND change.after_revision > $4
            AND change.after_revision <= $5
          ORDER BY change.after_revision ASC`,
        [workspaceId, planId, base.aggregateRef.id, expected, current.revision],
      );
      const anchorAttemptId = prerequisiteAttemptIds[0];
      if (!anchorAttemptId) return undefined;
      for (const hold of holds.rows) {
        if (Number(hold.before_revision) !== expected || Number(hold.after_revision) !== expected + 1) return undefined;
        derived.push({
          aggregateRef: base.aggregateRef,
          beforeRevision: expected,
          afterRevision: expected + 1,
          // Plan-level approval hold: anchored to the completed prerequisite that opened continuation.
          prerequisiteAttemptId: anchorAttemptId,
        });
        expected += 1;
      }
    }
    if (expected !== current.revision) return undefined;
  }
  for (const base of source.scopeReads) {
    const current = freshScopes.get(`${base.scopeKind}:${base.scopeId}`);
    if (!current) return undefined;
    if (current.generation === base.generation) continue;
    const matchingJourneyChanges = derived.filter(
      (entry) => entry.aggregateRef.kind === 'JOURNEY' && entry.aggregateRef.id === base.scopeId,
    ).length;
    if (base.scopeKind !== 'JOURNEY' || current.generation - base.generation !== matchingJourneyChanges) {
      return undefined;
    }
  }
  const freshEvidence = new Set(fresh.evidenceReads);
  if (source.evidenceReads.some((evidenceId) => !freshEvidence.has(evidenceId))) return undefined;
  return derived;
}

async function loadAuthoritativeResidual(
  db: Queryable,
  workspaceId: string,
  actionPlanId: string,
  nextIntentId: string,
  strategyId: string,
): Promise<AuthoritativeResidual | undefined> {
  const source = await db.query<{ recovery_case_id: string; scenario_change: unknown }>(
    `SELECT strategy.recovery_case_id, strategy.scenario_change
       FROM action_plans plan
       JOIN recovery_strategies strategy
         ON strategy.workspace_id = plan.workspace_id AND strategy.id = plan.recovery_strategy_id
      WHERE plan.workspace_id = $1 AND plan.id = $2 AND plan.recovery_strategy_id = $3`,
    [workspaceId, actionPlanId, strategyId],
  );
  const sourceRow = source.rows[0];
  const scenario = ScenarioChangeSchema.safeParse(sourceRow?.scenario_change);
  if (!sourceRow || !scenario.success || scenario.data.recoveryStrategyId !== strategyId) return undefined;

  const intents = await db.query<{
    id: string;
    source_effect_index: number | null;
    source_effect_fingerprint: string | null;
    canonical_applied: boolean;
  }>(
    `SELECT intent.id, intent.source_effect_index, intent.source_effect_fingerprint,
            EXISTS (
              SELECT 1 FROM execution_attempts attempt
              JOIN selected_plan_canonical_applications application
                ON application.workspace_id = attempt.workspace_id AND application.attempt_id = attempt.id
              JOIN command_receipts receipt ON receipt.workspace_id = application.workspace_id
                AND receipt.command_namespace = application.command_namespace
                AND receipt.idempotency_key = application.idempotency_key
             WHERE attempt.workspace_id = intent.workspace_id AND attempt.action_intent_id = intent.id
               AND attempt.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
            ) AS canonical_applied
       FROM action_intents intent
      WHERE intent.workspace_id = $1 AND intent.action_plan_id = $2
      ORDER BY intent.source_effect_index ASC NULLS LAST, intent.id ASC`,
    [workspaceId, actionPlanId],
  );
  if (intents.rows.length !== scenario.data.effects.length) return undefined;
  for (let index = 0; index < intents.rows.length; index += 1) {
    const intent = intents.rows[index]!;
    const effect = scenario.data.effects[index]!;
    if (intent.source_effect_index !== index || intent.source_effect_fingerprint !== effectFingerprint(effect)) {
      return undefined;
    }
  }

  const next = intents.rows.find((intent) => intent.id === nextIntentId);
  if (!next || next.canonical_applied) return undefined;
  const residualEffects = intents.rows
    .filter((intent) => !intent.canonical_applied)
    .map((intent) => scenario.data.effects[intent.source_effect_index!]!);

  const dependencies = await db.query<{ from_action_intent_id: string; to_action_intent_id: string }>(
    `SELECT from_action_intent_id, to_action_intent_id
       FROM action_dependencies
      WHERE workspace_id = $1 AND to_action_intent_id = ANY($2::uuid[])`,
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

  const resolveSubjectRefs = scenario.data.affectedSubjectRefs.filter(
    (ref) => ref.kind === 'JOURNEY' || ref.kind === 'TRIP',
  );
  if (resolveSubjectRefs.length === 0) return undefined;

  return {
    recoveryCaseId: sourceRow.recovery_case_id,
    scenarioChange: scenario.data,
    residualEffects,
    prerequisiteIntentIds: required,
    resolveSubjectRefs,
  };
}

async function loadDurablePrerequisites(
  db: Queryable,
  workspaceId: string,
  actionPlanId: string,
  prerequisiteIntentIds: ReadonlySet<string>,
): Promise<ContinuationPrerequisiteReceipt[] | undefined> {
  if (prerequisiteIntentIds.size === 0) return undefined;
  const rows = await db.query<{
    id: string;
    action_intent_id: string;
    status: string;
    command_namespace: string;
    idempotency_key: string;
  }>(
    `SELECT ea.id, ea.action_intent_id, ea.status, application.command_namespace, application.idempotency_key
       FROM execution_attempts ea
       JOIN action_intents intent
         ON intent.workspace_id = ea.workspace_id AND intent.id = ea.action_intent_id
       JOIN selected_plan_canonical_applications application
         ON application.workspace_id = ea.workspace_id AND application.attempt_id = ea.id
       JOIN command_receipts receipt
         ON receipt.workspace_id = application.workspace_id
        AND receipt.command_namespace = application.command_namespace
        AND receipt.idempotency_key = application.idempotency_key
      WHERE ea.workspace_id = $1
        AND intent.action_plan_id = $2
        AND ea.action_intent_id = ANY($3::uuid[])
        AND ea.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
      ORDER BY ea.created_at ASC`,
    [workspaceId, actionPlanId, [...prerequisiteIntentIds]],
  );
  const byIntent = new Map<string, ContinuationPrerequisiteReceipt>();
  for (const row of rows.rows) {
    if (byIntent.has(row.action_intent_id)) continue;
    if (!['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'].includes(row.status)) continue;
    byIntent.set(row.action_intent_id, {
      attemptId: row.id,
      actionIntentId: row.action_intent_id,
      status: row.status as ContinuationPrerequisiteReceipt['status'],
      canonicalReceipt: {
        commandNamespace: row.command_namespace,
        idempotencyKey: row.idempotency_key,
      },
    });
  }
  if (byIntent.size !== prerequisiteIntentIds.size) return undefined;
  return [...prerequisiteIntentIds].map((intentId) => byIntent.get(intentId)!);
}

/**
 * Called after an observed provider (or internal) result is applied. Links
 * attempt → observation (when external) → canonical command receipt.
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
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id, attempt_id) DO NOTHING`,
      [
        input.workspaceId,
        input.attemptId,
        input.source.kind,
        input.source.kind === 'EXTERNAL_PROVIDER' ? input.source.observationId : null,
        input.commandNamespace,
        input.idempotencyKey,
        input.actorId,
      ],
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Root-owned continuation checkpoint. Captures a fresh PostgreSQL world,
 * reconstructs residual effects from the persisted plan, runs production M6
 * evaluation, and stores the checkpoint only when the residual remains VIABLE
 * and all base→fresh revisions are explained by same-plan canonical applications.
 */
export async function createSelectedPlanContinuationCheckpoint(
  pool: Pool,
  input: {
    workspaceId: string;
    actorId: string;
    actionPlanId: string;
    nextActionIntentId: string;
    sourceStrategyId: string;
    now: string;
    /** Optional TTL override for tests; production defaults to one hour. */
    expiresAt?: string;
  },
): Promise<{ ok: true; checkpointId: string } | { ok: false; reason: string }> {
  const authoritative = await loadAuthoritativeResidual(
    pool,
    input.workspaceId,
    input.actionPlanId,
    input.nextActionIntentId,
    input.sourceStrategyId,
  );
  if (!authoritative) return { ok: false, reason: 'STORED_PLAN_RESIDUAL_MISMATCH' };
  if (authoritative.residualEffects.length === 0) return { ok: false, reason: 'NO_RESIDUAL_EFFECTS' };

  const prerequisites = await loadDurablePrerequisites(
    pool,
    input.workspaceId,
    input.actionPlanId,
    authoritative.prerequisiteIntentIds,
  );
  if (!prerequisites) return { ok: false, reason: 'PREREQUISITE_RECEIPT_NOT_PERSISTED' };

  const registry = createM6Registry();
  const freshWorld = await captureWorld(pool, {
    workspaceId: input.workspaceId,
    focus: authoritative.resolveSubjectRefs,
    at: input.now,
    informationTopics: registry.informationTopics,
  });
  const manifest = WorldSnapshotManifestSchema.safeParse(freshWorld.manifest);
  if (!manifest.success) return { ok: false, reason: 'INVALID_FRESH_MANIFEST' };

  const source = await pool.query<{ base_manifest: unknown }>(
    'SELECT base_manifest FROM recovery_strategies WHERE workspace_id = $1 AND id = $2',
    [input.workspaceId, input.sourceStrategyId],
  );
  const sourceManifest = WorldSnapshotManifestSchema.safeParse(source.rows[0]?.base_manifest);
  if (!sourceManifest.success) return { ok: false, reason: 'SOURCE_MANIFEST_MISSING' };

  const derivedAccounting = await deriveCanonicalRevisionAccounting(
    pool,
    input.workspaceId,
    sourceManifest.data,
    manifest.data,
    prerequisites.map((receipt) => receipt.attemptId),
  );
  if (!derivedAccounting) return { ok: false, reason: 'UNACCOUNTED_BASE_REVISION_CHANGE' };

  const evaluation = evaluateRecoveryStrategy({
    recoveryCaseId: authoritative.recoveryCaseId,
    strategyId: input.sourceStrategyId,
    strategyVersion: authoritative.scenarioChange.strategyVersion,
    baseWorld: freshWorld,
    baseManifest: freshWorld.manifest,
    basisAssessmentId: authoritative.scenarioChange.basisAssessmentId,
    scenarioChange: {
      ...authoritative.scenarioChange,
      effects: [...authoritative.residualEffects],
    },
    now: input.now,
    registry,
    resolveSubjectRefs: authoritative.resolveSubjectRefs,
  });
  if (!evaluation.ok || evaluation.value.strategy.viability !== 'VIABLE') {
    return { ok: false, reason: 'RESIDUAL_RC6_NOT_VIABLE' };
  }

  const expiresAt = input.expiresAt
    ?? new Date(Date.parse(input.now) + DEFAULT_CHECKPOINT_TTL_MS).toISOString();
  const checkpointId = randomUUID();
  const evidenceRefs: string[] = [];

  try {
    await pool.query(
      `INSERT INTO selected_plan_continuation_checkpoints (
         workspace_id, id, action_plan_id, next_action_intent_id, source_strategy_id,
         source_effect_manifest, residual_effect_fingerprints, prerequisite_receipts,
         accounted_revisions, fresh_manifest, viability_evidence_refs, expires_at, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::timestamptz,$13)`,
      [
        input.workspaceId,
        checkpointId,
        input.actionPlanId,
        input.nextActionIntentId,
        input.sourceStrategyId,
        JSON.stringify(
          authoritative.scenarioChange.effects.map((effect, index) => ({
            index,
            fingerprint: effectFingerprint(effect),
          })),
        ),
        JSON.stringify(authoritative.residualEffects.map(effectFingerprint)),
        JSON.stringify(prerequisites),
        JSON.stringify({ aggregates: derivedAccounting, scopes: [] }),
        JSON.stringify(manifest.data),
        JSON.stringify(evidenceRefs),
        expiresAt,
        input.actorId,
      ],
    );
    return { ok: true, checkpointId };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadCurrentSelectedPlanContinuation(
  db: Queryable,
  workspaceId: string,
  intentId: string,
  now: string,
): Promise<StoredContinuationCheckpoint | undefined> {
  const result = await db.query<{
    id: string;
    fresh_manifest: unknown;
    prerequisite_receipts: unknown;
    residual_effect_fingerprints: unknown;
    expires_at: Date;
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
  if (!manifest.success || !Array.isArray(row.prerequisite_receipts) || !Array.isArray(row.residual_effect_fingerprints)) {
    return undefined;
  }
  const prerequisites = row.prerequisite_receipts.filter((value): value is ContinuationPrerequisiteReceipt =>
    value !== null
    && typeof value === 'object'
    && typeof (value as ContinuationPrerequisiteReceipt).attemptId === 'string'
    && typeof (value as ContinuationPrerequisiteReceipt).actionIntentId === 'string'
    && typeof (value as ContinuationPrerequisiteReceipt).canonicalReceipt?.commandNamespace === 'string'
    && typeof (value as ContinuationPrerequisiteReceipt).canonicalReceipt?.idempotencyKey === 'string'
    && ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'].includes((value as ContinuationPrerequisiteReceipt).status),
  );
  if (
    prerequisites.length !== row.prerequisite_receipts.length
    || prerequisites.some((receipt) =>
      !receipt.canonicalReceipt.commandNamespace.trim() || !receipt.canonicalReceipt.idempotencyKey.trim()
    )
  ) {
    return undefined;
  }
  return {
    id: row.id,
    freshManifest: manifest.data,
    prerequisites,
    residualEffectFingerprints: row.residual_effect_fingerprints.filter((value): value is string => typeof value === 'string'),
    expiresAt: row.expires_at.toISOString(),
  };
}

/** Find the next dependent intents of a completed intent within the same plan. */
export async function loadNextSelectedPlanIntents(
  db: Queryable,
  workspaceId: string,
  actionPlanId: string,
  completedIntentId: string,
): Promise<string[]> {
  const rows = await db.query<{ to_action_intent_id: string }>(
    `SELECT d.to_action_intent_id
       FROM action_dependencies d
       JOIN action_intents from_intent
         ON from_intent.workspace_id = d.workspace_id AND from_intent.id = d.from_action_intent_id
       JOIN action_intents to_intent
         ON to_intent.workspace_id = d.workspace_id AND to_intent.id = d.to_action_intent_id
      WHERE d.workspace_id = $1
        AND from_intent.action_plan_id = $2
        AND to_intent.action_plan_id = $2
        AND d.from_action_intent_id = $3
      ORDER BY to_intent.source_effect_index ASC NULLS LAST, to_intent.id ASC`,
    [workspaceId, actionPlanId, completedIntentId],
  );
  return rows.rows.map((row) => row.to_action_intent_id);
}
