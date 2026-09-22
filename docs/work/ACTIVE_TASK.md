# ACTIVE TASK — Hero E2E recording closure (demo reset + Jordan economics)

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas-a5-hero-e2e-closure`
- Branch: `fix/a5-hero-e2e-closure`
- Starting SHA: `7d4b1f5e3525294ab0585d08ae40d49e7ba3da24` (matched origin tip at start)

## Mission

Close remaining demo/runtime defects for founder video recording:

1. Fast safe demo Reset via proven PostgreSQL clone (productize, not test-only)
2. Jordan incorrect cancellation economics (timed free-cancel window)
3. Jordan mixed-currency cost presentation (`Cost not compared`)
4. Sarah 3x repeatability via product Reset
5. Stale/open-case inspection
6. Final physical browser acceptance

## Checkpoint ledger

- [ ] CP-A — Cancellation semantics + Jordan economic proof
- [ ] CP-B — Shared production baseline clone primitive under `src/`
- [ ] CP-C — Demo runtime Reset using pristine clone handover
- [ ] CP-D — 3x Sarah + Jordan REPLAY founder acceptance

## In progress — CP-A

Root cause (confirmed): Nuitée `cancelPolicyInfos` positive tier `cancelTime` is when the fee *becomes* effective; `lastFreeCancellationDate` was ignored; planner treated first positive fee as current loss immediately.

D3 clock `2026-09-29T21:30+09:00` = `12:30Z` is before free-cancel `2026-09-29T23:59:59Z` → current loss USD 0; scheduled exposure USD 670.77.

FX gap: `fx-rates.json` (USD→SGD 1.35) was hashed but not materialized into PG `fx_observations` → cost comparison UNAVAILABLE → UI "Cost not compared".

## Do not

- Reopen planner/RC-6/authority architecture
- Import `postgres-integration/` into app code
- Accept 60–80s delete+reprovision Reset
- Execute Jordan sandbox in this checkpoint
