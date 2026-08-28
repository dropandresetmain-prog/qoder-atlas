# ACTIVE_TASK — Implementation Pass 1/2: product truth, state convergence, recovery lifecycle

## Goal

Make Overview grouping/severity correct, eliminate blank terminal squares, converge
Sarah/Elena after programme recovery, give Jordan a real staged recovery lifecycle
that actually executes, propagate Jonas traveller approval across all surfaces, and
preserve Oliver pending-change semantics. All state derived from authoritative
trip/case state — no local UI memory, no person-specific branches.

## Base / branch

- Base SHA: `cc09ae1` (main, origin/main)
- Branch: `main`
- Production: https://qoder-atlas-production.up.railway.app
- Populated entry: `POPULATED_DEMO_BOOTSTRAP_VERSION = 2026-08-28-jordan-preemptive-entry`
  (Jordan enters at S2 J-03 pre-emptive failure, step `zg053_impossible_retiming`)

## Baseline test run (pre-fix)

26 failing tests at cc09ae1 (full `npm test`), incl. hero e2e (Jordan S2 approval
path, DR-4 recovery loop, browser Overview truth), scenario replays (G1, T-E2E, i5,
R1), presentation units (presentBufferEvidence, r3a x3, case option phase x2,
authority render, case story), Wave 3 Gate 2 / product convergence, DR-5/DR-6/DR-8.

## Issue checklist

### Group A — Overview grouping + state
- [x] A1 Jordan not grouped with Sarah shared airline-change cohort (grouping key = source incident identity, not copy regex) — verify-fixes.mjs: Jordan standalone key `flight|FLIGHT_SCHEDULE_CHANGE|ZG|ZG023|…`, cohort shares MN218 key, 1 group block
- [x] A2 Jordan red / Needs Attention at populated entry — viab=NOT_VIABLE, NEEDS_ATTENTION
- [x] A3 Sarah shared cohort counts correct (4 affected / 3 workable / 1 critical) — verified live
- [ ] A4 No blank mini-chain/state squares; regression tests: Sarah resolved, Elena watching, Jonas resolved, Oliver post-change, unaffected travellers — no blanks observed at entry; regression tests still to add

### Group B — Sarah terminal convergence
- [x] B1 Sarah resolved → green, persists reload — probe-sarah2 + probe-blank: RESOLVED/VIABLE/green, reload stable
- [ ] B2 Elena watching/amber, never red, never disappears — RC-6 fix verified at ENTRY (WATCHING amber); post-Sarah-commit re-verify on new code pending
- [ ] B3 Other shared-cohort travellers semantically correct

### Group C — Jordan recovery lifecycle
- [ ] C1 whatChanged reflects downstream consequence (pre-emptive connection failure)
- [x] C2 affected chain truthful (upstream delay, onward broken, hotel, Finals at-risk until recovered) — verify-jordan.mjs: chain all AT_RISK incl. stay + Finals commitment (RC-3)
- [ ] C3 selected recovery staged in case read-model BEFORE approval — begin stages strategy + false auto-banner removed (RC-4), full path blocked by RC-7
- [ ] C4 Approve → READY_TO_EXECUTE → Execute Recovery works (real internal lifecycle) — BLOCKED by RC-7
- [ ] C5 execution + observation advance → RESOLVED; Finals protected; Overview green; reload persists — BLOCKED by RC-7
- [ ] C6 e2e regression clicking the same path the user does

### Group D — Jonas traveller convergence
- [x] D1 operator case shows waiting-for-traveller — probe-jonas3: data-case-phase + waiting copy
- [x] D2 traveller approve+pay records authority, executes hotel modification — probe-jonas2: APPROVED → executed → case RESOLVED/FULLY_RECOVERED
- [x] D3 Traveller + Case + Overview all resolved/green; reload persists — probe-jonas2/3: dashboard RESOLVED/VIABLE, fleet d-ok, operator phase=resolved (final post-fix-code re-verify pending)
- [ ] D4 navigation/link contract to traveller view from operator case

### Group E — Oliver regression
- [x] E1 substitution target amber before execution; preserved return green/neutral — hero e2e Oliver S7 PASS
- [x] E2 post-execution topology resolves; no blank square — hero e2e Oliver resolved PASS

### Tests
- [ ] Reconcile all 26 failing tests (classify: stale → update / regression → fix / obsolete → rewrite / unrelated → triage)

## Root causes

| ID | Area | Finding |
|----|------|---------|
| RC-1 | Overview grouping | `attentionPanel` (src/ui/screens/operator-dashboard.ts:282) splits rows with regex `/airline changed the flight schedule/i` on copy — grouping by description text, not source-incident identity. Jordan's `whatChanged` matches the copy → wrongly collapsed into Sarah's cohort; shared counts inflated 4→5 / 3→4. Fix: group by a generic incident key derived from the triggering signal. |
| RC-2 | Jordan green at entry | CONFIRMED via SQLite: Jordan `trip.viability = DISRUPTED`, but `deriveRemainderViability` (src/app/readmodels.ts:365) only maps HARD-FAIL→NOT_VIABLE and `AT_RISK`→AT_RISK, ignoring `DISRUPTED` → returns VIABLE → cohort row renders workable/green. Fix: `DISRUPTED → NOT_VIABLE`. |
| RC-3 | Chain truthfulness | CONFIRMED: Jordan case chain at entry = `Flight AT_RISK, Flight AT_RISK, Stay CONFIRMED, Commitment CONFIRMED`. `presentationLinkState` (src/app/chainPresentation.ts) only marks downstream stay/commitment AT_RISK when element is in `affectedElementIds`; it does not propagate `tripNotViable` to downstream stay/commitment. Green ≠ protected. Fix: under `caseOpen && tripNotViable`, downstream stay/recovery-commitment → AT_RISK. |
| RC-4 | Jordan lifecycle/Execute | NOT an engine defect. Full lifecycle works via API and server-rendered phases progress impacted→begin→awaiting_authority→execute→resolved. Defect is a truthfulness bug: the begin panel shows `authority-auto-banner` ("Approved by policy … no extra human approval required") whenever no option pre-flags `requiresApproval`, even though `begin` returns `REQUIRES_HUMAN_AGENT`. Fix: never assert auto-approval before the real authority check runs. |
| RC-5 | Jonas propagation | Backend converges correctly: traveller-decision → case RESOLVED / FULLY_RECOVERED, dashboard RESOLVED/VIABLE, fleet d-ok, operator case phase=resolved. Form wiring (`name=decision value=APPROVED` → `/api/cases/:id/traveller-decision`) is correct and the enhancement script is present. Remaining: verify operator→traveller navigation link contract. |
| RC-7 | Jordan Execute stuck | Root cause of `execute → PLANNING` at the pre-emptive entry. At J-03 the direct failure comes from connection feasibility (ImpactEngine step 1b: retimed LAX→NRT inbound exhausts the NRT buffer → onward leg INVALID). Executing the planned rebook does not clear that direct failure, so `CaseVerifier.verify` keeps returning PLANNING. The engine resolves S2 only once the missed-flight report (`/api/runtime/missed-flight`) has been made — canonical S2 manifest replay reaches RESOLVED/FULLY_RECOVERED that way. The populated demo stops S2 BEFORE that step (`throughStepId: zg053_impossible_retiming`), so the operator-driven pre-emptive path cannot converge. Fix under evaluation: make the pre-emptive rebook produce a connection-feasible itinerary vs run the populated entry through the missed-flight report. NOT fixed yet. |
| RC-6 | Elena disappears | `fleetPresentation`/fleet grid (src/ui/presentationState.ts:96, operator-dashboard.ts:137) force `LOCAL` for any `SELF_OR_OTHER_ARRANGED` traveller regardless of programme impact. Elena (self-arranged, fan-out case, viability UNKNOWN) renders `d-local` instead of WATCHING/amber. Fix: reflect programme-touch (active case / AT_RISK / UNKNOWN) as WATCHING for self-arranged fleet cells. |

Shared-incident identity for RC-1 (from authoritative signals): cohort shares
`kind=FLIGHT_SCHEDULE_CHANGE + carrierCode=MN + flightNumber=MN218 + occurredAt=2026-09-21T09:40+08:00`;
Jordan = `ZG + ZG023 + 2026-09-29T12:00+09:00`. `sourceId` is per-trip (not usable);
the generic key must come from `kind + payload flight identity + occurredAt` (or
`commitmentId` / `changeRequestId` for non-flight kinds).

## Current checkpoint

RC-1/2/3/4/6 fixes implemented, typecheck clean, entry-state evidence captured
(verify-fixes.mjs, verify-jordan.mjs) after demo-server restart + world reset.
Jordan Execute root cause isolated (RC-7); fix not yet applied. Hero e2e ground
truth at fix time: Oliver PASS, Sarah PASS, Jordan FAIL (execute), Overview-group
FAIL (stale 5/4/1 expectation — must become 4/3/1 per RC-1).

## Next action

1. Resolve RC-7 so Jordan's operator-driven path converges to RESOLVED from the
   populated entry (no fake state; real lifecycle).
2. Re-verify Elena WATCHING after Sarah commit on new code; Jonas nav link (D4).
3. Add regression tests: two independent flight incidents don't collapse; square
   mapping (Sarah resolved / Elena watching / Jonas resolved / Oliver / unaffected);
   Jordan lifecycle e2e over the real form path.
4. Reconcile remaining failing tests (hero e2e Overview counts 5/4/1→4/3/1 is a
   stale expectation — update, do not revert RC-1).
5. Full npm test + typecheck + build + anti-hardcoding gate; screenshots; push;
   Railway replay.

## Acceptance evidence

- verify-fixes.mjs (post-fix entry): Jordan NOT_VIABLE + standalone incident key;
  Sarah/Arjun/Siti/MeiLing share MN218 key; shared counts 4/3/1; 1 group block;
  Jordan NEEDS_ATTENTION; Elena WATCHING; fleet tiles populated (no blanks).
- verify-jordan.mjs: Jordan case chain all AT_RISK; auto-approval banner gone;
  begin form staged; phase impacted.
- verify-jordan-s2.mjs: canonical S2 (with missed-flight) → execute → RESOLVED /
  FULLY_RECOVERED, trip VIABLE — engine machinery proven sound.
- Hero e2e partial run: Oliver S7 resolved PASS; Sarah S1→S3 resolved PASS.

## Critical constraints

- No scenario/person-specific branches in domain/recovery/generic UI
- Provider reservation status ≠ trip viability in presentation
- Mocks only at external provider/action boundaries
- No fake timeouts / local UI state to paper over lifecycle
- Green means genuinely protected, not merely CONFIRMED
- UNKNOWN stays UNKNOWN; grey/question only when genuinely unknown
- Do not start Implementation Pass 2 (copy/polish)
