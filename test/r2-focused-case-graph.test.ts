/**
 * R2 — focused Case graph enrichment projector tests.
 *
 * Pure tests over `projectFocusedCaseGraphEnrichment`. No PostgreSQL, no browser,
 * no scenario tokens. Proves the enrichment correctly adds journey composition
 * nodes (SERVICE_BOOKING, TRANSFER_STAY), programme commitment nodes, and their
 * edges, while respecting assessment views and deterministic ordering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWindowInTimeZone, projectFocusedCaseGraphEnrichment } from '../src/app/target/readmodels/projectFocusedCaseGraph.ts';

test('R2 enrichment: creates SERVICE_BOOKING node for transport item with service', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'FLIGHT', operator: 'Airline X', origin_place_id: 'CDG', destination_place_id: 'JFK', origin_place_name: 'Paris CDG', destination_place_name: 'New York JFK', published_departure: null, published_arrival: null }],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 1);
  const node = result.nodes[0]!;
  assert.equal(node.kind, 'SERVICE_BOOKING');
  assert.equal(node.ref, 'SERVICE_BOOKING:service-1');
  assert.equal(node.label, 'Airline X flight');
  assert.equal(node.detail, 'Paris CDG → New York JFK', 'human place names, never place ids');
  assert.equal(node.semanticState, 'UNKNOWN');
  assert.equal(node.caseRef, 'case-1');
});

test('R2 enrichment: creates RELIES_ON edge from journey to service', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'FLIGHT', operator: 'Airline X', origin_place_id: 'CDG', destination_place_id: 'JFK', published_departure: null, published_arrival: null }],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.edges.length, 1);
  const edge = result.edges[0]!;
  assert.equal(edge.kind, 'RELIES_ON');
  assert.equal(edge.fromRef, 'JOURNEY:journey-1');
  assert.equal(edge.toRef, 'SERVICE_BOOKING:service-1');
  assert.equal(edge.id, 'RELIES_ON:JOURNEY:journey-1:SERVICE_BOOKING:service-1');
});

test('R2 enrichment: creates MUST_HAPPEN_BEFORE edges between ordered services', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' },
      { id: 'item-2', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '002', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-2' },
    ],
    transportServices: [
      { id: 'service-1', mode: 'FLIGHT', operator: 'Airline X', origin_place_id: 'CDG', destination_place_id: 'JFK', published_departure: null, published_arrival: null },
      { id: 'service-2', mode: 'TRAIN', operator: 'Rail Y', origin_place_id: 'JFK', destination_place_id: 'BOS', published_departure: null, published_arrival: null },
    ],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 3); // 2 RELIES_ON + 1 MUST_HAPPEN_BEFORE
  
  const mustHappenBefore = result.edges.find(e => e.kind === 'MUST_HAPPEN_BEFORE');
  assert.ok(mustHappenBefore);
  assert.equal(mustHappenBefore.fromRef, 'SERVICE_BOOKING:service-1');
  assert.equal(mustHappenBefore.toRef, 'SERVICE_BOOKING:service-2');
  assert.equal(mustHappenBefore.id, 'MUST_HAPPEN_BEFORE:SERVICE_BOOKING:service-1:SERVICE_BOOKING:service-2');
});

test('A1 enrichment: uses exact reservation evidence for service node state', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'FLIGHT', operator: 'Airline X', origin_place_id: 'CDG', destination_place_id: 'JFK', published_departure: null, published_arrival: null }],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map([['SERVICE_BOOKING:service-1', { status: 'CURRENT', tone: 'FAIL' }]]),
    transportBookingFacts: [{ journeyId: 'journey-1', serviceId: 'service-1', lineCount: 1, lineStatus: 'CONFIRMED', reservationStatus: 'CONFIRMED', observedAt: '2031-04-05T08:00:00.000Z' }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  const node = result.nodes[0]!;
  assert.equal(node.semanticState, 'HEALTHY', 'a confirmed booking alone does not prove recovery');
  assert.match(node.detail ?? '', /Booking line confirmed/);
});

test('A1 enrichment: selected-service booking remains UNKNOWN when allocation is absent or ambiguous', () => {
  const base = {
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT' as const, order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'AIR', operator: 'ID', origin_place_id: 'origin', destination_place_id: 'destination', published_departure: null, published_arrival: null }],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map([['SERVICE_BOOKING:service-1', { status: 'CURRENT' as const, tone: 'PASS' as const }]]),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  };
  const absent = projectFocusedCaseGraphEnrichment(base);
  assert.equal(absent.nodes[0]?.semanticState, 'UNKNOWN');
  const ambiguous = projectFocusedCaseGraphEnrichment({
    ...base,
    transportBookingFacts: [{ journeyId: 'journey-1', serviceId: 'service-1', lineCount: 2, lineStatus: null, reservationStatus: null }],
  });
  assert.equal(ambiguous.nodes[0]?.semanticState, 'UNKNOWN');
  const cancelled = projectFocusedCaseGraphEnrichment({
    ...base,
    transportBookingFacts: [{ journeyId: 'journey-1', serviceId: 'service-1', lineCount: 1, lineStatus: 'CONFIRMED', reservationStatus: 'CANCELLED' }],
  });
  assert.equal(cancelled.nodes[0]?.semanticState, 'UNKNOWN', 'conflicting reservation evidence cannot become confirmed recovery');
  const recovered = projectFocusedCaseGraphEnrichment({
    ...base,
    changedTransportServiceRefs: new Set(['service-1']),
    reprotectedTransportServiceRefs: new Set(['service-1']),
    transportBookingFacts: [{ journeyId: 'journey-1', serviceId: 'service-1', lineCount: 1, lineStatus: 'CONFIRMED', reservationStatus: 'CONFIRMED' }],
  });
  assert.equal(recovered.nodes[0]?.semanticState, 'RECOVERED');
  const delayed = projectFocusedCaseGraphEnrichment({
    ...base,
    changedTransportServiceRefs: new Set(['service-1']),
    transportBookingFacts: [{ journeyId: 'journey-1', serviceId: 'service-1', lineCount: 1, lineStatus: 'CONFIRMED', reservationStatus: 'CONFIRMED' }],
  });
  assert.equal(delayed.nodes[0]?.semanticState, 'CHANGED', 'a schedule deterioration does not prove supplier recovery');
});

test('A1 enrichment: emits a changed source edge only for the proven selected service', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'AIR', operator: 'ID', origin_place_id: 'origin', destination_place_id: 'destination', published_departure: null, published_arrival: null }],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    changeSignalRef: 'CHANGE_SIGNAL:signal-1', changedTransportServiceRefs: new Set(['service-1']),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });
  assert.deepEqual(result.edges.find((edge) => edge.id === 'AFFECTED_BY:CHANGE_SIGNAL:signal-1:SERVICE_BOOKING:service-1'), {
    id: 'AFFECTED_BY:CHANGE_SIGNAL:signal-1:SERVICE_BOOKING:service-1',
    fromRef: 'CHANGE_SIGNAL:signal-1',
    toRef: 'SERVICE_BOOKING:service-1',
    kind: 'AFFECTED_BY',
    authority: 'AUTHORITATIVE',
    semanticState: 'CHANGED',
  });
});

test('R2 enrichment: skips transport item without selected service', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: null }],
    transportServices: [],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
});

test('R2 enrichment: creates TRANSFER_STAY node for stay item', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'STAY', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: '2026-01-15T14:00:00Z', intended_window_end: '2026-01-16T10:00:00Z', timeZone: 'Asia/Singapore', selectedServiceId: null }],
    transportServices: [],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 1);
  const node = result.nodes[0]!;
  assert.equal(node.kind, 'TRANSFER_STAY');
  assert.equal(node.ref, 'TRANSFER_STAY:item-1');
  assert.equal(node.detail, '15 Jan 22:00 → 16 Jan 18:00 GMT+8');
});

test('R2 enrichment: creates PROGRAMME_COMMITMENT node for accepted participation', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [{ id: 'participation-1', programme_item_id: 'programme-item-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true }],
    programmeItems: [{ id: 'programme-item-1', programme_id: 'programme-1', title: 'Conference Keynote', item_type: 'SESSION', window_start: '2026-01-15T09:00:00Z', window_end: '2026-01-15T10:00:00Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 1);
  const node = result.nodes[0]!;
  assert.equal(node.kind, 'PROGRAMME_COMMITMENT');
  assert.equal(node.ref, 'PROGRAMME_ITEM:programme-item-1');
  assert.equal(node.label, 'Conference Keynote');
  assert.equal(node.detail, '15 Jan 09:00 → 10:00 UTC');
});

test('R2 enrichment: creates PARTICIPATES_IN edge from journey to programme item', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [{ id: 'participation-1', programme_item_id: 'programme-item-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true }],
    programmeItems: [{ id: 'programme-item-1', programme_id: 'programme-1', title: 'Conference Keynote', item_type: 'SESSION', window_start: '2026-01-15T09:00:00Z', window_end: '2026-01-15T10:00:00Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.edges.length, 1);
  const edge = result.edges[0]!;
  assert.equal(edge.kind, 'PARTICIPATES_IN');
  assert.equal(edge.fromRef, 'JOURNEY:journey-1');
  assert.equal(edge.toRef, 'PROGRAMME_ITEM:programme-item-1');
  assert.equal(edge.id, 'PARTICIPATES_IN:JOURNEY:journey-1:PROGRAMME_ITEM:programme-item-1');
});

test('R2 enrichment: skips non-accepted participation', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [{ id: 'participation-1', programme_item_id: 'programme-item-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: false }],
    programmeItems: [{ id: 'programme-item-1', programme_id: 'programme-1', title: 'Conference Keynote', item_type: 'SESSION', window_start: '2026-01-15T09:00:00Z', window_end: '2026-01-15T10:00:00Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
});

test('R2 enrichment: skips cancelled programme item', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [{ id: 'participation-1', programme_item_id: 'programme-item-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true }],
    programmeItems: [{ id: 'programme-item-1', programme_id: 'programme-1', title: 'Conference Keynote', item_type: 'SESSION', window_start: '2026-01-15T09:00:00Z', window_end: '2026-01-15T10:00:00Z', lifecycle_status: 'CANCELLED' }],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
});

test('R2 enrichment: mixed enrichment (transport + stay + programme)', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' },
      { id: 'item-2', journey_id: 'journey-1', kind: 'STAY', order_key: '002', lifecycle_status: 'PLANNED', intended_window_start: '2026-01-15T14:00:00Z', intended_window_end: '2026-01-16T10:00:00Z', selectedServiceId: null },
    ],
    transportServices: [{ id: 'service-1', mode: 'FLIGHT', operator: 'Airline X', origin_place_id: 'CDG', destination_place_id: 'JFK', published_departure: null, published_arrival: null }],
    participations: [{ id: 'participation-1', programme_item_id: 'programme-item-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true }],
    programmeItems: [{ id: 'programme-item-1', programme_id: 'programme-1', title: 'Conference Keynote', item_type: 'SESSION', window_start: '2026-01-15T09:00:00Z', window_end: '2026-01-15T10:00:00Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 3); // 1 SERVICE_BOOKING + 1 TRANSFER_STAY + 1 PROGRAMME_COMMITMENT
  assert.equal(result.edges.length, 4); // 2 RELIES_ON + 1 MUST_HAPPEN_BEFORE + 1 PARTICIPATES_IN

  const nodeKinds = result.nodes.map(n => n.kind).sort();
  assert.deepEqual(nodeKinds, ['PROGRAMME_COMMITMENT', 'SERVICE_BOOKING', 'TRANSFER_STAY']);

  const edgeKinds = result.edges.map(e => e.kind).sort();
  assert.deepEqual(edgeKinds, ['MUST_HAPPEN_BEFORE', 'PARTICIPATES_IN', 'RELIES_ON', 'RELIES_ON']);
});

test('R2 enrichment: empty inputs return empty nodes and edges', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [],
    journeys: [],
    journeyItems: [],
    transportServices: [],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map(),
    caseId: 'case-1',
  });

  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
});

test('R2 enrichment: deterministic ordering by order_key', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'item-3', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '003', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-3' },
      { id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' },
      { id: 'item-2', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '002', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-2' },
    ],
    transportServices: [
      { id: 'service-1', mode: 'FLIGHT', operator: 'Airline A', origin_place_id: 'CDG', destination_place_id: 'JFK', published_departure: null, published_arrival: null },
      { id: 'service-2', mode: 'TRAIN', operator: 'Rail B', origin_place_id: 'JFK', destination_place_id: 'BOS', published_departure: null, published_arrival: null },
      { id: 'service-3', mode: 'BUS', operator: 'Coach C', origin_place_id: 'BOS', destination_place_id: 'NYC', published_departure: null, published_arrival: null },
    ],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  const mustHappenBeforeEdges = result.edges.filter(e => e.kind === 'MUST_HAPPEN_BEFORE');
  assert.equal(mustHappenBeforeEdges.length, 2);
  
  // Should be ordered by order_key: 001 -> 002 -> 003
  assert.equal(mustHappenBeforeEdges[0]!.fromRef, 'SERVICE_BOOKING:service-1');
  assert.equal(mustHappenBeforeEdges[0]!.toRef, 'SERVICE_BOOKING:service-2');
  assert.equal(mustHappenBeforeEdges[1]!.fromRef, 'SERVICE_BOOKING:service-2');
  assert.equal(mustHappenBeforeEdges[1]!.toRef, 'SERVICE_BOOKING:service-3');
});

test('A1 enrichment: projects canonical objectives without copying a journey failure', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [],
    programmeItems: [],
    objectives: [{ id: 'obj-1', owner_kind: 'JOURNEY', owner_id: 'journey-1', success_predicate: 'Arrive on time', success_predicate_kind: 'ARRIVAL_BY', hardness: 'HARD', priority: 1 }],
    assessmentViews: new Map(),
    causalPath: [{
      subjectRef: 'JOURNEY:journey-1',
      causeSubjectRef: 'OBJECTIVE:obj-1',
      dimension: 'hard_objectives',
      reasonCode: 'arrival_after_deadline',
      evaluatorId: 'm6.objective',
      facts: {},
      relatedSubjectRefs: ['OBJECTIVE:obj-1'],
    }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  const node = result.nodes.find((candidate) => candidate.ref === 'OBJECTIVE:obj-1');
  assert.ok(node);
  assert.equal(node.kind, 'TRIP_OBJECTIVE');
  assert.equal(node.label, 'Arrive on time');
  assert.equal(node.semanticState, 'FAILED');
  assert.deepEqual(node.subjectRefs, ['OBJECTIVE:obj-1']);
});

test('A1 enrichment: leaves an objective UNKNOWN without objective-specific evidence', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [],
    programmeItems: [],
    objectives: [{ id: 'obj-1', owner_kind: 'JOURNEY', owner_id: 'journey-1', success_predicate: 'Arrive on time', success_predicate_kind: 'ARRIVAL_BY', hardness: 'HARD', priority: 1 }],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  const node = result.nodes.find((candidate) => candidate.ref === 'OBJECTIVE:obj-1');
  assert.ok(node);
  assert.equal(node.semanticState, 'UNKNOWN');
});

test('A1 enrichment: maps service and timing facts one-to-one from canonical timing plus explanation refs', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'origin', destination_place_id: 'destination', published_departure: null, published_arrival: '2031-04-05T08:00:00.000Z', estimated_arrival: '2031-04-05T10:30:00.000Z', actual_arrival: '2031-04-05T10:45:00.000Z', destination_time_zone: 'Asia/Singapore' }],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'JOURNEY_ITEM:item-1', dimension: 'connection_feasibility', reasonCode: 'connection_impossible', evaluatorId: 'm6.connection', facts: { upstreamArrival: '2031-04-05T10:45:00.000Z' }, relatedSubjectRefs: ['JOURNEY_ITEM:item-1'] }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });

  const timing = result.nodes.find((node) => node.kind === 'TIMING');
  assert.ok(timing);
  assert.equal(timing.ref, 'TIMING:item-1:ARRIVAL');
  assert.equal(timing.semanticState, 'CHANGED');
  assert.deepEqual(timing.subjectRefs, ['JOURNEY_ITEM:item-1']);
  assert.deepEqual(timing.timing, {
    currentAt: '2031-04-05T10:45:00.000Z',
    publishedAt: '2031-04-05T08:00:00.000Z',
    timeZone: 'Asia/Singapore',
  });
  assert.deepEqual(result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:service-1')?.subjectRefs, ['TRANSPORT_SERVICE:service-1']);
  assert.ok(result.edges.some((edge) => edge.fromRef === 'SERVICE_BOOKING:service-1' && edge.toRef === timing.ref));
});

test('A1 enrichment: shows an evaluator-implicated replacement arrival without inventing a delay', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'replacement-service' }],
    transportServices: [{ id: 'replacement-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'origin', destination_place_id: 'destination', published_departure: null, published_arrival: '2031-04-05T10:30:00.000Z', estimated_arrival: null, actual_arrival: null, destination_time_zone: 'Asia/Singapore' }],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'OBJECTIVE:obj-1', dimension: 'hard_objectives', reasonCode: 'arrival_after_deadline', evaluatorId: 'm6.objective', facts: { arrival: '2031-04-05T10:30:00.000Z' }, relatedSubjectRefs: ['JOURNEY_ITEM:item-1'] }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });

  const timing = result.nodes.find((node) => node.kind === 'TIMING');
  assert.ok(timing);
  assert.equal(timing.semanticState, 'AFFECTED');
  assert.deepEqual(timing.timing, { currentAt: '2031-04-05T10:30:00.000Z', publishedAt: '2031-04-05T10:30:00.000Z', timeZone: 'Asia/Singapore' });
  assert.deepEqual(timing.subjectRefs, ['JOURNEY_ITEM:item-1']);
  assert.deepEqual(result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:replacement-service')?.subjectRefs, ['TRANSPORT_SERVICE:replacement-service']);
});

test('A1 enrichment: connection facts mark only the upstream arrival, never its related onward service', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'inbound', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'inbound-service' },
      { id: 'onward', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '002', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'onward-service' },
    ],
    transportServices: [
      { id: 'inbound-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'origin', destination_place_id: 'hub', published_departure: null, published_arrival: '2031-04-05T08:00:00.000Z', estimated_arrival: '2031-04-05T10:30:00.000Z', actual_arrival: null },
      { id: 'onward-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'hub', destination_place_id: 'destination', published_departure: null, published_arrival: '2031-04-05T12:00:00.000Z', estimated_arrival: '2031-04-05T12:15:00.000Z', actual_arrival: null },
    ],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'CONSTRAINT_DEFINITION:min-connection', dimension: 'connection_feasibility', reasonCode: 'connection_below_minimum', evaluatorId: 'm6.connection', facts: { upstreamArrival: '2031-04-05T10:30:00.000Z', downstreamDeparture: '2031-04-05T10:40:00.000Z', gapMinutes: 10 }, relatedSubjectRefs: ['JOURNEY_ITEM:inbound', 'JOURNEY_ITEM:onward'] }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });
  assert.deepEqual(result.nodes.filter((node) => node.kind === 'TIMING').map((node) => node.ref), ['TIMING:inbound:ARRIVAL']);
  assert.equal(result.nodes.find((node) => node.ref === 'TIMING:inbound:ARRIVAL')?.semanticState, 'CHANGED');
  // Topology booking→booking remains, but connection colour lives only on the
  // arrival→onward edge when a timing node exists (one connection story).
  assert.equal(
    result.edges.find((edge) => edge.id === 'MUST_HAPPEN_BEFORE:SERVICE_BOOKING:inbound-service:SERVICE_BOOKING:onward-service')?.semanticState,
    undefined,
  );
  assert.equal(
    result.edges.find((edge) => edge.id === 'MUST_HAPPEN_BEFORE:TIMING:inbound:ARRIVAL:SERVICE_BOOKING:onward-service')?.semanticState,
    'AFFECTED',
  );
});

test('A1 enrichment: broken connection marks the arrival→onward relationship FAILED while delayed arrival stays CHANGED', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'inbound', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'inbound-service' },
      { id: 'onward', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '002', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'onward-service' },
    ],
    transportServices: [
      { id: 'inbound-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'origin', destination_place_id: 'hub', published_departure: null, published_arrival: '2031-04-05T08:00:00.000Z', estimated_arrival: '2031-04-05T12:00:00.000Z', actual_arrival: null },
      { id: 'onward-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'hub', destination_place_id: 'destination', published_departure: null, published_arrival: '2031-04-05T11:00:00.000Z', estimated_arrival: null, actual_arrival: null },
    ],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'JOURNEY_ITEM:inbound', dimension: 'connection_feasibility', reasonCode: 'connection_broken', evaluatorId: 'm6.connection', facts: { upstreamArrival: '2031-04-05T12:00:00.000Z', downstreamDeparture: '2031-04-05T11:00:00.000Z', gapMinutes: -60 }, relatedSubjectRefs: ['JOURNEY_ITEM:inbound', 'JOURNEY_ITEM:onward'] }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });
  assert.equal(result.nodes.find((node) => node.ref === 'TIMING:inbound:ARRIVAL')?.semanticState, 'CHANGED');
  assert.equal(result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:onward-service')?.semanticState, 'FAILED');
  assert.equal(
    result.edges.find((edge) => edge.id === 'MUST_HAPPEN_BEFORE:SERVICE_BOOKING:inbound-service:SERVICE_BOOKING:onward-service')?.semanticState,
    undefined,
  );
  assert.equal(
    result.edges.find((edge) => edge.id === 'MUST_HAPPEN_BEFORE:TIMING:inbound:ARRIVAL:SERVICE_BOOKING:onward-service')?.semanticState,
    'FAILED',
  );
});

test('A1 enrichment: reversed relatedSubjectRefs still paint timing→onward and onward FAILED', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'inbound', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'inbound-service' },
      { id: 'onward', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '002', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'onward-service' },
    ],
    transportServices: [
      { id: 'inbound-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'origin', destination_place_id: 'hub', published_departure: null, published_arrival: '2031-04-05T08:00:00.000Z', estimated_arrival: '2031-04-05T12:00:00.000Z', actual_arrival: null },
      { id: 'onward-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'hub', destination_place_id: 'destination', published_departure: null, published_arrival: '2031-04-05T11:00:00.000Z', estimated_arrival: null, actual_arrival: null },
    ],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    // Alphabetical sort of UUIDs/ids would put "onward" before "inbound".
    causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'JOURNEY_ITEM:inbound', dimension: 'connection_feasibility', reasonCode: 'connection_broken', evaluatorId: 'm6.connection', facts: { upstreamArrival: '2031-04-05T12:00:00.000Z', downstreamDeparture: '2031-04-05T11:00:00.000Z', gapMinutes: -60 }, relatedSubjectRefs: ['JOURNEY_ITEM:onward', 'JOURNEY_ITEM:inbound'] }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });
  assert.equal(result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:onward-service')?.semanticState, 'FAILED');
  assert.equal(
    result.edges.find((edge) => edge.id === 'MUST_HAPPEN_BEFORE:TIMING:inbound:ARRIVAL:SERVICE_BOOKING:onward-service')?.semanticState,
    'FAILED',
  );
  assert.equal(
    result.edges.find((edge) => edge.id === 'MUST_HAPPEN_BEFORE:TIMING:onward:ARRIVAL:SERVICE_BOOKING:inbound-service'),
    undefined,
  );
});

test('A1 enrichment: departure failure does not mark its arrival context as failed timing', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'inbound', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'inbound-service' }],
    transportServices: [{ id: 'inbound-service', mode: 'FLIGHT', operator: 'Carrier', origin_place_id: 'origin', destination_place_id: 'venue', published_departure: null, published_arrival: '2031-04-05T08:00:00.000Z', estimated_arrival: null, actual_arrival: null }],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'PROGRAMME_ITEM:session', dimension: 'programme_participation', reasonCode: 'departs_before_item_ends', evaluatorId: 'm6.participation', facts: { arrival: '2031-04-05T08:00:00.000Z', actualDeparture: '2031-04-05T09:00:00.000Z' }, relatedSubjectRefs: ['JOURNEY_ITEM:inbound', 'JOURNEY_ITEM:onward'] }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  });
  assert.equal(result.nodes.some((node) => node.kind === 'TIMING'), false);
  assert.deepEqual(result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:inbound-service')?.subjectRefs, ['TRANSPORT_SERVICE:inbound-service', 'JOURNEY_ITEM:inbound']);
});

test('A1 enrichment: a commitment fails only from its own assessment or participation explanation', () => {
  const input = {
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [], transportServices: [],
    participations: [{ id: 'p-1', programme_item_id: 'programme-1', traveller_id: 'traveller-1', obligation: 'REQUIRED' as const, accepted: true }],
    programmeItems: [{ id: 'programme-1', programme_id: 'programme', title: 'Required session', item_type: 'SESSION', window_start: '2031-04-05T09:00:00.000Z', window_end: '2031-04-05T10:00:00.000Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [], assessmentViews: new Map(), travellerLabelsByJourney: new Map([['journey-1', 'Alice']]), caseId: 'case-1',
  };
  const generic = projectFocusedCaseGraphEnrichment({ ...input, causalPath: [{ subjectRef: 'JOURNEY:journey-1', dimension: 'connection_feasibility', reasonCode: 'connection_impossible', evaluatorId: 'm6.connection', facts: {}, relatedSubjectRefs: [] }] });
  const specific = projectFocusedCaseGraphEnrichment({ ...input, causalPath: [{ subjectRef: 'JOURNEY:journey-1', causeSubjectRef: 'PROGRAMME_ITEM:programme-1', dimension: 'programme_participation', reasonCode: 'arrival_after_required_start', evaluatorId: 'm6.participation', facts: {}, relatedSubjectRefs: [] }] });
  assert.equal(generic.nodes.find((node) => node.ref === 'PROGRAMME_ITEM:programme-1')?.semanticState, 'UNKNOWN');
  assert.equal(specific.nodes.find((node) => node.ref === 'PROGRAMME_ITEM:programme-1')?.semanticState, 'FAILED');
});

test('A2 enrichment: an exact current participant PASS makes its commitment healthy', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [{ id: 'participation-1', programme_item_id: 'programme-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true }],
    programmeItems: [{ id: 'programme-1', programme_id: 'programme', title: 'Required session', item_type: 'SESSION', window_start: '2031-04-05T09:00:00.000Z', window_end: '2031-04-05T10:00:00.000Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    programmeParticipationAssessments: [{
      journeyId: 'journey-1', travellerId: 'traveller-1', participationId: 'participation-1', programmeId: 'programme', programmeItemId: 'programme-1', status: 'CURRENT', tone: 'PASS',
    }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });
  const node = result.nodes.find((candidate) => candidate.ref === 'PROGRAMME_ITEM:programme-1');
  assert.ok(node);
  assert.equal(node.semanticState, 'HEALTHY');
  assert.equal(node.evaluation, 'CURRENT');
});

test('A2 enrichment: contradictory participant scopes never average to green', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [
      { subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' },
      { subject_kind: 'JOURNEY', subject_id: 'journey-2', role: 'AFFECTED_TRAVELLER' },
    ],
    journeys: [
      { id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null },
      { id: 'journey-2', trip_id: 'trip-1', traveller_id: 'traveller-2', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null },
    ],
    journeyItems: [],
    transportServices: [],
    participations: [
      { id: 'participation-1', programme_item_id: 'programme-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true },
      { id: 'participation-2', programme_item_id: 'programme-1', traveller_id: 'traveller-2', obligation: 'REQUIRED', accepted: true },
    ],
    programmeItems: [{ id: 'programme-1', programme_id: 'programme', title: 'Shared session', item_type: 'SESSION', window_start: '2031-04-05T09:00:00.000Z', window_end: '2031-04-05T10:00:00.000Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    programmeParticipationAssessments: [
      { journeyId: 'journey-1', travellerId: 'traveller-1', participationId: 'participation-1', programmeId: 'programme', programmeItemId: 'programme-1', status: 'CURRENT', tone: 'PASS' },
      { journeyId: 'journey-2', travellerId: 'traveller-2', participationId: 'participation-2', programmeId: 'programme', programmeItemId: 'programme-1', status: 'PENDING_REASSESSMENT', tone: 'UNKNOWN' },
      { journeyId: 'journey-outside', travellerId: 'traveller-outside', participationId: 'participation-outside', programmeId: 'programme', programmeItemId: 'programme-1', status: 'CURRENT', tone: 'FAIL' },
    ],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice'], ['journey-2', 'Bob']]),
    caseId: 'case-1',
  });
  const node = result.nodes.find((candidate) => candidate.ref === 'PROGRAMME_ITEM:programme-1');
  assert.ok(node);
  assert.equal(node.semanticState, 'UNKNOWN');
  assert.equal(node.evaluation, 'PENDING_REASSESSMENT');
});

test('A2 enrichment: missing participant scope does not inherit CURRENT lifecycle', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [
      { subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' },
      { subject_kind: 'JOURNEY', subject_id: 'journey-2', role: 'AFFECTED_TRAVELLER' },
    ],
    journeys: [
      { id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null },
      { id: 'journey-2', trip_id: 'trip-1', traveller_id: 'traveller-2', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null },
    ],
    journeyItems: [],
    transportServices: [],
    participations: [
      { id: 'participation-1', programme_item_id: 'programme-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true },
      { id: 'participation-2', programme_item_id: 'programme-1', traveller_id: 'traveller-2', obligation: 'REQUIRED', accepted: true },
    ],
    programmeItems: [{ id: 'programme-1', programme_id: 'programme', title: 'Shared session', item_type: 'SESSION', window_start: '2031-04-05T09:00:00.000Z', window_end: '2031-04-05T10:00:00.000Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    programmeParticipationAssessments: [{
      journeyId: 'journey-1', travellerId: 'traveller-1', participationId: 'participation-1', programmeId: 'programme', programmeItemId: 'programme-1', status: 'CURRENT', tone: 'PASS',
    }],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice'], ['journey-2', 'Bob']]),
    caseId: 'case-1',
  });
  const node = result.nodes.find((candidate) => candidate.ref === 'PROGRAMME_ITEM:programme-1');
  assert.ok(node);
  assert.equal(node.semanticState, 'UNKNOWN');
  assert.equal(node.evaluation, 'NONE');
});

test('A2 enrichment: a stale participant failure remains unknown and outside scope cannot fail the item', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [
      { subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' },
      { subject_kind: 'JOURNEY', subject_id: 'journey-2', role: 'AFFECTED_TRAVELLER' },
    ],
    journeys: [
      { id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null },
      { id: 'journey-2', trip_id: 'trip-1', traveller_id: 'traveller-2', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null },
    ],
    journeyItems: [],
    transportServices: [],
    participations: [
      { id: 'participation-1', programme_item_id: 'programme-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true },
      { id: 'participation-2', programme_item_id: 'programme-1', traveller_id: 'traveller-2', obligation: 'REQUIRED', accepted: true },
    ],
    programmeItems: [{ id: 'programme-1', programme_id: 'programme', title: 'Shared session', item_type: 'SESSION', window_start: '2031-04-05T09:00:00.000Z', window_end: '2031-04-05T10:00:00.000Z', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    programmeParticipationAssessments: [
      { journeyId: 'journey-1', travellerId: 'traveller-1', participationId: 'participation-1', programmeId: 'programme', programmeItemId: 'programme-1', status: 'CURRENT', tone: 'PASS' },
      { journeyId: 'journey-2', travellerId: 'traveller-2', participationId: 'participation-2', programmeId: 'programme', programmeItemId: 'programme-1', status: 'STALE', tone: 'FAIL' },
      { journeyId: 'journey-outside', travellerId: 'traveller-outside', participationId: 'participation-outside', programmeId: 'programme', programmeItemId: 'programme-1', status: 'CURRENT', tone: 'FAIL' },
    ],
    travellerLabelsByJourney: new Map([['journey-1', 'Alice'], ['journey-2', 'Bob']]),
    caseId: 'case-1',
  });
  const node = result.nodes.find((candidate) => candidate.ref === 'PROGRAMME_ITEM:programme-1');
  assert.ok(node);
  assert.equal(node.semanticState, 'UNKNOWN');
  assert.equal(node.evaluation, 'STALE');
});

test('A1 enrichment: programme commitment detail uses its canonical zone and UTC fallback', () => {
  assert.equal(
    formatWindowInTimeZone('2031-04-05T03:30:00.000Z', '2031-04-05T04:30:00.000Z', 'Asia/Singapore'),
    '5 Apr 11:30 → 12:30 GMT+8',
  );
  assert.equal(
    formatWindowInTimeZone('2031-04-05T03:30:00.000Z', '2031-04-05T04:30:00.000Z'),
    '5 Apr 03:30 → 04:30 UTC',
  );
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [{ id: 'p-1', programme_item_id: 'programme-1', traveller_id: 'traveller-1', obligation: 'REQUIRED', accepted: true }],
    programmeItems: [{ id: 'programme-1', programme_id: 'programme', title: 'Required session', item_type: 'SESSION', window_start: '2031-04-05T03:30:00.000Z', window_end: '2031-04-05T04:30:00.000Z', time_zone: 'Asia/Singapore', lifecycle_status: 'SCHEDULED' }],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });
  assert.equal(result.nodes.find((node) => node.ref === 'PROGRAMME_ITEM:programme-1')?.detail, '5 Apr 11:30 → 12:30 GMT+8');
});

test('shared-flight cohort: a schedule change marks the service changed, and reprotection marks the replacement recovered', () => {
  const ids = ['journey-1', 'journey-2', 'journey-3', 'journey-4', 'journey-5'];
  const confirmed = ids.map((journeyId) => ({
    journeyId,
    serviceId: 'service-shared',
    lineCount: 1,
    lineStatus: 'CONFIRMED' as const,
    reservationStatus: 'CONFIRMED' as const,
  }));
  const base = {
    caseSubjects: ids.map((id) => ({ subject_kind: 'JOURNEY', subject_id: id, role: 'AFFECTED_TRAVELLER' })),
    journeys: ids.map((id) => ({ id, trip_id: `trip-${id}`, traveller_id: `traveller-${id}`, lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null })),
    journeyItems: ids.map((id, index) => ({ id: `item-${index}`, journey_id: id, kind: 'TRANSPORT' as const, order_key: String(index).padStart(3, '0'), lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-shared' })),
    transportServices: [{ id: 'service-shared', mode: 'AIR', operator: 'ID', origin_place_id: 'origin', destination_place_id: 'destination', published_departure: null, published_arrival: null }],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map(ids.map((id) => [id, id])),
    caseId: 'case-shared',
    transportBookingFacts: confirmed,
  };
  const changed = projectFocusedCaseGraphEnrichment({
    ...base,
    changedTransportServiceRefs: new Set(['service-shared']),
  });
  assert.equal(changed.nodes.filter((node) => node.ref === 'SERVICE_BOOKING:service-shared' && node.semanticState === 'CHANGED').length, 1);
  const reprotected = projectFocusedCaseGraphEnrichment({
    ...base,
    changedTransportServiceRefs: new Set(['service-shared']),
    reprotectedTransportServiceRefs: new Set(['service-shared']),
  });
  assert.equal(reprotected.nodes.filter((node) => node.ref === 'SERVICE_BOOKING:service-shared' && node.semanticState === 'RECOVERED').length, 1);
});

test('reprotected arrival shows the displaced baseline and the readiness shortfall', () => {
  const currentAt = '2026-10-01T02:30:00.000Z';
  const priorAt = '2026-09-30T12:30:00.000Z';
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-new' }],
    transportServices: [{
      id: 'service-new', mode: 'AIR', operator: 'ID', origin_place_id: 'origin', destination_place_id: 'destination',
      origin_place_name: 'Jakarta', destination_place_name: 'Singapore',
      published_departure: null, published_arrival: currentAt, service_code: 'ID7153',
    }],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Traveller']]),
    caseId: 'case-1',
    reprotectedTransportServiceRefs: new Set(['service-new']),
    displacedPublishedArrival: priorAt,
    causalPath: [{
      subjectRef: 'JOURNEY:journey-1',
      causeSubjectRef: 'JOURNEY_ITEM:item-1',
      dimension: 'programme_participation',
      reasonCode: 'insufficient_arrival_readiness',
      evaluatorId: 'programme-arrival',
      relatedSubjectRefs: ['JOURNEY_ITEM:item-1', 'TRANSPORT_SERVICE:service-new'],
      facts: {
        scheduledArrival: currentAt,
        availableMinutes: 60,
        requiredMinutes: 150,
      },
    }],
  });
  const booking = result.nodes.find((node) => node.ref === 'SERVICE_BOOKING:service-new');
  const timing = result.nodes.find((node) => node.ref === 'TIMING:item-1:ARRIVAL');
  assert.equal(booking?.label, 'ID ID7153 flight');
  assert.equal(booking?.detail, 'Jakarta → Singapore');
  assert.equal(timing?.semanticState, 'CHANGED');
  assert.equal(timing?.timing?.publishedAt, priorAt);
  assert.equal(timing?.timing?.currentAt, currentAt);
  assert.match(timing?.detail ?? '', /60 minutes available/);
  assert.match(timing?.detail ?? '', /150 minutes required/);
  assert.match(timing?.detail ?? '', /90 minutes short/);
});

test('A5 enrichment: proposed SELECT_OFFER rebinds SERVICE_BOOKING to the recommended service', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-old' }],
    transportServices: [
      { id: 'service-old', mode: 'FLIGHT', operator: 'ZG', origin_place_id: 'NRT', destination_place_id: 'SIN', origin_place_name: 'Narita', destination_place_name: 'Singapore', published_departure: null, published_arrival: null, service_code: 'ZG053' },
      { id: 'service-new', mode: 'FLIGHT', operator: 'TR', origin_place_id: 'NRT', destination_place_id: 'SIN', origin_place_name: 'Narita', destination_place_name: 'Singapore', published_departure: null, published_arrival: null, service_code: 'TR885' },
    ],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Jordan']]),
    caseId: 'case-1',
    proposedServiceByJourneyItem: new Map([['item-1', 'service-new']]),
  });
  assert.equal(result.nodes.some((node) => node.ref === 'SERVICE_BOOKING:service-new'), true);
  assert.equal(result.nodes.some((node) => node.ref === 'SERVICE_BOOKING:service-old'), false);
  assert.equal(result.edges.some((edge) => edge.toRef === 'SERVICE_BOOKING:service-new' && edge.kind === 'RELIES_ON'), true);
});
