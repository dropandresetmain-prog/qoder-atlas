/**
 * Focused case graph renderer entry point.
 *
 * semantic adapter -> layout -> scene -> server HTML (+ embedded scene JSON).
 * The client runtime (`runtime.ts`, exposed as `window.NorthstarGraph`) drives
 * pan/zoom/views/selection and patches the live DOM from later scenes so polling
 * never rebuilds the canvas.
 *
 * Public surface is unchanged: `renderFocusedCaseGraph(input) -> string`.
 * The graph root (`.fg-canvas`) carries `data-graph-scene-hash` (hash of the scene
 * JSON): a poller only needs to touch the graph when that value changed.
 */
import type {
  FocusedGraphView,
  LiveDependencyGraph,
  RecoveryCaseView,
} from '../../contracts/v2/product/readModels.ts';
import { escapeHtml as esc } from '../html.ts';
import { attrsToHtml } from './cards.ts';
import { buildGraphScene, sceneHash, sceneJson, type GraphScene } from './scene.ts';
import { FOCUSED_GRAPH_CSS } from './styles.ts';
import { INTERACTIONS_SCRIPT } from './interactions.ts';

export interface RenderFocusedCaseGraphInput {
  readonly ldg: LiveDependencyGraph;
  readonly focusedGraph?: FocusedGraphView;
  readonly caseStatus: RecoveryCaseView['status'];
  /**
   * Which graph of the Original/Current pair this is (`data-graph-role`). The
   * runtime keys each canvas's pan/zoom/view/selection by it so a polling swap can
   * restore what the operator was looking at. Default `current`.
   */
  readonly role?: 'current' | 'original';
  /**
   * Emit the stylesheet + runtime script with the graph (default true). A page
   * that renders two graphs emits them once, with the first.
   */
  readonly includeAssets?: boolean;
}

const VIEW_LABELS = { path: 'Disruption Path', trip: 'Full trip', prog: 'Programme' } as const;

function stageHtml(scene: GraphScene): string {
  const paths = scene.edges.map((e) =>
    `<path class="${esc(e.cls)}" d="${e.d}" data-edge-key="${esc(e.key)}" data-source="${esc(e.source)}" data-target="${esc(e.target)}" data-focus="${e.focus}" data-tone="${e.tone}" fill="none"/>`).join('\n');
  const pulses = scene.edges.filter((e) => e.pulse).map((e) =>
    `<circle class="fg-pulse-dot sem-${e.tone}" r="3" data-pulse-for="${esc(e.key)}"><animateMotion dur="${e.pulse!.dur}" begin="${e.pulse!.begin}" repeatCount="indefinite" path="${e.d}"/></circle>`).join('\n');
  const svg = `<svg class="fg-edges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<g class="fg-edge-layer">${paths}</g>
<g class="fg-pulses">${pulses}</g>
</svg>`;
  const nodes = scene.nodes.map((n) =>
    `<article class="${esc(n.cls)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;" ${attrsToHtml(n.attrs)}>
${n.html}
</article>`).join('\n');
  return `<div class="fg-stage" data-view="${scene.defaultView}">
${svg}
${nodes}
</div>`;
}

/** Render the focused case graph as an HTML string. */
export function renderFocusedCaseGraph(input: RenderFocusedCaseGraphInput): string {
  const { ldg, focusedGraph, caseStatus } = input;
  const role = input.role ?? 'current';
  const scene = buildGraphScene({ ldg, focusedGraph, role });
  const json = sceneJson(scene);
  const hash = sceneHash(json);

  const viewButtons = (['path', 'trip', 'prog'] as const)
    .filter((name) => name !== 'prog' || scene.views.prog)
    .map((name) => {
      const disabled = name === 'path' && !scene.views.path ? ' disabled' : '';
      const active = name === scene.defaultView ? ' active' : '';
      return `<button type="button" class="${active.trim()}" data-view="${name}"${disabled}>${VIEW_LABELS[name]}</button>`;
    }).join('\n  ');

  const canvasHtml = `
<div class="fg-canvas" data-test="focused-case-graph" data-graph-role="${role}" data-graph-scene-hash="${hash}" data-default-view="${scene.defaultView}">
  <div class="fg-views">
  ${viewButtons}
  </div>
  <div class="fg-toolbar">
    <button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
    <button type="button" data-action="home" aria-label="Reset view" title="Return to current view">⌂</button>
    <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
    <div class="fg-zoom-readout">100%</div>
  </div>
  <div class="fg-hint">Drag to pan · scroll to zoom · click a node to trace dependencies</div>
  <div class="fg-viewport" tabindex="0" aria-label="Dependency graph">
${stageHtml(scene)}
  </div>
  <script type="application/json" class="fg-scene">${json}</script>
</div>`;

  const graphContent = caseStatus === 'PLANNING'
    ? `
<div class="fg-planning-wrapper">
  <div class="fg-planning-banner">NORTHSTAR is investigating…</div>
  ${canvasHtml}
</div>`
    : canvasHtml;

  if (input.includeAssets === false) return graphContent;
  return `
<style>
${FOCUSED_GRAPH_CSS}
</style>
${graphContent}
<script>
${INTERACTIONS_SCRIPT}
</script>`;
}
