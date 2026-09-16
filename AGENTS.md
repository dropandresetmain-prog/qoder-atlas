# AGENTS.md

## Mission

Build Northstar as a generalized travel-resolution product without scenario-specific hardcoding or false capability claims.

The graph/state model is central. Chat, dashboards and mobile surfaces are interfaces over authoritative state; they are not the source of truth.

The normal orchestration lifecycle is:

`Planner / Architect -> Prompter -> Implementer -> Integrator -> Reviewer when warranted -> Promotion / Cutover`

Review is a risk-control step, not a ritual.

## Source-of-truth order

Before broad implementation, inspect the actual branch/head and read the relevant parts of:

1. `docs/DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md` — **approved target architecture**, frozen decisions F01-F18, ownership/cardinality/lifecycle semantics.
2. `docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md` — **approved target persistence and transaction model**.
3. `docs/IMPLEMENTATION_PLAN.md` — M0-M11 execution sequence, C0-C6 checkpoints and AT01-AT24 acceptance coverage.
4. `docs/ARCHITECTURE.md` — concise current-runtime versus approved-target architecture map.
5. `docs/CAPABILITIES_AND_LIMITATIONS.md` — **implemented reality today**. Target design is not implementation evidence.
6. `docs/ROADMAP.md` — capability/refactor status and intentionally deferred scope.
7. `docs/TESTING.md` — cumulative verification rules and current-runtime regression families.
8. `docs/AGENT_MODEL_SELECTION.md` — current operational model/harness routing policy.
9. `docs/MODELS_ARSENAL.md` — deeper, more volatile model/harness evidence; load only when routing genuinely needs reevaluation.
10. `docs/IMPLEMENTATION_AGENT_ROUTING.md` — three alternative model+harness routes for each M0-M11 milestone and C0-C6 checkpoint.
11. `docs/ENVIRONMENT.md` and `.qoder/rules/environment-recovery.md` when environment/provider execution is involved.

`docs/BUILD_WITH_QODER.md` is a historical record of how the original hackathon candidate was built. It is not the current routing policy.

For Atlas capability questions, consult the authoritative research in `dropandresetmain-prog/atlas-hackathon-lab`; do not guess.

If current code and the approved target differ during the refactor, that is expected until cutover. Do not silently reinterpret the legacy runtime as the target design or claim target capability before it lands.

## Orchestration roles

### Planner / Architect
Owns architecture, shared contracts, decomposition, dependencies, lane boundaries, collision analysis and acceptance criteria.

- Do not reopen F01-F18 because another implementation is aesthetically cleaner.
- Reopen a frozen decision only for a concrete contradiction or new requirement the approved architecture cannot express.
- Freeze shared contracts before parallel implementation.
- Specify dependencies, overlapping paths, integration order and merge risks.

### Prompter
Turns an approved milestone/package into an execution prompt.

Include exact branch/worktree/head, package objective, authoritative files, frozen contracts, owned/do-not-touch paths, acceptance criteria, scoped verification, exclusions, delegation guidance and completion report.

Do not re-plan the product.

### Implementer
Owns one assigned package/lane.

- Verify branch, worktree, head and authoritative files before editing.
- Execute the approved plan; do not silently fork schemas/contracts.
- Surface architecture gaps instead of hardcoding around them.
- Delegate bounded, independently verifiable work where useful.
- Keep architecture, integration decisions, Critical changes and final verification with the primary agent.
- Run the narrowest checks that prove changed behaviour and relevant failure paths.
- Update the implementation evidence required by `docs/IMPLEMENTATION_PLAN.md`.

### Integrator
Owns cross-lane seams and accepted contract reconciliation.

- Verify lane heads, ancestry, reports and intended merge order.
- Reuse valid lane evidence.
- Test newly created seams/conflict resolutions rather than rerunning everything by habit.
- Do not let a lane solve integration by creating a local contract variant.

### Reviewer
Independent model review is **uncertainty-driven**, not automatically attached to every checkpoint.

- Bounded/Normal work does not get a reviewer by default.
- Complex work gets review only for material uncertainty, cross-contract risk or an expensive seam.
- Critical work normally gets **one** independent reviewer plus required execution evidence when that reviewer materially reduces unresolved risk.
- A checkpoint remains an acceptance/evidence gate even when no independent model review is needed.
- Prefer a different model family/surface from the implementer when independence matters.
- Inspect actual repository SHA and existing evidence first.
- Run additional checks only for concrete unresolved questions.
- Classify every finding exactly: `Act Now`, `Investigate Now`, `Park for Later`, or `Ignore / Accept Risk`.
- Targeted fixes need targeted closure evidence; they do not automatically trigger a full re-review.

## Architectural invariants

- One generalized recovery engine supports solo, family/group, corporate/TMC, organiser and future direct-traveller use cases.
- AI may interpret messy context, extract/map structured candidates, identify uncertainty, infer soft preferences, judge semantic consequences and propose/compare recovery strategies.
- Deterministic code owns schema/business validation, authoritative mutation, time/currency arithmetic, dependency/applicability propagation, policy thresholds, authority, lifecycle transitions, viability, execution validation and reconciliation.
- Never allow `LLM -> irreversible/money-moving API`.
- Required consequential path: `AI proposal -> validation -> deterministic viability -> authority -> executor -> observation -> state update`.
- Structured provider data should be mapped deterministically where practical.
- Proposed recovery state is isolated from current world state until an internally authoritative commit or external observation establishes the result.
- `UNKNOWN` is valid. Missing, stale, conflicting or incomplete information must not become certainty.
- Explicit instructions outrank latent preferences; inferred preferences remain soft signals.
- Externally owned state is not changed merely because Northstar submitted a request.

## Approved refactor foundation

The target architecture is defined by F01-F18. Key consequences for implementation include:

- PostgreSQL is the target authoritative application database; PostGIS handles geographic applicability.
- Workspace is the data/access partition; Organisation is a business party.
- Traveller is a stable person; Trip is a shared undertaking; Journey is one traveller's independently managed participation in a Trip.
- Event -> Programme -> ProgrammeItem is real mutable domain state; Participation links people to programme items independently of travel.
- Journey intent, supplier service/reservation state, requirements, proposed changes and computed assessments have distinct owners.
- Travel credentials, entry/transit requirements, advisories/conditions, provenance/freshness and external record ownership are first-class target concerns.
- Assessments are immutable derived results bound to revisions/generations/evidence/time.
- Normal relationships use foreign keys; explicit dependency semantics exist only where executable propagation requires them.
- Consequential execution uses typed actions, scoped authority, durable attempts, observation and reconciliation.
- New trip-relevant information extends through typed modules/applicability/evaluators; do not recreate a generic JSON fact bucket.

Do not introduce Neo4j, microservices, Kafka, Kubernetes or another infrastructure tier without a demonstrated requirement and an approved architecture change.

## Current runtime versus target persistence

The **current baseline runtime still uses SQLite** and the legacy aggregate model until the controlled refactor cutover. That is implementation truth, not the approved future architecture.

The **approved target is PostgreSQL + PostGIS** behind explicit repository/unit-of-work boundaries, with relational ownership/integrity, expected revisions, idempotency receipts, durable work and typed domain tables.

Since M10/C5, **PostgreSQL is the sole NORTHSTAR runtime.** SQLite exists only as explicit offline, read-only migration input. It is not a fallback runtime, not an alternate runtime, not a demo runtime and not a normal application runtime. `test/m10-runtime-purge.test.ts` proves the runtime import graph cannot reach it; `npm run gate:test-boundary` proves the current test suites cannot either.

M11 remains the controlled operational switch where the target becomes the sole application authority.

## Anti-hardcoding

Never add scenario-specific branches, fixture IDs, traveller/event names, cities, routes, suppliers or demo dates to domain/recovery logic.

Provider-specific mapping belongs in concrete adapters. Demo facts belong in data/configuration/sources.

At least two materially different scenarios must use the same application code. Refactor acceptance additionally covers family/group, corporate/agency, programme, entry/advisory and unprecedented-data extension cases in AT01-AT24.

If the approved ontology/contracts cannot express a requirement, report an **architecture gap**. Do not hardcode around it.

## External capability boundaries

- Atlas is a flight adapter, not the architecture.
- Existing Nuitée/liteAPI, Google Routes, Model Studio and other providers are adapters/capabilities, not domain owners by default.
- Mocks are allowed only at external provider/action boundaries.
- Internal ingestion, mutation, propagation, planning, viability, authority, observation and lifecycle logic stay real.
- LIVE / RECORD / REPLAY should share normalisation/downstream paths where practical.
- A new provider, GDS/TMC system, advisory source, entry-data source or weather source must enter through the approved ownership/information/capability boundaries rather than force scenario logic into the engine.

## Agent routing

Follow `docs/AGENT_MODEL_SELECTION.md` and the milestone/checkpoint alternatives in `docs/IMPLEMENTATION_AGENT_ROUTING.md`. Load `docs/MODELS_ARSENAL.md` only when the routing decision itself needs deeper/updated evidence.

There is **no single default implementation harness**. Route in this order:

`role -> harness capability -> task shape/risk -> independence -> effort`.

Important current observations:

- The frozen architecture means much difficult M0-M11 work is **Bounded/Hard Bounded**, not automatically Complex.
- Cursor/Codex/Claude Code are preferred for time-sensitive local write/run/fix loops.
- Qwen3.8-Flash and GLM-5.3-Flash are legitimate defined-task implementers, not merely cheap subagents.
- Qoder remains useful for Qwen/Kimi/GLM work; its ARM64 latency is a harness constraint, not a model-quality judgement.
- Astra is a **model**, not a harness, and belongs in Complex/Critical architecture/investigation rather than Normal implementation.
- Luna High/xHigh/Max are serious bounded implementation routes when the destination is already clear.
- Sol/Opus/Astra-class use is escalation for concrete ambiguity/risk, not a tax on every Critical-labelled milestone.
- Model choice stays separate from the execution prompt.

For long-horizon work, use `docs/work/ACTIVE_TASK.md` as working memory when the task is likely to exceed a normal coding session. Re-read it before major phases, after compaction/delegation and before completion; close checklist items only with evidence.

## Verification is cumulative evidence

Follow `docs/TESTING.md` plus AT01-AT24/checkpoint requirements in `docs/IMPLEMENTATION_PLAN.md`.

- **Implementation:** focused relevant unit/integration test -> focused PG seam test -> typecheck/build/lint only when relevant. Do **not** run the broad suite after every edit.
- **Integration:** seam/conflict/new-interaction checks; reuse valid lane evidence.
- **Review:** inspect existing evidence first; execute more only for concrete uncertainty.
- **Candidate/cutover:** the full canonical CURRENT target gate once, on a fresh database.

Never claim a check passed unless it ran successfully. Do not use paid/live provider calls in routine verification unless explicitly needed and authorised.

### Test suites

Every test file is classified in `test/suites.json`; commands run explicit file lists, never directory globs.

| Command | What it proves | Gating |
|---|---|---|
| `npm test` | boundary gate + current NORTHSTAR surface (no DB, no browser) | yes |
| `npm run test:postgres` | current PostgreSQL integration gate | yes |
| `npm run test:migration` | M10 migration boundary, where SQLite is read-only input | yes |
| `npm run test:legacy` | retired SQLite runtime — **NON-GATING / HISTORICAL / MANUAL ONLY** | no |

`npm run gate:test-boundary` walks the real import graph and fails if a current test reaches the retired SQLite runtime, `node:sqlite` or `src/migration/**`, or if any test file is unclassified.

**Historical SQLite runtime failures are never a release blocker and are not current product correctness.** Do not run `test:legacy` during normal implementation and do not repair what it reports unless you were explicitly assigned historical/migration investigation.

## Issue and scope discipline

Every discovered issue/risk must be classified:

- Act Now
- Investigate Now
- Park for Later
- Ignore / Accept Risk

Every intentionally excluded capability remains visible in `docs/ROADMAP.md` with reason/revisit condition. Never silently drop scope.

## Git and worktrees

- Verify actual branch/head before implementation/integration.
- Parallel lanes must not share uncommitted state.
- Use exact-path staging; do not default to `git add .` / `git add -A`.
- Commit coherent, testable checkpoints and push them.
- Before claiming pushed/integrated state, verify actual branch/commit/remote.

## Completion report / handoff

After an implementation package, report material evidence only:

1. What now works and what intentionally did not change.
2. Branch/worktree and exact head.
3. Milestone/package ID.
4. Files changed.
5. Behaviour/schema changed.
6. Checks actually run and results.
7. Failure/fallback behaviour verified.
8. Findings and triage.
9. Documentation/evidence updated.
10. Commit/push state.
11. Exact next dependency/checkpoint.
