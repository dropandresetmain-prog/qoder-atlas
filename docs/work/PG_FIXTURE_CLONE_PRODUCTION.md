# PG AiT Fixture Clone — Productionization Evidence (2026-09-19)

Branch: `feat/pg-fixture-clone`
Base: `origin/main` @ `07c3c79`
Integration: cherry-pick spike `c5d4100`/`6b1ef17` onto main (not merge spike;
fast-tier `d1762f0` remains unintegrated — fixture gated by consumer membership).

## Checkpoints (pushed)

| CP | SHA | Content |
|---|---|---|
| spike port | `0fe1974`, `34e605e` | cherry-picks |
| 1 | `ba5e95d` | suite lifecycle + inbox + guards |
| 2 | `79fed1d` | F1 + N1 adoption |
| 3 | `11318a3` | B1 adoption + TESTING.md |

## Focused timings

| Item | Result |
|---|---|
| Fixture build | ~72–88s |
| Clone median (n=8) | ~920ms |
| Inbox isolation | PASS (`deliverInboxMessage`) |
| FORCE teardown | PASS |
| F3/F5/F7/F1/N1 subset | 18/18 PASS in **32.3s** (+83.5s fixture) |
| F1 three-world setup | **3.4s** clone (was ~190s prep historically) |
| B1 fresh | **152.7s** PASS |
| B1 clone | **84.6s** PASS (setup 1.7s) |

## Adopted consumers

F3, F5, F7, F1, N1, B1 Sarah.

## Fresh only

`productBaselineWorld`, `migrate.pgtest`, materialization/idempotency proofs,
`t2ProviderDisruptionReprotection` (step 1 is T1 baseline proof).

## Double-pool

`composeTargetApplication` still opens its own pool via `postgres` overrides.
Tests close the app before dropping the clone. No product refactor.
**Accept Risk** for this milestone.
