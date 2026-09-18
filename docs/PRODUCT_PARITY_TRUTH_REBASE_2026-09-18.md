# NORTHSTAR Truth Rebase / Product Parity Audit

**Date:** 2026-09-18  
**Repository:** `dropandresetmain-prog/qoder-atlas`  
**Authoritative branch at audit:** `feature/sarah-provider-disruption`  
**Audited tip:** `657a0da88dfa5612a9e1df281028e27d53699c6b`  
**Audit type:** READ-ONLY static product/architecture archaeology  
**Status:** Current product-truth rebase. Historical M9/M10/C4/C5/Fable evidence remains historical evidence and should not be rewritten.

---

# 1. Executive verdict

## Verdict

**Yes. NORTHSTAR suffered a material product-capability regression during the refactor.**

The PostgreSQL/data refactor itself was **not the mistake**. Most of the difficult architectural work was directionally correct and materially improved NORTHSTAR:

- normalized PostgreSQL ownership;
- separate Traveller / Trip / Journey / Programme / Participation truth;
- durable ChangeSignals;
- better dependency closure;
- substantially stronger M6 assessment semantics;
- immutable counterfactual ScenarioChange overlays;
- RC-6 counterfactual viability;
- much stronger authority;
- durable execution attempts;
- correct `OUTCOME_UNKNOWN` / reconciliation semantics;
- provider success explicitly separated from trip recovery;
- much stronger RecoveryCase resolution rules;
- reusable provider adapters and LIVE / RECORD / REPLAY boundaries.

The primary failure was a **combination of product interpretation, integration, milestone scoping and acceptance testing**.

The crucial mistake was:

> “The new PostgreSQL architecture has an alternative implementation of recovery/UI” became “therefore the old product capabilities have been superseded.”

That second statement was never proven.

The first material divergence became operational in **M10**, when the normal boot path was switched exclusively to the PostgreSQL target and the old rich UI plus `RuntimeOrchestrator` were explicitly classified `RETIRE`, based on an unverified assumption of behavioural supersession.

That eliminated normal-runtime access to working capabilities including:

- multi-round provider/tool research during planning;
- provider flight/hotel alternative generation;
- deterministic candidate ranking;
- persisted rejection evidence;
- selected/best-strategy evidence;
- sequential follow-on recovery;
- rich operator Case information architecture;
- rich activity/reasoning presentation;
- whole-trip plan presentation;
- considered/rejected option presentation.

The current target then rebuilt enough pieces to demonstrate a **programme recovery loop**, but the existence of that loop was later interpreted as “the engine is complete.”

It is not complete against the frozen product definition.

**Another engine rewrite is not required.**

That would be exactly the wrong reaction.

The correct architecture is:

**keep the PostgreSQL state/evaluation/authority/execution spine  
+ adapt the useful planning/reasoning capabilities from the pre-refactor system onto it  
+ restore/adapt the useful product surfaces over PostgreSQL read models  
+ then prove full B1  
+ then compose external execution for B2.**

Do not resurrect `RuntimeOrchestrator` wholesale.  
Do not revive SQLite.  
Do not create another recovery engine.

### Major-decision record

**WHAT WE KNOW**

The original refactor plan itself says to:

> “Preserve sound deterministic algorithms and provider normalization while replacing ambiguous aggregate/persistence boundaries.”

M0 explicitly introduced schema/type contracts only and did not change runtime. The PostgreSQL ontology can express the generalized product. Current code already contains most deterministic machinery required.

**WHAT WE DO NOT KNOW**

The exact durable representation for all considered-but-rejected planning evidence is not yet frozen. Also, the current UI repairs at `657a0da...` have not been founder-accepted against the **rebased** B1 definition.

**KEY ASSUMPTION**

Owner product truth in this audit supersedes the current narrow B1/B2 milestone interpretation, while accepted PostgreSQL structural decisions remain valid unless a concrete contradiction is found.

**WHAT SHOULD BE DECIDED/TESTED NEXT**

Freeze the rebased capability contract and planner/evidence interfaces before implementation. Do **not** proceed to current B2.

---

# 2. Owner product truth

The frozen NORTHSTAR product loop is:

`change / request / new information`  
→ canonical authoritative state update  
→ determine affected scope  
→ assess whole-trip consequences  
→ identify relevant recovery domains  
→ gather missing internal/external evidence  
→ generate cross-domain recovery strategies  
→ validate candidate structure  
→ deterministic viability / dependency / blast-radius evaluation  
→ compare viable strategies  
→ recommend and explain preferred recovery  
→ obtain authority / decision  
→ execute permitted actions  
→ observe actual outcome  
→ update canonical state  
→ reassess  
→ repeat until valid or explicitly escalated.

The non-negotiable split is:

**AI proposes and judges semantics. Deterministic systems prove and authorize.**

AI can identify recovery domains, request research, generate candidates, assess semantic trade-offs and explain recommendations.

Deterministic code owns hard constraints, provider facts, arithmetic, policy thresholds, dependency propagation, viability, authority, execution validation, observations and resolution.

The irreversible boundary remains:

`AI proposal`  
→ validation  
→ deterministic viability  
→ authority  
→ executor  
→ observation  
→ canonical state  
→ reassessment.

A replacement booking is never synonymous with a recovered trip.

A refactor may replace implementation mechanics. It may not silently eliminate working product behaviour.

---

# 3. Timeline of divergence

| Date / commit | Decision/change | What it was trying to solve | What was correct | What regressed / was unproven | Evidence |
|---|---|---|---|---|---|
| 2026-09-13 `29118bccac` | Freeze data architecture/refactor plan | Correct data/state deficiencies | Explicitly says preserve sound deterministic algorithms/provider normalization while changing ownership/persistence | Nothing yet | `docs/IMPLEMENTATION_PLAN.md` |
| 2026-09-13 `c8a1c3a985` | M0 v2 contracts | Freeze ontology/contracts | Correct; commit explicitly says contracts are schema/type only and not production-runtime imported | Nothing yet | commit message; `docs/refactor/CONTRACTS.md` |
| 2026-09-13 onward M1-M6 | PostgreSQL foundations and evaluator | Normalize durable state and deterministic evaluation | Major architectural improvement | No evidence of product retirement being required | PG migrations, M6 registry/evaluation |
| 2026-09-15 M7 | RecoveryStrategy / ScenarioChange / ActionPlan | Create current candidate/overlay model | Correct architecture; current model is more generalized than old aggregate overlay | Planning orchestration parity not yet established | `src/resolution/scenarios/**`, `src/resolution/planning/**` |
| 2026-09-15 `76286846ac` | M9 product surfaces and PG assemblers | Expose PostgreSQL state through `/api/v2/*` | Valid target integration surfaces | They were treated increasingly as replacements despite not matching old product capability | `docs/refactor/evidence/M9.md`, v2 read models |
| 2026-09-15 `6e6dbfdb32` | M9 C4 candidate | Finish opt-in target PG product HTTP | Correct PG integration progress | Still no old-vs-new product/planner parity gate | M9 evidence |
| C4 accepted `c45a928...` | Targeted M9 review | Verify 11-item M9 remediation checklist | Appropriate for its stated scope | **Not a product parity audit** | `docs/refactor/evidence/C4_ACCEPTANCE.md` |
| **2026-09-16 `cfce650b17`** | **M10 flips normal boot to PG-only target** | Make PostgreSQL sole normal runtime | Correct objective; SQLite should leave normal runtime | **FIRST MATERIAL DIVERGENCE:** old UI and old recovery lifecycle become unreachable before behavioural parity is proven | `src/main.ts`, `src/server/targetHttp.ts`, M10 ledger |
| 2026-09-16 M10 ledger | Old operator surfaces explicitly classified `RETIRE`; `RuntimeOrchestrator` classified `RETIRE` | Complete runtime convergence | Correct not to port SQLite code literally | Incorrect claim that `/api/v2/*` and M6-M9 **fully superseded** their product behaviours | `docs/work/M10_ACTIVE_TASK.md` |
| 2026-09-16 `0c5015a4ad` | Formal M10 retirement inventory | Ensure no unresolved compatibility runtime | Good operational discipline | Reinforced the unproven behavioural retirement decision | commit + M10 evidence |
| 2026-09-17 accepted C5 `87783c0...` | PostgreSQL-only candidate accepted | Data/runtime cutover readiness | Correct persistence/cutover result | C5 inherited product-parity assumptions; it did not independently prove old capabilities had new homes | C5 lineage; post-C5 ledger |
| 2026-09-17 `57bcf06367` | Canonical AiT PG product boot | Restore real population/product state | **Correctly repairs one major product regression:** adds `population[]` alongside case-driven `items[]` | Recovery planner and rich focused Case still incomplete | commit; v2 read-model diff |
| 2026-09-18 post-C5/Fable audit | Audit operational runtime composition | Explain 67-unit fan-out and disconnected runtime pieces | Correctly finds runtime composition, ChangeSignal, escalation and proposer gaps | Did not inspect pre-refactor product/planner parity | `POST_C5_RUNTIME_ARCHITECTURE_AUDIT.md` |
| 2026-09-18 `82ae9b8...` | Close narrow B1 | Prove deterministic internal programme recovery | Successfully proves current state/viability/approval/internal execution loop | Later interpreted as complete NORTHSTAR recovery engine despite intentionally narrow proposer scope | B1 evidence/current docs |
| 2026-09-18 Founder B1 | Physical product test | Verify operator can use Sarah loop | Correctly exposes UI failure | Test itself does not exercise travel-option research or cross-domain recommendation | `FOUNDER_B1_PHYSICAL_FINDINGS.md` |
| Current `657a0da...` | B1 product acceptance repair | Fix navigation/shell/readability | Repairs several genuine UI defects | Still based on rejected “programme-only B1 + no ranking” acceptance definition | `ACTIVE_TASK.md`; `product-recovery-case.ts` |

### First material divergence

The **architectural precursor** was M9 treating new target surfaces as “product surfaces.”

The **first material regression** was M10 `cfce650b17`, because normal runtime was changed so the old product/runtime stopped being reachable while the new path had not demonstrated equivalent behaviour.

---

# 4. Full capability parity matrix

| Capability | Product requirement | Pre-refactor implementation | Current PostgreSQL implementation | Disposition | Gap | Recommended next action | Evidence |
|---|---|---|---|---|---|---|---|
| 1. Change/event ingestion | Changes become durable state/provenance | Event inbox + normalizers + Trip matching | ChangeSignal + PG observation/ingress materially stronger | ADAPT | General provider-ref correlation remains incomplete | **Park for Later** unless required by B1 input path | M10 ledger; target ingress |
| 2. Canonical state mutation | Authoritative typed mutation | `SqlMutationService`, aggregate JSON | Typed PG commands/UoW/revisions | SUPERSEDED | None foundational | **Ignore / Accept Risk** — retain PG path | M1-M5 |
| 3. Dependency / impact propagation | Complete affected scope | `ImpactEngine` over aggregate graph | M6 manifests/invalidation/closure | SUPERSEDED | Product projections blur three blast concepts | **Act Now** on read-model semantics only | M6; RC-6 |
| 4. Whole-trip assessment | Booking repair must be judged in trip context | Snapshot + viability engine | M6 subject evaluation with PASS/FAIL/UNKNOWN | SUPERSEDED | None foundational | **Ignore / Accept Risk** | M6 evidence |
| 5. RecoveryCase lifecycle | Durable multi-stage resolution | Old case service/status machine | PG multi-subject RecoveryCase + ChangeSignal + resolution gate | SUPERSEDED | None foundational | **Ignore / Accept Risk** | T3/M9 |
| 6. Recovery domain identification | Determine which domains are relevant | Planner branches inferred flight/stay/etc. from state | Default target planner derives programme opportunity only | ADAPT | No generalized domain investigation coordinator | **Act Now** | `recoveryPlanning.ts` |
| 7. Provider/tool research in planning | Discover missing evidence before proposing | `planningLoop.ts` + `dispatch.ts`; flight/hotel read tools | Provider adapters exist but normal target proposer path does not dispatch research | ADAPT | Major regression | **Act Now** | old planning loop; Atlas adapter |
| 8. Cross-domain strategy generation | Travel/programme/stay/etc. from same engine | `NorthstarPlanner` + fallback planner | Generic `StrategyProposer` port, but only default programme swap proposer | ADAPT | Missing travel and cross-domain proposer composition | **Act Now** | proposer port |
| 9. Counterfactual evaluation | Test each candidate against real constraints | Old isolated candidate overlay/viability | RC-6 M6 overlay comparison is stronger | SUPERSEDED | No rewrite required | **Ignore / Accept Risk** | `evaluate.ts` |
| 10. Strategy comparison / recommendation | Prefer best viable recovery | Old deterministic rank: hard feasibility → soft trade-offs → cost → planner order | All viable target strategies persist; UI tells operator to choose | ADAPT | No recommendation layer | **Act Now** | `planningLoop.ts`; current case UI |
| 11. Considered/rejected explanation | Explain material alternatives and rejection | Old planning audit + rejected option evidence + UI | Nonviable target candidates are ephemeral report entries and discarded | ADAPT | Durable decision evidence missing | **Investigate Now** architecture; requirement itself mandatory | planning old/current |
| 12. Policy / preferences / funding | Recovery respects explicit preferences/policy/payer | Old planner + authority/funding/FX handling | PG rule sets/authority exist; not consistently consumed by target proposal/comparison | ADAPT | Planning-side integration incomplete | **Act Now** for B1-relevant inputs | old execution + PG rule model |
| 13. Authority / approval | No consequential action without authority | Old `RecoveryExecutionService` | M8 PG decisions/grants/approval/stored gate is stronger | SUPERSEDED | Budget hold needed when money path activated | **Park for Later** until B2 money action | M8 |
| 14. Internal execution | Typed internal mutation, observed | Old provider/mutation flow | Durable internal programme executor + observation | SUPERSEDED | None for B1 internal action | **Ignore / Accept Risk** | `executionPass.ts` |
| 15. External action execution | Provider-neutral consequential actions | Old provider-backed executor handles flight/hotel | PG worker/state machine + Atlas transaction adapter exist, normal dispatcher not composed | ADAPT | Composition gap, not foundational gap | **Park for Later** until B2 | `PgExecutionWorker`, Atlas |
| 16. Observation / reconciliation | Observe provider result, no blind retries | Old executor had retrieve-before-retry semantics | PG durable execution model is stronger | SUPERSEDED | Normal provider dispatcher/reconciler not wired | **Park for Later** until B2 | M8 state machine |
| 17. Continued/sequential recovery | Continue if first action does not restore validity | `RuntimeOrchestrator.continueApprovedRecovery()` automatically replanned bounded follow-up | Current target resolves/reassesses but normal generalized replan continuation is not equivalent | ADAPT | Significant generalized-loop gap | **Act Now** | `runtime.ts` vs target services |
| 18. Resolution correctness | Case closes only on authoritative recovered state | Old verifier | PG M9 resolution gate is stronger | SUPERSEDED | None foundational | **Ignore / Accept Risk** | `recoveryCaseResolution.ts` |
| 19. Operator Overview | Population + risks + queue | Old dashboard showed roster and attention simultaneously | M9 initially case-driven only; `57bcf06367` restored additive `population[]` | PRESERVE | Current direction now matches owner truth | **Act Now** add regression proof, not redesign | old dashboard; `57bc...` |
| 20. Focused Case workspace | Rich recovery decision workspace | Rich `operator-case.ts` + `case-view-model.ts` | Target `product-recovery-case.ts` is materially thinner; repairs improve readability only | ADAPT | Major UX/product capability regression | **Act Now** | old/current screens |
| 21. Traveller surface | “Am I okay / what changed / what is happening / what do you need?” | Rich itinerary/progress/options/request surface | Target has correct concise concepts but loses useful depth | ADAPT | Product parity incomplete | **Act Now** after core Case contract, bounded scope | old/current traveller |
| 22. Programme preview / now-vs-proposed | Safe counterfactual preview | Old rich programme-recovery flow | PG authoritative bilateral preview exists | ADAPT | Needs integration into generalized strategy/case flow | **Act Now** | product preview |
| 23. Immediate proposed-change blast radius | Who/what candidate directly changes/affects | Old affected elements + option projection | ScenarioChange effects + `strategy_changes` + overlay affected refs | PRESERVE | Needs explicit presentation contract | **Act Now** | overlay + strategy persistence |
| 24. Reassessment closure | Everything requiring reevaluation | Old impact closure | M6/RC-6 closure is stronger | SUPERSEDED | Must not be presented as immediate blast radius | **Act Now** semantic contract/test | RC-6 |
| 25. Outcome delta | Better/worse/unchanged under candidate | Old option viability/rejection projections | Baseline→candidate pairs computed during target evaluation | ADAPT | Pairing is not durably retained for all reached subjects | **Act Now** | `StrategySubjectVerdict` |
| 26. Activity / reasoning progress | Show what NORTHSTAR checked/is doing | Old audit timeline, tool activity, planning steps | Basic PG ActivityFeed/cause/actions | ADAPT | Planning research/reasoning evidence missing | **Act Now** with planner evidence work | old readmodels/activity |
| 27. LIVE / RECORD / REPLAY | Same normalized engine path | Provider runner/recording adapters | Same adapter architecture survives | PRESERVE | Target planner not currently invoking it | **Act Now** compose read tools; external transactions wait for B2 | Atlas/runner |
| 28. Reset/demo-only tooling | Reliable demo state, not domain behaviour | SQLite table wipe + fixture bootstrap | PG materialization/fresh workspace/data-driven provisioning | SUPERSEDED | In-product reset is not product semantics | **Park for Later** presentation ergonomics | M10; demo materializer |
| 29. Simulated/demo-only UI | Demo controls must not masquerade as product | Various inject/reset/debug affordances | Current Overview still contains “Simulated airline update” panel | RETIRE | Presenter control is embedded in primary UX | **Park for Later** move to demo/presenter tooling | `product-operator-overview.ts` |

### Matrix conclusion

The regression is concentrated in **planning intelligence/orchestration and product presentation**, not the PostgreSQL kernel.

---

# 5. Frontend parity audit

## Old Overview → current Overview

The old `src/ui/screens/operator-dashboard.ts` already implemented the correct conceptual structure:

- full population/roster;
- search;
- status;
- attention/decision queue;
- impacted subjects remain part of the same managed population;
- case navigation from affected rows.

Initial M9 `OperatorOverview` did **not** carry a separate population. It only had case-driven `items[]`.

That is exactly the “queue OR population” regression.

`57bcf06367` corrected this by explicitly adding:

- `population[]`;
- `populationSummary`;
- event context;

while retaining `items[]`.

The commit comments themselves state:

> `items` answers “what needs me right now”; `population` answers “whose travel am I responsible for”.

That correction is architecturally right and should be preserved.

**Disposition: PRESERVE current population + queue semantics.**

Do not recreate the old dashboard's SQLite read path.

### Current problem

`product-operator-overview.ts` still embeds the “Simulated airline update” panel directly in the product Overview.

That is demo scaffolding, not operator information architecture.

**Disposition: RETIRE from primary UX; optional presenter/demo surface may retain it.**

## Old Case workspace → current focused Case

This is the largest frontend regression.

The old Case workspace had:

- what happened;
- downstream impact;
- commitment at stake;
- journey chain;
- checks;
- planning progress;
- options forming state;
- multiple viable/rejected recovery options;
- explicit rejection reasons;
- recommended option;
- “why recommended”;
- whole-trip recovery plan;
- cost/funding information;
- approval state;
- execution progress;
- resolution state;
- status/activity timeline;
- programme-recovery handoff.

`src/ui/case-view-model.ts` explicitly supported all of these concepts.

The current `product-recovery-case.ts` now improves several founder defects:

- correct names instead of `Traveller UNKNOWN`;
- strategy effects rendered in human terms;
- current/proposed programme timings;
- who the candidate resolves;
- clean shell navigation.

Those repairs are useful.

But it still presents:

> “N viable options — choose one.”

There is no planner-backed recommendation or explanation because the backend currently has none.

**Disposition: ADAPT the old Case information architecture onto target PostgreSQL read models.**

Do not port the old projection code unchanged.  
Do not restore old aggregate assumptions.

## Traveller surface

Old `src/ui/screens/traveller.ts` had a substantially richer product workflow:

- trip status;
- itinerary;
- commitment/reason for trip;
- progress;
- “what changed”;
- recovery options;
- traveller approval/input;
- message/request composer;
- final resolution.

Current `product-traveller-trip.ts` has a cleaner minimal contract:

- Am I okay?
- What changed?
- What matters now?
- What Northstar is doing?
- What do you need from me?
- Does the rest work?
- After recovery.

The current conceptual framing is good, but useful product depth disappeared.

**Disposition: ADAPT.**

Do this after the generalized Case/recovery contract is frozen, otherwise the traveller UI will duplicate incomplete semantics.

## Programme / preview

Current PostgreSQL preview is real and valuable:

`src/ui/screens/product-programme-preview.ts`

provides authoritative:

- Current;
- Proposed;
- participant projections.

That should survive.

But bilateral swap should become one presentation of a generalized ScenarioChange, not remain a special recovery universe.

**Disposition: ADAPT.**

## Activity / reasoning

The old system had both audit activity and planner/tool progress.

The current PG ActivityFeed represents durable state/action events but does not replace:

- “checking alternate flights”;
- “verified best travel-only option”;
- “150-minute buffer still fails”;
- “evaluating programme alternatives”;
- “programme option causes no regression”.

**Disposition: ADAPT.**

## Demo/debug surfaces

The following should **not** become primary product UX:

- simulation injection controls;
- reset buttons;
- raw strategy UUIDs;
- strategy version ordinals as option identity;
- raw capability names;
- internal assessment IDs;
- graph/debug inspectors;
- raw provider state.

These may exist in a presenter/developer surface.

---

# 6. Recovery-engine parity audit

There are two sets of valuable machinery. Neither should “win” wholesale.

## Pre-refactor planner/orchestrator strengths

### `src/app/planningLoop.ts`

It already provided:

`planner`  
→ read-only tool requests  
→ tool execution  
→ planner continuation with evidence  
→ multiple candidates  
→ deterministic viability  
→ deterministic ranking  
→ rejection evidence  
→ best strategy.

It supported bounded multi-round planning and deduplicated evidence requests.

### `src/intelligence/fallbackPlanner.ts`

Generalized provider-disruption logic already existed:

- detect failed flight leg from state;
- request `flight.search`;
- wait for provider evidence;
- produce candidate replacements;
- separately detect an uncovered overnight;
- request `hotel.search`;
- produce hotel candidates.

No Sarah/Jordan names were required.

### `src/intelligence/northstarPlanner.ts`

It already contained generalized reasoning for:

- initial-trip planning;
- traveller-request changes;
- provider disruption;
- event-side change;
- flight search;
- stay search;
- multiple candidate enumeration;
- uncertainty when evidence was missing;
- provider-evidence-derived cost.

Parts are tied to the old TripSnapshot model and must not be copied wholesale, but the algorithms are useful.

### `RuntimeOrchestrator.continueApprovedRecovery()`

This provided a valuable generalized lifecycle capability:

execute  
→ verify  
→ if still PLANNING  
→ replan  
→ stage next action  
→ execute if still covered by approved recovery envelope.

That is directly aligned with owner truth that NORTHSTAR continues until valid/escalated.

## Current PostgreSQL strengths

### `StrategyProposer`

`src/resolution/planning/proposer.ts` is a superior abstraction boundary.

A proposer outputs bounded candidate data only.

It cannot assert:

- viability;
- authority;
- execution truth.

An LLM-backed proposer can use the same port.

Preserve this.

### ScenarioChange + overlay

`src/resolution/scenarios/overlay.ts` is significantly better than old aggregate mutation.

It supports typed effects including:

- offer selection;
- allocation;
- programme changes;
- Journey intent;
- support assignment;
- objective disposition.

It refuses to fabricate supplier/policy/credential observations.

Preserve this.

### RC-6 evaluation

`src/resolution/scenarios/evaluate.ts` is stronger than the old viability aggregator.

It correctly distinguishes:

- case subjects that must heal;
- unrelated pre-existing problems;
- introduced regressions;
- introduced UNKNOWN;
- reassessment closure.

Preserve this.

### M8/M9 execution and resolution

The PostgreSQL authority/execution system is much safer than the old runtime:

- persisted ActionPlans;
- typed intents;
- deterministic authority;
- stored execution gate;
- durable attempts;
- fencing;
- `OUTCOME_UNKNOWN`;
- reconciliation-before-retry;
- source-owned observations;
- final RecoveryCase resolution only after authoritative reassessment.

Preserve this.

## Correct forward composition

Do **not** restore:

`RuntimeOrchestrator -> old repositories`.

Instead construct:

`ChangeSignal/current world`  
→ current case/evaluation  
→ **generalized planning coordinator**  
→ `StrategyProposer` registry  
→ read-only capability requests  
→ provider/tool evidence  
→ candidate generation  
→ current validation  
→ current M6/RC-6 viability  
→ comparison/recommendation  
→ current ActionPlan/authority/execution  
→ observation/state/reassessment  
→ **continuation decision**  
→ planning again if necessary.

In other words:

**reuse old planning behaviour; keep current contracts/state kernel.**

---

# 7. Sarah parity audit

## Intended B1

`provider reprotected`  
→ whole-trip check  
→ Sarah still fails  
→ identify relevant recovery domains  
→ investigate travel alternatives  
→ evaluate travel-only candidates  
→ best travel option still inadequate/inferior if evidence shows this  
→ investigate programme recovery  
→ evaluate programme candidates and blast radius  
→ compare approaches  
→ recommend programme recovery  
→ approval  
→ internal programme execution  
→ observation  
→ reassessment  
→ recovered.

## Current target flow

`provider-shaped reprotection event`  
→ ChangeSignal  
→ canonical transport update  
→ targeted reassessment  
→ Sarah case  
→ `proposeRecoveryStrategies()`  
→ default proposer = **programmeTimeSwapProposer only**  
→ programme swaps generated  
→ schema validation  
→ RC-6 overlay viability  
→ viable strategies persisted  
→ UI says choose one  
→ approval  
→ internal programme actions  
→ observation/canonical programme mutation  
→ reassessment  
→ resolution.

| Stage | Status | Why |
|---|---|---|
| Provider change arrives | PRESENT | Provider-shaped event boundary |
| Provider reprotection becomes state | PRESENT | Current canonical mutation |
| Blast/affected scope | PRESENT | ChangeSignal + invalidation |
| Whole-trip assessment | PRESENT | M6 |
| Sarah determined not viable | PRESENT | 150-minute rule |
| Determine relevant recovery domains | PARTIAL | Current proposer discovers programme opportunity only |
| Investigate flight/travel recovery | MISSING | Normal target planner issues no flight research |
| Flight search/verify | MISSING | Atlas capability exists but not invoked by target planning |
| Evaluate travel candidates against objectives | MISSING | No travel candidates enter RC-6 |
| Demonstrate travel-only inadequacy | MISSING | Therefore cannot truthfully claim it was checked |
| Generate programme recovery | PRESENT | programme time-swap proposer |
| Immediate programme-change blast radius | PARTIAL | Effects/affected refs exist but concept not explicitly separated in product projection |
| Reassessment closure | PRESENT | RC-6 |
| Outcome delta | PARTIAL | Calculated in memory; not durably represented cleanly |
| Compare travel vs programme approaches | MISSING | No travel candidates |
| Compare multiple viable programme strategies | MISSING | Current UI asks operator to choose |
| Recommend preferred recovery | MISSING | No recommendation layer |
| Explain why preferred | MISSING | Effect description ≠ comparative recommendation |
| Operator approval | PRESENT | Current authority path |
| Internal programme execution | PRESENT | Durable executor |
| Observation | PRESENT | Committed internal observations |
| Reassessment | PRESENT | runtime services |
| Resolution | PRESENT | M9 resolution gate |

The system currently proves:

> “Given a Sarah programme recovery candidate, can NORTHSTAR safely evaluate, approve and execute it?”

It does **not** yet prove:

> “Can NORTHSTAR reason through Sarah's whole recovery problem and arrive at that recommendation?”

The latter is B1.

---

# 8. Blast-radius truth

The architecture can separate the three concepts, but the product/read-model contract does not yet do so cleanly.

## A. Immediate proposed-change blast radius

**Mostly expressible now.**

Sources:

- `ScenarioChange.effects`;
- `strategy_changes.effects`;
- `strategy_changes.affected_subjects`;
- `applyScenarioOverlay(...).affectedSubjectRefs`.

For a programme move, the overlay explicitly adds:

- changed ProgrammeItem;
- owning Programme;
- participants;
- affected participant Journeys.

For precise UI wording, distinguish **objects actually modified** from people/resources **directly impacted by those modifications**.

### Gap

`affectedSubjectRefs` is currently broad enough that it should not automatically be labelled “things changed.”

Add a projection that categorizes effect targets versus directly impacted dependants.

## B. Reassessment closure

**Expressible and already correctly implemented.**

RC-6 derives subjects to reassess from:

- overlay affected refs;
- dependency closure;
- programme participation;
- explicit case subjects.

This is the large “67 reached subjects” style scope.

That number is useful engineering/evidence information.

It is **not** the proposed-change blast radius.

Preserve the algorithm, rename/present correctly.

## C. Outcome delta

**Computable but not sufficiently durable.**

`StrategySubjectVerdict` already carries:

- baseline;
- candidate;
- mustPass.

Therefore the evaluator can classify:

- improved;
- worsened;
- unchanged;
- introduced unknown.

But `persistRecoveryStrategy()` stores candidate assessment summaries and a single basis assessment reference; it does not persist the complete baseline→candidate pair for every reached subject.

Once authoritative state changes, rebuilding the original historical delta from current state can become dishonest.

### Architecture gap

A bounded durable representation of the **comparison basis/outcome delta** is needed if the product is expected to show this later.

This does not require changing the core ontology.

### Major-decision record

**WHAT WE KNOW:** all three calculations conceptually exist or can be derived from current evaluation inputs.

**WHAT WE DO NOT KNOW:** the optimal persistence format for historical outcome delta.

**KEY ASSUMPTION:** product explanations must remain truthful after canonical state moves.

**NEXT:** freeze a small candidate-evidence/delta contract before richer Case work.

---

# 9. Considered/rejected strategy evidence

## Current truth

The target currently does this:

- schema-invalid candidate → report only;
- nonviable evaluated candidate → report only;
- viable candidate → persisted `RecoveryStrategy`.

`recoveryPlanning.ts` explicitly says:

> “Non-viable candidates are reported, never persisted as options.”

That means material alternatives disappear after the request.

The old planning loop retained more decision evidence in audit records and could project rejected options into Case UI.

## Recommended smallest truthful architecture

Use a **hybrid**, not a new “RejectedOption” domain hierarchy.

### Persist

For material candidates that reached deterministic evaluation:

- candidate identity/key;
- recovery domain;
- proposed ScenarioChange;
- evaluation basis;
- baseline/candidate outcome summary;
- deterministic viability/rejection reason;
- tool/source evidence references;
- planning attempt/recommendation relationship.

The existing `RecoveryStrategy` contract already supports:

- `REJECTED`;
- `rejectionReason`;
- candidate assessments.

Therefore one credible minimal route is to retain evaluated rejected `RecoveryStrategy` records rather than throwing them away.

For investigation paths that produce **no candidate at all**—for example “flight search returned no option satisfying the requirement”—persist a small case/planning evidence record or audit entry pointing at the source/tool evidence.

### Derive

UI prose such as:

> “The best travel-only option leaves 74 minutes against 150 required.”

can be rendered from stored numeric/evaluation evidence.

Do not persist marketing prose as the truth source.

## Alternatives

**Persist all rejected candidates as RecoveryStrategy**

Pros: already supported by schema.  
Cons: can overload the meaning of RecoveryStrategy and clutter lifecycle queries.

**New planning-attempt / decision-evidence record**

Pros: cleanly represents research, candidates, no-result branches and comparison.  
Cons: new persistence contract/table.

**Deterministically reconstruct later**

Pros: no new storage.  
Cons: unsafe for historical provider/tool evidence and state that has since changed.

**Ephemeral only**

Not acceptable for product truth/auditability.

## Classification

**Investigate Now**

The requirement to retain truthful material decision evidence is frozen. The exact persistence shape should be resolved before B1 implementation, not designed ad hoc inside the UI.

---

# 10. Fable audit retrospective

### 1. What question did it actually ask?

Whether the post-C5 PostgreSQL runtime's reassessment/recovery composition was operationally correct, especially after T2 exposed 67-unit fan-out and slow worker draining.

### 2. What baseline did it use?

The current PostgreSQL target at:

`feature/sarah-provider-disruption @ c20228c2...`

not the pre-refactor product/runtime.

### 3. Did it compare current runtime against pre-refactor product capability?

**No.**

### 4. Did it audit product parity?

**No.**

### 5. Did it audit planner/tool parity?

**No.**

It correctly noticed there was no normal-runtime `StrategyProposer`, but then intentionally scoped B1 to a first deterministic internal proposer.

### 6. Did it audit UI parity?

**No.**

It explicitly limited T4 to authoritative cause/causalPath and said no Event Overview redesign.

### 7. Which gaps did it correctly find?

It correctly found:

- capture-slice-wide fan-out;
- missing ChangeSignal provenance spine;
- missing deterministic escalation;
- recovery lifecycle only test/manual-composed;
- no target StrategyProposer;
- no normal runtime authority/execution driver;
- duplicated/incomplete runtime worker composition;
- missing focused-case causal inputs.

These were real and important.

### 8. Which gaps were outside scope?

At least:

- provider/tool planning parity;
- multi-round planner research;
- cross-domain generation;
- strategy ranking;
- preferred-strategy recommendation;
- rejected-option evidence;
- sequential recovery parity;
- rich Case UX;
- old Overview UX parity;
- traveller UX parity.

### 9. Was “no engine rewrite required” correct?

**Yes.**

That conclusion remains correct.

The audit found composition gaps over a fundamentally sound new architecture.

### 10. Was “therefore current B1 is the complete recovery engine” justified?

**No.**

The audit's own wording calls B1 the:

> “first complete generalized internal loop”

and explicitly defers the external/provider loop and optional model proposer.

Turning that into “the engine is complete” was a later product interpretation, not an audit finding.

### Major-decision record

**WHAT WE KNOW:** Fable answered its assigned question well.

**WHAT WE DO NOT KNOW:** nothing material about its scope—it states its scope clearly.

**KEY ASSUMPTION:** historical audit evidence should remain historical rather than be rewritten.

**NEXT:** correct the *current SSOT interpretation*, not the Fable evidence itself.

---

# 11. M9/M10 retrospective

## M9

### What was correct

M9 proved substantial PostgreSQL product mechanics:

- real target application composition;
- RecoveryStrategy persistence;
- ActionPlan/authority;
- programme preview;
- internal actions;
- RecoveryCase resolution;
- read-model contracts;
- multi-action/partial-failure structures;
- Sarah target PostgreSQL E2E;
- Jordan execution foundations.

### What was incorrect

Nothing about creating `/api/v2/*` was inherently incorrect.

The mistake was later treating their existence as proof they had **fully replaced** the old product surfaces.

### What was not proven

M9 did not prove:

- old Case UX parity;
- old Overview population parity;
- old planner/tool parity;
- cross-domain planning parity;
- rejected-option parity;
- ranking/recommendation parity;
- sequential-recovery parity.

### Product capability lost

Not yet lost in M9 because old normal runtime still existed.

M9 created the conditions for a later mistaken replacement decision.

## M10

### What was correct

M10 was right that:

- normal runtime should become PostgreSQL-only;
- SQLite should not remain fallback authority;
- boot imports should structurally exclude SQLite;
- migration/export should be offline/read-only;
- old direct SQL/table-wipe patterns should disappear;
- old aggregate persistence should not be recreated inside PostgreSQL.

### What was incorrect

The disposition:

> Operator dashboard, case detail, decisions, activity, programme view, traveller → **RETIRE because `/api/v2/*` supersedes them**

was not behaviourally justified.

And:

> `RuntimeOrchestrator` recovery lifecycle → **RETIRE because M6-M9 supersedes it**

was only partly correct.

The **old implementation** deserved retirement.

Several of its **behaviours** did not.

### What was not proven

M10's structural import-graph test proved:

> “old code cannot be reached.”

It did **not** prove:

> “every useful behaviour has a new home.”

This is the key acceptance-design failure.

### Where “replace data foundation” became “replace product behaviour”

The transition is explicit in `docs/work/M10_ACTIVE_TASK.md` Phase 1's disposition table.

That is the exact point at which implementation retirement was allowed to become product-capability retirement.

---

# 12. Rebased B1 boundary

B1 should prove the **complete Sarah recovery reasoning story**, stopping before consequential external provider execution.

Minimum B1 acceptance:

1. provider reprotection/change enters canonical state;
2. targeted dependency propagation occurs;
3. whole-trip viability shows Sarah's actual failure;
4. planner identifies plausible recovery domains from state, not scenario ID;
5. planner gathers relevant travel evidence;
6. travel candidates are generated from real/replayed provider evidence;
7. deterministic evaluation tests those candidates against Sarah's Trip objectives;
8. evidence shows whether travel-only recovery is sufficient or not;
9. if inadequate, programme-side possibilities are investigated;
10. programme candidates are evaluated with immediate blast radius, reassessment closure and outcome delta separated;
11. viable approaches are compared;
12. NORTHSTAR identifies and explains the preferred recovery;
13. operator sees meaningful alternatives/rejections;
14. operator approves the programme change;
15. existing internal execution machinery acts;
16. observations update canonical state;
17. reassessment proves Sarah recovered;
18. case resolves.

No flight purchase is required.

No Sarah-specific control flow is allowed.

### Major-decision record

**WHAT WE KNOW:** all deterministic post-selection machinery already works.

**WHAT WE DO NOT KNOW:** the exact minimum model-vs-deterministic split for candidate comparison.

**KEY ASSUMPTION:** “AI” may generate/compare/explain, but deterministic viability remains authoritative.

**NEXT:** build/adapt only the missing planning/recommendation/evidence layers, then re-run B1 from the start.

The current Founder B1 checklist is insufficient and should not be the acceptance gate.

---

# 13. Rebased B2 boundary

B2 is **not** “add a flight planner.”

After B1 proves the generalized reasoning lifecycle, B2 proves that the **same lifecycle** survives consequential external ownership.

B2 adds:

- provider-bound external ActionIntent;
- deterministic authority immediately before action;
- actual/simulated transactional provider dispatcher;
- uncertain network/provider outcomes;
- durable `OUTCOME_UNKNOWN`;
- lookup/reconciliation before any retry;
- partial failure;
- preserved duplicate/cost exposure;
- canonical provider observation;
- reassessment;
- continued recovery if still invalid;
- final observed resolution.

Jordan is a proof case, not an architecture.

The existing PG execution state machine and Atlas adapters mean B2 should be mostly **composition**, not a new engine.

---

# 14. What should NOT be rebuilt

## Keep current PostgreSQL architecture

Do not rebuild:

- F01-F18 ontology/contracts;
- PostgreSQL ownership model;
- Traveller / Trip / Journey split;
- Programme / ProgrammeItem / Participation;
- current ChangeSignal spine;
- M6 evaluator registry;
- invalidation/reassessment;
- RC-6 viability semantics;
- `src/resolution/scenarios/overlay.ts`;
- `src/resolution/scenarios/evaluate.ts`;
- `src/resolution/planning/proposer.ts`;
- `src/resolution/planning/compiler.ts`;
- current ActionPlan contracts;
- `src/app/target/recoveryApproval.ts`;
- internal programme executor;
- `src/persistence/postgres/execution/storedExecutionGate.ts`;
- `src/persistence/postgres/execution/pgExecutionWorker.ts`;
- `src/resolution/execution/stateMachine.ts`;
- `src/app/target/recoveryCaseResolution.ts`;
- `src/app/runtimeServices.ts`;
- PG read-model assembler foundation;
- target HTTP/server composition;
- Atlas search/verify adapter;
- Atlas transaction adapter;
- provider recording/normalization architecture;
- LIVE / RECORD / REPLAY.

## Adapt historical algorithms instead of rewriting from memory

Mine these deliberately:

### `src/app/planningLoop.ts`

Reuse concepts for:

- bounded planner/tool rounds;
- deduplicated read-only requests;
- prior tool evidence;
- candidate evaluation orchestration;
- comparison/ranking;
- planning evidence.

### `src/intelligence/fallbackPlanner.ts`

Adapt:

- failed-flight detection;
- flight-search evidence cycle;
- next-day/overnight reasoning;
- hotel-follow-up reasoning.

Do not copy old TripSnapshot dependencies wholesale.

### `src/intelligence/northstarPlanner.ts`

Adapt useful algorithms for:

- recovery-domain identification;
- travel-change reasoning;
- flight/stay evidence gaps;
- provider-derived alternatives;
- uncertainty.

### `src/app/dispatch.ts`

Reuse provider-neutral **read-tool dispatch concepts**.

### `src/app/recoveryExecution.ts`

Do not restore the service, but preserve its useful product algorithms/semantics where not already superseded:

- whole-plan authority thinking;
- provider-success-is-not-recovery;
- funding/FX boundary concepts;
- bounded sequential follow-up.

### Product presentation

Use as information-architecture/reference material:

- `src/ui/screens/operator-case.ts`;
- `src/ui/case-view-model.ts`;
- `src/app/readmodels.ts`;
- `src/app/casePresentation.ts`;
- `src/app/presentationProjection.ts`;
- `src/ui/screens/operator-dashboard.ts`;
- `src/ui/screens/traveller.ts`.

Do **not** reconnect them to SQLite.

---

# 15. What genuinely must be built

After maximal reuse, the irreducible gaps are much smaller than “rebuild NORTHSTAR.”

## 1. Generalized planning coordinator

A current-contract equivalent of the useful part of `planningLoop.ts`:

- choose/invoke recovery-domain proposers;
- identify missing evidence;
- perform bounded read-only capability calls;
- feed evidence back to planning;
- collect candidate strategies.

This should sit **above** `StrategyProposer` and **before** current validation/RC-6.

## 2. Travel-domain proposer adapted to current world

Port the useful failed-flight/search logic to:

`PlanningWorld + failing subjects + tool evidence -> ProposalCandidate[]`.

Do not introduce Jordan or Sarah logic.

## 3. Strategy comparison / recommendation layer

After deterministic viability:

- eliminate non-executable candidates;
- compare viable candidates using cost, disruption, explicit preferences, policy and soft trade-offs;
- permit AI semantic judgement;
- output bounded structured recommendation + explanation evidence.

The comparator cannot override deterministic viability.

## 4. Durable planning/decision evidence

Enough to truthfully retain:

- travel alternatives checked;
- material rejected candidates;
- deterministic rejection reasons;
- evidence references;
- baseline/candidate delta;
- recommendation basis.

Exact shape is Investigate Now.

## 5. Generalized continuation orchestration

After observation/reassessment:

- if recovered → resolve;
- if still recoverable → re-enter planning using updated canonical state;
- if blocked/authority impossible → escalate.

This restores a product capability previously provided by `continueApprovedRecovery()` without restoring the old runtime.

## 6. Rich Case projection over PostgreSQL

Adapt the baseline Case capabilities to current truth:

- impact;
- what was investigated;
- considered/rejected options;
- recommendation;
- immediate candidate blast radius;
- whole-trip implications;
- approval;
- activity;
- execution;
- observation;
- resolution.

## 7. Explicit blast/delta projection contract

Add separate fields/read models for:

- direct proposed change;
- reevaluation closure;
- outcome delta.

No frontend inference.

## B2-only build

Only after B1:

- external dispatcher composition;
- reconciliation service composition around existing PG worker/provider lookup;
- provider-specific ActionIntent execution adapter glue.

---

# 16. New permanent regression gates

The missing control was not another unit test. It was a **capability migration gate**.

## Gate A — Capability disposition required before cutover

Every migration/refactor proposal must contain:

| OLD CAPABILITY | NEW HOME | DISPOSITION | BEHAVIOURAL PROOF |
|---|---|---|---|
| planner read-only provider research | generalized planning coordinator | ADAPT | provider disruption causes search evidence before candidate generation |
| old Case rejected option card | PG case decision-evidence projection | ADAPT | rejected evaluated option + reason shown from backend evidence |
| SQLite reset table wipe | none | RETIRE | explicit product decision says not product behaviour |

No row may disappear.

`SUPERSEDED` requires a behavioural test demonstrating the underlying product requirement, not merely a new class/module.

## Gate B — Product capability parity suite

For any future foundational refactor, test at the behavioural level:

- whole-trip disruption;
- evidence gathering;
- at least two materially different strategies;
- one rejected candidate;
- one viable candidate;
- recommendation explanation;
- approval;
- execution;
- observation;
- reassessment;
- continued recovery where needed;
- final resolution.

Implementation names must not be part of acceptance.

## Gate C — Surface parity review

Before retiring a product surface:

`USER QUESTION`  
→ old surface answer  
→ replacement surface answer  
→ evidence source.

Examples:

- “What changed?”
- “Who is affected?”
- “What did NORTHSTAR investigate?”
- “What options did it reject?”
- “Why this recommendation?”
- “What am I approving?”
- “Did it actually work?”

## Gate D — Planner parity test

A normal-runtime test must prove:

1. current state alone identifies relevant recovery domain;
2. evidence gap causes read-only tool request;
3. tool response changes planning;
4. multiple candidates can result;
5. deterministic viability rejects at least one;
6. comparison selects/recommends among viable options;
7. rejected reason remains inspectable.

## Gate E — No-silent-retirement static check

Any file/capability moved to RETIRE during a foundational milestone must reference one of:

- product decision ID;
- parity mapping;
- replacement acceptance test.

A plain statement such as “legacy module” is insufficient.

## Gate F — Refactor acceptance hierarchy

A foundational migration cannot close on structural tests alone.

Required sequence:

1. contract/schema proof;
2. focused unit/module proof;
3. integration proof;
4. capability parity proof;
5. representative product-flow proof;
6. cutover/runtime reachability proof.

M10 had step 6 without a sufficient step 4.

---

# 17. SSOT conflicts

These files now conflict with owner truth and should eventually be updated.

## `AGENTS.md`

Conflict:

- treats current internal B1 as first complete generalized recovery loop;
- next step is B2 external.

Required correction:

- current B1 implementation is a valid internal-programme execution slice, not accepted full B1 product reasoning;
- freeze rebased B1/B2 boundaries.

## `README.md`

Conflict:

- frames B1 as Sarah internal programme recovery and B2 as the place external/travel planning arrives.

Required correction:

- B1 includes travel investigation/evaluation but stops before consequential external execution.

## `docs/ARCHITECTURE.md`

Conflict:

- architecture narrative implies current B1 planning composition represents the generalized recovery planner.

Required correction:

- distinguish `StrategyProposer` port and programme proposer from generalized planning coordinator;
- explicitly add provider/tool evidence and strategy comparison layer.

Do **not** reopen ontology.

## `docs/CAPABILITIES_AND_LIMITATIONS.md`

Most serious incorrect statements:

> “The engine is complete; the product surface over it is not.”

and:

> “Recovery planning — IMPLEMENTED FOR INTERNAL LOOP”

followed by B2 needing a flight proposer.

Correction:

- deterministic state/evaluation/execution spine is substantially complete;
- generalized recovery reasoning/planning parity is not.

Also move “rich rejected-option history” out of “after B2”; truthful material alternative explanation is a B1 requirement.

## `docs/ROADMAP.md`

Conflict:

current sequencing treats UI-repaired programme B1 as sufficient to unlock B2.

Correction:

replace that boundary with rebased B1.

## `docs/IMPLEMENTATION_PLAN.md` §22.4–22.6

This is currently the most consequential incorrect SSOT.

Conflicts:

- §22.4 calls B1 engine complete;
- §22.5 founder flow begins directly at programme proposal;
- §22.5a says “No LLM, no ranking” and repairs UI only;
- §22.6 pushes flight-recovery proposer and provider research to B2.

Correction:

rebase §22 around full Sarah reasoning before B2.

## `docs/work/ACTIVE_TASK.md`

Conflict:

current checkpoint says product acceptance repair is implemented and next action is founder retest → B2.

Correction:

do **not** run that retest as the final B1 gate. Replace active task with capability-parity recovery work.

## `docs/work/FOUNDER_B1_PHYSICAL_FINDINGS.md`

Historical observations are correct.

The interpretation:

> engine loop complete; UI is the blocker

is no longer current product truth.

Keep the findings historically; add supersession pointer rather than rewriting the test result.

## `docs/SCENARIOS.md`

Conflict:

S1 currently says:

- no Atlas evidence claimed;
- provider reprotection is assessed;
- then hand off to S3.

S3 separately says travel alternatives “remain visible but secondary.”

Rebased B1 requires the combined S1→S3 path to explicitly prove travel alternatives were investigated/evaluated before programme recovery is recommended.

Scenario IDs may remain separate demo chapters, but the **recovery reasoning lifecycle must be continuous**.

## Historical evidence that should NOT be rewritten

Keep these as historical truth:

- `docs/work/M10_ACTIVE_TASK.md`;
- `docs/refactor/evidence/M9.md`;
- `docs/refactor/evidence/C4_ACCEPTANCE.md`;
- `docs/refactor/evidence/POST_C5_RUNTIME_ARCHITECTURE_AUDIT.md`;
- C5 evidence.

If needed, add future forward pointers saying later owner truth superseded their product dispositions.

Do not falsify history by editing what M10/Fable actually decided at the time.

---

# 18. Risk triage

| Finding | Classification | Decision |
|---|---|---|
| M10 retired behaviours without behavioural parity proof | **Act Now** | Freeze new capability mapping before further implementation |
| Current B1 definition is too narrow | **Act Now** | Replace acceptance boundary |
| Current normal planner has only programme proposer | **Act Now** | Adapt multi-domain planning/tool loop |
| Provider read capabilities are disconnected from target planning | **Act Now** | Compose them before B1 |
| No viable-strategy comparison/recommendation | **Act Now** | Add structured comparator |
| Exact rejected/considered evidence persistence design | **Investigate Now** | Freeze smallest truthful contract before implementation |
| Baseline→candidate outcome delta not durably represented | **Act Now** | Add bounded comparison evidence |
| Generalized sequential recovery missing from target composition | **Act Now** | Restore behaviour through current architecture |
| Rich focused Case capability not yet restored | **Act Now** | Adapt old IA to PG projection |
| Traveller/activity product depth | **Act Now** | Restore after shared recovery contract, without blocking planner work |
| Overview population + queue semantics | **Ignore / Accept Risk** | Current `57bc...` correction is sound; regression-test it |
| External provider dispatcher normal composition | **Park for Later** | B2, after full B1 |
| Provider-reference auto-correlation | **Park for Later** | Revisit when real webhook/provider ingestion needs it |
| Budget holds / external money path | **Park for Later** | Activate with B2 consequential spend |
| Simulated provider control embedded in Overview | **Park for Later** | Remove/move before final product polish |
| Current PostgreSQL ontology/state kernel | **Ignore / Accept Risk** | Do not reopen absent contradictory evidence |
| Rewrite entire recovery engine | **Ignore / Accept Risk** | Explicitly reject |
| Restore SQLite runtime | **Ignore / Accept Risk** | Explicitly reject |
| Physical deletion of historical SQLite code | **Park for Later** | After submission/M11 when safe |
| Exact Qwen/LLM role in comparison/generation | **Investigate Now** | Freeze bounded AI output contract; deterministic gates unchanged |
| Current B1 founder retest under old checklist | **Act Now** | Replace checklist before retesting |
| Missing permanent refactor parity gate | **Act Now** | Add capability migration template + tests |

---

# 19. Recommended recovery programme

This should **not** become another M0-M10.

There are four substantive recovery steps before B2.

## Step 1 — Freeze the truth and contracts

Before implementation:

- rebase B1/B2 boundaries;
- create capability migration matrix;
- freeze generalized planning coordinator interface;
- freeze read-only tool request/result contract;
- freeze recommendation result contract;
- decide bounded candidate/rejected evidence representation;
- freeze the three blast-radius projection semantics.

No domain/schema redesign unless this exercise proves something unrepresentable.

### Safe parallel lanes after freeze

**Planner lane:** planning coordinator + adapted travel proposer/tool research.

**Evidence/read-model lane:** planning evidence + blast/outcome delta projection.

**Product lane:** Case information architecture mapped onto frozen backend fields.

**Verification lane:** independent parity tests and hardcoding audit.

Architecture/integration remains with the primary lane.

## Step 2 — Recover planning parity on the current engine

Extend `recoveryPlanning.ts`; do not replace it.

Target flow:

`case/current failure`  
→ recovery-domain analysis  
→ bounded research/tool requests  
→ candidate proposers  
→ current validation  
→ RC-6  
→ candidate evidence  
→ comparison/recommendation  
→ persist viable recommendation and relevant considered evidence.

Mine old `planningLoop.ts`, `fallbackPlanner.ts`, `northstarPlanner.ts` and `dispatch.ts`.

Focused tests first.

Do not touch authority/execution unless an actual integration mismatch appears.

## Step 3 — Restore the product decision surface

Build the authoritative PG Case projection capable of answering:

- what happened;
- why the whole trip fails;
- what NORTHSTAR checked;
- what alternatives were considered;
- why alternatives fail/lose;
- what recovery it recommends;
- immediate proposed-change blast radius;
- broader reassessment closure if useful;
- who improves/worsens/remains unchanged;
- what operator is approving;
- execution/observation status;
- final outcome.

Adapt the old Case UX rather than designing another brand-new page.

Preserve current target shell/navigation fixes.

Keep Event Overview redesign out of this work.

## Step 4 — Re-run B1 as a full product/engine acceptance

Sarah must demonstrate:

`provider reprotection`  
→ assessment  
→ travel research  
→ travel candidate evaluation  
→ programme candidate evaluation  
→ cross-approach comparison  
→ recommendation  
→ approval  
→ internal execution  
→ observation  
→ reassessment  
→ recovery.

Also run one materially different focused planning case through the same coordinator to ensure no Sarah branch slipped in.

Only after this passes is B1 accepted.

### Major-decision record

**WHAT WE KNOW:** most of the required deterministic substrate exists.

**WHAT WE DO NOT KNOW:** until implementation, whether adapting historical planner algorithms exposes one or two contract mismatches.

**KEY ASSUMPTION:** those should be localized to planning/evidence interfaces, not ontology.

**NEXT:** if a mismatch occurs, report it as an explicit architecture gap instead of adding scenario logic.

## Step 5 — B2 external execution

After B1:

- reuse same planning coordinator;
- reuse same StrategyProposer contract;
- reuse same validation and RC-6;
- reuse same ActionPlan/authority;
- connect external ActionIntents to existing `PgExecutionWorker`;
- adapt provider dispatcher/lookup;
- exercise `OUTCOME_UNKNOWN`, partial failure and reconciliation;
- continue recovery until canonical state passes.

Jordan then proves generality.

It does not define the engine.

## Step 6 — Product redesign / submission polish

Only after generalized E2E is reliable:

- new Event Overview;
- graph/semantic zoom;
- presenter ergonomics;
- remove demo scaffolding from product UX;
- richer animation/activity;
- final M11/submission work.

---

# 20. Owner clarification list

There is only **one** genuine unresolved owner-level/product-architecture decision not resolved by the audit:

### Considered/rejected decision-evidence persistence boundary

The requirement is clear: material alternatives and why they lost must remain truthfully explainable.

What remains undecided is whether the durable representation should be:

- rejected `RecoveryStrategy` rows plus audit/tool evidence;
- a separate bounded planning-attempt/decision-evidence record;
- or a hybrid.

Repository evidence supports all three technically, although the hybrid currently looks strongest.

This should be resolved as an architecture decision before implementation.

Everything else material to B1/B2 boundaries is sufficiently resolved by owner clarification and repository evidence.

---

# Final reconstructed product truth

NORTHSTAR is **not** a programme recovery engine waiting for a flight engine to be added.

It is a generalized trip-resolution system whose PostgreSQL **state/evaluation/execution foundation is already substantially better than before**, but whose **planning intelligence and product decision surface were partially disconnected during M10 convergence**.

Before the refactor, NORTHSTAR already had substantial generalized recovery behaviour:

- read-only provider research;
- flight/hotel evidence gathering;
- multi-round planning;
- candidate enumeration;
- rejection evidence;
- deterministic viability;
- ranking;
- whole-trip Case presentation;
- sequential recovery.

The refactor correctly replaced the weak parts:

- SQLite;
- aggregate state ownership;
- shallow state mutation;
- weaker evaluation;
- weaker execution durability;
- weaker authority/reconciliation.

It incorrectly treated the strong parts as collateral “legacy.”

The correct recovery is therefore:

**current PostgreSQL spine  
+ adapted historical planner capabilities  
+ current StrategyProposer/RC-6 contracts  
+ truthful decision evidence  
+ adapted rich Case UX  
= the real NORTHSTAR engine.**

Then:

**B1 proves reasoning + internal execution.  
B2 proves the same engine under consequential external execution.**

No foundational rewrite is justified.
