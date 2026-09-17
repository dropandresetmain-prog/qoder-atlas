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

## Phase checklist

- [x] P0 branch from authoritative base + ledger (archived T1 ledger preserved)
- [ ] P1 investigation + frozen contract (this ledger) — checkpoint commit
- [ ] P2 generic provider-event union + cancellation/reprotection ingress application command
- [ ] P3 canonical mutation path (displaced lines, replacement service, reprotection bookings/allocations) with focused tests
- [ ] P4 focused PostgreSQL T2 test: full ingress → mutation → invalidation → real worker → Sarah FAIL / 4 peers PASS / Nadia sixth-traveller question resolved → idempotent replay → restart/re-read → no case
- [ ] P5 HTTP handler extension + founder trigger affordance + auto-refresh polling
- [ ] P6 affected regressions (m9DemoIngress, productBaselineWorld, typecheck/lint/build/gates) + broader PG gate once at candidate checkpoint
- [ ] P7 final candidate commit + push; founder T2 test procedure documented

## Checkpoints pushed (branch `feature/sarah-provider-disruption`)

| Checkpoint | Commit | Evidence |
|---|---|---|
| (pending) | | |

## Findings / triage

| ID | Finding | Triage |
|---|---|---|
| T2-1 | The accepted T1 world's shared `ID7159` service carries **six** travellers, not five: the sixth is `ait-draft-19` (Nadia Rahman, PNR IDSYN19), genuinely booked on the same service in the canonical fixture. The upstream disclosed airline event's ticketed manifest names exactly five PNRs and does not include IDSYN19; Nadia's only REQUIRED obligation is Day 0 (14:10 fireside on 30 Sep), which the 1 Oct 07:45 departure does not affect. Resolution: the incident-affected booking cohort is derived from the disclosed provider booking references (booking-level truth: reservations whose external record = the provider PNR references), NOT from service co-occupancy; the sixth traveller keeps her original (displaced) booking per the disclosed manifest, is re-derivable from evaluator truth (her Day-0 obligation precedes the cancelled departure), and this is recorded as a source/architecture contradiction to surface rather than special-case logic. | **Act Now — resolved as disclosed-manifest scoping; contradiction surfaced in final report** |

## Critical constraints

- PostgreSQL is the sole runtime. No SQLite. No `test:legacy`.
- No Sarah/persona/carrier/route branching in domain or application code.
- No RecoveryCase creation in T2.
- Browser refresh and duplicate triggers stay idempotent.
- Exact-path staging; no `git add .`; checkpoint + push at every coherent milestone.
