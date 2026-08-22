# Architecture Decision Log

Keep entries concise. Record decisions that materially constrain implementation. Supersede rather than silently rewrite historical decisions.

## ADR-001 — One generalized recovery engine
**Status:** Accepted

TMC, corporate HR/EA, event organiser, group and future direct users share the same trip-resolution engine. Segment differences are policy, permissions, approvals, scale and UI configuration.

## ADR-002 — Graph/state model is central; chat is not
**Status:** Accepted

Operational truth persists independently of conversation history. Chat reads/writes through validated domain services.

## ADR-003 — Agentic interpretation, deterministic mutation
**Status:** Accepted

AI may interpret messy context and propose schema-constrained mutations. Deterministic services validate and apply graph/state changes.

## ADR-004 — Deterministic viability and authority
**Status:** Accepted

Arithmetic, time windows, buffers, policy thresholds, permissions, scenario viability and execution gates are deterministic. AI may compare viable strategies and interpret semantic tradeoffs.

## ADR-005 — No direct LLM side effects
**Status:** Accepted

Irreversible/financial flow must be:
`AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`.

## ADR-006 — Atlas direct API is the hackathon flight adapter
**Status:** Accepted

The direct API has the richest/reliably tested research surface. Atlas is behind provider-neutral FlightCapability; domain/recovery must not depend on Atlas-specific structures.

## ADR-007 — External mocks only at provider boundaries
**Status:** Accepted

When transactional access is unavailable, simulate provider action/response at adapter boundary. Do not mock graph propagation, planning, viability, authority or case resolution.

## ADR-008 — LIVE / RECORD / REPLAY
**Status:** Accepted

External adapters should support LIVE/RECORD/REPLAY where practical. Recorded provider-shaped data must pass through same normalizer and engine as LIVE data.

## ADR-009 — SQLite first; no graph database
**Status:** Accepted

Hackathon scale does not justify Neo4j or infrastructure complexity. Use repository interfaces and SQLite with JSON-friendly state. Persistence can later be replaced without changing domain logic.

## ADR-010 — Optional AnchorEvent above Trips
**Status:** Accepted

AnchorEvent holds shared context for conferences, concerts, retreats, tournaments, offsites and similar anchors. It is optional; unrelated TMC trips do not require it.

## ADR-011 — Reusable TripElement ontology
**Status:** Accepted

Use TripElement subtypes such as TransportLeg, Stay and Engagement. Do not add scenario-specific node types. Importance, flexibility and reservation state are orthogonal properties.

## ADR-012 — Constraints separate from topology
**Status:** Accepted

Keep relationship vocabulary small. Conditions such as MUST_ARRIVE_BEFORE and INVALIDATES_IF are constraint predicates rather than specialized edge types.

## ADR-013 — Critical facts carry provenance/freshness
**Status:** Accepted

Do not treat imported itinerary, connected email and authoritative provider state as equal. Preserve source authority and freshness for critical operational facts.

## ADR-014 — Explicit preferences dominate latent preferences
**Status:** Accepted

Latent/inferred preferences are soft ranking signals and never silently become hard constraints.

## ADR-015 — Sourced entry/immigration context
**Status:** Accepted

Authoritative sources underpin legal/entry facts. Agentic web research may produce sourced operational immigration-time estimates with uncertainty; estimates are not legal certainty.

## ADR-016 — Google Routes is useful but non-blocking
**Status:** Accepted

Use it for dynamic local transport/travel-time context when configured. Lack of credentials/network must not prevent core replay/demo flows.

## ADR-017 — Booking.com is stretch, not dependency
**Status:** Accepted

Generic hotel ingestion/reasoning must work without Booking.com. Adopt Demand API only if partner access can be obtained without risking core implementation.

## ADR-018 — Qoder Spec-driven workflow for substantial lanes
**Status:** Accepted

Use repository docs for durable product/architecture truth and Qoder Quest Specs as bounded implementation contracts. Freeze shared contracts before parallel worktrees/Quests.

## ADR-019 — TypeScript on Node.js ≥24, single package, no web framework
**Status:** Accepted (F0)

End-to-end TypeScript in one package (no workspaces/services). Node >= 24 runs sources directly via type stripping (`node --test`, `npm run dev`); `tsc` emits `dist/` for build/start. HTTP layer is `node:http` with a small router; no Express/Next until a lane demonstrates material need. ESLint 9 flat config, Node built-in test runner. Chosen as the smallest practical stack consistent with ARCHITECTURE.md §16/§17.

## ADR-020 — Built-in `node:sqlite` behind repository interfaces
**Status:** Accepted (F0)

Persistence uses Node's built-in `node:sqlite` (synchronous, zero native dependencies) behind the `src/contracts/repositories.ts` interfaces, per ADR-009. If runtime evidence proves it unsuitable, swap to `better-sqlite3` inside `src/persistence/` without touching domain logic.

## ADR-021 — Zod runtime validation at all external/model boundaries
**Status:** Accepted (F0/F1)

Zod v4 schemas are the executable form of the F1 domain/operational contracts and config validation. Malformed AI/provider/fixture input fails safely at parse time (NFR-04).

## ADR-022 — Frozen shared contract surface at Checkpoint A
**Status:** Accepted (pending formal Checkpoint A acceptance)

`src/domain/**`, `src/operational/**`, `src/contracts/**`, the `ScenarioSpec` contract (`src/scenarios/**`), both scenario bundle semantics, and the `.env.example` variable names are frozen. After acceptance, changes are lead/integrator-owned cross-lane changes per IMPLEMENTATION_PLAN.md §2.1. Planner output structurally excludes executable side effects; provider results use the `CapabilityResult` envelope; LIVE/REPLAY share one `normalize()` path via the `ProviderAdapter` shape.

## ADR-023 — Timestamp ordering is instant-based, never lexicographic
**Status:** Accepted (Checkpoint A review fix)

`IsoDateTime` values carry explicit UTC offsets, so lexicographic string ordering is not chronologically correct across offsets. All ordering/freshness logic (`resolveAuthoritativeFact`, `isFactStale`, and any future comparator) must go through `compareInstants`/`instantMillis` in `src/domain/common.ts`. No date/time framework is introduced; the runtime parses the accepted ISO contract reliably.

## ADR-024 — Planner tool requests use a closed read-only vocabulary
**Status:** Accepted (Checkpoint A review fix)

`ToolRequest.operation` is restricted to `ToolOperationSchema` (flight search/verify/fare_rules/refund_quote, hotel.context, routing.context, research.entry_requirements, research.local_context) with a capability-family consistency check. Consequential operations (flight.change, flight.cancel, hotel.modify/cancel, communication.*, simulation.*) are structurally unrequestable by the planner and exist only on the ActionIntent/authority path. Excluding `actionIntents` from `PlannerOutput` alone was insufficient; this closes the tool-request escape path.

## ADR-025 — Execution requires explicit deterministic authority evidence
**Status:** Accepted (Checkpoint A review fix)

`ExecutorService.execute` accepts an `AuthorisedExecution` envelope: the `ActionIntent` paired with the `AuthorityDecision` that authorised it. The shared deterministic gate `executionGateIssues()` (in `src/operational/intent.ts`) must return no issues before any executor implementation proceeds: intent-id match, non-BLOCKED outcome, and a recorded APPROVED approval wherever the outcome requires one. An intent merely constructed with `status = AUTHORISED` is never executable evidence.

## ADR-026 — Relation vocabulary normalization
**Status:** Accepted (Checkpoint A review fix)

`PART_OF`, `PARTICIPATES_IN`, `GOVERNED_BY` and `COVERED_BY` from ARCHITECTURE.md §4 are deliberately represented by typed aggregate fields (`tripId`, `anchorEventId`, `travellerIds`, participant roles, `governedByRuleSetIds`, `insuranceRuleSetIds`, `organiserOrganisationId`) rather than edges. The executable `TripRelationKindSchema` contains only `CONNECTS_TO`, `DEPENDS_ON`, `SHARES_RESOURCE_WITH`, `REQUIRES`; `PART_OF` was removed from the enum. Lanes must not reintroduce field-represented semantics as edges or add duplicate relation kinds.

## ADR-027 — Unevaluated TripElement health defaults to UNKNOWN
**Status:** Accepted (Checkpoint A review fix)

`TripElement.status` defaults to `UNKNOWN`, not `VALID`: missing evidence must never become fabricated certainty (ARCHITECTURE.md §5, FR-05). Evaluated health must be asserted explicitly by deterministic evaluation or by scenario fixtures stating their evaluated pre-disruption state.

## ADR-028 — Atlas schedule times are airport-local; resolve honestly or fail structured
**Status:** Accepted (Checkpoint B integration, cross-lane issue 1)

Atlas `depTime`/`arrTime` schedule strings (`YYYYMMDDHHmm`) are airport-local wall-clock times with no offset. This was established by analysing sandbox captures: cross-timezone legs shift by exactly the local-time difference of their endpoints (e.g. DXB→RUH −60 min, LAX→ATL +180 min), while same-timezone legs match flight duration exactly. The Lane C mapping to `...Z` (fabricated UTC) is therefore wrong in general and was removed: `normalizeSearch` now requires an `AtlasTimezoneResolver` (airport code → IANA timezone) supplied by the application from its authoritative place data, converts wall clock to an honest offset instant deterministically, and fails normalization with a structured `PROVIDER_ERROR` when the timezone cannot be resolved. No frozen contract changed; honest `IsoDateTime` representation is possible, so UNKNOWN/uncertainty lives in the capability failure, not in a guessed offset.

DST fold resolution (Checkpoint C, PL-2): the conversion enumerates candidate instants by probing the zone offset at the naive instant and at ±14h around it (wider than any UTC offset), round-trips every candidate back to its local wall clock, and selects the EARLIEST instant that round-trips — the first occurrence of the repeated local time, for every IANA zone, not just ones where the naive-offset heuristic happens to land on the fold. Nonexistent DST-gap times (no round-tripping candidate) fail structured with `ambiguous local schedule`. The conversion stays host-timezone independent (Intl with explicit `timeZone`) and never weakens the fail-closed rule.

## ADR-029 — Generic runtime seam over demo-specific endpoints
**Status:** Accepted (Checkpoint C, R1/PL-3)

The demo/runtime flow is exposed as a scenario-neutral operation vocabulary — `POST /api/runtime/{disruption,plan,begin,decide,execute,reset}` plus `GET /api/runtime/state` — where handlers validate wire JSON at the boundary and delegate to the same engine services the tests use. There are no scenario-specific endpoints and no separate demo code path: `src/app/compose.ts` composes the application once and is shared by `src/main.ts` and the integration tests. Every stage requires a caller-supplied instant (`at`), so runs are deterministic and never wall-clock-stamped.

Deterministic reset/reseed is a single audited transaction: wipe the logical tables, then reseed every fixture bundle through the same validated `seedScenarioBundle` mutation path as bootstrap — no manual SQLite edits. Recovery planning stays credential-free in REPLAY: the Model Studio planner is used only when configured; otherwise a deterministic fallback planner derives strategies from replayed capability results (never claiming feasibility it did not evaluate).

## ADR-030 — CaseVerifier evaluates trip-scoped constraints only
**Status:** Accepted (Checkpoint C, R1)

Constraint verification is scoped to constraints whose refs point at the verified trip's elements or objectives (generic ref matching, identical semantics to the snapshot layer). Verification of one trip must never be poisoned by constraints belonging to another trip once multiple scenario bundles share one store; provider success alone still never resolves — the verifier remains the sole resolution authority.

## ADR-031 — On-demand transfer legs are schedulable, not unknown
**Status:** Accepted (Checkpoint C, G2)

A ground TRANSFER leg with no scheduled departure is schedulable on demand when it is unbooked or already confirmed with a duration estimate (`flexibility ≠ FIXED`, no `scheduledDeparture`, and `reservationState NONE` or `durationEstimate` present). Such legs evaluate against upstream arrival knowledge instead of returning UNKNOWN, and a CONFIRMED on-demand leg keeps this property post-execution. This keeps confirmed taxi/private-transfer recoveries from stalling verification at UNKNOWN without ever fabricating a schedule.

`minBufferMinutes` scoping (REV-C-FIX, PARK-6 decision): the constraint's `minBufferMinutes` binds every *scheduled* departure (the gap between upstream arrival and the leg's real `scheduledDeparture`), but is deliberately not enforced on the on-demand branch. An unscheduled on-demand leg has no departure instant to measure against — its departure is chosen after the upstream arrival becomes known, so the required gap is satisfiable by construction. Enforcing the buffer there would require either fabricating a departure instant or failing a leg that is deterministically schedulable; both violate the never-fabricate/never-UNKNOWN-where-evidence-exists rules. If the leg later gains a `scheduledDeparture`, the scheduled branch applies the buffer immediately — the guard is not weakened, only scoped to evidence that can actually be compared.

## ADR-032 — Fact authority binds the authoritative mutation path, not overlay planning
**Status:** Accepted (Checkpoint C, REV-C-FIX WP-C2)

Scenario overlay candidates are HELD hypotheses about a possible replacement booking. They carry provider evidence at CONNECTED authority at best, while disruption signals confirm incumbents to AUTHORITATIVE through execution observation. Enforcing the fact-authority ladder (ARCHITECTURE.md §5) during overlay application would reject every replacement candidate against an authoritative delay/cancellation fact and pressure planners into fabricating provenance claims. Therefore `applyOperationToState` takes an explicit `ApplyOptions.enforceFactAuthority` mode: `SqlMutationService` (authoritative path) passes `true` — weaker/stale evidence can never replace stronger evidence, and omitting an incumbent AUTHORITATIVE fact from a whole-entity payload is rejected as `FACT_OUTRANKED` (PARK-2: omission is an erase attempt, never silent) — while `OverlayViabilityEngine` passes `false`, so candidates are evaluated on deterministic viability alone. The ladder is completed at execution: `confirmedData()` upgrades confirmed TRIP_ELEMENT facts to AUTHORITATIVE at the execution instant, and only through the validated observation mutation. Overlays still reject missing targets and mutation of the judging criteria (ADR-032 companion guard, WP-C1): a candidate may add constraints but never upsert a constraint or rule set already present in the base snapshot, because those ARE the evaluation basis.

## ADR-033 — LossRecord's authoritative home: assessed loss persists through validated mutation
**Status:** Accepted (Checkpoint C, REV-C-FIX WP-C3)

An impact assessment can record an irreversible loss (a HARD objective whose moment passed or whose elements are all fixed-and-lost). Before REV-C-FIX the loss lived only in the transient `ImpactAssessment`: after the remainder recovered, re-assessment no longer reported it and the verifier could return FULLY_RECOVERED with the loss unacknowledged. Chosen resolution: the assessment's `impactProposal` — the same normal validated mutation that persists constraint statuses and trip viability — also marks each lost objective `LOST` (`UPSERT_ENTITY TRIP_OBJECTIVE`, applied after the trip viability upsert so the objective upsert lands on top). `LossRecord` itself remains an operational evidence type (`src/operational/impact.ts`); its *authoritative home* is the objective's persisted status. `CaseVerifier.verify` then counts objectives with status WAIVED/REPRIORITY/LOST plus any still-assessed irreversible losses as `remainingLossRefs`; FULLY_RECOVERED is impossible while any loss stands, and a waiver/reprioritisation converts the loss into explicit traveller evidence (`RECOVERED_WITH_LOSS`). Rejected alternative: a case-level loss ledger would duplicate trip truth and survive case closure with no owner; the objective already models exactly this state.

## ADR-034 — AnchorEvent is the programme aggregate; commitments are shared children, never globally hard
**Status:** Accepted (RV-N0 contract freeze)

One AnchorEvent models one event-travel programme (the "mother graph"): its place/date Facts plus an optional `commitments: AnchorCommitment[]` (SESSION | SOCIAL | LOGISTICS | OTHER, with startsAt/endsAt Facts and optional placeId). Commitments are shared by all travellers in the programme — they must never be duplicated per traveller. Linkage is through `Engagement.anchorCommitmentId`, and importance lives per traveller on the Engagement, never as global hardness on the commitment itself: whether a commitment is immovable for a given traveller is derived from that traveller's objectives/constraints, not asserted on the shared object. `commitments` defaults to `[]`, so existing AnchorEvents load unchanged. Rejected alternative: a second graph engine or per-traveller commitment copies — both would fork truth and break the single-source-of-truth invariant.

## ADR-035 — Programme intake is pre-authoritative drafts promoted only through the frozen mutation path
**Status:** Accepted (RV-N0 contract freeze)

Participant rosters arrive before any traveller has spoken to the system, through arbitrary channels (manual entry, bulk import, LLM-mapped documents, later updates) — modelled by `IntakeChannel` and `ProgrammeImportDraft`. Intake produces `ProgrammeTravellerDraft` records (identity hints only — email/phone/lastName/dateOfBirth/passportNumber all optional; accessibility statements; commitment links), never direct Trip or Booking writes. Drafts become authoritative Trip/Traveller entities only through the same validated MutationService promotion path that every other state change uses (`PromotionOutcome` reports per-draft issues honestly). This preserves the invariant that no source — human, file or LLM — writes authoritative state directly, and makes "participant confirmed, no bookings yet" a legal programme state.

## ADR-036 — ChangeRequest is a declarative target state, not a set of booking mutations
**Status:** Accepted (RV-N0 contract freeze)

A traveller's change message ("arrive earlier, leave later, I'll pay myself", "later or direct flight", "hotel closer to the venue") is captured as `ChangeRequest`: intentKind (ADJUST_TRIP_WINDOW | CHANGE_TRANSPORT_SCHEDULE | CHANGE_STAY | CANCEL_BOOKING | ADJUST_OBJECTIVE | OTHER), urgency (HARD_INSTRUCTION | SOFT_PREFERENCE), a declarative `ResolutionTarget` (arriveBy/departAfter windows, transport preferences, stay proximity ref, objective effects WAIVE/REPRIORITY) and an optional `FundingDeclaration`. The target describes the desired end state; it never contains element mutations, booking ids or provider operations. Traveller desire is not provider state: a ChangeRequest feeds the same planning/authority/execution path as disruption recovery. Rejected alternative: mapping utterances straight onto mutation payloads — it would embed provider assumptions in intake and make unmet requests indistinguishable from executed ones.

## ADR-037 — Mixed funding is a FUNDED_WINDOW policy rule plus explicit CostAllocation, never global
**Status:** Accepted (RV-N0 contract freeze)

Programme funding is modelled as a `FUNDED_WINDOW` PolicyRule (windowStart/windowEnd, `coveredBy: Payer`, `incrementalPayer` defaulting to TRAVELLER) evaluated like any other rule, and each ActionIntent may carry a `CostAllocation` (coveredAmount, incrementalAmount, coveredBy, incrementalPayer, derivedFromRuleIds). Payer vocabulary is closed (EVENT_ORGANISATION | TRAVELLER | ORGANISATION | OTHER). Funding is derived per action from rule evidence; there is no global "this programme is funded" flag and no money movement without authority. The traveller's self-funding declaration in a ChangeRequest is evidence that feeds allocation, not an automatic charge.

## ADR-038 — Initial planning runs on the same engine; caseKind is classification evidence, not a behaviour fork
**Status:** Accepted (RV-N0 contract freeze)

A Trip with zero elements and UNKNOWN viability is already legal, and the overlay engine already accepts add-only candidates, so "the programme just started, nothing is booked yet" needs no separate InitialBookingEngine. `RecoveryCase` gains `caseKind: CaseKind` (RECOVERY | INITIAL_PLANNING, default RECOVERY) as classification evidence for reporting and UI; the state machine, mutation path, verification and resolution semantics are identical for both kinds. Rejected alternative: a bespoke booking engine for initial planning — it would fork the authority path and duplicate validation.

## ADR-039 — Event-side changes arrive as ANCHOR_COMMITMENT_CHANGE, never as FLIGHT_SCHEDULE_CHANGE
**Status:** Accepted (RV-N0 contract freeze)

A rescheduled session, relocated venue or cancelled programme item is an event-side fact, not a provider schedule fact. `SignalKind` gains exactly one closed-vocabulary addition: `ANCHOR_COMMITMENT_CHANGE` with a validated payload (anchorEventId, commitmentId, changeKind RESCHEDULED | RELOCATED | CANCELLED | OTHER, new timing/place, summary). Fan-out derives affected trips through Engagement.anchorCommitmentId linkage; each affected traveller's case is opened from this one programme-level signal. Misusing FLIGHT_SCHEDULE_CHANGE for event-side changes would poison provider-state reasoning and attribution. The closed SignalKind vocabulary otherwise remains frozen.

## ADR-040 — Extracted policy temporals are deterministically normalized before promotion; ambiguity becomes uncertainty
**Status:** Accepted (RV-N0 contract freeze)

Policy/rule drafts extracted from event pages and emails often carry naive dates and times ("check-in from 14:00", "sessions end 18:00 local"). Before rule promotion, `normalizeRuleDraftTemporals` converts naive datetime/date-only values to explicit-offset ISO using only an explicitly supplied IANA timezone (from the ingestion context); offset-qualified values pass through unchanged. If no timezone is available, normalization fails and the value is surfaced as uncertainty rather than guessed. Rejected alternative: LLM or default-timezone inference at promotion time — a silent wrong timezone in a NO_SHOW_CUTOFF or CANCELLATION_TERMS rule is a money-moving error, and promotion must be deterministic.

## ADR-041 — Hotel and transfer capability seams are provider-neutral; change is cancel+rebook until a provider contradicts
**Status:** Accepted (RV-N0 contract freeze)

`HotelCapability` (search/quote/book/retrieve on top of context/modify/cancel) and `TransferCapability` (search/quote/book/retrieve/amend/cancel) are provider-neutral seams with CapabilityResult envelopes and opaque provider ids. MVP runs on imported booking/policy data; after freeze at most one real hotel API adapter and, as Stretch P1, one transfer adapter may be added behind the same boundaries. Read-only hotel/transfer operations may back planner tools; consequential ones (hotel.book, transfer.book/amend/cancel) are authority-path only and excluded from ToolOperationSchema, test-enforced. Providers are treated as immutable-booking systems until they expose real change endpoints: "move the stay" is cancel+rebook, never assumed in-place mutation.
