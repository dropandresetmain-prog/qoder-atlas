/**
 * A3 evidence — scenario overlays and deterministic viability (T-OVERLAY).
 * Overlays never mutate the authoritative Trip or the caller's snapshot;
 * candidates evaluate independently and deterministically; hard failures are
 * explicit; UNKNOWN never becomes PASS; soft trade-offs stay rankable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { OverlayViabilityEngine } from '../src/engine/overlay.ts';
import {
  loadScenario,
  scenarioHarness,
  seedScenario,
  snapshotOf,
  cancellationProposal,
  SCENARIO_A_PATH,
} from './a2-harness.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { TripElement } from '../src/domain/elements.ts';

const engine = new OverlayViabilityEngine();

/** Rebook the disrupted Scenario A outbound leg onto an alternative service. */
function rebookedFlight(spec: ReturnType<typeof loadScenario>, arrival: string, observedAt: string): TripElement {
  const original = spec.trip.elements.find((e) => e.id === 'el_a_flight_out');
  assert.ok(original);
  assert.equal(original.elementKind, 'TRANSPORT_LEG');
  const leg = original as Extract<TripElement, { elementKind: 'TRANSPORT_LEG' }>;
  return {
    ...leg,
    reservationState: 'CONFIRMED',
    status: 'VALID',
    data: {
      ...leg.data,
      scheduledDeparture: {
        value: '2026-09-13T09:00:00+09:00',
        sourceId: 'src_overlay_provider',
        authority: 'AUTHORITATIVE',
        observedAt,
      },
      scheduledArrival: {
        value: arrival,
        sourceId: 'src_overlay_provider',
        authority: 'AUTHORITATIVE',
        observedAt,
      },
    },
  };
}

async function disruptedScenarioA() {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const apply = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(apply.accepted, true);
  const takenAt = spec.disruption.signal.receivedAt ?? spec.disruption.signal.occurredAt;
  const snapshot = await snapshotOf(h, spec.trip.id, takenAt);
  return { spec, h, snapshot, takenAt };
}

test('baseline post-disruption overlay is NOT safely executable (hard FAIL + hard UNKNOWN)', async () => {
  const { snapshot } = await disruptedScenarioA();
  const result = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [] });
  assert.equal(result.feasible, false);
  assert.ok(result.hardFailureIds.includes('c_a_arrive_before_keynote'));
  // Lost arrival-chain evidence must stay UNKNOWN, never PASS.
  assert.ok(result.unknownIds.includes('c_a_hotel_no_show'));
  // The soft transfer constraint is not executable either — surfaced as a
  // rankable trade-off, still UNKNOWN.
  assert.ok(result.softTradeoffs.some((t) => t.includes('c_a_transfer_feasible') && t.includes('UNKNOWN')));
});

test('overlay application never mutates the authoritative trip or the caller snapshot', async () => {
  const { spec, h, snapshot, takenAt } = await disruptedScenarioA();
  const before = structuredClone(snapshot);
  const candidate: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: rebookedFlight(spec, '2026-09-13T11:30:00+09:00', takenAt),
  };
  await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [candidate] });
  // Caller's snapshot object is untouched.
  assert.deepEqual(snapshot, before);
  // Authoritative persisted trip is untouched: still cancelled, same version.
  const trip = await h.trips.getTrip(spec.trip.id);
  assert.ok(trip);
  const flight = trip.elements.find((e) => e.id === 'el_a_flight_out');
  assert.equal(flight?.reservationState, 'CANCELLED');
  assert.equal(trip.version, snapshot.tripVersion);
});

test('a viable rebooking candidate makes the overlay feasible with all hard constraints passing', async () => {
  const { spec, snapshot, takenAt } = await disruptedScenarioA();
  const candidate: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: rebookedFlight(spec, '2026-09-13T11:30:00+09:00', takenAt),
  };
  const result = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [candidate] });
  assert.equal(result.feasible, true, JSON.stringify({ hard: result.hardFailureIds, unknown: result.unknownIds }));
  assert.deepEqual(result.hardFailureIds, []);
  assert.deepEqual(result.unknownIds, []);
  const byId = new Map(result.constraintResults.map((r) => [r.constraintId, r.status]));
  assert.equal(byId.get('c_a_arrive_before_keynote'), 'PASS');
  assert.equal(byId.get('c_a_transfer_feasible'), 'PASS');
  assert.equal(byId.get('c_a_hotel_no_show'), 'PASS');
});

test('a candidate arriving too late is explicitly hard-infeasible', async () => {
  const { spec, snapshot, takenAt } = await disruptedScenarioA();
  const candidate: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: rebookedFlight(spec, '2026-09-14T09:30:00+09:00', takenAt),
  };
  const result = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [candidate] });
  assert.equal(result.feasible, false);
  assert.ok(result.hardFailureIds.includes('c_a_arrive_before_keynote'));
});

test('a candidate lacking arrival evidence stays UNKNOWN and therefore not executable', async () => {
  const { spec, snapshot, takenAt } = await disruptedScenarioA();
  const partial = rebookedFlight(spec, '2026-09-13T11:30:00+09:00', takenAt);
  if (partial.elementKind === 'TRANSPORT_LEG') {
    delete (partial.data as { scheduledArrival?: unknown }).scheduledArrival;
    delete (partial.data as { durationEstimate?: unknown }).durationEstimate;
  }
  const candidate: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: partial,
  };
  const result = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [candidate] });
  assert.equal(result.feasible, false);
  assert.ok(result.unknownIds.includes('c_a_arrive_before_keynote'));
  assert.deepEqual(result.hardFailureIds, []);
});

test('overlay evaluation is deterministic and candidates evaluate independently', async () => {
  const { spec, snapshot, takenAt } = await disruptedScenarioA();
  const viable: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: rebookedFlight(spec, '2026-09-13T11:30:00+09:00', takenAt),
  };
  const late: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: rebookedFlight(spec, '2026-09-14T09:30:00+09:00', takenAt),
  };
  const first = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [viable] });
  const second = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [late] });
  const firstAgain = await engine.evaluateOverlay({ baseSnapshot: snapshot, candidateOperations: [viable] });
  assert.deepEqual(firstAgain, first);
  assert.equal(first.feasible, true);
  assert.equal(second.feasible, false);
});

test('soft trade-offs stay rankable and never block feasibility', async () => {
  const { spec, snapshot, takenAt } = await disruptedScenarioA();
  const softSpend = loadScenario(SCENARIO_A_PATH).constraints; // sanity: fixture constraints unchanged
  assert.ok(Array.isArray(softSpend));
  const candidateFlight: MutationOperation = {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_a_flight_out',
    data: rebookedFlight(spec, '2026-09-13T11:30:00+09:00', takenAt),
  };
  const candidateSpendConstraint: MutationOperation = {
    op: 'UPSERT_CONSTRAINT',
    constraint: {
      id: 'c_overlay_recovery_spend',
      kind: 'FINANCIAL',
      hardness: 'SOFT',
      evaluator: 'DETERMINISTIC',
      status: 'UNKNOWN',
      refs: [],
      ruleSetId: 'rs_a_organiser_policy',
      derivedFromRuleId: 'rule_a_spend_limit',
      parameters: { amount: 1800, currency: 'USD' },
    },
  };
  const result = await engine.evaluateOverlay({
    baseSnapshot: snapshot,
    candidateOperations: [candidateFlight, candidateSpendConstraint],
  });
  assert.equal(result.feasible, true, JSON.stringify({ hard: result.hardFailureIds, unknown: result.unknownIds }));
  assert.equal(result.softTradeoffs.length, 1);
  assert.match(result.softTradeoffs[0] ?? '', /c_overlay_recovery_spend/);
});

test('malformed candidate operations are rejected loudly, never silently evaluated', async () => {
  const { snapshot } = await disruptedScenarioA();
  await assert.rejects(
    engine.evaluateOverlay({
      baseSnapshot: snapshot,
      candidateOperations: [
        { op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: 'el_missing', data: { bogus: true } },
      ],
    }),
    /overlay candidate rejected/,
  );
});

test('candidate facts outranked by existing evidence reject the overlay', async () => {
  const { snapshot } = await disruptedScenarioA();
  // UPSERT_FACT with weaker authority than the incumbent CONNECTED fact must
  // be rejected by the shared fact-authority semantics — never applied.
  await assert.rejects(
    engine.evaluateOverlay({
      baseSnapshot: snapshot,
      candidateOperations: [
        {
          op: 'UPSERT_FACT',
          target: { entityType: 'TRIP_ELEMENT', id: 'el_a_flight_out' },
          factPath: 'data.scheduledArrival',
          value: {
            value: '2026-09-13T11:30:00+09:00',
            sourceId: 'src_overlay_rumour',
            authority: 'INFERRED',
            observedAt: '2026-09-01T00:00:00+09:00',
          },
          sourceId: 'src_overlay_rumour',
          authority: 'INFERRED',
        },
      ],
    }),
    /overlay candidate rejected/,
  );
});
