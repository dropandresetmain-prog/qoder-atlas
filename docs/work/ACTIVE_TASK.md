# ACTIVE TASK — Truth Rebase + Recovery Planning Contract Freeze

Working-memory ledger for the current planning branch. Historical R0/T3/B1/product-repair
evidence remains in its original documents and is not rewritten here.

## Identity

- Repository: `dropandresetmain-prog/qoder-atlas`
- Authoritative input branch: `feature/sarah-provider-disruption`
- Accepted parity-audit commit: `4f48c75af41bc79874470900c76f8a2dc7b0238f`
- Planning branch: `plan/truth-rebase-contract-freeze`
- Authoritative audit: `docs/PRODUCT_PARITY_TRUTH_REBASE_2026-09-18.md`

The authoritative input branch was verified identical to the accepted audit commit before
this branch was created.

## Goal

Convert the accepted product-parity audit into:

- corrected living SSOT;
- frozen generalized recovery-planning contracts;
- explicit B1/B2 boundaries;
- shortest safe implementation programme;
- behavioural tests to write first;
- permanent no-silent-retirement rule.

No production code, runtime, database or provider execution belongs in this task.

## Frozen product truth

NORTHSTAR is a generalized trip-resolution system. The PostgreSQL state/evaluation/
authority/execution foundation remains. Missing planning/reasoning and product-decision
capabilities are adapted onto it.

Required consequential boundary:

`AI proposal -> validation -> deterministic viability -> authority -> executor ->
observation -> canonical state -> reassessment`.

AI may propose/research/compare semantics. Deterministic code owns hard constraints,
provider facts, viability, authority, execution validation, observation/reconciliation and
resolution.

## Current contract decisions

- [x] Current `recoveryPlanning.ts` is extended/adapted; no parallel engine.
- [x] Historical read-only ToolRequest/planningLoop/dispatch protocol is adapted to current
      provider-neutral capabilities.
- [x] Recovery-domain selection is hybrid: deterministic activation + validated AI semantic
      additions; no scenario branches/order.
- [x] Current StrategyProposer port survives and remains proposal-only.
- [x] Material rejected alternatives use a bounded immutable RecoveryPlanningAttempt;
      viable executable alternatives remain RecoveryStrategy rows.
- [x] Recommendation receives only current VIABLE strategies and cannot override RC-6.
- [x] `immediateChangeBlastRadius`, `reassessmentClosure` and `outcomeDelta` are
      distinct backend semantics.
- [x] Continued recovery belongs to one post-reassessment Recovery Lifecycle Progression
      service composed under `runtimeServices`; RuntimeOrchestrator stays retired.
- [x] Rich old Case workspace is IA reference for a PostgreSQL Case projection, not a code
      path to restore.
- [x] B1 = full Sarah reasoning + internal execution; B2 = same engine plus consequential
      external execution/reconciliation.

See `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md`.

## Current planning checkpoints

### Checkpoint 1 — contract freeze

- [x] Create focused contract-freeze document.
- [x] Resolve hybrid planning/decision evidence shape.
- [x] Freeze recommendation boundary.
- [x] Freeze three impact semantics.
- [x] Freeze continued-recovery ownership.
- [x] Freeze B1/B2 acceptance.

### Checkpoint 2 — forward SSOT reconciliation

- [ ] Reconcile AGENTS/README/ARCHITECTURE/CAPABILITIES/ROADMAP/SCENARIOS.
- [ ] Preserve historical evidence unchanged.
- [ ] Verify only docs changed.

### Checkpoint 3 — implementation/test programme

- [ ] Rebase `IMPLEMENTATION_PLAN.md` §22.
- [ ] Rebase `IMPLEMENTATION_AGENT_ROUTING.md`.
- [ ] Add foundational parity rules/behavioural tests to `TESTING.md`.
- [ ] Reconcile this ledger against final docs.
- [ ] Verify no production source changed.
- [ ] Record final branch/SHAs.

## Next implementation after this planning branch is accepted

`R1 planning/evidence parity -> R2 Case decision surface -> R3 full B1 -> B2 external`.

Do not start R1 in this task.

## Issue triage

### Act Now

Contract/SSOT freeze, R1 planner/evidence parity, R2 Case projection, continuation, blast
semantics, B1 acceptance and permanent parity gate.

### Investigate Now

Choose the cheapest fixture-ready second planning proof; implementation-time migration/index
details for PlanningAttempt; confirm current preference/rule projections for comparison.

### Park for Later

External consequential dispatch until B2, money holds until needed, Event Overview redesign,
graph zoom, SSE, final presenter polish, broad provider auto-correlation, physical SQLite
deletion.

### Ignore / Accept Risk

Ontology rewrite, SQLite resurrection, RC-6 replacement, M8 rebuild, Atlas rebuild, another
engine rewrite.

## Verification discipline for this task

Static only:

- inspect branch/commit/docs/code;
- compare branch diff after each checkpoint;
- confirm changed paths are documentation only;
- do not run product tests merely to re-prove accepted runtime behaviour.

No product code may change.
