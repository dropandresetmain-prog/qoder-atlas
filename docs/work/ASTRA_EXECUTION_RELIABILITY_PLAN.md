# NORTHSTAR — Astra Execution-Reliability Plan

**Planning date:** 20 September 2026  
**Repository:** `dropandresetmain-prog/qoder-atlas`  
**Execution-plan branch base:** `integration/r4-final-acceptance` @ `462ea5e1d307ac806b1a3388baefa305a52e09c4`  
**Initial audit snapshot:** `integration/r4-final-acceptance` @ `795f49e6a4a4efe6adb4f5e56a60c02a58ba089f`  
**Execution primary:** GPT-6 Astra High  
**Normal delegated executor:** GPT-5.6 Terra High/Medium  
**Defined bounded executor:** GPT-5.6 Luna High/xHigh  
**Critical escalation only:** GPT-5.6 Sol High

## Current R4 launch context

The active R4 branch advanced after the initial planning audit. At the branch base used for this document:

- Sarah's physical PROGRAMME recovery path is proven green through the product.
- Original/Current toggle is physically proven.
- Case graph camera stability across polling is physically proven.
- Atlas transport sandbox execution remains physically proven through durable attempt, reconciliation and observed success.
- `postgres:fast` has run once: 533 pass / 2 fail; both failures were debugged and fixed with focused evidence. Do not use another fast run as a debugging loop.
- CURRENT_TARGET has not yet run on this R4 acceptance continuation.
- full canonical PostgreSQL has not yet run on this R4 acceptance continuation.
- R4 therefore remains a moving acceptance branch until its final acceptance result and exact accepted SHA are recorded.

Astra must launch from the **final accepted R4 SHA**, not blindly from the base SHA of this document if R4 advances again.

---

# 1. Execution architecture

The recommended stoppable sequence is:

**A0 Launch Freeze  
→ A1 Frontend Parity Foundation  
→ A2 Case + V5.6  
→ A3 Overview + V7.2  
→ A4 Sarah Physical Acceptance  
→ A5 Jordan Backend Acceptance  
→ A6 Jordan Product Acceptance  
→ A7 Cross-scenario Product Convergence  
→ A8 Final Candidate**

These are real stopping points, not cosmetic milestone labels.

At every accepted checkpoint, the founder must be able to stop Astra permanently and continue manually or hand the repository to another agent using only:

- the pushed checkpoint SHA;
- the reconciled `docs/work/ACTIVE_TASK.md`;
- the exact unfinished lane branches;
- the exact evidence already run;
- the exact next action.

Every implementation lane branches from the **previous accepted checkpoint SHA**, never from another unfinished lane.

Recommended primary branch:

`integration/astra-post-r4`

Recommended lane naming:

- `astra/a1-shell-parity`
- `astra/a1-product-surfaces`
- `astra/a2-case-graph`
- `astra/a3-overview-graph`
- `astra/a5-jordan-runtime`
- `astra/a5-jordan-execution`

A lane may contain multiple coherent commits. The primary integration branch receives only committed, pushed, verified lane heads.

---

# A0 — Launch Freeze

## GOAL

Establish an immutable post-R4 starting point and convert the current repository state into an Astra-executable contract.

A0 exists to prevent Astra from spending its first implementation cycle discovering that the base moved, R4 was never actually accepted, or parallel lanes implemented against different semantics.

## IN-SCOPE

- Fetch latest `integration/r4-final-acceptance`.
- Verify the final accepted R4 SHA and acceptance result.
- Verify branch ancestry and remote/local agreement.
- Inspect clean/dirty state and outstanding worktrees.
- Reconcile `ACTIVE_TASK.md` into the Astra ledger format in this document.
- Reconfirm:
  - PostgreSQL-only normal runtime;
  - R4 frontend parity contract;
  - V5.6 Case graph contract;
  - V7.2 Overview graph contract;
  - frontend semantic contract;
  - R2 focused-graph contract;
  - interaction/polling contract;
  - Sarah accepted state;
  - current Jordan runtime gaps;
  - current test manifests and canonical commands.
- Freeze lane ownership and integration order.
- Record provider/model capability and provenance truth.
- Record starting broad-gate counters.

## OUT-OF-SCOPE

- Product code.
- CSS.
- New graph implementation.
- Jordan implementation.
- Schema changes.
- Provider calls merely to "see what happens."

## SHARED CONTRACTS FROZEN BEFORE WRITES

A0 itself is the freeze.

At minimum record exact versions of:

- accepted R4 SHA;
- `docs/work/R4_FRONTEND_PARITY_CONTRACT.md`;
- `docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md`;
- `docs/FRONTEND_SEMANTIC_CONTRACT.md`;
- `docs/design/live-dependency-graph/README.md` + accepted v5.6 prototype;
- `docs/design/event-overview-graph/README.md` + accepted v7.2 prototype;
- `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md`;
- current B2/Jordan scope in `docs/IMPLEMENTATION_PLAN.md`;
- S1/S2 truth in `docs/SCENARIOS.md`;
- `docs/TESTING.md`;
- `test/suites.json`.

**Hard rule:** if R4 finishes at a SHA later than the base of this document, Astra uses the accepted final SHA.

## SAFE PARALLEL LANES

Read-only only:

- Terra: current frontend/runtime gap inventory.
- Terra: Jordan runtime reachability inventory.
- Luna: test map and affected focused tests.
- Luna: branch/worktree/stale-doc inventory.

No writes until Astra reconciles those findings.

## ASTRA-OWNED WORK

- Decide whether R4 is actually a valid launch base.
- Resolve contradictory docs.
- Freeze contracts.
- Classify every inherited issue.
- Define exact lanes and collision map.
- Create and push the A0 checkpoint.

## TERRA DELEGATION

Read-only cross-file investigations where the answer affects later lane scope.

## LUNA DELEGATION

Mechanical inventories:

- tests;
- provider recordings;
- UI routes;
- candidate changed paths;
- legacy-vs-current surface matrix.

## SOL ALLOWED?

**No.**

A0 contains no unresolved irreversible decision.

## FOCUSED TESTS

Normally none beyond static contract/boundary checks needed to validate the freeze.

If R4 claims accepted but its recorded evidence is internally contradictory, rerun only the smallest disputed check.

## BROWSER/PROVIDER EVIDENCE

Reuse valid R4 evidence. Do not repeat LIVE calls as ceremony.

## BROAD GATE

None.

A0 records accepted R4 evidence rather than consuming a new broad gate.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Commit and push:

- Astra `ACTIVE_TASK.md`;
- any A0 freeze/handoff doc required;
- no product code.

Record exact A0 SHA.

## STOP-SAFE HANDOFF CONTENT

- accepted R4 base SHA;
- A0 SHA;
- frozen contract paths;
- unresolved issue triage;
- all lane names/bases/owners;
- test counters;
- exact next action: A1.

## ACCEPTANCE CRITERIA

A0 passes only when:

- R4 is explicitly accepted, not merely "mostly working";
- accepted R4 SHA is immutable and pushed;
- primary working tree is clean;
- no hidden uncommitted lane is required to reproduce R4;
- normal runtime remains PostgreSQL-only;
- shared frontend/graph contracts are frozen;
- Jordan scope is explicitly the current S2 closed hero, not an older broader multi-provider aspiration;
- every inherited issue has a disposition.

If R4 is not accepted, A0 must not paper over it. Finish R4 or explicitly re-scope Astra to take over R4 completion.

## NEXT CHECKPOINT

A1 — Frontend Parity Foundation.

---

# A1 — Frontend Parity Foundation

## GOAL

Restore the non-graph product foundation to at least the pre-refactor quality baseline at legacy SHA:

`20454aa7f16e18cf07eb1558481637f8a18f2d09`

This checkpoint deliberately separates general frontend regression repair from graph fidelity.

## IN-SCOPE

- shell/navigation;
- clean product URLs;
- back navigation;
- loading/error states;
- reset control;
- delegated actions;
- region polling;
- page-state preservation;
- Overview population + Needs Attention together;
- roster/search/pagination where frozen by R4;
- Case information architecture around the graph;
- recommendation hierarchy;
- approving/cost/funding presentation;
- Programme;
- Decisions;
- Activity;
- Traveller;
- plain-language copy;
- user-visible UUID/enum/provider-jargon removal;
- links between surfaces;
- responsive density and obvious interaction affordances.

## OUT-OF-SCOPE

- V5.6 pixel/interaction fidelity beyond preserving its container.
- V7.2 fidelity beyond preserving its container.
- Jordan runtime changes.
- recovery-engine changes.
- new backend states invented to satisfy old UI.

## SHARED CONTRACTS FROZEN BEFORE WRITES

Freeze:

- page/shell navigation contract;
- polling-region contract;
- delegated-action contract;
- copy/jargon boundary;
- legacy capability mapping:
  `PRESERVE | ADAPT_TO_GRAPH | IMPROVE | INTENTIONALLY_RETIRE`;
- graph container lifecycle contract so A1 cannot later break A2/A3 camera state.

## SAFE PARALLEL LANES

After Astra freezes ownership:

### Lane A1-Shell — Luna High

Own:

- shell;
- navigation;
- routes;
- reset;
- generic loading/error states.

### Lane A1-Surfaces — Terra Medium/High

Own:

- Programme;
- Decisions;
- Activity;
- Traveller;
- Overview roster/population.

### Lane A1-Case-IA — Terra High

Own the non-graph Case sections and recommendation/approval hierarchy.

### Lane A1-Copy/Tests — Luna High

Own:

- jargon gate;
- copy cleanup;
- legacy-parity browser assertions.

Avoid multiple agents editing shared shell/poller files or the same product renderer.

## ASTRA-OWNED WORK

- define parity acceptance matrix;
- decide intentional differences from legacy;
- resolve shared shell/polling collisions;
- integrate lanes;
- browser acceptance across the product.

## TERRA DELEGATION

Cross-file page adapters and complex surface restoration.

## LUNA DELEGATION

Defined UI ports, copy, specific components, browser assertions and mechanical tests.

## SOL ALLOWED?

**No.**

Frontend parity is reversible product work.

## FOCUSED TESTS

Use the smallest relevant files, including where applicable:

- shell runtime;
- UI language;
- Overview hit targets;
- polling swaps;
- Programme UI;
- semantic contract;
- Case workspace;
- any newly added page-specific tests.

## BROWSER/PROVIDER EVIDENCE

Physical browser:

- Overview;
- Case;
- Programme;
- Decisions;
- Activity;
- Traveller;
- back navigation;
- reset;
- poll preserving open disclosure/scroll/controls.

Provider execution is unnecessary here.

## BROAD GATE

Normally none.

If A1 changes shared read-model adapters extensively, CURRENT_TARGET may run once at checkpoint integration. Otherwise save broad budget for A3.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Each lane commits + pushes before integration.

Astra then:

- inspects lane diff/evidence;
- integrates;
- runs seam checks;
- commits `checkpoint(A1): frontend parity foundation`;
- pushes exact SHA.

## STOP-SAFE HANDOFF CONTENT

Include:

- parity matrix;
- accepted intentional deviations from legacy;
- browser evidence;
- lane branch heads;
- exact focused tests;
- unresolved UI debt;
- A1 SHA;
- next action A2.

## ACCEPTANCE CRITERIA

- no non-graph regression below the frozen legacy minimum without explicit retirement;
- all product surfaces navigate coherently;
- user copy is product language rather than backend language;
- polling/actions survive repeated updates;
- no SQLite/runtime resurrection;
- no UI state determines backend truth;
- browser evidence exists on the pushed A1 SHA.

## NEXT CHECKPOINT

A2 — Case + V5.6.

---

# A2 — Case + V5.6

## GOAL

Make the production Case graph a faithful implementation of accepted V5.6 using current authoritative read-model truth.

## IN-SCOPE

- production Case graph projection;
- backend-supplied focused causal path;
- honest unmapped causal steps;
- first-breakpoint emphasis;
- Current/Original;
- semantic condition rendering;
- frontend-only pulse;
- pan/zoom/home;
- named views;
- semantic zoom;
- programme context;
- objective context where supplied;
- selection neighbourhood;
- responsive geometry;
- all-clear transition;
- poll survival;
- camera/view/selection preservation.

## OUT-OF-SCOPE

- workflow graph;
- strategy nodes;
- tool-call nodes;
- execution-attempt nodes;
- frontend causality inference;
- frontend viability inference;
- proposed recovery overlaid into the current-world graph;
- backend `pulseSpeed`, `isLive`, or equivalents;
- scenario-specific layout branches.

## SHARED CONTRACTS FROZEN BEFORE WRITES

Astra explicitly freezes:

### Truth ownership

`authoritative Case projection -> semantic adapter -> V5.6 renderer`

### Causality

Backend `focusedGraph/causalPath` only.

### Pulse

Green normal / amber slower / red none, frontend animation only.

### Current

Always regenerated from current authoritative state.

### Original

Immutable disruption snapshot.

### CHECKING

Presentation of existing reassessment lifecycle; not a new semantic verdict.

### Geometry

Renderer-owned. Business state cannot live in coordinates.

## SAFE PARALLEL LANES

### A2-PROJECTION — Terra High

Inspect/fix focused graph projection only if actual contract gaps exist.

### A2-RENDERER — Terra High

Graph integration and generic geometry/interaction.

### A2-VISUAL — Luna xHigh

Well-defined V5.6 fidelity port once renderer contract freezes.

### A2-TESTS — Luna High

Projection semantics, camera retention, semantic zoom, Original/Current, and no invented causality.

Astra prevents Projection and Renderer lanes from independently changing the DTO.

## ASTRA-OWNED WORK

- projection contract;
- architecture-gap decisions;
- cross-lane integration;
- semantic truth audit;
- final physical comparison to V5.6.

## TERRA DELEGATION

Projection/runtime integration and hard graph behavior.

## LUNA DELEGATION

Fidelity implementation, targeted components and interaction tests.

## SOL ALLOWED?

**No**, unless graph work unexpectedly reveals that the accepted read model cannot represent a critical authority/execution fact.

Normal graph implementation never justifies Sol.

## FOCUSED TESTS

At minimum cover:

- focused Case projection;
- focused graph projection;
- renderer;
- causal spine;
- workspace integration;
- semantic contract;
- polling;
- Original snapshot;
- relevant focused PostgreSQL Case graph seams.

## BROWSER/PROVIDER EVIDENCE

Physical Case browser state for:

- healthy;
- disruption;
- CHECKING;
- settled failure;
- Current/Original;
- recovery to healthy;
- camera preserved across polling;
- click selection;
- home/reset;
- semantic zoom.

Provider calls are unnecessary merely for visual proof; recorded/current runtime state is sufficient.

## BROAD GATE

Run `npm run test:postgres:fast` once after A2 is coherent if projection/backend integration changed.

Do not rerun the fast suite while debugging.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Pushed lane heads first, then one integrated A2 checkpoint SHA.

## STOP-SAFE HANDOFF CONTENT

- V5.6 contract compliance matrix;
- any honest projection gaps;
- screenshots/browser assertions;
- focused PG evidence;
- `postgres:fast` counter/result if run;
- exact A2 SHA;
- unfinished lane branches;
- A3 next action.

## ACCEPTANCE CRITERIA

- V5.6 is recognizably the accepted product, not merely a graph carrying similar data;
- current semantic truth is backend-owned;
- first breakpoint is authoritative;
- Current/Original work;
- healthy recovery genuinely removes failed visual state;
- polling does not reset the user's graph context;
- no fixture/person/route/provider branching exists in generic renderer;
- focused anti-hardcoding evidence passes.

## NEXT CHECKPOINT

A3 — Overview + V7.2.

---

# A3 — Overview + V7.2

## GOAL

Wire accepted V7.2 as a bounded operational projection rather than a mini-Case graph or frontend-inferred world model.

## IN-SCOPE

- bounded Event Overview projection;
- programme spine;
- dynamic day territories;
- major commitments;
- meaningful shared dependencies;
- population/cohorts;
- promoted exceptions;
- blast-radius membership supplied by backend;
- CHECKING/cleared/unresolved treatment;
- pulses;
- compact/expanded;
- semantic zoom;
- generic selection;
- active incident footprint framing;
- Case navigation;
- preserve normal Overview roster and attention list around/below the graph.

## OUT-OF-SCOPE

- raw entire domain graph;
- every programme item;
- every traveller as a full-size card;
- frontend blast-radius computation;
- frontend programme-impact computation;
- duplicate V5.6 causal chain;
- replay/history engine;
- force-directed layout.

## SHARED CONTRACTS FROZEN BEFORE WRITES

Freeze:

`authoritative PG state -> bounded Event Overview projection -> semantic adapter -> V7.2 renderer`

Backend owns:

- membership;
- identity;
- relation truth;
- health;
- current change;
- blast radius;
- attention.

Renderer owns:

- layout;
- geometry;
- semantic zoom;
- motion;
- selection;
- compact/expanded presentation.

## SAFE PARALLEL LANES

### A3-PROJECTION — Terra High

Projection and PG seam.

### A3-RENDERER — Terra High

Stable programme-spine integration.

### A3-FIDELITY — Luna xHigh

Accepted V7.2 visual/interaction port after projection shape freezes.

### A3-BROWSER-TEST — Luna High

Compact/expanded, clickability, overlap, Day labels, selection and focus framing.

## ASTRA-OWNED WORK

- decide exact bounded projection contract;
- prevent browser inference;
- resolve shared renderer/polling conflicts;
- integrate;
- compare physically against V7.2.

## TERRA DELEGATION

Projection and generic graph runtime integration.

## LUNA DELEGATION

UI fidelity and defined assertions.

## SOL ALLOWED?

**No.**

## FOCUSED TESTS

At minimum:

- Event Overview projection;
- Overview population lifecycle;
- polling swap;
- Overview hit targets;
- semantic contract;
- relevant focused PG `eventOverview` seam;
- generic alternate fixture/no-three-day assumption proof.

## BROWSER/PROVIDER EVIDENCE

Browser must prove:

- healthy world is not blank;
- all programme territories are readable;
- affected traveller promotion;
- cleared traveller fades;
- unresolved traveller remains prominent;
- disruption camera shows the whole active incident footprint;
- every eligible visible entity is clickable;
- compact mode remains readable;
- expanded mode preserves the same identities/state;
- Case navigation works.

## BROAD GATE

Run CURRENT_TARGET once after combined A2+A3 frontend/semantic integration.

If A3 materially alters PostgreSQL read models after A2's fast gate, one coherent `postgres:fast` is also justified.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Push integrated A3 SHA.

## STOP-SAFE HANDOFF CONTENT

- V7.2 compliance matrix;
- browser evidence;
- projection limitations;
- exact tests;
- broad-gate counters;
- A3 SHA;
- next action A4.

## ACCEPTANCE CRITERIA

- V7.2 operates as Overview, not Entire Graph or Case Graph;
- unaffected population remains visible;
- active incident footprint is comprehensible;
- compact mode is genuinely readable;
- backend supplies blast radius/attention;
- clicking unresolved traveller routes to Case;
- no scenario-specific rendering branch;
- A1 frontend parity remains intact.

## NEXT CHECKPOINT

A4 — Sarah Physical Acceptance.

---

# A4 — Sarah Physical Acceptance

## GOAL

Prove Sarah can be run by a person, from reset through disruption and recovery, on the actual post-A3 product.

This is not another unit-test milestone.

## IN-SCOPE

Physical S1/S3 path:

`reset
-> baseline
-> provider/source disruption
-> 5-person blast radius
-> Sarah fails while others remain viable
-> Case opens
-> evidence/planning
-> recommendation
-> organiser approval
-> programme action
-> observation
-> reassessment
-> Sarah PASS
-> Case RESOLVED
-> Overview healthy/cleared`

Also verify:

- V5.6 Original remains disrupted.
- V5.6 Current becomes healthy.
- V7.2 reflects population correctly.
- Qwen provenance is truthful.
- Atlas research provenance is truthful.
- blocked costed options cannot outrank executable programme recovery.
- polling/camera/toggles work throughout.

## OUT-OF-SCOPE

- making Sarah rely on a transport purchase merely to prove Atlas transactions;
- Jordan;
- adding missing demo identities/budgets unless the accepted Sarah path genuinely requires them;
- broad visual redesign.

## SHARED CONTRACTS FROZEN BEFORE WRITES

A4 begins with no intended product writes.

Any defect found is classified and repaired as a targeted A4 fix against existing contracts.

## SAFE PARALLEL LANES

No implementation fan-out during the primary physical run.

After a concrete defect:

- Terra: hard cross-layer runtime defect.
- Luna: bounded UI/browser defect or assertion.

Only one agent owns a given failure.

## ASTRA-OWNED WORK

- drive physical acceptance;
- determine root-cause layer;
- judge whether failure blocks Sarah;
- integrate any targeted fix;
- repeat only affected steps.

## TERRA DELEGATION

Hard runtime failures such as planning persistence, serialization or incorrect progression.

## LUNA DELEGATION

Selectors, copy, UI-state retention and focused browser regressions.

## SOL ALLOWED?

**No**, unless physical Sarah uncovers a defect in the irreversible Atlas transaction/authority/unknown-outcome boundary rather than the programme path.

## FOCUSED TESTS

For any defect: failing focused test first, then adjacent seam.

No blanket rerun merely because a browser run failed.

## BROWSER/PROVIDER EVIDENCE

Mandatory.

Record:

- exact commit SHA;
- reset state;
- source/provenance mode;
- Qwen mode;
- Atlas mode;
- key HTTP/action outcomes;
- final Case state;
- final Trip state;
- screenshots or concise run log.

A repeatable RECORD/REPLAY path should remain available even if LIVE evidence is used.

## BROAD GATE

None by default if A4 changes no code.

If A4 fixes production code after A3, run only the checkpoint gate justified by the changed scope.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Even a no-code A4 acceptance should leave a pushed evidence/docs checkpoint so the physically accepted SHA is unambiguous.

## STOP-SAFE HANDOFF CONTENT

- exact physical run recipe;
- exact successful SHA;
- evidence/provenance;
- remaining Sarah limitations;
- test counters;
- next action A5.

## ACCEPTANCE CRITERIA

A founder can physically run Sarah without manual DB surgery or hidden agent intervention beyond documented reset/trigger actions.

A4 fails if success depends on:

- manually changing internal canonical state in SQL;
- hardcoded Sarah logic;
- frontend-invented viability;
- fake provider/model success;
- stale pre-A4 screenshots.

## NEXT CHECKPOINT

A5 — Jordan Backend Acceptance.

---

# A5 — Jordan Backend Acceptance

## GOAL

Close the **current S2 closed-hero backend path** on the same generalized recovery architecture before attempting the product/browser demo.

This is the highest-risk checkpoint.

## CURRENT CONTRACT TO FREEZE

Jordan's accepted closed hero is:

- progressive delay / connection loss;
- overnight context becomes relevant;
- provider-default recovery TR867 is not viable;
- NORTHSTAR candidate TR885 is viable;
- organiser authority;
- **flight recovery execution only**;
- provider observation;
- canonical update;
- reassessment;
- resolution.

Do not accidentally reactivate the historical broader requirement that one demo transaction must also book a Narita hotel, cancel the Singapore hotel, submit insurance and solve immigration.

Those may remain contextual/read evidence. Composite multi-provider execution remains deferred unless product truth is deliberately changed.

## IN-SCOPE

- progressive delay ingress;
- same RecoveryCase lifecycle;
- provider-neutral Atlas research;
- strategy generation;
- real RC-6 viability;
- TR867 rejection for insufficient readiness;
- TR885 viable candidate;
- current authority policy;
- protected booking/execution inputs;
- ActionIntent/ActionPlan;
- existing external offer-select execution boundary;
- durable attempt before network;
- provider order/checkpoint persistence;
- lost-response handling;
- read-only reconciliation;
- no blind duplicate;
- observation;
- canonical provider-owned state;
- reassessment;
- resolution or continued recovery.

## OUT-OF-SCOPE

- Jordan-specific planner;
- Jordan-specific graph;
- Jordan-only lifecycle enums;
- direct LLM provider execution;
- mandatory hotel execution;
- mandatory insurance submission;
- fabricated immigration result;
- provider-specific logic outside the adapter boundary.

## SHARED CONTRACTS FROZEN BEFORE WRITES

Astra freezes:

1. S2 closed-hero choreography.
2. external ActionIntent shape.
3. durable attempt semantics.
4. authority/spend semantics.
5. provider execution contract.
6. OUTCOME_UNKNOWN semantics.
7. reconciliation-before-retry rule.
8. observation/canonical update semantics.
9. continued-recovery semantics.
10. provider-mode truthfulness.

Before changing any shared schema, Astra must prove the existing contracts cannot express the requirement.

## SAFE PARALLEL LANES

After the B2/Jordan contract freeze:

### A5-J1 Runtime Reachability — Terra High

- progressive ingress through normal boot;
- exact current gaps.

### A5-J2 Provider/Execution — Terra High

- provider-neutral execution composition;
- only after Astra freezes irreversible boundaries.

### A5-J3 Fixtures/Evidence — Luna xHigh

- Jordan source fixtures;
- provider-shaped recordings;
- deterministic replay wiring.

### A5-J4 Acceptance Tests — Luna xHigh

- focused behavior-first tests written against the frozen contract.

Astra alone owns shared authority/execution contracts and merges J2.

## ASTRA-OWNED WORK

- architecture;
- external side-effect boundary;
- authority;
- money ceiling semantics;
- idempotency interpretation;
- unknown outcomes;
- reconciliation;
- integration;
- checkpoint judgment.

## TERRA DELEGATION

Default for Jordan cross-file backend/runtime work and hard debugging.

## LUNA DELEGATION

Fixtures, recordings, test implementation and adapter mapping only after interface freeze.

## SOL ALLOWED?

**Yes — only under a named trigger.**

Use one Sol High run if and only if one of these becomes unresolved:

- authority semantics must change;
- payment/spend ceiling semantics must change;
- Atlas consequential execution creates a new money-moving boundary;
- provider timeout semantics make safe retry ambiguous;
- unknown-outcome reconciliation cannot be proven from the current architecture;
- migration/data integrity would be changed;
- Astra requests one focused independent Critical review after the complete changed execution seam exists.

If A5 simply composes and proves the existing R4 execution boundary without changing those semantics, use **no Sol**.

Never use Sol for ordinary Jordan fixtures, adapter plumbing or routine tests.

## FOCUSED TESTS

Required families include:

- current Jordan compatibility;
- connection progression;
- replacement-flight viability;
- same coordinator;
- external attempt before provider call;
- crash recovery;
- orderRef checkpoint;
- timeout/lost response;
- no retry without reconciliation;
- duplicate-attempt prevention;
- provider success != resolved;
- post-observation reassessment;
- current authority/spend guard;
- Atlas REPLAY normalization parity.

Run direct PG files one at a time while debugging.

## BROWSER/PROVIDER EVIDENCE

Backend checkpoint still needs provider evidence:

- exact Jordan Atlas search/offer provider-shaped data;
- RECORD/REPLAY normalization parity;
- sandbox consequential path when safely supported and authorized;
- otherwise sanitized existing sandbox evidence plus deterministic REPLAY of the same normalized path.

Never claim LIVE if REPLAY ran.

## BROAD GATE

Run `npm run test:postgres:fast` once after the complete backend seam is coherent.

Run full canonical PostgreSQL here only if A5 materially changed shared persistence/authority/execution infrastructure and Astra judges that waiting until A8 leaves too much regression risk.

Otherwise reserve full canonical PG for A8.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

A5 is not accepted with substantial verified work sitting only in a Terra branch.

Required:

- all integrated work committed;
- focused evidence green;
- provider evidence recorded/sanitized;
- primary branch clean;
- checkpoint commit pushed.

## STOP-SAFE HANDOFF CONTENT

Especially detailed:

- exact provider modes;
- what actually executes;
- what remains contextual/deferred;
- authority path;
- attempt/reconciliation path;
- relevant ActionPlan shape;
- focused tests;
- provider evidence;
- Sol review result if triggered;
- A5 SHA;
- next action A6.

## ACCEPTANCE CRITERIA

The current backend can run S2 through:

`change -> assessment -> planning -> evidence -> deterministic viability -> authority -> external execution -> observation -> canonical update -> reassessment -> resolve/continue`

with no Jordan branch in generalized engine logic.

TR867 vs TR885 must be decided by current deterministic facts, not fixture labels.

No blind retry is possible after an ambiguous consequential call.

## NEXT CHECKPOINT

A6 — Jordan Product Acceptance.

---

# A6 — Jordan Product Acceptance

## GOAL

Make Jordan physically runnable through the same actual product used for Sarah.

## IN-SCOPE

Physical progression:

`initial viable
-> delay 1
-> delay 2 / tight
-> onward impossible
-> temporary same-night recovery
-> further delay kills same-night recovery
-> overnight context
-> morning alternatives
-> TR867 rejected
-> TR885 recommended
-> organiser approval
-> execution
-> observation
-> current trip viable
-> Case RESOLVED`

Where the existing source model uses slightly different stage-input mechanics, preserve the semantics rather than scripting button-by-button theatre.

## OUT-OF-SCOPE

- special Jordan page;
- hidden "jump to D4" canonical DB mutation;
- forcing unsupported hotel execution;
- making the graph itself a delay-state engine.

## SHARED CONTRACTS FROZEN BEFORE WRITES

No new contract is expected.

A physical defect may reopen only the smallest relevant contract under Astra ownership.

## SAFE PARALLEL LANES

Primary physical run remains Astra-owned.

Defects:

- Terra for runtime/backend.
- Luna for bounded UI/browser/test repairs.

## ASTRA-OWNED WORK

- browser run;
- state/provenance verification;
- integration;
- generalized-presentation check;
- acceptance.

## TERRA DELEGATION

Hard runtime defect fixes.

## LUNA DELEGATION

Defined product-display fixes and browser assertions.

## SOL ALLOWED?

Only if an A5 Critical seam is shown physically to be unsafe or semantically ambiguous.

No new generic Sol review.

## FOCUSED TESTS

Defect-driven.

Also ensure Jordan product assertions remain generic by exercising the same Case/Overview components.

## BROWSER/PROVIDER EVIDENCE

Mandatory.

Browser must show:

- connection state evolving without UI invention;
- relevant current change;
- whole-trip consequence;
- provider alternative evidence;
- actual deterministic rejected option;
- viable proposed recovery;
- authority requirement;
- truthful execution progression;
- reconciliation if applicable;
- final observed provider state;
- final trip viable/resolved;
- V5.6 Current/Original correctness;
- V7.2 attention/clearing behavior.

## BROAD GATE

Run CURRENT_TARGET once after Jordan product integration.

If code changes after A5 materially affect PG/runtime seams, one `postgres:fast` checkpoint is appropriate.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Push exact A6 product-accepted SHA and physical evidence.

## STOP-SAFE HANDOFF CONTENT

A human should be able to reproduce Jordan using only this handoff.

Include exact:

- startup mode;
- reset;
- stage triggers;
- expected major state transitions;
- approval action;
- provider mode;
- successful final state;
- known deferred context.

## ACCEPTANCE CRITERIA

Jordan works through the same product and engine without:

- bespoke page;
- bespoke planner;
- fixture-result hardcoding;
- manual SQL;
- hidden precomputed Case;
- false LIVE claims;
- provider success being treated as whole-trip success before reassessment.

## NEXT CHECKPOINT

A7 — Cross-scenario Product Convergence.

---

# A7 — Cross-scenario Product Convergence

## GOAL

Prove the thing built is NORTHSTAR, not two polished demos.

## IN-SCOPE

Run Sarah and Jordan against the same application build and confirm architectural reuse.

Audit:

- same coordinator;
- same strategy validation;
- same RC-6;
- same recommendation boundary;
- same authority machinery;
- same ActionPlan architecture;
- same Case projection;
- same V5.6 renderer;
- same Overview projection/renderer;
- same lifecycle;
- same PostgreSQL runtime;
- same LIVE/RECORD/REPLAY normalizers;
- scenario facts only in data/config/provider sources.

Also reconcile:

- `ROADMAP.md`;
- `CAPABILITIES_AND_LIMITATIONS.md`;
- implementation status;
- demo claims;
- deferred scope;
- README high-level truth where necessary.

## OUT-OF-SCOPE

- new hero scenarios;
- stretch features;
- UI redesign;
- new provider families unless they block the two accepted scenarios.

## SHARED CONTRACTS FROZEN BEFORE WRITES

No architecture change is expected.

Any discovered architectural split is an **Act Now** finding, not "demo polish."

## SAFE PARALLEL LANES

- Generality audit — Terra High, read-only first.
- Anti-hardcoding/test audit — Luna High.
- Docs reconciliation — Luna High.

Astra owns any required product fix and the final convergence judgment.

## ASTRA-OWNED WORK

- architectural comparison of Sarah and Jordan paths;
- resolution of cross-scenario divergence;
- final generalized-product judgment.

## TERRA DELEGATION

Cross-file generality/architecture investigation and hard fixes if required.

## LUNA DELEGATION

Anti-hardcoding tests, alternate fixtures and docs.

## SOL ALLOWED?

Normally **no**.

One focused Sol review is allowed only if A7 reveals a remaining Critical authority/execution ambiguity that escaped A5.

## FOCUSED TESTS

- coordinator generality;
- alternate data;
- anti-hardcoding;
- S1 and S2 target acceptance;
- external-boundary regressions;
- V5.6 and V7.2 with materially different shapes/populations.

## BROWSER/PROVIDER EVIDENCE

Short repeatable Sarah and Jordan rehearsals on the same SHA.

No need to re-spend LIVE provider calls if accepted recordings provide equivalent normalized semantics.

## BROAD GATE

Recommended:

- `npm run test:postgres:fast` once;
- CURRENT_TARGET once.

Do not run full canonical PG merely to mark A7 complete if A8 immediately follows.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Push exact A7 converged candidate-prep SHA.

After this checkpoint, feature work is frozen.

## STOP-SAFE HANDOFF CONTENT

- generalized architecture evidence;
- Sarah evidence;
- Jordan evidence;
- anti-hardcoding result;
- known deferred/stretch items;
- all broad-gate counters;
- exact A7 SHA;
- exact final-candidate commands for A8.

## ACCEPTANCE CRITERIA

- Sarah and Jordan use the same generalized engine;
- provider-specific behavior remains adapter-bound;
- no application/domain scenario branches;
- frontend remains user-down;
- both graphs remain projections;
- deferred Jordan multi-provider work is explicitly deferred rather than silently absent;
- PostgreSQL is the only normal runtime.

## NEXT CHECKPOINT

A8 — Final Candidate.

---

# A8 — Final Candidate

## GOAL

Produce the exact immutable candidate intended for demo/submission.

A8 is verification and freeze, not another feature milestone.

## IN-SCOPE

- final fixes only for acceptance blockers;
- fresh-database canonical verification;
- build/type/lint/static gates;
- provider recording/secret hygiene;
- normal boot;
- reset/reseed;
- short physical Sarah/Jordan rehearsal;
- docs/claims reconciliation;
- final pushed SHA.

## OUT-OF-SCOPE

- new features;
- opportunistic refactors;
- aesthetic tweaks unrelated to an acceptance blocker;
- provider expansion;
- infrastructure changes.

## SHARED CONTRACTS FROZEN BEFORE WRITES

Everything.

Any required contract change moves the work back to the appropriate earlier checkpoint instead of being sneaked into A8.

## SAFE PARALLEL LANES

Only read-only/static verification can parallelize safely.

Code fixes are serialized under Astra.

## ASTRA-OWNED WORK

Everything affecting the candidate SHA.

## TERRA DELEGATION

Focused diagnosis of a failing canonical test if needed.

## LUNA DELEGATION

Bounded test/doc/static fixes after Astra establishes the root cause.

## SOL ALLOWED?

Only for one unresolved Critical question blocking release, under the same strict A5 trigger family.

No ceremonial final Sol review.

## FOCUSED TESTS

If a final gate fails:

1. stop;
2. reproduce the focused failure;
3. fix;
4. focused proof;
5. only then rerun the relevant broad gate.

## BROWSER/PROVIDER EVIDENCE

On the final candidate SHA:

- normal PostgreSQL boot;
- reset/reseed;
- Sarah short rehearsal;
- Jordan short rehearsal;
- correct provider provenance;
- no secret/raw unsafe recording leakage.

## BROAD GATE

On an appropriate fresh PostgreSQL state:

- `npm test`
- `npm run test:postgres`
- `npm run test:migration`
- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm run gate:test-boundary`
- `npm run gate:anti-hardcoding`
- recording/secret scan where relevant
- normal PostgreSQL boot smoke

`npm run test:legacy` is explicitly **not** acceptance.

Full PostgreSQL runs on the exact candidate once unless an actual fix invalidates that evidence.

## CHECKPOINT COMMIT/PUSH REQUIREMENT

Before verification: candidate SHA pushed.

If verification changes anything:

- new commit;
- new SHA;
- rerun invalidated evidence plus mandatory exact-candidate final gates.

Final report names one exact pushed SHA.

## STOP-SAFE HANDOFF CONTENT

Final handoff:

- branch;
- exact SHA;
- clean status;
- canonical test evidence;
- Sarah run evidence;
- Jordan run evidence;
- provider/model provenance;
- known risks with triage;
- deferred/stretch scope;
- demo launch instructions.

## ACCEPTANCE CRITERIA

All mandatory canonical evidence is green on the exact candidate.

No unresolved **Act Now**.

No unresolved **Investigate Now** item that threatens final acceptance.

Product claims match what actually executed.

## NEXT CHECKPOINT

None. Candidate frozen.

---

# 2. ACTIVE_TASK template for Astra

Astra should replace the sprawling historical-style live ledger with a compact current operational section. Historical evidence can remain in dedicated history/handoff docs; `ACTIVE_TASK.md` should function as working memory.

```text
# ACTIVE TASK — ASTRA <Ax> <CHECKPOINT NAME>

## Identity
Repository:
Primary branch:
Worktree:
Authoritative previous checkpoint:
Current HEAD:
Remote HEAD verified:
Started:
Primary model:
Current checkpoint:

## Goal
<one paragraph>

## Acceptance criteria
- [ ] ...
- [ ] ...

## Frozen contracts
| Contract | Path / SHA | Owner | May lanes change it? |
|---|---|---|---|
| ... | ... | ASTRA | NO |

## Scope
IN:
- ...

OUT:
- ...

## Lane ledger
| Lane | Model | Branch/worktree | Base SHA | Owned paths | Do-not-touch | Dependency | State | Head | Pushed | Next |
|---|---|---|---|---|---|---|---|---|---|---|

State:
NOT_STARTED | RUNNING | BLOCKED | RETURNED | VERIFIED | INTEGRATED | ABANDONED

## Integration order
1.
2.
3.

## Integration record
| Lane | Lane SHA | Integrated SHA | Conflicts | Seam evidence |
|---|---|---|---|---|

## Focused evidence
| Scope | Exact command/action | Result | SHA | Notes |
|---|---|---|---|---|

## Physical evidence
Browser:
Provider:
Qwen:
Runtime mode:
Recording IDs / evidence refs:
Known environmental assumptions:

## Broad-gate counters
postgres:fast attempts:
CURRENT_TARGET attempts:
full canonical PG attempts:
migration attempts:

| Gate | Attempt | SHA | DB state | Why run | Result | First failing file if any | Disposition |
|---|---|---|---|---|---|---|---|

NOTE:
Counter increments on every invocation, including failures.
A rerun is never erased from history.

## Issue ledger
| Issue | Triage | Evidence | Owner | Disposition / revisit condition |
|---|---|---|---|---|

Allowed triage:
ACT NOW
INVESTIGATE NOW
PARK FOR LATER
IGNORE / ACCEPT RISK

## Provider/external truth
Capability:
Mode:
Normal-boot composed?:
Product reachable?:
Authoritative inputs available?:
Downstream consumer:
Execution allowed?:
Recorded/replay evidence:
Known limitation:

## Working-tree state
Primary:
Untracked files:
Uncommitted files:
Unfinished lane branches:
Disposable databases/worktrees:
Secrets confirmed absent from tracked diff:

## Checkpoint commits
| Checkpoint/unit | Branch | SHA | Focused evidence | Pushed |
|---|---|---|---|---|

## Current blocker
<one concrete blocker or NONE>

## Exact next action
<one action>

## Stop-safe handoff
Last accepted checkpoint:
Exact pushed SHA:
Working tree:
Unfinished branches:
Evidence already valid:
Evidence NOT yet run:
Known blockers:
Next action:
```

Keep the file compact enough that Astra can reread it repeatedly.

If it grows into a historical novel, archive completed checkpoint details into dedicated handoff/evidence docs and retain only the current checkpoint plus checkpoint-SHA chain.

---

# 3. Subagent return contract

Every Terra or Luna task returns only:

```text
FINDING
<What you found or completed. State triage if a problem exists.
Do not write an essay. Do not silently make architecture decisions.>

AFFECTED FILES
<Exact paths examined or changed.
State shared-contract files encountered but not modified.>

RECOMMENDED ACTION
<Smallest safe next action.
If implementation is complete, say what Astra should integrate/verify.
If blocked by a contract gap, state the gap rather than inventing around it.>

EVIDENCE
<Branch + exact SHA if writes occurred.
Exact commands/actions and pass/fail counts.
Provider/browser evidence where relevant.
Explicit unknowns or checks not run.>
```

No AI committee. No alternate architecture unless Astra requested one.

---

# 4. Broad-gate counter policy

Counters are an anti-thrashing device, not a test limit.

Astra must maintain:

```text
postgres:fast attempts = N
CURRENT_TARGET attempts = N
full canonical PG attempts = N
migration attempts = N
```

For each attempt record:

- candidate SHA;
- fresh/reused DB;
- why the gate was justified;
- result;
- first failing test/file;
- whether the failure is new/pre-existing;
- focused diagnostic performed before another broad run.

Rules:

1. A broad failure never causes an immediate broad rerun.
2. Reproduce the smallest failing file/test first.
3. Fix or classify the signal.
4. Run focused closure evidence.
5. Rerun the broad gate only once the focused signal is green.
6. `postgres:fast` is checkpoint evidence, not the ordinary edit loop.
7. full canonical PG is milestone/final-candidate evidence, never debugging.
8. Current observed fast/full wall times are planning expectations only; elapsed time is not correctness.
9. Do not weaken assertions because a test is slow.
10. Do not parallelize PostgreSQL files merely to save time; accepted PG concurrency remains serial unless its isolation contract is deliberately changed.

---

# 5. Model-budget strategy

## Astra

Use Astra's expensive context for work that requires global ownership:

- A0 freeze;
- contract decisions;
- lane decomposition;
- ambiguity resolution;
- integration;
- cross-lane debugging hypotheses;
- physical browser acceptance;
- provider safety judgment;
- generality audit;
- checkpoint acceptance.

Astra should not spend its context manually editing repetitive CSS, test fixtures or straightforward component markup.

## Terra

Terra is the normal engineering executor.

Use **High** for:

- cross-file frontend work;
- graph/read-model integration;
- Jordan runtime;
- provider composition;
- hard debugging.

Use **Medium** for:

- bounded repo investigations;
- adjacent multi-file work after contracts freeze.

Delegate one coherent implementation lane to one Terra. Do not scatter multiple overlapping Terra agents across the same code.

## Luna

Use **High** for:

- components;
- tests;
- fixtures;
- copy;
- adapters with frozen interface;
- browser assertions;
- docs reconciliation.

Use **xHigh** when the work is technically difficult but contractually bounded:

- graph fidelity port;
- complex deterministic fixture/test implementation;
- multi-file bounded UI work.

Difficulty alone does not justify moving the work back to Astra.

## Sol

Default expected usage: **zero**.

Reasonable expected ceiling: **one focused Sol run around A5**, with a second only if a genuinely different unresolved Critical issue appears later.

Sol requires the ledger to name the exact question before invocation, for example:

> Does the revised Atlas timeout path allow any execution sequence that can issue a second consequential provider request before authoritative reconciliation?

Not:

> Review Jordan.

That prevents premium-review sprawl.

---

# 6. Testing-budget strategy

The normal iteration loop is:

**focused pure/unit  
→ focused direct PG seam  
→ physical browser/provider evidence where relevant**

Only then:

**postgres:fast at coherent checkpoint  
→ CURRENT_TARGET at major product integration  
→ full canonical PG at high-risk milestone if justified / final candidate always**

Recommended planned broad-gate budget:

| Checkpoint | postgres:fast | CURRENT_TARGET | Full PG |
|---|---:|---:|---:|
| A0 | 0 | 0 | 0 |
| A1 | 0 normally | optional 1 | 0 |
| A2 | 1 if PG/projection changed | 0 | 0 |
| A3 | 0–1 if PG changed after A2 | 1 | 0 |
| A4 | 0 unless code changed | 0 unless code changed | 0 |
| A5 | 1 | 0 | only if Critical shared infrastructure changed materially |
| A6 | 0–1 if PG changed | 1 | 0 |
| A7 | 1 | 1 | 0 |
| A8 | as invalidation requires | final | **1 mandatory on exact candidate** |

These are planned executions, not hard caps. A real fix can invalidate evidence and justify another run, but every additional broad run needs a recorded reason.

The largest efficiency gain is not shaving minutes from PostgreSQL. It is preventing Astra from burning a broad gate to discover an error a focused test would have exposed immediately.

---

# 7. Commit/push cadence

A checkpoint is not safe merely because Astra has "made progress."

## Before every implementation lane

- exact previous checkpoint base;
- dedicated branch/worktree;
- explicit owned paths;
- explicit no-touch/shared paths.

## At every coherent lane unit

- inspect status/diff;
- run focused evidence;
- exact-path stage only;
- secret/generated-junk check;
- commit;
- push.

## Before integration

- lane working tree clean;
- lane SHA pushed;
- evidence returned in the four-field subagent contract.

## At checkpoint integration

Astra:

- integrates lane(s);
- resolves conflicts itself;
- runs seam checks;
- updates `ACTIVE_TASK.md`;
- inspects final diff;
- commits `checkpoint(Ax): ...`;
- pushes;
- verifies local HEAD == remote.

Do not leave substantial verified work only in an ephemeral agent environment because "the checkpoint isn't finished yet."

Meaningful verified units get pushed.

---

# 8. Failure-recovery rules

## Focused test fails

Stay on that failure.

Do not run broader tests to gather more noise.

## postgres:fast or full PG fails

Record the exact first failure.

Run that test/file alone using the appropriate focused PG harness.

Do not classify it as flaky merely because resource contention also exists.

## Browser acceptance fails

First classify the layer:

- presentation-only;
- projection/read-model;
- authoritative state;
- planning;
- authority;
- execution;
- observation/reconciliation;
- stale evidence/fixture.

Only then delegate a repair.

## Provider call times out after consequential dispatch may have occurred

Never retry as if failure were known.

Persist/retain `OUTCOME_UNKNOWN` and reconcile using read-only provider state according to the execution contract.

## Provider returns success but Trip remains invalid

Do not mark resolved.

Update canonical provider-owned state, reassess, then re-enter generalized planning or escalate.

## Subagent proposes changing shared schema

Stop that lane.

The subagent reports the architecture gap.

Astra decides and creates a new pushed contract freeze before writes resume.

## Lane base becomes stale

Do not silently merge another lane's assumptions into it.

Astra decides whether to:

- rebase onto latest accepted checkpoint;
- cherry-pick the coherent unit;
- abandon/restart the lane.

Record the decision.

## Dirty subagent worktree

Never integrate directly.

Require coherent commit/push first.

If the work cannot be made coherent, record exact dirty paths and abandon the lane without pretending it is a checkpoint.

## External provider evidence unavailable

Do not mock internal recovery logic.

Use:

- provider-shaped accepted recording if it proves the required boundary;
- explicit UNAVAILABLE/UNKNOWN where evidence does not exist;
- stop and hand off if a required Critical fact cannot safely be established.

## Broad gate exposes historical tests

Classify correctly:

- CURRENT_TARGET;
- MIGRATION_BOUNDARY;
- HISTORICAL_LEGACY.

Do not resurrect SQLite behavior to satisfy historical tests.

---

# 9. Context management

## CONTINUE IN THE SAME ASTRA CONTEXT WHEN

- still inside the same checkpoint;
- contracts have not changed;
- integrating one or two closely related lane returns;
- debugging a concrete failure whose investigation history is valuable;
- a narrow targeted fix follows a just-completed browser/test finding.

## COMPACT WHEN

- a checkpoint remains active but several lanes/evidence runs have accumulated;
- context size is dominated by completed work;
- the next phase needs current decisions, not raw logs.

Before compaction:

1. reconcile `ACTIVE_TASK.md`;
2. push coherent primary changes;
3. record lane heads;
4. record evidence;
5. record exact next action.

After compaction, Astra rereads:

- `ACTIVE_TASK.md`;
- frozen checkpoint contract;
- `git status`;
- current HEAD/remote;
- only source files relevant to the next action.

## START A FRESH ASTRA SESSION WHEN

Default: at every accepted checkpoint boundary if the next checkpoint contains meaningful implementation.

Mandatory fresh session before:

- A5 Jordan/B2 Critical work;
- A8 Final Candidate.

A3 -> A4 may stay in the same context if A4 is purely physical acceptance with no implementation and A3 context remains clean.

Fresh sessions are safe because the pushed checkpoint SHA + compact ledger are the source of truth, not Astra's memory.

## STOP AND HAND OFF WHEN

- the founder asks to stop;
- a checkpoint is accepted;
- an external credential/provider/authority fact blocks safe progress;
- a Critical contract contradiction requires a founder/product decision;
- a lane cannot be reconciled without reopening accepted architecture;
- continued work would require falsely claiming unsupported provider capability.

A stop does not require every lane to be complete.

It requires current reality to be unambiguous.

---

# 10. Initial issue disposition for Astra launch

Based on the current R4 branch at this document's base:

## ACT NOW BEFORE ASTRA PRODUCT WORK

- R4 must finish its remaining acceptance gates and record one exact accepted SHA.
- A0 must distinguish valid current R4 evidence from historical ledger material.
- CURRENT_TARGET and full canonical PG remain part of R4's remaining acceptance work at the current base and must not be silently inherited as "probably fine."

## INVESTIGATE NOW AT A0 IF STILL PRESENT IN ACCEPTED R4

- any recurrence of REPLAN / `SERIALIZATION_RETRY_EXHAUSTED`;
- post-recovery service still rendered Unknown/unconfirmed;
- stale Overview recovery text;
- whether missing synthetic legal identity/budget is required for the chosen accepted demo path or only optional transport execution;
- any R4 fast-suite fixes that were focused-green but not yet covered by the final canonical gate.

These are not automatically Astra implementation tasks. Their disposition depends on final R4 acceptance evidence.

## PARK FOR LATER UNLESS THE CURRENT HERO REQUIRES IT

- Jordan composite transit-hotel + destination-hotel + insurance execution;
- Google Routes;
- broader S6/S8 capability;
- Event history beyond current accepted Overview needs;
- PG-file parallelization.

## IGNORE / ACCEPT RISK ONLY WITH EXPLICIT RECORD

Existing consciously parked integrity/UX items may remain only if they do not threaten A1–A8 acceptance.

Astra must not silently inherit "Park" as permanent truth if a parked issue becomes a blocker for Sarah or Jordan.

---

# 11. Checklist Astra rereads before every checkpoint

1. Am I on the correct primary branch and exact previous accepted SHA?
2. Is the working tree clean, or are all dirty paths explicitly documented?
3. Are shared contracts frozen before any lane writes?
4. Are lane ownership and do-not-touch paths non-overlapping?
5. Am I using Astra for integration/architecture and delegating bounded implementation?
6. Has each failure been debugged with the smallest focused evidence before any broad gate?
7. Does any UI/browser code infer truth that belongs in PostgreSQL/read models?
8. Does every consequential path still obey `proposal -> validation -> viability -> authority -> executor -> observe -> state update`?
9. Are provider/model provenance, hardcoding, deferred scope and unknowns truthful?
10. Is there a coherent pushed SHA, reconciled `ACTIVE_TASK`, exact evidence and one exact next action if I stop now?

---

# Final execution principle

The biggest failure mode for Astra would not be insufficient intelligence. It would be using its intelligence to do too much simultaneously.

The control loop should therefore be:

**freeze  
→ delegate bounded work  
→ require pushed lane evidence  
→ Astra integrates  
→ focused seam verification  
→ physical evidence where meaningful  
→ one justified broad gate  
→ checkpoint commit/push  
→ reconcile ledger  
→ continue or stop**

At every point, the last accepted checkpoint remains a viable handoff boundary.

**ASTRA EXECUTION PLAN READY**
