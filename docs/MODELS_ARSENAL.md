# Models Arsenal

Deeper reference for the AI models and harnesses available for Northstar engineering work.

This file supports [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md). The routing file is the operational source of truth; this document stores more volatile model-specific evidence, observed constraints, sentiment and fallback logic so routine agents do not need to load it.

Adapted from `dropandresetmain-prog/resume-copilot` commit `78d1477` and current Northstar experience.

Research review: **2026-09-13**.

## How to use this file

Read this file when:

- adding or removing a model/harness;
- reconsidering a route in `AGENT_MODEL_SELECTION.md` or `IMPLEMENTATION_AGENT_ROUTING.md`;
- a model has produced repeated Northstar rework;
- a provider changes pricing, context, privacy or availability materially;
- an unfamiliar model is being proposed for Complex/Critical work.

Do not turn benchmark rank into architecture authority. Model performance is harness-sensitive and changes quickly. Cross-project verified outcomes outrank benchmark prestige.

The routing distinction is **not a price ladder**. "Bounded" means the destination, contracts, acceptance criteria and verification path are sufficiently defined. A bounded task can be technically difficult and can justify high reasoning effort.

## Current roster

| Family / surface | Current role in Northstar routing | Status |
|---|---|---|
| Cursor Auto Balance | Daily-driver ordinary implementation | Primary |
| Cursor Auto Intelligence | Harder reversible implementation/integration | Primary Complex |
| Cursor Auto Cost | Well-defined bounded work | Bounded |
| Cursor Composer 2.5 | General hands-on implementation and fast write/run/fix | Primary |
| Cursor Grok 4.6 | Complex implementation, investigation, debugging | Primary / Complex |
| GPT-5.6 Luna High | Serious bounded implementation | Bounded primary |
| GPT-5.6 Luna xHigh | Difficult bounded multi-file execution | Bounded high-compute |
| GPT-5.6 Luna Max | Sustained hard bounded execution | Bounded ceiling |
| GPT-5.6 Terra | General engineering workhorse | Primary |
| GPT-5.6 Sol | Critical/high-stakes escalation and review | Critical |
| GPT-6 Astra | Complex/Critical architecture, investigation and hardest end-to-end reasoning | Complex / Critical |
| Anthropic Sonnet | General and cross-contract implementation | Primary |
| Anthropic Opus | Critical work and independent review | Critical |
| Qwen3.8-Flash | Bounded/Normal-defined Qoder implementation | Primary Qoder |
| Qwen3.8-Max | Complex Qoder implementation/planning | Complex Qoder |
| Qwen3.7-Plus | Stable older-generation fallback | Fallback |
| Qwen3.7-Max | Older flagship fallback | Fallback |
| GLM-5.3-Flash | Bounded/Normal-defined implementation and delegated work | Primary alternative |
| GLM-5.3 | Complex coding, debugging and independent review | Complex / Reviewer |
| GLM-5.2-free | Free long-context reasoning when route works | Opportunistic |
| Kimi K3 | Complex planning, long-horizon coding, alternative family | Complex / Experimental-primary |
| Nex-N2.5 Mini | Agentic browser/computer-use specialist via OpenRouter | Specialist / Experimental |
| Nex-N2.5 Pro | Stronger agentic browser/computer-use specialist via OpenRouter | Specialist / Experimental |
| NVIDIA Nemotron 3 Ultra | Long-context synthesis, specialist challenger | Specialist |
| NVIDIA Nemotron 3.5 Lightning | High-throughput bounded extraction/execution | Bounded specialist |

Do not make agents deliberate over unavailable routes. Model quality without an operational harness is irrelevant.

## Harness realities

### Cursor

Current default local execution surface for time-sensitive work because it supports repository editing, terminal/test loops, browser integrations and fast iteration.

Cursor Auto is first-class routing:

- **Auto Balance:** Normal implementation default;
- **Auto Intelligence:** materially harder reversible work;
- **Auto Cost:** well-specified bounded work that is cheap to verify.

Select a named model when independence, repeatability or a known family strength/failure mode matters.

OpenRouter models may also be usable through Cursor depending on current provider configuration/support. Treat that as operational state, not a permanent assumption.

### Qoder

Current useful Qoder routes include Qwen3.8-Max, Qwen3.8-Flash, Qwen3.7 fallbacks, GLM-5.3, GLM-5.3-Flash and Kimi K3.

**Observed local constraint:** Qoder is slow on the user's ARM64 computer. This is a harness/hardware latency issue, not evidence that the underlying models are weak.

Routing implication:

- use Qwen3.8-Flash confidently for well-defined work where fewer iterations can offset slower local interaction;
- use Qwen3.8-Max/Kimi when model fit justifies the latency;
- avoid Qoder when rapid terminal write/run/fix iteration dominates wall-clock time;
- prefer Cursor, Codex or Claude Code when local iteration speed is the main constraint.

Current Folio/cross-project experience with Qwen3.8-Flash and GLM-5.3-Flash is strong enough that neither should be relegated to "cheap subagent" status.

### Kilo + OpenRouter

Useful for:

- bounded delegated work;
- specialist browser/computer-use models;
- independent opinions;
- alternative-family static review;
- large-context reading/synthesis;
- experiments that do not justify premium quota.

OpenRouter routing can vary by provider, so model identity alone does not guarantee identical latency, privacy, tool support or reliability.

Do **not** let a free endpoint become a critical dependency merely because token price is zero.

### ChatGPT + GitHub

Strong for repository reasoning, planning, prompt generation and static review. It can inspect the repo but static inspection is not execution evidence. Use an execution harness for tests/builds/browser/DB checks when required.

### Codex / Claude Code

Both remain strong execution surfaces when local terminal work, independent model-family behaviour or sustained coding context makes them a better fit than Cursor.

### Astra is not a harness

GPT-6 Astra is a model. Route it through an actual surface that supports the required repo/tool environment. Northstar has observed strong Astra architecture work, but that does not create execution evidence by itself.

## OpenAI family

### GPT-5.6 Luna

Position: **effort-sensitive bounded executor**, not merely an economy model.

Current useful effort ladder:

| Effort | Northstar use |
|---|---|
| **Medium** | Small defined edits, tests, fixtures, transformations, isolated slices |
| **High** | Default serious bounded implementation with clear contracts and verification |
| **xHigh** | Difficult multi-file bounded engineering where architecture/contracts are already understood |
| **Max** | Sustained hard bounded execution where extra reasoning is useful and quota/wall-clock burn is acceptable |

The key distinction is **destination clarity**. Luna can spend a lot of compute executing against a known target. It is not the default model for discovering architecture, reconciling ambiguous contracts or deciding irreversible seams.

Preferred escalation pattern:

1. High for serious defined work;
2. xHigh when the bounded task is materially difficult;
3. Max when sustained reasoning is actually useful;
4. switch model family/tier when the problem is ambiguity/architecture rather than execution difficulty.

### GPT-5.6 Terra

Position: **general engineering workhorse**.

Use Medium for focused work and High for larger reversible features, difficult debugging, broader integration or several interacting contracts. Terra is a peer option, not a mandatory escalation above Composer/Grok/Auto.

### GPT-5.6 Sol

Position: **Critical/high-stakes escalation and review route**.

Use when there is a concrete reason: unresolved high-cost architecture, destructive migrations, concurrency/payments, independent high-stakes review or repeated rework from normal-tier models.

Sol is not a default implementation model merely because a milestone contains a Critical seam.

### GPT-6 Astra

Position: **Complex/Critical architecture, investigation and hardest end-to-end work. No Normal route.**

Northstar-specific observed evidence: the September 2026 Astra pass was strong at repo reconstruction, ontology stress-testing, architecture closure and implementation-plan synthesis. That earns Astra a planning/investigation route, not a Normal implementation default.

Useful effort ladder:

| Effort | Northstar use |
|---|---|
| **Low** | Focused follow-up inside an already-understood Complex task |
| **Medium** | Architecture reconstruction, implementation-plan synthesis, broad repo reasoning |
| **High** | Architecture closure, ambiguous cross-contract investigation, difficult high-value debugging/review |
| **xHigh** | Exception when High leaves material unresolved ambiguity or one-shot failure cost is unusually high |
| **Max** | Ceiling only: repeated failure below or extremely high-value one-shot reasoning |

**Max is not "Critical mode."** Criticality does not automatically justify Max, and architecture importance does not automatically justify Astra.

The useful pattern is to separate **architecture closure** from **implementation ownership**: Astra can close the system model while another execution model implements against frozen contracts.

### Anthropic Sonnet / Opus

**Sonnet:** strong general implementation/reasoning peer for sustained cross-contract work and a family-independent alternative to OpenAI/Qwen/GLM.

**Opus:** Critical/high-stakes route and independent reviewer when concrete risk or independence justifies it.

## Cursor models

### Cursor Composer 2.5

Position: **general-purpose primary implementer**.

Good fits:

- complete bounded features;
- frontend/backend implementation;
- multi-file changes;
- API plumbing;
- UI behaviour;
- tests/fixtures;
- refactors;
- fast iterative write/run/fix loops.

Do not demote Composer to mechanical edits. Its limitation on unresolved irreversible architecture is a role/risk boundary, not a claim of weak coding ability.

### Cursor Grok 4.6

Position: **frontier implementation/investigation option**.

Strong fits:

- difficult reversible features;
- multi-file/cross-service work;
- long-horizon agentic execution;
- hard debugging with multiple hypotheses;
- DevOps/terminal work that can be checked by execution;
- substantial codebase investigation.

Effort routing remains roughly Medium for bounded/Normal reversible work and High for sustained reasoning/higher failure cost.

## Qwen family — primarily through Qoder

### Qwen3.8-Max

Position: **Complex Qoder primary**.

Use for long-context codebase reasoning, complex reversible implementation/planning and useful family diversity when Qoder latency is acceptable.

### Qwen3.8-Flash

Position: **first-class Bounded/Normal-defined Qoder primary**.

Good fits:

- well-scoped feature implementation;
- defined multi-file changes;
- tests/fixtures;
- refactors with known contracts;
- delegated slices with clear acceptance;
- Normal work where architecture is already stable.

The Qoder ARM64 latency penalty remains real, but it is a harness constraint. If the model completes a bounded task in fewer iterations, it can still win on total wall-clock time.

### Qwen3.7-Plus / Qwen3.7-Max

Fallbacks for continuity or route-specific reliability. Prefer the 3.8 generation for new work unless the current route is unavailable or behaving poorly.

## GLM family

### GLM-5.3

Position: **Complex implementation, debugging and independent reviewer/challenger**.

Good fits:

- complex reversible implementation;
- large-repo investigation;
- static review after a different-family implementer;
- multi-hypothesis debugging;
- challenger on architecture/integration decisions.

Its workflow value is not just raw capability but model-family independence.

### GLM-5.3-Flash

Position: **first-class Bounded/Normal-defined implementation route**.

Why it matters:

- strong capability-per-cost;
- credible primary for defined implementation;
- attractive delegated-subagent model;
- useful different-family second opinion;
- multimodal/agentic fit.

Current cross-project experience is positive enough that "economy powerhouse" undersells its role. It is not reserved for cheap work.

### GLM-5.2-free

Position: **opportunistic free model only**.

Good for optional second opinions, summarisation/context compression, bounded research and noncritical code reading. Do not put an unreliable free endpoint on a critical path.

## Nex-AGI N2.5 — specialist routes

Operational routes in the current shared arsenal: **Nex-N2.5 Mini and Nex-N2.5 Pro** through OpenRouter where supported.

Use them as specialist/experimental routes for browser/computer-use automation, GUI QA, run-observe-fix loops and visually grounded workflows.

Do not promote Mini/Pro to generic Northstar implementation defaults merely because access is cheap/free. Their reason to exist in routing is the agentic visual feedback loop.

## Kimi family — through Qoder

### Kimi K3

Position: **Complex/long-horizon alternative**.

Retain as a credible planning/coding alternative when broad context/endurance matters. Qoder-on-ARM64 latency makes it a poor urgent-loop choice regardless of model quality.

## NVIDIA Nemotron family

### Nemotron 3 Ultra

Position: **specialist/challenger, not default primary coder**.

Use for non-sensitive long-context synthesis, research, challenger reasoning or when free/cheap access has real value.

### Nemotron 3.5 Lightning

Position: **high-throughput bounded worker**.

Good fits: file/data extraction, classification, structured transformations, summarisation, repetitive subagent work and routing/screening with deterministic verification.

Bad fits: unresolved architecture, primary ownership of a complex feature, final Critical verification and migrations/security/concurrency.

## Review evidence and independence

Do not turn the larger arsenal into an AI committee.

**Verification is risk-driven. Model review is uncertainty-driven.**

- Bounded/Normal work does not need a reviewer by default.
- Complex work gets review only for a concrete unresolved question, material cross-contract risk or expensive seam.
- Critical work normally justifies one independent reviewer plus required runtime/DB/browser/provider evidence. One reviewer is already the challenger.
- A third model is justified only by material disagreement or unresolved uncertainty.
- Reviewer-requested fixes get scoped verification; they do not automatically restart the whole review cycle.
- Promotion is an evidence gate on the exact candidate, not another model-review stage.

Independence still matters when review is warranted: prefer a different model family or surface when practical to reduce correlated blind spots.

## Privacy and provider policy

1. Never send secrets, `.env` contents, private keys, passport/visa/payment data or unnecessary personal data to any model.
2. For proprietary code, verify the active provider's data policy when using OpenRouter; use data-collection/provider restrictions where supported.
3. Treat free routes as **non-sensitive-only unless current provider terms establish an acceptable route**.
4. A free endpoint's uptime, tool support, context limit, provider order and privacy terms can change independently of the model weights.
5. If a free route fails/rate-limits, fall back. Do not spend engineering time stabilising a route whose main value is being free.

## How to update the arsenal

Do not run formal bakeoffs unless explicitly requested.

Promote/demote models from normal Northstar work using:

- first-pass correctness;
- review findings requiring repair;
- test/verification quality;
- scope creep;
- wall-clock completion time, including harness latency;
- token/quota/cost burn;
- human steering required;
- endpoint reliability;
- privacy suitability.

A model can be objectively stronger and still be the wrong route because its harness is slow, its endpoint is unreliable or another family gives more useful review independence.

A cheaper model can also be the correct primary when the task is clearly bounded and verification is strong. Do not equate price with role.

When the practical route changes, update [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md) first. Update this file when the underlying rationale/evidence changes enough that future routing decisions would otherwise be misleading.
