# LangGraph Outer-Workflow Spike — 2026-09-19

## Verdict

**REJECT LANGGRAPH — KEEP BESPOKE OUTER WORKFLOW**

This was an isolated runtime spike, not a production migration. The decisive
result is not a defect in NORTHSTAR's business safeguards: those worked. It is
that embedded LangGraph adds a second durable cursor but does not provide the
per-case wake serialization, business/checkpoint atomicity, graph-upgrade
policy, or retention operations needed to make that cursor safe to operate.
Those responsibilities would remain (or be newly introduced) around a very
small bespoke C4 reconciliation-from-authoritative-state pass.

## Identity and packages

- Exact base SHA: `61ace455a8e44694a79a1ce68e60ddff9e22b45a`
- Branch: `spike/langgraph-outer-workflow`
- S1 checkpoint SHA: `e2c513bdd365054ea679804cdd93f3e3172c5662`
- Added packages: `@langchain/langgraph@1.4.15` and
  `@langchain/langgraph-checkpoint-postgres@1.0.5` (plus their transitive
  dependencies). No LangGraph Platform, LangSmith, hosted service, LangChain
  abstraction, normal runtime boot wiring, or LIVE provider was used.

## Graph design

The isolated graph is in `src/spikes/langgraph/outerWorkflow.ts`. Its state is
strictly reference/cursor data: `recoveryCaseId`, `basisAssessmentId`,
`planningAttemptRef`, `recommendedStrategyRef`, `actionPlanRef`, `waitReason`,
`workflowVersion`, and a route. It never checkpoints traveller, journey,
programme, provider, assessment, authority, action-plan, attempt, or
observation payloads.

Nodes are `LOAD_OR_REASSESS`, `PLAN`, `WAIT_FOR_APPROVAL`,
`REQUEST_EXECUTION`, `WAIT_OR_RECONCILE`, `REASSESS`, `PROGRESS`, `RESOLVE`,
and `ESCALATE`. Every node delegates to a NORTHSTAR-shaped service boundary;
`PROGRESS` calls the real pure C8 `decideProgressionFromFacts`. Execution and
reconciliation have no LangGraph retry policy and the graph contains no
provider dispatcher.

The intended thread identity is
`northstar-recovery-case:<RecoveryCaseId>`. `workflowVersion` is persisted in
the graph state, but the version experiment below shows that this is not by
itself an adequate deployment policy.

## Postgres checkpointer and retention

`PostgresSaver` was initialized against the local NORTHSTAR PostgreSQL test
server with its own disposable `langgraph_spike` schema. `setup()` created its
four checkpointer tables. NORTHSTAR domain tables were not altered.

Teardown is `PostgresSaver.deleteThread(threadId)`, which transactionally
deletes that thread's checkpoint blobs, checkpoint rows, and pending writes.
It has no age-, size-, or case-resolution-driven pruning policy. The focused
run produced 32 checkpoints, 135 blobs, and 122 writes across test threads;
growth occurs per transition, not per recovery case.

## Evidence by requested checkpoint

### S1 — durable shell: PASS

`test/langgraph-outer-workflow-spike.test.ts` proves a checkpoint is written
at the approval interrupt, then a new saver and new graph instance resume the
same recovery-case thread. The actual stored values were IDs, workflow version,
route, and LangGraph's internal branch cursor—not business records. This is a
real process-boundary reconstruction of the graph object, not a same-graph
invoke.

### S2 — approval interrupt and stale approval: PASS at graph boundary

The focused test reaches an interrupt, then resumes from a new graph. Its
current-authority service reload rejects a stale recommendation and routes to
fresh planning; the execution seam count stays zero. Resume payload is not
used as authority. Existing real PostgreSQL evidence independently proves the
same approved dispatch is denied when its assessment has become stale:
`postgres-integration/m7m8CurrentnessAndReconciliation.pgtest.ts` acceptance
2 passed.

### S3 — side-effect safety: NORTHSTAR PASS; LangGraph end-to-end proof not completed

The real stored execution worker was tested against PostgreSQL. A provider
boundary double returned `LOST_RESPONSE`; NORTHSTAR durably transitioned to
`OUTCOME_UNKNOWN`, rejected blind redispatch, and reconciled through its
lookup-only path. Both focused real-PG suites passed.

However, the exact combined graph-crash-after-provider-mutation test was not
completed inside the timebox. Therefore the spike does **not** claim an exact
LangGraph-resume provider call count. The required result would be one; it was
not proven under graph replay. This is a failed adoption criterion, not a
substitute claim. No provider LIVE or money-moving action occurred.

### S4 — stale basis: PARTIAL

The graph stale-approval test routes to a new basis before execution. Existing
real PG dispatch-currentness evidence passed. A complete graph-plus-real
coordinator stale-planning completion test was not implemented, so this is not
counted as an adoption pass.

### S5 — concurrent case invocation: REJECTION EVIDENCE

Static inspection of `PostgresSaver` showed `thread_id` is a lookup key, not a
worker lease: latest-checkpoint reads and checkpoint-id upserts have no
per-thread lock or compare-and-swap. Two same-case invokes can enter the same
node. NORTHSTAR's stored gate/idempotency remains necessary for safety, and an
adoption would additionally require a NORTHSTAR per-case wake lease. A runtime
two-worker graph test was not completed; the lack of saver serialization is
direct implementation evidence.

### S6 — dual-write windows: NOT COMPLETED; REJECTION EVIDENCE

The checkpointer and NORTHSTAR UnitOfWork use independent transactions. The
spike has no 2PC, correctly. Recovery from either write order would need each
node to reconstruct from NORTHSTAR, fault-injection tests, and a deliberate
wake/retry policy. Neither A (business commit/checkpoint failure) nor B
(checkpoint success/business rollback) was fully exercised. This failed a
mandatory adoption proof.

### S7 — workflow upgrade: REJECTION EVIDENCE

Actual v1-interrupt -> v2 experiments found:

- retained interrupted node: reran from its beginning;
- routing change: used the v2 route;
- added node: executed the added node;
- renamed pending node: silently returned the original state without running
  the intended replacement node.

Production adoption would require immutable graph definitions selected by
persisted workflow version until all threads drain, plus an explicit
reconstruct-from-NORTHSTAR restart policy for renamed/deleted nodes. That is a
material operational owner absent from the bespoke reconcile pass.

### S8 — privacy and retention: CONDITIONAL FAIL

The reference-only state itself was clean. But `PostgresSaver` persists channel
blobs, JSONB checkpoint metadata, pending writes, interrupt payloads, and error
name/message payloads. Any future node error or interrupt containing provider
or traveller data can leak it to the disposable schema. `deleteThread` works,
but no automatic pruning exists. A production adoption needs a redacted graph
boundary, retention job, and deletion trigger—additional operational code.

### S9 — restart proof: PARTIAL

Graceful restart is proven after planning/approval interrupt by a new saver and
new graph instance. No hard-kill restart or after-execution-unknown graph
restart was completed. Same-process invocation was not used as restart proof.

## Observability

LangGraph supplied checkpoint history, current cursor/branch information,
interrupt visibility, and update streaming without LangSmith. These are useful
debugging features, but are workflow diagnostics only and must not be product
truth. They do not provide a run queue, worker lease, or authoritative audit.

## Complexity comparison

| Dimension | Bespoke C4 reconciliation shell | LangGraph outer shell |
| --- | --- | --- |
| Business source of truth | NORTHSTAR PostgreSQL | NORTHSTAR PostgreSQL (unchanged) |
| New persistence | none beyond NORTHSTAR state | 4 checkpointer tables plus blobs/writes/history |
| New direct packages | 0 | 2 direct, 21 installed transitive packages |
| Wait/wake ownership | existing `runtimeServices` wake path plus a narrow case lease | existing wake path still required, plus case lease because saver does not serialize |
| Restart handling | recompute from authoritative state | recompute from truth **and** manage graph checkpoint/version compatibility |
| Upgrade policy | ordinary application code/recompute | historical graph factories or restart migration policy |
| Privacy/retention | existing domain retention | separate checkpoint PII/error scrub + pruning/deletion policy |
| Debug stream/history | bespoke logging/read model if needed | useful built-in checkpoint/stream visibility |

The only clear LangGraph saving is cursor/interrupt/debug presentation. It
does not remove C8, coordinator, currentness, authority, stored execution,
reconciliation, canonical mutation, reassessment, resolution, or the durable
wake path. The spike shell is already 183 isolated source lines before a real
PostgreSQL service adapter, concurrency lease, fault tests, upgrade registry,
and retention operation. A bespoke C4 pass remains the simpler composition.

## What would disappear / remain if adopted

Adoption could replace only bespoke cursor, pause/resume, and transition-debug
code that has **not** been implemented. No retired `RuntimeOrchestrator` code
is counted as savings. All NORTHSTAR planning, evidence, C8, authority,
ActionPlan/ActionIntent, stored gate, execution attempt, provider adapter,
reconciliation, canonical state, and resolution code remains.

## Risks and issue triage

- **Act Now:** keep LangGraph out of the normal runtime and implement the
  smallest bespoke C4 reconcile-from-NORTHSTAR service. Deferring leaves C4
  absent; adopting now would add unchecked replay/upgrade paths.
- **Act Now:** retain C8 as the sole progression decision and preserve stored
  execution/reconciliation ownership. Deferring would risk duplicate external
  effects.
- **Park for Later:** evaluate LangGraph only if NORTHSTAR later needs a
  product requirement that justifies a hosted/workflow run queue and retained
  debug timeline. Revisit with real multi-worker operational evidence.
- **Ignore / Accept Risk:** no LangGraph Platform/LangSmith comparison was
  performed; both were deliberately excluded from this bounded OSS spike.

## Exact next action

Implement the small bespoke C4 Recovery Lifecycle Progression service under
`runtimeServices`, using current PostgreSQL reads, the pure C8 mapper,
idempotent per-basis progression, the existing planning coordinator,
resolution gate, and stored execution/reconciliation owners. First add focused
PG tests for stale basis, duplicate wake, and unknown-outcome reconciliation.

