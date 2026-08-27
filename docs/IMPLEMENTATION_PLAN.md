# Implementation Plan

**Status:** Active execution SSOT. Checkpoint A accepted (REV-A Complete; closure commit pinned as the accepted fan-out base); **Checkpoint B accepted (REV-B Complete)**; **Checkpoint C accepted (REV-C Complete; accepted SHA `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d` is the demo candidate / baseline)**. A Reality Validation milestone is intentionally added before Final Candidate preparation.  
**Post-NS-G3 closure path:** the original NS-G3 candidate (Section "WAVE 3 — Integrated Northstar Product → NS-G3 → Stretch pull decision" below) is **NOT ACCEPTED**, superseded by the stricter **Wave 3R Demo Readiness closure** — see `docs/WAVE3R_DEMO_READINESS_PLAN.md` (subordinate to this document; governs Wave 3R execution/work-package detail). RV-N0, NS-G1, NS-G2, and Independent Review 2 remain accepted and are not reopened by Wave 3R.  
**Product:** Northstar (hackathon face) — generalized AI Trip Recovery / Resolution Layer  
**Execution environment:** Qoder by default  
**Agent-routing authority:** `docs/AGENT_MODEL_SELECTION.md`

This is the **parent** execution SSOT for the hackathon build. Qoder Quest Specs and Agent-mode prompts are bounded execution contracts derived from this plan. They may add implementation detail but must not silently redefine product scope, architecture, shared contracts, or acceptance criteria.

**Cadence note:** several subordinate plans were spawned after Checkpoint C
(Northstar waves, Wave 3R, AiT LIVE scenario readiness, Final Demo Integration).
Capability status lives in [`docs/ROADMAP.md`](ROADMAP.md) (see **Current
cadence**). Do not assume the paragraph below is still the human-facing tip of
the repo.

**Current product-closure runway:** [`docs/FINAL_DEMO_INTEGRATION_PLAN.md`](FINAL_DEMO_INTEGRATION_PLAN.md)
— **R3D accepted; R3E next** (then R4 → Final Candidate → freeze → submit).
It is subordinate to this document and does not reopen accepted architecture.

**Prior backend readiness package (complete as SEMANTIC READY):** AiT LIVE
Scenario Backend Readiness — S1–S8 through ordinary product boundaries on
REPLAY; LIVE/RECORD still credential-gated. Tracker:
[`docs/LIVE_SCENARIO_READINESS.md`](LIVE_SCENARIO_READINESS.md). Historical
integration line referenced `wave3r/live-scenario-readiness` /
`wave3r/live-integration` from checkpoint
`70447bd3f01d1f3219141216a2b822f2c3edc5d1`.

Read with:
- `docs/PRODUCT_SPEC.md` — product requirements (`FR-*`, `NFR-*`)
- `docs/ARCHITECTURE.md` — logical architecture and invariants
- `docs/ROADMAP.md` — product scope/status, including Stretch/Deferred
- `docs/TESTING.md` — verification taxonomy (`T-*`) and detailed review-gate scope
- `docs/DECISIONS.md` — settled architecture decisions
- `docs/AGENT_MODEL_SELECTION.md` — model/interface/reviewer routing
- `.qoder/rules/environment-recovery.md` — terminal/tool recovery

## 1. Build objective and completion definition

Build the smallest generalized system that demonstrates the real internal loop:

`source/profile -> validated trip state -> TripSignal -> deterministic mutation -> blast radius -> recovery planning -> capability queries -> scenario overlays -> deterministic viability -> authority -> provider action/simulation -> observation -> updated state -> resolved case`

The MVP is complete only when all are true:

1. one full recovery case runs through the real internal pipeline without manual state edits between stages;
2. Atlas Search, Verify, and relevant fare/rule normalization have been exercised LIVE at least once and can be replayed through the identical adapter/normalizer path;
3. unsupported external transactions are simulated only at provider boundaries;
4. operator and traveller interfaces consume actual application read models rather than bespoke demo JSON;
5. a second materially different scenario runs through the same application code with only data/config/source changes;
6. deterministic viability and authority gates cannot be bypassed by model output;
7. Trip/RecoveryCase state survives local restart/reload;
8. the demo candidate can reset/reseed and replay reliably without depending on live paid APIs/models.

## 2. Execution principles

### 2.1 Parallelise implementation, not unresolved architecture

Shared contracts are frozen first. After that, independent lanes use separate branches/worktrees. A lane consumes shared contracts; it does not change them merely to make local implementation easier.

If repository reality proves a frozen contract wrong, classify an **architecture gap**. The lead/integrator changes the shared contract deliberately and reconciles affected lanes. Never hide an architecture change inside a provider adapter, UI patch, fixture, or scenario-specific branch.

### 2.2 Verification is cumulative evidence

Do not review/test the whole repository after every work package.

- **Package implementation:** narrowest tests/checks proving changed behavior and relevant failure paths.
- **Integration:** reuse valid lane evidence; test new seams/conflict resolutions plus checkpoint acceptance flow.
- **Formal checkpoint review:** independent review is mandatory at **Checkpoint A, Checkpoint B, Checkpoint C, and Final Candidate**. Scope is proportional to the risk at that stage; reviewers inspect the actual candidate SHA/evidence rather than trusting the implementer report.
- **Exceptional review between checkpoints:** add a targeted independent review only for evidence-backed material architecture/shared-contract changes, meaningful irreversible/provider-money risk, destructive persistence/auth/security risk, or integration evidence suggesting correlated blind spots.
- **Final candidate:** broad canonical build/typecheck/lint/test/generalisation/replay/secret gate on the exact SHA.

Every review finding is triaged `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

A formal checkpoint passes only when there are no unresolved **Act Now** findings and no unresolved **Investigate Now** finding that threatens that checkpoint's acceptance criteria. Parked/accepted hackathon risks do not block progress.

A targeted review fix needs targeted proof that the finding is closed. It does not restart the entire review cycle automatically.

Detailed review scope lives in `docs/TESTING.md`. Reviewer-model choice follows `docs/AGENT_MODEL_SELECTION.md`; this plan defines **when review is required and what gate it protects**, not a duplicate model ranking.

### 2.3 Price-aware capability-first model routing

Follow `docs/AGENT_MODEL_SELECTION.md`; it is the routing authority if any shorthand below becomes stale.

The rule is **not** "use the strongest model available." Use the cheapest model likely to complete and verify the task with low rework, then pay for a specialist only when the task shape justifies it.

Current working hierarchy:

- **Qwen3.8-Max Medium/xHigh:** default substantial Qoder implementation and integration. During the published off-peak window it is especially strong value.
- **Qwen3.7-Max:** first long-horizon/value experiment, especially for overnight/off-peak autonomous runs with frozen contracts and objective acceptance tests.
- **Qwen3.7-Plus:** bounded delegation/tests/fixtures/simple components and repetitive work after semantics freeze.
- **Kimi-K2.7-Code:** focused implementation or routine different-family review without paying premium-model rates.
- **DeepSeek-V4-Flash:** cheap different-family review/second opinion. Prefer Flash or Kimi-K2.7-Code before V4 Pro for ordinary review.
- **GLM-5.3 High/Max:** hard deterministic/provider/runtime debugging and difficult integration seams. Use because its engineering/debugging profile is useful, not because a task merely looks important.
- **Kimi-K3 High/Max:** premium long-horizon/large-context experiment. Use when endurance/context retention is the hypothesis being tested; do not route routine work to K3 at ~0.8x.
- **DeepSeek-V4-Pro High/Max:** premium adversarial reasoning specialist only when a concrete hard disagreement/debugging/review need remains. It is **not** the routine reviewer.
- **External GPT-5.6 Sol / Claude Opus 5:** architecture, architecture-gap resolution, and consequential independent review when a ceiling model is justified.

Current published pricing makes these distinctions material. During Qwen3.8 off-peak (~0.25x), GLM-5.3 (~0.6x) costs roughly 2.4x as much and Kimi-K3 / DeepSeek-V4-Pro (~0.8x) roughly 3.2x as much. Qwen3.7-Max and Plus can be cheaper still off-peak. Confirm live rates in Qoder `/model` before a pricing-sensitive run.

Qwen3.8-Max has previously needed handholding and can hardcode when scope is vague. Mitigate with exact package IDs, owned paths, frozen contracts, anti-hardcoding rules, scenario substitution tests, and hard-stop rules rather than avoiding Qwen entirely.

#### Long-horizon model experiment

We want our own repository evidence rather than relying only on public benchmarks.

For substantial, testable autonomous packages, compare in this order where practical:
1. **Qwen3.7-Max off-peak** — value/endurance baseline;
2. **Qwen3.8-Max xHigh** — stronger Qwen baseline;
3. **Kimi-K3 High/Max** — premium endurance/context comparison after the Qwen baselines;
4. **GLM-5.3** only when the package is debugging/integration-heavy enough to test its specialist hypothesis.

Track completion without intervention, test evidence, hardcoding/architecture drift, reviewer findings, human steering, wall-clock time, Credits consumed, and final rework. Do not call materially different tasks a controlled benchmark.

Runtime Alibaba Model Studio model choice is separate. Start cheap for plumbing and upgrade only if output quality is demonstrably blocking the integrated loop.

### 2.4 Long-horizon interface strategy

We want the user involved mainly at **Checkpoint A, Checkpoint B, Checkpoint C, and Final Candidate**, not throughout routine coding.

#### JetBrains + Qoder Agent Mode — preferred stable long-horizon surface

Use JetBrains Agent Mode for:
- Foundation F0–F3 as one long run;
- one complete sequential lane after contract freeze;
- the integration worktree;
- difficult interactive debugging where a stable IDE terminal helps.

Do not assume the JetBrains plugin supports native multi-lane orchestration unless the installed version explicitly exposes it.

#### Parallelism — Git worktrees are the isolation primitive

After Checkpoint A:
- create one branch/worktree per meaningful lane;
- if using JetBrains, open each worktree in a separate IDE window with one Agent Mode session;
- all lane branches fan out from the same accepted Checkpoint A SHA;
- integration uses its own worktree and deliberately consumes lane commits;
- lanes must not independently merge themselves into `main` while seams are unverified.

Default topology:
- `lane/core`
- `lane/ingestion`
- `lane/providers`
- `lane/intelligence`
- `lane/ui`
- `integration/vertical-loop`

#### Quest / Qoder IDE

Quest Worktree execution is a strong native option when available/stable. Qoder supports Worktree environments for parallel tasks in one repo. A Quest-generated Spec remains subordinate to this plan.

#### CLI

Qoder CLI supports `--worktree`, parallel sessions, background/Subagents, `/goal`, and beta Agent Teams. Use these opportunistically for scheduled/background/parallel work.

Because CLI has shown permission/shell instability for this project, **do not make it the sole critical-path orchestrator**. If CLI tooling is the problem, preserve the same branch/worktree and resume in JetBrains Agent Mode rather than changing implementation scope or source code.

### 2.5 Checkpoint autonomy protocol

Between accepted checkpoints, the agent should continue autonomously and make ordinary implementation choices itself.

The agent may decide without asking the user:
- internal library/module/file organization within frozen architecture/ownership;
- ordinary implementation details that do not alter product scope/shared contracts;
- tests/fixtures consistent with accepted scenarios;
- bounded bug fixes needed for the assigned package;
- approved fallback/replay behavior;
- bounded delegation/subagents;
- whether to continue independent work while a non-critical provider/investigation is unavailable;
- small UI/layout/copy implementation details consistent with the user journeys.

**Hard stop before the formal checkpoint only when:**
1. a frozen shared contract/product requirement must materially change;
2. the ontology cannot express a required scenario without a new generic abstraction;
3. an unapproved irreversible/money-moving external action is required;
4. a new credential/account/manual user action is genuinely required for critical-path work and no fallback exists;
5. a destructive Git/data operation outside the approved worktree workflow is required;
6. a critical provider/runtime blocker has no approved replay/fallback;
7. environment/tool failure persists after `.qoder/rules/environment-recovery.md`;
8. two plausible choices would materially change product behavior/scope and the SSOT does not resolve the choice.

Do **not** stop for routine naming, library, styling, file layout, terminal resets, tests, bounded refactors, or implementation details that fit the frozen contracts.

If one package is blocked, triage it and continue independent work where possible. Do not sit idle waiting for optional APIs or user input.

### 2.6 Environment/tool recovery is part of execution

Follow `.qoder/rules/environment-recovery.md`.

Key rule: **terminal/tool failure is not evidence application code is wrong.**

- stale JetBrains terminal -> confirm worktree/cwd, reset/reopen terminal, retry before editing source;
- CLI `permission denied` -> inspect file mode/shebang/invocation; prefer explicit interpreter/package-manager invocation when appropriate;
- use `chmod +x` only when executable bit is genuinely intended;
- do not automatically use `--yolo` or weaken safety controls;
- after a reset/retry plus one distinct safe attempt, switch execution surface if practical;
- if still critical-path blocked, capture evidence and trigger the hard stop instead of looping indefinitely.

### 2.7 External dependency posture

Mocks/replay belong only at external provider/action boundaries. The internal ingestion/mutation/impact/planning/viability/authority/case pipeline remains real.

Optional services must not block core delivery:
- Google Routes may use live, recorded, sourced, or UNKNOWN context;
- Booking.com remains Stretch unless access is immediately practical;
- Atlas Singapore fixture availability may improve the demo but must not shape domain logic; (Northstar update: do not wait for Atlas to provision special SIN data — location is wherever provider reality gives the strongest demo; see Section 13.)
- Atlas state-changing order execution remains Stretch until the read-only Search/Verify loop and authority/executor boundary are stable.

## 3. Build checkpoints

There are **three build checkpoints plus one final candidate gate**. Each has a mandatory independent review gate before acceptance. Work packages below are execution units, not extra milestones.

# Checkpoint A — Contracts and runnable foundation

**Outcome:** one runnable application skeleton plus frozen shared contracts that every parallel lane can implement against.

Run **F0–F3 as one long-horizon Foundation/Contract session**. This is intentionally not parallel because the stack/schema/service seams are coupled.

Preferred interface: JetBrains Qoder Agent Mode if stable; Quest is also suitable. CLI `/goal` is optional.

Recommended model for equivalent future foundation/contract work: Qwen3.8-Max xHigh first; Qwen3.7-Max is the long-horizon/value alternative. Kimi-K3 is a later controlled long-horizon comparison, not an automatic premium default. GLM-5.3 is for hard debugging/integration rather than routine foundation work.

## F0 — Stack, skeleton, baseline commands, ownership map

**Objective:** choose the smallest practical stack and create the package/file skeleton needed for independent lanes.

Recommended starting point unless evidence disproves it:
- TypeScript end-to-end;
- single web application plus internal modules/packages, not services;
- runtime validation with Zod/equivalent at external/model boundaries;
- SQLite behind repository interfaces;
- lightweight test runner/build/lint/typecheck tooling.

**Outputs:**
- runnable app skeleton;
- package manager/scripts;
- `test`, `typecheck`, `lint`, `build` commands as appropriate;
- environment/config loader;
- SQLite library + round-trip smoke test;
- adapter mode enum/config for `LIVE | RECORD | REPLAY`;
- `docs/architecture/PROJECT_FILE_MAP.md`;
- exact ownership paths replacing the provisional matrix in Section 6.

**Must not:** implement the recovery engine, introduce microservices/Neo4j/Kafka/etc., or choose infrastructure for presentation value.

**Acceptance:** clean install/run; app starts without Atlas/Google/Model Studio credentials in local/replay mode; SQLite smoke succeeds; lane package boundaries avoid routine file collisions.

**Evidence:** foundation smoke tests, baseline commands.

## F1 — Domain and operational contracts

Encode executable typed/runtime-validated schemas for:
- Organisation, Traveller, AnchorEvent, Trip, Place;
- TripElement (`TransportLeg`, `Stay`, `Engagement`);
- TripObjective, RuleSet, Constraint;
- fact provenance/freshness and preference precedence;
- TripSignal, MutationProposal, TripSnapshot, ImpactAssessment;
- RecoveryCase, RecoveryStrategy, ActionIntent, AuthorityDecision, ExecutionResult.

**Must prove:**
- required + flexible + unbooked transport is representable;
- PASS/FAIL/UNKNOWN are distinct;
- explicit preference/instruction outranks latent preference;
- fact authority/confidence/freshness are representable;
- `FULLY_RECOVERED` and `RECOVERED_WITH_LOSS` are representable;
- two accepted scenarios require no scenario-specific entity/edge type.

**Evidence:** `T-DOM`.

## F2 — Shared service/capability/persistence/read-model contracts

Freeze seams for:
- `TripRepository`, `CaseRepository`, `SourceRepository`, `AuditRepository`;
- `FlightCapability`, `RoutingCapability`, `HotelCapability`, `ResearchCapability`, `SourceIngestionCapability`;
- provider result/error envelope and `LIVE | RECORD | REPLAY` behavior;
- RecoveryPlanner input/output;
- operator/traveller read models;
- mutation, impact, planning, viability, authority, execution, observation application-service boundaries.

**Acceptance:** provider failure can be represented without crashing a Case; UI can compile against read models without graph internals; planner cannot emit an executable side effect outside `ActionIntent`.

**Evidence:** compile/runtime contract tests.

## F3 — Acceptance scenarios

Freeze two materially different scenario specifications before implementation.

### Scenario A — AnchorEvent / invited speaker
Minimum ingredients:
- AnchorEvent webpage/source context;
- traveller profile;
- flight;
- Stay;
- flexible local TransportLeg;
- preferred Engagement;
- hard event objective;
- organiser policy;
- one insurance policy;
- disruption;
- downstream impact;
- traveller reprioritisation;
- recovery action.

### Scenario B — Corporate/TMC-style trip
Must differ materially in:
- operator/governance;
- objective;
- policy/approval path;
- route/local context;
- supplier mix.

It must not be Scenario A with renamed data.

Each scenario defines expected pre-disruption state, TripSignal, blast-radius assertions, authority path, and resolution outcome.

**Acceptance:** both load against F1/F2 unchanged. If not, fix the generic architecture now.

**Evidence:** scenario schema-load assertions.

## Checkpoint A gate

Stop for checkpoint review only after:
- F0–F3 compile/load/pass their scoped checks;
- `PROJECT_FILE_MAP.md` exists;
- Section 6 has exact paths;
- the execution tracker records actual base SHA/evidence;
- architecture/decisions docs are reconciled for any material change;
- both scenarios fit without special-case application logic.

### Review Gate A — mandatory before fan-out

Independent review must inspect the **actual proposed fan-out SHA**, with focus on:
- runnable credential-free foundation;
- frozen domain/operational/service/capability/read-model contracts;
- deterministic/AI safety boundaries;
- timezone/freshness and authority semantics;
- two-scenario generality and anti-hardcoding;
- lane ownership/collision risk;
- whether contract tests prove the claims they make.

Checkpoint A passes only when Review Gate A passes. If review finds blocking issues, fix them on the shared-contract owner branch, run targeted closure evidence plus invalidated checks, and obtain targeted reviewer confirmation before fan-out. A docs-only reconciliation that does not alter reviewed contracts does not by itself invalidate code-review evidence.

**Review Gate A is closed (REV-A Complete).** Initial independent review passed; the follow-up static review found five blocking shared-contract defects and the targeted fix pass at `3592a0e` closed all five: epoch/instant timestamp comparison; read-only `ToolOperation` vocabulary; `AuthorisedExecution` + deterministic execution gate; `TripElement` default `UNKNOWN`; deliberate typed-field relation normalization (ADR-023..027). Closure evidence: 38/38 tests, typecheck/lint/build clean, credential-free REPLAY health smoke, anti-hardcoding scan clean; no unresolved `Act Now` or checkpoint-threatening `Investigate Now` findings remain. No further Checkpoint A review is required unless a frozen contract is subsequently changed.

After acceptance, shared contract changes become lead/integrator-owned cross-lane changes.

# Checkpoint B — Generalized vertical recovery loop

**Outcome:** Scenario A completes the real internal loop using real Atlas Search/Verify capability, provider-boundary simulation where required, and actual application UI read models.

After Checkpoint A, launch five isolated lane worktrees in parallel. Packages inside one lane normally run sequentially in the same long-horizon Agent/Quest session.

## Lane A — Core state, viability, case, authority

Recommended: **Qwen3.8-Max xHigh** as default. **Qwen3.7-Max** is the first long-horizon/value alternative. Use **GLM-5.3 High/Max** for genuinely difficult deterministic/state/viability debugging. Kimi-K3 is a controlled premium long-horizon comparison, not the normal owner.

### A1 — Persistence + validated mutation
- SQLite repositories;
- deterministic mutation consumes validated `MutationProposal` only;
- provenance/freshness/conflict resolution for critical facts;
- auditable mutation history.

**Acceptance:** invalid proposal cannot mutate; restart preserves Trip/Case; lower-authority/stale facts do not silently overwrite authoritative current facts.

**Evidence:** `T-PERSIST`, mutation subset of `T-PROP`.

### A2 — Constraint evaluators + blast radius
Implement generic primitives required by accepted scenarios/selected robustness tests:
- time/timezone arithmetic;
- duration/buffer envelopes;
- temporal/transfer/location/accessibility/policy/objective checks;
- dependency traversal;
- `ImpactAssessment`.

Do not build a universal rules platform.

**Acceptance:** hard objective failure records irreversible loss and propagation continues; downstream state becomes VALID/AT_RISK/INVALID/UNKNOWN based on evidence rather than blanket invalidation.

**Evidence:** `T-EVAL`, `T-PROP`.

### A3 — Scenario overlays + deterministic viability
- apply strategy mutations to isolated overlays;
- evaluate constraints/objectives on overlays;
- never mutate authoritative Trip;
- expose viability evidence to planner/ranker.

**Acceptance:** hard-infeasible candidate is rejected deterministically; soft tradeoffs remain rankable.

**Evidence:** `T-OVERLAY`.

### A4 — RecoveryCase + AuthorityEngine + observation loop
- Case lifecycle;
- `ActionIntent`;
- deterministic authority outputs;
- simulated executor boundary for unsupported transactions;
- observation -> state update -> verification/replan;
- `FULLY_RECOVERED | RECOVERED_WITH_LOSS`.

**Acceptance:** model cannot bypass authority; provider success alone does not resolve Case; observed viability determines closure.

**Evidence:** `T-AUTH`, Case transition tests.

## Lane B — Source/context ingestion

Recommended: **Qwen3.8-Max Medium/xHigh** for lane ownership; **Qwen3.7-Max** for a long autonomous value run; **Qwen3.7-Plus** or **Kimi-K2.7-Code** for bounded helpers/extraction plumbing.

### B1 — Source/provenance framework
- `SourceInput`;
- source identity/provenance/freshness;
- profile/manual structured inputs;
- deterministic mapping when source is already structured.

### B2 — Generic web/document/text extraction
Generic pipeline for:
- AnchorEvent webpage;
- booking confirmation/email/text/PDF supported by chosen stack;
- hotel/supplier policy;
- organisation/event policy;
- one insurance document.

Required flow:
`source -> extraction -> constrained schema -> evidence/uncertainty -> validated proposal/rules`

Never `source -> graph`.

### B3 — Traveller/dynamic context normalization
- explicit preference/instruction;
- latent preference candidate envelope;
- accessibility as requirement;
- entry/legal findings vs immigration-time operational estimates;
- research provenance/uncertainty.

**Lane acceptance:** changing source content changes normalized output without code changes; ambiguity/missing data becomes UNKNOWN/uncertainty rather than fabricated certainty.

**Evidence:** ingestion contract tests, relevant `T-DOM`, `T-AI`.

## Lane C — Travel capability adapters

Recommended: **Qwen3.8-Max** as default; **Qwen3.7-Max** for well-specified autonomous adapter work; **Kimi-K2.7-Code** for bounded adapter implementation. Escalate difficult Atlas/provider/runtime debugging to **GLM-5.3 High/Max** rather than redesigning interfaces.

### C1 — Provider base + LIVE/RECORD/REPLAY
- mode selection;
- sanitized recording store;
- provider error envelope;
- identical normalizer for LIVE and REPLAY;
- no secrets/unsafe raw data in recordings.

### C2 — Atlas direct adapter — mandatory
- `search.do`;
- `verify.do`;
- fare/change/refund/no-show rules needed by recovery;
- preserve Atlas workflow identifiers exactly;
- one successful LIVE Search/Verify development chain;
- routine tests use replay.

### C3 — Google Routes optional adapter
- `computeRoutes` when configured;
- normalized route/duration/traffic/transit context where supported;
- missing key/network -> structured unavailable/fallback, not app crash.

Google LIVE setup is non-blocking.

**Conditional:** Atlas baggage/seats only if an accepted scenario makes them relevant. `order.do` remains Stretch until Checkpoint B passes.

**Evidence:** `T-ADAPTER`, LIVE/REPLAY normalization equivalence, failure path.

## Lane D — Model Studio intelligence and research

Recommended implementation model: **Qwen3.8-Max** by default; **Qwen3.7-Max** for autonomous value runs; **Kimi-K2.7-Code** for bounded client/plumbing. Kimi-K3 is only justified if planner/research implementation genuinely becomes a broad-context long-horizon task. Runtime Model Studio starts with a cheap model.

### D1 — Model Studio structured client
- runtime config/client;
- structured-output/schema validation;
- timeout/error policy;
- saved/replayed outputs for routine tests where useful.

### D2 — Semantic interpretation / preferences / web research
- objective/intent interpretation;
- latent preference inference as soft signal;
- uncertainty identification;
- sourced web research for immigration/local context;
- authoritative-source requirement for legal/entry facts.

### D3 — RecoveryPlanner
Input:
- relevant Trip snapshot/subgraph;
- ImpactAssessment;
- hard/soft objectives;
- uncertainty;
- preference context;
- authority context;
- capability registry;
- prior tool/action results.

Output:
- missing-information/tool requests;
- structured `RecoveryStrategy[]`;
- assumptions/uncertainty;
- no direct side effects.

Planner may iterate after capability results. Deterministic engine decides viability; planner/ranker uses evaluator evidence for softer comparison.

**Lane acceptance:** malformed output fails safely; explicit instruction beats latent preference; multiple strategies/tool needs can be produced without claiming unperformed deterministic checks.

**Evidence:** `T-AI`.

## Lane E — Operator/traveller UI

Recommended: **Qwen3.8-Max Medium** for lane ownership; **Kimi-K2.7-Code** or **Qwen3.7-Plus** for bounded components. Cursor Composer 2.5 may be used externally for rapid interactive UI polish when its harness is advantageous, but the main implementation remains Qoder-heavy.

### E1 — User journeys/state inventory
Operator must answer:
- who is ready/at risk/disrupted?
- what changed and what is affected?
- what is the system doing?
- what decision is required?
- what remains uncertain?
- has the case actually resolved?

Traveller must answer:
- am I okay?
- what changed?
- what matters?
- what are you doing?
- what do you need from me?
- is the rest viable?

Use F2 typed read-model fixtures. Do not expose graph/agent/constraint jargon as primary copy.

### E2 — Core screens/interactions
- role-neutral operator dashboard;
- trip/case detail;
- mobile-friendly traveller trip page/conversation;
- traveller decision/approval interaction;
- disrupted -> recovering -> resolved transition;
- loading/error/UNKNOWN states.

### E3 — Real read-model wiring
Wiring happens with the integrator. UI lane must not invent incompatible backend endpoints/contracts.

**Acceptance:** fixture read models can be replaced by actual application read models without redesigning information architecture.

## Integration — one lead worktree, incremental seams

Integration is not a sixth parallel lane. Start as stable outputs become available.

Recommended integrator: **Qwen3.8-Max xHigh** first. Use **GLM-5.3 High/Max** for concrete difficult deterministic/provider/runtime seams. Use **Kimi-K3 High/Max** only if repository breadth/endurance is demonstrably the bottleneck. Qwen3.7-Max remains a value-oriented long autonomous alternative when the integration package is sufficiently frozen.

### I1 — Source/profile -> validated persistent Trip
B + A1.

### I2 — TripSignal -> mutation -> ImpactAssessment
A1 + A2.

### I3 — Impact -> planner -> capabilities -> scenarios -> deterministic viability
A2/A3 + C + D.

### I4 — Viable strategy -> authority -> action/simulation -> observation -> resolution
A4 + provider executor boundary.

### I5 — Actual read models -> operator/traveller UI
E consumes application projections. No bespoke demo JSON behind the main flow.

**Integration evidence:** reuse lane tests; add seam tests only for new interactions; run Scenario A replay E2E plus one development LIVE Atlas Search/Verify proof.

## Checkpoint B gate

Stop for checkpoint review only when:
- Scenario A executes I1–I5 without manual state edits;
- Atlas Search/Verify/rules have real adapter evidence and replay the same path;
- unsupported external action boundaries are explicit/simulated honestly;
- UI shows actual state transitions;
- authority cannot be bypassed;
- restart/reload preserves critical Trip/Case state;
- no Stretch capability is required for a valid loop.

### Review Gate B — mandatory before Checkpoint B acceptance

Run an independent review of the **integrated high-risk path**, not a ceremonial full-lane rereview. At minimum inspect:
- validated mutation/persistence and blast-radius propagation;
- overlay isolation and deterministic viability;
- planner/capability separation;
- deterministic authority and irreversible-action gate;
- executor -> observation -> state-update/replan loop;
- LIVE/RECORD/REPLAY equivalence and honest provider-boundary simulation;
- UI use of actual application read models;
- Scenario A `T-E2E` and restart/persistence evidence.

Reuse still-valid lane evidence. Expand into lane internals only when the seam/evidence gives a concrete reason.

Checkpoint B passes only when its implementation criteria **and Review Gate B** pass. If this fails, fix the integrated loop before treating Checkpoint B as accepted and do not start Stretch work.

# Checkpoint C — Generalisation, reliability, demo candidate

**Outcome:** same engine proves Scenario B, selected robustness, hardcoding discipline, and reliable replay/failure behavior.

Continue primarily in the integration worktree. User involvement is not required between Checkpoint B and C unless a hard stop condition occurs. (Historical Checkpoint B→C guidance; from the Northstar wave onward, human product-owner evaluation is additionally mandatory at NS-G3 per Section 13.)

## G1 — Scenario B substitution

Run corporate/TMC scenario with the same application code.

Allowed differences:
- data/config;
- source docs/pages;
- traveller/organisation/AnchorEvent values;
- policies/approval rules;
- provider-shaped recordings/fixtures.

Forbidden:
- scenario-specific branches;
- entity types added solely for Scenario B;
- hardcoded cities/names/route IDs/fixture IDs in domain/recovery logic.

If a missing abstraction is genuine, classify **Act Now: architecture gap**, fix the shared model generically, and rerun affected tests.

## G2 — Selected robustness

Minimum recommended proof set:
1. late arrival vs hotel reception/no-show constraint;
2. public transport cutoff with flexible taxi/private-transfer recovery;
3. accessibility invalidates a cheaper alternative;
4. already-lost objective resolves as `RECOVERED_WITH_LOSS` while remaining objectives recover.

Add onward train/ferry, shared-resource cascade, visa/immigration buffer, or separately booked downstream leg only if they strengthen proof without destabilising core.

## G3 — Hardcoding/generalisation audit

Search domain/recovery/application code for:
- demo event/traveller names;
- specific cities/airports/routes;
- fixture IDs;
- supplier-specific conditions outside concrete adapters;
- scenario-specific if/switch branches;
- constants that belong in source/config/rules.

Provider-specific code inside the relevant adapter is allowed.

## R1 — Reliability/replay

- deterministic reset/reseed;
- stable sanitized recordings;
- Model Studio/provider unavailable paths;
- Google unavailable path;
- persistence restart;
- audit trail signal -> outcome;
- no secrets/unsafe raw data;
- UI unknown/error/loading states;
- README/environment/demo docs accurately label LIVE vs RECORD/REPLAY vs simulated.

## Checkpoint C gate

Stop for checkpoint review only when:
- Scenario A full replay works reliably;
- Scenario B passes without application-source changes;
- selected robustness tests pass;
- hardcoding audit passes;
- reset/reseed and restart work;
- roadmap accurately reflects every cut/stretch/deferred/blocked/implemented item.

### Review Gate C — mandatory before demo-candidate status

Run an independent **generalisation + reliability** review focused on:
- Scenario B using the same application code;
- scenario/event/traveller/city/route/fixture hardcoding;
- provider-specific logic contained inside adapters;
- selected robustness cases being real rather than scripted;
- reset/reseed, persistence restart and fallback behavior;
- replay/sanitized recording safety;
- docs/README/demo claims matching implemented reality;
- any shared-contract change since Checkpoint A being explicitly reconciled across affected lanes.

This is not another full release audit. Checkpoint C passes only when its implementation criteria **and Review Gate C** pass. The accepted integrated SHA then becomes the **demo candidate**.

**Review Gate C is closed (REV-C Complete).** The initial independent generalisation/reliability review of candidate `364b9bae6a0d5b754b3cfe192d95ad35ad7b4704` identified issues (the review-fix work packages WP-C1..C5); the initial candidate did **not** pass without fixes. Those issues were closed by the review-fix set at `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d`, and targeted closure subsequently passed: 284/284 tests (baseline 279), typecheck/lint/build clean, no unresolved Act Now or checkpoint-threatening Investigate Now findings remain. **Accepted Checkpoint C SHA: `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d`** — this is the accepted demo candidate / baseline. Remaining parked/accepted findings (PARK-3 accessibility derivation kept explicit — ROADMAP Stretch; PARK-6 on-demand buffer scoping — ADR-031 addendum; PARK-7 blast-radius reporting; PARK-2 semantics now codified in ADR-032) are carried forward, not re-litigated. No further Checkpoint C review is required unless accepted behavior is subsequently changed. The project now intentionally adds a **Reality Validation** milestone (see `docs/ROADMAP.md`) before Final Candidate preparation: the generalized engine is proven against curated/provider-shaped scenarios, and Reality Validation exists to prove it against externally sourced / provider-produced inputs.


# Final candidate gate

This is the broadest independent review/release gate (the fourth historically accepted gate — after Review Gates A/B/C — with the bounded Northstar execution gates NS-G1/NS-G2/Review 2 and the NS-G3 product evaluation preceding it; see Section 13).

Reviewer-model selection follows the current `docs/AGENT_MODEL_SELECTION.md`. Prefer independence from the primary integrator where practical, but do not duplicate or freeze a model-ranking list here.

Review:
- deterministic mutation/viability;
- authority and irreversible-action gates;
- provider boundaries;
- LIVE/RECORD/REPLAY equivalence;
- persistence;
- policy/constraint enforcement;
- AI schema boundaries;
- both accepted scenarios;
- demo hardcoding;
- reset/reseed and fallback behavior;
- secret/recording hygiene;
- user-facing claims vs implemented reality;
- demo flow readiness.

Every finding is triaged:
`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

Only Act Now findings that block demo truth/correctness/safety and checkpoint-threatening Investigate Now findings must be resolved before candidate acceptance. Fixes require targeted proof, not automatic full-review repetition.

Canonical release verification on exact candidate SHA:
- build;
- typecheck;
- lint;
- full automated suite appropriate to stack;
- Scenario A replay E2E;
- Scenario B generalisation;
- hardcoding audit;
- reset/reseed;
- persistence restart;
- provider/model fallback smoke;
- secret/recording review.

Do not make paid/live provider calls part of routine final replay unless specifically needed to prove a claim.

## 4. Master execution tracker

This table is the execution status SSOT. Update it as work moves; do not create a competing active plan.

| ID | Work package | Status | Depends on | Default worktree | Recommended Qoder profile | Evidence / commit |
|---|---|---|---|---|---|---|
| F0 | Stack + skeleton + file map | Implemented | — | main | Historical: Qwen3.8 xHigh / Qwen3.7 Max | 908e8aa — foundation smoke tests, credential-free REPLAY boot |
| F1 | Domain + operational contracts | Implemented | F0 | main | Historical: Qwen3.8 xHigh / Qwen3.7 Max | 869765e — T-DOM suite passes |
| F2 | Shared capability/service/read-model contracts | Implemented | F0,F1 | main | Historical: Qwen3.8 xHigh / Qwen3.7 Max | 54b7eed — seam/envelope contract tests pass |
| F3 | Acceptance scenario specs | Implemented | F1,F2 | main | Historical: Qwen3.8 xHigh / Qwen3.7 Max | dfc2c8d — both scenarios schema-load via same contracts |
| CA-R | Checkpoint A review-fix pass (findings 1–5) | Implemented | F0,F1,F2,F3 | main | Review-driven contract correction | 3592a0e — instant timestamp ordering; read-only ToolRequest vocabulary; AuthorisedExecution executor gate; UNKNOWN default element health; relation-vocabulary normalization (ADR-023..027); 38/38 tests green |
| REV-A | Review Gate A — contract freeze / fan-out | Complete | CA-R | fresh reviewer | See `docs/AGENT_MODEL_SELECTION.md` | Initial independent review passed; static review found 5 blocking contract issues; all five closed by fixes at 3592a0e (epoch/instant comparison; read-only ToolOperation vocabulary; AuthorisedExecution execution gate; UNKNOWN default element health; typed-field relation normalization — ADR-023..027); 38/38 tests + typecheck/lint/build + credential-free REPLAY smoke + anti-hardcoding scan clean; closure recorded on main over b0145d5; no further Checkpoint A review unless a frozen contract changes |
| A1 | Persistence + validated mutation | Implemented | REV-A | core | Qwen3.8 xHigh; Qwen3.7 Max long-horizon value | Lane c724f03 (cherry-picked 471c775) — SQLite repositories + SqlMutationService; T-PERSIST + mutation T-PROP green |
| A2 | Constraints + blast radius | Implemented | A1,F3 | core | Qwen3.8 xHigh; GLM-5.3 Max if hard logic/debug | Lane 50f7b9e (cherry-picked 04b7fec) — evaluators + ImpactEngine; T-EVAL/T-PROP, both scenarios' blast radius green |
| A3 | Overlays + viability | Implemented | A2 | core | Qwen3.8 xHigh; Qwen3.7 Max value; GLM if debugging | Lane 4b71e8f (cherry-picked 8faa7e9) — OverlayViabilityEngine; T-OVERLAY incl. overlay isolation green |
| A4 | Case + authority + observation | Implemented | A1,A2,F2 | core | Qwen3.8 xHigh; GLM-5.3 for hard authority/state seam | Lane 9d587c0 (cherry-picked d478571) — CaseService transitions, DeterministicAuthorityEngine, observation/verifier; T-AUTH green |
| B1 | Source/provenance framework | Implemented | REV-A | ingestion | Qwen3.8 Medium; Qwen3.7 Max; Plus/K2.7 helpers | Lane b69074a (cherry-picked 04ee20c) — source registry/provenance contract tests green |
| B2 | Web/document/policy/insurance ingestion | Implemented | B1 | ingestion | Qwen3.8 Medium/xHigh; Plus/K2.7 helpers | Lane c1eb771+a8dfb22+e540f11 (cherry-picked 779cab9/2ac3b62) — extraction seam, deterministic structured mapping, capability pipeline; evidence at e1f722b (ab939cd) |
| B3 | Traveller/research context | Implemented | B1,D1 | ingestion | Qwen3.8 Medium/xHigh; Qwen3.7 Max | Lane a8dfb22 (cherry-picked 03a1b07) — traveller/dynamic context normalization; semantic seam wired to Model Studio in I1 |
| C1 | Provider modes + recording/error envelope | Implemented | REV-A | providers | Qwen3.8 Medium; Kimi-K2.7-Code alternative | Lane 1e42667 (cherry-picked b56f328) — LIVE/RECORD/REPLAY shared normalizer, sanitized recordings, structured errors |
| C2 | Atlas Search/Verify/rules | Implemented | C1 | providers | Qwen3.8 xHigh; GLM-5.3 High/Max for provider debugging | Lane 1a89c0c (cherry-picked 875fce2) — LIVE Search/Verify proof recorded; REPLAY replays identical normalizer; ADR-028 airport-local time handling |
| C3 | Google Routes optional adapter | Implemented | C1 | providers | Qwen3.7-Plus / Kimi-K2.7-Code / Qwen3.8 Medium | Lane dc58d30 (cherry-picked e7e67ba) — REPLAY + structured NOT_CONFIGURED without key; LIVE parked (Issue 5) |
| D1 | Model Studio structured client | Implemented | REV-A | intelligence | Qwen3.8 Medium / Kimi-K2.7-Code | Lane 2fa9c46 (cherry-picked 098e3fe) — fail-closed structured client, credential-free degradation |
| D2 | Semantic preferences + research | Implemented | D1,F3 | intelligence | Qwen3.8 xHigh / Qwen3.7 Max | Lane b3fced7 (cherry-picked e324eaf) — semantics/preferences/research with explicit-over-latent precedence |
| D3 | RecoveryPlanner | Implemented | D1,A2,F2,F3 | intelligence | Qwen3.8 xHigh; Kimi-K3 only as premium long-horizon trial; GLM if debugging | Lane bbb89cd (cherry-picked 6141661) — structured planner, read-only tool vocabulary enforced, no authority minting |
| E1 | User journeys + read-model fixtures | Implemented | REV-A | ui | Qwen3.8 Medium / Kimi-K2.7-Code / Plus helpers | Lane b465199 (cherry-picked 0b5d012) — journeys/state inventory + preview fixtures (preview/test only) |
| E2 | Operator + traveller UI | Implemented | E1 | ui | Qwen3.8 Medium / Kimi-K2.7-Code; Composer 2.5 external optional | Lane 52b5ad1 (cherry-picked 00c2032) — pure renderers over frozen read models + UI-local CaseDetailView with consistency guard |
| I1–I5 | Vertical integration | Integrated | lane outputs | integration | Qwen3.8 xHigh; GLM-5.3 hard seams; Kimi-K3 only if breadth/endurance warrants | I1 2f91ff3 (validated seed -> persistent Trip, restart), I2 ea6e107 (signal -> mutation -> impact -> case), I3 6860fb4 (planner -> REPLAY capabilities -> overlays -> viability, infeasible candidate rejected), I4 3818464 (authority -> approval -> simulated execution -> observation -> FULLY_RECOVERED; gate refuses forged authority), I5 0e6ba65 (real read models -> operator/traveller UI + HTTP); T-E2E at 84a82b9; 262/262 tests; Checkpoint B candidate pending REV-B |
| REV-B | Review Gate B — integrated vertical loop | Complete | I1–I5 | fresh reviewer | See `docs/AGENT_MODEL_SELECTION.md` | **PASS — CHECKPOINT B ACCEPTED.** Independent review of candidate SHA `b650031147085fddb1d50f75ed455d43514f1f20` (integration/vertical-loop) passed; 262/262 tests, typecheck/lint/build clean at the candidate. Reviewer findings carried into Checkpoint C as inputs: PL-1 UPSERT_ENTITY fact-authority bypass (Act Now); PL-2 DST fold rule not universally first-occurrence (Fix during C); PL-3 no runtime disruption trigger (Act Now); PL-4 CaseVerifier builds a thinner EvaluationContext than impact/viability and verifies at assessedAt (Act Now before robustness); PL-5 strengthen core invariant tests — successful action + remaining hard failure must stay unresolved; Scenario A T-E2E values tied to REPLAY-normalized output (Act Now); PL-6 doc/demo truthfulness (Act Now during C). Merged to main at `bbc234f`. |
| G1 | Scenario B substitution | Integrated | REV-B | integration | Qwen3.8 xHigh / Qwen3.7 Max | Scenario B (corporate/TMC) runs through the identical application code (bootstrap → signal pipeline → planning loop → authority → execution → observation → verification, REPLAY Atlas + shared normalizer). Organisation-approval path emerges from `rule_b_change_approval`; wrong-principal approval refused; deterministic viability rejects the no-waiver candidate (`c_b_return_buffer` UNKNOWN, never PASS); RECOVERED_WITH_LOSS with `obj_b_return` waived survives execution observation into persisted state and read models; restart reconstructs everything. Two scenario-neutral gaps closed on this path: non-element vocabulary operations (waivers) pass through `confirmedOperationsFor` instead of being silently dropped, and governing rule-set owner organisations enter snapshot principal scope. Evidence: `test/g1-scenario-b.test.ts`, `fixtures/scenarios/corporate-tmc/recordings/atlas/*` (3 recordings, hash-keyed). |
| G2 | Selected robustness | Integrated | REV-B | integration/core | Qwen3.8 xHigh; GLM-5.3 if debugging-heavy | 4 robustness cases through the real engine (`test/g2-robustness.test.ts`): (1) Scenario A outbound delay (00:45 arrival) breaches the hotel no-show cutoff (00:45 + 80min chain > 02:00) — next-morning candidate rejected by the SUPPLIER evaluator, same-day evening flight recovered via REPLAY search with AUTHORITATIVE candidate facts outranking CONNECTED incumbents, traveller approval, RESOLVED FULLY_RECOVERED; (2) delayed flight misses a booked 11:30 transit (TRANSFER FAIL), on-demand taxi wins over later transit on cost via the deterministic on-demand branch, `simulation.provider_action` AUTO_APPROVED, RESOLVED; (3) cancelled flight: cheaper PUBLIC_TRANSIT ($40) rejected by HARD ACCESSIBILITY `unsupportedModes`, accessible PRIVATE_TRANSFER wins, hardFailureIds [] proves the PL-4 full-context post-execution re-check; (4) cancellation observed after the 08:00 departure records an irreversible objective loss (CRITICAL severity) and the remainder recovers RECOVERED_WITH_LOSS with the meeting objective intact. One scenario-neutral engine gap closed: TRANSFER evaluator now recognises a CONFIRMED on-demand leg (flexible, no schedule, durationEstimate marker) as schedulable instead of UNKNOWN, so confirmed ground recovery verifies. |
| G3 | Hardcoding audit | Integrated | G1 | review/bounded | Kimi-K2.7-Code / DeepSeek-V4-Flash / Plus; different-family preferred | Bounded adversarial audit of `src/**` for scenario content: searched every fixture identifier family (`trip_a/b`, `el_a/b_*`, `trv_*`, `sig_*`, `obj_*`, `plc_*`, `org_*`, `rs_*`, `rule_*`, `src_*`, `rec_*`), scenario place names (Seoul/Incheon/Tokyo/HND/NRT/Mexico/GDL/Guadalajara), event vocabulary (devsummit/keynote/speaker/workshop) and hardcoded scenario dates — zero matches outside `fixtures/`. Adapter-scoped Atlas provider fields/constants and generic rule kinds (`NO_SHOW_CUTOFF`, capability operation vocabulary) are allowed and verified to stay provider/ontology code. One Act Now finding fixed: stale `Lane D1 is not wired yet` uncertainty text in the ingestion pipeline (extractor IS wired by `src/app/compose.ts` when Model Studio credentials are configured) replaced with honest "no extractor is configured"; assertion updated in `test/ingestion.test.ts`. `src/app/runtime.ts`, `fallbackPlanner.ts` and `runtimeHttp.ts` verified scenario-neutral (operation vocabulary only; `bookingRef.system: 'flight-provider'` is a provider-system label, not scenario content). |
| R1 | Reliability/replay | Integrated | REV-B | integration | Qwen3.8 xHigh; GLM-5.3 for hard failures | Generic runtime recovery/reset flow over HTTP (`/api/runtime/{disruption,plan,begin,decide,execute,reset,state}`): scenario-neutral `RuntimeOrchestrator` + `src/app/compose.ts` shared by `main.ts` and tests (no separate demo path), deterministic `DeterministicFallbackPlanner` (credential-free REPLAY planning; Model Studio planner used only when configured), audited single-transaction reset + reseed through the same validated `seedScenarioBundle` mutation path (no manual SQLite edits), every stage caller-supplied instants. Three engine/verifier gaps closed generically: `CaseVerifier` now trip-scopes constraints by ref matching (other trips' constraints can no longer poison verification), `POST /api/runtime/state` returns 405, provider-success-only still never resolves. Evidence: `test/integration.r1.test.ts` — credential-free full loop over HTTP (disruption → plan → begin → wrong-principal refused → correct APPROVED → execute → RESOLVED FULLY_RECOVERED), gate refusal of unapproved execution, repeat-execute refused on RESOLVED, reset restores byte-identical seeded state, and two identical runs + file-DB restart yield byte-identical trip JSON. |
| REV-C-FIX | Review Gate C fix set (WP-C1..C5) | Implemented | G1,G2,G3,R1 | checkpoint-c | Review-driven engine/app correction | Five review fix packages on `checkpoint-c`: **WP-C1** planner-authored operations can no longer reach authoritative state — observation allowlist `confirmedOperationsFor` (confirmed TRIP_ELEMENT upserts + WAIVE_OR_REPRIORITIZE_OBJECTIVE only) plus defence-in-depth overlay rejection of candidates mutating judging criteria (`src/app/recoveryExecution.ts`, `src/engine/overlay.ts`; permanent regression `test/g2-robustness.test.ts` "WP-C1 regression: a planner-authored constraint downgrade never becomes truth"). **WP-C2** fact authority binds the authoritative mutation path, not overlay planning — `applyOperationToState` explicit `enforceFactAuthority` modes (true from SqlMutationService, false from OverlayViabilityEngine); PARK-2 omission of an incumbent AUTHORITATIVE fact = FACT_OUTRANKED conflict; G2-1 candidate facts reverted to CONNECTED and completed to AUTHORITATIVE by `confirmedData()` at observation (`src/engine/applyOperations.ts`, `src/engine/mutation.ts`; `test/a3-overlay.test.ts` rewritten, `test/a1-mutation.test.ts` PARK-2 test). **WP-C3** assessed irreversible losses persist through validated mutation and bind resolution — objective LOST upserts ordered after the whole-trip viability upsert in `impactProposal`; CaseVerifier never returns FULLY_RECOVERED while a loss stands unacknowledged (`src/engine/impact.ts`, `src/engine/observation.ts`; regression `test/g2-robustness.test.ts` "WP-C3 regression..."; ADR-033 records LossRecord's authoritative home). **WP-C4** `recordApproval` verifies the principal is in the trip's principal scope via generic ref matching (shared `principalScopeForTrip` walk); refusal is an audited APPROVAL_REJECTED with reason, not a throw (`src/app/recoveryExecution.ts`, `src/app/snapshot.ts`; `test/integration.i4.test.ts` unrelated-org refused + employer accepted). **WP-C5** doc/comment truth: README `src/app/` path, DEMO.md credential-free planner honesty (fallback planner scope, FLIGHT_DELAY zero strategies, Scenario B `bestStrategyId=undefined`, WP-C2 effect), ADR-031 addendum (PARK-6 decision), CaseVerifier comment correction; PARK-3 comments + ROADMAP Stretch entry only; PARK-7 blast radius reported in completion report (behavior unchanged, awaiting reviewer). New ADR-032 (fact authority seam). Read models present persisted planning-time verdicts (PLANNING_COMPLETED audit `candidateVerdicts`) instead of re-deriving overlays against post-resolution state. 284/284 tests (baseline 279) + typecheck/lint/build clean. |
| REV-C | Review Gate C — generalisation / reliability | Complete | G1,G2,G3,R1 | fresh reviewer | See `docs/AGENT_MODEL_SELECTION.md` | **PASS — CHECKPOINT C ACCEPTED.** Initial independent review of candidate `364b9bae6a0d5b754b3cfe192d95ad35ad7b4704` found issues (did not pass unconditionally); all closed by the review-fix set WP-C1..C5 at `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d` with targeted closure passing (284/284 tests, typecheck/lint/build clean). Accepted demo candidate / baseline SHA: `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d`. Merged to main by fast-forward during closeout; Reality Validation milestone intentionally precedes Final Candidate preparation |
| RV-N0 | Northstar contract reconciliation + freeze | Complete | REV-C, reality-validation docs | northstar/contract-freeze | lead | A–J contracts (ADR-034..041): AnchorCommitment+Engagement linkage, intake drafts, initial planning caseKind, ChangeRequest/ResolutionTarget, FUNDED_WINDOW/CostAllocation, ANCHOR_COMMITMENT_CHANGE, ProgrammeView, hotel/transfer seams, temporal normalization; 301/301 tests + typecheck/lint/build + anti-hardcoding scan clean. NORTHSTAR_CONTRACT_BASE_SHA = `70d4b8664c80583e964ff2c509cbda61b4b640aa`. Docs-only execution-plan reconciliation (four waves NS-G1..NS-G3 + Reviews 1/2) committed on top as NORTHSTAR_EXECUTION_BASE_SHA — see Section 13. |
| NS-G1 | Northstar Wave 1 internal integration gate | Complete | RV-N1..N2,N4,N10 | integration/northstar | primary agent (internal gate, no reviewer) | GREEN at `8ea33f2161a54e10c604a1ceb2758710470d5eac` — 337/337 tests, typecheck/lint/build clean, anti-hardcoding scan clean; continued automatically into Wave 2 (see Section 13). |
| RV-N1 | Programme/AnchorEvent commitment fan-out | Integrated | RV-N0 | integration/northstar | primary agent + lane | Engagement.anchorCommitmentId id-linkage (no title matching, no second engine); per-trip signal fan-out through the existing signal pipeline; shared commitment truth via validated mutation. |
| RV-N2 | Programme intake: manual + bulk CSV/XLSX/table + LLM mapping | Integrated | RV-N0 | integration/northstar | primary agent + lane | Manual/bulk equivalence, deterministic validation/promotion (drafts never auto-promote), REPLAY LLM mapping seams (roster/brief) failing closed without a model seam. |
| RV-N4 | FUNDED_WINDOW evaluation + CostAllocation | Integrated | RV-N0 | integration/northstar | primary agent + lane | Deterministic mixed-funding allocation; honest refusal outside covered windows. |
| RV-N10 | Programme UI skeleton | Integrated | RV-N1 | integration/northstar | primary agent + lane | Operator programme + traveller surfaces over frozen read models; loading/error/data parity; HTML-escaped dynamic values. |
| NS-G2 | Northstar Wave 2 backend convergence gate | Complete | RV-N3,N5,N6,N7,N8,N9, Case C fan-out | integration/northstar | primary agent (Review 2 next) | Candidate `91648aa481e598d42ac92769d3f550c0b7050e4b` — four convergence paths (0/A/B/C) through ONE architecture over the composed HTTP runtime in REPLAY, zero credentials; 395/395 tests, typecheck/lint/build clean; scans clean. See Section 13 NS-G2 RESULT. |
| RV-N3 | Initial viable trip creation | Integrated | RV-N1,NS-G1 | lane-resolution | resolution lane | INITIAL_PLANNING case through the existing engine; engagement-only trips gain evidence-bound arrival legs; missing home evidence fails closed. |
| RV-N5 | ChangeRequest / ResolutionTarget resolution (A1/A2/A3) | Integrated | RV-N3 | lane-resolution | resolution lane | ONE generic contract; deterministic implications; window deltas carried in TRAVELLER_INPUT signal payload; 15 synthetic evidence cases. |
| RV-N6 | Atlas LIVE/RECORD/REPLAY reality path | Integrated | NS-G1 | lane-providers-w2 | providers lane | Shared normalizer across modes; LIVE fails closed without credentials; lazy timezone resolution; ~1,000-search budget respected (zero LIVE calls so far). |
| RV-N7 | Hotel API adapter (Nuitée / liteAPI; Duffel Stays fallback clause fired) | Integrated | RV-N6 | lane-providers-w2 | providers lane | Full HotelCapability (search/quote/book/retrieve/policy/cancel) LIVE/RECORD/REPLAY, REPLAY-first; MONEY_MOVING descriptor → traveller authority; genuine liteAPI sandbox capture committed (WP-R4-REDO). |
| RV-N8 | Routing + private-transfer reasoning | Integrated | RV-N6 | lane-providers-w2 | providers lane | transferWindowImpact STILL_OK/TIGHT/MISSED/UNKNOWN with conservative defaults; routing.context seam; UNKNOWN never PASS. |
| RV-N9 | Model Studio runtime | Integrated | NS-G1 | lane-providers-w2 | providers lane | Runtime seam wired into composed app; NOT_CONFIGURED fail-closed without credentials; planner selection by configuration. |
| RV-N11 | Integrated Cases A/B/C (Wave 3 product) | Not Started | NS-G2, Review 2 | wave-3 | TBD | — |
| RV-N12 | Stabilisation / code-freeze wave | Not Started | RV-N11 | wave-4 | TBD | — |
| FINAL | Review Gate Final + candidate release gate | Not Started | REV-C | fresh reviewer | See `docs/AGENT_MODEL_SELECTION.md` | Broad independent review + `T-RELEASE` on exact candidate SHA |

Statuses: `Not Started | In Progress | Blocked | Implemented | Integrated | Complete | Dropped`.

**Checkpoint A fan-out rule:** fan-out only from the exact pushed `main` SHA after `REV-A` is marked `Complete`. `REV-A` is `Complete`; the reviewed contract-fix code is at `3592a0e` with docs-only reconciliation at `addad36` and review-gate definitions at `b0145d5`. **CHECKPOINT_A_CLOSURE_SHA = `aa54a2e59f7e0393a2e85225ed4453d3da027d39`** (docs-only closure commit on top of `b0145d5`) is the accepted fan-out base: every lane branch must originate from that exact SHA. This tracker-only commit records the SHA and may remain on `main` without invalidating the fan-out base.

`Implemented` = package completed/verified in lane.  
`Integrated` = merged and seam-tested.  
`Complete` = relevant checkpoint/review gate passed.

## 5. Requirement / verification traceability

Minimum traceability; task Specs may add narrower evidence but cannot delete required evidence.

| Package | Primary requirements | Required evidence |
|---|---|---|
| F0 | NFR-03,NFR-05 | runnable/no-credential smoke, SQLite round trip, baseline commands |
| F1 | FR-01,03–06,09–11,14; NFR-01,02,04 | `T-DOM` |
| F2 | FR-07,08,10–16 | contract tests / relevant `T-DOM` |
| F3 | NFR-01,02 | scenario schema-load assertions |
| REV-A | Checkpoint A contract/fan-out risk | independent review of actual proposed fan-out SHA + targeted closure evidence for blockers |
| A1 | FR-01,04,14 | `T-PERSIST`, mutation `T-PROP` subset |
| A2 | FR-05,06 | `T-EVAL`, `T-PROP` |
| A3 | FR-09 | `T-OVERLAY` |
| A4 | FR-10,11 | `T-AUTH`, Case transitions |
| B1 | FR-02,03,14 | source/ingestion contract tests |
| B2 | FR-02,18 | extraction/schema/evidence tests |
| B3 | FR-03,17 | relevant `T-AI` |
| C1 | FR-08,15 | `T-ADAPTER` mode/error/sanitization |
| C2 | FR-08 | Atlas `T-ADAPTER` + LIVE Search/Verify proof |
| C3 | FR-16 | routing `T-ADAPTER` + missing-key path |
| D1 | FR-07 | `T-AI` schema/error boundary |
| D2 | FR-03,17 | `T-AI` semantics/research |
| D3 | FR-07 | `T-AI` planner strategies/tool requests |
| E1–E2 | FR-12,13 | typed UI-state/interaction evidence |
| I1–I5 | Scenario A requirements | seam tests + `T-E2E` |
| REV-B | Checkpoint B integrated-loop risk | independent integrated high-risk-path review + Checkpoint B evidence |
| G1 | NFR-01,02 | `T-GEN` Scenario B |
| G2 | exercised FRs | selected evaluator/propagation/overlay/authority tests |
| G3 | NFR-02 | hardcoding portion of `T-GEN` |
| R1 | FR-14,15; NFR-03,05,06 | persistence/fallback/replay E2E |
| REV-C | Checkpoint C generalisation/reliability risk | independent generalisation/reliability review + Checkpoint C evidence |
| RV-N0..N12 | FR-19..25; NFR-01,02 | `test/northstar-contracts.test.ts`, programme-scale integration, Cases A/B/C acceptance at scale, alternate-data anti-hardcoding pass |
| FINAL | all implemented MVP requirements | independent final review + `T-RELEASE` |

## 6. File ownership and collision control

Exact paths as of the F0–F3 foundation (authoritative map: `docs/architecture/PROJECT_FILE_MAP.md`).

| Area | Exact paths | Primary owner | Other lanes may | Must not |
|---|---|---|---|---|
| shared domain/operational schemas | `src/domain/**`, `src/operational/**` | Foundation/lead | import/use | change after freeze without lead reconciliation |
| shared seams (repos/capabilities/services/planner/read models/envelopes) | `src/contracts/**` | Foundation/lead | implement/consume | fork local variants |
| scenario bundles + loader | `fixtures/scenarios/**`, `src/scenarios/**` | lead owns semantics | use/add scoped data | embed fixture facts in production logic |
| config/env/server/util skeleton | `src/config/**`, `src/server/**`, `src/util/**`, `src/main.ts` | Foundation/integrator | extend via integrator | parallel lane edits |
| persistence implementation | `src/persistence/**` | Lane A | call repository interfaces | add provider/UI/prompt logic |
| core engine (mutation/constraints/overlays/case/authority) | `src/engine/**` (created by Lane A) | Lane A | call public interfaces | add provider/UI/prompt logic |
| ingestion/sources | `src/ingest/**` (created by Lane B) | Lane B | produce proposals/rules | mutate Trip directly |
| providers/recordings | `src/providers/**`, `recordings/**`, `fixtures/recordings/**` | Lane C | consume capability contracts | add trip-specific recovery policy |
| AI/planner runtime | `src/intelligence/**` (created by Lane D) | Lane D | consume snapshots/evaluator evidence | mutate state or approve/execute |
| web UI | `src/ui/**` (created by Lane E) | Lane E | consume read models/app APIs | redefine domain DTOs |
| orchestration/application seams | `src/app/**` (created by Integrator) | Integrator/lead | report mismatch | parallel lane edits |
| tests | `test/**` | package owner | scoped additions | weaken contract tests without lead |
| architecture/roadmap/implementation SSOT | `docs/**`, `.qoder/rules/**` | lead/integrator | propose update | silently alter scope/contracts |

If two lanes require the same implementation file, they are not independent until ownership/overlap is resolved.

## 7. Dependency / parallelisation map

```text
F0 -> F1 -> F2 -> F3 -> REVIEW A -> CHECKPOINT A ACCEPTED
                                      |
        +-----------------------------+-----------------------------+
        |            |             |             |                 |
      Lane A       Lane B        Lane C        Lane D            Lane E
   A1->A2->A3    B1->B2       C1->C2       D1->D2           E1->E2
    \    ->A4     \->B3        \->C3        \->D3
        |            |             |             |                 |
        +------------+-------------+-------------+-----------------+
                                  |
                          I1 -> I2 -> I3 -> I4 -> I5
                                  |
                              REVIEW B
                                  |
                           CHECKPOINT B
                              /       \
                            G1         R1
                              \       /
                               G2/G3
                                  |
                              REVIEW C
                                  |
                           CHECKPOINT C
                                  |
                            FINAL REVIEW
```

D1, C1, B1, E1 and A1 can begin as soon as Review Gate A is accepted and their frozen dependencies exist. Integration should begin incrementally as seam pairs stabilize rather than waiting for lane polish.

## 8. Work-package execution contract

Every long-horizon Agent/Quest prompt must specify:

1. work-package/lane IDs and objective;
2. exact branch/worktree/head/base SHA;
3. authoritative inputs/docs/contracts;
4. relevant `FR-*` / `NFR-*` requirements;
5. exact owned paths;
6. do-not-touch paths/frozen contracts;
7. dependencies assumed complete with commit evidence;
8. required behavior including UNKNOWN/error/fallback;
9. observable acceptance criteria;
10. required `T-*` verification / actual commands once F0 defines them;
11. explicit Stretch/Deferred/non-lane exclusions;
12. delegation guidance;
13. environment recovery via `.qoder/rules/environment-recovery.md`;
14. completion/handoff format;
15. **continue autonomously until the assigned formal checkpoint unless a Section 2.5 hard-stop condition occurs.**

Do not ask the user for routine implementation decisions between checkpoints.

A Qoder-generated Spec may elaborate tasks, but if it contradicts this plan/architecture it must be corrected before Build.

### Completion report / handoff

Each completed package/lane reports:
- simple statement of what now works and what intentionally did not change;
- branch/worktree and exact head;
- work-package ID(s);
- files changed;
- tests/checks actually run and results;
- failure/fallback behavior verified;
- unexpected findings/risks and triage;
- docs/roadmap/architecture changes, if any;
- commit SHA;
- exact next dependency/integration action.

Do not repeat the implementation plan in the handoff.

## 9. Git / integration discipline

- use exact-path staging;
- coherent, testable lane commits;
- **push integration/checkpoint candidates before formal review so reviewers/lead can inspect the exact remote SHA**;
- integrator verifies real branch heads/ancestry/merge order;
- reuse valid lane evidence and run invalidated/seam checks only;
- never mechanically resolve overlapping-file conflicts;
- update this tracker and `ROADMAP.md` when implementation/scope changes;
- record settled architecture changes in `DECISIONS.md`;
- verify branch/commit/remote before claiming pushed/integrated state.

## 10. Scope cut order

If capacity tightens, cut breadth before the generalized vertical loop.

### Protect
1. persistent typed Trip/state + validated mutation;
2. deterministic constraints + blast radius;
3. overlays + deterministic viability;
4. RecoveryPlanner structured loop;
5. deterministic authority/action boundary;
6. Atlas Search/Verify/rules;
7. real operator/traveller read-model flow;
8. Record/Replay reliability;
9. Scenario B generalisation test.

### Cut/degrade first
1. Atlas seats/baggage unless main scenario requires them;
2. Google LIVE routing — keep adapter/replay/sourced fallback;
3. robustness scenarios beyond selected minimum;
4. rich insurance/immigration sophistication beyond proving data-driven rules/uncertainty;
5. non-essential visual polish.

### Never promote to critical path before Checkpoint B
- Booking.com;
- Atlas `order.do`/ticketing;
- Gmail live watch/OAuth;
- Timatic;
- real ridehail/rail/ferry transactions;
- other GDS/NDC providers;
- insurance claims;
- Slack/WhatsApp integrations.

Anything intentionally cut remains explicit in `ROADMAP.md` with reason/revisit condition.

## 11. Bounded investigations

Investigations do not block core unless their result deliberately changes roadmap status.

### X1 — Atlas Singapore sandbox
Question: can Atlas/hackathon staff enable a useful SIN fixture?  
Decision: use if easy and architecture-neutral; otherwise continue existing sandbox/replay.
**Post-N0 resolution (Northstar):** do not wait for special SIN provisioning. The demo event/location is relocatable; use whichever routes Atlas provider reality makes strongest (~1,000 LIVE fare-search budget; see Section 13).

### X2 — Booking.com Demand
Question: can valid partner/sandbox credentials be obtained immediately enough to implement/test without onboarding delay?  
Decision: adopt only if access is already practical; otherwise keep Stretch and stop investigating.

### X3 — Google Routes
Question: can project billing/API/key be configured cleanly?  
Decision: configure if easy; otherwise C3 still ships with replay/fallback.

### X4 — Atlas order execution
Start only after Checkpoint B.  
Question: can sandbox `order.do` + observation be safely exercised through the existing authority/executor boundary?  
Decision: Stretch implementation only if bounded/safe; do not chase account/ticket activation at the expense of core.

Every investigation ends with `Adopt Now | Keep Stretch | Defer | Reject`, evidence, and roadmap update if status changes.

## 12. What happens next

Checkpoints A, B, and C are **accepted** (REV-A, REV-B, REV-C Complete). Checkpoint C's accepted SHA `3b2f0dac33d56f0e0df02eaaf2f4583b4f4c3a2d` is the demo candidate / baseline and has been merged to `main`.

Current next action:
1. execute the **Northstar Wave 1 + Wave 2 as ONE continuous long-horizon mission** (Section 13 below): Wave 1 → NS-G1 (internal integration gate) → automatically continue into Wave 2 → NS-G2 → mandatory Independent Review 2. Review 1 is no longer a scheduled mandatory gate. Implementation worktrees fan out from `NORTHSTAR_WAVE12_BASE_SHA` (recorded by this docs-only cadence reconciliation on top of `northstar/contract-freeze`) so they inherit the corrected execution/review plan;
2. keep the Reality Validation milestone open — the Northstar wave is its programme-scale execution phase (externally sourced / provider-produced inputs, RECORD/REPLAY default, bounded LIVE);
3. do not begin Final Candidate preparation until Wave 4 stabilisation completes and Review Gate Final passes.

Review Gate Final remains mandatory per Section 3 and `docs/TESTING.md`.

## 13. Northstar wave — four execution waves (RV-N0..RV-N12)

Northstar framing: the AI resolution layer for event travel. One event-travel programme at a time, roughly 40–45 inbound travellers, generic across tournaments / corporate offsites / productions / conferences.

**Long-horizon execution discipline (post-Wave-1/2 unification decision):** RV-N1..N12 are deliberately NOT one uninterrupted autonomous run across all waves. A single multi-day autonomous implementation horizon is not trusted. Execution proceeds in bounded waves, each ending in a checkpoint. **Wave 1 and Wave 2 are now ONE continuous long-horizon mission**: after the internal NS-G1 integration gate passes, the primary agent continues automatically into Wave 2 without a scheduled independent review. Independent Review 2 remains mandatory after NS-G2. These Northstar gates (NS-G1/NS-G2/NS-G3, Review 2) are bounded **post-Checkpoint-C execution gates**; they do not reopen, re-review or replace accepted Checkpoints A/B/C.

**Cadence (authoritative):**

```
RV-N0 contract freeze — COMPLETE
→ Wave 1 Programme Foundation
→ NS-G1 internal integration gate
→ automatically continue into Wave 2 (no scheduled Review 1)
→ NS-G2 backend convergence gate
→ mandatory Independent Review 2
→ human checkpoint
→ Wave 3 Integrated Northstar Product
→ NS-G3 product/demo checkpoint
→ Stretch pull decision
→ Wave 4 Stabilisation
→ Final Candidate Review
```

**NS-G1** is a real internal integration/acceptance gate (full suite, typecheck, lint, build, targeted anti-hardcoding scan, alternate-data substitution), but it is NOT a human/reviewer checkpoint: a green NS-G1 means the primary agent continues directly into Wave 2. A bounded different-family review may still be used voluntarily between NS-G1 and Wave 2 if concrete evidence suggests a problem, but it is no longer a scheduled mandatory gate.

### Bases and fan-out discipline

- **NORTHSTAR_CONTRACT_BASE_SHA = `70d4b8664c80583e964ff2c509cbda61b4b640aa`** — the immutable accepted executable-contract baseline (RV-N0 freeze, ADR-034..041). Never amended or replaced.
- **NORTHSTAR_EXECUTION_BASE_SHA = `53c7a3ba2feeb184153f127d4c81bac7e64e7838`** — the docs-only execution-plan reconciliation commit that introduced the four-wave plan. The diff CONTRACT_BASE → EXECUTION_BASE is documentation only.
- **NORTHSTAR_WAVE12_BASE_SHA = `0950870d10df157fdeed967a3a49f9279039855a`** — recorded by the docs-only Wave 1+2 cadence reconciliation commit (this correction). The diff EXECUTION_BASE → WAVE12_BASE is documentation only. **All Wave 1/Wave 2 implementation worktrees fan out from NORTHSTAR_WAVE12_BASE_SHA**, never from CONTRACT_BASE or EXECUTION_BASE directly, so every lane inherits the corrected execution/review plan.

**Contract assumptions lanes must not redefine** (change only through lead reconciliation, like Checkpoint A frozen contracts):
- SignalKind stays closed except the already-added `ANCHOR_COMMITMENT_CHANGE`.
- `ChangeRequest.target` is declarative only — no element mutations, booking ids or provider operations inside intake.
- Importance/hardness is per traveller (Engagement/objectives), never on shared `AnchorCommitment`.
- Drafts become authoritative only through the frozen MutationService promotion path.
- Initial planning reuses the existing case state machine; `caseKind` is classification evidence, not a behaviour fork.
- ToolOperationSchema stays a strict subset of CapabilityOperationSchema (test-enforced); consequential hotel/transfer ops never enter tool vocabulary.
- Anti-hardcoding rule: no event/customer/route/airline/hotel/date/Case-id content in `src/**` (all in `fixtures/`); test with alternate data.

### Environment notes

- Atlas LIVE budget ≈ **1,000 fare-search calls** for the whole wave; REPLAY is the default mode, LIVE only for bounded proof recordings. **Do not wait for Atlas to provision special SIN data.**
- The demo event may be real or synthetic; the location may be wherever provider reality gives the strongest demo. The disruption itself may be synthetic but must be labelled honestly. No location-specific application logic.
- Replacement options should use Atlas LIVE-origin Search where practical, Verify shortlisted offers, apply relevant fare/change/refund/no-show rules, sanitize and RECORD, then REPLAY for routine build/demo. LIVE/SANDBOX and REPLAY must share the same normalization/downstream code.

### Work-package ID reconciliation (authoritative from EXECUTION_BASE)

RV-N6..N9 meanings were re-scoped after the user's post-N0 decision. No executable code depends on these names; docs are the SSOT. Earlier RV-N0-era meanings (hotel adapter = N6, transfers = N7, RECORD/REPLAY discipline = N8, temporal normalization + re-ingestion = N9) are superseded as follows: temporal normalization stays a frozen contract whose runtime work lands inside Wave 1 intake/policy packages; RECORD/REPLAY discipline is folded into RV-N6/RV-N7; event re-ingestion moved to Stretch S3; the Hotelbeds transfer adapter moved to Stretch S1.

| ID | Work package (reconciled meaning) | Wave | MIN/STRETCH/PARK |
|---|---|---|---|
| RV-N0 | Northstar contract reconciliation + freeze | (done) | Complete at CONTRACT_BASE |
| RV-N1 | Programme/AnchorEvent commitment fan-out | 1 | MIN |
| RV-N2 | Programme intake: manual add, bulk CSV/XLSX/table import, LLM-assisted mapping of reasonable messy traveller lists/event briefs into frozen draft schemas, deterministic validation/promotion | 1 | LLM-assisted mapping is **MINIMUM** (not arbitrary universal document ingestion) |
| RV-N3 | Initial viable trip creation (zero-element trip → viable Trip through the generalized engine) | 2 | MIN |
| RV-N4 | Event/organisation policies + mixed-funding foundations (FUNDED_WINDOW evaluation, CostAllocation) | 1 | MIN |
| RV-N5 | Traveller ChangeRequest / ResolutionTarget resolution (variants A1/A2/A3 below) | 2 | MIN |
| RV-N6 | Atlas LIVE / RECORD / REPLAY reality path (bounded LIVE Search/Verify, sanitized recordings, replay equivalence) | 2 | MIN |
| RV-N7 | Proper hotel API adapter (Duffel Stays first, Nuitée fallback) behind the frozen HotelCapability | 2 | **MINIMUM** |
| RV-N8 | Routing + private-transfer reasoning (routing context MIN; booked PRIVATE_TRANSFER consequences MIN; real Hotelbeds transfer adapter stays Stretch S1) | 2 | MIN (reasoning) |
| RV-N9 | Model Studio runtime / Northstar intelligence (extraction/planning runtime quality against programme-scale inputs) | 2 | MIN |
| RV-N10 | Programme UI: operator programme dashboard + traveller mobile surface skeleton against frozen read models | 1 skeleton; 3 full | MIN |
| RV-N11 | Integrated Cases A/B/C at programme scale (Wave 3 product integration) | 3 | MIN |
| RV-N12 | Stabilisation / code-freeze reliability wave | 4 | MIN |

Wave 1 also carries: relevant Model Studio extraction plumbing; bounded provider-access smoke investigations (Duffel Stays / Nuitée / Hotelbeds access reality) run in parallel and recorded per `Adopt | Defer | Reject`.

### WAVE 1 — Programme Foundation → NS-G1 → automatically into Wave 2

Goal: Northstar understands and operationalises one event programme.

Scope: RV-N1 commitment fan-out; RV-N2 intake (manual + bulk + LLM-assisted mapping — mapping of reasonable event briefs, pasted text, CSV/XLSX/table-like inputs and supported upload formats into the frozen pre-authoritative draft schemas, then deterministic validation/promotion; **minimum, not Stretch**; arbitrary universal document ingestion is not required); RV-N4 policy + funding foundations; Model Studio extraction plumbing; RV-N10 UI skeleton against the frozen read models; bounded provider-access smoke investigations in parallel.

**NS-G1 acceptance:**
- a ~40–45 traveller programme imports cleanly;
- one traveller can be added/updated individually through the same normalized contract;
- messy but reasonable input maps to validated drafts;
- missing facts remain missing/uncertain — never hallucinated or default-fabricated;
- shared commitments link correctly to individual Trips (Engagement linkage);
- the programme read model works;
- event/org policy and funding structures work;
- existing Checkpoint C behavior remains green;
- alternate event/location data requires no application-code change.

**NS-G1 RESULT — GREEN. NS_G1_SHA = `8ea33f2161a54e10c604a1ceb2758710470d5eac`** (branch `integration/northstar`). Evidence: 337/337 tests (43-traveller scale, manual/bulk equivalence, missing-fact honesty, commitment linkage by id, programme read model, deterministic funding, alternate-event substitution, REPLAY LLM mapping, programme HTTP + HTML surfaces); typecheck clean; lint clean; `npm run build` clean; targeted anti-hardcoding scan over `src/**` found no scenario/city/airline/fixture content (only `Asia/Singapore` timezone strings and incidental substring matches in comments). Per the gate definition this is an internal gate: the primary agent continues directly into Wave 2.

**NS-G1 is an internal integration gate, not a reviewer/human checkpoint.** When it is green the primary agent continues automatically into Wave 2. **Review 1 is no longer a scheduled mandatory gate** (former default reviewer DeepSeek-V4-Flash / fallback Kimi-K2.7-Code): a bounded different-family review of the Wave 1 seam may still be used voluntarily if evidence suggests a problem (architecture drift; conference/event-specific hardcoding; duplicated programme truth outside authoritative state; AI output bypassing validation/promotion; fabricated defaults / UNKNOWN becoming certainty; shared commitment semantics; intake equivalence; alternate-event substitution; frozen RV-N0 contracts silently changed; test quality), but it must not block Wave 2 progress as a scheduled gate.

### WAVE 2 — Resolution Capabilities → NS-G2 → Review 2

Goal: Northstar can initialise and resolve Trips through the generic engine.

Scope: RV-N3 initial viable trip creation; RV-N5 ChangeRequest/ResolutionTarget; RV-N6 Atlas reality path; RV-N7 hotel API adapter; RV-N8 routing + private-transfer reasoning; RV-N9 Model Studio runtime; plus event-side change fan-out completing RV-N1's signal path.

ChangeRequest must support the same generic contract for at least:
- **A1:** arrive earlier + leave later + traveller funds the extension (only A1 needs polished demo treatment);
- **A2:** later flight, direct preferred;
- **A3:** hotel closer to venue.

Hotel reality: one proper **real hotel API adapter is MINIMUM**. Candidate remains **Duffel Stays first, Nuitée fallback** if empirical access fails. Required real/sandbox lifecycle covers search / quote-or-revalidate / book / retrieve / policy / cancel as available; unsupported provider modification may use real cancel+rebook semantics. LIVE/SANDBOX and REPLAY share normalization/downstream code.

**RV-N7 status (corrected by REV-2 WP-R4):** the Duffel Stays adapter is **wired and REPLAY-proven against synthetic fixtures only**. It is composed into the runtime (`compose.ts`), `hotel.*` read-only tool operations route through it (`dispatch.ts`), the Wave-1 frozen env names `DUFFEL_TOKEN` / `DUFFEL_BASE_URL` are registered in config with `hasLiveCredentials('duffelStays')` (base URL defaults to the real host `https://api.duffel.com`), and the committed `fixtures/recordings/duffel-stays` corpus replays the full search / quote / book / retrieve / cancel / modify / stay-context lifecycle through the same normalization path as LIVE. **The real/sandbox lifecycle remains outstanding.** Blocker: the manual Stays-access step — Duffel Stays access must be requested and a `duffel_test_` token created; until a real capture exists, LIVE/RECORD fail closed with NOT_CONFIGURED. The unqualified "RV-N7 DONE / MINIMUM satisfied" claim recorded at NS-G2 is withdrawn by this correction.

**RV-N7 status (resolved by WP-R4-REDO, branch `fix/rev2-r4-nuitee` off `6dbc898`):** Duffel Stays is not available in Singapore — that regional unavailability is the empirical access failure foreseen by Section 13, so the documented clause "Duffel Stays first, **Nuitée fallback if empirical access fails**" **fired as designed** (the fallback was exercised, not overridden; `docs/reality-validation/02_HOTEL_PROVIDER_DECISION.md` §10 already graded Nuitée / liteAPI USE_SANDBOX + USE_LIVE). The Duffel adapter and its synthetic corpus are deleted; the **Nuitée (liteAPI) adapter** (`src/providers/hotel/nuiteeAdapter.ts`, providerId `nuitee`) now implements the frozen HotelCapability behind the same LIVE/RECORD/REPLAY seam: composed into the runtime, `hotel.*` read-only tool operations route through it, `NUITEE_API_KEY` / `NUITEE_SEARCH_BASE_URL` / `NUITEE_BOOKING_BASE_URL` are registered in config with `hasLiveCredentials('nuitee')`, base URLs default to the real Nuitee Connect hosts, and LIVE/RECORD fail closed with NOT_CONFIGURED without credentials. **A genuine provider capture now exists:** real sandbox credentials funded a RECORD run of the complete chain — search (174 real properties near the demo venue) → quote/prebook → book (sandbox booking confirmed) → retrieve → stay context → cancel — committed sanitized under `fixtures/recordings/nuitee/` with the frozen query literals in `test/fixtures/nuitee-hotel-queries.ts`. Two honest provider-shape facts: liteAPI has no in-place stay modification, so `modifyStay` returns a structured UNAVAILABLE failure (`nuitee_modify_not_supported`) and the descriptor omits `hotel.modify` — the frozen interface never widens; and date-only stay dates are omitted from IsoDateTime fields rather than padded with invented times. RV-N7's MINIMUM claim is now backed by a real/sandbox lifecycle recording, restoring the claim withdrawn by the WP-R4 correction.

**NS-G2 backend convergence acceptance** — all four traverse the same generalized planning/overlay/viability/authority/execution/observation architecture where applicable:
- **0:** incomplete/no-valid-trip → viable Trip;
- **A:** traveller changes desired target;
- **B:** provider changes current reality;
- **C:** AnchorEvent/shared commitment changes objective/context.

**NS-G2 RESULT — GREEN (candidate pushed for Review 2). NS_G2_CANDIDATE_SHA = `91648aa481e598d42ac92769d3f550c0b7050e4b`** (branch `integration/northstar`). Evidence: 395/395 tests, including `test/northstar-convergence.test.ts`, which drives all four paths over the REAL composed HTTP runtime in REPLAY with ZERO provider/model credentials: path 0 engagement-only trip → INITIAL_PLANNING case → flight.search evidence → feasible strategy → REQUIRES_TRAVELLER authority → gate refusal without approval → traveller approval → SIMULATED execution → observation CONFIRMS the leg → verified RESOLVED + `remainderViable` VIABLE + programme view moves the traveller off PLANNING; path A ChangeRequest window shift → same planning loop re-searches the route for the requested date → evidence-bound replacement strategy; path B FLIGHT_CANCELLATION → shared signal pipeline opens the recovery case → evidence-bound replacement, unrelated trip untouched; path C commitment RESCHEDULED fans out ONLY to linked trips (linkedTripCount = linked trips, unlinkedTripCount = 0) and moves authoritative engagement facts through the fact-authority ladder. Honest-UNKNOWN evidence in the same run: missing home airport fails closed with explicit uncertainty (no fabricated route), execution without traveller approval is refused by the deterministic gate with gate issues, and malformed commitment-change payloads are rejected without state surgery. Gate checks: full suite green; typecheck clean; lint clean; `npm run build` clean; targeted anti-hardcoding scan over `src/**` found no scenario/city/airline/fixture content (programme-name identifiers and incidental substrings only); secrets scan over recordings/providers found no secret values. Wave 2 RV status at this candidate: RV-N3 initial viable trip (DONE); RV-N5 generic ChangeRequest A1/A2/A3 (DONE); RV-N6 Atlas LIVE/RECORD/REPLAY (DONE, REPLAY-first, LIVE fails closed without credentials); RV-N7 Duffel Stays hotel adapter (wired and REPLAY-proven against synthetic fixtures; real sandbox lifecycle outstanding — corrected by REV-2 WP-R4); RV-N8 routing/private-transfer reasoning (DONE); RV-N9 Model Studio runtime (DONE); Case C fan-out with authoritative fact propagation (DONE). Note (REV-2 correction): the earlier "`git push` remains blocked" remark was stale — `integration/northstar` IS on the origin remote at `3009706` (verified via `git ls-remote` during the REV-2 fix set). Per the wave definition this completes Wave 1+Wave 2 as one continuous mission; Independent Review 2 (default DeepSeek-V4-Pro Max) is now the next mandatory gate and is NOT run by the implementation agent.

**Review 2 (mandatory, after NS-G2):** default reviewer **DeepSeek-V4-Pro Max** — an intentional premium use because this is the highest-risk integrated backend checkpoint. Fallback: **GLM-5.3 Max** only if reviewer independence is preserved (GLM did not materially implement/debug/fix the reviewed paths). Architecture/review escalation if required: **GPT-5.6 Sol High** or **Claude Opus 5 High**. Adversarial focus: current authoritative state vs desired target state; model-created judging criteria; mutation safety; overlay isolation; deterministic viability; UNKNOWN never treated as PASS; mixed-funding and policy correctness; authority/approval paths; LLM → irreversible API prohibition; execution gate; provider success != resolved case; observation and state update; event-level fan-out correctness; unrelated Trips remaining unaffected; LIVE/RECORD/REPLAY identical normalization; hotel and Atlas provider boundaries; provider failure/degradation; alternate event/location generalisation; hardcoding; meaningful tests rather than scripted assertions. Architecture disagreements from Review 2 may be escalated to **GPT-5.6 Sol High** or **Claude Opus 5 High**.

### REV-2 — Independent Review 2 outcome and fix set (branch `fix/rev2-ns-g2` off `3009706`)

**Review 2 verdict on NS-G2 candidate `91648aa`: FAIL — FIX REQUIRED.** Five Act Now findings (three checkpoint-threatening); the suite was green (395/395) and the anti-hardcoding scan clean, the failures being behavioural and hidden by vacuous assertions. Review 2 confirmed the generalized engine is genuinely one engine: fan-out isolation, overlay isolation, the LLM intake boundary and anti-hardcoding all hold.

**Fix packages (each reproduced failing-first at `3009706` before fixing):**
- **WP-R1 judging-criteria integrity** — a candidate may not waive the objective that judges it: overlay guard extended to objectives referenced by the base snapshot; `consequentialOperationFor` no longer classifies waiver-bearing strategies as REVERSIBLE/SIMULATION, so waivers reach an approval-requiring authority outcome; waiver admission into observation now carries explicit approved-authority provenance. WAIVE_OR_REPRIORITIZE_OBJECTIVE stays in the mutation vocabulary (ADR-033).
- **WP-R2 judgeable programme trips** — promotion now emits, through the validated MutationService path only: a deterministic TEMPORAL HARD arrival constraint per commitment-linked engagement (buffer as parameter, existing vocabulary), attached programme rule sets on Trip/element `governedByRuleSetIds`, and objective hardness derived from draft/commitment evidence with recorded decisions instead of a silent SOFT constant. The absurd-candidate probe becomes `feasible: false` with a named hard failure.
- **WP-R3 whole ResolutionTarget, direction-based leg selection** — changeRequest forwards the complete declarative target; the planner selects the leg by direction from place evidence (arriveBy → leg arriving at the event place; departAfter → leg departing it), emits one search per requested dimension, and records explicit uncertainty for every unactionable dimension (preferDirect, departure bounds, stay proximity, objective effects). Full A2 ranking and A3 hotel re-search remain honest visible non-support (no hotel search capability composed).
- **WP-R4 hotel minimum wiring + tracker honesty** — Duffel Stays adapter composed and routed (hotel.context/search/quote/retrieve), `DUFFEL_TOKEN`/`DUFFEL_BASE_URL` registered per the Wave-1 probe plan with `hasLiveCredentials('duffelStays')`, real-host default base URL, NOT_CONFIGURED fail-closed LIVE/RECORD, REPLAY corpus moved to `fixtures/recordings/duffel-stays/`. RV-N7 tracker claims corrected to "wired and REPLAY-proven against synthetic fixtures; real sandbox lifecycle outstanding" (see Section 13 RV-N7 status).
- **WP-R5 determinism and allocation** — `allocateCost` iterates to the first FUNDED_WINDOW rule whose window CONTAINS the anchor (payer stable under rule reordering); composed NorthstarPlanner gets a deterministic id factory and snapshot-derived timestamps (ADR-029); the timezone resolver only honours airport-code-family refs (`airport-code`, `iata`/`IATA` — the accepted scenario/normalization vocabulary), never city/venue/property refs (ADR-028 fail-closed).
- **WP-R4-REDO Nuitée replaces Duffel Stays (branch `fix/rev2-r4-nuitee` off `6dbc898`)** — Duffel Stays is unavailable in Singapore, so the Section 13 fallback clause ("Duffel Stays first, Nuitée fallback if empirical access fails") fired as designed; this is the documented fallback being exercised, not overridden. `NuiteeAdapter` implements the frozen HotelCapability (getStayContext/searchHotels/quoteRate/bookStay/retrieveBooking/cancelStay wired; `modifyStay` returns a structured UNAVAILABLE failure because liteAPI has no in-place modification — the contract never widens); `NUITEE_*` env names registered with fail-closed NOT_CONFIGURED; real-host default base URLs; **genuine RECORD capture** of the full search → quote → book → retrieve → stay-context → cancel chain against the liteAPI sandbox committed to `fixtures/recordings/nuitee/` (sanitized, replayed credential-free by `test/northstar-hotel.test.ts` and `test/rev2-r4-hotel-wired.test.ts`). Duffel adapter, corpus and config names deleted. RV-N7 MINIMUM claim restored on genuine evidence (see Section 13 RV-N7 status).

**Test quality (Review 2 core criticism):** the vacuous convergence assertions were replaced with assertions that fail if viability is removed; path C gained a genuinely unlinked trip in the same event plus a second event so isolation is actually exercised; every fix landed with a failing-first regression test.

**PARK (recorded per Review 2; deliberately NOT fixed in the REV-2 set):**
1. Case C stops at fan-out + fact update (no planning/overlay/authority/execution). Defensible under NS-G2's "where applicable" + Wave 3 RV-N11, but the "one engine" claim for C is weaker than for 0/A/B. Revisit in Wave 3 RV-N11 integration.
2. `src/app/initialPlanning.ts` `hasBookedElement` checks all elements including ENGAGEMENT, contradicting its own docstring; a CONFIRMED registration would be refused initial planning.
3. `src/app/changeRequest.ts` `findOpenCaseForTrip` reuses any non-RESOLVED case (including EXECUTING and INITIAL_PLANNING) and never appends the new signal to `triggeredBySignalIds`.
4. `src/app/signalPipeline.ts` + `src/app/programme.ts`: a fan-out whose per-trip mutations were all rejected still reports `accepted: true, linkedTripCount: N`.
5. `northstarPlanner.previousLocalDate` slices the destination-local date off the event window and uses it as an origin departure date — systematically off for long-haul and date-line routes.
6. (Tracker hygiene, closed by this record) the stale "git push remains blocked" note — `integration/northstar` is on the remote at `3009706`.

### WAVE 3 — Integrated Northstar Product → NS-G3 → Stretch pull decision

> **NOT ACCEPTED / superseded (24 Aug 2026).** The candidate produced under this
> section's NS-G3 path did not pass the human product-owner checkpoint. Wave 3R
> ("Demo Readiness & Live Validation Closure") replaces the remainder of this
> section's execution with a stricter, provider-reality-validated closure path.
> See `docs/WAVE3R_DEMO_READINESS_PLAN.md` for the active work packages
> (DR-0..DR-13) and gates (G3R-R0/R1/R2). This section is preserved as history
> and is not reopened; do not resume executing it directly. RV-N0, NS-G1, NS-G2,
> and Independent Review 2 above remain accepted.
>
> Status update: Gate G3R-R0 (frozen flight-transaction contracts) is **ACCEPTED**
> at SHA `0c2f782ffbaf4fc569ab09f8ccad22e52c537516` (published as
> `origin/g3r-r0-fix`); Mission 1 (DR-1/DR-2, runtime truth + real provider
> execution) executes on branch `wave3r/runtime-execution` against that frozen
> seam. See `docs/WAVE3R_DEMO_READINESS_PLAN.md` for gate results.
>
> Status update (25 Aug 2026): Mission 3 (LOCAL REALITY CONVERGENCE →
> NS-G3R candidate) executed on branch `wave3r/reality-convergence` from base
> `7c53296`. LIVE evidence captured for Model Studio, Atlas sandbox
> (search/verify/hold/pay/retrieve/cancel incl. voidQuotation READ_ONLY
> probe), Nuitée (quote→book→CONFIRMED→cancel→verify), bounded Google Routes,
> and the POST /api/events/atlas ingress chain; all four product scenarios
> (S1–S4) driven through real HTTP surfaces in REPLAY; organiser+traveller
> browser clickthrough green (which surfaced and fixed a traveller
> decision-form wiring defect); sanitisation/replay-parity/reseed-determinism
> evidence committed under `output/wave3r-mission3-*`. Gate: 582/582 tests,
> typecheck/lint/build clean. One explicitly unresolved finding kept honest:
> window-shift planning fails closed on shipped fixtures whose event venues
> carry no airport-code ref (no venue→airport link mechanism exists).
> Candidate published for NS-G3R review; NOT merged to `main`.
>
> Status update (26 Aug 2026): NORTHSTAR FX/home-currency normalization
> (ADR-052) executed on branch `wave3r/fx-home-currency` from base `786d9cd`
> (Mission 3 SSOT baseline). Provider quotes may arrive in any currency;
> organisation policy states a configurable home currency (`Organisation.homeCurrency`,
> demo fixtures state SGD explicitly — no engine default). Authority compares
> gross spend against evidenced, effective, trusted FX restatements only and
> still fails closed on missing/stale/untrusted evidence (ADR-045 preserved);
> the executor pays the ORIGINAL provider amount frozen at authorisation, so a
> later FX move can never raise the authorised charge. Application-owned
> `fx_rates` SQLite store + optional per-scenario `fx-rates.json` seeding via
> the generic bundle path. Gates: 602/602 tests (incl. new
> `test/northstar-fx-normalization.test.ts` pinning the required matrix plus an
> alternate EUR/JPY-home dataset), typecheck/lint/build clean, anti-hardcoding
> scan clean. Contract delta is additive-only and recorded in ADR-052.

Goal: turn the accepted backend into the judge-facing product.

Scope: complete operator programme dashboard; traveller mobile surface; missing-information traveller flow; natural-language change request; approvals; event-wide status/risk summaries; endangered commitments; system activity/audit; honest provider provenance; integrated RV-N11 Cases A/B/C (Case A traveller target change / mixed funding; Case B provider disruption hero case; Case C event-side commitment change).

**NS-G3 is a PRODUCT/DEMO checkpoint, not another mandatory broad code review.** The human product owners evaluate:
- programme scale immediately understandable;
- value beyond a travel-agent chatbot;
- Case B graph/state advantage visible;
- Case C proves Northstar is not an airline IROPS wrapper;
- Case A policy/authority reasoning understandable;
- operator sees exceptions/decisions rather than 40 itineraries;
- traveller can answer "am I okay?";
- LIVE / SANDBOX / RECORD / REPLAY / SIMULATED labels truthful;
- demo flow is cinematic and concise.

**Stretch pull decision (only after NS-G3, and only if Minimum A/B/C are integrated and reliable):**

| # | Stretch item |
|---|---|
| S1 | Hotelbeds Transfers transactional adapter (Stretch P1 #1) |
| S2 | Bounded immigration/entry context — **Stretch P1, NOT Park** |
| S3 | Event URL / programme re-ingestion |
| S4 | Disruption/email ingestion |
| S5 | Northstar Skill |
| S6 | Richer insurance path |
| S7 | Live Google Routes with corrected guardrails |
| S8 | Atlas baggage/seats if useful |

Event/org policy, supplier policies, and one useful insurance-policy path remain supported data/context. **Do not start new Stretch work after 26 Aug** unless it closes an existing demo blocker.

### WAVE 4 — Stabilisation / Code Freeze → Final Candidate Review

RV-N12 becomes the stabilisation/reliability wave. Repeatedly prove:

```
fresh/reset → programme → initial planning → Case A
reset → Case B
reset → Case C
```

Also exercise failure/degradation paths — Atlas unavailable; hotel unavailable; model unavailable; malformed AI; missing traveller facts; approval declined; no viable recovery. Expected result may be **recover / degrade / ask / block / escalate**. Never crash or silently fabricate success.

Then, on the stabilised candidate: full suite; typecheck; lint; build; hardcoding audit; reset/reseed; restart persistence; provider/model fallbacks; secret/recording sanitation; README/DEMO/ROADMAP implementation truth.

**Final review routing:** the existing Final Candidate Review is preserved. Preferred final independent reviewer: **Claude Opus 5 High/Max externally** — the main implementation is Qwen-heavy, GPT-5.6 Sol is already acting as architecture/lead support, and Opus gives a strong independent ceiling family for release review. If external Opus is unavailable, follow `docs/AGENT_MODEL_SELECTION.md` escalation guidance and document the substituted reviewer.

### Scope record (RV-N0 freeze, corrected at EXECUTION_BASE)

- **MIN (must have):** A–J contract schemas, commitment linkage, intake drafts with manual/bulk/LLM-assisted mapping, initial planning path, ChangeRequest variants A1/A2/A3, funding rules, event-side signal, programme read model, hotel/transfer seams with one real hotel API adapter, routing + private-transfer reasoning, temporal normalization, operator dashboard + traveller mobile surface, Cases A/B/C frozen, doc SSOT updates.
- **STRETCH (S1..S8, pull after NS-G3):** Hotelbeds Transfers adapter (S1); bounded immigration/entry context (S2 — Stretch P1, NOT Park); event URL/programme re-ingestion (S3); disruption/email ingestion (S4); Northstar Skill (S5); richer insurance path (S6); live Google Routes with corrected guardrails (S7); Atlas baggage/seats (S8); multi-window funding splits; ~40–45 traveller performance headroom beyond smoke.
- **PARK:** participant sourcing/registration/CRM/ticketing, partial-attendance heuristics, coordinated multi-traveller changes, insurance claim automation.
