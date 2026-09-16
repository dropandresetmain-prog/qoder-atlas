# ARCHIVED LEDGER — Northstar Long Horizon A: M2–M5 integration → M6 → C2 candidate

> Archived from `docs/work/ACTIVE_TASK.md` during post-C5 convergence.
> Historical record only; not the current active task.

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
- [x] P5/P6 L3 tests 28/28 (`d5b23ee`, funding fix `f6c032c`, merged `b08f300`); L4 `m6.information` + tests 46/46 (`1923c1e`, `5470d27`, merged `925e0ab`); registry with 11 families (`9cee67c`)
- [x] **Checkpoint 2**: M6 unit 140/140; m6Acceptance 4/4 on two fresh DBs; full pg on empty DB 362/363 before the I-14 assertion fix; tsc/build/lint/anti-hardcoding/diff --check green → pushed
- [x] P8 AT fixtures: `m6Acceptance.pgtest` (AT01/02/06/10/12/13) `52c3926`; `northstar-v2-m6-acceptance` (AT19/20/21/22, cycles) `a59ae0f`; L3/L4 suites (AT03/04/05/08/09/11)
- [x] Docs: M6.md §8–§11 (registry, AT evidence, API, triage), ACTIVE_TASK
- [x] **Checkpoint 3**: full `test:postgres` from an empty DB 363/363 (incl. migrations); M6 unit 140/140; tsc, build, lint, gate:anti-hardcoding, diff --check green → pushed (C2 candidate). C1 `904eeca`, C2 `89ffe87`

## Next action

STOP. C2 candidate is ready for independent C2 review. Do not claim C2 passed; do not start M7/M8.

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
| I-13 | Funding emitted a blocking UNKNOWN with no explanation when no payer was named | Act Now — closed by L3 `f6c032c` (not applicable) |
| I-14 | Acceptance asserted `enqueueDueReassessments` inserted a row; with an open unit already present the one-open-unit index coalesces (0 rows) — correct behaviour, wrong assertion | Act Now — closed: assert exactly one open durable unit |
| I-15 | `test/acceptance-runner.test.ts` and `integration.r1` fail in the legacy unit run, identically on unmodified lane bases | Park for Later — legacy runtime, wall-clock nondeterminism (A-10) |

## Evidence references

- Lane evidence: `docs/refactor/evidence/M3.md`, `M4.md`, `M5.md`; M6: `M6.md`, `M6_EVALUATOR_CONTRACT.md`
- Prior-session logs (scratch): `pg_ckptA.tap` 345/345, `pg_ckptB.log` 350/350, `pg_p7full.log` 358/358
