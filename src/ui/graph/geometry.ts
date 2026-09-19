/**
 * Pure edge geometry for the focused case graph (V5.6 contract): side, bottom,
 * top and diagonal curves measured from node boxes. No DOM, no state.
 */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type EdgeRoute = 'side' | 'diagonal' | 'bottom' | 'top';

export interface EdgeGeometry {
  readonly route: EdgeRoute;
  readonly d: string;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Right edge of source -> left edge of target. Handle length is bounded by the real gap. */
export function sideCurve(source: Box, target: Box, sourceFraction = 0.5, targetFraction = 0.5): EdgeGeometry {
  const sx = source.x + source.w;
  const sy = source.y + source.h * sourceFraction;
  const tx = target.x;
  const ty = target.y + target.h * targetFraction;
  const dx = Math.max(1, tx - sx);
  const handle = Math.max(4, Math.min(72, dx * 0.36));
  return {
    route: 'side',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx + handle)} ${r1(sy)},${r1(tx - handle)} ${r1(ty)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/** Tight monotonic curve for a downstream item to the right and below. */
export function diagonalCurve(source: Box, target: Box, sourceFraction = 0.72): EdgeGeometry {
  const sx = source.x + source.w;
  const sy = source.y + source.h * sourceFraction;
  const tx = target.x;
  const ty = target.y + target.h / 2;
  const dx = Math.max(1, tx - sx);
  const handle = Math.max(30, Math.min(110, dx * 0.3));
  return {
    route: 'diagonal',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx + handle)} ${r1(sy)},${r1(tx - handle)} ${r1(ty)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/** Independent branches distributed across the parent's bottom surface, into the child's top. */
export function bottomCurve(source: Box, target: Box, branchIndex: number, branchCount: number): EdgeGeometry {
  const fraction = (branchIndex + 1) / (branchCount + 1);
  const sx = source.x + source.w * fraction;
  const sy = source.y + source.h;
  const tx = target.x + target.w / 2;
  const ty = target.y;
  const dy = Math.max(1, ty - sy);
  const handle = Math.max(16, Math.min(72, dy * 0.46));
  return {
    route: 'bottom',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx)} ${r1(sy + handle)},${r1(tx)} ${r1(ty - handle)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/** Source's top surface up into the bottom of a target that sits above it. */
export function topCurve(source: Box, target: Box, branchIndex: number, branchCount: number): EdgeGeometry {
  const fraction = (branchIndex + 1) / (branchCount + 1);
  const sx = source.x + source.w * fraction;
  const sy = source.y;
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h;
  const dy = Math.max(1, sy - ty);
  const handle = Math.max(16, Math.min(72, dy * 0.46));
  return {
    route: 'top',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx)} ${r1(sy - handle)},${r1(tx)} ${r1(ty + handle)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/**
 * Choose a route from the two boxes' relative position (geometry only):
 *  - target strictly right of source: side curve (diagonal when it also sits well below);
 *  - otherwise vertical: bottom curve when the target is below, top curve when above.
 */
export function routeEdge(source: Box, target: Box, branchIndex = 0, branchCount = 1, sourceFraction = 0.5): EdgeGeometry {
  const rightOf = target.x >= source.x + source.w + 8;
  if (rightOf) {
    const sourceMid = source.y + source.h / 2;
    const targetMid = target.y + target.h / 2;
    if (targetMid - sourceMid > source.h * 0.9) return diagonalCurve(source, target, sourceFraction === 0.5 ? 0.72 : sourceFraction);
    return sideCurve(source, target, sourceFraction, 0.5);
  }
  return target.y >= source.y + source.h - 4
    ? bottomCurve(source, target, branchIndex, branchCount)
    : topCurve(source, target, branchIndex, branchCount);
}
