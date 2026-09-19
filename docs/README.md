# Documentation

This index separates **current implemented truth**, **frozen architecture**, **current
delivery planning** and **historical evidence**.

## Frozen architecture

- **[DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md)** —
  frozen F01-F18 decisions, ontology, ownership, cardinalities, lifecycles and extension
  semantics.
- **[DATA_STRUCTURE_LOGICAL_SCHEMA.md](DATA_STRUCTURE_LOGICAL_SCHEMA.md)** — PostgreSQL /
  PostGIS logical schema, integrity, indexes and transaction/idempotency contracts.

These are implemented architectural constraints, not an unbuilt target.

## Current product/runtime truth

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — current PostgreSQL runtime including the
  post-C5 operational runtime closure and RC-6 counterfactual-viability contract.
- **[CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md)** — what actually
  works now, what is provider/sandbox constrained and what remains incomplete.
- **[ROADMAP.md](ROADMAP.md)** — milestone status, current next steps and deferred/stretch
  scope.
- **[SCENARIOS.md](SCENARIOS.md)** — scenario catalogue and acceptance intent; executable
  facts remain in data/fixtures/config.
- **[TESTING.md](TESTING.md)** — suite classification, focused-test-first discipline and
  current performance/hygiene constraints.
- **[ENVIRONMENT.md](ENVIRONMENT.md)** — runtime/test environment and provider setup.
- **[DESIGN.md](DESIGN.md)** / **[MOTION_DESIGN.md](MOTION_DESIGN.md)** — user-facing
  visual/motion guidance.

## Current delivery plan

- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) §22** — authoritative current plan:
  R1-R3/B1 are accepted; next is provider parity + all-Atlas restoration, then remaining
  required adapters, B2 consequential external execution, post-E2E product work and M11/C6.
- **[IMPLEMENTATION_PLAN_HISTORY.md](IMPLEMENTATION_PLAN_HISTORY.md)** — preserved
  historical M0-M11 decomposition and prior post-C5 Slice A/B plans. Use for provenance,
  not current sequencing.
- **[work/ACTIVE_TASK.md](work/ACTIVE_TASK.md)** — working-memory/acceptance ledger; its
  R3 local section is current acceptance evidence.
- **[refactor/evidence/POST_C5_RUNTIME_ARCHITECTURE_AUDIT.md](refactor/evidence/POST_C5_RUNTIME_ARCHITECTURE_AUDIT.md)** —
  historical evidence for the post-C5 runtime audit.
- **[work/TEST_PERFORMANCE_AUDIT_2026-09-18.md](work/TEST_PERFORMANCE_AUDIT_2026-09-18.md)** —
  read-only test/dev-startup performance findings and triage.

The accepted Event Overview V7.2 design currently lives separately on
`design/event-overview-v7-2` @ `563320e4e9ef7c2ea7dc4f53f0d07b3045dcfeb1`; production
implementation must start from the accepted post-R3 base.

## Agent / implementation workflow

- **[AGENT_MODEL_SELECTION.md](AGENT_MODEL_SELECTION.md)** — model/harness routing policy.
- **[MODELS_ARSENAL.md](MODELS_ARSENAL.md)** — deeper/volatile model-harness evidence; load
  only when routing itself needs reevaluation.
- **[IMPLEMENTATION_AGENT_ROUTING.md](IMPLEMENTATION_AGENT_ROUTING.md)** — alternative
  routes for implementation/review. Historical milestone rows do not override §22.
- **[BUILD_WITH_QODER.md](BUILD_WITH_QODER.md)** — historical Qoder-heavy workflow, not the
  current routing source of truth.

Root [`AGENTS.md`](../AGENTS.md) defines how these documents interact.

## Conflict rule

- **What works now?** code/tests + `CAPABILITIES_AND_LIMITATIONS.md`.
- **What architecture is frozen?** architecture closure + logical schema.
- **What is the current runtime shape?** `ARCHITECTURE.md`.
- **What happens next?** `IMPLEMENTATION_PLAN.md` §22 + `ROADMAP.md`.
- **How should it be tested?** `TESTING.md`.
- **Why did the runtime plan change?** runtime-audit evidence + Git history.
- **How should agents execute/review it?** `AGENT_MODEL_SELECTION.md` +
  `IMPLEMENTATION_AGENT_ROUTING.md`.

Current code/runtime evidence outranks stale historical milestone language. Historical
documents should not be rewritten to pretend they described later implementation.
