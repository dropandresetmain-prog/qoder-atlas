/**
 * Deterministic left-to-right graph layout (V5.6 composition).
 *
 * Pure function: graph -> positions + edge geometry. No DOM, no force/physics,
 * no randomness. Card size is derived from the node's ROLE in the graph (focal
 * breakpoint / secondary alert on the spine / normal spine / small context),
 * never from what the node is about.
 *
 * With a causal spine: causal refs take monotonically increasing columns in
 * backend causal order, vertically centred on one line with tight gaps. Healthy
 * context hangs in a compact band BELOW the spine, each item under the spine
 * column it is attached to. Without a spine: longest-path ranking.
 */
import type { PresentationGraph, PresentationNode } from '../semantics/model.ts';
import { routeEdge, type Box, type EdgeRoute } from './geometry.ts';

export type SizeClass = 'focal' | 'secondary' | 'normal' | 'small';

export interface LayoutNode {
  readonly ref: string;
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sizeClass: SizeClass;
}

export interface LayoutEdge {
  readonly renderKey: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly route: EdgeRoute;
  /** SVG path data measured from the card boxes. */
  readonly d: string;
}

export interface LayoutResult {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

export interface LayoutOptions {
  /** The first breakpoint node ref; gets the focal card size. */
  readonly focalRef?: string | undefined;
}

export const SIZES: Record<SizeClass, { readonly w: number; readonly h: number }> = {
  focal: { w: 226, h: 108 },
  secondary: { w: 184, h: 96 },
  normal: { w: 168, h: 88 },
  small: { w: 152, h: 78 },
};

const SPINE_GAP = 46;
const BAND_GAP = 58;
const BAND_ROW_GAP = 18;
const CTX_GAP = 14;
const COLUMN_GAP = 56;
const ROW_GAP = 22;
const PADDING = 36;

function sizeClassFor(node: PresentationNode, isSpine: boolean, isFocal: boolean): SizeClass {
  if (isFocal) return 'focal';
  if (!isSpine) return 'small';
  return node.indicator.tone === 'alert' ? 'secondary' : 'normal';
}

export function computeLayout(
  graph: PresentationGraph,
  causalNodeRefs?: readonly string[],
  options: LayoutOptions = {},
): LayoutResult {
  const nodeRefSet = new Set(graph.nodes.map((n) => n.ref));
  const presentCausalRefs = causalNodeRefs != null ? causalNodeRefs.filter((ref) => nodeRefSet.has(ref)) : [];
  return presentCausalRefs.length > 0
    ? computeCausalSpineLayout(graph, presentCausalRefs, options)
    : computeLongestPathLayout(graph, options);
}

function computeCausalSpineLayout(
  graph: PresentationGraph,
  causalRefs: readonly string[],
  options: LayoutOptions,
): LayoutResult {
  const nodeByRef = new Map(graph.nodes.map((n) => [n.ref, n]));
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.ref, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.sourceRef)?.push(edge.targetRef);
    adjacency.get(edge.targetRef)?.push(edge.sourceRef);
  }

  const causalColumn = new Map<string, number>();
  causalRefs.forEach((ref, i) => causalColumn.set(ref, i));

  // Nearest causal column for every context node (multi-source BFS, undirected).
  const nodeColumn = new Map<string, number>(causalColumn);
  const queue: string[] = [...causalRefs];
  const visited = new Set(causalRefs);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const col = nodeColumn.get(current)!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      nodeColumn.set(neighbor, col);
      queue.push(neighbor);
    }
  }
  for (const node of graph.nodes) if (!nodeColumn.has(node.ref)) nodeColumn.set(node.ref, 0);

  // Spine geometry: one centre line, tight gaps.
  const spineNodes = causalRefs.map((ref) => {
    const node = nodeByRef.get(ref)!;
    return { ref, sizeClass: sizeClassFor(node, true, ref === options.focalRef) };
  });
  const maxSpineH = Math.max(...spineNodes.map((s) => SIZES[s.sizeClass].h));
  const centerY = PADDING + maxSpineH / 2;
  const placed = new Map<string, LayoutNode>();
  let cursorX = PADDING;
  spineNodes.forEach((s, i) => {
    const { w, h } = SIZES[s.sizeClass];
    placed.set(s.ref, { ref: s.ref, column: i, row: 0, x: cursorX, y: centerY - h / 2, width: w, height: h, sizeClass: s.sizeClass });
    cursorX += w + SPINE_GAP;
  });
  const spineRight = cursorX - SPINE_GAP;
  const spineBottom = PADDING + maxSpineH;

  // Context band: compact rows under the spine, each item near its anchor column.
  const causalSet = new Set(causalRefs);
  const contextRefs = graph.nodes
    .filter((n) => !causalSet.has(n.ref))
    .map((n) => n.ref)
    .sort((a, b) => (nodeColumn.get(a)! - nodeColumn.get(b)!) || a.localeCompare(b));
  const rowCursors: number[] = [];
  const limitRight = spineRight + 24;
  const { w: cw, h: ch } = SIZES.small;
  for (const ref of contextRefs) {
    const col = nodeColumn.get(ref)!;
    const anchor = placed.get(causalRefs[col]!)!;
    const desiredX = anchor.x;
    let r = 0;
    for (;;) {
      const cur = rowCursors[r] ?? PADDING;
      const x = Math.max(cur, desiredX);
      if (x + cw <= limitRight || r >= 3) {
        rowCursors[r] = x + cw + CTX_GAP;
        placed.set(ref, {
          ref, column: col, row: 1 + r, x,
          y: spineBottom + BAND_GAP + r * (ch + BAND_ROW_GAP),
          width: cw, height: ch, sizeClass: 'small',
        });
        break;
      }
      r++;
    }
  }

  return finish(graph, graph.nodes.map((n) => placed.get(n.ref)!));
}

function computeLongestPathLayout(graph: PresentationGraph, options: LayoutOptions): LayoutResult {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.ref, []);
  for (const edge of graph.edges) incoming.get(edge.targetRef)?.push(edge.sourceRef);

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  function computeRank(ref: string): number {
    if (rank.has(ref)) return rank.get(ref)!;
    if (visiting.has(ref)) return 0; // cycle guard
    visiting.add(ref);
    const preds = incoming.get(ref) ?? [];
    const r = preds.length === 0 ? 0 : Math.max(...preds.map(computeRank)) + 1;
    rank.set(ref, r);
    return r;
  }
  for (const node of graph.nodes) computeRank(node.ref);

  const columns = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const col = rank.get(node.ref) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node.ref);
  }
  for (const refs of columns.values()) refs.sort();

  const nodeByRef = new Map(graph.nodes.map((n) => [n.ref, n]));
  const sizeOf = (ref: string): SizeClass => sizeClassFor(nodeByRef.get(ref)!, true, ref === options.focalRef);
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);
  const colHeights = new Map<number, number>();
  for (const col of sortedCols) {
    const refs = columns.get(col)!;
    colHeights.set(col, refs.reduce((sum, ref, i) => sum + SIZES[sizeOf(ref)].h + (i > 0 ? ROW_GAP : 0), 0));
  }
  const tallest = Math.max(0, ...colHeights.values());

  const nodes: LayoutNode[] = [];
  let x = PADDING;
  for (const col of sortedCols) {
    const refs = columns.get(col)!;
    const colW = Math.max(...refs.map((ref) => SIZES[sizeOf(ref)].w));
    let y = PADDING + (tallest - colHeights.get(col)!) / 2;
    refs.forEach((ref, row) => {
      const sc = sizeOf(ref);
      const { w, h } = SIZES[sc];
      nodes.push({ ref, column: col, row, x: x + (colW - w) / 2, y, width: w, height: h, sizeClass: sc });
      y += h + ROW_GAP;
    });
    x += colW + COLUMN_GAP;
  }
  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  return finish(graph, graph.nodes.map((n) => byRef.get(n.ref)!));
}

interface Pending {
  readonly edge: PresentationGraph['edges'][number];
  readonly s: Box;
  readonly t: Box;
  readonly vertical: boolean;
  readonly down: boolean;
}

function finish(graph: PresentationGraph, nodes: readonly LayoutNode[]): LayoutResult {
  const box = new Map<string, Box>(nodes.map((n) => [n.ref, { x: n.x, y: n.y, w: n.width, h: n.height }]));

  const pending: Pending[] = [];
  for (const edge of graph.edges) {
    const s = box.get(edge.sourceRef);
    const t = box.get(edge.targetRef);
    if (!s || !t) continue;
    pending.push({ edge, s, t, vertical: !(t.x >= s.x + s.w + 8), down: t.y >= s.y + s.h - 4 });
  }

  // Distribute anchors when several edges share one source surface.
  const groupOf = (p: Pending): string => `${p.edge.sourceRef}|${p.vertical ? (p.down ? 'b' : 't') : 'r'}`;
  const order = (a: Pending, b: Pending): number =>
    (a.vertical ? a.t.x - b.t.x : a.t.y - b.t.y) || a.edge.renderKey.localeCompare(b.edge.renderKey);
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    const k = groupOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  for (const list of groups.values()) list.sort(order);

  const edges: LayoutEdge[] = pending.map((p) => {
    const list = groups.get(groupOf(p))!;
    const index = list.indexOf(p);
    const fraction = list.length > 1 ? (index + 1) / (list.length + 1) : 0.5;
    const g = routeEdge(p.s, p.t, index, list.length, fraction);
    return {
      renderKey: p.edge.renderKey,
      sourceRef: p.edge.sourceRef,
      targetRef: p.edge.targetRef,
      sourceX: g.sourceX, sourceY: g.sourceY, targetX: g.targetX, targetY: g.targetY,
      route: g.route, d: g.d,
    };
  });

  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { nodes, edges, width: maxX + PADDING, height: maxY + PADDING };
}
