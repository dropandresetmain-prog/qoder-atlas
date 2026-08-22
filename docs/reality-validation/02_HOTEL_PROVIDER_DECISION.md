# 02 — Hotel Provider Decision Investigation

> Reality Validation milestone — research/docs only. No product implementation.
> Branch: `rv/hotel-investigation` (base `6d20396`). Today: 2026-08-22.
> Bounded comparison of six hotel provider/integration options against the
> question: **"If a TMC or corporate travel platform wanted to adopt our
> resolution layer after the hackathon, which hotel provider/integration
> strategy makes most sense?"**

Evidence labels: **DOCUMENTED** = direct from official docs we fetched;
**OBSERVED_LIVE_READ** = read live in HTML response from the doc URL;
**INFERRED** = reasoned from adjacent documented facts; **UNKNOWN** = not
visible from public sources.

---

## 0. Repo context (read-only baseline)

- `src/contracts/capabilities.ts:162` defines `HotelCapability` with only
  `getStayContext`, `modifyStay`, `cancelStay`. No
  search/availability/quote/prebook/book/retrieve exists on the capability.
- `capabilities.ts:131-134` says the capability "works from imported
  booking/policy data; transactional modify/cancel may be simulated at the
  provider boundary (ADR-007)." Boundary is read-mostly + simulation.
- `docs/ARCHITECTURE.md:295-296` lists Booking.com Demand as Stretch; other
  hotel APIs as future adapters.
- `docs/ROADMAP.md:139-141` defers Expedia Rapid; `ROADMAP.md:155-157`
  defers real hotel modify/cancel; `ROADMAP.md:109-111` treats Booking.com
  Demand as Stretch gated on partner credentials. This investigation is
  **post-core** — what we would *eventually* commit to, not what we
  *must* ship for the hackathon.

Two lenses: (a) hackathon (this week, credential-less sandbox); (b)
post-hackathon (real TMC adoption).

---

## 1. Critical context: Amadeus Self-Service is gone

**DOCUMENTED.** The Amadeus for Developers self-service portal was
**decommissioned on 2026-07-17** (announced February 2026). The portal's own
landing page now states: *"Amadeus for Developers self-service portal has
been decommissioned on July 17th, this website is for Amadeus Enterprise
API Portal only."* (https://developers.amadeus.com/, live read on
2026-08-22.) Self-service hotel endpoints (Hotel List, Hotel Search v3,
Hotel Booking) no longer accept new keys; existing keys disabled.

Sources: https://airlabs.co/amadeus-self-service-api-shutdown (DOCUMENTED,
2026-05-29; Amadeus spokesperson: "We are decommissioning only the
self-service section of the Amadeus for Developers portal. The Enterprise
[portal continues]."); https://www.tripgic.com/playbook/amadeus-api-shutdown-migration/
(DOCUMENTED — 2026-07-17 cutoff); https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers
(DOCUMENTED — Feb 2026 confirmation).

This **changes the recommendation set** vs. what `ROADMAP.md:143` was
written against. There is no longer an Amadeus Self-Service option. There
is only Amadeus Enterprise, which is **sales-gated, not self-service**
(https://developers.amadeus.com/enterprise: "Request access to over a
100 Enterprise APIs… Get support from one of our experienced travel
consultants…"). Any Atlas decision that previously said "Amadeus
Self-Service for hotel search" must now be re-stated as "Amadeus Enterprise
(sales-gated)" or "no Amadeus."

---

## 2. Per-provider assessment

### 2.1 Expedia Rapid (EAN) — Lodging API

- **Business model:** Affiliate (EAN) / EPS (Expedia Partner Solutions);
  sales-gated partner program, per-booking commercials. (DOCUMENTED:
  https://developers.expediagroup.com/rapid/setup step 1 "you need to be
  an Expedia partner" with https://partner.expediagroup.com/en-us/join-us/rapid-api.)
- **Intended customer:** OTAs, TMCs, agent platforms. Expedia markets Rapid
  to TMCs/OTAs explicitly. (INFERRED.)
- **TMC / corporate relevance:** High. Inventory breadth (claimed 800K+
  properties), supports `expedia_collect` + `property_collect`, member
  rates, virtual card / corporate card / affiliate collect. (DOCUMENTED —
  Rapid Hard Change docs list all four payment types in `commit` step.)
- **Inventory model:** Merchant + agency on Expedia-contracted inventory.
  Hard Change cannot switch business model or rate type. (DOCUMENTED —
  https://developers.expediagroup.com/rapid/lodging/manage-booking/hard-change
  "Limitations of hard change" section.)
- **Sandbox / test access:** `https://test.ean.com` with per-API test
  headers; sandbox bookings don't charge or reserve. (DOCUMENTED.)
- **Time to credentials:** **Sales-gated.** Apply via partner portal → BD
  manager → site review → production enablement. Realistic weeks-months
  to production; sandbox fastest. (INFERRED — Step 6 site-review flow.)
- **Search:** Geography, Shopping (availability + prices), Content
  (static). (DOCUMENTED — API Explorer navigation.)
- **Rate/room availability:** Shopping returns price + cancellation
  policies in one response. `rate_option=member` for member rates.
  (DOCUMENTED.)
- **Quote/prebook:** No separate prebook step; price+cancellation in
  Shopping. `price_check` link in Hard Change returns `amount_owed` /
  `refund` / `penalty`. (DOCUMENTED.)
- **Booking:** Two-step create-itinerary → resume with payment;
  `Itinerary Retrieve` to confirm. (DOCUMENTED.)
- **Retrieve:** Itinerary Retrieve; history via `include=history`.
  (DOCUMENTED.)
- **Cancellation:** `DELETE /v3/itineraries/{id}/rooms/{roomId}?token=…`
  via tokenized link. (DOCUMENTED.)
- **Modification:** **Documented and reasonably broad** for the
  historically weak surface. Hard Change supports date, room type, and
  occupancy changes in a single API call, pre-stay, including same-day
  before check-in. Limitations: cannot change business model or rate
  type; non-refundable stays where property penalty == original value
  won't show the change option. Guest-name changes are a separate
  dedicated flow. (DOCUMENTED.)
- **Hard change / rebook:** Effectively yes — Hard Change keeps the
  itinerary number and adjusts in place. Fallback: cancel + rebook.
- **Payment / virtual cards:** `customer_card`, `virtual_card`,
  `corporate_card`, `affiliate_collect` on commit. (DOCUMENTED — Hard
  Change commit body example.)
- **Negotiated corporate rates:** Member rates via `rate_option=member`;
  no self-service RAC API. (INFERRED — not surfaced.)
- **After-sales workflow:** Notifications API (webhooks), Property Message
  Center. (DOCUMENTED — API Explorer navigation.)
- **Confirmation semantics:** **Provider-confirmed** — booking returns
  `itinerary_id` and `confirmation_id.{expedia,property}` immediately.
  (DOCUMENTED.)
- **Support / SLA:** Sales contact + Rapid support; SLAs not public
  (UNKNOWN).
- **Production onboarding:** Multi-step with BD manager + site review;
  not "self-service to production."
- **Commercial constraints:** Per-booking commission per contract (UNKNOWN).
- **Region coverage (incl. Singapore):** Global, strong APAC. SG not
  specifically tested; Expedia has been selling APAC inventory via Rapid
  for years. (INFERRED.)
- **Implementation effort:** High — 4-6 weeks of integration + certification.
  (INFERRED.)
- **Node / TypeScript SDK quality:** **No first-party Node/TS SDK**;
  official SDK is Java (`https://github.com/ExpediaGroup/rapid-java-sdk`).
  Node/TS hand-rolls the HMAC SHA-512 signature header. (DOCUMENTED —
  setup step 4.)
- **RECORD/REPLAY suitability:** Hard. Responses are large and
  idiosyncratic (tokenized links, signature headers). Doable but
  non-trivial.

**Decision:** **DEFER** (production partner) + **USE_SANDBOX** (only if
sandbox credentials become available through a partner; not creatable
this week without sales contact).

### 2.2 Duffel Stays

- **Business model:** Self-service aggregator; "Sign up for a Duffel
  Account (it takes about 1 minute!)" (DOCUMENTED —
  https://duffel.com/docs/guides/getting-started-with-stays).
- **Intended customer:** Tech-forward TMCs, OTAs, modern travel platforms.
  Positioned as the developer-friendly alternative post the Amadeus
  Self-Service shutdown. (INFERRED from
  https://www.youtube.com/watch?v=EmX5OTSjbbA "Amadeus is retiring its
  self-service API. Today, we evaluate our replacement: Duffel.")
- **TMC / corporate relevance:** **Strong and growing.** Explicit
  "Negotiated Rates" feature for corporate travel
  (https://duffel.com/docs/guides/negotiated-rates). Guide walks TMC/corp
  travel managers through Phase 1 (negotiate, get a Rate Access Code),
  Phase 2 (load RAC into Duffel via `POST /stays/negotiated_rates`),
  Phase 3 (search with `negotiated_rate_ids`; employees see corporate
  + public rates side by side).
- **Inventory model:** Aggregator over many bedbanks. `deal_types` in
  rate schema includes `"closed_user_group"`, `"corporate"`, `"mobile"`.
  (DOCUMENTED.)
- **Sandbox / test access:** **Test mode with named "Test Hotels" at
  fixed coordinates (-24.38, -128.32).** (DOCUMENTED —
  https://duffel.com/docs/guides/test-hotels.) Test tokens start with
  `duffel_test_`.
- **Time to credentials:** **Self-service, ~1 minute for account + test
  token.** Still requires requesting Stays access via
  https://duffel.com/contact-us but the test token is granted quickly
  and the sandbox is fully functional without sales contact.
  (DOCUMENTED.)
- **Search:** Four-step: `POST /stays/search` →
  `POST /stays/search_results/{id}/fetch_rates` →
  `POST /stays/quotes` → `POST /stays/bookings`. (DOCUMENTED.)
- **Rate/room availability:** `fetch_rates` returns full rate detail
  (board type, cancellation_timeline, conditions, benefits, deal types,
  total/amount/fee/tax, loyalty programme, expires_at). (DOCUMENTED.)
- **Policy/cancellation info:** Full `cancellation_timeline` =
  `[{refund_amount, currency, before}]` per policy date. (DOCUMENTED.)
- **Quote/prebook:** Yes, `POST /stays/quotes` returns `quote_id`;
  re-validates price/availability before booking. (DOCUMENTED.)
- **Booking:** `POST /stays/bookings` with `quote_id` returns
  `status: "confirmed"` + `reference`. (DOCUMENTED.)
- **Retrieve:** `GET /stays/bookings/{id}` returns full booking with
  `status`, `confirmed_at`, `cancelled_at`, `reference`. (DOCUMENTED.)
- **Cancellation:** `POST /stays/bookings/{id}/actions/cancel` returns
  updated booking with `cancelled_at` set and `status: "cancelled"`.
  (DOCUMENTED.)
- **Modification:** **Important caveat — date/room/hotel changes are
  NOT a first-class API operation.** `PATCH /stays/bookings/{id}` only
  updates `users` (who can manage the booking). Date/room changes
  require **cancel-and-rebook**. (DOCUMENTED — Update booking body
  parameters: only `users[]`.) **Significant gap** vs. Expedia Rapid
  Hard Change.
- **Hard change / rebook:** Not supported in-place. Workflow is
  cancel + new booking, with per-rate cancellation penalties.
- **Payment / virtual cards:** `payment` object (balance / 3DS card).
  TMC virtual card flow not first-class in the Stays docs we read
  (INFERRED).
- **Negotiated corporate rates:** **Yes, fully documented**, with
  self-service `POST /stays/negotiated_rates` and a
  `negotiated_rate_ids` search filter. (DOCUMENTED.)
- **After-sales workflow:** Email notifications for key collection;
  Duffel support team reaches out via configured support email.
  (DOCUMENTED.)
- **Confirmation semantics:** **Provider-confirmed** — booking returns
  `status: "confirmed"` and `reference` synchronously. (DOCUMENTED.)
  Note: Duffel explicitly warns "If an unexpected error occurs, such
  as a 500 HTTP status code, and the booking status cannot be
  determined, do not attempt to retry the action" — the right
  pattern for our `CapabilityResult` envelope.
- **Support / SLA:** help@duffel.com, https://www.duffelstatus.com;
  SLA not enumerated in public docs (UNKNOWN).
- **Production onboarding:** Self-service; commercial terms on
  activation. Per-booking commission in `estimated_commission_amount`
  on each rate/booking. (DOCUMENTED.)
- **Commercial constraints:** Standard Duffel balance + commission
  model; corporate negotiated rates negotiated outside Duffel and
  loaded via the API. (DOCUMENTED.)
- **Region coverage (incl. Singapore):** Global, "millions of
  properties" (DOCUMENTED). Singapore supported in the test region
  via Duffel Test Hotel (London); live SG coverage depends on
  upstream supplier mix. (INFERRED.)
- **Implementation effort:** Low-to-moderate. Four-step flow well
  documented; JS client library available. (DOCUMENTED.)
- **Node / TypeScript SDK quality:** **First-party JS client library**
  with Stays support
  (https://duffel.com/docs/guides/javascript-client-library). Same lib
  used for Flights.
- **RECORD/REPLAY suitability:** Excellent. Token-shaped IDs, clean
  JSON, deterministic four-step flow. Replay = capture
  `search_result_id`, `rate_id`, `quote_id`, `booking_id` tuple.

**Decision:** **USE_SANDBOX** (this week) + **USE_LIVE** (post-hackathon,
primary recommendation).

### 2.3 HBX Group (Hotelbeds) — Hotels API + Transfers

- **Business model:** B2B wholesaler. API is in HBX Group (rebrand of
  Hotelbeds Group; `hotelbeds.com` is consumer, `HBX Group` is parent).
  Net rates + markup, B2B contracts. (DOCUMENTED —
  https://www.hbxgroup.com/products-and-services/api-suite and
  https://developer.hotelbeds.com/documentation/hotels/booking-api/.)
- **Intended customer:** OTAs, DMCs, TMCs, B2B travel agencies,
  wholesalers. (INFERRED.)
- **TMC / corporate relevance:** High in established TMC market. Historic
  default B2B bedbank for TMCs in Europe, LATAM, APAC. (INFERRED.)
- **Inventory model:** **Wholesaler (net-rate) inventory**, often
  pre-allocated. Two-step with `rateType` = `BOOKABLE` or `RECHECK`.
  (DOCUMENTED — booking-api workflow doc.)
- **Sandbox / test access:** `api.test.hotelbeds.com` documented for
  the same `/hotels`, `/checkrates`, `/bookings`. (DOCUMENTED.)
- **Time to credentials:** **Sales-gated** for production; sandbox via
  partner team. (INFERRED — "Getting Started" + "Certification
  process" pages imply multi-step onboarding.)
- **Search:** `/hotels` (availability), `/checkrates` (re-evaluate
  specific rateKey for `RECHECK`). (DOCUMENTED.)
- **Rate/room availability:** `availabilityRS` returns price,
  cancellation policies, board type, payment type, rate class, rate
  comments ID. (DOCUMENTED.)
- **Quote/prebook:** `checkrates` for `RECHECK` rates (price/availability
  revalidation). (DOCUMENTED.)
- **Booking:** `POST /bookings` returns booking with `status`
  (CONFIRMED / CANCELLED) and `clientReference` for idempotency.
  (DOCUMENTED.)
- **Retrieve:** `GET /bookings` (list) and `GET /bookings/{id}` (detail)
  — same `/bookings` endpoint, five purposes. (DOCUMENTED.)
- **Cancellation:** Cancellations and **simulate-cancellation** (to
  retrieve cancellation conditions without actually cancelling) on the
  same `/bookings` endpoint. (DOCUMENTED — "Cancel a booking or
  simulate a cancelation to get the details of cancellation
  conditions".)
- **Modification:** `/bookings` also supports "Modify a booking"
  (DOCUMENTED — workflow doc). **Operational caveat:** because
  `rateKey` strings encode the original check-in/check-out dates,
  new-dates modification effectively means re-search and rebook at
  the new dates. (INFERRED — `rateKey` example in the workflow doc
  has dates embedded.) So: documented surface says modify; the
  *operational* pattern is usually cancel + new search + new book.
- **Hard change / rebook:** Effectively cancel + new search, because
  rateKey is date-bound. Re-confirmation is a separate service
  (DOCUMENTED — Reconfirmation Service in workflow doc: "Push Service,
  Email Service" all in post-booking umbrella).
- **Payment / virtual cards:** `paymentType` includes `AT_WEB` (pay at
  property) and others; Hotelbeds historically works with virtual
  credit cards for B2B distribution (INFERRED).
- **Negotiated corporate rates:** Not a first-class RAC concept;
  corporate deals live in the contract layer.
- **After-sales workflow:** **Reconfirmation Service** (DOCUMENTED),
  Push notifications, Email service.
- **Confirmation semantics:** **Provider-confirmed** on `BOOKABLE`
  rateKeys; **`RECHECK` rateKey** flow is two-step: checkrates then
  book. Confirmation still synchronous once the book call returns.
  (DOCUMENTED.)
- **Support / SLA:** Through HBX account manager; SLA per contract.
- **Production onboarding:** Sales-gated, multi-step, certification
  process documented
  (https://developer.hotelbeds.com/documentation/hotels/knowledge-base/certification-process/).
- **Commercial constraints:** B2B net-rate + markup; volume rebates.
- **Region coverage (incl. Singapore):** Global; strong APAC including
  Singapore. (INFERRED.)
- **Implementation effort:** Moderate-to-high. JSON but XML-style
  examples in docs; well-documented. (DOCUMENTED.)
- **Node / TypeScript SDK quality:** No first-party Node/TS SDK
  surfaced. Community SDKs exist (INFERRED).
- **RECORD/REPLAY suitability:** Reasonable. JSON responses with
  meaningful IDs. `rateKey` with embedded dates is awkward for
  replay across new dates but trivial for replay of the original
  flow.

**Decision:** **DEFER** (production partner, post-hackathon candidate) +
**SIMULATE_PROVIDER_BOUNDARY** (this week — Hotelbeds-style response
shapes are a good model for the provider-neutral capability delta).

### 2.4 Amadeus — Self-Service (DECOMMISSIONED) vs Enterprise

- **Business model:** Enterprise GDS. Sales-gated. **Self-Service is
  DEAD** since 2026-07-17 (see §1).
- **Intended customer:** Airlines, TMCs, large OTAs, GDS resellers.
- **TMC / corporate relevance:** Historically the gold standard for
  TMC air+hotel on a single PNR. Enterprise hotel product includes
  GDS hotel segments (`Hotel_Sell`, `Hotel_Display`) integrated with
  PNR. (INFERRED from
  https://developers.amadeus.com/enterprise/category/hotel and
  Enterprise Hotel Booking Retrieve docs
  https://developers.amadeus.com/enterprise/category/hotel/api/booking
  referencing a "reference PNR record locator value".)
- **Inventory model:** GDS-routed hotel content; chain hotels +
  aggregated GDS inventory. (INFERRED.)
- **Sandbox / test access:** Enterprise sandbox requires `Request
  access` via Enterprise portal — sales contact, not instant.
  (DOCUMENTED — https://developers.amadeus.com/enterprise.)
- **Time to credentials:** **Sales-gated.** Self-service unavailable.
  (DOCUMENTED.)
- **Search:** Hotel List API, Hotel Search v3 (DOCUMENTED via
  Stack Overflow / GitHub changelog trail and
  https://developers.amadeus.com/self-service/category/hotels/api-doc/hotel-booking/v/1.0
  — but Self-Service keys are now disabled; Enterprise keys required).
- **Quote/prebook:** Hotel Search v3 + Hotel Booking.
- **Booking:** Hotel Booking v1 — DOCUMENTED via
  https://developers.amadeus.com/self-service/category/hotels/api-doc/hotel-booking/v/1.0
  ("complete bookings at over 150,000 hotels"). Self-service keys
  disabled; Enterprise keys required.
- **Retrieve:** Hotel Booking Retrieve, Enterprise (DOCUMENTED).
- **Cancellation:** Hotel Order management on Enterprise.
- **Modification:** Hotel order modification on Enterprise —
  historically weaker than Expedia Rapid Hard Change; typical
  workflow is GDS-style cancel + rebook. (INFERRED.)
- **Negotiated corporate rates:** Yes — GDS negotiated rates (`RQ`)
  are first-class.
- **After-sales workflow:** Standard GDS PNR servicing.
- **Confirmation semantics:** Provider-confirmed in the Enterprise
  PNR; GDS-style.
- **Support / SLA:** Enterprise SLAs per contract.
- **Production onboarding:** **Sales-gated, multi-week to multi-month**
  with commercial agreement. (DOCUMENTED.)
- **Commercial constraints:** Significant. Enterprise pricing.
- **Region coverage (incl. Singapore):** Global including Singapore.
  (INFERRED.)
- **Implementation effort:** High. GDS-style XML heritage, complex
  PNR concepts.
- **Node / TypeScript SDK quality:** `amadeus4dev/amadeus-node` exists
  for Self-Service (now offline). No first-party Node SDK for
  Enterprise surfaced. (DOCUMENTED via GitHub.)
- **RECORD/REPLAY suitability:** Reasonable, but GDS PNR state
  complex.

**Decision:** **DEFER** (Enterprise, post-hackathon, air+hotel-on-PNR
candidate) + **REJECT** (Self-Service — no longer exists). This is a
real **ROADMAP.md change** worth flagging: Self-Service deferral
language is now obsolete; only Enterprise deferral remains.

### 2.5 Nuitée (Hotel API, "liteAPI" + "Nuitee Connect")

- **Business model:** Aggregator. Nuitée markets liteAPI as "the only
  open hotel API on the market" (DOCUMENTED — LinkedIn third-party
  post quoting Nuitée,
  https://www.linkedin.com/posts/vansh1505_smartindiahackathon-sih2025-tourismtech-activity-7379123595131891712-Xij9).
  B2B2C / B2B platform infrastructure; per-booking model.
- **Intended customer:** B2B platforms, OTAs, integrators including
  AI-driven travel agents. (DOCUMENTED —
  https://nuitee.com/solutions/b2b-platforms.)
- **TMC / corporate relevance:** Lower priority. Positioned more
  toward integrators and AI agents than traditional TMCs. No RAC /
  negotiated-rates first-class concept surfaced. (INFERRED.)
- **Inventory model:** Aggregator over many bedbanks; ~2M properties
  claimed. (DOCUMENTED — liteapi-node-sdk README.)
- **Sandbox / test access:** **Free sandbox signup**, separate
  `sand_…` API key. (DOCUMENTED — Node.js cookbook:
  `SAND_API_KEY=sand_3dxxxxxxxxx`, test card `4242 4242 4242 4242`.)
- **Time to credentials:** **Self-service sandbox in minutes**;
  production requires a production key + commercial agreement.
  (DOCUMENTED — free signup at
  https://dashboard.liteapi.travel/register.)
- **Search:** Two-phase: `getHotels(countryCode, cityName)` returns
  hotel IDs; `getFullRates(...)` returns full rate detail with
  cancellation policies. (DOCUMENTED — Node.js cookbook.)
- **Rate/room availability:** `getFullRates` returns rich rate
  objects including `cancellationPolicies.cancelPolicyInfos[]`,
  `refundableTag`, `retailRate.total`, `taxesAndFees`, `boardType`.
  (DOCUMENTED — SDK README and Canceling a Booking page.)
- **Policy/cancellation info:** Detailed `cancelPolicyInfos` per rate,
  with `cancelTime`, `amount`, `currency`, `type`, `timezone`.
  (DOCUMENTED.)
- **Quote/prebook:** `preBook({offerId, usePaymentSdk, voucherCode})`
  returns a `prebookId` and reports `cancellationChanged`,
  `boardChanged`, `priceDifferencePercent`. (DOCUMENTED — SDK README.)
- **Booking:** `book({prebookId, holder, payment, guests})` returns
  `bookingId` and `hotelConfirmationCode`. (DOCUMENTED.)
- **Retrieve:** `retrieveBooking(bookingId)` returns full booking
  including `status`, `hotelConfirmationCode`, `cancellationPolicies`.
  (DOCUMENTED.)
- **Cancellation:** `cancelBooking(bookingId)` returns status,
  `cancellation_fee`, `refund_amount`, `currency`. (DOCUMENTED.)
- **Modification:** **No first-class modify endpoint surfaced** in
  the SDK README or cancellation page. Workflow is cancel + rebook.
  (DOCUMENTED — SDK's "Booking management" has only list / retrieve
  / cancel; no modify.)
- **Payment / virtual cards:** CREDIT_CARD, STRIPE_TOKEN, Account
  Credit Card, Credit Line Payments (DOCUMENTED — payment options in
  the docs tree). Stripe Elements integration available. Virtual card
  likely enterprise-contract-dependent. (INFERRED.)
- **Negotiated corporate rates:** No first-class RAC concept surfaced;
  closed-user-group is aggregator-dependent. (INFERRED.)
- **After-sales workflow:** Webhooks ("Nuitee Connect webhooks",
  DOCUMENTED in docs tree).
- **Confirmation semantics:** Provider-confirmed synchronously on
  `book`; `hotelConfirmationCode` returned. (DOCUMENTED.)
- **Support / SLA:** SaaS support; status via dashboard.
- **Production onboarding:** Self-service to dashboard, then commercial.
- **Commercial constraints:** Per-booking commission / commercial
  terms.
- **Region coverage (incl. Singapore):** Global; Nuitée has
  Singapore/LA/Dublin offices and an APAC customer success role
  (DOCUMENTED — LinkedIn
  https://www.linkedin.com/jobs/view/customer-success-manager-apac-at-nuit%C3%A9e-4224645502).
- **Implementation effort:** Low — SDK is npm-installable.
  (DOCUMENTED — `npm install liteapi-node-sdk`.)
- **Node / TypeScript SDK quality:** **First-party Node SDK at
  v4.3.2**, ~18K weekly downloads, ISC-licensed, maintained by Nuitée.
  (DOCUMENTED — https://www.npmjs.com/package/liteapi-node-sdk.)
  Meaningful for Atlas's Node/TS stack.
- **RECORD/REPLAY suitability:** Excellent. Clean JSON, token-shaped
  IDs (`offerId`, `prebookId`, `bookingId`).

**Decision:** **USE_SANDBOX** (this week; free, fast, testable) +
**USE_LIVE** (post-hackathon, strong alternative particularly for
SG/APAC-heavy inventories).

### 2.6 Booking.com Demand API

- **Business model:** Affiliate / Managed Affiliate Partner. The
  Demand API "enables Affiliate Partners to access Booking.com's
  travel inventory" (DOCUMENTED —
  https://developers.booking.com/demand/docs/open-api/demand-api).
  Partner-gated, not public self-service.
- **Intended customer:** Affiliates, large TMCs, OTAs with significant
  volume. (DOCUMENTED.)
- **TMC / corporate relevance:** High in established TMC market;
  inventory breadth unmatched in leisure, weaker in corporate
  negotiated. RAC / corporate rate concept exists on the property
  side but not first-class in the API. (INFERRED.)
- **Inventory model:** Booking.com platform inventory —
  accommodations, cars, attractions. (DOCUMENTED.)
- **Sandbox / test access:** **Yes** —
  `https://demandapi-sandbox.booking.com/3.1` (DOCUMENTED in API
  reference "Servers" section). "As a Booking.com Managed Affiliate
  Partner, you can explore our API collections and test them
  directly" (DOCUMENTED — /demand/docs/getting-started/try-out-the-api).
- **Time to credentials:** **Sales-gated, multi-stage approval.** The
  Affiliate API "is generally reserved for partners with high booking
  volumes and requires a multi-stage approval process by the
  Booking.com [affiliate team]" (DOCUMENTED — mize.tech blog on the
  affiliate program).
- **Search:** Accommodation search, availability check, details
  retrieval, reviews. (DOCUMENTED.)
- **Quote/prebook:** Order preview endpoint exists. (DOCUMENTED —
  /orders/overview API doc.)
- **Booking:** `POST /orders` creates a booking. (DOCUMENTED.)
- **Retrieve:** Order details API. (DOCUMENTED.)
- **Cancellation:** Cancel order via Orders API. (DOCUMENTED.)
- **Modification:** Modify order via Orders API. (DOCUMENTED —
  /orders/overview lists "cancel or modify existing orders".)
  Modification depth unclear in our reads; presumably
  date/occupancy for some rate types.
- **Hard change / rebook:** Likely cancel + rebook for major changes.
- **Payment / virtual cards:** Affiliate-collect model; payment
  flows documented in /payments/overview. (DOCUMENTED.)
- **Negotiated corporate rates:** Booking.com for Business exists
  for SMEs, but corporate RAC distribution is not surfaced as a
  Demand API feature.
- **After-sales workflow:** Messaging API for property communication.
  (DOCUMENTED.)
- **Confirmation semantics:** Provider-confirmed; async components
  for some property-collect flows. (INFERRED — Booking.com's
  property-collect pattern can be asynchronous; not verified for
  Demand API specifically — **UNKNOWN** for Demand API's exact
  async surface.)
- **Support / SLA:** Per-partner; SLAs not public.
- **Production onboarding:** **Sales-gated**, multi-stage approval.
  Weeks-to-months.
- **Commercial constraints:** Per-booking commission per affiliate
  agreement.
- **Region coverage (incl. Singapore):** Global, very strong in
  Singapore / APAC for leisure; weaker for premium corporate
  inventory. (INFERRED.)
- **Implementation effort:** High — large API surface, complex
  authentication.
- **Node / TypeScript SDK quality:** No first-party Node/TS SDK
  surfaced.
- **RECORD/REPLAY suitability:** Moderate.

**Decision:** **DEFER** (production, gated) + **REJECT** (this week —
sandbox access requires partner status we don't have and can't
credibly obtain in a credential-less sandbox).

---

## 3. Provider matrix (compact)

| Dimension | Expedia Rapid | Duffel Stays | Hotelbeds | Amadeus Enterprise | Nuitée/liteAPI | Booking.com Demand |
|---|---|---|---|---|---|---|
| Self-service signup | NO | YES (~1 min) | NO | NO | YES (free sandbox) | NO |
| Sandbox reachable this week | NO | **YES** | NO | NO | **YES** | NO |
| Search endpoint | Shopping | 4-step | /hotels | Hotel Search v3* | 2-step | Accommodation |
| Quote/Prebook | inline price_check | /quotes | /checkrates | yes | preBook | order preview |
| Book | yes | yes | yes | yes | yes | POST /orders |
| Retrieve | Itinerary | GET booking | GET booking | yes | retrieveBooking | Orders API |
| Cancel | DELETE | actions/cancel | /bookings simulate/confirm | yes | cancelBooking | Cancel order |
| **Modify in-place** | **YES (Hard Change)** | NO (cancel+rebook) | PARTIAL (date-keyed rateKeys) | PARTIAL (GDS) | NO (cancel+rebook) | YES (Modify order) |
| Corporate / RAC | member rates | **YES (negotiated_rates)** | NO (contract) | YES (RQ via GDS) | NO | NO |
| Virtual card | YES (commit types) | partial (3DS, balance) | YES (B2B) | YES (GDS) | YES (credit line) | YES (affiliate collect) |
| Confirmation | provider-confirmed | provider-confirmed | provider-confirmed (2-step RECHECK) | provider-confirmed (GDS) | provider-confirmed | provider-confirmed (some async — UNKNOWN) |
| Node/TS SDK | NO (Java only) | **YES (first-party JS)** | NO (community) | NO (Enterprise) | **YES (v4.3.2, ~18K/wk)** | NO |
| SG/APAC fit | Strong | Strong | Strong | Strong | Strong (APAC office) | Strong (leisure) |

*Hotel Search v3 is documented under Self-Service URLs but
self-service keys are disabled; Enterprise keys required.

---

## 4. PRIMARY RECOMMENDATION

**Adopt Duffel Stays as the primary long-term hotel provider
integration target.** Use Duffel Stays' sandbox (Test Hotels at
`-24.38, -128.32`) for credential-less testing this week to prove the
provider-neutral capability delta (search/availability/quote/prebook/
book/retrieve) end-to-end through the existing `CapabilityResult`
envelope. Duffel is the only serious candidate that simultaneously
satisfies:

- **Self-service sandbox this week** (no sales contact, test token in
  minutes, full search→quote→book→cancel loop exercisable).
- **TMC / corporate fit long-term** (Negotiated Rates endpoint is
  first-class, RAC distribution built-in, the corporate travel
  workflow is explicitly documented for a TMC, and Duffel already
  supports `closed_user_group` and `corporate` deal types in the
  rate schema).
- **Modern, developer-friendly API** (clean JSON, four-step flow,
  first-party JS client library that integrates with our Node/TS
  stack).
- **Reasonable RECORD/REPLAY** (token-shaped IDs, deterministic flow).

The known weak spot — **no in-place modification** — is workable
because (a) Atlas today already has `cancelStay` as the modification
path (`capabilities.ts:166`), (b) cancel-and-rebook maps cleanly to a
`cancelStay` + new `book` flow inside our provider-neutral seam, and
(c) we keep the door open to add an in-place modify later if Duffel
ships one. (Duffel's current `PATCH /stays/bookings/{id}` only updates
users; the more general "hotel change" is something to track in their
changelog.)

## 5. BACKUP RECOMMENDATION

**Adopt Nuitée (liteAPI) as the strong second choice.** Use the
**free sandbox** (https://dashboard.liteapi.travel/register, test card
`4242 4242 4242 4242`) this week as a parallel proof point and a
hedge against Duffel commercial risk. Nuitée offers:

- The **best Node/TS SDK** of any provider we evaluated
  (`liteapi-node-sdk` v4.3.2, ~18K weekly downloads, ISC-licensed,
  maintained by Nuitée).
- A clean three-step `preBook → book → retrieve` flow that maps 1:1
  to a "quote-then-book" provider-neutral capability.
- A 2M+ property aggregator, **APAC office presence** (Singapore
  CSM role exists), and modern payment options including Credit
  Line (relevant for TMC invoicing).

The weak spot — also no in-place modification, no first-class RAC —
is the same as Duffel, but the SDK quality and APAC operational
presence tip the balance for any Atlas deployment that needs to be
Singapore-first.

## 6. WHY (one paragraph)

Duffel is the only provider that simultaneously gives us a sandbox
this week **and** a corporate-rate path next quarter. Expedia Rapid
and Hotelbeds are the right long-term shape for a large TMC, but
their access is sales-gated and the effort isn't justified for a
hackathon. Amadeus Self-Service is **gone** (decommissioned
2026-07-17), so the ROADMAP deferral language needs an update.
Booking.com Demand is gated behind the affiliate partner program
that we can't enter this week. Nuitée is the best second choice and
is the strongest hedge for APAC; the **non-trivial** difference
between Duffel and Nuitée is that Duffel has documented
`negotiated_rates` (corporate RAC), while Nuitée does not. For a
resolution layer that wants to claim TMC relevance, that corporate
contract is the differentiator — and Duffel wins it.

## 7. WHAT WE CAN TEST NOW

**Without signing up for anything other than a free account**, this
week we can exercise:

- **Duffel Stays test mode** — sign up at
  https://app.duffel.com/join, request Stays access, generate
  `duffel_test_` token, search test hotels at `-24.38, -128.32`, run
  the full 4-step search→fetch_rates→quote→book→cancel flow, observe
  `status: "confirmed"`, exercise
  `POST /stays/bookings/{id}/actions/cancel`.
- **Nuitée liteAPI sandbox** — sign up at
  https://dashboard.liteapi.travel/register, copy `sand_…` key, run
  `getHotels → getFullRates → preBook → book → retrieveBooking →
  cancelBooking`. Use the `liteapi-node-sdk` directly from our
  Node/TS stack.

**Requires account activation** (not achievable this week):

- Expedia Rapid sandbox (partner application + BD manager)
- Hotelbeds sandbox (partner + certification)
- Amadeus Enterprise sandbox (sales contact)
- Booking.com Demand sandbox (affiliate partner program)

**Simulate at the provider boundary** (per ADR-007):

- Any TMC negotiated-rate (RAC) flow — no provider exposes
  load-RAC to our account this week.
- Any "change of stay dates" on Duffel/Nuitée/Hotelbeds (cancel +
  rebook shape), or any modification on Expedia Rapid that needs
  sandbox credentials we can't get.

## 8. WHAT A REAL TMC WOULD LIKELY DO LATER

A real TMC adopting Atlas post-hackathon would, in order:

1. **Adopt Expedia Rapid as the long-term production path** for
   breadth (800K+ properties, merchant + agency, Hard Change for
   in-place modifications, member rates). Sales-gated access is
   fine because they have commercial relationships.
2. **Add Hotelbeds as a complementary wholesaler** for B2B net-rate
   inventory and TMC-typical markets (Europe/LATAM/APAC), especially
   where they have pre-existing Hotelbeds contracts.
3. **Add Duffel Stays** for the developer-friendly modern API path,
   **specifically because of the negotiated-rates endpoint** that
   gives them a programmatic way to load and distribute corporate
   RACs without a GDS relationship.
4. **Add Amadeus Enterprise** only if they need a single PNR for
   air + hotel and they already have an Amadeus GDS contract.
5. **Use Booking.com Demand** as a fallback affiliate channel for
   properties that don't show in the other sources.
6. **Skip Nuitée** unless they have a specific reason — a fine
   aggregator but no TMC-specific features (no RAC, no in-place
   modify) that drive a TMC's provider selection.

This ordering is **inverted** vs. the hackathon ordering (Duffel
primary, Expedia/Hotelbeds deferred). That's correct: hackathon
needs sandbox this week; TMC needs production breadth and
modification depth in six months.

## 9. Minimum provider-neutral `HotelCapability` contract delta
(PROPOSAL ONLY — do not implement)

Delta vs. `src/contracts/capabilities.ts:162-167`. Provider-neutral
(no Duffel/Nuitée/Expedia-specific shapes), follows the existing
`CapabilityResult` envelope discipline (NFR-03: external failure is
data, not a crash), matches the `FlightCapability` pattern (search /
verify / rules).

```ts
// Proposed additions to HotelCapability. Provider-neutral.
// Source authorities: documented search/quote/prebook/book/retrieve
// patterns from Duffel Stays, Nuitée liteAPI, Expedia Rapid, Hotelbeds.

export interface HotelSearchQuery {
  location:
    | { externalRef: ExternalRef; radiusKm?: number }
    | { latitude: number; longitude: number; radiusKm?: number };
  checkInDate: string;     // YYYY-MM-DD
  checkOutDate: string;    // YYYY-MM-DD
  rooms: number;
  guests: { adults: number; children?: number; childAges?: number[] }[];
  /** Provider-neutral negotiated-rate request (corporate RAC). */
  negotiatedRateIds?: string[];
  /** Filter to a specific accommodation list (rate-shopping). */
  accommodationIds?: string[];
  /** Loyalty programme hint, if relevant. */
  loyaltyProgramme?: string;
}

export interface HotelRateView {
  rateId: string;          // provider-opaque offer/rate identifier
  accommodationId: string;
  roomType?: string;
  boardType?: string;      // room_only, breakfast_included, ...
  totalPrice: Money;
  /** Cancellation timeline as an ordered list of deadlines. */
  cancellationTimeline?: { deadline: IsoDateTime; fee?: Money }[];
  /** Provider-confirmed or async/onsite-pay or unknown. */
  paymentTiming: 'PAY_NOW' | 'PAY_AT_PROPERTY' | 'UNKNOWN';
  /** First-class marker if a corporate rate is available. */
  negotiatedRateId?: string;
  dealTypes?: string[];    // corporate, closed_user_group, mobile, ...
  expiresAt?: IsoDateTime;
}

export interface HotelSearchOutcome {
  results: { accommodationId: string; accommodationName?: string; cheapestRate?: HotelRateView }[];
}

export interface HotelFetchRatesQuery {
  /** The provider-opaque search result or accommodation set. */
  searchResultId?: string;
  accommodationIds?: string[];
  checkInDate: string;
  checkOutDate: string;
  guests: { adults: number; children?: number; childAges?: number[] }[];
}

export interface HotelFetchRatesOutcome { rates: HotelRateView[]; }

export interface HotelQuoteQuery { rateId: string; }

export interface HotelQuoteOutcome {
  quoteId: string;
  expiresAt?: IsoDateTime;
  rate: HotelRateView;
  priceChanged?: boolean;
  cancellationChanged?: boolean;
}

export interface HotelBookQuery {
  quoteId: string;
  primaryGuest: { givenName: string; familyName: string; email: string; phoneE164?: string };
  guests: { givenName: string; familyName: string; }[];
  paymentRef?: string;     // provider-opaque payment handle (balance/card/virtual/3DS)
  specialRequests?: string;
  clientReference?: string;
}

export interface HotelBookOutcome {
  bookingId: string;       // provider-opaque
  reference?: string;      // provider/hotel confirmation reference
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
  rate: HotelRateView;
  confirmedAt?: IsoDateTime;
}

export interface HotelRetrieveQuery { bookingId: string; }

export interface HotelRetrieveOutcome {
  bookingId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'PENDING' | 'UNKNOWN';
  reference?: string;
  confirmedAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
  rate: HotelRateView;
  checkInDate: string;
  checkOutDate: string;
}

export interface HotelCancelQuery { bookingId: string; reason?: string; }

export interface HotelCancelOutcome {
  bookingId: string;
  status: 'CANCELLED' | 'FAILED';
  refundAmount?: Money;
  cancellationFee?: Money;
  confirmedAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
}

export interface HotelCapability {
  readonly descriptor: CapabilityDescriptor;
  // --- existing read-only/adapter methods preserved ---
  getStayContext(query: StayContextQuery): Promise<CapabilityResult<StayContext>>;
  modifyStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>>;
  cancelStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>>;
  // --- new transactional surface (proposed) ---
  searchHotels(query: HotelSearchQuery): Promise<CapabilityResult<HotelSearchOutcome>>;
  fetchRates(query: HotelFetchRatesQuery): Promise<CapabilityResult<HotelFetchRatesOutcome>>;
  quoteRate(query: HotelQuoteQuery): Promise<CapabilityResult<HotelQuoteOutcome>>;
  bookStay(query: HotelBookQuery): Promise<CapabilityResult<HotelBookOutcome>>;
  retrieveBooking(query: HotelRetrieveQuery): Promise<CapabilityResult<HotelRetrieveOutcome>>;
  cancelBooking(query: HotelCancelQuery): Promise<CapabilityResult<HotelCancelOutcome>>;
}
```

Notes for the eventual implementer:

- Keep `id` strings (rateId, quoteId, bookingId) **opaque** — never
  reinterpret them. Matches `FlightOffer.offerId` and
  `FlightVerifyQuery.workflowState` discipline in the existing file.
- Use the same `CapabilityResult` envelope; surface provider timeouts
  / "rate unavailable" as `CapabilityResult` failures, not throws.
- For Duffel: `search → fetch_rates → quote → book` maps 1:1.
- For Nuitée: `getHotels → getFullRates → preBook → book` collapses
  onto the same shape.
- For Expedia Rapid: the `shop_for_change` Hard Change link maps onto
  a hypothetical `modifyStay` (tokenized) — but Rapid is not this
  week's recommendation, so this is a future extension.
- `HotelActionOutcome.provenance` already supports
  `LIVE | REPLAY | SIMULATED` (`capabilities.ts:159`). The new
  transactional methods should also respect that.

---

## 10. Reality-decision summary

| Provider | Hackathon (this week) | Post-hackathon (TMC) | Final |
|---|---|---|---|
| Expedia Rapid (EAN) | sales-gated, not reachable | primary TMC path | **DEFER + USE_SANDBOX (when access granted)** |
| Duffel Stays | **sandbox reachable, USE NOW** | secondary TMC path (corporate RAC) | **USE_SANDBOX + USE_LIVE** |
| Hotelbeds (HBX) | sales-gated, not reachable | wholesaler complement | **DEFER + SIMULATE_PROVIDER_BOUNDARY** |
| Amadeus (Self-Service) | DECOMMISSIONED 2026-07-17 | n/a | **REJECT** (no longer exists) |
| Amadeus (Enterprise) | sales-gated, not reachable | GDS air+hotel on PNR | **DEFER** |
| Nuitée / liteAPI | **sandbox reachable, USE NOW** | APAC aggregator, second choice | **USE_SANDBOX + USE_LIVE** |
| Booking.com Demand | affiliate-gated, not reachable | affiliate channel | **DEFER + REJECT (this week)** |

---

## 11. Recommended roadmap updates (informational)

Observations for the next reality-validation checkpoint; this is a
research/docs branch so we don't touch the ROADMAP here:

- `ROADMAP.md:143` ("Amadeus / Sabre / Travelport / other NDC/GDS
  adapters") is now partially stale — Amadeus Self-Service is gone.
  Update to clarify "Amadeus Enterprise (sales-gated); Self-Service
  was decommissioned 2026-07-17."
- `ROADMAP.md:155-157` ("Real hotel modification/cancellation
  without an available provider API") is still correct as a
  deferral rationale, but the recommendation ordering should now be
  Duffel > Nuitée > Expedia Rapid > Hotelbeds > Booking.com >
  Amadeus Enterprise.
- `ROADMAP.md:109-111` (Booking.com Demand is Stretch) remains
  correct; partner-gated.
- The provider-neutral `HotelCapability` delta in §9 is the
  *minimum* surface needed to make Atlas's hotel capability
  transactional; we are not implementing it on this branch.

---

## 12. Source URLs (de-duplicated)

- https://developers.expediagroup.com/rapid/setup
- https://developers.expediagroup.com/rapid/lodging/manage-booking/hard-change
- https://developers.expediagroup.com/rapid/lodging/api-explorer/common-apis
- https://partner.expediagroup.com/en-us/join-us/rapid-api
- https://github.com/ExpediaGroup/rapid-java-sdk
- https://duffel.com/docs/guides/getting-started-with-stays
- https://duffel.com/docs/guides/test-hotels
- https://duffel.com/docs/guides/negotiated-rates
- https://duffel.com/docs/api/v2/bookings/get-booking
- https://duffel.com/docs/guides/javascript-client-library
- https://developer.hotelbeds.com/documentation/hotels/booking-api/
- https://developer.hotelbeds.com/documentation/hotels/booking-api/workflow/
- https://developer.hotelbeds.com/documentation/hotels/knowledge-base/certification-process/
- https://www.hbxgroup.com/products-and-services/api-suite
- https://developers.amadeus.com/
- https://developers.amadeus.com/enterprise
- https://developers.amadeus.com/enterprise/category/hotel
- https://airlabs.co/amadeus-self-service-api-shutdown
- https://www.tripgic.com/playbook/amadeus-api-shutdown-migration/
- https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers
- https://developers.amadeus.com/self-service/category/hotels/api-doc/hotel-booking/v/1.0
- https://nuitee.com/
- https://nuitee.com/solutions/b2b-platforms
- https://nuitee.com/insights/effortlessly-test-travel-api-integrations-with-liteapis-sandbox-key
- https://docs.liteapi.travel/docs/nodejs-cookbook
- https://docs.liteapi.travel/docs/canceling-a-booking
- https://www.npmjs.com/package/liteapi-node-sdk
- https://developers.booking.com/demand/docs/open-api/demand-api
- https://developers.booking.com/demand/docs/getting-started/try-out-the-api
- https://partnerships.booking.com/api-v3
- https://mize.tech/blog/all-about-the-booking-com-affiliate-partner-program-for-travel-agents/
- https://www.linkedin.com/jobs/view/customer-success-manager-apac-at-nuit%C3%A9e-4224645502

End of investigation. No product code touched. Only the report file
`docs/reality-validation/02_HOTEL_PROVIDER_DECISION.md` is created on
this branch.
