# Product Spec

## Product

**AI Trip Recovery / Resolution Layer**

A persistent operational layer that maintains whether a trip still works as reality changes. It does not stop at recommending a replacement booking; it evaluates downstream consequences, plans recovery across the trip, applies policy/authority, executes supported actions, and observes whether the trip has returned to a valid state.

The product asks:

> **Does this trip still accomplish what it was supposed to accomplish?**

## Problem

Travel disruptions are not isolated booking problems. A flight change can invalidate airport transport, hotel arrival, an event obligation, a separately booked onward leg, policy compliance, accessibility requirements, insurance decisions, or duty-of-care status.

Existing alternatives leave gaps:

- search/OTA tools optimize bookings, not whole-trip recovery;
- a competent travel agent can resolve cases but requires human servicing capacity and consistent context;
- a general chatbot lacks authoritative persistent state, deterministic viability checks, permissions, reliable observation, and safe execution.

A replacement flight is not necessarily a recovered trip.

## Users and operating model

B2B2C with one generalized recovery engine.

Operators may include:
- TMC servicing teams;
- corporate HR/travel teams/EAs;
- event organisers managing invited travellers;
- group travel leaders;
- future direct corporate/traveller products.

Travellers interact directly with their trip when appropriate. Operators retain readiness, exception, duty-of-care, and approval visibility.

Segment differences should mainly be configuration: policy, permissions, approval hierarchy, scale, and UI. Do not create separate recovery engines per operator type.

## Core user outcomes

### Operator
The operator can answer:
- who is ready, at risk, or disrupted?
- what changed and what else is affected?
- what is the system doing?
- what decision or approval is required?
- what remains uncertain?
- has the operational problem actually been resolved?

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

- **Organisation**: operator, policy owner, approver, payer, or other governing organisation.
- **Traveller**: persistent person context including requirements and preferences.
- **AnchorEvent**: optional shared context across multiple trips, e.g. conference, concert, retreat, tournament, wedding, or offsite.
- **Trip**: operational journey state for one or more travellers.
- **TripElement**: reusable trip-specific operational element. Initial subtypes: `TransportLeg`, `Stay`, `Engagement`.
- **TripObjective**: what the trip is intended to accomplish; may be hard/soft and may change with authorised explicit instruction.
- **Place**: relevant trip location used by time/routing/operating-context rules.
- **RuleSet / Policy**: structured supplier, organisation, entry, or insurance rules.
- **Constraint**: evaluatable condition affecting viability.
- **TripSignal**: normalized incoming event/change.
- **RecoveryCase**: operational workflow state created when intervention is needed.
- **RecoveryStrategy**: structured proposed set of scenario changes/tool actions.
- **ActionIntent**: proposed consequential external action awaiting deterministic authority evaluation.

## Dynamic context

The architecture must support context originating from:
- AnchorEvent webpage, schedule, briefing, or other organiser material;
- traveller profile and explicit preferences;
- latent/inferred preferences, always weaker than explicit instructions;
- Atlas/provider flight data;
- confirmation emails/PDF/manual import;
- hotel and transport/supplier policies;
- local route/transport operating context;
- immigration/entry requirements and sourced processing estimates;
- insurance policy;
- organisation/event policy.

Critical facts must carry provenance/authority/freshness rather than fake certainty.

## TripElement semantics

Importance, flexibility, and reservation state are separate dimensions.

Examples:
- keynote: required + fixed;
- flight: required + changeable + confirmed;
- airport-to-hotel transfer: required + flexible + possibly unbooked/on-demand;
- speaker dinner: preferred + fixed.

Flexible required elements allow recovery to change *how* a need is fulfilled without pretending a booking already exists.

## Preferences and requirements

Precedence:
1. current explicit instruction;
2. trip-specific explicit preference;
3. persistent explicit preference;
4. inferred/latent preference.

Latent preferences are ranking signals, never silent hard constraints.

Accessibility, legal/entry conditions, safety/duty-of-care requirements, and explicit hard objectives are requirements, not preferences.

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
10. Rank feasible strategies using hard constraints, soft objectives, policy, and preferences.
11. Determine authority: auto-act, traveller approval, organisation approval, human escalation, or blocked.
12. Revalidate before irreversible actions.
13. Execute supported actions.
14. Observe results and update state.
15. Repeat until resolved or explicitly escalated.

A case may resolve as fully recovered or recovered with unavoidable loss. A violated hard objective does not crash the pipeline; the engine estimates blast radius and attempts to preserve remaining objectives.

# Requirements

These IDs are stable traceability anchors for `IMPLEMENTATION_PLAN.md`, Qoder Specs, and tests. Add or supersede requirements deliberately; do not silently renumber existing IDs.

## Functional requirements

### FR-01 — Persistent operational trip state
The system shall persist the current Trip, relevant Traveller/Organisation/AnchorEvent context, RecoveryCases, source evidence, and audit history independently of chat history.

### FR-02 — Generic contextual ingestion
The system shall accept structured and unstructured trip context through generic source boundaries, including event webpages/briefings, traveller profiles, booking confirmations, hotel/supplier policies, organisation policy, and insurance documents.

### FR-03 — Traveller context and preference precedence
The system shall represent explicit requirements/preferences, accessibility needs, nationality/passport context, insurance context, and latent preferences. Explicit current/trip instructions must outrank persistent and latent preferences.

### FR-04 — Normalized signals and validated mutation
Incoming changes shall normalize to `TripSignal` / bounded mutation proposals. AI/provider input may not directly mutate authoritative state; schema/business validation and deterministic mutation are mandatory.

### FR-05 — Deterministic constraints, buffers, and viability
The system shall deterministically evaluate applicable time/timezone windows, duration/buffer envelopes, routing/transfer constraints, policy thresholds, accessibility requirements, and other structured constraints. `UNKNOWN` must remain distinct from PASS/FAIL.

### FR-06 — Blast-radius propagation
After relevant state changes, the system shall identify directly failed, downstream affected, at-risk, unknown, and still-valid trip elements/objectives. Hard failure shall not terminate the recovery pipeline.

### FR-07 — Agentic recovery planning
The RecoveryPlanner shall consume current state, impact, objectives, preferences, uncertainty, authority context, available capabilities, and previous results to propose structured recovery strategies and required tool/information queries.

### FR-08 — Provider-neutral capabilities
Travel/search/research/execution operations shall sit behind provider-neutral interfaces. Atlas is the hackathon flight adapter, not a domain dependency.

### FR-09 — Scenario overlays
Candidate recovery strategies shall be evaluated on temporary scenario overlays. Candidate alternatives must not mutate authoritative state until successful observed execution.

### FR-10 — Deterministic authority and action gating
Every consequential external action shall become an `ActionIntent` and pass deterministic authority/permission/policy checks before execution. The LLM may not directly issue irreversible or money-moving actions.

### FR-11 — Observation and case closure
Provider/action results shall be observed, mapped back into state, and trigger re-evaluation. A successful API response alone shall not close a case; trip viability/outcome determines resolution.

### FR-12 — Operator experience
The operator surface shall expose readiness/risk/disruption, what changed, downstream impact, system activity, required decision/approval, uncertainty, traveller-response status, and resolution/audit state using user-facing language.

### FR-13 — Traveller experience
The traveller surface shall expose whether the trip is okay, what changed, what matters, what is being done, what input is required, and whether the remaining trip is viable.

### FR-14 — Provenance, confidence, freshness, and auditability
Critical operational facts and derived/researched context shall retain source/provenance, authority/confidence where appropriate, freshness/verification metadata, and auditable mutation/decision history.

### FR-15 — LIVE / RECORD / REPLAY
External adapters shall support LIVE/RECORD/REPLAY where practical. LIVE and REPLAY must use the same normalization/downstream engine path. Recorded data must be sanitized.

### FR-16 — Local transport context
When configured, the system shall obtain dynamic local route/travel-time context through Google Routes or another RoutingCapability. Absence/failure must degrade gracefully to replay/sourced/unknown context rather than block core operation.

### FR-17 — Entry/immigration context
Legal/entry facts must be grounded in authoritative sources. Agentic web research may provide sourced operational immigration-time estimates with explicit uncertainty.

### FR-18 — Insurance policy reasoning
At least one real insurance policy/document shall be ingested as data and made available to recovery/impact reasoning without hardcoding policy clauses into domain logic.

## Non-functional requirements

### NFR-01 — Generalisation
At least two materially different scenarios — AnchorEvent/invited speaker and corporate/TMC-style travel — must run through the same application code with only data/config/source changes.

### NFR-02 — Anti-hardcoding
Domain/recovery logic shall not contain demo-specific event/traveller names, cities, route IDs, fixture IDs, or supplier-specific branches. Provider-specific logic is allowed only in concrete adapters.

### NFR-03 — External dependency resilience
Optional provider/model/network failures shall produce structured unavailable/unknown/fallback states and must not crash the RecoveryCase pipeline.

### NFR-04 — AI safety boundary
Malformed/out-of-schema AI output shall fail safely. AI cannot bypass deterministic mutation, viability, authority, or execution gates.

### NFR-05 — Persistence and replay reliability
The demo candidate shall survive local restart/reload, support deterministic reset/reseed, and replay provider/model data without requiring live paid calls for routine verification.

### NFR-06 — Inspectability
A reviewer shall be able to trace source/signal -> state mutation -> impact -> strategy -> viability -> authority -> action -> observation -> outcome from repository code/tests/audit records.

## MVP acceptance

The MVP must contain a genuine vertical loop, not a UI shell:

- persistent domain/graph state (`FR-01`);
- generic graph mutation from validated inputs (`FR-04`);
- deterministic constraints, buffers, impact propagation (`FR-05`, `FR-06`);
- Qwen/Model Studio structured extraction/recovery planning (`FR-07`);
- scenario overlays and deterministic viability (`FR-09`);
- deterministic authority engine (`FR-10`);
- Atlas direct Search/Verify/rule integration (`FR-08`);
- generic event/web/document/booking ingestion (`FR-02`);
- dynamic local routing when Google Routes is configured, with graceful fallback (`FR-16`);
- sourced immigration/entry research (`FR-17`);
- one insurance policy ingested as data (`FR-18`);
- operator and traveller read models/interfaces (`FR-12`, `FR-13`);
- external action simulation where real transactional access is unavailable (`FR-10`, `FR-11`);
- SQLite persistence and auditability (`FR-01`, `FR-14`);
- LIVE/RECORD/REPLAY where practical (`FR-15`);
- two-scenario generalisation (`NFR-01`, `NFR-02`).

## Explicit non-goals for MVP

The roadmap is the scope/status SSOT and must retain all intentional exclusions. Current non-goals include production multi-GDS connectivity, insurance claims, full airline post-ticket servicing, real ridehail booking, comprehensive rail/ferry transaction providers, Timatic commercial integration, production duty-of-care monitoring, Gmail/Slack/WhatsApp breadth, and multi-tenant enterprise administration.
