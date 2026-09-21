# ACTIVE TASK — Sarah + Jordan hero E2E closure

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas-a5-hero-e2e-closure`
- Branch: `fix/a5-hero-e2e-closure`
- CP1 SHA: `787fb77bafea158be11981e47b9dcfb1fd08260c`

## Checkpoint ledger

- [x] CP1 — programme horizon, validation limit, cost-before-blast comparator. Focused tests 23 PASS / 0 FAIL. Do not redesign unless a later focused test shows a defect.
- [x] CP2 — seed/world truth. Jordan stay is confirmed lyf Bugis `z-xdzAxcv` (`lp6d67d`), four nights 29 Sep–3 Oct. Checked-in cancel tier is USD 670.77 with no zero-amount window, so the represented penalty is that full price, not zero and not the search-preview USD 167.69.
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

## CP2 hotel

Approved property: lyf Bugis Singapore, `lp6d67d`, booking `z-xdzAxcv`, USD 670.77, check-in 2026-09-29, check-out 2026-10-03. Retrieve `fixtures/recordings/nuitee/retrieve/rec_09c4c22e006e5e2df8408247c4716fe8.json`. Only `ait-draft-09` moved off shared Concorde. Jordan progression PostgreSQL test still 1 PASS / 0 FAIL. Seed tests 6 PASS / 0 FAIL. Anti-hardcoding CLEAN.

## Exact next step

Checkpoint 3: Overview and Case reflect this PostgreSQL truth. Do not reopen the hotel penalty or the 95/82/impossible progression.
