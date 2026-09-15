# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and Sarah + Jordan fixture-backed acceptance for C4 candidate.

## Accepted base

- C3: `integration/m7-m8-c3` @ `f8103379ed2426d442d342895e9e1d1573f875da`
- Pre-integration M9 C4-candidate: `6e6dbfdb32b02dd248b96f2ac9119907e395db48`
- Seed lane integrated: `lane/wit-demo-programme-seed` @ `2a14c515839c3764cead2782d6000c8066c36dd1`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**FIXTURE LANE INTEGRATED — C4 CANDIDATE READY** (Fable polish still deferred)

## Provenance (demo truth)

| Corridor | Provenance |
|---|---|
| Sarah Batik ID7159→ID7153 | **ORGANISER_SUPPLIED_SYNTHETIC** + **SIMULATED_EXTERNAL_EVENT** — not Atlas-backed. Simulated `flight_state_query` REPLAY at provider boundary for CONNECTED reconciliation only. |
| Jordan ZG023/ZG053 + TR885 | **Atlas REPLAY** (committed recordings) |
| Jordan Concorde / Narita hotels | **Nuitée sandbox RECORD** artifacts |
| Ground transfer | Scenario/simulated provider-boundary data |
| Fable | **Deferred polish** — not an M9 functional blocker |

## Checklist

- [x] CK1 + CK2 generic
- [x] Merge complete seed tip (not cherry-pick)
- [x] Sarah S1 fixture acceptance
- [x] Sarah S1→S3 continuity (programme recovery)
- [x] Jordan S2 fixture acceptance
- [x] Jordan Concorde partial-failure fixture acceptance
- [ ] Fable visual polish (deferred)

## Next action

Independent C4 review on final pushed SHA. Do not claim C4 PASS. Do not start M10.

## Issue triage

| ID | Class | Notes |
|---|---|---|
| FABLE-POLISH | Park for Later | Visual refinement only |
| ORG-INHERIT | Park for Later | Exact grant match only |
| ISSUER-POL | Investigate Now | Issuer policy table still absent |
| LEGACY-R1-WALLCLOCK | Ignore / Accept Risk | Pre-existing on C3 |
| OPTION_SET→RESCHEDULED | Done | Seed manifests aligned to API enum |
| IDSYN flight_state REPLAY | Done | Simulated CONNECTED recordings for Batik PNRs |
