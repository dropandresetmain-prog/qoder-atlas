# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and (later) Sarah vertical slice / product surfaces for C4 candidate.

## Accepted base

- Branch: `integration/m7-m8-c3`
- SHA: `f8103379ed2426d442d342895e9e1d1573f875da`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**CHECKPOINT 1 — COMPLETE**

Next: Checkpoint 2 blocked on Sarah/product handoff.

## Discovered runtime topology

| Area | State after CK1 |
|---|---|
| Target composition | `src/app/target/composeTargetApplication.ts` (PG-only) |
| Legacy SQLite | Still at `src/app/compose.ts` — not used by target app |
| Strategy persist | `m7StrategyCommands.persistRecoveryStrategy` |
| R-10 grants | `grantIssuance.issueRequiredAuthorityGrant` |
| IN-1 | `replanIdentity.ts` + migration `0120` |
| Resolution | `recoveryCaseResolution` + `m9CaseResolutionCommands` |
| Read models / LDG | `src/app/target/readmodels/*` + product contracts |
| Demo ingress | `acceptProviderShapedDemoEvent` (signal-path handoff) |
| Second scenario | `secondScenarioFoundation.ts` |

## Checklist — Checkpoint 1

- [x] Target PostgreSQL application composition (no SQLite fallback flag)
- [x] Real RecoveryStrategy persistence command + evidence fields
- [x] R-10 practical grant issuance via real commands
- [x] IN-1 re-plan identity rules frozen + tested
- [x] Objective disposition cannot bypass authority
- [x] Deterministic RecoveryCase resolution gate
- [x] Typed read models + LDG + change-awareness
- [x] Application commands + demo ingress + second-scenario foundation
- [x] Focused unit + PG tests green
- [x] Checkpoint 1 commit + push (`a641da0`)

## Current blocker

**Checkpoint 2:** waiting for Sarah/product handoff (baseline flight, disruption timing, programme schedule, second speaker, Fable visual direction).

## Next action

1. Commit + push Checkpoint 1.
2. STOP until product-lane handoff is available.
3. Then Checkpoint 2: Sarah fixture data → backend vertical loop → product surfaces.

## Critical constraints

- No Sarah-specific application logic
- No inventing Sarah flight/programme/visual facts
- No SQLite authority in target runtime
- No LLM → irreversible API

## Issue triage

| ID | Class | Notes |
|---|---|---|
| ORG-INHERIT | Park for Later | Exact match only |
| ISSUER-POL | Investigate Now | Issuer policy table still absent |
| CK2-HANDOFF | Park for Later | Product workstream |
