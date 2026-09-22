# ACTIVE TASK — Sarah + Jordan hero E2E closure

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas-a5-hero-e2e-closure`
- Branch: `fix/a5-hero-e2e-closure`
- CP1 SHA: `787fb77bafea158be11981e47b9dcfb1fd08260c`

## Checkpoint ledger

- [x] CP1 — programme horizon, validation limit, cost-before-blast comparator. Focused tests 23 PASS / 0 FAIL. Do not redesign unless a later focused test shows a defect.
- [x] CP2 — seed/world truth. Jordan stay is confirmed lyf Bugis `z-xdzAxcv` (`lp6d67d`), four nights 29 Sep–3 Oct. Checked-in cancel tier is USD 670.77 with no zero-amount window, so the represented penalty is that full price, not zero and not the search-preview USD 167.69.
- [x] CP3 — read-model/graph contract. Shared service CHANGED on schedule change and RECOVERED after reprotection. Four PASS travellers stay HEALTHY; a separate blocking failure stays FAILED. Proposed truth label is “Proposed · not committed”. Colour fix `617ed6a`. Focused graph tests 45 PASS / 0 FAIL.
- [x] CP4 — Sarah product path. `b1SarahWorldRecovery.pgtest.ts` 1 PASS / 0 FAIL. Reprotection now runs because pending reassessments are claimable when the scenario clock is behind wall time. Planning evidence fits after the candidate jsonb cap moved to 1 MiB. Recommended domain PROGRAMME. Basis: 0 regressions, 1 improvement, blast radius 3. No declared cost on that candidate, so cost did not break the tie. Approved that recommendation, executed, reassessment PASS, case RESOLVED.
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

## CP3 in progress

Case and traveller-trip nodes use the connection-aware colour (`617ed6a`). A tight-only failure is AFFECTED; a separate blocking failure stays FAILED. Sarah’s post-reprotection split already followed PASS/FAIL. Schedule-change travellers stay UNKNOWN while reassessment is pending; the changed service is CHANGED. Do not paint pending assessments amber.

Polling replaces the graph region only when `data-graph-scene-hash` changes, then restores camera, view, and selection from `window.__northstarGraphState`. An unchanged hash correctly leaves the canvas alone. Do not add a second in-place update path.

## CP5 seam

D1–D3 on the AiT clone still pass. Composed REPLAY flight search succeeds. Twelve transport candidates are rejected: connection still broken or below minimum, arrival after the deadline, the original stay misaligned, or an overnight with no hotel. Stay research stays off until the current assessment itself fails overnight accommodation. Reviewed publisher pages for the Narita hotel policy and the Japan entry sources now replay from `fixtures/recordings/official-documents/`. The AiT materializer does not create a passport from nationality, so planning has to provision the existing synthetic sandbox passport first. Reviewed publication must be signed by a registered principal. The Narita one-night search `rec_3453274e073bba4809e874155b28bd8e` and its three quotes replay successfully (`hotel.search` and two `hotel.quote` results succeed, and entry research succeeds). The sixteen candidates still fail: the original lyf stay is misaligned, several arrivals miss the deadline, and the quoted Narita night does not by itself clear `overnight_unaccommodated`. The next wiring is `stayReplacementBinding` for booking `z-xdzAxcv`, with the USD 670.77 penalty read from that booking, after Jordan’s Singapore intended visit is materialized. Cancellation of the original stay must wait for a canonical application of the replacement (`7c9b4a3`).

Checkpoint 6 has no PostgreSQL harness. The closest sequential run is the SQLite rehearsal in `test/integration.r2-rehearsal.test.ts`, which resets only at the start and end. A later proof should use one `obtainAitSummitWorld` and live in `postgres-integration/a5HeroSameWorldSequential.pgtest.ts`, classified in `postgres` and `aitFixtureCloneConsumers`, not `postgresFast`. Do not write that test until Jordan’s plan is viable.

Lint is already red on untouched files (`a3SandboxExecutionInputs.pgtest.ts`, `a3StayArrivalRequirement.pgtest.ts`, and others). Park for Later until the final gate; do not treat that as a Jordan defect.

## Exact next step

`a5JordanD3Planning.pgtest.ts` passes: the recommended plan includes a replacement flight, a new stay, and cancellation of the lyf booking at USD 670.77. A fresh RECORD quote is approved, sandbox flight and stay execution run, the trip reassesses PASS, and the case resolves. Checkpoint 6 passed in `a5HeroSameWorldSequential.pgtest.ts`: Sarah’s programme case resolves, then Jordan’s connection case opens in the same workspace, with no reset and no second sandbox booking. Do not reopen Sarah’s comparator, the hotel penalty amount, or the graph colour rule.
