/**
 * R2 LANE B — focused case graph renderer entry point.
 *
 * Assembles: semantic adapter -> layout -> cards/edges -> styles -> interactions.
 * Returns server-rendered HTML string. No client framework.
 */
import type {
  FocusedGraphView,
  LiveDependencyGraph,
  RecoveryCaseView,
} from '../../contracts/v2/product/readModels.ts';
import { presentDependencyGraph } from '../semantics/adapter.ts';
import { computeLayout } from './layout.ts';
import { renderNodeCard } from './cards.ts';
import { FOCUSED_GRAPH_CSS } from './styles.ts';
import { INTERACTIONS_SCRIPT } from './interactions.ts';

export interface RenderFocusedCaseGraphInput {
  readonly ldg: LiveDependencyGraph;
  readonly focusedGraph?: FocusedGraphView;
  readonly caseStatus: RecoveryCaseView['status'];
}

/**
 * Render the focused case graph as an HTML string.
 *
 * Single semantic mapping layer: calls presentDependencyGraph with focus
 * derived from focusedGraph (causalRefs, causalEdgeIndices via index lookup).
 *
 * Deterministic layout: longest-path ranking from source nodes.
 * V5.6 visual language: type label, title, state badge, health border.
 * Focal emphasis: firstBreakpoint gets larger card + amber ring.
 * Causal emphasis: causal chain nodes/edges highlighted.
 * Checking presentation: pending-reassessment shows "Checking…" badge.
 * Pulse: pure CSS animation derived from tone (ok/watch/alert).
 * Planning wrapper: when caseStatus is PLANNING, wraps graph in animated border.
 */
export function renderFocusedCaseGraph(input: RenderFocusedCaseGraphInput): string {
  const { ldg, focusedGraph, caseStatus } = input;

  // Build focus for semantic adapter
  const causalRefs = focusedGraph?.causalNodeRefs ?? [];
  const causalEdgeIds = new Set(focusedGraph?.causalEdgeIds ?? []);

  // Map causalEdgeIds to indices (LOOKUP, never topology traversal)
  const causalEdgeIndices = ldg.edges
    .map((edge, index) => (causalEdgeIds.has(edge.id) ? index : -1))
    .filter((index) => index >= 0);

  // Call semantic adapter (single mapping layer)
  const presentationGraph = presentDependencyGraph(ldg, {
    causalRefs,
    causalEdgeIndices,
  });

  // Compute deterministic layout
  const layout = computeLayout(presentationGraph);

  // Build node map for quick lookup
  const nodeByRef = new Map(presentationGraph.nodes.map((n) => [n.ref, n]));

  // Focal node (firstBreakpoint)
  const focalRef = focusedGraph?.firstBreakpoint?.nodeRef;

  // Causal node set
  const causalRefSet = new Set(causalRefs);

  // Render node cards with pulse classes
  const nodeCardsHtml = layout.nodes.map((layoutNode) => {
    const presentationNode = nodeByRef.get(layoutNode.ref);
    if (!presentationNode) return '';

    const isFocal = layoutNode.ref === focalRef;
    const isCausal = causalRefSet.has(layoutNode.ref);
    const isChecking = presentationNode.evaluationState === 'pending-reassessment';

    // Pulse: ok/watch get pulse, alert gets none
    const shouldPulse = presentationNode.indicator.tone === 'ok' || presentationNode.indicator.tone === 'watch';

    const card = renderNodeCard({
      layoutNode,
      presentationNode,
      isFocal,
      isCausal,
      isChecking,
      pulseClass: shouldPulse ? 'fg-pulse' : '',
    });

    return card;
  }).join('\n');

  // Render edges with focus roles
  const edgeElements = layout.edges.map((layoutEdge) => {
    const presentationEdge = presentationGraph.edges.find(
      (e) => e.renderKey === layoutEdge.renderKey
    );
    if (!presentationEdge) return null;

    const toneClass = `sem-${presentationEdge.indicator.tone}`;
    const focusRole = presentationEdge.focusRole;

    // Pulse class: ok/watch get pulse, alert gets none
    const shouldPulse = presentationEdge.indicator.tone === 'ok' || presentationEdge.indicator.tone === 'watch';
    const pulseClass = shouldPulse ? 'fg-pulse' : '';

    return {
      ...layoutEdge,
      toneClass,
      focusRole,
      pulseClass,
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  // Build edge SVG with proper classes
  const edgeSvg = edgeElements.length > 0
    ? `<svg class="fg-edges" xmlns="http://www.w3.org/2000/svg">
${edgeElements.map((edge) => {
  const dx = edge.targetX - edge.sourceX;
  const handle = Math.max(4, Math.min(72, dx * 0.36));
  const d = `M${edge.sourceX} ${edge.sourceY} C${edge.sourceX + handle} ${edge.sourceY},${edge.targetX - handle} ${edge.targetY},${edge.targetX} ${edge.targetY}`;

  return `<path
    class="fg-edge ${edge.toneClass} ${edge.pulseClass}"
    d="${d}"
    data-edge-key="${edge.renderKey}"
    data-source="${edge.sourceRef}"
    data-target="${edge.targetRef}"
    data-focus="${edge.focusRole}"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  />`;
}).join('\n')}
</svg>`
    : '';

  // Named views
  const hasFocusedGraph = focusedGraph !== undefined && causalRefs.length > 0;
  const disruptionDisabled = !hasFocusedGraph ? 'disabled' : '';

  const viewsHtml = `
<div class="fg-views">
  <button type="button" class="active" data-view="overview">Trip Overview</button>
  <button type="button" data-view="disruption" ${disruptionDisabled}>Disruption Path</button>
</div>`;

  // Toolbar
  const toolbarHtml = `
<div class="fg-toolbar">
  <button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
  <button type="button" data-action="home" aria-label="Reset view">⌂</button>
  <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
  <div class="fg-zoom-readout">100%</div>
</div>`;

  // Stage content
  const stageHtml = `
<div class="fg-stage" style="width:${layout.width}px;height:${layout.height}px;">
  ${edgeSvg}
  ${nodeCardsHtml}
</div>`;

  // Viewport
  const viewportHtml = `
<div class="fg-viewport">
  ${stageHtml}
</div>`;

  // Canvas
  const canvasHtml = `
<div class="fg-canvas" data-test="focused-case-graph">
  ${viewsHtml}
  ${toolbarHtml}
  ${viewportHtml}
</div>`;

  // Planning wrapper (when caseStatus is PLANNING)
  const graphContent = caseStatus === 'PLANNING'
    ? `
<div class="fg-planning-wrapper">
  <div class="fg-planning-banner">NORTHSTAR is investigating…</div>
  ${canvasHtml}
</div>`
    : canvasHtml;

  // Full output with styles and script
  return `
<style>
${FOCUSED_GRAPH_CSS}
</style>
${graphContent}
<script>
${INTERACTIONS_SCRIPT}
</script>`;
}
