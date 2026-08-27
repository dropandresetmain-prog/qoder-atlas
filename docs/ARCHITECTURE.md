# Logical Architecture

## 1. Architecture thesis

The system is a **persistent trip state model + deterministic viability engine + agentic recovery planner + deterministic authority/execution layer**.

The graph/state model is central. Chat is one interface into operational state.

Required boundary:

`AI proposal -> schema/business validation -> deterministic scenario viability -> authority -> executor -> observation -> graph update`

The planner may propose how the trip should change. It does not get to declare the resulting trip valid or directly perform irreversible actions.

## 2. Logical layers

### Input and context sources
- AnchorEvent webpage/schedule/briefing
- traveller profile and messages
- booking confirmations/email/PDF/manual import
- Atlas/provider state
- supplier policies
- local route/transport context
- immigration/entry research
- insurance
- organisation/event policy

### Interpretation and normalization
- structured inputs: deterministic mapper where possible
- unstructured inputs: Model Studio/Qwen extracts/maps into approved schemas
- output: `MutationProposal` / structured rules / uncertainty, never direct graph writes

### State and viability
- authoritative Trip graph/state
- fact provenance/freshness
- deterministic constraint evaluation
- dependency propagation
- blast-radius/impact assessment

### Recovery
- RecoveryPlanner receives relevant Trip snapshot, impact assessment, constraints, objectives, authority context and available capabilities
- planner requests information/tools and proposes structured RecoveryStrategies
- each strategy creates a temporary scenario overlay
- deterministic viability engine evaluates the overlay
- planner/ranker compares viable strategies on softer objectives

### Authority and execution
- every consequential side effect becomes an ActionIntent
- deterministic AuthorityEngine returns auto-approved, traveller approval, organisation approval, human escalation or blocked
- final provider revalidation occurs before irreversible action when applicable
- executor performs action through a provider capability
- result is observed and deterministically reflected into state

## 3. Domain ontology

### Organisation
May act as operator, policy owner, approver, payer or duty-of-care party. Organisation type is descriptive; behaviour derives from policies/permissions rather than `if TMC` / `if event organiser` branches.

### Traveller
Persistent context may include identity, home airport, nationality/passport context, accessibility requirements, loyalty status, insurance, communication preference and explicit/inferred travel preferences.

### AnchorEvent
Optional shared context for multiple Trips: conference, concert, retreat, tournament, wedding, offsite, trade mission, etc. It can provide shared location, schedule, engagements, organiser instructions and policy without duplicating those inputs across travellers.

For Northstar (ADR-034) the AnchorEvent is additionally the **programme aggregate** ("mother graph" in product language): shared programme truth/context for many traveller Trips. This is NOT a second graph engine or a graph database — it is one AnchorEvent entity plus typed references from Trips and Engagements, with programme-level state derived as read models.

Shared programme items are addressable `AnchorCommitment` children of the AnchorEvent (generic kinds: SESSION / SOCIAL / LOGISTICS / OTHER). A per-trip `Engagement` references one commitment via `data.anchorCommitmentId`. Commitments carry **no** importance or hardness: how binding a commitment is differs per traveller and is expressed by each trip's own engagement `importance`. Changes to a commitment propagate via `ANCHOR_COMMITMENT_CHANGE` signals and a programme fan-out coordinator (see §3a).

### Trip
Aggregate root for operational journey state. A Trip links travellers, TripElements, objectives, applicable rules/constraints, governance and viability state.

### TripElement
Base reusable trip element with subtype-specific data.

Initial subtypes:
- **TransportLeg**: flight, train, ferry, public transit, taxi/ridehail, private transfer, car rental, etc.
- **Stay**: hotel/hostel/apartment/other accommodation.
- **Engagement**: keynote, meeting, dinner, activity, concert attendance, retreat session, etc.

Orthogonal dimensions:
- `importance`: REQUIRED / PREFERRED / OPTIONAL
- `flexibility`: FIXED / CHANGEABLE / FLEXIBLE
- `reservation_state`: NONE / HELD / CONFIRMED / CHANGED / CANCELLED / COMPLETED / UNKNOWN

Example: airport -> hotel transport may be REQUIRED + FLEXIBLE + NONE/ON_DEMAND, allowing transit/taxi/private transfer recovery without inventing a pre-existing booking.

### TripObjective
Represents what success means: attend keynote, reach client meeting, preserve accessibility, return by a deadline, etc. Objectives may be hard or soft and can be explicitly reprioritized by an authorised person.

### Place
Relevant trip location only: airport, station, ferry terminal, hotel, venue, etc. Place context may carry timezone, coordinates and references used by routing/opening-hour sources. This is not a world geography graph.

### RuleSet / Policy
Structured rules from suppliers, organisations, immigration/entry sources or insurance. Raw source material stays outside graph state; structured rules retain provenance.

### Constraint
Evaluatable condition referencing relevant entities/facts.

Suggested conceptual fields:
- kind: temporal, transfer, location, entry, accessibility, supplier, policy, financial, objective
- hardness: HARD / SOFT
- owner/source authority
- evaluator: DETERMINISTIC / SEMANTIC
- status: PASS / FAIL / UNKNOWN
- referenced entities/facts
- provenance

Semantic context should be interpreted into durable structured constraints/objectives where possible instead of repeatedly asking the LLM the same question.

### TripSignal
Normalized incoming change/event: who/which trip/what changed/source/authority/confidence/timestamp/structured payload.

### RecoveryCase
Operational workflow record referencing triggering signals, affected elements, failed/unknown constraints, strategies, approvals, actions, observations and audit history. It is not a graph node merely because it references the graph.

### RecoveryStrategy
Structured hypothetical recovery plan containing candidate mutations, tool needs, assumptions, unresolved uncertainty, cost/impact and expected outcomes.

### ActionIntent
Structured proposed side effect with operation, target/provider, price delta, reversibility/side-effect level, evidence and expected result. Where mixed funding applies, the intent additionally carries a deterministic `CostAllocation` (covered vs incremental amounts and payers, derived from `FUNDED_WINDOW` rules and the traveller's funding declaration — see §12a).

## 3a. Programme semantics (Northstar, ADR-034..038)

### Programme fan-out coordinator
When a shared commitment changes, a programme-level coordinator:
1. validates the `ANCHOR_COMMITMENT_CHANGE` payload shape;
2. identifies every Engagement across all Trips whose `anchorCommitmentId` matches;
3. fans the change out into **ordinary per-Trip processing** — one signal-driven impact/recovery pass per affected Trip.

The coordinator never teaches the ImpactEngine to reason over a whole event; the engine keeps its proven per-Trip scope. The coordinator is deterministic discovery + dispatch, not a second engine.

### Programme traveller intake (ADR-035)
One normalized pre-authoritative contract (`ProgrammeImportDraft` / `ProgrammeTravellerDraft`) serves manual entry, later add/update, bulk file import and LLM-assisted mapping from messy briefs. Drafts are data only; deterministic validation and promotion through the frozen mutation path is the sole route to authoritative Traveller/Trip state. Single and bulk paths are equivalent at promotion time; the channel is provenance, not behaviour.

### Initial trip planning (ADR-038)
A confirmed traveller with commitments and policy but no viable trip yet enters the SAME generalized engine. A Trip may legitimately have zero elements and viability `UNKNOWN`; a case carries `caseKind: INITIAL_PLANNING` as classification evidence only. The planner proposes candidate elements; overlay viability, authority, execution and observation are unchanged. There is no separate booking engine: the engine's assumptions (an existing failed element, a disruption signal, an already-invalid booking) do not gate the pipeline — missing required elements are simply what candidates add.

### Traveller ChangeRequest / ResolutionTarget (ADR-036)
Traveller desire != authoritative provider state. A request becomes a `ChangeRequest` carrying a declarative `ResolutionTarget`: desired trip-window shifts, transport attributes, stay proximity and objective effects — and nothing else. The target contains no element mutations, booking ids or provider operations, so a request can never encode a state change. The request normalizes into a `TRAVELLER_INPUT` signal; the standard pipeline compares the target against the CURRENT authoritative trip, plans strategies, evaluates overlays, applies policy/authority, executes and observes. Booked flight/hotel schedules never mutate because a traveller asked for a new schedule.

The same contract represents at least: (1) earlier arrival + later departure + partial self-funding; (2) later/different flight, preferably direct; (3) hotel change closer to the event venue.

### Programme-level read model
Programme/operator state is a projection over authoritative AnchorEvent / Trip / RecoveryCase state (`ProgrammeView`): per-status rollups, endangered commitments with affected travellers, active cases, decisions required, unresolved uncertainty. No UI-local truth.

## 4. Graph relationships

Keep topology small and semantics precise.

Initial relationships (conceptual):
- `PART_OF`: TripElement -> Trip, Trip -> AnchorEvent where applicable — represented by **typed aggregate fields** (`TripElement.tripId`, `Trip.anchorEventId`), not as edges;
- `PARTICIPATES_IN`: Traveller/Organisation -> Trip/Engagement with role metadata — represented by **typed aggregate fields** (`Trip.travellerIds`, `Engagement.participantRole`, organisation roles), not as edges;
- `CONNECTS_TO`: actual expected journey transition, e.g. Flight -> AirportTransfer;
- `DEPENDS_ON`: viability of one entity/objective depends on another state/condition;
- `GOVERNED_BY`: Trip/element -> RuleSet/Policy — represented by **typed aggregate fields** (`Trip.governedByRuleSetIds`, element `governedByRuleSetIds`), not as edges;
- `COVERED_BY`: Trip/element -> InsurancePolicy — represented by **typed aggregate fields** (`Traveller.insuranceRuleSetIds`), not as edges;
- `REQUIRES`: entity/objective -> requirement/context;
- `SHARES_RESOURCE_WITH`: operationally coupled travellers/elements, e.g. shared transfer.

The executable relation vocabulary (`TripRelationKindSchema`) therefore contains only `CONNECTS_TO`, `DEPENDS_ON`, `SHARES_RESOURCE_WITH` and `REQUIRES` (ADR-026). This is deliberate normalization, not an oversight: field-represented semantics must not be reintroduced as edges, and lanes must not add duplicate relation types for them.

Do not encode every rule as an edge. `MUST_ARRIVE_BEFORE`, `MUST_OCCUR_BEFORE`, `INVALIDATES_IF` and similar semantics belong in constraints/predicates so topology does not explode.

Chronology alone is not a dependency. A hotel does not automatically precede or determine a keynote simply because it occurs earlier.

## 5. Facts, provenance, confidence and freshness

Avoid one meaningless node-level confidence score. Critical facts may differ in assurance.

```text
Fact<T> {
  value
  source
  authority: AUTHORITATIVE | CONNECTED | ASSERTED | INFERRED
  confidence?
  observed_at
  verified_at?
  valid_until?
}
```

Freshness derives from source + last verification + expected volatility. Conflicting observations remain in history; deterministic truth-resolution chooses current operational state according to source authority/freshness rather than last-write-wins.

## 6. Preferences

Precedence:
1. current explicit instruction
2. trip-specific explicit preference
3. persistent explicit preference
4. latent/inferred preference

Latent preferences are soft ranking signals only. Accessibility or safety/legal requirements are constraints, not preferences.

## 7. Buffers and dynamic context

Use duration envelopes rather than fake precision where inputs are uncertain:

```text
DurationEstimate {
  minimum?
  expected
  conservative?
  source
  observed_at
  confidence/quality
}
```

Examples: immigration/airport processing estimate from sourced web research; traffic-aware airport -> hotel duration from Google Routes; transfer/check-in buffer from policy/configuration.

Legal/entry facts require authoritative sources. Operational immigration timing may use sourced agentic web research and must remain labelled as estimate/uncertainty. `UNKNOWN` is valid state.

## 8. Mutation pipeline

Structured provider input:

`Provider payload -> deterministic mapper -> MutationProposal -> schema/business validation -> deterministic graph mutation`

Unstructured input:

`Email/web/document/chat -> AI extraction/mapping -> MutationProposal + evidence + uncertainty -> schema/business validation -> identity/conflict/authority checks -> deterministic graph mutation`

Bound mutation vocabulary, e.g. UPSERT_ENTITY, UPSERT_FACT, ADD_RELATION, REMOVE_RELATION, UPSERT_CONSTRAINT, WAIVE_OR_REPRIORITIZE_OBJECTIVE where authorised.

Unknown entity/relation types are rejected. Ambiguous identity does not silently attach to a random entity.

## 9. Impact propagation and blast radius

A changed fact triggers reevaluation of constraints referencing it, then relevant downstream dependency traversal.

An invalid upstream element must not automatically mark every descendant invalid. Downstream states may be VALID, AT_RISK, INVALID or UNKNOWN depending on current constraints and recoverability.

`ImpactAssessment` exposes at least:
- direct failures
- affected elements
- threatened objectives
- irreversible losses
- affected travellers/shared resources
- policy implications
- insurance implications
- financial exposure
- unresolved unknowns
- recovery headroom
- severity

A hard constraint failure never crashes the pipeline. If an objective is irreversibly lost, mark the loss and continue recovering remaining objectives.

## 10. Scenario overlays

Candidate alternatives do not enter the authoritative graph.

`authoritative Trip snapshot + RecoveryStrategy mutations = Scenario overlay`

The deterministic viability engine evaluates each overlay. Feasible scenarios can then be ranked on softer objectives such as cost, convenience, preferences and robustness. Only successful observed actions mutate authoritative state.

## 11. Recovery planner contract

Inputs:
- relevant Trip snapshot/subgraph
- triggering signal(s)
- ImpactAssessment
- hard constraints and soft objectives
- known uncertainty/missing data
- traveller preference context
- authority context
- available capability registry
- current RecoveryCase state
- previous tool/action results

Outputs:
- information/tool queries required
- structured RecoveryStrategies
- assumptions and uncertainty
- recommended strategy/ranking rationale

Planner must not claim deterministic checks passed without evaluator evidence.

## 12. Authority architecture

Deterministic evaluation over delegated authority, permissions, organisation/event policy, spend threshold, reversibility, source assurance, supplier-rule certainty, traveller impact, duty-of-care severity and provider capability.

Outcomes:
- AUTO_APPROVED
- REQUIRES_TRAVELLER
- REQUIRES_ORGANISATION_APPROVER
- REQUIRES_HUMAN_AGENT
- BLOCKED

Approval principals are role/permission records, not separate TMC/event-specific workflows.

## 13. Capability abstraction

Two families:

### Input/context adapters
Normalize event webpages, emails, calendar, traveller messages, provider webhooks, uploads and web research into approved source data or TripSignals.

### Operational capability adapters
Provider-neutral operations such as flight.search/verify/rules/book/modify/refund, hotel.search/quote/book/retrieve/read/modify/cancel, transfer.search/quote/book/retrieve/amend/cancel, routing.route, entry.research/check, insurance.read/evaluate, communication.notify/request_approval.

Each adapter advertises supported operations and side-effect level. Atlas is the hackathon flight adapter; future GDS/NDC systems plug into the same interface. Read-only operations may back planner tools; consequential operations are only reachable through the authority path and are never exposed as tool vocabulary.

## 14. Current external implementation posture

### Atlas
Treat `atlas-hackathon-lab` reports as authoritative. Mandatory hackathon direct-API targets:
- `search.do`
- `verify.do`
- fare/change/refund/no-show rule structures needed by recovery

Conditional/Stretch:
- `getLuggage.do` and `seatAvailability.do` only if a chosen scenario needs them
- `order.do`, `queryOrderDetails.do`, incident/webhook and broader refund/post-ticket surfaces until safely exercised

Do not call ordinary cached Search “live inventory.”

### Alibaba Cloud Model Studio
Use structured/OpenAI-compatible/Responses surfaces with Qwen or another suitable Model Studio model for extraction, planning and semantic judgement. Built-in web research may provide sourced dynamic context. Start with cheap runtime models for plumbing; validate structured output.

### Google Routes
Optional `computeRoutes` adapter for traffic-aware driving/transit context. It must fail gracefully or use recorded/sourced/unknown context if credentials/network are absent.

### Hotel
`HotelCapability` is the provider-neutral seam: search/quote/book/retrieve on top of imported booking/policy data, plus context/modify/cancel. MVP runs on imported booking/policy data without a transactional hotel API. After contract freeze, one real hotel API adapter may be added behind the same boundary. Until a provider says "cancelled", the system treats change as cancel+rebook, not mutation. Booking.com Demand API remains Stretch; if partner credentials become immediately available it may be added behind the same capability boundary.

### Ground transfer
`TransferCapability` is a provider-neutral seam (search/quote/book/retrieve/amend/cancel) with the same CapabilityResult envelope and opaque provider ids. No adapter is implemented in MVP; dispatch reports honest capability absence. Hotelbeds Transfers API is the first candidate (Stretch P1).

### Entry/immigration
Use authoritative sources for legal facts. Commercial Timatic/AutoCheck is future/deferred.

### Insurance
Ingest at least one real policy/document into structured rules. Do not automate claims in MVP.

### Future adapters
Potential adapters include Gmail, Booking.com Demand, Expedia Rapid, Timatic, Amadeus, Sabre, Travelport and other NDC/GDS systems. They plug into capability/source interfaces rather than alter graph logic.

## 15. Case state machine

`DETECTED -> ASSESSING -> PLANNING -> READY_TO_EXECUTE | AWAITING_TRAVELLER | AWAITING_APPROVAL | ESCALATED -> EXECUTING -> VERIFYING -> RESOLVED`

`ASSESSING`, `PLANNING`, `READY_TO_EXECUTE`, `AWAITING_TRAVELLER`, and `AWAITING_APPROVAL` may also move directly to `RESOLVED` when a later authorised mutation (for example a programme commit) re-evaluates the same trip as viable without executing a staged travel recovery. `EXECUTING` still observes via `VERIFYING` first.

`VERIFYING` may loop back to ASSESSING/PLANNING if the action did not restore viability or new state appears.

Resolution outcomes include FULLY_RECOVERED and RECOVERED_WITH_LOSS. An API success is not case resolution; observed state and affected constraints/objectives determine resolution.

## 16. Persistence

Use repository interfaces with SQLite initially. Keep rich trip/case state JSON-friendly to avoid premature relational graph-schema design. Logical stores: trips, cases, signals/events, sources, audit.

Do not introduce a graph database merely because the domain is graph-shaped.

## 17. UI read-model boundary

UI consumes purpose-built projections, not arbitrary graph queries.

Operator projections expose readiness, current case, what changed, affected downstream items, recommendation, required decision, traveller response, uncertainty and next action.

Traveller projections expose status, what changed, what matters, actions being taken, choices requiring input and whether the remainder is viable.

A graph visualization may exist in demo/debug views, but internal terminology must not drive user-facing information architecture.

## 18. Logical architecture vs frozen implementation contracts

This document defines **logical architecture and invariants**, not exact TypeScript filenames or final interface syntax.

`docs/IMPLEMENTATION_PLAN.md` Checkpoint A turns this architecture into executable contracts:

- domain/operational runtime schemas;
- service boundaries;
- capability interfaces;
- persistence interfaces;
- planner input/output;
- UI read models;
- exact path ownership.

Before Checkpoint A is accepted, examples/pseudocode here are architectural guidance rather than permission for parallel agents to invent incompatible schemas.

After contract freeze:
- implementation lanes consume the shared contracts;
- a lane may not fork/redefine them locally;
- if implementation evidence shows a contract is inadequate, raise an **architecture gap** to the lead/integrator;
- any accepted cross-cutting contract change updates this document/`DECISIONS.md` where the logical architecture changed, plus affected tests and the implementation-plan tracker.

Do not solve a contract mismatch with demo-specific branches or parallel local DTOs.
