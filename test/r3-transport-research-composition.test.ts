/**
 * R3 Lane A — normal runtime transport-research composition (Cloud-runnable).
 *
 * Proves, without PostgreSQL:
 *   1. composeTargetTransportResearch supplies a read-only transport + a
 *      state-derived passengersFor resolver from REPLAY config;
 *   2. absent/dishonest capability fails closed (LIVE without credentials
 *      composes nothing);
 *   3. REPLAY provenance flows through the corridor -> request -> transport
 *      pipeline the coordinator calls;
 *   4. provider failure stays visible FAILED evidence, never fabricated success;
 *   5. passenger derivation is data-driven: allocations first, else the journey's
 *      own 1:1 traveller, else fail closed — no passenger constant anywhere;
 *   6. no consequential provider operation is reachable from planning research.
 *
 * Airport codes/paths here are TEST FIXTURE data describing the checked-in
 * recording under replay; the composed code itself hardcodes none of them.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadConfig } from '../src/config/config.ts';
import { composeTargetTransportResearch } from '../src/app/targetTransportResearch.ts';
import {
  travellersForJourneyItemPassengers,
  transportCorridors,
  flightSearchRequestFor,
  transportRequestId,
} from '../src/resolution/planning/transportCorridors.ts';
import { materializeTransportOffers } from '../src/resolution/planning/transportOfferMaterialization.ts';
import { correlatedTransportOffers } from '../src/resolution/planning/proposers/transportProposer.ts';
import { createPlanningToolTransport } from '../src/resolution/planning/replayPlanningTransport.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { dispatchToolRequest } from '../src/app/dispatch.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { connectionEvaluator } from '../src/resolution/evaluation/evaluators/connection.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import type { FailingSubject } from '../src/resolution/planning/proposer.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { AssessmentResultSchema } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { emptyWorld, id } from './support/m6World.ts';
import type { WConstraintDefinition, WJourney, WJourneyItem, WPlace, WTransportService } from '../src/resolution/world/world.ts';
import type { PlanningToolResult } from '../src/contracts/v2/planning/planningTool.ts';

const ORIGIN_PLACE = 'place-origin';
const DEST_PLACE = 'place-dest';
const ORIGIN_IATA = 'MNL';
const DEST_IATA = 'CEB';
const MANILA = 'Asia/Manila';
const WINDOW_START = '2026-09-05T00:00:00.000Z';

const resolveAirport = (placeId: string) =>
  placeId === ORIGIN_PLACE ? { system: 'IATA', value: ORIGIN_IATA }
    : placeId === DEST_PLACE ? { system: 'IATA', value: DEST_IATA }
      : undefined;

function placeRow(placeId: string): WPlace {
  return { id: placeId, revision: 1, name: placeId, placeType: 'AIRPORT', timeZone: MANILA, hasCoordinates: true };
}

function journeyRow(tripId: string, travellerId: string): WJourney {
  return {
    id: id(), revision: 1, tripId, travellerId,
    lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
  };
}

function transportItem(journeyId: string): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: true,
    intendedWindow: { start: WINDOW_START, end: '2026-09-05T06:00:00.000Z' },
    desiredOriginPlaceId: ORIGIN_PLACE, desiredDestinationPlaceId: DEST_PLACE, selectedServiceId: null,
    intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null,
    standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
  };
}

function allocationRow(travellerId: string, itemId: string, role: string) {
  return {
    id: id(), reservationId: id(), lineId: id(), travellerId, journeyItemId: itemId, role, quantity: 1,
  };
}

const NOW = '2026-09-04T22:00:00.000Z';

function failingJourney(journeyId: string): FailingSubject {
  const subject: TypedRef = { kind: 'JOURNEY', id: journeyId };
  const explanation = explain({
    evaluatorId: 'test.r3', dimension: 'stub', status: 'FAIL', reasonCode: 'blocked',
    cause: { kind: 'WORLD_STATE' }, affectedSubject: subject,
  });
  const assessment: AssessmentResult = AssessmentResultSchema.parse({
    id: id(), kind: 'VIABILITY', evaluatedAt: NOW, manifest: emptyWorld().manifest,
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }],
    overallVerdict: 'FAIL',
    dimensions: [dimension({ dimension: 'stub', explanations: [explanation] })],
  });
  return { subject, assessment };
}

describe('R3 transport research composition', () => {
  test('composes an honest REPLAY research seam from config (capability present)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'r3laneA-'));
    try {
      const env = {
        ADAPTER_MODE: 'REPLAY',
        PG_TARGET_WORKSPACE_ID: randomUUID(),
      };
      const research = composeTargetTransportResearch(loadConfig(env), process.cwd());
      assert.ok(research, 'REPLAY config must compose the research seam');
      assert.equal(typeof research.transport, 'function');
      assert.equal(typeof research.passengersFor, 'function');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('LIVE without credentials fails closed: no capability is composed', () => {
    const env = {
      ADAPTER_MODE: 'LIVE',
      PG_TARGET_WORKSPACE_ID: randomUUID(),
    };
    const research = composeTargetTransportResearch(loadConfig(env, mkdtempSync(join(tmpdir(), 'r3-nodotenv-'))), process.cwd());
    assert.equal(research, undefined, 'LIVE without credentials must not fabricate a capability');
  });

  test('passenger derivation: allocations first, else journey 1:1 traveller, else fail closed', () => {
    const world = emptyWorld();
    const travellerA = id();
    const travellerB = id();
    const journey = journeyRow(id(), travellerA);
    const item = transportItem(journey.id);

    world.journeys = [journey];
    world.allocations = [allocationRow(travellerA, item.id, 'TRAVELLER'), allocationRow(travellerB, item.id, 'COMPANION')];
    assert.deepEqual(travellersForJourneyItemPassengers(world, item.id, journey.id), { adults: 2 });

    world.allocations = [];
    assert.deepEqual(travellersForJourneyItemPassengers(world, item.id, journey.id), { adults: 1 });

    const orphanWorld = emptyWorld();
    const orphanItem = transportItem(id());
    const orphanResult = travellersForJourneyItemPassengers(orphanWorld, orphanItem.id, id());
    assert.ok('unknown' in orphanResult);
  });

  test('corridor derivation honours the resolver over the static value and fails closed on an unknown party', () => {
    const world = emptyWorld();
    const journey = journeyRow(id(), id());
    const item = transportItem(journey.id);
    world.journeys = [journey];
    world.journeyItems = [item];
    world.places = [placeRow(ORIGIN_PLACE), placeRow(DEST_PLACE)];

    const withResolver = transportCorridors(world, [failingJourney(journey.id)], {
      resolveAirport,
      passengersFor: ({ journeyItemId }) =>
        journeyItemId === item.id ? { adults: 3 } : { unknown: true, reason: 'test' },
    });
    assert.equal(withResolver.corridors.length, 1);
    assert.deepEqual(withResolver.corridors[0]!.passengers, { adults: 3 });

    const staticShape = transportCorridors(world, [failingJourney(journey.id)], { resolveAirport, passengers: { adults: 5 } });
    assert.deepEqual(staticShape.corridors[0]!.passengers, { adults: 5 });

    const failClosed = transportCorridors(world, [failingJourney(journey.id)], { resolveAirport });
    assert.equal(failClosed.corridors.length, 0);
    assert.deepEqual(
      failClosed.gaps.map((g) => g.reasonCode),
      ['passengers_unknown'],
      'an underivable party must fail closed, never fabricate a corridor',
    );
  });

  test('the corridor request the coordinator dispatches is read-only flight.search', async () => {    const world = emptyWorld();
    const journey = journeyRow(id(), id());
    const item = transportItem(journey.id);
    world.journeys = [journey];
    world.journeyItems = [item];
    world.places = [placeRow(ORIGIN_PLACE), placeRow(DEST_PLACE)];

    const { corridors } = transportCorridors(world, [failingJourney(journey.id)], { resolveAirport, passengers: { adults: 1 } });
    assert.equal(corridors.length, 1);
    const request = flightSearchRequestFor(corridors[0]!, { round: 1 });
    assert.equal(request.capability, 'FLIGHT');
    assert.equal(request.operation, 'flight.search');

    // No capability injected: dispatch must refuse, never fabricate. This also
    // proves the request the coordinator sends is the read-only search shape.
    const result = await dispatchToolRequest({}, {
      id: request.id,
      capability: request.capability,
      operation: request.operation,
      parameters: request.parameters,
      purpose: request.purpose,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.category, 'UNAVAILABLE');
      assert.equal(result.error.code, 'capability_not_wired');
    }
  });

  test('materialization honours the resolver-only passenger arm (regression: passengersFor must not be dropped)', async () => {
    // This is the boot shape: { transport, passengersFor } with NO static
    // passengers value. A regression that forwarded only `passengers` into
    // materializeTransportOffers would fail every corridor with
    // passengers_unknown and produce zero planning services.
    const world = emptyWorld();
    const journey = journeyRow(id(), id());
    const item = transportItem(journey.id);
    world.journeys = [journey];
    world.journeyItems = [item];
    world.places = [placeRow(ORIGIN_PLACE), placeRow(DEST_PLACE)];

    const adapter = new AtlasFlightAdapter({
      mode: 'REPLAY',
      store: new FileRecordingStore({ readDirs: ['fixtures/recordings'] }),
      timezoneResolver: (code: string) => (code === ORIGIN_IATA || code === DEST_IATA ? MANILA : undefined),
    });
    const transport = createPlanningToolTransport({ capabilities: { flight: adapter }, observedAt: NOW });

    // adults:1 is the EXPECTED value matching the checked-in recording's
    // captured party; the assertion is on derivation, not a runtime constant.
    const { corridors } = transportCorridors(world, [failingJourney(journey.id)], { resolveAirport, passengersFor: () => ({ adults: 1 }) });
    assert.equal(corridors.length, 1);
    assert.deepEqual(corridors[0]!.passengers, { adults: 1 }, 'the resolver-derived party is used, not a static default');
    const request = flightSearchRequestFor(corridors[0]!, { round: 1 });
    const result = await transport(request);
    assert.equal(result.status, 'SUCCEEDED');

    const materialized = materializeTransportOffers({
      world,
      failing: [failingJourney(journey.id)],
      toolResults: [{ ...result, requestId: transportRequestId(corridors[0]!) }],
      now: NOW,
      resolveAirport,
      passengersFor: () => ({ adults: 1 }),
    });
    assert.ok(
      materialized.capturedServices.length > 0,
      'resolver-only arm must still materialize researched offers into the planning world',
    );
  });

  test('a canonical failed connection widens only its downstream corridor to the next local day', () => {
    const travellerId = id();
    const journey = journeyRow(id(), travellerId);
    const upstreamOrigin = id();
    const hub = id();
    const destination = id();
    const inbound = transportItem(journey.id);
    inbound.orderKey = '010';
    inbound.desiredOriginPlaceId = upstreamOrigin;
    inbound.desiredDestinationPlaceId = hub;
    inbound.intendedWindow = { start: '2030-01-01T08:00:00.000Z', end: '2030-01-01T12:30:00.000Z' };
    const onward = transportItem(journey.id);
    onward.orderKey = '020';
    onward.desiredOriginPlaceId = hub;
    onward.desiredDestinationPlaceId = destination;
    onward.intendedWindow = { start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T14:00:00.000Z' };
    const upstreamService: WTransportService = {
      id: id(), revision: 1, mode: 'AIR', operator: 'carrier', originPlaceId: upstreamOrigin, destinationPlaceId: hub,
      published: { departure: { value: '2030-01-01T08:00:00.000Z', observedAt: NOW, evidenceId: null }, arrival: { value: '2030-01-01T12:30:00.000Z', observedAt: NOW, evidenceId: null } },
      estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
    };
    inbound.selectedServiceId = upstreamService.id;
    const connectionConstraint: WConstraintDefinition = {
      id: id(), revision: 1, registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'JOURNEY', id: journey.id }, provenanceEvidenceId: null,
      operands: [{ key: 'minutes', kind: 'NUMBER', subject: null, text: null, number: '60', boolean: null, instant: null, localDate: null }],
    };
    const world = emptyWorld({
      travellers: [{ id: travellerId, revision: 1, lifecycleStatus: 'ACTIVE' }], journeys: [journey], journeyItems: [inbound, onward], transportServices: [upstreamService], constraints: [connectionConstraint],
      places: [
        { id: upstreamOrigin, revision: 1, name: 'Upstream', placeType: 'AIRPORT', timeZone: 'America/Los_Angeles', hasCoordinates: true },
        { id: hub, revision: 1, name: 'Hub', placeType: 'AIRPORT', timeZone: 'Pacific/Auckland', hasCoordinates: true },
        { id: destination, revision: 1, name: 'Destination', placeType: 'AIRPORT', timeZone: 'Asia/Singapore', hasCoordinates: true },
      ],
    });
    const subject: TypedRef = { kind: 'JOURNEY', id: journey.id };
    const connection = connectionEvaluator.evaluate(subject, { now: NOW, world, effective: projectEffectiveWorld(world) });
    assert.equal(connection.dimensions[0]?.verdict, 'FAIL', 'the canonical M6 evaluator supplies the extension gate');
    const assessment = AssessmentResultSchema.parse({
      id: id(), kind: 'VIABILITY', evaluatedAt: NOW, manifest: world.manifest,
      subjects: [{ subjectRef: subject, role: 'PRIMARY' }], overallVerdict: 'FAIL', dimensions: connection.dimensions,
    });
    const resolveAirport = (placeId: string) => ({ system: 'IATA', value: placeId });
    const failing: FailingSubject[] = [{ subject, assessment }];
    const widened = transportCorridors(world, failing, { resolveAirport, passengers: { adults: 1 } });
    const onwardCorridors = widened.corridors.filter((corridor) => corridor.journeyItemId === onward.id);
    // The hub is UTC+13 here: the upstream arrival is 01:30 on Jan 2 while
    // the intended onward departure was Jan 1 locally. Jan 1 is impossible.
    assert.deepEqual(onwardCorridors.map((corridor) => corridor.departureDate), ['2030-01-02', '2030-01-03']);
    assert.equal(new Set(onwardCorridors.map(transportRequestId)).size, 2, 'each bounded date has its own correlation identity');

    const resultFor = (corridor: typeof onwardCorridors[number], rawOfferId: string): PlanningToolResult => ({
      requestId: transportRequestId(corridor), capability: 'FLIGHT', operation: 'flight.search', status: 'SUCCEEDED',
      normalizedEvidence: { offers: [{ offerId: rawOfferId, segments: [{ origin: corridor.origin, destination: corridor.destination, departure: `${corridor.departureDate}T12:00:00.000Z`, arrival: `${corridor.departureDate}T14:00:00.000Z` }], totalPrice: { amount: 100, currency: 'USD' }, availability: 'AVAILABLE' }] },
      provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [] }, uncertainty: [],
    });
    const results = onwardCorridors.map((corridor, index) => resultFor(corridor, `offer-${index}`));
    const correlated = correlatedTransportOffers({ corridors: widened.corridors, toolResults: results, now: NOW, maxOffersPerCorridor: 6 });
    assert.deepEqual(correlated.offers.map((offer) => offer.requestId).sort(), results.map((result) => result.requestId).sort());
    const materialized = materializeTransportOffers({ world, failing, toolResults: results, now: NOW, resolveAirport, passengers: { adults: 1 } });
    assert.equal(materialized.capturedServices.length, 2, 'both date-specific results materialize through their own corridor');
    assert.equal(world.transportServices.length, 1, 'research did not mutate the canonical world');

    const unboardableService: WTransportService = {
      ...upstreamService, id: id(), originPlaceId: hub, destinationPlaceId: destination,
      published: { departure: { value: '2030-01-01T11:00:00.000Z', observedAt: NOW, evidenceId: null }, arrival: { value: '2030-01-01T13:00:00.000Z', observedAt: NOW, evidenceId: null } },
    };
    const candidateWorld = structuredClone(world);
    candidateWorld.transportServices.push(unboardableService);
    const unboardableOfferId = id();
    const rejected = evaluateRecoveryStrategy({
      recoveryCaseId: id(), basisAssessmentId: assessment.id, baseWorld: candidateWorld, baseManifest: candidateWorld.manifest, now: NOW,
      scenarioChange: ScenarioChangeSchema.parse({
        id: id(), recoveryStrategyId: id(), strategyVersion: 1, basisAssessmentId: assessment.id,
        affectedSubjectRefs: [subject], effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: onward.id, offerId: unboardableOfferId, offerPrice: { amount: '100.00', currency: 'USD' } }],
      }),
      resolvedOffers: [{ offerId: unboardableOfferId, transportServiceId: unboardableService.id }], resolveSubjectRefs: [subject], registry: createM6Registry(),
    });
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.equal(rejected.value.strategy.viability, 'NOT_VIABLE', 'RC-6 rejects a selected service that leaves the connection unboardable');

    const ordinary = transportCorridors(world, [failingJourney(journey.id)], { resolveAirport, passengers: { adults: 1 } });
    assert.deepEqual(
      ordinary.corridors.filter((corridor) => corridor.journeyItemId === onward.id).map((corridor) => corridor.departureDate),
      ['2030-01-01'],
      'a generic non-connection failure keeps the original one-date search',
    );
  });
});
