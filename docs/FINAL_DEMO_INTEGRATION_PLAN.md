# Final Demo Integration & Code-Freeze Plan

**Status:** Active closure execution SSOT (R2.1 entry-state contract frozen)  
**Date:** 27 Aug 2026  
**Branch baseline:** `main` @ `e2cd0b1` (includes R1 merge `5f62389` + Railway deployment hardening `2865a66`, `e2cd0b1`)  
**R2 lane branch:** `lane/r2-populated-demo-world`  
**Parent execution SSOT:** `docs/IMPLEMENTATION_PLAN.md`  
**Scope/status SSOT:** `docs/ROADMAP.md`  
**Scenario SSOT:** `docs/SCENARIOS.md`  
**Final demo world/content SSOT:** `docs/FINAL_DEMO_CONTENT_SSOT.md`

This document is the **source of truth for the final integration rescue from accepted backend to filmed/submitted product**. It is subordinate to the parent architecture/product SSOTs and does not reopen accepted architecture, ontology, authority, viability, provider contracts, scenario narratives, or final demo content.

If this document conflicts with earlier assumptions about the final human demo flow, this document governs the remaining integration/rehearsal work unless an explicit supersession is recorded.

## 1. Objective

Finish Northstar as a human-operable, judge-facing product without reopening the generalized recovery engine.

Execution sequence:

`FINAL CONTENT -> UI/BACKEND INTEGRATION -> REHEARSE -> STABILISE -> CODE FREEZE -> VIDEO/SUBMIT`

The current problem is integration and demo operation, not broad backend capability discovery.

## 2. Binding final product/demo state

### 2.1 Default entry experience

The filmed/judge-facing product **does not begin by launching a scenario from a developer/demo control panel**.

The default demo world must open on the **Operator Overview** with the final programme already populated and the scenario situations already in meaningful active states.

From the Overview, a user must be able to:

1. see who is ready, at risk, disrupted, awaiting input/approval, or recovering;
2. identify the people/cases representing the final scenario catalogue;
3. click an affected person/case into the appropriate traveller/case/programme surface;
4. continue that scenario through its remaining decision/action/observation steps to its intended end state;
5. use a clearly available **Reset demo** action;
6. after reset, return to the same populated Operator Overview starting state.

The reset contract is:

`scenario completed/partially explored -> Reset demo -> authoritative reseed -> redirect/return to /operator?event=evt-ait-2026 -> populated starting Overview`

Reset must not require database surgery, process restart, or manual fixture editing.

### 2.2 Scenario entry-state principle

The overview starting state should show the scenarios **already in progress at useful narrative entry points**, not eight artificial completed cases and not eight raw launcher buttons.

Exact entry states are demo-state orchestration/configuration. They must be produced through normal application/product boundaries or demo-only orchestration that drives those boundaries. Do not scenario-branch inside generic domain/engine logic and do not directly mutate SQLite to manufacture the screen.

S1 and S3 are one continuous story on the same trip. Their overview representation may therefore be one active S1 critical case whose clickthrough later enters the S3 programme-counterfactual resolution stage; do not create contradictory simultaneous authoritative states merely to display two labels.

The `/demo` S1-S8 rehearsal catalogue remains an internal diagnostic/rehearsal surface. It is not the intended primary filmed entry point.

## 3. Frozen boundaries

### Do not reopen

- ontology/shared domain contracts
- deterministic viability semantics
- AuthorityEngine semantics
- AI -> validation -> deterministic viability -> authority -> executor -> observe -> state update pattern
- Atlas/Nuitee/provider-neutral architecture
- accepted scenario narratives in `docs/SCENARIOS.md`
- final cast/world content in `docs/FINAL_DEMO_CONTENT_SSOT.md`
- new Stretch/provider integrations unless a proven demo blocker requires one

### Anti-hardcoding

Demo-only orchestration may know scenario IDs, manifest paths, staged entry-step IDs, and final demo fixture identities.

Generic application/domain/engine behavior must never branch on scenario IDs, hero names, fixture IDs, suppliers, or routes.

If a requirement cannot be expressed without generic-logic hardcoding, record an architecture gap instead of implementing the branch.

## 4. Milestones and gates

## R0 — Rescue Contract Freeze

**Status:** COMPLETE

Established:

- rescue is integration closure, not architecture restart;
- final scenario/content SSOTs remain frozen;
- human-operable acceptance replaces route-exists-only acceptance;
- critical path uses Cursor/Qoder-style interactive execution rather than unreliable long-horizon cloud ownership.

**Reviewer:** GPT-5.6 Sol / integration lead.

---

## R1 — Demo Usability Closure

**Status:** FROZEN / MERGED on `main` @ `5f62389237479abfca48b2c14fde338f1ca68969`

Implemented/proven (unchanged from acceptance):

- managed traveller links reach `/traveller?trip=<tripId>` without requiring an active case;
- active recovery cases remain separately discoverable;
- `/demo` exposes S1–S8 diagnostic rehearsals through final acceptance manifests;
- final video flows remain S2 → S1/S3 → S7 → S5;
- S1/S3 continuity and stop-before authority semantics preserved;
- a real HTTP rehearsal launch (`rehearsal-s4`) is integration-tested and returns usable inspect paths;
- local manual clickthrough smoke passed;
- full suite/typecheck/lint/build/anti-hardcoding passed at merge.

**Post-merge deployment hardening (protected — do not regress):**

- `af1605b` — honour Railway `PORT` when `HTTP_PORT` is unset;
- `2865a66` — prefer host `PORT` over `HTTP_PORT` on Railway;
- `e2cd0b1` — bind HTTP server to `0.0.0.0` for Railway proxy.

Production demo entry depends on this binding behaviour. R2 work must preserve it.

**Reviewer:** GPT-5.6 Sol independent integration review — accepted and merged.

---

## R2 — Populated Demo World + Eight-Scenario Clickthrough

**Status:** R2.1 COMPLETE · R2.2 blocked pending explicit acceptance

R2 is the functional product gate. It supersedes the earlier narrower idea of merely launching all eight scenarios from `/demo`.

### R2.1 — Freeze scenario entry-state contract

**Status:** COMPLETE (frozen on `lane/r2-populated-demo-world`)

Authoritative detail: **§9** below. Summary acceptance:

- all eight scenarios have explicit, useful Overview entry points;
- all coexist in one programme without contradictory authoritative state;
- S1 → S3 is one continuous story (single Sarah click path; no parallel S3-only state);
- every prefix uses verified manifest step IDs through normal HTTP/application boundaries;
- no direct SQLite state manufacture;
- reset semantics defined (§9.1);
- provenance claims match manifest boundaries;
- no hidden architecture gap — open items triaged in §9.4.

**Hard stop:** R2.2 must not begin until explicit acceptance: `R2.1 ACCEPTED — CONTINUE`.

### R2.2 — Implement populated overview seed/orchestration

Implement the smallest demo-only/general application orchestration needed so reset/reseed produces the populated starting Overview.

Preferred pattern:

`clean programme seed -> run approved scenario-prefix actions through normal HTTP/application boundaries -> persist resulting authoritative states -> render Overview`

Do not manually patch database rows.

The default `/`/operator demo entry should arrive at the populated programme Overview.

Add a user-visible Reset control that:

- performs deterministic reset/reseed;
- rebuilds the populated overview entry state;
- returns/redirects to the Operator Overview.

The diagnostic `/demo` launcher may continue to exist.

### R2.3 — Eight-scenario operational rehearsal

From the populated starting state, exercise S1-S8 through the user-facing product path.

For every scenario prove:

- the relevant state is visible from Overview;
- the correct person/case/programme item is clickable;
- the click reaches the correct surface;
- blast radius / recovery / decision / uncertainty is understandable;
- required authority interaction can be performed;
- permitted execution/observation works under the declared LIVE/SANDBOX/REPLAY/SIMULATED boundary;
- the scenario reaches its intended end state;
- Reset restores the populated starting Overview.

Record a compact S1-S8 rehearsal matrix with PASS / FIX REQUIRED and issue triage.

### R2 gate

R2 PASSES only when:

- all eight catalogue scenarios have usable entry points from the populated Overview;
- S2/S1/S3/S7/S5 hero flows are fully operable;
- S6/S8 may be less visually polished but must be honest/runnable as claimed;
- reset reliably returns to the populated Overview;
- no Act Now functional blocker remains.

**Primary implementer:** Cursor, substantial integration model (Qwen 3.8 Max xHigh if available; otherwise strongest reliable Cursor implementation model).  
**Reviewer:** GPT-5.6 Sol product/integration gate.  
**No broad independent architecture review.**

---

## R3 — Approved Kimi Product Parity

**Status:** PLANNED; may begin in parallel after R2.1 contract freeze

Goal: make the operational product materially match the approved Kimi screens without redesigning the product.

Priorities:

1. event identity/topbar and demo-world context;
2. Programme role + arrival data;
3. Overview role/company/context and useful journey information;
4. Traveller itinerary, commitment, recovery progress, thread/messages, decision state;
5. case/decision information hierarchy;
6. final spacing/polish only after missing information is wired.

Main theme/design system is already substantially integrated; do not blindly re-port CSS before diagnosing projection/data gaps.

**Lane A — data/projection wiring:** strong integration model.  
**Lane B — visual/presentation polish:** Cursor Composer/strong UI model after data contracts freeze.  
**Review:** human visual acceptance against approved Kimi renders; optional fresh-eye Grok/Kimi critique. No architecture review.

---

## R4 — Hero Rehearsal + Stabilisation

**Status:** PLANNED

Rehearse exact final story:

`S2 -> Reset -> S1 -> S3 (NO RESET between S1 and S3) -> Reset -> S7 -> Reset -> S5`

For each segment freeze:

- starting Overview state;
- click path;
- expected visible state transitions;
- provenance labels;
- human decision/action;
- expected end state;
- reset/fallback procedure.

Then execute stabilisation gates from `docs/IMPLEMENTATION_PLAN.md`:

- deterministic reset/reseed
- restart/persistence check
- relevant/full tests
- typecheck
- lint
- build
- anti-hardcoding
- provider/model degradation paths
- recording/secret sanitation
- deployed smoke
- documentation truth

Only small release-blocker fixes are allowed here.

**Primary implementer:** Cursor with conservative bounded fixes.  
**Final independent release reviewer:** Claude Opus 5 High/Max (or documented strongest independent fallback).  
Final review seeks release blockers, not speculative improvements.

---

## R5 — Freeze + Submission Candidate

**Status:** PLANNED

After Final Candidate Review findings are triaged:

- Act Now -> fix before freeze;
- Investigate Now -> only if potentially demo/release blocking;
- Park for Later -> explicitly record;
- Ignore / Accept Risk -> explicitly record rationale.

Then:

- truth-sync `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, `DEMO.md` and readiness docs;
- leave `SCENARIOS.md` / `FINAL_DEMO_CONTENT_SSOT.md` unchanged unless factually necessary;
- commit/push accepted candidate;
- deploy Railway;
- smoke default populated Overview, one hero clickthrough, and Reset;
- freeze application code;
- switch to video/submission work.

**Blind judge:** GrokBot or another fresh model sees the product/submission with minimal internal implementation context.

## 5. Parallelisation plan

Parallelisation is intentionally delayed until shared demo-state contracts are frozen.

### Before R2.1 completes

**Do not parallelise implementation.**

Reason: populated-overview state, scenario-prefix ownership, reset semantics, and S1/S3 continuity are shared contracts. Parallel work before these are frozen creates collision/rework risk.

**R2.1 is now complete (§9).** Parallel lanes may begin after explicit `R2.1 ACCEPTED — CONTINUE`.

### After R2.1 passes — parallelisation starts

Run two primary lanes:

**Lane A — Functional demo world / clickthrough**
- populated overview orchestration
- reset -> populated overview
- scenario operational paths
- runtime/state fixes

**Lane B — Kimi projection closure**
- read-model/presentation projection gaps whose contracts are now known
- role/arrival/context/itinerary/progress/thread data
- no engine semantics or scenario orchestration changes

A third bounded presentation lane may begin once Lane B freezes its data envelope:

**Lane C — visual polish**
- CSS/layout/copy parity against approved renders
- no domain/application semantics

### Scenario rehearsal parallelism

After the populated-world orchestration is stable, scenario investigation may be partitioned across isolated worktrees/SQLite DBs, for example:

- Lane S-A: S1/S3 + S2 (highest-risk disruption/continuity stories)
- Lane S-B: S4 + S7 (traveller transport changes)
- Lane S-C: S5 + S6 + S8 (stay/preference/co-travel breadth)

Each lane may diagnose and propose bounded fixes. Shared integration decisions and merges remain serialized under the primary integration owner.

Never run parallel scenario agents against one mutable shared SQLite demo database.

## 6. Review ownership

- R0: Sol — complete
- R1: Sol independent integration review — accepted
- R2: Sol product/integration review
- R3: human visual review + optional different-family UI critique
- R4: Claude Opus 5 High/Max Final Candidate Review
- R5: GrokBot/fresh model blind-judge exercise after release acceptance

Reviews are risk gates, not rituals. Do not add broad reviews after every bounded fix.

## 7. Issue triage

Every discovered issue must be classified:

- **Act Now**
- **Investigate Now**
- **Park for Later**
- **Ignore / Accept Risk**

No unclassified review dump is accepted.

## 8. Current decision state

### What we know

- backend semantic acceptance is strong;
- R1 human navigation and diagnostic rehearsal wiring pass and are merged on `main`;
- Railway `PORT` / `0.0.0.0` binding is live and protected;
- final product must begin from a populated operational Overview, not a developer launcher;
- final-video hero order remains S2 → S1 → S3 → S7 → S5;
- S1/S3 continuity is one authoritative story;
- **R2.1 entry-state contract is frozen in §9** — eight scenarios can coexist via ordered prefix orchestration.

### What we do not know

- whether R2.2 prefix orchestration encounters runtime ordering/case-supersession edge cases in practice (see §9.4);
- which remaining presentation projections are actually missing once the populated world is rendered;
- whether any scenario exposes a runtime defect only when continued from the pre-staged Overview state.

### Key assumption

The accepted generalized engine can support the populated demo world through demo-only orchestration of normal product/application boundaries without new domain contracts. Prefix staging uses existing acceptance manifest steps only.

### Test next

R2.2: implement single-reset populated-world orchestration per §9.1–§9.3, then R2.3 operational rehearsal matrix.

---

## 9. R2.1 frozen entry-state contract (S1–S8)

This section is the binding demo-state SSOT for populated Overview orchestration. Scenario narratives remain in `docs/SCENARIOS.md`; cast/content in `docs/FINAL_DEMO_CONTENT_SSOT.md`; executable steps in `fixtures/acceptance/manifests/*.json`.

### 9.1 Global reset and populated-world orchestration

**Judge-facing default entry:** `/operator?event=evt-ait-2026` (not `/demo`).

**Reset demo control (R2.2):** `POST /api/demo/reset` (or equivalent demo-only endpoint) → single authoritative reseed → run §9.3 prefix pipeline → redirect to populated Overview. Must not require DB surgery, process restart, or manual fixture edits.

**Single reset anchor (all scenarios share one clean seed):**

| Field | Value |
|-------|-------|
| Action | `POST /api/runtime/reset` |
| Body `at` | `2026-09-21T09:00:00+08:00` |
| Programme | `fixtures/programmes/ait-summit-2026` via normal seed path |
| Population | 67 participants; 42 managed; final content SSOT |

Individual manifest `reset` steps are **skipped** during populated-world build; only this one reset runs.

**Prefix orchestration pattern:**

`single reset → ordered scenario prefixes (manifest steps only, no per-scenario reset) → persist authoritative state → render Overview`

Demo-only orchestration MAY reference scenario IDs, manifest paths, and step IDs. Generic domain/application/engine code MUST NOT branch on them.

**Canonical prefix order** (minimises cross-scenario interference; R2.2 implements exactly this):

1. **S1** — `s1-airline-schedule-change.json` through `observe_group_a`
2. **S7** — `s7-origin-tokyo.json` through `begin`
3. **S4** — `s4-thursday-morning-arrival.json` through `plan`
4. **S5** — `s5-stay-until-sunday.json` through `begin`
5. **S6** — `s6-switch-hotels.json` through `plan`
6. **S8** — `s8-travel-with-speakers.json` through `observe_case` *(after S1 — shares draft-30 with S1 cohort)*
7. **S2** — `s2-missed-connection.json` through `begin_recovery`

S1 → S3 continuity is **not** pre-staged through S3; the populated world stops at the S1 entry point on Sarah's trip. S3 steps run only after user clickthrough from that state (hero video: no reset between S1 and S3).

**Overview status mix at demo start (intentional diversity):**

| Bucket | Examples |
|--------|----------|
| Ready / on track | Majority Tier B/C managed travellers (baseline viable) |
| Disrupted — awaiting organiser | Jordan Hale (S2), Oliver Bennett (S7) |
| Critical — not viable | Sarah Lim (S1, hand-off to S3) |
| Affected — viable | Arjun Rao, Siti Rahmah (S1 cohort) |
| Preference — planning / blocked | Ethan Yap (S4 infeasible planning), Hannah Weiss (S6) |
| Awaiting traveller | Jonas Berg (S5 self-funded approval) |
| Policy blocked | Mei Ling Goh (S8 concentration violation) |

### 9.2 Per-scenario entry-state table

Columns: Overview-visible starting status uses operator-language intent; authoritative fields come from manifest assertions at the prefix stop point.

#### S2 — Jordan Hale (`ait-draft-09`)

| Field | Contract |
|-------|----------|
| **Scenario** | S2 — missed connection; airline morning recovery inadequate |
| **Traveller** | Jordan Hale · `trv-evt-ait-2026-ait-draft-09` · `trip-trv-evt-ait-2026-ait-draft-09` |
| **Overview-visible status** | Disrupted · recovery proposed · **awaiting organiser approval** |
| **Authoritative state at demo start** | Case `AWAITING_APPROVAL`; best next-morning NRT→SIN strategy staged; trip remainder not yet recovered |
| **Already happened** | Progressive ZG023 delays (`delay_begins_connection_viable` → `zg053_impossible`); traveller missed-connection report; planning ranked TR885-class recovery; `begin_recovery` returned `REQUIRES_HUMAN_AGENT` |
| **Not yet happened** | Organiser approve (`decide_recovery`); execute (`execute_recovery`); trip observation → `VIABLE` / case `RESOLVED` |
| **Click target** | Jordan Hale row → case link / traveller trip |
| **Click surface** | `/operator/cases/{caseId}` or `/traveller?trip=trip-trv-evt-ait-2026-ait-draft-09` |
| **Remaining flow** | Organiser approves → execute → observe resolved overnight flight recovery |
| **Intended final state** | Case `RESOLVED`; trip `remainderViable: VIABLE`; evening finals 20:45 buffer cleared |
| **Provenance** | `SIMULATED_EXTERNAL_EVENT` ingress; Atlas `REPLAY` search/state; organiser authority on `flight.change` |
| **Reset expectation** | Full §9.1 pipeline restores this entry state |

**Prefix manifest:** `fixtures/acceptance/manifests/s2-missed-connection.json`  
**Prefix stop after step:** `begin_recovery`  
**Prefix steps:** `delay_begins_connection_viable`, `delay_increases_connection_at_risk`, `zg053_impossible`, `traveller_report_missed_connection`, `observe_case_after_miss`, `plan_overnight_window`, `begin_recovery`

---

#### S1 (+ S3 continuity) — Sarah Lim (`ait-draft-14`)

| Field | Contract |
|-------|----------|
| **Scenario** | S1 critical schedule change → continuous S3 programme counterfactual (one story) |
| **Traveller** | Sarah Lim · `trv-evt-ait-2026-ait-draft-14` · `trip-trv-evt-ait-2026-ait-draft-14` |
| **Overview-visible status** | **Critical · not viable** for Day-1 headline 09:20 |
| **Authoritative state at demo start** | Trip `remainderViable: NOT_VIABLE`; airline retime ~07:00 applied; open S1 disruption case; headline buffer FAIL (360 min) |
| **Already happened** | Simulated schedule-change ingress on MNSYN14; Wanderpay cohort MNSYN10/11/30 notified (blast radius); Sarah constraint FAIL; cohort afternoon speakers PASS |
| **Not yet happened** | S3 organiser preview (`s3_preview` / `organiser_preview`); commit; fan-out re-plan; Sarah → `VIABLE` |
| **Click target** | Sarah Lim row (critical) → case / traveller trip |
| **Click surface** | Case view → programme change preview for `cmt-ait-d1-headline-interview` |
| **Remaining flow** | Preview RESCHEDULE to 15:30–16:00 → commit → re-plan fan-out case → Sarah viable without new flight |
| **Intended final state (S1+S3)** | Same trip `VIABLE`; programme headline at 15:30; S1-class disruption resolved via programme-side change |
| **Provenance** | `SIMULATED_EXTERNAL_EVENT` + Atlas `REPLAY`; programme preview/commit `REPLAY` |
| **Reset expectation** | Full §9.1 pipeline; **no** S3 prefix pre-staged |

**Supporting Overview faces (same S1 prefix, not separate scenario rows):**

| Traveller | Draft | Overview status | Authoritative |
|-----------|-------|-----------------|---------------|
| Arjun Rao | `ait-draft-10` | Affected · viable | Schedule change applied; `VIABLE` |
| Siti Rahmah | `ait-draft-11` | Affected · viable | Same |
| Mei Ling Goh | `ait-draft-30` | Affected · viable *(S1)* then policy-blocked *(S8 — see below)* | S1 mutation applied; latest active case is S8 if prefix order followed |

**Prefix manifest:** `fixtures/acceptance/manifests/s1-airline-schedule-change.json`  
**Prefix stop after step:** `observe_group_a`  
**Prefix steps:** `notify_group_c`, `notify_group_a_draft10`, `notify_group_a_draft11`, `notify_group_a_draft30`, `observe_group_c`, `observe_group_a`

**S3 continuation steps (post-click, no reset):** from `s1-s3-continuity.json`: `s3_preview`, `observe_mid_preview`, `s3_commit`, `plan_fanout`, `observe_after_s3`

---

#### S3 — (continues S1; not a separate Overview entry)

S3 does **not** appear as a separate authoritative starting state on the Overview. Operators discover it by continuing Sarah's critical case into programme preview/commit. Do not create a simultaneous “S3-only” Sarah state.

---

#### S4 — Ethan Yap (`ait-draft-34`)

| Field | Contract |
|-------|----------|
| **Scenario** | S4 — Thursday-morning arrival preference (pre-booking) |
| **Traveller** | Ethan Yap · `trv-evt-ait-2026-ait-draft-34` · `trip-trv-evt-ait-2026-ait-draft-34` |
| **Overview-visible status** | Soft preference · **planning — no viable option** |
| **Authoritative state at demo start** | Case `PLANNING`; NL intake `ADJUST_TRIP_WINDOW`; all corridor strategies `feasible: false`; no `bestStrategyId` |
| **Already happened** | NL change-request interpreted; funding payer uncertainty recorded; planner searched CNX→SIN REPLAY; hard constraint FAIL on Thursday-morning arrivals |
| **Not yet happened** | Authority/execution (none expected — honest rejection demo) |
| **Click target** | Ethan Yap row |
| **Click surface** | Traveller trip / case — show infeasible strategies and constraint evidence |
| **Remaining flow** | Operator/traveller understands preference cannot be satisfied; case remains open or closes as rejected (product copy — no fake booking) |
| **Intended final state** | Demonstrated rejection with deterministic evidence; trip stays pre-booking / no false execution |
| **Provenance** | NL intake `REPLAY`; Atlas `flight.search` `REPLAY` |
| **Reset expectation** | Full §9.1 pipeline |

**Prefix manifest:** `fixtures/acceptance/manifests/s4-thursday-morning-arrival.json`  
**Prefix stop after step:** `plan`  
**Prefix steps:** `nl_intake`, `plan`

---

#### S5 — Jonas Berg (`ait-draft-35`)

| Field | Contract |
|-------|----------|
| **Scenario** | S5 — stay until Sunday (hotel-only personal extension) |
| **Traveller** | Jonas Berg · `trv-evt-ait-2026-ait-draft-35` · `trip-trv-evt-ait-2026-ait-draft-35` |
| **Overview-visible status** | **Awaiting traveller approval** (self-funded extension) |
| **Authoritative state at demo start** | Case `AWAITING_TRAVELLER`; hotel extension intent staged; `REQUIRES_TRAVELLER`; incremental payer `TRAVELLER` |
| **Already happened** | Structured `CHANGE_STAY` request (checkout 4 Oct); Nuitée `hotel.search` REPLAY; feasible extension strategy ranked; `begin` completed |
| **Not yet happened** | Traveller `decide` APPROVED; `execute`; observe `RESOLVED` / trip `VIABLE` |
| **Click target** | Jonas Berg row |
| **Click surface** | Traveller trip / case — funding split + approval CTA |
| **Remaining flow** | Jonas approves self-funded increment → execute hotel.modify → resolved stay |
| **Intended final state** | Case `RESOLVED`; `resolutionOutcome: FULLY_RECOVERED`; checkout 4 Oct; no organiser approval |
| **Provenance** | Nuitée `REPLAY`; `FUNDED_WINDOW` deterministic allocation |
| **Reset expectation** | Full §9.1 pipeline |

**Prefix manifest:** `fixtures/acceptance/manifests/s5-stay-until-sunday.json`  
**Prefix stop after step:** `begin`  
**Prefix steps:** `change_request`, `plan`, `begin`

---

#### S6 — Hannah Weiss (`ait-draft-31`)

| Field | Contract |
|-------|----------|
| **Scenario** | S6 — switch hotels; partner joining (breadth/stretch) |
| **Traveller** | Hannah Weiss · `trv-evt-ait-2026-ait-draft-31` · `trip-trv-evt-ait-2026-ait-draft-31` |
| **Overview-visible status** | Stay change · **planning with explicit uncertainties** |
| **Authoritative state at demo start** | Case `PLANNING`; replacement stays enumerated from REPLAY; funding allocation UNKNOWN (no temporal anchor); occupancy 2 guests recorded |
| **Already happened** | Structured `CHANGE_STAY` to `place-hotel-harbourline`; `hotel.search` REPLAY; candidate strategies listed |
| **Not yet happened** | `begin`/authority/execute *(not in acceptance manifest — honest planning-only boundary)* |
| **Click target** | Hannah Weiss row |
| **Click surface** | Case — uncertainties, hotel candidates, policy/funding honesty |
| **Remaining flow** | Review planning output; acknowledge stretch boundary (no silent execution claim) |
| **Intended final state** | Honest open planning case; arrival-before-commitment still PASS |
| **Provenance** | Nuitée `REPLAY`; no LIVE execution claimed |
| **Reset expectation** | Full §9.1 pipeline |

**Prefix manifest:** `fixtures/acceptance/manifests/s6-switch-hotels.json`  
**Prefix stop after step:** `plan`  
**Prefix steps:** `change_request`, `plan`

---

#### S7 — Oliver Bennett (`ait-draft-38`)

| Field | Contract |
|-------|----------|
| **Scenario** | S7 — Tokyo origin change (HND) with LHR return retained |
| **Traveller** | Oliver Bennett · `trv-evt-ait-2026-ait-draft-38` · `trip-trv-evt-ait-2026-ait-draft-38` |
| **Overview-visible status** | Structural change · **awaiting organiser approval** |
| **Authoritative state at demo start** | Case `AWAITING_APPROVAL`; HND substitution strategy staged; FX restated USD→SGD on options; `REQUIRES_HUMAN_AGENT` |
| **Already happened** | NL intake `CHANGE_TRANSPORT_SCHEDULE`; HND→SIN REPLAY search; feasible rebook ranked; `begin` completed |
| **Not yet happened** | Organiser `decide` APPROVED; `execute`; case `RESOLVED` |
| **Click target** | Oliver Bennett row |
| **Click surface** | Case — providerCost USD + costDelta SGD + approval |
| **Remaining flow** | Organiser approves → execute flight change → resolved viable trip |
| **Intended final state** | Case `RESOLVED`; HND inbound authoritative; LHR return retained |
| **Provenance** | NL `REPLAY`; Atlas `flight.search` `REPLAY`; FX `REPLAY` |
| **Reset expectation** | Full §9.1 pipeline |

**Prefix manifest:** `fixtures/acceptance/manifests/s7-origin-tokyo.json`  
**Prefix stop after step:** `begin`  
**Prefix steps:** `nl_intake`, `plan`, `begin`

---

#### S8 — Mei Ling Goh (`ait-draft-30`)

| Field | Contract |
|-------|----------|
| **Scenario** | S8 — travel with other speakers (concentration policy) |
| **Traveller** | Mei Ling Goh · `trv-evt-ait-2026-ait-draft-30` · `trip-trv-evt-ait-2026-ait-draft-30` |
| **Overview-visible status** | Preference · **policy blocked — alternative required** |
| **Authoritative state at demo start** | Case `CHANGE_REQUESTED`; TRANSPORT_CONCENTRATION violation (3 critical > limit 2); HIGH severity uncertainty |
| **Already happened** | Structured association request with `trv-…-draft-10`, `trv-…-draft-11`; deterministic policy evaluation at intake |
| **Not yet happened** | Alternative planning/execution *(breadth — case stays open)* |
| **Click target** | Mei Ling Goh row |
| **Click surface** | Case — concentration violation + peer association implications |
| **Remaining flow** | Review policy block; explore alternatives honestly |
| **Intended final state** | Open/blocked case with truthful policy narrative (stretch breadth) |
| **Provenance** | Resolution HTTP `REPLAY`; policy-data-driven concentration rule |
| **Reset expectation** | Full §9.1 pipeline |

**Coexistence note:** S8 prefix runs **after** S1 prefix on the same traveller. Trip carries S1 schedule mutation; **latest** active case surfaces S8 (`latestCaseFor` read model). S1 blast-radius story uses Sarah (`draft-14`) as the critical click target, not Mei Ling.

**Prefix manifest:** `fixtures/acceptance/manifests/s8-travel-with-speakers.json`  
**Prefix stop after step:** `observe_case`  
**Prefix steps:** `change_request`, `observe_case`

---

### 9.3 R2.2 implementation touchpoints (expected files)

| Area | Likely paths |
|------|----------------|
| Demo-world orchestration | `src/app/demoWorld.ts` *(new)*, `src/app/demoOrchestration.ts` *(new)* |
| Reset / demo HTTP | `src/server/http.ts`, demo reset route |
| Composition wiring | `src/app/compose.ts` |
| Default entry | root/`/operator` redirect behaviour |
| Prefix runner reuse | `src/acceptance/runner.ts` or thin wrapper calling existing step executor |
| Tests | `test/integration.r2-populated-world.test.ts` *(new)*, extend `test/integration.r1.test.ts` patterns |

Do **not** modify Lane B presentation projections unless a functional blocker is proven during R2.2 integration.

### 9.4 Architecture gaps and issue triage (R2.1)

| ID | Finding | Classification | Notes / R2.2 action |
|----|---------|----------------|---------------------|
| G1 | No populated-world orchestration exists yet | **Act Now** (R2.2) | Expected; implement §9.1–§9.3 |
| G2 | S1 manifest notes CGK target vs current KUL/MN seed (`s1-airline-schedule-change.json` boundaries) | **Investigate Now** | Prefix must use same seed as acceptance proofs; verify programme PNR MNSYN* resolves at runtime before R2 gate |
| G3 | `latestCaseFor` exposes one active case per trip — S8 after S1 on draft-30 hides S1 case on that trip | **Accept Risk** | By design: Sarah is S1 critical click target; Mei Ling is S8 entry |
| G4 | S6 manifest stops at planning — no execute path | **Accept Risk** | Stretch scenario; honest planning-only demo |
| G5 | S2 closed path does not compose transit-hotel / JP entry / insurance | **Accept Risk** | Already in content SSOT §11; do not claim in UI |
| G6 | Prefix order sensitivity untested in one shared DB | **Investigate Now** | R2.2 must add integration test proving §9.1 order is repeatable |
| G7 | `/demo` diagnostic launcher coexists with new default entry | **Park for Later** | Keep both; document operator vs developer paths |
