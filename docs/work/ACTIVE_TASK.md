# ACTIVE TASK — R1 Planning + Decision-Evidence Parity (LOCAL INTEGRATION)

Live working-memory ledger for the R1 local integration and acceptance lane. Reread this
file before every major phase, before every checkpoint commit/push, and before the final
report. The completed Cloud implementation record remains below as historical handoff
evidence. The completed truth-rebase/contract-freeze planning ledger is preserved at
`docs/work/TRUTH_REBASE_CONTRACT_FREEZE_ACTIVE_TASK.md` and is NOT rewritten here.

## Local integration snapshot — 2026-09-19

- Branch: `feat/r1-local-integration`, created directly from accepted Cloud handoff
  `e3598642058e6329e8a7e800d052a15773686488`.
- PostgreSQL: isolated disposable PostGIS 16 container on port `55433`; migrations through
  `0126_recovery_case_attention.sql` apply cleanly through the normal test harness.
- L1 status: **COMPLETE — commit `2c46bd4535402db780815de0557a98d1e5e2595e` pushed.** The Cloud coordinator
  committed viable strategies, PlanningAttempt, and final case phase in separate Units of
  Work. It now uses one `RECOVERY_PLANNING_COMPLETED` UnitOfWork command, with fresh basis
  and pending-reassessment guards before promotion. Fault injection proves strategy,
  PlanningAttempt, and `AWAITING_AUTHORITY` roll back together; success commits together.
- LangGraph decision resolved: **REJECTED** (runtime-spiked; history below is preserved and the
  old DEFERRED-LANGGRAPH classification is superseded). C4: **BESPOKE RECONCILE-FROM-POSTGRES
  IMPLEMENTED** — see L4B. No LangGraph package/table, no RuntimeOrchestrator, no cursor.
- L2 transport status: **COMPLETE — commit `acc83b45bf24b5cbb75ae6bde01da3d4dbe222dc` pushed.**
  `PgWorldReader` retains `place_external_refs`; the coordinator optionally composes the
  read-only transport seam; searched offers become provenance-carrying services only in an
  isolated planning capture, never bookings or canonical PostgreSQL transport rows.
- L3 C9 PG status: **COMPLETE — commit `8a78f8c39c136de00be19c3742da7380b72cc15a` pushed.**
  `postgres-integration/r1PlanningEvidenceProjection.pgtest.ts` (5/5) runs the REAL coordinator on
  the generic programme world and reads the attempt through `findLatestRecoveryPlanningAttemptForCase
  -> loadRecoveryCaseFactsInner -> projectRecoveryCase`: no attempt => no planning block; domains,
  rejected/viable candidates + deterministic reasons, recommendation, the three impact concepts,
  decision-time `asOf`; a later canonical change (approve/execute/resolve) does not rewrite the
  attempt. Known R2 gap: outcome-delta subject labels are generic ("Journey") — refs are secondary
  but the human label does not yet name the traveller (current-state `strategies[]` does).
- L4A ESCALATE: **COMPLETE — commit `c6791bf6a780fef179d0e9c4dae36dd4eab66b34` pushed.** Design
  hypothesis confirmed: escalation is ORTHOGONAL to case phase. No ESCALATED phase; migration
  `0126_recovery_case_attention.sql` adds a Case-owned `recovery_case_attention` record
  (case + basis assessment + closed reason; OPEN -> RESOLVED only; never deleted), idempotent per
  (case, basis, reason), cleared by a superseding basis or by `resolveRecoveryCase` (same tx),
  surfaced as `RecoveryCaseView.attention[]`. Reasons: `no_safe_recovery_remaining`,
  `human_evidence_or_decision_required`. Not a new ontology entity.
- L4B C4 progression: **COMPLETE — commit `5fb337b627c2234c9bc75e6c196425e5f16519cf` pushed.**
  `src/app/target/recoveryProgressionPass.ts`, composed once in the `caseLifecycle` runtime service
  (replaces the resolve-only pass; existing periodic + `runNow` semantics). Per wake, per
  non-terminal case with a JOURNEY/TRIP subject: settled current basis -> resolution gate +
  attempt facts -> frozen C8 decision -> one dispatch (`resolveRecoveryCase` / `planCase` /
  attention). Unsettled assessment => WAIT. Progression never dispatches or retries execution.
  Focused PG `r1RecoveryProgression.pgtest.ts` 8/8.
- L5 composed B1: **COMPLETE — commit `e8036bb401f63975b9ed886b77de7047aadc83ff` pushed.**
  `postgres-integration/r1ComposedB1.pgtest.ts` — one PostgreSQL-backed loop driven only by C4 wakes:
  provider-shaped change -> whole-trip FAIL -> REPLAN (coordinator) -> TRANSPORT + PROGRAMME investigated
  (an arrival-readiness deficit now activates TRANSPORT through a dimension-scoped reason token) ->
  read-only REPLAY flight research (provider/provenance on the Case view) -> RC-6 rejects the boardable
  flights (none restores readiness in time) and a regressing swap, accepts one programme swap ->
  viable-only recommendation with the three distinct impact concepts -> operator approval ->
  two internal intents -> existing internal execution -> canonical programme change -> reassessment ->
  C4 RESOLVE. The winning strategy was not encoded; it emerged from domains + evidence + RC-6 + comparator.
  The Case read model now also surfaces the stored `resolution_summary`.
- L6 unknown outcome / reconciliation: **COMPLETE — commit `de2f5088fbb1e970a8b8497e54606dceb0c92156` pushed.**
  `r1UnknownOutcome.pgtest.ts` (4/4) on the real stored-execution/provider boundary: LOST_RESPONSE ->
  OUTCOME_UNKNOWN -> repeated C4 wakes only WAIT; dispatcher (provider mutation) call count stays 1; blind
  redispatch refused; STILL_UNKNOWN / FOUND_FAILURE keep WAITing with no retry; FOUND_SUCCESS is the only
  path to RESOLVE (through the gate). Also `r1RecoveryProgression.pgtest.ts`: an approved plan that completed
  without changing the basis escalates rather than replanning the same basis.
- Second generality: **COMPLETE (same commit).** `r1ConnectionRecovery.pgtest.ts` — no programme at all: a
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

## R1 local acceptance — 2026-09-19

Status: **R1 ACCEPTED — READY FOR R2**

- C9 real-PG projection proof, truthful durable escalation, C4 focused proof, composed B1 through C4,
  unknown-outcome safety and a second generality case: all proven on PostgreSQL (L3-L6 above).
- `CURRENT_TARGET` (`npm test`): 933/933. Typecheck, full ESLint and the anti-hardcoding gate: clean.
- Full PostgreSQL suite (fresh DB, run once): 552/556. Of the 4 failures: 2 were stale expectations of
  mine (migration-lane allocation list for 0125/0126; jsonb allowlist for the 0125 attempts table) — fixed and
  re-verified; 1 was `r1ConnectionRecovery.pgtest.ts` failing at file start in 0.7s with no assertion (the
  documented PGTEST-FILE-STARTUP-RACE), passing on rerun; 1 is `m10RuntimePurgeBoot.pgtest.ts`, which fails
  identically at baseline with these changes stashed (pre-existing, unrelated).
- The fixed/rerun files passed together sequentially (25/25). A second full-suite run was not repeated.
- Docs reconciled: this ledger, `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md` §11 (R1 local resolution of C8) and
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
- [x] C9 Case projection — decision-time planning evidence surfaced on the
      PostgreSQL Case read model (human labels primary, typed refs/codes
      secondary; `phase:'DECISION_TIME'`+`asOf` visibly separate it from current
      authoritative state). Part 9, `a9024c4`.
- [x] C10 B1/B2 acceptance — coverage map + PRIMARY gap reconciliation
      (`docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`). Part 10, `ac668e6`.

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
      Commit `feat(r1): persist RecoveryPlanningAttempt over migration 0125`.
      - SHA: `4aefbd0` (local == origin)
- [x] Lane P (part 1) — C6 comparator
      (`src/resolution/planning/comparator.ts`): pure viable-only ranking —
      precedence-ordered preference alignment, then deterministic facts
      (regressions, improvements, blast radius, declared cost; absent cost sorts
      last), then stable ref tiebreak; refusal (undefined) when no usable
      candidate; semantic notes explain but never rank; output re-validated via
      `validateStrategyRecommendation`. `test/r1-comparator.test.ts` 11/11 pass;
      full `current` suite 887/887; typecheck/lint/boundary/anti-hardcoding clean.
      Commit `feat(r1): select viable-only recommendation deterministically (C6 comparator)`.
      - SHA: `b6ed62ee0c4d595c1b027c054df099325ddc0da2` (local == origin)
- [x] Lane P (part 2) — C3 domain registry + C2 research dispatcher foundations
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
- [x] Lane P (part 3) — pure selection layer
      (`src/resolution/planning/planningSelection.ts`): comparator-fact
      derivation from the frozen impact projections (worseCount/betterCount from
      outcomeDelta, blastRadiusSize from immediate blast radius; no facts for a
      validation rejection that never reached RC-6) + closed-vocabulary
      `planningOutcomeOf` mapping (returns the contract's own
      `RecoveryPlanningOutcome`, so the mapping cannot drift from the frozen
      enum). `test/r1-planning-selection.test.ts` 4/4 pass (fact derivation
      exercised through REAL RC-6 output); full `current` suite 904/904;
      typecheck/lint/boundary/anti-hardcoding clean.
- [x] Lane P (part 4) — C1 coordinator CORE + C5 generality proof
      (`src/resolution/planning/coordinatorCore.ts`): the single generalized
      `runRecoveryPlanning` pipeline — deterministic domain registry -> optional
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
- [x] Lane P (part 5) — C1 PostgreSQL ADAPTER
      (`src/app/target/recoveryPlanningCoordinator.ts`): implements the frozen
      `RecoveryPlanningCoordinator.planCase` port. Reads the CURRENT basis from
      canonical PG with the SAME public helpers the accepted B1 seam uses, then
      delegates ALL decision logic to the pure core, then persists via REAL
      commands (persistRecoveryStrategy per VIABLE strategy + the ONE immutable
      attempt over migration 0125) and advances the case phase only on
      AWAITING_AUTHORITY. Deterministic id/version minting mirrors the B1
      planning namespace (idempotent per case/basis/candidate). Reuses
      `advanceCasePhase` from the existing seam — no second engine, no
      RuntimeOrchestrator. Requires PG: TYPECHECKED + LINTED in Cloud, NOT
      executed here (LOCAL integration-acceptance item). Typecheck/lint/boundary/
      anti-hardcoding clean; full `current` suite 907/907.
      Commit `feat(r1): bind recovery planning coordinator core to PostgreSQL (C1 adapter)`.
      - SHA: `f0fe4489d1d8e6328ba5d91e98d71a227b9400d4` (local == origin)
- [x] Lane P (part 6) — C8 progression FACT MAPPER (pure)
      (`src/resolution/planning/progressionFacts.ts`): honest projection from what
      EXISTING owners OBSERVE — the deterministic resolution gate result
      (`ResolutionGateResult`), an explicit authority/execution-pending flag,
      recovery-remains-possible and the settled basis assessment id — onto the
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
      **ESCALATE SURFACE — CONTRACT GAP reported (not papered over):** the existing
      case lifecycle has OPEN->PLANNING->AWAITING_AUTHORITY->EXECUTING plus terminal
      RESOLVED/CLOSED/CANCELLED/SUPERSEDED but NO dedicated escalated/needs-human
      state or command. Per the C8 contract's own instruction this is reported for
      PRIMARY/local resolution rather than fabricating a new phase; the mapper still
      returns the truthful ESCALATE decision.
      Commit `feat(r1): C8 progression fact mapper — observed gate/authority facts onto frozen decision`.
      - SHA: `e3cd300e35c3ed182a5b067a011360ecc2420945` (local == origin)
- [x] Lane P (part 7) — evidence-threading seam (C2/C4)
      Three additive core edits so a `DomainStrategyProposer` receives raw
      normalized tool results: `researchDispatcher` returns index-aligned
      `results: PlanningToolResult[]`; `coordinatorCore` zips evidence+results
      per domain, builds `PlanningEvidenceContext`, and adapts a domain proposer
      via the previously-DEAD frozen `bindDomainProposer` (base
      `StrategyProposer` unchanged). `test/r1-evidence-seam.test.ts` 4/4.
      - SHA: `0761de6` (local == origin)
- [x] Lane P (part 8) — concrete provider-assisted TRANSPORT PROPOSER
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
      provider call) — wired over REPLAY Atlas + checked-in recordings in Cloud, the
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
- [x] Lane P (part 9) — C9 Case projection (decision-time planning evidence)
      (`contracts/v2/product/readModels.ts` additive `PlanningEvidenceViewSchema`
      block + optional field on `RecoveryCaseViewSchema`;
      `app/target/readmodels/projectPlanningEvidence.ts` PURE projector;
      additive `planningAttempt` fact in `types.ts`; conditional spread in
      `projectRecoveryCase.ts`; barrel export; authored
      `findLatestRecoveryPlanningAttemptForCase` loader in
      `r1PlanningAttemptCommands.ts` + wired into `loadRecoveryCaseFactsInner`).
      Surfaces freeze §12 Q4-Q12 (domains investigated, read-only tools +
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
      Commit `feat(r1): C9 Case projection — decision-time planning evidence in the read model`.
      - SHA: `a9024c4621813ac4c5ecaeafd320db7bdb09f0c2` (local == origin)
- [x] Lane V (part 10) — C10 B1/B2 acceptance ↔ test coverage map
      (`docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`): every B1 (rebase §12, 18
      criteria + freeze §13 structural) and B2 (rebase §13, 12 items + freeze
      §14 structural) criterion mapped to REAL passing test titles, or the gap
      classified CLOUD-NOW / DEFERRED-LANGGRAPH / LOCAL-RUNTIME. PRIMARY
      reconciliation of the recon finding ("no test composes the lifecycle
      through the coordinator"): the individual deterministic units ARE
      Cloud-tested; the COMPOSITION is the concrete C4 outer runner that
      direction item 1 PAUSES pending the LangGraph spike, so it is
      DEFERRED-LANGGRAPH (+ LOCAL-RUNTIME for the canonical-PG stages + the open
      ESCALATE-surface contract gap), NOT a plain Cloud gap and NOT silently
      downgraded. No criterion left unclassified. Commit
      `docs(r1): C10 B1/B2 acceptance ↔ test coverage map + PRIMARY gap reconciliation`.
      - SHA: `ac668e614153ed1b87ceabb15f84a658225c4b19` (local == origin)

### Contract-milestone status (Phase C)

- [x] C2 — planner core integrated: generalized coordinator CORE (part 4) + PG
      ADAPTER (part 5); read-only bounded research dispatch (part 2); viable-only
      comparator (part 1); evidence-threading seam (part 7); and the **concrete
      provider-assisted TRANSPORT PROPOSER (part 8, `adc8053`)** — the previously
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
      reclassified optional — these are integration/runtime seams only.
- [x] C3 — decision evidence end-to-end at the seam: the coordinator assembles the
      three separate impact projections + material candidate evidence and persists
      the ONE immutable attempt over migration 0125 (parts 3-5).
- [HOLD] C4 — Recovery Lifecycle Progression (PRIMARY): pure fact mapper DONE +
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
- [x] C5 — integration + generality proof: THREE materially different situations
      through ONE `runRecoveryPlanning` (part 4, `9740c18`), no scenario branch.
- [x] C9 — Case projection (part 9, `a9024c4`): decision-time planning evidence
      (freeze §12 Q4-Q12) surfaced on the PostgreSQL Case read model. Additive
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
- [x] C10 — B1/B2 acceptance ↔ test coverage map (part 10, `ac668e6`,
      `docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md`): every B1 (rebase §12, 18 +
      freeze §13 structural) and B2 (rebase §13, 12 + freeze §14 structural)
      criterion mapped to REAL passing test titles or classified
      CLOUD-NOW / DEFERRED-LANGGRAPH / LOCAL-RUNTIME. PRIMARY reconciliation: the
      composed-lifecycle gap is the concrete C4 outer runner (DEFERRED-LANGGRAPH)
      + canonical-PG stages (LOCAL-RUNTIME) + the ESCALATE-surface contract gap —
      NOT a plain Cloud gap and NOT silently downgraded. No criterion unclassified.

## Verification — DONE in Cloud (cumulative through `a9024c4` / `ac668e6`)

- [x] R1 pure test files green under Node v24 type-stripping:
      `r1-planning-contracts`, `r1-decision-evidence`, `r1-comparator` (11),
      `r1-planning-foundations` (13), `r1-planning-selection` (4),
      `r1-coordinator-generality` (3), `r1-progression-facts` (9),
      `r1-evidence-seam` (4), `r1-transport-proposer` (4),
      `r1-case-projection` (5).
- [x] Full `current` suite via `run-suite.mjs current`: 929/929 pass, 0 fail.
- [x] `npm run gate:test-boundary`: CLEAN — 210 test files classified.
- [x] `node scripts/anti-hardcoding-gate.mjs`: CLEAN — 418 files scanned.
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
      Specifically the C1 PG ADAPTER (`src/app/target/recoveryPlanningCoordinator.ts`,
      `f0fe448`) — typechecked + linted in Cloud, NEVER executed here: verify
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
      WAIT = no-op; ESCALATE = recorded) is NOT yet authored — it is PRIMARY-owned
      and requires PG to run. Must be idempotent per settled basis, must NOT create a
      second status machine, must NOT restore RuntimeOrchestrator.
- [ ] **ESCALATE SURFACE — CONTRACT GAP (needs PRIMARY/local decision, NOT a Cloud
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
- [ ] **TRANSPORT PROPOSER — three LOCAL integration/runtime closures** (the
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
         `src/intelligence` reads `'airport-code'` — the resolver must accept both
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
- [ ] **Composed lifecycle (B1-15..18 / B2 full-lifecycle) — DEFERRED-LANGGRAPH +
      LOCAL-RUNTIME.** No single test composes
      coordinator -> authority -> external dispatch -> observation ->
      reconciliation -> reassessment -> resolution. Per the C10 map
      (`docs/work/R1_C10_B1_B2_ACCEPTANCE_MAP.md` §3) the deterministic UNITS are
      Cloud-tested (m8 authority/gate, wave3r-dr2 REPLAY dispatch/reconcile/
      observe, m9-jordan RECORD partial failure, r1-progression-facts pure C8,
      r1-coordinator-generality planning); the COMPOSITION is the concrete C4
      outer runner that direction item 1 PAUSES pending the LangGraph spike, and
      its canonical-state stages also need PG. NOT a plain Cloud gap, NOT
      downgraded, NOT built on this branch. LOCAL/LangGraph: once the outer-runner
      decision lands, compose the lifecycle and assert the full B1/B2 path
      end-to-end (REPLAY/RECORD suffices for the behavioural proof; canonical
      writes need PG).
- [ ] **ESCALATE case surface — CONTRACT GAP (reiterated for B2-12).** The
      composed lifecycle's "explicit escalation" branch cannot ACT until local
      integration decides the truthful escalated/needs-human surface (new phase
      vs. reuse of an existing escalation owner); see the dedicated ESCALATE
      SURFACE item above. Reported per freeze §11/§14, not fabricated.

## Next action

1. [DONE] C8 pure fact mapper committed + pushed (`e3cd300`); ledger current.
2. [HOLD] C4 concrete lifecycle runner — PAUSED PENDING LANGGRAPH SPIKE (see
   Contract-milestone status). Pure mapper kept; concrete runner NOT built here.
   Do NOT start LangGraph work on this branch.
3. [DONE] TRANSPORT PROPOSER (OPEN R1 GAP, in-scope, NOT optional) — concrete
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
   `R1 CLOUD IMPLEMENTATION COMPLETE — REQUIRES LOCAL INTEGRATION ACCEPTANCE`
   (permitted only if all Cloud-capable R1 work other than the deliberately
   paused concrete lifecycle runner is complete). CONDITION MET.

## Prohibitions (restated)

No `git add .` (exact paths only). No secrets/junk/unrelated files in commits. No
push to source/default branch. No weakened tests, no domain-logic mocks, no faked
evidence. No claim of a passing check that could not run. No restoring
RuntimeOrchestrator or building a second engine. If anything is unclear enough to
require redefining NORTHSTAR, STOP and report instead of guessing.
