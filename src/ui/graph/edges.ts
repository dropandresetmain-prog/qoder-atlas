/**
 * SVG edge path helpers. Geometry lives in geometry.ts (single implementation);
 * layout.ts measures every edge from the card boxes and stores the path in
 * `LayoutEdge.d`. This module keeps the small public helper.
 */
import type { LayoutEdge } from './layout.ts';

/** Path data for a laid-out edge (measured by the layout from the card boxes). */
export function computeEdgePath(edge: LayoutEdge): string {
  return edge.d;
}
