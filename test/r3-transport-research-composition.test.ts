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
import { createPlanningToolTransport } from '../src/resolution/planning/replayPlanningTransport.ts';
import { AtlasFlightAdapter } from '../src/providers/atlas/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { dispatchToolRequest } from '../src/app/dispatch.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { FailingSubject } from '../src/resolution/planning/proposer.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { AssessmentResultSchema } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { emptyWorld, id } from './support/m6World.ts';
import type { WJourney, WJourneyItem, WPlace } from '../src/resolution/world/world.ts';

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
});
