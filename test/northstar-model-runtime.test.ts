/**
 * RV-N9 — Model Studio runtime evidence (Northstar Wave 2).
 *
 * Proves, on the real ModelStudioRecoveryPlanner + ModelStudioClient:
 *  - a scripted planner response (REPLAY mode) validates into a structured
 *    PlannerOutput carrying the frozen RecoveryStrategy[] contract;
 *  - malformed scripted output (not JSON, schema violation) fails closed
 *    with an honest empty plan, never a crash;
 *  - a LIVE path without credentials (NOT_CONFIGURED) degrades structurally
 *    with no fabricated strategies.
 *
 * The test wires ModelStudioClient over a ScriptedModelTransport and never
 * reaches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ModelStudioClient,
  ModelTransportError,
  ScriptedModelTransport,
} from '../src/intelligence/client.ts';
import { ModelStudioRecoveryPlanner } from '../src/intelligence/planner.ts';
import { RecoveryStrategySchema } from '../src/operational/strategy.ts';
import { PLANNER_OUTPUT_ALLOWED_KEYS, type PlannerInput, type RecoveryPlanner } from '../src/contracts/planner.ts';
import type { TripSnapshot } from '../src/operational/snapshot.ts';
import type { ImpactAssessment } from '../src/operational/impact.ts';
import type { TripSignal } from '../src/operational/signal.ts';

const AT = '2026-09-14T09:00:00+09:00';
const here = dirname(fileURLToPath(import.meta.url));

function savedModelOutput(name: string): string {
  return readFileSync(join(here, 'fixtures', 'model-outputs', name), 'utf8');
}

function makeSnapshot(): TripSnapshot {
  return {
    tripId: 'trip_1',
    takenAt: AT,
    tripVersion: 1,
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
          data: { mode: 'FLIGHT', originPlaceId: 'p1', destinationPlaceId: 'p2' },
        },
      ],
      objectives: [
        { id: 'obj_1', tripId: 'trip_1', statement: 'arrive before the required start time', hardness: 'HARD', status: 'ACTIVE', linkedElementIds: ['el_1'] },
      ],
      relations: [],
      governedByRuleSetIds: [],
      viability: 'DISRUPTED',
      version: 1,
      updatedAt: AT,
    },
    travellers: [{ id: 'trv_1', name: 'Traveller One', accessibilityRequirements: [], insuranceRuleSetIds: [], loyaltyContext: [] }],
    organisations: [],
    places: [],
    ruleSets: [],
    constraints: [],
    preferences: [],
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

function makeInput(): PlannerInput {
  return {
    caseId: 'case_1',
    snapshot: makeSnapshot(),
    triggeringSignals: [makeSignal()],
    impact: makeImpact(),
    capabilityRegistry: [
      { family: 'FLIGHT', providerId: 'p1', mode: 'REPLAY', supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'], maxSideEffectLevel: 'READ_ONLY' },
    ],
    priorToolResults: [],
    priorActionResults: [],
  };
}

function scriptedPlanner(responses: Array<string | ModelTransportError>, configured = true): {
  planner: ModelStudioRecoveryPlanner;
  transport: ScriptedModelTransport;
  client: ModelStudioClient;
} {
  const transport = new ScriptedModelTransport(responses);
  const client = new ModelStudioClient({ apiKey: configured ? 'k' : undefined, transport });
  let counter = 0;
  const planner = new ModelStudioRecoveryPlanner({
    client,
    idFactory: (prefix) => `${prefix}_${++counter}`,
    now: () => AT,
  });
  return { planner, transport, client };
}

test('RV-N9 model: scripted REPLAY validates into PlannerOutput strategies', async () => {
  const { planner } = scriptedPlanner([savedModelOutput('planner-strategies.json')]);
  const seam: RecoveryPlanner = planner;
  const output = await seam.plan(makeInput());
  assert.equal(output.strategies.length, 2);
  for (const strategy of output.strategies) {
    const parsed = RecoveryStrategySchema.parse(strategy);
    assert.equal(parsed.caseId, 'case_1');
    assert.equal(parsed.createdAt, AT);
    assert.match(parsed.id, /^strat_/);
  }
  for (const key of Object.keys(output)) {
    assert.ok((PLANNER_OUTPUT_ALLOWED_KEYS as readonly string[]).includes(key), `unexpected key: ${key}`);
  }
  assert.ok(output.rationale !== undefined, 'rationale preserved');
});

test('RV-N9 model: malformed JSON scripted output fails closed (no crash)', async () => {
  const { planner } = scriptedPlanner(['not a JSON object']);
  const output = await planner.plan(makeInput());
  assert.deepEqual(output.strategies, []);
  assert.deepEqual(output.toolRequests, []);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('INVALID_OUTPUT')));
  assert.ok(!('actionIntents' in output), 'must not leak an ActionIntent field');
});

test('RV-N9 model: schema-violating scripted output fails closed (no crash)', async () => {
  const { planner } = scriptedPlanner(['{"strategies": "not-an-array"}']);
  const output = await planner.plan(makeInput());
  assert.deepEqual(output.strategies, []);
  assert.ok(output.uncertainties.length > 0);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('INVALID_OUTPUT')));
});

test('RV-N9 model: transport-level error (TIMEOUT) degrades structurally', async () => {
  const { planner } = scriptedPlanner([
    new ModelTransportError('TIMEOUT', 'model_timeout', 'timed out', true),
    new ModelTransportError('TIMEOUT', 'model_timeout', 'timed out again', true),
  ]);
  const output = await planner.plan(makeInput());
  assert.deepEqual(output.strategies, []);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('TIMEOUT')));
});

test('RV-N9 model: LIVE without credentials fails closed, never reaches the network', async () => {
  const client = new ModelStudioClient({}); // no apiKey -> UnconfiguredModelTransport
  assert.equal(client.isConfigured(), false);
  const planner = new ModelStudioRecoveryPlanner({ client, now: () => AT });
  const output = await planner.plan(makeInput());
  assert.deepEqual(output.strategies, []);
  assert.ok(output.uncertainties.some((u) => u.statement.includes('NOT_CONFIGURED')));
  assert.equal(output.rationale, 'planner model unavailable; deterministic fallback produced no candidate strategies');
});

test('RV-N9 model: client.mode reflects the underlying transport (REPLAY for ScriptedModelTransport)', () => {
  const { client } = scriptedPlanner([]);
  assert.equal(client.mode, 'REPLAY');
  const live = new ModelStudioClient({ apiKey: 'k' });
  assert.equal(live.mode, 'LIVE');
  const unconfigured = new ModelStudioClient({});
  assert.equal(unconfigured.mode, 'LIVE');
  assert.equal(unconfigured.isConfigured(), false);
});

test('RV-N9 model: scripted transport records the request and consumes responses in order', async () => {
  const transport = new ScriptedModelTransport([
    savedModelOutput('planner-strategies.json'),
    savedModelOutput('planner-strategies.json'),
  ]);
  const client = new ModelStudioClient({ apiKey: 'k', transport });
  const planner = new ModelStudioRecoveryPlanner({ client, now: () => AT });
  const output1 = await planner.plan(makeInput());
  const output2 = await planner.plan(makeInput());
  assert.equal(output1.strategies.length, 2);
  assert.equal(output2.strategies.length, 2);
  assert.equal(transport.requests.length, 2);
});

test('RV-N9 model: deterministic output across replays of the same scripted response', async () => {
  const { planner: p1 } = scriptedPlanner([savedModelOutput('planner-strategies.json')]);
  const { planner: p2 } = scriptedPlanner([savedModelOutput('planner-strategies.json')]);
  const a = await p1.plan(makeInput());
  const b = await p2.plan(makeInput());
  assert.deepEqual(
    a.strategies.map((s) => ({ id: s.id, summary: s.summary, candidateOperations: s.candidateOperations })),
    b.strategies.map((s) => ({ id: s.id, summary: s.summary, candidateOperations: s.candidateOperations })),
  );
});
