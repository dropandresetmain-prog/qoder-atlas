# Northstar Operator Workspace V5 — accepted frontend direction

Status: **Founder approved visual direction**
Approved: 21 September 2026
Base SHA: `372a664041897ddb173aa12612307c759e060bc3`
Implementation branch: `ui/operator-workspace-v5`

## Scope

This contract covers the **Operator Overview** and **Operator Case** surfaces only.

The approved V5 direction is a hybrid:
- use the V2 page composition and typography scale;
- use the original/V1 light Northstar colour system and top toolbar;
- no permanent left sidebar;
- keep the V7.2 Event Overview Graph and V5.6 Live Dependency Graph as the graph contracts;
- production must use the existing live graph renderers/read models, not the static prototype graph HTML;
- details should use deliberate tabs/panes rather than accumulating long page sections.

## Overview

Default page job: show event health, active incidents, what Northstar is doing, and where operator attention belongs.

Approved composition:
1. existing Northstar top toolbar;
2. page heading/event context;
3. two real workspace tabs: **Event health** and **All participants**;
4. Event health: V7.2 graph is the dominant main-column object;
5. compact managed-travel readiness beneath the graph;
6. sticky right rail with **Needs attention** and compact **Northstar activity**;
7. incident focus selector is independent of the open-case list;
8. Sarah + Jordan (and future cases) coexist; focusing one must not reset/remove the others;
9. All participants is a true tab, not a popup pane. Reuse the production roster/search/pagination/presentation logic.

## Case

Default page job: explain the current break, show the causal trip graph, make the selected recovery unmistakable, expose authority/cost/activity, and show whether the whole trip is recovered.

Approved composition:
1. existing Northstar top toolbar;
2. compact traveller/case heading and current problem;
3. V5.6 graph in the main column, preserving its aspect ratio;
4. sticky right rail containing:
   - decision / authority;
   - cost & exposure;
   - compact Northstar activity;
   - whole-trip state;
5. beneath the graph, three content views:
   - **Recommended recovery** — visually dominant/default;
   - Other options;
   - Checks & sources;
6. supporting detail/evidence may open in panes rather than creating another long stack;
7. trip health and workflow state remain separate semantics.

## Reuse requirement

Do **not** rebuild Northstar from the static HTML.

Inventory and reuse existing production implementation first, especially:
- `src/ui/overview-graph/*` / `renderEventOverviewGraph()`;
- `src/ui/graph/*` / `renderFocusedCaseGraph()`;
- current operator shell/topbar/theme;
- Overview readiness/roster/presentation-state logic;
- Case recommendation/options/checks/approval/action/resolution logic;
- Activity adapter/feed semantics and glyph/tone presentation.

Extract bounded reusable renderers where current useful sections are private inside page-level files. Replace page composition, not domain/read-model truth.

## Graph visual references

Accepted graph prototypes remain:
- `docs/design/event-overview-graph/prototype/event-overview-v7.2.html`
- `docs/design/live-dependency-graph/prototype/live-dependency-graph-v5.6.html`

They are visual contracts only. Production must continue to render authoritative live projections.

## Known truth gaps — do not paper over in CSS

- Sarah + Jordan coexistence on Overview.
- Jordan progression must be green -> amber/watch -> red/broken when authoritative truth warrants it.
- Overview and Case must agree on trip health.
- Sarah should be programme-recovery-led only when the actual selected strategy is programme recovery.
- Approval/authority comes from real authority state.
- Unknown cost/refund/loss stays unknown.
- Activity must distinguish observable model/provider/execution provenance honestly.
- Recovered means fresh whole-trip reassessment passes, not merely that an action executed.

## Acceptance

Implementation must be generic: no Sarah/Jordan/person/provider/scenario branches in application logic.

At milestone acceptance physically verify:
- Overview healthy + multiple simultaneous open cases;
- incident focus switching without workspace reset;
- All participants tab;
- Case Current/Original graph behaviour;
- recommendation prominence;
- authority/approval states;
- progressive activity;
- Jordan D1/D2/D3 progression;
- Sarah programme recovery;
- execution observation and whole-trip reassessment.

Use focused tests during iteration. Broaden only at integration checkpoints.
