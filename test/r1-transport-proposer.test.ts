/**
 * R1 — provider-assisted TRANSPORT proposer + the domain-agnostic offer seam.
 *
 * Proves the concrete generalized TRANSPORT recovery path the R1 product truth
 * requires, end to end in PURE Cloud (no PostgreSQL, no LIVE provider, no model,
 * no credentials):
 *
 *   1. PROPOSER PORT — fed real `flight.search` evidence replayed from a CHECKED-IN
 *      Atlas recording through the production transport, the proposer emits ranked,
 *      bounded `SELECT_OFFER` candidates with deterministic SubjectId-safe offer
 *      keys (the raw Atlas routingIdentifier is NOT SubjectId-safe and is never
 *      used as a subject id) and exact decimal prices.
 *   2. BOARDABILITY — an offer whose first segment departs before `now` is dropped
 *      honestly (a filter, never a viability claim).
 *   3. COORDINATOR (post-materialization) — through the SAME `runRecoveryPlanning`
 *      the generality test uses, the TRANSPORT domain activates from a real M6
 *      blocking dimension, research is dispatched over REPLAY, and a SELECT_OFFER
 *      whose service is captured flips the failing journey FAIL->PASS => a VIABLE,
 *      RECOMMENDED strategy => AWAITING_AUTHORITY. Seeding the transport services
 *      represents the post-materialization captured state (materializing a
 *      net-new researched offer into a service is a persistence/runtime concern —
 *      LOCAL handoff item — never fabricated by the proposer or the overlay).
 *   4. ANTI-FABRICATION — when the selected offer's service is NOT captured, the
 *      real overlay rejects the SELECT_OFFER ("cannot fabricate supplier
 *      selection") and the coordinator yields an honest NO_RECOVERY_FOUND with the
 *      rejection retained as material evidence.
 *
 * The same coordinator/contracts serve TRANSPORT here and PROGRAMME/STAY in
 * r1-coordinator-generality.test.ts — no scenario branch, the domain comes from
 * the registry and the effect from the proposer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, id } from './support/m6World.ts';
import type { TypedRef, SubjectId } from '../src/domain/v2/shared/identity.ts';
import type { CapturedWorld, WJourney, WJourneyItem, WPlace, WTransportService } from '../src/resolution/world/world.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { AssessmentResultSchema } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { defaultRecoveryDomainRegistry } from '../src/resolution/planning/recoveryDomains.ts';
import {
  runRecoveryPlanning,
  type CoordinatorCoreDeps,
  type CoordinatorMinters,
  type PlanningBasis,
} from '../src/resolution/planning/coordinatorCore.ts';
import { transportCorridors, flightSearchRequestFor } from '../src/resolution/planning/transportCorridors.ts';
import {
  createTransportProposer,
  resolveTransportOffers,
  prospectiveTransportServiceId,
  transportOfferKey,
  TRANSPORT_PROPOSER_ID,
} from '../src/resolution/planning/proposers/transportProposer.ts';
import type { DomainProposerInput } from '../src/contracts/v2/planning/proposerAdaptation.ts';
import type { PlanningToolResult } from '../src/contracts/v2/planning/planningTool.ts';
import { createPlanningToolTransport } from '../src/resolution/planning/replayPlanningTransport.ts';
import { materializeTransportOffers } from '../src/resolution/planning/transportOfferMaterialization.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import type { FlightSearchOutcome } from '../src/contracts/capabilities.ts';

// `now` precedes every departure in the checked-in MNL->CEB 2026-09-05 recording
// so all offers are boardable; the boardability test moves `now` past them.
const NOW = '2026-09-01T00:00:00.000Z';
const AFTER_ALL_DEPARTURES = '2026-09-06T00:00:00.000Z';
const OBSERVED_AT = '2026-09-01T00:00:00.000Z';
const COORDINATOR_VERSION = 'r1-coordinator/1';
const COMPARATOR_VERSION = 'r1-comparator/1';
const FIXTURES = 'fixtures/recordings';
const MANILA = 'Asia/Manila';

// The checked-in recording is MNL->CEB on 2026-09-05 (Asia/Manila). These airport
// codes are TEST FIXTURE data describing the recording under replay, not
// production routing logic — the proposer/corridor code itself hardcodes nothing
// and takes the resolver + passengers as injected dependencies.
const ORIGIN_PLACE = 'place-origin';
const DEST_PLACE = 'place-dest';
const ORIGIN_IATA = 'MNL';
const DEST_IATA = 'CEB';
const DEPARTURE_WINDOW_START = '2026-09-05T00:00:00.000Z';

const PASSENGERS = { adults: 1 } as const;

function placeRow(placeId: string, name: string): WPlace {
  return { id: placeId, revision: 1, name, placeType: 'AIRPORT', timeZone: MANILA, hasCoordinates: true };
}

function journeyRow(travellerId: string): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null };
}

function transportItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: true,
    intendedWindow: { start: DEPARTURE_WINDOW_START, end: '2026-09-05T06:00:00.000Z' },
    desiredOriginPlaceId: ORIGIN_PLACE, desiredDestinationPlaceId: DEST_PLACE, selectedServiceId: null,
    intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null,
    standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

/** A captured transport service standing in for a materialized researched offer. */
function serviceRow(serviceId: string): WTransportService {
  const dep = { value: '2026-09-05T12:00:00.000Z', observedAt: OBSERVED_AT, evidenceId: null };
  const arr = { value: '2026-09-05T13:30:00.000Z', observedAt: OBSERVED_AT, evidenceId: null };
  return {
    id: serviceId, revision: 1, mode: 'FLIGHT', operator: 'carrier', originPlaceId: ORIGIN_PLACE, destinationPlaceId: DEST_PLACE,
    published: { departure: dep, arrival: arr }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
  };
}

const resolveAirport = (placeId: string) =>
  placeId === ORIGIN_PLACE ? { system: 'IATA', value: ORIGIN_IATA }
    : placeId === DEST_PLACE ? { system: 'IATA', value: DEST_IATA }
      : undefined;

function replayTransport() {
  const adapter = new AtlasFlightAdapter({
    mode: 'REPLAY',
    store: new FileRecordingStore({ readDirs: [FIXTURES] }),
    timezoneResolver: (code: string) => (code === ORIGIN_IATA || code === DEST_IATA ? MANILA : undefined),
  });
  return createPlanningToolTransport({ capabilities: { flight: adapter }, observedAt: OBSERVED_AT });
}

function failingAssessment(subject: TypedRef, dimensionCode: string): AssessmentResult {
  const explanation = explain({
    evaluatorId: 'test.transport', dimension: dimensionCode, status: 'FAIL', reasonCode: 'blocked',
    cause: { kind: 'WORLD_STATE' }, affectedSubject: subject,
  });
  return AssessmentResultSchema.parse({
    id: id(), kind: 'VIABILITY', evaluatedAt: NOW, manifest: emptyWorld().manifest,
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }],
    overallVerdict: 'FAIL',
    dimensions: [dimension({ dimension: dimensionCode, explanations: [explanation] })],
  });
}

/** Stub M6 registry: the journey is FAIL until its transport item has a selected service. */
function registryFlippingOnSelection(journeyId: string, itemId: string) {
  const evaluator: Evaluator = {
    id: 'test.transport-stub', version: '1', assessmentKind: 'VIABILITY',
    subjectKinds: ['JOURNEY'], dimensions: ['stub'], informationTopics: [],
    evaluate(subject, context) {
      const selected = context.world.journeyItems.find((i) => i.id === itemId)?.selectedServiceId ?? null;
      const verdict = subject.id === journeyId && selected === null ? 'FAIL' : 'PASS';
      return {
        dimensions: [dimension({ dimension: 'stub', explanations: [explain({ evaluatorId: 'test.transport-stub', dimension: 'stub', status: verdict, reasonCode: verdict === 'PASS' ? 'ok' : 'blocked', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject })] })],
        evidence: [], missingCoverage: [],
      };
    },
  };
  return createEvaluatorRegistry([evaluator]);
}

function minters(): CoordinatorMinters {
  return {
    attemptId: id() as SubjectId,
    startedAt: NOW,
    mintStrategyId: (key) => `strategy:${key}` as SubjectId,
    mintScenarioChangeId: (sid) => `change:${sid}` as SubjectId,
    baseStrategyVersion: 1,
  };
}

interface TransportBasis {
  basis: PlanningBasis;
  itemId: string;
  journeyId: string;
  world: CapturedWorld;
}

/**
 * Build a failing-TRANSPORT basis. `materializeOffers` seeds the captured world
 * with a transport service per replayed offer id (the post-materialization state
 * the overlay needs to honor a SELECT_OFFER); when false the services are absent
 * so the overlay must reject every selection.
 */
async function transportBasis(opts: { materializeOffers: boolean }): Promise<TransportBasis> {
  const traveller = id();
  const journey = journeyRow(traveller);
  const item = transportItem(journey.id);
  const world = emptyWorld({
    travellers: [{ id: traveller, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [journey],
    journeyItems: [item],
    places: [placeRow(ORIGIN_PLACE, 'origin'), placeRow(DEST_PLACE, 'dest')],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });

  const subject: TypedRef = { kind: 'JOURNEY', id: journey.id };
  const assessment = failingAssessment(subject, 'connection_feasibility');

  // Replay the corridor once to learn the real normalized offer ids, then (when
  // materializing) seed a captured service per offer using the SAME deterministic
  // id the proposer will reference. This is the honest post-materialization state.
  const { corridors } = transportCorridors(world, [{ subject, assessment }], { resolveAirport, passengers: PASSENGERS });
  const request = flightSearchRequestFor(corridors[0]!, { round: 1 });
  const result = await replayTransport()(request);
  const offers = (result.normalizedEvidence as FlightSearchOutcome).offers;
  if (opts.materializeOffers) {
    world.transportServices = offers.map((o) => serviceRow(prospectiveTransportServiceId(item.id, o.offerId)));
  }
  const registry = registryFlippingOnSelection(journey.id, item.id);
  const basis: PlanningBasis = {
    workspaceId: world.workspaceId, recoveryCaseId: id() as SubjectId, basisAssessmentId: assessment.id as SubjectId,
    reason: 'CASE_OPENED', now: NOW, world, effective: projectEffectiveWorld(world), failing: [{ subject, assessment }], registry,
  };
  return { basis, itemId: item.id, journeyId: journey.id, world };
}

/** The research + offer-resolution deps the coordinator needs for TRANSPORT. */
function transportDeps(
  world: CapturedWorld,
  failing: PlanningBasis['failing'],
): Pick<CoordinatorCoreDeps, 'research' | 'resolveOffersForDomain'> {
  const transport = replayTransport();
  const { corridors } = transportCorridors(world, failing, { resolveAirport, passengers: PASSENGERS });
  const requests = corridors.map((c) => flightSearchRequestFor(c, { round: 1 }));
  return {
    research: { transport, requestsByDomain: { TRANSPORT: [requests] } },
    resolveOffersForDomain: ({ evidence }) =>
      resolveTransportOffers({
        world, failing, now: NOW, resolveAirport, passengers: PASSENGERS,
        toolResults: evidence.toolResults,
      }).resolvedOffers,
  };
}

/** Build a typed DomainProposerInput for a direct proposer-port test. */
function domainInput(
  basis: PlanningBasis,
  toolResults: readonly PlanningToolResult[],
  over: Partial<DomainProposerInput> = {},
): DomainProposerInput {
  return {
    workspaceId: basis.workspaceId,
    recoveryCaseId: basis.recoveryCaseId,
    now: basis.now,
    failing: basis.failing,
    world: basis.world,
    effective: basis.effective,
    domain: 'TRANSPORT',
    evidence: { domainId: 'TRANSPORT', toolResults, evidenceRefs: ['evidence:req-1'] },
    preferences: [],
    ...over,
  };
}

test('transport proposer: replays checked-in evidence into ranked, bounded, SubjectId-safe SELECT_OFFER candidates', async () => {
  const { basis, itemId, journeyId } = await transportBasis({ materializeOffers: false });
  const { corridors } = transportCorridors(basis.world, basis.failing, { resolveAirport, passengers: PASSENGERS });
  const request = flightSearchRequestFor(corridors[0]!, { round: 1 });
  const result = await replayTransport()(request);
  const offers = (result.normalizedEvidence as FlightSearchOutcome).offers;
  assert.ok(offers.length > 0, 'the checked-in recording replays to real normalized offers');

  const proposer = createTransportProposer({ resolveAirport, passengers: PASSENGERS });
  const candidates = await proposer.propose(domainInput(basis, [result]));

  assert.ok(candidates.length > 0, 'offers become candidates');
  assert.ok(candidates.length <= offers.length, 'never more candidates than offers');
  for (const c of candidates) {
    const effect = c.effects[0]!;
    assert.equal(effect.effectKind, 'SELECT_OFFER');
    if (effect.effectKind !== 'SELECT_OFFER') continue;
    assert.equal(effect.journeyItemId, itemId);
    // The offer key is deterministic + SubjectId-safe; the raw routingIdentifier is not.
    assert.match(effect.offerId, /^transport-offer:[0-9a-f]{32}$/);
    assert.ok(!effect.offerId.includes('|') && !effect.offerId.includes('='), 'raw provider id never leaks as a subject id');
    assert.ok(effect.offerPrice && /^\d+\.\d{2}$/.test(effect.offerPrice.amount), 'price is an exact decimal string');
    assert.equal(effect.offerPrice.currency, 'USD');
    // affectedSubjectRefs name the journey item, its journey, and the offer.
    assert.ok(c.affectedSubjectRefs.some((r) => r.kind === 'JOURNEY_ITEM' && r.id === itemId));
    assert.ok(c.affectedSubjectRefs.some((r) => r.kind === 'JOURNEY' && r.id === journeyId));
    assert.ok(c.affectedSubjectRefs.some((r) => r.kind === 'OFFER'));
    // The honest materialization assumption is recorded, never asserted as done.
    assert.ok(c.assumptions.some((a) => a.code === 'selected_service_captured_before_execution'));
  }
  // Ranked by fewest segments then lowest price (northstar ordering). All offers in
  // this recording are single-segment, so the cheapest ranks first.
  const prices = candidates.map((c) => Number((c.effects[0] as { offerPrice: { amount: string } }).offerPrice.amount));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'candidates are price-ascending within equal segment count');
  // The offer key derivation is stable and matches the standalone helper.
  const best = (result.normalizedEvidence as FlightSearchOutcome).offers
    .map((o) => ({ o, key: transportOfferKey(itemId, o.offerId) }))
    .sort((a, b) => a.o.totalPrice.amount - b.o.totalPrice.amount)[0]!;
  assert.ok(candidates.some((c) => (c.effects[0] as { offerId: string }).offerId === best.key));
});

test('transport proposer: an offer departing before now is filtered out (boardability), never proposed', async () => {
  const { basis } = await transportBasis({ materializeOffers: false });
  const { corridors } = transportCorridors(basis.world, basis.failing, { resolveAirport, passengers: PASSENGERS });
  const request = flightSearchRequestFor(corridors[0]!, { round: 1 });
  const result = await replayTransport()(request);

  const proposer = createTransportProposer({ resolveAirport, passengers: PASSENGERS });
  // `now` after every departure => nothing is boardable => no candidates.
  const candidates = await proposer.propose(domainInput(basis, [result], { now: AFTER_ALL_DEPARTURES }));
  assert.equal(candidates.length, 0, 'unboardable offers are dropped honestly');
});

test('transport domain end-to-end: a captured selected offer flips the journey FAIL->PASS => AWAITING_AUTHORITY', async () => {
  const { basis, itemId, world } = await transportBasis({ materializeOffers: true });
  const deps = transportDeps(world, basis.failing);
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'TRANSPORT', proposer: createTransportProposer({ resolveAirport, passengers: PASSENGERS }) }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
    ...deps,
  });

  // TRANSPORT activated from the real blocking dimension; PROGRAMME did not.
  assert.equal(out.attempt.domains.find((d) => d.domainId === 'TRANSPORT')?.disposition, 'INVESTIGATED');
  assert.equal(out.attempt.domains.find((d) => d.domainId === 'PROGRAMME')?.disposition, 'NOT_APPLICABLE');
  assert.ok(out.viableStrategies.length >= 1, 'a captured selected offer is VIABLE');
  assert.equal(out.result.outcome, 'AWAITING_AUTHORITY');
  assert.ok(out.attempt.recommendation, 'a VIABLE set yields a validated recommendation');
  // The recommended strategy carries a SELECT_OFFER effect on the failing journey item.
  const recommended = out.viableStrategies.find((s) => s.id === out.attempt.recommendation!.recommendedStrategyRef)!;
  const select = recommended.scenarioChange.effects.find((e) => e.effectKind === 'SELECT_OFFER');
  assert.ok(select, 'the recommended strategy selects an offer');
  if (select?.effectKind === 'SELECT_OFFER') assert.equal(select.journeyItemId, itemId);
  // Research evidence was gathered over REPLAY and recorded (bounded, factual).
  assert.ok(out.attempt.evidence.length >= 1, 'the flight.search read is recorded as evidence');
  assert.equal(out.attempt.evidence[0]!.provenance.mode, 'REPLAY');
  // The recommended candidate is retained with the three impact projections.
  const rec = out.attempt.materialCandidates.find((m) => m.disposition === 'RECOMMENDED')!;
  assert.equal(rec.domainId, 'TRANSPORT');
  assert.equal(rec.proposerId, TRANSPORT_PROPOSER_ID);
  assert.ok(rec.outcomeDelta.some((d) => d.delta === 'BETTER'));
});

test('anti-fabrication: an uncaptured selected offer is rejected by the overlay => honest NO_RECOVERY_FOUND', async () => {
  const { basis, world } = await transportBasis({ materializeOffers: false });
  const deps = transportDeps(world, basis.failing);
  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'TRANSPORT', proposer: createTransportProposer({ resolveAirport, passengers: PASSENGERS }) }],
    minters: minters(),
    coordinatorVersion: COORDINATOR_VERSION,
    comparatorVersion: COMPARATOR_VERSION,
    ...deps,
  });

  assert.equal(out.viableStrategies.length, 0, 'no offer is VIABLE without a captured service');
  assert.equal(out.result.outcome, 'NO_RECOVERY_FOUND');
  assert.equal(out.attempt.recommendation, undefined, 'never a silent pick');
  // The overlay rejection is retained as honest material evidence, naming the
  // anti-fabrication boundary rather than inventing a supplier selection.
  const rejected = out.attempt.materialCandidates.filter((m) => m.disposition === 'REJECTED_VALIDATION');
  assert.ok(rejected.length > 0, 'rejected candidates are retained as evidence');
  assert.ok(
    rejected.some((m) => m.validationReasonCodes.some((c) => /fabricate|not resolved|not in captured world/i.test(c))),
    'the rejection reason names the overlay anti-fabrication boundary',
  );
});

test('researched transport offers materialize only into an isolated planning world with provenance', async () => {
  const { basis, world, itemId } = await transportBasis({ materializeOffers: false });
  const { corridors } = transportCorridors(world, basis.failing, { resolveAirport, passengers: PASSENGERS });
  const result = await replayTransport()(flightSearchRequestFor(corridors[0]!, { round: 1 }));
  const materialized = materializeTransportOffers({
    world,
    failing: basis.failing,
    toolResults: [result],
    now: NOW,
    resolveAirport,
    passengers: PASSENGERS,
  });

  assert.equal(world.transportServices.length, 0, 'the captured canonical basis is not mutated');
  assert.ok(materialized.capturedServices.length > 0, 'a boardable searched offer becomes a planning-local service');
  assert.equal(materialized.world.reservations.length, 0, 'research never creates a reservation');
  const captured = materialized.capturedServices[0]!;
  assert.equal(captured.originPlaceId, ORIGIN_PLACE);
  assert.equal(captured.destinationPlaceId, DEST_PLACE);
  assert.ok(captured.researchedOffer?.rawOfferId, 'opaque provider offer reference is retained');
  assert.equal(captured.researchedOffer?.provenance.mode, 'REPLAY');
  assert.ok(captured.researchedOffer?.segments.length, 'provider segments are retained for later re-verification');
  assert.ok(materialized.resolvedOffers.some((offer) => offer.transportServiceId === captured.id));

  const out = await runRecoveryPlanning(basis, {
    domainRegistry: defaultRecoveryDomainRegistry(),
    availableCapabilities: ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH'],
    proposers: [{ domain: 'TRANSPORT', proposer: createTransportProposer({ resolveAirport, passengers: PASSENGERS }) }],
    minters: minters(), coordinatorVersion: COORDINATOR_VERSION, comparatorVersion: COMPARATOR_VERSION,
    research: { transport: replayTransport(), requestsByDomain: { TRANSPORT: [[flightSearchRequestFor(corridors[0]!, { round: 1 })]] } },
    materializeWorldForDomain: ({ domainId, evidence, basis: domainBasis }) => domainId === 'TRANSPORT'
      ? materializeTransportOffers({ world: domainBasis.world, failing: domainBasis.failing, toolResults: evidence.toolResults, now: NOW, resolveAirport, passengers: PASSENGERS })
      : undefined,
  });
  assert.ok(out.viableStrategies.length > 0, 'the same materialized evidence lets RC-6 evaluate a viable selection');
  assert.equal(out.result.outcome, 'AWAITING_AUTHORITY');
  assert.ok(out.viableStrategies.some((strategy) => strategy.scenarioChange.effects.some((effect) => effect.effectKind === 'SELECT_OFFER' && effect.journeyItemId === itemId)));
});
