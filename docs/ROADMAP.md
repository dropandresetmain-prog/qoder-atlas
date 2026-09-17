# Northstar roadmap

This roadmap records **implemented runtime truth, current delivery status, and intentionally deferred scope**.

## Current baseline

> Since M10/C5, **PostgreSQL + PostGIS is the sole Northstar runtime**. The SQLite-era application runtime is retired: it survives only as offline read-only migration input plus historical test/code evidence. Historical SQLite tests are classified `HISTORICAL_LEGACY` and are non-gating under `docs/TESTING.md`.

Current authoritative development branch: `main`.

Current delivery sequence:

`finish Slice A -> integrated Slice A review -> Founder Test A -> Slice B / Sarah full recovery -> major recovery-loop review -> Founder Test B -> Jordan through the same engine -> focused generalisation review -> Astra planning-only reconciliation -> post-E2E observability + accepted Overview implementation -> final hardening / M11 -> final release review`

The final Event Overview visual design remains unresolved and continues as a parallel design lane. The current Overview remains the protected functional surface until an accepted redesign is ready to implement. The focused Sarah case uses the accepted V5.6 visual language and lands in T4 from authoritative PostgreSQL/read-model state.

## Implemented product/architecture foundation

- PostgreSQL/PostGIS authoritative persistence and typed relational ownership.
- Workspace/Organisation/Principal responsibility separation.
- stable Traveller identity, shared Trip and per-person Journey semantics.
- independent supplier services/reservations/allocations/entitlements.
- mutable Event -> Programme -> ProgrammeItem + Participation state.
- versioned source/evidence/rule/requirement foundations with provenance/freshness/coverage.
- deterministic multi-object evaluation and assessment invalidation.
- typed recovery strategies/action plans, scoped authority, durable execution, observation and reconciliation.
- provider-neutral adapters with Atlas flight, Nuitée/liteAPI hotel, Frankfurter FX, optional Google Routes and Model Studio/Qwen intelligence seams.
- accepted frontend semantic contract and accepted live read-model contract.
- LIVE / RECORD / REPLAY boundaries where supported, with internal recovery logic remaining real.

Current capability details and limitations are authoritative in [`CAPABILITIES_AND_LIMITATIONS.md`](CAPABILITIES_AND_LIMITATIONS.md).

## Architecture source of truth

- [`DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md) — frozen F01-F18 architecture decisions.
- [`DATA_STRUCTURE_LOGICAL_SCHEMA.md`](DATA_STRUCTURE_LOGICAL_SCHEMA.md) — relational ownership/integrity/transaction contracts.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current post-C5 architecture map.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — historical M0-M11 decomposition plus current post-C5 delivery sequence in Section 22.
- [`TESTING.md`](TESTING.md) — canonical current/migration/legacy suite contract.
- [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md) and [`MODELS_ARSENAL.md`](MODELS_ARSENAL.md) — current model/harness routing policy and evidence.
- [`IMPLEMENTATION_AGENT_ROUTING.md`](IMPLEMENTATION_AGENT_ROUTING.md) — three-option routes for historical milestones and current post-C5 delivery stages.

## Refactor and convergence status

| Stage | Status | Outcome / next |
|---|---|---|
| Architecture closure + logical schema | **COMPLETE / APPROVED** | F01-F18 frozen. |
| M0 — executable contracts | **COMPLETE / ACCEPTED — C0 PASS** | Executable schemas/contracts and acceptance mapping frozen. |
| M1 — PostgreSQL/durability | **COMPLETE / ACCEPTED — C1 PASS** | Relational integrity, revisions, idempotency, durable work and migration foundation. |
| M2 — people/Journeys/groups | **COMPLETE / ACCEPTED** | Stable identities, shared Trip/per-person Journey, support/coordination and credentials. |
| M3 — services/reservations | **COMPLETE / INTEGRATED** | Services, reservations, allocations, entitlements, offers and servicing ownership landed before M6. |
| M4 — programmes/geography | **COMPLETE / INTEGRATED** | Mutable programme/participation/resource and geography foundations landed before M6. |
| M5 — knowledge/requirements | **COMPLETE / INTEGRATED** | Versioned evidence/information/rules/requirements/coverage foundations landed before M6. |
| M6 — unified evaluation | **COMPLETE / ACCEPTED — C2 PASS** at `82fa96827fc8d517145498a0ee258f5cdf34c30b` | Multi-object scope/propagation and revision-bound deterministic assessment. |
| M7 — planning/action plans | **COMPLETE / ACCEPTED** | Multi-object RecoveryStrategy/ScenarioChange/ActionPlan foundation. |
| M8 — authority/durable execution | **COMPLETE / ACCEPTED — C3 PASS** at `f8103379ed2426d442d342895e9e1d1573f875da` | Scoped approvals, durable intents/attempts, observation/reconciliation and partial-failure truth. |
| M9 — application/product integration | **COMPLETE / ACCEPTED — C4 PASS** at `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` | PostgreSQL product composition/read models, Sarah/Jordan target E2Es and no legacy fallback. |
| WiT frontend semantic contract | **COMPLETE / ACCEPTED** — source `fe09c525...`, handoff `6a655dd...` | Semantic adapter/model/grammar foundation consumed by convergence. |
| WiT live read-model contract | **COMPLETE / ACCEPTED** — `cbe5f837...` | Stable edge identity/authority, change cursor, assessment lifecycle, subject refs and traveller names; complete-snapshot contract. |
| M10 — migration rehearsal | **COMPLETE / ACCEPTED — C5 PASS** at `87783c0bcbdc12cf263851a36e06b9d5255289ce` | Offline legacy export/import/reconciliation and restore evidence accepted; PostgreSQL is sole runtime. |
| Post-C5 convergence | **COMPLETE** on current `main` lineage | C5 + accepted frontend foundation + accepted live read models + converged test topology on one code line; `M2-ACCESS-PATH-PLANNER` resolved. |
| SQLite readiness audit | **COMPLETE — classification A: NO MEANINGFUL LEGACY STATE IDENTIFIED** | No repository evidence of real legacy state or reachable normal-runtime SQLite writer. One bounded external file/volume inventory remains before M11 activation. |
| **T1 — full AiT PostgreSQL baseline** | **COMPLETE / FOUNDER ACCEPTED** | Real 67-person AiT world, real baseline evaluator and product surfaces; refresh/restart persistence proven. |
| **T2 — truthful provider disruption/reprotection** | **ACTIVE / CANDIDATE UNDER TARGETED REPAIR + RE-REVIEW** | Provider-shaped disruption must be crash/retry safe and preserve correct booking semantics before Founder T2 acceptance/merge. |
| **T3 — assessment -> RecoveryCase orchestration** | **PLANNED AFTER T2** | One incident-scoped failed assessment opens exactly one real case with normal subject/signal attachment. |
| **T4 — minimal authoritative Case View + V5.6 graph** | **PLANNED AFTER T3** | Founder can click Sarah into a real focused case rendered from authoritative state; current Overview remains functional. |
| **Integrated Slice A review** | **PLANNED KEY REVIEW** | Review the whole change -> assessment -> case -> focused-view path once, not each T3/T4 increment separately. |
| **Founder Test A** | **PLANNED** | Physically test the complete Slice A path and protect it as the first demo floor. |
| **Slice B — Sarah full recovery E2E** | **PLANNED** | One milestone: live capability composition/smoke, AI proposal, deterministic viability, authority, execution, observation, reassessment and truthful resolution. Engineering checkpoints inside Slice B are not separate roadmap milestones. |
| **Major recovery-loop review** | **PLANNED KEY REVIEW** | Independent review of the full AI -> deterministic viability -> authority -> execution -> observation -> reassessment chain before Founder Test B. |
| **Founder Test B** | **PLANNED** | Physically prove Sarah recovers end to end before adding richer product surfaces. |
| **Jordan generalisation** | **PLANNED AFTER SARAH** | Run Jordan through the same application code/engine, adding provider-heavy seams only where materially required. |
| **Jordan/generalisation review** | **PLANNED KEY REVIEW** | Focused proof that Sarah/Jordan share the engine and no scenario-specific branches or false provider semantics were introduced. |
| **Astra reconciliation** | **PLANNED — PLANNING ONLY** | One high-value architecture/implementation-plan synthesis after Sarah/Jordan expose real requirements. Astra does not own implementation. |
| **Observability milestone** | **PLANNED POST-E2E** | One semantic operational history feeding Case timeline, Activity journal and compressed Overview feed. It must project authoritative events/actions, not become another state machine. |
| **Accepted Overview implementation** | **PLANNED POST-E2E / DESIGN-GATED** | Implement only after the parallel visual-design lane is accepted. Keep the graph edge-to-edge with feed below if that direction survives design testing. |
| **M11 — operational activation / retirement** | **PLANNED IN FINAL HARDENING** | Final external legacy-source inventory, authority/sole-writer/reconciliation/provenance closure, old operational-access retirement. **Not** a switch from an active SQLite runtime. |
| **Final release review / C6 candidate** | **PLANNED KEY REVIEW** | Exact candidate, Railway/live/replay fallback evidence, broad current-target gate once, secrets/anti-hardcoding/docs/demo-claim consistency. |

## Immediate product milestones

### Slice A — change becomes a real focused case

Slice A is deliberately broken into founder-testable increments but gets only the reviews that materially reduce risk.

**T1 — accepted baseline**

- full AiT dataset in PostgreSQL;
- current Overview/Programme/Decision/Activity surfaces load from real state;
- baseline evaluator truth persists across refresh/restart.

**T2 — truthful disruption**

- disclosed provider-shaped event changes real reservation/service/journey state;
- normal invalidation/reassessment runs;
- idempotency includes partial-failure/retry safety;
- the intended affected booking cohort is derived from provider identity, not names/topology;
- targeted independent review is required here because provider-event idempotency/partial writes are a Critical seam.

**T3 — automatic Case**

- current incident-linked failed assessment opens one RecoveryCase idempotently;
- case subjects/signals attach through normal command/application seams;
- unrelated pre-existing failures are not scooped into Sarah's case.

**T4 — minimal Case + focused graph**

- click/reload of real Sarah case;
- accepted V5.6 graph visual language driven by authoritative case/read-model facts;
- quantitative causal reason remains backend-owned;
- no observability timeline requirement yet;
- current Overview remains the protected functional event surface.

After T4 run **one integrated Slice A review**, then **Founder Test A**. Do not create separate model-review ceremonies after T3 and T4 unless a concrete new Critical issue appears.

### Slice B — complete Sarah recovery

Slice B remains **one product milestone**, even though implementation should use internal engineering checkpoints.

Required end state:

1. PostgreSQL target runtime composes required intelligence/provider capabilities without reviving the retired runtime;
2. safe LIVE smoke proves Model Studio/Qwen and Atlas read-side connectivity/normalisation before the recovery path depends on them;
3. a target-native, schema-bound AI proposal becomes a typed candidate change rather than an executable side effect;
4. deterministic counterfactual evaluation proves or rejects whole-trip viability without mutating current state;
5. a viable strategy compiles to a persisted/versioned action basis;
6. real authority/approval gates execution;
7. Sarah's winning programme recovery executes through internal authoritative commands;
8. resulting state is observed/committed and reassessed;
9. the RecoveryCase resolves only after fresh authoritative PASS truth;
10. no unnecessary flight purchase is introduced merely to make Atlas visible.

Internal checkpoints such as capability composition, LIVE smoke, planning bridge, deterministic evaluation, authority/execution and observation/reassessment are **not separate roadmap milestones**. Use them to bound implementation and testing only.

After the full Sarah chain works, run **one major independent recovery-loop review**, then **Founder Test B**.

### Jordan — same engine, materially different recovery

After Founder Test B, run Jordan through the same generalized application code. Add LIVE Atlas Search/Verify and deeper provider execution/reconciliation only where Jordan genuinely requires them. Do not redesign the engine around the second scenario.

Acceptance includes:

- same world/state model and orchestration path;
- no Jordan/Sarah-specific application/domain branches;
- provider evidence is truthful about LIVE/sandbox/simulated boundaries;
- observation updates canonical state before recovery is claimed;
- Sarah -> Jordan and, where practical, Jordan -> Sarah work without mandatory world reset.

Run one focused generalisation review after the Jordan candidate converges.

### Astra reconciliation — plan, do not implement

Once Sarah and Jordan have exposed the real remaining gaps, use one Astra architecture/implementation-plan synthesis to reconcile:

- architecture-readiness requirements;
- provider/composition/reconciliation requirements learned from Slice B/Jordan;
- Railway/deployment hardening;
- accepted Overview backend/read-model requirements;
- observability requirements;
- demo/fallback/replay requirements;
- remaining M11/final-submission work.

Astra's output is a dependency-aware plan to 30 September. Normal implementation agents execute it incrementally. Do not spend Astra quota on routine coding.

### Post-E2E product milestones

**Observability** is a dedicated milestone after the core vertical loops work. It should project one semantic operational history across external/provider actions, Northstar actions, determinations, human decisions, observations and outcomes, then expose different levels of compression in Case, Activity and Overview. It must not become another source of business truth.

**Event Overview implementation** remains design-gated. The visual-design lane can continue in parallel now, but production implementation waits until the direction is accepted and the core E2E demo floor is protected. Until then, the current Overview remains valid.

## Current investigations

| Item | Status | Why / revisit condition |
|---|---|---|
| T2 crash/retry completeness and cancelled-booking projection semantics | **Act Now in T2** | Independent review proved partial-write retry and only-cancelled booking semantics can be wrong. Must close before merge/Founder T2. |
| Sarah six-vs-five source contradiction | **Investigate Now in T2** | Service-level cancellation exposure and provider reprotected-booking manifest are distinct sets; resolve source truth without application hardcoding. |
| Incident-scoped assessment -> RecoveryCase orchestration | **Act Now in T3** | Tests still contain scaffolding/direct assembly where normal application orchestration is required. |
| Target capability composition / Qwen target-native planning bridge | **Act Now in Slice B** | Existing transports/adapters are reusable but current PostgreSQL app does not compose them into the normal recovery lifecycle. |
| Atlas PG timezone resolver | **Act Now before LIVE Atlas search is relied on** | Atlas local-wall-clock schedules require authoritative IATA -> timezone mapping. |
| `external:offer.select` transactional meaning | **Investigate before Jordan external execution** | Do not map a generic selected offer directly to order/payment without freezing operational semantics. |
| External execution observation -> canonical PG mutation/reconciliation | **Investigate before Jordan transactional actions** | Provider success alone must never resolve the trip. |
| Railway readiness health semantics | **Act before final rehearsal** | A process returning 200 while still booting/crash-looping can mask deployment failure; do not let platform health equal real runtime readiness. |
| No-Journey programme participants (Daniel/Elena equivalents) | **Investigate in Slice B** | Missing participants must not silently become viable. |
| Sarah stay/hotel consequence | **Investigate when recovery context requires it** | Do not render a healthy stay branch unless target evaluator actually says so. |
| External legacy SQLite file/volume inventory | **Before M11 activation** | Git cannot prove absence of ignored external files. Does not block Slice A/B/Jordan. |

## Stretch / deferred / not in current critical path

| Item | Status | Reason / revisit condition |
|---|---|---|
| Progressive per-person evaluation telemetry | **Park for Later** | Atomic authoritative snapshots are sufficient for the protected E2E; observability milestone may revisit truthful progress semantics later. |
| Rich considered-option / rejected-candidate history | **Park for Later** | Retain/show only if planner evidence genuinely persists it. |
| Authoritative Before/After toggle | **Park for Later** | Needs historical projection retention; revisit after recovery E2E. |
| Whole-event Live Dependency Graph / semantic zoom / multiple simultaneous focuses | **Park for Later / Stretch** | Focused case + Sarah/Jordan E2E + accepted Overview first. Continue design/feasibility investigation without putting it on the implementation critical path. |
| Traveller/phone view | **Stretch** | Revisit after core operator path works. |
| Automated visa applications | **Park for Later** | Requires validated legal/provider workflow capability. |
| Insurance claims automation | **Stretch** | Requires insurer integrations/authority/observed outcomes. |
| Transactional ground transport | **Stretch** | Add when reliable quote/book/cancel/observe provider exists. |
| Dedicated graph database | **Deferred** | PostgreSQL relational ownership + explicit dependency/applicability indexes are sufficient until query/scale evidence says otherwise. |
| Microservices / Kafka / Kubernetes | **Deferred** | Modular monolith + durable DB work is sufficient. |
| Unbounded autonomous refunds/post-ticket servicing | **Deferred** | Consequential supplier actions remain capability/authority/observation gated. |
| Generic legal advice | **Rejected as product claim** | Northstar evaluates sourced requirements; it does not manufacture legal certainty. |
| Retired SQLite dead-code deletion | **Park for Later** | Runtime/test boundaries already make it harmless. Remove after M11/submission when migration archaeology is no longer useful. |
| Physical test-directory split | **Ignore / Accept Risk for now** | Explicit suite manifest + import-graph gate already prevent suite conflation; moving dozens of files is churn. |

## Review checkpoints — intentionally sparse

Independent model review is uncertainty-driven. The planned review events are:

1. **T2 targeted review/re-review** — because provider-event idempotency/partial failure is a Critical seam already shown to fail under crash injection.
2. **Integrated Slice A review** — once T3+T4 converge, review the whole disruption -> case -> focused-view lifecycle. No routine reviews after each increment.
3. **Major Slice B recovery-loop review** — review AI proposal -> deterministic viability -> authority -> execution -> observation -> reassessment/resolution as one integrated safety boundary.
4. **Jordan/generalisation review** — focused review for same-engine generality, provider truth and anti-hardcoding.
5. **Final release review** — exact submission candidate only.

A reviewer-requested fix gets targeted closure evidence; it does not automatically restart the full review cycle.

## Current test contract

- `npm test` — boundary gate + CURRENT_TARGET surface.
- `npm run test:postgres` — current PostgreSQL integration gate.
- `npm run test:migration` — offline migration boundary.
- `npm run test:legacy` — historical SQLite runtime, manual/non-gating only.

During implementation use focused tests first. Run the broad current/PG gate only at coherent slice/candidate checkpoints. Do not let agents debug by repeatedly running historical/full suites.

## Roadmap discipline

- Every intentionally excluded capability stays visible with a reason/revisit condition.
- New provider/source work must use the approved extension/ownership boundaries instead of adding scenario-specific domain branches.
- If implementation exposes a requirement the frozen ontology cannot express, classify it as an architecture gap and resolve it explicitly rather than hardcoding around it.
- Founder-visible integration evidence outranks horizontal completeness. If a slice is blocked, fix the first broken boundary before expanding scope.
- Protect the latest working demo floor. Later observability/Overview/polish milestones must not destabilize the proven Sarah/Jordan vertical loops.
