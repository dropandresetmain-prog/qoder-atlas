# LangGraph Outer-Workflow Spike — Active Task

## Identity

- Branch: `spike/langgraph-outer-workflow`
- Exact base SHA: `61ace455a8e44694a79a1ce68e60ddff9e22b45a`
- Scope: bounded, non-production evaluation of LangGraph as the disposable outer
  cursor around existing NORTHSTAR services.

## Hypothesis

LangGraph may make durable route/wait/resume control materially simpler than a
bespoke C4 progression runner while NORTHSTAR PostgreSQL remains the only
business source of truth.

## Checklist

- [x] S1 durable graph, separate Postgres checkpointer, restart skeleton.
- [ ] S2 approval interrupt and stale-approval refusal.
- [ ] S3 lost-response execution safety / reconciliation.
- [ ] S4 stale-basis refusal.
- [ ] S5 concurrent same-case wakes.
- [ ] S6 both checkpoint/business dual-write windows.
- [ ] S7 version upgrade behaviour.
- [ ] S8 checkpoint privacy and retention.
- [ ] S9 graceful and hard restart evidence.
- [ ] Compare complexity and issue final verdict.

## Intended graph

`LOAD_OR_REASSESS -> PLAN -> WAIT_FOR_APPROVAL -> REQUEST_EXECUTION ->
WAIT_OR_RECONCILE -> REASSESS -> PROGRESS`, with C8 owning the final
`RESOLVE | WAIT | REPLAN | ESCALATE` decision. State contains only case/workflow
references, current cursor metadata and wait reason.

## Checkpoint / environment

- Checkpointer schema: `langgraph_spike` (disposable; never NORTHSTAR domain
  tables).
- Current checkpoint: S1 complete; approval interrupt restart proof is green.
- Package versions: `@langchain/langgraph` `1.4.15`,
  `@langchain/langgraph-checkpoint-postgres` `1.0.5`.

## Findings / criteria

- Adoption requires all requested safety proofs plus material lifecycle-shell
  simplification.
- Rejection includes any required business-state copy, unsafe side-effect replay,
  unacceptable upgrade/privacy burden, or insignificant simplification.

## Next action

Commit/push S1, then extend the same graph test with actual stored-execution
lost-response/reconciliation evidence rather than a graph-owned dispatcher.
