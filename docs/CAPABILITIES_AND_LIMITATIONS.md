# Capabilities and limitations

This is the technical truth sheet for the **currently implemented Northstar runtime**.

`IMPLEMENTED` means an executable runtime path exists. It does not imply every provider path is wired into the current PostgreSQL product composition, every provider is live in every environment, every source has production-grade coverage, or every product surface is polished.

## Current runtime truth

- **PostgreSQL + PostGIS is the sole normal Northstar runtime.**
- SQLite is retired as an application runtime and survives only as explicit offline, read-only migration input plus historical test/code evidence.
- The M0-M10 data/state refactor is accepted through C5; post-C5 repository convergence is complete.
- **T1 is founder-accepted:** the full AiT PostgreSQL world provisions through real commands, contains 67 travellers/trips/journeys, evaluates to 50 PASS / 14 UNKNOWN / 3 FAIL at baseline, renders through the product shell and survives refresh/restart without reprovisioning.
- The same T1 baseline is deployed on Railway with PostgreSQL/PostGIS and has been proven to reuse the existing world across redeploys. The Railway repair was configuration-only; no repository code changed.
- **T2 is not yet accepted or on `main`.** A provider-disruption candidate exists on a feature branch, but independent review proved partial-failure/idempotency and M6 booking-semantics defects that must be fixed and re-reviewed before merge.
- Current delivery is: `T2 acceptance -> T3 -> T4 Case+V5.6 -> Slice A review/Founder Test A -> Slice B Sarah E2E -> Slice B review/Founder Test B -> Jordan same-engine E2E -> generalisation review -> Astra planning reconciliation -> post-E2E product milestones -> M11/final candidate`.

Latest accepted T1 evidence included:

- `npm test`: **749/749**;
- product baseline PostgreSQL test: **14/14**;
- focused Sarah/Jordan/read-model PostgreSQL checks: **17/17**;
- broader `npm run test:postgres`: **476/476** at the T1 candidate checkpoint;
- typecheck, lint, build and anti-hardcoding clean;
- Railway built runtime boot, `/health`, `/`, full AiT provisioning and restart persistence proven after deployment configuration repair.

Do not use the unmerged T2 branch's later test counts as evidence for `main` until that branch passes review and merges.

## Current runtime capability matrix

| Capability | Current status | Provider / modes | Current limitation / direction |
|---|---|---|---|
| Persistence / state ownership | **IMPLEMENTED.** PostgreSQL + PostGIS current runtime with typed relational ownership, expected revisions, durable work and migrations. | PostgreSQL target composition. | M11 is operational activation/retirement, not a future switch away from SQLite. |
| Full AiT demo world | **IMPLEMENTED / FOUNDER ACCEPTED.** 67-person event baseline materialized through real commands with authoritative assessments. | Internal PostgreSQL demo provisioning. | T2+ must mutate this same world rather than create scenario-specific mini-worlds. |
| People / Trip / Journey model | **IMPLEMENTED CORE.** Stable Traveller, shared Trip, per-person Journey, relationships/support/coordination foundations. | Internal PostgreSQL domain. | Product proof now focuses on disruption/case/recovery orchestration, not another identity-model rewrite. |
| Services / reservations / allocations | **IMPLEMENTED CORE.** Independent service/reservation/allocation/entitlement ownership and provider references. | Internal + provider adapters. | T2 is adding truthful cancellation/reprotection semantics but remains unaccepted until crash/retry + booking semantics are fixed. |
| Programme / participation | **IMPLEMENTED CORE.** Mutable Event -> Programme -> ProgrammeItem with Participation independent of travel. | Internal programme state. | Slice B must prove complete affected participation, including people with no Journey. |
| Signals and authoritative mutation | **IMPLEMENTED CORE.** Provider-shaped schedule observations and typed commands reach PostgreSQL with idempotency/concurrency controls. | Internal inputs + provider normalization. | Rich cancellation/reprotection ingress is T2 work, not yet accepted on `main`. |
| Impact / assessment / viability | **IMPLEMENTED.** Revision/evidence/time-bound deterministic assessments, relevant-scope propagation, stale invalidation and PASS/FAIL/UNKNOWN semantics. | Internal deterministic evaluators. | T2 review found an overly broad cancelled-line projection change in the feature branch; `main` T1 semantics remain authoritative until fixed branch merges. |
| Reassessment worker | **IMPLEMENTED / TARGET-COMPOSED.** Scheduled reassessments run through the PostgreSQL target boot pipeline. | Internal PostgreSQL worker. | Error visibility is weak enough to investigate for the final live demo; a worker failure should not look like unexplained product stalling. |
| RecoveryCase primitives | **IMPLEMENTED CORE.** Case commands/schema/read models exist. | Internal PostgreSQL domain. | Automatic incident-scoped failed-assessment -> case orchestration and normal case subject/signal attachment are missing; this is T3. |
| Live read models | **IMPLEMENTED / ACCEPTED FOUNDATION.** Stable edge identity/authority, change cursor, assessment lifecycle, subject-keyed refs and authoritative traveller names. | PostgreSQL projections. | Full-snapshot polling remains the safe first live-update mechanism. |
| Focused Sarah graph | **DESIGN REFERENCE ACCEPTED.** V5.6 visual language is frozen for the focused Case graph. | Frontend design contract. | Runtime integration from authoritative case data belongs in T4. Mock V5.6 facts are not runtime truth. |
| Current Event Overview | **IMPLEMENTED FUNCTIONAL BASELINE.** Current operator Overview renders the full population/event context. | PostgreSQL read model/product shell. | Final visual design is still being explored; current Overview remains the protected functional surface through Sarah/Jordan E2E. |
| Final Event Overview design | **NOT YET ACCEPTED.** Product intent is clear but first visual prototype was rejected. | Parallel design/prototyping lane. | Production implementation is post-E2E unless proven presentation-only with no backend contract change. |
| Activity | **IMPLEMENTED RAW AUDIT SURFACE.** Current product page presents committed authoritative changes. | PostgreSQL audit/read model. | It is intentionally not yet a semantic operational narrative. Post-E2E observability will project meaningful provider/Northstar/human actions, determinations, observations and outcomes. |
| Flight context | **IMPLEMENTED ADAPTER CAPABILITY.** Search, verify, fare rules and provider-state observation. | Atlas LIVE/RECORD/REPLAY. | Current PostgreSQL target application does not yet compose the live Atlas capability into the normal recovery lifecycle. A PG-backed authoritative airport-timezone resolver is needed for robust live normalization. |
| Flight transactions | **IMPLEMENTED ADAPTER CAPABILITY, sandbox constrained.** Order/create, pay, retrieve and supported cancellation/void seams are safety-gated. | Atlas sandbox LIVE + recordings/replay. | Target ActionIntent -> provider dispatcher/reconciler is not yet product-wired. Do not map generic `external:offer.select` to create/pay until its operational semantics are explicit. |
| Hotel lifecycle | **IMPLEMENTED ADAPTER CAPABILITY.** Search, quote/prebook, book, retrieve and cancel. | Nuitée/liteAPI LIVE/RECORD/REPLAY. | Not required for first Sarah E2E; add to Jordan only when actual recovery needs it. |
| Ground routing context | **PARTIAL / OPTIONAL.** Routing can inform deterministic transfer windows. | Google Routes LIVE-capable / replay. | No transactional ground provider; non-blocking to core recovery. |
| FX and costs | **IMPLEMENTED ADAPTER CAPABILITY.** Dated reference evidence supports cost comparison/authority inputs. | Frankfurter LIVE/RECORD/REPLAY. | Conditional on cross-currency recovery needs; not a payment FX service. |
| Model Studio/Qwen transport | **IMPLEMENTED REUSABLE CAPABILITY.** `IntelligenceClient` provides structured Model Studio transport/error/schema handling. | Alibaba Cloud Model Studio / Qwen. | The legacy concrete recovery planner emits retired contracts. PostgreSQL target needs a target-native Qwen planning boundary; target runtime does not yet compose it. |
| Recovery planning core | **IMPLEMENTED DETERMINISTIC FOUNDATION / PRODUCT COMPOSITION INCOMPLETE.** V2 ScenarioChange/RecoveryStrategy/ActionPlan evaluation/compiler exist. | Internal deterministic engine + future target Qwen bridge. | Slice B must wire real case context -> Qwen proposal/research -> strict V2 proposal -> deterministic evaluation -> persistence. |
| Counterfactual preview | **IMPLEMENTED CORE.** Candidate state can be evaluated without mutating authoritative world state. | Internal deterministic overlay. | Normal Sarah product orchestration is not yet wired. |
| Authority / approvals | **IMPLEMENTED CORE.** Scoped authority, reviewed basis, spend/policy checks and approval gating. | Internal authority engine. | Slice B needs a real product principal/approval path bound to the exact plan/current assessment basis. |
| Execution / observation / reconciliation | **IMPLEMENTED CORE.** Typed action intents, durable attempts, observations, ambiguity handling, reassessment and resolution gating exist. | Internal PG execution primitives + provider adapters. | Internal programme execution must be product-wired for Sarah; external provider dispatcher + observation -> canonical-state reconciler is required before consequential Jordan provider actions. |
| Documents / email / web material | **PARTIAL.** Supplied text/structured material can be ingested with provenance and schema-bound extraction. | Internal source contracts / Model Studio. | No general Gmail/arbitrary crawler/legal document product claim. |
| Entry / visa / transit | **IMPLEMENTED ARCHITECTURE + EVALUATOR FOUNDATION; SOURCE COVERAGE PARTIAL.** | Internal/sourced requirements. | Not legal-grade live eligibility without authoritative coverage; missing/stale remains `UNKNOWN`. |
| Advisories / external conditions | **IMPLEMENTED FOUNDATION; LIVE SOURCE INTEGRATION PARTIAL.** | Supplied/fixture sources; future providers. | No universal authoritative advisory provider claimed. |
| Geographic applicability | **IMPLEMENTED FOUNDATION.** Place/Area/Jurisdiction and PostGIS applicability support reasoning. | Internal + provider/source context. | Breadth depends on actual source/evaluator coverage. |
| Observability semantic activity | **PLANNED POST-E2E.** | Future read-model/product layer. | One authoritative semantic activity projection should later feed Case timeline, Activity journal and compressed Overview feed; do not build a parallel source of truth. |
| Railway hosted runtime | **OPERATIONAL.** Current T1 product boots and persists on Railway. | Railway Free + PostGIS service. | `/health` can return 200 while composition is still `starting`, which can mask boot failure; harden readiness before final rehearsal. |

## Provider/runtime composition truth

The current PostgreSQL target boot composes the PostgreSQL runtime/read models/reassessment worker. It does **not yet** compose the complete live provider/intelligence stack into the normal recovery lifecycle.

Reusable provider/intelligence modules already exist, so the direction is a target-owned composition layer — **not** resurrection of the retired SQLite `RuntimeOrchestrator`.

Slice B therefore needs:

```text
PostgreSQL TargetApplication
  + target capability composition
      + Model Studio/Qwen client
      + Atlas Search/Verify
      + optional Nuitée/Routes/FX when used
  + target-native recovery-planning service
  + deterministic strategy/action-plan/authority wiring
  + execution/observation/reassessment lifecycle
```

Final demo posture is **LIVE-first**. REPLAY is tested emergency fallback only and must be labelled truthfully.

## Runtime/read-model contract that frontend must respect

Frontend/business logic must not independently calculate:

- viability;
- blast radius;
- causal failure;
- readiness/buffer pass/fail;
- policy;
- authority;
- recovery correctness.

Frontend applies complete authoritative snapshots. `changedVisibleRefs` / changed-edge metadata may drive emphasis/animation but must not be treated as the sole state payload.

Proposed state must remain visually and semantically distinct from current authoritative state.

There is one authoritative world state. Overview, Case, Programme and any future whole-event graph are different projections/lenses over that state, not separate state machines.

## Current delivery gaps

### Act Now — before Founder Test A

- close T2 review findings and targeted re-review;
- T3 incident-scoped assessment -> RecoveryCase orchestration;
- real command/application seam for case subjects/signals;
- T4 authoritative focused Case read model/surface + V5.6 renderer;
- integrated Slice A review and Founder Test A.

### Act Now — Slice B

- target capability composition;
- harmless LIVE Qwen and Atlas read-only smokes before recovery depends on them;
- target-native Qwen proposal/read-only research contract;
- case planning-context assembler;
- product wiring of deterministic strategy/ActionPlan/authority/approval;
- internal programme execution + observation + reassessment + resolution;
- explicit LIVE/REPLAY capability status.

### Investigate Now — relevant E2E seam

- Sarah/Nadia six-vs-five source-data contradiction surfaced by T2 review;
- no-Journey programme participants and complete affected scope;
- PG-backed IATA -> IANA timezone resolver before live Atlas search normalization;
- operational meaning of `external:offer.select` before Atlas create/pay mapping;
- external provider observation -> canonical PG reconciliation before consequential Jordan actions;
- strategy-selection append-only representation if richer operator selection is needed;
- reassessment-worker error observability;
- Sarah stay consequence / Jordan hotel-ground-FX requirements based on actual scenario truth.

### Post-E2E planned work

- semantic observability: Case timeline + Activity journal + Overview feed;
- accepted Event Overview visual implementation;
- provider/deployment/demo hardening from the Astra reconciliation plan;
- M11/final candidate/submission rehearsal.

### Park for Later / Stretch

- whole-event Live Dependency Graph;
- continuous semantic zoom;
- multiple simultaneous disruption focuses;
- rich rejected-option history;
- authoritative Before/After history;
- broad provider marketplace expansion;
- physical deletion/reorganization of historical SQLite code/tests before it is actually useful.

## M11 readiness

Repository evidence classifies M11 readiness as **A — no meaningful legacy state identified**.

Before final M11 activation, perform one bounded external read-only inventory for ignored/deployed legacy SQLite sources. If none contains unique state, record `no migration source`. If one does, freeze/copy/hash it and use only the retained offline exporter -> PostgreSQL importer -> reconciliation path.

M11 must never reactivate SQLite as rollback.

## Truthfulness rule

Provider/API success is not recovered-trip proof. A recovery claim requires the relevant internally committed or externally observed state, reconciliation where externally owned truth is involved, and a current deterministic assessment of mandatory requirements.

Unsupported, stale, missing or incomplete information remains `UNKNOWN`/unresolved rather than being promoted into a confident PASS or product claim.
