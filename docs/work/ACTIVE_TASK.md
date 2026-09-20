# ACTIVE TASK — A4 CP4a JORDAN PROGRESSION / RECOMMENDATION CLOSURE

## Identity

- Branch: `finish/a4-destination-hotel-robustness`
- Hotel preservation: `74ac4e7810e6acf63ae9fbeec27a1d36d3e3d9bf` (base `347fcc0ac7b9a29f0547fb3d4afac13b2c8ee95b`)
- Role: PRIMARY LOCAL IMPLEMENTER — A4 CP4a
- Do NOT: provider mutations, approval, Atlas booking/cancel

## Verdict

**A4 HERO PROGRESSION CLOSURE PASS**

## Preservation (hotel robustness)

- SHA: `74ac4e7810e6acf63ae9fbeec27a1d36d3e3d9bf`
- Focused proof at preserve: 52/52; anti-hardcoding CLEAN

## Progression root cause

At wall-clock planning, same-night TR875 remained boardable → recommended strategy omitted Narita overnight. Overnight requirement is **boardability vs planning `now`**: timeline stage `overnight_narita_necessary` sets `planningNow` after same-night departures so only next-morning onward + connection-airport overnight remain viable. Engine derives overnight from timing; no force-overnight branch.

## `scope_intended_visit_ids` bug

- Cause: callers expected a JSON/array column on `credential_selections`; schema stores visit scope in `credential_selection_visits`.
- Fix: `stayExecutionInputs` aggregates via `array_agg` join (same pattern as world reader). No duplicate JSON column.

## Fresh overnight RECORD plan

- Case: `297337f5-cda2-5397-a2ba-9ace992396b3`
- planningNow: `2026-09-29T21:30:00+09:00`
- Attempt: `2bd16724-c55f-5378-a5d6-e2e4e052d892`
- Basis assessment: `c07dc092-f120-4031-9527-2c77668e9c6e` (CURRENT FAIL)
- Outcome: **AWAITING_AUTHORITY** (2 viable)
- Recommended: `dcb28c10-27d3-50b9-953a-6cc09356ff51`
- Effects: `SELECT_OFFER` + `ADD_JOURNEY_STAY` (Narita) + `CANCEL_STAY` + `ADD_JOURNEY_STAY` (destination)
- Flight: TR `2026-09-30T08:20+09:00` NRT → SIN `14:35+08:00`
- Stays: Narita Gateway Hotel overnight; destination **MET A Space Pod at Arab Street** (`propertyLabel`; place context Concorde)
- Same-night / transport-only candidates rejected (`overnight_unaccommodated`)

## Cost provenance (recommended)

| Component | Provider | SGD |
|---|---|---|
| Replacement flight | USD 83.35 | 106.55 |
| Narita overnight | USD 35.29 | 45.11 |
| Destination replacement stay | USD 109.47 | 139.95 |
| **New spend total** | | **291.61** |
| Displaced booking max loss (POLICY_PENALTY_ESTIMATE) | USD 1135.63 | 1451.79 |
| Maximum exposure (new spend + potential loss) | | 1743.40 |

FX: Frankfurter `fx_frankfurter_usd_sgd_2026-09-18`, rate **1.2784**, observed `2026-09-18T00:00:00Z`, authority CONNECTED.

`totalHomeAmount` remains maximum exposure for comparator; `newSpendHomeAmount` / `potentialLossHomeAmount` are explicit.

## Other CP4a repairs

- Prepare publication cache: process-stable document + published-key sets (stop STALE_RETRY loop)
- Planning verification uses planning `now` (not wall) so coverage survives progressive `planningNow`
- Demo policy `maxEvidenceAgeSeconds` raised to 14d (schema max aligned) — SCENARIO DATA for RECORD→planningNow span
- Stay replacement `proposedJourneyItemId` is deterministic UUID (was `stay-replacement:` hash; broke `stay_execution_bindings.journey_item_id`)
- Place vs property labels on stay proposals

## Checks run

- `a4-cp4a-progression-closure` + cost + stay-replacement: pass
- hotel / M7 / reviewed-entry / hotel-property-policy: pass
- `tsc --noEmit`: pass
- `gate:anti-hardcoding`: CLEAN
- Not run: full `npm test`, `test:postgres`

## Carry-forward (A3 / V5.6 / UI)

- Graph may still map definitive FAIL as amber — bounded projection fix later
- Progressive delay V5.6 node/edge presentation
- Overview active-change behaviour
- Competing wall-clock reassessment workers during planningNow drains (stop runtimeServices in proof scripts)

## Remaining A4 blockers

- None for pre-mutation hero recommendation at overnight-required stage
- Next: authority / execution only when explicitly authorised (still pre-mutation)
