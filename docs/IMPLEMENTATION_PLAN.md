# Implementation Plan

## Purpose

Build a generalized, inspectable vertical recovery loop without hardcoding the demo. This plan is milestone/gate driven rather than date driven.

Parallelise **after** shared contracts are frozen. Parallel implementation is valuable; parallel architecture invention is not.

## Milestone 0 — Contract Freeze

### Goal
Create the shared interfaces every implementation lane can rely on.

### Freeze
Domain schemas:
- Organisation
- Traveller
- AnchorEvent
- Trip
- TripElement + subtype envelope
- TripObjective
- Place
- RuleSet/Policy
- Constraint

Operational schemas:
- TripSignal
- MutationProposal
- TripSnapshot
- ImpactAssessment
- RecoveryCase
- RecoveryStrategy
- ActionIntent
- AuthorityDecision
- ExecutionResult

Adapter contracts:
- FlightCapability
- RoutingCapability
- HotelCapability
- ResearchCapability
- SourceIngestionCapability

Read models:
- OperatorTripSummary
- OperatorCaseDetail
- TravellerTripView
- TravellerDecisionRequest

Persistence interfaces:
- TripRepository
- CaseRepository
- SourceRepository
- AuditRepository

### Acceptance gate
- Contracts reflect `PRODUCT_SPEC.md` and `ARCHITECTURE.md`.
- Two materially different paper scenarios fit without scenario-specific types/edges.
- Unknown/uncertain facts and provenance are representable.
- Required/flexible unbooked transport is representable.
- No lane starts by redefining shared contracts locally.

### Qoder strategy
Use one primary Spec-driven Quest. Architecture/schema changes require human review before Build.

## Milestone 1 — Application Foundation

### Goal
Create the smallest runnable application skeleton and storage/config foundations without implementing the full recovery loop.

### Scope
- choose/freeze practical single-app stack and package tooling
- typed domain/operational contracts
- environment/config loader
- repository interfaces
- SQLite implementation with minimal JSON-friendly persistence
- adapter mode abstraction: LIVE / RECORD / REPLAY
- basic test/build/lint/typecheck commands
- operator/traveller route shells consuming typed fixture read models

### Non-goals
- sophisticated graph algorithm
- recovery planning
- polished UI
- external transaction execution

### Acceptance gate
- clean install/run instructions
- Trip and RecoveryCase persist across restart/page refresh locally
- test/build/typecheck/lint baseline passes
- no provider keys required to start in local/replay mode

## Parallel build lanes after contract freeze

Each lane should normally use its own Qoder Quest/worktree. Lane agents treat shared contracts as dependencies, not editable convenience layers.

## Lane A — Core Trip State, Viability and Authority

### Owns
- graph/state construction and deterministic mutation
- fact provenance/freshness resolution
- constraints and duration/buffer evaluators
- dependency propagation
- blast-radius ImpactAssessment
- scenario overlays
- deterministic scenario viability
- RecoveryCase state machine
- AuthorityEngine
- persistence integration for core state

### Inputs
Validated MutationProposal, typed constraints/rules, TripSignals, scenario mutations.

### Outputs
TripSnapshot, ImpactAssessment, viability results, AuthorityDecision, state transitions, audit entries.

### Must not own
- Qwen prompts
- Atlas/provider HTTP clients
- UI presentation
- scenario/location-specific rules

### Acceptance criteria
- time/state change reevaluates relevant dependencies then propagates downstream
- hard failure records irreversible loss without terminating recovery pipeline
- UNKNOWN remains distinct from PASS/FAIL
- scenario overlay never mutates authoritative state
- authority results are deterministic
- scenario substitution tests reveal no hardcoded event/location/provider logic

### Qoder strategy
Primary/high-capability model. Delegate test boilerplate only after evaluator semantics are stable.

## Lane B — Context and Source Ingestion

### Owns
- AnchorEvent URL/page ingestion
- generic webpage/document/text/email/manual import
- booking confirmation extraction
- hotel/supplier policy extraction
- insurance policy ingestion
- organisation/event policy ingestion
- traveller profile input
- explicit preference normalization
- latent preference candidate extraction interface
- source provenance metadata

### Contract
`SourceInput -> structured extraction/mapping -> MutationProposal / RuleSet / uncertainty`

### Must not own
Direct graph mutation.

### Acceptance criteria
- changing source content changes structured output without code edits
- extracted values carry evidence/source metadata
- ambiguity is represented as uncertainty instead of guessed linkage
- at least one AnchorEvent webpage, booking confirmation, hotel policy and insurance document use the generic pipeline

### Qoder strategy
Spec-driven Quest. Cheaper subagents/models can implement parsers and fixtures once schemas are frozen.

## Lane C — External Travel Capability Adapters

### Owns
Provider-neutral adapter interfaces plus concrete hackathon adapters.

### MVP order
1. Atlas direct `search.do`
2. Atlas `verify.do`
3. Atlas fare/change/refund/no-show rules normalization from Search/Verify
4. Google Routes `computeRoutes` context if configured
5. Atlas `getLuggage.do` / `seatAvailability.do` only if useful

### LIVE / RECORD / REPLAY
- LIVE calls provider
- RECORD calls provider and stores sanitized provider-shaped response
- REPLAY reads recorded response
- all modes use same normalizer/downstream engine

### Must not own
Trip-specific recovery logic.

### Acceptance criteria
- Atlas LIVE Search/Verify demonstrated outside pure fixtures
- recorded Atlas response replays through identical normalizer
- provider/network failure returns structured capability failure rather than crashing case
- Google Routes absence does not prevent core startup/replay

### Qoder strategy
Bounded adapter Quest. Do not spend prolonged time on optional provider activation.

## Lane D — Qwen Intelligence and Research

### Owns
- schema-constrained extraction/mapping
- uncertainty identification
- semantic objective/intent interpretation
- latent preference inference
- RecoveryPlanner structured output
- strategy ranking/comparison over deterministic viability evidence
- agentic web research for dynamic context

### Runtime rule
Start with inexpensive Model Studio model(s). Upgrade only when tests show model quality is the limiting factor.

### Safety boundary
Qwen never:
- mutates graph state directly
- performs time arithmetic deterministic code can perform
- declares policy/authority approval
- directly calls money-moving/irreversible actions
- invents legal/entry facts without sources

### Acceptance criteria
- malformed/out-of-schema output fails safely
- planner can request tools/missing information and return multiple structured candidate strategies
- legal/entry findings prefer authoritative sources; timing estimates retain source/uncertainty
- explicit traveller instruction overrides latent preference

### Qoder strategy
Primary model designs prompts/contracts; cheap runtime models validate plumbing. Keep prompt tuning bounded until vertical integration shows quality is blocking.

## Lane E — Operator and Traveller Product UI

### Design principle
User-down, not capability-up. Do not expose graph jargon merely because backend uses it.

### Operator goals
Show who is ready/at risk/disrupted, what changed, what else is affected, what system is doing, what decision is required, what remains uncertain and recovery/audit status.

### Traveller goals
Show whether they are okay, what changed, what matters, what is being done, what input is needed and whether the remainder is viable.

### Acceptance criteria
- UI initially works from frozen typed read-model fixtures
- fixtures can be replaced by actual engine read models without redesign
- disruption -> recovery status change is visually obvious
- approval/input request is understandable without graph terminology

### Qoder strategy
Independent worktree after read-model contracts freeze. Experts mode is acceptable for bounded frontend work if it does not redefine shared contracts.

## Milestone 2 — Vertical Integration

### Goal
Connect the real internal pipeline:

`source/profile -> validated graph -> TripSignal -> mutation -> blast radius -> RecoveryPlanner -> provider queries -> scenario overlays -> deterministic viability -> authority -> external action/simulation -> observation -> graph update -> resolved/read models`

### Acceptance gate
One end-to-end scenario works without manual state edits between stages. UI reads actual engine state. External mocks exist only at unsupported provider action boundaries.

If this gate fails, stop stretch work.

## Milestone 3 — Generalisation and Robustness

### Required scenario substitution
Run at least:
1. AnchorEvent/invited-speaker scenario
2. TMC/corporate traveller scenario

Only data/config/source inputs may change.

### Robustness scenario tests
As capacity allows:
- late arrival vs hotel reception/no-show
- flight -> train/ferry onward dependency
- public transport cutoff -> flexible taxi/ridehail recovery
- accessibility invalidates cheaper option
- shared transport/resource dependency
- already-lost objective with remainder recovery
- visa/entry/immigration buffer affecting connection
- separately booked downstream leg

### Hardcoding audit
Search for fixture names, city names, traveller names, event names, supplier-specific branches and route IDs in domain/recovery logic. Provider names are allowed inside their adapter only.

### Acceptance gate
At least two materially different scenarios pass without application-code modification. Architecture gaps are fixed in shared ontology/contracts, not scenario branches.

## Milestone 4 — Reliability, Replay and Demo Readiness

### Scope
- stable recorded provider responses
- deterministic reset/reseed of demo scenario data
- graceful external API/model failure paths
- audit trail from signal to resolution
- fresh-state and restart/persistence tests
- secret/sensitive-data review
- loading/error/uncertainty states
- README/setup accuracy
- roadmap status updates
- explicit LIVE vs REPLAY vs simulated boundaries

### Acceptance gate
A reviewer can trace the real internal pipeline. Demo runs reliably without consuming live APIs/tokens while same adapters have proven LIVE capability where claimed.

## Integration ownership

Cross-lane integration is not a parallel lane. Primary/lead Quest owns contract mismatches and merge decisions. Lane agents report shared-contract mismatch rather than silently changing schemas.

## Separate bounded investigations

Non-blocking independent investigations:
- Atlas Singapore sandbox fixture availability
- Booking.com Demand API access/partner feasibility
- Google Routes credential setup
- Atlas real order creation feasibility after Search/Verify are stable

Each ends with a decision: adopt now, keep as stretch, defer or reject. Avoid open-ended provider troubleshooting.
