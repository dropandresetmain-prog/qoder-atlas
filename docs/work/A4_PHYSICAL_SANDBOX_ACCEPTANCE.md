# A4 physical sandbox acceptance — 2026-09-21

Status: **ACCEPTED**

This document is the immutable acceptance record for the Jordan A4 physical sandbox recovery. It records the real supported sandbox execution path on the accepted product candidate. It does not supersede architecture contracts; it supplies milestone evidence.

## Accepted product candidate

- Branch: `finish/a4-destination-hotel-robustness`
- Final product SHA: `546adf210db8ead343ecdac22b410515665c176a`
- Starting physical-resume SHA: `c9cfb18`
- Case: `297337f5…`
- Planning attempt: `c30ba259…`
- Selected strategy: `dc9b7668…`
- ActionPlan: `2810ecfd…`
- Final whole-trip assessment: `4c4c5698…` — **CURRENT / PASS**
- Final Case state: **RESOLVED / RECOVERED**

## Accepted four-action execution

The existing selected plan executed through the generalized protected execution path. Provider success did not advance the plan until observation/reconciliation, canonical application and fresh deterministic reassessment completed.

| # | Action | Attempt | Provider result | Canonical result | Post-action truth |
|---|---|---|---|---|---|
| 1 | Replacement flight | `69797beb…` | Atlas order `TESTA20260921012546645`, locator `S89153`, **TICKETED** | `JOURNEY_ITEM_UPDATED` via `offer-select:cc202468…:select` | CURRENT FAIL; Narita next |
| 2 | Narita overnight BOOK | `f33bf720…` | Nuitée `blxskTP7r`, USD 35.29, **CONFIRMED** | `OBSERVED_STAY_ATTACHED` | residual repaired/current; destination next |
| 3 | Destination replacement BOOK | `29aa3515…` | Nuitée `b347Hn3BU`, USD 109.47, **CONFIRMED**, property `lp19483c` | `OBSERVED_STAY_ATTACHED` | CURRENT FAIL; cancellation next |
| 4 | Displaced destination CANCEL | `458d771b…` | Nuitée `c4NsnfT_N`, **CANCELLED** | `OBSERVED_STAY_CANCELLED` | `4c4c5698…` CURRENT PASS; resolve |

No mandatory provider outcome remained UNKNOWN. The initial Atlas lost response was reconciled read-only to TICKETED before canonical application; it was not blindly redispatched.

## Continuation evidence

- Original post-flight continuation checkpoint: `07ea8e07-fbb8-42fc-904a-cd989d64949a`
- Destination checkpoint: `7d3a13b7…`
- Cancellation checkpoint: `b29b05be…`
- Replacement destination stay was provider-confirmed and canonically applied before the displaced stay cancellation became eligible.
- The plan was not restarted after the flight. The existing successful provider state and ActionPlan were preserved and resumed.

## Final canonical state

- Replacement transport: ACTIVE
- Narita stay: PLANNED, canonical item `87cdf153…`
- Destination replacement stay: PLANNED, canonical item `e72f4c4d…`
- Displaced stay: **DROPPED**, canonical item `24a53ad5…`
- Whole-trip deterministic assessment: **PASS / CURRENT**
- Case: **RESOLVED / RECOVERED**
- Product read model reflects recovered/cancelled truth.

## Execution-time defects closed

Three generalized defects were fixed, focused-tested, committed and pushed during the physical run:

1. `16eaddc` — selected-plan canonical-application stay lookup uses attempt/intent ownership.
2. `b5d1ab1` — reviewed entry UNKNOWN explanations are bound correctly for the selected residual.
3. `546adf2` — observed stay attachment unions same-credential intended-visit scope instead of replacing prior scope; selected-plan continuation accounts for `OBSERVED_STAY_*` scope bumps.

Earlier physical-run continuation closure also proved that one selected action may create multiple exact canonical receipts. Revision accounting now derives the same-plan footprint from durable receipts/command namespaces rather than fixed revision increments.

## A5 repeatability lessons

These are **Act Now for baseline/demo setup**, not reasons to weaken execution safety:

- provision sandbox spend envelopes before disruption/planning so authority setup does not stale an already-selected strategy;
- the synthetic hero scenario clock (`2026-09-29T21:30:00+09:00` at the overnight-required stage) must own reassessment; wall-clock workers must not revive already-departed options;
- observed stay attachment must union same-credential visit scopes;
- continuation must account compound selected-action scope bumps from exact durable receipts;
- credential-visit repairs must not introduce unrelated/unaccounted scope generations;
- use focused PostgreSQL tests during physical execution; broad gates belong to A5 freeze.

## Remaining product/UI debt

A4 acceptance does not close the previously carried A3 presentation defects:

- V5.6 definitive FAIL can still present amber/yellow;
- progressive-delay graph edges/state require final walkthrough;
- Overview Active Change / focus behavior needs final QC;
- Case/Overview graphs should be placed above surrounding secondary blocks;
- recovery/activity copy remains somewhat verbose and UUID-heavy;
- final cost presentation must separate new spend from potential displaced-booking loss;
- founder REPLAY corridor/progression coverage should be made repeatable for the final recording.

## Acceptance meaning

A4 proves the core product claim on the Jordan hero path:

`change -> deterministic failure -> multi-domain recovery planning -> authority -> protected provider execution -> observation/reconciliation -> canonical application -> reassessment -> continued selected-plan recovery -> whole-trip PASS -> RESOLVED Case`

It does **not** imply generic hotel administration, transfer booking, insurance claims, broad immigration machinery, mobile, healthy-trip request planning or arbitrary workflow orchestration.
