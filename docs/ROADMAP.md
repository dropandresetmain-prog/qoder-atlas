# Roadmap

This is the source of truth for product scope/status. Intentionally excluded work must remain here; do not silently drop it.

Status vocabulary:
- **Implemented**
- **In Progress**
- **Planned MVP**
- **Stretch**
- **Deferred**
- **Blocked**
- **Rejected**

## Planned MVP

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
- local routing via Google Routes when configured, with non-blocking fallback

### Intelligence
- Alibaba Model Studio/Qwen structured extraction and mapping
- semantic consequence/objective interpretation
- uncertainty identification
- RecoveryPlanner structured strategy generation
- strategy comparison/ranking after deterministic viability
- agentic web research for dynamic context

### Flight capability
- Atlas direct `search.do`
- Atlas `verify.do`
- Atlas fare/change/refund/no-show rule normalization from Search/Verify
- `getLuggage.do` / `seatAvailability.do` only where useful

### Product surfaces
- role-neutral operator dashboard/read models
- traveller trip page/conversation/read models
- approvals/input flow
- visible disruption -> impact -> recovery -> resolved transition

### Reliability
- LIVE / RECORD / REPLAY provider modes where practical
- external provider failures represented as structured failures
- at least two materially different scenarios through same engine
- anti-hardcoding scenario substitution test

## Stretch

Stretch work starts only after the generalized core vertical loop is reliable.

### Atlas real `order.do` / `queryOrderDetails.do` execution and observation
**Why stretch:** state-changing and not yet exercised in research account.
**Revisit when:** Search/Verify adapter and authority/execution boundaries are stable and safe sandbox execution can be tested without risking core delivery.

### Booking.com Demand API
**Why stretch:** technically valuable hotel search/booking surface but access depends on Managed Affiliate Partner credentials/contract rather than simple self-service signup.
**Revisit when:** bounded access investigation confirms credentials can be obtained quickly.

### Second polished TMC demonstration
**Why stretch:** engine generalisation must be tested in MVP, but a second polished demo is presentation breadth.
**Revisit when:** main demo flow is stable.

### Atlas incidents/webhooks
**Why stretch:** documented but not required to prove event normalization; simulated provider boundary can inject same TripSignal.
**Revisit when:** Atlas access/activation is confirmed and integration is low-risk.

### Gmail live ingestion
**Why stretch:** OAuth/watch/PubSub plumbing adds setup risk. Generic email ingestion proves internal capability first.
**Revisit when:** core source ingestion and vertical loop are stable.

### Shared/group recovery cascade
**Why stretch:** ontology supports shared resources; polished multi-traveller cascade adds complexity.
**Revisit when:** single-trip propagation is robust.

### Rich baggage/seat recovery reasoning
**Why stretch:** Atlas data is tested, but only valuable if a chosen scenario needs it.
**Revisit when:** accessibility/ancillary scenario warrants it.

## Deferred / Not in MVP

### Timatic commercial integration
Reason: production-grade entry/document source is unnecessary to prove generic sourced research pipeline.
Revisit: production/legal-grade deployment or commercial access.

### Expedia Rapid / other hotel inventory APIs
Reason: provider breadth does not strengthen core recovery thesis before first hotel adapter is needed.
Revisit: production provider strategy after core.

### Amadeus / Sabre / Travelport / other NDC/GDS adapters
Reason: Atlas proves provider-neutral flight capability architecture for hackathon.
Revisit: commercial integrations after interfaces stabilize.

### Real ridehail booking
Reason: dynamic routing/feasibility matters more than transaction access; provider access may be restricted.
Revisit: supported commercial partnership/API.

### Rail/ferry transactional APIs
Reason: generic TransportLeg and provider-boundary simulation can prove dependency recovery first.
Revisit: target market/provider requirements.

### Real hotel modification/cancellation without an available provider API
Reason: internal recovery and authority pipeline can remain real with provider-boundary simulation.
Revisit: Booking.com/Expedia/TMC/hotel supplier adapter access.

### Insurance claims automation
Reason: policy reasoning is useful; claims are separate regulated/operational workflow scope.
Revisit: dedicated insurance integration and product requirements.

### Slack/WhatsApp workflow integration
Reason: communication channel breadth is not core resolution logic.
Revisit: enterprise workflow/customer demand.

### Production duty-of-care monitoring
Reason: needs broader reliable live feeds, escalation operations and compliance design.
Revisit: post-hackathon enterprise productisation.

### Full autonomous refund/post-ticket airline servicing
Reason: documented Atlas surfaces are broader than tested access and high-risk side effects require mature transactional guardrails.
Revisit: after safe order/ticket state and provider coverage are established.

### Multi-tenant enterprise administration/billing
Reason: commercial platform administration does not prove hackathon core.
Revisit: productisation.

## Active investigations

### Atlas Singapore sandbox routes — Investigate Now
Current sandbox fixture list does not include SIN; this is not evidence Atlas lacks Singapore production content.
Decision needed: whether hackathon/Atlas team can enable a Singapore sandbox route. Never block architecture on this.

### Booking.com Demand access — Investigate Now
Decision needed: whether partner credentials can realistically be obtained. If not, remain Stretch/Deferred without further time sink.

### Google Routes setup — Act Now, non-blocking
Create/reuse Google Cloud project, enable billing/API/key as convenient. Core app must run without it via replay/fallback.

## Rejected architecture choices

- separate recovery engines per buyer/operator type
- graph database solely because domain is graph-shaped
- unrestricted LLM graph mutation
- LLM directly calling irreversible/money-moving provider APIs
- demo-specific application branches
- mocks inside core graph/recovery/authority pipeline
