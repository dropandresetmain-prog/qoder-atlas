# Northstar roadmap

This roadmap separates **implemented runtime truth** from the **approved target refactor**. A planned/frozen architecture is not an implemented capability.

## Implemented baseline

- Generalized recovery loop over the current SQLite-backed Trip/RecoveryCase model.
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
| M6 — unified evaluation | Blocked on integrated M2-M5 | Multi-object scope/propagation, entry/support/programme/condition evaluators and assessment manifests. |
| M7 — planning/action plans | Planned | Multi-object strategies and explicit typed action-plan DAGs. |
| M8 — authority/durable execution | Planned | Scoped approvals, financial commitments, attempts/reconciliation and internal programme execution. |
| M9 — application integration | Planned | Canonical runtime composition, APIs/read models and operator/traveller surfaces. |
| M10 — migration rehearsal | Planned | Legacy export/transform/reconciliation, restore proof and exact candidate verification. |
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

## Roadmap discipline

- Every intentionally excluded capability stays visible with a reason/revisit condition.
- New provider/source work must use the approved extension/ownership boundaries instead of adding scenario-specific domain branches.
- If implementation exposes a requirement the frozen ontology cannot express, classify it as an architecture gap and resolve it explicitly rather than hardcoding around it.
