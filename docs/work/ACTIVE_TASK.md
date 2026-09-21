# ACTIVE TASK — Operator Workspace V5 Implementation

## Identity

- Branch: `ui/operator-workspace-v5`
- Worktree: `.worktrees/ui-operator-workspace-v5`
- Starting SHA: `b1727887143deb5307fdea27157994ceb1bcb47b`
- Role: PRIMARY IMPLEMENTATION OWNER

## Goal

Founder-approved Overview + Case V5 composition on the real frontend, using production V7.2 / V5.6 graphs and authoritative read models.

## Current checkpoint

**CP1–CP5 implemented and focused-tested. CP6 physical hero walkthrough not run** (needs the live demo database). Verdict for this commit: **PARTIAL**.

## Acceptance checklist

- [x] CP1 V5 layout primitives in `operatorWorkspaceStyles.ts` + tab/focus/drawer client
- [x] CP2 Overview: Event health / All participants tabs, real `renderEventOverviewGraph()`, compact readiness, sticky attention rail, focus selector that does not drop other stories
- [x] CP3 Case: real `renderFocusedCaseGraph()`, Recommended recovery default tab, sticky decision rail, trip viability separate from approval
- [x] CP4 Compact case activity from the existing case activity rows; Overview rail links to the real activity log (no second feed)
- [x] CP5 Tight connection (`connection_below_minimum` only) presents AT_RISK / CHECKING, not DISRUPTED / UNRESOLVED. Broken or other blocking failures stay DISRUPTED
- [ ] CP6 Physical Sarah + Jordan demo walkthrough on the running product
- [x] Anti-hardcoding CLEAN
- [x] Focused UI tests + `tsc --noEmit`

## Checks

- `test/operator-ui-convergence.test.ts`, `test/m9-product-surfaces.test.ts`, `test/eventOverview.test.ts`, `test/r2-case-workspace-integration.test.ts`: pass
- `test/r4-f1-overview-hit-targets.test.ts`: 65/66 then Apply/Reset click re-run pass after moving the demo control into the main column
- `tsc -p tsconfig.json --noEmit`: pass
- `node scripts/anti-hardcoding-gate.mjs`: CLEAN
- Not run: full `npm test`, `test:postgres`, live Sarah/Jordan browser rehearsal

## Issue disposition

| Issue | Class | Notes |
|---|---|---|
| V5 composition vs old vertical stack | Act Now | Done in product overview/case screens |
| Fleet hero | Act Now | Removed from overview readiness |
| Tight connection painted red | Act Now | Read-model status + overview membership |
| Overview activity rail without a feed on `OperatorOverview` | Ignore / Accept Risk | Link to Activity; do not invent entries |
| Live Sarah/Jordan D1–D3 click-through | Act Now (next) | Needs demo runtime; not faked here |
| Legacy `/operator` screens | Ignore / Accept Risk | Product path is product-* |

## Next action

Boot the accepted demo runtime and walk Overview + Case for two simultaneous open cases, including connection at-risk then broken, against the V5 reference PNGs.
