/**
 * R2 LANE B — deterministic left-to-right graph layout.
 *
 * Pure function: graph -> positions. No DOM, no force/physics, no randomness.
 * Columns by longest-path rank from source nodes; rows within column by
 * stable ref sort (deterministic tie-break).
 */
import type { PresentationGraph } from '../semantics/model.ts';

export interface LayoutNode {
  readonly ref: string;
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutEdge {
  readonly renderKey: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
}

export interface LayoutResult {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 140;
const COLUMN_GAP = 110;
const ROW_GAP = 32;
const PADDING = 60;

/**
 * Compute deterministic layout positions for the graph.
 *
 * Without causalNodeRefs (or empty): longest-path ranking from source nodes
 * (nodes with no incoming edges). Within each column, nodes sorted by ref.
 *
 * With causalNodeRefs: causal refs take monotonically increasing columns in
 * backend causal order (index 0, 1, 2, …). Context nodes hang off the spine
 * at the column of their nearest causal neighbour reachable via edges, at a
 * secondary row. Causal x-order is never broken or reordered.
 */
export function computeLayout(
  graph: PresentationGraph,
  causalNodeRefs?: readonly string[],
): LayoutResult {
  const nodeRefSet = new Set(graph.nodes.map((n) => n.ref));

  // Filter causal refs to those actually present in the graph, preserving order
  const presentCausalRefs = causalNodeRefs != null
    ? causalNodeRefs.filter((ref) => nodeRefSet.has(ref))
    : [];

  if (presentCausalRefs.length > 0) {
    return computeCausalSpineLayout(graph, presentCausalRefs);
  }

  return computeLongestPathLayout(graph);
}

/**
 * Causal spine layout: causal refs occupy columns 0..N-1 in backend order.
 * Context nodes hang at the column of their nearest causal neighbour (BFS
 * over undirected edges), at a secondary row below the causal node.
 */
function computeCausalSpineLayout(
  graph: PresentationGraph,
  causalRefs: readonly string[],
): LayoutResult {
  // Build undirected adjacency for BFS
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.ref, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.sourceRef)?.push(edge.targetRef);
    adjacency.get(edge.targetRef)?.push(edge.sourceRef);
  }

  // Assign columns: causal[i] -> column i
  const causalColumn = new Map<string, number>();
  for (let i = 0; i < causalRefs.length; i++) {
    causalColumn.set(causalRefs[i]!, i);
  }

  const causalSet = new Set(causalRefs);

  // BFS from all causal nodes simultaneously to find nearest causal for each context node
  const nodeColumn = new Map<string, number>(causalColumn);
  const queue: string[] = [...causalRefs];
  const visited = new Set(causalRefs);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentCol = nodeColumn.get(current)!;
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        nodeColumn.set(neighbor, currentCol);
        queue.push(neighbor);
      }
    }
  }

  // Any remaining nodes not reached (disconnected) get column 0
  for (const node of graph.nodes) {
    if (!nodeColumn.has(node.ref)) {
      nodeColumn.set(node.ref, 0);
    }
  }

  // Group nodes by column: causal first (by causal index), then context (by ref sort)
  const columns = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const col = nodeColumn.get(node.ref)!;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node.ref);
  }

  // Sort within each column: causal nodes first (by their causal index), then context (by ref)
  for (const refs of columns.values()) {
    refs.sort((a, b) => {
      const aIsCausal = causalSet.has(a);
      const bIsCausal = causalSet.has(b);
      if (aIsCausal && bIsCausal) {
        return causalColumn.get(a)! - causalColumn.get(b)!;
      }
      if (aIsCausal) return -1;
      if (bIsCausal) return 1;
      return a.localeCompare(b);
    });
  }

  return assignPositions(graph, columns);
}

/**
 * Original longest-path ranking layout (fallback when no causal refs).
 */
function computeLongestPathLayout(graph: PresentationGraph): LayoutResult {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incoming.set(node.ref, []);
    outgoing.set(node.ref, []);
  }

  for (const edge of graph.edges) {
    incoming.get(edge.targetRef)?.push(edge.sourceRef);
    outgoing.get(edge.sourceRef)?.push(edge.targetRef);
  }

  // Longest-path ranking: rank[node] = max(rank[pred] + 1) for all predecessors
  const rank = new Map<string, number>();
  const visited = new Set<string>();

  function computeRank(ref: string): number {
    if (rank.has(ref)) return rank.get(ref)!;
    if (visited.has(ref)) return 0; // cycle guard
    visited.add(ref);

    const preds = incoming.get(ref) ?? [];
    if (preds.length === 0) {
      rank.set(ref, 0);
      return 0;
    }

    const maxPredRank = Math.max(...preds.map((p) => computeRank(p)));
    const r = maxPredRank + 1;
    rank.set(ref, r);
    return r;
  }

  for (const node of graph.nodes) {
    computeRank(node.ref);
  }

  // Group nodes by column (rank)
  const columns = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const col = rank.get(node.ref) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node.ref);
  }

  // Sort refs within each column for deterministic row assignment
  for (const refs of columns.values()) {
    refs.sort();
  }

  return assignPositions(graph, columns);
}

/**
 * Shared position assignment: given columns (Map<columnIndex, sorted refs>),
 * compute x/y positions and edge paths.
 */
function assignPositions(
  graph: PresentationGraph,
  columns: Map<number, string[]>,
): LayoutResult {
  const layoutNodes: LayoutNode[] = [];
  const nodePositions = new Map<string, { x: number; y: number }>();

  const sortedColumns = Array.from(columns.keys()).sort((a, b) => a - b);
  let maxX = 0;
  let maxY = 0;

  for (const col of sortedColumns) {
    const refs = columns.get(col)!;
    const x = PADDING + col * (NODE_WIDTH + COLUMN_GAP);

    for (let row = 0; row < refs.length; row++) {
      const ref = refs[row]!;
      const y = PADDING + row * (NODE_HEIGHT + ROW_GAP);
      nodePositions.set(ref, { x, y });
      layoutNodes.push({
        ref,
        column: col,
        row,
        x,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    }
  }

  // Compute edge paths (cubic bezier side curves)
  const layoutEdges: LayoutEdge[] = graph.edges.map((edge) => {
    const sourcePos = nodePositions.get(edge.sourceRef)!;
    const targetPos = nodePositions.get(edge.targetRef)!;

    // Source: right side, vertical center
    const sourceX = sourcePos.x + NODE_WIDTH;
    const sourceY = sourcePos.y + NODE_HEIGHT / 2;

    // Target: left side, vertical center
    const targetX = targetPos.x;
    const targetY = targetPos.y + NODE_HEIGHT / 2;

    return {
      renderKey: edge.renderKey,
      sourceRef: edge.sourceRef,
      targetRef: edge.targetRef,
      sourceX,
      sourceY,
      targetX,
      targetY,
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX + PADDING,
    height: maxY + PADDING,
  };
}
