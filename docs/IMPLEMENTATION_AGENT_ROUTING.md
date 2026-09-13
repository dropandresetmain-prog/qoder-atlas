# Northstar implementation agent routing

Companion to [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) and [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md).

This file gives **three viable model + harness routes** for every M0-M11 implementation milestone and C0-C6 checkpoint. It does not change milestone scope, architecture, acceptance criteria or checkpoint authority.

Last routing review: **2026-09-13**.

## How to use this matrix

- Pick by the task's actual failure mode, available harness and current account limits — not by prestige.
- The first route is the current default fit, not a mandate.
- For Critical work, the third route is still Critical-capable; do not downgrade merely to save quota.
- A reviewer should normally be from a different model family than the primary implementer on Critical work.
- Existing execution evidence belongs to the exact SHA/data state. A reviewer model does not replace tests, DB concurrency evidence, browser checks or provider observations.
- Astra may be used as an additional read-only architecture challenger at C0/C2/C4, but because its backing model/surface can be opaque and it does not provide execution evidence, it is not counted as one of the three model+harness routes below.

## Milestones

| Milestone | Risk | Route 1 | Route 2 | Route 3 | Why |
|---|---|---|---|---|---|
| **M0 — Materialise frozen contracts** | Complex | **Claude Code + Sonnet 5 High** | **Codex + GPT-5.6 Terra High** | **Cursor + Auto Intelligence** | Schema/contract materialisation needs broad repo context and disciplined translation of F01-F18, but no irreversible runtime change yet. |
| **M1 — PostgreSQL & durability foundation** | **Critical** | **Codex + GPT-5.6 Sol High** | **Claude Code + Opus 5 High** | **Cursor + Grok 4.6 High** | Migrations, expected revisions, serializable retries, claims/fencing and idempotency need real DB tests and strong concurrency reasoning. |
| **M2 — People, Journeys, coordination & credentials** | Complex | **Claude Code + Sonnet 5 High** | **Codex + GPT-5.6 Terra High** | **Cursor + Auto Intelligence** | Cross-contract domain work with sensitive identity/relationship invariants; largely reversible before cutover. |
| **M3 — Services, reservations & enterprise arrangements** | Complex | **Cursor + Grok 4.6 High** | **Claude Code + Sonnet 5 High** | **Codex + GPT-5.6 Terra High** | Provider-shaped records, shared allocations, servicing ownership and offer/entitlement distinctions reward fast terminal investigation plus strong contract reasoning. |
| **M4 — Programmes, resources & geography** | Complex | **Claude Code + Sonnet 5 High** | **Codex + GPT-5.6 Terra High** | **Cursor + Auto Intelligence** | Shared schedule ownership, PostGIS context and fan-out semantics need broad but still reversible implementation. |
| **M5 — Knowledge, policy & external information** | Complex | **Claude Code + Sonnet 5 High** | **Codex + GPT-5.6 Terra High** | **Kilo + GLM-5.3 High** | Versioned advisories/conditions/rules and provenance/freshness need careful semantic separation and useful family diversity. Keep sensitive data off unapproved OpenRouter routes. |
| **M6 — Unified consequence & viability evaluation** | **Critical** | **Codex + GPT-5.6 Sol High** | **Claude Code + Opus 5 High** | **Cursor + Grok 4.6 High** | Multi-object closure, phantom/time invalidation, entry/support evaluation and assessment manifests become a core correctness boundary. |
| **M7 — Multi-object planning & explicit action plans** | Complex | **Claude Code + Sonnet 5 High** | **Cursor + Auto Intelligence** | **Codex + GPT-5.6 Terra High** | Planner proposals must map cleanly into typed scenario/action contracts without regaining mutation authority. |
| **M8 — Authority, finance & durable execution** | **Critical** | **Codex + GPT-5.6 Sol High** | **Claude Code + Opus 5 High** | **Cursor + Grok 4.6 High** | Approval scope, spend commitments, retries, outcome-unknown reconciliation and provider-side effects are irreversible/high-cost seams. |
| **M9 — Runtime, API & operator/traveller integration** | Complex | **Cursor + Auto Intelligence** | **Claude Code + Sonnet 5 High** | **Codex + GPT-5.6 Terra High** | Integration/UI benefits from fast browser/terminal loops while preserving one canonical state/read-model path. Composer 2.5 is a good delegated UI option inside this milestone. |
| **M10 — Migration rehearsal, legacy retirement & candidate** | **Critical** | **Codex + GPT-5.6 Sol High** | **Claude Code + Opus 5 High** | **Cursor + Grok 4.6 High** | Real-reference transformation, reconciliation, restore evidence and legacy retirement have data-loss/rollback risk. |
| **M11 — Controlled cutover** | **Critical** | **Codex + GPT-5.6 Sol High, operator-controlled** | **Claude Code + Opus 5 High, operator-controlled** | **Cursor + Grok 4.6 High, operator-controlled** | The human owner controls the production switch. The agent assists runbook execution/verification; it does not autonomously authorise cutover or destructive rollback. |

### Optional specialist substitutions

These are alternatives when their specific strengths justify the harness cost/latency; they are not extra mandatory reviews:

- **Qoder + Qwen3.8-Max** — Complex long-context implementation when local Qoder latency is acceptable.
- **Qoder + Kimi K3** — long-horizon/large-context implementation where endurance is the bottleneck.
- **Kilo + GLM-5.3-Flash** — economical bounded implementation/review on non-sensitive material.
- **Cursor + Composer 2.5** — general implementation and fast UI/API/write-run-fix slices with frozen contracts.
- **Codex + Luna** — bounded delegated implementation/tests after contracts are stable.

## Checkpoints / reviews

Reviewer selection depends on who implemented the reviewed seam. Route 1 below assumes it preserves useful independence; if it does not, choose Route 2 or 3.

| Checkpoint | Risk | Route 1 | Route 2 | Route 3 | Review focus |
|---|---|---|---|---|---|
| **C0 — Contract/schema freeze** | Complex | **ChatGPT + GPT-5.6 Sol High** | **Claude Code + Opus 5 High** | **Kilo + GLM-5.3 High** | F01-F18 fidelity, executable contracts, lane collision map, invalid examples, architecture-test mapping. Astra may additionally challenge static architecture. |
| **C1 — Persistence/integrity/concurrency** | **Critical** | **Claude Code + Opus 5 High** | **Codex + GPT-5.6 Sol High** | **Kilo + GLM-5.3 High** | FK/ownership, expected revisions, serializable retries, migration integrity, inbox/outbox, leases/fencing. Use a different family from M1 implementer. |
| **C2 — Domain/evaluation acceptance** | **Critical** | **Claude Code + Opus 5 High** | **Codex + GPT-5.6 Sol High** | **Kilo + GLM-5.3 High** | Multi-object closure, applicability, entry/support, assessment manifests, phantom/time invalidation, AT coverage. Astra may be an extra static challenger. |
| **C3 — Authority/execution** | **Critical** | **Claude Code + Opus 5 High** | **Codex + GPT-5.6 Sol High** | **Kilo + GLM-5.3 High** | Approval envelopes, budget/spend, claim/attempt protocol, crash/partial success, outcome-unknown reconciliation, provider-action safety. Different family from M8 implementer. |
| **C4 — Integrated product acceptance** | Complex | **ChatGPT + GPT-5.6 Sol High** | **Claude Code + Opus 5 High** | **Cursor + Grok 4.6 High** | One canonical state across APIs/UI, truthful current/stale/unknown presentation, generalized scenarios, no legacy fallback. Reuse execution evidence rather than inventing static proof. |
| **C5 — Production cutover approval** | **Critical** | **Claude Code + Opus 5 High** | **Codex + GPT-5.6 Sol High** | **Kilo + GLM-5.3 High** | Exact candidate/data reconciliation, restore drill, uncertain external work, migration/cutover runbook. **Owner approval is mandatory regardless of reviewer result.** |
| **C6 — Post-cutover operational acceptance** | **Critical** | **Claude Code + Opus 5 High** | **Codex + GPT-5.6 Sol High** | **Kilo + GLM-5.3 High** | Sole-writer proof, reconciliation, backups/restart, pending attempts, operating evidence on deployed target. |

## Review independence examples

- If **Codex Sol** implemented M1/M6/M8/M10, prefer **Claude Code Opus** for C1/C2/C3/C5.
- If **Claude Code Opus/Sonnet** materially implemented the reviewed Critical seam, prefer **Codex Sol**.
- If Cursor/Grok implemented it, either Sol or Opus is a strong independent primary; GLM can be an additional challenger.
- Do not count the same model in a different UI as meaningful family independence.

## Delegation inside milestones

The primary route does not need to perform every mechanical task itself. Delegate bounded work when contracts are stable:

- fixtures and negative examples;
- repetitive table/schema transformations;
- test scaffolding;
- read-only legacy inventory;
- documentation/evidence updates;
- isolated UI components;
- provider adapter mapping after canonical contracts freeze.

The primary retains architecture decisions, cross-lane integration, Critical persistence/authority changes and final verification.

## Chat continuity

- Use a **fresh implementation chat/session** for each major milestone or independent parallel lane.
- Stay in the same chat for narrow follow-up fixes while context is still useful.
- Use a **fresh reviewer chat/session** at C0-C6.
- M1, M6, M8, M10 and M11 should use `docs/work/ACTIVE_TASK.md` by default because compaction/context loss would be costly.
- M2-M5 parallel lanes should each have explicit branch/worktree ownership and the frozen C0 contract SHA.
