# Roadmap

This is the source of truth for **product capability scope/status**. It is not
the active day-to-day execution tracker — several subordinate plans have been
spawned as the hackathon advanced. Use the cadence below so status language
does not fight the wrong document.

Intentionally excluded work must remain here; do not silently drop it.

Status vocabulary:
- **Implemented**
- **In Progress**
- **Planned MVP**
- **Stretch**
- **Deferred**
- **Blocked**
- **Rejected**

## Current cadence (read this first)

Product face: **Northstar** — the AI resolution layer for event travel
(generalized trip-resolution engine underneath). Public entry:
[`README.md`](../README.md).

| Doc | Owns | Current tip |
|---|---|---|
| **This file (`ROADMAP.md`)** | Capability scope / status, Stretch/Deferred/Rejected | Capability inventory below |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Parent execution SSOT (checkpoints, Northstar waves, work-package table) | Historical + parent; see its header for accepted gates |
| [`WAVE3R_DEMO_READINESS_PLAN.md`](WAVE3R_DEMO_READINESS_PLAN.md) | Stricter post–NS-G3 demo-readiness / live-validation contract | Supersedes the original NS-G3 closure path only |
| [`LIVE_SCENARIO_READINESS.md`](LIVE_SCENARIO_READINESS.md) | S1–S8 backend readiness through ordinary product boundaries | **SEMANTIC READY** on REPLAY; LIVE/RECORD still credential-gated |
| [`FINAL_DEMO_INTEGRATION_PLAN.md`](FINAL_DEMO_INTEGRATION_PLAN.md) | **Active product-closure runway** (UI/operability → freeze → submit) | **R3D accepted; R3E next** |

Rough timeline (do not reopen accepted gates from this summary):

1. **Checkpoints A → B → C** — accepted engine foundation / demo-candidate baseline (`3b2f0da…`).
2. **Reality Validation + Northstar waves** — RV-N0 contract freeze; NS-G1 / NS-G2 accepted; original NS-G3 **not** accepted.
3. **Wave 3R + AiT scenario readiness** — production-shaped demo/provider honesty; S1–S8 semantic readiness on REPLAY.
4. **Final demo integration (current)** — live-product UI convergence on `main` (**R3D**); remaining runway **R3E → R4 → Final Candidate → R5 freeze → submit**.

If an older ROADMAP paragraph still sounds like “Reality Validation is the next
milestone before any product face,” treat that as historical framing for the
capability gap it describes, not as “what to work on today.” Today’s human-
facing closure work is governed by `FINAL_DEMO_INTEGRATION_PLAN.md`.

## Planned MVP

Capability status: the Scenario A vertical recovery loop (ingestion -> persistent trip -> signal/impact -> planner/capabilities/viability -> authority/execution/observation -> real operator/traveller read models) is **Implemented** and Checkpoint B has been **accepted** (REV-B Complete; reviewed candidate `b650031`, merged to `main`). Checkpoint C (generalisation, reliability, demo candidate) is **accepted** (REV-C Complete; accepted SHA `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d`, merged to `main`): Scenario B runs through the identical application code, four robustness cases pass through the real engine, the hardcoding audit found no scenario content outside `fixtures/`, and the generic runtime disruption/reset flow is reliable and replayable. Execution evidence lives in `docs/IMPLEMENTATION_PLAN.md` Section 4.

Truth boundary: the engine has been proven against **curated/provider-shaped scenarios** (fixture sources, REPLAY provider recordings, scripted/test planner inputs). Broader arbitrary external-input proof (any booking import, any URL → Trip, unbounded live servicing) was the Reality Validation milestone’s purpose; programme-scale Northstar execution and final-demo closure have since advanced on top of that baseline. Remaining LIVE/RECORD evidence gaps stay explicit in `LIVE_SCENARIO_READINESS.md` and Stretch/Deferred below — they do not reopen Checkpoint C.

### Northstar scenario catalogue (frozen — `docs/SCENARIOS.md`)

The final product scenario set is frozen at 8 scenarios; `docs/SCENARIOS.md` is
the source of truth for scenario business narratives, capability claims,
implementation priority and demo intent.

- **AiT LIVE Scenario Backend Readiness — SEMANTIC READY** (evidence on the live-integration line; see `docs/LIVE_SCENARIO_READINESS.md`): all S1–S8 run through natural product/application boundaries and the same generalized state/recovery/authority engine; manifests assert engine-derived semantics (impact propagation, viability arithmetic, funding/authority, counterfactual preview, honest uncertainty) with broken-expectation failure proofs. S5, S6 and S8 were promoted from their historical G3R Stretch status for that work package. Explicit simulation boundary remains limited to S1 forced supplier facts, S2 physical missed-connection/provider-reprotection facts when a sandbox cannot generate them, and unsupported Atlas refund execution. **LIVE/RECORD provider evidence** remains open and credential-gated — it is not the same thing as “product UI not ready.” Human-facing closure continues under `docs/FINAL_DEMO_INTEGRATION_PLAN.md` (R3D accepted; R3E next). Final-video selection detail: `docs/WAVE3R_DEMO_READINESS_PLAN.md` / `docs/SCENARIOS.md`; S6 is capability evidence/fallback, not primary video scope.
- **Execution record:** `docs/LIVE_SCENARIO_READINESS.md` defines the bounded
  work packages, anti-hardcoding obligations, and readiness gate. It forbids
  scenario-specific ontology or source branching.

ID disambiguation: the "S1..S8" labels in the post-NS-G3 stretch pull list in
the Northstar scope record below (Hotelbeds Transfers, immigration, etc.) are a
different, older numbering scheme for integration stretch items, not the
scenario catalogue IDs in `docs/SCENARIOS.md`.

### Core state and recovery engine
- Organisation, Traveller, AnchorEvent, Trip, TripElement, TripObjective, Place
- RuleSet/Policy and Constraint model
- TripSignal normalization
- deterministic graph/state mutation
- provenance/freshness for critical facts
- deterministic time/timezone/buffer checks
- dependency propagation and blast-radius ImpactAssessment
- scenario overlays and deterministic viability evaluation
- RecoveryCase state machine
- deterministic AuthorityEngine
- ActionIntent / execution result / observation loop
- SQLite-backed repository interfaces
- audit history

### Context and ingestion
- AnchorEvent webpage/schedule/briefing ingestion
- traveller profile
- explicit preference ingestion
- latent preference inference as soft signal
- booking confirmation/email/PDF/manual import path
- hotel/supplier policy ingestion
- organisation/event policy
- one insurance policy/document
- immigration/entry research with source/uncertainty
- local routing via Google Routes when configured, with non-blocking replay/fallback

### Intelligence
- Alibaba Model Studio structured extraction and mapping
- semantic consequence/objective interpretation
- uncertainty identification
- RecoveryPlanner structured strategy generation
- strategy comparison/ranking after deterministic viability
- agentic web research for dynamic context

### Flight capability — mandatory MVP surface
- Atlas direct `search.do`
- Atlas `verify.do`
- Atlas fare/change/refund/no-show rule normalization needed by recovery
- LIVE development proof plus RECORD/REPLAY through the same normalizer

### Hotel capability — Planned MVP (Northstar, RV-N7; recording discipline with RV-N6)
Promoted from Stretch investigation to Planned MVP by the RV-N0 contract freeze; promoted further to **MINIMUM with one proper real hotel API adapter** by the post-N0 execution-plan reconciliation:
- provider-neutral `HotelCapability` seam: search/quote/book/retrieve plus context/modify/cancel (contracts frozen at `NORTHSTAR_CONTRACT_BASE_SHA`)
- one proper real hotel API adapter is **MINIMUM**: candidate was Duffel Stays first, Nuitée fallback if empirical access fails; real/sandbox lifecycle search / quote-or-revalidate / book / retrieve / policy / cancel as available
- change treated as cancel+rebook until a provider exposes real modification endpoints
- LIVE/SANDBOX and REPLAY share normalization/downstream code; Booking.com Demand API remains a further candidate if partner credentials are immediately practical

**Status (WP-R4-REDO — Nuitée fallback fired):** Duffel Stays is unavailable in Singapore, which is the empirical access failure foreseen by the plan, so the documented fallback clause fired as designed (exercised, not overridden). The **Nuitée / liteAPI adapter** (`providerId: nuitee`) is now **wired and proven against a genuine sandbox capture**: composed into the runtime, `hotel.*` read-only tool operations route through it, `NUITEE_API_KEY` / `NUITEE_SEARCH_BASE_URL` / `NUITEE_BOOKING_BASE_URL` are registered with fail-closed NOT_CONFIGURED LIVE/RECORD, and `fixtures/recordings/nuitee/` holds a sanitized RECORD capture of the real search → quote → book → retrieve → stay-context → cancel chain (sandbox booking created then cancelled). Provider-shape honesty: liteAPI has no in-place stay modification, so `modifyStay` returns a structured UNAVAILABLE failure and the descriptor omits `hotel.modify` — the frozen HotelCapability never widens; cancel + rebook remains the supported change path. The REV-2 WP-R4 withdrawal of RV-N7's MINIMUM claim is lifted by this genuine evidence.

### Product surfaces
- role-neutral operator dashboard/read models
- traveller trip page/conversation/read models
- approvals/input flow
- visible disruption -> impact -> recovery -> resolved transition
- loading/error/unknown states

### Reliability and generalisation
- LIVE / RECORD / REPLAY provider modes where practical
- external provider/model failures represented as structured failures
- deterministic reset/reseed
- persistent Trip/Case state
- at least two materially different scenarios through same engine
- anti-hardcoding scenario substitution test

## Reality Validation — largely executed; open gaps remain capability/evidence items

**Purpose:** prove that the generalized engine works against externally sourced / provider-produced inputs rather than only curated scenario fixtures.

**Status (cadence):** milestone opened at Checkpoint C closeout. Investigation phase completed (11 reality-validation reports + synthesis on `main`). Programme-scale **Northstar wave** execution advanced through RV-N0 (contract freeze), NS-G1, NS-G2, and Independent Review 2. The original NS-G3 product checkpoint was **not** accepted and was superseded by the stricter Wave 3R / demo-readiness path (`docs/WAVE3R_DEMO_READINESS_PLAN.md`), then by AiT scenario semantic readiness and the Final Demo Integration runway. **Do not treat this section as “the active tip of the repo.”** Active human-facing closure is `docs/FINAL_DEMO_INTEGRATION_PLAN.md` (R3D accepted; R3E next). Remaining Reality Validation–shaped work is mostly explicit LIVE/RECORD evidence, Stretch pulls, or Deferred items — not a greenfield milestone restart.

Historical wave framing (retained for evidence navigation): Wave 1 → NS-G1 → Wave 2 → NS-G2 → Review 2 → (original) Wave 3 / NS-G3 → Stretch pull → Wave 4 / Final Candidate. Executable contracts remain immutable at `NORTHSTAR_CONTRACT_BASE_SHA`; see `docs/IMPLEMENTATION_PLAN.md` Section 13.

For each external surface the milestone investigated and decided where to use: real external source content; provider sandbox/test APIs; LIVE read-only APIs where low-risk and economically bounded; RECORD/REPLAY; or external-boundary simulation only where real/sandbox access is not worth the complexity. Decisions end with an explicit `Adopt | Defer | Reject` and a roadmap/tracker update.

### Investigation areas (high level)

1. **Atlas sandbox capability reality pass** — actual Search/Verify/rules and relevant sandbox operations; verify Singapore-route availability empirically rather than assuming the published fixture list is exhaustive; investigate bounded sandbox order/change/refund capability where useful.
2. **Hotel provider investigation** — compare providers based on BOTH hackathon sandbox feasibility and credible future TMC adoption; hotel search/availability/quote; booking; modification/rebooking; cancellation; supplier policy/rule data.
3. **Ground routing / transport** — Google Routes LIVE with strict spend/usage guardrails if economically safe; investigate transactional ground-transfer sandbox APIs separately.
4. **Generic real-source ingestion** — URL ingestion; event pages; webpages; booking confirmations; PDFs/documents; email/plain text; policies.
5. **Generic Trip assembly** — arbitrary imported sources -> Trip; entity resolution; timezone/place resolution; dependency proposals; objective/context extraction; uncertainty handling.
6. **Dynamic context/research** — event schedules; supplier policies; immigration/entry context; insurance; organisation policy; local operating context.
7. **Model Studio reality pass** — actual Qwen extraction/planning against previously unseen real-world inputs.
8. **Traveller-initiated change / resolution** — the system must support not only externally caused disruptions but also traveller-requested changes: fly a different day; fly at a different time; take a different route; extend or shorten a stay; change hotel; leave earlier/later; reprioritise an objective; voluntarily abandon an objective; request a preference-driven modification. These enter the **same** generalized engine as TripSignals / change intents and trigger: intent/change -> state/context update -> blast radius -> recovery/resolution strategies -> deterministic whole-trip viability -> policy/authority -> execution -> observation -> resolved state. No second "traveller modification engine" is created; this is central to the wider Trip Resolution thesis.

### Northstar scope record (frozen at RV-N0, corrected at NORTHSTAR_EXECUTION_BASE)

Northstar = the AI resolution layer for event travel: one programme at a time (~40–45 inbound travellers), generic across tournaments, corporate offsites, productions, conferences.

Scope corrections recorded at the docs-only execution-plan reconciliation (see `IMPLEMENTATION_PLAN.md` Section 13): LLM-assisted traveller/event-list mapping is **MINIMUM** (not Stretch); one proper real hotel API adapter (Duffel Stays first, Nuitée fallback) is **MINIMUM** (not Stretch); immigration/entry is **Stretch P1** (not Park); traveller mobile surface is explicit MIN scope.

- **MIN:** programme aggregate + shared commitments (per-traveller importance); pre-authoritative intake drafts (manual + bulk CSV/XLSX/table + LLM-assisted mapping of reasonable messy lists/briefs) promoted through the frozen mutation path; initial planning through the same engine; declarative ChangeRequest/ResolutionTarget (A1 window shift self-funded — polished demo; A2 later/direct flight; A3 hotel closer to venue); mixed funding (FUNDED_WINDOW + CostAllocation); ANCHOR_COMMITMENT_CHANGE event-side signal + fan-out; ProgrammeView operator read model + operator programme dashboard + traveller mobile surface; one real hotel API adapter behind the provider-neutral hotel seam; Atlas LIVE/RECORD/REPLAY reality path; routing + private-transfer reasoning; transfer seam with honest absence; deterministic policy temporal normalization; Cases A/B/C at programme scale.
- **STRETCH (S1..S8, pull only after NS-G3 and only if Minimum A/B/C are integrated and reliable):** S1 Hotelbeds Transfers transactional adapter (P1 #1); S2 bounded immigration/entry context (P1 — NOT Park); S3 event URL/programme re-ingestion; S4 disruption/email ingestion; S5 Northstar Skill; S6 richer insurance path; S7 live Google Routes with corrected guardrails; S8 Atlas baggage/seats if useful; multi-window funding splits; endangered-commitment drill-down UI. Event/org policy, supplier policies and one useful insurance-policy path remain supported data/context. Do not start new Stretch work after 26 Aug unless it closes an existing demo blocker.
- **PARK (excluded from Northstar):** participant sourcing, registration, CRM, ticketing; check-in/logistics marketplaces; partial-attendance heuristics; coordinated multi-traveller changes; insurance claims automation.

All exclusions under "Deferred / Not in MVP" remain in force unchanged.

## Stretch

Stretch work starts only after the generalized core vertical loop passes the implementation-plan vertical-loop gate.

### Ground transfer capability (Hotelbeds Transfers) — Stretch P1 #1
**Why stretch:** the provider-neutral `TransferCapability` seam is frozen at `NORTHSTAR_CONTRACT_BASE_SHA` and MVP honestly reports capability absence; a real adapter adds transactional ground coverage without changing engine logic.
**Revisit when:** the hotel adapter (RV-N7) is stable; Hotelbeds Transfers API access is practical. This is Stretch P1 #1 of the Northstar wave (S1 in the post-NS-G3 stretch pull list); routing + private-transfer reasoning itself is MIN scope in Wave 2 (RV-N8).

### Immigration/entry validation — Stretch P1
**Why stretch:** entry research with source/uncertainty is MVP; authoritative real-time document/visa validation needs commercial sources (Timatic/AutoCheck) and legal-grade accuracy.
**Revisit when:** a commercial entry-data source is accessible and a programme context makes validation decisively valuable.

### Event URL/email re-ingestion
**Why stretch:** initial ingestion of event pages/emails is MVP; picking up changed programme facts (rescheduled sessions, new venue) from re-crawled sources is a bounded extension of the existing source framework (Stretch S3 in the post-NS-G3 pull list; the former RV-N9 re-ingestion scope was re-scoped by the execution-plan reconciliation).
**Revisit when:** programme intake and commitment fan-out are stable.

### Atlas baggage / seat reasoning
**Why stretch:** baggage/seat data is tested and valuable when relevant, but neither is required to prove whole-trip recovery.
**Revisit when:** the accepted demo/robustness scenario materially benefits from baggage, seating, or accessibility-specific seat data.

### Atlas real `order.do` / `queryOrderDetails.do` execution and observation
**Why stretch:** state-changing; executor wiring not yet built.
**G3R-R0 update (24 Aug 2026):** the minimal provider-neutral transactional contract delta is FROZEN as a G3R-R0 candidate — `FlightTransactionCapability` (create/pay/retrieve + cancellation quote/submit/status) in `src/contracts/capabilities.ts`, decisions ADR-042..044. Remaining work is the adapter/executor mapping (DR-2), not shared contracts.
**G3R-R0 ACCEPTED (24 Aug 2026):** independent review accepted the frozen contract base at SHA `0c2f782ffbaf4fc569ab09f8ccad22e52c537516` (published as `origin/g3r-r0-fix`).
**Mission 1 update (24 Aug 2026, branch `wave3r/runtime-execution`):** DR-2 implements this capability against the Atlas SANDBOX behind the frozen seam — `AtlasFlightTransactionAdapter` (`src/providers/atlas/transactionAdapter.ts`), the provider-backed executor with the deterministic payment gate (`src/app/providerExecution.ts`), Nuitée replacement orchestration, truthful LIVE/RECORD/REPLAY provenance and permanent failure-path tests (`test/wave3r-dr2-provider-execution.test.ts`). Sandbox-only enforcement is fail-closed (`isAtlasSandboxBaseUrl` + test-balance-only `paymentRef`). Refund execution remains excluded (sandbox limitation above).
**DR-0 update (24 Aug 2026, user-authorized full chain confirmation):** empirically exercised end to end — `order.do` created a sandbox order (orderNo `TESTA20260824171418381`, PNR `OPLGS4`); `pay.do` with the sandbox test-balance payment mode succeeded (`status 0`, no card data submitted); ticketing completed automatically ~20s later (`orderStatus=2`, real e-ticket `S96664`, Malindo Air/Batik Air). Account is **not** ticketing-activation-blocked.

**DR-0 refund/cancel finding, rigorously re-verified (24 Aug 2026):** `refundQuotation.do` fails with `status 801 "Order not found for refund"` — confirmed on **two fully independent order/pay/ticket cycles on two different airlines** (Malindo/Batik Air and Volaris), ruling out a carrier-specific or request-format cause. Atlas's own sandbox documentation explains why: sandbox never issues a real airline-side ticket, which the refund subsystem requires. **This is a permanent sandbox-mode limitation** — flight refund stays `SIMULATE_PROVIDER_BOUNDARY`, universally, not pending further investigation.

**However, cancellation via a separate endpoint (`void.do`) genuinely works** for carriers Atlas supports it for (documented as ~23 airlines across Americas/Europe/Japan/Korea) — proven end to end on Volaris: real quote (`isVoidable:true`, `estimatedRefundAmount: 191.98 USD`), real submission (accepted, tracked, `voidCode 202608-0038`), real status query. On Malindo/Batik Air it correctly failed with a *different*, airline-support-specific reason (`843`), not the sandbox-ticket limitation. **A real, provider-executed cancellation is achievable in this sandbox** for the right carrier — the initial "cancellation is impossible" framing was an over-generalization from the refund-specific finding and has been corrected. See `docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md` §4A/§4B/§4C.

**Mission 3 refinement (25 Aug 2026, branch `wave3r/reality-convergence`):** `voidQuotation.do` was probed on a fresh ticketed order and confirmed **READ_ONLY** — it returns a quotation and does not void; the full quote→submit→status chain then completed, with cancellation settling **asynchronously as PROCESSING** (status query is the honest observation point). The full LIVE chain search/verify/hold/pay/retrieve/cancel is re-proven on this branch's evidence.

**DR-0 sandbox database-size finding (24 Aug 2026):** the documented "9 airlines / 36 routes" is materially wrong as a ceiling. A broad empirical sweep (67 route/direction pairs) found **28 distinct airlines** and 52 populated pairs (78%), spanning Southeast Asia, Northeast Asia, the Middle East, Europe, and the Americas (LCC-dominated; no full-service/legacy long-haul carrier observed). Treat the documented list as a stale floor, not a limit, for scenario design. See `docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md` §6A.
**Revisit when:** G3R-R1 transaction-safety review returned `FIX REQUIRED` against SHA `3fea722cf3e144ed925c4ef000b0bf85a6360360`, with four required fixes (side-effect misclassification, provider-SUCCESS-to-confirmed-state promotion, missing adapter-side payment ceiling re-check, payment proceeding on unreviewed spend). All four fixes landed on `wave3r/g3r-r1-fixes` (ADR-047). Re-review is required before Mission 2; wider carrier/route coverage sampling belongs to DR-9 scenario selection.

### Booking.com Demand API
**Why stretch:** technically valuable hotel search/booking surface but access depends on Managed Affiliate Partner credentials/contract rather than simple self-service signup.
**Revisit when:** bounded access investigation confirms credentials are immediately practical.

### Second polished TMC demonstration
**Why stretch:** engine generalisation through a second scenario is mandatory MVP; turning it into a second polished demo narrative is presentation breadth.
**Revisit when:** primary demo flow is reliable.

### Atlas incidents/webhooks
**Why stretch:** documented but not required to prove TripSignal normalization; a provider-boundary test signal can exercise the real internal pipeline.
**DR-0 update (24 Aug 2026):** the read-only incident-list endpoint (`POST /event/getPageList.do`) is empirically reachable without prior webhook registration and returned a clean empty page (no ticketed orders yet to generate events). Webhook registration (`POST /updateWebhookURL.do`, body `{url}`) is documented but was **not** called in DR-0 (state-changing, needs a public callback URL — DR-3 scope). Atlas documents no inbound signature/auth mechanism for its callback POSTs; delivery is explicitly "best effort." See `docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md`.
**Revisit when:** Atlas access/activation is confirmed and integration is low risk.

### Gmail live ingestion
**Why stretch:** OAuth/watch/PubSub plumbing adds setup risk. Generic email/document ingestion proves the internal source pipeline first.
**Revisit when:** source ingestion and vertical loop are stable.

### Shared/group recovery cascade
**Why stretch:** ontology supports shared resources; polished multi-traveller cascade adds propagation/UI complexity.
**Revisit when:** single-trip propagation/generalisation is robust.

### Deriving accessibility requirements from traveller profiles (PARK-3)
**Why stretch:** today accessibility constraints are explicit authored policy (`unsupportedModes` parameters); deriving them from `Traveller.accessibilityRequirements` would let the engine invent its own judging criteria, which the deterministic viability model deliberately avoids (REV-C-FIX, comments in `src/engine/evaluators.ts`).
**Revisit when:** a profile-to-constraint derivation rule is defined that keeps criteria explicit, traceable to a source, and auditable like any other constraint.

## Deferred / Not in MVP

### Timatic commercial integration
Reason: production-grade entry/document source is unnecessary to prove generic sourced research pipeline.
Revisit: production/legal-grade deployment or commercial access.

### Expedia Rapid / other hotel inventory APIs
Reason: provider breadth does not strengthen the core before one generic hotel context/action boundary works.
Revisit: production provider strategy after core.

### Amadeus / Sabre / Travelport / other NDC/GDS adapters
Reason: Atlas proves provider-neutral flight capability architecture for hackathon.
Revisit: commercial integration phase.

### Real ridehail booking
Reason: dynamic routing/feasibility matters more than transaction access; commercial provider access may be restricted.
Revisit: supported partnership/API.

### Rail/ferry transactional APIs
Reason: generic TransportLeg plus provider-boundary simulation can prove dependency recovery first.
Revisit: target-market/provider requirements.

### Real hotel modification/cancellation without an available provider API
Reason: internal recovery/authority pipeline can remain real with provider-boundary simulation.
Revisit: Booking.com/Expedia/TMC/hotel supplier adapter access.

### Insurance claims automation
Reason: policy reasoning is useful; claims are a separate regulated/operational workflow.
Revisit: dedicated insurance integration/product requirement.

### Slack/WhatsApp workflow integration
Reason: communication-channel breadth is not core resolution logic.
Revisit: enterprise workflow/customer demand.

### Production duty-of-care monitoring
Reason: needs broader reliable live feeds, escalation operations, and compliance design.
Revisit: post-hackathon enterprise productisation.

### Full autonomous refund/post-ticket airline servicing
Reason: documented Atlas surfaces are broader than tested access and high-risk side effects need mature transactional guardrails.
Revisit: after safe order/ticket state and provider coverage are established.

### Multi-tenant enterprise administration/billing
Reason: commercial platform administration does not prove hackathon core.
Revisit: productisation.

## Active investigations

Investigations are bounded and non-blocking. Each ends with `Adopt Now | Keep Stretch | Defer | Reject`.

### Atlas Singapore sandbox routes — RESOLVED (DR-0, 24 Aug 2026)
The documented fixture list omitted SIN, but a direct empirical probe shows the sandbox **does** return real offers for SIN: SIN→{KUL,MNL,BKK,CGK,TYO,SYD} and {KUL,BKK,MNL,HKG,CGK,SYD}→SIN all returned populated `search.do` results (multiple carriers: TR/Scoot, VJ/VietJet, AK/AirAsia, FD/Thai AirAsia, OD/Batik, D7/AirAsia X). Only outbound SIN→HKG returned an empty (but valid, status 0) result — route population is directional, not symmetric. No organiser fixture request is needed. See `docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md` for the full route table and summit-location ranking.

### Booking.com Demand access — Investigate Now
Decision needed: whether valid partner credentials can be obtained immediately enough to implement/test. If not, keep Stretch and stop the investigation.

### Google Routes setup — RESOLVED (Mission 3, 25 Aug 2026)
A bounded LIVE check with the configured key succeeded (read-only route context), and the adapter remains fail-closed via REPLAY when unconfigured. No further setup action needed.

### Atlas order execution — Stretch investigation
Starts only after the generalized vertical loop is stable. Stop if activation/account/ticketing complexity threatens core implementation.

## Rejected architecture choices

- separate recovery engines per buyer/operator type
- graph database solely because the domain is graph-shaped
- unrestricted LLM graph mutation
- LLM directly calling irreversible/money-moving provider APIs
- demo-specific application branches
- mocks inside the core graph/recovery/authority pipeline
- optional providers becoming mandatory to start or replay the core application
