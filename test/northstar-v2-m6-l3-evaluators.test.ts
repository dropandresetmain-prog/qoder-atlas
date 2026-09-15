/**
 * M6 L3 — m6.support / m6.group / m6.funding (pure).
 * docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type { WAccompanimentRequirement, WSupportAssignment, WJourneyItem, WConstraintDefinition } from '../src/resolution/world/world.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { CausalExplanation } from '../src/contracts/v2/assessment/explanation.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import { supportEvaluator } from '../src/resolution/evaluation/evaluators/support.ts';
import { groupEvaluator } from '../src/resolution/evaluation/evaluators/group.ts';
import { fundingEvaluator } from '../src/resolution/evaluation/evaluators/funding.ts';

const NOW = '2030-01-01T00:00:00.000Z';

function subjectOf(journeyId: string): TypedRef {
  return { kind: 'JOURNEY', id: journeyId };
}

function journeyRow(journeyId: string, travellerId: string, over: Partial<{ tripId: string }> = {}) {
  return { id: journeyId, revision: 1, tripId: over.tripId ?? id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null };
}

function transportItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
    desiredOriginPlaceId: null, desiredDestinationPlaceId: null, selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function window(start: string, end: string) {
  return { start, end };
}

type World = ReturnType<typeof emptyWorld>;

function findExplanation(dim: { explanations: CausalExplanation[] } | undefined, reasonCode: string): CausalExplanation | undefined {
  return dim?.explanations.find((e) => e.reasonCode === reasonCode);
}

function requirementRow(supportedTravellerId: string, coverage: { start: string; end: string }, over: Partial<WAccompanimentRequirement> = {}): WAccompanimentRequirement {
  return {
    id: id(), version: 1, supportedTravellerId, coverage, minimumSimultaneousSupporters: 1, maximumHandoffGapMinutes: 0,
    eligibleSupporterTravellerIds: [], provenanceEvidenceId: null, latestVersion: true, ...over,
  };
}

function assignmentRow(
  requirementId: string,
  requirementVersion: number,
  scopes: { supporterTravellerId: string; start: string; end: string }[],
  over: Partial<WSupportAssignment> = {},
): WSupportAssignment {
  return {
    id: id(), revision: 1, requirementId, requirementVersion, lifecycleStatus: 'ACTIVE',
    assigneeTravellerIds: scopes.map((s) => s.supporterTravellerId), scopes, handoffs: [],
    ...over,
  };
}

function constraintRow(owner: TypedRef, registeredType: string, operands: WConstraintDefinition['operands'] = []): WConstraintDefinition {
  return { id: id(), revision: 1, registeredType, hardness: 'HARD', owner, provenanceEvidenceId: null, operands };
}

function addAllocatedReservation(world: World, opts: { travellerId: string; journeyItemId?: string | null }): { reservationId: string } {
  const reservationId = id();
  const lineId = id();
  world.reservations.push({ id: reservationId, revision: 1, reservationType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: NOW, responsibleOrganisationId: null, responsibleTravellerId: opts.travellerId });
  world.reservationLines.push({ id: lineId, reservationId, productType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: NOW, evidenceId: null, transportServiceId: null, resourceId: null, placeId: null, interval: null });
  world.allocations.push({ id: id(), reservationId, lineId, travellerId: opts.travellerId, journeyItemId: opts.journeyItemId ?? null, role: 'PASSENGER', quantity: 1 });
  return { reservationId };
}

// --------------------------------------------------------------------------
// m6.support — support_continuity
// --------------------------------------------------------------------------

test('support: not applicable when the Journey traveller is not a supported traveller', () => {
  const journeyId = id();
  const travellerId = id();
  const otherTravellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') }));
  world.accompanimentRequirements.push(requirementRow(otherTravellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z')));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.applicable, false);
  assert.equal(dim?.verdict, 'UNKNOWN');
});

test('support: not applicable when the requirement coverage does not overlap any active effective item', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') }));
  world.accompanimentRequirements.push(requirementRow(travellerId, window('2030-03-01T00:00:00.000Z', '2030-03-02T00:00:00.000Z')));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.applicable, false);
  assert.equal(dim?.verdict, 'UNKNOWN');
});

test('support: no ACTIVE assignment pinned to the requirement FAILs no_active_assignment', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') }));
  world.accompanimentRequirements.push(requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z')));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'no_active_assignment');
});

test('support: an ACTIVE assignment pinned to an older requirement version FAILs assignment_pins_superseded_requirement', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') }));
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { version: 2, eligibleSupporterTravellerIds: [supporterId] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(assignmentRow(requirement.id, 1, [{ supporterTravellerId: supporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'assignment_pins_superseded_requirement');
  assert.equal(dim?.explanations[0]?.facts.pinnedVersion, 1);
  assert.equal(dim?.explanations[0]?.facts.currentVersion, 2);
});

test('support: an assignment naming an ineligible supporter FAILs assignment_does_not_satisfy_requirement', () => {
  const journeyId = id();
  const travellerId = id();
  const ineligibleSupporterId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') }));
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { eligibleSupporterTravellerIds: [id()] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(assignmentRow(requirement.id, requirement.version, [{ supporterTravellerId: ineligibleSupporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'assignment_does_not_satisfy_requirement');
  assert.equal(dim?.explanations[0]?.facts.reasonIndex, 0);
});

test('support: a co-present supporter on the dependant\'s own service PASSes supporter_on_same_service', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterId = id();
  const supporterJourneyId = id();
  const serviceId = id();
  const start = '2030-02-01T10:00:00.000Z';
  const end = '2030-02-01T12:00:00.000Z';
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId), journeyRow(supporterJourneyId, supporterId)] });
  world.journeyItems.push(
    transportItem(journeyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
    transportItem(supporterJourneyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
  );
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { eligibleSupporterTravellerIds: [supporterId] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(assignmentRow(requirement.id, requirement.version, [{ supporterTravellerId: supporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  const explanation = findExplanation(dim, 'supporter_on_same_service');
  assert.equal(explanation?.status, 'PASS');
  assert.equal(dim?.verdict, 'PASS');
});

test('support: AT03/AT05 split route — a co-present supporter travelling on a different service FAILs supporter_not_on_same_service', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterId = id();
  const supporterJourneyId = id();
  const serviceId = id();
  const otherServiceId = id();
  const start = '2030-02-01T10:00:00.000Z';
  const end = '2030-02-01T12:00:00.000Z';
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId), journeyRow(supporterJourneyId, supporterId)] });
  world.journeyItems.push(
    transportItem(journeyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
    transportItem(supporterJourneyId, { intendedWindow: window(start, end), selectedServiceId: otherServiceId }),
  );
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { eligibleSupporterTravellerIds: [supporterId] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(assignmentRow(requirement.id, requirement.version, [{ supporterTravellerId: supporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  const explanation = findExplanation(dim, 'supporter_not_on_same_service');
  assert.equal(explanation?.status, 'FAIL');
  assert.equal(dim?.verdict, 'FAIL');
});

test('support: a handoff across a split — supporter A on leg 1, eligible supporter B on leg 2, both co-present — PASSes', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterAId = id();
  const supporterAJourneyId = id();
  const supporterBId = id();
  const supporterBJourneyId = id();
  const serviceLeg1 = id();
  const serviceLeg2 = id();
  const t0 = '2030-02-01T08:00:00.000Z';
  const t1 = '2030-02-01T10:00:00.000Z';
  const t3 = '2030-02-01T12:00:00.000Z';

  const world = emptyWorld({
    journeys: [
      journeyRow(journeyId, travellerId),
      journeyRow(supporterAJourneyId, supporterAId),
      journeyRow(supporterBJourneyId, supporterBId),
    ],
  });
  world.journeyItems.push(
    transportItem(journeyId, { orderKey: '010', intendedWindow: window(t0, t1), selectedServiceId: serviceLeg1 }),
    transportItem(journeyId, { orderKey: '020', intendedWindow: window(t1, t3), selectedServiceId: serviceLeg2 }),
    transportItem(supporterAJourneyId, { intendedWindow: window(t0, t1), selectedServiceId: serviceLeg1 }),
    transportItem(supporterBJourneyId, { intendedWindow: window(t1, t3), selectedServiceId: serviceLeg2 }),
  );
  const requirement = requirementRow(travellerId, window(t0, t3), { eligibleSupporterTravellerIds: [supporterAId, supporterBId] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(
    assignmentRow(
      requirement.id,
      requirement.version,
      [
        { supporterTravellerId: supporterAId, start: t0, end: t1 },
        { supporterTravellerId: supporterBId, start: t1, end: t3 },
      ],
      { handoffs: [{ fromSupporterTravellerId: supporterAId, toSupporterTravellerId: supporterBId, at: t1 }] },
    ),
  );
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.verdict, 'PASS', 'the eligible handoff from supporter A to supporter B never becomes a coverage gap');
  assert.equal(dim?.explanations.filter((e) => e.reasonCode === 'supporter_on_same_service').length, 2);
});

test('support: a dependant TRANSPORT item without a captured service UNKNOWNs dependant_service_unknown', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z'), selectedServiceId: null }));
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { eligibleSupporterTravellerIds: [supporterId] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(assignmentRow(requirement.id, requirement.version, [{ supporterTravellerId: supporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'dependant_service_unknown');
});

test('support: a supporter with no captured Journey UNKNOWNs supporter_itinerary_unknown and never PASSes', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterId = id();
  const serviceId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z'), selectedServiceId: serviceId }));
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { eligibleSupporterTravellerIds: [supporterId] });
  world.accompanimentRequirements.push(requirement);
  // supporterId has no WJourney row anywhere in this world -> itinerary unknown.
  world.supportAssignments.push(assignmentRow(requirement.id, requirement.version, [{ supporterTravellerId: supporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  const explanation = findExplanation(dim, 'supporter_itinerary_unknown');
  assert.equal(explanation?.status, 'UNKNOWN');
  assert.deepEqual(explanation?.uncertainty, [{ kind: 'MISSING_INPUT', code: 'supporter_itinerary', subjectRef: { kind: 'TRAVELLER', id: supporterId } }]);
  assert.notEqual(dim?.verdict, 'PASS');
});

test('support: fewer co-present, on-service supporters than minimumSimultaneousSupporters FAILs insufficient_simultaneous_supporters', () => {
  const journeyId = id();
  const travellerId = id();
  const supporterAId = id();
  const supporterAJourneyId = id();
  const supporterBId = id();
  const supporterBJourneyId = id();
  const serviceId = id();
  const otherServiceId = id();
  const start = '2030-02-01T10:00:00.000Z';
  const end = '2030-02-01T12:00:00.000Z';
  const world = emptyWorld({
    journeys: [
      journeyRow(journeyId, travellerId),
      journeyRow(supporterAJourneyId, supporterAId),
      journeyRow(supporterBJourneyId, supporterBId),
    ],
  });
  world.journeyItems.push(
    transportItem(journeyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
    transportItem(supporterAJourneyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }), // co-present, correct service
    transportItem(supporterBJourneyId, { intendedWindow: window(start, end), selectedServiceId: otherServiceId }), // split route
  );
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), {
    minimumSimultaneousSupporters: 2,
    eligibleSupporterTravellerIds: [supporterAId, supporterBId],
  });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(
    assignmentRow(requirement.id, requirement.version, [
      { supporterTravellerId: supporterAId, start: requirement.coverage.start, end: requirement.coverage.end },
      { supporterTravellerId: supporterBId, start: requirement.coverage.start, end: requirement.coverage.end },
    ]),
  );
  const effective = effectiveOf(world);
  const out = supportEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'support_continuity');
  const explanation = findExplanation(dim, 'insufficient_simultaneous_supporters');
  assert.equal(explanation?.status, 'FAIL');
  assert.equal(explanation?.facts.coPresentSupporters, 1);
  assert.equal(explanation?.facts.minimumRequired, 2);
  assert.equal(dim?.verdict, 'FAIL');
});

// --------------------------------------------------------------------------
// m6.group — travel_together
// --------------------------------------------------------------------------

test('group: travel_together members sharing the reference service PASS members_share_service', () => {
  const journeyId = id();
  const travellerId = id();
  const memberJourneyId = id();
  const memberTravellerId = id();
  const groupId = id();
  const serviceId = id();
  const start = '2030-02-01T10:00:00.000Z';
  const end = '2030-02-01T12:00:00.000Z';
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId), journeyRow(memberJourneyId, memberTravellerId)] });
  world.journeyItems.push(
    transportItem(journeyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
    transportItem(memberJourneyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
  );
  world.coordinationGroups.push({ id: groupId, revision: 1, name: 'g', lifecycleStatus: 'ACTIVE', effective: { start: null, end: null } });
  world.groupMemberships.push(
    { id: id(), groupId, journeyId, effective: { start: null, end: null }, scopeItemIds: [] },
    { id: id(), groupId, journeyId: memberJourneyId, effective: { start: null, end: null }, scopeItemIds: [] },
  );
  world.constraints.push(constraintRow({ kind: 'COORDINATION_GROUP', id: groupId }, 'travel_together'));
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'travel_together');
  const explanation = findExplanation(dim, 'members_share_service');
  assert.equal(explanation?.status, 'PASS');
  assert.equal(dim?.verdict, 'PASS');
});

test('group: travel_together a member on a different service FAILs members_split', () => {
  const journeyId = id();
  const travellerId = id();
  const memberJourneyId = id();
  const memberTravellerId = id();
  const groupId = id();
  const serviceId = id();
  const otherServiceId = id();
  const start = '2030-02-01T10:00:00.000Z';
  const end = '2030-02-01T12:00:00.000Z';
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId), journeyRow(memberJourneyId, memberTravellerId)] });
  world.journeyItems.push(
    transportItem(journeyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
    transportItem(memberJourneyId, { intendedWindow: window(start, end), selectedServiceId: otherServiceId }),
  );
  world.coordinationGroups.push({ id: groupId, revision: 1, name: 'g', lifecycleStatus: 'ACTIVE', effective: { start: null, end: null } });
  world.groupMemberships.push(
    { id: id(), groupId, journeyId, effective: { start: null, end: null }, scopeItemIds: [] },
    { id: id(), groupId, journeyId: memberJourneyId, effective: { start: null, end: null }, scopeItemIds: [] },
  );
  world.constraints.push(constraintRow({ kind: 'COORDINATION_GROUP', id: groupId }, 'travel_together'));
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'travel_together');
  const explanation = findExplanation(dim, 'members_split');
  assert.equal(explanation?.status, 'FAIL');
  assert.equal(dim?.verdict, 'FAIL');
});

test('group: travel_together a member without a transport item or service UNKNOWNs member_service_unknown', () => {
  const journeyId = id();
  const travellerId = id();
  const memberJourneyId = id();
  const memberTravellerId = id();
  const groupId = id();
  const serviceId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId), journeyRow(memberJourneyId, memberTravellerId)] });
  world.journeyItems.push(transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z'), selectedServiceId: serviceId }));
  // memberJourneyId has no journey items captured at all.
  world.coordinationGroups.push({ id: groupId, revision: 1, name: 'g', lifecycleStatus: 'ACTIVE', effective: { start: null, end: null } });
  world.groupMemberships.push(
    { id: id(), groupId, journeyId, effective: { start: null, end: null }, scopeItemIds: [] },
    { id: id(), groupId, journeyId: memberJourneyId, effective: { start: null, end: null }, scopeItemIds: [] },
  );
  world.constraints.push(constraintRow({ kind: 'COORDINATION_GROUP', id: groupId }, 'travel_together'));
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'travel_together');
  const explanation = findExplanation(dim, 'member_service_unknown');
  assert.equal(explanation?.status, 'UNKNOWN');
  assert.equal(dim?.verdict, 'UNKNOWN');
});

// --------------------------------------------------------------------------
// m6.group — resource_capacity
// --------------------------------------------------------------------------

test('group: resource_capacity with a null capacity UNKNOWNs capacity_unknown', () => {
  const journeyId = id();
  const travellerId = id();
  const resourceId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const item = transportItem(journeyId, { intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') });
  world.journeyItems.push(item);
  world.resources.push({ id: resourceId, revision: 1, resourceType: 'VEHICLE', locationPlaceId: null, capacity: null });
  world.resourceAssignments.push({ id: id(), activityKind: 'JOURNEY_ITEM', activityId: item.id, resourceId, quantity: 1, lifecycleStatus: 'CONFIRMED' });
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'resource_capacity');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'capacity_unknown');
});

test('group: resource_capacity overlapping usage over capacity FAILs capacity_exceeded', () => {
  const journeyId = id();
  const travellerId = id();
  const resourceId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const itemA = transportItem(journeyId, { orderKey: '010', intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') });
  const itemB = transportItem(journeyId, { orderKey: '020', intendedWindow: window('2030-02-01T11:00:00.000Z', '2030-02-01T13:00:00.000Z') }); // overlaps itemA 11:00-12:00
  world.journeyItems.push(itemA, itemB);
  world.resources.push({ id: resourceId, revision: 1, resourceType: 'VEHICLE', locationPlaceId: null, capacity: 3 });
  world.resourceAssignments.push(
    { id: id(), activityKind: 'JOURNEY_ITEM', activityId: itemA.id, resourceId, quantity: 2, lifecycleStatus: 'CONFIRMED' },
    { id: id(), activityKind: 'JOURNEY_ITEM', activityId: itemB.id, resourceId, quantity: 2, lifecycleStatus: 'CONFIRMED' },
  );
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'resource_capacity');
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'capacity_exceeded');
  assert.equal(dim?.explanations[0]?.facts.usage, 4);
});

test('group: resource_capacity usage within capacity PASSes capacity_within_limit', () => {
  const journeyId = id();
  const travellerId = id();
  const resourceId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const itemA = transportItem(journeyId, { orderKey: '010', intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T12:00:00.000Z') });
  const itemB = transportItem(journeyId, { orderKey: '020', intendedWindow: window('2030-02-01T11:00:00.000Z', '2030-02-01T13:00:00.000Z') }); // overlaps itemA 11:00-12:00
  world.journeyItems.push(itemA, itemB);
  world.resources.push({ id: resourceId, revision: 1, resourceType: 'VEHICLE', locationPlaceId: null, capacity: 4 });
  world.resourceAssignments.push(
    { id: id(), activityKind: 'JOURNEY_ITEM', activityId: itemA.id, resourceId, quantity: 2, lifecycleStatus: 'CONFIRMED' },
    { id: id(), activityKind: 'JOURNEY_ITEM', activityId: itemB.id, resourceId, quantity: 2, lifecycleStatus: 'CONFIRMED' },
  );
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'resource_capacity');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'capacity_within_limit');
  assert.equal(dim?.explanations[0]?.facts.usage, 4);
});

test('group: resource_capacity non-overlapping usages do not sum toward the peak', () => {
  const journeyId = id();
  const travellerId = id();
  const resourceId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const itemA = transportItem(journeyId, { orderKey: '010', intendedWindow: window('2030-02-01T10:00:00.000Z', '2030-02-01T11:00:00.000Z') });
  const itemB = transportItem(journeyId, { orderKey: '020', intendedWindow: window('2030-02-01T12:00:00.000Z', '2030-02-01T13:00:00.000Z') }); // no overlap with A
  world.journeyItems.push(itemA, itemB);
  world.resources.push({ id: resourceId, revision: 1, resourceType: 'VEHICLE', locationPlaceId: null, capacity: 2 });
  world.resourceAssignments.push(
    { id: id(), activityKind: 'JOURNEY_ITEM', activityId: itemA.id, resourceId, quantity: 2, lifecycleStatus: 'CONFIRMED' },
    { id: id(), activityKind: 'JOURNEY_ITEM', activityId: itemB.id, resourceId, quantity: 2, lifecycleStatus: 'CONFIRMED' },
  );
  const effective = effectiveOf(world);
  const out = groupEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'resource_capacity');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'capacity_within_limit');
  assert.equal(dim?.explanations[0]?.facts.usage, 2, 'peak usage is 2 (each non-overlapping segment alone), never the naive sum of 4');
});

// --------------------------------------------------------------------------
// m6.funding — funding
// --------------------------------------------------------------------------

test('funding: no cost allocations -> not applicable', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.applicable, false);
  assert.equal(dim?.verdict, 'UNKNOWN');
});

test('funding: an organisation payer within budget PASSes within_budget', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '500.00', currency: 'USD', valid: { start: null, end: null } });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: null, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'within_budget');
});

test('funding: over budget FAILs budget_exceeded using exact decimal arithmetic (never float drift)', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const budgetId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: budgetId, revision: 1, organisationId: orgId, amount: '30.29', currency: 'USD', valid: { start: null, end: null } });
  world.budgetCommitments.push({ id: id(), budgetId, amount: '10.10', currency: 'USD', status: 'ACTUAL' });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '20.20', currency: 'USD', fxObservationId: null, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'budget_exceeded');
  assert.equal(dim?.explanations[0]?.facts.totalCommitted, '30.30', 'exact decimal sum 10.10 + 20.20, not a binary-float artifact like 30.299999999999997');
});

test('funding: an organisation payer with no valid budget UNKNOWNs budget_missing', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: null, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'budget_missing');
});

test('funding: a different currency with no FX observation UNKNOWNs fx_missing', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '500.00', currency: 'EUR', valid: { start: null, end: null } });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: null, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'fx_missing');
});

test('funding: an expired FX observation UNKNOWNs fx_missing', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const fxId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '500.00', currency: 'EUR', valid: { start: null, end: null } });
  world.fxObservations.push({ id: fxId, baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.90', asOf: '2029-01-01T00:00:00.000Z', expiresAt: '2029-06-01T00:00:00.000Z', edition: '1' });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: fxId, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective }); // NOW = 2030-01-01, after the FX observation's expiry
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'fx_missing');
});

test('funding: a valid FX observation converts the allocation exactly into the budget currency', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const fxId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '500.00', currency: 'EUR', valid: { start: null, end: null } });
  world.fxObservations.push({ id: fxId, baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.90', asOf: '2029-12-01T00:00:00.000Z', expiresAt: null, edition: '1' });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: fxId, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'within_budget');
  assert.equal(dim?.explanations[0]?.facts.allocationAmountInBudgetCurrency, '90.00');
});

test('funding I-10: JPY zero-decimal budget converts USD allocation via shared FX seam', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const fxId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '20000', currency: 'JPY', valid: { start: null, end: null } });
  world.fxObservations.push({ id: fxId, baseCurrency: 'USD', quoteCurrency: 'JPY', rate: '150', asOf: '2029-12-01T00:00:00.000Z', expiresAt: null, edition: '1' });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: fxId, evidenceId: null });
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.facts.allocationAmountInBudgetCurrency, '15000');
});

test('funding I-10: KWD three-decimal budget uses shared FX seam (missing FX stays UNKNOWN)', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const fxId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '5.000', currency: 'KWD', valid: { start: null, end: null } });
  world.fxObservations.push({ id: fxId, baseCurrency: 'USD', quoteCurrency: 'KWD', rate: '0.30715', asOf: '2029-12-01T00:00:00.000Z', expiresAt: null, edition: '1' });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '10.00', currency: 'USD', fxObservationId: fxId, evidenceId: null });
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.facts.allocationAmountInBudgetCurrency, '3.072');

  const missing = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId: r2 } = addAllocatedReservation(missing, { travellerId });
  missing.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '5.000', currency: 'KWD', valid: { start: null, end: null } });
  missing.costAllocations.push({ id: id(), reservationId: r2, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '10.00', currency: 'USD', fxObservationId: null, evidenceId: null });
  const unknown = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world: missing, effective: effectiveOf(missing) });
  assert.equal(unknown.dimensions.find((d) => d.dimension === 'funding')?.explanations[0]?.reasonCode, 'fx_missing');
});

test('funding: a traveller payer UNKNOWNs payer_home_currency_unknown and never PASSes', () => {
  const journeyId = id();
  const travellerId = id();
  const payerTravellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: null, payerTravellerId, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: null, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'payer_home_currency_unknown');
  assert.deepEqual(dim?.explanations[0]?.uncertainty, [{ kind: 'MISSING_INPUT', code: 'payer_home_currency', subjectRef: { kind: 'TRAVELLER', id: payerTravellerId } }]);
  assert.notEqual(dim?.verdict, 'PASS');
});

test('finding: an allocation with neither payer type is not applicable, never a blocking UNKNOWN with zero explanations', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { reservationId } = addAllocatedReservation(world, { travellerId });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: null, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: null, evidenceId: null });
  const effective = effectiveOf(world);
  const out = fundingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions.find((d) => d.dimension === 'funding');
  assert.equal(dim?.applicable, false, 'a dimension() call with zero explanations is applicable:true/UNKNOWN with no reasonCode behind it — not-applicable is the honest report');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations.length, 0);
});

// --------------------------------------------------------------------------
// Determinism and composition
// --------------------------------------------------------------------------

test('determinism: evaluating the same world twice with all three L3 evaluators yields deepEqual output, and every declared dimension surfaces through assessSubject', () => {
  const journeyId = id();
  const travellerId = id();
  const memberJourneyId = id();
  const memberTravellerId = id();
  const supporterId = id();
  const supporterJourneyId = id();
  const groupId = id();
  const orgId = id();
  const serviceId = id();
  const start = '2030-02-01T10:00:00.000Z';
  const end = '2030-02-01T12:00:00.000Z';

  const world = emptyWorld({
    journeys: [
      journeyRow(journeyId, travellerId),
      journeyRow(memberJourneyId, memberTravellerId),
      journeyRow(supporterJourneyId, supporterId),
    ],
  });

  const item = transportItem(journeyId, { intendedWindow: window(start, end), selectedServiceId: serviceId });
  world.journeyItems.push(
    item,
    transportItem(memberJourneyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
    transportItem(supporterJourneyId, { intendedWindow: window(start, end), selectedServiceId: serviceId }),
  );

  // m6.group: travel_together, the member shares the reference service.
  world.coordinationGroups.push({ id: groupId, revision: 1, name: 'g', lifecycleStatus: 'ACTIVE', effective: { start: null, end: null } });
  world.groupMemberships.push(
    { id: id(), groupId, journeyId, effective: { start: null, end: null }, scopeItemIds: [] },
    { id: id(), groupId, journeyId: memberJourneyId, effective: { start: null, end: null }, scopeItemIds: [] },
  );
  world.constraints.push(constraintRow({ kind: 'COORDINATION_GROUP', id: groupId }, 'travel_together'));

  // m6.support: requirement satisfied, the supporter is co-present on the same service.
  const requirement = requirementRow(travellerId, window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'), { eligibleSupporterTravellerIds: [supporterId] });
  world.accompanimentRequirements.push(requirement);
  world.supportAssignments.push(assignmentRow(requirement.id, requirement.version, [{ supporterTravellerId: supporterId, start: requirement.coverage.start, end: requirement.coverage.end }]));

  // m6.funding: organisation payer within budget.
  const { reservationId } = addAllocatedReservation(world, { travellerId, journeyItemId: item.id });
  world.budgets.push({ id: id(), revision: 1, organisationId: orgId, amount: '1000.00', currency: 'USD', valid: { start: null, end: null } });
  world.costAllocations.push({ id: id(), reservationId, payerOrganisationId: orgId, payerTravellerId: null, entryKind: 'FARE', amount: '100.00', currency: 'USD', fxObservationId: null, evidenceId: null });

  const registry = createEvaluatorRegistry([supportEvaluator, groupEvaluator, fundingEvaluator]);
  const run = () => {
    const effective = effectiveOf(world);
    return assessSubject({ registry, world, effective, subject: subjectOf(journeyId), now: NOW, assessmentId: 'fixed-assessment-id' });
  };
  const first = run();
  const second = run();
  assert.deepEqual(first.result, second.result);

  const dimensionNames = first.result.dimensions.map((d) => d.dimension).sort();
  assert.deepEqual(dimensionNames, ['funding', 'resource_capacity', 'support_continuity', 'travel_together'].sort());
  // assessSubject itself throws if an evaluator emits a dimension name it did not declare
  // (see assess.ts), so reaching this point already proves the invariant for real output;
  // this assertion checks it directly too, against each evaluator's own declared set.
  const declared = new Set([...supportEvaluator.dimensions, ...groupEvaluator.dimensions, ...fundingEvaluator.dimensions]);
  for (const name of dimensionNames) assert.ok(declared.has(name), `${name} must be declared by some L3 evaluator's dimensions`);

  assert.equal(first.result.overallVerdict, 'PASS');
});
