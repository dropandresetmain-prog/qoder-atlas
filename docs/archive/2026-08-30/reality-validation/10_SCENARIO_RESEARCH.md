# Scenario Research — Reality Validation

> Branch: `rv/scenario-investigation` (based on Checkpoint C closeout `6d20396`)
> Scope: bounded INVESTIGATOR research only. No product implementation.

---

## 1. Executive summary

We are selecting the small scenario portfolio that proves the generalised Trip-Resolution engine runs against **externally sourced, real-world-shaped inputs** rather than only the curated Checkpoint C fixtures.

Two scenarios are FIXED by the brief:

- **Scenario 0 — "BRING YOUR OWN TRIP" (BYOT).** An engineering truth test. We take raw, externally authored sources (a public event page, a realistic flight confirmation email, a hotel PDF) that are *not* written to our `scenario.json` schema, run them through the generic assembly pipeline (Report 05), inject a simple change, and exercise the same engine. The pass criterion is end-to-end assembly → signal → recovery → observation, not showcase quality.
- **Scenario 1 family — "WiT Singapore 2026 invited speaker".** A real, named anchor event (30 Sep – 2 Oct 2026, Marina Bay Sands Expo & Convention Centre, theme "21: A New Beginning"). The scenario picks a real public speaker, with working-base labelled as INFERRED/UNCERTAIN, and runs the existing `anchor-event-speaker` shape against Atlas-discoverable flights and a hotel/ground leg.

From the candidate set below (11 candidates), the recommended portfolio is **3+1** scenarios:

- **S1 — WiT Singapore invited speaker (Tony Fernandes, KUL→SIN, full event-organiser operator model).** Event-organiser, external disruption (Atlas-discoverable flight), policy/authority angle, multi-segment. Outcome: **FULLY_RECOVERED**.
- **S2 — Same event, parallel traveller-initiated change (Marcus Yong, Klook, SGN/SIN or HKG/SIN, traveller waives speaker dinner).** Same operator + event, traveller-initiated change, soft-objective reprioritisation, different recovery path. Outcome: **RECOVERED_WITH_LOSS** (soft objective explicitly waived).
- **S3 — Corporate TMC, *different* company, hard return-by deadline (Beatriz Ortega, Northgate, MEX–GDL–MEX).** This is the existing `corporate-tmc` scenario retained as a complementary different-vertical case (carried forward from Checkpoint C; no rewrite required).
- **S0 — BYOT (raw event page + airline email + hotel PDF → generic pipeline → injection).** Engineering truth test, not demo. Outcome class: **observable through the engine; not a narrative candidate**.

This portfolio satisfies all required constraints (traveller-initiated, external disruption, hotel-materially-exercised, organisational policy/approval exercised, different final outcomes across S1/S2/S3) and respects the Atlas SIN-feasibility constraint by selecting a S1 origin that the Atlas documented-sandbox can be probed for, with an explicit `Search probe` fallback branch.

---

## 2. Scenario 0 acceptance spec — "BRING YOUR OWN TRIP" (BYOT)

### 2.1 Purpose

Prove the generic assembly/ingestion pipeline (Report 05) can take inputs the team did **not** author and reach the same authoritative state a curated `scenario.json` would produce. The scenario is intentionally boring; it is the canary for the generalisation thesis.

### 2.2 Inputs (raw, NOT pre-shaped to schema)

| Slot | Source | Why it tests the pipeline |
| --- | --- | --- |
| Anchor event page | A real public event page copied verbatim into `sources/event-page.md` (e.g. a past WiT or similar conference page) | Event pages are typically prose + schedule tables, with mixed casing/timezones — exercises URL→structured extraction |
| Flight confirmation | A realistic airline confirmation email pasted into `sources/flight-confirmation.txt` (date, time, IATA codes, PNR, cabin, fare basis) | Booking confirmations include free-text and PNr/PII patterns — exercises entity extraction + IATA resolution |
| Hotel confirmation | A hotel PDF (or PDF-equivalent text) into `sources/hotel-confirmation.txt` with check-in/out, rate, cancellation clause | PDFs force the document extraction path; cancellation clause exercises RuleSet ingestion |

We **do not** hand-author a `scenario.json`. Sources are dropped into the assembly pipeline; the pipeline must produce a Trip, Constraints, RuleSets, etc. **or** the test is a failure.

### 2.3 Stages (mapped to current runtime)

1. Ingest: URL→text + email parse + PDF parse → normalised `Source` records. (Report 04 boundary.)
2. Extract: Model-Studio or scripted planner produces candidate Trip, Elements, RuleSets, Objectives with provenance. (Report 05 boundary.)
3. Validate: deterministic schema/place/timezone checks reject the obviously bad and surface uncertainty for the rest.
4. Persist: mutated state goes to SQLite; authoritative state is only what passed validation.
5. Inject a simple change: a TripSignal (e.g. outbound flight delay ≥3h).
6. Run the existing engine: `disruption → impact → plan → begin → decide → execute → observation → resolved`.
7. Wipe via `POST /api/runtime/reset`; reseed the BYOT inputs; replay deterministically.

### 2.4 Pass criteria

- The generic assembly pipeline reaches a `VIABLE` Trip without any hand-curated JSON.
- The injected change triggers ImpactAssessment, Constraint re-eval, and a plan with at least one REJECTED candidate demonstrating downstream viability protection.
- Trip state is restorable via the documented reset path.
- Sources of truth for **every** fact in the assembled Trip are traceable to a `Source` (no orphan fields).
- Unknown facts remain `UNKNOWN` with a `sourceId` (e.g. traveller nationality) — never silently filled.

### 2.5 Fallbacks

| Failure | Fallback | Disclosure |
| --- | --- | --- |
| Model Studio credentials unavailable | Scripted / rule-based planner (current behaviour for non-LLM planning) | Disclose planner mode in the run header |
| URL fetch blocked | Use a locally-cached copy of the page, marked `kind: WEBPAGE_LOCAL_CACHE` | Disclose in source authority |
| PDF binary parse fails | Use the text body the team pastes as the source | Disclose as text-equivalent in source authority |
| Atlas SIN search probe returns empty fixture | Mark `ATLAS_SIN_PROBE_PENDING`; do **not** fail the test; the engine should still resolve through other capabilities or escalate | Disclose in run header |

### 2.6 Why this is not a demo

BYOT may *also* run during the demo as evidence of generalisation, but the headline demo path remains S1. BYOT's purpose is to be a **regression guard**, not a story.

---

## 3. Scenario 1 family — WiT Singapore 2026 (research)

### 3.1 Event facts (DOCUMENTED, from public site)

| Fact | Value | Source / evidence label |
| --- | --- | --- |
| Event | **WiT Singapore 2026** (Web in Travel, 22nd edition) | DOCUMENTED — witevents.com/witsingapore/ |
| Theme | **"21: A New Beginning"** | DOCUMENTED — witevents.com/witsingapore/ |
| Dates | **Wed 30 Sep – Fri 2 Oct 2026** (3 days) | DOCUMENTED — witevents.com/witsingapore/; Vendelux event page |
| Innovation Day venue | **Pan Pacific Singapore** (Wed 30 Sep) | DOCUMENTED — witevents.com/witsingapore/programme |
| Main Stage venue | **Marina Bay Sands Expo & Convention Centre** (Thu 1 Oct & Fri 2 Oct) | DOCUMENTED — witevents.com/witsingapore/; Vendelux event page |
| Founder | **Yeoh Siew Hoon** | DOCUMENTED — witevents.com/witsingapore/speakers/ |
| Parent | Northstar Travel Group (LLC) | DOCUMENTED — witevents.com/witsingapore/ |
| Registration | USD 1,900; special startup rate; "every session across three days, including WiT Bootcamp, the Global Startup Pitch, and The Great WiT Debate" | DOCUMENTED — witevents.com/witsingapore/ |
| Contact | sponsorship: Gerry Pang `gerry@webintravel.com`; reg: Dewi Nurinda Ishak `dewi@webintravel.com` | DOCUMENTED — witevents.com/witsingapore/ |
| Projected attendance | ~750 (Vendelux projection) | INFERRED — Vendelux event page; not a WiT-published number |
| WiT 2025 dates | 6–8 Oct 2025 at Marina Bay Sands (20th anniversary edition, "The Next 20") | DOCUMENTED — webintravel.com theme reveal article |

Critical 2026 programme moments (DOCUMENTED — witevents.com/witsingapore/programme):

- Wed 30 Sep Innovation Day, Pan Pacific: Next Generation Leaders (Booking.com, by invite only) 10:00–13:00; WiT Bootcamp (incl. WiT Phocuswright Global Startup Pitch: Seedup Winners) 13:00–16:00; Global Travel Tech Thinktank (invite only) 17:00–19:00; Opening Cocktails hosted by Pan Pacific 19:00–21:00.
- Thu 1 Oct Main Stage, Marina Bay Sands: Prelude 09:00–09:20; Main Sessions Act 1 (The Asia Moment) 09:20–11:00; Act 2 11:30–13:00; Act 3 (The Build) 14:00–15:30; Act 4 (The Reckoning) 16:00–17:40.
- Fri 2 Oct Main Stage, Marina Bay Sands: Act 5 (Rewriting the Future: Lenses of Experience) 10:00–12:00; Act 6 (The Growth Map) 13:00–15:00; Act 7 (The Wager) 15:30–16:40; Global Startup Pitch: Scaleup Winners 16:40–17:10; The Great WiT Debate 17:40–18:00; Closing Party incl. WiT For Good Charity Auction 18:30–20:30.
- **Notable 2026 detail (DOCUMENTED):** "Agentic AI Hackathon Finals: Meet The Top Three" runs on Wed 30 Sep at 15:10–15:30, judged by Timothy O'Neil-Dunne (T2Impact), Ross Veitch (Wego), **Mary Li (Atlas)**, and Rajnish Kumar (ixigo). This is materially relevant — Atlas's own CEO is on the judging panel. (witevents.com/witsingapore/programme)
- Closing Party charity: **Young Focus** (Philippines, Manila squatter communities). (DOCUMENTED — witevents.com/witsingapore/programme)

### 3.2 Atlas SIN feasibility — the critical constraint

The Atlas documented-sandbox route list (SANDBOX_COVERAGE_MATRIX.md, verified 2026-08-19) **does not include any Singapore (SIN) route** across its 36 documented entries. This is the direct feasibility question for Scenario 1.

Two honest branches:

**Branch A — Probe-based realism.** Treat SIN Search as a probe; the engine should call `search.do(origin, SIN, ...)` and accept whatever the sandbox returns (offers, empty fixture, or error). For S1 we deliberately pick an origin whose SIN route is **plausible to test** but with no expectation that it returns a populated fixture in the current sandbox. The scenario is engineered to **continue working** whether the probe returns:
- non-empty offers (best case) → real Atlas Search normalisation exercised;
- an empty fixture (status 0, zero offers — the documented behaviour on 6/36 routes) → engine still plans/recovers using REPLAY/RECORD or context;
- error → engine marks `ATLAS_SIN_PROBE_FAILED` and falls back.

This is the only honest behaviour and is consistent with NFR-03 (external dependency resilience) and the existing Checkpoint C demo path.

**Branch B — Recorded SIN data.** Once Atlas credentials allow it, we can RECORD a live SIN Search response and replay it through the same normalizer. This mirrors how existing REPLAY recordings flow and would let S1 use recorded offer shapes without depending on the documented fixture list.

The portfolio recommendation (Section 7) is built on Branch A: the engine must be robust regardless of SIN fixture state.

### 3.3 Speaker candidate pool (real public names, with uncertainty labels)

The 2026 speakers page (witevents.com/witsingapore/speakers/) lists ~50+ public names with title, company, and a written bio for most. The table below filters to speakers whose **company / working base is most plausibly connected to a known Atlas-sandbox reachable airport** OR who otherwise offer a high-value story for the scenario family. Base labels follow the convention in the brief: **HQ as reasoned proxy only**, always labelled.

Evidence labels:
- **DOCUMENTED** = quote on the public speaker bio or self-described location.
- **HQ_PROXY_INFERRED** = base is the company's public HQ because no other data is available; this is a *reasoned proxy*, not a claim about the speaker.
- **OBSERVED_LIVE_READ** = observed during this research session in a public LinkedIn snippet, press release, or about page.
- **INFERRED** = combination of HQ proxy + travel pattern / role description; explicit uncertainty preserved.
- **UNKNOWN** = not findable in this research pass.

| Speaker | Title & company | Likely base | Base label | Notes / event role |
| --- | --- | --- | --- | --- |
| **Tony Fernandes** | CEO, **Capital A Berhad** (AirAsia parent) | Kuala Lumpur (KUL) | HQ_PROXY_INFERRED — Capital A / AirAsia HQ is KUL; Fernandes' long-time working base. OBSERVED_LIVE_READ snippets reference Kuala Lumpur repeatedly. | High-visibility speaker; KUL→SIN fits the Atlas "Flyadeal RUH-JED" family, but KUL is **not** a documented Atlas route. Requires SIN-probe branch. |
| **Mary Li** | CEO & Co-founder, **Atlas** | Singapore (per LinkedIn URL `sg.linkedin.com/in/mary-li-62a799168`) | OBSERVED_LIVE_READ — LinkedIn shows Singapore region. Bio mentions "back with a new start-up" (Atlas) and Bangalore tenure at Mystifly. | Atlas CEO — meta-relevant, on the hackathon hackathon judging panel. Already in SIN; outbound may be a regional post-event trip. |
| **Mathias Hedlund** | CEO, **Etraveli Group** | Uppsala / Stockholm, Sweden (ARN) | OBSERVED_LIVE_READ — Crunchbase shows Uppsala; press contacts show +46 SE phone; ContactOut shows Stockholm County, Sweden. | Long-haul origin. ARN→SIN would have to use SIN-probe branch. |
| **Tan Bee Leng** | CCO, **The Ascott Limited** (CapitaLand) | Singapore | OBSERVED_LIVE_READ — CapitaLand press contacts use +65 Singapore phone; capitaland.com domain. | Singapore-based, speaking locally. Likely **no inbound flight** — this is a useful *control* for "already-on-site" traveller variant. |
| **Laura Houldsworth** | MD & VP APAC, **Booking.com** | Singapore | OBSERVED_LIVE_READ — Booking.com Careers page: "Managing Director and VP of the APAC region, is based in our Singapore office." | Speaking at Innovation Day (Wed 30 Sep 10:10 panel). |
| **Marcus Yong** | VP Global Marketing, **Klook** | Singapore | OBSERVED_LIVE_READ — RocketReach: "Vice President Global Marketing. Singapore." Phone +65. | Speaking at Innovation Day coach breakouts. |
| **Jacinta Lim** | CEO & Co-founder, **Seek Sophie** | Singapore | OBSERVED_LIVE_READ — Crunchbase: "Seek Sophie is located in Singapore, Central Region, Singapore." | Innovation Day coach. |
| **Coney Dongre** | Research Manager, **Phocuswright** | India (HQ proxy Mumbai) | HQ_PROXY_INFERRED — no speaker bio address. Phocuswright India research presence. | Bootcamp 1:10pm "Travel Turns 21" talk. |
| **Rajesh Magow** | Co-founder & Group CEO, **MakeMyTrip** | Gurugram / Bengaluru (MakeMyTrip HQ) | HQ_PROXY_INFERRED — MakeMyTrip HQ is Gurugram. Speaker bio lists "Director of MakeMyTrip (India) Ltd. since June 19, 2026"; nothing about residence. | "Travel Turns 21"-era talk presence plausible. |
| **Sarosh Waghmar** | Founder, Co-Chairman & CPO, **Spotnana** | India (HQ proxy) / US presence | HQ_PROXY_INFERRED — Spotnana has "offices in the U.S., UK, and India." No speaker bio address. | Plausible long-haul India-origin or US-origin. |
| **Roger Sharp** | Chair, **North Ridge Partners** & **WebBeds** | New Zealand (Queenstown / Auckland) | OBSERVED_LIVE_READ — LinkedIn region: nz.linkedin.com; also a 2026 Otago Tourism Policy School speaker bio: "founder of North Ridge Partners, the Singapore-based technology investment bank." **Conflict: NZ LinkedIn vs Singapore-based firm profile.** Base label: HQ_PROXY_INFERRED + Singapore firm presence, primary NZ working base. | Useful as the "expat NZ / multi-base" case. |
| **Barathan Pasupathi** | CEO, **Jazeera Airways** | Kuwait (KWI) | OBSERVED_LIVE_READ — Jazeera IR page: "Singaporean and has more than 30 years of global aviation experience"; HQ and base = Kuwait. | Useful as the "Middle East origin" case. KWI→SIN not in documented Atlas routes; SIN-probe branch. |
| **Mike McGearty** | CEO & Co-founder, **Meili** | Dublin, Ireland (DUB) | OBSERVED_LIVE_READ — UCD press release: "Meili headquartered at NovaUCD in Dublin." | DUB→SIN — long-haul European origin. |
| **Timothy O'Neil-Dunne** | Principal, **T2Impact** | Kirkland, WA (USA) | OBSERVED_LIVE_READ — Phocuswright Conference bio: "now lives in Kirkland, WA USA." | Useful for "US west coast" case. |
| **Richard Valtr** | Founder, **Mews** | Brooklyn, NY (USA) | OBSERVED_LIVE_READ — Speaker bio: "From his Brooklyn home, he continues to provide inspirational leadership not only at Mews…" | Mews is hotel PMS — a useful **hotel-relevant** speaker for the hotel-materially-exercised constraint. |
| **Adilla Arantika** (a.k.a. Adilla Wiranto) | Regional Senior Manager, Partner Apps, **Grab** | Indonesia / Singapore (Grab dual) | HQ_PROXY_INFERRED — LinkedIn URL is `my.linkedin.com` (Malaysia) with role description "executing Grab Holdings' super-app strategy". | Indonesia-origin plausible (Arantika is an Indonesian name); Grab HQ Singapore. |
| **Nadia Omer** | CEO, **AirAsia MOVE** | Kuala Lumpur | HQ_PROXY_INFERRED — AirAsia MOVE HQ is KL. | Useful as a second KUL-origin candidate. |
| **Mathias Hedlund** | (above) | (above) | | |
| **Yoshiyuki Takano** | Group Senior Managing Executive Officer, **Rakuten Group** (Commerce & Marketing) | Tokyo | HQ_PROXY_INFERRED — Rakuten HQ is Tokyo; bio says "joined Rakuten, Inc. in 2002" + Waseda master's. Rakuten Optimism 2023 page lists him in Tokyo context. | Useful as a TYO-origin case (Atlas-documented SEL-TYO is the closest existing fixture). |

### 3.4 Speaker selection for the recommended portfolio

- **S1 picks Tony Fernandes (KUL→SIN).** Rationale: highest visible speaker name on the 2026 list with KUL as a strong HQ-proxy base. AirAsia's commercial relationship with the conference theme is natural. KUL→SIN requires the SIN-probe branch — the engine must show resilience when SIN Search returns an empty fixture.
- **S2 picks Marcus Yong (Klook, SGN or HKG → SIN).** Rationale: explicitly Singapore-based per OBSERVED_LIVE_READ, but the scenario's whole-trip intent is a traveller-initiated change (e.g. "I want to leave a day later to attend a Klook offsite first"). SGN/HKG origins are **also not in documented Atlas routes**, but they are well-served by SIN-probe. Importantly, this scenario exercises traveller-instruction precedence (FR-03) — the traveller explicitly waives the soft "speaker dinner" objective.
- Alternative speakers retained for fallback (not selected): Mary Li (SIN-local, no inbound flight — useful for "already on site" variant), Tan Bee Leng (Ascott — hotel-side, useful for "hotel-materially-exercised" emphasis), Richard Valtr (Mews, hotel PMS — useful for hotel rule-side narrative), Roger Sharp (NZ origin — useful for long-haul variant).

We do not require confirmation from WiT about any of this; we are using publicly listed speaker information and the public 2026 programme. Citations are at the end of this report.

---

## 4. Candidate list (11 candidates)

Each candidate is rated on the 20-criterion matrix in Section 5. Candidates are intentionally broad; only 3 are recommended for the portfolio.

| # | Codename | Class | One-line narrative | Disruption / trigger | Blast radius | Policy / authority angle | Capability surfaces | Expected outcome class | External-sandbox feasibility vs known Atlas fixtures + hotel/ground |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **C1** | WIT-AIR-CANCEL | External disruption | Invited speaker (Tony Fernandes, KUL) heading to WiT Singapore 2026 — KUL→SIN flight cancelled 18h before the 30 Sep Innovation Day at Pan Pacific. | FLIGHT_CANCELLATION by carrier | Outbound flight → ground transfer (SIN airport → Pan Pacific or MBS) → hotel check-in → Wed Innovation Day check-in → Day 1–2 Main Stage | Organiser spend limit (USD 1,500), per-leg approval threshold (USD 300) | Atlas Search (SIN probe), provider-state feed, hotel policy (late arrival / no-show), ground routing (Singapore) | **FULLY_RECOVERED** via airline rebooking on same-day + transfer reroute | KUL→SIN not in documented routes. SIN-probe branch. Hotel: Pan Pacific Singapore — public-facing chain, rule-set definable. Ground: SIN airport ↔ Pan Pacific (≈20 min) ↔ Marina Bay Sands (≈25 min). |
| **C2** | WIT-TRAV-WAIVE | Traveller-initiated change | Marcus Yong (Klook, SGN→SIN) at WiT Singapore — traveller wants to leave a day later to attend a Klook offsite, explicitly waives the soft "speaker dinner" objective. | TRAVELLER_CHANGE_INTENT (date shift + soft-objective waiver) | Outbound flight, hotel check-in date, dinner engagement, possibly Wednesday Innovation Day | Organiser policy covers reasonable rebooking fees; explicit traveller instruction overrides persistent preference | Atlas Search (SIN probe), traveller instruction precedence (FR-03), soft-objective waiver | **RECOVERED_WITH_LOSS** — dinner waived by traveller; rest recovered | SGN/HKG→SIN not in documented routes. SIN-probe branch. Hotel: same Pan Pacific scenario. |
| **C3** | TMC-MEX-RETURN | External disruption (corporate) | Beatriz Ortega (Northgate, MEX→GDL→MEX) — return leg MEX–GDL cancelled 3h before her 22 Sep 08:30 steering meeting at the MEX home office. | FLIGHT_CANCELLATION on return leg | Return flight → MEX airport → office transfer → 08:30 steering meeting | Employer policy: every flight change requires travel-manager approval; USD 400 spend cap | Atlas Search (MEX-GDL is documented; Cebu/JetBlue etc absent, but Volaris MEX-GDL has 45 documented offers), policy approval, hotel cancellation terms | **RECOVERED_WITH_LOSS** — earliest replacement still misses 08:30 buffer; traveller waives the steering attendance OR meeting moves to virtual. | MEX–GDL fully Atlas-documented (Volaris, 45 offers). Hotel: corporate-rate — definable. Ground: GDL airport ↔ hotel ↔ client site. **STRONGEST Atlas feasibility in the portfolio.** |
| **C4** | WIT-SCHED-PUSH | External disruption (event-side) | WiT announces a same-day schedule change (Main Stage "The Reckoning" Act 4 on Thu 1 Oct 16:00–17:40 pushed by 90 min due to a Hall-A issue). | EVENT_SCHEDULE_CHANGE for a PREFERRED engagement | Whole-day Thu 1 Oct Main Stage, possibly the speaker dinner (Fri) | None — event organiser decision | AnchorEvent webpage re-ingestion, schedule diff, dynamic context | **FULLY_RECOVERED** — entire block shifts coherently; no booking invalidation | Not flight-driven. Tests the AnchorEvent dynamic-context path. |
| **C5** | WIT-FAM-VISA | Hard downstream constraint | Speaker Mathias Hedlund (Etraveli, ARN→SIN) — 48h before departure, Sweden's MFA signals a 7-day consular processing delay for his SIN visa; trip threatens to start a day late. | IMMIGRATION_PROCESSING_DELAY | Outbound flight, Day 1 Wed Innovation Day attendance, possibly Day 2 if delay cascades | Authority: traveller cannot self-act on visa; only TMC/organiser escalation to embassy possible | Immigration/entry research (FR-17), Atlas Search (SIN probe), event policy re: missed sessions | **ESCALATION-REQUIRES_HUMAN** — system surfaces options and required human embassy interaction; engine holds the case open | Long-haul ARN→SIN; SIN-probe branch. Visa path exercised but not solved by the engine. |
| **C6** | TMC-CABIN-UPGRADE | Traveller-initiated change (preference) | Beatriz Ortega — wants an aisle seat on the new MEX–GDL replacement (persistent explicit preference) AND asks for a same-day upgrade to business under a one-off employer exception. | TRAVELLER_CHANGE_INTENT (preference + policy exception) | Outbound flight, possibly hotel (if business upgrade entitles lounge access) | Employer cabin rule (Economy only for <4h domestic); one-off exception approval | Persistent preference ingestion (FR-03), policy engine (rule_b_cabin), approval hierarchy | **RECOVERED_WITH_LOSS** — aisle granted; business upgrade declined by policy unless employer override; possibly no recovery on upgrade | MEX-GDL Atlas-documented (Volaris). Cabin rule exercised. |
| **C7** | WIT-HOTEL-DISPUTE | Traveller-initiated change (hotel) | Speaker (Mary Li, already in SIN) — wants to swap her Pan Pacific stay for a Marina Bay Sands stay to reduce ground time, after realising her Day 2 panel runs from 09:20. | TRAVELLER_CHANGE_INTENT (hotel switch) | Hotel change, possibly new ground context, possibly ground time reduction on Day 2 | Organiser policy: invited-speaker travel covers reasonable rebooking fees | Hotel policy/normalisation (Report 06 — pending), ground routing update (FR-16) | **FULLY_RECOVERED** with hotel swap and ground time preserved | SIN-internal; no Atlas flight leg required. Hotel switch and ground path both touched. |
| **C8** | WIT-CORP-CANCEL | External disruption (weather) | Roger Sharp (NZ origin) — NZ→SIN via SYD/MEL is cancelled at the gate due to a severe weather event in NZ, 6h before his Thu Main Stage 09:20 slot. | FLIGHT_CANCELLATION (weather, multi-leg) | Outbound (likely 2-leg), Day 1 attendance, possibly Day 2 | Organiser spend limit; traveller priority "make the panel" | Atlas Search (SIN probe), ground at SYD/MEL if reroute goes via there, weather context | **RECOVERED_WITH_LOSS** — possibly misses Day 1; Day 2 recoverable | SIN-probe; no NZ origin in documented routes. |
| **C9** | WIT-GROUP-CASCADE | Multi-traveller | Three invited speakers (Mary Li, Laura Houldsworth, Jacinta Lim — all SIN-based) on a shared group transfer from a side event back to MBS — transfer vehicle breaks down. | GROUND_DISRUPTION (group, 1 transfer) | Group transfer, all three speaker check-ins for Day 1 afternoon, possibly dinner | None (group-level operational decision) | Multi-traveller trip (PARK-3 / shared cascade — stretch per ROADMAP) | **FULLY_RECOVERED** via replacement ground transport | No flight leg. Multi-traveller cascade — currently a stretch per ROADMAP. |
| **C10** | WIT-INS-COVER | Insurance reasoning | Speaker (Mathias Hedlund, ARN→SIN) loses checked bag between ARN and SIN; insurance covers essentials up to USD 1,200, excess USD 50. | BAGGAGE_DELAY (separate from flight cancellation) | Baggage claim, hotel arrival essentials, Day 1 panel preparation | Organiser policy does not cover baggage; insurance rule set (FR-18) | Insurance policy reasoning, no flight change required | **FULLY_RECOVERED** via insurance claim and essentials purchase | No flight change. Insurance rule set exercised end-to-end. |
| **C11** | WIT-IRRECOVERABLE | Irrecoverable objective loss | Speaker (Tony Fernandes, KUL→SIN) — both KUL→SIN and KUL→SIN-via-KCH return empty fixtures, hotel inventory at Pan Pacific unavailable due to a confirmed event overbook, no road/rail alternative. All strategies fail. | COMPOUND: flight search empty + hotel unavailable | Hard objective (Innovation Day keynote) | Authority: cannot act; escalate | Atlas Search empty fixture path, hotel unavailability path, escalation rule | **ESCALATION-REQUIRES_HUMAN** — engine must not fabricate strategies; surfaces honest "no feasible strategy" with escalation path | SIN-probe + hotel unavailability combined — exercises FR-03 + NFR-03 (graceful failure). |

---

## 5. Scoring matrix (20 criteria, 1-5 each)

Criteria (recap from brief, with intent):

1. **Realism** — would this happen in a real TMC/event-organiser's life next quarter?
2. **Severity / operator pain** — how much does it hurt the operator when it does happen?
3. **Frequency / plausibility** — likelihood of occurrence.
4. **Cross-segment blast radius** — how many segments downstream (flight → ground → hotel → objective).
5. **Non-obvious recovery** — does the engine earn its keep, or is the answer obvious?
6. **Atlas relevance** — does this exercise Atlas's actual Search/Verify/rules surface?
7. **Hotel relevance** — does it materially exercise hotel ingestion / policy / change?
8. **Ground-routing relevance** — does it exercise ground / transfer time research?
9. **Policy relevance** — does it exercise one of the policy kinds in the system?
10. **Authority / approval relevance** — does it trigger an authority decision?
11. **Dynamic context relevance** — does it need a live web/event/schedule/weather source?
12. **Traveller-preference / instruction relevance** — does it exercise FR-03 precedence?
13. **Uncertainty / reasoning depth** — does the engine have to express unknowns?
14. **External sandbox feasibility** — can the scenario run on currently-documented Atlas fixtures + non-Atlas sources we control?
15. **Whole-trip recovery proof** — does the recovery demonstration cover the full trip, not just the disrupted leg?
16. **Generalisation contribution** — does it add a new dimension to the MVP?
17. **Difference from other selected** — does it avoid overlap?
18. **Implementation cost (inverse)** — 5 = very cheap to implement, 1 = expensive.
19. **Demo explainability** — can a non-engineer follow the demo?
20. **Failure / fallback controllability** — does the scenario have predictable, disclosed fallbacks?

| Criterion (1-5) | C1 WIT-AIR-CANCEL | C2 WIT-TRAV-WAIVE | C3 TMC-MEX-RETURN | C4 WIT-SCHED-PUSH | C5 WIT-FAM-VISA | C6 TMC-CABIN-UPGRADE | C7 WIT-HOTEL-DISPUTE | C8 WIT-CORP-CANCEL | C9 WIT-GROUP-CASCADE | C10 WIT-INS-COVER | C11 WIT-IRRECOVERABLE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1. Realism | 5 | 5 | 5 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 3 |
| 2. Severity / pain | 4 | 3 | 5 | 2 | 5 | 2 | 2 | 4 | 3 | 2 | 5 |
| 3. Frequency | 4 | 4 | 3 | 3 | 2 | 4 | 3 | 3 | 2 | 3 | 1 |
| 4. Cross-segment blast | 5 | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 1 | 4 |
| 5. Non-obvious recovery | 3 | 4 | 4 | 2 | 5 | 3 | 3 | 3 | 3 | 2 | 5 |
| 6. Atlas relevance | 3 (probe) | 3 (probe) | 5 | 1 | 3 (probe) | 5 | 1 | 3 (probe) | 1 | 1 | 3 (probe) |
| 7. Hotel relevance | 4 | 4 | 4 | 1 | 3 | 1 | 5 | 3 | 1 | 1 | 5 |
| 8. Ground relevance | 4 | 3 | 4 | 1 | 3 | 1 | 4 | 3 | 5 | 1 | 1 |
| 9. Policy relevance | 5 | 4 | 5 | 1 | 4 | 5 | 4 | 4 | 2 | 5 | 4 |
| 10. Authority relevance | 4 | 4 | 5 | 1 | 5 | 4 | 3 | 4 | 2 | 2 | 4 |
| 11. Dynamic context | 3 | 3 | 2 | 5 | 5 | 2 | 3 | 5 | 2 | 1 | 3 |
| 12. Traveller preference | 3 | 5 | 2 | 1 | 2 | 5 | 3 | 2 | 2 | 1 | 2 |
| 13. Uncertainty / reasoning | 3 | 4 | 4 | 2 | 5 | 3 | 3 | 4 | 2 | 3 | 5 |
| 14. External sandbox feasibility | 2 (SIN probe) | 2 (SIN probe) | 5 (MEX-GDL doc) | 4 | 2 (SIN probe) | 5 | 4 (no flight) | 2 (SIN probe) | 4 | 4 | 2 (SIN probe) |
| 15. Whole-trip recovery | 5 | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 1 | 4 |
| 16. Generalisation contribution | 4 | 5 | 4 | 3 | 4 | 3 | 3 | 3 | 5 | 3 | 5 |
| 17. Difference from selected | 5 | 5 | 5 | 4 | 4 | 3 | 3 | 3 | 5 | 4 | 4 |
| 18. Implementation cost (inv) | 3 | 3 | 5 | 4 | 2 | 4 | 3 | 3 | 2 | 4 | 3 |
| 19. Demo explainability | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 5 |
| 20. Failure / fallback control | 3 | 3 | 5 | 5 | 2 | 4 | 4 | 3 | 3 | 4 | 5 |
| **Sum (max 100)** | **75** | **76** | **84** | **54** | **70** | **64** | **61** | **66** | **57** | **50** | **72** |

### 5.1 Why not just pick the top three (C3, C2, C1)?

- C3 (84), C2 (76), C1 (75) are the top three by sum. The portfolio **does** use C1 and C3 (under their family names S1 / S3) and uses C2 (S2). But the scoring alone would have missed:
  - C1 and C2 are both KUL/SGN-to-SIN SIN-probe cases. Together they risk being a "SIN feature" rather than a generalisation feature. C1 + C3 (carry-over TMC) is the genuinely complementary pair.
  - C11 (irrecoverable / honest no-strategy) is *low* on sum (72) but **highest** on generalisation contribution (5) and failure controllability (5). It is the most important scenario for proving the engine **does not fabricate**. The brief explicitly asks for "recoverable vs irrecoverable objective loss" — C11 must be available as an injectable alternative for S1's disruption profile, even if it is not a portfolio slot.
  - C5 (visa) has the highest reasoning depth and authority path but the lowest sandbox feasibility (SIN probe + visa is too many unknown surfaces) — keep as an injectable variant of S1, not its own slot.
  - C4 (event schedule push) is a critical AnchorEvent dynamic-context test but is *not* a flight case; it does not help the portfolio prove the flight capability.

The brief constraint was to pick with **complementary coverage**, not pure top-sum.

---

## 6. Portfolio recommendation + coverage matrix

### 6.1 Portfolio (3 demo scenarios + 1 truth test)

| Slot | ID | Title | Origin / destination | Disruption | Outcome class | Engine feature set |
| --- | --- | --- | --- | --- | --- | --- |
| **S1** | C1 (selected) | Invited speaker Tony Fernandes — KUL→SIN cancelled before Innovation Day | KUL → SIN, 30 Sep 2026 | Atlas `search.do` SIN-probe returns either an offer, an empty fixture, or an error (all three are honest outcomes) | **FULLY_RECOVERED** | Atlas Search/Verify/rules, hotel rule-set, ground routing, organiser policy, traveller confirmation authority |
| **S2** | C2 (selected) | Same event, traveller-initiated change — Marcus Yong (Klook) shifts to a later flight and waives the speaker dinner | SGN or HKG → SIN, 30 Sep 2026 | Traveller change-intent + soft-objective waiver | **RECOVERED_WITH_LOSS** (dinner waived by traveller) | FR-03 precedence (current instruction overrides persistent), Atlas SIN-probe, soft-objective waiver evidence, hotel date shift |
| **S3** | C3 (selected) | Corporate TMC — Beatriz Ortega (Northgate) MEX→GDL→MEX return cancelled 3h before Monday 08:30 steering meeting | MEX–GDL, 21 Sep 2026 | Volaris MEX-GDL Atlas-documented route | **RECOVERED_WITH_LOSS** (traveller waives in-person steering; meeting moves to virtual) | Atlas documented Volaris route, employer policy + travel-manager approval, hotel refundable-terms, ground in MEX |
| **S0** | BYOT | Bring-Your-Own-Trip — raw event page + flight email + hotel PDF → generic pipeline → injected flight change | varies | One simple injected signal | N/A — engineering truth test | Generic assembly + ingestion + signal + plan + reset (per Section 2) |

### 6.2 Coverage matrix

| Required coverage dimension (from brief) | S1 | S2 | S3 | S0 | Notes |
| --- | :-: | :-: | :-: | :-: | --- |
| At least one **traveller-initiated change** | — | ✔ | — | — | S2 is the only traveller-initiated portfolio slot. C6 is a candidate variant. |
| At least one **external disruption** | ✔ | — | ✔ | (BYOT) | S1 + S3 cover external disruption. |
| At least one materially exercising **hotel** | ✔ (Pan Pacific) | ✔ (Pan Pacific date shift) | ✔ (Centro Executive refundable) | ✔ (hotel PDF) | All four scenarios materially exercise hotel rule ingestion. |
| At least one exercising **organisational / event policy or approval** | ✔ (organiser spend cap) | ✔ (organiser rebooking-fee rule + traveller instruction) | ✔ (employer every-change-approval rule) | — | All three demo scenarios exercise policy. |
| Different final outcomes across portfolio | FULLY | LOSS (dinner) | LOSS (steering) | N/A | S1 vs S2/S3 give the required outcome variety. |
| **Atlas-documented route** (no SIN probe needed) | — | — | ✔ | varies | Only S3 uses a fully-documented route. This is intentional. |
| **External ingestion (raw sources)** | partial | partial | partial | ✔ (full) | BYOT is the only full external-ingestion truth test. |
| **Multi-traveller / group** (stretch per ROADMAP) | — | — | — | — | Out of MVP scope; C9 retained as candidate. |
| **Irrecoverable / honest no-strategy** (C11) | injectable as S1-alt | — | — | — | C11 is an injectable alternative for S1 — same scenario shape, different disruption path. The engine must prove it can return a `bestStrategyId = undefined` honestly. |
| **Atlas SIN probe branch exercised** | ✔ | ✔ | — | — | S1 + S2 explicitly exercise the SIN-probe resilience path. |
| **Atlas verified documented fixture exercised** | — | — | ✔ (Volaris MEX-GDL) | — | S3 is the only scenario that uses a fully-documented Atlas route end-to-end. |

### 6.3 Complementarity rationale (explicit)

- **S1 vs S2 — same operator + event, different trigger.** Both S1 and S2 are invited-speaker / event-organiser cases anchored on WiT Singapore 2026. This proves the engine does not have an "event-side" branch and a "traveller-side" branch — the same engine takes a `FLIGHT_CANCELLATION` signal in S1 and a `TRAVELLER_CHANGE_INTENT` signal in S2 and produces structurally different (but reusable) recovery paths. FR-03 precedence is only visible in S2.
- **S3 — different operator + vertical.** S3 is TMC / corporate and uses a fully Atlas-documented route (Volaris MEX-GDL). This is the *only* portfolio slot that is guaranteed not to depend on the SIN-probe branch. It is the safety net if Atlas probe results are unfavourable on the day, and it covers the "approval-required" branch of the authority engine that S1's small fare delta (under the USD 300 organiser threshold) does not exercise.
- **S0 — orthogonal dimension.** S0 is the only scenario that does not start from a pre-shaped JSON. It is a regression test, not a story, but its presence is what makes the other three defensible as "generalised."

### 6.4 Honest coverage gaps

- **Multi-traveller / shared cascade** (C9) is a stretch per ROADMAP and is **not** in the portfolio. We retain the candidate.
- **Insurance-claim end-to-end** (C10) is not a portfolio slot but is exercised in C1's insurance rule set as a "what's covered" signal.
- **Real Google Routes live** (FR-16) is configured in some candidates; if Google Routes is not configured at run time, the engine degrades to replay/sourced/unknown per the DEMO brief.
- **Atlas order/change/refund execution** (a stretch per ROADMAP) is not exercised in the portfolio. The engine uses `flight.change` as the action operation; the execution path is recorded/replayed/simulated per the LIVE/REPLAY boundary in DEMO.md.
- **SIN-probe may return nothing usable.** The portfolio does not depend on a positive SIN-probe result. S3 is the safety net.

---

## 7. Findings triaged

### 7.1 What we know with high confidence (DOCUMENTED / OBSERVED_LIVE_READ)

- WiT Singapore 2026 dates: 30 Sep – 2 Oct 2026. (witevents.com/witsingapore/, Vendelux event page.)
- Main venue: Marina Bay Sands Expo & Convention Centre. Innovation Day at Pan Pacific Singapore. (witevents.com/witsingapore/, programme page.)
- Theme: "21: A New Beginning." (witevents.com/witsingapore/.)
- Founder: Yeoh Siew Hoon. Parent: Northstar Travel Group. (witevents.com/witsingapore/.)
- Speaker list and bios are published at witevents.com/witsingapore/speakers/; the 2026 Agentic AI Hackathon Finals is judged by Mary Li (Atlas) among others.
- Atlas documented sandbox routes do not include SIN. (SANDBOX_COVERAGE_MATRIX.md.)
- Existing Checkpoint C scenario shapes for `anchor-event-speaker` (KUL→SIN scenario exists in shape; current fixture uses SEL→NRT) and `corporate-tmc` (MEX–GDL) are the closest starting points.
- Several speakers' working bases are publicly observable: Laura Houldsworth (Singapore, Booking.com Careers); Marcus Yong (Singapore, RocketReach); Mary Li (Singapore region, LinkedIn); Mathias Hedlund (Uppsala/Stockholm, Crunchbase + ContactOut); Barathan Pasupathi (Kuwait, Jazeera IR); Mike McGearty (Dublin, UCD press release); Richard Valtr (Brooklyn, Mews bio); Timothy O'Neil-Dunne (Kirkland WA, Phocuswright bio); Jacinta Lim (Singapore, Crunchbase); Tony Fernandes (Kuala Lumpur, Capital A press).

### 7.2 What is INFERRED with explicit uncertainty (HQ-as-proxy)

- Roger Sharp's working base is **dual**: NZ (LinkedIn) and Singapore-based firm (North Ridge Partners). Used as the long-haul NZ/multi-base case.
- Rajesh Magow (MakeMyTrip) base labelled as Gurugram HQ proxy.
- Coney Dongre (Phocuswright India) base labelled as Mumbai HQ proxy.
- Sarosh Waghmar (Spotnana) base labelled as US/India multi-HQ proxy.
- Adilla Arantika (Grab) base labelled as Indonesia/Singapore Grab-dual-HQ proxy.
- Yoshiyuki Takano (Rakuten) base labelled as Tokyo HQ proxy (Rakuten HQ).
- Tan Bee Leng (Ascott/CapitaLand) Singapore — high confidence via public +65 phone and CapitaLand emails.

### 7.3 What is UNKNOWN

- Whether the Atlas sandbox will return any offers for KUL→SIN or SGN→SIN or HKG→SIN on the day of the demo. This is precisely why the SIN-probe branch is built into S1 and S2.
- WiT's actual invited-speaker travel process. The scenario does not need to know it; we model the organiser using a published-style policy. (No contact was made with WiT.)
- Whether Atlas's own Mary Li is travelling to WiT from SIN or from a recent other location. (Singapore is her LinkedIn region; the meta-relevance is interesting but not a scenario dependency.)
- Whether Pan Pacific Singapore has a public no-show cutoff for the Innovation Day. (We will model a realistic chain-style policy; this is unverified.)

### 7.4 Triage decisions

- **Adopt for the recommended portfolio:** S1 (C1), S2 (C2), S3 (C3), S0 (BYOT). See Section 6.
- **Adopt as injectable variants (same scenario shape, different disruption path):** C11 (irrecoverable — exercises honest no-strategy), C5 (visa — exercises authority escalation), C8 (weather — exercises multi-leg). These are *not* separate demo slots; they are alternative `disruption` payloads the engine can be tested against.
- **Keep as candidates for later expansion (not in MVP portfolio):** C4 (event schedule push), C6 (cabin upgrade), C7 (hotel switch), C9 (multi-traveller cascade), C10 (insurance).
- **Reject for MVP:** none.

### 7.5 Open follow-ups (for subsequent reports)

- Report 05 should explicitly model the SIN-probe branch in the assembly/ingestion pipeline so that S1 and S2 can be authored with confidence regardless of what Atlas returns.
- Report 06 (hotel) should produce a Pan Pacific / Marina Bay Sands rule-set shape that the engine can ingest.
- The Atlas Singapore routes investigation noted in ROADMAP ("Atlas Singapore sandbox routes — Investigate Now") should be checked for an update before final demo. If a SIN route is confirmed, S1's path becomes "fully-documented" rather than "probe-resilient" and S3's role shifts from safety net to "different vertical" purely.
- A second polished TMC demonstration is a stretch per ROADMAP; C3 (TMC) is the underlying data; the demo polish is a separate workstream.

---

## 8. Citations (URLs accessed during this research)

WiT Singapore 2026:
- witevents.com/witsingapore/ — official landing page (theme, dates, programme at a glance, contacts).
- witevents.com/witsingapore/speakers/ — full 2026 speaker list with bios.
- witevents.com/witsingapore/programme — full Wed/Thu/Fri schedule with speakers.
- witevents.com/witsingapore/venue/ — venue details.
- webintravel.com/unveiling-the-next-20-theme-for-wit-singapore-2025-marking-a-bold-new-chapter-in-travel-innovation/ — 2025 theme announcement and Siew Hoon quote (for prior-edition comparison).
- vendelux.com/app/event/wit-singapore-2026/... — third-party event stats (projected 750 attendance, demographics).

Speaker working-base / company data (for uncertainty labels):
- LinkedIn profile URLs and snippets: Mary Li (sg.linkedin.com), Marcus Yong (RocketReach), Roger Sharp (nz.linkedin.com), Timothy O'Neil-Dunne (Phocuswright bio), Mathias Hedlund (Crunchbase/ContactOut), Mike McGearty (UCD press release), Jacinta Lim (Crunchbase), Richard Valtr (Mews bio), Laura Houldsworth (Booking.com Careers).
- Jazeera Airways IR (Barathan Pasupathi).
- Capital A / AirAsia press (Tony Fernandes, KUL).
- CapitaLand (Tan Bee Leng, +65 phone).
- Spotnana (Sarosh Waghmar, US/UK/India offices).

Atlas (read-only):
- SANDBOX_COVERAGE_MATRIX.md (verified 2026-08-19) — 36 documented routes, no SIN.
- ATLAS_FINAL_CAPABILITY_REPORT.md — Search/Verify/rules proven; order/change/refund documented-not-proven.

Product repo (read-only):
- fixtures/scenarios/anchor-event-speaker/scenario.json — current scenario shape.
- fixtures/scenarios/corporate-tmc/scenario.json — current scenario shape.
- docs/DEMO.md, docs/PRODUCT_SPEC.md, docs/ROADMAP.md.

### Evidence-label recap

- DOCUMENTED — explicit, citable text on a public page.
- OBSERVED_LIVE_READ — observed in a public LinkedIn / press / bio snippet during this research session.
- INFERRED — derived from HQ-as-proxy or role pattern; uncertainty preserved.
- UNKNOWN — not findable in this research pass.

---

*End of report. No implementation has been performed.*
