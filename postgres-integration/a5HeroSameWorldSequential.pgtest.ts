/**
 * Sarah's programme recovery and Jordan's connection case in one workspace.
 * Sarah runs first, at the earlier clock. Jordan's delay stages follow.
 * No database reset between them, and no second sandbox booking.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import { runCaseResolutionPass } from '../src/app/target/caseResolutionPass.ts';
import { runInternalExecutionPass } from '../src/app/target/executionPass.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { provisionWorkspaceAuthority } from '../src/app/target/workspaceAuthority.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { recoveryPlanningEligibleFromAssessment } from '../src/app/target/readmodels/mapConnectionProgression.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { currentAssessmentView, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import type { RecoveryPlanningResult } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { ApprovalReport } from '../src/app/target/recoveryApproval.ts';
import type { TransportServiceCancelledWithReprotectionEvent } from '../src/app/target/providerDisruptionIngress.ts';
import { loadDataset } from '../src/app/demo/datasetLoader.ts';
import { aitWorldModeFromEnv, obtainAitSummitWorld } from './aitFixtureClone.ts';
import { sharedTestPool } from './harness.ts';
import { attachSeedSession, commitSeed, takeSeedEvidence } from './m2Seed.ts';

const ACTOR = 'principal:a5-hero-same-world';
const SARAH_NOW = '2026-09-21T01:40:00.000Z';
const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const TIMELINE_PATH = fileURLToPath(
  new URL('../data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json', import.meta.url),
);

interface DelayStage {
  id: string;
  at: string;
  eventId: string;
  arrTime: string;
}

const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8')) as { stages: DelayStage[] };

function stage(id: string): DelayStage {
  const found = timeline.stages.find((entry) => entry.id === id);
  assert.ok(found, `configured timeline includes ${id}`);
  return found;
}

async function callHandler(
  app: TargetApplication,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
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
    headers: {},
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

describe('A5 Sarah and Jordan share one workspace', () => {
  let app: TargetApplication | undefined;
  let disposeWorld: (() => Promise<void>) | undefined;
  let sharedPool: Awaited<ReturnType<typeof sharedTestPool>> | undefined;

  after(async () => {
    if (app) await app.close().catch(() => undefined);
    await disposeWorld?.().catch(() => undefined);
    await sharedPool?.end().catch(() => undefined);
  });

  test('Sarah resolves, then Jordan opens a second case, without a reset', async () => {
    if (aitWorldModeFromEnv() === 'fresh') sharedPool = await sharedTestPool();
    const dataset = await loadDataset(BUNDLE_DIR);
    const world = await obtainAitSummitWorld({
      actorPrincipalId: ACTOR,
      includeBaseline: true,
      baselineNow: SARAH_NOW,
      sharedPool,
      dataset,
    });
    disposeWorld = world.dispose;
    const { pool, workspaceId } = world;
    app = await composeTargetApplication({
      workspaceId,
      actorId: ACTOR,
      postgres: world.postgresOverrides,
    });
    const registry = createM6Registry();
    const sarahPipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const captured = await captureWorld(pool, {
        workspaceId: claim.workspaceId,
        focus: [claim.subject],
        at: SARAH_NOW,
        informationTopics: registry.informationTopics,
      });
      return assessSubject({
        registry,
        world: captured,
        effective: projectEffectiveWorld(captured),
        subject: claim.subject,
        now: SARAH_NOW,
        assessmentId,
      }).result;
    };
    const drainAt = async (at: string, pipeline: ReassessmentPipeline) => {
      const result = await app!.reassessmentWorker.drainAvailable(at, pipeline, { workspaceId, maxMs: 180_000, maxItems: 500 });
      assert.equal(result.stoppedReason, 'EMPTY', JSON.stringify(result));
    };
    const lifecycleCtx = { pool, workspaceId, actorPrincipalId: ACTOR, uow: () => app!.unitOfWork(), now: SARAH_NOW };
    const authority = await provisionWorkspaceAuthority({
      pool, uow: () => app!.unitOfWork(), workspaceId, actorPrincipalId: ACTOR, now: SARAH_NOW,
    });
    const planner = createRecoveryPlanningCoordinator({
      pool, workspaceId, actorPrincipalId: ACTOR, uow: () => app!.unitOfWork(), now: SARAH_NOW,
    });
    app.runtimeHooks = { executorPrincipalId: authority.principals.executor, planner };

    const event: TransportServiceCancelledWithReprotectionEvent = {
      kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION',
      providerId: 'sim-airline-id',
      providerEventId: `a5-same-world-${workspaceId}`,
      receivedAt: SARAH_NOW,
      disclosedAsSimulatedDemoInput: true,
      originalService: { recordType: 'SOURCE_TRANSPORT_SERVICE', externalId: 'ID7159@2026-09-30T10:45:00.000Z' },
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
    const changeSignalId = (ingress.json as { changeSignalId?: string }).changeSignalId;
    assert.ok(changeSignalId);
    await drainAt(SARAH_NOW, sarahPipeline);
    await runCaseEscalation(lifecycleCtx);
    const sarahCase = await pool.query<{ recovery_case_id: string }>(
      `SELECT recovery_case_id FROM case_signals WHERE workspace_id = $1 AND change_signal_id = $2`,
      [workspaceId, changeSignalId],
    );
    assert.equal(sarahCase.rowCount, 1);
    const sarahCaseId = sarahCase.rows[0]!.recovery_case_id;
    const proposed = await callHandler(app, 'POST', `/api/v2/cases/${sarahCaseId}/strategies`, { now: SARAH_NOW });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const planningResult = (proposed.json as { result: RecoveryPlanningResult }).result;
    assert.equal(planningResult.outcome, 'AWAITING_AUTHORITY');
    const strategyId = planningResult.recommendation?.recommendedStrategyRef;
    assert.ok(strategyId);
    const approved = await callHandler(app, 'POST', `/api/v2/cases/${sarahCaseId}/strategies/${strategyId}/approve`, { now: SARAH_NOW });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    const approval = (approved.json as { report: ApprovalReport }).report;
    let executed = 0;
    for (let pass = 0; pass < 8 && executed < approval.intents.length; pass += 1) {
      const execution = await runInternalExecutionPass({ ...lifecycleCtx, executorPrincipalId: authority.principals.executor });
      executed += execution.executed;
      assert.equal(execution.failed, 0, JSON.stringify(execution));
      await drainAt(SARAH_NOW, sarahPipeline);
    }
    assert.equal(executed, approval.intents.length);
    const sarahResolution = await runCaseResolutionPass(lifecycleCtx);
    assert.ok(sarahResolution.outcomes.some((outcome) => outcome.caseId === sarahCaseId && outcome.result === 'RESOLVED'), JSON.stringify(sarahResolution.outcomes));

    const jordan = await pool.query<{ journey_id: string }>(
      `SELECT j.id AS journey_id
         FROM journeys j
         JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         JOIN external_record_links l
           ON l.workspace_id = t.workspace_id AND l.canonical_subject_kind = 'TRAVELLER'
          AND l.canonical_subject_id = t.id AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE j.workspace_id = $1 AND r.record_type = 'SOURCE_TRAVELLER_DRAFT' AND r.external_id = 'ait-draft-09'`,
      [workspaceId],
    );
    assert.equal(jordan.rowCount, 1);
    const journeyId = jordan.rows[0]!.journey_id;
    const inbound = await pool.query<{ service_id: string }>(
      `SELECT l.canonical_subject_id AS service_id
         FROM external_record_links l
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE l.workspace_id = $1 AND l.canonical_subject_kind = 'TRANSPORT_SERVICE' AND l.superseded_at IS NULL
          AND r.record_type = 'SOURCE_TRANSPORT_SERVICE' AND r.external_id LIKE 'ZG023@%'`,
      [workspaceId],
    );
    assert.equal(inbound.rowCount, 1);
    const serviceId = inbound.rows[0]!.service_id;
    const evidenceSeed = await attachSeedSession(pool, workspaceId, ACTOR, 3);
    const evidenceIds = [takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed)];
    await commitSeed(evidenceSeed);
    let currentStageAt = SARAH_NOW;
    const jordanPipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const captured = await captureWorld(pool, {
        workspaceId: claim.workspaceId,
        focus: [claim.subject],
        at: currentStageAt,
        informationTopics: registry.informationTopics,
      });
      return assessSubject({
        registry, world: captured, effective: projectEffectiveWorld(captured),
        subject: claim.subject, now: currentStageAt, assessmentId,
      }).result;
    };
    const commandCtx = { workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(pool, workspaceId), pool };
    const applyStage = async (delay: DelayStage, evidenceId: string) => {
      currentStageAt = delay.at;
      const revision = await pool.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
        [workspaceId, serviceId],
      );
      const applied = await acceptProviderShapedDemoEvent(commandCtx, {
        providerId: 's2-configured-provider-event',
        providerEventId: delay.eventId,
        receivedAt: delay.at,
        disclosedAsSimulatedDemoInput: true,
        payload: {
          subjectKind: 'TRANSPORT_SERVICE',
          subjectId: serviceId,
          expectedRevision: Number(revision.rows[0]!.revision),
          field: 'ESTIMATED',
          arrival: delay.arrTime,
          evidenceId,
        },
      });
      assert.equal(applied.ok, true, JSON.stringify(applied));
      await drainAt(delay.at, jordanPipeline);
    };
    await applyStage(stage('delay_begins_connection_viable'), evidenceIds[0]!);
    const d2 = stage('delay_increases_connection_at_risk');
    await applyStage(d2, evidenceIds[1]!);
    const opened = await runCaseEscalation({ ...commandCtx, now: d2.at });
    assert.equal(opened.opened, 1, JSON.stringify(opened));
    const jordanCaseId = opened.outcomes.find((outcome) => outcome.caseId)?.caseId;
    assert.ok(jordanCaseId);
    assert.notEqual(jordanCaseId, sarahCaseId);
    const d3 = stage('zg053_impossible');
    await applyStage(d3, evidenceIds[2]!);
    const attached = await runCaseEscalation({ ...commandCtx, now: d3.at });
    assert.equal(attached.attached, 1, JSON.stringify(attached));
    const jordanView = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', d3.at);
    assert.equal(jordanView.assessment?.overallVerdict, 'FAIL');
    assert.equal(recoveryPlanningEligibleFromAssessment(jordanView.assessment!), true);
    const sarahStill = await pool.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, sarahCaseId],
    );
    assert.equal(sarahStill.rows[0]!.lifecycle_status, 'RESOLVED');
    const both = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM recovery_cases WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, [sarahCaseId, jordanCaseId]],
    );
    assert.equal(both.rows[0]!.n, '2');
    const sarahFacts = await loadRecoveryCaseFacts(pool, workspaceId, sarahCaseId, d3.at);
    assert.equal(projectRecoveryCase(sarahFacts!).status, 'RESOLVED');
  });
});
