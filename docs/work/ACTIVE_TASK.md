# ACTIVE TASK — R1 Planning + Decision-Evidence Parity (CLOUD IMPLEMENTATION)

Live working-memory ledger for the R1 Cloud implementation lane. Reread this file
before every major phase, before every checkpoint commit/push, and before the final
report. The completed truth-rebase/contract-freeze planning ledger is preserved at
`docs/work/TRUTH_REBASE_CONTRACT_FREEZE_ACTIVE_TASK.md` and is NOT rewritten here.

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
that extends the existing `recoveryPlanning.ts` seam, and prove generality — while
deferring every check that genuinely requires PostgreSQL/LIVE providers to a LOCAL
integration-acceptance ledger.

Terminal status for this task is EXACTLY one of:
- `R1 CLOUD IMPLEMENTATION COMPLETE — REQUIRES LOCAL INTEGRATION ACCEPTANCE`
- `R1 CLOUD IMPLEMENTATION BLOCKED — <blocker>`
NEVER `R1 ACCEPTED — READY FOR R2`.

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

## Frozen contracts materialized (Phase B — PRIMARY)

All under `src/contracts/v2/planning/`, exported via `src/contracts/v2/index.ts`:

- [x] C1 `recoveryPlanningAttempt.ts` — RecoveryPlanningCoordinator port, bounded
      immutable attempt record, closed outcome/reason vocabularies, materiality rules.
- [x] C2 `planningTool.ts` — read-only PlanningTool request/result protocol,
      canonical fingerprint, dedupe, bounded research budget.
- [x] C3 `recoveryDomain.ts` — recovery-domain registry, hybrid deterministic+AI
      selection, fail-closed.
- [x] C4 `proposerAdaptation.ts` — additive domain/evidence context for proposers;
      base StrategyProposer port unchanged.
- [x] C5 (with C1) material decision evidence inside the attempt record.
- [x] C6 `strategyRecommendation.ts` — viable-only recommendation + deterministic
      validation rejecting non-viable/stale/foreign refs; preference precedence.
- [x] C7 `impactSemantics.ts` — three distinct impact projections as pure functions.
- [x] C8 `recoveryProgression.ts` — single post-reassessment progression decision
      (RuntimeOrchestrator stays retired).
- [x] barrel `index.ts`.
- [ ] C9 Case projection — owned by lane X (static review) in Phase C.
- [ ] C10 B1/B2 acceptance — owned by lane V (tests) + final report in Phase C.

## Ownership map (PRIMARY retains)

- Shared architecture + all frozen contracts (C1-C10 shape).
- Schema/migration authoring and any migration-order/FK decisions.
- Integration decisions across lanes; cross-lane reconciliation.
- Recovery Lifecycle Progression service (composed under `runtimeServices`).
- Final Cloud verification; checkpoint commits and pushes.

## Phase C write lanes (fan out ONLY after C1 push)

- Lane P — planner core: extend `src/app/target/recoveryPlanning.ts` into the C1
  coordinator; read-only tool dispatch; transport proposer; comparator/preferences.
- Lane E — persistence: RecoveryPlanningAttempt repository/command over migration
  0125; impact-projection projections wired into the attempt record.
- Lane V — verification: pure Cloud-runnable tests (contracts, coordinator with
  injected fakes at the SEAM only, REPLAY-based) + the LOCAL-required pg list.
- Lane X — Case projection (C9): static review of the PostgreSQL Case read model.

Each lane branches from the C1 SHA and returns exact-path diffs; PRIMARY
reconciles and integrates.

## Checkpoints

- [x] Phase A recon (A1-A5 read-only) — complete.
- [x] Phase B contracts materialized + typecheck clean.
- [x] C1 checkpoint: contracts + migration 0125 authored + pure tests green +
      suites.json classification + ACTIVE_TASK ledger + this doc.
      Commit `feat(r1): materialize recovery planning contracts`. PUSHED.
      - branch: `feat/r1-planning-parity-cloud`
      - C1 SHA: `c7bb86a740b2370f97998e14b3fe3fa7fe13e9ef` (local == origin)
      - Phase C lanes branch from this SHA.
- [x] C3 foundation — pure decision-evidence assembly
      (`src/resolution/planning/decisionEvidence.ts`): the bridge from real RC-6
      `EvaluateStrategyResult` + closure to the three frozen impact projections
      (C7) and MaterialCandidateEvidence (C5), validated against the contract.
      Added `RecoveryPlanningAttemptSchema` interval refine (app/DB parity with
      migration 0125 CHECK). 46 pure tests pass; full `current` suite 876/876.
      Commit `feat(r1): assemble decision evidence from real RC-6 output`.
      - SHA: `a183cebf165287dd1093cc606cea1d12cffa7bf0` (local == origin)
- [x] Lane E — RecoveryPlanningAttempt persistence
      (`src/persistence/postgres/commands/r1PlanningAttemptCommands.ts`): idempotent
      command over migration 0125 (not an aggregate root; `advanced: []`, mirrors
      `completeChangeSignal`), uuid-narrowing at the DB boundary, FK pre-checks,
      contract round-trip read helpers. Authored pg integration test
      `postgres-integration/r1RecoveryPlanningAttempt.pgtest.ts` (classified
      `postgres`; NOT executed in Cloud). Typecheck/lint/boundary clean.
- [ ] C2 — planner core (lane P integrated): coordinator extending
      `recoveryPlanning.ts`; read-only tool dispatch; transport proposer; comparator.
- [ ] C3 — decision evidence end-to-end at the seam (coordinator persists attempt).
- [ ] C4 — Recovery Lifecycle Progression service (PRIMARY).
- [ ] C5 — integration + generality proof (>=2 materially different situations).

## Verification — DONE in Cloud (C1 + C3 foundation)

- [x] `test/r1-planning-contracts.test.ts` + `test/r1-decision-evidence.test.ts`:
      46/46 pass (Node v24 type-stripping).
- [x] Full `current` suite via `run-suite.mjs current`: 876/876 pass, 0 fail.
- [x] `npm run gate:test-boundary`: CLEAN — 201 test files classified.
- [x] `node scripts/anti-hardcoding-gate.mjs`: CLEAN — 405 files scanned.
- [x] `npm run typecheck`: exit 0.
- [x] `eslint` on new/changed paths: clean.

Note: the sandbox default `node` is v20.18; the project requires `>=24`. Cloud
verification of TS tests uses the available v24 runtime (`/opt/playwright-driver/node`)
which matches the documented engine and the `run-suite.mjs` `--test` invocation.

## Verification — UNAVAILABLE in Cloud (LOCAL handoff ledger)

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
- [ ] Recovery Lifecycle Progression pg integration (RESOLVE/WAIT/REPLAN/ESCALATE
      against real case + assessment state).
- [ ] Generality proof run against real PG fixtures (>=2 materially different
      planning situations through the same coordinator).
- [ ] Any LIVE/RECORD provider evidence (Cloud is REPLAY-only, credential-free).

## Next action

1. Exact-path stage C1 (contracts, migration, test, suites.json, both ACTIVE_TASK
   docs) and commit `feat(r1): materialize recovery planning contracts`.
2. PUSH; record branch + SHA here.
3. ONLY AFTER the push, fan out Phase C lanes P/E/V/X from the C1 SHA.

## Prohibitions (restated)

No `git add .` (exact paths only). No secrets/junk/unrelated files in commits. No
push to source/default branch. No weakened tests, no domain-logic mocks, no faked
evidence. No claim of a passing check that could not run. No restoring
RuntimeOrchestrator or building a second engine. If anything is unclear enough to
require redefining NORTHSTAR, STOP and report instead of guessing.
