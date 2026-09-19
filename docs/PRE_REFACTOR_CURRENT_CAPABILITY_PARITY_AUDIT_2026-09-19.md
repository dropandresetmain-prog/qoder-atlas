# NORTHSTAR Pre-Refactor → Current Capability Parity Audit

Repository: `dropandresetmain-prog/qoder-atlas`  
Report date: 2026-09-19  
Current main audited: `63368408b0d719bbd2e3632140fe4b8f17531f26`  
Accepted R3 included in current main: `d9bb9a5f03785db60b6657ca7dfe7c182b07dbd3`  
Accepted R2 reference: `6118f427eb5fdaed4941e918276fa3260acd9d0c`  
Pre-cutover commit: `cfce650b17d53a193925f469f0c794d72c9e7e86`  
Exact last normal pre-cutover runtime: `20454aa7f16e18cf07eb1558481637f8a18f2d09`  
Audit type: read-only static/history/composition parity audit

---

## 1. Executive verdict

NORTHSTAR still has material capability regressions relative to the last normal pre-refactor runtime, even though the current PostgreSQL architecture, R1 planning spine, R2 Case surface, and accepted R3 end-to-end B1 loop are materially stronger than the state captured by the 2026-09-18 truth-rebase audit.

The critical distinction is now:

- the **core recovery/state/evaluation architecture is not the main problem**;
- the **normal-runtime reachability of historical providers, AI/intelligence paths, inputs, and supporting product capabilities remains incomplete**.

Current main now correctly proves a real PostgreSQL B1 loop through the normal boot path, including provider-neutral Atlas `flight.search` in REPLAY, generalized recovery planning, deterministic viability, approval, internal execution, observation, state update, reassessment, and resolution.

However, a significant set of previously reachable capabilities still exist only as source modules, configuration, tests, or historical integrations. Several are not reachable from current normal boot. One current planning composition bug also advertises capabilities that are not actually composed.

### Severity summary

| Severity | Count | Meaning |
|---|---:|---|
| P0 | 0 | No discovered immediate irreversible-safety or data-integrity blocker |
| P1 | 12 | Material parity / runtime truth gaps requiring action or explicit B2 sequencing |
| P2 | 6 | Important but non-blocking parity/product gaps |
| P3 | 3 | Low-priority or intentionally deferred legacy capability |
| **Total** | **21** | Explicit unresolved findings |

### Terminal verdict

**PARITY AUDIT COMPLETE — MATERIAL REGRESSIONS FOUND**

---

## 2. What changed since the 2026-09-18 truth-rebase audit

The earlier audit was directionally correct that M10 cut over normal boot before product parity had been proven. Some of its detailed conclusions are now stale because R1-R3 repaired major parts of the product.

Current main has materially improved or closed the following earlier concerns:

- generalized recovery planning now exists as one PostgreSQL-target coordinator;
- recovery planning is no longer programme-only;
- accepted R3 composes read-only Atlas flight research in the normal target boot;
- sequential continuation/replanning now exists through the current recovery progression path;
- deterministic RC-6 viability remains authoritative;
- the Case surface now exposes planning evidence, tool provenance, rejected candidates, recommendation basis, execution/observation state, Original vs Current graph context, and partial recovery;
- accepted R3 has real PostgreSQL, normal-boot, and Chromium acceptance evidence.

The audit therefore does **not** recommend restoring `RuntimeOrchestrator`, reviving SQLite, or replacing the current recovery engine.

The remaining problem is narrower and more operational: **capability reachability and composition parity**.

---

## 3. Audit baseline and method

### 3.1 Exact historical comparison point

The M10 PostgreSQL-only runtime cutover is:

`cfce650b17d53a193925f469f0c794d72c9e7e86`

Its immediate parent, and therefore the exact last normal legacy runtime before the cutover, is:

`20454aa7f16e18cf07eb1558481637f8a18f2d09`

This audit compares that baseline against current main, while using R2 and R3 SHAs as intermediate evidence points.

### 3.2 Evidence rule

A capability is treated as preserved only when the chain is materially present:

`implementation -> composition -> caller -> authoritative input -> consumed output -> current proof`

A surviving module or passing isolated unit test is **not** enough to prove normal-runtime parity.

### 3.3 Evidence vocabulary

- **REACHABLE** — reachable from the current normal boot through a real product/application caller.
- **PROVEN** — reachable and covered by current acceptance/integration evidence.
- **SOURCE-ONLY** — implementation survives but normal target composition/caller is missing.
- **CONFIG-ONLY** — configuration survives but no current normal-runtime consumer exists.
- **TESTED-ZOMBIE** — module tests exist, but the capability is not reachable from normal product boot.
- **SUPERSEDED** — old mechanism is legitimately replaced by a current mechanism with equivalent or stronger behavior.
- **PARTIAL** — some historical behavior is preserved but material operations or input/output paths are missing.
- **DEFERRED** — intentionally outside current milestone scope and explicitly sequenced later.
- **UNKNOWN** — insufficient evidence. This audit found no remaining material unknowns requiring another archaeology pass.

---

## 4. Historical normal-runtime capability inventory

At `20454aa7...`, `src/main.ts` composed the old application runtime, which directly instantiated or connected:

- SQLite trip/entity/source/signal/case/audit/preference stores;
- booking dossier store;
- FX rate store;
- event inbox store;
- mutation/programme services;
- `FileRecordingStore`;
- Atlas flight read/search adapter;
- Atlas flight transaction adapter;
- Atlas event normalizer;
- Atlas provider state reader;
- Google Routes adapter;
- Nuitée hotel adapter;
- Frankfurter FX adapter;
- layered FX resolution;
- overlay viability engine;
- recovery execution service;
- RuntimeOrchestrator;
- model/intelligence client;
- live model recovery planner or deterministic fallback;
- programme and traveller-change model interpretation paths;
- operator/traveller/programme/activity/decision/read-model handlers;
- provider-event ingest/reconciliation;
- programme change preview/compare/commit;
- upload/draft/promote intake;
- runtime action handlers and demo flows.

The old runtime was not architecturally cleaner than the current PostgreSQL target. It was, however, broader in **normal-runtime connected capability**.

---

## 5. Current normal-runtime composition

Current main uses:

`src/main.ts -> composeTargetBoot() -> target PostgreSQL application/runtime`

Current accepted runtime strengths include:

- PostgreSQL + PostGIS as sole normal persistence;
- canonical state and dependency propagation;
- currentness and reassessment;
- durable RecoveryCases;
- R1 generalized planning/evidence/recommendation;
- deterministic RC-6 viability;
- deterministic authority gating;
- internal execution path;
- observation and state update;
- recovery progression/replanning;
- case resolution;
- operator Overview / Programme / Decisions / Activity / Case;
- traveller Journey;
- R3 normal-boot Atlas read-only flight research;
- LIVE/RECORD/REPLAY at the restored Atlas transport research boundary.

This architecture should remain the spine.

---

## 6. Critical current composition defect: phantom capabilities

### G01 — HOTEL / TRANSFER / RESEARCH advertised without real normal-boot capability

**Severity:** P1  
**Triage:** Act Now  
**Disposition:** CURRENT DEFECT

Current `recoveryPlanningCoordinator.ts` defines:

`DEFAULT_CAPABILITIES = ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH']`

and falls back to those defaults when `availableCapabilities` is not explicitly supplied.

Current normal boot does not compose real HOTEL, TRANSFER, or generic RESEARCH provider capability. R3 composes only read-only FLIGHT research through Atlas.

The recovery-domain contract explicitly says available capabilities are the capabilities **actually available to this composition**, and unavailable requirements should fail closed.

Therefore current planning can mark STAY, TRANSFER, or INFORMATION_RESEARCH domains as capability-available even when no real provider is connected.

This is not an irreversible-execution safety hole, because consequential provider execution remains gated elsewhere. It is still material because it can produce false planning evidence and incorrect “investigated/available” truth.

**Required fix:** derive `availableCapabilities` from the actual composition root. Do not default to provider families that are not composed.

---

## 7. Provider and operation-level parity

### 7.1 Atlas

| Operation / responsibility | Historical normal runtime | Current main | Status |
|---|---|---|---|
| Flight search | Reachable | Reachable via R3 target transport research | **PROVEN** |
| Search LIVE/RECORD/REPLAY | Yes | Yes at R3 read-side seam | **PROVEN** |
| Flight verify | Available in old adapter/tool model | No current product/planner caller | **PARTIAL** |
| Fare/change/refund rule reads | Historical adapter/tool surface | No current product/planner caller | **PARTIAL** |
| Order/create/pay | Historical transaction adapter | Not target-composed | **DEFERRED B2** |
| Order status | Historical transaction adapter | Not target-composed | **DEFERRED B2** |
| Cancel quote / cancel status | Historical transaction adapter | Not target-composed | **DEFERRED B2** |
| Cancel submission | Historical transaction adapter | Not target-composed | **DEFERRED B2** |
| Provider event normalization | Historical normal ingest | No target normal ingest equivalent | **REGRESSED** |
| Provider state reconciliation | Historical state reader | No target normal reconciliation equivalent | **REGRESSED** |

### 7.2 Google Routes

The adapter survives in source and tests, but current target boot does not compose it into normal recovery planning.

Historical route/ground-transfer context therefore became **SOURCE-ONLY / TESTED-ZOMBIE**.

This is a material planning-evidence regression for whole-trip recovery where ground connectivity affects viability.

### 7.3 Nuitée

Historical normal runtime composed Nuitée for hotel context/search/quote/retrieve and transactional hotel operations.

Current target normal boot does not compose Nuitée.

Read-side stay research is therefore regressed. Hotel booking/cancel should remain deferred to B2 unless the chosen MVP vertical requires it.

### 7.4 Frankfurter

Historical normal runtime composed Frankfurter through layered FX resolution.

Current target boot retains FX domain/state machinery but does not compose the external Frankfurter reference resolver.

Stored PostgreSQL FX observations and deterministic funding checks remain valid, but live/reference FX supplementation is absent.

### 7.5 Transfer and generic research

Do not invent historical parity that never existed.

The old AI/tool vocabulary contained transfer/research concepts, but this audit found no equivalent historical first-class real provider adapter for generic transfer booking or generic authoritative research.

The current gap is therefore mainly the false capability advertisement in G01, not loss of a proven historical provider.

---

## 8. LIVE / RECORD / REPLAY parity

Historically, provider adapters were designed around provider-neutral mode boundaries and `FileRecordingStore`.

Current R3 correctly restores that model for Atlas `flight.search`.

Still missing from current target composition:

- Google Routes mode-aware normal-runtime reachability;
- Nuitée mode-aware normal-runtime reachability;
- Frankfurter normal-runtime reachability;
- Atlas consequential transaction operations;
- provider event reconciliation.

The architectural pattern remains correct:

`LIVE -> provider -> provider-shaped response -> normalization`

`RECORD -> same LIVE call + persisted provider-shaped response -> same normalization`

`REPLAY -> recorded provider-shaped response -> same normalization`

Restoration should reuse this boundary rather than create target-specific mock logic.

---

## 9. AI / intelligence parity

### Historical reachable AI responsibilities

The pre-cutover normal runtime could compose:

- Alibaba Model Studio / Qwen through `IntelligenceClient`;
- OpenRouter as an alternative provider;
- model-assisted recovery strategy generation;
- tool-request generation for read-only research;
- uncertainty/assumption extraction;
- programme roster/event-brief extraction;
- traveller natural-language change interpretation;
- deterministic fallback planning when model use was unavailable or disabled.

### Current main

Current target planning is primarily deterministic.

The target contracts allow AI-assisted provenance and suggested domains, but normal boot does not currently instantiate the Qwen/Model Studio client into the recovery planning path.

This means current main has a strong deterministic recovery engine but is missing several intended agentic responsibilities:

- unstructured interpretation;
- semantic uncertainty extraction;
- soft preference interpretation;
- semantic consequence judgement;
- AI-assisted recovery-domain suggestion;
- AI strategy ideation beyond current deterministic proposers;
- bounded model-driven read-tool request generation.

Hard viability, permissions, authority, arithmetic, state mutation, and irreversible action gates correctly remain deterministic.

### Disposition

- **Qwen / Model Studio target-native composition:** P1, Act Now after immediate composition truth fix.
- **OpenRouter alternative:** P3, Ignore / Accept Risk for MVP unless provider redundancy becomes necessary.

---

## 10. Preferences, policy, budget, and FX

Current PostgreSQL architecture is stronger than the old runtime in policy/funding state representation.

It includes durable constructs for:

- preferences with EXPLICIT / INFERRED provenance;
- budgets;
- budget commitments;
- cost allocations;
- FX observations;
- rule sets / assignments;
- information/evidence.

The comparator also encodes explicit preference > inferred preference ordering.

However, the normal planning capture does not currently load stored PostgreSQL preferences into the planning comparator input.

Therefore the data exists, the comparator supports it, but normal planning does not consume it.

This is a real parity gap, not a schema gap.

Funding is not wholly regressed: current deterministic funding evaluation correctly fails UNKNOWN when required FX is missing, and current approval logic refuses costed external actions without the required hold/gate.

---

## 11. Provider identity and execution dossier parity

The old runtime used booking dossiers containing traveller legal/contact/payment references and replacement-stay information.

Current PostgreSQL target has a structurally better canonical identity model:

- external connections;
- external records;
- external record links;
- LINKED / UNVERIFIED identity state;
- reservations and lines;
- allocations;
- service entitlements;
- travel credentials;
- names and contacts.

That is an architectural improvement.

What is not yet proven is the **transaction-ready protected execution bridge** from canonical PostgreSQL identity to provider-specific irreversible action inputs.

In particular, the old dossier concept included protected transaction data such as payment references. A direct PG equivalent is not yet established in current normal execution composition.

This should be solved as a B2 prerequisite rather than by resurrecting the old dossier store wholesale.

---

## 12. API and input parity

The old normal HTTP runtime exposed a broader input surface than current target v2.

### Preserved / superseded

- Case creation and strategy planning: superseded by current target paths.
- Approval and resolution evaluation: current target.
- Internal execution: superseded by current controlled execution/progression.
- Operator Case/Overview/Decisions/Programme/Activity: current target surfaces exist.
- Traveller journey read: current target exists.
- Demo provider-event path: current target exists for scenario proof.

### Regressed or narrowed

#### Traveller change intake

Historical runtime supported natural-language traveller change requests with optional model interpretation plus deterministic downstream handling.

Current target has no equivalent normal product route.

#### General structured change request

Historical runtime had a broader generic change-request path. Current target product input is narrower.

#### Missed-flight reporting

Historical explicit missed-flight input is not present in current target.

#### Programme change

Historical programme change supported preview/compare/commit for:

- RESCHEDULED;
- RELOCATED;
- CANCELLED;
- OTHER.

Current target supports the accepted bilateral time-swap path but is materially narrower than that historical capability.

#### Upload / draft / promote

Historical CSV/document-style intake, draft/review/promote workflow, and model-assisted roster/event brief mapping are not present in target normal runtime.

#### Provider-native Atlas event ingest

Historical runtime exposed Atlas event normalization and provider state reconciliation. Current target has demo provider-event endpoints, but not equivalent provider-native normal-runtime ingest/reconciliation.

#### Provider/runtime status

Historical provider status visibility is absent from current target product/API surface.

---

## 13. Product-surface parity

### Overview

Current target Overview is stronger for current population/queue truth and should remain the base.

### Case

The earlier 2026-09-18 audit overstated the remaining Case regression because it predates R2/R3 improvements.

Current Case now exposes:

- what changed;
- current failure;
- planning domains;
- researched tools;
- provider/provenance;
- material candidates including rejected options;
- recommendation/basis;
- deterministic outcomes;
- approval state;
- actions;
- execution/observation state;
- partial recovery;
- focused Original vs Current graph context.

Residual gaps are mostly richer whole-trip/funding presentation and some trade-off narrative. These are P2 rather than a reason to reopen R2/R3.

### Traveller

Current target traveller surface is appropriately user-down: what changed, what matters, what NORTHSTAR is doing, what is needed, and whether the journey is viable.

### Programme

Read presentation is preserved. Generic programme-change inputs are narrower.

### Decisions

Preserved.

### Activity

Current Activity primarily projects `change_records`.

It does not yet aggregate a full semantic operational history across:

- disruption signal;
- impact assessment;
- research;
- rejected candidates;
- recommendation;
- approval;
- execution;
- provider observation;
- reconciliation;
- recovery state transitions.

Case-specific planning evidence is much richer, so this is a projection/product gap rather than lost durability.

---

## 14. Legal, entry, advisory, and insurance context

Current PostgreSQL foundations are stronger than the old runtime for authoritative travel-state representation, including:

- passports;
- visas;
- e-authorisations;
- residence/health credentials;
- entry predicates/evaluators;
- information coverage/versioning;
- advisories;
- regulatory conditions.

The audit did not find a historically normal-composed authoritative live legal/immigration research provider that current target removed.

Therefore live immigration/legal research should not be labelled a historical regression.

It remains a future capability that must use authoritative sources and explicit uncertainty labels.

The same applies to insurance-provider research: no historical normal-runtime provider parity was proven.

---

## 15. Zombie inventory

The following classes of code/config remain materially present while lacking full current normal-runtime reachability:

1. Google Routes adapter.
2. Nuitée adapter.
3. Frankfurter adapter.
4. Atlas transaction adapter.
5. Atlas event normalizer.
6. Atlas provider state reader.
7. Model Studio / Qwen recovery intelligence path.
8. OpenRouter intelligence alternative.
9. Programme extraction intelligence.
10. Traveller natural-language change intake.
11. Historical upload/draft/promote intake.
12. Provider status surface.
13. Some old provider/funding/dossier bridges.

Several have current unit tests.

That is useful module evidence, but it does not establish product parity.

---

## 16. Why the earlier audit process missed part of the regression

The main audit-method failure was treating surviving architecture and unit coverage as too close to surviving product capability.

Specific blind spots:

1. It did not require a full negative reachability trace from `main -> boot -> composed dependency -> application caller`.
2. It did not decompose providers by operation.
3. It did not audit configuration consumers separately from configuration parsing.
4. It over-weighted isolated provider/module tests.
5. It did not independently inventory transaction adapters, event normalizers, state readers, dossier/FX bridges, AI extraction, traveller NL input, and provider status.
6. It did not compare all historical HTTP/input surfaces to the target product API.
7. It did not check the inverse problem: the current runtime advertising capabilities that are not actually composed.
8. Some findings became stale after R1-R3 repaired planning, continuation, and Case evidence.

Future parity reviews should require the six-link evidence chain in §3.2.

---

## 17. Unresolved findings register

| ID | Finding | Severity | Triage | Required disposition |
|---|---|---:|---|---|
| G01 | Phantom HOTEL / TRANSFER / RESEARCH availability in planner composition | P1 | **Act Now** | Derive capabilities from actual composition |
| G02 | Atlas consequential transaction/execution not target-composed | P1 | **Park for B2** | Restore through provider-backed executor only |
| G03 | Atlas event normalizer + provider state reconciliation not target-composed | P1 | **Act Now after R3** | Restore provider event/reconciliation boundary |
| G04 | Google Routes not target-composed | P1 | **Act Now after R3** | Restore read-side route context if required by whole-trip viability |
| G05 | Nuitée read/search/quote/retrieve + real STAY recovery absent | P1 | **Act Now after R3** | Restore read-side stay research/proposer path |
| G06 | Nuitée book/cancel not target-composed | P1 | **Park for B2** | Only restore if hotel execution is in MVP vertical |
| G07 | Frankfurter live/reference FX supplement absent | P1 | **Act Now before B2** | Restore reference FX resolver |
| G08 | Model Studio / Qwen target-native composition absent | P1 | **Act Now after R3** | Reconnect bounded AI responsibilities to target planner/intake |
| G09 | PG preferences stored but not loaded into planning/comparator | P1 | **Act Now after R3** | Feed authoritative explicit/inferred preferences into planning |
| G10 | No proven PG protected execution dossier/payment bridge | P1 | **Investigate Now before B2** | Freeze protected provider-execution input contract |
| G11 | Traveller NL / structured change-request product input absent | P1 | **Act Now after R3** | Restore generalized change intake on target runtime |
| G12 | General programme change preview/compare/commit narrowed to time-swap | P1 | **Act Now after R3** | Restore generalized change types when required |
| G13 | Atlas verify/fare/order/cancel read capabilities lack planner/product callers | P2 | **Park for Later** | Restore by actual recovery-use requirement |
| G14 | CSV/draft/upload + AI roster/event brief extraction absent | P2 | **Park for Later** | Restore if programme onboarding/demo needs it |
| G15 | Generic/manual disruption + missed-flight reporting lost | P2 | **Park for Later** | Add generalized input surfaces after provider parity |
| G16 | Global Activity is too thin for semantic operational history | P2 | **Park for Later** | Build post-E2E projection |
| G17 | Whole-trip/funding richness still partial on Case/Programme | P2 | **Park for Later** | Product-hardening pass |
| G18 | Provider/runtime status surface gone | P2 | **Park for Later** | Restore operational diagnostics when needed |
| G19 | OpenRouter alternative intelligence provider lost | P3 | **Ignore / Accept Risk** | Qwen is sufficient for MVP |
| G20 | Old hero-launch presenter orchestration not ported | P3 | **Ignore / Accept Risk** | Historical demo convenience only |
| G21 | Generic legacy runtime state/API ergonomics not ported | P3 | **Ignore / Accept Risk** | Current product read models supersede it |

---

## 18. Recommended sequencing

### Now

1. Fix G01 so planning capability availability is truthful and fail-closed.
2. Keep accepted R3 frozen as the B1 baseline.
3. Preserve the current proof chain:
   `normal boot -> Atlas REPLAY flight.search -> materialized transport evidence -> deterministic RC-6 -> recommendation -> approval -> internal execution -> observe -> reassess -> resolve`.

Do **not** restore every historical provider before fixing G01.

### Provider / semantic restoration before B2

Restore the read/semantic side deliberately:

1. Atlas provider-native event normalization + reconciliation.
2. Google Routes where whole-trip viability needs route context.
3. Nuitée read/search/quote/retrieve and STAY planning.
4. Frankfurter reference FX.
5. Model Studio / Qwen for bounded interpretation/planning responsibilities.
6. PostgreSQL preferences into planning/comparator.
7. Real capability registry derived from composition.
8. General traveller change-request intake.
9. Freeze the PG-native protected provider identity/dossier bridge.

Each restored provider must use the same engine and the same LIVE/RECORD/REPLAY normalization path.

### B2

Only after the read/semantic side and execution-input contract are sound:

- Atlas create/pay/status/cancel;
- provider-backed execution worker;
- protected provider execution identity/dossier;
- deterministic cost/budget hold;
- provider reconciliation and uncertain-outcome handling;
- Nuitée consequential operations only if hotel execution is inside the chosen vertical.

Maintain the hard boundary:

`AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`

Never:

`LLM -> irreversible/money-moving API`

### Post-B2 / product hardening

- semantic Activity/operational history;
- provider/runtime status;
- programme/upload intake;
- generalized programme changes;
- richer whole-trip/funding Case presentation;
- missed-flight/manual input.

### Explicitly deferred unless demo/product need changes

- OpenRouter;
- old hero launcher;
- transfer booking;
- live legal/immigration research;
- generic webpage/email ingestion beyond a demonstrated scenario need.

---

## 19. What is preserved and should not be reopened

The audit does **not** justify replacing or reopening:

- PostgreSQL as sole normal runtime persistence;
- F01-F18 architecture closure;
- current Traveller / Trip / Journey / Programme ontology;
- ChangeSignal;
- RC-6;
- deterministic permissions/authority;
- immutable ScenarioChange overlays;
- current RecoveryCase lifecycle;
- current R1 recovery coordinator;
- R2 Case workspace;
- accepted R3 B1 loop;
- provider-neutral adapter boundaries;
- deterministic irreversible execution gates.

The correct response is composition restoration and bounded input/provider parity work, not another architecture rewrite.

---

## 20. Coverage

This audit explicitly covered:

- exact pre-cutover runtime baseline;
- old and current composition roots;
- core recovery loop;
- provider modules and operation-level reachability;
- LIVE/RECORD/REPLAY;
- recording infrastructure;
- provider configuration;
- HTTP/API and input paths;
- AI/model responsibilities;
- preference/policy/funding/FX;
- provider identity and dossier concepts;
- authority/execution/reconciliation;
- local routing;
- stay/transfer;
- legal/entry/advisory/insurance foundations;
- fallback behavior;
- uncertainty handling;
- operator/traveller/programme/decisions/activity surfaces;
- upload/document intake;
- tests that prove modules but not runtime reachability;
- zombie subsystems;
- old-to-current ownership/disposition;
- sequencing into provider restoration and B2.

No full test suite was run for this audit. This was intentionally a static/history/composition audit. Current runtime acceptance evidence comes from the already accepted R1-R3 milestone proofs and repository history.

---

## 21. Major decision record

### What we know

- Current main has a valid PostgreSQL B1 loop.
- Accepted R3 is on main.
- The current Case product is materially stronger than at the time of the 2026-09-18 audit.
- Atlas read-only `flight.search` is now normal-runtime reachable.
- Several historical providers and AI paths survive but are not normal-runtime reachable.
- Current capability advertisement is not fully truthful because G01 remains.
- Consequential external execution is correctly not yet wired into the target runtime.

### What we do not know

No additional broad archaeology is required before acting on the identified gaps.

The material design question that still requires targeted investigation is the protected PostgreSQL-to-provider execution identity/dossier contract for B2.

### Key assumption

Provider and AI restoration should be performed as adapters into the existing PostgreSQL recovery engine, not by reinstating the retired legacy application runtime.

### What should be tested next

After G01:

- focused capability-selection tests proving absent providers fail domains closed;
- normal-boot proof that only actually composed capabilities are advertised;
- then provider-by-provider reachability tests, starting from Atlas event/reconciliation and the first read-side adapter selected for restoration.

---

**PARITY AUDIT COMPLETE — MATERIAL REGRESSIONS FOUND**
