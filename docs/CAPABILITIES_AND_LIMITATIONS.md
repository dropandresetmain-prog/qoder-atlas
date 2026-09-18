# Capabilities and limitations

This is the technical truth sheet for the **currently implemented NORTHSTAR runtime** after
the 2026-09-18 product-parity truth rebase.

`IMPLEMENTED` means an executable runtime path exists. It does not mean the full generalized
product loop is already integrated.

## Current runtime truth

- PostgreSQL + PostGIS is the sole normal runtime.
- SQLite is retired from normal application operation and remains only as offline/read-only
  migration input plus historical code/test evidence.
- M0-M10/C5 data/state architecture is accepted.
- R0/T3/T4 and the internal programme recovery slice are real implemented work.
- RC-6 counterfactual viability, M8 authority, durable execution/observation and the M9
  resolution gate remain accepted.
- The current target planner is **not yet full generalized NORTHSTAR planning parity**:
  read-only provider research, cross-domain candidate composition, material rejected-option
  evidence, viable-only recommendation and generalized continuation are not yet composed on
  the normal PostgreSQL path.
- The rich pre-refactor Case information architecture is a baseline to adapt, not a SQLite
  surface to restore.
- The product-parity audit and forward contracts are:
  `PRODUCT_PARITY_TRUTH_REBASE_2026-09-18.md` and
  `RECOVERY_PLANNING_CONTRACT_FREEZE.md`.

The earlier statement “the engine is complete; only the product surface is missing” is
superseded.

## Current capability matrix

| Capability | Current truth | Forward boundary |
|---|---|---|
| Persistence / canonical ownership | **IMPLEMENTED / ACCEPTED.** Typed PostgreSQL/PostGIS state, revisions, durable work. | Preserve. No ontology rewrite. |
| ChangeSignal / mutation / invalidation | **IMPLEMENTED.** Durable cause/provenance and targeted reassessment. | Preserve. |
| M6 whole-trip assessment | **IMPLEMENTED / ACCEPTED.** PASS/FAIL/UNKNOWN with subject-bound manifests. | Preserve. |
| RecoveryCase lifecycle / escalation | **IMPLEMENTED.** Deterministic open/attach and current case truth. | Preserve; continuation must re-enter planning from fresh state. |
| StrategyProposer port | **IMPLEMENTED FOUNDATION.** Proposal-only, schema-bound. | Keep; supply recovery-domain/evidence context and add travel/stay proposers by adaptation. |
| Programme proposer | **IMPLEMENTED.** Generalized programme-time alternatives. | One proposer/domain, not the recovery engine. |
| Read-only planning research | **CAPABILITIES EXIST; TARGET COMPOSITION MISSING.** Historical bounded tool loop exists; provider-neutral adapters remain. | R1 adapts ToolRequest/dispatch into the current planner. |
| Transport/travel candidate generation | **HISTORICAL ALGORITHMS + CURRENT PROVIDER/ScenarioEffect FOUNDATIONS EXIST; TARGET COMPOSITION MISSING.** | R1 adapts, not rewrites from memory. |
| Counterfactual viability / RC-6 | **IMPLEMENTED / ACCEPTED.** Blocking subjects heal; no regression/new critical UNKNOWN; unrelated pre-existing FAIL/UNKNOWN stays truthful. | Preserve. Recommendation cannot override it. |
| Material considered/rejected evidence | **NOT YET DURABLE ON TARGET PATH.** Current PlanningReport is ephemeral and viable-only strategy persistence loses rejected material alternatives. | R1 adds one bounded immutable RecoveryPlanningAttempt record. |
| Strategy comparison/recommendation | **NOT YET IMPLEMENTED ON TARGET PATH.** Current product asks operator to choose viable options. | R1 adds structured viable-only recommendation; AI may judge soft semantics only. |
| Three blast semantics | **UNDERLYING DATA EXISTS, PROJECTION NOT YET EXPLICIT.** ScenarioChange, RC-6 closure and baseline/candidate pairs represent different facts. | R1/R2 expose immediateChangeBlastRadius, reassessmentClosure and outcomeDelta separately. |
| Authority / approvals | **IMPLEMENTED / ACCEPTED FOR CURRENT INTERNAL PATH.** | Preserve M8 boundary; revisit money-specific holds only when needed. |
| Internal programme execution | **IMPLEMENTED.** Durable ActionPlan/action intent -> observation -> canonical mutation. | Reuse for B1. |
| External provider execution | **FOUNDATION EXISTS; NORMAL CONSEQUENTAL LOOP NOT YET COMPOSED.** | B2 only after rebased B1. |
| Observation / reconciliation | **IMPLEMENTED FOUNDATION; strongest on current PG path.** | Preserve; B2 composes provider dispatcher/reconciler. |
| Case resolution | **IMPLEMENTED / ACCEPTED.** Requires reconciled execution + current required-subject PASS. | Preserve. |
| Continued/sequential recovery | **PRODUCT BEHAVIOUR GAP.** Current target reassesses/resolves but does not yet provide equivalent generalized bounded replanning. | R3 composes one post-reassessment progression owner under runtimeServices. |
| Operator Overview population + queue | **IMPLEMENTED DIRECTION IS CORRECT.** Population context coexists with attention/work. | Preserve; Event Overview redesign is separate. |
| Focused Case decision workspace | **PARTIAL.** Product-boundary repairs improve navigation/readability, but investigated/rejected/recommendation/blast semantics are still absent. | R2 adapts rich old IA onto PG read models. |
| Traveller surface | **PARTIAL.** Core current-state semantics exist; useful depth was reduced. | Restore bounded product depth after shared planning contract, without blocking R1. |
| Atlas flight read capabilities | **IMPLEMENTED ADAPTER CAPABILITY.** Search/verify/rules/state with LIVE/RECORD/REPLAY normalization. | R1 composes read-only evidence into planning. |
| Atlas flight transactions | **IMPLEMENTED SANDBOX/ADAPTER FOUNDATION; NOT NORMAL B2 COMPOSITION.** | B2 adds consequential dispatch/reconciliation behind current authority gate. |
| Hotel capability | **IMPLEMENTED PROVIDER SEAMS.** Search/quote/book/retrieve/cancel. | Pull into planning/execution only where an actual domain/scenario requires it. |
| Routing | **PARTIAL / OPTIONAL CONTEXT.** | Non-blocking read evidence. |
| Entry/advisory | **ARCHITECTURE/EVALUATOR FOUNDATION; SOURCE COVERAGE PARTIAL.** | Missing/stale coverage stays UNKNOWN. |
| Semantic operational history | **NOT YET PRODUCT-COMPOSED.** Raw change-record Activity exists. | Post-E2E enhancement; planning decision evidence is R1 because B1 needs it. |

## Provider evidence matrix

| Provider / service | Purpose | Current status | Important limitation |
|---|---|---|---|
| Atlas | Flight search/verify/rules/state + sandbox transaction seams | LIVE/RECORD/REPLAY adapter paths exist | R1 uses read-only evidence; consequential external dispatch waits for B2. |
| Alibaba Cloud Model Studio / Qwen | Extraction/proposal/semantic comparison where configured | Available behind schema validation | Never owns viability, hard policy, authority or execution. |
| Nuitée / liteAPI | Hotel search/quote/book/retrieve/cancel | Provider seams exist | Use only when the selected recovery domain needs it. |
| Google Routes | Ground-context estimation | Optional read capability | No booking action. |
| Frankfurter | Reference FX evidence | Available | Comparison evidence, not payment FX. |
| Railway | Hosted runtime | Operational environment | Hosting is not a domain capability. |

## Frontend/read-model contract

Frontend must not independently calculate:

- viability;
- policy/authority;
- causal failure;
- recovery correctness;
- immediate proposed-change blast radius;
- reassessment closure;
- outcome delta.

The Case backend must separately project current truth, planning-time decision evidence,
proposed change and observed execution. UUIDs/provider capability codes are secondary
metadata, not the primary user explanation.

## Current delivery gaps

### Act Now — R1/R2/R3

- generalized Recovery Planning Coordinator around current `recoveryPlanning.ts`;
- bounded provider-neutral read-only planning tools;
- travel-domain proposer adaptation;
- one bounded durable RecoveryPlanningAttempt evidence record;
- viable-only recommendation/comparison;
- explicit immediate blast / reassessment closure / outcome delta projections;
- rich Case projection;
- continued recovery from new canonical state;
- full rebased Sarah B1 acceptance plus a second materially different planning proof.

### Investigate Now

- choose the cheapest fixture-ready second B1 planning proof from existing scenarios;
- exact migration number/index/size bounds for RecoveryPlanningAttempt implementation;
- exact current preference/rule projections needed by comparator inputs.

### Park for Later

- consequential external provider dispatch/reconciliation until B2;
- budget/spend holds unless a real money-moving path requires them;
- Event Overview redesign;
- graph/semantic zoom;
- SSE/WebSockets;
- broad provider-reference auto-correlation;
- presenter polish;
- physical deletion of historical SQLite code.

### Ignore / Accept Risk

- rewriting the PostgreSQL ontology;
- resurrecting SQLite;
- replacing RC-6;
- rebuilding M8 authority/execution;
- rebuilding Atlas adapters;
- rebuilding NORTHSTAR from scratch.

## B1 / B2 capability boundary

**B1** must prove provider reprotection -> whole-trip FAIL -> relevant-domain discovery ->
read-only travel evidence -> travel candidate evaluation -> material rejected/inferior
alternative evidence -> programme candidates where relevant -> RC-6 -> three impact
semantics -> viable-only recommendation -> operator approval -> internal programme
execution -> observation -> reassessment -> PASS/resolution.

B1 does not require consequential external booking/payment execution.

**B2** uses the same planner/evidence/proposer/RC-6/recommendation/ActionPlan/authority
contracts and adds durable external ActionIntent dispatch, uncertain/partial outcomes,
reconciliation-before-retry, provider observation, reassessment and continued recovery.

## M11 readiness

M11 remains operational activation/retirement, not a database migration back to/from an
active SQLite runtime. Any bounded external legacy-source inventory remains a final
activation concern.

## Truthfulness rule

Provider success is not recovered-trip proof. A recovery claim requires internally
committed or externally observed canonical state, reconciliation, and current deterministic
assessment. Unsupported/stale/incomplete evidence remains UNKNOWN.
