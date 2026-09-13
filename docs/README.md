# Documentation

The repository README is the product entry point and reproduction guide. This index separates **implemented-runtime truth** from the **approved target refactor** so agents do not confuse design with shipped capability.

## Approved target architecture / refactor

- **[DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md)** — normative target architecture: frozen F01-F18 decisions, ontology, ownership, cardinalities, lifecycles, advisories/entry/group/extensibility semantics.
- **[DATA_STRUCTURE_LOGICAL_SCHEMA.md](DATA_STRUCTURE_LOGICAL_SCHEMA.md)** — normative PostgreSQL/PostGIS logical schema, integrity, indexes, transaction/idempotency boundaries and JSON limits.
- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** — M0-M11 critical path, C0-C6 gates, migration/cutover plan and AT01-AT24 architecture acceptance tests.

These documents define the approved target. They do **not** prove the target has been implemented.

## Current product/runtime truth

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — concise map of both the current legacy runtime and approved target architecture, including the transition boundary.
- **[CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md)** — implementation/provider truth **today**: what exists, what is partial/sandbox constrained, and which approved target capabilities are still pending.
- **[ROADMAP.md](ROADMAP.md)** — current capability status plus refactor milestone status and explicitly stretched/deferred scope.
- **[SCENARIOS.md](SCENARIOS.md)** — current scenario catalogue and demo/acceptance intent; executable facts remain in fixtures/configuration.
- **[TESTING.md](TESTING.md)** — cumulative-verification rules and existing runtime regression families. Refactor-specific AT01-AT24 and C0-C6 are owned by `IMPLEMENTATION_PLAN.md` until they are materialised in M0.
- **[ENVIRONMENT.md](ENVIRONMENT.md)** — current runtime setup/environment variables and provider configuration.
- **[DESIGN.md](DESIGN.md)** — user-facing design system.
- **[MOTION_DESIGN.md](MOTION_DESIGN.md)** — browser-rendered motion/video production guidance.

## Agent / implementation workflow

- **[AGENT_MODEL_SELECTION.md](AGENT_MODEL_SELECTION.md)** — operational role/harness/task-shape/effort routing policy. This is the first routing file to consult.
- **[MODELS_ARSENAL.md](MODELS_ARSENAL.md)** — deeper, more volatile model/harness evidence, observed constraints and fallbacks. Load only when model choice itself needs reevaluation.
- **[IMPLEMENTATION_AGENT_ROUTING.md](IMPLEMENTATION_AGENT_ROUTING.md)** — three alternative model + harness routes for every M0-M11 milestone and C0-C6 checkpoint, using the current routing policy.
- **[BUILD_WITH_QODER.md](BUILD_WITH_QODER.md)** — historical description of the original hackathon candidate's Qoder-heavy development workflow. It is not the current routing source of truth.

Root [`AGENTS.md`](../AGENTS.md) defines how these documents interact during implementation.

## Conflict rule

Use the document appropriate to the question:

- **What works right now?** -> code/tests + `CAPABILITIES_AND_LIMITATIONS.md`.
- **What is the approved future architecture?** -> architecture closure + logical schema.
- **What happens next?** -> implementation plan + roadmap.
- **How should agents execute/review it?** -> agent model selection + implementation routing.
- **Why is a model/harness routed that way, or has the roster changed?** -> models arsenal.

If code and the approved target disagree during the refactor, do not silently choose one. Current code remains runtime truth until cutover; the approved target governs new refactor implementation unless a documented architecture gap forces a deliberate change.
