# Northstar

**The AI resolution layer for event travel.**

Atlas × Alibaba Cloud Agentic AI Hackathon build.

A trip is not a flat itinerary. It is a live network of bookings, objectives,
policies, constraints, people, and dependencies. When reality changes, Northstar
determines what else becomes invalid, finds whole-trip recovery strategies,
checks authority, executes permitted actions, observes the result, and continues
until the trip is viable again or explicitly escalated.

> A replacement flight is not necessarily a recovered trip.

---

## What it is

Northstar is the hackathon product face of a generalized **trip-resolution
layer** above travel providers. The graph/state model is central; chat and
dashboards are interfaces into operational state, not the source of truth.

For the hackathon we demonstrate one coordinated event-travel programme: an
organiser managing inbound travellers around a shared AnchorEvent (for example,
conference speakers). The same engine is intended to support TMC, corporate,
group, and future traveller products later — differences should be policy,
permissions, scale, and UI, not separate recovery engines.

Northstar begins **after participants are confirmed**. It is not speaker
sourcing, invitations, registration, attendee CRM, agenda authoring, event
ticketing, or general event management. It consumes event context and
coordinates travel around it.

---

## Who it is for

| Surface | Job |
|---|---|
| **Operator / organiser** | Programme readiness, blast radius, recovery options, approvals, duty-of-care |
| **Traveller** | Am I okay? What changed? What do you need from me? |

Judge-facing entry is the populated **Operator Overview**, not a scripted
`/demo` page.

Canonical demo programme (synthetic world content):

- **67** participants total
- **42** Northstar-managed travellers
- **25** local / self-arranged / unmanaged

---

## How it works

Core loop:

```
change → state update → blast radius → recovery strategies
  → deterministic viability → authority → action → observation → resolved state
```

Hard invariant:

```
AI proposal → validation → deterministic viability → authority → executor
  → observe → state update
```

Never `LLM → irreversible / money-moving API`.

| Layer | Owns |
|---|---|
| **AI (Model Studio / Qwen)** | Extraction, semantic interpretation, recovery planning, soft ranking |
| **Deterministic engine** | Schema/business validation, graph mutation, time/timezone/buffers, viability, authority, state transitions |
| **Providers (adapters)** | Flights (Atlas), hotels (Nuitéé / liteAPI), optional ground context (Google Routes) |
| **Persistence** | SQLite behind repository interfaces |

Candidate recoveries live in scenario overlays until observed execution updates
authoritative state. `UNKNOWN` is valid — missing evidence is not converted into
certainty.

Atlas is a **flight adapter**, not the architecture.

---

## Scenarios

Frozen catalogue (source of truth: [`docs/SCENARIOS.md`](docs/SCENARIOS.md)):

| ID | Situation |
|----|-----------|
| **S1** | Airline schedule change affects several travellers; one becomes critical |
| **S2** | Missed connection; airline reprotection is not good enough for the event |
| **S3** | Event-side change — organiser previews programme consequences before commit |
| **S4** | Traveller asks to arrive Thursday morning instead |
| **S5** | “Can I stay until Sunday?” (personal extension / funding window) |
| **S6** | “Can I switch hotels? My partner is joining.” |
| **S7** | Origin change — e.g. Tokyo instead of London; trip topology rebuild |
| **S8** | “Can I travel with the other speakers?” |

Primary hero set for final video intent: **S2 → S1 → S3 → S7 → S5**. S6/S8 remain
capability / breadth evidence. Scenario facts live in fixtures and programme
data — application logic must not branch on scenario IDs or traveller names.

---

## Quickstart

Requires **Node ≥ 24**.

```bash
npm install
npm run dev       # src/main.ts — default http://127.0.0.1:8787
npm test          # contract + foundation + scenario tests
npm run typecheck
npm run lint
npm run build
npm start         # compiled dist/main.js
```

Configuration is optional. Defaults are credential-free **REPLAY** mode. See
[`.env.example`](.env.example) and [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

### Use the product UI

1. Start the app (`npm run dev`).
2. Open the judge/operator entry:
   [`/operator?event=evt-ait-2026`](http://127.0.0.1:8787/operator?event=evt-ait-2026)
3. From Overview: Programme, Decisions, Activity, and per-traveller Cases.
4. Traveller surfaces use `/traveller?trip=<tripId>` (trip IDs come from the
   programme / case views).
5. Use **Reset demo** to wipe and reseed to the authoritative starting world,
   then return to the populated Overview.

Demo facts (event identity, cast, baseline bookings) live in fixtures /
programme content — not in domain branching. See
[`docs/FINAL_DEMO_CONTENT_SSOT.md`](docs/FINAL_DEMO_CONTENT_SSOT.md) and
[`docs/DEMO.md`](docs/DEMO.md).

### Developer runtime API (historical Checkpoint C path)

The same composed application also exposes a scenario-neutral staged HTTP flow
used by tests and early demos:

```
POST /api/runtime/disruption
POST /api/runtime/plan
POST /api/runtime/begin
POST /api/runtime/decide
POST /api/runtime/execute
POST /api/runtime/reset
GET  /api/runtime/state
```

Prefer the operator/traveller UI for human demos. Details:
[`docs/DEMO.md`](docs/DEMO.md).

---

## Integration truth (LIVE / REPLAY / simulated)

Provenance labels used in demos and docs:

| Label | Meaning |
|---|---|
| **LIVE** | Real provider or model call |
| **SANDBOX** | Provider test environment |
| **RECORD** | Captured live/sandbox interaction |
| **REPLAY** | Recorded responses through the same normalizer/engine (default) |
| **SIMULATED** | External-boundary effect with no real provider — disclosed; core engine stays real |

Honest defaults for this build:

- **Atlas flight search** — developed against sandbox; shipped demo path typically **REPLAY**s sanitized provider-shaped recordings through the real normalizer.
- **Atlas order / refund execution** — authority and observation are real; many irreversible provider effects are **simulated at the provider boundary** (Stretch for full live order servicing).
- **Nuitéé hotels** — real adapter wired; REPLAY recordings for routine demos; LIVE when credentials and budget allow.
- **Model Studio / Qwen** — used when configured; otherwise a deterministic fallback planner enumerates strategies from capability evidence and fails closed rather than fabricating recoveries.
- **Google Routes** — optional; absence must not block recovery.

S1–S8 are **SEMANTIC READY** through ordinary product boundaries on REPLAY
acceptance manifests (`docs/LIVE_SCENARIO_READINESS.md`). Credentialed
LIVE/RECORD provider refresh remains a separate evidence track.

---

## Status

Thin status only — capability detail lives in the SSOTs below.

| Era | Outcome |
|---|---|
| Checkpoints **A / B / C** | Accepted — generalized recovery engine + demo-candidate baseline |
| Northstar waves **RV-N0 → NS-G1 / NS-G2** | Accepted contract freeze + programme backend convergence |
| Original **NS-G3** | Not accepted — superseded by stricter Wave 3R / demo-readiness path |
| **AiT scenario backend** | SEMANTIC READY (S1–S8 on REPLAY); LIVE/RECORD still credential-gated |
| **Final demo closure** | **R3D accepted** on `main` (live-product UI convergence); **R3E next** (final UI pass + human production acceptance), then R4 → Final Candidate → freeze → submit |

Current closure runway:
[`docs/FINAL_DEMO_INTEGRATION_PLAN.md`](docs/FINAL_DEMO_INTEGRATION_PLAN.md).

---

## Document map

| Doc | Role |
|---|---|
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Product requirements |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Logical architecture / invariants |
| [`docs/SCENARIOS.md`](docs/SCENARIOS.md) | Frozen S1–S8 catalogue |
| [`docs/DEMO.md`](docs/DEMO.md) | Demo principles + provenance |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Northstar design system |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Capability scope / status |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Parent execution SSOT |
| [`docs/FINAL_DEMO_INTEGRATION_PLAN.md`](docs/FINAL_DEMO_INTEGRATION_PLAN.md) | Active product-closure runway |
| [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) | Configuration |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADRs |
| [`AGENTS.md`](AGENTS.md) | Agent orchestration rules |

Atlas capability research (authoritative for what Atlas supports) lives in the
separate repo `dropandresetmain-prog/atlas-hackathon-lab`. Do not infer
production market behaviour from sandbox data.
