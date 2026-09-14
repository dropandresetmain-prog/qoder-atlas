/**
 * M6 acceptance (pure, over captured worlds) — evaluator portions of AT19,
 * AT20, AT21 and AT22, plus cycle termination through the composer.
 *
 * Every scenario runs through the same registry (`createM6Registry`) and the
 * same function (`assessSubject`); only fixture facts differ. PostgreSQL
 * invalidation/closure acceptance lives in postgres-integration/m6Acceptance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type {
  CapturedWorld, WConstraintDefinition, WJourney, WJourneyItem, WObjective, WParticipation, WProgrammeItem, WTrip,
} from '../src/resolution/world/world.ts';
import type { DependencyEdge } from '../src/contracts/v2/assessment/explanation.ts';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { assessSubject, createEvaluatorRegistry, type EvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain, notApplicable } from '../src/resolution/evaluation/explain.ts';
import { M6_EVALUATORS, createM6Registry } from '../src/resolution/evaluation/registry.ts';

const NOW = '2030-01-01T00:00:00.000Z';
const ASSESSMENT_ID = '00000000-0000-4000-8000-00000000a001';

const window = (start: string, end: string) => ({ start, end });

function tripRow(over: Partial<WTrip> = {}): WTrip {
  return { id: id(), revision: 1, purpose: 'GENERAL', lifecycleStatus: 'PLANNED', intendedWindow: null, businessContextOrganisationId: null, ...over };
}

function journeyRow(tripId: string, over: Partial<WJourney> = {}): WJourney {
  return { id: id(), revision: 1, tripId, travellerId: id(), lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null, ...over };
}

function leg(journeyId: string, orderKey: string, from: string, to: string, start: string, end: string): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey, lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: window(start, end),
    desiredOriginPlaceId: from, desiredDestinationPlaceId: to, selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
  };
}

const operand = (key: string, value: { subject?: TypedRef; number?: number }) => ({
  key, kind: value.subject ? 'SUBJECT_REF' : 'NUMBER', subject: value.subject ?? null, text: null,
  number: value.number === undefined ? null : String(value.number), boolean: null, instant: null, localDate: null,
});

function constraintRow(registeredType: string, owner: TypedRef, operands: ReturnType<typeof operand>[]): WConstraintDefinition {
  return { id: id(), revision: 1, registeredType, hardness: 'HARD', owner, provenanceEvidenceId: null, operands } as WConstraintDefinition;
}

function programmeItemRow(placeId: string, start: string, end: string, over: Partial<WProgrammeItem> = {}): WProgrammeItem {
  return { id: id(), programmeId: id(), title: 'item', itemType: 'SESSION', placeId, window: window(start, end), lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', ...over };
}

function participationRow(travellerId: string, programmeItemId: string): WParticipation {
  return { id: id(), programmeItemId, travellerId, obligation: 'REQUIRED', accepted: true, preparationWindow: null };
}

function objectiveRow(owner: TypedRef, over: Partial<WObjective> = {}): WObjective {
  return { id: id(), revision: 1, owner, successPredicateKind: 'ARRIVAL_BY', hardness: 'HARD', priority: 1, disposition: 'ACTIVE', dispositionEvidenceId: null, targets: [], ...over };
}

function assess(world: CapturedWorld, journeyId: string, registry: EvaluatorRegistry = createM6Registry()): AssessmentResult {
  return assessSubject({ registry, world, effective: effectiveOf(world), subject: { kind: 'JOURNEY', id: journeyId }, now: NOW, assessmentId: ASSESSMENT_ID }).result;
}

const dim = (a: AssessmentResult, name: string) => {
  const d = a.dimensions.find((x) => x.dimension === name);
  assert.ok(d, `dimension ${name}`);
  return d;
};

/** A Journey that must attend a programme item it cannot reach in time, with one hard arrival objective. */
function lateAttendeeWorld(disposition: WObjective['disposition']) {
  const trip = tripRow();
  const journey = journeyRow(trip.id);
  const item = programmeItemRow('place-venue', '2030-01-02T10:00:00.000Z', '2030-01-02T11:00:00.000Z');
  const arriving = leg(journey.id, '010', 'place-home', 'place-venue', '2030-01-02T08:00:00.000Z', '2030-01-02T10:30:00.000Z');
  const onward = leg(journey.id, '020', 'place-venue', 'place-next', '2030-01-02T10:40:00.000Z', '2030-01-02T12:00:00.000Z');
  const world = emptyWorld({
    trips: [trip], journeys: [journey], journeyItems: [arriving, onward], programmeItems: [item],
    participations: [participationRow(journey.travellerId, item.id)],
    constraints: [constraintRow('minimum_connection_minutes', { kind: 'TRIP', id: trip.id }, [operand('minutes', { number: 30 })])],
    objectives: [objectiveRow({ kind: 'JOURNEY', id: journey.id }, {
      disposition, dispositionEvidenceId: disposition === 'ACTIVE' ? null : id(),
      targets: [
        { label: 'deadline', targetKind: 'TIME', subject: null, placeId: null, atOrBefore: '2030-01-02T10:00:00.000Z', amountMinor: null, currencyCode: null },
        { label: 'place', targetKind: 'PLACE', subject: null, placeId: 'place-venue', atOrBefore: null, amountMinor: null, currencyCode: null },
      ] as WObjective['targets'],
    })],
  });
  return { world, journey };
}

test('AT20: an authorised objective loss is recorded but remaining mandatory failures still prevent a viable result', () => {
  const { world, journey } = lateAttendeeWorld('WAIVED');
  const a = assess(world, journey.id);
  const waived = dim(a, 'waived_objectives');
  assert.equal(waived.verdict, 'PASS');
  assert.ok(waived.explanations.some((e) => e.reasonCode === 'objective_loss_authorised'));
  assert.equal(waived.blocking, false, 'a loss disposition is never a blocking pass');
  assert.equal(dim(a, 'programme_participation').verdict, 'FAIL', 'the mandatory participation still fails');
  assert.equal(a.overallVerdict, 'FAIL');
});

test('AT19: waiving an objective cannot alter a registered constraint or a participation judgement', () => {
  const active = lateAttendeeWorld('ACTIVE');
  const waived = lateAttendeeWorld('WAIVED');
  // Same shape, different generated ids: compare verdicts and reason codes, not ids.
  const summary = (a: AssessmentResult, name: string) => {
    const d = dim(a, name);
    return { verdict: d.verdict, applicable: d.applicable, blocking: d.blocking, reasons: d.reasons };
  };
  const a = assess(active.world, active.journey.id);
  const w = assess(waived.world, waived.journey.id);
  assert.equal(dim(a, 'connection_feasibility').verdict, 'FAIL', 'a 10-minute connection is below the registered 30');
  for (const name of ['connection_feasibility', 'programme_participation']) assert.deepEqual(summary(w, name), summary(a, name), name);
  assert.equal(dim(a, 'hard_objectives').verdict, 'FAIL');
  assert.equal(dim(w, 'hard_objectives').applicable, false, 'the waived objective leaves the hard set');
});

test('AT21: typed extension evaluators register without kernel change; absence stays UNKNOWN; collisions are refused', () => {
  const extension = (evaluatorId: string, dimensionName: string, topic: string | null, applies: (world: CapturedWorld) => boolean): Evaluator => ({
    id: evaluatorId, version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: [dimensionName], informationTopics: topic ? [topic] : [],
    evaluate: (subject, { world }) => {
      if (!applies(world)) return { dimensions: [notApplicable(dimensionName)], evidence: [], missingCoverage: [] };
      const facts = topic ? world.informationVersions.filter((v) => v.topic === topic) : [];
      return {
        dimensions: [dimension({ dimension: dimensionName, explanations: [explain({
          evaluatorId, dimension: dimensionName, status: 'UNKNOWN', reasonCode: `${dimensionName}_facts_missing`, cause: { kind: 'MISSING_INFORMATION' }, affectedSubject: subject,
          facts: { editions: facts.length }, uncertainty: [{ kind: 'MISSING_COVERAGE', code: dimensionName }],
        })] })],
        evidence: [], missingCoverage: [],
      };
    },
  });
  const extensions = [
    extension('ext.weather', 'weather_exposure', 'WEATHER_CONDITION', (w) => w.journeyItems.length > 0),
    extension('ext.ev_charging', 'ev_charging_availability', null, (w) => w.journeyItems.some((i) => i.kind === 'TRANSPORT')),
    extension('ext.accreditation', 'accreditation_validity', 'ACCREDITATION_NOTICE', (w) => w.participations.length > 0),
  ];
  const kernelCount = M6_EVALUATORS.length;
  const registry = createEvaluatorRegistry([...M6_EVALUATORS, ...extensions]);
  assert.equal(M6_EVALUATORS.length, kernelCount, 'the kernel registry is not edited');
  for (const topic of ['WEATHER_CONDITION', 'ACCREDITATION_NOTICE']) assert.ok(registry.informationTopics.includes(topic), `snapshot records ${topic}`);

  const { world, journey } = lateAttendeeWorld('ACTIVE');
  const a = assess(world, journey.id, registry);
  for (const name of ['weather_exposure', 'ev_charging_availability', 'accreditation_validity']) assert.equal(dim(a, name).verdict, 'UNKNOWN', `${name} is never PASS by absence`);
  for (const e of extensions) assert.ok(a.manifest.evaluatorVersions.some((v) => v.evaluatorId === e.id));

  assert.throws(() => createEvaluatorRegistry([...M6_EVALUATORS, extension('ext.shadow', 'connection_feasibility', null, () => true)]), /connection_feasibility/);
});

test('AT22: family holiday, corporate delegation and outdoor programme run the same registry and function with different facts only', () => {
  // Family holiday: two ferry legs with a registered connection minimum that is met.
  const holidayTrip = tripRow();
  const child = journeyRow(holidayTrip.id);
  const holiday = emptyWorld({
    trips: [holidayTrip], journeys: [child],
    journeyItems: [leg(child.id, '010', 'place-a', 'place-b', '2030-07-01T08:00:00.000Z', '2030-07-01T10:00:00.000Z'), leg(child.id, '020', 'place-b', 'place-c', '2030-07-01T11:30:00.000Z', '2030-07-01T12:30:00.000Z')],
    constraints: [constraintRow('minimum_connection_minutes', { kind: 'TRIP', id: holidayTrip.id }, [operand('minutes', { number: 45 })])],
  });
  // Corporate delegation: a required session reached through a registered transfer.
  const delegationTrip = tripRow();
  const delegate = journeyRow(delegationTrip.id);
  const session = programmeItemRow('place-venue', '2030-03-02T14:00:00.000Z', '2030-03-02T15:00:00.000Z');
  const delegation = emptyWorld({
    trips: [delegationTrip], journeys: [delegate], programmeItems: [session], participations: [participationRow(delegate.travellerId, session.id)],
    journeyItems: [leg(delegate.id, '010', 'place-home', 'place-hub', '2030-03-02T09:00:00.000Z', '2030-03-02T12:00:00.000Z')],
    constraints: [constraintRow('transfer_minutes', { kind: 'PLACE', id: 'place-hub' }, [operand('from_place', { subject: { kind: 'PLACE', id: 'place-hub' } }), operand('to_place', { subject: { kind: 'PLACE', id: 'place-venue' } }), operand('minutes', { number: 60 })])],
  });
  // Outdoor programme: the required activity was cancelled by its canonical schedule owner.
  const festivalTrip = tripRow();
  const visitor = journeyRow(festivalTrip.id);
  const outdoor = programmeItemRow('place-field', '2030-08-10T16:00:00.000Z', '2030-08-10T18:00:00.000Z', { lifecycleStatus: 'CANCELLED' });
  const festival = emptyWorld({
    trips: [festivalTrip], journeys: [visitor], programmeItems: [outdoor], participations: [participationRow(visitor.travellerId, outdoor.id)],
    journeyItems: [leg(visitor.id, '010', 'place-town', 'place-field', '2030-08-10T12:00:00.000Z', '2030-08-10T13:00:00.000Z')],
  });

  const registry = createM6Registry();
  const results = [
    assess(holiday, child.id, registry),
    assess(delegation, delegate.id, registry),
    assess(festival, visitor.id, registry),
  ];
  const versions = results.map((r) => JSON.stringify(r.manifest.evaluatorVersions));
  assert.equal(new Set(versions).size, 1, 'identical evaluator set and versions');
  assert.equal(dim(results[0]!, 'connection_feasibility').verdict, 'PASS');
  assert.equal(dim(results[1]!, 'programme_participation').verdict, 'PASS');
  assert.ok(dim(results[2]!, 'programme_participation').explanations.some((e) => e.reasonCode === 'programme_item_cancelled'));
  for (const r of results) assert.notEqual(r.overallVerdict, undefined);
});

test('cycles: explicit CONNECTS_TO cycles terminate through the composer, deterministically, with a registered causal path', () => {
  const trip = tripRow();
  const journey = journeyRow(trip.id);
  const first = leg(journey.id, '010', 'place-a', 'place-b', '2030-01-02T08:00:00.000Z', '2030-01-02T09:00:00.000Z');
  const second = leg(journey.id, '020', 'place-b', 'place-c', '2030-01-02T10:00:00.000Z', '2030-01-02T11:00:00.000Z');
  const ref = (item: WJourneyItem): TypedRef => ({ kind: 'JOURNEY_ITEM', id: item.id });
  const edges: DependencyEdge[] = [
    { semantic: 'EXPLICIT_CONNECTS_TO', from: ref(first), to: ref(second) },
    { semantic: 'EXPLICIT_CONNECTS_TO', from: ref(second), to: ref(first) },
    { semantic: 'ITEM_OF_JOURNEY', from: ref(first), to: { kind: 'JOURNEY', id: journey.id } },
    { semantic: 'ITEM_OF_JOURNEY', from: ref(second), to: { kind: 'JOURNEY', id: journey.id } },
  ];
  const base = { trips: [trip], journeys: [journey], journeyItems: [first, second], focus: [ref(first)] };
  const forward = assess(emptyWorld({ ...base, edges }), journey.id);
  const reversed = assess(emptyWorld({ ...base, edges: [...edges].reverse() }), journey.id);
  assert.deepEqual(forward, reversed);
  const impact = dim(forward, 'impact');
  const path = impact.explanations[0]!.dependencyPath;
  assert.equal(path[0]?.from.id, first.id);
  assert.equal(path.at(-1)?.to.id, journey.id);
});
