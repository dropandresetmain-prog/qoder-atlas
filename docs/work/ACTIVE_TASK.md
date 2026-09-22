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

- [x] CP-A — Cancellation semantics + Jordan economic proof (`29e1ae1`)
- [x] CP-B/C — Shared production baseline clone primitive + demo Reset pristine-clone handover (`17f62f9`)
- [x] CP-D runtime unblock — wall-time authority grants + INPUT_CHANGED claim under CONTROLLED (`b6651b9`, `2df12e4`)
- [ ] CP-D — 3x Sarah + Jordan REPLAY founder acceptance (in progress)

## CP-D notes

- Product Reset: `CLONE_FROM_TEMPLATE`, measured ~4.6–7.8s HTTP
- GRANT_MISSING root cause: grants issued wall Sep 22 invisible under CONTROLLED Sep 21 — fixed in storedExecutionGate (authorityNow = wall)
- Sarah EXECUTING stall: INPUT_CHANGED reassess retries with attempts>0 + wall next_run_at never claimed under CONTROLLED — fixed in pgAssessments.claim
- Open-case inspection: healthy travellers RESOLVED; not five OPEN actionable cases

## CP-A (done)

Root cause: Nuitée `cancelTime` = when fee becomes effective; `lastFreeCancellationDate` ignored.
D3 `12:30Z` before free-cancel `23:59:59Z` → current loss USD 0; scheduled USD 670.77.
FX: materialize `fx-rates.json` (+ JPY→SGD) into PG so costs compare.

## CP-B/C (in progress → commit)

Architecture:
- `src/persistence/postgres/databaseTemplateClone.ts` — reusable TEMPLATE primitives
- `src/persistence/postgres/swappablePool.ts` — atomic pool swap, stable HTTP
- `src/app/demo/demoBaselineIdentity.ts` — migrations+dataset(+sandbox/research) identity
- `src/app/demo/demoBaselineClone.ts` — template build once / working clone / reset handover
- `composeTargetBoot` opens working clone when demo dataset configured
- `demoReset` prefers clone handover; never delete-before-reprovision on that path
- `aitFixtureClone.ts` wraps the shared primitive

Measured (light PG proof `a5DemoCloneReset.pgtest.ts`):
- 3× product Reset: **3499 / 2119 / 2532 ms** (all under 10s)
- Mutation absent after reset; refused reset leaves working world

## Do not

- Reopen planner/RC-6/authority architecture
- Import `postgres-integration/` into app code
- Accept 60–80s delete+reprovision Reset
- Execute Jordan sandbox in this checkpoint
