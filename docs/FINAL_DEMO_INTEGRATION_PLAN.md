# Final Demo Integration & Code-Freeze Plan

**Status:** Active closure execution SSOT — R3 reopened for recovered-UI direction + final live product acceptance  
**Date:** 27 Aug 2026  
**Current product line:** `main` contains the integrated R2/R3 candidate (`a151792`), live-product operability closure (`9700edd`), and Railway early-bind health hardening (`7a168ead`). Later docs-only commits do not redefine the product candidate.  
**Parent execution SSOT:** `docs/IMPLEMENTATION_PLAN.md`  
**Parent demo-readiness contract:** `docs/WAVE3R_DEMO_READINESS_PLAN.md`  
**Scope/status SSOT:** `docs/ROADMAP.md`  
**Scenario SSOT:** `docs/SCENARIOS.md`  
**Final demo world/content SSOT:** `docs/FINAL_DEMO_CONTENT_SSOT.md`  
**Design charter:** `docs/DESIGN.md`  
**Historical closure evidence:** `docs/archive/FINAL_DEMO_INTEGRATION_PLAN_PRE_R3C.md`

This document is the active **remaining recovery / demo-closure sequence**. It is subordinate to the parent implementation, architecture, product, scenario, and roadmap SSOTs. It does not reopen accepted ontology, deterministic viability, authority, provider-neutral architecture, scenario narratives, or demo-world facts.

If an older closure plan, handoff, screenshot proxy, or generated preview conflicts with this document's remaining execution order, this document governs the recovery sequence. Facts and semantics still come from their dedicated SSOTs above.

---

## 1. Objective and remaining runway

Finish Northstar as a human-operable, judge-facing product; freeze a reliable release candidate; then stop software development and switch to submission production.

Current remaining sequence:

`R3C RECOVERED UI AUDIT + HUMAN DIRECTION FREEZE`
`→ R3D LIVE PRODUCT CONVERGENCE`
`→ R3E FINAL UI PASS + HUMAN PRODUCTION ACCEPTANCE`
`→ R4 HERO REHEARSAL + WAVE 4 STABILISATION`
`→ FINAL CANDIDATE REVIEW`
`→ R5 FINDINGS CLOSURE + CODE FREEZE`
`→ SUBMISSION PRODUCTION`
`→ SUBMIT`

No Stretch pull is planned from this point. Reopen Stretch only for a demonstrated release blocker that cannot be solved inside the accepted generalized product.

---

## 2. Binding final product/demo state

The judge-facing product begins on the populated **Operator Overview**, not `/demo`.

Canonical programme truth:

- **67 participants total**;
- **42 Northstar-managed travellers**;
- **25 local/self/unmanaged participants**.

The product must make that split understandable without implying all 67 have managed travel.

From the Overview a human must be able to:

1. understand who is confirmed, watching, disrupted, recovering, awaiting input/approval, unconfirmed, or local;
2. identify affected people/cases;
3. click into the relevant operator Case as the primary operator workflow;
4. reach Traveller interaction as a secondary surface;
5. continue a scenario using visible product controls to an explicit terminal result;
6. reset the demo and return to the same populated starting Overview.

Reset contract:

`scenario explored/completed -> Reset demo -> authoritative reseed -> populated Operator Overview`

No database surgery, process restart, hidden manual fixture edit, or `/demo` launcher is permitted as the judge-facing completion path.

### Hero sequence

Final filmed/rehearsed order remains:

`S2 -> Reset -> S1 -> S3 (NO RESET between S1 and S3) -> Reset -> S7 -> Reset -> S5`

S1 and S3 remain one continuous Sarah story.

### Scenario terminal-state rule

For human operability, a scenario is complete only when the visible product reaches one of:

- recovered;
- recovered with loss; or
- explicitly escalated / handed to human support.

A hidden backend manifest completion or an unexplained open planning state is not sufficient human acceptance.

---

## 3. Frozen boundaries

Do not reopen without a proven architecture gap:

- ontology/shared domain contracts;
- deterministic viability semantics;
- AuthorityEngine semantics;
- `AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`;
- Atlas/Nuitee/provider-neutral architecture;
- accepted scenario narratives in `docs/SCENARIOS.md`;
- final cast/world facts in `docs/FINAL_DEMO_CONTENT_SSOT.md`;
- new providers or scenario families.

Demo-only orchestration may know scenario IDs/manifests/fixture identities. Generic application/domain/engine logic must not branch on hero names, scenario IDs, suppliers, routes, dates, or fixture IDs.

---

## 4. Accepted history before current recovery

### R0 — Rescue Contract Freeze
**Status:** COMPLETE.

### R1 — Demo Usability Closure
**Status:** ACCEPTED / MERGED.

Navigation and diagnostic rehearsal wiring were restored; Railway `PORT` / `0.0.0.0` behavior is protected.

### R2 — Populated Demo World + Eight-Scenario Functional Coverage
**Status:** ACCEPTED.

Final R2 evidence includes populated-world orchestration and S1–S8 rehearsal through the shared engine. Detailed entry-state contracts and prior R2 evidence are preserved in `docs/archive/FINAL_DEMO_INTEGRATION_PLAN_PRE_R3C.md`.

### R3A — Projection/Data Closure
**Status:** COMPLETE / INTEGRATED.

Final projection closure `1605665` covers operator/programme/traveller/case/decisions/activity presentation data and FX-safe cost presentation.

### Prior R3B visual pass
**Status:** INVALID AS FINAL VISUAL ACCEPTANCE.

The original approved render screenshots were lost during pruning. Later visual agents relied on generated proxies / stale render evidence, so their self-reported parity is not authoritative.

### Live-product operability closure
**Status:** IMPLEMENTED CANDIDATE on `9700edd`, not final human UI acceptance.

The live-product closure added/strengthened human S1–S8 terminal paths, Overview scale/fleet contracts, case actions, programme-change/escalation paths, Decisions/Activity consistency, and browser rehearsal. Railway early-bind health hardening followed at `7a168ead`.

Do not redo this backend/application work without evidence of a remaining functional defect.

---

# R3C — Recovered UI Audit + Human Visual Direction Freeze

**Status:** NEXT / ACT NOW.

**Purpose:** determine how materially the recovered design differs from the current product, show the human owner representative side-by-side evidence, and freeze the visual direction **before** another implementation pass.

This is an evidence/design-direction stage, not a product-code stage.

## R3C.1 Recovered UI candidate pack

A recovered candidate set currently exists locally under:

`docs/recovered_ui/`

Reported contents:

- 23 static HTML screens;
- `renders.css`;
- `UI_IMPLEMENTATION_PLAN_HANDOFF.md`;
- an AI-generated replacement `assets/sg-dusk.png` because the original hero asset was lost.

The recovered HTML/CSS is the closest surviving expression of the desired UI, but it is **not yet factual/product SSOT**. Static names/counts/times/content inside those HTML files are illustrative. Runtime facts come from application read models and the content/scenario SSOTs.

**First action:** preserve/commit the recovered pack before more pruning. The generated `sg-dusk.png` must be clearly labelled as a replacement, not recovered original material.

Do not use `data/ui-preview` or `output/r3b-visual/ref-*.png` as design authority.

## R3C.2 Code/design-system comparison

Compare recovered HTML + `renders.css` against the current implementation, especially:

- DOM/layout hierarchy;
- current `src/ui/theme.ts` vs recovered `renders.css`;
- typography scale and line-height;
- container widths and page density;
- background/surface/border treatment;
- cards, tables, rails and case workspace composition;
- fleet/state grid;
- timeline composition;
- status chips/state colours;
- traveller shell/composer;
- hover/focus/motion;
- responsive behavior.

Classify each major design/component family:

- **SUBSTANTIALLY SAME / INHERITED**;
- **PARTIALLY DRIFTED**;
- **MATERIALLY DIFFERENT**;
- **MISSING**.

The goal is to distinguish styling drift from runtime-data/content problems before changing code.

## R3C.3 Representative side-by-side audit

Do **not** exhaustively compare all 23 variants.

Render and compare representative main page families at the same viewport:

1. Overview;
2. Programme;
3. Case — choose the recovered state that best demonstrates options/approval hierarchy and compare to a matching real hero case (prefer S2/Jordan if state-compatible);
4. Decisions;
5. Activity;
6. Traveller — choose the closest disrupted/recovering/decision reference and matching real state;
7. Programme-change preview/commit — S1→S3.

Optionally add one healthy Traveller state only if it materially changes design direction.

For each pair record:

- exact recovered HTML file;
- exact current route/state;
- viewport;
- hierarchy differences;
- typography differences;
- spacing/density differences;
- colour/surface differences;
- missing/extra components;
- interactions/motion differences;
- runtime content differences that should be ignored.

Produce side-by-side image evidence/contact sheets suitable for human inspection.

## R3C.4 Human gate

The human owner decides, screen family by screen family:

- **Use recovered direction**;
- **Keep current direction**;
- **Hybrid**;
- plus explicit requested changes.

After that decision, create/update:

`docs/UI_VISUAL_DIRECTION.md`

This becomes the authoritative visual-direction contract for R3D/R3E. It must distinguish:

- design/layout decisions;
- factual/runtime content that remains governed elsewhere;
- intentional deviations from recovered UI;
- global typography/colour/motion decisions.

Do not create/freeze `UI_VISUAL_DIRECTION.md` before human review.

### R3C acceptance

R3C passes when:

- recovered source pack is preserved;
- code-level design drift report exists;
- representative side-by-side evidence exists;
- human owner has reviewed the pairs;
- `docs/UI_VISUAL_DIRECTION.md` records the chosen direction.

No product-code changes are required for R3C acceptance.

---

# R3D — Live Product Convergence

**Status:** PLANNED — begins only after R3C human direction freeze.

**Purpose:** apply the approved visual direction to the already-implemented live product and close any remaining human-operability defects without reopening architecture.

Start from the current product line including `9700edd` + `7a168ead`. Reuse its browser-operability evidence; do not reimplement working backend flows.

Priority requirements from human live review include:

### Overview

- authoritative 67 / 42 / 25 representation;
- healthy green vocabulary = **Confirmed**;
- distinct Local and filled-grey Unconfirmed states;
- exactly 67 fleet cells with meaningful state colours;
- readable legend including yellow/brass watch state;
- fake/client-side search affordance;
- active-case operator row is primarily clickable to Case;
- Traveller interaction is secondary (`Show interaction` or frozen equivalent);
- journey mini-chain uses element-type icons (flight / ground / hotel / commitment) with colour conveying state;
- larger readable icons;
- no commitment explosion.

### Case

- workflow-first hierarchy;
- `Trip status` naming;
- primary next action impossible to miss;
- recovery options clearly visible;
- recommended vs rejected/infeasible hierarchy;
- plain-language checks/evidence;
- recovery-relevant commitment projection rather than every engagement;
- no internal jargon/IDs/traces in normal operator copy.

### Programme

- arithmetic and arrangement split must make sense;
- Confirmed vocabulary;
- names/columns do not bleed;
- active-case navigation goes to Case;
- timeline becomes day-grouped and scannable rather than a text wall.

### Decisions

- populated-world pending decisions must agree with Overview scope;
- decision rows navigate to Case;
- empty page is unacceptable when authoritative pending decisions exist.

### Activity

- human-facing provider/traveller/Northstar identities where evidence exists;
- no generic raw `Providers`/system-log feel;
- reduce duplicate/noisy audit events;
- preserve provenance truth without implementation jargon.

### Global

- readable typography (rough target body ~16–17px; important tables/rosters ~15–16px; section headings ~18–20px; page H1 ~26–30px);
- stronger surface separation / fog / borders / state fills consistent with the R3C direction;
- restore meaningful hover/focus/micro-motion;
- `prefers-reduced-motion` respected;
- responsive operator and traveller surfaces remain usable.

### Human scenario operability

Browser-driven product interaction must still prove S1–S8 reach explicit visible terminal recovery/recovery-with-loss/escalation states using product controls. `/demo`, curl, hidden APIs, or manual DB edits cannot be acceptance paths.

R3D ends as:

`R3 LIVE ACCEPTANCE CANDIDATE`

It does **not** self-certify R3 accepted.

---

# R3E — Final UI Pass + Human Production Acceptance

**Status:** PLANNED — after R3D function/content/layout is stable.

**Purpose:** one dedicated final polish pass after the product actually works and the visual direction is frozen.

This is not another broad product implementation cycle.

Audit across the whole product for:

- typography/readability;
- spacing rhythm and alignment;
- hierarchy;
- surface contrast;
- borders/shadows where appropriate;
- state-colour consistency;
- icon sizing;
- table readability;
- button hierarchy;
- hover/focus states;
- motion and transition washes;
- empty states;
- internal-language leakage;
- responsive desktop/laptop/mobile composition;
- consistency between Overview / Programme / Case / Decisions / Activity / Traveller / programme-change preview.

Visual acceptance order:

1. `docs/UI_VISUAL_DIRECTION.md` (human-frozen R3C direction);
2. current live product truth;
3. `docs/recovered_ui/` as supporting design reference;
4. `docs/DESIGN.md` general design charter.

Never change factual runtime state merely to match a static recovered HTML example.

### R3E acceptance / R3 gate

After local/browser gates pass, deploy the candidate to Railway.

**The human owner performs final production visual + operability acceptance.**

R3 is accepted only when the human can open production and confirms that:

- the primary pages look coherent and polished;
- the product is understandable without internal explanation;
- the hero flows are manually operable;
- Reset returns to the correct populated Overview;
- no material UI blocker remains.

Only after that human sign-off may R4 begin.

---

# R4 — Hero Rehearsal + Wave 4 Stabilisation

**Status:** PLANNED — blocked on R3 human acceptance.

R4 is deliberately narrow. No speculative UI redesign and no new product capability.

Rehearse exact final story:

`S2 -> Reset -> S1 -> S3 (NO RESET between S1 and S3) -> Reset -> S7 -> Reset -> S5`

For every segment freeze:

- starting Overview state;
- exact click path;
- visible state transitions;
- provenance labels;
- human decision/action;
- expected terminal state;
- reset/fallback procedure;
- recording notes if relevant.

Stabilisation gates align to `docs/IMPLEMENTATION_PLAN.md` and `docs/WAVE3R_DEMO_READINESS_PLAN.md`:

- deterministic reset/reseed;
- restart/persistence;
- browser hero rehearsal repeatability;
- provider/model degradation/fallback behavior;
- relevant/full tests;
- typecheck;
- lint;
- build;
- anti-hardcoding/generalisation;
- secrets/PII/recording sanitation;
- deployed Railway smoke;
- README/demo/evidence truth.

Only release-blocker fixes are allowed.

---

# Gate — Final Candidate Review

**Status:** PLANNED — after R4 stabilisation and before R5 freeze.

Primary independent reviewer: Claude Opus 5 High/Max or documented strongest independent fallback.

Review exact candidate SHA for release blockers, not speculative improvements:

- browser clickthrough;
- 67/42/25 programme coherence;
- hero choreography;
- natural/user-facing action boundaries;
- provider/replay claim truth;
- state/uncertainty/jargon consistency;
- deterministic safety/authority;
- anti-hardcoding/generalisation;
- replay/reset/restart reliability;
- tests/typecheck/lint/build;
- secrets/evidence/docs consistency.

Every finding is triaged:

`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`

No release gate passes with unresolved Act Now or release-threatening Investigate Now findings.

---

# R5 — Findings Closure + Freeze + Submission Candidate

**Status:** PLANNED.

After Final Candidate Review:

- fix Act Now findings;
- investigate only release-threatening Investigate Now items;
- record Park/Accept Risk explicitly;
- truth-sync `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, `DEMO.md`, and readiness docs;
- leave `SCENARIOS.md` / `FINAL_DEMO_CONTENT_SSOT.md` unchanged unless factually necessary;
- commit/push exact accepted candidate;
- deploy Railway;
- smoke populated Overview, hero entry/clickthrough, and Reset;
- record exact final SHA;
- **freeze application code**.

After R5, normal software development stops. Only a catastrophic release/submission blocker may reopen code.

R5 hands the frozen product to submission production; it is not itself the final hackathon submission.

---

# Submission Production — after R5

This resumes the parent Wave 3R / Implementation Plan cadence: 28–29 Aug are for video, README/evidence, submission packaging; 30 Aug is contingency only.

## Submission A — Blind judge / story critique

Use GrokBot or another fresh model with minimal implementation context as a hackathon judge.

Evaluate the frozen product/submission story for:

- immediate problem clarity;
- visible agentic loop;
- whole-trip resolution differentiation;
- Atlas importance;
- Alibaba Model Studio/Qwen contribution;
- generalisation vs scripted-demo smell;
- likely judging weaknesses.

This is not another broad code review. Only catastrophic presentation/release issues may reopen code.

## Submission B — Lock video story

Freeze:

- opening hook;
- problem statement;
- demo sequence/cuts;
- narration/voiceover;
- proof points;
- Atlas/Alibaba attribution;
- closing differentiation.

Use the R4 choreography as recording truth, but edit for judge comprehension rather than showing every scenario step.

## Submission C — Record demo

Record the frozen Railway product from deterministic Reset/populated Overview. Capture multiple clean takes where useful rather than relying on one perfect continuous performance.

## Submission D — Edit / produce final video

Trim, narrate, caption, zoom/crop, add restrained callouts/architecture visuals, and export the required final format. No product-code changes for aesthetic convenience.

## Submission E — README + evidence + portal package

Finalise:

- README/product explanation;
- architecture/agentic-loop diagram;
- setup/run notes;
- deployed URL;
- Atlas usage/evidence;
- Alibaba Model Studio/Qwen usage;
- LIVE/RECORD/REPLAY truth;
- screenshots/GIFs where helpful;
- scenario summary;
- judging-criteria mapping;
- required portal fields/team/project links.

## Submission F — Final sanity + submit

Before submission verify:

- Railway public URL works;
- default Overview + Reset work;
- repo visibility/link is correct;
- README renders;
- video permissions/link work;
- no secrets/PII leak;
- no stale contradictory docs shown to judges;
- submission claims are truthful;
- final SHA/deploy is recorded.

Then submit.

### 30 Aug — contingency only

Use only for broken links/uploads, production outage, submission-portal problems, or catastrophic demo regression. Do not add features.

---

## 5. Verification discipline from here

Avoid repeated broad gates.

- **R3C:** evidence/capture only; no full test suite unless required to boot deterministic capture.
- **R3D:** focused tests while implementing; one full gate at the milestone end.
- **R3E:** focused UI/browser checks; full repo gate only if behavior/shared code changes.
- **R4:** one canonical release/stabilisation gate on exact candidate SHA.
- **Final Candidate Review:** independent review reuses valid evidence and targets release risk.
- **R5:** targeted finding closure + deployment smoke; do not rerun expensive gates when the exact SHA already has valid evidence unless fixes invalidate them.
- **Submission production:** no software test cycle unless a catastrophic code reopen occurs.

---

## 6. Review ownership

- R0: Sol — complete.
- R1: Sol integration review — accepted.
- R2: Sol product/integration gate — accepted.
- R3C: human owner visual-direction gate; agent produces evidence only.
- R3D: primary integrator implementation; human-operability evidence required.
- R3E: human owner final production UI/operability acceptance.
- R4: conservative stabilisation owner.
- Final Candidate Review: Claude Opus-class independent reviewer.
- Post-R5: GrokBot/fresh model blind-judge critique.

Reviews are risk gates, not rituals.

---

## 7. Issue triage

Every discovered issue must be classified:

- **Act Now**
- **Investigate Now**
- **Park for Later**
- **Ignore / Accept Risk**

Distinguish release/filming blockers from “could be prettier” work.

---

## 8. Current decision state

### What we know

- generalized backend/state/recovery evidence is strong;
- R2 populated-world orchestration exists;
- live-product operability work has been implemented on the current product line;
- the original visual screenshots are gone;
- a 23-screen recovered HTML/CSS candidate pack exists locally and renders standalone;
- generated later reference previews are not acceptable visual authority;
- human live review is the final R3 acceptance authority;
- code-freeze day is 27 Aug; 28–29 Aug are submission-production days.

### What we do not know

- how materially the recovered HTML/CSS differs from current UI implementation code/design system;
- which recovered direction the human owner wants to retain vs current product;
- what final hybrid changes the human owner will choose after side-by-side review.

### Key assumption

The recovered HTML/CSS can serve as a design north star without dictating static demo facts or forcing a pixel-perfect recreation.

### Test next

**R3C:** preserve the recovered pack, perform code/design-system diff, render representative recovered/current screen pairs, and present the side-by-side evidence for human direction freeze.
