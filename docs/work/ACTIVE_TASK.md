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

CP2 COMPLETE (pushed @ a7d9cb2). CP3 (FIX3 controlled clock) PAUSED at design-frozen, implementation NOT started — per user stop request. The two read-only clock-map investigations are captured below; no CP3 code written yet. Resume by implementing migration 0136 + boot/periodic/drain/coordinator clock injection + harness clock-only-stage advance.

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

## Next action

PAUSED per user stop request after CP2 push. To resume CP3 (FIX3 controlled runtime clock):
1. Add migration 0136: workspace-scoped controlled clock (`mode` WALL|CONTROLLED, `controlled_now` timestamptz), runtime-owned, default WALL.
2. Add a small clock module read by boot; inject as `now` into: `buildReassessmentPipeline` (composeTargetBoot.ts:83), each `createPeriodicService` (runtimeServices.ts:147 default), the drain loop (`options.now`), and the planning coordinator's `deps.now` (composeTargetBoot.ts:235-250 → recoveryPlanningCoordinator.ts:285). Optionally `AppEndpoints.now()` (server/http.ts:194).
3. Make the harness advance the controlled clock for clock-only overnight stages (scripts/a5-founder-qc-progression.ts:214-216/237-241) and re-run reassessment+lifecycle so overnight emerges from timing/boardability — no scenario/route branch.
4. Keep ALL MUST-STAY-WALL sites untouched (inventory above).
5. PG + background-worker proof; typecheck; `npm run gate:anti-hardcoding`; commit+push CP3.
Then CP4 (FIX4 causal Qwen), CP5 (FIX6 preflight + integration + anti-hardcoding + docs), and the 17-item final report.
