# AGENTS.md

## Mission

Build NORTHSTAR as a generalized travel-resolution product without scenario-specific hardcoding or false capability claims.

The graph/state model is central. Chat, dashboards and traveller surfaces are interfaces over authoritative state; they are not the source of truth.

The normal orchestration lifecycle is:

`Planner / Architect -> Prompter -> Implementer -> Integrator -> Reviewer when warranted -> Promotion / Activation`

Review is a risk-control step, not a ritual.

## Current project state

The PostgreSQL/PostGIS data/state refactor through M10/C5 remains accepted. PostgreSQL is
the sole normal NORTHSTAR runtime; SQLite is migration/historical input only and is never a
fallback.

The accepted 2026-09-18 product-parity audit established that the refactor also disconnected
material generalized planning and product-decision capabilities. The existing
state/evaluation/authority/execution spine is retained; the missing work is **planning
composition and product parity**, not another engine rewrite.

Forward architecture is frozen in
`docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md`.

Current sequence:

`R1 planning + decision-evidence parity
-> R2 Case decision surface
-> R3 full rebased B1
-> B2 consequential external execution
-> post-E2E product/observability/provider hardening
-> M11/C6`.

The earlier internal programme loop and B1 product-boundary repair remain valid implemented
slices, but they are **not accepted as the complete B1 product reasoning proof**.

Do not reopen the ontology, RC-6, M8 authority/execution, Atlas adapters or PostgreSQL
runtime absent a concrete contradiction. Do not begin B2 before full rebased B1 acceptance.

## Source-of-truth order

Before broad implementation, inspect the actual branch/head and read the relevant parts of:

1. `docs/DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md` — frozen F01-F18 architecture decisions, ownership/cardinality/lifecycle semantics.
2. `docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md` — approved persistence and transaction model.
3. `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md` — frozen forward recovery-planning, evidence, recommendation, blast-radius, continuation and B1/B2 contracts.
4. `docs/ARCHITECTURE.md` — concise **current** architecture map.
5. `docs/CAPABILITIES_AND_LIMITATIONS.md` — implemented reality and current limitations.
6. `docs/ROADMAP.md` — milestone status, current delivery sequence and intentionally deferred scope.
7. `docs/IMPLEMENTATION_PLAN.md` — historical M0-M11 decomposition plus the authoritative current programme in Section 22.
8. `docs/TESTING.md` — canonical suite classification, focused-test-first rules and foundational parity gate.
9. `docs/work/ACTIVE_TASK.md` — current working-memory ledger.
10. `docs/AGENT_MODEL_SELECTION.md` — operational model/harness routing policy.
11. `docs/MODELS_ARSENAL.md` — deeper, more volatile model/harness evidence; load only when routing genuinely needs reevaluation.
12. `docs/IMPLEMENTATION_AGENT_ROUTING.md` — alternative model+harness routes for current phases/checkpoints.
13. `docs/ENVIRONMENT.md` and `.qoder/rules/environment-recovery.md` when environment/provider execution is involved.

Historical milestone evidence under `docs/refactor/evidence/**` is evidence of what was true at that checkpoint. Do not rewrite it to match the current runtime.

`docs/BUILD_WITH_QODER.md` is historical build context, not current routing policy.

For Atlas capability questions, consult the authoritative research in `dropandresetmain-prog/atlas-hackathon-lab`; do not guess.

## Orchestration roles

### Planner / Architect
Owns architecture, shared contracts, decomposition, dependencies, lane boundaries, collision analysis and acceptance criteria.

- Do not reopen F01-F18 because another implementation is aesthetically cleaner.
- Reopen a frozen decision only for a concrete contradiction or new requirement the approved architecture cannot express.
- Freeze shared contracts before parallel implementation.
- Specify dependencies, overlapping paths, integration order and merge risks.
- Prefer founder-testable vertical slices over long horizontal completion tunnels.

### Prompter
Turns an approved milestone/package into an execution prompt.

Include exact branch/worktree/head, objective, authoritative files, frozen contracts, owned/do-not-touch paths, acceptance criteria, scoped verification, exclusions, delegation guidance and completion report.

Do not re-plan the product.

### Implementer
Owns one assigned package/lane.

- Verify branch, worktree, head and authoritative files before editing.
- Execute the approved plan; do not silently fork schemas/contracts.
- Surface architecture gaps instead of hardcoding around them.
- Delegate bounded, independently verifiable work where useful.
- Keep architecture, integration decisions, critical changes and final verification with the primary agent.
- Run the narrowest checks that prove changed behaviour and relevant failure paths.
- Do not use full-suite execution as the debugging loop.

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
- Critical work normally gets one independent reviewer plus required execution evidence when that reviewer materially reduces unresolved risk.
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
- Externally owned state is not changed merely because NORTHSTAR submitted a request.

## Implemented refactor foundation

The current PostgreSQL runtime implements the F01-F18 target foundation through M10/C5. Important consequences include:

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

## Runtime and persistence boundary

**Current runtime:** PostgreSQL + PostGIS target composition.

**Retired runtime:** SQLite legacy application composition. It remains in-tree only for historical evidence and offline migration tooling.

`test/m10-runtime-purge.test.ts` proves the live runtime import graph cannot reach the retired SQLite composition. `npm run gate:test-boundary` proves CURRENT_TARGET tests cannot reach it either.

M11 is no longer a database-runtime migration. It is the final **operational activation / retirement** step: external legacy-source inventory if relevant, final authority/sole-writer verification, reconciliation/provenance closure and retirement of any remaining old operational access. Do not reactivate SQLite as rollback.

## Product delivery discipline

### R1 — planning + decision-evidence parity

Extend the current target planning composition; do not create another engine.

Required path:

`RecoveryCase/current failure
-> recovery-domain identification
-> bounded read-only evidence gathering
-> StrategyProposer candidates
-> schema validation
-> RC-6 deterministic viability
-> material decision evidence
-> viable-only recommendation`.

Read tools cannot express consequential operations. Material rejected alternatives remain
explainable without being promoted into executable RecoveryStrategy rows.

### R2 — Case decision surface

Adapt the rich pre-refactor Case information architecture onto PostgreSQL read models. The
backend must explicitly project what changed, investigated/rejected/viable options,
recommendation, immediate proposed-change blast radius, reassessment closure, outcome
delta, approval, execution/observation and current recovery truth.

Do not redesign Event Overview in this phase.

### R3 — full rebased B1

B1 proves Sarah's complete recovery **reasoning** plus internal programme execution:
provider reprotection -> whole-trip FAIL -> travel research/evaluation -> programme-side
candidates where relevant -> RC-6 -> comparison/recommendation -> operator approval ->
internal execution -> observation -> reassessment -> PASS/resolution.

This must emerge from generalized state/domains/evidence. No Sarah branch and no global
flight-first/programme-second pipeline.

A second materially different planning case must use the same coordinator/contracts before
B1 acceptance. B1 does not require consequential external booking/payment execution.

### B2 — consequential external execution

B2 uses the same coordinator/evidence/proposer/RC-6/recommendation/ActionPlan/authority
path and adds external ActionIntent dispatch, durable attempt-before-network, uncertain and
partial outcomes, reconciliation before retry, provider observation, reassessment and
continued recovery. Jordan is proof of generality, not a Jordan engine.

### After B2

Proceed to accepted Event Overview implementation, semantic operational history/provider
hardening, final demo polish and M11/C6.

## Anti-hardcoding

Never add scenario-specific branches, fixture IDs, traveller/event names, cities, routes, suppliers or demo dates to domain/recovery logic.

Provider-specific mapping belongs in concrete adapters. Demo facts belong in data/configuration/sources.

At least two materially different scenarios must use the same application code. Refactor acceptance additionally covers family/group, corporate/agency, programme, entry/advisory and unprecedented-data extension cases in AT01-AT24.

If the approved ontology/contracts cannot express a requirement, report an **architecture gap**. Do not hardcode around it.

## External capability boundaries

- Atlas is a flight adapter, not the architecture.
- Nuitée/liteAPI, Google Routes, Frankfurter, Model Studio and future providers are adapters/capabilities, not domain owners by default.
- Mocks are allowed only at external provider/action boundaries.
- Internal ingestion, mutation, propagation, planning, viability, authority, observation and lifecycle logic stay real.
- LIVE / RECORD / REPLAY should share normalisation/downstream paths where practical.
- Record/replay external boundary inputs/results, not precomputed internal assessments/cases/UI outcomes.
- A new provider, GDS/TMC system, advisory source, entry-data source or weather source must enter through the approved ownership/information/capability boundaries rather than force scenario logic into the engine.

## Agent routing

Follow `docs/AGENT_MODEL_SELECTION.md` and `docs/IMPLEMENTATION_AGENT_ROUTING.md`. Load `docs/MODELS_ARSENAL.md` only when the routing decision itself needs deeper/updated evidence.

There is no single default implementation harness. Route in this order:

`role -> harness capability -> task shape/risk -> independence -> effort`.

Important current observations:

- The frozen architecture means much remaining work is bounded product integration, not fresh architecture design.
- Cursor/Codex/Claude Code are preferred for time-sensitive local write/run/fix loops.
- Qwen3.8-Flash and GLM-5.3-Flash are legitimate defined-task implementers, not merely cheap subagents.
- Qoder remains useful for Qwen/Kimi/GLM work; harness latency is a harness constraint, not a model-quality judgement.
- Astra is a model, not a harness, and belongs in Complex/Critical architecture/investigation rather than Normal implementation.
- Sol/Opus/Astra-class use is escalation for concrete ambiguity/risk, not a tax on every milestone.
- Model choice stays separate from the execution prompt.

For long-horizon work, use `docs/work/ACTIVE_TASK.md` as working memory. Re-read it before major phases, after compaction/delegation and before completion; close checklist items only with evidence.

## Verification is cumulative evidence

Follow `docs/TESTING.md` plus the relevant acceptance criteria in `docs/IMPLEMENTATION_PLAN.md`.

- **Implementation:** focused relevant unit/integration test -> focused PG seam test -> typecheck/build/lint only when relevant.
- **Integration:** seam/conflict/new-interaction checks; reuse valid lane evidence.
- **Review:** inspect existing evidence first; execute more only for concrete uncertainty.
- **Coherent slice checkpoint:** run the appropriate broader PostgreSQL gate.
- **Final candidate/cutover:** run the full canonical CURRENT target gate once, on a fresh database.

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

Historical SQLite runtime failures are never a release blocker and are not current product correctness. Do not run `test:legacy` during normal implementation and do not repair what it reports unless explicitly assigned historical/migration investigation.

## Issue and scope discipline

Every discovered issue/risk must be classified:

- Act Now
- Investigate Now
- Park for Later
- Ignore / Accept Risk

Every intentionally excluded capability remains visible in `docs/ROADMAP.md` with reason/revisit condition. Never silently drop scope.


## Foundational refactor parity gate

For foundational migration/cutover work only, every pre-existing product capability must map:

`OLD CAPABILITY -> NEW HOME -> PRESERVE | ADAPT | SUPERSEDED | RETIRE -> BEHAVIOURAL PROOF`.

`RETIRE` requires an explicit product decision. `SUPERSEDED` requires behavioural proof,
not merely a replacement class/module. A foundational milestone cannot silently retire a
working product capability because its previous implementation was legacy-bound. Ordinary
small refactors do not need this bureaucracy.

## Git and worktrees

- Verify actual branch/head before implementation/integration.
- New product work branches from the current authoritative `main` unless an explicit integration plan says otherwise.
- Parallel lanes must not share uncommitted state or a shared mutable test database.
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
