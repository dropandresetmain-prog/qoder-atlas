# Documentation

The repository README is the product entry point and reproduction guide. This index separates **current runtime truth**, **frozen architecture**, **current delivery planning**, and **historical implementation evidence** so agents do not confuse design/history with what is currently being built.

## Frozen architecture

- **[DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md)** — normative architecture: frozen F01-F18 decisions, ontology, ownership, cardinalities, lifecycles, advisories/entry/group/extensibility semantics.
- **[DATA_STRUCTURE_LOGICAL_SCHEMA.md](DATA_STRUCTURE_LOGICAL_SCHEMA.md)** — normative PostgreSQL/PostGIS logical schema, integrity, indexes, transaction/idempotency boundaries and JSON limits.

These documents remain authoritative unless current implementation exposes a genuine architecture contradiction.

## Current product/runtime truth

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — concise map of the current PostgreSQL runtime, ownership boundaries, provider composition direction, graph/read-model rules and delivery boundary.
- **[CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md)** — implementation/provider truth **today**: what exists, what is accepted, what remains off-main/incomplete, and current provider/runtime limitations.
- **[ROADMAP.md](ROADMAP.md)** — current milestone status, protected demo floors, review checkpoints and intentionally deferred/stretch scope.
- **[SCENARIOS.md](SCENARIOS.md)** — current scenario catalogue and demo/acceptance intent; executable facts remain in fixtures/configuration.
- **[TESTING.md](TESTING.md)** — canonical CURRENT_TARGET / MIGRATION_BOUNDARY / HISTORICAL_LEGACY suite contract and focused-test-first verification rules.
- **[ENVIRONMENT.md](ENVIRONMENT.md)** — runtime setup/environment variables and provider configuration.
- **[DESIGN.md](DESIGN.md)** — user-facing design system.
- **[MOTION_DESIGN.md](MOTION_DESIGN.md)** — browser-rendered motion/video production guidance.

## Current delivery plan

- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** — authoritative current post-C5 delivery plan in Section 22: T2 -> T3 -> T4 -> Slice A -> Slice B -> Jordan -> Astra planning reconciliation -> post-E2E product milestones -> M11/final candidate.
- **[IMPLEMENTATION_PLAN_HISTORY.md](IMPLEMENTATION_PLAN_HISTORY.md)** — preserved historical M0-M11 decomposition and the previous post-C5 Slice A/B plan. Use for provenance/history, not current sequencing.

## Agent / implementation workflow

- **[AGENT_MODEL_SELECTION.md](AGENT_MODEL_SELECTION.md)** — operational role/harness/task-shape/effort routing policy. This is the first routing file to consult.
- **[MODELS_ARSENAL.md](MODELS_ARSENAL.md)** — deeper, more volatile model/harness evidence, observed constraints and fallbacks. It is already adapted from `dropandresetmain-prog/resume-copilot`; load it only when model choice genuinely needs reevaluation.
- **[IMPLEMENTATION_AGENT_ROUTING.md](IMPLEMENTATION_AGENT_ROUTING.md)** — three alternative model + harness routes for current post-C5 implementation/planning stages and the key review gates that actually warrant independent review.
- **[BUILD_WITH_QODER.md](BUILD_WITH_QODER.md)** — historical description of the original hackathon candidate's Qoder-heavy development workflow. It is not the current routing source of truth.

Root [`AGENTS.md`](../AGENTS.md) defines how these documents interact during implementation.

## Conflict rule

Use the document appropriate to the question:

- **What works right now?** -> code/tests + `CAPABILITIES_AND_LIMITATIONS.md`.
- **What architecture is frozen?** -> architecture closure + logical schema.
- **What happens next?** -> current `IMPLEMENTATION_PLAN.md` + `ROADMAP.md`.
- **How should agents execute/review it?** -> `AGENT_MODEL_SELECTION.md` + `IMPLEMENTATION_AGENT_ROUTING.md`.
- **Why is a model/harness routed that way, or has the roster changed?** -> `MODELS_ARSENAL.md`.
- **What did the old refactor plan say?** -> `IMPLEMENTATION_PLAN_HISTORY.md` + `docs/refactor/evidence/**`.

Current code/schema/runtime establish implemented reality. Frozen architecture governs new implementation unless a documented architecture gap forces a deliberate change. Historical plans/evidence do not override current runtime truth or the current Section 22 delivery sequence.
