/**
 * Graph SCENE: the serialisable, presentation-only description of one rendered
 * graph (positions, classes, card markup, edge paths, view rectangles).
 *
 * The server builds it once; the initial HTML is generated from it and the same
 * JSON is embedded (`script.fg-scene`) so the client runtime can patch the live
 * DOM by node ref / edge key on later polls (`NorthstarGraph.update`) instead of
 * rebuilding the canvas. Nothing here is domain state: every value derives from
 * the presentation graph (tone, focus role, evaluation) plus the layout.
 */
import { createHash } from 'node:crypto';
import type { LiveDependencyGraph, FocusedGraphView } from '../../contracts/v2/product/readModels.ts';
import { presentDependencyGraph } from '../semantics/adapter.ts';
import { TONE_CLASS } from '../semantics/grammar.ts';
import type { VisualTone } from '../semantics/model.ts';
import { computeLayout } from './layout.ts';
import { nodeAttrs, nodeClass, nodeInnerHtml } from './cards.ts';

export interface SceneRect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface ScenePulse {
  /** Travel duration: GREEN normal, AMBER slower. RED / neutral / active: no pulse at all. */
  readonly dur: string;
  /** Deterministic negative begin offset so dots are not synchronised. */
  readonly begin: string;
}

export interface SceneNode {
  readonly ref: string;
  readonly entityLabel: string;
  readonly label: string;
  readonly secondaryLabel?: string;
  readonly stateLabel: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cls: string;
  readonly attrs: Record<string, string>;
  readonly html: string;
}

export interface SceneEdge {
  readonly key: string;
  readonly d: string;
  readonly cls: string;
  readonly tone: VisualTone;
  readonly source: string;
  readonly target: string;
  readonly focus: string;
  /** Presentation truth: proposed edges stay hidden until the proposed node is selected. */
  readonly truth: 'current' | 'proposed';
  readonly pulse: ScenePulse | null;
}

export interface SceneView {
  readonly rect: SceneRect;
  /** Nodes/edges kept at full strength in this view; everything else is dimmed. Absent = nothing dimmed. */
  readonly keepNodes?: readonly string[];
  readonly keepEdges?: readonly string[];
}

export type SceneViewName = 'path' | 'trip' | 'prog';

export interface GraphScene {
  readonly v: 1;
  readonly role: 'current' | 'original';
  readonly defaultView: SceneViewName;
  readonly focalRef: string | null;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly views: {
    readonly path?: SceneView;
    readonly trip: SceneView;
    readonly prog?: SceneView;
  };
}

/** GREEN normal, AMBER slower, everything else none (presentation only, tone-derived). */
export function pulseFor(tone: VisualTone): { readonly dur: string } | null {
  if (tone === 'ok') return { dur: '2.4s' };
  if (tone === 'watch') return { dur: '3.6s' };
  return null;
}

function stableUnit(key: string): number {
  const digest = createHash('sha1').update(key).digest();
  return digest.readUInt16BE(0) / 0xffff;
}

function unionRect(rects: readonly SceneRect[], pad: number): SceneRect {
  return {
    x1: Math.min(...rects.map((r) => r.x1)) - pad,
    y1: Math.min(...rects.map((r) => r.y1)) - pad,
    x2: Math.max(...rects.map((r) => r.x2)) + pad,
    y2: Math.max(...rects.map((r) => r.y2)) + pad,
  };
}

export interface BuildSceneInput {
  readonly ldg: LiveDependencyGraph;
  readonly focusedGraph?: FocusedGraphView | undefined;
  readonly role: 'current' | 'original';
}

export function buildGraphScene(input: BuildSceneInput): GraphScene {
  const { focusedGraph } = input;
  // Historical Original payloads stay immutable. Workflow plumbing is omitted
  // from their presentation just as it is from the current semantic graph.
  const visibleNodes = input.ldg.nodes.filter((node) => node.kind !== 'RECOVERY_PROPOSAL');
  const visibleRefs = new Set(visibleNodes.map((node) => node.ref));
  const ldg: LiveDependencyGraph = { ...input.ldg, nodes: visibleNodes,
    edges: input.ldg.edges.filter((edge) => visibleRefs.has(edge.fromRef) && visibleRefs.has(edge.toRef)) };
  const causalRefs = focusedGraph?.causalNodeRefs ?? [];
  const recoveryRefs = focusedGraph?.recoveryNodeRefs ?? [];
  const dependencyRefs = focusedGraph?.dependencyContextNodeRefs ?? [];
  const ownerRefs = focusedGraph?.ownerContextNodeRefs ?? [];
  const causalEdgeIds = new Set(focusedGraph?.causalEdgeIds ?? []);
  const causalEdgeIndices = ldg.edges
    .map((edge, index) => (causalEdgeIds.has(edge.id) ? index : -1))
    .filter((index) => index >= 0);

  const graph = presentDependencyGraph(ldg, { causalRefs, causalEdgeIndices });
  const focalRef = focusedGraph?.firstBreakpoint?.nodeRef;
  const layout = computeLayout(graph, causalRefs, {
    focalRef,
    recoveryNodeRefs: recoveryRefs,
    dependencyContextNodeRefs: dependencyRefs,
    ownerContextNodeRefs: ownerRefs,
  });
  const nodeByRef = new Map(graph.nodes.map((n) => [n.ref, n]));
  const causalSet = new Set(causalRefs);
  const edgeByKey = new Map(graph.edges.map((e) => [e.renderKey, e]));

  const nodes: SceneNode[] = layout.nodes.flatMap((ln) => {
    const pn = nodeByRef.get(ln.ref);
    if (!pn) return [];
    const ctx = {
      layoutNode: ln,
      presentationNode: pn,
      isFocal: ln.ref === focalRef,
      isCausal: causalSet.has(ln.ref),
      isChecking: pn.evaluationState === 'pending-reassessment',
    };
    return [{
      ref: ln.ref,
      entityLabel: pn.entityLabel,
      label: pn.label,
      ...(pn.secondaryLabel ? { secondaryLabel: pn.secondaryLabel } : {}),
      stateLabel: pn.indicator.label,
      x: ln.x,
      y: ln.y,
      w: ln.width,
      h: ln.height,
      cls: nodeClass(ctx),
      attrs: nodeAttrs(ctx),
      html: nodeInnerHtml(ctx),
    }];
  });

  const edges: SceneEdge[] = layout.edges.flatMap((le) => {
    const pe = edgeByKey.get(le.renderKey);
    if (!pe) return [];
    // The semantic adapter maps an omitted edge state to neutral. Keep that
    // neutral condition intact; a relationship cannot inherit truth from its target.
    const tone: VisualTone = pe.indicator.tone;
    const pulseSpec = pulseFor(tone);
    const pulse = pulseSpec
      ? { dur: pulseSpec.dur, begin: `-${(stableUnit(le.renderKey) * 2.2).toFixed(2)}s` }
      : null;
    const truth = pe.truthMode === 'proposed' ? 'proposed' as const : 'current' as const;
    const cls = ['fg-edge', TONE_CLASS[tone], pulse ? 'fg-pulse' : '', truth === 'proposed' ? 'fg-proposal-edge' : '']
      .filter(Boolean).join(' ');
    return [{ key: le.renderKey, d: le.d, cls, tone, source: le.sourceRef, target: le.targetRef, focus: pe.focusRole, truth, pulse }];
  });

  const rectOf = (n: SceneNode): SceneRect => ({ x1: n.x, y1: n.y, x2: n.x + n.w, y2: n.y + n.h });
  const allRect = nodes.length > 0
    ? unionRect(nodes.map(rectOf), 0)
    : { x1: 0, y1: 0, x2: 800, y2: 400 };

  const hasPath = focusedGraph !== undefined && causalRefs.some((r) => nodeByRef.has(r));
  // Default Disruption Path: mainline + proposed recovery only. Owner / stay /
  // programme stay visible but faded until the operator clicks them.
  const pathKeep = new Set([...causalRefs, ...recoveryRefs].filter((r) => nodeByRef.has(r)));
  const frameNodes = nodes.filter((n) => pathKeep.has(n.ref));
  const pathRect = frameNodes.length > 0
    ? unionRect(frameNodes.map(rectOf), 36)
    : allRect;
  const pathView: SceneView | undefined = hasPath
    ? {
        rect: pathRect,
        keepNodes: [...pathKeep],
        keepEdges: edges
          .filter((e) => pathKeep.has(e.source) && pathKeep.has(e.target))
          .map((e) => e.key),
      }
    : undefined;

  const commitmentRefs = graph.nodes.filter((n) => n.entityKind === 'PROGRAMME_COMMITMENT').map((n) => n.ref);
  let progView: SceneView | undefined;
  if (commitmentRefs.length > 0) {
    const keep = new Set(commitmentRefs);
    const near = new Set(commitmentRefs);
    for (const e of graph.edges) {
      if (keep.has(e.sourceRef)) near.add(e.targetRef);
      if (keep.has(e.targetRef)) near.add(e.sourceRef);
    }
    const nearNodes = nodes.filter((n) => near.has(n.ref));
    progView = {
      rect: unionRect(nearNodes.map(rectOf), 0),
      keepNodes: commitmentRefs,
      keepEdges: [],
    };
  }

  return {
    v: 1,
    role: input.role,
    defaultView: pathView ? 'path' : 'trip',
    focalRef: focalRef ?? null,
    width: layout.width,
    height: layout.height,
    nodes,
    edges,
    views: {
      ...(pathView ? { path: pathView } : {}),
      trip: { rect: allRect },
      ...(progView ? { prog: progView } : {}),
    },
  };
}

/** JSON safe to embed in a <script type="application/json"> element. */
export function sceneJson(scene: GraphScene): string {
  return JSON.stringify(scene)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
}

export function sceneHash(json: string): string {
  return createHash('sha1').update(json).digest('hex').slice(0, 12);
}

