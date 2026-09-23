/**
 * R2 — focused Case graph causal mapping (contract §6.1).
 *
 * Pure Cloud tests over `projectFocusedGraph` and its end-to-end spread through
 * `projectRecoveryCase`. No PostgreSQL, no browser, no scenario tokens. Proves:
 *   - the ordered authoritative causalPath maps onto VISIBLE graph refs/edge ids;
 *   - the first operational breakpoint is causalPath[0] mapped to a visible node;
 *   - a causal step with no visible graph object is an explicit honest gap, never
 *     dropped and never guessed;
 *   - the SAME projector code serves two materially different case shapes
 *     (an arrival-readiness/programme failure and a broken connection);
 *   - an empty causal path carries no focusedGraph (never fabricated);
 *   - the frontend never has to traverse topology: causality is supplied.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CausalPathStep,
  LiveDependencyGraph,
} from '../src/contracts/v2/product/readModels.ts';
import type {
  ProductNodeFact,
  ProductEdgeFact,
} from '../src/app/target/readmodels/index.ts';
import { projectFocusedGraph, projectRecoveryCase } from '../src/app/target/readmodels/index.ts';
import { projectFocusedCaseGraphEnrichment } from '../src/app/target/readmodels/projectFocusedCaseGraph.ts';

const NOW = '2031-05-01T00:00:00.000Z';

function graph(nodes: ProductNodeFact[], edges: ProductEdgeFact[]): LiveDependencyGraph {
  // A minimal, schema-shaped FOCUSED_CASE graph (the visible truth the projector
  // maps onto). Validated by `projectRecoveryCase` -> `LiveDependencyGraphSchema`
  // in the end-to-end test below.
  return {
    scope: 'FOCUSED_CASE',
    nodes: nodes.map((n) => ({
      ref: n.ref, kind: n.kind, label: n.label, semanticState: n.semanticState,
      authority: n.authority ?? 'AUTHORITATIVE',
      ...(n.caseRef ? { caseRef: n.caseRef } : {}),
      ...(n.evaluation ? { evaluation: n.evaluation } : {}),
      ...(n.subjectRefs ? { subjectRefs: [...n.subjectRefs] } : {}),
      ...(n.timing ? { timing: { ...n.timing } } : {}),
      ...(n.detail ? { detail: n.detail } : {}),
    })),
    edges: edges.map((e) => ({
      id: e.id, fromRef: e.fromRef, toRef: e.toRef, kind: e.kind,
      authority: e.authority ?? 'AUTHORITATIVE',
      ...(e.semanticState ? { semanticState: e.semanticState } : {}),
    })),
    change: {
      projectionRevision: 1, changedVisibleRefs: [], changedEdgeIds: [],
      currentSemanticState: 'FAILED',
    },
  };
}

function step(subjectRef: string, dimension: string, reasonCode: string, related: string[] = []): CausalPathStep {
  return { subjectRef, dimension, reasonCode, evaluatorId: `eval.${dimension}`, facts: {}, relatedSubjectRefs: related };
}

// ---------------------------------------------------------------------------
// Shape 1 — arrival-readiness / programme failure.
// A changed inbound service makes an arrival timing miss a required commitment.
// ---------------------------------------------------------------------------
const programmeNodes: ProductNodeFact[] = [
  { ref: 'case:c1', kind: 'RECOVERY_PROPOSAL', label: 'Recovery case', semanticState: 'ACTIVE' },
  { ref: 'sig:s1', kind: 'DISRUPTION', label: 'Schedule change', semanticState: 'CHANGED' },
  { ref: 'JOURNEY:j1', kind: 'TRAVELLER', label: 'Traveller journey', semanticState: 'FAILED', evaluation: 'CURRENT' },
  { ref: 'TIMING:t1', kind: 'TIMING', label: 'Arrival readiness', semanticState: 'FAILED' },
  { ref: 'PROGRAMME_ITEM:p1', kind: 'PROGRAMME_COMMITMENT', label: 'Required commitment', semanticState: 'AFFECTED' },
];
const programmeEdges: ProductEdgeFact[] = [
  { id: 'AFFECTED_BY:JOURNEY:j1:sig:s1', fromRef: 'JOURNEY:j1', toRef: 'sig:s1', kind: 'AFFECTED_BY' },
  { id: 'RELIES_ON:JOURNEY:j1:TIMING:t1', fromRef: 'JOURNEY:j1', toRef: 'TIMING:t1', kind: 'RELIES_ON' },
  { id: 'MUST_HAPPEN_BEFORE:TIMING:t1:PROGRAMME_ITEM:p1', fromRef: 'TIMING:t1', toRef: 'PROGRAMME_ITEM:p1', kind: 'MUST_HAPPEN_BEFORE' },
];
// Evaluator order: the arrival timing is the FIRST operational breakpoint; the
// journey and the commitment are downstream of it.
const programmePath: CausalPathStep[] = [
  step('TIMING:t1', 'arrival_readiness', 'arrival_after_required_by', ['JOURNEY:j1']),
  step('PROGRAMME_ITEM:p1', 'participation_feasibility', 'cannot_reach_required_item'),
];

// ---------------------------------------------------------------------------
// Shape 2 — broken connection (transport), no programme at all.
// Materially different data, SAME projector code.
// ---------------------------------------------------------------------------
const connectionNodes: ProductNodeFact[] = [
  { ref: 'case:c2', kind: 'RECOVERY_PROPOSAL', label: 'Recovery case', semanticState: 'ACTIVE' },
  { ref: 'sig:s2', kind: 'DISRUPTION', label: 'Inbound delay', semanticState: 'CHANGED' },
  { ref: 'JOURNEY:j2', kind: 'TRAVELLER', label: 'Traveller journey', semanticState: 'FAILED' },
  { ref: 'SERVICE_BOOKING:b1', kind: 'SERVICE_BOOKING', label: 'Outbound service', semanticState: 'FAILED' },
  { ref: 'SERVICE_BOOKING:b2', kind: 'SERVICE_BOOKING', label: 'Connecting service', semanticState: 'AFFECTED' },
];
const connectionEdges: ProductEdgeFact[] = [
  { id: 'AFFECTED_BY:JOURNEY:j2:sig:s2', fromRef: 'JOURNEY:j2', toRef: 'sig:s2', kind: 'AFFECTED_BY' },
  { id: 'MUST_HAPPEN_BEFORE:SERVICE_BOOKING:b1:SERVICE_BOOKING:b2', fromRef: 'SERVICE_BOOKING:b1', toRef: 'SERVICE_BOOKING:b2', kind: 'MUST_HAPPEN_BEFORE' },
  { id: 'RELIES_ON:JOURNEY:j2:SERVICE_BOOKING:b1', fromRef: 'JOURNEY:j2', toRef: 'SERVICE_BOOKING:b1', kind: 'RELIES_ON' },
];
const connectionPath: CausalPathStep[] = [
  step('SERVICE_BOOKING:b1', 'connection_feasibility', 'connection_impossible', ['SERVICE_BOOKING:b2']),
];

test('R2: causalPath maps onto visible node refs in evaluator order', () => {
  const ldg = graph(programmeNodes, programmeEdges);
  const focused = projectFocusedGraph(ldg, programmePath);
  assert.ok(focused);
  // First breakpoint subject leads; its related subject joins; then the next step.
  assert.deepEqual(focused.causalNodeRefs, ['TIMING:t1', 'JOURNEY:j1', 'PROGRAMME_ITEM:p1']);
});

test('R2: causal edges are the producer-owned ids connecting the causal node set', () => {
  const ldg = graph(programmeNodes, programmeEdges);
  const focused = projectFocusedGraph(ldg, programmePath);
  assert.ok(focused);
  // Both endpoints on the causal set -> included; stable FIG-1 ids, not positions.
  assert.ok(focused.causalEdgeIds.includes('RELIES_ON:JOURNEY:j1:TIMING:t1'));
  assert.ok(focused.causalEdgeIds.includes('MUST_HAPPEN_BEFORE:TIMING:t1:PROGRAMME_ITEM:p1'));
  // The case<->disruption edge is NOT on the causal node set, so it is excluded.
  assert.ok(!focused.causalEdgeIds.includes('AFFECTED_BY:JOURNEY:j1:sig:s1'));
});

test('R2: first operational breakpoint is causalPath[0] mapped to a visible node', () => {
  const ldg = graph(programmeNodes, programmeEdges);
  const focused = projectFocusedGraph(ldg, programmePath);
  assert.equal(focused?.firstBreakpoint?.nodeRef, 'TIMING:t1');
  assert.equal(focused?.firstBreakpoint?.label, 'Arrival readiness');
  assert.equal(focused?.firstBreakpoint?.dimension, 'arrival_readiness');
  assert.equal(focused?.firstBreakpoint?.reasonCode, 'arrival_after_required_by');
});

test('A1: persisted cause maps to an explicit presentation subject while affected journey remains context', () => {
  const ldg = graph([
    { ref: 'JOURNEY:j1', kind: 'TRAVELLER', label: 'Traveller', semanticState: 'FAILED' },
    { ref: 'TIMING:item-1:ARRIVAL', kind: 'TIMING', label: 'Arrival timing', semanticState: 'CHANGED', subjectRefs: ['JOURNEY_ITEM:item-1'] },
  ], [{ id: 'e1', fromRef: 'JOURNEY:j1', toRef: 'TIMING:item-1:ARRIVAL', kind: 'RELIES_ON' }]);
  const focused = projectFocusedGraph(ldg, [{
    subjectRef: 'JOURNEY:j1', causeSubjectRef: 'JOURNEY_ITEM:item-1', dimension: 'connection_feasibility', reasonCode: 'connection_impossible', evaluatorId: 'm6.connection', facts: {}, relatedSubjectRefs: [],
  }]);
  assert.equal(focused?.firstBreakpoint?.nodeRef, 'TIMING:item-1:ARRIVAL');
  assert.deepEqual(focused?.causalNodeRefs, ['TIMING:item-1:ARRIVAL', 'JOURNEY:j1']);
});

test('A1: a third presentation mapping cannot restore an ambiguous canonical subject', () => {
  const ldg = graph([
    { ref: 'SERVICE_BOOKING:one', kind: 'SERVICE_BOOKING', label: 'One', semanticState: 'UNKNOWN', subjectRefs: ['TRANSPORT_SERVICE:s1'] },
    { ref: 'SERVICE_BOOKING:two', kind: 'SERVICE_BOOKING', label: 'Two', semanticState: 'UNKNOWN', subjectRefs: ['TRANSPORT_SERVICE:s1'] },
    { ref: 'SERVICE_BOOKING:three', kind: 'SERVICE_BOOKING', label: 'Three', semanticState: 'UNKNOWN', subjectRefs: ['TRANSPORT_SERVICE:s1'] },
  ], []);
  const focused = projectFocusedGraph(ldg, [{
    subjectRef: 'JOURNEY:j1', causeSubjectRef: 'TRANSPORT_SERVICE:s1', dimension: 'arrival_readiness', reasonCode: 'arrival_after_required_by', evaluatorId: 'm6.arrival', facts: {}, relatedSubjectRefs: [],
  }]);
  assert.equal(focused?.firstBreakpoint, undefined);
  assert.deepEqual(focused?.causalNodeRefs, []);
  assert.equal(focused?.unmappedCausalSteps[0]?.subjectRef, 'TRANSPORT_SERVICE:s1');
});

test('A1: an evidenced arrival precedes the commitment it prevents, with the traveller kept in context', () => {
  const ldg = graph([
    ...programmeNodes,
    { ref: 'SERVICE_BOOKING:inbound', kind: 'SERVICE_BOOKING', label: 'Replacement flight', semanticState: 'UNKNOWN' },
    { ref: 'TIMING:arrival', kind: 'TIMING', label: 'Arrival timing', semanticState: 'FAILED', subjectRefs: ['JOURNEY_ITEM:inbound'], timing: { currentAt: NOW } },
  ], [
    ...programmeEdges,
    { id: 'arrival-result', fromRef: 'SERVICE_BOOKING:inbound', toRef: 'TIMING:arrival', kind: 'MUST_HAPPEN_BEFORE' },
    { id: 'arrival-break', fromRef: 'TIMING:arrival', toRef: 'PROGRAMME_ITEM:p1', kind: 'MUST_HAPPEN_BEFORE', semanticState: 'FAILED' },
  ]);
  const focused = projectFocusedGraph(ldg, [{
    ...step('JOURNEY:j1', 'programme_participation', 'insufficient_arrival_readiness', ['JOURNEY_ITEM:inbound', 'PROGRAMME_ITEM:p1']),
    causeSubjectRef: 'PROGRAMME_ITEM:p1',
  }]);
  assert.equal(focused?.firstBreakpoint?.nodeRef, 'TIMING:arrival');
  // The traveller (the step's own affected subject) stays on the causal spine
  // even though arrival timing leads as the breakpoint.
  assert.deepEqual(focused?.causalNodeRefs, ['sig:s1', 'SERVICE_BOOKING:inbound', 'TIMING:arrival', 'PROGRAMME_ITEM:p1', 'JOURNEY:j1']);
  assert.ok(focused?.causalEdgeIds.includes('arrival-break'));
});

// ---------------------------------------------------------------------------
// CP4 — evaluator-declared dependents of an arrival breakpoint.
// A broken connection is the only FAIL; the destination stay and a required
// commitment PASS but their explanations explicitly depend on the onward item.
// ---------------------------------------------------------------------------
const breakpointNodes: ProductNodeFact[] = [
  { ref: 'sig:d', kind: 'DISRUPTION', label: 'Delay', semanticState: 'CHANGED' },
  { ref: 'JOURNEY:j', kind: 'TRAVELLER', label: 'Traveller', semanticState: 'FAILED' },
  { ref: 'SERVICE_BOOKING:in', kind: 'SERVICE_BOOKING', label: 'Inbound', semanticState: 'CHANGED', subjectRefs: ['TRANSPORT_SERVICE:in'] },
  { ref: 'TIMING:in', kind: 'TIMING', label: 'Arrival timing', semanticState: 'CHANGED', subjectRefs: ['JOURNEY_ITEM:in'], timing: { currentAt: NOW } },
  { ref: 'SERVICE_BOOKING:on', kind: 'SERVICE_BOOKING', label: 'Onward', semanticState: 'FAILED', subjectRefs: ['TRANSPORT_SERVICE:on', 'JOURNEY_ITEM:on'] },
  { ref: 'TRANSFER_STAY:stay', kind: 'TRANSFER_STAY', label: 'Stay', semanticState: 'UNKNOWN', subjectRefs: ['JOURNEY_ITEM:stay'] },
  { ref: 'PROGRAMME_ITEM:required', kind: 'PROGRAMME_COMMITMENT', label: 'Required session', semanticState: 'HEALTHY', subjectRefs: ['PROGRAMME_ITEM:required'] },
  { ref: 'PROGRAMME_ITEM:unrelated', kind: 'PROGRAMME_COMMITMENT', label: 'Unrelated session', semanticState: 'HEALTHY', subjectRefs: ['PROGRAMME_ITEM:unrelated'] },
  { ref: 'SERVICE_BOOKING:other', kind: 'SERVICE_BOOKING', label: 'Other trip leg', semanticState: 'HEALTHY', subjectRefs: ['TRANSPORT_SERVICE:other', 'JOURNEY_ITEM:other'] },
];
const breakpointEdges: ProductEdgeFact[] = [
  { id: 'sig-in', fromRef: 'sig:d', toRef: 'SERVICE_BOOKING:in', kind: 'AFFECTED_BY', semanticState: 'CHANGED' },
  { id: 'j-sig', fromRef: 'JOURNEY:j', toRef: 'sig:d', kind: 'AFFECTED_BY' },
  { id: 'in-arrival', fromRef: 'SERVICE_BOOKING:in', toRef: 'TIMING:in', kind: 'MUST_HAPPEN_BEFORE' },
  { id: 'arrival-on', fromRef: 'TIMING:in', toRef: 'SERVICE_BOOKING:on', kind: 'MUST_HAPPEN_BEFORE', semanticState: 'FAILED' },
  { id: 'on-stay', fromRef: 'SERVICE_BOOKING:on', toRef: 'TRANSFER_STAY:stay', kind: 'MUST_HAPPEN_BEFORE' },
  { id: 'j-stay', fromRef: 'JOURNEY:j', toRef: 'TRANSFER_STAY:stay', kind: 'RELIES_ON' },
  { id: 'j-on', fromRef: 'JOURNEY:j', toRef: 'SERVICE_BOOKING:on', kind: 'RELIES_ON' },
  { id: 'arrival-required', fromRef: 'TIMING:in', toRef: 'PROGRAMME_ITEM:required', kind: 'MUST_HAPPEN_BEFORE' },
  { id: 'j-required', fromRef: 'JOURNEY:j', toRef: 'PROGRAMME_ITEM:required', kind: 'PARTICIPATES_IN' },
  { id: 'j-unrelated', fromRef: 'JOURNEY:j', toRef: 'PROGRAMME_ITEM:unrelated', kind: 'PARTICIPATES_IN' },
];
const connectionBroken: CausalPathStep = {
  ...step('JOURNEY:j', 'connection_feasibility', 'connection_broken', ['JOURNEY_ITEM:in', 'JOURNEY_ITEM:on']),
  causeSubjectRef: 'JOURNEY_ITEM:in',
};
const dependencyContext: CausalPathStep[] = [
  // The destination stay's alignment depends on the onward arrival item.
  { ...step('JOURNEY:j', 'stay_arrival_date_aligned', 'original_stay_arrival_aligned', ['CONSTRAINT_DEFINITION:c1', 'JOURNEY_ITEM:stay', 'JOURNEY_ITEM:on']), causeSubjectRef: 'JOURNEY_ITEM:stay' },
  // A required commitment whose readiness depends on the same arrival item.
  { ...step('JOURNEY:j', 'programme_participation', 'participation_feasible', ['JOURNEY_ITEM:on', 'PARTICIPATION:x', 'PROGRAMME_ITEM:required']), causeSubjectRef: 'PROGRAMME_ITEM:required' },
  // A commitment that depends on an unrelated leg — not on the causal chain.
  { ...step('JOURNEY:j', 'programme_participation', 'participation_feasible', ['JOURNEY_ITEM:other', 'PROGRAMME_ITEM:unrelated']), causeSubjectRef: 'PROGRAMME_ITEM:unrelated' },
  // Traveller-level explanations never anchor (they concern every journey subject).
  { ...step('JOURNEY:j', 'credential_selection', 'credential_valid_for_visit', ['JOURNEY:j', 'JURISDICTION:x']), causeSubjectRef: 'JOURNEY:j' },
  // A would-be second hop: it names only a dependent (the stay) — never pulled.
  step('JOURNEY:j', 'overnight_accommodation', 'overnight_not_required_for_gap', ['JOURNEY_ITEM:stay', 'JOURNEY_ITEM:other']),
];

test('CP4: evaluator-declared dependents of an arrival breakpoint join the spine; unrelated ones do not', () => {
  const ldg = graph(breakpointNodes, breakpointEdges);
  const without = projectFocusedGraph(ldg, [connectionBroken]);
  // The failure chain alone never reaches the stay or the commitment (the
  // "floating" D3 shape before CP4).
  assert.equal(without?.causalNodeRefs.includes('TRANSFER_STAY:stay'), false);
  assert.equal(without?.causalNodeRefs.includes('PROGRAMME_ITEM:required'), false);

  const focused = projectFocusedGraph(ldg, [connectionBroken], dependencyContext);
  assert.ok(focused);
  // The failure chain itself is unchanged and still leads.
  assert.equal(focused.firstBreakpoint?.nodeRef, 'TIMING:in');
  assert.deepEqual(focused.causalNodeRefs.slice(0, without!.causalNodeRefs.length), without!.causalNodeRefs);
  // Dependents follow, in explanation order.
  assert.deepEqual(focused.causalNodeRefs.slice(without!.causalNodeRefs.length), ['TRANSFER_STAY:stay', 'PROGRAMME_ITEM:required']);
  assert.equal(focused.causalNodeRefs.includes('PROGRAMME_ITEM:unrelated'), false, 'unrelated programme stays off the spine');
  assert.equal(focused.causalNodeRefs.includes('SERVICE_BOOKING:other'), false, 'one hop only: a dependent never anchors');
  // The stay and the commitment are connected into the story, not floating.
  for (const id of ['on-stay', 'j-stay', 'arrival-required', 'j-required', 'arrival-on']) {
    assert.ok(focused.causalEdgeIds.includes(id), `causal edge ${id}`);
  }
  assert.equal(focused.causalEdgeIds.includes('j-unrelated'), false);
  assert.deepEqual(focused.unmappedCausalSteps, []);
});

test('CP4: dependency context without a mapped causal chain adds nothing', () => {
  const ldg = graph(breakpointNodes, breakpointEdges);
  assert.equal(projectFocusedGraph(ldg, [], dependencyContext), undefined);
  const unmapped = projectFocusedGraph(ldg, [step('TRANSFER:x9', 'ground_transfer_feasibility', 'transfer_unavailable')], dependencyContext);
  assert.deepEqual(unmapped?.causalNodeRefs, []);
});

test('CP4: composed stay card maps its own journey item, and a previewed onward service carries the spine to the stay', () => {
  const inboundArrival = '2031-03-10T09:00:00.000Z';
  const enrichment = projectFocusedCaseGraphEnrichment({
    caseSubjects: [{ subject_kind: 'JOURNEY', subject_id: 'j', role: 'AFFECTED_TRAVELLER' }],
    journeys: [{ id: 'j', trip_id: 't', traveller_id: 'tr', lifecycle_status: 'ACTIVE', intended_window_start: null, intended_window_end: null }],
    journeyItems: [
      { id: 'in', journey_id: 'j', kind: 'TRANSPORT', order_key: '010', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'svc-in' },
      { id: 'on', journey_id: 'j', kind: 'TRANSPORT', order_key: '020', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null, selectedServiceId: 'svc-on' },
      { id: 'stay', journey_id: 'j', kind: 'STAY', order_key: '030', lifecycle_status: 'PLANNED', intended_window_start: null, intended_window_end: null },
    ],
    transportServices: [
      { id: 'svc-in', mode: 'FLIGHT', operator: 'Carrier A', origin_place_id: 'a', destination_place_id: 'b', published_departure: null, published_arrival: '2031-03-10T06:00:00.000Z', estimated_arrival: inboundArrival },
      { id: 'svc-on', mode: 'FLIGHT', operator: 'Carrier A', origin_place_id: 'b', destination_place_id: 'c', published_departure: '2031-03-10T08:00:00.000Z', published_arrival: '2031-03-10T14:00:00.000Z' },
    ],
    participations: [], programmeItems: [], objectives: [], assessmentViews: new Map(),
    travellerLabelsByJourney: new Map([['j', 'Traveller']]), caseId: 'c',
    causalPath: [{ ...connectionBroken, facts: { gapMinutes: -60, upstreamArrival: inboundArrival } }],
    proposedServiceByJourneyItem: new Map([['on', 'transport-service:p']]),
    proposedTransportServices: [{ id: 'transport-service:p', mode: 'FLIGHT', operator: 'Carrier B', origin_place_id: 'b', destination_place_id: 'c', published_departure: null, published_arrival: null }],
  });
  const stay = enrichment.nodes.find((node) => node.ref === 'TRANSFER_STAY:stay');
  assert.deepEqual(stay?.subjectRefs, ['JOURNEY_ITEM:stay'], 'the stay card is the visual home of its journey item');
  const ldg = graph([{ ref: 'JOURNEY:j', kind: 'TRAVELLER', label: 'Traveller', semanticState: 'FAILED' }, ...enrichment.nodes], enrichment.edges);

  // A FAIL explanation naming the stay item now maps onto the stay card.
  const misaligned = projectFocusedGraph(ldg, [{
    ...step('JOURNEY:j', 'stay_arrival_date_aligned', 'active_original_stay_misaligned', ['CONSTRAINT_DEFINITION:c1', 'JOURNEY_ITEM:stay', 'JOURNEY_ITEM:on']),
    causeSubjectRef: 'CONSTRAINT_DEFINITION:c1',
  }]);
  assert.ok(misaligned?.causalNodeRefs.includes('TRANSFER_STAY:stay'));

  // Broken connection + stay dependency: arrival → proposed onward → stay.
  const focused = projectFocusedGraph(ldg, [{ ...connectionBroken, facts: { gapMinutes: -60, upstreamArrival: inboundArrival } }], dependencyContext);
  assert.ok(focused);
  assert.equal(focused.firstBreakpoint?.nodeRef, 'TIMING:in:ARRIVAL');
  assert.ok(focused.causalNodeRefs.includes('SERVICE_BOOKING:transport-service:p'), 'proposed onward on the spine');
  assert.ok(focused.causalNodeRefs.includes('TRANSFER_STAY:stay'), 'stay on the spine');
  assert.equal(focused.causalNodeRefs.some((ref) => ref === 'SERVICE_BOOKING:svc-on'), false, 'no stale canonical onward');
  for (const id of [
    'MUST_HAPPEN_BEFORE:TIMING:in:ARRIVAL:SERVICE_BOOKING:transport-service:p',
    'MUST_HAPPEN_BEFORE:SERVICE_BOOKING:transport-service:p:TRANSFER_STAY:stay',
    'RELIES_ON:JOURNEY:j:TRANSFER_STAY:stay',
  ]) {
    assert.ok(focused.causalEdgeIds.includes(id), `causal edge ${id}`);
  }
});

test('R2: a causal step with no visible node is an explicit honest gap', () => {
  // The connection case references a transfer subject that the sparse focused
  // graph does not carry as a visible node.
  const ldg = graph(connectionNodes, connectionEdges);
  const pathWithGap: CausalPathStep[] = [
    ...connectionPath,
    step('TRANSFER:x9', 'ground_transfer_feasibility', 'transfer_unavailable'),
  ];
  const focused = projectFocusedGraph(ldg, pathWithGap);
  assert.ok(focused);
  assert.equal(focused.unmappedCausalSteps.length, 1);
  assert.equal(focused.unmappedCausalSteps[0]?.subjectRef, 'TRANSFER:x9');
  assert.equal(focused.unmappedCausalSteps[0]?.reasonCode, 'transfer_unavailable');
  assert.match(focused.unmappedCausalSteps[0]?.reason ?? '', /no visible graph node/);
  // The mapped step is still present and correct.
  assert.deepEqual(focused.causalNodeRefs, ['SERVICE_BOOKING:b1', 'SERVICE_BOOKING:b2']);
});

test('R2: when causalPath[0] is not visible there is no fabricated breakpoint', () => {
  const ldg = graph(connectionNodes, connectionEdges);
  const path = [step('TRANSFER:x9', 'ground_transfer_feasibility', 'transfer_unavailable')];
  const focused = projectFocusedGraph(ldg, path);
  assert.ok(focused);
  assert.equal(focused.firstBreakpoint, undefined);
  assert.deepEqual(focused.causalNodeRefs, []);
  assert.equal(focused.unmappedCausalSteps.length, 1);
});

test('R2: the SAME projector serves two materially different case shapes', () => {
  const programme = projectFocusedGraph(graph(programmeNodes, programmeEdges), programmePath);
  const connection = projectFocusedGraph(graph(connectionNodes, connectionEdges), connectionPath);
  // Different domains, different refs, different breakpoint — one code path.
  assert.equal(programme?.firstBreakpoint?.dimension, 'arrival_readiness');
  assert.equal(connection?.firstBreakpoint?.dimension, 'connection_feasibility');
  assert.equal(programme?.firstBreakpoint?.nodeRef, 'TIMING:t1');
  assert.equal(connection?.firstBreakpoint?.nodeRef, 'SERVICE_BOOKING:b1');
  assert.equal(connection?.unmappedCausalSteps.length, 0);
});

test('R2: an empty causal path yields no focusedGraph (never fabricated)', () => {
  const ldg = graph(programmeNodes, programmeEdges);
  assert.equal(projectFocusedGraph(ldg, []), undefined);
});

test('R2: projectRecoveryCase spreads focusedGraph only when a causal path exists', () => {
  const baseFacts = {
    generatedAt: NOW,
    projectionRevision: 1,
    changedVisibleRefs: [] as readonly string[],
    changedEdgeIds: [] as readonly string[],
    currentSemanticState: 'FAILED' as const,
    nodes: programmeNodes,
    edges: programmeEdges,
    caseRef: 'c1',
    status: 'OPEN' as const,
    changeSummary: 'An inbound service changed.',
    bookingServiceState: { label: 'Booking', state: 'AFFECTED' as const },
    tripViability: { label: 'Whole-trip viability', verdict: 'FAIL' as const },
    authorityState: 'recorded',
    executionState: 'idle',
    reconciliationState: 'idle',
  };

  const withoutPath = projectRecoveryCase(baseFacts);
  assert.equal(withoutPath.focusedGraph, undefined);

  const withPath = projectRecoveryCase({ ...baseFacts, causalPath: programmePath });
  assert.ok(withPath.focusedGraph);
  assert.equal(withPath.focusedGraph?.firstBreakpoint?.nodeRef, 'TIMING:t1');
  assert.deepEqual(withPath.focusedGraph?.causalNodeRefs, ['TIMING:t1', 'JOURNEY:j1', 'PROGRAMME_ITEM:p1']);
  // The causal path itself is still carried verbatim for the Case workspace.
  assert.equal(withPath.causalPath.length, 2);
  // Current authoritative state is untouched.
  assert.equal(withPath.tripViability.verdict, 'FAIL');
});
