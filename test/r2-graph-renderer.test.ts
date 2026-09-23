/**
 * R2 LANE V — graph renderer tests.
 *
 * Pure tests (no browser): determinism, layout, focus roles, visual treatments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LiveDependencyGraph, FocusedGraphView } from '../src/contracts/v2/product/readModels.ts';
import { renderFocusedCaseGraph } from '../src/ui/graph/index.ts';
import { computeLayout } from '../src/ui/graph/layout.ts';
import { presentDependencyGraph } from '../src/ui/semantics/adapter.ts';
import { buildGraphScene } from '../src/ui/graph/scene.ts';

// Helper: build a minimal valid LDG
function makeLdg(overrides?: Partial<LiveDependencyGraph>): LiveDependencyGraph {
  return {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'Traveller A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'Booking B', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
    change: {
      projectionRevision: 1,
      changedVisibleRefs: [],
      changedEdgeIds: [],
      currentSemanticState: 'HEALTHY',
    },
    ...overrides,
  };
}

test('determinism: same input produces identical HTML', () => {
  const ldg = makeLdg();
  const focusedGraph: FocusedGraphView = {
    causalNodeRefs: ['A', 'B'],
    causalEdgeIds: ['e1'],
    unmappedCausalSteps: [],
  };

  const html1 = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'OPEN' });
  const html2 = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'OPEN' });

  assert.equal(html1, html2, 'Renderer must be deterministic');
  const scene = buildGraphScene({ ldg, focusedGraph, role: 'current' });
  assert.ok(scene.width > 0 && scene.height > 0);
  assert.ok(html1.includes(`style="width:${scene.width}px;height:${scene.height}px;"`),
    'Initial stage must give the SVG a viewport before the first changed poll');
});

test('selected node exposes full human detail in an accessible inspector', () => {
  const html = renderFocusedCaseGraph({
    ldg: makeLdg({ nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'Traveller <Alice>', detail: 'Full detail & context', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'Booking', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ] }),
    caseStatus: 'OPEN',
  });
  assert.match(html, /data-graph-inspector/);
  assert.match(html, /data-inspector-title/);
  assert.match(html, /data-inspector-detail/);
  assert.match(html, /data-inspector-state/);
  assert.match(html, /textContent/);
  assert.match(html, /Full detail &amp; context/);
  assert.match(html, /hidden/);
});

test('arrival cards format supplied instants and historical workflow omission does not mutate Original', () => {
  const original = makeLdg({ nodes: [
    { ref: 'workflow', kind: 'RECOVERY_PROPOSAL', label: 'Workflow plumbing', semanticState: 'ACTIVE', authority: 'AUTHORITATIVE' },
    { ref: 'arrival', kind: 'TIMING', label: 'Arrival timing', semanticState: 'CHANGED', authority: 'AUTHORITATIVE',
      timing: { currentAt: '2031-05-01T08:00:00.000Z', publishedAt: '2031-05-01T06:00:00.000Z', timeZone: 'Asia/Singapore' } },
  ], edges: [] });
  const before = JSON.stringify(original);
  const scene = buildGraphScene({ ldg: original, role: 'original' });
  assert.equal(JSON.stringify(original), before);
  assert.equal(scene.nodes.some((node) => node.ref === 'workflow'), false);
  assert.match(scene.nodes[0]!.html, /14:00 GMT\+8 → 1 May, 16:00/);
  assert.match(scene.nodes[0]!.html, /datetime="2031-05-01T08:00:00.000Z"/);
});

test('layout: chain graph assigns correct ranks', () => {
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
  const layout = computeLayout(presentation);

  const nodeA = layout.nodes.find((n) => n.ref === 'A');
  const nodeB = layout.nodes.find((n) => n.ref === 'B');
  const nodeC = layout.nodes.find((n) => n.ref === 'C');

  assert.ok(nodeA && nodeB && nodeC);
  assert.equal(nodeA.column, 0, 'Source node should be in column 0');
  assert.equal(nodeB.column, 1, 'Middle node should be in column 1');
  assert.equal(nodeC.column, 2, 'Sink node should be in column 2');
  assert.ok(nodeA.x < nodeB.x, 'A should be left of B');
  assert.ok(nodeB.x < nodeC.x, 'B should be left of C');
});

test('causalEdgeIndices lookup feeds focus roles', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'C', kind: 'TIMING', label: 'C', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'B', toRef: 'C', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
    ],
  });

  const focusedGraph: FocusedGraphView = {
    causalNodeRefs: ['A', 'B'],
    causalEdgeIds: ['e1'], // Only first edge is causal
    unmappedCausalSteps: [],
  };

  const html = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'OPEN' });

  // Edge e1 should have causal focus
  assert.ok(html.includes('data-edge-key="e1"') && html.includes('data-focus="causal"'));
  // Edge e2 should have context focus
  assert.ok(html.includes('data-edge-key="e2"') && html.includes('data-focus="context"'));
});

test('firstBreakpoint card gets focal treatment', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
  });

  const focusedGraph: FocusedGraphView = {
    causalNodeRefs: ['B'],
    causalEdgeIds: ['e1'],
    unmappedCausalSteps: [],
    firstBreakpoint: {
      nodeRef: 'B',
      label: 'B',
      dimension: 'timing',
      reasonCode: 'LATE',
    },
  };

  const html = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'OPEN' });

  // Node B should have focal class
  assert.ok(html.includes('data-ref="B"') && html.includes('fg-focal'));
});

test('PENDING_REASSESSMENT node shows checking badge while semantic tone unchanged', () => {
  const ldg = makeLdg({
    nodes: [
      {
        ref: 'A',
        kind: 'SERVICE_BOOKING',
        label: 'Booking A',
        semanticState: 'HEALTHY', // Semantic state is HEALTHY
        authority: 'AUTHORITATIVE',
        evaluation: 'PENDING_REASSESSMENT', // But evaluation is pending
      },
    ],
    edges: [],
  });

  const html = renderFocusedCaseGraph({ ldg, caseStatus: 'OPEN' });

  // Should have checking badge
  assert.ok(html.includes('Checking…'), 'Should show checking badge');
  // Should still have ok tone (semantic state unchanged)
  assert.ok(html.includes('sem-ok'), 'Should have ok tone class');
  // Should have data-evaluation attribute
  assert.ok(html.includes('data-evaluation="pending-reassessment"'));
});

test('pending reassessment of an unknown node reads Rechecking', () => {
  const html = renderFocusedCaseGraph({
    ldg: makeLdg({
      nodes: [{
        ref: 'A', kind: 'SERVICE_BOOKING', label: 'Booking A', semanticState: 'UNKNOWN',
        authority: 'AUTHORITATIVE', evaluation: 'PENDING_REASSESSMENT',
      }],
      edges: [],
    }),
    caseStatus: 'OPEN',
  });
  assert.ok(html.includes('Rechecking'));
  assert.equal(html.includes('Unknown / unconfirmed'), false);
});

test('alert-tone edge has no pulse class, ok-tone has pulse', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'C', kind: 'TIMING', label: 'C', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE', semanticState: 'FAILED' },
      { id: 'e2', fromRef: 'B', toRef: 'C', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE', semanticState: 'HEALTHY' },
    ],
  });

  const html = renderFocusedCaseGraph({ ldg, caseStatus: 'OPEN' });

  // Extract edge path elements (class comes before data-edge-key in the HTML)
  const e1Match = html.match(/class="([^"]*)"[^>]*data-edge-key="e1"/);
  const e2Match = html.match(/class="([^"]*)"[^>]*data-edge-key="e2"/);

  assert.ok(e1Match, 'e1 path should be present');
  assert.ok(e2Match, 'e2 path should be present');
  const e1Classes = e1Match![1]!;
  const e2Classes = e2Match![1]!;

  // e1 (FAILED/alert) should NOT have fg-pulse
  assert.ok(!e1Classes.includes('fg-pulse'), 'Alert edge should not pulse');
  // e2 (HEALTHY/ok) should have fg-pulse
  assert.ok(e2Classes.includes('fg-pulse'), 'Ok edge should pulse');
});

test('edge without semantic state stays neutral and does not pulse', () => {
  const html = renderFocusedCaseGraph({
    ldg: makeLdg(),
    caseStatus: 'OPEN',
  });

  const edgeMatch = html.match(/class="([^"]*)"[^>]*data-edge-key="e1"[^>]*data-tone="([^"]*)"/);
  assert.ok(edgeMatch, 'edge path should be present');
  assert.ok(edgeMatch![1]!.includes('sem-neutral'), 'missing edge state should remain neutral');
  assert.equal(edgeMatch![2], 'neutral');
  assert.ok(!edgeMatch![1]!.includes('fg-pulse'), 'neutral edge should not pulse');
  assert.ok(!html.includes('data-pulse-for="e1"'), 'neutral edge should have no pulse element');
});

test('Disruption Path frames supplied causal nodes while retaining context nodes', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'A', kind: 'TRAVELLER', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'B', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'C', kind: 'TRANSFER_STAY', label: 'Context C', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'A', toRef: 'B', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'B', toRef: 'C', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
    ],
  });
  const focusedGraph: FocusedGraphView = {
    causalNodeRefs: ['A', 'B'],
    causalEdgeIds: ['e1'],
    unmappedCausalSteps: [],
  };

  const html = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'OPEN' });
  const scene = JSON.parse(html.match(/<script type="application\/json" class="fg-scene">([\s\S]*?)<\/script>/)![1]!);
  assert.ok(scene.nodes.some((node: { ref: string }) => node.ref === 'C'), 'healthy context node remains rendered');
  assert.ok(scene.views.path.rect.y2 < scene.views.trip.rect.y2, 'path view should exclude context extent from framing');
  assert.deepEqual(scene.views.path.keepNodes, ['A', 'B']);
});

test('Disruption Path keeps proposed recovery sharp; owner and deps stay faded', () => {
  const ldg = makeLdg({
    nodes: [
      { ref: 'IN', kind: 'SERVICE_BOOKING', label: 'Inbound', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'ARR', kind: 'TIMING', label: 'Arrival', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'ON', kind: 'SERVICE_BOOKING', label: 'Onward', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'REC', kind: 'SERVICE_BOOKING', label: 'Proposed', semanticState: 'PROPOSED', authority: 'PROPOSED' },
      { ref: 'OWN', kind: 'TRAVELLER', label: 'Traveller', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'STAY', kind: 'TRANSFER_STAY', label: 'Stay', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'IN', toRef: 'ARR', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
      { id: 'e2', fromRef: 'ARR', toRef: 'ON', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE', semanticState: 'FAILED' },
      { id: 'e3', fromRef: 'ARR', toRef: 'REC', kind: 'MUST_HAPPEN_BEFORE', authority: 'PROPOSED', semanticState: 'PROPOSED' },
      { id: 'e4', fromRef: 'OWN', toRef: 'STAY', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
  });
  const focusedGraph: FocusedGraphView = {
    causalNodeRefs: ['IN', 'ARR', 'ON'],
    causalEdgeIds: ['e1', 'e2'],
    recoveryNodeRefs: ['REC'],
    ownerContextNodeRefs: ['OWN'],
    dependencyContextNodeRefs: ['STAY'],
    unmappedCausalSteps: [],
  };
  const html = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'AWAITING_AUTHORITY' });
  const scene = JSON.parse(html.match(/<script type="application\/json" class="fg-scene">([\s\S]*?)<\/script>/)![1]!);
  assert.deepEqual([...scene.views.path.keepNodes].sort(), ['ARR', 'IN', 'ON', 'REC']);
  assert.ok(scene.views.path.keepEdges.includes('e3'), 'Arrival → proposed stays in the path keep set');
  assert.ok(html.includes('fg-proposal-edge'), 'proposed edge is dashed');
  assert.ok(!html.includes('.fg-edge.fg-proposal-edge,\n.fg-pulse-dot.fg-proposal-edge { opacity: 0; }'),
    'proposed edges are not hidden until click');
});

test('trip view uses the accepted Trip Overview label', () => {
  const html = renderFocusedCaseGraph({ ldg: makeLdg(), caseStatus: 'OPEN' });
  assert.ok(html.includes('data-view="trip">Trip Overview</button>'));
  assert.ok(!html.includes('>Full trip</button>'));
});

test('PLANNING status wrapper present, absent for OPEN', () => {
  const ldg = makeLdg();

  const htmlPlanning = renderFocusedCaseGraph({ ldg, caseStatus: 'PLANNING' });
  const htmlOpen = renderFocusedCaseGraph({ ldg, caseStatus: 'OPEN' });

  // Check for actual wrapper element, not just CSS selector
  assert.ok(htmlPlanning.includes('<div class="fg-planning-wrapper">'), 'PLANNING should have wrapper element');
  assert.ok(htmlPlanning.includes('NORTHSTAR is investigating'), 'PLANNING should have banner');
  assert.ok(!htmlOpen.includes('<div class="fg-planning-wrapper">'), 'OPEN should not have wrapper element');
});

test('empty focusedGraph -> no disruption-path view', () => {
  const ldg = makeLdg();

  // No focusedGraph
  const html1 = renderFocusedCaseGraph({ ldg, caseStatus: 'OPEN' });
  assert.ok(html1.includes('disabled'), 'Disruption Path button should be disabled');

  // Empty focusedGraph
  const focusedGraph: FocusedGraphView = {
    causalNodeRefs: [],
    causalEdgeIds: [],
    unmappedCausalSteps: [],
  };
  const html2 = renderFocusedCaseGraph({ ldg, focusedGraph, caseStatus: 'OPEN' });
  assert.ok(html2.includes('disabled'), 'Disruption Path button should be disabled');
});

test('renderer output for TWO materially different graphs uses identical code', () => {
  // Graph 1: programme-shaped (commitment + objective)
  const ldg1 = makeLdg({
    nodes: [
      { ref: 'T', kind: 'TRAVELLER', label: 'Traveller', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'C', kind: 'PROGRAMME_COMMITMENT', label: 'Commitment', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'T', toRef: 'C', kind: 'PARTICIPATES_IN', authority: 'AUTHORITATIVE' },
    ],
  });

  // Graph 2: connection-shaped (flight + transfer)
  const ldg2 = makeLdg({
    nodes: [
      { ref: 'F', kind: 'SERVICE_BOOKING', label: 'Flight', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      { ref: 'G', kind: 'TRANSFER_STAY', label: 'Transfer', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e1', fromRef: 'F', toRef: 'G', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE' },
    ],
  });

  const html1 = renderFocusedCaseGraph({ ldg: ldg1, caseStatus: 'OPEN' });
  const html2 = renderFocusedCaseGraph({ ldg: ldg2, caseStatus: 'OPEN' });

  // Both should have the same structural elements
  assert.ok(html1.includes('fg-canvas'));
  assert.ok(html2.includes('fg-canvas'));
  assert.ok(html1.includes('fg-viewport'));
  assert.ok(html2.includes('fg-viewport'));
  assert.ok(html1.includes('fg-stage'));
  assert.ok(html2.includes('fg-stage'));
  assert.ok(html1.includes('fg-edges'));
  assert.ok(html2.includes('fg-edges'));
  assert.ok(html1.includes('fg-node'));
  assert.ok(html2.includes('fg-node'));

  // Both should have the same CSS (check for actual CSS content)
  assert.ok(html1.includes('.fg-canvas'));
  assert.ok(html2.includes('.fg-canvas'));
  assert.ok(html1.includes('.fg-node'));
  assert.ok(html2.includes('.fg-node'));
});
