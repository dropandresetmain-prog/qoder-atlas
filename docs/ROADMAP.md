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

Capability status: the Scenario A vertical recovery loop (ingestion -> persistent trip -> signal/impact -> planner/capabilities/viability -> authority/execution/observation -> real operator/traveller read models) is **Implemented** and Checkpoint B has been **accepted** (REV-B Complete; reviewed candidate `b650031`, merged to `main`). Checkpoint C (generalisation, reliability, demo candidate) is in progress on `checkpoint-c`: Scenario B generalisation, four robustness cases, and the generic runtime disruption/reset flow (scenario-neutral HTTP seam, deterministic credential-free fallback planner, audited transactional reset/reseed) are Integrated; hardcoding audit and Review Gate C remain. Execution evidence lives in `docs/IMPLEMENTATION_PLAN.md` Section 4.

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

## Stretch

Stretch work starts only after the generalized core vertical loop passes the implementation-plan vertical-loop gate.

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
