# ACTIVE TASK — Jordan final closure (fresh baseline → protected execution → RESOLVED)

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas\.worktrees\a5-jordan-transaction-recording`
- Branch: `fix/a5-jordan-transaction-recording`
- Starting SHA: `b67d0d7a54b04f6918064dea0d1a01ec406edf95`
- Sarah is frozen on `finish/sarah-programme-recovery` @ `3e35c6c` — do not touch.

## Scenario truth (recording world)

- TODAY 2026-09-23; original lyf Bugis 29 Sep → 3 Oct (4 nights) booked TODAY as a
  fresh Nuitée sandbox booking. Disruption on 29 Sep.
- Indicative LIVE: original 4n USD 976.04, replacement 3n USD 698.83, Narita USD 35.18,
  TR885 USD 116.96. The CONFIRMED booking amount overrides 976.04.
- `z-xdzAxcv` / USD 670.77 is historical and cancelled — never the active baseline.

## Semantics decided (CP1)

- `cancellationPenalty` = current fee at planning now (0 inside the free window).
- `scheduledCancellationPenalty` = post-deadline exposure. Never a refund.
- `recoverableStayCredit` (+ basis `CONFIRMED_BOOKING_TOTAL_LESS_CURRENT_FEE`) = the
  existing booking's provider-confirmed `bookedTotal` less the current fee. The only
  source of `DISPLACED_STAY_CREDIT`.
- `stay_arrival_date_aligned`: arrival after check-in date needs evidence
  (`late_arrival_retained` / `no_show_cutoff` operands, dataset `lateArrivalEvidence`).
  None → UNKNOWN. Nuitée exposes no machine-readable no-show terms.

## Provider baseline model (CP2)

- Dataset stay carries only a source reference (`source-booking-ref: ait-draft-09-destination-stay`);
  `recovery-research.json` binds `sourceBookingReference`, never a provider booking id.
- `POST /api/v2/demo/provider-baseline` (demo gate) → `bootstrapProviderStayBaseline`: attached-link
  check → provider lookup by deterministic `ns-baseline-…` clientReference → else search/quote/book
  → `getStayContext` → observed `HOTEL_BOOKING` record linked to the RESERVATION on the (created)
  `nuitee` connection. REPLAY replays the recorded chain. Never on boot/Reset.
- `completeStayBinding` uses the attached booking as the stay element; none attached → no stay
  replacement economics (honest unavailability).
- Found gap: nothing in normal runtime created the `nuitee` external connection stay execution needs;
  the bootstrap creates it.

## Checkpoint ledger

- [x] CP1 — hotel contract + no-show/refund semantics (`1a19749`)
- [x] CP2 — fresh sandbox baseline booking + canonical binding (explicit bootstrap), completed
  - Fresh booking `DpnZRH43H` (Nuitée sandbox, lyf Bugis 2026-09-29→10-03, 1 adult), confirmed USD 955.69,
    RFN, free cancel until 2026-09-26T10:00:00Z, then USD 955.69 (full).
  - Fixed real bug found while wiring REPLAY into the D3 planning test: `bootstrapProviderStayBaseline`'s
    deterministic `ns-baseline-…` clientReference was keyed on the internal `reservation_id` uuid, which
    is only stable within one seed lineage — the actual sandbox RECORD run (clone
    `ns_demo_cl_c1e467c8ce574a92`, reservation `39e6f1f7-…`) used a different reservation uuid than the
    canonical `aitFixtureClone.ts` PG test fixture (`bfb1eaa9-…`), so REPLAY of `book` always missed.
    Re-keyed on the stable dataset-level `sourceBookingReference` + stay dates instead; renamed the two
    affected recordings (`nuitee/book`, `nuitee/booking_lookup`) to their corrected content hash —
    same real sandbox response payloads, corrected addressing only.
  - Stale `z-xdzAxcv` tests fixed: `test/a5-hero-seed-truth.test.ts` now asserts the source-binding model
    against the fresh REPLAY stay-context recording; `postgres-integration/a5JordanD3Planning.pgtest.ts`
    now calls `bootstrapProviderStayBaseline` in REPLAY before composing recovery research, resolves the
    stay via `sourceBookingReference` (never asserts the provider booking id), and asserts the corrected
    D3 economics (see below).
  - Repaired local scratch `postgres-integration/a5ProviderStayBaseline.pgtest.ts` (stub HotelCapability,
    5 focused cases: RECORD attach+idempotent, client-reference-lookup recovery, REPLAY never looks up by
    client reference, PROVIDER_CONTEXT_FAILED attaches nothing, unknown source ref fails STAY_NOT_FOUND)
    and registered it in `test/suites.json` (`current` + `postgresFast` + `aitFixtureCloneConsumers`).
  - Point 9 (reset never auto-bootstraps) verified structurally: `src/app/demo/demoReset.ts` has zero
    references to `providerStayBaseline`/`runProviderStayBaseline`; every fixture-clone test in the suite
    starts with no attached `HOTEL_BOOKING` unless it explicitly bootstraps, which is exercised by every
    test above. No dedicated `resetDemoWorkspace` test added — low marginal value over the structural
    guarantee given remaining CP3-CP6 scope.
- [x] CP3 economics fix (accounting double-count, fixed **before** CP3 proper) —
  `src/resolution/planning/recoveryCostComparison.ts`: a CANCEL_STAY effect's current-fee
  (`POLICY_PENALTY_ESTIMATE`) line no longer also lands in `totalHomeAmount` once
  `recoverableStayCredit` is established (even when it nets to exactly zero under full forfeiture) —
  it stays visible in `potentialLossHomeAmount`/`lines` for operator transparency, but the credit line
  alone carries the net effect now. Regression test added in `test/a5-stay-recovery-economics.test.ts`
  proving the exact D3 case (bookedTotal = fee = 955.69) nets to `newSpend` alone, not `newSpend + 955.69`.
  Proven end-to-end at the PG planning level too: the D3 planning pgtest now asserts
  `cancellationPenalty=955.69`, `freeCancellationUntil=undefined`, `scheduledCancellationPenalty=undefined`,
  `recoverableStayCredit=0.00` on the recommended strategy's CANCEL_STAY effect.
  All 22 focused economics/seed-truth unit tests + both PG tests pass; `gate:test-boundary` and full
  `tsc --noEmit` are clean.
- [ ] CP3 (remaining) — Path A/B cost ranking + Case cost UX with fresh evidence. NOTE: Path B UNKNOWN
  gating already exists from CP1 (`src/resolution/evaluation/evaluators/stayArrivalDateAligned.ts`,
  `stay_arrival_date_aligned` dimension, `blocking: true`) — no `lateArrivalEvidence` dataset entries
  exist anywhere for Jordan/lyf-bugis, so `survives` resolves to `null` → UNKNOWN, which should already
  block Path B from auto-recommendation. Remaining CP3 work is Case cost-UX copy (reference
  `lane/a5-cp3-case-cost-ux` @ `d9ab9e2`, do not blindly merge) + confirming end-to-end Path A/B ranking
  behavior in the real Jordan scenario.
- [ ] CP4 — focused graph spine + proposed-service preview
- [ ] CP5 — Chromium D1/D2/D3 acceptance
- [ ] CP6 — protected sandbox execution → RESOLVED + sanitized recordings + REPLAY proof

## Parked

- Unified all-provider LIVE/RECORD master switch — deferred (unchanged).
