/**
 * B1 on the real AiT/Sarah world — RC-6 closure.
 *
 * Drives the generalized internal recovery loop through normal runtime and
 * HTTP routes against the canonical programme bundle after the disclosed
 * provider-shaped disruption. Identifies the incident-linked case by the
 * ingress change signal, never by traveller/event name in application code.
 *
 * Proves the viability contract on real data: a programme recovery can be
 * VIABLE even though overlay closure reaches unchanged FAIL/UNKNOWN subjects.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sharedTestPool } from './harness.ts';
import { loadDataset } from '../src/app/demo/datasetLoader.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { currentAssessmentView, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import { runCaseResolutionPass } from '../src/app/target/caseResolutionPass.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { provisionWorkspaceAuthority } from '../src/app/target/workspaceAuthority.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import type { RecoveryPlanningResult } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { ApprovalReport } from '../src/app/target/recoveryApproval.ts';
import type { TransportServiceCancelledWithReprotectionEvent } from '../src/app/target/providerDisruptionIngress.ts';
import { aitWorldModeFromEnv, obtainAitSummitWorld } from './aitFixtureClone.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:b1-canonical-world-recovery';
const NOW = '2026-09-21T01:40:00.000Z';

async function callHandler(
  app: TargetApplication,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  let status = 0;
  const chunks: string[] = [];
  const res = {
    writeHead(code: number) { status = code; return res; },
    end(payload?: string) { if (payload) chunks.push(payload); },
  };
  const req = {
    method,
    url: path,
    headers,
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  const handled = await handleTargetProductHttp(
    { app },
    req as unknown as Parameters<typeof handleTargetProductHttp>[1],
    res as unknown as Parameters<typeof handleTargetProductHttp>[2],
    new URL(path, 'http://localhost'),
  );
  assert.ok(handled, `${method} ${path} handled`);
  const text = chunks.join('');
  return { status, json: text ? JSON.parse(text) : undefined };
}

describe('B1 internal recovery loop on the canonical programme world', () => {
  let app: TargetApplication | undefined;
  let disposeWorld: (() => Promise<void>) | undefined;
  let sharedPool: Awaited<ReturnType<typeof sharedTestPool>> | undefined;

  after(async () => {
    if (app) await app.close().catch(() => undefined);
    await disposeWorld?.().catch(() => undefined);
    await sharedPool?.end().catch(() => undefined);
  });

  test('disruption -> escalate -> propose VIABLE -> approve -> execute -> reassess -> resolve', async () => {
    const t0 = performance.now();
    if (aitWorldModeFromEnv() === 'fresh') {
      sharedPool = await sharedTestPool();
    }
    const dataset = await loadDataset(BUNDLE_DIR);
    const world = await obtainAitSummitWorld({
      actorPrincipalId: ACTOR,
      includeBaseline: true,
      baselineNow: NOW,
      sharedPool,
      dataset,
    });
    disposeWorld = world.dispose;
    const pool = world.pool;
    const workspaceId = world.workspaceId;
    assert.ok(
      world.provisionStatus === 'MATERIALIZED' || world.provisionStatus === 'CLONED',
      `world ready via ${world.provisionStatus}`,
    );
    // Clone path already ran baseline at fixture NOW; fresh path ran it inside obtainAitSummitWorld
    // without pinned NOW. Align B1's evaluated-count expectation either way.
    assert.equal(
      world.baselineEvaluated,
      dataset.programme.importDraft.travellers.length,
      `baseline evaluated ${world.baselineEvaluated}`,
    );
    console.log(`[timing] B1 setup mode=${world.mode} setupMs=${world.setupMs.toFixed(0)}`);

    app = await composeTargetApplication({
      workspaceId,
      actorId: ACTOR,
      postgres: world.postgresOverrides,
    });
    const registry = createM6Registry();
    const pipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const captured = await captureWorld(pool, { workspaceId: claim.workspaceId, focus: [claim.subject], at: NOW, informationTopics: registry.informationTopics });
      return assessSubject({ registry, world: captured, effective: projectEffectiveWorld(captured), subject: claim.subject, now: NOW, assessmentId }).result;
    };
    const drain = async () => {
      const result = await app!.reassessmentWorker.drainAvailable(NOW, pipeline, { workspaceId, maxMs: 180_000, maxItems: 500 });
      assert.equal(result.stoppedReason, 'EMPTY', JSON.stringify(result));
      return result;
    };
    const lifecycleCtx = { pool, workspaceId, actorPrincipalId: ACTOR, uow: () => app!.unitOfWork(), now: NOW };

    const authority = await provisionWorkspaceAuthority({ pool, uow: () => app!.unitOfWork(), workspaceId, actorPrincipalId: ACTOR, now: NOW });
    assert.equal(authority.status, 'PROVISIONED', JSON.stringify(authority));
    // R3: the product planning endpoint now requires the shared coordinator
    // in runtimeHooks. The test composes its own (same deps composeTargetBoot
    // uses) and attaches it so the handler can reach planCaseDetailed.
    const planner = createRecoveryPlanningCoordinator({
      pool, workspaceId, actorPrincipalId: ACTOR, uow: () => app!.unitOfWork(), now: NOW,
    });
    app.runtimeHooks = { executorPrincipalId: authority.principals.executor, planner };
    await runCaseEscalation(lifecycleCtx);

    console.log(`[timing] B1 total-so-far-ms=${(performance.now() - t0).toFixed(0)}`);

    const originalServiceExternalId = 'ID7159@2026-09-30T10:45:00.000Z';
    const event: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `b1-world-${workspaceId}`,
      receivedAt: NOW,
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: originalServiceExternalId },
      replacementService: {
        recordType: 'SOURCE_TRANSPORT_SERVICE',
        externalId: 'ID7153@2026-10-01T00:45:00.000Z',
        operator: 'ID',
        scheduledDeparture: '2026-10-01T07:45:00+07:00',
        scheduledArrival: '2026-10-01T10:30:00+08:00',
      },
      affectedBookings: [
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN14' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN03' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN10' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN11' },
        { recordType: 'SOURCE_BOOKING_REFERENCE', externalId: 'IDSYN30' },
      ],
      reason: 'Aircraft rotation constraint following network-wide disruption earlier in September.',
      provenanceKind: 'SCHEDULE_CHANGE',
    };
    const ingress = await callHandler(app, 'POST', '/api/v2/demo/provider-event/airline-rebooking', event);
    assert.equal(ingress.status, 202, JSON.stringify(ingress.json));
    const ingressBody = ingress.json as { status: string; changeSignalId?: string };
    assert.equal(ingressBody.status, 'APPLIED');
    const changeSignalId = ingressBody.changeSignalId;
    assert.ok(changeSignalId, 'ingress records a change signal');

    await drain();
    const escalation = await runCaseEscalation(lifecycleCtx);
    const caseRow = await pool.query<{ recovery_case_id: string }>(
      `SELECT recovery_case_id FROM case_signals WHERE workspace_id = $1 AND change_signal_id = $2 ORDER BY recovery_case_id LIMIT 1`,
      [workspaceId, changeSignalId],
    );
    assert.equal(caseRow.rowCount, 1, `incident-linked case from signal; escalation=${JSON.stringify(escalation.outcomes)}`);
    const caseId = caseRow.rows[0]!.recovery_case_id;
    const failing = await pool.query<{ subject_kind: string; subject_id: string }>(
      `SELECT subject_kind, subject_id FROM case_subjects WHERE workspace_id = $1 AND recovery_case_id = $2 AND subject_kind IN ('JOURNEY', 'TRIP') ORDER BY subject_kind, subject_id`,
      [workspaceId, caseId],
    );
    assert.ok(failing.rowCount! >= 1, 'incident case has an assessable subject');
    const failingSubject = { kind: failing.rows[0]!.subject_kind as 'JOURNEY' | 'TRIP', id: failing.rows[0]!.subject_id };
    const beforeView = await currentAssessmentView(pool, workspaceId, failingSubject, 'VIABILITY', NOW);
    assert.equal(beforeView.status, 'CURRENT');
    assert.equal(beforeView.assessment?.overallVerdict, 'FAIL');

    const proposed = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const planningResult = (proposed.json as { result: RecoveryPlanningResult }).result;
    assert.equal(planningResult.outcome, 'AWAITING_AUTHORITY');
    assert.ok(planningResult.viableStrategyRefs.length >= 1, `expected a VIABLE recovery option under the comparison contract: ${JSON.stringify(planningResult)}`);
    // The read model also exposes the planning evidence and strategies.
    const planned = projectRecoveryCase((await loadRecoveryCaseFacts(pool, workspaceId, caseId, NOW))!);
    assert.ok(planned.planningEvidence, 'planning evidence visible on the Case read model');
    assert.ok(planned.planningEvidence!.candidates.length >= 1, JSON.stringify(planned.planningEvidence!.candidates));
    const recommendation = planningResult.recommendation;
    assert.ok(recommendation, 'comparator produced a recommendation');
    const strategyId = recommendation.recommendedStrategyRef;
    const recommended = planned.planningEvidence!.candidates.find((candidate) => candidate.strategyRef === strategyId);
    assert.ok(recommended, 'recommended candidate is on the case evidence');
    assert.equal(recommended.domain.code, 'PROGRAMME', JSON.stringify({
      basis: recommendation.recommendationBasis,
      candidates: planned.planningEvidence!.candidates.map((candidate) => ({
        domain: candidate.domain.code,
        disposition: candidate.disposition.code,
        strategyRef: candidate.strategyRef,
        cost: candidate.costComparison,
        blast: candidate.blastRadius,
      })),
    }));
    assert.ok(recommendation.recommendationBasis.some((entry) => entry.code === 'deterministic_comparison'), JSON.stringify(recommendation.recommendationBasis));

    const approved = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies/${strategyId}/approve`, { now: NOW });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    const approval = (approved.json as { report: ApprovalReport }).report;
    assert.ok(approval.intents.length >= 1);
    assert.equal(approval.caseStatus, 'EXECUTING');

    const blocked = await runCaseResolutionPass(lifecycleCtx);
    assert.equal(blocked.outcomes.find((o) => o.caseId === caseId)?.result, 'BLOCKED');

    let executed = 0;
    for (let pass = 0; pass < 8 && executed < approval.intents.length; pass += 1) {
      const execution = await runInternalExecutionPass({ ...lifecycleCtx, executorPrincipalId: authority.principals.executor });
      executed += execution.executed;
      assert.equal(execution.failed, 0, JSON.stringify(execution));
      await drain();
    }
    assert.equal(executed, approval.intents.length, `executed ${executed} of ${approval.intents.length} intents`);

    const afterView = await currentAssessmentView(pool, workspaceId, failingSubject, 'VIABILITY', NOW);
    assert.equal(afterView.status, 'CURRENT', JSON.stringify(afterView.staleness));
    assert.equal(afterView.assessment?.overallVerdict, 'PASS', 'blocking case subject recovered');

    const resolution = await runCaseResolutionPass(lifecycleCtx);
    assert.ok(resolution.outcomes.some((o) => o.caseId === caseId && o.result === 'RESOLVED'), JSON.stringify(resolution.outcomes));
    const finalView = projectRecoveryCase((await loadRecoveryCaseFacts(pool, workspaceId, caseId, NOW))!);
    assert.equal(finalView.status, 'RESOLVED');
    assert.equal(finalView.tripViability.verdict, 'PASS');
  });
});
