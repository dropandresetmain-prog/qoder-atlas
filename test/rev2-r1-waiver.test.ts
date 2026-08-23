/**
 * REV-2 WP-R1 — Judging-criteria integrity: a candidate must not waive the
 * objective that judges it.
 *
 * These tests fail on candidate 91648aa (base head 3009706) and pass after the
 * fix. They pin the three seams of the WP-R1 chain:
 *
 *  1. Overlay viability: an objective already present in the base snapshot is
 *     part of the evaluation basis exactly as constraints and rule sets are, so
 *     a candidate WAIVE_OR_REPRIORITIZE_OBJECTIVE targeting it is rejected with
 *     the same deterministic evidence style as the constraint/rule-set guard.
 *  2. Action-intent classification: a strategy carrying a waiver is a
 *     consequential act on the traveller's trip and must reach an
 *     approval-requiring authority outcome — never REVERSIBLE / AUTO_APPROVED.
 *  3. Observation provenance: a waiver may enter the observation mutation only
 *     when it originates from an APPROVED authority decision, never from a
 *     planner-authored candidate that was never approved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import { DeterministicAuthorityEngine, ruleSetSource } from '../src/engine/authority.ts';
import {
  buildActionIntent,
  consequentialOperationFor,
  confirmedOperationsFor,
} from '../src/app/recoveryExecution.ts';
import {
  loadScenario,
  scenarioHarness,
  seedScenario,
  snapshotOf,
  cancellationProposal,
  SCENARIO_B_PATH,
} from './a2-harness.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { AuthorityDecision } from '../src/operational/intent.ts';
import type { TripElement } from '../src/domain/elements.ts';

const engine = new OverlayViabilityEngine();
const AT = '2026-09-21T17:00:00-06:00';

/** Rebook the cancelled Scenario B return leg onto a bookable-but-late service. */
function lateReturnReplacement(spec: ReturnType<typeof loadScenario>, observedAt: string): TripElement {
  const original = spec.trip.elements.find((e) => e.id === 'el_b_flight_back');
  assert.ok(original && original.elementKind === 'TRANSPORT_LEG');
  const leg = original as Extract<TripElement, { elementKind: 'TRANSPORT_LEG' }>;
  return {
    ...leg,
    reservationState: 'HELD',
    status: 'UNKNOWN',
    data: {
      ...leg.data,
      // Next-morning service: bookable, but cannot meet the 08:30 steering deadline.
      scheduledDeparture: {
        value: '2026-09-22T09:00:00-06:00',
        sourceId: 'src_b_provider_state',
        authority: 'CONNECTED',
        observedAt,
      },
      scheduledArrival: {
        value: '2026-09-22T10:25:00-06:00',
        sourceId: 'src_b_provider_state',
        authority: 'CONNECTED',
        observedAt,
      },
      bookingRef: { system: 'provider-flight-sandbox', reference: 'FL-B-LATE' },
    },
  };
}

function waiveReturn(spec: ReturnType<typeof loadScenario>): MutationOperation {
  const traveller = spec.context.travellers[0];
  assert.ok(traveller);
  return {
    op: 'WAIVE_OR_REPRIORITIZE_OBJECTIVE',
    objectiveId: 'obj_b_return',
    action: 'WAIVE',
    by: { entityType: 'TRAVELLER', id: traveller.id },
    reason: 'return deadline is unreachable',
  };
}

async function disruptedScenarioB() {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const apply = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(apply.accepted, true);
  const takenAt = spec.disruption.signal.receivedAt ?? spec.disruption.signal.occurredAt;
  const snapshot = await snapshotOf(h, spec.trip.id, takenAt);
  return { spec, h, snapshot, takenAt };
}

test('WP-R1 overlay: control replacement stays hard-UNKNOWN; adding a waiver of the judging objective is rejected', async () => {
  const { spec, snapshot, takenAt } = await disruptedScenarioB();
  const replacement: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_b_flight_back',
    data: lateReturnReplacement(spec, takenAt),
  };

  // Control: bookable-but-late replacement alone cannot resolve the deadline
  // objective — the return-buffer constraint stays hard UNKNOWN (never PASS).
  const control = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [replacement] });
  assert.equal(control.feasible, false);
  assert.ok(control.unknownIds.includes('c_b_return_buffer'), JSON.stringify(control.unknownIds));

  // The same candidate plus a waiver of the very objective that judges it must
  // NOT flip feasibility. Objectives are part of the evaluation basis exactly
  // like constraints and rule sets: the overlay rejects the waiver candidate.
  await assert.rejects(
    engine.evaluateOverlay({
      baseSnapshot: snapshot,
      candidateOperations: [replacement, waiveReturn(spec)],
    }),
    /overlay candidate rejected: candidate mutates judging criteria: objective obj_b_return/,
  );
});

function strategy(over: Partial<RecoveryStrategy> & { id: string; candidateOperations: MutationOperation[] }): RecoveryStrategy {
  return {
    caseId: 'case_r1',
    summary: 'waive the return objective',
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    createdAt: AT,
    ...over,
  };
}

test('WP-R1 intent: a waive-only strategy is consequential and never auto-approved', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const authority = new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(h.entities) });

  const waiveOnly = strategy({ id: 'strat_r1_waive_only', candidateOperations: [waiveReturn(spec)] });

  // Classification must not collapse a waiver to REVERSIBLE / SIMULATION.
  const classified = consequentialOperationFor(waiveOnly.candidateOperations);
  assert.notEqual(classified.sideEffectLevel, 'REVERSIBLE', 'a waiver is not a reversible no-op');

  const intent = buildActionIntent({ id: 'intent_r1', caseId: 'case_r1', strategy: waiveOnly, at: AT });
  assert.notEqual(intent.sideEffectLevel, 'REVERSIBLE');
  const ctx = { tripId: spec.trip.id, caseId: 'case_r1', ruleSetIds: [], principals: [] };
  const decision = await authority.decide(intent, ctx);
  assert.notEqual(decision.outcome, 'AUTO_APPROVED', 'waiving a traveller objective must reach an approval-requiring outcome');
});

test('WP-R1 intent: a waiver riding with a flight rebook still requires approval', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const authority = new DeterministicAuthorityEngine({ ruleSets: ruleSetSource(h.entities) });
  const takenAt = spec.disruption.signal.receivedAt ?? spec.disruption.signal.occurredAt;

  const combined = strategy({
    id: 'strat_r1_combined',
    candidateOperations: [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        id: 'el_b_flight_back',
        data: lateReturnReplacement(spec, takenAt),
      },
      waiveReturn(spec),
    ],
  });
  const intent = buildActionIntent({ id: 'intent_r1_combined', caseId: 'case_r1', strategy: combined, at: AT });
  const ctx = { tripId: spec.trip.id, caseId: 'case_r1', ruleSetIds: spec.context.ruleSets.map((r) => r.id), principals: [] };
  const decision = await authority.decide(intent, ctx);
  assert.notEqual(decision.outcome, 'AUTO_APPROVED', 'a waiver-bearing rebook must never be auto-approved');
});

function approvedAuthority(intentId: string): AuthorityDecision {
  return {
    id: `authority-${intentId}`,
    intentId,
    outcome: 'REQUIRES_TRAVELLER',
    decidedAt: AT,
    ruleTrace: [],
    conditions: [],
    approval: { decidedAt: AT, decidedBy: { entityType: 'TRAVELLER', id: 'trv_b_consultant' }, decision: 'APPROVED' },
  };
}

function autoApprovedAuthority(intentId: string): AuthorityDecision {
  return {
    id: `authority-${intentId}`,
    intentId,
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: [],
    conditions: [],
  };
}

test('WP-R1 observation: a waiver is admitted only when backed by an approved authority decision', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const waiver = waiveReturn(spec);
  const confirmedAt = '2026-09-21T17:30:00-06:00';

  // No authority evidence: a planner-authored waiver never reaches observation.
  const unbacked = confirmedOperationsFor([waiver], confirmedAt);
  assert.equal(unbacked.filter((op) => op.op === 'WAIVE_OR_REPRIORITIZE_OBJECTIVE').length, 0);

  // AUTO_APPROVED is not an explicit approval: a waiver can never ride on it.
  const autoBacked = confirmedOperationsFor([waiver], confirmedAt, autoApprovedAuthority('intent_r1_auto'));
  assert.equal(autoBacked.filter((op) => op.op === 'WAIVE_OR_REPRIORITIZE_OBJECTIVE').length, 0);

  // An APPROVED authority decision is the provenance that admits the waiver.
  const approvedBacked = confirmedOperationsFor([waiver], confirmedAt, approvedAuthority('intent_r1_ok'));
  assert.equal(approvedBacked.filter((op) => op.op === 'WAIVE_OR_REPRIORITIZE_OBJECTIVE').length, 1);
});
