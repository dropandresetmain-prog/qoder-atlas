/**
 * R2 LANE B — CSS constants for the focused graph renderer.
 *
 * Includes: node/edge styles, pulse keyframes (pure CSS, tone-derived),
 * focal/causal/context emphasis, checking badge, planning wrapper,
 * semantic zoom, prefers-reduced-motion support.
 */

export const FOCUSED_GRAPH_CSS = `
/* ================= focused graph canvas ================= */
.fg-canvas {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  min-height: 400px;
}

.fg-viewport {
  position: relative;
  width: 100%;
  height: 600px;
  overflow: auto;
  cursor: grab;
}

.fg-viewport:active {
  cursor: grabbing;
}

.fg-stage {
  position: relative;
  transform-origin: 0 0;
  transition: transform 0.2s ease-out;
}

/* ================= node cards ================= */
.fg-node {
  position: absolute;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out, opacity 0.15s ease-out;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  overflow: hidden;
}

.fg-node:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  z-index: 10;
}

.fg-node:focus-visible {
  outline: 2px solid var(--watch);
  outline-offset: 2px;
}

/* Tone-based border treatment */
.fg-node.sem-ok {
  border-left: 3px solid var(--ok);
}

.fg-node.sem-watch {
  border-left: 3px solid var(--watch);
}

.fg-node.sem-alert {
  border-left: 3px solid var(--alert);
}

.fg-node.sem-active {
  border-left: 3px solid var(--active);
}

.fg-node.sem-neutral {
  border-left: 3px solid var(--neutral);
}

/* Focal emphasis (firstBreakpoint) */
.fg-node.fg-focal {
  /* Same footprint as every card (layout owns geometry); emphasis is ring + weight. */
  border: 2px solid var(--watch);
  box-shadow: 0 0 0 4px rgba(217, 162, 74, 0.12), 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 20;
}

.fg-node.fg-focal .fg-title {
  font-size: 18px;
  font-weight: 700;
}

/* Causal chain emphasis */
.fg-node.fg-causal {
  border-left-width: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.fg-node.fg-causal .fg-title {
  font-weight: 650;
}

/* Context de-emphasis */
.fg-node.fg-context {
  opacity: 0.86;
  background: var(--surface-2);
}

.fg-node.fg-context:hover {
  opacity: 0.85;
}

/* Card internals */
.fg-type {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.fg-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fg-detail {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fg-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
}

/* State badge */
.fg-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.fg-badge.sem-ok {
  background: var(--ok-bg);
  color: var(--ok);
}

.fg-badge.sem-watch {
  background: var(--watch-bg);
  color: var(--watch);
}

.fg-badge.sem-alert {
  background: var(--alert-bg);
  color: var(--alert);
}

.fg-badge.sem-active {
  background: var(--active-bg);
  color: var(--active);
}

.fg-badge.sem-neutral {
  background: var(--neutral-bg);
  color: var(--neutral);
}

.fg-glyph {
  font-weight: 700;
  font-size: 11px;
}

/* Checking badge (independent of semantic tone) */
.fg-checking-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: var(--watch-bg);
  color: var(--watch);
  border: 1px dashed var(--watch-border);
  animation: fg-checking-pulse 2s ease-in-out infinite;
}

@keyframes fg-checking-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* ================= edges ================= */
.fg-edges {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.fg-edge {
  stroke: var(--neutral-border);
  stroke-width: 2;
  fill: none;
  transition: stroke 0.15s ease-out, opacity 0.15s ease-out;
}

.fg-edge[data-focus="causal"] {
  stroke: var(--watch);
  stroke-width: 3;
}

.fg-edge[data-focus="context"] {
  stroke: var(--neutral-border);
  stroke-dasharray: 6 4;
  opacity: 0.5;
}

/* ================= pulse animations (pure CSS, tone-derived) ================= */
/* ok tone: normal pulse */
.fg-node.sem-ok.fg-pulse,
.fg-edge.sem-ok.fg-pulse {
  animation: fg-pulse-ok 2.4s ease-in-out infinite;
}

@keyframes fg-pulse-ok {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.75; }
}

/* watch tone: slower pulse */
.fg-node.sem-watch.fg-pulse,
.fg-edge.sem-watch.fg-pulse {
  animation: fg-pulse-watch 3.6s ease-in-out infinite;
}

@keyframes fg-pulse-watch {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* alert tone: no pulse (static) */
/* No animation class applied */

/* ================= semantic zoom ================= */
.fg-stage.fg-zoom-out .fg-detail,
.fg-stage.fg-zoom-out .fg-type {
  display: none;
}

.fg-stage.fg-zoom-out .fg-node {
  padding: 8px;
}

.fg-stage.fg-zoom-out .fg-title {
  font-size: 12px;
}

/* ================= planning wrapper ================= */
.fg-planning-wrapper {
  position: relative;
  padding: 16px;
  border: 2px solid var(--watch-border);
  border-radius: var(--radius);
  background: var(--watch-bg);
  animation: fg-planning-border 2s ease-in-out infinite;
}

@keyframes fg-planning-border {
  0%, 100% { border-color: var(--watch-border); }
  50% { border-color: var(--watch); }
}

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

@keyframes fg-planning-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* ================= toolbar ================= */
.fg-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 30;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}

.fg-toolbar button {
  border: 0;
  background: var(--surface);
  height: 30px;
  min-width: 30px;
  border-radius: 7px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.1s ease-out;
}

.fg-toolbar button:hover {
  background: var(--surface-2);
}

.fg-toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fg-zoom-readout {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-soft);
  min-width: 42px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ================= named views ================= */
.fg-views {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 30;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}

.fg-views button {
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-soft);
  cursor: pointer;
  transition: background 0.1s ease-out, color 0.1s ease-out;
}

.fg-views button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.fg-views button.active {
  background: var(--ink);
  color: var(--paper);
}

.fg-views button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ================= prefers-reduced-motion ================= */
@media (prefers-reduced-motion: reduce) {
  .fg-node,
  .fg-edge,
  .fg-checking-badge,
  .fg-planning-wrapper,
  .fg-planning-banner::before {
    animation: none !important;
  }
}

/* ================= selection state ================= */
.fg-node.fg-dimmed {
  opacity: 0.15;
  pointer-events: none;
}

.fg-edge.fg-dimmed {
  opacity: 0.1;
}

.fg-node.fg-highlighted {
  box-shadow: 0 0 0 3px var(--watch), 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 15;
}
`;
