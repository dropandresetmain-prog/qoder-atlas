# M9 ACTIVE TASK — Application Composition + Product Integration

## Goal

Compose one coherent target PostgreSQL application/runtime over accepted M2–M8 owners, with product-safe read models, application commands, RecoveryCase resolution, and Sarah + Jordan fixture-backed acceptance for C4 candidate.

## Accepted base

- C3: `integration/m7-m8-c3` @ `f8103379ed2426d442d342895e9e1d1573f875da`
- Worktree: `C:/Dev/qoder-atlas-m9`
- Branch: `milestone-m9-product-integration`

## Current checkpoint

**C4 FAILED (`68521d0`) — targeted remediation candidate ready for independent re-review.**
Do not claim C4 PASS from this file.

Failed C4 SHA: `68521d0926c453cc21ccb172d5679eb85dfce574`
Takeover SHA: `a70f064a0f44a088e5b17748d094b03f69fd6872`

## Provenance (demo truth)

| Corridor | Provenance |
|---|---|
| Sarah Batik ID7159→ID7153 | **ORGANISER_SUPPLIED_SYNTHETIC** + **SIMULATED_EXTERNAL_EVENT** — not Atlas-backed |
| Jordan ZG023/ZG053 + TR885 | **Atlas REPLAY** (committed recordings) |
| Jordan Concorde / Narita hotels | **Nuitée sandbox RECORD** artifacts |
| Ground transfer | Scenario/simulated provider-boundary data |
| Fable | **Deferred polish** |

## C4 remediation checklist

- [x] 1A. Real target ingress — `m9DemoIngress.pgtest.ts`
- [x] 1B. Real server-side programme-swap preview — `m9AuthoritativePreview.pgtest.ts`
- [x] 4. Read-model currentness + observation projection — `m9ReadModelCurrentness.pgtest.ts`
- [x] 5. Issuer policy / no normal self-issuance — `m9Checkpoint1.pgtest.ts`
- [x] 6. Resolution gate blocks outstanding mandatory actions — `m9Checkpoint1.pgtest.ts`
- [x] 7. Jordan compatibility LANDED evidence — `test/m9-jordan-s2-compatibility.test.ts`
- [x] 2B. Same-Programme sequential ActionIntents (narrow M7/M8 fix) — `m9SameProgrammeSequentialActions.pgtest.ts`
- [x] 2. Sarah target PG E2E via `composeTargetApplication` — `m9SarahTargetE2E.pgtest.ts`
- [x] 3A. Progressive connection from real evaluator — `m9ConnectionProgression.pgtest.ts`
- [x] 3B. TR867 NOT_VIABLE / TR885 VIABLE — focused viability pgtest
- [x] 3C/3D. Jordan multi-action + partial-failure — `m9JordanMultiActionRecovery.pgtest.ts`

## Next action

Independent **targeted C4 re-review** on the pushed remediation tip.
Do not start M10. Do not claim C4 PASS.

## Issue triage

| ID | Class | Notes |
|---|---|---|
| FABLE-POLISH | Park for Later | Visual refinement only |
| ORG-INHERIT | Park for Later | Exact grant match only |
| ISSUER-POL | Done (bounded) | |
| LEGACY-R1-WALLCLOCK | Ignore / Accept Risk | Pre-existing on C3 |
| SAME-PROGRAMME-DUAL-EXECUTION | Done | Narrow M7/M8 correction landed |
| WAVE3R-AIT-HARVESTED-PNR | Investigate (pre-existing) | Fails on unmodified `68521d0` too |
| OPTION_SET→RESCHEDULED | Done | |
| IDSYN flight_state REPLAY | Done | |
