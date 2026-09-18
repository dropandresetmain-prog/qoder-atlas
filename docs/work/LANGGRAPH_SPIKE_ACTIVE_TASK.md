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
- [x] S2 approval interrupt and stale-approval refusal (graph boundary).
- [ ] S3 lost-response execution safety / reconciliation — NORTHSTAR seam
  proven; graph crash/resume composition incomplete, counts against adoption.
- [ ] S4 stale-basis refusal — partial graph evidence only, counts against adoption.
- [ ] S5 concurrent same-case wakes — saver has no per-thread serialization.
- [ ] S6 both checkpoint/business dual-write windows — not completed.
- [x] S7 version upgrade behaviour — renamed node silently loses intended work.
- [x] S8 checkpoint privacy and retention — refs clean, interrupt/error payload
  leakage and no pruning add unacceptable ownership.
- [ ] S9 graceful and hard restart evidence — graceful approval restart only.
- [x] Compare complexity and issue final verdict: REJECT.

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

Spike closed: retain bespoke outer workflow. See
`docs/investigations/LANGGRAPH_OUTER_WORKFLOW_SPIKE_2026-09-19.md`.
