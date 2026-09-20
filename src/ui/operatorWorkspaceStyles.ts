/** A3 layout only. Reuses the existing tokens; does not change graph semantics. */
export const OPERATOR_WORKSPACE_STYLES = `<style data-operator-workspace-styles>
.product-recovery-case.case-workspace, .product-operator-overview { max-width: 1480px; width: calc(100% - 48px); margin-left: auto; margin-right: auto; }
.case-workspace { font-size: 15px; line-height: 1.55; }
.case-workspace .page-head h1 { font-size: 30px; }
.case-workspace .case-grid { display: grid; grid-template-columns: minmax(0, 2.05fr) minmax(300px, 1fr); gap: 28px; align-items: start; }
.case-workspace .case-flow, .case-workspace .case-rail { width: auto; min-width: 0; max-width: none; }
.case-workspace .case-rail { position: static; display: grid; gap: 18px; }
.case-workspace .section { margin: 0 0 24px; }
.case-workspace .section h2 { font-size: 19px; margin: 0 0 12px; }
.case-workspace .panel, .case-workspace .cw-card { padding: 20px; }
.case-workspace .cw-card { border: 1px solid var(--border); border-radius: var(--radius, 14px); background: var(--surface); }
.case-workspace .cw-card h3 { margin: 0 0 10px; font-size: 18px; line-height: 1.4; }
.case-workspace .cw-card h4 { margin: 0 0 6px; font-size: 15px; }
.case-workspace .cw-card p { margin: 6px 0; }
.case-workspace .cw-lead { margin-bottom: 24px; }
.case-workspace .cw-lead .callout { padding: 18px 22px; }
.case-workspace .cw-lead h2 { margin: 0 0 6px; font-size: 20px; }
.case-workspace .cw-lead p { font-size: 15px; max-width: 90ch; }
.case-workspace .cw-muted, .case-workspace .graph-caption { color: var(--text-soft); font-size: 14px; }
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
.case-workspace .cw-metric small { display: block; color: var(--text-soft); font-size: 12px; }
.case-workspace .cw-metric strong { display: block; font-size: 19px; font-variant-numeric: tabular-nums; }
.case-workspace .cw-cost-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
.case-workspace .cw-cost-table th, .case-workspace .cw-cost-table td { padding: 9px 5px; border-bottom: 1px solid var(--line-soft); text-align: left; vertical-align: top; }
.case-workspace .cw-cost-table th { color: var(--text-soft); font-weight: 600; }
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
.case-workspace .cw-stage { padding: 12px 0; border-top: 1px solid var(--line-soft); }
.case-workspace .cw-stage h4 { font-size: 14px; }
.case-workspace .cw-stage p { font-size: 13px; }
.case-workspace .cw-state { display: inline-block; border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; font-size: 12px; }
.case-workspace .cw-progress { height: 8px; background: var(--line-soft); border-radius: 8px; overflow: hidden; }
.case-workspace .cw-progress > i { height: 100%; display: block; background: var(--ok-f); }
.case-workspace .cw-card, .case-workspace .cw-card a, .case-workspace .cw-compact-list { overflow-wrap: anywhere; }
.case-workspace .cw-graph { min-width: 0; }
/* Scope all density and hit-target corrections to current product surfaces. */
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
  .case-workspace .case-grid { grid-template-columns: minmax(0, 1fr); }
  .case-workspace .case-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .case-workspace .case-rail > .cw-poll-approval { grid-column: 1 / -1; }
  .product-operator-overview .qrow { grid-template-columns: 24px minmax(0, 1fr); }
  .product-operator-overview .b-right { grid-column: 2; justify-content: flex-start; }
}
@media (max-width: 680px) {
  .product-recovery-case.case-workspace, .product-operator-overview { width: calc(100% - 28px); }
  .case-workspace .case-rail, .case-workspace .cw-metrics, .case-workspace .cw-times, .case-workspace .cw-rejection { grid-template-columns: minmax(0, 1fr); }
  .case-workspace .cw-card { padding: 16px; }
  .case-workspace .cw-rec > h3 { font-size: 21px; }
  .product-operator-overview .roster-pagination { margin-left: 0; }
}
</style>`;
