# LangGraph Fit and Risk Audit — 2026-09-19

Status: completed architecture investigation  
Repository: dropandresetmain-prog/qoder-atlas  
Investigation base: 456be3e44b7d4689e6f734c719725848e140dff8  
Accepted truth rebase: 4f48c75af41bc79874470900c76f8a2dc7b0238f  
Investigation branch: investigate/langgraph-fit  
Production source changed: no  
LangGraph implemented: no

## 1. Verdict

SPIKE REQUIRED BEFORE DECISION

LangGraph is a credible fit for one narrow responsibility: a durable outer workflow shell around NORTHSTAR application services. It is not yet proven to be a net improvement.

The strongest candidate is Option 1: LangGraph outer workflow only.

The current NORTHSTAR architecture already persists the safety-critical things that many LangGraph examples use graph state to persist: business state, assessments, strategy evidence, approval truth, ActionPlans, ActionIntents, execution attempts, provider observations, canonical mutations, reassessment and resolution gates. That is good. It also means LangGraph must justify itself on generic control flow only: durable cursoring, explicit pause/resume, routing, restart behavior, workflow tracing and possibly simpler continued-recovery progression.

There is a real fit. LangGraph StateGraph, Commands, persisted threads, interrupts, retry policies, durable node-boundary recovery and streaming match NORTHSTAR's missing long-running progression mechanics. But there are also real costs that are not theoretical: a second persisted workflow cursor, non-atomic checkpoint versus NORTHSTAR writes, graph-version compatibility for cases open across deploys, same-case concurrency control, checkpoint retention/privacy, and the fact that embedded open-source LangGraph does not remove the need for a durable application wake-up path.

Therefore adoption should not be decided from framework feature overlap. A one-day bounded spike should prove whether Option 1 makes the real NORTHSTAR lifecycle simpler and safer without changing any frozen domain contract.

### Major decision record

#### WHAT WE KNOW

- The accepted product audit says the PostgreSQL/state/evaluation/authority/execution refactor materially improved NORTHSTAR. The major regression was concentrated in planning intelligence/orchestration and product presentation, not the PostgreSQL kernel.
- Of the accepted 26-row capability parity matrix, continued/sequential recovery is the one clear generic workflow-control gap. Provider/tool research has a workflow component, but its semantic contracts and evidence ownership remain NORTHSTAR work.
- R1 has already frozen the domain/planning contracts. On the parallel R1 implementation branch, C1-C8 contracts exist and the generalized RecoveryPlanningCoordinator core is already implemented. The concrete Recovery Lifecycle Progression service remains unfinished at the observed R1 HEAD.
- Current NORTHSTAR execution already uses a durable attempt state machine and forbids blind retry after a possibly-sent provider mutation.
- LangGraph JS/TS currently supports StateGraph, Commands and conditional routing, Postgres-backed checkpointers, interrupts/resume, node retry policies, durable node-boundary recovery, subgraphs, streaming and graph migrations.
- LangGraph resumes an interrupted/failed node from the beginning of that node. Code before an interrupt can run again.
- LangGraph checkpoint persistence is separate from NORTHSTAR's UnitOfWork unless NORTHSTAR builds a custom shared transactional integration.
- The open-source LangGraph library can run inside NORTHSTAR without LangGraph Platform or LangSmith. Agent Server/Platform adds a run queue and infrastructure but also adds operational and licensing coupling.

#### WHAT WE DO NOT KNOW

- Whether a real outer LangGraph wrapper around current NORTHSTAR services is materially less code than a small idempotent RecoveryLifecycleProgression reconcile-from-state service.
- Whether the JavaScript Postgres checkpointer behaves cleanly enough under NORTHSTAR's exact crash windows, dual-write windows and multi-worker conditions.
- Whether same-case wake concurrency can be kept simple in embedded OSS usage without adopting Agent Server.
- Whether graph upgrade/version handling for multi-hour or multi-day recovery cases is less operationally burdensome than NORTHSTAR's current recompute-from-authoritative-state approach.
- Whether synchronous checkpoint durability adds meaningful latency in the real recovery path.
- Whether checkpoint encryption/retention for the JavaScript implementation can meet NORTHSTAR privacy requirements without additional custom serializer or operational work.

#### KEY ASSUMPTION

LangGraph is allowed to be a disposable orchestration cursor only. NORTHSTAR PostgreSQL remains the sole business source of truth, and every graph node reloads current NORTHSTAR state before making a progression decision.

#### WHAT SHOULD BE TESTED NEXT

Run the isolated outer-workflow spike defined in section 18. Do not implement a planning subgraph and do not let LangGraph own provider side effects.

---

## 2. Scope and sources

### NORTHSTAR sources read

The investigation treats the following documents at the frozen planning SHA as authoritative intent:

- docs/PRODUCT_PARITY_TRUTH_REBASE_2026-09-18.md
- docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md
- docs/ARCHITECTURE.md
- docs/CAPABILITIES_AND_LIMITATIONS.md
- docs/ROADMAP.md
- docs/IMPLEMENTATION_PLAN.md
- docs/TESTING.md
- docs/work/ACTIVE_TASK.md
- AGENTS.md

Runtime/code/schema were treated as current implementation reality.

Current code inspected includes:

- src/app/runtimeServices.ts
- src/app/composeTargetBoot.ts
- src/app/target/recoveryPlanning.ts
- src/app/target/recoveryApproval.ts
- src/app/target/executionPass.ts
- src/app/target/recoveryCaseResolution.ts
- src/app/target/replanIdentity.ts
- src/persistence/postgres/commands/caseLifecycleCommands.ts
- src/persistence/postgres/execution/storedExecutionGate.ts
- src/persistence/postgres/execution/pgExecutionWorker.ts
- src/resolution/execution/stateMachine.ts
- src/resolution/planning/proposer.ts
- src/providers/atlas/adapter.ts
- src/providers/atlas/transactionAdapter.ts
- src/providers/atlas/stateReader.ts

Historical orchestration inspected as migration/reference evidence only:

- src/app/runtime.ts
- src/app/planningLoop.ts
- src/app/recoveryExecution.ts
- src/app/dispatch.ts

The parallel R1 implementation branch was inspected to understand current implementation progress, but it does not supersede accepted truth. At observed R1 HEAD 99a66fdd24ea02427b35ab78bd53dcb3ffb6a518, the pure Recovery Lifecycle Progression contract exists while its concrete lifecycle service remains uncompleted.

### Current LangGraph sources

Research used current official JavaScript/TypeScript documentation and package/reference sources, principally:

- Graph API: https://docs.langchain.com/oss/javascript/langgraph/graph-api
- Persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- Interrupts: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- Fault tolerance: https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance
- Streaming: https://docs.langchain.com/oss/javascript/langgraph/streaming
- Subgraphs: https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs
- Thinking in LangGraph: https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph
- JS checkpoint reference: https://reference.langchain.com/javascript/langchain-langgraph-checkpoint
- JS Postgres checkpointer reference: https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-postgres
- Core package: https://www.npmjs.com/package/@langchain/langgraph
- LangGraph.js source/license: https://github.com/langchain-ai/langgraphjs
- LangSmith/Agent Server data plane: https://docs.langchain.com/langsmith/data-plane

As of this audit, the core @langchain/langgraph package is 1.4.15 with built-in TypeScript declarations and MIT licensing. The JS PostgresSaver reference identifies the Postgres checkpointer package as a much younger versioned surface than the core package. That mismatch is a dependency-risk signal, not a rejection by itself.

No stale tutorial was used as decision evidence.

---

## 3. Non-negotiable architecture

LangGraph must not become a second NORTHSTAR domain engine.

NORTHSTAR continues owning:

- PostgreSQL authoritative business state
- Organisation, Traveller, Trip, Journey and Programme ontology
- Trip/Journey elements, objectives and constraints
- ChangeSignal
- dependency and blast-radius semantics
- deterministic M6 evaluation
- RC-6 counterfactual viability
- ScenarioChange
- RecoveryCase business semantics
- RecoveryStrategy
- RecoveryPlanningAttempt and decision evidence
- StrategyRecommendation validation
- policy and explicit preference truth
- authority, grants and approval truth
- ActionPlan and ActionIntent
- stored execution gate
- durable execution attempts
- provider idempotency and reconciliation
- provider observations
- canonical mutation
- reassessment and resolution correctness
- provider adapters and LIVE/RECORD/REPLAY normalization

The safety chain remains:

AI proposal  
→ validation  
→ deterministic viability  
→ authority  
→ executor  
→ observation  
→ canonical state  
→ reassessment

A LangGraph shell may call application services that enforce this chain. It may not shortcut it.

---

## 4. Product/domain failures versus workflow/orchestration failures

### A. Product/domain/integration failures

The accepted parity audit attributes the primary regression to product interpretation, integration, milestone scoping and acceptance testing. Examples include:

- generalized recovery-domain identification
- cross-domain proposal generation
- planning evidence/rejected alternatives
- recommendation semantics
- policy/preference use in planning
- focused Case surface
- traveller surface
- three separate impact semantics
- operator presentation regressions
- incomplete external composition

LangGraph does not solve these.

### B. Workflow/orchestration failures

Framework-addressable problems include:

- long-running progression across process restarts
- explicit pause/resume
- waiting for approval or external state
- routing after reassessment
- bounded repeated planning
- workflow checkpoint/cursor
- orchestration-level retry for safe/read-only nodes
- visibility into current workflow step
- handling deploy/restart while a case remains open

LangGraph may solve these.

### Quantification

There is no incident telemetry that supports an honest numerical percentage of recent pain, so this audit does not fabricate one.

Two structural measures are available:

1. In the accepted 26-capability parity matrix, continued/sequential recovery is the single clear generic workflow-control regression. Provider/tool research has an orchestration component, but the required research protocol, domain selection, evidence model and resulting planning truth remain NORTHSTAR-owned.
2. In R1, the C1-C7 planning/evidence contracts remain valuable regardless of framework choice, and even C8's pure RESOLVE/WAIT/REPLAN/ESCALATE decision remains business/application logic. The potentially replaceable item is the concrete scheduler/wait/wake/progression runner around C8.

Conclusion: generic workflow plumbing is a meaningful problem but a minority of the product regression. Adopting LangGraph cannot be justified as the fix for NORTHSTAR's recent product failures.

---

## 5. Current NORTHSTAR orchestration model

NORTHSTAR's current target architecture is more state-reconciliatory than process-continuation-based.

Key facts:

- runtimeServices.ts owns process-local periodic services and coalesced runNow wake-ups.
- composeTargetBoot.ts periodically runs reassessment, case lifecycle and internal execution passes.
- approvals trigger execution.runNow.
- completed reassessment triggers lifecycle and execution wake-ups.
- execution completion triggers lifecycle.runNow.
- case business phases are persisted in PostgreSQL and transitions are guarded.
- currentness is checked at planning, approval/ActionPlan compilation and again at stored execution gate time.
- execution attempts are persistent and independently resumable.
- resolution is recomputed from current authoritative state.

This matters because the current architecture can recover from a process restart by recomputing runnable work from PostgreSQL; it does not require an in-memory call stack to survive.

The missing capability is not "persistence in general." It is generalized continued-recovery progression and its operational lifecycle.

---

## 6. LangGraph JS/TS current capability assessment

### StateGraph, Commands and routing

Fit: strong.

StateGraph models nodes plus explicit edges/conditional routing. Command can combine state updates and goto. That maps cleanly to generic progression around existing application services.

NORTHSTAR should use graph state only for lightweight orchestration references, for example:

{
  workflowVersion,
  workspaceId,
  recoveryCaseId,
  basisAssessmentId,
  planningAttemptRef,
  recommendedStrategyRef,
  actionPlanRef,
  executionAttemptRef,
  waitReason,
  correlationId
}

Traveller, Journey, Programme, bookings, assessments, provider truth, approvals and execution truth should not be copied into graph state.

This lightweight model is practical. LangGraph does not require graph state to contain the whole business domain.

### Persistence and Postgres checkpointer

Fit: technically strong, architecturally mixed.

A checkpointer persists graph state at super-step boundaries under a thread_id. JS PostgresSaver exists, supports a custom schema and has setup/migration support.

NORTHSTAR could use the same PostgreSQL server with a separate LangGraph schema. It should not put checkpoint rows inside NORTHSTAR business tables.

This creates two persistence domains:

- NORTHSTAR tables: authoritative business truth
- LangGraph checkpoint tables: disposable workflow cursor/history

That separation is acceptable only if every graph node can re-derive what to do from NORTHSTAR state after checkpoint loss or replay.

### Durable execution and replay

Fit: useful for orchestration, dangerous if misunderstood.

Current docs are explicit: checkpoint boundaries are node/super-step boundaries. If a run stops and later resumes, the affected node may run again from the beginning. An interrupted node also restarts from its beginning; code before interrupt runs again.

Therefore:

- read-only planner/research nodes may use controlled retry
- business commands must be idempotent/currentness-guarded
- an approval-wait node must interrupt before any consequential action
- no provider mutation may be performed directly by a graph node
- provider retry policy must never be delegated to LangGraph

NORTHSTAR's current execution model already has the correct safety properties for this.

### Durability modes

LangGraph JS documents three relevant durability choices:

- async: checkpoints are written in the background; default, lower latency
- sync: execution blocks until the checkpoint is persisted
- exit: persistence at completion/interrupt/error rather than every step

For a spike, use sync for the outer recovery workflow. Safety and testability matter more than saving a small checkpoint write. After correctness is established, async can be measured for purely recoverable/read-only stretches.

Do not use exit for the first outer-workflow proof because it weakens the exact crash/restart behavior this spike is meant to evaluate.

### Interrupts / human-in-the-loop

Fit: mechanically excellent, semantically subordinate to NORTHSTAR.

LangGraph can wait indefinitely and resume using the same thread. However the resume payload must never be authoritative approval.

Correct pattern:

1. NORTHSTAR endpoint validates and persists approval truth.
2. The application wakes the graph using the case/thread correlation.
3. The resumed graph reloads NORTHSTAR state.
4. NORTHSTAR currentness and authority gates determine what is now permitted.
5. The graph routes based on the fresh result.

An interrupt is a wait cursor, not approval truth.

### Retry policies

Fit: useful only for safe operations.

LangGraph retries are opt-in and configurable per node. They are appropriate for transient model/read API failures where replay is safe.

Provider consequential retries remain NORTHSTAR-owned. The graph node that requests execution should have no automatic retry policy that can reach a provider mutation.

### Concurrency

Fit: unresolved for embedded OSS usage.

StateGraph supports parallel nodes, but NORTHSTAR's concern is different: concurrent invocations against the same RecoveryCase/thread.

NORTHSTAR needs an explicit one-case workflow run/lease or equivalent serialization rule. Do not assume Agent Server's run-queue or "double texting" controls exist in the embedded open-source library.

Even with a serialized graph thread, all business writes must continue relying on NORTHSTAR's guarded transitions, expected revisions, basis manifests, idempotency keys and stored execution gates.

### Subgraphs

Fit: technically available, not justified for R1 planning yet.

A planning/research subgraph can support interrupts and its own persistence patterns. But R1 now has a bounded coordinator, a durable RecoveryPlanningAttempt and explicit evidence semantics. Adding graph checkpoint state inside planning would duplicate control/evidence boundaries before there is a demonstrated long-running planning need.

Keep planning as an application service for now.

### Streaming and observability

Fit: useful.

LangGraph can stream updates, values, tasks, debug information and event projections. This would improve engineering visibility and could provide a generic workflow-progress feed.

It must not become product truth. NORTHSTAR's operator/traveller UI should continue deriving semantic status from NORTHSTAR records.

LangSmith tracing is optional and should be disabled by default for the spike to avoid sending traveller context to an external observability system.

### Graph upgrades/versioning

Fit: manageable but a real operational obligation.

Current Graph API documentation says:

- completed/non-interrupted threads can tolerate broad topology changes
- interrupted threads cannot safely tolerate node rename/removal
- adding/removing state keys is generally compatible
- renamed state keys lose saved values
- incompatible state-type changes can break old threads
- resumed runs execute against the currently compiled graph

NORTHSTAR therefore needs explicit workflowVersion in graph state and a version-aware resume policy. Open cases must never silently resume through an incompatible graph definition.

### Checkpoint retention/privacy

Fit: acceptable with explicit controls.

All tracked graph-state channel values are serialized into checkpoints. Therefore state minimization is mandatory.

The persistence docs warn that checkpoints can grow unbounded and recommend pruning/retention policies. PostgresSaver exposes thread deletion. OSS usage should define a retention/deletion job aligned with NORTHSTAR case-retention requirements.

The official encryption material is clearer on Python than JavaScript. JavaScript checkpointers expose a serializer protocol, but this audit does not assume a built-in JS EncryptedSerializer with parity to Python. The spike must verify supported JS encryption or rely on hardened PostgreSQL-at-rest encryption plus a custom serializer if application-layer encryption is required.

### Deployment / platform

Open-source LangGraph itself is MIT and can be embedded in the current Node/TypeScript service.

That is the only deployment shape recommended for the spike.

LangGraph Agent Server / LangSmith Deployment offers a durable run queue, server/worker coordination and managed persistence, but introduces additional infrastructure and licensing/platform coupling. The documented data plane uses PostgreSQL plus Redis for worker wake/cancellation/streaming coordination.

NORTHSTAR should not adopt Agent Server merely to make the LangGraph fit argument work.

---

## 7. Responsibility matrix

| Responsibility | Current owner | Should remain NORTHSTAR? | Could LangGraph own generic control? | Why |
|---|---|---:|---:|---|
| Canonical state mutation | NORTHSTAR commands/UoW | Yes | No | Business truth and revision semantics |
| Reassessment | M6 + PG reassessment worker | Yes | Wake/route only | Evaluation is deterministic domain truth |
| RecoveryPlanningCoordinator | R1 NORTHSTAR application service | Yes | Invoke only | Owns domain selection, evidence and RC-6 composition |
| Read-tool loop | R1 research dispatcher | Yes for semantics/budget | Maybe later | Bounded/read-only loop already exists; graph adds little now |
| StrategyProposer | NORTHSTAR proposer port | Yes | No | Proposal semantics and schema validation |
| RC-6 | NORTHSTAR deterministic evaluator | Yes | No | Core viability safety |
| RecoveryPlanningAttempt | NORTHSTAR PG | Yes | No | Decision evidence and audit truth |
| Recommendation | NORTHSTAR comparator/validator | Yes | No | Preference precedence and viable-only semantics |
| Approval truth | NORTHSTAR authority/approval tables | Yes | Wait only | Interrupt is not authority |
| Waiting | periodic/event wake today | No, generic control may move | Yes | Strong LangGraph fit |
| Execution request | NORTHSTAR ActionPlan/Intent + prepare path | Yes | Invoke only | Must persist durable intent/attempt |
| Execution worker | PgExecutionWorker/internal executor | Yes | No | Stored gate, fencing, no-blind-retry |
| Provider retry | NORTHSTAR execution/reconciliation | Yes | No | Safety critical |
| Reconciliation | NORTHSTAR worker/provider reader | Yes | Wake/route only | Provider truth and lineage |
| Observation | NORTHSTAR execution_observations | Yes | No | Provider-owned truth |
| Continued recovery decision | C8 deterministic progression decision | Yes | Route on result | Business semantics stay frozen |
| Continued recovery scheduling | not yet generalized | No | Yes, candidate | Main Option 1 target |
| Resolution | NORTHSTAR resolution gate/command | Yes | Invoke only | Recovery correctness |
| Escalation semantics | NORTHSTAR case service | Yes | Invoke/route only | Product/business state |
| Workflow progress streaming | basic runtime logs/activity today | No | Yes for debug/runtime events | LangGraph streaming can help; product UI still PG-derived |

---

## 8. Four architecture options

### Option 0 — Current bespoke orchestration

Description: complete Recovery Lifecycle Progression as a small idempotent reconcile-from-PostgreSQL service under runtimeServices.

Strengths:

- one persistence truth/cursor for business progression
- no framework dependency
- no checkpoint/business dual-write
- current approval/execution/reassessment states already survive restarts
- straightforward to reason about safety
- smallest operational footprint

Weaknesses:

- NORTHSTAR must continue building generic wait/wake/progression behavior
- explicit workflow execution history and node-level restart semantics remain bespoke
- workflow visualization/debug tracing is weaker
- future branching and multiple external waits can grow custom plumbing

Critical observation: Option 0 is stronger than a naive "home-grown in-memory state machine." It intentionally recomputes from persisted state, which removes much of the durability work LangGraph would otherwise save.

### Option 1 — LangGraph outer workflow only

Description:

assess/currentness  
→ planCase  
→ wait/approve  
→ request execution  
→ wait/observe/reconcile  
→ reassess  
→ progressCase  
→ replan / resolve / escalate

Each node calls NORTHSTAR application services and reloads authoritative state.

Strengths:

- best match to LangGraph's genuine strengths
- explicit durable workflow cursor
- native interrupt/resume mechanics
- explicit conditional routing/looping
- restart and graceful-drain primitives
- useful runtime streaming/debug state
- NORTHSTAR planning/domain engine remains intact
- framework can remain replaceable if wrapped behind a narrow adapter

Weaknesses:

- adds checkpoint persistence and graph-version lifecycle
- cannot atomically commit a NORTHSTAR UoW and a LangGraph checkpoint without custom work
- embedded OSS still needs a durable way to wake/resume a case after external events/process downtime
- same-case concurrent invocations require explicit discipline
- checkpoints create retention/privacy obligations

Assessment: highest-value candidate, but must pass the spike.

### Option 2 — LangGraph planning/research subgraph only

Description: use a subgraph for recovery-domain analysis, evidence gaps, read-tool rounds and proposer loops; keep case lifecycle bespoke.

Strengths:

- bounded iterative research is a natural graph
- node-level retries/visibility can help model/read-tool work
- may become useful if planning grows into long-running, multi-agent research

Weaknesses:

- R1 already has a bounded coordinator, research budget, dedupe and durable PlanningAttempt
- duplicates planning control state against the accepted evidence model
- does not solve NORTHSTAR's most valuable workflow gap: multi-hour/multi-day case progression
- more checkpoint data and more state to reconcile
- risks making proposers/coordinator aware of framework semantics

Assessment: do not adopt now. Park behind a future demonstrated planning-complexity requirement.

### Option 3 — LangGraph outer workflow + planning subgraph

Strengths:

- maximum framework reuse
- one framework can visualize both macro and micro control flow

Weaknesses:

- largest integration footprint
- more checkpoint/domain duplication
- harder versioning and debugging
- greater framework coupling
- unnecessary because R1 planning is already becoming clean application code
- broad migration would obscure whether the outer shell alone creates value

Assessment: reject for current milestone scope. It violates the "dream big, build small" discipline unless Option 1 proves itself and later evidence shows the planning coordinator is actually a problem.

---

## 9. Cross-option evaluation

| Dimension | Option 0 bespoke | Option 1 outer only | Option 2 planning only | Option 3 outer + planning |
|---|---|---|---|---|
| Code complexity | Low now; grows with workflow features | Medium initial, potentially lower lifecycle plumbing | Adds framework around already-bounded planning | Highest |
| Business SSOT | Excellent | Good if checkpoint is disposable cursor | Good but planning-state duplication risk | Highest duplication risk |
| Crash recovery | Recompute from PG; simple | Strong node/thread resume plus PG re-read | Helps planning only | Strong but complex |
| Approval waiting | PG + poll/wake | Native interrupt plus PG truth | No improvement | Native |
| Side-effect safety | Excellent existing path | Excellent only if graph never dispatches provider | Mostly irrelevant | More surfaces to police |
| External events | Existing poll/runNow | Needs app wake/outbox/sweeper in OSS | No major benefit | Same outer issue |
| Retry separation | Fully app-owned | Good with strict node policies | Useful for read-only research | More policy surfaces |
| Same-case concurrency | PG guards + service discipline | Requires thread/run serialization plus PG guards | Planning attempt guards | Most complex |
| Dual-write consistency | None beyond current domain writes | Real checkpoint/UoW window | Real checkpoint/PlanningAttempt window | Most dual-write surfaces |
| Workflow versioning | App code + PG state | New explicit graph-version obligation | Planning graph version obligation | Both |
| Testability | Good state-reconcile tests | Potentially excellent restart/interrupt tests | Good but duplicated with coordinator tests | Large test matrix |
| Observability | Modest | Strong runtime graph visibility | Strong planning trace only | Strongest, but no product truth gain |
| Security/privacy | Existing PG controls | Extra checkpoint schema/retention | More research payload risk | Highest checkpoint exposure |
| Deployment | Existing Node+PG | + LangGraph + checkpointer; still one service possible | Same | Same plus more graph code |
| Performance | No graph checkpoint overhead | Sync checkpoint cost between coarse nodes | More frequent planning checkpoints | Highest checkpoint volume |
| Package/platform risk | None | Moderate and isolatable | Moderate | Highest |
| NORTHSTAR fit | Native | Strong if service wrappers stay clean | Weak-to-moderate now | Premature |

---

## 10. State ownership and the dual-write problem

This is the central adoption risk.

LangGraph and NORTHSTAR cannot share one atomic transaction through ordinary PostgresSaver usage.

### Failure window A: NORTHSTAR commit succeeds, LangGraph checkpoint fails

Example:

1. planCase commits RecoveryPlanningAttempt and viable RecoveryStrategy rows.
2. Node returns a lightweight result.
3. LangGraph checkpoint write fails or process dies before checkpoint completion.
4. The graph runs the node again.

Required behavior:

- node reloads NORTHSTAR state first
- it recognizes the completed planning attempt for the same case/basis
- it returns the already-existing references
- no duplicate business operation occurs
- progression continues

This is safe if all graph-facing NORTHSTAR commands are idempotent and basis/currentness guarded.

### Failure window B: LangGraph checkpoint succeeds, NORTHSTAR command fails

A correctly written node should not return "business success" before the NORTHSTAR service succeeds. If the NORTHSTAR command throws, LangGraph must not checkpoint a successful node update. If NORTHSTAR returns a structured refusal, the node can checkpoint a refusal/reference and route to re-read/reassess/escalate.

The graph checkpoint can record "last attempted route," but cannot assert that business state changed.

### Is this acceptable?

Potentially yes.

The architecture must explicitly make NORTHSTAR writes authoritative and LangGraph checkpoints disposable/reconstructable. This is a convergence model, not a distributed transaction.

Trying to build two-phase commit between NORTHSTAR business tables and LangGraph checkpoint tables would be a rejection signal. It would erase much of the simplicity benefit.

### Major decision record

#### WHAT WE KNOW

NORTHSTAR's command surface already contains idempotency/currentness/revision guards, and its execution path is specifically designed to survive replay and uncertain external outcomes.

#### WHAT WE DO NOT KNOW

Whether every proposed outer-workflow node can satisfy replay-safe convergence in practice, especially when checkpoint writes are deliberately fault-injected.

#### KEY ASSUMPTION

A LangGraph checkpoint is allowed to lag NORTHSTAR business truth and be repaired by replay/re-read.

#### WHAT SHOULD BE TESTED NEXT

Fault-inject both dual-write directions in the spike. Adoption fails if correctness requires a shared atomic transaction or authoritative business fields in graph state.

---

## 11. Special side-effect test

Scenario:

1. LangGraph requests execution.
2. NORTHSTAR stores durable execution attempt.
3. Provider request succeeds.
4. Network response is lost.
5. LangGraph process crashes.
6. Workflow resumes.

Correct design:

### Step 1 — graph node

The graph's requestExecution node calls a NORTHSTAR service that prepares/locates the durable execution attempt and returns its reference. It does not invoke Atlas or any provider mutation directly.

### Step 2 — NORTHSTAR worker

PgExecutionWorker owns provider dispatch.

It:

- claims the prepared attempt
- re-runs the stored execution gate
- commits CLAIMED → DISPATCHING before the network call
- then invokes the provider adapter

### Step 3 — provider succeeds but response is lost

If the process receives a lost-response result or exception, the worker records OUTCOME_UNKNOWN.

If the process hard-crashes after the provider call but before it can record OUTCOME_UNKNOWN, the database still contains DISPATCHING. That status itself means "may have been sent."

### Step 4 — restart/resume

LangGraph resumes and reloads the execution attempt.

For DISPATCHING, DISPATCHED, OUTCOME_UNKNOWN or RECONCILIATION_REQUIRED, it must not request a fresh provider mutation. It routes to wait/reconciliation.

NORTHSTAR's reconciliation worker/provider reader continues the same attempt lineage and performs provider lookup.

Only after authoritative reconciliation may later business progression continue.

### Result

NO BLIND RETRY is preserved.

LangGraph node retries must be disabled for any wrapper whose call can reach the provider dispatcher. Preferably the graph never calls the dispatcher at all; it requests work and observes durable NORTHSTAR status.

This design is sound and aligns with the existing M8 execution model.

---

## 12. Special approval test

Scenario:

1. viable strategy recommended
2. operator approval required
3. workflow pauses for six hours
4. provider state changes
5. operator clicks approve
6. workflow resumes

Correct design:

1. Graph reaches waitForApproval and interrupts. Its checkpoint contains refs only.
2. Provider change enters NORTHSTAR through normal ingestion/canonical state/invalidation.
3. Operator approval request is handled by NORTHSTAR, not by a LangGraph resume payload.
4. NORTHSTAR compiles/authorizes from current stored strategy and performs existing currentness checks.
5. The application wakes the graph.
6. Resumed graph reloads case, current assessment, strategy/plan and authority state.
7. If the old recommendation/basis is stale, the route is reassess/replan. It must not use "resume approved=true" as permission to execute.
8. Even if an approval existed, the stored execution gate performs another currentness/authority check immediately before dispatch.

Important LangGraph rule: code before interrupt is re-run on resume. Therefore the wait node should perform no consequential write before interrupt, or any pre-interrupt bookkeeping must be idempotent.

### Result

A stale interrupt never means stale approval executes.

LangGraph can improve the waiting mechanic without owning approval truth.

---

## 13. Special concurrent-signal test

Scenario:

1. Case is planning.
2. New provider signal arrives.
3. Canonical state changes.
4. Old LangGraph planning checkpoint exists.
5. Planner finishes from stale basis.

Correct design:

- RecoveryPlanningAttempt remains bound to basisAssessmentId and basis manifest.
- New canonical state invalidates the previous current assessment.
- planning result may be retained as historical attempt evidence, but currentness validation must prevent stale promotion/recommendation/action.
- next graph node reloads current NORTHSTAR state.
- mismatch between checkpoint basis and current basis routes back through reassessment/replanning.
- no old recommendedStrategyRef is trusted merely because it is in graph state.
- duplicate case triggers should wake or enqueue the same deterministic thread, not create competing authoritative workflows.
- NORTHSTAR command/currentness guards remain the final protection if two graph invocations race.

### Remaining uncertainty

Embedded OSS LangGraph does not, by itself, establish NORTHSTAR's desired same-RecoveryCase trigger serialization contract. That must be proven with two concurrent callers/workers in the spike or provided by a small application-level per-case lease.

---

## 14. External events and wake-up semantics

LangGraph interrupts solve "where do I resume?" after an invocation is resumed.

They do not by themselves solve "who durably notices an external event and invokes the graph?"

For embedded OSS usage, NORTHSTAR still needs a wake source for:

- provider result/webhook
- reassessment completion
- traveller decision
- operator approval
- reconciliation completion
- timer/date-based re-evaluation

Existing runtime hooks and periodic reconcile passes can do this, or NORTHSTAR can add a tiny durable outbox/work queue later if required.

Agent Server provides more of this operational run-queue behavior, but it uses additional platform infrastructure. Adopting Agent Server merely to obtain wake-up semantics would substantially change the operational trade-off.

This is one reason the spike must use embedded OSS LangGraph first.

---

## 15. Workflow versioning strategy if adopted

Required rules:

1. Persist workflowVersion in graph state.
2. Derive deterministic thread identity from workspace + RecoveryCase, not traveller PII.
3. Keep a small graph-version registry in application code.
4. On resume, load NORTHSTAR case first.
5. If checkpoint workflowVersion is compatible, resume using the registered graph.
6. If incompatible, do not silently run the current graph. Either:
   - migrate the lightweight checkpoint, or
   - start a new workflow cursor from authoritative NORTHSTAR state and retire/delete the old thread.
7. Never rename/remove a node that may be the resume target of an interrupted production thread without a migration/restart plan.
8. Keep graph state small enough that restarting from NORTHSTAR truth is always viable.

This makes LangGraph replaceable.

---

## 16. Security, privacy and operations

### Checkpoint minimization

Tracked checkpoint state should contain identifiers and workflow metadata only.

Never checkpoint:

- passport/identity details
- full Traveller objects
- itinerary/booking payloads
- provider raw responses
- approval documents
- assessment bodies
- model prompts containing PII when not required
- secrets or provider credentials

Use runtime context/untracked values for DB clients and transient infrastructure objects.

### Encryption

Use TLS to PostgreSQL and encryption at rest as baseline.

Before production adoption, verify current JavaScript application-layer checkpoint encryption support. If not adequate, either implement a SerializerProtocol wrapper or keep checkpoint content non-sensitive enough that database-level encryption is sufficient under the security model.

### Retention

Define a checkpoint retention policy. Delete completed/expired case threads after the required operational/audit window. NORTHSTAR audit/business evidence remains in NORTHSTAR tables; checkpoint history is not the audit record.

### LangSmith

Not required.

Do not enable external LangSmith tracing for the spike. If later enabled, perform a separate privacy/security review and aggressively redact metadata/state.

### Deployment

Preferred adoption shape, if the spike passes:

current NORTHSTAR Node service  
+ @langchain/langgraph  
+ JS PostgresSaver  
+ dedicated checkpoint schema in existing PostgreSQL infrastructure

Do not add Redis, Kubernetes, Agent Server or LangGraph Platform for the initial integration.

---

## 17. Package/platform risk

### Core JS maturity

Positive signals:

- TypeScript-native package
- active current release line
- built-in TS declarations
- substantial ecosystem usage
- MIT license
- first-class JS/TS docs
- current fault-tolerance features are being actively expanded

Risks:

- high release velocity means API churn exposure
- checkpoint package versioning does not mirror core package maturity
- current docs contain both library and platform capabilities; it is easy to accidentally design around Agent Server features that are not present in an embedded graph
- upgrade behavior matters more for NORTHSTAR because cases can remain open across deploys

Mitigation if adopted:

- pin exact versions
- wrap LangGraph behind NORTHSTAR-owned orchestration adapter
- add resume/upgrade integration tests
- upgrade only at explicit checkpoints
- keep domain services framework-agnostic

---

## 18. Proposed spike

Do not implement this from the investigation branch.

### Branch

spike/langgraph-outer-workflow

Base it on the latest accepted/integrated R1 state that contains the production RecoveryPlanningCoordinator seam. If R1 has not been accepted, create the spike from the integration candidate explicitly and do not merge it into main.

### Maximum budget

Hard cap: one engineering day, approximately 8 focused engineering hours.

Stop early if the spike requires:

- changing domain contracts
- moving approval/execution truth into LangGraph
- a custom distributed transaction
- LangGraph Platform/Agent Server
- direct provider mutation from graph nodes

### Experimental files

Suggested isolated files:

- src/app/experimental/langgraph/recoveryWorkflowState.ts
- src/app/experimental/langgraph/recoveryWorkflow.ts
- src/app/experimental/langgraph/recoveryWorkflowNodes.ts
- src/app/experimental/langgraph/checkpointer.ts
- test/langgraph-recovery-workflow.test.ts
- postgres-integration/langgraphRecoveryWorkflow.pgtest.ts

No duplicate domain models.

### Graph state

Only:

- workflowVersion
- workspaceId
- recoveryCaseId
- basisAssessmentId
- planningAttemptRef
- recommendedStrategyRef
- actionPlanRef
- executionAttemptRef
- waitReason
- correlationId

All fields except identity/version are nullable/optional references.

### Nodes

1. loadCurrentCase
   - reload NORTHSTAR PostgreSQL truth
   - terminate/route if case already terminal
2. reassessOrLoadCurrent
   - call existing reassessment/current-view service
3. planCase
   - call actual R1 RecoveryPlanningCoordinator
4. waitForApproval
   - interrupt before consequential action
   - resume payload is wake metadata only
5. requestExecution
   - call NORTHSTAR prepare/request service only
   - no provider call
6. waitForObservation
   - inspect durable attempt/reconciliation state
   - interrupt/end current invocation when waiting
7. progressCase
   - call pure C8 progression decision using freshly loaded facts
   - RESOLVE/WAIT/REPLAN/ESCALATE routing
8. resolveOrEscalate
   - invoke existing NORTHSTAR commands/gates

A separate application wake adapter invokes the graph when NORTHSTAR approval, reassessment, observation or reconciliation state changes.

### Persistence

- JS PostgresSaver
- separate checkpoint schema
- sync durability for the spike
- deterministic thread id from workspaceId + recoveryCaseId
- no LangSmith
- no Agent Server

### Tests

Focused tests first.

#### Pure/module

- graph routes current C8 RESOLVE/WAIT/REPLAN/ESCALATE results correctly
- checkpoint state schema rejects domain payloads
- interrupt node performs no consequential pre-interrupt side effect
- provider dispatcher is impossible to call from graph-node dependencies

#### PostgreSQL/restart integration

1. restart after planning checkpoint, same case resumes without duplicate PlanningAttempt
2. restart while interrupted for approval
3. six-hour approval simulation with provider state change; stale basis cannot execute
4. execution lost response; provider mutation call count remains exactly one
5. resume from DISPATCHING/OUTCOME_UNKNOWN routes to reconciliation
6. new provider signal while planning; old basis cannot become current recommendation/action
7. two concurrent invocations for the same RecoveryCase; no duplicate business progression
8. NORTHSTAR commit succeeds while checkpoint write is faulted; rerun converges
9. NORTHSTAR command fails; graph does not checkpoint false business completion
10. graph v1 interrupted checkpoint resumed under compatible v2
11. incompatible workflowVersion is refused/restarted from NORTHSTAR truth, never silently continued
12. checkpoint inspection confirms only lightweight refs and workflow metadata
13. thread deletion/retention behavior verified
14. process SIGTERM/graceful drain and hard restart both converge safely

### Adoption criteria

Adopt Option 1 only if all are true:

- all safety/restart/currentness tests pass
- no domain contract changes are required
- no provider side effect is performed by LangGraph
- no business truth is moved to checkpoints
- no Agent Server/Platform is required
- no custom two-phase transaction is required
- lifecycle/wait/wake code is materially simpler than the equivalent bespoke progression service
- framework boundary can be removed and the same application services reused
- checkpoint/version/retention operations are understandable and bounded

### Rejection criteria

Reject LangGraph and finish Option 0 if any are true:

- graph checkpoints need authoritative business objects to work cleanly
- safe recovery requires atomic checkpoint + NORTHSTAR business transactions
- same-case concurrency requires substantial custom coordination beyond a simple lease/dedupe
- graph upgrade/versioning is harder than recompute-from-PG
- embedded OSS still requires enough custom wake/progression machinery that code complexity is not reduced
- JS PostgresSaver behavior under restart/fault injection is unreliable
- checkpoint privacy/retention cannot be kept simple
- the implementation pressures NORTHSTAR to distort RC-6, RecoveryCase, ActionPlan, authority or execution semantics

---

## 19. R1 interaction

### KEEP REGARDLESS OF LANGGRAPH

- RecoveryPlanningCoordinator
- recovery-domain registry/identification
- bounded read-only research protocol and dispatcher
- StrategyProposer interface and domain proposers
- proposal validation
- RC-6
- RecoveryPlanningAttempt
- decision/rejection evidence
- three impact semantics
- viable-only recommendation/comparator/currentness validation
- current RecoveryCase/ActionPlan/ActionIntent contracts
- C8 pure RecoveryProgressionDecision and its RESOLVE/WAIT/REPLAN/ESCALATE semantics

### LIKELY REPLACED BY LANGGRAPH IF OPTION 1 PASSES

Only generic lifecycle-runner mechanics:

- durable workflow cursor
- wait/resume bookkeeping
- routing between plan/wait/execute-observe/reassess/progress
- generic restart-at-step behavior
- workflow-level debug/progress stream

### ADAPTED AS LANGGRAPH NODE WRAPPERS

- load/reassess
- planCase
- request/observe approval state
- request execution
- observe/reconcile execution state
- progressCase
- resolve
- escalate

The wrappers should be thin. If they begin re-implementing domain rules, adoption has failed.

### DO NOT LET QODER BUILD YET IF SPIKE IS ACTIVE

Pause the concrete C4 Recovery Lifecycle Progression scheduler/service implementation before it grows into polling/wait/wake/retry plumbing.

Do not pause R1 planning/evidence work.

Qoder can continue:

- coordinator integration
- PlanningAttempt persistence
- proposer/research work
- recommendation/currentness
- pure C8 contract/tests
- generality proof
- PostgreSQL acceptance preparation

The avoided work is the concrete long-running progression runner only.

### Should Qoder pause before its lifecycle-progression checkpoint?

Yes.

Pause before the C4 concrete lifecycle-progression checkpoint, while allowing all non-lifecycle R1 work to continue.

The observed R1 branch is at the ideal point: the C8 decision contract already exists, but the concrete service is still pending.

---

## 20. Code expected to disappear or shrink if Option 1 is adopted

Do not count already-retired historical code as LangGraph savings.

Potential production simplification:

- future custom durable RecoveryLifecycleProgression scheduler implementation would not be built
- case lifecycle polling/wake composition in composeTargetBoot.ts could shrink into graph wake entry points plus a minimal recovery sweeper
- future bespoke wait-state/resume/cursor tables or runner logic would be avoided
- some ad hoc lifecycle runNow chaining between approval, execution, reassessment and continuation could become explicit graph routing
- workflow-debug/progress plumbing could use LangGraph runtime events rather than a parallel custom mechanism

What probably does not disappear:

- runtimeServices.ts as a whole; reassessment/execution workers still exist
- PostgreSQL lifecycle statuses
- case transition commands
- RecoveryPlanningCoordinator
- PlanningAttempt
- authority/approval persistence
- execution workers/state machines
- reconciliation workers
- provider adapters
- resolution gates

Historical runtime.ts, planningLoop.ts and recoveryExecution.ts are migration/reference code already outside the normal target path. Their retirement is not a benefit attributable to LangGraph.

---

## 21. Code expected to remain

The majority of the real engine remains NORTHSTAR:

- src/resolution/evaluation/**
- src/resolution/scenarios/**
- src/resolution/planning/** domain/planning logic
- current R1 coordinator/evidence/comparator contracts and implementation
- PostgreSQL current-state/manifests/invalidation
- RecoveryCase persistence and guarded transitions
- authority/grant/approval implementation
- ActionPlan/ActionIntent compilation
- storedExecutionGate.ts
- pgExecutionWorker.ts
- resolution/execution/stateMachine.ts
- observation/reconciliation
- recoveryCaseResolution.ts
- provider runner/adapters
- Atlas read and transaction adapters
- LIVE/RECORD/REPLAY normalization
- operator/traveller semantic read models

This is the correct outcome. If adopting LangGraph deletes large parts of those areas, the architecture has crossed the allowed boundary.

---

## 22. Issue triage

| Issue / risk | Classification | Decision |
|---|---|---|
| Decide whether outer LangGraph is materially simpler than C4 bespoke runner | Investigate Now | Run one-day spike |
| Qoder building concrete C4 lifecycle runner while fit is unresolved | Act Now | Pause C4 concrete runner only |
| R1 planning/evidence work | Act Now | Continue; do not block |
| LangGraph directly invoking provider mutation | Act Now | Prohibit architecturally |
| Checkpoint vs NORTHSTAR dual-write window | Investigate Now | Fault-inject both directions in spike |
| Same RecoveryCase concurrent graph invocation | Investigate Now | Prove serialization/convergence |
| Stale approval resume | Act Now | Resume must re-read NORTHSTAR and recheck currentness |
| Stale planning basis after new signal | Act Now | Promotion/currentness must reject old basis |
| Workflow graph version migration | Investigate Now | Test v1 interrupted → v2 resume/refusal |
| JS PostgresSaver maturity/version compatibility | Investigate Now | Pin exact versions and test |
| Checkpoint encryption support in JS | Investigate Now | Verify before adoption |
| Checkpoint retention/deletion | Investigate Now | Define explicit policy and test delete |
| Async durability optimization | Park for Later | Start with sync; measure only after correctness |
| Planning/research subgraph | Park for Later | Revisit only if R1 coordinator becomes long-running/complex |
| LangGraph Agent Server / Platform | Park for Later | Not needed for spike; reconsider only if durable run queue becomes a proven need |
| LangSmith cloud tracing | Park for Later | Keep off until privacy review |
| Historical RuntimeOrchestrator restoration | Ignore / Accept Risk | Remains retired |
| SQLite runtime resurrection | Ignore / Accept Risk | Remains prohibited |
| Rewriting RC-6/authority/execution for framework fit | Ignore / Accept Risk | Explicitly rejected |
| Core LangGraph dependency churn if adopted | Ignore / Accept Risk | Accept only with exact pinning + upgrade tests after spike passes |

---

## 23. Major conclusion records

### Conclusion A — LangGraph is not the missing NORTHSTAR domain engine

#### WHAT WE KNOW

Most recent regressions were product/planning/presentation integration failures. The accepted deterministic PostgreSQL kernel is stronger than the pre-refactor engine.

#### WHAT WE DO NOT KNOW

Whether future workflow scale would eventually expose more generic orchestration pain than is visible today.

#### KEY ASSUMPTION

Current accepted product truth remains stable through this decision.

#### WHAT SHOULD BE TESTED NEXT

Nothing in the domain engine. Test only the outer workflow shell.

### Conclusion B — Option 1 is the only current LangGraph shape worth serious testing

#### WHAT WE KNOW

Outer progression has real wait/resume/restart/routing needs, while R1 planning already has bounded application-owned contracts and durable evidence.

#### WHAT WE DO NOT KNOW

Whether outer LangGraph removes enough real code to justify checkpoint/version/wake complexity.

#### KEY ASSUMPTION

A thin wrapper can call actual NORTHSTAR services without those services importing LangGraph.

#### WHAT SHOULD BE TESTED NEXT

Implement the bounded Option 1 spike only.

### Conclusion C — NORTHSTAR's execution safety composes cleanly with a replaying workflow engine

#### WHAT WE KNOW

The stored execution gate, durable DISPATCHING state, OUTCOME_UNKNOWN semantics, effect-scoped identity and reconciliation path already prevent blind provider retry.

#### WHAT WE DO NOT KNOW

Whether an accidental graph-level retry policy or future wrapper could reintroduce an unsafe call path.

#### KEY ASSUMPTION

The graph receives no provider dispatcher capability.

#### WHAT SHOULD BE TESTED NEXT

Dependency-test graph nodes so the provider dispatcher cannot be reached, then execute the lost-response crash test.

### Conclusion D — the dual-write problem is tolerable only if checkpoint state is disposable

#### WHAT WE KNOW

Ordinary LangGraph checkpoint writes and NORTHSTAR business UoW writes are not one atomic transaction.

#### WHAT WE DO NOT KNOW

Whether all graph-facing NORTHSTAR calls converge cleanly after forced checkpoint failure.

#### KEY ASSUMPTION

Business state always wins and every node can reload/reconcile from it.

#### WHAT SHOULD BE TESTED NEXT

Forced checkpoint failure immediately after successful NORTHSTAR commits, plus the inverse failure.

---

## 24. Final recommendation

Do not adopt LangGraph yet.

Do not reject it yet.

Run the one-day outer-workflow spike now, before Qoder completes the concrete R1 lifecycle-progression runner.

If the spike passes, adopt Option 1: LangGraph as a replaceable durable workflow shell around NORTHSTAR.

If the spike fails any safety/state-ownership/complexity criterion, keep Option 0 and implement Recovery Lifecycle Progression as a small idempotent reconcile-from-PostgreSQL service.

Do not adopt Option 2 or Option 3 during R1.

## 25. Exact next step

1. Let Qoder continue all R1 planning/evidence work but stop before the concrete C4 lifecycle-progression implementation.
2. Accept this investigation as the decision input.
3. Create spike/langgraph-outer-workflow from the latest R1 integration candidate containing the actual coordinator service.
4. Run the eight-hour spike with PostgresSaver, sync durability and actual NORTHSTAR services.
5. Record a binary adoption result against the acceptance/rejection criteria above.
6. Resume R1 lifecycle work immediately using either:
   - Option 1 LangGraph outer shell, or
   - Option 0 small bespoke reconcile-from-state progression service.
