# Agent Model Selection

Source-of-truth guidance for choosing an AI agent surface, model, and reasoning level for the Atlas × Alibaba Cloud Hackathon project.

This is not a prestige ladder and it is not a Credit-minimisation policy. Choose the surface/model combination most likely to complete and verify the assigned role with the best mix of capability, reliability, speed, independence, and available project context.

**Qoder is the primary implementation environment for this project.** External models from ChatGPT, Anthropic, and Cursor should augment Qoder where they provide stronger architecture judgement, independent review, specialist capabilities, or useful implementation diversity.

Public benchmarks are useful routing evidence, not ground truth. Current repository performance, observed rework, instruction following, test quality, scope discipline, and successful end-to-end completion should progressively outrank benchmark claims.

Availability, Credit rates, promotions, context limits, reasoning controls, model behaviour, and Qoder routing may change server-side. Check Qoder's current model selector or `/model` output when a decision materially depends on availability or pricing.

Last routing review: **2026-08-22**.

## Core principles

1. **Qoder is the default execution harness.** Most implementation, testing, debugging, integration, refactoring, and repository work should happen in Qoder unless another harness has a concrete advantage.
2. **Choose the role before the model.** Planner, implementer, investigator, integrator, and reviewer have different requirements. Do not route everything to whichever model currently looks strongest on a benchmark.
3. **Use capability before cost, but do not waste Credits.** This project has sufficient Qoder Credits to choose stronger models when they improve expected outcomes. Cheap models remain useful for bounded work, not because Credit conservation is a primary objective.
4. **Use premium models for a reason, not ceremony.** A more expensive model should provide better reasoning, longer-horizon execution, a useful independent model family, or demonstrated lower rework for the specific task.
5. **Keep model choice separate from implementation prompts.** State the recommended harness, model, and reasoning level separately. Execution prompts should remain portable.
6. **Delegate bounded work where useful.** Primary agents may delegate clear, independently verifiable tasks to cheaper or specialist subagents while retaining architecture, shared contracts, integration decisions, high-risk changes, and final verification.
7. **Prefer different model families for important reviews.** Independent review is most useful when it reduces correlated blind spots rather than asking the same model family to approve its own assumptions.
8. **Verification requirements do not decrease with model strength.** Frontier models still need tests, builds, typechecks, linting, diff review, runtime evidence, and provider verification where applicable.
9. **Judge models by verified rework.** Track whether a model actually completes milestones correctly, stays within scope, writes meaningful tests, understands architecture, and requires little repair.
10. **Do not repeatedly reopen solved architecture.** Implementation agents work from approved contracts and architecture. If execution exposes a genuine architecture gap, report it rather than improvising a demo-specific workaround.

## Project-specific orchestration roles

### Planner / Architect

Owns:

- ontology and domain contracts;
- graph/state architecture;
- agentic vs deterministic boundaries;
- provider-neutral interfaces;
- milestone decomposition;
- acceptance criteria;
- dependency ordering;
- identification of parallel implementation lanes;
- high-risk architectural decisions;
- decisions that affect multiple lanes.

Strong defaults:

- **GPT-5.6 Sol High** for primary architecture and decomposition;
- **Claude Opus 5 High** as an alternative or independent architecture challenger;
- **Qwen3.8-Max xHigh** when planning should happen directly inside the Qoder repository context;
- **GLM-5.3 High/Max** when architecture is closely tied to implementation/runtime investigation.

Do not consume frontier models merely to convert an already-approved plan into an implementation prompt.

### Prompter / Task Decomposer

Converts an approved milestone into an execution prompt containing:

- authoritative files;
- objective;
- scope;
- explicit exclusions;
- contracts that must not change;
- acceptance criteria;
- required tests;
- dependency assumptions;
- parallelisation boundaries;
- subagent guidance;
- expected completion report.

Good defaults:

- ChatGPT / GPT-5.6 Sol at normal reasoning;
- Qwen3.8-Max Medium;
- Qwen3.7-Plus for straightforward prompt conversion.

The Prompter does not redesign approved architecture unless it discovers an explicit contradiction.

### Implementer

Qoder is the default environment.

Primary implementation pool:

- **Qwen3.8-Max**
- **GLM-5.3**
- **Kimi-K3**
- **Kimi-K2.7-Code**
- **Qwen3.7-Plus**

External implementation models such as Sonnet 5, Opus 5, GPT-5.6 Terra/Luna/Sol, Cursor Composer 2.5, or Grok 4.6 can be used when there is a concrete advantage, but the bulk of implementation and integration should remain in Qoder.

### Investigator / Debugger

Owns bounded questions such as:

- why a provider response fails validation;
- why a state transition is incorrect;
- why tests diverge between LIVE and REPLAY;
- why an Atlas request fails;
- identifying a dependency or contract violation;
- tracing unexpected graph propagation;
- runtime or environment failures.

Strong defaults:

- **GLM-5.3 High/Max**
- **Qwen3.8-Max xHigh**
- **DeepSeek-V4-Pro High/Max**
- GPT-5.6 Sol High for difficult independent investigation.

Investigation should result in evidence and a proposed fix, not speculative refactoring.

### Integrator

Owns:

- combining parallel lanes;
- resolving contract mismatches;
- merge/conflict resolution;
- validating state propagation across modules;
- UI/backend seam verification;
- LIVE/RECORD/REPLAY equivalence;
- provider adapter integration;
- end-to-end scenario validation;
- final acceptance tests.

Strong defaults:

- **Qwen3.8-Max xHigh**
- **GLM-5.3 High/Max**
- **Kimi-K3 High/Max** when unusually broad repository context is useful;
- GPT-5.6 Sol or Opus 5 when integration exposes a cross-cutting architecture question.

The Integrator should not rerun every historical test blindly. Verify changed seams plus required project-wide gates.

### Reviewer

Prefer a different model family from the implementer for consequential work.

Routine review:

- Qwen3.8-Max
- GLM-5.3
- DeepSeek-V4-Flash
- GPT-5.6 Terra
- Sonnet 5
- Grok 4.6

Major integration/architecture review:

- GPT-5.6 Sol High
- Claude Opus 5 High
- GLM-5.3 Max
- DeepSeek-V4-Pro Max

High-risk review should explicitly inspect:

- irreversible action gates;
- permissions/authority logic;
- state mutation;
- provider execution boundaries;
- persistence;
- LIVE/RECORD/REPLAY consistency;
- policy enforcement;
- deterministic viability;
- demo-specific hardcoding.

# Qoder model guidance

Current published Qoder Credit multipliers are routing context, not quotas.

| Model | Standard Credit rate | Current role |
|---|---:|---|
| Qwen3.8-Max | 0.5× | Primary Qoder generalist |
| Qwen3.7-Max | 0.5× standard | Secondary long-horizon Qwen option |
| Qwen3.7-Plus | 0.1× | Fast bounded work / delegation |
| GLM-5.3 | 0.6× | Hard engineering, debugging, integration |
| GLM-5.2 | 0.6× | Legacy fallback; generally prefer 5.3 |
| Kimi-K3 | 0.8× | Long-context / long-horizon specialist |
| Kimi-K2.7-Code | 0.3× | Focused implementation workhorse |
| DeepSeek-V4-Pro | 0.8× | Hard reasoning / independent investigation |
| DeepSeek-V4-Flash | 0.3× | Fast alternative / routine review |
| MiniMax-M3 | 0.2× | Experimental bounded work |

Qoder may change the server-side model list. The model selector and `/model` output are authoritative for current availability and parameters.

## Qwen3.8-Max — default Qoder primary

**Default Qoder model for substantial implementation unless another model has a specific advantage.**

Current Qoder capabilities include reasoning, vision, configurable thinking effort, and large context options up to 1M.

Use for:

- normal feature implementation;
- multi-file backend work;
- frontend work;
- API adapters;
- state-engine implementation;
- schema-driven functionality;
- substantial refactors;
- normal integration;
- test implementation;
- implementation planning inside the repository;
- iterative write/run/fix loops.

Recommended effort:

- **Medium:** bounded implementation with settled contracts;
- **xHigh:** complex cross-module implementation, difficult integration, architecture-sensitive execution, or hard debugging.

Do not automatically escalate every substantial task to xHigh. Use it when deeper reasoning is materially useful.

### Current pricing

Standard Qoder rate: **0.5×**.

Current Qwen3.8-Max off-peak promotion:

- 08:00–22:00 Singapore time: **0.5×**
- 22:00–08:00 Singapore time: **0.25×**

For Bangkok this corresponds to approximately:

- 07:00–21:00: standard rate;
- 21:00–07:00: off-peak rate.

The promotion began 2026-08-03 and currently has no announced end date.

Treat the discount as an opportunity to schedule suitable autonomous work, not as a reason to delay interactive work.

The old Qwen3.8-Max-Preview 0.01× promotion has ended and must not be used for planning.

## Qwen3.7-Max — secondary Qwen long-horizon option

Qwen3.7-Max remains a capable agentic model but should not be the default over Qwen3.8-Max unless project evidence shows it performs better for a particular task.

Use for:

- alternative implementation attempts;
- long autonomous jobs;
- independent Qwen-family comparison;
- work benefiting from its aggressive current discounts.

Current published promotion:

- standard listed rate: **0.5×**
- regular-hour promotional rate: **0.25×**
- off-peak rate: **0.1×**

Because Qwen3.8-Max is newer, prefer 3.8 for capability-driven routing unless 3.7 has a demonstrated project advantage.

## Qwen3.7-Plus — bounded workhorse

Very inexpensive relative to the primary models but should not be treated as inferior by default for well-specified work.

Use for:

- test generation;
- fixtures;
- straightforward adapters;
- schema transformations;
- documentation;
- repetitive code changes;
- simple UI components;
- targeted refactors;
- codebase summaries;
- delegated subagent tasks;
- implementation after the architecture/root cause is already settled.

Current standard rate: **0.1×**.

Current published off-peak rate: **0.04×**.

Use it because the task is bounded and verifiable, not merely to save Credits.

Do not give it unresolved cross-system architecture and expect it to infer the entire product design.

## GLM-5.3 — hard engineering and debugging specialist

Treat GLM-5.3 as a first-class primary engineering model, not simply a fallback after Qwen.

Good fits:

- difficult debugging;
- terminal-heavy investigation;
- multi-file backend implementation;
- complex state transitions;
- provider adapters;
- deterministic validation logic;
- integration failures;
- security-oriented reasoning;
- code review;
- sustained software-engineering tasks.

Recommended effort:

- **High:** normal difficult engineering;
- **Max:** hard integration/debugging where multiple hypotheses or contracts interact.

Current Qoder rate: **0.6×**.

### GLM-5.2

Same current published Qoder rate as GLM-5.3.

Prefer GLM-5.3 for new work unless:

- 5.3 exhibits a project-specific regression;
- reproducibility requires 5.2;
- we deliberately benchmark both.

Do not route work to 5.2 merely because it is familiar.

## Kimi-K3 — long-context / long-horizon specialist

Kimi-K3 is useful when repository breadth and sustained autonomous reasoning are more important than latency or Credit efficiency.

Good fits:

- repository-wide investigation;
- large cross-module implementation;
- extended autonomous Quest tasks;
- architecture reconciliation across many files;
- broad integration analysis;
- large documentation + code context;
- long-running refactors with stable acceptance criteria.

Current Qoder capabilities include context options up to 1M and configurable reasoning effort.

Recommended effort:

- **High:** broad implementation/investigation;
- **Max:** unusually large or long-horizon tasks.

Current Qoder rate: **0.8×**.

Do not use K3 solely because the task is "important." Prefer it when long context or long-horizon behaviour is actually useful.

## Kimi-K2.7-Code — focused coding workhorse

Good middle-ground coding model for clearly specified implementation.

Use for:

- isolated backend features;
- adapters;
- tests;
- frontend implementation;
- refactors;
- code transformations;
- clearly scoped multi-file changes.

Current Qoder rate: **0.3×**.

Current Qoder interface exposes Fast mode rather than the same thinking-effort controls as some other models.

Prefer K2.7-Code over K3 when the problem is primarily implementation rather than broad repository reasoning.

## DeepSeek-V4-Pro — independent reasoning specialist

Use primarily when a different reasoning profile is desirable.

Good fits:

- difficult independent code review;
- adversarial review;
- debugging with competing hypotheses;
- complex algorithmic logic;
- deterministic engine inspection;
- checking whether another model's assumptions are wrong;
- difficult implementation where DeepSeek's project performance proves strong.

Recommended effort:

- **High:** difficult investigation/review;
- **Max:** genuinely hard reasoning.

Current Qoder rate: **0.8×**.

Do not use DeepSeek-V4-Pro merely as the automatic next rung after another model fails. Give it a defined role or question.

## DeepSeek-V4-Flash — cheap independent lane

Useful for:

- routine code review;
- bounded alternative solutions;
- targeted debugging;
- small independent verification tasks;
- inexpensive second opinions.

Current Qoder rate: **0.3×**.

A cheap different-family reviewer can be more useful than asking the primary implementer to review itself.

# Qoder tiers and Experts mode

Qoder also exposes automatic tiers such as Auto, Ultimate, Performance, Efficient, and Lite.

Do **not** make Auto or Ultimate the default for this project while named-model routing is practical.

Reasons:

- named models provide more reproducible routing;
- we want to learn which models actually perform well on this repository;
- model-family independence matters for review;
- Experts mode may coordinate multiple agents and increase Credit usage;
- explicit routing makes handoffs and post-mortems easier.

Use Auto/Ultimate or Experts mode when **multi-agent synthesis itself is useful**, not because choosing a model feels inconvenient.

Potential uses:

- independent architecture brainstorming after contracts stall;
- multi-hypothesis investigation;
- broad repository review;
- difficult bugs where parallel expert hypotheses are valuable.

Do not use Experts mode for routine implementation that one strong model can complete.

# Qoder Quest and scheduled execution

Qoder Quest supports scheduled tasks and autonomous Goal/Spec execution.

Use scheduled execution opportunistically for work that is:

- well specified;
- safe to run without interactive steering;
- independently testable;
- reversible;
- suitable for overnight execution.

Good scheduled tasks:

- implement an isolated milestone with frozen contracts;
- expand tests;
- perform a bounded refactor;
- audit a module;
- run code-quality cleanup;
- update documentation after implementation;
- review a completed lane;
- execute long-running test or validation work.

Avoid scheduling unresolved architecture or work likely to require rapid human decisions.

Where convenient, schedule Qwen discounted work in the relevant off-peak window. Do not delay critical-path development purely for lower Credit rates.

# External model guidance

External models augment rather than replace Qoder.

## GPT-5.6 Sol

Primary external architecture/reasoning model.

Use for:

- architecture;
- decomposition;
- cross-lane integration decisions;
- high-risk review;
- difficult debugging escalation;
- project-level roadmap decisions;
- independent review of Qoder output.

Sol should generally remain outside routine implementation when Qoder can execute effectively.

## GPT-5.6 Terra

Strong general implementation/review alternative.

Use for:

- independent review;
- implementation diversity;
- debugging;
- cross-checking Qoder work;
- complex but reversible implementation when another harness is useful.

## GPT-5.6 Luna

Use for:

- bounded delegated work;
- tests;
- transformations;
- straightforward implementation.

Not a default architecture owner.

## Claude Sonnet 5

Strong alternative implementation and reasoning model.

Good fits:

- substantial feature implementation;
- sustained cross-contract work;
- code review;
- alternative implementation when Qoder is stuck;
- difficult frontend/backend reasoning.

Use when Anthropic's model behaviour or harness gives a concrete advantage.

## Claude Opus 5

Ceiling external model for:

- unresolved high-impact architecture;
- high-risk independent review;
- repeated failure by normal primary models;
- difficult integration;
- destructive/irreversible boundaries;
- problems where avoiding rework is worth premium usage.

Do not use Opus simply because the milestone is important.

## Cursor Composer 2.5

Useful for:

- rapid interactive implementation;
- frontend/UI polish;
- iterative write/run/fix work;
- tasks where Cursor's editing environment is particularly convenient.

This hackathon should still keep most implementation in Qoder.

## Cursor Grok 4.6

Useful for:

- long-running implementation;
- difficult debugging;
- terminal-heavy investigation;
- independent review;
- alternative reasoning on complex reversible tasks.

Prefer it when we specifically want model-family diversity or Cursor's harness.

# Quick routing table

| Task shape | Recommended primary | Alternatives / escalation |
|---|---|---|
| Product/system architecture | GPT-5.6 Sol High | Opus 5, Qwen3.8 xHigh |
| Milestone decomposition | GPT-5.6 Sol | Qwen3.8 Medium |
| Prompt from approved plan | GPT-5.6 Sol normal / Qwen3.8 Medium | Qwen3.7-Plus |
| Normal Qoder implementation | **Qwen3.8-Max Medium** | GLM-5.3 High |
| Complex backend/state engine | **Qwen3.8 xHigh / GLM-5.3 High** | Kimi-K3 High |
| Hard debugging | **GLM-5.3 Max** | Qwen3.8 xHigh, DeepSeek Pro |
| Large repository investigation | **Kimi-K3 High/Max** | Qwen3.8 xHigh, Sol |
| Bounded feature implementation | Qwen3.8 Medium / K2.7-Code | Qwen3.7-Plus |
| Tests / fixtures / transformations | Qwen3.7-Plus | K2.7-Code |
| Provider/API adapter | Qwen3.8 / GLM-5.3 | K2.7-Code |
| UI implementation | Qwen3.8 | Composer 2.5, Sonnet |
| UI polish / rapid iteration | Composer 2.5 | Qwen3.8 |
| Routine static review | DeepSeek V4 Flash / Qwen3.8 | Terra, Sonnet |
| Major independent review | Sol High / Opus High | DeepSeek Pro Max, GLM-5.3 Max |
| Integration | **Qwen3.8 xHigh / GLM-5.3 Max** | Kimi-K3, Sol |
| Long autonomous Quest task | Qwen3.8 / Kimi-K3 | Qwen3.7-Max |
| Bounded delegated subtask | Qwen3.7-Plus / K2.7-Code | Luna |
| Architecture gap / conflicting contracts | Sol High | Opus High |
| Final demo-path audit | Sol + different-family Qoder reviewer | Opus if material risk remains |

# Default routing policy

When no special circumstances apply:

### Architecture

**ChatGPT / GPT-5.6 Sol**

Freeze contracts, acceptance criteria, dependencies, and parallel lanes.

### Primary implementation

**Qoder / Qwen3.8-Max**

Use Medium for normal bounded work and xHigh for genuinely complex cross-module work.

### Hard engineering/debugging

**Qoder / GLM-5.3 High or Max**

Use as a peer specialist, not only after Qwen fails.

### Broad long-context work

**Qoder / Kimi-K3**

Use when repository breadth or autonomous task length is materially important.

### Bounded delegated work

**Qoder / Qwen3.7-Plus or Kimi-K2.7-Code**

### Independent Qoder review

Prefer a different family:

- DeepSeek;
- GLM;
- Kimi;
- Qwen;

depending on who implemented the change.

### High-impact external review

**GPT-5.6 Sol or Claude Opus 5**, preferably a different model family from the implementer.

### Fixes and final integration

Return to **Qoder**, normally Qwen3.8-Max or GLM-5.3.

# Escalation policy

Do not mechanically route every failed task through a ladder such as:

`Qwen -> GLM -> Kimi -> DeepSeek -> Sol -> Opus`

Instead classify the failure.

### Architecture misunderstanding

Stop implementation.

Escalate to Planner / Architect, usually Sol or Opus.

### Correct architecture, poor execution

Give the existing implementation and failing evidence to another implementation model, usually Qwen3.8 or GLM-5.3.

### Unknown root cause

Use an Investigator, usually GLM-5.3, DeepSeek-V4-Pro, or Sol.

### Large-context failure

Try Kimi-K3 or increase appropriate context rather than merely increasing prestige.

### Reviewer finds bounded defects

Return findings to the original implementer where practical.

### Repeated model-specific failure

Switch model family.

Do not repeatedly restart the entire milestone unless the implementation is fundamentally unsalvageable.

# Subagent policy

Implementation prompts should include this intent:

> Delegate well-defined, bounded tasks to cheaper or specialist subagents when useful. Keep architecture, shared-contract decisions, cross-lane integration, high-risk changes, and final verification with the primary model.

Good delegated work:

- targeted technical research;
- test generation;
- fixtures;
- data mappings;
- isolated UI components;
- repetitive transformations;
- documentation;
- bounded adapter work;
- narrow investigation questions.

Do not delegate:

- unresolved ontology decisions;
- shared schema changes;
- permission/authority architecture;
- irreversible execution design;
- final integration ownership;
- deciding whether a major architecture deviation is acceptable.

The primary agent remains accountable for delegated outputs.

# Reasoning / effort guidance

Recommend model and reasoning effort separately from the execution prompt.

Use higher effort because the task requires deeper reasoning, not because it has an impressive milestone name.

General pattern:

- **Low / normal:** narrow, deterministic, easily verified work;
- **Medium:** normal feature implementation;
- **High:** meaningful ambiguity, multi-contract work, investigation, integration;
- **xHigh / Max:** difficult cross-cutting reasoning, hard debugging, high-risk review, or repeated failure at lower effort.

Do not reflexively use maximum reasoning for every Qwen3.8 or GLM task.

Long context is also not automatically better. Supply the smallest context that contains the necessary contracts and repository evidence.

# Verification and model evaluation

Models should be evaluated using actual project outcomes.

Track when useful:

- first-pass correctness;
- number and severity of reviewer findings;
- tests added;
- whether tests genuinely prove the contract;
- build/typecheck/lint success;
- unnecessary scope expansion;
- architecture drift;
- demo-specific hardcoding introduced;
- human steering required;
- repeated tool failures;
- time to verified completion;
- Credit consumption;
- final rework required.

The main metric is:

**How much verified engineering progress did this model produce per unit of human attention?**

Credit usage matters, but this project has enough Credits that avoiding rework and protecting the deadline normally matters more.

Update this document as project-specific evidence accumulates.

# Current evidence caveat

Most Qoder models listed here are still being routed primarily from:

- current Qoder capabilities and pricing;
- vendor technical reports;
- public software-engineering evaluations;
- observed behaviour from recent project work.

The repository does not yet contain enough controlled head-to-head implementation evidence to declare a permanent model hierarchy.

During the build, record meaningful observations such as:

- "GLM-5.3 consistently finds state-machine bugs Qwen misses";
- "Qwen3.8 gives cleaner first-pass React implementation";
- "Kimi-K3 handles repository-wide migrations with less context loss";
- "DeepSeek review creates too many false positives";
- "Qwen3.7-Plus reliably handles fixture work without rework."

Those observations should eventually outrank generic benchmark-based expectations.

# Current operating recommendation

For the current hackathon build:

1. **Plan architecture and milestones with GPT-5.6 Sol.**
2. **Execute most implementation in Qoder.**
3. **Use Qwen3.8-Max as the default Qoder primary.**
4. **Use GLM-5.3 aggressively for hard engineering and debugging.**
5. **Use Kimi-K3 selectively for genuinely broad or long-horizon work.**
6. **Use Qwen3.7-Plus and Kimi-K2.7-Code for bounded delegated work.**
7. **Use DeepSeek primarily for useful model-family diversity and independent reasoning.**
8. **Use Cursor/Anthropic/OpenAI implementation models when they provide a concrete advantage, not as the normal execution path.**
9. **Use Sol/Opus for architecture and consequential independent review rather than routine implementation.**
10. **Return fixes and final integration to Qoder so the project's actual implementation history remains Qoder-heavy.**
11. **Use off-peak discounts and scheduled Quest execution when convenient, but never let Credit optimisation slow critical-path development.**
12. **Continuously update routing based on verified project rework rather than treating this document as permanent.**

## Source refresh checklist

When updating this document, check:

- current Qoder model selector / `/model` output;
- Qoder Model Selector documentation;
- Qoder CLI model documentation;
- current Qwen off-peak campaign documentation;
- Qoder Scheduled Tasks / Quest documentation;
- first-party model release notes;
- recent independent coding/agentic benchmarks where useful;
- most importantly, this repository's own implementation and review history.
