/**
 * G2 — four robustness cases through the real engine.
 *
 * Every case runs the genuine vertical stack (validated mutation ->
 * deterministic impact -> planning loop with overlay viability -> authority ->
 * gate-checked execution -> observation -> post-execution verification). No
 * evaluator, case-lifecycle or authority path is stubbed; the planner is the
 * standard scripted Model Studio planner, and capability evidence in case 1
 * comes from the shared-normalizer REPLAY path.
 *
 *  1. Late arrival vs hotel no-show — a delay signal pushes the arrival chain
 *     past the hotel's supplier no-show cutoff (HARD SUPPLIER constraint);
 *     the engine rejects the otherwise-attractive next-morning replacement
 *     and recovers on the same-day evening service.
 *  2. Public transport cutoff — a delayed flight misses the booked
 *     public-transit connection (HARD TRANSFER constraint); a flexible
 *     on-demand taxi recovery is feasible and outranks the later scheduled
 *     service.
 *  3. Accessibility invalidates the cheaper alternative — a HARD
 *     ACCESSIBILITY requirement fails the cheap replacement outright; the
 *     more expensive accessible option wins and verification re-checks the
 *     hard requirement with the full post-execution context.
 *  4. Already-lost objective — the disruption lands after an objective's
 *     moment has passed, impact records an irreversible loss (CRITICAL), and
 *     the recovery still repairs the remainder while the lost objective is
 *     explicitly waived: RECOVERED_WITH_LOSS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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
import type { TransportLeg, TripElement } from '../src/domain/elements.ts';
import type { IsoDateTime } from '../src/domain/common.ts';
import type { FlightOffer } from '../src/contracts/capabilities.ts';
import type { MutationOperation, MutationProposal } from '../src/operational/mutation.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { TripSignal } from '../src/operational/signal.ts';
import {
  buildTimezoneResolver,
  buildTripSnapshot,
  createRecoveryExecutor,
  processSignal,
  RecoveryExecutionService,
  runPlanningLoop,
  seedScenarioBundle,
  SqlitePreferenceStore,
  type RecoveryExecutionDependencies,
  type SnapshotDependencies,
} from '../src/app/index.ts';

const SCENARIO_A_DIR = join(resolve('fixtures/scenarios'), 'anchor-event-speaker');
const RECORDING_READ_DIRS = [join(SCENARIO_A_DIR, 'recordings'), resolve('fixtures/recordings')];

const MORNING_OFFER_ID = 'ATLSBX-20260914-KE711-E7';
const EVENING_OFFER_ID = 'ATLSBX-20260913-OZ104-E3';
const AFTERNOON_OFFER_ID = 'ATLSBX-20260913-KE705-B1';

function createHarness() {
  const db = openDatabase(':memory:');
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

function snapshotDeps(harness: Harness): SnapshotDependencies {
  return { trips: harness.trips, entities: harness.entities, preferences: harness.preferences, sources: harness.sources };
}

function createExecutionService(harness: Harness, strategies: RecoveryStrategy[]) {
  const deps: RecoveryExecutionDependencies = {
    cases: harness.cases,
    audit: harness.audit,
    authority: new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(harness.entities) }),
    executor: createRecoveryExecutor({
      inner: new BoundaryExecutor(),
      strategyFor: async (intent) => strategies.find((strategy) => strategy.id === intent.strategyId),
    }),
    observation: new DeterministicObservationService({ mutations: harness.mutations }),
    verifier: new CaseVerifier({ trips: harness.trips, signals: harness.signals, entities: harness.entities }),
  };
  return new RecoveryExecutionService(deps);
}

/** Seed a bespoke in-test trip through the same validated mutation path. */
async function seedProposal(harness: Harness, proposal: MutationProposal): Promise<void> {
  const outcome = await harness.mutations.applyProposal(proposal);
  if (!outcome.accepted) {
    throw new Error(`G2 seed rejected: ${outcome.issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`);
  }
}

function legReplacement(
  base: TripElement,
  changes: { data: Record<string, unknown>; reservationState?: string },
): MutationOperation {
  return {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    data: {
      ...base,
      reservationState: changes.reservationState ?? 'HELD',
      status: 'UNKNOWN',
      data: changes.data,
    },
  };
}

function scriptedPlanner(rounds: unknown[], suffix: string, now: IsoDateTime) {
  let sequence = 0;
  return new ModelStudioRecoveryPlanner({
    client: new ModelStudioClient({
      transport: new ScriptedModelTransport(rounds.map((round) => JSON.stringify(round))),
    }),
    idFactory: (prefix) => `${prefix}-${suffix}-${String(++sequence).padStart(3, '0')}`,
    now: () => now,
  });
}

interface OfferFacts {
  departure: IsoDateTime;
  arrival: IsoDateTime;
  offerId: string;
  price: { amount: number; currency: string };
}

function offerFacts(searchData: { offers: FlightOffer[] }, offerId: string): OfferFacts {
  const offer = searchData.offers.find((candidate) => candidate.offerId === offerId);
  assert.ok(offer, `REPLAY search output must contain ${offerId}`);
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  assert.ok(first && last, `offer ${offerId} must carry normalized segments`);
  return { departure: first.departure, arrival: last.arrival, offerId, price: offer.totalPrice };
}

// ---------------------------------------------------------------------------
// Case 1 — late arrival vs hotel no-show (Scenario A, real REPLAY evidence)
// ---------------------------------------------------------------------------

test('G2-1: delayed arrival breaching the hotel no-show cutoff recovers via same-day evening flight', async () => {
  const harness = createHarness();
  const spec = loadScenario(SCENARIO_A_DIR);
  await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_A_DIR,
  );

  // A delay signal (authoritative provider state) pushes the outbound arrival
  // past midnight: arrival chain = 00:45 + 80min transfer = 01:25... and the
  // no-show cutoff is 02:00 — recovery candidates that land next morning blow
  // straight through it.
  const delaySignal: TripSignal = {
    id: 'sig_a_delay',
    kind: 'FLIGHT_DELAY',
    occurredAt: '2026-09-13T14:00:00+09:00',
    receivedAt: '2026-09-13T14:05:00+09:00',
    sourceId: 'src_a_provider_state',
    authority: 'AUTHORITATIVE',
    confidence: 1,
    tripId: spec.trip.id,
    subjectRef: { entityType: 'TRIP_ELEMENT', id: 'el_a_flight_out' },
    summary: 'Outbound flight delayed into the night',
    payload: {
      scheduledDeparture: '2026-09-13T22:15:00+09:00',
      scheduledArrival: '2026-09-14T00:45:00+09:00',
    },
  };
  const signalResult = await processSignal(
    { trips: harness.trips, signals: harness.signals, entities: harness.entities, cases: harness.cases, mutations: harness.mutations, audit: harness.audit },
    delaySignal,
  );
  assert.equal(signalResult.mutationAccepted, true);

  // The delayed arrival chain now breaches the supplier no-show cutoff: the
  // constraint is HARD and FAILs; the case carries it as failed evidence.
  const noShow = signalResult.constraintEvaluations.find((e) => e.constraintId === 'c_a_hotel_no_show');
  assert.ok(noShow, 'no-show constraint must be evaluated for this trip');
  assert.equal(noShow.status, 'FAIL', 'delayed arrival chain breaches the cutoff');
  assert.ok(signalResult.caseStatus === 'ASSESSING');

  const PLANNING_AT = '2026-09-13T15:00:00+09:00';
  const snapshot = await buildTripSnapshot(snapshotDeps(harness), spec.trip.id, PLANNING_AT);
  const delayedLeg = snapshot.trip.elements.find((e) => e.id === 'el_a_flight_out') as TransportLeg;
  assert.equal(delayedLeg.data.scheduledArrival?.value, '2026-09-14T00:45:00+09:00');

  // REPLAY capability evidence through the shared normalizer (same request as
  // the curated Scenario A search recording).
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: RECORDING_READ_DIRS }),
    timezoneResolver: await buildTimezoneResolver(harness.entities)(),
  });
  const origin = snapshot.places.find((p) => p.id === delayedLeg.data.originPlaceId)!;
  const destination = snapshot.places.find((p) => p.id === delayedLeg.data.destinationPlaceId)!;
  const searchParameters = {
    origin: { system: origin.externalRefs![0]!.system, value: origin.externalRefs![0]!.value },
    destination: { system: destination.externalRefs![0]!.system, value: destination.externalRefs![0]!.value },
    departureDate: delayedLeg.data.scheduledDeparture!.value.slice(0, 10),
    passengers: { adults: 1 },
  };
  const searchResult = await adapter.searchFlights(searchParameters);
  assert.ok(searchResult.ok, 'REPLAY search must succeed');
  const morning = offerFacts(searchResult.data, MORNING_OFFER_ID);
  const afternoon = offerFacts(searchResult.data, AFTERNOON_OFFER_ID);
  const evening = offerFacts(searchResult.data, EVENING_OFFER_ID);

  const sourceId = delaySignal.sourceId;
  const replaceWith = (offer: OfferFacts) =>
    legReplacement(delayedLeg, {
      data: {
        ...delayedLeg.data,
        scheduledDeparture: { value: offer.departure, sourceId, authority: 'AUTHORITATIVE' as const, observedAt: PLANNING_AT },
        scheduledArrival: { value: offer.arrival, sourceId, authority: 'AUTHORITATIVE' as const, observedAt: PLANNING_AT },
        bookingRef: { system: 'atlas', reference: offer.offerId },
      },
    });
  const strategyFor = (summary: string, offer: OfferFacts) => ({
    summary,
    candidateOperations: [replaceWith(offer)],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    costImpact: offer.price,
  });

  const planning = await runPlanningLoop(
    {
      planner: scriptedPlanner(
        [{ toolRequests: [{ capability: 'FLIGHT', operation: 'flight.search', parameters: searchParameters, purpose: 'rebook the delayed outbound' }], assumptions: [], uncertainties: [] }, { strategies: [strategyFor('Rebook on the next-morning replacement', morning), strategyFor('Rebook on the same-day afternoon replacement', afternoon), strategyFor('Rebook on the same-day evening replacement', evening)], toolRequests: [], assumptions: [], uncertainties: [], rationale: 'three same-route replacements' }],
        'g2a',
        PLANNING_AT,
      ),
      capabilities: { flight: adapter },
      viability: new OverlayViabilityEngine(),
      cases: harness.cases,
      audit: harness.audit,
    },
    {
      caseId: signalResult.caseId,
      snapshot,
      triggeringSignals: [delaySignal],
      impact: signalResult.assessment,
      capabilityRegistry: [adapter.descriptor],
      planningAt: PLANNING_AT,
    },
  );

  // Engine-owned rejection: the next-morning landing (hotel arrival 12:55 on
  // 09-14) is after the 02:00 no-show cutoff.
  const morningCandidate = planning.candidates.find((c) => c.strategy.summary.includes('next-morning'))!;
  assert.equal(morningCandidate.feasible, false);
  assert.ok(
    morningCandidate.rejectionReasons.some((reason) => reason.includes('c_a_hotel_no_show') && reason.includes('FAILS')),
    'no-show breach must be the engine-owned rejection reason',
  );
  const afternoonCandidate = planning.candidates.find((c) => c.strategy.summary.includes('afternoon'))!;
  const eveningCandidate = planning.candidates.find((c) => c.strategy.summary.includes('evening'))!;
  assert.equal(afternoonCandidate.feasible, true);
  assert.equal(eveningCandidate.feasible, true);
  assert.equal(planning.bestStrategyId, eveningCandidate.strategy.id, 'cheapest same-day viable service wins');

  const service = createExecutionService(harness, planning.strategies);
  const begin = await service.beginStrategy({ snapshot, caseId: signalResult.caseId, strategy: eveningCandidate.strategy, at: '2026-09-13T15:20:00+09:00' });
  assert.equal(begin.decision.outcome, 'REQUIRES_TRAVELLER');
  await service.recordApproval({
    caseId: signalResult.caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: spec.context.travellers[0]!.id },
    decidedAt: '2026-09-13T15:40:00+09:00',
    verdict: 'APPROVED',
  });
  const executed = await service.executeApproved({ caseId: signalResult.caseId, intentId: begin.intent.id, at: '2026-09-13T16:00:00+09:00' });
  assert.equal(executed.caseStatus, 'RESOLVED');
  assert.equal(executed.verification?.resolution?.outcome, 'FULLY_RECOVERED');
  assert.deepEqual(executed.verification?.hardFailureIds, [], 'no-show constraint passes again after recovery');

  const recovered = (await harness.trips.getTrip(spec.trip.id))!.elements.find((e) => e.id === 'el_a_flight_out') as TransportLeg;
  assert.equal(recovered.reservationState, 'CONFIRMED');
  assert.equal(recovered.data.scheduledArrival?.value, evening.arrival);
});

// ---------------------------------------------------------------------------
// Case 2 — public transport cutoff, flexible taxi recovery
// ---------------------------------------------------------------------------

test('G2-2: delayed flight misses the transit cutoff; on-demand taxi recovery wins and resolves', async () => {
  const harness = createHarness();
  const TRIP_AT = '2026-09-10T09:00:00+09:00';
  await seedProposal(harness, {
    id: 'prop-g2-seed',
    origin: 'SYSTEM',
    requestedAt: TRIP_AT,
    rationale: 'seed G2 transit-cutoff trip',
    operations: [
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g2_airport', data: { id: 'plc_g2_airport', name: 'Kansai Airport', kind: 'AIRPORT', timezone: 'Asia/Tokyo' } },
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g2_city', data: { id: 'plc_g2_city', name: 'Osaka Station', kind: 'CITY', timezone: 'Asia/Tokyo' } },
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g2_venue', data: { id: 'plc_g2_venue', name: 'Client campus', kind: 'VENUE', timezone: 'Asia/Tokyo' } },
      { op: 'UPSERT_ENTITY', entityType: 'TRAVELLER', id: 'trv_g2', data: { id: 'trv_g2', name: 'G2 Traveller' } },
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP',
        id: 'trip_g2',
        data: {
          id: 'trip_g2',
          label: 'Client visit',
          travellerIds: ['trv_g2'],
          version: 0,
          elements: [
            {
              id: 'el_g2_flight',
              tripId: 'trip_g2',
              elementKind: 'TRANSPORT_LEG',
              importance: 'REQUIRED',
              flexibility: 'CHANGEABLE',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                mode: 'FLIGHT',
                originPlaceId: 'plc_g2_airport',
                destinationPlaceId: 'plc_g2_airport',
                scheduledDeparture: { value: '2026-09-18T09:00:00+09:00', sourceId: 'src_g2_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                scheduledArrival: { value: '2026-09-18T10:40:00+09:00', sourceId: 'src_g2_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                bookingRef: { system: 'provider-sandbox', reference: 'FL-G2-01' },
              },
            },
            {
              id: 'el_g2_transit',
              tripId: 'trip_g2',
              elementKind: 'TRANSPORT_LEG',
              importance: 'REQUIRED',
              flexibility: 'CHANGEABLE',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                mode: 'PUBLIC_TRANSIT',
                originPlaceId: 'plc_g2_airport',
                destinationPlaceId: 'plc_g2_city',
                scheduledDeparture: { value: '2026-09-18T11:30:00+09:00', sourceId: 'src_g2_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                bookingRef: { system: 'transit-desk', reference: 'TR-G2-02' },
              },
            },
            {
              id: 'el_g2_talk',
              tripId: 'trip_g2',
              elementKind: 'ENGAGEMENT',
              importance: 'REQUIRED',
              flexibility: 'FIXED',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                title: 'Client review',
                placeId: 'plc_g2_venue',
                startsAt: { value: '2026-09-18T14:00:00+09:00', sourceId: 'src_g2_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                endsAt: { value: '2026-09-18T17:00:00+09:00', sourceId: 'src_g2_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
              },
            },
          ],
          objectives: [
            { id: 'obj_g2_talk', tripId: 'trip_g2', statement: 'Reach the client review on time', hardness: 'HARD', linkedElementIds: ['el_g2_talk', 'el_g2_flight'] },
          ],
          relations: [
            { kind: 'CONNECTS_TO', from: { entityType: 'TRIP_ELEMENT', id: 'el_g2_flight' }, to: { entityType: 'TRIP_ELEMENT', id: 'el_g2_transit' } },
          ],
          governedByRuleSetIds: [],
          viability: 'VIABLE',
          updatedAt: TRIP_AT,
        },
      },
      {
        op: 'UPSERT_CONSTRAINT',
        constraint: {
          id: 'c_g2_transfer',
          kind: 'TRANSFER',
          hardness: 'HARD',
          evaluator: 'DETERMINISTIC',
          status: 'PASS',
          description: 'Airport-to-city transfer boards after the inbound arrival',
          refs: [{ entityType: 'TRIP_ELEMENT', id: 'el_g2_transit' }],
          parameters: { minBufferMinutes: 45 },
        },
      },
      {
        op: 'UPSERT_CONSTRAINT',
        constraint: {
          id: 'c_g2_arrive',
          kind: 'TEMPORAL',
          hardness: 'HARD',
          evaluator: 'DETERMINISTIC',
          status: 'PASS',
          description: 'Land before the client review',
          refs: [
            { entityType: 'TRIP_ELEMENT', id: 'el_g2_flight' },
            { entityType: 'TRIP_ELEMENT', id: 'el_g2_talk' },
          ],
          parameters: { minBufferMinutes: 60 },
        },
      },
    ],
  });

  const delaySignal: TripSignal = {
    id: 'sig_g2_delay',
    kind: 'FLIGHT_DELAY',
    occurredAt: '2026-09-18T09:55:00+09:00',
    receivedAt: '2026-09-18T10:00:00+09:00',
    sourceId: 'src_g2_provider',
    authority: 'AUTHORITATIVE',
    confidence: 1,
    tripId: 'trip_g2',
    subjectRef: { entityType: 'TRIP_ELEMENT', id: 'el_g2_flight' },
    summary: 'Inbound flight delayed; booked connection at risk',
    payload: {
      scheduledDeparture: '2026-09-18T10:30:00+09:00',
      scheduledArrival: '2026-09-18T12:10:00+09:00',
    },
  };
  const signalResult = await processSignal(
    { trips: harness.trips, signals: harness.signals, entities: harness.entities, cases: harness.cases, mutations: harness.mutations, audit: harness.audit },
    delaySignal,
  );
  assert.equal(signalResult.mutationAccepted, true);
  const transferEval = signalResult.constraintEvaluations.find((e) => e.constraintId === 'c_g2_transfer')!;
  assert.equal(transferEval.status, 'FAIL', 'booked 11:30 departure is before the 12:10 arrival');

  const PLANNING_AT = '2026-09-18T10:15:00+09:00';
  const snapshot = await buildTripSnapshot(snapshotDeps(harness), 'trip_g2', PLANNING_AT);
  const transitLeg = snapshot.trip.elements.find((e) => e.id === 'el_g2_transit')!;

  const taxiOps: MutationOperation[] = [
    legReplacement(transitLeg, {
      reservationState: 'NONE',
      data: {
        mode: 'TAXI_OR_RIDEHAIL',
        originPlaceId: 'plc_g2_airport',
        destinationPlaceId: 'plc_g2_city',
        durationEstimate: {
          expectedMinutes: 45,
          conservativeMinutes: 60,
          sourceId: 'src_g2_provider',
          observedAt: PLANNING_AT,
          quality: 'MEDIUM',
        },
      },
    }),
  ];
  const laterTransitOps: MutationOperation[] = [
    legReplacement(transitLeg, {
      data: {
        ...transitLeg.data,
        scheduledDeparture: { value: '2026-09-18T13:15:00+09:00', sourceId: 'src_g2_provider', authority: 'CONNECTED' as const, observedAt: PLANNING_AT },
      },
    }),
  ];

  const planning = await runPlanningLoop(
    {
      planner: scriptedPlanner(
        [
          {
            strategies: [
              { summary: 'Switch to an on-demand taxi after landing', candidateOperations: taxiOps, assumptions: [], uncertainties: [], expectedOutcomes: [], costImpact: { amount: 18, currency: 'USD' } },
              { summary: 'Rebook the next scheduled public transit service', candidateOperations: laterTransitOps, assumptions: [], uncertainties: [], expectedOutcomes: [], costImpact: { amount: 25, currency: 'USD' } },
            ],
            toolRequests: [],
            assumptions: [],
            uncertainties: [],
            rationale: 'flexible ground recovery options',
          },
        ],
        'g2b',
        PLANNING_AT,
      ),
      capabilities: {},
      viability: new OverlayViabilityEngine(),
      cases: harness.cases,
      audit: harness.audit,
    },
    {
      caseId: signalResult.caseId,
      snapshot,
      triggeringSignals: [delaySignal],
      impact: signalResult.assessment,
      capabilityRegistry: [],
      planningAt: PLANNING_AT,
    },
  );

  const taxi = planning.candidates.find((c) => c.strategy.summary.includes('taxi'))!;
  const laterTransit = planning.candidates.find((c) => c.strategy.summary.includes('scheduled public transit'))!;
  assert.equal(taxi.feasible, true);
  assert.equal(laterTransit.feasible, true, 'the later scheduled service is also viable');
  const taxiTransferEval = taxi.viability!.constraintResults.find((r) => r.constraintId === 'c_g2_transfer')!;
  assert.equal(taxiTransferEval.status, 'PASS');
  assert.match(taxiTransferEval.evidence ?? '', /on-demand/, 'flexibility is what makes the taxi schedulable');
  assert.equal(planning.bestStrategyId, taxi.strategy.id, 'cheaper flexible recovery ranks first');

  // simulation.provider_action (ground recovery) is reversible -> auto-approved.
  const service = createExecutionService(harness, planning.strategies);
  const begin = await service.beginStrategy({ snapshot, caseId: signalResult.caseId, strategy: taxi.strategy, at: '2026-09-18T10:25:00+09:00' });
  assert.equal(begin.decision.outcome, 'AUTO_APPROVED');
  assert.equal(begin.executable, true);
  const executed = await service.executeApproved({ caseId: signalResult.caseId, intentId: begin.intent.id, at: '2026-09-18T10:30:00+09:00' });
  assert.equal(executed.caseStatus, 'RESOLVED');
  assert.equal(executed.verification?.resolution?.outcome, 'FULLY_RECOVERED');

  const recoveredTransfer = (await harness.trips.getTrip('trip_g2'))!.elements.find((e) => e.id === 'el_g2_transit') as TransportLeg;
  assert.equal(recoveredTransfer.data.mode, 'TAXI_OR_RIDEHAIL');
  assert.equal(recoveredTransfer.reservationState, 'CONFIRMED');
});

// ---------------------------------------------------------------------------
// Case 3 — accessibility invalidates the cheaper alternative
// ---------------------------------------------------------------------------

test('G2-3: hard accessibility requirement rejects the cheaper alternative; accessible option wins', async () => {
  const harness = createHarness();
  const TRIP_AT = '2026-09-15T09:00:00+09:00';
  await seedProposal(harness, {
    id: 'prop-g3-seed',
    origin: 'SYSTEM',
    requestedAt: TRIP_AT,
    rationale: 'seed G2 accessibility trip',
    operations: [
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g3_airport', data: { id: 'plc_g3_airport', kind: 'AIRPORT', timezone: 'Asia/Tokyo' } },
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g3_venue', data: { id: 'plc_g3_venue', kind: 'VENUE', timezone: 'Asia/Tokyo' } },
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRAVELLER',
        id: 'trv_g3',
        data: {
          id: 'trv_g3',
          name: 'G3 Traveller',
          accessibilityRequirements: [
            { id: 'acc_g3_mobility', kind: 'MOBILITY', statement: 'Cannot use standard public transit; needs step-free private transfer', sourceId: 'src_g3_profile' },
          ],
        },
      },
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP',
        id: 'trip_g3',
        data: {
          id: 'trip_g3',
          travellerIds: ['trv_g3'],
          version: 0,
          elements: [
            {
              id: 'el_g3_flight',
              tripId: 'trip_g3',
              elementKind: 'TRANSPORT_LEG',
              importance: 'REQUIRED',
              flexibility: 'CHANGEABLE',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                mode: 'FLIGHT',
                originPlaceId: 'plc_g3_airport',
                destinationPlaceId: 'plc_g3_airport',
                scheduledDeparture: { value: '2026-09-20T08:00:00+09:00', sourceId: 'src_g3_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                scheduledArrival: { value: '2026-09-20T10:00:00+09:00', sourceId: 'src_g3_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                bookingRef: { system: 'provider-sandbox', reference: 'FL-G3-01' },
              },
            },
            {
              id: 'el_g3_panel',
              tripId: 'trip_g3',
              elementKind: 'ENGAGEMENT',
              importance: 'REQUIRED',
              flexibility: 'FIXED',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                title: 'Panel discussion',
                placeId: 'plc_g3_venue',
                startsAt: { value: '2026-09-20T18:00:00+09:00', sourceId: 'src_g3_invite', authority: 'CONNECTED', observedAt: TRIP_AT },
                endsAt: { value: '2026-09-20T19:30:00+09:00', sourceId: 'src_g3_invite', authority: 'CONNECTED', observedAt: TRIP_AT },
              },
            },
          ],
          objectives: [
            { id: 'obj_g3_panel', tripId: 'trip_g3', statement: 'Reach the panel discussion', hardness: 'HARD', linkedElementIds: ['el_g3_panel', 'el_g3_flight'] },
          ],
          relations: [],
          governedByRuleSetIds: [],
          viability: 'VIABLE',
          updatedAt: TRIP_AT,
        },
      },
      {
        op: 'UPSERT_CONSTRAINT',
        constraint: {
          id: 'c_g3_arrive',
          kind: 'TEMPORAL',
          hardness: 'HARD',
          evaluator: 'DETERMINISTIC',
          status: 'PASS',
          description: 'Arrive before the panel',
          refs: [
            { entityType: 'TRIP_ELEMENT', id: 'el_g3_flight' },
            { entityType: 'TRIP_ELEMENT', id: 'el_g3_panel' },
          ],
          parameters: { minBufferMinutes: 60 },
        },
      },
      {
        op: 'UPSERT_CONSTRAINT',
        constraint: {
          id: 'c_g3_access',
          kind: 'ACCESSIBILITY',
          hardness: 'HARD',
          evaluator: 'DETERMINISTIC',
          status: 'PASS',
          description: 'Replacement leg must be step-free accessible',
          refs: [{ entityType: 'TRIP_ELEMENT', id: 'el_g3_flight' }],
          parameters: { unsupportedModes: ['PUBLIC_TRANSIT'] },
        },
      },
    ],
  });

  const cancelSignal: TripSignal = {
    id: 'sig_g3_cancel',
    kind: 'FLIGHT_CANCELLATION',
    occurredAt: '2026-09-19T19:55:00+09:00',
    receivedAt: '2026-09-19T20:00:00+09:00',
    sourceId: 'src_g3_provider',
    authority: 'AUTHORITATIVE',
    confidence: 1,
    tripId: 'trip_g3',
    subjectRef: { entityType: 'TRIP_ELEMENT', id: 'el_g3_flight' },
    summary: 'Flight cancelled by carrier',
    payload: { reason: 'operational' },
  };
  const signalResult = await processSignal(
    { trips: harness.trips, signals: harness.signals, entities: harness.entities, cases: harness.cases, mutations: harness.mutations, audit: harness.audit },
    cancelSignal,
  );
  assert.equal(signalResult.mutationAccepted, true);
  assert.equal(signalResult.assessment.severity, 'HIGH');
  assert.deepEqual(signalResult.assessment.directFailures.map((f) => f.elementId), ['el_g3_flight']);

  const PLANNING_AT = '2026-09-19T20:30:00+09:00';
  const snapshot = await buildTripSnapshot(snapshotDeps(harness), 'trip_g3', PLANNING_AT);
  const cancelledLeg = snapshot.trip.elements.find((e) => e.id === 'el_g3_flight') as TransportLeg;
  const sourceId = cancelSignal.sourceId;

  const replacement = (mode: 'PUBLIC_TRANSIT' | 'PRIVATE_TRANSFER', offerRef: string, cost: number) => ({
    summary: `Replace with ${mode === 'PUBLIC_TRANSIT' ? 'cheap airport rail link' : 'accessible private transfer'} at 15:00`,
    candidateOperations: [
      legReplacement(cancelledLeg, {
        data: {
          mode,
          originPlaceId: cancelledLeg.data.originPlaceId,
          destinationPlaceId: cancelledLeg.data.destinationPlaceId,
          scheduledDeparture: { value: '2026-09-20T13:00:00+09:00', sourceId, authority: 'CONNECTED' as const, observedAt: PLANNING_AT },
          scheduledArrival: { value: '2026-09-20T15:00:00+09:00', sourceId, authority: 'CONNECTED' as const, observedAt: PLANNING_AT },
          bookingRef: { system: 'recovery-desk', reference: offerRef },
        },
      }),
    ],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    costImpact: { amount: cost, currency: 'USD' },
  });

  const planning = await runPlanningLoop(
    {
      planner: scriptedPlanner(
        [{ strategies: [replacement('PUBLIC_TRANSIT', 'RAIL-G3-11', 40), replacement('PRIVATE_TRANSFER', 'CAR-G3-12', 180)], toolRequests: [], assumptions: [], uncertainties: [], rationale: 'cheap rail vs accessible car' }],
        'g2c',
        PLANNING_AT,
      ),
      capabilities: {},
      viability: new OverlayViabilityEngine(),
      cases: harness.cases,
      audit: harness.audit,
    },
    {
      caseId: signalResult.caseId,
      snapshot,
      triggeringSignals: [cancelSignal],
      impact: signalResult.assessment,
      capabilityRegistry: [],
      planningAt: PLANNING_AT,
    },
  );

  // The cheaper alternative fails the HARD accessibility requirement — the
  // engine owns the rejection, never the planner.
  const rail = planning.candidates.find((c) => c.strategy.summary.includes('rail'))!;
  const car = planning.candidates.find((c) => c.strategy.summary.includes('private transfer'))!;
  assert.equal(rail.feasible, false);
  assert.ok(
    rail.rejectionReasons.some((reason) => reason.includes('c_g3_access') && reason.includes('FAILS')),
    'accessibility failure must be the engine-owned rejection reason',
  );
  assert.equal(car.feasible, true);
  assert.equal(planning.bestStrategyId, car.strategy.id, 'accessible option wins despite higher cost');
  assert.deepEqual(planning.rankedFeasibleIds, [car.strategy.id]);

  const service = createExecutionService(harness, planning.strategies);
  const begin = await service.beginStrategy({ snapshot, caseId: signalResult.caseId, strategy: car.strategy, at: '2026-09-19T20:45:00+09:00' });
  assert.equal(begin.decision.outcome, 'AUTO_APPROVED');
  const executed = await service.executeApproved({ caseId: signalResult.caseId, intentId: begin.intent.id, at: '2026-09-19T21:00:00+09:00' });
  assert.equal(executed.caseStatus, 'RESOLVED');
  assert.equal(executed.verification?.resolution?.outcome, 'FULLY_RECOVERED');
  assert.deepEqual(executed.verification?.hardFailureIds, [], 'accessibility re-checked in full post-execution context');

  const recovered = (await harness.trips.getTrip('trip_g3'))!.elements.find((e) => e.id === 'el_g3_flight') as TransportLeg;
  assert.equal(recovered.data.mode, 'PRIVATE_TRANSFER');
  assert.equal(recovered.reservationState, 'CONFIRMED');
});

// ---------------------------------------------------------------------------
// Case 4 — already-lost objective; remainder recovers
// ---------------------------------------------------------------------------

test('G2-4: already-lost objective is recorded as loss; remainder recovers RECOVERED_WITH_LOSS', async () => {
  const harness = createHarness();
  const TRIP_AT = '2026-09-12T09:00:00+09:00';
  await seedProposal(harness, {
    id: 'prop-g4-seed',
    origin: 'SYSTEM',
    requestedAt: TRIP_AT,
    rationale: 'seed G2 already-lost objective trip',
    operations: [
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g4_airport', data: { id: 'plc_g4_airport', kind: 'AIRPORT', timezone: 'Asia/Tokyo' } },
      { op: 'UPSERT_ENTITY', entityType: 'PLACE', id: 'plc_g4_office', data: { id: 'plc_g4_office', kind: 'ADDRESS', timezone: 'Asia/Tokyo' } },
      { op: 'UPSERT_ENTITY', entityType: 'TRAVELLER', id: 'trv_g4', data: { id: 'trv_g4', name: 'G4 Traveller' } },
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP',
        id: 'trip_g4',
        data: {
          id: 'trip_g4',
          travellerIds: ['trv_g4'],
          version: 0,
          elements: [
            {
              id: 'el_g4_flight',
              tripId: 'trip_g4',
              elementKind: 'TRANSPORT_LEG',
              importance: 'REQUIRED',
              flexibility: 'CHANGEABLE',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                mode: 'FLIGHT',
                originPlaceId: 'plc_g4_airport',
                destinationPlaceId: 'plc_g4_airport',
                scheduledDeparture: { value: '2026-09-15T08:00:00+09:00', sourceId: 'src_g4_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                scheduledArrival: { value: '2026-09-15T10:30:00+09:00', sourceId: 'src_g4_booking', authority: 'CONNECTED', observedAt: TRIP_AT },
                bookingRef: { system: 'provider-sandbox', reference: 'FL-G4-01' },
              },
            },
            {
              id: 'el_g4_meeting',
              tripId: 'trip_g4',
              elementKind: 'ENGAGEMENT',
              importance: 'REQUIRED',
              flexibility: 'FIXED',
              reservationState: 'CONFIRMED',
              status: 'VALID',
              data: {
                title: 'Client meeting',
                placeId: 'plc_g4_office',
                startsAt: { value: '2026-09-15T14:00:00+09:00', sourceId: 'src_g4_invite', authority: 'CONNECTED', observedAt: TRIP_AT },
                endsAt: { value: '2026-09-15T15:30:00+09:00', sourceId: 'src_g4_invite', authority: 'CONNECTED', observedAt: TRIP_AT },
              },
            },
          ],
          objectives: [
            { id: 'obj_g4_prep', tripId: 'trip_g4', statement: 'Run the on-site morning prep before the client meeting', hardness: 'HARD', linkedElementIds: ['el_g4_flight'] },
            { id: 'obj_g4_meeting', tripId: 'trip_g4', statement: 'Attend the client meeting', hardness: 'HARD', linkedElementIds: ['el_g4_meeting', 'el_g4_flight'] },
          ],
          relations: [],
          governedByRuleSetIds: [],
          viability: 'VIABLE',
          updatedAt: TRIP_AT,
        },
      },
      {
        op: 'UPSERT_CONSTRAINT',
        constraint: {
          id: 'c_g4_arrive',
          kind: 'TEMPORAL',
          hardness: 'HARD',
          evaluator: 'DETERMINISTIC',
          status: 'PASS',
          description: 'Arrive before the client meeting',
          refs: [
            { entityType: 'TRIP_ELEMENT', id: 'el_g4_flight' },
            { entityType: 'TRIP_ELEMENT', id: 'el_g4_meeting' },
          ],
          parameters: { minBufferMinutes: 60 },
        },
      },
    ],
  });

  // Cancellation arrives AFTER the flight's scheduled departure: the morning
  // prep objective is already impossible at assessment time.
  const cancelSignal: TripSignal = {
    id: 'sig_g4_cancel',
    kind: 'FLIGHT_CANCELLATION',
    occurredAt: '2026-09-15T09:25:00+09:00',
    receivedAt: '2026-09-15T09:30:00+09:00',
    sourceId: 'src_g4_provider',
    authority: 'AUTHORITATIVE',
    confidence: 1,
    tripId: 'trip_g4',
    subjectRef: { entityType: 'TRIP_ELEMENT', id: 'el_g4_flight' },
    summary: 'Morning flight cancelled after its departure slot',
    payload: { reason: 'technical' },
  };
  const signalResult = await processSignal(
    { trips: harness.trips, signals: harness.signals, entities: harness.entities, cases: harness.cases, mutations: harness.mutations, audit: harness.audit },
    cancelSignal,
  );
  assert.equal(signalResult.mutationAccepted, true);
  // Impact engine records the irreversible loss at assessment — the objective
  // is already gone before any planning happens.
  assert.equal(signalResult.assessment.severity, 'CRITICAL');
  assert.deepEqual(
    signalResult.assessment.irreversibleLosses.map((loss) => loss.id),
    ['loss-obj_g4_prep'],
    'the prep objective is irrecoverably lost at assessment time',
  );
  assert.deepEqual(
    [...signalResult.assessment.threatenedObjectives.map((o) => o.objectiveId)].sort(),
    ['obj_g4_meeting', 'obj_g4_prep'],
  );

  const PLANNING_AT = '2026-09-15T09:45:00+09:00';
  const snapshot = await buildTripSnapshot(snapshotDeps(harness), 'trip_g4', PLANNING_AT);
  const cancelledLeg = snapshot.trip.elements.find((e) => e.id === 'el_g4_flight') as TransportLeg;
  const sourceId = cancelSignal.sourceId;

  const replaceFlight = (departure: IsoDateTime, arrival: IsoDateTime, offerRef: string) =>
    legReplacement(cancelledLeg, {
      data: {
        ...cancelledLeg.data,
        scheduledDeparture: { value: departure, sourceId, authority: 'CONNECTED' as const, observedAt: PLANNING_AT },
        scheduledArrival: { value: arrival, sourceId, authority: 'CONNECTED' as const, observedAt: PLANNING_AT },
        bookingRef: { system: 'recovery-desk', reference: offerRef },
      },
    });
  const waivePrep = (reason: string): MutationOperation => ({
    op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE',
    objectiveId: 'obj_g4_prep',
    action: 'WAIVE',
    by: { entityType: 'TRAVELLER', id: 'trv_g4' },
    reason,
  });

  const planning = await runPlanningLoop(
    {
      planner: scriptedPlanner(
        [
          {
            strategies: [
              {
                summary: 'Rebook the midday replacement and waive the already-lost prep objective',
                candidateOperations: [replaceFlight('2026-09-15T10:45:00+09:00', '2026-09-15T11:30:00+09:00', 'FL-G4-11'), waivePrep('the morning prep window passed before the cancellation was known')],
                assumptions: [],
                uncertainties: [],
                expectedOutcomes: [],
                costImpact: { amount: 210, currency: 'USD' },
              },
              {
                summary: 'Rebook the later afternoon replacement and waive the already-lost prep objective',
                candidateOperations: [replaceFlight('2026-09-15T12:00:00+09:00', '2026-09-15T12:45:00+09:00', 'FL-G4-12'), waivePrep('the morning prep window passed before the cancellation was known')],
                assumptions: [],
                uncertainties: [],
                expectedOutcomes: [],
                costImpact: { amount: 120, currency: 'USD' },
              },
            ],
            toolRequests: [],
            assumptions: [],
            uncertainties: [],
            rationale: 'recover the meeting; the prep objective is already lost',
          },
        ],
        'g2d',
        PLANNING_AT,
      ),
      capabilities: {},
      viability: new OverlayViabilityEngine(),
      cases: harness.cases,
      audit: harness.audit,
    },
    {
      caseId: signalResult.caseId,
      snapshot,
      triggeringSignals: [cancelSignal],
      impact: signalResult.assessment,
      capabilityRegistry: [],
      planningAt: PLANNING_AT,
    },
  );

  assert.equal(planning.candidates.filter((c) => c.feasible).length, 2, 'both waiver-backed replacements are feasible');
  const best = planning.strategies.find((s) => s.id === planning.bestStrategyId)!;
  assert.ok(best.summary.includes('afternoon'), 'cheaper feasible replacement ranks first');

  // flight.change is money-moving with no governing rules -> traveller authority.
  const service = createExecutionService(harness, planning.strategies);
  const begin = await service.beginStrategy({ snapshot, caseId: signalResult.caseId, strategy: best, at: '2026-09-15T10:00:00+09:00' });
  assert.equal(begin.decision.outcome, 'REQUIRES_TRAVELLER');
  assert.equal(begin.intent.operation, 'flight.change');
  await service.recordApproval({
    caseId: signalResult.caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: 'trv_g4' },
    decidedAt: '2026-09-15T10:10:00+09:00',
    verdict: 'APPROVED',
  });
  const executed = await service.executeApproved({ caseId: signalResult.caseId, intentId: begin.intent.id, at: '2026-09-15T10:20:00+09:00' });

  // The remainder recovers; the recorded loss is the waived prep objective.
  assert.equal(executed.caseStatus, 'RESOLVED');
  assert.equal(executed.verification?.resolution?.outcome, 'RECOVERED_WITH_LOSS');
  assert.deepEqual(executed.verification?.remainingLossRefs, ['obj_g4_prep']);
  assert.deepEqual(executed.verification?.hardFailureIds, []);

  const recoveredTrip = (await harness.trips.getTrip('trip_g4'))!;
  const recoveredLeg = recoveredTrip.elements.find((e) => e.id === 'el_g4_flight') as TransportLeg;
  assert.equal(recoveredLeg.reservationState, 'CONFIRMED');
  assert.equal(recoveredLeg.data.bookingRef?.reference, 'FL-G4-12');
  const prepObjective = recoveredTrip.objectives.find((o) => o.id === 'obj_g4_prep')!;
  assert.equal(prepObjective.status, 'WAIVED');
  const meetingObjective = recoveredTrip.objectives.find((o) => o.id === 'obj_g4_meeting')!;
  assert.equal(meetingObjective.status, 'ACTIVE', 'the recovered objective carries no loss');
});
