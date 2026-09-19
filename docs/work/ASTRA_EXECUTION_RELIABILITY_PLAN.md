# NORTHSTAR — Astra Execution Reliability Plan

Status: **REFERENCE PLAN — NOT AN IMPLEMENTATION RECIPE**

Launched from accepted R4 `2baf1f6df484319e131590d37a0b026222324d03`.
Current decomposition and reconciled findings: [A0](ASTRA_A0_CONVERGENCE.md).
Current checkpoint/counters: [ACTIVE_TASK](ACTIVE_TASK.md).

Primary audience: post-R4 Astra primary agent.

This document exists to make the post-R4 run **stoppable, resumable, test-disciplined and economical**. It does **not** prescribe the exact internal implementation plan, lane count, file ownership map or model assignment before Astra has inspected the accepted R4 repository state.

Astra should use this document as a control framework:

> understand current reality -> choose the safest decomposition -> delegate bounded work -> integrate -> prove -> push a coherent checkpoint.

The detailed product truth lives elsewhere. In particular, this document must not override the accepted frontend, graph, scenario or recovery contracts.

---

## 1. Core operating principles

### 1.1 Astra owns the hard parts

Astra should retain ownership of:

- architecture and contract interpretation;
- resolving conflicting repository truth;
- checkpoint scope;
- integration across lanes;
- ambiguous or high-risk debugging;
- physical browser acceptance;
- Sarah/Jordan generality judgement;
- deciding when a checkpoint is actually complete.

Astra should **delegate aggressively whenever useful**, but delegation exists to accelerate bounded work, not to outsource integration judgement.

### 1.2 Prefer Terra and Luna

Default delegation posture:

**Terra**
- substantial bounded engineering;
- cross-file implementation;
- difficult but reversible debugging;
- frontend/backend integration;
- graph/runtime integration;
- Jordan runtime work after contracts are understood.

**Luna**
- well-defined components;
- tests;
- copy cleanup;
- fixtures/data reconciliation;
- bounded UI ports;
- mechanical refactors;
- browser assertions;
- documentation reconciliation.

Astra chooses the actual lanes after inspecting the repository. Do not create agents merely to satisfy a predetermined decomposition.

### 1.3 Use Sol sparingly

Sol is not a routine reviewer.

Use Sol only when Astra can name a genuinely difficult, high-risk unresolved question such as:

- consequential provider execution safety;
- authority;
- unknown-outcome reconciliation;
- migration/data integrity;
- another Critical seam where an independent deep review materially reduces risk.

Do not use Sol for CSS, normal graph implementation, copy, routine tests, ordinary debugging or ceremonial final review.

There is no hard numerical quota. The default expectation is simply: **most work should not require Sol**.

### 1.4 PostgreSQL remains the only normal runtime

Do not reintroduce SQLite or historical demo/runtime orchestration to make old tests or scenarios easy.

Historical tests and source may provide migration evidence, but current product acceptance must exercise the PostgreSQL product.

### 1.5 Generality matters more than hero-specific convenience

Sarah and Jordan are acceptance worlds, not application branches.

Facts such as names, routes, flights, programme slots, suppliers and scenario stages belong in data/configuration/provider evidence.

If a required behavior cannot be expressed by the current ontology or frozen contracts, report the architecture gap rather than hardcoding around it.

---

## 2. Stop-safe checkpoint structure

The recommended structure is intentionally coarse. Astra may create smaller internal commits and sub-checkpoints when useful.

### A0 — Freeze & Diagnose

Goal:

Establish the exact accepted R4 launch state and convert the prepared audits into a current implementation plan.

Minimum acceptance:

- final accepted R4 SHA recorded;
- branch/worktree state understood;
- relevant authoritative docs read;
- inherited issues triaged;
- current frontend/graph/Jordan gaps checked against final R4;
- Astra chooses its own safe implementation decomposition;
- working ledger created;
- A0 docs-only checkpoint pushed.

No product implementation is required merely to finish A0.

### A1 — Product Frontend Convergence

Goal:

Restore the product frontend to at least the pre-refactor minimum while faithfully converging the accepted V5.6 and V7.2 visuals.

This checkpoint may contain multiple internal lanes and commits. Astra decides whether shell, product surfaces, Case graph and Overview graph should be parallel or sequential based on actual code collisions.

Minimum acceptance:

- all major operator/traveller surfaces meet the legacy product-quality floor or have an explicit justified retirement;
- accepted V5.6 behavior is wired from current authoritative semantics;
- accepted V7.2 behavior is wired from current authoritative semantics;
- polling/interactions do not destroy browser state;
- user-visible language remains product language;
- no browser inference of business truth;
- focused/browser evidence exists;
- coherent pushed A1 SHA.

### A2 — Sarah Product Acceptance

Goal:

Prove that frontend convergence did not break the primary live Sarah product path.

Minimum acceptance:

Reset -> healthy Overview -> disrupt Sarah -> Case -> real/recorded provider evidence + real Qwen where required -> understandable recommendation -> authority/approval -> execution/observation -> reassessment -> RESOLVED -> Overview healthy.

The exact winning strategy is allowed to be programme-side if that remains the correct generalized result.

Astra should use valid existing R4 evidence where still applicable, but physical product acceptance must reflect the actual A2 candidate.

### A3 — Jordan Runtime Acceptance

Goal:

Make Jordan's progressive S2 backend path work through the same generalized PostgreSQL recovery architecture.

Minimum acceptance is backend/runtime truth, not final UI polish.

At minimum prove the current generalized path can represent and process:

baseline -> progressive upstream delay -> connection risk -> connection failure -> recovery research -> whole-trip viability comparison -> authority/execution boundary -> observation/reassessment -> viable final state.

Do not inflate the closed hero into mandatory composite hotel/transfer/insurance execution unless current authoritative scenario truth requires it.

### A4 — Jordan Product Acceptance

Goal:

Make Jordan physically runnable through the actual product.

Minimum acceptance:

- founder can drive the progressive S2 sequence through product controls;
- V5.6 explains Jordan's causal disruption truth;
- V7.2 reflects Jordan in the wider event world;
- viable and rejected recovery are understandable;
- consequential external action follows the normal deterministic authority/execution chain;
- observed state is reconciled;
- trip/case resolve only after current truth passes;
- Reset can restore a repeatable baseline without manual SQL repair.

### A5 — Cross-Scenario Convergence & Final Candidate

Goal:

Freeze a submission/demo candidate where Sarah and Jordan both work through the same architecture.

Minimum acceptance:

- Sarah and Jordan both physically runnable on the exact candidate;
- no hero-specific application/domain logic;
- PostgreSQL-only normal runtime;
- accepted graph/product behavior preserved;
- focused/static/broad gates appropriate to the final candidate are green;
- source-of-truth docs reconciled;
- no unresolved Act Now blocker;
- final pushed SHA and launch instructions recorded.

---

## 3. Testing doctrine

The rule is simple:

> **Use the smallest relevant test while iterating. Broaden only after focused evidence is green.**

Default progression:

1. smallest focused unit/renderer/domain test;
2. focused direct PostgreSQL seam when persistence/runtime changed;
3. physical browser/provider proof where behavior is visible or external;
4. `postgres:fast` at a coherent integration checkpoint;
5. CURRENT_TARGET at a major product integration checkpoint;
6. full canonical PostgreSQL at a meaningful milestone/final candidate.

Hard rules:

- `postgres:fast` is not the normal debugging loop;
- CURRENT_TARGET is not the normal debugging loop;
- full canonical PostgreSQL is never the debugging loop;
- when a broad gate fails, reproduce the smallest failing file/test first;
- do not weaken assertions merely to make a gate green;
- accepted serial PostgreSQL isolation remains unless deliberately changed.

Astra decides exactly when a checkpoint has accumulated enough change to justify a broad gate. This document does not preassign one broad run to every checkpoint.

Maintain simple counters:

- `postgres:fast attempts = N`
- `CURRENT_TARGET attempts = N`
- `full canonical PG attempts = N`

The counters discourage thrashing; they are not hard quotas.

---

## 4. Checkpoint commit and push discipline

A checkpoint is useful only if the founder can stop there.

For every coherent implementation unit:

- inspect diff/status;
- run appropriate focused evidence;
- verify no secrets/generated junk/unrelated changes;
- stage exact paths;
- commit clearly;
- push.

Before a lane is integrated:

- lane work must be committed;
- lane head must be pushed;
- lane return must state what changed and what was proved.

At each major checkpoint Astra must leave:

- exact pushed primary SHA;
- clean tree, or explicitly documented remaining dirty paths;
- current unfinished lane branches;
- evidence already valid;
- issues with triage;
- one exact next action.

Do not leave substantial verified work only in ephemeral cloud state.

---

## 5. Minimal working ledger

`docs/work/ACTIVE_TASK.md` should remain working memory, not become another giant planning document.

Recommended minimum:

```text
# ACTIVE TASK — ASTRA <checkpoint>

Base accepted SHA:
Current primary branch:
Current pushed SHA:
Goal:

Acceptance:
- [ ] ...
- [ ] ...

Active lanes:
| lane | model | branch | scope | state | head |
|---|---|---|---|---|---|

Evidence already green:
- ...

Broad-gate counters:
postgres:fast =
CURRENT_TARGET =
full canonical PG =

Issues:
| issue | Act Now / Investigate Now / Park / Accept Risk | disposition |
|---|---|---|

Exact next action:

Stop-safe handoff:
- last accepted checkpoint SHA
- unfinished branches
- evidence not yet run
- blocker / NONE
```

Astra may add fields that materially help the current checkpoint. Avoid administrating the ledger for its own sake.

---

## 6. Subagent return discipline

Terra/Luna returns should stay concise:

**FINDING**

What was found or completed.

**AFFECTED FILES**

Exact paths examined/changed.

**RECOMMENDED ACTION**

Smallest safe next action or integration note.

**EVIDENCE**

Branch + SHA for writes; focused tests/browser/provider evidence; explicit unknowns.

Subagents should not silently make architecture decisions outside their bounded task.

---

## 7. Failure-handling rules that remain binding

These are architecture/safety rules, not implementation preferences.

### Focused test fails

Debug that signal first.

Do not broaden merely to gather more failures.

### Provider action may have occurred but outcome is unknown

Never blindly redispatch.

Persist/retain unknown outcome and reconcile through read-only provider state according to the execution contract.

### Provider reports success but the trip remains invalid

Do not mark the case recovered.

Update canonical provider-owned state, reassess, then continue generalized recovery or escalate.

### A subagent discovers a shared contract/schema gap

Stop the bounded lane and report the gap.

Astra decides whether a contract change is justified before implementation resumes.

### Historical test conflicts with current product truth

Classify it as CURRENT_TARGET, MIGRATION_BOUNDARY or HISTORICAL_LEGACY.

Do not revive retired runtime behavior just to satisfy history.

---

## 8. Context/session guidance

This is guidance, not a schedule.

Stay in the same Astra context while the same checkpoint's reasoning is actively useful.

Before compaction or handoff:

- reconcile ACTIVE_TASK;
- push coherent work;
- record lane heads/evidence;
- record the exact next action.

Starting a fresh Astra session at a major checkpoint can be useful if the pushed SHA + ledger fully capture current reality, but it is not mandatory merely because a checkpoint number changed.

---

## 9. What this document deliberately does NOT prescribe

Astra must determine these after inspecting final R4:

- exact file ownership per lane;
- exact number of subagents;
- exact order of frontend file edits;
- exact model for each component;
- exact implementation technique for each graph gap;
- exact focused test file before the relevant code is inspected;
- exact number of broad test runs;
- a fixed commit naming scheme;
- a mandatory fresh session at every checkpoint;
- a fixed maximum number of Sol invocations.

The prepared product/graph/Jordan audits define **what must be true**. Astra decides **how to get there safely**.

---

## 10. Pre-launch requirement

Astra must launch from the **final accepted R4 SHA**, not from the SHA used when this plan was written.

At A0:

1. inspect final R4;
2. read the convergence charter;
3. read the detailed legacy frontend, graph and Jordan audits;
4. revalidate material audit findings that could have changed during R4;
5. choose the implementation decomposition;
6. push A0 before broad product work.

If R4 is not actually accepted when Astra begins, Astra must make that explicit rather than silently treating a moving branch as a frozen launch base.

---

## 11. Checkpoint reread

Before accepting any checkpoint, ask:

1. Is the current truth still consistent with the frozen product/graph/scenario contracts?
2. Did I delegate bounded work while retaining architecture/integration judgement?
3. Did I use focused evidence before broad gates?
4. Does any browser code infer business truth that belongs in backend/read models?
5. Does consequential execution still follow deterministic viability -> authority -> executor -> observe/reconcile?
6. Are provider/model provenance and unknowns truthful?
7. Are Sarah/Jordan facts data-driven rather than application branches?
8. Is there a pushed SHA and enough handoff state to stop right now?

---

**ASTRA EXECUTION RELIABILITY PLAN READY — REFERENCE, NOT RECIPE**
