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

## Verification — DONE in Cloud (cumulative through `adc8053`)

- [x] R1 pure test files green under Node v24 type-stripping:
      `r1-planning-contracts`, `r1-decision-evidence`, `r1-comparator` (11),
      `r1-planning-foundations` (13), `r1-planning-selection` (4),
      `r1-coordinator-generality` (3), `r1-progression-facts` (9),
      `r1-evidence-seam` (4), `r1-transport-proposer` (4).
- [x] Full `current` suite via `run-suite.mjs current`: 924/924 pass, 0 fail.
- [x] `npm run gate:test-boundary`: CLEAN — 209 test files classified.
- [x] `node scripts/anti-hardcoding-gate.mjs`: CLEAN — 417 files scanned.
- [x] `npm run typecheck`: exit 0 (includes the PG-requiring C1 adapter, the C8
      mapper's resolution->app type import, and the three new transport modules +
      the transport test with NO `as never`/type-suppression casts).
- [x] `eslint` on every new/changed path: clean.
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

## Next action

1. [DONE] C8 pure fact mapper committed + pushed (`e3cd300`); ledger current.
2. [HOLD] C4 concrete lifecycle runner — PAUSED PENDING LANGGRAPH SPIKE (see
   Contract-milestone status). Pure mapper kept; concrete runner NOT built here.
   Do NOT start LangGraph work on this branch.
3. TRANSPORT PROPOSER (OPEN R1 GAP, in-scope, NOT optional): implement the
   concrete generalized provider-assisted TRANSPORT proposer as far as Cloud
   truthfully permits (read-tool protocol + Atlas Search/Verify normalization +
   REPLAY evidence + adapted fallbackPlanner/northstarPlanner algorithms).
4. C9 Case projection contract/read-model integration needed for R2 (lane X).
5. C10 B1/B2 acceptance/test mapping.
6. Remaining Cloud-capable verification; anti-hardcoding audit before handoff;
   finalize the LOCAL handoff ledger (must explicitly list: concrete lifecycle
   runner deferred to the LangGraph decision; PostgreSQL/runtime checks for local
   acceptance; any transport-provider proof requiring a local environment).
7. Produce the final report ending EXACTLY with
   `R1 CLOUD IMPLEMENTATION COMPLETE — REQUIRES LOCAL INTEGRATION ACCEPTANCE`
   (permitted only if all Cloud-capable R1 work other than the deliberately
   paused concrete lifecycle runner is complete).

## Prohibitions (restated)

No `git add .` (exact paths only). No secrets/junk/unrelated files in commits. No
push to source/default branch. No weakened tests, no domain-logic mocks, no faked
evidence. No claim of a passing check that could not run. No restoring
RuntimeOrchestrator or building a second engine. If anything is unclear enough to
require redefining NORTHSTAR, STOP and report instead of guessing.
