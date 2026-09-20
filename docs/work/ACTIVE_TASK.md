# ACTIVE TASK — A4 PHYSICAL SANDBOX ACCEPTANCE

## Current checkpoint

- Product/base branch: `finish/a4-destination-hotel-robustness`
- Current pushed tip: `c897d2969f901a4c90f25e6e693d11a4362ac253`
- Product implementation commit inside that tip: `40bae0b00efd6f02fda0af1f50cf618703ec5756`
- This docs reconciliation runs separately on `docs/a4-milestone-reconcile`; do not use the docs branch as the execution base.
- A4 physical sandbox acceptance is the active milestone. Do not claim A4 accepted until the four selected sandbox actions complete, observations are canonically applied, whole-trip reassessment passes and the Case resolves.

## Milestone status

| Checkpoint | Status | Evidence |
|---|---|---|
| A0 / A1 / A2 | **ACCEPTED** | Sarah LIVE programme-side recovery; desktop V5.6/V7.2 baseline |
| A3 recommendation/UI | **CONDITIONAL PASS** | Complete multi-domain recommendation exists and UI is readable enough to continue; final graph/progression/copy QC carried forward |
| A4 CP2 continuation safety | **PASS** | `finish/a4-continuation` @ `f7a497d984ea93fc6436c6c717a553db48602fa6` |
| A4 CP3 hotel execution integration | **PASS** | `finish/a4-hotels` @ `0c177c830a8593899147f4227aa90b2cff327785` |
| A4 CP3.5 controlled four-action seam | **PASS** | `finish/a4-controlled-seam` @ `5bdb6527369a2a3c34957ce718b5f690ce50adf5` |
| A4 planner/provider robustness | **PASS** | hotel robustness preserved @ `74ac4e7810e6acf63ae9fbeec27a1d36d3e3d9bf`; composite planner repair/progression closure through current tip |
| A4 CP4a hero progression closure | **PASS** | final overnight-required RECORD plan naturally produced the four-effect recovery on current tip |
| A4 physical sandbox execution | **IN PROGRESS / NOT ACCEPTED** | explicit founder-authorised sandbox run only; stop on uncertainty |
| A5 repeat + freeze | **PENDING** | only after A4 physical acceptance |

## Current Jordan pre-mutation truth

- Case: `297337f5-cda2-5397-a2ba-9ace992396b3`
- Final progression basis: planning `now` after same-night departures, so boardability removes the non-overnight option without a hardcoded force-overnight branch.
- Fresh planning attempt: `2bd16724-c55f-5378-a5d6-e2e4e052d892`
- Outcome: `AWAITING_AUTHORITY`
- Recommended strategy: `dcb28c10-27d3-50b9-953a-6cc09356ff51`
- Required effects: replacement flight + Narita stay + destination replacement stay + displaced destination stay cancellation.
- Destination replacement search is area-bounded rather than same-property-only; preferred property may differ from the baseline booking.
- Baseline displaced sandbox booking remains setup/source truth and is not an A4 recovery action.

### Cost truth for the recommended pre-run strategy

| Component | Provider currency | SGD comparison |
|---|---:|---:|
| Replacement flight | USD 83.35 | 106.55 |
| Narita overnight | USD 35.29 | 45.11 |
| Destination replacement stay | USD 109.47 | 139.95 |
| **New spend total** |  | **291.61** |
| Displaced booking maximum potential loss | USD 1135.63 | 1451.79 |
| **Maximum exposure** |  | **1743.40** |

Frankfurter reference: USD→SGD 1.2784, reference date 2026-09-18. The displaced-booking amount is a `POLICY_PENALTY_ESTIMATE` / maximum loss, not a confirmed realised charge or refund.

## Accepted execution invariants

- Provider success alone never unlocks a successor.
- Exact canonical application + fresh viable residual is required before the next action.
- Unknown/lost provider outcome means reconcile only; never blind redispatch.
- Replacement Singapore accommodation must be provider-confirmed and canonically applied before displaced-stay cancellation.
- Entity existence alone is not receipt-backed idempotency.
- A provider-confirmed side effect with changed terms remains a known external fact; do not report it as a clean no-side-effect failure.
- Final resolution requires all mandatory actions complete **and** current whole-trip PASS.

## Current physical A4 order

1. replacement flight
2. observation/reconciliation → canonical application → reassessment
3. Narita booking
4. observation/reconciliation → canonical application → reassessment
5. destination replacement booking
6. observation/reconciliation → canonical application → reassessment
7. displaced destination stay cancellation
8. observation/reconciliation → canonical application → final whole-trip reassessment → resolution

## Carry-forward defects — do not mix into the live execution unless blocking safety

### Act after A4 physical proof
- V5.6 can still present definitive FAIL as amber/yellow.
- Progressive-delay V5.6 edges/state need final scenario walkthrough.
- Overview Active Change / focus behavior needs final product QC.
- Graphs should sit above the surrounding Case/Overview blocks.
- Recommendation/activity wording still needs a final compression/copy pass.
- Final cost presentation must keep new spend separate from potential displaced-booking loss.
- Wall-clock reassessment workers can race synthetic `planningNow` proof scripts; test/proof scripts should stop conflicting runtime services.

### Park
- mobile, healthy-trip requests/composer, generic hotel/visit/credential management, broad immigration, transfers, claims, extra scenarios, importer atomicity, unrelated parity/infrastructure.

## Stop-safe rules

- Do not reset or destroy a workspace after an external attempt/observation merely to obtain a clean screen.
- Preserve provider refs, attempts, observations and canonical receipts on any uncertain outcome.
- If the physical run exposes a code defect: stop progression, reproduce the smallest seam, fix the generalized defect, focused-test, commit/push, reconcile existing provider state, then resume safely.
- Full broad gates belong to A5 freeze, not the live A4 loop.

## Exact next action

Complete the founder-authorised A4 physical sandbox run from the current product checkpoint. If it passes, record A4 acceptance and then perform one bounded graph/UI truth pass before A5 Sarah + Jordan LIVE repeats and final gates.
