# Atlas Sandbox Reality — Reality Validation Report

**Milestone:** Reality Validation (Atlas x Alibaba Cloud hackathon, `qoder-atlas`)
**Investigator:** Atlas investigation lane
**Date:** 2026-08-22
**Branch:** `rv/atlas-investigation`
**Base commit:** `6d20396`
**Worktree:** `/data/worktrees/rv-atlas`
**Scope:** READ-ONLY research. No code, no credentials, no live calls.
**Environment caveat:** this sandbox has NO Atlas credentials
(`ATLAS_CLIENT_ID` / `ATLAS_CLIENT_SECRET`). All live probes are
`ACCESS_BLOCKED`; evidence is a mix of `OBSERVED_SANDBOX` (prior
`atlas-hackathon-lab` captures, cited) and `DOCUMENTED` (official Atlas
docs pages, fetched 2026-08-22).

---

## 1. Executive summary

Atlas is the hackathon flight adapter. The product's
`FlightCapability` contract (`src/contracts/capabilities.ts:97`) currently
exposes three operations: `searchFlights`, `verifyOffer`, `getFareRules`.
The Atlas adapter (`src/providers/atlas/adapter.ts:57`) maps those to
`search.do`, `verify.do` (and the same `verify.do` response's `rule` block
for fare rules). The lab already proved the read-only surface works end to
end on nine documented test airlines.

For the Reality Validation milestone the headline question is: **can
Atlas actually carry the recovery work in the hackathon account, and is
Singapore (SIN) usable?** Honest answers:

- **Read-only chain (`search` → `verify` → `getFareRules`)**
  `OBSERVED_SANDBOX` (lab pass 2026-08-19) and `DOCUMENTED` (current
  official `search.do` / `verify.do` references). 39 successful saved
  Search captures plus one Verify, one `getLuggage.do`, one
  `seatAvailability.do` all returned provider `status: 0`. Rule block
  inside Search/Verify is real and supplies the change/refund/no-show/
  baggage rule structures the recovery planner needs.
- **Transactional surfaces (`order.do`, `pay.do`, `queryOrderDetails.do`,
  `refund*.do`, voids, PNR claim, post-ticket ancillaries)**
  `DOCUMENTED` and account-gated. No hackathon order has been created;
  calling them blind is high risk and offers no demo value. The Skill
  even reports `TICKETING_ACTIVATION_REQUIRED` for this account.
- **Webhooks / incident list**
  `DOCUMENTED`; registration changes account state. No live registration
  evidence. Useful only if we plan to demonstrate inbound disturbances,
  which we are not.
- **Singapore (SIN)**
  NOT in the 9-airline / 36-route / 34-OD official fixture set. The
  documented `search.do` request contract has **no route whitelist** for
  one-way searches; arbitrary O&D requests are accepted by the contract.
  Whether undocumented routes actually return offers is `UNKNOWN` (this
  sandbox is `ACCESS_BLOCKED`); the lab saw 6 successful empty fixtures
  (status 0, zero offers), which is a documented possible outcome for
  valid-syntax requests. There is an official channel to **request
  additional test routes** (FAQ Question 2) — only the organisers /
  Atlas account manager can enable new fixtures. See §4.

**Bottom line for the planner.** Keep the read-only chain as the
`FlightCapability` adapter (it is already implemented and recorded). Do
**not** extend the contract to transactional flows; instead
**simulate at the provider boundary** with recorded / scripted fixtures
when the demo needs an order, payment, refund, or change. Record live
search/verify sessions during demo prep so we can `REPLAY` them offline.
**Do not promise SIN as a live demo route** until either (a) the
organisers confirm a SIN fixture, or (b) a one-way SIN→X live search
returns offers in this account (requires credentials, see §8).

---

## 2. Evidence and method

### 2.1 Evidence levels

| Tag | Meaning |
| --- | --- |
| `DOCUMENTED` | Quoted from official Atlas docs (fetched 2026-08-22). |
| `OBSERVED_SANDBOX` | Executed in `atlas-hackathon-lab` in a prior pass; cited. Counts for prior captures, not for present. |
| `ACCESS_BLOCKED` | No credentials here. Documented plan only. |
| `INFERRED` | Reasonable from the request contract or lab behaviour, not directly executed. |
| `UNKNOWN` | Not enough to classify. |

### 2.2 Sources

**Lab / project (read-only):** `atlas-hackathon-lab/docs/{ATLAS_FINAL_CAPABILITY_REPORT,ATLAS_CAPABILITY_MATRIX,SANDBOX_COVERAGE_MATRIX,SKILL_VS_API,INTERESTING_FINDINGS,OPEN_QUESTIONS}.md`; `atlas-hackathon-lab/scripts/{enumerate_atlas_sandbox_routes,probe_atlas_sandbox,probe_atlas_readonly_flow,profile_atlas_json_schema,summarize_atlas_searches}.py`.

**Official Atlas docs (fetched 2026-08-22):**
- Sandbox Test Routes — `https://resources.atriptech.com/api-document/support-and-reference/integration-reference/sandbox-test-data/sandbox-test-routes`
- API Integration FAQ (81 items) — `https://resources.atriptech.com/frequently-asked-questions/api-integration-faqs`
- Search product guide — `https://resources.atriptech.com/api-document/product-guides/booking/booking-step-guides/search`
- Sandbox Development — `https://resources.atriptech.com/api-document/readme-1/sandbox-development`
- Sandbox Access (headers / credentials) — `https://resources.atriptech.com/api-document/readme-1/making-requests`
- Search API reference — `https://resources.atriptech.com/api-document/api-reference/booking-apis/search`
- Verify API reference — `https://resources.atriptech.com/api-document/api-reference/booking-apis/verify`
- Seat API reference — `https://resources.atriptech.com/api-document/api-reference/booking-apis/inflow-seat-and-baggage`
- Refunds API reference — `https://resources.atriptech.com/api-document/api-reference/post-booking-apis/refunds`
- Fulfilment API — `https://resources.atriptech.com/api-document/product-guides/booking/booking-flows/fulfillment-flow`
- Post-booking APIs index — `https://resources.atriptech.com/api-document/api-reference/post-booking-apis`

**Product repo (read-only):** `src/contracts/capabilities.ts:97` (`FlightCapability`); `src/providers/atlas/adapter.ts:57`; `src/providers/recordingStore.ts:43`; `docs/ARCHITECTURE.md:275` (§14 external posture); `.env.example` (REPLAY default, `ATLAS_*` optional).

### 2.3 Method

1. Read lab SSOT reports.
2. Read the `FlightCapability` contract and the Atlas adapter in the product.
3. Fetch every official Atlas page that could change a verdict.
4. Cross-check: where lab evidence and current docs agree, mark `OBSERVED_SANDBOX + DOCUMENTED`; where they disagree (FAQ Q1 "10" vs route page "9"), record the conflict.
5. For SIN, separate "what the contract allows" from "what fixtures are populated" and from "who can add a fixture".

---

## 3. Capability-by-capability classification

`STATUS` column uses the milestone vocabulary:
`PROVEN_SANDBOX` (executed and saved in lab),
`DOCUMENTED_NOT_PROVEN` (contract exists; not executed in this account),
`ACCESS_BLOCKED` (credentials absent here),
`NOT_SUPPORTED` (officially absent or contradicted),
`NOT_WORTH_IMPLEMENTING` (post-ticketing or weak return for the demo).

| # | Capability | Endpoint / surface | Atlas doc status | Lab evidence | Verdict | STATUS |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Cached fare search | `POST /search.do` | DOCUMENTED — request body lists `tripType`, `adultNum`, `childNum`, `infantNum`, `fromCity`, `fromAirport?`, `toCity`, `toAirport?`, `fromDate`, `retDate?`, `airlines[]?`, `fromFlightNumbers[]?`, `retFlightNumbers[]?`, `includeMultipleFareFamily?`, `currency?`, `requestSource?`, `residentCode?`. Default 100 results, sorted by fare asc. Default 10 QPS, 429 over limit with `retryAfter`. | 39 successful saved Search responses; 30 non-empty fixtures across 9 airlines (472 offers); 6 empty fixtures; 30 unique O&Ds. | Reliable read-only surface. | PROVEN_SANDBOX |
| 2 | Return / multi-passenger search | `POST /search.do` w/ `tripType=2`, `adultNum+childNum+infantNum` | DOCUMENTED | 1 A+1C+1I round trip returned 25 offers. | Works. | PROVEN_SANDBOX |
| 3 | Airline filter | `airlines[]` (max 5) | DOCUMENTED (FAQ Q13) | Accessible but not tested in this pass. | Works on contract; not lab-confirmed. | DOCUMENTED_NOT_PROVEN |
| 4 | Multi-fare-family mode | `includeMultipleFareFamily` | DOCUMENTED — note FAQ Q45 says "We do not support fare families/bundles at the moment". The flag still works at the contract level. | One call; observed `fareFamily: "Standard"` only; empty `bundleOptions`. | Captures only one tier in this fixture. | DOCUMENTED_NOT_PROVEN (note FAQ conflict) |
| 5 | Verify (price revalidation + booking requirements) | `POST /verify.do` w/ `routingIdentifier`, `maxResponseTime?` (default 15000ms) | DOCUMENTED — response carries `sessionId`, `maxSeats`, full `routing{}` (incl. `rule{}` with baggage, refundRules, changesRules, serviceElements), `bookingRequirement{}`, `priceChange{}`. 60 QPM pool shared with `getOffers.do`. | 1/1 successful; 9 candidate passenger fields, 5 required. | Reliable; supplies everything the recovery planner needs. | PROVEN_SANDBOX |
| 6 | Fare rules (change / refund / no-show) | Inside `rule{}` of Search/Verify (`refundRules[]`, `changesRules[]`, `serviceElements[]`, `refNoshow*` fields). Separate `refundQuotation.do` exists for post-ticket quotes only. | DOCUMENTED | 843 baggage-rule rows, 112 change-rule rows, 112 refund-rule rows across 87 sampled offers. Supplier semantics not validated. | Read-only rule read works; deep semantics require targeted tests. | PROVEN_SANDBOX (read) / DOCUMENTED_NOT_PROVEN (post-ticket quote) |
| 7 | Search baggage (included) | `rule.baggageElements[]` inside Search/Verify | DOCUMENTED | 833 ancillary rows in 87 offers. | Read works. | PROVEN_SANDBOX |
| 8 | Exact baggage quote (purchasable) | `POST /getLuggage.do` | DOCUMENTED (separate page) | 1/1 successful; 14 products returned. | Read works. | PROVEN_SANDBOX |
| 9 | Seat map / availability | `POST /seatAvailability.do` w/ `sessionId` (verify) **or** `offerId` (getOffer) and `carrier`. **No longer supports flight-info-alone mode.** 60 QPM pool shared with `getLuggage.do`. | DOCUMENTED | 1/1 successful; 204 seat records. | Read works post-Verify. | PROVEN_SANDBOX |
| 10 | Passenger booking requirements | `verify.routing.bookingRequirement` | DOCUMENTED | 9 candidate fields, 5 required. | Read works. | PROVEN_SANDBOX |
| 11 | GetOffer / GetOfferPrice (independent offer lookup) | `POST /getOffers.do`, `POST /getOfferPrice.do` | DOCUMENTED — GetOfferPrice is the new Fulfilment API entry. "Documented but unavailable" for general use until enabled. | Not executed in lab. | Use only when real-time confirmation is required and Atlas enables it. | DOCUMENTED_NOT_PROVEN |
| 12 | Smart Search | `POST /smartSearch.do` | DOCUMENTED — "will be deprecated soon. Use `search.do` for new integrations." | Not used. | Skip — deprecated. | NOT_WORTH_IMPLEMENTING |
| 13 | Real-time search | `POST /realTimeSearch.do` | DOCUMENTED — "after due consideration" / account-manager enablement. 120 s timeout, 25 s avg. | Not used. | Defer unless scenario needs true live inventory. | DOCUMENTED_NOT_PROVEN |
| 14 | Order creation | `POST /order.do` | DOCUMENTED — 15 s normal, 120 s real-time; 30-min payment window; `tktLimitTime` in SGT. | Not executed. | State-changing; Skill reports `TICKETING_ACTIVATION_REQUIRED`. | ACCESS_BLOCKED (in this account) |
| 15 | FR (Ryanair) order confirmation | `POST /orderCommit.do` w/ `confirmationUrl` | DOCUMENTED | Not executed. | Ryanair-specific. | DOCUMENTED_NOT_PROVEN |
| 16 | Payment | `POST /pay.do` w/ modes 1 (deposit), 3 (VCC passthrough), 5 (MoR) | DOCUMENTED — sandbox has special VCC failure triggers (`Reject` → 633, `Three DS` → 616). | Not executed. | State-changing. | ACCESS_BLOCKED (in this account) |
| 17 | Ticketing + order retrieval | `POST /queryOrderDetails.do` (a.k.a. `orderQuery.do` per error codes) | DOCUMENTED | No orders to query. | Polls until final state. | DOCUMENTED_NOT_PROVEN |
| 18 | Post-ticketing baggage (search) | `POST /postTicketingBaggage.do` (page) | DOCUMENTED | No ticketed order. | Defer. | DOCUMENTED_NOT_PROVEN |
| 19 | Post-ticketing baggage (order) | `POST /postTicketingBaggageOrder.do` (page) | DOCUMENTED | No ticketed order. | State-changing. | DOCUMENTED_NOT_PROVEN |
| 20 | Refund quotation | `POST /refundQuotation.do` w/ `orderNo` or `airlinePNR+carrier`, `refundRequestList[]` | DOCUMENTED — returns `isRefundable`, `refundQuoteType` (AccurateQuote / CannotQuote), `refundMethod`, `refundOfferId`, `expectedConfirmationDate`, `expectedRefundDate`. | No orders. | Useful only with a ticketed order. | DOCUMENTED_NOT_PROVEN |
| 21 | Refund submission | `POST /refund.do` w/ `refundOfferId` (from quote) | DOCUMENTED — `refundStatus` enum 0..6. | No orders. | State-changing. | ACCESS_BLOCKED (in this account) |
| 22 | Query refund status | `POST /queryRefundOrders.do` w/ `refundCode` (+ `orderNo` or `airlinePNR+carrier`) | DOCUMENTED | No orders. | Defer. | DOCUMENTED_NOT_PROVEN |
| 23 | Void | (post-booking group) | DOCUMENTED — void pages exist; void not covered in our fetched excerpts. | Not executed. | State-changing. | DOCUMENTED_NOT_PROVEN |
| 24 | PNR Claim / Extract | (post-booking group) | DOCUMENTED | Not executed. | Post-ticketing; defer. | DOCUMENTED_NOT_PROVEN |
| 25 | Schedule-change / ticket / refund / ancillary / email webhooks | (registration endpoint + per-event payload) | DOCUMENTED — registration changes account state. The fetched `/webhook-overview` page returned 404 today; void-notification page is up. | Not registered. | Out of demo scope (no disturbances planned). | NOT_WORTH_IMPLEMENTING (this milestone) |
| 26 | Incident list / email list | (post-booking group) | DOCUMENTED | Not executed. | Out of demo scope. | NOT_WORTH_IMPLEMENTING (this milestone) |
| 27 | Postman project download | ATRIP — `API Document → API Reference → Atlas Sandbox → UAT Submission Guide` | DOCUMENTED (FAQ Q43) | Not used. | Reference, not capability. | DOCUMENTED |
| 28 | Service-request changes / name correction | ATRIP / service request (per current FAQ) | DOCUMENTED (FAQ Q28, Q81) | Not used. | Manual process. | DOCUMENTED_NOT_PROVEN |

> **Conflict note.** FAQ Question 1 says "10 airlines", Question 2 says
> "9 airlines". The current Sandbox Test Routes page lists **9**.
> Treat 9 as the truth for now and flag the conflict to the
> Organisers action in §7.

---

## 4. Singapore (SIN) analysis

The question is not whether SIN is in the *fixture list* — it is not —
but whether the search contract and Atlas team will *accept* a SIN
request at all. Five angles, per the brief.

### (a) What the official docs say about route coverage

- The **Sandbox Test Routes** page lists 9 airlines, 36 airline-route
  entries, 34 unique O&Ds. **No Singapore (SIN/WSSS) routes are
  enumerated.** The page explicitly says: *"pick a route supported by
  the airline you want to test"*, *"treat route availability as test-only
  guidance, not production coverage"*. The page also points to the
  Sandbox Validation Test Kit as the first-run check; that kit covers a
  pre-published happy path, not a route atlas.
- FAQ Q1: *"The sandbox environment allows you to test functions. We
  provide routes for 10 airlines"* (note the conflict; see §3 note).
- FAQ Q2: *"The sandbox environment allows you to test functions. We
  provide routes for 9 airlines"* (matches the route page) and **adds a
  very important line**: *"Of course, if you'd like to test a specific
  airline or route, feel free to share your testing scenarios and
  desired airlines or routes with us. Our team will promptly respond
  to your request."* This is the official add-a-route channel.

### (b) Does the `search.do` request contract accept arbitrary O&D?

Yes, for one-way. The Search API reference body lists `fromCity` and
`toCity` as `string` (capital IATA codes) with no `routeList`,
`whitelistId`, or `countryFilter` parameter. Error code 105 is
specifically: *"OD is not in client's round-trip white list. This city
pair has not been whitelisted. Check with your account manager if there
is a restriction to your account."* The phrase "round-trip white list"
indicates the whitelist gate applies to round-trip searches, not
one-way.

Consequence: **a one-way SIN→XXX request is well-formed at the
contract level.** Whether the request returns offers is a different
question (see (c)).

### (c) Will an undocumented SIN request return anything?

UNKNOWN in this account. The lab pass saw 6 successful empty fixtures
(J KT-DPS ×2, HKG-CEB, KLO-CEB, LAX-CUN, SAN-ORL): provider `status: 0`,
zero offers. The empty fixture pattern matches the question of
"unsupported route returns OK with empty body", but the lab never tried
SIN, and the lab evidence does not generalise to a guarantee. The
INTERESTING_FINDINGS doc also notes the
2022 official Postman example no longer produces offers (provider 102
past-flight) — official examples document request shape, not durable
cases. So the only safe statement is: SIN is **technically
requestable**, but its **offer yield is `UNKNOWN`** until probed.

### (d) Can organisers enable a requested test route?

Yes (the official channel):

> FAQ Q2: *"… if you'd like to test a specific airline or route, feel
> free to share your testing scenarios and desired airlines or routes
> with us. Our team will promptly respond to your request."*

The earlier kickoff/Postman guidance (FAQ Q43) is the same — go via
ATRIP / Atlas account manager. The hackathon is the only place that
has the test-route authority for the hackathon account.

### (e) Which SIN scenarios are most useful

The product is a recovery / disruption planner. SIN is a Southeast
Asian hub; the high-value demo scenarios are short-haul and
medium-haul recovery cases. Recommended priority for any SIN add-route
request:

1. **SIN-HKG** (regional Asia, codeshare-rich, common corporate
   destination).
2. **SIN-KUL** (very short regional, schedule-change realistic).
3. **SIN-MNL** and **SIN-CGK/JKT** (more LCC exposure, low-fare
   recovery story).
4. **SIN-BKK** (tourist / meeting traffic).
5. **SIN-TYO** (medium-haul, long-tail schedule-change risk).
6. **SIN-SYD** (long-haul, irregular-ops exposure).

If only one can be added, **SIN-HKG** is the best single choice for
recovery-planner demos (carrier variety, realistic fare-family
splits, baggage-rule variation).

### (f) Verdict on SIN

- Contract allows the request.
- Atlas team can enable a fixture on request.
- Fixture presence today: **none**.
- Behaviour without fixture: `UNKNOWN`.
- This sandbox cannot probe it (`ACCESS_BLOCKED`).

The report does **not** claim "SIN is unsupported". It claims: "SIN
is not in the published fixture set; the request contract permits the
query; the response is `UNKNOWN` without a live credentialed probe or
organiser-issued fixture."

---

## 5. Complexity vs. `FlightCapability`

The current `FlightCapability` interface
(`src/contracts/capabilities.ts:97-102`):

```ts
searchFlights(query: FlightSearchQuery): Promise<CapabilityResult<FlightSearchOutcome>>;
verifyOffer(query: FlightVerifyQuery): Promise<CapabilityResult<FlightVerifyOutcome>>;
getFareRules(query: FlightVerifyQuery): Promise<CapabilityResult<FareRulesOutcome>>;
```

Adapter (`src/providers/atlas/adapter.ts:57`) maps to:

- `search.do` (search)
- `verify.do` (verify, also the source of `rule{}` for getFareRules)
- The same `verify.do` body drives the `getFareRules` output.

### 5.1 Operations the contract does NOT expose today

| Operation | Atlas endpoint | Useful for product? | Difficulty to add |
| --- | --- | --- | --- |
| Get exact baggage quote | `getLuggage.do` | Conditional — only if a recovery scenario needs "I should add a checked bag". | Small. Add `getLuggage(query: {routingIdentifier, ...}): Promise<BaggageQuote>`; reuse the Verify session/offerId. |
| Get seat map / availability | `seatAvailability.do` | Conditional — same as above. | Small. Reuses `sessionId` from Verify. |
| GetOffer / GetOfferPrice (independent) | `getOffers.do`, `getOfferPrice.do` | Possibly useful when the planner needs to re-verify without re-running cached Search. | Small contract addition; would be a new `revalidateOffer` or a new `FlightCapability` interface. |
| Order creation | `order.do` | Not in MVP. | High — needs passenger data, contact, payment wiring, full booking requirements, multi-passenger pricing. |
| Pay | `pay.do` | Not in MVP. | High — VCC, MoR, deposit modes, error 633/616 trigger simulation. |
| Order query | `queryOrderDetails.do` | Not in MVP. | Small. Read-only. |
| Refund quotation / apply / query | `refundQuotation.do`, `refund.do`, `queryRefundOrders.do` | Not in MVP — needs a ticketed order first. | Medium. Adds a `flight.refund_quote` / `flight.refund_apply` operation. |
| Void | void page(s) | Not in MVP. | Medium. |
| Post-ticket baggage | post-ticketing endpoints | Not in MVP. | Medium. |
| Webhook registration | (registration endpoint) | Not in MVP. | Account-state-changing. |
| Incident list | (post-booking group) | Not in MVP. | Read-only, small. |
| Schedule change trigger | (event flow) | Not in MVP. | N/A — driver, not integration. |

### 5.2 Cost of leaving the contract as-is

The current three-method contract is **sufficient for the recovery
planner's read path** (search, revalidate, extract rules). It does
**not** support:

- "add a checked bag" — would need a new `flight.quote_baggage` op.
- "pick a seat" — would need a new `flight.quote_seat` op.
- "submit an order / change / refund" — would need a new family of
  state-changing operations, each gated by Atlas account
  permissions.

**Recommendation (§6).** Keep the contract as-is for the read path;
do not add state-changing methods now. If a scenario demands
post-quote ancillaries, add `flight.quote_baggage` and
`flight.quote_seat` (both `READ_ONLY`, both reuse `verify.sessionId`).
Skip order/pay/refund entirely in the MVP; simulate at the
provider boundary.

---

## 6. Recommended reality decisions

Per capability: `USE_LIVE` / `USE_SANDBOX` / `RECORD_AND_REPLAY` / `SIMULATE_PROVIDER_BOUNDARY` / `DEFER` / `REJECT`.

| Capability | Decision | Why |
| --- | --- | --- |
| `search.do` (cached search) | **USE_SANDBOX + RECORD_AND_REPLAY** | Adapter already uses it; lab proved reliable; cache-backed (FAQ Q51). |
| `verify.do` (price revalidation + booking requirements) | **USE_SANDBOX + RECORD_AND_REPLAY** | Required by the contract. |
| Fare rules inside Verify (`rule{}`) | **USE_SANDBOX + RECORD_AND_REPLAY** | Already mapped to `getFareRules`. |
| Exact baggage quote (`getLuggage.do`) | **DEFER**; **SIMULATE_PROVIDER_BOUNDARY** if a scenario needs it | Only one lab capture; carrier support varies. |
| Seat availability (`seatAvailability.do`) | **DEFER**; **SIMULATE_PROVIDER_BOUNDARY** if a scenario needs it | Same reasoning. |
| `getOffers.do` / `getOfferPrice.do` | **DEFER** | Useful for tight ticketing windows; not on the read path. |
| `order.do` / `pay.do` | **SIMULATE_PROVIDER_BOUNDARY** | No hackathon order; `TICKETING_ACTIVATION_REQUIRED`; state-changing + financial. |
| `queryOrderDetails.do` | **SIMULATE_PROVIDER_BOUNDARY** | Needs an order. |
| Refund flow (`refundQuotation.do`, `refund.do`, `queryRefundOrders.do`) | **SIMULATE_PROVIDER_BOUNDARY** | Needs a ticketed order. Label estimates as `SIMULATED`. |
| Void | **DEFER** | No orders. |
| Post-ticketing baggage | **DEFER** | No orders. |
| Webhooks / schedule-change / incident list | **REJECT** this milestone | Re-evaluate for the disturbance-sources milestone. |
| Email list | **REJECT** this milestone | Not on the demo path. |
| Real-time search | **DEFER** | Requires Atlas account-manager enablement; cached is default (FAQ Q29). |
| Smart Search | **REJECT** | Officially deprecated ("Use `search.do` for new integrations"). |
| Atlas Skill | **REJECT** for the MVP | Three Skill probes returned `SEARCH_NO_RESULTS` / `INTERNAL_ERROR`; direct API exposes more. |

**Singapore (specific):** Do not rely on a live `search.do` for SIN today. Either (i) re-stage the scenario around a documented fixture (Lion Air, Citilink, Cebu Pacific are the closest substitutes), (ii) RECORD a live SIN→HKG / SIN→KUL probe the moment credentials are available, or (iii) ask the organisers to enable one SIN fixture via FAQ Q2. Until then, treat SIN as `SIMULATE_PROVIDER_BOUNDARY` and label the response `SIMULATED`.

---

## 7. Findings triaged

### 7.1 Act Now

1. **Reach the organisers / Atlas account manager** via the FAQ Q2
   channel. Ask for one SIN fixture (SIN-HKG is the preferred single
   choice). This is the only path that makes SIN routable in the
   sandbox. The window is short — demo prep is the right time.
2. **Add `RECORD` capture of a happy-path search** for one of the
   documented fixtures during demo prep. This is the single most
   valuable deliverable: it gives the demo a real, sanitised Atlas
   payload even if the network is down or credentials are revoked
   mid-judging. The recording store
   (`src/providers/recordingStore.ts:43`) is already wired for
   deterministic IDs.
3. **Decide the contract surface explicitly.** Keep
   `search/verify/getFareRules` in `FlightCapability`. Document that
   order/pay/refund are out of scope for the MVP. Otherwise the
   implementation lane will be asked to invent contracts.

### 7.2 Investigate Now

1. **Why does the Skill `search` fail while direct `search.do`
   succeeds for the same documented routes?** (OPEN_QUESTIONS §1) —
   affects whether the Skill is usable at all in the demo. Without
   this, the Skill is REJECT for the MVP.
2. **What is the official sandbox count — 9 or 10?** FAQ Q1 says 10,
   FAQ Q2 says 9, the route page lists 9. Likely an outdated FAQ
   answer; the route page is the truth but worth confirming.
3. **`seatCount`, `riskSellout`, `refreshTime`, `expireTime`
   semantics** (OPEN_QUESTIONS §2). For the recovery planner the
   expiry/refresh window matters; the lab already established the
   field is present and consistent on a single short repeat.

### 7.3 Park for Later

- Open-jaw / multi-city / circle trip: FAQ Q37 says "not supported".
  Out of MVP scope.
- FR (Ryanair) integration: special-case.
- VCC / 3DS simulation triggers (`Reject`, `Three DS` cardholder
  names): nice for failure-injection demos if the team ever submits
  a real payment. Out of MVP scope.
- Email list / incident list: relevant to the disruption-sources
  milestone, not to flight capability.

### 7.4 Ignore / Accept Risk

- The sandbox produces **mock fare/availability data**. The lab has
  established this in writing; the product must label these as
  `SIMULATED` when consumed by the recovery planner. The Data
  Dictionary / EDA SSOT already documents this.
- 6 empty fixtures in the lab pass: not a defect, just fixture state.
  The empty success is a valid response shape.
- Singapore is `UNKNOWN` at the wire until either a probe or a fixture
  is added. We do not paper over the gap; the planner should treat
  Singapore scenarios as `SIMULATED` until then.

---

## 8. Probe plan appendix (credential-free, sanitized)

Run with `ATLAS_BASE_URL`, `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET`
exported. None are embedded. Reuse
`probe_atlas_readonly_flow.py` for the bulk read flow.

```bash
ATLAS_BASE_URL="${ATLAS_BASE_URL:-https://sandbox.atriptech.com}"
TOMORROW=$(date -u -d '+1 day' +%Y%m%d)
H=(-H 'Accept: */*' -H 'Content-Type: application/json' -H 'Accept-Encoding: gzip' \
    -H "x-atlas-client-id: ${ATLAS_CLIENT_ID}" -H "x-atlas-client-secret: ${ATLAS_CLIENT_SECRET}")

# 8.1 happy-path search (documented, non-empty fixture)
curl -sS -X POST "$ATLAS_BASE_URL/search.do" "${H[@]}" --data-binary @- <<JSON | gunzip | head -c 2000
{"tripType":"1","adultNum":1,"childNum":0,"infantNum":0,"fromCity":"JKT","toCity":"SUB","fromDate":"${TOMORROW}"}
JSON

# 8.2 verify (paste routingIdentifier from 8.1)
curl -sS -X POST "$ATLAS_BASE_URL/verify.do" "${H[@]}" \
  --data "{\"routingIdentifier\":\"<id>\",\"maxResponseTime\":15000}" | gunzip | head -c 2000

# 8.3 exact baggage quote (uses verify.sessionId)
curl -sS -X POST "$ATLAS_BASE_URL/getLuggage.do" "${H[@]}" \
  --data "{\"sessionId\":\"<sessionId>\"}" | gunzip | head -c 2000

# 8.4 seat availability (uses verify.sessionId + MSC carrier)
curl -sS -X POST "$ATLAS_BASE_URL/seatAvailability.do" "${H[@]}" \
  --data "{\"sessionId\":\"<sessionId>\",\"carrier\":\"<carrier>\"}" | gunzip | head -c 2000

# 8.5 SIN probe (the critical UNKNOWN)
# Possible outcomes:
#   status 0, routings:[] -> empty fixture -> label SIMULATED
#   status 0, routings:[..] -> SIN route IS populated
#   status 105 (round-trip whitelist) -> N/A: only round-trip gates O&D
#   status 106 (not allowed) -> account-level restriction
#   status 114 (no flights) -> not in fixture (escalate via FAQ Q2)
#   status 900 (unauthorized) -> credential issue
curl -sS -X POST "$ATLAS_BASE_URL/search.do" "${H[@]}" \
  --data "{\"tripType\":\"1\",\"adultNum\":1,\"childNum\":0,\"infantNum\":0,\"fromCity\":\"SIN\",\"toCity\":\"HKG\",\"fromDate\":\"${TOMORROW}\"}" \
  | gunzip | head -c 2000
# Repeat for SIN-KUL, SIN-MNL, SIN-BKK, SIN-CGK, SIN-TYO, SIN-SYD.

# 8.6 order / pay / refund — DO NOT run unless intentional.
#     order.do: state-changing. pay.do: financial.
#     refund.do / refundQuotation.do: needs a ticketed order (status 809 if not).
curl -sS -X POST "$ATLAS_BASE_URL/order.do" "${H[@]}" --data @order_body.json

# 8.7 webhooks / incidents — account-state-changing; do not register
#     until demo URL is stable.
```

---

## 9. Honest summary of what we know vs. what is unproven

| Question | Answer | Confidence |
| --- | --- | --- |
| `search.do` returns real shape for the 9 documented airlines? | Yes, lab captured 39 successful Search responses. | High. |
| `rule{}` in Search/Verify carries change/refund/no-show? | Yes (112 rows of each). Supplier-specific semantics not validated. | High. |
| `getLuggage.do` after Verify? | Yes for one fixture. | Medium. |
| `seatAvailability.do` after Verify? | Yes for one fixture. | Medium. |
| Contract accepts arbitrary one-way O&D? | Yes (no whitelist at the contract level for one-way). | High. |
| Atlas populates SIN routes? | Unknown. | Low. |
| `SIN→HKG` returns offers without a fixture? | Unknown; could be empty, 114, 106, or 0 with offers. | Low. |
| Atlas team adds fixtures on request? | Yes — FAQ Q2 invites it. | High. |
| Demo can `order.do` a booking? | Skill reports `TICKETING_ACTIVATION_REQUIRED`; lab did not test. Do not depend on it. | Low. |
| Demo can `pay.do` a booking? | Same. | Low. |
| Sandbox `LIVE` accessible in this worktree? | No — credentials absent. | High. |

---

## 10. Links to authoritative sources

- Sandbox Test Routes (current, 9 airlines, 36 routes, no SIN):
  <https://resources.atriptech.com/api-document/support-and-reference/integration-reference/sandbox-test-data/sandbox-test-routes>
- API Integration FAQ (Q1, Q2, Q12, Q13, Q18, Q19, Q28, Q29, Q37, Q45, Q51, Q66, Q67):
  <https://resources.atriptech.com/frequently-asked-questions/api-integration-faqs>
- Search product guide (QPS, 429, identifier guidance):
  <https://resources.atriptech.com/api-document/product-guides/booking/booking-step-guides/search>
- Search API reference (request schema, 105 error code):
  <https://resources.atriptech.com/api-document/api-reference/booking-apis/search>
- Verify API reference (bookingRequirement, priceChange, rule{}):
  <https://resources.atriptech.com/api-document/api-reference/booking-apis/verify>
- Seat API reference (no-flight-alone rule, 60 QPM):
  <https://resources.atriptech.com/api-document/api-reference/booking-apis/inflow-seat-and-baggage>
- Refunds API reference (refundQuotation / refund / queryRefundOrders):
  <https://resources.atriptech.com/api-document/api-reference/post-booking-apis/refunds>
- Fulfilment API (5-min window, strict ticketing):
  <https://resources.atriptech.com/api-document/product-guides/booking/booking-flows/fulfillment-flow>
- Sandbox Access (headers, gzip, base URL):
  <https://resources.atriptech.com/api-document/readme-1/making-requests>
- Sandbox Development (test mode, VCC failure simulation):
  <https://resources.atriptech.com/api-document/readme-1/sandbox-development>
- Atlas Final Capability Report (lab SSOT):
  `atlas-hackathon-lab/docs/ATLAS_FINAL_CAPABILITY_REPORT.md`
- Atlas Capability Matrix (lab SSOT):
  `atlas-hackathon-lab/docs/ATLAS_CAPABILITY_MATRIX.md`
- Sandbox Coverage Matrix (route table):
  `atlas-hackathon-lab/docs/SANDBOX_COVERAGE_MATRIX.md`
- Skill vs API (Skill exclusions):
  `atlas-hackathon-lab/docs/SKILL_VS_API.md`
- Open Questions (active investigation items):
  `atlas-hackathon-lab/docs/OPEN_QUESTIONS.md`
- Product repo architecture (external posture §14):
  `qoder-atlas/docs/ARCHITECTURE.md`
- FlightCapability contract:
  `qoder-atlas/src/contracts/capabilities.ts`
- Atlas adapter:
  `qoder-atlas/src/providers/atlas/adapter.ts`
- Recording store:
  `qoder-atlas/src/providers/recordingStore.ts`
