/**
 * Read-side proof for continuing ONE immutable selected plan. This module
 * cannot mint a checkpoint from caller-supplied worlds or evaluator results.
 * The application root owns capture/evaluation and the only checkpoint writer.
 */
import type { Pool, PoolClient } from '../pool.ts';
import { ScenarioChangeSchema, type ScenarioEffect } from '../../../contracts/v2/scenario/scenarioChange.ts';
import { WorldSnapshotManifestSchema, type WorldSnapshotManifest } from '../../../contracts/v2/scope/readScope.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { compareExactMoney } from '../../../domain/v2/shared/money.ts';
import { capabilityForSelectedEffect, selectedEffectFingerprint, selectedPlanFingerprint } from '../../../resolution/execution/selectedPlanIdentity.ts';
import { PgCurrentStateReader } from '../world/pgCurrentState.ts';
import { assessManifestCurrentness } from '../../../resolution/world/currentness.ts';
import { createM6Registry } from '../../../resolution/evaluation/registry.ts';

export type ContinuationDb = Pick<Pool | PoolClient, 'query'>;
export const CONTINUATION_CONTRACT_VERSION = 'selected-plan-continuation/1';
const SUCCESS = ['OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED'];
const UNCERTAIN = ['DISPATCHING', 'DISPATCHED', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'];

export class ContinuationRefusal extends Error {
  readonly code: string;
  constructor(code: string, detail: string) { super(detail); this.name = 'ContinuationRefusal'; this.code = code; }
}
export function continuationAssert(value: unknown, code: string, detail: string): asserts value {
  if (!value) throw new ContinuationRefusal(code, detail);
}
export function decodeJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
export function productionContinuationEvaluatorVersions(): { evaluatorId: string; version: string }[] {
  return createM6Registry().evaluators.map((e) => ({ evaluatorId: e.id, version: e.version }));
}

export interface SelectedIntent {
  id: string; action_plan_id: string; capability_ref: string; request_fingerprint: string;
  source_effect_index: number; source_effect_fingerprint: string;
  subject_refs: TypedRef[]; cost_amount: string | null; cost_currency: string | null;
  offer_fingerprint: string | null;
}
export interface ScopeChange {
  scopeKind: string; scopeId: string; beforeGeneration: number; afterGeneration: number;
}
export interface CanonicalApplicationProof {
  attempt_id: string; action_intent_id: string; action_plan_id: string; source_strategy_id: string;
  source_effect_index: number; source_effect_fingerprint: string; request_fingerprint: string;
  application_origin: 'EXTERNAL_PROVIDER' | 'INTERNAL_COMMAND'; source_observation_id: string | null;
  command_namespace: string; idempotency_key: string; receipt_payload_hash: string;
  completes_effect: boolean; scope_changes: ScopeChange[];
}
export interface SelectedPlanState {
  planId: string; planVersion: number; strategyId: string; strategyVersion: number; caseId: string;
  scenario: ReturnType<typeof ScenarioChangeSchema.parse>; sourceManifest: WorldSnapshotManifest;
  intents: SelectedIntent[]; next: SelectedIntent; residualEffects: ScenarioEffect[];
  receipts: CanonicalApplicationProof[]; sourceFingerprint: string;
  dependencyIds: string[];
}

/** Exact effect->intent bijection; no reconstruction from display names or route. */
export async function loadSelectedPlanState(
  db: ContinuationDb, workspaceId: string, planId: string, nextIntentId: string,
): Promise<SelectedPlanState> {
  const p = (await db.query<{
    plan_version: number; recovery_strategy_id: string; recovery_case_id: string; scenario_change_id: string;
    strategy_version: number; scenario_change: unknown; base_manifest: unknown; viability: string; status: string;
  }>(`SELECT p.plan_version,p.recovery_strategy_id,p.recovery_case_id,p.scenario_change_id,
             s.strategy_version,s.scenario_change,s.base_manifest,s.viability,s.status
        FROM action_plans p JOIN recovery_strategies s
          ON s.workspace_id=p.workspace_id AND s.id=p.recovery_strategy_id
       WHERE p.workspace_id=$1 AND p.id=$2 AND p.recovery_case_id=s.recovery_case_id`, [workspaceId, planId])).rows[0];
  continuationAssert(p && p.viability === 'VIABLE' && !['REJECTED', 'SUPERSEDED'].includes(p.status),
    'SOURCE_PLAN_INVALID', 'The exact persisted selected strategy is unavailable or not executable.');
  const scenario = ScenarioChangeSchema.parse(decodeJson(p.scenario_change));
  continuationAssert(scenario.id === p.scenario_change_id && scenario.recoveryStrategyId === p.recovery_strategy_id
    && scenario.strategyVersion === p.strategy_version, 'SOURCE_PLAN_MISMATCH', 'Plan/strategy/scenario identities differ.');
  const intents = (await db.query<SelectedIntent>(
    `SELECT id,action_plan_id,capability_ref,request_fingerprint,source_effect_index,source_effect_fingerprint,
            subject_refs,cost_amount::text,cost_currency,offer_fingerprint
       FROM action_intents WHERE workspace_id=$1 AND action_plan_id=$2 ORDER BY source_effect_index,id`, [workspaceId, planId])).rows;
  continuationAssert(intents.length === scenario.effects.length && intents.length > 1 && intents.length <= 64,
    'SOURCE_EFFECTS_UNBOUND', 'Continuation requires a bounded complete source-effect mapping.');
  for (const [index, intent] of intents.entries()) {
    const effect = scenario.effects[index]!;
    continuationAssert(intent.source_effect_index === index && intent.source_effect_fingerprint === selectedEffectFingerprint(effect)
      && intent.capability_ref === capabilityForSelectedEffect(effect) && Boolean(intent.request_fingerprint),
    'SOURCE_EFFECT_MISMATCH', `Intent ${intent.id} is not the exact selected source effect.`);
    const money = effect.effectKind === 'CANCEL_STAY' ? effect.cancellationPenalty
      : effect.effectKind === 'SELECT_OFFER' || effect.effectKind === 'ADD_JOURNEY_STAY' ? effect.offerPrice : undefined;
    continuationAssert(!money || (intent.cost_currency === money.currency && intent.cost_amount !== null
      && compareExactMoney({ amount: intent.cost_amount, currency: money.currency }, money) === 0),
    'APPROVED_TERMS_CHANGED', `Intent ${intent.id} amount/currency differs from the selected effect.`);
    if (effect.effectKind === 'SELECT_OFFER' || effect.effectKind === 'ADD_JOURNEY_STAY') {
      continuationAssert(intent.offer_fingerprint === effect.offerId, 'APPROVED_TERMS_CHANGED', 'Selected provider offer identity differs.');
    }
  }
  const next = intents.find((i) => i.id === nextIntentId);
  continuationAssert(next, 'NEXT_INTENT_MISMATCH', 'Next intent does not belong to this plan.');
  const uncertain = await db.query<{ id: string }>(
    `SELECT a.id FROM execution_attempts a JOIN action_intents i
       ON i.workspace_id=a.workspace_id AND i.id=a.action_intent_id
      WHERE a.workspace_id=$1 AND i.action_plan_id=$2 AND a.status=ANY($3::text[]) LIMIT 1`,
    [workspaceId, planId, UNCERTAIN]);
  continuationAssert(uncertain.rows.length === 0, 'PROVIDER_OUTCOME_UNKNOWN', 'Reconcile the in-flight/unknown outcome; continuation cannot authorize redispatch.');

  const receipts = (await db.query<CanonicalApplicationProof>(
    `SELECT c.attempt_id,c.action_intent_id,c.action_plan_id,c.source_strategy_id,c.source_effect_index,
            c.source_effect_fingerprint,c.request_fingerprint,c.application_origin,c.source_observation_id,
            c.command_namespace,c.idempotency_key,c.receipt_payload_hash,c.completes_effect,c.scope_changes
       FROM selected_plan_canonical_applications c
       JOIN execution_attempts a ON a.workspace_id=c.workspace_id AND a.id=c.attempt_id
       JOIN action_intents i ON i.workspace_id=a.workspace_id AND i.id=a.action_intent_id
       JOIN command_receipts r ON r.workspace_id=c.workspace_id
         AND r.command_namespace=c.command_namespace AND r.idempotency_key=c.idempotency_key
      WHERE c.workspace_id=$1 AND c.action_plan_id=$2 AND a.status=ANY($3::text[])
        AND c.action_intent_id=i.id AND i.action_plan_id=c.action_plan_id
        AND i.source_effect_index=c.source_effect_index AND i.source_effect_fingerprint=c.source_effect_fingerprint
        AND i.request_fingerprint=c.request_fingerprint AND a.request_fingerprint=i.request_fingerprint
        AND r.payload_hash=c.receipt_payload_hash
        AND ((c.application_origin='INTERNAL_COMMAND' AND i.capability_ref LIKE 'internal:%')
          OR (c.application_origin='EXTERNAL_PROVIDER' AND i.capability_ref LIKE 'external:%'
            AND EXISTS (SELECT 1 FROM execution_observations o WHERE o.workspace_id=c.workspace_id
              AND o.id=c.source_observation_id AND o.attempt_id=c.attempt_id
              AND o.action_intent_id=c.action_intent_id AND o.origin='EXTERNAL_PROVIDER')))
      ORDER BY c.source_effect_index,c.command_namespace,c.idempotency_key`, [workspaceId, planId, SUCCESS])).rows;
  for (const receipt of receipts) {
    continuationAssert(receipt.source_strategy_id === p.recovery_strategy_id, 'RECEIPT_MISMATCH', 'Receipt belongs to another strategy.');
    receipt.scope_changes = decodeJson<ScopeChange[]>(receipt.scope_changes);
  }
  const completed = new Set(receipts.filter((r) => r.completes_effect).map((r) => r.action_intent_id));
  continuationAssert(!completed.has(next.id), 'NEXT_ALREADY_APPLIED', 'A canonically applied selected action must not be dispatched again.');
  const rows = (await db.query<{ from_action_intent_id: string; to_action_intent_id: string }>(
    `SELECT from_action_intent_id,to_action_intent_id FROM action_dependencies
      WHERE workspace_id=$1 AND action_plan_id=$2 ORDER BY from_action_intent_id,to_action_intent_id`, [workspaceId, planId])).rows;
  const ancestors = new Set<string>();
  const visit = (id: string) => {
    for (const edge of rows.filter((r) => r.to_action_intent_id === id)) {
      continuationAssert(edge.from_action_intent_id !== next.id, 'DEPENDENCY_CYCLE', 'Continuation dependency cycle.');
      if (!ancestors.has(edge.from_action_intent_id)) { ancestors.add(edge.from_action_intent_id); visit(edge.from_action_intent_id); }
    }
  };
  visit(next.id);
  continuationAssert(ancestors.size > 0 && [...ancestors].every((id) => completed.has(id)),
    'PREREQUISITE_NOT_APPLIED', 'Every predecessor needs a known-success observation and its committed canonical application.');
  // An observed success awaiting canonical apply is NOT a residual effect we
  // may book again; stop until its normal canonical reconciliation completes.
  const unbridgedSuccess = await db.query<{ action_intent_id: string }>(
    `SELECT a.action_intent_id FROM execution_attempts a JOIN action_intents i
      ON i.workspace_id=a.workspace_id AND i.id=a.action_intent_id
      WHERE a.workspace_id=$1 AND i.action_plan_id=$2 AND a.status=ANY($3::text[])
        AND NOT (i.id=ANY($4::uuid[])) LIMIT 1`, [workspaceId, planId, SUCCESS, [...completed]]);
  continuationAssert(unbridgedSuccess.rows.length === 0, 'CANONICAL_APPLICATION_PENDING', 'Observed success is pending canonical application, not dispatchable work.');
  const provenReceipts = receipts.filter((r) => completed.has(r.action_intent_id));
  return {
    planId, planVersion: p.plan_version, strategyId: p.recovery_strategy_id, strategyVersion: p.strategy_version,
    caseId: p.recovery_case_id, scenario, sourceManifest: WorldSnapshotManifestSchema.parse(decodeJson(p.base_manifest)),
    intents, next, receipts: provenReceipts, dependencyIds: [...ancestors].sort(),
    residualEffects: intents.filter((i) => !completed.has(i.id)).map((i) => scenario.effects[i.source_effect_index]!),
    sourceFingerprint: selectedPlanFingerprint({ planId, planVersion: p.plan_version, scenario, intents, dependencies: rows }),
  };
}

/** No raw external OBSERVED_SUCCESS shortcut at prepare OR dispatch. */
export async function selectedPlanDependencyReadiness(
  db: ContinuationDb, workspaceId: string, intentId: string,
): Promise<{ ready: boolean; hasExternalPredecessor: boolean; detail?: string }> {
  const rows = (await db.query<{ id: string; capability_ref: string; ready: boolean; failed: boolean }>(
    `SELECT parent.id,parent.capability_ref,
       EXISTS (SELECT 1 FROM execution_attempts a
         WHERE a.workspace_id=parent.workspace_id AND a.action_intent_id=parent.id
           AND ((parent.capability_ref LIKE 'internal:%' AND a.status IN ('OBSERVED_SUCCESS','COMPLETED'))
            OR (parent.capability_ref LIKE 'external:%' AND a.status IN ('OBSERVED_SUCCESS','COMPLETED','RECONCILED')
              AND EXISTS (SELECT 1 FROM selected_plan_canonical_applications c
                JOIN command_receipts r ON r.workspace_id=c.workspace_id AND r.command_namespace=c.command_namespace
                  AND r.idempotency_key=c.idempotency_key AND r.payload_hash=c.receipt_payload_hash
                JOIN execution_observations o ON o.workspace_id=c.workspace_id AND o.id=c.source_observation_id
                  AND o.attempt_id=a.id AND o.action_intent_id=parent.id AND o.origin='EXTERNAL_PROVIDER'
                WHERE c.workspace_id=a.workspace_id AND c.attempt_id=a.id AND c.completes_effect
                  AND c.action_intent_id=parent.id AND c.action_plan_id=parent.action_plan_id
                  AND c.source_effect_index=parent.source_effect_index
                  AND c.source_effect_fingerprint=parent.source_effect_fingerprint
                  AND c.request_fingerprint=parent.request_fingerprint AND a.request_fingerprint=parent.request_fingerprint)))) AS ready,
       EXISTS (SELECT 1 FROM execution_attempts a WHERE a.workspace_id=parent.workspace_id
         AND a.action_intent_id=parent.id AND a.status IN ('OBSERVED_FAILURE','FAILED')) AS failed
       FROM action_dependencies d JOIN action_intents parent
         ON parent.workspace_id=d.workspace_id AND parent.id=d.from_action_intent_id AND parent.action_plan_id=d.action_plan_id
       WHERE d.workspace_id=$1 AND d.to_action_intent_id=$2`, [workspaceId, intentId])).rows;
  const blocker = rows.find((r) => !r.ready || r.failed);
  return { ready: !blocker, hasExternalPredecessor: rows.some((r) => r.capability_ref.startsWith('external:')),
    ...(blocker ? { detail: `Predecessor ${blocker.id} requires committed canonical success.` } : {}) };
}

export interface AccountedChanges {
  revisions: { aggregateRef: TypedRef; beforeRevision: number; afterRevision: number; commandNamespace: string; idempotencyKey: string }[];
  scopes: ScopeChange[];
}

/** Every revision and scope increment is explained, not merely counted. */
export async function deriveSelectedPlanAccounting(
  db: ContinuationDb, workspaceId: string, state: SelectedPlanState, fresh: WorldSnapshotManifest,
): Promise<AccountedChanges> {
  const receiptKeys = new Set(state.receipts.map((r) => `${r.command_namespace}\0${r.idempotency_key}`));
  const revisions: AccountedChanges['revisions'] = [];
  const oldHeads = new Map(state.sourceManifest.aggregateReads.map((r) => [`${r.aggregateRef.kind}:${r.aggregateRef.id}`, r]));
  const newHeads = new Map(fresh.aggregateReads.map((r) => [`${r.aggregateRef.kind}:${r.aggregateRef.id}`, r]));
  for (const key of oldHeads.keys()) continuationAssert(newHeads.has(key), 'SOURCE_READ_DROPPED', `Original read ${key} disappeared from the fresh proof.`);
  for (const [key, current] of newHeads) {
    const original = oldHeads.get(key)?.revision ?? 0;
    continuationAssert(current.revision >= original, 'REVISION_REGRESSED', key);
    if (current.revision === original) continue;
    const changes = (await db.query<{ before_revision: number | null; after_revision: number; command_namespace: string; idempotency_key: string; own_hold: boolean }>(
      `SELECT c.before_revision,c.after_revision,c.command_namespace,c.idempotency_key,
         EXISTS (SELECT 1 FROM command_receipts r JOIN budget_commitments b
           ON b.workspace_id=r.workspace_id AND b.id::text=(r.result_ref::jsonb->>'commitmentId')
           JOIN action_intents i ON i.workspace_id=b.workspace_id AND i.id=b.action_intent_id
           WHERE r.workspace_id=c.workspace_id AND r.command_namespace=c.command_namespace AND r.idempotency_key=c.idempotency_key
             AND c.command_namespace='BUDGET_HOLD_CREATED' AND c.subject_kind='BUDGET'
             AND b.budget_id=c.subject_id AND i.action_plan_id=$6 AND b.status='HELD') AS own_hold
        FROM change_records c WHERE c.workspace_id=$1 AND c.subject_kind=$2 AND c.subject_id=$3
          AND c.after_revision>$4 AND c.after_revision<=$5 ORDER BY c.after_revision`,
      [workspaceId, current.aggregateRef.kind, current.aggregateRef.id, original, current.revision, state.planId])).rows;
    let cursor = original;
    for (const change of changes) {
      continuationAssert(Number(change.before_revision ?? 0) === cursor && Number(change.after_revision) === cursor + 1
        && (receiptKeys.has(`${change.command_namespace}\0${change.idempotency_key}`) || change.own_hold),
      'UNEXPLAINED_CANONICAL_CHANGE', `Unexplained revision of ${key}. New decision required.`);
      revisions.push({ aggregateRef: current.aggregateRef, beforeRevision: cursor, afterRevision: cursor + 1,
        commandNamespace: change.command_namespace, idempotencyKey: change.idempotency_key });
      cursor++;
    }
    continuationAssert(cursor === current.revision, 'UNEXPLAINED_CANONICAL_CHANGE', `Missing canonical receipt chain for ${key}.`);
  }
  const scopes: ScopeChange[] = [];
  const currentScopes = new Map(fresh.scopeReads.map((s) => [`${s.scopeKind}:${s.scopeId}`, s]));
  for (const original of state.sourceManifest.scopeReads) {
    const key = `${original.scopeKind}:${original.scopeId}`;
    const current = currentScopes.get(key);
    continuationAssert(current && current.generation >= original.generation, 'SOURCE_SCOPE_DROPPED', key);
    let cursor = original.generation;
    const candidates = state.receipts.flatMap((r) => r.scope_changes)
      .filter((s) => s.scopeKind === original.scopeKind && s.scopeId === original.scopeId
        && s.afterGeneration > original.generation && s.afterGeneration <= current.generation)
      .sort((a, b) => a.afterGeneration - b.afterGeneration);
    for (const change of candidates) {
      continuationAssert(change.beforeGeneration === cursor && change.afterGeneration === cursor + 1,
        'UNEXPLAINED_SCOPE_CHANGE', `Scope ${key} did not advance solely through these applications.`);
      scopes.push(change); cursor++;
    }
    continuationAssert(cursor === current.generation, 'UNEXPLAINED_SCOPE_CHANGE', `Unattributed scope increment for ${key}.`);
  }
  return { revisions, scopes };
}

export interface CurrentContinuation {
  id: string; freshManifest: WorldSnapshotManifest; state: SelectedPlanState;
  authorityDecisionId: string; expiresAt: string;
}

/** Strong consumer binding: row existence/fingerprint membership is NOT proof. */
export async function loadCurrentSelectedPlanContinuation(
  db: Pool | PoolClient, workspaceId: string, planId: string, nextIntentId: string, now: string,
): Promise<CurrentContinuation | undefined> {
  const row = (await db.query<{
    id: string; source_strategy_id: string; next_request_fingerprint: string; authority_decision_id: string;
    source_fingerprint: string; materialization_fingerprint: string; residual_effect_fingerprints: unknown;
    prerequisite_receipts: unknown; accounted_changes: unknown; fresh_manifest: unknown;
    evaluation_evidence: { contractVersion?: string; evaluatorVersions?: unknown; viability?: string };
    evaluated_at: Date; expires_at: Date;
  }>(`SELECT * FROM selected_plan_continuation_checkpoints
       WHERE workspace_id=$1 AND action_plan_id=$2 AND next_action_intent_id=$3
         AND evaluated_at<=$4::timestamptz AND expires_at>$4::timestamptz
       ORDER BY evaluated_at DESC,id DESC LIMIT 1`, [workspaceId, planId, nextIntentId, now])).rows[0];
  if (!row) return undefined;
  const state = await loadSelectedPlanState(db, workspaceId, planId, nextIntentId);
  continuationAssert(row.source_strategy_id === state.strategyId && row.next_request_fingerprint === state.next.request_fingerprint
    && row.source_fingerprint === state.sourceFingerprint, 'CHECKPOINT_IDENTITY_MISMATCH', 'Checkpoint is not bound to this exact plan, strategy and next action.');
  continuationAssert(selectedPlanFingerprint(decodeJson(row.residual_effect_fingerprints)) === selectedPlanFingerprint(state.residualEffects.map(selectedEffectFingerprint))
    && selectedPlanFingerprint(decodeJson(row.prerequisite_receipts)) === selectedPlanFingerprint(state.receipts),
  'CHECKPOINT_RESIDUAL_MISMATCH', 'Remaining effects or prerequisite canonical receipts changed.');
  const material = (await db.query<{ materialization: unknown; materialization_fingerprint: string; source_fingerprint: string }>(
    'SELECT materialization,materialization_fingerprint,source_fingerprint FROM selected_plan_evaluation_inputs WHERE workspace_id=$1 AND recovery_strategy_id=$2',
    [workspaceId, state.strategyId])).rows[0];
  continuationAssert(material && material.source_fingerprint === selectedPlanFingerprint(state.scenario)
    && material.materialization_fingerprint === row.materialization_fingerprint
    && selectedPlanFingerprint(material.materialization) === row.materialization_fingerprint,
  'APPROVED_TERMS_CHANGED', 'Bound selected provider materialization differs or is missing.');
  const decision = (await db.query<{ id: string }>(
    'SELECT id FROM authority_decisions WHERE workspace_id=$1 AND action_intent_id=$2 ORDER BY issued_at DESC,id DESC LIMIT 1', [workspaceId, nextIntentId])).rows[0];
  continuationAssert(decision?.id === row.authority_decision_id, 'CHECKPOINT_AUTHORITY_MISMATCH', 'The current authority decision is not the checkpoint decision.');
  continuationAssert(row.evaluation_evidence.contractVersion === CONTINUATION_CONTRACT_VERSION && row.evaluation_evidence.viability === 'VIABLE'
    && selectedPlanFingerprint(row.evaluation_evidence.evaluatorVersions) === selectedPlanFingerprint(productionContinuationEvaluatorVersions()),
  'CHECKPOINT_EVALUATOR_MISMATCH', 'Checkpoint does not carry this production evaluator contract.');
  const freshManifest = WorldSnapshotManifestSchema.parse(decodeJson(row.fresh_manifest));
  continuationAssert(freshManifest.capture?.isolation === 'REPEATABLE_READ' && freshManifest.capture.readOnly,
    'CHECKPOINT_CAPTURE_MISSING', 'No authoritative PostgreSQL snapshot capture.');
  const current = await new PgCurrentStateReader(db).loadFor(workspaceId, freshManifest);
  continuationAssert(assessManifestCurrentness(freshManifest, current, now).current,
    'CHECKPOINT_STALE', 'World or clock changed after this continuation checkpoint.');
  continuationAssert(selectedPlanFingerprint(await deriveSelectedPlanAccounting(db, workspaceId, state, freshManifest))
    === selectedPlanFingerprint(decodeJson(row.accounted_changes)), 'CHECKPOINT_ACCOUNTING_MISMATCH', 'Canonical-change proof does not match the committed checkpoint.');
  return { id: row.id, freshManifest, state, authorityDecisionId: row.authority_decision_id, expiresAt: row.expires_at.toISOString() };
}
