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
- unstructured inputs: Qwen extracts/maps into approved schemas
- output: `MutationProposal` / structured rules / uncertainty, never direct graph writes

### State and viability
- authoritative Trip graph
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

Suggested fields:
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
Structured proposed side effect with operation, target/provider, price delta, reversibility/side-effect level, evidence and expected result.

## 4. Graph relationships

Keep topology small and semantics precise.

Initial relationships:
- `PART_OF`: TripElement -> Trip, Trip -> AnchorEvent where applicable
- `PARTICIPATES_IN`: Traveller/Organisation -> Trip/Engagement with role metadata
- `CONNECTS_TO`: actual expected journey transition, e.g. Flight -> AirportTransfer
- `DEPENDS_ON`: viability of one entity/objective depends on another state/condition
- `GOVERNED_BY`: Trip/element -> RuleSet/Policy
- `COVERED_BY`: Trip/element -> InsurancePolicy
- `REQUIRES`: entity/objective -> requirement/context
- `SHARES_RESOURCE_WITH`: operationally coupled travellers/elements, e.g. shared transfer

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
`Email/web/document/chat -> Qwen extraction/mapping -> MutationProposal + evidence + uncertainty -> schema/business validation -> identity/conflict/authority checks -> deterministic graph mutation`

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
Provider-neutral operations such as flight.search/verify/rules/book/modify/refund, hotel.read/search/modify/cancel, routing.route, entry.research/check, insurance.read/evaluate, communication.notify/request_approval.

Each adapter advertises supported operations and side-effect level. Atlas is the hackathon flight adapter; future GDS/NDC systems plug into the same interface.

## 14. Current external implementation posture

### Atlas
Treat `atlas-hackathon-lab` reports as authoritative. Hackathon direct-API targets:
- `search.do`
- `verify.do`
- fare/change/refund/no-show rule structures from Search/Verify
- `getLuggage.do` and `seatAvailability.do` only when useful

Stretch-only until safely exercised: `order.do`, `queryOrderDetails.do`, incident/webhook and broader refund/post-ticket surfaces. Do not call ordinary cached Search “live inventory.”

### Alibaba Cloud Model Studio
Use OpenAI-compatible/Responses surfaces with Qwen for extraction, planning and semantic judgement. Built-in web search/extraction may provide sourced dynamic context. Start with cheap models for plumbing. Validate structured output.

### Google Routes
Optional `computeRoutes` adapter for traffic-aware driving/transit context. It must fail gracefully or use recorded/fallback context if credentials are absent.

### Hotel
Generic HotelCapability works from imported booking/policy data without a transactional hotel API. Booking.com Demand API is a stretch investigation; if partner credentials appear, it may provide accommodation search/order-management capabilities. Never make it a core dependency.

### Entry/immigration
Use authoritative sources for legal facts. Commercial IATA Timatic/AutoCheck is future/deferred.

### Insurance
Ingest at least one real policy/document into structured rules. Do not automate claims in MVP.

### Future adapters
Potential adapters include Gmail (`users.messages.*`, `users.history.list`, `users.watch`), Booking.com Demand, Expedia Rapid, Timatic AutoCheck, Amadeus, Sabre, Travelport and other NDC/GDS systems. They plug into capability/source interfaces rather than alter graph logic.

## 15. Case state machine

`DETECTED -> ASSESSING -> PLANNING -> READY_TO_EXECUTE | AWAITING_TRAVELLER | AWAITING_APPROVAL | ESCALATED -> EXECUTING -> VERIFYING -> RESOLVED`

`VERIFYING` may loop back to ASSESSING/PLANNING if the action did not restore viability or new state appears.

Resolution outcomes include FULLY_RECOVERED and RECOVERED_WITH_LOSS. An API success is not case resolution; observed state and affected constraints/objectives determine resolution.

## 16. Persistence

Use repository interfaces with SQLite initially. Keep rich trip/case state JSON-friendly to avoid premature relational graph schema design. Logical stores: trips, cases, signals/events, sources, audit. Do not introduce Neo4j merely because the domain is graph-shaped.

## 17. UI read-model boundary

UI consumes purpose-built projections, not arbitrary graph queries.

Operator projections expose readiness, current case, what changed, affected downstream items, recommendation, required decision, traveller response, uncertainty and next action.

Traveller projections expose status, what changed, what matters, actions being taken, choices requiring input and whether the remainder is viable.

A graph visualization may exist in demo/debug views, but internal terminology must not drive user-facing information architecture.
