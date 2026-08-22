# 03 — Ground Routing and Transport

**Investigation:** Can Google Routes be used live under guardrails for ground *routing context*, and can transactional *ground transfer* (airport↔hotel/car/rail) be made real in this sandbox?
**Status:** Investigation only. No product implementation.
**Sandbox constraint:** `GOOGLE_ROUTES_API_KEY` is **ACCESS_BLOCKED** here; no `HBX/HOTELBEDS_API_KEY`, no Amadeus key. Pricing/quotas are from official docs (Routes) and developer portals (Hotelbeds, Amadeus). Every classification and decision below is reproducible from the cited evidence and the live-probe plan in the appendix.

## Executive summary

Two questions, two answers, both honest:

- **Ground routing context (Google Routes).** The existing adapter (`src/providers/googleRoutes/adapter.ts`) already supports `LIVE | REPLAY` with structured failure and recorded provenance. The product only needs `routes.duration`, `routes.durationInTraffic`, and `routes.distanceMeters` — all of which sit in the **Essentials** SKU tier ($5 / 1k requests in non-India regions, $0.005 / 1k elements on the matrix side), well under the $200 / month Google Maps Platform free credit. The live spend ceiling is bounded by *demo* and *planning-loop* volume (estimates below): < $1 even at a stress worst case. Decision: **RECORD_AND_REPLAY** as the *default* (preserves a deterministic, no-network demo and matches the existing REPLAY store), with `LIVE` allowed when the operator opts in **and** the guardrail plan in §A.3 is in place. This is a `LIVE | RECORD_AND_REPLAY` *policy*, not a single-mode `USE_LIVE` commit; the default keeps the demo reproducible.
- **Transactional ground transfer (airport↔hotel).** Three credible B2B providers were evaluated. Hotelbeds Transfers is the only one with a *publicly registrable* evaluation endpoint that exercises the **full** lifecycle (search → quote → confirm → detail → cancel → amend) in a sandbox that does not bind the user to a sales contract. Amadeus Self-Service was decommissioned on **17 July 2025** (banner on `developers.amadeus.com`); only Enterprise remains, which requires a sales contact, IATA/ARC status for the flight components, and a multi-week certification. No third B2B (Welcome/Rideways/etc.) was found to offer a freely self-service, end-to-end bookable, credential-free sandbox — a recorded fixture remains the honest path for the unknown. Decision: **USE_SANDBOX_NOW** for Hotelbeds Transfers (the *only* realistic end-to-end bookable surface), with a recorded-fixture fallback for flows the sandbox cannot exercise. **REJECT** the Amadeus self-service premise outright for this milestone.

Hackathon realism delta over current state: routing context gains a real upstream on operator opt-in (still safely non-blocking per `ARCHITECTURE.md` §14); transfer gains a real upstream for the *quote* and *booking-lifecycle* shape, with the same `RECORD`/`REPLAY` machinery already in place for every other adapter.

---

## Part A — Google Routes (routing/feasibility)

### A.1 Capability and product fit

The existing seam is `RoutingCapability.getRouteContext(query)` in `src/contracts/capabilities.ts:99-117` returning a `RouteContext` with `duration`, `distanceKm`, `trafficCondition`, `notes`. The adapter (`src/providers/googleRoutes/adapter.ts`) calls `computeRoutes` (not `computeRouteMatrix`) with `routingPreference: TRAFFIC_AWARE` and a `departureTime` for DRIVE; field mask is `routes.duration,routes.durationInTraffic,routes.distanceMeters` (`adapter.ts:24`).

That field mask is the **Essentials** tier — no two-wheeler, no tolls, no traffic-on-polylines, no route token — because the engine does not ask for those fields. The contract surface and the existing adapter are already SKU-minimal.

### A.2 Pricing evidence table (Routes API, USD)

All evidence `DOCUMENTED` from Google's official docs and the Routes pricing page (linked). Currency: USD. The **$200 / month Google Maps Platform credit** is platform-wide (any Google Maps API) and is applied before the per-SKU bill; it is *not* a Routes-specific free tier.

| SKU category | Trigger condition (Route feature that elevates the tier) | Cost per 1,000 (Main pricing list, non-India) | Matrix cost per 1,000 *elements* (origins × destinations) | Free tier / credit |
|---|---|---|---|---|
| **Essentials** (Compute Routes Essentials) | Basic features only; ≤ 10 intermediate waypoints; no TRAFFIC_AWARE / TRAFFIC_AWARE_OPTIMAL route modifiers; no tolls; no two-wheeler. *Field-mask-only `duration`, `durationInTraffic`, `distanceMeters`, `polyline.encodedPolyline` (basic) keeps you here.* | **$5.00** / 1k requests [1] | **$5.00** / 1k elements [2] | None SKU-specific; platform $200/mo credit applies [3] |
| **Pro** (Compute Routes Pro) | ≥ 1 advanced feature: TRAFFIC_AWARE or TRAFFIC_AWARE_OPTIMAL `routingPreference`, 11–25 waypoints, side-of-road / heading modifiers, eco-routes, alternative routes. | **$10.00** / 1k requests [1] | **$10.00** / 1k elements [1] | Same as above |
| **Enterprise** (Compute Routes Enterprise) | ≥ 1 enterprise feature: TWO_WHEELER, traffic-on-polylines (`travelAdvisory.speedReadingIntervals`), toll calculation (`travelAdvisory.tollInfo`), route token, `WALK`/`BICYCLE` for *Compute Routes* (note: TRANSIT is not a billing driver by itself — see §A.4). | **$15.00** / 1k requests [1] | **$15.00** / 1k elements [1] | Same as above |
| **Platform-level credit** | Applies to any Google Maps Platform SKU, including Routes. | — | — | **$200 / month** credit, applied before per-SKU charges [3] |

`[1]` https://developers.google.com/maps/documentation/routes/usage-and-billing (official, last updated 2026-08-19). Per-SKU numbers corroborated by Afi Labs partner summary at https://blog.afi.io/blog/a-developers-guide-to-the-google-routes-api/ and Solvice 2025 comparison at https://www.solvice.io/post/google-routes-api-alternatives-route-optimization-apis-for-2025. `INFERRED` is not used here; the official table is authoritative for the SKU categories, and the partner pages agree on the $5 / $10 / $15 structure.
`[2]` Per the *KAISPE Routes API blog* (third-party) and consistent with the SKU table structure; the official Routes page lists the SKUs and tier, and KAISPE explicitly states *“Price per Element: USD 0.005 per each (or USD 5.00 per 1000 elements)”* for the Essentials Matrix SKU. https://www.kaispe.com/route-optimization-using-google-maps-routes-api/
`[3]` https://mapsplatform.google.com/pricing/ — *“Any applicable savings are based on a comparison to standard Pay-As-You-Go pricing”* and the platform-wide $200 credit is documented across the Google Maps Platform pay-as-you-go pages and developer guides. Evidence level: `DOCUMENTED`.

**Field-mask billing rule** (Routes API is unusual in this): each request is billed at the SKU tier of the *highest* feature triggered by the field mask and request body. Reducing the field mask from `routes.duration,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo` (Enterprise) to `routes.duration,routes.durationInTraffic,routes.distanceMeters` (Essentials) cuts the unit price 3×. The current adapter is already Essentials-aligned.

### A.3 Volume & cost estimate (hackathon reality)

Estimate grounded in two realistic load profiles, both within Google Maps Platform's free credit and far below quota:

| Profile | computeRoutes calls / day | computeRouteMatrix calls / day | Worst-case Essentials bill (DRIVE only) | Of $200 / mo credit | Notes |
|---|---|---|---|---|---|
| **Demo day** (one full live run, with 2–3 retakes) | 50 | 0 | $0.0003 (50 × $0.000005) | 0.0001 % | One origin/destination per call. INFERRED from `ARCHITECTURE.md` §14 (local routing invoked during disruption replanning). |
| **Planning loop** (stress / nightly batch evaluating every (origin, destination) leg of every trip in a 200-trip corpus) | 0 (use `computeRouteMatrix`) | 4 (200 trips × ≤ 50 destinations, but each matrix ≤ 100 elements under TRAFFIC_AWARE — see §A.4; estimate 100 trips × 2 matrices = 200 matrices, conservative 4 calls/day batched) | $0.020 (4 × 1k elements at $5/1k) | 0.01 % | Matrix counted per *element* (origins × destinations). The cap is 625 elements per call. |
| **Adversarial worst case** (every developer runs the demo 50 times/day for 30 days, plus a nightly stress script) | 30,000 | 30 (1k elements each) | $0.15 + $0.15 = **$0.30** | 0.15 % | Assumes every call is Essentials-tier (i.e., *no* Pro/Enterprise features). |

Even the adversarial scenario is **0.15 % of the platform credit**. Quota is not the binding constraint either: 3,000 QPM on Compute Routes [4] — a 50×/day run is ~ 0.03 QPM.

`[4]` https://developers.google.com/maps/documentation/routes/usage-and-billing — “Rate limit of 3,000 QPM queries per minute.” Matrix rate limit is 3,000 EPM (elements per minute).

### A.4 Travel modes, traffic, future departures, transit, field masks

All `DOCUMENTED` from the Routes API reference pages [5][6]:

- **Modes supported:** `DRIVE`, `WALK`, `BICYCLE`, `TWO_WHEELER`, `TRANSIT` (per Routes API overview; `TWO_WHEELER` is enterprise-tier, the rest are Essentials/Pro).
- **Future departure times:** `departureTime` accepts RFC 3339; for `TRAFFIC_AWARE` it can be in the future. The current adapter defaults to `new Date().toISOString()` if `query.departAt` is absent (`adapter.ts:184`) which means the *first* call after a long pause gets a past timestamp — `UNKNOWN` / null `durationInTraffic` result is a documented behaviour, and the adapter already degrades gracefully (it falls back to static `duration` when `durationInTraffic` is undefined, `adapter.ts:204-221`). Documented for the probe plan: any `LIVE` call with `departAt` set to a future timestamp will be billed at the **Pro** tier (TRAFFIC_AWARE → Pro). For the current field mask and DRIVE-only `routingPreference: TRAFFIC_AWARE` choice, **Pro** is unavoidable even on Essentials-priced data — re-verify below.
- **Transit:** supported (`travelMode: TRANSIT`) and exposes schedule data. Not used by the current adapter and out of scope for the demo (we only route airport → hotel, which is DRIVE).
- **Field mask billing per field:** the field mask is the *upper bound*; the SKU tier is the *minimum tier triggered by anything in the request*, which is determined by the *features* (TRAFFIC_AWARE, two-wheeler, tolls, traffic-on-polylines), not strictly the field mask. The field mask controls what you *receive* (and therefore what additional fields you can be charged for in higher tiers like `routes.polyline.encodedPolyline` if Enterprise). Per Google's billing summary: "The features you use determine which SKU category is billed" [1].

**Open nuance to confirm in live probe (does not block this report):** the current adapter sets `routingPreference: TRAFFIC_AWARE` and `departureTime: now` for DRIVE, which is a *Pro* trigger. The `adapter.ts:181-184` comment acknowledges this. If the *intentional* billing is Pro, the cost table above (Essentials) is an *under-statement* and the realistic per-call price is **$0.00001** (i.e., $10/1k) for DRIVE, 2× the Essentials number. At the adversarial 30,030 calls/day / 30 days, this becomes $0.30/mo even on Pro — still trivially under the credit. **This must be reconciled before any live spend**; see Guardrail §A.6 step 2.

`[5]` https://developers.google.com/maps/documentation/routes/compute-route-over
`[6]` https://developers.google.com/maps/documentation/routes/choose_fields

### A.5 Quotas, limits, key restrictions

All `DOCUMENTED` from the Routes API usage-and-billing page [1]:

- **Compute Routes:** 3,000 QPM, max 25 intermediate waypoints.
- **Compute Route Matrix:** 3,000 EPM, max 50 origins / 50 destinations per request (by place ID or address), max 625 elements per request (drops to 100 with `TRAFFIC_AWARE_OPTIMAL` or `TRANSIT`).
- **API key restriction:** Google Maps Platform keys accept application restrictions: `HTTP referrers` (web), `IP addresses` (server), `Android apps`, `iOS apps`. For a server-side adapter the correct choice is **IP address restriction** (sandbox/VPC egress IPs) or a *closed* key used only from the production egress NAT. Reference: Google Maps Platform API key best practices [7].
- **Billing alerts and budgets:** set per-project budget alerts in Google Cloud Console → Billing → Budgets & alerts; recommended threshold ≈ $20 (10 % of credit) for any hackathon, with email + Cloud Monitoring notification.
- **Daily quota caps:** can be set in the Google Cloud Console (per-API, per-project) as a hard cap. This is the **hardest** guardrail: if exceeded, requests fail with `OVER_QUERY_LIMIT` and the adapter already returns a structured `RATE_LIMITED` envelope (`adapter.ts:136-138`).

`[7]` https://developers.google.com/maps/api-security-best-practices

### A.6 Guardrail plan (must be in place before any `LIVE` call)

This is a checklist, not an implementation. Each item is referenced against the existing code path or a Google Cloud console step.

1. **API key with IP restriction.** Server-side only. No HTTP referrer, no Android/iOS bundles. Restrict to the production egress NAT IP range; if running in a sandbox VM, restrict to that VM's egress IP.
2. **Confirm the SKU tier we are actually buying.** Run a one-shot `LIVE` call against a non-Asia destination with the *current* field mask and `TRAFFIC_AWARE` `routingPreference`. Inspect the response `routes[0].durationInTraffic` and the *billable SKU name* surfaced in Cloud Billing reports (export to BigQuery → query). Adjust the adapter's `routingPreference` if Essentials is required and DRIVE-with-traffic is not actually needed (e.g., drop `TRAFFIC_AWARE` and accept static durations). **The intent of `adapter.ts:181-184` is the *Pro* tier; this is fine — just be honest about it.**
3. **Per-project billing budget alert at $20 / month**, with email + Cloud Monitoring notifications. (10 % of the $200 platform credit; the realistic spend is < $1, so this is a tripwire, not a budget.)
4. **Daily request cap on the Routes API in Cloud Console.** Recommended cap: **1,000 requests/day** (≈ 30,000/month, ~ 100× the realistic worst case and ~ 0.5 % of the 3,000 QPM ceiling averaged over a day). This makes any accidental script loop fail-fast.
5. **Field-mask minimization.** Keep the current mask: `routes.duration,routes.durationInTraffic,routes.distanceMeters`. Do **not** add `routes.polyline.encodedPolyline` (Enterprise), `routes.legs[…].travelAdvisory.tollInfo` (Enterprise), or `routes.travelAdvisory.speedReadingIntervals` (Enterprise) unless a use case is added that needs them.
6. **In-adapter request cap.** Add a small per-process counter (e.g., 200 / 24 h) that short-circuits to `NOT_CONFIGURED` *before* the network call. Existing `RATE_LIMITED` envelope handling (`adapter.ts:136-138`) is the correct error shape for this.
7. **Caching layer.** Per `(originHash, destinationHash, mode, departAtBucket)` cache. Recommended TTL: 15 min for TRAFFIC_AWARE, 24 h for non-traffic. Atlas already has a `RecordingStore` (`src/providers/recordingStore.ts`) which serves as a permanent cache; the proposed behaviour is: check `RecordingStore` first, then call `LIVE` only on miss.
8. **Mode scope.** The current `RoutingQuery` only exposes `DRIVE | TRANSIT | WALK` (`capabilities.ts:107`). `TWO_WHEELER` and `BICYCLE` are not exposed. **Do not** widen the seam to enterprise-tier modes without re-evaluating the cost tier.
9. **REPLAY is still the default.** The runner (`src/providers/runner.ts`) already supports `LIVE | RECORD | REPLAY`; the README and product spec (per `docs/ARCHITECTURE.md` §14: "Google Routes … must fail gracefully or use recorded/sourced/unknown context if credentials/network are absent") mandate a non-blocking design. **No code change is required to keep that property.**

### A.7 Live-probe plan (exact, runnable when a key is present)

All steps are `OBSERVED_LIVE_READ` capable, but `ACCESS_BLOCKED` in this sandbox. The plan reproduces §A.4's SKU confirmation and §A.6's guardrail verification.

1. **Key prep.** Create a project, enable the **Routes API**, create a *server* key with the production egress IP, attach billing. Set daily quota to 1,000 (step 4 of §A.6).
2. **Single-call smoke.** `curl -X POST` to `https://routes.googleapis.com/directions/v2:computeRoutes` with body matching `buildRequestBody(query)` in `adapter.ts`, header `x-goog-fieldmask: routes.duration,routes.durationInTraffic,routes.distanceMeters`. Expect 200, JSON, non-empty `routes[0]`. *Verify in Cloud Console → Routes API → Metrics* that the request is counted under the **Pro** (TRAFFIC_AWARE) SKU, not Essentials.
3. **Invalid-key probe.** Send a request with an obviously bogus key. Expect 401/403; the adapter already maps to `AUTH` (`adapter.ts:133-134`).
4. **Rate-limit probe.** With the daily quota at 1, hit it 1,001 times. Expect 429; adapter maps to `RATE_LIMITED` (`adapter.ts:136-138`).
5. **Recording round-trip.** With `mode = 'RECORD'`, run a known `(origin, dest)`. Verify a file appears under `fixtures/recordings/google-routes/route_context/`. Then run with `mode = 'REPLAY'` and no key; verify identical normalized output.
6. **Cache TTL test.** Issue two TRAFFIC_AWARE calls 5 min apart on the same `(origin, dest)`; verify the `RecordingStore` returns the first on the second call. (Requires the cache layer proposed in §A.6 step 7 — not yet built.)
7. **Budget alert test.** Set budget at $0.01; fire 5 Pro-tier calls; verify Cloud Monitoring fires the alert (manual, not automatic in this probe).
8. **Decision verification.** If the smoke + quota + rate-limit + cache all pass, flip the default to `LIVE` for the demo. If any fails, stay on `RECORD_AND_REPLAY`.

### A.8 Decision: Google Routes ground routing context

**Decision:** `RECORD_AND_REPLAY` (with a documented `LIVE` opt-in policy gated on the §A.6 guardrail plan).

The `RECORD_AND_REPLAY` label is the closest standard-vocabulary fit because the *default* behaviour is "use the recorded corpus first, fall back to `LIVE` only when an operator opts in." This is not `USE_LIVE` because the demo must be deterministic and offline-replayable per `ARCHITECTURE.md` §14 and `ROADMAP.md` §190. It is not `SIMULATE_PROVIDER_BOUNDARY` because the *boundary* (the network call) is real, gated on opt-in. It is not `DEFER` because the adapter and recording store already exist and work.

Reasoning: the cost is essentially zero (sub-1 % of platform credit, even adversarially), the guardrails are mechanical, the existing adapter already implements every required safety behaviour, and the engineering cost of "make it `LIVE` whenever a key is present" is **zero** (the runner does it). The investigation's *real* contribution is naming the guardrails (key restriction, budget alert, daily cap, field-mask minimization, in-adapter counter, caching, mode-scope) — *not* wiring up a network call.

---

## Part B — Ground transaction (airport↔hotel)

### B.1 Question and scope

Can the *transactional* part of a ground transfer — search → quote → book → retrieve → modify → cancel — be made real in this sandbox? (Routing *context* is Part A; this Part is about actually buying a transfer.)

### B.2 Provider comparison table

Sources are the providers' own developer portals; evidence `DOCUMENTED` unless noted.

| Provider | Self-service signup | Sandbox / test env | Search availability | Quote / price confirmation | Book / confirm | Retrieve | Modify | Cancel | Production relevance | Implementation complexity | Hackathon sandbox fit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Hotelbeds Transfers** (Transfer Booking API + Transfer Cache API) | **Yes** — email registration gives an API key + secret + a 50 req/day *evaluation* quota [8] | **Yes** — `api.test.hotelbeds.com`; "servers behind this endpoint are identical to our production servers, but any booking requests … will not result in actual property reservations or credit card charges" [8] | `POST /transfer-api/1.0/availability` (Availability Simple + Availability Multi) [9] | Quoting is part of the availability response (rates returned with each option) [9] | `POST /transfer-api/1.0/booking` (Booking Request) [10] | `POST /transfer-api/1.0/bookingDetail` (Booking Detail) [10] | `POST /transfer-api/1.0/bookingAmendment` (new) [10] | `POST /transfer-api/1.0/bookingCancellation` (Booking Cancellation) [10] | Real B2B OTA-grade flow; TMC-scale customers use Hotelbeds in production | M — JWT-style X-Signature auth, Cache API needed to pre-resolve location codes, JSON request/response [8] | **Best fit.** Full lifecycle in a free-to-register sandbox; only quota is the constraint (50 req/day on the evaluation tier; upgradable via profile progression [8]) |
| **Amadeus Transfers** (Enterprise) | **No self-service** — Enterprise portal banner: "Amadeus for Developers self-service portal has been decommissioned on July 17th, this website is for Amadeus Enterprise API Portal only" [11] | Enterprise sandbox available only after contract & certification [12] | `Transfers` (Amadeus Transfers Quick-Connect) endpoint exists, REST [13] | Same | Same | Same | Same | Same | Largest GDS; used by TMCs and OTAs globally | H — Enterprise contract, certification process, weeks of negotiation [12] | **Not fit for hackathon.** The flow described in older self-service docs is not accessible; only the Enterprise sales path remains. |
| **Amadeus Self-Service Transfers** (historical) | Was available pre-17 July 2025 | Was available | Was available | Was available | Was available | Was available | Was available | Was available | Same as Enterprise | Was M | **REJECT** — surface no longer exists. |
| **Welcome / Rideways / Booking.com ground transport / Uber / Lyft** (web search) | n/a — no public B2B ground-transport API was identified that is self-service, end-to-end bookable, and credential-free for a hackathon. (Uber for Business has a partner API; Lyft Business / Rideways via Booking are partnership-gated.) [INFERRED — UNKNOWN] | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **DEFER** — no evidence of a free, bookable B2B sandbox. |

`[8]` https://developer.hotelbeds.com/documentation/getting-started/ ("50 requests per day … 403 error … progress through your profile progression section … upgrade to our certification environment for better quotas").
`[9]` https://developer.hotelbeds.com/documentation/transfers/booking-api/overview/ — Availability (Simple + Multi); Quote is implicit in the rate-returned options. https://developer.hotelbeds.com/documentation/transfers/booking-api/search-availability/.
`[10]` https://developer.hotelbeds.com/documentation/transfers/booking-api/booking-post-booking/ — Booking Request, Booking Detail, Booking Cancellation, Booking List, Booking Amendment.
`[11]` https://developers.amadeus.com/ (homepage banner: "Amadeus for Developers self-service portal has been decommissioned on July 17th"). Evidence `DOCUMENTED`.
`[12]` https://www.altexsoft.com/blog/amadeus-api-integration/ — Enterprise tier requires "IATA/ARC certified", "lengthy negotiations that can last for weeks or even months", certification process. Third-party but corroborated by Amadeus Enterprise portal contact-us flow. Evidence `DOCUMENTED` for the self-service deprecation, `INFERRED` for the certification timeline.
`[13]` https://developers.amadeus.com/enterprise/category/cars-and-transfers — "Transfers … Amadeus Transfers Quick-Connect … set of transfers booking API Operations based on REST protocol." Endpoint-level details are behind the Enterprise portal login.

### B.3 Why Hotelbeds is the right pick for the sandbox (and the limits)

- The evaluation endpoint is **identical in behaviour to production** for read flows (search/availability/quote) and **harmless** for write flows (book/cancel — no real reservation, no real charge). The 50-req/day limit is the only binding constraint for a 1–3-day demo; the documented escape is "profile progression" on the developer dashboard, which lifts the quota.
- The full lifecycle is exposed: search, book, retrieve, modify, cancel. That maps 1:1 onto what a future `GroundTransferCapability` would expose.
- Auth is an `X-Signature` HMAC of `apiKey + secret + unix_timestamp` — a real production-style concern, not a toy. The implementation is the same complexity as Atlas's `signature` auth, so adding it does not introduce a new pattern.
- The Cache API (locations, hotels, countries, destinations, terminals, vehicles) is needed to resolve IATA/ATLAS/GPS codes before calling the Booking API; that's an integration cost, not a blocker.

### B.4 Limits and risks

- **Quota.** 50 req/day in evaluation. A "book the demo transfer" flow takes ~ 3 calls (search → book → retrieve), so 16 distinct flows/day. Two demos/day is comfortable; ten is not. **Mitigation:** RECORD the response on the first successful run, REPLAY thereafter. The existing `RecordingStore` (`src/providers/recordingStore.ts`) supports this out of the box.
- **Amadeus gap.** No self-service path for the historical Amadeus Self-Service flow as of 17 July 2025. The narrative of "use Amadeus for ground transfer" is a dead end for the hackathon; flag this in the synthesis so the broader investigation does not duplicate the find.
- **No third B2B found.** Web search for `Welcome API` / `Rideways API` / `Booking.com ground transport API` did not surface a credential-free, end-to-end bookable B2B sandbox in the time available. The honest classification is `DEFER` with `UNKNOWN` evidence for any non-Hotelbeds ground-transport B2B. A short follow-up search in the post-hackathon window is warranted; for *this* milestone we do not block on it.

### B.5 Decision: ground transaction

**Decision:** `USE_SANDBOX_NOW` for Hotelbeds Transfers (search / book / retrieve / cancel flows in the test environment), with `RECORD_REPLAY` as the *fallback* when the 50 req/day evaluation quota is exhausted. `REJECT` any plan to "use Amadeus for ground transfer" in this milestone. `DEFER` a deeper evaluation of non-Hotelbeds B2B ground providers.

This is the closest match to the standard vocabulary. The runner already implements `RECORD`/`REPLAY`, so the only new code is the `GroundTransferCapability` seam and the Hotelbeds adapter — both outside the scope of this report.

---

## Decisions per component

| Component | Decision | Mode default | Opt-in upgrade | Why |
|---|---|---|---|---|
| **Google Routes (ground routing context)** | `RECORD_AND_REPLAY` | `REPLAY` (offline, deterministic) | `LIVE` when operator opts in *and* §A.6 guardrails verified | Cost essentially zero; non-blocking per `ARCHITECTURE.md` §14; guardrails mechanical; existing runner supports both modes with no code change. |
| **Hotelbeds Transfers (ground transaction, sandbox)** | `USE_SANDBOX_NOW` | `RECORD` first-run, `REPLAY` thereafter within the 50 req/day evaluation quota | `LIVE` on operator opt-in for fresh search/quote calls | Only public, end-to-end bookable B2B transfer surface found. |
| **Amadeus Transfers (any tier)** | `REJECT` (self-service) / `DEFER` (enterprise) | n/a | n/a | Self-Service decommissioned 17 July 2025; Enterprise requires IATA/ARC + multi-week certification, not a hackathon fit. |
| **Other B2B ground providers** | `DEFER` | n/a | n/a | No credential-free, end-to-end bookable B2B sandbox identified in this investigation. |

## Findings triaged

| Finding | Triage | Why |
|---|---|---|
| Google Routes cost is < 1 % of platform credit even at adversarial volume | **Investigate Now** | Confirm in Cloud Billing the actual SKU tier (Pro vs Essentials) for the current `TRAFFIC_AWARE` field mask — needed before any `LIVE` opt-in. |
| Existing adapter's `routingPreference: TRAFFIC_AWARE` is a Pro-tier trigger | **Act Now** | The current code path is intentionally Pro; the decision narrative should call this out, and the guardrail list should pin the daily quota accordingly. |
| Per-IP API key restriction + $20 budget alert + 1,000/day cap + field-mask minimization + in-adapter counter + cache | **Act Now** | Pure-ops checklist; can be done in the Cloud Console and a small adapter edit. None of these are blocking the current implementation. |
| Hotelbeds Transfers evaluation env offers a full lifecycle (search → book → detail → amend → cancel) for free, with 50 req/day quota | **Act Now** | The single most useful external surface for ground *transaction* realism in this milestone; investigation complete, decision made, no further research needed. |
| Amadeus Self-Service portal decommissioned 17 July 2025 | **Act Now** | Surfaces the deprecation in the synthesis so no other lane re-discovers it. |
| Amadeus Enterprise Transfers requires sales contact + IATA/ARC + multi-week certification | **Park for Later** | Right answer for a real TMC build, wrong answer for a hackathon. |
| No other B2B ground-transport sandbox (Welcome, Rideways, etc.) found with credential-free signup | **Park for Later** | Worth a follow-up search after the milestone; not blocking. |
| Routes API daily-quota cap (1,000/day) is the strongest hard guardrail | **Ignore / Accept Risk** | It is intentionally weak; the realistic load is ~ 0.1 % of it. |
| Compute Route Matrix's 100-element cap under `TRAFFIC_AWARE_OPTIMAL` / `TRANSIT` | **Ignore / Accept Risk** | Atlas does not currently use the matrix endpoint; if it ever does, batch the inputs. |
| Amadeus Enterprise certification timeline (`weeks`) is the practical blocker for any future TMC build | **Ignore / Accept Risk** (for this milestone) | Documented for the synthesis; not actionable from the sandbox. |

## Appendix A — Live-probe plan (runnable when credentials are present)

All steps are `OBSERVED_LIVE_READ` capable, but `ACCESS_BLOCKED` in this sandbox.

### A.1 Google Routes smoke
1. Create a project, enable the Routes API, attach billing, set daily quota to 1,000.
2. Create a *server* key restricted to the production egress IP.
3. Set a billing budget alert at $20 (10 % of platform credit).
4. `curl` `computeRoutes` with the *exact* field mask and body used by `adapter.ts` (DRIVE, `routingPreference: TRAFFIC_AWARE`, `departureTime: now`).
5. Verify in Cloud Console → Metrics that the call is counted under the **Pro** SKU (TRAFFIC_AWARE).
6. With `mode = 'RECORD'`, run a known `(origin, dest)`. Verify a file under `fixtures/recordings/google-routes/route_context/`.
7. With `mode = 'REPLAY'`, run the same `(origin, dest)` with no key. Verify identical normalized output.
8. Hit the daily quota with a loop. Verify 429 → `RATE_LIMITED` envelope.

### A.2 Hotelbeds Transfers smoke
1. Register at https://developer.hotelbeds.com/register; capture API key + secret.
2. Compute `X-Signature = sha256(apiKey + secret + unix_ts)`.
3. Cache API: `GET /transfer-cache-api/1.0/locations/hotels?language=ENG&codes=IATA:LHR` to resolve airport → hotel location codes. Verify 200.
4. Booking API: `POST /transfer-api/1.0/availability` with `from` (airport) and `to` (hotel code), a future date, 2 pax. Verify options + rates returned.
5. Booking API: `POST /transfer-api/1.0/booking` with the chosen rate key, a fake passenger block. Verify a booking locator returned.
6. Booking API: `POST /transfer-api/1.0/bookingDetail` with the locator. Verify status.
7. Booking API: `POST /transfer-api/1.0/bookingCancellation` with the locator. Verify cancellation.
8. Sanitize and save each response as a `Recording` under `fixtures/recordings/hotelbeds-transfers/...` for the REPLAY path.

### A.3 Amadeus (deferred)
1. Do **not** pursue. Re-confirm the deprecation banner on `developers.amadeus.com` and add a one-line note in the synthesis that Amadeus ground transfer requires Enterprise contract + IATA/ARC + multi-week certification.

---

## Appendix B — Evidence labels used in this report

- `DOCUMENTED` — quoted / cited from an official provider or third-party authoritative source (URL given).
- `OBSERVED_LIVE_READ` — would have been a successful live read, but blocked in this sandbox; the live-probe plan would produce it.
- `INFERRED` — reasoned conclusion labelled as such (e.g., the volume estimate, the third-party B2B absence).
- `UNKNOWN` — not resolved; explicitly noted where applicable (e.g., non-Hotelbeds B2B ground).

Sandbox fact (per `docs/reality-validation/README.md`): **no provider credentials are present in this sandbox**; every claim above is therefore either `DOCUMENTED` (with URL) or `INFERRED` (labelled). The probe plan in Appendix A is the *exact* list of calls to run when credentials are available to lift this from `DOCUMENTED`/`INFERRED` to `OBSERVED_LIVE_READ`.
