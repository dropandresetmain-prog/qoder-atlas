/**
 * A5/CP4 — proposed-service preview on the focused Case graph.
 *
 * Pure tests over `selectProposedServicePreview` + `projectFocusedCaseGraphEnrichment`.
 * No PostgreSQL, no scenario tokens. Proves the four-stage lifecycle of a
 * recommended SELECT_OFFER replacement on the graph:
 *   1. before any proposal the canonical service is shown (no regression);
 *   2. once the recommended strategy has a bound proposed service, that service
 *      is previewed — PROPOSED, labelled from its itinerary, no invented code;
 *   3. no stale canonical card lingers beside the preview;
 *   4. once execution starts / canonical selection changes, the preview stops
 *      and the booked canonical service is shown from authoritative state.
 * Canonical selection is an input only; nothing here can mutate it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectFocusedCaseGraphEnrichment,
  selectProposedServicePreview,
  type FocusedCaseGraphEnrichmentInput,
  type JourneyItemRow,
  type TransportServiceRow,
} from '../src/app/target/readmodels/projectFocusedCaseGraph.ts';

const INBOUND_ARRIVAL = '2031-03-10T09:00:00.000Z';
const ONWARD_DEPARTURE = '2031-03-10T08:00:00.000Z';

function items(onwardServiceId: string): JourneyItemRow[] {
  return [
    { id: 'item-in', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '010', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'svc-in' },
    { id: 'item-on', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '020', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: onwardServiceId },
    { id: 'item-stay', journey_id: 'journey-1', kind: 'STAY', order_key: '030', lifecycle_status: 'PLANNED', intended_window_start: '2031-03-10T07:00:00.000Z', intended_window_end: '2031-03-13T03:00:00.000Z' },
  ];
}

const canonicalServices: TransportServiceRow[] = [
  { id: 'svc-in', mode: 'FLIGHT', operator: 'Carrier A', origin_place_id: 'p-origin', destination_place_id: 'p-hub', origin_place_name: 'Origin City', destination_place_name: 'Hub City', published_departure: null, published_arrival: '2031-03-10T06:00:00.000Z', estimated_arrival: INBOUND_ARRIVAL, service_code: 'CA100' },
  { id: 'svc-old', mode: 'FLIGHT', operator: 'Carrier A', origin_place_id: 'p-hub', destination_place_id: 'p-dest', origin_place_name: 'Hub City', destination_place_name: 'Destination City', published_departure: ONWARD_DEPARTURE, published_arrival: '2031-03-10T14:00:00.000Z', service_code: 'CA200' },
];

/** The recorded offer itinerary for the recommended replacement — no service code. */
const proposedRow: TransportServiceRow = {
  id: 'transport-service:proposal-1', mode: 'FLIGHT', operator: 'Carrier B',
  origin_place_id: 'p-hub', destination_place_id: 'p-dest',
  origin_place_name: 'Hub City', destination_place_name: 'Destination City',
  published_departure: '2031-03-10T13:00:00.000Z', published_arrival: '2031-03-10T19:00:00.000Z',
  service_code: null,
};

function baseInput(onwardServiceId = 'svc-old'): FocusedCaseGraphEnrichmentInput {
  return {
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: items(onwardServiceId),
    transportServices: canonicalServices,
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Traveller']]),
    caseId: 'case-1',
    // The persisted evaluator explanation judged the CANONICAL connection.
    causalPath: [{
      subjectRef: 'JOURNEY:journey-1',
      causeSubjectRef: 'JOURNEY_ITEM:item-in',
      dimension: 'connection_feasibility',
      reasonCode: 'connection_broken',
      evaluatorId: 'm6.connection',
      facts: { gapMinutes: -60, upstreamArrival: INBOUND_ARRIVAL, downstreamDeparture: ONWARD_DEPARTURE },
      relatedSubjectRefs: ['JOURNEY_ITEM:item-in', 'JOURNEY_ITEM:item-on'],
    }],
  };
}

const TIMING = 'TIMING:item-in:ARRIVAL';

test('CP4 preview 1: before any proposal the canonical onward service is shown', () => {
  const result = projectFocusedCaseGraphEnrichment(baseInput());
  const old = result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:svc-old');
  assert.ok(old, 'canonical onward card present');
  assert.equal(old.authority, 'AUTHORITATIVE');
  assert.equal(old.semanticState, 'FAILED', 'the broken connection is painted on the booking it judged');
  assert.equal(result.nodes.some((node) => node.authority === 'PROPOSED'), false);
  const connection = result.edges.find((edge) => edge.id === `MUST_HAPPEN_BEFORE:${TIMING}:SERVICE_BOOKING:svc-old`);
  assert.equal(connection?.semanticState, 'FAILED');
  assert.equal(connection?.authority, 'AUTHORITATIVE');
});

test('CP4 preview 2: the recommended proposed service is previewed as PROPOSED from its itinerary', () => {
  const proposedServiceByJourneyItem = selectProposedServicePreview({
    journeyItems: items('svc-old'),
    bindings: [{ journeyItemId: 'item-on', proposedTransportServiceId: proposedRow.id }],
    executionStarted: false,
  });
  assert.deepEqual([...proposedServiceByJourneyItem], [['item-on', proposedRow.id]]);
  const result = projectFocusedCaseGraphEnrichment({
    ...baseInput(),
    proposedServiceByJourneyItem,
    proposedTransportServices: [proposedRow],
  });
  const preview = result.nodes.find((node) => node.ref === `SERVICE_BOOKING:${proposedRow.id}`);
  assert.ok(preview, 'preview card present');
  assert.equal(preview.authority, 'PROPOSED');
  assert.equal(preview.semanticState, 'PROPOSED', 'never HEALTHY/FAILED by borrowed truth');
  // Operator + mode from the itinerary; no service code exists, none is invented.
  assert.equal(preview.label, 'Carrier B flight');
  assert.equal(preview.detail, 'Hub City → Destination City · Proposed replacement · not booked yet');
  assert.doesNotMatch(preview.detail ?? '', /unreachable/i, 'the canonical broken-connection verdict is not transplanted');
  assert.ok(preview.subjectRefs?.includes('JOURNEY_ITEM:item-on'), 'the item explanation maps onto the preview');
  // Arrival → proposed onward: the relationship is shown, as a proposed one.
  const connection = result.edges.find((edge) => edge.id === `MUST_HAPPEN_BEFORE:${TIMING}:SERVICE_BOOKING:${proposedRow.id}`);
  assert.ok(connection, 'arrival timing connects to the proposed onward service');
  assert.equal(connection.semanticState, 'PROPOSED');
  assert.equal(connection.authority, 'PROPOSED');
  const reliesOn = result.edges.find((edge) => edge.id === `RELIES_ON:JOURNEY:journey-1:SERVICE_BOOKING:${proposedRow.id}`);
  assert.equal(reliesOn?.authority, 'PROPOSED', 'the traveller does not yet rely on an unbooked service');
  const onwardToStay = result.edges.find((edge) => edge.id === `MUST_HAPPEN_BEFORE:SERVICE_BOOKING:${proposedRow.id}:TRANSFER_STAY:item-stay`);
  assert.equal(onwardToStay?.authority, 'PROPOSED');
  // The canonical inbound leg is untouched.
  assert.equal(result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:svc-in')?.authority, 'AUTHORITATIVE');
  assert.equal(result.nodes.find((node) => node.ref === TIMING)?.authority, 'AUTHORITATIVE');
});

test('CP4 preview 3: no stale canonical onward card lingers beside the proposal', () => {
  const result = projectFocusedCaseGraphEnrichment({
    ...baseInput(),
    proposedServiceByJourneyItem: new Map([['item-on', proposedRow.id]]),
    proposedTransportServices: [proposedRow],
  });
  const mentionsOld = (ref: string) => ref.includes('svc-old');
  assert.equal(result.nodes.some((node) => mentionsOld(node.ref) || (node.subjectRefs ?? []).some(mentionsOld)), false);
  assert.equal(result.edges.some((edge) => mentionsOld(edge.fromRef) || mentionsOld(edge.toRef)), false);
  assert.equal(result.nodes.filter((node) => node.kind === 'SERVICE_BOOKING').length, 2, 'inbound + one onward card');
});

test('CP4 preview 4: after execution the booked canonical service is shown and the preview is gone', () => {
  // Execution of the recommended strategy has started: no preview at all.
  assert.equal(selectProposedServicePreview({
    journeyItems: items('svc-old'),
    bindings: [{ journeyItemId: 'item-on', proposedTransportServiceId: proposedRow.id }],
    executionStarted: true,
  }).size, 0);
  // Observation has rebound the canonical selection to the booked service.
  const bookedItems = items('svc-booked');
  const preview = selectProposedServicePreview({
    journeyItems: bookedItems,
    bindings: [{ journeyItemId: 'item-on', proposedTransportServiceId: proposedRow.id }],
    executionStarted: true,
  });
  const booked: TransportServiceRow = { ...proposedRow, id: 'svc-booked', service_code: 'CB300' };
  const result = projectFocusedCaseGraphEnrichment({
    ...baseInput('svc-booked'),
    transportServices: [canonicalServices[0]!, booked],
    transportBookingFacts: [{ journeyId: 'journey-1', serviceId: 'svc-booked', lineCount: 1, lineStatus: 'CONFIRMED', reservationStatus: 'CONFIRMED', observedAt: '2031-03-10T10:00:00.000Z' }],
    causalPath: [],
    proposedServiceByJourneyItem: preview,
  });
  const card = result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:svc-booked');
  assert.ok(card, 'booked canonical card present');
  assert.equal(card.authority, 'AUTHORITATIVE');
  assert.equal(card.semanticState, 'HEALTHY');
  assert.equal(card.label, 'Carrier B CB300 flight', 'the canonical row supplies the real service code');
  assert.equal(result.nodes.some((node) => node.ref.includes('proposal-1') || node.authority === 'PROPOSED'), false);
  assert.equal(result.edges.some((edge) => edge.authority === 'PROPOSED'), false);
});

test('CP4 preview: a proposal equal to canonical, a non-transport item, an unknown item, or an ambiguous item previews nothing', () => {
  const journeyItems = items('svc-old');
  assert.equal(selectProposedServicePreview({
    journeyItems,
    bindings: [{ journeyItemId: 'item-on', proposedTransportServiceId: 'svc-old' }],
    executionStarted: false,
  }).size, 0, 'already canonical');
  assert.equal(selectProposedServicePreview({
    journeyItems,
    bindings: [
      { journeyItemId: 'item-stay', proposedTransportServiceId: 'transport-service:x' },
      { journeyItemId: 'item-elsewhere', proposedTransportServiceId: 'transport-service:y' },
    ],
    executionStarted: false,
  }).size, 0, 'non-transport and out-of-case items');
  assert.equal(selectProposedServicePreview({
    journeyItems,
    bindings: [
      { journeyItemId: 'item-on', proposedTransportServiceId: 'transport-service:a' },
      { journeyItemId: 'item-on', proposedTransportServiceId: 'transport-service:b' },
      { journeyItemId: 'item-on', proposedTransportServiceId: 'transport-service:a' },
    ],
    executionStarted: false,
  }).size, 0, 'two different proposals for one item are ambiguous, never guessed');
});

test('CP4 preview: an itinerary-derived row never shadows a canonical row with the same id', () => {
  const result = projectFocusedCaseGraphEnrichment({
    ...baseInput(),
    proposedServiceByJourneyItem: new Map([['item-on', 'svc-in']]),
    proposedTransportServices: [{ ...proposedRow, id: 'svc-in', operator: 'Impostor' }],
  });
  assert.equal(result.nodes.some((node) => node.label.includes('Impostor')), false);
});
