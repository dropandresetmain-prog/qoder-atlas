# ACTIVE TASK — Northstar Long Horizon A: M2–M5 integration → M6 → C2 candidate

Working-memory ledger (AGENTS.md "long-horizon work"). Reread before each major
phase, after compaction, after delegated work and before declaring completion.
Close an item only with evidence. Lane ledgers are preserved separately:
`M3_ACTIVE_TASK.md`, `M3_CLOUD_ACTIVE_TASK.md` (stale M3 original),
`M4_ACTIVE_TASK.md`, `M5_ACTIVE_TASK.md`.

## Goal

Integrate accepted M3/M4/M5 lanes onto the accepted M2 base (one PostgreSQL
schema), close G12, then implement M6 (WorldSnapshot read consistency = G1,
registered dependency closure, effective projections, pure evaluators, entry
feasibility, invalidation/reassessment, AT fixtures) and stop at a C2
candidate. Do not claim C2 passed. No M7/M8.

## Exact identity

- Repo `dropandresetmain-prog/qoder-atlas`; worktree `C:/Dev/qoder-atlas-m6`
- Branch `integration/m2-m6-domain-evaluation`
- Base `data-structure-refactor` = `71f638ed30d01e65981bdd9e5e6128ad067fbf1d`
- M3 `milestone-m3-recovered` = `959fff5f87ff0484cbd5eb9c128d508676e581f9`
- M4 `milestone-m4` = `cad6bb8bb3d08f80098fb6a013b4fff077fe3015`
- M5 `milestone-m5-recovered` = `8e3dee0b699ccfacd86e2c942f18d5816e6c673c`
- All four verified against `origin` at start (2026-09-14).
- Test DB: container `northstar-postgres-test` :55432, isolated DBs
  `northstar_m6_*` via `PGTEST_DB` (shared `northstar_test` DB untouched).
- Migration allocation: M1 0001–0009, M2 0010–0029, M3 0030–0049,
  M4 0050–0069, M5 0070–0089, **M6 0090–0099** (MIGRATION_MAPPING.md).

## Phase checklist

- [x] P0 preflight: docs read, SHAs verified, worktree created
- [x] P1 merge M3 → M4 → M5 (`--no-ff`): 23b8bdc, d6880c3, bb2573a (pushed)
- [x] P1 shared fixtures/tests combined; barrels consistent (M2_M5_INTEGRATION.md §2)
- [x] P1A empty-DB migration order proof (integrationCrossLane); subtype matrix 37 kinds × 4 properties (integrationSubtypeMatrix 158/158)
- [x] P1A cross-lane FK reconciliation: 0087 (25 FKs) + orphan/cross-workspace proofs
- [x] P1B G12: travel/support UUID-gated before execute (g12UuidBoundary 22 cases; reviewed diff)
- [x] P1C gates green → **Checkpoint A** `63e38ba` pushed (345/345 pg)
- [x] P2 read session + WorldSnapshot capture + manifest + 0090 scope propagation (G1) → **Checkpoint B** (350/350 pg)
- [ ] P3 dependency registry/closure + structured explanations
- [ ] P4 effective Journey/Programme/Service projections → **Checkpoint C**
- [ ] P5 evaluator registry + families
- [ ] P6 entry/regulatory feasibility
- [ ] P7 invalidation/currentness + durable reassessment seam → **Checkpoint D**
- [ ] P8 AT fixtures (AT01–06, 08–15, 19–22 M6 portions) → **Checkpoint E**
- [ ] Docs: M2_M5_INTEGRATION.md, M6.md, roadmap status; final verification

## Current checkpoint

Checkpoint B (P2) committing: PgReadSessionFactory (REPEATABLE READ READ ONLY),
PgWorldReader (registered-semantic discovery + canonical loading + manifest),
currentness with typed reasons, 0090 trigger scope propagation (once per xact).
Frozen for P3-P5 (separate commit): effectiveItinerary, evaluator contract,
explain helpers, constraintTypes, reachability, assess composer.

## Next action

Push B + contracts; spawn evaluator lanes L1-L4 in worktrees against
docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md; meanwhile primary builds
assessment persistence (0091) + reassessment worker (P7).

## Critical architecture constraints

- F01–F18 frozen; UnitOfWork contract unchanged (G1 decision: M6 adds a
  separate read-session abstraction, not a UoW overload).
- G12: UUID validation at persistence command boundary before UoW; do not
  narrow `SubjectIdSchema`.
- Only registered dependency semantics propagate; FKs are not graph edges.
- Evaluators pure over captured WorldSnapshot; injected clock; no repo reads.
- PASS/FAIL/UNKNOWN only from evidence; absence ≠ PASS. Traveller payer home
  currency is not authoritative → UNKNOWN/explicit input.
- Explanations are structured (cause, affected subject, semantic, evidence
  refs, dimension, status, uncertainty) — never prose-only.
- Ownership: Journey = intent; TransportService/Reservation = supplier truth;
  ProgrammeItem = schedule; InformationVersion = publisher knowledge.
- No runtime SQLite cutover, no provider actions, no demo/Sarah branches.

## Unresolved findings (triage)

| ID | Finding | Triage |
|---|---|---|
| I-1 | Full suite at M3+M4 had one file-level failure in `m2SubtypeIntegrity` (no subtest output); file passes alone 15/15 | Investigate Now |
| I-2 | M4 did not add its ports to repository barrel / pg repositories index | Act Now — closed |
| I-3 | Cross-lane FKs unclosed (25 incl. M4→M3, M3→M4, M5→M4, *→M5) | Act Now — closed by 0087 |
| I-4 | M3 non-additive `ReservationAllocation.reservationId` broke M0 contract suite | Act Now — closed (A-8) |
| I-5 | Scope generations advanced only by 2 M2 commands; M3/M4/M5 advance none → phantom invalidation impossible | Act Now — closed by 0090 (proven in m6WorldSnapshot) |
| I-7 | Objective targets / success_predicate_kind have no M5 command (fixtures seed rows) | Park for Later — M7 planning needs objective commands; recorded in M6.md |
| I-8 | Jurisdiction has no ISO code; entry predicates carry issuing-state codes as rule parameters | Ignore / Accept Risk — parameters are sourced rule content, not engine constants |
| I-6 | Legacy integration.r1 determinism test fails (wall clock) — also at base | Park for Later (A-10) |

## Evidence references

- Lane evidence: `docs/refactor/evidence/M3.md`, `M4.md`, `M5.md`
- Logs (scratch, not committed): `pg_m3m4.log` 138/139, `pg_m5.log` 156/156, `pg_ckptA.tap` 345/345, `pg_ckptB.log` 350/350
- Integration evidence: `docs/refactor/evidence/M2_M5_INTEGRATION.md`
