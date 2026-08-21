/**
 * A4 evidence — RecoveryCase lifecycle, deterministic authority, the
 * AuthorisedExecution gate, and the observation loop (T-AUTH + case
 * transition tests). Provider success alone never resolves a case;
 * intent.status alone is never executable evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CaseService, IllegalCaseTransitionError } from '../src/engine/case.ts';
import {
  DeterministicAuthorityEngine,
  ruleSetSource,
  withApproval,
  ACTION_APPROVAL_PERMISSION,
} from '../src/engine/authority.ts';
import { BoundaryExecutor } from '../src/engine/executor.ts';
import { DeterministicObservationService, CaseVerifier } from '../src/engine/observation.ts';
import {
  loadScenario,
  scenarioHarness,
  seedScenario,
  cancellationProposal,
  SCENARIO_A_PATH,
  SCENARIO_B_PATH,
} from './a2-harness.ts';
import type { ActionIntent, AuthorityDecision, AuthorisedExecution, ExecutionResult } from '../src/operational/intent.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';

type Harness = ReturnType<typeof scenarioHarness>;

function services(h: Harness) {
  const caseService = new CaseService({ cases: h.cases });
  const authority = new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(h.entities) });
  const executor = new BoundaryExecutor();
  const observation = new DeterministicObservationService({ mutations: h.mutations });
  const verifier = new CaseVerifier({ trips: h.trips, signals: h.signals, entities: h.entities });
  return { caseService, authority, executor, observation, verifier };
}

function intent(over: Partial<ActionIntent> & { id: string; caseId: string }): ActionIntent {
  return {
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: {},
    sideEffectLevel: 'MONEY_MOVING',
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: '2026-09-12T18:05:00+09:00',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Case lifecycle
// ---------------------------------------------------------------------------

test('case lifecycle follows the frozen transition table only', async () => {
  const h = scenarioHarness();
  const { caseService } = services(h);
  const opened = await caseService.open({ id: 'case_t1', tripId: 'trip_t', openedAt: '2026-09-01T00:00:00+00:00' });
  assert.equal(opened.status, 'DETECTED');
  assert.equal(opened.version, 0);

  await assert.rejects(
    caseService.transition('case_t1', 'EXECUTING', '2026-09-01T00:01:00+00:00'),
    IllegalCaseTransitionError,
  );
  await assert.rejects(
    caseService.transition('case_t1', 'RESOLVED', '2026-09-01T00:01:00+00:00'),
    IllegalCaseTransitionError,
  );

  const assessing = await caseService.transition('case_t1', 'ASSESSING', '2026-09-01T00:02:00+00:00');
  assert.equal(assessing.status, 'ASSESSING');
  assert.equal(assessing.version, 1);
  const planning = await caseService.transition('case_t1', 'PLANNING', '2026-09-01T00:03:00+00:00');
  assert.equal(planning.status, 'PLANNING');

  // Resolution without a CaseResolution payload is refused even where the
  // transition itself is legal (ESCALATED -> RESOLVED).
  await caseService.transition('case_t1', 'ESCALATED', '2026-09-01T00:03:30+00:00');
  await assert.rejects(
    caseService.transition('case_t1', 'RESOLVED', '2026-09-01T00:04:00+00:00'),
    /CaseResolution/,
  );
});

test('VERIFYING loops back into the lifecycle; RESOLVED is terminal', async () => {
  const h = scenarioHarness();
  const { caseService } = services(h);
  await caseService.open({ id: 'case_t2', tripId: 'trip_t', openedAt: '2026-09-01T00:00:00+00:00' });
  await caseService.transition('case_t2', 'ASSESSING', '2026-09-01T00:01:00+00:00');
  await caseService.transition('case_t2', 'PLANNING', '2026-09-01T00:02:00+00:00');
  await caseService.transition('case_t2', 'READY_TO_EXECUTE', '2026-09-01T00:03:00+00:00');
  await caseService.transition('case_t2', 'EXECUTING', '2026-09-01T00:04:00+00:00');
  const verifying = await caseService.transition('case_t2', 'VERIFYING', '2026-09-01T00:05:00+00:00');
  assert.equal(verifying.status, 'VERIFYING');

  const replan = await caseService.transition('case_t2', 'PLANNING', '2026-09-01T00:06:00+00:00');
  assert.equal(replan.status, 'PLANNING');

  await caseService.transition('case_t2', 'READY_TO_EXECUTE', '2026-09-01T00:07:00+00:00');
  await caseService.transition('case_t2', 'EXECUTING', '2026-09-01T00:08:00+00:00');
  await caseService.transition('case_t2', 'VERIFYING', '2026-09-01T00:09:00+00:00');
  const resolved = await caseService.transition('case_t2', 'RESOLVED', '2026-09-01T00:10:00+00:00', {
    resolution: { outcome: 'FULLY_RECOVERED', resolvedAt: '2026-09-01T00:10:00+00:00', remainingLossRefs: [] },
  });
  assert.equal(resolved.status, 'RESOLVED');
  await assert.rejects(
    caseService.transition('case_t2', 'ASSESSING', '2026-09-01T00:11:00+00:00'),
    IllegalCaseTransitionError,
  );
});

// ---------------------------------------------------------------------------
// Deterministic authority
// ---------------------------------------------------------------------------

test('authority: read-only auto-approves; reversible default auto-approves', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { authority } = services(h);
  const ctx = { tripId: spec.trip.id, caseId: 'case_x', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };

  const readOnly = await authority.decide(
    intent({ id: 'int_ro', caseId: 'case_x', operation: 'flight.search', sideEffectLevel: 'READ_ONLY' }),
    ctx,
  );
  assert.equal(readOnly.outcome, 'AUTO_APPROVED');

  const reversible = await authority.decide(
    intent({ id: 'int_rev', caseId: 'case_x', sideEffectLevel: 'REVERSIBLE' }),
    ctx,
  );
  assert.equal(reversible.outcome, 'AUTO_APPROVED');
});

test('authority: Scenario A money-moving change defaults to REQUIRES_TRAVELLER', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { authority } = services(h);
  const ctx = { tripId: spec.trip.id, caseId: 'case_x', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };

  const decision = await authority.decide(
    intent({ id: 'int_a', caseId: 'case_x', priceDelta: { amount: 150, currency: 'USD' } }),
    ctx,
  );
  assert.equal(decision.outcome, 'REQUIRES_TRAVELLER');
  assert.equal(decision.decidedAt, '2026-09-12T18:05:00+09:00');
  // Deterministic: same input, same decision.
  const again = await authority.decide(
    intent({ id: 'int_a', caseId: 'case_x', priceDelta: { amount: 150, currency: 'USD' } }),
    ctx,
  );
  assert.deepEqual(again, decision);
});

test('authority: spend above approval threshold routes to the rule approver', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { authority } = services(h);
  const ctx = { tripId: spec.trip.id, caseId: 'case_x', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };

  const decision = await authority.decide(
    intent({ id: 'int_a2', caseId: 'case_x', priceDelta: { amount: 500, currency: 'USD' } }),
    ctx,
  );
  assert.equal(decision.outcome, 'REQUIRES_ORGANISATION_APPROVER');
});

test('authority: breaching the hard spend limit blocks execution', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { authority } = services(h);
  const ctx = { tripId: spec.trip.id, caseId: 'case_x', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };

  const decision = await authority.decide(
    intent({ id: 'int_block', caseId: 'case_x', priceDelta: { amount: 2000, currency: 'USD' } }),
    ctx,
  );
  assert.equal(decision.outcome, 'BLOCKED');
});

test('authority: Scenario B operation-scoped approval requirement routes to the organisation', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { authority } = services(h);
  const ctx = { tripId: spec.trip.id, caseId: 'case_x', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };

  const change = await authority.decide(intent({ id: 'int_b1', caseId: 'case_x' }), ctx);
  assert.equal(change.outcome, 'REQUIRES_ORGANISATION_APPROVER');

  // An operation outside the rule's filter falls back to default authority.
  const notify = await authority.decide(
    intent({ id: 'int_b2', caseId: 'case_x', operation: 'communication.notify', sideEffectLevel: 'REVERSIBLE' }),
    ctx,
  );
  assert.equal(notify.outcome, 'AUTO_APPROVED');
});

test('authority: delegated spend authority satisfies the approval requirement deterministically', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { authority } = services(h);
  const ctx = {
    tripId: spec.trip.id,
    caseId: 'case_x',
    ruleSetIds: spec.context.ruleSets.map((r) => r.id),
    principals: [
      {
        ref: { entityType: 'ORGANISATION' as const, id: 'org_delegated' },
        permissions: [ACTION_APPROVAL_PERMISSION],
        delegatedSpendLimit: { amount: 1000, currency: 'USD' },
      },
    ],
  };

  const covered = await authority.decide(
    intent({ id: 'int_d1', caseId: 'case_x', priceDelta: { amount: 500, currency: 'USD' } }),
    ctx,
  );
  assert.equal(covered.outcome, 'AUTO_APPROVED');
  assert.ok(covered.ruleTrace.some((t) => t.includes('org_delegated')));

  // Same principal, spend beyond the delegated limit: approval still required.
  const uncovered = await authority.decide(
    intent({ id: 'int_d2', caseId: 'case_x', priceDelta: { amount: 1200, currency: 'USD' } }),
    ctx,
  );
  assert.equal(uncovered.outcome, 'REQUIRES_ORGANISATION_APPROVER');
  assert.ok(uncovered.ruleTrace.every((t) => !t.includes('delegated authority')));
});

// ---------------------------------------------------------------------------
// Execution gate (ADR-025 regression protection)
// ---------------------------------------------------------------------------

test('executor refuses without valid authority evidence even when intent.status is AUTHORISED', async () => {
  const h = scenarioHarness();
  const { executor } = services(h);
  const spoofed = intent({ id: 'int_spoof', caseId: 'case_x', status: 'AUTHORISED' });
  const unapproved: AuthorityDecision = {
    id: 'authority-int_spoof',
    intentId: 'int_spoof',
    outcome: 'REQUIRES_TRAVELLER',
    decidedAt: spoofed.createdAt,
    ruleTrace: [],
    conditions: [],
  };
  const result = await executor.execute({ intent: spoofed, authority: unapproved });
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'EXECUTION_REFUSED');
  assert.match(result.error?.message ?? '', /requires a recorded approval/);
});

test('executor refuses mismatched, blocked and declined authority evidence', async () => {
  const h = scenarioHarness();
  const { executor } = services(h);
  const theIntent = intent({ id: 'int_g', caseId: 'case_x' });

  const mismatched: AuthorisedExecution = {
    intent: theIntent,
    authority: { id: 'authority-other', intentId: 'int_other', outcome: 'AUTO_APPROVED', decidedAt: theIntent.createdAt, ruleTrace: [], conditions: [] },
  };
  const blocked: AuthorisedExecution = {
    intent: theIntent,
    authority: { id: 'authority-g1', intentId: 'int_g', outcome: 'BLOCKED', decidedAt: theIntent.createdAt, ruleTrace: [], conditions: [] },
  };
  const declined: AuthorisedExecution = {
    intent: theIntent,
    authority: {
      id: 'authority-g2',
      intentId: 'int_g',
      outcome: 'REQUIRES_ORGANISATION_APPROVER',
      decidedAt: theIntent.createdAt,
      ruleTrace: [],
      conditions: [],
      approval: {
        decidedAt: theIntent.createdAt,
        decidedBy: { entityType: 'ORGANISATION', id: 'org_x' },
        decision: 'DECLINED',
      },
    },
  };
  for (const execution of [mismatched, blocked, declined]) {
    const result = await executor.execute(execution);
    assert.equal(result.status, 'FAILURE');
    assert.equal(result.error?.code, 'EXECUTION_REFUSED');
  }
});

test('executor proceeds only with valid authority evidence', async () => {
  const h = scenarioHarness();
  const { executor } = services(h);
  const theIntent = intent({ id: 'int_ok', caseId: 'case_x' });
  const approved: AuthorisedExecution = {
    intent: theIntent,
    authority: {
      id: 'authority-ok',
      intentId: 'int_ok',
      outcome: 'REQUIRES_TRAVELLER',
      decidedAt: theIntent.createdAt,
      ruleTrace: ['default traveller authority'],
      conditions: [],
      approval: {
        decidedAt: theIntent.createdAt,
        decidedBy: { entityType: 'TRAVELLER', id: 'trv_x' },
        decision: 'APPROVED',
      },
    },
  };
  const result = await executor.execute(approved);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.provenance, 'SIMULATED');
  assert.equal(result.intentId, 'int_ok');
});

// ---------------------------------------------------------------------------
// Observation loop
// ---------------------------------------------------------------------------

function executionResult(over: Partial<ExecutionResult> & { id: string; intentId: string }): ExecutionResult {
  return {
    executedAt: '2026-09-12T18:20:00+09:00',
    status: 'SUCCESS',
    provenance: 'SIMULATED',
    ...over,
  };
}

test('observation maps successful execution evidence into validated mutation', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  await h.mutations.applyProposal(cancellationProposal(spec));
  const { observation } = services(h);

  const original = spec.trip.elements.find((e) => e.id === 'el_a_flight_out');
  assert.ok(original);
  const rebooked = {
    ...original,
    reservationState: 'CONFIRMED',
    status: 'VALID',
    data: {
      ...original.data,
      scheduledDeparture: { value: '2026-09-13T09:00:00+09:00', sourceId: 'src_obs', authority: 'AUTHORITATIVE', observedAt: '2026-09-12T18:20:00+09:00' },
      scheduledArrival: { value: '2026-09-13T11:30:00+09:00', sourceId: 'src_obs', authority: 'AUTHORITATIVE', observedAt: '2026-09-12T18:20:00+09:00' },
    },
  };
  const operations: MutationOperation[] = [
    { op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_a_flight_out', data: rebooked },
  ];
  const outcome = await observation.observe(
    executionResult({ id: 'exec_1', intentId: 'int_1', observedEffects: { operations } }),
  );
  assert.equal(outcome.stateUpdated, true);
  assert.equal(outcome.appliedOperationCount, 1);
  assert.equal(outcome.reevaluationRequested, true);
  assert.equal(outcome.suggestedCaseStatus, 'VERIFYING');

  const trip = await h.trips.getTrip(spec.trip.id);
  const flight = trip?.elements.find((e) => e.id === 'el_a_flight_out');
  assert.equal(flight?.reservationState, 'CONFIRMED');
});

test('observation never resolves a case on provider success alone', async () => {
  const h = scenarioHarness();
  const { observation } = services(h);
  const outcome = await observation.observe(
    executionResult({ id: 'exec_2', intentId: 'int_2', observedEffects: { operations: [] } }),
  );
  assert.notEqual(outcome.suggestedCaseStatus, 'RESOLVED');
});

test('observation fails safe on failed or malformed execution evidence', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { observation } = services(h);
  const before = await h.trips.getTrip(spec.trip.id);

  const failed = await observation.observe(
    executionResult({ id: 'exec_f', intentId: 'int_f', status: 'FAILURE', error: { code: 'PROVIDER_ERROR', message: 'no inventory' } }),
  );
  assert.equal(failed.stateUpdated, false);
  assert.equal(failed.suggestedCaseStatus, 'ASSESSING');

  const malformed = await observation.observe(
    executionResult({ id: 'exec_m', intentId: 'int_m', observedEffects: { operations: [{ op: 'NOT_AN_OP' }] } }),
  );
  assert.equal(malformed.stateUpdated, false);
  assert.equal(malformed.suggestedCaseStatus, 'ASSESSING');

  const after = await h.trips.getTrip(spec.trip.id);
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// End-to-end recovery loops through the frozen seams
// ---------------------------------------------------------------------------

test('Scenario A: detected -> ... -> verified FULLY_RECOVERED through authority + observation', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { caseService, authority, executor, observation, verifier } = services(h);
  const signal = spec.disruption.signal;
  const at = signal.receivedAt ?? signal.occurredAt;

  await h.mutations.applyProposal(cancellationProposal(spec));
  await caseService.open({
    id: 'case_a',
    tripId: spec.trip.id,
    openedAt: at,
    triggeredBySignalIds: [signal.id],
    affectedElementIds: ['el_a_flight_out'],
  });
  await caseService.transition('case_a', 'ASSESSING', at);
  await caseService.transition('case_a', 'PLANNING', at);

  const theIntent = intent({
    id: 'int_a_rebook',
    caseId: 'case_a',
    createdAt: at,
    priceDelta: { amount: 150, currency: 'USD' },
  });
  const ctx = { tripId: spec.trip.id, caseId: 'case_a', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };
  const decision = await authority.decide(theIntent, ctx);
  assert.equal(decision.outcome, spec.expectations.authority.expectedOutcome);

  await caseService.transition('case_a', 'READY_TO_EXECUTE', at, { actionIntents: [theIntent], authorityDecisions: [decision] });
  await caseService.transition('case_a', 'AWAITING_TRAVELLER', at);
  const approved = withApproval(decision, { entityType: 'TRAVELLER', id: 'trv_a_speaker' }, at, 'APPROVED');
  await caseService.transition('case_a', 'READY_TO_EXECUTE', at, { authorityDecisions: [approved] });
  await caseService.transition('case_a', 'EXECUTING', at);

  const result = await executor.execute({ intent: theIntent, authority: approved });
  assert.equal(result.status, 'SUCCESS');

  // Boundary simulation carries the recovery mutation as observed effects.
  const original = spec.trip.elements.find((e) => e.id === 'el_a_flight_out');
  assert.ok(original);
  const rebooked = {
    ...original,
    reservationState: 'CONFIRMED',
    status: 'VALID',
    data: {
      ...original.data,
      scheduledDeparture: { value: '2026-09-13T09:00:00+09:00', sourceId: signal.sourceId, authority: 'AUTHORITATIVE', observedAt: result.executedAt },
      scheduledArrival: { value: '2026-09-13T11:30:00+09:00', sourceId: signal.sourceId, authority: 'AUTHORITATIVE', observedAt: result.executedAt },
    },
  };
  const observed: ExecutionResult = {
    ...result,
    observedEffects: {
      ...result.observedEffects,
      operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_a_flight_out', data: rebooked }],
    },
  };
  const outcome = await observation.observe(observed);
  assert.equal(outcome.stateUpdated, true);
  await caseService.transition('case_a', 'VERIFYING', at, { executionResults: [observed] });

  // Provider success alone has NOT resolved the case.
  const midCase = await caseService.get('case_a');
  assert.equal(midCase?.status, 'VERIFYING');
  assert.equal(midCase?.resolution, undefined);

  const verification = await verifier.verify(spec.trip.id);
  assert.equal(verification.suggestedCaseStatus, 'RESOLVED');
  assert.equal(verification.resolution?.outcome, spec.expectations.recovery.expectedResolution);
  const resolved = await caseService.transition('case_a', 'RESOLVED', at, { resolution: verification.resolution });
  assert.equal(resolved.resolution?.outcome, 'FULLY_RECOVERED');
});

test('Scenario B: organisation approval + waived objective resolve RECOVERED_WITH_LOSS', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const { caseService, authority, executor, observation, verifier } = services(h);
  const signal = spec.disruption.signal;
  const at = signal.receivedAt ?? signal.occurredAt;

  await h.mutations.applyProposal(cancellationProposal(spec));
  await caseService.open({
    id: 'case_b',
    tripId: spec.trip.id,
    openedAt: at,
    triggeredBySignalIds: [signal.id],
    affectedElementIds: ['el_b_flight_back'],
  });
  await caseService.transition('case_b', 'ASSESSING', at);
  await caseService.transition('case_b', 'PLANNING', at);

  const theIntent = intent({ id: 'int_b_rebook', caseId: 'case_b', createdAt: at });
  const ctx = { tripId: spec.trip.id, caseId: 'case_b', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };
  const decision = await authority.decide(theIntent, ctx);
  assert.equal(decision.outcome, spec.expectations.authority.expectedOutcome);

  await caseService.transition('case_b', 'READY_TO_EXECUTE', at, { actionIntents: [theIntent], authorityDecisions: [decision] });
  await caseService.transition('case_b', 'AWAITING_APPROVAL', at);
  const approver = { entityType: 'ORGANISATION' as const, id: spec.context.organisations[0]?.id ?? 'org_b' };
  const approved = withApproval(decision, approver, at, 'APPROVED');
  await caseService.transition('case_b', 'READY_TO_EXECUTE', at, { authorityDecisions: [approved] });
  await caseService.transition('case_b', 'EXECUTING', at);

  const result = await executor.execute({ intent: theIntent, authority: approved });
  assert.equal(result.status, 'SUCCESS');

  // Rebook the return leg onto a later service — the original morning
  // commitment can no longer be met.
  const original = spec.trip.elements.find((e) => e.id === 'el_b_flight_back');
  assert.ok(original);
  const rebooked = {
    ...original,
    reservationState: 'CONFIRMED',
    status: 'VALID',
    data: {
      ...original.data,
      scheduledDeparture: { value: '2026-09-22T09:00:00-06:00', sourceId: signal.sourceId, authority: 'AUTHORITATIVE', observedAt: result.executedAt },
      scheduledArrival: { value: '2026-09-22T10:25:00-06:00', sourceId: signal.sourceId, authority: 'AUTHORITATIVE', observedAt: result.executedAt },
    },
  };
  const traveller = spec.context.travellers[0];
  assert.ok(traveller);
  const observed: ExecutionResult = {
    ...result,
    observedEffects: {
      ...result.observedEffects,
      operations: [
        { op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_b_flight_back', data: rebooked },
        {
          op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE',
          objectiveId: 'obj_b_return',
          action: 'WAIVE',
          by: { entityType: 'TRAVELLER', id: traveller.id },
          reason: 'original return commitment is no longer reachable',
        },
      ],
    },
  };
  const outcome = await observation.observe(observed);
  assert.equal(outcome.stateUpdated, true);
  await caseService.transition('case_b', 'VERIFYING', at, { executionResults: [observed] });

  const verification = await verifier.verify(spec.trip.id);
  assert.equal(verification.suggestedCaseStatus, 'RESOLVED');
  assert.equal(verification.resolution?.outcome, spec.expectations.recovery.expectedResolution);
  assert.deepEqual(verification.remainingLossRefs, spec.expectations.recovery.remainingLossObjectiveIds);
  const resolved = await caseService.transition('case_b', 'RESOLVED', at, { resolution: verification.resolution });
  assert.equal(resolved.resolution?.outcome, 'RECOVERED_WITH_LOSS');
});
