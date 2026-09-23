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
- [~] CP2 — fresh sandbox baseline booking + canonical binding (explicit bootstrap) — booking MADE,
  attach proven via HTTP on RECORD clone; PG test + REPLAY migration of D3 test NOT done
  - Fresh booking `DpnZRH43H` (Nuitée sandbox, lyf Bugis 2026-09-29→10-03, 1 adult), confirmed USD 955.69,
    RFN, free cancel until 2026-09-26T10:00:00Z, then USD 955.69 (full). Attached on clone
    `ns_demo_cl_c1e467c8ce574a92`, reservation `39e6f1f7-17a6-5cc8-8d87-93f895b1c875`.
  - NOTE: at simulated D3 (2026-09-29) the free window is CLOSED → current fee 955.69, recoverable 0.
    Economics must be recomputed from this; the brief's −125.07 assumed an open window.
- [ ] CP3 — Path A/B cost ranking + Case cost UX with fresh evidence
- [ ] CP4 — focused graph spine + proposed-service preview
- [ ] CP5 — Chromium D1/D2/D3 acceptance
- [ ] CP6 — protected sandbox execution → RESOLVED + sanitized recordings + REPLAY proof

## Parked

- Unified all-provider LIVE/RECORD master switch — deferred (unchanged).
