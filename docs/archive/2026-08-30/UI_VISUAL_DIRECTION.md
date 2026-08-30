# Northstar UI Visual Direction — R3C Human Freeze

**Status:** APPROVED visual-direction contract for R3D/R3E  
**Date:** 27 Aug 2026  
**Human gate:** R3C visual direction accepted  
**Evidence branch:** `audit/r3c-recovered-ui-direction`  
**Recovered reference pack:** `docs/recovered_ui/`  
**Audit evidence:** `docs/ui-audit/`  

This document is the authoritative visual-direction contract for the remaining Northstar UI work. It records the human owner's decisions after reviewing the recovered-vs-current R3C comparison.

It governs **presentation, hierarchy, density, interaction affordances and visual polish**. It does **not** redefine runtime facts, domain state, scenario semantics, authority, provider claims or business logic.

Factual/runtime authority remains:

- `docs/FINAL_DEMO_CONTENT_SSOT.md` — programme/cast/demo facts;
- `docs/SCENARIOS.md` — scenario behavior;
- application read models / deterministic engine — current state;
- `docs/FINAL_DEMO_INTEGRATION_PLAN.md` — remaining execution sequence;
- `docs/DESIGN.md` — general design charter where not superseded here.

The recovered HTML/CSS is the closest surviving design reference, not factual SSOT. Static names, times, counts, routes, suppliers, costs and statuses inside recovered HTML are illustrative only.

Do not use `data/ui-preview/**`, `output/r3b-visual/ref-*.png`, or later generated proxy screenshots as design authority.

---

## 1. Overall direction

Northstar should converge toward the **recovered composition and visual hierarchy**, while preserving the current product's useful runtime features and the owner's explicit live-product requirements.

This is therefore a **HYBRID, recovered-leaning** direction overall.

Keep from current where valuable:

- authoritative 67 / 42 / 25 programme truth;
- operator case-first navigation;
- secondary Traveller interaction access;
- search/filter affordances;
- visible human-operable actions;
- truthful runtime content and provenance;
- current larger/readable type direction;
- accessibility/focus improvements;
- deterministic current state rather than static recovered examples.

Recover / strengthen:

- composition and box placement;
- visual hierarchy and density;
- cleaner state summary;
- compact programme composition;
- case option hierarchy;
- traveller concierge character;
- Now vs Proposed programme-change comparison;
- plain-language Activity wording;
- consistent surface treatment;
- purposeful animation/microinteraction.

Remove:

- the demo banner/chrome from judge-facing/operator/traveller product pages;
- visual clutter caused by exposing too many internal/backend states;
- bleeding/misaligned cards, rows or columns;
- giant unbounded lists/timelines.

---

## 2. Global presentation rules

### 2.1 Typography and readability

Preserve the owner's prior live-review requirement for **larger, readable typography**. Do not shrink back to the recovered static render merely to achieve pixel similarity.

Target direction:

- body: approximately 16–17px;
- important roster/table text: approximately 15–16px;
- section headings: approximately 18–20px;
- page H1: approximately 26–30px;
- metadata/badges must remain legible and should not collapse into 10px microcopy.

Use the recovered density/composition while retaining current readability.

### 2.2 State simplification

Backend/read-model states remain unchanged and authoritative.

For **Overview and Programme summary/fleet presentation**, collapse managed-travel state into exactly four user-facing buckets:

1. **Confirmed** — healthy / resolved / no action required;
2. **Needs Attention** — disrupted, blocked, awaiting a decision/input where human attention is required, or otherwise materially not viable;
3. **Watching** — at risk, recovering, planning, or changed but not presently requiring urgent action;
4. **Unconfirmed** — missing/unknown/not yet confirmed.

**Local** is not a fifth status. It is a separate travel-arrangement cohort for the 25 local/self/unmanaged participants and must remain distinguishable from managed Unconfirmed.

Do not expose every backend enum/state as a top-level chip/tile/legend item. Deeper Case/Traveller pages may explain the precise underlying state in plain language where useful.

### 2.3 Colour and fleet-cell semantics

Keep the existing design-system palette lineage, but simplify the visible legend:

- Confirmed → green;
- Needs Attention → vermilion/red;
- Watching → brass/yellow;
- Unconfirmed → filled neutral grey;
- Local → distinct neutral treatment separate from Unconfirmed, but not promoted as a workflow status.

Unconfirmed fleet cells must look like **filled grey contribution-grid cells**, not empty holes.

Do not draw emphasis rings around ordinary grey/unconfirmed cells. Their shape, border weight and alignment should match all other fleet squares.

### 2.4 Motion / interaction

Keep the explicit live-review requirement for visible but restrained polish:

- actionable rows/cards: clear hover/focus response, subtle lift where appropriate;
- entry stagger where it helps orientation;
- changed-value/state settle wash;
- tasteful status/count transitions where already supported;
- no fake "AI thinking" theatre;
- respect `prefers-reduced-motion`;
- animations must never obscure state or slow operator action.

### 2.5 Demo chrome

Remove the judge-facing **demo banner** from normal Overview / Programme / Case / Decisions / Activity / Traveller / programme-change pages.

The product can still have a visible `Reset demo` control required for rehearsal/demo operation. Internal `/demo` diagnostics remain non-hero tooling.

---

## 3. Overview — HYBRID, recovered composition + current product semantics

Recovered reference: `docs/recovered_ui/o1-overview.html`.

### Keep / require from current explicit asks

- 67 participants total;
- 42 Northstar-managed travel;
- 25 local/self/unmanaged;
- managed-travel healthy wording = **Confirmed**, not Ready;
- operator row with active case is primarily clickable to Case;
- secondary `Show interaction` access to Traveller surface;
- search/filter affordance;
- element-type mini journey icons (flight / ground / hotel / commitment) with state colour;
- larger readable mini-chain icons;
- exactly 67 fleet cells.

### Recover / fix

- recover the cleaner recovered composition and box placement;
- repair any layout break introduced by the current additional controls/data;
- ordinary grey cells must align visually with all other fleet squares;
- no emphasis ring around grey cells;
- filled grey, coding-contribution-grid-like cells for Unconfirmed;
- reduce visual legend/status clutter to the four managed states + separate Local cohort semantics.

### Fleet ordering

The 67-cell fleet grid should **not** primarily sort red/critical cells to the front.

Primary fleet ordering should be by each participant's **earliest upcoming commitment time** (with a deterministic fallback for missing/no commitment). The intent is that the grid reads as the programme moving through time and naturally produces a mixed, more informative colour pattern.

The detailed list beneath may retain/use an attention-priority sort so urgent operator work remains easy to find.

Do not hardcode hero identities or scenario IDs into sorting logic.

### Overview case list density

Do not render an unbounded roster/case list down the page.

Show **10 entries per page** with stable layout height and clear pagination controls. Preserve search/filter behavior. Avoid a giant page; if viewport constraints require internal scrolling, keep it contained, but the primary model is 10-row pagination.

---

## 4. Programme — RECOVERED-LEANING HYBRID

Primary recovered reference: `docs/recovered_ui/p1-programme-healthy.html`.

Supporting disrupted/post-change reference: `docs/recovered_ui/e2-after-commit.html` where useful. `p2-programme-disrupted.html` is a duplicate of P1 and must not be treated as an independent reference.

### Direction

- lean strongly toward recovered composition;
- fix production card/box bleeding and misalignment;
- simplify summary boxes/statuses using the four managed-travel presentation buckets;
- Local remains a separate arrangement cohort, not another recovery status;
- preserve accurate 67 / 42 / 25 programme truth.

### Event/timeline composition

Production currently repeats event/programme information too aggressively across segments.

Collapse the main programme view so the first scan resembles the recovered composition:

- concise programme/day grouping;
- event/commitment shown once in the appropriate chronological grouping rather than redundantly for every traveller/segment;
- expandable/drill-down detail where useful rather than repeating the same event context everywhere;
- keep important affected/endangered commitment information visible without turning the page into a wall of text.

### Traveller table

- recover the cleaner table composition;
- fix name/card/column bleeding and misplaced boxes;
- case-first navigation for active cases;
- secondary Traveller interaction access where retained;
- keep rows compact and scannable.

Do not let runtime content volume destroy the recovered layout hierarchy.

---

## 5. Case — HYBRID, strongly recovered visual skeleton

Primary recovered reference: `docs/recovered_ui/c3-case-options.html`.

Other useful recovered states: C1/C2/C5/C6. `c4-case-approval.html` duplicates C3 and is not a distinct approval reference.

### Direction

Use the recovered Case workspace as the **visual skeleton**:

- two-column case grid;
- strong option-card hierarchy;
- readable journey chain;
- sticky/right-side commitment/action rail;
- clear separation of problem, options, impact, checks and next action.

Preserve current functional workflow controls and actual runtime state.

### Option hierarchy

The primary recovery decision area should show **at most three recommended / best candidate options** prominently.

Do not dump nine options into the primary decision surface.

Additional viable/rejected/infeasible options should be placed below in a **collapsed `More options` / equivalent disclosure section**. They remain available for transparency but do not compete with the main decision.

The recommended option and single primary action must be obvious above the fold where possible.

### Content hierarchy

Prefer:

1. what changed;
2. Trip status / whole-trip viability;
3. recommended next action;
4. top three options;
5. what this affects;
6. plain-language checks/evidence;
7. more options / detailed evidence / activity;
8. authority/funding/commitment rail as appropriate.

Do not expose raw IDs, enum names, rule traces or implementation jargon in normal operator copy.

---

## 6. Decisions — CURRENT / inherited structure

Recovered reference: `docs/recovered_ui/d1-decisions.html`.

The current structural implementation is already essentially the same lineage and does not need redesign for its own sake.

Requirements:

- pending decisions must actually match authoritative Overview/case state;
- rows navigate to Case;
- wording must remain human-facing;
- spacing/table readability should follow the global type and density rules;
- no unnecessary new state taxonomy.

This is primarily a data/copy/polish surface, not a redesign target.

---

## 7. Activity — CURRENT STRUCTURE, RECOVERED WORDING QUALITY

Recovered reference: `docs/recovered_ui/activity.html`.

Keep the inherited feed structure, but bring copy quality back toward recovered.

### Wording

Activity must read as a useful human operational history, not raw system logs.

Prefer entries that say plainly:

- what happened;
- who/which real supplier or traveller did it where evidence exists;
- what Northstar did;
- what changed as a result.

Do not surface generic raw actors such as `Providers` when a truthful airline/hotel/traveller/Northstar label can be resolved. Do not fabricate supplier identities when evidence is absent.

Reduce duplicate/noisy audit events.

### Pagination

Show approximately **20 activity entries per page** with pagination. Do not allow an indefinitely long activity page.

Preserve day grouping inside each page where practical.

---

## 8. Traveller — RECOVERED-LEANING HYBRID

Recovered references:

- `t2-disrupted.html` for disruption/recovery state;
- `t4-choice.html` for decision state;
- `t6-recovered.html` for payoff;
- `t1-ready.html` for healthy state.

Direction:

- retain current real runtime state and functional forms/actions;
- recover the stronger concierge/mobile composition and hierarchy;
- preserve the recovered hero/commitment/viability/choice-card character;
- keep mobile-first max-width treatment;
- use the recovered choice-card pattern when the traveller genuinely has a choice;
- do not render choice UI in states where no decision is required.

The recovered dusk hero treatment may guide the design, but `docs/recovered_ui/assets/sg-dusk.png` is an AI-generated replacement, not an original recovered asset. Do not misrepresent provenance.

Remove judge-facing demo banner/chrome here as well.

---

## 9. Programme Change — RECOVERED DIRECTION

Primary recovered reference: `docs/recovered_ui/e1-change-preview.html`.

The runtime form-first modal is the one materially diverged UI family and should be changed.

### Required direction

The important confirmation step should use the recovered **Now vs Proposed** comparison model:

- current commitment state;
- proposed state;
- affected travellers / impacts;
- viability/attention implications;
- alternatives/notes where useful;
- explicit Confirm/Commit vs Cancel/Back.

If input/edit fields are still needed, they may exist as a prior editing step. The final mutation-free preview shown before Commit must be the clear recovered-style comparison, not merely a form with an impact paragraph.

S1 → S3 must visibly demonstrate:

`current programme -> proposed programme change -> impact preview (no mutation) -> organiser commit -> authoritative programme update -> Sarah re-evaluated viable`

---

## 10. Implementation boundaries for R3D

R3D may change presentation/UI/read-model projection code required to satisfy this visual contract and close remaining human-operability defects.

It must not:

- change backend/domain semantics merely to match static recovered HTML;
- hardcode scenario IDs, hero names, routes or suppliers into generic UI/domain logic;
- replace authoritative read-model facts with recovered static examples;
- bypass deterministic authority/execution/state update;
- reopen accepted ontology/provider architecture without a proven gap.

When backend state is more detailed than the four summary states, implement a deterministic **presentation mapping**, not destructive state mutation.

---

## 11. R3D / R3E visual acceptance priorities

### R3D — convergence

Implement the contract above while preserving S1–S8 manual operability and current deployment behavior.

### R3E — final UI pass

After content/function/layout stabilize, perform one dedicated whole-product polish pass for:

- typography;
- spacing;
- alignment;
- surfaces;
- state colour consistency;
- icons;
- tables;
- buttons;
- hover/focus;
- animation/motion;
- responsive behavior;
- internal-language leakage;
- cross-page consistency.

R3 is accepted only after human production review on Railway.

---

## 12. Human direction summary

| Family | Frozen direction |
|---|---|
| Overview | **HYBRID — recovered composition + current explicit product asks** |
| Programme | **RECOVERED-LEANING HYBRID** |
| Case | **HYBRID — strongly recovered visual skeleton, current working actions** |
| Decisions | **CURRENT / inherited structure** |
| Activity | **CURRENT structure + recovered-quality wording** |
| Traveller | **RECOVERED-LEANING HYBRID** |
| Programme change | **RECOVERED** |

Global requirements: simplified visible states, larger readable typography, purposeful animation/microinteraction, no judge-facing demo banner, and no pixel-faithfulness requirement where it conflicts with usability or authoritative runtime truth.
