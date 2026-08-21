/**
 * E2 — visual theme, inlined per page so previews are self-contained and the
 * integrator can serve them without a static-asset pipeline.
 *
 * Design intent: an operational command surface, not a chatbot. Strong
 * hierarchy, obvious status colour, clean cards, responsive down to the
 * mobile traveller layout. No gradients-for-fashion, no fake terminals.
 */
export const THEME_CSS = `
:root {
  --bg: #f2f4f7;
  --surface: #ffffff;
  --border: #e3e8ef;
  --text: #16202e;
  --text-soft: #55606f;
  --text-faint: #8b94a3;
  --ink: #101826;
  --brand: #1d4ed8;

  --ok: #18794e;          --ok-bg: #e6f4ec;      --ok-border: #b5dcc5;
  --watch: #92600a;       --watch-bg: #fdf3d7;   --watch-border: #eed9a0;
  --alert: #b42318;       --alert-bg: #fdeceb;   --alert-border: #f3b8b3;
  --active: #175cd3;      --active-bg: #e8f0fc;  --active-border: #b6cff5;
  --done: #0e7090;        --done-bg: #e0f2f7;    --done-border: #a9dbe8;
  --neutral: #475467;     --neutral-bg: #eef1f5; --neutral-border: #d5dbe4;

  --radius: 12px;
  --shadow: 0 1px 2px rgb(16 24 40 / 0.06);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}

/* ------- top bar / navigation ------- */
.topbar {
  background: var(--ink);
  color: #f5f7fa;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.topbar .brand { font-weight: 700; letter-spacing: 0.2px; }
.topbar .brand small {
  display: block;
  font-weight: 400;
  font-size: 11px;
  color: #98a2b3;
  letter-spacing: 0.4px;
}
.topbar nav { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.topbar nav a {
  color: #d7dde6;
  text-decoration: none;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
}
.topbar nav a:hover { background: rgb(255 255 255 / 0.08); }
.topbar nav a.is-active { background: rgb(255 255 255 / 0.14); color: #ffffff; }

.shell { max-width: 1180px; margin: 0 auto; padding: 28px 24px 56px; }

.page-head { margin-bottom: 20px; }
.page-head h1 { margin: 0 0 4px; font-size: 26px; line-height: 1.2; }
.page-head .sub { margin: 0; color: var(--text-soft); }
.page-head .meta { margin-top: 6px; font-size: 12px; color: var(--text-faint); }

/* ------- summary tiles ------- */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 12px;
  margin: 20px 0 28px;
}
.tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--neutral-border);
  border-radius: var(--radius);
  padding: 14px 16px;
  box-shadow: var(--shadow);
}
.tile .tile-count { font-size: 30px; font-weight: 700; line-height: 1.1; }
.tile .tile-label { font-size: 13px; color: var(--text-soft); margin-top: 2px; }
.tile.tone-ok { border-left-color: var(--ok); }
.tile.tone-watch { border-left-color: var(--watch); }
.tile.tone-alert { border-left-color: var(--alert); }
.tile.tone-active { border-left-color: var(--active); }
.tile.tone-done { border-left-color: var(--done); }
.tile.tone-neutral { border-left-color: var(--neutral-border); }
.tile.is-attention { outline: 2px solid var(--alert-border); }

/* ------- cards & panels ------- */
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
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-soft);
}
.section { margin: 26px 0 12px; }
.section > h2 {
  margin: 0 0 12px;
  font-size: 18px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text);
}

.trip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 16px;
}
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-title { margin: 0; font-size: 16px; font-weight: 700; }
.card-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-soft); }
.card .kv { margin-top: 12px; }
.kv-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-faint);
  margin: 0 0 4px;
}
.card-foot { margin-top: 14px; font-size: 12px; color: var(--text-faint); }

/* ------- badges & chips ------- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}
.badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.badge.tone-ok { color: var(--ok); background: var(--ok-bg); border-color: var(--ok-border); }
.badge.tone-watch { color: var(--watch); background: var(--watch-bg); border-color: var(--watch-border); }
.badge.tone-alert { color: var(--alert); background: var(--alert-bg); border-color: var(--alert-border); }
.badge.tone-active { color: var(--active); background: var(--active-bg); border-color: var(--active-border); }
.badge.tone-done { color: var(--done); background: var(--done-bg); border-color: var(--done-border); }
.badge.tone-neutral { color: var(--neutral); background: var(--neutral-bg); border-color: var(--neutral-border); }
.chip {
  display: inline-block;
  border-radius: 6px;
  padding: 1px 8px;
  font-size: 12px;
  font-weight: 600;
  background: var(--neutral-bg);
  color: var(--neutral);
  border: 1px solid var(--neutral-border);
}
.chip.chip-extra { background: var(--watch-bg); color: var(--watch); border-color: var(--watch-border); }
.chip.chip-saving { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-border); }

/* ------- lists ------- */
.plain-list { margin: 0; padding-left: 18px; }
.plain-list li { margin: 4px 0; }
.plain-list li::marker { color: var(--text-faint); }
.icon-list { list-style: none; margin: 0; padding: 0; }
.icon-list li { display: flex; gap: 8px; align-items: baseline; margin: 5px 0; }
.icon-list .ic { flex: none; font-weight: 700; }
.ic-pass { color: var(--ok); }
.ic-fail { color: var(--alert); }
.ic-unknown { color: var(--watch); }
.ic-queue { color: var(--text-faint); }
.ic-progress { color: var(--active); }

/* ------- callouts ------- */
.callout {
  border: 1px solid var(--border);
  border-left: 4px solid var(--neutral-border);
  border-radius: 10px;
  padding: 12px 16px;
  background: var(--surface);
  margin: 10px 0;
}
.callout.tone-alert { border-left-color: var(--alert); background: var(--alert-bg); }
.callout.tone-watch { border-left-color: var(--watch); background: var(--watch-bg); }
.callout.tone-active { border-left-color: var(--active); background: var(--active-bg); }
.callout.tone-ok { border-left-color: var(--ok); background: var(--ok-bg); }
.callout .callout-title { font-weight: 700; margin: 0 0 2px; }
.callout p { margin: 0; }

/* ------- options (case detail) ------- */
.option-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  margin: 10px 0;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.option-card.is-recommended { border-color: var(--active-border); outline: 1px solid var(--active-border); }
.option-card.is-rejected { background: #fafbfc; }
.option-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.option-title { margin: 0; font-size: 15px; font-weight: 700; }
.option-summary { margin: 6px 0 0; color: var(--text-soft); font-size: 14px; }
.option-meta { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.rejection {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--alert-bg);
  border: 1px solid var(--alert-border);
  color: var(--alert);
  font-size: 14px;
}

/* ------- stepper ------- */
.stepper { display: flex; gap: 0; margin: 18px 0 6px; flex-wrap: wrap; }
.step {
  flex: 1 1 0;
  min-width: 120px;
  position: relative;
  padding: 0 10px 0 30px;
  font-size: 12px;
  color: var(--text-faint);
}
.step::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--neutral-border);
}
.step.is-done { color: var(--text-soft); }
.step.is-done::before { background: var(--ok); border-color: var(--ok); }
.step.is-current { color: var(--text); font-weight: 700; }
.step.is-current::before { background: var(--active-bg); border-color: var(--active); box-shadow: 0 0 0 4px var(--active-bg); }

/* ------- loading / error / empty ------- */
.state-panel { text-align: center; padding: 48px 24px; }
.state-panel .state-title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
.state-panel p { margin: 0; color: var(--text-soft); }
.state-panel.is-error { border-color: var(--alert-border); }
.skeleton {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(90deg, #eef1f5 25%, #f7f9fb 50%, #eef1f5 75%);
  height: 90px;
  margin: 12px 0;
}
.empty-note { color: var(--text-faint); font-style: italic; margin: 0; }

/* ------- resolution ------- */
.resolution { border-radius: var(--radius); padding: 18px 20px; border: 1px solid; margin: 16px 0; }
.resolution .res-title { margin: 0 0 6px; font-size: 17px; font-weight: 800; }
.resolution p { margin: 4px 0; }
.resolution.is-full { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok); }
.resolution.is-loss { background: var(--watch-bg); border-color: var(--watch-border); color: var(--watch); }
.resolution.is-escalated { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral); }
.resolution ul { margin: 8px 0 0; padding-left: 20px; }

/* ------- traveller (mobile-first) ------- */
.traveller-shell { max-width: 480px; margin: 0 auto; padding: 20px 16px 56px; }
.hero {
  border-radius: 16px;
  padding: 26px 22px;
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
}
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
.t-card { margin-top: 14px; }
.choice-form { margin-top: 12px; display: grid; gap: 10px; }
.choice-form button {
  appearance: none;
  border: 1px solid var(--active-border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  text-align: left;
  border-radius: 12px;
  padding: 14px 16px;
  min-height: 48px;
  cursor: pointer;
}
.choice-form button:hover { background: var(--active-bg); }
.choice-note { font-size: 12px; color: var(--text-faint); margin: 4px 0 0; }
.t-foot { margin-top: 22px; text-align: center; font-size: 12px; color: var(--text-faint); }

.footnote { margin-top: 32px; font-size: 12px; color: var(--text-faint); }

@media (max-width: 720px) {
  .shell { padding: 20px 14px 48px; }
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .trip-grid { grid-template-columns: 1fr; }
  .step { min-width: 46%; margin-bottom: 10px; }
}
`;
