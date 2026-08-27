# ACTIVE_TASK — final/hero-integration

**Branch:** `final/hero-integration`  
**Base:** `origin/main` @ `73c577b4956f9fc9045521adb787e83c9bb81887`  
**Lanes merged:**
1. `final/lifecycle-state-closure` (`d207238`)
2. `final/hero-business-truth` (`e06bd63`)

**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`

## Goal

Integrate the two completed NORTHSTAR closure lanes onto latest main without redesigning either lane. Resolve any conflicts using authoritative scenario/business truth and generic architecture.

## Merge result

- No content conflicts: lanes owned disjoint paths (lifecycle = CTA/state/persistence/projection; hero-truth = planner/fixtures/funding/topology/evidence).
- Hero-truth updates to `docs/DEMO_SCREEN_CHOREOGRAPHY.md` (Jonas Concorde `US$541.83` / `S$731.47`) retained as authoritative business truth.
- Lifecycle CTA/phase/persistence and Sarah same-trip reconciliation retained as authoritative state projection.

## Proof checklist

- [ ] Jordan execute → observe → resolved/revisit
- [ ] Sarah S1→S3 same-trip terminal convergence
- [ ] Oliver Tokyo topology + preserved LHR return + execution/revisit
- [ ] Jonas same Concorde extension + traveller funding + resolved/revisit
- [ ] Focused integration tests
- [ ] Hero browser rehearsal
- [ ] Typecheck
- [ ] Build

## Explicit non-goals

- Do not merge to main
- Do not redesign either lane
- Do not expand into presentation/copy/visual lanes
