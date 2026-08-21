# Implementation Plan

**Status:** Active execution SSOT. No application code has been implemented yet.  
**Product:** AI Trip Recovery / Resolution Layer  
**Execution environment:** Qoder by default  
**Agent-routing authority:** `docs/AGENT_MODEL_SELECTION.md`

This is the single active implementation plan for the hackathon build. Qoder Quest Specs are bounded execution contracts created from this plan; they may add implementation detail but must not silently redefine product scope, architecture, shared contracts, or acceptance criteria.

Read with:
- `docs/PRODUCT_SPEC.md` — product requirements
- `docs/ARCHITECTURE.md` — logical architecture and invariants
- `docs/ROADMAP.md` — capability scope/status, including Stretch/Deferred
- `docs/TESTING.md` — verification taxonomy
- `docs/DECISIONS.md` — settled architecture decisions
- `docs/AGENT_MODEL_SELECTION.md` — model/harness routing

## 1. Build objective and completion definition

Build the smallest generalized system that can demonstrate the real internal loop:

`source/profile -> validated trip state -> TripSignal -> deterministic mutation -> blast radius -> recovery planning -> capability queries -> scenario overlays -> deterministic viability -> authority -> provider action/simulation -> observation -> updated state -> resolved case`

The MVP is not complete because a screen renders or an LLM suggests a flight. It is complete when:

1. one full recovery case runs through the real internal pipeline without manual state edits;
2. Atlas Search, Verify, and relevant fare/rule normalization have been exercised LIVE at least once and can be replayed through the identical adapter/normalizer path;
3. unsupported external transactions are simulated only at provider boundaries;
4. the operator and traveller interfaces consume actual application read models;
5. a second materially different scenario runs through the same application code with only data/config/source changes;
6. deterministic viability and authority gates cannot be bypassed by model output;
7. the candidate can be reset and replayed reliably without depending on live provider/model availability.

## 2. Execution principles

### 2.1 Parallelise implementation, not unresolved architecture

Shared contracts are frozen first. After that, use separate Qoder Quests/worktrees for genuinely independent lanes. A lane may consume shared contracts but may not change them merely to make local implementation easier.

If repository reality proves a frozen contract wrong, report an **architecture gap** to the lead/integrator. Fix the shared contract deliberately, then rebase/reconcile affected lanes. Never hide an architecture change inside a provider, UI, or demo-specific patch.

### 2.2 Verification is cumulative evidence

Do not run a ceremonial independent review after every package.

- **Work-package implementation:** implementer runs the narrowest tests/checks proving changed behavior plus failure paths justified by the change.
- **Integration:** integrator reuses valid lane evidence and tests only newly created seams/conflict resolutions plus the checkpoint acceptance flow.
- **Independent review:** not default. Use when architecture changed materially, a high-risk/irreversible boundary is introduced, or at the final candidate gate.
- **Final candidate:** run the canonical broad build/typecheck/lint/test/generalisation/replay/secret gates on the exact candidate SHA.

A targeted fix after review needs targeted proof that the finding is closed; it does not automatically restart the whole review/test cycle.

### 2.3 Model routing is role-based, not prestige-based

Follow `docs/AGENT_MODEL_SELECTION.md`. Qoder is the default execution harness. Model choice is stated separately from the execution prompt.

Project-specific evidence matters: Qwen3.8-Max has required more handholding in this project and has shown a tendency toward hardcoded/local solutions. It may still be used for tightly bounded, reversible work with frozen contracts, but it is **not the automatic owner of core state/viability or cross-lane integration**.

Preferred routing for this plan:
- architecture/contract reconciliation: GPT-5.6 Sol High externally or GLM-5.3 High/Max in Qoder; use Qoder Ultimate only when unresolved cross-cutting reasoning actually warrants it;
- core deterministic engine and complex provider work: GLM-5.3 High by default; Kimi-K3 High when unusually broad context is useful;
- bounded implementation with clear contracts: Kimi-K2.7-Code, Qwen3.7-Plus, Qwen3.8-Max Medium, or other current Qoder model that fits;
- integration/debugging: GLM-5.3 High/Max; Kimi-K3 High for broad repository integration; Qwen3.8-Max only with explicit anti-hardcoding checks;
- independent final review: different model family from the main integrator, e.g. DeepSeek-V4-Pro High/Max, Qoder Ultimate using a different family if visible, or external GPT-5.6 Sol/Claude Opus;
- runtime Model Studio calls: start with a cheap model. Upgrade only when evidence shows output quality is blocking the vertical loop.

Use `/model` or Qoder's current selector as authority for current model availability/rates. Do not delay critical work only to capture an off-peak discount.

### 2.4 Worktrees and chats are orchestration boundaries

Use one worktree/branch per meaningful parallel lane after contracts freeze. Do not create a new worktree for every small subtask.

Stay in the same Qoder chat for sequential work within a lane while context remains useful. Start a fresh chat for:
- a separate parallel lane;
- the integrator;
- an independent review;
- a materially different investigation;
- a task where accumulated context is more likely to distract than help.

Recommended branch/worktree topology after Checkpoint A:
- `lane/core`
- `lane/ingestion`
- `lane/providers`
- `lane/intelligence`
- `lane/ui`
- `integration/vertical-loop`

All lane branches must fan out from the same accepted Checkpoint A base SHA. Record that SHA in the tracker before launch. The integration branch also starts from that base and deliberately brings in completed package commits/branches. Do not let five lanes merge independently to `main` while their seams are still unverified.

The Prompter must still state the actual branch/worktree/head in every execution prompt; these names are defaults, not permission to guess repository state.

### 2.5 Mocks and external dependency posture

Mocks/replay belong only at external provider/action boundaries. The internal graph/mutation/impact/planning/viability/authority/case pipeline remains real.

Optional external services must not block the core:
- Google Routes can fall back to replay/sourced duration context.
- Booking.com remains Stretch unless access is immediately available.
- Atlas Singapore fixture availability may improve the demo but cannot shape domain logic.
- Atlas state-changing order execution is Stretch until the read-only/search/verify loop and authority boundary are stable.

## 3. Build checkpoints

There are only three build checkpoints plus the final candidate gate. Work packages below are execution units, not extra milestones.

### Checkpoint A — Contracts and runnable foundation

**Product outcome:** the repository has one runnable application skeleton and frozen shared contracts that all parallel lanes can implement against.

This checkpoint is intentionally serial at the shared-contract layer. It receives lead/human acceptance, not a separate independent review by default.

#### F0 — Stack, repository skeleton, and ownership map

**Objective**
Choose the smallest practical single-application stack, create the package/file skeleton, baseline commands, and exact ownership boundaries for parallel work.

**Recommended starting point**
TypeScript end to end unless a concrete incompatibility appears. Prefer a single web application plus internal modules/packages over services. Use Zod or equivalent runtime schemas for model/provider boundaries. Use SQLite behind repository interfaces.

**Outputs**
- runnable application skeleton;
- package manager and scripts;
- baseline `test`, `typecheck`, `lint`, `build` commands as appropriate;
- environment/config loader;
- SQLite library choice validated by a tiny local persistence smoke test;
- `docs/architecture/PROJECT_FILE_MAP.md`;
- exact path ownership matrix copied back into Section 6 of this plan.

**Must not**
- implement recovery logic;
- introduce microservices, graph DB, queues, or infrastructure without demonstrated need;
- pick technology because it looks impressive.

**Acceptance**
- clean clone/install/run works;
- app starts without Atlas/Google/Model Studio credentials in local/replay mode;
- SQLite round-trip smoke test succeeds;
- package boundaries allow lanes below to work without routinely editing the same files.

**Verification**
Foundation smoke tests only; no broad product review.

**Qoder profile**
Qoder + GLM-5.3 High or Qoder Performance. Qwen3.8-Max is acceptable only if given explicit file/contract boundaries and the output is checked for unnecessary abstractions.

#### F1 — Domain and operational contracts

**Objective**
Encode the approved ontology and operational envelopes as executable typed/runtime-validated schemas.

**Requirements**
Covers `Organisation`, `Traveller`, `AnchorEvent`, `Trip`, `TripElement` (`TransportLeg`, `Stay`, `Engagement`), `TripObjective`, `Place`, `RuleSet`, `Constraint`, provenance/freshness facts, preferences, `TripSignal`, `MutationProposal`, `TripSnapshot`, `ImpactAssessment`, `RecoveryCase`, `RecoveryStrategy`, `ActionIntent`, `AuthorityDecision`, `ExecutionResult`.

**Outputs**
- shared schema/type module owned only by Foundation/lead after freeze;
- validation helpers for unknown enums/references and malformed external/model output;
- serialization contract compatible with SQLite JSON persistence;
- explicit schema/version field where replayed/recorded structures require versioning.

**Must prove**
- flexible required but unbooked transport is representable;
- PASS/FAIL/UNKNOWN are distinct;
- explicit vs latent preference precedence is representable;
- fact provenance/authority/freshness are representable;
- recovered-with-loss can be represented;
- no scenario-specific entity/edge type is necessary.

**Verification**
`T-DOM` contract/schema tests.

**Qoder profile**
GLM-5.3 High or Kimi-K3 High if schema context becomes broad. Do not delegate ontology decisions.

#### F2 — Shared service, capability, persistence, and read-model contracts

**Objective**
Freeze the seams used by all lanes.

**Outputs**
- `TripRepository`, `CaseRepository`, `SourceRepository`, `AuditRepository`;
- `FlightCapability`, `RoutingCapability`, `HotelCapability`, `ResearchCapability`, `SourceIngestionCapability`;
- capability result/error envelope and `LIVE | RECORD | REPLAY` mode contract;
- recovery-planner input/output contract;
- operator/traveller read-model contracts;
- application service boundaries for mutation, impact, planning, authority, execution, observation.

**Acceptance**
A provider adapter can fail without throwing the Case engine into an invalid state; UI can compile against read models without importing graph internals; planner cannot return an executable side effect outside `ActionIntent`.

**Verification**
Compile/schema contract tests, not provider calls.

**Qoder profile**
GLM-5.3 High. Lead owns final contract decisions.

#### F3 — Acceptance scenario specifications

**Objective**
Freeze two materially different scenario specifications before implementation so generalisation can be tested rather than claimed.

**Scenario A: AnchorEvent / invited speaker**
Must contain at minimum: AnchorEvent source context, traveller profile, flight, stay, flexible local transfer, preferred engagement, hard event objective, organiser policy, one insurance policy, disruption, downstream impact, traveller reprioritisation, recovery action.

**Scenario B: corporate/TMC-style trip**
Must differ materially in operator/governance, objective, policy/approval path, route/context and supplier mix. It must not be a renamed copy of Scenario A.

**Outputs**
- scenario specs/data contracts under a dedicated fixture/scenario path defined by F0;
- expected pre-disruption state;
- triggering signal;
- expected blast-radius assertions;
- expected authority path;
- expected resolution outcome.

**Acceptance**
Both scenarios fit F1/F2 unchanged. If not, fix architecture now rather than creating scenario code later.

**Verification**
Schema-load tests only.

**Qoder profile**
Lead/architect or GLM-5.3 High. Qwen3.7-Plus may generate fixture boilerplate after scenario semantics are fixed.

#### Checkpoint A gate

Before parallel build begins:
- F0–F3 outputs exist and compile/load;
- lead/user accepts the frozen contracts;
- Section 6 path ownership is made exact;
- architecture/decisions docs are reconciled if F0–F3 changed assumptions;
- no independent review is required unless the freeze exposed a material unresolved architecture risk.

After this gate, changing shared contracts is a cross-lane change owned by the lead/integrator.

---

### Checkpoint B — Generalized vertical recovery loop

**Product outcome:** one complete recovery case works end to end using real internal logic, real Atlas Search/Verify capability, provider-boundary simulation where needed, and actual UI read models.

The following lanes run concurrently after Checkpoint A. Each lane gets one worktree/Quest. Packages inside a lane are normally executed sequentially in the same chat/worktree.

#### Lane A — Core state, viability, case, and authority

**Primary owner paths**
Frozen by F0; expected areas: `domain/`, `engine/`, `cases/`, `persistence/`.

**A1 — State repository + validated mutation**
- implement SQLite repositories;
- deterministic mutation service consumes only validated `MutationProposal`;
- conflict/provenance resolution for critical facts;
- immutable/auditable mutation history.

**Acceptance:** invalid/malformed proposal cannot mutate state; restart preserves Trip/Case; stale/lower-authority facts do not silently overwrite authoritative current facts.

**Tests:** `T-PERSIST`, mutation subset of `T-PROP`.

**A2 — Constraint evaluators + dependency/blast-radius propagation**
- time/timezone arithmetic;
- duration/buffer envelopes;
- temporal/transfer/location/accessibility/policy/objective primitives required by acceptance scenarios;
- dependency traversal;
- `ImpactAssessment`.

Do not create a giant universal rules engine. Implement generic primitives required by the acceptance scenarios and robustness tests.

**Acceptance:** hard objective failure records irreversible loss and propagation continues; downstream items become VALID/AT_RISK/INVALID/UNKNOWN based on evidence, not blanket invalidation.

**Tests:** `T-EVAL`, `T-PROP`.

**A3 — Scenario overlays + deterministic viability**
- apply candidate mutations to isolated overlays;
- evaluate constraints/objectives on overlays;
- preserve authoritative state;
- expose viability evidence to planner/ranker.

**Acceptance:** infeasible candidate is rejected deterministically; soft tradeoffs remain rankable; overlay never leaks into authoritative Trip.

**Tests:** `T-OVERLAY`.

**A4 — RecoveryCase + AuthorityEngine + execution/observation boundary**
- case lifecycle;
- `ActionIntent`;
- deterministic authority outcomes;
- simulated executor adapter contract for unsupported actions;
- observation -> state update -> verify/loop;
- resolution `FULLY_RECOVERED | RECOVERED_WITH_LOSS`.

**Acceptance:** model cannot bypass authority; API success alone does not resolve Case; observed state/constraints determine resolution.

**Tests:** `T-AUTH`, case transition tests.

**Qoder profile**
GLM-5.3 High default; Max for hard state/propagation debugging. Kimi-K3 High if broad context is genuinely useful. Do not assign this lane wholesale to Qwen3.8-Max without a deliberate reason.

#### Lane B — Source/context ingestion

**Primary owner paths**
Expected `ingestion/`, `sources/`; no direct graph writes.

**B1 — Source/provenance framework + deterministic structured imports**
- `SourceInput`;
- source identity/provenance/freshness;
- manual/profile structured inputs;
- deterministic mapping when provider/source is already structured.

**B2 — Generic web/document/text extraction pipeline**
- AnchorEvent webpage;
- booking confirmation/email/text/PDF inputs supported by chosen stack;
- hotel/supplier policy;
- organisation/event policy;
- one insurance document.

Pipeline: source -> extraction -> constrained schema -> evidence/uncertainty -> validated proposal/rules. Never source -> graph.

**B3 — Traveller context and dynamic research normalization**
- explicit preference;
- latent preference candidate envelope;
- accessibility as requirement, not preference;
- entry/legal findings vs operational immigration-time estimates;
- research provenance/uncertainty.

**Acceptance for lane**
Changing source content changes normalized output without code modification; missing/ambiguous facts become UNKNOWN/uncertainty rather than fabricated certainty.

**Tests**
Relevant `T-DOM`, `T-AI`, ingestion contract tests.

**Qoder profile**
Kimi-K2.7-Code or Qwen3.8-Max Medium for implementation after F1/F2 freeze; Qwen3.7-Plus for fixtures/parsers/tests. Lead retains semantics of provenance/requirements.

#### Lane C — Travel capability adapters

**Primary owner paths**
Expected `providers/`, `recordings/fixtures` interfaces; zero recovery-policy logic.

**C1 — Provider base + LIVE/RECORD/REPLAY**
- mode selection;
- sanitized recording store;
- provider error envelope;
- same normalizer for LIVE and REPLAY;
- no secrets in recordings.

**C2 — Atlas direct adapter**
Mandatory:
- `search.do`;
- `verify.do`;
- fare/change/refund/no-show rule normalization needed by recovery;
- preserve opaque workflow identifiers exactly.

At least one successful LIVE Search/Verify chain must be evidenced during development. Routine tests use replay.

**C3 — Local routing adapter**
- Google Routes `computeRoutes` if configured;
- traffic/transit-aware normalized route/duration context where supported;
- missing credentials/network -> structured unavailable/fallback result, not app failure.

Google live setup is non-blocking. Recorded/sourced context can satisfy demo reliability.

**Conditional, not core**
Atlas baggage/seats only if promoted by an accepted scenario. Atlas `order.do` is Stretch and must not enter this lane until Checkpoint B passes.

**Tests**
`T-ADAPTER`; LIVE/REPLAY normalization equivalence; failure path.

**Qoder profile**
GLM-5.3 High for Atlas/provider logic; Kimi-K2.7-Code for straightforward adapter plumbing/tests. Use a bounded investigator rather than rewriting interfaces when provider behavior surprises us.

#### Lane D — Model Studio intelligence and research

**Primary owner paths**
Expected `ai/`, `planner/`; no state mutation or authority logic.

**D1 — Model Studio client + structured-output boundary**
- runtime client/config;
- cheap model default for plumbing;
- schema validation;
- timeout/error/retry policy appropriate for non-transactional inference;
- saved outputs/replay where useful for tests.

**D2 — Semantic mapping, preferences, and web research**
- objective/intent interpretation;
- latent preference inference as soft candidate;
- uncertainty identification;
- sourced web research for immigration/local context;
- authoritative-source requirement for legal/entry facts.

**D3 — RecoveryPlanner**
Input: Trip snapshot/subgraph, ImpactAssessment, hard/soft objectives, uncertainty, preferences, authority context, capability registry, prior tool/action results.

Output: tool/information requests plus structured `RecoveryStrategy[]`; no direct side effects.

Planner may iterate after capability results. Deterministic engine decides viability; planner/ranker uses evaluator evidence for soft comparison.

**Acceptance for lane**
Malformed output fails safely; explicit instruction overrides latent preference; planner can generate multiple structured strategies/tool needs without asserting unperformed deterministic checks.

**Tests**
`T-AI`; saved outputs preferred for routine deterministic test runs.

**Qoder profile**
Implementation: Kimi-K2.7-Code / Qwen3.8-Max Medium / GLM-5.3 High depending complexity. Prompt/contract design remains lead-owned. Runtime Model Studio model quality is not a rabbit hole: upgrade only after the integrated loop proves the cheap model is materially blocking behavior.

#### Lane E — Operator and traveller experience

**Primary owner paths**
Expected web app routes/components/read-model client only.

This lane is intentionally user-down.

**E1 — User journeys and state inventory**
Before polishing components, encode the required visible states:
- operator: ready / at risk / disrupted, what changed, blast radius in human language, system activity, approval required, uncertainty, traveller response, resolution/audit;
- traveller: am I okay, what changed, what matters, what system is doing, what input is needed, whether remainder is viable.

Use F2 typed read-model fixtures. Do not expose graph/constraint/agent jargon in primary user copy.

**E2 — Core screens/interactions**
- role-neutral operator dashboard;
- trip/case detail;
- mobile-friendly traveller trip page/conversation;
- traveller decision/approval interaction;
- clear disrupted -> recovering -> resolved visual transition;
- loading/error/unknown states.

**E3 — Real read-model wiring**
Do not independently invent backend endpoints. Wiring to actual application services occurs during integration with the integrator, after those services exist.

**Acceptance for lane**
UI can switch from typed fixtures to real read models without information-architecture redesign.

**Tests**
Component/interaction tests justified by stack plus browser smoke journeys where practical.

**Qoder profile**
Kimi-K2.7-Code or Qwen3.8-Max Medium for bounded UI implementation. Use a vision-capable model only if it materially improves UI iteration. UI may delegate isolated components cheaply.

---

#### Integration — one lead worktree, incremental seams

Integration is not a sixth parallel lane. Start integrating stable outputs as they become available rather than waiting for every lane to reach maximum polish.

**I1 — Ingestion -> validated persistent Trip**
B + A1. A source/profile can produce validated proposals that create/update persistent state and audit evidence.

**I2 — TripSignal -> mutation -> ImpactAssessment**
A1 + A2. Inject a disruption through the normalized signal path and produce the expected blast radius.

**I3 — Impact -> planner -> capability -> scenarios -> viability**
A2/A3 + C + D. Planner requests Atlas/local context, receives normalized results, proposes strategies, and deterministic overlays establish viability.

**I4 — Viable strategy -> authority -> action/simulation -> observation -> resolution**
A4 + adapter boundary. Traveller/organisation approval path works; unsupported transaction uses provider simulation; observed result updates state and case.

**I5 — Real read models -> operator/traveller UI**
E uses application projections from the integrated case. No bespoke demo JSON remains behind the main flow.

**Integration verification**
Reuse lane tests. Add seam tests only for newly interacting behavior. Run one end-to-end Scenario A path in replay plus one development LIVE Atlas Search/Verify proof.

#### Checkpoint B gate

Checkpoint B passes when:
- Scenario A executes I1–I5 without manual state edits;
- Atlas Search/Verify/rules have real adapter evidence and replay through same path;
- external failure/simulation boundaries are explicit;
- UI shows actual state transitions;
- authority cannot be bypassed;
- a restart/reload does not lose critical Trip/Case state;
- no Stretch work is needed to make the loop valid.

No separate independent review is required by default here. If integration exposes a material architecture mismatch, resolve it before proceeding and record the decision. High-risk additions such as real `order.do` warrant their own targeted review.

---

### Checkpoint C — Generalisation, reliability, and demo candidate

**Product outcome:** the same engine proves a second materially different scenario, the main flow is reliable under replay/failure conditions, and the repository is ready to become the submission candidate.

#### G1 — Scenario B substitution

Run the corporate/TMC-style scenario using the same application code.

Allowed differences:
- data/config;
- source documents/webpages;
- traveller/organisation/AnchorEvent values;
- policies/approval rules;
- provider-shaped fixture/replay responses.

Forbidden:
- scenario-specific code branches;
- new entity types added only for Scenario B;
- hardcoded cities, traveller names, fixture IDs or routes in domain/recovery logic.

If Scenario B exposes a genuine missing abstraction, classify **Act Now: architecture gap**, fix the shared model generically, and rerun affected tests.

#### G2 — High-value robustness tests

Do not implement every imagined edge case. Select the smallest set that proves the engine abstractions:

Minimum recommended:
1. late arrival vs hotel/reception/no-show constraint;
2. public transport cutoff with flexible taxi/private-transfer recovery;
3. accessibility requirement invalidates an otherwise cheaper alternative;
4. already-lost objective produces `RECOVERED_WITH_LOSS` while remaining objectives recover.

Add onward rail/ferry, shared-resource cascade, visa/immigration buffer, or separately booked downstream leg only when they strengthen proof without destabilising the core.

#### G3 — Hardcoding/generalisation audit

Search domain/recovery/application code for:
- demo event/traveller names;
- specific cities/airports/routes;
- fixture IDs;
- supplier-specific conditions outside provider adapters;
- scenario-specific if/switch branches;
- constants that should be source/config/rule data.

Any exception must be justified as provider-adapter behavior or generic configuration.

#### R1 — Reliability and replay

- deterministic demo reset/reseed;
- stable sanitized recordings;
- Model Studio/provider unavailable paths;
- Google unavailable path;
- persistence restart;
- audit trail from signal to outcome;
- no secrets or unsafe personal/provider raw data;
- UI unknown/error/loading states;
- README/environment/demo docs accurately label LIVE vs RECORD/REPLAY vs simulated.

#### Checkpoint C gate

Passes when:
- Scenario A full replay works reliably;
- Scenario B passes through same engine without source-code changes;
- selected robustness tests pass;
- hardcoding audit passes;
- reset/reseed and restart work;
- roadmap accurately reflects anything cut, stretched, deferred, blocked, or implemented.

At this point the integrated branch is the **demo candidate**.

---

## 4. Final candidate gate

This is the one planned independent review checkpoint.

### Reviewer scope
Review the exact integrated candidate, not each historical lane. Prefer a different model family from the primary integrator.

Challenge:
- deterministic state mutation and viability;
- authority/irreversible-action gates;
- provider boundary correctness;
- LIVE/RECORD/REPLAY equivalence;
- persistence;
- policy/constraint enforcement;
- AI schema boundaries;
- demo-specific hardcoding;
- user-facing claims versus what is actually implemented.

Every finding is classified:
`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

Only Act Now findings that block demo truth/correctness/safety must be fixed before the candidate is accepted. Use targeted proof for fixes.

### Canonical release verification
Run on the exact final candidate SHA:
- build;
- typecheck;
- lint;
- full automated test suite appropriate to the chosen stack;
- Scenario A E2E/replay;
- Scenario B generalisation test;
- hardcoding search/audit;
- reset/reseed;
- persistence restart;
- provider/model fallback smoke tests;
- secret/recording review.

Do not make paid/live provider calls part of routine final replay unless specifically needed to prove a claim.

## 5. Master execution tracker

This table is the execution status SSOT. Update it as work moves; do not create competing active implementation plans.

| ID | Work package | Status | Depends on | Default Quest/worktree | Recommended Qoder profile | Evidence / commit |
|---|---|---|---|---|---|---|
| F0 | Stack + skeleton + file map | Not Started | — | lead/foundation | GLM-5.3 High / Performance | — |
| F1 | Domain + operational contracts | Not Started | F0 | lead/foundation | GLM-5.3 High | — |
| F2 | Shared service/capability/read-model contracts | Not Started | F0,F1 | lead/foundation | GLM-5.3 High | — |
| F3 | Acceptance scenario specs | Not Started | F1,F2 | lead/foundation | lead / GLM-5.3 High | — |
| A1 | Persistence + validated mutation | Not Started | F1,F2 | core | GLM-5.3 High | — |
| A2 | Constraints + blast radius | Not Started | A1,F3 | core | GLM-5.3 High/Max | — |
| A3 | Scenario overlays + viability | Not Started | A2 | core | GLM-5.3 High | — |
| A4 | Case + authority + observation | Not Started | A1,A2,F2 | core | GLM-5.3 High | — |
| B1 | Source/provenance framework | Not Started | F1,F2 | ingestion | Kimi-K2.7 / Qwen3.8 Medium | — |
| B2 | Web/document/policy/insurance ingestion | Not Started | B1 | ingestion | Kimi-K2.7 / Qwen3.8 Medium | — |
| B3 | Traveller/research context normalization | Not Started | B1,D1 | ingestion | Qwen3.8 Medium / GLM High | — |
| C1 | Provider modes + recording/error envelope | Not Started | F2 | providers | Kimi-K2.7 / GLM High | — |
| C2 | Atlas Search/Verify/rules | Not Started | C1 | providers | GLM-5.3 High | — |
| C3 | Google Routes optional adapter | Not Started | C1 | providers | Kimi-K2.7 / Qwen3.7-Plus | — |
| D1 | Model Studio structured client | Not Started | F1,F2 | intelligence | Kimi-K2.7 / Qwen3.8 Medium | — |
| D2 | Semantic prefs + web research | Not Started | D1,F3 | intelligence | Qwen3.8 Medium / GLM High | — |
| D3 | RecoveryPlanner | Not Started | D1,A2,F2,F3 | intelligence | GLM-5.3 High / Qwen3.8 xHigh only if tightly constrained | — |
| E1 | User journeys + state fixtures | Not Started | F2,F3 | ui | Kimi-K2.7 / Qwen3.8 Medium | — |
| E2 | Operator + traveller UI | Not Started | E1 | ui | Kimi-K2.7 / Qwen3.8 Medium | — |
| I1–I5 | Vertical integration | Not Started | lane outputs as noted | integrator | GLM-5.3 High/Max; Kimi-K3 High if broad | — |
| G1 | Scenario B substitution | Not Started | Checkpoint B | integrator | existing integrator | — |
| G2 | Selected robustness | Not Started | Checkpoint B | integrator/core | task-dependent | — |
| G3 | Hardcoding audit | Not Started | G1 | independent/bounded | DeepSeek Flash / Qwen3.7-Plus | — |
| R1 | Reliability/replay/demo candidate | Not Started | Checkpoint B | integrator | GLM-5.3 High | — |
| FINAL | Candidate review + release gate | Not Started | Checkpoint C | fresh reviewer | different family / high-capability | — |

Statuses: `Not Started | In Progress | Blocked | Implemented | Integrated | Complete | Dropped`.

`Implemented` means a lane has finished and verified its package. `Integrated` means its behavior is merged and seam-tested in the candidate. `Complete` means the relevant checkpoint acceptance gate has passed.

## 5.1 Requirement and test traceability

This matrix prevents a Quest from treating a work package as a vague feature label. It is the minimum traceability; task-specific Specs may add narrower tests but may not delete required evidence.

| Package | Primary requirements | Required evidence |
|---|---|---|
| F0 | NFR-03, NFR-05 | runnable/no-credential smoke, SQLite round trip, baseline commands |
| F1 | FR-01, FR-03–FR-06, FR-09–FR-11, FR-14; NFR-01, NFR-02, NFR-04 | `T-DOM` |
| F2 | FR-07, FR-08, FR-10–FR-16 | compile/runtime contract tests; relevant `T-DOM` |
| F3 | NFR-01, NFR-02 | scenario schema-load assertions |
| A1 | FR-01, FR-04, FR-14; NFR-04, NFR-05 | `T-PERSIST`, mutation subset of `T-PROP` |
| A2 | FR-05, FR-06 | `T-EVAL`, `T-PROP` |
| A3 | FR-09; NFR-04 | `T-OVERLAY` |
| A4 | FR-10, FR-11 | `T-AUTH` + case transition tests |
| B1 | FR-02, FR-03, FR-14 | ingestion/source contract tests + relevant `T-DOM` |
| B2 | FR-02, FR-18 | extraction/schema/evidence tests + relevant `T-AI` |
| B3 | FR-03, FR-17 | `T-AI` preference/research assertions |
| C1 | FR-08, FR-15; NFR-03, NFR-05 | `T-ADAPTER` mode/error/sanitization tests |
| C2 | FR-08 | Atlas `T-ADAPTER` + one LIVE Search/Verify development proof |
| C3 | FR-16; NFR-03 | routing `T-ADAPTER` + no-credential failure path |
| D1 | FR-07; NFR-04 | `T-AI` schema/error boundary |
| D2 | FR-03, FR-17 | `T-AI` semantics/preference/research |
| D3 | FR-07; NFR-04 | `T-AI` planner strategies/tool requests |
| E1–E2 | FR-12, FR-13 | typed-fixture UI state/interaction evidence |
| I1–I5 | FR-01–FR-18 as used by Scenario A; NFR-03–NFR-06 | seam tests + `T-E2E` |
| G1 | NFR-01, NFR-02 | `T-GEN` Scenario B |
| G2 | FR-05, FR-06, FR-09–FR-11 as exercised | selected `T-EVAL/T-PROP/T-OVERLAY/T-AUTH` |
| G3 | NFR-02 | hardcoding portion of `T-GEN` |
| R1 | FR-14, FR-15; NFR-03, NFR-05, NFR-06 | `T-PERSIST`, fallback `T-ADAPTER/T-AI`, replay E2E |
| FINAL | all implemented MVP requirements | `T-RELEASE` |

## 6. File ownership and collision control

F0 must replace the provisional paths below with exact paths once the stack is chosen.

| Area | Primary owner | Other lanes may | Must not |
|---|---|---|---|
| shared schemas/contracts | Foundation/lead | import/use | modify after freeze without lead change |
| domain/engine/cases/persistence | Lane A | call public interfaces | add provider/UI/prompt logic |
| ingestion/sources | Lane B | produce shared contracts | mutate Trip directly |
| providers/recording | Lane C | consume capability contracts | add trip-recovery policy |
| ai/planner | Lane D | consume snapshots/evaluator evidence | mutate state or approve/execute actions |
| web UI | Lane E | consume read models/application APIs | redefine domain DTOs |
| application/orchestration seams | Integrator/lead | report mismatch | parallel lanes editing independently |
| scenarios/fixtures | Lead owns semantics; lanes may add scoped data | use for tests | embed fixture facts into production logic |
| architecture/roadmap/implementation SSOT | Lead/integrator | propose updates | silently change scope/contract |

Parallel lanes should not share uncommitted local state. If two packages need the same implementation file, they are not independent until the overlap is resolved.

## 7. Dependency and parallelisation map

```text
F0 Stack/File Map
  └─> F1 Domain Contracts
       └─> F2 Shared Interfaces
            └─> F3 Scenario Contracts
                 |
                 +---------------------------+
                 |        PARALLEL           |
                 v                           v
          Lane A Core                 Lane E UI
          A1 -> A2 -> A3              E1 -> E2
           \      \                   /
            \      +-> A4            /
             \                     /
              +-------------------+
                 Lane B Ingestion
                 B1 -> B2
                  \ -> B3 <--- D1
                 Lane C Providers
                 C1 -> C2
                  \ -> C3
                 Lane D Intelligence
                 D1 -> D2
                  \ -> D3 (needs A2 contract/evidence shape)
                 |
                 +-----------+
                             v
                  Integrator I1 -> I2 -> I3 -> I4 -> I5
                             |
                             v
                       Checkpoint B
                         /       \
                        v         v
                       G1        R1
                        \        /
                         -> G2/G3
                             |
                             v
                       Checkpoint C
                             |
                             v
                         FINAL gate
```

Do not over-read the arrows: D1, C1, B1 and E1 can begin as soon as their frozen dependencies exist; they need not wait for A1/A2. Integration should begin incrementally when seam pairs are stable.

## 8. Work-package execution contract

Every Qoder Quest/implementation prompt generated from this plan must specify:

1. **ID and objective** — exact work package from Section 5.
2. **Branch/worktree/head** — explicit orchestration boundary.
3. **Authoritative inputs** — exact docs/contracts and current code sections.
4. **Requirements** — relevant `FR-*` / `NFR-*` IDs from `PRODUCT_SPEC.md`.
5. **Owned paths** — exact paths the lane may change.
6. **Do-not-touch paths/contracts** — especially frozen shared contracts.
7. **Dependencies assumed complete** — commit/head evidence.
8. **Required behavior** — including error/UNKNOWN/fallback behavior.
9. **Acceptance criteria** — observable, testable outcomes.
10. **Scoped verification** — exact `T-*` test categories plus commands once F0 defines them.
11. **Explicit exclusions** — stretch/deferred/non-lane work.
12. **Delegation guidance** — delegate only bounded, independently checkable subtasks; primary retains architecture, integration decisions, high-risk work, and final verification.
13. **Completion report** — format below.

A Qoder-generated Spec may elaborate implementation tasks, but if it contradicts this plan/architecture it must be corrected before Build.

### Completion report / handoff

Every implemented package reports:
- branch/worktree and exact head;
- work-package ID(s);
- plain-English behavior now working;
- files changed;
- tests/checks actually run and results;
- failure/fallback behavior verified;
- unexpected findings/issues with triage;
- architecture/roadmap/docs changed, if any;
- commit SHA;
- exact next dependent package/integration action.

Do not pad the handoff by repeating the plan.

## 9. Integration and Git discipline

- Prefer exact-path staging.
- Lane commits should be coherent/testable checkpoints.
- Integrator verifies actual branch heads and intended merge order before combining work.
- Reuse valid lane evidence; rerun only invalidated checks and seam tests.
- Do not mechanically resolve overlapping-file conflicts.
- Update this tracker and `ROADMAP.md` when implementation/scope status changes.
- Record settled architecture changes in `DECISIONS.md`.
- Keep README high-level; implementation detail belongs here/architecture/testing/environment docs.

## 10. Scope cut order

If capacity tightens, cut breadth before the generalized vertical loop.

### Protect
1. typed persistent trip/state model and validated mutation;
2. deterministic constraints + blast radius;
3. scenario overlays + deterministic viability;
4. RecoveryPlanner structured loop;
5. deterministic authority/action boundary;
6. Atlas Search/Verify/rules;
7. real operator/traveller read-model flow;
8. Record/Replay reliability;
9. second-scenario generalisation test.

### Cut/degrade first
1. Atlas seats/baggage unless main scenario needs them;
2. Google LIVE routing — retain adapter/replay/sourced fallback;
3. extra robustness scenarios beyond the selected minimum;
4. rich insurance/immigration interpretation beyond what proves data-driven rules/uncertainty;
5. secondary visual polish not required for narrative clarity.

### Never promote to critical path before Checkpoint B
- Booking.com;
- Atlas `order.do` / ticketing;
- Gmail watch/OAuth;
- Timatic;
- real ridehail/rail/ferry transactions;
- additional GDS/NDC providers;
- insurance claims;
- Slack/WhatsApp integrations.

Anything intentionally cut must remain in `ROADMAP.md` with status/reason/revisit condition.

## 11. Bounded investigations

Investigations run separately and never block the core unless their decision explicitly promotes a capability into MVP.

### X1 — Atlas Singapore sandbox
Question: can Atlas/hackathon staff enable a useful SIN sandbox route for this account?
Output: yes/no/unknown + evidence/contact action.
Decision rule: use if available without domain changes; otherwise continue with existing sandbox/replay.

### X2 — Booking.com Demand
Question: can valid Managed Affiliate/sandbox credentials be obtained immediately enough to implement/test without commercial onboarding delay?
Output: access requirements, credential status, minimal viable endpoints.
Decision rule: adopt only if access is already practical; otherwise keep Stretch and stop.

### X3 — Google Routes setup
Question: can project key/billing/API be configured cleanly?
Decision rule: configure if easy; otherwise C3 still ships with replay/fallback and no core block.

### X4 — Atlas order execution
Start only after Checkpoint B.
Question: can sandbox `order.do` and observation be exercised safely with current account/activation and existing authority/executor boundary?
Decision rule: promote to Stretch implementation only if bounded and safe. Do not chase ticketing/account activation at the expense of the core.

Every investigation ends with `Adopt Now | Keep Stretch | Defer | Reject`, evidence, and a roadmap update if status changes.

## 12. What happens first

The next Qoder task is **F0–F3 as one Foundation/Contract Quest**, because the repository is empty and these packages share the same unresolved stack/schema boundary. Do not split them across parallel agents.

That Quest should:
1. inspect the current planning docs and Atlas capability reports;
2. propose the minimal stack/repo structure;
3. encode the shared contracts;
4. create scenario acceptance specifications;
5. run the contract/schema/smoke checks;
6. update `PROJECT_FILE_MAP.md`, this plan's exact path ownership, and any architecture decision actually changed;
7. stop for lead/user contract-freeze acceptance.

Only after that acceptance should the five implementation lanes be launched in parallel.
