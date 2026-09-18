# Northstar roadmap

This roadmap records current implemented truth, the truth-rebased delivery sequence and
deferred scope. Detailed contracts live in
[`RECOVERY_PLANNING_CONTRACT_FREEZE.md`](RECOVERY_PLANNING_CONTRACT_FREEZE.md).

## Current baseline

PostgreSQL + PostGIS is the sole normal runtime. SQLite is offline/read-only migration input
or historical evidence only.

Accepted foundations remain:

- F01-F18 ontology/ownership and logical schema;
- M0-M10/C5 PostgreSQL convergence;
- subject-bound M6 assessment;
- durable ChangeSignal + deterministic escalation;
- current StrategyProposer/ScenarioChange contracts;
- RC-6 deterministic counterfactual viability;
- M8 authority/approval/durable execution;
- internal programme execution and observation;
- M9 resolution correctness;
- Overview population + work/attention semantics;
- provider-neutral adapters and LIVE/RECORD/REPLAY normalization.

The 2026-09-18 product-parity audit supersedes the earlier interpretation that the
programme-only internal loop constituted complete B1. The gap is concentrated in
planning/reasoning parity, decision evidence, continued recovery and the Case decision
surface.

## Architecture source of truth

1. `DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`
2. `DATA_STRUCTURE_LOGICAL_SCHEMA.md`
3. `RECOVERY_PLANNING_CONTRACT_FREEZE.md`
4. `ARCHITECTURE.md`
5. `CAPABILITIES_AND_LIMITATIONS.md`
6. `IMPLEMENTATION_PLAN.md` §22
7. `TESTING.md`
8. `work/ACTIVE_TASK.md`

The accepted parity audit is `PRODUCT_PARITY_TRUTH_REBASE_2026-09-18.md`.

Historical milestone evidence stays historical and is not rewritten.

## Milestone status

| Stage | Status | Truth / next |
|---|---|---|
| F01-F18 + logical schema | **COMPLETE / APPROVED** | Do not reopen absent contradiction. |
| M0-M10 / C0-C5 | **COMPLETE / ACCEPTED** | PostgreSQL state/persistence foundation. |
| R0/T3/T4 operational composition | **COMPLETE** | Useful accepted runtime foundation. |
| Internal programme recovery slice | **IMPLEMENTED** | Valid StrategyProposer -> RC-6 -> approval -> internal execution -> observation -> resolution proof; not complete rebased B1. |
| B1 product-boundary repair | **IMPLEMENTED SLICE** | Navigation/shell/readability fixes remain useful; does not provide planning parity. |
| Truth rebase + contract freeze | **CURRENT / PLANNING** | Convert accepted audit into forward SSOT/contracts. |
| R1 — planning + decision-evidence parity | **NEXT IMPLEMENTATION** | Coordinator, read-only research, travel proposer, bounded PlanningAttempt evidence, viable-only recommendation, blast semantics. |
| R2 — Case decision surface | **PLANNED AFTER/FOLLOWING R1 CONTRACTS** | PG read model + rich Case adaptation. |
| R3 — full rebased B1 | **PLANNED** | Sarah full reasoning + internal execution + continuation + second planning proof. |
| B2 — consequential external execution | **BLOCKED ON R3/B1** | Same engine; external ActionIntent/dispatch/reconciliation/uncertain outcomes; Jordan proof. |
| Post-E2E product work | **PLANNED** | Semantic operational history, accepted Event Overview, provider/demo hardening. |
| M11 / C6 | **PLANNED** | Operational activation/retirement + final candidate evidence. |

## R1 — planning + decision-evidence parity

Objective:

`RecoveryCase/current failure -> domains -> evidence gaps -> bounded read tools ->
StrategyProposers -> validation -> RC-6 -> material evidence -> viable-only recommendation`.

Acceptance:

- evidence can change candidate generation;
- multiple recovery domains/candidates coexist;
- at least one material candidate is rejected deterministically and remains inspectable;
- viable candidates persist as RecoveryStrategies;
- rejected material alternatives do not need fake RecoveryStrategy rows;
- recommendation can name only current VIABLE strategies;
- immediate proposed-change blast radius, reassessment closure and outcome delta are
  distinct backend semantics;
- a second materially different planning situation uses the same coordinator/contracts.

Safe lanes after contract freeze:

- Planner: coordinator/read tools/travel proposer/comparator.
- Evidence/read model: PlanningAttempt + blast/delta projection.
- Verification: behaviour-first tests + anti-hardcoding.
- Primary architect/integrator: shared contracts, schema/migration, orchestration,
  integration.

## R2 — Case decision surface

Adapt the rich pre-refactor Case information architecture onto PostgreSQL/current read
models.

It must answer what changed, why the trip fails, what was investigated, why material
alternatives lost, what remains viable, what NORTHSTAR recommends and why, all three
impact semantics, what is being approved, execution/observation truth and whether the trip
is actually recovered.

Event Overview redesign is excluded.

## R3 — full rebased B1

Sarah must demonstrate:

`provider reprotection
-> current whole-trip FAIL
-> generalized domain/evidence planning
-> read-only travel alternatives
-> deterministic travel evaluation
-> material rejected/inferior travel evidence
-> programme candidates where relevant
-> immediate programme blast
-> RC-6 reassessment closure
-> outcome delta
-> viable-only recommendation
-> operator approval
-> internal ActionPlan execution
-> observation
-> canonical update
-> reassessment
-> Sarah PASS
-> case RESOLVED`.

Unrelated FAIL/UNKNOWN remains truthful.

No `if Sarah`, no fixed travel/programme sequence, and no fixture-specific application
logic.

## B2 — consequential external execution

B2 uses the same coordinator, evidence model, StrategyProposer port, RC-6, recommendation,
ActionPlan and authority.

It adds:

`external ActionIntent -> deterministic gate -> durable attempt before network ->
provider dispatch -> success/partial/lost-response/OUTCOME_UNKNOWN ->
observation/reconciliation -> no blind retry -> canonical provider state ->
reassessment -> continued recovery -> resolution/escalation`.

Jordan proves generality; it does not define the architecture.

## Review checkpoints

Use sparse reviews:

- contract freeze: architecture acceptance before implementation;
- R1 integration: focused planner/evidence review only if implementation exposes ambiguity;
- R2 integration: one product/read-model review;
- R3/B1: primary full product/engine acceptance + one independent generality/hardcoding
  review where warranted;
- B2: one independent high-risk external execution/reconciliation review.

Do not review every micro-milestone.

## Act Now

- freeze/reconcile current docs/contracts;
- R1 coordinator/read tools/travel proposer/recommendation/evidence;
- three blast semantics;
- R2 Case projection;
- continued-recovery owner;
- behaviour-first parity tests;
- full rebased B1 acceptance;
- foundational no-silent-retirement gate.

## Investigate Now

- cheapest existing second B1 planning proof (S4/S5 or equivalent fixture-ready case);
- exact migration/index/JSON bounds for PlanningAttempt;
- exact existing preference/rule projections needed by comparator.

## Park for Later

- B2 external dispatch composition until B1 passes;
- budget holds until a money-moving path requires them;
- Event Overview redesign;
- whole-event graph / semantic zoom;
- SSE/WebSockets;
- broad provider-reference auto-correlation;
- physical deletion of historical SQLite;
- final presenter polish.

## Ignore / Accept Risk

- PostgreSQL ontology rewrite;
- SQLite resurrection;
- RC-6 replacement;
- M8 authority/execution rebuild;
- Atlas adapter rebuild;
- another recovery engine.

## Testing discipline

Default hierarchy:

1. smallest focused changed-behaviour test;
2. adjacent/module test;
3. relevant PostgreSQL seam/package gate;
4. broader integration only at coherent checkpoints;
5. full current-target gate only at milestone/candidate checkpoints.

Foundational migrations/cutovers additionally require capability parity:
`OLD CAPABILITY -> NEW HOME -> DISPOSITION -> BEHAVIOURAL PROOF`.

## Roadmap discipline

Excluded scope stays visible with a reason and revisit condition. A completed technical
slice is not promoted into a broader product milestone unless its behavioural acceptance
criteria are actually proven.
