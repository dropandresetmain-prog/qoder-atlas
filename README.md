# Northstar

**AI Travel Resolution Engine**

Northstar maintains a Live Dependency Graph of a traveller's journey, objectives,
constraints and shared context. When a flight, hotel, programme or traveller
instruction changes, it works out what is actually at risk, proposes a recovery,
checks it deterministically, obtains the required authority, executes only what is
permitted, and reconciles the observed result.

> A replacement flight is not necessarily a recovered trip.

## The Live Dependency Graph

Northstar's graph is a persistent domain/state model, not a graph database. SQLite
stores typed aggregates; explicit relationships and typed fields express the
dependencies that matter operationally.

```text
Organisation ── policy / authority ──┐
Traveller ── preferences ── Trip ── Transport · Stay · Engagement
                                    │                 │
AnchorEvent ── shared commitments ──┴── objectives / constraints / sources
```

The demo seeds programme and scenario fixtures through the same validated mutation
path used at runtime. It includes provider-shaped flight and hotel observations,
programme commitments, traveller instructions, policy, sourced transfer context,
and—where a case needs it—dated FX evidence. Those facts are clearly marked as
REPLAY, fixture, manually supplied, or model-extracted. It does not pretend that
every source is live.

A production deployment would additionally connect airline/TMC feeds, booking and
servicing systems, hotel and ground-transport suppliers, calendars/event systems,
traveller and policy systems, expense/FX sources, and approved authoritative entry
sources. Those are future integration directions, not current product claims. See
[the architecture](docs/ARCHITECTURE.md) for the exact boundary.

## How resolution works

```text
change → state update → dependency propagation → blast radius → recovery strategies
       → deterministic viability → policy + authority → execution → observation
       → state reconciliation
```

Candidate strategies are scenario overlays: proposed mutations evaluated against the
authoritative state. A candidate never becomes truth merely because a model proposed
it. Only an observed successful action updates the trip.

## Architecture and safety

AI can interpret supplied unstructured inputs, identify uncertainty, extract into
schemas, reason about consequences, infer soft preferences, and generate or compare
strategies. Deterministic code owns validation, time and currency arithmetic,
constraint evaluation, propagation, policy thresholds, permissions, viability and
state transitions.

```text
AI proposal → validation → deterministic viability → authority → executor
            → observation → state mutation
```

No LLM directly invokes an irreversible or money-moving action.

## What the demo exercises

- Supplier disruption and missed-connection recovery, including multi-step overnight
  recovery and authority stops.
- Traveller-requested flight, hotel, origin and shared-travel changes.
- Organiser programme changes fanned out to linked traveller commitments.
- Policy, approval, funding and FX-normalisation paths.

The named hero workflows are driven by acceptance manifests through real application
endpoints; the demo UI exposes them in the operator panel. The fixtures deliberately
include both provider-shaped recordings and seeded context so the demo is reliable
without credentials.

## Technology and provider inventory

| Area | Current implementation | Important boundary |
|---|---|---|
| Runtime | TypeScript, Node.js ≥24, Node HTTP server, Zod | Single package; no web framework. |
| Persistence | SQLite behind repositories | A persistent volume is required when deployed. |
| AI | Alibaba Cloud Model Studio / Qwen | LIVE when configured; schema-gated fallback in default REPLAY. |
| Flights | Atlas adapter | Sandbox-constrained transactions; provider-neutral domain. |
| Hotels | Nuitée / liteAPI adapter | Date changes are cancel-and-rebook, not in-place modification. |
| Ground context | Google Routes adapter | Optional; safely falls back to sourced/deterministic context. |
| FX | Frankfurter / ECB reference rates | Evidence for comparison, not a payment FX service. |
| Deployment | Railway configuration | Operational deployment evidence, not a product integration. |

Atlas search, verification, fare rules, order lifecycle and supported cancellation
flows have provider seams and sanitized recordings. The shipped demo defaults to
REPLAY. Refund execution remains unsupported/simulated by the sandbox. Nuitée covers
search, quote/prebook, booking, retrieval, stay context and cancellation. Google
Routes is wired but its live query path remains incomplete. Full statuses and
limitations are in [Capabilities and limitations](docs/CAPABILITIES_AND_LIMITATIONS.md).

## LIVE / RECORD / REPLAY

Northstar uses one provider-normalisation path in every mode:

- **LIVE:** provider call → normalization → Northstar.
- **RECORD:** provider call → sanitized provider-shaped recording → same normalization → Northstar.
- **REPLAY:** recording → same normalization → same engine.

REPLAY is not a fake second implementation. It makes the submitted demo
reproducible, credential-free and resilient to provider downtime while retaining
real provider shapes at the system boundary.

## Run locally

Requires Node.js 24 or later.

```bash
npm install
npm run dev
```

The default configuration is `REPLAY`, with a local SQLite database and no provider
credentials required. Open `http://localhost:8787`. The operator surface includes
the demo workflow controls; traveller, programme and decisions views are linked from
the application. `npm run build` followed by `npm start` runs the compiled build.

Optional configuration is documented in [Environment](docs/ENVIRONMENT.md). Do not
commit `.env` files or provider credentials.

## Test and verify

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run gate:anti-hardcoding
npm run acceptance:preflight
npm run acceptance:secret-scan
```

Tests cover contracts, deterministic evaluators, persistence, provider adapters,
REPLAY normalization, scenarios and integrated recovery paths. See
[Testing](docs/TESTING.md).

## Repository guide

- `src/domain`, `src/engine` — the model, graph semantics and deterministic recovery core.
- `src/providers` — provider-specific adapters and recording support.
- `src/intelligence` — schema-bound Model Studio/Qwen integration and fallback planning.
- `src/app`, `src/server`, `src/ui` — orchestration and operator/traveller interfaces.
- `fixtures` — versioned scenarios and sanitized provider recordings.
- `video-production` — runnable browser-generated motion source, not rendered media.

Read [Architecture](docs/ARCHITECTURE.md),
[Capabilities and limitations](docs/CAPABILITIES_AND_LIMITATIONS.md),
[Build with Qoder](docs/BUILD_WITH_QODER.md), and
[Motion design](docs/MOTION_DESIGN.md) for the technical detail.

Built for the Atlas × Alibaba Cloud Agentic AI Hackathon with Qoder as the primary
agentic-development environment.

> A booking gets you a ticket. Northstar gets you there.
