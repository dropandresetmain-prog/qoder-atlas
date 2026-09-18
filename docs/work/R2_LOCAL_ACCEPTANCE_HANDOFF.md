# R2 LOCAL ACCEPTANCE HANDOFF — Case Decision Surface + Focused Graph

Status of this branch in Cloud: **R2 CLOUD IMPLEMENTATION COMPLETE — REQUIRES
LOCAL INTEGRATION ACCEPTANCE.**

Everything below was authored, typechecked, linted and (for the pure/Cloud-runnable
parts) unit-tested in the Qoder Cloud sandbox. The Cloud sandbox has **no
PostgreSQL, no Docker, no browser and no LIVE providers**, so every proof that
genuinely needs a database, a real browser or a live provider is deferred here and
is **NOT claimed as passed** in Cloud. This document is the exact local closure
list.

- Repository: `dropandresetmain-prog/qoder-atlas`
- Branch: `feat/r2-case-decision-surface-cloud`
- Base (accepted R1, frozen): `dc73aa9a51abf80a6e3b65abacf6bc5929223638`
- Authoritative contract: `docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md`
- Living ledger: `docs/work/ACTIVE_TASK.md` (R2 section)

## R2 checkpoint SHAs (all pushed; local == origin at handoff)

| Checkpoint | Scope | SHA |
| --- | --- | --- |
| R2-C0 | Contract freeze + living-doc reconciliation | `df3d8bffaf477da04d5b802104fa3356b7304816` |
| R2-C1 (part 1) | `FocusedGraphView` contract + pure `projectFocusedGraph` causal mapping | `333615dcb8030d181dad3dffec10843ed0ff2f2b` |
| R2-C1 (part 2) | Lane A backend enrichment (`projectFocusedCaseGraph` + `pgFactAssembler`) + `subjectHumanLabels` | `8d434e1` |
| R2-C2 | Lane B renderer (`src/ui/graph/*`, single semantic layer) | `62dda44` |
| R2-C3 | Lane C Case workspace composition (`product-recovery-case.ts`) | `545e8d7` |
| R2-C4 | Lane D polling + Original/Current | `144c951` |
| R2-C5 | PG integration test authored/typechecked (not executed in Cloud) | `2c290ad` |

(Full SHAs: resolve any short SHA with `git rev-parse <short>`.)

## Environment

- Node **v24** is required to run the TypeScript tests (the project strips types at
  runtime). In Cloud this was `/opt/playwright-driver/node` (v24.15.0); locally use
  your normal `node` (must be `>=24`, per `package.json` engines).
- PostgreSQL: `npm run db:postgres:up` starts an isolated PostGIS 16 container
  (`docker-compose.postgres-test.yml`, host port `${PGTEST_PORT:-55432}`). Override
  `PGTEST_*` if the port is taken. Migrations run automatically inside
  `sharedTestPool()` (harness), so no separate migrate step is needed for the suite.
- When several `*.pgtest.ts` files share one database, run them with
  `--test-concurrency=1` (documented PGTEST file-startup race).

## The 14 required local proofs

Run each, record the exact command and result, and tick. Items 1–7 are the
Cloud-runnable regression baseline (they should pass locally exactly as they passed
in Cloud); items 8–14 are the proofs that **could not** run in Cloud.

### A. Regression baseline (passed in Cloud on v24; re-confirm locally)

1. [ ] **Typecheck clean.**
   ```bash
   npm run typecheck   # or: node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
   ```
   Expect exit 0. (Cloud: TYPECHECK_OK.)

2. [ ] **Lint clean** on every R2 path.
   ```bash
   npm run lint
   ```
   Expect 0 errors / 0 warnings.

3. [ ] **Test-boundary gate clean.**
   ```bash
   npm run gate:test-boundary   # node scripts/test-boundary-gate.mjs
   ```
   Expect "CLEAN — 225 test files classified".

4. [ ] **Anti-hardcoding gate clean.**
   ```bash
   npm run gate:anti-hardcoding   # node scripts/anti-hardcoding-gate.mjs
   ```
   Expect "VERDICT: CLEAN".

5. [ ] **Full `current` suite green.**
   ```bash
   npm test   # gate:test-boundary + node scripts/run-suite.mjs current
   ```
   Expect 1013/1013 pass, 0 fail (Cloud: 1013 pass).

6. [ ] **R2 pure unit tests green** (the six Cloud-runnable R2 files).
   ```bash
   node --test \
     test/r2-focused-graph-projection.test.ts \
     test/r2-focused-case-graph.test.ts \
     test/r2-outcome-delta-labels.test.ts \
     test/r2-graph-renderer.test.ts \
     test/r2-case-polling.test.ts \
     test/r2-original-current.test.ts \
     test/r2-case-workspace-integration.test.ts
   ```
   Expect all pass (Cloud: 68 lane tests + 12 workspace tests).

7. [ ] **No backend liveness fields / WS-SSE usage** in the R2 surface.
   ```bash
   git grep -nEi 'isPulsing|pulseSpeed|isLive' -- src/ui src/contracts/v2/product/readModels.ts src/app/target/readmodels
   git grep -nE 'new (WebSocket|EventSource)\(' -- src/ui src/app
   ```
   Expect no matches from either. (Pulses are pure frontend CSS keyed off presented
   tone; polling is plain HTTP `fetch`. Scope is the R2 graph/read-model surface: the
   unrelated pre-existing `grantIsLive` helper in `src/resolution/authority/authorize.ts`
   and the `providerDisruptionEventSource.ts` filename are not violations.)

### B. Proofs that REQUIRE PostgreSQL (could NOT run in Cloud)

8. [ ] **Start PostgreSQL and confirm migrations apply** through the current head
   (includes 0125/0126 from R1; R2 adds **no** migration).
   ```bash
   npm run db:postgres:up
   ```
   Confirm the container is healthy and migrations run without error (the harness
   runs them on first pool use). Record the migration count / head.

9. [ ] **R2 focused Case graph PG integration proof.**
   ```bash
   PGTEST_PORT=55432 PGTEST_DB=northstar_test \
     node --test --test-concurrency=1 postgres-integration/r2FocusedCaseGraph.pgtest.ts
   ```
   Expect: enriched node kinds (SERVICE_BOOKING/PROGRAMME_COMMITMENT) + composition
   edges with producer-owned ids resolving to visible nodes; human traveller labels
   (no bare uuid); `subjectLabels` keyed `JOURNEY:<id>`; `focusedGraph` maps
   `causalPath` onto visible refs/edge ids (FIG-5b); `firstBreakpoint` echoes
   `causalPath[0]`; unmapped steps disclosed; CHECKING stays a presentation of
   `evaluation: PENDING_REASSESSMENT` while `semanticState` remains a closed verdict;
   and the **connection world** (no programme) enriches transport composition through
   the SAME code without fabricating PROGRAMME_COMMITMENT.

10. [ ] **Full PostgreSQL suite** (regression — R2 must not break R1).
    ```bash
    npm run test:postgres   # node scripts/run-suite.mjs postgres
    ```
    Expect all pass except the documented pre-existing, unrelated
    `m10RuntimePurgeBoot.pgtest.ts` baseline failure (expects 404, gets 200) and any
    documented PGTEST file-startup race that passes on rerun. Record exact pass/fail
    counts and reconcile every failure.

11. [ ] **R1 PG proofs still green** (no R2 regression on the accepted R1 path).
    ```bash
    PGTEST_PORT=55432 PGTEST_DB=northstar_test node --test --test-concurrency=1 \
      postgres-integration/r1PlanningEvidenceProjection.pgtest.ts \
      postgres-integration/r1ConnectionRecovery.pgtest.ts \
      postgres-integration/r1ComposedB1.pgtest.ts
    ```
    Expect all pass (R1 was accepted; these are its own acceptance proofs).

12. [ ] **Two-case generality on real PG fixtures.** Confirm proof 9's two worlds
    (arrival-readiness/programme AND connection/transport) both render the focused
    graph through the identical code path, with no scenario branch. This is the
    anti-hardcoding generality requirement expressed at the database level.

### C. Proofs that REQUIRE a browser / live HTTP (could NOT run in Cloud)

13. [ ] **Case workspace renders and polls in a real browser.** Serve the case
    surface (`GET /api/v2/cases/<caseRef>?format=html`, or the product route
    `/operator/cases/<caseRef>`) against live PG and confirm in a browser:
    - the focused Case graph renders inside the workspace (one component, not a page);
    - the Original/Current toggle switches panels; Original shows the honest
      "first seen this session" capture / empty state (no fabricated snapshot);
    - polling refreshes the complete snapshot every ~4s, echoes `sinceCursor`,
      skips the swap when cursor+revision are unchanged, preserves open `<details>`,
      and pauses when the tab is hidden or the case is terminal;
    - pulses are visible and derive from presented tone only (green normal / amber
      slower / red none) — confirm via DevTools that no `isPulsing`/`pulseSpeed`/
      `isLive` attribute or WS/SSE connection exists;
    - planning evidence appears AROUND the graph, marked decision-time, never as
      graph nodes;
    - `prefers-reduced-motion` disables the animations.

14. [ ] **Visual / interaction acceptance** of the V5.6 focused graph language:
    HEALTHY / CHECKING / DISRUPTED-SETTLED states read correctly; first breakpoint
    focal emphasis; causal-chain highlight vs context de-emphasis; pan/zoom and named
    views; no layout jump on poll swap. Record screenshots or an explicit pass note.

## Cloud limitations honoured (do NOT re-litigate locally as defects)

- No PostgreSQL/Docker in Cloud → proofs 8–12 are authored/typechecked only.
- No browser in Cloud → proofs 13–14 are deferred; the renderer/polling/toggle are
  unit-tested as string/DOM-contract output, not visually.
- No LIVE providers/secrets → R2 adds no provider call; the case surface is read-only
  over canonical PG state.
- **No migration was authored or applied by R2.** R2 is purely additive read-model +
  presentation; the schema is unchanged from accepted R1 (head 0126).

## PRIMARY contract verdicts recorded during R2 (binding for local acceptance)

- **OBJECTIVE node kind: NOT added.** Trip purpose stays in the existing `objectives`
  ontology (migration 0072) and is presented AROUND the graph (planning evidence /
  first-breakpoint wording), never as a causal-map node — consistent with frozen
  decisions 002/006 (current-world causal map only). Lane A's `objectiveContractGap`
  flag is retained as an honest uncertainty note, not a defect to "fix" by widening
  `LdgNodeKind`.
- **Original/Current: session-local capture ACCEPTED as the truthful interim.** The
  read model carries no frozen disruption-time snapshot; fabricating one from partial
  post-reassessment evidence would be untruthful. A **durable** disruption-time
  snapshot is a deferred PRIMARY schema decision and an **R3 candidate** — it is NOT
  implied by, and must not be back-fitted into, the session-local capture.
- **`subjectHumanLabels` keying: `<KIND>:<id>`.** Fixed at the assembler boundary
  (bare journey id → `JOURNEY:<id>`) to match the contract and `refLabel` consumers.
- **`/strategies` POST seam → R3 "Act Now".** The existing seam routes to the old
  `proposeRecoveryStrategies` (programme-time-swap proposer only; no research/
  transport/attempt persistence). R2 deliberately does NOT expose a planning control
  through that stale seam; composing the real R1 coordinator into the operator
  "Act Now" control is R3 work.

## R3 carry-forward (not R2 defects)

1. Durable disruption-time Original snapshot (schema decision) if product wants true
   cross-session Original.
2. "Act Now" operator control wired to the real R1 planning coordinator (replacing the
   stale `/strategies` seam), with attempt persistence + research/transport composition.
3. External approval/execution composition (carried from R1: an external `SELECT_OFFER`
   is recommended but refused at approval — "cannot fabricate provider capability").
4. Optional `OBJECTIVE` presentation AROUND the graph (purpose/objectives surfacing) if
   product wants trip purpose visible in the workspace — still not as a causal node.

## Suggested local closure sequence

```bash
git switch feat/r2-case-decision-surface-cloud
git pull --ff-only
npm ci
npm run typecheck && npm run lint && npm run gate:test-boundary && npm run gate:anti-hardcoding
npm test                                   # 1013/1013 expected
npm run db:postgres:up
npm run test:postgres                      # reconcile every failure
PGTEST_PORT=55432 PGTEST_DB=northstar_test node --test --test-concurrency=1 \
  postgres-integration/r2FocusedCaseGraph.pgtest.ts
# then proofs 13–14 in a real browser against live PG
```

Record the result of each of the 14 proofs above. Only when all 14 are ticked (with
the documented pre-existing `m10RuntimePurgeBoot` baseline failure reconciled) is R2
locally accepted. The Cloud terminal status remains
**R2 CLOUD IMPLEMENTATION COMPLETE — REQUIRES LOCAL INTEGRATION ACCEPTANCE** until
then.


---

## LOCAL RECONCILIATION (2026-09-19) — durable Original supersedes the session-local interim

The "session-local capture ACCEPTED as the truthful interim" verdict above is preserved as Cloud history. Product has since decided
**Original = immutable persisted first truthful focused Case graph snapshot** (migration 0127, `recovery_case_graph_snapshots`,
captured by the progression pass at the first settled failing basis). R2 therefore DOES add a migration (0127) — the "R2 adds no migration"
statements and R3-carry-forward item 1 are superseded. Proofs 13/14 were executed with the durable Original: it survives refresh, browser
restart and later Case changes. See `docs/work/ACTIVE_TASK.md` (R2 LOCAL ACCEPTANCE) for evidence.
