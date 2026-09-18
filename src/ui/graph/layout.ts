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
 * Algorithm: longest-path ranking from source nodes (nodes with no incoming edges).
 * Within each column, nodes are sorted by ref for stable row assignment.
 */
export function computeLayout(graph: PresentationGraph): LayoutResult {
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

  // Assign positions
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
