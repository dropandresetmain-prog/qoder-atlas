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
import { projectFocusedCaseGraphEnrichment } from '../src/app/target/readmodels/projectFocusedCaseGraph.ts';

test('R2 enrichment: creates SERVICE_BOOKING node for transport item with service', () => {
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

  assert.equal(result.nodes.length, 1);
  const node = result.nodes[0]!;
  assert.equal(node.kind, 'SERVICE_BOOKING');
  assert.equal(node.ref, 'SERVICE_BOOKING:service-1');
  assert.equal(node.label, 'FLIGHT Airline X');
  assert.equal(node.detail, 'CDG → JFK');
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

test('R2 enrichment: applies assessment view to service node', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'TRANSPORT', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'service-1' }],
    transportServices: [{ id: 'service-1', mode: 'FLIGHT', operator: 'Airline X', origin_place_id: 'CDG', destination_place_id: 'JFK', published_departure: null, published_arrival: null }],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map([['SERVICE_BOOKING:service-1', { status: 'CURRENT', tone: 'FAIL' }]]),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  const node = result.nodes[0]!;
  assert.equal(node.semanticState, 'FAILED');
  assert.equal(node.evaluation, 'CURRENT');
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
    journeyItems: [{ id: 'item-1', journey_id: 'journey-1', kind: 'STAY', order_key: '001', lifecycle_status: 'PLANNED', intended_window_start: '2026-01-15T14:00:00Z', intended_window_end: '2026-01-16T10:00:00Z', selectedServiceId: null }],
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
  assert.equal(node.detail, '2026-01-15T14:00:00Z → 2026-01-16T10:00:00Z');
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
  assert.equal(node.detail, '2026-01-15T09:00:00Z → 2026-01-15T10:00:00Z');
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

test('R2 enrichment: reports objective contract gap when objectives exist', () => {
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

  assert.equal(result.objectiveContractGap, true);
  // Objectives are not emitted as nodes (no LdgNodeKind can carry them)
  assert.equal(result.nodes.length, 0);
});

test('R2 enrichment: no objective contract gap when no objectives', () => {
  const result = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'journey-1', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'journey-1', trip_id: 'trip-1', traveller_id: 'traveller-1', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [],
    transportServices: [],
    participations: [],
    programmeItems: [],
    objectives: [],
    assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['journey-1', 'Alice']]),
    caseId: 'case-1',
  });

  assert.equal(result.objectiveContractGap, false);
});
