/**
 * M6 L1 — m6.booking / m6.connection / m6.overnight (pure).
 * docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type { WConstraintDefinition, WJourneyItem } from '../src/resolution/world/world.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { CausalExplanation } from '../src/contracts/v2/assessment/explanation.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import { bookingEvaluator } from '../src/resolution/evaluation/evaluators/booking.ts';
import { connectionEvaluator } from '../src/resolution/evaluation/evaluators/connection.ts';
import { overnightEvaluator } from '../src/resolution/evaluation/evaluators/overnight.ts';

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
    desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function stayItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'STAY', orderKey: '015', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
    desiredOriginPlaceId: null, desiredDestinationPlaceId: null, selectedServiceId: null, intendedPlaceId: 'place-a', requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function window(start: string, end: string) {
  return { start, end };
}

type World = ReturnType<typeof emptyWorld>;

function addBooking(world: World, item: WJourneyItem, travellerId: string, opts: { reservationStatus?: string; lineStatus: string; serviceId?: string | null }) {
  const reservationId = id();
  const lineId = id();
  world.reservations.push({ id: reservationId, revision: 1, reservationType: 'TRANSPORT', observedStatus: opts.reservationStatus ?? 'CONFIRMED', observedStatusAt: NOW, responsibleOrganisationId: null, responsibleTravellerId: travellerId });
  world.reservationLines.push({ id: lineId, reservationId, productType: 'TRANSPORT', observedStatus: opts.lineStatus, observedStatusAt: NOW, evidenceId: `evid-${lineId}`, transportServiceId: opts.serviceId ?? null, resourceId: null, placeId: null, interval: null });
  world.allocations.push({ id: id(), reservationId, lineId, travellerId, journeyItemId: item.id, role: 'PASSENGER', quantity: 1 });
  return { reservationId, lineId };
}

function numOperand(key: string, value: number): WConstraintDefinition['operands'][number] {
  return { key, kind: 'NUMBER', subject: null, text: null, number: String(value), boolean: null, instant: null, localDate: null };
}

function placeOperand(key: string, placeId: string): WConstraintDefinition['operands'][number] {
  return { key, kind: 'SUBJECT_REF', subject: { kind: 'PLACE', id: placeId }, text: null, number: null, boolean: null, instant: null, localDate: null };
}

function constraintRow(owner: TypedRef, registeredType: string, operands: WConstraintDefinition['operands']): WConstraintDefinition {
  return { id: id(), revision: 1, registeredType, hardness: 'HARD', owner, provenanceEvidenceId: null, operands };
}

function findExplanation(dim: { explanations: CausalExplanation[] } | undefined, reasonCode: string): CausalExplanation | undefined {
  return dim?.explanations.find((e) => e.reasonCode === reasonCode);
}

// --------------------------------------------------------------------------
// m6.booking
// --------------------------------------------------------------------------

test('booking: all VALID bookings PASS supplier_fulfilled, each booking PASSes booking_valid', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const item = transportItem(journeyId);
  world.journeyItems.push(item);
  addBooking(world, item, travellerId, { lineStatus: 'CONFIRMED' });
  const effective = effectiveOf(world);
  const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
  const validity = out.dimensions.find((d) => d.dimension === 'booking_validity');
  assert.equal(supplier?.verdict, 'PASS');
  assert.equal(supplier?.explanations[0]?.reasonCode, 'supplier_fulfilled');
  assert.equal(validity?.verdict, 'PASS');
  assert.equal(validity?.explanations[0]?.reasonCode, 'booking_valid');
  assert.deepEqual(validity?.explanations[0]?.evidenceRefs, [{ kind: 'SUPPLIER_OBSERVATION', id: `evid-${world.reservationLines[0]!.id}`, detail: 'reservation_line_status' }]);
});

test('booking: a CANCELLED-only item FAILs both supplier_fulfilment (booking_invalid) and booking_validity (booking_invalid), flexible or not', () => {
  for (const flexible of [false, true]) {
    const journeyId = id();
    const travellerId = id();
    const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
    const item = transportItem(journeyId, { flexible });
    world.journeyItems.push(item);
    addBooking(world, item, travellerId, { lineStatus: 'CANCELLED' });
    const effective = effectiveOf(world);
    // Cancelled history stays in the projection as an INVALID booking.
    assert.equal(effective.journeys[0]!.items[0]!.bookings.length, 1);
    const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
    const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
    const validity = out.dimensions.find((d) => d.dimension === 'booking_validity');
    assert.equal(supplier?.verdict, 'FAIL', `supplier_fulfilment FAILs (flexible=${flexible})`);
    assert.equal(supplier?.explanations[0]?.reasonCode, 'booking_invalid');
    assert.equal(validity?.verdict, 'FAIL', `booking_validity FAILs (flexible=${flexible})`);
    assert.equal(validity?.explanations[0]?.reasonCode, 'booking_invalid');
  }
});

test('booking: a cancelled original superseded by a confirmed replacement PASSes supplier_fulfilment with the replacement as the current booking', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const item = transportItem(journeyId);
  world.journeyItems.push(item);
  addBooking(world, item, travellerId, { lineStatus: 'CANCELLED', serviceId: null });
  const replacement = addBooking(world, item, travellerId, { lineStatus: 'CONFIRMED', serviceId: null });
  const effective = effectiveOf(world);
  // Current booking state is the active replacement; the cancelled original
  // is no longer part of the item's effective bookings (superseded), while
  // its history remains canonically observable in reservation_lines.
  assert.equal(effective.journeys[0]!.items[0]!.bookings.length, 1);
  assert.equal(effective.journeys[0]!.items[0]!.bookings[0]!.lineRef.id, replacement.lineId);
  const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
  const validity = out.dimensions.find((d) => d.dimension === 'booking_validity');
  assert.equal(supplier?.verdict, 'PASS');
  assert.equal(supplier?.explanations[0]?.reasonCode, 'supplier_fulfilled');
  assert.equal(validity?.verdict, 'PASS');
  assert.equal(validity?.explanations[0]?.reasonCode, 'booking_valid');
});

test('booking: a HELD line UNKNOWNs both dimensions with booking_state_unknown', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const item = transportItem(journeyId);
  world.journeyItems.push(item);
  addBooking(world, item, travellerId, { lineStatus: 'HELD' });
  const effective = effectiveOf(world);
  const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
  const validity = out.dimensions.find((d) => d.dimension === 'booking_validity');
  assert.equal(supplier?.verdict, 'UNKNOWN');
  assert.equal(supplier?.explanations[0]?.reasonCode, 'booking_state_unknown');
  assert.equal(validity?.verdict, 'UNKNOWN');
  assert.equal(validity?.explanations[0]?.reasonCode, 'booking_state_unknown');
  assert.deepEqual(validity?.explanations[0]?.uncertainty, [{ kind: 'UNKNOWN_SUPPLIER_STATE', code: 'booking_status', subjectRef: { kind: 'RESERVATION_LINE', id: world.reservationLines[0]!.id } }]);
});

test('booking: flexible unbooked item PASSes flexible_item_no_supplier_required; non-flexible unbooked item UNKNOWNs booking_missing', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const flexible = transportItem(journeyId, { flexible: true, orderKey: '010', desiredDestinationPlaceId: 'place-b' });
  const rigid = transportItem(journeyId, { flexible: false, orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c' });
  world.journeyItems.push(flexible, rigid);
  const effective = effectiveOf(world);
  const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
  assert.equal(supplier?.verdict, 'UNKNOWN', 'one FAIL/UNKNOWN item makes the whole dimension non-PASS');
  const flexibleExplanation = findExplanation(supplier, 'flexible_item_no_supplier_required');
  const rigidExplanation = findExplanation(supplier, 'booking_missing');
  assert.equal(flexibleExplanation?.status, 'PASS');
  assert.equal(rigidExplanation?.status, 'UNKNOWN');
  assert.deepEqual(rigidExplanation?.uncertainty, [{ kind: 'MISSING_INPUT', code: 'booking', subjectRef: { kind: 'JOURNEY_ITEM', id: rigid.id } }]);
  // booking_validity: no bookings anywhere on the Journey -> not applicable, never PASS by absence.
  const validity = out.dimensions.find((d) => d.dimension === 'booking_validity');
  assert.equal(validity?.applicable, false);
  assert.equal(validity?.verdict, 'UNKNOWN');
});

test('booking: a selected service with no booking UNKNOWNs service_selected_not_booked', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const item = transportItem(journeyId, { selectedServiceId: id() });
  world.journeyItems.push(item);
  const effective = effectiveOf(world);
  const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
  assert.equal(supplier?.verdict, 'UNKNOWN');
  assert.equal(supplier?.explanations[0]?.reasonCode, 'service_selected_not_booked');
});

test('booking: no transport items on the Journey -> supplier_fulfilment not applicable', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const effective = effectiveOf(world);
  const out = bookingEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const supplier = out.dimensions.find((d) => d.dimension === 'supplier_fulfilment');
  assert.equal(supplier?.applicable, false);
  assert.equal(supplier?.verdict, 'UNKNOWN');
});

// --------------------------------------------------------------------------
// invariant: "booking valid, Journey invalid" — booking_validity PASS while
// connection_feasibility FAILs on the same Journey.
// --------------------------------------------------------------------------

test('invariant: booking_validity PASSes while connection_feasibility FAILs on the same Journey, and the overall verdict is FAIL', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: window('2030-01-02T10:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T11:00:00.000Z', '2030-01-02T13:00:00.000Z') });
  world.journeyItems.push(a, b);
  addBooking(world, a, travellerId, { lineStatus: 'CONFIRMED' });
  addBooking(world, b, travellerId, { lineStatus: 'FULFILLED' });
  const effective = effectiveOf(world);
  const registry = createEvaluatorRegistry([bookingEvaluator, connectionEvaluator]);
  const out = assessSubject({ registry, world, effective, subject: subjectOf(journeyId), now: NOW, assessmentId: id() });
  const bookingValidity = out.result.dimensions.find((d) => d.dimension === 'booking_validity');
  const connection = out.result.dimensions.find((d) => d.dimension === 'connection_feasibility');
  assert.equal(bookingValidity?.verdict, 'PASS');
  assert.equal(connection?.verdict, 'FAIL');
  assert.equal(connection?.explanations.some((e) => e.reasonCode === 'connection_broken'), true);
  assert.equal(out.result.overallVerdict, 'FAIL', 'a valid booking never rescues a broken connection');
});

// --------------------------------------------------------------------------
// m6.connection
// --------------------------------------------------------------------------

test('connection: fewer than two active transport items -> not applicable', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId));
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  assert.equal(out.dimensions[0]?.applicable, false);
});

test('connection: an unknown arrival or departure time UNKNOWNs connection_time_unknown', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: null });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T11:00:00.000Z', '2030-01-02T13:00:00.000Z') });
  world.journeyItems.push(a, b);
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'connection_time_unknown');
});

test('connection: a negative gap at the same place FAILs connection_broken', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: window('2030-01-02T10:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T11:30:00.000Z', '2030-01-02T13:00:00.000Z') });
  world.journeyItems.push(a, b);
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'connection_broken');
  assert.equal(dim?.explanations[0]?.facts.gapMinutes, -30);
});

test('connection: no minimum_connection_minutes registered but a non-negative gap UNKNOWNs minimum_connection_time_missing (never PASS by absence)', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: window('2030-01-02T10:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T12:30:00.000Z', '2030-01-02T13:00:00.000Z') });
  world.journeyItems.push(a, b);
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'minimum_connection_time_missing');
});

test('connection: a place-scoped minimum_connection_minutes applies only at that place; elsewhere it is still missing', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: window('2030-01-02T10:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T13:00:00.000Z', '2030-01-02T14:00:00.000Z') }); // gap 60 at place-b
  const c = transportItem(journeyId, { orderKey: '030', desiredOriginPlaceId: 'place-c', desiredDestinationPlaceId: 'place-d', intendedWindow: window('2030-01-02T14:10:00.000Z', '2030-01-02T15:00:00.000Z') }); // gap 10 at place-c
  world.journeyItems.push(a, b, c);
  world.constraints.push(constraintRow(subjectOf(journeyId), 'minimum_connection_minutes', [numOperand('minutes', 90), placeOperand('place', 'place-b')]));
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  const atB = findExplanation(dim, 'connection_below_minimum');
  const atC = findExplanation(dim, 'minimum_connection_time_missing');
  assert.equal(atB?.status, 'FAIL', 'the scoped constraint applies at place-b: gap 60 < required 90');
  assert.equal(atC?.status, 'UNKNOWN', 'the scoped constraint does not govern place-c, so absence stays UNKNOWN');
  assert.equal(dim?.verdict, 'FAIL');
});

test('connection: among applicable minimum_connection_minutes constraints, the largest wins', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: window('2030-01-02T10:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T12:35:00.000Z', '2030-01-02T13:00:00.000Z') }); // gap 35
  world.journeyItems.push(a, b);
  world.constraints.push(
    constraintRow(subjectOf(journeyId), 'minimum_connection_minutes', [numOperand('minutes', 20)]),
    constraintRow(subjectOf(journeyId), 'minimum_connection_minutes', [numOperand('minutes', 40), placeOperand('place', 'place-b')]),
  );
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL', 'gap 35 fails the larger applicable requirement of 40, not the smaller 20');
  assert.equal(dim?.explanations[0]?.reasonCode, 'connection_below_minimum');
  assert.equal(dim?.explanations[0]?.facts.requiredMinutes, 40);
});

test('connection: different places with no registered transfer_minutes UNKNOWNs route_discontinuity; with one registered, gap-fits PASSes and gap-too-short FAILs', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-airport', intendedWindow: window('2030-01-02T10:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-venue', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T13:00:00.000Z', '2030-01-02T14:00:00.000Z') }); // gap 60, different place
  world.journeyItems.push(a, b);
  const effectiveNoTransfer = effectiveOf(world);
  const noTransfer = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveNoTransfer });
  assert.equal(noTransfer.dimensions[0]?.verdict, 'UNKNOWN');
  assert.equal(noTransfer.dimensions[0]?.explanations[0]?.reasonCode, 'route_discontinuity');

  world.constraints.push(constraintRow(subjectOf(journeyId), 'transfer_minutes', [placeOperand('from_place', 'place-airport'), placeOperand('to_place', 'place-venue'), numOperand('minutes', 45)]));
  const effectiveFits = effectiveOf(world);
  const fits = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveFits });
  assert.equal(fits.dimensions[0]?.verdict, 'PASS');
  assert.equal(fits.dimensions[0]?.explanations[0]?.reasonCode, 'transfer_fits');

  b.intendedWindow = window('2030-01-02T12:30:00.000Z', '2030-01-02T14:00:00.000Z'); // gap 30 < 45
  const effectiveTooShort = effectiveOf(world);
  const tooShort = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveTooShort });
  assert.equal(tooShort.dimensions[0]?.verdict, 'FAIL');
  assert.equal(tooShort.dimensions[0]?.explanations[0]?.reasonCode, 'transfer_does_not_fit');
});

test('connection: a captured CONNECTS_TO dependency pairs two non-consecutive transport items', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  // Three items in Journey order a -> mid -> b, but the registered dependency connects a and b directly (e.g. a codeshare leg pairing).
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', intendedWindow: window('2030-01-02T09:00:00.000Z', '2030-01-02T10:00:00.000Z') });
  const mid = transportItem(journeyId, { kind: 'ENGAGEMENT', orderKey: '015', desiredOriginPlaceId: null, desiredDestinationPlaceId: null, standaloneWindow: window('2030-01-02T10:15:00.000Z', '2030-01-02T10:45:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-b', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-02T11:00:00.000Z', '2030-01-02T12:00:00.000Z') });
  world.journeyItems.push(a, mid, b);
  world.dependencies.push({ id: id(), from: { kind: 'JOURNEY_ITEM', id: a.id }, to: { kind: 'JOURNEY_ITEM', id: b.id }, dependencyKind: 'CONNECTS_TO', constraintDefinitionId: null });
  const effective = effectiveOf(world);
  const out = connectionEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.applicable, true);
  const pair = dim?.explanations.find((e) => e.relatedSubjects.some((r) => r.id === a.id) && e.relatedSubjects.some((r) => r.id === b.id));
  assert.ok(pair, 'the CONNECTS_TO-linked pair (a, b) was evaluated');
  assert.equal(pair?.reasonCode, 'minimum_connection_time_missing');
});

// --------------------------------------------------------------------------
// m6.overnight
// --------------------------------------------------------------------------

function longGapJourney(world: World, journeyId: string) {
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-a', intendedWindow: window('2030-01-02T20:00:00.000Z', '2030-01-02T22:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-c', intendedWindow: window('2030-01-03T08:00:00.000Z', '2030-01-03T10:00:00.000Z') }); // 10h gap
  world.journeyItems.push(a, b);
  return { a, b };
}

test('overnight: without a governing overnight_accommodation_required constraint, the dimension is not applicable', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  longGapJourney(world, journeyId);
  const effective = effectiveOf(world);
  const out = overnightEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  assert.equal(out.dimensions[0]?.applicable, false);
});

test('overnight: an active STAY covering the gap at the same place PASSes stay_covers_gap', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  longGapJourney(world, journeyId);
  world.constraints.push(constraintRow(subjectOf(journeyId), 'overnight_accommodation_required', [numOperand('minimum_gap_hours', 6)]));
  world.journeyItems.push(stayItem(journeyId, { intendedPlaceId: 'place-a', intendedWindow: window('2030-01-02T21:00:00.000Z', '2030-01-03T09:00:00.000Z') }));
  const effective = effectiveOf(world);
  const out = overnightEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'stay_covers_gap');
});

test('overnight: no covering stay FAILs overnight_unaccommodated', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  longGapJourney(world, journeyId);
  world.constraints.push(constraintRow(subjectOf(journeyId), 'overnight_accommodation_required', [numOperand('minimum_gap_hours', 6)]));
  const effective = effectiveOf(world);
  const out = overnightEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.equal(dim?.explanations[0]?.reasonCode, 'overnight_unaccommodated');
});

test('overnight: a covering stay whose place relation cannot be established UNKNOWNs stay_place_unresolved', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  longGapJourney(world, journeyId);
  world.constraints.push(constraintRow(subjectOf(journeyId), 'overnight_accommodation_required', [numOperand('minimum_gap_hours', 6)]));
  // Different place from the gap's place, and no placeJurisdictions rows to prove or disprove a shared jurisdiction.
  world.journeyItems.push(stayItem(journeyId, { intendedPlaceId: 'place-hotel', intendedWindow: window('2030-01-02T21:00:00.000Z', '2030-01-03T09:00:00.000Z') }));
  const effective = effectiveOf(world);
  const out = overnightEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'stay_place_unresolved');
});

test('overnight: an unknown arrival or departure time UNKNOWNs overnight_gap_time_unknown', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-a', intendedWindow: window('2030-01-02T20:00:00.000Z', '2030-01-02T22:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-c', intendedWindow: null });
  world.journeyItems.push(a, b);
  world.constraints.push(constraintRow(subjectOf(journeyId), 'overnight_accommodation_required', [numOperand('minimum_gap_hours', 6)]));
  const effective = effectiveOf(world);
  const out = overnightEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'overnight_gap_time_unknown');
});

test('overnight: a STAY item whose own interval is unknown UNKNOWNs stay_interval_unknown rather than defaulting to FAIL', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  longGapJourney(world, journeyId);
  world.constraints.push(constraintRow(subjectOf(journeyId), 'overnight_accommodation_required', [numOperand('minimum_gap_hours', 6)]));
  world.journeyItems.push(stayItem(journeyId, { intendedPlaceId: 'place-a', intendedWindow: null }));
  const effective = effectiveOf(world);
  const out = overnightEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'stay_interval_unknown');
});

// --------------------------------------------------------------------------
// Determinism and composition
// --------------------------------------------------------------------------

test('determinism: evaluating the same world twice with all three L1 evaluators yields deepEqual output, and every declared dimension surfaces through assessSubject', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const { a, b } = longGapJourney(world, journeyId);
  addBooking(world, a, travellerId, { lineStatus: 'CONFIRMED' });
  addBooking(world, b, travellerId, { lineStatus: 'HELD' });
  world.constraints.push(
    constraintRow(subjectOf(journeyId), 'minimum_connection_minutes', [numOperand('minutes', 30)]),
    constraintRow(subjectOf(journeyId), 'overnight_accommodation_required', [numOperand('minimum_gap_hours', 6)]),
  );
  world.journeyItems.push(stayItem(journeyId, { intendedPlaceId: 'place-a', intendedWindow: window('2030-01-02T21:00:00.000Z', '2030-01-03T09:00:00.000Z') }));

  const registry = createEvaluatorRegistry([bookingEvaluator, connectionEvaluator, overnightEvaluator]);
  const run = () => {
    const effective = effectiveOf(world);
    return assessSubject({ registry, world, effective, subject: subjectOf(journeyId), now: NOW, assessmentId: 'fixed-assessment-id' });
  };
  const first = run();
  const second = run();
  assert.deepEqual(first.result, second.result);

  const dimensionNames = first.result.dimensions.map((d) => d.dimension).sort();
  assert.deepEqual(dimensionNames, ['booking_validity', 'connection_feasibility', 'overnight_accommodation', 'supplier_fulfilment'].sort());
  // supplier_fulfilment (UNKNOWN, blocking) and connection_feasibility (UNKNOWN, blocking) both block; overall must not be PASS.
  assert.notEqual(first.result.overallVerdict, 'PASS');
});
