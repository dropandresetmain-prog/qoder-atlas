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
