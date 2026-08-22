# Roadmap

This is the source of truth for **product capability scope/status**. `docs/IMPLEMENTATION_PLAN.md` is the source of truth for execution order, work packages, dependencies, and implementation status.

Intentionally excluded work must remain here; do not silently drop it.

Status vocabulary:
- **Implemented**
- **In Progress**
- **Planned MVP**
- **Stretch**
- **Deferred**
- **Blocked**
- **Rejected**

## Planned MVP

Capability status: the Scenario A vertical recovery loop (ingestion -> persistent trip -> signal/impact -> planner/capabilities/viability -> authority/execution/observation -> real operator/traveller read models) is **Implemented** and Checkpoint B has been **accepted** (REV-B Complete; reviewed candidate `b650031`, merged to `main`). Checkpoint C (generalisation, reliability, demo candidate) is **accepted** (REV-C Complete; accepted SHA `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d`, merged to `main`): Scenario B runs through the identical application code, four robustness cases pass through the real engine, the hardcoding audit found no scenario content outside `fixtures/`, and the generic runtime disruption/reset flow is reliable and replayable. Execution evidence lives in `docs/IMPLEMENTATION_PLAN.md` Section 4.

Truth boundary: the engine has been proven against **curated/provider-shaped scenarios** (fixture sources, REPLAY provider recordings, scripted/test planner inputs). It has **not yet** been proven against arbitrary externally sourced inputs: arbitrary real booking import end-to-end, arbitrary URL -> assembled Trip end-to-end, selected external integrations through actual provider calls, or real/sandbox search and servicing surfaces beyond the Atlas Search/Verify development proof. Closing that gap is the purpose of the Reality Validation milestone below.

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

### Hotel capability — Planned MVP (Northstar, RV-N6/N8)
Promoted from Stretch investigation to Planned MVP by the RV-N0 contract freeze:
- provider-neutral `HotelCapability` seam: search/quote/book/retrieve plus context/modify/cancel (contracts frozen at `NORTHSTAR_CONTRACT_BASE_SHA`)
- MVP runs on imported booking/policy data; after freeze at most one real hotel API adapter behind the same boundary
- change treated as cancel+rebook until a provider exposes real modification endpoints
- RECORD/REPLAY through the shared normalizer; Booking.com Demand API remains Stretch if partner credentials are immediately practical

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

## Reality Validation — In Progress (active milestone, before Final Candidate preparation)

**Purpose:** prove that the generalized engine works against externally sourced / provider-produced inputs rather than only curated scenario fixtures.

**Status:** active milestone opened at Checkpoint C closeout. The investigation phase completed (11 reality-validation reports + synthesis decision package on `main`). The **Northstar wave RV-N0..RV-N12** is now the programme-scale execution phase of this milestone, fanning out from `NORTHSTAR_CONTRACT_BASE_SHA` on branch `northstar/contract-freeze` (see `docs/IMPLEMENTATION_PLAN.md` Section 13).

For each external surface the milestone will investigate and decide where to use: real external source content; provider sandbox/test APIs; LIVE read-only APIs where low-risk and economically bounded; RECORD/REPLAY; or external-boundary simulation only where real/sandbox access is not worth the complexity. Every decision ends with an explicit `Adopt | Defer | Reject` and a roadmap/tracker update. No new product integration is authorized by this milestone until its investigations conclude.

### Investigation areas (high level)

1. **Atlas sandbox capability reality pass** — actual Search/Verify/rules and relevant sandbox operations; verify Singapore-route availability empirically rather than assuming the published fixture list is exhaustive; investigate bounded sandbox order/change/refund capability where useful.
2. **Hotel provider investigation** — compare providers based on BOTH hackathon sandbox feasibility and credible future TMC adoption; hotel search/availability/quote; booking; modification/rebooking; cancellation; supplier policy/rule data.
3. **Ground routing / transport** — Google Routes LIVE with strict spend/usage guardrails if economically safe; investigate transactional ground-transfer sandbox APIs separately.
4. **Generic real-source ingestion** — URL ingestion; event pages; webpages; booking confirmations; PDFs/documents; email/plain text; policies.
5. **Generic Trip assembly** — arbitrary imported sources -> Trip; entity resolution; timezone/place resolution; dependency proposals; objective/context extraction; uncertainty handling.
6. **Dynamic context/research** — event schedules; supplier policies; immigration/entry context; insurance; organisation policy; local operating context.
7. **Model Studio reality pass** — actual Qwen extraction/planning against previously unseen real-world inputs.
8. **Traveller-initiated change / resolution** — the system must support not only externally caused disruptions but also traveller-requested changes: fly a different day; fly at a different time; take a different route; extend or shorten a stay; change hotel; leave earlier/later; reprioritise an objective; voluntarily abandon an objective; request a preference-driven modification. These enter the **same** generalized engine as TripSignals / change intents and trigger: intent/change -> state/context update -> blast radius -> recovery/resolution strategies -> deterministic whole-trip viability -> policy/authority -> execution -> observation -> resolved state. No second "traveller modification engine" is created; this is central to the wider Trip Resolution thesis.

### Northstar scope record (frozen at RV-N0)

Northstar = the AI resolution layer for event travel: one programme at a time (~40–45 inbound travellers), generic across tournaments, corporate offsites, productions, conferences.

- **MIN:** programme aggregate + shared commitments (per-traveller importance); pre-authoritative intake drafts promoted through the frozen mutation path; initial planning through the same engine; declarative ChangeRequest/ResolutionTarget (window shifts, later/direct transport, stay proximity); mixed funding (FUNDED_WINDOW + CostAllocation); ANCHOR_COMMITMENT_CHANGE event-side signal + fan-out; ProgrammeView operator read model; provider-neutral hotel seam over imported data; transfer seam with honest absence; deterministic policy temporal normalization; Cases A/B/C at programme scale.
- **STRETCH:** one real hotel API adapter post-freeze; Hotelbeds Transfers adapter (P1 #1); immigration validation (P1); LLM-mapped roster channel; event URL/email re-ingestion; multi-window funding splits; endangered-commitment drill-down UI.
- **PARK (excluded from Northstar):** participant sourcing, registration, CRM, ticketing; check-in/logistics marketplaces; partial-attendance heuristics; coordinated multi-traveller changes; insurance claims automation.

All exclusions under "Deferred / Not in MVP" remain in force unchanged.

## Stretch

Stretch work starts only after the generalized core vertical loop passes the implementation-plan vertical-loop gate.

### Ground transfer capability (Hotelbeds Transfers) — Stretch P1 #1
**Why stretch:** the provider-neutral `TransferCapability` seam is frozen at `NORTHSTAR_CONTRACT_BASE_SHA` and MVP honestly reports capability absence; a real adapter adds transactional ground coverage without changing engine logic.
**Revisit when:** hotel capability (RV-N6) is stable; Hotelbeds Transfers API access is practical. This is the first Stretch candidate of the Northstar wave (RV-N7).

### Immigration/entry validation — Stretch P1
**Why stretch:** entry research with source/uncertainty is MVP; authoritative real-time document/visa validation needs commercial sources (Timatic/AutoCheck) and legal-grade accuracy.
**Revisit when:** a commercial entry-data source is accessible and a programme context makes validation decisively valuable.

### Event URL/email re-ingestion
**Why stretch:** initial ingestion of event pages/emails is MVP; picking up changed programme facts (rescheduled sessions, new venue) from re-crawled sources is a bounded extension of the existing source framework (RV-N9 STRETCH).
**Revisit when:** programme intake and commitment fan-out are stable.

### Atlas baggage / seat reasoning
**Why stretch:** baggage/seat data is tested and valuable when relevant, but neither is required to prove whole-trip recovery.
**Revisit when:** the accepted demo/robustness scenario materially benefits from baggage, seating, or accessibility-specific seat data.

### Atlas real `order.do` / `queryOrderDetails.do` execution and observation
**Why stretch:** state-changing and not yet exercised in the research account.
**Revisit when:** Search/Verify adapter, deterministic authority/executor boundary, and vertical recovery loop are stable; bounded sandbox execution is available without jeopardising core delivery.

### Booking.com Demand API
**Why stretch:** technically valuable hotel search/booking surface but access depends on Managed Affiliate Partner credentials/contract rather than simple self-service signup.
**Revisit when:** bounded access investigation confirms credentials are immediately practical.

### Second polished TMC demonstration
**Why stretch:** engine generalisation through a second scenario is mandatory MVP; turning it into a second polished demo narrative is presentation breadth.
**Revisit when:** primary demo flow is reliable.

### Atlas incidents/webhooks
**Why stretch:** documented but not required to prove TripSignal normalization; a provider-boundary test signal can exercise the real internal pipeline.
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

### Atlas Singapore sandbox routes — Investigate Now
Current sandbox fixture list does not include SIN; this is not evidence Atlas lacks Singapore production content.
Decision needed: whether hackathon/Atlas staff can enable a useful Singapore sandbox route. Never block architecture on this.

### Booking.com Demand access — Investigate Now
Decision needed: whether valid partner credentials can be obtained immediately enough to implement/test. If not, keep Stretch and stop the investigation.

### Google Routes setup — Act Now, non-blocking
Create/reuse Google Cloud project/API key when convenient. Core application must run without live Google via replay/sourced/unknown fallback.

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
