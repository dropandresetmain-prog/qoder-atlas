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
