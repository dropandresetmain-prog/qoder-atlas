/**
 * Event Overview graph (V7.2) — server-rendered entry point.
 *
 * bounded `eventOverview` projection -> presentation model -> pure layout ->
 * HTML/SVG. The small client controller (pan/zoom/Home/expand/selection/views)
 * is display-only and restores its state across background patching.
 */
import type { OperatorOverview } from '../../contracts/v2/product/readModels.ts';
import { escapeHtml } from '../html.ts';
import { renderEdges, renderNodeCard } from './cards.ts';
import { OVERVIEW_GRAPH_SCRIPT } from './controller.ts';
import { computeOverviewLayout, type Box } from './layout.ts';
import { buildOverviewGraphModel } from './model.ts';
import { OVERVIEW_GRAPH_CSS } from './styles.ts';

export { buildOverviewGraphModel } from './model.ts';
export { computeOverviewLayout } from './layout.ts';

const boxAttr = (b: Box): string => `${Math.round(b.x)} ${Math.round(b.y)} ${Math.round(b.w)} ${Math.round(b.h)}`;

/** Stylesheet + controller, emitted once per page OUTSIDE any patched region. */
export function renderOverviewGraphAssets(): string {
  return `<style data-og-assets>${OVERVIEW_GRAPH_CSS}</style><script data-og-assets>${OVERVIEW_GRAPH_SCRIPT}</script>`;
}

/**
 * The graph region. Returns an empty string when the projection has nothing to
 * draw, so a world without programme data shows no empty canvas.
 */
export function renderEventOverviewGraph(view: OperatorOverview): string {
  const model = buildOverviewGraphModel(view);
  if (!model) return '';
  const layout = computeOverviewLayout(model);

  const zonesHtml = layout.zones.map((zone, i) => {
    const day = model.days[i];
    const head = day
      ? `<div class="og-zone-head"><div class="og-zone-title">${escapeHtml(day.title)}</div><div class="og-zone-sub">${escapeHtml(day.sub)}</div></div>`
      : '';
    return `<div class="og-zone" style="left:${zone.x - layout.lane.x}px;width:${zone.w}px">${head}</div>`;
  }).join('');
  const rowLines = layout.rowLines
    .map((y) => `<div class="og-rowline" style="top:${y - layout.lane.y}px"></div>`)
    .join('');
  const lane = `<div class="og-lane" style="left:${layout.lane.x}px;top:${layout.lane.y}px;width:${layout.lane.w}px;height:${layout.lane.h}px">${zonesHtml}${rowLines}</div>`;

  const cards = model.nodes
    .map((node) => {
      const box = layout.boxes.get(node.id);
      return box ? renderNodeCard(node, box) : '';
    })
    .join('');
  const edges = renderEdges(model.relations, layout.boxes, layout);

  const focus = model.focus;
  const focusPill = focus
    ? `<div class="og-focus-pill" data-test="event-overview-focus"><span>${escapeHtml(focus.message)}</span>${focus.unresolvedTravellerId
      ? `<button type="button" data-og-focus="${escapeHtml(focus.unresolvedTravellerId)}">Focus ${escapeHtml(focus.unresolvedTravellerLabel ?? 'traveller')}</button>`
      : ''}</div>`
    : '';
  const viewSwitch = model.active
    ? `<div class="og-seg" role="group" aria-label="Framing"><button type="button" data-og-view="event">Whole event</button><button type="button" data-og-view="change" class="is-active">Active change</button></div>`
    : '';
  const pill = model.active
    ? '<span class="og-live is-active" data-test="event-overview-status"><i></i>Change being handled</span>'
    : '<span class="og-live" data-test="event-overview-status"><i></i>Event monitored</span>';

  const attrs = [
    'data-og-canvas',
    'data-og-key="overview"',
    `data-og-active="${model.active ? 'true' : 'false'}"`,
    `data-og-home="${boxAttr(layout.home)}"`,
    layout.incident ? `data-og-incident="${boxAttr(layout.incident)}"` : '',
  ].filter(Boolean).join(' ');

  return `
<section class="og" data-poll-region="overview-graph" data-test="event-overview-graph" aria-label="Event overview">
  <div class="og-frame" ${attrs}>
    <header class="og-head">
      <div>
        <h2>Event health</h2>
        <p class="og-sub">Shared travel services, the programme, and who needs attention.</p>
      </div>
      <div class="og-controls">${viewSwitch}${pill}</div>
    </header>
    <div class="og-viewport">
      <div class="og-toolbar" role="toolbar" aria-label="Graph controls">
        <button type="button" data-og-action="zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
        <button type="button" data-og-action="home" title="Reset view" aria-label="Reset view">&#8962;</button>
        <button type="button" data-og-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" data-og-action="expand" title="Expand graph" aria-label="Expand graph" aria-pressed="false">&#9974;</button>
      </div>
      ${focusPill}
      <div class="og-legend" aria-label="Legend"><span><i style="background:#1f9d78"></i>Healthy</span><span><i style="background:#d58a13"></i>Checking</span><span><i style="background:#df3b49"></i>Needs attention</span><span><i style="background:#bcc6d2"></i>Unconfirmed</span></div>
      <div class="og-world" style="width:${layout.width}px;height:${layout.height}px">${lane}${edges}${cards}</div>
    </div>
    ${model.overflowNote ? `<p class="og-note">${escapeHtml(model.overflowNote)}</p>` : ''}
  </div>
</section>`;
}
