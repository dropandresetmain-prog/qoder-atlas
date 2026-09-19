/**
 * R3 LANE D — causal spine layout tests.
 *
 * Verifies that when causalNodeRefs is supplied, the layout produces a
 * left-to-right spine with causal nodes in backend order and context nodes
 * hanging off at secondary rows. Without causal refs, falls back to the
 * original longest-path ranking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LiveDependencyGraph } from '../src/contracts/v2/product/readModels.ts';
import { computeLayout } from '../src/ui/graph/layout.ts';
import { presentDependencyGraph } from '../src/ui/semantics/adapter.ts';

function makeLdg(overrides?: Partial<LiveDependencyGraph>): LiveDependencyGraph {
  return {
    scope: 'FOCUSED_CASE',
    nodes: [],
    edges: [],
    change: {
      projectionRevision: 1,
      changedVisibleRefs: [],
      changedEdgeIds: [],
      currentSemanticState: 'HEALTHY',
    },
    ...overrides,
  };
}

test('causal refs take monotonically increasing columns in backend order', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'TIMING:t1', kind: 'TIMING', label: 'T1', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'TIMING:t2', kind: 'TIMING', label: 'T2', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'TIMING:t3', kind: 'TIMING', label: 'T3', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'TIMING:t1', toRef: 'TIMING:t2', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'TIMING:t2', toRef: 'TIMING:t3', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
    ],
  });

  const causalRefs = ['TIMING:t1', 'TIMING:t2', 'TIMING:t3'];
  const presentation = presentDependencyGraph(ldg, { causalRefs });
  const layout = computeLayout(presentation, causalRefs);

  const nodeT1 = layout.nodes.find((n) => n.ref === 'TIMING:t1');
  const nodeT2 = layout.nodes.find((n) => n.ref === 'TIMING:t2');
  const nodeT3 = layout.nodes.find((n) => n.ref === 'TIMING:t3');

  assert.ok(nodeT1 && nodeT2 && nodeT3);
  assert.equal(nodeT1.column, 0, 'First causal node in column 0');
  assert.equal(nodeT2.column, 1, 'Second causal node in column 1');
  assert.equal(nodeT3.column, 2, 'Third causal node in column 2');
  assert.ok(nodeT1.x < nodeT2.x, 'T1 left of T2');
  assert.ok(nodeT2.x < nodeT3.x, 'T2 left of T3');
});

test('context nodes do not break causal ordering', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'Traveller', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'Booking', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'C', kind: 'TIMING', label: 'Timing', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
      { ref: 'CTX1', kind: 'TRANSFER_STAY', label: 'Transfer', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'CTX2', kind: 'PROGRAMME_COMMITMENT', label: 'Commitment', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'B', toRef: 'C', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e3', fromRef: 'A', toRef: 'CTX1', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e4', fromRef: 'C', toRef: 'CTX2', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
  });

  const causalRefs = ['A', 'B', 'C'];
  const presentation = presentDependencyGraph(ldg, { causalRefs });
  const layout = computeLayout(presentation, causalRefs);

  const nodeA = layout.nodes.find((n) => n.ref === 'A');
  const nodeB = layout.nodes.find((n) => n.ref === 'B');
  const nodeC = layout.nodes.find((n) => n.ref === 'C');
  const nodeCTX1 = layout.nodes.find((n) => n.ref === 'CTX1');
  const nodeCTX2 = layout.nodes.find((n) => n.ref === 'CTX2');

  assert.ok(nodeA && nodeB && nodeC && nodeCTX1 && nodeCTX2);

  // Causal nodes in columns 0, 1, 2
  assert.equal(nodeA.column, 0);
  assert.equal(nodeB.column, 1);
  assert.equal(nodeC.column, 2);

  // Context nodes hang off at the column of their nearest causal neighbour
  assert.equal(nodeCTX1.column, 0, 'CTX1 hangs off A (column 0)');
  assert.equal(nodeCTX2.column, 2, 'CTX2 hangs off C (column 2)');

  // Causal x-order preserved
  assert.ok(nodeA.x < nodeB.x);
  assert.ok(nodeB.x < nodeC.x);

  // Context nodes at secondary row (row > 0)
  assert.ok(nodeCTX1.row > 0, 'CTX1 at secondary row');
  assert.ok(nodeCTX2.row > 0, 'CTX2 at secondary row');
});

test('second materially different graph shape: connection/transfer chain', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'F1', kind: 'SERVICE_BOOKING', label: 'Flight 1', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'F2', kind: 'SERVICE_BOOKING', label: 'Flight 2', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
      { ref: 'F3', kind: 'SERVICE_BOOKING', label: 'Flight 3', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'T1', kind: 'TRANSFER_STAY', label: 'Transfer 1', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
      { ref: 'T2', kind: 'TRANSFER_STAY', label: 'Transfer 2', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'F1', toRef: 'T1', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'T1', toRef: 'F2', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e3', fromRef: 'F2', toRef: 'T2', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e4', fromRef: 'T2', toRef: 'F3', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
    ],
  });

  const causalRefs = ['F1', 'F2', 'F3'];
  const presentation = presentDependencyGraph(ldg, { causalRefs });
  const layout = computeLayout(presentation, causalRefs);

  const nodeF1 = layout.nodes.find((n) => n.ref === 'F1');
  const nodeF2 = layout.nodes.find((n) => n.ref === 'F2');
  const nodeF3 = layout.nodes.find((n) => n.ref === 'F3');
  const nodeT1 = layout.nodes.find((n) => n.ref === 'T1');
  const nodeT2 = layout.nodes.find((n) => n.ref === 'T2');

  assert.ok(nodeF1 && nodeF2 && nodeF3 && nodeT1 && nodeT2);

  // Causal spine: F1, F2, F3 in columns 0, 1, 2
  assert.equal(nodeF1.column, 0);
  assert.equal(nodeF2.column, 1);
  assert.equal(nodeF3.column, 2);

  // Transfer nodes hang off at nearest causal column
  assert.equal(nodeT1.column, 0, 'T1 hangs off F1');
  assert.equal(nodeT2.column, 1, 'T2 hangs off F2');

  // Causal x-order preserved
  assert.ok(nodeF1.x < nodeF2.x);
  assert.ok(nodeF2.x < nodeF3.x);
});

test('absent/empty causalNodeRefs falls back to longest-path ranking', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'C', kind: 'TIMING', label: 'C', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'B', toRef: 'C', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
    ],
  });

  const presentation = presentDependencyGraph(ldg);

  // No causal refs (undefined)
  const layout1 = computeLayout(presentation);
  const nodeA1 = layout1.nodes.find((n) => n.ref === 'A');
  const nodeB1 = layout1.nodes.find((n) => n.ref === 'B');
  const nodeC1 = layout1.nodes.find((n) => n.ref === 'C');

  assert.ok(nodeA1 && nodeB1 && nodeC1);
  assert.equal(nodeA1.column, 0, 'Source node in column 0');
  assert.equal(nodeB1.column, 1, 'Middle node in column 1');
  assert.equal(nodeC1.column, 2, 'Sink node in column 2');

  // Empty causal refs array
  const layout2 = computeLayout(presentation, []);
  const nodeA2 = layout2.nodes.find((n) => n.ref === 'A');
  const nodeB2 = layout2.nodes.find((n) => n.ref === 'B');
  const nodeC2 = layout2.nodes.find((n) => n.ref === 'C');

  assert.ok(nodeA2 && nodeB2 && nodeC2);
  assert.equal(nodeA2.column, 0);
  assert.equal(nodeB2.column, 1);
  assert.equal(nodeC2.column, 2);

  // Byte-identical to original behaviour
  assert.deepEqual(layout1, layout2, 'Undefined and empty causal refs produce identical layout');
});

test('determinism: same input produces identical layout twice', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'X', kind: 'TRAVELLER', label: 'X', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'Y', kind: 'SERVICE_BOOKING', label: 'Y', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'Z', kind: 'TIMING', label: 'Z', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
      { ref: 'W', kind: 'TRANSFER_STAY', label: 'W', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'X', toRef: 'Y', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'Y', toRef: 'Z', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e3', fromRef: 'X', toRef: 'W', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
  });

  const causalRefs = ['X', 'Y', 'Z'];
  const presentation = presentDependencyGraph(ldg, { causalRefs });

  const layout1 = computeLayout(presentation, causalRefs);
  const layout2 = computeLayout(presentation, causalRefs);

  assert.deepEqual(layout1, layout2, 'Layout must be deterministic');
});

test('causal refs absent from graph are skipped safely', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
  });

  const causalRefs = ['A', 'MISSING', 'B'];
  const presentation = presentDependencyGraph(ldg, { causalRefs });

  // Should not crash, should filter out MISSING
  const layout = computeLayout(presentation, causalRefs);

  const nodeA = layout.nodes.find((n) => n.ref === 'A');
  const nodeB = layout.nodes.find((n) => n.ref === 'B');
  const nodeMissing = layout.nodes.find((n) => n.ref === 'MISSING');

  assert.ok(nodeA && nodeB);
  assert.equal(nodeMissing, undefined, 'MISSING ref not in layout');
  assert.equal(nodeA.column, 0);
  assert.equal(nodeB.column, 1);
  assert.ok(nodeA.x < nodeB.x);
});
