# ACTIVE TASK — Sarah + Jordan hero E2E closure

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas-a5-hero-e2e-closure`
- Branch: `fix/a5-hero-e2e-closure`
- CP1 SHA: `787fb77bafea158be11981e47b9dcfb1fd08260c`

## Checkpoint ledger

- [x] CP1 — programme horizon, validation limit, cost-before-blast comparator. Focused tests 23 PASS / 0 FAIL. Do not redesign unless a later focused test shows a defect.
- [ ] CP2 — seed/world truth. Partial. Hotel zero-penalty reseed is blocked.
- [ ] CP3 — backend/read-model/graph truth
- [ ] CP4 — Sarah full vertical
- [ ] CP5 — Jordan full vertical
- [ ] CP6 — same-world Sarah + Jordan product proof
- [ ] Final gates

## CP2 done

- Jordan D2 arrival is `2026-09-29T15:28:00+09:00` (82 minutes before ZG053 16:50). D1 stays 95. D3 stays negative.
- PostgreSQL `a3JordanConnectionFoundation.pgtest.ts`: baseline PASS → D1 gap 95 READY → D2 gap 82 AT_RISK, not planning-eligible → D3 broken, planning-eligible. 1 PASS / 0 FAIL.
- Sarah ID7159 `2026-09-30T17:45+07→20:30+08` matches Atlas `rec_d40b625e84e68b27deab3fbb52e27c2e`. ID7153 `2026-10-01T07:45+07→10:30+08` matches Atlas `rec_b615f4f1bca688f781fe2ee3cdc39720`. Disruption event provenance remains `SIMULATED_EXTERNAL_EVENT`. Flight clock times were not moved; they were already the recorded services.
- Reviewed `jp-short-visit-sg-passport-2026-09`: SG + transit_overnight + short stay + valid passport PASSes; issuing state US FAILs. Not a hardcoded route branch.
- `test/a5-hero-seed-truth.test.ts` + `test/a5-founder-qc-progression.test.ts`: 5 PASS / 0 FAIL.
- `npm run gate:anti-hardcoding`: CLEAN (511 files).

## CP2 blocker — Act Now before CP3

Concorde is not required. A live Nuitée sandbox search for any Singapore stay, 2026-09-29 → 2026-10-03, one adult, nationality SG, Marina Bay 8 km, returned 134 properties / 393 rates / 115 refundable. Every refundable rate carries a positive cancellation fee. Raw policies have no zero-amount cancel row. The latest first penalty tier is `2026-09-28 10:00:00` GMT. Jordan recovery is later: D3 `2026-09-29T12:00:00+09:00` and overnight `2026-09-29T21:30:00+09:00`. Zero rates are still free at either time. A 15 km retry did not add a later window. Do not invent a zero penalty or book a rate that is already inside a penalty tier.

## Exact next step

Unblock with sandbox inventory whose free-cancel deadline is still open at D3, then finish CP2. Do not start CP3.
