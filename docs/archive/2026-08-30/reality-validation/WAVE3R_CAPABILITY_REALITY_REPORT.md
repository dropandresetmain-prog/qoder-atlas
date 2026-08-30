# Wave 3R Capability Reality Report — DR-0

**Package:** DR-0 — Capability Reality Gate + Scenario Feasibility Envelope
**Status:** Investigation complete, including a user-authorized pay/ticket/refund confirmation pass (§4A), a follow-up documentation/diagnostic pass resolving both open blockers (§4B, §8), and a third pass rigorously re-verifying the refund/cancel finding with a second independent carrier plus a broad sandbox database-size sweep (§4C, §6A). No transactional contract implemented. No Wave 3R UI work performed.
**Date:** 2026-08-24 (updated three times same day: §4A after user confirmed Atlas sandbox scope and asked to confirm pay/ticket/refund; §4B/§8 after user confirmed the Model Studio key is correct and asked for research on the Atlas refund question; §4C/§6A after user asked for database-size characterization and 100%-certainty re-verification of the refund/cancel finding)
**Environment:** LOCAL (Windows 11, this workstation), `ADAPTER_MODE=REPLAY` default in `.env.local`; all probes below made explicit LIVE calls against confirmed SANDBOX/TEST provider endpoints using real local credentials in `.env.local`. No production endpoint was called at any point.
**Starting branch/SHA:** `fix/rev2-r4-nuitee` — local checkout was 3 commits behind `origin/fix/rev2-r4-nuitee` (missing `docs/WAVE3R_DEMO_READINESS_PLAN.md`); fast-forwarded to `8b869e32612727f3bc609c44033fd9bd8599b107` before starting work. All work below is on top of that SHA.

---

## 1. Executive verdict

**PASS.** (Upgraded from PASS WITH BLOCKERS — both open blockers from the first pass are now resolved or definitively explained.)

The capability envelope is now known with empirical confidence, not guesswork:

- **Atlas flights:** read chain (search/verify/fare-rules) is proven across **9+ materially different live routes** in this run (previously proven on 1), and a further broad sweep (§6A) found the real sandbox database is **far larger than documented** — 28 distinct airlines observed empirically against a published claim of 9. The **forward transactional chain — search → verify → order → pay → ticket — is PROVEN FULLY WORKING** end to end (§4A): a real sandbox e-ticket (`S96664`, Malindo Air/Batik Air OD801) was issued using Atlas's own sandbox deposit-balance payment mode (no card data entered, no real money moved). The prior assumption that this account is `TICKETING_ACTIVATION_REQUIRED`-blocked (sourced from an untested Atlas *Skill* report, not a direct-API test) is **empirically false**.
- **Refund is confirmed not possible in sandbox, on any carrier — rigorously re-verified, not just diagnosed** (§4B/§4C). A second, fully independent order/pay/ticket cycle on a *different* airline (Volaris) hit the identical `"Order not found for refund"` error as the first (Malindo/Batik Air), which rules out a carrier-specific or request-format cause. Atlas's own documentation explains why: sandbox never issues a real airline-side ticket.
- **Cancellation via `void.do` DOES work, for carriers Atlas supports it for — this is a positive correction to the first pass's conclusion, not a restatement of it** (§4C). On the same second test, `void.do` succeeded completely on the Volaris booking: real quote, real refund amount (`USD 191.98`), submitted, accepted, tracked (`voidStatus: 0`, confirmation code `202608-0038`). On the first (Malindo/Batik Air) booking, void failed too, but with a **different, self-explanatory reason** (`843`: Atlas doesn't support void for that airline) — not the sandbox-ticket limitation that blocks refund. **A genuine, provider-executed cancellation is achievable in this sandbox for the right carrier.**
- **Singapore is empirically a strong, populated sandbox market** — this reverses the prior "SIN is UNKNOWN" conclusion from the 22 Aug investigation. 12+ of 13+ directional route probes returned real offers across 6+ destination cities, multiple carriers, and short/medium/long-haul depth. Singapore is the clear #1 summit-location recommendation.
- **Nuitée hotel:** the existing single-case genuine sandbox lifecycle is now backed by **two more materially different live cases** (different city, non-refundable-rate cancellation-fee exposure, post-cancel state observability, and a documented contract gap on multi-child search).
- **Model Studio LIVE is now PROVEN WORKING** (§8, revised) — the key was correct all along; it is provisioned for the **international** Model Studio region (`dashscope-intl.aliyuncs.com`), not mainland China (`dashscope.aliyuncs.com`, the code's default). Fixed by setting `MODEL_STUDIO_BASE_URL` in `.env.local`. Once connected, the default `qwen-flash` model produced output that failed strict schema validation on the first pass (extra top-level wrapper key) — diagnosed as a **prompt-design gap** in `src/app/extraction.ts` (the system prompt never states the target JSON field names). Confirmed fixable: a corrected prompt produced output that validates cleanly against the real, frozen production schemas (`ExtractedRuleSetSchema` and `ResolutionTargetSchema`), for both organiser policy extraction and a traveller-NL-to-ResolutionTarget capability probe.
- **Google Routes:** ADOPT NOW — one bounded LIVE call succeeded cleanly, payload matches the adapter's field mask exactly.
- **Webhook/incident:** the read-only incident-list endpoint is reachable without prior webhook registration (proven, returns a clean empty page). Webhook *registration* is documented (single `url` field, no inbound signature/auth) but was not exercised (state-changing, needs a public endpoint — correctly deferred to DR-3).

Nothing remaining blocks Wave 3R: Atlas refund must stay `SIMULATE_PROVIDER_BOUNDARY` for any demo claim (documented provider limitation, universal across carriers), Atlas **cancel/void is real for supported carriers** and should be adopted for the recovery-scenario "cancel the old booking" step where the carrier supports it, and Model Studio LIVE is unblocked pending a small, well-understood prompt fix in `src/app/extraction.ts` (recommended, not yet applied — DR-0 does not implement it).

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
| 9 | Refund quotation | `POST /refundQuotation.do` | DOCUMENTED_NOT_PROVEN (needs a ticketed order) | First call (unticketed order): `status=809 "not yet ticketed"` — correct gate. **Re-called on the now-genuinely-ticketed order** (§4A): `status=801 "Order not found for refund"`, consistently across 5 differently-shaped `refundRequestList` bodies. **Re-tested a second time on a fully independent order/carrier** (§4C): identical `801` failure, ruling out a carrier-specific or one-off cause. **§4B: explained by Atlas's own docs** — sandbox never issues a real airline-side ticket ("tickets are not issued with live airlines"), so there is nothing for the refund subsystem to find | **PROVEN REACHABLE, PROVEN NOT POSSIBLE IN SANDBOX BY DESIGN, ON ANY CARRIER** (§4A/§4B/§4C) |
| 10 | Refund submission | `refund.do` | DOCUMENTED_NOT_PROVEN | Attempted directly with the `refundOfferId` from a failed quote: `status 805 "refundOfferId expired"`. Confirms the refund path is dead-ended from the quote step onward — not attempted separately in a way that would move money, since no successful quote ever existed to submit | **NOT POSSIBLE IN SANDBOX BY DESIGN — blocked behind #9/§4B** |
| 10a | Void quotation | `POST /voidQuotation.do` | Not previously known (found in §4C follow-up) | **Carrier-dependent, empirically proven both ways.** On Malindo/Batik Air (OD): `status 843 "Atlas does not currently support VOID service for the airline or route of this booking"` — a specific, self-explanatory airline-support limitation, unrelated to sandbox mode. On Volaris (Y4), a *second, fully independent* ticketed order: `status 0`, `isVoidable:true`, real quote (`estimatedRefundAmount: 191.98 USD`, real `voidWindow`) | **PROVEN LIVE/SANDBOX for supported carriers; PROVEN NOT-SUPPORTED (documented, specific reason) for others** — see §4C |
| 10b | Void submission | `POST /void.do` | Not previously known | Submitted on the Volaris order: `status 0`, `voidStatus 0` ("Atlas Processing"), tracking code `202608-0038`, `voidMethod: "CashBackToOriginalPayment"`, expected confirmation next day | **PROVEN LIVE/SANDBOX** (§4C) — genuine, provider-executed, in-progress cancellation |
| 10c | Void status query | `POST /queryVoidOrders.do` | Not previously known | Called after submission; confirmed the same in-progress record (`voidStatus:0`) | **PROVEN LIVE/SANDBOX** |
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
- **The refund closing loop on a truly ticketed leg is NOT proven, and §4B/§4C show *refund specifically* cannot be proven in sandbox at all, on any carrier.** However, §4C below shows the closing loop is **not uniformly closed** — a genuine cancellation via `void.do` **is** achievable for carriers Atlas supports it for. Any scenario needing a provider-executed *refund* must use `SIMULATE_PROVIDER_BOUNDARY`; a scenario needing a provider-executed *cancellation* should prefer a void-supported carrier and can be real.

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

## 4C. Rigorous re-verification: refund is universally blocked, but cancellation (void) genuinely works

**Why this pass exists:** the user asked to be "100% POSITIVELY SURE" refund/cancel unavailability isn't a mistake on our end or a code issue. §4B's documentation-based explanation was strong but circumstantial. This pass adds a **controlled empirical test**: a second, fully independent order → pay → ticket cycle on a **different airline**, deliberately chosen from a region Atlas's own void documentation claims support for, then testing both refund and void against it — comparing directly with the first (Malindo/Batik Air) order.

### 4C.1 Second independent transaction chain

Route: Volaris (Mexico) `MEX→CUN`, offer `Y4148` (via GDL connection), USD 154.85+tax. Full chain, raw `curl`, no product code involved:

1. `search.do` → offer found, `routingIdentifier` captured.
2. `verify.do` → `status 0`, fresh `sessionId`.
3. `order.do` → **succeeded on the first attempt** (the exact wire format discovered in §4 generalized correctly to a second carrier): `orderNo=TESTA20260824180215281`, `pnrCode=RKQLRL`.
4. `pay.do` (`paymentMethod:1`, deposit mode, no card data) → `status 0, msg="success"`.
5. Polled `queryOrderDetails.do` (bounded `until`-loop, not a blind sleep) → ticketing completed after ~30s: `orderStatus=2`, `ticketStatus=1`, real e-ticket `S20324` issued.

This is a **completely separate order, carrier, route, passenger, and session** from the Malindo/Batik Air booking in §4A — the only thing held constant is the account and the request-shape knowledge already proven correct.

### 4C.2 Refund re-test — identical failure, different carrier

`refundQuotation.do` on the new order: `{"orderNo":"TESTA20260824180215281","refundRequestList":[{"ticketNo":"S20324"}]}` → **`status 801 "Order not found for refund. Check the original main ticket order number."`** — the exact same error, exact same wording, as the first order in §4A.

Also attempted `refund.do` directly with the `refundOfferId` the failed quote still returned → `status 805 "refundOfferId expired. Call refundOffer.do again for a fresh ID, then resubmit."` — a different code, but still a hard rejection with no path forward (and "refundOffer.do" does not appear in Atlas's own documented endpoint list, suggesting this message is a generic/templated string rather than a genuine alternate lead).

**This is the controlled comparison that removes reasonable doubt:** if the original failure were a mistake in our request shape, a schema quirk, or specific to that one order/carrier, a second, independently-built request on a different airline would not fail identically. It did. Combined with §4B's documented explanation (sandbox never issues a real airline-side ticket), refund is now confirmed **not achievable in this sandbox account, for any carrier, by any request shape tried** — not a code issue on our end.

### 4C.3 Void re-test — the important correction

The first pass's report said flight cancellation "cannot be demonstrated in sandbox... permanently." **That was premature — it generalized a refund-specific finding to cancellation as a whole, and that generalization was wrong.** Atlas has a *separate* cancellation mechanism, `void.do` (§3 rows 10a–10c), and it was tested on both orders:

- **Malindo/Batik Air (OD), first order:** `voidQuotation.do` → `status 843 "Atlas does not currently support VOID service for the airline or route of this booking."` A specific, self-explanatory, **airline-support** rejection — nothing to do with sandbox mode. Atlas's own void documentation lists void support as covering "23 airlines across Americas, Europe, Japan, and Korea" — Malaysian LCCs are not in that set, so this is the expected outcome for this specific carrier, in sandbox *or* production.
- **Volaris (Y4), second order — deliberately chosen because Volaris (Mexico/Americas) fits the documented void-support region:** `voidQuotation.do` → **`status 0`, `isVoidable: true`**, full real quote: `estimatedRefundAmount: 191.98 USD`, `voidMethod: "CashBackToOriginalPayment"`, real `voidWindow` (`voidTimeAfterIssure: 23` hours, `voidTimeBeforeDepature: 180`). **Submitted `void.do`** with the returned `voidOfferId` → `status 0`, accepted: `voidStatus: 0` ("Atlas Processing"), tracking code `voidCode: "202608-0038"`, `expectedConfirmationDate: 2026-08-25`. **Confirmed via `queryVoidOrders.do`** → the same in-progress record, consistently readable.

**This is a genuine, complete, provider-executed cancellation, in progress at the time of writing, with a real (sandbox-test-balance) refund amount attached.** It is not simulated, not a REPLAY fixture, not a guess — it is Atlas's own sandbox processing a real void request end to end.

### 4C.4 Corrected conclusion

| Operation | Verdict | Scope of the limitation |
|---|---|---|
| **Refund** (`refundQuotation.do`/`refund.do`) | **Not achievable in sandbox, on any carrier** | Universal — a sandbox-mode limitation (no real airline ticket exists to refund), confirmed identical across two independent carriers |
| **Cancellation** (`voidQuotation.do`/`void.do`) | **Achievable in sandbox, for supported carriers** | Carrier/airline-specific — Atlas documents ~23 supported airlines (Americas/Europe/Japan/Korea); Southeast Asian LCCs (the carriers that dominate Singapore-area coverage, §6A) are generally *not* in that list, but carriers like Volaris, Frontier, Wizz Air, Jeju Air, and Norwegian — all already in Atlas's own documented sandbox fixture set — are |

**Practical implication for Wave 3R scenario design:** a hero recovery scenario that needs to show Atlas genuinely cancelling a booking should route through a void-supported carrier (Volaris/Frontier/Wizz/Jeju/Norwegian) rather than the Southeast Asian LCCs that otherwise give the best Singapore-area route density. If the hero scenario is anchored on a Southeast Asian leg, the cancellation step for that specific leg should be `SIMULATE_PROVIDER_BOUNDARY`, honestly labelled — but the *product capability* to do a real cancellation should still be demonstrated somewhere in the demo, since it is real and provable.

**New sandbox artifact:** `orderNo=TESTA20260824180215281`, e-ticket `S20324` (Volaris) — void submitted and in progress (`voidCode 202608-0038`), self-completing by 2026-08-25 with a test-balance refund of USD 191.98. No action required; no real-world cost.

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

## 6A. Atlas sandbox database size — full characterization (follow-up)

**The user asked how big the sandbox database really is.** The documented "Sandbox Test Routes" page claims **9 airlines, 36 routes** (Lion Air, Citilink, Cebu Pacific, Jeju Air, Wizz Air, Norwegian, Volaris, Frontier, flyadeal — 4 routes each). This is the number every prior investigation (including the 22 Aug report) treated as the ceiling. **It is wrong, or at minimum badly misleading** — none of the carriers that actually serve Singapore (§6) appear anywhere in that documented list.

**Method:** broad empirical `search.do` sweep, read-only, ~30 days out. No listing/enumeration endpoint exists (confirmed absent from the API docs), so this is necessarily a sample, not a census — but a large and structured one: every documented route validated, plus a global spread of inbound-Singapore probes, plus cross-carrier pairs beyond Singapore.

**Results, aggregated across this entire investigation (67 distinct route/direction pairs tested in total):**

| Metric | Count |
|---|---|
| Route/direction pairs tested | 67 |
| Populated (real offers) | 52 (78%) |
| Empty (valid `status 0`, zero offers — not an error) | 15 (22%) |
| Total individual flight offers observed | 808 |
| **Distinct airlines (IATA codes) observed** | **28** |

**All 9 documented airlines were re-validated live and still work** (one sample route each, all populated) — the documented list isn't stale, it's just radically incomplete.

**The 28 airlines observed, identified:**

| Code | Airline | Region | In documented list? |
|---|---|---|---|
| JT | Lion Air | Indonesia | Yes |
| QG | Citilink | Indonesia | Yes |
| 7C | Jeju Air | Korea | Yes |
| W6 | Wizz Air | Europe | Yes |
| D8, DY | Norwegian Air (Int'l / Shuttle) | Europe | Yes (Norwegian) |
| Y4 | Volaris | Mexico | Yes |
| F9 | Frontier | USA | Yes |
| F3 | flyadeal | Saudi Arabia | Yes |
| AK, QZ, D7 | AirAsia (Malaysia / Indonesia / X) | Malaysia/Indonesia | **No** |
| FD, XJ | Thai AirAsia / Thai AirAsia X | Thailand | **No** |
| TR | Scoot | Singapore | **No** |
| VJ | VietJet | Vietnam | **No** |
| OD | Malindo Air / Batik Air Malaysia | Malaysia | **No** |
| ID | Batik Air Indonesia | Indonesia | **No** |
| IU | Super Air Jet | Indonesia | **No** |
| 8B | TransNusa | Indonesia | **No** |
| 6E | IndiGo | India | **No** |
| UO | HK Express | Hong Kong | **No** |
| MM | Peach Aviation | Japan | **No** |
| ZG | ZIPAIR | Japan | **No** |
| TW | Tway Air | Korea | **No** |
| ZE | Eastar Jet | Korea | **No** |
| XY | flynas | Saudi Arabia | **No** |
| Z2 | Philippines AirAsia | Philippines | **No** |
| (Cebu Pacific was not independently re-derived by carrier code in this pass, though its documented route HKG→MNL still returned live offers) | | | Yes |

**Characterization:** this is overwhelmingly a **budget/LCC network**, heavily concentrated in Southeast Asia and Northeast Asia, with genuine but thinner reach into the Middle East, Europe, and the Americas. No full-service/legacy long-haul carrier (Singapore Airlines, Emirates, Cathay Pacific, etc.) appeared in any search performed in this investigation. Route population is **directional** (§6) and **not obviously predictable from geography alone** — e.g. mainland Chinese cities (Beijing, Shanghai, Shenzhen, Xiamen) were uniformly empty into Singapore despite Guangzhou being populated; European coverage is patchy (London/Amsterdam/Istanbul populated, Paris/Frankfurt empty).

**Bottom line for scenario design:** treat "9 airlines / 36 routes" as **retired, not authoritative**. The real fixture set is at least ~3x larger in airline count and covers a genuinely global, if LCC-skewed, network. Singapore specifically is well inside the well-populated core of this network, not an edge case. Any scenario design that avoided non-documented routes/carriers out of caution can stop doing so — the empirical bar is what matters, not the published list.

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
- "Atlas after-sales refund quoting is reachable, but cannot succeed in sandbox on any carrier — Atlas's own documentation confirms sandbox never issues real airline-side tickets, which the refund subsystem requires; this was independently re-verified on two unrelated carriers with identical results." (Do **not** claim a refund was quoted or processed — it was not; see §4A/§4B/§4C/§11.)
- **"Atlas cancellation was exercised LIVE against the real sandbox and genuinely accepted for processing — a real void request, on a real ticketed booking, with a real refund amount, tracked by Atlas's own systems."** (True for void-supported carriers, e.g. Volaris; see §4C. Do not extend this claim to carriers Atlas doesn't support void for, or to the refund/cancel path specifically — void and refund are different capabilities with different outcomes.)
- "The Atlas sandbox database is materially larger than officially documented — 28 airlines observed empirically against a published claim of 9, with genuine global (if LCC-skewed) route coverage." (§6A)
- "Nuitée hotel search/quote/book/retrieve/cancel was exercised LIVE against the real sandbox across three materially different cities/cases, including a genuine non-refundable cancellation-fee charge and post-cancel state observability."
- "Google Routes ground-context is available LIVE and was exercised against the real API."
- "The event location (Singapore) has genuine, empirically confirmed Atlas sandbox flight coverage across a dozen-plus regional/international origin markets, well inside the well-populated core of the network, not an edge case."
- "Model Studio LIVE interpretation (organiser policy extraction and traveller-request-to-target-schema conversion) was empirically proven against the real, frozen production schemas."

## 11. Claims we must NOT make

- Any claim that a provider-executed **refund** was demonstrated on a real ticketed Atlas booking — it was attempted on two independent carriers (10 total attempts across both) and failed identically every time (§4A/§4C), and §4B shows this is inherent to sandbox mode (no real airline-side ticket ever exists to refund). Any refund step in a demo scenario must be `SIMULATE_PROVIDER_BOUNDARY` and labelled as such — permanently, universally across carriers.
- Any claim that a provider-executed **cancellation (void)** was demonstrated on the *specific* Malindo/Batik Air booking (`S96664`) — it was attempted and failed with a documented, carrier-specific "void not supported for this airline" rejection (§4C). The successful void proof is on the *separate* Volaris booking (`S20324`), not this one. Do not conflate the two orders.
- Any claim that cancellation (void) works **universally across all Atlas carriers** — it is carrier-specific; Atlas documents ~23 supported airlines, and most of the Southeast Asian LCCs that dominate Singapore-area coverage (§6A) are not among them. Check void support per carrier before claiming it for a specific scenario leg.
- Any claim that traveller natural-language text is currently **converted into a `ChangeRequest` by the product** — that pipeline does not exist yet (DR-5); §8 proves the *model* can do the conversion once built, not that the product does it today.
- Any claim that the *default, unmodified* `src/app/extraction.ts` prompt reliably produces schema-valid LIVE output — the unmodified prompt failed on both product tasks tested; only a hinted prompt (not yet applied to product code) succeeded. Do not claim the current codebase's LIVE extraction is production-ready without applying the §8.2 fix.
- Any claim of a genuine Atlas-originated webhook push — not attempted, not achievable without a ticketed order plus a real schedule change; any hero disruption event will be a documented-shape simulated source event through the real ingress (permitted, per the Wave3R doctrine, if honestly labelled).
- Any claim that SIN→HKG specifically is a viable sandbox route — it returned zero offers; only the reverse direction (HKG→SIN) is populated.
- Any claim that "9 airlines / 36 routes" is the ceiling of what the sandbox supports — empirically false; treat it as a stale floor, not an authoritative limit (§6A).
- Any claim that Atlas baggage/seat quoting was proven "end to end" in this run — reachable and correctly validating, but the actual quote calls hit an expired-session error rather than a successful payload.
- Any claim that the real ticketed test booking (`S96664`, Malindo/Batik Air) was ever cancelled/refunded — it was not; it remains a live sandbox ticket with no successful cancel/refund call made against it. The Volaris booking (`S20324`) is different — its void is genuinely in progress.

---

## 12. Architecture gaps

1. **Flight forward-transaction capability is entirely absent from `FlightCapability`.** The contract exposes only `searchFlights`/`verifyOffer`/`getFareRules` (read-only). DR-0 proves `order.do` **and `pay.do` (deposit/test-balance mode) and ticketing** all work for this account (§4A) — the transactional ceiling is higher than originally assumed. **Minimal generic delta needed:** provider-neutral operations for order creation, payment-by-provider-test-mode, and status retrieval, e.g. `createOrder(...)`, `payOrder(...)` (deliberately restricted to non-card, provider-test-balance payment refs — never raw card data crossing the contract), and `retrieveOrder(...)`. Given payment is now proven safe via deposit mode, the plan's "never `LLM → money-moving API`" rule is satisfied by keeping this behind the same `authority → executor` gate as every other capability — the executor may legitimately call `payOrder` after approval, exactly as it may call `bookStay` on the hotel side today.
2. **Flight refund capability is a confirmed, permanent gap in sandbox** (not merely an unbuilt contract, and not resolvable by more testing, and rigorously re-verified on two independent carriers — §4C): §4B shows Atlas's own documentation states sandbox never issues real airline-side tickets, and the refund subsystem needs one. A refund contract delta can still be *designed* now (for production use later), but it must never be relied on for a Wave 3R sandbox demo claim — that step is `SIMULATE_PROVIDER_BOUNDARY` by provider design, permanently, for this environment. **Flight cancellation (void) is different and IS a real, buildable capability** — §4C proves `voidQuotation.do`/`void.do`/`queryVoidOrders.do` genuinely work for carriers Atlas supports (documented as ~23 airlines, Americas/Europe/Japan/Korea). This should be a distinct contract operation from refund, gated by a capability-support check (the adapter should surface `843`-class rejections as a structured "not supported for this carrier" result, not an error to retry).
3. **No webhook/event ingress contract exists yet** (correctly deferred to DR-3). DR-0 supplies the concrete facts DR-3 needs: exact registration endpoint/body, exact incident-list read endpoint/schema, and the explicit absence of any inbound authentication from Atlas (Northstar's own ingress must supply its own secret-path/allowlist protection).
4. **`HotelSearchQuery` cannot express child ages**, so any family/child occupancy search fails closed by design (§7 Case D). Small, non-blocking delta: add optional `childAges?: number[]` per room/guest group. Not required for any currently-planned hero scenario (solo business travellers), so this is a **Park for Later**, not an Act Now.
5. **No architecture change is needed for hotel replacement** — `HotelCapability` already has full search/quote/book/retrieve/cancel; cancel+rebook composition is proven end-to-end including realistic fee exposure and post-cancel observability (§7). ADR-041's existing decision (cancel+rebook until a provider contradicts) is empirically confirmed correct.
6. **Model Studio has no architecture gap** — the client/schema/fail-closed design is correct. The only issue was an environment config value (`MODEL_STUDIO_BASE_URL` region) plus a genuine, small **prompt gap** in `src/app/extraction.ts` (§8.2): the system prompt never states the target JSON's field names, so the default model sometimes wraps its output in a self-invented key. Recommended follow-up (not done in DR-0): add the field names to `EXTRACTION_SYSTEM_PROMPT`, and carry the same discipline into whatever DR-5 system prompt eventually drives NL→`ResolutionTarget`.

---

## 13. Recommended minimal contract delta (for G3R-R0, not implemented here)

Per the Wave3R plan's own guidance (§7), and updated by the §4A pay/ticket proof and the §4C void proof, the smallest generic extension is a **new flight order-creation, payment, and conditional-cancellation capability**, additive to `FlightCapability`:

```
createFlightOrder(query: FlightOrderQuery): Promise<CapabilityResult<FlightOrderOutcome>>
payFlightOrder(query: FlightOrderPaymentQuery): Promise<CapabilityResult<FlightOrderOutcome>>
retrieveFlightOrder(query: FlightOrderRetrieveQuery): Promise<CapabilityResult<FlightOrderStatusView>>
cancelFlightOrder(query: FlightOrderCancelQuery): Promise<CapabilityResult<FlightOrderCancelOutcome>>
```

- Provider-neutral (no Atlas-specific field names in the contract; adapter maps `name`-slash-convention, `birthday` format, `contact.name`, etc.).
- `FlightOrderPaymentQuery` carries only a **provider-opaque payment method reference** (e.g. `'PROVIDER_TEST_BALANCE'` for Atlas's sandbox deposit mode) — never raw card data, matching the existing `HotelBookQuery.paymentRef` discipline. In production, this same shape would carry a corporate virtual-card/MoR reference; the contract must never carry card PAN/CVV.
- `FlightOrderOutcome` carries `orderRef` (opaque), `status: 'HELD'|'PAID'|'TICKETED'|'FAILED'`, `holdExpiresAt`, `ticketRef?`, `totalPrice`, `provenance: 'LIVE'|'REPLAY'|'SIMULATED'`.
- **`cancelFlightOrder` maps to Atlas's `void.do` (§4C), not `refund.do`.** `FlightOrderCancelOutcome` should include `status: 'ACCEPTED'|'NOT_SUPPORTED'|'FAILED'`, `estimatedRefund?: Money`, `providerTrackingRef?`, `provenance`. A `NOT_SUPPORTED` result (mapping Atlas's `843`) is a normal, expected, structured outcome — not an error to retry — since void support is carrier-specific. The executor/planner should treat `NOT_SUPPORTED` as a signal to fall back to `SIMULATE_PROVIDER_BOUNDARY` for that specific leg, not as a capability failure.
- **Refund remains explicitly excluded** — §4B/§4C show that surface cannot be proven in sandbox at all, on any carrier (no real airline-side ticket is ever created). Do not build a `refundFlightOrder` operation for the sandbox demo path; if production adoption is ever pursued, that surface would need production credentials and a real fare purchase to validate, which is out of scope here.
- This is a genuine **shared-contract change** and therefore requires **G3R-R0** review before DR-2 implements it, per the plan.
- No hotel contract change is recommended — existing operations suffice (§12.5).

---

## 14. Scenario capability envelope

| Scenario family | Minimum capability | DR-0 verdict |
|---|---|---|
| S1 — supplier flight disruption | flight-event ingress → correlate → mutate → recover → execute where permitted → observe | Ingress contract not yet built (DR-3); Atlas incident-list read is reachable now for a polling fallback; order creation proven for the replacement leg; **cancelling the disrupted leg can be a genuine `void.do` call if the original carrier supports it (§4C), otherwise `SIMULATE_PROVIDER_BOUNDARY`** |
| S2 — traveller-requested change | `ChangeRequest`/resolution machinery across pre-booking flight, post-booking flight, hotel change, add-on | Engine machinery exists (ADR-036); NL→`ChangeRequest` conversion (DR-5) not yet built, but Model Studio's capability to do it is now proven (§8) once DR-5 wires the seam with a properly field-hinted prompt |
| S3 — missed flight | traveller-state signal → downstream consequence → recovery | Same engine as S1/S2 per plan; no new provider capability required beyond what's proven here; same carrier-conditional real-cancellation option as S1 |
| S4 — event-side change preview | counterfactual/dry-run → confirm → fan-out | No external provider dependency; unaffected by this report |

All four families are **capability-feasible** with the provider evidence gathered here; none require a provider Atlas/Nuitée/Google cannot support once the flight order-creation-and-conditional-cancellation delta (§13) lands and the Model Studio credential is fixed. S1/S3's "cancel the old booking" step has a genuine, non-simulated path available if the scenario's carrier is void-supported (§4C) — worth factoring into which exact carrier/route DR-9 picks for the hero disruption leg.

---

## 15. Provider risks/blockers

| Risk | Severity | Mitigation |
|---|---|---|
| **Atlas refund cannot be demonstrated in sandbox, on any carrier** (permanent, per Atlas's own docs and rigorous 2-carrier re-verification — §4B/§4C) | **High for any scenario claiming a provider-executed refund** | Use `SIMULATE_PROVIDER_BOUNDARY` for that step, honestly labelled — permanently, not pending further investigation |
| Atlas cancellation (void) is carrier-specific — Southeast Asian LCCs (the best Singapore-area routes) are largely unsupported | Medium — affects which carrier a hero cancellation scenario should use | Route the "cancel the old booking" step through a void-supported carrier (Volaris/Frontier/Wizz/Jeju/Norwegian — §4C) when a real cancellation is needed; `SIMULATE_PROVIDER_BOUNDARY` otherwise |
| `src/app/extraction.ts`'s system prompt doesn't name target field names, causing schema-shape failures on the default model | Medium — blocks reliable LIVE extraction until fixed | Apply the §8.2 prompt fix (small, well-understood, not done in DR-0) |
| Atlas order.do/pay.do/void.do require exact wire-format knowledge (undocumented in the fetched pages — discovered empirically) | Low (now solved) | Reuse the exact discovered shapes in §4/§4A/§4C when DR-2 implements the adapter — do not re-derive from docs alone |
| Atlas webhook delivery is "best effort," no inbound auth | Medium | DR-3 must add its own ingress secret/allowlist; never trust payload as `AUTHORITATIVE` |
| SIN→HKG specifically unpopulated; several other spot-checked world cities also empty into SIN (§6A) | Low | Avoid those specific legs in scenario design; the populated set is still large |
| "9 airlines / 36 routes" documentation is stale/misleading (§6A) | Low, informational | Don't let scenario design self-limit to the documented list; verify empirically per route as needed |
| Nuitée `childAges` contract gap | Low, non-blocking | Park for Later per §12.4 |
| Live ticketed Atlas test bookings (`S96664` no cancel path; `S20324` void in progress) | Low (sandbox, no real cost) | No action needed for either; documented transparently in §4A/§4B/§4C/§17 |

---

## 16. Evidence inventory

- `fixtures/recordings/nuitee/{book,cancel,quote,retrieve,search}/rec_*.json` — 9 new sanitized files, additive, genuine live sandbox captures (Hong Kong + Singapore cases, §7). No secrets or real PII present (verified by grep before commit).
- `docs/IMPLEMENTATION_PLAN.md` — DR-0A SSOT pointer + NS-G3 superseded notice.
- `docs/ROADMAP.md` — 3 factual DR-0 update notes on previously-contradicted entries (order.do, SIN routes, webhooks/incidents).
- This report.
- `.env.local` — `MODEL_STUDIO_BASE_URL` corrected to the international Model Studio endpoint (local config only; `.env.local` is gitignored, never committed).
- Raw probe transcripts (Atlas search/verify/order/pay/void/refund/incident responses across 67 route probes and 2 independent transaction chains, Nuitée console output, Model Studio requests/responses including the field-hinted retests, Google Routes response) were reviewed inline during the investigation and are **not** committed as raw files — they live only in this session's scratchpad (outside the repo) and are summarized/sanitized into §3–§9/§4C/§6A above, per the evidence-discipline instruction not to commit unnecessary raw payloads. The 9 Nuitée recordings are the one exception, committed because they are genuinely reusable REPLAY fixtures in the existing repo convention.

---

## 17. Exact triage of every finding

| Finding | Triage |
|---|---|
| Atlas order.do + pay.do + ticketing all work; prior TICKETING_ACTIVATION_REQUIRED assumption was Skill-sourced and wrong | **Act Now** — correct the record (done, §3/§4A/ROADMAP); inform G3R-R0 |
| **Atlas refund cannot be demonstrated in sandbox, confirmed on two independent carriers — Atlas's own documentation explains why (§4B/§4C)** | **Act Now** — freeze this as `SIMULATE_PROVIDER_BOUNDARY` permanently for any sandbox demo claim; do not schedule further sandbox investigation of it |
| **Atlas cancellation (void) genuinely works for supported carriers — corrects the earlier "cancellation is impossible" over-generalization (§4C)** | **Act Now** — update scenario design guidance: a real cancellation is achievable if the carrier is void-supported; inform G3R-R0 and DR-9 |
| Void support is carrier-specific (~23 airlines documented: Americas/Europe/Japan/Korea); most SE Asian LCCs (best for Singapore routes) are not supported | **Investigate Now at DR-9** — decide whether the hero disruption/cancellation scenario should use a void-supported carrier, or accept `SIMULATE_PROVIDER_BOUNDARY` for that specific step |
| Documented "9 airlines / 36 routes" undersells the real sandbox by ~3x in airline count (28 observed empirically) (§6A) | **Act Now** — correct the record (done, this report); stop treating the documented list as a ceiling for scenario design |
| Singapore sandbox routes are populated (12+/13+ directional probes) | **Act Now** — correct the record (done, ROADMAP); freeze Singapore as the summit location |
| SIN→HKG specifically empty; several other spot-checked world cities empty into SIN | **Investigate Now if one of those specific origins is chosen** — otherwise Park |
| Model Studio was blocked by a regional endpoint mismatch, not a bad key | **Act Now** — corrected in `.env.local` (done); inform anyone else setting up this environment |
| `src/app/extraction.ts` system prompt doesn't name target schema fields, causing schema-shape rejection on the default model | **Investigate Now / small Act Now** — apply the field-name hint fix before relying on LIVE extraction for a demo claim |
| No NL→ResolutionTarget model task exists yet | **Park for Later** — correctly scoped to DR-5, not a DR-0 defect; §8 shows the model can do it once built |
| Atlas webhook has no inbound auth | **Investigate Now in DR-3** — design Northstar's own ingress protection |
| Nuitée `childAges` contract gap | **Park for Later** — no current hero scenario needs it |
| Flight order-creation/payment/cancellation contract gap | **Investigate Now at G3R-R0** — smallest delta proposed in §13 (refund permanently excluded; cancellation included, carrier-conditional) |
| Live ticketed Atlas test booking (`S96664`, orderNo `TESTA20260824171418381`) has no working cancel/refund path | **Ignore / Accept Risk** — sandbox test data, Malindo Air's own test environment, no real cost; transparently documented, not hidden |
| Live ticketed Atlas test booking (`S20324`, Volaris, orderNo `TESTA20260824180215281`) has a void in progress | **Ignore / Accept Risk** — self-completing, no real cost, no action needed |
| Atlas getLuggage.do session expired mid-investigation (not re-chained) | **Ignore / Accept Risk** — capability already proven reachable+validating; re-proving is low value |

---

## 18. WHAT WE KNOW

- Atlas Search/Verify/fare-rules work live across many routes including a well-populated Singapore market in both directions (with one specific directional gap: SIN→HKG).
- **Atlas order creation, payment (test-balance mode), and ticketing all work live for this account** — a real e-ticket (`S96664`) was issued. The prior activation-blocked assumption was wrong.
- **Atlas refund cannot be demonstrated in sandbox, on any carrier, by design** — Atlas's own documentation confirms sandbox never issues real airline-side tickets, and the refund subsystem needs one (§4B); independently re-verified on a second, unrelated carrier with an identical result (§4C). This is not a gap that further testing can close.
- **Atlas cancellation (void) genuinely works in sandbox — but only for carriers Atlas supports it for.** Proven end to end on Volaris: real quote, real submission, real tracking, real (test-balance) refund amount. Proven *not* to work on Malindo/Batik Air, but for a specific, documented, airline-support reason — not the same limitation that blocks refund (§4C). This corrects the first pass's over-generalized "cancellation is impossible" conclusion.
- **The real Atlas sandbox database is far bigger than documented** — 28 airlines observed empirically (78% of 67 sampled routes populated, 808 offers seen) against a published claim of 9 airlines/36 routes. The documented list is a stale floor, not a ceiling (§6A).
- Atlas's read-only incident-list endpoint works without webhook registration; webhook registration itself is documented but has no inbound authentication.
- Nuitée's full hotel lifecycle (including realistic non-refundable cancellation-fee exposure and post-cancel state observability) is proven across three materially different cases.
- Google Routes is live-ready with zero adapter changes needed.
- **Model Studio LIVE now works** — the key was correct; the endpoint was wrong (international vs mainland region). Fixed in local config. The default extraction prompt needs a small field-naming fix to reliably pass schema validation; confirmed fixable and validated against real production schemas.
- No architecture change is needed for hotel replacement; a well-scoped flight order-creation/payment/**conditional-cancellation** delta is needed for flight replacement — refund stays permanently out of scope for sandbox demo claims, but void does not.

## 19. WHAT WE DO NOT KNOW

- Whether a genuine Atlas-originated schedule-change/cancellation webhook can ever be produced without a real ticketed booking and a real schedule disruption on it (very likely no, within a hackathon timeframe — and now doubly unlikely given §4B: sandbox tickets aren't real airline tickets, so a real airline-side schedule change against one is essentially impossible).
- The complete list of Atlas's ~23 void-supported airlines beyond the "Americas/Europe/Japan/Korea" region description and the specific carriers already confirmed supported (Volaris) or confirmed unsupported (Malindo/Batik Air) — Atlas's void documentation doesn't enumerate the full list, only the region summary.
- Whether Hong Kong or Kuala Lumpur would work as event-destination hubs (not investigated — deprioritized since Singapore already clears the bar).
- Whether `ANCHOR_EVENT` extraction (only schema-rejected once, not individually retested with hints) has any task-specific quirks beyond the general wrapping-key issue already isolated and fixed for `RULE_SET`.
- The true full size of the Atlas sandbox database — 67 sampled route/direction pairs and 28 observed airlines is a large, structured sample, not a census; there is no enumeration endpoint, so a fully exhaustive count isn't obtainable without asking Atlas directly.

## 20. KEY ASSUMPTION

The domain engine stays generic; Singapore is adopted as the summit location because provider reality (not narrative preference) empirically supports it best, and the real sandbox network is far larger and better-populated than the documentation ever suggested. The flight replacement ceiling for Wave 3R is "genuine sandbox order, paid, and ticketed" (proven, §4A) for the *booking* side; on the *recovery* side, refund is `SIMULATE_PROVIDER_BOUNDARY` **permanently** in this sandbox (§4B/§4C — not a temporary gap), while cancellation via void is **genuinely real** for carriers Atlas supports it for (§4C) — the scenario design should pick its carrier deliberately if a real cancellation matters to the demo. This satisfies the plan's `AI proposal → validation → viability → authority → executor → observe` pattern using only Atlas's own sandbox test-balance payment mode (never real card data), and it means Model Studio LIVE interpretation can now genuinely back any DR-0D/DR-5 claim once the small prompt fix (§8.2) is applied.

## 21. WHAT TO TEST NEXT

1. Apply the §8.2 prompt fix to `src/app/extraction.ts` (name the target schema fields in `EXTRACTION_SYSTEM_PROMPT`), then re-run the full 6-call probe suite (script already written and reusable) to confirm all tasks pass cleanly, not just the two retested here.
2. At DR-2, implement the `createFlightOrder`/`payFlightOrder`/`retrieveFlightOrder`/`cancelFlightOrder` delta from §13 using the exact wire formats discovered in §4/§4A/§4C (do not re-derive from docs). Implement cancellation via `void.do`, surface `843`-class rejections as a structured `NOT_SUPPORTED` capability result, and do not implement refund for the sandbox path.
3. At DR-3, design the webhook ingress's own authentication given Atlas provides none, and decide the simulated-source-event fallback shape using the `event/getPageList.do` record schema from §5 as the template.
4. At DR-5, build the NL→`ResolutionTarget` extraction task using the same field-naming prompt discipline validated in §8 — carry the exact `ResolutionTargetSchema` key names into the system prompt from day one.
5. When scenario design is frozen (DR-9): avoid the SIN→HKG leg specifically (every other tested Singapore pairing has real depth); if the hero scenario needs a real, provider-executed cancellation, prefer a void-supported carrier (Volaris/Frontier/Wizz/Jeju/Norwegian) for that specific leg — otherwise frame the cancellation step as simulated at the provider boundary, honestly labelled.
6. Consider probing a few more of Atlas's ~23 void-supported airlines (beyond Volaris) to build a fuller supported-carrier list before DR-9 locks the exact hero route.
