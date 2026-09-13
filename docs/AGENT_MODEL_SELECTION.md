# Agent Model Selection

Lean routing guidance for choosing an AI harness, model class and effort level for Northstar engineering work.

This is an operational routing guide, not a model leaderboard. Availability, quotas, pricing, hardware latency and model behaviour change. Prefer the cheapest/fastest route that can safely complete and verify the assigned role.

Last routing review: **2026-09-13**.

## Routing order

Choose in this order:

1. **Role** — Planner / Architect, Prompter, Implementer, Integrator, Reviewer, Promotion / Cutover.
2. **Harness** — use the surface that can actually access the required repo/worktree, terminal, browser, database, secrets or provider environment.
3. **Risk class** — Economy, Normal, Complex or Critical.
4. **Independence** — use a different model family/surface for high-stakes review when practical.
5. **Effort** — raise reasoning only when the task warrants it.

Model prestige is not a routing rule. Runtime/test evidence still outranks model confidence.

## Risk classes

| Class | Use for | Routing intent |
|---|---|---|
| **Economy** | Bounded, reversible, cheap-to-check work | Fast/cheap model or delegated subagent |
| **Normal** | Ordinary features, refactors, tests, UI/API work | Daily-driver model/router |
| **Complex** | Cross-contract work, long-horizon tasks, difficult debugging/integration | Strong explicit model or intelligence router |
| **Critical** | Migrations, concurrency/idempotency, authority/payments, destructive reconciliation, cutover/security-sensitive irreversible seams | Premium primary/reviewer plus independent challenge and required execution evidence |

Risk reflects failure cost and ambiguity, not how important a milestone sounds.

## Harness map

| Harness | Best use | Important constraint |
|---|---|---|
| **ChatGPT + GitHub** | Architecture, planning, prompt generation, repo reasoning, static review | Inspection is not execution evidence |
| **Astra** | Read-only architecture reconstruction, ontology stress-testing, architecture closure, implementation-plan synthesis | Strong observed planning result on this refactor; treat as a planning/static-review surface, not proof that code/tests/DB behaviour executed |
| **Cursor** | Fast local implementation, terminal/test/browser loops | Prefer Auto unless a named-model reason exists |
| **Codex** | Local implementation, terminal/tests, sustained execution, migrations and difficult debugging | Choose model/effort by risk; premium model does not waive independent review |
| **Claude Code** | Local implementation, long-context work, independent implementation/review | Valuable family independence from OpenAI/Qwen/GLM |
| **Qoder** | Qwen/Kimi implementation and long-context alternatives | Observed slow on the user's ARM64 machine; avoid deadline-critical write/run/fix loops when local latency dominates |
| **Kilo Code + OpenRouter** | Economical/alternative-family bounded work, second opinions, delegated review | Provider availability/privacy/tool support varies; never expose secrets to unapproved/free routes |

Harness quality matters as much as model quality. When local iteration speed matters, prefer Cursor/Codex/Claude Code over Qoder on the current machine even when a Qwen/Kimi model is otherwise attractive.

## Default routing

| Task shape | Strong defaults | Notes |
|---|---|---|
| Architecture / planning, Normal | ChatGPT Medium; Terra High; Sonnet; GLM-5.3; Qwen3.8-Max; Astra | No execution harness required unless the task must run code |
| Architecture / planning, Critical | Sol High or Opus High + independent challenger; Astra as an additional static architecture challenger | Final irreversible decision remains evidence- and owner-gated |
| Prompter from approved plan | ChatGPT Medium | Convert approved plan; do not re-plan it |
| Economy implementation / delegated subtask | Cursor Auto Cost; Luna; GLM-5.3-Flash; Qwen3.8-Flash | Stable contract + cheap verification required |
| Normal implementation | Cursor Auto Balance; Composer 2.5; Grok 4.6 Medium; Terra; Sonnet | Default to a fast local harness |
| Complex reversible implementation | Cursor Auto Intelligence; Grok 4.6 High; Terra High; Sonnet High; GLM-5.3; Qwen3.8-Max; Kimi K3 | Use `ACTIVE_TASK.md` for long-horizon work |
| Hard debugging / DevOps | Grok 4.6 High; Terra High; Sol High; GLM-5.3 | Prefer terminal-capable fast harness |
| Critical persistence/concurrency/migration/authority work | Codex Sol High or Claude Code Opus High | Mandatory targeted runtime/DB evidence; prefer different-family review |
| Routine static review | ChatGPT Medium/High; GLM-5.3; Grok; Terra; Sonnet; Qwen3.8-Max; Astra | Prefer a different family from implementer when useful |
| High-risk review | Sol High or Opus High, preferably the family that did not implement | GLM-5.3/Qwen can be additional challengers, not substitutes for required execution evidence |
| Free non-sensitive second opinion | Kilo + Nemotron 3 Ultra or opportunistic GLM free route | Endpoint/privacy/reliability can dominate theoretical capability |
| Ultra-cheap bounded transformation | Kilo + Nemotron 3.5 Lightning | Not a primary coder or final verifier |

## Family shortcuts

- **Cursor:** Auto Balance for Normal; Auto Intelligence for Complex; Auto Cost for Economy. Select Composer/Grok/Terra/Sonnet explicitly when repeatability, family diversity or a known strength matters.
- **OpenAI:** Luna for bounded work, Terra as a general engineering workhorse, Sol for Critical seams and high-stakes review.
- **Anthropic:** Sonnet for substantial implementation/cross-contract reasoning; Opus for Critical implementation/review and difficult independent challenge.
- **Qwen on Qoder:** Qwen3.8-Flash for economical/normal work; Qwen3.8-Max for Complex work. Qwen3.7 routes are fallbacks, not a default comparison exercise.
- **GLM through Kilo/OpenRouter or another supported harness:** GLM-5.3-Flash for economy/normal; GLM-5.3 for complex implementation/debugging/review.
- **Kimi:** Kimi K3 is a long-horizon/large-context alternative, not a universal default. Qoder latency matters in urgent loops.
- **NVIDIA Nemotron through Kilo/OpenRouter:** specialist/challenger for non-sensitive bounded work; do not promote based on speed alone.

## Northstar-specific risk routing

Treat these seams as **Critical** unless the exact task is narrowly read-only or otherwise proven reversible:

- PostgreSQL schema/migration integrity, expected revisions, serializable retries, cross-root transactions;
- inbox/outbox, leases, fencing, idempotency, outcome-unknown reconciliation;
- authority grants, approvals, spend/budget commitments, payment/provider-action gates;
- migration/reconciliation of real provider references, unfinished executions or personal/travel credentials;
- production cutover/rollback;
- execution semantics where an external system owns the state being changed.

Treat these as typically **Complex**:

- Trip/Journey/group ownership implementation;
- Programme/Participation/geography modelling;
- advisories/external-information applicability and entry/credential evaluation;
- multi-object scope discovery and assessment invalidation;
- planning/action-plan conversion;
- cross-provider integration and runtime composition.

A legal/entry domain requirement is not automatically a Critical coding task. The Critical boundary is where incorrect implementation could produce an irreversible action, unsafe certainty, destructive data change or unreviewed production claim.

## Independent review

High-stakes review should be independent when practical:

- do not let one model family be the sole implementer and sole reviewer of its own Critical change;
- prefer a different model family or surface to reduce correlated blind spots;
- review the exact code/contracts and existing evidence first;
- run additional tests only for concrete unresolved questions;
- never replace DB/runtime/browser/provider evidence with a model's opinion.

Checkpoint-specific choices are in `IMPLEMENTATION_AGENT_ROUTING.md`.

## Three-option milestone rule

Every implementation milestone/checkpoint should expose **three viable model + harness routes**, not a single ceremonial assignment.

The three routes should normally cover:

1. strongest/default fit for the failure mode;
2. credible different-family or different-harness alternative;
3. cost/availability-conscious route that is still safe for the stated risk.

For Critical milestones the third option must still be Critical-capable; there is no obligation to provide a cheap unsafe route. The selected implementer determines which reviewer choices remain sufficiently independent.

## Subagents

Implementation prompts should preserve:

> Delegate well-defined bounded tasks to cheaper subagents where useful. Keep architecture, integration decisions, high-risk changes and final verification with the primary model.

Good delegated work includes targeted research, extraction, fixtures/tests with stable contracts, repetitive transformations, isolated UI pieces and documentation cleanup.

Do not delegate ambiguous architecture or Critical persistence/security decisions simply because a cheap/free model is available.

## Long-horizon reliability

Use `docs/work/ACTIVE_TASK.md` when work is likely to exceed a normal coding session. Keep it lightweight: goal, branch/base SHA, checklist, checkpoint, next action and critical constraints. Re-read before major phases, after compaction/delegation and before completion. Check items off only after evidence passes; keep full logs on disk and summarise pass/fail evidence compactly.

## Effort guidance

Recommend model and effort separately from the execution prompt.

- **Low / Medium:** bounded, clear, cheaply verified work.
- **Medium / High:** normal feature work with meaningful judgement.
- **High:** complex cross-contract reasoning, hard debugging/integration or high-risk review.
- **xHigh / Max / ceiling:** only after a concrete need is identified.

Cursor Auto modes already encode part of this trade-off; do not manually over-route when Auto is sufficient.

## Privacy, reliability and free routes

- Never send secrets, credentials, `.env` contents, private keys, passport/visa data, payment data or unnecessary personal data to a model.
- OpenRouter data handling is provider-specific. Proprietary/sensitive work requires an acceptable provider/privacy route.
- Treat free routes as non-sensitive-only unless the current provider policy is explicitly verified otherwise.
- Free availability, pricing, limits, context and data policies change. Re-check current documentation when they materially affect the task.

## How routing evolves

Do not run a formal bakeoff unless explicitly requested. Update routing from observed project evidence: first-pass correctness, rework, scope creep, verification quality, wall-clock time, quota/cost and human steering.

Recent cross-project evidence incorporated here:

- Folio's September 2026 harness-first/risk-based routing is a better operational model than assigning one default coding agent to every task.
- Northstar's Astra architecture pass was strong at repo reconstruction, requirement stress-testing, ontology closure and implementation-plan synthesis; preserve that strength as a planning/static-review role rather than assuming it also supplies execution evidence.
- Qoder remains useful for Qwen/Kimi but has a meaningful local-latency penalty on the user's ARM64 machine.
- Cursor/Codex/Claude Code remain the better default surfaces for time-sensitive write/run/fix cycles.
