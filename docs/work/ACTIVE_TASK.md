# ACTIVE TASK — A4 CONTROLLED FOUR-ACTION SEAM

Pre-sandbox integration proof that the generalized execution machinery traverses the selected four-action shape under controlled provider outcomes.

## Identity

- Branch: `finish/a4-controlled-seam`
- Base / starting SHA: `0c177c830a8593899147f4227aa90b2cff327785` (`finish/a4-hotels`)
- Role: PRIMARY LOCAL IMPLEMENTER — A4 controlled seam
- Scope: one focused PG proof of deps → authority → attempt → observation → canonical → continuation → reassessment → resolution
- Do NOT: live Atlas/Nuitée, real sandbox mutation, architecture redesign, A3 UI / V5.6 / polish

## Checkpoint status

| Item | Result |
|---|---|
| Hotel CP3 base | **PASS** @ `0c177c8` |
| Controlled four-action seam | **PASS** (this branch) |

## Acceptance

- [x] Four-action shape: transport replacement → first stay book → second stay book → displaced cancel
- [x] Provider success without canonical blocks successor
- [x] Canonical + viable continuation unlocks next intent
- [x] Provider success ≠ resolution; reassessment required
- [x] UNKNOWN hotel outcome → no successor / reconcile only / no redispatch
- [x] Unrelated Journey mutation → continuation fails closed
- [x] No Jordan / place-name / scenario-ID hardcoding in assertions

## Checks

- `postgres-integration/a4CompositeExecution.pgtest.ts` — 3/3
- `a4SelectedPlanContinuation.pgtest.ts` — 9/9
- `a4StayExecution.pgtest.ts` — 3/3
- `a4ObservedStay.pgtest.ts` — 11/11
- `test/r4-offer-execution-boundary.test.ts` — 9/9
- `npx tsc --noEmit -p tsconfig.json` — clean
- Not run: full `npm test`, `test:postgres`, migration suite, real sandbox

## A3 defects (CARRY FORWARD)

- Disruption trigger / progressive delay UI
- V5.6 graph semantic state / edges
- Hotel cost provenance polish
- Graph placement / recovery copy compression

## Next action

Real sandbox four-action run is now safe to attempt as a separate, explicitly authorised step. Do **not** run it from this package. Do **not** merge to main until sandbox evidence is accepted.
