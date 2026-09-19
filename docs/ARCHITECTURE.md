# Northstar architecture

Northstar is an **AI Travel Resolution Engine** built around a persistent operational model of a journey, its purpose, dependencies, requirements and recovery state.

The graph/state model is central. Chat, dashboards and traveller surfaces are interfaces over it; none is the source of truth.

```mermaid
flowchart TD
  I[Inputs / observations / requests] --> N[Normalisation + validation]
  N --> S[Authoritative current state]
  S --> C[Relevant-scope discovery + consequence evaluation]
  C --> D[Recovery domains + evidence gaps]
  D --> T[Bounded read-only evidence]
  T --> P[Recovery candidates]
  P --> V[Deterministic scenario viability]
  V --> M[Viable-only comparison + recommendation]
  M --> A[Policy + authority]
  A --> E[Typed execution]
  E --> O[Receipt / provider observation]
  O --> R[Reconciliation]
  R --> S
```

The non-negotiable consequential-action boundary is:

```text
AI proposal -> validation -> deterministic viability -> authority
            -> executor -> observation -> state update
```

An LLM cannot directly mutate authoritative state or invoke an irreversible or money-moving action.

## Architecture status: accepted R3 recovery loop

The M0-M10 data/state refactor is accepted through C5. PostgreSQL + PostGIS is the sole
normal runtime; SQLite is migration/historical input only.

The 2026-09-18 truth rebase identified missing planning/product composition. R1-R3 have now
closed the rebased B1 loop without restoring the retired RuntimeOrchestrator or SQLite
runtime. R3 local acceptance at
`d9bb9a5f03785db60b6657ca7dfe7c182b07dbd3` proved the normal `main.ts` PostgreSQL
runtime and real browser flow.

Implemented through R3: generalized recovery-domain/evidence coordination; durable bounded
PlanningAttempt evidence; material deterministic rejection evidence; viable-only
recommendation; three distinct impact semantics; one Recovery Lifecycle Progression owner;
Case decision workspace + immutable Original/current graph semantics; normal-boot read-only
Atlas `flight.search`; internal programme execution/observation/reassessment/resolution;
and a materially different non-programme connection proof.

The next architecture work is provider capability reachability/composition, not another
engine rewrite:

`provider parity audit -> all Atlas capability restoration -> remaining required adapter
restoration -> B2 consequential external execution -> post-E2E product/observability ->
M11/C6`.

## Recovery architecture

The deterministic PostgreSQL spine already exists. The missing composition sits between a
RecoveryCase/current failure and the existing candidate-validation/RC-6 path:

```text
authoritative change / request / new information
 -> ChangeSignal + canonical state
 -> targeted invalidation / M6 reassessment
 -> deterministic escalation / RecoveryCase
 -> Recovery Planning Coordinator
      -> relevant recovery domains
      -> evidence gaps
      -> bounded read-only capability calls
      -> StrategyProposers
      -> ProposalCandidates
 -> schema/business validation
 -> RC-6 counterfactual evaluation
      -> material deterministic rejection evidence
      -> VIABLE RecoveryStrategies
 -> viable-only strategy comparison / recommendation
 -> ActionPlan
 -> authority / approval
 -> executor
 -> observation / reconciliation
 -> canonical state
 -> reassessment
 -> Recovery Lifecycle Progression
      -> resolve
      -> re-enter planning from the new current basis
      -> or escalate / await decision
```

Key boundaries:

- **StrategyProposer proposes; RC-6 decides viability.**
- **Read-only planning tools cannot represent consequential operations.**
- **Viable executable alternatives remain RecoveryStrategy objects.** Material rejected
  alternatives are bounded planning evidence, not fake executable strategies.
- **Recommendation sees only current VIABLE strategies** and cannot override RC-6.
- **RuntimeServices remains the single composition root.** One recovery-lifecycle
  progression owner restores continued recovery without restoring RuntimeOrchestrator.
- **Provider/API success is not recovery.** Resolution still requires reconciled execution
  and fresh required-subject PASS.

### Counterfactual viability (RC-6)

The dependency closure answers **what must be reassessed**. It does not mean every reached
subject must become PASS.

A strategy is viable only when:

1. the blocking case subjects it is responsible for resolve to PASS;
2. no reached subject regresses because of the proposal;
3. no new/action-critical UNKNOWN is introduced;
4. explicit `requiredUnknowns` are absent.

Unchanged pre-existing unrelated FAIL/UNKNOWN remains visible and truthful but does not
automatically veto the strategy.

### Three distinct impact semantics

Backend/read models must keep these separate:

1. **`immediateChangeBlastRadius`** — direct changed/affected objects and subjects from
   validated ScenarioChange effects plus deterministic direct-impact projection;
2. **`reassessmentClosure`** — broader M6/RC-6 dependency/applicability scope actually
   reevaluated;
3. **`outcomeDelta`** — decision-time baseline -> candidate subject verdicts classified
   better/worse/unchanged.

The browser never infers or collapses these meanings.

## Current implemented architecture

The current runtime is a PostgreSQL-backed modular monolith with deterministic domain/evaluation code separated from persistence, provider adapters and delivery workers.

Core ownership concepts are:

| Object | Current role |
|---|---|
| Workspace | Data/access partition and top-level operational scope. |
| Organisation | Business party for policy, payer, duty-of-care and approval context. |
| Traveller | Stable person identity. |
| Trip | Shared undertaking/purpose that may contain several travellers. |
| Journey | One Traveller's independently managed participation in a Trip. |
| JourneyItem | Intended travel/programme participation owned by a Journey. |
| TransportService / Resource | Shared operational fulfilment independent of traveller intent. |
| Reservation / ReservationLine / Allocation / Entitlement | Supplier commitments, shared use and traveller allocation. |
| Event -> Programme -> ProgrammeItem | Mutable event/programme truth. |
| Participation | Person-to-programme participation independent of whether that person has a Journey. |
| RuleSet / Constraint / Requirement | Sourced or internal rules evaluated deterministically. |
| InformationRecord / InformationVersion / Evidence | Versioned external knowledge, provenance, freshness and coverage. |
| Assessment | Immutable computed result bound to revisions/generations/evidence/time. |
| RecoveryCase / RecoveryStrategy / ActionPlan | Resolution work over current state and proposed changes. |
| AuthorityDecision / ActionIntent / ExecutionAttempt / Observation | Consequential-action safety, durable execution and reconciliation. |

Legacy aggregate/SQLite modules remain in-tree only for migration/historical evidence. They are structurally unreachable from the normal runtime.

## One owner for each kind of truth

NORTHSTAR distinguishes five classes of information:

1. **Observed** — what a provider, publisher, person or external system reports.
2. **Intended** — what the traveller/organisation plans to do.
3. **Required** — policies, legal/operational requirements, objectives and constraints that must hold.
4. **Proposed** — hypothetical recovery changes under evaluation.
5. **Computed** — assessments, viability, exposure and other deterministic conclusions.

A value has one canonical current owner. Other surfaces may project/cache it, but a projection is explicitly non-authoritative and carries enough revision/generation context to detect staleness.

Examples:

- Programme time/location belongs to `ProgrammeItem`, not copied editable Engagement fields.
- Supplier booking state belongs to Reservation/line observations, not Journey intent.
- Desired travel windows belong to Journey/JourneyItem and never overwrite provider schedules.
- Entry eligibility and trip viability are computed assessments, not fields a model/user edits.
- Submitting an externally owned change is not success; observation/reconciliation establishes the new provider state.

## Relationships and the operational graph

NORTHSTAR does not require a graph database. Most relationships are normal relational/domain references.

Use explicit executable dependency semantics only where ordinary ownership/reference links are insufficient. The generic dependency vocabulary starts with:

- `CONNECTS_TO` — upstream context affects downstream connection/order feasibility; failure triggers reevaluation rather than blanket invalidation.
- `REQUIRES` — a subject depends on a prerequisite through a registered requirement/evaluator.

Travel-together, accompaniment, co-presence, capacity and similar conditions are typed requirements, not vague graph edges.

Consequence propagation is deliberate:

```text
change/new evidence
 -> discover potentially affected subjects using reverse references/dependencies/applicability
 -> load sufficient current context
 -> run registered deterministic evaluators
 -> record a revision/time/evidence-bound Assessment
 -> open/update recovery work only where action/investigation is needed
```

Geography/population/time-wide information such as advisories or weather should use applicability matching rather than permanent edges from every publication to every traveller.

## External information and extensibility

The architecture does not attempt to predict every future travel-data category. A new category must establish:

- whether it is observed information, internally owned state, requirement, intention or computed result;
- stable identity/lifecycle where warranted;
- provenance, ordering, freshness and coverage;
- applicability by entity/geography/population/time;
- deterministic consumer/evaluator semantics;
- reverse applicability/dependency discovery;
- assessment invalidation rules;
- optional action capability if NORTHSTAR can do something about it.

Weather, new regulatory publications, resource availability and future trip-relevant information can therefore add typed modules/subtypes/evaluators without changing what Trip, Journey, Programme, Reservation, Assessment or RecoveryCase mean.

Do not solve extensibility with a generic entity-attribute-value/JSON dumping ground.

## Programme and group semantics

Programme state is real mutable domain state. Moving/cancelling a ProgrammeItem is an authoritative domain change (or an externally owned request awaiting observation) that can affect many participations/Journeys and must be evaluated through the same consequence/recovery machinery.

Group travel is represented without a universal main/sub-traveller hierarchy:

- one shared Trip can contain several per-person Journeys;
- relationships such as guardianship/support are sourced associations;
- accompaniment/co-presence requirements are explicit operational requirements;
- booking allocations separately state who uses a shared reservation;
- authority grants separately state who may consent/spend/act;
- CoordinationGroups represent scoped subsets when coordinated decisions are actually needed.

A group can diverge/reconverge without duplicating people/bookings or losing individual entry/viability results.

## Advisory and entry semantics

Travel advisories/conditions preserve publisher-specific versions, source-native levels/text, applicability, effective dates, supersession/retraction, provenance and coverage. There is no universal "highest authority wins" risk field. Fast emerging reports and slower official guidance may coexist; organisational policy determines how each affects action/approval while the original claims remain distinguishable.

Entry/transit feasibility is traveller- and itinerary-specific. Credentials, intended visits, document selections, route/transit context and versioned authoritative requirements feed deterministic three-valued evaluation. Missing coverage remains `UNKNOWN`; an organisation cannot approve a legal requirement into `PASS`.

The architecture and evaluator boundaries for these domains are implemented. Current provider/source coverage does **not** constitute legal-grade live entry/advisory coverage; implementation truth remains in `CAPABILITIES_AND_LIMITATIONS.md`.

## Deterministic and agentic responsibilities

| Agentic | Deterministic |
|---|---|
| Interpret unstructured input, extract candidates, identify uncertainty, infer soft preferences, judge semantic consequences, propose/compare strategies | Schema/business validation, authoritative mutation, money/time arithmetic, applicability/dependency propagation, policy thresholds, authority, lifecycle transitions, viability, execution validation and reconciliation |

AI outputs are proposals/evidence transformations subject to typed validation. They cannot create provider facts, legal certainty or execution authority.

## Persistence

### Current runtime

The current runtime uses **PostgreSQL + PostGIS** with:

- relational identity/ownership and foreign keys;
- typed domain tables instead of whole mutable Trip/Journey/Programme/Case JSON blobs;
- bounded JSON only for appropriate immutable/provider/rule/proposal detail;
- aggregate revisions and expected-revision commands;
- idempotency receipts/change records;
- short transactions, deterministic locking/serializable retries where required;
- durable inbox/outbox/scheduled reassessment work;
- explicit migration/reconciliation rather than routine dual-writing.

### Retired SQLite boundary

SQLite is not an application runtime. It remains only for:

- read-only legacy migration sources;
- deterministic migration/rehearsal fixtures;
- historical tests and code archaeology.

`test/m10-runtime-purge.test.ts` and `npm run gate:test-boundary` enforce that live runtime/current tests cannot reach the retired composition.

No graph database, event-sourcing requirement, Kafka, Kubernetes or microservice split is implied by this design.

## Provider and external-system boundaries

Atlas, Nuitée/liteAPI, Google Routes, Frankfurter, Model Studio/Qwen, optional OpenRouter
and future external systems are provider/source adapters, not product architecture.

Where practical:

```text
LIVE   -> provider/source -> normalization -> NORTHSTAR
RECORD -> provider/source -> sanitized provider-shaped recording -> normalization -> NORTHSTAR
REPLAY -> recording -> normalization -> NORTHSTAR
```

R3 proves this downstream identity for the normal-boot Atlas read-only search seam in
REPLAY. It does **not** prove that every surviving historical adapter is normal-boot
reachable. Provider restoration must explicitly prove composition and callers per
operation.

Consequential provider operations remain behind:

`proposal -> validation -> deterministic viability -> authority -> durable execution
attempt -> provider -> observation/reconciliation -> canonical state -> reassessment`.

## Read models and interfaces

Operator and traveller surfaces project from the same canonical state and assessment currency. UI terminology should answer operational questions without exposing internal graph/agent jargon.

The accepted frontend semantic boundary is:

`authoritative backend/read model -> semantic adapter -> normalized presentation model -> shared visual grammar -> UI`

The accepted live read-model contract supplies stable relation identity/authority, monotonic change cursor, assessment lifecycle exposure, subject-keyed refs and authoritative traveller naming. Frontends apply the **complete authoritative snapshot**; `changedVisibleRefs` is an at-least-once transition/emphasis hint, not an exact diff.

The focused V5.6 case graph is an accepted visual reference, not an authoritative data fixture.

The final Event Overview visual design is unresolved. Do not create backend-specific semantics solely to satisfy a rejected prototype.

## Current delivery boundary

R1, R2 and R3 are accepted.

Current sequence:

`provider parity audit -> ALL Atlas capability restoration -> remaining required historical
adapter restoration -> B2 consequential external execution -> accepted Event Overview /
semantic operational history -> M11/C6`.

The accepted Event Overview V7.2 design remains a separate future implementation input.
M11 remains operational activation/retirement, not a return to an active SQLite runtime.

