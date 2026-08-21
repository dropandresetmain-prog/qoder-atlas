# Agent Model Selection

Source-of-truth guidance for choosing the Qoder surface, model, reasoning level, and escalation path for the Atlas × Alibaba Cloud Hackathon implementation.

**Qoder is the default implementation harness.** Model choice is a routing decision, not a prestige ladder. Choose the combination most likely to complete the assigned role with low rework while preserving scope discipline.

Availability, Credit rates, reasoning controls, and Qoder behavior can change. Qoder's current model selector or `/model` output is authoritative for current availability.

Last routing review: **2026-08-22**.

## 1. Core principles

1. **Choose the execution surface first.** Stability, repository access, worktree isolation, terminal behavior, and provider credentials matter as much as model quality.
2. **Choose the role before the model.** Planner, Implementer, Integrator, Investigator, and Reviewer have different needs.
3. **Qwen-first for implementation.** Qwen3.8-Max and Qwen3.7-Max are the normal substantial implementation choices for this project.
4. **Repository evidence outranks benchmarks.** Instruction following, hardcoding tendency, test quality, scope discipline, and human steering required matter more than headline scores.
5. **Model choice stays separate from the execution prompt.** The prompt describes the work package and contracts; routing can change without rewriting the task.
6. **Escalate because evidence warrants it.** Do not route every difficult-looking task to a more expensive model pre-emptively.
7. **Delegate bounded work economically.** Primary agents retain architecture, shared-contract decisions, integration, high-risk changes, and final verification.
8. **Verification is determined by the change, not model prestige.**
9. **Prefer another model family for consequential independent review.**
10. **No model gets permission to hardcode the demo.** If the ontology cannot express a requirement, report an architecture gap.

## 2. Project-specific Qwen policy

### Qwen3.8-Max — primary implementation model

Use Qwen3.8-Max for most substantial coding work.

Recommended effort:
- **Medium:** bounded work packages with frozen contracts;
- **xHigh:** long-horizon lanes, multi-file changes, integration, or architecture-sensitive execution.

Observed project risk:
- it has sometimes needed more handholding than desired;
- it can solve locally with hardcoded/special-case logic when boundaries are vague.

Mitigate procedurally rather than avoiding the model:
- exact work-package ID and objective;
- owned and do-not-touch paths;
- frozen contracts;
- explicit anti-hardcoding instruction;
- require architecture-gap escalation instead of local schema forks;
- scenario substitution/generalisation tests;
- deterministic acceptance evidence;
- checkpoint-autonomy and hard-stop rules.

Escalate away from Qwen3.8-Max only when repository evidence shows it is blocking progress: repeated contract violations, repeated hardcoding after correction, inability to debug a difficult deterministic/provider seam, or excessive human steering.

### Qwen3.7-Max — main long-horizon alternative

Treat Qwen3.7-Max as a genuine alternative for substantial autonomous work, not merely a fallback. It is particularly attractive for:
- well-specified long-horizon packages;
- scheduled/off-peak work;
- independent implementation attempts where a second Qwen generation is useful;
- situations where current pricing is materially better.

Use the same anti-hardcoding, contract-freeze, and architecture-gap rules as Qwen3.8-Max.

### Qwen3.7-Plus — bounded workhorse

Use for crisp, easily verified work:
- tests and fixtures;
- straightforward parsers/adapters;
- documentation;
- simple UI components;
- repetitive schema/code changes after semantics freeze;
- delegated subtasks.

Do not give it unresolved cross-system architecture.

## 3. Escalation / specialist models

### GLM-5.3

GLM-5.3 is an **escalation specialist**, not the default owner of every core task.

Use it when:
- Qwen has demonstrably stalled or repeatedly violated contracts;
- state/viability debugging has several interacting hypotheses;
- provider/runtime behavior is difficult to diagnose;
- deterministic validation logic is failing in non-obvious ways;
- cross-lane integration needs a materially different reasoning profile;
- terminal-heavy investigation benefits from its engineering behavior.

Recommended effort:
- **High:** normal escalation;
- **Max:** genuinely difficult multi-hypothesis integration/debugging.

Do not route ordinary implementation to GLM merely because the package is important.

### Kimi-K2.7-Code

Optional focused coding specialist for clearly specified implementation, tests, adapters, refactors, and isolated UI/backend features.

### Kimi-K3

Use when unusually broad repository context or sustained long-context reasoning is genuinely useful. Do not route to K3 merely because a task is large or important.

### DeepSeek-V4-Pro / Flash

Use Pro for difficult independent reasoning/review/debugging and Flash for cheaper bounded second opinions. Different-family review can be more valuable than stronger self-review.

## 4. Orchestration roles

### Planner / Architect

Owns ontology, shared contracts, decomposition, dependencies, lane boundaries, collision analysis, and architecture gaps.

Strong defaults:
- **GPT-5.6 Sol High** externally for primary architecture/decomposition;
- **Qwen3.8-Max xHigh** when architecture/contract work should happen directly inside Qoder;
- **Qwen3.7-Max** as a long-horizon Qoder alternative;
- **GLM-5.3 High/Max** only when Qwen exposes a concrete repository-level architecture/debugging problem;
- Claude Opus High as an independent architecture challenger where useful.

### Prompter / Task Decomposer

Turns an approved work package from `docs/IMPLEMENTATION_PLAN.md` into an execution prompt. It does not redesign the plan.

Prompt must include:
- exact branch/worktree/head;
- work-package ID and objective;
- authoritative files;
- relevant `FR-*` / `NFR-*` requirements;
- owned/do-not-touch paths;
- frozen contracts;
- acceptance criteria and scoped `T-*` verification;
- checkpoint-autonomy instruction and hard-stop rules for long-horizon work;
- environment-recovery rule;
- explicit exclusions;
- delegation guidance;
- completion-report format.

Good defaults: GPT-5.6 Sol normal reasoning, Qwen3.8-Max Medium, or Qwen3.7-Plus for straightforward prompt conversion.

### Implementer

Qoder is default.

Preferred order:
1. **Qwen3.8-Max** — default substantial implementation / long-horizon lane owner;
2. **Qwen3.7-Max** — substantial long-horizon alternative;
3. **Qwen3.7-Plus** — bounded delegated work;
4. Kimi-K2.7-Code — focused implementation alternative;
5. **GLM-5.3** — escalation for difficult deterministic/provider/debugging work;
6. Kimi-K3 — broad-context specialist.

The implementer verifies worktree/head, executes the approved plan without re-planning the product, surfaces architecture gaps, and remains accountable for scoped verification even when delegating.

### Investigator / Debugger

Use for a bounded question, not speculative refactoring.

Examples:
- provider payload fails normalization;
- LIVE and REPLAY diverge;
- a state transition is wrong;
- propagation behaves unexpectedly;
- external credential/runtime issue;
- contract mismatch;
- repeated terminal/tool failure after the environment-recovery rule.

Start with Qwen3.8-Max xHigh where practical. Escalate to GLM-5.3 High/Max or DeepSeek-V4-Pro when a materially different reasoning profile is useful.

Output: evidence + root cause + proposed fix/decision.

### Integrator

Owns lane ancestry/heads, merge/conflict resolution, cross-lane seams, capability→planner→viability→authority wiring, UI/backend read models, Record/Replay equivalence, and end-to-end scenario evidence.

Strong defaults:
- **Qwen3.8-Max xHigh** first;
- **Qwen3.7-Max** as long-horizon alternative;
- **GLM-5.3 High/Max** if Qwen stalls, repeatedly violates contracts, or a hard deterministic/provider seam needs a different profile;
- Kimi-K3 High only when repository breadth warrants it.

Use Sol/Opus when integration exposes a genuine cross-cutting architecture decision, not as routine ceremony.

### Reviewer

Independent review is deliberate risk control, not a ritual after every package.

Prefer a different family from the main integrator, e.g. DeepSeek-V4-Pro High/Max, external GPT-5.6 Sol High, Claude Opus High, or GLM-5.3 Max if GLM did not implement the area.

High-value review targets:
- state mutation;
- deterministic viability;
- authority/irreversible-action gates;
- persistence;
- provider execution boundaries;
- LIVE/RECORD/REPLAY consistency;
- policy enforcement;
- AI schema boundaries;
- demo-specific hardcoding.

## 5. Current model routing snapshot

Current rates/availability may change; `/model` is authoritative.

| Model | Typical project role |
|---|---|
| Qwen3.8-Max | Default substantial implementation; long-horizon lanes; integration |
| Qwen3.7-Max | Main long-horizon/cost-efficient alternative; scheduled substantial work |
| Qwen3.7-Plus | Tests, fixtures, docs, simple adapters, bounded delegation |
| GLM-5.3 | Escalation for hard debugging, deterministic/provider failures, difficult integration |
| Kimi-K2.7-Code | Focused implementation alternative |
| Kimi-K3 | Broad long-context specialist |
| DeepSeek-V4-Pro | Independent hard reasoning/review/debugging |
| DeepSeek-V4-Flash | Cheap bounded second opinion/review |

Approximate previously observed Qoder rates are routing context only: Qwen3.8-Max ~0.5x with lower off-peak pricing, Qwen3.7-Max often heavily discounted, Qwen3.7-Plus ~0.1x, GLM-5.3 ~0.6x. Confirm before any pricing-sensitive decision.

For Bangkok, the previously published Qwen3.8 off-peak window has corresponded roughly to **21:00–07:00**. Use discounted autonomous work opportunistically; never delay critical work just for price.

## 6. Qoder execution interfaces and long-horizon strategy

### JetBrains + Qoder Agent Mode

Use **JetBrains Agent Mode as the primary long-horizon execution surface when it is the most stable local interface**. It is suitable for Foundation F0–F3, one complete sequential lane, and integration.

Do not assume the JetBrains plugin provides native parallel orchestration unless the installed version explicitly exposes it.

For parallel lanes, use **Git worktrees as the isolation primitive** and open each worktree in a separate JetBrains window with its own Agent Mode session. This gives parallel execution without depending on plugin-native multi-agent support.

### Quest / Qoder IDE

Quest Worktree execution is a strong native option for isolated medium/large tasks. Qoder documents Worktree environments specifically for parallel tasks in one repository. A generated Quest Spec remains subordinate to `docs/IMPLEMENTATION_PLAN.md`.

### Qoder CLI

Qoder CLI supports:
- `--worktree` isolated sessions;
- multiple parallel sessions;
- background tasks and Subagents;
- persistent `/goal` autonomous execution;
- beta Agent Teams.

These are useful for scheduled/background/parallel work when stable. Because CLI has shown shell/permission instability for this project, **do not make it the sole critical-path orchestrator**.

If CLI environment problems recur, keep the same branch/worktree and switch to JetBrains Agent Mode rather than rewriting code or spending prolonged time repairing the CLI.

### Long-horizon autonomy

A long-horizon prompt should explicitly say:
- continue autonomously until the assigned formal checkpoint;
- make ordinary implementation decisions within frozen contracts without asking the user;
- stop only for the hard-stop conditions in `docs/IMPLEMENTATION_PLAN.md`;
- follow `.qoder/rules/environment-recovery.md` for transient terminal/tool failures;
- commit coherent checkpoints and update the execution tracker;
- continue independent work when an optional provider/investigation is blocked.

Use one worktree per meaningful lane, not per tiny subtask. Do not schedule unresolved architecture.

## 7. Qoder tiers / Experts

Named routing is preferred when practical because it is reproducible and helps us learn repository-specific performance.

- **Performance:** acceptable for normal substantial implementation when direct named routing is inconvenient.
- **Ultimate:** reserve for genuinely difficult cross-cutting architecture/debugging/review where extra orchestration adds value.
- **Experts / Agent Teams:** use when multi-agent synthesis itself is useful, not for routine implementation.

## 8. Runtime Alibaba Model Studio models

Runtime Model Studio selection is separate from the Qoder coding-agent choice.

For extraction/planner plumbing:
1. start with a cheap available model;
2. validate schema/tool plumbing;
3. use saved/replayed outputs in routine tests;
4. upgrade model quality only when the integrated vertical loop proves quality is materially blocking the product.

Do not burn implementation time solving non-critical model-quality/external-provider issues before the core loop works.

## 9. Delegation policy

Primary agents may delegate tasks with crisp inputs/outputs and cheap verification: fixtures, isolated tests, repetitive schemas after semantics freeze, bounded parsers, isolated UI components, documentation, and narrow investigations.

Primary agent retains architecture/shared-contract decisions, integration, high-risk state changes, resolution of conflicting subagent outputs, scoped verification, and the completion report.

## 10. Model evaluation

Judge routing by verified repository outcomes:
- first-pass correctness;
- hardcoding/scope discipline;
- meaningful tests;
- review-fix severity;
- human steering required;
- wall-clock completion;
- Credit usage where relevant.

Update this document when repository evidence materially changes the recommendation.
