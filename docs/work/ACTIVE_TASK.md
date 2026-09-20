# ACTIVE TASK — A5 BACKEND TRUTH CLOSURE (bounded follow-up pass)

## Identity

- Repo: dropandresetmain-prog/qoder-atlas
- Working branch: `qoder/general-session-x3h3qj` (outcome branch)
- Base: `fix/a5-backend-truth-closure` @ `c4680005f30338378c1d2e49830e8c35bb1ca6f7`
- Accepted A4 execution baseline (FROZEN): `finish/a4-destination-hotel-robustness` @ `546adf210db8ead343ecdac22b410515665c176a`
- Mission: close demo-relevant backend audit findings; NOT a planner/recovery/authority/execution/provider/PG redesign.
- Sandbox: PG16 + PostGIS running locally at 127.0.0.1:55432 (northstar_test/northstar_test, db northstar_test). Env for PG tests: PGTEST_HOST=127.0.0.1 PGTEST_PORT=55432 PGTEST_DB=northstar_test PGTEST_USER=northstar_test PGTEST_PASSWORD=northstar_test

## Phase checklist

- [x] CP1 investigation + contract decisions (complete)
- [x] CP2 FIX1 D2 monitoring + FIX2 connection classification — focused tests green — push
- [ ] CP3 FIX3 controlled runtime clock — background-worker/progression proof — push
- [ ] CP4 FIX4 causal Qwen planning seam — safety + causal acceptance proof — push
- [ ] CP5 FIX6 demo preflight + integration + anti-hardcoding + docs — push
- [x] INV5 multi-subject progression — **Park for Later** (production cases single-subject; settledBasis untouched)

## Current checkpoint

CP2 COMPLETE (pushed). Next: CP3 — FIX3 controlled runtime clock.

## CP1 investigation results (subagents, verified against code)

- FIX4 seam: model-influenced TRANSPORT offer SELECTION within the existing cap (`rankOffers(...).slice(maxOffersPerCorridor)`, transportProposer.ts:219). Offer ids come from real evidence; schema-validated; fail-closed to deterministic ranking; RC-6/comparator/authority untouched. Needs: `PlanningModelActivitySchema.operation` literal → union incl. `recovery.offer_selection`; check migration 0131 CHECK constraint (may need 0136). Both proposer AND `materializeTransportOffers` must consume the same selection or overlay can't honor SELECT_OFFER.
- FIX3 clock: injection seams already exist (createPeriodicService now, drain loop now, planCaseDetailed input.now/deps.now, passes ctx.now). Hardcoded wall-clock gaps: buildReassessmentPipeline (composeTargetBoot.ts:83), periodic services not supplying now, HTTP time-swap stage. MUST stay wall clock: completionClock, modelActivities.observedAt, pgFactAssembler generatedAt, command receipt timestamps, provider observedAt. No existing clock table; latest migration 0135 → new 0136 workspace-scoped controlled clock (WALL|CONTROLLED + controlled_now), runtime-owned, harness advances it.
- INV5: **Park for Later** — production escalation opens one case per failing JOURNEY subject (caseEscalation.ts:136-155); TRIP subjects never attached in production; Sarah Case = 1 failing journey, Jordan = 1 journey. Multiple failing subjects per case only in hand-built test fixtures. No code change; skip extra test (settledBasis untouched).
- FIX6 preflight inventory: dataset marker `source_records.source_identity='northstar:dataset:<key>'`; travellers/journeys counts; composeTargetIntelligence (MODEL_STUDIO_API_KEY); Atlas planning/execution compose guards (ADAPTER_MODE, credentials, sandbox host); Nuitée (NUITEE_API_KEY); offer_execution_bindings/stay_execution_bindings/traveller_booking_identities; budgets via journeys→trips→org; authority coverage (workspaceAuthority uncoveredSubjectCount); blockers FRESH_PROVIDER_QUOTE_REQUIRED (research_mode not LIVE/RECORD), EXECUTION_INPUTS_UNAVAILABLE, BUDGET_UNAVAILABLE; active displaced stay = journey_items lifecycle + reservations observed_status HELD/CONFIRMED; NORTHSTAR_RECOVERY_RESEARCH_CONFIG. Report shape: `{ok, checks:[{id,severity,ok,detail}]}` per src/acceptance/preflight.ts conventions. Fail-closed, read-only.

## Findings (accumulate)

### FIX1 — D2 falls through to ESCALATE (CONFIRMED in code)
- `recoveryProgressionPass.ts:207-221`: tight-only FAIL → `planningEligible=false` → `recoveryRemainsPossible=false`; gate=BLOCKING_FAIL, no attempt → frozen decision falls to `ESCALATE / no_safe_recovery_remaining`.
- Frozen contract `recoveryProgression.ts` has only 4 states; WAIT exists but precedence only reaches it via authority/execution pending.
- Planned smallest correction: extend `RecoveryProgressionInput` with an explicit truth (e.g. `planningEligible`/monitorable flag) → WAIT with new reason `monitorable_failing_state` (pass-level) BEFORE the ESCALATE fallthrough. Attempt-exhausted-on-this-basis still ESCALATEs (do not regress `r1RecoveryProgression.pgtest.ts`). Case stays open (WAIT dispatches nothing), CONNECTION_AT_RISK preserved by mapConnectionProgression, no attention opened.

### FIX2 — connection classification information loss (CONFIRMED in code)
- A: `connectionViabilityFromAssessment` (mapConnectionProgression.ts:83) uses `explanations[0]` only. Explanations are sorted by stable content-hash id (explain.ts:75) → ordering is arbitrary w.r.t. severity. A broken connection can hide behind a tight one. `pgFactAssembler.ts:740-748` aggregates worst-of ACROSS subjects but still per-dimension `explanations[0]`.
- B: `productStatusFromAssessment`/`remainder`/`semanticState` return amber whenever connection hint is TIGHT — even if a SEPARATE blocking non-connection dimension definitively FAILs. Need aggregate: amber only when the connection is the sole blocking failure.
- C: `deriveConnectionViabilityFromEvaluator` maps every FAIL except `connection_broken` to TIGHT — including `transfer_does_not_fit` with negative gap (evaluator connection.ts:173 emits it when gap < transfer minutes; gap may be negative = physically impossible). Must use facts.gapMinutes for transfer_does_not_fit.
- Plan: one shared deterministic helper (aggregate over ALL failing explanations of the connection dimension; worst-of severity; separate `hasNonConnectionBlockingFailure`), consumed by product status / remainder / semantic state / planning eligibility / progression. Keep D1 (VIABLE) / D2 (TIGHT) / D3 (IMPOSSIBLE) behavior.

### FIX3 — clock (to confirm via agent C)
- Boot: `buildReassessmentPipeline` uses `new Date()` internally; `createPeriodicService` default wall clock; coordinator `now = input.now ?? deps.now ?? wall`; harness passes stage.at per stage; clock-only overnight stages only printed (`planningNow`).
- `RecoveryPlanningInput.now` already exists ("planning clock for progressive demo/operator control").
- Design direction: runtime-owned evaluation clock seam (DB-persisted controlled clock row + env opt-in), consumed by reassessment pipeline, lifecycle/progression passes, planning basis; provider evidence timestamps stay wall-clock-truthful; default = wall clock. Harness advances the clock (incl. clock-only stages).

### FIX4 — Qwen causal role (CONFIRMED non-causal today)
- `recoveryPlanningCoordinator.ts:392-427`: deterministic registry resolves ALL domains first (`resolveRecoveryDomainDecisions` records every registered domain, `recoveryDomain.ts:183-186`); AI suggestions filtered against `already` investigated set → cannot change which domains are investigated. A successful Qwen call is causally inert when registry already covers everything.
- Direction: bounded model-owned seam at the StrategyProposer/DomainStrategyProposer boundary (e.g. AI-influenced TRANSPORT offer selection/ranking or bounded judgement feeding legitimate proposal content), schema-validated, fail-closed, RC-6/comparator/authority untouched. Awaiting agent A findings on comparator/materialization before freezing design.

### INV5 — multi-subject progression (to confirm via agent B)
- `settledBasis()` (recoveryProgressionPass.ts:105) picks first failing JOURNEY/TRIP in canonical order. Escalation attaches only JOURNEY subjects (`caseEscalation.ts` subjectKinds default ['JOURNEY']). If hero cases carry exactly one relevant subject each → Park for Later.

### FIX6 — preflight
- New deterministic read-only operator preflight script; fail closed; generic checks (no hero names in app logic — scenario facts via config/data). Awaiting agent D inventory of provisioning/env inputs.

## Scope constraints (critical)

- Do NOT reopen: PG persistence ownership, planner architecture, selected-plan continuation, authority, protected execution, Atlas/Nuitée provider architecture, canonical receipt application, unknown-outcome reconciliation, importer, immigration/insurance/transfer transactions, mobile, onboarding, auth, 200-case fairness, health infra, extra scenarios/providers.
- No hero-specific branching (names/events/routes/fixture ids/stage names) in application logic.
- No A5.2 destructive provider transactions.
- Focused tests during iteration; `npm run gate:anti-hardcoding` before final push.

## Acceptance evidence

### CP2 — FIX1 (D2 monitorable) + FIX2 (connection classification)

**FIX1 — D2 tight-only connection is MONITORABLE (WAIT), not ESCALATE**
- Contract `recoveryProgression.ts`: added required `failingStateMonitorable: boolean`; new WAIT branch (`failing_state_monitorable`) after REPLAN, before ESCALATE. Precedence now 5 steps. Case stays open; WAIT dispatches nothing.
- Mapper `progressionFacts.ts` + pass `recoveryProgressionPass.ts`: pass derives `failingStateMonitorable = basis.verdict === 'FAIL' && !planningEligible && attempt === undefined` from the deterministic planning-eligibility classification — never a scenario branch. Attempt-exhausted basis stays ESCALATE.
- Unit proof: `test/r1-progression-facts.test.ts` (+5), `test/r1-planning-contracts.test.ts` (+3). PostgreSQL proof: `postgres-integration/r1RecoveryProgression.pgtest.ts` (+3): tight-only FAIL → WAIT/`failing_state_monitorable`, case stays OPEN, `planner.planCase` never called (0 calls), no `recovery_planning_attempts`, no attention; idempotent on duplicate wake; same connection recovering to PASS → RESOLVE; UNKNOWN → ESCALATE (not monitorable). 12/12 pass.

**FIX2 — ONE shared deterministic connection classifier**
- `mapConnectionProgression.ts`: added `classifyAssessmentConnection` — (A) worst-of across ALL failing `connection_feasibility` explanations (not `explanations[0]`, which is content-hash ordered); (B) `separateBlockingFailure` when another applicable+blocking dimension FAILs; (C) `transfer_does_not_fit` reads the evaluator's real `gapMinutes` fact (negative → IMPOSSIBLE, else TIGHT). `productStatus/remainder/semanticState` only go amber when `TIGHT && !separateBlockingFailure`. `recoveryPlanningEligibleFromAssessment` rewritten on the shared helper.
- `pgFactAssembler.ts`: case-level loop, items loop and population loop all consume `classifyAssessmentConnection`; `separateBlockingFailure` threaded into product status/remainder/semantic state and surfaced (internal-only) on `RecoveryCaseFacts`.
- 6 required regression tests + extras in `test/a5-backend-truth-closure.test.ts`: tight-only→amber; broken→red; tight+separate blocking→red; non-blocking separate FAIL stays amber; broken wins regardless of explanation order; reordered explanations identical; `transfer_does_not_fit` negative vs positive vs absent gap. 15/15 pass. PostgreSQL wiring proof in `postgres-integration/r1ConnectionRecovery.pgtest.ts`: real assembled facts carry `separateBlockingFailure=false` + impossible-family progression.

**Gates**: `npm run typecheck` clean; `npm run gate:anti-hardcoding` CLEAN (503 files). Focused pure 91/91; focused PG 15/15 across r1RecoveryProgression, a3JordanConnectionFoundation, m9ConnectionProgression, r1ConnectionRecovery.

## Next action

Dispatch parallel read-only investigations (Qwen seam, hero subject cardinality, clock inventory, preflight inputs); implement FIX1+FIX2 in primary.
