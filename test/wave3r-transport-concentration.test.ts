/**
 * TRANSPORT_CONCENTRATION — generic correlated-risk policy assessment.
 *
 * Pure engine tests only: no scenario / event / city fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PolicyRuleSchema } from '../src/domain/rules.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { TransportLeg } from '../src/domain/elements.ts';
import {
  assessRequestedTransportAssociation,
  assessTransportConcentration,
  transportConcentrationParticipants,
  type ConcentrationParticipant,
  type TransportConcentrationRule,
} from '../src/engine/concentration.ts';
import { evaluateConstraint, type EvaluationContext } from '../src/engine/evaluators.ts';
import type { Constraint } from '../src/domain/constraints.ts';
import type { RuleSet } from '../src/domain/rules.ts';

function concentrationRule(
  overrides: Partial<TransportConcentrationRule> & Pick<TransportConcentrationRule, 'id' | 'maxCriticalParticipants' | 'scope'>,
): TransportConcentrationRule {
  return {
    kind: 'TRANSPORT_CONCENTRATION',
    sourceId: 'src-policy',
    criticalImportance: 'REQUIRED',
    appliesTo: [],
    ...overrides,
  };
}

function participant(
  overrides: ConcentrationParticipant,
): ConcentrationParticipant {
  return overrides;
}

test('transport concentration: violates when critical count exceeds max on shared booking', () => {
  const rule = concentrationRule({
    id: 'rule-conc-1',
    maxCriticalParticipants: 1,
    scope: 'BOOKING_REF',
  });
  const participants = [
    participant({
      travellerId: 'trv-a',
      importance: 'REQUIRED',
      bookingRef: { system: 'pnr', reference: 'SHARED-1' },
    }),
    participant({
      travellerId: 'trv-b',
      importance: 'REQUIRED',
      bookingRef: { system: 'pnr', reference: 'SHARED-1' },
    }),
    participant({
      travellerId: 'trv-c',
      importance: 'PREFERRED',
      bookingRef: { system: 'pnr', reference: 'SHARED-1' },
    }),
  ];
  const result = assessTransportConcentration(rule, participants);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]!.criticalCount, 2);
  assert.deepEqual(result.violations[0]!.criticalTravellerIds, ['trv-a', 'trv-b']);
  assert.equal(result.violations[0]!.maxCriticalParticipants, 1);
});

test('transport concentration: ok when critical count is at or under threshold', () => {
  const rule = concentrationRule({
    id: 'rule-conc-2',
    maxCriticalParticipants: 2,
    scope: 'BOOKING_REF',
  });
  const participants = [
    participant({
      travellerId: 'trv-a',
      importance: 'REQUIRED',
      bookingRef: { system: 'pnr', reference: 'SHARED-1' },
    }),
    participant({
      travellerId: 'trv-b',
      importance: 'REQUIRED',
      bookingRef: { system: 'pnr', reference: 'SHARED-1' },
    }),
  ];
  const result = assessTransportConcentration(rule, participants);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('transport concentration: different booking refs do not concentrate together', () => {
  const rule = concentrationRule({
    id: 'rule-conc-3',
    maxCriticalParticipants: 1,
    scope: 'BOOKING_REF',
  });
  const participants = [
    participant({
      travellerId: 'trv-a',
      importance: 'REQUIRED',
      bookingRef: { system: 'pnr', reference: 'REF-A' },
    }),
    participant({
      travellerId: 'trv-b',
      importance: 'REQUIRED',
      bookingRef: { system: 'pnr', reference: 'REF-B' },
    }),
  ];
  const result = assessTransportConcentration(rule, participants);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('transport concentration: alternate dataset — CARRIER_SERVICE scope and higher threshold', () => {
  const rule = concentrationRule({
    id: 'pol-risk-alpha',
    maxCriticalParticipants: 2,
    criticalImportance: 'REQUIRED',
    scope: 'CARRIER_SERVICE',
  });
  const departure = '2026-10-01T08:00:00+00:00';
  const sameService = { system: 'iata-flight', value: 'XX100' };
  const participants = [
    participant({
      travellerId: 'guest-101',
      importance: 'REQUIRED',
      carrierRef: sameService,
      departureAt: departure,
    }),
    participant({
      travellerId: 'guest-102',
      importance: 'REQUIRED',
      carrierRef: sameService,
      departureAt: departure,
    }),
    participant({
      travellerId: 'guest-103',
      importance: 'REQUIRED',
      carrierRef: sameService,
      departureAt: departure,
    }),
    // Same carrier, different departure — separate group.
    participant({
      travellerId: 'guest-201',
      importance: 'REQUIRED',
      carrierRef: sameService,
      departureAt: '2026-10-01T16:00:00+00:00',
    }),
  ];
  const result = assessTransportConcentration(rule, participants);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]!.criticalCount, 3);
  assert.match(result.violations[0]!.groupKey, /XX100/);
  assert.match(result.violations[0]!.groupKey, /2026-10-01T08:00:00/);
});

test('transport concentration: PolicyRule schema accepts TRANSPORT_CONCENTRATION with default criticalImportance', () => {
  const parsed = PolicyRuleSchema.parse({
    id: 'rule-schema',
    kind: 'TRANSPORT_CONCENTRATION',
    sourceId: 'src',
    maxCriticalParticipants: 1,
    scope: 'BOOKING_REF',
  });
  assert.equal(parsed.kind, 'TRANSPORT_CONCENTRATION');
  if (parsed.kind === 'TRANSPORT_CONCENTRATION') {
    assert.equal(parsed.criticalImportance, 'REQUIRED');
  }
});

test('requested association: prospective grouping within threshold is permitted', () => {
  const rule = concentrationRule({
    id: 'rule-assoc-1',
    maxCriticalParticipants: 2,
    scope: 'BOOKING_REF',
  });
  // Distinct bookings today — the association is prospective, so scope does
  // not restrict the assessment.
  const participants = [
    participant({ travellerId: 'trv-a', importance: 'REQUIRED', bookingRef: { system: 'pnr', reference: 'REF-A' } }),
    participant({ travellerId: 'trv-b', importance: 'REQUIRED', bookingRef: { system: 'pnr', reference: 'REF-B' } }),
  ];
  const result = assessRequestedTransportAssociation(rule, participants);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.criticalTravellerIds, ['trv-a', 'trv-b']);
});

test('requested association: grouping beyond threshold is not permitted', () => {
  const rule = concentrationRule({
    id: 'rule-assoc-2',
    maxCriticalParticipants: 2,
    scope: 'BOOKING_REF',
  });
  const participants = [
    participant({ travellerId: 'trv-a', importance: 'REQUIRED' }),
    participant({ travellerId: 'trv-b', importance: 'REQUIRED' }),
    participant({ travellerId: 'trv-c', importance: 'REQUIRED' }),
    // Non-critical participant does not count against the threshold.
    participant({ travellerId: 'trv-d', importance: 'PREFERRED' }),
  ];
  const result = assessRequestedTransportAssociation(rule, participants);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.criticalTravellerIds, ['trv-a', 'trv-b', 'trv-c']);
});

test('requested association: one traveller on several legs counts once', () => {
  const rule = concentrationRule({
    id: 'rule-assoc-3',
    maxCriticalParticipants: 1,
    scope: 'CARRIER_SERVICE',
  });
  const participants = [
    participant({ travellerId: 'trv-a', importance: 'REQUIRED' }),
    participant({ travellerId: 'trv-a', importance: 'REQUIRED' }),
    participant({ travellerId: 'trv-b', importance: 'REQUIRED' }),
  ];
  const result = assessRequestedTransportAssociation(rule, participants);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.criticalTravellerIds, ['trv-a', 'trv-b']);
});

test('transport concentration: POLICY evaluator wires single-trip assessment', () => {
  const rule = concentrationRule({
    id: 'rule-wire',
    maxCriticalParticipants: 1,
    scope: 'BOOKING_REF',
  });
  const leg = (id: string, travellerTripId: string): TransportLeg => ({
    id,
    tripId: travellerTripId,
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'HELD',
    status: 'UNKNOWN',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc-origin',
      destinationPlaceId: 'plc-dest',
      bookingRef: { system: 'pnr', reference: 'ONE-PNR' },
      scheduledDeparture: {
        value: '2026-10-01T06:00:00+00:00',
        sourceId: 'src',
        authority: 'CONNECTED',
        observedAt: '2026-09-01T00:00:00+00:00',
      },
    },
  });

  // Multi-traveller trip sharing one booking — concentration is visible in-trip.
  const trip: Trip = {
    id: 'trip-group',
    travellerIds: ['trv-1', 'trv-2'],
    elements: [leg('leg-1', 'trip-group')],
    objectives: [],
    relations: [],
    governedByRuleSetIds: ['rs-1'],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: '2026-09-01T00:00:00+00:00',
  };

  const ruleSet: RuleSet = {
    id: 'rs-1',
    kind: 'EVENT',
    name: 'event policy',
    sourceId: 'src',
    rules: [rule],
  };

  const constraint: Constraint = {
    id: 'c-conc',
    kind: 'POLICY',
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    status: 'UNKNOWN',
    refs: [],
    derivedFromRuleId: rule.id,
    ruleSetId: ruleSet.id,
  };

  const ctx: EvaluationContext = {
    trip,
    places: new Map(),
    ruleSets: new Map([[ruleSet.id, ruleSet]]),
    travellers: [],
    now: '2026-09-01T00:00:00+00:00',
  };

  const participants = transportConcentrationParticipants([trip]);
  assert.equal(participants.length, 2);

  const evaluation = evaluateConstraint(constraint, ctx);
  assert.equal(evaluation.status, 'FAIL');
  const evidence = evaluation.evidence;
  assert.equal(typeof evidence, 'string');
  assert.match(evidence as string, /transport concentration exceeded/);
});
