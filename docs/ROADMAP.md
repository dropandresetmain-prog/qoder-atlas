# Northstar roadmap

This roadmap records **implemented runtime truth, current delivery status, and intentionally deferred scope**.

## Current baseline

> Since M10/C5, **PostgreSQL + PostGIS is the sole NORTHSTAR runtime**. The SQLite-era application runtime is retired: it survives only as offline read-only migration input plus historical test/code evidence. Historical SQLite tests are classified `HISTORICAL_LEGACY` and are non-gating under `docs/TESTING.md`.

Current authoritative development branch: `main`.

Current delivery sequence:

`Slice A -> Founder Test A -> Slice B -> Founder Test B -> submission rehearsal / M11 operational activation -> polish/stretch`

The final Event Overview visual design remains unresolved. The focused Sarah case uses the accepted V5.6 visual language as a design reference, with runtime data supplied by authoritative PostgreSQL/read-model state.

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
| **Slice A** | **NEXT / PLANNED** | Known Sarah baseline -> normal UI -> provider-shaped disruption -> five incident-linked outcomes -> four cleared / Sarah failed -> one case -> click/reload Sarah. Founder test at T1-T4. |
| **Founder Test A** | **PLANNED** | Physically test Slice A before continuing. Fix first broken product boundary rather than expanding scope. |
| **Slice B** | **PLANNED** | Real strategy -> mutation-free preview -> complete affected participants -> authority/approval -> execution -> observation -> reassessment -> recovery. |
| **Founder Test B** | **PLANNED** | Physically test T5-T6 before polish/stretch. |
| M11 — operational activation / retirement | **PLANNED AFTER SLICE B** | Final external legacy-source inventory, authority/sole-writer/reconciliation/provenance closure, old operational-access retirement. **Not** a switch from an active SQLite runtime. |
| C6 / submission candidate | **PLANNED** | Exact candidate, repeatability/failure rehearsal, final current-target gate, operating/backup evidence and submission capture. |

## Immediate product milestones

### Slice A — earliest testable NORTHSTAR

The first founder-testable target is deliberately narrow:

1. restore/load a reproducible Sarah PostgreSQL baseline;
2. open a real product surface;
3. trigger the disclosed provider-shaped flight disruption through normal HTTP;
4. canonical PostgreSQL state changes and reassessment occurs;
5. the UI receives authoritative updated state without manual reload;
6. exactly five incident-linked affected people are accounted for;
7. four are viable/cleared and Sarah is disrupted with the real quantitative reason;
8. exactly one Sarah RecoveryCase is opened/attached idempotently;
9. founder clicks Sarah;
10. focused Sarah case renders from authoritative state and survives reload.

Stop and test here.

The final Event Overview visual layout does **not** need to be frozen before this spine works. A minimal truthful operational surface is acceptable for early testing.

### Slice B — complete Sarah recovery

After Founder Test A:

1. produce/select one real typed recovery strategy;
2. preview remains mutation-free and covers every genuinely affected participation, including no-Journey participants;
3. bind a real operator principal and scoped authority decision to the exact reviewed basis;
4. execute ordered programme changes with revisions/idempotency;
5. observe/commit resulting state;
6. reassess all relevant subjects;
7. same Sarah Journey becomes viable;
8. RecoveryCase resolves only after current passing assessment;
9. action evidence truthfully shows no new Sarah flight purchase.

Stop and founder-test again before polish.

## Current investigations

| Item | Status | Why / revisit condition |
|---|---|---|
| Exact five-person Sarah incident provenance | **Investigate in Slice A** | Baseline PASS must not be misrepresented as checked-by-this-disruption evidence. |
| Exact provider event semantics (`ID7159 cancelled -> moved to ID7153`) | **Investigate in Slice A** | UI claim must match actual accepted commands/state changes. |
| Evaluation -> case orchestration through normal HTTP/product lifecycle | **Act Now in Slice A** | Engine E2E evidence currently includes test-helper assembly not yet proven as browser interaction. |
| Sarah stay/hotel consequence | **Investigate in Slice A/B** | Do not render a healthy stay branch unless target evaluator actually says so. |
| Felix programme linkage | **Investigate in Slice A** | Use actual PostgreSQL programme/requirement truth, not historical fixture drift. |
| No-Journey programme participants (Daniel/Elena equivalents) | **Investigate early; Act Now in Slice B if omission confirmed** | Missing participants must not silently become viable. |
| External legacy SQLite file/volume inventory | **Before M11 activation** | Git cannot prove absence of ignored external files. Does not block Slice A/B. |

## Stretch / deferred / not in current critical path

| Item | Status | Reason / revisit condition |
|---|---|---|
| Progressive per-person evaluation telemetry | **Park for Later** | Atomic authoritative snapshots are sufficient for Slice A; add only if truthful live progress becomes necessary. |
| Rich considered-option / rejected-candidate history | **Park for Later** | Retain/show only if planner evidence genuinely persists it. |
| Polished provider/tool activity projection | **Park for Later** | Useful demo polish, not recovery truth. |
| Authoritative Before/After toggle | **Park for Later** | Needs historical projection retention; revisit after Slice B. |
| Whole-event Live Dependency Graph / semantic zoom / multiple simultaneous focuses | **Park for Later / Stretch** | Focused case + Slice A/B first; revisit only after core works and Event Overview design is approved. |
| Event Overview final visual design | **Unresolved / redesign required** | First prototype rejected. Do not map backend semantics to it prematurely. |
| Deep Participants / Decisions / Activity functionality | **Stretch** | Pages should eventually be presentable, but core demo path wins. |
| Traveller/phone view | **Stretch** | Revisit after core operator path works. |
| Automated visa applications | **Park for Later** | Requires validated legal/provider workflow capability. |
| Insurance claims automation | **Stretch** | Requires insurer integrations/authority/observed outcomes. |
| Transactional ground transport | **Stretch** | Add when reliable quote/book/cancel/observe provider exists. |
| Dedicated graph database | **Deferred** | PostgreSQL relational ownership + explicit dependency/applicability indexes are sufficient until query/scale evidence says otherwise. |
| Microservices / Kafka / Kubernetes | **Deferred** | Modular monolith + durable DB work is sufficient. |
| Unbounded autonomous refunds/post-ticket servicing | **Deferred** | Consequential supplier actions remain capability/authority/observation gated. |
| Generic legal advice | **Rejected as product claim** | NORTHSTAR evaluates sourced requirements; it does not manufacture legal certainty. |
| Retired SQLite dead-code deletion | **Park for Later** | Runtime/test boundaries already make it harmless. Remove after M11/submission when migration archaeology is no longer useful. |
| Physical test-directory split | **Ignore / Accept Risk for now** | Explicit suite manifest + import-graph gate already prevent suite conflation; moving dozens of files is churn. |

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
