/**
 * Deterministic hierarchical graph layout (V5.6 composition + CP5.1 roles).
 *
 * Pure function: graph + presentation roles -> positions + edge geometry.
 * No DOM, no force/physics, no randomness. Card size is derived from the node's
 * ROLE in the graph (focal breakpoint / secondary alert on the spine / recovery
 * branch / normal spine / small context), never from what the node is about.
 *
 * With a causal spine:
 * - causal refs take monotonically increasing columns on the dominant row
 * - owner context sits ABOVE the focal breakpoint (never on the spine)
 * - proposed recovery branches RIGHT of the breakpoint on a recovery band
 * - dependency context stacks BELOW its nearest causal/recovery anchor
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
const BAND_GAP = 52;
const BAND_ROW_GAP = 18;
const CTX_GAP = 14;
const OWNER_GAP = 28;
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

  // Seed columns from causal + (later) recovery so context attaches to the right branch.
  const seedColumn = new Map(causalColumn);
  const placed = new Map<string, LayoutNode>();

  // --- Causal spine (dominant row) ---
  const spineNodes = causalRefs.map((ref) => {
    const node = nodeByRef.get(ref)!;
    return { ref, sizeClass: sizeClassFor(node, 'causal', ref === options.focalRef) };
  });
  const maxSpineH = Math.max(...spineNodes.map((s) => SIZES[s.sizeClass].h));
  // Leave room above for owner context.
  const ownerBandH = ownerSet.size > 0 ? SIZES.small.h + OWNER_GAP : 0;
  const centerY = PADDING + ownerBandH + maxSpineH / 2;
  let cursorX = PADDING;
  spineNodes.forEach((s, i) => {
    const { w, h } = SIZES[s.sizeClass];
    placed.set(s.ref, {
      ref: s.ref, column: i, row: 0, x: cursorX, y: centerY - h / 2, width: w, height: h, sizeClass: s.sizeClass,
    });
    cursorX += w + SPINE_GAP;
  });
  const spineRight = cursorX - SPINE_GAP;
  const spineBottom = Math.max(...[...placed.values()].map((n) => n.y + n.height));

  // --- Owner context ABOVE focal (or first causal) ---
  const focalRef = options.focalRef && placed.has(options.focalRef)
    ? options.focalRef
    : causalRefs[0];
  const ownerAnchor = placed.get(focalRef!)!;
  const ownerRefs = [...ownerSet].sort((a, b) => a.localeCompare(b));
  ownerRefs.forEach((ref, i) => {
    const { w, h } = SIZES.small;
    const x = ownerAnchor.x + (ownerAnchor.width - w) / 2;
    const y = PADDING + i * (h + BAND_ROW_GAP);
    placed.set(ref, { ref, column: ownerAnchor.column, row: -1 - i, x, y, width: w, height: h, sizeClass: 'small' });
  });

  // --- Recovery branch: right of breakpoint / spine, slightly below spine ---
  const recoveryRefs = (options.recoveryNodeRefs ?? [])
    .filter((ref) => recoverySet.has(ref))
    .sort((a, b) => a.localeCompare(b));
  // Prefer attaching under/after the focal; fall back to last causal.
  const recoveryAnchor = placed.get(focalRef!) ?? [...placed.values()].at(-1)!;
  let recoveryX = Math.max(recoveryAnchor.x + recoveryAnchor.width + SPINE_GAP, spineRight + SPINE_GAP);
  const recoveryY = spineBottom + BAND_GAP;
  recoveryRefs.forEach((ref, i) => {
    const node = nodeByRef.get(ref)!;
    const sizeClass = sizeClassFor(node, 'recovery', false);
    const { w, h } = SIZES[sizeClass];
    const col = recoveryAnchor.column + 1 + i;
    placed.set(ref, {
      ref, column: col, row: 1, x: recoveryX, y: recoveryY, width: w, height: h, sizeClass,
    });
    seedColumn.set(ref, col);
    recoveryX += w + SPINE_GAP;
  });

  // Nearest column among causal + recovery for remaining context.
  const placedSeedRefs = [...causalRefs, ...recoveryRefs];
  const nodeColumn = nearestAnchorColumn(placedSeedRefs, adjacency, seedColumn);
  for (const node of graph.nodes) if (!nodeColumn.has(node.ref)) nodeColumn.set(node.ref, 0);

  // --- Dependency context: stack below nearest causal/recovery anchor ---
  const depRefs = [
    ...(options.dependencyContextNodeRefs ?? []).filter((ref) => dependencySet.has(ref)),
    // Any leftover non-role nodes hang as small context too.
    ...graph.nodes
      .map((n) => n.ref)
      .filter((ref) => !placed.has(ref) && !ownerSet.has(ref) && !recoverySet.has(ref) && !dependencySet.has(ref) && !causalRefs.includes(ref)),
  ].sort((a, b) => (nodeColumn.get(a)! - nodeColumn.get(b)!) || a.localeCompare(b));

  const recoveryBottom = recoveryRefs.length > 0
    ? Math.max(...recoveryRefs.map((ref) => {
      const n = placed.get(ref)!;
      return n.y + n.height;
    }))
    : spineBottom;
  const depTop = recoveryBottom + BAND_GAP;
  const rowCursors: number[] = [];
  const { w: cw, h: ch } = SIZES.small;
  const limitRight = Math.max(spineRight, recoveryX) + 80;

  for (const ref of depRefs) {
    if (placed.has(ref)) continue;
    const col = nodeColumn.get(ref) ?? 0;
    // Prefer a placed causal/recovery node at that column; else focal.
    const anchor = placed.get(causalRefs[col]!)
      ?? placed.get(recoveryRefs[Math.max(0, col - causalRefs.length)]!)
      ?? recoveryAnchor;
    const desiredX = anchor.x;
    let r = 0;
    for (;;) {
      const cur = rowCursors[r] ?? PADDING;
      const x = Math.max(cur, desiredX);
      if (x + cw <= limitRight || r >= 5) {
        rowCursors[r] = x + cw + CTX_GAP;
        placed.set(ref, {
          ref, column: col, row: 2 + r, x,
          y: depTop + r * (ch + BAND_ROW_GAP),
          width: cw, height: ch, sizeClass: 'small',
        });
        break;
      }
      r++;
    }
  }

  // Ensure every graph node is placed (defensive).
  for (const node of graph.nodes) {
    if (placed.has(node.ref)) continue;
    const { w, h } = SIZES.small;
    placed.set(node.ref, {
      ref: node.ref, column: 0, row: 9, x: PADDING, y: depTop + 6 * (h + BAND_ROW_GAP),
      width: w, height: h, sizeClass: 'small',
    });
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
