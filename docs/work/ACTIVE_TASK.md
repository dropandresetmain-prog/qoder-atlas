# ACTIVE TASK — Post-C5 repository convergence

Working-memory ledger (AGENTS.md "long-horizon work"). Reread before each major
phase, after delegated work and before declaring completion. Close an item only
with evidence. The previous M2–M6 ledger content is archived at
`docs/work/M6_ACTIVE_TASK.md`; lane ledgers `M7..M10_ACTIVE_TASK.md` are
unchanged.

## Goal

Converge the accepted backend (C5), the accepted frontend foundation, the
accepted live read-model lane and the test topology onto ONE authoritative
candidate, then move `main` to it. **No Slice A / Slice B feature work.**

## Exact identity

- Repo `dropandresetmain-prog/qoder-atlas`; primary worktree `C:/Dev/qoder-atlas`
- Convergence branch `integration/post-c5-convergence`
- Base = accepted C5 SHA `87783c0bcbdc12cf263851a36e06b9d5255289ce`
  (branch `milestone-m10-migration-rehearsal`)
- Accepted frontend handoff `6a655ddc0d57d64595e7c8ab207ae8c6ebbb37ab`
  (`integration/wit-frontend-handoff`), semantic source
  `fe09c525528df67a0a5fb5df4811bb7d5feddd77`
  (`review/wit-frontend-semantic-contract-opus`). `20b9b61` is NOT authoritative.
- Accepted live read-model lane `cbe5f837c3c4c45bec576f5ea1022b8a26871520`
  (`lane/wit-live-readmodel-contract`) — CLOSED, no further independent review.
- Stale `main` `8b03934dadee20ec7ec271a45c5769de676dc3e7` — ancestor of C5, never
  merged back into the candidate.

## Topology (verified)

- `merge-base(C5, frontend) = merge-base(C5, readmodel) = c45a928` (M9).
- `merge-base(frontend, readmodel) = fe09c52` (opus semantic contract).
- Stale `main` IS an ancestor of C5 → `main` can fast-forward to the candidate.
- File overlap C5 × frontend: none. C5 × readmodel: `src/app/target/targetHttpHandlers.ts` only.
- File overlap frontend × readmodel since `fe09c52`: none.

## Merge sequence

1. C5 base → convergence branch.
2. Merge `integration/wit-frontend-handoff@6a655dd`.
3. Merge `lane/wit-live-readmodel-contract@cbe5f83`.
4. Planning reconciliation (Slice A / Slice B / submission).
5. Test-suite convergence.
6. Integrated verification → tag → `main`.

## Conflict ownership rule

- **C5 wins**: PostgreSQL-only boot, migration/runtime convergence,
  authority/execution safety, M10/C5 fixes, migration schema semantics.
- **Live read-model lane wins**: read-model contracts, revision/freshness,
  edge identity/authority, assessment lifecycle, changed-visible-ref contract,
  read-model tests.
- **Frontend handoff wins**: semantic adapter/model, visual grammar, design
  reference assets, frontend semantic documentation.

## Phase checklist

- [ ] P1 convergence branch + ledger
- [ ] P2 frontend handoff merged
- [ ] P3 live read-model lane merged
- [ ] P4 roadmap/plan reconciled to Slice A / Slice B / submission
- [ ] P5 test-suite convergence (classification, scripts, guardrails, M2-ACCESS-PATH-PLANNER)
- [ ] P6 integrated convergence verification
- [ ] P7 tag + `main` fast-forward
- [ ] P8 cleanup candidates identified

## Current checkpoint

P1 in progress.

## Next action

Merge the accepted frontend handoff.

## Critical constraints

- **PostgreSQL is the sole NORTHSTAR runtime.** SQLite only as offline
  read-only migration input — never a fallback/alternate/demo runtime.
- Frontend applies the COMPLETE authoritative snapshot; `changedVisibleRefs` is
  an at-least-once transition/emphasis hint, never an exact-diff contract.
- V5.6 mock data is not runtime truth; no mock Sarah facts into backend logic.
- Event Overview prototype is REJECTED/unresolved — do not integrate or freeze it.
- No Slice A / Slice B implementation, no M11 activation, no F01–F18 reopening.
- Exact-path staging; no `git add .`; no casual force-push.

## Findings / triage

| ID | Finding | Triage |
|---|---|---|

## Evidence

(recorded per phase below)
