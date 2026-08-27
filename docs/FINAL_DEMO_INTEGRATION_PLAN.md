# Final Demo Integration & Code-Freeze Plan

**Status:** Active closure execution SSOT — **R3C ACCEPTED; R3D HUMAN ACCEPTANCE FIX REQUIRED**  
**Date:** 27 Aug 2026  
**Current product line:** `main` contains the integrated R2/R3 candidate (`a151792`), live-product operability closure (`9700edd`), and Railway early-bind health hardening (`7a168ead`). R3C is evidence/design-direction work only and does not redefine backend semantics.  
**Parent execution SSOT:** `docs/IMPLEMENTATION_PLAN.md`  
**Parent demo-readiness contract:** `docs/WAVE3R_DEMO_READINESS_PLAN.md`  
**Scope/status SSOT:** `docs/ROADMAP.md`  
**Scenario SSOT:** `docs/SCENARIOS.md`  
**Final demo world/content SSOT:** `docs/FINAL_DEMO_CONTENT_SSOT.md`  
**Human-frozen visual direction:** `docs/UI_VISUAL_DIRECTION.md`  
**Recovered design reference:** `docs/recovered_ui/`  
**R3C audit evidence:** `docs/ui-audit/`  
**Design charter:** `docs/DESIGN.md`  
**Historical closure evidence:** `docs/archive/FINAL_DEMO_INTEGRATION_PLAN_PRE_R3C.md`

This document governs the **remaining recovery / demo-closure sequence**. It is subordinate to the parent implementation, architecture, product, scenario, and roadmap SSOTs. It does not reopen accepted ontology, deterministic viability, authority, provider-neutral architecture, scenario narratives, or demo-world facts.

If an older handoff, screenshot proxy, generated preview, or prior visual-parity claim conflicts with this document or `docs/UI_VISUAL_DIRECTION.md`, the current documents govern.

---

## 1. Remaining runway

`R3D LIVE PRODUCT CONVERGENCE`
`→ R3E FINAL UI PASS + HUMAN PRODUCTION ACCEPTANCE`
`→ R4 HERO REHEARSAL + WAVE 4 STABILISATION`
`→ FINAL CANDIDATE REVIEW`
`→ R5 FINDINGS CLOSURE + CODE FREEZE`
`→ SUBMISSION PRODUCTION`
`→ SUBMIT`

No Stretch pull is planned from this point. Reopen Stretch only for a demonstrated release blocker that cannot be solved inside the accepted generalized product.

---

## 2. Binding product/demo state

Judge-facing entry is the populated **Operator Overview**, not `/demo`.

Canonical programme truth:

- **67 participants total**;
- **42 Northstar-managed travellers**;
- **25 local/self/unmanaged participants**.

From Overview, a human must be able to:

1. understand programme health quickly;
2. find affected travellers/cases;
3. click primarily into the relevant operator Case;
4. reach Traveller interaction secondarily;
5. continue a scenario using visible product controls to an explicit terminal result;
6. Reset demo and return to the same populated Overview.

Reset contract:

`scenario explored/completed -> Reset demo -> authoritative reseed -> populated Operator Overview`

No DB surgery, process restart, hidden fixture edit, curl-only flow, or `/demo` launcher may be required for judge-facing completion.

Hero sequence remains:

`S2 -> Reset -> S1 -> S3 (NO RESET between S1 and S3) -> Reset -> S7 -> Reset -> S5`

A scenario is human-complete only when the product visibly reaches:

- recovered;
- recovered with loss; or
- explicit escalation / human handoff.

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

Demo/test orchestration may know scenario IDs/manifests/fixture identities. Generic application/domain/engine logic must not branch on hero names, scenario IDs, suppliers, routes, dates, or fixture IDs.

---

## 4. Accepted recovery history

### R0 — Rescue Contract Freeze
**Status:** ACCEPTED.

### R1 — Demo Usability Closure
**Status:** ACCEPTED / MERGED.

Navigation/rehearsal wiring restored. Railway `PORT` / `0.0.0.0` behavior remains protected.

### R2 — Populated Demo World + Eight-Scenario Functional Coverage
**Status:** ACCEPTED.

Detailed entry-state contracts and prior evidence are preserved in `docs/archive/FINAL_DEMO_INTEGRATION_PLAN_PRE_R3C.md`.

### R3A — Projection/Data Closure
**Status:** COMPLETE / INTEGRATED.

Projection closure `1605665` covers operator/programme/traveller/case/decisions/activity presentation data and FX-safe cost presentation.

### Prior R3B visual pass
**Status:** INVALID AS FINAL VISUAL ACCEPTANCE.

Original screenshots were lost; later parity claims relied on proxies/stale evidence.

### Live-product operability closure
**Status:** IMPLEMENTED CANDIDATE (`9700edd`) + Railway hardening (`7a168ead`).

Human S1–S8 terminal paths, Overview scale/fleet contracts, case actions, programme-change/escalation paths, Decisions/Activity consistency and browser rehearsal were implemented. Do not redo working backend/application behavior without evidence of a real defect.

---

# R3C — Recovered UI Audit + Human Visual Direction Freeze

**Status:** **ACCEPTED — 27 Aug 2026.**

R3C completed:

- recovered 23-HTML candidate pack preserved in `docs/recovered_ui/`;
- original PNG references confirmed lost;
- AI replacement `assets/sg-dusk.png` clearly labelled non-original;
- code-level recovered-vs-current design audit completed;
- seven representative side-by-side families captured;
- human owner reviewed the comparison;
- final direction frozen in `docs/UI_VISUAL_DIRECTION.md`.

R3C conclusion:

- current and recovered UIs share the same core design-system lineage;
- divergence is mostly density, hierarchy, runtime overlays and content volume;
- programme-change runtime is the one materially different UI family;
- future implementation uses the human-approved **hybrid, recovered-leaning** direction rather than chasing pixel parity.

R3C evidence lives in `docs/ui-audit/`.

---

# R3D — Live Product Convergence

**Status:** **R3D HUMAN ACCEPTANCE FIX REQUIRED** — do not start R3E.

**Purpose:** apply `docs/UI_VISUAL_DIRECTION.md` to the already-working product and close remaining presentation/human-operability defects without reopening architecture.

`docs/UI_VISUAL_DIRECTION.md` is the visual authority for R3D. Static recovered HTML facts are never copied over authoritative runtime truth. For Overview / Programme / Case / Activity / Traveller / Programme Change, recovered screen composition is the **BASE UI**; production contributes runtime data, business logic, working controls, and owner-approved additions.

**Candidate branch:** `rescue/r3d-live-product-convergence`  
**Base:** `704c05bbc51c2aefa55210ee26ebfa1a78f6d8c3` (`origin/main`)  
**Prior convergence candidate (failed human review):** `0782f76ce8738e76d71460e918eb4ed8c7b6784e`  
**Human closure matrix:** `docs/ui-audit/R3D_HUMAN_ACCEPTANCE_CLOSURE.md`

R3D is **not** R3 accepted. Human acceptance remediation must close every matrix issue before owner review. Do **not** start R3E, merge to main, or deploy production from this branch until that gate passes.

## R3D priority outcomes

### Overview

- preserve authoritative 67 / 42 / 25 truth;
- top-level managed-travel presentation collapses to **Confirmed / Needs Attention / Watching / Unconfirmed**;
- Local remains a separate arrangement cohort, not another workflow state;
- filled-grey Unconfirmed cells with no emphasis ring;
- exactly 67 fleet cells;
- fleet ordered primarily by earliest upcoming commitment time, not severity, with deterministic fallback;
- detailed list beneath may remain attention-priority sorted;
- case-first row click, secondary Traveller interaction;
- search/filter retained;
- type icons retained and readable;
- fix broken/misaligned boxes;
- show 10 list entries per page with pagination.

### Programme

- strongly recover the cleaner recovered composition;
- collapse summary-state clutter using the same four managed-travel presentation buckets;
- preserve 67 / 42 / 25 truth;
- fix bleeding/misalignment;
- collapse repeated event/commitment context so main view is concise/day-grouped rather than repeating event information across every segment;
- recover clean traveller-table composition and case-first navigation.

### Case

- use recovered case workspace as visual skeleton while preserving current real actions;
- workflow-first hierarchy;
- top **three** recommended/best options prominently shown;
- remaining viable/rejected/infeasible options behind a collapsed `More options` disclosure;
- single obvious primary action;
- recovery-relevant journey/commitment chain;
- plain-language checks/evidence;
- no raw internal jargon/IDs/traces.

### Decisions

- keep inherited/current structure;
- ensure pending rows match authoritative state and navigate to Case;
- apply global readability/polish only.

### Activity

- keep inherited feed structure;
- rewrite projection/copy toward recovered plain-language quality;
- use truthful named airline/hotel/traveller/Northstar identities when evidence exists;
- remove raw/generic `Providers` feel and duplicate/noisy audit events;
- show approximately 20 entries per page with pagination/day grouping.

### Traveller

- recover concierge/mobile composition and choice-card hierarchy;
- retain real current actions/forms/state;
- choice UI only when a genuine choice exists;
- remove judge-facing demo banner.

### Programme Change

- recover the E1-style **Now vs Proposed** impact comparison before Commit;
- input/edit fields may exist as a prior step;
- final mutation-free preview must clearly show current state, proposed state, affected impacts and Commit/Cancel;
- S1→S3 remains visibly continuous.

### Global

- retain larger readable typography;
- restore clean spacing/alignment/surface contrast;
- retain purposeful hover/focus/stagger/settle motion with reduced-motion support;
- remove the judge-facing demo banner from normal product pages;
- preserve responsive operator/traveller usability;
- preserve current Railway binding/health behavior.

## R3D verification

During implementation:

- focused tests only for changed behavior;
- browser-drive representative surfaces and hero flows;
- preserve S1–S8 visible terminal operability;
- no static-recovered-data substitution;
- no scenario/hero hardcoding in generic application logic.

At R3D end run one relevant full gate:

- full tests;
- typecheck;
- lint;
- build;
- targeted anti-hardcoding/generalisation scan;
- browser hero rehearsal;
- deterministic reset/reseed smoke.

R3D ends as:

`R3D CONVERGENCE CANDIDATE — R3E NEXT`

It does not self-certify R3 accepted.

---

# R3E — Final UI Pass + Human Production Acceptance

**Status:** PLANNED — after R3D function/content/layout is stable.

One dedicated whole-product polish pass only. No broad product redesign.

Audit:

- typography/readability;
- spacing/alignment;
- hierarchy;
- surface contrast;
- state colours;
- icon sizing;
- table/list readability;
- button hierarchy;
- hover/focus/motion;
- empty states;
- internal-language leakage;
- responsive composition;
- cross-page consistency.

Visual acceptance order:

1. `docs/UI_VISUAL_DIRECTION.md`;
2. authoritative current runtime truth;
3. `docs/recovered_ui/` supporting reference;
4. `docs/DESIGN.md` general charter.

Deploy the R3E candidate to Railway.

**Human production review is the R3 gate.** R3 is accepted only after the owner confirms the primary pages look coherent/polished, hero flows are manually operable, Reset works, and no material UI blocker remains.

Only then may R4 begin.

---

# R4 — Hero Rehearsal + Wave 4 Stabilisation

**Status:** PLANNED — blocked on R3 human acceptance.

Rehearse exact final story:

`S2 -> Reset -> S1 -> S3 (NO RESET between S1 and S3) -> Reset -> S7 -> Reset -> S5`

Freeze per segment:

- starting Overview state;
- exact click path;
- visible state transitions;
- provenance labels;
- human decision/action;
- terminal state;
- reset/fallback procedure;
- recording notes.

Stabilisation gates align to `docs/IMPLEMENTATION_PLAN.md` and `docs/WAVE3R_DEMO_READINESS_PLAN.md`:

- reset/reseed repeatability;
- restart/persistence;
- browser hero repeatability;
- provider/model degradation/fallback;
- relevant/full tests;
- typecheck/lint/build;
- anti-hardcoding/generalisation;
- secret/PII/recording sanitation;
- deployed Railway smoke;
- README/demo/evidence truth.

Only release-blocker fixes are allowed.

---

# Gate — Final Candidate Review

**Status:** PLANNED — after R4 stabilisation, before R5.

Independent reviewer: Claude Opus 5 High/Max or documented strongest independent fallback.

Review the exact candidate SHA for release blockers, not speculative improvements:

- browser clickthrough;
- 67 / 42 / 25 coherence;
- hero choreography;
- user-facing action boundaries;
- provider/replay claim truth;
- state/uncertainty/jargon consistency;
- authority/safety;
- anti-hardcoding/generalisation;
- replay/reset/restart reliability;
- tests/typecheck/lint/build;
- secrets/evidence/docs consistency.

Every finding must be triaged:

`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`

No release gate passes with unresolved Act Now or release-threatening Investigate Now findings.

---

# R5 — Findings Closure + Freeze + Submission Candidate

**Status:** PLANNED.

After Final Candidate Review:

- close Act Now findings;
- investigate only release-threatening Investigate Now items;
- record Park / Accept Risk explicitly;
- truth-sync `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`, `DEMO.md`, readiness docs;
- preserve `SCENARIOS.md` / `FINAL_DEMO_CONTENT_SSOT.md` unless factual correction is required;
- commit/push exact accepted candidate;
- deploy Railway;
- smoke populated Overview, hero entry/clickthrough and Reset;
- record exact final SHA;
- **freeze application code**.

After R5 normal software development stops. Only a catastrophic release/submission blocker may reopen code.

R5 hands the frozen product to submission production; it is not itself the final hackathon submission.

---

# Submission Production — after R5

Parent cadence: **28–29 Aug = video/submission/README/evidence; 30 Aug = contingency only.**

## Submission A — Blind judge

Use GrokBot/fresh model with minimal implementation context to judge problem clarity, visible agentic loop, whole-trip differentiation, Atlas/Alibaba importance, generalisation and likely scoring weaknesses.

This is not another broad code review.

## Submission B — Lock video story

Freeze hook, problem statement, cuts, narration, proof points, Atlas/Alibaba attribution and closing differentiation using R4 choreography as recording truth.

## Submission C — Record demo

Record the frozen Railway product from deterministic Reset/populated Overview. Prefer multiple clean takes over dependence on one perfect continuous run.

## Submission D — Edit final video

Trim, narrate, caption, zoom/crop, add restrained callouts/architecture visuals and export the required format. No code changes for aesthetic convenience.

## Submission E — README + evidence + portal package

Finalise README, architecture/agentic-loop diagram, run notes, deployed URL, Atlas evidence, Alibaba/Qwen usage, LIVE/RECORD/REPLAY truth, screenshots/GIFs, scenario summary, judging-criteria mapping and portal fields.

## Submission F — Final sanity + submit

Verify Railway URL, default Overview, Reset, repo/video links/permissions, README rendering, secrets/PII, doc consistency, truthful claims and final SHA. Then submit.

### 30 Aug — contingency only

Use only for broken links/uploads, production outage, portal problems or catastrophic demo regression. Do not add features.

---

## 5. Verification discipline

Avoid repeated broad gates.

- **R3D:** focused tests while iterating; one full milestone gate.
- **R3E:** focused UI/browser checks; full repo gate only if behavior/shared code changes.
- **R4:** one canonical release/stabilisation gate on exact SHA.
- **Final Candidate Review:** independent release-risk review reusing valid evidence.
- **R5:** targeted finding closure + deployment smoke.
- **Submission production:** no software test cycle unless code is catastrophically reopened.

---

## 6. Review ownership

- R0: Sol — accepted.
- R1: Sol integration review — accepted.
- R2: Sol product/integration gate — accepted.
- R3C: human owner visual-direction gate — **accepted**.
- R3D: primary integration implementation + browser evidence.
- R3E: human owner final production visual/operability acceptance.
- R4: conservative stabilisation owner.
- Final Candidate Review: Claude Opus-class independent reviewer.
- Post-R5: GrokBot/fresh-model blind judge.

Reviews are risk gates, not rituals.

---

## 7. Issue triage

Every discovered issue must be classified:

- **Act Now**
- **Investigate Now**
- **Park for Later**
- **Ignore / Accept Risk**

Release/filming blockers take precedence over speculative polish.

---

## 8. Current decision state

### What we know

- generalized backend/state/recovery evidence is strong;
- R2 populated-world orchestration exists;
- live-product operability closure is already implemented;
- recovered HTML/CSS is preserved and audited;
- current/recovered UI share the same design-system lineage;
- human visual direction is frozen in `docs/UI_VISUAL_DIRECTION.md`;
- R3C is complete;
- code-freeze day is 27 Aug; 28–29 Aug are submission-production days.

### What we do not know

- whether R3D implementation exposes any remaining runtime/projection defect;
- whether the final converged UI will pass human Railway review without one more polish pass.

### Key assumption

The accepted generalized product can satisfy the frozen visual direction through presentation/read-model/UI work without reopening architecture.

### Test next

**R3D Live Product Convergence** against `docs/UI_VISUAL_DIRECTION.md`, preserving existing human-operability semantics and Railway deployment behavior.
