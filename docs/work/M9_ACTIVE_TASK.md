# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and (later) Sarah vertical slice / product surfaces for C4 candidate. Second scenario is Jordan S2 (progressive individual disruption).

## Accepted base

- Branch: `integration/m7-m8-c3`
- SHA: `f8103379ed2426d442d342895e9e1d1573f875da`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**CHECKPOINT 1 — COMPLETE** (not reopened)

Jordan S2 product-contract addendum applied: second scenario superseded; CK1 contracts audited compatible.

OpenRouter lane (`feature/openrouter-provider-neutral` @ `2eeff2a`) merged early into M9 (touches `compose.ts`/`config.ts`).

Next: Checkpoint 2 blocked on **Sarah** product handoff (Jordan evidence does not unblock Sarah).

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
| Second scenario | **Jordan S2** — `secondScenarioFoundation.ts` |

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
- [x] Jordan S2 addendum: compatibility audit (no CK1 reopen)

## Current blocker

**Checkpoint 2 (Sarah):** waiting for Sarah/product handoff (baseline flight, disruption timing, programme schedule, second speaker, Fable visual direction).

**Jordan fixtures:** waiting for Atlas + Nuitée evidence (does not unblock Sarah).

## Next action

1. STOP until Sarah product-lane handoff is available.
2. Checkpoint 2 start: land recorded additive generic read-model fields (multi-action / partial recovery), then Sarah vertical loop.
3. After Sarah backend/UI path + Jordan evidence: Jordan acceptance via same runtime (no Sarah-level polish).

## Critical constraints

- No Sarah-specific application logic
- No inventing Sarah or Jordan flight/hotel/timing facts
- No SQLite authority in target runtime
- No LLM → irreversible API
- No Jordan-only status field / graph model

## Issue triage

| ID | Class | Notes |
|---|---|---|
| ORG-INHERIT | Park for Later | Exact match only |
| ISSUER-POL | Investigate Now | Issuer policy table still absent |
| CK2-SARAH-HANDOFF | Park for Later | Blocks polished CK2 |
| JORDAN-EVIDENCE | Park for Later | Atlas + Nuitée pending; do not invent fixtures |
| JORDAN-CK2-ADDITIVE-RM | Act Now at CK2 start | Multi-action / partial-recovery fields recorded; implement when CK2 begins |
| LEGACY-R1-WALLCLOCK | Ignore / Accept Risk (for OpenRouter) | `integration.r1` determinism fails via wall-clock `observedAt` on C3 **without** OpenRouter; not an OpenRouter regression (A-10) |
