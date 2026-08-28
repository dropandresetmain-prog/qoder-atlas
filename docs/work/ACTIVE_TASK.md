# ACTIVE_TASK — Implementation Pass 1/2: product truth, state convergence, recovery lifecycle

## Goal

Make Overview grouping/severity correct, eliminate blank terminal squares, converge
Sarah/Elena after programme recovery, give Jordan a real staged recovery lifecycle
that actually executes, propagate Jonas traveller approval across all surfaces, and
preserve Oliver pending-change semantics. All state derived from authoritative
trip/case state — no local UI memory, no person-specific branches.

## Base / branch

- Base SHA: `22e8d0f` (pre RC-7 overlay fix)
- Branch: `main`
- Production: https://qoder-atlas-production.up.railway.app
- Populated entry: `POPULATED_DEMO_BOOTSTRAP_VERSION = 2026-08-28-jordan-preemptive-entry`

## Issue checklist

### Group A — Overview grouping + state
- [x] A1 Jordan standalone incident key
- [x] A2 Jordan red / Needs Attention at populated entry
- [x] A3 Sarah shared cohort counts 4/3/1
- [x] A4 Fleet squares + regression tests (Sarah resolved, Elena watching, Jonas resolved, Oliver)

### Group B — Sarah terminal convergence
- [x] B1 Sarah resolved → green, persists reload
- [x] B2 Elena watching/amber post-Sarah (hero e2e assertion added)
- [x] B3 Other shared-cohort travellers semantically correct

### Group C — Jordan recovery lifecycle
- [x] C1 pre-emptive connection failure at populated entry
- [x] C2 affected chain truthful
- [x] C3 selected recovery staged before approval
- [x] C4 Approve → Execute works (real lifecycle)
- [x] C5 execution → RESOLVED without missed-flight report
- [x] C6 e2e regression (hero + final-demo-lifecycle-convergence)

### Group D — Jonas traveller convergence
- [x] D1 operator waiting-for-traveller
- [x] D2 traveller approve executes
- [x] D3 Traveller + Case + Overview resolved
- [x] D4 operator → `/traveller?trip=<tripId>` link on waiting panel

### Group E — Oliver regression
- [x] E1/E2 hero e2e pass

### Tests
- [x] RC-7 fix + hero e2e 5/5 + connection-feasibility overlay tests + Jordan lifecycle HTTP test
- [ ] Full suite: 794/815 pass; 21 failures triaged below (non-hero integration/presentation)

## Root causes

| ID | Finding | Status |
|----|---------|--------|
| RC-7 | Overlay viability ignored connection-feasibility direct failures, so same-schedule "rebook" strategies ranked best; execute left impossible connection active → CaseVerifier PLANNING. Fix: `assessDirectElementFailures` shared with overlay; infeasible when post-candidate trip still has direct failures. Verified: best strategy now next-day 08:20; execute → RESOLVED/FULLY_RECOVERED without missed-flight ingress. | **FIXED** |

## Acceptance evidence

- `output/probe-rc7-diagnostic.mjs`: reset → plan (best strat 08:20) → begin → approve → execute → RESOLVED
- `test/e2e/hero-lifecycle-rehearsal.test.ts`: 5/5 pass (Overview 4/3/1, Jordan, Sarah+Elena, Jonas nav, Oliver)
- `test/final-demo-lifecycle-convergence.test.ts`: Jordan full HTTP lifecycle pass
- `test/connection-feasibility.test.ts`: overlay same-schedule infeasible / next-day feasible
- `npm run build` + `gate:anti-hardcoding`: CLEAN

## Remaining test failures (21) — triage

| Class | Tests | Triage |
|-------|-------|--------|
| Dashboard trip row missing at READ_AT | T-E2E, G1, DR-8.1/8.6 | **Investigate Now** — harness dashboard projection returns 0 trips post-resolve; not hero-path |
| Presentation fixture drift | r3a x3, case options x4, presentBufferEvidence | **Park for Later** — unit HTML fixtures, not Pass 1 hero |
| DR-4 clickthrough timeout | operator-clickthrough | **Park for Later** — waits for traveller-decision form on operator (Jonas path changed) |
| i5/R1/Wave3 convergence | i5 x2, R1, Wave3 Gate2, product convergence | **Investigate Now** — may share dashboard/read-model seam |
| DR-5/DR-6 HTTP | CHANGE_REQUESTED distinction | **Park for Later** — unrelated to RC-7 |

## Next action

Push RC-7 commit; Railway replay Jordan/Sarah/Jonas/Oliver; investigate dashboard READ_AT seam separately if needed for full 815/815.
