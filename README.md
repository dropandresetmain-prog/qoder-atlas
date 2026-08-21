# AI Trip Recovery / Resolution Layer

Atlas × Alibaba Cloud Agentic AI Hackathon project.

A trip is not a flat itinerary. It is a live network of bookings, objectives, policies, constraints, people and dependencies. When reality changes, this system determines what else becomes invalid, finds whole-trip recovery strategies, checks authority, executes permitted actions, observes the result and continues until the trip is viable again or explicitly escalated.

> A replacement flight is not necessarily a recovered trip.

## Product thesis

Traditional travel search answers “what flight or hotel can I book?” A competent travel agent can often resolve a single disruption manually. A general chatbot can reason conversationally but does not maintain authoritative operational state or safely execute consequential actions.

This product is a **trip-resolution layer** above travel providers. The graph/state model is central; chat is only one interface.

Core loop:

`change -> state update -> blast radius -> recovery strategies -> deterministic viability -> authority -> action -> observation -> resolved state`

## Intended users

One engine supports multiple B2B2C operators:

- TMC servicing teams
- corporate HR / travel teams / EAs
- event organisers managing invited travellers
- group travel leaders
- future direct corporate or traveller products

Differences should primarily be policy, permissions, approvals, scale and UI, not separate recovery engines.

## Hackathon architecture

The system combines:

- a persistent trip dependency / viability graph
- deterministic constraint and blast-radius evaluation
- Alibaba Cloud Model Studio/Qwen for extraction, semantic interpretation and recovery planning
- Atlas direct APIs as the hackathon flight capability adapter
- Google Routes for dynamic local transport context when configured
- generic webpage/document/email/manual ingestion
- deterministic authority and execution guardrails
- SQLite persistence
- LIVE / RECORD / REPLAY external adapters where practical

See [PRODUCT_SPEC](docs/PRODUCT_SPEC.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md), and [ROADMAP](docs/ROADMAP.md).

## Atlas source of truth

Atlas capability research lives in the separate repository `dropandresetmain-prog/atlas-hackathon-lab`.

Use these documents as authoritative when deciding what Atlas supports:

- `docs/ATLAS_FINAL_CAPABILITY_REPORT.md`
- `docs/ATLAS_CAPABILITY_MATRIX.md`
- `docs/SKILL_VS_API.md`
- `docs/SANDBOX_COVERAGE_MATRIX.md` only for fixture coverage

Do not infer production market behaviour from sandbox data.

## Status

**Checkpoint A (foundation + frozen contracts) implemented, pending formal acceptance.**

What exists today:

- runnable TypeScript/Node ≥ 24 application skeleton (starts with zero credentials in REPLAY mode)
- executable domain + operational contracts with Zod runtime validation (`src/domain/`, `src/operational/`)
- frozen shared seams: repositories, provider-neutral capabilities, capability result envelopes, application service boundaries, planner input/output, operator/traveller read models (`src/contracts/`)
- two materially different acceptance scenarios (`fixtures/scenarios/anchor-event-speaker`, `fixtures/scenarios/corporate-tmc`) loading through the same contracts
- SQLite persistence skeleton behind repository interfaces, LIVE/RECORD/REPLAY adapter modes

Downstream implementation lanes (core engine, ingestion, providers, intelligence, UI) start after Checkpoint A acceptance.

## Quickstart

```bash
npm install
npm test          # contract + foundation + scenario tests
npm run typecheck # tsc, no emit
npm run lint      # eslint
npm run build     # tsc -> dist/
npm run dev       # run src/main.ts directly (Node type stripping)
npm start         # run compiled dist/main.js (after build)
```

Configuration is optional; see `.env.example` and `docs/ENVIRONMENT.md`. The default mode is `REPLAY` with no external credentials required.
