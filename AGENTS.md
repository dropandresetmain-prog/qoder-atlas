# AGENTS.md

## Mission

Build Northstar as a generalized travel-resolution product without scenario-specific hardcoding or false capability claims.

The graph/state model is central. Chat, dashboards and traveller surfaces are interfaces over authoritative state; they are not the source of truth.

The normal orchestration lifecycle is:

`Planner / Architect -> Prompter -> Implementer -> Integrator -> Reviewer when warranted -> Promotion / Activation`

Review is a risk-control step, not a ritual.

## Current project state

The data/state refactor through M10/C5 is complete and accepted. Post-C5 repository convergence is also complete.

**PostgreSQL is the sole normal Northstar runtime.** SQLite is retired as an application runtime and exists only as explicit offline, read-only migration input or historical test/code archaeology. It is not a fallback runtime, alternate runtime, demo runtime or current product authority.

The current delivery sequence is:

`finish Slice A -> integrated Slice A review -> Founder Test A -> Slice B / Sarah full recovery -> major recovery-loop review -> Founder Test B -> Jordan through the same engine -> focused generalisation review -> Astra planning-only reconciliation -> post-E2E observability + accepted Overview implementation -> final hardening / M11 -> final release review`

Current Slice A status: T1 is founder-accepted; T2 is the active disruption/reprotection increment; T3 is incident-scoped assessment-to-case orchestration; T4 is the minimal authoritative Case View using the accepted V5.6 focused-graph visual language. Do not reopen broad architecture unless implementation exposes a concrete requirement the frozen ontology cannot express.

## Source-of-truth order

Before broad implementation, inspect the actual branch/head and read the relevant parts of:

1. `docs/DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md` — frozen F01-F18 architecture decisions, ownership/cardinality/lifecycle semantics.
2. `docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md` — approved persistence and transaction model.
3. `docs/ARCHITECTURE.md` — concise **current** architecture map after C5/convergence.
4. `docs/CAPABILITIES_AND_LIMITATIONS.md` — implemented reality and current limitations.
5. `docs/ROADMAP.md` — milestone status, current delivery sequence and intentionally deferred scope.
6. `docs/IMPLEMENTATION_PLAN.md` — historical M0-M11 execution decomposition plus the authoritative post-C5 delivery sequence in Section 22. Where old pre-C5 sequencing language conflicts with Section 22/current status docs, Section 22/current status wins.
7. `docs/TESTING.md` — canonical suite classification and focused-test-first verification rules.
8. `docs/work/ACTIVE_TASK.md` — current working-memory ledger for the active delivery slice.
9. `docs/AGENT_MODEL_SELECTION.md` — operational model/harness routing policy.
10. `docs/MODELS_ARSENAL.md` — deeper, more volatile model/harness evidence; load only when routing genuinely needs reevaluation.
11. `docs/IMPLEMENTATION_AGENT_ROUTING.md` — alternative model+harness routes for historical milestones and current post-C5 delivery stages/reviews.
12. `docs/ENVIRONMENT.md` and `.qoder/rules/environment-recovery.md` when environment/provider execution is involved.

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

Current planned independent reviews are intentionally sparse: T2 targeted review/re-review, one integrated Slice A review after T3+T4, one major Slice B recovery-loop review, one Jordan/generalisation review, and one final release review. Do not add routine model-review ceremonies after every milestone.

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

The current critical path protects a working demo floor before adding richer product surfaces.

### Slice A — change becomes a real case

- **T1:** accepted full AiT PostgreSQL baseline.
- **T2:** truthful provider-shaped disruption/reprotection -> canonical mutation -> invalidation -> reassessment. Critical partial-failure/idempotency semantics must pass the targeted independent review before merge.
- **T3:** incident-scoped current failure -> exactly one RecoveryCase with normal subject/signal attachment.
- **T4:** minimal authoritative Case View + accepted V5.6 focused graph. Keep the current Overview functional; do not add observability timeline scope here.

After T4, run one integrated Slice A review, then Founder Test A. Do not require Slice B before testing Slice A.

### Slice B — Sarah case becomes truthfully recovered

Slice B remains **one product milestone**. Engineering checkpoints may separately prove target capability composition/LIVE smoke, target-native Qwen proposal, deterministic viability, authority, execution and observation/reassessment, but those checkpoints are not separate roadmap milestones or automatic review events.

End state:

`real RecoveryCase -> schema-bound AI proposal -> deterministic counterfactual viability -> persisted strategy/action basis -> authority/approval -> ordered action -> observation/state update -> reassessment -> same Sarah trip/Journey viable -> truthful case resolution`

Run one major independent recovery-loop review only after the full chain converges, then Founder Test B.

### Jordan — prove generality

After Sarah works end to end, run Jordan through the same engine/application code. Add provider-heavy Atlas/search/execution/reconciliation seams only where the scenario genuinely requires them. Run one focused generalisation review after convergence.

### Astra reconciliation — planning only

After Sarah/Jordan expose the real remaining backend/product requirements, use one Astra planning pass to reconcile those requirements into the implementation plan through 30 September. Astra is not the default implementer; normal coding agents execute the resulting plan.

### Post-E2E product milestones

- **Observability:** one semantic operational history feeding Case timeline, Activity journal and compressed Overview feed. Northstar/provider/human actions, determinations, observations and outcomes are first-class; this must project authoritative state/events rather than create a second state machine.
- **Event Overview:** design work continues in parallel, but production implementation is design-gated and post-E2E. Keep the current Overview until the accepted direction is ready.
- **Whole-event graph / semantic zoom:** still stretch unless accepted Overview work proves it should become the same visual at another semantic zoom level.

Nothing in observability/Overview/polish may destabilize the latest protected Sarah/Jordan demo floor.

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

Follow `docs/AGENT_MODEL_SELECTION.md`, `docs/MODELS_ARSENAL.md` when deeper roster evidence is needed, and `docs/IMPLEMENTATION_AGENT_ROUTING.md` for the current three-option stage/review routes.

There is no single default implementation harness. Route in this order:

`role -> harness capability -> task shape/risk -> independence -> effort`.

Important current observations:

- The frozen architecture means much remaining work is bounded product integration, not fresh architecture design.
- Cursor/Codex/Claude Code are preferred for time-sensitive local write/run/fix loops.
- Qwen3.8-Flash and GLM-5.3-Flash are legitimate defined-task implementers, not merely cheap subagents.
- Qoder remains useful for Qwen/Kimi/GLM work; harness latency is a harness constraint, not a model-quality judgement.
- Astra is a model, not a harness, and belongs in Complex/Critical architecture/investigation/planning rather than Normal implementation.
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
| `npm test` | boundary gate + current Northstar surface (no DB, no browser) | yes |
| `npm run test:postgres` | current PostgreSQL integration gate | yes |
| `npm run test:migration` | M10 migration boundary, where SQLite is read-only input | yes |
| `npm run test:legacy` | retired SQLite runtime — **NON-GATING / HISTORICAL / MANUAL ONLY** | no |

`npm run gate:test-boundary` walks the real import graph and fails if a current test reaches the retired SQLite runtime, `node:sqlite` or `src/migration/**`, or if any test file is unclassified.

Historical SQLite runtime failures are never a release blocker and are not current product correctness. Do not run `test:legacy` during normal implementation and do not repair what it reports unless explicitly assigned historical/migration investigation.
