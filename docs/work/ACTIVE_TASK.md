# ACTIVE TASK — A5.1 FINAL PRODUCT TRUTH + FOUNDER E2E PASS

## Identity

- Worktree: `.worktrees/a5-final-truth`
- Branch: `finish/a5-final-truth-repeat-freeze`
- Base: `docs/a4-final-reconcile` @ `30374c56308c92e6a8bdf7d79ccf260b48fbec03`
- Accepted A4 product: `finish/a4-destination-hotel-robustness` @ `546adf210db8ead343ecdac22b410515665c176a`
- Current phase: **A5.1** (not A5.2 LIVE repeat, not A5.3 gates)

## A5.1 objective

Min Htet can click through Sarah and Jordan from healthy → resolved presentation, understand the product without interpreting internals, and decide whether this is the final recording candidate.

## Amber FAIL diagnosis (frozen)

**WHAT WE KNOW**

- Frontend adapter already maps `FAILED → alert/red`. Not a CSS-only bug.
- During definitive connection failure, `firstBreakpoint` is typically the delayed **TIMING** arrival node with `semanticState: CHANGED` (amber/watch) — correct for delay.
- Consecutive connection `MUST_HAPPEN_BEFORE` edges previously had **no** `semanticState` → renderer showed **neutral**, so the causal story lacked an unmistakable red failure.
- D2 (`connection_below_minimum`) must stay AFFECTED/watch; D3 (`connection_broken` / negative gap) must be FAILED/alert.

**WHAT WE DO NOT KNOW**

- Whether every recovered Original snapshot in historical Cases already carried connection edge states (old snapshots stay immutable).

**KEY ASSUMPTION**

- Annotating producer-owned connection edges from evaluator reason codes is sufficient without painting every CHANGED object red.

**WHAT SHOULD BE TESTED NEXT**

- Founder browser QC of D1→D2→D3 on REPLAY; Sarah smoke after shared UI changes.

## Act Now checklist

- [x] Graph truth: connection edge AFFECTED/FAILED from evaluator
- [x] Case graph above affects; Overview graph above Needs attention
- [x] Cost labels: NEW SPEND vs POTENTIAL DISPLACED-BOOKING LOSS
- [x] Overview camera: reframe on new focus identity only
- [x] Jordan progression harness + founder runbook
- [ ] Founder physical click-through (Min Htet)
- [ ] A5.2 LIVE/SANDBOX on frozen candidate (blocked on founder approval)

## Park

- Full release gates (`npm test`, `test:postgres`, `test:migration`) — A5.3
- Destructive Jordan provider bookings — A5.2
- V5.6/V7.2 semantic redesign; planner/continuation/authority reopen

## Exact next step

Run focused tests for changed modules; push coherent A5.1 checkpoint when green; hand founder runbook.
