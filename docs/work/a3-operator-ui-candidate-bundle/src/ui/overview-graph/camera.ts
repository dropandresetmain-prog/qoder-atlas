/** Pure camera geometry, shared by the browser controller and focused tests. */
export interface CameraBox { x: number; y: number; w: number; h: number }
export interface CameraFrame { x: number; y: number; scale: number }

/** Fit only the supplied bounds; this function knows nothing about graph truth. */
export function fitOverviewCamera(
  box: CameraBox, width: number, height: number,
  top: number, bottom: number, padding: number, maximumScale: number,
): CameraFrame | null {
  if (![box.x, box.y, box.w, box.h, width, height, top, bottom, padding, maximumScale].every(Number.isFinite)) return null;
  if (box.w <= 0 || box.h <= 0 || maximumScale <= 0 || padding < 0 || top < 0 || bottom < 0) return null;
  const usableWidth = width - padding * 2;
  const usableHeight = height - top - bottom - padding * 2;
  if (usableWidth <= 0 || usableHeight <= 0) return null;
  const scale = Math.min(usableWidth / box.w, usableHeight / box.h, maximumScale);
  return {
    x: padding + (usableWidth - box.w * scale) / 2 - box.x * scale,
    y: top + padding + (usableHeight - box.h * scale) / 2 - box.y * scale,
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
