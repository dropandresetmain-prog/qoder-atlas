/**
 * Application-owned selected-plan continuation: IDs in, authoritative PG
 * capture + production RC-6 evaluation + immutable checkpoint out. No caller
 * world, evaluator, residual effects, price, receipt or "viable" flag is accepted.
 * Nothing here dispatches, schedules, replans or performs hotel execution.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { AssessmentResult } from '../../contracts/v2/assessment/assessmentManifest.ts';
import { PgReadSessionFactory } from '../../persistence/postgres/world/pgReadSession.ts';
import { PgWorldReader } from '../../persistence/postgres/world/pgWorldReader.ts';
import { PgCurrentStateReader } from '../../persistence/postgres/world/pgCurrentState.ts';
import { saveAssessment } from '../../persistence/postgres/world/pgAssessments.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { assessSubject } from '../../resolution/evaluation/assess.ts';
import { projectEffectiveWorld } from '../../resolution/world/effectiveItinerary.ts';
import { assessManifestCurrentness } from '../../resolution/world/currentness.ts';
import { evaluateRecoveryStrategy } from '../../resolution/scenarios/evaluate.ts';
import { selectedPlanFingerprint, selectedEffectFingerprint } from '../../resolution/execution/selectedPlanIdentity.ts';
import {
  CONTINUATION_CONTRACT_VERSION, ContinuationRefusal, continuationAssert,
  loadSelectedPlanState, deriveSelectedPlanAccounting, productionContinuationEvaluatorVersions,
  type ContinuationDb,
} from '../../persistence/postgres/execution/selectedPlanContinuation.ts';
import { evaluateStoredExecutionGate } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import { loadSelectedPlanEvaluationInputs } from './selectedPlanEvaluationInputs.ts';

export interface SelectedPlanContinuationRequest { actionPlanId: string; nextActionIntentId: string }
export type SelectedPlanContinuationResult =
  | { ok: true; checkpointId: string; expiresAt: string }
  | { ok: false; code: string; detail: string };

/** Trusted composition dependencies. Clock override is for integration tests only. */
export interface SelectedPlanContinuationComposition {
  pool: Pool; workspaceId: string; actorId: string;
  executorPrincipalId: () => string | undefined;
  clock?: () => string;
}

const MAX_CHECKPOINT_AGE_MS = 30_000;

export function createSelectedPlanContinuationService(deps: SelectedPlanContinuationComposition) {
  const clock = deps.clock ?? (() => new Date().toISOString());
  return async (request: SelectedPlanContinuationRequest): Promise<SelectedPlanContinuationResult> => {
    try {
      // Explicit rejection also protects plain JS callers, not just TypeScript.
      continuationAssert(Object.keys(request).sort().join(',') === 'actionPlanId,nextActionIntentId',
        'CONTINUATION_IDS_ONLY', 'Continuation accepts only the selected plan and next intent IDs.');
      const principalId = deps.executorPrincipalId();
      continuationAssert(principalId, 'EXECUTOR_NOT_COMPOSED', 'Normal root has no dispatch principal.');
      const now = clock();
      const registry = createM6Registry();
      const captured = await new PgReadSessionFactory(deps.pool).withReadSession(deps.workspaceId, async (session) => {
        // The reader is bound by the factory to this single PostgreSQL RR / READ
        // ONLY transaction. It is not an injectable request-world abstraction.
        const db = session.db as unknown as ContinuationDb;
        const state = await loadSelectedPlanState(db, deps.workspaceId, request.actionPlanId, request.nextActionIntentId);
        continuationAssert(!state.sourceManifest.nextInvalidationAt || Date.parse(state.sourceManifest.nextInvalidationAt) > Date.parse(now),
          'SOURCE_CLOCK_EXPIRED', 'The approved basis crossed a time-only invalidation. New decision required.');
        const retained = await loadSelectedPlanEvaluationInputs(db, deps.workspaceId, state, now);
        const focus = [...new Map([
          ...state.scenario.affectedSubjectRefs,
          ...state.sourceManifest.aggregateReads.map((r) => r.aggregateRef),
          ...retained.material.stays.map((s): TypedRef => ({ kind: 'PLACE', id: s.placeId })),
        ].map((r) => [`${r.kind}:${r.id}`, r])).values()];
        // Keep original read dependencies, including de-selected service roots
        // and empty scopes, instead of silently narrowing the approved world.
        await session.recordAggregates(state.sourceManifest.aggregateReads.map((r) => r.aggregateRef));
        await session.recordScopes(state.sourceManifest.scopeReads);
        for (const id of state.sourceManifest.evidenceReads) session.manifest.evidence(id);
        const world = await new PgWorldReader().capture(session, {
          workspaceId: deps.workspaceId, focus, at: now, informationTopics: registry.informationTopics,
        });
        const accounting = await deriveSelectedPlanAccounting(db, deps.workspaceId, state, world.manifest);
        const decision = (await db.query<{ id: string }>(
          'SELECT id FROM authority_decisions WHERE workspace_id=$1 AND action_intent_id=$2 ORDER BY issued_at DESC,id DESC LIMIT 1',
          [deps.workspaceId, state.next.id])).rows[0];
        continuationAssert(decision, 'AUTHORITY_MISSING', 'No approval envelope exists for this exact remaining action.');
        return { state, retained, world, accounting, authorityDecisionId: decision.id };
      });
      const { state, retained, world } = captured;
      const remainingOfferIds = new Set(state.residualEffects.flatMap((e) => e.effectKind === 'SELECT_OFFER' ? [e.offerId] : []));
      const offers = retained.material.offers.filter((o) => remainingOfferIds.has(o.offerId));
      const services = retained.material.services.filter((s) => offers.some((o) => o.transportServiceId === s.id));
      continuationAssert(services.every((s) => !world.transportServices.some((canonical) => canonical.id === s.id)),
        'RESEARCH_CANONICAL_ID_COLLISION', 'A research service cannot overwrite captured canonical supplier state.');
      const evaluated = evaluateRecoveryStrategy({
        recoveryCaseId: state.caseId, strategyId: state.strategyId, strategyVersion: state.strategyVersion,
        basisAssessmentId: state.scenario.basisAssessmentId,
        scenarioChange: { ...state.scenario, effects: state.residualEffects },
        baseWorld: { ...world, transportServices: [...world.transportServices, ...services] },
        baseManifest: world.manifest, now, registry, resolvedOffers: offers, resolvedStayOffers: retained.material.stays,
        resolveSubjectRefs: state.scenario.affectedSubjectRefs.filter((r) => r.kind === 'JOURNEY' || r.kind === 'TRIP'),
      });
      continuationAssert(evaluated.ok && evaluated.value.canonicalUntouched && evaluated.value.strategy.viability === 'VIABLE',
        'RESIDUAL_NOT_VIABLE', evaluated.ok ? JSON.stringify(evaluated.value.viabilityDecisions) : evaluated.conflict.message);
      const candidates = evaluated.value.strategy.candidateAssessmentResults;
      // Publish ONLY freshly evaluated canonical-world assessments through the
      // existing assessment store. Counterfactual residual results stay solely
      // in checkpoint evidence; they never masquerade as current canonical PASS.
      const canonical: AssessmentResult[] = [];
      for (const summary of evaluated.value.baselineAssessments) {
        canonical.push(assessSubject({ world, effective: projectEffectiveWorld(world), registry,
          subject: summary.subjectRef, now, assessmentId: randomUUID(), kind: 'VIABILITY' }).result);
      }
      const invalidations = [state.sourceManifest.nextInvalidationAt,
        ...canonical.map((a) => a.manifest.nextInvalidationAt), ...candidates.map((a) => a.manifest.nextInvalidationAt),
        ...services.map((s) => s.researchedOffer?.commercial.expiresAt)].filter((v): v is string => Boolean(v));
      const expiresAt = new Date(Math.min(Date.parse(now) + MAX_CHECKPOINT_AGE_MS, ...invalidations.map(Date.parse))).toISOString();
      continuationAssert(Date.parse(expiresAt) > Date.parse(clock()), 'CHECKPOINT_EXPIRED', 'Evaluation or material evidence expired before checkpoint commit.');
      for (const assessment of canonical) await saveAssessment(deps.pool, deps.workspaceId, assessment, deps.actorId);
      const manifest = { ...world.manifest, evaluatorVersions: productionContinuationEvaluatorVersions(), nextInvalidationAt: expiresAt };
      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const currentTime = clock();
        continuationAssert(assessManifestCurrentness(manifest, await new PgCurrentStateReader(client).loadFor(deps.workspaceId, manifest), currentTime).current,
          'CAPTURE_CHANGED', 'State changed between authoritative capture and checkpoint commit.');
        const reloaded = await loadSelectedPlanState(client, deps.workspaceId, state.planId, state.next.id);
        continuationAssert(selectedPlanFingerprint(reloaded) === selectedPlanFingerprint(state), 'PREREQUISITES_CHANGED', 'Selected effects or canonical receipts changed during evaluation.');
        await loadSelectedPlanEvaluationInputs(client, deps.workspaceId, state, currentTime);
        const checkpointId = randomUUID();
        await client.query(`INSERT INTO selected_plan_continuation_checkpoints
          (workspace_id,id,action_plan_id,source_strategy_id,next_action_intent_id,next_request_fingerprint,
           authority_decision_id,source_fingerprint,materialization_fingerprint,residual_effect_fingerprints,
           prerequisite_receipts,accounted_changes,fresh_manifest,evaluation_evidence,evaluated_at,expires_at,created_by_actor_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17)`,
        [deps.workspaceId,checkpointId,state.planId,state.strategyId,state.next.id,state.next.request_fingerprint,
          captured.authorityDecisionId,state.sourceFingerprint,retained.fingerprint,
          JSON.stringify(state.residualEffects.map(selectedEffectFingerprint)),JSON.stringify(state.receipts),
          JSON.stringify(captured.accounting),JSON.stringify(manifest),JSON.stringify({
            contractVersion: CONTINUATION_CONTRACT_VERSION, viability: 'VIABLE',
            evaluatorVersions: productionContinuationEvaluatorVersions(),
            candidateAssessments: evaluated.value.strategy.candidateAssessments,
            candidateAssessmentResults: candidates, canonicalAssessmentIds: canonical.map((a) => a.id),
          }),now,expiresAt,deps.actorId]);
        // The normal deterministic execution gate remains authoritative. The
        // provisional row rolls back on revoked authority, inadequate funding,
        // stale assessments or any other rejection; it is not a bypass token.
        const gate = await evaluateStoredExecutionGate(client, {
          workspaceId: deps.workspaceId, intentId: state.next.id, principalId, now: currentTime,
        });
        continuationAssert(gate.allowed, 'CONTINUATION_GATE_REFUSED', gate.allowed ? '' : `${gate.reason}: ${gate.detail ?? ''}`);
        await client.query('COMMIT');
        return { ok: true, checkpointId, expiresAt };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    } catch (error) {
      if (error instanceof ContinuationRefusal) return { ok: false, code: error.code, detail: error.message };
      // Database/capture/shape errors never degrade into permission to execute.
      return { ok: false, code: 'CONTINUATION_CAPTURE_FAILED', detail: error instanceof Error ? error.message : String(error) };
    }
  };
}
