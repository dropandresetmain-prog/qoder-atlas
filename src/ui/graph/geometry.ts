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

/** Clearance kept between a bypass lane and the obstacle card it steps around. */
const OBSTACLE_MARGIN = 26;



/**
 * Obstacle boxes whose footprint the straight sx->tx corridor would cross:
 * strictly between the two x positions, and overlapping the y band the
 * (near-straight) horizontal curve travels through.
 */
function obstaclesInCorridor(sx: number, sy: number, tx: number, ty: number, obstacles: readonly Box[]): Box[] {
  const loY = Math.min(sy, ty);
  const hiY = Math.max(sy, ty);
  return obstacles.filter((o) => o.x < tx && o.x + o.w > sx && o.y < hiY && o.y + o.h > loY);
}

/**
 * Whether a flat detour at `viaY` (spanning `viaFromX`..`viaToX`) is itself
 * free of every obstacle, not just the ones that blocked the original
 * corridor. Guards against trading one overlap for another.
 */
function bowIsClear(viaFromX: number, viaToX: number, viaY: number, obstacles: readonly Box[]): boolean {
  const lo = Math.min(viaFromX, viaToX);
  const hi = Math.max(viaFromX, viaToX);
  return obstacles.every((o) => !(o.x < hi && o.x + o.w > lo && o.y < viaY + 1 && o.y + o.h > viaY - 1));
}

/**
 * Sweep a horizontal (side/diagonal) curve above or below any obstacle cards
 * sitting in its straight-line corridor, so the edge no longer disappears
 * behind an intervening node. The detour stays a smooth curve -- one cubic
 * that arcs around the obstacle -- because an orthogonal lane reads as a
 * schematic, not as this graph's language.
 *
 * Control points are placed beyond the clearance line, not on it: a symmetric
 * cubic only reaches 3/4 of the way to its controls at the midpoint
 * (y(0.5) = 0.25*y0 + 0.75*cy), so a control placed exactly on the clearance
 * line would leave the curve cutting the card's corner. Dividing by that
 * factor makes the arc's extreme land on the clearance line itself.
 *
 * Returns null when nothing blocks the corridor, or when neither detour has
 * clearance -- callers then keep their original, unbowed curve rather than
 * risk a new overlap (conservative by design).
 */
/** A symmetric cubic reaches only this fraction of the way to its control row. */
const CUBIC_MID_REACH = 0.75;
function bowedHorizontalPath(
  sx: number, sy: number, tx: number, ty: number, obstacles: readonly Box[],
): string | null {
  const hits = obstaclesInCorridor(sx, sy, tx, ty, obstacles);
  if (hits.length === 0) return null;

  const top = Math.min(...hits.map((o) => o.y));
  const bottom = Math.max(...hits.map((o) => o.y + o.h));
  const naturalMid = (sy + ty) / 2;
  const candidates = [
    { viaY: top - OBSTACLE_MARGIN, deviation: Math.abs(naturalMid - (top - OBSTACLE_MARGIN)) },
    { viaY: bottom + OBSTACLE_MARGIN, deviation: Math.abs(naturalMid - (bottom + OBSTACLE_MARGIN)) },
  ].sort((a, b) => a.deviation - b.deviation);

  const viaFromX = Math.max(sx, Math.min(...hits.map((o) => o.x)));
  const viaToX = Math.min(tx, Math.max(...hits.map((o) => o.x + o.w)));

  for (const c of candidates) {
    if (!bowIsClear(viaFromX, viaToX, c.viaY, obstacles)) continue;
    // Push the control row past the clearance line so the arc's own extreme
    // lands on it, then hold the controls over the obstacle span so the curve
    // is flat-ish where it passes the card and steep where it leaves the nodes.
    const controlY = (yEnd: number): number => yEnd + (c.viaY - yEnd) / CUBIC_MID_REACH;
    return `M${r1(sx)} ${r1(sy)} C${r1(viaFromX)} ${r1(controlY(sy))},${r1(viaToX)} ${r1(controlY(ty))},${r1(tx)} ${r1(ty)}`;
  }
  return null;
}

/** Right edge of source -> left edge of target. Handle length is bounded by the real gap. */
export function sideCurve(
  source: Box,
  target: Box,
  sourceFraction = 0.5,
  targetFraction = 0.5,
  obstacles: readonly Box[] = [],
): EdgeGeometry {
  const sx = source.x + source.w;
  const sy = source.y + source.h * sourceFraction;
  const tx = target.x;
  const ty = target.y + target.h * targetFraction;
  const dx = Math.max(1, tx - sx);
  const handle = Math.max(4, Math.min(72, dx * 0.36));
  const bowed = bowedHorizontalPath(sx, sy, tx, ty, obstacles);
  return {
    route: 'side',
    d: bowed ?? `M${r1(sx)} ${r1(sy)} C${r1(sx + handle)} ${r1(sy)},${r1(tx - handle)} ${r1(ty)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/** Tight monotonic curve for a downstream item to the right and below. */
export function diagonalCurve(
  source: Box,
  target: Box,
  sourceFraction = 0.72,
  targetFraction = 0.5,
  obstacles: readonly Box[] = [],
): EdgeGeometry {
  const sx = source.x + source.w;
  const sy = source.y + source.h * sourceFraction;
  const tx = target.x;
  const ty = target.y + target.h * targetFraction;
  const dx = Math.max(1, tx - sx);
  const handle = Math.max(30, Math.min(110, dx * 0.3));
  const bowed = bowedHorizontalPath(sx, sy, tx, ty, obstacles);
  return {
    route: 'diagonal',
    d: bowed ?? `M${r1(sx)} ${r1(sy)} C${r1(sx + handle)} ${r1(sy)},${r1(tx - handle)} ${r1(ty)},${r1(tx)} ${r1(ty)}`,
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
 *
 * `targetFraction` mirrors `sourceFraction`: it distributes edges that
 * converge on the same target surface so they don't all land on one point.
 * `obstacles` lets horizontal routes bow clear of an intervening card instead
 * of passing straight through it.
 */
export function routeEdge(
  source: Box,
  target: Box,
  branchIndex = 0,
  branchCount = 1,
  sourceFraction = 0.5,
  targetFraction = 0.5,
  obstacles: readonly Box[] = [],
): EdgeGeometry {
  const rightOf = target.x >= source.x + source.w + 8;
  if (rightOf) {
    const sourceMid = source.y + source.h / 2;
    const targetMid = target.y + target.h / 2;
    if (targetMid - sourceMid > source.h * 0.9) {
      return diagonalCurve(source, target, sourceFraction === 0.5 ? 0.72 : sourceFraction, targetFraction, obstacles);
    }
    return sideCurve(source, target, sourceFraction, targetFraction, obstacles);
  }
  return target.y >= source.y + source.h - 4
    ? bottomCurve(source, target, branchIndex, branchCount)
    : topCurve(source, target, branchIndex, branchCount);
}
