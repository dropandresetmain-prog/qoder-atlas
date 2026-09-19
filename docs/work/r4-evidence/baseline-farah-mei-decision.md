# Decision: Farah Hussein and Mei Chen baseline FAIL

Branch `r4f/f3-baseline-reliability` (base `integration/r4-final-acceptance` `1375fde`). Evidence gathered 2026-09-19 by booting the demo (REPLAY, own database, `PG_TARGET_DATABASE=r4f3`) and reading the persisted baseline assessments.

## Question

R4 reported Farah and Mei as separate baseline FAIL cases. The intended founder demo is Reset -> healthy programme Overview -> disrupt Sarah. Is the FAIL (1) intentional truthful state, (2) stale/unsettled, (3) bad demo source data, (4) missing evidence/provider composition, or (5) a projection bug?

## Evidence (before the fix)

Fresh boot / reset baseline: `{"UNKNOWN":15,"PASS":50,"FAIL":2}`. The two FAIL journeys belong to `ait-draft-28` Farah Hussein and `ait-draft-15` Mei Chen. Their persisted `programme_participation` assessment (evaluator `m6.participation`, reason `insufficient_arrival_readiness`) carries identical facts:

| fact | value |
| --- | --- |
| arrival | 2026-09-30 01:05Z (09:05 SGT), flight MN228 KUL->SIN |
| commitment | `cmt-ait-d0-coach-breakout`, 10:30 SGT, REQUIRED / FIXED (role COACH) |
| available | 85 min |
| required | 150 min (organiser `MIN_BUFFER`, applies to REQUIRED on-stage items) |
| cause | REQUIREMENT on the breakout programme item, no uncertainty, no missing evidence |

Provenance: `scripts/reconcile-final-demo-content.mjs` gives every KUL-origin managed traveller the same synthetic corridor (`CORRIDORS.KUL`, MN228 08:10 -> 09:05). Only Farah and Mei are KUL-origin, and both are Day-0 coaches with a 10:30 REQUIRED breakout. The seed-freeze analysis (`WIT_DEMO_WORLD_PROGRAMME_SEED_FREEZE_v1.md`) checked the Sarah/Jordan/Day-1 cohort against the 150-minute rule and never checked these two, so the collision was an unintended by-product of a generic per-airport flight template.

## Classification

- (1) Intentional truthful state: no. The demo narrative has exactly one failing traveller (Sarah). Nothing in the seed freeze designates Farah/Mei as a scenario.
- (2) Stale/unsettled: no. The assessments are current and settled; re-running gives the same result.
- (4) Missing evidence/provider composition: no. `uncertainty` is empty and `evidenceRefs` are complete; the evaluator had everything it needed.
- (5) Projection bug: no. Overview correctly reflects the persisted FAIL (2 need attention).
- **(3) Bad demo source data: yes.** The evaluator is correct given the input; the input (a 55-minute KUL hop landing 85 minutes before a REQUIRED, FIXED breakout under a 150-minute readiness rule) is what is wrong for a demo whose only intended baseline problem is Sarah.

## Fix (data only, no engine or application change, nothing person-specific)

The KUL corridor template moves 2 hours earlier: MN228 departs 06:10, arrives 07:05 SGT (205 min available >= 150). Applied to `fixtures/programmes/ait-summit-2026/programme.json` (the two KUL-origin travellers) and to `CORRIDORS.KUL` in `scripts/reconcile-final-demo-content.mjs` so regeneration stays consistent. The 150-minute rule, the breakout's REQUIRED/FIXED importance and the evaluator are untouched; a genuinely late flight would still FAIL.

Result on a fresh database: `{"UNKNOWN":15,"PASS":52}` (0 FAIL); no baseline recovery cases are opened for Farah/Mei. The 15 UNKNOWN remain and are truthful: they are self/other-arranged travellers with a REQUIRED/OPTIONAL engagement and no declared travel (`no_route_to_place`), shown as Unconfirmed. After disrupting Sarah the expected Overview is 51 confirmed / 1 needs attention / 15 unconfirmed.

## Operational note

The dataset content hash changed (`71553bcb...` -> `a9d8e7a0...`). A persistent database provisioned from the old fixture refuses to boot (`DATASET_CONTENT_CONFLICT`, by design); such a database needs a fresh database (the in-app Reset cannot be reached because boot refuses first). New/fresh databases and the PG test fixtures build from the new content.

## Tests

`productBaselineWorld.pgtest.ts` run alone (14 tests): 11 pass, 3 fail. It asserts only that not every journey is green and that unassessed subjects read UNKNOWN, both still true. The 3 failures are independent of this change: (a) `/api/v2/operator/programme` returns 500 (fixed upstream by R4-F1b `5443457`, not in this branch base), (b) `demo reset refuses to layer a second world` expects the retired 409 `DEMO_DATASET_PROVISIONED` (R4 replaced it with the real reset, which returns 200), (c) `boot does nothing when no demo dataset is configured` leaks `NORTHSTAR_DEMO_DATASET_DIR` from `.env.local`. Also pre-existing: `test/wave3r-m1-ait-canonical-seed.test.ts` (MNSYN03 harvest; fails identically on `integration/r4-final-acceptance`).

Live check after the fix (fresh database, then Sarah disrupt via the demo flow): baseline 52 PASS / 15 UNKNOWN / 0 FAIL; after Sarah's update 51 PASS / 1 FAIL / 15 UNKNOWN with exactly one recovery case (Sarah's).
