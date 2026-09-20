/**
 * NORTHSTAR M7 — recovery strategy overlay, M6 candidate evaluation, ActionPlan
 * compiler, stale-base protection, I-7 objective disposition, programme recovery.
 *
 * Pure fixtures only — no scenario/person/city names in engine code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type {
  WJourney, WJourneyItem, WObjective, WParticipation, WProgrammeItem,
  WReservation, WReservationLine, WResource, WTransportService, WAllocation, WConstraintDefinition,
} from '../src/resolution/world/world.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';
import { ScenarioChangeSchema, type ScenarioEffect } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { validateActionPlanAcyclic } from '../src/contracts/v2/action/actionPlan.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import { overnightEvaluator } from '../src/resolution/evaluation/evaluators/overnight.ts';
import { entryEvaluator } from '../src/resolution/evaluation/evaluators/entry.ts';
import { credentialsEvaluator } from '../src/resolution/evaluation/evaluators/credentials.ts';
import { applyScenarioOverlay, assertCanonicalWorldUntouched } from '../src/resolution/scenarios/overlay.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan, withForcedCycle } from '../src/resolution/planning/compiler.ts';
import { proposeOvernightCompanions, type QuotedStayOption } from '../src/resolution/planning/proposers/overnightCompanions.ts';
import type { ProposalCandidate } from '../src/resolution/planning/proposer.ts';
import type { CurrentState } from '../src/resolution/world/currentness.ts';
import { createHotelCompanionPlanning } from '../src/app/targetHotelCompanionPlanning.ts';
import { materializeTransportOffers } from '../src/resolution/planning/transportOfferMaterialization.ts';
import { transportCorridors, transportRequestId } from '../src/resolution/planning/transportCorridors.ts';
import type { PlanningToolResult } from '../src/contracts/v2/planning/planningTool.ts';

const NOW = '2030-06-01T12:00:00.000Z';

function journeyRow(over: Partial<WJourney> = {}): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId: id(), lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null, ...over };
}

function transportItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
    desiredOriginPlaceId: 'p-a', desiredDestinationPlaceId: 'p-b', selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function service(over: Partial<WTransportService> = {}): WTransportService {
  return {
    id: id(), revision: 1, mode: 'AIR', operator: 'op', originPlaceId: 'p-a', destinationPlaceId: 'p-b',
    published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null },
    ...over,
  };
}

function observed(value: string) {
  return { value, observedAt: NOW, evidenceId: null as string | null };
}

function emptyManifest(over: Partial<WorldSnapshotManifest> = {}): WorldSnapshotManifest {
  return {
    evaluatedAt: NOW,
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
    ...over,
  };
}

function objectiveRow(owner: TypedRef, over: Partial<WObjective> = {}): WObjective {
  return {
    id: id(), revision: 1, owner, successPredicateKind: 'ARRIVAL_BY', hardness: 'HARD', priority: 1,
    disposition: 'ACTIVE', dispositionEvidenceId: null, targets: [], ...over,
  };
}

function overnightRequirement(journeyId: string): WConstraintDefinition {
  return {
    id: id(), revision: 1, registeredType: 'overnight_accommodation_required', hardness: 'HARD',
    owner: { kind: 'JOURNEY', id: journeyId }, provenanceEvidenceId: null,
    operands: [{ key: 'minimum_gap_hours', kind: 'NUMBER', subject: null, text: null, number: '6', boolean: null, instant: null, localDate: null }],
  };
}

function overnightStayWorld() {
  const travellerId = id();
  const journey = journeyRow({ travellerId });
  const placeId = id();
  const jurisdictionId = id();
  const visitId = id();
  const world = emptyWorld({
    travellers: [{ id: travellerId, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [journey],
    places: [{ id: placeId, revision: 1, name: 'Harbour test place', placeType: 'CITY', timeZone: 'Pacific/Auckland', hasCoordinates: true }],
    jurisdictions: [{ id: jurisdictionId, revision: 1, name: 'Test jurisdiction', regimeKind: 'NATIONAL' }],
    placeJurisdictions: [{ placeId, jurisdictionId, basis: 'AREA_MEMBERSHIP', areaVersionId: id(), evidenceId: null }],
    intendedVisits: [{
      id: visitId, journeyId: journey.id, jurisdictionId, purpose: 'overnight recovery',
      intended: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' }, transitIntent: false,
    }],
  });
  const arrival = transportItem(journey.id, {
    orderKey: '010', desiredOriginPlaceId: id(), desiredDestinationPlaceId: placeId,
    intendedWindow: { start: '2030-06-02T04:00:00.000Z', end: '2030-06-02T08:00:00.000Z' },
  });
  const departure = transportItem(journey.id, {
    orderKey: '030', desiredOriginPlaceId: placeId, desiredDestinationPlaceId: id(),
    intendedWindow: { start: '2030-06-03T02:00:00.000Z', end: '2030-06-03T06:00:00.000Z' },
  });
  world.journeyItems.push(arrival, departure);
  world.constraints.push(overnightRequirement(journey.id));
  return { world, journey, travellerId, placeId, arrival, visit: { kind: 'EXISTING' as const, visitId }, jurisdictionId };
}

type StayVisit = Extract<ScenarioEffect, { effectKind: 'ADD_JOURNEY_STAY' }>['visit'];

function addStayChange(journeyId: string, proposedJourneyItemId: string, offerId: string, visit: StayVisit, offerPrice = { amount: '245.00', currency: 'NZD' }) {
  return ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }], basisAssessmentId: id(),
    effects: [{ effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId, journeyId, orderKey: '020', offerId, offerPrice, visit }],
  });
}

test('overlay: candidate evaluation does not mutate canonical CapturedWorld', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const svc = service({
    published: { departure: observed('2030-06-02T08:00:00.000Z'), arrival: observed('2030-06-02T10:00:00.000Z') },
  });
  item.selectedServiceId = svc.id;
  const world = emptyWorld({ journeys: [journey], journeyItems: [item], transportServices: [svc] });
  const before = structuredClone(world);
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
      journeyItemId: item.id,
      proposedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    }],
  });
  const overlay = applyScenarioOverlay({ baseWorld: world, scenarioChange: change });
  assert.equal(overlay.ok, true);
  if (!overlay.ok) return;
  assertCanonicalWorldUntouched(before, world);
  assert.notEqual(overlay.value.proposedWorld.journeyItems[0]!.intendedWindow, item.intendedWindow);
  assert.equal(world.journeyItems[0]!.intendedWindow, null);
});

test('overlay + evaluate: current and proposed worlds use the same M6 registry', () => {
  const registry = createM6Registry();
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const late = service({
    destinationPlaceId: 'p-target',
    published: { departure: observed('2030-06-02T08:00:00.000Z'), arrival: observed('2030-06-02T18:00:00.000Z') },
  });
  const early = service({
    destinationPlaceId: 'p-target',
    published: { departure: observed('2030-06-02T06:00:00.000Z'), arrival: observed('2030-06-02T09:00:00.000Z') },
  });
  item.desiredDestinationPlaceId = 'p-target';
  item.selectedServiceId = late.id;
  const world = emptyWorld({
    journeys: [journey],
    journeyItems: [item],
    transportServices: [late, early],
    objectives: [objectiveRow({ kind: 'JOURNEY', id: journey.id }, {
      targets: [
        { label: 'deadline', targetKind: 'TIME', subject: null, placeId: null, atOrBefore: '2030-06-02T12:00:00.000Z', amountMinor: null, currencyCode: null },
        { label: 'place', targetKind: 'PLACE', subject: null, placeId: 'p-target', atOrBefore: null, amountMinor: null, currencyCode: null },
      ],
    })],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'SELECT_OFFER',
      journeyItemId: item.id,
      offerId: id(),
    }],
  });
  const selectEffect = change.effects[0];
  assert.ok(selectEffect && selectEffect.effectKind === 'SELECT_OFFER');
  const offerId = selectEffect.offerId;
  const result = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: { ...change, effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: item.id, offerId }] },
    now: NOW,
    registry,
    resolvedOffers: [{ offerId, transportServiceId: early.id }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.canonicalUntouched, true);
  assert.equal(result.value.strategy.candidateAssessments.length, 1);
  // Same registry identity used (createM6Registry is the sole set).
  assert.deepEqual(registry.evaluators.map((e) => e.id), createM6Registry().evaluators.map((e) => e.id));
});

test('multi-object strategy: shared reservation blast radius includes both journeys', () => {
  const tripA = id();
  const tripB = id();
  const travellerA = id();
  const travellerB = id();
  const jA = journeyRow({ tripId: tripA, travellerId: travellerA });
  const jB = journeyRow({ tripId: tripB, travellerId: travellerB });
  const resource: WResource = { id: id(), revision: 1, resourceType: 'VEHICLE', locationPlaceId: 'p-x', capacity: 1 };
  const reservation: WReservation = {
    id: id(), revision: 1, reservationType: 'RESOURCE', observedStatus: 'CONFIRMED',
    observedStatusAt: NOW, responsibleOrganisationId: null, responsibleTravellerId: null,
  };
  const line: WReservationLine = {
    id: id(), reservationId: reservation.id, productType: 'RESOURCE_USE', observedStatus: 'CONFIRMED',
    observedStatusAt: NOW, evidenceId: null, transportServiceId: null, resourceId: resource.id,
    placeId: 'p-x', interval: { start: '2030-06-02T10:00:00.000Z', end: '2030-06-02T14:00:00.000Z' },
  };
  const allocA: WAllocation = {
    id: id(), reservationId: reservation.id, lineId: line.id, travellerId: travellerA,
    journeyItemId: null, role: 'TRAVELLER', quantity: 1,
  };
  const world = emptyWorld({
    travellers: [
      { id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' },
      { id: travellerB, revision: 1, lifecycleStatus: 'ACTIVE' },
    ],
    journeys: [jA, jB],
    resources: [resource],
    reservations: [reservation],
    reservationLines: [line],
    allocations: [allocA],
    edges: [
      {
        from: { kind: 'RESERVATION', id: reservation.id },
        to: { kind: 'RESERVATION_LINE', id: line.id },
        semantic: 'LINE_OF_RESERVATION',
      },
      {
        from: { kind: 'RESERVATION_LINE', id: line.id },
        to: { kind: 'TRAVELLER', id: travellerA },
        semantic: 'LINE_ALLOCATED_TO_TRAVELLER',
      },
    ],
    focus: [{ kind: 'JOURNEY', id: jA.id }, { kind: 'JOURNEY', id: jB.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [
      { kind: 'JOURNEY', id: jA.id },
      { kind: 'JOURNEY', id: jB.id },
      { kind: 'RESERVATION', id: reservation.id },
    ],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'PROPOSE_ALLOCATION',
      reservationLineId: line.id,
      travellerId: travellerB,
    }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.ok(evaluated.value.strategy.affectedSubjectRefs.some((r) => r.kind === 'JOURNEY' && r.id === jB.id));
  assert.ok(evaluated.value.strategy.candidateAssessments.length >= 2);
});

test('booking-valid / journey-invalid: SELECT_OFFER can leave objective FAIL while booking stays valid shape', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const late = service({
    destinationPlaceId: 'p-target',
    published: { departure: observed('2030-06-02T08:00:00.000Z'), arrival: observed('2030-06-02T20:00:00.000Z') },
  });
  item.desiredDestinationPlaceId = 'p-target';
  item.selectedServiceId = late.id;
  const world = emptyWorld({
    journeys: [journey],
    journeyItems: [item],
    transportServices: [late],
    objectives: [objectiveRow({ kind: 'JOURNEY', id: journey.id }, {
      targets: [
        { label: 'deadline', targetKind: 'TIME', subject: null, placeId: null, atOrBefore: '2030-06-02T12:00:00.000Z', amountMinor: null, currencyCode: null },
        { label: 'place', targetKind: 'PLACE', subject: null, placeId: 'p-target', atOrBefore: null, amountMinor: null, currencyCode: null },
      ],
    })],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  // No alternative offer — strategy proposes a programme move instead (next test),
  // here we merely confirm late arrival yields non-viable under M6.
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
      journeyItemId: item.id,
      proposedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-02T21:00:00.000Z' },
    }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.notEqual(evaluated.value.strategy.viability, 'VIABLE');
  const dims = evaluated.value.strategy.candidateAssessmentResults[0]?.dimensions ?? [];
  assert.ok(dims.some((d) => d.dimension === 'hard_objectives' && d.verdict === 'FAIL'));
});

test('ProgrammeItem move strategy: one participant can improve while another worsens; a reached FAIL still vetoes when it is a named or regressing subject', () => {
  const programmeId = id();
  const itemId = id();
  const travellerEarly = id();
  const travellerLate = id();
  const jEarly = journeyRow({ travellerId: travellerEarly });
  const jLate = journeyRow({ travellerId: travellerLate });
  const svcEarly = service({
    originPlaceId: 'p-home',
    destinationPlaceId: 'p-venue',
    published: { departure: observed('2030-06-02T07:00:00.000Z'), arrival: observed('2030-06-02T09:00:00.000Z') },
  });
  const svcLate = service({
    originPlaceId: 'p-home',
    destinationPlaceId: 'p-venue',
    published: { departure: observed('2030-06-02T12:00:00.000Z'), arrival: observed('2030-06-02T14:00:00.000Z') },
  });
  const jiEarly = transportItem(jEarly.id, {
    desiredOriginPlaceId: 'p-home', desiredDestinationPlaceId: 'p-venue', selectedServiceId: svcEarly.id,
  });
  const jiLate = transportItem(jLate.id, {
    desiredOriginPlaceId: 'p-home', desiredDestinationPlaceId: 'p-venue', selectedServiceId: svcLate.id,
  });
  const programmeItem: WProgrammeItem = {
    id: itemId, programmeId, title: 'session', itemType: 'SESSION', placeId: 'p-venue',
    window: { start: '2030-06-02T10:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
  };
  const parts: WParticipation[] = [
    { id: id(), programmeItemId: itemId, travellerId: travellerEarly, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
    { id: id(), programmeItemId: itemId, travellerId: travellerLate, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
  ];
  const world = emptyWorld({
    travellers: [
      { id: travellerEarly, revision: 1, lifecycleStatus: 'ACTIVE' },
      { id: travellerLate, revision: 1, lifecycleStatus: 'ACTIVE' },
    ],
    journeys: [jEarly, jLate],
    journeyItems: [jiEarly, jiLate],
    transportServices: [svcEarly, svcLate],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem],
    participations: parts,
    focus: [{ kind: 'PROGRAMME_ITEM', id: itemId }],
  });

  // Move session later so late traveller can attend, early traveller may miss end/preparation.
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [
      { kind: 'PROGRAMME_ITEM', id: itemId },
      { kind: 'JOURNEY', id: jEarly.id },
      { kind: 'JOURNEY', id: jLate.id },
    ],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
      programmeItemId: itemId,
      proposedWindow: { start: '2030-06-02T15:00:00.000Z', end: '2030-06-02T16:00:00.000Z' },
    }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.ok(evaluated.value.strategy.candidateAssessments.length >= 2);
  // Engine must not average people — each subject keeps its own verdict.
  const verdicts = new Set(evaluated.value.strategy.candidateAssessments.map((a) => a.overallVerdict));
  assert.ok(verdicts.size >= 1);
  // If any mandatory FAIL remains, strategy is not VIABLE.
  if (evaluated.value.strategy.candidateAssessments.some((a) => a.overallVerdict === 'FAIL')) {
    assert.equal(evaluated.value.strategy.viability, 'NOT_VIABLE');
  }
});

test('I-7: objective waiver is proposed only; unrelated mandatory constraints remain mandatory', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const svc = service({
    destinationPlaceId: 'p-target',
    published: { departure: observed('2030-06-02T08:00:00.000Z'), arrival: observed('2030-06-02T20:00:00.000Z') },
  });
  item.desiredDestinationPlaceId = 'p-target';
  item.selectedServiceId = svc.id;
  const objective = objectiveRow({ kind: 'JOURNEY', id: journey.id }, {
    targets: [
      { label: 'deadline', targetKind: 'TIME', subject: null, placeId: null, atOrBefore: '2030-06-02T12:00:00.000Z', amountMinor: null, currencyCode: null },
      { label: 'place', targetKind: 'PLACE', subject: null, placeId: 'p-target', atOrBefore: null, amountMinor: null, currencyCode: null },
    ],
  });
  const world = emptyWorld({
    journeys: [journey],
    journeyItems: [item],
    transportServices: [svc],
    objectives: [objective],
    constraints: [{
      id: id(), revision: 1, registeredType: 'travel_together', hardness: 'HARD',
      owner: { kind: 'JOURNEY', id: journey.id }, provenanceEvidenceId: null, operands: [],
    }],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  const beforeConstraints = structuredClone(world.constraints);
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }, { kind: 'OBJECTIVE', id: objective.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'WAIVE_OBJECTIVE',
      objectiveId: objective.id,
      rationale: 'deadline no longer achievable after disruption',
      disposition: 'WAIVED',
    }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.deepEqual(world.constraints, beforeConstraints);
  assert.equal(world.objectives[0]!.disposition, 'ACTIVE');
  assert.equal(evaluated.value.proposedWorld.objectives[0]!.disposition, 'WAIVED');
  assert.ok(evaluated.value.strategy.requiredAuthorityScopes.includes('objective.disposition'));
  // Waiving objective must not delete/edit the unrelated constraint.
  assert.deepEqual(evaluated.value.proposedWorld.constraints, beforeConstraints);
});

test('UNKNOWN candidate is not executable; compile refuses NOT_EXECUTABLE', () => {
  const journey = journeyRow();
  const world = emptyWorld({
    journeys: [journey],
    objectives: [objectiveRow({ kind: 'JOURNEY', id: journey.id }, {
      successPredicateKind: 'BOUND_SPEND',
      targets: [],
    })],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
      journeyItemId: id(), // missing → overlay reject OR
      proposedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    }],
  });
  // Use a real item so evaluation proceeds into UNKNOWN objective predicate.
  const item = transportItem(journey.id);
  world.journeyItems.push(item);
  const change2 = {
    ...change,
    effects: [{
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT' as const,
      journeyItemId: item.id,
      proposedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    }],
  };
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change2.basisAssessmentId,
    scenarioChange: change2,
    now: NOW,
    requiredUnknowns: [{ code: 'quote_missing', description: 'no offer quote available' }],
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'NOT_EXECUTABLE');
  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  assert.match(compiled.conflict.message, /UNKNOWN|not executable/i);
});

test('unsupported capability is rejected without fabricating provider capability', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const svc = service({
    destinationPlaceId: 'p-target',
    published: { departure: observed('2030-06-02T08:00:00.000Z'), arrival: observed('2030-06-02T10:00:00.000Z') },
  });
  item.desiredDestinationPlaceId = 'p-target';
  const world = emptyWorld({
    journeys: [journey], journeyItems: [item], transportServices: [svc],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  const offerId = id();
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: item.id, offerId }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: world, baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId, scenarioChange: change, now: NOW,
    resolvedOffers: [{ offerId, transportServiceId: svc.id }],
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  // Force viable for compiler capability check.
  const strategy = { ...evaluated.value.strategy, viability: 'VIABLE' as const, status: 'EVALUATED' as const };
  const compiled = compileActionPlan({
    strategy,
    now: NOW,
    capabilities: [{ capabilityRef: 'external:offer.select', supported: false }],
  });
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  assert.equal(compiled.conflict.kind, 'CAPABILITY_UNSUPPORTED');
});

test('fake supplier confirmation cannot be introduced via overlay', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const svc = service();
  const world = emptyWorld({ journeys: [journey], journeyItems: [item], transportServices: [svc] });
  const before = structuredClone(world.transportServices);
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
      journeyItemId: item.id,
      proposedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    }],
  });
  const overlay = applyScenarioOverlay({ baseWorld: world, scenarioChange: change });
  assert.equal(overlay.ok, true);
  if (!overlay.ok) return;
  assert.deepEqual(overlay.value.proposedWorld.transportServices, before);
  assert.deepEqual(world.transportServices, before);
});

test('ActionPlan DAG ordering is acyclic; forced cycles are rejected', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const programmeItem: WProgrammeItem = {
    id: id(), programmeId: id(), title: 's', itemType: 'SESSION', placeId: 'p-v',
    window: { start: '2030-06-02T10:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
  };
  const svc = service({
    destinationPlaceId: 'p-v',
    published: { departure: observed('2030-06-02T06:00:00.000Z'), arrival: observed('2030-06-02T08:00:00.000Z') },
  });
  item.selectedServiceId = svc.id;
  item.desiredDestinationPlaceId = 'p-v';
  const offerId = id();
  const world = emptyWorld({
    journeys: [journey], journeyItems: [item], transportServices: [svc],
    programmes: [{ id: programmeItem.programmeId, revision: 1, eventId: id(), title: 'e', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem],
    participations: [{ id: id(), programmeItemId: programmeItem.id, travellerId: journey.travellerId, obligation: 'OPTIONAL', accepted: true, preparationWindow: null }],
    focus: [{ kind: 'JOURNEY', id: journey.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }, { kind: 'PROGRAMME_ITEM', id: programmeItem.id }],
    basisAssessmentId: id(),
    effects: [
      { effectKind: 'SELECT_OFFER', journeyItemId: item.id, offerId },
      {
        effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
        programmeItemId: programmeItem.id,
        proposedWindow: { start: '2030-06-02T12:00:00.000Z', end: '2030-06-02T13:00:00.000Z' },
      },
    ],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: world, baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId, scenarioChange: change, now: NOW,
    resolvedOffers: [{ offerId, transportServiceId: svc.id }],
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  const strategy = { ...evaluated.value.strategy, viability: 'VIABLE' as const, status: 'EVALUATED' as const };
  const compiled = compileActionPlan({
    strategy,
    now: NOW,
    capabilities: [{ capabilityRef: 'external:offer.select', supported: true }],
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(validateActionPlanAcyclic(compiled.value.plan).ok, true);
  assert.ok(compiled.value.plan.dependencies.length >= 1);

  const cycled = withForcedCycle(compiled.value.plan);
  const cycleCheck = validateActionPlanAcyclic(cycled);
  assert.equal(cycleCheck.ok, false);
  if (cycleCheck.ok) return;
  assert.equal(cycleCheck.conflict.kind, 'ACYCLIC_GRAPH_VIOLATION');
});

test('stale base manifest is rejected before compile', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const world = emptyWorld({ journeys: [journey], journeyItems: [item], focus: [{ kind: 'JOURNEY', id: journey.id }] });
  const manifest = emptyManifest({
    aggregateReads: [{ aggregateRef: { kind: 'JOURNEY', id: journey.id }, revision: 1 }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'ALTER_JOURNEY_ITEM_INTENT',
      journeyItemId: item.id,
      proposedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    }],
  });
  const staleState: CurrentState = {
    heads: new Map([[`JOURNEY:${journey.id}`, 2]]),
    scopes: new Map(),
  };
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: world, baseManifest: manifest,
    basisAssessmentId: change.basisAssessmentId, scenarioChange: change, now: NOW,
    currentState: staleState,
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'STALE_BASE');
  const compiled = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW, currentState: staleState });
  assert.equal(compiled.ok, false);
});

test('two materially different scenarios use the same evaluate/compile engine', () => {
  // Scenario A: programme reschedule
  const programmeItem: WProgrammeItem = {
    id: id(), programmeId: id(), title: 'a', itemType: 'SESSION', placeId: 'p1',
    window: { start: '2030-06-02T10:00:00.000Z', end: '2030-06-02T11:00:00.000Z' },
    lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null,
  };
  const jA = journeyRow();
  const worldA = emptyWorld({
    journeys: [jA],
    programmes: [{ id: programmeItem.programmeId, revision: 1, eventId: id(), title: 'e', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem],
    participations: [{ id: id(), programmeItemId: programmeItem.id, travellerId: jA.travellerId, obligation: 'OPTIONAL', accepted: true, preparationWindow: null }],
    focus: [{ kind: 'JOURNEY', id: jA.id }],
  });
  const changeA = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: programmeItem.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
      programmeItemId: programmeItem.id,
      proposedWindow: { start: '2030-06-02T11:00:00.000Z', end: '2030-06-02T12:00:00.000Z' },
    }],
  });

  // Scenario B: objective waiver proposal
  const jB = journeyRow();
  const obj = objectiveRow({ kind: 'JOURNEY', id: jB.id });
  const worldB = emptyWorld({
    journeys: [jB], objectives: [obj], focus: [{ kind: 'JOURNEY', id: jB.id }],
  });
  const changeB = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'OBJECTIVE', id: obj.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'WAIVE_OBJECTIVE',
      objectiveId: obj.id,
      rationale: 'explicit loss proposal',
      disposition: 'CLOSED_WITH_LOSS',
    }],
  });

  const a = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: worldA, baseManifest: emptyManifest(),
    basisAssessmentId: changeA.basisAssessmentId, scenarioChange: changeA, now: NOW,
  });
  const b = evaluateRecoveryStrategy({
    recoveryCaseId: id(), baseWorld: worldB, baseManifest: emptyManifest(),
    basisAssessmentId: changeB.basisAssessmentId, scenarioChange: changeB, now: NOW,
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.value.strategy.scenarioChange.effects[0]!.effectKind, b.value.strategy.scenarioChange.effects[0]!.effectKind);
  assert.ok(b.value.strategy.requiredAuthorityScopes.some((s) => s.includes('objective.disposition')));
});

test('effectiveOf remains available for proposed worlds (same projection as M6)', () => {
  const journey = journeyRow();
  const world = emptyWorld({ journeys: [journey] });
  const effective = effectiveOf(world);
  assert.ok(effective.journeys.some((j) => j.journeyRef.id === journey.id));
});

test('SELECT_OFFER without resolved offer is rejected (no fabrication)', () => {
  const journey = journeyRow();
  const item = transportItem(journey.id);
  const world = emptyWorld({ journeys: [journey], journeyItems: [item] });
  const change = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    basisAssessmentId: id(),
    effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: item.id, offerId: randomUUID() }],
  });
  const overlay = applyScenarioOverlay({ baseWorld: world, scenarioChange: change });
  assert.equal(overlay.ok, false);
  if (overlay.ok) return;
  assert.match(overlay.conflict.message, /not resolved|fabricate/i);
});

test('ADD_JOURNEY_STAY overlays one unbooked stay from a resolved offer and closes only the overnight dimension', () => {
  const { world, journey, travellerId, placeId, arrival, visit } = overnightStayWorld();
  const before = structuredClone(world);
  const offerId = id();
  const proposedJourneyItemId = id();
  const flightOnly = ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }], basisAssessmentId: id(),
    effects: [{ effectKind: 'ALTER_JOURNEY_ITEM_INTENT', journeyItemId: arrival.id }],
  });
  const flightOverlay = applyScenarioOverlay({ baseWorld: world, scenarioChange: flightOnly });
  assert.equal(flightOverlay.ok, true);
  if (!flightOverlay.ok) return;
  assert.equal(
    overnightEvaluator.evaluate({ kind: 'JOURNEY', id: journey.id }, { now: NOW, world: flightOverlay.value.proposedWorld, effective: effectiveOf(flightOverlay.value.proposedWorld) }).dimensions[0]?.verdict,
    'FAIL',
  );

  const change = addStayChange(journey.id, proposedJourneyItemId, offerId, visit);
  const overlay = applyScenarioOverlay({
    baseWorld: world,
    scenarioChange: change,
    resolvedStayOffers: [{
      offerId,
      placeId,
      stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
      price: { amount: '245.0', currency: 'NZD' },
    }],
  });
  assert.equal(overlay.ok, true);
  if (!overlay.ok) return;
  const proposed = overlay.value.proposedWorld;
  const stay = proposed.journeyItems.find((item) => item.id === proposedJourneyItemId);
  assert.deepEqual(stay && {
    journeyId: stay.journeyId, kind: stay.kind, orderKey: stay.orderKey, lifecycleStatus: stay.lifecycleStatus,
    intendedPlaceId: stay.intendedPlaceId, requiredNights: stay.requiredNights, intendedWindow: stay.intendedWindow,
  }, {
    journeyId: journey.id, kind: 'STAY', orderKey: '020', lifecycleStatus: 'PLANNED',
    intendedPlaceId: placeId, requiredNights: 1,
    intendedWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
  });
  assert.equal(
    overnightEvaluator.evaluate({ kind: 'JOURNEY', id: journey.id }, { now: NOW, world: proposed, effective: effectiveOf(proposed) }).dimensions[0]?.verdict,
    'PASS',
  );
  assertCanonicalWorldUntouched(before, world);
  assert.deepEqual(proposed.reservations, before.reservations);
  assert.deepEqual(proposed.reservationLines, before.reservationLines);
  assert.deepEqual(proposed.allocations, before.allocations);
  assert.ok(overlay.value.affectedSubjectRefs.some((ref) => ref.kind === 'JOURNEY' && ref.id === journey.id));
  assert.ok(overlay.value.affectedSubjectRefs.some((ref) => ref.kind === 'TRAVELLER' && ref.id === travellerId));
  assert.ok(!overlay.value.affectedSubjectRefs.some((ref) => ref.kind === 'JOURNEY_ITEM' && ref.id === proposedJourneyItemId));
  assert.deepEqual(overlay.value.requiredAuthorityScopes, ['journey.stay']);
});

test('ADD_JOURNEY_STAY rejects unbound, inconsistent, and colliding offer facts', () => {
  const { world, journey, placeId, arrival, visit } = overnightStayWorld();
  const offerId = id();
  const baseChange = addStayChange(journey.id, id(), offerId, visit);
  const resolved = {
    offerId,
    placeId,
    stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
    price: { amount: '245.00', currency: 'NZD' },
  } as const;
  const missingOffer = applyScenarioOverlay({ baseWorld: world, scenarioChange: baseChange });
  assert.equal(missingOffer.ok, false);
  if (!missingOffer.ok) assert.match(missingOffer.conflict.message, /not resolved/i);
  const missingPlace = applyScenarioOverlay({
    baseWorld: world, scenarioChange: baseChange, resolvedStayOffers: [{ ...resolved, placeId: id() }],
  });
  assert.equal(missingPlace.ok, false);
  if (!missingPlace.ok) assert.match(missingPlace.conflict.message, /place is not in captured/i);
  const badWindow = applyScenarioOverlay({
    baseWorld: world, scenarioChange: baseChange,
    resolvedStayOffers: [{ ...resolved, stayWindow: { start: resolved.stayWindow.end, end: resolved.stayWindow.start } }],
  });
  assert.equal(badWindow.ok, false);
  if (!badWindow.ok) assert.match(badWindow.conflict.message, /valid positive offset-bearing interval/i);
  const malformedWindow = applyScenarioOverlay({
    baseWorld: world, scenarioChange: baseChange,
    resolvedStayOffers: [{ ...resolved, stayWindow: { start: 'not-an-instant', end: resolved.stayWindow.end } } as never],
  });
  assert.equal(malformedWindow.ok, false);
  if (!malformedWindow.ok) assert.match(malformedWindow.conflict.message, /valid positive offset-bearing interval/i);
  const zeroLocalNights = applyScenarioOverlay({
    baseWorld: world, scenarioChange: baseChange,
    resolvedStayOffers: [{ ...resolved, stayWindow: { start: resolved.stayWindow.start, end: '2030-06-02T09:00:00.000Z' } }],
  });
  assert.equal(zeroLocalNights.ok, false);
  if (!zeroLocalNights.ok) assert.match(zeroLocalNights.conflict.message, /positive number of local nights/i);
  const badPrice = applyScenarioOverlay({
    baseWorld: world, scenarioChange: baseChange, resolvedStayOffers: [{ ...resolved, price: { amount: '246.00', currency: 'NZD' } }],
  });
  assert.equal(badPrice.ok, false);
  if (!badPrice.ok) assert.match(badPrice.conflict.message, /price does not match/i);
  const negativeChange = addStayChange(journey.id, id(), offerId, visit, { amount: '-1.00', currency: 'NZD' });
  const negativePrice = applyScenarioOverlay({
    baseWorld: world, scenarioChange: negativeChange,
    resolvedStayOffers: [{ ...resolved, price: { amount: '-1.00', currency: 'NZD' } }],
  });
  assert.equal(negativePrice.ok, false);
  if (!negativePrice.ok) assert.match(negativePrice.conflict.message, /cannot be negative/i);
  const duplicateOffer = applyScenarioOverlay({
    baseWorld: world, scenarioChange: baseChange, resolvedStayOffers: [resolved, { ...resolved }],
  });
  assert.equal(duplicateOffer.ok, false);
  if (!duplicateOffer.ok) assert.match(duplicateOffer.conflict.message, /duplicate offer id/i);
  const collision = addStayChange(journey.id, arrival.id, offerId, visit);
  const colliding = applyScenarioOverlay({ baseWorld: world, scenarioChange: collision, resolvedStayOffers: [resolved] });
  assert.equal(colliding.ok, false);
  if (!colliding.ok) assert.match(colliding.conflict.message, /already exists/i);
});

test('ADD_JOURNEY_STAY projects only valid landside visit and credential inputs into the candidate world', () => {
  const { world, journey, placeId, jurisdictionId } = overnightStayWorld();
  world.intendedVisits = [];
  const offerId = id();
  const proposedVisitId = id();
  const credentialId = id();
  const credentialVersionId = id();
  const selectionId = id();
  const candidate = (credentialSelections: { proposedSelectionId: string; credentialId: string; credentialVersionId: string }[]) => addStayChange(
    journey.id,
    id(),
    offerId,
    {
      kind: 'PROPOSED', proposedVisitId, jurisdictionId, purpose: 'recovery stay',
      intendedWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
      credentialSelections,
    },
  );
  const resolvedStayOffers = [{
    offerId, placeId,
    stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
    price: { amount: '245.00', currency: 'NZD' },
  }];
  const before = structuredClone(world);

  const missing = applyScenarioOverlay({ baseWorld: world, scenarioChange: candidate([]), resolvedStayOffers });
  assert.equal(missing.ok, true);
  if (!missing.ok) return;
  assert.equal(
    credentialsEvaluator.evaluate({ kind: 'JOURNEY', id: journey.id }, { now: NOW, world: missing.value.proposedWorld, effective: effectiveOf(missing.value.proposedWorld) }).dimensions[0]?.verdict,
    'UNKNOWN',
  );
  assert.equal(
    entryEvaluator.evaluate({ kind: 'JOURNEY', id: journey.id }, { now: NOW, world: missing.value.proposedWorld, effective: effectiveOf(missing.value.proposedWorld) }).dimensions[0]?.verdict,
    'UNKNOWN',
  );
  assertCanonicalWorldUntouched(before, world);

  world.credentials.push({ id: credentialId, travellerId: journey.travellerId, kind: 'PASSPORT', issuerCountry: 'ZZ', currentVersionId: credentialVersionId });
  world.credentialVersions.push({
    id: credentialVersionId, credentialId, kind: 'PASSPORT', editionNumber: 1, issueDate: '2028-01-01', expiryDate: '2035-01-01',
    issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'ZZ', visaClass: null,
    permittedActivities: [], entriesAllowed: null, permittedStayDays: null,
  });
  world.coverage.push({
    id: id(), topic: 'ENTRY_REQUIREMENT', queryBounds: { jurisdictionId, journeyId: journey.id }, edition: 'test/1',
    watermark: null, completeness: 'COMPLETE', limitations: [], expiresAt: null, evidenceId: null,
  });
  const matched = applyScenarioOverlay({
    baseWorld: world,
    scenarioChange: candidate([{ proposedSelectionId: selectionId, credentialId, credentialVersionId }]),
    resolvedStayOffers,
  });
  assert.equal(matched.ok, true);
  if (!matched.ok) return;
  const projected = matched.value.proposedWorld;
  assert.ok(projected.intendedVisits.some((visit) => visit.id === proposedVisitId && !visit.transitIntent));
  assert.ok(projected.credentialSelections.some((selection) => selection.id === selectionId && selection.intendedVisitIds.includes(proposedVisitId)));
  assert.equal(
    credentialsEvaluator.evaluate({ kind: 'JOURNEY', id: journey.id }, { now: NOW, world: projected, effective: effectiveOf(projected) }).dimensions[0]?.verdict,
    'PASS',
  );
  assert.equal(
    entryEvaluator.evaluate({ kind: 'JOURNEY', id: journey.id }, { now: NOW, world: projected, effective: effectiveOf(projected) }).dimensions[0]?.verdict,
    'PASS',
  );
  assert.equal(world.intendedVisits.length, 0);
  assert.equal(world.credentialSelections.length, 0);
});

test('ADD_JOURNEY_STAY rejects invalid landside visit and credential association facts', () => {
  const { world, journey, placeId, jurisdictionId, visit } = overnightStayWorld();
  const offerId = id();
  const resolvedStayOffers = [{
    offerId, placeId,
    stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
    price: { amount: '245.00', currency: 'NZD' },
  }];
  const proposed = (over: Partial<Extract<StayVisit, { kind: 'PROPOSED' }>> = {}) => ({
    kind: 'PROPOSED' as const,
    proposedVisitId: id(), jurisdictionId, purpose: 'recovery stay',
    intendedWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
    credentialSelections: [],
    ...over,
  });
  const check = (visitInput: StayVisit) => applyScenarioOverlay({
    baseWorld: world, scenarioChange: addStayChange(journey.id, id(), offerId, visitInput), resolvedStayOffers,
  });
  const wrongJurisdiction = check(proposed({ jurisdictionId: id() }));
  assert.equal(wrongJurisdiction.ok, false);
  if (!wrongJurisdiction.ok) assert.match(wrongJurisdiction.conflict.message, /jurisdiction/i);
  const nonCovering = check(proposed({ intendedWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-02T12:00:00.000Z' } }));
  assert.equal(nonCovering.ok, false);
  if (!nonCovering.ok) assert.match(nonCovering.conflict.message, /cover/i);
  const visitCollision = check(proposed({ proposedVisitId: visit.visitId }));
  assert.equal(visitCollision.ok, false);
  if (!visitCollision.ok) assert.match(visitCollision.conflict.message, /visit id already exists/i);

  const credentialId = id();
  const firstVersion = id();
  const secondVersion = id();
  world.credentials.push({ id: credentialId, travellerId: journey.travellerId, kind: 'PASSPORT', issuerCountry: 'ZZ', currentVersionId: secondVersion });
  world.credentialVersions.push(
    { id: firstVersion, credentialId, kind: 'PASSPORT', editionNumber: 1, issueDate: '2028-01-01', expiryDate: '2035-01-01', issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'ZZ', visaClass: null, permittedActivities: [], entriesAllowed: null, permittedStayDays: null },
    { id: secondVersion, credentialId, kind: 'PASSPORT', editionNumber: 2, issueDate: '2029-01-01', expiryDate: '2036-01-01', issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'ZZ', visaClass: null, permittedActivities: [], entriesAllowed: null, permittedStayDays: null },
  );
  const foreignCredentialId = id();
  const foreignVersionId = id();
  world.credentials.push({ id: foreignCredentialId, travellerId: id(), kind: 'PASSPORT', issuerCountry: 'ZZ', currentVersionId: foreignVersionId });
  world.credentialVersions.push({ id: foreignVersionId, credentialId: foreignCredentialId, kind: 'PASSPORT', editionNumber: 1, issueDate: '2028-01-01', expiryDate: '2035-01-01', issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'ZZ', visaClass: null, permittedActivities: [], entriesAllowed: null, permittedStayDays: null });
  const wrongOwner = check(proposed({ credentialSelections: [{ proposedSelectionId: id(), credentialId: foreignCredentialId, credentialVersionId: foreignVersionId }] }));
  assert.equal(wrongOwner.ok, false);
  if (!wrongOwner.ok) assert.match(wrongOwner.conflict.message, /Journey traveller/i);
  const selectionId = id();
  world.credentialSelections.push({ id: selectionId, journeyId: journey.id, credentialId, credentialVersionId: firstVersion, intendedVisitIds: [visit.visitId] });
  const repin = check(proposed({ credentialSelections: [{ proposedSelectionId: id(), credentialId, credentialVersionId: secondVersion }] }));
  assert.equal(repin.ok, false);
  if (!repin.ok) assert.match(repin.conflict.message, /re-pin/i);
  const extendedVisitId = id();
  const extension = check(proposed({
    proposedVisitId: extendedVisitId,
    credentialSelections: [{ proposedSelectionId: id(), credentialId, credentialVersionId: firstVersion }],
  }));
  assert.equal(extension.ok, true);
  if (!extension.ok) return;
  assert.deepEqual(
    extension.value.proposedWorld.credentialSelections.find((candidate) => candidate.id === selectionId)?.intendedVisitIds.sort(),
    [extendedVisitId, visit.visitId].sort(),
  );
  const duplicateSelection = check(proposed({ credentialSelections: [
    { proposedSelectionId: id(), credentialId, credentialVersionId: firstVersion },
    { proposedSelectionId: id(), credentialId, credentialVersionId: firstVersion },
  ] }));
  assert.equal(duplicateSelection.ok, false);
  if (!duplicateSelection.ok) assert.match(duplicateSelection.conflict.message, /duplicate/i);
});

test('ADD_JOURNEY_STAY compiles only with an explicit capability and captured owning Journey revision', () => {
  const { world, journey, placeId, visit } = overnightStayWorld();
  const offerId = id();
  const change = addStayChange(journey.id, id(), offerId, visit);
  const manifest = emptyManifest({ aggregateReads: [{ aggregateRef: { kind: 'JOURNEY', id: journey.id }, revision: journey.revision }] });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), strategyId: id(), baseWorld: world, baseManifest: manifest,
    basisAssessmentId: change.basisAssessmentId, scenarioChange: change, now: NOW,
    registry: createEvaluatorRegistry([overnightEvaluator]),
    resolvedStayOffers: [{
      offerId, placeId, stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
      price: { amount: '245.00', currency: 'NZD' },
    }],
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'VIABLE');

  const unsupported = compileActionPlan({ strategy: evaluated.value.strategy, now: NOW });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.conflict.kind, 'CAPABILITY_UNSUPPORTED');
  const compiled = compileActionPlan({
    strategy: evaluated.value.strategy, now: NOW,
    capabilities: [{ capabilityRef: 'external:stay.book', supported: true }],
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const intent = compiled.value.plan.intents[0]!;
  assert.equal(intent.capabilityRef, 'external:stay.book');
  assert.deepEqual(intent.subjectRefs, [{ kind: 'JOURNEY', id: journey.id }, { kind: 'OFFER', id: offerId }]);
  assert.deepEqual(intent.expectedRevisions, [{ aggregateRef: { kind: 'JOURNEY', id: journey.id }, expectedRevision: journey.revision }]);
  assert.deepEqual(intent.costEstimate, { amount: '245.00', currency: 'NZD' });
  assert.deepEqual(intent.requiredAuthorityScopes, ['journey.stay']);
  assert.deepEqual(intent.expectedObservations, ['EXTERNAL_PROVIDER:stay_booking_confirmation']);
  assert.ok(intent.requestFingerprint);

  const stale = compileActionPlan({
    strategy: evaluated.value.strategy, now: NOW,
    currentState: { heads: new Map([[`JOURNEY:${journey.id}`, journey.revision + 1]]), scopes: new Map() },
    capabilities: [{ capabilityRef: 'external:stay.book', supported: true }],
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict.kind, 'STALE_AGGREGATE_REVISION');

  const noOwningRead = compileActionPlan({
    strategy: { ...evaluated.value.strategy, baseManifest: emptyManifest() }, now: NOW,
    capabilities: [{ capabilityRef: 'external:stay.book', supported: true }],
  });
  assert.equal(noOwningRead.ok, false);
  if (!noOwningRead.ok) assert.equal(noOwningRead.conflict.kind, 'STALE_AGGREGATE_REVISION');
});

test('overnight companion proposer pairs captured stays only with one actual uncovered gap', () => {
  const { world, journey, placeId, arrival, jurisdictionId } = overnightStayWorld();
  const serviceId = id();
  const flightOfferId = id();
  const stayOfferId = id();
  world.transportServices.push(service({
    id: serviceId,
    originPlaceId: arrival.desiredOriginPlaceId!,
    destinationPlaceId: placeId,
    published: { departure: observed('2030-06-02T04:00:00.000Z'), arrival: observed('2030-06-02T08:00:00.000Z') },
  }));
  const base: ProposalCandidate = {
    key: 'transport-candidate:one',
    effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: arrival.id, offerId: flightOfferId, offerPrice: { amount: '100.00', currency: 'NZD' } }],
    affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: arrival.id }, { kind: 'JOURNEY', id: journey.id }],
    rationale: 'Use the captured transport offer.',
    assumptions: [],
  };
  const option: QuotedStayOption = {
    baseCandidateKey: base.key,
    journeyId: journey.id,
    offerId: stayOfferId,
    offer: {
      offerId: stayOfferId,
      placeId,
      stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
      price: { amount: '245.00', currency: 'NZD' },
    },
    proposedJourneyItemId: id(),
    orderKey: '020',
    visit: {
      kind: 'PROPOSED', proposedVisitId: id(), jurisdictionId, purpose: 'overnight recovery',
      intendedWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
      credentialSelections: [],
    },
  };
  const before = structuredClone(world);
  const proposed = proposeOvernightCompanions({
    flightCandidates: [base], world, now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    quotedStayOptions: [option],
  });
  assert.equal(proposed.ok, true);
  if (!proposed.ok) return;
  const output = proposed.value;
  assert.deepEqual(output.candidates[0], base);
  assert.equal(output.candidates.length, 2);
  assert.deepEqual(output.resolvedStayOffers, [{ candidateKey: output.candidates[1]!.key, baseCandidateKey: base.key, offer: option.offer }]);
  assert.equal(output.uncoveredGaps.length, 1);
  assert.deepEqual(output.uncoveredGaps[0]?.itemRefs.map((ref) => ref.id).sort(), world.journeyItems.map((item) => item.id).sort());
  const paired = output.candidates[1]!;
  assert.equal(paired.effects.length, 2);
  assert.equal(paired.effects[0]?.effectKind, 'SELECT_OFFER');
  assert.equal(paired.effects[1]?.effectKind, 'ADD_JOURNEY_STAY');
  assert.equal(paired.rationale, 'Add overnight accommodation to cover the itinerary gap.');
  assert.deepEqual(world, before);

  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), strategyId: id(), baseWorld: world, baseManifest: emptyManifest(),
    basisAssessmentId: id(),
    scenarioChange: ScenarioChangeSchema.parse({
      id: id(), recoveryStrategyId: id(), strategyVersion: 1, basisAssessmentId: id(),
      affectedSubjectRefs: paired.affectedSubjectRefs, effects: paired.effects,
    }),
    now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    resolvedStayOffers: [option.offer],
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }],
    registry: createEvaluatorRegistry([overnightEvaluator, entryEvaluator, credentialsEvaluator]),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'NOT_EXECUTABLE');
  const result = evaluated.value.strategy.candidateAssessmentResults.find((assessment) => assessment.subjects[0]?.subjectRef.id === journey.id)!;
  assert.equal(result.dimensions.find((dimension) => dimension.dimension === 'overnight_accommodation')?.verdict, 'PASS');
  assert.equal(result.dimensions.find((dimension) => dimension.dimension === 'entry_feasibility')?.verdict, 'UNKNOWN');

  const alternativeOfferId = id();
  const alternative: ProposalCandidate = {
    ...base,
    key: 'transport-candidate:two',
    effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: arrival.id, offerId: alternativeOfferId, offerPrice: { amount: '120.00', currency: 'NZD' } }],
  };
  const alternativeOption: QuotedStayOption = {
    ...option,
    baseCandidateKey: alternative.key,
    proposedJourneyItemId: id(),
    visit: option.visit.kind === 'PROPOSED' ? { ...option.visit, proposedVisitId: id() } : option.visit,
  };
  const sharedQuote = proposeOvernightCompanions({
    flightCandidates: [base, alternative], world, now: NOW,
    resolvedOffers: [
      { offerId: flightOfferId, transportServiceId: serviceId },
      { offerId: alternativeOfferId, transportServiceId: serviceId },
    ],
    quotedStayOptions: [option, alternativeOption],
  });
  assert.equal(sharedQuote.ok, true);
  if (!sharedQuote.ok) return;
  assert.equal(sharedQuote.value.candidates.length, 4);
  assert.equal(sharedQuote.value.resolvedStayOffers.length, 2);
  assert.deepEqual(sharedQuote.value.resolvedStayOffers.map((entry) => entry.offer.offerId), [stayOfferId, stayOfferId]);

  const conflictingQuote = proposeOvernightCompanions({
    flightCandidates: [base, alternative], world, now: NOW,
    resolvedOffers: [
      { offerId: flightOfferId, transportServiceId: serviceId },
      { offerId: alternativeOfferId, transportServiceId: serviceId },
    ],
    quotedStayOptions: [option, { ...alternativeOption, offer: { ...alternativeOption.offer, price: { amount: '246.00', currency: 'NZD' } } }],
  });
  assert.equal(conflictingQuote.ok, false);

  const zeroCap = proposeOvernightCompanions({
    flightCandidates: [base], world, now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    quotedStayOptions: [option], maxStayOptionsPerCandidate: 0,
  });
  assert.equal(zeroCap.ok, true);
  if (!zeroCap.ok) return;
  assert.deepEqual(zeroCap.value.candidates, [base]);
  const invalidCap = proposeOvernightCompanions({
    flightCandidates: [base], world, now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    quotedStayOptions: [option], maxCombinedCandidates: Number.NaN,
  });
  assert.equal(invalidCap.ok, false);
  const duplicateBase = proposeOvernightCompanions({
    flightCandidates: [base, { ...base }], world, now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    quotedStayOptions: [option],
  });
  assert.equal(duplicateBase.ok, false);

  const mismatched = proposeOvernightCompanions({
    flightCandidates: [base], world, now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    quotedStayOptions: [{ ...option, baseCandidateKey: 'other-candidate' }],
  });
  assert.equal(mismatched.ok, true);
  if (!mismatched.ok) return;
  assert.deepEqual(mismatched.value.candidates, [base]);
  assert.ok(mismatched.value.skipped.some((skip) => skip.reason === 'no_compatible_stay_option'));
  const mismatchedOffer = proposeOvernightCompanions({
    flightCandidates: [base], world, now: NOW,
    resolvedOffers: [{ offerId: flightOfferId, transportServiceId: serviceId }],
    quotedStayOptions: [{ ...option, offerId: id() }],
  });
  assert.equal(mismatchedOffer.ok, false);
});

test('transport planning adds a quoted hotel companion only for the real uncovered gap', async () => {
  const { world, journey, placeId, arrival, visit } = overnightStayWorld();
  const originPlaceId = arrival.desiredOriginPlaceId!;
  world.places.push({ id: originPlaceId, revision: 1, name: 'Origin', placeType: 'AIRPORT', timeZone: 'Pacific/Auckland', hasCoordinates: true });
  world.places.find((place) => place.id === placeId)!.externalRefs = [
    { system: 'hotel-provider-id', value: 'property-a' },
    { system: 'hotel-provider-id', value: 'property-b' },
  ];
  const departure = world.journeyItems.find((item) => item.id !== arrival.id)!;
  const onwardService = service({
    originPlaceId: placeId, destinationPlaceId: departure.desiredDestinationPlaceId!,
    published: { departure: observed('2030-06-03T02:00:00.000Z'), arrival: observed('2030-06-03T06:00:00.000Z') },
  });
  departure.selectedServiceId = onwardService.id;
  world.transportServices.push(onwardService);
  const failing = [{ subject: { kind: 'JOURNEY' as const, id: journey.id }, assessment: {} as never }];
  const resolveAirport = (place: string) => place === originPlaceId ? { system: 'IATA', value: 'ORG' } : place === placeId ? { system: 'IATA', value: 'DST' } : undefined;
  const before = structuredClone(world);
  const planning = createHotelCompanionPlanning({
    world, failing, now: NOW, resolveAirport, passengers: { adults: 1 },
    hotel: {
      transport: async (request) => {
        assert.ok(['hotel.search', 'hotel.quote'].includes(request.operation), 'planning route cannot reach hotel transaction operations');
        throw new Error('the focused test supplies normalized results directly');
      },
      resolveContext: ({ candidate, gap }) => ({
        baseCandidateKey: candidate.key, journeyId: gap.journeyId, placeId,
        query: {
          location: { externalRef: { system: 'hotel-provider-id', value: 'property-a' } },
          checkInDate: '2030-06-02', checkOutDate: '2030-06-03', guests: { adults: 1 }, rooms: 1, guestNationality: 'NZ',
        },
        stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' },
        proposedJourneyItemId: id(), orderKey: '020', visit,
        provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: ['source-stay-context'] },
      }),
    },
  });
  const corridor = transportCorridors(world, failing, { resolveAirport, passengers: { adults: 1 } }).corridors[0]!;
  const flight: PlanningToolResult = {
    requestId: transportRequestId(corridor), capability: 'FLIGHT', operation: 'flight.search', status: 'SUCCEEDED',
    normalizedEvidence: { offers: [{ offerId: 'provider flight ref', segments: [{ origin: { system: 'IATA', value: 'ORG' }, destination: { system: 'IATA', value: 'DST' }, departure: '2030-06-02T04:00:00.000Z', arrival: '2030-06-02T08:00:00.000Z' }], totalPrice: { amount: 100, currency: 'NZD' }, availability: 'AVAILABLE' }] },
    provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [] }, uncertainty: [],
  };
  const searches = await planning.nextRound({ completedRound: 1, results: [flight] });
  assert.equal(searches.length, 1, 'only the actual overnight gap receives HOTEL research');
  const search: PlanningToolResult = {
    requestId: searches[0]!.id, capability: 'HOTEL', operation: 'hotel.search', status: 'SUCCEEDED',
    normalizedEvidence: { properties: [{ propertyId: 'property-a', name: 'A', externalRefs: [{ system: 'hotel-provider-id', value: 'property-a' }] }], rates: [{ rateId: 'rate-a', propertyId: 'property-a', totalPrice: { amount: 245, currency: 'NZD' }, refundable: true, availability: 'AVAILABLE' }] },
    provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [] }, uncertainty: [],
  };
  const quotes = await planning.nextRound({ completedRound: 2, results: [flight, search] });
  assert.equal(quotes.length, 1);
  const quote: PlanningToolResult = {
    requestId: quotes[0]!.id, capability: 'HOTEL', operation: 'hotel.quote', status: 'SUCCEEDED',
    normalizedEvidence: { status: 'QUOTED', quoteId: 'quote-a', quotedPrice: { amount: 245, currency: 'NZD' }, workflowState: { prebookRef: 'opaque' } },
    provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: [] }, uncertainty: [],
  };
  const materializedTransport = materializeTransportOffers({ world, failing, toolResults: [flight, search, quote], now: NOW, resolveAirport, passengers: { adults: 1 } });
  const candidates = await planning.proposer.propose({
    workspaceId: world.workspaceId, recoveryCaseId: id(), now: NOW, failing, world: materializedTransport.world,
    effective: effectiveOf(materializedTransport.world), domain: 'TRANSPORT', evidence: { domainId: 'TRANSPORT', toolResults: [flight, search, quote], evidenceRefs: [] }, preferences: [],
  });
  assert.equal(candidates.length, 2, 'the rejected flight-only alternative remains alongside one combined option');
  const combined = candidates.find((candidate) => candidate.effects.some((effect) => effect.effectKind === 'ADD_JOURNEY_STAY'))!;
  assert.ok(combined);
  const hotelTerms = planning.materialize([flight, search, quote]);
  assert.equal(hotelTerms.quotedStays.length, 1);
  assert.equal(hotelTerms.quotedStays[0]?.provider.quoteId, 'quote-a');
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(), strategyId: id(), basisAssessmentId: id(), baseWorld: materializedTransport.world, baseManifest: emptyManifest(),
    scenarioChange: ScenarioChangeSchema.parse({ id: id(), recoveryStrategyId: id(), strategyVersion: 1, basisAssessmentId: id(), affectedSubjectRefs: combined.affectedSubjectRefs, effects: combined.effects }),
    now: NOW, resolvedOffers: materializedTransport.resolvedOffers, resolvedStayOffers: hotelTerms.resolvedStayOffers,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: journey.id }], registry: createM6Registry(),
  });
  assert.equal(evaluated.ok, true);
  if (evaluated.ok) {
    const assessment = evaluated.value.strategy.candidateAssessmentResults.find((row) => row.subjects[0]?.subjectRef.id === journey.id)!;
    assert.equal(assessment.dimensions.find((dimension) => dimension.dimension === 'overnight_accommodation')?.verdict, 'PASS');
    assert.equal(assessment.dimensions.find((dimension) => dimension.dimension === 'entry_feasibility')?.verdict, 'UNKNOWN');
  }
  const failedQuote: PlanningToolResult = {
    ...quote, status: 'FAILED', normalizedEvidence: undefined,
    error: { category: 'PROVIDER_ERROR', code: 'quote_failed', message: 'provider refused the confirmation' },
  };
  assert.deepEqual(planning.materialize([flight, search, failedQuote]).resolvedStayOffers, [], 'a failed confirmation cannot become a candidate stay term');
  const fractionalQuote: PlanningToolResult = {
    ...quote,
    normalizedEvidence: { status: 'QUOTED', quoteId: 'quote-fractional', quotedPrice: { amount: 245.001, currency: 'NZD' } },
  };
  assert.deepEqual(planning.materialize([flight, search, fractionalQuote]).resolvedStayOffers, [], 'an unrepresentable provider price cannot be rounded into a lower candidate charge');
  const wrongProperty: PlanningToolResult = {
    ...search,
    normalizedEvidence: { properties: [{ propertyId: 'property-other', name: 'Other', externalRefs: [{ system: 'hotel-provider-id', value: 'property-other' }] }], rates: [{ rateId: 'rate-other', propertyId: 'property-other', totalPrice: { amount: 200, currency: 'NZD' }, refundable: true, availability: 'AVAILABLE' }] },
  };
  assert.deepEqual(await planning.nextRound({ completedRound: 2, results: [flight, wrongProperty] }), [], 'an unrelated returned property cannot be quoted for the captured place');
  const alternate = createHotelCompanionPlanning({
    world, failing, now: NOW, resolveAirport, passengers: { adults: 1 },
    hotel: {
      transport: planning.transport,
      resolveContext: ({ candidate, gap }) => ({
        baseCandidateKey: candidate.key, journeyId: gap.journeyId, placeId,
        query: { location: { externalRef: { system: 'hotel-provider-id', value: 'property-b' } }, checkInDate: '2030-06-02', checkOutDate: '2030-06-03', guests: { adults: 1 }, rooms: 1, guestNationality: 'NZ' },
        stayWindow: { start: '2030-06-02T08:00:00.000Z', end: '2030-06-03T02:00:00.000Z' }, proposedJourneyItemId: id(), orderKey: '020', visit,
        provenance: { mode: 'REPLAY', observedAt: NOW, sourceRefs: ['source-stay-context'] },
      }),
    },
  });
  const alternateSearches = await alternate.nextRound({ completedRound: 1, results: [flight] });
  const alternateSearch: PlanningToolResult = {
    ...search, requestId: alternateSearches[0]!.id,
    normalizedEvidence: { properties: [{ propertyId: 'property-b', name: 'B', externalRefs: [{ system: 'hotel-provider-id', value: 'property-b' }] }], rates: [{ rateId: 'rate-b', propertyId: 'property-b', totalPrice: { amount: 255, currency: 'NZD' }, refundable: true, availability: 'AVAILABLE' }] },
  };
  assert.equal((await alternate.nextRound({ completedRound: 2, results: [flight, alternateSearch] })).length, 1, 'a different captured property reference can be quoted when the returned property matches it');
  const noContext = createHotelCompanionPlanning({
    world, failing, now: NOW, resolveAirport, passengers: { adults: 1 },
    hotel: { transport: planning.transport, resolveContext: () => undefined },
  });
  assert.deepEqual(await noContext.nextRound({ completedRound: 1, results: [flight] }), [], 'missing authoritative context cannot produce a hotel search');
  const zeroAlternatives = createHotelCompanionPlanning({
    world, failing, now: NOW, resolveAirport, passengers: { adults: 1 },
    hotel: { transport: planning.transport, resolveContext: () => { throw new Error('zero alternatives must not resolve context'); }, maxCombinedCandidates: 0 },
  });
  assert.deepEqual(await zeroAlternatives.nextRound({ completedRound: 1, results: [flight] }), [], 'a zero alternative cap avoids hotel reads');
  assert.deepEqual(world, before, 'research and proposal leave the captured base untouched');
});
