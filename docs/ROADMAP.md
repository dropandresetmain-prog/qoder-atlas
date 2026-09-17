# Northstar roadmap

This roadmap records **implemented runtime truth, current delivery status, and intentionally deferred scope**.

## Current baseline

> Since M10/C5, **PostgreSQL + PostGIS is the sole Northstar runtime**. The SQLite-era application runtime is retired: it survives only as offline read-only migration input plus historical test/code evidence. Historical SQLite tests are classified `HISTORICAL_LEGACY` and are non-gating under `docs/TESTING.md`.

Current authoritative development branch: `main`.

Current delivery sequence:

`T2 acceptance -> T3 -> T4 Case + V5.6 -> Slice A integrated review -> Founder Test A -> Slice B Sarah E2E -> Slice B review -> Founder Test B -> Jordan same-engine E2E -> generalisation review -> Astra planning reconciliation -> post-E2E product milestones -> M11/final candidate`

The final Event Overview visual design remains unresolved and may continue to be explored in parallel. The **current Overview stays the protected functional UI through Sarah and Jordan**. The focused Sarah case uses the accepted V5.6 visual language and is implemented in T4 from authoritative PostgreSQL/read-model state.

Observability is now a planned **post-E2E product milestone**, not a Slice A blocker: one semantic operational-history projection should later feed the Case timeline, Activity journal and compressed Overview feed.

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
- deployed Railway PostgreSQL/PostGIS product baseline with the full AiT world persisting across restart/redeploy.

Current capability details and limitations are authoritative in [`CAPABILITIES_AND_LIMITATIONS.md`](CAPABILITIES_AND_LIMITATIONS.md).

## Architecture source of truth

- [`DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md) — frozen F01-F18 architecture decisions.
- [`DATA_STRUCTURE_LOGICAL_SCHEMA.md`](DATA_STRUCTURE_LOGICAL_SCHEMA.md) — relational ownership/integrity/transaction contracts.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current post-C5 architecture map.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — authoritative current delivery plan in Section 22.
- [`IMPLEMENTATION_PLAN_HISTORY.md`](IMPLEMENTATION_PLAN_HISTORY.md) — preserved historical M0-M11 decomposition and prior post-C5 plan.
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
| Post-C5 convergence | **COMPLETE** on current `main` lineage | C5 + accepted frontend foundation + accepted live read models + converged test topology on one code line. |
| SQLite readiness audit | **COMPLETE — classification A: NO MEANINGFUL LEGACY STATE IDENTIFIED** | No repository evidence of real legacy state or reachable normal-runtime SQLite writer. One bounded external file/volume inventory remains before M11 activation. |
| **T1 — full AiT baseline** | **COMPLETE / FOUNDER ACCEPTED** | Full 67-person PostgreSQL world, authoritative baseline evaluation, product shell, refresh/restart persistence. |
| **T2 — provider disruption/reprotection** | **ACTIVE / REVIEW FIXES** | Happy path exists on feature branch, but independent review found crash/retry and M6 semantic defects. Fix and targeted re-review before Founder T2/merge. |
| **T3 — assessment -> RecoveryCase** | **NEXT AFTER T2** | Add normal incident-scoped case orchestration and real case subject/signal command/application seam. |
| **T4 — Case View + focused V5.6 graph** | **PLANNED** | Real authoritative Sarah Case surface and accepted focused graph; no observability timeline yet. |
| **Slice A integrated review + Founder Test A** | **PLANNED** | One review after T3+T4 converge, then physical founder acceptance. No per-milestone review ritual. |
| **Slice B — Sarah Case -> recovered** | **PLANNED** | Target capability composition + LIVE-safe smokes + Qwen proposal + deterministic viability + authority + programme execution + observation + reassessment + resolution. |
| **Slice B review + Founder Test B** | **PLANNED** | One high-risk independent review of the complete recovery boundary, then physical founder acceptance. |
| **Jordan generalized E2E** | **PLANNED AFTER SARAH** | Same engine/application code; Atlas Search/Verify where useful; provider-heavy seams only as required. |
| **Generalisation review** | **PLANNED** | Focused same-engine/anti-hardcoding/shared-world review after Jordan. |
| **Astra reconciliation** | **PLANNING ONLY / AFTER SARAH + JORDAN E2E** | One architecture/implementation-plan synthesis of all remaining requirements through 30 Sep. |
| **Observability** | **PLANNED POST-E2E** | Semantic operational activity -> Case timeline, Activity journal, compressed Overview feed. |
| **Event Overview final implementation** | **DESIGN IN PROGRESS / IMPLEMENT POST-E2E** | Keep current Overview working until accepted visual and protected E2Es exist. |
| M11 — operational activation / retirement | **PLANNED FOR FINAL HARDENING** | Final external legacy-source inventory, authority/sole-writer/reconciliation/provenance closure, old operational-access retirement. |
| Final candidate / submission review | **PLANNED** | Exact candidate, repeatability/failure rehearsal, Railway readiness, CURRENT target gate, demo/submission truthfulness. |

## Immediate product milestones

### T2 — finish the real external mutation seam

Current branch work must close the independent review findings before merge. In particular:

- crash/retry-safe completion of the multi-command provider event;
- no false `ALREADY_APPLIED` on partial state;
- only-cancelled bookings remain invalid while genuinely superseded lines can project the replacement;
- malformed direct provider bodies cannot silently invoke the demo event;
- replacement service identity is provider/external-identity based rather than incident-event based;
- selected-service writes validate the target item;
- the five-vs-six Sarah/Nadia source contradiction is resolved or explicitly decided without application special-casing.

After fixes, run only the targeted independent re-review of the delta, then Founder T2.

### T3 — incident-scoped failed assessment -> one case

After T2 acceptance:

1. consume the real T2 incident/reassessment outputs;
2. derive the incident-affected scope through existing dependency/evaluation semantics;
3. idempotently open exactly one RecoveryCase for the recovery-relevant failure;
4. attach originating signal and affected subjects through real command/application seams;
5. exclude unrelated pre-existing baseline failures;
6. expose the case through the normal read surface.

No Qwen/provider recovery/authority/execution in T3.

### T4 — minimal real Case View + V5.6

Then:

1. render real Case status/details from authoritative state;
2. expose the real quantitative failure reason;
3. render the accepted V5.6 focused graph from authoritative read-model facts;
4. support click/reload/polling;
5. keep frontend inference out of viability/blast-radius/causality/readiness/policy.

Do **not** add the Case timeline yet. Observability is its own later milestone.

### Slice A review + Founder Test A

Review the integrated path once after T3/T4:

`baseline -> disruption -> affected outcomes -> one case -> Case View/V5.6 -> reload`

Close targeted findings, founder-test, then protect this as the first demo floor.

### Slice B — complete Sarah recovery

Slice B stays one product milestone. Internal implementation checkpoints are allowed but do not become roadmap milestones:

1. target capability composition without importing the retired runtime;
2. harmless LIVE Model Studio/Qwen structured smoke and Atlas Search/Verify smoke;
3. target-native case/context -> Qwen proposal/read-only research boundary;
4. strict schema validation -> deterministic `ScenarioChange`/counterfactual viability;
5. persist viable strategy and compile ActionPlan;
6. real operator principal + authority/approval;
7. execute the programme swap through internal deterministic/durable actions;
8. observe committed result;
9. reassess Sarah and affected scope;
10. resolve the case only on current passing truth.

The Sarah demo should not force another flight purchase just to show Atlas. The stronger product proof is that the airline can have fixed the booking while Northstar determines that the correct whole-trip recovery is a programme change.

### Slice B review + Founder Test B

One independent high-risk review after the complete Sarah loop exists. Focus on AI/action separation, stale authority, execution idempotency, observation/reconciliation and truthful resolution. Then founder-test and preserve the Sarah E2E.

### Jordan — same generalized engine

After Sarah:

- progressive delay/connection impact;
- one real case through the same case orchestration;
- LIVE Atlas Search/Verify where recovery genuinely needs flight alternatives;
- target planning + deterministic viability + authority;
- supported external/simulated action boundary;
- provider observation -> canonical state -> reassessment -> resolution.

Settle `external:offer.select` semantics before mapping it to Atlas create/order/pay. Add Nuitée/Routes/FX only when the actual Jordan recovery requires them.

After Jordan, perform one focused generalisation review rather than another broad architecture review.

## Post-E2E planning and product milestones

### Astra reconciliation — planning only

Once Sarah and Jordan work end to end, use one Astra planning pass to reconcile:

- architecture-readiness audit requirements;
- T2/T3/T4 review findings;
- Slice B and Jordan implementation findings;
- Railway/deployment requirements;
- accepted Event Overview backend/read-model requirements;
- observability requirements;
- provider dispatch/reconciliation and M11/final-submission gaps.

Astra produces the dependency-aware remaining plan through 30 Sep. Normal coding agents implement it incrementally. Astra does not need to own implementation.

### Observability

Observability should represent the operational chain of events, not merely raw committed changes and not merely "Northstar thinking".

One semantic operational-history projection should cover meaningful:

- external/provider events and actions;
- Northstar actions;
- deterministic determinations;
- human decisions;
- observations;
- outcomes.

Project that same history differently:

- **Case:** richest case-scoped timeline below the graph;
- **Activity:** broader filterable operational journal;
- **Overview:** compressed event-scoped feed below the edge-to-edge visualisation.

Design can proceed earlier. Production implementation waits until the real end-to-end lifecycle exists so the feed observes truth rather than a speculative workflow.

### Event Overview

Continue the visual-design lane in parallel. Do not block Slice A/B/Jordan on it.

- current Overview remains the functional demo surface through the protected E2Es;
- production Overview implementation starts after accepted design + protected E2Es, unless proven to be presentation-only with no new backend contract;
- desired direction currently favors an edge-to-edge main visualisation with activity below;
- Overview and Case are projections of one authoritative world state, not separate state machines.

Whole-event graph/semantic zoom/multiple simultaneous focuses remain Stretch.

## Review checkpoints

Independent review is deliberately sparse:

| Checkpoint | Review policy |
|---|---|
| T2 fix delta | **Yes, targeted only** because a real Critical defect was found. Same reviewer verifies direct fixes. |
| T3 | **No automatic independent review.** Focused tests + integration evidence. |
| T4 | **No automatic independent review.** Founder/product evidence plus focused tests. |
| Slice A complete | **Yes, one integrated review** of T2/T3/T4 product path. |
| Slice B complete | **Yes, one major independent review** of AI/authority/execution/observation/resolution. |
| Jordan complete | **Yes, focused generalisation review** for same-engine truth/anti-hardcoding/shared-world continuity. |
| Observability / Overview milestones | **No automatic premium review.** Founder visual/product testing; review only if a concrete architecture/high-risk seam appears. |
| Final candidate | **Yes, one final release review** on the exact candidate plus canonical runtime/deployment evidence. |

Reviewer-requested fixes get targeted verification; they do not automatically restart the whole review cycle.

## Recommended model + harness routes

The three entries are alternatives. Choose one route per task; do not run all three. These routes follow `AGENT_MODEL_SELECTION.md` + `MODELS_ARSENAL.md`.

| Stage | Route 1 | Route 2 | Route 3 |
|---|---|---|---|
| T2 remediation | Qoder + **Qwen3.8-Max** | Codex + **GPT-5.6 Luna xHigh** | Cursor + **Grok 4.6 High** |
| T3 | Codex + **GPT-5.6 Luna xHigh** | Qoder + **Qwen3.8-Flash** | Cursor + **Composer 2.5** |
| T4 | Cursor + **Composer 2.5** | Cursor + **Auto Balance** | Codex + **GPT-5.6 Luna High** |
| Slice B | Cursor + **Grok 4.6 High / Auto Intelligence** | Codex + **GPT-5.6 Terra High** | Qoder + **Qwen3.8-Max** |
| Jordan | Cursor + **Grok 4.6 High** | Codex + **GPT-5.6 Terra High** | Claude Code + **Sonnet High** |
| Astra reconciliation | **GPT-6 Astra Medium/High** via supported planning harness | ChatGPT + **GPT-5.6 Sol High** | Claude + **Opus High** |
| Observability | Cursor + **Composer 2.5 / Auto Intelligence** | Codex + **GPT-5.6 Luna xHigh** | Qoder + **Qwen3.8-Max** |
| Event Overview implementation | Cursor + **Composer 2.5** | Cursor + **Auto Balance** | Codex + **GPT-5.6 Luna High** |
| M11/final hardening | Cursor + **Auto Balance** + owner runbook | Codex + **GPT-5.6 Luna High** + owner runbook | Claude Code + **Sonnet High** + owner runbook |

When an independent review above is warranted, prefer a different family from the implementer. Strong routes are **Opus High**, **Sol High**, and **GLM-5.3**/Terra/Qwen alternatives appropriate to the exact risk. Premium models are escalation, not a tax on every milestone.

`MODELS_ARSENAL.md` already exists and is adapted from `resume-copilot`; do not re-import it unless the routing evidence becomes materially stale.

## Current investigations

| Item | Status | Why / revisit condition |
|---|---|---|
| T2 partial-failure/idempotency semantics | **Act Now** | Independent review proved stuck/false-complete retries. Must close before merge. |
| T2 only-cancelled M6 booking semantics | **Act Now** | Independent review proved unjustified UNKNOWN/PASS paths. |
| Sarah/Nadia six-vs-five source truth | **Investigate Now / decide before Founder T2** | Provider incident says five ticketed/reprotected; baseline fixture puts six on the service. No code special-case. |
| T3 case subject/signal application seam | **Act Now in T3** | Existing acceptance tests have used direct SQL scaffolding; product path needs real commands. |
| Target-native Qwen planning contract | **Act Now in Slice B** | Reuse `IntelligenceClient`; do not port legacy planner output contract. |
| Target capability composition | **Act Now in Slice B** | PG normal runtime currently does not compose live model/provider clients. |
| Explicit LIVE/REPLAY status | **Act Now in Slice B/final demo** | `ADAPTER_MODE` defaults REPLAY; live truth must be unambiguous. |
| Atlas PG timezone resolver | **Act Now before Jordan read-side Atlas integration** | Search normalization must not fabricate local offsets. |
| `external:offer.select` semantics | **Investigate before Jordan external execution** | Do not equate generic selection with create/pay without explicit operation semantics. |
| External observation -> canonical PG reconciliation | **Investigate before Jordan consequential provider actions** | Provider success alone cannot establish recovered state. |
| Reassessment worker observability | **Investigate after E2E / include in Astra plan** | Live demo should not silently stop progressing on worker error. |
| Railway readiness endpoint semantics | **Act before final rehearsal** | Current `/health` can return 200 while composition is only starting, masking boot failure. |
| External legacy SQLite file/volume inventory | **Before M11** | Git cannot prove absence of ignored/deployed old files. |

## Stretch / deferred / not in current critical path

| Item | Status | Reason / revisit condition |
|---|---|---|
| Progressive per-person evaluation telemetry | **Park for Later** | Atomic authoritative snapshots are enough for core E2E; revisit if truthful live progress requires it. |
| Rich considered-option / rejected-candidate history | **Park for Later** | Retain/show only if planner evidence genuinely persists it. |
| Authoritative Before/After toggle | **Park for Later** | Requires historical projection retention; revisit after E2E/Astra plan. |
| Whole-event Live Dependency Graph / semantic zoom / multiple simultaneous focuses | **Park for Later / Stretch** | Focused case + Sarah/Jordan + accepted Overview first. |
| Deep Participants / Decisions functionality | **Stretch** | Core demo path and observability come first. |
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

## Current test contract

- `npm test` — boundary gate + CURRENT_TARGET surface.
- `npm run test:postgres` — current PostgreSQL integration gate.
- `npm run test:migration` — offline migration boundary.
- `npm run test:legacy` — historical SQLite runtime, manual/non-gating only.

During implementation use focused tests first. Run the broad current/PG gate only at coherent slice/candidate checkpoints. Do not let agents debug by repeatedly running historical/full suites.

## Roadmap discipline

- Every intentionally excluded capability stays visible with a reason/revisit condition.
- New provider/source work must use approved extension/ownership boundaries instead of scenario-specific domain branches.
- If implementation exposes a requirement the frozen ontology cannot express, classify it as an architecture gap rather than hardcoding around it.
- Founder-visible integration evidence outranks horizontal completeness. Fix the first broken product boundary before expanding scope.
- Preserve accepted demo floors before adding post-E2E observability/Overview/polish.
