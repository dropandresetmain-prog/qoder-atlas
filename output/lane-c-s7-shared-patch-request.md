# Lane C S7 — shared patch request

**STATUS: DONE** — landed on `integration/final-demo-backend` @ `b7d80aa` (`fix(authority): scope hotel spend/approval rules; enable SGD home FX`).

Lane C does **not** re-implement these shared fixes. This file remains as the audit trail of what was requested and closed.

## Closed shared changes

1. `org-ait-organiser.homeCurrency = "SGD"` (programme rebuilt) — ADR-052 FX path activates for Atlas USD quotes.
2. `SPEND_LIMIT period=NIGHT` scoped to hotel.* operations.
3. `APPROVAL_ABOVE_SPEND` optional `operations` filter; hotel/airfare thresholds scoped.
4. `rule-ait-flight-change-approval.operations` fixed to `["flight.change","flight.cancel"]`.
5. Evidence: `test/final-demo-authority-scoping.test.ts` (4/4).

## S7 expected path (post-fix)

Atlas HND→SIN offer `143.62 USD` → home restatement `193.89 SGD` (budget FX 1.35) → `REQUIRES_HUMAN_AGENT` → organiser decide → execute → `RESOLVED`, with `providerCost` USD + `costDelta` SGD preserved on the case view.
