# Atlas duplicate detection (status 318) is a pointer, not proof (R4-F2e, review N3)

## Problem
`normalizeOrderCreate` mapped status 318 to `HELD` with `orderRef = duplicateOrders[0]`; the dispatcher then paid it. 318 only means "an order for the same passenger + flight already exists" (sandbox message: *Duplicate booking: same passenger + flight already exists*). Nothing proved it was this intent's order, traveller party, price or itinerary.

## What Atlas order retrieve really exposes (real sandbox read, `queryOrderDetails.do`, 2026-09-19)
Top level: `orderNo, pnrCode, orderStatus (0 held / 1 ticketing / 2 ticketed / -3 cancelled), ticketStatus, totalPrice, currency, tktLimitTime, payTime, createdTime, paymentMethod, contact, ...`.
`paxTicketInfos[]`: `name` (`FAMILY/GIVEN`), `gender` (`M|F`), `birthday`, `nationality`, `contactEmails[]`, `contactPhones[]`, `ticketNos[]`.
`routing`: `routingIdentifier` (an opaque, per-search signed string embedding price and a per-request timestamp: it is NOT stable between search and order, so it cannot be compared to the binding's `providerOfferRef`), `fromSegments[]` (`carrier, flightNumber, depAirport, depTime, arrAirport, arrTime` airport-local wall clock), `retSegments[]`.
NOT exposed: any client/merchant reference (`clientOrderNo` sent on create is neither echoed nor searchable, see N2).
`order.do` responses carry the same `paxTicketInfos`/`routing` shape.

## Design
* Adapter (`transactionAdapter.ts`): status 318 still yields the legacy `HELD`+first ref (legacy tests/consumers), and now also sets `FlightOrderOutcome.duplicateOfExisting = { orderRefs: [...all] }`. `FlightOrderStatusView.identity` (new, provider-neutral `FlightOrderIdentity`: passengers, contact e-mails, segments) is derived from order details; absent when the provider gave too little (unparseable/redacted name, no itinerary, a return itinerary).
* `existingOrderValidation.ts` (pure): `validateExistingOrder(view, ExpectedOrderTerms)` -> `MATCH | MISMATCH | INSUFFICIENT`. Compares: order state, passenger count + legal names (multiset) + gender (+ DOB / nationality where both sides speak), booking contact e-mail, origin/destination codes, departure and arrival INSTANTS (airport-local strings through the airport IANA zones), currency (vs ceiling and quote), amount <= authority-frozen ceiling.
* `ExpectedOrderTerms` come from persisted truth only (`loadExpectedOrderTerms`): binding itinerary + quote, protected booking identities/names, `place_external_refs` IATA + `places.time_zone`, the intent's frozen ceiling.
* Dispatcher: on a duplicate pointer it retrieves the order READ-ONLY and validates BEFORE any checkpoint, adoption or pay.
  * MATCH + HELD: checkpoint the ref, ceiling gate on the retrieved total, pay once (as a normal create).
  * MATCH + PAID/TICKETING/TICKETED: checkpoint the ref, NO payment, observe (read-only) to TICKETED.
  * MISMATCH (including cancelled/failed): `FAILURE duplicate_order_mismatch:<codes>` -> OBSERVED_FAILURE. No checkpoint, no pay, no order ref stored.
  * INSUFFICIENT / several candidates / unreadable / no approved terms: `LOST_RESPONSE` with `request_ref = atlas:duplicate-unproven:<refs>:<why>` -> OUTCOME_UNKNOWN for a human. That prefix is deliberately NOT the reconcile key (`atlas:order:`), so reconciliation never adopts an unproven order.
* Recordings: `sanitize.ts` now redacts passenger identity inside `paxTicketInfos` (name, birthday, card/contact fields) while preserving shape; replayed orders therefore have no provable identity (fail closed, and REPLAY never mutates anyway). Two order_retrieve recordings were refreshed from the sandbox with the redacting sanitizer.

## State transitions
No new attempt states. New request_ref marker `atlas:duplicate-unproven:...` on the existing DISPATCHING -> OUTCOME_UNKNOWN transition; mismatch uses the existing DISPATCHING -> OBSERVED_FAILURE.

## Evidence
`test/r4-existing-order-validation.test.ts` (13, no DB): exact duplicate, wrong traveller / party / gender / booker, wrong itinerary, wrong price / currency, cancelled, ambiguous identity, wire mapping, recording redaction, dispatcher decisions. `postgres-integration/r4AtlasCrashRecovery.pgtest.ts` (3 duplicate scenarios through the real pass and the real expected-terms loader).

## Remaining gaps
* The legacy SQLite-era `providerExecution.ts` still pays whatever `createOrder` returns (it is not reachable from the PG target boot; guarded by `test/r4-offer-execution-boundary.test.ts`).
* Multi-segment/return itineraries are compared by first departure / last arrival only; return itineraries are refused as insufficient.
* Sandbox behaviour observed: three `order.do` calls with the same session and traveller produced three distinct HELD orders (no 318). 318 therefore is not a reliable create-idempotency guard (see N2).
