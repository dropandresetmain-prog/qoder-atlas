# NORTHSTAR Operator Workspace V5 — accepted design reference

Status: **Founder-approved visual direction**.

Branch base before this reference commit: `372a664041897ddb173aa12612307c759e060bc3`.

These files are design references. They are **not production UI code** and must not become a second product/runtime path.

## Binding composition

- Use the V2 information density and typography scale.
- Use the V1 light/navy colour system and top toolbar.
- Do not add a left sidebar.
- Overview:
  - `Event health` and `All participants` are peer page tabs.
  - V7.2 is the dominant visual in Event health.
  - managed-travel readiness is compact and subordinate to the graph.
  - the desktop right column is a sticky work rail.
  - the rail carries attention/open stories and compact NORTHSTAR activity.
- Case:
  - V5.6 is prominent near the top.
  - the desktop right column is a sticky rail carrying the recommended recovery, decision/authority, activity and whole-trip state.
  - `Recommended recovery` is the default and visually dominant tab over `Other options` and `Checks & sources`.
  - deeper evidence/details use panes/drawers rather than accumulating as a long block stack.

## Graph boundary

Production MUST continue to use the real production renderers and authoritative projections:

- `src/ui/overview-graph/index.ts` → `renderEventOverviewGraph()`
- `src/ui/graph/index.ts` → `renderFocusedCaseGraph()`

The accepted static graph prototypes remain visual references only:

- `docs/design/event-overview-graph/prototype/event-overview-v7.2.html`
- `docs/design/live-dependency-graph/prototype/live-dependency-graph-v5.6.html`

Do **not** ship prototype iframe/fetch behaviour into production. Do not copy Sarah, Jordan, route, provider, event or fixture facts from these references into application logic.

## Reuse expectation

Reuse the current read models and presentation logic before introducing new components:

- operator topbar/theme;
- V7.2 and V5.6 production graph renderers;
- Overview managed-travel/readiness mappings, attention sorting, roster search/pagination and Local vs Unconfirmed distinctions;
- Case lifecycle, recommendation/options, deterministic rejection evidence, approval/authority, execution progress, checks and resolution presentation;
- Activity adapter/feed language, glyphs, tones and Case links.

The intended implementation is primarily **recomposition plus bounded extraction of reusable renderers**, not a frontend rewrite.

## Reference assets

- `overview-v5.html` — approved Overview V5 reference.
- `case-v5.html` — self-contained browser wrapper around the exact approved Case V5 HTML payload.
- `overview-v5-preview.png` and `case-v5-preview.png` — compact visual snapshots for quick review. The HTML files are the fidelity reference.

If implementation truth conflicts with a static reference value, runtime/read-model truth wins. Do not fake missing backend information in the frontend.
