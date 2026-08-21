# Product Spec

## Product

**AI Trip Recovery / Resolution Layer**

A persistent operational layer that maintains whether a trip still works as reality changes. It does not stop at recommending a replacement booking; it evaluates downstream consequences, plans recovery across the trip, applies policy/authority, executes supported actions and observes whether the trip has returned to a valid state.

## Problem

Travel disruptions are not isolated booking problems. A flight change can invalidate airport transport, hotel arrival, an event obligation, a separately booked onward leg, policy compliance, accessibility requirements or insurance decisions.

Existing alternatives leave gaps:

- search/OTA tools optimize bookings, not whole-trip recovery
- a travel agent can solve cases but requires human servicing capacity and consistent context
- a general chatbot lacks authoritative persistent state, deterministic viability checks, permissions and safe execution

The product asks: **does this trip still accomplish what it was supposed to accomplish?**

## Users and operating model

B2B2C with one recovery engine.

Operators may include:
- TMC servicing teams
- corporate HR/travel teams/EAs
- event organisers managing invited travellers
- group travel leaders

Travellers interact directly with their trip when appropriate. Operators retain readiness, exception and approval visibility.

Segment differences should mainly be configuration: policy, permissions, approval hierarchy, scale and UI.

## Core user outcomes

### Operator
The operator can answer:
- who is ready, at risk or disrupted?
- what changed and what else is affected?
- what is the system doing?
- what decision or approval is required?
- what remains uncertain?
- has the case actually been resolved?

### Traveller
The traveller can answer:
- am I okay?
- what changed?
- what matters now?
- what are you doing?
- what do you need from me?
- is the rest of my trip still viable?

User-facing language must avoid internal graph/agent terminology.

## Core domain

- **Organisation**: operator, policy owner, approver or other governing organisation.
- **Traveller**: persistent person context including requirements and preferences.
- **AnchorEvent**: optional shared context across multiple trips, e.g. conference, concert, retreat, tournament, offsite.
- **Trip**: operational journey state for one or more travellers.
- **TripElement**: a trip-specific operational element. Reusable subtypes include `TransportLeg`, `Stay`, and `Engagement`.
- **TripObjective**: what the trip is intended to accomplish; may be hard/soft and may change with explicit user instruction.
- **RuleSet / Policy**: structured supplier, organisation, entry or insurance rules.
- **Constraint**: evaluatable condition affecting viability.
- **TripSignal**: normalized incoming event/change.
- **RecoveryCase**: workflow state created when intervention is needed.
- **RecoveryStrategy**: structured proposed set of changes/tool actions.
- **ActionIntent**: proposed consequential external action awaiting authority evaluation.

## Required dynamic context

The architecture must support context originating from:
- AnchorEvent webpage, schedule, briefing or other organiser material
- traveller profile and explicit preferences
- latent/inferred preferences, always weaker than explicit instructions
- Atlas flight data
- confirmation emails/PDF/manual import
- hotel and transport/supplier policies
- local route/transport operating context
- immigration/entry requirements and sourced processing estimates
- insurance policy
- organisation/event policy

Critical facts must carry provenance/authority/freshness rather than fake certainty.

## TripElement semantics

A TripElement's importance, flexibility and booking state are separate dimensions.

Examples:
- keynote: required + fixed
- flight: required + changeable + confirmed
- airport-to-hotel transfer: required + flexible + possibly unbooked/on-demand
- speaker dinner: preferred + fixed

Flexible required elements allow recovery to change *how* a need is fulfilled without pretending a booking already exists.

## Preferences and requirements

Priority order:
1. current explicit instruction
2. trip-specific explicit preference
3. persistent explicit preference
4. inferred/latent preference

Latent preferences are ranking signals, never silent hard constraints.

Accessibility, legal/entry conditions and explicit hard objectives are requirements, not preferences.

## Core operational loop

1. Receive a TripSignal or new contextual input.
2. Interpret/map it into a constrained schema.
3. Validate and deterministically mutate authoritative state.
4. Re-evaluate affected constraints and calculate blast radius.
5. Create/update RecoveryCase when intervention is required.
6. Generate structured recovery strategies and information/tool needs.
7. Query provider-neutral capabilities.
8. Apply proposed strategy changes to scenario overlays, not authoritative state.
9. Deterministically evaluate scenario viability.
10. Rank feasible strategies using hard constraints, soft objectives and preferences.
11. Determine authority: auto-act, traveller approval, organisation approval, human escalation or blocked.
12. Revalidate before irreversible actions.
13. Execute supported actions.
14. Observe results and update state.
15. Repeat until resolved or explicitly escalated.

A case may resolve as fully recovered or recovered with unavoidable loss. A violated hard objective does not crash the pipeline; the engine estimates blast radius and attempts to preserve remaining objectives.

## MVP requirements

The MVP must contain a genuine vertical loop, not a UI shell:
- persistent domain/graph state
- generic graph mutation from validated inputs
- deterministic constraints, buffers and impact propagation
- blast-radius output
- Qwen structured extraction/recovery planning
- scenario overlays and deterministic viability
- deterministic authority engine
- Atlas direct Search/Verify/rule integration
- generic event/web/document/booking ingestion
- dynamic local routing when Google Routes is configured, with graceful fallback
- sourced immigration/entry research with uncertainty separation between legal fact and operational estimate
- at least one insurance policy ingested as data
- operator and traveller read models/interfaces
- external action simulation where real transactional access is unavailable
- SQLite persistence
- LIVE/RECORD/REPLAY on external adapters where practical
- auditability of signal -> decision -> action -> result

## Generalisation acceptance criterion

At least two materially different scenarios must run through the same engine without application-code changes. Scenario-specific facts may differ only through data, configuration and source inputs.

Minimum conceptual scenarios:
1. event-organiser / invited-speaker recovery
2. TMC/corporate traveller recovery

Robustness tests should additionally exercise combinations such as late hotel arrival, onward rail/ferry, accessibility, shared resources, entry buffers and already-lost objectives.

## Explicit non-goals for MVP

The roadmap must retain all intentional exclusions. Current non-goals include production multi-GDS connectivity, insurance claims, full airline post-ticket servicing, real ridehail booking, comprehensive rail/ferry transaction providers, Timatic commercial integration, production duty-of-care monitoring and multi-tenant enterprise administration.
