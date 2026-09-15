/**
 * NORTHSTAR M6 L2 — `m6.objective` and `m6.participation` evaluator tests.
 *
 * Contract: docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L2. Pure,
 * deterministic, no I/O: every world is built with emptyWorld/effectiveOf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type {
  CapturedWorld, WConstraintDefinition, WGroupMembership, WJourney, WJourneyItem, WObjective, WParticipation, WProgrammeItem, WTransportService,
} from '../src/resolution/world/world.ts';
import { objectiveEvaluator } from '../src/resolution/evaluation/evaluators/objective.ts';
import { participationEvaluator } from '../src/resolution/evaluation/evaluators/participation.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';

const NOW = '2030-01-01T00:00:00.000Z';

function journeyRow(over: Partial<WJourney> = {}): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId: id(), lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null, ...over };
}

function transportItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
    desiredOriginPlaceId: 'p-origin', desiredDestinationPlaceId: 'p-dest', selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function service(over: Partial<WTransportService> = {}): WTransportService {
  return {
    id: id(), revision: 1, mode: 'AIR', operator: 'op', originPlaceId: 'p-origin', destinationPlaceId: 'p-dest',
    published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
    ...over,
  };
}

function observed(value: string): { value: string; observedAt: string; evidenceId: string | null } {
  return { value, observedAt: NOW, evidenceId: null };
}

function objectiveRow(owner: TypedRef, over: Partial<WObjective> = {}): WObjective {
  return {
    id: id(), revision: 1, owner, successPredicateKind: 'ARRIVAL_BY', hardness: 'HARD', priority: 1,
    disposition: 'ACTIVE', dispositionEvidenceId: null, targets: [], ...over,
  };
}

function timeTarget(atOrBefore: string) {
  return { label: 'deadline', targetKind: 'TIME', subject: null, placeId: null, atOrBefore, amountMinor: null, currencyCode: null };
}
function placeTarget(placeId: string) {
  return { label: 'place', targetKind: 'PLACE', subject: null, placeId, atOrBefore: null, amountMinor: null, currencyCode: null };
}
function subjectTarget(subject: TypedRef) {
  return { label: 'subject', targetKind: 'SUBJECT', subject, placeId: null, atOrBefore: null, amountMinor: null, currencyCode: null };
}

function programmeItemRow(over: Partial<WProgrammeItem> = {}): WProgrammeItem {
  return { id: id(), programmeId: id(), title: 't', itemType: 'SESSION', placeId: 'p-venue', window: { start: '2030-01-02T10:00:00.000Z', end: '2030-01-02T11:00:00.000Z' }, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null, ...over };
}

function participationRow(travellerId: string, programmeItemId: string, over: Partial<WParticipation> = {}): WParticipation {
  return { id: id(), programmeItemId, travellerId, obligation: 'REQUIRED', accepted: true, preparationWindow: null, ...over };
}

function transferConstraint(owner: TypedRef, fromPlaceId: string, toPlaceId: string, minutes: number): WConstraintDefinition {
  return {
    id: id(), revision: 1, registeredType: 'transfer_minutes', hardness: 'HARD', owner, provenanceEvidenceId: null,
    operands: [
      { key: 'from_place', kind: 'SUBJECT_REF', subject: { kind: 'PLACE', id: fromPlaceId }, text: null, number: null, boolean: null, instant: null, localDate: null },
      { key: 'to_place', kind: 'SUBJECT_REF', subject: { kind: 'PLACE', id: toPlaceId }, text: null, number: null, boolean: null, instant: null, localDate: null },
      { key: 'minutes', kind: 'NUMBER', subject: null, text: null, number: String(minutes), boolean: null, instant: null, localDate: null },
    ],
  };
}

function worldWithJourney(overrides: Partial<CapturedWorld> = {}) {
  const journey = journeyRow();
  const world = emptyWorld({ journeys: [journey], ...overrides });
  const ref: TypedRef = { kind: 'JOURNEY', id: journey.id };
  return { world, journey, ref };
}

const registryFor = (...evaluators: (typeof objectiveEvaluator | typeof participationEvaluator)[]) => createEvaluatorRegistry(evaluators);

// -----------------------------------------------------------------------
// m6.objective
// -----------------------------------------------------------------------

test('objective: ARRIVAL_BY direct arrival before deadline is PASS arrives_in_time (hard_objectives)', () => {
  const { world, journey, ref } = worldWithJourney();
  world.journeyItems.push(transportItem(journey.id, {
    desiredDestinationPlaceId: 'p-target',
    selectedServiceId: (() => { const s = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T10:00:00.000Z') } }); world.transportServices.push(s); return s.id; })(),
  }));
  world.objectives.push(objectiveRow(ref, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.applicable, true);
  assert.equal(hard.verdict, 'PASS');
  assert.equal(hard.explanations[0]?.reasonCode, 'arrives_in_time');
});

test('objective: ARRIVAL_BY arrival after deadline is FAIL arrives_after_deadline', () => {
  const { world, journey, ref } = worldWithJourney();
  const svc = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T13:00:00.000Z') } });
  world.transportServices.push(svc);
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-target', selectedServiceId: svc.id }));
  world.objectives.push(objectiveRow(ref, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.verdict, 'FAIL');
  assert.equal(hard.explanations[0]?.reasonCode, 'arrives_after_deadline');
});

test('objective: ARRIVAL_BY with no transport items at all is UNKNOWN no_route_to_place', () => {
  const { world, ref } = worldWithJourney();
  world.objectives.push(objectiveRow(ref, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.verdict, 'UNKNOWN');
  assert.equal(hard.explanations[0]?.reasonCode, 'no_route_to_place');
});

test('objective: ARRIVAL_BY with an unknown arrival time is UNKNOWN arrival_time_unknown', () => {
  const { world, journey, ref } = worldWithJourney();
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-target' }));
  world.objectives.push(objectiveRow(ref, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.verdict, 'UNKNOWN');
  assert.equal(hard.explanations[0]?.reasonCode, 'arrival_time_unknown');
});

test('objective: ARRIVAL_BY via registered transfer_minutes PASSes; without it, UNKNOWN transfer_time_unknown', () => {
  const { world, journey, ref } = worldWithJourney();
  const svc = service({ destinationPlaceId: 'p-arrival', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T10:00:00.000Z') } });
  world.transportServices.push(svc);
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-arrival', selectedServiceId: svc.id }));
  world.objectives.push(objectiveRow(ref, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }));

  const withoutTransfer = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hardWithout = withoutTransfer.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hardWithout.verdict, 'UNKNOWN');
  assert.equal(hardWithout.explanations[0]?.reasonCode, 'transfer_time_unknown');

  world.constraints.push(transferConstraint(ref, 'p-arrival', 'p-target', 30));
  const withTransfer = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hardWith = withTransfer.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hardWith.verdict, 'PASS');
  assert.equal(hardWith.explanations[0]?.reasonCode, 'arrives_in_time');
});

test('objective: ACHIEVED disposition is PASS objective_achieved regardless of predicate kind', () => {
  const { world, ref } = worldWithJourney();
  world.objectives.push(objectiveRow(ref, { hardness: 'SOFT', disposition: 'ACHIEVED', successPredicateKind: 'STATEMENT' }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const soft = out.dimensions.find((d) => d.dimension === 'soft_objectives')!;
  assert.equal(soft.verdict, 'PASS');
  assert.equal(soft.explanations[0]?.reasonCode, 'objective_achieved');
});

test('objective: ARRIVAL_BY without both targets is UNKNOWN objective_target_missing', () => {
  const { world, ref } = worldWithJourney();
  world.objectives.push(objectiveRow(ref, { targets: [] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.verdict, 'UNKNOWN');
  assert.equal(hard.explanations[0]?.reasonCode, 'objective_target_missing');
  assert.deepEqual(hard.explanations[0]?.uncertainty[0]?.kind, 'MISSING_INPUT');
});

test('objective: ATTEND target CANCELLED is FAIL attend_target_cancelled', () => {
  const { world, ref } = worldWithJourney();
  const item = programmeItemRow({ lifecycleStatus: 'CANCELLED' });
  world.programmeItems.push(item);
  world.objectives.push(objectiveRow(ref, { successPredicateKind: 'ATTEND', targets: [subjectTarget({ kind: 'PROGRAMME_ITEM', id: item.id })] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.verdict, 'FAIL');
  assert.equal(hard.explanations[0]?.reasonCode, 'attend_target_cancelled');
});

test('objective: ATTEND target with no window is UNKNOWN attend_target_unscheduled', () => {
  const { world, ref } = worldWithJourney();
  const item = programmeItemRow({ window: null });
  world.programmeItems.push(item);
  world.objectives.push(objectiveRow(ref, { successPredicateKind: 'ATTEND', targets: [subjectTarget({ kind: 'PROGRAMME_ITEM', id: item.id })] }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  assert.equal(hard.verdict, 'UNKNOWN');
  assert.equal(hard.explanations[0]?.reasonCode, 'attend_target_unscheduled');
});

test('objective: STATEMENT (and other unregistered) predicate kinds are UNKNOWN objective_predicate_unsupported', () => {
  const { world, ref } = worldWithJourney();
  world.objectives.push(objectiveRow(ref, { successPredicateKind: 'STATEMENT' }));
  world.objectives.push(objectiveRow(ref, { successPredicateKind: 'BOUND_SPEND', hardness: 'SOFT' }));
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  const soft = out.dimensions.find((d) => d.dimension === 'soft_objectives')!;
  assert.equal(hard.explanations[0]?.reasonCode, 'objective_predicate_unsupported');
  assert.equal(hard.explanations[0]?.uncertainty[0]?.kind, 'UNSUPPORTED_EVALUATION');
  assert.equal(soft.explanations[0]?.reasonCode, 'objective_predicate_unsupported');
});

test('REQUIRED (b): an authorised loss removes the objective from hard_objectives; a still-ACTIVE hard objective keeps the overall verdict FAIL', () => {
  const { world, journey, ref } = worldWithJourney();
  const svc = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T13:00:00.000Z') } });
  world.transportServices.push(svc);
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-target', selectedServiceId: svc.id }));

  const lost = objectiveRow(ref, { hardness: 'HARD', disposition: 'CLOSED_WITH_LOSS', dispositionEvidenceId: 'ev-loss-1' });
  const stillActive = objectiveRow(ref, { hardness: 'HARD', disposition: 'ACTIVE', targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] });
  world.objectives.push(lost, stillActive);

  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const hard = out.dimensions.find((d) => d.dimension === 'hard_objectives')!;
  const waived = out.dimensions.find((d) => d.dimension === 'waived_objectives')!;
  assert.equal(hard.explanations.length, 1, 'the closed-with-loss objective never appears in hard_objectives');
  assert.equal(hard.explanations[0]?.reasonCode, 'arrives_after_deadline');
  assert.equal(hard.verdict, 'FAIL');
  assert.equal(waived.explanations.length, 1);
  assert.equal(waived.explanations[0]?.reasonCode, 'objective_loss_authorised');
  assert.deepEqual(waived.explanations[0]?.evidenceRefs, [{ kind: 'EVIDENCE_RECORD', id: 'ev-loss-1' }]);

  const registry = registryFor(objectiveEvaluator);
  const assessed = assessSubject({ registry, world, effective: effectiveOf(world), subject: ref, now: NOW, assessmentId: id() });
  assert.equal(assessed.result.overallVerdict, 'FAIL');
});

test('objective: Trip- and group-owned objectives govern member Journeys and are evaluated per Journey', () => {
  const tripId = id();
  const groupId = id();
  const journeyA = journeyRow({ tripId });
  const journeyB = journeyRow({ tripId });
  const refA: TypedRef = { kind: 'JOURNEY', id: journeyA.id };
  const refB: TypedRef = { kind: 'JOURNEY', id: journeyB.id };
  const membershipA: WGroupMembership = { id: id(), groupId, journeyId: journeyA.id, effective: { start: null, end: null }, scopeItemIds: [] };
  const svcOnTime = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T10:00:00.000Z') } });
  const svcLate = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T13:00:00.000Z') } });
  const world = emptyWorld({
    journeys: [journeyA, journeyB],
    groupMemberships: [membershipA],
    transportServices: [svcOnTime, svcLate],
    journeyItems: [
      transportItem(journeyA.id, { desiredDestinationPlaceId: 'p-target', selectedServiceId: svcOnTime.id }),
      transportItem(journeyB.id, { desiredDestinationPlaceId: 'p-target', selectedServiceId: svcLate.id }),
    ],
    objectives: [
      objectiveRow({ kind: 'TRIP', id: tripId }, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }),
      objectiveRow({ kind: 'COORDINATION_GROUP', id: groupId }, { hardness: 'SOFT', targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }),
    ],
  });
  const effective = effectiveOf(world);

  const outA = objectiveEvaluator.evaluate(refA, { now: NOW, world, effective });
  const outB = objectiveEvaluator.evaluate(refB, { now: NOW, world, effective });
  assert.equal(outA.dimensions.find((d) => d.dimension === 'hard_objectives')!.verdict, 'PASS', 'trip objective PASSes for the on-time member');
  assert.equal(outB.dimensions.find((d) => d.dimension === 'hard_objectives')!.verdict, 'FAIL', 'the same trip objective FAILs independently for the late member');
  assert.equal(outA.dimensions.find((d) => d.dimension === 'soft_objectives')!.verdict, 'PASS', 'group objective applies to the group member');
  assert.equal(outB.dimensions.find((d) => d.dimension === 'soft_objectives')!.applicable, false, 'B is not a member of the group, so the group objective does not govern it');
});

test('objective: no governing objectives leaves all three dimensions not applicable', () => {
  const { world, ref } = worldWithJourney();
  const out = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  for (const dim of ['hard_objectives', 'soft_objectives', 'waived_objectives']) {
    const d = out.dimensions.find((x) => x.dimension === dim)!;
    assert.equal(d.applicable, false);
    assert.equal(d.verdict, 'UNKNOWN');
  }
});

test('objective: evaluation is deterministic for an identical world', () => {
  const { world, journey, ref } = worldWithJourney();
  const svc = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T10:00:00.000Z') } });
  world.transportServices.push(svc);
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-target', selectedServiceId: svc.id }));
  world.objectives.push(objectiveRow(ref, { targets: [timeTarget('2030-01-02T12:00:00.000Z'), placeTarget('p-target')] }));
  const effective = effectiveOf(world);
  const out1 = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective });
  const out2 = objectiveEvaluator.evaluate(ref, { now: NOW, world, effective });
  assert.deepEqual(out1, out2);
});

// -----------------------------------------------------------------------
// m6.participation
// -----------------------------------------------------------------------

test('participation: a REQUIRED participation referencing an uncaptured programme item is UNKNOWN programme_item_not_captured', () => {
  const { world, journey, ref } = worldWithJourney();
  world.participations.push(participationRow(journey.travellerId, id()));
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const required = out.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(required.verdict, 'UNKNOWN');
  assert.equal(required.explanations[0]?.reasonCode, 'programme_item_not_captured');
});

test('participation: a CANCELLED programme item is PASS programme_item_cancelled (the obligation is gone)', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow({ lifecycleStatus: 'CANCELLED' });
  world.programmeItems.push(item);
  world.participations.push(participationRow(journey.travellerId, item.id));
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const required = out.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(required.verdict, 'PASS');
  assert.equal(required.explanations[0]?.reasonCode, 'programme_item_cancelled');
});

test('participation: a programme item without a window is UNKNOWN participation_schedule_unknown', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow({ window: null });
  world.programmeItems.push(item);
  world.participations.push(participationRow(journey.travellerId, item.id));
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const required = out.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(required.verdict, 'UNKNOWN');
  assert.equal(required.explanations[0]?.reasonCode, 'participation_schedule_unknown');
});

test('participation: a journey with no eligible departure item at all is UNKNOWN no_route_to_place on arrival', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow();
  world.programmeItems.push(item);
  world.participations.push(participationRow(journey.travellerId, item.id));
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const required = out.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(required.verdict, 'UNKNOWN');
  assert.equal(required.explanations[0]?.reasonCode, 'no_route_to_place');
});

test('participation: an eligible departure item with an unknown start time is UNKNOWN departure_time_unknown', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow({ placeId: 'p-venue', window: { start: '2030-01-02T10:00:00.000Z', end: '2030-01-02T11:00:00.000Z' } });
  world.programmeItems.push(item);
  world.participations.push(participationRow(journey.travellerId, item.id));
  const arriveSvc = service({ destinationPlaceId: 'p-venue', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T09:00:00.000Z') } });
  world.transportServices.push(arriveSvc);
  world.journeyItems.push(
    transportItem(journey.id, { orderKey: '010', desiredDestinationPlaceId: 'p-venue', selectedServiceId: arriveSvc.id }),
    transportItem(journey.id, { orderKey: '020', desiredOriginPlaceId: 'p-venue', desiredDestinationPlaceId: 'p-far', selectedServiceId: null, intendedWindow: null }),
  );
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const required = out.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(required.verdict, 'UNKNOWN');
  assert.equal(required.explanations[0]?.reasonCode, 'departure_time_unknown');
});

test('participation: OPTIONAL/INFORMED obligations feed optional_participation, which never blocks', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow();
  world.programmeItems.push(item);
  world.participations.push(participationRow(journey.travellerId, item.id, { obligation: 'OPTIONAL' }));
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  const required = out.dimensions.find((d) => d.dimension === 'programme_participation')!;
  const optional = out.dimensions.find((d) => d.dimension === 'optional_participation')!;
  assert.equal(required.applicable, false);
  assert.equal(optional.applicable, true);
  assert.equal(optional.blocking, false);
  assert.equal(optional.verdict, 'UNKNOWN');
  assert.equal(optional.explanations[0]?.reasonCode, 'no_route_to_place');
});

test('participation: no participations for the traveller leaves both dimensions not applicable', () => {
  const { world, ref } = worldWithJourney();
  const out = participationEvaluator.evaluate(ref, { now: NOW, world, effective: effectiveOf(world) });
  for (const dim of ['programme_participation', 'optional_participation']) {
    const d = out.dimensions.find((x) => x.dimension === dim)!;
    assert.equal(d.applicable, false);
  }
});

test('participation: evaluation is deterministic for an identical world', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow();
  world.programmeItems.push(item);
  world.participations.push(participationRow(journey.travellerId, item.id));
  const arriveSvc = service({ destinationPlaceId: 'p-venue', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T09:00:00.000Z') } });
  world.transportServices.push(arriveSvc);
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-venue', selectedServiceId: arriveSvc.id }));
  const effective = effectiveOf(world);
  const out1 = participationEvaluator.evaluate(ref, { now: NOW, world, effective });
  const out2 = participationEvaluator.evaluate(ref, { now: NOW, world, effective });
  assert.deepEqual(out1, out2);
});

test('REQUIRED (a): moving a programme item later helps one traveller and harms another, through assessSubject', () => {
  const place = 'p-venue';
  const travellerA = journeyRow();
  const travellerB = journeyRow();
  const refA: TypedRef = { kind: 'JOURNEY', id: travellerA.id };
  const refB: TypedRef = { kind: 'JOURNEY', id: travellerB.id };

  const arriveA = service({ destinationPlaceId: place, published: { departure: observed('2030-01-02T09:00:00.000Z'), arrival: observed('2030-01-02T10:30:00.000Z') } });
  const departA = service({ originPlaceId: place, published: { departure: observed('2030-01-02T15:00:00.000Z'), arrival: observed('2030-01-02T16:00:00.000Z') } });
  const arriveB = service({ destinationPlaceId: place, published: { departure: observed('2030-01-02T07:00:00.000Z'), arrival: observed('2030-01-02T09:00:00.000Z') } });
  const departB = service({ originPlaceId: place, published: { departure: observed('2030-01-02T11:30:00.000Z'), arrival: observed('2030-01-02T13:00:00.000Z') } });

  const item = programmeItemRow({ placeId: place, window: { start: '2030-01-02T10:00:00.000Z', end: '2030-01-02T11:00:00.000Z' } });
  const world = emptyWorld({
    journeys: [travellerA, travellerB],
    programmeItems: [item],
    participations: [participationRow(travellerA.travellerId, item.id), participationRow(travellerB.travellerId, item.id)],
    transportServices: [arriveA, departA, arriveB, departB],
    journeyItems: [
      transportItem(travellerA.id, { orderKey: '010', desiredDestinationPlaceId: place, selectedServiceId: arriveA.id }),
      transportItem(travellerA.id, { orderKey: '020', desiredOriginPlaceId: place, selectedServiceId: departA.id }),
      transportItem(travellerB.id, { orderKey: '010', desiredDestinationPlaceId: place, selectedServiceId: arriveB.id }),
      transportItem(travellerB.id, { orderKey: '020', desiredOriginPlaceId: place, selectedServiceId: departB.id }),
    ],
  });
  const effective = effectiveOf(world);
  const registry = registryFor(participationEvaluator);

  const beforeA = assessSubject({ registry, world, effective, subject: refA, now: NOW, assessmentId: id() });
  const beforeB = assessSubject({ registry, world, effective, subject: refB, now: NOW, assessmentId: id() });
  const beforeRequiredA = beforeA.result.dimensions.find((d) => d.dimension === 'programme_participation')!;
  const beforeRequiredB = beforeB.result.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(beforeRequiredA.verdict, 'FAIL', 'A arrives after the old window start');
  assert.equal(beforeRequiredA.explanations[0]?.reasonCode, 'arrives_after_deadline');
  assert.equal(beforeRequiredB.verdict, 'PASS', 'B arrives in time and departs after the old window end');
  assert.equal(beforeRequiredB.explanations[0]?.reasonCode, 'participation_feasible');

  // Move the item's window three hours later.
  item.window = { start: '2030-01-02T13:00:00.000Z', end: '2030-01-02T14:00:00.000Z' };
  const afterA = assessSubject({ registry, world, effective, subject: refA, now: NOW, assessmentId: id() });
  const afterB = assessSubject({ registry, world, effective, subject: refB, now: NOW, assessmentId: id() });
  const afterRequiredA = afterA.result.dimensions.find((d) => d.dimension === 'programme_participation')!;
  const afterRequiredB = afterB.result.dimensions.find((d) => d.dimension === 'programme_participation')!;
  assert.equal(afterRequiredA.verdict, 'PASS', 'A now arrives before the later window start');
  assert.equal(afterRequiredA.explanations[0]?.reasonCode, 'participation_feasible');
  assert.equal(afterRequiredB.verdict, 'FAIL', 'B now departs before the later window end');
  assert.equal(afterRequiredB.explanations[0]?.reasonCode, 'departs_before_item_ends');
});

// -----------------------------------------------------------------------
// composition: every dimension both evaluators can emit is declared
// -----------------------------------------------------------------------

test('composition: registering both L2 evaluators declares all five dimensions with no collision', () => {
  const { world, journey, ref } = worldWithJourney();
  const item = programmeItemRow();
  const optionalItem = programmeItemRow();
  world.programmeItems.push(item, optionalItem);
  world.participations.push(
    participationRow(journey.travellerId, item.id),
    participationRow(journey.travellerId, optionalItem.id, { obligation: 'OPTIONAL' }),
  );
  const svc = service({ destinationPlaceId: 'p-target', published: { departure: observed('2030-01-02T08:00:00.000Z'), arrival: observed('2030-01-02T10:00:00.000Z') } });
  world.transportServices.push(svc);
  world.journeyItems.push(transportItem(journey.id, { desiredDestinationPlaceId: 'p-target', selectedServiceId: svc.id }));
  world.objectives.push(
    objectiveRow(ref, { hardness: 'HARD', disposition: 'ACHIEVED' }),
    objectiveRow(ref, { hardness: 'SOFT', disposition: 'ACHIEVED' }),
    objectiveRow(ref, { hardness: 'HARD', disposition: 'WAIVED', dispositionEvidenceId: 'ev-2' }),
  );

  const registry = registryFor(objectiveEvaluator, participationEvaluator);
  const out = assessSubject({ registry, world, effective: effectiveOf(world), subject: ref, now: NOW, assessmentId: id() });
  const names = out.result.dimensions.map((d) => d.dimension).sort();
  assert.deepEqual(names, ['hard_objectives', 'optional_participation', 'programme_participation', 'soft_objectives', 'waived_objectives']);
  for (const dim of names) {
    const d = out.result.dimensions.find((x) => x.dimension === dim)!;
    assert.equal(d.applicable, true, `${dim} should be applicable given the world data`);
  }
});
