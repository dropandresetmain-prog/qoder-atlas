# Atlas `order.do` idempotency / client reference (R4-F2g, review N2)

Question: does Atlas `order.do` support a client reference / `clientOrderNo` / idempotency-like merchant reference, or a read endpoint that finds an order by it? (`clientReferenceFor(intentId)` exists; `payOrder` sends it as `clientOrderNo`; `createOrder` did not send it.)

## ANSWER: NO. Proven empirically against the Atlas SANDBOX (2026-09-19), not guessed.

Probe (scratch script, raw `AtlasClient`, sandbox host only, MNL->CEB, one traveller with a throw-away name, unpaid holds; nothing paid; raw payloads not committed):

| Probe | Result |
| --- | --- |
| `order.do` with an extra `clientOrderNo: "ns-probe-..."` | Accepted silently (status 0, order created). The field is **not echoed** in the `order.do` response nor in `queryOrderDetails.do` (top-level keys listed in atlas-duplicate-order-validation.md: no client reference anywhere). |
| `queryOrderDetails.do` with `{ clientOrderNo }` only | status 0, `orderNo: null` (nothing found). |
| `queryOrderDetails.do` with `{ orderNo, clientOrderNo }` (matching or arbitrary) | Returns the order by `orderNo`; `clientOrderNo` ignored. |
| `order.do` repeated 2x with the SAME session + traveller + SAME `clientOrderNo` | **Two additional distinct orders created** (three orders total). No 318, no idempotent replay. |
| same, with a DIFFERENT `clientOrderNo` | Another distinct order. |
| `orderList.do` (undocumented-in-repo read endpoint, exists) with `{ clientOrderNo: <existing> }` and with `{ clientOrderNo: "does-not-exist" }` | **Identical, unfiltered result** (the field is ignored). It does honour `orderNo`. |
| `orderList.do` with `{ pageNo, pageSize }` | Newest-first page of orders: `orderNo, pnrCode, orderStatus, depDate, airlines, orderCreateTimestamp, paymentTimestamp, paxNames, contactEmail, fromCity, toCity`. |
| `queryOrderDetails.do` with `{ pnrCode }` | Finds an order by the provider-assigned PNR only (not ours). |

Conclusions
1. `clientOrderNo` is not honoured on create and cannot be searched: **do not wire it into `order.do`** (an ignored field would only suggest a guarantee that does not exist). `AtlasFlightTransactionAdapter.createOrder` is unchanged; the `clientReference` stays a caller-side correlation value (and is still sent to `pay.do`, where its effect is unproven and never relied on). The `FlightOrderCreateQuery.clientReference` contract comment no longer claims provider idempotency.
2. Create is **not idempotent**, and 318 (duplicate detection) is not a dependable guard (three same-session creates produced three orders). A blind retry of a timed-out create can create a SECOND held order (and, if the retry then paid, a second charge). Therefore N3's read-only validation of any 318 pointer stays essential, and:
3. A create that timed out with no `orderRef` is **OUTCOME_UNKNOWN** (`request_ref = atlas:clientref:<ref>`, our own reference only) needing human/provider reconciliation. **No retry, no lookup, no pay**; `runExternalReconciliation` cannot find such an order (`STILL_UNKNOWN`). Proven by `postgres-integration/r4AtlasCrashRecovery.pgtest.ts` ("R4-F2g N2": one create ever across 3 passes and 3 sweeps; zero retrieve/pay).

## Finding kept for a future reconciliation aid (not wired)
`orderList.do` can enumerate recent orders read-only (passenger names, route, departure date, creation timestamp, status). It could give a HUMAN (or a future, strictly read-only candidate finder) the list of provider orders created inside an unknown attempt's time window for that traveller and route. It cannot identify "our" order uniquely (no client reference, several same-traveller orders are legal), so it must not auto-adopt or auto-pay; any candidate would still need the N3 `validateExistingOrder` proof plus a human decision. Not implemented: it would add a new provider endpoint to the transaction adapter allowlist.

## Sandbox residue
The probes left 6 unpaid HELD sandbox orders (throw-away traveller `PROBE/ALEXA`, test contact e-mail); holds lapse at their `tktLimitTime` (~30 minutes). No money moved. Two sanitized `order_retrieve` recordings were refreshed (passenger identity redacted).
