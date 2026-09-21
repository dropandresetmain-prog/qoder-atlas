# ACTIVE TASK — Operator Workspace V5 Implementation

## Identity

- Branch: `ui/operator-workspace-v5`
- Worktree: `.worktrees/ui-operator-workspace-v5`
- Starting SHA: `b1727887143deb5307fdea27157994ceb1bcb47b`
- Role: PRIMARY IMPLEMENTATION OWNER

## Goal

Founder-approved Overview + Case V5 composition on the real frontend, using production V7.2 / V5.6 graphs and authoritative read models.

## Current checkpoint

**Activity-rail correction + CP1–CP5. CP6 physical hero walkthrough next.**

## Acceptance checklist

- [x] CP1 V5 layout primitives in `operatorWorkspaceStyles.ts` + tab/focus/drawer client
- [x] CP2 Overview: Event health / All participants tabs, real `renderEventOverviewGraph()`, compact readiness, sticky attention rail, focus selector that does not drop other stories
- [x] CP3 Case: real `renderFocusedCaseGraph()`, Recommended recovery default tab, sticky decision rail, trip viability separate from approval
- [x] CP4 Compact case activity from the existing case activity rows; Overview rail composes latest real `ActivityFeed` (same adapter vocabulary) + View log link
- [x] CP5 Tight connection (`connection_below_minimum` only) presents AT_RISK / CHECKING, not DISRUPTED / UNRESOLVED. Broken or other blocking failures stay DISRUPTED
- [ ] CP6 Physical Sarah + Jordan demo walkthrough on the running product
- [x] Anti-hardcoding CLEAN
- [x] Focused UI tests + `tsc --noEmit`

## Checks

- `test/operator-ui-convergence.test.ts`: pass (incl. Overview activity rail composition)
- Overview HTML composes `loadActivityFeed` + `renderCompactActivityRail`; refreshes via existing Overview HTML poll regions (`overview-activity`)
- Limitation recorded: mini-feed refresh depends on Overview page poll, not a dedicated activity cursor poll
- Not run yet: live Sarah/Jordan browser rehearsal

## Issue disposition

| Issue | Class | Notes |
|---|---|---|
| Overview activity rail without a feed on `OperatorOverview` | Act Now | Fixed by page composition; OperatorOverview contract unchanged |
| Live Sarah/Jordan D1–D3 click-through | Act Now (next) | Needs demo runtime; not faked here |
| Legacy `/operator` screens | Ignore / Accept Risk | Product path is product-* |

## Next action

Boot the accepted demo runtime and walk Overview + Case for Sarah + Jordan in the same workspace.
