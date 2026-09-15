# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and Sarah vertical slice / product surfaces for C4 candidate. Second scenario is Jordan S2 (progressive individual disruption).

## Accepted base

- Branch: `integration/m7-m8-c3`
- SHA: `f8103379ed2426d442d342895e9e1d1573f875da`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**CHECKPOINT 2 — IN PROGRESS** (CK1 remains closed; not reopened)

WiT/demo product contract frozen at semantics level — generic CK2 work unblocked without waiting for final fixture IDs.

OpenRouter already on branch (`2eeff2a` ancestor) — do not re-merge.

## Discovered runtime topology

| Area | State |
|---|---|
| Target composition | `src/app/target/composeTargetApplication.ts` (PG-only) |
| Strategy / grants / IN-1 / resolution | CK1 complete |
| Read models | CK1 + **CK2 additive** `recoveryActions[]`, partial/duplicate/remaining/cost/connectionProgression |
| Readiness | `PROGRAMME_ARRIVAL_READINESS` rule + `programmeArrivalReadiness` + participation evaluator hook |
| Cohort | `cohortDisruption.evaluateSharedDisruptionCohort` (5 independent outcomes) |
| Swap preview | `programmeTimeSwapPreview` / `commandPreviewBilateralProgrammeTimeSwap` (no auth mutation) |
| Primary scenario | `primaryScenarioFoundation` (shared supplier programme cohort — no hardcoded names) |
| Second scenario | Jordan S2 — `secondScenarioFoundation.ts` |
| wholeTripRecoveryPlan | Multi hotel/flight intents (no single `.find()` collapse) |

## Checklist — Checkpoint 1

- [x] All CK1 items (see prior ledger) — **closed**

## Checklist — Checkpoint 2

- [x] A. Additive generic read-model fields (`recoveryActions[]`, partial, duplicate exposure, …)
- [x] B. Generic 150-min REQUIRED physical-presence readiness (rule/data-driven)
- [x] C. Five-person shared disruption independent evaluation helper
- [x] D. Bilateral programme time-swap preview (no authoritative mutation)
- [x] Fix legacy `wholeTripRecoveryPlan` single-hotel / single-flight assumptions
- [x] Focused CK2 unit tests (`test/m9-checkpoint2-unit.test.ts`)
- [ ] E. Full Sarah backend vertical loop wired to PG runtime + HTTP (generic config; fixture IDs later)
- [ ] F. Replace fixture/provider artifacts when fixture lane delivers
- [ ] G. Final Sarah product surfaces + demo acceptance (Fable direction when supplied)
- [ ] Jordan multi-stay acceptance with Atlas/Nuitée evidence

## Current blocker / pending

**Fixture lane (does not block generic work):** exact provider refs, flight numbers, commitment IDs, hotel rates, Jordan timings.

**Fable visual direction:** backend/read models proceed; final UI styling waits.

**Acceptance tests still needing fixture lane:** end-to-end Sarah §12 with real provider-shaped disruption + exact commitment IDs; Jordan §13 with Atlas/Nuitée stays.

## Next action

1. Continue E: wire target HTTP/read-model assembly + end-to-end loop using scenario/config placeholders (no invented fixture UUIDs).
2. Keep Jordan multi-stay RM path green; defer Jordan fixture acceptance.
3. Do not claim C4 PASS; do not start M10.

## Critical constraints

- No Sarah/Daniel/airport/flight/commitment ID hardcoding in application logic
- No SQLite authority in target runtime
- No LLM → irreversible API
- No Jordan-only status field / graph model
- CK1 not reopened

## Issue triage

| ID | Class | Notes |
|---|---|---|
| ORG-INHERIT | Park for Later | Exact grant match only |
| ISSUER-POL | Investigate Now | Issuer policy table still absent |
| CK2-SARAH-LOOP-E | Act Now | Wire full vertical loop on target runtime |
| CK2-FIXTURE-LANE | Park for Later | Exact IDs/artifacts |
| JORDAN-EVIDENCE | Park for Later | Atlas + Nuitée pending |
| JORDAN-CK2-ADDITIVE-RM | Done (schema+projector) | Assembled from facts; PG assembler still part of E |
| LEGACY-R1-WALLCLOCK | Ignore / Accept Risk | Pre-existing on C3 without OpenRouter |
