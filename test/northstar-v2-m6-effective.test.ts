/**
 * M6 — effective Journey/Programme/Service projection (pure) and composition.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type { WJourneyItem } from '../src/resolution/world/world.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain, notApplicable, verdictOf } from '../src/resolution/evaluation/explain.ts';

function transportItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
    desiredOriginPlaceId: 'p-origin', desiredDestinationPlaceId: 'p-dest', selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function baseWorld() {
  const journeyId = id();
  const travellerId = id();
  const serviceId = id();
  const world = emptyWorld({
    journeys: [{ id: journeyId, revision: 3, tripId: id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null }],
    transportServices: [{
      id: serviceId, revision: 2, mode: 'AIR', operator: 'op', originPlaceId: 'p-origin', destinationPlaceId: 'p-dest',
      published: { departure: { value: '2030-01-02T08:00:00.000Z', observedAt: '2030-01-01T00:00:00.000Z', evidenceId: 'e1' }, arrival: { value: '2030-01-02T10:00:00.000Z', observedAt: '2030-01-01T00:00:00.000Z', evidenceId: 'e1' } },
      estimated: { departure: null, arrival: { value: '2030-01-02T11:30:00.000Z', observedAt: '2030-01-02T07:00:00.000Z', evidenceId: 'e2' } },
      actual: { departure: { value: '2030-01-02T08:20:00.000Z', observedAt: '2030-01-02T08:20:00.000Z', evidenceId: 'e3' }, arrival: null },
    }],
  });
  return { world, journeyId, travellerId, serviceId };
}

test('supplier time selection is explicit: actual > estimated > published, published is never overwritten', () => {
  const { world, journeyId, serviceId } = baseWorld();
  world.journeyItems.push(transportItem(journeyId, { selectedServiceId: serviceId }));
  const [journey] = effectiveOf(world).journeys;
  const item = journey!.items[0]!;
  assert.deepEqual([item.start.value, item.start.basis], ['2030-01-02T08:20:00.000Z', 'ACTUAL']);
  assert.deepEqual([item.end.value, item.end.basis], ['2030-01-02T11:30:00.000Z', 'ESTIMATED']);
  assert.equal(world.transportServices[0]!.published.arrival!.value, '2030-01-02T10:00:00.000Z');
  assert.deepEqual(item.serviceRef, { kind: 'TRANSPORT_SERVICE', id: serviceId });
});

test('booking validity is independent of the Journey: a confirmed booking stays VALID', () => {
  const { world, journeyId, travellerId, serviceId } = baseWorld();
  const item = transportItem(journeyId, { selectedServiceId: serviceId });
  const reservationId = id();
  const lineId = id();
  world.journeyItems.push(item);
  world.reservations.push({ id: reservationId, revision: 1, reservationType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: '2030-01-01T00:00:00.000Z', responsibleOrganisationId: null, responsibleTravellerId: travellerId });
  world.reservationLines.push({ id: lineId, reservationId, productType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: '2030-01-01T00:00:00.000Z', evidenceId: 'e4', transportServiceId: serviceId, resourceId: null, placeId: null, interval: null });
  world.allocations.push({ id: id(), reservationId, lineId, travellerId, journeyItemId: item.id, role: 'PASSENGER', quantity: 1 });
  const booked = effectiveOf(world).journeys[0]!.items[0]!;
  assert.equal(booked.bookings[0]!.bookingValid, 'VALID');
  world.reservationLines[0]!.observedStatus = 'CANCELLED';
  assert.equal(effectiveOf(world).journeys[0]!.items[0]!.bookings[0]!.bookingValid, 'INVALID');
  world.reservationLines[0]!.observedStatus = 'HELD';
  assert.equal(effectiveOf(world).journeys[0]!.items[0]!.bookings[0]!.bookingValid, 'UNKNOWN');
});

test('an engagement takes the canonical programme schedule; intent is not copied', () => {
  const { world, journeyId, travellerId } = baseWorld();
  const programmeItemId = id();
  const participationId = id();
  world.programmeItems.push({ id: programmeItemId, programmeId: id(), title: 't', itemType: 'SESSION', placeId: 'p-venue', window: { start: '2030-01-02T14:00:00.000Z', end: '2030-01-02T15:00:00.000Z' }, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL', operatingRequirements: null });
  world.participations.push({ id: participationId, programmeItemId, travellerId, obligation: 'REQUIRED', accepted: true, preparationWindow: null });
  world.journeyItems.push({ ...transportItem(journeyId), kind: 'ENGAGEMENT', desiredOriginPlaceId: null, desiredDestinationPlaceId: null, participationId, intendedWindow: { start: '2030-01-01T00:00:00.000Z', end: '2030-01-01T01:00:00.000Z' } });
  const item = effectiveOf(world).journeys[0]!.items[0]!;
  assert.equal(item.start.basis, 'PROGRAMME_SCHEDULE');
  assert.equal(item.start.value, '2030-01-02T14:00:00.000Z');
  assert.equal(item.startPlaceId, 'p-venue');
  assert.deepEqual(item.programmeItemRef, { kind: 'PROGRAMME_ITEM', id: programmeItemId });
});

test('a transport intent without service or window has UNKNOWN times, never a guessed one', () => {
  const { world, journeyId } = baseWorld();
  world.journeyItems.push(transportItem(journeyId));
  const item = effectiveOf(world).journeys[0]!.items[0]!;
  assert.equal(item.start.basis, 'UNKNOWN');
  assert.equal(item.start.value, null);
});

test('composition: only applicable blocking dimensions decide; nothing evaluated is UNKNOWN', () => {
  const { world, journeyId } = baseWorld();
  const subject = { kind: 'JOURNEY' as const, id: journeyId };
  const make = (status: 'PASS' | 'FAIL' | 'UNKNOWN', dim: string) => explain({ evaluatorId: 'test', dimension: dim, status, reasonCode: 'test_reason', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject });
  const evaluator: Evaluator = {
    id: 'test', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['a', 'b', 'c'], informationTopics: [],
    evaluate: () => ({
      dimensions: [dimension({ dimension: 'a', explanations: [make('PASS', 'a')] }), dimension({ dimension: 'b', blocking: false, explanations: [make('FAIL', 'b')] }), notApplicable('c')],
      evidence: [], missingCoverage: [], nextInvalidationAt: '2030-02-01T00:00:00.000Z',
    }),
  };
  const out = assessSubject({ registry: createEvaluatorRegistry([evaluator]), world, effective: effectiveOf(world), subject, now: '2030-01-01T00:00:00.000Z', assessmentId: id() });
  assert.equal(out.result.overallVerdict, 'PASS', 'a non-blocking FAIL and a non-applicable dimension do not decide');
  assert.equal(out.result.manifest.nextInvalidationAt, '2030-02-01T00:00:00.000Z');
  assert.ok(out.result.manifest.evaluatorVersions.some((v) => v.evaluatorId === 'test'));
  const none = assessSubject({ registry: createEvaluatorRegistry([]), world, effective: effectiveOf(world), subject, now: '2030-01-01T00:00:00.000Z', assessmentId: id() });
  assert.equal(none.result.overallVerdict, 'UNKNOWN');
  assert.equal(verdictOf([]), 'UNKNOWN');
  assert.throws(() => createEvaluatorRegistry([evaluator, { ...evaluator, id: 'other' }]), /declared by both/);
});

test('composition attaches the registered causal path from a changed subject', () => {
  const { world, journeyId, serviceId } = baseWorld();
  const itemId = id();
  const lineId = id();
  world.focus = [{ kind: 'TRANSPORT_SERVICE', id: serviceId }];
  world.edges = [
    { semantic: 'SERVICE_SUPPLIES_LINE', from: { kind: 'TRANSPORT_SERVICE', id: serviceId }, to: { kind: 'RESERVATION_LINE', id: lineId } },
    { semantic: 'ALLOCATION_FULFILS_ITEM', from: { kind: 'RESERVATION_LINE', id: lineId }, to: { kind: 'JOURNEY_ITEM', id: itemId } },
    { semantic: 'ITEM_OF_JOURNEY', from: { kind: 'JOURNEY_ITEM', id: itemId }, to: { kind: 'JOURNEY', id: journeyId } },
  ];
  const subject = { kind: 'JOURNEY' as const, id: journeyId };
  const evaluator: Evaluator = {
    id: 'test', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['x'], informationTopics: [],
    evaluate: () => ({
      dimensions: [dimension({ dimension: 'x', explanations: [explain({ evaluatorId: 'test', dimension: 'x', status: 'FAIL', reasonCode: 'test_reason', cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, relatedSubjects: [{ kind: 'JOURNEY_ITEM', id: itemId }] })] })],
      evidence: [], missingCoverage: [],
    }),
  };
  const out = assessSubject({ registry: createEvaluatorRegistry([evaluator]), world, effective: effectiveOf(world), subject, now: '2030-01-01T00:00:00.000Z', assessmentId: id() });
  assert.deepEqual(out.impactPath.map((e) => e.semantic), ['SERVICE_SUPPLIES_LINE', 'ALLOCATION_FULFILS_ITEM', 'ITEM_OF_JOURNEY']);
  const impact = out.result.dimensions.find((d) => d.dimension === 'impact');
  assert.equal(impact?.blocking, false);
  assert.deepEqual(impact?.explanations[0]?.cause, { kind: 'CHANGED_SUBJECT', subjectRef: { kind: 'TRANSPORT_SERVICE', id: serviceId } });
  const x = out.result.dimensions.find((d) => d.dimension === 'x');
  assert.equal(x?.explanations[0]?.dependencyPath.length, 3, 'an explanation touching a subject on the causal path carries that path');
  assert.equal(out.result.overallVerdict, 'FAIL');
});
