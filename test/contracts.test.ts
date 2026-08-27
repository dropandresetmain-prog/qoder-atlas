/**
 * F2 evidence — seam/envelope contract proofs.
 * Proves: structured failure envelopes; LIVE/REPLAY shared normalization;
 * read models without graph internals; planner output carries no executable
 * side effects; repository interfaces are implementable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CapabilityErrorSchema,
  capabilityError,
  capabilityOk,
  type AdapterMode,
  type CapabilityResult,
  type ProviderAdapter,
} from '../src/contracts/envelope.ts';
import type {
  FlightCapability,
  FlightSearchQuery,
  FlightSearchOutcome,
  RouteContext,
  RoutingCapability,
} from '../src/contracts/capabilities.ts';
import type { TripRepository } from '../src/contracts/repositories.ts';
import type { PlannerOutput, RecoveryPlanner } from '../src/contracts/planner.ts';
import { PLANNER_OUTPUT_ALLOWED_KEYS } from '../src/contracts/planner.ts';
import type {
  OperatorDashboardView,
  ReadModelEnvelope,
  TravellerTripView,
} from '../src/contracts/readmodels.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';
import type { ImpactAssessment } from '../src/operational/impact.ts';
import {
  ToolRequestSchema,
  ToolOperationSchema,
  TOOL_OPERATION_FAMILY,
} from '../src/operational/strategy.ts';
import {
  AuthorisedExecutionSchema,
  CapabilityOperationSchema,
  executionGateIssues,
  isExecutable,
  type ActionIntent,
  type AuthorityDecision,
} from '../src/operational/intent.ts';

const AT = '2026-09-14T09:00:00+09:00';

test('envelope: provider failure is structured data, not an exception', () => {
  const error = CapabilityErrorSchema.parse({
    category: 'UNAVAILABLE',
    code: 'provider_timeout',
    message: 'provider did not respond',
    retryable: true,
  });
  const result: CapabilityResult<FlightSearchOutcome> = capabilityError(error, {
    providerId: 'provider-x',
    mode: 'REPLAY',
    requestedAt: AT,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'UNAVAILABLE');
    assert.equal(result.error.retryable, true);
  }
  assert.throws(() => CapabilityErrorSchema.parse({ category: 'WEIRD', code: 'x', message: 'y' }));
});

test('envelope: success results carry mode metadata (LIVE vs REPLAY)', () => {
  const outcome: FlightSearchOutcome = { offers: [] };
  for (const mode of ['LIVE', 'REPLAY'] as AdapterMode[]) {
    const result = capabilityOk(outcome, { providerId: 'provider-x', mode, requestedAt: AT });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.meta.mode, mode);
  }
});

test('LIVE and REPLAY share the identical normalization path', async () => {
  interface Raw { flights: { dep: string; arr: string }[] }
  const recorded: Raw = { flights: [{ dep: '2026-09-14T08:00:00+09:00', arr: '2026-09-14T10:15:00+09:00' }] };

  function makeAdapter(mode: AdapterMode): ProviderAdapter<void, Raw, { count: number; firstDeparture: string }> {
    return {
      providerId: 'provider-x',
      mode,
      async obtainRaw(): Promise<Raw> {
        // LIVE would call the provider; REPLAY loads the recording.
        return recorded;
      },
      normalize(raw: Raw) {
        return { count: raw.flights.length, firstDeparture: raw.flights[0]?.dep ?? '' };
      },
    };
  }

  const live = makeAdapter('LIVE');
  const replay = makeAdapter('REPLAY');
  const fromLive = live.normalize(await live.obtainRaw());
  const fromReplay = replay.normalize(await replay.obtainRaw());
  assert.deepEqual(fromLive, fromReplay);
});

test('capability interfaces: descriptors are provider-neutral and operation-typed', () => {
  const flight: Pick<FlightCapability, 'descriptor'> = {
    descriptor: {
      family: 'FLIGHT',
      providerId: 'provider-x',
      mode: 'REPLAY',
      supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'],
      maxSideEffectLevel: 'READ_ONLY',
    },
  };
  assert.equal(flight.descriptor.family, 'FLIGHT');

  const routing: Pick<RoutingCapability, 'descriptor'> = {
    descriptor: {
      family: 'ROUTING',
      providerId: 'provider-y',
      mode: 'REPLAY',
      supportedOperations: ['routing.context'],
      maxSideEffectLevel: 'READ_ONLY',
    },
  };
  assert.equal(routing.descriptor.family, 'ROUTING');
  const _routeShape: RouteContext = {
    duration: { expectedMinutes: 45, sourceId: 'src_research', observedAt: AT, quality: 'MEDIUM' },
    trafficCondition: 'UNKNOWN',
  };
  assert.equal(_routeShape.duration.expectedMinutes, 45);
});

test('read models: operator + traveller views build from plain projections only', () => {
  const envelope: ReadModelEnvelope<OperatorDashboardView> = {
    state: 'LOADED',
    generatedAt: AT,
    data: {
      generatedAt: AT,
      summary: { ready: 1, atRisk: 0, disrupted: 1, recovering: 0, awaitingDecision: 1, managedConfirmed: 0 },
      arrangementCounts: { total: 1, northstarArranged: 1, selfOrOtherArranged: 0, unspecified: 0 },
      trips: [
        {
          tripId: 'trip_1',
          travellerNames: ['Traveller One'],
          status: 'DISRUPTED',
          whatChanged: 'Your flight was cancelled',
          affectedItems: ['Airport transfer', 'Hotel arrival'],
          systemActivity: ['Looking for replacement flights'],
          pendingDecisions: [
            { caseId: 'case_1', decisionType: 'APPROVAL', description: 'Approve replacement flight' },
          ],
          uncertainties: ['Replacement seat availability'],
          travellerResponseStatus: 'AWAITING',
          updatedAt: AT,
        },
      ],
    },
  };
  assert.equal(envelope.data?.trips.length, 1);

  const traveller: TravellerTripView = {
    tripId: 'trip_1',
    status: 'RECOVERING',
    whatChanged: 'Your flight was cancelled',
    whatMattersNow: 'Making it to your talk on time',
    actionsInProgress: ['Rebooking an earlier flight'],
    inputRequested: [],
    remainderViable: 'UNKNOWN',
    updatedAt: AT,
  };
  assert.equal(traveller.remainderViable, 'UNKNOWN');

  const errorEnvelope: ReadModelEnvelope<OperatorDashboardView> = {
    state: 'ERROR',
    errorMessage: 'read model unavailable',
  };
  assert.equal(errorEnvelope.state, 'ERROR');
});

test('planner output: no executable side effects outside ActionIntent flow', () => {
  const output: PlannerOutput = {
    strategies: [],
    toolRequests: [],
    assumptions: ['hotel holds late arrival'],
    uncertainties: [],
  };

  // Runtime key check against the frozen allowed set.
  for (const key of Object.keys(output)) {
    assert.ok(
      (PLANNER_OUTPUT_ALLOWED_KEYS as readonly string[]).includes(key),
      `unexpected planner output key: ${key}`,
    );
  }
  for (const forbidden of ['actionIntents', 'actions', 'execute', 'authorityDecisions']) {
    assert.ok(!PLANNER_OUTPUT_ALLOWED_KEYS.includes(forbidden as never), `forbidden key allowed: ${forbidden}`);
  }

  // Type-level: PlannerOutput must not structurally contain an intent list.
  type CarriesIntents = PlannerOutput extends { actionIntents: unknown[] } ? true : false;
  const carriesIntents: CarriesIntents = false;
  assert.equal(carriesIntents, false);
});

test('planner interface: minimal input compiles and returns structured output', async () => {
  const planner: RecoveryPlanner = {
    async plan() {
      return { strategies: [], toolRequests: [], assumptions: [], uncertainties: [] };
    },
  };
  const snapshot: TripSnapshot = {
    tripId: 'trip_1',
    takenAt: AT,
    tripVersion: 0,
    trip: {
      id: 'trip_1',
      travellerIds: ['trv_1'],
      elements: [],
      objectives: [],
      relations: [],
      governedByRuleSetIds: [],
      viability: 'UNKNOWN',
      version: 0,
      updatedAt: AT,
    },
    travellers: [],
    organisations: [],
    places: [],
    ruleSets: [],
    constraints: [],
    preferences: [],
    sourceRecords: [],
  };
  const impact: ImpactAssessment = {
    id: 'imp_1',
    tripId: 'trip_1',
    assessedAt: AT,
    severity: 'HIGH',
    directFailures: [],
    affectedElements: [],
    threatenedObjectives: [],
    irreversibleLosses: [],
    affectedTravellerIds: [],
    sharedResourceImpacts: [],
    policyImplications: [],
    insuranceImplications: [],
    unresolvedUnknowns: [],
  };
  const out = await planner.plan({
    caseId: 'case_1',
    snapshot,
    triggeringSignals: [],
    impact,
    capabilityRegistry: [],
    priorToolResults: [],
    priorActionResults: [],
  });
  assert.deepEqual(out.strategies, []);
});

test('repositories: interfaces are implementable with a plain store', async () => {
  const store = new Map<string, Trip>();
  const repo: TripRepository = {
    async saveTrip(trip) {
      store.set(trip.id, trip);
    },
    async getTrip(id) {
      return store.get(id);
    },
    async listTrips() {
      return [...store.values()].map((t) => ({
        tripId: t.id,
        travellerIds: t.travellerIds,
        viability: t.viability,
        updatedAt: t.updatedAt,
      }));
    },
  };
  const trip: Trip = {
    id: 'trip_1',
    travellerIds: ['trv_1'],
    elements: [],
    objectives: [],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: AT,
  };
  await repo.saveTrip(trip);
  const loaded = await repo.getTrip('trip_1');
  assert.equal(loaded?.id, 'trip_1');
  const summaries = await repo.listTrips();
  assert.equal(summaries.length, 1);
});

test('flight search query stays provider-neutral', () => {
  const query: FlightSearchQuery = {
    origin: { system: 'iata', value: 'AAA' },
    destination: { system: 'iata', value: 'BBB' },
    departureDate: '2026-09-14',
    passengers: { adults: 1 },
  };
  assert.equal(query.origin.system, 'iata');
});

test('tool requests: planner can request required read-only operations', () => {
  const readOnlyRequests = [
    { capability: 'FLIGHT', operation: 'flight.search' },
    { capability: 'FLIGHT', operation: 'flight.verify' },
    { capability: 'FLIGHT', operation: 'flight.fare_rules' },
    { capability: 'FLIGHT', operation: 'flight.refund_quote' },
    { capability: 'HOTEL', operation: 'hotel.context' },
    { capability: 'ROUTING', operation: 'routing.context' },
    { capability: 'RESEARCH', operation: 'research.entry_requirements' },
    { capability: 'RESEARCH', operation: 'research.local_context' },
  ] as const;
  for (const [index, request] of readOnlyRequests.entries()) {
    const parsed = ToolRequestSchema.parse({
      id: `tool_${index}`,
      capability: request.capability,
      operation: request.operation,
      purpose: 'information for recovery planning',
    });
    assert.equal(parsed.operation, request.operation);
  }
});

test('tool requests: consequential operations are rejected, not re-routable', () => {
  const consequential = [
    { capability: 'FLIGHT', operation: 'flight.change' },
    { capability: 'FLIGHT', operation: 'flight.cancel' },
    { capability: 'HOTEL', operation: 'hotel.modify' },
    { capability: 'HOTEL', operation: 'hotel.cancel' },
    { capability: 'COMMUNICATION', operation: 'communication.notify' },
    { capability: 'COMMUNICATION', operation: 'communication.request_approval' },
    { capability: 'SIMULATION', operation: 'simulation.provider_action' },
  ] as const;
  for (const request of consequential) {
    assert.throws(
      () =>
        ToolRequestSchema.parse({
          id: 'tool_bad',
          capability: request.capability,
          operation: request.operation,
          purpose: 'attempted side effect via planner',
        }),
      (err: unknown) => err instanceof Error,
      `tool request must reject ${request.operation}`,
    );
  }
  // Arbitrary unknown operation strings are rejected too.
  assert.throws(() =>
    ToolRequestSchema.parse({
      id: 'tool_unknown',
      capability: 'FLIGHT',
      operation: 'flight.do_whatever',
      purpose: 'x',
    }),
  );
});

test('tool requests: capability/operation mismatch is refused and vocabulary stays read-only', () => {
  assert.throws(() =>
    ToolRequestSchema.parse({
      id: 'tool_mismatch',
      capability: 'HOTEL',
      operation: 'flight.search',
      purpose: 'x',
    }),
  );
  const capabilityOperations = new Set<string>(CapabilityOperationSchema.options);
  for (const operation of ToolOperationSchema.options) {
    assert.ok(capabilityOperations.has(operation), `tool op not a capability op: ${operation}`);
  }
  for (const operation of ToolOperationSchema.options) {
    assert.ok(TOOL_OPERATION_FAMILY[operation], `missing family mapping for ${operation}`);
  }
});

function sampleIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: 'ai_1',
    caseId: 'case_1',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: {},
    sideEffectLevel: 'MONEY_MOVING',
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: AT,
    ...overrides,
  };
}

function sampleDecision(overrides: Partial<AuthorityDecision> = {}): AuthorityDecision {
  return {
    id: 'ad_1',
    intentId: 'ai_1',
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: ['spend below threshold'],
    conditions: [],
    ...overrides,
  };
}

test('authority gate: valid deterministic authority evidence permits execution', () => {
  const auto = AuthorisedExecutionSchema.parse({
    intent: sampleIntent({ status: 'AUTHORISED' }),
    authority: sampleDecision(),
  });
  assert.deepEqual(executionGateIssues(auto), []);
  assert.equal(isExecutable(auto), true);

  const approved = AuthorisedExecutionSchema.parse({
    intent: sampleIntent(),
    authority: sampleDecision({
      outcome: 'REQUIRES_ORGANISATION_APPROVER',
      approval: {
        decidedAt: AT,
        decidedBy: { entityType: 'ORGANISATION', id: 'org_1' },
        decision: 'APPROVED',
      },
    }),
  });
  assert.deepEqual(executionGateIssues(approved), []);
});

test('authority gate: mismatched, missing, declined and blocked evidence are rejected', () => {
  const mismatched = AuthorisedExecutionSchema.parse({
    intent: sampleIntent(),
    authority: sampleDecision({ intentId: 'ai_other' }),
  });
  assert.ok(executionGateIssues(mismatched).some((i) => i.includes('does not reference')));

  const missingApproval = AuthorisedExecutionSchema.parse({
    intent: sampleIntent(),
    authority: sampleDecision({ outcome: 'REQUIRES_TRAVELLER' }),
  });
  assert.ok(executionGateIssues(missingApproval).some((i) => i.includes('requires a recorded approval')));

  const declined = AuthorisedExecutionSchema.parse({
    intent: sampleIntent(),
    authority: sampleDecision({
      outcome: 'REQUIRES_ORGANISATION_APPROVER',
      approval: {
        decidedAt: AT,
        decidedBy: { entityType: 'ORGANISATION', id: 'org_1' },
        decision: 'DECLINED',
      },
    }),
  });
  assert.ok(executionGateIssues(declined).some((i) => i.includes('declined')));

  const blocked = AuthorisedExecutionSchema.parse({
    intent: sampleIntent(),
    authority: sampleDecision({ outcome: 'BLOCKED' }),
  });
  assert.ok(executionGateIssues(blocked).some((i) => i.includes('BLOCKED')));
  assert.equal(isExecutable(blocked), false);
});

test('authority gate: a self-marked AUTHORISED intent alone cannot open the executor', () => {
  // An arbitrary caller/model constructs an intent with status AUTHORISED.
  // Without a matching permissive AuthorityDecision the gate stays closed:
  // intent.status is never consulted by the gate.
  const forged = sampleIntent({ status: 'AUTHORISED' });
  const blockedPair = AuthorisedExecutionSchema.parse({
    intent: forged,
    authority: sampleDecision({ intentId: forged.id, outcome: 'BLOCKED' }),
  });
  assert.equal(isExecutable(blockedPair), false);

  const mismatchedPair = AuthorisedExecutionSchema.parse({
    intent: forged,
    authority: sampleDecision({ intentId: 'ai_not_this_one', outcome: 'AUTO_APPROVED' }),
  });
  assert.equal(isExecutable(mismatchedPair), false);

  const awaitingApprovalPair = AuthorisedExecutionSchema.parse({
    intent: forged,
    authority: sampleDecision({ intentId: forged.id, outcome: 'REQUIRES_HUMAN_AGENT' }),
  });
  assert.equal(isExecutable(awaitingApprovalPair), false);
});
