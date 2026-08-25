# AiT LIVE Scenario Backend Readiness

**Status:** In Progress
**Integration branch:** `wave3r/live-scenario-readiness`
**Base checkpoint:** `70447bd3f01d1f3219141216a2b822f2c3edc5d1`

## Objective

Make S1–S8 runnable from a data-driven external scenario runner through
ordinary Northstar application boundaries. Scenario identifiers and all AiT
facts remain fixture/configuration data; `src/**` must not branch on them.

The required pipeline remains:

`state → constraints/dependencies → planning → deterministic viability → policy → authority → execution → observation → state update`

Model Studio and Google Routes LIVE calls are excluded from this work package.
Atlas and Nuitée sandbox preflight calls are permitted only as provider
readiness evidence, never as a replacement for missing internal behaviour.

## Baseline audit — 25 Aug 2026

- The exact requested base is healthy: `node --test` passes **587/587**.
  The global `npm` launcher is broken in this environment, so verification
  uses direct Node/package binaries without modifying project configuration.
- `fixtures/programmes/synthetic-summit/programme.json` already declares 67
  participants: 42 `NORTHSTAR_ARRANGED` and 25 self/local/other. The
  classification comes from explicit data, not location inference.
- The current `ScenarioSpec` is a legacy single-trip, disruption-centred
  fixture contract. It cannot describe runner metadata, multiple targets,
  UI actions, provider provenance, or the non-disruption scenario shapes.
- Existing natural paths provide useful foundations: provider-shaped schedule
  signals, missed-flight reports, event-change preview/commit, NL
  `ChangeRequest`, departure-origin substitution, funding-window allocation,
  and hotel replacement execution.
- The following generic concepts are absent and therefore cannot be claimed
  as executable yet: provider disruption correlation across multiple trips;
  stay occupancy/room requirements; a structured personal increment beyond
  a single dated allocation; cross-traveller travel association; and a
  configured programme transport-concentration constraint.

## Work packages and acceptance

1. **LSR-0 — contract and canonical programme foundation.** Define one
   external scenario-input contract that invokes existing HTTP/application
   APIs without becoming a business engine. Add canonical AiT data with all
   67 participants and validate it through the same programme import path.
2. **LSR-1 — S1/S2/S3.** Add generic multi-trip supplier-effect handling;
   preserve partially executed traveller reports; make event preview compare
   alternatives, remain mutation-free until commit, then fan out correctly.
3. **LSR-2 — S4/S7.** Prove natural NL input through planning and viability,
   including rejection of available-but-unviable transport and generic origin
   substitution.
4. **LSR-3 — S5/S6.** Add only reusable funding, accommodation, occupancy,
   and payer/authority information necessary for personal increments and
   replacement stays. Refund execution remains an explicitly allowed Atlas
   simulation/unsupported seam.
5. **LSR-4 — S8 and generalisation gates.** Add a policy-data-driven
   programme concentration rule and cross-traveller association. Add the
   anti-hardcoding and alternate-data gate, then run the full readiness gate.

## Current issue triage

| Classification | Finding | Action / risk |
|---|---|---|
| Act Now | The inherited scenario bundle cannot orchestrate S1–S8. | Replace it with one additive, scenario-neutral runner contract; otherwise scripts would become a second business engine. |
| Act Now | S5/S6/S8 lack required generic ontology/contracts. | Implement the smallest reusable representations; deferral makes the required scenarios non-runnable. |
| Act Now | Existing documentation still calls S5/S6/S8 Stretch. | This tracker and the linked SSOT updates supersede that historical scope split for this branch. |
| Investigate Now | Initial 30 Sep–2 Oct 2026 provider inventory. | Probe Atlas/Nuitée only after scenario requests are data-complete; lack of inventory may require a documented date recommendation, not a silent fixture change. |
| Park for Later | Production accounting and arbitrary city geocoding. | Explicitly excluded; neither is needed for the generic acceptance concepts. |
| Ignore / Accept Risk | Global `npm` launcher is missing its roaming installation. | Direct Node invocation is a safe bounded recovery. Do not alter project scripts for a host-level defect. |

## Completion gate

This work package is complete only when each S1–S8 input drives the same
canonical programme state and natural application paths; 67/42/25 is
explicit; test/typecheck/lint/build/browser/reset-reseed/secret/anti-hardcoding
checks pass; and no Model Studio or Google Routes LIVE spend occurred.
