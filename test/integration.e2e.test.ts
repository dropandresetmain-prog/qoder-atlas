/**
 * T-E2E — Scenario A vertical recovery loop, one deterministic REPLAY flow.
 *
 * source/profile -> persistent Trip -> disruption signal -> validated state
 * update -> blast radius -> planner -> Atlas read-only capability queries
 * (REPLAY, shared normalizer) -> recovery strategies -> deterministic
 * viability (hard-infeasible candidate rejected by the engine) -> traveller
 * authority decision -> provider-boundary simulated action -> observation ->
 * validated authoritative mutation -> verified FULLY_RECOVERED -> real
 * operator/traveller read models. No manual mutation between stages; state
 * and read models survive a process restart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
import { loadScenario } from '../src/scenarios/loader.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { ModelStudioClient, ScriptedModelTransport } from '../src/intelligence/client.ts';
import { ModelStudioRecoveryPlanner } from '../src/intelligence/planner.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { IsoDateTime } from '../src/domain/common.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
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

const SCENARIO_A_DIR = join(resolve('fixtures/scenarios'), 'anchor-event-speaker');
const RECORDING_READ_DIRS = [join(SCENARIO_A_DIR, 'recordings'), resolve('fixtures/recordings')];

const PLANNING_AT = '2026-09-12T20:00:00+09:00';
const BEGIN_AT = '2026-09-12T20:15:00+09:00';
const APPROVAL_AT = '2026-09-12T20:45:00+09:00';
const READ_AT = '2026-09-12T21:30:00+09:00';

const MORNING_OFFER_ID = 'ATLSBX-20260914-KE711-E7';
const EVENING_OFFER_ID = 'ATLSBX-20260913-OZ104-E3';
const AFTERNOON_OFFER_ID = 'ATLSBX-20260913-KE705-B1';

function createHarness(dbPath: string) {
  const db = openDatabase(dbPath);
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const signals = new SqliteSignalRepository(db);
  const cases = new SqliteCaseRepository(db);
  const audit = new SqliteAuditRepository(db);
  const preferences = new SqlitePreferenceStore(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  return { db, trips, entities, sources, signals, cases, audit, preferences, mutations };
}

type Harness = ReturnType<typeof createHarness>;

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
  };
  return new RecoveryExecutionService(deps);
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

test('T-E2E: Scenario A recovers through the full generalized vertical loop (REPLAY)', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-'));
  const dbPath = join(dbDir, 'app.sqlite');
  const harness = createHarness(dbPath);
  const spec = loadScenario(SCENARIO_A_DIR);

  // -- Stage 1: sources/profile -> validated persistent trip -------------
  await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );
  const seededTrip = (await harness.trips.getTrip(spec.trip.id))!;
  assert.ok(seededTrip, 'trip persists from validated seed operations');
  assert.ok((await harness.sources.listSources()).length >= spec.context.sources.length, 'provenance retained');

  // -- Stage 2: disruption signal -> validated mutation -> blast radius ----
  const signalResult = await processSignal(
    {
      trips: harness.trips,
      signals: harness.signals,
      entities: harness.entities,
      cases: harness.cases,
      mutations: harness.mutations,
      audit: harness.audit,
    },
    spec.disruption.signal,
  );
  assert.equal(signalResult.mutationAccepted, true);
  const impact = signalResult.assessment;
  assert.equal(impact.severity, spec.expectations.impact.severity);
  assert.deepEqual(
    impact.directFailures.map((failure) => failure.elementId),
    spec.expectations.impact.directFailureElementIds,
  );
  assert.deepEqual(
    [...impact.affectedElements.map((element) => element.elementId)].sort(),
    [...spec.expectations.impact.atRiskElementIds].sort(),
  );
  assert.deepEqual(
    impact.threatenedObjectives.map((objective) => objective.objectiveId),
    spec.expectations.impact.threatenedObjectiveIds,
  );

  // -- Stage 3: planner -> capabilities -> overlays -> viability -----------
  const snapshot = await buildTripSnapshot(
    { trips: harness.trips, entities: harness.entities, preferences: harness.preferences, sources: harness.sources },
    spec.trip.id,
    PLANNING_AT,
  );
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: RECORDING_READ_DIRS }),
    timezoneResolver: await buildTimezoneResolver(harness.entities)(),
  });
  const disruptedTrip = (await harness.trips.getTrip(spec.trip.id))!;
  const cancelledLeg = disruptedTrip.elements.find(
    (element) => element.elementKind === 'TRANSPORT_LEG' && element.reservationState === 'CANCELLED',
  ) as TransportLeg;
  assert.ok(cancelledLeg, 'disruption signal cancelled the outbound leg');
  const places = snapshot.places;
  const origin = places.find((place) => place.id === cancelledLeg.data.originPlaceId)!;
  const destination = places.find((place) => place.id === cancelledLeg.data.destinationPlaceId)!;
  const sourceId = spec.disruption.signal.sourceId;
  const round1 = {
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.search',
        parameters: {
          origin: { system: origin.externalRefs![0]!.system, value: origin.externalRefs![0]!.value },
          destination: { system: destination.externalRefs![0]!.system, value: destination.externalRefs![0]!.value },
          departureDate: cancelledLeg.data.scheduledDeparture!.value.slice(0, 10),
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
          cancelledLeg,
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
          cancelledLeg,
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
          cancelledLeg,
          { departure: '2026-09-13T14:05:00+09:00', arrival: '2026-09-13T16:40:00+09:00', offerId: AFTERNOON_OFFER_ID },
          sourceId,
        ),
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: { amount: 416.9, currency: 'USD' },
      },
    ],
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.verify',
        parameters: { offerId: EVENING_OFFER_ID },
        purpose: 'confirm the evening offer is still bookable',
      },
      {
        capability: 'FLIGHT',
        operation: 'flight.fare_rules',
        parameters: { offerId: EVENING_OFFER_ID },
        purpose: 'confirm change rules for the evening offer',
      },
    ],
    assumptions: [],
    uncertainties: [],
    rationale: 'three materially different replacement options',
  };
  let sequence = 0;
  const planner = new ModelStudioRecoveryPlanner({
    client: new ModelStudioClient({ transport: new ScriptedModelTransport([JSON.stringify(round1), JSON.stringify(round2)]) }),
    idFactory: (prefix) => `${prefix}-e2e-${String(++sequence).padStart(3, '0')}`,
    now: () => PLANNING_AT,
  });
  const planningDeps: PlanningLoopDependencies = {
    planner,
    capabilities: { flight: adapter },
    viability: new OverlayViabilityEngine(),
    cases: harness.cases,
    audit: harness.audit,
  };
  const planning = await runPlanningLoop(planningDeps, {
    caseId: signalResult.caseId,
    snapshot,
    triggeringSignals: [spec.disruption.signal],
    impact,
    capabilityRegistry: [adapter.descriptor],
    planningAt: PLANNING_AT,
  });

  // Capability evidence: REPLAY through the shared normalizer, all read-only.
  assert.deepEqual(
    planning.toolActivity.map((activity) => activity.request.operation),
    ['flight.search', 'flight.verify', 'flight.fare_rules'],
  );
  for (const activity of planning.toolActivity) {
    assert.equal(activity.result.ok, true, `tool ${activity.request.operation} must succeed in REPLAY`);
    if (activity.result.ok) {
      assert.equal(activity.result.mode, 'REPLAY');
      assert.ok(activity.result.recordingId, 'replay cites its recording');
    }
  }

  // Deterministic viability: the attractive cheap candidate is rejected by
  // the engine itself; UNKNOWN is never PASS; the evening offer ranks first.
  const morning = planning.candidates.find((candidate) => candidate.strategy.summary.includes('morning'))!;
  assert.equal(morning.feasible, false);
  assert.ok(
    morning.rejectionReasons.some((reason) => reason.includes('c_a_arrive_before_keynote') && reason.includes('FAILS')),
    'engine-owned hard rejection reason',
  );
  assert.equal(planning.rankedFeasibleIds[0], planning.bestStrategyId);
  const best = planning.strategies.find((strategy) => strategy.id === planning.bestStrategyId)!;
  assert.ok(best.summary.includes('evening'), 'cheapest hard-viable same-day option wins');

  // Planning never mutates authoritative state.
  const preExecutionLeg = ((await harness.trips.getTrip(spec.trip.id))!.elements.find(
    (element) => element.id === cancelledLeg.id,
  )) as TransportLeg;
  assert.equal(preExecutionLeg.reservationState, 'CANCELLED');

  // -- Stage 4: authority -> action -> observation -> resolution -----------
  const service = createExecutionService(harness);
  const begin = await service.beginStrategy({
    snapshot,
    caseId: signalResult.caseId,
    strategy: best,
    at: BEGIN_AT,
  });
  assert.equal(begin.decision.outcome, spec.expectations.authority.expectedOutcome);
  assert.equal(begin.intent.operation, spec.expectations.recovery.actionOperation);

  const settled = await settleTravellerDecision(
    { service, cases: harness.cases, trips: harness.trips },
    { caseId: signalResult.caseId, verdict: 'APPROVED', at: APPROVAL_AT },
  );
  assert.equal(settled.caseStatus, 'RESOLVED');
  assert.equal(settled.execution?.result?.provenance, 'SIMULATED', 'provider action simulated only at the boundary');
  assert.equal(settled.execution?.observation?.stateUpdated, true);
  assert.equal(
    settled.execution?.verification?.resolution?.outcome,
    spec.expectations.recovery.expectedResolution,
  );
  assert.deepEqual(settled.execution?.verification?.remainingLossRefs, spec.expectations.recovery.remainingLossObjectiveIds);

  // Observed authoritative state: confirmed replacement, not just API success.
  const recoveredLeg = ((await harness.trips.getTrip(spec.trip.id))!.elements.find(
    (element) => element.id === cancelledLeg.id,
  )) as TransportLeg;
  assert.equal(recoveredLeg.reservationState, 'CONFIRMED');
  assert.equal(recoveredLeg.data.bookingRef?.reference, EVENING_OFFER_ID);
  assert.equal(recoveredLeg.data.scheduledArrival?.value, '2026-09-13T20:55:00+09:00');

  // -- Stage 5: real read models reconstruct the resolved state ------------
  const readDeps = readModelDeps(harness);
  const dashboard = await projectOperatorDashboard(readDeps, READ_AT);
  assert.equal(dashboard.trips[0]!.status, 'RESOLVED');
  const detail = (await projectCaseDetail(readDeps, signalResult.caseId, READ_AT))!;
  assert.equal(detail.resolution?.outcome, 'FULLY_RECOVERED');
  assert.ok(detail.options.some((option) => option.verdict === 'NOT_VIABLE' && option.rejectionReason));
  const traveller = (await projectTravellerTrip(readDeps, spec.trip.id, READ_AT))!;
  assert.equal(traveller.remainderViable, 'VIABLE');

  // Full audit chain: signal -> planning -> authority -> approval -> execution.
  const actions = (await harness.audit.query({ subject: spec.trip.id })).map((entry) => entry.action);
  for (const expected of [
    'SIGNAL_PROCESSED',
    'PLANNING_COMPLETED',
    'AUTHORITY_DECIDED',
    'APPROVAL_RECORDED',
    'EXECUTION_COMPLETED',
    'CASE_VERIFIED',
  ]) {
    assert.ok(actions.includes(expected), `audit chain must include ${expected}`);
  }

  // -- Stage 6: restart — everything reconstructs from SQLite --------------
  harness.db.close();
  const reloaded = createHarness(dbPath);
  const reloadedCase = (await reloaded.cases.getCase(signalResult.caseId))!;
  assert.equal(reloadedCase.status, 'RESOLVED');
  assert.equal(reloadedCase.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(reloadedCase.strategies.length, 3);
  assert.equal(reloadedCase.executionResults[0]!.provenance, 'SIMULATED');
  const reloadedLeg = ((await reloaded.trips.getTrip(spec.trip.id))!.elements.find(
    (element) => element.id === cancelledLeg.id,
  )) as TransportLeg;
  assert.equal(reloadedLeg.reservationState, 'CONFIRMED');

  // Read models rebuild from persisted application state, not memory.
  const reloadedReadDeps = readModelDeps(reloaded);
  const reloadedDashboard = await projectOperatorDashboard(reloadedReadDeps, READ_AT);
  assert.equal(reloadedDashboard.trips[0]!.status, 'RESOLVED');
  const reloadedDetail = (await projectCaseDetail(reloadedReadDeps, signalResult.caseId, READ_AT))!;
  assert.equal(reloadedDetail.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(reloadedDetail.options.length, 3);
  const reloadedTraveller = (await projectTravellerTrip(reloadedReadDeps, spec.trip.id, READ_AT))!;
  assert.equal(reloadedTraveller.status, 'RESOLVED');
  assert.ok((await reloaded.audit.query({ subject: spec.trip.id })).length >= actions.length);
  reloaded.db.close();
});
