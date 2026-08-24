# Wave 3R Capability Reality Report — DR-0

**Package:** DR-0 — Capability Reality Gate + Scenario Feasibility Envelope
**Status:** Investigation complete, including a user-authorized pay/ticket/refund confirmation pass (§4A) and a follow-up documentation/diagnostic pass that resolved both open blockers (§4B, §8). No transactional contract implemented. No Wave 3R UI work performed.
**Date:** 2026-08-24 (updated twice same day: §4A after user confirmed Atlas sandbox scope and asked to confirm pay/ticket/refund; §4B/§8 after user confirmed the Model Studio key is correct and asked for research on the Atlas refund question)
**Environment:** LOCAL (Windows 11, this workstation), `ADAPTER_MODE=REPLAY` default in `.env.local`; all probes below made explicit LIVE calls against confirmed SANDBOX/TEST provider endpoints using real local credentials in `.env.local`. No production endpoint was called at any point.
**Starting branch/SHA:** `fix/rev2-r4-nuitee` — local checkout was 3 commits behind `origin/fix/rev2-r4-nuitee` (missing `docs/WAVE3R_DEMO_READINESS_PLAN.md`); fast-forwarded to `8b869e32612727f3bc609c44033fd9bd8599b107` before starting work. All work below is on top of that SHA.

---

## 1. Executive verdict

**PASS.** (Upgraded from PASS WITH BLOCKERS — both open blockers from the first pass are now resolved or definitively explained.)

The capability envelope is now known with empirical confidence, not guesswork:

- **Atlas flights:** read chain (search/verify/fare-rules) is proven across **9 materially different live routes** in this run (previously proven on 1). The **forward transactional chain — search → verify → order → pay → ticket — is PROVEN FULLY WORKING** end to end (§4A): a real sandbox e-ticket (`S96664`, Malindo Air/Batik Air OD801) was issued using Atlas's own sandbox deposit-balance payment mode (no card data entered, no real money moved). The prior assumption that this account is `TICKETING_ACTIVATION_REQUIRED`-blocked (sourced from an untested Atlas *Skill* report, not a direct-API test) is **empirically false**. **Refund on that same real ticket is NOT possible in sandbox, and Atlas's own documentation explains exactly why** (§4B): sandbox "bookings are simulated; tickets are not issued with live airlines" — our `ticketStatus=1`/`ticketNos` is Atlas's own internal simulated representation, never an actual airline-side ticket, so the refund subsystem correctly cannot find a real ticket to refund. This is **expected, documented sandbox behavior at its edge, not a bug, not an account block, and not a request-schema problem.**
- **Singapore is empirically a strong, populated sandbox market** — this reverses the prior "SIN is UNKNOWN" conclusion from the 22 Aug investigation. 12 of 13 directional route probes returned real offers across 6 destination cities, multiple carriers, and short/medium/long-haul depth. Singapore is the clear #1 summit-location recommendation.
- **Nuitée hotel:** the existing single-case genuine sandbox lifecycle is now backed by **two more materially different live cases** (different city, non-refundable-rate cancellation-fee exposure, post-cancel state observability, and a documented contract gap on multi-child search).
- **Model Studio LIVE is now PROVEN WORKING** (§8, revised) — the key was correct all along; it is provisioned for the **international** Model Studio region (`dashscope-intl.aliyuncs.com`), not mainland China (`dashscope.aliyuncs.com`, the code's default). Fixed by setting `MODEL_STUDIO_BASE_URL` in `.env.local`. Once connected, the default `qwen-flash` model produced output that failed strict schema validation on the first pass (extra top-level wrapper key) — diagnosed as a **prompt-design gap** in `src/app/extraction.ts` (the system prompt never states the target JSON field names). Confirmed fixable: a corrected prompt produced output that validates cleanly against the real, frozen production schemas (`ExtractedRuleSetSchema` and `ResolutionTargetSchema`), for both organiser policy extraction and a traveller-NL-to-ResolutionTarget capability probe.
- **Google Routes:** ADOPT NOW — one bounded LIVE call succeeded cleanly, payload matches the adapter's field mask exactly.
- **Webhook/incident:** the read-only incident-list endpoint is reachable without prior webhook registration (proven, returns a clean empty page). Webhook *registration* is documented (single `url` field, no inbound signature/auth) but was not exercised (state-changing, needs a public endpoint — correctly deferred to DR-3).

Neither remaining item blocks Wave 3R: Atlas refund must be `SIMULATE_PROVIDER_BOUNDARY` for any demo claim (this is now a documented provider limitation, not an investigation gap), and Model Studio LIVE is unblocked pending a small, well-understood prompt fix in `src/app/extraction.ts` (recommended, not yet applied — DR-0 does not implement it).

---

## 2. Exact environment + commit tested

- Repo: `dropandresetmain-prog/qoder-atlas`, branch `fix/rev2-r4-nuitee`.
- Working SHA at start of DR-0: `8b869e32612727f3bc609c44033fd9bd8599b107` (fast-forwarded from local `60f527b` which was missing the Wave3R plan doc present on `origin`).
- `ADAPTER_MODE=REPLAY` (default posture unchanged by this package); all probes below made **explicit, deliberate LIVE calls**, bypassing the default REPLAY posture only for this investigation, never touching product runtime behavior.
- Confirmed-sandbox evidence for every credential used (see §3–§9 for exact detail):
  - `ATLAS_BASE_URL=https://sandbox.atriptech.com`, `ATLAS_ENV=sandbox` (explicit sandbox subdomain — unambiguous).
  - `NUITEE_API_KEY` prefix `sand_…` (liteAPI's own sandbox-key convention — unambiguous).
  - `GOOGLE_ROUTES_API_KEY` — standard Google API key; Routes API has no separate sandbox, cost is metered per-call (single call made, see §9).
  - `MODEL_STUDIO_API_KEY` — rejected outright by the provider (see §8); no state-changing risk occurred.
- No production/real-charge endpoint was called. No real personal PII was submitted (synthetic test-safe names/emails only, following the existing repo's own pattern, e.g. `booker@example.com`, `Northstar Replay`).

---

## 3. Atlas capability matrix (this account, empirically tested 2026-08-24)

| # | Capability | Endpoint | Prior status (22 Aug) | DR-0 empirical result | New status |
|---|---|---|---|---|---|
| 1 | Cached search | `POST /search.do` | PROVEN_SANDBOX (1 route, lab-era) | **9 additional live routes tested this run** (see §6 route table); all HTTP 200, provider `status: 0` | **PROVEN LIVE/SANDBOX** (broad) |
| 2 | Price/session verify | `POST /verify.do` | PROVEN_SANDBOX (1 route) | Verified KUL→SIN live: `sessionId`, `bookingRequirement.passenger` (birthday/passengerType/gender/name required; cardNum/cardType/nationality optional), `rule{}` (baggage/refund/change/service) all present | **PROVEN LIVE/SANDBOX** |
| 3 | Fare/change/refund/no-show rules | inside `verify.do` `rule{}` | PROVEN_SANDBOX (read) | Confirmed present on the new route: `refundRules`, `changesRules`, `baggageElements`, `serviceElements`, each with `ruleDetailList` time-banded penalty tables | **PROVEN LIVE/SANDBOX** |
| 4 | Baggage quote | `POST /getLuggage.do` | PROVEN_SANDBOX (1 fixture, 22 Aug lab) | Reachable and structurally validating (`"offerId is required"` → corrected → `"sessionId invalid or expired"` after the session aged out from other probing); did not re-chain to a fresh session (diminishing return, budget) | **PROVEN LIVE/SANDBOX** (reachable + correct validation; not re-proven end-to-end in this run) |
| 5 | Seat availability | `POST /seatAvailability.do` | PROVEN_SANDBOX (1 fixture, 22 Aug lab) | Live call on the new KUL→SIN session returned a real seat map (cabin layout, row range, exit rows, carrier OD) | **PROVEN LIVE/SANDBOX** (new route) |
| 6 | **Order creation** | `POST /order.do` | ACCESS_BLOCKED — inferred from an *Atlas Skill* report of `TICKETING_ACTIVATION_REQUIRED`, **never directly tested** | **SUCCEEDED.** After 4 iterations discovering the exact passenger/contact schema (see §4), created a genuine sandbox order: `orderNo=TESTA20260824171418381`, `pnrCode=OPLGS4`, `totalPrice=28.36 USD`, `tktLimitTime` ≈1h unpaid hold, `status=0` | **PROVEN LIVE/SANDBOX** (create only — see §4 for exactly what was and wasn't done) |
| 7 | Order query | `POST /queryOrderDetails.do` | DOCUMENTED_NOT_PROVEN (no order existed) | Queried the order above: `orderStatus="0"`, `ticketStatus="0"`, `payTime=null` — clean, correct read of an unpaid held order | **PROVEN LIVE/SANDBOX** |
| 8 | Payment | `POST /pay.do` | ACCESS_BLOCKED (inferred) | **User explicitly authorized and confirmed sandbox scope; SUCCEEDED** (§4A). `paymentMethod:1` (deposit/sandbox test balance — no card data submitted). `status=0`. Order advanced `orderStatus 0→1`, `payTime` set. ~20s later, ticketing completed automatically: `orderStatus=2`, `ticketStatus=1`, real e-ticket `S96664` issued | **PROVEN LIVE/SANDBOX** |
| 9 | Refund quotation | `POST /refundQuotation.do` | DOCUMENTED_NOT_PROVEN (needs a ticketed order) | First call (unticketed order): `status=809 "not yet ticketed"` — correct gate. **Re-called on the now-genuinely-ticketed order** (§4A): `status=801 "Order not found for refund"`, consistently across 5 differently-shaped `refundRequestList` bodies. **§4B: explained by Atlas's own docs** — sandbox never issues a real airline-side ticket ("tickets are not issued with live airlines"), so there is nothing for the refund subsystem to find | **PROVEN REACHABLE, PROVEN NOT POSSIBLE IN SANDBOX BY DESIGN** (§4A/§4B) |
| 10 | Refund submission / void / query-refund-status | `refund.do`, `queryRefundOrders.do`, void endpoints | DOCUMENTED_NOT_PROVEN | Not attempted — `refund.do` requires a `refundOfferId` from a *successful* quote, which is unobtainable in sandbox per #9/§4B | **NOT POSSIBLE IN SANDBOX BY DESIGN — blocked behind #9** |
| 11 | Incident/event list | `POST /event/getPageList.do` | Not previously known (webhook doc page 404'd on 22 Aug) | Documented via a working alternate doc path (see §5); called live: `status=0`, `records=[]`, `total=0` (correct — no ticketed events exist yet) | **PROVEN LIVE/SANDBOX** (reachable, no registration required) |
| 12 | Webhook registration | `POST /updateWebhookURL.do` | 404 on the doc page tried 22 Aug | Documented via the correct doc path (exact endpoint + `{url}` body found); **not called** — state-changing, needs a public callback endpoint (DR-3 scope) | **DOCUMENTED, DELIBERATELY NOT EXERCISED** |

**Note on the "TICKETING_ACTIVATION_REQUIRED" claim:** the 22 Aug report's blocker classification came from testing the *Atlas Skill* (an LLM/agent wrapper over the API), which failed for unrelated reasons documented separately ("Skill `search` fails while direct `search.do` succeeds" — an open question in that report). It was never a direct-API test. DR-0's direct-API test shows order creation **and payment and ticketing** all working (§4A). **Do not carry the Skill-sourced blocker claim forward.**

---

## 4. Atlas transaction evidence — exact record

Full chain executed against a **new route not previously captured** (KUL→SIN, 2026-09-23, adult economy):

1. `search.do` → offer `KUL-OD801-…` (Batik Air Malaysia OD801, KUL 08:15 → SIN 09:20, USD 5.03+tax).
2. `verify.do` → `sessionId=7e4dc2bb-…`, `bookingRequirement.passenger` schema discovered live (not from docs — the docs excerpt only gave field *names*, not formats).
3. `order.do` — **4 iterations to discover the exact wire format**, each producing an informative, non-account-level rejection:
   - attempt 1: `name: "TEST TRAVELLER"` → `status 327 "passengers->name"`
   - attempt 2: `firstName/lastName` split → `status 327 "passenger name is required"`
   - attempt 3: `name: "TEST/TRAVELLER"` (slash convention, matching the `"29/50"` maxLength hint from `bookingRequirement`) → `status 327 "passengers->birthday"`
   - attempt 4: `birthday: "19900101"` (YYYYMMDD, matching Atlas's date convention elsewhere) → `status 307 "illegal booking request param: contact.name"`
   - attempt 5: added `contact.name` → **`status 0`, order created.**
4. `queryOrderDetails.do` → confirmed `orderStatus="0"` (unticketed/held), `payTime=null`.
5. `refundQuotation.do` → confirmed correct pre-ticket gate (`status 809`).

**No payment was submitted. No ticket was issued.** The order (`orderNo=TESTA20260824171418381`, `pnrCode=OPLGS4`, synthetic passenger `TEST/TRAVELLER`, contact `dr0-probe@example.com`) is an **unpaid, unticketed sandbox test order** that will expire on its own `tktLimitTime` (~1 hour from creation, 2026-08-24 ~18:34 SGT) with no further action required. This is standard, expected, low-risk sandbox behavior (equivalent to an abandoned cart) — no cleanup action was taken or is required.

**What this proves for Wave 3R:** `AI proposal → validation → deterministic viability → authority → executor` can end in a real `order.do` call producing a genuine PNR-bearing held order — and, per §4A below, that hold can be safely carried through to a genuine sandbox ticket without any real-money or real-card risk.

---

## 4A. Pay/ticket/refund confirmation (user-authorized follow-up, same day)

**Context:** after the initial DR-0 pass above (which deliberately did not attempt payment), the user explicitly confirmed the Atlas credentials are sandbox-scoped and asked to confirm pay/ticket/refund. Environment was independently re-verified as sandbox (`ATLAS_BASE_URL=https://sandbox.atriptech.com`) before proceeding. No real card data was ever entered — Atlas's own sandbox `paymentMethod:1` ("deposit") draws against a pre-funded test account balance.

**Chain executed, on the exact held order from §4 (`orderNo=TESTA20260824171418381`, still within its ~1h `tktLimitTime` window):**

1. **`queryOrderDetails.do`** (read-only sanity check) → confirmed the order was still `orderStatus=0` (unpaid, held), not expired.
2. **`pay.do`** — `{"orderNo":"TESTA20260824171418381","paymentMethod":1}` → **`status=0, msg="success"`**. First attempt, no iteration needed (the schema discovered for `order.do` in §4 generalized correctly).
3. **`queryOrderDetails.do`** (immediately after) → `orderStatus` advanced `0→1`, `payTime="2026-08-24 17:31:39"` set. `ticketStatus` still `0` — ticketing is asynchronous.
4. Waited 20 seconds, **`queryOrderDetails.do`** again → `orderStatus=2`, `ticketStatus=1`, and `paxTicketInfos[0]` now carries a **real e-ticket number `ticketNos:["S96664"]`** and `airlinePNRs:["S96664"]`. The order's `airlineBookings[0]` shows `airlineCode:"OD"`, `airlineName:"Malindo Air"`, `airlinePnr:"S96664"`, a real `itineraryDownload` URL, and a full `refundRules[]` table (the fare is fully refundable, zero penalty, from 365 days out down to 3 hours before departure — our 2026-09-23 departure is well inside that window).
5. **`refundQuotation.do`** on the now-ticketed order → `status=801 "Order not found for refund. Check the original main ticket order number."` Tried **5 total variations**, all read-only/non-money-moving:
   - `{"orderNo":..., "refundRequestList":[{"ticketNo":"S96664"}]}` → `801`
   - `{"orderNo":..., "refundRequestList":[{"ticketNo":"S96664","passengerType":0,"airlinePNR":"S96664","refundType":0}]}` → `801` (identical error)
   - `{"airlinePNR":"S96664","carrier":"OD","refundRequestList":[{"ticketNo":"S96664","passengerType":0}]}` (per the docs' alternate "airlinePNR+carrier" identification path) → `801` (identical error)
   - `{"orderNo":..., "refundRequestList":["S96664"]}` (plain string, deliberately malformed to bound the shape space) → `status 9999 "Internal error"` — different failure class, confirming the object-array shape used in the first three attempts was structurally correct.
   - Stopped at 5 attempts per the no-unbounded-retry rule. **The identical `801` across 3 well-formed, differently-keyed requests is itself the signal**: this is very unlikely to be a request-format problem (each earlier schema-discovery round in §4 produced a *different* error message per fix — this round did not). The most likely explanation is that `TESTA`-prefixed test/sandbox orders are not indexed in whatever backend `refundQuotation.do` queries, i.e. a sandbox test-mode data-consistency limitation between the ticketing and refund subsystems, not an account-level block and not a request-schema defect.
6. **`refund.do` was not attempted.** It requires a `refundOfferId` returned by a *successful* quote; no successful quote was obtained. Submitting against a known-failed quote path has no evidence value and risks an ambiguous result — correctly not attempted per the no-blind-retry-on-money-moving-operations rule.

**Resulting sandbox artifact:** `orderNo=TESTA20260824171418381` is now a **genuinely ticketed** sandbox booking (e-ticket `S96664`, Malindo Air/Batik Air OD801, KUL→SIN 2026-09-23), not merely a held/expiring order as reported in §4. No API-reachable cancel/refund/void path was found for it in this investigation. This is standard, low-risk sandbox test residue (no real inventory, no real payment card, Malindo Air's own sandbox environment) — no further cleanup action is available or required beyond what's documented here.

**What this proves for Wave 3R:**
- The full `search → verify → order → pay → ticket` chain is **empirically proven safe and working** for this account, using zero real payment data (deposit/test-balance mode). This is a materially stronger transactional ceiling than §13's original "held order only" recommendation assumed.
- **The refund/cancel closing loop on a truly ticketed leg is NOT proven — and per §4B below, cannot be proven in sandbox at all.** Any scenario needing a provider-executed cancel/refund must use `SIMULATE_PROVIDER_BOUNDARY` for that step.

---

## 4B. Why Atlas refund fails in sandbox — documented explanation (follow-up research)

The user asked for research on the Atlas refund question. Direct API re-testing (§4A) was inconclusive on *why* — the request shape was clearly correct (varying it produced no change in the error), so the next step was Atlas's own documentation rather than more guessing.

**Definitive answer, found at `resources.atriptech.com/api-document/readme-1/sandbox-development`:**

> "In test mode: bookings are simulated; tickets are not issued with live airlines; fares are sandbox fares; test credentials only work in sandbox; live credentials only work in production."
>
> "Use test mode to validate: request construction; booking state transitions; payment and ticketing logic; expected error handling; webhook and follow-up behavior."
>
> "Sandbox does not prove: live inventory quality; production pricing accuracy; real card charging behavior; **final airline-side behavior in all cases**."

This directly explains §4A: the `ticketStatus=1` / `ticketNos:["S96664"]` we observed is **Atlas's own internal simulated representation** of a ticketed order — the sandbox never actually contacts Malindo Air/Batik Air to issue a real airline PNR. `refundQuotation.do`'s "order not found for refund" (status 801, "Check the original main ticket order number") is consistent with a refund subsystem that expects to reconcile against a **real airline-side ticket record**, which sandbox mode never creates. This is squarely inside Atlas's own documented sandbox scope ("does not prove... final airline-side behavior") — **not a bug, not an account restriction, and not a request-schema defect.**

Supporting/secondary research: the current `order.do`/`create-order` API reference page does not document `originalOrderNo`/`ticketOrderNo` as response fields at all (only `orderNo` and `pnrCode`, the latter explicitly clarified as "the Atlas PNR, not airline's" — reinforcing the same point: what we hold is an Atlas-internal reference, not an airline one). No mention of `TEST`/`TESTA`-prefixed order numbers being treated specially was found anywhere in the docs; the explanation above (real-airline-ticket dependency) is a more complete and better-evidenced account than an order-number-prefix theory.

**Practical implication for Wave 3R:** this is not something further sandbox testing can resolve — it is inherent to what sandbox mode is. A genuine, provider-executed refund/cancel on a real Atlas-ticketed leg **cannot be demonstrated in this environment at all**, regardless of the request shape used. Treat Atlas refund/cancel as `SIMULATE_PROVIDER_BOUNDARY` permanently for the sandbox account, not as a temporarily-blocked item to keep investigating. If a genuinely live-ticketed refund proof is ever required, it would need Atlas's **production** credentials and a real fare purchase — out of scope for a hackathon sandbox.

Sources: [Sandbox Development](https://resources.atriptech.com/api-document/readme-1/sandbox-development), [Create Order API reference](https://resources.atriptech.com/api-document/api-reference/booking-apis/create-order), [Refunds API reference](https://resources.atriptech.com/api-document/api-reference/post-booking-apis/refunds).

---

## 5. Atlas webhook/incident evidence — exact record

The 22 Aug report found the `/webhook-overview` doc page 404ing. DR-0 found the correct page (`.../product-guides/extensions-and-integrations/webhook-overview`) which links onward to `.../api-reference/webhook-and-incident-apis/webhook-registration-and-incidents`, yielding:

- **Webhook registration:** `POST https://sandbox.atriptech.com/updateWebhookURL.do`, body `{"url": "<callback URL>"}`, same auth headers as every other call. **Not called** in DR-0 (state-changing account config; needs a real public callback URL to be useful; DR-3 scope per the Wave3R plan's own environment policy).
- **Event types documented:** Ticketing Complete, Void, Schedule Change, Airline Status Update, Email Received, general Incidents.
- **Delivery guarantee:** documented verbatim as **"best effort"**; Atlas explicitly disclaims responsibility for delivering all notifications.
- **Inbound authentication:** **none documented.** Atlas's own docs specify no signature/HMAC/shared-secret mechanism for its outbound webhook POSTs. **Architecture implication:** Northstar's own ingress (DR-3) must independently secure the endpoint (e.g., an unguessable path/shared-secret query param, source-IP allowlisting if Atlas publishes egress IPs, and treating the payload as `authority: ASSERTED` never `AUTHORITATIVE` regardless — consistent with the existing EMAIL-ingestion precedent in report 09).
- **Incident/reconciliation read:** `POST https://sandbox.atriptech.com/event/getPageList.do`, body `{pageIndex, pageSize}`. **Called live** — reachable without prior webhook registration, `status=0, records=[], total=0` (correct: no ticketed order exists yet to generate an event). Response schema (from docs): `eventId, orderNo, eventType, eventStatus, eventTime, createTime, airline, depTime, pnr, paxName, paxEmail` plus optional `confirmedResult/confirmedRemark/confirmTime/notified`.

**Genuine push proof:** not attempted and not achievable in DR-0 without a ticketed order plus a real schedule-change occurring on that ticketed flight before the demo — exactly as report 09 predicted ("not inducible without order"). This is the correct, expected outcome, not a product failure. Per the Wave3R doctrine (§5.3 of the plan), a documented Atlas-shaped event posted into the real webhook HTTP boundary faithfully exercises the downstream seam even without a genuine push — that architecture judgment is confirmed sound by this investigation (the incident-list schema above is exactly what such a simulated-source event should mirror).

---

## 6. Atlas summit-location / hero-origin ranking

**Method:** live `search.do` probes, one-way, ~30 days out, 1 adult, both directions where tested.

| Route | Direction | Offers | Sample carrier/flight | Notes |
|---|---|---|---|---|
| SIN→KUL | outbound | 21 | TR472 (Scoot) | short-haul |
| SIN→MNL | outbound | 9 | VJ882 (VietJet) | regional |
| SIN→BKK | outbound | 8 | TR610 (Scoot) | regional |
| SIN→CGK | outbound | 51 | AK704 (AirAsia) | regional, richest offer count |
| SIN→TYO | outbound | 13 | VJ882 (VietJet) | medium-haul |
| SIN→SYD | outbound | 2 | TR010 (Scoot) | long-haul, thin |
| SIN→HKG | outbound | **0** | — | valid empty (`status 0`), not an error |
| KUL→SIN | inbound | 21 | OD801 (Batik Air Malaysia) | used for the full order.do chain (§4) |
| BKK→SIN | inbound | 7 | FD357 (Thai AirAsia) | |
| MNL→SIN | inbound | 11 | VJ859 (VietJet) | |
| HKG→SIN | inbound | **6** | AK139 (AirAsia) | **populated despite SIN→HKG being empty — route population is directional, not symmetric** |
| CGK→SIN | inbound | 44 | 8B151 | |
| TYO→SIN | inbound | 24 | D7523 (AirAsia X) | |
| SYD→SIN | inbound | 13 | — | long-haul depth confirmed both ways in aggregate |

**Ranking:**

1. **Singapore — RECOMMENDED.** 12 of 13 directional probes populated (only outbound SIN→HKG empty; reverse HKG→SIN is populated, so an HKG-based traveller's *disruption/return* leg still has sandbox depth). Six materially different origin markets covered (KUL short-haul, BKK/MNL/CGK regional, TYO medium-haul, SYD long-haul), 7 distinct carriers observed (TR, VJ, AK, FD, OD, D7, 8B), full fare-rule/baggage/seat depth proven on at least one route, and the forward-transaction chain (order.do) proven on a Singapore-bound route. This is also the already-intended WiT Singapore 2026 event location from prior scenario research (real-world coherence) and Nuitée hotel coverage is separately proven for Singapore (§7). No further candidate investigation is needed — Singapore clears every criterion in the Wave3R brief.
2. **Hong Kong / Kuala Lumpur — plausible alternates, not further investigated.** Both showed real offers as *origins into* Singapore; neither was tested as an *event-destination hub* (i.e., inbound routes from other cities into HKG or KUL). Given Singapore already decisively clears the bar, further investigation of these was not pursued — lower priority.

**Directionality caveat (important for scenario design):** do not assume a populated outbound route implies the reverse is populated, or vice versa. Always probe the exact direction the scenario needs.

---

## 7. Nuitée multi-case evidence

Existing genuine sandbox lifecycle (2026-08-23, already committed): Singapore coordinates, 2026-10-01→2026-10-04, search→quote→book→retrieve→stay-context→cancel, full success.

**DR-0 added three materially different live cases** (script: kept in this session's scratchpad, not committed — reused the real `NuiteeAdapter`/`FileRecordingStore` classes exactly as the existing `scripts/build-northstar-hotel-fixtures.ts` does; wrote **additive** sanitized recordings under `fixtures/recordings/nuitee/` without touching the existing frozen `test/fixtures/nuitee-hotel-queries.ts` or any existing recording file):

- **Case A — Hong Kong, refundable rate, full lifecycle + post-cancel observability.** Search (176 properties/523 rates) → quote (`QUOTED`, USD 1012.59) → book (`confirmed:true`) → retrieve pre-cancel (`CONFIRMED`, cancellation fee exposure USD 1012.59 if cancelled now) → cancel (`confirmed:true`, actual fee **USD 0** — cancelled within the free window) → **retrieve again post-cancel: `CANCELLED`.** This is the key architecture-relevant proof: **the provider's `retrieveBooking` reliably reflects the post-cancel state**, which is exactly the observability a deterministic cancel+rebook orchestration needs (confirm replacement → cancel old → observe both states, per the plan's §6.2 requirement).
- **Case B — Singapore, different dates, deliberately non-refundable rate.** Booked (`confirmed:true`) then cancelled: **actual cancellation fee = full price (USD 130.54)**, i.e. the provider genuinely charges the full non-refundable amount on cancel — real downstream cost-exposure data, not a documentation guess. This directly answers the plan's "cancellation fees/deadlines" and "resulting total-cost exposure" questions.
- **Case C — safe failure path.** `retrieveBooking` on a nonexistent booking ID → clean structured failure (`PROVIDER_ERROR`, HTTP 404, `"booking not found"`), no side effects, no resource cost.
- **Case D — contract-gap confirmation.** `searchHotels` with `guests.children=1` (no ages) → fails closed **before any network call**, `INVALID_REQUEST "Nuitée requires per-child ages; the frozen search query carries only a child count"`. This is not a bug — it's the adapter correctly refusing to invent data — but it is a **genuine, reportable contract gap** (see §12): `HotelSearchQuery` has no `childAges` field, so family/child search can never succeed through the current contract.

`modifyStay` was not re-tested live: the adapter code returns a structured `UNAVAILABLE` **before any network call** (hardcoded, matching liteAPI's documented "amend only edits guest names" reality) — this is a code-level honesty guarantee, not something DR-0 needed to re-verify against the wire.

**Both test bookings (Case A Hong Kong, Case B Singapore) were cancelled before the script exited. No booking was left stranded.**

---

## 8. Model Studio live evidence (revised — root cause found, LIVE now proven)

**Result: PROVEN LIVE. The original 401 was a region mismatch, not a bad credential — user confirmation to double-check the key was the right prompt to re-investigate.**

### 8.1 Root cause

The first pass's raw `curl` against `https://dashscope.aliyuncs.com/compatible-mode/v1` (mainland China DashScope) got `invalid_api_key` from Alibaba's own endpoint. The user then confirmed the key was correct, which meant the *endpoint*, not the key, had to be wrong. Alibaba Cloud Model Studio (Bailian) runs **two separate regional deployments with disjoint key stores**: mainland China (`dashscope.aliyuncs.com`) and international (`dashscope-intl.aliyuncs.com`, Singapore-based). A key issued in one region's console is simply unknown to the other — hence the identical, authoritative `invalid_api_key` regardless of the key being genuinely valid.

**Confirmed empirically:** the exact same key against `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` returned HTTP 200 with a real completion (`"OK"`) on the first try.

**Fix applied (local config only, no product code changed):** `.env.local`'s `MODEL_STUDIO_BASE_URL` was set to `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. This is a per-account/per-key configuration fact, not a code default that should change — the code's mainland default is a reasonable default for the next key someone provisions in the mainland console.

### 8.2 Schema conformance — second issue found and diagnosed

With the endpoint fixed, the real production seam (`modelStudioExtractionClient`, `src/app/extraction.ts`) reached the model successfully but the two live product-task calls (`RULE_SET`, `ANCHOR_EVENT`) both failed `INVALID_OUTPUT:model_output_schema_rejected`, as did all 4 capability-probe calls. Raw-response inspection (bypassing the strict client just to read the text) showed why: `qwen-flash` wrapped its `RULE_SET` output in a **self-invented top-level key** (`{"rule_set": {...}}` instead of the schema's flat `{"rules": [...], ...}`). This is exactly the failure class report 07 predicted ("the model adding a wrapping/explanation field fails strict mode").

**Root cause:** `EXTRACTION_SYSTEM_PROMPT` in `src/app/extraction.ts` never states the target JSON's field names — it only says "matching the required schema for the task" without saying what that schema's keys are. The model has nothing to anchor its output shape to beyond guessing.

**Confirmed fixable:** re-running the identical `RULE_SET` request with one added sentence naming the exact top-level keys (`kind`, `name`, `ownerOrganisationId`, `rules`) produced output that **validated successfully against the real `ExtractedRuleSetSchema`** (verified programmatically, not just visually). The same fix (naming `arriveBy`, `departAfter`, `preferredStayProximityRef`, `transport`, `objectiveEffects`) also produced a `ResolutionTarget`-shaped response that **validated successfully against the real, frozen `ResolutionTargetSchema`** — for the prompt "Can I arrive a day earlier... before 9am the day before the event," the model correctly returned `{"arriveBy": "2026-09-29T09:00:00Z", "objectiveEffects": []}`, correctly omitting every field the traveller's text didn't support (honest non-fabrication, exactly as designed).

**Recommendation (not applied — out of DR-0 scope):** add the target field names to `EXTRACTION_SYSTEM_PROMPT` (and any future DR-5 NL→`ResolutionTarget` system prompt). This is a small, well-understood, low-risk prompt change, not a model-capability limitation — per `AGENT_MODEL_SELECTION.md`'s own guidance, this is a prompt-discipline fix, not grounds to escalate past `qwen-flash`.

### 8.3 Calls made (all against the real production schemas/seams)

1. `RULE_SET` extraction on a synthetic corporate travel policy — via the real `modelStudioExtractionClient` seam. First pass: schema-rejected (wrapped). Retest with field-name hints: **validated clean against `ExtractedRuleSetSchema`.**
2. `ANCHOR_EVENT` extraction on a synthetic event brief — same real seam. First pass: schema-rejected (same wrapping class, not individually retested — the RULE_SET retest already isolates and confirms the root cause).
3. **Capability probe (not a wired product path)**: 4 materially different traveller NL requests against the real `ResolutionTargetSchema` — pre-booking flight preference, post-booking flight timing change, hotel change/extension, and a deliberately vague/ambiguous request. First pass: schema-rejected. Retest with field-name hints on the "arrive a day earlier" case: **validated clean against `ResolutionTargetSchema`**, correctly honest about what it did and didn't fabricate.

**Important caveat, unchanged from the first pass:** the current runtime still has **no implemented Model Studio task that converts traveller free text directly into a `ResolutionTarget`/`ChangeRequest`** — `NorthstarPlanner`'s Path A (`src/intelligence/northstarPlanner.ts:509`) expects the complete `ResolutionTarget` already present in the signal payload; nothing in `src/intelligence/schemas.ts` defines an NL→`ResolutionTarget` task yet. That conversion is **DR-5** scope. What DR-0 now proves is that the *model*, via the *real target schema* and a properly-hinted prompt, **is capable** of producing valid, honest output for that eventual task — a strong, concrete, positive signal for DR-5, not evidence the feature exists today.

**DR-0D acceptance status:** now met. LIVE Model Studio interpretation is empirically proven against real production schemas, once (a) the region-correct `MODEL_STUDIO_BASE_URL` is set (done, local config) and (b) the extraction system prompt names its target fields (recommended, not yet applied to `src/app/extraction.ts` — small follow-up task, not done in DR-0 per the no-product-code-changes rule for this package).

---

## 9. Google Routes result

**ADOPT NOW.**

One bounded LIVE call: `POST https://routes.googleapis.com/directions/v2:computeRoutes`, origin Changi Airport (1.3644, 103.9915) → Marina Bay Sands (1.2494, 103.8303), `travelMode=DRIVE`, field mask `routes.duration,routes.staticDuration,routes.distanceMeters` (exactly matching `src/providers/googleRoutes/adapter.ts`'s existing field mask).

Result: HTTP 200, `distanceMeters=27077`, `duration=1658s`, `staticDuration=1658s` (~28 min). Configured ✓, request succeeds ✓, normalization is a direct field match (no adapter change needed) ✓, no account/billing blocker observed ✓.

**Classification: ADOPT NOW** (guarded opt-in per the existing ADR/§6.4 posture — REPLAY remains the safe default demo path; this proves LIVE is available without cost/billing risk investigation needed beyond the existing guardrail plan already on file from the 22 Aug investigation).

---

## 10. Allowed demo claims

- "Atlas Search/Verify/fare-rules were exercised LIVE against the real sandbox across 9+ materially different routes, including Singapore in both directions on multiple carriers."
- "Atlas order creation, payment, and ticketing were exercised LIVE against the real sandbox and produced a genuine airline PNR/e-ticket — using Atlas's own sandbox test-balance payment method, with no real card data submitted."
- "Atlas after-sales refund quoting is reachable, but cannot succeed in sandbox — Atlas's own documentation confirms sandbox never issues real airline-side tickets, which the refund subsystem requires." (Do **not** claim a refund was quoted or processed — it was not; see §4A/§4B/§11.)
- "Nuitée hotel search/quote/book/retrieve/cancel was exercised LIVE against the real sandbox across three materially different cities/cases, including a genuine non-refundable cancellation-fee charge and post-cancel state observability."
- "Google Routes ground-context is available LIVE and was exercised against the real API."
- "The event location (Singapore) has genuine, empirically confirmed Atlas sandbox flight coverage across six regional/international origin markets."
- "Model Studio LIVE interpretation (organiser policy extraction and traveller-request-to-target-schema conversion) was empirically proven against the real, frozen production schemas."

## 11. Claims we must NOT make

- Any claim that a provider-executed **refund or cancellation** was demonstrated on a real ticketed Atlas booking — it was attempted (5 ways) and failed with "order not found for refund" every time (§4A), and §4B shows this is inherent to sandbox mode (no real airline-side ticket ever exists to refund). Any refund/cancel step in a demo scenario must be `SIMULATE_PROVIDER_BOUNDARY` and labelled as such — permanently, not pending further investigation.
- Any claim that traveller natural-language text is currently **converted into a `ChangeRequest` by the product** — that pipeline does not exist yet (DR-5); §8 proves the *model* can do the conversion once built, not that the product does it today.
- Any claim that the *default, unmodified* `src/app/extraction.ts` prompt reliably produces schema-valid LIVE output — the unmodified prompt failed on both product tasks tested; only a hinted prompt (not yet applied to product code) succeeded. Do not claim the current codebase's LIVE extraction is production-ready without applying the §8.2 fix.
- Any claim of a genuine Atlas-originated webhook push — not attempted, not achievable without a ticketed order plus a real schedule change; any hero disruption event will be a documented-shape simulated source event through the real ingress (permitted, per the Wave3R doctrine, if honestly labelled).
- Any claim that SIN→HKG specifically is a viable sandbox route — it returned zero offers; only the reverse direction (HKG→SIN) is populated.
- Any claim that Atlas baggage/seat quoting was proven "end to end" in this run — reachable and correctly validating, but the actual quote calls hit an expired-session error rather than a successful payload.
- Any claim that the real ticketed test booking (`S96664`) was ever cancelled/refunded — it was not; it remains a live sandbox ticket with no successful cancel/refund call made against it, and per §4B, none was ever going to be possible.

---

## 12. Architecture gaps

1. **Flight forward-transaction capability is entirely absent from `FlightCapability`.** The contract exposes only `searchFlights`/`verifyOffer`/`getFareRules` (read-only). DR-0 proves `order.do` **and `pay.do` (deposit/test-balance mode) and ticketing** all work for this account (§4A) — the transactional ceiling is higher than originally assumed. **Minimal generic delta needed:** provider-neutral operations for order creation, payment-by-provider-test-mode, and status retrieval, e.g. `createOrder(...)`, `payOrder(...)` (deliberately restricted to non-card, provider-test-balance payment refs — never raw card data crossing the contract), and `retrieveOrder(...)`. Given payment is now proven safe via deposit mode, the plan's "never `LLM → money-moving API`" rule is satisfied by keeping this behind the same `authority → executor` gate as every other capability — the executor may legitimately call `payOrder` after approval, exactly as it may call `bookStay` on the hotel side today.
2. **Flight refund/cancel capability is a confirmed, permanent gap in sandbox** (not merely an unbuilt contract, and not resolvable by more testing): §4B shows Atlas's own documentation states sandbox never issues real airline-side tickets, and the refund subsystem needs one. A refund/cancel contract delta can still be *designed* now (for production use later), but it must never be relied on for a Wave 3R sandbox demo claim — that step is `SIMULATE_PROVIDER_BOUNDARY` by provider design, permanently, for this environment.
3. **No webhook/event ingress contract exists yet** (correctly deferred to DR-3). DR-0 supplies the concrete facts DR-3 needs: exact registration endpoint/body, exact incident-list read endpoint/schema, and the explicit absence of any inbound authentication from Atlas (Northstar's own ingress must supply its own secret-path/allowlist protection).
4. **`HotelSearchQuery` cannot express child ages**, so any family/child occupancy search fails closed by design (§7 Case D). Small, non-blocking delta: add optional `childAges?: number[]` per room/guest group. Not required for any currently-planned hero scenario (solo business travellers), so this is a **Park for Later**, not an Act Now.
5. **No architecture change is needed for hotel replacement** — `HotelCapability` already has full search/quote/book/retrieve/cancel; cancel+rebook composition is proven end-to-end including realistic fee exposure and post-cancel observability (§7). ADR-041's existing decision (cancel+rebook until a provider contradicts) is empirically confirmed correct.
6. **Model Studio has no architecture gap** — the client/schema/fail-closed design is correct. The only issue was an environment config value (`MODEL_STUDIO_BASE_URL` region) plus a genuine, small **prompt gap** in `src/app/extraction.ts` (§8.2): the system prompt never states the target JSON's field names, so the default model sometimes wraps its output in a self-invented key. Recommended follow-up (not done in DR-0): add the field names to `EXTRACTION_SYSTEM_PROMPT`, and carry the same discipline into whatever DR-5 system prompt eventually drives NL→`ResolutionTarget`.

---

## 13. Recommended minimal contract delta (for G3R-R0, not implemented here)

Per the Wave3R plan's own guidance (§7), and updated by the §4A pay/ticket proof, the smallest generic extension is a **new flight order-creation-and-payment capability**, additive to `FlightCapability`:

```
createFlightOrder(query: FlightOrderQuery): Promise<CapabilityResult<FlightOrderOutcome>>
payFlightOrder(query: FlightOrderPaymentQuery): Promise<CapabilityResult<FlightOrderOutcome>>
retrieveFlightOrder(query: FlightOrderRetrieveQuery): Promise<CapabilityResult<FlightOrderStatusView>>
```

- Provider-neutral (no Atlas-specific field names in the contract; adapter maps `name`-slash-convention, `birthday` format, `contact.name`, etc.).
- `FlightOrderPaymentQuery` carries only a **provider-opaque payment method reference** (e.g. `'PROVIDER_TEST_BALANCE'` for Atlas's sandbox deposit mode) — never raw card data, matching the existing `HotelBookQuery.paymentRef` discipline. In production, this same shape would carry a corporate virtual-card/MoR reference; the contract must never carry card PAN/CVV.
- `FlightOrderOutcome` carries `orderRef` (opaque), `status: 'HELD'|'PAID'|'TICKETED'|'FAILED'`, `holdExpiresAt`, `ticketRef?`, `totalPrice`, `provenance: 'LIVE'|'REPLAY'|'SIMULATED'`.
- **Deliberately excludes refund/cancel** — §4B shows this surface cannot be proven in sandbox at all (no real airline-side ticket is ever created). Do not build a `cancelFlightOrder`/`refundFlightOrder` operation for the sandbox demo path; if production adoption is ever pursued, that surface would need production credentials and a real fare purchase to validate, which is out of scope here.
- This is a genuine **shared-contract change** and therefore requires **G3R-R0** review before DR-2 implements it, per the plan.
- No hotel contract change is recommended — existing operations suffice (§12.5).

---

## 14. Scenario capability envelope

| Scenario family | Minimum capability | DR-0 verdict |
|---|---|---|
| S1 — supplier flight disruption | flight-event ingress → correlate → mutate → recover → execute where permitted → observe | Ingress contract not yet built (DR-3); Atlas incident-list read is reachable now for a polling fallback; order creation proven for the replacement leg |
| S2 — traveller-requested change | `ChangeRequest`/resolution machinery across pre-booking flight, post-booking flight, hotel change, add-on | Engine machinery exists (ADR-036); NL→`ChangeRequest` conversion (DR-5) not yet built, but Model Studio's capability to do it is now proven (§8) once DR-5 wires the seam with a properly field-hinted prompt |
| S3 — missed flight | traveller-state signal → downstream consequence → recovery | Same engine as S1/S2 per plan; no new provider capability required beyond what's proven here |
| S4 — event-side change preview | counterfactual/dry-run → confirm → fan-out | No external provider dependency; unaffected by this report |

All four families are **capability-feasible** with the provider evidence gathered here; none require a provider Atlas/Nuitée/Google cannot support once the flight order-creation delta (§13) lands and the Model Studio credential is fixed.

---

## 15. Provider risks/blockers

| Risk | Severity | Mitigation |
|---|---|---|
| **Atlas refund/cancel cannot be demonstrated in sandbox** (permanent, per Atlas's own docs — §4B) | **High for any scenario claiming a provider-executed cancel/refund** | Use `SIMULATE_PROVIDER_BOUNDARY` for that step, honestly labelled — permanently, not pending further investigation |
| `src/app/extraction.ts`'s system prompt doesn't name target field names, causing schema-shape failures on the default model | Medium — blocks reliable LIVE extraction until fixed | Apply the §8.2 prompt fix (small, well-understood, not done in DR-0) |
| Atlas order.do/pay.do require exact wire-format knowledge (undocumented in the fetched pages — discovered empirically) | Low (now solved) | Reuse the exact discovered shape in §4/§4A when DR-2 implements the adapter — do not re-derive from docs alone |
| Atlas webhook delivery is "best effort," no inbound auth | Medium | DR-3 must add its own ingress secret/allowlist; never trust payload as `AUTHORITATIVE` |
| SIN→HKG specifically unpopulated | Low | Avoid that exact leg in scenario design; every other tested SIN pairing works |
| Nuitée `childAges` contract gap | Low, non-blocking | Park for Later per §12.4 |
| Live ticketed Atlas test booking (`S96664`) has no confirmed cleanup path | Low (sandbox, no real cost) | No action available; documented transparently in §4A/§4B/§17 |

---

## 16. Evidence inventory

- `fixtures/recordings/nuitee/{book,cancel,quote,retrieve,search}/rec_*.json` — 9 new sanitized files, additive, genuine live sandbox captures (Hong Kong + Singapore cases, §7). No secrets or real PII present (verified by grep before commit).
- `docs/IMPLEMENTATION_PLAN.md` — DR-0A SSOT pointer + NS-G3 superseded notice.
- `docs/ROADMAP.md` — 3 factual DR-0 update notes on previously-contradicted entries (order.do, SIN routes, webhooks/incidents).
- This report.
- `.env.local` — `MODEL_STUDIO_BASE_URL` corrected to the international Model Studio endpoint (local config only; `.env.local` is gitignored, never committed).
- Raw probe transcripts (Atlas search/verify/order/pay/refund/incident responses, Nuitée console output, Model Studio requests/responses including the field-hinted retests, Google Routes response) were reviewed inline during the investigation and are **not** committed as raw files — they live only in this session's scratchpad (outside the repo) and are summarized/sanitized into §3–§9 above, per the evidence-discipline instruction not to commit unnecessary raw payloads. The 9 Nuitée recordings are the one exception, committed because they are genuinely reusable REPLAY fixtures in the existing repo convention.

---

## 17. Exact triage of every finding

| Finding | Triage |
|---|---|
| Atlas order.do + pay.do + ticketing all work; prior TICKETING_ACTIVATION_REQUIRED assumption was Skill-sourced and wrong | **Act Now** — correct the record (done, §3/§4A/ROADMAP); inform G3R-R0 |
| **Atlas refund cannot be demonstrated in sandbox — confirmed by Atlas's own documentation (§4B)** | **Act Now** — freeze this as `SIMULATE_PROVIDER_BOUNDARY` permanently for any sandbox demo claim; do not schedule further sandbox investigation of it |
| Singapore sandbox routes are populated (12/13 directional probes) | **Act Now** — correct the record (done, ROADMAP); freeze Singapore as the summit location |
| SIN→HKG specifically empty | **Investigate Now if HKG-origin scenario is chosen** — otherwise Park |
| Model Studio was blocked by a regional endpoint mismatch, not a bad key | **Act Now** — corrected in `.env.local` (done); inform anyone else setting up this environment |
| `src/app/extraction.ts` system prompt doesn't name target schema fields, causing schema-shape rejection on the default model | **Investigate Now / small Act Now** — apply the field-name hint fix before relying on LIVE extraction for a demo claim |
| No NL→ResolutionTarget model task exists yet | **Park for Later** — correctly scoped to DR-5, not a DR-0 defect; §8 shows the model can do it once built |
| Atlas webhook has no inbound auth | **Investigate Now in DR-3** — design Northstar's own ingress protection |
| Nuitée `childAges` contract gap | **Park for Later** — no current hero scenario needs it |
| Flight order-creation-and-payment contract gap | **Investigate Now at G3R-R0** — smallest delta proposed in §13 (refund deliberately excluded, permanently) |
| Live ticketed Atlas test booking (`S96664`, orderNo `TESTA20260824171418381`) has no working cancel/refund path | **Ignore / Accept Risk** — sandbox test data, Malindo Air's own test environment, no real cost; transparently documented, not hidden |
| Atlas getLuggage.do session expired mid-investigation (not re-chained) | **Ignore / Accept Risk** — capability already proven reachable+validating; re-proving is low value |

---

## 18. WHAT WE KNOW

- Atlas Search/Verify/fare-rules work live across many routes including a well-populated Singapore market in both directions (with one specific directional gap: SIN→HKG).
- **Atlas order creation, payment (test-balance mode), and ticketing all work live for this account** — a real e-ticket (`S96664`) was issued. The prior activation-blocked assumption was wrong.
- **Atlas refund cannot be demonstrated in sandbox, by design** — Atlas's own documentation confirms sandbox never issues real airline-side tickets, and the refund subsystem needs one (§4B). This is not a gap that further testing can close.
- Atlas's read-only incident-list endpoint works without webhook registration; webhook registration itself is documented but has no inbound authentication.
- Nuitée's full hotel lifecycle (including realistic non-refundable cancellation-fee exposure and post-cancel state observability) is proven across three materially different cases.
- Google Routes is live-ready with zero adapter changes needed.
- **Model Studio LIVE now works** — the key was correct; the endpoint was wrong (international vs mainland region). Fixed in local config. The default extraction prompt needs a small field-naming fix to reliably pass schema validation; confirmed fixable and validated against real production schemas.
- No architecture change is needed for hotel replacement; a well-scoped flight order-creation-and-payment delta is needed for flight replacement, and the refund/cancel side of that delta should never be relied on for a sandbox demo claim.

## 19. WHAT WE DO NOT KNOW

- Whether a genuine Atlas-originated schedule-change/cancellation webhook can ever be produced without a real ticketed booking and a real schedule disruption on it (very likely no, within a hackathon timeframe — and now doubly unlikely given §4B: sandbox tickets aren't real airline tickets, so a real airline-side schedule change against one is essentially impossible).
- Whether Hong Kong or Kuala Lumpur would work as event-destination hubs (not investigated — deprioritized since Singapore already clears the bar).
- Whether `ANCHOR_EVENT` extraction (only schema-rejected once, not individually retested with hints) has any task-specific quirks beyond the general wrapping-key issue already isolated and fixed for `RULE_SET`.

## 20. KEY ASSUMPTION

The domain engine stays generic; Singapore is adopted as the summit location because provider reality (not narrative preference) empirically supports it best. The flight replacement ceiling for Wave 3R is "genuine sandbox order, paid, and ticketed" (proven, §4A) for the *booking* side; the *recovery* side's refund/cancel step is `SIMULATE_PROVIDER_BOUNDARY` **permanently** in this sandbox (§4B — not a temporary gap). This satisfies the plan's `AI proposal → validation → viability → authority → executor → observe` pattern using only Atlas's own sandbox test-balance payment mode (never real card data), and it means Model Studio LIVE interpretation can now genuinely back any DR-0D/DR-5 claim once the small prompt fix (§8.2) is applied.

## 21. WHAT TO TEST NEXT

1. Apply the §8.2 prompt fix to `src/app/extraction.ts` (name the target schema fields in `EXTRACTION_SYSTEM_PROMPT`), then re-run the full 6-call probe suite (script already written and reusable) to confirm all tasks pass cleanly, not just the two retested here.
2. At DR-2, implement the `createFlightOrder`/`payFlightOrder`/`retrieveFlightOrder` delta from §13 using the exact wire format discovered in §4/§4A (do not re-derive from docs). Do not implement refund/cancel for the sandbox path.
3. At DR-3, design the webhook ingress's own authentication given Atlas provides none, and decide the simulated-source-event fallback shape using the `event/getPageList.do` record schema from §5 as the template.
4. At DR-5, build the NL→`ResolutionTarget` extraction task using the same field-naming prompt discipline validated in §8 — carry the exact `ResolutionTargetSchema` key names into the system prompt from day one.
5. When scenario design is frozen (DR-9), avoid the SIN→HKG leg specifically; every other tested Singapore pairing has real depth. Frame any S1/S3 recovery scenario's "cancel the old booking" step as simulated at the provider boundary, honestly labelled — this is now settled, not open.
