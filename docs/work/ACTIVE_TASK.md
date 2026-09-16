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

- [x] P1 convergence branch + ledger — `46ebaf8`
- [x] P2 frontend handoff merged — `85e2e92` (only conflict: `ACTIVE_TASK.md`; lane ledger archived)
- [x] P3 live read-model lane merged — `dd0886d` (only conflict: `ACTIVE_TASK.md`; `targetHttpHandlers.ts` auto-merged and hand-verified)
- [x] P4 roadmap/plan reconciled — `7943f53` (`IMPLEMENTATION_PLAN.md` §22)
- [x] P5 test-suite convergence — `7f4ac85` (M2 access path), `d72c25b` (suites + gate + CI), `d6c9671` (0123 registry)
- [x] P6 integrated convergence verification — see Evidence
- [x] P7 tag + `main` fast-forward
- [x] P8 cleanup candidates identified

## Current checkpoint

Convergence complete and verified.

## Next action

Slice A (`IMPLEMENTATION_PLAN.md` §22.1). First integrated smoke:
known Sarah baseline -> normal product boot -> provider-shaped event through
HTTP -> authoritative PostgreSQL/read-model result. **Not** implemented here.

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
| CV-1 | `M2-ACCESS-PATH-PLANNER`: `itemsReferencingPlace`'s ORIGIN branch planned on `idx_transport_item_details_destination` with a filter, so the origin index assertion failed. Root cause was the test leaving the sibling index in place — the two are each other's incidental alternative — and depending on whether autovacuum had reached the shared database. | **Act Now — CLOSED** `7f4ac85`. Each transport branch is measured with its sibling dropped; tables are `ANALYZE`d before measuring. Reproduced red on a warm DB pre-fix, green cold and warm after. Both indexes exist and are usable; no schema change. |
| CV-2 | Migration `0123` was added by the read-model lane after the cross-lane allocation registry was updated for `0121/0122`; the lane never ran the full PG gate, so convergence was the first run to see it. | **Act Now — CLOSED** `d6c9671`. Registry now asserts `[120,121,122,123]`. |
| CV-3 | `npm start` could not boot: `tsc` emits only `.ts` output, so `dist/persistence/postgres/migrations` did not exist and the boot-time migration run failed with ENOENT. Pre-existing at C5, not caused by the merges. Would have blocked M11 operational activation. | **Act Now — CLOSED** `9bdd662`. `build` now copies the 96 `.sql` files and verifies the count. |
| CV-4 | 66 `HISTORICAL_LEGACY` test files and the retired SQLite modules they cover remain in the tree. | **Park for Later.** The import-graph gate stops them affecting current correctness; deleting them is a separate reviewable change. |
| CV-9 | The boundary gate first followed **every** import edge, so ten tests that merely name a retired module's TYPES (`ui`, `ui-programme`, `presentation-lane`, `r3d-user-contracts`, `case-lifecycle-state`, `connection-feasibility`, `hero-business-truth`, `final-demo-s7-fx-path`, `wave3r-p0-spend-authority`, `wave3r-r1-fixes`) were demoted to non-gating legacy. `import type` is erased at emit, so they never load SQLite — 122 real tests had been dropped out of the gate. Found by cross-checking an independent inventory against the manifest. | **Act Now — CLOSED.** The gate now decides on runtime (value) edges and reports type-only reach as `retired-types-only`. `npm test` 627 -> **749/749**; CURRENT_TARGET 101 -> 111, HISTORICAL_LEGACY 76 -> 66. |
| CV-5 | Suites are separated by manifest, not by directory. | **Ignore / Accept Risk.** `test/suites.json` + `gate:test-boundary` already make conflation impossible; moving ~76 files is churn without added safety. |
| CV-6 | Some `CURRENT_TARGET` unit tests still cover legacy-era pure modules (`src/domain`, `src/resolution`, `src/providers`) that the target runtime may not use. They are green and SQLite-free. | **Park for Later** — dead-code test audit, folded into CV-4. |
| CV-7 | Read-model open items inherited from the closed lane: noisy changed sets on a busy cluster; `LIMIT 200` silent population truncation; graph-level `currentSemanticState` still FAILED-or-HEALTHY; no subject→transport-service edges. | **Park for Later** — recorded in `WIT_LIVE_READMODEL_ACTIVE_TASK.md`; revisit inside Slice A, not before. |
| CV-8 | `/contract-lab` returns 404 on the product runtime. | **Ignore / Accept Risk** — by design. The Contract Lab is a fixture-only dev preview (`scripts/contract-lab-preview.ts`), deliberately not wired into the runtime. |

## Evidence

Candidate `9bdd662` (pre-ledger-close), tag `wit-post-c5-convergence`.

| Check | Result |
|---|---|
| `npm test` (boundary gate + current suite, 66 files) | **749/749 pass**, 0 fail |
| `npm run test:postgres` on fresh DB `conv_final` (45 files) | **462/462 pass**, 0 fail, 114 suites |
| `npm run test:migration` (2 files) | **23/23 pass** |
| `npm run gate:test-boundary` | CLEAN — 179 files classified, boundaries hold |
| `npm run typecheck` / `lint` / `build` | exit 0 |
| `npm run gate:anti-hardcoding` | VERDICT: CLEAN (368 TS files) |
| `npm run acceptance:secret-scan` | VERDICT: CLEAN (329 files) |
| Sarah/Jordan PG regressions | green — `m9SarahTargetE2E`, `m9SarahProgrammeLoop`, `m9JordanMultiActionRecovery` |
| WiT live read-model proof (`witLiveReadModelContract`) | green |
| PostgreSQL boot smoke from `dist` on fresh DB `conv_boot` | `runtime=POSTGRES_TARGET`, migrations applied at boot |
| Live read-model seam over HTTP | `/api/v2/operator/overview` 200 with `changeCursor` / `changedVisibleRefs` / `changedEdgeIds`; `?sinceCursor=` accepted |
| `npm run test:legacy` | **deliberately not run** — non-gating |

Suite sizes: CURRENT_TARGET 111 (66 current + 45 postgres), MIGRATION_BOUNDARY 2, HISTORICAL_LEGACY 66.

## Main convergence

- Candidate `2673714a1b5dbf267aade670532acdc4ee491e5f`, tag `wit-post-c5-convergence`.
- Stale `main` `8b03934` was a strict ancestor → **fast-forward**, no merge of stale
  main into the candidate, no history rewrite, no force-push.
- `origin/main` = `2673714`. Reachable from it: C5 `87783c0`, frontend handoff
  `6a655dd`, semantic source `fe09c52`, live read-model lane `cbe5f83`, M9 `c45a928`.

## Cleanup candidates — PROPOSED ONLY, nothing deleted

Do not delete accepted C5/M10 tags, C5/M10 provenance branches, or audit/review history.

**Safe once reachability is accepted** (all merged into `main`, content fully preserved):
`lane/wit-frontend-semantic-contract`, `review/wit-frontend-semantic-contract-opus`,
`integration/wit-frontend-handoff`, `lane/wit-live-readmodel-contract`,
`lane/wit-demo-programme-seed`, `integration/m7-m8-c3`,
`integration/m2-m6-domain-evaluation`, `m6/evaluators-l1..l4`,
`fix/c2-m6-invalidation-gaps`, `fix/genericity-regression`, `chore/repo-structure`.

**Keep through submission:** `milestone-m10-migration-rehearsal`,
`milestone-m9-product-integration`, `milestone-m2..m8`, `data-structure-refactor`,
and all `m10-candidate*` / `submission-*` tags — C5/M10 provenance.

**Keep — NOT reachable from `main`:** `plan/post-c5-demo-backend-completion`. Its document
was imported into `main`, but with a superseded banner, so the original commit is the only
copy of the exact original text. Tag it before any deletion.

**Not reachable, unrelated to the refactor** (video/demo/cursor experiments) — a separate
decision, out of convergence scope: `archive/video-seq13-*`, `demo-videos-*`,
`video-production-integration`, `video-system-world-production`, `cursor/*`,
`design/live-dependency-graph-v5-6`, `docs/northstar-readme`,
`docs/wit-demo-visual-contract`, `integration/wave3-product`,
`lane/r3-reference-visual-convergence`.

**Local worktrees** (23 besides the primary) are stale for every merged lane above;
prune after the branch decision, not before.
