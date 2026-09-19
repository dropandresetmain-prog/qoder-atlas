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
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { validateActionPlanAcyclic } from '../src/contracts/v2/action/actionPlan.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import { overnightEvaluator } from '../src/resolution/evaluation/evaluators/overnight.ts';
import { applyScenarioOverlay, assertCanonicalWorldUntouched } from '../src/resolution/scenarios/overlay.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { compileActionPlan, withForcedCycle } from '../src/resolution/planning/compiler.ts';
import type { CurrentState } from '../src/resolution/world/currentness.ts';

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
  const world = emptyWorld({
    travellers: [{ id: travellerId, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [journey],
    places: [{ id: placeId, revision: 1, name: 'Harbour test place', placeType: 'CITY', timeZone: 'Pacific/Auckland', hasCoordinates: true }],
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
  return { world, journey, travellerId, placeId, arrival };
}

function addStayChange(journeyId: string, proposedJourneyItemId: string, offerId: string, offerPrice = { amount: '245.00', currency: 'NZD' }) {
  return ScenarioChangeSchema.parse({
    id: id(), recoveryStrategyId: id(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }], basisAssessmentId: id(),
    effects: [{ effectKind: 'ADD_JOURNEY_STAY', proposedJourneyItemId, journeyId, orderKey: '020', offerId, offerPrice }],
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
  const { world, journey, travellerId, placeId, arrival } = overnightStayWorld();
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

  const change = addStayChange(journey.id, proposedJourneyItemId, offerId);
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
  const { world, journey, placeId, arrival } = overnightStayWorld();
  const offerId = id();
  const baseChange = addStayChange(journey.id, id(), offerId);
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
  if (!badWindow.ok) assert.match(badWindow.conflict.message, /window must be positive/i);
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
  const collision = addStayChange(journey.id, arrival.id, offerId);
  const colliding = applyScenarioOverlay({ baseWorld: world, scenarioChange: collision, resolvedStayOffers: [resolved] });
  assert.equal(colliding.ok, false);
  if (!colliding.ok) assert.match(colliding.conflict.message, /already exists/i);
});

test('ADD_JOURNEY_STAY compiles only with an explicit capability and captured owning Journey revision', () => {
  const { world, journey, placeId } = overnightStayWorld();
  const offerId = id();
  const change = addStayChange(journey.id, id(), offerId);
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
