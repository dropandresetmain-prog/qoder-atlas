/**
 * RC-6 — strategy viability is a counterfactual comparison, not "all reached PASS".
 *
 * Overlay/dependency closure still decides who is reassessed. These tests pin
 * the aggregation: blocking subjects must become PASS; no reached subject may
 * worsen; newly introduced/action-critical UNKNOWN blocks; unchanged
 * FAIL/UNKNOWN does not veto and is not treated as healed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, id } from './support/m6World.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { CapturedWorld, WJourney, WProgrammeItem } from '../src/resolution/world/world.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import {
  strategyViabilityFromSubjectVerdicts,
  type StrategySubjectVerdict,
} from '../src/contracts/v2/scenario/recoveryStrategy.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { AssessmentVerdict } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';

const NOW = '2030-06-01T12:00:00.000Z';
const EARLY = '2030-06-02T10:00:00.000Z';
const LATE = '2030-06-02T15:00:00.000Z';

function pair(
  idValue: string,
  candidate: AssessmentVerdict,
  baseline: AssessmentVerdict | undefined,
  mustPass: boolean,
): StrategySubjectVerdict {
  return { subjectRef: { kind: 'JOURNEY', id: idValue }, candidate, baseline, mustPass };
}

test('positive: blocking FAIL becomes PASS; unchanged unrelated FAIL/UNKNOWN do not veto', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'PASS', 'FAIL', true),
    pair('unrelated-fail', 'FAIL', 'FAIL', false),
    pair('coparticipant-unknown', 'UNKNOWN', 'UNKNOWN', false),
  ], 0);
  assert.equal(out.viability, 'VIABLE');
  assert.deepEqual(out.decisions, []);
});

test('negative: blocking subject still FAIL is NOT_VIABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'FAIL', 'FAIL', true),
    pair('other', 'PASS', 'PASS', false),
  ], 0);
  assert.equal(out.viability, 'NOT_VIABLE');
  assert.equal(out.decisions[0]?.code, 'UNRESOLVED_FAIL');
});

test('negative: blocking subject becoming UNKNOWN is NOT_EXECUTABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'UNKNOWN', 'FAIL', true),
  ], 0);
  assert.equal(out.viability, 'NOT_EXECUTABLE');
  assert.equal(out.decisions[0]?.code, 'UNRESOLVED_UNKNOWN');
});

test('negative: PASS counterpart regressing to FAIL is NOT_VIABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'PASS', 'FAIL', true),
    pair('counterpart', 'FAIL', 'PASS', false),
  ], 0);
  assert.equal(out.viability, 'NOT_VIABLE');
  assert.equal(out.decisions[0]?.code, 'REGRESSION_FAIL');
});

test('negative: UNKNOWN co-participant becoming FAIL is NOT_VIABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'PASS', 'FAIL', true),
    pair('coparticipant', 'FAIL', 'UNKNOWN', false),
  ], 0);
  assert.equal(out.viability, 'NOT_VIABLE');
  assert.ok(out.decisions.some((d) => d.code === 'REGRESSION_FAIL'));
});

test('negative: newly introduced UNKNOWN on a reached PASS subject is NOT_EXECUTABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'PASS', 'FAIL', true),
    pair('peer', 'UNKNOWN', 'PASS', false),
  ], 0);
  assert.equal(out.viability, 'NOT_EXECUTABLE');
  assert.equal(out.decisions[0]?.code, 'INTRODUCED_UNKNOWN');
});

test('negative: FAIL becoming UNKNOWN is newly introduced UNKNOWN, not a healing', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'PASS', 'FAIL', true),
    pair('other', 'UNKNOWN', 'FAIL', false),
  ], 0);
  assert.equal(out.viability, 'NOT_EXECUTABLE');
  assert.equal(out.decisions[0]?.code, 'INTRODUCED_UNKNOWN');
});

test('negative: required unknowns remain NOT_EXECUTABLE even when overlay PASSes', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('case-subject', 'PASS', 'FAIL', true),
  ], 1);
  assert.equal(out.viability, 'NOT_EXECUTABLE');
  assert.equal(out.decisions[0]?.code, 'REQUIRED_UNKNOWNS');
});

test('negative: empty subject set is NOT_EXECUTABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([], 0);
  assert.equal(out.viability, 'NOT_EXECUTABLE');
  assert.equal(out.decisions[0]?.code, 'NO_SUBJECTS');
});

test('regression: all-PASS reached set is still VIABLE', () => {
  const out = strategyViabilityFromSubjectVerdicts([
    pair('a', 'PASS', 'PASS', true),
    pair('b', 'PASS', 'PASS', false),
  ], 0);
  assert.equal(out.viability, 'VIABLE');
});

function journeyRow(over: Partial<WJourney> = {}): WJourney {
  return { id: id(), revision: 1, tripId: id(), travellerId: id(), lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null, ...over };
}

function emptyManifest(): WorldSnapshotManifest {
  return {
    evaluatedAt: NOW,
    evaluatorVersions: [],
    aggregateReads: [],
    scopeReads: [],
    evidenceReads: [],
    coverageReads: [],
    missingCoverage: [],
  };
}

function stubRegistry(verdictFor: (world: CapturedWorld, subject: TypedRef) => AssessmentVerdict) {
  const evaluator: Evaluator = {
    id: 'test.viability-stub',
    version: '1',
    assessmentKind: 'VIABILITY',
    subjectKinds: ['JOURNEY'],
    dimensions: ['stub'],
    informationTopics: [],
    evaluate(subject, context) {
      const verdict = verdictFor(context.world, subject);
      const reason = verdict === 'PASS' ? 'ok' : verdict === 'FAIL' ? 'blocked' : 'unknown';
      return {
        dimensions: [dimension({
          dimension: 'stub',
          explanations: [explain({
            evaluatorId: 'test.viability-stub',
            dimension: 'stub',
            status: verdict,
            reasonCode: reason,
            cause: { kind: 'WORLD_STATE' },
            affectedSubject: subject,
          })],
        })],
        evidence: [],
        missingCoverage: [],
      };
    },
  };
  return createEvaluatorRegistry([evaluator]);
}

function programmeItem(over: Partial<WProgrammeItem> & Pick<WProgrammeItem, 'id' | 'programmeId'>): WProgrammeItem {
  return {
    title: 'session',
    itemType: 'SESSION',
    placeId: 'p-venue',
    window: { start: EARLY, end: '2030-06-02T11:00:00.000Z' },
    lifecycleStatus: 'SCHEDULED',
    scheduleAuthority: 'INTERNAL',
    operatingRequirements: null,
    ...over,
  };
}

test('evaluate: unchanged UNKNOWN co-participant does not veto a healing named subject', () => {
  const programmeId = id();
  const itemId = id();
  const travellerA = id();
  const travellerB = id();
  const jA = journeyRow({ travellerId: travellerA });
  const jB = journeyRow({ travellerId: travellerB });
  const world = emptyWorld({
    travellers: [
      { id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' },
      { id: travellerB, revision: 1, lifecycleStatus: 'ACTIVE' },
    ],
    journeys: [jA, jB],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [programmeItem({ id: itemId, programmeId })],
    participations: [
      { id: id(), programmeItemId: itemId, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
      { id: id(), programmeItemId: itemId, travellerId: travellerB, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
    ],
    focus: [{ kind: 'JOURNEY', id: jA.id }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemId }, { kind: 'JOURNEY', id: jA.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
      programmeItemId: itemId,
      proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' },
    }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry((w, subject) => {
      if (subject.id === jB.id) return 'UNKNOWN';
      const item = w.programmeItems.find((i) => i.id === itemId);
      return item?.window?.start === EARLY ? 'FAIL' : 'PASS';
    }),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'VIABLE');
  const unknown = evaluated.value.strategy.candidateAssessments.find((a) => a.subjectRef.id === jB.id);
  assert.equal(unknown?.overallVerdict, 'UNKNOWN');
  const healed = evaluated.value.strategy.candidateAssessments.find((a) => a.subjectRef.id === jA.id);
  assert.equal(healed?.overallVerdict, 'PASS');
  assert.equal(evaluated.value.baselineAssessments.find((a) => a.subjectRef.id === jA.id)?.overallVerdict, 'FAIL');
});

test('evaluate: resource-coupled unrelated FAIL does not veto when it does not worsen', () => {
  const programmeId = id();
  const itemA = id();
  const itemC = id();
  const room = id();
  const travellerA = id();
  const travellerC = id();
  const jA = journeyRow({ travellerId: travellerA });
  const jC = journeyRow({ travellerId: travellerC });
  const partC = id();
  const world = emptyWorld({
    travellers: [
      { id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' },
      { id: travellerC, revision: 1, lifecycleStatus: 'ACTIVE' },
    ],
    journeys: [jA, jC],
    resources: [{ id: room, revision: 1, resourceType: 'ROOM', locationPlaceId: 'p-venue', capacity: 1 }],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [
      programmeItem({ id: itemA, programmeId }),
      programmeItem({ id: itemC, programmeId, window: { start: '2030-06-01T09:00:00.000Z', end: '2030-06-01T10:00:00.000Z' } }),
    ],
    participations: [
      { id: id(), programmeItemId: itemA, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
      { id: partC, programmeItemId: itemC, travellerId: travellerC, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
    ],
    resourceAssignments: [
      { id: id(), resourceId: room, activityKind: 'PROGRAMME_ITEM', activityId: itemA, quantity: 1, lifecycleStatus: 'ACTIVE' },
      { id: id(), resourceId: room, activityKind: 'PROGRAMME_ITEM', activityId: itemC, quantity: 1, lifecycleStatus: 'ACTIVE' },
    ],
    edges: [
      { semantic: 'RESOURCE_ASSIGNED_TO_ACTIVITY', from: { kind: 'RESOURCE', id: room }, to: { kind: 'PROGRAMME_ITEM', id: itemA } },
      { semantic: 'RESOURCE_ASSIGNED_TO_ACTIVITY', from: { kind: 'RESOURCE', id: room }, to: { kind: 'PROGRAMME_ITEM', id: itemC } },
      { semantic: 'PARTICIPATION_IN_PROGRAMME_ITEM', from: { kind: 'PROGRAMME_ITEM', id: itemC }, to: { kind: 'PARTICIPATION', id: partC } },
      { semantic: 'PARTICIPATION_OF_TRAVELLER', from: { kind: 'PARTICIPATION', id: partC }, to: { kind: 'TRAVELLER', id: travellerC } },
      { semantic: 'JOURNEY_OF_TRAVELLER', from: { kind: 'TRAVELLER', id: travellerC }, to: { kind: 'JOURNEY', id: jC.id } },
    ],
    focus: [{ kind: 'PROGRAMME_ITEM', id: itemA }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'PROGRAMME_ITEM', id: itemA }, { kind: 'JOURNEY', id: jA.id }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
      programmeItemId: itemA,
      proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' },
    }],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry((w, subject) => {
      if (subject.id === jC.id) return 'FAIL';
      const item = w.programmeItems.find((i) => i.id === itemA);
      return item?.window?.start === EARLY ? 'FAIL' : 'PASS';
    }),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.ok(
    evaluated.value.strategy.candidateAssessments.some((a) => a.subjectRef.id === jC.id && a.overallVerdict === 'FAIL'),
    'closure still reaches the resource-coupled subject',
  );
  assert.equal(evaluated.value.strategy.viability, 'VIABLE');
  assert.deepEqual(evaluated.value.viabilityDecisions, []);
});

test('evaluate: healing the named subject while a reached PASS subject regresses is NOT_VIABLE', () => {
  const programmeId = id();
  const earlyItem = id();
  const lateItem = id();
  const travellerA = id();
  const travellerD = id();
  const jA = journeyRow({ travellerId: travellerA });
  const jD = journeyRow({ travellerId: travellerD });
  const world = emptyWorld({
    travellers: [
      { id: travellerA, revision: 1, lifecycleStatus: 'ACTIVE' },
      { id: travellerD, revision: 1, lifecycleStatus: 'ACTIVE' },
    ],
    journeys: [jA, jD],
    programmes: [{ id: programmeId, revision: 1, eventId: id(), title: 'event', lifecycleStatus: 'ACTIVE' }],
    programmeItems: [
      programmeItem({ id: earlyItem, programmeId, window: { start: EARLY, end: '2030-06-02T11:00:00.000Z' } }),
      programmeItem({ id: lateItem, programmeId, window: { start: LATE, end: '2030-06-02T16:00:00.000Z' } }),
    ],
    participations: [
      { id: id(), programmeItemId: earlyItem, travellerId: travellerA, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
      { id: id(), programmeItemId: lateItem, travellerId: travellerD, obligation: 'REQUIRED', accepted: true, preparationWindow: null },
    ],
    focus: [{ kind: 'PROGRAMME_ITEM', id: earlyItem }],
  });
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [
      { kind: 'PROGRAMME_ITEM', id: earlyItem },
      { kind: 'PROGRAMME_ITEM', id: lateItem },
      { kind: 'JOURNEY', id: jA.id },
    ],
    basisAssessmentId: id(),
    effects: [
      { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: earlyItem, proposedWindow: { start: LATE, end: '2030-06-02T16:00:00.000Z' } },
      { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', programmeItemId: lateItem, proposedWindow: { start: EARLY, end: '2030-06-02T11:00:00.000Z' } },
    ],
  });
  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: id(),
    baseWorld: world,
    baseManifest: emptyManifest(),
    basisAssessmentId: change.basisAssessmentId,
    scenarioChange: change,
    now: NOW,
    resolveSubjectRefs: [{ kind: 'JOURNEY', id: jA.id }],
    registry: stubRegistry((w, subject) => {
      if (subject.id === jA.id) {
        const item = w.programmeItems.find((i) => i.id === earlyItem);
        return item?.window?.start === EARLY ? 'FAIL' : 'PASS';
      }
      const item = w.programmeItems.find((i) => i.id === lateItem);
      return item?.window?.start === LATE ? 'PASS' : 'FAIL';
    }),
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.value.strategy.viability, 'NOT_VIABLE');
  assert.ok(evaluated.value.viabilityDecisions.some((d) => d.code === 'REGRESSION_FAIL' && d.subjectRef?.id === jD.id));
});

test('evaluate: a JOURNEY_ITEM-only SELECT_OFFER still requires the overlay-affected FAIL journey to heal', () => {
  const travellerId = id();
  const journey = journeyRow({ travellerId });
  const itemId = id();
  const serviceFail = id();
  const servicePass = id();
  const world = emptyWorld({
    travellers: [{ id: travellerId, revision: 1, lifecycleStatus: 'ACTIVE' }],
    journeys: [journey],
    journeyItems: [{
      id: itemId, journeyId: journey.id, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false,
      intendedWindow: null, desiredOriginPlaceId: 'p-a', desiredDestinationPlaceId: 'p-b', selectedServiceId: null,
      intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null, standaloneWindow: null,
      resourceId: null, intendedLocationPlaceId: null,
    }],
    transportServices: [
      { id: serviceFail, revision: 1, mode: 'AIR', operator: 'op', originPlaceId: 'p-a', destinationPlaceId: 'p-b', published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null } },
      { id: servicePass, revision: 1, mode: 'AIR', operator: 'op', originPlaceId: 'p-a', destinationPlaceId: 'p-b', published: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, actual: { departure: null, arrival: null } },
    ],
    focus: [{ kind: 'JOURNEY_ITEM', id: itemId }],
  });
  const evaluateOffer = (serviceId: string) => {
    const offerId = id();
    const change = ScenarioChangeSchema.parse({
      id: id(),
      recoveryStrategyId: id(),
      strategyVersion: 1,
      affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: itemId }],
      basisAssessmentId: id(),
      effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: itemId, offerId }],
    });
    return evaluateRecoveryStrategy({
      recoveryCaseId: id(),
      baseWorld: world,
      baseManifest: emptyManifest(),
      basisAssessmentId: change.basisAssessmentId,
      scenarioChange: change,
      now: NOW,
      resolvedOffers: [{ offerId, transportServiceId: serviceId }],
      registry: stubRegistry((w, subject) => {
        if (subject.id !== journey.id) return 'PASS';
        const selected = w.journeyItems.find((i) => i.id === itemId)?.selectedServiceId;
        return selected === servicePass ? 'PASS' : 'FAIL';
      }),
    });
  };
  const failing = evaluateOffer(serviceFail);
  assert.equal(failing.ok, true);
  if (!failing.ok) return;
  assert.equal(failing.value.strategy.viability, 'NOT_VIABLE');
  assert.ok(failing.value.viabilityDecisions.some((d) => d.code === 'UNRESOLVED_FAIL' && d.subjectRef?.id === journey.id));
  const healing = evaluateOffer(servicePass);
  assert.equal(healing.ok, true);
  if (!healing.ok) return;
  assert.equal(healing.value.strategy.viability, 'VIABLE');
});
