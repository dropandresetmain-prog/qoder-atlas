# NORTHSTAR Graph Production Contract

**Repository:** `dropandresetmain-prog/qoder-atlas`  
**Audit date:** 20 September 2026  
**Mode:** Read-only static contract audit  
**Audited R4 integration branch:** `integration/r4-final-acceptance`  
**Audited R4 HEAD:** `795f49e6a4a4efe6adb4f5e56a60c02a58ba089f`

> Commit note: this document was later committed on a docs-only branch created from the then-current remote tip of `integration/r4-final-acceptance`, `462ea5e1d307ac806b1a3388baefa305a52e09c4`. The static findings below remain explicitly tied to the audited snapshot above unless re-verified.

## Executive contract

The accepted visual truth is sufficient for Astra to implement/verify both graphs without reopening design archaeology.

The binding architecture is:

**authoritative backend semantics → bounded presentation projection → frontend visual state → renderer**

The browser may arrange, size, dim, select, animate, pan, zoom, preserve camera state, and choose how much already-authoritative information to reveal.

The browser may **not** decide whether something is viable, failed, causal, in the blast radius, permitted, policy-compliant, provider-confirmed, or consequential.

Two important distinctions are binding:

- **Case V5.6** explains one current trip: what changed → what it affects → first operational breakpoint → what still works → whether the trip purpose/current trip remains satisfied.
- **Overview V7.2** explains the current event world: population health → shared concentration → current change → blast radius → cleared/unresolved travellers → affected programme context → route into a Case.

Neither graph is an agent workflow visualisation.

### What is known

V5.6 visual/interaction truth is frozen. R2 subsequently froze causal ownership, CHECKING semantics, pulse ownership, Original/Current, polling, and graph scope.

V7.2 visual/interaction truth is frozen at accepted commit `563320e4e9ef7c2ea7dc4f53f0d07b3045dcfeb1` and has been brought into R4 docs.

R4 now has meaningful production implementations for both surfaces, including a dedicated bounded `eventOverview` projection. They are not merely prototypes.

### What remains unproven by this audit

This was static inspection. Actual browser readability, card collision, connector collision, responsive framing, and physical camera behaviour still require the browser acceptance passes below.

### Key implementation assumption

`integration/r4-final-acceptance @ 795f49e6...` was the production baseline audited for this contract.

---

# 1. V5.6 purpose — Live Dependency Graph

V5.6 is the **focused current-world causal explanation inside a Recovery Case**.

Within seconds the operator should understand:

**what changed → supplier/service current state → what depends on it → first operational breakpoint → downstream consequence → what remains healthy → whether the trip's purpose/current trip still works.**

It is not the entire Case page. Planning evidence, alternatives, approval, execution and authority live around it.

The graph is milestone-updated current truth, not a playback of backend activity.

The canonical Case graph remains **CURRENT**. The only historical comparison is the separately persisted immutable **Original** snapshot.

---

# 2. V7.2 purpose — Event Overview Graph

V7.2 is the **bounded current-world programme/operations map**.

Within seconds the operator should understand:

- whether the managed travelling population is broadly okay;
- that the event world is being monitored;
- which meaningful shared dependency changed;
- how broad the affected set is;
- who cleared;
- who remains unresolved;
- which major programme context is implicated;
- where to click to inspect detailed causality in V5.6.

Its stable geography is:

**shared dependencies → programme spine ← traveller population / promoted exceptions**

It is deliberately not a zoomed-out Case Graph and not the entire ontology.

---

# 3. What the two graphs deliberately do NOT represent

## Both graphs exclude

- raw PostgreSQL/domain topology;
- a graph database;
- LangGraph/workflow topology;
- planner execution;
- model/tool calls;
- provider API calls;
- policy-evaluation internals;
- authority-engine internals;
- hidden evidence chains;
- animation/liveness persisted as business state.

## V5.6 specifically excludes

- rejected recovery alternatives;
- every `RecoveryStrategy`;
- approval workflow;
- execution attempts;
- recovery planner rounds;
- provider debugging;
- current + proposed recovery overlay;
- event-sourced graph history;
- arbitrary historical scrubber;
- a workflow/case-state node;
- a generic ontology explorer.

## V7.2 specifically excludes

- the detailed traveller causal chain;
- every booking;
- every hotel/transfer merely because it exists;
- every programme item;
- every traveller as a full-size card;
- participation/allocation records as visible nodes;
- policy/provider/tool internals;
- recovery options;
- the future “Entire Graph”.

---

# 4. V5.6 production mapping

| Design concept | Authoritative input | Current backend field/source | Presentation derivation allowed? | Frontend-only state | Current R4 implementation | Status |
|---|---|---|---|---|---|---|
| Changed thing | Current authoritative change/service state | `RecoveryCaseView.cause`, `changeSummary`; `ldg.nodes[].semanticState`; `ChangeAwareness` | Labels/tone from supplied state only | Revision highlight animation | DISRUPTION node is emitted from linked `change_signal`; semantic `CHANGED` | **NO GAP semantically; transition animation optional** |
| Causal path | Evaluator causal explanation | `RecoveryCaseView.causalPath`; `focusedGraph.causalNodeRefs/causalEdgeIds` | Lookup supplied refs/IDs only; never topology search | Dim/non-dim rendering | Backend `projectFocusedGraph()` maps ordered causal path | **NO GAP** |
| First operational breakpoint | First evaluator causal step | `focusedGraph.firstBreakpoint` | Size/glow/layout only | Focal-card dimensions/glow | Renderer consumes `firstBreakpoint.nodeRef` | **PARTIAL: semantic ref exists, but projection lacks timing granularity** |
| Meaningful arrival/timing breakpoint | Authoritative effective/current timing + evaluation | Should project into a `TIMING` node | Formatting old/current time allowed | Card arrangement | `projectFocusedCaseGraph.ts` documents TIMING but emits no TIMING node | **GAP — Act Now** |
| Healthy context | Authoritative non-failing surrounding entities | Other `ldg.nodes/edges` | May visually demote context | Opacity/layout | Deterministic layout retains contextual nodes | **NO GAP structurally** |
| Service state | Authoritative journey item/service assessment | `SERVICE_BOOKING` enrichment + `currentAssessmentView(JOURNEY_ITEM, VIABILITY)` | Human formatting only | Card styling | Service nodes exist; no assessment => `UNKNOWN`; effective changed arrival is not projected | **PARTIAL** |
| Commitment state | Authoritative programme consequence | `PROGRAMME_COMMITMENT` + assessment if available | No deriving missed/on-track from neighbouring traveller | Styling only | Nodes exist, but assembler does not generally load dedicated programme-item assessment unless already represented in assessment map | **GAP/PARTIAL — commitment-specific consequence is not reliably produced** |
| Whole-trip state | Authoritative case/journey assessment | `tripViability`, current subject assessment | Display wording only | None | Case workspace has it outside graph | **NO GAP for page; graph integration missing** |
| Trip purpose/objective | Canonical `objectives` | `objectives` table, loaded by `pgFactAssembler`; `tripViability` | A display-only projected purpose node is permitted | Layout/card treatment | `LdgNodeKind` has no objective kind; projector explicitly reports `objectiveContractGap` | **GAP — Act Now; do not fake with another kind** |
| Current | Live authoritative current graph | `view.ldg`, current `focusedGraph` | Render only | Selected Current tab | Current always regenerated | **NO GAP** |
| Original | Immutable first truthful failing graph | `RecoveryCaseView.originalFocusedGraph`; `recovery_case_graph_snapshots` | Render same renderer | Selected Original tab | Persisted immutable semantic snapshot; honest unavailable state supported | **NO GAP** |
| Current vs proposed | Current only | Recovery proposal data intentionally outside graph | No overlay | None | Graph remains current-world | **NO GAP — explicitly correct** |
| Weighted emphasis | Backend causal role/breakpoint | `firstBreakpoint`, causal refs/edges | Size/weight/opacity allowed | Exact card sizes | Focal/causal/context sizing implemented | **NO GAP** |
| Green presentation | Backend semantic condition | `LdgSemanticState` through semantic adapter | Tone mapping | CSS | Implemented | **NO GAP** |
| Amber presentation | Changed/affected; pending evaluation remains separate | semantic state + `evaluation=PENDING_REASSESSMENT` | CHECKING badge without rewriting truth | CSS | Implemented | **NO GAP** |
| Red presentation | Backend FAILED/alert state | node/edge semantic state | Tone mapping only | CSS/glow | Implemented | **NO GAP for supplied state** |
| Green normal pulse | Green presentation condition | No backend pulse field | Yes | Pulse duration | `2.4s` current choice | **NO GAP** |
| Amber slow pulse | Amber presentation condition | No backend pulse field | Yes | Pulse duration | `3.6s` current choice | **NO GAP** |
| Red no pulse | Red presentation condition | No backend pulse field | Yes | Absence of animation | Implemented | **NO GAP** |
| Edge semantic condition | Edge truth | `LdgEdge.semanticState?` | Missing state must stay unknown/neutral | Pulse only after tone exists | `scene.ts` currently substitutes the **target node's tone** when edge state is absent | **GAP — Act Now; violates semantic contract** |
| Pan | None | None | Yes | Camera x/y | Implemented | **NO GAP** |
| Zoom | None | None | Yes | Camera scale | Implemented | **NO GAP** |
| Home | Named-view bounds | Presentation scene bounds | Yes | Camera transition | Implemented | **NO GAP** |
| Selection | Visible authoritative topology | Already-present visible edge endpoints | Immediate-neighbour visual lookup allowed | Selected ref, dimming | Generic selection; no business mutation/camera snap | **NO GAP** |
| Trip Overview | Whole current visible Case graph | Current LDG | Framing only | Active view | Function exists, but button is labelled `Full trip` | **GAP — copy mismatch; rename to accepted `Trip Overview`** |
| Disruption Path | Supplied causal refs/edges | `focusedGraph` | Dim context + fit supplied path | Active view | Correct chain is emphasized, but `pathView.rect = allRect` | **GAP — Act Now: it does not actually frame the causal path** |
| Programme view | Relevant backend programme commitments/context | `PROGRAMME_COMMITMENT`, journey/programme facts | Grouping/layout from kind/explicit visible relations | Active view | Named Programme view exists and frames commitments + neighbours | **PARTIAL: lacks V5.6-style containing AnchorEvent/chronology richness** |
| Default framing | Path if disruption exists; Trip Overview otherwise | Presence of authoritative focused path | Yes | Initial camera | `defaultView = path` when path exists | **MODE correct; physical path frame currently wrong because `allRect`** |
| Readable cards/fonts | Semantic content only | None | Entirely frontend | Font sizes/card sizing | Uses 8.5px type, 9px badges, 10.5px detail, 14px title | **BROWSER UNPROVEN — Investigate Now** |
| No card overlap | None | None | Entirely frontend | Layout coordinates | Deterministic packing/fixed boxes designed to avoid node overlap | **STATIC SUPPORT, browser acceptance still required** |
| Poll refresh | Complete authoritative snapshot + monotonic revision | `projectionRevision`, shell polling | DOM patch/reconciliation only | Camera/view/selection persistence | Controller/store preserve state across graph replacement | **NO STATIC GAP** |
| No polling camera reset | Same | Same | Yes | Camera state | Explicitly preserved; auto-fit first render/Home only | **NO STATIC GAP** |
| Recovery/planning state | Must remain outside graph | Case status / strategies | No | Surrounding loader allowed | R4 still emits `RECOVERY_PROPOSAL` / “Recovery case” node into LDG | **GAP — Act Now; forbidden node** |

### Critical V5.6 semantic rule

`src/ui/semantics/adapter.ts` correctly maps an edge with no `semanticState` to **“State not supplied” / neutral**.

`src/ui/graph/scene.ts` then overrides that contract by borrowing the target node's tone:

> missing edge state → target node tone

That must not survive production acceptance. A relationship that has no authoritative semantic condition must not become green/amber/red or start pulsing merely because its target has that condition.

---

# 5. V7.2 production mapping

| Design concept | Authoritative input | Current backend field/source | Presentation derivation allowed? | Frontend-only state | Current R4 implementation | Status |
|---|---|---|---|---|---|---|
| Programme/current-world overview | Current ACTIVE-programme snapshot | `OperatorOverview.eventOverview` | Spatial composition | Camera/layout | Dedicated bounded projection exists | **NO GAP structurally** |
| All travellers/programme context | Authoritative `population` + programme projection | `population`, `days`, `cohorts`, `promotedTravellers` | Compression of already-supplied cohorts only | Cohort marks rendering | Promoted + remaining cohorts preserve population when programme days exist | **PARTIAL: no-programme case drops ordinary population from graph** |
| Disrupted traveller emphasis | Authoritative membership/status | `promotedTravellers[].membership/status` | Fading/dimming/size | Emphasis | Implemented | **NO GAP** |
| Programme hierarchy | Programme days and selected landmarks | `days[]`, `landmarks[]` | Stable programme-spine layout | Coordinates | Day territories + programme lane implemented | **NO GAP basic structure** |
| Two-row programme | Selected major landmarks | `landmarks[]` | Placement only | Row coordinates | Layout has minimum 2 rows but expands beyond two if projection forces more landmarks | **PARTIAL / visual contract risk** |
| Readiness state | Current journey assessment | `population[].status/evaluation`, cohort counts, promoted membership | Labels/count display | None | Backend computes population status; frontend displays it | **NO GAP** |
| Relevant shared dependencies | Backend-selected bounded set | `eventOverview.dependencies[]` | Placement only | Dimming | Backend selects changed or shared transport services | **PARTIAL: only transport services; no shared hotel block projection** |
| Dependency failure condition | Authoritative dependency condition | Should come from backend projection | Tone only | Pulse | Backend currently assigns dependency `health = AMBER if changed else GREEN`; cannot express a genuinely failed/red shared service | **GAP — Act Now for full V7.2 semantics** |
| Blast radius | Backend/read-model membership | `blastRadius`, promoted membership | No browser discovery | Framing/dimming | Explicit backend blast block exists | **NO browser-inference gap** |
| Programme consequence | Commitment-specific authoritative consequence | `landmarks[].health/affectedCount` | Draw only | Styling | Builder derives landmark red/amber from required participants' generic journey status/evaluation | **PARTIAL/GAP: static source does not prove commitment-specific consequence** |
| Relevant relationships | Backend relation truth | `feedsLandmarkRef`, traveller `dependencyRef`, `landmarkRef` | Geometry only | Selection | Relation endpoints originate from projection pointers | **NO GAP for topology** |
| Relationship semantic condition | Backend semantic condition | Accepted contract says backend-owned | No endpoint-based semantic inference | Pulse timing only | `model.ts` synthesizes relation health from dependency health or traveller membership, including hard-coded green cohort routes | **GAP — Act Now** |
| Progressive disclosure | Same semantic projection | Same nodes | Yes | Semantic zoom, metadata visibility | Low zoom hides type/meta; expanded mode preserves same model | **NO GAP** |
| Compact mode | Same projection | None | Yes | Viewport height/layout | Current default `clamp(320px, 40vh, 430px)` | **GAP: accepted target ≈30vh** |
| Expanded mode | Same projection | None | Yes | Viewport ≈70–80vh | `76vh` | **NO GAP** |
| Interaction/clickability | Entity identity + caseRef | Node refs, traveller `caseRef` | Selection/navigation UI | Selected node | Every node selectable; case link appears when backend supplies caseRef | **NO GAP** |
| Selection | Visible relation endpoints | Supplied projection | Immediate visible neighbourhood lookup | Dimming/focus | Generic implementation | **NO GAP** |
| Stable refresh | Projection revision + complete snapshot | `data-stable-revision`, lifecycle | Restore UI only | Camera/view/expanded/selection | Controller store survives region replacement | **NO STATIC GAP** |
| Full population stays visible | Full population + cohorts/promoted | `population`, `cohorts`, `promotedTravellers` | Dimming, not deletion | Opacity | Cohorts remain rendered during active incident instead of being hidden | **NO GAP when programme days exist** |
| Active disruption framing | Explicit blast footprint | `focus.incidentIds` from `blastRadius` | Compute bounds | Camera | Initial/Home `Active change` fits incident footprint | **NO GAP static; verify browser refresh transition** |
| Healthy full-world framing | Full bounded projection | All nodes | Compute union bounds | Camera | `layout.home` | **NO GAP** |
| Multi-day generality | Backend day list | up to 14 `days` | Responsive layout | Geometry | Fixed `DAY_W=330`; Home can shrink as low as `0.3` for wide worlds | **GAP: violates near-screen-scale/readability requirement for longer programmes** |
| Many shared dependencies | Bounded backend dependencies | max 12 | Responsive packing | Layout | Width expands based on dependency row, potentially forcing deep zoom-out | **GAP/RISK for accepted compact readability** |
| No capability-up/internal-engine copy | User-facing projection labels | Backend facts only | Plain-language formatting | None | Graph copy itself mostly user-down; page header says `state colour follows status meaning` | **GAP — remove semantic-system explanatory copy** |
| Pulse | Backend condition → frontend treatment | No pulse fields | Yes | Green normal / amber slow / red none | Implemented at 2.55s/3.7s | **NO GAP once relation semantic condition is fixed** |

### Important V7.2 backend boundary issue

R4 has correctly moved Overview selection into a backend/read-model projection. That is good architecture.

However, not every value emitted by that projection is equally authoritative in meaning.

Two places require scrutiny:

1. `dependencies[].health` is currently based almost entirely on whether transport timing changed. It does not carry a general dependency failure verdict.
2. `landmarks[].health` is inferred from whether required participants are generally disrupted/pending, rather than from a commitment-specific evaluator consequence.

Astra must **not compensate for either issue in the browser**.

If those fields do not express the production requirement, the backend projection must be corrected.

---

# 6. Exact accepted behaviours that are PURE FRONTEND

These do not belong in PostgreSQL, domain entities, provider state, or DTO liveness fields.

## Shared V5.6 / V7.2 visual ownership

- deterministic card coordinates;
- connector geometry;
- card dimensions;
- visual weighting;
- opacity/dimming;
- glow/halo;
- semantic zoom;
- metadata hiding/revealing;
- pan;
- zoom;
- Home/reset camera;
- smooth camera interpolation;
- selected node;
- immediate visible-neighbour highlight;
- clearing selection on empty canvas/Escape;
- preserving camera and selection across refresh;
- reduced-motion behaviour;
- green travelling pulse;
- amber slower travelling pulse;
- red no pulse;
- pulse phase/stagger/duration;
- compact/expanded viewport state;
- current active named view;
- visual snapshot transition animation.

## V5.6-specific frontend state

- Current/Original **tab selection**;
- Trip Overview / Disruption Path / Programme **view selection**;
- focal card's exact width, font size, ring and glow;
- contextual dimming in Disruption Path;
- programme framing;
- no camera movement merely because a node was selected.

The identity of the focal breakpoint is **not** frontend state. Only its visual treatment is.

## V7.2-specific frontend state

- whole-event vs active-change framing choice;
- compact vs expanded;
- focus-traveller camera action after explicit user action;
- selected Overview entity;
- faded appearance for an authoritative cleared member;
- hiding lower-priority card metadata at low zoom.

Cleared/unresolved membership itself is not frontend state.

---

# 7. Exact semantic data that MUST come from backend/read models

## V5.6

Backend must supply:

- entity identity/ref;
- entity kind;
- user-facing entity label/detail sourced from canonical facts;
- current semantic condition;
- assessment lifecycle/currentness;
- current/proposed authority/truth mode where relevant;
- relationship identity;
- relationship endpoints;
- relationship kind;
- relationship semantic condition when colour/pulse is meaningful;
- relationship authority;
- complete current snapshot revision;
- changed-node/edge hints if available;
- ordered causal path;
- mapping of causal path to visible graph refs;
- first operational breakpoint;
- honest unmapped causal steps;
- current service/booking facts;
- meaningful effective arrival/timing facts;
- programme commitments and their consequence/current condition;
- whole-trip viability;
- objective/trip-purpose context;
- Case status;
- immutable Original snapshot;
- absence/unavailability explicitly when truth does not exist.

The browser must not turn a missing edge state into target-node state.

The browser must not turn a disrupted traveller into a missed programme commitment.

## V7.2

Backend must supply the bounded Overview projection:

- programme day territories;
- major landmark eligibility;
- landmark identity;
- landmark current consequence/health;
- population scope;
- traveller readiness/currentness;
- cohort membership/counts;
- promotion eligibility;
- cleared/checking/unresolved/attention membership;
- meaningful shared dependency eligibility;
- shared dependency identity/type/current condition;
- authoritative changed-state information;
- dependency-to-landmark relationship truth;
- traveller-to-shared-dependency relationship truth;
- traveller-to-programme relationship truth where material;
- blast-radius membership;
- current affected/cleared/checking/unresolved counts;
- implicated programme landmarks;
- caseRef when a focused Case exists;
- projection revision;
- SETTLED vs RECONCILING assessment lifecycle;
- event/programme context.

The browser must not determine which traveller is affected by traversing graph edges.

---

# 8. Current R4 deviations from accepted designs

These are based on static source inspection. “Browser unproven” is not treated as compliant.

## Act Now — V5.6

**1. Forbidden Case/workflow node exists inside the graph.**  
`pgFactAssembler.ts` emits:

`kind: 'RECOVERY_PROPOSAL', label: 'Recovery case', semanticState: 'ACTIVE'`

That directly conflicts with frozen R2: the graph is not a workflow/planning/case-state visual. Remove this from the focused visual projection. Do not merely rename it.

**2. Meaningful TIMING node is absent.**  
`projectFocusedCaseGraph.ts` promises `TIMING` enrichment in comments but never emits one. The accepted V5.6 breakpoint can therefore collapse into a broad Journey/traveller node rather than the actual changed arrival/timing object.

**3. Current-vs-original changed timing cannot currently achieve V5.6 fidelity.**  
The service enrichment carries route/published timing inputs but not a projected effective current arrival presentation equivalent to V5.6's strong previous → current timing treatment.

**4. Trip-purpose/objective node has an explicit projection-contract gap.**  
Canonical `objectives` exist and are loaded, but `LdgNodeKind` has no objective kind. The projector correctly refuses to fake one.

**5. Missing edge state is being semantically inferred in the renderer.**  
`scene.ts` borrows target-node tone when `edge.semanticState` is absent. This contradicts `FRONTEND_SEMANTIC_CONTRACT.md`, which explicitly says components do not derive semantic truth from neighbouring nodes.

**6. Disruption Path does not actually frame the disruption path.**  
`pathView.rect` is `allRect`. It only dims other nodes. Accepted behaviour requires the path itself to be framed.

**7. Accepted `Trip Overview` is labelled `Full trip`.**  
Simple frontend correction.

**8. Programme consequence fidelity is incomplete.**  
Programme commitment nodes exist, but current R4 does not reliably provide commitment-specific assessment state for every rendered commitment. Unknown must remain unknown; Astra must not infer missed/on-track from the traveller.

## Investigate Now — V5.6 browser proof

- card readability at normal zoom;
- 8.5–10.5px auxiliary type;
- long names/details clipping;
- actual no-overlap behaviour;
- connector/card alignment;
- Programme framing quality;
- Original/Current physical behaviour;
- camera preservation through live polling;
- all-clear transition removing focal emphasis and leaving no stale disruption treatment.

## Act Now — V7.2

**9. Frontend synthesizes relationship semantic condition.**  
`overview-graph/model.ts` generates edge health from traveller membership/dependency state rather than receiving semantic condition as relationship truth. The accepted V7.2 contract explicitly assigns relationship semantic condition to the backend.

**10. Shared dependency semantics are too narrow.**  
The current backend source supports selected transport services and gives them essentially GREEN/AMBER based on `changed`. It cannot express a genuinely failed RED shared dependency and does not currently project a shared hotel block.

**11. Programme landmark impact is not proven commitment-specific.**  
`eventOverview.ts` derives RED/AMBER landmark health from required participants' generic Journey status/evaluation. That can overclaim programme consequence if a traveller is disrupted for something that does not actually prevent the commitment.

This may stay a backend deterministic derivation only if its semantic validity is proven. Otherwise project the actual commitment consequence.

**12. Population disappears from the graph when there are no programme days.**  
The cohort builder skips ordinary non-promoted population when `days.length === 0`. V7.2 explicitly requires generality for scenarios with or without programme commitments.

**13. Compact Overview is currently ~40vh, not accepted ~30vh.**  
`height: clamp(320px, 40vh, 430px)`.

**14. General programme durations can collapse readability.**  
Fixed `DAY_W = 330`, up to 14 days, combined with minimum scale `0.3`, can turn the compact Overview into exactly the giant virtual canvas shrunk to illegibility that V7.2 forbids.

**15. Large dependency sets have the same scaling risk.**  
Up to 12 dependency cards can widen the world substantially beyond the programme lane.

**16. Two-row contract is not structurally guaranteed.**  
The normal path selects four landmarks/day, which fits two rows, but forced incident landmarks may increase rows beyond two.

**17. Capability-up copy remains outside the graph.**  
The Overview page subtitle currently says:

`Managed travel readiness across the programme — state colour follows status meaning.`

“State colour follows status meaning” explains implementation grammar instead of the operator's world.

## Investigate Now — V7.2 browser proof

- compact view actual readability;
- no cards covering Day labels;
- no card/card overlap;
- no connector/card obstruction;
- active-disruption framing includes the whole incident footprint;
- full population context stays visible while incident elements are emphasized;
- Home returns to whole Event/active incident correctly;
- camera/zoom/expanded state survives polling;
- selection survives a compatible refresh;
- vanished selected nodes fail cleanly;
- 1-day, 3-day and longer programmes;
- high dependency count;
- promoted traveller overflow;
- no-programme case;
- materially different shared dependency types.

## Park for Later unless MVP requires it

**18. One active blast dependency only.**  
`EventOverview.blastRadius` has one `dependencyRef`, and `buildEventOverview()` takes the first changed selected service as `blastGroup`.

The accepted V7.2 demo does not require simultaneous independent blast centres. Do not expand this contract during convergence unless a required scenario proves the need.

---

# 9. Browser acceptance checklist — V5.6

## Semantic acceptance

- [ ] A real disrupted Case defaults to **Disruption Path**.
- [ ] The visible changed thing comes from authoritative current state.
- [ ] The causal chain exactly follows backend `focusedGraph`; browser adjacency never changes it.
- [ ] The focal card is exactly `firstBreakpoint.nodeRef`.
- [ ] A meaningful timing/arrival breakpoint is represented as that operational object, not merely a generic traveller card.
- [ ] Service state is authoritative.
- [ ] Commitment state is authoritative.
- [ ] Trip purpose/outcome is represented without inventing a new fake domain object.
- [ ] Missing semantic state remains unknown/neutral.
- [ ] No `Recovery case`, strategy, provider call, approval or workflow node appears.

## Visual acceptance

- [ ] Disruption Path actually fits the causal/disruption footprint.
- [ ] Healthy branches remain visible but quieter.
- [ ] First breakpoint is visually dominant.
- [ ] Direct consequence may be secondary; downstream red does not automatically become the focal card.
- [ ] Green dependencies pulse normally.
- [ ] Amber dependencies pulse more slowly.
- [ ] Red dependencies never pulse.
- [ ] No flashing red state.
- [ ] Current values are stronger than previous/original values.
- [ ] Dates/timezones remain legible where operationally necessary.
- [ ] Normal card typography is readable without zooming in.
- [ ] No cards overlap.
- [ ] No graph card is hidden behind controls.

## Interaction acceptance

- [ ] Exact view names are `Disruption Path`, `Trip Overview`, `Programme`.
- [ ] Trip Overview fits the broader current graph.
- [ ] Programme frames relevant programme context.
- [ ] Pan works.
- [ ] Wheel/trackpad zoom works.
- [ ] +/- work.
- [ ] Home resets only to the active canonical view.
- [ ] Selecting a node strengthens its immediate visible dependency neighbourhood.
- [ ] Selection does not move the camera.
- [ ] Escape/empty canvas resets selection.
- [ ] Semantic zoom hides secondary metadata before text becomes illegible.

## Current / Original

- [ ] Current always reflects the live authoritative graph.
- [ ] Original is the persisted immutable first truthful failing graph.
- [ ] Original does not mutate when Current changes.
- [ ] Missing Original produces honest `Original graph unavailable`.
- [ ] Current is never substituted as Original.

## Refresh acceptance

- [ ] Pan somewhere non-default.
- [ ] Zoom manually.
- [ ] Select a node.
- [ ] Let at least one polling revision arrive.
- [ ] Camera does not reset.
- [ ] Zoom does not reset.
- [ ] View does not reset.
- [ ] Compatible selection does not reset.
- [ ] Current/Original tab does not reset.
- [ ] New authoritative semantic state is nevertheless rendered.
- [ ] Pulse treatment updates from new semantic state rather than stale frontend state.

## Recovery acceptance

- [ ] After authoritative recovery/reassessment, graph becomes a genuinely HEALTHY current world.
- [ ] No focal attention card remains.
- [ ] No stale red/amber dependency remains.
- [ ] No stale red glow remains.
- [ ] Disruption Path is no longer the active canonical view.
- [ ] Trip Overview becomes canonical.
- [ ] Original remains unchanged.

## Generality acceptance

Run the same renderer/projection with at least:

- [ ] arrival/programme-readiness disruption;
- [ ] materially different connection/transport disruption.

No application-code changes between scenarios.

---

# 10. Browser acceptance checklist — V7.2

## Healthy Overview

- [ ] Whole current bounded projection fits.
- [ ] All programme territories remain visible.
- [ ] Major programme landmarks are readable.
- [ ] Meaningful shared dependencies are visible.
- [ ] Full population is represented through cohorts + promoted exceptions.
- [ ] Cohort totals + promoted travellers reconcile to authoritative population.
- [ ] Known unknown/attention state remains visible.
- [ ] Healthy edges pulse subtly.
- [ ] Healthy state is not a blank canvas.

## Active change

- [ ] Changed shared dependency is visually active.
- [ ] Entire authoritative affected set is represented.
- [ ] CHECKING travellers are promoted.
- [ ] Cleared travellers settle green and fade.
- [ ] Unresolved travellers remain visually prominent.
- [ ] Unaffected current world remains visible.
- [ ] Programme consequence exactly matches backend truth.
- [ ] No frontend timer fabricates CHECKING → settled.
- [ ] `Active change`/Home frames the entire incident footprint rather than one traveller.
- [ ] Deliberate Focus traveller may zoom tighter only after explicit user action.

## Programme hierarchy

- [ ] Continuous programme spine is visible.
- [ ] Day labels remain unobstructed.
- [ ] Compact Overview stays approximately the accepted information density.
- [ ] Normal programmes fit into two meaningful programme rows.
- [ ] Additional programme duration is handled without shrinking normal text to illegibility.
- [ ] A 1-day programme works.
- [ ] A materially longer programme works.
- [ ] No-programme scenario remains truthful rather than silently losing population.

## Shared dependencies

- [ ] Healthy shared concentration can remain visible.
- [ ] Changed dependency condition comes from backend.
- [ ] Failed dependency can render red if backend supplies failure.
- [ ] A material ROAD/ground dependency can render.
- [ ] A material hotel/stay/shared accommodation dependency can render when the projection supports it.
- [ ] Ordinary private booking plumbing remains absent.

## Interaction

- [ ] Every visible interactive card can be selected.
- [ ] Keyboard Enter/Space selection works.
- [ ] Selected card is emphasized.
- [ ] Immediate visible neighbourhood remains strong.
- [ ] Unrelated content dims.
- [ ] Selection does not move camera.
- [ ] Empty canvas resets.
- [ ] Escape resets.
- [ ] Traveller with authoritative `caseRef` exposes `Open case`.
- [ ] No case link is invented without a backend `caseRef`.

## Compact / expanded

- [ ] Compact view is readable without user zoom.
- [ ] Expanded view uses the same entity/relation identities and projection.
- [ ] Expanding does not create a second state model.
- [ ] Pan/zoom work in both modes.
- [ ] Low zoom removes secondary metadata before primary labels become unreadable.

## Refresh stability

- [ ] Manually pan.
- [ ] Manually zoom.
- [ ] Expand.
- [ ] Select a card.
- [ ] Allow poll refresh.
- [ ] Camera remains stable.
- [ ] Zoom remains stable.
- [ ] Expand state remains stable.
- [ ] Selection remains when the entity still exists.
- [ ] New backend semantic state still appears.
- [ ] Refresh never rebuilds blast radius in browser.

## Copy acceptance

No graph/page copy should expose implementation concepts such as:

- [ ] semantic state;
- [ ] state colour meaning;
- [ ] projection;
- [ ] graph engine;
- [ ] dependency evaluator;
- [ ] agent;
- [ ] tool call;
- [ ] provider adapter;
- [ ] planner round.

The operator sees travel/event language.

---

# 11. Anti-hardcoding checklist

Astra must verify all of the following before accepting either graph:

- [ ] No `Sarah`, `Jordan`, specific traveller or VIP name in generic graph logic.
- [ ] No `AI in Travel Summit` or event-name branch.
- [ ] No Batik/SQ/CX/JL or other supplier/service-specific branch.
- [ ] No Singapore/CGK/SIN/location branch.
- [ ] No keynote/headline/specific commitment branch.
- [ ] No fixture ID.
- [ ] No recording ID.
- [ ] No hardcoded route.
- [ ] No exact demo service reference.
- [ ] No `if this is Sarah disruption` equivalent disguised through IDs.
- [ ] No business semantics encoded in CSS selectors.
- [ ] No business semantics encoded in x/y coordinates.
- [ ] No fixed three-day product assumption.
- [ ] No prototype `GRAPH.states` copied into runtime.
- [ ] No prototype Current/Original values copied into runtime.
- [ ] No DOM-topology traversal used to discover causality.
- [ ] No graph traversal used to discover blast radius.
- [ ] No traveller status converted into programme consequence in browser.
- [ ] No target node condition converted into edge condition.
- [ ] No missing backend fact replaced with a plausible demo fact.
- [ ] At least two materially different scenarios use exactly the same renderer and projection contract.
- [ ] Anti-hardcoding gate remains clean.

If a needed operational concept cannot be represented by current contracts, report the contract/architecture gap.

Do not disguise it as presentation data.

---

# 12. Things Astra MUST NOT build

While converging these visuals Astra must not introduce:

**Workflow graph**  
Case/planning/execution state belongs to the Case workspace, not dependency nodes.

**Graph database**  
PostgreSQL remains runtime truth. Neither graph justifies Neo4j or similar infrastructure.

**Graph planning nodes**  
No recovery strategy, planner step, search, alternative, execution attempt or “AI thinking” node.

**Provider/tool nodes**  
Provider calls and tools are evidence/execution machinery, not trip dependencies.

**Backend pulse state**  
No `isPulsing`, `pulseSpeed`, `isLive`, animation flag or persistence field.

**Browser business inference**  
No viability, causality, blast radius, programme impact, policy, authority or provider-state deduction in JS.

**Generic traversal engine**  
The backend supplies causal/blast semantics. A visual selection-neighbour lookup is not a business traversal engine and must remain display-only.

**WS/SSE merely for animation**  
Case polling of complete snapshots is accepted. Overview already has stable polling. Do not add streaming infrastructure to make dots move.

Also do not build:

- a Current + Proposed main Case graph;
- graph history;
- an event-replay timeline;
- a new graph workflow state machine;
- a replacement ontology to make the UI easier;
- an “Entire Graph” as part of this convergence pass.

---

# 13. Current R4 implementation disposition

## Preserve

The following current choices are aligned and should not be casually rewritten:

- dedicated `eventOverview` backend projection;
- PostgreSQL-backed current snapshots;
- explicit `focusedGraph` causal mapping;
- persisted immutable Original snapshot;
- semantic adapter boundary;
- deterministic graph layouts;
- no force physics;
- generic selection;
- frontend-only pulses;
- green/amber/red pulse grammar;
- camera state persistence;
- Current/Original display-only tab state;
- compact/expanded single-model Overview;
- case routing only when backend supplies `caseRef`;
- explicit `RECONCILING` lifecycle rather than invented readiness during reassessment.

## Correct rather than redesign

Astra's graph work should be a convergence pass around the identified gaps, not another graph architecture.

The major corrections are:

1. strip workflow/case node from V5.6 visual projection;
2. give V5.6 truthful timing/current-state granularity;
3. close the objective/purpose projection gap rather than fake it;
4. stop target-node → edge-tone inference;
5. make Disruption Path actually frame its path;
6. restore exact accepted naming;
7. stop V7.2 relation-condition inference in frontend;
8. strengthen V7.2 backend dependency/programme-consequence semantics;
9. fix no-programme population behaviour;
10. restore accepted compact information density and generalized readable layout;
11. remove capability-up copy;
12. then physically browser-verify both accepted designs.

---

# 14. Source / reference inventory

## Audited R4 baseline

`integration/r4-final-acceptance`  
Audited HEAD: `795f49e6a4a4efe6adb4f5e56a60c02a58ba089f`

The audited HEAD commit was documentation-only handoff state; source beneath it was the R4 integration tree at inspection time.

## V5.6 accepted design

Accepted V5.6 design commit:

`53fc33fe45c7f29eec2f6154363835d159ff72a9`

Files:

- `docs/design/live-dependency-graph/README.md`
- `docs/design/live-dependency-graph/prototype/live-dependency-graph-v5.6.html`

## Frontend semantic contract

Accepted reviewed frontend semantic state:

`fe09c525528df67a0a5fb5df4811bb7d5feddd77`

Files inspected/currently relevant:

- `docs/FRONTEND_SEMANTIC_CONTRACT.md`
- `docs/work/WIT_FRONTEND_INTEGRATION_HANDOFF.md`
- `src/ui/semantics/model.ts`
- `src/ui/semantics/adapter.ts`
- `src/ui/semantics/grammar.ts`

The older WIT handoff's statement that Event Overview was unresolved is historical and has been superseded by later accepted V7.2 truth.

## R2 Case graph freeze

- `docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md`

Binding reconciliations include:

- Case graph is current-world causal map;
- no workflow graph;
- CHECKING derives from `PENDING_REASSESSMENT`;
- pulse is frontend-only;
- causal focus supplied by backend;
- Original is persisted immutable first truthful graph;
- no Current/Proposed overlay;
- named views;
- no graph DB/traversal/SSE requirement.

## Current V5.6 production frontend inspected

- `src/ui/graph/index.ts`
- `src/ui/graph/scene.ts`
- `src/ui/graph/layout.ts`
- `src/ui/graph/cards.ts`
- `src/ui/graph/styles.ts`
- `src/ui/graph/interactions.ts`
- `src/ui/graph/views.ts`
- `src/ui/graph/edges.ts`
- `src/ui/graph/geometry.ts`
- `src/ui/screens/product-recovery-case.ts`
- `src/ui/originalCurrent.ts`
- `src/ui/casePolling.ts`
- `src/ui/shellRuntime.ts`

## Current V5.6 backend/read-model sources inspected

- `src/contracts/v2/product/readModels.ts`
- `src/app/target/readmodels/types.ts`
- `src/app/target/readmodels/pgFactAssembler.ts`
- `src/app/target/readmodels/projectRecoveryCase.ts`
- `src/app/target/readmodels/projectFocusedGraph.ts`
- `src/app/target/readmodels/projectFocusedCaseGraph.ts`
- `src/app/target/readmodels/liveDependencyGraph.ts`
- `src/app/target/readmodels/changeAwareness.ts`
- `src/persistence/postgres/commands/caseGraphSnapshotCommands.ts`
- persisted Original snapshot contract: migration `0127`

## V7.2 accepted design

Accepted commit:

`563320e4e9ef7c2ea7dc4f53f0d07b3045dcfeb1`

Accepted files:

- `docs/design/event-overview-graph/README.md`
- `docs/design/event-overview-graph/prototype/event-overview-v7.2.html`

The version in R4 docs matches the accepted visual contract.

## Current V7.2 production frontend inspected

- `src/ui/overview-graph/model.ts`
- `src/ui/overview-graph/layout.ts`
- `src/ui/overview-graph/controller.ts`
- `src/ui/overview-graph/index.ts`
- `src/ui/overview-graph/cards.ts`
- `src/ui/overview-graph/styles.ts`
- `src/ui/screens/product-operator-overview.ts`
- `src/app/target/adapters/operatorOverviewAdapter.ts`
- `src/ui/shellRuntime.ts`
- `src/ui/polling.ts`

## Current V7.2 backend/read-model sources inspected

- `src/contracts/v2/product/readModels.ts`
- `src/app/target/readmodels/types.ts`
- `src/app/target/readmodels/eventOverview.ts`
- `src/app/target/readmodels/projectOperatorOverview.ts`
- `src/app/target/readmodels/pgFactAssembler.ts`

Current `EventOverview` production schema carries:

- `days`
- `landmarks`
- `dependencies`
- `cohorts`
- `promotedTravellers`
- `promotedOverflow`
- `blastRadius`

Current source facts come from authoritative PostgreSQL programme, participation, journey, transport-service and assessment state rather than prototype data.

---

# 15. Astra handoff rule

Astra should use the accepted V5.6/V7.2 artifacts as **visual reference**, R2 + frontend semantic contracts as the **semantic ownership rules**, and current R4 PostgreSQL/read-model structures as **runtime reality**.

When they disagree:

1. backend/schema/runtime determines what exists now;
2. accepted design/R2 determines intended product behaviour;
3. frontend may project but may not fabricate missing semantics;
4. any missing semantic concept is a named contract/architecture gap;
5. prototype scenario objects are never copied into production.

The next test after correcting the static gaps is not another design pass.

It is the two browser acceptance suites above against real R4 projections, followed by a materially different second scenario through the same engine and renderer.

**GRAPH CONTRACT READY FOR ASTRA**
