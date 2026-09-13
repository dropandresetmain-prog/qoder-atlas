# Northstar implementation agent routing

Companion to [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) and [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md).

This file gives **three viable model + harness routes** for every M0-M11 milestone and C0-C6 checkpoint. It does not change milestone scope, architecture, acceptance criteria or checkpoint authority.

Last routing review: **2026-09-13 (cost-corrected)**.

## Cost rule

The previous version over-routed premium ceiling models. Corrected policy:

- **Do not use Sol/Opus-class models as default implementers.** Strong normal/complex models should do the work first.
- Premium models are reserved for a **small number of genuinely consequential review/escalation points**, not every milestone labelled Critical.
- Prefer Cursor Auto/Composer/Grok, Terra, Sonnet, GLM and Qwen for implementation. Use cheap delegated models for bounded work.
- A milestone being important does not make every token premium-worthy.
- Runtime/DB/provider evidence matters more than model prestige.

In practice, the default plan should require **zero premium implementation runs**. Premium review is justified mainly at the authority/execution boundary (C3) and, if this reaches a real production cutover with real data/obligations, at C5. Elsewhere it is escalation-only.

## How to use this matrix

- Pick by actual failure mode, harness access, latency and quota.
- Route 1 is the current practical default, not a mandate.
- Route 3 is usually the cost/value alternative, not an intentionally weaker unsafe option.
- For Critical seams, use strong non-premium implementation plus stronger verification/review; do not jump straight to ceiling models.
- Reviewer independence matters more than reviewer prestige.
- Astra may be used as an additional read-only architecture challenger at C0/C2/C4, but it does not replace execution evidence.

## Milestones

| Milestone | Risk | Route 1 | Route 2 | Route 3 | Why |
|---|---|---|---|---|---|
| **M0 — Materialise frozen contracts** | Complex | **Cursor + Auto Intelligence** | **Claude Code + Sonnet 5 High** | **Qoder + Qwen3.8-Max** | Mostly disciplined translation of already-frozen F01-F18 into executable schemas/fixtures. No reason to spend premium ceiling quota. |
| **M1 — PostgreSQL & durability foundation** | Critical | **Cursor + Grok 4.6 High** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet 5 High** | Concurrency/migrations need a strong implementer and real Postgres evidence, not necessarily Sol/Opus. Save premium for review if evidence is ambiguous. |
| **M2 — People, Journeys, coordination & credentials** | Complex | **Cursor + Auto Intelligence** | **Claude Code + Sonnet 5 High** | **Qoder + Qwen3.8-Max** | Broad domain work, but reversible before cutover and well constrained by frozen contracts. |
| **M3 — Services, reservations & enterprise arrangements** | Complex | **Cursor + Grok 4.6 High** | **Cursor + Composer 2.5** | **Codex + GPT-5.6 Terra High** | Provider-shaped modelling benefits from fast write/run/fix loops; premium reasoning is unnecessary by default. |
| **M4 — Programmes, resources & geography** | Complex | **Cursor + Auto Intelligence** | **Claude Code + Sonnet 5 High** | **Qoder + Qwen3.8-Max** | Cross-entity modelling and PostGIS context, but still governed by frozen semantics. |
| **M5 — Knowledge, policy & external information** | Complex | **Claude Code + Sonnet 5 High** | **Kilo + GLM-5.3 High** | **Cursor + Auto Intelligence** | Provenance/freshness/applicability need careful reasoning and family diversity; no ceiling model required. |
| **M6 — Unified consequence & viability evaluation** | Critical | **Codex + GPT-5.6 Terra High** | **Cursor + Grok 4.6 High** | **Claude Code + Sonnet 5 High** | Correctness-heavy deterministic engine work. Strong implementation + adversarial tests first; premium only if the checkpoint review uncovers unresolved logic. |
| **M7 — Multi-object planning & explicit action plans** | Complex | **Cursor + Auto Intelligence** | **Cursor + Composer 2.5** | **Qoder + Qwen3.8-Max** | Planner output is still proposal-only and bounded by deterministic contracts. |
| **M8 — Authority, finance & durable execution** | Critical | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet 5 High** | **Cursor + Grok 4.6 High** | Highest-risk implementation seam, but strong non-premium models can build it against explicit contracts/tests. Spend premium on the independent review, not on every implementation pass. |
| **M9 — Runtime, API & operator/traveller integration** | Complex | **Cursor + Auto Intelligence** | **Cursor + Composer 2.5** | **Cursor + Grok 4.6 Medium/High** | Integration/UI rewards fast browser/terminal iteration far more than premium reasoning. |
| **M10 — Migration rehearsal, legacy retirement & candidate** | Critical | **Codex + GPT-5.6 Terra High** | **Cursor + Grok 4.6 High** | **Claude Code + Sonnet 5 High** | Real-reference transformation and rollback need disciplined scripts/evidence; ceiling models are escalation/review tools, not default implementers. |
| **M11 — Controlled cutover** | Critical operationally | **Cursor + Auto Balance + owner-run runbook** | **Codex + GPT-5.6 Terra Medium/High + owner-run runbook** | **Claude Code + Sonnet Medium/High + owner-run runbook** | Cutover is mostly controlled execution/observation. The owner authorises actions; premium reasoning is only needed if an anomaly appears. |

### Cheap delegation inside milestones

Use cheaper workers whenever contracts are already frozen:

- **Cursor Auto Cost / Luna / GLM-5.3-Flash / Qwen3.8-Flash** for fixtures, repetitive schema transforms, isolated tests, documentation cleanup and straightforward adapters.
- **Composer 2.5** for ordinary UI/API implementation and fast refactors.
- **Qwen3.8-Max/Kimi K3** only when their context/endurance is actually useful enough to justify slower Qoder iteration on this machine.

## Checkpoints / reviews

The reviewer should normally be a different family from the main implementer. **Most checkpoints do not need a premium ceiling reviewer.**

| Checkpoint | Default review | Alternative | Escalation | Review focus |
|---|---|---|---|---|
| **C0 — Contract/schema freeze** | **Kilo + GLM-5.3 High** | **Claude Code + Sonnet 5 High** | **ChatGPT + Sol High only if a real F01-F18 contradiction remains** | Contract fidelity, invalid examples, lane collisions, AT mapping. Astra can additionally challenge architecture. |
| **C1 — Persistence/integrity/concurrency** | **Kilo + GLM-5.3 High** | **Claude Code + Sonnet 5 High** | **Sol/Opus only if concurrency/migration evidence is genuinely unresolved** | FKs, revisions, serialization, idempotency, leases/fencing, migration integrity. |
| **C2 — Domain/evaluation acceptance** | **Kilo + GLM-5.3 High** | **ChatGPT + GPT-5.6 Terra High** | **Sol/Opus only for unresolved cross-domain correctness questions** | Scope closure, applicability, entry/support, assessment invalidation, AT coverage. |
| **C3 — Authority/execution** | **Claude Code + Opus 5 High OR ChatGPT + Sol High** | **Kilo + GLM-5.3 High** if the implementer family makes this independent enough | Premium is justified here because this is the money/irreversible-action boundary | Approval scope, spend, attempt protocol, crash/partial success, unknown outcomes, provider-action safety. Use **one** premium reviewer, not both. |
| **C4 — Integrated product acceptance** | **ChatGPT + GPT-5.6 Terra High** | **Kilo + GLM-5.3 High** | **Sol/Opus only if integration exposes a new architecture issue** | Canonical state/read models, generalized scenarios, no legacy fallback, truthful UI. |
| **C5 — Production cutover approval** | **Claude Code + Opus 5 High OR ChatGPT + Sol High** **only if real production data/provider obligations are actually being cut over** | **Kilo + GLM-5.3 High** for rehearsal/non-production candidate review | Owner approval remains mandatory | Exact candidate/data reconciliation, restore drill, unfinished external work, cutover/rollback runbook. Use **one** premium reviewer if the cutover is real. |
| **C6 — Post-cutover operational acceptance** | **Kilo + GLM-5.3 High** | **Claude Code + Sonnet 5 High** | **Sol/Opus only for unexplained anomalies/incidents** | Sole-writer proof, reconciliation, backups/restart, pending attempts and operating evidence. |

## Premium budget summary

Under the normal path:

- **M0-M11 implementation:** no Sol/Opus required.
- **C0/C1/C2/C4/C6:** no Sol/Opus required unless cheaper strong review leaves a material unresolved issue.
- **C3:** one premium independent review is justified.
- **C5:** one premium independent review is justified **only when there is an actual production cutover with real data/provider obligations**.

So the expected ceiling-model usage is **one premium review for the whole build, or two if/when we really cut over production**, not repeated premium calls across the implementation plan.

## Review independence examples

- If **Terra/Codex** implemented a seam, prefer **GLM/Sonnet** for routine independent review; use Opus only where C3/C5 or a concrete escalation warrants it.
- If **Sonnet/Claude Code** implemented it, prefer **GLM/Terra/Grok** before paying for Sol/Opus.
- If **Grok/Cursor** implemented it, GLM/Sonnet/Terra are usually sufficient independent reviewers.
- Do not count the same model in another UI as meaningful family independence.

## Long-horizon / chat continuity

- Use a fresh implementation session for each major milestone or independent lane.
- Stay in the same session for narrow follow-up fixes while context remains useful.
- Use a fresh reviewer session at C0-C6.
- M1, M6, M8 and M10 should use `docs/work/ACTIVE_TASK.md` because context loss would be costly.
- M11 should use a short explicit runbook/checklist rather than treating cutover as an open-ended coding task.
- M2-M5 parallel lanes must each have explicit branch/worktree ownership and the frozen C0 contract SHA.
