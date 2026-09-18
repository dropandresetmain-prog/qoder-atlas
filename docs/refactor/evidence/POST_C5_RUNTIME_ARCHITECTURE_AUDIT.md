# Post-C5 runtime architecture audit — historical evidence

Date: 2026-09-18

Status: **ACCEPTED AUDIT; RESULTING R0/T3/T4/B1 WORK IMPLEMENTED**

Audit base:
`feature/sarah-provider-disruption` @
`c20228c2dfffcaf1cfa34571df5ab99f719a6e3c`.

Current B1 closure:
`82ae9b80f62a26d8b7e8e6277aa5bf6183ff44f0`.

This file preserves why the delivery plan changed. Current architecture/roadmap truth lives
in `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md` §22 and `ROADMAP.md`.

## Why the audit was commissioned

The original M0-M10 programme was a data/state architecture refactor. M6-M10 necessarily
adapted evaluation/planning/execution/runtime code enough to make the new model executable,
but no dedicated operational-runtime architecture closure had been run.

Founder T2 exposed a composition-level symptom:

- one reassessment unit was safely claimed per worker call;
- normal boot called that worker roughly every two seconds;
- 67 journey units were enqueued under the then-current manifests;
- final state was correct but propagation latency was unacceptable.

A first fix changed the scheduler to bounded continuous drain, reducing ~134s of idle sleep
but leaving ~16-17s of real 67-unit evaluation. The audit was asked to determine whether
the remaining behavior reflected necessary semantics or emergent composition.

## Main findings

The audit found:

1. the reactive assessment core was real and durable, but the recovery lifecycle after
   assessment was still test-composed/manual;
2. the 67-unit fan-out was an implementation artefact: ingress bookkeeping hit the
   unregistered-topic sentinel and baseline manifests were capture-slice-wide;
3. durable **ChangeSignal** identity was the missing provenance spine;
4. no deterministic escalation seam connected assessment consequences to RecoveryCase;
5. no target StrategyProposer produced normal runtime proposals;
6. authority/execution state machines existed but had no normal runtime driver;
7. durable-work primitives existed but runtime composition was incomplete;
8. frontend/read-model contracts needed cause/causalPath and proposal pairing, not a new
   graph architecture.

The audit explicitly found **no contradiction requiring F01-F18 to be reopened**.

## Accepted implementation sequence

### R0 — runtime composition closure

- move completion bookkeeping out of arbitrary world information;
- reject unsupported information topics rather than silently global-invalidating;
- bind baseline manifests to each subject's own closure;
- schedule due clock invalidation during worker wakes;
- create one runtime-services root;
- re-measure T2 rather than assuming the affected count.

### T3 — ChangeSignal + escalation

- materialize ChangeSignal identity/provenance;
- link scheduled reassessment/case cause to it;
- deterministic idempotent escalation;
- case cause/causalPath read model.

### T4 — verify focused case

Use authoritative read-model semantics only. No Event Overview redesign or frontend
business inference.

### B1 — first complete generalized internal loop

- request-scoped principal;
- generic StrategyProposer;
- proposal -> schema validation -> deterministic viability -> persisted strategy/plan;
- approval bound to reviewed basis;
- durable internal programme execution;
- observation -> canonical update -> reassessment -> resolution.

### B2 — second materially different proof

External provider loop / Jordan using the same application/domain lifecycle, provider
dispatcher and observation/reconciliation.

## Implementation result

- `6a96ee6` — R0 shared pieces;
- `41a2d58` — R0 ingress/composition tests;
- `cd620f7` — T3 + B1 composition;
- `82ae9b8` — RC-6 counterfactual viability and real AiT/Sarah B1 closure.

R0 re-measurement:

- 67 -> **5** reassessment units;
- ~17s -> **~2.4s** drain;
- final T2 truth unchanged.

B1 normal-path result:

`change -> case -> strategy -> viability -> approval -> internal execution ->
observation -> reassessment -> RESOLVED`.

## RC-6 discovered during B1

On the real AiT world, the dependency closure legitimately reached participants with
pre-existing unrelated FAIL/UNKNOWN state. The old M7 aggregator required every reached
subject to PASS, making every recovery candidate non-executable even when the proposal
did not cause those conditions.

The accepted contract is counterfactual:

- blocking case subjects must heal;
- reached subjects must not regress;
- new/action-critical UNKNOWN blocks;
- unchanged unrelated pre-existing FAIL/UNKNOWN neither vetoes nor becomes healed.

The dependency closure itself was retained.

## Deliberately deferred by the audit

- B2/external dispatcher until B1 proved;
- optional LLM proposer until deterministic end-to-end loop existed;
- Event Overview redesign/backend semantics;
- SSE/WebSockets;
- whole-event graph/semantic zoom;
- provider-reference auto-correlation platform work;
- generic outbox broker/consumer;
- retired SQLite deletion;
- any Sarah/Jordan-specific application/domain branch.
