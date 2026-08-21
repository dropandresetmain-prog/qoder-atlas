# Implementation Plan

**Status:** Active execution SSOT. F0–F3 (Checkpoint A) implemented; targeted review-fix pass applied (3592a0e); awaiting formal acceptance.  
**Product:** AI Trip Recovery / Resolution Layer  
**Execution environment:** Qoder by default  
**Agent-routing authority:** `docs/AGENT_MODEL_SELECTION.md`

This is the single active implementation plan for the hackathon build. Qoder Quest Specs and Agent-mode prompts are bounded execution contracts derived from this plan. They may add implementation detail but must not silently redefine product scope, architecture, shared contracts, or acceptance criteria.

Read with:
- `docs/PRODUCT_SPEC.md` — product requirements (`FR-*`, `NFR-*`)
- `docs/ARCHITECTURE.md` — logical architecture and invariants
- `docs/ROADMAP.md` — product scope/status, including Stretch/Deferred
- `docs/TESTING.md` — verification taxonomy (`T-*`)
- `docs/DECISIONS.md` — settled architecture decisions
- `docs/AGENT_MODEL_SELECTION.md` — model/interface routing
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
- **Independent review:** only for a material architecture/high-risk change or the final candidate gate.
- **Final candidate:** broad canonical build/typecheck/lint/test/generalisation/replay/secret gate on the exact SHA.

A targeted review fix needs targeted proof that the finding is closed. It does not restart the entire review cycle automatically.

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
- Atlas Singapore fixture availability may improve the demo but must not shape domain logic;
- Atlas state-changing order execution remains Stretch until the read-only Search/Verify loop and authority/executor boundary are stable.

## 3. Build checkpoints

There are **three build checkpoints plus one final candidate gate**. Work packages below are execution units, not extra milestones.

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

Stop for user/lead acceptance only after:
- F0–F3 compile/load/pass their scoped checks;
- `PROJECT_FILE_MAP.md` exists;
- Section 6 has exact paths;
- the execution tracker records actual base SHA/evidence;
- architecture/decisions docs are reconciled for any material change;
- both scenarios fit without special-case application logic.

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

Stop for user/lead checkpoint only when:
- Scenario A executes I1–I5 without manual state edits;
- Atlas Search/Verify/rules have real adapter evidence and replay the same path;
- unsupported external action boundaries are explicit/simulated honestly;
- UI shows actual state transitions;
- authority cannot be bypassed;
- restart/reload preserves critical Trip/Case state;
- no Stretch capability is required for a valid loop.

If this fails, do not start Stretch work.

# Checkpoint C — Generalisation, reliability, demo candidate

**Outcome:** same engine proves Scenario B, selected robustness, hardcoding discipline, and reliable replay/failure behavior.

Continue primarily in the integration worktree. User involvement is not required between Checkpoint B and C unless a hard stop condition occurs.

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

Stop for user/lead checkpoint only when:
- Scenario A full replay works reliably;
- Scenario B passes without application-source changes;
- selected robustness tests pass;
- hardcoding audit passes;
- reset/reseed and restart work;
- roadmap accurately reflects every cut/stretch/deferred/blocked/implemented item.

This integrated SHA becomes the **demo candidate**.

# Final candidate gate

This is the one planned independent review checkpoint.

Prefer a different family from the primary integrator, but **do not select DeepSeek-V4-Pro merely for family independence**.

Preferred review order:
1. **external GPT-5.6 Sol High or Claude Opus 5 High** for consequential final-candidate review when available;
2. if Qoder-only, **GLM-5.3 Max** when the risk is deterministic/provider/debugging-heavy or **Kimi-K3 High/Max** when broad repository context is the issue;
3. **Kimi-K2.7-Code / DeepSeek-V4-Flash** for bounded targeted follow-up review;
4. **DeepSeek-V4-Pro** only when a specific hard/adversarial reasoning need remains after cheaper review or we deliberately want a Pro benchmark.

Review:
- deterministic mutation/viability;
- authority and irreversible-action gates;
- provider boundaries;
- LIVE/RECORD/REPLAY equivalence;
- persistence;
- policy/constraint enforcement;
- AI schema boundaries;
- demo hardcoding;
- user-facing claims vs implemented reality.

Every finding is triaged:
`Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

Only Act Now findings that block demo truth/correctness/safety must be fixed before candidate acceptance. Fixes require targeted proof, not automatic full-review repetition.

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
| A1 | Persistence + validated mutation | Not Started | F1,F2 | core | Qwen3.8 xHigh; Qwen3.7 Max long-horizon value | — |
| A2 | Constraints + blast radius | Not Started | A1,F3 | core | Qwen3.8 xHigh; GLM-5.3 Max if hard logic/debug | — |
| A3 | Overlays + viability | Not Started | A2 | core | Qwen3.8 xHigh; Qwen3.7 Max value; GLM if debugging | — |
| A4 | Case + authority + observation | Not Started | A1,A2,F2 | core | Qwen3.8 xHigh; GLM-5.3 for hard authority/state seam | — |
| B1 | Source/provenance framework | Not Started | F1,F2 | ingestion | Qwen3.8 Medium; Qwen3.7 Max; Plus/K2.7 helpers | — |
| B2 | Web/document/policy/insurance ingestion | Not Started | B1 | ingestion | Qwen3.8 Medium/xHigh; Plus/K2.7 helpers | — |
| B3 | Traveller/research context | Not Started | B1,D1 | ingestion | Qwen3.8 Medium/xHigh; Qwen3.7 Max | — |
| C1 | Provider modes + recording/error envelope | Not Started | F2 | providers | Qwen3.8 Medium; Kimi-K2.7-Code alternative | — |
| C2 | Atlas Search/Verify/rules | Not Started | C1 | providers | Qwen3.8 xHigh; GLM-5.3 High/Max for provider debugging | — |
| C3 | Google Routes optional adapter | Not Started | C1 | providers | Qwen3.7-Plus / Kimi-K2.7-Code / Qwen3.8 Medium | — |
| D1 | Model Studio structured client | Not Started | F1,F2 | intelligence | Qwen3.8 Medium / Kimi-K2.7-Code | — |
| D2 | Semantic preferences + research | Not Started | D1,F3 | intelligence | Qwen3.8 xHigh / Qwen3.7 Max | — |
| D3 | RecoveryPlanner | Not Started | D1,A2,F2,F3 | intelligence | Qwen3.8 xHigh; Kimi-K3 only as premium long-horizon trial; GLM if debugging | — |
| E1 | User journeys + read-model fixtures | Not Started | F2,F3 | ui | Qwen3.8 Medium / Kimi-K2.7-Code / Plus helpers | — |
| E2 | Operator + traveller UI | Not Started | E1 | ui | Qwen3.8 Medium / Kimi-K2.7-Code; Composer 2.5 external optional | — |
| I1–I5 | Vertical integration | Not Started | lane outputs | integration | Qwen3.8 xHigh; GLM-5.3 hard seams; Kimi-K3 only if breadth/endurance warrants | — |
| G1 | Scenario B substitution | Not Started | Checkpoint B | integration | Qwen3.8 xHigh / Qwen3.7 Max | — |
| G2 | Selected robustness | Not Started | Checkpoint B | integration/core | Qwen3.8 xHigh; GLM-5.3 if debugging-heavy | — |
| G3 | Hardcoding audit | Not Started | G1 | review/bounded | Kimi-K2.7-Code / DeepSeek-V4-Flash / Plus; different-family preferred | — |
| R1 | Reliability/replay | Not Started | Checkpoint B | integration | Qwen3.8 xHigh; GLM-5.3 for hard failures | — |
| FINAL | Candidate review/release gate | Not Started | Checkpoint C | fresh reviewer | Sol/Opus preferred; Qoder-only GLM-5.3 or Kimi-K3 by risk; V4 Pro only explicit hard need | — |

Statuses: `Not Started | In Progress | Blocked | Implemented | Integrated | Complete | Dropped`.

**Checkpoint A safe fan-out SHA:** the pushed `main` HEAD containing this tracker update (review-fix code at `3592a0e`, docs update `2f44a0b` preserved). Lane worktrees fan out from that SHA after formal acceptance.

`Implemented` = package completed/verified in lane.  
`Integrated` = merged and seam-tested.  
`Complete` = relevant checkpoint gate passed.

## 5. Requirement / verification traceability

Minimum traceability; task Specs may add narrower evidence but cannot delete required evidence.

| Package | Primary requirements | Required evidence |
|---|---|---|
| F0 | NFR-03,NFR-05 | runnable/no-credential smoke, SQLite round trip, baseline commands |
| F1 | FR-01,03–06,09–11,14; NFR-01,02,04 | `T-DOM` |
| F2 | FR-07,08,10–16 | contract tests / relevant `T-DOM` |
| F3 | NFR-01,02 | scenario schema-load assertions |
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
| G1 | NFR-01,02 | `T-GEN` Scenario B |
| G2 | exercised FRs | selected evaluator/propagation/overlay/authority tests |
| G3 | NFR-02 | hardcoding portion of `T-GEN` |
| R1 | FR-14,15; NFR-03,05,06 | persistence/fallback/replay E2E |
| FINAL | all implemented MVP requirements | `T-RELEASE` |

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
F0 -> F1 -> F2 -> F3 -> CHECKPOINT A
                     |
        +------------+-------------+-------------+-------------+
        |            |             |             |             |
      Lane A       Lane B        Lane C        Lane D        Lane E
   A1->A2->A3    B1->B2       C1->C2       D1->D2       E1->E2
    \    ->A4     \->B3        \->C3        \->D3
        |            |             |             |             |
        +------------+-------------+-------------+-------------+
                                  |
                          I1 -> I2 -> I3 -> I4 -> I5
                                  |
                           CHECKPOINT B
                              /       \
                            G1         R1
                              \       /
                               G2/G3
                                  |
                           CHECKPOINT C
                                  |
                                FINAL
```

D1, C1, B1, E1 and A1 can begin as soon as their frozen dependencies exist. Integration should begin incrementally as seam pairs stabilize rather than waiting for lane polish.

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

## 12. What happens first

Run **F0–F3 as one Foundation/Contract long-horizon task**.

Preferred interface: **JetBrains Qoder Agent Mode** if it is the most stable surface. Quest is also suitable. CLI `/goal`/worktree execution is optional.

Preferred model for equivalent future foundation work: **Qwen3.8-Max xHigh**. For the upcoming build, use **Qwen3.7-Max** as the first long-horizon/value experiment on a substantial frozen package, then compare against **Qwen3.8-Max xHigh**; test **Kimi-K3 High/Max** only after the Qwen baselines if a premium endurance/context comparison is useful.

The initial prompt must instruct the agent to:
1. inspect current SSOT docs and authoritative Atlas research;
2. execute F0–F3 sequentially;
3. recover transient terminal/tool problems using `.qoder/rules/environment-recovery.md`;
4. make ordinary implementation decisions autonomously;
5. update `PROJECT_FILE_MAP.md`, exact path ownership, tracker/evidence, and any actually changed architecture decisions;
6. run only F0–F3 scoped verification;
7. continue until **Checkpoint A** unless a Section 2.5 hard stop occurs;
8. stop at Checkpoint A with a concise contract-freeze report for user approval.

Only after Checkpoint A acceptance should the five implementation lanes launch in parallel.
