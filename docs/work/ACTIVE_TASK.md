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
- [x] QC-P1 — known-zero programme economics and nearest-swap tiebreak. Focused: comparator, coordinator generality, FX context, operator cost presentation. 41 PASS / 0 FAIL. PostgreSQL three-run repeatability not yet run. SHA `e35214e`.
- [x] QC-P4a — D3 demo control sets the configured overnight evaluation clock; compact popover hides `presentation: debug`. Catalog tests 6 PASS / 0 FAIL. Physical D1→D2→D3 on the live REPLAY server produced an overnight recommendation (Narita Gateway Hotel 29 Sep 15:00–30 Sep 11:00 GMT+9, replacement Narita→Singapore flight, lyf Bugis cancel and rebook). Case projection was hiding it behind a superseded stale-retry attempt that shared `completed_at`; the read now prefers a current basis. Airline approval stays unavailable in REPLAY because external booking is not composed.
- [x] QC-P5 — graph labels, before/after arrival, readiness shortfall, Rechecking while unknown is pending, dimmed nodes stay selectable, vertical edges can step around cards, recommendation glance protects the people who move from failing to passing. Focused graph tests 45 PASS / 0 FAIL. Operator UI convergence PASS. Four pre-existing `r4-f1-ui-language` assertions still fail on HEAD (resolved lead copy, compared-cost sentence, cancellation exposure sentence, no-plan title). Physical browser QC not yet run.
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

Founder-QC pass on `fix/a5-hero-e2e-closure` starting `23759dfc314a599c74a441eae340bbeb97cf3130`.

Sarah first-run root cause (code, before the known-zero fix): a programme-only swap has no priced effect, so cost comparison was omitted. The comparator treats an omitted cost as unknown and sorts it last. A viable replacement flight with unavailable or positive cost, and a smaller blast radius, therefore became the primary recommendation (`Not compared`, airline booking not enabled). A later plan with no viable flight left only the programme swap. Known-zero exposure (`0`, empty provider lines) now ranks that internal swap ahead of a paid or unpriced flight when regressions match. Nearest programme movement is a tiebreak after blast radius, ahead of strategy-ref order.

Jordan D3 demo control now applies the provider stage at its own observation time and sets the workspace evaluation clock from `thenStageId` (`overnight_narita_necessary`, `2026-09-29T21:30:00+09:00`). The standalone overnight clock control is `presentation: debug`, so the compact popover omits it and `/demo/control` still lists it.

Jordan research configuration may omit workspace uuids. Passport selection uses the traveller's one matching passport. An existing visit uses that journey's one non-transit visit. A stay replacement binding resolves the reservation from `SOURCE_BOOKING_REFERENCE` and the passport/visit from the single configured source ref, at prepare time, so a reset does not invalidate the file. The demo dataset now declares the Singapore destination visit (`fixtures/programmes/ait-summit-2026/intended-visits.json`). A passport is still not created from nationality: synthetic passport provisioning stays behind `ATLAS_ENV=sandbox` and `NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1`, and hotel research still composes only when `NORTHSTAR_RECOVERY_RESEARCH_CONFIG` points at a file. Boot now uses `recovery-research.json` beside the demo dataset when `NORTHSTAR_RECOVERY_RESEARCH_CONFIG` is unset. That file composes in REPLAY. Boot and demo reset apply `fixtures/programmes/ait-summit-2026/sandbox-execution-inputs.json` only when `ATLAS_ENV=sandbox` and `NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1`. That file creates the synthetic SG passport for `SOURCE_TRAVELLER_DRAFT:ait-draft-09`. Without the marker, passport provisioning stays skipped. A clock-only click after the first plan still does not replan.

Graph/read-model: a reprotection’s arrival card uses the original service’s published arrival as the before-time when that baseline differs from the replacement. The inspector shows that range plus the evaluator’s available/required/shortfall minutes. A pending reassessment on an UNKNOWN node reads Rechecking; a current UNKNOWN stays Unknown. Flight cards include a linked service designator when it is not a UUID.

Recommendation glance: Changes prefers the programme window the option moves. Protects names the people whose verdict moves from not-passing to passing, not the first programme check that already passed. Passing commitment checks stay behind “View all trip checks”.

Overview and Case HTML now load the durable activity feed into the compact rail. The recommendation’s “Directly affected” step uses the projected blast radius, and the wider reassessment list stays behind “View all trip checks”. Active-change framing is centered so the affected traveller stays in the incident box.

The airline demo control now displaces the original bookings, waits at the demo boundary so a polling overview can show “Checking the impact…”, then applies the replacement. A shared service with pending reassessment from that signal reads as changed. The production Overview no longer renders “Apply simulated airline update”; the endpoint remains. Status chips have more internal padding.

Physical evidence on the live REPLAY server (workspace `b96791c7-189f-4a59-ae30-b7cb5e6068b4`): one Sarah trigger reached programme recovery (Headline Interview 11:30→13:30 GMT+8, new spend SGD 0), approval executed, case `09cd53ee-3b55-5e1d-86c0-2e2bf554c79f` RESOLVED / trip PASS. Jordan D1, D2, then D3 (no separate overnight-clock control) opened case `c9789ac5-995b-5eae-9bac-f9717b94d40f` with the overnight plan above. Two `resetDemoWorkspace` attempts failed (`SERIALIZATION_RETRY_EXHAUSTED` on a stay, then `cannot leave LINKED` on the programme external record) and Postgres restarted; do not reset this world again until that materializer conflict is fixed. Deeper reset optimization is Park for Later.

Still open before a PASS verdict: three consecutive Sarah runs from a clean baseline (blocked on reset), and executing Jordan’s external booking (blocked because REPLAY does not compose airline/stay execution).

Do not reopen the hotel penalty amount or the graph colour rule. The comparator change above is the founder-QC economics fix; it does not reopen RC-6.

## Demo Console popover integration (UI-only, cherry-picked)

Cherry-picked `978a2d4b3d7fbfe8614d2e4130622bde5064e95d` (accepted on `finish/a5-1-integration`, parent `b95cfb585ea4c53a3f2ead8dbf318e01e312feac`) onto this branch as `5c6aa82`, then hardened by one follow-up commit fixing a region-patch defect found in physical smoke (see below). Clean cherry-pick; only `test/suites.json` had independent changes on this branch, auto-merged with both new Demo Console test registrations kept alongside all existing hero entries.

Physical smoke on REPLAY founder-QC (workspace `6814cfe1-3ee6-4266-8a14-04b79a8c1412`) found a real defect the automated suite didn't cover: the shell runtime's `shell-topbar` poll region can be region-patched (e.g. the moment a demo trigger changes the decision count), which detached the popover script's one-time-cached `toggle`/`pop`/`overlay` element references — the Demo Console button silently stopped responding after the first state-changing trigger. Fixed in `src/ui/demoConsolePopover.ts` by resolving those elements fresh on every interaction (document-level delegation only) and tracking "controls loaded" on the popover DOM node itself (`data-dc-loaded`) instead of in a module variable, so a freshly-patched popover self-heals. Added a Playwright regression test (`test/e2e/a5-demo-console-popover.e2e.test.ts`) that clones/replaces the `shell-topbar` region mid-session and proves the toggle, popover, and a real trigger still work afterward.

Two live demo triggers during physical smoke reopened Sarah's case in the founder-QC workspace; both were cleaned up with `POST /api/v2/demo/reset` (same endpoint the popover's Reset Demo button calls) and Overview was re-verified back at the 52/0/15 healthy baseline before stopping. No Sarah/Jordan/comparator/backend files were touched — this checkpoint is UI-only (`src/ui/demoConsolePopover.ts`, `src/ui/page.ts`, `src/app/target/targetHttpHandlers.ts`'s `resetChrome()`, plus tests).
