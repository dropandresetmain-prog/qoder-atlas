# 06 — Dynamic Context and Research Investigation

> Reality Validation milestone, investigation area #6 ("Dynamic context/research").
> RESEARCH ONLY. No product implementation. Findings inform the Adopt/Defer/Reject
> gate; this file does not authorize integration.

Branch: `rv/context-investigation` (based on `6d20396`).
Scope: realistic external context sources for the two scenario families the
product must run end-to-end (event organiser / invited speaker around a Singapore
conference; corporate TMC). For each source kind, the right ingestion channel,
authority class, freshness plan, and the resulting decision.

Evidence labels used below: `DOCUMENTED` (in-repo doc/spec/code),
`OBSERVED_LIVE_READ` (we fetched a representative public page), `INFERRED`
(reasonable from named mechanisms), `UNKNOWN` (not investigated in this pass).

## Executive summary

The engine already separates **legal/entry facts** (must be AUTHORITATIVE, ADR-015)
from **operational estimates** (sourced, with uncertainty; `src/intelligence/research.ts`,
`toResearchFindings`, `interpretResearchFindings`). That seam is the
authoritative-vs-estimate gate. We are not re-litigating that boundary; this
investigation picks the **right channel** for each source kind the two scenarios
need and decides which channels are worth touching at all.

Bottom line:
- **Immigration/entry** — for the Singapore scenario, legal facts must come from
  an authoritative source. No public-HTML ICA page reliably covers the
  visa-free / visa-required / in-transit matrix per nationality in a machine-
  parseable shape, and the dedicated 404 we observed is consistent with
  brittle government URL layouts (`OBSERVED_LIVE_READ` ICA page returned 404
  for the guessed path). Recommend a **curated authoritative dataset** as the
  authoritative channel for MVP, with `ModelStudioResearchSource` reserved
  strictly for operational estimates and uncertainty-bearing findings.
  Timatic commercial stays Deferred (already in ROADMAP).
- **Event programme / venue** — public HTML works as a deterministic URL
  ingestion target. The fixture shape (`AnchorEvent.sourceIds` referencing a
  `WEBPAGE` source) already supports this; no contract change.
- **Supplier / hotel / transport policies** — these are almost always PDF/email
  attachments that arrive with a confirmation. Ingestion is document upload
  (`POLICY_DOCUMENT` / `DOCUMENT` SourceKind) parsed by the structured
  ingestion lane. The model-outputs fixture and the anchor-event
  `rs_a_hotel_policy` already show the structure.
- **Company travel policy / insurance** — same channel: document upload, then
  deterministic mapper (or model extraction if unstructured). These never
  become authoritative via web research.
- **Model Studio web research** — useful for operational context (immigration
  processing time, terminal transfer time, local advisories) where uncertainty
  is acceptable. It must not be the source of any LEGAL_ENTRY_FACT under the
  fact authority ladder. The existing
  `interpretResearchFindings` rule already enforces this; we propose no
  contract change, only a hardening of the research system prompt to be even
  more explicit that ICA-equivalent authoritative sources are the only legal
  path (see Architecture deltas).

## Context-source matrix

| Source kind | Typical channel | Authority class | Freshness plan | Decision |
|---|---|---|---|---|
| Event programme / agenda | Public HTML (URL ingestion) | CONNECTED (organiser page) | Re-fetch on signal; cache by URL+hash | Adopt: deterministic URL fetch into existing `WEBPAGE` SourceKind; existing ingestion lane extracts structured elements/objectives. No contract change. |
| Venue info (place, timezone, opening hours) | Public HTML + bundled dataset | CONNECTED, ASSERTED for bundled place facts | Bundled place data is durable; webpage is volatile | Adopt: place/timezone continue to come from authoritative bundled dataset; webpage adds operating hours. No new channel. |
| Supplier (airline) policy | Carrier HTML + booking-confirmation cross-ref | CONNECTED, with AUTHORITATIVE upgrade once the confirmation lands | Re-fetch on fare-class or schedule change | Adopt as-is: carrier pages are best-effort, confirmation carries the live rules. Already in the engine. |
| Hotel policy (cancellation, no-show, late arrival) | PDF/email attachment from booking confirmation | AUTHORITATIVE (per `src_a_hotel_confirmation` in anchor fixture) | Refresh on each new booking; old rules are historical evidence | Adopt: document upload via `SourceIngestionCapability.ingest` with `kind: 'POLICY_DOCUMENT'` or `'BOOKING_CONFIRMATION'`. No change. |
| Transport supplier policy (rail, ferry, transfer) | PDF/email | CONNECTED | Refresh on supplier signal | Adopt as-is; no new code. |
| Company travel policy | PDF/email upload by employer/TMC | AUTHORITATIVE for the governed organisation | Manual refresh on policy revision | Adopt: `kind: 'POLICY_DOCUMENT'`. No code change. The corporate-TMC fixture already models this with `src_b_corporate_policy` -> `rs_b_corporate_policy`. |
| Insurance policy | PDF/email upload by traveller/employer | AUTHORITATIVE (per fixture `src_a_insurance_policy`) | Refresh on policy renewal | Adopt: `kind: 'INSURANCE_DOCUMENT'`. No code change. FR-18 already requires this. |
| Immigration / entry rules — **legal facts** | Authoritative dataset (curated) or Timatic-commercial-deferred | AUTHORITATIVE only | Quarterly review of source; on-demand re-pull for new nationalities | Adopt **curated authoritative dataset** (single bundled JSON keyed by destination-country-code + nationality) for MVP; **defer Timatic** (already in ROADMAP). |
| Immigration / entry rules — **operational estimates** (processing time, peak queues) | `ModelStudioResearchSource` (web research) | OPERATIONAL_ESTIMATE only | Per-query, with `uncertainty` populated | Adopt: already the contract's intent. No code change. |
| Local operating context (transit advisories, venue changes, strikes) | `ModelStudioResearchSource` | OPERATIONAL_ESTIMATE | Per-query | Adopt as-is. |
| Latent traveller preferences | Profile import + LLM inference | ASSERTED, INFERRED | Refresh on profile update | Already implemented. |

## Immigration / entry section (authoritative vs estimate)

ADR-015: "Authoritative sources underpin legal/entry facts. Agentic web research
may produce sourced operational immigration-time estimates with uncertainty;
estimates are not legal certainty." (`docs/DECISIONS.md` ADR-015,
`DOCUMENTED`).

The contract enforces this in
`src/intelligence/research.ts:interpretResearchFindings` / `toResearchFindings`
(DOCUMENTED): a `LEGAL_ENTRY_FACT` is accepted only with `authorityClaim =
AUTHORITATIVE` plus at least one source URI; otherwise it is downgraded to
`INFERRED` with the rejection reason attached as `uncertainty` and never
re-promoted. This is the right gate and we are not proposing to weaken it.

What we investigated: which **authoritative channels** realistically exist for
Singapore-relevant entry rules that we could ingest without a Timatic contract.

### Candidate authoritative sources for Singapore entry

| Source | Access shape | Authority class | Verdict |
|---|---|---|---|
| `ica.gov.sg` (Immigration & Checkpoints Authority) public pages | Public HTML, but URL layout is brittle (e.g. the obvious path `https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa-and-entry-requirements` returned 404 on a live read) | AUTHORITATIVE | **Reject** as the runtime authoritative channel: too brittle to be a stable machine target. Acceptable as a **curation reference** for the dataset. (`OBSERVED_LIVE_READ` 404, `INFERRED` brittleness.) |
| Singapore MFA / Ministry of Manpower / SafeTravel pages | Public HTML | AUTHORITATIVE | Same verdict: curate, do not ingest directly. |
| `iatatravelcentre.com` (IATA Travel Centre, derived from Timatic for consumers) | Public HTML, but a consumer derivative | CONNECTED (derived) | Reject as authoritative; keep as cross-check. |
| IATA Timatic commercial (Web Services / AutoCheck) | Commercial API / contract | AUTHORITATIVE | **Defer** — already on the ROADMAP deferred list, and we have no contract within the hackathon. |
| **Curated authoritative dataset bundled with the app** (JSON keyed by `(destinationCountry, nationality)` -> `{required: 'visa'|'evisa'|'visaFree'|'notAdmitted' | 'unknown', sourceUri, validFrom, validUntil, notes}`) | Bundled in repo (e.g. `fixtures/authoritative/entry-rules.json`) | AUTHORITATIVE for the curated rows; UNKNOWN otherwise | **Adopt** for MVP. The dataset is small (a few hundred rows max for the demo scope), auditable, and can be edited by hand. We do not need a Timatic contract to demonstrate the gate. |
| `MCP` travel / Timatic MCP server if a hackathon vendor provides one | API | AUTHORITATIVE | Park: depends on hackathon vendor. |

Concrete candidate fields for the bundled dataset row (Singapore example):
- `destinationCountry: 'SG'`
- `nationality: 'USA'` -> `{required: 'visaFree', maxStayDays: 90, sourceUri: 'https://www.ica.gov.sg/...', validFrom: '...', validUntil: '...'}`
- `nationality: 'IND'` -> `{required: 'evisa', sourceUri: 'https://www.ica.gov.sg/...'}`
- `nationality: 'MYS'` -> `{required: 'visaFree', maxStayDays: 30, sourceUri: 'https://www.ica.gov.sg/...'}`
- `transit: {required: 'visaFree', conditions: 'stay in transit area, <24h, same airline alliance'}`

The bundled dataset lives in `fixtures/` and is loaded by the same
`SourceIngestionCapability.ingest` path that already accepts `kind: 'WEBPAGE'`
or `kind: 'DOCUMENT'`; treat it as `kind: 'PROVIDER_STATE'` with `authority:
AUTHORITATIVE`. This is the smallest change that satisfies ADR-015 without
introducing a new contract.

### Operational immigration timing (model-studio web research)

- Immigration hall processing time at the destination airport: OPERATIONAL_ESTIMATE.
- Peak queue advisories (e.g. school-holiday weekend): OPERATIONAL_ESTIMATE.
- "How long before keynote should I leave the airport" — composite operational
  estimate: keep as OPERATIONAL_ESTIMATE and surface as a `DurationEstimate` per
  ARCHITECTURE.md §7.

These must keep `uncertainty` populated. The current schema already requires
`uncertainty` for `OPERATIONAL_ESTIMATE` and rejects findings that have neither
`sourceUris` nor `uncertainty` (see `toResearchFindings` and the
`research-entry-findings.json` fixture: every estimate has either a URI or an
explicit uncertainty string). No code change needed; we recommend documenting
this in the prompt to keep pressure-tested behaviour.

### Reject list (legal/entry, runtime)

- "Wikipedia summary" / "travel blog" as the only source for a `LEGAL_ENTRY_FACT`
  -> the system must reject this at the research seam (already does).
- "Visa-vendor commercial site" -> reject: they are commercial intermediaries
  and not authoritative.

## Event / venue context section

The anchor-event-speaker scenario already models an event programme as a
`WEBPAGE` source (`src_a_event_page`) with `CONNECTED` authority. The
investigation confirms this is the right shape for both the conference
programme and the venue info:

- **Conference programme / agenda** — public HTML, deterministic URL fetch.
  Existing `WEBPAGE` SourceKind and `SourceIngestionCapability.ingest` cover
  this. The fixture bundles an `event-page.md` markdown content ref; the
  ingestion lane runs the same extraction whether the content came from a URL
  fetch or an offline file. We recommend making the URL fetch optional and
  opt-in per source (LIVE/RECORD/REPLAY posture already mandates this for
  providers; same posture should apply to non-provider web pages).
- **Venue info (place, address, opening hours, transit access)** — best split
  into a **bundled place record** (Place, durable: name, IANA timezone,
  externalRefs) plus a **per-event webpage overlay** (session rooms, doors,
  check-in desk hours). Bundled place is AUTHORITATIVE for the engine; the
  overlay is CONNECTED. No contract change.
- **Anchor event organiser instructions** — already in the fixture as
  `anchorEvents[0].instructions` with `sourceId: src_a_event_page` and
  authority CONNECTED. Same channel; no change.

For the corporate-TMC scenario there is no AnchorEvent, so none of this
applies. The corporate scenario is fed by `client-invite` EMAIL (`EMAIL`
SourceKind) — already in the fixture; no change.

## Policy / insurance section

Both are documents, not web pages:

- **Hotel supplier policy** — arrives as part of the booking confirmation
  (email or PDF). Fixture models this as `BOOKING_CONFIRMATION` SourceKind
  (see `src_a_hotel_confirmation` -> `rs_a_hotel_policy`). Cancellation
  deadline, no-show cutoff, late-arrival support: extract from the document.
  Already exercised in the anchor fixture.
- **Company travel policy** — arrives as a PDF/DOCX uploaded by the
  employer/TMC admin. `POLICY_DOCUMENT` SourceKind. Fixture
  `src_b_corporate_policy` -> `rs_b_corporate_policy` shows spend limit,
  approval requirement, and an "OTHER" rule for cabin. Realistic extraction:
  spend ceilings, approval thresholds, advance-purchase requirements,
  preferred-carrier class, permissible booking classes. The current
  `rule.kind` vocabulary is small but the model is "structured rules with
  provenance"; lanes extract whatever structured predicates the document
  contains, attaching `sourceId` for audit.
- **Insurance policy** — same channel. `INSURANCE_DOCUMENT` SourceKind.
  Fixture `src_a_insurance_policy` -> `rs_a_insurance` with a single
  `INSURANCE_COVERAGE` rule (covered reasons, excess, max payout). Realistic
  extraction: covered reasons, exclusions, excess, payout limits, time-bar
  (must file within X days), evidence requirements. Claims automation is
  non-goal for MVP (ROADMAP Deferred).

**Recommendation:** keep document upload as the only channel. Web-fetching
the company policy from a corporate intranet is out of scope; we treat the
uploaded PDF as the authoritative artefact the engine reasons over.

## Model Studio web research applicability + limits

`src/intelligence/research.ts` already implements a `ResearchSource` seam with
two backends: `ModelStudioResearchSource` (LIVE/RECORD on a Model Studio chat
completions surface with a strict `RawResearchFindingsModelSchema`) and
`ScriptedResearchSource` (REPLAY). The seam is provider-neutral — any
sourced-web-research backend that returns schema-validated findings can plug
in (DOCUMENTED).

**Applicable uses for Model Studio web research (adopt now):**
- Operational immigration processing estimates (e.g. "SIN immigration at 17:00
  on a Sunday is usually 20–40 minutes").
- Local route / transit advisories (e.g. "Changi Skytrain shutdown between
  T2 and T3 on 2026-09-13 from 02:00–04:00").
- Weather, strikes, public holidays, large event-induced congestion near the
  venue.
- Border wait advisories that are operational rather than legal.

**Not applicable (must not be the source):**
- Any `LEGAL_ENTRY_FACT` — visa-free / visa-required / eVisa requirements,
  passport validity rules, transit-visa requirements, admission/refusal
  grounds. These are governed by ICA-equivalent authoritative sources and
  Timatic; agentic web research is not authoritative.
- Authoritative company policy, hotel policy, or insurance policy text.
- Authoritative event-programme structural facts (times, rooms) where the
  organiser page is reachable.

**Limits:**
- Findings are model claims; they are accepted only when they satisfy the
  research schema and pass `interpretResearchFindings`. The schema is enforced
  by Zod (`RawResearchFindingsModelSchema`). Findings that pass schema
  validation but lack authority on a legal claim are downgraded, not
  promoted. The seam never silently treats a model claim as a legal fact.
- The current implementation does not provide a tool-invoking "search the web"
  function — the chat-completions surface returns findings the model has
  in-context. For higher-quality web research a future `WebSearchResearchSource`
  (e.g. a Model Studio surface with enabled web search, or a future research
  provider) can implement the same `ResearchSource` interface. Posture is
  unchanged: same seam, same schema, same acceptance rules.

## Architecture deltas (propose only)

We propose **no contract changes**. The seams are sufficient. The investigation
resulting list of small, optional hardening actions:

1. **Hardening: research system prompt (no contract change).** Make the
   `ENTRY_RESEARCH_SYSTEM_PROMPT` and `LOCAL_CONTEXT_RESEARCH_SYSTEM_PROMPT`
   (in `src/intelligence/research.ts`) explicitly say that the only legal-fact
   sources acceptable are the curated authoritative dataset or
   ICA-equivalent government pages cited with the source URI, and that the
   model must not produce a `LEGAL_ENTRY_FACT` from a consumer/derivative
   source. This is a one-paragraph tightening of an existing constant; no
   interface changes.
2. **Authoritative dataset location.** If the MVP adopts the curated
   authoritative dataset (recommended), place it at
   `fixtures/authoritative/entry-rules.json` and load it as a
   `SourceRecord` with `kind: 'PROVIDER_STATE'`, `authority: 'AUTHORITATIVE'`,
   `retrievedAt: <bundled build date>`. Ingestion is a single fixture
   addition; no `ResearchCapability` change.
3. **Per-source URL fetch posture (no contract change).** Document (not
   encode) the LIVE/RECORD/REPLAY posture for `WEBPAGE` SourceKind ingestion
   the same way the Atlas adapter documents it. The seam already supports
   plugging a fetcher in front of `SourceIngestionCapability.ingest`.
4. **Park:** nothing in the post-acceptance contract surface needs to change
   for dynamic context. Planners continue to use `ToolRequest.operation =
   'research.entry_requirements' | 'research.local_context'` (ADR-024
   closed vocabulary, `DOCUMENTED`), and the resulting findings flow
   through `interpretResearchFindings` and `toResearchFindings` unchanged.

## Findings triaged

### Act Now

- **Adopt curated authoritative dataset for Singapore entry rules.** Lives at
  `fixtures/authoritative/entry-rules.json`, ingested as a `PROVIDER_STATE`
  source. Satisfies ADR-015 with no contract change and no third-party
  commercial dependency. Small, auditable, hand-editable. The data only has
  to cover the nationalities in the demo scope.
- **Tighten the research system prompt** in `src/intelligence/research.ts`
  to forbid `LEGAL_ENTRY_FACT` from consumer/derivative sources. Same-file
  change; no contract.

### Investigate Now

- **Per-source URL fetch in REPLAY mode.** Confirm the existing
  `SourceIngestionCapability.ingest` accepts a `SourceInput` whose `uri` is
  recorded but whose `content` is supplied from disk; that is already what
  the fixtures do (`contentRef` -> markdown sidecar). If a fetcher is added,
  it must be REPLAY-default and LIVE-only when explicitly configured.
- **Singapore-route coverage in Atlas sandbox.** Already an active
  investigation in the ROADMAP ("Atlas Singapore sandbox routes —
  Investigate Now"). This file does not change that decision.

### Park for Later

- **Timatic commercial integration.** Already ROADMAP Deferred; revisit
  post-hackathon. The curated dataset is the MVP stand-in.
- **MCP-based travel / Timatic MCP if a vendor offers it during the
  hackathon.** Park: only adopt if a ready-to-use MCP server appears and
  satisfies ADR-015's authoritative gate.
- **Generic "live" `WEBPAGE` fetcher with caching.** Park behind the
  URL-fetch posture decision; the current `WEBPAGE` flow with
  manually-curated contentRefs proves the seam.
- **Expanded `INSURANCE_DOCUMENT` rule vocabulary** (time-bar, evidence
  list, exclusions). FR-18 only requires one policy ingested; richer
  vocabulary can wait.

### Ignore / Accept Risk

- **Brittle government URL layouts** (e.g. the 404 we observed on a guessed
  ICA path). Acceptable: we are not fetching government pages at runtime;
  we curate them. The risk is editorial, not operational.
- **Operational immigration timing variability.** The engine already
  surfaces `OPERATIONAL_ESTIMATE` with `uncertainty` and the
  `DurationEstimate` envelope from ARCHITECTURE.md §7. Remaining
  variability is communicated to the operator and traveller as
  uncertainty, not silently rounded.
- **Hotel policy / corporate policy documents in non-text formats
  (scanned PDFs).** Out of scope for MVP: documents are expected to be
  text or text-extractable. Scanned-PDF OCR is a stretch item, not
  parked here.

## Appendix — what we observed live

- `https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa-and-entry-requirements`
  -> **404** (`OBSERVED_LIVE_READ`). Confirms the brittleness of guessing ICA
  URL paths; reinforces the curated-dataset decision.
- `https://www.booking.com/articles/cancellation-policies.html` -> **200**
  but renders as a footer-heavy marketing/portal page in our read, not a
  machine-parseable policy page (`OBSERVED_LIVE_READ`). Reinforces that
  real hotel policy arrives as the booking confirmation, not from a
  vendor's help-centre URL.
- The fixture `test/fixtures/model-outputs/research-entry-findings.json`
  already demonstrates the contract: an `AUTHORITATIVE` legal claim with a
  source URI is accepted; an `ASSERTED` legal claim with no URI is
  downgraded; operational estimates carry either a URI or an explicit
  `uncertainty` string (`DOCUMENTED`).

## Pointer cross-references

- `src/contracts/capabilities.ts` — `ResearchCapability` and
  `ResearchFinding` shapes (DOCUMENTED).
- `src/intelligence/research.ts` — `ResearchService`,
  `ModelStudioResearchSource`, `ScriptedResearchSource`,
  `toResearchFindings`, research system prompts (DOCUMENTED).
- `docs/PRODUCT_SPEC.md` — FR-16/FR-17/FR-18 dynamic context list (DOCUMENTED).
- `docs/ARCHITECTURE.md` §7 — `DurationEstimate`, sourced operational
  estimates, AUTHORITATIVE legal facts (DOCUMENTED).
- `docs/DECISIONS.md` ADR-015 — sourced entry/immigration context
  (DOCUMENTED).
- `docs/ROADMAP.md` — Timatic Deferred, Atlas Singapore Investigate Now
  (DOCUMENTED).
- `fixtures/scenarios/anchor-event-speaker/scenario.json` — AnchorEvent,
  programme page, hotel policy, insurance, transfer research (DOCUMENTED).
- `fixtures/scenarios/corporate-tmc/scenario.json` — corporate policy,
  EMAIL client invite, hotel terms (DOCUMENTED).
- `test/fixtures/model-outputs/research-entry-findings.json` — schema-
  validated research findings (DOCUMENTED).
