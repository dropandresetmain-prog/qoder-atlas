/**
 * B1 product planning coordinator — proves the HTTP planning endpoint
 * uses the shared coordinator and returns the new RecoveryPlanningResult shape.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { seedEvent, seedParticipation, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import {
  KnowledgeFixture, seedBooking, seedEngagementIntent, seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent,
  seedTraveller, seedTrip, takeSeedEvidence,
} from './m6WorldSeed.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import { provisionWorkspaceAuthority } from '../src/app/target/workspaceAuthority.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { createRecoveryPlanningCoordinator } from '../src/app/target/recoveryPlanningCoordinator.ts';
import type { RecoveryPlanningResult } from '../src/contracts/v2/planning/recoveryPlanningAttempt.ts';

const NOW = '2031-06-02T00:00:00.000Z';
const EARLY_WINDOW = { start: '2031-06-02T11:30:00.000Z', end: '2031-06-02T12:00:00.000Z' };
const LATE_WINDOW = { start: '2031-06-02T14:30:00.000Z', end: '2031-06-02T15:00:00.000Z' };
const PEER_WINDOW = { start: '2031-06-02T16:00:00.000Z', end: '2031-06-02T17:00:00.000Z' };
const BASELINE_ARRIVAL = '2031-06-02T08:00:00.000Z';
const DELAYED_ARRIVAL = '2031-06-02T10:30:00.000Z';

async function callHandler(app: TargetApplication, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  let status = 0;
  const chunks: string[] = [];
  const res = { writeHead(code: number) { status = code; return res; }, end(payload?: string) { if (payload) chunks.push(payload); } };
  const req = {
    method, url: path, headers: {},
    [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
  };
  const handled = await handleTargetProductHttp({ app }, req as unknown as Parameters<typeof handleTargetProductHttp>[1], res as unknown as Parameters<typeof handleTargetProductHttp>[2], new URL(path, 'http://localhost'));
  assert.ok(handled, `${method} ${path} handled`);
  const text = chunks.join('');
  return { status, json: text ? JSON.parse(text) : undefined };
}

describe('B1 product planning coordinator (real PostgreSQL)', () => {
  let app: TargetApplication | undefined;
  after(async () => {
    if (app) await app.close();
    const pool = await sharedTestPool();
    await pool.end();
  });

  test('POST /cases/:id/strategies uses the shared coordinator and returns RecoveryPlanningResult', async () => {
    const seedPool = await sharedTestPool();
    const seed = await beginSeed(seedPool, 'B1 product planning coordinator');
    const host = await seedJurisdictionWithPlaces(seed, { name: 'Host', places: [{ name: 'Venue', placeType: 'VENUE' }] });
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin', places: [{ name: 'Origin', placeType: 'STATION' }] });
    const venueId = host.placeIds[0]!;
    const originId = origin.placeIds[0]!;
    const people: { travellerId: string; journeyId: string; tripId: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t = await seedTraveller(seed, { displayName: `Participant ${i + 1}` });
      const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
      const journeyId = await seedJourney(seed, { tripId, travellerId: t.travellerId, lifecycleStatus: 'ACTIVE' });
      people.push({ travellerId: t.travellerId, journeyId, tripId });
    }
    const sharedServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: venueId, published: { departure: '2031-06-02T05:00:00.000Z', arrival: BASELINE_ARRIVAL } });
    const localServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: venueId, published: { departure: '2031-06-02T04:00:00.000Z', arrival: '2031-06-02T07:00:00.000Z' } });
    for (const idx of [0, 2, 3, 4]) {
      const { journeyId, travellerId } = people[idx]!;
      const itemId = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: venueId, selectedServiceId: sharedServiceId });
      await seedBooking(seed, { travellerId, serviceId: sharedServiceId, journeyItemId: itemId });
    }
    {
      const { journeyId, travellerId } = people[1]!;
      const itemId = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: venueId, selectedServiceId: localServiceId });
      await seedBooking(seed, { travellerId, serviceId: localServiceId, journeyItemId: itemId });
    }
    const eventId = await seedEvent(seed, { lifecycleStatus: 'ACTIVE' });
    const programmeId = await seedProgramme(seed, { eventId, lifecycleStatus: 'ACTIVE' });
    const requirements = { requiresPhysicalPresence: true, readinessBufferMinutes: 150 };
    const earlyItem = await seedProgrammeItem(seed, { programmeId, title: 'Early required item', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: EARLY_WINDOW, operatingRequirements: requirements });
    const lateItem = await seedProgrammeItem(seed, { programmeId, title: 'Later item', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: LATE_WINDOW, operatingRequirements: requirements });
    const peerItem = await seedProgrammeItem(seed, { programmeId, title: 'Peer item', placeId: venueId, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', window: PEER_WINDOW, operatingRequirements: requirements });
    const link = async (idx: number, itemId: string) => {
      const participationId = await seedParticipation(seed, { programmeItemId: itemId, travellerId: people[idx]!.travellerId, obligation: 'REQUIRED', accepted: true });
      await seedEngagementIntent(seed, { journeyId: people[idx]!.journeyId, orderKey: '020', participationId });
    };
    await link(0, earlyItem.programmeItemId);
    await link(1, lateItem.programmeItemId);
    for (const idx of [2, 3, 4]) await link(idx, peerItem.programmeItemId);
    await commitSeed(seed);
    const knowledge = new KnowledgeFixture(seedPool, seed);
    for (const jurisdictionId of [host.jurisdictionId, origin.jurisdictionId]) {
      for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
    }

    app = await composeTargetApplication({ workspaceId: seed.workspaceId, actorId: seed.actorId });
    const pool = app.pool;
    const registry = createM6Registry();
    const pipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const world = await captureWorld(pool, { workspaceId: claim.workspaceId, focus: [claim.subject], at: NOW, informationTopics: registry.informationTopics });
      return assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: claim.subject, now: NOW, assessmentId }).result;
    };
    const drain = async () => {
      const result = await app!.reassessmentWorker.drainAvailable(NOW, pipeline, { workspaceId: seed.workspaceId });
      assert.equal(result.stoppedReason, 'EMPTY', JSON.stringify(result));
      return result;
    };
    const lifecycleCtx = { pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => app!.unitOfWork(), now: NOW };

    const baseline = await runBaselineEvaluation({ pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW });
    assert.equal(baseline.evaluated, 5, JSON.stringify(baseline));

    const authority = await provisionWorkspaceAuthority({ pool, uow: () => app!.unitOfWork(), workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW });
    assert.equal(authority.status, 'PROVISIONED', JSON.stringify(authority));
    let preparationPublished = false;
    const planner = createRecoveryPlanningCoordinator({
      pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => app!.unitOfWork(), now: NOW,
      preparePlanningContext: async () => {
        if (!preparationPublished) {
          await knowledge.coverage({ topic: 'ENTRY_REQUIREMENT', completeness: 'COMPLETE', jurisdictionId: host.jurisdictionId });
          preparationPublished = true;
        }
        return {};
      },
    });
    app.runtimeHooks = { executorPrincipalId: authority.principals.executor, planner };

    const revision = await pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [seed.workspaceId, sharedServiceId]);
    const ingress = await acceptProviderShapedDemoEvent(
      { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => app!.unitOfWork(), pool },
      { providerId: 'test-supplier', providerEventId: `evt-${randomUUID()}`, receivedAt: '2031-06-01T23:00:00.000Z', disclosedAsSimulatedDemoInput: true,
        payload: { subjectKind: 'TRANSPORT_SERVICE', subjectId: sharedServiceId, expectedRevision: Number(revision.rows[0]!.revision), field: 'ACTUAL', arrival: DELAYED_ARRIVAL, evidenceId: takeSeedEvidence(seed) } },
    );
    assert.equal(ingress.ok, true, JSON.stringify(ingress));
    const changeSignalId = (ingress as { changeSignalId?: string }).changeSignalId;
    assert.ok(changeSignalId, 'ingress records a change signal');
    await drain();

    const escalation = await runCaseEscalation(lifecycleCtx);
    assert.equal(escalation.opened, 1, JSON.stringify(escalation));
    const caseId = escalation.outcomes.find((o) => o.caseId)!.caseId!;

    // Entry preparation uses real knowledge commands. A changed manifest must
    // produce an audit-only retry result, then wait for the normal worker.
    const preparing = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
    assert.equal(preparing.status, 200, JSON.stringify(preparing.json));
    const preparingResult = (preparing.json as { result: RecoveryPlanningResult }).result;
    assert.equal(preparingResult.outcome, 'STALE_RETRY_REQUIRED');
    assert.deepEqual(preparingResult.viableStrategyRefs, []);
    const retainedPreparation = await pool.query<{ outcome: string; viable_strategy_refs: unknown[] }>(
      'SELECT outcome, viable_strategy_refs FROM recovery_planning_attempts WHERE workspace_id = $1 AND id = $2',
      [seed.workspaceId, preparingResult.planningAttemptRef]);
    assert.equal(retainedPreparation.rows[0]?.outcome, 'STALE_RETRY_REQUIRED');
    assert.deepEqual(retainedPreparation.rows[0]?.viable_strategy_refs, []);
    assert.equal(Number((await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM recovery_strategies WHERE workspace_id = $1 AND recovery_case_id = $2',
      [seed.workspaceId, caseId])).rows[0]!.n), 0, 'preparation cannot promote a recommendation against the old knowledge snapshot');
    await drain();

    // --- POST /cases/:id/strategies returns 200 with { ok, result } shape
    const proposed = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const proposedBody = proposed.json as { ok: boolean; result?: RecoveryPlanningResult };
    assert.equal(proposedBody.ok, true);
    assert.ok(proposedBody.result, 'result is present');
    const planningResult = proposedBody.result!;
    assert.equal(planningResult.outcome, 'AWAITING_AUTHORITY');
    assert.ok(planningResult.planningAttemptRef, 'planningAttemptRef is present');
    assert.ok(planningResult.basisAssessmentId, 'basisAssessmentId is present');
    assert.notEqual(planningResult.basisAssessmentId, preparingResult.basisAssessmentId,
      'planning resumes against the reassessed basis after knowledge publication');
    assert.ok(planningResult.viableStrategyRefs.length >= 1, 'at least one viable strategy');

    // --- planning evidence visible on the Case read model
    const planned = projectRecoveryCase((await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW))!);
    assert.ok(planned.planningEvidence, 'planning evidence visible on the Case read model');
    assert.equal(planned.planningEvidence!.outcome.code, 'AWAITING_AUTHORITY');
    assert.ok(planned.planningEvidence!.candidates.length >= 1, 'candidates visible');
    assert.ok(planned.planningEvidence!.viableStrategies.length >= 1, 'viable strategies visible');
    assert.ok(planned.strategies.length >= 1, 'persisted strategies visible');

    // --- idempotency: second POST does NOT create a second recovery_planning_attempts row
    const attemptCountBefore = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM recovery_planning_attempts WHERE workspace_id = $1 AND recovery_case_id = $2', [seed.workspaceId, caseId])).rows[0]!.n);
    const proposedAgain = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
    assert.equal(proposedAgain.status, 200, JSON.stringify(proposedAgain.json));
    const attemptCountAfter = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM recovery_planning_attempts WHERE workspace_id = $1 AND recovery_case_id = $2', [seed.workspaceId, caseId])).rows[0]!.n);
    assert.equal(attemptCountAfter, attemptCountBefore, 'a rerun does not create a second planning attempt');

    // --- CASE_NOT_FOUND on unknown case id returns 404
    const unknownCaseId = randomUUID();
    const unknownCase = await callHandler(app, 'POST', `/api/v2/cases/${unknownCaseId}/strategies`, { now: NOW });
    assert.equal(unknownCase.status, 404, JSON.stringify(unknownCase.json));
    const unknownBody = unknownCase.json as { ok: boolean; error?: { code: string } };
    assert.equal(unknownBody.ok, false);
    assert.equal(unknownBody.error?.code, 'CASE_NOT_FOUND');

    // --- terminal/RESOLVED case returns 409
    // First, resolve the case by approving and executing
    const strategyId = planned.strategies.find((s) => s.viability === 'VIABLE')?.strategyRef ?? planningResult.viableStrategyRefs[0]!;
    const approved = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies/${strategyId}/approve`, { now: NOW });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));

    // Execute the intents
    for (let pass = 0; pass < 8; pass += 1) {
      await app!.runtimeHooks?.afterApproval?.();
      await drain();
    }

    // Resolve the case
    const resolution = await pool.query<{ lifecycle_status: string }>('SELECT lifecycle_status FROM recovery_cases WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, caseId]);
    if (resolution.rows[0]?.lifecycle_status === 'RESOLVED') {
      const resolvedCase = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
      assert.equal(resolvedCase.status, 409, JSON.stringify(resolvedCase.json));
      const resolvedBody = resolvedCase.json as { ok: boolean; error?: { code: string } };
      assert.equal(resolvedBody.ok, false);
      assert.equal(resolvedBody.error?.code, 'CASE_NOT_OPEN');
    }
  });
});
