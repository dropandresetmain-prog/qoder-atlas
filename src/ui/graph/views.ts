/**
 * R2 LANE B — named view framing (pure).
 *
 * Computes viewport bounds for Trip Overview and Disruption Path views.
 */
import type { LayoutNode } from './layout.ts';

export interface ViewBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Compute bounds for Trip Overview: fit all nodes.
 */
export function computeOverviewBounds(nodes: readonly LayoutNode[]): ViewBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Compute bounds for Disruption Path: fit causal nodes only.
 * Returns null if no causal nodes exist (view should be disabled).
 */
export function computeDisruptionPathBounds(
  nodes: readonly LayoutNode[],
  causalRefs: readonly string[],
): ViewBounds | null {
  const causalSet = new Set(causalRefs);
  const causalNodes = nodes.filter((n) => causalSet.has(n.ref));

  if (causalNodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of causalNodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return { minX, minY, maxX, maxY };
}
