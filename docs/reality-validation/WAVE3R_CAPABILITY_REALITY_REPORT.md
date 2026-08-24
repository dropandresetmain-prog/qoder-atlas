# Wave 3R Capability Reality Report — DR-0

**Package:** DR-0 — Capability Reality Gate + Scenario Feasibility Envelope
**Status:** Investigation complete, including a user-authorized pay/ticket/refund confirmation pass (§4A). No transactional contract implemented. No Wave 3R UI work performed.
**Date:** 2026-08-24 (updated same day — user explicitly confirmed the Atlas key is sandbox-scoped and asked to confirm pay/ticket/refund; §4A is the result)
**Environment:** LOCAL (Windows 11, this workstation), `ADAPTER_MODE=REPLAY` default in `.env.local`; all probes below made explicit LIVE calls against confirmed SANDBOX/TEST provider endpoints using real local credentials in `.env.local`. No production endpoint was called at any point.
**Starting branch/SHA:** `fix/rev2-r4-nuitee` — local checkout was 3 commits behind `origin/fix/rev2-r4-nuitee` (missing `docs/WAVE3R_DEMO_READINESS_PLAN.md`); fast-forwarded to `8b869e32612727f3bc609c44033fd9bd8599b107` before starting work. All work below is on top of that SHA.

---

## 1. Executive verdict

**PASS WITH BLOCKERS.**

The capability envelope is now known with empirical confidence, not guesswork:

- **Atlas flights:** read chain (search/verify/fare-rules) is proven across **9 materially different live routes** in this run (previously proven on 1). The **forward transactional chain — search → verify → order → pay → ticket — is PROVEN FULLY WORKING** end to end (§4A): a real sandbox e-ticket (`S96664`, Malindo Air/Batik Air OD801) was issued using Atlas's own sandbox deposit-balance payment mode (no card data entered, no real money moved). The prior assumption that this account is `TICKETING_ACTIVATION_REQUIRED`-blocked (sourced from an untested Atlas *Skill* report, not a direct-API test) is **empirically false**. **Refund on that same real ticket is BLOCKED**, however: `refundQuotation.do` consistently returns `status 801 "Order not found for refund"` across 5 differently-shaped requests, on the exact order/ticket that just succeeded through pay+ticket — most likely a sandbox data-consistency gap between the ticketing and refund subsystems for `TESTA`-prefixed test orders, not an account block or a request-schema problem (see §4A for full diagnosis). **This is a real, unresolved gap for any Wave 3R scenario that needs to demonstrate a provider-executed refund/cancel on a truly ticketed leg.**
- **Singapore is empirically a strong, populated sandbox market** — this reverses the prior "SIN is UNKNOWN" conclusion from the 22 Aug investigation. 12 of 13 directional route probes returned real offers across 6 destination cities, multiple carriers, and short/medium/long-haul depth. Singapore is the clear #1 summit-location recommendation.
- **Nuitée hotel:** the existing single-case genuine sandbox lifecycle is now backed by **two more materially different live cases** (different city, non-refundable-rate cancellation-fee exposure, post-cancel state observability, and a documented contract gap on multi-child search).
- **Model Studio LIVE is BLOCKED** — the configured `MODEL_STUDIO_API_KEY` is rejected by Alibaba's own endpoint with `invalid_api_key`. This is a credential problem, not a code or architecture problem (a raw `curl` against the documented endpoint fails identically to the app's `HttpModelTransport`). This blocks the DR-0D "LIVE Model Studio interpretation" claim until the user rotates/verifies the key.
- **Google Routes:** ADOPT NOW — one bounded LIVE call succeeded cleanly, payload matches the adapter's field mask exactly.
- **Webhook/incident:** the read-only incident-list endpoint is reachable without prior webhook registration (proven, returns a clean empty page). Webhook *registration* is documented (single `url` field, no inbound signature/auth) but was not exercised (state-changing, needs a public endpoint — correctly deferred to DR-3).

The one blocker (Model Studio credential) does not block DR-1/DR-2 architecture decisions; it blocks *only* the DR-0D/DR-5 "LIVE model interpretation" evidence and demo claim until fixed. Everything else needed to choose the scenario envelope and the minimal transactional contract delta is now known.

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
| 9 | Refund quotation | `POST /refundQuotation.do` | DOCUMENTED_NOT_PROVEN (needs a ticketed order) | First call (unticketed order): `status=809 "not yet ticketed"` — correct gate. **Re-called on the now-genuinely-ticketed order** (§4A): `status=801 "Order not found for refund"`, consistently across 5 differently-shaped `refundRequestList` bodies (object-by-ticketNo, +airlinePNR+refundType, keyed by airlinePNR+carrier instead of orderNo, plain-string array → `9999` internal error on the malformed shape). The *identical* 801 across 3 well-formed variations indicates a lookup/data gap, not a schema problem | **PROVEN REACHABLE, BLOCKED ON THIS TICKETED ORDER** (see §4A diagnosis) |
| 10 | Refund submission / void / query-refund-status | `refund.do`, `queryRefundOrders.do`, void endpoints | DOCUMENTED_NOT_PROVEN | Not attempted — `refund.do` requires a `refundOfferId` from a *successful* quote, which was never obtained (see #9); submitting against a known-failed quote has no evidence value | **DOCUMENTED, UNPROVEN — blocked behind #9** |
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
- **The refund/cancel closing loop on a truly ticketed leg is NOT currently proven** — this directly affects any S1/S3 scenario that wants to show Atlas executing a real cancel/refund on a real ticket. Until this is resolved (see §21), such a scenario should either (a) use `SIMULATE_PROVIDER_BOUNDARY` for the refund/cancel step specifically while keeping the initial booking real, or (b) budget time to re-investigate whether a non-`TESTA`-prefixed order type (if one exists for this account) resolves the refund lookup.

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

## 8. Model Studio live evidence

**Result: BLOCKED — invalid credential, confirmed by the provider itself.**

- Client construction: `model=qwen-flash`, `baseUrl=https://dashscope.aliyuncs.com/compatible-mode/v1` (both defaults, since `.env.local` leaves `MODEL_STUDIO_MODEL`/`MODEL_STUDIO_BASE_URL` empty), `mode=LIVE`, `isConfigured=true`.
- Every call (two real product extraction tasks — organiser `RULE_SET` policy extraction, organiser `ANCHOR_EVENT` brief extraction — plus 4 capability-probe calls, see below) returned `AUTH:model_http_401`.
- **Isolated with a raw `curl`** against the exact documented endpoint using the exact header (`Authorization: Bearer <key>`): Alibaba's own response is `{"error":{"message":"Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error","code":"invalid_api_key"}}`, HTTP 401. This confirms:
  - the app's `HttpModelTransport` code is correct (identical raw call gets the identical, authoritative rejection);
  - this is a **credential problem** (wrong/expired/malformed key), not a network, endpoint, or workspace-header problem;
  - the key's shape (`sk-ws-…`, 115 characters) is unusually long for a typical DashScope personal API key (~35–40 chars) — worth the user double-checking whether the correct value was pasted into `.env.local`.

**Product-task calls attempted (all failed identically — included for completeness):**
1. `RULE_SET` extraction on a synthetic corporate travel policy (real schema: `src/ingest/semantic.ts` `EXTRACTION_OUTPUT_SCHEMA.RULE_SET`, via the real `modelStudioExtractionClient` seam in `src/app/extraction.ts`).
2. `ANCHOR_EVENT` extraction on a synthetic event brief (same real seam).
3. **Capability probe (not a wired product path — see caveat below)**: 4 materially different traveller natural-language requests against the real, frozen `ResolutionTargetSchema` (`src/contracts/changeRequest.ts`) — pre-booking flight preference, post-booking flight timing change, hotel change/extension, and a deliberately vague/ambiguous request (to test honest non-fabrication). All 4 hit the same 401 before any interpretation occurred.

**Important caveat on task 3:** the current runtime has **no implemented Model Studio task that converts traveller free text directly into a `ResolutionTarget`/`ChangeRequest`** — `NorthstarPlanner`'s Path A (`src/intelligence/northstarPlanner.ts:509`) expects the *complete* declarative `ResolutionTarget` already present in the `TRAVELLER_INPUT` signal payload; nothing in `src/intelligence/schemas.ts` defines an NL→`ResolutionTarget` task. Building that conversion is explicitly **DR-5** scope ("Traveller Natural-Language Change Intake"), not yet built. DR-0's probe therefore tested the *model's* capability against the *real* target schema using an ad-hoc prompt, honestly labelled as a capability probe — it does **not** mean the product can do this today. This is a genuine, useful pre-DR-5 signal once the credential is fixed, not evidence of an already-working feature.

**What must happen before DR-0D's acceptance criterion is met:** the user must verify/rotate `MODEL_STUDIO_API_KEY` in `.env.local`. Until then, the product correctly and honestly degrades to the `DeterministicFallbackPlanner` (proven elsewhere, credential-free) — this is not a demo blocker for REPLAY-based claims, but it **is** a blocker for any "LIVE Model Studio interpretation" claim in the video.

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
- "Atlas after-sales refund quoting is reachable." (Do **not** claim a refund was quoted, processed, or that the refund path is proven — it is not; see §4A/§11.)
- "Nuitée hotel search/quote/book/retrieve/cancel was exercised LIVE against the real sandbox across three materially different cities/cases, including a genuine non-refundable cancellation-fee charge and post-cancel state observability."
- "Google Routes ground-context is available LIVE and was exercised against the real API."
- "The event location (Singapore) has genuine, empirically confirmed Atlas sandbox flight coverage across six regional/international origin markets."

## 11. Claims we must NOT make

- Any claim that a provider-executed **refund or cancellation** was demonstrated on a real ticketed Atlas booking — it was attempted (5 ways) and failed with "order not found for refund" every time (§4A). Any refund/cancel step in a demo scenario must be `SIMULATE_PROVIDER_BOUNDARY` and labelled as such unless this gap is independently re-resolved.
- Any claim that Model Studio LIVE interpretation was demonstrated — it was attempted and blocked by an invalid credential; the fallback planner is what actually ran in every REPLAY-mode demo today.
- Any claim that traveller natural-language text is currently converted into a `ChangeRequest` by the product — that pipeline does not exist yet (DR-5).
- Any claim of a genuine Atlas-originated webhook push — not attempted, not achievable without a ticketed order plus a real schedule change; any hero disruption event will be a documented-shape simulated source event through the real ingress (permitted, per the Wave3R doctrine, if honestly labelled).
- Any claim that SIN→HKG specifically is a viable sandbox route — it returned zero offers; only the reverse direction (HKG→SIN) is populated.
- Any claim that Atlas baggage/seat quoting was proven "end to end" in this run — reachable and correctly validating, but the actual quote calls hit an expired-session error rather than a successful payload.
- Any claim that the real ticketed test booking (`S96664`) was ever cancelled/refunded — it was not; it remains a live sandbox ticket with no successful cancel/refund call made against it.

---

## 12. Architecture gaps

1. **Flight forward-transaction capability is entirely absent from `FlightCapability`.** The contract exposes only `searchFlights`/`verifyOffer`/`getFareRules` (read-only). DR-0 proves `order.do` **and `pay.do` (deposit/test-balance mode) and ticketing** all work for this account (§4A) — the transactional ceiling is higher than originally assumed. **Minimal generic delta needed:** provider-neutral operations for order creation, payment-by-provider-test-mode, and status retrieval, e.g. `createOrder(...)`, `payOrder(...)` (deliberately restricted to non-card, provider-test-balance payment refs — never raw card data crossing the contract), and `retrieveOrder(...)`. Given payment is now proven safe via deposit mode, the plan's "never `LLM → money-moving API`" rule is satisfied by keeping this behind the same `authority → executor` gate as every other capability — the executor may legitimately call `payOrder` after approval, exactly as it may call `bookStay` on the hotel side today.
2. **Flight refund/cancel capability is a confirmed gap**, not merely an unbuilt contract: even the *raw provider API* could not produce a working refund quote on a genuinely ticketed order in this account (§4A, 5 attempts, consistent `801`). Any contract delta for refund should be built and *tested against a real ticketed order* before being relied on for a demo claim — do not assume documented behavior will work here.
3. **No webhook/event ingress contract exists yet** (correctly deferred to DR-3). DR-0 supplies the concrete facts DR-3 needs: exact registration endpoint/body, exact incident-list read endpoint/schema, and the explicit absence of any inbound authentication from Atlas (Northstar's own ingress must supply its own secret-path/allowlist protection).
4. **`HotelSearchQuery` cannot express child ages**, so any family/child occupancy search fails closed by design (§7 Case D). Small, non-blocking delta: add optional `childAges?: number[]` per room/guest group. Not required for any currently-planned hero scenario (solo business travellers), so this is a **Park for Later**, not an Act Now.
5. **No architecture change is needed for hotel replacement** — `HotelCapability` already has full search/quote/book/retrieve/cancel; cancel+rebook composition is proven end-to-end including realistic fee exposure and post-cancel observability (§7). ADR-041's existing decision (cancel+rebook until a provider contradicts) is empirically confirmed correct.
6. **Model Studio has no architecture gap** — the client/schema/fail-closed design is correct (confirmed by the raw-curl comparison); the blocker is purely a credential value.

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
- **Deliberately excludes refund/cancel** — §4A shows that surface is not currently provable even at the raw-provider level for this account/order type. Do not build a `cancelFlightOrder`/`refundFlightOrder` operation until it has been independently proven against a real ticketed order (retest with a non-`TESTA`-prefixed order if one becomes available, or escalate to Atlas support per their own error message).
- This is a genuine **shared-contract change** and therefore requires **G3R-R0** review before DR-2 implements it, per the plan.
- No hotel contract change is recommended — existing operations suffice (§12.5).

---

## 14. Scenario capability envelope

| Scenario family | Minimum capability | DR-0 verdict |
|---|---|---|
| S1 — supplier flight disruption | flight-event ingress → correlate → mutate → recover → execute where permitted → observe | Ingress contract not yet built (DR-3); Atlas incident-list read is reachable now for a polling fallback; order creation proven for the replacement leg |
| S2 — traveller-requested change | `ChangeRequest`/resolution machinery across pre-booking flight, post-booking flight, hotel change, add-on | Engine machinery exists (ADR-036); NL→`ChangeRequest` conversion (DR-5) not yet built; Model Studio blocked pending credential fix |
| S3 — missed flight | traveller-state signal → downstream consequence → recovery | Same engine as S1/S2 per plan; no new provider capability required beyond what's proven here |
| S4 — event-side change preview | counterfactual/dry-run → confirm → fan-out | No external provider dependency; unaffected by this report |

All four families are **capability-feasible** with the provider evidence gathered here; none require a provider Atlas/Nuitée/Google cannot support once the flight order-creation delta (§13) lands and the Model Studio credential is fixed.

---

## 15. Provider risks/blockers

| Risk | Severity | Mitigation |
|---|---|---|
| **Atlas refund/cancel does not work on a real ticketed order** (5 attempts, consistent failure) | **High for any scenario claiming a provider-executed cancel/refund** | Use `SIMULATE_PROVIDER_BOUNDARY` for that step, honestly labelled, until independently re-resolved (§4A/§21) |
| Model Studio API key invalid | **Blocks DR-0D/DR-5 LIVE claims** | User must rotate/verify `MODEL_STUDIO_API_KEY` in `.env.local` (Act Now, not code) |
| Atlas order.do/pay.do require exact wire-format knowledge (undocumented in the fetched pages — discovered empirically) | Low (now solved) | Reuse the exact discovered shape in §4/§4A when DR-2 implements the adapter — do not re-derive from docs alone |
| Atlas webhook delivery is "best effort," no inbound auth | Medium | DR-3 must add its own ingress secret/allowlist; never trust payload as `AUTHORITATIVE` |
| SIN→HKG specifically unpopulated | Low | Avoid that exact leg in scenario design; every other tested SIN pairing works |
| Nuitée `childAges` contract gap | Low, non-blocking | Park for Later per §12.4 |
| Live ticketed Atlas test booking (`S96664`) has no confirmed cleanup path | Low (sandbox, no real cost) | No action available; documented transparently in §4A/§17 |

---

## 16. Evidence inventory

- `fixtures/recordings/nuitee/{book,cancel,quote,retrieve,search}/rec_*.json` — 9 new sanitized files, additive, genuine live sandbox captures (Hong Kong + Singapore cases, §7). No secrets or real PII present (verified by grep before commit).
- `docs/IMPLEMENTATION_PLAN.md` — DR-0A SSOT pointer + NS-G3 superseded notice.
- `docs/ROADMAP.md` — 3 factual DR-0 update notes on previously-contradicted entries (order.do, SIN routes, webhooks/incidents).
- This report.
- Raw probe transcripts (Atlas search/verify/order/refund/incident responses, Nuitée console output, Model Studio 401 responses, Google Routes response) were reviewed inline during the investigation and are **not** committed as raw files — they live only in this session's scratchpad (outside the repo) and are summarized/sanitized into §3–§9 above, per the evidence-discipline instruction not to commit unnecessary raw payloads. The 9 Nuitée recordings are the one exception, committed because they are genuinely reusable REPLAY fixtures in the existing repo convention.

---

## 17. Exact triage of every finding

| Finding | Triage |
|---|---|
| Atlas order.do + pay.do + ticketing all work; prior TICKETING_ACTIVATION_REQUIRED assumption was Skill-sourced and wrong | **Act Now** — correct the record (done, §3/§4A/ROADMAP); inform G3R-R0 |
| **Atlas refund quotation fails on a real ticketed order (5 attempts, consistent `801`)** | **Investigate Now at G3R-R0** — do not build/rely on a flight-refund contract path until this is independently re-resolved (retest with a differently-sourced order, or open a support ticket with Atlas quoting the exact `orderNo`/`ticketNo`/error) |
| Singapore sandbox routes are populated (12/13 directional probes) | **Act Now** — correct the record (done, ROADMAP); freeze Singapore as the summit location |
| SIN→HKG specifically empty | **Investigate Now if HKG-origin scenario is chosen** — otherwise Park |
| Model Studio API key invalid | **Act Now (user action)** — rotate/verify the key before DR-0D/DR-5 LIVE claims are made |
| No NL→ResolutionTarget model task exists yet | **Park for Later** — correctly scoped to DR-5, not a DR-0 defect |
| Atlas webhook has no inbound auth | **Investigate Now in DR-3** — design Northstar's own ingress protection |
| Nuitée `childAges` contract gap | **Park for Later** — no current hero scenario needs it |
| Flight order-creation-and-payment contract gap | **Investigate Now at G3R-R0** — smallest delta proposed in §13 (refund deliberately excluded) |
| Live ticketed Atlas test booking (`S96664`, orderNo `TESTA20260824171418381`) has no working cancel/refund path | **Ignore / Accept Risk** — sandbox test data, Malindo Air's own test environment, no real cost; transparently documented, not hidden |
| Atlas getLuggage.do session expired mid-investigation (not re-chained) | **Ignore / Accept Risk** — capability already proven reachable+validating; re-proving is low value |

---

## 18. WHAT WE KNOW

- Atlas Search/Verify/fare-rules work live across many routes including a well-populated Singapore market in both directions (with one specific directional gap: SIN→HKG).
- **Atlas order creation, payment (test-balance mode), and ticketing all work live for this account** — a real e-ticket (`S96664`) was issued. The prior activation-blocked assumption was wrong.
- **Atlas refund quotation does NOT work on that same real ticketed order** — 5 differently-shaped attempts all failed with the identical "order not found for refund" error, most likely a sandbox test-order data-consistency gap rather than a request-format or account-level problem.
- Atlas's read-only incident-list endpoint works without webhook registration; webhook registration itself is documented but has no inbound authentication.
- Nuitée's full hotel lifecycle (including realistic non-refundable cancellation-fee exposure and post-cancel state observability) is proven across three materially different cases.
- Google Routes is live-ready with zero adapter changes needed.
- The Model Studio credential in `.env.local` is invalid per Alibaba's own error response — this is a credential issue, not a code issue.
- No architecture change is needed for hotel replacement; a well-scoped flight order-creation-and-payment delta is needed for flight replacement, and the refund/cancel side of that delta should NOT be built until independently re-proven.

## 19. WHAT WE DO NOT KNOW

- **Why Atlas's refund-lookup subsystem cannot find a real, genuinely ticketed `TESTA`-prefixed order** — is this specific to test-mode order numbers, a broader account gap, or a request field we didn't guess in 5 tries? Needs either an Atlas support ticket (quoting `orderNo=TESTA20260824171418381`, `ticketNo=S96664`, error `801`) or a retest against a differently-sourced order.
- Whether a genuine Atlas-originated schedule-change/cancellation webhook can ever be produced without a real ticketed booking and a real schedule disruption on it (very likely no, within a hackathon timeframe).
- Whether the correct Model Studio API key is simply a typo/stale value in `.env.local`, or a genuinely revoked/wrong key from Alibaba Cloud — the user must check the console.
- Whether Hong Kong or Kuala Lumpur would work as event-destination hubs (not investigated — deprioritized since Singapore already clears the bar).

## 20. KEY ASSUMPTION

The domain engine stays generic; Singapore is adopted as the summit location because provider reality (not narrative preference) empirically supports it best. The flight replacement ceiling for Wave 3R is now "genuine sandbox order, paid, and ticketed" (proven, §4A) for the *booking* side, but "refund/cancel is `SIMULATE_PROVIDER_BOUNDARY` only" for the *recovery* side until §21.1 is resolved — this is both the safest financially and the most defensible truthfully, and it satisfies the plan's `AI proposal → validation → viability → authority → executor → observe` pattern using only Atlas's own sandbox test-balance payment mode (never real card data).

## 21. WHAT TO TEST NEXT

1. **Resolve the Atlas refund-lookup gap** (§4A/§19) — either file a support request with Atlas quoting the exact order/ticket/error, or attempt one more full search→verify→order→pay→ticket→refund cycle on a *freshly created* order to rule out anything specific to the original `TESTA...81` order.
2. Fix the Model Studio credential, then re-run the exact same 6 probe calls from §8 (script already written and reusable) to get the genuine DR-0D LIVE evidence this report is currently missing.
3. At DR-2, implement the `createFlightOrder`/`payFlightOrder`/`retrieveFlightOrder` delta from §13 using the exact wire format discovered in §4/§4A (do not re-derive from docs).
4. At DR-3, design the webhook ingress's own authentication given Atlas provides none, and decide the simulated-source-event fallback shape using the `event/getPageList.do` record schema from §5 as the template.
5. At DR-5, build the NL→`ResolutionTarget` extraction task against the schema already probed in §8 (once the credential works) — the schema-gate approach and prompt structure used here are reusable.
6. When scenario design is frozen (DR-9), avoid the SIN→HKG leg specifically; every other tested Singapore pairing has real depth.
