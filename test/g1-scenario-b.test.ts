/**
 * G1 — Scenario B (corporate/TMC) through the SAME application code.
 *
 * Only data/config/sources differ from Scenario A: the corporate bundle seeds
 * through the identical bootstrap, the cancellation signal runs through the
 * identical signal pipeline, planning uses the identical loop with the same
 * REPLAY Atlas adapter and shared normalizer, and the organisation-approval
 * path EMERGES from the employer policy rule set (rule_b_change_approval) —
 * there are no scenario branches in any code path under test.
 *
 * The return-by objective (obj_b_return) is linked only to the cancelled
 * leg, so no replacement can keep it; deterministic viability therefore
 * rejects any candidate that does not explicitly waive it (UNKNOWN is never
 * PASS), the winning strategy rebooks onto the cheapest next-morning service
 * AND carries the traveller's waiver. Authority demands the employer
 * approver (wrong-principal approval is refused), execution is simulated at
 * the boundary, observation validates the confirmed element plus the waiver,
 * and the verifier resolves RECOVERED_WITH_LOSS with the waived objective as
 * the recorded remaining loss.
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
import type { FlightOffer } from '../src/contracts/capabilities.ts';
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
  SqlitePreferenceStore,
  type PlanningLoopDependencies,
  type ReadModelDependencies,
  type RecoveryExecutionDependencies,
} from '../src/app/index.ts';

const SCENARIO_B_DIR = join(resolve('fixtures/scenarios'), 'corporate-tmc');
const RECORDING_READ_DIRS = [join(SCENARIO_B_DIR, 'recordings'), resolve('fixtures/recordings')];

const PLANNING_AT = '2026-09-21T16:45:00-06:00';
const BEGIN_AT = '2026-09-21T17:00:00-06:00';
const WRONG_APPROVAL_AT = '2026-09-21T17:10:00-06:00';
const APPROVAL_AT = '2026-09-21T17:20:00-06:00';
const EXECUTE_AT = '2026-09-21T17:30:00-06:00';
const READ_AT = '2026-09-22T12:00:00-06:00';

const EARLIEST_OFFER_ID = 'ATLMEX-20260922-AM033-E2';
const CHEAPEST_OFFER_ID = 'ATLMEX-20260922-VB210-B4';

interface OfferFacts {
  departure: IsoDateTime;
  arrival: IsoDateTime;
  offerId: string;
  price: { amount: number; currency: string };
}

/** Strategy facts DERIVED from REPLAY-normalized provider output (PL-5 style). */
function offerFacts(searchData: { offers: FlightOffer[] }, offerId: string): OfferFacts {
  const offer = searchData.offers.find((candidate) => candidate.offerId === offerId);
  assert.ok(offer, `REPLAY search output must contain ${offerId}`);
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  assert.ok(first && last, `offer ${offerId} must carry normalized segments`);
  return { departure: first.departure, arrival: last.arrival, offerId, price: offer.totalPrice };
}

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

test('G1: Scenario B recovers RECOVERED_WITH_LOSS through identical application code (REPLAY)', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'atlas-g1-'));
  const dbPath = join(dbDir, 'app.sqlite');
  const harness = createHarness(dbPath);
  const spec = loadScenario(SCENARIO_B_DIR);

  // -- Stage 1: identical bootstrap seeds the corporate bundle ---------------
  await seedScenarioBundle(
    { mutations: harness.mutations, sources: harness.sources, preferences: harness.preferences, audit: harness.audit },
    SCENARIO_B_DIR,
  );
  const seededTrip = (await harness.trips.getTrip(spec.trip.id))!;
  assert.ok(seededTrip, 'trip persists from validated seed operations');
  assert.ok((await harness.sources.listSources()).length >= spec.context.sources.length, 'provenance retained');

  // Post-disruption traveller steering arrives as an explicit instruction and
  // is persisted in the application-owned preference store before planning.
  const steering = spec.disruption.postDisruptionPreferences[0];
  assert.ok(steering, 'scenario bundle carries the post-disruption steering preference');
  await harness.preferences.save(steering);

  // -- Stage 2: identical signal pipeline -----------------------------------
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

  // -- Stage 3: identical planning loop with REPLAY capability evidence ------
  const snapshot = await buildTripSnapshot(
    { trips: harness.trips, entities: harness.entities, preferences: harness.preferences, sources: harness.sources },
    spec.trip.id,
    PLANNING_AT,
  );
  // Generic ontology coverage: the employer (policy owner/approver) named by
  // the governing rule set is an in-scope principal alongside the operator.
  const organisationIds = snapshot.organisations.map((organisation) => organisation.id).sort();
  for (const organisation of spec.context.organisations) {
    assert.ok(organisationIds.includes(organisation.id), `organisation ${organisation.id} in snapshot scope`);
  }
  assert.ok(
    snapshot.preferences.some((preference) => preference.id === steering.id),
    'post-disruption steering preference reaches the planner snapshot',
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
  assert.ok(cancelledLeg, 'disruption signal cancelled the return leg');
  const origin = snapshot.places.find((place) => place.id === cancelledLeg.data.originPlaceId)!;
  const destination = snapshot.places.find((place) => place.id === cancelledLeg.data.destinationPlaceId)!;
  const sourceId = spec.disruption.signal.sourceId;

  const searchResult = await adapter.searchFlights({
    origin: { system: origin.externalRefs![0]!.system, value: origin.externalRefs![0]!.value },
    destination: { system: destination.externalRefs![0]!.system, value: destination.externalRefs![0]!.value },
    departureDate: cancelledLeg.data.scheduledDeparture!.value.slice(0, 10),
    passengers: { adults: 1 },
  });
  assert.ok(searchResult.ok, 'REPLAY search must succeed');
  const earliestOffer = offerFacts(searchResult.data, EARLIEST_OFFER_ID);
  const cheapestOffer = offerFacts(searchResult.data, CHEAPEST_OFFER_ID);
  // Honest provider evidence: no next-day replacement makes the 08:30
  // steering meeting (arrival plus the 90-minute buffer) — the deadline
  // objective is genuinely unreachable and must be waived, not assumed.
  assert.ok(
    earliestOffer.arrival > '2026-09-22T07:00:00-06:00',
    'even the earliest replacement arrives too late for the buffered deadline',
  );

  const traveller = snapshot.travellers[0];
  assert.ok(traveller, 'snapshot carries the traveller');
  const waiveReturn: MutationOperation = {
    op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE',
    objectiveId: spec.expectations.recovery.remainingLossObjectiveIds[0]!,
    action: 'WAIVE',
    by: { entityType: 'TRAVELLER', id: traveller.id },
    reason: steering.statement,
  };

  const searchParameters = {
    origin: { system: origin.externalRefs![0]!.system, value: origin.externalRefs![0]!.value },
    destination: { system: destination.externalRefs![0]!.system, value: destination.externalRefs![0]!.value },
    departureDate: cancelledLeg.data.scheduledDeparture!.value.slice(0, 10),
    passengers: { adults: 1 },
  };
  const round1 = {
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.search',
        parameters: searchParameters,
        purpose: 'find replacement return flights for the cancelled leg',
      },
    ],
    assumptions: [],
    uncertainties: [],
  };
  const round2 = {
    strategies: [
      {
        summary: 'Rebook on the earliest next-morning replacement and waive the unreachable return objective',
        candidateOperations: [
          ...replacementOperations(
            cancelledLeg,
            { departure: earliestOffer.departure, arrival: earliestOffer.arrival, offerId: earliestOffer.offerId },
            sourceId,
          ),
          waiveReturn,
        ],
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: earliestOffer.price,
      },
      {
        summary: 'Rebook on the cheapest mid-morning replacement and waive the unreachable return objective',
        candidateOperations: [
          ...replacementOperations(
            cancelledLeg,
            { departure: cheapestOffer.departure, arrival: cheapestOffer.arrival, offerId: cheapestOffer.offerId },
            sourceId,
          ),
          waiveReturn,
        ],
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: cheapestOffer.price,
      },
      {
        summary: 'Rebook on the earliest replacement without touching the return objective',
        candidateOperations: replacementOperations(
          cancelledLeg,
          { departure: earliestOffer.departure, arrival: earliestOffer.arrival, offerId: earliestOffer.offerId },
          sourceId,
        ),
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
        costImpact: earliestOffer.price,
      },
    ],
    toolRequests: [
      {
        capability: 'FLIGHT',
        operation: 'flight.verify',
        parameters: { offerId: CHEAPEST_OFFER_ID },
        purpose: 'confirm the cheapest replacement is still bookable',
      },
      {
        capability: 'FLIGHT',
        operation: 'flight.fare_rules',
        parameters: { offerId: CHEAPEST_OFFER_ID },
        purpose: 'confirm change rules for the cheapest replacement',
      },
    ],
    assumptions: [],
    uncertainties: [],
    rationale: 'two waiver-backed rebooks plus one no-waiver probe of the deadline objective',
  };
  let sequence = 0;
  const planner = new ModelStudioRecoveryPlanner({
    client: new ModelStudioClient({ transport: new ScriptedModelTransport([JSON.stringify(round1), JSON.stringify(round2)]) }),
    idFactory: (prefix) => `${prefix}-g1-${String(++sequence).padStart(3, '0')}`,
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

  // Capability evidence: REPLAY through the shared normalizer, read-only.
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

  // Deterministic viability: the no-waiver candidate stays UNKNOWN on the
  // deadline constraint and is rejected by the engine (UNKNOWN is never
  // PASS); the cheaper waiver-backed replacement ranks first.
  const noWaiver = planning.candidates.find((candidate) => candidate.strategy.summary.includes('without touching'))!;
  assert.equal(noWaiver.feasible, false);
  assert.ok(
    noWaiver.rejectionReasons.some(
      (reason) => reason.includes('c_b_return_buffer') && reason.includes('UNKNOWN'),
    ),
    'engine-owned rejection: the unwaved deadline constraint remains UNKNOWN',
  );
  const waiverCandidates = planning.candidates.filter((candidate) => candidate.feasible);
  assert.equal(waiverCandidates.length, 2, 'both waiver-backed strategies are deterministically feasible');
  assert.equal(planning.rankedFeasibleIds[0], planning.bestStrategyId);
  const best = planning.strategies.find((strategy) => strategy.id === planning.bestStrategyId)!;
  assert.ok(best.summary.includes('cheapest'), 'cheapest hard-viable waiver-backed option wins');
  for (const candidate of waiverCandidates) {
    assert.ok(
      candidate.viability!.softTradeoffs.some((tradeoff) => tradeoff.includes('c_b_hotel_cancel_terms')),
      'expired hotel refund window is reported as a soft tradeoff, never a blocker',
    );
  }

  // Planning never mutates authoritative state.
  const preExecutionLeg = ((await harness.trips.getTrip(spec.trip.id))!.elements.find(
    (element) => element.id === cancelledLeg.id,
  )) as TransportLeg;
  assert.equal(preExecutionLeg.reservationState, 'CANCELLED');

  // -- Stage 4: authority emerges from employer policy data -------------------
  const service = createExecutionService(harness);
  const begin = await service.beginStrategy({
    snapshot,
    caseId: signalResult.caseId,
    strategy: best,
    at: BEGIN_AT,
  });
  assert.equal(begin.decision.outcome, spec.expectations.authority.expectedOutcome);
  assert.equal(begin.intent.operation, spec.expectations.recovery.actionOperation);
  assert.equal(begin.caseStatus, 'AWAITING_APPROVAL');
  assert.ok(
    begin.decision.ruleTrace.some((entry) => entry.includes('rule_b_change_approval')),
    'approval requirement traced to the employer policy rule',
  );

  // Wrong principal: the traveller cannot settle an organisation approval.
  const wrongPrincipal = await service.recordApproval({
    caseId: signalResult.caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'TRAVELLER', id: traveller.id },
    decidedAt: WRONG_APPROVAL_AT,
    verdict: 'APPROVED',
  });
  assert.equal(wrongPrincipal.accepted, false);
  assert.ok(wrongPrincipal.reason?.includes('TRAVELLER'), 'refusal names the principal type');
  assert.equal(wrongPrincipal.caseStatus, 'AWAITING_APPROVAL', 'case stays awaiting the right approver');

  // The employer organisation (named by the governing rule set) approves.
  const approverOrg = spec.context.organisations.find((organisation) => organisation.roles.includes('APPROVER'));
  assert.ok(approverOrg, 'scenario data names an APPROVER organisation');
  const approval = await service.recordApproval({
    caseId: signalResult.caseId,
    intentId: begin.intent.id,
    decidedBy: { entityType: 'ORGANISATION', id: approverOrg.id },
    decidedAt: APPROVAL_AT,
    verdict: 'APPROVED',
    note: 'travel-desk approval for return rebooking',
  });
  assert.equal(approval.accepted, true);
  assert.equal(approval.caseStatus, 'READY_TO_EXECUTE');

  // -- Stage 5: gate-checked execution -> observation -> verification ---------
  const execution = await service.executeApproved({
    caseId: signalResult.caseId,
    intentId: begin.intent.id,
    at: EXECUTE_AT,
  });
  assert.equal(execution.executed, true);
  assert.equal(execution.result?.provenance, 'SIMULATED', 'provider action simulated only at the boundary');
  assert.equal(execution.observation?.stateUpdated, true);
  assert.equal(execution.caseStatus, 'RESOLVED');
  assert.equal(
    execution.verification?.resolution?.outcome,
    spec.expectations.recovery.expectedResolution,
  );
  assert.deepEqual(
    execution.verification?.remainingLossRefs,
    spec.expectations.recovery.remainingLossObjectiveIds,
  );

  // Observed authoritative state: confirmed replacement element AND the
  // waived objective both landed through validated PROVIDER-origin mutations.
  const recoveredLeg = ((await harness.trips.getTrip(spec.trip.id))!.elements.find(
    (element) => element.id === cancelledLeg.id,
  )) as TransportLeg;
  assert.equal(recoveredLeg.reservationState, 'CONFIRMED');
  assert.equal(recoveredLeg.data.bookingRef?.reference, CHEAPEST_OFFER_ID);
  assert.equal(recoveredLeg.data.scheduledArrival?.value, cheapestOffer.arrival, 'confirmed arrival matches REPLAY-normalized evidence');
  assert.equal(recoveredLeg.data.scheduledArrival?.authority, 'AUTHORITATIVE', 'execution instant upgrades element facts');
  const recoveredObjective = (await harness.trips.getTrip(spec.trip.id))!.objectives.find(
    (objective) => objective.id === waiveReturn.objectiveId,
  )!;
  assert.equal(recoveredObjective.status, 'WAIVED', 'waiver survives execution observation into authoritative state');

  // -- Stage 6: read models reconstruct the resolved-with-loss state ----------
  const readDeps = readModelDeps(harness);
  const dashboard = await projectOperatorDashboard(readDeps, READ_AT);
  const tripRow = dashboard.trips.find((row) => row.tripId === spec.trip.id);
  assert.equal(tripRow?.status, 'RESOLVED');
  const detail = (await projectCaseDetail(readDeps, signalResult.caseId, READ_AT))!;
  assert.equal(detail.resolution?.outcome, 'RECOVERED_WITH_LOSS');
  assert.ok(detail.options.some((option) => option.verdict === 'NOT_VIABLE' && option.rejectionReason));
  const travellerView = (await projectTravellerTrip(readDeps, spec.trip.id, READ_AT))!;
  assert.equal(travellerView.remainderViable, 'AT_RISK', 'soft hotel refund-window failure stays visible after recovery');

  // Full audit chain including the refused wrong-principal approval.
  const actions = (await harness.audit.query({ subject: spec.trip.id })).map((entry) => entry.action);
  for (const expected of [
    'SIGNAL_PROCESSED',
    'PLANNING_COMPLETED',
    'AUTHORITY_DECIDED',
    'APPROVAL_REJECTED',
    'APPROVAL_RECORDED',
    'EXECUTION_COMPLETED',
    'CASE_VERIFIED',
  ]) {
    assert.ok(actions.includes(expected), `audit chain must include ${expected}`);
  }

  // -- Stage 7: restart — everything reconstructs from SQLite -----------------
  harness.db.close();
  const reloaded = createHarness(dbPath);
  const reloadedCase = (await reloaded.cases.getCase(signalResult.caseId))!;
  assert.equal(reloadedCase.status, 'RESOLVED');
  assert.equal(reloadedCase.resolution?.outcome, 'RECOVERED_WITH_LOSS');
  assert.deepEqual(reloadedCase.resolution?.remainingLossRefs, spec.expectations.recovery.remainingLossObjectiveIds);
  assert.equal(reloadedCase.strategies.length, 3);
  assert.equal(reloadedCase.executionResults[0]!.provenance, 'SIMULATED');
  const reloadedLeg = ((await reloaded.trips.getTrip(spec.trip.id))!.elements.find(
    (element) => element.id === cancelledLeg.id,
  )) as TransportLeg;
  assert.equal(reloadedLeg.reservationState, 'CONFIRMED');
  const reloadedObjective = (await reloaded.trips.getTrip(spec.trip.id))!.objectives.find(
    (objective) => objective.id === waiveReturn.objectiveId,
  )!;
  assert.equal(reloadedObjective.status, 'WAIVED');

  const reloadedReadDeps = readModelDeps(reloaded);
  const reloadedDashboard = await projectOperatorDashboard(reloadedReadDeps, READ_AT);
  assert.equal(reloadedDashboard.trips.find((row) => row.tripId === spec.trip.id)?.status, 'RESOLVED');
  const reloadedDetail = (await projectCaseDetail(reloadedReadDeps, signalResult.caseId, READ_AT))!;
  assert.equal(reloadedDetail.resolution?.outcome, 'RECOVERED_WITH_LOSS');
  assert.equal(reloadedDetail.options.length, 3);
  reloaded.db.close();
});
