# AGENTS.md

## Mission

Build the Atlas × Alibaba Cloud hackathon product described in the repository source-of-truth documents without demo-specific hardcoding.

The hackathon product face is **Northstar** — the AI resolution layer for event
travel — on top of a generalized trip-resolution engine. Public framing:
`README.md`. Capability scope: `docs/ROADMAP.md`. Active product-closure runway:
`docs/FINAL_DEMO_INTEGRATION_PLAN.md` (subordinate to `docs/IMPLEMENTATION_PLAN.md`).

The normal orchestration lifecycle is:

`Planner / Architect -> Prompter -> Implementer -> Integrator -> Reviewer when warranted -> Final Candidate`

Not every work package or checkpoint requires an independent Reviewer. Review is a risk-control step, not a ritual.

## Read before broad work

Inspect current repository state before changing code. Read the relevant sections of:

1. `docs/PRODUCT_SPEC.md`
2. `docs/ARCHITECTURE.md`
3. `docs/IMPLEMENTATION_PLAN.md` — parent execution SSOT
4. `docs/ROADMAP.md` — capability scope/status SSOT (read **Current cadence** first)
5. `docs/FINAL_DEMO_INTEGRATION_PLAN.md` — when working on product-closure / demo UI
6. `docs/DECISIONS.md`
7. `docs/TESTING.md`
8. `docs/AGENT_MODEL_SELECTION.md`
9. `.qoder/rules/environment-recovery.md` when terminal/tool execution is involved
10. task-specific Qoder Spec

For Atlas capability questions, consult the authoritative research in `dropandresetmain-prog/atlas-hackathon-lab`; do not guess.

## Orchestration roles

### Planner / Architect
Owns architecture, shared contracts, decomposition, dependencies, lane boundaries, collision analysis, and acceptance criteria.

- Inspect current repo/docs before planning.
- Prefer safe parallelism after shared contracts are frozen.
- Specify dependencies, overlapping paths, integration order, and merge risks.
- Do not force parallelism across unresolved architecture or heavily overlapping files.
- Produce plans later agents can execute without re-planning the product.

### Prompter
Turns an approved work package from `docs/IMPLEMENTATION_PLAN.md` into an execution prompt.

Include:
- exact branch/worktree/head;
- work-package ID and objective;
- authoritative files;
- owned/do-not-touch paths;
- frozen contracts;
- acceptance criteria;
- scoped verification;
- explicit exclusions;
- bounded delegation guidance;
- expected completion report.

Do not redesign approved architecture unless a concrete contradiction is found.

### Implementer
Owns one assigned lane/work package.

- Verify branch, worktree, head, and authoritative files before editing.
- Execute the approved plan; do not silently reopen architecture.
- Keep changes in scope and owned paths.
- Surface material discoveries/architecture gaps instead of expanding scope.
- Delegate bounded, independently verifiable tasks where useful.
- Keep architecture, integration decisions, high-risk work, and final lane verification with the primary agent.
- Run the narrowest tests/checks proving the changed behavior and relevant failure paths.
- Do not run the full repository gate merely because a package is complete.

### Integrator
Combines completed lane work and owns cross-lane seams.

- Verify lane heads, ancestry, reports, and intended merge order.
- Resolve overlapping-file conflicts deliberately.
- Reuse valid lane evidence.
- Test newly created seams/conflict resolutions rather than rerunning every historical check.
- Own application/orchestration wiring and shared-contract mismatch resolution.
- Do not let a lane "fix" integration by introducing local contract variants.

### Reviewer
Used deliberately for final candidate review, material architecture change, or genuinely high-risk work.

- Prefer a different model family from the main implementer/integrator.
- Reuse existing evidence unless a concrete review question needs more execution.
- Classify every finding exactly: `Act Now`, `Investigate Now`, `Park for Later`, or `Ignore / Accept Risk`.
- For fixes, require targeted evidence that the finding is closed; do not restart a full review cycle automatically.

## Checkpoint autonomy

The user should normally be needed only at the formal checkpoints defined in `docs/IMPLEMENTATION_PLAN.md`. Between checkpoints, continue autonomously.

Do not ask the user for routine choices about libraries, file layout, test naming, styling, bounded bug fixes, or other decisions already constrained by the approved architecture. Make the best bounded choice and continue.

Stop early only for a documented hard-stop condition: material shared-contract/product change, genuine architecture gap, unapproved irreversible action, required new credential/manual account action, destructive operation outside the approved workflow, critical-path provider blocker with no fallback, unresolved environment failure after the recovery protocol, or a material product choice not resolved by the docs.

If one task is blocked, triage it and continue independent work where possible instead of waiting.

## Architectural invariants

- The trip/state graph is central. Chat is an interface, not source of truth.
- One generalized recovery engine supports TMC, corporate/event, group, and future traveller use cases.
- AI may interpret, extract, map, identify uncertainty, infer soft preferences, judge semantic consequences, and propose recovery strategies.
- Deterministic code owns schema/business validation, graph mutation, arithmetic, timezone/time-window checks, buffers, dependency propagation, policy thresholds, permissions, state transitions, scenario viability, and execution validation.
- Never allow `LLM -> irreversible/money-moving API`.
- Required flow: `AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`.
- Prefer deterministic mapping for structured provider data.
- Candidate recovery options live in scenario overlays until observed execution updates authoritative state.
- `UNKNOWN` is valid; do not convert missing/stale evidence into certainty.
- Explicit instructions outrank latent preferences. Latent preferences remain soft signals.

## Anti-hardcoding

Never add scenario-specific branches, fixture IDs, traveller/event names, locations, routes, or supplier-specific conditions to domain/recovery logic.

Provider-specific logic belongs only in the concrete adapter.

Demo facts belong in fixtures/configuration/sources. At least two materially different scenarios must run through the same application code without changes.

If the approved ontology/contracts cannot express a requirement, stop and report an **architecture gap**. Do not hardcode around it.

Qwen3.8-Max has shown a project-specific tendency toward local/hardcoded solutions; when it is used, enforce these rules explicitly and verify with the anti-hardcoding gate.

## External capability boundaries

- Atlas is a flight adapter, not the architecture.
- Mocks are allowed only at external provider/action boundaries.
- Internal ingestion, mutation, impact propagation, planning, viability, authority, observation, and state transitions remain real.
- Use LIVE / RECORD / REPLAY where practical. LIVE and REPLAY share normalization/downstream paths.
- Booking.com, Google Routes, Gmail, Timatic, Atlas Singapore fixtures, and other optional services must not become core dependencies unless `ROADMAP.md` explicitly changes status.
- Do not spend prolonged implementation time solving optional provider/model activation issues.

## Persistence

Use SQLite behind repository interfaces unless deployment/runtime evidence proves it unsuitable.

Do not introduce Neo4j, microservices, Kafka, Kubernetes, or similar infrastructure without a demonstrated requirement.

## Qoder workflow and model routing

Follow `docs/AGENT_MODEL_SELECTION.md`.

- Qoder is the default implementation harness.
- Qwen3.8-Max / Qwen3.7-Max are the normal implementation defaults; GLM-5.3 is an escalation for difficult debugging/integration rather than the default for every hard-looking task.
- Use Spec-driven Quest for substantial work packages.
- Check generated Specs against `docs/IMPLEMENTATION_PLAN.md` before Build.
- Freeze shared contracts before parallel implementation.
- Use separate worktrees/Quests for independent lanes, not every small task.
- Stay in the same chat for sequential work in one lane while context remains useful.
- Use a fresh chat for a separate lane, integrator, independent review, or materially different investigation.
- Model choice is separate from the execution prompt.
- Delegate bounded work to cheaper/specialist subagents when useful.
- Runtime Model Studio plumbing should start with a cheap model; upgrade only when quality is proven blocking.
- JetBrains Agent Mode is the preferred stable long-horizon surface when available. For parallel lanes, isolate with Git worktrees and use separate IDE windows/sessions unless Quest provides stable native Worktree execution.
- CLI parallel sessions/`--worktree`/`/goal`/Subagents are useful but optional; do not make a known-buggy CLI the sole critical path.

## Environment and terminal recovery

Follow `.qoder/rules/environment-recovery.md`. A terminal/tool problem is not evidence that application code is wrong.

- In JetBrains, if an otherwise valid command suddenly fails/hangs because the terminal session is stale, reset/reopen the terminal once and retry before changing code.
- On CLI `permission denied`, inspect command/file permissions and invocation first. Prefer `bash path/to/script.sh` or the package-manager command when execution permission is unnecessary; use `chmod +x` only when the repository intentionally requires the executable bit.
- Do not automatically use `--yolo` or weaken permission controls to get unstuck.
- Do not rewrite source code to accommodate a broken shell, stale working directory, or permission wrapper.
- After bounded recovery attempts, switch surface (CLI -> JetBrains or vice versa) if practical. If the environment still blocks critical work, record evidence and stop/triage instead of looping indefinitely.

## Verification is cumulative evidence

Follow `docs/TESTING.md`.

- **Implementation:** narrow tests/checks for changed behavior and relevant failures.
- **Integration:** seam/conflict/new-interaction tests; reuse valid lane evidence.
- **Review:** inspect existing evidence first; execute more only for concrete uncertainties.
- **Final candidate:** canonical broad gate on the exact candidate SHA.

Never claim a check passed unless it actually ran successfully. Do not use paid/live provider calls in routine verification unless explicitly needed and authorized.

## Issue and scope discipline

Every discovered issue/risk must be classified:
- Act Now
- Investigate Now
- Park for Later
- Ignore / Accept Risk

Do not merely summarize issues; decide what happens to each.

Every intentionally excluded capability remains explicitly in `docs/ROADMAP.md` under Stretch/Deferred/Rejected with reason and revisit condition. Never silently drop scope.

## Git and worktrees

Branches/worktrees are orchestration boundaries.

- Verify actual branch/head before implementation/integration.
- Parallel lanes must not share uncommitted local state.
- Use narrow exact-path staging; do not default to `git add .` / `git add -A`.
- Commit coherent, testable checkpoints.
- Before claiming pushed/integrated state, verify actual branch/commit/remote.

## Completion report / handoff

After an implementation package, report only material evidence:

1. **In simple terms:** what now works and what intentionally did not change.
2. Branch/worktree and exact head.
3. Work-package ID(s).
4. Files changed.
5. Behavior changed.
6. Tests/checks actually run and results.
7. Failure/fallback behavior verified.
8. Unexpected findings/risks and triage.
9. Documentation updated.
10. Commit SHA/state.
11. Exact next dependent package/integration action.

Do not pad the report by repeating the implementation plan.

## Source-of-truth roles

- verified runtime/code/tests = implemented reality;
- `docs/PRODUCT_SPEC.md` = product requirements;
- `docs/ARCHITECTURE.md` = logical architecture/invariants;
- `docs/IMPLEMENTATION_PLAN.md` = single active execution plan and work-package status;
- `docs/ROADMAP.md` = capability scope/status, including Stretch/Deferred;
- `docs/DECISIONS.md` = settled architecture decisions;
- `docs/TESTING.md` = verification taxonomy;
- `docs/AGENT_MODEL_SELECTION.md` = routing guidance.

If code and an approved contract disagree, treat it as drift or an architecture gap to resolve; do not silently assume either side wins. When implementation intentionally changes an approved contract, update the relevant SSOT docs in the same integrated change.
