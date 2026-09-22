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
 * Whether the band the connector sweeps through (`exitX`..`entryX`, out to
 * `viaY`) is free of every obstacle, not just the ones that blocked the
 * original corridor. Guards against trading one overlap for another.
 */
function bypassIsClear(exitX: number, entryX: number, viaY: number, obstacles: readonly Box[]): boolean {
  const lo = Math.min(exitX, entryX);
  const hi = Math.max(exitX, entryX);
  return obstacles.every((o) => !(o.x < hi && o.x + o.w > lo && o.y < viaY + 1 && o.y + o.h > viaY - 1));
}

/** A symmetric cubic reaches only this fraction of the way to its control row. */
const CUBIC_MID_REACH = 0.75;

/** Where a bypass leaves and re-enters its two cards, as a fraction of card width. */
const BYPASS_EXIT_FRACTION = 0.68;
const BYPASS_ENTRY_FRACTION = 0.32;

export interface BypassGeometry {
  readonly d: string;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
}

/**
 * Route an edge that would otherwise pass behind an intervening card.
 *
 * Rather than leaving the source's side face and squeezing an arc through the
 * same horizontal band as the obstacle, the edge leaves and re-enters on the
 * SAME face of both cards -- both bottoms, or both tops -- and flows between
 * them in the clear space outside the row. That is what makes it read as a
 * deliberate route instead of a line sagging past something in its way.
 *
 * The connector is one cubic whose controls are pushed beyond the clearance
 * line: a symmetric cubic only reaches 3/4 of the way to its controls at the
 * midpoint (y(0.5) = 0.25*y0 + 0.75*cy), so controls placed on the line would
 * leave the curve cutting back into the card row. Dividing by that factor puts
 * the curve's own extreme on the clearance line.
 *
 * Returns null when nothing blocks the corridor, or when neither face has
 * clearance -- callers then keep their original, unbowed curve rather than
 * risk a new overlap (conservative by design).
 */
function bypassPath(
  source: Box, target: Box, sx: number, sy: number, tx: number, ty: number, obstacles: readonly Box[],
): BypassGeometry | null {
  const hits = obstaclesInCorridor(sx, sy, tx, ty, obstacles);
  if (hits.length === 0) return null;

  const obstacleTop = Math.min(...hits.map((o) => o.y));
  const obstacleBottom = Math.max(...hits.map((o) => o.y + o.h));
  // Leave/enter from the face nearest the clear side, and clear the deepest
  // card involved so the connector never re-crosses a card edge.
  const belowY = Math.max(obstacleBottom, source.y + source.h, target.y + target.h) + OBSTACLE_MARGIN;
  const aboveY = Math.min(obstacleTop, source.y, target.y) - OBSTACLE_MARGIN;
  const rowMid = (source.y + source.h / 2 + target.y + target.h / 2) / 2;

  const exitX = source.x + source.w * BYPASS_EXIT_FRACTION;
  const entryX = target.x + target.w * BYPASS_ENTRY_FRACTION;
  const candidates = [
    { viaY: belowY, sourceY: source.y + source.h, targetY: target.y + target.h, deviation: Math.abs(belowY - rowMid) },
    { viaY: aboveY, sourceY: source.y, targetY: target.y, deviation: Math.abs(aboveY - rowMid) },
  ].sort((a, b) => a.deviation - b.deviation);

  for (const c of candidates) {
    if (!bypassIsClear(exitX, entryX, c.viaY, obstacles)) continue;
    const controlY = (yEnd: number): number => yEnd + (c.viaY - yEnd) / CUBIC_MID_REACH;
    return {
      d: `M${r1(exitX)} ${r1(c.sourceY)} C${r1(exitX)} ${r1(controlY(c.sourceY))},${r1(entryX)} ${r1(controlY(c.targetY))},${r1(entryX)} ${r1(c.targetY)}`,
      sourceX: exitX, sourceY: c.sourceY, targetX: entryX, targetY: c.targetY,
    };
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
  const bypass = bypassPath(source, target, sx, sy, tx, ty, obstacles);
  if (bypass) return { route: 'side', ...bypass };
  return {
    route: 'side',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx + handle)} ${r1(sy)},${r1(tx - handle)} ${r1(ty)},${r1(tx)} ${r1(ty)}`,
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
  const bypass = bypassPath(source, target, sx, sy, tx, ty, obstacles);
  if (bypass) return { route: 'diagonal', ...bypass };
  return {
    route: 'diagonal',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx + handle)} ${r1(sy)},${r1(tx - handle)} ${r1(ty)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/** Independent branches distributed across the parent's bottom surface, into the child's top. */
export function bottomCurve(
  source: Box,
  target: Box,
  branchIndex: number,
  branchCount: number,
  obstacles: readonly Box[] = [],
): EdgeGeometry {
  const fraction = (branchIndex + 1) / (branchCount + 1);
  const sx = source.x + source.w * fraction;
  const sy = source.y + source.h;
  const tx = target.x + target.w / 2;
  const ty = target.y;
  const dy = Math.max(1, ty - sy);
  const handle = Math.max(16, Math.min(72, dy * 0.46));
  const bypass = bypassPath(source, target, sx, sy, tx, ty, obstacles);
  if (bypass) return { route: 'bottom', ...bypass };
  return {
    route: 'bottom',
    d: `M${r1(sx)} ${r1(sy)} C${r1(sx)} ${r1(sy + handle)},${r1(tx)} ${r1(ty - handle)},${r1(tx)} ${r1(ty)}`,
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  };
}

/** Source's top surface up into the bottom of a target that sits above it. */
export function topCurve(
  source: Box,
  target: Box,
  branchIndex: number,
  branchCount: number,
  obstacles: readonly Box[] = [],
): EdgeGeometry {
  const fraction = (branchIndex + 1) / (branchCount + 1);
  const sx = source.x + source.w * fraction;
  const sy = source.y;
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h;
  const dy = Math.max(1, sy - ty);
  const handle = Math.max(16, Math.min(72, dy * 0.46));
  const bypass = bypassPath(source, target, sx, sy, tx, ty, obstacles);
  if (bypass) return { route: 'top', ...bypass };
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
    ? bottomCurve(source, target, branchIndex, branchCount, obstacles)
    : topCurve(source, target, branchIndex, branchCount, obstacles);
}
