/**
 * S5/S6 readiness — smallest generic backend additions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { EntityId, IsoDateTime } from '../src/domain/common.ts';
import type { PolicyRule } from '../src/domain/rules.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { Stay } from '../src/domain/elements.ts';
import {
  allocateCost,
  fundingAnchorFromCandidateOperations,
  payerDecisionFor,
} from '../src/engine/funding.ts';
import { evaluateConstraint } from '../src/engine/evaluators.ts';
import type { Constraint } from '../src/domain/constraints.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { EvaluationContext } from '../src/engine/evaluators.ts';
import { ResolutionTargetSchema } from '../src/contracts/changeRequest.ts';
import { hotelSearchGuestsFromOccupancy } from '../src/app/dispatch.ts';
import { NorthstarPlanner } from '../src/intelligence/northstarPlanner.ts';
import { DeterministicFallbackPlanner } from '../src/intelligence/fallbackPlanner.ts';
import type { PlannerInput } from '../src/contracts/planner.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';

const FUNDED_WINDOW_START = '2026-09-07T00:00:00+08:00';
const FUNDED_WINDOW_END = '2026-09-11T23:59:00+08:00';
const INSIDE_ANCHOR = '2026-09-09T12:00:00+08:00';
const OUTSIDE_ANCHOR = '2026-09-13T12:00:00+08:00';

function fundedWindowRules(): PolicyRule[] {
  return [
    {
      id: 'rule-funded',
      kind: 'FUNDED_WINDOW',
      sourceId: 'src-policy',
      windowStart: FUNDED_WINDOW_START,
      windowEnd: FUNDED_WINDOW_END,
      coveredBy: 'EVENT_ORGANISATION',
      incrementalPayer: 'TRAVELLER',
      appliesTo: [],
    },
  ];
}

function stayUpsert(checkOut: IsoDateTime, checkIn: IsoDateTime = '2026-09-08T15:00:00+08:00'): MutationOperation {
  return {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    data: {
      id: 'el-stay-1',
      tripId: 'trip-1',
      elementKind: 'STAY',
      importance: 'REQUIRED',
      flexibility: 'FIXED',
      reservationState: 'CONFIRMED',
      status: 'VALID',
      dependsOn: [],
      governedByRuleSetIds: [],
      data: {
        placeId: 'plc-hotel',
        checkIn: { value: checkIn, sourceId: 'src', authority: 'CONNECTED', observedAt: checkIn },
        checkOut: { value: checkOut, sourceId: 'src', authority: 'CONNECTED', observedAt: checkOut },
      },
    },
  };
}

test('funding: stay checkOut anchor inside FUNDED_WINDOW is COVERED', () => {
  const anchor = fundingAnchorFromCandidateOperations([stayUpsert(INSIDE_ANCHOR)]);
  assert.equal(anchor, INSIDE_ANCHOR);
  const decision = payerDecisionFor(fundedWindowRules(), anchor);
  assert.equal(decision?.kind, 'COVERED');
  assert.equal(decision?.payer, 'EVENT_ORGANISATION');
  const allocation = allocateCost({
    rules: fundedWindowRules(),
    priceDelta: { amount: 250, currency: 'SGD' },
    costAccruesAt: anchor,
  });
  assert.equal(allocation?.coveredBy, 'EVENT_ORGANISATION');
});

test('funding: stay checkOut anchor outside FUNDED_WINDOW is INCREMENTAL traveller payer', () => {
  const anchor = fundingAnchorFromCandidateOperations([stayUpsert(OUTSIDE_ANCHOR)]);
  assert.equal(anchor, OUTSIDE_ANCHOR);
  const decision = payerDecisionFor(fundedWindowRules(), anchor);
  assert.equal(decision?.kind, 'INCREMENTAL');
  assert.equal(decision?.payer, 'TRAVELLER');
  const allocation = allocateCost({
    rules: fundedWindowRules(),
    priceDelta: { amount: 300, currency: 'SGD' },
    costAccruesAt: anchor,
  });
  assert.equal(allocation?.incrementalPayer, 'TRAVELLER');
  assert.equal(allocation?.incrementalAmount?.amount, 300);
});

test('SPEND_LIMIT period is reflected in FINANCIAL evaluation messages', () => {
  const rules: RuleSet = {
    id: 'rs_spend',
    kind: 'ORGANISATION',
    name: 'spend',
    sourceId: 'src',
    rules: [
      {
        id: 'rule-night',
        kind: 'SPEND_LIMIT',
        sourceId: 'src',
        maxAmount: { amount: 500, currency: 'SGD' },
        period: 'NIGHT',
        appliesTo: [],
      },
    ],
  };
  const constraint: Constraint = {
    id: 'c-fin',
    kind: 'FINANCIAL',
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    ruleSetId: 'rs_spend',
    derivedFromRuleId: 'rule-night',
    parameters: { amount: 400, currency: 'SGD' },
    refs: [],
    status: 'UNKNOWN',
  };
  const ctx: EvaluationContext = {
    trip: {
      id: 'trip-1',
      travellerIds: [],
      elements: [],
      objectives: [],
      relations: [],
      governedByRuleSetIds: ['rs_spend'],
      viability: 'UNKNOWN',
      version: 0,
      updatedAt: '2026-09-05T12:00:00+08:00',
    },
    places: new Map(),
    ruleSets: new Map([['rs_spend', rules]]),
    travellers: [],
    now: '2026-09-05T12:00:00+08:00',
  };
  const result = evaluateConstraint(constraint, ctx);
  assert.equal(result.status, 'PASS');
  assert.match(result.evidence ?? '', /per-night/i);
});

test('ResolutionTarget accepts stay date/place/occupancy fields', () => {
  const parsed = ResolutionTargetSchema.parse({
    stayCheckOut: '2026-09-13T11:00:00+08:00',
    preferredStayPlaceId: 'plc-hotel-2',
    guests: 2,
    objectiveEffects: [],
  });
  assert.equal(parsed.guests, 2);
  assert.equal(parsed.preferredStayPlaceId, 'plc-hotel-2');
});

test('hotelSearchGuestsFromOccupancy maps guests to adults without defaulting', () => {
  assert.deepEqual(hotelSearchGuestsFromOccupancy(3), { adults: 3 });
  assert.equal(hotelSearchGuestsFromOccupancy(undefined), undefined);
});

test('northstar planner wires stay guests into hotel.search parameters when present', async () => {
  const stay: Stay = {
    id: 'el-stay',
    tripId: 'trip-1',
    elementKind: 'STAY',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
    reservationState: 'CONFIRMED',
    status: 'VALID',
    dependsOn: [],
    governedByRuleSetIds: [],
    data: {
      placeId: 'plc-hotel',
      checkIn: {
        value: '2026-09-08T15:00:00+08:00',
        sourceId: 'src',
        authority: 'CONNECTED',
        observedAt: '2026-09-08T15:00:00+08:00',
      },
      checkOut: {
        value: '2026-09-11T11:00:00+08:00',
        sourceId: 'src',
        authority: 'CONNECTED',
        observedAt: '2026-09-11T11:00:00+08:00',
      },
      guests: 2,
      policyRuleSetIds: [],
    },
  };
  const snapshot: TripSnapshot = {
    tripId: 'trip-1',
    takenAt: '2026-09-05T12:00:00+08:00',
    tripVersion: 1,
    trip: {
      id: 'trip-1',
      travellerIds: ['trv-1'],
      elements: [stay],
      objectives: [],
      relations: [],
      governedByRuleSetIds: [],
      viability: 'UNKNOWN',
      version: 1,
      updatedAt: '2026-09-05T12:00:00+08:00',
    },
    travellers: [],
    organisations: [],
    places: [
      {
        id: 'plc-hotel',
        name: 'Hotel',
        kind: 'HOTEL',
        timezone: 'Asia/Singapore',
        externalRefs: [{ system: 'nuitee-hotel-id', value: 'hotel-1' }],
        coordinates: { latitude: 1.3, longitude: 103.8 },
      },
    ],
    ruleSets: [],
    constraints: [],
    preferences: [],
    sourceRecords: [],
  };
  const input: PlannerInput = {
    caseId: 'case-1',
    snapshot,
    impact: {
      id: 'imp-1',
      tripId: 'trip-1',
      severity: 'LOW',
      directFailures: [],
      affectedElements: [],
      threatenedObjectives: [],
      irreversibleLosses: [],
      affectedTravellerIds: [],
      sharedResourceImpacts: [],
      policyImplications: [],
      insuranceImplications: [],
      unresolvedUnknowns: [],
      assessedAt: '2026-09-05T12:00:00+08:00',
    },
    triggeringSignals: [
      {
        id: 'sig-1',
        kind: 'TRAVELLER_INPUT',
        occurredAt: '2026-09-05T10:00:00+08:00',
        receivedAt: '2026-09-05T12:00:00+08:00',
        sourceId: 'src',
        authority: 'ASSERTED',
        tripId: 'trip-1',
        summary: 'extend stay',
        payload: {
          changeRequestId: 'cr-1',
          intentKind: 'CHANGE_STAY',
          target: {
            stayCheckOut: '2026-09-13T11:00:00+08:00',
            objectiveEffects: [],
          },
        },
      },
    ],
    priorToolResults: [],
    capabilityRegistry: [],
    priorActionResults: [],
  };
  const planner = new NorthstarPlanner(new DeterministicFallbackPlanner());
  const output = await planner.plan(input);
  const hotelSearch = output.toolRequests.find((request) => request.operation === 'hotel.search');
  assert.ok(hotelSearch, 'expected hotel.search tool request for stay change');
  assert.deepEqual(hotelSearch!.parameters['guests'], { adults: 2 });
  assert.ok(output.uncertainties.some((uncertainty) => /stayCheckOut requested/.test(uncertainty.statement)));
});
