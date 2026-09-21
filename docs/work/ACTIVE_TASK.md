# ACTIVE TASK — Operator Workspace V5 Implementation

## Identity

- Branch: `ui/operator-workspace-v5`
- Worktree: `.worktrees/ui-operator-workspace-v5`
- Starting SHA (physical convergence): `6c6eb3604669c1db7d79e1d97d8a1abb006ae776`
- Role: PRIMARY IMPLEMENTATION OWNER

## Goal

Founder-approved Overview + Case V5 composition on the real frontend, using production V7.2 / V5.6 graphs and authoritative read models.

## Current checkpoint

**Physical convergence pass.** Prior CP6 PARTIAL evidence is rejected. Case rail
now begins beside the V5.6 graph; legacy pre-graph stack removed; person-as-failure
copy fixed; Overview focus selector removed in favour of the graph-owned label;
D2/D3 visual truth and framing corrected at the semantic seam.

## Acceptance checklist

- [x] Case rail beside graph (DOM + 1440 screenshots)
- [x] Legacy lead/pre-graph stack removed; compact affects disclosure
- [x] Person labels never render as “No longer works”
- [x] Jordan D2 amber / D3 red at Arrival timing (semantic projection, not CSS)
- [x] Graph default framing fits primary path (no clipped primary nodes on D3)
- [x] Case rail activity visible at 1440 without nested-only scroll
- [x] Overview focus label agrees with graph pill; selector removed
- [x] Focus hidden on All participants
- [x] Broken readiness concatenation removed
- [x] Activity phrasing drops redundant subject nouns; dedupes identical who+text
- [x] Recommendation card fills main column
- [x] Sarah travel-led recommendation investigated (ACT NOW planner gap)
- [x] Physical screenshots under `docs/work/operator-workspace-v5-physical-convergence-evidence/`
- [x] Focused tests + anti-hardcoding CLEAN + `tsc --noEmit`

## Issue disposition

| Issue | Class | Notes |
|---|---|---|
| Case rail / legacy stack | Act Now | Closed — V5 layout recompose |
| Person-as-failure copy | Act Now | Closed — Trip objective / Requires recovery |
| Jordan D3 visual amber | Act Now | Closed — FAILED relationship upgrades arrival TIMING node |
| Graph framing | Act Now | Closed — camera FIT constants |
| Overview focus disagreement | Act Now | Closed — graph-owned label; no multi-incident select |
| Focus on All participants | Act Now | Closed — `.v5-focus[hidden]` + client hide |
| Readiness concatenation | Act Now | Closed — removed duplicate segments line |
| Activity copy quality | Act Now | Closed for redundant nouns; subjects still depend on feed fields |
| Recommendation width | Act Now | Closed — full main-column width |
| Sarah travel-led recovery | **Act Now** | Planner selected TRANSPORT option 5; programme options 7–8 viable but not recommended — backend/planner work outside this visual pass |
| Approval unavailable in REPLAY | Ignore / Accept Risk | Sandbox execution not composed |

## Next action

Planner/demo selection work so the Sarah hero can surface programme recovery when that is the intended story. Do not frontend-relabel the recorded recommendation.
