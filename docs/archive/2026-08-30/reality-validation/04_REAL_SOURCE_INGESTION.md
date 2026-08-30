# Reality Validation — Real Source / URL Ingestion

**Lane:** `rv/source-ingestion-investigation` (Report 04)
**Base:** `6d203960a2948ac81e128a9483cb189323f7c018` (`origin/main`)
**Scope:** Research + code audit only. No product implementation.

## Executive summary

Atlas's ingestion lane is **content-agnostic by design**: the `SourceIngestionCapability` (`src/ingest/pipeline.ts:204`) only consumes *already-fetched* `content` (or a `structured` payload) on a `SourceInput`. The seam is `SourceInput = { kind, title?, uri?, content?, structured? }` (`src/contracts/capabilities.ts:208`). **No code path today fetches, downloads, or renders a URL.** The pipeline is correct and complete for the in-memory contract; URL → content acquisition is the missing half.

For the seven source kinds the brief calls out (URL, plain HTML, JS-heavy page, PDF, booking confirmation, plain email, policy document, traveller profile) the *normalization* half works today through three deterministic paths and the model-neutral `SemanticExtractionClient` seam (`src/ingest/semantic.ts:46`). What is missing is the **front-half** that turns `kind=WEBPAGE` + a `uri` into `content`, plus the security and content-type machinery that goes with it.

Recommendation: introduce a **provider-neutral fetch service** that hands a normalized text payload back to the existing capability. **No headless browser for MVP** — a plain HTTP `fetch` with a content-type registry and a Mozilla-style readability extractor is sufficient for ~80% of realistic trip sources. The remaining ~20% (JS-rendered booking flows, Akamai-fronted hotel sites) are recorded as structured `UNAVAILABLE` with provenance, not silently dropped. URL ingestion therefore lands as a small, layered addition: a fetch service + a content-type registry + readability extraction + HTML sanitization — all front of the existing ingestion seam.

## 1. Current-state audit: source kinds × capability × evidence

Audit performed by reading `src/ingest/{pipeline,source,structured,normalize,semantic,artifacts,ruleSets,travellerContext}.ts`, `src/contracts/capabilities.ts`, `src/domain/common.ts`, `fixtures/scenarios/*/sources/*`, and `test/ingestion.test.ts`. Authority is derived deterministically from `kind` in `SOURCE_AUTHORITY_BY_KIND` (`src/ingest/source.ts:41`).

| Source kind           | Ingestion path today (file:line)                                                                                          | URL → content | Works end-to-end today? | Gap                                                                                            | Evidence label      |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------|---------------|-------------------------|------------------------------------------------------------------------------------------------|---------------------|
| URL (bare, no fetch)  | none — `SourceInput.uri` is recorded into `SourceRecord.uri` (`src/ingest/source.ts:119`) and otherwise inert             | NO            | NO                      | No fetcher; `content` is never populated from `uri`                                             | OBSERVED (code)     |
| Plain HTML page       | Semantic path → `ANCHOR_EVENT` task (`src/ingest/semantic.ts:202`) via `EXTRACTION_TASKS_BY_KIND.WEBPAGE=['ANCHOR_EVENT']`| NO            | Partial                 | Caller must pre-fetch and pass `content`; rich text → anchor event only (no rule sets, no traveller context) | DOCUMENTED          |
| JS-heavy page         | same as plain HTML; same limitation                                                                                       | NO            | Partial                 | Headless not supported; a JS-only page (e.g. SPA booking widget) will yield empty/boilerplate text | INFERRED + OBSERVED_LIVE_READ |
| PDF                   | falls under `DOCUMENT` → `RULE_SET`/`TRAVELLER_CONTEXT`/`ANCHOR_EVENT` (`src/ingest/semantic.ts:204`)                    | NO            | Partial                 | No binary decoding; caller must pre-extract text. No MIME registry; binary bytes would be passed through as "content" today | DOCUMENTED          |
| Booking confirmation  | `BOOKING_CONFIRMATION` → `FLIGHT_BOOKING`/`STAY_BOOKING` (`src/ingest/semantic.ts:205`); structured path uses `ExtractedFlightBookingSchema` / `ExtractedStayBookingSchema` (`src/ingest/structured.ts:171`, `:184`) | NO            | Yes (text or structured) | No email/PDF parsing; only works when caller hands text/JSON. Anti-hardcoding test passes today against text fixtures (`test/ingestion.test.ts:181`, `:225`) | DOCUMENTED + OBSERVED (fixtures) |
| Plain email (RFC 822) | `EMAIL` → `DISRUPTION_SIGNAL`/`FLIGHT_BOOKING`/`TRAVELLER_CONTEXT` (`src/ingest/semantic.ts:203`); no MIME parser present  | NO            | Partial                 | Headers/quoted-printing/MIME parts are the caller's job; semantic path has no MIME seam           | DOCUMENTED          |
| Policy document       | `POLICY_DOCUMENT` → `RULE_SET` (`src/ingest/semantic.ts:206`); `RULE_SET_KIND_FALLBACK.POLICY_DOCUMENT='ORGANISATION'` (`src/ingest/ruleSets.ts:36`) | NO            | Yes (text or structured) | Same "bring your own text" limitation; org-policy rule structure is pre-validated per `PolicyRuleSchema` | DOCUMENTED + OBSERVED (`fixtures/.../organiser-policy.md`) |
| Insurance document    | `INSURANCE_DOCUMENT` → `INSURANCE` extraction task; `RULE_SET_KIND_FALLBACK='INSURANCE'`; emits `INSURANCE_COVERAGE` rule (`src/ingest/ruleSets.ts:152`) | NO            | Yes (text or structured) | Same bring-your-own-text limitation                                                            | DOCUMENTED + OBSERVED (`fixtures/.../insurance-policy.md`) |
| Traveller profile     | `PROFILE` → `TRAVELLER_CONTEXT` (`src/ingest/semantic.ts:208`); anti-fabrication demotions in `travellerContext.ts:412`   | NO            | Yes (text or structured) | Same bring-your-own-text limitation                                                            | DOCUMENTED + OBSERVED (`fixtures/.../traveller-profile.md`) |
| Provider state (live) | `PROVIDER_STATE` → no semantic task, structured path only (`src/ingest/semantic.ts:209`); emits `FLIGHT_*`/`BOOKING_STATE_CHANGE` signals (`src/ingest/structured.ts:90`, `:115`) | N/A (push)    | Yes (structured)        | Not a URL source; this lane owns the connector, not the fetcher                                | DOCUMENTED          |

**Common shape of every gap above:** ingestion already does the *hard* part — provenance, authority, deterministic normalization, and uncertainty on missing data. It just does not yet do the *easy but security-sensitive* part of turning `uri` into `content`.

## 2. Generic URL ingestion pipeline (proposed, provider-neutral)

Five steps, all front of the existing `SourceIngestionCapability`:

```
[1] URL input         ── SourceInput { kind: WEBPAGE, uri, title? }
        │
[2] Safe fetch        ── fetch service (timeout, size cap, SSRF guard, redirect cap,
        │                  UA, content-type validation, no script execution)
        │
[3] Content-type route
        │  ── text/html            → readability extract → text/markdown
        │  ── application/pdf      → text extractor (pdf-parse or pdfjs-dist)
        │  ── text/plain           → utf-8 normalize
        │  ── application/json     → schema-probe or pass to structured path
        │  ── image/*              → record metadata only, emit UNAVAILABLE w/ reason
        │  ── anything else        → record content-type, emit UNAVAILABLE w/ reason
        │
[4] HTML sanitization  ── DOMPurify or readability-with-strip:
        │   - drop <script>, <style>, on*, javascript: URLs
        │   - keep <title>, <meta name=description>, <h1..h6>, <p>, <li>, <time>, <a href>
        │   - preserve anchor text & hrefs as structured hint for extractor
        │
[5] Existing pipeline ── SourceInput { kind, uri, title, content } → SourceIngestionCapability.ingest()
       (unchanged: materialize → EXTRACTION_TASKS_BY_KIND[kind] → SemanticExtractionClient → normalize)
```

Properties preserved from the existing contract:
- **Determinism / idempotency**: `materializeSource` already hashes `(kind, uri, title, content)` into `SourceRecord.id` (`src/ingest/source.ts:116`), so re-fetching the same URL is idempotent *as long as content is byte-stable*; otherwise a new source record is created on each fetch and downstream duplicate-detection handles it.
- **Authority**: `WEBPAGE` → `ASSERTED` (`src/ingest/source.ts:42`) — fetch provenance never escalates to `AUTHORITATIVE`.
- **Uncertainty, not fabrication**: empty/blocked fetches are returned as `IngestionOutcome` with no proposals and a `MEDIUM/HIGH` uncertainty record (already supported by `pipeline.ts:236`).
- **No direct trip-state writes**: the new layer emits *only* the existing `SourceInput`; the existing `SourceIngestionCapability` enforces FR-02/FR-04 invariants.

The fetcher is **provider-neutral**: the rest of the system sees only a text `content` plus a recorded `SourceRecord.uri` and a fetch `content-type` snapshot in `notes`. No site-specific parsers are introduced (and the existing anti-hardcoding test at `test/ingestion.test.ts:692` still passes).

## 3. Security controls (concrete, MVP-grade)

Every control below is a single decision that the fetch service must own. None require new schemas.

| # | Threat / concern               | Control                                                                                       | Implementation anchor (proposed)              |
|---|--------------------------------|-----------------------------------------------------------------------------------------------|-----------------------------------------------|
| 1 | SSRF: loopback                 | Resolve host *before* connecting; reject if any A/AAAA in `127.0.0.0/8`, `::1/128`            | `dns.lookup` + ipaddr CIDR check              |
| 2 | SSRF: private / link-local     | Reject `10.0.0.0/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10` (CGNAT), `fc00::/7`, `fe80::/10` | Same check, deny-list first                    |
| 3 | SSRF: DNS rebinding            | Pin IP after `dns.lookup`, then connect by IP with `Host:` header set to the original hostname; re-resolve on every redirect (control #4) | `lookup` then `http.request({ lookup })`      |
| 4 | SSRF via redirect              | `redirect: 'manual'`, allow at most 3 hops, re-validate URL on every hop (URL+IP)              | `fetch(..., { redirect: 'manual' })`         |
| 5 | File-size / memory DoS         | Hard cap 5 MB; stream-accumulate and abort above cap; reject `Content-Length > cap`           | streaming body + `AbortController`           |
| 6 | Slowloris / timeouts           | Connect timeout 5 s; total timeout 12 s; `AbortSignal.timeout()`                              | `AbortSignal.timeout(12_000)`                |
| 7 | Content-type smuggling         | Reject if `Content-Type` is missing or is `text/html` with `Content-Disposition: attachment`; whitelist `text/html`, `text/plain`, `application/pdf`, `application/json`, `application/xml` | header check before body read                  |
| 8 | Charset confusion              | Require explicit `charset=` or assume `utf-8`; decode via `TextDecoder('utf-8', { fatal: true })` | post-fetch decoder                            |
| 9 | HTML/JS in LLM context         | Sanitize *before* any text is handed to the extractor: strip `<script>`, `<style>`, `on*=` attrs, `javascript:`/`data:` URLs, `<iframe>` | DOMPurify (server-side)                      |
|10 | Robots / legal                 | Fetch and parse `robots.txt` once per origin (cached 1 h); respect `Disallow:` for the configured UA; never bypass; log allow/deny outcome on the source record | light-weight robots parser                    |
|11 | UA / identification            | Single, versioned `User-Agent` string; include a contact URL/email for takedown               | static constant                               |
|12 | Cookies / session              | `credentials: 'omit'`, `Cookie:` header never sent, no cookie jar                              | fetch option                                 |
|13 | Rate limiting                  | Per-host token bucket (e.g. 1 req/s sustained, burst 4) to keep Atlas polite                 | in-memory LRU per host                        |
|14 | Network egress                 | Allow-list of egress destinations at the deployment boundary (cloud sandbox / prod)           | infra config; not a code change               |
|15 | Audit trail                    | Every fetch writes `(sourceId, url, ip, status, contentType, bytes, durationMs, blockedReason?)` to the existing audit repository via the standard `AuditRepository.append` (`src/contracts/repositories.ts:122`) | hook from fetch service                       |
|16 | NO JS execution                | `fetch` is the *only* network primitive. **No headless browser in MVP** (see §4)               | architectural commitment                       |

## 4. Headless browser: necessary for MVP?

**Empirical evidence (5 live fetches, all read-only, ≤ 12 s timeout, with probe UA):**

| URL                                                                          | HTTP | content-type                  | visible text chars after naive strip | human-relevant data present?                                  | Label               |
|------------------------------------------------------------------------------|------|-------------------------------|--------------------------------------|----------------------------------------------------------------|---------------------|
| `https://en.wikipedia.org/wiki/Schengen_Area`                                | 200  | `text/html; charset=UTF-8`    | 202,242                              | yes — "Schengen", "90 days", "passport", "visa", "European Union" all found | OBSERVED_LIVE_READ  |
| `https://www.iana.org/_js/2017.1/jquery.min.js` (sanity, JS asset)            | 301  | `text/html; charset=iso-8859-1` | n/a (redirect)                       | n/a                                                            | OBSERVED_LIVE_READ  |
| `https://events.linuxfoundation.org/open-source-summit-japan/program/schedule/` (followed to `chisel-community-conference`) | 200 | `text/html; charset=UTF-8`     | 17,955                              | partial — boilerplate marketing text, no "September 14 / 10:00 / Main Hall" specifics (schedule grid is client-rendered) | OBSERVED_LIVE_READ  |
| `https://www.ihg.com/hotels/us/en/find-hotels/hotel/details?...`             | 403  | `text/html` (Akamai 432 B)    | 432                                  | no — Akamai bot block; JS-rendered widget in the legitimate path | OBSERVED_LIVE_READ  |
| `https://www.iana.org/` and a 13 KB public PDF (`https://www.w3.org/.../dummy.pdf`) | 200  | `application/pdf; qs=0.001`, `text/html` | 13,264 bytes binary (PDF v1.4, 1 page) | PDF detected as `application/pdf` — extraction not attempted by `fetch` itself | OBSERVED_LIVE_READ  |

**Decision: no headless browser in MVP.**

Reasoning:
1. **Wikipedia-class static HTML works trivially** with plain `fetch` + a readability extractor. That covers entry/visa facts, anchor-event programme pages served as static HTML, generic policy landing pages, and most blog/research notes.
2. **JS-heavy booking flows (IHG observed, conference agenda observed)** are either (a) bot-blocked at the edge (no browser is going to fix that without a real auth flow), or (b) server-rendered HTML already contains enough boilerplate to confidently mark the source `UNAVAILABLE` with a reason. Forcing a headless browser here buys nothing for the user — it would *reliably* spend 30+ seconds, return marginal text, and require a service-side Chromium footprint that isn't justifiable for a 3-day evaluation.
3. **Provider booking confirmations** are *not* fetched from the public web anyway: the `BOOKING_CONFIRMATION` lane is intended to receive either structured data (from the provider connector) or text the user pastes. URL fetching is irrelevant for them.
4. **Cost of a headless browser** in this sandbox is a Chromium runtime + per-page 5–30 s + a vector for accidental data exfiltration (browser caches, font loads, third-party trackers) — directly hostile to controls #12 and #14 above.

**Fallback design when plain `fetch` returns nothing useful:**
- After readability extraction, if `extractedText.length < 200` *or* the page is dominated by nav/cookie banners, the fetch service does **not** retry with a browser. It returns a `SourceRecord` with `notes: "JS_RENDERED_OR_BLOCKED"` and a fetch metadata `UNAVAILABLE` outcome. The caller (UI or planner) can then either (a) request the user to paste a text version, (b) hand a structured payload, or (c) drop the source. This is honest: it is recorded as a missing source, never silently replaced by a hallucination.
- An **optional, opt-in** headless adapter (Puppeteer/Playwright behind a capability interface) is left for a later milestone, gated by the same `SourceInput` contract. The MVP pipeline is browser-free.

## 5. Architecture deltas (proposal only)

Ordered by criticality. No schemas change beyond the items below; the existing `SourceInput`/`SourceRecord`/`IngestionOutcome` contracts are untouched.

1. **New `SourceInput.kind` value — *not* needed.** Reuse `WEBPAGE` (already in `SourceKindSchema`, `src/domain/common.ts:74`). URL fetching is an acquisition detail, not a semantic class.

2. **New service interface — `SourceFetchService`** (in `src/ingest/`, lane B):
   - `fetchWebSource(input: { uri, title?, kind }): Promise<{ content: string; contentType: string; bytes: number; notes?: string; }>`
   - Single implementation shipped: `HttpFetchService` (Node `fetch` + the controls in §3). An `UnavailableFetchService` returns `notes: 'FETCH_DISABLED'` for offline / REPLAY modes — mirrors the existing `RecordedExtractionClient` pattern (`src/ingest/semantic.ts:219`).

3. **New content-type registry** — small, explicit:
   - `text/html` → `ReadabilityExtractor` (Mozilla Readability port or `@mozilla/readability` + `linkedom`/`jsdom` for parsing only — no execution)
   - `application/pdf` → `PdfTextExtractor` (`pdf-parse` or `pdfjs-dist` legacy build, Node-compatible)
   - `text/plain` → passthrough (utf-8 normalize)
   - `application/json` → passthrough to the structured path (already supported)
   - `image/*`, `video/*`, `application/octet-stream` → `UNAVAILABLE` with reason

4. **HTML sanitization seam** — extractors receive *sanitized* HTML/markdown, never raw fetched bytes. DOMPurify is the obvious choice; it is server-safe, well-audited, and zero-JS.

5. **Fetch metadata on the `SourceRecord`** — extend `SourceRecordSchema.notes` (already optional at `src/domain/common.ts:96`) to carry a short JSON fragment like `{"fetch":{"ct":"text/html; charset=utf-8","bytes":18317,"ip":"...","status":200,"robots":"allowed","durationMs":412}}`. This is the auditable record of where the content came from. `retrievedAt` already exists.

6. **Wiring** — `createSourceIngestionCapability` already accepts `IngestionDependencies`. Add a single optional `fetchService?: SourceFetchService` dependency. **No public seam change**; existing REPLAY tests stay green.

7. **Robots / UA policy** — single new config block in `AppConfig` (`src/config/config.ts`): `userAgent`, `maxBytesPerSource`, `maxRedirects`, `perHostQps`, `respectRobots`. Defaults are safe (UA identifies the project, 5 MB cap, 3 redirects, 1 qps, robots respected).

8. **Rate-limiting & audit** — reuse the existing `AuditRepository` (`src/contracts/repositories.ts:122`) to write one `fetch_attempted` / `fetch_succeeded` / `fetch_blocked` entry per call. The provenance story for ingestion already uses this pattern; URL acquisition fits naturally.

9. **Optional, deferred — JS-rendered adapter.** A `PlaywrightFetchService` implementing the same `SourceFetchService` interface, gated on `ADAPTER_MODE=LIVE` and a separate `ENABLE_HEADLESS_FETCH=1` env. *Not in MVP.*

## 6. Findings (triaged)

| ID  | Finding                                                                                                                              | Severity | Disposition                                              |
|-----|--------------------------------------------------------------------------------------------------------------------------------------|----------|----------------------------------------------------------|
| F-1 | Ingestion has no URL acquisition layer at all.                                                                                        | HIGH     | Add `SourceFetchService` per §5 #2                        |
| F-2 | URL field on `SourceInput` is purely provenance; not used to populate `content`.                                                     | HIGH     | Wire `SourceFetchService` into the pipeline's pre-step   |
| F-3 | No MIME / content-type awareness; a binary blob passed as `content` would currently become garbage text the LLM has to swallow.     | HIGH     | Add content-type registry per §5 #3                      |
| F-4 | No HTML sanitization before model extraction. A `<script>` block or `onerror=` attr could be passed to the extractor verbatim.      | HIGH     | Add sanitization seam per §5 #4                          |
| F-5 | No SSRF protection today — but no fetcher exists yet, so this is a *latent* risk. Adding a fetcher without controls would expose it. | HIGH     | Apply controls 1–4, 12, 14 in §3                         |
| F-6 | No `Content-Length` / `bytes` cap; large responses would exhaust memory if the fetcher is added naively.                              | MEDIUM   | Cap at 5 MB; abort above (§3 #5)                          |
| F-7 | `WEBPAGE` semantic tasks are limited to `ANCHOR_EVENT`; a policy-page URL would be misrouted.                                          | MEDIUM   | Allow caller to override the task hint via `IngestionDependencies.task` (already supported, `src/ingest/pipeline.ts:69`) |
| F-8 | No robots.txt respect; no UA identification.                                                                                          | MEDIUM   | Single versioned UA + robots parser + cache (§3 #10, #11) |
| F-9 | No per-host rate limiting; could hammer Wikipedia.                                                                                    | MEDIUM   | In-memory token bucket per host (§3 #13)                  |
| F-10 | No fetch audit trail beyond the `SourceRecord.notes` field.                                                                            | LOW     | One line of `AuditRepository.append` per fetch (§5 #8)    |
| F-11 | JS-heavy booking sites are out of reach (IHG, LF agenda) — *acceptable* per §4, but the failure must be **loud**.                     | LOW     | Return `UNAVAILABLE` w/ `notes: 'JS_RENDERED_OR_BLOCKED'`; do not retry with browser in MVP |
| F-12 | `SourceRecord.contentRef` already exists but is unused; raw fetched bytes should be persisted there, not in memory.                    | MEDIUM   | Wire `SourceRepository.saveSourceContent` (already implemented in `src/contracts/repositories.ts:43`) |

## 7. Probe & evidence appendix

All probes used `User-Agent: qoder-rv-probe/0.1`, `curl --max-time 12`, followed redirects by default unless noted. Probes were read-only and unauthenticated.

| URL                                                                                                       | Headers observed (key fields)                                                                                  | Body observation                                                                                                  | Label               |
|-----------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|---------------------|
| `https://en.wikipedia.org/wiki/Schengen_Area`                                                              | HTTP/2 200, `content-type: text/html; charset=UTF-8`, `server: mw-web.eqiad.main-…`, strict CSP                 | 1,820,289 bytes; visible text 202,242 chars; all 6 expected keywords found                                       | OBSERVED_LIVE_READ  |
| `https://events.linuxfoundation.org/open-source-summit-japan/program/schedule/` (followed to `…/chisel-community-conference/…`) | 301 → 200, `server: cloudflare`, `x-redirect-by: WordPress`                                                    | 198,704 bytes; visible text 17,955 chars; **schedule grid (time/room/session names) is client-rendered**          | OBSERVED_LIVE_READ  |
| `https://www.ihg.com/hotels/us/en/find-hotels/hotel/details?…`                                            | HTTP/2 403, `content-type: text/html`, `set-cookie: akamaiCountryCode=SG` (Akamai edge block)                  | 432 bytes, "Access Denied" page — no booking content reachable from a `fetch`                                     | OBSERVED_LIVE_READ  |
| `https://www.ihg.com/robots.txt`                                                                           | HTTP/2 403 (same Akamai block)                                                                                 | Robots not retrievable in this probe — would be unreadable even by a browser                                      | OBSERVED_LIVE_READ  |
| `https://en.wikipedia.org/robots.txt`                                                                      | HTTP/2 200, `content-type: text/plain`                                                                          | Robots present; `MJ12bot: Disallow: /`; per-bot rules parse cleanly                                                | OBSERVED_LIVE_READ  |
| `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`                                  | HTTP/2 200, `content-type: application/pdf; qs=0.001`, `content-length: 13264`                                  | 13,264 bytes PDF v1.4, 1 page — confirms `application/pdf` content-type registry path is needed                   | OBSERVED_LIVE_READ  |

**Inferred (not probed, by design):** the existing anti-hardcoding test (`test/ingestion.test.ts:692`) is the cheap regression net for any site-specific drift introduced by a future extractor.

## 8. What this lane does NOT do (scope boundary)

- **No** URL-ingestion code is written in this commit.
- **No** schema migrations; `SourceKindSchema`, `SourceInput`, `SourceRecord` are unchanged.
- **No** headless browser in MVP; see §4.
- **No** site-specific parsers (explicitly forbidden by the lane brief and re-enforced by the existing anti-hardcoding test).
- **No** changes to the semantic/normalization layer — that half of the lane is already correct and well-tested (`test/ingestion.test.ts:742`).
