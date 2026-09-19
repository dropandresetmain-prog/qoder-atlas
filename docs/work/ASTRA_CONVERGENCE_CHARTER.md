# NORTHSTAR — Astra Convergence Charter

Status: **PRE-LAUNCH CHARTER**

Purpose: give the post-R4 Astra primary agent a clear destination, non-negotiable constraints and stop-safe structure without dictating the exact implementation path.

This is the primary Astra entrypoint.

The prepared detailed audits are supporting evidence. They define product/graph/Jordan truth in depth. This charter deliberately does **not** turn them into a step-by-step coding recipe.

---

## 1. Mission

Starting from the exact final accepted R4 SHA, converge NORTHSTAR into a credible hackathon submission and real product baseline with these outcomes:

1. frontend product quality is **at minimum restored to the last normal pre-refactor standard**;
2. accepted Case Graph **V5.6** is faithfully wired to current authoritative PostgreSQL truth;
3. accepted Event Overview Graph **V7.2** is faithfully wired to current authoritative PostgreSQL truth;
4. Sarah is physically runnable end-to-end through the product;
5. Jordan S2 is physically runnable end-to-end through the same generalized recovery architecture;
6. all normal runtime persistence remains PostgreSQL;
7. provider/model provenance remains truthful;
8. consequential actions remain deterministically gated;
9. every major stage leaves a pushed, stoppable checkpoint the founder can take over from.

Astra should decide the safest implementation plan after inspecting the repository.

---

## 2. Launch condition

Do not start product implementation from a moving R4 branch.

Astra launches from:

**the exact final accepted R4 SHA**

A0 must record:

- branch;
- SHA;
- acceptance status;
- clean/dirty state;
- outstanding worktrees/branches;
- valid R4 evidence;
- known inherited risks.

If R4 is not actually accepted, say so explicitly. Do not silently redefine "post-R4."

---

## 3. Source-of-truth precedence

When sources disagree:

1. current runtime/code/schema establish current reality;
2. accepted product/design/architecture decisions establish intended behavior;
3. detailed prep audits establish investigated gaps;
4. historical implementation/tests are migration/reference evidence only;
5. prototypes define accepted visual behavior where explicitly frozen, not domain/runtime truth.

Do not revive historical SQLite/runtime behavior merely because an old test once depended on it.

---

## 4. Prepared Astra references

Before broad implementation, read these detailed references after they are integrated onto the final R4 base:

### Frontend product floor

`docs/work/LEGACY_FRONTEND_PRODUCT_BASELINE.md`

Prepared commit:

`38a664d5ded5bbde085e60603126f3cd6b301479`

Authoritative legacy baseline:

`20454aa7f16e18cf07eb1558481637f8a18f2d09`

Use this to answer:

> What did the pre-refactor product actually let the operator/traveller understand and do?

The legacy baseline is the minimum product-quality floor, not a request to restore legacy persistence/runtime architecture.

### Graph production contract

`docs/work/NORTHSTAR_GRAPH_PRODUCTION_CONTRACT_V5_6_V7_2.md`

Prepared commit:

`634fbdd0afe3513d4ed803c572ebbbda3d04a881`

Use this to answer:

> What do accepted V5.6 and V7.2 require, which semantics belong in backend/read models, and which are pure visual behavior?

Important interpretation:

- graph timing/objective needs are **projection/read-model gaps first**, not automatic requests for new core ontology entities/tables;
- V7.2 must support generic meaningful shared dependencies, but that does **not** mandate implementing hotel providers merely to populate the graph.

### Jordan readiness

`docs/work/JORDAN_CURRENT_RUNTIME_READINESS_AUDIT.md`

Prepared commit:

`ca2a1dcb5e14f63350456a33097362cc34cf7b86`

Use this to answer:

> What exactly prevents the current PostgreSQL product from physically running Jordan S2?

The audit is a snapshot and must be revalidated against the final R4 SHA.

Proof wording must remain precise:

- Sarah's physical product proof is the programme-side recovery path;
- Atlas external transport execution has separate real sandbox/focused evidence;
- do not conflate those into a claim that Sarah physically executed an external flight purchase through the browser unless final R4 evidence actually proves that.

### Execution reliability reference

`docs/work/ASTRA_EXECUTION_RELIABILITY_PLAN.md`

This is a **reference framework, not an implementation recipe**.

It defines stop-safe checkpoints, testing discipline, model/delegation economics and handoff expectations while leaving Astra free to choose the actual lane decomposition.

---

## 5. Product objective — frontend

Frontend is a co-equal product requirement.

The minimum standard is the last normal pre-refactor frontend at:

`20454aa7f16e18cf07eb1558481637f8a18f2d09`

The accepted intentional differences are:

- PostgreSQL/current read models replace legacy runtime/state ownership;
- V5.6 replaces/adapts the old Case journey causal visual;
- V7.2 becomes the accepted Event Overview visual;
- newer interaction improvements such as graph-state-preserving polling may remain.

Everything else requires a product justification before being materially worse.

"Parity" does not mean the same HTML or the same exact layout.

It means the operator/traveller can answer and act on the equivalent user job with at least comparable clarity.

At minimum preserve or improve:

- shell/navigation;
- whole-population Overview;
- attention without losing population context;
- Case explanation/recommendation/authority/execution/resolution;
- Programme;
- Decisions;
- Activity;
- Traveller;
- loading/error/empty states;
- product-language boundary;
- progressive disclosure;
- useful authority/funding context;
- truthful execution progress.

### Current demo adaptation that remains mandatory

The persistent **Reset Demo** affordance remains required in the current operator product until the founder explicitly removes it.

It is not required because legacy parity contained it. It remains because current founder/demo acceptance explicitly requires it.

---

## 6. Product objective — V5.6 Case Graph

V5.6 exists to explain the current trip causally:

> who/what changed -> what supplier already did -> what downstream dependency changed -> where the trip first became operationally disrupted -> what remains healthy.

It is not:

- a workflow graph;
- a planner graph;
- a provider/tool graph;
- a raw database graph;
- an execution-state graph.

Binding principles:

- backend/read models own semantic truth and causality;
- renderer owns geometry, camera, pulse and selection;
- first operational breakpoint comes from authoritative causal/evaluation truth;
- whole relevant trip remains understandable;
- healthy context remains visible;
- Current is live truth;
- Original is immutable first truthful failing semantic snapshot;
- green normal pulse / amber slower / red no pulse are frontend animation only;
- no browser viability/causality inference;
- no scenario-specific layout branches.

If accepted V5.6 requires an arrival/timing or trip-purpose presentation that current projection cannot express, first determine whether existing ontology/current state already contains the source fact and extend the projection/read-model accordingly.

Do not create new domain entities merely because the prototype has a visual card.

---

## 7. Product objective — V7.2 Event Overview

V7.2 exists to answer:

> Is the travelling population broadly okay, where did something change, how wide is the current impact, and where should operator attention go?

It is a bounded current-world projection, not the entire NORTHSTAR graph.

Binding principles:

- full population/programme context remains present;
- attention is layered onto the wider world rather than replacing it;
- meaningful shared dependencies are backend-selected;
- promoted affected travellers remain visible;
- programme hierarchy remains readable;
- compact mode stays near screen scale rather than shrinking a giant canvas;
- expanded mode uses the same underlying semantic projection;
- relation/node condition is backend/read-model truth;
- camera/selection/expanded state survive compatible refreshes;
- no browser inference of blast radius or consequence;
- no capability-up/internal-engine copy.

The architecture must not be transport-only.

Meaningful shared dependencies may include transport, hotel block, transfer or other shared operational dependencies when current authoritative state makes them relevant.

That is a projection generality requirement, not a mandate to implement all provider transaction capabilities.

---

## 8. Product objective — Sarah

Sarah remains the primary proof of:

> provider recovery can succeed at the booking level while the whole trip still fails.

Accepted product shape:

Reset
-> healthy Overview
-> supplier disruption/reprotection
-> Sarah becomes materially affected while others remain understandable
-> Case explains current causal truth
-> real/recorded provider evidence + real Qwen where required
-> viable strategies are deterministically validated
-> appropriate authority
-> approved action executes
-> observed canonical state updates
-> reassessment
-> case resolves only when current trip truth passes
-> Overview reflects recovered state.

Do not force an external flight purchase into the winning Sarah path if a programme-side recovery is still the correct generalized result.

Sarah must continue using the same planner/evaluator/authority/execution architecture Jordan uses.

---

## 9. Product objective — Jordan

Jordan is the generality proof.

Jordan S2 is materially different from Sarah:

- individual progressive disruption rather than shared supplier event;
- multi-stage delay;
- connection viability changes over time;
- deeper travel dependency chain;
- provider default may still fail the trip objective;
- selected recovery requires external flight execution.

Closed hero truth is the current S2 contract, not every historical Jordan aspiration.

Target product progression:

baseline ZG023/ZG053 viable
-> D1 still safe
-> D2 tight/at risk
-> onward connection becomes impossible
-> temporary same-night recovery may remain viable
-> further progression removes that option / overnight consequence is understood
-> provider/default morning option fails the finals requirement
-> NORTHSTAR finds a viable earlier alternative such as TR885 or current equivalent
-> organiser authority
-> consequential external flight recovery
-> observation/reconciliation
-> canonical trip update
-> reassessment
-> RESOLVED / VIABLE.

For the closed hero, distinguish:

### Must execute

- selected replacement flight through the current protected external action path.

### Must reason/present where relevant

- overnight consequence;
- stay consequence;
- transfer consequence;
- entry/legal uncertainty;
- insurance applicability where evidence exists.

### Not automatically required for closed hero

- Narita hotel booking;
- Singapore hotel cancel/rebook;
- insurance claim submission;
- Google Routes transaction;
- transfer redispatch transaction;
- composite multi-provider execution.

Do not turn those stretch capabilities into blockers unless current authoritative scenario truth changes.

Jordan must not create:

- a Jordan-specific planner;
- a Jordan-specific controller in domain/recovery logic;
- route/flight/name branches in application logic;
- fake precomputed viability labels.

---

## 10. Deterministic safety boundary

AI can propose, interpret and compare.

AI cannot directly cause an irreversible or money-moving provider action.

Binding chain:

`AI proposal -> validation -> deterministic viability -> authority -> executor -> observe/reconcile -> canonical state update -> reassessment`

For consequential provider execution:

- durable execution state precedes network dispatch;
- provider result is observed;
- unknown outcome is never blindly retried;
- reconciliation precedes any retry decision;
- case resolution follows current authoritative trip viability, not provider success alone.

This is architecture, not implementation preference.

---

## 11. Delegation doctrine

Astra is the primary integrator.

**DELEGATE AGGRESSIVELY WHENEVER POSSIBLE**, especially after contracts/seams are understood.

Preferred posture:

- Terra for substantial bounded engineering and difficult reversible work;
- Luna for well-defined implementation/testing/data/UI tasks;
- Astra for architecture, decomposition, integration, ambiguity, physical acceptance and checkpoint judgement;
- Sol only for a named high-risk unresolved question where another deep review materially reduces risk.

Astra chooses:

- how many lanes;
- their boundaries;
- their order;
- which model is best for each;
- whether work is parallel or sequential.

Do not create a model committee.

Do not use Sol as a generic "review everything" reflex.

---

## 12. Testing doctrine

While iterating:

> focused first.

Use the smallest test that exercises the changed behavior.

When persistence/runtime changes, use the direct relevant PostgreSQL seam.

Use physical browser/provider evidence for user-visible or external behavior.

Only broaden after focused evidence is green.

`postgres:fast` is a coherent-checkpoint gate.

CURRENT_TARGET is a major integration gate.

Full canonical PostgreSQL is milestone/final-candidate evidence.

None is a normal debugging loop.

If a broad gate fails, debug the failing test/file first rather than immediately rerunning the broad gate.

Maintain simple broad-run counters in ACTIVE_TASK.

---

## 13. Recommended stop-safe checkpoints

These are outcome boundaries, not mandatory internal implementation recipes.

### A0 — Freeze & Diagnose

Freeze final accepted R4 truth and Astra's chosen implementation decomposition.

### A1 — Product Frontend Convergence

Frontend at least legacy-quality; V5.6 and V7.2 faithfully converged.

### A2 — Sarah Product Acceptance

Sarah physically runnable on the converged product.

### A3 — Jordan Runtime Acceptance

Jordan generalized backend progression/recovery works.

### A4 — Jordan Product Acceptance

Jordan physically runnable through the actual product.

### A5 — Cross-Scenario Convergence & Final Candidate

Sarah + Jordan repeatably work; broad/static gates pass; final candidate frozen.

Astra may create finer internal checkpoints.

At every named checkpoint the founder must be able to stop and continue manually.

---

## 14. Stop-safe requirement

Every named checkpoint ends with:

- exact primary branch;
- exact pushed SHA;
- clean tree or explicitly documented dirty paths;
- unfinished lane branches/head SHAs;
- focused/browser/provider evidence already valid;
- broad-gate counters;
- issue triage;
- one exact next action.

Do not leave substantial verified work only in an unpushed cloud worktree.

---

## 15. Issue discipline

Every issue/risk is classified:

- **Act Now**
- **Investigate Now**
- **Park for Later**
- **Ignore / Accept Risk**

Astra must decide what happens to each.

Do not merely list unresolved concerns.

A previously parked issue is reconsidered if it becomes a blocker for Sarah/Jordan acceptance.

---

## 16. Important prepared findings to revalidate at A0

These are not blindly frozen because R4 may have advanced.

### Frontend

The legacy audit found current parity contracts under-specified parts of:

- shared-incident Overview behavior;
- complete Case lifecycle/product density;
- Programme change/intake behavior;
- recent Decisions history;
- Activity sanitization/pagination;
- Traveller mobile concierge flow;
- operator/traveller shell separation.

Use the detailed legacy report before declaring A1 parity.

### V5.6

The graph audit found possible/current gaps including:

- workflow/recovery-case node leaking into visual projection;
- missing meaningful timing breakpoint presentation;
- incomplete objective/purpose projection;
- frontend inference of missing edge state;
- Disruption Path framing;
- programme-consequence semantics;
- physical readability/camera verification.

Recheck against final R4 before implementing.

### V7.2

The graph audit found possible/current gaps including:

- frontend synthesis of relation condition;
- narrow dependency semantics;
- commitment consequence inferred too broadly;
- no-programme population handling;
- compact-mode scale/readability;
- long-programme/dependency-set scaling;
- capability-up copy.

Recheck against final R4 before implementing.

### Jordan

The Jordan audit found the product **not currently physically runnable** at its audited SHA, primarily because of:

- no product-operated progressive D1-D4 flow;
- connection progression not proven through current normal boot;
- reset state missing protected execution inputs/budget required for external execution;
- REPLAY evidence correctly non-executable;
- incomplete Jordan causal graph semantics;
- lack of a current PostgreSQL Jordan end-to-end acceptance.

Revalidate these against final R4.

A key recommended first Jordan proof remains:

clean current dataset
-> Jordan baseline
-> D1 remains safe
-> D2 becomes at risk
-> D3 connection impossible
-> RecoveryCase opens through generic current logic.

If that fails, fix the generalized state/dependency/evaluator path before planner/UI compensation.

---

## 17. What Astra is free to decide

Astra is explicitly free to choose:

- lane decomposition;
- file ownership;
- internal checkpoint granularity;
- exact implementation order;
- whether frontend/graph work is parallelized;
- which focused tests best match changed code;
- which Terra/Luna variant is appropriate;
- when a coherent checkpoint justifies `postgres:fast`;
- whether a fresh Astra context is helpful;
- implementation details not frozen by architecture/product contracts.

This charter defines **what success means and what must not be violated**, not how every line should be written.

---

## 18. A0 first actions

At launch:

1. fetch/inspect final accepted R4;
2. record exact launch SHA;
3. inspect current code/schema/docs/recent commits;
4. integrate/read the prepared A/B/C/D documents;
5. distinguish findings still current from findings R4 already closed;
6. inspect physical/current product where useful;
7. freeze a concise implementation plan and safe lanes;
8. initialize compact ACTIVE_TASK;
9. push A0;
10. begin product work.

Do not spend A0 repeating archaeology already captured in the prepared reports unless final R4 materially changed the relevant seam.

---

## 19. Terminal acceptance

Astra's convergence run is complete only when:

- frontend meets or exceeds the legacy product floor except explicit justified adaptations;
- V5.6 matches accepted visual/semantic behavior;
- V7.2 matches accepted visual/semantic behavior;
- Sarah physically runs through the product;
- Jordan physically runs through the product;
- both use the same generalized recovery architecture;
- consequential execution remains safely gated and truthfully reconciled;
- PostgreSQL remains normal runtime truth;
- demo facts remain outside generic domain/application logic;
- appropriate focused/static/broad gates are green on the final candidate;
- docs match what the product actually does;
- final candidate SHA is pushed and reproducible.

---

**ASTRA CONVERGENCE CHARTER READY**
