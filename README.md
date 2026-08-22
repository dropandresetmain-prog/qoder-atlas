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

## Atlas source of truth

Atlas capability research lives in the separate repository `dropandresetmain-prog/atlas-hackathon-lab`.

Use these documents as authoritative when deciding what Atlas supports:

- `docs/ATLAS_FINAL_CAPABILITY_REPORT.md`
- `docs/ATLAS_CAPABILITY_MATRIX.md`
- `docs/SKILL_VS_API.md`
- `docs/SANDBOX_COVERAGE_MATRIX.md` only for fixture coverage

Do not infer production market behaviour from sandbox data.

## Status

**Checkpoint A/B/C accepted. Checkpoint C (`3b2f0da`, generalisation + reliability + demo-ready runtime flow) passed Review Gate C after its review-fix set and is the accepted demo candidate / baseline. Reality Validation (externally sourced inputs) is the next milestone; final candidate preparation has not started.**

What exists today:

- runnable TypeScript/Node ≥ 24 application (starts with zero credentials in REPLAY mode)
- full vertical recovery loop: ingestion → persistent trip graph → signal/impact → planner/capabilities/deterministic viability → authority → execution → observation → verification (`src/engine/`, `src/app/`, `src/intelligence/`)
- two materially different scenarios through the same application code: anchor-event/organiser (`fixtures/scenarios/anchor-event-speaker`) and corporate TMC (`fixtures/scenarios/corporate-tmc`), plus selected robustness cases (hotel no-show cutoff, transit cutoff with on-demand taxi, accessibility, already-lost objective)
- deterministic runtime recovery/reset flow over HTTP: `POST /api/runtime/{disruption,plan,begin,decide,execute,reset}` + `GET /api/runtime/state` (scenario-neutral; every stage takes a caller-supplied instant; reset reseed is audited and transactional — no manual database surgery)
- SQLite persistence behind repository interfaces; LIVE/RECORD/REPLAY external adapters sharing one normalizer
- credential-free recovery planning: Model Studio planner is used only when configured; otherwise a deterministic fallback planner produces strategies from replayed capability results

## Integration truth (LIVE / REPLAY / simulated)

- **Atlas flight search**: LIVE-developed against the sandbox environment; the shipped default demo path replays sanitized, provider-shaped recordings through the same normalizer (REPLAY). Recordings are hash-keyed by `provider|operation|request`.
- **Atlas order execution**: the execution boundary applies deterministic authority and guardrails, but order effects are **simulated at the provider boundary** (recorded/synthetic provider effects fed through the real observation/verification pipeline). Real `order.do` execution is stretch scope.
- **Alibaba Cloud Model Studio**: structured extraction/planning when credentials are configured (LIVE); otherwise the deterministic fallback planner is used. The replay path never requires Model Studio credentials.
- **Google Routes**: optional dynamic ground-context adapter; absent or unconfigured, ground legs use sourced/unknown fallbacks and never block recovery.

See [PRODUCT_SPEC](docs/PRODUCT_SPEC.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md), [DEMO](docs/DEMO.md), and [ROADMAP](docs/ROADMAP.md).

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
