/** Pure camera geometry, shared by the browser controller and focused tests. */
export interface CameraBox { x: number; y: number; w: number; h: number }
export interface CameraFrame { x: number; y: number; scale: number }

/** Fit only the supplied bounds; this function knows nothing about graph truth. */
export function fitOverviewCamera(
  box: CameraBox, width: number, height: number,
  top: number, bottom: number, padding: number, maximumScale: number,
  /** Prefer the top of the usable lane so tall viewports keep active cards reachable. */
  verticalAlign: 'center' | 'start' = 'center',
  /**
   * World-space breathing room added around `box` on every side before
   * fitting. A tight focus/change box otherwise frames neighbour nodes
   * exactly at its edge, so they render half inside and half outside the
   * viewport (a guillotined card). ~half a card footprint is enough to pull
   * an edge node fully into frame without washing the framing out to "whole
   * event" width. Callers that already clip nothing (e.g. the whole-event
   * box) pass 0, the default, for no behaviour change.
   */
  margin = 0,
): CameraFrame | null {
  if (![box.x, box.y, box.w, box.h, width, height, top, bottom, padding, maximumScale, margin].every(Number.isFinite)) return null;
  if (box.w <= 0 || box.h <= 0 || maximumScale <= 0 || padding < 0 || top < 0 || bottom < 0 || margin < 0) return null;
  const padded: CameraBox = { x: box.x - margin, y: box.y - margin, w: box.w + margin * 2, h: box.h + margin * 2 };
  const usableWidth = width - padding * 2;
  const usableHeight = height - top - bottom - padding * 2;
  if (usableWidth <= 0 || usableHeight <= 0) return null;
  const scale = Math.min(usableWidth / padded.w, usableHeight / padded.h, maximumScale);
  const yOffset = verticalAlign === 'start'
    ? 0
    : (usableHeight - padded.h * scale) / 2;
  return {
    x: padding + (usableWidth - padded.w * scale) / 2 - padded.x * scale,
    y: top + padding + yOffset - padded.y * scale,
    scale,
  };
}

/** Direct visible dependency context only, using the supplied relation ends. */
export function overviewFocusBox(
  id: string,
  nodes: readonly (CameraBox & { id: string })[],
  edges: readonly { from: string; to: string }[],
): CameraBox | null {
  const ids = new Set([id]);
  for (const edge of edges) if (edge.from === id || edge.to === id) { ids.add(edge.from); ids.add(edge.to); }
  const boxes = nodes.filter((node) => ids.has(node.id)
    && [node.x, node.y, node.w, node.h].every(Number.isFinite) && node.w > 0 && node.h > 0);
  if (!boxes.some((box) => box.id === id)) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return { x: left - 16, y: top - 16,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - left + 32,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - top + 32 };
}
