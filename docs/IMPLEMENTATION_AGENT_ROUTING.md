# Northstar implementation agent routing

Companion to [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md) and [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md).

This file gives **three viable model + harness routes** for the current post-C5 delivery stages and the independent review gates that actually warrant a reviewer. It does not change milestone scope, architecture, acceptance criteria or checkpoint authority.

Last routing reconciliation: **2026-09-17**.

The historical M0-M11/C0-C6 routing has completed its job and remains available in Git history. Current work follows this file plus `IMPLEMENTATION_PLAN.md` §22.

## Core routing rules

Choose in this order:

`role -> harness capability -> task shape/risk -> independence -> effort`

Three listed routes are **alternatives**. Choose one. Do not execute all three.

Use the least costly/slow route that can safely complete and verify the task. Model prestige is not a routing rule. Runtime/DB/browser/provider evidence outranks model confidence.

Review remains uncertainty-driven:

- Bounded/Normal work does not get an independent reviewer by default.
- Complex work gets one only for material uncertainty/cross-contract risk/expensive seams.
- Critical work usually justifies one independent reviewer plus execution evidence when that materially reduces risk.
- A reviewer-requested fix gets targeted closure evidence; it does not automatically restart a full review cycle.
- Promotion/cutover is an evidence gate, not another AI committee.

## Current implementation / planning routes

| Stage | Task class | Route 1 | Route 2 | Route 3 | Why |
|---|---|---|---|---|---|
| **T2 targeted remediation** | Critical seam / Hard Bounded | **Qoder + Qwen3.8-Max** | **Codex + GPT-5.6 Luna xHigh** | **Cursor + Grok 4.6 High** | Existing Qoder branch/context is valuable; fixes are bounded but cover crash/retry/idempotency and M6 semantics. |
| **T3 — incident-scoped case orchestration** | Hard Bounded | **Codex + GPT-5.6 Luna xHigh** | **Qoder + Qwen3.8-Flash** | **Cursor + Composer 2.5** | Destination and acceptance are now explicit: one incident-scoped case + real subject/signal command seam. |
| **T4 — Case View + V5.6** | Normal / Hard Bounded UI-integration | **Cursor + Composer 2.5** | **Cursor + Auto Balance** | **Codex + GPT-5.6 Luna High** | Fast UI/read-model/browser iteration matters more than architecture discovery. |
| **Slice B — Sarah full E2E** | Complex integration with Critical seams | **Cursor + Grok 4.6 High / Auto Intelligence** | **Codex + GPT-5.6 Terra High** | **Qoder + Qwen3.8-Max** | Crosses target capability composition, Qwen proposal, deterministic viability, authority, execution, observation and resolution. Keep one primary integrator. |
| **Jordan generalized E2E** | Complex provider/integration | **Cursor + Grok 4.6 High** | **Codex + GPT-5.6 Terra High** | **Claude Code + Sonnet High** | Provider-heavy generalisation with live Atlas read-side evidence and external reconciliation questions. |
| **Astra reconciliation — planning only** | Complex/Critical planning synthesis | **GPT-6 Astra Medium/High via a supported planning harness** | **ChatGPT + GPT-5.6 Sol High** | **Claude + Opus High** | Reconcile empirical requirements after Sarah/Jordan; do not spend Astra on normal implementation. |
| **Observability milestone** | Normal/Complex cross-read-model product work | **Cursor + Composer 2.5 / Auto Intelligence as scope requires** | **Codex + GPT-5.6 Luna xHigh** | **Qoder + Qwen3.8-Max** | Semantic activity projection + Case/Activity/Overview surfaces; backend contract should already be frozen. |
| **Accepted Event Overview implementation** | Normal visual/read-model integration | **Cursor + Composer 2.5** | **Cursor + Auto Balance** | **Codex + GPT-5.6 Luna High** | Visual iteration and browser feedback dominate; no need for premium architecture model after contract freeze. |
| **M11 / final hardening** | Critical operationally / runbook-driven | **Cursor + Auto Balance + owner-run runbook** | **Codex + GPT-5.6 Luna High + owner-run runbook** | **Claude Code + Sonnet High + owner-run runbook** | Exact runbook/evidence/rollback discipline matters more than open-ended reasoning. Human owner authorises consequential activation. |

### Delegation inside current stages

When contracts are frozen, delegate bounded work cheaply and verify deterministically:

- **Luna Medium/High, GLM-5.3-Flash, Qwen3.8-Flash, Cursor Auto Cost** for fixtures, isolated tests, docs and straightforward adapters;
- **Nemotron 3.5 Lightning** for non-sensitive extraction/transformation with deterministic verification;
- **Composer 2.5** for ordinary UI/API slices and fast refactors.

Keep architecture, integration decisions, Critical changes and final verification with the primary model/agent.

## Current independent review gates

These are the planned review boundaries. Do **not** add a reviewer after every implementation checkpoint.

| Review point | Default need | Route 1 | Route 2 | Route 3 | Focus |
|---|---|---|---|---|---|
| **T2 targeted re-review** | **Required now** because the first review proved Critical defects | **Claude Code + Opus High** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Kilo/OpenRouter + GLM-5.3** where provider/privacy/tool route is acceptable | Recheck F1-F7 fixes, crash/retry evidence, M6 cancelled-line semantics and directly affected behavior only. Do not reopen T1. |
| **Slice A integrated review** | **Yes, once after T3 + T4 converge** | **ChatGPT + GPT-5.6 Terra High** | **Kilo/OpenRouter + GLM-5.3** | **Claude Code + Sonnet High** | Whole path: disruption -> canonical state -> affected scope -> reassessment -> one case -> authoritative Case/V5.6 -> reload. |
| **Slice B major review** | **Yes — highest-risk recovery boundary** | **Claude Code + Opus High** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Kilo/OpenRouter + GLM-5.3** when adequate for the exact question | No LLM/action bypass; stale authority; execution/idempotency; observation/reconciliation; provider success != recovered. |
| **Jordan generalisation review** | **Yes, focused** | **ChatGPT + GPT-5.6 Terra High** | **Kilo/OpenRouter + GLM-5.3** | **Qoder + Qwen3.8-Max** | Same engine/code, anti-hardcoding, shared-world continuity, provider-specific logic stays in adapters. |
| **Final candidate review** | **Yes, one exact-candidate release review** | **ChatGPT/Codex + GPT-5.6 Sol High** | **Claude Code + Opus High** | **Kilo/OpenRouter + GLM-5.3** for non-destructive rehearsal/static/runtime audit where adequate | Exact SHA, deployment/readiness, LIVE/REPLAY truth, demo fallback, M11 evidence, final CURRENT gate and submission claims. |

No automatic independent reviewer after:

- T3 alone;
- T4 alone;
- each internal Slice B checkpoint;
- Observability;
- Event Overview visual implementation;
- ordinary post-E2E polish.

Escalate only if a concrete Critical/ambiguous seam appears.

## Slice B is one milestone, not six model assignments

Slice B may internally sequence:

```text
target capability composition
-> harmless LIVE Qwen/Atlas smoke
-> target-native Qwen proposal/read-only research
-> deterministic viability
-> strategy/ActionPlan + authority
-> programme execution
-> observation/reassessment/resolution
```

Do not dispatch those as six independent architecture lanes. The primary integrator owns the shared composition/orchestration path. Delegate only bounded sub-parts after interfaces are frozen.

## Astra budget rule

The planned Astra use is **one post-E2E planning pass**, after Sarah and Jordan have taught us what the real integration requirements are.

Astra should:

- inspect current code/docs/recent implementation evidence;
- reconcile architecture-readiness findings, E2E findings, Railway, observability, accepted Overview and M11/final requirements;
- classify each Act Now / Investigate Now / Park for Later / Ignore-Accept Risk;
- produce a dependency-aware implementation plan through 30 Sep;
- preserve the working Sarah/Jordan vertical loop.

Astra is not required to implement that plan. Save credits for the synthesis/architecture value it uniquely provides.

## Visual prototyping / Fable

Fable is not currently part of `MODELS_ARSENAL.md`, so it is not a formal implementation/review route here.

If available, it can still be used as a **visual prototyping surface** after semantic/backend contracts are frozen, especially for:

- Case timeline + graph interaction;
- Overview edge-to-edge visual + activity below;
- Activity journal information hierarchy.

Fable output does not establish backend truth, architecture acceptance or execution evidence. Production implementation remains with a repo-capable coding harness.

## Long-horizon / chat continuity

- Use a fresh implementation session for each major milestone or independent parallel lane.
- Stay in the same implementation session for narrow reviewer-requested fixes while context remains useful.
- Use a fresh reviewer session only at the review gates above.
- Slice B/Jordan/Observability should use `docs/work/ACTIVE_TASK.md` if expected to exceed a normal coding session.
- M11 should use a short explicit runbook/checklist rather than an open-ended coding chat.

## Premium budget expectation

Premium models are escalation, not a seriousness tax.

Expected high-value uses from here:

- current **Opus** T2 review/re-review because it already found real Critical defects;
- one **Opus/Sol-class** Slice B review where the AI/authority/execution boundary justifies it;
- one **Astra** post-E2E planning synthesis;
- optional **Sol/Opus** final candidate review depending on actual unresolved risk.

Do not run both Sol and Opus at every gate simply because both exist.

## Evidence rule

No model route replaces required evidence:

- focused tests for changed behavior;
- real PostgreSQL checks for persistence/concurrency/idempotency;
- browser checks for UI behavior;
- LIVE provider smoke where LIVE capability is claimed;
- exact candidate Railway/restart evidence;
- owner-run acceptance at Founder Test A/B and operational activation.
