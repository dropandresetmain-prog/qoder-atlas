# Northstar implementation agent routing

Companion to [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md) and [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md).

This file gives **three viable model + harness routes** for every M0-M11 milestone and C0-C6 checkpoint. It does not change milestone scope, architecture, acceptance criteria or checkpoint authority.

Last routing review: **2026-09-13**.

## Core routing correction

Astra already froze the architecture. Therefore a large amount of difficult implementation is now **Bounded** rather than Complex: the destination, contracts, acceptance criteria and verification path are known even if the code is substantial.

Use this pattern:

`least costly/slow capable implementer -> execution evidence -> independent review only when unresolved risk justifies it -> premium escalation only if still needed`

Three listed routes are **alternatives**. Choose one; do not run all three.

## Milestones

| Milestone | Task class | Route 1 | Route 2 | Route 3 | Why |
|---|---|---|---|---|---|
| **M0 — Materialise frozen contracts** | **Hard Bounded** | **Codex + GPT-5.6 Luna xHigh** | **Qoder + Qwen3.8-Max** | **Cursor + Auto Intelligence** | F01-F18, schemas and acceptance fixtures are already decided; execution is difficult but destination clarity is high. |
| **M1 — PostgreSQL & durability foundation** | **Critical / bounded architecture** | **Cursor + Grok 4.6 High** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | Migrations/concurrency/idempotency require strong implementation and real Postgres evidence. Criticality raises evidence/review burden, not default model price. |
| **M2 — People, Journeys, coordination & credentials** | **Hard Bounded** | **Qoder + Qwen3.8-Flash** | **Codex + GPT-5.6 Luna xHigh** | **Cursor + Composer 2.5** | Ownership/cardinality semantics are frozen; this is disciplined domain implementation rather than architecture discovery. |
| **M3 — Services, reservations & enterprise arrangements** | **Hard Bounded / Normal** | **Qoder + GLM-5.3-Flash** | **Cursor + Composer 2.5** | **Codex + GPT-5.6 Luna High** | Provider-shaped records and allocations are substantial but contract-driven and testable. |
| **M4 — Programmes, resources & geography** | **Hard Bounded** | **Codex + GPT-5.6 Luna xHigh** | **Qoder + Qwen3.8-Flash** | **Cursor + Composer 2.5** | Programme/Participation ownership and geography shape are already frozen; implement against explicit invariants. |
| **M5 — Knowledge, policy & external information** | **Hard Bounded → Complex at semantic seams** | **Qoder + Qwen3.8-Max** | **Codex + GPT-5.6 Terra High** | **Kilo + GLM-5.3** where provider/privacy route is acceptable | Versioning/provenance/applicability are specified, but several semantics meet here; use a broader model if ambiguity appears. |
| **M6 — Unified consequence & viability evaluation** | **Complex** | **Codex + GPT-5.6 Terra High** | **Cursor + Grok 4.6 High** | **Qoder + Qwen3.8-Max** | Multi-object closure, invalidation and evaluators are the main reasoning-heavy convergence point; not automatically Critical because evaluation itself is deterministic/reversible. |
| **M7 — Multi-object planning & explicit action plans** | **Hard Bounded / Complex** | **Codex + GPT-5.6 Luna xHigh** | **Cursor + Auto Intelligence** | **Qoder + Qwen3.8-Max** | Planner output is proposal-only and constrained by frozen scenario/action contracts. |
| **M8 — Authority, finance & durable execution** | **Critical** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | **Cursor + Grok 4.6 High** | Approval, spend, idempotency, retries and provider side effects are irreversible/high-cost seams. Strong implementation first; premium belongs in review/escalation, not every coding pass. |
| **M9 — Runtime, API & operator/traveller integration** | **Normal / Complex** | **Cursor + Auto Balance/Intelligence** | **Cursor + Composer 2.5** | **Codex + GPT-5.6 Luna High** | Fast browser/terminal iteration matters most. Preserve one canonical state/read-model path. |
| **M10 — Migration rehearsal, legacy retirement & candidate** | **Critical** | **Codex + GPT-5.6 Terra High** | **Cursor + Grok 4.6 High** | **Claude Code + Sonnet High** | Reconciliation, restore proof and real-reference transformation have data-loss/rollback risk. |
| **M11 — Controlled cutover** | **Critical operationally / runbook-driven** | **Cursor + Auto Balance + owner-run runbook** | **Codex + GPT-5.6 Luna High + owner-run runbook** | **Claude Code + Sonnet Medium/High + owner-run runbook** | Human owner authorises the switch. Agent assists runbook execution/verification; this is not an open-ended premium coding task. |

### Delegation inside milestones

When contracts are frozen, delegate bounded work cheaply:

- **Luna Medium/High, GLM-5.3-Flash, Qwen3.8-Flash, Cursor Auto Cost** for fixtures, repetitive schema transforms, isolated tests, docs and straightforward adapters;
- **Nemotron 3.5 Lightning** for non-sensitive extraction/transformation with deterministic verification;
- **Composer 2.5** for ordinary UI/API slices and fast refactors.

The milestone primary keeps cross-lane integration, Critical changes and final verification.

## Checkpoints are not automatically AI reviews

A checkpoint is an **acceptance/evidence gate**. It becomes an independent model-review event only when that judgement materially reduces unresolved risk.

Default posture:

- **C0:** primary architect/integrator acceptance; independent review only if M0 reveals a real F01-F18 contradiction or contract ambiguity.
- **C1:** one independent persistence/concurrency reviewer is justified.
- **C2:** one independent domain/evaluation reviewer is justified because multiple lanes converge into a new deterministic core.
- **C3:** one independent authority/execution reviewer is justified; this is the clearest premium-review boundary.
- **C4:** primary product/integration acceptance; no independent reviewer by default.
- **C5:** owner cutover approval; independent review only if this is a real production cutover or meaningful unresolved migration/execution risk remains.
- **C6:** operational evidence/owner acceptance; no separate AI review by default unless an anomaly needs investigation.

## Checkpoint routes

The three routes below are alternatives **when an independent review/judgement is warranted**. Choose a different family from the implementer where practical.

| Checkpoint | Default need | Route 1 | Route 2 | Route 3 | Focus |
|---|---|---|---|---|---|
| **C0 — Contract/schema freeze** | Conditional | **ChatGPT + GPT-5.6 Terra High** | **Qoder + Qwen3.8-Max** | **Kilo + GLM-5.3** | F01-F18 fidelity, invalid examples, collision map, AT mapping. Use only if material ambiguity remains. |
| **C1 — Persistence/integrity/concurrency** | **Independent review justified** | **Claude Code + Sonnet High** | **Qoder + Qwen3.8-Max** | **Kilo + GLM-5.3** | FKs, revisions, serializable retries, idempotency, leases/fencing, migration integrity. Runtime/DB evidence remains authoritative. |
| **C2 — Domain/evaluation acceptance** | **Independent review justified** | **ChatGPT + GPT-5.6 Terra High** | **Kilo + GLM-5.3** | **Qoder + Qwen3.8-Max** | Multi-object closure, applicability, entry/support, stale invalidation and architecture-test coverage. |
| **C3 — Authority/execution** | **Independent high-risk review justified** | **Codex/ChatGPT + GPT-5.6 Sol High** | **Claude Code + Opus High** | **Kilo + GLM-5.3** when demonstrably adequate for the exact question | Approval scope, spend, attempt/reconciliation, partial success, unknown outcomes and provider-action safety. Use **one** reviewer, not a committee. |
| **C4 — Integrated product acceptance** | Conditional | **Cursor + Grok 4.6 High** | **ChatGPT + GPT-5.6 Terra High** | **Qoder + Qwen3.8-Max** | One canonical state across API/UI, generalized scenarios, no hidden legacy fallback. Usually handled by integrator + product evidence. |
| **C5 — Production cutover approval** | Conditional / owner-gated | **Codex/ChatGPT + GPT-5.6 Sol High** | **Claude Code + Opus High** | **Kilo + GLM-5.3** for rehearsal/non-production audit | Exact candidate/data reconciliation, restore drill, uncertain external work, cutover/rollback. Premium only if real production obligations justify it. |
| **C6 — Post-cutover operational acceptance** | Conditional | **Cursor + Grok 4.6 High** | **Codex + GPT-5.6 Terra High** | **Kilo + GLM-5.3** | Sole-writer proof, backups/restart, pending attempts and operating evidence. Review only for anomalies/unresolved risk. |

## Premium budget expectation

Normal expected path:

- **M0-M11 implementation:** zero Sol/Opus/Astra runs required by milestone label alone.
- **C0/C1/C2/C4/C6:** no premium reviewer by default.
- **C3:** one premium independent review is reasonable because this is the authority/money/irreversible-action boundary.
- **C5:** one premium review is reasonable only if a real production cutover with real data/provider obligations is actually happening and material risk remains.

Expected ceiling-model usage is therefore **one premium review for the build, or two if/when production cutover genuinely warrants it**. Any extra premium run needs a concrete reason: unresolved ambiguity, repeated failed implementation/review, incident or materially increased irreversible risk.

## Independence examples

- If **Terra/Codex** implements a Critical seam, prefer **Sonnet/Qwen/GLM** for the first independent review; use Opus/Sol only where C3/C5 or unresolved risk warrants it.
- If **Sonnet/Claude Code** implements it, prefer **Terra/GLM/Qwen/Grok** before paying for a ceiling model.
- If **Grok/Cursor** implements it, Terra/Sonnet/GLM/Qwen usually provide enough family independence.
- Do not count the same model in another UI as meaningful family independence.

## Long-horizon / chat continuity

- Use a fresh implementation session for each major milestone or independent parallel lane.
- Stay in the same session for narrow follow-up fixes while context remains useful.
- Use a fresh reviewer session only when an independent review is actually warranted.
- M1, M6, M8 and M10 should use `docs/work/ACTIVE_TASK.md` because context loss would be costly.
- M11 should use a short explicit runbook/checklist rather than treating cutover as an open-ended coding task.
- M2-M5 parallel lanes must each have explicit branch/worktree ownership and the frozen C0 contract SHA.
