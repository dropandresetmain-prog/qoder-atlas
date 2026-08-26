/**
 * I5 evidence — real read models -> operator/traveller UI + HTTP.
 *
 * Proves: operator dashboard, case detail and traveller views project
 * EXCLUSIVELY from persisted authoritative state (no fixture-typed data on
 * the runtime path); CaseDetailView is resolved through the honest projection
 * adapter (engine-owned verdicts/rejection reasons, simulated execution
 * labelled); the traveller decision endpoint drives the real authority /
 * execution lifecycle; and the minimal HTTP surface serves it all while
 * staying credential-free (REPLAY boot).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteCaseRepository,
  SqliteSignalRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import { BoundaryExecutor } from '../src/engine/executor.ts';
import { DeterministicAuthorityEngine, ruleSetSource } from '../src/engine/authority.ts';
import { CaseVerifier, DeterministicObservationService } from '../src/engine/observation.ts';
import { CaseService } from '../src/engine/case.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { ModelStudioClient, ScriptedModelTransport } from '../src/intelligence/client.ts';
import { ModelStudioRecoveryPlanner } from '../src/intelligence/planner.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { Place } from '../src/domain/entities.ts';
import type { IsoDateTime } from '../src/domain/common.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import { caseDetailViewIssues } from '../src/ui/case-view-model.ts';
import { createAppServer, type AppEndpoints } from '../src/server/http.ts';
import { projectTravellerPresentation } from '../src/app/travellerPresentation.ts';
import {
  buildTimezoneResolver,
  buildTripSnapshot,
  createRecoveryExecutor,
  processSignal,
  projectCaseDetail,
  projectOperatorDashboard,
  projectTravellerTrip,
  RecoveryExecutionService,
  runPlanningLoop,
  seedScenarioBundle,
  settleTravellerDecision,
  SqlitePreferenceStore,
  type PlanningLoopDependencies,
  type ReadModelDependencies,
  type RecoveryExecutionDependencies,
} from '../src/app/index.ts';

const FIXTURES_ROOT = resolve('fixtures/scenarios');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'anchor-event-speaker');
const RECORDING_READ_DIRS = [join(SCENARIO_A_DIR, 'recordings'), resolve('fixtures/recordings')];
const PLANNING_AT = '2026-09-12T20:00:00+09:00';
const BEGIN_AT = '2026-09-12T20:15:00+09:00';
const APPROVAL_AT = '2026-09-12T20:45:00+09:00';
const NOW: IsoDateTime = '2026-09-12T21:30:00+09:00';

const MORNING_OFFER_ID = 'ATLSBX-20260914-KE711-E7';
const EVENING_OFFER_ID = 'ATLSBX-20260913-OZ104-E3';
const AFTERNOON_OFFER_ID = 'ATLSBX-20260913-KE705-B1';

function createHarness(dbPath = ':memory:') {
  const db = openDatabase(dbPath);
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  const seedDeps = { mutations, sources, preferences, audit };
  const pipelineDeps = { trips, signals, entities, cases, mutations, audit };
  return { db, trips, entities, sources, signals, cases, audit, preferences, mutations, seedDeps, pipelineDeps };
}

type Harness = ReturnType<typeof createHarness>;

async function setupDisruptedTrip(harness: Harness) {
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);
  const signalResult = await processSignal(harness.pipelineDeps, spec.disruption.signal);
  const snapshot = await buildTripSnapshot(
    { trips: harness.trips, entities: harness.entities, preferences: harness.preferences, sources: harness.sources },
    spec.trip.id,
    PLANNING_AT,
  );
  const disruptedTrip = (await harness.trips.getTrip(spec.trip.id))!;
  const cancelledLeg = disruptedTrip.elements.find(
    (element) => element.elementKind === 'TRANSPORT_LEG' && element.reservationState === 'CANCELLED',
  );
  assert.ok(cancelledLeg && cancelledLeg.elementKind === 'TRANSPORT_LEG');
  return { spec, signalResult, snapshot, cancelledLeg: cancelledLeg as TransportLeg };
}

function replacementOperations(
  base: TransportLeg,
  offer: { departure: IsoDateTime; arrival: IsoDateTime; offerId: string },
  sourceId: string,
): MutationOperation[] {
  const fact = (value: IsoDateTime) => ({
    value,
    sourceId,
    authority: 'CONNECTED' as const,
    observedAt: PLANNING_AT,
  });
  return [
    {
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP_ELEMENT',
      data: {
        ...base,
        reservationState: 'HELD',
        status: 'UNKNOWN',
        data: {
          ...base.data,
          scheduledDeparture: fact(offer.departure),
          scheduledArrival: fact(offer.arrival),
          bookingRef: { system: 'atlas', reference: offer.offerId },
        },
      },
    },
  ];
}

function scriptedPlanner(responses: string[]) {
  const transport = new ScriptedModelTransport(responses);
  const client = new ModelStudioClient({ transport });
  let sequence = 0;
  return new ModelStudioRecoveryPlanner({
    client,
    idFactory: (prefix) => `${prefix}-i5-${String(++sequence).padStart(3, '0')}`,
    now: () => PLANNING_AT,
  });
}

function roundOutputs(leg: TransportLeg, places: Place[], sourceId: string) {
  const origin = places.find((place) => place.id === leg.data.originPlaceId);
  const destination = places.find((place) => place.id === leg.data.destinationPlaceId);
  const round1 = {
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.search',
        parameters: {
          origin: { system: origin!.externalRefs![0]!.system, value: origin!.externalRefs![0]!.value },
          destination: { system: destination!.externalRefs![0]!.system, value: destination!.externalRefs![0]!.value },
          departureDate: leg.data.scheduledDeparture!.value.slice(0, 10),
          passengers: { adults: 1 },
        },
        purpose: 'find replacement flights for the cancelled leg',
      },
    ],
    assumptions: [],
    uncertainties: [],
  };
  const round2 = {
    strategies: [
      {
        summary: 'Rebook on the cheapest next-morning replacement',
        candidateOperations: replacementOperations(
          leg,
          { departure: '2026-09-14T09:05:00+09:00', arrival: '2026-09-14T11:35:00+09:00', offerId: MORNING_OFFER_ID },
          sourceId,
        ),
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: { amount: 162.1, currency: 'USD' },
      },
      {
        summary: 'Rebook on the same-day evening replacement',
        candidateOperations: replacementOperations(
          leg,
          { departure: '2026-09-13T18:25:00+09:00', arrival: '2026-09-13T20:55:00+09:00', offerId: EVENING_OFFER_ID },
          sourceId,
        ),
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: { amount: 242.6, currency: 'USD' },
      },
      {
        summary: 'Rebook on the same-day afternoon replacement',
        candidateOperations: replacementOperations(
          leg,
          { departure: '2026-09-13T14:05:00+09:00', arrival: '2026-09-13T16:40:00+09:00', offerId: AFTERNOON_OFFER_ID },
          sourceId,
        ),
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: { amount: 416.9, currency: 'USD' },
      },
    ],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    rationale: 'three materially different replacement options',
  };
  return { round1, round2 };
}

async function planRecovery(harness: Harness, setup: Awaited<ReturnType<typeof setupDisruptedTrip>>) {
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: RECORDING_READ_DIRS }),
    timezoneResolver: await buildTimezoneResolver(harness.entities)(),
  });
  const { round1, round2 } = roundOutputs(setup.cancelledLeg, setup.snapshot.places, setup.spec.disruption.signal.sourceId);
  const deps: PlanningLoopDependencies = {
    planner: scriptedPlanner([JSON.stringify(round1), JSON.stringify(round2)]),
    capabilities: { flight: adapter },
    viability: new OverlayViabilityEngine(),
    cases: harness.cases,
    audit: harness.audit,
  };
  return runPlanningLoop(deps, {
    caseId: setup.signalResult.caseId,
    snapshot: setup.snapshot,
    triggeringSignals: [setup.spec.disruption.signal],
    impact: setup.signalResult.assessment,
    capabilityRegistry: [adapter.descriptor],
    planningAt: PLANNING_AT,
  });
}

function readModelDeps(harness: Harness): ReadModelDependencies {
  return {
    snapshot: {
      trips: harness.trips,
      entities: harness.entities,
      preferences: harness.preferences,
      sources: harness.sources,
    },
    signals: harness.signals,
    cases: harness.cases,
    audit: harness.audit,
    viability: new OverlayViabilityEngine(),
  };
}

function createExecutionService(harness: Harness): RecoveryExecutionService {
  const deps: RecoveryExecutionDependencies = {
    cases: harness.cases,
    audit: harness.audit,
    authority: new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(harness.entities) }),
    executor: createRecoveryExecutor({
      inner: new BoundaryExecutor(),
      strategyFor: async (intent) =>
        (await harness.cases.getCase(intent.caseId))?.strategies.find((strategy) => strategy.id === intent.strategyId),
    }),
    observation: new DeterministicObservationService({ mutations: harness.mutations }),
    verifier: new CaseVerifier({ trips: harness.trips, signals: harness.signals, entities: harness.entities }),
    trips: harness.trips,
    entities: harness.entities,
  };
  return new RecoveryExecutionService(deps);
}

test('i5: operator dashboard and case detail project real state through the loop', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const planning = await planRecovery(harness, setup);
  const strategy = planning.strategies.find((candidate) => candidate.id === planning.bestStrategyId)!;
  const service = createExecutionService(harness);
  const caseId = setup.signalResult.caseId;
  const readDeps = readModelDeps(harness);

  // Pre-approval: awaiting the traveller, options carry engine verdicts.
  await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });

  const dashboard = await projectOperatorDashboard(readDeps, NOW);
  assert.equal(dashboard.trips.length, 1);
  const tripView = dashboard.trips[0]!;
  assert.equal(tripView.status, 'RECOVERING');
  assert.equal(tripView.activeCaseId, caseId, 'active operator rows expose their operator-case destination');
  assert.equal(tripView.whatChanged, setup.spec.disruption.signal.summary);
  assert.ok(tripView.affectedItems.length > 0, 'affected items come from the persisted case');
  assert.equal(tripView.travellerResponseStatus, 'AWAITING');
  assert.equal(tripView.pendingDecisions.length, 1);
  assert.equal(tripView.pendingDecisions[0]!.decisionType, 'APPROVAL');
  assert.deepEqual(tripView.pendingDecisions[0]!.amount, strategy.costImpact);
  assert.equal(dashboard.summary.awaitingDecision, 1);
  assert.ok(
    tripView.systemActivity.some((line) => line.includes('Recovery options planned')),
    'system activity is projected from the real audit trail',
  );

  const detail = (await projectCaseDetail(readDeps, caseId, NOW))!;
  assert.deepEqual(caseDetailViewIssues(detail), [], 'projection must satisfy the UI consistency guard');
  assert.equal(detail.status, 'RECOVERING');
  assert.equal(detail.whatChanged, setup.spec.disruption.signal.summary);
  assert.ok(detail.criticalObjectiveAtRisk, 'threatened HARD objective is surfaced');
  assert.equal(detail.options.length, 3);
  const morning = detail.options.find((option) => option.title.includes('morning'))!;
  assert.equal(morning.verdict, 'NOT_VIABLE');
  assert.ok(morning.rejectionReason && morning.rejectionReason.length > 0, 'engine-owned rejection reason');
  const evening = detail.options.find((option) => option.title.includes('evening'))!;
  assert.equal(evening.verdict, 'VIABLE');
  assert.equal(evening.recommended, true);
  assert.equal(evening.requiresApproval, true);
  assert.ok(detail.approval && detail.approval.state === 'PENDING' && detail.approval.requestedFrom === 'TRAVELLER');
  assert.deepEqual(detail.approval.amount, strategy.costImpact);
  assert.ok(detail.checks.some((check) => check.result === 'FAIL'), 'disrupted constraint is visible pre-recovery');
  assert.equal(detail.actions.length, 1);
  assert.equal(detail.actions[0]!.state, 'QUEUED');
  assert.ok(detail.chain && detail.chain.length > 0, 'authoritative trip elements project into the journey chain');
  assert.equal(detail.chain!.at(-1)!.commitment, true, 'the commitment closes the journey chain');

  // Traveller view pre-approval: input requested, remainder not viable yet.
  const travellerView = (await projectTravellerTrip(readDeps, setup.spec.trip.id, NOW))!;
  assert.equal(travellerView.status, 'RECOVERING');
  assert.equal(travellerView.travellerId, setup.spec.trip.travellerIds[0]);
  assert.equal(travellerView.inputRequested.length, 1);
  assert.deepEqual(travellerView.inputRequested[0]!.options, ['Approve', 'Decline']);
  assert.equal(travellerView.remainderViable, 'NOT_VIABLE');
  assert.ok(travellerView.whatMattersNow, 'critical objective drives what matters');

  // Approval through the real lifecycle resolves everything.
  const settled = await settleTravellerDecision(
    { service, cases: harness.cases, trips: harness.trips },
    { caseId, verdict: 'APPROVED', at: APPROVAL_AT },
  );
  assert.equal(settled.accepted, true);
  assert.equal(settled.caseStatus, 'RESOLVED');
  assert.equal(settled.execution?.verification?.resolution?.outcome, 'FULLY_RECOVERED');

  const resolvedDashboard = await projectOperatorDashboard(readDeps, NOW);
  assert.equal(resolvedDashboard.trips[0]!.status, 'RESOLVED');
  assert.ok(resolvedDashboard.trips[0]!.resolutionSummary, 'resolution summary surfaces on the dashboard');
  assert.equal(resolvedDashboard.summary.awaitingDecision, 0);

  const resolvedDetail = (await projectCaseDetail(readDeps, caseId, NOW))!;
  assert.equal(resolvedDetail.status, 'RESOLVED');
  assert.equal(resolvedDetail.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(resolvedDetail.approval?.state, 'APPROVED');
  assert.equal(resolvedDetail.actions[0]!.state, 'DONE');
  assert.match(resolvedDetail.actions[0]!.label, /simulated at provider boundary/, 'simulation stays honestly labelled');
  assert.ok(resolvedDetail.checks.every((check) => check.result === 'PASS'), 'post-recovery checks pass');

  const resolvedTraveller = (await projectTravellerTrip(readDeps, setup.spec.trip.id, NOW))!;
  assert.equal(resolvedTraveller.status, 'RESOLVED');
  assert.equal(resolvedTraveller.inputRequested.length, 0);
  assert.equal(resolvedTraveller.remainderViable, 'VIABLE');
  assert.ok(resolvedTraveller.resolutionSummary);
});

test('i5: HTTP surface serves real projections and the decision endpoint drives the loop', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const planning = await planRecovery(harness, setup);
  const strategy = planning.strategies.find((candidate) => candidate.id === planning.bestStrategyId)!;
  const service = createExecutionService(harness);
  const caseId = setup.signalResult.caseId;
  const readDeps = readModelDeps(harness);
  await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });

  const endpoints: AppEndpoints = {
    now: () => NOW,
    operatorDashboard: (at) => projectOperatorDashboard(readDeps, at),
    caseDetail: (id, at) => projectCaseDetail(readDeps, id, at),
    travellerTrip: (tripId, at) => projectTravellerTrip(readDeps, tripId, at),
    travellerPresentation: async (tripId, at) => {
      const trip = await harness.trips.getTrip(tripId);
      const recoveryCase = await harness.cases.getCase(caseId);
      if (!trip || !recoveryCase) return undefined;
      const detail = await projectCaseDetail(readDeps, recoveryCase.id, at);
      return projectTravellerPresentation(
        {
          entities: harness.entities,
          verdictFor: (strategyId) => {
            const option = detail?.options.find((candidate) => candidate.id === strategyId);
            return option && option.verdict !== 'UNKNOWN'
              ? { feasible: option.verdict === 'VIABLE' }
              : undefined;
          },
          bestStrategyId: planning.bestStrategyId,
        },
        trip,
        recoveryCase,
        detail?.criticalObjectiveAtRisk,
      );
    },
    firstTripId: async () => (await harness.trips.listTrips())[0]?.tripId,
    travellerDecision: async (id, body, at) => {
      const outcome = await settleTravellerDecision(
        { service, cases: harness.cases, trips: harness.trips },
        { caseId: id, verdict: body.decision, at, ...(body.note ? { note: body.note } : {}) },
      );
      return {
        accepted: outcome.accepted,
        ...(outcome.error ? { error: outcome.error } : {}),
        ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
        ...(outcome.caseStatus ? { caseStatus: outcome.caseStatus } : {}),
        ...(outcome.execution?.verification?.resolution
          ? { resolutionOutcome: outcome.execution.verification.resolution.outcome }
          : {}),
      };
    },
  };

  const server = createAppServer({ environment: 'local', logLevel: 'info', adapterMode: 'REPLAY', httpPort: 0, sqlitePath: ':memory:', recordingsDir: 'recordings', fixturesDir: 'fixtures', providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {}, frankfurter: {} } }, endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const port = (server.address() as AddressInfo).port;
  const base = `http://localhost:${port}`;

  try {
    // Health + root keep working (credential-free REPLAY boot surface).
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);

    // Operator HTML surfaces render real state.
    const dashboardRes = await fetch(`${base}/operator`);
    assert.equal(dashboardRes.status, 200);
    const dashboardHtml = await dashboardRes.text();
    assert.match(dashboardHtml, /Operations overview/);
    assert.match(dashboardHtml, /Recovery options planned/);

    const caseRes = await fetch(`${base}/operator/cases/${caseId}`);
    assert.equal(caseRes.status, 200);
    const caseHtml = await caseRes.text();
    assert.match(caseHtml, /Options on the table/);
    assert.match(caseHtml, /Approval/);
    const missingCase = await fetch(`${base}/operator/cases/case-does-not-exist`);
    assert.equal(missingCase.status, 404);

    // Traveller HTML surface shows the pending decision.
    const travellerRes = await fetch(`${base}/traveller`);
    assert.equal(travellerRes.status, 200);
    const travellerHtml = await travellerRes.text();
    assert.match(travellerHtml, /We need your input/);
    assert.match(travellerHtml, /data-ui-section="commitment"/);
    assert.match(travellerHtml, /class="optcard/);
    assert.match(travellerHtml, /value="APPROVED"/);
    assert.match(travellerHtml, /opt-route|opt-note/);

    // JSON read models expose the same projections.
    const caseJson = (await (await fetch(`${base}/api/cases/${caseId}`)).json()) as {
      options: Array<{ verdict: string }>;
    };
    assert.equal(caseJson.options.length, 3);
    assert.ok(caseJson.options.find((option) => option.verdict === 'NOT_VIABLE'));

    // The traveller decision endpoint drives the real lifecycle to resolution.
    const decisionRes = await fetch(`${base}/api/cases/${caseId}/traveller-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.equal(decisionRes.status, 200);
    const decisionJson = (await decisionRes.json()) as { caseStatus: string; resolutionOutcome: string };
    assert.equal(decisionJson.caseStatus, 'RESOLVED');
    assert.equal(decisionJson.resolutionOutcome, 'FULLY_RECOVERED');

    // A second decision finds nothing pending — state actually moved on.
    const repeat = await fetch(`${base}/api/cases/${caseId}/traveller-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    assert.equal(repeat.status, 409);
    assert.equal(((await repeat.json()) as { error: string }).error, 'no_pending_traveller_decision');

    // Invalid bodies are refused structurally.
    const invalid = await fetch(`${base}/api/cases/${caseId}/traveller-decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'MAYBE' }),
    });
    assert.equal(invalid.status, 400);

    // Post-resolution read models reflect the recovered trip.
    const afterDashboard = (await (await fetch(`${base}/api/operator/dashboard`)).json()) as {
      trips: Array<{ status: string }>;
    };
    assert.equal(afterDashboard.trips[0]!.status, 'RESOLVED');
    const settledDashboardHtml = await (await fetch(`${base}/operator`)).text();
    assert.match(settledDashboardHtml, /class="just-changed [^"]*"[^>]*data-fleet-trip=/);
    assert.doesNotMatch(await (await fetch(`${base}/operator`)).text(), /class="just-changed/);
    const afterTraveller = (await (await fetch(`${base}/api/traveller/${setup.spec.trip.id}`)).json()) as {
      remainderViable: string;
      resolutionSummary?: string;
    };
    assert.equal(afterTraveller.remainderViable, 'VIABLE');
    assert.ok(afterTraveller.resolutionSummary);
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
  }
});

test('i5: declined decision via the app seam loops back to planning', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const caseId = setup.signalResult.caseId;
  const caseService = new CaseService({ cases: harness.cases });
  await caseService.transition(caseId, 'PLANNING', PLANNING_AT);

  const strategy = {
    id: 'strat-evening-direct',
    caseId,
    summary: 'Rebook on the same-day evening replacement',
    candidateOperations: replacementOperations(
      setup.cancelledLeg,
      { departure: '2026-09-13T18:25:00+09:00', arrival: '2026-09-13T20:55:00+09:00', offerId: EVENING_OFFER_ID },
      setup.spec.disruption.signal.sourceId,
    ),
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    costImpact: { amount: 242.6, currency: 'USD' },
    createdAt: PLANNING_AT,
  };
  await caseService.record(caseId, PLANNING_AT, { strategies: [strategy] });

  const service = createExecutionService(harness);
  await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });

  const declined = await settleTravellerDecision(
    { service, cases: harness.cases, trips: harness.trips },
    { caseId, verdict: 'DECLINED', at: APPROVAL_AT, note: 'prefers to review other options' },
  );
  assert.equal(declined.accepted, true);
  assert.equal(declined.caseStatus, 'PLANNING');
  assert.equal(declined.execution, undefined);

  const recoveryCase = (await harness.cases.getCase(caseId))!;
  assert.equal(recoveryCase.status, 'PLANNING');
  assert.equal(recoveryCase.actionIntents[0]!.status, 'REJECTED');

  // Read models stay honest about the open disruption.
  const detail = (await projectCaseDetail(readModelDeps(harness), caseId, NOW))!;
  assert.equal(detail.status, 'DISRUPTED');
  assert.equal(detail.approval?.state, 'DECLINED');
  assert.equal(detail.resolution, undefined);
});
