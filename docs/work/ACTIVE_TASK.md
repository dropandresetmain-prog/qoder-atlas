# ACTIVE TASK — A4 DESTINATION HOTEL ROBUSTNESS

Bounded provider diagnostic / robustness pass so destination stay replacement can quote beyond same-property inventory for the required window.

## Identity

- Branch: `finish/a4-destination-hotel-robustness`
- Starting checkpoint: `finish/a4-composite-planner-repair` @ `347fcc0ac7b9a29f0547fb3d4afac13b2c8ee95b`
- Role: PRIMARY LOCAL IMPLEMENTER — A4 hotel provider diagnostic / robustness
- Do NOT: Atlas/Nuitée mutations, recovery approval, planner redesign, A3 UI / V5.6 polish

## Verdict

**A4 DESTINATION HOTEL BLOCKER RESOLVED**

## Preservation

- Preservation commit: _(pending this commit)_
- Branch: `finish/a4-destination-hotel-robustness`
- Base: `347fcc0ac7b9a29f0547fb3d4afac13b2c8ee95b`
- Focused proof before commit: 52/52 (`a3-stay-replacement-context`, `northstar-hotel`, `northstar-v2-m7-recovery-planning`)

## Root cause (classified)

**Same-property search restriction + provider `2001`:** Destination research searched only Nuitee hotel id `lp21d9f` (Concorde). For `2026-09-30`→`2026-10-03` that fingerprint returned provider code **2001** (`no availability found`). Overnight quotes remained healthy. Market/area inventory for the same window **does** exist and prebooks successfully.

HTTP 400/409 alone was misleading; stable classification is provider `error.code`.

## Repairs shipped (uncommitted on branch)

- Optional `areaSearch` on stay-replacement binding → coordinate/radius hotel.search (preferred property ranked, not exclusive)
- `parseNuiteeHttpFailure` — classify by provider code (`2001` UNAVAILABLE, `4002`/`4003` INVALID_REQUEST, `4016` TIMEOUT, …)
- Area-path quote ranking: prefer displaced property, then bounded alternate rates; fail closed on invalid request
- Focused tests: provider code classification; area alternate after preferred stale

## Fresh Jordan RECORD proof

- Case: `297337f5-cda2-5397-a2ba-9ace992396b3`
- Attempt: `a71130cb-f802-56f0-b46a-f11d592add09`
- Outcome: **AWAITING_AUTHORITY** (2 viable)
- Destination search: `rec_0ecfadead90688b214685cdc81d0e2aa` (area, not same-property)
- Destination quotes: multiple SUCCEEDED (e.g. `rec_d77295…` hotel `lp19483c` MET A Space Pod, USD 117.29, NRFN, prebook `hg2WKFPRt` @ `2026-09-20T16:16:01.776Z`)
- Complete four-effect candidate materialised (flight + Narita + destination + penalty); also early-arrival recommended without overnight

## Cost / FX provenance (authoritative)

Selected recommended strategy `038db54c-48ec-516a-b515-93364f8176a2` (early TR arrival, no overnight):

| Line | Provider | SGD |
|---|---|---|
| Flight SELECT_OFFER | USD 181.83 | 232.45 |
| Displaced-booking loss (POLICY_PENALTY_ESTIMATE) | USD 1135.63 | 1451.79 |
| Destination ADD_JOURNEY_STAY | USD 117.29 | 149.94 |
| **Total home** | | **SGD 1834.18** |

FX: Frankfurter `fx_frankfurter_usd_sgd_2026-09-18` rate **1.2784**, observed `2026-09-18T00:00:00Z`.

Complete four-effect alternative (VIABLE_NOT_RECOMMENDED): flight USD 83.35 + Narita 35.29 + penalty 1135.63 + destination 117.29 → **SGD 1753.39**.

## Checks

- Focused hotel/M7/stay-replacement tests: **52/52 pass**
- Not run this pass: full `npm test`, `test:postgres`

## Park for Later

- Progression log `column "scope_intended_visit_ids" does not exist` during REPLAN (attempt still persisted AWAITING_AUTHORITY)
- Proposal stay `placeLabel` still shows destination place name (“Concorde…”) while quoted property is alternate (`lp19483c`) — UI/provenance display polish
- Stale A4 boot on :4126 without areaSearch code can race reassessment — kill before proof

## Next

Commit/push when requested. Do **not** approve or execute provider mutations from this package.
