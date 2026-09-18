# Northstar roadmap

This roadmap records **implemented runtime truth, current delivery status and intentionally
deferred scope**. For detailed execution semantics, use
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §22.

## Current baseline

PostgreSQL + PostGIS is the sole normal Northstar runtime. SQLite survives only as offline,
read-only migration input plus historical code/test evidence.

Current implementation candidate:

- branch: `feature/sarah-provider-disruption`
- B1 closure: `82ae9b80f62a26d8b7e8e6277aa5bf6183ff44f0`
- clean PostgreSQL gate: **522/522**
- latest measured CURRENT suite: **802/802**

The post-C5 operational-runtime closure is complete through B1. The next product gate is
**Founder B1 physical acceptance**, followed by **B2 generalized external recovery / Jordan**.

Current sequence:

`Founder B1 -> B2 external/Jordan -> B2 Founder + generalisation verification ->
post-E2E observability/Event Overview/provider hardening -> M11/C6 candidate`

The old Slice A/Slice B labels are historical planning language. Forward work uses B1/B2
explicitly.

## Architecture source of truth

- [`DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md) —
  frozen F01-F18 architecture decisions.
- [`DATA_STRUCTURE_LOGICAL_SCHEMA.md`](DATA_STRUCTURE_LOGICAL_SCHEMA.md) — relational
  ownership/integrity/transaction contracts.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current implemented architecture including the
  operational runtime closure and RC-6 viability contract.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §22 — authoritative current delivery
  sequence.
- [`IMPLEMENTATION_PLAN_HISTORY.md`](IMPLEMENTATION_PLAN_HISTORY.md) — historical M0-M11
  decomposition and earlier post-C5 plans.
- [`TESTING.md`](TESTING.md) — canonical suite contract and test-performance operating rules.

## Milestone status

| Stage | Status | Current truth / next |
|---|---|---|
| F01-F18 architecture + logical schema | **COMPLETE / APPROVED** | Frozen unless a concrete contradiction is proven. |
| M0-M10 / C0-C5 | **COMPLETE / ACCEPTED** | PostgreSQL data/state architecture and migration rehearsal accepted. |
| Post-C5 repository convergence | **COMPLETE** | PostgreSQL runtime + accepted semantic/read-model foundations on one code line. |
| T2 provider disruption | **IMPLEMENTED / REVIEWED** | Correct canonical reprotection, 49/3/15 post-trigger truth, idempotent replay. |
| Fable runtime architecture audit | **COMPLETE / ACCEPTED** | Identified operational-composition gaps without reopening F01-F18. Resulting R0/T3/B1 plan is now implemented. |
| R0 runtime composition closure | **COMPLETE** | Subject-bound manifests, bookkeeping separation, clock expiry, one runtime-services root. T2 fan-out 67 -> 5; drain ~17s -> ~2.4s. |
| T3 ChangeSignal + escalation | **COMPLETE** | Durable cause/provenance and deterministic idempotent case opening/attachment. |
| T4 focused-case backend | **IMPLEMENTED** | Cause/causalPath and accepted semantic/read-model inputs available. |
| B1 generalized internal recovery | **COMPLETE IN IMPLEMENTATION** | Real AiT/Sarah normal-path proposal -> viability -> approval -> internal execution -> observation -> reassessment -> resolution proven at `82ae9b8`. |
| Founder B1 | **NEXT / NOT YET ACCEPTED** | Physically drive the real product loop. This subsumes the unrun standalone Founder Test A checks. |
| B2 generalized external recovery / Jordan | **PLANNED AFTER FOUNDER B1** | Same lifecycle, external dispatcher/Atlas evidence/reconciliation, no Jordan-specific runtime. |
| B2 Founder + generalisation verification | **PLANNED** | Physical product test plus focused same-engine/anti-hardcoding review. |
| Post-E2E product work | **PLANNED** | Semantic activity, accepted Event Overview implementation, provider-mode hardening, final demo polish. |
| M11 / C6 | **PLANNED** | Operational activation/retirement, exact-candidate rehearsal and submission evidence. |

## Current implemented recovery floor

The generalized internal path is now:

`change
-> ChangeSignal
-> canonical mutation
-> targeted invalidation
-> reassessment
-> deterministic escalation
-> RecoveryCase
-> StrategyProposer
-> schema validation
-> counterfactual viability
-> RecoveryStrategy / ActionPlan
-> authority / approval
-> durable internal execution
-> observation
-> canonical update
-> reassessment
-> resolution`.

### RC-6 viability decision

Reached dependency closure remains the reassessment scope. It is **not** a requirement that
every reached subject become PASS.

A recovery must resolve its blocking case subjects, introduce no regression, introduce no
new/action-critical UNKNOWN and satisfy explicit requiredUnknowns. Unchanged unrelated
pre-existing FAIL/UNKNOWN remains visible and truthful but does not veto the candidate.

Resolution still requires the case's required subjects to be current PASS and execution to
be completed/reconciled.

## Immediate next product gate — Founder B1

Founder acceptance should verify:

1. baseline 50 PASS / 2 FAIL / 15 UNKNOWN;
2. disclosed simulated airline update;
3. settled 49 / 3 / 15 without transient 0->49 rebuild;
4. incident-linked Sarah case with authoritative cause/causalPath;
5. at least one generic programme recovery persists VIABLE;
6. approval by the workspace operator;
7. internal programme actions execute and are observed;
8. reassessment makes Sarah PASS;
9. the incident case resolves;
10. unrelated baseline FAIL/UNKNOWN remains truthful.

If this fails, fix the first broken normal product boundary before B2.

## B2 — generalized external recovery / Jordan

B2 exists to prove generality, not to implement a second scripted scenario.

Required capability direction:

- progressive external observations become ChangeSignals;
- flight recovery uses the same StrategyProposer contract;
- Atlas Search/Verify or REPLAY provider-shaped responses inform candidate generation where
  materially useful;
- the same deterministic viability, plan, authority and approval contracts remain;
- a provider-neutral external dispatcher executes supported actions;
- uncertain/partial provider outcomes remain truthful;
- provider observation/reconciliation updates canonical state;
- the same reassessment and resolution gates decide whether the trip is recovered.

No traveller names, route constants, supplier IDs or scenario branches in domain/application
logic.

## Parallel engineering-productivity lane

The 2026-09-18 read-only test/dev-startup audit is a **parallel engineering lane**, not a
product milestone.

### Done (engineering-productivity, 2026-09-18)

- **H1:** isolate the inbox/outbox queue test from unrelated global test residue
  without changing the production global claim contract.
- **H2:** sticky daily `.env.local` workspace/demo loading; a fresh workspace is an
  explicit reset.
- **H3:** bounded parallelism (`--test-concurrency=4`) for CURRENT no-DB/no-browser
  tests only. PostgreSQL/migration/legacy remain serial.
- **H4:** living docs and scripts no longer imply raw `node --test` is the canonical
  suite.

### Investigate Now

- F3/F5/F7 duplicate full AiT provisioning for narrow assertions;
- `productBaselineWorld` second rematerialization;
- optional heavy `postgres-world` checkpoint classification/list;
- repeated ~1s per-file PostgreSQL readiness check.

### Park for Later

- limited PostgreSQL file parallelism after queue isolation and connection-budget proof;
- materializer/SERIALIZABLE performance tuning;
- production outbox publisher unless a product/runtime requirement promotes it.

### Ignore / Accept Risk

Heavy B1 Sarah, F1, N1, real evaluator and migration proofs remain legitimate checkpoint
costs.

## Current investigations / known risks

| Item | Triage | Why / revisit |
|---|---|---|
| Preview `previewAccepted` still uses an older all-PASS participant rollup | **Investigate Now** | Product UI may look stricter than the B1 planning contract; reconcile before it can mislead Founder/B2. |
| Authority coverage is snapshotted at provisioning (RC-7) | **Park for Later / revisit if B2 adds subjects after provision** | Current B1 world is covered; dynamic subject creation may require refresh semantics. |
| Budget holds (RC-8) | **Park for Later** | Not needed for B1 internal programme action; revisit for money-moving B2 capability. |
| Transactional outbox is write-only in normal runtime (RC-9) | **Park for Later** | Not a B1 correctness gap; do not build a broker for test hygiene. |
| Provider ingress is an in-request saga (RC-10) | **Park for Later** | Retry/idempotency is proven; revisit when external operational reliability warrants inbox work. |
| Demo date vs assessment clock expiry | **Investigate before final rehearsal** | R0 wires expiry scheduling; final demo date/config still needs explicit rehearsal. |
| Railway readiness returns 200 while composition can still be starting | **Act before final candidate** | Health is not readiness; do not let deployment report ready before full composition. |
| External legacy file/volume inventory | **Before M11** | Repository audit found no meaningful legacy state; external ignored/deployed files need one bounded check. |

## Stretch / deferred

| Item | Status | Reason / revisit condition |
|---|---|---|
| Event Overview final visual design | **Unresolved / redesign required** | Implement only after design acceptance; backend must not be shaped around rejected prototypes. |
| Semantic activity / considered-option history | **Post-E2E** | Build from authoritative records after B2 proof. |
| Whole-event Live Dependency Graph / semantic zoom / multiple focuses | **Stretch** | Focused case + accepted Overview first. |
| SSE / WebSockets | **Park** | Polling is truthful and adequate for current demo scale. |
| Authoritative Before/After historical view | **Park** | Requires retained historical projection semantics. |
| Traveller/phone surface | **Stretch** | Operator recovery loop first. |
| Automated visa/insurance/ground-provider workflows | **Stretch / provider-dependent** | Requires authoritative sources and validated capability/authority. |
| Dedicated graph DB, Kafka, microservices, Kubernetes | **Deferred** | No demonstrated requirement. |
| Retired SQLite code deletion | **Park until after M11/submission** | Historical/migration archaeology still useful. |
| Unbounded autonomous refunds/provider servicing | **Deferred** | Consequential actions stay typed, authority-gated and observed. |

## Test contract

Use focused tests during implementation. The broad PostgreSQL gate is expensive by design
and currently ~21.4 minutes on a clean database; do not use it as a debugging loop.

Canonical suites remain:

- `npm test` — boundary gate + CURRENT_TARGET;
- `npm run test:postgres` — full current PostgreSQL integration gate;
- `npm run test:migration` — migration boundary;
- `npm run test:legacy` — historical/manual/non-gating only.

Performance work may change **when/how** coverage runs; it must not silently delete the
coverage that proves B1/T2/F1/generalisation.

## Roadmap discipline

- Every excluded item retains a reason/revisit condition.
- Runtime/domain logic never contains scenario-specific names, IDs, routes or outcomes.
- Provider-specific mechanics stay behind provider/capability boundaries.
- If the accepted ontology cannot express a requirement, report an architecture gap rather
  than hardcoding around it.
- Physical founder evidence and exact runtime truth outrank old milestone wording.
