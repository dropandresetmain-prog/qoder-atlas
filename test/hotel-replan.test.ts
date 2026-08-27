/**
 * G1/G2 — generic hotel replacement / stay-date replanning.
 *
 * Covers:
 * - two materially different hotel-change datasets (property switch with
 *   occupancy; stay extension with a preferred property) through the same
 *   planner code;
 * - the evidence gate (no strategy before hotel.search, none from empty);
 * - funding/cost consequences flowing through the existing FUNDED_WINDOW /
 *   SPEND_LIMIT machinery from candidate stay anchors;
 * - downstream overlay viability re-evaluating a candidate stay upsert;
 * - missing insurance/entry evidence staying UNKNOWN (fail-safe) rather
 *   than becoming fabricated certainty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { IsoDateTime } from '../src/domain/common.ts';
import type { PolicyRule, RuleSet } from '../src/domain/rules.ts';
import type { Constraint } from '../src/domain/constraints.ts';
import { ConstraintSchema } from '../src/domain/constraints.ts';
import type { Stay } from '../src/domain/elements.ts';
import type { Place } from '../src/domain/entities.ts';
import type {
  HotelCapability,
  HotelSearchQuery,
  HotelSearchOutcome,
} from '../src/contracts/capabilities.ts';
import { capabilityOk } from '../src/contracts/envelope.ts';
import type { CapabilityDescriptor } from '../src/contracts/capabilities.ts';
import type { PlannerInput } from '../src/contracts/planner.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';
import type { ToolDispatchCapabilities } from '../src/app/dispatch.ts';
import { dispatchToolRequest } from '../src/app/dispatch.ts';
import { NorthstarPlanner } from '../src/intelligence/northstarPlanner.ts';
import { DeterministicFallbackPlanner } from '../src/intelligence/fallbackPlanner.ts';
import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import { interpretResearchFindings } from '../src/intelligence/semantics.ts';
import { evaluateConstraint } from '../src/engine/evaluators.ts';
import type { EvaluationContext } from '../src/engine/evaluators.ts';
import {
  allocateCost,
  payerDecisionFor,
  fundingAnchorFromCandidateOperations,
} from '../src/engine/funding.ts';

const NOW: IsoDateTime = '2026-09-20T12:00:00+08:00';

function fact(value: IsoDateTime) {
  return { value, sourceId: 'src-stay', authority: 'CONNECTED' as const, observedAt: NOW };
}

function stayElement(overrides: Partial<Stay['data']> = {}): Stay {
  return {
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
      placeId: 'plc-hotel-current',
      checkIn: fact('2026-09-29T15:00:00+08:00'),
      checkOut: fact('2026-10-02T11:00:00+08:00'),
      bookingRef: { system: 'hotel-import', reference: 'HTL-2002' },
      guests: 1,
      policyRuleSetIds: [],
      ...overrides,
    },
  };
}

function snapshotFor(stay: Stay | undefined, places: Place[]): TripSnapshot {
  return {
    tripId: 'trip-1',
    takenAt: NOW,
    tripVersion: 7,
    trip: {
      id: 'trip-1',
      travellerIds: ['trv-1'],
      elements: stay ? [stay] : [],
      objectives: [],
      relations: [],
      governedByRuleSetIds: [],
      viability: 'UNKNOWN',
      version: 7,
      updatedAt: NOW,
    },
    travellers: [],
    organisations: [],
    places,
    ruleSets: [],
    constraints: [],
    preferences: [],
    sourceRecords: [],
  };
}

function impactStub() {
  return {
    id: 'imp-1',
    tripId: 'trip-1',
    severity: 'LOW' as const,
    directFailures: [],
    affectedElements: [],
    threatenedObjectives: [],
    irreversibleLosses: [],
    affectedTravellerIds: [],
    sharedResourceImpacts: [],
    policyImplications: [],
    insuranceImplications: [],
    unresolvedUnknowns: [],
    assessedAt: NOW,
  };
}

function changeRequestSignal(target: Record<string, unknown>) {
  return [
    {
      id: 'sig-cr',
      kind: 'TRAVELLER_INPUT' as const,
      occurredAt: NOW,
      receivedAt: NOW,
      sourceId: 'src-request',
      authority: 'ASSERTED' as const,
      tripId: 'trip-1',
      summary: 'stay change request',
      payload: { changeRequestId: 'cr-1', intentKind: 'CHANGE_STAY', target },
    },
  ];
}

function plannerInput(
  snapshot: TripSnapshot,
  target: Record<string, unknown>,
  priorToolResults: PlannerInput['priorToolResults'] = [],
): PlannerInput {
  return {
    caseId: 'case-1',
    snapshot,
    triggeringSignals: changeRequestSignal(target),
    impact: impactStub(),
    capabilityRegistry: [],
    priorToolResults,
    priorActionResults: [],
  };
}

const CURRENT_HOTEL_PLACE: Place = {
  id: 'plc-hotel-current',
  name: 'Current Hotel',
  kind: 'HOTEL',
  timezone: 'Asia/Singapore',
  coordinates: { latitude: 1.28, longitude: 103.85 },
  externalRefs: [{ system: 'nuitee-hotel-id', value: 'lp21d9f' }],
  servedByPlaceIds: [],
};

/** Dataset A: property switch with partner occupancy (S6-shaped, generic). */
const TARGET_SWITCH = {
  preferredStayPlaceId: 'plc-hotel-alt',
  guests: 2,
  objectiveEffects: [],
};

/** Dataset B: pure date extension toward a preferred property (S5-shaped, generic). */
const TARGET_EXTEND = {
  stayCheckOut: '2026-10-04T11:00:00+08:00',
  guests: 3,
  objectiveEffects: [],
};

const ALT_HOTEL_PLACE: Place = {
  id: 'plc-hotel-alt',
  name: 'Alternative Hotel (programme-known)',
  kind: 'HOTEL',
  timezone: 'Asia/Singapore',
  coordinates: { latitude: 1.2789, longitude: 103.8536 },
  externalRefs: [{ system: 'nuitee-hotel-id', value: 'lp21d9f' }],
  servedByPlaceIds: [],
};

const SEARCH_EVIDENCE = {
  properties: [
    {
      propertyId: 'lp21d9f',
      name: 'Programme Partner Hotel',
      externalRefs: [{ system: 'nuitee-hotel-id', value: 'lp21d9f' }],
    },
    {
      propertyId: 'mk88x2',
      name: 'Market Discovery Hotel',
      externalRefs: [{ system: 'nuitee-hotel-id', value: 'mk88x2' }],
    },
  ],
  rates: [
    {
      rateId: 'offer-expensive-partner',
      propertyId: 'lp21d9f',
      totalPrice: { amount: 900, currency: 'SGD' },
      refundable: true,
      availability: 'AVAILABLE' as const,
    },
    {
      rateId: 'offer-cheap-partner',
      propertyId: 'lp21d9f',
      totalPrice: { amount: 720, currency: 'SGD' },
      refundable: false,
      availability: 'AVAILABLE' as const,
    },
    {
      rateId: 'offer-market',
      propertyId: 'mk88x2',
      totalPrice: { amount: 500, currency: 'SGD' },
      refundable: true,
      availability: 'AVAILABLE' as const,
    },
  ],
};

function scopedEvidence(data: unknown): PlannerInput['priorToolResults'] {
  return [{ toolRequestId: 'tool-ws-stay', summary: 'hotel.search: ok', data: data as Record<string, unknown> }];
}

function newPlanner(): NorthstarPlanner {
  return new NorthstarPlanner(new DeterministicFallbackPlanner());
}

// ---------------------------------------------------------------------------
// Round 1: evidence gating (both datasets)
// ---------------------------------------------------------------------------

test('g1 round 1: switch request emits scoped hotel.search and no strategy', async () => {
  const input = plannerInput(snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE, ALT_HOTEL_PLACE]), TARGET_SWITCH);
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 0);
  assert.equal(output.toolRequests.length, 1);
  const request = output.toolRequests[0]!;
  assert.equal(request.operation, 'hotel.search');
  assert.equal(request.capability, 'HOTEL');
  assert.equal(request.id, 'tool-ws-stay');
  // Preferred programme place resolves the search location by coordinates.
  assert.deepEqual(request.parameters['location'], { coordinates: ALT_HOTEL_PLACE.coordinates });
  assert.equal(request.parameters['checkInDate'], '2026-09-29');
  assert.equal(request.parameters['checkOutDate'], '2026-10-02');
  assert.deepEqual(request.parameters['guests'], { adults: 2 });
  // Round 1 with no prior tool result must state the evidence gate — never
  // the empty-rates message (null prior !== "searched with empty rates").
  assert.ok(
    output.uncertainties.some((u) =>
      /replacement\/extension options must be searched before any strategy is proposed/.test(u.statement),
    ),
  );
  assert.equal(output.uncertainties.some((u) => /no usable rates/.test(u.statement)), false);
});

test('g1 round 1: extension request searches to the requested check-out date', async () => {
  const input = plannerInput(snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE]), TARGET_EXTEND);
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 0);
  const request = output.toolRequests[0]!;
  assert.equal(request.parameters['checkOutDate'], '2026-10-04');
  assert.deepEqual(request.parameters['guests'], { adults: 3 });
});

test('g1 fail-safe: empty search evidence produces uncertainty, never a strategy', async () => {
  const input = plannerInput(
    snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE]),
    TARGET_SWITCH,
    scopedEvidence({ properties: [], rates: [] }),
  );
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 0);
  assert.ok(output.uncertainties.some((u) => /no usable rates/.test(u.statement)));
});

test('g1 fail-safe: no booked stay fails closed', async () => {
  const input = plannerInput(snapshotFor(undefined, [CURRENT_HOTEL_PLACE]), TARGET_SWITCH);
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 0);
  assert.ok(output.uncertainties.some((u) => /no booked Stay element/.test(u.statement)));
});

test('g1 fail-safe: place without any resolvable location derives no search', async () => {
  const barePlace: Place = { id: 'plc-bare', name: 'Bare', kind: 'HOTEL', externalRefs: [] };
  const stay = stayElement({ placeId: 'plc-bare' });
  const input = plannerInput(snapshotFor(stay, [barePlace]), TARGET_EXTEND);
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 0);
  assert.equal(output.toolRequests.length, 0);
  assert.ok(output.uncertainties.some((u) => /no search derivable/.test(u.statement)));
});

// ---------------------------------------------------------------------------
// Round 2: strategy generation from evidence (both datasets)
// ---------------------------------------------------------------------------

test('g1 round 2: switch enumerates cheapest-per-property candidates with derived place', async () => {
  const input = plannerInput(
    snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE, ALT_HOTEL_PLACE]),
    TARGET_SWITCH,
    scopedEvidence(SEARCH_EVIDENCE),
  );
  const output = await newPlanner().plan(input);
  // Cheapest rate per distinct property, capped at 3: both properties appear.
  assert.equal(output.strategies.length, 2);

  const marketStrategy = output.strategies.find((s) => s.costImpact?.amount === 500)!;
  assert.ok(marketStrategy, 'market-discovery property becomes a candidate');
  // Derived PLACE upsert for a property unknown to programme evidence...
  const placeUpsert = marketStrategy.candidateOperations.find(
    (op): op is Extract<typeof op, { op: 'UPSERT_ENTITY' }> => op.op === 'UPSERT_ENTITY' && op.entityType === 'PLACE',
  );
  assert.ok(placeUpsert, 'unknown property gets a derived generic Place');
  // ...keyed deterministically by its provider ref, not scenario knowledge.
  const placeData = placeUpsert!.data as Record<string, unknown>;
  assert.equal(placeData['id'], 'place-hotel-nuitee-hotel-id-mk88x2');

  const partnerStrategy = output.strategies.find((s) => s.costImpact?.amount === 720)!;
  assert.ok(partnerStrategy, 'cheapest partner rate outranks the expensive one');
  // Programme-known place is REUSED, never duplicated as a derived place.
  assert.equal(
    partnerStrategy.candidateOperations.some((op) => op.op === 'UPSERT_ENTITY' && op.entityType === 'PLACE'),
    false,
  );
});

test('g1 round 2: extension prefers incumbent property and extends rather than switching', async () => {
  const input = plannerInput(
    snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE]),
    TARGET_EXTEND,
    scopedEvidence(SEARCH_EVIDENCE),
  );
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 1, 'same-property extension does not pad with unrelated hotels');
  const strategy = output.strategies[0]!;
  assert.match(strategy.summary, /^Extend stay at /);
  assert.match(strategy.summary, /Programme Partner Hotel/);
  assert.equal(strategy.costImpact?.amount, 720);
  const elementOps = strategy.candidateOperations.filter(
    (op): op is Extract<typeof op, { op: 'UPSERT_ENTITY' }> => op.op === 'UPSERT_ENTITY' && op.entityType === 'TRIP_ELEMENT',
  );
  assert.equal(elementOps.length, 1);
  const data = elementOps[0]!.data as Record<string, unknown>;
  assert.equal(data['id'], 'el-stay-1', 'same element id = replace semantics in overlay + execution');
  assert.equal(data['reservationState'], 'HELD');
  assert.equal(data['status'], 'UNKNOWN');
  const elementData = data['data'] as Record<string, unknown>;
  assert.equal(elementData['placeId'], 'plc-hotel-current', 'incumbent place preserved');
  // Requested check-out keeps ASSERTED provenance (traveller declaration).
  const checkOut = elementData['checkOut'] as Record<string, unknown>;
  assert.equal(checkOut['value'], '2026-10-04T11:00:00+08:00');
  assert.equal(checkOut['authority'], 'ASSERTED');
  // Occupancy flows from the request.
  assert.equal(elementData['guests'], 3);
  // The booking reference IS the provider rate handle the executor quotes.
  const bookingRef = elementData['bookingRef'] as Record<string, unknown>;
  assert.equal(bookingRef['system'], 'hotel-provider');
});

test('g1 round 2: extension fails closed when incumbent property has no matching rates', async () => {
  const input = plannerInput(
    snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE]),
    TARGET_EXTEND,
    scopedEvidence({
      properties: SEARCH_EVIDENCE.properties.filter((p) => p.propertyId === 'mk88x2'),
      rates: SEARCH_EVIDENCE.rates.filter((r) => r.propertyId === 'mk88x2'),
    }),
  );
  const output = await newPlanner().plan(input);
  assert.equal(output.strategies.length, 0);
  assert.ok(output.uncertainties.some((u) => /no rate for the incumbent property/.test(u.statement)));
});

async function strategiesFor(target: Record<string, unknown>, evidence = SEARCH_EVIDENCE) {
  const input = plannerInput(
    snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE, ALT_HOTEL_PLACE]),
    target,
    scopedEvidence(evidence),
  );
  return newPlanner().plan(input);
}

test('g2 funding: extension anchor outside FUNDED_WINDOW allocates to incremental traveller payer', async () => {
  const { strategies } = await strategiesFor(TARGET_EXTEND);
  const strategy = strategies[0]!;
  const anchor = fundingAnchorFromCandidateOperations(strategy.candidateOperations);
  assert.equal(anchor, '2026-10-04T11:00:00+08:00');
  const rules: PolicyRule[] = [
    {
      id: 'rule-funded',
      kind: 'FUNDED_WINDOW',
      sourceId: 'src-policy',
      windowStart: '2026-09-29T00:00:00+08:00',
      windowEnd: '2026-10-02T23:59:00+08:00',
      coveredBy: 'EVENT_ORGANISATION',
      incrementalPayer: 'TRAVELLER',
      appliesTo: [],
    },
  ];
  const decision = payerDecisionFor(rules, anchor);
  assert.equal(decision?.kind, 'INCREMENTAL');
  assert.equal(decision?.payer, 'TRAVELLER');
  const allocation = allocateCost({
    rules,
    priceDelta: strategy.costImpact!,
    costAccruesAt: anchor,
  });
  assert.deepEqual(allocation?.incrementalAmount, strategy.costImpact);
  assert.equal(allocation?.incrementalPayer, 'TRAVELLER');
});

test('g2 funding: replacement anchor inside FUNDED_WINDOW stays covered by organisation', async () => {
  const { strategies } = await strategiesFor(TARGET_SWITCH);
  const strategy = strategies[0]!;
  const anchor = fundingAnchorFromCandidateOperations(strategy.candidateOperations);
  // No requested check-out: anchor falls back to the incumbent check-out instant.
  assert.equal(anchor, '2026-10-02T11:00:00+08:00');
  const rules: PolicyRule[] = [
    {
      id: 'rule-funded',
      kind: 'FUNDED_WINDOW',
      sourceId: 'src-policy',
      windowStart: '2026-09-29T00:00:00+08:00',
      windowEnd: '2026-10-03T23:59:00+08:00',
      coveredBy: 'EVENT_ORGANISATION',
      incrementalPayer: 'TRAVELLER',
      appliesTo: [],
    },
  ];
  const decision = payerDecisionFor(rules, anchor);
  assert.equal(decision?.kind, 'COVERED');
  assert.equal(decision?.payer, 'EVENT_ORGANISATION');
  const allocation = allocateCost({
    rules,
    priceDelta: strategy.costImpact!,
    costAccruesAt: anchor,
  });
  assert.ok(allocation);
});

test('g2 funding: absent temporal anchor leaves allocation UNKNOWN (undefined decision)', () => {
  // A stay whose candidate carries NO check-out/check-in fact has no funding
  // anchor. Rather than fabricating dates, the deterministic contract keeps
  // the payer decision unresolved (UNKNOWN) — never window-matched by guess.
  const anchor = fundingAnchorFromCandidateOperations([
    {
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP_ELEMENT',
      data: {
        id: 'el-stay-1',
        tripId: 'trip-1',
        elementKind: 'STAY',
        importance: 'REQUIRED',
        flexibility: 'FIXED',
        reservationState: 'HELD',
        status: 'UNKNOWN',
        dependsOn: [],
        governedByRuleSetIds: [],
        data: { placeId: 'plc-hotel-current' },
      },
    },
  ]);
  assert.equal(anchor, undefined);
  const decision = payerDecisionFor(
    [
      {
        id: 'rule-funded',
        kind: 'FUNDED_WINDOW',
        sourceId: 'src-policy',
        windowStart: '2026-09-29T00:00:00+08:00',
        windowEnd: '2026-10-03T23:59:00+08:00',
        coveredBy: 'EVENT_ORGANISATION',
        incrementalPayer: 'TRAVELLER',
        appliesTo: [],
      },
    ],
    anchor,
  );
  assert.equal(decision, undefined, 'no anchor -> no window can decide -> UNKNOWN');
});

test('g2 spend limit: FINANCIAL constraint evaluates the candidate gross against policy', async () => {
  const { strategies } = await strategiesFor(TARGET_SWITCH);
  const cheap = strategies.find((s) => s.costImpact?.amount === 500)!;
  const rules: PolicyRule[] = [
    {
      id: 'rule-spend-nightly',
      kind: 'SPEND_LIMIT',
      sourceId: 'src-policy',
      maxAmount: { amount: 800, currency: 'SGD' },
      period: 'NIGHT',
      appliesTo: [],
    },
  ];
  const ruleSet: RuleSet = {
    id: 'rs-spend',
    kind: 'ORGANISATION',
    name: 'Accommodation ceiling',
    sourceId: 'src-policy',
    rules,
  };
  const evaluate = (gross: { amount: number; currency: string }) => {
    const constraint: Constraint = ConstraintSchema.parse({
      id: 'c-spend',
      kind: 'FINANCIAL',
      hardness: 'HARD',
      evaluator: 'DETERMINISTIC',
      ruleSetId: 'rs-spend',
      derivedFromRuleId: 'rule-spend-nightly',
      parameters: { amount: gross.amount, currency: gross.currency },
    });
    const ctx = {
      trip: snapshotFor(stayElement(), []).trip,
      places: new Map(),
      ruleSets: new Map([[ruleSet.id, ruleSet]]),
      travellers: [],
      now: NOW,
    } as unknown as EvaluationContext;
    return evaluateConstraint(constraint, ctx);
  };
  const overLimit = evaluate({ amount: 900, currency: 'SGD' });
  assert.equal(overLimit.status, 'FAIL');
  assert.match(overLimit.evidence ?? '', /exceeds per-night limit 800 SGD/);
  const withinLimit = evaluate(cheap.costImpact!);
  assert.equal(withinLimit.status, 'PASS');
});

// ---------------------------------------------------------------------------
// Downstream: dispatch + overlay viability on the real engine
// ---------------------------------------------------------------------------

function scriptedHotel(outcome: HotelSearchOutcome): HotelCapability {
  const descriptor: CapabilityDescriptor = {
    family: 'HOTEL',
    providerId: 'scripted-hotel',
    mode: 'REPLAY',
    supportedOperations: ['hotel.search'],
    maxSideEffectLevel: 'READ_ONLY',
  };
  return {
    descriptor,
    async getStayContext() {
      throw new Error('not used');
    },
    async searchHotels(query: HotelSearchQuery) {
      assert.equal(query.checkInDate, '2026-09-29');
      return capabilityOk(structuredClone(outcome), {
        providerId: descriptor.providerId,
        mode: 'REPLAY',
        requestedAt: NOW,
      });
    },
    async quoteRate() {
      throw new Error('not used');
    },
    async bookStay() {
      throw new Error('not used');
    },
    async retrieveBooking() {
      throw new Error('not used');
    },
    async modifyStay() {
      throw new Error('not used');
    },
    async cancelStay() {
      throw new Error('not used');
    },
  };
}

test('loop integration: two rounds produce feasible ranked hotel candidates through the shared loop', async () => {
  const { runPlanningLoop } = await import('../src/app/planningLoop.ts');
  const { CaseService } = await import('../src/engine/case.ts');
  const { openDatabase } = await import('../src/persistence/database.ts');
  const { SqliteCaseRepository } = await import('../src/persistence/repositories.ts');
  const db = openDatabase(':memory:');
  const cases = new SqliteCaseRepository(db);
  await new CaseService({ cases }).open({ id: 'case-loop', tripId: 'trip-1', openedAt: NOW });
  const auditLog: unknown[] = [];
  const hotel = scriptedHotel(SEARCH_EVIDENCE);
  const capabilities: ToolDispatchCapabilities = { hotel };
  const planner = newPlanner();
  const snapshot = snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE, ALT_HOTEL_PLACE]);
  const deps: import('../src/app/planningLoop.ts').PlanningLoopDependencies = {
    planner,
    capabilities,
    viability: new OverlayViabilityEngine(),
    cases,
    audit: {
      append: async (entry) => void auditLog.push(entry),
      query: async () => [],
    },
  };
  const outcome = await runPlanningLoop(deps, {
    caseId: 'case-loop',
    snapshot,
    triggeringSignals: changeRequestSignal(TARGET_SWITCH),
    impact: impactStub(),
    capabilityRegistry: [hotel.descriptor],
    planningAt: NOW,
  });
  assert.equal(outcome.rounds, 2);
  assert.deepEqual(
    outcome.toolActivity.map((activity) => activity.request.operation),
    ['hotel.search'],
  );
  assert.equal(outcome.toolActivity[0]!.result.ok, true);
  assert.ok(outcome.strategies.length >= 2, 'round 2 proposes from the recorded evidence');
  assert.ok(
    outcome.rankedFeasibleIds.length > 0 || outcome.candidates.every((c) => !c.feasible),
    'ranking runs over deterministic viability verdicts',
  );
  assert.ok(auditLog.length > 0, 'planning evidence is persisted');
  db.close();
});

test('viability: candidate stay upsert evaluates on an isolated overlay copy', async () => {
  const { strategies } = await strategiesFor(TARGET_SWITCH);
  const engine = new OverlayViabilityEngine();
  const base = snapshotFor(stayElement(), [CURRENT_HOTEL_PLACE]);
  const result = await engine.evaluateOverlay({
    baseSnapshot: base,
    candidateOperations: strategies[0]!.candidateOperations,
  });
  assert.ok(result, 'overlay evaluation runs without mutating authoritative state');
  assert.equal(base.trip.elements[0]!.reservationState, 'CONFIRMED', 'base snapshot is never mutated');
});

test('dispatch: malformed search parameters are structured failures, never guesses', async () => {
  const hotel = scriptedHotel(SEARCH_EVIDENCE);
  const result = await dispatchToolRequest({ hotel }, {
    id: 'tool-bad',
    capability: 'HOTEL',
    operation: 'hotel.search',
    parameters: { location: { coordinates: { latitude: 1.28, longitude: 103.85 } }, checkInDate: 'not-a-date', checkOutDate: '2026-10-02' },
    purpose: 'invalid parameters must fail closed',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'INVALID_REQUEST');
});

// ---------------------------------------------------------------------------
// S2 fail-safes: insurance / entry evidence semantics stay UNKNOWN
// ---------------------------------------------------------------------------

test('s2 fail-safe: legal entry claims without authoritative sourcing are excluded, not accepted', () => {
  const result = interpretResearchFindings([
    {
      statement: 'Visa-free transit 96h',
      kind: 'LEGAL_ENTRY_FACT',
      authorityClaim: 'INFERRED',
      sourceUris: [],
      uncertainty: 'model guess',
    },
    {
      statement: 'Visa-free transit 96h per official gazette',
      kind: 'LEGAL_ENTRY_FACT',
      authorityClaim: 'AUTHORITATIVE',
      sourceUris: ['https://example.gov.example/transit-rule'],
    },
  ]);
  assert.deepEqual(result.accepted, ['Visa-free transit 96h per official gazette']);
  assert.equal(result.excludedStatements.length, 1);
  assert.match(result.uncertainties[0]!, /requires authoritative sourcing/);
});

test('s2 fail-safe: ENTRY constraints evaluate UNKNOWN without interpreter evidence', () => {
  const constraint: Constraint = ConstraintSchema.parse({
    id: 'c-entry',
    kind: 'ENTRY',
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    refs: [],
  });
  const ctx = {
    trip: snapshotFor(stayElement(), []).trip,
    places: new Map(),
    ruleSets: new Map(),
    travellers: [],
    now: NOW,
  } as unknown as EvaluationContext;
  const result = evaluateConstraint(constraint, ctx);
  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.evidence ?? '', /authoritative interpreter evidence/);
});
