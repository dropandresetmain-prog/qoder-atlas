# Northstar roadmap

## Post-R4 delivery update — 2026-09-20

**R4 ACCEPTED — SARAH LIVE VERTICAL + PRODUCT PARITY READY** at
`2baf1f6df484319e131590d37a0b026222324d03`. Forward work is on
`integration/astra-post-r4`, never an older R4 base or a direct merge to main.
The older R3 status/sequence below is retained as context and is superseded by
this update where it describes current composition or delivery order.

Current evidence: normal PostgreSQL boot, LIVE Atlas research and Qwen, physical
Sarah programme recovery, separate protected Atlas sandbox flight execution,
bounded Event Overview implementation and Case graph. Neither faithful graph
convergence nor physical Jordan acceptance is yet claimed.

Sequence: A0 freeze/diagnose -> A1 strong current-product surfaces plus faithful V5.6/V7.2
-> A2 physical Sarah -> A3 generalized Jordan runtime -> A4 physical Jordan ->
A5 repeatable cross-scenario final candidate. Contracts, triage and implementation
ownership: [A0 convergence](work/ASTRA_A0_CONVERGENCE.md).

| Scope | Current disposition / revisit condition |
|---|---|
| Booking identities/budget and per-offer flight/time/cost visibility | Act Now for Jordan; R4 parks reclassified because executable repeatable recovery requires them. |
| Recent decisions, Activity, Programme/Traveller readability, persistent Reset | Act Now for A1; physically prove current Sarah product usability. |
| Healthy-trip traveller change-request planning | Park for Later by founder scope decision; genuine canonical request/planning/progression/authority/resolution gap. Preserve actual assessments; never fake FAIL. Revisit after generalized Sarah/Jordan verticals and deliberate desired-state design. |
| Broad programme relocation/cancellation/OTHER | Park for Later; typed scenario effects, source-announcement distinction and execution support require deliberate design. Current bilateral time swap remains supported. |
| Non-critical legacy parity | Park for Later; revisit when it materially improves Sarah, Jordan, graph fidelity or submission. Message/export footer controls were inert at the legacy baseline. |
| Programme importer partial-prefix visibility | Investigate Now, bounded: determine actual normal/demo visibility and resumable integrity before deciding whether atomicity blocks reliability. |
| Narita hotel booking, Singapore hotel replacement, transfer transaction, insurance submission, composite provider action plan | Park for Later; outside closed Sarah/Jordan hero, revisit after A5 or an expanded acceptance requirement. |
| Remaining historical providers including Nuitée, Google Routes, Frankfurter and optional model routes | Park for Later for this convergence; no claim of normal-runtime parity, revisit after the two required verticals or when a required decision needs that provider. |
| Multiple independent Overview blast centres | Park for Later; revisit when a required scenario needs simultaneous independent incidents. |
| R4 N5-N7 and budget-injection replan issue | Existing R4 dispositions retained; revisit on objective-blocking reproduction. |
| Opaque R4 m9ReadModelCurrentness suite-only failure | Investigate Now on concrete focused/new integration evidence; no ceremonial broad rerun. |

PostgreSQL remains the sole normal runtime. Unknown outcomes never permit blind
redispatch; provider success alone never resolves a trip.

This roadmap records current implemented truth, the truth-rebased delivery sequence and
deferred scope. Detailed contracts live in
[`RECOVERY_PLANNING_CONTRACT_FREEZE.md`](RECOVERY_PLANNING_CONTRACT_FREEZE.md).

## Current baseline

PostgreSQL + PostGIS is the sole normal runtime. SQLite is offline/read-only migration input
or historical evidence only.

Accepted foundations now include F01-F18, M0-M10/C5, M6/RC-6, durable ChangeSignal,
R1 generalized planning/evidence/recommendation, R2 Case + immutable Original/current graph,
and R3 full rebased B1 with one runtime coordinator, C4 continuation, internal execution,
observation/reassessment/resolution and a second non-programme proof.

Normal boot now proves provider-neutral Atlas `flight.search` in REPLAY.

The current risk is no longer missing B1 planning composition. It is **provider capability
parity/reachability**: historical adapters/capabilities may still exist in source/config
without accepted proof that the normal PostgreSQL target runtime can use them.

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
| R1 — planning + decision evidence | **COMPLETE / ACCEPTED** | Generalized coordinator, read-only research boundary, durable evidence, recommendation. |
| R2 — Case decision surface | **COMPLETE / ACCEPTED** | PG Case workspace + focused graph + immutable Original. |
| R3 — full rebased B1 | **COMPLETE / ACCEPTED** | Real PG + normal boot + Chromium; second non-programme proof. |
| Provider parity audit | **IN PROGRESS** | Find every historical capability missing/unreachable/partially ported. |
| ALL Atlas capability restoration | **NEXT IMPLEMENTATION** | Restore and reachability-test each Atlas operation; add founder-corridor evidence. |
| Remaining historical adapter restoration | **PLANNED AFTER ATLAS** | Restore only capabilities still required by parity audit. |
| B2 — consequential external execution | **PLANNED AFTER PROVIDER RESTORATION** | Same R3 engine/gates; external dispatch/reconciliation/uncertain outcomes. |
| Event Overview V7.2 implementation | **DESIGN ACCEPTED / IMPLEMENT FROM POST-R3 BASE** | Design commit `563320e4` is future input only. |
| Semantic operational history / product hardening | **POST-E2E** | Case/Activity/Overview projections over authoritative events. |
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

- finish the exhaustive pre-refactor -> current runtime parity audit;
- restore/reachability-test every Atlas operation required by the product;
- add REPLAY recordings or LIVE evidence for founder-programme flight corridors;
- after Atlas, restore remaining historical adapters classified as required;
- preserve focused-test-first discipline and one generalized engine.

## Investigate Now

- complete the zombie-capability inventory from the parity audit;
- determine the correct backend causal projection for the full
  `changed flight -> arrival consequence -> breakpoint -> commitment` story;
- determine why the replacement service remains `Unknown / unconfirmed` in the Case graph
  and whether provider/state projection already contains the missing truth.

## Park for Later

- B2 consequential provider dispatch until provider restoration is ready;
- stale `m10RuntimePurgeBoot` 404 expectation;
- raw UUID / repeated-line cleanup in older Case blocks;
- semantic operational-history implementation;
- Event Overview V7.2 implementation after accepted post-R3 is promoted;
- SSE/WebSockets, whole-event semantic zoom and presenter polish;
- physical deletion of historical SQLite code.

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
