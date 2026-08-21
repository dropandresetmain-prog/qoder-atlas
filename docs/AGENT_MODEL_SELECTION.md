# Agent Model Selection

Source-of-truth guidance for choosing the Qoder surface, model, reasoning level, and escalation path for the Atlas × Alibaba Cloud Hackathon implementation.

**Qoder is the default implementation harness.** Model choice is a routing decision, not a prestige ladder. Choose the cheapest model that is likely to complete and verify the assigned role with low rework; pay more only when the task benefits from a stronger or materially different reasoning profile.

Availability, Credit rates, reasoning controls, promotions, context windows, and model behaviour change. Qoder's current model selector or `/model` output is authoritative for current availability and live pricing.

Last routing review: **2026-08-22**.

## 1. Core principles

1. **Choose the execution surface first.** Stability, repository access, worktree isolation, terminal behaviour, and provider credentials matter as much as raw model capability.
2. **Choose the role before the model.** Planner, Implementer, Integrator, Investigator, and Reviewer have different needs.
3. **Price is part of model quality for routing.** The relevant question is not "what is strongest?" but "what is the cheapest model likely to do this correctly with acceptable rework?"
4. **Qwen-first for normal Qoder implementation.** Qwen3.8-Max is the default substantial implementation model; Qwen3.7-Max is the first long-horizon/value experiment, especially off-peak.
5. **Do not infer a fixed prestige hierarchy from vendor names.** Kimi-K3 and GLM-5.3 are serious frontier-adjacent engineering models; DeepSeek-V4-Pro is strong but should not be treated as a current Opus/Sol peer merely because it is called Pro.
6. **Repository evidence outranks benchmarks.** Instruction following, hardcoding tendency, test quality, scope discipline, human steering, wall-clock completion, and review-fix severity matter more than headline evals.
7. **Model choice stays separate from the execution prompt.** The prompt describes the work package and contracts; routing can change without rewriting the task.
8. **Escalate because evidence warrants it.** Do not mechanically climb an expensive-model ladder.
9. **Delegate bounded work economically.** Primary agents retain architecture, shared-contract decisions, integration, high-risk changes, and final verification.
10. **Verification is determined by the change, not model prestige.**
11. **Prefer another model family for consequential independent review, but independence alone does not justify a 0.8x model.** Use a cheaper different-family reviewer first when it is sufficient.
12. **No model gets permission to hardcode the demo.** If the ontology cannot express a requirement, report an architecture gap.

## 2. Practical capability map

The table below is a **rough engineering-role map**, not a claim that reasoning-level names are equivalent across vendors. `High`, `xHigh`, `Max`, and similar labels are provider-specific.

| Capability band | Models / settings | Practical mental model |
|---|---|---|
| Ceiling / principal | Claude Opus 5 High/Max, GPT-5.6 Sol High/Max | unresolved architecture, root-cause discovery, high-risk cross-system reasoning |
| Near-ceiling / staff+ | Grok 4.6 High/xHigh, GPT-5.6 Terra High/Max | broad autonomous engineering, difficult integrations, strong generalist execution |
| Strong frontier daily-driver / staff-senior | Claude Sonnet 5 High, Kimi-K3 High/Max, GLM-5.3 High/Max, GPT-5.6 Luna High/Max | sustained engineering; Kimi biases toward endurance/context, GLM toward hard debugging/terminal work |
| Strong senior / default serious coding | Qwen3.8-Max xHigh, DeepSeek-V4-Pro Max | substantial multi-file work; DeepSeek is more specialist/adversarial than default daily-driver for us |
| Focused implementation senior/mid | Cursor Composer 2.5, Kimi-K2.7-Code, Qwen3.7-Max | clear-feature implementation, write/run/fix loops, bounded autonomous work |
| Cheap bounded execution / review | DeepSeek-V4-Flash, Qwen3.7-Plus, MiniMax-M3 | tests, fixtures, bounded review, transformations, repetitive or well-specified implementation |

### Important interpretation

- **Opus 5 / Sol** remain the preferred external architecture and high-risk review ceiling.
- **Kimi-K3** has enough current software-engineering evidence to treat it as a real long-horizon specialist, not a novelty model.
- **GLM-5.3** has materially stronger current engineering/debugging evidence than GLM-5.2 and deserves specialist status.
- **Qwen3.8-Max** is not assumed to be the absolute smartest Qoder model; its advantage is that it is strong enough to own serious work at excellent current Qoder pricing.
- **DeepSeek-V4-Pro** is strong, but current evidence is better interpreted as a powerful reasoning/agent specialist than as a current Opus 5/Sol peer. At Qoder's nominal 0.8x multiplier, it requires a specific reason.
- **Kimi-K2.7-Code** and **DeepSeek-V4-Flash** are particularly useful because they provide different-family review/implementation without jumping to the 0.8x tier.

## 3. Current Qoder cost map

These are routing inputs, not budgets. Confirm live values in `/model` before a pricing-sensitive run.

| Model | Approx. normal Qoder multiplier | Current/off-peak routing note |
|---|---:|---|
| Qwen3.8-Max | ~0.5x | ~0.25x in published 22:00–08:00 SGT off-peak window |
| Qwen3.7-Max | ~0.5x list | ~0.1x published off-peak; regular promotional rate has changed over time, confirm live |
| Qwen3.7-Plus | ~0.1x | ~0.04x published off-peak |
| MiniMax-M3 | ~0.2x | experimental low-cost option |
| Kimi-K2.7-Code | ~0.3x | focused coding / different-family review |
| DeepSeek-V4-Flash | ~0.3x nominal | dynamic peak/valley pricing may apply |
| GLM-5.3 | ~0.6x | specialist premium |
| Kimi-K3 | ~0.8x | long-horizon/context specialist premium |
| DeepSeek-V4-Pro | ~0.8x nominal | dynamic peak/valley pricing may apply; premium-only by default |

For Bangkok, the published Qwen3.8 off-peak window corresponds roughly to **21:00–07:00**.

### Relative cost intuition during Qwen off-peak

If Qwen3.8-Max is 0.25x:
- Qwen3.7-Max at 0.1x is ~2.5x cheaper;
- Qwen3.7-Plus at 0.04x is ~6.25x cheaper;
- GLM-5.3 at 0.6x is ~2.4x more expensive;
- Kimi-K3 / DeepSeek-V4-Pro at 0.8x are ~3.2x more expensive.

Therefore an expensive model must buy a real capability advantage, not just model-family novelty.

## 4. Qoder model guidance

### Qwen3.8-Max — default serious implementation

Use for most substantial coding work.

Good fits:
- normal feature implementation;
- multi-file backend work;
- state-engine implementation;
- provider adapters;
- frontend work;
- refactors;
- integration;
- iterative write/run/fix loops;
- architecture-sensitive execution where the shared contract is already frozen.

Recommended effort:
- **Medium:** bounded work package with frozen contracts;
- **xHigh:** difficult cross-module work, integration, long-horizon lane, or hard debugging where Qwen remains the best-value first attempt.

Current project risk:
- Qwen can solve locally with hardcoded/special-case logic when boundaries are vague;
- it can require more handholding than desired on difficult architecture-sensitive work.

Mitigate procedurally:
- exact work-package ID/objective;
- owned and do-not-touch paths;
- frozen contracts;
- explicit anti-hardcoding rule;
- architecture-gap escalation instead of local schema forks;
- scenario-substitution/generalisation tests;
- deterministic acceptance evidence;
- checkpoint-autonomy and hard-stop rules.

### Qwen3.7-Max — first long-horizon/value experiment

Treat Qwen3.7-Max as a genuine autonomous engineering option rather than simply an older fallback.

Use for:
- well-specified long-horizon packages;
- overnight/off-peak autonomous work;
- large but reversible implementation with objective acceptance tests;
- cases where 3.8 capability is not clearly necessary.

Why it matters: at the published ~0.1x off-peak multiplier it can be dramatically cheaper than the specialist models, which makes longer autonomous runs economically sensible.

Do not assume it is better than Qwen3.8. Measure end-to-end rework.

### Qwen3.7-Plus — bounded execution workhorse

Use for crisp, easily verified work:
- tests and fixtures;
- straightforward parsers/adapters;
- documentation;
- simple UI components;
- repetitive schema/code changes after semantics freeze;
- codebase summaries;
- delegated subtasks.

Do not give it unresolved cross-system architecture.

### Kimi-K2.7-Code — focused coding and cheap independent family

Use for:
- clearly specified feature implementation;
- tests;
- adapters;
- refactors;
- isolated UI/backend features;
- routine different-family review of Qwen output.

Think of it as a focused coding-agent role closer to Cursor Composer than to Kimi-K3.

### DeepSeek-V4-Flash — cheap independent challenger

Use for:
- routine static review;
- targeted second opinions;
- bounded debugging;
- test-quality review;
- challenging Qwen/Kimi assumptions cheaply.

Prefer Flash or Kimi-K2.7-Code before Pro when the task is simply "review this implementation."

### MiniMax-M3 — experimental low-cost lane

Use only for low-risk, easily checked work until repository evidence accumulates:
- codebase exploration;
- test generation;
- routine review;
- bounded implementation.

Do not make it critical-path owner before we have project-specific evidence.

### GLM-5.3 — hard engineering/debugging specialist

GLM-5.3 is a first-class specialist, not merely "Qwen failed, try random model."

Use when:
- state/viability debugging has several interacting hypotheses;
- deterministic validation logic fails in non-obvious ways;
- provider/runtime behaviour is difficult to diagnose;
- cross-lane integration exposes a difficult seam;
- terminal-heavy work benefits from a more aggressive engineering profile;
- Qwen has already made one or two unproductive attempts.

Recommended effort:
- **High:** difficult engineering/investigation;
- **Max:** genuinely difficult multi-hypothesis debugging/integration.

At ~0.6x, GLM should earn its premium through reduced rework.

### GLM-5.2 — normally ignore

Prefer GLM-5.3 for new work at the same approximate Qoder multiplier unless project evidence reveals a reproducible 5.2 advantage.

### Kimi-K3 — long-horizon / large-context specialist

Kimi-K3 is the most interesting premium Qoder model for this hackathon because long-horizon coding is itself an explicit experiment.

Use for:
- long autonomous milestones;
- broad repository investigation;
- large cross-module changes with stable contracts;
- work where context retention/endurance is the suspected bottleneck;
- a controlled comparison against Qwen3.7-Max / Qwen3.8-Max.

Do not use it merely because a task is important. At ~0.8x, we should be testing a hypothesis: **does K3's endurance/context reduce enough rework to justify the multiplier?**

### DeepSeek-V4-Pro — premium adversarial reasoning specialist

Do **not** use V4 Pro as the default reviewer.

Use when:
- a difficult logical disagreement remains after a cheaper different-family review;
- several hypotheses need adversarial reasoning;
- a high-risk deterministic/authority decision merits another strong lineage;
- routine models repeatedly miss the same problem;
- we deliberately want a DeepSeek Pro benchmark.

At ~0.8x nominal Qoder pricing, different-family independence alone is not enough justification.

## 5. External model guidance

External models augment rather than replace Qoder. The bulk of implementation/integration should remain Qoder-based.

### GPT-5.6 Sol

Primary external architecture/reasoning model.

Use for:
- ontology/shared architecture;
- milestone decomposition;
- cross-lane integration decisions;
- high-risk independent review;
- difficult root-cause escalation;
- resolving architecture gaps.

### Claude Opus 5

Use as an alternative ceiling model for:
- unresolved high-impact architecture;
- high-risk independent review;
- repeated failure by normal primary models;
- subtle cross-system reasoning where conservative verification matters.

### GPT-5.6 Terra / Claude Sonnet 5

Strong external peer options for substantial implementation, investigation, or independent review when another harness/model family provides a concrete advantage.

### GPT-5.6 Luna

Useful for bounded delegated work and efficient implementation. Do not make it the default architecture owner.

### Cursor Grok 4.6

Legitimate frontier long-running implementation/investigation option. Use when Cursor's harness or a strong different-family autonomous run is specifically useful.

### Cursor Composer 2.5

Fast hands-on implementation model. Particularly useful for interactive UI polish and tight write/run/fix loops. Keep the main build Qoder-heavy.

## 6. Orchestration roles

### Planner / Architect

Owns ontology, shared contracts, decomposition, dependencies, lane boundaries, collision analysis, and architecture gaps.

Strong defaults:
- **GPT-5.6 Sol High** externally for primary architecture/decomposition;
- **Claude Opus 5 High** as an independent ceiling challenger where useful;
- **Qwen3.8-Max xHigh** when architecture-sensitive execution should happen directly inside Qoder;
- **GLM-5.3 High/Max** only when the architecture question is tightly coupled to a difficult runtime/debugging seam.

### Prompter / Task Decomposer

Turns an approved work package from `docs/IMPLEMENTATION_PLAN.md` into an execution prompt. It does not redesign the plan.

Good defaults:
- GPT-5.6 Sol normal reasoning;
- Qwen3.8-Max Medium;
- Qwen3.7-Plus for straightforward prompt conversion.

### Implementer

Qoder is default.

Routing order by task, not prestige:
1. **Qwen3.8-Max** — default substantial implementation;
2. **Qwen3.7-Max** — first long-horizon/value alternative, especially off-peak;
3. **Qwen3.7-Plus** — bounded delegated work;
4. **Kimi-K2.7-Code** — focused coding/different-family implementation;
5. **GLM-5.3** — hard engineering/debugging specialist;
6. **Kimi-K3** — premium long-horizon/context experiment;
7. **DeepSeek-V4-Pro** — premium specialist only with an explicit reason.

### Investigator / Debugger

Start with **Qwen3.8-Max xHigh** when practical because it is often the best value.

Escalate based on failure type:
- difficult deterministic/runtime/terminal seam -> **GLM-5.3 High/Max**;
- broad context/endurance problem -> **Kimi-K3 High/Max**;
- adversarial alternative reasoning -> **DeepSeek-V4-Pro High/Max** only if cheaper alternatives are insufficient;
- architecture/root-cause uncertainty -> **Sol High / Opus High** externally.

Output must be evidence + root cause + proposed fix/decision, not speculative refactoring.

### Integrator

Strong defaults:
- **Qwen3.8-Max xHigh** first;
- **GLM-5.3 High/Max** for difficult deterministic/provider seams;
- **Kimi-K3 High/Max** when repository breadth/endurance is actually the bottleneck;
- **Qwen3.7-Max** for long autonomous integration work where its price/performance is sufficient.

Use Sol/Opus when integration exposes a genuine cross-cutting architecture decision.

### Reviewer

Independent review is deliberate risk control, not a ritual after every package.

**Routine different-family review of Qwen work:**
- Kimi-K2.7-Code;
- DeepSeek-V4-Flash;
- MiniMax-M3 experimentally.

**Difficult implementation/integration review:**
- GLM-5.3 High/Max if GLM did not implement the area;
- Kimi-K3 High/Max if broad context is the issue;
- external Sol High / Opus High for consequential review.

**DeepSeek-V4-Pro:** reserve for a concrete hard/adversarial reasoning need. Do not select it merely because the reviewer should be a different family.

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

## 7. Long-horizon model experiment

We explicitly want repository evidence, not only public benchmarks.

Run controlled substantial work packages with objective acceptance criteria and record:
- completion without intervention;
- tests/checks passed;
- architecture drift/hardcoding;
- reviewer findings;
- human steering required;
- wall-clock completion;
- Credits consumed;
- final rework.

Recommended sequence:
1. **Qwen3.7-Max off-peak** — first value/endurance baseline;
2. **Qwen3.8-Max xHigh** — stronger Qwen comparison;
3. **Kimi-K3 High/Max** — premium endurance/context comparison after the Qwen baselines;
4. **GLM-5.3** only when the work shape is debugging/integration-heavy enough to test its specialist hypothesis.

Do not compare models on materially different or unmeasurable tasks and call it a benchmark.

## 8. Qoder execution interfaces and long-horizon strategy

### JetBrains + Qoder Agent Mode

Use JetBrains Agent Mode as the primary interactive/stable execution surface on the user's Windows 11 ARM64 machine.

For parallel lanes, use **Git worktrees as the isolation primitive** and open each worktree in a separate JetBrains window with its own Agent Mode session.

### Qoder CLI

Qoder CLI is the preferred experimental surface for persistent `/goal`, `--worktree`, parallel sessions, background/subagent work, and beta Agent Teams **when it is stable on the local environment**.

Windows ARM64 support/stability must be treated as an environment constraint. If the CLI repeatedly fails for shell/permission reasons, preserve the same branch/worktree and switch to JetBrains Agent Mode rather than rewriting code or spending critical-path time repairing tooling.

### Long-horizon autonomy

A long-horizon prompt should explicitly say:
- continue autonomously until the assigned formal checkpoint;
- make ordinary implementation decisions within frozen contracts without asking the user;
- stop only for the hard-stop conditions in `docs/IMPLEMENTATION_PLAN.md`;
- follow `.qoder/rules/environment-recovery.md` for transient terminal/tool failures;
- commit coherent checkpoints and update the execution tracker;
- continue independent work when an optional provider/investigation is blocked.

Use one worktree per meaningful lane, not per tiny subtask. Do not schedule unresolved architecture.

## 9. Qoder tiers / Experts

Named routing is preferred when practical because it is reproducible and lets us build repository-specific evidence.

- **Performance/Auto:** acceptable when direct named routing is inconvenient, but less useful for controlled model comparison.
- **Ultimate:** reserve for genuinely difficult cross-cutting work where extra orchestration adds value.
- **Experts / Agent Teams:** use when multi-agent synthesis itself is useful, not for routine implementation.

## 10. Runtime Alibaba Model Studio models

Runtime Model Studio selection is separate from the Qoder coding-agent choice.

For extraction/planner plumbing:
1. start with a cheap available model;
2. validate schema/tool plumbing;
3. use saved/replayed outputs in routine tests;
4. upgrade model quality only when the integrated vertical loop proves quality is materially blocking the product.

Do not burn implementation time solving non-critical model-quality/external-provider issues before the core loop works.

## 11. Delegation policy

Primary agents may delegate tasks with crisp inputs/outputs and cheap verification: fixtures, isolated tests, repetitive schemas after semantics freeze, bounded parsers, isolated UI components, documentation, and narrow investigations.

Primary agent retains architecture/shared-contract decisions, integration, high-risk state changes, resolution of conflicting subagent outputs, scoped verification, and the completion report.

## 12. Model evaluation

Judge routing by verified repository outcomes:
- first-pass correctness;
- hardcoding/scope discipline;
- meaningful tests;
- review-fix severity;
- human steering required;
- wall-clock completion;
- Credit usage;
- successful completion per unit of human attention.

A more expensive model is worthwhile when it materially reduces rework or solves a problem cheaper models cannot. A cheaper model that completes a milestone cleanly is the better model even if a premium model has higher benchmarks.

Update this document when repository evidence materially changes the recommendation.

## 13. Current operating recommendation

For the current hackathon build:

1. **Architecture:** GPT-5.6 Sol; Opus 5 for an independent ceiling challenge when needed.
2. **Default Qoder implementation:** Qwen3.8-Max.
3. **First long-horizon/value experiment:** Qwen3.7-Max off-peak.
4. **Bounded delegated work:** Qwen3.7-Plus.
5. **Focused different-family coding/review:** Kimi-K2.7-Code or DeepSeek-V4-Flash.
6. **Hard deterministic/provider/debugging work:** GLM-5.3.
7. **Premium long-horizon/context experiment:** Kimi-K3.
8. **DeepSeek-V4-Pro:** premium adversarial specialist only; never the automatic reviewer.
9. **Final consequential review:** prefer external Sol/Opus or, if Qoder-only, the strongest suitable different-family specialist justified by the actual risk.
10. **Use off-peak pricing opportunistically, but never delay critical-path work purely to save Credits.**

## 14. Source refresh checklist

When updating this document, check:
- Qoder model selector / `/model` output;
- Qoder Model Selector and CLI model documentation;
- current Qwen off-peak campaign documentation;
- Qoder long-horizon/Goal/Agent Teams documentation;
- first-party model release notes;
- recent independent coding/agentic benchmarks where useful;
- this repository's own implementation and review history.
