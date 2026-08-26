/**
 * Focused regression: deterministic fallback planner overnight composition.
 *
 * - past-departure offers are excluded before strategy enumeration
 * - round 1 requests same-day AND next-day corridor searches
 * - boardable next-day offers become strategies once evidence arrives
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicFallbackPlanner } from '../src/intelligence/fallbackPlanner.ts';
import type { PlannerInput } from '../src/contracts/planner.ts';
import type { FlightOffer } from '../src/contracts/capabilities.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';
import type { ImpactAssessment } from '../src/operational/impact.ts';
import type { TripSignal } from '../src/operational/signal.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { Place } from '../src/domain/entities.ts';

const TRIP_ID = 'trip-test';
const CASE_ID = 'case-test';
const LEG_ID = 'el-leg-failed';
const PLAN_AT = '2026-09-29T21:30:00+09:00';

function place(id: string, code: string): Place {
  return {
    id,
    name: code,
    kind: 'AIRPORT',
    timezone: 'Asia/Tokyo',
    externalRefs: [{ system: 'airport-code', value: code }],
    servedByPlaceIds: [],
  };
}

function failedLeg(): TransportLeg {
  return {
    id: LEG_ID,
    tripId: TRIP_ID,
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
    reservationState: 'CANCELLED',
    status: 'INVALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'place-nrt',
      destinationPlaceId: 'place-sin',
      scheduledDeparture: {
        value: '2026-09-29T16:50:00+09:00',
        sourceId: 'src-test',
        authority: 'CONNECTED',
        observedAt: PLAN_AT,
      },
      scheduledArrival: {
        value: '2026-09-29T23:00:00+08:00',
        sourceId: 'src-test',
        authority: 'CONNECTED',
        observedAt: PLAN_AT,
      },
    },
  };
}

function offer(id: string, departure: string, arrival: string, amount: number): FlightOffer {
  return {
    offerId: id,
    segments: [
      {
        origin: { system: 'IATA', value: 'NRT' },
        destination: { system: 'IATA', value: 'SIN' },
        departure,
        arrival,
        carrierCode: 'TR',
        flightNumber: 'TR885',
      },
    ],
    totalPrice: { amount, currency: 'USD' },
    availability: 'AVAILABLE',
  };
}

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  const leg = failedLeg();
  const snapshot = {
    tripId: TRIP_ID,
    takenAt: PLAN_AT,
    trip: {
      id: TRIP_ID,
      travellerIds: ['trv-test'],
      elements: [leg],
      objectives: [],
      governedByRuleSetIds: [],
      status: 'DISRUPTED',
      updatedAt: PLAN_AT,
    },
    travellers: [],
    places: [place('place-nrt', 'NRT'), place('place-sin', 'SIN')],
    constraints: [],
    ruleSets: [],
  } as unknown as TripSnapshot;

  const impact = {
    tripId: TRIP_ID,
    signalId: 'sig-test',
    assessedAt: PLAN_AT,
    directFailures: [{ elementId: LEG_ID, reason: 'missed' }],
    affectedElements: [],
    threatenedObjectives: [],
    irreversibleLosses: [],
    policyImplications: [],
    insuranceImplications: [],
    severity: 'MEDIUM',
  } as unknown as ImpactAssessment;

  const signal = {
    id: 'sig-test',
    tripId: TRIP_ID,
    kind: 'TRAVELLER_STATE',
    sourceId: 'src-test',
    observedAt: PLAN_AT,
    payload: {},
  } as unknown as TripSignal;

  return {
    caseId: CASE_ID,
    snapshot,
    triggeringSignals: [signal],
    impact,
    capabilityRegistry: [],
    priorToolResults: [],
    priorActionResults: [],
    ...overrides,
  };
}

test('fallback planner round 1 requests same-day and next-day flight.search', async () => {
  const planner = new DeterministicFallbackPlanner({
    idFactory: (() => {
      let n = 0;
      return (prefix: string) => `${prefix}-${++n}`;
    })(),
  });
  const output = await planner.plan(baseInput());
  assert.equal(output.strategies.length, 0);
  assert.equal(output.toolRequests.length, 2);
  assert.equal(output.toolRequests[0]?.operation, 'flight.search');
  assert.equal(output.toolRequests[0]?.parameters['departureDate'], '2026-09-29');
  assert.equal(output.toolRequests[1]?.operation, 'flight.search');
  assert.equal(output.toolRequests[1]?.parameters['departureDate'], '2026-09-30');
});

test('fallback planner excludes offers that already departed before the snapshot instant', async () => {
  const planner = new DeterministicFallbackPlanner({
    idFactory: (() => {
      let n = 0;
      return (prefix: string) => `${prefix}-${++n}`;
    })(),
  });
  const past = offer('past', '2026-09-29T16:50:00+09:00', '2026-09-29T23:00:00+08:00', 84);
  const nextMorning = offer('morning', '2026-09-30T08:20:00+09:00', '2026-09-30T14:35:00+08:00', 115);
  const output = await planner.plan(
    baseInput({
      priorToolResults: [
        { toolRequestId: 'tool-1', summary: 'same-day', data: { offers: [past] } },
        { toolRequestId: 'tool-2', summary: 'next-day', data: { offers: [nextMorning] } },
      ],
    }),
  );
  assert.equal(output.strategies.length, 1);
  assert.equal(output.strategies[0]?.costImpact?.amount, 115);
  assert.match(output.strategies[0]?.summary ?? '', /08:20/);
});

test('fallback planner fails closed when every offer already departed', async () => {
  const planner = new DeterministicFallbackPlanner({
    idFactory: (() => {
      let n = 0;
      return (prefix: string) => `${prefix}-${++n}`;
    })(),
  });
  const past = offer('past', '2026-09-29T16:50:00+09:00', '2026-09-29T23:00:00+08:00', 84);
  const output = await planner.plan(
    baseInput({
      priorToolResults: [{ toolRequestId: 'tool-1', summary: 'same-day', data: { offers: [past] } }],
    }),
  );
  assert.equal(output.strategies.length, 0);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('departs before the planning instant')));
});
