# Agent Model Selection

Lean routing guidance for choosing an AI harness, model class and effort level for Northstar engineering work.

This is an operational routing guide, not a model leaderboard. Availability, quotas, pricing, hardware latency and model behaviour change. Prefer the cheapest/fastest route that can safely complete and verify the assigned role.

Last routing review: **2026-09-13 (cost-corrected)**.

## Routing order

Choose in this order:

1. **Role** — Planner / Architect, Prompter, Implementer, Integrator, Reviewer, Promotion / Cutover.
2. **Harness** — use the surface that can actually access the required repo/worktree, terminal, browser, database, secrets or provider environment.
3. **Risk class** — Economy, Normal, Complex or Critical.
4. **Independence** — use a different model family/surface for high-stakes review when practical.
5. **Effort** — raise reasoning only when the task warrants it.

Model prestige is not a routing rule. Runtime/test evidence outranks model confidence.

## Cost-first correction

Northstar should **not** default to ceiling models simply because a milestone contains a Critical seam.

The preferred pattern is:

`strong non-premium implementer -> deterministic/runtime evidence -> independent strong review -> premium escalation only if warranted`

Use Sol/Opus-class models primarily for:

- unresolved architecture after strong cheaper models disagree;
- the independent authority/execution review where money/irreversible actions are involved;
- an actual production cutover review when real data/provider obligations are at stake;
- repeated failed attempts or a concrete incident whose root cause remains unresolved.

Do **not** spend premium quota on routine implementation, documentation, ordinary integration or ceremonial checkpoint review.

## Risk classes

| Class | Use for | Routing intent |
|---|---|---|
| **Economy** | Bounded, reversible, cheap-to-check work | Fast/cheap model or delegated subagent |
| **Normal** | Ordinary features, refactors, tests, UI/API work | Daily-driver model/router |
| **Complex** | Cross-contract work, long-horizon tasks, difficult debugging/integration | Strong explicit model or intelligence router |
| **Critical** | Migrations, concurrency/idempotency, authority/payments, destructive reconciliation, cutover/security-sensitive irreversible seams | Strong non-premium primary + stronger verification/independence; premium reviewer/escalation only where the actual failure cost justifies it |

Risk reflects failure cost and ambiguity, not milestone importance.

## Harness map

| Harness | Best use | Important constraint |
|---|---|---|
| **ChatGPT + GitHub** | Architecture, planning, prompt generation, repo reasoning, static review | Inspection is not execution evidence |
| **Astra** | Read-only architecture reconstruction, ontology stress-testing, architecture closure, implementation-plan synthesis | Strong observed planning result on this refactor; treat as planning/static review, not execution proof |
| **Cursor** | Fast local implementation, terminal/test/browser loops | Prefer Auto unless a named-model reason exists |
| **Codex** | Local implementation, terminal/tests, sustained execution, migrations/debugging | Terra-level work is a strong default; Sol is escalation/review, not the starting point |
| **Claude Code** | Local implementation, long-context work, independent implementation/review | Sonnet is the normal strong route; Opus is escalation/high-risk review |
| **Qoder** | Qwen/Kimi implementation and long-context alternatives | Observed slow on the user's ARM64 machine; avoid deadline-critical write/run/fix loops when latency dominates |
| **Kilo Code + OpenRouter** | Economical/alternative-family bounded work, second opinions and review | Provider availability/privacy/tool support varies; never expose secrets to unapproved/free routes |

Harness quality matters as much as model quality.

## Default routing

| Task shape | Strong defaults | Notes |
|---|---|---|
| Architecture / planning, Normal | ChatGPT Medium; Terra High; Sonnet; GLM-5.3; Qwen3.8-Max; Astra | No execution harness required unless the task must run code |
| Architecture / planning, hard but reversible | Terra High; Sonnet High; GLM-5.3 High; Astra + independent challenger | Escalate to Sol/Opus only for unresolved high-impact disagreement |
| Prompter from approved plan | ChatGPT Medium | Convert approved plan; do not re-plan it |
| Economy implementation / delegated subtask | Cursor Auto Cost; Luna; GLM-5.3-Flash; Qwen3.8-Flash | Stable contract + cheap verification required |
| Normal implementation | Cursor Auto Balance; Composer 2.5; Grok 4.6 Medium; Terra; Sonnet | Default to a fast local harness |
| Complex reversible implementation | Cursor Auto Intelligence; Grok 4.6 High; Terra High; Sonnet High; GLM-5.3; Qwen3.8-Max; Kimi K3 | Use `ACTIVE_TASK.md` for long-horizon work |
| Hard debugging / DevOps | Grok 4.6 High; Terra High; GLM-5.3 High; Sonnet High | Use Sol/Opus only after strong normal routes fail or incident risk justifies it |
| Critical persistence/concurrency/migration/authority implementation | Terra High; Sonnet High; Grok 4.6 High; Auto Intelligence | Criticality changes the evidence/review burden more than the default implementation model |
| Routine static review | ChatGPT Medium/High; GLM-5.3; Grok; Terra; Sonnet; Qwen3.8-Max; Astra | Prefer a different family from implementer when useful |
| High-risk review | GLM-5.3 High; Sonnet High; Terra High first; Sol/Opus when the boundary is genuinely irreversible/high-cost or cheaper review leaves material uncertainty | Different model does not replace runtime/DB/provider evidence |
| Free non-sensitive second opinion | Kilo + Nemotron 3 Ultra or opportunistic GLM free route | Endpoint/privacy/reliability can dominate theoretical capability |
| Ultra-cheap bounded transformation | Kilo + Nemotron 3.5 Lightning | Not a primary coder or final verifier |

## Family shortcuts

- **Cursor:** Auto Balance for Normal; Auto Intelligence for Complex; Auto Cost for Economy. Use Composer/Grok/Terra/Sonnet explicitly for repeatability, family diversity or a known strength.
- **OpenAI:** Luna for bounded work, Terra as the general engineering workhorse, Sol for escalation/high-stakes independent review.
- **Anthropic:** Sonnet for substantial implementation/cross-contract reasoning, Opus for escalation/high-stakes review.
- **Qwen on Qoder:** Qwen3.8-Flash for economical/normal work; Qwen3.8-Max for Complex work. Qwen3.7 routes are fallbacks.
- **GLM:** GLM-5.3-Flash for economy/normal; GLM-5.3 for Complex implementation/debugging/independent review.
- **Kimi:** Kimi K3 is a long-horizon/large-context alternative, not a universal default.
- **NVIDIA Nemotron:** specialist/challenger for non-sensitive bounded work.

## Northstar-specific risk routing

Treat these seams as **Critical** unless the exact task is narrowly read-only/reversible:

- PostgreSQL schema/migration integrity, expected revisions, serializable retries, cross-root transactions;
- inbox/outbox, leases, fencing, idempotency, outcome-unknown reconciliation;
- authority grants, approvals, spend/budget commitments and provider-action gates;
- migration/reconciliation of real provider references, unfinished executions or sensitive travel records;
- production cutover/rollback;
- execution where an external system owns the state being changed.

Critical classification means:

1. stronger acceptance criteria;
2. real execution/concurrency/rollback evidence where applicable;
3. independent review;
4. explicit human authority at irreversible boundaries.

It does **not** automatically mean premium implementation.

Treat these as typically **Complex**:

- Trip/Journey/group ownership implementation;
- Programme/Participation/geography modelling;
- advisories/external-information applicability and entry/credential evaluation;
- multi-object scope discovery and assessment invalidation;
- planning/action-plan conversion;
- cross-provider/runtime integration.

## Premium budget rule

Normal expected usage for the refactor:

- **Implementation M0-M11:** zero Sol/Opus required by default.
- **C0/C1/C2/C4/C6:** strong non-premium reviewer first.
- **C3 authority/execution:** one Sol **or** Opus review is justified.
- **C5 production cutover:** one Sol **or** Opus review is justified only if a real production cutover with real obligations is actually happening.
- Any additional premium run requires a concrete written reason: unresolved architecture, repeated failure, incident, or materially increased irreversible risk.

Do not run both Sol and Opus just because both are available.

## Independent review

High-stakes review should be independent when practical:

- do not let one model family be sole implementer and reviewer of its own Critical change;
- prefer a different family/surface to reduce correlated blind spots;
- inspect code/contracts and existing evidence first;
- run additional checks only for concrete unresolved questions;
- never replace DB/runtime/browser/provider evidence with a model's opinion.

Checkpoint-specific choices are in `IMPLEMENTATION_AGENT_ROUTING.md`.

## Three-option milestone rule

Every milestone/checkpoint exposes three viable model+harness routes.

The three should normally represent:

1. practical default for the failure mode;
2. credible different-family/harness alternative;
3. cost/availability-conscious route that remains safe.

For Critical milestones, keep the implementation models strong but non-premium unless evidence demands escalation. The selected implementer determines reviewer independence.

## Subagents

Implementation prompts should preserve:

> Delegate well-defined bounded tasks to cheaper subagents where useful. Keep architecture, integration decisions, high-risk changes and final verification with the primary model.

Good delegated work includes targeted research, extraction, fixtures/tests with stable contracts, repetitive transformations, isolated UI pieces and documentation cleanup.

## Long-horizon reliability

Use `docs/work/ACTIVE_TASK.md` when work is likely to exceed a normal coding session. Keep goal, branch/base SHA, checklist, checkpoint, next action and critical constraints. Re-read before major phases, after compaction/delegation and before completion. Check items off only after evidence passes.

## Effort guidance

Recommend model and effort separately from the execution prompt.

- **Low / Medium:** bounded, clear, cheaply verified work.
- **Medium / High:** normal feature work with meaningful judgement.
- **High:** complex cross-contract reasoning, hard debugging/integration or high-risk review.
- **xHigh / Max / ceiling:** only after a concrete need is identified.

Cursor Auto modes already encode part of this trade-off; do not manually over-route when Auto is sufficient.

## Privacy, reliability and free routes

- Never send secrets, credentials, `.env` contents, private keys, passport/visa/payment data or unnecessary personal data to a model.
- OpenRouter handling is provider-specific. Proprietary/sensitive work requires an acceptable privacy route.
- Treat free routes as non-sensitive-only unless current provider policy is explicitly verified otherwise.
- Free availability, pricing, limits, context and data policies change. Re-check them when material.

## How routing evolves

Do not run a formal bakeoff unless explicitly requested. Update routing from observed project evidence: first-pass correctness, rework, scope creep, verification quality, wall-clock time, quota/cost and human steering.

Recent project evidence incorporated here:

- Astra was strong at repo reconstruction, architecture closure and plan synthesis; keep it in that role unless execution capability is separately demonstrated.
- Qoder's model quality can be good, but local ARM64 latency makes it a poor default for urgent write/run/fix loops.
- Cursor/Codex/Claude Code are generally better local execution surfaces for this refactor.
- Premium model value is highest when used sparingly at genuinely irreversible/high-cost review boundaries rather than sprayed across every Critical-labelled task.
