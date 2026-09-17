# ACTIVE TASK — Founder T2: truthful Sarah provider-disruption ingress

Working-memory ledger (AGENTS.md "long-horizon work"). Reread before each major
phase and before declaring completion. Close an item only with evidence.
Archives: the completed AiT baseline (Founder T1) increment ledger is at
`docs/work/AIT_BASELINE_PRODUCT_INTEGRATION_ACTIVE_TASK.md`; the wider Slice A
ledger is `docs/work/SLICE_A_ACTIVE_TASK.md`.

## Goal

`disclosed simulated airline incident` -> `normal HTTP/provider-event boundary`
-> `truthful cancellation + involuntary reprotection semantics` -> `canonical
PostgreSQL mutation` -> `normal dependency invalidation` -> `real M6
reassessment worker` -> `authoritative product state refresh` (auto, no manual
reload). **Stops before automatic RecoveryCase creation** — that is T3.

## Exact identity

- Repo `dropandresetmain-prog/qoder-atlas`
- Branch `feature/sarah-provider-disruption`
- Base = accepted Founder T1 baseline `main` @ `6aba3124f9afea0c4937274f04c6316cad228949` (verified = origin/main at start)
- Never merge to `main`; never force-push.

## Approved incident truth (data/facts only — never application logic)

- Original synthetic Batik service `ID7159` CGK→SIN, 2026-09-30 17:45+07 → 20:30+08 (already the canonical T1 world's published schedule).
- Airline cancels/displaces the original service; **five** existing bookings are involuntarily reprotected.
- Replacement synthetic Batik service `ID7153` CGK→SIN, 2026-10-01 07:45+07 → 10:30+08; fare delta 0.
- Reprotected cohort (upstream provenance: `data/ait-demo-input-pack/scenarios/s1-supplier-disruption/inputs/airline-schedule-change-id7159.json`): drafts `ait-draft-14` (Sarah Lim, PNR IDSYN14), `ait-draft-03` (Felix Hartono, IDSYN03), `ait-draft-10` (Arjun Rao, IDSYN10), `ait-draft-11` (Siti Rahmah, IDSYN11), `ait-draft-30` (Mei Ling Goh, IDSYN30).
- Expected real-evaluator outcomes (asserted as scenario acceptance evidence, never seeded): Sarah FAIL (60 min available < 150 required readiness vs 11:30 headline); Arjun 200 min PASS; Siti 210 min PASS; Mei 210 min PASS; Felix has no Day-1 REQUIRED obligation that the 10:30 arrival violates (16:30 agentic provocation → 360 min).
- **No RecoveryCase is created in T2.**

## Architecture decisions (frozen for this increment)

1. **Provider-event union, generic shape, no new aggregate kind.** The existing
   `ProviderShapedDemoEvent` ingress widens from a single schedule-observation
   payload to a discriminated union: `TRANSPORT_SCHEDULE_OBSERVED` (unchanged
   behaviour) and `TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION` (typed,
   provider-shaped, self-contained: original service external identity +
   replacement service facts + affected provider booking references +
   observedAt + disclosed-simulated marker). No display-name identity; no
   string matching; no scenario names.
2. **Cancellation/reprotection expressed through existing ontology.**
   - Displaced lines: `recordReservationLineObservation` → observedStatus
     `CANCELLED` (provenance-bearing; history preserved).
   - Original service: the canonical record keeps its identity; the incident's
     own evidence/source records carry the cancellation fact (T2 does not add
     service lifecycle columns).
   - Replacement service: `createTransportService` (canonical root, own
     identity from the incident's provider service identity via UUIDv5, never
     a display name).
   - Reprotected bookings: `createReservation` + `addReservationLine` +
     `allocateReservationLine` on the replacement service, one new reservation
     per displaced PNR (per-PNR identity; distinct booking artifacts), linked
     through F08 external records to the provider PNR references.
   - Traveller/Journey/Participation identity: untouched (new allocation rows
     bind replacement lines to the SAME journey items; identity is stable,
     booking artifacts are new).
3. **Rebooking must change booking/service state, not merely an arrival-time
   edit.** The journey's effective itinerary flips to the replacement service
   through new CONFIRMED lines allocated to the same journey items; the old
   lines stay observable as CANCELLED history.
4. **Idempotency** = `providerId + providerEventId` under the existing command
   idempotency ledger; second delivery replays receipts without duplicate
   services/reservations/allocations and without re-enqueued mutations.
5. **Reassessment** = the existing M6 invalidation triggers + worker via the
   normal boot pipeline; no second evaluator.
6. **HTTP trigger** = `POST /api/v2/demo/provider-event` extended for the
   union; founder-visible trigger is a clearly-labelled profile/admin
   "Simulated airline update" affordance (profile popover area, not a hero
   button), with truthful applied/already-applied acknowledgement.
7. **UI auto-update** = sequential full-snapshot polling of
   `/api/v2/operator/overview` (no overlapping requests, authoritative
   snapshot wins, `changedVisibleRefs` hint-only).

## Frozen implementation contracts (verified against source 2026-09-17)

8. **Replacement booking references are synthetic, deterministically derived.**
   The upstream fixture (`airline-schedule-change-id7159.json`) does NOT state
   replacement PNRs (segment notation only: `CGK-SIN ID7159 ? ID7153`). The
   ingress observes/links external booking references
   `REPROTECTED:<providerEventId>:<originalPnr>` (record type
   `SOURCE_BOOKING_REFERENCE`, UNVERIFIED → LINKED on the provisioning
   connection) bound to each new reservation. No provider PNR is fabricated.
9. **ALREADY_APPLIED is granted ONLY by a durable completion marker (F1,
   supersedes the earlier "existence check" contract).** An information
   record is minted with a deterministic id for this provider event and
   written through the idempotent M5 command as the LAST ingress step, after
   every required mutation has committed. Marker present + same canonical
   substance → `ALREADY_APPLIED`. Marker absent → the run is in progress
   whatever partial state exists; re-delivery replays completed commands
   through their receipts and executes the missing ones. Existence of partial
   state never produces ALREADY_APPLIED. Result enum: `APPLIED |
   ALREADY_APPLIED` only (no STALE).
10. **Effective-itinerary flip = two verified code changes, nothing else.**
    (a) `updateJourneyItem` gains `selectedServiceId` support (Params →
    `JourneyItemMutationSchema` travelCommands.ts:167-172 → parsed spread →
    `PgJourneyRepository.updateItem` SQL CASE) — the ingress sets the journey
    item's selection to the replacement service. (b) `projectItem`
    (effectiveItinerary.ts:74-107) computes TRANSPORT bookings/booked services
    from ACTIVE (non-CANCELLED) lines when at least one active line exists,
    falling back to all lines only for the all-cancelled case — a booking
    displaced by this incident but holding a CONFIRMED replacement line
    evaluates on the replacement; a only-cancelled booking stays INVALID so
    `supplier_fulfilment` FAILs (F2, per-item semantics). The displaced lines
    remain observable in canonical state, audit trail, and read models.
11. **Readiness arithmetic re-verified (evaluator memo corrected).**
    `participation.ts:174-177` uses `scheduledArrival: reach.arrival ??
    reach.readyAt` (ARRIVAL first). Sarah: 10:30 arrival → 11:30 obligation =
    60 min < 150 required → FAIL `insufficient_arrival_readiness`. Arjun 200,
    Siti 210, Mei 210 PASS; Felix Day-1 16:30 → 360 min PASS. The memo's
    readyAt-based arithmetic (35/175/185/335) and its "readiness skipped"
    claim are both wrong (materializer sets `requiresPhysicalPresence:
    commitment.placeId !== undefined`, materializeDataset.ts:456-461).
12. **Idempotency mechanics (memo §1.4, verified pgUnitOfWork.ts:141-158).**
    Per-command keys `demo-ingress:<providerId>:<providerEventId>:<sub-key>`;
    REPLAY short-circuits BEFORE revision validation → stale expectedRevisions
    are harmless on replay; different payload under same key →
    `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` → 409. Retry-safe across partial
    failure: committed commands replay, remainder execute.

13. **External-id mappings verified (materializer truth).** Original service
    external id = `externalRefValue(carrierRef) + '@' + toInstant(departure)`
    → `ID7159@2026-09-30T10:45:00.000Z` (materializeDataset.ts:631;
    datasetMapping.ts:22-39 normalizes to UTC ISO). PNRs are observed/linked as
    record type `SOURCE_BOOKING_REFERENCE` (constant
    `SOURCE_RECORD_TYPES.RESERVATION`, externalIdentity.ts:22-35, 860-884).
    Selected service persists on `transport_item_details.selected_service_id`
    (migration 0023; world capture pgWorldReader.ts:115) — updateJourneyItem
    writes it via the detail table.
14. **Domain checkpoint verified (agent, spot-checked).** updateJourneyItem
    accepts `selectedServiceId` (PersistedId.optional; travelCommands.ts:172,
    1061, 1074, 1145; pgJourneyRepository.ts:364-410 writes the detail table).
    effectiveItinerary.ts:88-94 excludes CANCELLED lines from the TRANSPORT
    branch's `lines` set (bookedServiceIds + bookings) — non-TRANSPORT kinds
    unchanged. Two existing unit tests updated where they asserted the old
    INVALID-booking behavior (a cancelled line now yields no effective
    booking). typecheck PASS; current unit suite 749/749 with node 24.

15. **Founder-trigger delivery modes + canonical event fingerprint.** The
    overview trigger POSTs `/api/v2/demo/provider-event/airline-rebooking`
    WITHOUT a body; the route then derives the event from the runtime's
    disclosed input file (`NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE`, read by the
    generic mapper `src/app/demo/providerDisruptionEventSource.ts` — provenance
    must be `SIMULATED_EXTERNAL_EVENT`; replacement flight read from the
    manifest's own segment notation `ORIG-DEST <orig> ? <repl>`; providerId
    from the document's `sourceIds[0]`). A provider-shaped JSON body on the
    same route is a direct delivery. Duplicate detection hashes CANONICAL
    substance (`canonicalDisruptionEventHash`: identity fields, UTC-normalized
    instants, sorted bookings, receivedAt excluded) — the same disruption in a
    different surface formatting replays; a different substance is
    `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` → 409. `airlineRebookingConfigured`
    = workspace has ≥1 external connection AND the event file is configured.
16. **Evaluator fact shape (verified live).** `programme_participation` stores
    readiness minutes (`availableMinutes`/`requiredMinutes`) only on the FAIL
    path; PASS explanations carry reach facts (arrival/readyAt/slack). Sarah's
    FAIL row is the 60-vs-150 evidence; peers prove viability via dimension
    verdict + overall verdict.
17. **Click wiring survives the poll swap.** The trigger button handler lives
    in the page-level polling script (event delegation on document), not in
    the swapped `<main>` markup — swapped-in inline scripts never execute.
18. **F1 crash-retry boundaries are real step boundaries.** Step 6 is split
    into 6a (ALL replacement reservations) and 6b (lines → allocations →
    journey selection per booking), so "all reservations exist but no line
    does" is a reachable, retryable state. Step 6b chains reservation
    revisions from the CURRENT committed head (`readAggregateRevision`), not
    from the reservation command's replayed receipt value, and allocation
    commands pass a deterministic allocation id (payload-hash member) so
    replay never mismatches.
19. **Replacement service identity is connection-scoped, not event-scoped
    (F5).** `canonicalReplacementServiceId` resolves (1) the service's own
    external identity link on the connection when present, else (2) a
    deterministic UUIDv5 mint over the service's schedule identity
    (carrier|departureInstant, workspace+`disruption-replacement-service`
    scope) using the materializer's `transport-service` id kind. Two events
    naming the same real service resolve to ONE canonical TransportService;
    Step 7 skips the observe/link pair when the record is already live-linked
    to that same service (F08 guard forbids re-observing a LINKED record).
20. **F6 mode derivation.** The replacement service mode is derived from the
    original canonical service's `mode` column; a provider MAY state a
    validated `mode` on `replacementService` (vocabulary-checked by
    `validateProviderDisruptionEvent` before any work). No hardcoded 'AIR'.

## Founder T2 test procedure (founder-visible, 5 minutes)

1. Provision PostgreSQL 16 + PostGIS at `localhost:55432` (db/user/password
   `northstar_test`, superuser) and ensure migrations apply.
2. Boot the target app with the dataset and the disclosed event configured:
   ```
   NORTHSTAR_DEMO_DATASET_DIR=fixtures/programmes/ait-summit-2026
   NORTHSTAR_DEMO_DISRUPTION_EVENT_FILE=data/ait-demo-input-pack/scenarios/s1-supplier-disruption/inputs/airline-schedule-change-id7159.json
   PG_TARGET_WORKSPACE_ID=<fresh uuid>
   npm run build && node dist/main.js
   ```
   Boot logs the T1 baseline (67 journeys; 50 PASS / 15 UNKNOWN / 2 FAIL). Note: the
   pre-Phase-B accepted T1 record was 50 PASS / 14 UNKNOWN / 3 FAIL; after the fixture
   change removing Nadia's displaced leg (ait-draft-19, stay-only), the baseline
   updated to 50 PASS / 15 UNKNOWN / 2 FAIL as Nadia transitioned to UNKNOWN.
3. Open `/operator` → Overview. Under the population, open the disclosure
   **"Simulated airline update"** (labelled demo admin affordance, not a hero
   button). Status reads "Ready…" when `demoIngress.airlineRebookingConfigured`
   is true (requires a provisioning connection + the disclosed event file).
4. Click **Apply simulated airline update**. Truthful outcomes only:
   "Applied. Authoritative state will refresh automatically." — the overview
   re-renders within ~2s from the next authoritative poll snapshot (no manual
   reload). Clicking again yields "Already applied. No duplicate incident
   created." (idempotent, 202 ALREADY_APPLIED).
5. Expected truth after the trigger: the five disclosed travellers
   (IDSYN14/03/10/11/30) show the replacement service (1 Oct 07:45→10:30) on
   their journey; Sarah's Day-1 headline interview shows FAIL
   `insufficient_arrival_readiness` (60 min available vs 150 required); the
   four peers stay viable; Nadia (ait-draft-19, stay-only) is untouched and stays
   UNKNOWN. Journey verdicts after the trigger: 49 PASS / 3 FAIL / 15 UNKNOWN
   (exactly Sarah flipped PASS→FAIL). No RecoveryCase appears anywhere in the
   product (T3 boundary).
6. Duplicate/restart safety: re-clicking the trigger never duplicates
   services/bookings; restarting the app and re-reading shows identical
   state; the same event re-delivered with different substance is refused
   (409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).

## Phase checklist

- [x] P0 branch from authoritative base + ledger (archived T1 ledger preserved)
- [x] P1 investigation + frozen contract (this ledger) — checkpoint commit
- [x] P2 generic provider-event union + cancellation/reprotection ingress application command
- [x] P3 canonical mutation path (displaced lines, replacement service, reprotection bookings/allocations) with focused tests
- [x] P4 focused PostgreSQL T2 test: full ingress → mutation → invalidation → real worker → Sarah FAIL / 4 peers PASS / Nadia sixth-traveller question resolved → idempotent replay → restart/re-read → no case
- [x] P5 HTTP handler extension + founder trigger affordance + auto-refresh polling
- [x] P6 affected regressions (m9DemoIngress, productBaselineWorld, typecheck/lint/build/gates) + broader PG gate once at candidate checkpoint
- [x] P7 final candidate commit + push; founder T2 test procedure documented

## Checkpoints pushed (branch `feature/sarah-provider-disruption`)

| Checkpoint | Commit | Evidence |
|---|---|---|
| 1. Investigation + ledger + T1 archive | `b6b7250` (pushed) | T2-1 six-vs-five resolution; frozen decisions 1-7 |
| 2. Domain + ingress + HTTP + UI trigger + focused PG test | `bafdceb` (pushed) | T2 test 12/12; baseline/m6 regressions 23/23; units 749/749; typecheck/lint/build/gate clean; live boot: bodyless trigger APPLIED → ALREADY_APPLIED, verdicts 50P/3F/14U → 49P/4F/14U (exactly Sarah flipped) |
| 3. Final candidate: founder procedure documented, broad PG gate | `82131bd` (pushed) | Full postgres suite 488/488 pass (incl. T2 test); founder T2 test procedure section in this ledger |
| 4. Review fixes F1+F2: completion-marker retry + truthful cancelled-booking semantics | `d104f5a` (pushed) | T2 12/12; m6 units 31/31; typecheck clean |
| 5. Review fixes F1 crash-injection proof + F5 service identity + Nadia test truth (Phase B) | `38cc115` (pushed) | F1 failure-injection 7/7 (3 crash seams: crash → retry APPLIED → complete canonical state → duplicate ALREADY_APPLIED → zero duplicates); F5 reuse test 1/1; T2 12/12 with corrected Nadia stay-only truth and full-drain assertions (67 units); two real retry bugs found & fixed (evidenceId TDZ on retry path; random allocation id replay mismatch); ledger contracts 9/10/18/19/20 updated |
| 6. Review fixes F3/F4/F6/F7 + coherence-gate correction (Phase B) | `92f13ae` (pushed) | F3 HTTP validation 5/5 PG + 10/10 unit (empty-body→demo only when demo env configured; malformed/wrong-kind→400 zero mutation; valid direct body→APPLIED); F4 polling-swap DOM test 6/6 (detail open state + trigger status preserved across 2s polls; server text authoritative); F6 mode derivation asserted `replacement.mode === original.mode` in T2 suite (no hardcoded 'AIR'); F7 selection guard 3/3 PG (non-TRANSPORT + selectedServiceId → validation failure, revision unchanged, no receipt); coherence gate rewritten with documented ait-draft-19 stay-only exception; suites.json registers all 5 new files; units 768/768; boundary gate 187 files clean |
| 7. Final Phase-B candidate: broad CURRENT PG gate + F8/Nadia dispositions in ledger | `9911a81` (pushed) | Full postgres suite 504/504 pass (`node scripts/run-suite.mjs postgres`, 270s) including t2F1FailureInjection 7/7, t2F5ServiceIdentity 1/1, t2F3HttpValidation 5/5, t2F7SelectionGuard 3/3, t2ProviderDisruptionReprotection 12/12; F8 Park disposition documented; typecheck clean. Note: a prior gate attempt stalled on ~97k residue PENDING outbox rows in the shared test DB (test drain-loop in inboxOutbox is linear in residue); truncated test-residue queue tables (outbox, inbox_deliveries, inbox_delivery_conflicts, inbox_work) and re-ran — not a product defect |
| 8. Candidate closure: lint clean + build clean + final SHAs | `1e20a23` (pushed; lint fix) | eslint clean (12 pre-existing errors in the new F4 DOM stub fixed: typed listeners, no `this` aliasing, no useless escapes); F4 test 6/6 after refactor; `npm run build` clean; units 768/768; boundary gate 187 files clean; anti-hardcoding gate CLEAN; broad PG gate evidence from `9911a81` remains valid — the only delta is a type-level refactor of a current-suite test file |
| 9. N1 corridor/operator/schedule guard | `dbc845f` (pushed) | See N1 finding |
| 10. Founder T2 UX: hold SETTLED presentation during RECONCILING; skip no-op settled redraws | `f1fe6a5` (pushed) | Root causes: (1) non-CURRENT assessments collapse population status to UNKNOWN → Confirmed 50→0→rebuild while M6 worker drains PENDING_REASSESSMENT; (2) polling always swapped `outerHTML` every ~2s even when only `generatedAt` moved. Fix: overview publishes `populationAssessmentLifecycle` from authoritative PENDING_REASSESSMENT counts; HTML embeds lifecycle + `data-stable-revision`; polling holds last SETTLED DOM while RECONCILING (shows quiet “Reconciling changes…”), applies only on SETTLED revision change. No FE readiness inference. Focused: overviewPopulationLifecycle 4/4; overviewPollingSwap 9/9; m9-product-surfaces 8/8 |

## Founder T2 retest (defect only — do not redo restart/persistence)

1. Clean Overview at 50 / 2 / 15.
2. Open **Simulated airline update** → Apply.
3. Confirm counts never collapse to 0 or rebuild 0→49; optional quiet “Reconciling changes…” may appear.
4. Settled result is 49 / 3 / 15 and stays visually still under continued polling.
5. Second Apply → Already applied; manual refresh keeps 49 / 3 / 15; no RecoveryCase.

## Nadia six-vs-five resolution (Phase B, supersedes finding T2-1)

The pack SSOT (`data/ait-demo-input-pack/scenarios/s1-supplier-disruption/...`
manifest + traveller drafts) always names exactly FIVE ticketed travellers;
`ait-draft-19` (Nadia Rahman) declares a CONFIRMED STAY only — no
TRANSPORT_LEG, no PNR. The sixth ticket (IDSYN19) was an artifact of the
fixture generator's corridor sweep (`pnrFor()` minting synthetic PNRs for
every co-occupant of a swept service), not upstream truth. Fixed deliberately
in `scripts/reconcile-final-demo-content.mjs` (cohort-scoped legs) and the
regenerated `fixtures/programmes/ait-summit-2026/programme.json` (IDSYN19
count 0; ID7159 exactly the five cohort travellers; generator re-run proven
idempotent). Test truth updated accordingly: the T2 suite now asserts Nadia
has NO reservation/external record/no TRANSPORT journey item (step 5) and her
post-ingress view is CURRENT with her baseline verdict (step 8).

## Coherence-gate correction (Phase B, complements the Nadia resolution)

`test/final-demo-content-coherence.test.ts` still carried a generator-era
over-assertion ("every managed traveller has >= 1 flight leg"), which flagged
`ait-draft-19 missing flight` at line 178. Investigated against the pack SSOT
before touching anything: `roster.json` has 67 travellers / 42
NORTHSTAR_ARRANGED / 25 self, and ALL 42 arranged travellers have empty
`declaredTravel` (the generator assigns stays); Nadia is a REQUIRED FIXED
SPEAKER at the Day-0 14:10 `founder-fireside-b` (`global/anchor-event.json`),
which the ID7159 geometry (lands 20:30 on 30 Sep) could never have served; her
Bayview stay check-in is 29 Sep 15:00+08 (on-site before the incident); and no
`IDSYN19` or `ID7157` ticket exists anywhere in the pack. Conclusion: the
fixture is truthful; the coherence test was wrong. It was rewritten with a
documented `STAY_ONLY_MANAGED = { 'ait-draft-19' }` exception plus
anti-regression guards (no `IDSYN19` substring anywhere in the fixture, no
ID7159 leg for Nadia, her stay check-in pinned to `2026-09-29T15:00:00+08:00`).
8/8 pass.

## F8 disposition: `selected_service_differs_from_booked_service` (Phase B)

**Park with documented evidence — no runtime protection added.** Investigation
(found in `src/resolution/world/effectiveItinerary.ts:102`, emitted when
`selectedServiceId` is not among the booking's active-line booked service ids):

1. The T2 ingress cannot produce a persistent divergence. During partial runs
   the selection (Step 6b) can temporarily point at the replacement service
   while the FINAL line swap (Step 6c) has not yet committed — this is exactly
   the transient state the F1 failure-injection tests exercise. The retry
   reruns the same deterministic steps and completes the swap, after which the
   flag clears. Empirically: a crashed partial run left 5 transient divergence
   rows (one per cohort booking) + 1 test-only row; zero after retry.
2. Every non-ingress writer of `selectedServiceId` sits behind the M2–M6
   command surface (`updateJourneyItem`), which is unreachable from the
   product HTTP surface without a valid operator command — i.e. the flag would
   only persist if an operator deliberately selected a service outside the
   booking's active lines. That is a truthful data-conflict observation, not a
   defect: silently hiding it would be worse.
3. Smallest available protection (NOT implemented): `updateJourneyItem`
   validation rejecting `selectedServiceId` values outside active booked
   lines. Rejected for now because the ingress itself performs a transient
   out-of-line selection mid-flight (Step 6b before Step 6c), so the guard
   would need an ingress-internal carve-out — more risk than value at this
   point. Recorded for a future increment.

Per the F8 mandate, the flag is never silently ignored: it is surfaced through
the normal effective-itinerary divergence channel and its only persistence
path (deliberate operator selection) is a genuine data conflict worth showing.

## Findings / triage

| ID | Finding | Triage |
|---|---|---|
| T2-1 | The accepted T1 world's shared `ID7159` service carries **six** travellers, not five: the sixth is `ait-draft-19` (Nadia Rahman, PNR IDSYN19), genuinely booked on the same service in the canonical fixture. The upstream disclosed airline event's ticketed manifest names exactly five PNRs and does not include IDSYN19; Nadia's only REQUIRED obligation is Day 0 (14:10 fireside on 30 Sep), which the 1 Oct 07:45 departure does not affect. Resolution: the incident-affected booking cohort is derived from the disclosed provider booking references (booking-level truth: reservations whose external record = the provider PNR references), NOT from service co-occupancy; the sixth traveller keeps her original (displaced) booking per the disclosed manifest, is re-derivable from evaluator truth (her Day-0 obligation precedes the cancelled departure), and this is recorded as a source/architecture contradiction to surface rather than special-case logic. | **Act Now — resolved as disclosed-manifest scoping; contradiction surfaced in final report** |
| D1 | Founder procedure baseline counts stale after Nadia fixture change (Phase B). Step 2 baseline and step 5 verdict description out of sync with post-Phase-B truth (50P/15U/2F baseline; 49P/3F/15U after trigger, exactly Sarah flipped). | Fixed (docs) |
| N1 | Re-review of `1d468fc`: an existing replacement TransportService was silently reused with no check against the current event's original service, so a different-corridor event (e.g. TR883 HND→SIN onto ID7153) reprotected travellers onto a CGK-origin service; the F5 test blessed it. | **Fixed** (`9763b96`, `6580f7d`, `5caf97a`): generic guard before Step 3 requires origin/destination/mode, operator, and non-null published departure/arrival (as instants) to match, else `VALIDATION_FAILED` with no mutation. F5 rewritten to reuse same-corridor (fixture has only one CGK→SIN service, so the ID7159 cohort is split across two events); `t2N1ReplacementCorridorGuard` proves corridor/schedule/operator/null-time rejection with zero mutation. Focused PG: N1 2/2, F5 1/1, F1 7/7, T2 12/12, F3 5/5. Parked: replacement-id lookup and mint are workspace-scoped, not connection-scoped. |
| FT2-UX | Founder physical test: Overview visibly collapsed Confirmed 50→0 and rebuilt during reassessment, then flickered forever on every ~2s poll. | **Act Now — fixed** (checkpoint 10): authoritative `populationAssessmentLifecycle` + poll hold/skip-swap; no FE business inference. |

## Critical constraints

- PostgreSQL is the sole runtime. No SQLite. No `test:legacy`.
- No Sarah/persona/carrier/route branching in domain or application code.
- No RecoveryCase creation in T2.
- Browser refresh and duplicate triggers stay idempotent.
- Exact-path staging; no `git add .`; checkpoint + push at every coherent milestone.
