# AGENTS.md

## Mission

Build Northstar as a generalized travel-resolution product without scenario-specific hardcoding or false capability claims.

The graph/state model is central. Chat, dashboards and traveller surfaces are interfaces over authoritative state; they are not the source of truth.

The normal orchestration lifecycle is:

`Planner / Architect -> Prompter -> Implementer -> Integrator -> Reviewer when warranted -> Promotion / Activation`

Review is a risk-control step, not a ritual.

## Current project state

The data/state refactor through M10/C5 is complete and accepted. Post-C5 repository convergence is complete. T1 — the full AiT PostgreSQL baseline — is founder-accepted.

**PostgreSQL is the sole normal Northstar runtime.** SQLite is retired as an application runtime and exists only as explicit offline, read-only migration input or historical test/code archaeology. It is not a fallback runtime, alternate runtime, demo runtime or current product authority.

The current delivery sequence is:

`T2 acceptance -> T3 -> T4 Case+V5.6 -> Slice A integrated review -> Founder Test A -> Slice B Sarah E2E -> Slice B review -> Founder Test B -> Jordan same-engine E2E -> generalisation review -> Astra planning reconciliation -> post-E2E product milestones -> M11/final candidate`

T2 is currently being repaired after an independent review found real crash/retry and M6 semantic defects. Do not treat the unmerged T2 branch as accepted runtime truth.

Do not reopen broad architecture unless implementation exposes a concrete requirement the frozen ontology cannot express.

## Source-of-truth order

Before broad implementation, inspect the actual branch/head and read the relevant parts of:

1. `docs/DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md` — frozen F01-F18 architecture decisions, ownership/cardinality/lifecycle semantics.
2. `docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md` — approved persistence and transaction model.
3. `docs/ARCHITECTURE.md` — concise **current** architecture map after C5/convergence.
4. `docs/CAPABILITIES_AND_LIMITATIONS.md` — implemented reality and current limitations.
5. `docs/ROADMAP.md` — milestone status, current delivery sequence and intentionally deferred scope.
6. `docs/IMPLEMENTATION_PLAN.md` — authoritative current post-C5 delivery plan in Section 22.
7. `docs/IMPLEMENTATION_PLAN_HISTORY.md` — preserved historical M0-M11 decomposition and prior post-C5 plan. Historical reference only.
8. `docs/TESTING.md` — canonical suite classification and focused-test-first verification rules.
9. `docs/work/ACTIVE_TASK.md` — current working-memory ledger for the active delivery slice.
10. `docs/AGENT_MODEL_SELECTION.md` — operational model/harness routing policy.
11. `docs/MODELS_ARSENAL.md` — deeper, more volatile model/harness evidence; load only when routing genuinely needs reevaluation.
12. `docs/IMPLEMENTATION_AGENT_ROUTING.md` — current alternative model+harness routes for implementation and review checkpoints.
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

Current planned independent-review boundaries are deliberately sparse:

1. **T2 targeted re-review** — only because the first review proved Critical defects; recheck the fix delta.
2. **Slice A integrated review** — once T3 + T4 converge; no separate T3 and T4 reviewers by default.
3. **Slice B major review** — after the complete Sarah recovery loop; no reviewer after every internal Slice B checkpoint.
4. **Jordan generalisation review** — focused same-engine/anti-hardcoding/shared-world proof, not a new architecture review.
5. **Final candidate review** — exact candidate + deployment/demo/M11 truthfulness evidence.

Observability and Event Overview milestones do not automatically get premium reviewers. Use founder product/visual testing unless implementation exposes a concrete high-risk seam.

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

M11 is the final **operational activation / retirement** step: external legacy-source inventory if relevant, final authority/sole-writer verification, reconciliation/provenance closure and retirement of any remaining old operational access. Do not reactivate SQLite as rollback.

## Product delivery discipline

### T2 — finish disruption truth first

The active T2 lane owns truthful cancellation/reprotection, crash/retry safety, canonical identity/provenance, deterministic reassessment and authoritative polling. It **stops before automatic RecoveryCase creation**.

After targeted fixes, the same independent reviewer rechecks the fix delta; then run Founder T2 and merge only if accepted.

### T3 — case orchestration

Take the accepted T2 incident/assessments and idempotently create exactly one incident-scoped RecoveryCase. Add real command/application seams for case subjects/signals. Do not sweep unrelated baseline failures into the case. No Qwen/provider recovery yet.

### T4 — minimal authoritative Case + V5.6

Render the real case and quantitative failure reason from authoritative state. Integrate the accepted V5.6 focused graph here. Do not add observability timeline/final Overview/whole-event graph to T4.

### Slice A checkpoint

After T3+T4 converge, run **one integrated Slice A review**, close findings, then Founder Test A. Preserve the working current Overview + Case V5.6 path as the first protected demo floor.

### Slice B — Sarah Case -> recovered

Slice B is one product milestone. Internal sequencing may include:

`target capability composition -> harmless LIVE Qwen/Atlas smoke -> target-native Qwen proposal/research -> deterministic viability -> strategy/ActionPlan -> authority/approval -> programme execution -> observation -> reassessment -> resolution`

Do not treat those as separate roadmap milestones. Do not port the retired `RuntimeOrchestrator`, old planner contract or old executor wholesale.

After the complete Sarah recovery exists, run **one major independent review**, close targeted findings, then Founder Test B.

### Jordan — same engine

Only after Sarah E2E, run Jordan through the same application/domain code. Atlas Search/Verify becomes materially useful here. Settle `external:offer.select` semantics and provider observation -> canonical-state reconciliation before consequential external execution. Add hotel/ground/FX only where the actual scenario needs them.

Then run one focused generalisation review. No fresh architecture review unless the ontology truly fails to express the scenario.

### Astra reconciliation — planning only

After Sarah + Jordan E2E, use one Astra planning pass to reconcile all remaining backend/product/demo requirements through 30 Sep. Astra does not need to implement the plan. Normal implementation agents execute bounded work from the reconciled plan.

### Post-E2E observability and Overview

Observability is its own milestone after the vertical loop works. Build one semantic operational-history projection over authoritative records and project it as:

- richest timeline below the Case graph;
- broader Activity journal;
- compressed event-scoped feed below the Overview visualisation.

It must include meaningful provider/external events, Northstar actions, determinations, human decisions, observations and outcomes — not merely raw audit rows and not private model chain-of-thought.

The Event Overview visual direction may be designed/prototyped in parallel, but the **current Overview remains the protected functional UI through Slice A, Slice B and Jordan**. Production implementation follows accepted design + protected E2Es unless it is demonstrably presentation-only with no new backend contract.

Whole-event graph/semantic zoom/multiple simultaneous focuses remain Stretch.

## Anti-hardcoding

Never add scenario-specific branches, fixture IDs, traveller/event names, cities, routes, suppliers or demo dates to domain/recovery logic.

Provider-specific mapping belongs in concrete adapters. Demo facts belong in data/configuration/sources.

At least two materially different scenarios must use the same application code. Refactor acceptance additionally covers family/group, corporate/agency, programme, entry/advisory and unprecedented-data extension cases in AT01-AT24.

If the approved ontology/contracts cannot express a requirement, report an **architecture gap**. Do not hardcode around it.

## External capability boundaries

- Atlas is a flight adapter, not the architecture.
- Nuitée/liteAPI, Google Routes, Frankfurter, Model Studio and future providers are adapters/capabilities, not domain owners by default.
- The current PostgreSQL target application does not yet compose the full live provider/intelligence stack; Slice B owns that composition.
- Reuse provider transports/adapters where correct; do not resurrect retired SQLite composition/planner/executor wholesale.
- Mocks are allowed only at external provider/action boundaries.
- Internal ingestion, mutation, propagation, planning, viability, authority, observation and lifecycle logic stay real.
- LIVE / RECORD / REPLAY should share normalisation/downstream paths where practical.
- Final demo is LIVE-first; REPLAY is emergency fallback and must never be presented as LIVE.
- Record/replay external boundary inputs/results, not precomputed internal assessments/cases/UI outcomes.
- A new provider/source must enter through approved ownership/information/capability boundaries rather than force scenario logic into the engine.

## Agent routing

Follow `docs/AGENT_MODEL_SELECTION.md` and the current post-C5 routes in `docs/IMPLEMENTATION_AGENT_ROUTING.md`. Load `docs/MODELS_ARSENAL.md` only when the routing decision itself needs deeper/updated evidence.

There is no single default implementation harness. Route in this order:

`role -> harness capability -> task shape/risk -> independence -> effort`.

Important current observations:

- Cursor/Codex/Claude Code are preferred for time-sensitive local write/run/fix loops.
- Qwen3.8-Flash and GLM-5.3-Flash are legitimate defined-task implementers, not merely cheap subagents.
- Qoder remains useful for Qwen/Kimi/GLM work; harness latency is a harness constraint, not a model-quality judgement.
- Astra is a model, not a harness. Use it for Complex/Critical architecture/investigation/planning, not Normal implementation.
- The planned Astra post-E2E pass is **planning only**.
- Sol/Opus/Astra-class use is escalation for concrete ambiguity/risk, not a tax on every milestone.
- Model choice stays separate from the execution prompt.

Three model+harness routes listed in the implementation/routing docs are **alternatives**. Choose one; do not run all three.

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

Historical SQLite runtime failures are never a release blocker. Do not run `test:legacy` during normal implementation and do not repair what it reports unless explicitly assigned historical/migration investigation.

## Issue and scope discipline

Every discovered issue/risk must be classified:

- Act Now
- Investigate Now
- Park for Later
- Ignore / Accept Risk

Every intentionally excluded capability remains visible in `docs/ROADMAP.md` with reason/revisit condition. Never silently drop scope.

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
