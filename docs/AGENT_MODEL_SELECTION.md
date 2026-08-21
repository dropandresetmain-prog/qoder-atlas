# Agent Model Selection

Source-of-truth guidance for choosing the agent surface, model, and reasoning level for the Atlas × Alibaba Cloud Hackathon implementation.

**Qoder is the default implementation harness.** Model choice is a routing decision, not a prestige ladder. Choose the combination most likely to complete and verify the assigned role with low rework while preserving scope discipline.

Availability, Credit rates, model behaviour, context limits, and Qoder routing can change. Qoder's current model selector or `/model` output is authoritative for what is currently available.

Last routing review: **2026-08-22**.

## 1. Core principles

1. **Choose the harness first.** Repository editing, terminal execution, tests, worktrees, and secrets/provider access generally make Qoder the right implementation surface.
2. **Choose the orchestration role before the model.** Planner, Implementer, Integrator, Investigator, and Reviewer have different requirements.
3. **Repository evidence outranks benchmarks.** Instruction following, hardcoding tendency, test quality, scope discipline, and verified rework matter more than a benchmark score.
4. **Model choice stays separate from the execution prompt.** The prompt should describe the task/contract; routing can change without rewriting the task.
5. **Use stronger models because the task needs them, not because a checkpoint sounds important.**
6. **Delegate bounded work economically.** Primary agents retain architecture, shared-contract decisions, high-risk changes, integration, and final verification.
7. **Verification is determined by the change, not the model.**
8. **Prefer a different model family for consequential independent review.**
9. **Do not reopen frozen architecture during routine implementation.** Report a genuine architecture gap instead.
10. **No model gets permission to hardcode the demo.**

## 2. Project-specific evidence: Qwen3.8-Max

Qwen3.8-Max is capable and remains useful, but it is **not the automatic default owner for core architecture-sensitive implementation in this repository**.

Observed project risk:
- it has required more explicit handholding than desired;
- it has shown a tendency to solve locally by hardcoding rather than preserving generalized abstractions.

Therefore:
- use Qwen3.8-Max for bounded, reversible work when contracts/files/acceptance are explicit;
- use Medium for normal bounded implementation;
- use xHigh only where deeper reasoning is genuinely useful;
- prompts involving Qwen3.8-Max must explicitly prohibit scenario/location/fixture-specific branches and require reporting architecture gaps;
- core state/viability, authority, and cross-lane integration should normally prefer GLM-5.3 or another model with stronger observed engineering discipline until repository evidence changes;
- review Qwen-authored core logic with tests plus the anti-hardcoding gate; do not rely on self-review.

This is a project routing rule, not a claim that Qwen3.8-Max is generally weaker than another model.

## 3. Orchestration roles

### Planner / Architect

Owns:
- ontology and shared contracts;
- graph/state architecture;
- agentic vs deterministic boundaries;
- provider-neutral interfaces;
- decomposition/dependencies/parallel lanes;
- cross-lane decisions and architecture gaps.

Strong defaults:
- **GPT-5.6 Sol High** for external architecture/decomposition;
- **GLM-5.3 High/Max** when architecture must be resolved inside the executable repository;
- **Claude Opus High** as an independent architecture challenger where useful;
- Qoder Ultimate only when multi-model/frontier reasoning has a concrete advantage.

Do not spend a premium model merely to convert an approved work package into a prompt.

### Prompter / Task Decomposer

Turns an approved work package from `docs/IMPLEMENTATION_PLAN.md` into an execution prompt. It does not redesign the plan.

Prompt must include:
- exact branch/worktree/head;
- objective and work-package ID;
- authoritative files;
- owned/do-not-touch paths;
- frozen contracts;
- acceptance criteria;
- scoped verification;
- explicit exclusions;
- subagent guidance;
- completion-report format.

Strong defaults:
- ChatGPT/Sol normal reasoning;
- Qwen3.7-Plus for straightforward prompt conversion;
- Qwen3.8-Max Medium where repo context is useful and the task remains bounded.

### Implementer

Qoder is default.

Preferred pool:
- **GLM-5.3** — core backend, deterministic state logic, provider integration, difficult engineering;
- **Kimi-K2.7-Code** — focused implementation with clear contracts;
- **Qwen3.8-Max** — bounded multi-file/UI/API work with explicit constraints;
- **Qwen3.7-Plus** — inexpensive well-specified implementation/tests/fixtures;
- **Kimi-K3** — unusually broad repository context or long-horizon implementation.

The implementer:
- verifies branch/worktree/head before editing;
- executes the approved plan instead of re-planning it;
- stays within owned paths/contracts;
- surfaces architecture gaps;
- runs scoped evidence;
- may delegate bounded tasks but remains accountable for final lane verification.

### Investigator / Debugger

Use for a bounded question, not speculative refactoring.

Examples:
- provider payload fails normalization;
- LIVE and REPLAY diverge;
- state transition is wrong;
- graph propagation is surprising;
- external credential/runtime issue;
- contract mismatch.

Strong defaults:
- **GLM-5.3 High/Max**;
- **DeepSeek-V4-Pro High/Max** for independent competing-hypothesis reasoning;
- **Kimi-K3 High** for broad repository tracing;
- GPT-5.6 Sol High for difficult external escalation.

Output must be evidence + root-cause assessment + proposed fix/decision.

### Integrator

Owns:
- branch/worktree/ancestry checks;
- merge/conflict resolution;
- cross-lane seam wiring;
- capability -> planner -> viability -> authority integration;
- UI/backend read-model seams;
- LIVE/RECORD/REPLAY equivalence;
- end-to-end scenario evidence.

Strong defaults:
- **GLM-5.3 High/Max** as default;
- **Kimi-K3 High** when repository breadth is unusually large;
- Qoder Performance tier when direct named routing is inconvenient;
- Qwen3.8-Max only when the integration task is tightly bounded and anti-hardcoding checks are explicit.

Use Sol/Opus only when integration exposes a genuine cross-cutting architecture question, not as routine ceremony.

### Reviewer

Independent review is a deliberate risk-control checkpoint, not a ritual after every work package.

Strong options:
- **DeepSeek-V4-Pro High/Max**;
- **GLM-5.3 Max** if it did not implement the reviewed area;
- Qoder Ultimate with a different family where practical;
- external **GPT-5.6 Sol High** or **Claude Opus High**.

High-value review targets:
- state mutation;
- deterministic viability;
- authority/irreversible action gates;
- persistence;
- provider execution;
- LIVE/RECORD/REPLAY consistency;
- policy enforcement;
- AI schema boundaries;
- demo-specific hardcoding.

## 4. Current Qoder model routing

Current rates/availability may change; use `/model` as authority.

| Model | Typical project role |
|---|---|
| Qwen3.8-Max | Bounded general implementation; UI/API work; schema-driven work with strict scope |
| Qwen3.7-Max | Secondary Qwen option / scheduled bounded work |
| Qwen3.7-Plus | Tests, fixtures, docs, simple adapters, repetitive bounded changes |
| GLM-5.3 | Default core engineering, debugging, deterministic backend, provider work, integration |
| GLM-5.2 | Fallback only if 5.3 regresses or reproducibility requires it |
| Kimi-K3 | Long-context / broad long-horizon repository work |
| Kimi-K2.7-Code | Focused implementation workhorse |
| DeepSeek-V4-Pro | Independent hard reasoning/review/debugging |
| DeepSeek-V4-Flash | Cheap bounded second opinion/review |
| MiniMax-M3 | Experimental bounded work only |

### Pricing snapshot (routing context only)

Current repository guidance records these approximate Qoder Credit rates; confirm in `/model` before making a pricing-sensitive decision:

| Model | Approx. standard rate | Notes |
|---|---:|---|
| Qwen3.8-Max | 0.5x | published off-peak promotion has been ~0.25x |
| Qwen3.7-Max | 0.5x listed | promotional/off-peak rates may be lower |
| Qwen3.7-Plus | 0.1x | published off-peak rate has been ~0.04x |
| GLM-5.3 | 0.6x | core engineering default despite slightly higher rate |
| Kimi-K3 | 0.8x | pay for long-context value when needed |
| Kimi-K2.7-Code | 0.3x | focused implementation workhorse |
| DeepSeek-V4-Pro | 0.8x | use for hard independent reasoning |
| DeepSeek-V4-Flash | 0.3x | bounded review/second opinion |

For Bangkok, the previously published Qwen3.8 off-peak window corresponds approximately to **21:00–07:00**. Schedule well-specified autonomous work there when convenient, but never delay critical-path interactive work just for cheaper Credits.

### GLM-5.3
Default recommendation for:
- core state/viability;
- complex provider adapters;
- deterministic validation;
- hard debugging;
- cross-lane integration.

Use High normally; Max when multiple interacting hypotheses/contracts make the extra reasoning worthwhile.

### Kimi-K2.7-Code
Use for clearly specified:
- isolated backend/frontend features;
- adapter plumbing;
- tests;
- refactors;
- code transformations.

Prefer it over Kimi-K3 when the task is implementation rather than broad repository synthesis.

### Kimi-K3
Use when:
- the task spans many modules/docs;
- long autonomous context retention matters;
- architecture reconciliation requires broad repository context.

Do not route to K3 merely because the work is important.

### Qwen3.7-Plus
Good for:
- fixture/test generation;
- straightforward parsers/adapters;
- documentation;
- simple UI components;
- bounded delegated work.

Do not give it unresolved cross-system architecture.

### DeepSeek-V4-Pro / Flash
Use Pro for difficult independent reasoning/review; Flash for cheap bounded review/debugging. Different-family review can be more valuable than a stronger self-review.

## 5. Qoder tiers / Experts

Named routing is preferred when practical because it is reproducible and helps us learn repository-specific model performance.

- **Performance** is acceptable for ordinary substantial implementation when a named choice is unnecessary.
- **Ultimate** should be reserved for genuinely difficult cross-cutting architecture/debugging/review where extra orchestration adds value.
- **Experts mode** is for multi-hypothesis synthesis or broad independent investigation, not routine implementation.
- Do not use automatic tiers simply to avoid making a routing decision.

## 6. Qoder Quest, Spec, worktrees, and scheduled work

Use Spec-driven Quest for medium/large work packages. The generated Spec must be checked against `docs/IMPLEMENTATION_PLAN.md` before Build; it may elaborate but not redefine the work package.

Use one worktree per meaningful independent lane, not per tiny task.

Scheduled/autonomous execution is useful when work is:
- well specified;
- reversible;
- independently testable;
- unlikely to need rapid human decisions.

Good scheduled work:
- a bounded package after contracts freeze;
- test expansion;
- fixture work;
- a targeted audit;
- a bounded adapter;
- documentation after implementation.

Do not schedule unresolved architecture.

Off-peak discounts are useful opportunistically but must not delay critical-path work.

## 7. Runtime Alibaba Model Studio models

Runtime Model Studio selection is separate from the Qoder coding-agent choice.

For extraction/planner plumbing:
1. start with a cheap available model;
2. validate schema/tool plumbing;
3. use saved/replayed outputs in routine tests;
4. upgrade model quality only when the integrated vertical loop proves quality is materially blocking the product.

Do not burn implementation time solving non-critical external/model quality problems before the core pipeline works.

## 8. Delegation policy

Primary agents may delegate only tasks with crisp inputs/outputs and cheap verification, such as:
- fixtures;
- isolated tests;
- repetitive schemas after semantics freeze;
- bounded parsers;
- isolated UI components;
- documentation;
- narrow investigation.

Primary agent retains:
- understanding the approved work package;
- architecture/shared-contract decisions;
- integration;
- high-risk state changes;
- resolution of conflicting subagent outputs;
- scoped verification;
- completion report.

## 9. Model evaluation

Judge choices by verified end-to-end rework:
- first-pass correctness;
- scope/hardcoding discipline;
- meaningful test coverage;
- number/severity of review fixes;
- human steering required;
- wall-clock completion;
- Credit usage where relevant.

Update this document when repository evidence materially changes the routing recommendation.
