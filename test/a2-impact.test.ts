/**
 * A2 evidence — blast-radius propagation (T-PROP). Both frozen scenarios run
 * through the same engine code; direct failure, at-risk, threatened
 * objectives, losses and UNKNOWN are kept distinct; hard objective loss never
 * terminates propagation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ImpactEngine, impactProposal } from '../src/engine/impact.ts';
import { evaluateConstraints, type EvaluationContext } from '../src/engine/evaluators.ts';
import {
  loadScenario,
  scenarioHarness,
  seedScenario,
  cancellationProposal,
  SCENARIO_A_PATH,
  SCENARIO_B_PATH,
} from './a2-harness.ts';
import type { Trip } from '../src/domain/trip.ts';
import type { TripSignal } from '../src/operational/signal.ts';

function impactEngine(h: ReturnType<typeof scenarioHarness>) {
  return new ImpactEngine({ trips: h.trips, signals: h.signals, entities: h.entities });
}

test('Scenario A blast radius: direct failure, at-risk chain, threatened objective', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const apply = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(apply.accepted, true, apply.issues.map((i) => i.message).join('; '));

  const engine = impactEngine(h);
  const assessment = await engine.assess(spec.trip.id);

  assert.deepEqual(assessment.directFailures.map((f) => f.elementId), ['el_a_flight_out']);
  assert.deepEqual(
    assessment.affectedElements.map((a) => a.elementId).sort(),
    ['el_a_hotel', 'el_a_transfer'],
  );
  assert.deepEqual(assessment.threatenedObjectives.map((o) => o.objectiveId), ['obj_a_keynote']);
  assert.equal(assessment.severity, 'HIGH');
  assert.equal(assessment.irreversibleLosses.length, 0);
  assert.equal(assessment.triggeredBySignalId, spec.disruption.signal.id);
  assert.deepEqual(assessment.affectedTravellerIds, spec.trip.travellerIds);

  // Deterministic: identical input yields an identical assessment.
  const again = await engine.assess(spec.trip.id);
  assert.deepEqual(again, assessment);

  // assess() is read-only: authoritative trip version untouched.
  const trip = await h.trips.getTrip(spec.trip.id);
  assert.ok(trip);
  assert.equal(trip.version, apply.tripVersion);
});

test('Scenario B blast radius: direct failure only; return objective threatened', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const apply = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(apply.accepted, true, apply.issues.map((i) => i.message).join('; '));

  const assessment = await impactEngine(h).assess(spec.trip.id);
  assert.deepEqual(assessment.directFailures.map((f) => f.elementId), ['el_b_flight_back']);
  assert.deepEqual(assessment.affectedElements, []);
  assert.deepEqual(assessment.threatenedObjectives.map((o) => o.objectiveId), ['obj_b_return']);
  assert.equal(assessment.severity, 'HIGH');
  assert.equal(assessment.irreversibleLosses.length, 0);
});

test('weak-authority cancellation signal keeps the element AT_RISK with an unresolved unknown', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  // Do NOT apply the cancellation mutation: only a weak signal exists.
  const weak: TripSignal = { ...spec.disruption.signal, id: 'sig_weak', authority: 'ASSERTED' };
  await h.signals.saveSignal(weak);

  const assessment = await impactEngine(h).assess(spec.trip.id, 'sig_weak');
  assert.deepEqual(assessment.directFailures, []);
  assert.deepEqual(assessment.affectedElements.map((a) => a.elementId), ['el_b_flight_back']);
  assert.equal(assessment.affectedElements[0]?.resultingStatus, 'AT_RISK');
  assert.equal(assessment.unresolvedUnknowns.length, 1);
  assert.equal(assessment.severity, 'MEDIUM');
});

test('hard objective loss is recorded and propagation continues past it', async () => {
  const spec = loadScenario(SCENARIO_B_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);

  // Make the return objective unrecoverable: cancel the return leg via
  // validated mutation, then pin it FIXED so cancellation is unrecoverable,
  // and add a downstream connection so propagation has somewhere to continue
  // after the loss is recorded.
  const apply = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(apply.accepted, true, apply.issues.map((i) => i.message).join('; '));
  const returnLeg = spec.trip.elements.find((e) => e.id === 'el_b_flight_back');
  assert.ok(returnLeg);
  const pinFixed = await h.mutations.applyProposal({
    id: 'prop-pin-fixed',
    origin: 'SYSTEM',
    requestedAt: spec.disruption.signal.occurredAt,
    operations: [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        id: returnLeg.id,
        data: { ...returnLeg, reservationState: 'CANCELLED', flexibility: 'FIXED' },
      },
    ],
  });
  assert.equal(pinFixed.accepted, true, pinFixed.issues.map((i) => i.message).join('; '));
  const withDownstream = await h.mutations.applyProposal({
    id: 'prop-add-downstream',
    origin: 'SYSTEM',
    requestedAt: spec.disruption.signal.occurredAt,
    operations: [
      {
        op: 'ADD_RELATION',
        tripId: spec.trip.id,
        relation: {
          kind: 'CONNECTS_TO',
          from: { entityType: 'TRIP_ELEMENT', id: 'el_b_flight_back' },
          to: { entityType: 'TRIP_ELEMENT', id: 'el_b_transfer_out' },
        },
      },
    ],
  });
  assert.equal(withDownstream.accepted, true, withDownstream.issues.map((i) => i.message).join('; '));

  const assessment = await impactEngine(h).assess(spec.trip.id);
  assert.deepEqual(assessment.directFailures.map((f) => f.elementId), ['el_b_flight_back']);
  assert.equal(assessment.irreversibleLosses.length, 1);
  assert.equal(assessment.irreversibleLosses[0]?.relatedRefs[0], 'obj_b_return');
  assert.equal(assessment.severity, 'CRITICAL');
  // Propagation did NOT terminate at the loss: the downstream element was
  // still reached and marked at risk.
  assert.ok(assessment.affectedElements.some((a) => a.elementId === 'el_b_transfer_out'));
});

test('impact proposal persists constraint statuses and DISRUPTED viability through MutationService', async () => {
  const spec = loadScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  const apply = await h.mutations.applyProposal(cancellationProposal(spec));
  assert.equal(apply.accepted, true, apply.issues.map((i) => i.message).join('; '));

  const engine = impactEngine(h);
  const assessment = await engine.assess(spec.trip.id);
  const trip = await h.trips.getTrip(spec.trip.id);
  assert.ok(trip);
  const constraints = (await h.entities.list('CONSTRAINT'))
    .filter((e) => e.entityType === 'CONSTRAINT')
    .map((e) => e.entity);
  const evaluationCtx: EvaluationContext = {
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
  const evaluations = evaluateConstraints(constraints, evaluationCtx);

  // The hard arrival constraint must have failed; the no-show and transfer
  // constraints lost their evidence and must stay UNKNOWN (never PASS).
  const byId = new Map(evaluations.map((e) => [e.constraintId, e.status]));
  assert.equal(byId.get('c_a_arrive_before_keynote'), 'FAIL');
  assert.equal(byId.get('c_a_hotel_no_show'), 'UNKNOWN');
  assert.equal(byId.get('c_a_transfer_feasible'), 'UNKNOWN');

  const persist = await h.mutations.applyProposal(impactProposal(assessment, constraints, evaluations, trip));
  assert.equal(persist.accepted, true, persist.issues.map((i) => i.message).join('; '));

  const reloaded: Trip | undefined = await h.trips.getTrip(spec.trip.id);
  assert.ok(reloaded);
  assert.equal(reloaded.viability, 'DISRUPTED');
  const storedConstraint = await h.entities.get('CONSTRAINT', 'c_a_arrive_before_keynote');
  assert.ok(storedConstraint?.entityType === 'CONSTRAINT');
  assert.equal(storedConstraint.entity.status, 'FAIL');
});
