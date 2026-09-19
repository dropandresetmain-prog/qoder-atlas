/**
 * Event Overview graph — pure, deterministic layout (V7.2 geography).
 *
 * shared dependencies (above)  ->  programme spine  <-  cohorts / promoted
 * travellers (below).
 *
 * Coordinates are presentation output only; they never carry business state.
 * Every card has an explicit width and height, so the connector geometry the
 * renderer draws is derived from the actual rendered card bounds — a card
 * cannot change size under semantic zoom and leave a dangling line.
 */
import type { OgKind, OgNode, OverviewGraphModel } from './model.ts';

export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export const CARD: Record<OgKind, { readonly w: number; readonly h: number }> = {
  dependency: { w: 176, h: 82 },
  landmark: { w: 138, h: 66 },
  cohort: { w: 214, h: 60 },
  traveller: { w: 148, h: 88 },
};

export const DAY_W = 330;
const MARGIN = 20;
const GAP = 10;
const LANE_HEAD = 38;
const MIN_WIDTH = 720;

export interface DayZone { readonly index: number; readonly x: number; readonly w: number }

export interface OverviewLayout {
  readonly width: number;
  readonly height: number;
  readonly lane: Box;
  readonly zones: readonly DayZone[];
  readonly rowLines: readonly number[];
  readonly boxes: ReadonlyMap<string, Box>;
  /** Whole projection (default framing when calm). */
  readonly home: Box;
  /** The whole active footprint (framing while a shared change is active). */
  readonly incident: Box | null;
}

function union(boxes: readonly Box[], pad: number): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
  const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Left-to-right packing that keeps each card near its target centre without overlap. */
function packRow(
  items: readonly { readonly node: OgNode; readonly cx: number }[],
  size: { readonly w: number; readonly h: number },
  top: number,
  minX: number,
  maxRight: number,
  rowGap: number,
): { placed: Map<string, Box>; bottom: number } {
  const placed = new Map<string, Box>();
  const sorted = [...items].sort((a, b) => a.cx - b.cx);
  let row = 0;
  let cursor = minX;
  for (const item of sorted) {
    let x = Math.max(cursor, item.cx - size.w / 2);
    if (x + size.w > maxRight && cursor > minX) {
      row += 1;
      cursor = minX;
      x = Math.max(cursor, Math.min(item.cx - size.w / 2, maxRight - size.w));
    }
    placed.set(item.node.id, { x, y: top + row * (size.h + rowGap), w: size.w, h: size.h });
    cursor = x + size.w + GAP;
  }
  const rows = sorted.length === 0 ? 0 : row + 1;
  return { placed, bottom: top + rows * size.h + Math.max(0, rows - 1) * rowGap };
}

export function computeOverviewLayout(model: OverviewGraphModel): OverviewLayout {
  const days = model.days.length > 0 ? model.days : [];
  const zoneCount = Math.max(1, days.length);
  const laneW = zoneCount * DAY_W;

  const byKind = (kind: OgKind): OgNode[] => model.nodes.filter((n) => n.kind === kind);
  const landmarks = byKind('landmark');
  const deps = byKind('dependency');
  const cohorts = byKind('cohort');
  const travellers = byKind('traveller');

  // Content width is decided first so wide dependency rows never push the lane off-centre.
  const depsWidth = deps.length * (CARD.dependency.w + GAP) - GAP + MARGIN * 2;
  const width = Math.max(MIN_WIDTH, laneW + MARGIN * 2, depsWidth);
  const laneX = Math.round((width - laneW) / 2);
  const zones: DayZone[] = Array.from({ length: zoneCount }, (_, i) => ({
    index: days[i]?.index ?? i + 1,
    x: laneX + i * DAY_W,
    w: DAY_W,
  }));
  const zoneOf = (dayIndex: number | undefined): DayZone =>
    zones.find((z) => z.index === dayIndex) ?? zones[0]!;

  // Programme rows: a grid inside each day; rows grow only if a day needs them.
  const lm = CARD.landmark;
  const cols = Math.max(1, Math.floor((DAY_W - 16 + GAP) / (lm.w + GAP)));
  const perDay = new Map<number, OgNode[]>();
  for (const node of landmarks) {
    const list = perDay.get(zoneOf(node.dayIndex).index) ?? [];
    list.push(node);
    perDay.set(zoneOf(node.dayIndex).index, list);
  }
  const rowsNeeded = Math.max(2, ...[...perDay.values()].map((l) => Math.ceil(l.length / cols)));
  const depTop = deps.length > 0 ? 6 : 0;
  const laneY = deps.length > 0 ? depTop + CARD.dependency.h + 34 : 8;
  const laneH = LANE_HEAD + rowsNeeded * (lm.h + GAP) + 4;

  const boxes = new Map<string, Box>();
  const rowLines: number[] = [];
  for (let r = 1; r < rowsNeeded; r += 1) rowLines.push(laneY + LANE_HEAD + r * (lm.h + GAP) - GAP / 2);
  for (const [dayIndex, list] of perDay) {
    const zone = zoneOf(dayIndex);
    const used = Math.min(cols, list.length);
    const gridW = used * lm.w + (used - 1) * GAP;
    const startX = zone.x + Math.round((DAY_W - gridW) / 2);
    list.forEach((node, i) => {
      boxes.set(node.id, {
        x: startX + (i % cols) * (lm.w + GAP),
        y: laneY + LANE_HEAD + Math.floor(i / cols) * (lm.h + GAP),
        w: lm.w,
        h: lm.h,
      });
    });
  }
  const lane: Box = { x: laneX, y: laneY, w: laneW, h: laneH };
  const laneBottom = laneY + laneH;
  const cx = (id: string | undefined): number | undefined => {
    const b = id ? boxes.get(id) : undefined;
    return b ? b.x + b.w / 2 : undefined;
  };

  // Shared dependencies sit above the landmark they feed; unlinked ones use their day.
  const feeds = new Map<string, string>();
  for (const rel of model.relations) {
    if (rel.id.startsWith('dep:')) feeds.set(rel.from, rel.to);
  }
  const depItems = deps.map((node) => ({
    node,
    cx: cx(feeds.get(node.id)) ?? (zoneOf(node.dayIndex).x + DAY_W / 2),
  }));
  const depPack = packRow(depItems, CARD.dependency, depTop, MARGIN, width - MARGIN, GAP);
  depPack.placed.forEach((box, id) => boxes.set(id, box));

  // Promoted travellers sit under the landmark (or dependency) they connect to.
  const travellerTarget = new Map<string, string>();
  for (const rel of model.relations) {
    if (rel.id.startsWith('trav-lm:')) travellerTarget.set(rel.from, rel.to);
    else if (rel.id.startsWith('trav-dep:') && !travellerTarget.has(rel.to)) travellerTarget.set(rel.to, rel.from);
  }
  let below = laneBottom + 36;
  if (travellers.length > 0) {
    const items = travellers.map((node) => ({
      node,
      cx: cx(travellerTarget.get(node.id)) ?? laneX + laneW / 2,
    }));
    const pack = packRow(items, CARD.traveller, below, MARGIN, width - MARGIN, GAP);
    pack.placed.forEach((box, id) => boxes.set(id, box));
    below = pack.bottom + 26;
  }
  for (const node of cohorts) {
    const zone = zoneOf(node.dayIndex);
    boxes.set(node.id, {
      x: Math.round(zone.x + (DAY_W - CARD.cohort.w) / 2),
      y: below,
      w: CARD.cohort.w,
      h: CARD.cohort.h,
    });
  }
  const bottom = Math.max(
    laneBottom,
    ...[...boxes.values()].map((b) => b.y + b.h),
  );
  const height = bottom + 12;

  const home = union([...boxes.values(), lane], 12);
  const incidentBoxes = (model.focus?.incidentIds ?? [])
    .map((id) => boxes.get(id))
    .filter((b): b is Box => b !== undefined);
  return {
    width,
    height,
    lane,
    zones,
    rowLines,
    boxes,
    home,
    incident: incidentBoxes.length > 0 ? union(incidentBoxes, 22) : null,
  };
}

/**
 * Minimum-curvature cubic between two card boxes, anchored on the actual card
 * bounds. Vertical routing is used when the cards are mostly stacked.
 */
export function connectorPath(source: Box, target: Box): string {
  const scx = source.x + source.w / 2;
  const scy = source.y + source.h / 2;
  const tcx = target.x + target.w / 2;
  const tcy = target.y + target.h / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  if (Math.abs(dy) >= Math.abs(dx) * 0.42) {
    const down = dy >= 0;
    const sy = down ? source.y + source.h : source.y;
    const ty = down ? target.y : target.y + target.h;
    const handle = Math.max(10, Math.min(48, Math.abs(ty - sy) * 0.42));
    const dir = down ? 1 : -1;
    return `M${n(scx)} ${n(sy)} C${n(scx)} ${n(sy + dir * handle)},${n(tcx)} ${n(ty - dir * handle)},${n(tcx)} ${n(ty)}`;
  }
  const right = dx >= 0;
  const sx = right ? source.x + source.w : source.x;
  const tx = right ? target.x : target.x + target.w;
  const handle = Math.max(8, Math.min(52, Math.abs(tx - sx) * 0.36));
  const dir = right ? 1 : -1;
  return `M${n(sx)} ${n(scy)} C${n(sx + dir * handle)} ${n(scy)},${n(tx - dir * handle)} ${n(tcy)},${n(tx)} ${n(tcy)}`;
}
