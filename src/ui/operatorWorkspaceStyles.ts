/** A3 layout only. Reuses the existing tokens; does not change graph semantics. */
export const OPERATOR_WORKSPACE_STYLES = `<style data-operator-workspace-styles>
.product-recovery-case.case-workspace, .product-operator-overview { max-width: 1480px; width: calc(100% - 48px); margin-left: auto; margin-right: auto; }
.case-workspace { font-size: 16px; line-height: 1.55; }
.case-workspace .page-head h1 { font-size: 30px; }
.case-workspace .case-decision-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 28px; align-items: start; margin: 8px 0 28px; }
.case-workspace .case-decision-main, .case-workspace .case-decision-rail, .case-workspace .case-follow { min-width: 0; }
.case-workspace .case-decision-rail { position: sticky; top: 72px; max-height: calc(100vh - 96px); overflow: auto; }
.case-workspace .section { margin: 0 0 24px; }
.case-workspace .section h2 { font-size: 19px; margin: 0 0 12px; }
.case-workspace .panel, .case-workspace .cw-card { padding: 20px; }
.case-workspace .cw-card { border: 1px solid var(--border); border-radius: var(--radius, 14px); background: var(--surface); }
.case-workspace .cw-card h3 { margin: 0 0 10px; font-size: 18px; line-height: 1.4; }
.case-workspace .cw-card h4 { margin: 0 0 6px; font-size: 15px; }
.case-workspace .cw-card p { margin: 6px 0; }
.case-workspace .cw-lead { margin-bottom: 20px; }
.case-workspace .cw-lead .callout { padding: 18px 22px; }
.case-workspace .cw-lead h2 { margin: 0 0 6px; font-size: 20px; }
.case-workspace .cw-lead p { font-size: 16px; max-width: 90ch; }
.case-workspace .cw-status-hint { font-size: 13px; color: var(--text-soft); }
.case-workspace .cw-status-hint a { font-weight: 650; }
.case-workspace .cw-muted, .case-workspace .graph-caption { color: var(--text-soft); font-size: 13px; }
.case-workspace .cw-kicker { color: var(--text-soft); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.case-workspace .cw-rec { border-left: 4px solid var(--ok-f); }
.case-workspace .cw-rec > h3 { font-size: 23px; }
.case-workspace .cw-block { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line-soft); }
.case-workspace .cw-itinerary { display: grid; gap: 12px; }
.case-workspace .cw-itinerary > article { background: var(--surface-2, var(--paper-warm)); border-radius: 10px; padding: 14px 16px; }
.case-workspace .cw-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.case-workspace .cw-times dt { color: var(--text-soft); font-size: 12px; }
.case-workspace .cw-times dd { margin: 0; font-weight: 600; font-size: 14px; }
.case-workspace .cw-compact-list { margin: 8px 0; padding-left: 20px; }
.case-workspace .cw-compact-list li { margin: 6px 0; }
.case-workspace .cw-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.case-workspace .cw-metric { padding: 12px; border: 1px solid var(--line-soft); border-radius: 10px; }
.case-workspace .cw-metric small { display: block; color: var(--text-soft); font-size: 11px; font-weight: 800; letter-spacing: 0.06em; }
.case-workspace .cw-metric strong { display: block; font-size: 19px; font-variant-numeric: tabular-nums; margin-top: 4px; }
.case-workspace .cw-metric-note { display: block; margin-top: 6px; color: var(--text-soft); font-size: 12px; line-height: 1.35; }
.case-workspace .cw-metric-spend { border-color: var(--ok-border, #b7d9c8); background: var(--ok-bg, #f3faf6); }
.case-workspace .cw-metric-exposure { border-style: dashed; border-color: var(--watch-border, #edc477); background: var(--watch-bg, #fff8ea); }
.case-workspace .cw-metric-exposure strong { color: var(--watch, #a56800); }
.case-workspace .cw-cost-table, .case-workspace .cw-research-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
.case-workspace .cw-cost-table th, .case-workspace .cw-cost-table td,
.case-workspace .cw-research-table th, .case-workspace .cw-research-table td { padding: 9px 5px; border-bottom: 1px solid var(--line-soft); text-align: left; vertical-align: top; }
.case-workspace .cw-cost-table th, .case-workspace .cw-research-table th { color: var(--text-soft); font-weight: 600; }
.case-workspace .cw-approve { background: var(--paper-warm, var(--surface-2)); border: 1px solid var(--watch-border, var(--border)); border-top: 4px solid var(--watch-f); }
.case-workspace .cw-approve .btn { width: 100%; margin-top: 12px; }
.case-workspace button:disabled { opacity: .6; cursor: not-allowed; }
.case-workspace .cw-approval-facts { margin: 12px 0; }
.case-workspace .cw-approval-facts dt { font-size: 12px; color: var(--text-soft); margin-top: 12px; }
.case-workspace .cw-approval-facts dd { margin: 2px 0 0; }
.case-workspace details.cw-details { margin: 14px 0 0; padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.case-workspace .cw-details > summary { cursor: pointer; font-weight: 650; font-size: 14px; }
.case-workspace .cw-details[open] > summary { margin-bottom: 14px; }
.case-workspace .cw-details .cw-card + .cw-card { margin-top: 14px; }
.case-workspace .cw-details:focus-within, .product-operator-overview a:focus-visible { outline: 2px solid var(--watch-f); outline-offset: 3px; }
.case-workspace .cw-raw { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow: auto; font: 12px/1.6 var(--font-mono, monospace); }
.case-workspace .cw-rejection { display: grid; grid-template-columns: minmax(120px, .65fr) minmax(0, 1.35fr); gap: 14px; padding: 14px 0; border-top: 1px solid var(--line-soft); }
.case-workspace .cw-rejection p { margin: 4px 0; font-size: 14px; }
.case-workspace .cw-progress { height: 8px; background: var(--line-soft); border-radius: 8px; overflow: hidden; }
.case-workspace .cw-progress > i { height: 100%; display: block; background: var(--ok-f); }
.case-workspace .cw-card, .case-workspace .cw-card a, .case-workspace .cw-compact-list { overflow-wrap: anywhere; }
.case-workspace .cw-graph { min-width: 0; width: 100%; }
.case-workspace .cw-graph .ns-graph-canvas, .case-workspace .cw-graph [data-test="focused-case-graph"] { min-height: 280px; }
.product-operator-overview .readout-buckets { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 14px; }
.product-operator-overview .readout-bucket { display: flex; align-items: baseline; gap: 6px; font-size: 13px; color: var(--text-soft); }
.product-operator-overview .readout-bucket .tile-count { font-size: 18px; color: var(--text); font-variant-numeric: tabular-nums; }
.product-operator-overview .qrow { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 18px; }
.product-operator-overview .q-issue { white-space: normal; overflow: visible; text-overflow: clip; max-width: none; font-size: 14px; }
.product-operator-overview .q-name { font-size: 16px; }
.product-operator-overview .b-right { display: flex; align-items: center; justify-content: flex-end; gap: 14px; flex-wrap: wrap; }
.product-operator-overview .roster-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.product-operator-overview .case-open { display: inline-flex; justify-content: center; padding: 9px 14px; border-radius: 8px; background: var(--text); color: var(--surface); font-size: 14px; font-weight: 650; text-decoration: none; white-space: nowrap; }
.product-operator-overview .traveller-link { font-size: 13px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
.product-operator-overview a.qrow:hover { background: var(--surface-2); }
.product-operator-overview .roster-tools { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.product-operator-overview .roster-pagination { display: flex; gap: 8px; margin-left: auto; }
.product-operator-overview .og-viewport { height: clamp(440px, 56vh, 620px); }
.product-operator-overview .og-viewport.og-expanded { height: clamp(560px, 80vh, 900px); }
.product-operator-overview .og-inspector { font-size: 15px; line-height: 1.6; }
@media (max-width: 1050px) {
  .case-workspace .case-decision-grid { grid-template-columns: minmax(0, 1fr); }
  .case-workspace .case-decision-rail { position: static; max-height: none; overflow: visible; }
  .product-operator-overview .qrow { grid-template-columns: 24px minmax(0, 1fr); }
  .product-operator-overview .b-right { grid-column: 2; justify-content: flex-start; }
}
@media (max-width: 680px) {
  .product-recovery-case.case-workspace, .product-operator-overview { width: calc(100% - 28px); }
  .case-workspace .cw-metrics, .case-workspace .cw-times, .case-workspace .cw-rejection { grid-template-columns: minmax(0, 1fr); }
  .case-workspace .cw-card { padding: 16px; }
  .case-workspace .cw-rec > h3 { font-size: 21px; }
  .product-operator-overview .roster-pagination { margin-left: 0; }
}
/* V5 composition: light top-toolbar workspace, sticky rails, subordinate readiness. */
.v5-workspace { max-width: 1680px; font-size: 14px; line-height: 1.5; }
.v5-workspace .page-head h1 { font-size: 36px; line-height: 1.18; letter-spacing: -0.04em; font-weight: 600; }
.v5-workspace .page-head .sub { font-size: 15px; max-width: 62ch; }
.v5-eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-soft); margin: 0 0 8px; }
.v5-overview-layout, .v5-case-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 32px; align-items: start; }
.v5-case-layout { grid-template-columns: minmax(0, 1fr) 270px; }
.v5-overview-main, .v5-case-main { min-width: 0; }
.v5-workspace-tabs { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border); min-height: 50px; }
.v5-tabs { display: flex; gap: 26px; align-items: stretch; }
.v5-tab { position: relative; padding: 13px 0 15px; color: var(--text-soft); font-size: 13px; background: none; border: 0; cursor: pointer; }
.v5-tab.is-active { color: var(--text); font-weight: 600; }
.v5-tab.is-active:after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--ink); }
.v5-count { font-size: 11px; margin-left: 7px; border-radius: 4px; background: var(--surface-2); padding: 2px 5px; color: var(--text-soft); font-weight: 500; }
.v5-focus { display: flex; align-items: center; gap: 7px; color: var(--text-soft); font-size: 11px; }
.v5-focus[hidden] { display: none !important; }
.v5-case-rail.case-decision-rail { max-height: none; overflow: visible; }
.v5-case-rail .cw-approve { padding: 12px; }
.v5-case-rail .cw-approve h2 { font-size: 16px; line-height: 1.25; margin: 0 0 6px; }
.v5-case-rail .cw-approval-facts { margin: 4px 0 8px; }
.v5-case-rail .cw-approval-facts dt { margin-top: 4px; }
.v5-case-rail .v5-rail-title { margin-bottom: 8px; }
.v5-case-main .cw-rec, .v5-case-main .cw-card { width: 100%; max-width: none; }
.v5-focus select { max-width: 220px; padding: 7px 9px; color: var(--text); border: 1px solid var(--border); background: var(--surface); border-radius: 5px; font-size: 12px; }
.v5-context-rail, .v5-case-rail {
  position: sticky; top: 86px; align-self: start;
  border-left: 1px solid var(--border); padding-left: 22px; padding-right: 2px;
  max-height: none; overflow: visible;
}
.v5-rail-title { font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin: 0 0 12px; }
.v5-rail-title span { font-size: 11px; color: var(--text-soft); font-weight: 400; white-space: nowrap; }
.v5-context-rail .queue { display: flex; flex-direction: column; gap: 0; }
.v5-context-rail .qrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "main" "right";
  column-gap: 0; row-gap: 8px;
  padding: 0 0 14px; margin: 0 0 14px;
  border: 0; border-bottom: 1px solid var(--border); border-radius: 0;
  background: none; box-shadow: none; transform: none; text-decoration: none; color: inherit;
}
.v5-context-rail .qrow:hover, .v5-context-rail .qrow:focus-visible { background: none; transform: none; outline: none; }
.v5-context-rail .q-glyph { grid-area: glyph; margin-top: 4px; }
.v5-context-rail .qrow > div:not(.b-right) { grid-area: main; min-width: 0; }
.v5-context-rail .b-right { grid-area: right; display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 0; }
.v5-context-rail .q-name { font-size: 18px; letter-spacing: -0.03em; font-weight: 600; line-height: 1.2; }
.v5-context-rail .qrow + .qrow .q-name { font-size: 15px; font-weight: 500; }
.v5-context-rail .q-issue { font-size: 12px; line-height: 1.4; color: var(--text-soft); margin-top: 4px; }
.v5-context-rail .badge { align-self: flex-start; }
.v5-context-rail .case-open {
  display: flex; justify-content: center; align-items: center; width: 100%; box-sizing: border-box;
  margin-top: 0; background: var(--ink); color: var(--paper); border-radius: 5px;
  padding: 10px 12px; font-size: 12px; font-weight: 600;
}
.v5-context-rail .v5-activity { margin-top: 4px; padding-top: 2px; }
.v5-context-rail .v5-activity .v5-rail-title { margin-bottom: 8px; }
.v5-context-rail .v5-activity-item { padding: 7px 0; }
.v5-context-rail [data-test="decisions-needed"] { font-size: 12px; margin: 0 0 12px; color: var(--text-soft); }
.v5-readiness { margin-top: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--border); }
.v5-readiness-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.v5-readiness-title h2 { font-size: 13px; font-weight: 500; margin: 0; }
.v5-readiness-bar { display: flex; height: 5px; gap: 3px; border-radius: 4px; overflow: hidden; background: #d9dfd8; }
.v5-readiness-bar .seg-ok { background: #669981; }
.v5-readiness-bar .seg-bad { background: #bf6762; }
.v5-readiness-bar .seg-watch { background: #d7b15a; }
.v5-readiness-bar .seg-unk { background: #d9dfd8; }
.v5-text-button { background: none; border: 0; padding: 0; color: var(--ink); font-size: 12px; font-weight: 500; cursor: pointer; }
.v5-case-tabs { display: flex; gap: 16px; border-bottom: 1px solid var(--border); margin-top: 8px; align-items: flex-end; }
.v5-case-tabs .v5-tab { color: #84929d; padding: 10px 8px 13px; }
.v5-case-tabs .v5-tab-recommended { font-weight: 700; color: var(--ink); background: #edf3f8; border-radius: 6px 6px 0 0; padding-left: 11px; padding-right: 11px; }
.v5-case-tabs .v5-tab-recommended.is-active { background: #e6f0f7; }
.v5-case-tabs .v5-tab-recommended:before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #287c5d; margin: 0 7px 1px 0; }
.v5-workspace .cw-lead .callout { background: none; border: 0; box-shadow: none; padding: 0; }
.v5-workspace .cw-lead h2 { font-size: 15px; font-weight: 500; color: var(--text-soft); }
.v5-recommend-sheet { padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.v5-recommend-sheet h2 { font-size: 21px; line-height: 1.25; letter-spacing: -0.02em; margin: 0 0 8px; }
.v5-trip-foot { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: var(--text-soft); border-top: 1px solid var(--border); padding-top: 13px; margin-top: 16px; }
.v5-trip-foot strong { color: var(--text); font-size: 12px; }
.v5-activity-title-icon { width: 16px; height: 16px; color: var(--ink); flex: none; display: inline-block; vertical-align: -2px; margin-right: 8px; }
.v5-activity-item { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 9px; padding: 9px 0; border-bottom: 1px solid var(--border); }
.v5-activity-bullet { width: 24px; height: 24px; border-radius: 50%; background: #f1f4f6; display: grid; place-items: center; font-size: 10px; color: var(--ink); }
.v5-activity-item strong { display: block; font-size: 12px; }
.v5-activity-item p { margin: 2px 0 0; font-size: 10px; color: var(--text-soft); }
.v5-activity-footer { display: flex; justify-content: space-between; gap: 10px; margin-top: 12px; color: var(--text-soft); font-size: 10px; align-items: center; }
.v5-drawer { position: fixed; inset: 66px 0 0 auto; margin: 0; width: min(440px, 92vw); height: calc(100vh - 66px); max-height: none; border: 0; border-left: 1px solid var(--border); padding: 0; background: var(--surface); }
.v5-drawer-head { display: flex; justify-content: space-between; gap: 12px; padding: 22px 24px; border-bottom: 1px solid var(--border); }
.v5-drawer-body { padding: 22px 24px; overflow: auto; height: calc(100% - 78px); }
.v5-panel[hidden] { display: none !important; }
/* ---- V5 visual convergence pass ------------------------------------------ */
/* Heading reads as one composition: title block left, event context right. */
/* One heading band across the full width, above BOTH columns. The two halves
   carry comparable weight so the readiness meter is a counterweight to the
   title rather than a widget squeezed into the right margin. */
.v5-page-head {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: end; gap: 12px 48px;
  padding-bottom: 22px; margin-bottom: 4px; border-bottom: 1px solid var(--border);
}
.v5-page-head-main { min-width: 0; }
.v5-page-head-main .sub { margin-top: 10px; }
.v5-event-meta { margin: 10px 0 0; padding-top: 8px; font-size: 12px; color: var(--text-soft); text-align: right; white-space: nowrap; }

/* The graph frame already sits under an "Event health" tab, so its own title
   block is a duplicate heading. Hiding it here is presentation only - the graph
   renderer, its controls and its semantics are untouched. */
.product-operator-overview .og { margin: 0; }
.product-operator-overview .og-frame { border-radius: 8px; box-shadow: none; border-color: #e3e9ed; background: #fbfcfe; }
.product-operator-overview .og-head { padding: 0 0 12px; border-bottom: 0; justify-content: flex-end; background: none; }
.product-operator-overview .og-head > div:first-child { display: none; }

/* Topline above the graph: who/what is in focus, in the reference's quiet voice. */
.v5-active-context { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; min-height: 34px; padding-top: 12px; font-size: 12px; color: var(--text-soft); }
.v5-active-context strong { color: var(--text); font-weight: 600; }
.v5-context-slash { color: #bcc4cb; }
.v5-context-what { min-width: 0; }

/* Readiness sits under the graph and must stay subordinate to it. */
.v5-readiness { margin-top: 20px; }
/* Buckets span the bar they describe, as in the reference, rather than bunching. */
.product-operator-overview .readout-buckets { justify-content: space-between; gap: 8px 22px; margin-top: 10px; }
.product-operator-overview .readout-bucket .tile-count { font-size: 17px; font-weight: 500; }

/* Attention rail: an editorial lead story, then demoted siblings. No boxes -
   the rail is a column of hairline-separated stories, not a stack of cards. */
.v5-context-rail .queue { background: none; border: 0; border-radius: 0; box-shadow: none; overflow: visible; }
/* The coloured dot on the state line already carries the tone, so the queue
   glyph would be a second status mark on the same row. */
.v5-context-rail .q-glyph { display: none; }
.v5-context-rail .qrow { padding: 0 0 18px; margin: 0 0 18px; row-gap: 10px; }
.v5-context-rail .qrow:last-child { border-bottom: 0; }
.v5-context-rail .q-state { display: flex; align-items: center; gap: 6px; font-size: 11px; line-height: 1.3; color: var(--text-soft); }
.v5-context-rail .q-state i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.v5-context-rail .q-state.tone-alert { color: #bb4c42; }
.v5-context-rail .q-state.tone-watch { color: #936313; }
.v5-context-rail .q-state.tone-ok { color: #287c5d; }
.v5-context-rail .q-name { margin-top: 6px; font-size: 21px; letter-spacing: -0.03em; }
.v5-context-rail .q-issue { font-size: 13px; line-height: 1.5; color: var(--text); margin-top: 8px; }
.v5-context-rail .b-extra { font-size: 11px; color: var(--text-soft); margin: 6px 0 0; }
/* Second and later stories step down so the rail has one obvious entry point. */
.v5-context-rail .qrow + .qrow .q-name { margin-top: 4px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.v5-context-rail .qrow + .qrow .q-issue { font-size: 12px; color: var(--text-soft); margin-top: 4px; }
.v5-context-rail .qrow + .qrow .case-open {
  background: none; color: var(--ink); border: 1px solid var(--border);
  padding: 8px 12px; font-weight: 500;
}
.v5-context-rail .qrow + .qrow:hover .case-open { background: var(--surface-2); }
.v5-context-rail [data-test="decisions-needed"] { margin: -4px 0 16px; }

/* Activity: one primary line plus one muted meta line. */
.v5-context-rail .v5-activity { margin-top: 2px; }
.v5-activity-item strong { line-height: 1.4; }
.v5-activity-item p { font-size: 11px; line-height: 1.4; }
.v5-activity-item:last-of-type { border-bottom: 0; }
.v5-activity-footer { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 4px; }

/* Participant directory: a scannable table, not a stack of tall cards. The
   filters must not look like a second row of page tabs. */
.product-operator-overview .roster-tools { gap: 10px; margin-bottom: 0; padding: 16px 0 14px; }
.product-operator-overview [data-test="roster-filters"] { gap: 4px; padding-bottom: 0; }
.product-operator-overview [data-test="roster-filters"] .v5-tab {
  padding: 6px 10px; border-radius: 5px; font-size: 12px; color: var(--text-soft);
}
.product-operator-overview [data-test="roster-filters"] .v5-tab:after { display: none; }
.product-operator-overview [data-test="roster-filters"] .v5-tab[aria-pressed="true"] {
  color: var(--text); font-weight: 600; background: #edf3f8;
}
.product-operator-overview [data-overview-panel="participants"] .queue {
  border: 0; border-radius: 0; box-shadow: none; background: none; overflow: visible;
}
.product-operator-overview [data-overview-panel="participants"] .qrow {
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center; gap: 14px; padding: 10px 0; border-top: 0;
  border-bottom: 1px solid var(--line-soft);
}
/* Name and context read as one line so the directory scans like a table. */
.product-operator-overview [data-overview-panel="participants"] .qrow > div:not(.b-right) {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; min-width: 0;
}
.product-operator-overview [data-overview-panel="participants"] .q-name { font-size: 13px; font-weight: 600; }
.product-operator-overview [data-overview-panel="participants"] .q-issue { font-size: 12px; color: var(--text-soft); margin: 0; }
.product-operator-overview [data-overview-panel="participants"] .b-extra { flex-basis: 100%; margin: 2px 0 0; font-size: 11px; }
/* Status and actions sit in fixed columns so the directory scans vertically. */
.product-operator-overview [data-overview-panel="participants"] .b-right {
  display: grid; grid-template-columns: 150px minmax(0, auto); align-items: center;
  justify-items: start; gap: 12px; flex-wrap: nowrap;
}
.product-operator-overview [data-overview-panel="participants"] .roster-actions { justify-self: end; }
.product-operator-overview [data-overview-panel="participants"] .case-open { padding: 6px 11px; font-size: 12px; }
.product-operator-overview [data-overview-panel="participants"] .roster-actions { gap: 8px; }
.product-operator-overview [data-overview-panel="participants"] .badge { font-size: 10px; }

/* Demo control must not compete with the workspace. */
.product-operator-overview [data-test="simulated-airline-update"] { margin-top: 26px; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: none; padding: 14px 0 0; }
.product-operator-overview [data-test="simulated-airline-update"] > summary { font-size: 12px; color: var(--text-soft); }
.product-operator-overview [data-test="simulated-airline-update"] > summary strong { font-weight: 500; }

/* ---- Case ----------------------------------------------------------------- */
/* Breadcrumb above the title; the timestamp is meta, not part of the problem. */
.v5-case-head .v5-breadcrumb { margin: 0 0 10px; font-size: 11px; color: var(--text-soft); }
.v5-case-head h1 { margin: 0; }
.v5-case-head .sub { margin-top: 8px; font-size: 15px; max-width: 70ch; }
.v5-case-head .v5-case-updated { margin-top: 8px; font-size: 11px; }

/* Graph is the first thing an operator reads, so the chrome above it stays thin. */
.case-workspace .oc-toggle { margin-top: 4px; }
.case-workspace .oc-caption { margin: 8px 0 10px; font-size: 11px; color: var(--text-soft); }
.case-workspace .cw-graph { margin-bottom: 16px; }

/* "What this affects" is a one-line disclosure, not a boxed card. */
.case-workspace details.v5-affects { border: 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); border-radius: 0; background: none; padding: 0; margin: 0; }
.case-workspace details.v5-affects > summary { padding: 13px 0; font-size: 12px; font-weight: 600; }
.case-workspace details.v5-affects[open] > summary { margin-bottom: 0; }
.case-workspace .v5-affects .cw-compact-list { padding-bottom: 12px; }

.v5-case-tabs { margin-top: 14px; }
.case-workspace .v5-panel > [data-poll-region] > .cw-card:first-child { margin-top: 18px; }

/* Named section above the graph, matching the reference's quiet topline. The
   Current/Original control is lifted onto that same row so the graph is not
   pushed down by three separate rows of chrome. */
.case-workspace .cw-graph { position: relative; }
.case-workspace .v5-graph-topline { display: flex; align-items: center; gap: 12px; min-height: 34px; margin: 0 0 8px; }
.case-workspace .v5-graph-topline h2 { margin: 0; font-size: 13px; font-weight: 600; }
.case-workspace .cw-graph .oc-toggle { margin: 0; }
.case-workspace .cw-graph .oc-tabs { position: absolute; top: -1px; right: 0; margin: 0; z-index: 1; }
.case-workspace .cw-graph .oc-caption { margin: 0 0 8px; }
@media (max-width: 680px) {
  .case-workspace .cw-graph .oc-tabs { position: static; margin: 0 0 8px; }
}

/* "What this affects" previews its content in the summary. */
.case-workspace details.v5-affects > summary { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.case-workspace .v5-affects-label { font-weight: 600; }
.case-workspace .v5-affects-preview { font-weight: 400; font-size: 11px; color: var(--text-soft); min-width: 0; }

/* Inside the recommended card, itinerary and commitment blocks are separated by
   hairlines rather than nested panels - one container level, not three. */
.case-workspace .cw-rec .cw-itinerary > article,
.case-workspace .cw-alt .cw-itinerary > article {
  background: none; border-radius: 0; padding: 12px 0; border-top: 1px solid var(--line-soft);
}
.case-workspace .cw-rec .cw-itinerary > article:first-child,
.case-workspace .cw-alt .cw-itinerary > article:first-child { border-top: 0; padding-top: 4px; }
.case-workspace .cw-rec .cw-itinerary { gap: 0; }
.case-workspace .cw-rec .cw-block > h4 { font-size: 12px; letter-spacing: 0.01em; color: var(--text-soft); text-transform: none; }

/* Decision rail: one question, its answer, then the money and the control. */
.v5-case-rail .v5-decision-intro { margin: 0 0 10px; font-size: 11px; line-height: 1.45; }
.v5-case-rail .cw-approval-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: baseline; }
.v5-case-rail .cw-approval-facts dt { margin: 0; font-size: 11px; }
.v5-case-rail .cw-approval-facts dd { margin: 0; font-size: 12px; font-weight: 600; }
.v5-case-rail [data-test="cost-unavailable"], .v5-case-rail [data-test="decision-execution-blocker"] { font-size: 11px; line-height: 1.45; margin: 10px 0 0; }
.v5-case-rail .cw-metrics { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.v5-case-rail .cw-metric { padding: 9px 10px; }
.v5-case-rail .cw-metrics-unknown .cw-metric { border-style: dashed; background: none; }
.v5-case-rail .cw-metrics-unknown .cw-metric strong { color: var(--text-soft); font-weight: 600; }
.v5-case-rail .cw-metric strong { font-size: 15px; }
.v5-case-rail .btn { margin-top: 12px; }
.v5-case-rail .v5-recommend-sheet .btn { display: flex; justify-content: center; }

/* Activity rows in the case rail follow the same one-primary-line shape. */
.v5-case-rail .check-row { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); align-items: start; }
.v5-case-rail .check-row .c-ic { font-size: 11px; color: var(--text-soft); line-height: 1.5; }
.v5-case-rail .check-row .c-t { font-size: 12px; font-weight: 600; line-height: 1.4; }
.v5-case-rail .check-row .c-sub { grid-column: 2; font-size: 11px; color: var(--text-soft); line-height: 1.4; margin-top: 2px; }
.v5-trip-foot strong.tone-alert { color: #bb4c42; }
.v5-trip-foot strong.tone-ok { color: #287c5d; }

/* ---- Readiness meter in the page heading ---------------------------------- */
/* The heading row left ~680px of dead space at 1440 while the readiness meter sat
   below the graph reading as a hairline. It moves up as the heading's right-hand
   counterweight, and stays deliberately quiet: small-caps label, muted numbers, no
   large type, so it reads as a status strip and not a hero. */
.v5-page-head-aside { display: flex; flex-direction: column; align-items: stretch; gap: 12px; min-width: 0; }
.v5-page-head-aside .v5-event-meta { text-align: right; }
.v5-page-head-aside .v5-event-meta { margin: 0; }
/* Equal width with the title block: the meter fills its half of the band. */
.v5-readiness-top { width: 100%; margin: 0; padding: 0; border-bottom: 0; }
.v5-readiness-top .v5-readiness-title { margin-bottom: 8px; gap: 14px; }
.v5-readiness-top .v5-readiness-title h2 {
  font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-soft);
}
.v5-readiness-top .v5-text-button { font-size: 11px; white-space: nowrap; }
/* 10px, rounded, with real gaps so the segments read as quantities not a rule. */
.v5-readiness-top .v5-readiness-bar { height: 14px; gap: 3px; border-radius: 999px; background: transparent; }
.v5-readiness-top .v5-readiness-bar > span { border-radius: 999px; min-width: 0; }
.v5-readiness-top .v5-readiness-bar .seg-unk { background: #dfe4e9; }
/* Equal columns under the bar. Spacing them by bar proportion would put each
   count under a segment it does not measure; equal columns read as a legend. */
.v5-readiness-top .readout-buckets { display: flex; gap: 6px 18px; margin-top: 12px; }
.v5-readiness-top .readout-bucket { flex: 1 1 0; min-width: 0; font-size: 12px; gap: 6px; align-items: baseline; }
.v5-readiness-top .readout-bucket .tile-label { white-space: nowrap; }
.v5-readiness-top .readout-bucket .tile-count { font-size: 17px; font-weight: 600; }
.v5-readiness-top .v5-readiness-dot { align-self: center; }
/* State is never carried by colour alone - the dot repeats the label's tone. */
.v5-readiness-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; display: inline-block; }
.v5-readiness-top .readout-bucket.tone-ok .v5-readiness-dot { background: #669981; }
.v5-readiness-top .readout-bucket.tone-alert .v5-readiness-dot { background: #bf6762; }
.v5-readiness-top .readout-bucket.tone-watch .v5-readiness-dot { background: #d7b15a; }
.v5-readiness-top .readout-bucket.tone-neutral .v5-readiness-dot { background: #c3ccd4; }

/* ---- Recommended recovery: verdict, glance strip, numbered steps ----------- */
.case-workspace .v5-rec-head { margin-bottom: 18px; }
.case-workspace .v5-rec-head h3 { margin: 6px 0 0; }
/* The one-line answer, read before any detail. */
.case-workspace .v5-rec-verdict { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--text); max-width: 68ch; }
/* Four facts an operator always wants, in one scan. */
.case-workspace .v5-rec-glance {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0;
  margin: 0 0 22px; border: 1px solid var(--line-soft); border-radius: 10px; overflow: hidden;
  background: var(--surface-2, var(--paper-warm));
}
.case-workspace .v5-glance-cell { padding: 11px 14px; border-left: 1px solid var(--line-soft); min-width: 0; }
.case-workspace .v5-glance-cell:first-child { border-left: 0; }
.case-workspace .v5-glance-cell dt {
  margin: 0 0 5px; font-size: 9px; font-weight: 700; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--text-soft);
}
.case-workspace .v5-glance-cell dd { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.case-workspace .v5-glance-sub { display: block; margin-top: 3px; font-size: 11px; font-weight: 400; color: var(--text-soft); line-height: 1.35; }
/* Numbered steps give the eye an explicit order. The digit is CSS, not markup. */
.case-workspace .v5-rec-step { padding: 18px 0 0; margin-top: 18px; border-top: 1px solid var(--line-soft); }
.case-workspace .v5-rec-step:first-of-type { padding-top: 0; margin-top: 0; border-top: 0; }
.case-workspace .v5-rec-step > h4 {
  display: flex; align-items: center; gap: 10px; margin: 0 0 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-soft);
}
.case-workspace .v5-rec-step > h4::before {
  content: ""; display: grid; place-items: center;
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  background: var(--ink); color: var(--paper); font-size: 10px; font-weight: 700; letter-spacing: 0;
}
.case-workspace .v5-rec-step[data-step="1"] > h4::before { content: "1"; }
.case-workspace .v5-rec-step[data-step="2"] > h4::before { content: "2"; }
.case-workspace .v5-rec-step[data-step="3"] > h4::before { content: "3"; }
.case-workspace .v5-rec-step .cw-block { margin-top: 0; padding-top: 0; border-top: 0; }
.case-workspace .v5-rec-step .cw-block > h4 { font-size: 12px; text-transform: none; letter-spacing: 0; color: var(--text); }

/* ---- Rail sections: action vs log ----------------------------------------- */
/* Sections previously ran together on a hairline, so "things I must decide" and
   "what the engine did" blurred. Proximity does the separating; the rule confirms it. */
.v5-context-rail .v5-rail-title, .v5-case-rail .v5-rail-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--text-soft); padding-bottom: 10px; border-bottom: 1px solid var(--border); margin: 0 0 14px;
}
.v5-context-rail .v5-rail-title span, .v5-case-rail .v5-rail-title span { letter-spacing: 0; text-transform: none; font-size: 11px; }
/* The title is a flex row with space-between, which pushed the activity icon to
   the opposite end of its own label. Group icon+label, push any count right. */
.v5-activity .v5-rail-title { justify-content: flex-start; gap: 0; }
.v5-activity .v5-rail-title span, .v5-activity .v5-rail-title a { margin-left: auto; }
/* A real gap before the log section, not another hairline. */
.v5-context-rail .v5-activity, .v5-case-rail .v5-activity, .v5-case-rail [aria-label="Northstar activity"] {
  margin-top: 40px;
}
/* The activity feed is a timeline, so it carries a tick rail and never a card. */
.v5-context-rail .v5-activity .v5-activity-item, .v5-case-rail .check-row {
  position: relative; padding-left: 14px; border-bottom: 0;
}
.v5-context-rail .v5-activity .v5-activity-item::before, .v5-case-rail .check-row::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 1px; background: var(--border);
}
.v5-context-rail .v5-activity .v5-activity-item:first-of-type::before, .v5-case-rail .check-row:first-of-type::before { top: 9px; }
.v5-context-rail .v5-activity .v5-activity-item:last-of-type::before, .v5-case-rail .check-row:last-of-type::before { bottom: 9px; }
.v5-context-rail .v5-activity .v5-activity-bullet { width: 18px; height: 18px; font-size: 9px; }
.v5-context-rail .v5-activity .v5-activity-item { grid-template-columns: 18px minmax(0, 1fr); gap: 8px; }
/* Whole-trip state is status, not an action: it closes the rail after its own gap. */
.v5-case-rail .v5-trip-foot { margin-top: 32px; padding-top: 14px; font-size: 11px; }

@media (max-width: 1100px) {
  .v5-overview-layout, .v5-case-layout { grid-template-columns: 1fr; }
  .v5-context-rail, .v5-case-rail { position: static; max-height: none; overflow: visible; border-left: 0; border-top: 1px solid var(--border); padding-left: 0; padding-top: 24px; }
}
</style>`;
