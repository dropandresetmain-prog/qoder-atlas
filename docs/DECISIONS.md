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
