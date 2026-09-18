# ACTIVE TASK — B1 Product Acceptance Repair -> Founder B1 retest -> B2

Working-memory ledger. Keep this file lightweight. Historical T2/R0/T3/B1 detail is
archived at `docs/work/RUNTIME_CLOSURE_ACTIVE_TASK_ARCHIVE.md`.

## Status

- **B1 engine implementation: COMPLETE.**
- **Founder B1: NOT ACCEPTED** (physically tested 2026-09-18 —
  `docs/work/FOUNDER_B1_PHYSICAL_FINDINGS.md`).
- **Current milestone: B1 Product Acceptance Repair.**
- **Current blocker: focused recovery product UI / product navigation.**
- **B2: BLOCKED** until a Founder B1 physical retest passes.
- Test/dev-performance lane **H1-H4: DONE** and reconciled onto this branch.

## Goal

Immediate:
repair the minimum product boundary so the already-accepted recovery engine is operable and
understandable by a human, then have the founder physically retest the AiT/Sarah loop.

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
- CURRENT after the H1-H4 lane: 811/811, `npm test` ~13.8s (lane measurement; ~15.9s wall
  re-verified here including the boundary gate).
- Clean PostgreSQL checkpoint gate: 522/522, ~21.4 min — **historical B1 evidence**, not
  rerun for H1-H4 or the product repair.
- typecheck/build/lint/boundary/anti-hardcoding clean at B1 close.

These are implementation evidence, **not Founder physical acceptance** — and the
2026-09-18 physical session confirmed the difference: the backend finished correctly while
the product path was unusable.

## Current checkpoint — B1 Product Acceptance Repair

Act Now scope, each traced to a Founder finding. Smallest generalized fix only.

- [ ] **FB1-4 / clean routing** — normal PostgreSQL target server serves `/` and `/operator`
      as Overview and `/operator/cases/:id` as the focused case, all inside the product
      shell. API routes stay available; the retired SQLite composition stays unreachable.
- [ ] **FB1-3 / product shell** — focused case renders through `renderInShell(...)`, the
      same chrome as Overview.
- [ ] **FB1-2 / Overview navigation** — case-backed rows link to `/operator/cases/:caseRef`
      from the read model's existing authoritative `caseRef`. No case identity invented, no
      case routing derived in the browser, no link fabricated for a healthy row.
- [ ] **FB1-5 / strategy projection** — read the persisted `overallVerdict`; resolve known
      Journey subjects to the authoritative Traveller display name; preserve genuine
      `UNKNOWN`. Do **not** persist display names into `RecoveryStrategy`.
- [ ] **FB1-6 / readable options** — explain each option from authoritative
      `strategy_changes` / ScenarioChange effects: which programme items move, current vs
      proposed timing, who it fixes, deterministic viability. Refs/version stay secondary.
      No LLM, no ranking.
- [ ] **FB1-6 / investigate** — are the two VIABLE strategies legitimate alternatives,
      repeated proposal versions, or exact semantic duplicates? Fix duplication only at a
      generalized boundary if it is real.

Protect: B1 deterministic recovery engine, RC-6 viability, authority/approval behavior,
PostgreSQL-only runtime, generalized logic, focused-test-first discipline.

## Founder B1 retest — expected physical flow

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

Plus the product path itself: Sarah's case opens by clicking her row on Overview, the case
renders in the product shell, and each option states in plain language what it changes.

### Founder B1 outcome

- 2026-09-18 attempt 1: **FAIL / NOT ACCEPTED** — product boundary. Evidence recorded in
  `docs/work/FOUNDER_B1_PHYSICAL_FINDINGS.md`.
- [ ] Retest: PASS / accepted
- [ ] Retest: FAIL / defect found
- [ ] Retest: exact evidence recorded

## Next milestone after Founder B1 acceptance — B2 (BLOCKED)

B2 = generalized external recovery / Jordan. **Do not start until the Founder B1 physical
retest is accepted.**

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

## Parallel lane — test/dev performance — H1-H4 DONE

Read-only audit:
`docs/work/TEST_PERFORMANCE_AUDIT_2026-09-18.md`.

H1-H4 are complete and reconciled onto `feature/sarah-provider-disruption` by cherry-pick,
preserved as three distinct commits:

- H1 `8e01c59` — isolate `inboxOutbox.pgtest.ts` from global queue residue;
- H2 `ded3189` — sticky daily dev workspace / target env loading from dotenv on boot;
- H3/H4 `951adef` — bounded CURRENT-suite concurrency and raw `node --test` footgun.

Re-verified on this branch: typecheck clean, `npm test` 811/811, focused
`inboxOutbox.pgtest.ts` 7/7. The expensive PostgreSQL gate was **not** rerun for this lane.

I1-I4 remain parallel engineering investigations, not part of this milestone.

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

## Parked from the Founder session

- **FB1-1 in-product reset** — dev ergonomics. Use the sticky `.env.local` workspace for
  daily development and a fresh workspace UUID for a clean physical test. Not B1 semantics.
- Fresh-boot SERIALIZABLE conflict that retried successfully — no correctness impact.

## Next action

**B1 Product Acceptance Repair**, then hand back for **Founder B1 physical retest** on a
fresh workspace UUID.

If the retest PASSES:
freeze the observed product floor and create the B2 implementation ledger/plan from the
current runtime, then start B2.

If the retest FAILS:
triage the first broken product boundary and fix it before B2.
