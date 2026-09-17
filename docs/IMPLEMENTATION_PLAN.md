# Northstar implementation plan

Status: **CURRENT POST-C5 DELIVERY PLAN**.

Authoritative repository: `dropandresetmain-prog/qoder-atlas`.
Current planning baseline for this reconciliation: `main` at
`6aba3124f9afea0c4937274f04c6316cad228949`.

The original M0-M11 data-structure implementation decomposition is preserved verbatim in
[`IMPLEMENTATION_PLAN_HISTORY.md`](IMPLEMENTATION_PLAN_HISTORY.md). M0-M10 and C5 are
accepted history; do not reopen them unless current implementation exposes a concrete
architecture contradiction. This file is the authoritative plan for the remaining product
and submission work.

Normative companions:

- [`DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md) — frozen F01-F18 architecture decisions.
- [`DATA_STRUCTURE_LOGICAL_SCHEMA.md`](DATA_STRUCTURE_LOGICAL_SCHEMA.md) — relational ownership/integrity/transaction contracts.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — concise current architecture map.
- [`CAPABILITIES_AND_LIMITATIONS.md`](CAPABILITIES_AND_LIMITATIONS.md) — current implementation truth.
- [`ROADMAP.md`](ROADMAP.md) — current status, scope and deferred work.
- [`TESTING.md`](TESTING.md) — focused-test-first suite contract.
- [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md) and [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md) — model/harness routing policy and evidence.
- [`IMPLEMENTATION_AGENT_ROUTING.md`](IMPLEMENTATION_AGENT_ROUTING.md) — three-route execution/review alternatives.

## 22. Current delivery sequence

### 22.0 Delivery principle

The remaining work is product integration, not another architecture rewrite.

Protect the vertical loop first:

```text
make Northstar work end to end
-> prove the same engine on a materially different scenario
-> reconcile remaining backend/product requirements
-> improve observability and visual surfaces
-> harden and submit
```

At all times after a founder-accepted checkpoint, later work must preserve the previously
working demo floor. A slice is not complete because its components exist separately. It is
complete when the whole sequence runs through normal product/runtime paths without manual
SQL, test-helper assembly or presentation-only shortcuts.

The critical product proof remains:

```text
change -> state update -> affected scope -> assessment -> RecoveryCase
-> AI proposal/research -> deterministic viability -> authority
-> execution -> observation -> canonical state update -> reassessment -> resolved
```

Never allow `LLM -> irreversible/money-moving API`.

### 22.1 Current stage map

| # | Stage | Status / exit condition |
|---|---|---|
| 0 | **T1 — full AiT PostgreSQL baseline** | **ACCEPTED.** Full event world persists/restarts and renders from PostgreSQL. |
| 1 | **T2 — truthful provider disruption/reprotection** | **ACTIVE / FIXING REVIEW FINDINGS.** Provider-shaped event must mutate canonical booking/service state, invalidate/reassess, remain crash/retry safe and stop before automatic case creation. |
| 2 | **T3 — incident-scoped assessment -> RecoveryCase orchestration** | Exactly one real Sarah case opens idempotently from the T2 incident; real command/application seams attach causal signal + affected subjects; unrelated baseline failures are excluded. |
| 3 | **T4 — minimal authoritative Case View + focused V5.6 graph** | Founder can click/reload the real Sarah case and see authoritative case facts, quantitative failure reason and the accepted focused graph. |
| 4 | **Slice A integrated checkpoint + Founder Test A** | `change -> affected outcomes -> Sarah case -> authoritative Case View` works through normal product paths. |
| 5 | **Slice B — Sarah Case -> truthfully recovered** | LIVE-first recovery proposal, deterministic counterfactual viability, authority, internal programme execution, observation, reassessment and case resolution work end to end. |
| 6 | **Slice B review + Founder Test B** | The complete Sarah recovery chain is independently challenged at its high-risk seams and then physically founder-tested. |
| 7 | **Jordan — same generalized engine** | A materially different delay/connection recovery runs through the same application/domain code and uses Atlas read capabilities where they materially help. |
| 8 | **Generalisation checkpoint** | Sarah -> Jordan and, where practical, Jordan -> Sarah work in the shared world without scenario-specific application branches. |
| 9 | **Astra architecture reconciliation — planning only** | All remaining backend/product/demo requirements are reconciled into one dependency-aware implementation plan through 30 Sep. Astra does not need to implement it. |
| 10 | **Post-E2E product milestones** | Observability, accepted Event Overview implementation, provider hardening and other planned improvements land without breaking the protected Sarah/Jordan loop. |
| 11 | **M11 + final candidate / submission hardening** | Operational retirement/activation, exact candidate evidence, Railway/demo fallback, final CURRENT target gate and submission rehearsal complete. |

Do not promote internal engineering checkpoints inside Slice B into separate roadmap
milestones. They are implementation sequencing inside one product milestone.

### 22.2 Slice A — change becomes a real visible case

Slice A is deliberately narrow:

```text
real AiT baseline
-> normal product UI
-> provider-shaped disruption
-> authoritative PostgreSQL mutation
-> real invalidation/reassessment
-> incident-scoped affected outcomes
-> Sarah RecoveryCase
-> Case View
-> authoritative V5.6 focused graph
```

#### T2 — provider disruption/reprotection

T2 remains on its current implementation/review lane until accepted. Its required truth is:

- disclosed synthetic provider event through the normal HTTP/provider-event boundary;
- canonical cancellation/displacement/reprotection state, not an arrival-time-only edit;
- external identity/provenance and stable canonical identity semantics;
- retry-safe partial execution and durable completion semantics;
- deterministic M6 invalidation/reassessment;
- UI authoritative polling/refetch;
- **no automatic RecoveryCase yet**.

The independent T2 review is an exceptional targeted review because actual crash/retry and
M6 semantic defects were found. After fixes, the same reviewer rechecks only the fix delta
plus directly affected tests; do not restart an unrelated full review cycle.

#### T3 — failed incident assessment -> RecoveryCase

T3 is the next bounded implementation after T2 acceptance.

Required flow:

```text
T2 incident
-> scheduled reassessment/current assessments
-> incident-affected scope
-> recovery-relevant failure
-> idempotently open one RecoveryCase
-> attach originating signal
-> attach affected subjects
-> expose case identity through normal read surface
```

Required constraints:

- add a normal command/application seam for case subjects/signals; acceptance tests may not rely on direct SQL for product behavior;
- unrelated pre-existing baseline failures must not be swept into Sarah's incident case;
- no Qwen, Atlas, strategy generation, authority or execution yet;
- no scenario/persona/name/route branch in application/domain logic.

#### T4 — minimal Case View + accepted focused graph

T4 protects the first visually convincing product checkpoint without expanding into final
observability or Overview redesign.

Required surface:

- real Case header/status and authoritative case data;
- Sarah's quantitative failure reason (`available` vs `required`) from backend truth;
- real focused graph rendered with the accepted V5.6 visual grammar;
- graph state supplied by authoritative read models; frontend does not infer viability,
  blast radius, causal failure, readiness, policy or authority;
- click/reload and polling work without fixture/manual state reconstruction.

**Case graph timing:** V5.6 production integration belongs here, before Slice B.

**Not T4:** semantic activity timeline, Activity redesign, final Event Overview, whole-event
graph, semantic zoom, rich recovery UI.

### 22.3 Review checkpoint A — after T4, not after T3 and T4 separately

Do one integrated Slice A review after T3 + T4 converge.

Review the whole path:

```text
baseline -> disruption -> canonical mutation -> affected scope -> reassessment
-> exactly one case -> real case read model -> V5.6 rendering -> reload persistence
```

This is a review boundary because several independently implemented seams now meet. Do not
attach a separate independent reviewer to T3 and another to T4 unless a concrete Critical
finding emerges during implementation.

After review findings close, run **Founder Test A**. Preserve the accepted state as
**Protected Demo Floor #1**.

### 22.4 Slice B — Sarah Case becomes truthfully recovered

Slice B is **one product milestone**. The following are internal implementation checkpoints,
not new roadmap milestones:

```text
target capability composition + safe LIVE smoke
-> target-native Qwen recovery proposal / read-only research
-> strict schema validation
-> deterministic counterfactual viability
-> persist selected viable strategy / compile ActionPlan
-> real principal + authority/approval
-> ordered internal programme actions
-> observation / canonical state update
-> reassessment
-> RecoveryCase resolved only on fresh passing truth
```

#### Required composition work

Reuse current target primitives and provider transports. Do **not** resurrect the retired
SQLite `RuntimeOrchestrator`, legacy planner contract or legacy executor wholesale.

Required seams for Sarah:

- target-owned capability composition;
- LIVE-first Model Studio/Qwen client wiring;
- explicit capability/runtime status so REPLAY cannot masquerade as LIVE;
- target-native planning context assembled from RecoveryCase/current PostgreSQL world;
- target-native structured AI proposal contract producing only approved proposed changes,
  assumptions/unknowns and read-only research requests;
- deterministic `ScenarioChange` validation/evaluation;
- product wiring of RecoveryStrategy -> ActionPlan -> authority/approval;
- internal programme-action execution through current deterministic/durable seams;
- observation -> canonical state -> reassessment -> resolution.

#### Safe LIVE smoke inside Slice B

Before recovery depends on external capabilities, prove harmless LIVE calls:

- Model Studio/Qwen: tiny schema-bound request, no authoritative mutation;
- Atlas: read-only sandbox Search/Verify smoke with correct timezone normalization, no order/pay.

This is a checkpoint inside Slice B, not a standalone roadmap milestone.

#### Sarah acceptance

The winning Sarah flow should be allowed to recover the trip through programme state rather
than gratuitously purchasing another flight:

```text
provider event -> Sarah FAIL
-> one real case
-> LIVE AI proposes/researches recovery
-> deterministic bilateral programme-swap preview PASS
-> authority
-> internal programme changes committed/observed
-> Sarah reassessed PASS
-> case resolves
```

Atlas transactional booking, Nuitée, Routes and FX are not required merely to decorate the
Sarah demo. Use a provider only where the recovery genuinely depends on it.

### 22.5 Review checkpoint B — after full Sarah recovery

Slice B crosses AI proposal, deterministic viability, authority, durable execution,
observation and resolution. It therefore gets **one major independent review** before
Founder Test B.

Review focus:

- no `LLM -> action` bypass;
- no stale assessment/authority basis;
- provider/tool success is not treated as recovered-trip proof;
- action ordering/idempotency/partial failure remain truthful;
- observation and canonical mutation precede recovery;
- final PASS is fresh and covers the required scope.

Close targeted findings, then run **Founder Test B**. Preserve as
**Protected Demo Floor #2 — Sarah E2E**.

### 22.6 Jordan — prove the same engine is general

After Sarah works end to end, run the Jordan scenario through the same engine/application
code. Jordan is not a second bespoke pipeline.

Minimum Jordan proof:

```text
progressive provider delay
-> connection feasibility degrades
-> real RecoveryCase
-> LIVE Atlas Search/Verify where useful
-> AI proposes recovery
-> deterministic whole-trip viability
-> authority
-> supported provider/simulated transaction boundary
-> observation -> canonical state
-> reassessment -> recovered
```

Jordan adds/provider-hardens requirements that Sarah need not carry:

- PostgreSQL-backed authoritative IATA -> timezone resolution for Atlas normalization;
- Atlas offer/search/verify -> target planning evidence;
- explicit semantics for `external:offer.select` before mapping it to create/order/pay;
- target provider dispatcher/reconciler before consequential external execution;
- provider observation -> canonical reservation/service state before claiming recovery;
- hotel/ground/FX only as the actual scenario needs them.

Nuitée transaction execution, Routes and FX remain conditional; do not inflate the minimum
Jordan proof if truthful simulated/provider-boundary execution demonstrates the generalized
lifecycle more reliably.

### 22.7 Review checkpoint G — generalisation, not another architecture review

After Jordan works, run one focused generalisation review:

- same engine/application code handles Sarah and Jordan;
- no new scenario/persona/provider branches leaked into domain/application logic;
- shared-world continuity works Sarah -> Jordan and, where practical, Jordan -> Sarah;
- provider-specific behavior remains in adapters/capability seams;
- no reset is mandatory between scenarios except explicit demo-environment reset.

This is a focused regression/generalisation review, not a request to reopen F01-F18.
Preserve the result as **Protected Demo Floor #3 — two materially different E2Es**.

### 22.8 Astra reconciliation — one planning pass after empirical E2E proof

After Sarah and Jordan establish the vertical loop, use **one Astra planning pass** to
reconcile the remaining requirements into a safe implementation plan through 30 Sep.

Astra's input package should include:

- architecture-readiness audit findings;
- T2/T3/T4 implementation and review findings;
- Sarah Slice B findings;
- Jordan/provider integration findings;
- Railway/deployment requirements;
- accepted Event Overview requirements;
- observability requirements;
- unresolved provider/execution semantics and M11/submission obligations.

Astra's job is **planning only**:

> preserve the working vertical loop; reconcile every remaining requirement; classify it
> Act Now / Investigate Now / Park for Later / Ignore-Accept Risk; produce a dependency-aware
> implementation sequence through 30 Sep.

Astra is not required to implement the resulting plan. Normal implementation agents execute
bounded milestones from the reconciled plan.

### 22.9 Post-E2E product milestones

These are worthwhile product milestones, but they must not block the first Sarah/Jordan E2E.
Their exact order after the Astra reconciliation may change based on accepted design/backend
requirements.

#### Observability — operational chain of events

Implement a semantic operational-history layer over authoritative records; do not create a
parallel source of truth.

The model must represent meaningful external/provider events, Northstar actions,
determinations, human decisions, observations and outcomes. One authoritative semantic
activity projection feeds different surfaces:

```text
authoritative changes / assessments / cases / actions / observations
-> semantic operational activity
-> Case timeline
-> Activity operational journal
-> compressed Overview feed
```

Case gets the richest case-scoped timeline. Activity gets the broader chronological journal.
Overview gets a compressed event-scoped feed below the main visualisation.

Design requirements may be explored earlier; production implementation waits until the
vertical recovery loop itself is proven so the feed observes real lifecycle behavior rather
than a speculative workflow.

#### Event Overview — accepted visual implementation

The Overview visual direction may continue to be designed/prototyped in parallel now, but
**current Overview remains the protected functional UI through Slice A, Slice B and Jordan**.

Production implementation starts only after the design is accepted and the core E2E is
protected, unless the change is demonstrably presentation-only with no new backend contract.

Current desired layout hypothesis:

- primary Event Overview visualisation is edge-to-edge;
- semantic activity feed sits below it, not beside it;
- all views share one authoritative world state; Overview/Case/whole-graph are projections,
  not separate state machines.

The whole-event Live Dependency Graph, continuous semantic zoom and multiple simultaneous
focuses remain Stretch until an accepted Overview direction and measured usefulness justify
them.

### 22.10 M11 and final submission hardening

M11 is operational activation/retirement, not a migration back from an active SQLite runtime.
Before final submission/candidate closure:

- perform the bounded external legacy SQLite file/volume inventory;
- prove intended sole-writer/authority/reconciliation/provenance state;
- retire remaining old operational access if any;
- harden Railway readiness so an application that is only `starting` cannot be mistaken for
  a healthy composed runtime;
- expose LIVE/RECORD/REPLAY/provider status truthfully for demo/rehearsal;
- retain tested REPLAY/recording fallback for provider outages without presenting it as LIVE;
- run the canonical CURRENT target gate once on the exact candidate/fresh DB;
- run final Railway boot/restart persistence and demo rehearsal;
- capture submission evidence from the exact accepted candidate.

Do not use historical SQLite failures as release blockers.

### 22.11 Review strategy — key boundaries only

Verification is risk-driven; independent model review is uncertainty-driven.

The remaining planned independent review points are:

| Review point | Why it exists | What does **not** get a separate review |
|---|---|---|
| **T2 targeted re-review** | Already justified by proven crash/retry + M6 semantic defects. Recheck fix delta only. | Do not restart T1 or full T2 architecture review. |
| **Slice A integrated review** | T3 case orchestration + T4 authoritative Case/V5.6 converge into the first product slice. | No separate reviewer after T3 and another after T4. |
| **Slice B major review** | AI/authority/execution/observation/resolution is the highest-risk recovery boundary. | No independent reviewer after each internal Slice B checkpoint. |
| **Jordan generalisation review** | Prove same engine and no scenario hardcoding after a materially different scenario. | No fresh architecture review. |
| **Final candidate review** | Exact candidate / deployment / demo / M11 / truthfulness evidence. | Promotion itself is not another committee review. |

A reviewer-requested fix gets targeted closure evidence and direct recheck where necessary;
it does not automatically cause a full milestone re-review.

### 22.12 Three recommended model + harness routes

These are alternatives under the repository's three-option rule. **Choose one route per
implementation/review task; do not run all three.** Harness/tool availability outranks model
prestige. Runtime/DB/browser/provider evidence outranks model confidence.

#### Implementation / planning routes

| Stage | Task class | Route 1 | Route 2 | Route 3 |
|---|---|---|---|---|
| **T2 targeted remediation** | Critical seam / Hard Bounded | **Qoder + Qwen3.8-Max** (continue current branch/context) | **Codex + GPT-5.6 Luna xHigh** | **Cursor + Grok 4.6 High** |
| **T3 case orchestration** | Hard Bounded | **Codex + GPT-5.6 Luna xHigh** | **Qoder + Qwen3.8-Flash** | **Cursor + Composer 2.5** |
| **T4 Case + V5.6 integration** | Normal / Hard Bounded UI-integration | **Cursor + Composer 2.5** | **Cursor + Auto Balance** | **Codex + GPT-5.6 Luna High** |
| **Slice B Sarah E2E** | Complex integration with Critical seams | **Cursor + Grok 4.6 High / Auto Intelligence** | **Codex + GPT-5.6 Terra High** | **Qoder + Qwen3.8-Max** |
| **Jordan generalized E2E** | Complex provider/integration | **Cursor + Grok 4.6 High** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** |
| **Astra reconciliation** | Complex/Critical planning synthesis | **GPT-6 Astra Medium/High via a supported planning harness** | **ChatGPT + GPT-5.6 Sol High** | **Claude + Opus High** |
| **Observability implementation** | Normal/Complex cross-read-model product work | **Cursor + Composer 2.5 / Auto Intelligence as scope requires** | **Codex + GPT-5.6 Luna xHigh** | **Qoder + Qwen3.8-Max** |
| **Accepted Overview implementation** | Normal visual/read-model integration | **Cursor + Composer 2.5** | **Cursor + Auto Balance** | **Codex + GPT-5.6 Luna High** |
| **M11 / final hardening** | Critical operationally / runbook-driven | **Cursor + Auto Balance + owner-run runbook** | **Codex + GPT-5.6 Luna High + owner-run runbook** | **Claude Code + Sonnet High + owner-run runbook** |

Fable or another visual prototyping surface may be used to explore Case/Overview/Activity
interaction once the semantic/backend contract is frozen, but it is not currently part of
`MODELS_ARSENAL.md`; do not treat it as an architecture or verification authority.

#### Independent review routes when the table in §22.11 says a review is warranted

| Review point | Route 1 | Route 2 | Route 3 |
|---|---|---|---|
| **T2 targeted re-review** | **Claude Code + Opus High** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Kilo/OpenRouter + GLM-5.3** where provider/privacy/tool route is acceptable |
| **Slice A integrated review** | **ChatGPT + GPT-5.6 Terra High** | **Kilo/OpenRouter + GLM-5.3** | **Claude Code + Sonnet High** |
| **Slice B major review** | **Claude Code + Opus High** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Kilo/OpenRouter + GLM-5.3** when adequate for the exact question |
| **Jordan generalisation review** | **ChatGPT + GPT-5.6 Terra High** | **Kilo/OpenRouter + GLM-5.3** | **Qoder + Qwen3.8-Max** |
| **Final candidate review** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Claude Code + Opus High** | **Kilo/OpenRouter + GLM-5.3** for non-destructive rehearsal/static/runtime audit where adequate |

The premium budget rule still applies: Sol/Opus/Astra are used because a concrete boundary
justifies them, not because every milestone deserves a prestige model.

### 22.13 Testing and checkpoint discipline

Default implementation hierarchy:

1. smallest focused test(s) for changed behavior;
2. adjacent/module tests;
3. relevant focused PostgreSQL seam;
4. typecheck/build/lint/anti-hardcoding only where relevant;
5. broader PostgreSQL/current suite at coherent slice/candidate checkpoints;
6. full canonical CURRENT target gate once on the exact final candidate/fresh DB.

Do not repeatedly run the broad PostgreSQL suite while debugging one failed focused test.
`npm run test:legacy` is historical/non-gating and not part of normal implementation.

Cloud agents must commit and push coherent, tested checkpoints. Before every checkpoint:
inspect status/diff, exact-path stage, verify no secrets/generated junk/unrelated changes,
run focused evidence, commit clearly and push. Long-horizon work uses
`docs/work/ACTIVE_TASK.md`.

### 22.14 Requirement register retained for the post-E2E Astra pass

Do not lose requirements just because they are not on the immediate critical path.

**Act Now in the vertical loop:**

- T2 crash/retry-safe provider-event completion and truthful M6 booking semantics;
- T3 case subject/signal command/application seam;
- T4 authoritative focused case graph/read model;
- target capability composition;
- target-native Qwen planning boundary;
- real authority/principal product wiring;
- observation -> canonical state -> reassessment/resolution.

**Investigate during/after the relevant E2E:**

- exact external `offer.select` operational meaning before Atlas create/pay mapping;
- provider execution observation -> canonical PG reconciliation;
- Atlas PostgreSQL-backed timezone resolution;
- strategy-selection append-only representation;
- reassessment-worker error observability;
- provider LIVE/RECORD/REPLAY status/readiness;
- complete no-Journey programme participation;
- Sarah/Nadia/source-data truth exposed by T2 review;
- Jordan hotel/ground/FX needs based on real scenario evidence.

**Post-E2E planned product work:**

- semantic operational activity / Case timeline / Activity journal / Overview feed;
- accepted Event Overview implementation;
- provider/deployment/demo hardening from Astra's reconciled plan.

**Stretch / Deferred unless evidence promotes it:**

- whole-event Live Dependency Graph;
- continuous semantic zoom;
- multiple simultaneous disruption focuses;
- broad new provider marketplace;
- generic Booking.com/Hotelbeds expansion;
- microservices/Kafka/Neo4j/Kubernetes.
