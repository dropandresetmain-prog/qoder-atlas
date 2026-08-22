# Reality Validation — Investigation Overview

**Milestone:** Reality Validation (investigation phase only — no product implementation).
**Base:** `6d203960a2948ac81e128a9483cb189323f7c018` (Checkpoint C closeout, `origin/main`).
**Integration branch:** `investigation/reality-validation` — every lane report lands here.

Checkpoint C proved the generalized recovery engine against curated/provider-shaped scenarios.
Reality Validation must determine how to honestly prove the broader claim:

> Give the system real-world trip inputs and external provider state, and the same engine can resolve the trip.

## Questions this milestone answers

1. Can arbitrary external trip sources become a usable Trip without hand-authoring ScenarioSpec?
2. Which external trip components can use real or sandbox provider APIs?
3. Which should remain RECORD/REPLAY?
4. Which must remain simulated, and why?
5. Which architecture contracts must change?
6. Which tough, realistic scenarios best prove the product?
7. Can traveller-initiated changes use the SAME resolution engine as external disruption?

## Realism principle (preference order)

1. real external source / real read API where safe and cheap;
2. provider sandbox/test API for consequential actions;
3. RECORD from that real/sandbox provider response, REPLAY through identical normalization;
4. external-boundary simulation only when provider access/complexity is not worth the cost.

Core internal logic is NEVER mocked. Mocks/simulation may exist only at unavailable external provider boundaries.

## Reports

| # | File | Investigation |
|---|------|---------------|
| 01 | `01_ATLAS_SANDBOX_REALITY.md` | What Atlas can actually do in the hackathon account; Singapore feasibility |
| 02 | `02_HOTEL_PROVIDER_DECISION.md` | Hotel provider strategy: hackathon feasibility + credible TMC path |
| 03 | `03_GROUND_ROUTING_AND_TRANSPORT.md` | Google Routes LIVE economics/guardrails; transactional ground transfer |
| 04 | `04_REAL_SOURCE_INGESTION.md` | Real-source/URL ingestion audit vs actual external sources; security |
| 05 | `05_TRIP_ASSEMBLY.md` | Raw unseen sources -> usable Trip; minimum assembly process |
| 06 | `06_DYNAMIC_CONTEXT_AND_RESEARCH.md` | Context sources; authoritative vs estimate vs soft |
| 07 | `07_MODEL_STUDIO_REALITY.md` | Extraction/planning reliability on unseen sources; model-tier recommendations |
| 08 | `08_TRAVELLER_INITIATED_CHANGE.md` | Traveller-requested change entering the same engine |
| 09 | `09_DISRUPTION_SIGNAL_SOURCES.md` | How disruption enters from the real world; real vs injected |
| 10 | `10_SCENARIO_RESEARCH.md` | 8–12 candidate scenarios + Scenario 0/1 families + scoring |
| 11 | `11_REALITY_VALIDATION_SYNTHESIS.md` | Integrated decision package (primary investigator) |

## Lane branches

Each lane branches from the exact base SHA and lands ONE report-only commit:

`rv/atlas-investigation`, `rv/hotel-investigation`, `rv/ground-investigation`,
`rv/source-ingestion-investigation`, `rv/trip-assembly-investigation`,
`rv/context-investigation`, `rv/model-studio-investigation`,
`rv/traveller-change-investigation`, `rv/disruption-sources-investigation`,
`rv/scenario-investigation`.

The primary investigator cherry-picks report commits into `investigation/reality-validation`,
resolves conflicts centrally, then writes the synthesis.

Note: the preferred Windows worktree (`C:\Dev\qoder-atlas-reality-validation`) is not available
in this Linux task sandbox; equivalent isolation uses git worktrees under `/data/worktrees/rv-*`.

## Shared evidence standard (all reports)

Evidence levels — never collapsed:

- `DOCUMENTED` — provider/official documentation says so;
- `OBSERVED_SANDBOX` — we actually called a sandbox/test surface;
- `OBSERVED_LIVE_READ` — we actually called a live read-only surface;
- `INFERRED` — reasoned from evidence, labelled;
- `UNKNOWN` — not resolved.

A documentation page is not proof our account can call an endpoint. A successful call is stronger
than a fixture. A sandbox response is not production market evidence. Do not oversell.

Capability classifications (Atlas and provider surfaces):

`PROVEN_SANDBOX | DOCUMENTED_NOT_PROVEN | ACCESS_BLOCKED | NOT_SUPPORTED | NOT_WORTH_IMPLEMENTING`

Final reality decision per component — exactly one of:

`USE_LIVE | USE_SANDBOX | RECORD_AND_REPLAY | SIMULATE_PROVIDER_BOUNDARY | DEFER | REJECT`

Finding triage (every finding gets one):

`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`

## Sandbox environment facts (established by the primary investigator)

- Network access: available.
- Provider credentials: **none present** (no Atlas client id/secret, no Model Studio API key,
  no Google Routes key, no `.env`). Live/sandbox API probing is therefore ACCESS_BLOCKED in this
  sandbox unless a surface is credential-free; reports must state this honestly and provide the
  exact probe plan to run when credentials are available.
- Atlas authoritative research: `/tmp/atlas-hackathon-lab/docs/` (reference-only clone of
  `dropandresetmain-prog/atlas-hackathon-lab`).
- Product repository (read-only reference for investigators): `/data/workspace/qoder-atlas`.

## Boundaries

- Research, docs, and safe read-only probes only. **No product implementation.**
- No secrets in reports or commits; sanitize all captured evidence.
- Architecture DELTAS are proposed in reports, never implemented here.
