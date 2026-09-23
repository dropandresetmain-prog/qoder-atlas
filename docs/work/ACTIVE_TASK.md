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

## Checkpoint ledger

- [ ] CP1 — hotel contract + no-show/refund semantics
- [ ] CP2 — fresh sandbox baseline booking + canonical binding (explicit bootstrap)
- [ ] CP3 — Path A/B cost ranking + Case cost UX with fresh evidence
- [ ] CP4 — focused graph spine + proposed-service preview
- [ ] CP5 — Chromium D1/D2/D3 acceptance
- [ ] CP6 — protected sandbox execution → RESOLVED + sanitized recordings + REPLAY proof

## Parked

- Unified all-provider LIVE/RECORD master switch — deferred (unchanged).
