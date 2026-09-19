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

## Canonical promotion (final)

| Metric | Value |
|---|---|
| Wall clock (`npm run test:postgres`) | **1059.1s** (~17m39s) |
| Suite fixture build | **74.4s** |
| Node `--test` duration | **983.0s** |
| Files | 69 |
| Tests | 578 (576 pass, 1 fail, 1 skip) |
| Fail | `m10RuntimePurgeBoot` 200≠404 — **pre-existing** (R3 accepted same) |
| Skip | fresh↔clone fingerprint under suite fixture (proven standalone) |
| vs ~1433s baseline | **−374s (−26%)** |

Target: &lt;1100s worthwhile ✓; ~900–950s stretch not reached without T2 split / more consumers.
