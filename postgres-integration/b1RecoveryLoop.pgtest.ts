/**
 * B1 — the first complete generalized internal recovery loop, through the
 * normal runtime/application paths only.
 *
 *   provider-shaped change (HTTP-facing ingress command)
 *   -> canonical mutation + change signal
 *   -> M6 invalidation -> reassessment worker (real registry)
 *   -> case escalation pass (policy) -> RecoveryCase with cause
 *   -> POST /cases/:id/strategies  (proposer port -> validation -> overlay viability -> persisted strategy)
 *   -> POST /cases/:id/strategies/:sid/approve (plan -> decision -> approval by the workspace operator)
 *   -> internal execution pass (stored gate -> durable attempt -> observation -> canonical programme update)
 *   -> M6 invalidation -> reassessment worker
 *   -> case resolution pass (gate) -> RESOLVED
 *
 * No raw SQL writes, no test helper on the path, no scenario names: the world
 * is a generic seeded programme with one shared inbound service, one early
 * REQUIRED item its participant can no longer reach after a delay, one
 * later item held by a locally-arriving participant, and a peer item.
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
import type { PlanningReport } from '../src/app/target/recoveryPlanning.ts';
import type { ApprovalReport } from '../src/app/target/recoveryApproval.ts';

const NOW = '2031-06-02T00:00:00.000Z';
const EARLY_WINDOW = { start: '2031-06-02T11:30:00.000Z', end: '2031-06-02T12:00:00.000Z' };
const LATE_WINDOW = { start: '2031-06-02T14:30:00.000Z', end: '2031-06-02T15:00:00.000Z' };
const PEER_WINDOW = { start: '2031-06-02T16:00:00.000Z', end: '2031-06-02T17:00:00.000Z' };
const BASELINE_ARRIVAL = '2031-06-02T08:00:00.000Z';
const DELAYED_ARRIVAL = '2031-06-02T10:30:00.000Z';

async function callHandler(app: TargetApplication, method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  let status = 0;
  const chunks: string[] = [];
  const res = { writeHead(code: number) { status = code; return res; }, end(payload?: string) { if (payload) chunks.push(payload); } };
  const req = {
    method, url: path, headers,
    [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
  };
  const handled = await handleTargetProductHttp({ app }, req as unknown as Parameters<typeof handleTargetProductHttp>[1], res as unknown as Parameters<typeof handleTargetProductHttp>[2], new URL(path, 'http://localhost'));
  assert.ok(handled, `${method} ${path} handled`);
  const text = chunks.join('');
  return { status, json: text ? JSON.parse(text) : undefined };
}

describe('B1 generalized internal recovery loop (real PostgreSQL, normal runtime paths)', () => {
  let app: TargetApplication | undefined;
  after(async () => {
    if (app) await app.close();
    const pool = await sharedTestPool();
    await pool.end();
  });

  test('change -> reassess -> escalate -> propose -> approve -> execute -> observe -> reassess -> resolve', async () => {
    const seedPool = await sharedTestPool();
    const seed = await beginSeed(seedPool, 'B1 recovery loop');
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
    const verdict = async (journeyId: string) => {
      const view = await currentAssessmentView(pool, seed.workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', NOW);
      assert.equal(view.status, 'CURRENT', `journey ${journeyId}: ${JSON.stringify(view.staleness)}`);
      return view.assessment!.overallVerdict;
    };
    const lifecycleCtx = { pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => app!.unitOfWork(), now: NOW };

    // --- baseline: the runtime's own per-subject baseline evaluation; everyone PASS; no cases.
    const baseline = await runBaselineEvaluation({ pool, workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW });
    assert.equal(baseline.evaluated, 5, JSON.stringify(baseline));
    for (const p of people) assert.equal(await verdict(p.journeyId), 'PASS');
    assert.equal((await runCaseEscalation(lifecycleCtx)).opened, 0, 'healthy baseline opens nothing');

    // --- workspace authority (boot step): operator approves, executor dispatches.
    const authority = await provisionWorkspaceAuthority({ pool, uow: () => app!.unitOfWork(), workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, now: NOW });
    assert.equal(authority.status, 'PROVISIONED', JSON.stringify(authority));
    app.runtimeHooks = { executorPrincipalId: authority.principals.executor };

    // --- change: the shared inbound arrives late (provider-shaped ingress with a change signal).
    const revision = await pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [seed.workspaceId, sharedServiceId]);
    const ingress = await acceptProviderShapedDemoEvent(
      { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, uow: () => app!.unitOfWork(), pool },
      { providerId: 'test-supplier', providerEventId: `evt-${randomUUID()}`, receivedAt: '2031-06-01T23:00:00.000Z', disclosedAsSimulatedDemoInput: true,
        payload: { subjectKind: 'TRANSPORT_SERVICE', subjectId: sharedServiceId, expectedRevision: Number(revision.rows[0]!.revision), field: 'ACTUAL', arrival: DELAYED_ARRIVAL, evidenceId: takeSeedEvidence(seed) } },
    );
    assert.equal(ingress.ok, true, JSON.stringify(ingress));
    const changeSignalId = (ingress as { changeSignalId?: string }).changeSignalId;
    assert.ok(changeSignalId, 'ingress records a change signal');
    const afterChange = await drain();
    assert.ok(afterChange.processed >= 4, `reassessed the affected journeys: ${JSON.stringify(afterChange)}`);
    assert.equal(await verdict(people[0]!.journeyId), 'FAIL', 'early-item participant can no longer be ready in time');
    for (const p of people.slice(1)) assert.equal(await verdict(p.journeyId), 'PASS');

    // --- escalation: exactly one case, caused by the signal.
    const escalation = await runCaseEscalation(lifecycleCtx);
    assert.equal(escalation.opened, 1, JSON.stringify(escalation));
    const caseId = escalation.outcomes.find((o) => o.caseId)!.caseId!;
    assert.equal(escalation.outcomes.find((o) => o.caseId)!.changeSignalId, changeSignalId);
    const caseView = projectRecoveryCase((await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW))!);
    assert.equal(caseView.cause?.changeSignalRef, `CHANGE_SIGNAL:${changeSignalId}`);
    assert.equal(caseView.status, 'OPEN');
    assert.ok(caseView.causalPath.some((s) => s.dimension === 'programme_participation'), JSON.stringify(caseView.causalPath));

    // --- planning through HTTP: deterministic proposer -> validation -> overlay viability -> persisted VIABLE strategies.
    const proposed = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const planning = (proposed.json as { report: PlanningReport }).report;
    assert.ok(planning.candidates.length >= 2, `swap candidates for both later items: ${JSON.stringify(planning.candidates)}`);
    const viable = planning.candidates.filter((c) => c.persisted && c.viability === 'VIABLE');
    assert.equal(viable.length, 1, `exactly the early<->later swap is viable (peer swap fails its own participants): ${JSON.stringify(planning.candidates)}`);
    assert.ok(planning.candidates.some((c) => c.viability === 'NOT_VIABLE'), 'the non-viable swap is reported, not persisted');
    assert.equal(planning.caseStatus, 'AWAITING_AUTHORITY');
    const strategyId = viable[0]!.strategyId;
    const strategyRow = await pool.query<{ scenario_change: { effects: { programmeItemId: string }[] } }>('SELECT scenario_change FROM recovery_strategies WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, strategyId]);
    assert.deepEqual(strategyRow.rows[0]!.scenario_change.effects.map((e) => e.programmeItemId).sort(), [earlyItem.programmeItemId, lateItem.programmeItemId].sort());
    const proposedAgain = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies`, { now: NOW });
    assert.equal((proposedAgain.json as { report: PlanningReport }).report.persistedCount, 0, 'a rerun recognises the persisted candidate instead of duplicating it');

    // --- FB1-5/FB1-6: the option as the operator actually reads it.
    //
    // `RecoveryStrategy` persists candidate summaries as subjectRef /
    // assessmentId / overallVerdict and keeps its effects in
    // strategy_changes. The focused read model used to look for personLabel /
    // verdict on those summaries, so every subject fell back to
    // "Traveller UNKNOWN" — the founder saw dozens of them and could not tell
    // what they were approving. These assertions pin the projection to what
    // is actually stored, and to identity resolved from canonical state.
    const planned = projectRecoveryCase((await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW))!);
    const option = planned.strategies.find((s) => s.strategyRef === strategyId);
    assert.ok(option, `the persisted strategy is projected: ${JSON.stringify(planned.strategies.map((s) => s.strategyRef))}`);
    assert.deepEqual(
      planned.strategies.map((s) => s.optionNumber),
      planned.strategies.map((_, i) => i + 1),
      'options are numbered 1..N in ascending version order',
    );

    // Identity comes from the authoritative journey -> traveller join, never
    // from the strategy record and never from a placeholder.
    assert.ok(option.projectedPeople.length > 0, 'the option was assessed against reached subjects');
    assert.equal(
      option.projectedPeople.filter((p) => p.personLabel === 'Traveller').length,
      0,
      `no fabricated "Traveller" labels: ${JSON.stringify(option.projectedPeople.slice(0, 5))}`,
    );
    const blockingRef = `JOURNEY:${people[0]!.journeyId}`;
    const blockingProjection = option.projectedPeople.find((p) => p.subjectRef === blockingRef);
    assert.ok(blockingProjection, 'the blocked subject is among the assessed subjects');
    assert.equal(blockingProjection.personLabel, 'Participant 1', 'known Journey resolves to its authoritative traveller display name');
    // The persisted overallVerdict is projected as-is. A viable option heals
    // the blocking subject, so this is PASS here — read from the record, not
    // assumed by the projector.
    assert.equal(blockingProjection.verdict, 'PASS');
    assert.equal(
      option.projectedSummary.total,
      option.projectedPeople.length,
      'the summary counts the subjects it actually projected',
    );
    assert.equal(
      option.projectedSummary.pass + option.projectedSummary.fail + option.projectedSummary.unknown,
      option.projectedSummary.total,
    );
    assert.ok(option.projectedSummary.pass > 0, 'a viable option projects at least one passing subject');

    // "Who does this fix": the currently-blocking case subject, with today's
    // verdict and the verdict this option projects for it.
    const resolves = option.resolves.find((r) => r.subjectRef === blockingRef);
    assert.ok(resolves, `the blocking case subject is named: ${JSON.stringify(option.resolves)}`);
    assert.equal(resolves.personLabel, 'Participant 1');
    assert.equal(resolves.currentVerdict, 'FAIL');
    assert.equal(resolves.projectedVerdict, 'PASS');

    // "What does this change": the option's own stored ScenarioChange effects,
    // joined to canonical programme state — titles and real windows, not ids.
    assert.equal(option.changes.length, 2, `a bilateral swap states both moves: ${JSON.stringify(option.changes)}`);
    assert.ok(option.changes.every((c) => c.effectKind === 'CHANGE_PROGRAMME_ITEM_TIME'));
    assert.deepEqual(
      option.changes.map((c) => c.subjectLabel).sort(),
      ['Early required item', 'Later item'],
      'each changed programme item is named from canonical state',
    );
    const movedEarly = option.changes.find((c) => c.subjectRef === `PROGRAMME_ITEM:${earlyItem.programmeItemId}`);
    const movedLate = option.changes.find((c) => c.subjectRef === `PROGRAMME_ITEM:${lateItem.programmeItemId}`);
    assert.ok(movedEarly && movedLate, 'both sides of the swap are projected');
    assert.deepEqual(movedEarly.currentWindow, EARLY_WINDOW, 'current timing is canonical, not proposed');
    assert.deepEqual(movedEarly.proposedWindow, LATE_WINDOW, 'the blocked item takes the later window');
    assert.deepEqual(movedLate.currentWindow, LATE_WINDOW);
    assert.deepEqual(movedLate.proposedWindow, EARLY_WINDOW, 'the counterpart takes the earlier window');

    // --- approval through HTTP by the workspace operator (no header -> operator principal).
    const denied = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies/${strategyId}/approve`, { now: NOW }, { 'x-northstar-principal': randomUUID() });
    assert.equal(denied.status, 403, 'an unregistered principal cannot approve');
    const approved = await callHandler(app, 'POST', `/api/v2/cases/${caseId}/strategies/${strategyId}/approve`, { now: NOW });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    const approval = (approved.json as { report: ApprovalReport }).report;
    assert.equal(approval.intents.length, 2, 'bilateral swap = two ordered internal intents');
    assert.equal(approval.approverPrincipalId, authority.principals.operator);
    assert.equal(approval.caseStatus, 'EXECUTING');
    const intentCapabilities = await pool.query<{ capability_ref: string }>('SELECT capability_ref FROM action_intents WHERE workspace_id = $1 AND action_plan_id = $2', [seed.workspaceId, approval.planId]);
    assert.ok(intentCapabilities.rows.every((r) => r.capability_ref === 'internal:programme.schedule'), 'no external/provider intent was minted');

    // --- nothing has executed yet: programme unchanged, resolution blocked.
    const before = await pool.query<{ window_start: Date }>('SELECT window_start FROM programme_items WHERE workspace_id = $1 AND id = $2', [seed.workspaceId, earlyItem.programmeItemId]);
    assert.equal(before.rows[0]!.window_start.toISOString(), EARLY_WINDOW.start);
    const blocked = await runCaseResolutionPass(lifecycleCtx);
    assert.equal(blocked.resolved, 0, JSON.stringify(blocked.outcomes));

    // --- execution pass: gate -> durable attempts -> observations -> canonical programme change.
    // The first mutation invalidates the assessments the dependent intent's
    // gate must see CURRENT, so the runtime executes one side, lets the
    // reassessment worker settle, then executes the other (deferred, never failed).
    const execution = await runInternalExecutionPass({ ...lifecycleCtx, executorPrincipalId: authority.principals.executor });
    assert.equal(execution.executed, 1, JSON.stringify(execution));
    assert.equal(execution.failed, 0, JSON.stringify(execution));
    assert.equal(execution.executed + execution.deferred, execution.candidates, 'the dependent side is never failed, only executed later or deferred');
    await drain();
    const execution2 = await runInternalExecutionPass({ ...lifecycleCtx, executorPrincipalId: authority.principals.executor });
    assert.equal(execution2.executed, 1, JSON.stringify(execution2));
    assert.equal(execution2.failed, 0, JSON.stringify(execution2));
    const after = await pool.query<{ id: string; window_start: Date }>('SELECT id, window_start FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [seed.workspaceId, [earlyItem.programmeItemId, lateItem.programmeItemId]]);
    assert.equal(after.rows.find((r) => r.id === earlyItem.programmeItemId)!.window_start.toISOString(), LATE_WINDOW.start);
    assert.equal(after.rows.find((r) => r.id === lateItem.programmeItemId)!.window_start.toISOString(), EARLY_WINDOW.start);
    const observations = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM execution_observations eo JOIN action_intents ai ON ai.workspace_id = eo.workspace_id AND ai.id = eo.action_intent_id WHERE eo.workspace_id = $1 AND ai.action_plan_id = $2', [seed.workspaceId, approval.planId]);
    assert.equal(Number(observations.rows[0]!.n), 2);
    assert.equal((await runInternalExecutionPass({ ...lifecycleCtx, executorPrincipalId: authority.principals.executor })).candidates, 0, 'a rerun finds nothing to execute');

    // --- observation -> reassessment (normal invalidation) -> resolution gate -> RESOLVED.
    const afterExecution = await drain();
    assert.ok(afterExecution.processed >= 2, JSON.stringify(afterExecution));
    for (const p of people) assert.equal(await verdict(p.journeyId), 'PASS', `post-swap ${p.journeyId}`);
    const resolution = await runCaseResolutionPass(lifecycleCtx);
    assert.equal(resolution.resolved, 1, JSON.stringify(resolution.outcomes));
    const finalView = projectRecoveryCase((await loadRecoveryCaseFacts(pool, seed.workspaceId, caseId, NOW))!);
    assert.equal(finalView.status, 'RESOLVED');
    assert.equal(finalView.tripViability.verdict, 'PASS');
    assert.equal(finalView.recoveryActions.length, 2);
    assert.ok(finalView.recoveryActions.every((a) => a.executionState === 'COMPLETED'), JSON.stringify(finalView.recoveryActions));
    assert.equal(await runCaseEscalation(lifecycleCtx).then((r) => r.opened), 0, 'a resolved, passing subject opens nothing new');
  });
});
