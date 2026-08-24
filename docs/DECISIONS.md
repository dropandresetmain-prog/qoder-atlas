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

## ADR-042 — Flight forward transaction is three frozen seams: create, pay, retrieve
**Status:** Accepted (Wave 3R G3R-R0 contract freeze)

DR-0 empirically proved the provider-neutral forward lifecycle: create/hold a verified order, fulfil it with a provider-opaque payment reference (no raw card data), and observe order/ticketing state asynchronously. The frozen seam is `FlightTransactionCapability` in `src/contracts/capabilities.ts` with exactly `createOrder` / `payOrder` / `retrieveOrder` (plus the cancellation trio of ADR-043). Read-only discovery (search/verify/fare-rules) stays on `FlightCapability`. Provider wire shapes — endpoint names, order-number semantics, passenger name conventions, status codes — remain adapter-private and never enter these contracts. `FlightTransactionStateSchema` preserves opaque provider workflow handles (order ref, record locator, ticket refs, hold expiry, cancellation handles) with a catchall so adapter-specific reconciliation fields survive without reinterpretation. Payment carries only an opaque pre-authorised `paymentRef`; raw PAN/CVV can never cross the seam (test-enforced). All three operations sit behind the ActionIntent → authority → executor path; `flight.book` is REVERSIBLE (a hold that moves no money and expires), `flight.pay` is MONEY_MOVING, `flight.order_status` is READ_ONLY.

**Payment authority decision (option B):** create and pay are ONE authorised booking intent's executor-managed sequence, not two separate ActionIntents. Authority evaluates the deterministic verified price and payer allocation once, against the money-moving total; the executor then performs create → pay → retrieve internally, with each stage observed. Rationale: (1) the verified price is the money amount — splitting pay into a second intent would re-derive cost allocation from stale evidence or require a second approval for the same decision; (2) create alone moves no money, so holding the order while approval is pending is safe and even desirable; (3) partial success is explicit in the contract — `FlightOrderStatus` distinguishes HELD / PAID / TICKETING / TICKETED / FAILED / UNKNOWN, so a failed pay leaves an observed HELD order that expires or is retried under the same authority, never a silent duplicate; (4) ticketing is asynchronous, so `retrieveOrder` is mandatory before any authoritative state mutation — provider acceptance is never final truth. Idempotency handles: `clientReference` on every query (required on `FlightOrderCreateQuery` — the create operation is most exposed to duplicate-create risk on timeout) plus opaque `orderRef`/ticket refs in `FlightTransactionState`; DR-2 persists them via the existing SQLite/audit machinery and must never blindly re-issue create/pay on timeout — retrieve first.

**Price-drift ceiling (review-fix, G3R-R0-FIX):** the single authority evaluation described above produces a deterministic ceiling, `FlightOrderPayQuery.authorisedAmount`, that the executor must treat as binding before it ever calls `payOrder`. The executor MUST compare the provider-reported payable total returned by `createOrder` against `authorisedAmount`: if that payable total exceeds `authorisedAmount`, if the currency differs, or if no total is reported at all, the executor MUST NOT pay. Instead it re-enters deterministic viability/authority with the observed price, leaving the order HELD (never PAID on an unverified or drifted total). `ActionIntent.priceDelta` is a delta relative to a prior estimate, not the payable ceiling itself, and must never be used for this comparison — only `authorisedAmount` is the ceiling authority approved.

**No auto-approval path for money-moving payment (review-fix, G3R-R0-FIX):** the single authorised booking intent that reaches the executor carries `operation: 'flight.pay'` with `sideEffectLevel: 'MONEY_MOVING'` — the authorised unit of work is classified by its terminal money-moving effect, not by the fact that it also performs create/retrieve internally. `flight.book` (`REVERSIBLE`) denotes only a hold-without-pay intent that moves no money; no executor may extend a `REVERSIBLE`-classified `flight.book` intent into a call to `payOrder`. This closes the ambiguous reading under which an executor might treat the option-B create→pay sequence as authorised by a `REVERSIBLE` decision alone.

## ADR-043 — Flight cancellation is quote → submit → observe; unsupported is a structured outcome
**Status:** Accepted (Wave 3R G3R-R0 contract freeze)

DR-0 proved the cancellation lifecycle empirically: an eligibility/quote step with window and expected return amount, an irreversible submission that the provider accepts for asynchronous processing, and a separate status observation. The frozen seam expresses exactly these stages on `FlightTransactionCapability`: `quoteCancellation` (READ_ONLY, planner-requestable as `flight.cancel_quote`), `submitCancellation` (IRREVERSIBLE, authority-path only as `flight.cancel`), and `retrieveCancellationStatus` (READ_ONLY, `flight.cancel_status`). `FlightCancellationAvailabilitySchema` makes provider non-support a normal structured business outcome (`UNSUPPORTED`), never an exception and never a scenario branch. `FlightCancellationStatusSchema` keeps submission acceptance (`REQUEST_ACCEPTED`) distinct from processing and from the observed final `CANCELLED` — the system must never conclude provider acceptance = flight cancelled = trip recovered; reconciliation via retrieval remains mandatory. The generic vocabulary reuses the existing `flight.cancel` concept; the provider's private "void" naming stays adapter-mapped.

**Refund boundary:** cancellation and refund are separate concepts. No new executable refund contract is added for Wave 3R: the existing read-only `flight.refund_quote` vocabulary remains valid, and a future provider may implement refund execution without redesigning the engine. The first flight adapter supports only the proven cancellation path in this environment.

## ADR-044 — External flight events enter as provider-neutral envelopes at provider-stated authority
**Status:** Accepted (Wave 3R G3R-R0 contract freeze)

DR-3 needs a provider-neutral external event seam. The frozen contracts are `ExternalProviderEventEnvelopeSchema` (providerId + providerEventId identity for delivery idempotency, receivedAt/occurredAt, provider order refs for correlation, generic `ProviderEventCategorySchema`, normalized payload) and `ExternalFlightEventNormalizer` (raw payload → envelope + TripSignals, structured failure, never throws). No provider-specific event types enter the domain ontology. Trust handling exploits the existing fact-authority ladder without ontology change: the empirical finding that the first adapter's delivery channel documents no inbound signature/HMAC means its events MUST be normalized at `providerAuthority` ASSERTED at best; downstream, the existing TripSignal authority gating and the retrieve-and-reconcile discipline keep an unauthenticated push from outranking observed provider state or becoming authoritative trip truth directly. The path is: receive ASSERTED event → correlate via provider order refs → reconcile/query the provider where practical → validated TripSignal/state mutation. DR-3 additionally owns its own ingress protection (secret path/allowlisting) since the provider supplies none.

## ADR-045 — Authority currency incomparability fails closed
**Status:** Accepted (Wave 3R Mission 1, DR-1.3)

G3R-R0 left one Investigate-Now item: `DeterministicAuthorityEngine` skipped spend rules whose currency differed from the intent's `priceDelta` currency, turning "cannot compare" into "no objection". With real sandbox payment about to be permitted, that leniency is unsafe and is now removed (`src/engine/authority.ts`):

- **SPEND_LIMIT (hard ceiling):** a currency mismatch returns `BLOCKED` with structured, auditable `ruleTrace` reasoning. A binding hard ceiling that cannot be deterministically compared is never silently satisfied; the deterministic authority invents no FX conversion.
- **APPROVAL_ABOVE_SPEND:** a currency mismatch now triggers the rule's approval requirement instead of skipping the threshold — the system cannot verify the spend is below the threshold, so execution must not proceed without explicit approval.
- **Delegated authority cannot bypass either:** hard ceilings are evaluated before any delegation and now block outright on mismatch; a delegated principal whose `delegatedSpendLimit` currency is incomparable with the spend still cannot satisfy a spend-threshold requirement (existing skip semantics, retained).

Rejected alternatives: keeping the skip (unsafe auto-execution exactly when real money moves); an internal FX table (invented rates are non-deterministic and financially wrong by construction); escalating SPEND_LIMIT mismatches to human approval instead of `BLOCKED` (a hard ceiling is a deterministic boundary — raising it means changing the rule set, not waiving the rule). Permanent tests pin all three behaviors (`test/wave3r-dr1-runtime-truth.test.ts`).

## ADR-046 — Provider-backed execution composition: dossiers, payment gate, curated transaction state
**Status:** Accepted (Wave 3R Mission 1, DR-2)

DR-2 replaces simulation-first execution for operations a wired provider capability can actually perform, behind the same `ExecutorService` seam (`src/app/providerExecution.ts`), consuming the frozen G3R-R0 contracts (ADR-042/043). Decisions:

- **Selection is capability-driven only.** Provider-backed execution dispatches on the `ActionIntent` operation, the configured capability, the execution gate and the adapter mode — never scenario/traveller/route/fixture identity. The simulation boundary remains the fallback where no provider path applies.
- **Booking identity is an application-owned dossier, resolved per intent.** The frozen ontology's `Traveller` carries a display name only; real provider booking needs structured passenger/contact data. Absent dossier => structured refusal for consequential LIVE/RECORD booking (never guessed identity); REPLAY preserves historic simulation behavior. Injected dossiers must come from authoritative or operator-validated data, never from an LLM proposal.
- **The ADR-042 payment gate is test-enforced in the executor** (`paymentGateVerdict`): the ceiling is the strategy `costImpact` authority reviewed (carried as `FlightOrderPayQuery.authorisedAmount`); missing payable total, currency mismatch, payable above ceiling or absent ceiling all refuse payment, preserve the HELD order and loop the case back through viability/authority. `ActionIntent.priceDelta` is never the ceiling.
- **Sandbox payment is fail-closed.** The Atlas adapter maps the approved opaque test-balance reference to the provider's deposit/balance payment mechanism and rejects every other `paymentRef`; transactional calls are refused unless the configured base URL is unambiguously the sandbox host. No PAN/CVV vocabulary exists in the seam.
- **`FlightTransactionState` population is curated.** Adapters set only deliberately selected reconciliation fields (order ref, record locator, hold expiry, ticket refs, cancellation quote/request refs) — never raw provider payloads. The schema denylist hardening (canonical, nested, PAN-value-aware) is a second heuristic line of defense, not the primary guarantee; the frozen schema itself was not reopened.
- **Provenance honesty:** execution evidence reports the adapter's actual mode (LIVE stays LIVE, RECORD stays RECORD, REPLAY stays REPLAY); a provider-backed path never claims SIMULATED and a simulated fallback never claims LIVE.

Rejected alternatives: a second ActionIntent for payment (rejected in ADR-042); scenario-keyed dossier lookup (hardcoding); using `priceDelta` as the payment ceiling (delta vs final payable confusion); broadening the frozen `FlightTransactionState` denylist into a redesigned schema (reopens a frozen contract for a problem curated mapping already solves). Permanent tests: `test/wave3r-dr2-provider-execution.test.ts`, `test/wave3r-contracts.test.ts`.

**Correction (ADR-047):** the payment-gate bullet above described the adapter as also re-checking the ceiling. It did not — `AtlasFlightTransactionAdapter.payOrder` ignored `query.authorisedAmount` entirely until ADR-047 landed the actual adapter-side re-check.

## ADR-047 — Post-execution-wiring authority/observation safety (G3R-R1 fixes)
**Status:** Accepted (Wave 3R Mission 1, G3R-R1 fixes, branch `wave3r/g3r-r1-fixes`)

An independent transaction-safety review (G3R-R1) of Wave 3R Mission 1 returned `FIX REQUIRED` against SHA `3fea722cf3e144ed925c4ef000b0bf85a6360360`, with four required fixes. All four are implemented here, closing the gap between "execution was simulated" (safe by construction) and "execution reaches a real provider" (DR-2).

- **A1 — side-effect misclassification could reach a real provider.** `consequentialOperationFor` (`src/app/recoveryExecution.ts`) classified a STAY element replacement as `REVERSIBLE`, which `DeterministicAuthorityEngine`'s default policy auto-approves (`src/engine/authority.ts`). Harmless while execution was simulated; once DR-2 wired provider execution, an auto-approved intent could reach a chargeable Nuitée `bookStay` plus an irreversible `cancelStay`. Fixed in two layers: (1) a STAY replacement is now classified `MONEY_MOVING` — like `IRREVERSIBLE`, it reaches an approval-requiring outcome, so a waiver riding along still demands approval; this changed no existing test, since no scenario depended on stay recovery being auto-approved. (2) a structural backstop, `insufficientSideEffectLevel(intent)` (`src/app/providerExecution.ts`), refuses before ANY provider call when the intent's declared `sideEffectLevel` ranks below the operation's real side effect (`READ_ONLY < REVERSIBLE < IRREVERSIBLE < MONEY_MOVING`; `flight.book`/`flight.cancel` require `IRREVERSIBLE`, `flight.pay`/`flight.change`/`hotel.book`/`hotel.modify` require `MONEY_MOVING`) — `status: 'FAILURE'`, `error.code: 'side_effect_level_misclassified'`. It fails loud rather than falling back to simulation: a misclassified consequential intent is a policy defect to surface, not a case to quietly simulate.
- **A2 — provider SUCCESS was promoted into confirmed authoritative state.** `createRecoveryExecutor` injected `confirmedOperationsFor(strategy.candidateOperations)` into `observedEffects.operations` on ANY execution SUCCESS, marking trip elements `reservationState: 'CONFIRMED'`/`status: 'VALID'` and upgrading facts to `AUTHORITATIVE`. A `flight.book` hold — unpaid, unticketed — would therefore have become indistinguishable from a TICKETED booking, and a cancellation that merely submitted while still PROCESSING would have looked confirmed. Fixed by making candidate confirmation opt-in for provider-backed results: `src/operational/intent.ts` exports `CONFIRMS_CANDIDATE_STATE` (an `observedEffects` key) and `confirmsCandidateOperations(result)`, true when SUCCESS AND (`provenance === 'SIMULATED'` OR the marker is set) — the ADR-007 simulation boundary keeps its historic confirming behaviour unchanged. The provider executor sets the marker only on genuinely terminal outcomes: order observed TICKETED, hotel replacement confirmed, cancellation observed CANCELLED. A `flight.book` hold carries `holdOnly: true` and never confirms.
- **A3 — the claimed adapter-side ceiling re-check did not exist.** `AtlasFlightTransactionAdapter.payOrder` ignored `query.authorisedAmount` entirely, while ADR-046 claimed the adapter also re-checks; the only enforcement in the system was the single executor call site. Fixed without reopening the frozen `FlightOrderPayQuery` contract: in LIVE/RECORD only, `payOrder` now calls the adapter's own `retrieveOrder` before `/pay.do` and enforces the ceiling itself. Payment is allowlisted to an observed HELD order — observed `PAID`/`TICKETING`/`TICKETED` returns the observed state as a successful outcome with `/pay.do` never called (no second payment); observed `UNKNOWN` (unmapped status, or a failed status query) refuses `atlas_payable_unverifiable`; any other non-HELD state refuses `atlas_order_not_payable`; no observed `totalPrice` refuses `atlas_payable_unverifiable`; payable currency ≠ `authorisedAmount` currency refuses `atlas_payable_currency_mismatch` (no FX invention); payable amount > `authorisedAmount` refuses `atlas_payable_exceeds_authorised`. All refusals are `INVALID_REQUEST` category. `paymentRef` validation still runs first, so an unmapped payment handle costs zero provider calls. REPLAY is exempt — it makes no provider call, and the executor's `paymentGateVerdict` has already run against the same recorded create data, so a REPLAY pre-check would add a recording dependency without adding safety. In RECORD mode the pre-pay and post-pay `retrieveOrder` share one deterministic recording key, so the post-pay observation is what persists; that is expected.
- **I1 — payment could proceed when authority reviewed no spend at all.** `DeterministicAuthorityEngine` skips both `SPEND_LIMIT` and `APPROVAL_ABOVE_SPEND` when `intent.priceDelta` is absent, so a consequential payment whose intent carried no `priceDelta` was never cost-reviewed, yet the executor would still pay against a strategy `costImpact` ceiling authority never saw. Fixed: the executor now refuses such a payment/booking with `error.code: 'authority_reviewed_no_spend'` before `payOrder`/`bookStay` are ever called, checked before the existing `paymentGateVerdict` checks; refusal evidence carries `reviewedSpend` alongside `authorisedCeiling` for auditability.

**Deliberately NOT changed — accepted open risk, not a settled decision:** the executor still does not assert `ceiling <= priceDelta`. The frozen design keeps `priceDelta` (a delta relative to a prior estimate) and strategy `costImpact` (the payable total) separable — `test/wave3r-dr2-provider-execution.test.ts` test `1D-2b` deliberately constructs divergence (priceDelta 40, costImpact 250) and pins the ceiling to costImpact. That means authority can evaluate spend rules against 40 while the executor pays up to 250. Reconciling their magnitudes — whether authority should review the delta or the payable total — is an open authority-semantics question owned by the team, flagged for Mission 2. This is recorded honestly as an accepted open risk, not as resolved.

**Also:** `scripts/wave3r-live-validation.ts` carries an honesty note that its `payable_exceeds_ceiling` re-entry is a scripted ceiling raise, not deterministic re-authority — no AuthorityEngine runs on that path, and the harness hand-builds its own `AUTO_APPROVED` envelopes. It did not fire in the committed evidence run.

Rejected alternatives: adding an observed-payable field to the frozen `FlightOrderPayQuery` (reopens a frozen contract for a problem the adapter's own `retrieveOrder` call already solves); having the executor fall back to simulation on a misclassified intent (hides a policy defect instead of surfacing it); asserting `ceiling <= priceDelta` now (would unilaterally reverse the tested delta-vs-total design ahead of the open Mission 2 decision); denylisting non-payable order states instead of allowlisting HELD (falls through on an unmapped status that might already be paid, risking a duplicate charge).


## ADR-048 — Financial authority semantics: spendExposure vs priceDelta (Mission 2 Phase 0 / P0.1)
**Status:** Accepted (Wave 3R Mission 2 Phase 0, branch `wave3r/product-build`)

ADR-047 left an accepted open risk: authority evaluated spend rules against `ActionIntent.priceDelta` (an incremental delta) while the executor paid up to the strategy `costImpact` (the gross payable) — a divergence the `1D-2b` test deliberately pinned (delta 40, ceiling 250). That meant a small delta could pass `SPEND_LIMIT`/`APPROVAL_ABOVE_SPEND` while the executor charged the much larger gross. This ADR resolves that open question with the smallest additive contract change.

- **`ActionIntent.spendExposure?: Money`** (additive, optional) carries the MAXIMUM GROSS provider charge the action will pay or commit — distinct from `priceDelta`, which keeps its meaning as the incremental economic impact. `buildActionIntent` (`src/app/recoveryExecution.ts`) derives both deterministically from the strategy at construction; for MONEY_MOVING intents the gross spend is frozen onto the intent once.
- **Authority evaluates gross spend.** `DeterministicAuthorityEngine` (`src/engine/authority.ts`) now evaluates `SPEND_LIMIT` and `APPROVAL_ABOVE_SPEND` against `intent.spendExposure`. A MONEY_MOVING intent without a deterministic gross spend fails CLOSED (`BLOCKED`, ruleTrace names the missing exposure) — unreviewed spend is never "within limit". `priceDelta` stays in the decision `conditions` for incremental reasoning; payer/cost-allocation semantics (ADR-037) are untouched and still key off `priceDelta`. No FX is invented anywhere: incomparable currencies fail closed exactly as before (ADR-045), now against the gross spend.
- **The executor ceiling is the authority-frozen exposure.** `createProviderBackedExecutor` (`src/app/providerExecution.ts`) derives `FlightOrderPayQuery.authorisedAmount` (and the hotel replacement cost gate) from `intent.spendExposure` ONLY. The executor no longer accepts a `strategyFor` resolver at all, so re-reading mutable persisted strategy state after authority is structurally impossible: a strategy mutated after authorisation cannot raise the authorised spend. The `authority_reviewed_no_spend` refusal now keys off the missing gross exposure. Hotel replacement follows the identical principle.
- **Contract delta (tiny, additive):** one optional field on `ActionIntentSchema`; `AuthorityDecision.conditions` gains a `spendExposure=…` entry when present; no other frozen contract changed. The Atlas adapter's ADR-047 pre-pay re-check keeps working unchanged because it consumes the same `authorisedAmount` the executor now fills from the frozen exposure.

Canonical evidence (permanent tests, `test/wave3r-p0-spend-authority.test.ts`): delta 40 / gross 250 vs SPEND_LIMIT 100 ⇒ cannot execute; same vs threshold 100 ⇒ explicit approval required; executor ceiling == authority-reviewed gross exposure (never the delta); post-authority strategy mutation cannot raise the ceiling; missing/incomparable gross spend fails closed. Reworked: `wave3r-dr2-provider-execution.test.ts` `1D-2b` and `wave3r-r1-fixes.test.ts` R1-I1 now pin the gross-exposure semantics. Full suite (including the new file) green.
