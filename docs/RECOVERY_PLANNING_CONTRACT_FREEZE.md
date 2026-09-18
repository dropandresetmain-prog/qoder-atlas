# Recovery Planning Contract Freeze

Status: **FROZEN FOR FORWARD IMPLEMENTATION**  
Date: 2026-09-18  
Authoritative product decision input: `PRODUCT_PARITY_TRUTH_REBASE_2026-09-18.md` plus the owner freeze that follows it.

This document freezes the smallest forward architecture needed to reconnect NORTHSTAR's generalized planning/reasoning capabilities to the accepted PostgreSQL state/evaluation/authority/execution spine. It does **not** reopen the ontology, replace RC-6, restore SQLite, restore `RuntimeOrchestrator`, or authorize B1/B2 implementation by itself.

## 1. Purpose

The refactor correctly replaced weak persistence/state/execution foundations. It did not prove that useful planning and product capabilities were obsolete.

The forward architecture is therefore:

```text
PostgreSQL current state + M6/RC-6 + M8/M9 authority/execution
    + adapted bounded read-only planning/research
    + current StrategyProposer port
    + truthful material decision evidence
    + viable-only recommendation
    + one continued-recovery owner
    + PostgreSQL Case projection
```

No second recovery engine is introduced.

## 2. Canonical recovery loop

```text
change / request / new information
-> authoritative state update
-> determine affected scope
-> assess whole-trip consequences
-> identify relevant recovery domains
-> identify evidence gaps
-> bounded read-only research
-> generate candidates across relevant domains
-> schema/business validation
-> deterministic counterfactual viability (RC-6)
-> retain material decision evidence
-> compare VIABLE candidates
-> recommend / explain preferred recovery
-> authority / human decision
-> ActionPlan / permitted execution
-> observation / reconciliation
-> authoritative state update
-> reassessment
-> recovered? resolve
-> not recovered but recoverable? re-enter planning from NEW canonical state
-> otherwise escalate / await decision
```

A provider/API success is never synonymous with a recovered trip.

## 3. C1 — Recovery Planning Coordinator

### Frozen responsibility

The normal planning owner is an **application service extending/adapting `src/app/target/recoveryPlanning.ts`**, not a parallel engine.

Conceptual contract:

```ts
interface RecoveryPlanningCoordinator {
  planCase(input: {
    recoveryCaseId: SubjectId;
    reason: 'CASE_OPENED' | 'REASSESSMENT' | 'OPERATOR_REQUEST';
  }): Promise<RecoveryPlanningResult>;
}

interface RecoveryPlanningResult {
  planningAttemptRef: SubjectId;
  basisAssessmentId: SubjectId;
  viableStrategyRefs: SubjectId[];
  recommendation?: StrategyRecommendation;
  outcome:
    | 'AWAITING_AUTHORITY'
    | 'NEEDS_EVIDENCE_OR_DECISION'
    | 'NO_RECOVERY_FOUND'
    | 'STALE_RETRY_REQUIRED';
}
```

Workspace, actor, UnitOfWork, capability registry, proposers, deterministic evaluator, read-tool dispatcher and persistence are dependencies of the application composition, not model-controlled input.

### It owns

- loading the current failing/problem context from the RecoveryCase;
- capturing the current planning world/manifest;
- recovery-domain identification;
- evidence-gap identification;
- bounded read-only tool rounds;
- invoking applicable StrategyProposers;
- collecting ProposalCandidates;
- candidate schema/business validation;
- invoking existing deterministic RC-6 evaluation;
- retaining material rejected/considered evidence;
- collecting the viable RecoveryStrategy set;
- handing the viable set to comparison/recommendation;
- persisting planning artefacts through explicit commands.

### It does not own

- canonical Trip/Journey/Programme/provider mutation;
- hard viability;
- authority;
- consequential execution;
- provider-observed truth;
- case resolution.

Planning artefact persistence is allowed; authoritative world mutation is not.

## 4. AI / deterministic split

AI may:

- propose recovery domains worth investigating;
- identify evidence gaps;
- generate candidate strategies;
- infer soft preferences when explicitly labelled as inferred;
- judge semantic consequences and convenience;
- compare already-viable candidates;
- explain recommendation trade-offs.

Deterministic code owns:

- contract/schema/business validation;
- current-state capture/currentness;
- provider-normalized facts;
- arithmetic, time, timezone and currency;
- dependency/applicability propagation;
- hard constraints and hard policy;
- RC-6 viability;
- authority;
- ActionPlan compilation;
- execution validation;
- observations/reconciliation;
- canonical mutation;
- resolution.

Required consequential path remains:

```text
AI proposal
-> validation
-> deterministic viability
-> authority
-> executor
-> observation
-> canonical state
-> reassessment
```

Recommendation never changes a deterministic viability result.

## 5. C2 — Read-only tool request / result contract

The useful historical `ToolRequest`, `PriorToolResult`, `planningLoop` and `dispatch.ts` design is **ADAPT**, not replace.

The existing closed read-only operation vocabulary remains the starting vocabulary:

- flight search/verify/fare/status/quote reads;
- hotel context/search/quote/retrieve;
- routing context;
- transfer search/quote/retrieve;
- entry/local research.

Consequential verbs remain structurally absent from the planner tool protocol.

### Request

```ts
interface PlanningToolRequest {
  id: EntityId;
  capability: CapabilityFamily;
  operation: ToolOperation; // read-only closed vocabulary
  parameters: Readonly<Record<string, unknown>>;
  purpose: string;
  evidenceGapCode: string;
  round: number;
}
```

The operation/family pair must validate exactly as the historical contract already does. Equivalent requests deduplicate by canonical `capability + operation + parameters`.

### Result

```ts
interface PlanningToolResult {
  requestId: EntityId;
  capability: CapabilityFamily;
  operation: ToolOperation;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE';
  normalizedEvidence?: unknown; // operation-specific validated provider-neutral result
  provenance: {
    providerId?: string;
    mode: 'LIVE' | 'RECORD' | 'REPLAY' | 'INTERNAL';
    observedAt: Instant;
    sourceRefs?: EntityId[];
    recordingRef?: string;
  };
  uncertainty?: Array<{ code: string; summary: string }>;
  error?: {
    category: string;
    code: string;
    message: string;
    retryable?: boolean;
  };
}
```

Rules:

- downstream planners consume normalized provider-neutral evidence, never provider wire payloads;
- LIVE / RECORD / REPLAY share normalization and downstream planning code;
- external failure is visible data, not fabricated evidence;
- the coordinator enforces a configured finite round/request budget;
- equivalent read requests may replay prior results within the same current planning basis;
- no request shape can represent booking, payment, cancellation submission or any other consequential operation.

## 6. C3 — Recovery-domain identification

Initial recovery-domain IDs are:

```text
TRANSPORT
STAY
TRANSFER
PROGRAMME
SUPPORT_COORDINATION
INFORMATION_RESEARCH
```

This is a registry boundary, not a permanent exhaustive enum for all future domains.

Selection is hybrid:

1. deterministic activators identify domains made obviously relevant by current failing dimensions, affected object kinds, ownership and available capabilities;
2. AI may propose additional domains/evidence needs from semantic context;
3. the deterministic domain registry validates applicability, capability availability and required input coverage;
4. unsupported/inapplicable domains fail closed and remain explainable evidence where material;
5. the coordinator invokes all applicable domains needed for the current problem without hardcoded ordering.

There is no `if Sarah -> transport + programme` rule and no global `flight first -> programme second` pipeline. Search order is an implementation scheduling concern; the final investigated set and recommendation emerge from current state, dependencies, evidence and available capabilities.

`INFORMATION_RESEARCH` may be evidence-only and need not produce an executable strategy.

## 7. C4 — StrategyProposer relationship

The current `StrategyProposer` port survives.

A proposer remains proposal-only:

```text
current PlanningWorld
+ failing subjects
+ applicable recovery domain
+ relevant PlanningToolResults
-> ProposalCandidate[]
```

Minimum adaptation:

- proposer registration declares the recovery domain(s) it can serve;
- proposer input gains only the relevant normalized planning evidence and explicit/inferred preference context needed to propose;
- candidate provenance records proposer ID, domain and evidence refs in the planning attempt;
- current `ProposalCandidate` validation and closed `ScenarioEffect` vocabulary remain the safety boundary.

A proposer never declares authoritative truth, viability, authority or execution success.

Historical `northstarPlanner.ts` / `fallbackPlanner.ts` are algorithm sources for travel/stay proposers; their old TripSnapshot/SQLite composition is not copied.

## 8. C5 — Material considered/rejected decision evidence

### Frozen owner decision: hybrid

- **VIABLE executable alternatives remain proper RecoveryStrategy objects.**
- **Material considered but rejected proposals do not automatically become RecoveryStrategy rows.**
- low-value/junk/duplicate intermediate candidates may remain ephemeral;
- no chain-of-thought, hidden reasoning transcript or agent scratchpad is persisted.

### Why persistence is required

The product must explain material alternatives after process restart and during later operator review. Today:

- `PlanningReport` is ephemeral;
- current `recovery_strategies` intentionally persists only viable executable candidates;
- `change_records` records committed mutations, not what was researched or why a candidate lost.

Therefore existing persistence cannot truthfully answer the required product questions.

### Smallest durable representation

Add one immutable **RecoveryPlanningAttempt** record per completed planning basis. Do **not** add a separate table per concept in B1.

Conceptual persisted shape:

```ts
interface RecoveryPlanningAttempt {
  id: SubjectId;
  recoveryCaseId: SubjectId;
  basisAssessmentId: SubjectId;
  basisManifest: WorldSnapshotManifest;
  startedAt: Instant;
  completedAt: Instant;
  coordinatorVersion: string;

  domains: Array<{
    domainId: RecoveryDomainId;
    source: 'DETERMINISTIC' | 'AI';
    disposition: 'INVESTIGATED' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
    reasonCode?: string;
  }>;

  evidence: PlanningEvidenceRecord[];
  materialCandidates: MaterialCandidateEvidence[];
  recommendation?: StrategyRecommendation;
}

interface PlanningEvidenceRecord {
  evidenceRef: string;
  requestFingerprint: string;
  capability: CapabilityFamily;
  operation: ToolOperation;
  status: PlanningToolResult['status'];
  summary: string; // bounded, factual, no chain-of-thought
  provenance: PlanningToolResult['provenance'];
  uncertainty?: Array<{ code: string; summary: string }>;
}

interface MaterialCandidateEvidence {
  candidateKey: string;
  proposerId: string;
  domainId: RecoveryDomainId;
  strategyRef?: SubjectId; // present when promoted to persisted viable RecoveryStrategy
  disposition:
    | 'REJECTED_VALIDATION'
    | 'REJECTED_DETERMINISTIC'
    | 'VIABLE_NOT_RECOMMENDED'
    | 'RECOMMENDED';
  evidenceRefs: string[];
  validationReasonCodes?: string[];
  viability?: StrategyViability;
  viabilityDecisionCodes?: string[]; // actual RC-6 output codes
  immediateChangeBlastRadius?: ImmediateChangeBlastRadius;
  reassessmentClosure?: TypedRef[];
  outcomeDelta?: OutcomeDeltaEntry[];
}
```

Implementation persistence direction: one immutable `recovery_planning_attempts` row with bounded typed JSON fields for domains/evidence/materialCandidates/recommendation plus FK to case/basis assessment and ordinary command/change-record audit. Viable strategy detail remains normalized in existing `recovery_strategies` / `strategy_changes`.

Normalize the candidate evidence into another table only if later query/cardinality requirements prove the bounded attempt record insufficient.

Recommendation prose cannot rewrite RC-6 decision codes.

## 9. C6 — Strategy comparison / recommendation

Only currently valid `VIABLE` RecoveryStrategies may enter comparison.

### Deterministic comparison facts

The comparison layer receives structured facts computed outside the LLM where available:

- explicit preference matches/conflicts;
- organisation/event priorities and soft-policy facts;
- normalized price/cost facts;
- timing/duration/buffer facts;
- number/type of proposed changes;
- immediate-change blast radius;
- outcome delta;
- uncertainty/evidence coverage;
- journey/operational complexity measures that have explicit deterministic definitions.

Hard policy and hard constraints have already gated viability.

### Semantic judgement

AI may compare the viable set for convenience, semantic consequences and soft trade-offs. Explicit preferences outrank inferred preferences. Inferred preferences are labelled and cannot override explicit preferences or deterministic hard policy.

### Structured result

```ts
interface StrategyRecommendation {
  recommendedStrategyRef: SubjectId;
  alternativeStrategyRefs: SubjectId[];
  recommendationBasis: Array<{
    code: string;
    summary: string;
    kind: 'DETERMINISTIC_FACT' | 'EXPLICIT_PREFERENCE' | 'SEMANTIC_JUDGEMENT';
  }>;
  tradeoffs: Array<{
    strategyRef: SubjectId;
    advantages: string[];
    disadvantages: string[];
  }>;
  uncertainty: Array<{
    code: string;
    summary: string;
    evidenceRefs: string[];
  }>;
  evidenceRefs: string[];
  provenance: {
    kind: 'DETERMINISTIC' | 'AI_ASSISTED';
    comparatorVersion: string;
    model?: string;
    modelVersion?: string;
  };
}
```

Validation must reject a recommendation that names a non-viable, stale or foreign-case strategy.

A scalar LLM “viability score” is not part of the contract.

## 10. C7 — Three blast-radius semantics

These names are frozen and must stay separate in backend/read models.

### A. `immediateChangeBlastRadius`

**Question:** What does this proposed strategy directly change or directly affect?

Source of truth:

- validated `ScenarioChange.effects`;
- `ScenarioChange.affectedSubjectRefs`;
- deterministic effect-specific direct-impact projection.

Computed after candidate validation. It is **not** the RC-6 dependency closure.

For persisted viable strategies it is derived/materialized from `strategy_changes` plus deterministic direct-impact projection; no separate truth table is required initially. For a material rejected candidate with no RecoveryStrategy row, the decision-time projection is retained in its PlanningAttempt evidence.

It carries typed identifiers grouped as changed/directly affected objects/subjects, not only a count.

### B. `reassessmentClosure`

**Question:** What broader state did NORTHSTAR actually reevaluate to prove the candidate safe?

Source of truth: the M6/RC-6 dependency/applicability closure actually assessed.

Computed during deterministic counterfactual evaluation.

For viable strategies the reached subject set is represented by the strategy's candidate assessment summaries/manifest. For material rejected candidates, the decision-time reached refs are retained in PlanningAttempt evidence.

It may be much broader than the immediate proposed change.

### C. `outcomeDelta`

**Question:** Who becomes better, worse or unchanged under the candidate relative to the captured baseline?

Source of truth: the RC-6 baseline/candidate subject pairs (`StrategySubjectVerdict`), captured at decision time.

```ts
interface OutcomeDeltaEntry {
  subjectRef: TypedRef;
  baseline: 'PASS' | 'FAIL' | 'UNKNOWN';
  candidate: 'PASS' | 'FAIL' | 'UNKNOWN';
  delta: 'BETTER' | 'WORSE' | 'UNCHANGED';
}
```

Conservative deterministic classification:

- `FAIL -> PASS`, `UNKNOWN -> PASS` = BETTER;
- `PASS -> UNKNOWN`, `PASS -> FAIL`, `UNKNOWN -> FAIL` = WORSE;
- all other transitions = UNCHANGED, while preserving baseline/candidate values so unresolved movement such as `FAIL -> UNKNOWN` is not mislabelled as recovery.

Outcome delta is retained in PlanningAttempt evidence because recomputing it later against newer canonical state would falsify what was known when the decision was made.

The browser never derives or collapses these three semantics.

## 11. C8 — Continued recovery

`RuntimeOrchestrator` is not restored.

There is one normal application owner for post-reassessment case progression: a **Recovery Lifecycle Progression** service composed exactly once under `runtimeServices`.

Conceptual decision:

```text
execution/observation or other canonical change
-> normal invalidation/reassessment
-> settled current assessment
-> Recovery Lifecycle Progression
    -> resolution gate passes + execution reconciled: RESOLVE
    -> authority/execution still pending: WAIT
    -> still failing + recovery remains possible: planCase() from NEW canonical basis
    -> no safe recovery / human evidence or decision required: ESCALATE / AWAIT DECISION
```

Rules:

- the progression service reuses the existing case lifecycle; it does not invent a second status machine;
- it never assumes an old candidate remains current;
- a planning attempt is bound to its basis assessment/manifest;
- execution workers do not recursively plan;
- the planning coordinator does not own execution;
- case resolution stays in the existing deterministic resolution gate;
- implementation must reuse current runnable-work/idempotency patterns instead of an in-memory recursive loop.

If implementation proves the existing case lifecycle lacks a truthful state for a required human/escalation condition, report that as a contract gap before adding a new phase.

## 12. C9 — Case product projection requirements

This freezes backend information, not final UI.

The PostgreSQL Case projection must answer, with human labels plus typed refs as secondary metadata:

- what changed and which ChangeSignal/cause establishes it;
- why the trip/person is not okay now;
- which dependencies are affected;
- which recovery domains NORTHSTAR investigated;
- which read-only evidence/tools were used and with what provenance/uncertainty;
- which material alternatives were considered;
- why a material candidate failed validation or deterministic viability;
- which viable alternatives remain;
- which viable strategy NORTHSTAR recommends and why;
- `immediateChangeBlastRadius`;
- `reassessmentClosure`;
- `outcomeDelta`;
- what exact RecoveryStrategy/ActionPlan the operator is approving;
- required authority/decision state;
- execution attempt and reconciliation state;
- what the internal/provider executor actually reported;
- the current post-observation assessment;
- whether the trip is actually recovered/resolved.

Planning-time evidence and current authoritative state must be visibly distinguishable in the read model. Internal UUIDs/capability codes are never the primary product explanation.

The rich pre-refactor Case workspace is information-architecture reference material. It is adapted onto current PostgreSQL read models; it is not reconnected to SQLite or ported pixel-for-pixel.

## 13. C10 — B1 acceptance contract

B1 proves **full Sarah recovery reasoning + internal execution**, not merely a programme proposer.

Required behavioural path:

```text
provider/airline reprotection evidence
-> current whole-trip assessment FAIL
-> generalized coordinator identifies relevant recovery domains
-> provider-neutral read-only travel evidence gathered
-> travel candidate(s) generated/evaluated
-> material rejected or inferior travel alternative remains explainable
-> programme-side candidate(s) generated where current evidence makes them relevant
-> precise immediate programme-change blast radius
-> RC-6 reassessment closure
-> outcome delta
-> viable-only comparison
-> preferred strategy recommended/explained
-> operator sees exactly what changes and who is affected
-> approval
-> current ActionPlan / authority path
-> internal programme execution
-> observation
-> canonical update
-> reassessment
-> Sarah PASS
-> case RESOLVED
-> unrelated FAIL/UNKNOWN remains truthful
```

The selected programme strategy must emerge from generalized planning/evidence/evaluation/comparison. No Sarah branch, no fixed `flight then programme` pipeline, and no fixture IDs/routes in application logic.

B1 does **not** require consequential external booking/payment execution.

One second materially different planning situation must use the same coordinator/contracts before B1 acceptance. It may stop before external dispatch; B1 planning generality does not depend on B2.

## 14. B2 acceptance contract

B2 proves the same planner/lifecycle under consequential externally owned execution.

It reuses:

- Recovery Planning Coordinator;
- planning evidence model;
- StrategyProposer port;
- RC-6;
- recommendation layer;
- RecoveryStrategy / ActionPlan;
- authority.

It adds:

```text
external ActionIntent
-> deterministic execution gate
-> durable attempt BEFORE network
-> provider-neutral dispatch
-> success / failure / partial / lost response / OUTCOME_UNKNOWN
-> observation / reconciliation
-> no blind retry
-> canonical provider-owned state
-> reassessment
-> continued recovery if still failing
-> resolution or explicit escalation
```

Jordan is the materially different proof, not an architecture branch.

## 15. Reuse / adaptation map

| Contract | Current component to keep | Historical component/algorithm to mine | Exact adaptation required | Must not be copied |
|---|---|---|---|---|
| C1 coordinator | `target/recoveryPlanning.ts`, StrategyProposer, RC-6 | `planningLoop.ts` | bounded research/proposer/evaluation/recommendation composition around current target path | old TripSnapshot/SQLite composition or another engine |
| C2 read tools | provider-neutral capabilities, Atlas normalization/LIVE-RECORD-REPLAY | old `ToolRequest`, `dispatch.ts`, `PriorToolResult` | move the read-only protocol to current planning context; typed provenance/failure | consequential operations or provider wire payloads |
| C3 domains | current assessments/failing subjects/PlanningWorld | domain-selection reasoning in old Northstar/fallback planners | registry + deterministic activation + validated AI additions | Sarah/Jordan branches or global domain ordering |
| C4 proposers | current `StrategyProposer` + ProposalCandidate validation | Northstar/fallback travel/stay algorithms | supply domain/evidence context and emit current ScenarioEffects | planner-declared viability/authority/success |
| C5 decision evidence | existing viable RecoveryStrategy tables + `change_records` audit | old planning candidate/rejection evidence | one bounded immutable PlanningAttempt; refs to viable strategies | chain-of-thought, scratchpad, every junk candidate as a strategy |
| C6 recommendation | RC-6 viability + current preferences/policy facts | old ranking heuristics (trade-offs/cost/order) | compare only current VIABLE strategies; structured recommendation | LLM PASS/FAIL, hard-policy override, opaque scalar score |
| C7 blast semantics | ScenarioChange, RC-6 closure, subject verdict pairs | old affected/options presentation | three explicit backend projections | one “N reached subjects” blast metric |
| C8 continuation | runtimeServices, reassessment, execution workers, resolution gate | bounded `continueApprovedRecovery()` behaviour | one post-reassessment case-progression owner using fresh state | RuntimeOrchestrator, recursive executor/planner loop |
| C9 Case projection | PG read-model assemblers/current shell | old operator Case/view-model/readmodels IA | project planning evidence/recommendation/blast/authority/execution truth | SQLite reads or UUID-first UI |
| C10 acceptance | current M8/M9 authority/execution/resolution | Sarah/Jordan historical scenarios | rebase B1 on reasoning parity; B2 only adds external consequence | milestone convenience redefining product scope |

This is adaptation, not a rebuild.

## 16. Explicit non-goals

This freeze does not authorize:

- PostgreSQL ontology redesign;
- a graph database;
- a second recovery engine;
- SQLite runtime restoration;
- RuntimeOrchestrator restoration;
- RC-6 replacement;
- M8 authority/execution rebuild;
- Atlas adapter rebuild;
- Event Overview redesign;
- whole-event graph/semantic zoom;
- SSE/WebSockets;
- physical deletion of historical SQLite code;
- broad provider/payment work before B1 requires it;
- chain-of-thought persistence.

## 17. Behavioural tests to write before implementation

### Planner parity

1. current failure/state activates relevant recovery domain(s);
2. an evidence gap emits a typed read-only tool request;
3. normalized tool evidence changes candidate generation;
4. multiple domains/candidates coexist in one planning attempt;
5. RC-6 rejects at least one material candidate;
6. the actual deterministic rejection code remains inspectable after persistence/reload;
7. viable candidates become proper RecoveryStrategies;
8. recommendation selects/explains only among viable candidates;
9. a recommendation naming a rejected/non-viable/stale strategy fails validation;
10. equivalent tool requests deduplicate and research rounds are bounded;
11. tool failure/partial evidence remains visible rather than becoming a fabricated fact.

### Blast radius

1. immediate proposed-change blast radius names the precise direct changed/affected refs;
2. reassessment closure may be broader than the immediate blast;
3. outcome delta separately reports better/worse/unchanged with baseline/candidate verdicts;
4. Case read model exposes all three without conflation.

### Continuation

1. an observed successful action that leaves the case failing re-enters planning;
2. the new attempt uses the new current assessment/manifest;
3. stale prior candidates are not assumed current;
4. terminal resolution occurs only after reconciled execution + current required-subject PASS.

### Anti-hardcoding/generalization

At least two materially different planning situations use the same coordinator, domain registry, proposer port, evidence contract, RC-6 and recommendation contract. The second proof must not require B2 external dispatch.

## 18. Shortest safe implementation programme

### R1 — Planning and decision-evidence parity

Objective: make the current PostgreSQL planning path capable of domain identification, bounded read research, cross-domain proposals, RC-6 material rejection evidence and viable-only recommendation.

Primary ownership:

- current target recovery-planning composition;
- current/v2 planning contracts;
- planning-domain registry;
- read-tool adapter over existing provider-neutral capabilities;
- travel proposer adaptation;
- one PlanningAttempt persistence command/read path;
- recommendation comparator.

Safe lanes **after this freeze**:

- Planner lane — coordinator/read tools/travel proposer/comparator.
- Evidence lane — PlanningAttempt persistence + blast/outcome projection.
- Verification lane — behavioural tests/anti-hardcoding second proof.

Primary architect/integrator retains shared contracts, any migration, orchestration and integration.

Acceptance: planner-parity + blast semantic tests above; two materially different planning situations; no product UI dependency.

Focused tests first; broaden only at a coherent integration checkpoint.

### R2 — Product decision surface

Objective: adapt the rich Case information architecture onto the frozen PostgreSQL projection.

Owned areas:

- Case read-model contract/assembler;
- material decision evidence;
- recommendation;
- three blast projections;
- approval/execution/observation/current-outcome projection;
- focused Case UI adaptation.

Do not redesign Event Overview.

Acceptance: every question in C9 has an authoritative backend field and the operator can distinguish current truth, proposed change, planning-time evidence and observed execution.

One product/read-model review is warranted at the R2 integration boundary; not at every UI change.

### R3 — Full rebased B1

Objective: prove the complete Sarah reasoning story and internal recovery lifecycle.

Integrate:

- provider reprotection/current FAIL;
- read-only travel investigation;
- travel + programme alternatives as applicable;
- material rejected/inferior evidence;
- viable-only recommendation;
- approval/internal execution;
- observation/reassessment;
- continued-recovery owner;
- final PASS/resolution.

Acceptance is exactly C10 plus the second-situation same-coordinator proof.

This is the main pre-B2 review/Founder acceptance checkpoint.

### B2 — Consequential external execution

Only after R3/B1 acceptance.

Add the minimum provider-neutral external dispatch/reconciliation composition around the existing execution worker/adapters. Exercise durable-attempt-before-network, OUTCOME_UNKNOWN/partial/lost-response reconciliation, no blind retry and continued recovery. Jordan proves generality.

## 19. Issue/risk triage

### Act Now

- generalized Recovery Planning Coordinator;
- provider-neutral read-tool planning composition;
- transport/travel proposer adaptation;
- hybrid PlanningAttempt decision evidence;
- viable-only recommendation/comparison;
- continued-recovery progression owner;
- three blast-radius projections;
- rich Case projection;
- rebased B1/B2 forward docs;
- behavioural planner/blast/continuation tests;
- foundational capability-parity/no-silent-retirement gate.

### Investigate Now

- choose the cheapest fixture-ready second B1 planning proof (prefer an existing request/stay/transport scenario such as S4/S5 rather than inventing a new scenario);
- confirm exact PostgreSQL migration number/indexes/JSON size bounds for `recovery_planning_attempts` at implementation time;
- confirm which current preference/rule projections are sufficient comparator inputs before adding any new read path.

These investigations may refine implementation detail; they do not reopen the frozen contracts above.

### Park for Later

- consequential external dispatch composition until B2;
- budget/spend holds unless a B1 requirement actually crosses a money-moving boundary;
- Event Overview redesign;
- whole-event graph/semantic zoom;
- SSE/WebSockets;
- final presenter polish;
- broad provider-reference auto-correlation;
- physical deletion of historical SQLite code.

### Ignore / Accept Risk

- rewriting the PostgreSQL ontology;
- resurrecting SQLite;
- replacing RC-6;
- rebuilding M8 authority/execution;
- rebuilding Atlas adapters;
- rebuilding NORTHSTAR from scratch.

## 20. Major-decision records

### Coordinator composition

**WHAT WE KNOW:** `target/recoveryPlanning.ts` already owns current candidate validation/evaluation/persistence and StrategyProposer is a valid proposal port.  
**WHAT WE DO NOT KNOW:** the exact final function/file split until implementation.  
**KEY ASSUMPTION:** the missing capability is orchestration around this path, not a new engine.  
**WHAT SHOULD BE TESTED NEXT:** a focused planner test where a tool round changes candidate generation before RC-6.

### Read-tool protocol

**WHAT WE KNOW:** the historical closed read-only ToolRequest/dispatch contract already separates planning research from consequential operations; provider-neutral capability and LIVE/RECORD/REPLAY normalization still exist.  
**WHAT WE DO NOT KNOW:** which B1 evidence calls require LIVE versus RECORD/REPLAY in the final demo environment.  
**KEY ASSUMPTION:** provenance-truthful normalized evidence is sufficient for B1 reasoning; B1 does not require a consequential provider action.  
**WHAT SHOULD BE TESTED NEXT:** same planning test using provider-normalized result shapes in at least two modes without changing downstream planning logic.

### Domain selection

**WHAT WE KNOW:** failures/dependencies activate obvious domains deterministically, while semantic context can make additional domains worth investigating.  
**WHAT WE DO NOT KNOW:** whether every future domain has a useful deterministic activator.  
**KEY ASSUMPTION:** hybrid selection plus deterministic applicability validation fails closed without scenario branches.  
**WHAT SHOULD BE TESTED NEXT:** two different cases activate different domain sets through the same registry.

### Planning/decision evidence

**WHAT WE KNOW:** ephemeral PlanningReport/change_records/current viable-only strategies cannot explain material rejected alternatives after restart.  
**WHAT WE DO NOT KNOW:** whether later analytics will need per-candidate SQL queries.  
**KEY ASSUMPTION:** one bounded immutable PlanningAttempt is sufficient for B1; normalize only on demonstrated need.  
**WHAT SHOULD BE TESTED NEXT:** persist/reload a material deterministic rejection and a viable-not-recommended alternative with their evidence/delta intact.

### Recommendation boundary

**WHAT WE KNOW:** RC-6 is authoritative viability and current StrategyProposer cannot assert it.  
**WHAT WE DO NOT KNOW:** whether the first implementation uses deterministic comparison only or Qwen-assisted semantic comparison.  
**KEY ASSUMPTION:** both can satisfy one structured viable-only contract; AI assistance is an implementation choice, not a safety-boundary change.  
**WHAT SHOULD BE TESTED NEXT:** reject any recommendation referencing a non-viable/stale strategy and prove explicit preference outranks inferred preference.

### Three blast semantics

**WHAT WE KNOW:** ScenarioChange, RC-6 closure and baseline/candidate pairs already represent three different facts.  
**WHAT WE DO NOT KNOW:** how much relation-detail the first Case UI needs beyond typed refs/labels.  
**KEY ASSUMPTION:** backend separation now prevents UI conflation and can be enriched without changing meaning.  
**WHAT SHOULD BE TESTED NEXT:** one candidate whose direct programme change touches a small set while RC-6 reassesses a broader set.

### Continued recovery

**WHAT WE KNOW:** reassessment, execution and resolution already have stronger current owners; old bounded continuation behaviour is missing from normal composition.  
**WHAT WE DO NOT KNOW:** whether the existing runnable-work table can host the progression wake-up without any additive persistence.  
**KEY ASSUMPTION:** runtimeServices remains the sole composition root and one case-progression service can reuse existing durable/idempotent patterns.  
**WHAT SHOULD BE TESTED NEXT:** observed-success-but-still-FAIL must create a new planning attempt from the new current basis exactly once.

### B1/B2 boundary

**WHAT WE KNOW:** Sarah needs cross-domain reasoning before internal programme execution; external consequential execution is not required to prove that reasoning. B2 is the same engine under external consequence/reconciliation.  
**WHAT WE DO NOT KNOW:** the final provider mode used for every demo read call.  
**KEY ASSUMPTION:** product acceptance is behavioural and provider provenance is reported truthfully.  
**WHAT SHOULD BE TESTED NEXT:** full C10 B1 flow plus a second materially different planning case before external dispatch work begins.

## 21. Unresolved owner decisions

**None required to begin R1 after this freeze is accepted.**

Implementation-level investigations in §19 are intentionally bounded and may not redefine NORTHSTAR, B1/B2, viability, authority or the evidence contract.
