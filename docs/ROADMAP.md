# Northstar roadmap

This roadmap separates **implemented runtime truth** from the **approved target refactor**. A planned/frozen architecture is not an implemented capability.

## Implemented baseline

> Since M10/C5, **PostgreSQL is the sole NORTHSTAR runtime**. The SQLite-era application
> runtime is retired: it survives only as offline read-only migration input, its tests are
> classified `HISTORICAL_LEGACY` and non-gating (`docs/TESTING.md`), and the capabilities
> below describe behaviour that the target runtime now owns.

- Generalized recovery loop over the Trip/RecoveryCase model.
- Supplier, traveller and organiser-side changes through the same recovery engine.
- Atlas flight search, verify, fare rules, state observation and sandbox transaction seams; sanitized provider recordings.
- Nuitée/liteAPI hotel search, quote/prebook, book, retrieve and cancellation.
- Frankfurter/ECB-reference FX evidence for deterministic cost/authority comparison.
- Optional Google Routes context with recorded/deterministic fallback.
- Model Studio/Qwen schema-bound extraction/planning plus deterministic fallback.
- Programme intake, shared commitment fan-out, policy/authority gates and observation/reconciliation.
- Operator/traveller read surfaces over application state.

Current capability details and limitations are authoritative in [`CAPABILITIES_AND_LIMITATIONS.md`](CAPABILITIES_AND_LIMITATIONS.md).

## Approved data/state refactor

Architecture decision: **GO / PARTIAL REFACTOR**.

The approved target is defined by:

- [`DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md) — F01-F18 and domain semantics.
- [`DATA_STRUCTURE_LOGICAL_SCHEMA.md`](DATA_STRUCTURE_LOGICAL_SCHEMA.md) — PostgreSQL/PostGIS logical schema and transaction contracts.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — M0-M11, C0-C6 and AT01-AT24.

Target foundations include:

- PostgreSQL + PostGIS as authoritative application persistence after controlled cutover;
- Workspace/Organisation/Principal responsibility separation;
- shared Trip + per-Traveller Journey ownership;
- independent supplier services/reservations/entitlements/allocations;
- Event -> Programme -> ProgrammeItem + Participation as real mutable state;
- explicit credentials/intended visits/document selection for entry/transit feasibility;
- versioned advisories/conditions/external requirements with provenance, freshness, applicability and coverage;
- multi-object assessments/recovery with revision/generation invalidation;
- typed authority/action/execution-attempt/reconciliation boundaries;
- clean typed extension rules for new trip-relevant information such as weather/resource conditions.

## Refactor implementation status

| Stage | Status | Outcome |
|---|---|---|
| Architecture closure + logical schema + plan | **COMPLETE / APPROVED** | F01-F18 frozen; implementation not started by the architecture-doc commit. |
| **M0 — executable contracts** | **COMPLETE / ACCEPTED** | Materialise frozen schemas/contracts, migration mapping and architecture fixtures; **C0 passed** — contract/schema freeze accepted. |
| M1 — PostgreSQL/durability | **COMPLETE / ACCEPTED** | Relational integrity, migrations, revisions, idempotency, inbox/outbox and transaction foundation; **C1 passed** — integrity/concurrency review closed. |
| M2 — people/Journeys/groups | **COMPLETE / ACCEPTED** | Stable identities, shared Trip/per-person Journey, coordination/support and credentials. |
| M3 — services/reservations | Planned / next parallel lane | Shared services, reservations, allocations, entitlements, offers and servicing ownership. |
| M4 — programmes/geography | Planned / next parallel lane | Mutable programme state, participation/resources, Place/Area/Jurisdiction. |
| M5 — knowledge/requirements | Planned / next parallel lane | Source/evidence/publication versions, advisories/conditions and rule editions/coverage. |
| M6 — unified evaluation | Complete — **C2 PASS / ACCEPTED** at `82fa96827fc8d517145498a0ee258f5cdf34c30b` | Multi-object scope/propagation, entry/support/programme/condition evaluators and assessment manifests. Evidence: `docs/refactor/evidence/M6.md` §13-§14. |
| M7 — planning/action plans | Implemented, integrated onto `integration/m7-m8-c3` (was `milestone-m7-recovery-planning`) | Multi-object strategies and typed action-plan DAGs. Evidence: `docs/refactor/evidence/M7.md`. |
| M8 — authority/durable execution | Implemented, integrated onto `integration/m7-m8-c3` (was `milestone-m8-authority-execution`; Checkpoint 0 closed; authority/budget/execution/observation landed) | Scoped approvals, financial commitments, attempts/reconciliation and internal programme execution. Pre-M8 conditions closed: I-10 exact FX; traveller-payer UNKNOWN blocking; decision-time `currentAssessmentView`; reassessment `complete()` bounded retry/requeue. |
| M7/M8 integration | **C3 candidate — C3 not claimed** (independent review pending). All gates green: migrations 0001-0112 from empty, typecheck/build/lint/anti-hardcoding/`git diff --check` clean, `npm run test:postgres` 403/403 pass. Evidence: `docs/refactor/evidence/M7_M8_INTEGRATION.md`; ledger `docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md`. | Single coherent pipeline proven end-to-end: M6 world → M7 strategy/plan → M8 authority/execution → observation/reassessment, across all 10 required cross-lane acceptance tests. |
| M9 — application integration | **C4 candidate** on `milestone-m9-product-integration`. Seed lane `2a14c51` integrated; Sarah S1+S1→S3 and Jordan S2+partial-failure fixture proofs green. Sarah Batik = synthetic/simulated; Jordan flights = Atlas REPLAY; hotels = Nuitée RECORD. Fable polish deferred. Evidence: `docs/refactor/evidence/M9.md`. | Independent C4 review; then M10. |
| WiT frontend semantic contract | **COMPLETE / ACCEPTED** — reviewed at `review/wit-frontend-semantic-contract-opus` `fe09c52`, handed off at `integration/wit-frontend-handoff` `6a655dd`. One presentation adapter boundary at `src/ui/semantics/adapter.ts`, a central visual grammar, exhaustive enum mappings that throw `UNMAPPED SEMANTIC STATE` instead of defaulting silently, and a fixture-only Contract Lab served at `/contract-lab`. No live graph wiring, no new dependencies. Evidence: `docs/FRONTEND_SEMANTIC_CONTRACT.md`, `docs/work/WIT_FRONTEND_INTEGRATION_HANDOFF.md`. | Consumed by post-C5 convergence. |
| WiT live read-model contract | **COMPLETE / ACCEPTED** — `lane/wit-live-readmodel-contract` `cbe5f83`; lane CLOSED. Closed FIG-1/2/3/4/6/7: stable edge identity and authority, monotonic change cursor over a single `REPEATABLE READ` projection snapshot (migrations 0121-0123), assessment-lifecycle exposure, subject-keyed refs, per-subject verdict fidelity, authoritative traveller names, pre-escalation population nodes. | Consumed by post-C5 convergence. **Contract:** the frontend applies the complete authoritative snapshot; `changedVisibleRefs` is an at-least-once emphasis hint and never an exact diff. |
| M10 — migration rehearsal | **COMPLETE / ACCEPTED — C5 PASS** at `87783c0` (`milestone-m10-migration-rehearsal`). Legacy export/transform/reconciliation, restore drill and exact candidate verification. **PostgreSQL is now the sole NORTHSTAR runtime**; SQLite survives only as offline read-only migration input. Evidence: `docs/refactor/evidence/M10_*.md`, `C5_REQUEST_PACKAGE.md`. | Post-C5 product delivery (Slice A / Slice B), then M11. |
| Post-C5 convergence | **COMPLETE** — `integration/post-c5-convergence`, tag `wit-post-c5-convergence`. C5 + accepted frontend foundation + accepted live read models on one candidate; test topology split into classified suites with an enforced SQLite import boundary; `M2-ACCESS-PATH-PLANNER` resolved. | Slice A. |
| Slice A / Slice B product delivery | Planned — sequence frozen in `IMPLEMENTATION_PLAN.md` §22 | Two founder-testable vertical slices. Replaces the superseded six-package framing in `docs/work/POST_C5_DEMO_BACKEND_COMPLETION_PLAN.md`. |
| M11 — controlled cutover | Planned | Target becomes sole application authority after explicit approval. |

Do not mark a stage implemented because its target shape is documented.

## Product capabilities to build on the target foundation

These are product priorities/capability directions, not permission to bypass the M0-M11 dependencies:

- authoritative/appropriately licensed entry and transit data with explicit coverage/freshness and safe `UNKNOWN` behaviour;
- travel advisory/condition sources that preserve publisher truth while allowing organization-specific policy response;
- corporate/TMC/GDS integrations behind provider-neutral external-record/servicing boundaries;
- stronger airline servicing/exchange/cancellation/observation as access permits;
- production hotel servicing/reconciliation and broader supply only where partner access is reliable;
- dynamic ground/local context when it can change a deterministic recovery verdict;
- event/calendar/programme integrations with explicit ownership mode;
- enterprise policy/approval/accounting context and auditable notifications;
- traveller-facing interaction over the same canonical Journey/recovery state.

## Stretch / deferred / not in the current core

| Item | Status | Reason / revisit condition |
|---|---|---|
| Advanced large-tour/scheduling optimisation | **Park for Later** | Correct shared-state/group semantics come first; add optimisation when scale evidence requires it. |
| Automated visa applications | **Park for Later** | Credential/entry architecture supports it, but provider/legal/workflow capability must be validated first. |
| Rich household-management product | **Park for Later** | Family/dependant travel semantics are included; a consumer household admin surface is a separate product need. |
| Full accounting ledger | **Park for Later** | Northstar needs payer/cost/budget boundaries, not a general ERP. |
| Insurance claims automation | **Stretch** | Requires carrier integrations, claim authority and observed outcomes. |
| Transactional ground transport | **Stretch** | Add when reliable quote/book/cancel/observe capability exists. |
| Dedicated graph database | **Deferred** | PostgreSQL relational ownership + explicit dependency/applicability indexes satisfy the approved model; revisit only with demonstrated query/scale limits. |
| Microservices / Kafka / Kubernetes | **Deferred** | Modular monolith + durable DB work is sufficient; revisit with independent scaling/streaming/deployment evidence. |
| Unbounded autonomous refunds/post-ticket servicing | **Deferred** | Consequential supplier actions remain capability/authority/observation gated. |
| Generic legal advice | **Rejected as product claim** | Northstar may evaluate sourced entry requirements but must not manufacture legal certainty or present unsupported advice. |
| M7/M8 effect-scoped `logicalOperationKey` re-plan identity (IN-1) | **Resolved in M9 Checkpoint 1** | Intent uniqueness is per action plan (`0120_m9_replan_identity.sql`). Effect-scoped keys remain; execution known-success/live guards still block duplicate irreversible dispatch. Evidence: `docs/refactor/evidence/M9.md`, `src/app/target/replanIdentity.ts`. |
| Progressive per-person evaluation telemetry | **Park for Later** | Authoritative atomic snapshots are sufficient for the demo; revisit if a slice needs mid-evaluation progress. |
| Rich considered-option / rejected-candidate history | **Park for Later** | Expose it only if planner evidence already retains it; do not invent rejected options for drama. |
| Polished provider/tool activity projection | **Park for Later** | Presentation polish, not product truth. |
| Authoritative Before/After toggle | **Park for Later** | Needs historical projection retention; revisit after Slice B. |
| Whole-event Live Dependency Graph, semantic zoom, multiple simultaneous disruption focuses | **Park for Later** | Slice A/B need one bounded focused graph. Revisit only with an approved Event Overview design. |
| Event Overview visual design | **Unresolved / redesign required** | The first prototype was rejected and is deliberately absent from the repository. Approve a design before mapping it to authoritative backend fields. |
| Retired-SQLite dead-code test audit | **Park for Later** | 76 `HISTORICAL_LEGACY` files and the modules they cover remain in the tree. Deleting them is a separate, reviewable change; the import-graph gate already stops them affecting current correctness. |
| Physical test-directory split (`test/legacy-sqlite/**`, `test/migration/**`) | **Park for Later** | `test/suites.json` plus `gate:test-boundary` already prevent suite conflation; moving ~76 files is churn without added safety. |

## Roadmap discipline

- Every intentionally excluded capability stays visible with a reason/revisit condition.
- New provider/source work must use the approved extension/ownership boundaries instead of adding scenario-specific domain branches.
- If implementation exposes a requirement the frozen ontology cannot express, classify it as an architecture gap and resolve it explicitly rather than hardcoding around it.
