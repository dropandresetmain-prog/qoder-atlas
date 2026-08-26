# Final Demo Integration & Code-Freeze Plan

**Status:** Active closure execution SSOT  
**Date:** 27 Aug 2026  
**Branch baseline:** `rescue/final-demo-integration`  
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

**Status:** ACCEPTED on `90d37f7612394fa28272de8289dac3d6e33be96a`

Implemented/proven:

- managed traveller links reach `/traveller?trip=<tripId>` without requiring an active case;
- active recovery cases remain separately discoverable;
- `/demo` exposes S1-S8 diagnostic rehearsals through final acceptance manifests;
- final video flows remain S2 -> S1/S3 -> S7 -> S5;
- S1/S3 continuity and stop-before authority semantics preserved;
- a real HTTP rehearsal launch (`rehearsal-s4`) is integration-tested and returns usable inspect paths;
- local manual clickthrough smoke passed;
- full suite/typecheck/lint/build/anti-hardcoding passed.

**Reviewer:** GPT-5.6 Sol independent integration review.  
**Disposition:** Merge to `main` after this plan/document commit is included and branch is clean.

---

## R2 — Populated Demo World + Eight-Scenario Clickthrough

**Status:** NEXT / ACT NOW

R2 is the functional product gate. It supersedes the earlier narrower idea of merely launching all eight scenarios from `/demo`.

### R2.1 — Freeze scenario entry-state contract

For S1-S8, record:

- scenario/person/programme item represented on Overview;
- authoritative starting state;
- what has already happened before the user clicks;
- what remains for the user/system to do;
- expected click target;
- expected final state;
- reset behavior;
- provenance label(s).

Special rule: S1 -> S3 remains one continuous authoritative story.

Acceptance:

- no contradictory simultaneous states;
- all entry states are compelling and understandable from Overview;
- no generic-logic scenario hardcoding.

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
- R1 human navigation and diagnostic rehearsal wiring pass;
- final product must begin from a populated operational Overview, not a developer launcher;
- final-video hero order remains S2 -> S1 -> S3 -> S7 -> S5;
- S1/S3 continuity is one authoritative story.

### What we do not know

- whether all eight scenario entry states can coexist cleanly in one authoritative seeded world without orchestration conflicts;
- which remaining presentation projections are actually missing once the populated world is rendered;
- whether any scenario exposes a runtime defect only when continued from the pre-staged Overview state.

### Key assumption

The accepted generalized engine can support the populated demo world through demo-only orchestration of normal product/application boundaries without new domain contracts.

### Test next

R2.1: define and verify the eight scenario entry states and the single reset-to-populated-overview contract before parallel implementation begins.
