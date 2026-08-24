# Wave 3R — Demo Readiness & Live Validation Closure

**Status:** Active post-NS-G3 closure execution contract  
**Date:** 24 Aug 2026  
**Parent SSOT:** `docs/IMPLEMENTATION_PLAN.md`  
**Repository:** `dropandresetmain-prog/qoder-atlas`  
**Branch posture:** `main` remains the accepted stable baseline until Wave 3R passes its acceptance/review gate.  
**Deadline:** 27 Aug 2026 code freeze; 28–29 Aug video/submission; 30 Aug contingency.

> This document is subordinate to `docs/IMPLEMENTATION_PLAN.md`. It does **not** reopen accepted Checkpoints A/B/C, RV-N0, NS-G1, NS-G2, or Independent Review 2. It supersedes only the failed/original NS-G3 closure path where the requirements below are stricter. If this document conflicts with earlier post-NS-G2 demo assumptions, this document governs Wave 3R execution. Product architecture and frozen contracts remain governed by `docs/ARCHITECTURE.md`, `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`, and accepted contract baselines unless an explicit architecture-gap decision is recorded.

---

## 1. Why Wave 3R exists

The generalized recovery engine is substantially implemented and NS-G2 is accepted. The failed NS-G3 candidate exposed that the remaining problem is not broad product discovery. It is the gap between a strong internal engine and a believable human-originated, live-validated, provider-observed product demonstration.

The target is therefore **not** “make a convincing scripted demo.”

The target is:

> **Northstar is a generic production-shaped resolution pipeline that is validated end-to-end using real AI calls and real/sandbox provider capabilities. The recorded hackathon demo may use synthetic programme/scenario data and replay/captured provider-shaped responses for reliability, but every material operation represented in a hero scenario must have been independently proven capable through the corresponding live/sandbox provider boundary.**

A synthetic itinerary is acceptable. A simulated capability presented as real is not.

The demo scenario must be shaped around provider reality. The application/domain logic must never be shaped around the demo scenario.

---

## 2. Canonical programme and product story

The canonical demo programme is one `AnchorEvent` with:

- **67 speakers total** — this number is intentionally visible/static in the product surface;
- **42 speakers require Northstar-arranged travel**;
- **25 are local, self-arranged, already handled, or otherwise do not require Northstar travel arrangement**.

The exact speaker identities, routes, suppliers, event location, event timetable, hotel properties and prices are demo data/configuration, not application logic.

### 2.1 Initial planning flow for the 42

The target human flow is:

`programme inputs -> authoritative event/traveller context -> generate viable primary trip + alternatives -> organiser review/edit/approve -> send to traveller -> traveller confirms or requests change -> deterministic authority -> provider execution where permitted -> observation -> authoritative trip state`

The application must be capable of performing this planning process for all 42 travellers through the same generalized pipeline. We do **not** require 42 LIVE sandbox bookings or 42 LIVE Atlas searches.

Programme-scale proof and provider-depth proof are separate:

- **Programme-scale proof:** all 42 can be planned, represented, browsed, reviewed and moved through the same contracts without scenario-specific code.
- **Provider-depth proof:** several materially different representative journeys exercise the external operations required by the hero scenarios against LIVE/sandbox APIs.

### 2.2 Optional upload opening

A realistic `Upload Event Details` onboarding flow remains part of Demo Readiness, but it is **not allowed to displace the recovery engine from the critical path or video**.

Supported input bundle may include:

- event brief / programme brief;
- speaker roster (CSV/XLSX/table-like input);
- organiser travel/expense policy;
- public event schedule/webpage or generated realistic briefing material;
- public insurance policy or other sourced documents where useful.

Booking-confirmation documents are **not required** for the canonical opening flow. The canonical demo may start from synthetic but coherent initial trip data after planning approval if video length or implementation risk makes full ingestion less valuable than recovery.

Structured files use deterministic parsing/mapping whenever possible. Messy prose/document context may use Model Studio/Qwen to produce validated proposals. Missing facts stay missing/uncertain; they are never fabricated merely to complete the event.

---

## 3. Demo truth doctrine

### 3.1 Four evidence classes

Every visible provider/AI result used in the demo must be classifiable as one of:

1. **LIVE** — produced during the current run by the real external API/model or provider sandbox.
2. **CAPTURED LIVE / REPLAY** — exact/sanitized input-output evidence captured from a previous successful LIVE/sandbox run, then replayed through the same normalization/downstream code.
3. **SYNTHETIC DATA** — programme/scenario facts generated for the demo but consumed through normal product contracts.
4. **SIMULATED SOURCE EVENT** — an event that an external system would normally send, injected through the real external ingress because the sandbox cannot generate that event on demand.

`SIMULATED SOURCE EVENT` is acceptable only at the source boundary and must not bypass normal ingestion, mutation, planning, authority, execution or observation.

### 3.2 Claims we may make

We may truthfully say:

- the programme/demo data is synthetic where appropriate;
- the hero actions shown have been validated against the corresponding sandbox/live provider capabilities;
- a supplier cancellation event may be simulated if Atlas cannot provoke one, but it enters the same webhook/event boundary Atlas would use;
- replayed demo outputs are captured from successful live/sandbox validation and processed through the same downstream pipeline.

We must **not** claim an exact synthetic hero flight/hotel was actually cancelled or rebooked by a provider unless the corresponding provider action occurred for that exact booking.

### 3.3 Evidence capture

Do not invent a new generalized RECORD abstraction if it is unnecessary.

- Atlas/Nuitée/Google adapters should continue using existing LIVE/RECORD/REPLAY machinery where already implemented and useful.
- Model Studio may use a simpler evidence capture: exact input (or safe hash/reference), model, prompt/schema version, structured response, timestamp, validation result, provenance.
- No chain-of-thought is stored.
- Secrets, raw payment credentials and unnecessary PII must never be committed.

---

## 4. Scenario capability matrix

> **Superseded for scenario naming/intent:** the current frozen scenario
> catalogue is `docs/SCENARIOS.md` (8 scenarios, S1–S8; Tier A: S1/S2/S3/S4/S7;
> High-Priority Stretch: S5/S6/S8). The "S1–S4" family labels below are this
> plan's older capability-matrix numbering and do not correspond one-to-one to
> the catalogue IDs. The capability requirements below remain valid input to the
> generalized pipeline; scenario selection/hero intent now follows
> `docs/SCENARIOS.md`.

All four scenario families below must work through the generalized pipeline before code freeze. The final video may show only the strongest 2–3 in depth.

Exact cities, routes, people and timetable changes are intentionally **not frozen here**. A separate scenario-design task selects them after the Atlas/provider capability investigation.

### S1 — Supplier flight disruption

Minimum capability:

- supplier-originated/provider-shaped schedule change, delay or cancellation enters through a flight-event ingress;
- event correlates to the correct traveller/transport element;
- authoritative state changes through validated mutation;
- blast radius exposes downstream effects;
- recovery strategies consider replacement transport plus downstream hotel/ground/event consequences;
- insurance/policy context can affect strategy/cost handling where supplied;
- deterministic viability + funding + authority decide whether to auto-act or request approval;
- permitted provider actions execute through real/sandbox capability where supported;
- provider result is observed and authoritative trip state is recalculated;
- case resolves only when the whole trip is valid again.

Preferred hero story: a long-haul / multi-leg inbound traveller loses a flight and Northstar must reason through transit and downstream effects. The exact route is chosen from sandbox/provider reality, not coded into the engine.

### S2 — Traveller-requested changes

Northstar must demonstrate that the same `ChangeRequest`/resolution machinery can handle more than one request kind and more than one lifecycle stage.

Required working breadth should include representative examples across:

- **pre-booking flight change/preference**;
- **post-booking flight change** where provider capability allows proof;
- **hotel change / hotel extension or shortening**;
- **flight add-on request** such as baggage or seats where Atlas supports the relevant operation;
- optional other preference/timing changes if they fall naturally through the same schema.

Only 1–2 need polished video treatment. Additional requests may appear as pending items on programme/traveller overview without requiring a polished demo journey.

Natural-language traveller input is the preferred trigger:

`traveller chat -> Qwen interpretation -> validated ChangeRequest proposal -> deterministic resolution engine`

The LLM never mutates state and never directly invokes money-moving/irreversible provider actions.

### S3 — Traveller misses a flight

This is distinct from supplier disruption.

Minimum trigger may be a traveller report such as “I missed my connection” or a future provider-status source. It enters through a traveller-state/change boundary, not a supplier-cancellation demo button.

The engine should be able to reason about relevant downstream consequences including:

- remaining flight sectors / rebooking;
- arrival time;
- hotel check-in / no-show / cancellation exposure;
- ground transfer;
- event commitment viability;
- additional cost / insurance applicability;
- organiser/traveller authority.

A missed connection is a particularly strong candidate if provider/dataset reality supports it.

### S4 — Event-side change with preview-before-commit

The organiser must be able to propose an event change and inspect consequence before mutating authoritative event state.

Required flow:

`proposed commitment/timetable change -> counterfactual/dry-run impact -> affected + unaffected travellers -> viability/cost/approval consequences -> organiser confirms -> authoritative event mutation -> fan-out -> recovery of affected trips`

The exact story should be realistic (for example VIP availability causing a keynote/fireside-chat day/time swap) and is selected in scenario design.

The preview must make clear both:

- who **is affected** and why;
- who **is not affected**.

This scenario must use generic commitment/objective/constraint semantics, not event-specific branches.

---

## 5. Real-time flight-event infrastructure

Wave 3R adds a production-shaped, provider-neutral external flight-event seam.

Atlas provides the first adapter through its schedule-change/cancellation webhook and incident/reconciliation surfaces. The architecture must remain capable of accepting a future operational-flight-status provider without changing the resolution engine.

### 5.1 Target flow

`Atlas webhook / other flight-event source -> Flight Event Ingress -> raw event inbox -> provider normalization -> TripSignal / validated state proposal -> authoritative mutation -> blast radius -> RecoveryCase`

### 5.2 Minimum implementation

- provider-neutral external flight-event contract/envelope;
- Atlas webhook HTTP endpoint;
- validation/authentication according to Atlas capability/documentation available to the project;
- raw event persistence in SQLite before processing;
- idempotency/deduplication using provider event identity where available;
- order/booking/trip correlation;
- Atlas schedule-change/cancellation normalizer;
- conversion into existing `TripSignal` / mutation path without provider-specific domain logic;
- automatic case creation / resolution initiation up to the applicable authority boundary;
- incident/query reconciliation adapter or bounded reconciliation path if Atlas supports it;
- dashboard eventually reflects state without a demo trigger; simple polling is sufficient unless SSE is trivial.

No Kafka, Redis, event bus service or microservice is justified for the hackathon.

### 5.3 Genuine Atlas push investigation

Investigate whether the sandbox/account can:

1. register a webhook URL;
2. emit a schedule-change/cancellation event for a sandbox order;
3. expose the event through incident-list/reconciliation APIs.

If yes, capture a genuine provider-originated event.

If no, the architecture still passes when a valid Atlas-shaped event is injected into the **same public HTTP boundary** Atlas would call and everything downstream remains real.

---

## 6. Transactional provider reality requirements

### 6.1 Atlas flights

Before final scenario freeze, prove the maximum safe sandbox lifecycle actually available to the project account.

Investigation should cover:

- Search;
- Verify;
- fare/change/refund/no-show rules relevant to planned scenarios;
- baggage/seat add-ons if useful;
- forward order creation / payment / ticketing/status if sandbox activation allows it;
- post-ticket/change/cancel/refund capabilities available to this account/API surface;
- schedule-change/cancellation webhook and incident surfaces;
- routes/carriers/dates with useful alternative itineraries and transit structure.

The investigation must also answer:

> **Given Atlas sandbox coverage, what event location and hero traveller origins give Northstar the strongest credible summit/recovery demo?**

Provider reality may shape demo fixtures; it may not create route/location-specific application logic.

If Atlas cannot execute a required exact after-sales operation, the demo scenario may use synthetic booking data while the corresponding operation is independently proven on another sandbox route/case where possible. If the provider cannot prove the operation anywhere, the video claim must be downgraded or the scenario adjusted.

### 6.2 Nuitée hotels

Required live/sandbox proof should include multiple realistic cases, not merely one happy path:

- search;
- quote/prebook/revalidate;
- book;
- retrieve;
- cancellation policy context;
- cancel;
- replacement lifecycle;
- failed/unsupported in-place modification -> deterministic fallback to safe cancel + rebook sequence where viable;
- price/cancellation-fee/downstream cost accounting;
- partial-success/failure handling.

For replacement, prefer safe sequencing that does not leave the traveller without accommodation. Where viable, confirm replacement before cancelling the old stay. If booking succeeds but cancellation fails, observe the partial state, cost exposure and continue resolution/escalation rather than declaring success.

### 6.3 Model Studio / Qwen

LIVE validation required for:

- organiser messy brief/policy extraction into approved proposal schemas where the upload path is implemented;
- traveller natural-language request -> structured ChangeRequest proposal;
- recovery strategy generation/comparison if the current planner uses Model Studio in LIVE mode.

Every model output is schema validated; uncertainty must survive to the application rather than being discarded.

### 6.4 Google Routes

Keep provider-neutral routing context. Make one bounded LIVE attempt if credentials/access exist. Failure is non-blocking if the existing architecture/replay/sourced fallback remains truthful.

---

## 7. Architecture delta allowed in Wave 3R

Accepted ontology and deterministic safety architecture remain frozen unless empirical provider execution proves an actual gap.

One architecture gap is already recognized: the current provider-neutral flight capability is primarily read-only while the strengthened demo requires real/sandbox transactional replacement capability when Atlas allows it.

The lead/integrator may make the **smallest generic execution-contract extension** necessary, for example provider-neutral replacement booking/order/retrieval semantics, while preserving:

`AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`

Never allow:

`LLM -> provider transaction`

Any contract extension must:

- be provider neutral;
- contain no scenario/route/airline/event names;
- preserve authority gating;
- preserve provider observation as separate evidence from desired target state;
- keep UNKNOWN fail-closed;
- support LIVE/sandbox and replay through the same normalization path where practical;
- have targeted independent review before downstream packages rely on it.

Hotel execution should prefer composition of explicit provider-neutral book/retrieve/cancel operations rather than hiding a complex cancel+rebook transaction behind an ambiguous `modifyStay` if that would weaken observability or safety.

---

## 8. Wave 3R work packages

### DR-0 — Capability Reality Gate + Scenario Feasibility Envelope

**Purpose:** establish what Atlas/Nuitée/Model Studio can genuinely do before freezing execution contracts or hero routes.

**Environment:** **LOCAL REQUIRED for live probes using existing secrets/API keys** unless the user has deliberately provisioned equivalent secrets into a secure cloud environment. Documentation-only research can run CLOUD. Public webhook ingress testing may require a deployed/tunnel endpoint, but credential registration should remain controlled.

**Primary model:** Qwen3.8-Max xHigh. Delegate bounded documentation/data enumeration to cheaper subagents, but keep capability conclusions and safety with primary.

**Outputs:**

- Atlas transactional capability matrix for this exact account;
- Atlas webhook/incident capability evidence;
- candidate event locations + hero origin topology ranked for demo strength;
- at least several LIVE/sandbox Atlas flows demonstrating the operations we intend to claim;
- Nuitée multi-case transactional proof including replacement/cancellation behavior;
- Model Studio live smoke for required interpretations/planning;
- Google Routes bounded smoke result;
- evidence inventory with sanitization/provenance;
- exact `Adopt Now | Investigate Further | Park | Reject` decision for every provider capability;
- list of any true architecture gaps discovered;
- no product code changes except minimal safe probe utilities if already consistent with the research tooling boundary.

**Acceptance:** enough empirical evidence exists to choose the scenario envelope and transactional contract without guessing.

**Review gate:** **G3R-R0 Architecture/Capability Decision Review**. Mandatory if DR-0 recommends changing a frozen/shared contract or adding consequential provider execution. Independent reviewer checks empirical evidence and prevents provider wishful thinking.

---

### DR-1 — Runtime Truth + Authoritative-State Closure

**Purpose:** close known correctness defects before layering more human/live flows.

**Environment:** CLOUD OK for code/tests; LOCAL optional for runtime smoke. No live provider call required.

**Primary model:** Qwen3.8-Max xHigh.

**Scope:**

- fix wall-clock causal/timeline coherence without weakening `observedAt >= signalInstant` evidence semantics;
- reconcile persisted Trip aggregate viability after successful verification/resolution;
- preserve hard FAIL/UNKNOWN blocking behavior;
- make loop-back/non-resolution reasons observable enough for application use;
- clear lint/typecheck/build issues touched by the package.

**Acceptance:** ordinary runtime/server time can complete a valid full case; later signals are not incorrectly superseded; resolved case and authoritative trip agree; restart preserves state; no scenario hardcoding.

**Review:** targeted independent review of time semantics and aggregate-state ownership before execution work relies on it.

---

### DR-2 — Provider-Neutral Transactional Execution + Observation

**Purpose:** replace simulated provider action in hero-capable paths with real/sandbox adapters where DR-0 proves capability.

**Environment:** implementation/tests CLOUD OK; **LOCAL REQUIRED for live Atlas/Nuitée transactional validation using secrets** unless a secure deliberately configured cloud environment is used.

**Primary model:** Qwen3.8-Max xHigh; GLM-5.3 only if hard provider/runtime debugging justifies it.

**Scope determined by DR-0:**

- minimal generic flight transactional capability extension;
- provider-backed executor selected by ActionIntent/capability, never by scenario name;
- Atlas transactional mapping for proven operations;
- hotel replacement orchestration with policy/cost/partial-failure semantics;
- retrieve/observe provider truth;
- observed effects -> validated state proposal -> authoritative mutation;
- execution provenance LIVE/REPLAY/SIMULATED truthful and user-facing wording safe;
- idempotency/reconciliation safeguards for uncertain external results;
- no automatic retry of ambiguous money-moving/irreversible operations.

**Acceptance:** at least one real/sandbox flight transactional flow if Atlas account supports it, and multiple hotel lifecycle cases, pass through authority -> executor -> observation -> state update. Unsupported operations fail closed and remain honestly labelled.

**Review gate:** **G3R-R1 Transaction Safety Review**. Mandatory, different model/family. Inspect authority bypass, duplicate action risk, provider-success-vs-trip-success confusion, replay equivalence and secrets.

---

### DR-3 — Real-time Flight Event Ingress

**Purpose:** make supplier disruption event-driven rather than demo-button-driven.

**Environment:** code/tests CLOUD OK. Atlas webhook registration and genuine inbound proof need **PUBLIC ENDPOINT + secrets**; perform locally through secure tunnel or deployed environment. Never expose secrets in logs/fixtures.

**Parallelism:** may begin after DR-0 event schema/capability conclusions; final integration waits for DR-1 state truth.

**Scope:** Section 5 minimum implementation.

**Acceptance:** POSTing a documented/provider-shaped Atlas schedule-change/cancellation event into the real webhook endpoint persists/deduplicates/correlates/normalizes it and automatically begins the correct generic disruption path. Duplicate delivery has no duplicate mutation/case/action. Genuine Atlas push is captured if the sandbox supports it; otherwise inability is documented and simulated source event remains valid for demo.

**Review:** package tests + security/idempotency review; formal independent review only if authentication/event contract changes shared safety assumptions.

---

### DR-4 — Human-Operable Planning, Review and Approval Surfaces

**Purpose:** make programme planning and recovery operable through the product, not API URLs/demo controls.

**Environment:** CLOUD OK. LOCAL optional for full browser smoke.

**Primary model:** Qwen3.8-Max xHigh for integration. Bounded UI copy/tests can delegate cheaply.

**Scope:**

- canonical 67-speaker / 42-travel arrangement programme surface;
- overall list with status, plan review state and action required;
- click into traveller/trip/case from dashboard/programme;
- initial primary recommendation + alternatives;
- organiser can approve/edit/select alternative within existing policy/authority semantics;
- organiser can send proposal to traveller;
- traveller confirmation/decline/decision posts to real backend;
- operator plan/begin/execute/approval actions wired through real endpoints/state;
- correct traveller selection rather than arbitrary seeded trip;
- browser refresh reflects persisted state;
- developer demo controls remain non-hero tooling and do not masquerade as product flows.

**Acceptance:** a human can take a representative traveller from proposed plan through organiser decision and traveller confirmation using clicks/forms only, with no handcrafted JSON/manual API route.

**Testing:** Playwright/browser-level interaction required.

---

### DR-5 — Traveller Natural-Language Change Intake

**Purpose:** ensure traveller-requested changes originate naturally and demonstrate breadth.

**Environment:** code/tests CLOUD OK using replay/stubbed model evidence; **LOCAL REQUIRED for LIVE Model Studio validation using secret unless secure cloud secret exists**.

**Parallelism:** may develop after DR-0/model schema evidence; final integration depends on DR-1/DR-2 semantics.

**Scope:**

- traveller chat/free-text input;
- Model Studio/Qwen interpretation into a proposal conforming to frozen `ChangeRequest`/target schemas;
- schema/business validation + uncertainty;
- explicit state mutation only after existing deterministic promotion/resolution path;
- support working examples across pre-booking/post-booking flight, hotel and add-on requests to the extent provider capabilities permit;
- ambiguous requests fail closed/request clarification rather than inventing details;
- at least 1–2 polished hero-ready flows; 3–4 additional pending/request examples may be overview-only.

**Acceptance:** unseen natural-language requests from the supported families produce validated structured proposals and enter the same resolver as structured ChangeRequests; no LLM direct execution.

---

### DR-6 — Event Change Preview + Multi-Traveller Fan-Out

**Purpose:** deliver the strongest graph-native organiser workflow.

**Environment:** CLOUD OK.

**Primary model:** Qwen3.8-Max xHigh for semantic/integration ownership. Deterministic impact computation remains code.

**Scope:**

- organiser proposes commitment/timetable change;
- counterfactual/dry-run impact without authoritative mutation;
- aggregate affected/unaffected counts and cost/approval/viability consequences;
- drilldown to impacted travellers;
- organiser confirms/rejects proposed event change;
- confirmed mutation enters existing AnchorEvent/Engagement/TripSignal fan-out;
- recovery cases open only for travellers who require them;
- no event-specific branches.

**Acceptance:** alternate event data with a materially different commitment change runs through the same code; preview does not mutate persisted authoritative event/trips; confirm does; affected and unaffected results are explainable.

---

### DR-7 — Missed-Flight Resolution

**Purpose:** prove Northstar handles traveller-state disruption separately from supplier disruption.

**Environment:** CLOUD OK for engine/UI; LIVE provider searches/actions LOCAL when secrets needed.

**Scope:**

- natural traveller report or generic traveller-state signal;
- map to existing generic signal/change/state machinery without scenario type proliferation;
- downstream consequence analysis;
- recovery strategy using proven flight/hotel/routing capabilities;
- authority + execution + observation where permitted;
- truthful fallback when exact provider after-sales operation is unavailable.

**Acceptance:** same resolution engine handles missed-flight case without supplier-webhook code path or bespoke domain branch.

---

### DR-8 — Projection Truth, UX Semantics and Journey Evidence

**Purpose:** eliminate contradictions/internal jargon and show the agentic chain in user language.

**Environment:** CLOUD OK.

**Parallelism:** after DR-1 and APIs/read models are stable; can delegate copy/forbidden-term tests.

**Scope:**

- one shared status derivation across dashboard/programme/traveller/case;
- `CHANGE_REQUESTED` is not displayed as supplier `DISRUPTED`;
- no READY when hard remainder is UNKNOWN/non-viable;
- readout includes disrupted/recovering/resolved correctly;
- planner/extraction uncertainty persists and reaches relevant UI;
- journey/recovery chain projects from real audit/state evidence;
- minimum TravellerPresentation wiring from authoritative state;
- no internal IDs, enum names, raw rule traces, offer IDs or raw JSON in normal user copy;
- provider provenance expressed truthfully but not as internal implementation jargon.

**Acceptance:** cross-view status consistency tests; forbidden-jargon tests; representative clickthrough is understandable without explaining internal architecture.

---

### DR-9 — Canonical 67/42 Demo Data + Scenario Pack

**Purpose:** build scenario data around proven pipeline capability, not vice versa.

**Environment:** CLOUD OK for fixture/data work. Web/provider research may be required; live API validation stays in DR-0/DR-2.

**Dependency:** exact scenario design is frozen only after DR-0. User may clamp stories in a separate chat; implementation consumes the resulting data contract.

**Scope:**

- 67-speaker programme, 42 travel-required visible on product surface;
- coherent event date/schedule and trip plans;
- synthetic speaker identities/contact data unless public/consented data is appropriate;
- realistic internal travel policy/auto-approval/manual-approval guardrails;
- real public policy material such as travel-insurance terms when useful and legally appropriate;
- hero travellers all belong to the same AnchorEvent;
- S1/S2/S3/S4 input packs use natural source interfaces;
- no scenario-name branching in `src/**`;
- alternate-data substitution fixture.

**Acceptance:** every scenario runs through application code unchanged; demo facts live in fixtures/config/sources; hero plans are temporally coherent with event commitments.

---

### DR-10 — Optional `Upload Event Details` Onboarding

**Purpose:** make the beginning believable if schedule allows, without threatening recovery scope.

**Environment:** code/tests CLOUD OK; Model Studio LIVE extraction LOCAL when secrets required.

**Priority:** planned MVP for demo readiness, but **cuttable from video and reducible in polish before any recovery/execution package is cut**.

**Scope:**

- simple human upload surface;
- deterministic CSV/XLSX roster parser;
- supported event brief/policy text/document extraction path using Model Studio where appropriate;
- draft review/uncertainty before authoritative promotion;
- creates/reuses generic Organisation/AnchorEvent/Traveller/Engagement/Policy/Trip structures;
- no universal arbitrary-document promise.

**Acceptance:** a representative roster + brief/policy bundle creates a valid programme draft and promotion through existing contracts. Missing facts remain uncertain.

---

### DR-11 — Demo Progress / Transition Surfaces

**Purpose:** make long-running steps legible in video without fake “AI thinking” theatre.

**Environment:** CLOUD OK.

**Priority:** late polish only after functional flows are green.

Possible surfaces correspond to real application stages such as:

- analysing travel plans;
- checking event commitments;
- comparing flight options;
- checking hotel policies;
- evaluating downstream impact;
- checking organiser guardrails;
- waiting for traveller/organiser approval;
- executing provider action;
- verifying provider result;
- trip recovered / escalation required.

These may be static/progress pages or deterministic transitions, but they must reflect actual state/stage transitions and never invent provider work that did not occur.

---

### DR-12 — Integrated NS-G3R Candidate + Human Demo Rehearsal

**Purpose:** converge all required packages into one candidate and test what judges will actually experience.

**Environment:** integration CLOUD/LOCAL. **LOCAL/public deployed environment required for final live provider evidence where secrets/webhook ingress are involved.**

**Scope:**

- one coherent 67/42 programme;
- initial planning/review/confirmation path;
- all four functional scenario families;
- at least one provider-style asynchronous flight event ingress;
- traveller natural-language change;
- organiser event-change preview/commit;
- missed-flight flow;
- provider execution/observation on all capabilities we claim as real;
- replay/captured evidence mode for reliable demo;
- reset/reseed or deterministic demo bootstrap;
- browser-level clickthrough;
- responsive operator + traveller surfaces sufficient for recording.

**NS-G3R acceptance:** Section 10 below.

**Review gate:** **Independent NS-G3R Product/Reality Review** on exact candidate SHA. Reviewer did not implement the candidate. No unresolved `Act Now`; no unresolved `Investigate Now` that threatens the gate.

---

### DR-13 — Wave 4 Stabilisation / Code Freeze

Only after NS-G3R is accepted.

**Allowed:**

- blocker fixes;
- replay reliability;
- reset/reseed reliability;
- test flakes;
- browser polish that does not change behavior/contracts;
- secret scrub;
- docs/README/demo evidence;
- recording preparation.

**Not allowed after freeze without blocker justification:**

- new provider;
- new scenario family;
- new ontology;
- broad architecture refactor;
- speculative visual redesign;
- stretch capability.

---

## 9. Dependency and parallelisation map

### Critical sequential spine

`DR-0 -> (architecture decision if needed) -> DR-1 -> DR-2 -> DR-12`

DR-0 must happen first because provider reality determines the minimal transactional contract and scenario envelope.

DR-1 must close state/timeline correctness before we trust real execution.

DR-2 must establish provider-backed execution/observation before final scenario/UI claims are frozen.

### Safe parallel lanes after DR-0 conclusions

- **Lane A — flight events:** DR-3
- **Lane B — human operation:** DR-4
- **Lane C — traveller intelligence:** DR-5
- **Lane D — event counterfactual:** DR-6
- **Lane E — missed-flight case:** DR-7
- **Lane F — projection/UX:** DR-8 after DR-1 status semantics stable
- **Lane G — scenario data:** DR-9 after location/route envelope from DR-0
- **Lane H — upload:** DR-10 if recovery spine is on schedule

Shared contracts must be frozen before parallel implementation. Lanes may not independently alter ontology/execution schemas to make local work easier.

Use separate Qoder chats/worktrees for genuinely independent lanes. Keep narrow follow-up fixes in the same chat while context remains useful. Integration and conflict resolution stay with the primary/integrator.

---

## 10. Strict NS-G3R acceptance criteria

### 10.1 Programme and planning

- UI shows **67 speakers / 42 require travel arrangements** as canonical programme truth.
- all 42 can be represented/planned through the same generalized pipeline;
- organiser can browse the list, click into a traveller/trip/case, inspect primary recommendation + alternatives, edit/select/approve as allowed, and send to traveller;
- traveller can confirm or request a change through real product interaction;
- synthetic plans are temporally coherent with event commitments.

### 10.2 Natural source boundaries

No hero scenario begins from a developer/demo trigger.

- supplier disruption -> flight provider/event ingress;
- traveller change -> traveller interface/chat;
- missed flight -> traveller-state/report interface or generic external state signal;
- event change -> organiser proposal/preview/confirm interface;
- optional initial programme -> upload/manual intake surface.

### 10.3 Event-driven/live behavior

- at least one hero recovery begins through asynchronous provider-style HTTP event ingress;
- event is persisted before processing and deduplicated;
- UI observes state change without a special “run recovery” control; polling is acceptable;
- genuine Atlas webhook is preferred if sandbox supports it; otherwise simulated source event through the same HTTP boundary is explicitly labelled.

### 10.4 Resolution safety

- `UNKNOWN` never becomes PASS/READY;
- LLM output cannot mutate authoritative state or execute provider transaction directly;
- desired action/result never substitutes for observed provider truth;
- approval/authority cannot be bypassed;
- auto-approval obeys explicit organiser guardrails;
- ambiguous/partial provider execution fails safely and remains reconcilable;
- resolved Case and authoritative Trip aggregate agree;
- later disruption evidence is not overwritten by causally older evidence.

### 10.5 Scenario breadth

All four scenario families function:

1. supplier flight disruption;
2. traveller-requested changes with more than one request type/lifecycle timing;
3. missed flight;
4. event-side change with preview-before-commit and multi-traveller fan-out.

Final video may select a subset.

### 10.6 Provider proof

- Atlas operations claimed in demo have empirical sandbox/live evidence on at least one appropriate route/case, even if the hero fixture uses another synthetic route;
- multiple Atlas journeys/scenarios are exercised sufficiently to prove provider mapping is not one-fixture brittle;
- Nuitée hotel lifecycle and replacement/cancel/policy behavior have multiple sandbox proofs;
- Model Studio required interpretation/planning surfaces have LIVE proof;
- Google Routes succeeds or is honestly non-blocking/fallback;
- unsupported transaction remains explicitly unsupported/simulated and is not claimed as live.

### 10.7 UX/projection truth

- dashboard/programme/traveller/case agree on status;
- change requests are not mislabeled supplier disruptions;
- uncertainty is visible where material;
- journey/recovery chain uses real audit/state evidence;
- normal user surfaces do not expose raw internal IDs/enums/rule traces/JSON;
- affected/unaffected event-change consequences are clear;
- provider provenance/limitations can be explained truthfully.

### 10.8 Reliability

- application state persists across reload/restart;
- demo bootstrap/reset is deterministic and can be run repeatedly without stale accumulation;
- replay/captured-evidence mode uses the same normalization/downstream path as live where applicable;
- full tests, typecheck, lint and build clean;
- browser/Playwright end-to-end tests cover hero seams;
- anti-hardcoding scan verifies no event/customer/route/airline/hotel/date/scenario-name branch in domain/application logic;
- secrets/PII scrub clean;
- exact candidate SHA recorded;
- independent NS-G3R review passes.

---

## 11. Review strategy

Do not independently review every package. Review at consequential seams.

### Gate G3R-R0 — Capability / architecture decision

Trigger: end DR-0 **if** transactional provider reality requires a shared-contract change.

**Result: ACCEPTED (24 Aug 2026).** The frozen contract base is SHA `0c2f782ffbaf4fc569ab09f8ccad22e52c537516`, published as `origin/g3r-r0-fix` (branch `g3r-r0-fix`): `FlightTransactionCapability` + cancellation trio + external event envelope in `src/contracts/capabilities.ts`, vocabulary in `src/operational/intent.ts`/`src/operational/strategy.ts`, invariant tests in `test/wave3r-contracts.test.ts`, decisions ADR-042..044. The earlier unreviewed candidate `66f7838` is NOT the contract base. Wave 3R Mission 1 (`wave3r/runtime-execution`) consumes this frozen seam for DR-1/DR-2.

Reviewer focus:

- are capability claims empirically proven rather than inferred from docs?
- is the proposed contract delta the smallest generic change?
- can the ontology already express the use case?
- are sandbox/production boundaries safe?
- is any scenario shaping application logic?

### Gate G3R-R1 — Transaction safety

After DR-2.

Reviewer focus:

- authority enforcement;
- irreversible/money-moving gates;
- idempotency/ambiguous execution handling;
- observed provider state vs desired state;
- partial hotel replacement failures;
- replay equivalence/provenance;
- no LLM execution path.

### Gate G3R-R2 — Integrated product/reality candidate

After DR-12 on exact SHA.

Reviewer focus:

- actual browser clickthrough;
- natural trigger boundaries;
- 67/42 programme coherence;
- all four scenario families;
- event-driven ingress;
- provider evidence and demo-claim truth;
- status/uncertainty/jargon;
- anti-hardcoding/generalisation;
- test/replay/reset reliability.

### Final Candidate Review

After Wave 4 stabilisation, before submission.

Broad canonical test/build/lint/typecheck/browser/replay/secret/generalisation/evidence/doc review on exact final SHA.

Every review finding is triaged:

`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`

No gate passes with unresolved Act Now items or Investigate Now items that threaten its acceptance criteria.

---

## 12. Local vs Cloud execution policy

### CLOUD OK

Use Qoder Cloud/worktrees for:

- deterministic engine/application changes;
- UI/read-model work;
- fixture/scenario-data work;
- CSV/XLSX parsing;
- replay tests;
- Playwright against local/test server inside the environment;
- typecheck/lint/build/unit/integration tests;
- docs and copy;
- code reviews not requiring secrets.

### LOCAL REQUIRED / preferred

Use JetBrains Qoder Agent Mode or local Qoder execution when:

- accessing existing Atlas API credentials;
- making Atlas sandbox state-changing/order/payment/ticketing probes;
- accessing Nuitée sandbox credentials for real bookings/cancellations;
- calling Model Studio with keys not deliberately provisioned in cloud;
- calling Google Routes with local key;
- registering Atlas webhook URL using account credentials;
- verifying live inbound provider callback through a tunnel/public endpoint;
- examining local secret-bearing `.env` configuration.

Do not copy secrets into prompts, committed fixtures, screenshots or cloud worktrees merely for convenience.

If a secure cloud environment has been explicitly configured by the user with scoped sandbox credentials, the task may run there; otherwise default to LOCAL.

### PUBLIC ENDPOINT REQUIRED

Actual third-party webhook callback proof requires a provider-accessible HTTPS endpoint. Use a deployed test environment or secure tunnel. The application may still run locally behind the tunnel.

### Sandbox-only side-effect rule

All exploratory state-changing provider actions in Wave 3R must be restricted to known sandbox/test environments. Never point capability probes at production endpoints or real-charge payment methods. If environment identity is ambiguous, fail closed and report blocker.

---

## 13. Agent/model routing

Routing authority remains `docs/AGENT_MODEL_SELECTION.md`.

Wave 3R defaults:

- **Qwen3.8-Max xHigh:** DR-0 conclusions, DR-1, DR-2, DR-4 integration, DR-5 final integration, DR-6 semantics, DR-12 convergence.
- **Qwen3.7-Max / Plus:** bounded long-horizon lanes after contracts freeze, tests, fixtures, copy maps, parser work, replay/evidence inventory.
- **GLM-5.3:** only if difficult provider/runtime debugging remains after ordinary Qwen attempts; not default.
- **Kimi K3:** final visual/UX refinement only after function/truth is green, or controlled long-horizon experiment if time permits. Do not let Kimi redefine API/domain contracts.
- **GPT-5.6 Sol / Claude Opus-class reviewer:** targeted architecture/transaction review and independent NS-G3R review when available.

Delegate bounded tasks to cheaper subagents. Keep architecture, cross-lane integration, provider transaction safety, verification and high-risk changes with the primary model.

---

## 14. Branch/worktree strategy

`main` stays protected as the accepted stable baseline until NS-G3R passes.

Do not merge unfinished Wave 3R packages into `main` independently.

Recommended topology from the current closure line after DR-0/DR-1 integration base is accepted:

- `wave3r/runtime-execution`
- `wave3r/flight-events`
- `wave3r/operator-ui`
- `wave3r/traveller-intake`
- `wave3r/event-preview`
- `wave3r/scenario-data`
- `integration/wave3r-demo-readiness`

Exact branch names may differ; the invariant is isolated lanes from one accepted base and deliberate integration.

Use exact-path staging. Each completed package commits a focused change. Before package close run relevant tests and report SHA. At integrated gates run canonical full checks.

---

## 15. Schedule to code freeze

Current planning date: **24 Aug 2026**.

### 24 Aug — Reality + correctness

1. DR-0 capability reality investigation — start immediately, LOCAL for secret-backed probes.
2. Freeze exact provider execution/event capability envelope.
3. If contract delta required, run G3R-R0.
4. DR-1 runtime truth/state closure.
5. Begin DR-3/DR-9 research/data tasks in parallel once DR-0 facts are stable.

### 25 Aug — Execution + human workflows

1. DR-2 transactional execution/observation.
2. G3R-R1 transaction safety review.
3. Parallel DR-3 flight-event ingress.
4. Parallel DR-4 human planning/approval.
5. Parallel DR-5 traveller natural-language intake.
6. Parallel DR-6 event-change preview.

### 26 Aug — Scenario breadth + convergence

1. DR-7 missed-flight flow.
2. DR-8 projection truth/jargon/uncertainty.
3. DR-9 canonical data/scenario alignment.
4. DR-10 upload only if recovery spine is green.
5. Integrate DR-12 candidate.
6. live/sandbox evidence capture;
7. replay validation;
8. Playwright/human clickthrough;
9. independent NS-G3R review.

### 27 Aug — Code freeze

Only:

- NS-G3R blocker fixes;
- replay/reset/test reliability;
- essential UI/video polish;
- DR-11 progress surfaces;
- docs/evidence/README;
- Final Candidate Review.

**No Stretch pull unless NS-G3R is already green early on 27 Aug. Default expectation: no Stretch.**

### 28–29 Aug

Video, submission, README/demo evidence and final packaging. No architecture work.

### 30 Aug

Contingency only.

---

## 16. Cut order if schedule slips

Protect first:

1. authoritative trip/state correctness;
2. deterministic blast radius/viability/authority;
3. provider-backed execution + observation for claimed actions;
4. S1 supplier disruption via event ingress;
5. S2 traveller change through natural input;
6. S4 event-change preview/fan-out;
7. S3 missed-flight functional path;
8. 67/42 human browsing/planning/approval flow;
9. replay/reset/browser reliability;
10. demo truth/evidence.

Cut/degrade before the above:

1. polished Upload Event Details opening — keep capability/basic path if possible, omit from video;
2. many extra traveller-request variants beyond the required functional breadth;
3. live Google Routes if fallback exists;
4. fancy real-time browser transport — polling is sufficient;
5. rich animation/progress screens;
6. broad insurance automation beyond sourced rule/constraint/cost reasoning;
7. extra Atlas route corpus once representative capability is proven;
8. elaborate design polish.

Never cut:

- authority/safety gates;
- UNKNOWN fail-closed semantics;
- provider observation;
- honest provenance/claims;
- anti-hardcoding/generalisation;
- independent NS-G3R review.

---

## 17. Explicit Stretch / Deferred / Not in Wave 3R

### Stretch only after NS-G3R green

- second operational flight-status/telemetry provider beyond Atlas;
- extra GDS/NDC provider;
- real ground-transfer transaction provider;
- advanced insurance-claim automation;
- richer multi-event portfolio management;
- production authentication/tenancy sophistication beyond demo needs;
- visual analytics unrelated to the hero flows.

### Deferred

- Kafka/microservices/event streaming infrastructure;
- Neo4j;
- broad universal document ingestion;
- live 42-person bulk booking;
- production airline after-sales actions that Atlas sandbox/account cannot safely prove;
- fully autonomous irreversible actions beyond explicit organisation authority.

---

## 18. Milestone close protocol

Before closing each significant package:

- relevant unit/integration tests;
- build/typecheck/lint where touched;
- failure/fallback tests;
- anti-hardcoding check on changed domain/application paths;
- verify no secret/PII leakage;
- update evidence/status docs only after behavior is proven;
- focused commit;
- report exact SHA.

Before NS-G3R:

- full suite;
- full typecheck/lint/build;
- browser/Playwright clickthrough;
- reset/reseed twice;
- replay equivalence;
- live/sandbox evidence inventory;
- anti-hardcoding/generalisation substitution;
- secrets scan;
- independent exact-SHA review.

After accepted integration milestone, commit and push the branch. Do not merge to `main` until the corresponding acceptance/review gate is green.

---

## 19. Current decision state

> Updated 25 Aug 2026 after Mission 3 (LOCAL REALITY CONVERGENCE) on
> `wave3r/reality-convergence` — candidate pushed for NS-G3R review.

### WHAT WE KNOW

- generalized engine/state/viability/authority foundations are accepted through NS-G2;
- Model Studio LIVE extraction/ChangeRequest/validation is proven fail-closed with real credentials (Mission 3 §3);
- Atlas sandbox transactional reality is proven for this account: search/verify/hold/pay/retrieve/cancel quote+submit+observe; `voidQuotation` is READ_ONLY (returns a quotation, does not void) and cancel completes asynchronously as PROCESSING (Mission 3 §2);
- Nuitée sandbox full lifecycle is proven: quote → authority → book → CONFIRMED → cancel displaced → verify (Mission 3 §4);
- Google Routes is LIVE-accessible within bounded read-only use (Mission 3 §6);
- the POST /api/events/atlas ingress drives the full signal → case chain from provider-shaped payloads (Mission 3 §7);
- all four product scenarios (S1–S4) run through real HTTP surfaces in REPLAY with the visible chain from natural source to final state; organiser+traveller browser clickthrough is green (582/582 gate);
- recordings corpora are secret-free (env-value scan) and REPLAY/RECORD normalize byte-identically to LIVE shapes; reset/reseed is deterministic (byte-identical runtime state).

### WHAT WE DO NOT KNOW

- whether the Atlas sandbox can emit a genuine provider-side schedule-change/cancellation webhook on demand (the ingress is proven with provider-shaped payloads through the real boundary; an organic push remains unobserved);
- which Atlas-supported city/origin topology gives the strongest LIVE demo beyond the proven sandbox routes;
- the durability/latency behavior of the Atlas async cancel (PROCESSING) over longer horizons;
- how window-shift planning should source airport evidence for event venues: no shipped scenario fixture links a venue place to an airport (the planner fails closed honestly; see Mission 3 §8 S2 finding).

### KEY ASSUMPTION

The domain engine stays generic and demo scenarios are composed around independently proven sandbox capabilities; a simulated source event may enter the real webhook boundary when Atlas cannot generate the event organically, without weakening downstream proof. The venue→airport evidence gap is closed by fixture/ontology work, not by planner fabrication.

### WHAT TO TEST NEXT

NS-G3R independent review at the exact pushed SHA: rerun the four scenarios + browser rehearsal on a fresh clone, recheck the LIVE evidence inventory against `output/wave3r-mission3-*`, and decide the venue→airport finding (Park for Later vs Investigate Now before demo).
