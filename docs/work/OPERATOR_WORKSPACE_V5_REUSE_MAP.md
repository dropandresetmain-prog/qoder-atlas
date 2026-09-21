# Operator Workspace V5 — reuse / extraction map

Frozen at grounding on `ui/operator-workspace-v5` @ `b172788`. Visual contract: `docs/design/operator-workspace-v5/*`.

## Principle

**Recompose and extract.** Do not rewrite Northstar. Do not copy static prototype business data or iframe graphs.

## Reuse as-is (no rewrite)

| Asset | Path | Notes |
|---|---|---|
| Overview graph | `src/ui/overview-graph/**` → `renderEventOverviewGraph()` | Keep polling/selection/focus/pan-zoom |
| Case graph | `src/ui/graph/**` → `renderFocusedCaseGraph()` | Keep Original/Current, views, pan-zoom |
| Topbar shell | `src/ui/page.ts` | Keep; V5 uses existing top toolbar |
| Theme tokens | `src/ui/theme.ts` | Extend V5 density via workspace styles; no dark theme |
| Managed-travel buckets | `src/ui/presentationState.ts` | Confirmed / attention / watching / unconfirmed / local |
| Overview adapter logic | `src/app/target/adapters/operatorOverviewAdapter.ts` | Counts, queue, roster rows, search/pagination hooks |
| Roster client | `src/ui/overviewRosterController.ts` | Search + page size |
| Case presenter | `src/app/target/adapters/caseWorkspacePresenter.ts` | Phase, lead, affects, execution, resolution |
| Decision presentation | `src/ui/caseDecisionPresentation.ts` | Options, costs, titles, rejections |
| Case lifecycle | `src/ui/caseLifecycle.ts` | Phase selection |
| Activity adapter | `src/app/target/adapters/activityAdapter.ts` + `product-activity-feed.ts` | Glyphs/tones; compact rail projects same model |
| Polling | `src/ui/shellRuntime.ts`, `casePolling.ts`, overview poll regions | Preserve live updates |
| Copy helpers | `src/ui/copy.ts` | Fix wording via copy, not scenario branches |

## Extract / recompose (bounded)

### Shared (CP1)

- V5 layout CSS primitives into `operatorWorkspaceStyles.ts` (or thin `operatorWorkspaceV5Styles.ts`): page max-width ~1680, sticky rail, tab underline, compact readiness bar, drawer dialog, recommended-tab emphasis.
- Optional shared helpers: sticky rail wrapper, tablist markup, drawer shell — pure HTML helpers, no business logic.

### Overview (CP2)

**Target composition** (from V5 HTML):

```
page-head
overview-layout
  overview-main
    tabs: Event health | All participants
    focus selector (incident focus ≠ open-case list)
    [Event health]
      map topline (active context)
      REAL renderEventOverviewGraph()
      compact readiness (bar + counts)  ← from adapter summary, NOT fleet hero
    [All participants]
      roster search/filters/table ← reuse adapter rosterHtml / controller
  context-rail (sticky)
    Needs attention / open stories ← reuse attentionHtml semantics
    compact Northstar activity ← CP4 projection
```

**Extraction from adapter:**

- Split `summaryHtml` into: compact readiness fragment (bar + counts) vs retire fleet-grid from Overview default.
- Keep `attentionHtml` / `rosterHtml` generators; restyle wrappers only.
- Add overview tab client script (show/hide panels; hide focus control on participants tab).

### Case (CP3)

**Target composition:**

```
breadcrumb + case header (traveller, problem, workflow badge)
case-layout
  case-main
    REAL renderFocusedCaseGraph()  (aspect preserved)
    impact disclosure (affects) — compact details
    tabs: Recommended (dominant) | Other options | Checks & sources
  case-rail (sticky)
    recommend sheet → scroll to recommendation
    decision / authority / money
    compact activity
    whole-trip foot
```

**Extraction from `product-recovery-case.ts`:**

- Keep `graphHtml`, `recommendationHtml`, `alternativesHtml`, `rejectedHtml`, `approvalHtml`, `researchHtml`, `executionHtml`, `resolutionHtml` as named fragment functions (already mostly private).
- Re-home fragments into V5 tab panels + rail; drawers for deeper cost/approval/activity evidence.
- Lead with selected strategy outcome generically (`decisionTitle` / programme changes when present) — no Sarah branch.

### Activity (CP4)

- Add `renderCompactActivityRail(items)` projecting `ActivitySurfaceView` / feed adapter output (limit N recent; link to full `/activity`).
- Overview + Case rails consume same helper.
- Do not invent a second activity system.

## Do not touch / do not invent

- Static `overview-v5.html` / `case-v5.html` iframe graph loaders.
- New SPA router or component framework.
- Scenario IDs / traveller names in presentation logic.
- Merging trip health with approval workflow into one badge.
- Expanding legacy `operator-dashboard.ts` / `operator-case.ts` as the product path.

## Parallel lanes (safe after CP1 contracts)

| Lane | Owns | Must not own |
|---|---|---|
| Overview recomposition | `product-operator-overview` + adapter fragment split | Graph semantics / backend truth |
| Case recomposition | `product-recovery-case` tab/rail layout | Authority/execution rules |
| Compact activity | shared rail helper + feed adapter slice | Fake activity |
| Visual/test | focused UI tests + screenshot checklist | Architecture |

Keep architecture, shared contracts, backend truth (CP5), integration, and final verification with the primary agent.

## Dependency order

`CP1 primitives → CP2 Overview → CP3 Case → CP4 activity/drawers → CP5 truth fixes if proven → CP6 physical acceptance`

## Focused test anchors (expected)

- `test/m9-product-surfaces.test.ts`, `test/eventOverview.test.ts`, `test/operator-ui-convergence.test.ts`
- `test/r2-case-workspace-integration.test.ts`, `test/r4-f1-*.test.ts`
- Overview roster / polling tests as touched
- New narrow V5 composition tests only where DOM structure is contractual
