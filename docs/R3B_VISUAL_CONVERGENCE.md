# R3B — Visual Convergence Evidence

**Lane:** `lane/r3-reference-visual-convergence`  
**Worktree:** `.worktrees/r3-visual`  
**Base:** `origin/lane/r2-populated-demo-world` @ `049ab9d` + merge `origin/lane/r3-projection-closure` @ `57cecb4`  
**Captured:** 27 Aug 2026

Reference baseline: approved fixture previews (`data/ui-preview/` from `src/ui/preview.ts`), verified in UI lane s11 against Kimi renders. Live captures: `output/r3b-visual/` via `scripts/r3b-visual-capture.ts`.

## Screen convergence matrix

| Screen | Reference | Status | Major deltas closed | Intentional remaining differences |
|--------|-----------|--------|---------------------|----------------------------------|
| Overview O1 | `ref-o1-overview.png` | **Converged** | Readout ink block, fleet dot grid + legend, decisions queue, attention-first roster with role lines and mini journey chains, Reset demo control styling | Populated demo has 67 trips vs 9 fixture trips; demo banner; live names/counts/times |
| Programme P1 | `ref-p1-programme.png` | **Converged** | Summary tiles, commitment timeline by day, traveller table with role + arrival columns, footer actions | Event title from live programme; 67 travellers vs 45 fixture |
| Programme P2 | `ref-p2-programme.png` | **Converged** (fixture) | Endangered-commitment callout pattern present when data supplies it | Populated world shows 0 endangered at entry — honest runtime |
| Decisions D1 | `ref-d1-decisions.png` | **Converged** | Waiting now / decided recently tables, nav count pill, case links | Live pending rows from populated world (Jordan/Oliver/Jonas) |
| Activity | `ref-activity.png` | **Converged** (structure) | Day-grouped feed layout | Live activity content from trip audit trails |
| Case C4 (Jordan S2) | `ref-c4-case.png` | **Converged** | Approval panel, authority rail, checks, option cards with provider + home currency, rejected options | Live option count/costs from replay evidence |
| Case C1 | `ref-c1-case.png` | **Converged** (fixture) | Traveller-waiting case layout | Hero cases at entry are approval-heavy (C4/C5) not C1 |
| Traveller T3 (Jordan) | `ref-t3-traveller.png` | **Converged** | Recovery hero, what-changed rows, reason card, progress, viability banner, composer | Hero photo when asset present; live progress steps from projection |
| Traveller T2 (Sarah S1) | `ref-t2-traveller.png` | **Converged** | Disrupted hero + itinerary + viability NOT_VIABLE | Sarah entry state is NOT_VIABLE not awaiting-input |
| Traveller T4 | `ref-t4-traveller.png` | **Fixture only** | Option cards with recommended/rejected chips | Jonas/Oliver hero states differ at populated entry |
| Traveller T7 | `ref-t7-traveller.png` | **Fixture verified** | Resolved reassurance copy | No hero at populated entry in resolved state |
| E1/E2 | programme change preview | **Deferred** | P1 programme footer exposes change-preview affordance | Full E1/E2 rehearsal not in populated entry path |

## Fixes landed in R3B

1. **Overview role lines** — compose uses `projectOperatorDashboardAugmentations` (Lane B) for `roleFor` + journey chains.
2. **Case URL encoding** — `encodeUri()` for case links in dashboard/decisions/programme; `decodeURIComponent` in HTTP case route (colon-safe case IDs).
3. **Programme preview pages** — added to `preview.ts` for visual baseline capture.
4. **Reset demo control** — `.demo-reset-btn` styling in theme.
5. **Visual capture workflow** — `scripts/r3b-visual-capture.ts` for fixture + live comparison loops.

## Responsive pass

| Viewport | Capture | Result |
|----------|---------|--------|
| Desktop 1440px | `live-o1-overview.png` | Pass — hierarchy preserved |
| Laptop 820px | `live-o1-overview-narrow.png` | Pass — topbar compacts, roster stacks readable |
| Traveller 430px | `live-hero-traveller-*.png` | Pass — mobile shell, hero cards, composer |

## Screenshot evidence paths

- Reference fixtures: `output/r3b-visual/ref-*.png`
- Live populated world: `output/r3b-visual/live-*.png`
- Hero flows: `output/r3b-visual/live-hero-traveller-*.png`, `live-hero-case-*.png`
- Manifest: `output/r3b-visual/manifest.json`

## Remaining issues (classified)

| Issue | Classification | Notes |
|-------|----------------|-------|
| Approved PNG renders not in repo (`docs/design-renders/shots/`) | **Accept Risk** | Fixture previews used as verified baseline per UI handoff s11 |
| Hero T4 awaiting-input at populated entry | **Park for Later** | Entry-state orchestration places heroes in recovery/approval; T4 visible via fixture + mid-scenario rehearsal |
| E1/E2 full visual pass | **Park for Later** | Not on filmed entry path; programme change affordance present |
| `decideBy` column often empty on D1 | **Park for Later** | Lane B projection gap — UI renders when present |
| Programme activity feed vs programme-scale activity | **Park for Later** | Per-trip activity honest; day-grouped programme feed is stretch |

## Lane dependencies

- **Lane A:** None blocking visual convergence at populated entry.
- **Lane B:** Role/arrival/timeline projections integrated @ `57cecb4`. Optional `decideBy` / richer decided history still sparse.

## Merge recommendation

1. Merge `lane/r3-reference-visual-convergence` after Lane A/B heads stable on `main`.
2. Order: `lane/r3-projection-closure` → `lane/r2-populated-demo-world` → `lane/r3-reference-visual-convergence`.
