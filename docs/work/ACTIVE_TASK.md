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
- [x] CP3 FIX3 controlled runtime clock — background-worker/progression proof — push
- [x] CP4 FIX4 causal Qwen planning seam — safety + causal acceptance proof — push
- [x] CP5 FIX6 demo preflight + integration + anti-hardcoding + docs — push
- [x] INV5 multi-subject progression — **Park for Later** (production cases single-subject; settledBasis untouched)

## Current checkpoint

CP5 COMPLETE — demo readiness preflight (fail-closed, read-only) + evidence. Backend closure candidate ready for integration review. Do NOT claim A5.1/A5.2/A5 complete.

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

### FIX3 — clock (CONFIRMED via two read-only agents; NO code yet)

**Decisive facts:**
- Most passes ALREADY take `ctx.now ?? new Date().toISOString()`, so they are downstream of the periodic-service clock: caseEscalation.ts:111, recoveryProgressionPass.ts:275, caseResolutionPass.ts:45, recoveryApproval.ts:301, recoveryPlanning.ts:116, executionPass.ts:99, externalOfferExecution.ts:532, externalStayExecution.ts:766.
- The drain loop ALREADY has `options.now?: () => Instant` (pgAssessments.ts:556/586). `enqueueDueReassessments(pool, now)` (CLOCK_EXPIRY) makes time-alone able to stale+reassess — so advancing a clock alone CAN drive reassessment.
- TWO boot seams are hardcoded wall and must become clock-driven:
  1. `composeTargetBoot.ts:83` `buildReassessmentPipeline` → `new Date().toISOString()` feeds captureWorld({at}) + assessSubject({now}).
  2. coordinator composed WITHOUT `now` (composeTargetBoot.ts:235-250); `planCaseDetailed` uses `input.now ?? deps.now ?? wall` (recoveryPlanningCoordinator.ts:285). Boot must supply `deps.now` from the controlled clock.
- `createPeriodicService` clock = `options.now?.() ?? new Date()` (runtimeServices.ts:147) — supply `now` to caseLifecycle/execution/externalExecution.
- `AppEndpoints.now()` (server/http.ts:194) is the HTTP clock seam; currently wall-only.
- `RecoveryPlanningInput.now` exists (recoveryPlanningAttempt.ts:306-313) but is NOT wired from any demo endpoint/harness.

**Harness gap (the actual FIX3 defect):** clock-only "overnight" stages are INERT.
- Stage timings are DATA-DRIVEN: `data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json` (each stage has `id`, `at`, and clock-only stages have `planningNow` + no `eventId`). No scenario branch in app logic (anti-hardcoding OK).
- `scripts/a5-founder-qc-progression.ts`: provider-event stages flow `stage.at` end-to-end (ingress receivedAt → captureWorld at → assessSubject now → drainAvailable now → runCaseEscalation now). But clock-only stages are PRINTED and REFUSED (lines 214-216, 237-241): "Set the synthetic planning clock / run planning against this stage manually; this harness does not fake wall-clock." So advancing time alone (no world change) does nothing today.
- No HTTP endpoint sets/advances demo time.

**MUST-STAY-WALL (never controlled):** all provider observedAt/requestedAt (atlas/*, hotel/nuiteeAdapter, targetTransportResearch:110, targetHotelResearch, targetFxResearch, providers/research/*), `modelActivities[].observedAt` (recoveryPlanningCoordinator:416), read-model generatedAt/isoNow (pgFactAssembler:54, pgShellFacts:34/381/461), command receipt timestamps (committedAt/openedAt/closedAt/resolvedAt/issuedAt/acceptedAt across commands/*, commandSupport:191, mutation.ts:251), completionClock (recoveryPlanningCoordinator:310/495), boot provisionWorkspaceAuthority now (composeTargetBoot:170), drain elapsed/budget Date.now() (pgAssessments:478/487/496/527), externalOfferExecution hold-expiry (337). Full 110-site inventory captured this session (28 controlled-candidate, 82 must-stay-wall).

**Design direction (frozen, not yet implemented):** ONE authoritative runtime-owned evaluation clock. Default = wall clock. A workspace-scoped controlled clock (new migration 0136, WALL|CONTROLLED + controlled_now) read by boot and injected as `now` into: buildReassessmentPipeline, all createPeriodicService passes, the drain loop, and the planning coordinator's `deps.now`. Harness advances the controlled clock (incl. clock-only overnight stages) and re-runs the lifecycle/reassessment passes so overnight emerges from timing/boardability/availability — no "if Jordan"/"force overnight"/route-specific/hardcoded path. MUST-STAY-WALL sites untouched.

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

### CP3 — FIX3 controlled evaluation clock (IMPLEMENTED)

**Design implemented as frozen:**
- Migration `0136_workspace_evaluation_clocks.sql`: workspace-scoped `mode` WALL|CONTROLLED + `controlled_now`, default WALL, constraint requires controlled_now when CONTROLLED.
- Module `src/app/target/evaluationClock.ts`: resolve/read/write + `createWorkspaceEvaluationClock` (durable + cached sync `now()`); `resolveCoordinatorNow` accepts Instant or live getter.
- Boot (`composeTargetBoot.ts`): creates one clock; injects `evaluationNow` into reassessment pipeline, reassessment drain service, caseLifecycle/execution/externalExecution periodic services, and planning coordinator `deps.now`.
- Coordinator: `deps.now` may be Instant | (() => Instant); `completionClock` remains wall-owned.
- Harness (`scripts/a5-founder-qc-progression.ts`): clock-only stages advance CONTROLLED clock + `enqueueDue` + drain + escalation (no refuse); provider-event stages also align the workspace clock to stage.at. Data-driven (`planningNow` / no `eventId`); no traveller/route branches.

**MUST-STAY-WALL preserved:** provider observedAt, modelActivities.observedAt, completionClock, read-model generatedAt, command receipts — untouched. PG test asserts completionClock-style stamp ≠ evaluation now under CONTROLLED.

**Evidence:**
- Pure: `test/a5-evaluation-clock.test.ts` 4/4 + `test/a5-founder-qc-progression.test.ts` 2/2 (overnight harness-driven).
- PG: `postgres-integration/a5EvaluationClock.pgtest.ts` 4/4 — WALL default, CONTROLLED durable across reloads, periodic wakes see D1→D2→D3→overnight controlled times, wall operational stamp independent.
- `npm run typecheck` clean.
- Suites classified in `test/suites.json` (CURRENT_TARGET + POSTGRES).

### CP4 — FIX4 causal Qwen TRANSPORT offer selection (IMPLEMENTED)

**Before:** Qwen `recovery.domain_suggestion` ran after deterministic registry already INVESTIGATED every registered domain → AI suggestions filtered against `already` → causally inert activity/provenance only.

**After:** Bounded StrategyProposer/DomainStrategyProposer seam — `recovery.offer_selection` prefers real boardable researched offer keys within the existing corridor cap. Deterministic ranking remains fallback. RC-6 / comparator / authority / execution untouched.

**Design:**
- Pure `applyPreferredOfferSelection` + `correlatedTransportOffers` optional preferred keys (proposer + materialize share the same selection).
- `planningOfferSelection.ts`: schema-validated model call; sanitize drops unknown requestIds/keys; fail-closed empty preference on INVALID_OUTPUT / FAILED.
- Coordinator: after TRANSPORT research, materializeWorldForDomain (now awaitable) calls offer selection once, records model activity, late-binds preference into transport proposer + hotel companion via getter.
- Schema: `PlanningModelActivity` / view operation union includes `recovery.offer_selection`.

**Evidence:**
- `test/a5-offer-selection.test.ts` 5/5 — causal reorder within cap; sanitize fail-closed; schema accepts offer_selection; INVALID_OUTPUT empty preference; unsupported effect fields rejected.
- Adjacent: `test/r1-transport-proposer.test.ts` + `test/r1-evidence-seam.test.ts` 9/9.
- `npm run typecheck` clean.

### CP5 — FIX6 demo readiness preflight (IMPLEMENTED)

**Design:** read-only `runDemoReadinessPreflight` + CLI `scripts/a5-demo-readiness-preflight.ts`. Fail-closed on required checks; advisory gaps never alone flip `ok`. No provisioning, authority bypass, quote refresh, or destructive booking.

**Checks (representative):** postgres workspace; dataset marker; travellers/journeys + multi-traveller coexistence; optional required name tokens (caller-supplied — no hero hardcoding); evaluation clock mode; Qwen configured/mode/model; Atlas planning mode + protected execution compose; Nuitée/stay compose; booking identities + execution bindings; budgets; authority authorize/dispatch; quote freshness posture; displaced stay baseline; overnight research config.

**Evidence:**
- Pure: `test/a5-demo-readiness-preflight.test.ts` 1/1.
- PG: `postgres-integration/a5DemoReadinessPreflight.pgtest.ts` 3/3 — missing workspace fail-closed; empty workspace fails coexistence; CONTROLLED clock reported; name tokens fail closed.
- Adjacent FIX1/FIX2 regressions still green (31/31).
- `npm run typecheck` clean; `npm run gate:anti-hardcoding` CLEAN (506 files).

**Integration note:** Full Sarah/Jordan founder-QC live rehearsal against a provisioned demo workspace is the next operator step (preflight CLI with `--require-name` tokens + progression harness). Backend proofs for D2 WAIT, connection classification, controlled clock, and causal offer selection are already on this branch.

## Next action

Integration review / UI substrate handoff. Operator: run `scripts/a5-demo-readiness-preflight.ts` against the demo workspace, then progression harness through overnight. Do not claim A5.1/A5.2/A5 complete.
