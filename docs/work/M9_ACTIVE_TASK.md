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
- [ ] 3. Jordan target PG E2E (progressive connection state, TR867/TR885 via
  evaluator, coordinated multi-action plan, partial-failure proof) — not yet
  attempted. Not architecturally blocked (Jordan's actions are on
  independent aggregates/capabilities, matching the already-accepted
  "acceptance #5" multi-intent DAG pattern), purely a time/effort gap.

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

## Next action

1. Decide (outside M9 scope) how to close the same-Programme dual-execution
   gap above — likely an M7/M8 milestone item, not M9.
2. Build the Sarah target PG E2E test up through real ingress -> 5-person M6
   evaluation -> real strategy -> real server-side preview -> real authority
   for both intents -> execute side A for real -> (blocked at side B per the
   finding above) -> stop short of claiming full resolution until the gap is
   fixed upstream.
3. Build the Jordan target PG E2E test (not blocked; same multi-intent DAG
   pattern as accepted "acceptance #5" — onward flight / Narita overnight /
   Singapore stay / displaced cancellation / ground transfer, each on its own
   aggregate/capability).
4. Independent C4 review on the resulting SHA. Do not claim C4 PASS. Do not
   start M10.

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
