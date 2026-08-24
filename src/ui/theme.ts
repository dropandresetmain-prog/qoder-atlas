/**
 * E2 — visual theme, inlined per page so previews are self-contained and the
 * integrator can serve them without a static-asset pipeline.
 *
 * Design system: "cockpit daylight × concierge" — see docs/DESIGN.md.
 * One shared light surface for operator and traveller; chromatic colour is
 * reserved for state (green confirmed · brass proposed/waiting · vermilion
 * broken/decide · grey unknown/unbooked · ink = system working). Motion is
 * CSS-only: entry stagger, the "settle" state-change flicker, ≤200ms
 * interaction transitions, and a full prefers-reduced-motion kill switch.
 *
 * Legacy class names from the first theme are preserved so every screen and
 * test hook keeps working; new components (readout, fleet grid, chain,
 * commitment card, option cards) are additive.
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
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--watch-bg); }

/* ================= motion primitives ================= */
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
.just-changed { animation: ns-changed 1.6s ease-out both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ================= top bar ================= */
.topbar {
  background: var(--surface);
  color: var(--text);
  padding: 0 24px;
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}
.topbar .brand { font-weight: 700; font-size: 15px; letter-spacing: 0.1px; display: flex; align-items: baseline; gap: 8px; }
.topbar .brand .mark { color: var(--watch-f); font-size: 13px; }
.topbar .brand small {
  font-weight: 400;
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.topbar nav { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.topbar nav a {
  color: var(--text-soft);
  text-decoration: none;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
  transition: background-color 150ms ease-out, color 150ms ease-out;
}
.topbar nav a:hover { background: var(--surface-2); color: var(--text); }
.topbar nav a.is-active { background: var(--ink); color: var(--paper); }

/* ================= page scaffold ================= */
.shell { max-width: 1180px; margin: 0 auto; padding: 28px 24px 64px; }

.page-head { margin-bottom: 20px; }
.page-head h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
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

.trip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }

/* ================= summary tiles ================= */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 12px; margin: 20px 0 28px; }
.tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--neutral-border);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
}
.tile .tile-count { font-family: var(--font-mono); font-size: 28px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile .tile-label { font-size: 12.5px; color: var(--text-soft); margin-top: 2px; }
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
.ic-progress { color: var(--active); }

/* ================= callouts ================= */
.callout {
  border: 1px solid var(--border);
  border-left: 3px solid var(--neutral-border);
  border-radius: 10px;
  padding: 12px 16px;
  background: var(--surface);
  margin: 10px 0;
}
.callout.tone-alert { border-left-color: var(--alert-f); background: var(--alert-bg); }
.callout.tone-watch { border-left-color: var(--watch-f); background: var(--watch-bg); }
.callout.tone-active { border-left-color: var(--active-border); background: var(--active-bg); }
.callout.tone-ok { border-left-color: var(--ok-f); background: var(--ok-bg); }
.callout .callout-title { font-weight: 650; margin: 0 0 2px; }
.callout p { margin: 0; }

/* ================= operator readout + fleet grid ================= */
.readout { display: grid; grid-template-columns: minmax(300px, 380px) 1fr; gap: 16px; margin: 22px 0 8px; align-items: stretch; }
.readout-ink { background: var(--ink); color: var(--paper); border-radius: var(--radius); padding: 22px 24px; display: flex; flex-direction: column; justify-content: center; }
.ri-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(245, 246, 247, 0.55);
}
.readout-ink .big {
  font-family: var(--font-mono);
  font-size: 64px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin-top: 10px;
}
.readout-ink .big .unit { font-size: 22px; font-weight: 500; color: rgba(245, 246, 247, 0.45); }
.readout-ink .sub { margin-top: 12px; font-size: 13.5px; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.readout-ink .sub .dot { color: rgba(245, 246, 247, 0.35); }
.seg-ok { color: #8FD0A6; }
.seg-warn { color: #E8B95F; }
.seg-bad { color: #F0764D; }
.seg-dim { color: rgba(245, 246, 247, 0.55); }

.readout-fleet { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow); }
.fc-head { display: flex; justify-content: space-between; align-items: baseline; font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint); }
.fc-live { color: var(--ok); display: inline-flex; align-items: center; gap: 6px; }
.fc-live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ok-f); animation: ns-breathe 2.4s ease-in-out infinite; }
.dotgrid { display: grid; grid-template-columns: repeat(auto-fill, 19px); gap: 2px; margin: 14px 0 12px; }
.dotgrid i { width: 19px; height: 19px; display: flex; align-items: center; justify-content: center; }
.dotgrid i::before { content: ""; width: 11px; height: 11px; border-radius: 3px; background: var(--neutral-f); }
.dotgrid i.d-ok::before { background: var(--ok-f); }
.dotgrid i.d-watch::before { background: var(--watch-f); }
.dotgrid i.d-bad::before { background: var(--alert-f); }
.dotgrid i.d-active::before { background: var(--active-f); }
.dotgrid i.d-empty::before { background: transparent; box-shadow: inset 0 0 0 1.5px var(--neutral-f); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.04em; color: var(--text-faint); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.legend .l-ok { background: var(--ok-f); }
.legend .l-watch { background: var(--watch-f); }
.legend .l-bad { background: var(--alert-f); }
.legend .l-active { background: var(--active-f); }
.legend .l-empty { box-shadow: inset 0 0 0 1.5px var(--neutral-f); }

/* ================= queue + roster rows ================= */
.queue, .board { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
.qrow, .brow {
  display: grid;
  gap: 12px;
  align-items: baseline;
  padding: 12px 18px;
  border-top: 1px solid var(--line-soft);
  transition: background-color 150ms ease-out;
}
.qrow:first-child, .brow:first-child { border-top: none; }
.qrow { grid-template-columns: 20px minmax(130px, 0.9fr) minmax(0, 2.2fr) auto; }
.brow { grid-template-columns: 16px minmax(120px, 0.9fr) minmax(0, 2.2fr) auto; align-items: center; }
.qrow > div, .brow > div { min-width: 0; }
.brow .b-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.qrow:hover, .brow:hover { background: var(--surface-2); }
.q-glyph { font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
.g-bad { color: var(--alert); }
.g-warn { color: var(--watch); }
.g-unk { color: var(--neutral); }
.q-name, .b-name { font-weight: 650; font-size: 14px; }
.q-issue, .b-issue { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-time, .b-time { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); white-space: nowrap; font-variant-numeric: tabular-nums; }
.b-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--neutral-f); }
.b-dot.d-ok { background: var(--ok-f); }
.b-dot.d-watch { background: var(--watch-f); }
.b-dot.d-bad { background: var(--alert-f); }
.b-dot.d-active { background: var(--active-f); }
.b-dot.d-empty { background: transparent; box-shadow: inset 0 0 0 1.5px var(--neutral-f); }
.brow .b-extra { font-size: 12px; color: var(--text-faint); }

/* ================= journey chain (case view) ================= */
.chain { display: flex; flex-wrap: wrap; gap: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.chain .link { flex: 1 1 130px; min-width: 120px; padding: 14px 16px 12px; border-top: 3px solid var(--neutral-f); position: relative; }
.chain .link + .link { border-left: 1px solid var(--line-soft); }
.chain .link.st-confirmed { border-top: 3px solid var(--ok-f); }
.chain .link.st-atrisk { border-top: 3px solid var(--watch-f); }
.chain .link.st-proposed { border-top: 3px dashed var(--watch-f); }
.chain .link.st-broken { border-top: 3px solid var(--alert-f); }
.chain .link.st-unbooked { border-top: 3px dotted var(--neutral-f); }
.chain .link.st-unknown { border-top: 3px dotted var(--neutral-f); }
.chain .l-kind { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint); display: flex; gap: 6px; align-items: baseline; }
.chain .l-glyph { font-size: 11px; }
.chain .st-confirmed .l-glyph { color: var(--ok); }
.chain .st-atrisk .l-glyph, .chain .st-proposed .l-glyph { color: var(--watch); }
.chain .st-broken .l-glyph { color: var(--alert); }
.chain .st-unbooked .l-glyph, .chain .st-unknown .l-glyph { color: var(--neutral); }
.chain .l-name { font-weight: 650; font-size: 13.5px; margin-top: 6px; line-height: 1.3; }
.chain .l-detail { font-size: 12px; color: var(--text-soft); margin-top: 2px; }
.chain .l-state { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.04em; margin-top: 8px; text-transform: uppercase; }
.chain .st-confirmed .l-state { color: var(--ok); }
.chain .st-atrisk .l-state, .chain .st-proposed .l-state { color: var(--watch); }
.chain .st-broken .l-state { color: var(--alert); }
.chain .st-unbooked .l-state, .chain .st-unknown .l-state { color: var(--neutral); }
.chain .link.is-commitment { background: var(--surface-2); }
.chain .is-commitment .l-kind { color: var(--watch); }

/* ================= options (case detail) ================= */
.option-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  margin: 10px 0;
  background: var(--surface);
  box-shadow: var(--shadow);
  transition: border-color 150ms ease-out, transform 150ms ease-out;
}
.option-card:hover { transform: translateY(-1px); }
.option-card.is-recommended { box-shadow: inset 3px 0 0 var(--ok-f), var(--shadow); }
.option-card.is-rejected { box-shadow: inset 3px 0 0 var(--alert-f), var(--shadow); }
.option-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.option-title { margin: 0; font-size: 15px; font-weight: 650; }
.option-summary { margin: 6px 0 0; color: var(--text-soft); font-size: 14px; }
.option-meta { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.rejection {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--alert-bg);
  border: 1px solid var(--alert-border);
  color: var(--alert);
  font-size: 13.5px;
}

/* ================= stepper ================= */
.stepper { display: flex; gap: 0; margin: 18px 0 6px; flex-wrap: wrap; }
.step {
  flex: 1 1 0;
  min-width: 120px;
  position: relative;
  padding: 0 10px 0 30px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.step::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--neutral-border);
}
.step.is-done { color: var(--text-soft); }
.step.is-done::before { background: var(--ok-f); border-color: var(--ok-f); }
.step.is-current { color: var(--text); font-weight: 700; }
.step.is-current::before { background: var(--surface); border-color: var(--ink); box-shadow: 0 0 0 4px var(--active-bg); }

/* ================= loading / error / empty ================= */
.state-panel { text-align: center; padding: 48px 24px; }
.state-panel .state-title { font-size: 17px; font-weight: 650; margin: 0 0 6px; }
.state-panel p { margin: 0; color: var(--text-soft); }
.state-panel.is-error { border-color: var(--alert-border); }
.skeleton {
  border-radius: 10px;
  border: 1px solid var(--line-soft);
  background: linear-gradient(90deg, var(--neutral-bg) 25%, var(--surface) 50%, var(--neutral-bg) 75%);
  background-size: 400px 100%;
  animation: ns-shimmer 1.8s linear infinite;
  height: 90px;
  margin: 12px 0;
}
.empty-note { color: var(--text-faint); font-style: italic; margin: 0; }

/* ================= resolution ================= */
.resolution { border-radius: var(--radius); padding: 18px 20px; border: 1px solid; margin: 16px 0; }
.resolution .res-title { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
.resolution p { margin: 4px 0; }
.resolution.is-full { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok); }
.resolution.is-loss { background: var(--watch-bg); border-color: var(--watch-border); color: var(--watch); }
.resolution.is-escalated { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral); }
.resolution ul { margin: 8px 0 0; padding-left: 20px; }

/* ================= tables ================= */
.table-wrap { overflow-x: auto; }
.traveller-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 560px; }
.traveller-table th {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.traveller-table td { padding: 9px 10px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.traveller-table tbody tr { transition: background-color 150ms ease-out; }
.traveller-table tbody tr:hover td { background: var(--surface-2); }
.traveller-table td { font-variant-numeric: tabular-nums; }

/* ================= traveller (mobile-first, concierge register) ================= */
.traveller-shell { max-width: 460px; margin: 0 auto; padding: 20px 16px 56px; }

.t-hero {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  min-height: 196px;
  display: flex;
  align-items: flex-end;
  background: linear-gradient(160deg, #2A3240 0%, var(--ink) 70%);
  box-shadow: var(--shadow);
}
.t-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.t-hero .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10, 12, 16, 0) 30%, rgba(10, 12, 16, 0.74) 100%); }
.t-hero .t-hero-text { position: relative; padding: 20px; color: #FFFFFF; width: 100%; text-shadow: 0 1px 10px rgba(10, 12, 16, 0.55); }
.t-hero .hero-kicker {
  margin: 0 0 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #E8B95F;
  display: flex;
  align-items: center;
  gap: 8px;
}
.t-hero .hero-kicker .badge { margin-left: auto; }
.t-hero h1 { margin: 0 0 6px; font-family: var(--font-serif); font-size: 27px; font-weight: 600; line-height: 1.15; letter-spacing: -0.01em; }
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
.commit-card { background: var(--ink); color: var(--paper-warm); border-radius: 16px; padding: 18px 20px; margin-top: 14px; box-shadow: var(--shadow); }
.commit-card .cc-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #E8B95F;
  margin: 0 0 6px;
}
.commit-card .cc-title { font-family: var(--font-serif); font-size: 19px; font-weight: 600; line-height: 1.25; margin: 0; }
.commit-card .cc-meta { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 0.04em; color: rgba(244, 240, 230, 0.6); margin: 8px 0 0; font-variant-numeric: tabular-nums; }

.t-card { margin-top: 14px; }

/* traveller option cards — the choice screen */
.choice-form { margin-top: 12px; display: grid; gap: 10px; }
.choice-form button {
  appearance: none;
  font: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
button.optcard {
  display: block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 15px 16px;
  box-shadow: var(--shadow);
  transition: border-color 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out;
}
button.optcard:hover { border-color: rgba(20, 23, 28, 0.32); transform: translateY(-1px); }
button.optcard:active { transform: none; }
button.optcard:focus-visible { outline: 2px solid var(--watch-f); outline-offset: 2px; }
button.optcard.opt-reco { box-shadow: inset 3px 0 0 var(--ok-f), var(--shadow); }
button.optcard.opt-miss { box-shadow: inset 3px 0 0 var(--alert-f), var(--shadow); }
.opt-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.opt-title { font-size: 15px; font-weight: 650; }
.opt-flag { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
.opt-flag.f-ok { color: var(--ok); }
.opt-flag.f-bad { color: var(--alert); }
.opt-route { display: flex; align-items: baseline; gap: 10px; margin-top: 8px; font-family: var(--font-mono); font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
.opt-route .arr { color: var(--text-faint); font-weight: 400; font-size: 14px; }
.opt-route .opt-stops { margin-left: auto; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; color: var(--text-faint); text-transform: uppercase; }
.opt-note { font-size: 12.5px; margin-top: 8px; color: var(--text-soft); }
.opt-note strong { font-weight: 650; }
.opt-note.n-ok { color: var(--ok); }
.opt-note.n-bad { color: var(--alert); }

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
  background: var(--ink);
  color: var(--paper);
  border: none;
  border-radius: 12px;
  padding: 14px;
  font: inherit;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  transition: filter 150ms ease-out, transform 150ms ease-out;
}
.t-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
.t-btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
.t-btn.ghost:hover { filter: none; background: var(--surface-2); }

.choice-note { font-size: 12px; color: var(--text-faint); margin: 4px 0 0; }
.t-foot { margin-top: 22px; text-align: center; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: var(--text-faint); }

.footnote { margin-top: 32px; font-size: 12px; color: var(--text-faint); }

/* ================= responsive ================= */
@media (max-width: 980px) {
  .readout { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .shell { padding: 20px 14px 48px; }
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .trip-grid { grid-template-columns: 1fr; }
  .step { min-width: 46%; margin-bottom: 10px; }
  .qrow, .brow { grid-template-columns: 20px minmax(0, 1fr) auto; }
  .q-issue, .b-issue { grid-column: 2 / -1; white-space: normal; }
  .brow .b-right { align-items: flex-start; }
  .chain .link { flex-basis: 46%; }
  .chain .link + .link { border-left: none; }
  .topbar { padding: 10px 14px; gap: 12px; }
  .readout-ink .big { font-size: 52px; }
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
  flex-wrap: wrap;
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
`;
