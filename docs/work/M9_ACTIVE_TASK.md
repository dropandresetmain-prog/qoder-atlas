# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and Sarah vertical slice / product surfaces for C4 candidate. Second scenario is Jordan S2 (progressive individual disruption).

## Accepted base

- Branch: `integration/m7-m8-c3`
- SHA: `f8103379ed2426d442d342895e9e1d1573f875da`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**CHECKPOINT 2 — GENERIC COMPLETE — C4 CANDIDATE (fixture/Fable/Jordan Atlas evidence still external)**

CK1 remains closed; not reopened.
OpenRouter already on branch (`2eeff2a` ancestor) — do not re-merge.

## Discovered runtime topology

| Area | State |
|---|---|
| Target composition | `src/app/target/composeTargetApplication.ts` (PG-only) |
| Opt-in HTTP mount | `NORTHSTAR_ENABLE_TARGET_V2=1` + `PG_TARGET_WORKSPACE_ID` → `compose.ts` attaches `/api/v2/*` |
| Strategy / grants / IN-1 / resolution | CK1 complete |
| Read models | CK2 additive `recoveryActions[]`, partial/duplicate/remaining/cost/connectionProgression |
| PG assemblers | strategies, actions, operator overview, incident/programme, traveller trip |
| Readiness | `PROGRAMME_ARRIVAL_READINESS` + participation evaluator |
| Cohort | `cohortDisruption.evaluateSharedDisruptionCohort` |
| Swap preview | non-authoritative bilateral programme time-swap |
| Primary scenario | `primaryScenarioFoundation` + vertical loop + PG programme loop proof |
| Second scenario | Jordan S2 generic multi-action / multi-stay (fixture E2E pending) |

## Checklist — Checkpoint 1

- [x] All CK1 items — **closed**

## Checklist — Checkpoint 2

- [x] A. Additive generic read-model fields
- [x] B. Generic 150-min REQUIRED physical-presence readiness
- [x] C. Five-person shared disruption independent evaluation
- [x] D. Bilateral programme time-swap preview (no authoritative mutation)
- [x] Fix legacy `wholeTripRecoveryPlan` single-hotel / single-flight assumptions
- [x] E. Sarah backend vertical loop + PG assemblers + `/api/v2` product routes (generic; fixture IDs later)
- [x] G. Product surfaces (structural DESIGN.md baseline; Fable polish deferred)
- [x] Jordan generic multi-action / multi-stay / progression / partial recovery
- [ ] F. Replace fixture/provider artifacts when fixture lane delivers
- [ ] Jordan multi-stay acceptance with Atlas/Nuitée evidence
- [ ] Fable visual refinement (if supplied)

## Current blocker / pending (external only)

**Fixture lane:** exact provider refs, flight numbers, commitment IDs, hotel rates, Jordan timings.
**Fable visual direction:** functional surfaces done; styling delta when Fable arrives.
**Acceptance still needing fixture lane:** Sarah §12 provider-shaped E2E IDs; Jordan §13 Atlas/Nuitée stays.

## Next action

1. Independent C4 review on pushed candidate SHA (do not claim C4 PASS here).
2. When fixture lane delivers: data-only fixture/config updates.
3. Do not start M10.

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
| CK2-FIXTURE-LANE | Park for Later | Exact IDs/artifacts |
| JORDAN-EVIDENCE | Park for Later | Atlas + Nuitée pending |
| FABLE-POLISH | Park for Later | Visual refinement only |
| LEGACY-R1-WALLCLOCK | Ignore / Accept Risk | Pre-existing on C3 without OpenRouter |
| PG-ASSESS-SERIAL | Accept Risk | Sequential assessment saves + retry; run M9 PG with concurrency=1 |
