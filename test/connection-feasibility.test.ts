import assert from 'node:assert/strict';
import test from 'node:test';
import type { TransportLeg } from '../src/domain/elements.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import {
  assessConnectionPairs,
  connectionFailureElementIds,
  DEFAULT_CONNECTION_BUFFER_MINUTES,
  discoverConnectionPairs,
} from '../src/engine/connectionFeasibility.ts';

const AT = '2026-09-28T12:00:00+00:00';

function flight(id: string, origin: string, destination: string, depart: string, arrive: string): TransportLeg {
  return {
    id,
    tripId: 'trip-1',
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: origin,
      destinationPlaceId: destination,
      scheduledDeparture: { value: depart, sourceId: 'src-1', authority: 'CONNECTED', observedAt: AT },
      scheduledArrival: { value: arrive, sourceId: 'src-1', authority: 'CONNECTED', observedAt: AT },
    },
  };
}

function tripWith(legs: TransportLeg[]): Trip {
  return {
    id: 'trip-1',
    label: 'Connection test',
    travellerIds: ['trv-1'],
    elements: legs,
    objectives: [],
    relations: [
      {
        kind: 'CONNECTS_TO',
        from: { entityType: 'TRIP_ELEMENT', id: legs[0]!.id },
        to: { entityType: 'TRIP_ELEMENT', id: legs[1]!.id },
        meta: { minBufferMinutes: 90 },
      },
    ],
    governedByRuleSetIds: [],
    viability: 'VIABLE',
    updatedAt: AT,
    version: 1,
  };
}

const bufferRules: RuleSet[] = [
  {
    id: 'rs-buffer',
    kind: 'EVENT',
    name: 'Buffer',
    ownerOrganisationId: 'org-1',
    sourceId: 'src-policy',
    rules: [
      {
        id: 'rule-buffer',
        kind: 'CONNECTION_BUFFER',
        sourceId: 'src-policy',
        description: '90 minute connection',
        appliesTo: [],
        buffer: {
          minimumMinutes: 90,
          expectedMinutes: 90,
          sourceId: 'src-policy',
          observedAt: AT,
          quality: 'HIGH',
        },
      },
    ],
  },
];

test('connection feasibility: viable margin passes', () => {
  const legs = [
    flight('leg-1', 'place-a', 'place-hub', '2026-09-28T08:00:00+00:00', '2026-09-28T14:00:00+00:00'),
    flight('leg-2', 'place-hub', 'place-b', '2026-09-28T16:00:00+00:00', '2026-09-28T22:00:00+00:00'),
  ];
  const trip = tripWith(legs);
  const assessments = assessConnectionPairs(trip, bufferRules);
  assert.equal(assessments.length, 1);
  assert.equal(assessments[0]!.viability, 'VIABLE');
  assert.equal(connectionFailureElementIds(assessments).impossible.length, 0);
});

test('connection feasibility: tightening margin becomes TIGHT then IMPOSSIBLE', () => {
  const legs = [
    flight('leg-1', 'place-a', 'place-hub', '2026-09-28T08:00:00+00:00', '2026-09-28T14:00:00+00:00'),
    flight('leg-2', 'place-hub', 'place-b', '2026-09-28T15:00:00+00:00', '2026-09-28T22:00:00+00:00'),
  ];
  const tight = assessConnectionPairs(tripWith(legs), bufferRules)[0]!;
  assert.equal(tight.viability, 'TIGHT');
  assert.ok(tight.marginMinutes > 0 && tight.marginMinutes < DEFAULT_CONNECTION_BUFFER_MINUTES);

  legs[1]!.data.scheduledDeparture = {
    value: '2026-09-28T14:00:00+00:00',
    sourceId: 'src-1',
    authority: 'CONNECTED',
    observedAt: AT,
  };
  const impossible = assessConnectionPairs(tripWith(legs), bufferRules)[0]!;
  assert.equal(impossible.viability, 'IMPOSSIBLE');
  const failures = connectionFailureElementIds([impossible]);
  assert.deepEqual(failures.impossible.sort(), ['leg-1', 'leg-2'].sort());
});

test('connection feasibility: discovers hub pairs without explicit CONNECTS_TO', () => {
  const legs = [
    flight('leg-1', 'place-a', 'place-hub', '2026-09-28T08:00:00+00:00', '2026-09-28T14:00:00+00:00'),
    flight('leg-2', 'place-hub', 'place-b', '2026-09-28T16:00:00+00:00', '2026-09-28T22:00:00+00:00'),
  ];
  const trip: Trip = { ...tripWith(legs), relations: [] };
  const pairs = discoverConnectionPairs(trip, bufferRules);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.upstreamId, 'leg-1');
  assert.equal(pairs[0]!.downstreamId, 'leg-2');
});
