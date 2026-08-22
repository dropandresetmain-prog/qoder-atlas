/**
 * I4 evidence — authority -> action -> observation -> resolution.
 *
 * Proves: a selected strategy becomes a deterministic ActionIntent (planner
 * never mints authority); the deterministic authority engine gates execution
 * (traveller approval for Scenario A's fixture-expected outcome, organisation
 * approval above the spend threshold); declined/forged/blocked authority
 * never reaches the executor; the provider-boundary simulation is honest
 * (SIMULATED provenance, observed effects re-validated through the mutation
 * path); execution success alone never resolves the case — only the verifier's
 * deterministic re-evaluation does (FULLY_RECOVERED); and case/intent/
 * execution evidence survives a process restart.
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
import { CaseService } from '../src/engine/case.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import {
  ModelStudioClient,
  ScriptedModelTransport,
} from '../src/intelligence/client.ts';
import { ModelStudioRecoveryPlanner } from '../src/intelligence/planner.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { Place } from '../src/domain/entities.ts';
import type { IsoDateTime } from '../src/domain/common.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { ExecutorService } from '../src/contracts/services.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import {
  buildTimezoneResolver,
  buildTripSnapshot,
  createRecoveryExecutor,
  processSignal,
  RecoveryExecutionService,
  runPlanningLoop,
  seedScenarioBundle,
  SqlitePreferenceStore,
  type PlanningLoopDependencies,
  type RecoveryExecutionDependencies,
} from '../src/app/index.ts';

const FIXTURES_ROOT = resolve('fixtures/scenarios');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'anchor-event-speaker');
const RECORDING_READ_DIRS = [join(SCENARIO_A_DIR, 'recordings'), resolve('fixtures/recordings')];
const PLANNING_AT = '2026-09-12T20:00:00+09:00';
const BEGIN_AT = '2026-09-12T20:15:00+09:00';
const APPROVAL_AT = '2026-09-12T20:45:00+09:00';
const EXECUTE_AT = '2026-09-12T21:00:00+09:00';

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

/** Seed Scenario A and apply the disruption (I1+I2 seams). */
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
  assert.ok(cancelledLeg && cancelledLeg.elementKind === 'TRANSPORT_LEG', 'disruption must cancel the outbound leg');
  return { spec, signalResult, snapshot, cancelledLeg: cancelledLeg as TransportLeg };
}

function scriptedPlanner(responses: string[]) {
  const transport = new ScriptedModelTransport(responses);
  const client = new ModelStudioClient({ transport });
  let sequence = 0;
  return new ModelStudioRecoveryPlanner({
    client,
    idFactory: (prefix) => `${prefix}-i4-${String(++sequence).padStart(3, '0')}`,
    now: () => PLANNING_AT,
  });
}

function searchParametersFor(leg: TransportLeg, places: Place[]) {
  const origin = places.find((place) => place.id === leg.data.originPlaceId);
  const destination = places.find((place) => place.id === leg.data.destinationPlaceId);
  const originRef = origin?.externalRefs?.[0];
  const destinationRef = destination?.externalRefs?.[0];
  assert.ok(originRef && destinationRef && leg.data.scheduledDeparture, 'leg must carry refs and schedule');
  return {
    origin: { system: originRef.system, value: originRef.value },
    destination: { system: destinationRef.system, value: destinationRef.value },
    departureDate: leg.data.scheduledDeparture.value.slice(0, 10),
    passengers: { adults: 1 },
  };
}

/** Overlay operations replacing the cancelled leg with a candidate offer. */
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

function roundOutputs(leg: TransportLeg, places: Place[], sourceId: string) {
  const round1 = {
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.search',
        parameters: searchParametersFor(leg, places),
        purpose: 'find replacement flights for the cancelled leg',
      },
    ],
    assumptions: ['replacement flights exist on the same route'],
    uncertainties: [{ statement: 'replacement options not yet known', severity: 'HIGH' }],
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
        assumptions: ['next-morning fare holds until booking'],
        uncertainties: [],
        expectedOutcomes: ['cancelled leg replaced with a cheaper morning flight'],
        costImpact: { amount: 162.1, currency: 'USD' },
      },
      {
        summary: 'Rebook on the same-day evening replacement',
        candidateOperations: replacementOperations(
          leg,
          { departure: '2026-09-13T18:25:00+09:00', arrival: '2026-09-13T20:55:00+09:00', offerId: EVENING_OFFER_ID },
          sourceId,
        ),
        assumptions: ['evening fare holds until booking'],
        uncertainties: [],
        expectedOutcomes: ['cancelled leg replaced the same evening'],
        costImpact: { amount: 242.6, currency: 'USD' },
      },
      {
        summary: 'Rebook on the same-day afternoon replacement',
        candidateOperations: replacementOperations(
          leg,
          { departure: '2026-09-13T14:05:00+09:00', arrival: '2026-09-13T16:40:00+09:00', offerId: AFTERNOON_OFFER_ID },
          sourceId,
        ),
        assumptions: ['afternoon fare holds until booking'],
        uncertainties: [],
        expectedOutcomes: ['cancelled leg replaced the same afternoon'],
        costImpact: { amount: 416.9, currency: 'USD' },
      },
    ],
    toolRequests: [],
    assumptions: ['the anchor engagement schedule is fixed'],
    uncertainties: [],
    rationale: 'three materially different replacement options',
  };
  return { round1, round2 };
}

/** Run the real I3 planning loop and return its strategies. */
async function planRecovery(harness: Harness, setup: Awaited<ReturnType<typeof setupDisruptedTrip>>) {
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: RECORDING_READ_DIRS }),
    timezoneResolver: await buildTimezoneResolver(harness.entities)(),
  });
  const { round1, round2 } = roundOutputs(
    setup.cancelledLeg,
    setup.snapshot.places,
    setup.spec.disruption.signal.sourceId,
  );
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

function spyingExecutor(inner: ExecutorService): { executor: ExecutorService; calls: () => number } {
  let count = 0;
  return {
    executor: {
      execute: async (execution) => {
        count += 1;
        return inner.execute(execution);
      },
    },
    calls: () => count,
  };
}

function createService(harness: Harness, strategies: RecoveryStrategy[], inner: ExecutorService) {
  const spy = spyingExecutor(
    createRecoveryExecutor({
      inner,
      strategyFor: (intent) => strategies.find((strategy) => strategy.id === intent.strategyId),
    }),
  );
  const deps: RecoveryExecutionDependencies = {
    cases: harness.cases,
    audit: harness.audit,
    authority: new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(harness.entities) }),
    executor: spy.executor,
    observation: new DeterministicObservationService({ mutations: harness.mutations }),
    verifier: new CaseVerifier({ trips: harness.trips, signals: harness.signals, entities: harness.entities }),
  };
  return { service: new RecoveryExecutionService(deps), calls: spy.calls };
}

/** Direct strategy for focused lifecycle tests (no planner involved). */
function directStrategy(caseId: string, leg: TransportLeg, sourceId: string, cost: number): RecoveryStrategy {
  return {
    id: 'strat-evening-direct',
    caseId,
    summary: 'Rebook on the same-day evening replacement',
    candidateOperations: replacementOperations(
      leg,
      { departure: '2026-09-13T18:25:00+09:00', arrival: '2026-09-13T20:55:00+09:00', offerId: EVENING_OFFER_ID },
      sourceId,
    ),
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: ['cancelled leg replaced the same evening'],
    costImpact: { amount: cost, currency: 'USD' },
    createdAt: PLANNING_AT,
  };
}

async function moveToPlanning(harness: Harness, caseId: string) {
  const caseService = new CaseService({ cases: harness.cases });
  await caseService.transition(caseId, 'PLANNING', PLANNING_AT);
}

test('i4: Scenario A loop — traveller approval -> simulated flight.change -> observed mutation -> FULLY_RECOVERED', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const planning = await planRecovery(harness, setup);
  const strategy = planning.strategies.find((candidate) => candidate.id === planning.bestStrategyId);
  assert.ok(strategy, 'planning must rank a best feasible strategy');

  const { service, calls } = createService(harness, planning.strategies, new BoundaryExecutor());
  const caseId = setup.signalResult.caseId;

  // Deterministic strategy -> intent -> authority. Fixture expectation:
  // fare delta under the organiser threshold, traveller confirmation gates it.
  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });
  assert.equal(begin.decision.outcome, setup.spec.expectations.authority.expectedOutcome);
  assert.equal(begin.intent.operation, setup.spec.expectations.recovery.actionOperation);
  assert.equal(begin.intent.sideEffectLevel, 'MONEY_MOVING');
  assert.deepEqual(begin.intent.priceDelta, strategy.costImpact);
  assert.equal(begin.executable, false);
  assert.equal(begin.caseStatus, 'AWAITING_TRAVELLER');

  // Traveller approval enters through the real authority system.
  const travellerId = setup.spec.context.travellers[0]!.id;
  const approval = await service.recordApproval({
    caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: travellerId },
    decidedAt: APPROVAL_AT,
    verdict: 'APPROVED',
  });
  assert.equal(approval.accepted, true);
  assert.equal(approval.caseStatus, 'READY_TO_EXECUTE');

  // Execution: gate-checked, simulated at the provider boundary only.
  const executed = await service.executeApproved({ caseId, intentId: begin.intent.id, at: EXECUTE_AT });
  assert.equal(executed.executed, true);
  assert.deepEqual(executed.gateIssues, []);
  assert.ok(executed.result, 'authorised execution must produce a result');
  assert.equal(executed.result.status, 'SUCCESS');
  assert.equal(executed.result.provenance, 'SIMULATED');
  assert.match(executed.result.resultSummary ?? '', /simulated flight\.change at provider boundary/);
  assert.equal(calls(), 1);

  // Observation applied validated mutations; the verifier resolved the case.
  assert.ok(executed.observation && executed.observation.stateUpdated, 'observed effects must mutate validated state');
  assert.ok(executed.verification, 'state update must trigger deterministic re-evaluation');
  assert.equal(executed.verification.resolution?.outcome, setup.spec.expectations.recovery.expectedResolution);
  assert.deepEqual(executed.verification.resolution?.remainingLossRefs, []);
  assert.equal(executed.caseStatus, 'RESOLVED');

  // Authoritative state now carries the confirmed replacement.
  const recovered = (await harness.trips.getTrip(setup.spec.trip.id))!;
  const leg = recovered.elements.find((element) => element.id === setup.cancelledLeg.id);
  assert.ok(leg && leg.elementKind === 'TRANSPORT_LEG', 'recovered leg must exist');
  assert.equal(leg.reservationState, 'CONFIRMED');
  assert.equal(leg.data.bookingRef?.reference, EVENING_OFFER_ID);
  assert.equal(leg.data.scheduledDeparture?.authority, 'AUTHORITATIVE');
  assert.equal(leg.data.scheduledDeparture?.value, '2026-09-13T18:25:00+09:00');

  // Persisted case evidence: intent, authority, approval, execution, resolution.
  const recoveryCase = (await harness.cases.getCase(caseId))!;
  assert.equal(recoveryCase.status, 'RESOLVED');
  assert.equal(recoveryCase.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(recoveryCase.actionIntents.length, 1);
  assert.equal(recoveryCase.actionIntents[0]!.status, 'EXECUTED');
  assert.equal(recoveryCase.authorityDecisions[0]!.approval?.decision, 'APPROVED');
  assert.equal(recoveryCase.executionResults.length, 1);
  assert.equal(recoveryCase.executionResults[0]!.provenance, 'SIMULATED');

  // Audit chain: authority -> approval -> execution -> verification.
  const actions = (await harness.audit.query({ subject: setup.spec.trip.id })).map((entry) => entry.action);
  for (const expected of ['AUTHORITY_DECIDED', 'APPROVAL_RECORDED', 'EXECUTION_COMPLETED', 'CASE_VERIFIED']) {
    assert.ok(actions.includes(expected), `audit trail must include ${expected}`);
  }
  const executionAudit = (await harness.audit.query({ action: 'EXECUTION_COMPLETED' }))[0]!;
  assert.equal(executionAudit.payload['simulated'], true, 'simulated execution must be labelled honestly');
});

test('i4: fare delta above threshold routes to organisation approval', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const planning = await planRecovery(harness, setup);
  const afternoon = planning.strategies.find((candidate) => candidate.summary.includes('afternoon'));
  assert.ok(afternoon, 'planner must offer the afternoon strategy');

  const { service } = createService(harness, planning.strategies, new BoundaryExecutor());
  const caseId = setup.signalResult.caseId;

  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy: afternoon, at: BEGIN_AT });
  assert.equal(begin.decision.outcome, 'REQUIRES_ORGANISATION_APPROVER');
  assert.equal(begin.caseStatus, 'AWAITING_APPROVAL');
  assert.ok(
    begin.decision.ruleTrace.some((entry) => entry.includes('rule_a_approval_threshold')),
    'rule trace must cite the approval threshold rule',
  );

  // A traveller cannot satisfy an organisation approval requirement.
  const travellerId = setup.spec.context.travellers[0]!.id;
  const wrongPrincipal = await service.recordApproval({
    caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: travellerId },
    decidedAt: APPROVAL_AT,
    verdict: 'APPROVED',
  });
  assert.equal(wrongPrincipal.accepted, false);
  assert.match(wrongPrincipal.reason ?? '', /cannot approve/);

  // The organisation principal can; the loop then completes to recovery.
  const organisationId = setup.spec.context.organisations[0]!.id;
  const approval = await service.recordApproval({
    caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'ORGANISATION', id: organisationId },
    decidedAt: APPROVAL_AT,
    verdict: 'APPROVED',
  });
  assert.equal(approval.caseStatus, 'READY_TO_EXECUTE');

  const executed = await service.executeApproved({ caseId, intentId: begin.intent.id, at: EXECUTE_AT });
  assert.equal(executed.caseStatus, 'RESOLVED');
  assert.equal(executed.verification?.resolution?.outcome, 'FULLY_RECOVERED');
  const leg = (await harness.trips.getTrip(setup.spec.trip.id))!.elements.find(
    (element) => element.id === setup.cancelledLeg.id,
  );
  assert.ok(leg && leg.elementKind === 'TRANSPORT_LEG');
  assert.equal(leg.data.bookingRef?.reference, AFTERNOON_OFFER_ID);
});

test('i4: declined traveller approval loops back to planning without execution', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const caseId = setup.signalResult.caseId;
  await moveToPlanning(harness, caseId);
  const strategy = directStrategy(caseId, setup.cancelledLeg, setup.spec.disruption.signal.sourceId, 242.6);

  const { service, calls } = createService(harness, [strategy], new BoundaryExecutor());
  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });
  assert.equal(begin.caseStatus, 'AWAITING_TRAVELLER');

  const travellerId = setup.spec.context.travellers[0]!.id;
  const declined = await service.recordApproval({
    caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: travellerId },
    decidedAt: APPROVAL_AT,
    verdict: 'DECLINED',
    note: 'traveller prefers other options',
  });
  assert.equal(declined.accepted, true);
  assert.equal(declined.caseStatus, 'PLANNING');
  assert.equal(calls(), 0, 'declined authority must never reach the executor');

  const recoveryCase = (await harness.cases.getCase(caseId))!;
  assert.equal(recoveryCase.actionIntents[0]!.status, 'REJECTED');
  assert.equal(recoveryCase.authorityDecisions[0]!.approval?.decision, 'DECLINED');

  // The leg is untouched: no false recovery from a declined approval.
  const leg = (await harness.trips.getTrip(setup.spec.trip.id))!.elements.find(
    (element) => element.id === setup.cancelledLeg.id,
  );
  assert.ok(leg && leg.elementKind === 'TRANSPORT_LEG');
  assert.equal(leg.reservationState, 'CANCELLED');
});

test('i4: forged AUTHORISED intent is refused before any executor call', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const caseId = setup.signalResult.caseId;
  await moveToPlanning(harness, caseId);
  const strategy = directStrategy(caseId, setup.cancelledLeg, setup.spec.disruption.signal.sourceId, 242.6);

  const { service, calls } = createService(harness, [strategy], new BoundaryExecutor());
  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });

  // Forgery 1: intent stamped AUTHORISED by an arbitrary caller, paired with
  // a decision that has no recorded approval.
  const forgedIntent = { ...begin.intent, status: 'AUTHORISED' as const };
  const noApproval = await service.executeEnvelope(
    { intent: forgedIntent, authority: begin.decision },
    setup.spec.trip.id,
    EXECUTE_AT,
  );
  assert.equal(noApproval.executed, false);
  assert.ok(noApproval.gateIssues.length > 0, 'gate must report the missing approval');
  assert.ok(noApproval.gateIssues.some((issue) => issue.includes('requires a recorded approval')));

  // Forgery 2: authority decision referencing a different intent.
  const mismatched = await service.executeEnvelope(
    { intent: forgedIntent, authority: { ...begin.decision, intentId: 'intent-other' } },
    setup.spec.trip.id,
    EXECUTE_AT,
  );
  assert.equal(mismatched.executed, false);
  assert.ok(mismatched.gateIssues.some((issue) => issue.includes('does not reference intent')));

  assert.equal(calls(), 0, 'refused envelopes must never reach the executor');
  const recoveryCase = (await harness.cases.getCase(caseId))!;
  assert.equal(recoveryCase.status, 'AWAITING_TRAVELLER', 'refusal must not advance the case lifecycle');
  const refused = await harness.audit.query({ action: 'EXECUTION_REFUSED' });
  assert.equal(refused.length, 2);
});

test('i4: spend ceiling blocks the strategy and escalates the case', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const caseId = setup.signalResult.caseId;
  await moveToPlanning(harness, caseId);
  const strategy = directStrategy(caseId, setup.cancelledLeg, setup.spec.disruption.signal.sourceId, 2000);

  const { service, calls } = createService(harness, [strategy], new BoundaryExecutor());
  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });
  assert.equal(begin.decision.outcome, 'BLOCKED');
  assert.equal(begin.caseStatus, 'ESCALATED');
  assert.equal(begin.executable, false);
  assert.ok(begin.decision.ruleTrace.some((entry) => entry.includes('rule_a_spend_limit')));
  assert.equal(calls(), 0);
});

test('i4: failed execution produces no false recovery', async () => {
  const harness = createHarness();
  const setup = await setupDisruptedTrip(harness);
  const caseId = setup.signalResult.caseId;
  await moveToPlanning(harness, caseId);
  const strategy = directStrategy(caseId, setup.cancelledLeg, setup.spec.disruption.signal.sourceId, 242.6);

  const failingExecutor: ExecutorService = {
    execute: async (execution) => ({
      id: `exec-${execution.intent.id}-failed`,
      intentId: execution.intent.id,
      executedAt: execution.intent.createdAt,
      status: 'FAILURE',
      provenance: 'SIMULATED',
      resultSummary: 'provider rejected the change',
      error: { code: 'PROVIDER_REJECTED', message: 'fare no longer available', retryable: false },
    }),
  };
  const { service } = createService(harness, [strategy], failingExecutor);
  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });
  await service.recordApproval({
    caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: setup.spec.context.travellers[0]!.id },
    decidedAt: APPROVAL_AT,
    verdict: 'APPROVED',
  });

  const executed = await service.executeApproved({ caseId, intentId: begin.intent.id, at: EXECUTE_AT });
  assert.equal(executed.executed, true);
  assert.equal(executed.result?.status, 'FAILURE');
  assert.ok(executed.observation && !executed.observation.stateUpdated, 'failure must not mutate state');
  assert.equal(executed.verification, undefined, 'no state change means no resolution verdict');
  assert.equal(executed.caseStatus, 'ASSESSING', 'failed execution loops back for reassessment');

  const recoveryCase = (await harness.cases.getCase(caseId))!;
  assert.equal(recoveryCase.resolution, undefined);
  assert.equal(recoveryCase.actionIntents[0]!.status, 'FAILED');
  const leg = (await harness.trips.getTrip(setup.spec.trip.id))!.elements.find(
    (element) => element.id === setup.cancelledLeg.id,
  );
  assert.ok(leg && leg.elementKind === 'TRANSPORT_LEG');
  assert.equal(leg.reservationState, 'CANCELLED', 'failed execution must leave the trip disrupted');
});

test('i4: case, intents, execution results and resolution survive restart', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-i4-'));
  const dbPath = join(dbDir, 'app.sqlite');

  const first = createHarness(dbPath);
  const setup = await setupDisruptedTrip(first);
  const caseId = setup.signalResult.caseId;
  await moveToPlanning(first, caseId);
  const strategy = directStrategy(caseId, setup.cancelledLeg, setup.spec.disruption.signal.sourceId, 242.6);
  const { service } = createService(first, [strategy], new BoundaryExecutor());
  const begin = await service.beginStrategy({ snapshot: setup.snapshot, caseId, strategy, at: BEGIN_AT });
  await service.recordApproval({
    caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: setup.spec.context.travellers[0]!.id },
    decidedAt: APPROVAL_AT,
    verdict: 'APPROVED',
  });
  const executed = await service.executeApproved({ caseId, intentId: begin.intent.id, at: EXECUTE_AT });
  assert.equal(executed.caseStatus, 'RESOLVED');
  first.db.close();

  // Fresh process: everything must rebuild from SQLite.
  const second = createHarness(dbPath);
  const reloadedCase = (await second.cases.getCase(caseId))!;
  assert.equal(reloadedCase.status, 'RESOLVED');
  assert.equal(reloadedCase.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(reloadedCase.actionIntents[0]!.status, 'EXECUTED');
  assert.equal(reloadedCase.authorityDecisions[0]!.approval?.decidedBy.id, setup.spec.context.travellers[0]!.id);
  assert.equal(reloadedCase.executionResults[0]!.provenance, 'SIMULATED');

  const leg = (await second.trips.getTrip(setup.spec.trip.id))!.elements.find(
    (element) => element.id === setup.cancelledLeg.id,
  );
  assert.ok(leg && leg.elementKind === 'TRANSPORT_LEG');
  assert.equal(leg.reservationState, 'CONFIRMED');
  assert.equal(leg.data.bookingRef?.reference, EVENING_OFFER_ID);

  const verified = await second.audit.query({ action: 'CASE_VERIFIED' });
  assert.equal(verified.length, 1);
  second.db.close();
});
