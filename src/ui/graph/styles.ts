/**
 * CSS for the focused graph renderer (V5.6 visual contract).
 *
 * Palette is graph-local (`--fg-*`) so the graph keeps the approved V5.6 look
 * regardless of app theme drift. Tone comes from the `sem-*` classes emitted by
 * the semantic layer. Pulses are presentation only: travelling dots on live
 * edges (GREEN 2.4s, AMBER 3.6s, RED / neutral none) — see scene.ts `pulseFor`.
 * There is deliberately NO transform transition on the stage (drag must not lag).
 */

export const FOCUSED_GRAPH_CSS = `
/* ================= focused graph canvas ================= */
.fg-canvas {
  --fg-ink: #10203a;
  --fg-muted: #6e7d92;
  --fg-line: #dce3ec;
  --fg-navy: #17345f;
  --fg-green: #1f9d78; --fg-green-line: #74bfa7; --fg-green-bg: #eaf8f3; --fg-green-border: #91d1bd;
  --fg-amber: #d58a13; --fg-amber-line: #d7a043; --fg-amber-bg: #fff4d9; --fg-amber-border: #edc477; --fg-amber-ink: #a56800;
  --fg-red: #df3b49; --fg-red-line: #df6670; --fg-red-bg: #fff0f2; --fg-red-border: #eca7ae;
  --fg-grey: #9aa8bb; --fg-grey-line: #aab6c6;
  position: relative;
  background: var(--surface, #fff);
  border: 1px solid var(--fg-line);
  border-radius: 17px;
  box-shadow: 0 12px 32px rgba(18, 38, 68, 0.055);
  overflow: hidden;
  color: var(--fg-ink);
}

.fg-viewport {
  position: relative;
  width: 100%;
  height: clamp(420px, 58vh, 560px);
  overflow: hidden;
  background: #fbfcfe;
  cursor: grab;
  touch-action: none;
  user-select: none;
  outline: none;
}
.fg-viewport.fg-dragging { cursor: grabbing; }

/* Selected-node detail stays available without expanding the graph stage. */
.fg-inspector {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 40;
  width: min(320px, calc(100% - 28px));
  box-sizing: border-box;
  padding: 11px 13px;
  border: 1px solid var(--fg-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 8px 24px rgba(18, 38, 68, 0.12);
  color: var(--fg-ink);
  pointer-events: none;
}
.fg-inspector-type,
.fg-inspector-state {
  margin: 0;
  color: var(--fg-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fg-inspector-title { margin: 3px 0 4px; font-size: 15px; line-height: 1.2; }
.fg-inspector-detail { margin: 0 0 6px; color: #526784; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }

.fg-stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}

/* ================= node cards ================= */
.fg-node {
  position: absolute;
  z-index: 10;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--fg-line);
  border-radius: 13px;
  box-shadow: 0 5px 14px rgba(18, 38, 68, 0.042);
  cursor: pointer;
  overflow: hidden;
  transition: opacity 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.2;
}
.fg-node:hover { transform: translateY(-1px) scale(1.03); box-shadow: 0 10px 22px rgba(18, 38, 68, 0.08); z-index: 28; }
.fg-node:focus-visible { outline: 2px solid var(--fg-navy); outline-offset: 2px; }

.fg-node.sem-ok { border-color: var(--fg-green-border); }
.fg-node.sem-watch { border-color: var(--fg-amber-border); }
.fg-node.sem-alert { border-color: var(--fg-red-border); background: #fffafb; }
.fg-node.sem-active { border-color: #9db0d1; }
.fg-node.sem-neutral { border-color: var(--fg-line); }

.fg-node.fg-size-small { padding: 8px 11px; background: #fbfcfe; }
.fg-node.fg-size-secondary { padding: 11px 13px; box-shadow: 0 0 0 4px rgba(223, 59, 73, 0.04), 0 10px 23px rgba(18, 38, 68, 0.07); z-index: 18; }

/* Focal emphasis (first breakpoint): larger card, amber ring + diffuse halo */
.fg-node.fg-focal {
  padding: 12px 15px;
  border: 1.7px solid var(--fg-amber);
  background: #fff;
  box-shadow: 0 0 0 5px rgba(213, 138, 19, 0.12), 0 0 32px 15px rgba(213, 138, 19, 0.2), 0 12px 28px rgba(18, 38, 68, 0.1);
  z-index: 19;
}
.fg-node.fg-focal.sem-alert { border-color: var(--fg-red); box-shadow: 0 0 0 5px rgba(223, 59, 73, 0.1), 0 0 32px 15px rgba(223, 59, 73, 0.16), 0 12px 28px rgba(18, 38, 68, 0.1); }
.fg-node.fg-focal .fg-nh { margin-bottom: 6px; }
.fg-node.fg-focal .fg-type { font-size: 9.5px; }
.fg-node.fg-focal .fg-title { font-size: 17px; line-height: 1.12; }
.fg-node.fg-focal .fg-detail { font-size: 10.5px; margin-top: 4px; }
.fg-node.fg-focal .fg-badge { font-size: 9.5px; padding: 5px 8px; }

/* Causal chain emphasis: a touch heavier */
.fg-node.fg-causal .fg-title { font-weight: 850; }

/* Context: quiet, compact, low contrast */
.fg-node.fg-context { color: #6a778a; }
.fg-node.fg-context .fg-title { font-size: 13px; font-weight: 800; }

/* Card internals */
.fg-nh { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 5px; flex: 0 0 auto; }
.fg-type {
  font-size: 8.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #7a879a;
  font-weight: 900;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fg-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-grey); }
.fg-dot.sem-ok { background: var(--fg-green); }
.fg-dot.sem-watch { background: var(--fg-amber); }
.fg-dot.sem-alert { background: var(--fg-red); }
.fg-dot.sem-active { background: var(--fg-navy); }

.fg-title {
  flex: 0 0 auto;
  margin: 0;
  font-size: 14px;
  font-weight: 850;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--fg-ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fg-detail {
  flex: 1 1 0;
  min-height: 0;
  margin: 4px 0 0;
  font-size: 10.5px;
  line-height: 1.28;
  color: #778498;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fg-footer { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; margin-top: auto; flex: 0 0 auto; padding-top: 4px; }

/* State badge */
.fg-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 999px;
  font-size: 9px;
  line-height: 1.1;
  font-weight: 900;
  letter-spacing: 0.02em;
  white-space: nowrap;
  background: var(--fg-line);
  color: #526784;
}
.fg-badge.sem-ok { background: var(--fg-green-bg); color: var(--fg-green); }
.fg-badge.sem-watch { background: var(--fg-amber-bg); color: var(--fg-amber-ink); }
.fg-badge.sem-alert { background: var(--fg-red-bg); color: var(--fg-red); }
.fg-badge.sem-active { background: #e8eef8; color: var(--fg-navy); }
.fg-badge.sem-neutral { background: #eef1f5; color: #607089; }
.fg-glyph { font-weight: 900; font-size: 10px; }

/* Checking badge (independent of semantic tone) */
.fg-checking-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  background: var(--fg-amber-bg);
  color: var(--fg-amber-ink);
  border: 1px dashed var(--fg-amber-border);
  animation: fg-checking-pulse 2s ease-in-out infinite;
  white-space: nowrap;
}
@keyframes fg-checking-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

/* ================= edges ================= */
.fg-edges {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 4;
}
.fg-edge { fill: none; stroke: var(--fg-grey-line); stroke-width: 2; transition: opacity 0.18s ease; }
.fg-edge.sem-ok { stroke: var(--fg-green-line); }
.fg-edge.sem-watch { stroke: var(--fg-amber-line); }
.fg-edge.sem-alert { stroke: var(--fg-red-line); stroke-width: 2.5; filter: drop-shadow(0 0 4px rgba(223, 59, 73, 0.34)); }
.fg-edge.sem-active { stroke: #6f86ab; }
.fg-edge.sem-neutral { stroke: var(--fg-grey-line); }
.fg-edge[data-focus="causal"] { stroke-width: 2.5; }
.fg-edge[data-focus="context"].sem-neutral { stroke: #c7d0dc; stroke-width: 1.5; stroke-dasharray: 6 7; }

/* Travelling dots: presentation only. GREEN normal, AMBER slower (durations set per edge). */
.fg-pulse-dot { transition: opacity 0.18s ease; }
.fg-pulse-dot.sem-ok { fill: var(--fg-green); }
.fg-pulse-dot.sem-watch { fill: var(--fg-amber); }

/* ================= view / selection dimming ================= */
.fg-node.fg-viewdim { opacity: 0.14; filter: saturate(0.3); }
.fg-edge.fg-viewdim { opacity: 0.11; }
.fg-pulse-dot.fg-viewdim { opacity: 0.08; }
.fg-node.fg-dimmed { opacity: 0.14; filter: saturate(0.3); }
.fg-edge.fg-dimmed { opacity: 0.11; }
.fg-pulse-dot.fg-dimmed { opacity: 0.08; }
.fg-node.fg-highlighted { box-shadow: 0 0 0 4px rgba(23, 52, 95, 0.09), 0 10px 22px rgba(18, 38, 68, 0.1); z-index: 27; }

/* ================= semantic zoom (zoomed far out) ================= */
.fg-stage.fg-zoom-out .fg-detail,
.fg-stage.fg-zoom-out .fg-type { display: none; }

/* ================= planning wrapper ================= */
.fg-planning-wrapper {
  position: relative;
  padding: 16px;
  border: 2px solid var(--watch-border);
  border-radius: var(--radius);
  background: var(--watch-bg);
  animation: fg-planning-border 2s ease-in-out infinite;
}
@keyframes fg-planning-border { 0%, 100% { border-color: var(--watch-border); } 50% { border-color: var(--watch); } }
.fg-planning-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--surface);
  border: 1px solid var(--watch-border);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--watch);
}
.fg-planning-banner::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--watch);
  animation: fg-planning-dot 1.5s ease-in-out infinite;
}
@keyframes fg-planning-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

/* ================= toolbar / views / hint ================= */
.fg-toolbar, .fg-views {
  position: absolute;
  top: 12px;
  z-index: 60;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid var(--fg-line);
  border-radius: 10px;
  box-shadow: 0 7px 20px rgba(18, 38, 68, 0.07);
}
.fg-toolbar { right: 12px; }
.fg-views { left: 12px; background: #f8fafc; }
.fg-toolbar button { border: 0; background: #fff; height: 30px; min-width: 30px; border-radius: 7px; font-weight: 850; cursor: pointer; color: var(--fg-ink); }
.fg-toolbar button:hover { background: #f2f5f9; }
.fg-zoom-readout { font-size: 10px; color: #748196; font-weight: 800; min-width: 42px; text-align: center; }
.fg-views button { border: 0; background: transparent; padding: 7px 9px; border-radius: 7px; color: #607089; font-size: 11px; font-weight: 850; cursor: pointer; font-family: inherit; }
.fg-views button:hover { color: var(--fg-ink); }
.fg-views button.active { background: var(--fg-navy); color: #fff; }
.fg-views button:disabled { opacity: 0.34; cursor: not-allowed; }
.fg-hint { position: absolute; left: 12px; bottom: 10px; z-index: 50; background: #fff; border: 1px solid #e4eaf1; border-radius: 8px; padding: 6px 8px; font-size: 10px; color: #8290a3; pointer-events: none; }

/* ================= prefers-reduced-motion ================= */
@media (prefers-reduced-motion: reduce) {
  .fg-checking-badge, .fg-planning-wrapper, .fg-planning-banner::before { animation: none !important; }
  .fg-pulses { display: none; }
  .fg-node { transition: none; }
}
`;
