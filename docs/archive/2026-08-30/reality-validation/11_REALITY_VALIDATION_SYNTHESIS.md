# 11 — Reality Validation Synthesis

**Role:** primary investigator integration + decision package.
**Date:** 2026-08-23. **Integration branch:** `investigation/reality-validation`.
**Base:** `6d203960a2948ac81e128a9483cb189323f7c018` (Checkpoint C closeout, `origin/main`).
**Inputs:** reports 01–10 on this branch (cherry-picked from lane branches `rv/*-investigation`).

This milestone is INVESTIGATION ONLY. Nothing below authorizes implementation;
implementation begins only after the user accepts this package.

---

## 1. Executive answer — how real can the next version become before code freeze?

Substantially more real than Checkpoint C, in three concrete ways, without touching
the engine's internals:

1. **Inputs become external.** The system can ingest a real public event page (URL),
   a flight-confirmation email, and a hotel PDF — none authored to our schema — and
   assemble a usable Trip (Scenario 0). This requires one new front-half
   (`SourceFetchService` + extraction wiring) plus an assembly layer above the
   existing mutation path. Both are additive; the frozen contracts absorb them with
   one new transient DTO.
2. **One provider boundary becomes genuinely transactional in sandbox.** Hotelbeds
   Transfers is the only B2B ground provider with a self-service, full-lifecycle
   sandbox (search→quote→confirm→detail→cancel→amend). Duffel Stays test mode gives
   a full hotel search→quote→book→cancel loop without sales contact. Both prove real
   provider-shaped transactions through the existing authority/execution seam.
3. **Flight stays sandbox-read + simulated-write, honestly.** Atlas Search/Verify/rules
   are proven; order/pay/refund remain `TICKETING_ACTIVATION_REQUIRED`/ACCESS_BLOCKED
   and stay simulated at the boundary. Singapore routes are requestable but unprovisioned;
   the portfolio is engineered to survive all three SIN probe outcomes (offers / empty /
   error), with a fully documented route (Volaris MEX–GDL) as the safety net.

What stays simulated and why: Atlas order/pay/refund (no ticketing activation, money
risk, zero demo value), Atlas webhooks/incidents (account-gated, not inducible),
ground transfer where Hotelbeds sandbox is unavailable (quota/auth), and negotiated-rate
(RAC) hotel flows (no provider loads RAC to a fresh account). Core internal logic —
mutation, blast radius, viability, policy, authority, execution gating, observation,
verification, persistence — remains real in every scenario. No exception.

## 2. Reality stack — exact choice per component

| Component | Decision | Mode detail |
|---|---|---|
| Event webpage (WiT programme/speakers) | **USE_LIVE** read | URL ingestion, recorded snapshot cached for replay |
| Flight confirmation (email text) | **USE_LIVE** source | authored-realistic document through real ingestion |
| Hotel confirmation (PDF/text) | **USE_LIVE** source | document path, text-extracted |
| Traveller instructions / profile | **USE_LIVE** source | existing traveller-context path |
| Organisation/event policy | **USE_LIVE** source | policy-document ingestion (already proven) |
| Atlas Search | **USE_SANDBOX + RECORD_AND_REPLAY** | live probe when credentials return; recordings are demo default |
| Atlas Verify | **USE_SANDBOX + RECORD_AND_REPLAY** | same |
| Atlas fare/change/refund/no-show rules | **USE_SANDBOX + RECORD_AND_REPLAY** | `rule{}` block in Verify |
| Atlas baggage/seat quotes | **DEFER** | SIMULATE_PROVIDER_BOUNDARY if a scenario needs them |
| Atlas order/pay/refund/void | **SIMULATE_PROVIDER_BOUNDARY** | ACCESS_BLOCKED + money risk |
| Atlas webhooks/incidents | **DEFER** (REJECT this milestone) | account-gated, not inducible |
| Hotel search/availability/quote/book/retrieve | **USE_SANDBOX** — Duffel Stays test mode | full loop exercisable without sales contact |
| Hotel cancel | **USE_SANDBOX** — Duffel Stays cancel action | modification = cancel + rebook |
| Hotel negotiated rates (RAC) | **SIMULATE_PROVIDER_BOUNDARY** | no provider loads RAC to fresh accounts |
| Ground routing context | **USE_LIVE (opt-in, guarded)** | default mode stays REPLAY until guardrail checklist done; <$1 realistic spend |
| Ground transfer transaction | **USE_SANDBOX** — Hotelbeds Transfers | RECORD_AND_REPLAY fallback at 50 req/day quota |
| Immigration/entry facts | **USE_LIVE** bundled authoritative dataset | curated JSON, `PROVIDER_STATE`/`AUTHORITATIVE` |
| Immigration operational estimates | Model Studio web research | OPERATIONAL_ESTIMATE only, uncertainty labelled |
| Insurance | document ingestion | one real policy as data (already proven) |
| Disruption signal — event page change | **USE_LIVE** URL re-ingestion diff | genuinely external signal |
| Disruption signal — provider email | **USE_LIVE** EMAIL ingestion | existing path |
| Disruption signal — Atlas feeds | DEFER / KEEP_INJECTED | runtime API remains the injection channel |
| Model Studio extraction/planning | **USE_LIVE when configured** | fail-closed client + deterministic fallback already proven; no key in this sandbox |

## 3. Provider decisions

- **Atlas:** keep the three-method `FlightCapability` (search/verify/getFareRules).
  Do not add order/pay/refund operations. Optional `flight.quote_baggage` /
  `flight.quote_seat` only if a selected scenario demands them (none currently does).
  Skill CLI: REJECT for the product (3 probes failed; direct API is richer and proven).
- **Hotel:** PRIMARY **Duffel Stays**; BACKUP **Nuitée/liteAPI**. Rationale in §4.
- **Routing:** Google Routes LIVE behind the §6 guardrail plan; REPLAY remains the
  deterministic default demo path. Existing adapter is already SKU-minimal.
- **Ground transaction:** Hotelbeds Transfers USE_SANDBOX_NOW. Amadeus Transfers
  REJECT (Self-Service portal decommissioned; Enterprise is sales-gated).
- **Research/context:** Model Studio web research restricted to OPERATIONAL_ESTIMATE;
  legal/entry facts from the curated authoritative dataset.
- **Model Studio runtime:** default `qwen-flash`; upgrade per-task only on measured
  schema-quality evidence (report 07 rubric).

## 4. Hotel provider — primary + backup + rationale

**PRIMARY: Duffel Stays.** The only candidate satisfying both hackathon feasibility
(self-service test mode this week: `duffel_test_` token, full
search→fetch_rates→quote→book→cancel loop, test hotels at `-24.38,-128.32`) and a
credible TMC path (first-class Negotiated Rates endpoint, RAC distribution, corporate
deal types, documented TMC workflow). Modern JSON API, first-party JS client. Known
weakness — no in-place modification — is absorbed by cancel-and-rebook, which maps to
the existing `cancelStay` + new `book` seam and matches how real hotels handle hard
changes.

**BACKUP: Nuitée / liteAPI.** Free sandbox with test card, best Node/TS SDK of any
candidate (`liteapi-node-sdk`), clean preBook→book→retrieve flow, 2M+ properties, APAC
(Singapore) presence. Same modification weakness; no first-class RAC. Runs in parallel
as a hedge; costs nothing to try.

**Why not the others:** Expedia Rapid and Hotelbeds Hotels are the right long-term TMC
production shape but are sales-gated (weeks-to-months, partner programs) — wrong for a
hackathon week. Amadeus Self-Service is **decommissioned** (resolved conflict: report 02
cites the portal's own banner — decommissioned July 17th, announced Feb 2026; report 03
carried a 2025 date typo; decision identical either way: REJECT, and `ROADMAP.md:143`
language is now stale — update recommended). Booking.com Demand stays Stretch
(partner-gated, unchanged from ADR-017).

**What we can test now:** Duffel signup + test-mode loop; Nuitée sandbox signup + SDK
loop. **What a real TMC would do later (report 02 §8):** Expedia Rapid for breadth,
Hotelbeds for net-rate wholesale, Duffel specifically for programmatic RAC, Amadeus
Enterprise only with an existing GDS contract, Booking.com Demand as fallback channel.

**Confirmation semantics honesty (investigated):** Duffel bookings return
`status: confirmed` at book-time (provider-confirmed, DOCUMENTED); Nuitée is
provider-confirmed via the aggregator with retrieve-confirmation; Hotelbeds is
wholesaler-requested semantics (async confirmation risk, DOCUMENTED) — one more reason
Hotelbeds is wrong for hackathon hotel even though it is right for transfers.

## 5. Atlas — proven vs documented vs blocked

| Surface | Verdict |
|---|---|
| `search.do` (39 lab captures, 472 offers, 30 fixtures) | PROVEN_SANDBOX (prior lab pass) |
| `verify.do` (session, bookingRequirement, priceChange, `rule{}`) | PROVEN_SANDBOX |
| fare/change/refund/no-show rules inside `rule{}` (843 baggage rows, 112 change, 112 refund) | PROVEN_SANDBOX (read) |
| `getLuggage.do` (1 capture), `seatAvailability.do` (1 capture) | PROVEN_SANDBOX (single-fixture) |
| `order.do` / `pay.do` | ACCESS_BLOCKED (Skill reports `TICKETING_ACTIVATION_REQUIRED`) |
| `refundQuotation/refund/queryRefundOrders` | DOCUMENTED_NOT_PROVEN (needs ticketed order) |
| webhooks/incidents/schedule-change feeds | DOCUMENTED_NOT_PROVEN + account-gated |
| Smart Search | NOT_WORTH_IMPLEMENTING (officially deprecated) |
| real-time search | DOCUMENTED_NOT_PROVEN (account-manager enablement) |
| **All live probing in this sandbox** | **ACCESS_BLOCKED** (no credentials; probe plans committed in report 01 §8) |

## 6. Singapore — exact evidence

- SIN is **not** in the documented 9-airline / 36-route / 34-OD fixture set
  (DOCUMENTED, verified against the official sandbox-test-routes page 2026-08-22).
- The `search.do` request contract has **no route whitelist for one-way** searches;
  error code 105 gates round-trip O&D only. A one-way SIN request is therefore
  well-formed (DOCUMENTED).
- Whether SIN returns offers is **UNKNOWN** — the lab never probed SIN, and 6 of 36
  documented fixtures return empty-with-status-0 (a normal outcome). This sandbox
  cannot probe (ACCESS_BLOCKED).
- The official add-a-route channel exists: FAQ Q2 invites teams to share desired
  routes; Atlas team responds (DOCUMENTED).
- **Actions:** (1) ask organisers for one SIN fixture — **SIN–HKG** preferred single
  choice; (2) run the report-01 §8.5 probe matrix (SIN-HKG/KUL/MNL/BKK/CGK/TYO/SYD)
  the moment credentials return; (3) engineer scenarios to be robust to all three
  outcomes. **SIN is never claimed "unsupported" — it is "requestable, currently
  unprovisioned, only the Atlas team can add a fixture".**
- Meta-fact worth recording: Atlas CEO Mary Li judges the WiT Singapore 2026 Agentic
  AI Hackathon Finals (Wed 30 Sep, 15:10) — the demo event context is real.

## 7. Real ingestion — exact gaps

Ingestion's hard half already works (provenance, authority, deterministic
normalization, uncertainty). The missing half is URL→content acquisition:

| Kind | Today | Gap |
|---|---|---|
| URL | `uri` recorded, never fetched | **no fetcher** — the single mandatory gap |
| Plain HTML | works if caller pre-fetches | fetch + readability extraction |
| JS-heavy page | same | honest `UNAVAILABLE` (no headless for MVP — empirically justified: Wikipedia-class pages work with plain fetch; IHG observed 403 Akamai; agenda grids observed client-rendered) |
| PDF | works from pre-extracted text | binary decode (pdf-parse/pdfjs) |
| Booking confirmation / email / policy / insurance / profile | work from text or structured | MIME/headers parsing for raw email remains caller-supplied (acceptable) |

Security controls specified (16 in report 04 §3): SSRF with private-range + DNS-pin,
redirect cap (3), 5 MB cap, MIME whitelist, ≤12 s timeout, robots respect, no JS
execution, DOMPurify sanitization before LLM, audit of every fetch. Architecture delta:
optional `SourceFetchService` dependency on the existing capability — **no public seam
change, existing REPLAY tests stay green.**

## 8. Trip assembly — required architecture delta

Current bootstrap persists a hand-authored bundle; it assembles nothing. The assembly
layer sits between ingestion and the existing mutation path (report 05):

Six stages: **A** source intake → **B** extraction to candidate facts (no entity
writes) → **C** entity/place/organisation resolution → **D** trip shell + provisional
elements (`status: UNKNOWN`, ADR-027) → **E** objectives/dependencies/policy → **F**
readiness gate (commit ↔ defer, listing every UNKNOWN for human confirmation).

Deltas (all proposed): `CandidateFact` transient DTO (new file, never persisted —
respects ADR-022's no-parallel-DTO rule); `ReadinessReport` read-model projection;
identity-key registry and relation-validator policy documentation; optional
`POST /api/runtime/assembly/*` endpoint (keeps ADR-029 generic-seam posture).
Provisional semantics deliberately live in the readiness gate, not the mutation
vocabulary — likely **zero mutation-contract change**. AI proposes (entity links,
DEPENDS_ON/CONNECTS_TO, objectives); deterministic code validates and writes
(ADR-003/005 preserved).

## 9. Traveller-initiated change — required architecture delta

**Decision: keep `SignalKind` closed. Add a `ChangeRequest` DTO at the ingestion
boundary** that normalizes into the existing `TRAVELLER_INPUT` signal path. No second
engine. The engine already carries 90% of this: `TRAVELLER_INPUT` kind exists;
`WAIVE_OR_REPRIORITIZE_OBJECTIVE` exists; objective statuses WAIVED/REPRIORITY/LOST
exist; the 4-level preference precedence exists; overlays/viability/authority are
request-shape-agnostic.

Semantic rulings: requested **target state** (goal-directed) differs from disruption
(repair) only in strategy generation intent — same overlay/viability machinery;
"no action is a valid outcome" is a deterministic overlay result (already-satisfied or
infeasible requests close without execution). **Initiation is not consent** — every
resulting `ActionIntent` still passes the authority gate (cost deltas, policy breaches
route to REQUIRES_TRAVELLER / REQUIRES_ORGANISATION_APPROVER). Soft preferences
("rather stay near the venue") rank; hard targets ("return a day earlier") constrain.
Real capability gaps surfaced: `hotel.search` absent from `HotelCapability` (closed by
the §4 Duffel delta), no `hotel.refund_quote` equivalent (parked).

## 10. Scenario 0 acceptance specification

"Bring Your Own Trip" — engineering truth test (full spec: report 10 §2; pipeline:
report 05):

- **Inputs, never hand-shaped:** a real public event page copied verbatim; a realistic
  flight-confirmation email; a hotel confirmation PDF (or text-equivalent).
- **Stages:** ingest → extract (Model Studio or scripted fallback) → deterministic
  validate → persist → inject one simple change (outbound delay ≥3 h) → run the
  existing runtime loop (disruption→plan→begin→decide→execute→observe) → reset/reseed
  → replay deterministically.
- **Pass criteria:** VIABLE Trip assembled with zero hand-curated JSON; injected change
  produces ImpactAssessment + ≥1 REJECTED candidate proving downstream protection;
  reset restores state; every assembled fact traces to a Source; unknowns stay UNKNOWN
  with sourceId, never silently filled.
- **Fallbacks (disclosed in run header):** scripted planner if no Model Studio key;
  locally cached page copy marked `WEBPAGE_LOCAL_CACHE` if fetch blocked; text
  equivalent for PDF; `ATLAS_SIN_PROBE_PENDING` label never fails the test.

## 11. Final selected scenario portfolio (3 demo + 1 truth test)

| Slot | Scenario | Trigger | Outcome |
|---|---|---|---|
| **S1** | WiT Singapore 2026 invited speaker — Tony Fernandes (Capital A), KUL→SIN, flight cancelled 18 h before Wed 30 Sep Innovation Day at Pan Pacific | External disruption (FLIGHT_CANCELLATION) | FULLY_RECOVERED |
| **S2** | Same event — Marcus Yong (Klook), traveller shifts trip a day later for a Klook offsite and explicitly waives the speaker dinner | Traveller-initiated change + soft-objective waiver | RECOVERED_WITH_LOSS |
| **S3** | Corporate TMC — Beatriz Ortega (Northgate), MEX–GDL–MEX return cancelled 3 h before Monday 08:30 steering meeting; employer every-change-approval rule | External disruption, documented Atlas route (Volaris MEX–GDL, 45 offers) | RECOVERED_WITH_LOSS |
| **S0** | Bring-Your-Own-Trip (above) | Injected simple change | truth test |

Selected for complementary coverage, not top scores (all 11 candidates scored on the
20-criterion matrix in report 10 §5). C11 (compound empty-fixture + hotel-unavailable,
honest `bestStrategyId = undefined` + ESCALATION) is retained as an injectable S1
alternative, giving the portfolio an escalation path without a fourth slot.

**Integration consistency note (to resolve at implementation kickoff):** report 10
labels Marcus Yong Singapore-based (OBSERVED_LIVE_READ) yet gives S2 an inbound
SGN/HKG→SIN flight. Fix at scenario-freeze: either reposition S2 as an outbound
SIN→HKG/SGN trip for the offsite before returning for WiT, or swap the traveller to a
non-Singapore-based speaker (e.g., Rajesh Magow, MakeMyTrip — HQ-proxy Gurugram,
labelled). The scenario shape (traveller-initiated change + waiver + FR-03 precedence)
is unaffected.

## 12. Capability coverage matrix across selected scenarios

| Dimension | S1 | S2 | S3 | S0 |
|---|:-:|:-:|:-:|:-:|
| Traveller-initiated change | — | ✔ | — | — |
| External disruption | ✔ | — | ✔ | (injected) |
| Hotel materially exercised | ✔ | ✔ (date shift) | ✔ (refundable terms) | ✔ (hotel PDF) |
| Organisational/event policy + approval | ✔ (organiser spend cap) | ✔ (rebooking-fee rule + instruction precedence) | ✔ (every-change approval + USD 400 cap) | — |
| Outcome variety | FULLY_RECOVERED | RECOVERED_WITH_LOSS | RECOVERED_WITH_LOSS | n/a |
| Atlas SIN probe branch | ✔ | ✔ | — | optional |
| Atlas fully-documented route | — | — | ✔ (safety net) | — |
| Full external ingestion | partial | partial | partial | ✔ (complete) |
| Escalation/no-strategy honesty | C11 alt | — | — | — |

## 13. External calls — LIVE / SANDBOX / REPLAY / SIMULATED

- **LIVE:** event-page URL fetch + re-ingestion diff; email/document source intake;
  Duffel Stays test-mode calls; Nuitée sandbox calls; Hotelbeds Transfers sandbox;
  Google Routes (opt-in, guarded); Model Studio (when key configured).
- **SANDBOX (Atlas):** Search/Verify/rules — recorded during demo prep.
- **REPLAY:** Atlas recordings (demo default), Google Routes recordings, scripted
  planner path, all Checkpoint C recordings unchanged.
- **SIMULATED (provider boundary only):** Atlas order/pay/refund effects, RAC hotel
  rates, Hotelbeds flows beyond sandbox quota, any unprovisioned SIN fixture yield.

## 14. Architecture changes required before implementation

Freeze these (all proposed in lane reports; none implemented yet):

1. `SourceFetchService` + content-type registry + sanitization seam + fetch-metadata in
   `SourceRecord.notes` + fetch config block (report 04 §5).
2. Assembly layer: `CandidateFact` DTO, `TripAssemblyService`, `ReadinessReport`
   projection, identity-key registry, relation-validator policy (report 05).
3. `ChangeRequest` boundary DTO normalizing to `TRAVELLER_INPUT` (report 08 §3).
4. `HotelCapability` delta: search / availability / quote / prebook / book / retrieve
   (+ existing modify/cancel), provider-neutral, `CapabilityResult` envelope discipline
   (report 02 §9).
5. Google Routes guardrail config: IP-restricted key, 1,000 req/day quota, $20 budget
   alert, in-adapter request cap, RecordingStore-first caching, field-mask freeze
   (report 03 §A.6).
6. Research prompt tightening: forbid `LEGAL_ENTRY_FACT` from non-authoritative sources;
   curated `fixtures/authoritative/entry-rules.json` dataset (report 06).
7. Signal-source adapters: `UrlReingestDiffSource`, `EmailIngestSource` — thin, zero
   engine change (report 09).

## 15. Shared contracts that must be frozen

Existing frozen surface (ADR-022) stays frozen: `src/domain/**`,
`src/operational/**`, `src/contracts/**`, `ScenarioSpec`, `.env.example` names. New
freeze targets before parallel lanes: `CandidateFact` schema, `ChangeRequest` schema,
the HotelCapability delta signatures, `SourceFetchService` interface, `ReadinessReport`
shape, and the SignalKind closed-vocabulary rule. `SignalKind`, `TripRelationKind`
(ADR-026), and the mutation vocabulary remain closed.

## 16. Implementation complexity per work package

| WP | Scope | Size |
|---|---|---|
| WP-RV1 | Fetch service + security controls + content-type registry + sanitization | M |
| WP-RV2 | Assembly layer (stages A–F) + ReadinessReport | L |
| WP-RV3 | Scenario 0 build + acceptance test (BYOT) | M |
| WP-RV4 | Duffel Stays adapter + HotelCapability delta + recordings | L |
| WP-RV5 | Nuitée/liteAPI hedge adapter (REPLAY-shaped) | M |
| WP-RV6 | Hotelbeds Transfers sandbox adapter + recordings | M |
| WP-RV7 | ChangeRequest DTO + traveller-change entry path + S2 scenario | M |
| WP-RV8 | Atlas credential probes + SIN probe + recordings refresh | S |
| WP-RV9 | Google Routes guardrails + opt-in LIVE wiring | S |
| WP-RV10 | URL re-ingestion diff + email disruption sources | S |
| WP-RV11 | Authoritative entry-rules dataset + research prompt tightening | S |
| WP-RV12 | S1 scenario build (WiT fixtures, SIN-probe branches) | M |
| WP-RV13 | S3 scenario refresh onto documented MEX–GDL recordings | S |
| WP-RV14 | Model Studio empirical pass (report 07 §4 plan) when key available | S |

## 17. Proposed implementation lanes

- **Lane RV-A (ingestion+assembly):** WP-RV1 → WP-RV2 → WP-RV3. Owns `src/ingest/`
  fetch additions and new assembly module. First on critical path.
- **Lane RV-B (hotel):** WP-RV4 (+ WP-RV5 in parallel once contract frozen). Owns
  HotelCapability delta + Duffel/Nuitée adapters.
- **Lane RV-C (providers/ground):** WP-RV6, WP-RV8, WP-RV9. Owns Atlas probes,
  Hotelbeds adapter, Google guardrails.
- **Lane RV-D (signals+change):** WP-RV7, WP-RV10, WP-RV11. Owns ChangeRequest seam,
  disruption adapters, entry-rules dataset.
- **Lane RV-E (scenarios):** WP-RV12, WP-RV13, WP-RV14 — after RV-A/B/C deliver.
  Owns scenario fixtures + acceptance runs.

Collision analysis: RV-A and RV-B touch `src/contracts/capabilities.ts` from different
sides (new file vs HotelCapability block) — freeze contract deltas centrally first.
RV-D's ChangeRequest is a new seam; no overlap with RV-A's fetch service. Scenario
fixtures are data-only.

## 18. Critical path

`Contract-freeze (deltas §14) → WP-RV1 (fetch) → WP-RV2 (assembly) → WP-RV3 (Scenario 0
acceptance) → WP-RV12 (S1) / WP-RV4 (hotel) in parallel → WP-RV7 (S2) → integration +
demo rehearsal.` WP-RV8 (Atlas probes) runs opportunistically whenever credentials
return — it gates nothing except SIN-fixture realism, and S3 is the safety net.

## 19. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Atlas credentials never return / SIN stays empty | S3 carries the demo on documented MEX–GDL; S1/S2 run on REPLAY recordings or honest empty-fixture branches (NFR-03) |
| Duffel signup blocked or test-mode quota | Nuitée sandbox is the ready backup; hotel actions fall back to REPLAY/simulated boundary (ADR-007) |
| Hotelbeds sandbox requires sales activation | ground transaction drops to RECORD_AND_REPLAY; routing context unaffected |
| Model Studio key absent at demo | deterministic fallback planner already proven honest (DEMO.md §credential-free planner honesty) |
| Google Routes key/billing setup slips | REPLAY/sourced/unknown ground context — engine never blocks on it (ARCHITECTURE §14) |
| Event page changes structure before demo | recorded snapshot cache (report 04 fallback design) |
| Organisers never add SIN fixture | accepted; portfolio is probe-robust by construction |

## 20. Findings triaged (all investigations)

**Act Now**
1. Ask Atlas organisers for a SIN fixture (SIN–HKG preferred) via FAQ Q2 channel. [01]
2. Record a happy-path Atlas Search on a documented fixture during demo prep. [01]
3. Adopt curated authoritative entry-rules dataset; tighten research prompt against
   LEGAL_ENTRY_FACT from non-authoritative sources. [06]
4. Freeze the seven architecture deltas (§14) before parallel lanes. [synthesis]
5. Create Google Cloud project + key with guardrails (non-blocking). [03]
6. Sign up Duffel Stays + Nuitée sandboxes (free, self-service). [02]
7. Refresh the sandbox GitHub credential — this milestone's push to origin is blocked
   by an expired `ghs_*` token (environment issue; all lane commits verified locally). [synthesis]

**Investigate Now**
1. Run Atlas SIN probe matrix when credentials return (report 01 §8.5). [01]
2. Skill-vs-direct-Search discrepancy; 9-vs-10 airline FAQ conflict; `seatCount`/
   `riskSellout` semantics. [01]
3. Reconcile Google Routes actual SKU tier (TRAFFIC_AWARE → Pro) in first live probe. [03]
4. Fix S2 traveller/origin inconsistency (§11 note). [10]
5. Assembly endpoint shape (runtime endpoint vs one-shot service). [05]
6. Run report-07 empirical Model Studio plan when key available. [07]

**Park for Later**
- Atlas order/pay/refund/void, post-ticket baggage, webhooks/incidents. [01, 09]
- Timatic commercial; MCP travel vendors; expanded insurance vocabulary; generic live
  WEBPAGE fetcher beyond MVP. [06]
- `hotel.refund_quote`, in-place hotel modify, open-jaw/multi-city, VCC/3DS triggers. [01, 02]
- Multi-traveller cascade (C9), insurance-claim scenario (C10). [10]
- Headless browser fetch adapter (opt-in, later milestone). [04]

**Ignore / Accept Risk**
- Sandbox fares are mock data — always labelled; never market evidence. [01]
- Empty fixtures are valid response shapes, not defects. [01]
- Speaker working-base uncertainty — always HQ-proxy labelled, never claimed. [10]

## 21. What we know

- Atlas read-only chain works (39 Search captures, Verify, rules, one luggage + one
  seat capture); the contract accepts arbitrary one-way O&D.
- The engine is already signal-shape-agnostic, waiver-capable, precedence-correct, and
  fail-closed on model output — traveller change and URL signals are additive.
- URL ingestion's only gap is acquisition; plain HTTP + readability suffices for MVP
  (empirically tested on 5 live fetches).
- Google Routes at hackathon volume costs cents against a $200/mo credit.
- Duffel and Nuitée sandboxes are self-service; Expedia Rapid/Hotelbeds/Amadeus
  Enterprise/Booking.com Demand are not.
- WiT Singapore 2026: 30 Sep–2 Oct, Pan Pacific + Marina Bay Sands, public speaker
  roster and programme (all cited in report 10).

## 22. What we do not know

- Whether SIN searches return offers (probe required; ACCESS_BLOCKED here).
- Whether the organisers will add a SIN fixture, or how fast.
- Atlas order/pay activation status for our account beyond the Skill's
  `TICKETING_ACTIVATION_REQUIRED` report.
- Model Studio extraction quality on unseen sources (plan written; key absent).
- Duffel/Nuitée signup approval time in practice (docs say minutes; not yet executed).
- Exact billable SKU for the current Google Routes adapter config (Pro suspected).

## 23. Key assumptions

- Hackathon Atlas sandbox credentials will return before demo prep (they existed for
  the Checkpoint C LIVE proof).
- One free Duffel + one free Nuitée account can be created without sales contact.
- WiT public speaker/programme data remains available through the event.
- The GitHub push credential will be refreshed so this branch can reach origin.
- Demo judges accept honestly-labelled simulation at provider boundaries (the README
  integration-truth pattern already establishes this).

## 24. What must be tested next (first actions of the implementation milestone)

1. Atlas SIN probe matrix + happy-path recording (WP-RV8) — needs credentials.
2. Duffel Stays test-mode full loop + RECORD (WP-RV4).
3. Nuitée sandbox loop + RECORD (WP-RV5).
4. Hotelbeds Transfers search→quote→confirm→cancel in sandbox (WP-RV6).
5. Scenario 0 end-to-end acceptance (WP-RV3) — the gate for everything else.
6. Model Studio empirical extraction pass on the exact Scenario 0 sources (WP-RV14).
7. Google Routes first-call SKU confirmation + guardrail verification (WP-RV9).

---

## Cross-report conflict log (resolved centrally)

1. **Amadeus decommission date:** report 02 says 2026-07-17 (portal banner + three
   sources); report 03 says 2025-07-17. Report 02's evidence is primary and consistent
   with the current date; the decision (REJECT Amadeus self-service paths) is identical
   under either reading. Resolution: 2026-07-17; report 03's date treated as a typo.
2. **S2 traveller base vs trip direction** (Marcus Yong Singapore-based yet inbound to
   SIN): recorded in §11; resolve at scenario freeze without changing the scenario shape.
3. **Google Routes decision framing:** lane phrased "RECORD_AND_REPLAY default with
   opt-in LIVE"; synthesis records final decision USE_LIVE (guarded opt-in) with REPLAY
   retained as the default demo mode — both statements preserved, no contradiction.
4. **Hotel modification surface:** all candidates lack in-place modify except Expedia
   Rapid (sales-gated). Adopted uniformly as cancel-and-rebook; no report conflict,
   recorded so implementation doesn't rediscover it.

---

*REALITY VALIDATION INVESTIGATION IS COMPLETE.*
*REALITY VALIDATION IMPLEMENTATION HAS NOT STARTED.*
*FINAL CANDIDATE WORK HAS NOT STARTED.*
