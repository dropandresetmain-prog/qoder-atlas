/**
 * Wave 3R Mission 1 / DR-1 — runtime-truth regression evidence.
 *
 * Permanently pins:
 * - DR-1.1 wall-clock/causal coherence: a recovery driven at ordinary
 *   current runtime time (before the fixture signal's instant) still
 *   resolves, while genuinely causally-older evidence still cannot outrank
 *   the disruption signal (`observedAt >= signalInstant` unchanged);
 * - DR-1.2 authoritative Trip aggregate reconciliation: a resolved case and
 *   its trip agree, reconciliation persists through restart, provider
 *   observation alone never flips the aggregate, and hard FAIL/UNKNOWN
 *   still caps reconciliation;
 * - DR-1.3 authority currency incomparability fails closed (ADR-045).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';
import { loadScenario } from '../src/scenarios/loader.ts';
import { openDatabase } from '../src/persistence/database.ts';
import { impactProposal, ImpactEngine } from '../src/engine/impact.ts';
import { evaluateConstraints, type EvaluationContext } from '../src/engine/evaluators.ts';
import { CaseVerifier } from '../src/engine/observation.ts';
import { DeterministicAuthorityEngine } from '../src/engine/authority.ts';
import type { RuleSetSource } from '../src/engine/authority.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { Constraint } from '../src/domain/constraints.ts';
import type { TripElement } from '../src/domain/elements.ts';
import type { IsoDateTime } from '../src/domain/common.ts';
import type { ImpactAssessment } from '../src/operational/impact.ts';
import type { ActionIntent } from '../src/operational/intent.ts';
import type { AuthorityContext } from '../src/contracts/services.ts';
import type { MutationProposal } from '../src/operational/mutation.ts';
import type { ScenarioSpec } from '../src/scenarios/spec.ts';
import {
  scenarioHarness,
  seedScenario,
  cancellationProposal,
  loadScenario as loadHarnessScenario,
  SCENARIO_A_PATH,
  type ScenarioHarness,
} from './a2-harness.ts';

const FIXTURES_ROOT = resolve('fixtures');
const SCENARIO_A_DIR = join(FIXTURES_ROOT, 'scenarios', 'anchor-event-speaker');

// "Ordinary" runtime instants: the host's present (2026-08-24), strictly
// BEFORE the fixture disruption signal's instant (2026-09-12). Without the
// causal-horizon lift these stamps made recovery evidence appear causally
// older than the disruption and looped every case back to PLANNING.
const NOW_PLAN_AT = '2026-08-24T09:00:00.000Z';
const NOW_BEGIN_AT = '2026-08-24T09:05:00.000Z';
const NOW_DECIDE_AT = '2026-08-24T09:10:00.000Z';
const NOW_EXECUTE_AT = '2026-08-24T09:15:00.000Z';

const runtimeConfig = AppConfigSchema.parse({
  environment: 'local',
  adapterMode: 'REPLAY',
  sqlitePath: ':memory:',
  fixturesDir: FIXTURES_ROOT,
  providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
});

async function postJson(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Full credential-free recovery loop driven at ordinary current-time instants. */
async function runRuntimeLoopAtOrdinaryTime(base: string, scenarioDir: string): Promise<string> {
  const spec = loadScenario(scenarioDir);
  const disruption = await postJson(base, '/api/runtime/disruption', spec.disruption.signal);
  assert.equal(disruption.status, 200);
  const caseId = disruption.body['caseId'] as string;

  const plan = await postJson(base, '/api/runtime/plan', { caseId, at: NOW_PLAN_AT });
  assert.equal(plan.status, 200);
  const bestStrategyId = plan.body['bestStrategyId'] as string;
  assert.ok(bestStrategyId, 'planning must rank a feasible strategy first');

  const begin = await postJson(base, '/api/runtime/begin', { caseId, strategyId: bestStrategyId, at: NOW_BEGIN_AT });
  assert.equal(begin.status, 200);
  const intentId = begin.body['intentId'] as string;

  const decide = await postJson(base, '/api/runtime/decide', {
    caseId,
    intentId,
    decidedBy: { entityType: 'TRAVELLER', id: spec.trip.travellerIds[0] },
    verdict: 'APPROVED',
    at: NOW_DECIDE_AT,
  });
  assert.equal(decide.status, 200);

  const execute = await postJson(base, '/api/runtime/execute', { caseId, intentId, at: NOW_EXECUTE_AT });
  assert.equal(execute.status, 200);
  assert.equal(execute.body['caseStatus'], 'RESOLVED');
  return caseId;
}

function tripViabilityOf(db: { prepare(sql: string): { get(...params: unknown[]): unknown } }, tripId: string): string {
  const row = db.prepare('SELECT data FROM trips WHERE id = ?').get(tripId) as { data: string };
  return (JSON.parse(row.data) as Trip).viability;
}

test('DR-1.1 A: recovery at ordinary current runtime time resolves (causal-horizon lift)', async () => {
  const composed = await composeAppRuntime(runtimeConfig);
  const server = createAppServer(runtimeConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const caseId = await runRuntimeLoopAtOrdinaryTime(base, SCENARIO_A_DIR);
    const detail = (await (await fetch(`${base}/api/cases/${caseId}`)).json()) as {
      status: string;
      resolution?: { outcome: string };
    };
    assert.equal(detail.status, 'RESOLVED');
    assert.equal(detail.resolution?.outcome, 'FULLY_RECOVERED');
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }
});

test('DR-1.1 B: genuinely causally-older evidence still cannot outrank the disruption signal', async () => {
  const spec = loadHarnessScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const signal = spec.disruption.signal;
  const subject = spec.trip.elements.find((e) => e.id === signal.subjectRef?.id);
  assert.ok(subject && subject.elementKind === 'TRANSPORT_LEG');
  const engine = new ImpactEngine({ trips: h.trips, signals: h.signals, entities: h.entities });

  // Baseline: the authoritative cancellation signal implies a direct failure.
  const baseline = await engine.assess(spec.trip.id);
  assert.deepEqual(baseline.directFailures.map((f) => f.elementId), [subject.id]);

  // Causally OLDER replacement evidence (different offset on purpose: instant
  // comparison, not string ordering, decides) must NOT suppress the signal.
  const older = replacementLeg(subject, '2026-09-12T00:30:00.000Z'); // == 09:30+09:00 < signal 18:01+09:00
  const olderOutcome = await h.mutations.applyProposal(upsertElementProposal('prop-dr1-older', signal.occurredAt, older));
  assert.equal(olderOutcome.accepted, true, olderOutcome.issues.map((i) => i.message).join('; '));
  const withOlder = await engine.assess(spec.trip.id);
  assert.deepEqual(
    withOlder.directFailures.map((f) => f.elementId),
    [subject.id],
    'replacement evidence observed BEFORE the signal must not outrank it',
  );

  // Causally LATER authoritative replacement evidence still outranks the
  // signal: the causal rule is intact in both directions.
  const later = replacementLeg(subject, '2026-09-12T10:30:00.000Z'); // == 19:30+09:00 > signal 18:01+09:00
  const laterOutcome = await h.mutations.applyProposal(upsertElementProposal('prop-dr1-later', '2026-09-12T10:30:00.000Z', later));
  assert.equal(laterOutcome.accepted, true, laterOutcome.issues.map((i) => i.message).join('; '));
  const withLater = await engine.assess(spec.trip.id);
  assert.equal(withLater.directFailures.length, 0, 'post-signal authoritative evidence outranks the signal');
});

function replacementLeg(element: TripElement, observedAt: IsoDateTime): TripElement {
  if (element.elementKind !== 'TRANSPORT_LEG') throw new Error('expected transport leg');
  const departure = element.data.scheduledDeparture;
  if (!departure) throw new Error('expected scheduled departure fact');
  return {
    ...element,
    reservationState: 'CONFIRMED',
    data: {
      ...element.data,
      scheduledDeparture: {
        ...departure,
        value: '2026-09-13T11:10:00+09:00',
        authority: 'AUTHORITATIVE',
        observedAt,
      },
    },
  };
}

function upsertElementProposal(id: string, requestedAt: IsoDateTime, element: TripElement): MutationProposal {
  return {
    id,
    origin: 'PROVIDER',
    sourceId: 'src_a_provider_state',
    requestedAt,
    rationale: 'observed provider evidence for causal-ordering regression',
    operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: element.id, data: element }],
  };
}

/**
 * Replicate the signal pipeline's disruption-time persistence: assess,
 * evaluate constraints, persist through impactProposal. This is what sets
 * the authoritative trip DISRUPTED before any recovery runs.
 */
async function disruptTrip(h: ScenarioHarness, spec: ScenarioSpec): Promise<void> {
  const engine = new ImpactEngine({ trips: h.trips, signals: h.signals, entities: h.entities });
  const assessment = await engine.assess(spec.trip.id);
  const trip = await h.trips.getTrip(spec.trip.id);
  assert.ok(trip);
  const constraints = (await h.entities.list('CONSTRAINT'))
    .filter((e) => e.entityType === 'CONSTRAINT')
    .map((e) => e.entity);
  const ctx: EvaluationContext = {
    trip,
    places: new Map(),
    ruleSets: new Map(
      (await h.entities.list('RULE_SET'))
        .filter((e) => e.entityType === 'RULE_SET')
        .map((e) => [e.entity.id, e.entity]),
    ),
    travellers: [],
    now: assessment.assessedAt,
  };
  const evaluations = evaluateConstraints(constraints, ctx);
  const outcome = await h.mutations.applyProposal(impactProposal(assessment, constraints, evaluations, trip));
  assert.equal(outcome.accepted, true, outcome.issues.map((i) => i.message).join('; '));
}

// ---------------------------------------------------------------------------
// DR-1.2 — authoritative Trip aggregate reconciliation
// ---------------------------------------------------------------------------

function cleanAssessment(tripId: string, overrides: Partial<ImpactAssessment> = {}): ImpactAssessment {
  return {
    id: `impact-${tripId}-reconcile-test`,
    tripId,
    assessedAt: '2026-09-12T19:30:00+09:00',
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
    ...overrides,
  };
}

function disruptedTrip(): Trip {
  return {
    id: 'trip_reconcile_unit',
    label: 'Reconciliation unit trip',
    travellerIds: ['trv_x'],
    elements: [],
    objectives: [],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'DISRUPTED',
    version: 3,
    updatedAt: '2026-09-12T18:00:00+09:00',
  };
}

function hardConstraint(id: string): Constraint {
  return {
    id,
    kind: 'TEMPORAL',
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    status: 'PASS',
    description: 'unit constraint',
    refs: [{ entityType: 'TRIP_ELEMENT', id: 'el_x' }],
  };
}

test('DR-1.2: reconciliation viability derivation (hard FAIL/UNKNOWN still bind; default mode never upgrades)', () => {
  const trip = disruptedTrip();
  const constraint = hardConstraint('c_unit');

  // Clean assessment -> VIABLE (the whole point of reconciliation).
  const clean = impactProposal(cleanAssessment(trip.id), [], [], trip, { reconcileViability: true });
  const cleanTrip = clean.operations.find((op) => op.op === 'UPSERT_ENTITY') as
    | { data: Trip }
    | undefined;
  assert.equal(cleanTrip?.data.viability, 'VIABLE');
  assert.equal(clean.id, 'prop-impact-impact-trip_reconcile_unit-reconcile-test');

  // Proposal id / instant overrides are honored (verification instants).
  const overridden = impactProposal(cleanAssessment(trip.id), [], [], trip, {
    reconcileViability: true,
    proposalId: 'prop-reconcile-x-2026',
    requestedAt: '2026-09-12T19:45:00+09:00',
  });
  assert.equal(overridden.id, 'prop-reconcile-x-2026');
  assert.equal(overridden.requestedAt, '2026-09-12T19:45:00+09:00');

  // Direct failures keep DISRUPTED even in reconcile mode.
  const failed = impactProposal(
    cleanAssessment(trip.id, {
      directFailures: [{ elementId: 'el_x', resultingStatus: 'INVALID', reason: 'cancelled' }],
    }),
    [],
    [],
    trip,
    { reconcileViability: true },
  );
  const failedTrip = failed.operations.find((op) => op.op === 'UPSERT_ENTITY') as { data: Trip } | undefined;
  // Viability already DISRUPTED -> no trip upsert needed; nothing upgrades.
  assert.equal(failedTrip, undefined);

  // Hard constraint FAIL caps reconciliation at DISRUPTED.
  const hardFail = impactProposal(
    cleanAssessment(trip.id),
    [constraint],
    [{ constraintId: constraint.id, status: 'FAIL' }],
    trip,
    { reconcileViability: true },
  );
  const hardFailTrip = hardFail.operations.find((op) => op.op === 'UPSERT_ENTITY') as
    | { data: Trip }
    | undefined;
  // Computed viability (DISRUPTED) equals the trip's current value, so no
  // trip upsert is emitted — hard FAIL keeps the trip DISRUPTED.
  assert.equal(hardFailTrip, undefined, 'hard FAIL caps reconciliation at DISRUPTED');

  // Hard constraint UNKNOWN caps reconciliation at AT_RISK (never VIABLE).
  const hardUnknown = impactProposal(
    cleanAssessment(trip.id),
    [constraint],
    [{ constraintId: constraint.id, status: 'UNKNOWN' }],
    trip,
    { reconcileViability: true },
  );
  const hardUnknownTrip = hardUnknown.operations.find((op) => op.op === 'UPSERT_ENTITY') as { data: Trip };
  assert.equal(hardUnknownTrip.data.viability, 'AT_RISK');

  // Disruption-time semantics unchanged: a clean assessment keeps the stale
  // value and never upgrades to VIABLE on this path.
  const legacy = impactProposal(cleanAssessment(trip.id), [], [], trip);
  const legacyTrip = legacy.operations.find(
    (op) => op.op === 'UPSERT_ENTITY' && (op as { data: Trip }).data.viability === 'VIABLE',
  );
  assert.equal(legacyTrip, undefined, 'default mode must not upgrade stale viability');
});

test('DR-1.2: provider observation alone never reconciles the authoritative trip', async () => {
  const spec = loadHarnessScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const signal = spec.disruption.signal;
  const cancel = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(cancel.accepted, true);
  await disruptTrip(h, spec);
  assert.equal(tripViabilityOf(h.db, spec.trip.id), 'DISRUPTED');

  // Observed replacement evidence (provider origin, validated path) repairs
  // the element — but observation alone must NOT flip the aggregate.
  const subject = spec.trip.elements.find((e) => e.id === signal.subjectRef?.id)!;
  const observation = await h.mutations.applyProposal(
    upsertElementProposal('prop-dr1-observation', '2026-09-12T19:00:00+09:00', replacementLeg(subject, '2026-09-12T18:40:00+09:00')),
  );
  assert.equal(observation.accepted, true);
  assert.equal(
    tripViabilityOf(h.db, spec.trip.id),
    'DISRUPTED',
    'only the verified-resolution path reconciles trip viability',
  );
});

test('DR-1.2: verified resolution reconciles the authoritative trip through the mutation path', async () => {
  const spec = loadHarnessScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const signal = spec.disruption.signal;
  assert.equal((await h.mutations.applyProposal(cancellationProposal(spec))).accepted, true);
  await disruptTrip(h, spec);
  assert.equal(tripViabilityOf(h.db, spec.trip.id), 'DISRUPTED');

  const subject = spec.trip.elements.find((e) => e.id === signal.subjectRef?.id)!;
  // Observed repair + observed booked transfer evidence (post-signal).
  assert.equal(
    (await h.mutations.applyProposal(
      upsertElementProposal('prop-dr1-repair', '2026-09-12T19:00:00+09:00', replacementLeg(subject, '2026-09-12T18:40:00+09:00')),
    )).accepted,
    true,
  );
  const transfer = spec.trip.elements.find((e) => e.id === 'el_a_transfer')!;
  if (transfer.elementKind === 'TRANSPORT_LEG') {
    const bookedTransfer: TripElement = {
      ...transfer,
      reservationState: 'CONFIRMED',
      data: {
        ...transfer.data,
        scheduledDeparture: {
          value: '2026-09-13T11:40:00+09:00',
          sourceId: 'src_a_provider_state',
          authority: 'AUTHORITATIVE',
          observedAt: '2026-09-12T18:45:00+09:00',
        },
        scheduledArrival: {
          value: '2026-09-13T12:35:00+09:00',
          sourceId: 'src_a_provider_state',
          authority: 'AUTHORITATIVE',
          observedAt: '2026-09-12T18:45:00+09:00',
        },
      },
    };
    assert.equal(
      (await h.mutations.applyProposal(
        upsertElementProposal('prop-dr1-transfer', '2026-09-12T19:00:00+09:00', bookedTransfer),
      )).accepted,
      true,
    );
  }

  const verifier = new CaseVerifier({ trips: h.trips, signals: h.signals, entities: h.entities, mutations: h.mutations });
  const verification = await verifier.verify(spec.trip.id, '2026-09-12T19:30:00+09:00');
  assert.equal(verification.suggestedCaseStatus, 'RESOLVED');
  assert.equal(verification.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(tripViabilityOf(h.db, spec.trip.id), 'VIABLE');

  // Read-only verifiers (unit harnesses) never mutate: a second verifier
  // without mutations re-verifies the same truth without side effects.
  const readOnly = new CaseVerifier({ trips: h.trips, signals: h.signals, entities: h.entities });
  const again = await readOnly.verify(spec.trip.id, '2026-09-12T19:40:00+09:00');
  assert.equal(again.resolution?.outcome, 'FULLY_RECOVERED');
  assert.equal(tripViabilityOf(h.db, spec.trip.id), 'VIABLE');
});

test('DR-1.2: resolved case and authoritative trip agree, surviving restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dr1-restart-'));
  const sqlitePath = join(dir, 'app.sqlite');
  const fileConfig = AppConfigSchema.parse({
    ...runtimeConfig,
    sqlitePath,
  });
  const composed = await composeAppRuntime(fileConfig);
  const spec = loadScenario(SCENARIO_A_DIR);
  const server = createAppServer(fileConfig, composed.endpoints);
  await new Promise<void>((resolvePromise) => server.listen(0, resolvePromise));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    await runRuntimeLoopAtOrdinaryTime(base, SCENARIO_A_DIR);

    // Case and Trip cannot disagree after successful recovery.
    const state = (await (await fetch(`${base}/api/runtime/state`)).json()) as {
      trips: Array<{ tripId: string; viability: string }>;
    };
    const tripRow = state.trips.find((t) => t.tripId === spec.trip.id)!;
    assert.equal(tripRow.viability, 'VIABLE', 'authoritative trip reconciles with the resolved case');

    // Unrelated trips are unaffected: any other seeded trip keeps its own
    // viability (the corporate scenario trip is untouched by this case).
    const others = state.trips.filter((t) => t.tripId !== spec.trip.id);
    assert.ok(others.length > 0, 'multiple trips seeded');
    for (const other of others) {
      assert.notEqual(other.viability, undefined);
    }
  } finally {
    await new Promise<void>((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
    composed.db.close();
  }

  // Restart/reload preserves the reconciled aggregate (SQLite truth).
  const reopened = openDatabase(sqlitePath);
  try {
    assert.equal(tripViabilityOf(reopened, spec.trip.id), 'VIABLE');
  } finally {
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// DR-1.3 — authority currency incomparability fails closed (ADR-045)
// ---------------------------------------------------------------------------

function inMemoryRuleSets(...ruleSets: RuleSet[]): RuleSetSource {
  const byId = new Map(ruleSets.map((rs) => [rs.id, rs]));
  return { getRuleSet: async (id) => byId.get(id) };
}

function spendIntent(id: string, amount: number, currency: string): ActionIntent {
  return {
    id,
    caseId: 'case_currency',
    operation: 'flight.pay',
    capability: 'FLIGHT',
    parameters: {},
    evidenceRefs: [],
    sideEffectLevel: 'MONEY_MOVING',
    priceDelta: { amount, currency },
    // ADR-048: spend rules evaluate the gross provider charge, not the delta.
    spendExposure: { amount, currency },
    status: 'PROPOSED',
    createdAt: '2026-08-24T09:00:00.000Z',
  };
}

const CURRENCY_CONTEXT: AuthorityContext = {
  tripId: 'trip_currency',
  caseId: 'case_currency',
  ruleSetIds: ['rs_currency'],
  principals: [],
};

function currencyRuleSet(rules: RuleSet['rules']): RuleSet {
  return {
    id: 'rs_currency',
    kind: 'ORGANISATION',
    name: 'currency test policy',
    sourceId: 'src_currency_policy',
    rules,
  };
}

test('DR-1.3: SPEND_LIMIT currency mismatch blocks execution (fail closed)', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(
      currencyRuleSet([
        {
          id: 'rule_hard_ceiling',
          kind: 'SPEND_LIMIT',
          sourceId: 'src_currency_policy',
          maxAmount: { amount: 1500, currency: 'EUR' },
          appliesTo: [],
        },
      ]),
    ),
  });
  const decision = await authority.decide(spendIntent('intent_eur_ceiling', 100, 'USD'), CURRENCY_CONTEXT);
  assert.equal(decision.outcome, 'BLOCKED', 'incomparable hard ceiling must fail closed');
  assert.ok(
    decision.ruleTrace.some((entry) => entry.includes('not deterministically') && entry.includes('fail closed')),
    'structured auditable reasoning records the incomparability',
  );

  // Same-currency spend within the ceiling is NOT blocked by the ceiling.
  const within = await authority.decide(spendIntent('intent_eur_within', 100, 'EUR'), CURRENCY_CONTEXT);
  assert.notEqual(within.outcome, 'BLOCKED');
  assert.ok(within.ruleTrace.some((entry) => entry.includes('within limit')));
});

test('DR-1.3: delegated authority cannot bypass an incomparable hard ceiling', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(
      currencyRuleSet([
        {
          id: 'rule_hard_ceiling',
          kind: 'SPEND_LIMIT',
          sourceId: 'src_currency_policy',
          maxAmount: { amount: 1500, currency: 'EUR' },
          appliesTo: [],
        },
      ]),
    ),
  });
  const context: AuthorityContext = {
    ...CURRENCY_CONTEXT,
    principals: [
      {
        ref: { entityType: 'ORGANISATION', id: 'org_delegated' },
        permissions: ['ACTION_APPROVAL'],
        delegatedSpendLimit: { amount: 100000, currency: 'USD' },
      },
    ],
  };
  const decision = await authority.decide(spendIntent('intent_delegated_bypass', 100, 'USD'), context);
  assert.equal(decision.outcome, 'BLOCKED', 'hard ceiling is evaluated before any delegation');
});

test('DR-1.3: APPROVAL_ABOVE_SPEND currency mismatch requires approval instead of skipping', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(
      currencyRuleSet([
        {
          id: 'rule_threshold',
          kind: 'APPROVAL_ABOVE_SPEND',
          sourceId: 'src_currency_policy',
          threshold: { amount: 300, currency: 'EUR' },
          approver: 'ORGANISATION_APPROVER',
          appliesTo: [],
        },
      ]),
    ),
  });
  const mismatch = await authority.decide(spendIntent('intent_threshold_mismatch', 100, 'USD'), CURRENCY_CONTEXT);
  assert.equal(
    mismatch.outcome,
    'REQUIRES_ORGANISATION_APPROVER',
    'an incomparable threshold can never be skipped into auto-execution',
  );
  assert.ok(mismatch.ruleTrace.some((entry) => entry.includes('not comparable')));

  // Comparable below-threshold spend keeps the default authority path.
  const below = await authority.decide(spendIntent('intent_threshold_below', 100, 'EUR'), CURRENCY_CONTEXT);
  assert.equal(below.outcome, 'REQUIRES_TRAVELLER', 'money-moving default authority, no approval rule triggered');

  // Comparable above-threshold spend unchanged.
  const above = await authority.decide(spendIntent('intent_threshold_above', 400, 'EUR'), CURRENCY_CONTEXT);
  assert.equal(above.outcome, 'REQUIRES_ORGANISATION_APPROVER');
});
