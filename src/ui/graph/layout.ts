/**
 * Deterministic hierarchical graph layout (V5.6 composition + CP5.1 roles).
 *
 * Pure function: graph + presentation roles -> positions + edge geometry.
 * No DOM, no force/physics, no randomness. Card size is derived from the node's
 * ROLE in the graph (focal breakpoint / secondary alert on the spine / recovery
 * branch / normal spine / small context), never from what the node is about.
 *
 * With a causal spine (Sarah-style composition):
 * - causal refs form ONE dominant horizontal mainline (including a FAILED
 *   original onward booking when the connection is broken)
 * - a single bottom band holds owner (left), stay/programme context (middle),
 *   and proposed recovery (right, under the current onward booking)
 *
 * Without a spine: longest-path ranking.
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

export interface LayoutRoles {
  /** The first breakpoint node ref; gets the focal card size. */
  readonly focalRef?: string | undefined;
  /** PROPOSED recovery branch (not historical cause). */
  readonly recoveryNodeRefs?: readonly string[];
  /** Non-failing dependency context (stay / programme). */
  readonly dependencyContextNodeRefs?: readonly string[];
  /** Ownership / affected-party context (typically TRAVELLER). */
  readonly ownerContextNodeRefs?: readonly string[];
}

export type LayoutOptions = LayoutRoles;

export const SIZES: Record<SizeClass, { readonly w: number; readonly h: number }> = {
  focal: { w: 226, h: 136 },
  secondary: { w: 184, h: 124 },
  normal: { w: 168, h: 116 },
  small: { w: 152, h: 104 },
};

const SPINE_GAP = 46;
const BAND_GAP = 40;
const BAND_ROW_GAP = 18;
const CTX_GAP = 14;
const COLUMN_GAP = 56;
const ROW_GAP = 22;
const PADDING = 36;

function sizeClassFor(
  node: PresentationNode,
  role: 'causal' | 'recovery' | 'owner' | 'dependency' | 'other',
  isFocal: boolean,
): SizeClass {
  if (isFocal) return 'focal';
  if (role === 'recovery') return 'secondary';
  if (role === 'owner' || role === 'dependency' || role === 'other') return 'small';
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

function nearestAnchorColumn(
  startRefs: readonly string[],
  adjacency: Map<string, string[]>,
  columnOf: Map<string, number>,
): Map<string, number> {
  const nodeColumn = new Map<string, number>(columnOf);
  const queue: string[] = [...startRefs];
  const visited = new Set(startRefs);
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
  return nodeColumn;
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

  const recoverySet = new Set(
    (options.recoveryNodeRefs ?? []).filter((ref) => nodeByRef.has(ref) && !causalRefs.includes(ref)),
  );
  const ownerSet = new Set(
    (options.ownerContextNodeRefs ?? []).filter((ref) => nodeByRef.has(ref) && !causalRefs.includes(ref) && !recoverySet.has(ref)),
  );
  const dependencySet = new Set(
    (options.dependencyContextNodeRefs ?? [])
      .filter((ref) => nodeByRef.has(ref) && !causalRefs.includes(ref) && !recoverySet.has(ref) && !ownerSet.has(ref)),
  );

  const causalColumn = new Map<string, number>();
  causalRefs.forEach((ref, i) => causalColumn.set(ref, i));

  // Seed columns from causal so context attaches to the right branch.
  const seedColumn = new Map(causalColumn);
  const placed = new Map<string, LayoutNode>();

  // --- Row 0: causal mainline only (original failed onward stays here) ---
  const recoveryRefs = (options.recoveryNodeRefs ?? [])
    .filter((ref) => recoverySet.has(ref))
    .sort((a, b) => a.localeCompare(b));
  const spineNodes = causalRefs.map((ref) => {
    const node = nodeByRef.get(ref)!;
    return { ref, sizeClass: sizeClassFor(node, 'causal', ref === options.focalRef) };
  });
  const spineTop = PADDING;
  let cursorX = PADDING;
  spineNodes.forEach((s, i) => {
    const { w, h } = SIZES[s.sizeClass];
    placed.set(s.ref, {
      ref: s.ref, column: i, row: 0, x: cursorX, y: spineTop, width: w, height: h, sizeClass: s.sizeClass,
    });
    cursorX += w + SPINE_GAP;
  });
  const spineRight = Math.max(PADDING, cursorX - SPINE_GAP);
  const spineBottom = placed.size > 0
    ? Math.max(...[...placed.values()].map((n) => n.y + n.height))
    : PADDING;

  const focalRef = options.focalRef && placed.has(options.focalRef)
    ? options.focalRef
    : causalRefs[0];
  // Prefer the last causal booking (current onward) as the right-side anchor for recovery.
  const onwardRef = [...causalRefs].reverse().find((ref) => nodeByRef.get(ref)?.entityKind === 'SERVICE_BOOKING');
  const recoveryAnchor = (onwardRef ? placed.get(onwardRef) : undefined)
    ?? [...causalRefs].map((ref) => placed.get(ref)).filter(Boolean).at(-1)
    ?? placed.get(focalRef!)
    ?? [...placed.values()].at(-1)!;

  const nodeColumn = nearestAnchorColumn([...causalRefs, ...recoveryRefs], adjacency, seedColumn);
  for (const node of graph.nodes) if (!nodeColumn.has(node.ref)) nodeColumn.set(node.ref, 0);

  // --- Row 1 only: owner (left) · stay/programme (middle) · proposed (right under onward) ---
  const ownerRefs = (options.ownerContextNodeRefs ?? []).filter((ref) => ownerSet.has(ref));
  const dependencyRefs = (options.dependencyContextNodeRefs ?? [])
    .filter((ref) => dependencySet.has(ref))
    .sort((a, b) => (nodeColumn.get(a)! - nodeColumn.get(b)!) || a.localeCompare(b));
  const leftoverRefs = graph.nodes
    .map((n) => n.ref)
    .filter((ref) => !placed.has(ref) && !ownerSet.has(ref) && !recoverySet.has(ref) && !dependencySet.has(ref) && !causalRefs.includes(ref))
    .sort((a, b) => (nodeColumn.get(a)! - nodeColumn.get(b)!) || a.localeCompare(b));

  const bandTop = spineBottom + BAND_GAP;
  const { w: smallW, h: smallH } = SIZES.small;

  // Left cluster: owners, starting at the left padding.
  let leftX = PADDING;
  for (const ref of ownerRefs) {
    if (placed.has(ref)) continue;
    placed.set(ref, {
      ref, column: 0, row: 1, x: leftX, y: bandTop,
      width: smallW, height: smallH, sizeClass: 'small',
    });
    leftX += smallW + CTX_GAP;
  }

  // Right cluster: proposed recovery under / aligned with the current onward booking.
  let rightEdge = Math.max(spineRight, recoveryAnchor.x + recoveryAnchor.width);
  for (let i = recoveryRefs.length - 1; i >= 0; i--) {
    const ref = recoveryRefs[i]!;
    if (placed.has(ref)) continue;
    const node = nodeByRef.get(ref)!;
    const sizeClass = sizeClassFor(node, 'recovery', false);
    const { w, h } = SIZES[sizeClass];
    const x = Math.max(recoveryAnchor.x, rightEdge - w);
    placed.set(ref, {
      ref, column: causalRefs.length, row: 1, x, y: bandTop,
      width: w, height: h, sizeClass,
    });
    seedColumn.set(ref, causalRefs.length);
    rightEdge = x - CTX_GAP;
  }

  // Middle cluster: stay + programme between owner and recovery, one row.
  const middleLeft = leftX + (ownerRefs.length > 0 ? CTX_GAP : 0);
  const middleRight = rightEdge - (recoveryRefs.length > 0 ? CTX_GAP : 0);
  const middleRefs = [...dependencyRefs, ...leftoverRefs].filter((ref) => !placed.has(ref));
  const middleNeed = middleRefs.length * smallW + Math.max(0, middleRefs.length - 1) * CTX_GAP;
  const middleSpan = Math.max(0, middleRight - middleLeft);
  let midX = middleLeft + Math.max(0, (middleSpan - middleNeed) / 2);
  // If the gap is too tight, pack from middleLeft and allow extending toward recovery.
  if (middleNeed > middleSpan) midX = middleLeft;
  for (const ref of middleRefs) {
    placed.set(ref, {
      ref, column: nodeColumn.get(ref) ?? 1, row: 1, x: midX,
      y: bandTop,
      width: smallW, height: smallH, sizeClass: 'small',
    });
    midX += smallW + CTX_GAP;
  }

  // Ensure every graph node is placed (defensive) — still on the bottom band.
  for (const node of graph.nodes) {
    if (placed.has(node.ref)) continue;
    placed.set(node.ref, {
      ref: node.ref, column: 0, row: 1, x: midX, y: bandTop,
      width: smallW, height: smallH, sizeClass: 'small',
    });
    midX += smallW + CTX_GAP;
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
  const sizeOf = (ref: string): SizeClass => sizeClassFor(nodeByRef.get(ref)!, 'causal', ref === options.focalRef);
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

  const targetGroupOf = (p: Pending): string => `${p.edge.targetRef}|${p.vertical ? (p.down ? 't' : 'b') : 'l'}`;
  const targetOrder = (a: Pending, b: Pending): number =>
    (a.vertical ? a.s.x - b.s.x : a.s.y - b.s.y) || a.edge.renderKey.localeCompare(b.edge.renderKey);
  const targetGroups = new Map<string, Pending[]>();
  for (const p of pending) {
    const k = targetGroupOf(p);
    if (!targetGroups.has(k)) targetGroups.set(k, []);
    targetGroups.get(k)!.push(p);
  }
  for (const list of targetGroups.values()) list.sort(targetOrder);

  const edges: LayoutEdge[] = pending.map((p) => {
    const list = groups.get(groupOf(p))!;
    const index = list.indexOf(p);
    const fraction = list.length > 1 ? (index + 1) / (list.length + 1) : 0.5;

    const targetList = targetGroups.get(targetGroupOf(p))!;
    const targetIndex = targetList.indexOf(p);
    const targetFraction = targetList.length > 1 ? (targetIndex + 1) / (targetList.length + 1) : 0.5;

    const obstacles: Box[] = [];
    for (const [ref, b] of box) {
      if (ref !== p.edge.sourceRef && ref !== p.edge.targetRef) obstacles.push(b);
    }

    const g = routeEdge(p.s, p.t, index, list.length, fraction, targetFraction, obstacles);
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
