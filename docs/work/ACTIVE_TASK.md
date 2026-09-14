# ACTIVE TASK — Northstar Long Horizon A: M2–M5 integration → M6 → C2 candidate

Working-memory ledger (AGENTS.md "long-horizon work"). Reread before each major
phase, after compaction, after delegated work and before declaring completion.
Close an item only with evidence. Lane ledgers are preserved separately:
`M3_ACTIVE_TASK.md`, `M3_CLOUD_ACTIVE_TASK.md` (stale M3 original),
`M4_ACTIVE_TASK.md`, `M5_ACTIVE_TASK.md`.

## Goal

Finish M6 (continuation/recovery of an interrupted run — NOT a restart) and
stop at a C2 candidate. Do not claim C2 passed. No M7/M8.

## Exact identity

- Repo `dropandresetmain-prog/qoder-atlas`; worktree `C:/Dev/qoder-atlas-m6`
- Branch `integration/m2-m6-domain-evaluation`
- Base `data-structure-refactor` = `71f638ed30d01e65981bdd9e5e6128ad067fbf1d`
- Checkpoint A `63e38ba` (345/345 pg); Checkpoint B `9c093dd` (350/350 pg);
  frozen evaluator contracts `ea14ee1` (last remote checkpoint before interruption)
- Recovery session start (2026-09-15): remote/branch HEAD `ea14ee1`; uncommitted
  P7 work in primary; lane worktrees `C:/Dev/qoder-atlas-m6-l{1..4}`.
- Test DB: container `northstar-postgres-test` :55432, isolated lowercase DBs
  via `PGTEST_DB`. Migration allocation M6 `0090`–`0099` (used: 0090, 0091).

## Recovery inventory (verified from disk 2026-09-15)

| Item | State found | Action |
|---|---|---|
| P7 primary: 0091 assessments + reverse-lookup invalidation, PgReassessmentWorker (fencing, retry→UNAVAILABLE, re-enqueue after stale capture), sentinel rename, JSON allowlist, blastRadius, pgEvaluation, M6.md §1–7 | uncommitted; tsc 0; prior full pg run 358/358 incl. m6Reassessment 8 + m6WorldSnapshot | committed `8b4a6cb` |
| L1 booking/connection/overnight | committed `c521262`; 22/22 lane tests | merged `d87eea3` |
| L2 objective/participation | uncommitted; 24/24 lane tests | salvaged `3a9cdf4`, merged `7673a38` |
| L3 support/group/funding | uncommitted; tsc 0; NO tests | salvaged `7d65280`, merged `ba655e7`; tests delegated (lane worktree l3) |
| L4 encounters/predicates/credentials/entry | uncommitted; tsc 0; NO tests; `m6.information` MISSING | salvaged `3da69fd`, merged `d51307a`; information + tests delegated (l4) |
| Place-owned constraints / reachability helpers | already in `ea14ee1` (owner list includes PLACE) | none |

## Phase checklist

- [x] P0–P2 (Checkpoints A, B) — see M2_M5_INTEGRATION.md / M6.md
- [x] P3 dependency registry/closure + structured explanations (in `9c093dd`/`ea14ee1`)
- [x] P4 effective projections (in `ea14ee1`)
- [x] P7 persistence/invalidation/worker (`8b4a6cb`)
- [x] **Checkpoint 1**: salvage + lane merges + `registry.ts`; tsc 0, M6 unit 61/61, focused pg on fresh DB 41/41 (migrate, crossLane, subtype, m6WorldSnapshot, m6Reassessment) → pushed
- [ ] P5/P6 L3 tests; L4 `m6.information` + tests; merge; all-family registry test
- [ ] **Checkpoint 2**: all evaluator families + assessment lifecycle green → push
- [ ] P8 AT fixtures: pure AT suite + PostgreSQL AT suite through `evaluateImpact` + one registry
- [ ] Docs: M6.md §8+ (registry, AT evidence, triage), ACTIVE_TASK
- [ ] **Checkpoint 3**: migrations from empty DB, test:postgres, focused, typecheck, build, lint, gate:anti-hardcoding, diff --check → push (C2 candidate)

## Next action

Checkpoint 1 pushed. Write postgres-integration/m6Acceptance.pgtest.ts (AT01/02/06/10/12/13 + cross-Trip closure);
merge L3/L4 lane results when delegated agents report; add m6.information to registry.

## Critical architecture constraints

- F01–F18 frozen; UnitOfWork contract unchanged (G1: separate read session).
- G12: UUID validation at persistence command boundary before UoW.
- Only registered dependency semantics propagate; FKs are not graph edges.
- Evaluators pure over captured WorldSnapshot; injected clock; no repo reads.
- PASS/FAIL/UNKNOWN only from evidence; absence ≠ PASS. Traveller payer home
  currency is not authoritative → UNKNOWN/explicit input.
- Explanations structured (never prose-only). No M7/M8, no SQLite cutover,
  no provider actions, no demo branches.

## Unresolved findings (triage)

| ID | Finding | Triage |
|---|---|---|
| I-1 | m2SubtypeIntegrity file-level failure at M3+M4 | Investigate Now — not reproduced in 350/358 full runs; re-check at Checkpoint 3 |
| I-6 | Legacy integration.r1 determinism test fails (wall clock) — also at base | Park for Later (A-10) |
| I-7 | Objective targets / success_predicate_kind have no M5 command | Park for Later (M7) |
| I-8 | Jurisdiction has no ISO code; predicates carry issuing-state codes as rule parameters | Ignore / Accept Risk |
| I-9 | Three of four evaluator lane agents died before tests/commit | Act Now — salvaged; tests delegated |
| I-10 | `money.ts` has no exact FX multiply / currency exponent table; funding.ts implements BigInt multiply locally at exponent 2 | Park for Later — promote to money.ts before M8 spend |
| I-11 | One capture's manifest is the union read set; every Journey assessed from a joint capture is invalidated by any input of that capture (over-invalidation, never under) | Park for Later — per-subject manifest pruning is an optimisation; workers capture per subject; recorded in M6.md |
| I-12 | `currentAssessmentView` kept reporting PENDING_REASSESSMENT after a newer assessment was saved outside the worker (work caused by a superseded assessment never cleared) | Act Now — closed: work caused by a superseded assessment is obsolete only when the latest manifest verifies current; regression test in m6Reassessment |

## Evidence references

- Lane evidence: `docs/refactor/evidence/M3.md`, `M4.md`, `M5.md`; M6: `M6.md`, `M6_EVALUATOR_CONTRACT.md`
- Prior-session logs (scratch): `pg_ckptA.tap` 345/345, `pg_ckptB.log` 350/350, `pg_p7full.log` 358/358
