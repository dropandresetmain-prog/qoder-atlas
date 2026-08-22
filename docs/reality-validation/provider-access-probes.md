# Provider Access Probes — Northstar Wave 1

**Milestone:** Northstar Wave 1 (provider-access probes, evidence-only)
**Lane branch:** `probe/provider-access`
**Base SHA:** `b7037033f2af4f1a7b9985fd04e76158be246bde`
**Worktree:** `/data/work/probe-access`
**Date:** 2026-08-22
**Scope:** READ-ONLY — code review, env fact, bounded web search. **No product code changes, no test changes, no live provider calls.**

## 0. Environment fact (recorded once, applies to every probe)

`env | grep -iE 'ATLAS|MODEL_STUDIO|GOOGLE|DUFFEL|HOTELBEDS|NUITEE'` returns **no matches**. No Atlas client id/secret, no Model Studio key, no Google Routes key, no Duffel / Hotelbeds / Nuitée keys. A `find` for `/.env*` shows only `.env.example` (the template; values are empty or example values, never secrets — see `docs/ENVIRONMENT.md` lines 65-69: "Commit recordings only if they contain no secrets").

This is the same baseline the primary investigator recorded (`docs/reality-validation/README.md` lines 89-93) and the model-studio lane reconfirmed (`docs/reality-validation/07_MODEL_STUDIO_REALITY.md` lines 14-22). It means every "could I call it?" answer in this report is `ACCESS_BLOCKED` for the LIVE path, and the *real* question becomes "is the code path proven and is the credential hand-off clean?"

---

## 1. Probe: ATLAS (flight)

**Question.** Does the LIVE/RECORD/REPLAY access path exist in code, with shared normalization, and does the build avoid hardcoded SIN/Singapore fixture dependence?

**Evidence gathered (code paths checked).**

- `src/providers/atlas/client.ts:24-83` — `AtlasClient` HTTP shim; reads `ATLAS_BASE_URL` + `ATLAS_CLIENT_ID` + `ATLAS_CLIENT_SECRET` from constructor; sends via `x-atlas-client-id` and `x-atlas-client-secret` headers; maps `401/403 → AUTH`, `429 → RATE_LIMITED`, `400/404/422 → INVALID_REQUEST`, `>=500 → PROVIDER_ERROR`. Validates `baseUrl` is HTTPS with no embedded credentials (`client.ts:85-103`). Read-only endpoints only: `search.do`, `verify.do` (`client.ts:10`).
- `src/providers/atlas/adapter.ts:57-193` — `AtlasFlightAdapter implements FlightCapability`. Constructs `AtlasClient` lazily from `baseUrl/clientId/clientSecret`; throws `NOT_CONFIGURED` with code `atlas_missing_credentials` if any are absent in LIVE/RECORD mode (`adapter.ts:174-180`). REPLAY mode is explicitly forbidden from calling the provider (`adapter.ts:171-173`).
- `src/providers/runner.ts:49-138` — single `runAdapter` is used for every adapter: same `obtainRaw` + `normalize` code path runs in LIVE, RECORD, and REPLAY modes. The only branching is whether `obtainRaw` is invoked at all (REPLAY loads the recording via `recordingIdFor`; LIVE calls; RECORD calls and persists a sanitized payload via `sanitizeRaw`). Shared `normalize` = no separate demo logic path (NFR-03, FR-15, ADR-008).
- `src/config/config.ts:83-100, 119-132` — env names are frozen: `ATLAS_ENV` (default `sandbox`), `ATLAS_BASE_URL`, `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET`. `hasLiveCredentials('atlas')` returns `Boolean(a.baseUrl && a.clientId && a.clientSecret)`.
- `fixtures/recordings/atlas/{search,verify,fare_rules}/rec_*.json` — 3 committed sanitized Atlas recordings (one per `FlightCapability` op). They live under `fixtures/recordings/`, not under `src/`, so the build does **not** depend on a hardcoded Singapore fixture.
- SIN/Singapore hardcoding in `src/`: zero matches. `Grep "SIN|Singapore"` on `src/` returns only the unrelated `BUSINESS` cabin class and `ASSESSING` recovery-case status string. No `fromCity: "SIN"` constant, no test fixture reference, no Atlas adapter special-case.
- Report `01_ATLAS_SANDBOX_REALITY.md` is the prior lane's evidence; it already established (a) the read-only chain is `PROVEN_SANDBOX` via the lab pass (39 saved Search responses across 9 documented airlines), (b) the `search.do` request contract permits one-way arbitrary O&D (no whitelist gate on one-way), (c) the response for an un-fixtured route is `UNKNOWN` (status 0 with empty `routings[]` is a documented possible outcome). The adapter does not assume any specific route is in the fixture set; it just hands a response shape back through the same normalizer.

**Verdict.** **Adopt Now** (code path proven; LIVE calls deferred to Wave 2 RV-N6).

**Wave 2 implication (RV-N6).** Wire the LIVE budget: ~1,000 calls (estimated from the report 03 §A.3 Routes-table profile scaled to Atlas QPS; 100 fixture routes × 10 explore calls is 1k). Atlas default QPS is 10 (FAQ Q29); a 1,000-call run is ~100 seconds of sandbox traffic, well under any throttling. Use RECORD mode to capture a small corpus of happy-path search/verify responses in one credentialed run, then flip demo mode to REPLAY. **No architecture change required** — the LIVE seam is already clean; credentials are the only missing piece.

---

## 2. Probe: HOTEL (provider access practicality, bounded)

**Question.** Of the two primary candidates (Duffel Stays, Nuitée), which one can a hackathon-time operator reach in the time available without a sales contract, and what is the minimum we should commit to now?

**Evidence gathered (one bounded web search round each).**

- **Duffel Stays — DOCUMENTED instant self-serve sandbox.**
  - `https://app.duffel.com/join` and `https://github.com/duffelhq/hackathon-starter-kit` both say signup is ~1 minute with instant sandbox access; a `duffel_test_…` token is created from the dashboard in "Developer test mode."
  - `https://duffel.com/docs/guides/test-hotels` describes Test Hotels at fixed coordinates `(-24.38, -128.32)`. Test tokens start with `duffel_test_`.
  - `https://duffel.com/docs/api/overview/test-mode/duffel-airways` — same token pattern; dashboard switch puts the account in test mode.
  - **Caveat from the hotel lane report:** the Stays product still requires an explicit "request Stays access" step via Duffel contact form (`docs/reality-validation/02_HOTEL_PROVIDER_DECISION.md` §2.2 lines 165-171). That is a human-in-the-loop step, not a fully automated signup, even if the test token itself is instant once Stays is granted.
  - **Practical blocker for THIS environment:** account signup + Stays access request are manual steps, not executable from a non-interactive shell. There is no API key in `env` to drop in.

- **Nuitée / liteAPI — DOCUMENTED free sandbox, fully self-serve.**
  - `https://docs.liteapi.travel/docs/getting-a-sandbox-key` — "To get a free sandbox key, you need to create an account. Go to Nuitee Connect and choose signup in the upper right corner. No credit card is required."
  - `https://docs.liteapi.travel/docs/faq` — "Create a free account and sign in. Open Profile in the dashboard and copy your sandbox API key. Call the API in sandbox until your flow works (search → prebook → book)."
  - Sandbox key prefix is `sand_…`; test card `4242 4242 4242 4242` (per the Node.js cookbook cited in report 02 §2.5).
  - First-party Node SDK at v4.3.2 (`liteapi-node-sdk`, ~18K weekly downloads) — directly usable from this Node 24 stack.
  - **Practical blocker for THIS environment:** dashboard signup is browser-driven, not shell-driven. There is no API key in `env` to drop in.

- **Code-side readiness.**
  - `src/contracts/capabilities.ts:252-265` — `HotelCapability` already exposes the right shape: `searchHotels`, `quoteRate`, `bookStay`, `retrieveBooking`, `modifyStay`, `cancelStay`, plus the legacy `getStayContext`. The `HotelActionOutcome.provenance: 'LIVE' | 'REPLAY' | 'SIMULATED'` field is in place (`capabilities.ts:249`).
  - `src/providers/index.ts` (already wired) exports the provider registry; `runAdapter` is shared so the REPLAY-first + LIVE-seam pattern from Atlas is reusable.
  - No `src/providers/duffel/*` or `src/providers/nuitee/*` adapter exists yet — by design, this lane does not implement.

**Verdict.** **Keep Stretch** (primary = Duffel Stays; fallback = Nuitée; **not** Adopt Now because the credential is a manual signup step this environment cannot perform).

**Wave 2 implication (RV-N7).** Implement the `HotelCapability` adapter with **REPLAY-first + clean LIVE seam**:
1. Add a new `src/providers/duffel/` adapter implementing `HotelCapability` against the four-step flow (search → fetch_rates → quote → book → cancel; modifyStay = cancel + rebook, surfaced in outcome per the report 02 §9 contract delta).
2. Mirror the Atlas pattern: `mode` constructor arg, `RecordingStore` injection, secrets list passed to `runAdapter` for sanitization on RECORD, `NOT_CONFIGURED` thrown if LIVE/RECORD is selected without a `DUFFEL_TOKEN`.
3. Freeze env names: `DUFFEL_TOKEN`, `DUFFEL_BASE_URL` (default `https://api.duffel.com`), `DUFFEL_STAYS_ENV` (`test` default).
4. Commit a recorded Duffel search + book happy-path as `fixtures/recordings/duffel-stays/...` so the REPLAY demo works without any operator sign-in. Real credentials can be dropped in later by setting `DUFFEL_TOKEN` — no adapter change needed.
5. **Manual step the operator must own:** visit `https://app.duffel.com/join`, request Stays access, generate a `duffel_test_…` token, export it. (Estimated wall time once Stays is granted: < 10 min.) Document this exact procedure in the Wave 2 adapter README; do **not** automate it from the build.

---

## 3. Probe: TRANSFER (Hotelbeds Transfers — readiness evidence only)

**Question.** Is the Hotelbeds Transfers evaluation surface reachable for a Wave 2 adapter, and is anything else needed beyond the documented flow?

**Evidence gathered.**

- `https://developer.hotelbeds.com/documentation/getting-started/` — "Register today with our extremely simple registration process to get an ID and API Keys for our three API suites and gain access to our evaluation environment!" Registration is self-serve (no sales contact documented at the evaluation tier).
- `https://developer.hotelbeds.com/documentation/transfers/` — `Transfer Booking API` provides the full booking funnel: search availability, confirm, retrieve info, cancel, amend.
- Prior lane report `docs/reality-validation/03_GROUND_ROUTING_AND_TRANSPORT.md` §B.2 (line referencing §8 in the report) documents the exact constraint: **50 requests/day** on the evaluation tier, **identical-in-behaviour test servers** ("any booking requests … will not result in actual property reservations or credit card charges"), upgradeable via "profile progression" on the dashboard. Auth is `X-Signature = sha256(apiKey + secret + unix_ts)` — same complexity as Atlas's existing signed headers, no new pattern.
- Lifecycle is complete: `availability` → `booking` → `bookingDetail` → `bookingCancellation` (and `bookingAmendment` for modify). That maps 1:1 onto a future `GroundTransferCapability` seam.
- **Practical blocker for THIS environment:** same as Hotel — dashboard registration is browser-driven, not shell-driven; no `HOTELBEDS_API_KEY` or `HOTELBEDS_SHARED_SECRET` in `env`. Per report 03 §B.3, the escape hatch is to RECORD the first successful response, REPLAY thereafter; the existing `RecordingStore` supports this without new code.

**Verdict.** **Keep Stretch (S1)** — readiness evidence is on file; no new investigation required; commit the implementation to Wave 2 once the Wave 1 critical path is green. Do not implement in this lane.

**Wave 2 implication (RV-N7, transfer branch).** When a real account lands, the immediate plan is: register on the developer portal, capture apiKey + sharedSecret, run one full availability → booking → cancellation flow in RECORD mode, commit a sanitized recording under `fixtures/recordings/hotelbeds-transfers/...`. The 50 req/day quota is the binding constraint; a 5-call flow × 3 demo days × 2 retakes = 30 calls, well inside the budget. **No architecture contract change is needed** for the integration to land; the existing `CapabilityResult` envelope handles it.

---

## 4. Probe: GOOGLE ROUTES (REPLAY/NOT_CONFIGURED structured-degradation path)

**Question.** Does the adapter return a structured `NOT_CONFIGURED` failure (not a crash) when `GOOGLE_ROUTES_API_KEY` is absent, and are replay recordings available so the demo runs without a key?

**Evidence gathered (code paths checked).**

- `src/providers/googleRoutes/adapter.ts:42-90` — `GoogleRoutesAdapter` constructor takes an optional `apiKey?`. `getRouteContext(query)` validates the query, then calls `runAdapter(adapter, …)`; the `obtainRaw` is `this.computeRoutes(request)`.
- `src/providers/googleRoutes/adapter.ts:92-102` — `computeRoutes` does the right thing in three branches:
  1. `mode === 'REPLAY'` → throws `CapabilityFailure('PROVIDER_ERROR', 'google_live_call_in_replay', …)` (the runner catches this and returns the structured error envelope; no crash).
  2. `!this.apiKey` → throws `CapabilityFailure('NOT_CONFIGURED', 'google_routes_missing_key', 'Google Routes requires GOOGLE_ROUTES_API_KEY')`. This is the structured `NOT_CONFIGURED` path the question asks about.
  3. With a key → POSTs `https://routes.googleapis.com/directions/v2:computeRoutes` with `x-goog-api-key` and the field mask `routes.duration,routes.durationInTraffic,routes.distanceMeters`.
- HTTP error mapping (`adapter.ts:131-148`): `401/403 → AUTH`, `429 → RATE_LIMITED`, `400 → INVALID_REQUEST`, `>=500 → PROVIDER_ERROR` (retryable). All wrapped in `CapabilityResult`, never thrown to the caller.
- `fixtures/recordings/google-routes/route_context/rec_c47bcdae6b369baf521a9a2b03638faf.json` — committed sanitized recording with a real-shape payload (`duration: 900s, durationInTraffic: 1380s, distanceMeters: 15400`). REPLAY works without any key.
- `src/config/config.ts:95-99, 130-132` — env name is `GOOGLE_ROUTES_API_KEY`; `hasLiveCredentials('googleRoutes')` returns `Boolean(config.providers.googleRoutes.apiKey)`. Absent key → adapter still constructs, runs in REPLAY, or returns the structured failure.
- `docs/ENVIRONMENT.md:46-50` — explicit "Optional/non-blocking dynamic routing. Core must support REPLAY/fallback when absent." The code matches the contract.

**Verdict.** **Adopt Now** for REPLAY/fallback; LIVE configuration parked behind the report 03 §A.6 guardrail plan (key restriction, budget alert, daily quota, in-adapter counter, field-mask minimization, cache). This matches the `docs/reality-validation/03_GROUND_ROUTING_AND_TRANSPORT.md` §A.8 decision: `RECORD_AND_REPLAY` default, LIVE opt-in only with the §A.6 checklist verified.

**Wave 2 implication (RV-N7, routing branch).** No code change. The `LIVE` path is one env var + a permissioned IP restriction on the Google Cloud project away from working. The reproduction steps in report 03 §A.7 (lines 100-108) are the exact probe to run when a key is provisioned.

---

## 5. Cross-cutting observations

- The **shared `runAdapter` + `recordingIdFor` + `sanitizeRaw` + `CapabilityResult` envelope** pattern in `src/providers/runner.ts` is the real win of this codebase. Every probe above verified that the same plumbing works for every provider family. The Wave 2 adapters (Duffel, Hotelbeds Transfers) inherit the discipline for free.
- The **NFR-03 contract** (external failure is structured data, never a thrown exception that crashes core) is honoured at every boundary checked. Atlas, Google Routes, and the runner all map errors to `CapabilityResult.error`; none of them `throw` across the seam.
- The **NFR-04 contract** (no secrets in logs/errors) is honoured. The `secrets` array passed to `runAdapter` (`adapter.ts:118, 137, 150, 190-192`) is plumbed into `sanitizeRaw` (line 106) which strips them from persisted recordings. Atlas client `client.ts:107-122` redacts 401/403 message detail to a sanitized `providerMessage()` rather than echoing the body.
- **Environment fact is the same in every probe.** The only thing standing between this codebase and a live Atlas / Duffel / Hotelbeds / Google Routes call is the credential, not a code change. That is the right shape for a Wave 1 deliverable.

## 6. Findings triaged

| # | Finding | Triage | Why |
|---|---------|--------|-----|
| 1 | Atlas LIVE seam is clean, no SIN/Singapore hardcoding, recordings live in `fixtures/recordings/` | **Adopt Now** | Code path proven; credentials are the only missing piece. |
| 2 | Duffel Stays is the right primary hotel candidate (instant test token once Stays is granted) | **Keep Stretch** | Manual sign-in step blocks this environment; adapter implements in Wave 2 RV-N7. |
| 3 | Nuitée liteAPI is a credible fallback (free sandbox, first-party Node SDK) | **Keep Stretch** | Same manual sign-in blocker; useful as Duffel hedge. |
| 4 | Hotelbeds Transfers evaluation tier is 50 req/day, full lifecycle, same complexity class as Atlas | **Keep Stretch (S1)** | No new investigation; commit in Wave 2. |
| 5 | Google Routes REPLAY/NOT_CONFIGURED path is wired, recording exists, key is the only missing piece | **Adopt Now** | Matches the report 03 §A.8 decision verbatim. |
| 6 | `runAdapter` is shared across every adapter; `CapabilityResult` envelope is the seam | **Act Now** | The right invariant — preserve in Wave 2. |
| 7 | Env fact (no credentials present) was reconfirmed | **Ignore / Accept Risk** | This is the correct Wave 1 sandbox state. |

## 7. What Wave 2 must do (one paragraph)

Wave 2 RV-N6 (Atlas) flips the demo to RECORD once on a credentialed run, captures a small happy-path corpus, and ships with REPLAY as the default — no adapter change. Wave 2 RV-N7 (Hotel/Transfer/Routes) ships three REPLAY-first adapters against the existing `CapabilityResult` envelope: Duffel Stays (search → fetch_rates → quote → book → cancel; modifyStay = cancel + rebook), Hotelbeds Transfers (availability → booking → detail → cancel; 50 req/day evaluation quota), and confirms Google Routes LIVE opt-in is one Cloud Console step (key + IP restriction + budget alert + daily cap) away from working per report 03 §A.6. Every new adapter follows the same shape: `mode` constructor arg, `RecordingStore` injection, `secrets` plumbed into `sanitizeRaw`, `NOT_CONFIGURED` thrown if LIVE/RECORD is selected without credentials, recordings checked into `fixtures/recordings/<provider>/`. **No contract change is required** for any of these to land.
