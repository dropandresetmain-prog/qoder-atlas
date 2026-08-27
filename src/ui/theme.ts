/**
 * E2 — visual theme, inlined per page so previews are self-contained and the
 * integrator can serve them without a static-asset pipeline.
 *
 * Design system: "cockpit daylight × concierge" — see docs/DESIGN.md.
 * This file is the production implementation of the approved Northstar design
 * renders (docs/design-renders/renders.css on lane/wave3-ui-renders): same
 * tokens, same components, same motion charter. Chromatic colour is reserved
 * for state (green confirmed · brass proposed/waiting · vermilion
 * broken/decide · grey unknown/unbooked · ink = system working). Motion is
 * CSS-only: entry stagger, the "settle" state-change flicker, ≤200ms
 * interaction transitions, and a full prefers-reduced-motion kill switch.
 *
 * Hooks used by existing screens/tests (data-ui-state, choice-form, badge
 * tones, demo tooling) are preserved; the approved component set (event
 * select, case rail, card chain, staged checks, timeline, feed, modal,
 * intake, thread/composer) is additive.
 */
export const THEME_CSS = `
/* ================= tokens ================= */
:root {
  --bg: #F2F4F5;
  --surface: #FFFFFF;
  --surface-2: #F8F9FA;
  --ink: #14171C;
  --paper: #F5F6F7;
  --paper-warm: #F4F0E6;
  --text: #14171C;
  --text-soft: rgba(20, 23, 28, 0.62);
  --text-faint: rgba(20, 23, 28, 0.42);
  --border: rgba(20, 23, 28, 0.13);
  --line-soft: rgba(20, 23, 28, 0.07);

  /* state palette — colour means state only (docs/DESIGN.md §2.2) */
  --ok: #2F6B47;         --ok-f: #4C9A6E;      --ok-bg: #E9F2EC;      --ok-border: #BFD9C9;
  --watch: #96670F;      --watch-f: #D9A24A;   --watch-bg: #FBF3DF;   --watch-border: #EAD9A8;
  --alert: #C2431A;      --alert-f: #E0521F;   --alert-bg: #FBEDE7;   --alert-border: #EFC0B2;
  --active: #14171C;     --active-f: #14171C;  --active-bg: #ECEEF1;  --active-border: #CDD2D9;
  --done: #2F6B47;       --done-f: #4C9A6E;    --done-bg: #E9F2EC;    --done-border: #BFD9C9;
  --neutral: #5C6470;    --neutral-f: #C6CBD2; --neutral-bg: #EFF1F4; --neutral-border: #D8DCE1;

  --font-sans: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", monospace;
  --font-serif: Georgia, "Iowan Old Style", "Times New Roman", serif;

  --radius: 14px;
  --shadow: 0 1px 2px rgba(16, 22, 30, 0.05), 0 6px 24px -12px rgba(16, 22, 30, 0.12);
  --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--watch-bg); }

/* ================= motion primitives =================
   Scoped, never page-wide: entry stagger only inside .stagger / .dotgrid
   containers; the settle only on .big-settle; the change tint only on
   .just-changed; shimmer only inside .skeleton; breathe only on .fc-live. */
@keyframes ns-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
/* split-flap "settle": the signature state-change flicker (DESIGN.md §6.1) */
@keyframes ns-settle {
  0%   { opacity: 0; transform: translateY(-5px); }
  35%  { opacity: 1; transform: translateY(1px); }
  60%  { transform: translateY(-1px); }
  100% { opacity: 1; transform: none; }
}
/* brief wash of the new state colour after a change; pairs with ns-settle */
@keyframes ns-changed {
  0%   { background-color: var(--watch-bg); }
  100% { background-color: transparent; }
}
@keyframes ns-shimmer {
  from { background-position: -200px 0; }
  to   { background-position: 200px 0; }
}
@keyframes ns-breathe {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

.stagger > * {
  animation: ns-rise 0.45s var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 45ms);
}
.dotgrid > * { animation: ns-rise 0.4s var(--ease-out) both; animation-delay: calc(var(--i, 0) * 12ms); }
.big-settle { animation: ns-settle 0.7s var(--ease-out) 0.1s both; }
.just-changed { background-color: var(--watch-bg); animation: ns-changed 1.6s ease-out both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ================= top bar (operator shell) ================= */
.topbar {
  background: var(--surface);
  color: var(--text);
  padding: 0 24px;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}
.topbar .brand { font-weight: 700; font-size: 15px; display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
.topbar .brand .mark { color: var(--watch-f); font-size: 13px; }
.topbar .brand small {
  font-weight: 400;
  font-size: 10.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.event-select {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 9px;
  padding: 5px 11px; font-size: 13px; font-weight: 600;
  background: var(--surface-2); white-space: nowrap;
}
.event-select .es-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok-f); }
.event-select .es-caret { color: var(--text-faint); font-size: 10px; }
.topbar nav { display: flex; gap: 2px; margin-left: 6px; flex-wrap: wrap; }
.topbar nav a {
  color: var(--text-soft);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: background-color 150ms ease-out, color 150ms ease-out;
}
.topbar nav a:hover { background: var(--surface-2); color: var(--text); }
.topbar nav a.is-active { background: var(--ink); color: var(--paper); }
.nav-count {
  font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  background: var(--alert); color: #fff; border-radius: 999px; padding: 1px 6px;
}
.topbar nav a.is-active .nav-count { background: var(--alert-f); }
.topbar .tb-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.replay-pill {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 600; letter-spacing: 0.1em;
  color: var(--text-faint); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px;
  display: inline-flex; align-items: center; gap: 6px; text-transform: uppercase;
}
.replay-pill::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--neutral-f); }
.replay-pill.rp-live { color: var(--alert); border-color: var(--alert-border); }
.replay-pill.rp-live::before { background: var(--alert-f); }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--ink); color: var(--paper);
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; letter-spacing: 0.04em;
}

/* ================= page scaffold ================= */
.shell { max-width: 1180px; margin: 0 auto; padding: 28px 24px 64px; }

.page-head { margin-bottom: 22px; }
.page-head h1 { margin: 0 0 6px; font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
.page-head h1 .badge { vertical-align: middle; }
.page-head .sub { margin: 0; color: var(--text-soft); }
.page-head .meta {
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.demo-reset-form { margin: 10px 0 0; }
.demo-reset-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.demo-reset-btn:hover {
  background: var(--surface-2);
  border-color: rgba(20, 23, 28, 0.22);
}

/* section titles: real hierarchy — 17px semibold sans, never the mono label tier */
.section { margin: 28px 0 12px; }
.section > h2 {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.005em;
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.section > h2 .count {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  letter-spacing: 0.06em;
}
.section > h2 .count.c-alert { color: var(--alert); }
.section > h2 .h2-link { margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-soft); text-decoration: none; }
.section > h2 .h2-link:hover { color: var(--text); }

/* ================= cards & panels ================= */
.card, .panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.card { padding: 18px; }
.panel { padding: 18px 20px; margin: 16px 0; }
.panel h2, .card h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 650;
  color: var(--text);
}
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-title { margin: 0; font-size: 15px; font-weight: 650; }
.card-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-soft); }
.card .kv { margin-top: 12px; }
.kv-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  margin: 0 0 4px;
}
.card-foot { margin-top: 14px; font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.footnote { font-size: 12.5px; color: var(--text-faint); margin: 14px 2px 0; }
.empty-note { color: var(--text-faint); font-style: italic; margin: 4px 0; }

.trip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }

/* ================= summary tiles ================= */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 20px 0 28px; }
.tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--neutral-border);
  border-radius: 12px;
  padding: 13px 15px;
  box-shadow: var(--shadow);
}
.tile .tile-count { font-family: var(--font-mono); font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile .tile-label { font-size: 12px; color: var(--text-soft); margin-top: 2px; }
.tile.tone-ok { border-left-color: var(--ok-f); }
.tile.tone-watch { border-left-color: var(--watch-f); }
.tile.tone-alert { border-left-color: var(--alert-f); }
.tile.tone-active { border-left-color: var(--active-f); }
.tile.tone-done { border-left-color: var(--done-f); }
.tile.tone-neutral { border-left-color: var(--neutral-border); }
.tile.is-attention { outline: 2px solid var(--alert-border); }

/* ================= badges & chips ================= */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 3px 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
  white-space: nowrap;
}
.badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge.tone-ok { color: var(--ok); background: var(--ok-bg); border-color: var(--ok-border); }
.badge.tone-watch { color: var(--watch); background: var(--watch-bg); border-color: var(--watch-border); }
.badge.tone-alert { color: var(--alert); background: var(--alert-bg); border-color: var(--alert-border); }
.badge.tone-active { color: var(--active); background: var(--active-bg); border-color: var(--active-border); }
.badge.tone-done { color: var(--done); background: var(--done-bg); border-color: var(--done-border); }
.badge.tone-neutral { color: var(--neutral); background: var(--neutral-bg); border-color: var(--neutral-border); }
/* UNKNOWN never rests on colour alone: the badge carries a "?" pip */
.badge.tone-neutral::before { content: "?"; background: none; font-size: 9px; line-height: 1; }

.chip {
  display: inline-block;
  border-radius: 6px;
  padding: 1px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  background: var(--neutral-bg);
  color: var(--neutral);
  border: 1px solid var(--neutral-border);
}
.chip.chip-extra { background: var(--watch-bg); color: var(--watch); border-color: var(--watch-border); }
.chip.chip-saving { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-border); }
.chip.chip-cost { background: var(--watch-bg); color: var(--watch); border-color: var(--watch-border); }
a.chip { text-decoration: none; transition: border-color 150ms ease-out; }
a.chip:hover { border-color: var(--text-faint); }

/* ================= lists ================= */
.plain-list { margin: 0; padding-left: 18px; }
.plain-list li { margin: 4px 0; }
.plain-list li::marker { color: var(--text-faint); }
.icon-list { list-style: none; margin: 0; padding: 0; }
.icon-list li { display: flex; gap: 8px; align-items: baseline; margin: 5px 0; }
.icon-list .ic { flex: none; font-weight: 700; font-family: var(--font-mono); }
.ic-pass { color: var(--ok); }
.ic-fail { color: var(--alert); }
.ic-unknown { color: var(--watch); }
.ic-queue { color: var(--text-faint); }
.ic-watch { color: var(--watch); }
.ic-progress { color: var(--active); }

/* ================= callouts ================= */
.callout {
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 12px;
  padding: 14px 16px;
  margin: 12px 0;
  background: var(--surface);
}
.callout.tone-alert { border-left-color: var(--alert-f); background: var(--alert-bg); }
.callout.tone-watch { border-left-color: var(--watch-f); background: var(--watch-bg); }
.callout.tone-ok { border-left-color: var(--ok-f); background: var(--ok-bg); }
.callout.tone-active { border-left-color: var(--active-f); background: var(--active-bg); }
.callout h3 { margin: 0 0 6px; font-size: 14px; font-weight: 650; }
.callout p { margin: 4px 0; font-size: 13.5px; }
.callout .callout-title { font-weight: 650; margin: 0 0 2px; }

/* ================= operator readout + fleet grid ================= */
.readout { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 16px; margin: 4px 0 8px; align-items: stretch; }
.readout-ink {
  background: var(--ink);
  color: var(--paper);
  border-radius: var(--radius);
  padding: 22px 24px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 178px;
  min-width: 0;
  overflow: hidden;
}
.ri-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(245, 246, 247, 0.55);
  margin: 0;
}
.readout-ink .big {
  font-family: var(--font-mono);
  font-size: 64px;
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin: 6px 0 10px;
}
.readout-ink .big .unit { font-size: 22px; font-weight: 500; color: rgba(245, 246, 247, 0.45); }
.readout-ink .ri-confirmed-word { margin: 2px 0 8px; font-size: 15px; font-weight: 600; color: rgba(245, 246, 247, 0.88); letter-spacing: 0.04em; text-transform: uppercase; }
.readout-ink .ri-scale { margin-bottom: 6px !important; font-size: 13.5px; }
.readout-ink .sub { margin: 0; font-size: 14px; color: rgba(245, 246, 247, 0.72); display: flex; flex-wrap: wrap; gap: 4px 10px; }
.seg-ok { color: #9FD2B4; }
.seg-warn { color: #E8B95F; }
.seg-bad { color: #F0926F; }
.seg-dim { color: rgba(245, 246, 247, 0.45); }

.readout-fleet {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.board { min-width: 0; }
.brow { grid-template-columns: 16px minmax(140px, 0.85fr) minmax(0, 2.2fr) auto; }
.brow .b-right { min-width: 0; max-width: 180px; }
.fc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.fc-title {
  font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint);
}
.fc-live {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.1em;
  color: var(--ok); display: inline-flex; align-items: center; gap: 6px;
}
.fc-live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ok-f); animation: ns-breathe 2.4s ease-in-out infinite; }
.dotgrid { display: grid; grid-template-columns: repeat(auto-fill, 19px); gap: 6px; margin-bottom: 14px; }
/* Full filled contribution cells — identical geometry, no inset rings or hollow frames. */
.dotgrid i {
  width: 19px; height: 19px; border-radius: 5px; display: block; position: relative;
  box-sizing: border-box; border: 0; outline: 0; box-shadow: none; background: var(--neutral-f);
}
.dotgrid i::before { content: none; display: none; }
.dotgrid i.d-ok { background: var(--ok-f); }
.dotgrid i.d-watch { background: var(--watch-f); }
.dotgrid i.d-bad { background: var(--alert-f); }
.dotgrid i.d-active { background: var(--active-f); }
.dotgrid i.d-unconfirmed { background: var(--neutral-f); }
.dotgrid i.d-local { background: rgba(150, 103, 15, 0.35); }
.dotgrid i.d-empty { background: var(--neutral-f); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: auto; }
.legend span { font-size: 11.5px; color: var(--text-soft); display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 9px; height: 9px; border-radius: 2.5px; display: inline-block; }
.legend i.l-ok { background: var(--ok-f); }
.legend i.l-watch { background: var(--watch-f); }
.legend i.l-bad { background: var(--alert-f); }
.legend i.l-active { background: var(--active-f); }
.legend i.l-empty { border: 1px dashed var(--neutral-border); }
.legend i.l-unconfirmed { background: var(--neutral-f); }
.legend i.l-local { background: rgba(150, 103, 15, 0.35); border: 1px solid rgba(150, 103, 15, 0.25); }

.programme-scale { margin: 0 0 12px; font-size: 15px; color: var(--text-soft); }
.queue, .board {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.qrow, .brow {
  display: grid;
  gap: 14px;
  align-items: center;
  padding: 12px 18px;
  border-top: 1px solid var(--line-soft);
  transition: background-color 150ms ease-out, transform 150ms ease-out;
}
.qrow { grid-template-columns: 20px minmax(130px, 0.9fr) minmax(0, 2.2fr) auto; padding: 13px 18px; }
.brow { grid-template-columns: 16px minmax(170px, 0.9fr) minmax(0, 2.2fr) auto; }
a.qrow, a.brow.brow-actionable { color: inherit; text-decoration: none; cursor: pointer; }
a.qrow:focus-visible, a.brow.brow-actionable:focus-visible { outline: 2px solid var(--watch-f); outline-offset: -2px; }
.qrow:first-child, .brow:first-child { border-top: 0; }
.qrow:hover, a.brow.brow-actionable:hover { background: var(--surface-2); transform: translateY(-1px); }
.qrow > div, .brow > div { min-width: 0; }
/* boxed queue glyphs — the state mark is a chip, not loose text */
.q-glyph {
  width: 20px; height: 20px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
}
.g-bad { background: var(--alert-bg); color: var(--alert); border: 1px solid var(--alert-border); }
.g-warn { background: var(--watch-bg); color: var(--watch); border: 1px solid var(--watch-border); }
.g-unk { background: var(--neutral-bg); color: var(--neutral); border: 1px solid var(--neutral-border); }
.q-name, .b-name { font-weight: 650; font-size: 15.5px; min-width: 0; }
.q-issue { color: var(--text-soft); font-size: 14.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.b-issue { color: var(--text); font-size: 14.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.b-extra { color: var(--text-faint); font-size: 12.5px; margin-top: 2px; min-width: 0; }
.q-time, .b-time { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.brow .b-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.b-dot { width: 11px; height: 11px; border-radius: 3px; display: inline-block; background: var(--neutral-f); }
.b-dot.d-ok { background: var(--ok-f); }
.b-dot.d-watch { background: var(--watch-f); }
.b-dot.d-bad { background: var(--alert-f); }
.b-dot.d-active { background: var(--active-f); }
.b-dot.d-unconfirmed { background: var(--neutral-f); }
.b-dot.d-local { background: rgba(150, 103, 15, 0.35); }
.b-dot.d-empty { background: var(--neutral-f); }
.roster-search { margin: 0 0 12px; }
.roster-search-input {
  width: 100%; max-width: 340px; box-sizing: border-box;
  padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px;
  font: inherit; font-size: 15px; background: var(--surface);
}
.roster-pagination {
  display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap;
}
.roster-page-label { font-size: 14px; color: var(--text-soft); }
.traveller-name-cell { max-width: 220px; overflow: hidden; }
.traveller-name-cell .traveller-secondary { margin-top: 4px; }
.traveller-table td, .traveller-table th { overflow-wrap: anywhere; }
.more-options { margin-top: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 10px 14px; }
.more-options > summary { cursor: pointer; font-weight: 600; font-size: 15px; }
.more-options-body { margin-top: 12px; }
.primary-options { display: grid; gap: 10px; }
.option-card[data-option-selectable="true"] { cursor: pointer; transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
.option-card[data-option-selectable="true"]:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.option-card.is-selected {
  border-color: var(--watch-f);
  box-shadow: 0 0 0 2px rgba(184, 133, 38, 0.28);
  background: linear-gradient(180deg, rgba(184, 133, 38, 0.08), var(--surface));
}
.option-card .why-recommended {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--ok-bg); color: var(--ok); font-size: 13.5px;
}
.waiting-decision-block {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 18px 20px; margin-bottom: 16px;
  border-left: 4px solid var(--watch-f);
}
.waiting-decision-block h3 { margin: 0 0 8px; font-size: 18px; }
.waiting-decision-block p { margin: 0; color: var(--text-soft); font-size: 15px; }
.authority-auto-banner {
  background: var(--ok-bg); border: 1px solid var(--ok-border); border-radius: 12px;
  padding: 14px 16px; margin-bottom: 12px;
}
.authority-auto-banner strong { display: block; margin-bottom: 4px; color: var(--ok); }
.case-workspace[data-case-phase="impacted"] [data-case-options-panel] { display: none !important; }
.case-workspace[data-case-phase="impacted"] [data-ui-section="primary-approval"] { display: none !important; }
.case-workspace[data-case-phase="resolved"] [data-resolve-northstar-cta],
.case-workspace[data-case-phase="execute"] [data-resolve-northstar-cta],
.case-workspace[data-case-phase="executing"] [data-resolve-northstar-cta],
.case-workspace[data-case-phase="awaiting_authority"] [data-resolve-northstar-cta],
.case-workspace[data-case-phase="options"] [data-resolve-northstar-cta] { display: none !important; }
.case-workspace[data-case-phase="resolved"] [data-case-begin-panel],
.case-workspace[data-case-phase="execute"] [data-case-begin-panel],
.case-workspace[data-case-phase="executing"] [data-case-begin-panel],
.case-workspace[data-case-phase="awaiting_authority"] [data-case-begin-panel] { display: none !important; }
.ns-resolve-scrim {
  position: fixed; inset: 0; z-index: 80; background: rgba(20, 24, 28, 0.48);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.ns-resolve-scrim[hidden] { display: none !important; }
.ns-resolve-modal {
  width: min(520px, 100%); background: var(--surface); border-radius: 16px;
  box-shadow: var(--shadow); border: 1px solid var(--border); padding: 22px 24px 20px;
}
.ns-resolve-kicker {
  margin: 0 0 4px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-faint);
}
.ns-resolve-title { margin: 0 0 14px; font-size: 22px; }
.ns-resolve-bar {
  height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin-bottom: 16px;
}
.ns-resolve-bar > i {
  display: block; height: 100%; width: 0; background: var(--watch-f); border-radius: inherit;
  transition: width 80ms linear;
}
.ns-resolve-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ns-resolve-steps li {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px;
  background: var(--surface-2); color: var(--text-soft); font-size: 14px;
}
.ns-resolve-step-mark {
  width: 10px; height: 10px; border-radius: 50%; background: var(--neutral-border); flex: 0 0 auto;
}
.ns-resolve-steps li.is-active { background: var(--watch-bg); color: var(--text); }
.ns-resolve-steps li.is-active .ns-resolve-step-mark { background: var(--watch-f); }
.ns-resolve-steps li.is-done { color: var(--ok); }
.ns-resolve-steps li.is-done .ns-resolve-step-mark { background: var(--ok-f); }
body.ns-resolve-open { overflow: hidden; }
@media (prefers-reduced-motion: reduce) {
  .option-card[data-option-selectable="true"]:hover { transform: none; }
  .ns-resolve-bar > i { transition: none; }
}
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
.section-primary-action { background: var(--paper-warm); border: 1px solid var(--watch-border); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 18px; }
.btn-sm { font-size: 13px; padding: 5px 10px; }
.btn-secondary { background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.btn-secondary:hover { background: var(--surface-2); }
/* mini journey chain on overview rows — flight · transfer · stay · commitment at a glance */
.mini-chain { display: inline-flex; align-items: center; gap: 7px; margin-top: 6px; font-size: 16px; font-weight: 600; line-height: 1; }
.mini-chain-link { display: inline-flex; align-items: center; justify-content: center; min-width: 1.1em; }
.mini-chain .mc-ln { width: 10px; height: 1px; background: var(--neutral-border); display: inline-block; }
.mini-chain .mc-ok { color: var(--ok); }
.mini-chain .mc-watch { color: var(--watch); }
.mini-chain .mc-alert { color: var(--alert); }
.mini-chain .mc-neutral { color: var(--neutral); }

/* ================= journey chain ================= */
/* each link is its own card — a tinted link must never bleed into its neighbours */
.chain { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.chain .link {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: var(--shadow); padding: 14px 16px 12px;
  border-top: 3px solid var(--neutral-border); position: relative; min-width: 0;
}
.chain .link .lk-kind {
  font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--text-faint); display: flex; align-items: center; gap: 8px;
}
.chain .link .lk-label { font-weight: 650; font-size: 14.5px; margin-top: 6px; }
.chain .link .lk-detail { font-size: 13px; color: var(--text-soft); margin-top: 3px; }
.chain .link .lk-state {
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; margin-top: 10px;
}
.chain .link.st-confirmed { border-top-color: var(--ok-f); }
.chain .link.st-confirmed .lk-state { color: var(--ok); }
.chain .link.st-proposed {
  border-top-color: var(--watch-f); border-top-style: dashed;
  background: linear-gradient(var(--watch-bg), var(--watch-bg)) bottom / 100% 40% no-repeat;
}
.chain .link.st-proposed .lk-state { color: var(--watch); }
.chain .link.st-broken { border-top-color: var(--alert-f); }
.chain .link.st-broken .lk-state { color: var(--alert); }
.chain .link.st-unbooked { border-top-color: var(--neutral-f); border-top-style: dotted; }
.chain .link.st-unbooked .lk-state { color: var(--neutral); }
.chain .link.st-unknown { border-top-color: var(--neutral-f); border-top-style: dotted; }
.chain .link.st-unknown .lk-state { color: var(--neutral); }
.chain .link.st-atrisk { border-top-color: var(--watch-f); }
.chain .link.st-atrisk .lk-state { color: var(--watch); }
.chain .link.is-commitment .lk-kind { color: var(--watch); }
/* Trip Status icons — readable glyph, not micro-metadata */
.chain .link .lk-g {
  font-weight: 700; font-size: 18px; line-height: 1;
  width: 28px; height: 28px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-2); flex: 0 0 auto;
}
.chain .link.st-confirmed .lk-g { color: var(--ok); }
.chain .link.st-proposed .lk-g { color: var(--watch); }
.chain .link.st-broken .lk-g { color: var(--alert); }
.chain .link.st-unbooked .lk-g, .chain .link.st-unknown .lk-g { color: var(--neutral); }
.chain .link.st-atrisk .lk-g { color: var(--watch); }

/* ================= stepper ================= */
.stepper { display: flex; align-items: center; gap: 0; margin: 18px 0 4px; overflow: hidden; }
.step { display: flex; align-items: center; gap: 8px; flex: 1 1 0; min-width: 0; }
.step .s-dot {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--neutral-border); flex: none; position: relative; background: var(--surface);
}
.step.done .s-dot { background: var(--ok-f); border-color: var(--ok-f); }
.step.current .s-dot { border-color: var(--ink); background: var(--surface); }
.step.current .s-dot::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--ink); }
.step .s-label {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.step.done .s-label { color: var(--ok); }
.step.current .s-label { color: var(--ink); }
.step .s-line { flex: 1 1 0; height: 2px; background: var(--line-soft); margin: 0 8px; min-width: 12px; }
.step.done .s-line { background: var(--ok-border); }

/* ================= option cards (operator) ================= */
.option-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px 18px;
  margin: 12px 0;
  position: relative;
  transition: border-color 150ms ease-out;
}
.option-card.is-recommended { box-shadow: var(--shadow), inset 3px 0 0 var(--ok-f); }
.option-card.is-rejected { box-shadow: var(--shadow), inset 3px 0 0 var(--alert-f); background: var(--surface-2); }
.option-card .opt-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.option-card .opt-title { font-weight: 650; font-size: 14.5px; }
.option-card .opt-body { margin-top: 6px; font-size: 13.5px; color: var(--text-soft); }
.option-card .opt-flags { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
.why-not {
  margin-top: 12px; background: var(--alert-bg); border: 1px solid var(--alert-border);
  border-radius: 8px; padding: 9px 12px; font-size: 13px; color: var(--alert);
}
.why-not strong { font-weight: 650; }
/* legacy aliases — kept so older markup keeps rendering until screens migrate */
.option-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.option-title { margin: 0; font-size: 15px; font-weight: 650; }
.option-summary { margin: 6px 0 0; color: var(--text-soft); font-size: 14px; }
.option-meta { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.rejection {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px;
  background: var(--alert-bg); border: 1px solid var(--alert-border);
  color: var(--alert); font-size: 13.5px;
}

/* ================= case workspace (two-column) ================= */
.case-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(300px, 380px); gap: 20px; align-items: start; }
.case-rail { position: sticky; top: 76px; display: flex; flex-direction: column; gap: 14px; }
.rail-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; }
.rail-card.ink { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.rail-card.ink .kv-label { color: rgba(245, 246, 247, 0.55); }
.rail-card.ink .rc-title { color: var(--paper); }
.rail-card.ink .rc-body { color: rgba(245, 246, 247, 0.78); }
.rc-title { font-size: 14.5px; font-weight: 650; margin: 0 0 6px; }
.rc-body { font-size: 13.5px; color: var(--text-soft); margin: 0; }
.rc-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line-soft); font-size: 13px; }
.rc-row:first-of-type { border-top: 0; }
.rc-row .k { color: var(--text-faint); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; }
.rc-row .v { font-weight: 600; text-align: right; }
.rail-card.ink .rc-row { border-top-color: rgba(245, 246, 247, 0.14); }
.rail-card.ink .rc-row .k { color: rgba(245, 246, 247, 0.5); }

/* funding split bar */
.splitbar { height: 8px; border-radius: 4px; overflow: hidden; display: flex; margin: 10px 0 6px; }
.splitbar .sp-org { background: var(--ink); }
.splitbar .sp-trav { background: var(--watch-f); }
.split-legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-soft); }
.split-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 5px; }

/* ================= action buttons ================= */
.btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  min-height: 42px;
  padding: 10px 18px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
  font-weight: 650;
  cursor: pointer;
  text-decoration: none;
  transition: transform 140ms var(--ease-out), background-color 140ms ease-out, box-shadow 140ms ease-out;
}
.btn:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.btn:focus-visible { outline: 2px solid var(--watch-f); outline-offset: 2px; }
.btn:disabled { opacity: 0.55; cursor: wait; transform: none; }
.btn-primary { background: var(--ink); color: var(--paper); }
.btn-ghost { background: var(--surface); color: var(--text); border-color: var(--border); }
.btn-ghost:hover { background: var(--surface-2); }
.btn-danger-ghost { background: var(--surface); color: var(--alert); border-color: var(--alert-border); }
.btn-danger-ghost:hover { background: var(--alert-bg); }
.btn-danger { border-color: var(--alert); color: var(--alert); background: var(--alert-bg); }
.btn-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.approval-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

/* staged checks (recovery in progress) */
.check-row {
  display: flex; align-items: baseline; gap: 10px;
  padding: 8px 0; border-top: 1px solid var(--line-soft); font-size: 13.5px;
}
.check-row:first-child { border-top: 0; }
.check-row .c-ic { font-family: var(--font-mono); font-weight: 700; width: 16px; flex: none; }
.check-row.done .c-ic { color: var(--ok); }
.check-row.doing .c-ic { color: var(--watch); }
.check-row.doing .c-t { color: var(--text); font-weight: 600; }
.check-row.queued { color: var(--text-faint); }
.check-row.queued .c-ic { color: var(--text-faint); }
.check-row.failed .c-ic { color: var(--alert); }
.check-row.failed .c-t { color: var(--text); }
.check-row .c-sub { margin-left: auto; font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ================= programme timeline ================= */
.timeline { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px 18px; }
.tl-day { display: grid; grid-template-columns: 92px 1fr; gap: 14px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
.tl-day:first-child { border-top: 0; }
.tl-date {
  font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); padding-top: 2px;
}
.tl-items { display: flex; flex-direction: column; gap: 6px; }
.tl-item { display: flex; align-items: baseline; gap: 10px; font-size: 13.5px; }
.tl-item .t { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tl-item .dot { width: 8px; height: 8px; border-radius: 2px; flex: none; position: relative; top: -1px; }
.tl-item .dot.d-ok { background: var(--ok-f); }
.tl-item .dot.d-watch { background: var(--watch-f); }
.tl-item .dot.d-bad { background: var(--alert-f); }
.tl-item.endangered .t, .tl-item.endangered .ttl { color: var(--alert); }
.tl-item.endangered .dot { background: var(--alert-f); }
.tl-item .tag {
  margin-left: auto; font-family: var(--font-mono); font-size: 10px;
  color: var(--text-faint); letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap;
}

/* ================= tables ================= */
.table-wrap { overflow-x: auto; }
.table-panel { padding: 0; overflow: hidden; }
.table-scroll { max-height: 660px; overflow: auto; scrollbar-gutter: stable; }
.table-scroll:focus-visible { outline: 2px solid var(--watch-f); outline-offset: -2px; }
.traveller-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.traveller-table th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 0 12px 10px 0;
  border-bottom: 1px solid var(--border);
}
.table-scroll .traveller-table th { position: sticky; top: 0; z-index: 1; background: var(--surface); padding-top: 8px; }
.traveller-table td { padding: 9px 12px 9px 0; border-bottom: 1px solid var(--line-soft); vertical-align: middle; font-variant-numeric: tabular-nums; }
.traveller-table tr:last-child td { border-bottom: 0; }
.traveller-table .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.traveller-table tbody tr { transition: background-color 150ms ease-out; }
.traveller-table tbody tr:hover td { background: var(--surface-2); }
.traveller-table a { color: var(--text); text-decoration: none; font-weight: 600; white-space: nowrap; }
.traveller-link { color: inherit; font-weight: 650; text-decoration: none; }
.traveller-link:hover { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.action-indicator { color: var(--alert); margin-left: 6px; }

/* quiet in-content links — never browser-default blue/underline */
.meta a { text-decoration: none; }
.a-note a { color: inherit; text-decoration: none; }

/* ================= event-change preview modal ================= */
.preview-banner {
  background: var(--ink); color: var(--paper-warm); border-radius: 10px;
  padding: 9px 16px; font-family: var(--font-mono); font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px;
}
.preview-banner .pb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--watch-f); }
.modal-scrim { position: fixed; inset: 0; background: rgba(20, 23, 28, 0.36); z-index: 30; }
.modal {
  position: fixed; z-index: 40; top: 72px; left: 50%; transform: translateX(-50%);
  width: min(720px, calc(100vw - 48px)); max-height: calc(100vh - 110px); overflow: auto;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  box-shadow: 0 24px 64px -16px rgba(16, 22, 30, 0.35); padding: 22px 24px;
}
.modal h2 { margin: 0 0 2px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.modal .m-sub { color: var(--text-soft); font-size: 13.5px; margin: 0 0 16px; }
.change-compare { display: grid; grid-template-columns: 1fr 40px 1fr; align-items: stretch; margin: 14px 0; }
.change-compare .cc-box { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--surface-2); }
.change-compare .cc-box.to { background: var(--watch-bg); border-color: var(--watch-border); }
.change-compare .cc-arrow { display: flex; align-items: center; justify-content: center; font-size: 18px; color: var(--text-faint); }
.cc-box .kv-label { margin-bottom: 6px; }
.cc-box .cc-when { font-family: var(--font-mono); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cc-box .cc-where { font-size: 12.5px; color: var(--text-soft); margin-top: 3px; }
.impact-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-soft); font-size: 13.5px; }
.impact-row:first-of-type { border-top: 0; }
.impact-row .i-count { font-family: var(--font-mono); font-size: 18px; font-weight: 600; min-width: 34px; font-variant-numeric: tabular-nums; }
.alt-row { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line-soft); font-size: 13.5px; }
.alt-row:first-of-type { border-top: 0; }
.alt-row .a-note { margin-left: auto; font-size: 12px; color: var(--text-faint); white-space: nowrap; }

/* ================= activity feed ================= */
.feed { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.frow {
  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 12px;
  padding: 12px 18px; border-top: 1px solid var(--line-soft); align-items: baseline;
}
.frow:first-child { border-top: 0; }
.f-glyph {
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 11px; font-weight: 700; position: relative; top: 3px;
}
.fg-signal { background: var(--alert-bg); color: var(--alert); border: 1px solid var(--alert-border); }
.fg-work { background: var(--active-bg); color: var(--active); border: 1px solid var(--active-border); }
.fg-ask { background: var(--watch-bg); color: var(--watch); border: 1px solid var(--watch-border); }
.fg-done { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-border); }
.fg-info { background: var(--neutral-bg); color: var(--neutral); border: 1px solid var(--neutral-border); }
.f-text { font-size: 13.5px; min-width: 0; }
.f-text .f-who { font-weight: 650; }
.f-text .f-sub { color: var(--text-faint); font-size: 12px; margin-top: 1px; }
.f-time { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
.feed-day {
  padding: 8px 18px 6px; font-family: var(--font-mono); font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint);
  background: var(--surface-2); border-top: 1px solid var(--line-soft);
}
.feed-day:first-child { border-top: 0; }

/* ================= intake ================= */
.intake-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.dropzone {
  border: 1.5px dashed var(--neutral-border); border-radius: 12px; padding: 26px 20px;
  text-align: center; background: var(--surface-2); margin-top: 12px;
}
.dropzone .dz-icon { font-size: 20px; color: var(--text-faint); }
.dropzone .dz-title { font-weight: 650; font-size: 14px; margin-top: 6px; }
.dropzone .dz-sub { font-size: 12.5px; color: var(--text-faint); margin-top: 2px; }
.form-row { margin: 12px 0; }
.form-row .f-label {
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 5px;
}
.form-row .f-input { border: 1px solid var(--border); border-radius: 9px; background: var(--surface); padding: 9px 12px; font-size: 13.5px; color: var(--text); }
.form-row .f-input.placeholder { color: var(--text-faint); }

/* ================= loading / error / empty ================= */
.skeleton {
  border-radius: 10px;
  background: linear-gradient(90deg, var(--surface-2) 25%, #EDEFF2 50%, var(--surface-2) 75%);
  background-size: 400px 100%;
  animation: ns-shimmer 1.8s linear infinite;
  height: 90px;
  margin: 12px 0;
}
.state-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 34px 28px;
  text-align: center;
  margin: 18px 0;
}
.state-panel h2, .state-panel .state-title { margin: 0 0 6px; font-size: 16px; font-weight: 650; }
.state-panel p { margin: 0; color: var(--text-soft); font-size: 13.5px; }
.state-panel .sp-detail { margin-top: 10px; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); }
.state-panel.sp-error, .state-panel.is-error { border-left: 3px solid var(--alert-f); text-align: left; }

/* ================= resolution ================= */
.resolution { border-radius: var(--radius); padding: 18px 20px; border: 1px solid; margin: 16px 0; }
.resolution .res-title { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
.resolution p { margin: 4px 0; }
.resolution.is-full { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok); }
.resolution.is-loss { background: var(--watch-bg); border-color: var(--watch-border); color: var(--watch); }
.resolution.is-escalated { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral); }
.resolution ul { margin: 8px 0 0; padding-left: 20px; }

/* ================= traveller (mobile-first, concierge register) ================= */
.traveller-shell { max-width: 480px; margin: 0 auto; padding: 0 16px 48px; }
.t-topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 2px 10px; }
.t-topbar .brand { font-weight: 700; font-size: 14px; display: flex; align-items: baseline; gap: 7px; }
.t-topbar .brand .mark { color: var(--watch-f); font-size: 12px; }
.t-topbar .tt-right {
  font-family: var(--font-mono); font-size: 10px; color: var(--text-faint);
  letter-spacing: 0.08em; text-transform: uppercase;
}

.t-hero {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  min-height: 210px;
  display: flex;
  align-items: flex-end;
  background: var(--ink);
  box-shadow: var(--shadow);
}
.t-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.t-hero .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(16, 20, 26, 0.05) 30%, rgba(16, 20, 26, 0.72) 100%); }
.t-hero .t-hero-text { position: relative; padding: 18px 20px 16px; color: #FFFFFF; width: 100%; text-shadow: 0 1px 10px rgba(10, 12, 16, 0.55); }
.t-hero .hero-kicker {
  margin: 0 0 5px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #E8B95F;
  display: flex;
  align-items: center;
  gap: 8px;
}
.t-hero .hero-kicker.k-ok { color: #9FD2B4; }
.t-hero .hero-kicker.k-bad { color: #F0926F; }
.t-hero .hero-kicker .badge { margin-left: auto; }
.t-hero h1 { margin: 0 0 5px; font-family: var(--font-serif); font-weight: 400; font-size: 27px; line-height: 1.18; letter-spacing: -0.01em; }
.t-hero p { margin: 0; font-size: 13.5px; color: rgba(255, 255, 255, 0.85); }

/* legacy toned hero (kept for non-photo contexts) */
.hero { border-radius: 16px; padding: 26px 22px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); }
.hero .hero-kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; margin: 0 0 8px; }
.hero h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.25; }
.hero p { margin: 0; color: var(--text-soft); }
.hero.tone-ok { background: var(--ok-bg); border-color: var(--ok-border); }
.hero.tone-watch { background: var(--watch-bg); border-color: var(--watch-border); }
.hero.tone-alert { background: var(--alert-bg); border-color: var(--alert-border); }
.hero.tone-active { background: var(--active-bg); border-color: var(--active-border); }
.hero.tone-done { background: var(--done-bg); border-color: var(--done-border); }
.hero.tone-neutral { background: var(--neutral-bg); border-color: var(--neutral-border); }
.hero.tone-alert .hero-kicker, .hero.tone-alert h1 { color: var(--alert); }
.hero.tone-watch .hero-kicker, .hero.tone-watch h1 { color: var(--watch); }
.hero.tone-active .hero-kicker, .hero.tone-active h1 { color: var(--active); }
.hero.tone-ok .hero-kicker, .hero.tone-ok h1 { color: var(--ok); }
.hero.tone-done .hero-kicker, .hero.tone-done h1 { color: var(--done); }

/* the ink punctuation object: the commitment that must not be missed */
.commit-card { background: var(--ink); color: var(--paper-warm); border-radius: var(--radius); padding: 18px 20px; margin: 16px 0; box-shadow: var(--shadow); }
.commit-card .cc-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #E8B95F;
  margin: 0 0 6px;
}
.commit-card .cc-title { font-family: var(--font-serif); font-size: 19px; line-height: 1.25; margin: 0; }
.commit-card .cc-meta { font-family: var(--font-mono); font-size: 11.5px; color: rgba(244, 240, 230, 0.65); margin: 8px 0 0; font-variant-numeric: tabular-nums; }
.commit-card.is-ok .cc-label { color: #9FD2B4; }

.t-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 16px 18px; margin: 14px 0;
}
.t-card h2 { margin: 0 0 8px; font-size: 15px; font-weight: 650; }
.t-card p { margin: 0 0 6px; font-size: 14px; color: var(--text-soft); }
.t-card p:last-child { margin-bottom: 0; }
.t-card .lead { color: var(--text); font-size: 14.5px; }

.itin-row { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line-soft); font-size: 14px; }
.itin-row:first-of-type { border-top: 0; }
.itin-row .i-ic { font-family: var(--font-mono); font-weight: 700; width: 16px; flex: none; }
.itin-row .i-main { min-width: 0; }
.itin-row .i-title { font-weight: 600; }
.itin-row .i-sub { font-size: 12.5px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.itin-row .i-state {
  margin-left: auto; font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; white-space: nowrap;
}
.itin-row .i-state.s-ok { color: var(--ok); }
.itin-row .i-state.s-bad { color: var(--alert); }
.itin-row .i-state.s-watch { color: var(--watch); }
.itin-row .i-state.s-neutral { color: var(--neutral); }
.itin-row.struck .i-title, .itin-row.struck .i-sub { text-decoration: line-through; color: var(--text-faint); }

/* traveller option cards — the choice screen */
.choice-form { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.choice-form button {
  appearance: none;
  font: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.optcard {
  display: block;
  width: 100%;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  font-family: inherit;
  box-shadow: var(--shadow);
  transition: border-color 150ms ease-out, transform 150ms var(--ease-out), box-shadow 150ms ease-out;
}
.optcard:hover { transform: translateY(-1px); border-color: rgba(20, 23, 28, 0.32); }
button.optcard:active { transform: none; }
button.optcard:focus-visible { outline: 2px solid var(--watch-f); outline-offset: 2px; }
.optcard.opt-reco { box-shadow: var(--shadow), inset 3px 0 0 var(--ok-f); border-color: var(--ok-border); }
.optcard.opt-miss { box-shadow: var(--shadow), inset 3px 0 0 var(--alert-f); }
.optcard .opt-head { display: flex; align-items: center; gap: 10px; }
.optcard .opt-title { font-weight: 650; font-size: 14px; }
.opt-flag {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.07em;
  text-transform: uppercase; border-radius: 999px; padding: 2px 8px; white-space: nowrap;
}
.opt-flag.f-ok { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-border); }
.opt-flag.f-bad { background: var(--alert-bg); color: var(--alert); border: 1px solid var(--alert-border); }
.optcard .opt-route {
  display: flex; align-items: baseline; gap: 8px; margin-top: 8px;
  font-family: var(--font-mono); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.optcard .opt-route .arr { color: var(--text-faint); font-weight: 400; }
.optcard .opt-route .opt-stops { font-size: 11px; color: var(--text-faint); font-weight: 400; margin-left: auto; }
.optcard .opt-note { margin-top: 8px; font-size: 12.5px; color: var(--text-soft); }
.optcard .opt-note.n-ok { color: var(--ok); }
.optcard .opt-note.n-bad { color: var(--alert); }
.opt-note strong { font-weight: 650; }

/* plain fallback buttons when no rich option detail exists */
.choice-form button.plain-choice {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  border-radius: 12px;
  padding: 14px 16px;
  min-height: 48px;
  transition: background-color 150ms ease-out, border-color 150ms ease-out;
}
.choice-form button.plain-choice:hover { background: var(--surface-2); border-color: rgba(20, 23, 28, 0.32); }

.t-btn {
  display: block;
  width: 100%;
  text-align: center;
  background: var(--ink);
  color: var(--paper);
  border: none;
  border-radius: 12px;
  padding: 13px;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  margin-top: 12px;
  text-decoration: none;
  cursor: pointer;
  box-sizing: border-box;
  transition: filter 150ms ease-out, transform 150ms var(--ease-out);
}
.t-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
.t-btn.secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.t-btn.secondary:hover { filter: none; background: var(--surface-2); }
.t-btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
.t-btn.ghost:hover { filter: none; background: var(--surface-2); }
.choice-note { font-size: 12.5px; color: var(--text-faint); margin: 10px 2px 0; }

/* chat composer + thread */
.composer {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
  padding: 10px 8px 10px 18px; margin-top: 16px; box-shadow: var(--shadow);
}
.composer .c-placeholder { color: var(--text-faint); font-size: 13.5px; flex: 1; }
.composer .c-input { flex: 1; border: 0; background: transparent; font: inherit; font-size: 13.5px; color: var(--text); outline: none; min-width: 0; }
.composer .c-input::placeholder { color: var(--text-faint); }
.composer .c-send {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--ink); color: var(--paper);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; flex: none; border: 0; cursor: pointer;
  transition: filter 150ms ease-out;
}
.composer .c-send:hover { filter: brightness(1.25); }
.thread { display: flex; flex-direction: column; gap: 10px; margin: 14px 0; }
.msg { max-width: 86%; border-radius: 14px; padding: 10px 14px; font-size: 13.5px; line-height: 1.45; }
.msg .m-meta { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 4px; opacity: 0.65; }
.msg.from-ns { background: var(--surface); border: 1px solid var(--border); align-self: flex-start; border-bottom-left-radius: 4px; }
.msg.from-ns .m-meta { color: var(--watch); }
.msg.from-me { background: var(--ink); color: var(--paper); align-self: flex-end; border-bottom-right-radius: 4px; }
.t-foot { text-align: center; font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); margin-top: 18px; font-variant-numeric: tabular-nums; }

/* viability block — the honest "rest of trip" answer */
.viab { border-radius: 12px; padding: 12px 16px; margin: 14px 0; font-size: 13.5px; border: 1px solid; }
.viab.v-ok { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok); }
.viab.v-watch { background: var(--watch-bg); border-color: var(--watch-border); color: var(--watch); }
.viab.v-bad { background: var(--alert-bg); border-color: var(--alert-border); color: var(--alert); }
.viab.v-neutral { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral); }
.viab strong { font-weight: 700; }

/* ================= traveller request composer (legacy form block) ================= */
.request-composer { padding: 20px; }
.request-composer h2 { font-family: var(--font-serif); font-size: 21px; margin-bottom: 5px; }
.request-form { display: grid; gap: 9px; margin-top: 16px; }
.request-form label { font-size: 12px; font-weight: 650; color: var(--text-soft); }
.request-form textarea { resize: vertical; min-height: 88px; width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); color: var(--text); padding: 12px 13px; font: inherit; line-height: 1.45; }
.request-form textarea:focus { outline: 2px solid var(--watch-f); outline-offset: 2px; border-color: transparent; background: var(--surface); }
.form-result { display: none; margin-top: 12px; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
.form-result.is-success { display: block; color: var(--ok); background: var(--ok-bg); border: 1px solid var(--ok-border); }
.form-result.is-error { display: block; color: var(--watch); background: var(--watch-bg); border: 1px solid var(--watch-border); }

/* ================= planning transition ================= */
.planning-kicker, .composer-kicker {
  margin: 0 0 5px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.planning-result-title { margin: 0 0 7px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.recovery-actions > p:not(.planning-kicker):not(.planning-result-title):not(.planning-next) { color: var(--text-soft); max-width: 760px; }
.recovery-actions form { margin-top: 15px; }
.planning-progress { padding: 4px 0; }
.planning-progress ol { list-style: none; margin: 16px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; counter-reset: stages; }
.planning-progress li { counter-increment: stages; border: 1px solid var(--line-soft); border-radius: 10px; padding: 12px; font-size: 12.5px; color: var(--text-soft); background: var(--surface-2); }
.planning-progress li::before { content: counter(stages, decimal-leading-zero); display: block; margin-bottom: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--active); }
.planning-skeleton { height: 4px; margin-top: 14px; border-radius: 999px; background: linear-gradient(90deg, var(--active-bg) 20%, var(--ink) 50%, var(--active-bg) 80%); background-size: 220px 100%; animation: ns-shimmer 1.4s linear infinite; }
.planning-progress[data-state="complete"] .planning-skeleton { background: var(--ok-f); animation: none; }
.planning-checks { list-style: none; padding: 0; margin: 16px 0; display: grid; gap: 10px; }
.planning-checks li { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: start; }
.planning-checks li > span:first-child { color: var(--ok); font-family: var(--font-mono); font-weight: 700; }
.planning-checks strong, .planning-checks small { display: block; }
.planning-checks small { margin-top: 2px; color: var(--text-soft); font-size: 12.5px; }
.planning-next { border-top: 1px solid var(--line-soft); padding-top: 13px; color: var(--text-soft); }
.funding-panel { border-left: 3px solid var(--watch-f); }
.funding-callout { margin-top: 10px; padding: 12px 14px; border-radius: 10px; background: var(--surface-2); }
.funding-callout p { margin: 0 0 6px; }
.funding-callout .footnote { margin: 0; }

/* ================= responsive ================= */
@media (max-width: 900px) {
  .readout { grid-template-columns: 1fr; }
  .case-grid { grid-template-columns: 1fr; }
  .case-rail { position: static; }
  .intake-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .shell { padding: 20px 14px 48px; }
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .trip-grid { grid-template-columns: 1fr; }
  .qrow, .brow { grid-template-columns: 20px minmax(0, 1fr) auto; }
  .q-issue, .b-issue { grid-column: 2 / -1; white-space: normal; }
  .brow .b-right { align-items: flex-start; }
  .topbar { padding: 10px 14px; gap: 12px; }
  .readout-ink .big { font-size: 52px; }
  .topbar .brand small { display: none; }
  .topbar nav a { padding: 6px 8px; font-size: 12px; }
  .planning-progress ol { grid-template-columns: 1fr 1fr; }
}

/* ================= demo banner (dev-only safety strip) ================= */
.demo-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  flex-wrap: nowrap;
  border-bottom: 1px solid;
}
.demo-banner.db-replay {
  background: #E9F2EC;
  color: #2F6B47;
  border-bottom-color: #BFD9C9;
}
.demo-banner.db-live {
  background: #FBEDE7;
  color: #C2431A;
  border-bottom-color: #EFC0B2;
}
.db-mode {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.db-note { color: inherit; opacity: 0.85; }
.db-link {
  color: inherit;
  text-decoration: underline;
  font-weight: 600;
}
@media (max-width: 720px) {
  .demo-banner { padding: 6px 14px; }
  .demo-banner .db-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}

/* ================= demo control panel (dev-only) ================= */
.demo-shell { max-width: 780px; margin: 0 auto; padding: 28px 24px 64px; }
.demo-shell h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
.demo-shell .demo-sub { color: var(--text-soft); margin: 0 0 20px; }
.demo-section { margin: 24px 0 16px; }
.demo-section h2 {
  font-size: 15px; font-weight: 650; margin: 0 0 10px;
  display: flex; align-items: baseline; gap: 8px;
}
.demo-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px 18px;
  margin: 10px 0;
}
.demo-card h3 { margin: 0 0 4px; font-size: 14px; font-weight: 650; }
.demo-card .dc-note { font-size: 12.5px; color: var(--text-soft); margin: 0 0 10px; }
.demo-card .dc-meta {
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 10px;
}
.dc-meta.m-local { color: var(--ok); }
.dc-meta.m-replay { color: var(--watch); }
.dc-meta.m-external { color: var(--alert); }
.dc-meta.m-side-effect { color: var(--alert); }
.demo-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 150ms ease-out, border-color 150ms ease-out;
}
.demo-btn:hover { background: var(--bg); border-color: rgba(20, 23, 28, 0.32); }
.demo-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.demo-btn.danger { border-color: var(--alert-border); color: var(--alert); background: var(--alert-bg); }
.demo-btn.danger:hover { border-color: var(--alert); }
.demo-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.demo-links a {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  color: var(--text);
  background: var(--surface);
  transition: background-color 150ms ease-out;
}
.demo-links a:hover { background: var(--surface-2); }
.demo-result {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.demo-result.dr-ok { background: var(--ok-bg); border: 1px solid var(--ok-border); color: var(--ok); }
.demo-result.dr-err { background: var(--alert-bg); border: 1px solid var(--alert-border); color: var(--alert); }
.demo-safety {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  margin: 20px 0;
}
.demo-safety h2 { margin: 0 0 10px; }
.demo-safety table { width: 100%; border-collapse: collapse; font-size: 13px; }
.demo-safety th {
  text-align: left; font-family: var(--font-mono); font-size: 10.5px;
  font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--text-faint); padding: 6px 8px; border-bottom: 1px solid var(--border);
}
.demo-safety td { padding: 6px 8px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.demo-safety .s-local { color: var(--ok); font-weight: 600; }
.demo-safety .s-replay { color: var(--watch); font-weight: 600; }
.demo-safety .s-external { color: var(--alert); font-weight: 600; }
.demo-config {
  margin-top: 20px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--alert-bg);
  border: 1px solid var(--alert-border);
  font-size: 12.5px;
  color: var(--alert);
}
.demo-config strong { font-weight: 700; }
.demo-config code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: rgba(194, 67, 26, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
}

/* Visually hidden but available to assistive tech / form labels. */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
`;
