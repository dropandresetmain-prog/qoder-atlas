# Northstar implementation agent routing

Companion to [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md) and [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md).

This file gives **three viable model + harness routes** for historical M0-M11 work and the current post-C5 product-delivery stages. It does not change milestone scope, architecture, acceptance criteria or checkpoint authority.

Last routing review: **2026-09-17**.

## Core routing correction

Astra already froze the foundational architecture. Therefore a large amount of difficult implementation is now **Bounded** rather than Complex: the destination, contracts, acceptance criteria and verification path are known even if the code is substantial.

Use this pattern:

`least costly/slow capable implementer -> execution evidence -> independent review only when unresolved risk justifies it -> premium escalation only if still needed`

Three listed routes are **alternatives**. Choose one; do not run all three.

## Historical M0-M11 milestone routes

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

## Current post-C5 delivery routes

These stages are the current product-delivery path in `IMPLEMENTATION_PLAN.md` §22 and `ROADMAP.md`. Internal engineering checkpoints inside a stage do **not** automatically become new model-review events.

| Stage | Task class | Route 1 | Route 2 | Route 3 | Routing note |
|---|---|---|---|---|---|
| **T2 targeted repair — provider disruption/reprotection** | **Critical / Hard Bounded** | **Qoder + Qwen3.8-Max** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | Destination is now explicit from independent crash/retry review. Keep the existing implementation lane when practical; prove partial-failure recovery with focused PG fault injection. |
| **T3 — incident-scoped assessment -> RecoveryCase orchestration** | **Hard Bounded / Normal integration** | **Qoder + Qwen3.8-Flash** | **Cursor + Composer 2.5** | **Codex + GPT-5.6 Luna High** | Small application seam with explicit acceptance: one incident-scoped failed assessment -> one idempotent case; no Qwen/provider work. |
| **T4 — minimal authoritative Case View + V5.6 graph** | **Normal / UI integration** | **Cursor + Composer 2.5** | **Cursor + Auto Balance** | **Codex + GPT-5.6 Luna High** | Fast browser/UI iteration matters. Renderer consumes authoritative case/read-model truth and must not infer viability/causality. |
| **Slice B — Sarah full recovery E2E** | **Complex integration with Critical seams** | **Cursor + Auto Intelligence** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | One product milestone with internal checkpoints: target capability composition/LIVE smoke -> target-native AI proposal -> deterministic viability -> authority -> execution -> observation -> reassessment/resolution. |
| **Jordan — same-engine generalisation** | **Complex integration/provider-heavy** | **Cursor + Grok 4.6 High** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | Provider/search/reconciliation debugging and same-engine proof matter more than architecture invention. Add only seams Jordan genuinely needs. |
| **Astra one-shot reconciliation — planning only** | **Complex/Critical architecture synthesis** | **GPT-6 Astra High through a supported planning/repo surface** | **ChatGPT + GPT-5.6 Sol High** | **Claude/Claude Code + Opus High** | Reconcile accumulated backend, provider, Railway, observability, Overview and M11 requirements into the remaining plan to 30 Sep. Do **not** assign routine implementation to Astra. |
| **Observability milestone** | **Complex product/read-model integration** | **Cursor + Auto Intelligence** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | Build one semantic operational-history projection feeding Case/Activity/Overview. Do not create a parallel state machine. Visual exploration can happen separately before production integration. |
| **Accepted Event Overview implementation** | **Normal -> Complex UI integration depending on accepted design** | **Cursor + Composer 2.5 / Auto Intelligence as needed** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | Design is frozen first. Keep current Overview until the accepted graph/read-model projection is ready; do not let visual implementation destabilize proven E2E. |
| **Final hardening / M11 / demo rehearsal** | **Critical operationally / bounded by runbook** | **Cursor + Auto Balance + owner-run runbook** | **Codex + GPT-5.6 Luna High + owner-run runbook** | **Claude Code + Sonnet High + owner-run runbook** | Exact candidate, Railway readiness, LIVE/REPLAY fallback, M11 inventory/retirement and release evidence. |

### Fable / specialist visual tools

Fable may be useful for disposable visual/interaction exploration of Overview or observability, but it is not currently part of the repository's approved model arsenal. Do not count it as one of the three implementation routes or let it define backend truth. If it becomes an operationally important route, update `AGENT_MODEL_SELECTION.md` / `MODELS_ARSENAL.md` deliberately rather than silently treating it as canonical routing.

## Checkpoints are not automatically AI reviews

A checkpoint is an **acceptance/evidence gate**. It becomes an independent model-review event only when that judgement materially reduces unresolved risk.

Historical C0-C6 posture remains:

- **C0:** primary architect/integrator acceptance; independent review only if M0 reveals a real F01-F18 contradiction or contract ambiguity.
- **C1:** one independent persistence/concurrency reviewer is justified.
- **C2:** one independent domain/evaluation reviewer is justified because multiple lanes converge into a new deterministic core.
- **C3:** one independent authority/execution reviewer is justified; this is the clearest premium-review boundary.
- **C4:** primary product/integration acceptance; no independent reviewer by default.
- **C5:** owner cutover approval; independent review only if this is a real production cutover or meaningful unresolved migration/execution risk remains.
- **C6:** operational evidence/owner acceptance; no separate AI review by default unless an anomaly needs investigation.

For the **current post-C5 product path**, independent review is intentionally sparse:

1. **T2 targeted review/re-review** — already justified because crash injection exposed Critical partial-write/idempotency risk.
2. **Integrated Slice A review** — one review after T3+T4 converge; no routine T3 or T4 reviewer.
3. **Major Slice B recovery-loop review** — one review over the complete AI proposal -> deterministic viability -> authority -> execution -> observation -> reassessment/resolution chain.
4. **Jordan/generalisation review** — focused same-engine/provider-truth/anti-hardcoding review.
5. **Final release review** — exact candidate only.

A reviewer-requested fix gets targeted verification of the fix and directly affected behaviour; it does not automatically restart the full review cycle.

## Current review routes

The three routes below are alternatives **when the named independent review is warranted**. Prefer a different model family/surface from the implementer where practical. Choose one route, not a committee.

| Review boundary | Route 1 | Route 2 | Route 3 | Focus |
|---|---|---|---|---|
| **T2 targeted provider/idempotency review** | **Claude Code + Opus High** | **ChatGPT + GPT-5.6 Sol High** | **Kilo/OpenRouter + GLM-5.3** where privacy/tool route is acceptable | Partial writes/retry, cancelled-booking semantics, external identity, HTTP validation and focused runtime evidence. |
| **Integrated Slice A review** | **ChatGPT + GPT-5.6 Sol High** | **Claude Code + Opus High** | **Kilo/OpenRouter + GLM-5.3** | Full disruption -> assessment -> case -> authoritative focused graph path; no separate review for each T3/T4 commit. |
| **Major Slice B recovery-loop review** | **Claude Code + Opus High** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Kilo/OpenRouter + GLM-5.3** if demonstrably adequate for the exact question | LLM/action boundary, deterministic viability, authority/currentness, execution fencing, observation/reconciliation and truthful resolution. |
| **Jordan/generalisation review** | **ChatGPT + GPT-5.6 Terra High** | **Kilo/OpenRouter + GLM-5.3** | **Claude Code + Opus High** when provider/execution risk warrants premium independence | Same application code, anti-hardcoding, provider truth, cross-scenario continuity and no Sarah-specific recovery assumptions. |
| **Final release review** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Claude Code + Opus High** | **Kilo/OpenRouter + GLM-5.3** for a non-premium independent audit where adequate | Exact candidate only: current-target gates, Railway/runtime readiness, LIVE/REPLAY honesty, secrets, anti-hardcoding, docs/demo claims and M11 evidence. |

## Historical checkpoint routes

The three routes below remain alternatives when an independent historical C0-C6 judgement is warranted.

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

Normal expected path from the current point:

- **Implementation:** zero Sol/Opus/Astra runs required merely because a stage matters.
- **Astra:** reserve one run for post-Sarah/Jordan architecture/implementation-plan reconciliation unless a concrete earlier architecture contradiction forces escalation.
- **Reviews:** one independent reviewer at each named key boundary above, not after every increment. A premium model is optional where a non-premium independent route is demonstrably adequate, except when concrete Critical risk justifies the ceiling model.
- **Do not run both Sol and Opus** for the same boundary unless the first review leaves material disagreement or unresolved uncertainty.

## Independence examples

- If **Terra/Codex** implements a Critical seam, prefer **Sonnet/Qwen/GLM** for the first independent review; use Opus/Sol only where unresolved risk warrants it.
- If **Sonnet/Claude Code** implements it, prefer **Terra/GLM/Qwen/Grok** before paying for a ceiling model.
- If **Grok/Cursor** implements it, Terra/Sonnet/GLM/Qwen usually provide enough family independence.
- Do not count the same model in another UI as meaningful family independence.

## Long-horizon / chat continuity

- Use a fresh implementation session for each major milestone or independent parallel lane.
- Stay in the same session for narrow follow-up fixes while context remains useful.
- Use a fresh reviewer session only when an independent review is actually warranted.
- T2 repair, Slice B, Jordan, observability and final hardening should use `docs/work/ACTIVE_TASK.md` when the work exceeds a normal coding session.
- T3/T4 can remain bounded sessions with explicit branch/head/acceptance unless they grow materially.
- M11 should use a short explicit runbook/checklist rather than treating cutover as an open-ended coding task.
