/**
 * I3 evidence — planner -> read-only capabilities -> overlays -> deterministic
 * viability.
 *
 * Proves: the planning loop dispatches only the frozen read-only tool
 * vocabulary against Atlas REPLAY recordings (shared normalizer, honest
 * airport-local schedule conversion via the app-supplied timezone resolver);
 * an attractive cheap candidate is rejected by the deterministic viability
 * engine with engine-owned reasons; UNKNOWN hard feasibility never becomes
 * PASS; feasible candidates rank deterministically; planner failure degrades
 * to structured uncertainty instead of a crash; missing recordings and
 * missing timezone context surface as structured failures; and the loop never
 * mutates authoritative state.
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
import { loadScenario } from '../src/scenarios/loader.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import {
  ModelStudioClient,
  ModelTransportError,
  ScriptedModelTransport,
} from '../src/intelligence/client.ts';
import { ModelStudioRecoveryPlanner } from '../src/intelligence/planner.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { Place } from '../src/domain/entities.ts';
import type { IsoDateTime } from '../src/domain/common.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { ToolRequest } from '../src/operational/strategy.ts';
import { ToolRequestSchema } from '../src/operational/strategy.ts';
import {
  buildTimezoneResolver,
  buildTripSnapshot,
  dispatchToolRequest,
  processSignal,
  runPlanningLoop,
  seedScenarioBundle,
  SqlitePreferenceStore,
  type PlanningLoopDependencies,
  type PlanningOutcome,
} from '../src/app/index.ts';

const FIXTURES_ROOT = resolve('fixtures/scenarios');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'anchor-event-speaker');
/** Scenario-bundle demo recordings first; Lane C curated evidence as fallback. */
const RECORDING_READ_DIRS = [join(SCENARIO_A_DIR, 'recordings'), resolve('fixtures/recordings')];
const PLANNING_AT = '2026-09-12T20:00:00+09:00';

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

/** Seed Scenario A, apply the disruption, and wire the I3 planning loop. */
async function setupPlanning(harness: Harness, recordingReadDirs: ReadonlyArray<string> = RECORDING_READ_DIRS) {
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);
  const signalResult = await processSignal(harness.pipelineDeps, spec.disruption.signal);

  const snapshot = await buildTripSnapshot(
    { trips: harness.trips, entities: harness.entities, preferences: harness.preferences, sources: harness.sources },
    spec.trip.id,
    PLANNING_AT,
  );

  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: recordingReadDirs }),
    timezoneResolver: await buildTimezoneResolver(harness.entities)(),
  });

  const disruptedTrip = (await harness.trips.getTrip(spec.trip.id))!;
  const cancelledLeg = disruptedTrip.elements.find(
    (element) => element.elementKind === 'TRANSPORT_LEG' && element.reservationState === 'CANCELLED',
  );
  assert.ok(cancelledLeg && cancelledLeg.elementKind === 'TRANSPORT_LEG', 'disruption must cancel the outbound leg');

  const deps: PlanningLoopDependencies = {
    planner: undefined as never, // filled per test with a scripted planner
    capabilities: { flight: adapter },
    viability: new OverlayViabilityEngine(),
    cases: harness.cases,
    audit: harness.audit,
  };

  return { spec, signalResult, snapshot, adapter, cancelledLeg: cancelledLeg as TransportLeg, deps };
}

function scriptedPlanner(responses: Array<string | ModelTransportError>) {
  const transport = new ScriptedModelTransport(responses);
  const client = new ModelStudioClient({ transport });
  let sequence = 0;
  return new ModelStudioRecoveryPlanner({
    client,
    idFactory: (prefix) => `${prefix}-i3-${String(++sequence).padStart(3, '0')}`,
    now: () => PLANNING_AT,
  });
}

/** Search parameters derived from the cancelled leg's persisted places. */
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

/** Replacement without any schedule evidence: hard feasibility stays UNKNOWN. */
function unscheduledReplacementOperations(base: TransportLeg, offerId: string): MutationOperation[] {
  return [
    {
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP_ELEMENT',
      data: {
        ...base,
        reservationState: 'HELD',
        status: 'UNKNOWN',
        data: {
          mode: base.data.mode,
          originPlaceId: base.data.originPlaceId,
          destinationPlaceId: base.data.destinationPlaceId,
          bookingRef: { system: 'atlas', reference: offerId },
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
        uncertainties: ['arrives the day after the original itinerary'],
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
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.verify',
        parameters: { offerId: EVENING_OFFER_ID },
        purpose: 'confirm the evening offer is still bookable at the quoted price',
      },
      {
        capability: 'FLIGHT',
        operation: 'flight.fare_rules',
        parameters: { offerId: EVENING_OFFER_ID },
        purpose: 'confirm change/refund rules for the evening offer',
      },
    ],
    assumptions: ['the anchor engagement schedule is fixed'],
    uncertainties: [],
    rationale: 'three materially different replacement options; the evening offer is verified before ranking',
  };
  return { round1, round2 };
}

test('i3: planning loop replays Atlas evidence and rejects the attractive infeasible candidate', async () => {
  const harness = createHarness();
  const setup = await setupPlanning(harness);
  const { round1, round2 } = roundOutputs(setup.cancelledLeg, setup.snapshot.places, setup.spec.disruption.signal.sourceId);
  setup.deps.planner = scriptedPlanner([JSON.stringify(round1), JSON.stringify(round2)]);

  const outcome = await runPlanningLoop(setup.deps, {
    caseId: setup.signalResult.caseId,
    snapshot: setup.snapshot,
    triggeringSignals: [setup.spec.disruption.signal],
    impact: setup.signalResult.assessment,
    capabilityRegistry: [setup.adapter.descriptor],
    planningAt: PLANNING_AT,
  });

  // Two planner rounds; three distinct read-only tool dispatches.
  assert.equal(outcome.rounds, 2);
  assert.deepEqual(
    outcome.toolActivity.map((activity) => activity.request.operation),
    ['flight.search', 'flight.verify', 'flight.fare_rules'],
  );

  // Atlas REPLAY through the shared normalizer, recording id surfaced.
  const search = outcome.toolActivity[0]!;
  assert.equal(search.result.ok, true);
  if (search.result.ok) {
    assert.equal(search.result.mode, 'REPLAY');
    assert.ok(search.result.recordingId, 'replay must cite its recording');
  }
  const offers = (search.result.ok ? (search.result.data['offers'] as Array<Record<string, unknown>>) : []) ?? [];
  assert.equal(offers.length, 3);
  const firstSegment = ((offers[0]!['segments'] as Array<Record<string, unknown>>)[0]!) as Record<string, unknown>;
  assert.ok(
    String(firstSegment['departure']).endsWith('+09:00'),
    'airport-local Atlas schedules must normalize with the place-derived timezone, never a fabricated Z',
  );

  // Verify + fare rules reached the recorded offer honestly.
  const verify = outcome.toolActivity[1]!;
  assert.equal(verify.result.ok, true);
  if (verify.result.ok) assert.equal(verify.result.data['status'], 'VERIFIED');
  const fareRules = outcome.toolActivity[2]!;
  assert.equal(fareRules.result.ok, true);
  if (fareRules.result.ok) {
    const change = fareRules.result.data['change'] as { allowed: boolean; fee?: { amount: number } };
    assert.equal(change.allowed, true);
    assert.equal(change.fee?.amount, 50);
  }

  // Deterministic viability: cheap morning option FAILS the hard buffer.
  assert.equal(outcome.candidates.length, 3);
  const morning = outcome.candidates.find((c) => c.strategy.summary.includes('next-morning'))!;
  assert.equal(morning.feasible, false);
  assert.ok(
    morning.rejectionEvidence.some((evidence) => evidence.kind === 'CONSTRAINT' && evidence.constraintId === 'c_a_arrive_before_keynote' && evidence.status === 'FAIL'),
    `engine-owned rejection evidence expected, got: ${JSON.stringify(morning.rejectionEvidence)}`,
  );
  assert.equal(
    outcome.rankedFeasibleIds.includes(morning.strategy.id),
    false,
    'hard-infeasible candidates can never win',
  );

  // Feasible candidates rank deterministically: cheaper evening offer first.
  const evening = outcome.candidates.find((c) => c.strategy.summary.includes('evening'))!;
  const afternoon = outcome.candidates.find((c) => c.strategy.summary.includes('afternoon'))!;
  assert.equal(evening.feasible, true);
  assert.equal(afternoon.feasible, true);
  assert.deepEqual(outcome.rankedFeasibleIds, [evening.strategy.id, afternoon.strategy.id]);
  assert.equal(outcome.bestStrategyId, evening.strategy.id);

  // Case lifecycle + persisted strategy evidence + audit trail.
  const recoveryCase = await harness.cases.getCase(setup.signalResult.caseId);
  assert.equal(recoveryCase!.status, 'PLANNING');
  assert.deepEqual(recoveryCase!.strategies, outcome.strategies);
  const planningAudit = await harness.audit.query({ action: 'PLANNING_COMPLETED', subject: setup.spec.trip.id });
  assert.equal(planningAudit.length, 1);
  assert.equal(planningAudit[0]!.payload['strategyCount'], 3);
  assert.equal(planningAudit[0]!.payload['feasibleCount'], 2);
  assert.equal(planningAudit[0]!.payload['bestStrategyId'], evening.strategy.id);

  // The loop is read-only: authoritative state is untouched.
  const trip = (await harness.trips.getTrip(setup.spec.trip.id))!;
  const leg = trip.elements.find((e) => e.id === setup.cancelledLeg.id)!;
  assert.equal(leg.reservationState, 'CANCELLED');
  assert.equal(trip.viability, 'DISRUPTED');
});

test('i3: consequential operations are unrepresentable and malformed parameters fail structured', async () => {
  const harness = createHarness();
  const setup = await setupPlanning(harness);

  // The frozen vocabulary makes consequential requests unparseable...
  const consequential = {
    id: 'tool-i3-consequential',
    capability: 'FLIGHT',
    operation: 'flight.change',
    parameters: { offerId: EVENING_OFFER_ID },
    purpose: 'attempt a money-moving operation',
  };
  assert.equal(
    ToolRequestSchema.safeParse(consequential).success,
    false,
    'consequential operations must be unrepresentable in the frozen schema',
  );
  const asRequest = consequential as unknown as ToolRequest;
  const refused = await dispatchToolRequest({ flight: setup.adapter }, asRequest);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, 'operation_not_read_only');

  // ...and malformed read-only parameters become structured INVALID_REQUEST.
  const malformed: ToolRequest = {
    id: 'tool-i3-malformed',
    capability: 'FLIGHT',
    operation: 'flight.search',
    parameters: { departureDate: 'not-a-date' },
    purpose: 'missing route parameters',
  };
  const invalid = await dispatchToolRequest({ flight: setup.adapter }, malformed);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'invalid_tool_parameters');

  // Unwired families stay honest UNAVAILABLE data.
  const hotelContext: ToolRequest = {
    id: 'tool-i3-hotel',
    capability: 'HOTEL',
    operation: 'hotel.context',
    parameters: { stayElementId: 'el_a_hotel' },
    purpose: 'stay context',
  };
  const absent = await dispatchToolRequest({}, hotelContext);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.error.code, 'capability_not_wired');
});

test('i3: UNKNOWN hard feasibility never becomes PASS', async () => {
  const harness = createHarness();
  const setup = await setupPlanning(harness);
  const unscheduled = {
    strategies: [
      {
        summary: 'Rebook on an unscheduled placeholder',
        candidateOperations: unscheduledReplacementOperations(setup.cancelledLeg, MORNING_OFFER_ID),
        assumptions: [],
        uncertainties: ['no concrete schedule for this placeholder'],
        expectedOutcomes: [],
      },
    ],
    assumptions: [],
    uncertainties: [],
  };
  setup.deps.planner = scriptedPlanner([JSON.stringify(unscheduled)]);

  const outcome = await runPlanningLoop(setup.deps, {
    caseId: setup.signalResult.caseId,
    snapshot: setup.snapshot,
    triggeringSignals: [setup.spec.disruption.signal],
    impact: setup.signalResult.assessment,
    capabilityRegistry: [setup.adapter.descriptor],
    planningAt: PLANNING_AT,
  });

  assert.equal(outcome.candidates.length, 1);
  const candidate = outcome.candidates[0]!;
  assert.equal(candidate.feasible, false);
  assert.ok(candidate.viability, 'overlay evaluation must still run');
  assert.ok(candidate.viability!.unknownIds.includes('c_a_arrive_before_keynote'));
  assert.ok(candidate.viability!.unknownIds.includes('c_a_hotel_no_show'));
  assert.equal(candidate.viability!.hardFailureIds.length, 0);
  assert.ok(
    candidate.rejectionEvidence.some((evidence) => evidence.kind === 'CONSTRAINT' && evidence.status === 'UNKNOWN'),
    `UNKNOWN rejection evidence expected, got: ${JSON.stringify(candidate.rejectionEvidence)}`,
  );
  assert.equal(outcome.bestStrategyId, undefined, 'no feasible candidate may be selected');
});

test('i3: planner unavailability degrades to structured uncertainty, not a crash', async () => {
  const harness = createHarness();
  const setup = await setupPlanning(harness);
  setup.deps.planner = scriptedPlanner([
    new ModelTransportError('UNAVAILABLE', 'model_unavailable', 'model endpoint unreachable', true),
  ]);

  const outcome = await runPlanningLoop(setup.deps, {
    caseId: setup.signalResult.caseId,
    snapshot: setup.snapshot,
    triggeringSignals: [setup.spec.disruption.signal],
    impact: setup.signalResult.assessment,
    capabilityRegistry: [setup.adapter.descriptor],
    planningAt: PLANNING_AT,
  });

  assert.equal(outcome.strategies.length, 0);
  assert.equal(outcome.toolActivity.length, 0);
  assert.ok(
    outcome.uncertainties.some((u) => u.severity === 'HIGH' && /planner unavailable/.test(u.statement)),
    'degraded plan must keep the failure visible as uncertainty',
  );
  const recoveryCase = await harness.cases.getCase(setup.signalResult.caseId);
  assert.equal(recoveryCase!.status, 'PLANNING');
  assert.equal(recoveryCase!.strategies.length, 0);
});

test('i3: missing replay recording is structured capability failure, not a crash', async () => {
  const emptyStore = mkdtempSync(join(tmpdir(), 'atlas-i3-norec-'));
  const harness = createHarness();
  const setup = await setupPlanning(harness, [emptyStore]);
  const { round1 } = roundOutputs(setup.cancelledLeg, setup.snapshot.places, setup.spec.disruption.signal.sourceId);
  setup.deps.planner = scriptedPlanner([JSON.stringify(round1), JSON.stringify({ strategies: [], toolRequests: [] })]);

  const outcome = await runPlanningLoop(setup.deps, {
    caseId: setup.signalResult.caseId,
    snapshot: setup.snapshot,
    triggeringSignals: [setup.spec.disruption.signal],
    impact: setup.signalResult.assessment,
    capabilityRegistry: [setup.adapter.descriptor],
    planningAt: PLANNING_AT,
  });

  const search = outcome.toolActivity[0]!;
  assert.equal(search.result.ok, false);
  if (!search.result.ok) {
    assert.equal(search.result.error.category, 'UNAVAILABLE');
    assert.equal(search.result.error.code, 'recording_not_found');
  }
  assert.match(search.summary, /flight\.search failed: UNAVAILABLE\/recording_not_found/);
});

test('i3: normalization refuses to fabricate offsets without timezone context (ADR-028)', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(harness.seedDeps, SCENARIO_A_DIR);
  await processSignal(harness.pipelineDeps, spec.disruption.signal);

  // Same REPLAY store but no resolver: normalization must fail honestly.
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: RECORDING_READ_DIRS }),
  });
  const request: ToolRequest = {
    id: 'tool-i3-notz',
    capability: 'FLIGHT',
    operation: 'flight.search',
    parameters: {
      origin: { system: 'iata', value: 'ICN' },
      destination: { system: 'iata', value: 'NRT' },
      departureDate: '2026-09-13',
      passengers: { adults: 1 },
    },
    purpose: 'search without timezone context',
  };
  const result = await dispatchToolRequest({ flight: adapter }, request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'invalid_raw_response');
    assert.match(result.error.message, /timezone/);
  }
});

test('i3: identical inputs produce identical planning outcomes (determinism)', async () => {
  const runs: PlanningOutcome[] = [];
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const harness = createHarness();
    const setup = await setupPlanning(harness);
    const { round1, round2 } = roundOutputs(
      setup.cancelledLeg,
      setup.snapshot.places,
      setup.spec.disruption.signal.sourceId,
    );
    setup.deps.planner = scriptedPlanner([JSON.stringify(round1), JSON.stringify(round2)]);
    runs.push(
      await runPlanningLoop(setup.deps, {
        caseId: setup.signalResult.caseId,
        snapshot: setup.snapshot,
        triggeringSignals: [setup.spec.disruption.signal],
        impact: setup.signalResult.assessment,
        capabilityRegistry: [setup.adapter.descriptor],
        planningAt: PLANNING_AT,
      }),
    );
  }

  // Tool results carry wall-clock meta (requestedAt/latencyMs); strip it.
  const comparable = (outcome: PlanningOutcome) => ({
    rounds: outcome.rounds,
    strategies: outcome.strategies,
    candidates: outcome.candidates,
    rankedFeasibleIds: outcome.rankedFeasibleIds,
    bestStrategyId: outcome.bestStrategyId,
    assumptions: outcome.assumptions,
    uncertainties: outcome.uncertainties,
    rationale: outcome.rationale,
    toolActivity: outcome.toolActivity.map((activity) => ({
      operation: activity.request.operation,
      parameters: activity.request.parameters,
      summary: activity.summary,
      data: activity.result.ok ? activity.result.data : activity.result.error,
    })),
  });
  assert.deepEqual(comparable(runs[1]!), comparable(runs[0]!));
});
