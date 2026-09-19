# R4 FINAL INTEGRATION + ACCEPTANCE (integration/r4-final-acceptance)

- Base R4 `8c44c30`; merged PG-perf `2534175` (common main `07c3c79`). Worktree `.worktrees/r4-final`.
- **Run counters:** postgres:fast runs = **1** (533/535 then focused fixes); CURRENT_TARGET runs = **1** (1112/1116 then focused fixes); full canonical PG runs = **1** (595 pass / 2 fail / 1 skip @ 1419.6s; cross-lane 0128/0129 fixed focused; m9ReadModelCurrentness passes alone).
- R4-F0 merge: ACTIVE_TASK conflict resolved (R4 ledger on top, PG-perf record kept below as history); `test/suites.json` auto-merged = union; R4's `eventOverview` + `r4PlanningPreferences` pgtests added to `postgresFast` (contract test demanded canonical-minus-heavyweights).
- Focused checks PASS: canonical-test-commands, postgres-fast contract, ait-fixture-suite contract, suite-concurrency (13/13), `gate:test-boundary` (243 files), `aitFixtureClone.pgtest` (7/7).

---

## HANDOFF STATE (2026-09-20, primary continuing — physical Sarah programme GREEN)

**Branch:** `integration/r4-final-acceptance`. Merged: F0 PG-perf, F1 UI language/overlay/dup-cards, F3 baseline/pool/reset, F2 Atlas exec, F2 safety N1-N4, stale tests, F4a presenter `85aaeba`, transport-card presentation fix (this continuation).
**Broad-run counters:** postgres:fast = **1** (533 pass / 2 fail @ 786.9s; both fixed focused); CURRENT_TARGET = **1** (1112 pass / 4 fail @ 43.9s; all fixed focused); full canonical PG = **1** (595 pass / 2 fail / 1 skip @ 1419.6s). Cross-lane 0128/0129 allowlist fixed focused; m9ReadModelCurrentness opaque suite fail passes alone — do **not** re-run full PG.

**Physical evidence (port 4110, DB `r4final`, ADAPTER_MODE=LIVE, Qwen LIVE, Atlas LIVE research + sandbox execution):**
- Reset: overlay shown, **~78–85 s**, baseline **52/67**.
- Apply (expand Simulated airline update `<details>` first — intentional): Sarah Needs attention (**51/67**), 67 listed, plain copy; Qwen LIVE domain suggestion in boot log.
- **Sarah PROGRAMME path PROVEN:** case `521d1e3b-0c22-5bf6-87ad-6255c1aa0eb0`; recommended Move Headline Interview…; exact button `Recover Sarah’s trip` (`data-action=recover` + `data-test=approve-strategy`, filtered by label — never `/Recover/` first()); two EXECUTED intents; RESOLVE → RESOLVED (CURRENT+PASS); Overview **52/67**, Nobody needs attention, Sarah Viable/Confirmed. Shots `40–45` under `docs/work/r4-evidence/shots/` (untracked).
- **Original/Current toggle PROVEN:** `[data-oc-view=original|current]` / `[data-test=original-current-toggle]`; Original panel visible.
- **Graph camera PROVEN stable across poll:** pan transform unchanged after 6.5 s poll (`matrix(1.36705…)` identical).
- TRANSPORT SANDBOX still proven (prior handoff): identities+budget via commands → SELECT_OFFER approve → durable attempt → checkpoint → reconcile → OBSERVED_SUCCESS; attempt count 1.

**Findings dispositions:** see `docs/work/r4-evidence/open-findings-dispositions.md` — dataset PARK; replan PARK (not reproduced); transport card FIXED; minor UI PARK/Accept; N5–N7 remain Park.

**Remaining gates (in order):** `postgres:fast` ONCE → CURRENT_TARGET ONCE → lint/typecheck/boundary/anti-hardcoding/jargon → full canonical PG ONCE on fresh suite fixture.

**Env notes:** `.env.local` in worktree (gitignored). App: `PG_TARGET_DATABASE=r4final HTTP_PORT=4110 ADAPTER_MODE=LIVE node src/main.ts`.

---

# ACTIVE TASK — R4 PRODUCT PARITY + LIVE SARAH VERTICAL (ledger)

- Base: `main` `07c3c797b57a1c74e30c08a9097362edb57dd9d5` (accepted R3 `d9bb9a5` ancestor verified). Branch `feat/r4-product-parity-live-sarah` (worktree `.worktrees/r4`). V7.2 docs cherry-picked (`563320e` -> docs only).
- Parity contract: `docs/work/R4_FRONTEND_PARITY_CONTRACT.md` (frozen R4-C0).
- Test policy: focused only while iterating; CURRENT_TARGET once at integration; full PG ONCE near acceptance.
- **Gate counters (takeover):** CURRENT_TARGET runs = **0**; full PG suite runs = **0**.
- Frozen shared interaction contract (all lanes obey):
  1. Polling never replaces `<main>`; case/overview pages mark regions `data-poll-region="<name>"`; the poller patches only regions whose content changed (guard on `projectionRevision`, NOT the xmin cursor) and never touches `.fg-canvas` unless the graph scene changed.
  2. Controls use `data-action="<recover|decline|escalate|reset-demo|trigger-disruption>"` + `data-*` params handled by ONE document-level delegated client script (shell-owned); inline listeners on replaceable nodes are forbidden.
  3. Graph camera/view/selection/tab/open `<details>`/scroll survive patching; auto-fit only on first render + Home.
  4. User copy goes through `src/ui/copy.ts` vocab; no UUID/enum/provider jargon in visible text (data-* and a `Technical details` `<details>` exempt).
- Lane ownership (branch `r4/<lane>`, worktree `.worktrees/r4-<lane>`): A shell/back/reset/polling/delegation; B overview+V7.2; C Atlas recordings/sandbox; D G01+Qwen+preferences; E1 graph V5.6 fidelity + runtime; E2 Case IA/copy/options/approval; H Decisions/Activity/Programme/Traveller adapters+jargon gate. PRIMARY integrates.
- Collision ownership: `src/ui/page.ts`,`productShell.ts`,`casePolling.ts`,`polling.ts` = A; `product-recovery-case.ts` = E2; `src/ui/graph/*` = E1; `operatorOverviewAdapter.ts`,`product-operator-overview.ts`,`src/ui/overview-graph/*` = B; `recoveryPlanningCoordinator.ts`,`composeTargetBoot.ts` = D (C hands boot wiring to D/PRIMARY).
- Recon (scratchpad `recon/`): legacy-archaeology, current-frontend-defects, backend-gaps, graph-gaps. Key root causes: overview queue-replaces-population (`operatorOverviewAdapter.ts:254`); poll `outerHTML` swap + listener bound to replaced node (`casePolling.ts:70`, `product-recovery-case.ts:421-462`); reset 409 (`targetHttpHandlers.ts:467`); G01 `DEFAULT_CAPABILITIES` (`recoveryPlanningCoordinator.ts:110`); no CGK->SIN Atlas recording; Qwen client never built at boot (and gated on ADAPTER_MODE); preferences reader absent.
- Checkpoints: R4-C0 `e94f15addb53ce5dfd33ccb6de895871a7ae3f8a` (pushed). Others: pending.
- Provider state: Atlas sandbox creds + Model Studio key present in `.env.local` (names only checked). Qwen state: **not yet composed on Lane D** (prefs WIP; G01 committed). Reset state: Lane A has uncommitted `demoReset.ts`. Browser defects/backend defects: see recon list above.

## TAKEOVER INVENTORY (2026-09-19 PRIMARY takeover)

Primary workspace was on unrelated `integration/pg-test-perf`; R4 recovered in `.worktrees/r4`. No R4 lane agents still running (terminals are PG-fixture work). Lane branches forked from `4e90f18` (C0-1), not `e94f15a` (docs-only delta). **Do not discard dirty lane trees.**

| LANE | BRANCH | WORKTREE | HEAD | CLEAN/DIRTY | COMMITTED? | PUSHED? | STATUS | NEXT ACTION |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRIMARY | `feat/r4-product-parity-live-sarah` | `.worktrees/r4` | `e94f15a` | CLEAN | C0 docs | yes | R4-C0 freeze | Integrate lanes |
| A | `r4/a-shell` | `.worktrees/r4-a-shell` | `4e90f18` | **DIRTY** | no new commits | no upstream | shellRuntime + demoReset + region polling + handlers | Finish tests → commit → integrate after D |
| B | `r4/b-overview` | `.worktrees/r4-b-overview` | `4e90f18` | **DIRTY** | no | no | overview-graph/* + eventOverview + adapter | Finish → commit → after E1 |
| C | `r4/c-atlas` | `.worktrees/r4-c-atlas` | `4e90f18` | **DIRTY** | no | no | ~69 recordings + transportResearch + scratch | Clean scratch → commit useful RECORD → last |
| D | `r4/d-qwen-prefs` | `.worktrees/r4-d-qwen-prefs` | `deaa710` | **DIRTY** | G01 `deaa710` | G01 yes | G01 done; G09 prefs uncommitted; **Qwen not composed** | Focused verify G01 → finish prefs+Qwen → integrate FIRST |
| E1 | `r4/e1-graph` | `.worktrees/r4-e1-graph` | `4e90f18` | **DIRTY** | no | no | geometry/scene + graph module edits | Finish → after A |
| E2 | `r4/e2-case` | `.worktrees/r4-e2-case` | `4e90f18` | **DIRTY** | no | no | caseWorkspacePresenter + product-recovery-case + copy | Finish → after H |
| H | `r4/h-surfaces` | `.worktrees/r4-h-surfaces` | `4e90f18` | **DIRTY** | no | no | activity/decisions/programme/traveller adapters | Finish → after B |

**Integration order (unchanged unless collisions force otherwise):** D → A → E1 → B → H → E2 → C.

## Integration progress (takeover 2026-09-19)

| Checkpoint | SHA | Notes |
| --- | --- | --- |
| R4-C0 | `e94f15addb53ce5dfd33ccb6de895871a7ae3f8a` | contract + lane dispatch |
| R4-C1a | `18937dee4fea12fe47970b0f3f81bbfb6a39483c` | Lane D: G01 + G09 + Qwen |
| R4-C1b | `5f83d5de4c4195c2d3edb487c69a4068d8fcc2a1` | Lane A: shell region polling + demo reset |
| docs | `ebdcc1796f15c9a91279ee420eca4d8e1f5795a4` | takeover inventory |
| R4-C2a | `7493746836b4473008831dd65ee6a78f84556d24` | Lane E1: V5.6 scene runtime |
| R4-C2b | `3aa8a3d` | Lane B Overview V7.2 + population |
| R4-C3a | `ccbae68` | Lane H surfaces |
| R4-C3b | `2b40d6b` | Lane E2 Case workspace |
| R4-C4a | `2fa9376` | Lane C Atlas Sarah recordings |
| fix | `3ed8440` | demo disrupt/dataset dotenv merge |
| fix | `4e71cb9` | trigger-disruption empty body (file load) |

**Gate counters:** CURRENT_TARGET runs = **0**; full PG suite runs = **0**.

**Sarah vertical (2026-09-19):** disrupt APPLIED → case `c3ea21a5` → programme Move Headline approve 200 → EXECUTED → RESOLVED (`Sarah Lim Recovered`; Overview Sarah Confirmed). Qwen LIVE + Atlas REPLAY search evidenced. See `docs/work/r4-evidence/sarah-run.txt`.

**Act Now (block FINAL):** (1) CURRENT_TARGET once + full PG once; (2) strip user-visible jargon in overview trip titles + recovery banner; (3) when `external:offer.select` absent, do not soft-fail Recover on recommended transport (prefer executable / clear error).

**Park:** overview-graph overlay intercepts Apply; pool exhaustion after heavy reassessment; Farah/Mei baseline FAIL; duplicate transport option cards.

**Primary HEAD:** `4e71cb99cdc922286e2587d6bd2cd6cb00b572a5` (pushed).

---

# HISTORICAL (ACCEPTED) — PG TEST-PERFORMANCE LANE RECORD (merged from integration/pg-test-perf 2534175)

﻿# ACTIVE TASK — PG AiT FIXTURE CLONE PRODUCTIONIZATION

Live ledger for productionizing proven TEMPLATE fixture clones onto the
authoritative main line. Prior R3/main history below is preserved.

## Identity

- Branch: `feat/pg-fixture-clone`
- Authoritative base: `origin/main` @ `07c3c797b57a1c74e30c08a9097362edb57dd9d5`
- Spike ported via cherry-pick: `c5d4100` → `0fe1974`, `6b1ef17` → `34e605e`
- Fast-tier `d1762f0` is **not** on this line (`test:postgres:fast` absent).
  Fixture lifecycle is gated on clone-consumer membership so a future fast
  suite that excludes heavyweights will not pay fixture construction.
- Role: PRIMARY PostgreSQL test-fixture productionization engineer
- Date: 2026-09-19
- Scope: test infrastructure only; **`src/**` unchanged**

## Integration strategy

Start from current `main` (includes accepted R3). Cherry-pick spike test-only
commits; do **not** merge spike branch (diverges from newer main). Do **not**
force-integrate fast-tier in this milestone.

## Fixture contract (FROZEN)

1. Fixture built **once per suite invocation** that intersects
   `aitFixtureCloneConsumers` (rebuild always; no cross-session cache).
2. Each clone-backed acceptance test / crash world gets its **own database**.
3. Working pools must never equal the fixture DB name.
4. Disposable names only: fixtures `ns_ait_fx_*`, clones `ns_ait_cl_*`.
5. `DROP DATABASE … WITH (FORCE)` only against disposable names; never
   `northstar_test` / templates / unrelated DBs.
6. Fresh-path forever: `productBaselineWorld`, migrate-from-empty,
   materialization/idempotency/replay proofs.
7. PG suite concurrency remains **1** (Park: parallelism).
8. Default suite behaviour: clone when fixture env prepared; explicit
   `NORTHSTAR_PG_AIT_WORLD=fresh` forces fresh and skips fixture build.
9. Product `src/**` untouched; assertions unchanged.

## Acceptance criteria

- Inbox adversarial isolation PASS
- F3/F5/F7 clone by default under suite fixture PASS
- F1 three pristine clones PASS with material timing win
- N1 two pristine clones PASS
- B1/T2 adopted only if A/B identical
- Canonical `npm run test:postgres` once at promotion
- Target wall: <1100s worthwhile; ~900–950s good

## Candidates

| File | Disposition |
|---|---|
| F3/F5/F7 | **ADOPTED** |
| F1 | **ADOPTED** (1 clone per crash world) |
| N1 | **ADOPTED** (1 clone per scenario) |
| B1 Sarah | **ADOPTED** (A/B identical; clone baseline only) |
| T2 provider reprotection | **FRESH ONLY** (step 1 is baseline-construction proof) |
| productBaselineWorld / migrate | **FRESH ONLY** |

## Checklist

- [x] Phase 0 contract + base from main + cherry-pick spike
- [x] Checkpoint 1: lifecycle + inbox + runner (`ba5e95d`)
- [x] Checkpoint 2: F3/F5/F7 + F1 + N1 (`79fed1d`)
- [x] Checkpoint 3: B1 A/B adopt; T2 remain fresh (`11318a3`)
- [x] Checkpoint 4 / Final: suite reuse fix + canonical PG once (`6aee7dc`, `9c31682`)

## Timings

| Item | Value |
|---|---|
| Suite fixture build (canonical) | **74.4s** |
| Clone median (prod proof n=8) | ~920ms |
| Spike clone min/med/max | 762 / 817 / 907 ms |
| F1 three-world setup | **3.4s** (was ~190.8s prep) |
| B1 fresh / clone | 152.7s / **84.6s** |
| Heavyweight subset F3–N1 | 18/18 in 32.3s (+83.5s fixture) |
| Canonical `test:postgres` wall | **1059.1s** (576 pass / 1 pre-existing fail / 1 skip) |
| vs ~1433s baseline | **−374s (−26%)** |

## Current blocker

None — productionization complete on `feat/pg-fixture-clone` @ `9c31682`.

## Next action

Merge/PR when ready. Optional later: T2 step-1 split, PG parallelism (Park).

## Unresolved risks

- composeTargetApplication double-pool on clones — close app before DROP (**Accept Risk**)
- Fast-tier `d1762f0` not on main — fixture gated by consumer membership (**Park**)
- T2 remains fresh until step-1 split (**Park**)
- `m10RuntimePurgeBoot` 200≠404 pre-existing (**Park** / R3 accepted)

---
# MAIN <- R3 DOCUMENTATION RECONCILIATION

Status: **READY FOR MAIN FAST-FORWARD AFTER THE RECONCILIATION MERGE COMMIT**.

- Compared current `main` `d6c845eee1fbe3e610528124d9655edac5582e39` against accepted R3
  `d9bb9a5f03785db60b6657ca7dfe7c182b07dbd3`.
- `main` had one docs-only planning commit after the common ancestor; most of its T2/T3/T4
  sequencing is superseded by the later truth-rebase + accepted R1/R2/R3 state.
- Preserved from main: the dedicated `IMPLEMENTATION_PLAN_HISTORY.md` archival split,
  sparse-review/routing intent where still compatible, and the principle that Overview /
  observability do not redefine the recovery engine.
- Current R3 docs now state the accepted R3 runtime truth and the new sequence:
  provider parity -> all Atlas -> remaining required adapters -> B2 -> post-E2E product work.
- No production code changed in this reconciliation.

---

# ACTIVE TASK ΓÇö R3 LOCAL ACCEPTANCE (real PostgreSQL + normal runtime + browser)

Live ledger for the R3 local acceptance lane. The R3 Cloud, R2 and R1 history below is preserved
unchanged; Cloud claims are NOT rewritten as local evidence.

## R3 local identity

- Branch: `feat/r3-local-acceptance`, created from the exact R3 Cloud HEAD
  `7d5c10ae8a2dc27057f6715914f4b42466beec9d` (`feat/r3-full-rebased-b1-cloud`); accepted R2 base
  `6118f427eb5fdaed4941e918276fa3260acd9d0c` verified as ancestor; tracked tree clean at start;
  user artifacts (`.founder-b1-*`, `.claude`, `.worktrees`) untouched.
- Environment: Windows 11, **Node v24.15.0** (default `node`), PostgreSQL 16 + PostGIS container
  `northstar-r1-postgres-test` on port 55433, disposable DBs from `template_postgis`
  (`r3local` focused, `r3boot*`/`r3conn` boot runs, `r3full` full suite). Playwright Chromium
  (full-page screenshots read back and inspected); the in-app browser pane screenshot was flaky.
- Post-R3 input only (NOT merged here): `design/event-overview-v7-2` @
  `563320e4e9ef7c2ea7dc4f53f0d07b3045dcfeb1` (docs-only Event Overview Graph v7.2 design).

## Results

| Step | Result |
| --- | --- |
| Pure focused R3 + adjacent R1 (9 files) | 54/54 after two hermeticity fixes (below) |
| `r3ComposedB1Full.pgtest.ts` | PASS (after test fix) |
| `b1ProductPlanningCoordinator.pgtest.ts` | PASS |
| `b1RecoveryLoop.pgtest.ts` | PASS |
| `b1SarahWorldRecovery.pgtest.ts` | PASS |
| `r1ComposedB1.pgtest.ts` | PASS |
| `r1ConnectionRecovery.pgtest.ts` | PASS |
| Normal boot (`src/main.ts`, PG, REPLAY) | log: `[atlas] transport research composed (mode=REPLAY, read-only)`; C4 opens/plans cases; `POST /strategies` returns `{ok,result}` |
| Typecheck / lint / test-boundary (232) / anti-hardcoding | clean |
| CURRENT_TARGET (`npm run test:current`) | 1037/1037 |
| Full PostgreSQL suite (run ONCE, fresh DB `r3full`) | **570/571**; sole failure `m10RuntimePurgeBoot.pgtest.ts:88` (`200 !== 404`) |

## Fixes made locally (all generic, no scenario keys)

1. `test/r3-import-guard.test.ts` ΓÇö normalise Windows path separators (guard compared `\` vs `/`; product code was correct).
2. `test/r3-transport-research-composition.test.ts` ΓÇö the LIVE-without-credentials test read the developer's `.env.local` (holds Atlas creds); now loads config from an empty cwd.
3. `postgres-integration/r3ComposedB1Full.pgtest.ts` ΓÇö asserted the Original snapshot existed at case open; by the R2 design the progression pass captures it at the FIRST SETTLED FAILING basis. Assertion moved after wake 1 (and asserts absence before it).
4. `src/ui/screens/product-recovery-case.ts` ΓÇö browser finding: planning evidence never rendered researched tools/provenance, and the three rejected transport options were identical lines. Now renders `Research: <tool> ΓÇö <status> ┬╖ <provenance>` (an UNAVAILABLE tool makes no provenance claim) and each option's per-subject outcome (`Participant 1: Fail ΓåÆ Fail`). New pure test in `test/r2-case-workspace-integration.test.ts`.

## Real-runtime findings

- **Normal boot, founder dataset (`ait-summit-2026` + disclosed airline event)**: the disruption opens a Case for the reprotected traveller; TRANSPORT + PROGRAMME both investigated; programme time-swap candidates evaluated (one RECOMMENDED, one VIABLE_NOT_RECOMMENDED, rest rejected deterministically). `flight.search` is honestly `UNAVAILABLE: recording_not_found` ΓÇö the checked-in Atlas REPLAY recordings cover only MNLΓåÆCEB on 2026-09-05, not the founder programme's corridors. Not an R3 defect; a **recording-coverage gap** carried to provider restoration. Consequently the founder-dataset browser flow does NOT show a researched travel alternative; that was shown on the recording-matching world below.
- **Normal boot, recording-matching world (`main.ts`, REPLAY)**: `flight.search SUCCEEDED / REPLAY`; 3 transport alternatives rejected deterministically (retained, visible on the page); programme strategy recommended from VIABLE only. Offers departing before the wall clock are filtered (documented honest filter), so planning used an **acceptance-only JS clock shim in the launch script** (runtime code untouched). The shim breaks reassessment claiming (DB `next_run_at` is real-time), so approvalΓåÆexecutionΓåÆresolution ran on the real clock after restart.
- Approve via the page button ΓåÆ one ActionPlan, two `internal:programme.schedule` intents (only internal capabilities; no Atlas mutation) ΓåÆ observation ΓåÆ reassessment ΓåÆ C4 RESOLVE (`resolution_gate_passed_and_reconciled`). Current graph: traveller Healthy, whole-trip PASS. Original tab still shows the failing graph, JSON-identical across approve/execute/resolve. `POST /strategies`: 200 `{ok,result}`, repeat idempotent (same attempt), unknown case 404, RESOLVED case 409.
- **Second generality, normal boot**: connection world (no programme) ΓåÆ TRANSPORT + TRANSFER investigated, PROGRAMME not applicable, REPLAY flight search, transport option recommended; same coordinator/RC-6/comparator. (External SELECT_OFFER approval remains B2/provider-restoration scope, not approved here.)
- Passenger derivation: allocations for the journey item ΓåÆ else the journey's 1:1 traveller ΓåÆ else `passengers_unknown` fail-closed (`transportCorridors.ts`); no env variable, no runtime constant.

## Browser findings (physical, Chromium screenshots)

- Disrupted/Planning: first break point + cause clear; Current shows failed traveller; planning section separate from the graph.
- **Causal spine**: the R3 layout places backend causal refs left-to-right (traveller ΓåÆ programme commitment) with context nodes (disruption, service, case) in a secondary column. The backend causal path currently contains only the failing participation step, so the visual story is NOT the fuller "changed service ΓåÆ arrival consequence ΓåÆ breakpoint ΓåÆ commitment" chain; that requires backend causality (not changed here). Parked.
- The replacement flight shows "Unknown / unconfirmed", not green, in the seeded worlds (no service-level evaluation). Parked.
- Known R2 debt still visible: raw UUIDs in Partial Recovery / Recovery Actions and a "Strategy <uuid>" line. Not blocking; left.

## Checkpoints

| Checkpoint | SHA |
| ---

## FINAL

- Full PG suite ran **exactly once**: 571 tests, 570 pass, 1 fail (`m10RuntimePurgeBoot.pgtest.ts:88`, `/operator` expected 404, got 200).
- Disposition: PRE-EXISTING, not caused by R3. Re-run alone on this branch (fails identically) AND on an isolated worktree at accepted R2 `6118f427eb5fdaed4941e918276fa3260acd9d0c` (fails identically, actual 200 / expected 404). Cause: the test predates the Founder B1 product repair, which deliberately made `/operator` a product route; the assertion is stale. Left unchanged (out of R3 scope); Park for Later.
- No other PG failures; no file-start races observed.
- FINAL SHA: the commit carrying this section (see `git log`); pushed to `origin/feat/r3-local-acceptance`.

---

 | --- |
| L1 focused PG + test hermeticity | `6eee7333dd95278eb2fd27775429283106c66be0` |
| L3 planning-evidence tools/provenance UI | `5f972115a200953142ef490fb15ce275869d9d50` |
| FINAL | see FINAL section |

---

# ACTIVE TASK ΓÇö R3 FULL-REBASED-B1 INTEGRATION (CLOUD)

Live working-memory ledger for the R3 Cloud lane. Reread before every phase, before every
checkpoint commit/push, and before the final report. The R2 local-acceptance ledger, the R2
Cloud ledger and the R1 history below are preserved unchanged and are NOT rewritten.

## R3 identity

- Repository: `dropandresetmain-prog/qoder-atlas`
- Working branch: `feat/r3-full-rebased-b1-cloud`
- Exact base SHA (accepted R2, frozen): `6118f427eb5fdaed4941e918276fa3260acd9d0c`
  (`feat/r2-local-acceptance`). The clone is single-branch on `main`, so the base was fetched
  explicitly (`git fetch origin feat/r2-local-acceptance:...`) before branch creation;
  ancestry verified, clean tree, no unrelated/untracked user artifacts touched.
- Outcome branch for publication: `qoder/general-session-dgm349`
- Role: PRIMARY R3 full-rebased-B1 integration lead.
- Harness: Qoder Cloud. **Test runtime is `/opt/playwright-driver/node` (v24.15.0)**; the
  default `node` is v20.18.0 and CANNOT strip TS types. No PostgreSQL, no Docker, no
  physical browser, no LIVE provider credentials.
- Authoritative R3 contract: `docs/work/R3_INTEGRATION_CONTRACT.md` (R3-C0 freeze).

## R3 objective

Prove the complete rebased B1 flow through the **normal production composition**. R3 is
composition + end-to-end product integration over the accepted R1/R2 foundation ΓÇö no rebuild
of the PostgreSQL ownership/state model, M6, RC-6, the coordinator core, decision evidence,
the comparator, the domain registry, the proposers, durable attention, C4 progression,
internal ActionPlan execution, authority, reconciliation, the Case workspace, focused V5.6
graph semantics, the immutable Original snapshot, the polling model or the renderer
architecture.

## Phase 0 recon ΓÇö COMPLETE (six parallel read-only lanes, reconciled by PRIMARY)

Verified: **exactly two** real composition gaps exist at the R2 base; every other B1 step
already exists and is composed.

| Lane | Finding |
| --- | --- |
| A1 runtime composition | `composeTargetBoot.ts:182-187` builds the coordinator with only `pool/workspaceId/actorPrincipalId/uow` ΓÇö no `transportPlanning`. C4 already receives that one instance (`recoveryProgressionPass.ts:237`). **No provider adapter is composed in target boot at all.** |
| A2 stale HTTP seam | `POST /api/v2/cases/:id/strategies` (`targetHttpHandlers.ts:317-327`) calls the pre-R1 `proposeRecoveryStrategies`; sole importer is `targetHttpHandlers.ts:5`. `planCaseDetailed` has **zero** production callers. `runtimeHooks` is the established bootΓåÆHTTP seam. |
| A3 passengers | `transportPlanning.passengers` is a **static** value threaded into 4 call sites. **Age categories exist nowhere in canonical state** ΓÇö `travellers` has no DOB/age/type; `allocation_role` is free-form. |
| A4 acceptance map | Only the two expected gaps. No other real gap. |
| A5 graph layout | `computeLayout` (`layout.ts:48`) ranks longest-path from sources ΓåÆ traveller-rooted star. `causalNodeRefs` is ordered and already computed (`index.ts:53`) but **not passed** to `computeLayout` (`index.ts:68`). |
| A6 test plan | `test/suites.json` must register every new file or the boundary gate fails `UNCLASSIFIED`. Anti-hardcoding scans `src/` only; tests/fixtures are exempt. |

### PRIMARY overrides of recon recommendations (binding on all lanes)

1. **A3's "count Trip co-travellers" default is REJECTED as unsafe.**
   `pgWorldReader.ts:100-104` loads `journeys` only for ids in the manifest focus, so a Trip's
   sibling journeys are generally absent from the captured planning world ΓÇö that derivation
   would silently return 1, i.e. a hardcoded `adults: 1` disguised as state derivation.
   Authoritative path instead: `world.allocations` by `journeyItemId` (includes peer-traveller
   expansion, `pgWorldReader.ts:258-366`), else the corridor's own journey's single traveller
   (legitimate because `journeys` is 1:1 `traveller_id`, `0021_journeys.sql:41-42`), else fail
   closed with a `passengers_unknown` gap. Children/infants stay `undefined`; each derived
   person maps to `adults` because the request schema requires `adults >= 1`. This is a
   documented uncertainty, never silent.
2. **A4's "optionally delete `recoveryPlanning.ts`" is REJECTED.** That module still owns
   `advanceCasePhase`, live in `recoveryApproval.ts:34` and `recoveryPlanningCoordinator.ts:64`.
   Disposition: keep the module, retire only the `proposeRecoveryStrategies` product seam, and
   add a static import guard against regression.
3. **A4's "migration 0126 / `original_case_graph_snapshots`" is CORRECTED**: the Original
   snapshot is migration **0127**, table `recovery_case_graph_snapshots`. Migrations apply
   through 0127.
4. **A1's "passengers may come from env/config" is REJECTED** ΓÇö no runtime constant, no
   env-var demo value. It must be derived per ┬º3 of the R3 contract.

### New risk surfaced by PRIMARY (not in any lane report)

`postgres-integration/b1RecoveryLoop.pgtest.ts:178-190` and
`postgres-integration/b1SarahWorldRecovery.pgtest.ts:159-166` assert the **legacy
`{ report }` response shape** over HTTP and are both classified **CURRENT_TARGET (postgres)**.
Lane B changes that shape, so these two files must be migrated in the same lane. Cloud cannot
execute them: migration is typechecked here and proven locally.

## Lane ownership

- LANE A ΓÇö normal runtime transport-research composition (`composeTargetBoot`, provider
  capabilities, passenger resolver). PRIMARY owns the shared contract; write lane delegated.
- LANE B ΓÇö retire the stale product planning seam; route HTTP through the shared coordinator;
  UI control contract; migrate the two CURRENT_TARGET PG tests; static regression guard.
- LANE C ΓÇö author the full B1 PostgreSQL acceptance test + preserve the second generality proof.
- LANE D ΓÇö causal-spine layout (presentation only).
- LANE V ΓÇö independent verification / anti-hardcoding audit.
- PRIMARY retains: architecture, shared contracts, runtime composition, provider/research
  boundary decisions, integration, final acceptance judgement, and all edits to
  `test/suites.json`.

## Cloud limits

Cloud MAY author PG tests and runtime/provider composition, run pure tests, use checked-in
REPLAY recordings, typecheck, lint, run CURRENT_TARGET and the static gates. Cloud MUST NOT
claim PG E2E passed, migration/runtime transaction behaviour passed, a real browser flow
passed, or LIVE Atlas worked. Focused tests first; the full PostgreSQL suite is a LOCAL
milestone-acceptance activity only and never runs here.

## Checkpoints

| Checkpoint | Scope | SHA |
| --- | --- | --- |
| R3-C0 | Integration contract + acceptance map frozen; recon reconciled | `50ec443fe4b748712cad5cd1a6935bb14f417e40` (pushed) |
| R3-C1 | Normal runtime planner/provider composition | `edc0b52` (pushed) |
| R3-C2 | Product planning path uses the accepted coordinator + regression guard | part 1 `ac1b644` + part 2 `4f3de02` (pushed) |
| R3-C3 | Full B1 PostgreSQL acceptance test authored + typechecked | `4323d2e` (pushed; PG execution is a LOCAL proof) |
| R3-C4 | Causal-spine layout improvement | `053e6b0` (pushed) |
| R3-C5 | Cloud integration (focused + adjacent + typecheck + lint + boundary + anti-hardcoding + CURRENT_TARGET once) | verified at HEAD `4323d2e`: focused R3 suites 24/24 + adjacent R1 20/20, CURRENT_TARGET **1036/1036** (v24 binary ΓÇö bare `npm test` uses node v20 which cannot strip TS types), typecheck clean, full ESLint clean, boundary 232 CLEAN, anti-hardcoding CLEAN |
| docs | Local acceptance handoff (20 proofs + exact commands) | `6d72a16` (pushed) |

R3 commit log on `feat/r3-full-rebased-b1-cloud` (base `6118f427`):
`50ec443` ΓåÆ `edc0b52` (C1) ΓåÆ `053e6b0` (C4) ΓåÆ `6d72a16` (handoff) ΓåÆ `ac1b644` (C2.1)
ΓåÆ `4f3de02` (C2.2, HEAD). Cloud-verified so far: typecheck clean, focused R3 suites
green, import guard 7/7, boundary gate 231 files CLASSIFIED, anti-hardcoding CLEAN.

## Unresolved local proofs

All 20 local proofs are listed in `docs/work/R3_LOCAL_ACCEPTANCE_HANDOFF.md`. Nothing in R3
Cloud may be reported as PG-proven, browser-proven or LIVE-proven.

## Next action

1. [DONE] Phase 0 recon (six lanes) reconciled; PRIMARY overrides recorded.
2. [DONE] R3-C0 contract freeze (`docs/work/R3_INTEGRATION_CONTRACT.md`) + this ledger; commit + PUSH.
3. [DONE] Lanes A (C1 runtime composition), D (C4 causal-spine layout), B part 1 (C2.1 product seam) committed + pushed.
4. [DONE] Lane B part 2 (C2.2): migrated `b1RecoveryLoop` + `b1SarahWorldRecovery` to the
   `{ ok, result }` coordinator contract via `app.runtimeHooks.planner`; NEW
   `b1ProductPlanningCoordinator.pgtest.ts` (200/AWAITING_AUTHORITY/evidence/idempotency/404/409);
   NEW pure `r3-import-guard.test.ts` 7/7; suites registered; boundary 231 CLEAN.
   Commit `4f3de02` pushed.
5. [DONE] Lane C (`r3ComposedB1Full.pgtest.ts`) committed as R3-C3 `4323d2e`; Lane V audit
   complete ΓÇö 9/10 PASS, one HIGH finding (materialization dropped `passengersFor`) FIXED in
   the same commit with a resolver-only regression test; the two LOW items (formatting glitch,
   suites.json classification) also resolved.
6. [DONE] R3-C5 Cloud integration verified at HEAD (see checkpoint table). Ledger updated.
7. [DONE] Doc reconciliation + final report; terminal status recorded. Local B1 acceptance
   (20 proofs in `docs/work/R3_LOCAL_ACCEPTANCE_HANDOFF.md`) remains the founder's step.

---

# ACTIVE TASK ΓÇö R2 LOCAL ACCEPTANCE (durable Original + PG + browser)

Ledger for the R2 LOCAL integration/product-acceptance lane. The R2 Cloud ledger and the
R1 history below are preserved unchanged.

- Branch: `feat/r2-local-acceptance`, created from the exact R2 Cloud HEAD
  `1ace8fc4408970673a9c378683a41e1617f86191` (accepted R1 base `dc73aa9a51abf80a6e3b65abacf6bc5929223638`);
  ancestry verified, clean tree, user's untracked `.founder-b1-*`/`.claude`/`.worktrees` untouched.
- PG environment: `northstar-postgres-test` (PostGIS 16) on `localhost:55432`; browser harness DB `northstar_r2dev`.
  Node v24.15.0. Migrations apply through **0127**.

## Product decision (2026-09-19): Original = immutable persisted first truthful focused Case graph

Supersedes the Cloud interim "Original = first graph seen this browser session" (kept below as history).
- **Table** `recovery_case_graph_snapshots` (migration 0127): PK (workspace, case, `snapshot_kind='ORIGINAL'`), case FK, optional
  basis-assessment FK, `snapshot jsonb` (object, `pg_column_size <= 262144`), `captured_at`, actor. Insert-once
  (`ON CONFLICT DO NOTHING`); UPDATE/DELETE refused by trigger; INSERT bumps the case read-model cursor (EVALUATION_LIFECYCLE).
  No CURRENT rows, no timeline.
- **Payload** (strict typed `OriginalGraphSnapshotPayloadSchema`, v1): `caseStatusAtCapture`, `ldg` (nodes<=200, edges<=400, poll-relative
  change hints neutralised), `focusedGraph`, `subjectLabels`(<=200). No HTML/SVG/layout/camera/animation. Unknown keys refused; causal refs must resolve.
- **Trigger**: the case-lifecycle progression pass (`progressCase`) calls `ensureOriginalCaseGraph` at the FIRST SETTLED FAILING basis, **before**
  any dispatch (resolve/plan/attention). Capture requires: active case, trip verdict FAIL, mapped causal path, no PENDING_REASSESSMENT node.
  Otherwise nothing is stored ("not yet truthful"). A capture failure never blocks recovery (retried next wake).
  Truthful because it is exactly the first projection where the failing graph is settled, recorded with exact `capturedAt` + basis.
- **Read path**: `RecoveryCaseView.originalFocusedGraph?` (historical evidence). CURRENT = `view.ldg`/`view.focusedGraph`, never reads it.
  Cases with no stored Original show an honest unavailable state (Current is never a substitute).
- **UI**: `src/ui/originalCurrent.ts` rewritten (display-only, delegated listener); Original rendered by the same V5.6 renderer.

## Checkpoints (all pushed)

| Checkpoint | Scope | SHA |
| --- | --- | --- |
| L1 | migration 0127 + typed snapshot contract + commands + capture at first settled failing basis + PG tests | `ba393fe94f1c677731c7679332aaec4d0eb3b0ac` |
| L2 | read model + Original/Current UI + multi-canvas/swap-safe graph script | `6c9b11945c0bc1d911c21104c9ac8c08093553cf` |
| L4 | real-browser acceptance fixes (cards, wording, canvas init) | `f6dc3f9ee1a0cc17dcf13c9f4ccde5b5177824b9` |
| FINAL | docs / acceptance record | see final report (docs-only commit on top of L4) |

## Real-browser findings and generic fixes (Playwright/Chromium against live PG, real product HTTP)

Found: overlapping/clipped cards; raw place ids and host-timezone `Date` strings on cards; raw codes/uuids in case heading, first-breakpoint
callout and Why; **Original canvas never initialised** (no script emitted for it) and initial fit ran at zero size; polling swap killed pan/zoom
and the toggle (scripts in swapped markup do not run; listeners bound to replaced nodes). Fixed: uniform card footprint + clamped text + hover
title; place names + UTC windows; `humanizeCode` + subject labels; init-on-show/DOMContentLoaded; per-canvas state kept across swaps; delegated toggle.

## Acceptance evidence

- Focused PG: `r2OriginalGraphSnapshot` 7/7, `r2FocusedCaseGraph` 6/6 (incl. connection-world Original), R1 trio 7/7, cross-lane/subtype allowlists 24/24.
- Full PostgreSQL suite (run ONCE): 568/569 pass; the single failure is `m10RuntimePurgeBoot.pgtest.ts:88` (`200 !== 404`), the identical documented historical baseline failure (not re-proven on the R1 base in this run); no other failures, no file-start races.
- CURRENT_TARGET 1016/1016; typecheck, eslint, boundary gate (227 files), anti-hardcoding: clean.
- Browser (`accept.mjs`, 31/31): stored Original renders; pan/zoom/home/views/selection; alert no pulse, watch 3.6s, reduced-motion none;
  polling ~4s with `sinceCursor`, no swap when unchanged, hidden pauses, terminal stops; Original tab + graph state survive swaps;
  Original byte-identical after approve/execute/resolve, page refresh and full browser restart; Current becomes healthy; no WS/SSE; no console errors.
- Generality: connection world (no programme) renders through the same code ΓÇö no programme/objective nodes, no Sarah geometry.

## R3 / carry-forward (not R2)

Stale `POST /strategies` -> RecoveryPlanningCoordinator routing; boot-time transport research composition; external SELECT_OFFER approval and
provider execution; B2; Event Overview redesign; semantic Activity redesign. Presentation debts noted: graph orients by producer edge direction
(traveller-rooted star, not a causal chain left-to-right); Partial recovery / Recovery actions blocks still show raw uuids (pre-existing M9 surfaces);
header subtitle is backend `changeSummary` prose with raw codes.

---

# ACTIVE TASK ΓÇö R2 Case Decision Surface + Focused Graph (CLOUD)

Live working-memory ledger for the R2 Cloud implementation lane. Reread before every
major phase, before every checkpoint commit/push, and before the final report. The
completed R1 acceptance/history is preserved below and is NOT rewritten.

## R2 identity

- Repository: `dropandresetmain-prog/qoder-atlas`
- Working branch: `feat/r2-case-decision-surface-cloud`
- Base SHA (accepted R1, frozen): `dc73aa9a51abf80a6e3b65abacf6bc5929223638`
  (`feat/r1-local-integration`). Verified present; branch created directly from it.
- Ancestry: base SHA IS the branch point (verified). Working tree clean at start.
- Role: PRIMARY R2 Case-decision-surface + focused-graph implementation lead.
- Harness: Qoder Cloud sandbox. Node v24 for tests is `/opt/playwright-driver/node`
  (v24.15.0); the default `node` is v20 and CANNOT strip TS types. Pure `current`
  tests DO run here via the v24 binary. **No PostgreSQL, no browser** ΓÇö physical/visual
  acceptance DEFERRED to local.
- Authoritative contract: `docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md` (R2-C0 freeze).

## R2 contract state

- R2-C0 contract freeze: DONE (this commit). Simplified graph decisions reconciled
  into living SSOT (`live-dependency-graph/README.md`, `WIT_DEMO_VISUAL_AND_PRODUCT_CONTRACT.md`,
  `WIT_FRONTEND_INTEGRATION_HANDOFF.md`, `DESIGN.md`, `FRONTEND_SEMANTIC_CONTRACT.md`).
- Minimum additive contract frozen: optional `focusedGraph` block on `RecoveryCaseView`
  (`causalNodeRefs[]`, `causalEdgeIds[]`, `firstBreakpoint?`, `unmappedCausalSteps[]`).
  No `focalNodeRef`. No LDG-wide change. No `stateLabel` field unless a concrete need
  appears (reuse `SemanticIndicator.label`). CHECKING = existing `evaluation:
  PENDING_REASSESSMENT`. Trip purpose = existing `objectives` ontology (migration 0072).

## R2 lane status

- Phase 0 recon (A1-A5 read-only): COMPLETE. Findings reconciled by PRIMARY.
- R2-C1 part 1 (contract + pure causal mapping): DONE ΓÇö SHA
  `333615dcb8030d181dad3dffec10843ed0ff2f2b` (pushed). `FocusedGraphView` frozen;
  `projectFocusedGraph` pure; 8/8 focused tests; current suite 941/941.

### Frozen cross-lane seams (PRIMARY-owned; do not fork)

- **Lane B renderer entry** (`src/ui/graph/index.ts`):
  `renderFocusedCaseGraph(input: { ldg: LiveDependencyGraph; focusedGraph?: FocusedGraphView; caseStatus: RecoveryCaseView['status']; }): string`
  ΓÇö server-rendered HTML/SVG string. B internally calls the EXISTING
  `presentDependencyGraph` (single semantic mapping layer) with `causalRefs`
  from `focusedGraph.causalNodeRefs` and `causalEdgeIndices` looked up from
  `focusedGraph.causalEdgeIds` (index lookup, never traversal). Pulse = CSS
  only, derived from tone. No backend liveness fields.
- **Lane D modules**: `src/ui/casePolling.ts` exporting
  `casePollingScript(options: { caseRef: string; intervalMs?: number }): string`
  (inline `<script>`, complete-snapshot HTML swap, revision-gated like overview
  polling) and `src/ui/originalCurrent.ts` for the non-mutating Original/Current
  toggle presentation. D does NOT edit screens; PRIMARY wires.
- **Lane C** consumes B + D via PRIMARY integration after wave 1 lands.
- Children never commit; PRIMARY reviews every diff, runs gates, commits/pushes
  per lane. New test files must be reported for `test/suites.json` classification
  (shared file ΓÇö PRIMARY edits only).
- Test runtime in Cloud: `/opt/playwright-driver/node --test <files>` (v24).
  Default `node` is v20 and cannot strip TS types.

## R2 lane status (detail)

- Phase 0 recon (A1-A5 read-only): COMPLETE. Findings reconciled by PRIMARY.
  - A1 backend map: `RecoveryCaseView` already carries `causalPath`, `planningEvidence`,
    `attention`, `strategies`, `recoveryActions`, `connectionProgression`, `ldg`,
    `change`. Missing: explicit causal-ref mapping, first-breakpoint pointer, Original
    snapshot. HTTP: `GET /api/v2/cases/:id` (+`?sinceCursor`, `?format=html`).
  - A2 Case archaeology: TWO case UIs ΓÇö rich `operator-case.ts` (18 sections, served
    ONLY by retired SQLite `src/server/http.ts`) and PG-served `product-recovery-case.ts`
    (poorer). R2 enriches `product-recovery-case.ts` over `RecoveryCaseView`; uses
    `operator-case.ts` as IA reference ONLY; never rewires SQLite. "blast radius" is a
    FORBIDDEN_UI_TERM in `copy.ts`. Polling exists for Overview only (`polling.ts`, 2s).
  - A3 renderer: NO visual graph renderer in `src/ui` (only semantic adapter + grid
    contract-lab). V5.6 prototype uses manual CSS positions + hardcoded Sarah scenario;
    production needs a deterministic left-to-right layout, no scenario tokens.
  - A4 conflict audit: 10 statements; all resolved in C0 ┬º9.
  - A5 test map: pure tests run on v24 binary; PG/browser deferred. New pure tests
    proposed under `test/r2-*.test.ts` (classify in `test/suites.json`).
- LANE A (focused projection): COMPLETE ΓÇö integrated C1 part 2, SHA
  `8d434e1` (pushed). `projectFocusedCaseGraph.ts` pure enrichment +
  `pgFactAssembler.ts` wiring; SERVICE_BOOKING/TRANSFER_STAY/PROGRAMME_COMMITMENT
  nodes + RELIES_ON/MUST_HAPPEN_BEFORE/PARTICIPATES_IN edges; traveller display
  names -> `subjectHumanLabels`. PRIMARY fixed the boundary keying to
  `JOURNEY:<id>` (matches contract + refLabel). **OBJECTIVE contract gap: PRIMARY
  VERDICT = DO NOT add an OBJECTIVE LdgNodeKind in R2.** Trip purpose stays in the
  existing `objectives` ontology and is presented AROUND the graph (planning
  evidence / first-breakpoint wording), never as a causal-map node ΓÇö consistent with
  frozen decisions 002/006 (current-world causal map only). `objectiveContractGap`
  is retained as an honest uncertainty note, not a defect.
- LANE B (renderer): COMPLETE ΓÇö C2, SHA `62dda44` (pushed). `src/ui/graph/*`
  (1520 lines) `renderFocusedCaseGraph` via `presentDependencyGraph` single
  semantic layer; deterministic layout; CSS-only pulse from tone; no backend
  liveness; 29 tests.
- LANE C (Case workspace): COMPLETE ΓÇö C3, SHA `545e8d7` (pushed).
  `product-recovery-case.ts` composes graph + Original/Current toggle + planning
  evidence AROUND the graph + change-awareness data attrs + polling/toggle scripts;
  12 integration tests (`r2-case-workspace-integration.test.ts`).
- LANE D (Original/Current + polling): COMPLETE ΓÇö C4, SHA `144c951` (pushed).
  `casePolling.ts` (4s complete-snapshot, sinceCursor echo, revision-gated, no
  WS/SSE) + `originalCurrent.ts` (session-local memory-only capture, honest
  labels/empty state); 31 tests. PRIMARY VERDICT: durable disruption-time
  snapshot deferred (R3 schema candidate), NOT implied by the session capture.
- LANE V (verification): current suite 1013/1013; typecheck, lint, boundary
  (224 files), anti-hardcoding gates all CLEAN.

## R2 checkpoint SHAs

- R2-C0 contract freeze: DONE ΓÇö SHA `df3d8bffaf477da04d5b802104fa3356b7304816` (pushed, local == origin).
- R2-C1 focused projector: DONE ΓÇö part 1 `333615d` (pure causal mapping + contract);
  part 2 `8d434e1` (Lane A backend enrichment + subjectHumanLabels). Both pushed.
- R2-C2 renderer: DONE ΓÇö `62dda44` (pushed).
- R2-C3 Case workspace: DONE ΓÇö `545e8d7` (pushed).
- R2-C4 Original/Current + polling: DONE ΓÇö `144c951` (pushed).
- R2-C5 Cloud integration: DONE ΓÇö all four lanes integrated into ONE Case decision
  workspace (`product-recovery-case.ts`), PG integration proof authored/typechecked
  (`2c290ad`), local acceptance handoff written (`f11baab`), and the required
  `subjectLabels` contract field + `projectRecoveryCase` wiring committed (`19d85bd`,
  closes the gap that would otherwise break a clean-clone typecheck). Final Cloud
  verification on committed HEAD `19d85bd`: typecheck clean, full ESLint clean
  (exit 0), boundary gate 225 files, anti-hardcoding gate clean, `current` suite
  1013/1013 pass. Working tree clean; local == origin.
  Terminal status: **R2 CLOUD IMPLEMENTATION COMPLETE ΓÇö REQUIRES LOCAL INTEGRATION
  ACCEPTANCE** (proofs 8ΓÇô14 in `docs/work/R2_LOCAL_ACCEPTANCE_HANDOFF.md` need real
  PostgreSQL + a browser, neither available in Cloud).

## R2 Cloud limitations

No PostgreSQL, no Docker, no browser, no LIVE providers, no secrets. Cloud MAY author
PG queries/migrations/tests + typecheck; MUST NOT claim a migration applied / PG test
passed / transaction behaviour proven / visual acceptance unless it actually ran.

## R2 next action

1. [DONE] R2-C0 contract freeze + living-doc reconciliation; commit + PUSH; record SHA.
2. Fan out write lanes A/B/C/D/V from the C0 SHA on clearly-owned paths.
3. R2-C1 integrate Lane A (focused projector + causal mapping + two-case generality).

---

# ACTIVE TASK ΓÇö R1 Planning + Decision-Evidence Parity (LOCAL INTEGRATION)

Live working-memory ledger for the R1 local integration and acceptance lane. Reread this
file before every major phase, before every checkpoint commit/push, and before the final
report. The completed Cloud implementation record remains below as historical handoff
evidence. The completed truth-rebase/contract-freeze planning ledger is preserved at
`docs/work/TRUTH_REBASE_CONTRACT_FREEZE_ACTIVE_TASK.md` and is NOT rewritten here.

## Local integration snapshot ΓÇö 2026-09-19

- Branch: `feat/r1-local-integration`, created directly from accepted Cloud handoff
  `e3598642058e6329e8a7e800d052a15773686488`.
- PostgreSQL: isolated disposable PostGIS 16 container on port `55433`; migrations through
  `0126_recovery_case_attention.sql` apply cleanly through the normal test harness.
- L1 status: **COMPLETE ΓÇö commit `2c46bd4535402db780815de0557a98d1e5e2595e` pushed.** The Cloud coordinator
  committed viable strategies, PlanningAttempt, and final case phase in separate Units of
  Work. It now uses one `RECOVERY_PLANNING_COMPLETED` UnitOfWork command, with fresh basis
  and pending-reassessment guards before promotion. Fault injection proves strategy,
  PlanningAttempt, and `AWAITING_AUTHORITY` roll back together; success commits together.
- LangGraph decision resolved: **REJECTED** (runtime-spiked; history below is preserved and the
  old DEFERRED-LANGGRAPH classification is superseded). C4: **BESPOKE RECONCILE-FROM-POSTGRES
  IMPLEMENTED** ΓÇö see L4B. No LangGraph package/table, no RuntimeOrchestrator, no cursor.
- L2 transport status: **COMPLETE ΓÇö commit `acc83b45bf24b5cbb75ae6bde01da3d4dbe222dc` pushed.**
  `PgWorldReader` retains `place_external_refs`; the coordinator optionally composes the
  read-only transport seam; searched offers become provenance-carrying services only in an
  isolated planning capture, never bookings or canonical PostgreSQL transport rows.
- L3 C9 PG status: **COMPLETE ΓÇö commit `8a78f8c39c136de00be19c3742da7380b72cc15a` pushed.**
  `postgres-integration/r1PlanningEvidenceProjection.pgtest.ts` (5/5) runs the REAL coordinator on
  the generic programme world and reads the attempt through `findLatestRecoveryPlanningAttemptForCase
  -> loadRecoveryCaseFactsInner -> projectRecoveryCase`: no attempt => no planning block; domains,
  rejected/viable candidates + deterministic reasons, recommendation, the three impact concepts,
  decision-time `asOf`; a later canonical change (approve/execute/resolve) does not rewrite the
  attempt. Known R2 gap: outcome-delta subject labels are generic ("Journey") ΓÇö refs are secondary
  but the human label does not yet name the traveller (current-state `strategies[]` does).
- L4A ESCALATE: **COMPLETE ΓÇö commit `c6791bf6a780fef179d0e9c4dae36dd4eab66b34` pushed.** Design
  hypothesis confirmed: escalation is ORTHOGONAL to case phase. No ESCALATED phase; migration
  `0126_recovery_case_attention.sql` adds a Case-owned `recovery_case_attention` record
  (case + basis assessment + closed reason; OPEN -> RESOLVED only; never deleted), idempotent per
  (case, basis, reason), cleared by a superseding basis or by `resolveRecoveryCase` (same tx),
  surfaced as `RecoveryCaseView.attention[]`. Reasons: `no_safe_recovery_remaining`,
  `human_evidence_or_decision_required`. Not a new ontology entity.
- L4B C4 progression: **COMPLETE ΓÇö commit `5fb337b627c2234c9bc75e6c196425e5f16519cf` pushed.**
  `src/app/target/recoveryProgressionPass.ts`, composed once in the `caseLifecycle` runtime service
  (replaces the resolve-only pass; existing periodic + `runNow` semantics). Per wake, per
  non-terminal case with a JOURNEY/TRIP subject: settled current basis -> resolution gate +
  attempt facts -> frozen C8 decision -> one dispatch (`resolveRecoveryCase` / `planCase` /
  attention). Unsettled assessment => WAIT. Progression never dispatches or retries execution.
  Focused PG `r1RecoveryProgression.pgtest.ts` 8/8.
- L5 composed B1: **COMPLETE ΓÇö commit `e8036bb401f63975b9ed886b77de7047aadc83ff` pushed.**
  `postgres-integration/r1ComposedB1.pgtest.ts` ΓÇö one PostgreSQL-backed loop driven only by C4 wakes:
  provider-shaped change -> whole-trip FAIL -> REPLAN (coordinator) -> TRANSPORT + PROGRAMME investigated
  (an arrival-readiness deficit now activates TRANSPORT through a dimension-scoped reason token) ->
  read-only REPLAY flight research (provider/provenance on the Case view) -> RC-6 rejects the boardable
  flights (none restores readiness in time) and a regressing swap, accepts one programme swap ->
  viable-only recommendation with the three distinct impact concepts -> operator approval ->
  two internal intents -> existing internal execution -> canonical programme change -> reassessment ->
  C4 RESOLVE. The winning strategy was not encoded; it emerged from domains + evidence + RC-6 + comparator.
  The Case read model now also surfaces the stored `resolution_summary`.
- L6 unknown outcome / reconciliation: **COMPLETE ΓÇö commit `de2f5088fbb1e970a8b8497e54606dceb0c92156` pushed.**
  `r1UnknownOutcome.pgtest.ts` (4/4) on the real stored-execution/provider boundary: LOST_RESPONSE ->
  OUTCOME_UNKNOWN -> repeated C4 wakes only WAIT; dispatcher (provider mutation) call count stays 1; blind
  redispatch refused; STILL_UNKNOWN / FOUND_FAILURE keep WAITing with no retry; FOUND_SUCCESS is the only
  path to RESOLVE (through the gate). Also `r1RecoveryProgression.pgtest.ts`: an approved plan that completed
  without changing the basis escalates rather than replanning the same basis.
- Second generality: **COMPLETE (same commit).** `r1ConnectionRecovery.pgtest.ts` ΓÇö no programme at all: a
  broken connection (`connection_feasibility`) through the same coordinator/registry/evidence/RC-6/
  comparator/C4 (TRANSPORT+TRANSFER investigated, PROGRAMME not applicable; one recorded corridor searched,
  the corridor with an unresolvable airport skipped, not invented; one viable offer recommended, later offers
  retained as rejected evidence).
- Known boundary (not an R1 defect): the runtime approval path composes only internal capabilities, so an
  external provider selection (e.g. a viable `SELECT_OFFER` transport option) is recommended but refused at
  approval ("refusing to fabricate provider capability"); the L6 proof therefore drives the provider boundary
  through the M8 stored-execution fixtures. Composing external approval/execution is B2 follow-on work.
- Test-DB runner note: focused PG files run against the disposable container with
  `PGTEST_PORT=55433 PGTEST_DB=r1local` (create the DB `FROM template_postgis` first) and MUST use
  `--test-concurrency=1` when several files share one DB.
- Pre-existing, unrelated: `m10RuntimePurgeBoot.pgtest.ts` fails at baseline (expects 404, gets 200).
- Delegated lanes: none (shared mutable working tree; primary retains integration).
- Next action: R2.

## R1 local acceptance ΓÇö 2026-09-19

Status: **R1 ACCEPTED ΓÇö READY FOR R2**

- C9 real-PG projection proof, truthful durable escalation, C4 focused proof, composed B1 through C4,
  unknown-outcome safety and a second generality case: all proven on PostgreSQL (L3-L6 above).
- `CURRENT_TARGET` (`npm test`): 933/933. Typecheck, full ESLint and the anti-hardcoding gate: clean.
- Full PostgreSQL suite (fresh DB, run once): 552/556. Of the 4 failures: 2 were stale expectations of
  mine (migration-lane allocation list for 0125/0126; jsonb allowlist for the 0125 attempts table) ΓÇö fixed and
  re-verified; 1 was `r1ConnectionRecovery.pgtest.ts` failing at file start in 0.7s with no assertion (the
  documented PGTEST-FILE-STARTUP-RACE), passing on rerun; 1 is `m10RuntimePurgeBoot.pgtest.ts`, which fails
  identically at baseline with these changes stashed (pre-existing, unrelated).
- The fixed/rerun files passed together sequentially (25/25). A second full-suite run was not repeated.
- Docs reconciled: this ledger, `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md` ┬º11 (R1 local resolution of C8) and
  `docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md` (historical DEFERRED-LANGGRAPH rows preserved, reconciliation note added).
- Carry-forward for R2/B2 (not R1 defects): external approval/execution composition (external `SELECT_OFFER` is
  recommended but refused at approval); outcome-delta subject labels are generic ("Journey").

## Identity

- Repository: `dropandresetmain-prog/qoder-atlas`
- Authoritative base SHA (frozen): `456be3e44b7d4689e6f734c719725848e140dff8`
- Base branch: `plan/truth-rebase-contract-freeze` (verified identical to base SHA)
- Working branch: `feat/r1-planning-parity-cloud` (created DIRECTLY from the base SHA)
- Ancestry: base SHA IS an ancestor of working HEAD (verified `git merge-base --is-ancestor`)
- Role: PRIMARY R1 Cloud Implementation + Integration Lead
- Harness: Qoder Cloud sandbox (no Docker, no PostgreSQL, no LIVE providers, no secrets)

Divergence report (NOT merged, per instruction): a docs-only commit `d6c845e`
exists on a main-only ref and is NOT part of the frozen base. It is reported here
and left alone; the working branch stays pinned to `456be3e`.

## Goal (R1)

Implement as much of R1 "Planning + Decision-Evidence Parity" as can be TRUTHFULLY
completed in the Cloud sandbox: materialize the frozen recovery-planning contracts,
author (not execute) the PostgreSQL persistence, build the production coordinator
that extends the existing `recoveryPlanning.ts` seam, and prove generality ΓÇö while
deferring every check that genuinely requires PostgreSQL/LIVE providers to a LOCAL
integration-acceptance ledger.

Terminal status for this task is EXACTLY one of:
- `R1 CLOUD IMPLEMENTATION COMPLETE ΓÇö REQUIRES LOCAL INTEGRATION ACCEPTANCE`
- `R1 CLOUD IMPLEMENTATION BLOCKED ΓÇö <blocker>`
NEVER `R1 ACCEPTED ΓÇö READY FOR R2`.

## Product truth (non-negotiable)

NORTHSTAR is a generalized trip-resolution system. Keep PostgreSQL as the sole
runtime; keep F01-F18, RC-6, StrategyProposer, ScenarioChange, ChangeSignal, M6,
M8, durable execution, Atlas adapters, LIVE/RECORD/REPLAY. Do NOT rebuild these,
do NOT restore RuntimeOrchestrator, do NOT create a second engine, do NOT add
Sarah/Jordan-specific branches. AI proposes/researches/compares; deterministic code
owns hard constraints, provider facts, viability (RC-6), authority, execution
validation, observation/reconciliation and resolution.

## Cloud limits honoured

Docker, PostgreSQL, authenticated provider CLIs, local secrets and LIVE provider
execution are UNAVAILABLE. Therefore: no Docker install, no substitute DB, no
SQLite switch, no mocks in domain logic, no weakened tests, no faked PG/provider
evidence, and no claim that a test passed which could not run. Cloud MAY: author
migrations, author PG commands/repositories, run pure/unit/module tests, use
checked-in credential-free REPLAY recordings, typecheck, lint, run anti-hardcoding
gates, inspect code, and build production implementation.

## Frozen contracts materialized (Phase B ΓÇö PRIMARY)

All under `src/contracts/v2/planning/`, exported via `src/contracts/v2/index.ts`:

- [x] C1 `recoveryPlanningAttempt.ts` ΓÇö RecoveryPlanningCoordinator port, bounded
      immutable attempt record, closed outcome/reason vocabularies, materiality rules.
- [x] C2 `planningTool.ts` ΓÇö read-only PlanningTool request/result protocol,
      canonical fingerprint, dedupe, bounded research budget.
- [x] C3 `recoveryDomain.ts` ΓÇö recovery-domain registry, hybrid deterministic+AI
      selection, fail-closed.
- [x] C4 `proposerAdaptation.ts` ΓÇö additive domain/evidence context for proposers;
      base StrategyProposer port unchanged.
- [x] C5 (with C1) material decision evidence inside the attempt record.
- [x] C6 `strategyRecommendation.ts` ΓÇö viable-only recommendation + deterministic
      validation rejecting non-viable/stale/foreign refs; preference precedence.
- [x] C7 `impactSemantics.ts` ΓÇö three distinct impact projections as pure functions.
- [x] C8 `recoveryProgression.ts` ΓÇö single post-reassessment progression decision
      (RuntimeOrchestrator stays retired).
- [x] barrel `index.ts`.
- [x] C9 Case projection ΓÇö decision-time planning evidence surfaced on the
      PostgreSQL Case read model (human labels primary, typed refs/codes
      secondary; `phase:'DECISION_TIME'`+`asOf` visibly separate it from current
      authoritative state). Part 9, `a9024c4`.
- [x] C10 B1/B2 acceptance ΓÇö coverage map + PRIMARY gap reconciliation
      (`docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`). Part 10, `ac668e6`.

## Ownership map (PRIMARY retains)

- Shared architecture + all frozen contracts (C1-C10 shape).
- Schema/migration authoring and any migration-order/FK decisions.
- Integration decisions across lanes; cross-lane reconciliation.
- Recovery Lifecycle Progression service (composed under `runtimeServices`).
- Final Cloud verification; checkpoint commits and pushes.

## Phase C write lanes (fan out ONLY after C1 push)

- Lane P ΓÇö planner core: extend `src/app/target/recoveryPlanning.ts` into the C1
  coordinator; read-only tool dispatch; transport proposer; comparator/preferences.
- Lane E ΓÇö persistence: RecoveryPlanningAttempt repository/command over migration
  0125; impact-projection projections wired into the attempt record.
- Lane V ΓÇö verification: pure Cloud-runnable tests (contracts, coordinator with
  injected fakes at the SEAM only, REPLAY-based) + the LOCAL-required pg list.
- Lane X ΓÇö Case projection (C9): static review of the PostgreSQL Case read model.

Each lane branches from the C1 SHA and returns exact-path diffs; PRIMARY
reconciles and integrates.

## Checkpoints

- [x] Phase A recon (A1-A5 read-only) ΓÇö complete.
- [x] Phase B contracts materialized + typecheck clean.
- [x] C1 checkpoint: contracts + migration 0125 authored + pure tests green +
      suites.json classification + ACTIVE_TASK ledger + this doc.
      Commit `feat(r1): materialize recovery planning contracts`. PUSHED.
      - branch: `feat/r1-planning-parity-cloud`
      - C1 SHA: `c7bb86a740b2370f97998e14b3fe3fa7fe13e9ef` (local == origin)
      - Phase C lanes branch from this SHA.
- [x] C3 foundation ΓÇö pure decision-evidence assembly
      (`src/resolution/planning/decisionEvidence.ts`): the bridge from real RC-6
      `EvaluateStrategyResult` + closure to the three frozen impact projections
      (C7) and MaterialCandidateEvidence (C5), validated against the contract.
      Added `RecoveryPlanningAttemptSchema` interval refine (app/DB parity with
      migration 0125 CHECK). 46 pure tests pass; full `current` suite 876/876.
      Commit `feat(r1): assemble decision evidence from real RC-6 output`.
      - SHA: `a183cebf165287dd1093cc606cea1d12cffa7bf0` (local == origin)
- [x] Lane E ΓÇö RecoveryPlanningAttempt persistence
      (`src/persistence/postgres/commands/r1PlanningAttemptCommands.ts`): idempotent
      command over migration 0125 (not an aggregate root; `advanced: []`, mirrors
      `completeChangeSignal`), uuid-narrowing at the DB boundary, FK pre-checks,
      contract round-trip read helpers. Authored pg integration test
      `postgres-integration/r1RecoveryPlanningAttempt.pgtest.ts` (classified
      `postgres`; NOT executed in Cloud). Typecheck/lint/boundary clean.
      Commit `feat(r1): persist RecoveryPlanningAttempt over migration 0125`.
      - SHA: `4aefbd0` (local == origin)
- [x] Lane P (part 1) ΓÇö C6 comparator
      (`src/resolution/planning/comparator.ts`): pure viable-only ranking ΓÇö
      precedence-ordered preference alignment, then deterministic facts
      (regressions, improvements, blast radius, declared cost; absent cost sorts
      last), then stable ref tiebreak; refusal (undefined) when no usable
      candidate; semantic notes explain but never rank; output re-validated via
      `validateStrategyRecommendation`. `test/r1-comparator.test.ts` 11/11 pass;
      full `current` suite 887/887; typecheck/lint/boundary/anti-hardcoding clean.
      Commit `feat(r1): select viable-only recommendation deterministically (C6 comparator)`.
      - SHA: `b6ed62ee0c4d595c1b027c054df099325ddc0da2` (local == origin)
- [x] Lane P (part 2) ΓÇö C3 domain registry + C2 research dispatcher foundations
      (`src/resolution/planning/recoveryDomains.ts`,
      `src/resolution/planning/researchDispatcher.ts`): deterministic domain
      activation from REAL M6 blocking dimension codes only (no scenario
      branch), fail-closed on missing capability; bounded read-only dispatch
      with canonical-fingerprint dedupe across rounds, structured
      PLANNING_BUDGET_EXCEEDED refusal that retains prior evidence, and
      external failure kept as visible data. `test/r1-planning-foundations.test.ts`
      13/13 pass; full `current` suite 900/900; typecheck/lint/boundary/
      anti-hardcoding clean.
      Commit `feat(r1): deterministic recovery-domain registry and bounded read-only research dispatcher`.
      - SHA: `8101ced6a49ba7740472a62a38d792fc2e971c81` (local == origin)
- [x] Lane P (part 3) ΓÇö pure selection layer
      (`src/resolution/planning/planningSelection.ts`): comparator-fact
      derivation from the frozen impact projections (worseCount/betterCount from
      outcomeDelta, blastRadiusSize from immediate blast radius; no facts for a
      validation rejection that never reached RC-6) + closed-vocabulary
      `planningOutcomeOf` mapping (returns the contract's own
      `RecoveryPlanningOutcome`, so the mapping cannot drift from the frozen
      enum). `test/r1-planning-selection.test.ts` 4/4 pass (fact derivation
      exercised through REAL RC-6 output); full `current` suite 904/904;
      typecheck/lint/boundary/anti-hardcoding clean.
- [x] Lane P (part 4) ΓÇö C1 coordinator CORE + C5 generality proof
      (`src/resolution/planning/coordinatorCore.ts`): the single generalized
      `runRecoveryPlanning` pipeline ΓÇö deterministic domain registry -> optional
      bounded read-only research -> proposer port per investigated domain ->
      validate -> REAL `evaluateRecoveryStrategy` (RC-6) -> decision-evidence
      assembly (three separate projections) -> frozen comparator -> closed
      outcome mapping -> ONE immutable attempt. PURE: PG/provider/model and id/
      version minters are injected, so the SAME core is Cloud-executable and
      generality-provable. `test/r1-coordinator-generality.test.ts` drives THREE
      materially different situations through it: (A) PROGRAMME via the real
      shipped time-swap proposer => VIABLE/RECOMMENDED/AWAITING_AUTHORITY;
      (B) STAY via a seam-injected proposer with a DIFFERENT effect kind
      (ALTER_JOURNEY_ITEM_INTENT) => AWAITING_AUTHORITY; (C) externally-scheduled
      item the overlay cannot move => honest NO_RECOVERY_FOUND with rejection
      evidence retained. 3/3 pass; full `current` suite 907/907;
      typecheck/lint/boundary/anti-hardcoding clean.
      Commit `feat(r1): generalized recovery planning coordinator core (C1)`.
      - SHA: `9740c1818ee6832bffdfcdbefa01561746632327` (local == origin)
- [x] Lane P (part 5) ΓÇö C1 PostgreSQL ADAPTER
      (`src/app/target/recoveryPlanningCoordinator.ts`): implements the frozen
      `RecoveryPlanningCoordinator.planCase` port. Reads the CURRENT basis from
      canonical PG with the SAME public helpers the accepted B1 seam uses, then
      delegates ALL decision logic to the pure core, then persists via REAL
      commands (persistRecoveryStrategy per VIABLE strategy + the ONE immutable
      attempt over migration 0125) and advances the case phase only on
      AWAITING_AUTHORITY. Deterministic id/version minting mirrors the B1
      planning namespace (idempotent per case/basis/candidate). Reuses
      `advanceCasePhase` from the existing seam ΓÇö no second engine, no
      RuntimeOrchestrator. Requires PG: TYPECHECKED + LINTED in Cloud, NOT
      executed here (LOCAL integration-acceptance item). Typecheck/lint/boundary/
      anti-hardcoding clean; full `current` suite 907/907.
      Commit `feat(r1): bind recovery planning coordinator core to PostgreSQL (C1 adapter)`.
      - SHA: `f0fe4489d1d8e6328ba5d91e98d71a227b9400d4` (local == origin)
- [x] Lane P (part 6) ΓÇö C8 progression FACT MAPPER (pure)
      (`src/resolution/planning/progressionFacts.ts`): honest projection from what
      EXISTING owners OBSERVE ΓÇö the deterministic resolution gate result
      (`ResolutionGateResult`), an explicit authority/execution-pending flag,
      recovery-remains-possible and the settled basis assessment id ΓÇö onto the
      frozen `RecoveryProgressionInput`, then through the already-frozen
      `decideRecoveryProgression` precedence. Re-derives no gate verdict, invents
      no progress. `test/r1-progression-facts.test.ts` 9/9 pass (RESOLVE; the three
      pending-execution denials -> WAIT; explicit pending flag -> WAIT even on
      BLOCKING_FAIL; BLOCKING_FAIL + recovery possible -> REPLAN bound to the NEW
      basis; BLOCKING_FAIL without recovery -> ESCALATE no_safe_recovery_remaining;
      non-failing denials -> ESCALATE human_evidence_or_decision_required; terminal
      CASE_NOT_OPEN -> ESCALATE; idempotency; executionReconciled false ONLY for a
      genuine unreconciled-execution denial). Full `current` suite 916/916;
      typecheck/lint/boundary (207 files)/anti-hardcoding (414 files) clean.
      **ESCALATE SURFACE ΓÇö CONTRACT GAP reported (not papered over):** the existing
      case lifecycle has OPEN->PLANNING->AWAITING_AUTHORITY->EXECUTING plus terminal
      RESOLVED/CLOSED/CANCELLED/SUPERSEDED but NO dedicated escalated/needs-human
      state or command. Per the C8 contract's own instruction this is reported for
      PRIMARY/local resolution rather than fabricating a new phase; the mapper still
      returns the truthful ESCALATE decision.
      Commit `feat(r1): C8 progression fact mapper ΓÇö observed gate/authority facts onto frozen decision`.
      - SHA: `e3cd300e35c3ed182a5b067a011360ecc2420945` (local == origin)
- [x] Lane P (part 7) ΓÇö evidence-threading seam (C2/C4)
      Three additive core edits so a `DomainStrategyProposer` receives raw
      normalized tool results: `researchDispatcher` returns index-aligned
      `results: PlanningToolResult[]`; `coordinatorCore` zips evidence+results
      per domain, builds `PlanningEvidenceContext`, and adapts a domain proposer
      via the previously-DEAD frozen `bindDomainProposer` (base
      `StrategyProposer` unchanged). `test/r1-evidence-seam.test.ts` 4/4.
      - SHA: `0761de6` (local == origin)
- [x] Lane P (part 8) ΓÇö concrete provider-assisted TRANSPORT PROPOSER
      (`transportCorridors.ts` + `replayPlanningTransport.ts` +
      `proposers/transportProposer.ts` + an additive domain-agnostic
      `resolveOffersForDomain` seam in `coordinatorCore.ts`). Closes the OPEN R1
      TRANSPORT gap as far as Cloud truthfully permits, fully generalized (no
      persona/event/route/airport branch, no hardcoded demo data; airport refs +
      passengers INJECTED, fail-closed). The corridor spine derives provider-neutral
      `flight.search` corridors from canonical world state (departureDate via the
      Intl API at the origin place tz, no offset table; deterministic SubjectId-safe
      request ids). The production `PlanningToolTransport` bridges C2
      request->result by REUSING `dispatchToolRequest` (no second engine, no direct
      provider call) ΓÇö wired over REPLAY Atlas + checked-in recordings in Cloud, the
      SAME code wires LIVE/RECORD locally. The proposer turns normalized
      `FlightOffer[]` into ranked, bounded `SELECT_OFFER` candidates (historical
      northstar ordering segments->price->key); raw Atlas routingIdentifiers are NOT
      SubjectId-safe so each effect carries a deterministic `transport-offer:<sha>`
      key, prices convert float Money->exact decimal ExactMoney + re-validate, and
      boardability drops an offer departing before now. STRICTLY proposal-only:
      never declares viability/authority/execution; records the honest assumption
      that the selected service must be CAPTURED first. The coordinator seam exists
      because the overlay only honors a SELECT_OFFER whose service EXISTS in the
      captured world ("cannot fabricate supplier selection"); the core stays
      domain-agnostic and never fabricates one. `test/r1-transport-proposer.test.ts`
      4/4: replays the checked-in MNL->CEB recording through the REAL transport into
      4 normalized offers; ranked/bounded/SubjectId-safe SELECT_OFFER + exact prices;
      boardability drop; end-to-end through `runRecoveryPlanning` the TRANSPORT
      domain activates from a real M6 blocking dimension and a CAPTURED selected
      offer flips the journey FAIL->PASS => VIABLE/RECOMMENDED/AWAITING_AUTHORITY
      (post-materialization state); and anti-fabrication: an uncaptured offer is
      rejected by the real overlay => honest NO_RECOVERY_FOUND with the rejection
      retained. Full `current` suite 924/924; typecheck (no test casts)/lint/
      boundary (209 files)/anti-hardcoding CLEAN. SPINE proven end-to-end:
      corridor -> flight.search request -> REPLAY -> `rec_ac9fd89b` -> 4 offers, no
      network/credentials/PG.
      Commit `feat(r1): concrete provider-assisted TRANSPORT proposer over REPLAY evidence`.
      - SHA: `adc805367de10c8a9f05712b75bd251b0247b455` (local == origin)
- [x] Lane P (part 9) ΓÇö C9 Case projection (decision-time planning evidence)
      (`contracts/v2/product/readModels.ts` additive `PlanningEvidenceViewSchema`
      block + optional field on `RecoveryCaseViewSchema`;
      `app/target/readmodels/projectPlanningEvidence.ts` PURE projector;
      additive `planningAttempt` fact in `types.ts`; conditional spread in
      `projectRecoveryCase.ts`; barrel export; authored
      `findLatestRecoveryPlanningAttemptForCase` loader in
      `r1PlanningAttemptCommands.ts` + wired into `loadRecoveryCaseFactsInner`).
      Surfaces freeze ┬º12 Q4-Q12 (domains investigated, read-only tools +
      provenance/uncertainty, material candidates + rejection reasons, the three
      distinct impact projections kept SEPARATE, viable refs, recommendation +
      human basis). Human labels PRIMARY, typed refs/closed-vocab codes
      SECONDARY (line 529: no uuid is ever the primary explanation);
      `phase:'DECISION_TIME'`+`asOf` make planning-time evidence visibly
      distinct from current authoritative state. Closed vocabularies labelled
      via exhaustive `Record<Enum,string>` maps (a new member fails typecheck
      rather than mislabeling); open codes humanized generically. A case that
      never planned carries NO evidence (never fabricated). The projector +
      schema + loader are Cloud-authored/typechecked/linted/tested; the LOADER
      RUNTIME (real PG read of `recovery_planning_attempts`) is a LOCAL
      acceptance item. `test/r1-case-projection.test.ts` 5/5 pure Cloud (labels
      primary; three impact semantics separate; no bare-uuid explanation;
      no-recommendation case; end-to-end spread via `projectRecoveryCase`).
      Commit `feat(r1): C9 Case projection ΓÇö decision-time planning evidence in the read model`.
      - SHA: `a9024c4621813ac4c5ecaeafd320db7bdb09f0c2` (local == origin)
- [x] Lane V (part 10) ΓÇö C10 B1/B2 acceptance Γåö test coverage map
      (`docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`): every B1 (rebase ┬º12, 18
      criteria + freeze ┬º13 structural) and B2 (rebase ┬º13, 12 items + freeze
      ┬º14 structural) criterion mapped to REAL passing test titles, or the gap
      classified CLOUD-NOW / DEFERRED-LANGGRAPH / LOCAL-RUNTIME. PRIMARY
      reconciliation of the recon finding ("no test composes the lifecycle
      through the coordinator"): the individual deterministic units ARE
      Cloud-tested; the COMPOSITION is the concrete C4 outer runner that
      direction item 1 PAUSES pending the LangGraph spike, so it is
      DEFERRED-LANGGRAPH (+ LOCAL-RUNTIME for the canonical-PG stages + the open
      ESCALATE-surface contract gap), NOT a plain Cloud gap and NOT silently
      downgraded. No criterion left unclassified. Commit
      `docs(r1): C10 B1/B2 acceptance Γåö test coverage map + PRIMARY gap reconciliation`.
      - SHA: `ac668e614153ed1b87ceabb15f84a658225c4b19` (local == origin)

### Contract-milestone status (Phase C)

- [x] C2 ΓÇö planner core integrated: generalized coordinator CORE (part 4) + PG
      ADAPTER (part 5); read-only bounded research dispatch (part 2); viable-only
      comparator (part 1); evidence-threading seam (part 7); and the **concrete
      provider-assisted TRANSPORT PROPOSER (part 8, `adc8053`)** ΓÇö the previously
      OPEN R1 TRANSPORT gap is now IMPLEMENTED as far as Cloud truthfully permits.
      It is fully generalized: corridors derived from canonical world state, airport
      refs + passengers INJECTED, evidence replayed from a CHECKED-IN Atlas recording
      through the production transport (reusing `dispatchToolRequest`), normalized
      `FlightOffer[]` -> ranked bounded `SELECT_OFFER` candidates with deterministic
      SubjectId-safe keys + exact decimal prices, STRICTLY proposal-only (RC-6 owns
      viability). Proven end-to-end through `runRecoveryPlanning` (TRANSPORT
      activates from a real M6 blocking dimension; a CAPTURED selected offer flips
      the journey FAIL->PASS => AWAITING_AUTHORITY) and the overlay anti-fabrication
      rejection (uncaptured offer => honest NO_RECOVERY_FOUND). It contains no
      Sarah/Jordan logic, no hardcoded demo route, no consequential provider call, no
      viability declaration, and no LIVE-credential requirement to function
      structurally. THREE LOCAL closure items remain (see handoff ledger): thread
      place->IATA externalRefs from PgWorldReader into WPlace; materialize a net-new
      researched offer into a captured WTransportService; wire research +
      resolveOffersForDomain into the PG coordinator adapter. The capability is NOT
      reclassified optional ΓÇö these are integration/runtime seams only.
- [x] C3 ΓÇö decision evidence end-to-end at the seam: the coordinator assembles the
      three separate impact projections + material candidate evidence and persists
      the ONE immutable attempt over migration 0125 (parts 3-5).
- [HOLD] C4 ΓÇö Recovery Lifecycle Progression (PRIMARY): pure fact mapper DONE +
      tested (part 6, `e3cd300`) and KEPT. **CONCRETE LIFECYCLE RUNNER = PAUSED
      PENDING LANGGRAPH SPIKE** (intentional architecture hold, NOT a Cloud
      limitation). A separate accepted architecture investigation concluded
      "SPIKE REQUIRED BEFORE DECISION": LangGraph may replace ONLY the concrete
      outer durable progression runner (the `runtimeServices`/`composeTargetBoot`
      long-running WAIT/REPLAN/RESOLVE/ESCALATE loop). It does NOT replace the
      coordinator, domain identification, read-only research, proposers, RC-6, the
      attempt record, recommendation, impact semantics, authority/execution,
      observation/reconciliation, or the PURE C8 decision. Per direction, the
      concrete runner is NOT implemented on this branch; a LangGraph outer-workflow
      spike determines it separately. (A draft runner `caseProgressionPass.ts` was
      authored during recon then REMOVED uncommitted to honour the hold; the pure
      mapper it depended on is unchanged.) All R1 work that survives either
      orchestration decision continues below.
- [x] C5 ΓÇö integration + generality proof: THREE materially different situations
      through ONE `runRecoveryPlanning` (part 4, `9740c18`), no scenario branch.
- [x] C9 ΓÇö Case projection (part 9, `a9024c4`): decision-time planning evidence
      (freeze ┬º12 Q4-Q12) surfaced on the PostgreSQL Case read model. Additive
      `PlanningEvidenceViewSchema` + optional field on `RecoveryCaseViewSchema`;
      PURE `projectPlanningEvidence` projector; additive `planningAttempt` fact +
      conditional spread through `projectRecoveryCase`; authored
      `findLatestRecoveryPlanningAttemptForCase` loader wired into
      `loadRecoveryCaseFactsInner`. Human labels PRIMARY, typed refs/codes
      SECONDARY (line 529); `phase:'DECISION_TIME'`+`asOf` keep planning-time
      evidence visibly distinct from current authoritative state; the three
      impact semantics stay SEPARATE; a case that never planned carries none.
      Cloud-authored/typechecked/linted + 5 pure tests; LOADER RUNTIME (real PG
      read) = LOCAL acceptance item (handoff ledger).
- [x] C10 ΓÇö B1/B2 acceptance Γåö test coverage map (part 10, `ac668e6`,
      `docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`): every B1 (rebase ┬º12, 18 +
      freeze ┬º13 structural) and B2 (rebase ┬º13, 12 + freeze ┬º14 structural)
      criterion mapped to REAL passing test titles or classified
      CLOUD-NOW / DEFERRED-LANGGRAPH / LOCAL-RUNTIME. PRIMARY reconciliation: the
      composed-lifecycle gap is the concrete C4 outer runner (DEFERRED-LANGGRAPH)
      + canonical-PG stages (LOCAL-RUNTIME) + the ESCALATE-surface contract gap ΓÇö
      NOT a plain Cloud gap and NOT silently downgraded. No criterion unclassified.

## Verification ΓÇö DONE in Cloud (cumulative through `a9024c4` / `ac668e6`)

- [x] R1 pure test files green under Node v24 type-stripping:
      `r1-planning-contracts`, `r1-decision-evidence`, `r1-comparator` (11),
      `r1-planning-foundations` (13), `r1-planning-selection` (4),
      `r1-coordinator-generality` (3), `r1-progression-facts` (9),
      `r1-evidence-seam` (4), `r1-transport-proposer` (4),
      `r1-case-projection` (5).
- [x] Full `current` suite via `run-suite.mjs current`: 929/929 pass, 0 fail.
- [x] `npm run gate:test-boundary`: CLEAN ΓÇö 210 test files classified.
- [x] `node scripts/anti-hardcoding-gate.mjs`: CLEAN ΓÇö 418 files scanned.
- [x] `npm run typecheck`: exit 0 (includes the PG-requiring C1 adapter, the C8
      mapper's resolution->app type import, the three transport modules, the C9
      projector + the authored C9 loader, and the C9/transport tests with NO
      `as never`/type-suppression casts).
- [x] `eslint` on every new/changed path: clean.
- [x] C9 projector + schema proven end-to-end in pure Cloud (no PG): a frozen
      `RecoveryPlanningAttempt` -> `projectPlanningEvidence` -> human-label-
      primary decision-time view, and the conditional spread through
      `projectRecoveryCase` (planning evidence present only when an attempt
      exists; current authoritative state untouched and kept separate).
- [x] TRANSPORT SPINE proven end-to-end in pure Cloud (read-only smoke, no file
      written): corridor derivation (departureDate 2026-09-05 at Asia/Manila,
      MNL->CEB) -> `flight.search` PlanningToolRequest -> `createPlanningToolTransport`
      -> REPLAY Atlas adapter -> `rec_ac9fd89bb364d688bbeadef62be55aa5` -> 4
      normalized `FlightOffer[]`. No network, no credentials, no PostgreSQL.

Note: the sandbox default `node` is v20.18; the project requires `>=24`. Cloud
verification of TS tests uses the available v24 runtime (`/opt/playwright-driver/node`)
which matches the documented engine and the `run-suite.mjs` `--test` invocation.

## Verification ΓÇö UNAVAILABLE in Cloud (LOCAL handoff ledger)

Every item below genuinely requires PostgreSQL/Docker/LIVE and is DEFERRED to local
integration acceptance. It is NOT claimed as passed here:

- [ ] Apply migration `0125_recovery_planning_attempts.sql` to a live PG test DB.
- [ ] `npm run db:postgres:up` then `npm run test:postgres` (full pg suite).
- [ ] Run the AUTHORED `postgres-integration/r1RecoveryPlanningAttempt.pgtest.ts`
      (immutability trigger, bounded jsonb CHECKs, FKs to recovery_cases +
      assessments, unique (case, basis) index, interval CHECK, command
      idempotency, read-helper round-trip). Written in Cloud, NOT executed here.
- [ ] Coordinator pg integration: attempt written in the same UoW as viable
      RecoveryStrategy promotion; recommendation references only VIABLE rows.
      Specifically the C1 PG ADAPTER (`src/app/target/recoveryPlanningCoordinator.ts`,
      `f0fe448`) ΓÇö typechecked + linted in Cloud, NEVER executed here: verify
      `capturePlanningBasis` reads the real CURRENT/FAIL basis, `persistRecoveryStrategy`
      + `persistRecoveryPlanningAttempt` commit as separate idempotent commands,
      `advanceCasePhase(PLANNING)` / `advanceCasePhase(AWAITING_AUTHORITY)` transition
      legally, and the deterministic minters are idempotent under retry/replay.
- [ ] Recovery Lifecycle Progression pg integration (RESOLVE/WAIT/REPLAN/ESCALATE
      against real case + assessment state). The pure C8 fact mapper
      (`src/resolution/planning/progressionFacts.ts`, `e3cd300`) is DONE + tested in
      Cloud; the CONCRETE C4 PASS that gathers observed facts from PG owners
      (`evaluateRecoveryCaseResolution`, pending authority/execution,
      recovery-remains-possible, current basis assessment), applies
      `decideProgressionFromFacts`, and acts through EXISTING owners (RESOLVE via
      `resolveRecoveryCase`; REPLAN via the C1 coordinator from the NEW basis;
      WAIT = no-op; ESCALATE = recorded) is NOT yet authored ΓÇö it is PRIMARY-owned
      and requires PG to run. Must be idempotent per settled basis, must NOT create a
      second status machine, must NOT restore RuntimeOrchestrator.
- [ ] **ESCALATE SURFACE ΓÇö CONTRACT GAP (needs PRIMARY/local decision, NOT a Cloud
      guess):** the existing case lifecycle (OPEN->PLANNING->AWAITING_AUTHORITY->
      EXECUTING + terminal RESOLVED/CLOSED/CANCELLED/SUPERSEDED) has NO dedicated
      "escalated / needs human evidence or decision" state or command. The frozen C8
      contract itself instructs this be reported rather than papered over with an
      invented phase. Local integration must decide the truthful ESCALATE surface
      (new phase vs. reuse of an existing escalation owner) before the C4 pass can
      ACT on an ESCALATE decision; until then the pass records the decision without
      mutating the case into a fabricated state.
- [ ] Generality proof run against real PG fixtures (>=2 materially different
      planning situations through the same coordinator).
- [ ] Any LIVE/RECORD provider evidence (Cloud is REPLAY-only, credential-free).
- [ ] **TRANSPORT PROPOSER ΓÇö three LOCAL integration/runtime closures** (the
      proposer + corridor + REPLAY transport are Cloud-implemented + tested at
      `adc8053`; these three are the seams that genuinely need PG/runtime and are
      NOT papered over with a fabricated mapping or a hardcoded route):
      1. **place->IATA externalRefs into WPlace.** A production corridor resolver
         must read canonical geography, not an injected map. The schema ALREADY
         carries it (`place_external_refs`, migration `0050_places.sql`, cols
         `provider_namespace`+`external_key`; write path `PgPlaceRepository.
         addExternalRef`; ingest writes `{system:'IATA'}`), but
         `PgWorldReader.capture()` (`pgWorldReader.ts:398-402`) selects only from
         `places` and DROPS the refs, so `WPlace` never surfaces them. LOCAL: extend
         the places query with a lateral/json_agg over `place_external_refs`, add
         `externalRefs:{system,value}[]` to `WPlace` (`world.ts:101`) + the reader
         projection, and build the production `AirportResolver` from it. NOTE the
         namespace inconsistency: ingest writes `'IATA'` while legacy
         `src/intelligence` reads `'airport-code'` ΓÇö the resolver must accept both
         (cf. `AIRPORT_REF_SYSTEMS` in `app/planningLoop.ts:298`). Cloud-authorable
         (TS+SQL, no new migration); runtime acceptance is LOCAL (needs PG).
      2. **materialize a net-new researched offer into a captured
         `WTransportService`.** The overlay honors a SELECT_OFFER ONLY when its
         `transportServiceId` already EXISTS in the captured world (overlay.ts:
         "cannot fabricate supplier selection"); a freshly-searched provider offer
         is not yet a captured service. LOCAL: persist the selected offer as a
         `WTransportService` (precedent: `providerDisruptionIngress.ts` replacement
         service) so RC-6 can make the selection VIABLE, then thread the resulting
         `ResolvedOffer[]` through `resolveOffersForDomain`. The Cloud test seeds
         these services to represent the post-materialization state; the proposer
         itself never fabricates one (proven by the anti-fabrication test).
      3. **wire research + offer resolution into the PG coordinator adapter.**
         `src/app/target/recoveryPlanningCoordinator.ts` currently calls
         `runRecoveryPlanning` WITHOUT `deps.research` / `deps.resolveOffersForDomain`.
         LOCAL: wire the production `createPlanningToolTransport` (over LIVE/RECORD
         Atlas capabilities + the production AirportResolver), build
         `requestsByDomain.TRANSPORT` from `transportCorridors` +
         `flightSearchRequestFor`, and supply `resolveOffersForDomain` from
         `resolveTransportOffers`. The pure seam is already typed + tested; this is
         composition-root wiring requiring PG + provider capabilities.
- [ ] **C9 Case-projection LOADER RUNTIME (PG).** The `PlanningEvidenceView`
      schema, the PURE `projectPlanningEvidence` projector, the additive
      `planningAttempt` fact + conditional spread through `projectRecoveryCase`,
      and the authored `findLatestRecoveryPlanningAttemptForCase` query are all
      Cloud-authored/typechecked/linted + pure-tested at `a9024c4`. What Cloud
      CANNOT run is the real PostgreSQL read that feeds them. LOCAL: against a
      migrated PG (0125), persist a coordinator attempt via
      `persistRecoveryPlanningAttempt`, then load a Case view and assert
      `planningEvidence` is populated from the LATEST completed attempt
      (`completed_at DESC`), is decision-time-distinct from current authoritative
      state, and is absent for a case that never planned. Verify the
      `(workspace_id, recovery_case_id, completed_at DESC)` index serves the
      query. (Add to `postgres-integration/r1RecoveryPlanningAttempt.pgtest.ts`
      or a sibling pg test.)
- [ ] **Composed lifecycle (B1-15..18 / B2 full-lifecycle) ΓÇö DEFERRED-LANGGRAPH +
      LOCAL-RUNTIME.** No single test composes
      coordinator -> authority -> external dispatch -> observation ->
      reconciliation -> reassessment -> resolution. Per the C10 map
      (`docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md` ┬º3) the deterministic UNITS are
      Cloud-tested (m8 authority/gate, wave3r-dr2 REPLAY dispatch/reconcile/
      observe, m9-jordan RECORD partial failure, r1-progression-facts pure C8,
      r1-coordinator-generality planning); the COMPOSITION is the concrete C4
      outer runner that direction item 1 PAUSES pending the LangGraph spike, and
      its canonical-state stages also need PG. NOT a plain Cloud gap, NOT
      downgraded, NOT built on this branch. LOCAL/LangGraph: once the outer-runner
      decision lands, compose the lifecycle and assert the full B1/B2 path
      end-to-end (REPLAY/RECORD suffices for the behavioural proof; canonical
      writes need PG).
- [ ] **ESCALATE case surface ΓÇö CONTRACT GAP (reiterated for B2-12).** The
      composed lifecycle's "explicit escalation" branch cannot ACT until local
      integration decides the truthful escalated/needs-human surface (new phase
      vs. reuse of an existing escalation owner); see the dedicated ESCALATE
      SURFACE item above. Reported per freeze ┬º11/┬º14, not fabricated.

## Next action

1. [DONE] C8 pure fact mapper committed + pushed (`e3cd300`); ledger current.
2. [HOLD] C4 concrete lifecycle runner ΓÇö PAUSED PENDING LANGGRAPH SPIKE (see
   Contract-milestone status). Pure mapper kept; concrete runner NOT built here.
   Do NOT start LangGraph work on this branch.
3. [DONE] TRANSPORT PROPOSER (OPEN R1 GAP, in-scope, NOT optional) ΓÇö concrete
   generalized provider-assisted proposer implemented as far as Cloud truthfully
   permits (`adc8053`); three LOCAL integration closures remain (above).
4. [DONE] C9 Case projection contract/read-model integration for R2 (`a9024c4`);
   LOADER RUNTIME is a LOCAL acceptance item (above).
5. [DONE] C10 B1/B2 acceptance/test mapping (`ac668e6`,
   `docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`); composed-lifecycle gap classified
   DEFERRED-LANGGRAPH + LOCAL-RUNTIME, not downgraded.
6. [DONE] Remaining Cloud-capable verification (929/929; typecheck/lint/boundary
   210/anti-hardcoding 418 clean); anti-hardcoding audit of new C9 production
   files (no demo token / uuid / route literal); LOCAL handoff ledger finalized
   (lists: concrete lifecycle runner deferred to the LangGraph decision;
   PostgreSQL/runtime checks; three transport-provider closures; C9 loader
   runtime; composed lifecycle; ESCALATE surface contract gap).
7. Produce the final report ending EXACTLY with
   `R1 CLOUD IMPLEMENTATION COMPLETE ΓÇö REQUIRES LOCAL INTEGRATION ACCEPTANCE`
   (permitted only if all Cloud-capable R1 work other than the deliberately
   paused concrete lifecycle runner is complete). CONDITION MET.

## Prohibitions (restated)

No `git add .` (exact paths only). No secrets/junk/unrelated files in commits. No
push to source/default branch. No weakened tests, no domain-logic mocks, no faked
evidence. No claim of a passing check that could not run. No restoring
RuntimeOrchestrator or building a second engine. If anything is unclear enough to
require redefining NORTHSTAR, STOP and report instead of guessing.

