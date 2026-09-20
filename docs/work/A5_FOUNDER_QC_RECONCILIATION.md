# A5 founder-QC reconciliation — 21 September 2026

## Purpose

This document reconciles NORTHSTAR planning after the founder completed the first meaningful Sarah + Jordan end-to-end product QC on `finish/a5-final-truth-repeat-freeze @ 372a664041897ddb173aa12612307c759e060bc3`.

The result is not "A5 failed" and it is not a new architecture phase.

A4's protected execution path remains physically accepted. Founder QC exposed two remaining convergence classes:

1. the Overview and Case surfaces need one serious visual/product redesign pass; and
2. several backend/read-model/product-state seams still compress or misstate the progression that the UI must present.

These now run as two bounded parallel lanes. A5.2 physical hero proof and A5.3 final gates/freeze remain serial after the lanes converge.

---

## Current accepted baseline

- A2 Sarah LIVE programme recovery: accepted.
- A4 Jordan protected external execution: physically accepted at `546adf210db8ead343ecdac22b410515665c176a`.
- A5.1 founder-QC branch: `finish/a5-final-truth-repeat-freeze @ 372a664041897ddb173aa12612307c759e060bc3`.
- Founder evidence: `docs/work/A5_1_FOUNDER_SARAH_QC_NOTES.md`.

A4 architecture remains frozen:

`AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`

Unknown provider outcomes reconcile; they are never blindly redispatched.

---

# Lane A — one-time visual-first Overview + Case redesign

## Objective

Design the operator product from the user job downward instead of continuing to rearrange accumulated components.

The only major visual systems explicitly preserved are:

- V7.2 Event Overview Graph;
- V5.6 Live Dependency Graph.

Their accepted semantics remain binding. They may be resized/repositioned and their surrounding interaction/chrome may improve. The rest of Overview and Case may be rearranged or replaced.

## Required sequence

1. visual information architecture;
2. image mockups;
3. founder visual QC;
4. static HTML prototypes;
5. founder HTML QC;
6. only then production integration against real read models/runtime.

Do not implement production UI before the target composition is accepted.

## Overview target

- graph is the dominant object directly under the header;
- multiple simultaneous active/open stories are discoverable;
- Sarah and Jordan coexist in the same product world;
- one selected active change may drive V7.2 focus;
- overall population/readiness remains understandable;
- affected traveller -> Case drill-down is obvious;
- secondary roster/attention detail follows the graph rather than burying it.

This requirement does **not** require multiple simultaneous blast centres inside V7.2. A single focused incident with other open cases visible around it is acceptable and preferred unless runtime evidence proves otherwise.

## Case target

- graph immediately prominent under the header;
- likely 70–80% graph + useful decision/status rail;
- recommendation, authority and action read as one coherent story;
- activity/provenance is accessible but secondary;
- NEW SPEND and POTENTIAL DISPLACED-BOOKING LOSS are visibly distinct;
- Sarah reads as programme recovery, not "flight rebooking with some programme detail";
- Jordan reads as whole-trip recovery, not "replace one flight".

---

# Lane B — bounded backend truth closure

## Objective

Fix the truth being handed to the redesigned surfaces without reopening A4 architecture.

### Act Now

1. **Jordan D1/D2/D3 Overview progression**
   - required presentation truth: GREEN -> AMBER -> RED;
   - current founder observation: GREEN -> RED -> RED;
   - likely issue: whole-trip FAIL is collapsed into top-level DISRUPTED before connection-specific TIGHT vs IMPOSSIBLE can survive projection.

2. **Jordan D3 focused Case causality**
   - D3 must clearly express changed arrival -> failed connection -> downstream consequence;
   - upstream delay may remain CHANGED/amber, but the actual failed breakpoint/relationship must be authoritative and visible.

3. **Duplicate focused connection edges**
   - investigate booking->booking plus timing->booking duplication;
   - remove redundant product projection only if both represent the same causal relation.

4. **Premature D2 recovery recommendation**
   - D2 may create monitoring/attention;
   - do not prematurely sell replacement recovery before the connection is actually impossible unless authoritative architecture proves that is required;
   - fix at the smallest generic lifecycle/planning/recommendation gate.

5. **Jordan approval unavailable**
   - reproduce and identify the exact blocker;
   - distinguish real authority/budget/protected-input/provider blocker from bad QC provisioning;
   - never bypass deterministic safety to make a button clickable.

6. **Sarah + Jordan coexistence**
   - one normal PostgreSQL workspace must support both stories simultaneously;
   - reset is not a product-level scenario switcher;
   - if the limitation is harness/fixture/provisioning, fix that layer rather than domain architecture.

7. **Suspicious Sarah FAILED states**
   - node/edge state must be scoped to its own authoritative truth;
   - do not inherit Case-wide failure onto unrelated healthy objects.

### Preserve

- deterministic RC-6 viability;
- one generalized recovery engine;
- PostgreSQL normal runtime;
- A4 action ordering;
- selected-plan continuation;
- protected Atlas/Nuitée execution;
- authority/budget gates;
- canonical receipt application;
- observation/reconciliation;
- no-blind-retry semantics.

---

# A5 sequence after reconciliation

## A5.1 — convergence

Two parallel lanes:

`visual-first redesign`
+
`backend truth closure`

Then integrate the accepted HTML direction with the corrected read-model/runtime truth.

Founder performs another normal end-to-end QC on the integrated candidate.

A5.1 closes only when the product is understandable, actionable and recordable through both hero stories.

## A5.2 — final physical hero proof

On one exact final candidate SHA:

- Sarah LIVE proof;
- Jordan LIVE/SANDBOX proof;
- same generalized engine;
- no product reset required to conceptually switch travellers/cases;
- destructive external Jordan setup may still use a fresh provider baseline/workspace where supplier state requires it.

Any real product bug found here invalidates the candidate and returns to the smallest responsible A5.1 lane.

## A5.3 — gates + freeze

Only after both heroes pass on the same candidate:

```bash
npm run typecheck
npm run build
npm run lint
npm test
npm run test:postgres
npm run test:migration
npm run gate:anti-hardcoding
```

Then normal PostgreSQL boot smoke, docs/evidence reconciliation, exact diff/status/secrets check, commit/push and freeze.

No further development without a demonstrated submission blocker.

---

# Issue triage

## Act Now

- serious one-time visual redesign of Overview + Case;
- graph->Case drill-down;
- graph badge/text and inspector usability where preserved graph UI owns it;
- Jordan GREEN->AMBER->RED truth;
- D3 causal failure projection;
- duplicate connection projection;
- D2 recommendation gating;
- exact Jordan approval blocker;
- Sarah + Jordan coexistence;
- suspicious Sarah false-FAILED states;
- integrated founder E2E after both lanes converge.

## Investigate Now

- exact owner of the confusing 51/67 managed-readiness explanation;
- whether Sarah's "all at once" transition needs additional truthful lifecycle observability beyond redesigned presentation;
- exact LIVE/REPLAY provenance expected in founder rehearsal versus final recording.

## Park for Later

- mobile/traveller surface acceptance;
- healthy-trip requested-state planning;
- generic programme/hotel/admin tooling;
- broad immigration crawling;
- transfer transactions;
- insurance claims;
- unrelated providers;
- extra scenarios beyond hero needs;
- importer redesign;
- infrastructure/refactors;
- multiple simultaneous blast centres inside V7.2 unless a real product requirement emerges.

## Ignore / Accept Risk

- technical UUIDs inside deliberately collapsed Technical Details;
- unrelated honest UNKNOWN/unconfirmed population state;
- historical manifests/tests that no longer define current hero behaviour;
- manual fresh external provider baseline preparation for destructive Jordan proof.

---

# Major decisions

## WHAT WE KNOW

- A4 proves the protected four-action Jordan execution loop and final recovery.
- Sarah's programme-side recovery is already physically proven.
- Founder E2E exposed real UI composition problems and real read-model/product-state defects.
- The connection evaluator already distinguishes TIGHT from IMPOSSIBLE; the product projection currently does not preserve that distinction well enough.
- Overview polling updates without hard refresh.
- Product architecture supports many Cases; reset-as-scenario-switch is not an acceptable product model.

## WHAT WE DO NOT KNOW

- the exact Jordan approval blocker in the founder-QC runtime;
- whether every suspicious Sarah FAILED badge is false or some are legitimate scoped programme failures;
- whether the optimal visual composition can be implemented without a small bounded read-model extension;
- whether Sarah progression needs more backend lifecycle exposure or only better UI presentation.

## KEY ASSUMPTION

The remaining work is convergence, not core-engine reconstruction: one accepted visual composition plus bounded backend/read-model corrections should be sufficient to reach a recordable candidate.

## WHAT SHOULD BE TESTED NEXT

In parallel:

1. approve visual image mockups and HTML target;
2. reproduce/fix backend D1/D2/D3 + approval + multi-case truth;
3. integrate once both are stable;
4. founder E2E the integrated candidate before spending final LIVE/SANDBOX proof budget.
