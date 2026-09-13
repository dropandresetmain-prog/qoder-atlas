# Agent Model Selection

Lean routing guidance for choosing an AI harness, model class and effort level for Northstar engineering work.

For volatile model-specific evidence, current roster notes, sentiment, fallbacks and research links, see [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md). Routine work should not load that deeper file unless model choice is genuinely unclear or the routing policy needs reevaluation.

Last routing review: **2026-09-13**.

## Routing order

Choose in this order:

1. **Role** — Planner / Architect, Prompter, Implementer, Integrator, Reviewer, Promotion / Cutover.
2. **Harness** — use the surface that can actually access the required repo/worktree, terminal, browser, database, secrets or provider environment.
3. **Task shape / risk** — Bounded, Normal, Complex or Critical.
4. **Independence** — use a different model family/surface only when independent judgement materially reduces unresolved risk.
5. **Effort** — raise reasoning only when the task warrants it.

Model prestige is not a routing rule. Prefer the least costly/slow route that can safely complete and verify the assigned role. Runtime/test/DB/provider evidence outranks model confidence.

## Task classes

| Class | Use for | Routing intent |
|---|---|---|
| **Bounded** | Scope, contracts, acceptance criteria and verification path are clear, even if implementation is difficult | Strong execution model; bounded does **not** mean trivial or cheap |
| **Normal** | Ordinary features, refactors, tests and API/UI work with some local judgement but no major unresolved architecture | Daily-driver model/router |
| **Complex** | Cross-contract work, hard debugging, long-horizon tasks, ambiguous integration or architecture ownership | Strong explicit model or intelligence router |
| **Critical** | Migrations, destructive state, concurrency/CAS/idempotency, payments/authority, rollback or security-sensitive irreversible seams | Strong primary, required execution evidence, and independent review when it materially reduces unresolved risk |

Risk reflects failure cost and ambiguity, not milestone importance. A hard implementation can still be Bounded when the destination and verification are already clear.

## Harness map

| Harness | Best use | Important constraint |
|---|---|---|
| **ChatGPT + GitHub** | Planning, prompt generation, repo reasoning, static review | Inspection is not execution evidence |
| **Cursor** | Default fast local implementation, terminal/test/browser loops | Prefer Auto unless a named-model reason exists |
| **Codex** | Local implementation, terminal/tests, sustained execution, migrations/debugging | Choose model/effort by task shape and risk |
| **Claude Code** | Local implementation, long-context work, independent implementation/review | Useful family independence from OpenAI/Qwen/GLM |
| **Qoder** | Qwen/Kimi implementation and long-context alternatives | Observed slow on the user's ARM64 machine; latency matters most when rapid write/run/fix iteration dominates |
| **Kilo + OpenRouter** | Alternative-family bounded work, delegated tasks, specialist models and second opinions | Provider reliability/privacy/tool support varies; never expose secrets to unapproved/free routes |
| **Cursor + OpenRouter, where configured/supported** | Same OpenRouter pool when the editor/provider path is available | Treat support as operational state, not a permanent assumption |

Astra is a **model**, not a harness. Route GPT-6 Astra through a surface that actually supports the required repo/tool execution.

When local latency matters, prefer Cursor/Codex/Claude Code over Qoder. For bounded tasks needing fewer iterations, Qwen3.8-Flash or GLM-5.3-Flash can still be good total-time choices despite Qoder's slower local loop.

## Default routing

| Task shape | Strong defaults | Notes |
|---|---|---|
| Planner / architecture, Normal | ChatGPT Medium; Terra High; Sonnet; GLM-5.3; Qwen3.8-Max | Do not use Astra merely because the task is planning |
| Architecture closure / implementation-plan synthesis | GPT-6 Astra Medium/High; Sol High; Opus High; GLM-5.3 or Qwen3.8-Max as alternatives | Independent challenge only when material uncertainty or irreversible architecture remains |
| Planner / architecture, Critical | Astra High; Sol High; Opus High | Use one independent challenge when it meaningfully reduces unresolved risk |
| Prompter from approved plan | ChatGPT Medium | Convert the plan; do not re-plan/review it |
| Bounded implementation | Luna High; GLM-5.3-Flash; Qwen3.8-Flash; Cursor Auto Cost/Balance; Composer 2.5 | Defined task with clear acceptance and verification |
| Hard bounded implementation | Luna xHigh/Max; Cursor Auto Intelligence; Grok 4.6 High; Qwen3.8-Max; GLM-5.3 | Difficulty alone does not make a task Complex |
| Normal implementation | Cursor Auto Balance; Composer 2.5; Grok 4.6 Medium; Terra; Sonnet; GLM-5.3-Flash; Qwen3.8-Flash | Astra and N2.5 are not Normal defaults |
| Complex reversible implementation | Cursor Auto Intelligence; Grok 4.6 High; Terra High; Sonnet High; GLM-5.3; Qwen3.8-Max; Kimi K3 | Harness stability matters as much as model capability |
| Long-horizon agent task | Auto Intelligence; Grok 4.6 High; GLM-5.3; Qwen3.8-Max; Kimi K3 | Use `ACTIVE_TASK.md`; preserve checkpoint evidence across compaction |
| Hard debugging / DevOps | Grok 4.6 High; Terra High; Sol High; GLM-5.3; Astra High when hypothesis-space ambiguity is the hard part | Prefer terminal-capable fast harness |
| Normal integration | Auto Balance; Composer; Grok; Terra; Sonnet; GLM-5.3-Flash | Test new seams/conflicts, not every historical lane |
| Complex integration | Auto Intelligence; Grok High; Terra High; Sonnet High; GLM-5.3 | Escalate only for concrete risk or ambiguity |
| Routine static review | ChatGPT Medium/High; GLM-5.3; Grok; Terra; Sonnet; Qwen3.8-Max | A review should answer a concrete question |
| High-risk review | Sol High; Opus High; Astra High; GLM-5.3 where Critical-capable for the question | Runtime/DB/browser/provider evidence remains authoritative |
| Specialist browser/computer-use experiment | Nex-N2.5 Pro or Mini via OpenRouter + supported harness | Specialist/experimental route, not a Normal default |
| High-throughput bounded extraction/transformation | Nemotron 3.5 Lightning; Luna Medium; GLM-5.3-Flash | Not a final verifier for Critical work |

## Family shortcuts

- **Cursor:** Auto Balance for Normal; Auto Intelligence for Complex; Auto Cost for well-defined bounded work. Choose Composer/Grok/Terra/Sonnet explicitly for repeatability, family diversity or known strengths.
- **OpenAI Luna:** effort-sensitive bounded executor. High for solid defined implementation; xHigh for difficult bounded engineering; Max for sustained hard bounded execution when extra reasoning is justified.
- **OpenAI Terra:** general engineering workhorse for broader Normal/Complex work.
- **OpenAI Sol:** Critical/high-stakes work when ambiguity or failure cost justifies it.
- **GPT-6 Astra:** Complex/Critical architecture, investigation and end-to-end work where unresolved reasoning is the hard part. No Normal route.
- **Anthropic:** Sonnet for general/cross-contract implementation; Opus for Critical work and independent review.
- **Qwen on Qoder:** Qwen3.8-Flash for Bounded/Normal-defined work; Qwen3.8-Max for Complex. Qwen3.7 routes are fallbacks.
- **GLM:** GLM-5.3-Flash for Bounded/Normal-defined implementation; GLM-5.3 for Complex implementation/debugging/review.
- **Nex-AGI N2.5:** Mini and Pro are specialist/experimental browser/computer-use routes through OpenRouter where supported, not Normal defaults.
- **Kimi:** Kimi K3 is a Complex/long-horizon alternative, not a universal default.
- **NVIDIA Nemotron:** specialist/challenger for non-sensitive bounded work; 3.5 Lightning is not promoted to primary coding based on speed alone.

See [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md) before changing roster/model-specific claims.

## Named-model rules that matter

- **Composer 2.5** is a legitimate general-purpose primary implementer, not just a mechanical editor.
- **Grok 4.6** is a legitimate Normal/Complex implementation and investigation model. Medium is a practical bounded/Normal default; High for sustained reasoning or higher failure cost.
- **Luna High/xHigh/Max** are serious implementation routes for defined work. Escalate effort with task difficulty, not model prestige.
- **GLM-5.3-Flash** and **Qwen3.8-Flash** are first-class Bounded/Normal-defined routes based on current cross-project use.
- **Astra** is not a Normal implementation default.
- **Nex-N2.5 Pro/Mini** are specialist/experimental routes, not default coders.
- **Sol / Opus / Astra** are higher-ceiling choices for concrete risk, ambiguity or independence reasons, not ceremonial escalation.

## Luna effort guidance

- **Medium:** small defined edits, tests, transformations and isolated slices.
- **High:** default serious bounded implementation with clear contracts and verification.
- **xHigh:** difficult multi-file bounded engineering where architecture is already understood.
- **Max:** sustained hard bounded execution when extra reasoning is useful and quota/wall-clock cost is acceptable.
- If the hard part is discovering architecture, reconciling ambiguous contracts or deciding an irreversible seam, move to a broader/stronger planner rather than blindly increasing Luna effort.

## Northstar-specific classification

The Astra architecture pass has already resolved a large amount of ambiguity. Therefore many M0-M11 tasks should be treated as **Bounded or Hard Bounded even when technically difficult**.

Typical **Bounded/Hard Bounded** work:

- materialising frozen F01-F18 contracts;
- typed domain/persistence schemas with already-approved ownership;
- Journey/group/programme/reservation implementation once contract inputs are fixed;
- tests/fixtures/negative examples against frozen semantics;
- straightforward provider/adaptor mapping after canonical contracts freeze.

Typical **Complex** work:

- cross-domain scope discovery and assessment invalidation;
- external-information applicability/entry semantics where several frozen contracts interact;
- multi-object planning/action-plan composition;
- difficult integration/debugging where the failure mode is not yet known.

Typical **Critical** seams:

- PostgreSQL migration integrity, expected revisions, serializable retries and cross-root transactions;
- inbox/outbox, leases/fencing, idempotency and outcome-unknown reconciliation;
- authority/approval/spend/payment/provider-action gates;
- migration/reconciliation of real provider references, unfinished executions or sensitive travel records;
- production cutover/rollback;
- externally owned state changes with irreversible consequences.

Critical classification changes the **evidence and review burden** more than the default implementation model.

## Three-option milestone rule

When a milestone/checkpoint assigns models, expose **three viable model + harness routes**.

The three normally represent:

1. practical default for the task's failure mode;
2. credible different-family/harness alternative;
3. cost/availability-conscious option that remains safe.

**These are alternatives. Choose one route. Do not execute all three.**

For Critical work, the third route must still be capable of the question. There is no obligation to offer an unsafe low-cost route.

## Review without review hell

**Verification is risk-driven. Model review is uncertainty-driven.**

- Bounded and Normal work do **not** get a reviewer by default.
- Complex work gets review only for material uncertainty, cross-contract risk or an expensive seam.
- Critical work normally justifies **one** independent reviewer plus required execution evidence. That reviewer is already the challenger.
- Add a third model only when material disagreement or unresolved uncertainty remains after the primary and reviewer.
- A reviewer-requested fix gets verification of the fix and directly affected behaviour; it does not automatically restart the full review cycle.
- Promotion/cutover runs the canonical evidence gate on the exact candidate. Promotion is not another AI-review stage.
- A different model never replaces required runtime, DB, browser or provider evidence.

Checkpoint-specific guidance is in [`IMPLEMENTATION_AGENT_ROUTING.md`](IMPLEMENTATION_AGENT_ROUTING.md).

## Premium budget rule

Premium routes are escalation, not the default tax for doing serious engineering.

- M0-M11 implementation should normally require **zero** Sol/Opus/Astra runs solely because of milestone labels.
- C0/C1/C2/C4/C6 should start with a strong non-premium route if independent judgement is actually needed.
- C3 authority/execution is the clearest place where one Sol/Opus/Astra-class review can be justified.
- C5 cutover may justify one premium review only if real production obligations/data are actually involved and unresolved risk remains.
- Any extra premium run needs a concrete reason: unresolved ambiguity, repeated failure, incident or materially increased irreversible risk.

Do not run both Sol and Opus just because both exist.

## Subagents

Implementation prompts should preserve:

> Delegate well-defined bounded tasks to cheaper subagents where useful. Keep architecture, integration decisions, high-risk changes and final verification with the primary model.

"Cheaper" refers to delegation economics, not a claim that bounded tasks are low-value or easy.

Good delegated work includes targeted research, extraction, fixtures/tests with stable contracts, repetitive transformations, isolated UI pieces and documentation cleanup.

## Long-horizon reliability

For work expected to exceed a normal coding session, maintain `docs/work/ACTIVE_TASK.md` with goal, branch/base SHA, checklist, checkpoint, next action and critical constraints. Re-read before major phases, after compaction/delegation and before completion. Close checklist items only with evidence.

## Privacy, reliability and free routes

- Never send secrets, credentials, `.env` contents, private keys, passport/visa/payment data or unnecessary personal data to a model.
- OpenRouter handling is provider-specific. Proprietary/sensitive work requires an acceptable privacy route.
- Treat free routes as non-sensitive-only unless current provider policy is explicitly verified otherwise.
- Free availability, routing, limits, pricing, context and data policies change. Re-check when material.

## Cross-project evidence incorporated here

- Folio commit `78d1477` introduced the Bounded/Normal/Complex/Critical task-shape distinction, Luna effort-aware routing and review-without-review-hell policy.
- Northstar's Astra pass was strong at repo reconstruction, requirement stress-testing, ontology closure and implementation-plan synthesis. Keep Astra for Complex/Critical planning/investigation rather than Normal implementation.
- The architecture is already frozen enough that much implementation should now be routed as bounded execution rather than architecture discovery.
- Qwen3.8-Flash and GLM-5.3-Flash have produced good practical results and deserve first-class defined-task routes.
- Qoder's ARM64 latency is a harness constraint, not a reason to dismiss Qwen/GLM/Kimi.

## How routing evolves

Do not run a formal model bakeoff unless explicitly requested. Update routing from normal project evidence: first-pass correctness, rework, scope creep, verification quality, wall-clock time, quota/cost and human steering.

A benchmark can justify trying a model. Verified Northstar/Folio outcomes decide whether it keeps the slot.
