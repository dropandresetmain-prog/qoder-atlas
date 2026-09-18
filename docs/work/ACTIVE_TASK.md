# ACTIVE TASK — Founder B1 acceptance -> B2 external recovery

Working-memory ledger. Keep this file lightweight. Historical T2/R0/T3/B1 detail is
archived at `docs/work/RUNTIME_CLOSURE_ACTIVE_TASK_ARCHIVE.md`.

## Goal

Immediate:
physically verify the first complete generalized internal recovery loop on the real
AiT/Sarah product surface.

After Founder B1 acceptance:
implement B2, the generalized external-provider recovery loop, using Jordan only as a
materially different proof of the same engine.

## Identity

- Repository: `dropandresetmain-prog/qoder-atlas`
- Branch: `feature/sarah-provider-disruption`
- B1 implementation tip: `82ae9b80f62a26d8b7e8e6277aa5bf6183ff44f0`
- Runtime-audit base: `c20228c2dfffcaf1cfa34571df5ab99f719a6e3c`
- R0/T3/B1 checkpoints: `6a96ee6`, `41a2d58`, `cd620f7`, `82ae9b8`

Do not merge or start B2 until Founder B1 acceptance is explicitly recorded, unless the
owner changes that order.

## Frozen architecture

Preserve F01-F18 and the accepted PostgreSQL ownership/transaction model unless a concrete
contradiction is proven.

Normal consequential path:

`proposal -> schema validation -> deterministic viability -> authority -> executor ->
observation -> canonical update -> reassessment -> resolution/continue`.

Never LLM -> irreversible/money-moving API.

Operational runtime closure now includes:

- durable ChangeSignal provenance;
- subject-bound assessment manifests;
- clock-expiry reassessment scheduling;
- one runtime-services composition root;
- deterministic escalation;
- generic StrategyProposer;
- request-scoped principal/approval;
- durable internal programme execution;
- observation -> canonical update -> reassessment -> resolution.

### RC-6 viability

Reached closure = reassessment scope, not a perfection requirement.

A candidate must:

- heal the blocking case subjects it is responsible for;
- not worsen any reached subject;
- not introduce new/action-critical UNKNOWN;
- satisfy `requiredUnknowns`.

Unchanged unrelated pre-existing FAIL/UNKNOWN stays truthful and does not automatically
veto or become healed.

## Evidence already accepted in implementation

- R0 Sarah disruption: 5 reassessment units, ~2.4s drain.
- B1 real AiT/Sarah PG flow: RESOLVED, blocking subject PASS.
- `b1SarahWorldRecovery.pgtest.ts`: PASS.
- `b1RecoveryLoop.pgtest.ts`: PASS.
- CURRENT after performance investigation: 802/802.
- Clean PostgreSQL checkpoint gate: 522/522, ~21.4 min.
- typecheck/build/lint/boundary/anti-hardcoding clean at B1 close.

These are implementation evidence, **not Founder physical acceptance**.

## Current checkpoint — Founder B1

Expected physical flow:

1. boot the AiT bundle on a known workspace;
2. Overview baseline = **50 PASS / 2 FAIL / 15 UNKNOWN**;
3. apply disclosed simulated airline update;
4. settled Overview = **49 PASS / 3 FAIL / 15 UNKNOWN** without 0->49 rebuild;
5. open the incident-linked Sarah case;
6. verify authoritative cause + causalPath;
7. request strategies;
8. at least one generic programme recovery persists **VIABLE**;
9. approve as the workspace operator;
10. internal programme actions execute/observe/reassess;
11. Sarah becomes PASS;
12. incident case becomes **RESOLVED**;
13. unrelated baseline FAIL/UNKNOWN remains truthful.

Record:
- product/browser result;
- any broken boundary;
- actual elapsed time;
- screenshots/video evidence if useful;
- exact running SHA/config.

### Founder B1 outcome

- [ ] PASS / accepted
- [ ] FAIL / defect found
- [ ] Exact evidence recorded

## Next milestone after Founder B1 — B2

B2 = generalized external recovery / Jordan.

Required direction, not pre-authorized implementation detail:

- progressive external observations enter as ChangeSignals;
- a flight-recovery proposer implements the existing StrategyProposer port;
- Atlas Search/Verify or provider-shaped REPLAY data informs proposals where useful;
- ScenarioChange validation and RC-6 deterministic viability stay unchanged;
- same ActionPlan / authority / approval boundary;
- provider-neutral external dispatcher;
- truthful partial / OUTCOME_UNKNOWN handling;
- provider observation -> canonical reconciliation;
- same reassessment and resolution gate.

No Jordan-specific domain/application branch, route constant, traveller name, offer ID or
precomputed outcome.

Before implementation, inspect the current B1 topology and existing Atlas/external
dispatcher seams; freeze shared interfaces and acceptance criteria before parallel lanes.

## Parallel lane — test/dev performance

Read-only audit:
`docs/work/TEST_PERFORMANCE_AUDIT_2026-09-18.md`.

Act Now engineering-productivity work:

- H1 isolate `inboxOutbox.pgtest.ts` from global queue residue;
- H2 sticky daily dev workspace / target env loading;
- H3 bounded CURRENT-suite concurrency;
- H4 documentation/raw-node-test footgun.

This lane is not a product milestone. It must preserve coverage and the focused-test-first
hierarchy.

## Parked / known

- RC-7 authority coverage snapshot — revisit if B2 creates subjects after provision.
- RC-8 budget holds — revisit before money-moving provider actions.
- RC-9 normal outbox publisher — do not build merely for test cleanup.
- RC-10 provider ingress as in-request saga — retry/idempotency currently proven.
- preview `previewAccepted` older all-PASS rollup — Investigate before it can mislead UI.
- Event Overview final design — unresolved; post-E2E after accepted design.
- semantic activity projection — post-E2E.
- whole-event graph / semantic zoom / SSE — stretch/park.
- Railway readiness semantics — Act before final candidate.
- external legacy-file inventory — before M11.

## Verification discipline

During implementation:

1. smallest focused test;
2. adjacent/module;
3. relevant PG seam;
4. broader PG gate only at coherent checkpoint;
5. full candidate gates only when justified.

Do not run `npm run test:postgres` as a debugging loop. A clean gate is ~21 min and
contains intentionally expensive real-world acceptance tests.

## Next action

**Founder B1 physical acceptance.**

If PASS:
freeze the observed product floor and create the B2 implementation ledger/plan from the
current runtime, then start B2.

If FAIL:
triage the first broken product boundary and fix it before B2.
