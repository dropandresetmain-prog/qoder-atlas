# R2 — Case Decision Surface + Focused Graph Contract (FROZEN)

Status: **R2-C0 CONTRACT FREEZE**. This document is the authoritative R2 product
and focused-graph contract. It reconciles the simplified V5.6 product decisions
into the living SSOT and SUPERSEDES the older statements listed in §9. Written by
the PRIMARY; write lanes fan out only after this freeze is committed and pushed.

Branch: `feat/r2-case-decision-surface-cloud`
Base SHA (accepted R1): `dc73aa9a51abf80a6e3b65abacf6bc5929223638`

R1 is ACCEPTED and is not reopened. If R2 exposes a direct R1 defect, classify it
and fix only the smallest concrete defect; do not rewrite R1.

---

## 1. Product goal

R2 delivers two connected surfaces:

- **A. Rich Case decision workspace** — the operator page that answers, in order:
  what changed, why the trip fails, what is affected, what NORTHSTAR investigated,
  what alternatives were materially considered/rejected and why they lost, what
  viable option remains, what NORTHSTAR recommends and why, what the proposed
  change affects, what needs approval, execution/reconciliation truth, and whether
  the trip is currently recovered.
- **B. Focused V5.6 Case Graph** — ONE explanatory component inside that
  workspace, not the whole page.

---

## 2. Focused Case Graph — frozen product decision

The focused Case Graph is **a milestone-updated CURRENT-WORLD causal map**.

It is NOT: a mirror of every backend state; a workflow engine; a planning trace;
an authority trace; an execution trace; a provider debugger; an event-sourced
graph-history system.

Its three jobs: (1) causal explanation, (2) current trip state, (3) blast-radius
understanding. Within seconds the operator must read: what changed → what that
affects → where the trip first stops working → what still works → whether
NORTHSTAR is currently checking/recovering → what the current authoritative trip
looks like now.

### 2.1 Belongs on the graph (minimum needed for the current Case story)

traveller; current flight/service; meaningful arrival/timing state; ground
transfer where causally relevant; stay/hotel where relevant; programme
commitments; trip purpose/objective context where useful; dependency
relationships; current changed path; current blast radius; first operational
breakpoint; healthy surrounding branches; generic CHECKING/evaluation
presentation. Do NOT add every one blindly — use the minimum the Case needs.

### 2.2 Does NOT belong on the graph

planning tool calls; provider API calls; rejected recovery alternatives; every
RecoveryStrategy; authority decisions; approval lifecycle; execution attempts;
workflow state; recovery planner rounds. Those belong in Case cards / options /
Activity, never as graph nodes.

---

## 3. Graph visual states — frozen

There is NO graph-specific workflow state machine. The graph needs only three
effective visual states:

1. **HEALTHY** — the current trip works.
2. **CHECKING** — an authoritative input changed and the relevant downstream
   assessment is unsettled/pending.
3. **DISRUPTED / SETTLED** — evaluation settled and the causal break is known.

**Recovered is simply the new HEALTHY current world** after authoritative recovery
+ reassessment. Do NOT add a separate RECOVERED graph architecture.

### 3.1 CHECKING is presentation, not a new verdict

CHECKING is the presentation of the EXISTING assessment lifecycle
(`AssessmentViewStatus.PENDING_REASSESSMENT`, already carried on `LdgNode.evaluation`
and mapped to `EvaluationState.'pending-reassessment'` → "Under evaluation" by
`src/ui/semantics/adapter.ts`). It is an INDEPENDENT dimension and must never
rewrite `semanticState`. Example truth: last-known component `semanticState: HEALTHY`
+ `evaluation: PENDING_REASSESSMENT` → renderer MAY show CHECKING without touching
semanticState. No new authoritative semantic verdict is introduced.

---

## 4. Graph update model — frozen

**No WebSockets. No SSE for the Case Graph.**

Poll the complete authoritative Case snapshot every few seconds → compare with the
currently rendered snapshot → animate visible changes in the frontend. Intermediate
backend revisions MAY be skipped; that is acceptable. The graph communicates
CURRENT operational understanding, not database event replay.

The existing `ChangeAwareness` fields (`changeCursor`, `changedVisibleRefs`,
`changedEdgeIds`) MAY be used as **hints** for what to emphasise/animate. They must
NOT be turned into a graph event log. The client still applies every complete
snapshot it receives (the at-least-once rule in `FRONTEND_SEMANTIC_CONTRACT.md`
FIG-3 is unchanged); skipped intermediate revisions remain safe because each
snapshot is complete authoritative truth, and a reload reconstructs current truth.

---

## 5. Pulse / motion — frozen

V5.6 pulses are **PURE FRONTEND ANIMATION**. No backend liveness state. Do NOT add
`isPulsing`, `pulseSpeed`, `isLive`, or equivalents — to the DTO, the read model,
or any persistence.

Renderer rules (visual condition treatments, not backend facts):

- green → normal pulse
- amber → slower pulse
- red → no pulse

This decision SUPERSEDES older frontend prose implying all motion must correspond
directly to backend revision events. **Revision-change animation and ambient
dependency pulse are two separate concepts** and must not be mixed:

1. **Ambient dependency pulse** — frontend-only, derived from the node/edge
   semantic condition (tone). Never a backend field.
2. **Snapshot-change animation** — driven by comparison between successive complete
   snapshots / the `ChangeAwareness` hints.

No fake "AI thinking" motion inside the graph.

---

## 6. Causal focus — frozen

`RecoveryCaseView.causalPath` already carries the ordered authoritative causal path
(evaluator-typed `CausalPathStep[]`; the first entry is the first operational
breakpoint). **The frontend must NOT traverse graph topology to infer causality.**

Production direction: ordered authoritative `causalPath` → mapped onto visible
stable graph refs / edge ids → first operational breakpoint gets V5.6 focal
emphasis.

### 6.1 Minimum additive contract — `focusedGraph` on `RecoveryCaseView`

The smallest additive presentation/read-model change is ONE optional block on
`RecoveryCaseViewSchema`. **No `focalNodeRef`** (redundant — the first breakpoint is
`causalNodeRefs[0]`/`firstBreakpoint`). No LDG-wide changes.

```
FocusedGraphView = {
  causalNodeRefs: string[]        // ordered subset of ldg node refs on the causal chain
  causalEdgeIds:  string[]        // subset of ldg edge ids on the causal chain
  firstBreakpoint?: {             // causalPath[0] mapped to a visible ref, when mappable
    nodeRef: string
    label: string                 // human operational wording
    dimension: string
    reasonCode: string
  }
  unmappedCausalSteps: {          // causal steps with NO visible graph object
    subjectRef: string
    dimension: string
    reasonCode: string
    reason: string                // why it could not be mapped, e.g. "no visible node for subject"
  }[]
}
```

Rules:

- `causalNodeRefs`/`causalEdgeIds` are computed **in the backend projector**
  (`projectRecoveryCase`) by intersecting the ordered `causalPath` subject/related
  refs with the produced `ldg` visible node refs and the edge ids connecting them.
  The frontend receives the mapping; it never searches topology.
- **Honest gaps:** if a causal step's subject has no visible graph node (today's
  focused case graph is sparse — it carries case/disruption/subject nodes, not yet
  every service/programme node), that step is reported in `unmappedCausalSteps`,
  never silently dropped and never guessed. This is the explicit representation of
  a causal explanation that cannot map to a visual object.
- The block is **optional**: a case with an empty causal path carries no
  `focusedGraph` (never fabricated).
- `causalEdgeIds` are the producer-owned stable `LdgEdge.id` values (FIG-1), never
  array positions.

The frontend semantic adapter (`src/ui/semantics/adapter.ts`) already accepts
`PresentationFocus { primaryRefs, causalRefs, causalEdgeIndices }` from explicit
selection only. R2 feeds `causalRefs` from `focusedGraph.causalNodeRefs` and maps
`causalEdgeIds` → the snapshot indices of those edge ids (a lookup, not a
traversal). FIG-5b is thereby resolved for the focused case surface: `causal` focus
is populated from a backend-supplied path, exactly as the contract requires.

### 6.2 Human state wording

Backend semantic truth stays generic: HEALTHY / CHANGED / AFFECTED / FAILED /
UNKNOWN / etc. V5.6 wants human operational wording (REBOOKED, LATE, CONFIRMED,
MISSED, UNMET). Do NOT create a second giant business-state machine.

**Frozen approach:** the existing presentation `SemanticIndicator.label`
(`src/ui/semantics/adapter.ts` GRAPH_STATES, and the closed-vocab label maps in
`projectPlanningEvidence`/`projectCaseAttention`) already provides
presentation-safe human wording keyed off the semantic state. R2 reuses that. A
dedicated `stateLabel` field is added ONLY if a concrete product need appears that
`indicator.label` cannot express; until then it is NOT added (do not create fields
prematurely). Where a human label is added it follows the frozen shape
`semanticState: FAILED` + `label: "Missed"` — the semantic state controls
truth/colour; the label controls operator copy.

---

## 7. Trip purpose / programme context — frozen

**No new canonical domain object.** The ontology already expresses trip purpose
via `objectives` (migration `0072_objectives.sql`: owner TRIP/JOURNEY/
COORDINATION_GROUP/PROGRAMME, `success_predicate_kind` ARRIVAL_BY/ATTEND/
COMPLETE_ITEMS/BOUND_SPEND/STATEMENT) and programme commitment via
`programme_items` + `participations`. Use those.

If a focused presentation node must be DERIVED for display (e.g. a "trip purpose"
card projected from an objective), that is acceptable provided: it is clearly
presentation/read-model derived; it does not determine hard viability; and
deterministic evaluation remains authoritative. If the ontology truly cannot
express a required concept, report an **architecture gap** — do not hardcode around it.

**Programme context** comes from the traveller's end-to-end Journey. Project only
what helps explain the Case: relevant programme/event context; the focal
commitment; immediate neighbouring items for chronology where useful; other
commitments materially affected by current journey state. Do NOT show unrelated
programme items for density.

---

## 8. Current vs proposed, Original/Current, planning/execution UX — frozen

### 8.1 Current vs proposed

The focused Case Graph remains **CURRENT AUTHORITATIVE WORLD**. Do NOT build a
current+proposed overlay into the main Disruption Path. Recovery options belong
below/alongside the graph (in the Case workspace). A programme recovery needing a
multi-person impact preview uses the existing Programme/proposal context
(`programmeTimeSwapPreview.ts`, mutation-free), NOT the focused current-world graph.

### 8.2 Original / Current

R2 needs at most ORIGINAL ↔ CURRENT. Original = one immutable focused graph
snapshot captured at disruption / Case-creation time. Current = always regenerated
from authoritative state. No intermediate graph history. No arbitrary timeline
scrubber. No event-sourced graph store.

Before adding persistence, inspect whether Original can be reconstructed truthfully
from existing immutable Case/signal/assessment evidence (the linked `change_signals`
cause, the case-open basis assessment, decision-time `planningEvidence.asOf`
baseline). Prefer reuse. Only if truthful reconstruction is impossible, add the
SMALLEST bounded immutable snapshot mechanism. Any new persistence shape is
PRIMARY-owned (schema/migration decision); a subagent may propose but not
independently change shared schema.

### 8.3 Planning UX

When NORTHSTAR is planning, the graph stays current authoritative truth. The
surrounding Case page must make it VISIBLY OBVIOUS that NORTHSTAR is working
(strong loading/working treatment AROUND the workspace) — NOT fake planning nodes
inside the graph. When recovery options become available, show a clear affordance
directing the operator to the recovery section. Options appear only when persisted
planning evidence / strategy truth exists; rejected alternatives come from
`RecoveryPlanningAttempt`; never fabricate intermediate "thinking" steps.

### 8.4 Execution UX

During execution: show progress elsewhere on the Case page; when an authoritative
component actually changes, update the graph; relevant downstream dependencies may
return to CHECKING; reassessment eventually settles them. Do not wait for complete
recovery to show truthful intermediate authoritative state.

### 8.5 Multi-person behaviour

The focused graph remains primarily the focal traveller's Case. A compact
affected-people representation is acceptable when the same CURRENT disruption
genuinely affects multiple people. Detailed multi-person consequences of a PROPOSED
programme recovery belong in Programme/proposal context, not the focused graph.

---

## 9. Superseded / reconciled statements

These older statements are explicitly resolved by this freeze. They must no longer
be allowed to make an agent add backend pulse/liveness state or a current/proposed
main-graph overlay.

1. `docs/design/live-dependency-graph/README.md` §1 "Motion = liveness. A moving
   pulse means a dependency is currently functioning and carrying live state" and
   §2 "liveness / pulse state" in the shared state model — **SUPERSEDED.** Pulse is
   pure frontend animation derived from semantic condition; there is no backend
   liveness field. (Amended in place with an R2 note.)
2. `docs/work/WIT_DEMO_VISUAL_AND_PRODUCT_CONTRACT.md` "Revision-driven motion …
   No decorative perpetual pulsing." — **SUPERSEDED for ambient pulse.** Ambient
   pulse is frontend-only and does not require revision events; revision-driven
   transition animation remains valid and separate.
3. `docs/work/WIT_FRONTEND_INTEGRATION_HANDOFF.md` item 2 "Liveness vs
   revision-driven motion … needs its own explicit presentation dimension" —
   **RESOLVED.** No new backend dimension; ambient pulse is frontend-only, derived
   from tone; snapshot-change animation is separate.
4. `docs/DESIGN.md` "perpetual pulsing … the Live Dependency Graph uses continuous
   subtle pulse as its liveness channel" — **CLARIFIED.** The pulse is a frontend
   animation treatment for HEALTHY/condition, not a backend liveness channel.
5. `docs/FRONTEND_SEMANTIC_CONTRACT.md` RECOVERED as a node `semanticState` —
   **CLARIFIED.** RECOVERED remains a valid node-level semanticState; at the GRAPH
   level a fully recovered case reads as HEALTHY. No separate RECOVERED graph
   architecture. The "Park for Later" HEALTHY/RECOVERED tone-sharing note stands at
   node level only.
6. `docs/work/WIT_DEMO_VISUAL_AND_PRODUCT_CONTRACT.md` §3.4 counterfactual preview
   and `docs/work/POST_C5_DEMO_BACKEND_COMPLETION_PLAN.md` current/proposed overlay
   — **CLARIFIED.** Those are separate mutation-free preview surfaces, NOT the main
   focused Case Graph, which stays current-world only.
7. FIG-5b ("No backend focus/causal path … product surfaces must not populate
   `causal`") — **RESOLVED for the focused case surface** by §6.1: the backend now
   supplies `focusedGraph.causalNodeRefs`/`causalEdgeIds`, so `causal` focus is
   populated from a backend-supplied path, never adjacency.

Backend state changes still drive snapshot transitions; ambient dependency pulse is
renderer-only; there is no backend liveness field.

---

## 10. Frozen V5.6 interaction contract

Keep: deterministic left-to-right graph composition (NO force layout, NO physics);
weighted visual emphasis; first operational breakpoint focal card; healthy
surrounding context visible; programme context compressed; pan; zoom; home/reset;
named views (Trip Overview, Disruption Path, Programme where useful); node
selection highlighting the immediate neighbourhood. No raw ontology explorer. No
browser business inference. Semantic zoom beyond the minimum useful renderer
behaviour may be deferred.

The V5.6 prototype uses manually-placed CSS positions and a hardcoded scenario; a
production renderer must compute a deterministic left-to-right layout from the
read-model graph and must contain NO scenario tokens (Sarah/Jordan/AI in Travel
Summit/Batik/Singapore/CGK/SIN/keynote/headline/fixture ids/recording ids/routes).

---

## 11. HTTP / server boundary

Inspect the current Case HTTP surface (`src/app/target/targetHttpHandlers.ts`,
`src/server/targetHttp.ts`). R2 may add/read only what is necessary for the Case
workspace and focused graph. Do NOT build R3 orchestration in R2.

**Carry-forward seam (documented, not silently rerouted):** `POST
/api/v2/cases/:id/strategies` routes to the OLD `proposeRecoveryStrategies`
(`src/app/target/recoveryPlanning.ts`), not the R1 `RecoveryPlanningCoordinator`
(which the C4 progression pass invokes). R2 must NOT silently route user-visible
recovery decisions through stale planner logic. For R2: identify and document the
seam. If the Case UI needs "start/retry planning", use the current accepted
coordinator ONLY if that is a small, clearly-owned correction; otherwise mark it an
**R3 Act Now dependency** and do not expand into R3 provider/runtime boot
composition.

---

## 12. Anti-hardcoding

No generic code branch on: Sarah, Jordan, AI in Travel Summit, Batik, Singapore,
CGK, SIN, keynote, headline, fixture ids, recording ids, specific routes. Demo
facts belong in fixtures/data. At least two materially different Case graphs
(arrival-readiness/programme AND connection/transport) must use the SAME projection
contract, semantic adapter, and renderer. `npm run gate:anti-hardcoding` must stay
clean.

---

## 13. Out of scope for R2

Event Overview redesign (the current Overview is protected and must not regress:
full population, queue/case navigation, event context, current truthful statuses).
Final semantic Activity Feed (R2 may show durable planning/decision evidence
directly on the Case page; the later observability milestone unifies Case timeline /
Activity journal / Overview feed). LangGraph. WebSockets/SSE for the graph. Backend
pulse/liveness persistence. Graph workflow state. Provider/tool-call/authority/
execution/rejected-option graph nodes. Current/proposed main-graph overlay. Generic
graph traversal engine. Graph database. Event-sourced graph history. Arbitrary
historical scrubber. Whole-event graph. B2 external consequential execution. R3
full runtime orchestration changes.

---

## 14. Lane ownership (write lanes fan out only after C0 push)

- **LANE A** — focused backend projection (`src/app/target/readmodels/**`,
  `src/contracts/v2/product/readModels.ts` focusedGraph block). Owns the projector +
  causal mapping + two-case generality.
- **LANE B** — V5.6 renderer (`src/ui/graph/**` new; consumes the semantic adapter).
  Owns deterministic layout, cards/edges, pulse rules, pan/zoom/views, focal card.
- **LANE C** — rich Case workspace (`src/ui/screens/product-recovery-case.ts` and
  supporting `src/ui/**`). Owns the decision-workspace sections over
  `RecoveryCaseView`.
- **LANE D** — Original/Current + polling (`src/ui/polling.ts` case-scoped refresh;
  Original snapshot/reconstruction). PRIMARY owns any schema/migration decision.
- **LANE V** — verification (`test/r2-*.test.ts`, `postgres-integration/r2*.pgtest.ts`).

PRIMARY retains: shared contracts, schema decisions, architecture, the Case/graph
projection contract, cross-lane integration, conflict resolution, final acceptance.
Shared-contract changes after this freeze require PRIMARY approval.

---

## 15. Cloud truth boundary

Cloud MAY author PG queries/migrations/tests and typecheck DB code. Cloud MUST NOT
claim a migration applied, a PG test passed, or transaction behaviour proven unless
PostgreSQL actually ran. No SQLite substitute, no fake DB. Cloud has NO PostgreSQL
and NO browser guarantee here, so physical/visual acceptance is DEFERRED to local.
Pure/read-model-shaped proofs, typecheck, lint, anti-hardcoding and test-boundary
gates run in Cloud. Terminal status is
`R2 CLOUD IMPLEMENTATION COMPLETE — REQUIRES LOCAL INTEGRATION ACCEPTANCE` unless
real PG AND browser acceptance actually executed.
