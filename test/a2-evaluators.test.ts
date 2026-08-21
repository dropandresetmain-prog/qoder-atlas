/**
 * A2 evidence — deterministic constraint evaluators (T-EVAL).
 * Instant-based cross-offset comparison (ADR-023), buffers, windows,
 * PASS/FAIL/UNKNOWN distinctness, and no fabricated certainty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateConstraint,
  type EvaluationContext,
} from '../src/engine/evaluators.ts';
import type { Constraint } from '../src/domain/constraints.ts';
import type { TripElement, TransportLeg, Stay, Engagement } from '../src/domain/elements.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { Fact, IsoDateTime } from '../src/domain/common.ts';

const NOW = '2026-09-01T00:00:00+00:00';

function fact(value: IsoDateTime, over: Partial<Fact<IsoDateTime>> = {}): Fact<IsoDateTime> {
  return {
    value,
    sourceId: 'src_eval',
    authority: 'AUTHORITATIVE',
    observedAt: '2026-08-25T00:00:00+00:00',
    ...over,
  };
}

function leg(over: Omit<Partial<TransportLeg>, 'data'> & { id: string; data?: Partial<TransportLeg['data']> }): TransportLeg {
  const { data, ...rest } = over;
  return {
    tripId: 'trip_eval',
    elementKind: 'TRANSPORT_LEG',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    ...rest,
    data: { mode: 'FLIGHT', originPlaceId: 'plc_origin', destinationPlaceId: 'plc_dest', ...data },
  };
}

function stay(over: Omit<Partial<Stay>, 'data'> & { id: string; data?: Partial<Stay['data']> }): Stay {
  const { data, ...rest } = over;
  return {
    tripId: 'trip_eval',
    elementKind: 'STAY',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    ...rest,
    data: {
      placeId: 'plc_dest',
      checkIn: fact('2026-09-01T15:00:00+00:00'),
      checkOut: fact('2026-09-02T11:00:00+00:00'),
      policyRuleSetIds: [],
      ...data,
    },
  };
}

function engagement(over: Omit<Partial<Engagement>, 'data'> & { id: string; data?: Partial<Engagement['data']> }): Engagement {
  const { data, ...rest } = over;
  return {
    tripId: 'trip_eval',
    elementKind: 'ENGAGEMENT',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    ...rest,
    data: { title: 'meeting', placeId: 'plc_dest', startsAt: fact('2026-09-01T10:30:00+00:00'), ...data },
  };
}

function constraint(over: Partial<Constraint> & { id: string; kind: Constraint['kind'] }): Constraint {
  return {
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    status: 'UNKNOWN',
    refs: [],
    ...over,
  };
}

interface CtxOver {
  now?: IsoDateTime;
  ruleSets?: Map<string, RuleSet>;
  relations?: Trip['relations'];
  objectives?: Trip['objectives'];
}

function ctx(elements: TripElement[], over: CtxOver = {}): EvaluationContext {
  const trip: Trip = {
    id: 'trip_eval',
    travellerIds: ['trv_eval'],
    elements,
    objectives: over.objectives ?? [],
    relations: over.relations ?? [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: NOW,
  };
  return {
    trip,
    places: new Map(),
    ruleSets: over.ruleSets ?? new Map(),
    travellers: [],
    now: over.now ?? NOW,
  };
}

const elRef = (id: string) => ({ entityType: 'TRIP_ELEMENT' as const, id });
const objRef = (id: string) => ({ entityType: 'TRIP_OBJECTIVE' as const, id });

test('TEMPORAL compares instants across offsets, not strings', () => {
  // Arrival 18:00+09:00 == 09:00Z; deadline 10:30Z; buffer 60 -> PASS.
  // A lexicographic comparator would see "18:00+09:00" > "10:30+00:00" and fail.
  const arrival = leg({
    id: 'el_x_leg',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_dest',
      scheduledArrival: fact('2026-09-01T18:00:00+09:00'),
    },
  });
  const meeting = engagement({ id: 'el_x_meeting', data: { placeId: 'plc_dest', startsAt: fact('2026-09-01T10:30:00+00:00') } });
  const c = constraint({
    id: 'c_x',
    kind: 'TEMPORAL',
    refs: [elRef('el_x_leg'), elRef('el_x_meeting')],
    parameters: { minBufferMinutes: 60 },
  });
  const result = evaluateConstraint(c, ctx([arrival, meeting]));
  assert.equal(result.status, 'PASS');
});

test('TEMPORAL fails when buffer is insufficient', () => {
  const arrival = leg({
    id: 'el_x_leg',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_dest',
      scheduledArrival: fact('2026-09-01T09:50:00+00:00'),
    },
  });
  const meeting = engagement({ id: 'el_x_meeting', data: { placeId: 'plc_dest', startsAt: fact('2026-09-01T10:30:00+00:00') } });
  const c = constraint({
    id: 'c_x',
    kind: 'TEMPORAL',
    refs: [elRef('el_x_leg'), elRef('el_x_meeting')],
    parameters: { minBufferMinutes: 60 },
  });
  assert.equal(evaluateConstraint(c, ctx([arrival, meeting])).status, 'FAIL');
});

test('TEMPORAL fails outright when the required subject is cancelled', () => {
  const arrival = leg({ id: 'el_x_leg', reservationState: 'CANCELLED' });
  const meeting = engagement({ id: 'el_x_meeting', data: { placeId: 'plc_dest', startsAt: fact('2026-09-01T10:30:00+00:00') } });
  const c = constraint({ id: 'c_x', kind: 'TEMPORAL', refs: [elRef('el_x_leg'), elRef('el_x_meeting')] });
  assert.equal(evaluateConstraint(c, ctx([arrival, meeting])).status, 'FAIL');
});

test('TEMPORAL stays UNKNOWN when arrival evidence is absent', () => {
  const arrival = leg({ id: 'el_x_leg' });
  const meeting = engagement({ id: 'el_x_meeting', data: { placeId: 'plc_dest', startsAt: fact('2026-09-01T10:30:00+00:00') } });
  const c = constraint({ id: 'c_x', kind: 'TEMPORAL', refs: [elRef('el_x_leg'), elRef('el_x_meeting')] });
  assert.equal(evaluateConstraint(c, ctx([arrival, meeting])).status, 'UNKNOWN');
});

test('expired (stale) fact degrades to UNKNOWN, never PASS', () => {
  const arrival = leg({
    id: 'el_x_leg',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_dest',
      scheduledArrival: fact('2026-09-01T08:00:00+00:00', { validUntil: '2026-08-30T00:00:00+00:00' }),
    },
  });
  const meeting = engagement({ id: 'el_x_meeting', data: { placeId: 'plc_dest', startsAt: fact('2026-09-01T10:30:00+00:00') } });
  const c = constraint({ id: 'c_x', kind: 'TEMPORAL', refs: [elRef('el_x_leg'), elRef('el_x_meeting')] });
  const evaluation = evaluateConstraint(c, ctx([arrival, meeting], { now: '2026-09-01T00:00:00+00:00' }));
  // Stale evidence is unusable: the constraint must stay UNKNOWN (never
  // PASS), and no gap arithmetic may be claimed.
  assert.equal(evaluation.status, 'UNKNOWN');
  assert.doesNotMatch(evaluation.evidence ?? '', /gap/);
});

test('SUPPLIER no-show cutoff passes when arrival chain beats the cutoff', () => {
  const inbound = leg({
    id: 'el_in',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_dest',
      scheduledArrival: fact('2026-09-01T12:00:00+00:00'),
    },
  });
  const hotel = stay({ id: 'el_stay', data: { placeId: 'plc_dest', checkIn: fact('2026-09-01T15:00:00+00:00') } });
  const rules: RuleSet = {
    id: 'rs_x',
    kind: 'SUPPLIER',
    name: 'stay policy',
    sourceId: 'src_eval',
    rules: [
      {
        id: 'rule_cutoff',
        kind: 'NO_SHOW_CUTOFF',
        sourceId: 'src_eval',
        cutoffAt: '2026-09-01T18:00:00+00:00',
        appliesTo: [],
      },
    ],
  };
  const c = constraint({
    id: 'c_x',
    kind: 'SUPPLIER',
    refs: [elRef('el_stay')],
    ruleSetId: 'rs_x',
    derivedFromRuleId: 'rule_cutoff',
  });
  const context = ctx([inbound, hotel], {
    ruleSets: new Map([['rs_x', rules]]),
    relations: [
        {
          kind: 'CONNECTS_TO' as const,
          from: elRef('el_in'),
          to: elRef('el_stay'),
        },
      ],
  });
  assert.equal(evaluateConstraint(c, context).status, 'PASS');
});

test('SUPPLIER no-show cutoff fails when arrival chain is after the cutoff', () => {
  const inbound = leg({
    id: 'el_in',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_dest',
      scheduledArrival: fact('2026-09-01T20:00:00+00:00'),
    },
  });
  const hotel = stay({ id: 'el_stay', data: { placeId: 'plc_dest', checkIn: fact('2026-09-01T15:00:00+00:00') } });
  const rules: RuleSet = {
    id: 'rs_x',
    kind: 'SUPPLIER',
    name: 'stay policy',
    sourceId: 'src_eval',
    rules: [
      {
        id: 'rule_cutoff',
        kind: 'NO_SHOW_CUTOFF',
        sourceId: 'src_eval',
        cutoffAt: '2026-09-01T18:00:00+00:00',
        appliesTo: [],
      },
    ],
  };
  const c = constraint({
    id: 'c_x',
    kind: 'SUPPLIER',
    refs: [elRef('el_stay')],
    ruleSetId: 'rs_x',
    derivedFromRuleId: 'rule_cutoff',
  });
  const context = ctx([inbound, hotel], {
    ruleSets: new Map([['rs_x', rules]]),
    relations: [{ kind: 'CONNECTS_TO' as const, from: elRef('el_in'), to: elRef('el_stay') }],
  });
  assert.equal(evaluateConstraint(c, context).status, 'FAIL');
});

test('SUPPLIER stays UNKNOWN without arrival-chain evidence', () => {
  const hotel = stay({ id: 'el_stay', data: { placeId: 'plc_dest', checkIn: fact('2026-09-01T15:00:00+00:00') } });
  const rules: RuleSet = {
    id: 'rs_x',
    kind: 'SUPPLIER',
    name: 'stay policy',
    sourceId: 'src_eval',
    rules: [
      {
        id: 'rule_cutoff',
        kind: 'NO_SHOW_CUTOFF',
        sourceId: 'src_eval',
        cutoffAt: '2026-09-01T18:00:00+00:00',
        appliesTo: [],
      },
    ],
  };
  const c = constraint({
    id: 'c_x',
    kind: 'SUPPLIER',
    refs: [elRef('el_stay')],
    ruleSetId: 'rs_x',
    derivedFromRuleId: 'rule_cutoff',
  });
  assert.equal(evaluateConstraint(c, ctx([hotel], { ruleSets: new Map([['rs_x', rules]]) })).status, 'UNKNOWN');
});

test('TRANSFER: scheduled departure keeps the required buffer', () => {
  const inbound = leg({
    id: 'el_in',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_mid',
      scheduledArrival: fact('2026-09-01T12:00:00+00:00'),
    },
  });
  const transfer = leg({
    id: 'el_tx',
    data: {
      mode: 'TAXI_OR_RIDEHAIL',
      originPlaceId: 'plc_mid',
      destinationPlaceId: 'plc_dest',
      scheduledDeparture: fact('2026-09-01T12:45:00+00:00'),
    },
  });
  const c = constraint({
    id: 'c_x',
    kind: 'TRANSFER',
    refs: [elRef('el_tx')],
    parameters: { minBufferMinutes: 30 },
  });
  const context = ctx([inbound, transfer], {
    relations: [{ kind: 'CONNECTS_TO' as const, from: elRef('el_in'), to: elRef('el_tx') }],
  });
  assert.equal(evaluateConstraint(c, context).status, 'PASS');
});

test('TRANSFER: on-demand flexible leg is schedulable once upstream arrival is known', () => {
  const inbound = leg({
    id: 'el_in',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_mid',
      scheduledArrival: fact('2026-09-01T12:00:00+00:00'),
    },
  });
  const transfer = leg({
    id: 'el_tx',
    reservationState: 'NONE',
    flexibility: 'FLEXIBLE',
    data: { mode: 'TAXI_OR_RIDEHAIL', originPlaceId: 'plc_mid', destinationPlaceId: 'plc_dest' },
  });
  const c = constraint({ id: 'c_x', kind: 'TRANSFER', refs: [elRef('el_tx')] });
  const context = ctx([inbound, transfer], {
    relations: [{ kind: 'CONNECTS_TO' as const, from: elRef('el_in'), to: elRef('el_tx') }],
  });
  assert.equal(evaluateConstraint(c, context).status, 'PASS');
});

test('TRANSFER: no upstream arrival evidence stays UNKNOWN', () => {
  const transfer = leg({
    id: 'el_tx',
    reservationState: 'NONE',
    flexibility: 'FLEXIBLE',
    data: { mode: 'TAXI_OR_RIDEHAIL', originPlaceId: 'plc_mid', destinationPlaceId: 'plc_dest' },
  });
  const c = constraint({ id: 'c_x', kind: 'TRANSFER', refs: [elRef('el_tx')] });
  assert.equal(evaluateConstraint(c, ctx([transfer])).status, 'UNKNOWN');
});

test('LOCATION checks element place against the parameter', () => {
  const hotel = stay({ id: 'el_stay', data: { placeId: 'plc_dest', checkIn: fact('2026-09-01T15:00:00+00:00') } });
  const pass = constraint({ id: 'c_p', kind: 'LOCATION', refs: [elRef('el_stay')], parameters: { placeId: 'plc_dest' } });
  const fail = constraint({ id: 'c_f', kind: 'LOCATION', refs: [elRef('el_stay')], parameters: { placeId: 'plc_other' } });
  assert.equal(evaluateConstraint(pass, ctx([hotel])).status, 'PASS');
  assert.equal(evaluateConstraint(fail, ctx([hotel])).status, 'FAIL');
});

test('ACCESSIBILITY excludes parameter-listed modes only', () => {
  const stairs = leg({ id: 'el_walk', data: { mode: 'WALKING', originPlaceId: 'plc_origin', destinationPlaceId: 'plc_dest' } });
  const flight = leg({ id: 'el_flight', data: { mode: 'FLIGHT', originPlaceId: 'plc_origin', destinationPlaceId: 'plc_dest' } });
  const c = (id: string) =>
    constraint({ id, kind: 'ACCESSIBILITY', parameters: { unsupportedModes: ['WALKING'] } });
  const walkEval = evaluateConstraint({ ...c('c_walk'), refs: [elRef('el_walk')] }, ctx([stairs, flight]));
  const flightEval = evaluateConstraint({ ...c('c_flight'), refs: [elRef('el_flight')] }, ctx([stairs, flight]));
  assert.equal(walkEval.status, 'FAIL');
  assert.equal(flightEval.status, 'PASS');
  const noParams = evaluateConstraint(
    constraint({ id: 'c_np', kind: 'ACCESSIBILITY', refs: [elRef('el_flight')] }),
    ctx([stairs, flight]),
  );
  assert.equal(noParams.status, 'UNKNOWN');
});

test('POLICY cancellation terms honour the refund deadline', () => {
  const rules: RuleSet = {
    id: 'rs_x',
    kind: 'SUPPLIER',
    name: 'cancel terms',
    sourceId: 'src_eval',
    rules: [
      {
        id: 'rule_cancel',
        kind: 'CANCELLATION_TERMS',
        sourceId: 'src_eval',
        refundable: true,
        refundDeadline: '2026-09-05T00:00:00+00:00',
        appliesTo: [],
      },
    ],
  };
  const c = constraint({ id: 'c_x', kind: 'POLICY', ruleSetId: 'rs_x', derivedFromRuleId: 'rule_cancel' });
  const before = evaluateConstraint(c, ctx([], { ruleSets: new Map([['rs_x', rules]]), now: '2026-09-01T00:00:00+00:00' }));
  const after = evaluateConstraint(c, ctx([], { ruleSets: new Map([['rs_x', rules]]), now: '2026-09-06T00:00:00+00:00' }));
  assert.equal(before.status, 'PASS');
  assert.equal(after.status, 'FAIL');
});

test('FINANCIAL compares against SPEND_LIMIT only with matching currency', () => {
  const rules: RuleSet = {
    id: 'rs_x',
    kind: 'ORGANISATION',
    name: 'spend policy',
    sourceId: 'src_eval',
    rules: [
      {
        id: 'rule_spend',
        kind: 'SPEND_LIMIT',
        sourceId: 'src_eval',
        maxAmount: { amount: 1000, currency: 'USD' },
        appliesTo: [],
      },
    ],
  };
  const within = constraint({ id: 'c_w', kind: 'FINANCIAL', ruleSetId: 'rs_x', derivedFromRuleId: 'rule_spend', parameters: { amount: 900, currency: 'USD' } });
  const over = constraint({ id: 'c_o', kind: 'FINANCIAL', ruleSetId: 'rs_x', derivedFromRuleId: 'rule_spend', parameters: { amount: 1200, currency: 'USD' } });
  const mismatch = constraint({ id: 'c_m', kind: 'FINANCIAL', ruleSetId: 'rs_x', derivedFromRuleId: 'rule_spend', parameters: { amount: 900, currency: 'EUR' } });
  const context = ctx([], { ruleSets: new Map([['rs_x', rules]]) });
  assert.equal(evaluateConstraint(within, context).status, 'PASS');
  assert.equal(evaluateConstraint(over, context).status, 'FAIL');
  assert.equal(evaluateConstraint(mismatch, context).status, 'UNKNOWN');
});

test('OBJECTIVE viability follows linked element health', () => {
  const good = leg({ id: 'el_ok', data: { mode: 'FLIGHT', originPlaceId: 'plc_origin', destinationPlaceId: 'plc_dest' } });
  const bad = leg({ id: 'el_bad', reservationState: 'CANCELLED' });
  const trip: Trip = {
    id: 'trip_eval',
    travellerIds: ['trv_eval'],
    elements: [good, bad],
    objectives: [
      { id: 'obj_ok', tripId: 'trip_eval', statement: 'ok', hardness: 'HARD', status: 'ACTIVE', linkedElementIds: ['el_ok'] },
      { id: 'obj_bad', tripId: 'trip_eval', statement: 'bad', hardness: 'HARD', status: 'ACTIVE', linkedElementIds: ['el_bad'] },
      { id: 'obj_waived', tripId: 'trip_eval', statement: 'waived', hardness: 'HARD', status: 'WAIVED', linkedElementIds: ['el_bad'] },
      { id: 'obj_unknown', tripId: 'trip_eval', statement: 'unknown', hardness: 'HARD', status: 'ACTIVE', linkedElementIds: ['el_missing'] },
    ],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: NOW,
  };
  const context: EvaluationContext = {
    trip,
    places: new Map(),
    ruleSets: new Map(),
    travellers: [],
    now: NOW,
  };
  const c = (id: string, objectiveId: string) =>
    constraint({ id, kind: 'OBJECTIVE', refs: [objRef(objectiveId)] });
  assert.equal(evaluateConstraint(c('c_ok', 'obj_ok'), context).status, 'PASS');
  assert.equal(evaluateConstraint(c('c_bad', 'obj_bad'), context).status, 'FAIL');
  assert.equal(evaluateConstraint(c('c_waived', 'obj_waived'), context).status, 'PASS');
  assert.equal(evaluateConstraint(c('c_unknown', 'obj_unknown'), context).status, 'UNKNOWN');
});

test('SEMANTIC constraints and ENTRY kinds stay UNKNOWN', () => {
  const semantic = constraint({ id: 'c_s', kind: 'TEMPORAL', evaluator: 'SEMANTIC' });
  const entry = constraint({ id: 'c_e', kind: 'ENTRY' });
  assert.equal(evaluateConstraint(semantic, ctx([])).status, 'UNKNOWN');
  assert.equal(evaluateConstraint(entry, ctx([])).status, 'UNKNOWN');
});

test('TEMPORAL resolves an objective deadline from linked elements excluding the subject', () => {
  const arrival = leg({
    id: 'el_back',
    data: {
      mode: 'FLIGHT',
      originPlaceId: 'plc_origin',
      destinationPlaceId: 'plc_dest',
      scheduledArrival: fact('2026-09-02T07:00:00+00:00'),
    },
  });
  const nextMeeting = engagement({ id: 'el_next', data: { placeId: 'plc_dest', startsAt: fact('2026-09-02T10:00:00+00:00') } });
  const trip: Trip = {
    id: 'trip_eval',
    travellerIds: ['trv_eval'],
    elements: [arrival, nextMeeting],
    objectives: [
      { id: 'obj_return', tripId: 'trip_eval', statement: 'return', hardness: 'HARD', status: 'ACTIVE', linkedElementIds: ['el_back', 'el_next'] },
    ],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: NOW,
  };
  const c = constraint({
    id: 'c_x',
    kind: 'TEMPORAL',
    refs: [elRef('el_back'), objRef('obj_return')],
    parameters: { minBufferMinutes: 90 },
  });
  const context: EvaluationContext = { trip, places: new Map(), ruleSets: new Map(), travellers: [], now: NOW };
  assert.equal(evaluateConstraint(c, context).status, 'PASS');
});
