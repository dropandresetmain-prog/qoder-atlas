/**
 * D3 — RecoveryPlanner tests (T-AI planner strategies/tool requests).
 *
 * Proves the lane acceptance criteria:
 * - malformed model output fails closed;
 * - explicit instruction beats latent preference (in planner context);
 * - multiple strategies can be returned;
 * - planner can request flight search/verify/fare rules/routing/research;
 * - planner cannot request flight.change / hotel.cancel / communication side effects;
 * - planner cannot output ActionIntent;
 * - uncertainties remain visible;
 * - candidate strategies do not claim deterministic viability.
 *
 * Uses saved/scripted model outputs; no live model calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLANNER_OUTPUT_ALLOWED_KEYS, type PlannerInput, type RecoveryPlanner } from '../src/contracts/planner.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';
import type { ImpactAssessment } from '../src/operational/impact.ts';
import type { TripSignal } from '../src/operational/signal.ts';
import type { ExecutionResult } from '../src/operational/intent.ts';
import type { PriorToolResult } from '../src/contracts/planner.ts';
import { RecoveryStrategySchema } from '../src/operational/strategy.ts';
import { ModelStudioClient, ModelTransportError, ScriptedModelTransport } from '../src/intelligence/client.ts';
import { ModelStudioRecoveryPlanner, buildPlannerPrompt } from '../src/intelligence/planner.ts';

const AT = '2026-09-14T09:00:00+09:00';
const here = dirname(fileURLToPath(import.meta.url));

function savedModelOutput(name: string): string {
  return readFileSync(join(here, 'fixtures', 'model-outputs', name), 'utf8');
}

function makeSnapshot(): TripSnapshot {
  return {
    tripId: 'trip_1',
    takenAt: AT,
    tripVersion: 3,
    trip: {
      id: 'trip_1',
      travellerIds: ['trv_1'],
      elements: [
        {
          elementKind: 'TRANSPORT_LEG',
          id: 'el_1',
          tripId: 'trip_1',
          importance: 'REQUIRED',
          flexibility: 'CHANGEABLE',
          reservationState: 'CONFIRMED',
          status: 'INVALID',
          dependsOn: [],
          governedByRuleSetIds: [],
          data: {
            mode: 'FLIGHT',
            originPlaceId: 'place_origin',
            destinationPlaceId: 'place_destination',
          },
        },
      ],
      objectives: [
        { id: 'obj_1', tripId: 'trip_1', statement: 'arrive before the required start time', hardness: 'HARD', status: 'ACTIVE', linkedElementIds: ['el_1'] },
        { id: 'obj_2', tripId: 'trip_1', statement: 'keep ground transfer costs reasonable', hardness: 'SOFT', status: 'ACTIVE', linkedElementIds: [] },
      ],
      relations: [],
      governedByRuleSetIds: ['rules_1'],
      viability: 'DISRUPTED',
      version: 3,
      updatedAt: AT,
    },
    travellers: [{ id: 'trv_1', name: 'Traveller One', accessibilityRequirements: [], insuranceRuleSetIds: [], loyaltyContext: [] }],
    organisations: [],
    places: [],
    ruleSets: [],
    constraints: [
      {
        id: 'con_1',
        kind: 'TEMPORAL',
        hardness: 'HARD',
        evaluator: 'DETERMINISTIC',
        status: 'UNKNOWN',
        refs: [{ entityType: 'TRIP_ELEMENT', id: 'el_1' }],
      },
    ],
    preferences: [
      {
        id: 'pref_1',
        travellerId: 'trv_1',
        statement: 'take the earliest workable replacement',
        origin: { kind: 'EXPLICIT_INSTRUCTION', issuedAt: AT, issuedBy: 'trv_1' },
        status: 'ACTIVE',
        sourceId: 'src_message',
      },
      {
        id: 'pref_2',
        travellerId: 'trv_1',
        statement: 'probably prefers window seats',
        origin: { kind: 'LATENT_INFERRED', evidence: 'one ambiguous hint', confidence: 0.3 },
        status: 'ACTIVE',
        sourceId: 'src_profile',
      },
    ],
    sourceRecords: [],
  };
}

function makeImpact(): ImpactAssessment {
  return {
    id: 'imp_1',
    tripId: 'trip_1',
    assessedAt: AT,
    severity: 'HIGH',
    directFailures: [{ elementId: 'el_1', resultingStatus: 'INVALID', reason: 'leg no longer viable' }],
    affectedElements: [],
    threatenedObjectives: [{ objectiveId: 'obj_1', threatened: true, reason: 'arrival window at risk' }],
    irreversibleLosses: [],
    affectedTravellerIds: ['trv_1'],
    sharedResourceImpacts: [],
    policyImplications: [],
    insuranceImplications: [],
    unresolvedUnknowns: ['replacement availability'],
  };
}

function makeSignal(): TripSignal {
  return {
    id: 'sig_1',
    kind: 'FLIGHT_CANCELLATION',
    occurredAt: AT,
    sourceId: 'src_provider',
    authority: 'AUTHORITATIVE',
    tripId: 'trip_1',
    subjectRef: { entityType: 'TRIP_ELEMENT', id: 'el_1' },
    summary: 'booked leg cancelled',
    payload: {},
  };
}

function makeInput(overrides?: Partial<PlannerInput>): PlannerInput {
  return {
    caseId: 'case_1',
    snapshot: makeSnapshot(),
    triggeringSignals: [makeSignal()],
    impact: makeImpact(),
    capabilityRegistry: [
      {
        family: 'FLIGHT',
        providerId: 'provider-x',
        mode: 'REPLAY',
        supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'],
        maxSideEffectLevel: 'READ_ONLY',
      },
    ],
    priorToolResults: [
      { toolRequestId: 'tool_prior_1', summary: 'earlier search returned two options', data: { optionCount: 2 } },
    ],
    priorActionResults: [],
    ...overrides,
  };
}

function makePlanner(responses: Array<string | ModelTransportError>, configured = true): {
  planner: ModelStudioRecoveryPlanner;
  transport: ScriptedModelTransport;
} {
  const transport = new ScriptedModelTransport(responses);
  const client = new ModelStudioClient({ apiKey: configured ? 'k' : undefined, transport });
  let counter = 0;
  const planner = new ModelStudioRecoveryPlanner({
    client,
    idFactory: (prefix) => `${prefix}_${++counter}`,
    now: () => AT,
  });
  return { planner, transport };
}

// ---------------------------------------------------------------------------
// Structured multi-strategy output
// ---------------------------------------------------------------------------

test('planner: returns multiple strategies with deterministic ids/caseId/timestamp', async () => {
  const { planner } = makePlanner([savedModelOutput('planner-strategies.json')]);
  // Type-level: the concrete planner satisfies the frozen RecoveryPlanner seam.
  const seam: RecoveryPlanner = planner;
  const output = await seam.plan(makeInput());

  assert.equal(output.strategies.length, 2, 'multiple candidate strategies');
  for (const strategy of output.strategies) {
    RecoveryStrategySchema.parse(strategy); // frozen strategy shape holds
    assert.equal(strategy.caseId, 'case_1');
    assert.equal(strategy.createdAt, AT);
  }
  // Deterministic assignment: stable prefix, unique, ordered by emission.
  assert.match(output.strategies[0]!.id, /^strat_/);
  assert.match(output.strategies[1]!.id, /^strat_/);
  assert.notEqual(output.strategies[0]!.id, output.strategies[1]!.id);
  assert.equal(output.strategies[0]!.candidateOperations.length, 1, 'overlay-only hypothetical operations');
  assert.equal(output.rationale !== undefined, true);

  // Frozen allowed-key set is exactly what the planner returns.
  for (const key of Object.keys(output)) {
    assert.ok((PLANNER_OUTPUT_ALLOWED_KEYS as readonly string[]).includes(key), `unexpected key: ${key}`);
  }
});

test('planner: can request flight search/verify/fare rules, routing and research (read-only)', async () => {
  const { planner } = makePlanner([savedModelOutput('planner-strategies.json')]);
  const output = await planner.plan(makeInput());

  const operations = [
    ...output.toolRequests.map((r) => r.operation),
    ...output.strategies.flatMap((s) => s.toolRequests.map((r) => r.operation)),
  ];
  assert.ok(operations.includes('flight.search'));
  assert.ok(operations.includes('flight.verify'));
  assert.ok(operations.includes('flight.fare_rules'));
  assert.ok(operations.includes('routing.context'));
  assert.ok(operations.includes('research.local_context'));
  for (const request of [...output.toolRequests, ...output.strategies.flatMap((s) => s.toolRequests)]) {
    assert.ok(request.id.length > 0, 'ids assigned deterministically');
    // Family consistency enforced by the frozen ToolRequest schema.
    if (request.operation.startsWith('flight.')) assert.equal(request.capability, 'FLIGHT');
    if (request.operation.startsWith('research.')) assert.equal(request.capability, 'RESEARCH');
  }
});

test('planner: uncertainties remain visible at plan and strategy level', async () => {
  const { planner } = makePlanner([savedModelOutput('planner-strategies.json')]);
  const output = await planner.plan(makeInput());

  assert.ok(output.uncertainties.some((u) => u.statement.includes('replacement flight availability')));
  assert.equal(output.uncertainties[0]!.severity, 'HIGH');
  const strategyUncertainties = output.strategies.flatMap((s) => s.uncertainties);
  assert.ok(strategyUncertainties.length >= 2, 'strategy-level uncertainties preserved');
  assert.ok(strategyUncertainties.every((u) => u.id.length > 0 && u.statement.length > 0));
});

// ---------------------------------------------------------------------------
// Fail-closed behavior
// ---------------------------------------------------------------------------

test('planner: malformed model output fails closed to an honest empty plan', async () => {
  const notJson = makePlanner(['this is not JSON']);
  const out1 = await notJson.planner.plan(makeInput());
  assert.deepEqual(out1.strategies, []);
  assert.deepEqual(out1.toolRequests, []);
  assert.ok(out1.uncertainties.some((u) => u.statement.includes('INVALID_OUTPUT')));

  const schemaViolation = makePlanner(['{"strategies":"not an array"}']);
  const out2 = await schemaViolation.planner.plan(makeInput());
  assert.deepEqual(out2.strategies, []);
  assert.ok(out2.uncertainties.length > 0, 'failure stays visible as uncertainty');
});

test('planner: timeout/unavailable paths degrade structurally without throwing', async () => {
  // Retryable TIMEOUT exhausts the bounded retry budget, then degrades.
  const timeout = makePlanner([
    new ModelTransportError('TIMEOUT', 'model_timeout', 'timed out', true),
    new ModelTransportError('TIMEOUT', 'model_timeout', 'timed out again', true),
  ]);
  const out = await timeout.planner.plan(makeInput());
  assert.deepEqual(out.strategies, []);
  assert.ok(out.uncertainties.some((u) => u.statement.includes('TIMEOUT')));
});

test('planner: no-credential client degrades structurally (application compatibility)', async () => {
  const client = new ModelStudioClient({});
  const planner = new ModelStudioRecoveryPlanner({ client, now: () => AT });
  const out = await planner.plan(makeInput());
  assert.deepEqual(out.strategies, []);
  assert.ok(out.uncertainties.some((u) => u.statement.includes('NOT_CONFIGURED')));
});

// ---------------------------------------------------------------------------
// Safety boundary: no side effects, no ActionIntent, no viability claims
// ---------------------------------------------------------------------------

test('planner: cannot request consequential operations (flight.change etc. fail closed)', async () => {
  const { planner } = makePlanner([savedModelOutput('planner-attempts-side-effect.json')]);
  const output = await planner.plan(makeInput());
  // The read-only operation vocabulary rejects the whole malformed output.
  assert.deepEqual(output.strategies, []);
  assert.deepEqual(output.toolRequests, []);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('INVALID_OUTPUT')));
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes('flight.change'), 'consequential operation must not leak through');
});

test('planner: capability/operation mismatch is dropped with visible uncertainty, not rerouted', async () => {
  const mismatch = JSON.stringify({
    strategies: [
      {
        summary: 'strategy with a mismatched request',
        candidateOperations: [],
        toolRequests: [{ capability: 'HOTEL', operation: 'flight.search', parameters: {}, purpose: 'wrong family' }],
        assumptions: [],
        uncertainties: [],
        expectedOutcomes: [],
      },
    ],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
  });
  const { planner } = makePlanner([mismatch]);
  const output = await planner.plan(makeInput());
  assert.equal(output.strategies.length, 1, 'valid strategy body survives');
  assert.deepEqual(output.strategies[0]!.toolRequests, [], 'mismatched request dropped');
  assert.ok(output.uncertainties.some((u) => u.statement.includes('discarded invalid planner tool request')));
});

test('planner: cannot output ActionIntent (smuggled key rejected, fail closed)', async () => {
  const { planner } = makePlanner([savedModelOutput('planner-attempts-action-intent.json')]);
  const output = await planner.plan(makeInput());
  assert.deepEqual(output.strategies, []);
  assert.ok(!('actionIntents' in output), 'ActionIntent channel must not exist on planner output');
  assert.ok(!('actions' in output));
  assert.ok(output.uncertainties.some((u) => u.statement.includes('INVALID_OUTPUT')));
});

test('planner: candidate strategies cannot claim deterministic viability they never performed', async () => {
  const { planner } = makePlanner([savedModelOutput('planner-attempts-viability-claim.json')]);
  const output = await planner.plan(makeInput());
  // strict schema rejects the fabricated viability field -> fail closed.
  assert.deepEqual(output.strategies, []);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('INVALID_OUTPUT')));

  // And valid strategies carry no viability-assertion surface at all.
  const valid = makePlanner([savedModelOutput('planner-strategies.json')]);
  const okOutput = await valid.planner.plan(makeInput());
  for (const strategy of okOutput.strategies) {
    for (const key of Object.keys(strategy)) {
      assert.ok(
        !['viability', 'viabilityVerified', 'feasible', 'authorityDecision'].includes(key),
        `strategy must not carry deterministic claims: ${key}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Prompt projection: uses all PlannerInput facets; explicit beats latent
// ---------------------------------------------------------------------------

test('planner prompt: projects snapshot, signals, impact, capabilities and prior results', () => {
  const input = makeInput({
    priorActionResults: [
      {
        id: 'exec_1',
        intentId: 'intent_1',
        executedAt: AT,
        status: 'FAILURE',
        provenance: 'SIMULATED',
        resultSummary: 'earlier attempt failed',
      },
    ] satisfies ExecutionResult[],
  });
  const prompt = buildPlannerPrompt(input);
  const context = JSON.parse(prompt.userPrompt) as Record<string, unknown> & {
    caseId: string;
    trip: { objectives: Array<{ hardness: string }>; elements: unknown[] };
    constraints: unknown[];
    preferences: Array<{ originKind: string; precedence: number }>;
    triggeringSignals: Array<{ kind: string }>;
    impact: { severity: string };
    capabilities: Array<{ family: string }>;
    priorToolResults: PriorToolResult[];
    priorActionResults: ExecutionResult[];
  };

  assert.equal(context.caseId, 'case_1');
  assert.equal(context.trip.objectives.length, 2);
  assert.ok(context.trip.objectives.some((o) => o.hardness === 'HARD'));
  assert.equal(context.trip.elements.length, 1);
  assert.equal(context.constraints.length, 1);
  assert.equal(context.triggeringSignals[0]!.kind, 'FLIGHT_CANCELLATION');
  assert.equal(context.impact.severity, 'HIGH');
  assert.equal(context.capabilities[0]!.family, 'FLIGHT');
  assert.equal(context.priorToolResults[0]!.toolRequestId, 'tool_prior_1');
  assert.equal(context.priorActionResults[0]!.status, 'FAILURE');
});

test('planner prompt: explicit instruction outranks latent preference in projected context', () => {
  const prompt = buildPlannerPrompt(makeInput());
  const context = JSON.parse(prompt.userPrompt) as {
    preferences: Array<{ originKind: string; precedence: number; statement: string }>;
  };
  assert.equal(context.preferences.length, 2);
  assert.equal(context.preferences[0]!.originKind, 'EXPLICIT_INSTRUCTION');
  assert.equal(context.preferences[1]!.originKind, 'LATENT_INFERRED');
  assert.ok(context.preferences[0]!.precedence > context.preferences[1]!.precedence);

  // The system prompt states the safety boundary, not scenario facts.
  assert.ok(prompt.systemPrompt.includes('flight.search'));
  assert.ok(prompt.systemPrompt.includes('Never request consequential operations'));
  assert.ok(prompt.systemPrompt.includes('never claim feasibility'));
});
