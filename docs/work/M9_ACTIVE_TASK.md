# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and Sarah + Jordan fixture-backed acceptance for C4 candidate.

## Accepted base

- C3: `integration/m7-m8-c3` @ `f8103379ed2426d442d342895e9e1d1573f875da`
- Pre-integration M9 C4-candidate: `6e6dbfdb32b02dd248b96f2ac9119907e395db48`
- Seed lane integrated: `lane/wit-demo-programme-seed` @ `2a14c515839c3764cead2782d6000c8066c36dd1`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**C4 FAILED (68521d0) — TARGETED REMEDIATION IN PROGRESS.** An independent
review of `68521d0` returned RETURN M9 FOR TARGETED FIXES: the Sarah/Jordan
proofs mostly demonstrated behaviour on the legacy SQLite runtime, and the
target PostgreSQL app did not yet compose/execute the required path
end-to-end. See `docs/refactor/evidence/M9.md` "C4 remediation" section for
the itemised fix list, what has actually landed against real PostgreSQL, and
the one confirmed architectural finding that blocks full completion of the
Sarah bilateral-swap item. Do not claim C4 PASS from this file.

## Provenance (demo truth)

| Corridor | Provenance |
|---|---|
| Sarah Batik ID7159→ID7153 | **ORGANISER_SUPPLIED_SYNTHETIC** + **SIMULATED_EXTERNAL_EVENT** — not Atlas-backed. Simulated `flight_state_query` REPLAY at provider boundary for CONNECTED reconciliation only. |
| Jordan ZG023/ZG053 + TR885 | **Atlas REPLAY** (committed recordings) |
| Jordan Concorde / Narita hotels | **Nuitée sandbox RECORD** artifacts |
| Ground transfer | Scenario/simulated provider-boundary data |
| Fable | **Deferred polish** — not an M9 functional blocker |

## Checklist (pre-C4, legacy/demo evidence — compatibility only, not C4 proof)

- [x] CK1 + CK2 generic
- [x] Merge complete seed tip (not cherry-pick)
- [x] Sarah S1 fixture acceptance (legacy SQLite runtime)
- [x] Sarah S1→S3 continuity (legacy SQLite runtime, programme recovery)
- [x] Jordan S2 fixture acceptance (legacy SQLite runtime)
- [x] Jordan Concorde partial-failure fixture acceptance (legacy SQLite runtime)
- [ ] Fable visual polish (deferred)

## C4 remediation checklist (this pass)

- [x] 1A. Real target ingress: `acceptProviderShapedDemoEvent` now invokes the
  real signal path (`recordTransportObservation` canonical mutation ->
  accepted M6 invalidation -> durable reassessment). Proof:
  `postgres-integration/m9DemoIngress.pgtest.ts`.
- [x] 1B. Real server-side programme-swap preview: `POST
  /api/v2/programme/time-swap/preview` no longer accepts a caller-supplied
  `evaluate`; the server loads PostgreSQL state, builds the real M7 overlay,
  and invokes the real M6 registry. Proof:
  `postgres-integration/m9AuthoritativePreview.pgtest.ts`.
- [x] 5. ISSUER-POL (bounded): normal grant issuance requires the issuer to
  already hold `authority.grant.write` covering the issued scopes; no
  self-issuance; `provisionOrganiserAuthority` is the sole bootstrap
  exemption via a dedicated system principal, unreachable from HTTP. Proof:
  `postgres-integration/m9Checkpoint1.pgtest.ts` ("M9 R-10 practical grant
  issuance" / "ISSUER-POL" describe blocks).
- [x] 6. Resolution rule I1: a case with an ActionPlan containing an action
  intent that has not reached an observed-success execution outcome cannot
  resolve on assessments alone (new `ACTION_INTENT_NOT_COMPLETE` denial);
  passive resolution (no consequential strategy/action) unaffected. Proof:
  `postgres-integration/m9Checkpoint1.pgtest.ts` ("M9 I1" describe block).
- [x] 4. Read-model currentness + observation projection:
  `loadRecoveryCaseFacts` now derives whole-trip viability per subject via
  `currentAssessmentView` (never "latest N rows across every subject"), and
  `loadRecoveryActionFacts` derives the real recorded outcome
  (CONFIRMED/CANCELLED/FAILED/OUTCOME_UNKNOWN) from `execution_attempts.status`
  instead of mapping every observation row to CONFIRMED. Proof:
  `postgres-integration/m9ReadModelCurrentness.pgtest.ts`.
- [x] 7 (partial). `test/m9-jordan-s2-compatibility.test.ts` PENDING->LANDED
  fixed; this file's target/legacy distinction rewritten below.
- [ ] 2A/2B/2C. Sarah target PG E2E (5 real evaluations, real bilateral swap
  execution, real authority/execution/observation, no fake assessments) —
  **item 2B (execute BOTH sides of the swap as real ActionIntents) is
  BLOCKED by a confirmed architectural gap**, see "Confirmed architectural
  finding" below. The rest of item 2 (ingress -> 5-person M6 evaluation ->
  real strategy -> real preview -> real authority -> resolution) is not yet
  built as a single E2E test, though every individual seam it depends on is
  now proven working in isolation (see proofs above + accepted M7/M8
  integration tests).
- [x] 3A. Progressive connection state derived from the real M6 evaluator
  (`connection` dimension via `createM6Registry()`), not a caller-supplied
  hint: 160/85min -> SAFE, 30min -> AT_RISK, -65min -> IMPOSSIBLE, against a
  real registered `minimum_connection_minutes` constraint. Proof:
  `postgres-integration/m9ConnectionProgression.pgtest.ts`.
- [x] 3B. TR867 vs TR885 onward-flight viability proven with the real M7
  evaluator (`evaluateRecoveryStrategy` -> `createM6Registry()` ->
  `participationEvaluator`'s readiness check), not fixture inventory
  presence: TR867 (0 available min vs 150 required) -> NOT_VIABLE; TR885
  (~370 available min) -> VIABLE. Proof:
  `postgres-integration/m9TR867TR885Viability.pgtest.ts` (commit `bf8c68a`
  — check exact filename in that commit if renamed).
- [ ] 3C/3D. Coordinated multi-action plan (onward flight / Narita overnight
  / Singapore stay replacement / displaced cancellation / ground transfer,
  with the displaced cancellation dependency-gated on the replacement's
  observed success) + partial-failure proof (replacement CONFIRMED,
  cancellation OBSERVED_FAILURE -> `duplicateBookingExposure`/
  `partialRecovery`/`remainingRecoveryWork` non-empty, case unresolved ->
  retry CANCELLED -> reassess -> resolves, Narita untouched throughout).
  **DRAFTED BUT NOT YET RUN, DEBUGGED, OR COMMITTED** — the implementing
  agent was stopped (by the human, mid-task, not a crash) right after
  writing it. File exists at
  `postgres-integration/m9JordanMultiActionRecovery.pgtest.ts` (untracked in
  git) but has never been executed against real PostgreSQL. Treat every
  assertion in it as unverified until it's actually run once — it may not
  even compile/pass on the first attempt. This is the single highest-value
  next step: get this file green, then commit it.

## Confirmed architectural finding (STOP condition, not improvised around)

**A genuine two-sided programme-item swap cannot complete both sides as real
ActionIntents through the accepted M7 (`compiler.ts`) -> M8
(`internalProgrammeExecutor.ts`) internal-execution pipeline when both items
belong to the same Programme aggregate.**

Empirically confirmed in
`postgres-integration/m9BilateralSwapArchitectureFinding.pgtest.ts`:
1. A real M6/M7-evaluated bilateral `ScenarioChange` (two
   `CHANGE_PROGRAMME_ITEM_TIME` effects) compiles to two real ActionIntents;
   both persist and get real authority (grant/decision/approval).
2. Side A executes for real (real M4 mutation, real
   `execution_attempts`/`execution_observations`, OBSERVED_SUCCESS).
3. Side B is then correctly refused `STALE_BASE` — side A's own execution
   advanced the shared PROGRAMME aggregate the ONE strategy's base manifest
   read. This part of the execution gate is working exactly as designed.
4. The accepted IN-1 re-plan mechanism (fresh capture, strategy v2, same
   effect-scoped logical operation key) correctly clears `STALE_BASE` and
   authority for side B.
5. Side B's execution **still fails**, now at the real M4 CAS
   (`STALE_AGGREGATE_REVISION`), because `compiler.ts`'s
   `CHANGE_PROGRAMME_ITEM_TIME` case never stores an `expectedRevisions`
   entry for the PROGRAMME aggregate (unlike its own
   `CHANGE_SUPPORT_ASSIGNMENT` case, which does), so
   `internalProgrammeExecutor.ts`'s `loadStoredProgrammeSchedule` always
   falls back to a hardcoded `expectedProgrammeRevision: 1` — stale for any
   second internal schedule mutation to the same Programme, no matter how
   many times the strategy is re-evaluated or re-planned.

A fix requires one of: a frozen v2 `ScenarioEffect` contract change
(`scenarioChange.ts`), a `compileActionPlan` signature change (it does not
currently receive the base world needed to read a real revision), or
relaxing the M8 execution gate's currentness semantics. All three are M7/M8
contract changes, explicitly out of scope for M9 integration work ("do not
rewrite M6/M7/M8"). Recorded here rather than routed around (e.g. by calling
`updateProgrammeItemSchedule` directly outside the ActionIntent/execution
layer for the second side — exactly the "move Sarah only" shortcut C4
already rejected once).

## Next action — HANDOFF (stopped by human 2026-09-16, not blocked/crashed)

Work was paused deliberately (human said "stop, hand off") with local HEAD at
`bf8c68a`, 6 commits ahead of `origin/milestone-m9-product-integration`
(still at the original C4-failed `68521d0` — nothing has been pushed; do not
push without asking first). One untracked, unrun file sits on top of that:
`postgres-integration/m9JordanMultiActionRecovery.pgtest.ts` (item 3C/3D
draft — see checklist above). Working tree is otherwise clean.

Resume in this order:

1. `cd C:/Dev/qoder-atlas-m9`, confirm `git log -1` is `bf8c68a` and the
   untracked 3C/3D file is still there (`git status --short`).
2. Get `m9JordanMultiActionRecovery.pgtest.ts` running against real Postgres
   (`node --test postgres-integration/m9JordanMultiActionRecovery.pgtest.ts`
   or however this repo's pgtest runner is invoked — check `package.json`).
   Debug/fix until it genuinely passes (it has never been run once — treat
   it as a first draft, not working code). Commit once green (`fix(m9): 3C/3D ...`).
3. Build the rest of item 2 (Sarah target PG E2E: real ingress -> 5-person
   M6 evaluation incl. Felix -> real strategy -> real server-side preview
   (Sarah+Daniel+Elena) -> real authority -> execute side A for real ->
   **stop at the documented 2B blocker** (do not route around it) -> assert
   no flight-purchase ActionIntent exists). Every individual seam this needs
   is already proven in isolation (1A/1B/4/5/6 proofs above) — this step is
   wiring them into one E2E, not inventing new mechanism.
4. Decide (outside M9 scope) how/whether to close the same-Programme
   dual-execution gap (`SAME-PROGRAMME-DUAL-EXECUTION` in triage below) —
   likely an M7/M8 milestone item. This may be a genuine blocker to ever
   claiming full C4 PASS on the Sarah bilateral-swap requirement as
   originally specified; surface that tension to whoever owns the C4
   decision rather than silently declaring partial success sufficient.
5. Only once 2 and 3 are both as complete as they can honestly be: run the
   ONE full final verification pass — `npm run test:postgres`,
   `npm run typecheck`, `npm run build`, `npm run lint`,
   `npm run gate:anti-hardcoding`, `git diff --check`, plus legacy/demo
   coherence tests for backward-compat. Do not run the full suite as an
   inner loop before that — focused pgtest files only, it's expensive.
6. Independent C4 review on the resulting SHA. Do not claim C4 PASS
   yourself. Do not start M10. Do not push without explicit confirmation.

## Issue triage

| ID | Class | Notes |
|---|---|---|
| FABLE-POLISH | Park for Later | Visual refinement only |
| ORG-INHERIT | Park for Later | Exact grant match only |
| ISSUER-POL | Done (bounded) | `grantIssuance.ts` now enforces issuer authority; bootstrap exemption isolated and HTTP-unreachable |
| LEGACY-R1-WALLCLOCK | Ignore / Accept Risk | Pre-existing on C3; confirmed still present, unrelated to this remediation pass |
| SAME-PROGRAMME-DUAL-EXECUTION | Blocked (M7/M8 contract change needed) | See "Confirmed architectural finding" above |
| WAVE3R-AIT-HARVESTED-PNR | Investigate (pre-existing, unrelated) | `test/wave3r-m1-ait-canonical-seed.test.ts` fails on unmodified `68521d0` too — not introduced by this pass |
| OPTION_SET→RESCHEDULED | Done | Seed manifests aligned to API enum |
| IDSYN flight_state REPLAY | Done | Simulated CONNECTED recordings for Batik PNRs |
