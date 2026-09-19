/**
 * Event Overview graph — styles (V7.2 grammar, production type sizes).
 *
 * Green functioning, amber changed/being checked, red cannot be satisfied,
 * grey context. Motion is liveness only and is switched off for readers who
 * ask for reduced motion.
 */
export const OVERVIEW_GRAPH_CSS = `
.og { margin: 22px 0 8px; }
/* The graph's own z-indexes (toolbar 90, focus pill 85, legend 80, nodes up to 28)
   must never compete with the page shell: isolate them in ONE stacking context
   so the sticky header, nav, Reset demo and the controls below the graph stay
   clickable when the graph scrolls underneath them. */
.og, .og-frame, .og-viewport { isolation: isolate; }
.og-frame { border: 1px solid var(--border); background: var(--surface); border-radius: 18px; box-shadow: var(--shadow); overflow: hidden; }
.og-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--line-soft); }
.og-head h2 { margin: 0; font-size: 16px; letter-spacing: -0.01em; }
.og-head .og-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-soft); }
.og-live { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 650; color: #1f7a5a; background: #f0faf6; border: 1px solid #bde3d6; }
.og-live i { width: 8px; height: 8px; border-radius: 50%; background: #1f9d78; box-shadow: 0 0 0 4px rgba(31,157,120,.12); }
.og-live.is-active { color: #b3323e; background: #fff6f7; border-color: #f2c1c6; }
.og-live.is-active i { background: #df3b49; box-shadow: 0 0 0 4px rgba(223,59,73,.1); }
.og-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.og-seg { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 10px; }
.og-seg button { border: 0; background: transparent; padding: 6px 11px; border-radius: 7px; color: var(--text-soft); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.og-seg button.is-active { background: #fff; color: var(--text); box-shadow: 0 1px 4px rgba(20,38,68,.1); }

.og-viewport { position: relative; height: clamp(320px, 40vh, 430px); background: #fbfcfe; overflow: hidden; touch-action: none; user-select: none; transition: height .35s ease; cursor: grab; }
.og-viewport.is-dragging { cursor: grabbing; }
.og-viewport.og-expanded { height: clamp(520px, 76vh, 820px); }
.og-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.og-lane { position: absolute; z-index: 1; border: 1px solid #d5deea; border-radius: 20px; background: linear-gradient(180deg, #f8fafe 0%, #f3f6fb 100%); overflow: hidden; }
.og-zone { position: absolute; top: 0; height: 100%; border-right: 1px solid #dbe3ed; }
.og-zone:last-of-type { border-right: 0; }
.og-zone:nth-child(even) { background: rgba(237,242,249,.4); }
.og-zone-head { position: absolute; left: 14px; top: 9px; }
.og-zone-title { font-size: 12.5px; font-weight: 800; letter-spacing: .08em; color: #516a86; }
.og-zone-sub { font-size: 11px; color: #7d8a9b; margin-top: 1px; }
.og-rowline { position: absolute; left: 12px; right: 12px; height: 1px; background: #e0e6ee; }
.og-edges { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; overflow: visible; }
.og-edge { fill: none; stroke: #aab6c6; stroke-width: 1.8; opacity: .4; transition: opacity .18s; }
.og-edge.og-h-green { stroke: #74bfa7; }
.og-edge.og-h-amber { stroke: #d7a043; }
.og-edge.og-h-red { stroke: #df6670; stroke-width: 2.5; opacity: .75; }
.og-edge.og-dim, .og-pulse.og-dim { opacity: .08; }
.og-pulse.og-h-green { fill: #1f9d78; }
.og-pulse.og-h-amber { fill: #d58a13; }

.og-node { position: absolute; z-index: 10; overflow: hidden; padding: 7px 10px; background: #fff; border: 1px solid #dfe5ed; border-radius: 11px; box-shadow: 0 4px 12px rgba(18,38,68,.045); cursor: pointer; transition: opacity .18s, box-shadow .18s, transform .18s; }
.og-node:hover { transform: translateY(-1px); z-index: 28; }
.og-node:focus-visible { outline: 2px solid var(--watch-f); outline-offset: 2px; }
.og-node.og-focus { box-shadow: 0 0 0 4px rgba(23,52,95,.09), 0 9px 20px rgba(18,38,68,.1); z-index: 27; }
.og-node.og-dim { opacity: .3; }
.og-node.og-faded { opacity: .42; transform: scale(.97); }
.og-node.og-faded:hover { opacity: .8; }
.og-node.og-h-green { border-color: #a7d8c9; }
.og-node.og-h-amber { border-color: #edc477; background: #fffdf8; }
.og-node.og-h-red { border-color: #eca7ae; background: #fffafb; }
.og-node.og-h-neutral { border-style: dashed; border-color: #cbd4df; background: rgba(255,255,255,.92); }
.og-node.og-attention { box-shadow: 0 0 0 5px rgba(223,59,73,.09), 0 10px 22px rgba(18,38,68,.08); z-index: 19; }
.og-type { font-size: 10px; letter-spacing: .07em; color: #6c7a8d; font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-name { font-size: 14px; font-weight: 750; line-height: 1.25; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.og-when { font-size: 11px; font-weight: 800; letter-spacing: .05em; color: #7a8899; }
.og-meta { font-size: 11.5px; color: #6f7d8f; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-badge { display: inline-block; margin-top: 4px; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; background: #f0f4f8; color: #56687e; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
.og-h-green > .og-badge, .og-h-green .og-badge-row .og-badge { background: #eaf8f3; color: #1c7a5b; }
.og-h-amber > .og-badge, .og-h-amber .og-badge-row .og-badge { background: #fff4d9; color: #8f5d07; }
.og-h-red > .og-badge, .og-h-red .og-badge-row .og-badge { background: #fff0f2; color: #c2313f; }
.og-badge-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; min-width: 0; }
.og-badge-row .og-badge { margin-top: 0; flex: 0 1 auto; }
.og-open { font-size: 11.5px; font-weight: 700; color: var(--text); text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
.og-marks { display: flex; gap: 4px; margin-top: 6px; flex-wrap: nowrap; overflow: hidden; }
.og-mark { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.og-m-ok { background: #1f9d78; }
.og-m-unk { background: #bcc6d2; }
.og-m-bad { background: #df3b49; }
.og-lod-overview .og-type, .og-lod-overview .og-meta { display: none; }

.og-toolbar { position: absolute; right: 12px; top: 12px; z-index: 90; display: flex; gap: 4px; padding: 4px; border: 1px solid rgba(220,227,236,.9); background: rgba(255,255,255,.78); backdrop-filter: blur(8px); border-radius: 11px; }
.og-toolbar button { height: 32px; min-width: 32px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; color: var(--text); }
.og-toolbar button:hover { background: #fff; }
.og-toolbar button:focus-visible { outline: 2px solid var(--watch-f); }
.og-legend { position: absolute; right: 12px; bottom: 10px; z-index: 80; display: flex; gap: 12px; align-items: center; padding: 5px 10px; border: 1px solid rgba(220,227,236,.9); border-radius: 999px; background: rgba(255,255,255,.8); font-size: 11.5px; color: #4d5c70; }
.og-legend span { display: inline-flex; gap: 5px; align-items: center; }
.og-legend i { width: 8px; height: 8px; border-radius: 50%; }
.og-focus-pill { position: absolute; left: 50%; transform: translateX(-50%); top: 12px; z-index: 85; display: flex; gap: 10px; align-items: center; padding: 6px 8px 6px 14px; border-radius: 999px; border: 1px solid #edc477; background: #fff9ea; font-size: 13px; font-weight: 700; color: #7c5306; max-width: calc(100% - 210px); }
.og-focus-pill span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.og-focus-pill button { border: 0; background: #17345f; color: #fff; border-radius: 999px; padding: 5px 11px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.og-note { margin: 0; padding: 8px 16px; font-size: 12.5px; color: var(--text-soft); border-top: 1px solid var(--line-soft); }
@media (prefers-reduced-motion: reduce) {
  .og-viewport, .og-node, .og-edge { transition: none; }
}
@media (max-width: 720px) {
  .og-focus-pill { top: 56px; max-width: calc(100% - 24px); }
}
`;
