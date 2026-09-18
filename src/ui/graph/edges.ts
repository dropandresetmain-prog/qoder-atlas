/**
 * R2 LANE B — SVG edge rendering.
 *
 * Pure geometry: layout positions -> SVG path strings.
 * Cubic bezier side curves (like v5.6 prototype sideCurve).
 */
import type { LayoutEdge } from './layout.ts';

/**
 * Compute cubic bezier path for an edge.
 * Side curve: source right edge -> target left edge.
 * Control points proportional to horizontal gap.
 */
export function computeEdgePath(edge: LayoutEdge): string {
  const { sourceX, sourceY, targetX, targetY } = edge;
  const dx = targetX - sourceX;

  // Handle length proportional to gap, capped to prevent overshoot
  const handle = Math.max(4, Math.min(72, dx * 0.36));

  // Cubic bezier: M start C cp1 cp2 end
  return `M${sourceX} ${sourceY} C${sourceX + handle} ${sourceY},${targetX - handle} ${targetY},${targetX} ${targetY}`;
}

/**
 * Render all edges as SVG paths.
 * Returns SVG element with paths for each edge.
 */
export function renderEdges(edges: readonly LayoutEdge[]): string {
  if (edges.length === 0) return '';

  const paths = edges.map((edge) => {
    const d = computeEdgePath(edge);
    return `<path
      class="fg-edge"
      d="${d}"
      data-edge-key="${edge.renderKey}"
      data-source="${edge.sourceRef}"
      data-target="${edge.targetRef}"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />`;
  }).join('\n');

  return `<svg class="fg-edges" xmlns="http://www.w3.org/2000/svg">
${paths}
</svg>`;
}
