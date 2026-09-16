# Frontend semantic contract — accepted M9

Base: `c45a9289b7f7ff730cdce97ced6124b1a9332bf8`. This is a frontend contract,
not live graph integration or an expansion of the ontology. Documentation stays
beside DESIGN.md following the existing top-level docs convention.

## Three ownership layers

1. **Authoritative semantic truth:** application/read-model fields. The backend
   owns assessment, viability, impact, policy, authority, execution and recovery.
2. **Presentation semantics:** a pure adapter preserves those values and selects
   labels, icon categories and visual tones. Explicit UI focus is not causal proof.
3. **Visual styling:** shared grammar consumes presentation dimensions. Components
   never derive semantic truth from times, labels, references or neighbouring nodes.

`accepted read model -> ui/semantics/adapter.ts -> model.ts -> grammar.ts -> components.ts`

No graph fetch, PostgreSQL connection, SQLite extension, mutation, animation,
revision transition, auto-layout or M10 dependency is introduced.

## Authoritative source inventory

Paths below are under `src/` unless stated otherwise.

| Source | Contract |
|---|---|
| `contracts/v2/product/readModels.ts:7-90` | Operational, viability, assessment and graph schemas; actual graph export is `LiveDependencyGraph`, not `LiveDependencyGraphReadModel` |
| Same file, `92-144` | Overview and incident/programme projections |
| Same file, `146-282` | Connection progression, action execution, case and traveller projections |
| Same file, `284-309` | Application error vocabulary (not graph health) |
| `app/target/readmodels/types.ts:11-45` | Product facts and projection inputs |
| `app/target/readmodels/liveDependencyGraph.ts:12-37` | Preserves supplied states/refs; defaults omitted fact authority to AUTHORITATIVE; drops dangling edges |
| `app/target/readmodels/changeAwareness.ts:7-28` | Deduplicates/sorts changed refs; passes revision through; no diff engine |
| `app/target/readmodels/pgFactAssembler.ts:331-535` | Actual producer identities, count-based revisions and partial graph population |
| `app/target/programmeTimeSwapPreview.ts:18-67,85-106,198-229` | Separate current/proposed window/evaluation previews; zero authoritative mutation |

### State families — do not merge into one status

| Authoritative family | Complete accepted vocabulary |
|---|---|
| `LdgSemanticState` | HEALTHY, CHANGED, AFFECTED, FAILED, PROPOSED, ACTIVE, UNKNOWN, RECOVERED |
| `RemainderViability` | VIABLE, AT_RISK, NOT_VIABLE, UNKNOWN |
| `AssessmentTone` | PASS, FAIL, UNKNOWN |
| `ProductOperationalStatus` | READY, AT_RISK, DISRUPTED, RECOVERING, UNKNOWN |
| Node authority | AUTHORITATIVE, PROPOSED |
| Graph scope | DASHBOARD, INCIDENT_PROGRAMME, FOCUSED_CASE |
| `ConnectionProgression` | HEALTHY, CONNECTION_SAFE, CONNECTION_AT_RISK, CONNECTION_IMPOSSIBLE, RECOVERY_PLANNING, AWAITING_APPROVAL, EXECUTING_COORDINATED_RECOVERY, CHECKING_RESULTS, RECOVERED, STILL_UNRESOLVED |
| `RecoveryActionExecutionState` | PROPOSED, AUTHORIZED, REJECTED, SUPERSEDED, EXECUTING, COMPLETED, FAILED, PENDING, RECONCILING, OUTCOME_UNKNOWN |
| `RecoveryCaseView.status` | OPEN, PLANNING, AWAITING_AUTHORITY, EXECUTING, RESOLVED, CLOSED, CANCELLED, SUPERSEDED |
| `TravellerTripView.amIOkay` | YES, NO, UNKNOWN |

Case authority/execution/reconciliation strings, strategy viability/status, action
domain/capability/authority/approval/observation and uncertainty are **open strings**.
They are not frontend enums and must not be parsed into business conclusions.
Application errors are LOADING, READ_UNAVAILABLE, PLANNER_UNAVAILABLE,
PROVIDER_INFO_UNAVAILABLE, NO_VIABLE_RECOVERY, UNKNOWN_VIABILITY, APPROVAL_PENDING,
APPROVAL_REJECTED, EXECUTION_FAILED, OUTCOME_UNKNOWN, RECONCILING,
ACTION_SUCCEEDED_TRIP_INVALID, OBJECTIVE_DISPOSITION_FORBIDDEN,
GRANT_SCOPE_INSUFFICIENT, RESOLUTION_DENIED. They retain `mutatesState: false`;
this milestone does not reinterpret them as node health.

The shared adapter maps graph, viability, assessment, operational and connection
families. Action/case lifecycle and API-error rendering remain existing surfaces,
not new graph states. RECOVERED on one node is not a whole-trip resolution claim.

### Node categories, not ontology types

`LdgNodeKind` is exactly DISRUPTION, SERVICE_BOOKING, TRAVELLER, TIMING,
TRANSFER_STAY, PROGRAMME_COMMITMENT, RECOVERY_PROPOSAL.

M9 does **not** expose separate graph kinds for Trip, TransportLeg, Stay,
Engagement or TripObjective. The target ontology separately defines Trip,
Journey/JourneyItem, Traveller, TransportService, Reservation/ReservationLine,
ProgrammeItem/Participation and Objective (`domain/v2/shared/identity.ts:25-87`).
The Lab uses the seven accepted categories, never parses refs to guess ontology
subtypes and never maps every booking to an aircraft icon. An objective can be
shown as a separate supplied viability indicator, not an invented graph node kind.
`RECOVERY_PROPOSAL` kind is not proof of proposed authority: the case assembler
emits an ACTIVE, AUTHORITATIVE recovery-case node with that kind.

### Relationships

All five kinds use ordered `fromRef`/`toRef`. Preserve endpoints, never reverse
an edge to improve a story. No relationship kind itself proves damage.

| Kind | Reading from source to target | Evidence/limits |
|---|---|---|
| AFFECTED_BY | affected subject -> source change/case | Actual M9 producers: traveller -> incident; case subject -> case |
| RELIES_ON | dependent -> prerequisite | Schema-declared; no accepted src producer establishes typed endpoint constraints |
| MUST_HAPPEN_BEFORE | predecessor -> successor | Schema-declared; frontend must not evaluate scheduling |
| PARTICIPATES_IN | participant -> commitment/activity | Schema-declared; not a direct dump of canonical participation FKs |
| PROPOSED_CHANGE | proposal/change -> related target | Proposal class declared; endpoint typing/producer guarantee absent |

All allow an optional `LdgSemanticState`, including CHANGED/AFFECTED/FAILED/
PROPOSED/UNKNOWN. Missing state is **not supplied**, not HEALTHY and not a backend
UNKNOWN verdict. Actual case/cohort AFFECTED_BY edges omit state. No distinct
VIOLATED/BROKEN enum exists; FAILED can display as failed/broken only when supplied.
There is no per-kind violation capability flag, edge authority, edge ID, edge
change set or enforced endpoint-type/cardinality rule in the graph schema.

F11's registered executable domain dependencies are distinct from these display
relations. Rendering arrows does not perform propagation or blast-radius analysis.

### Identity, revisions and change metadata

- Node identity is the opaque supplied `ref`; labels are never identity. Schema
  validates only nonempty strings, not uniqueness or global/scope stability.
- Case graph uses `case:<id>` and `<subject_kind>:<subject_id>`; overview uses bare
  case IDs; cohort uses incident/traveller refs. Cross-projection aliases are not
  a guaranteed canonical key. The adapter refuses duplicate node refs/dangling
  endpoints as ambiguous presentation input, without repairing backend state.
- Edges have no stable identity. Source + kind + target is **not guaranteed unique**;
  parallel duplicates are schema-valid and remain distinct. `renderKey` is an
  explicitly snapshot-local array-position key, never persistence/transition ID.
  **As of `lane/wit-live-readmodel-contract` (FIG-1, resolved):** `LdgEdge.id` is now
  required, producer-owned and unique within a graph (schema-enforced); `renderKey`
  is that id. This paragraph otherwise still describes the M9 baseline this lane
  started from.
- `ChangeAwareness` contains projectionRevision, changedVisibleRefs,
  currentSemanticState, optional previousSemanticState/changedAt/changeSource.
  Previous/current states describe the projection, not each node's history.
  **FIG-2 resolved:** `changedEdgeIds` is now also present, keyed by FIG-1 ids.
- No separate affected refs, changed edge refs, added/removed sets or focusPath.
  AFFECTED comes only from a supplied semantic state, not traversal.
- Exact membership in changedVisibleRefs is a node marker. Absence is **not marked**,
  not proof of unchanged. CHANGED is also an independent supplied semantic state.
- Producers use counts (case: actions + subjects; overview: items; cohort: people;
  traveller: constant 1). Equal revision does not guarantee unchanged content.
  Case changed refs are action IDs, potentially absent from graph nodes. Preserve
  these metadata values; do not manufacture an animation/diff clock.
  **FIG-3 resolved** for case/overview (see the gap table): real per-node source
  revisions, `changedVisibleRefs` now names exactly what changed relative to a
  supplied `sinceRevision`. Cohort/traveller producers are unchanged (still counts;
  they are pure/caller-fed, not Postgres-backed, so no DB revision source exists
  for them — a known limit, not closed by this lane).

### Current vs proposed

Node `authority` supplies the distinction independently of kind, semantic health,
change marker and focus. A proposed HEALTHY node must still have a brass dashed
boundary and proposal label; it cannot look committed. M9 allows proposal-related
semantic state on a current record; preserve both dimensions without promotion.

M9 edges carried no authority, so every edge truth mode was **unspecified**. **As of
`lane/wit-live-readmodel-contract` (FIG-2, resolved):** `LdgEdge.authority` mirrors
node authority, backend-supplied only, so solid-green/solid-vermilion authoritative
and dashed-brass proposed edges are now honestly producible. A PROPOSED edge state
or the PROPOSED_CHANGE kind is still not promoted to proposed truth: the same
no-promotion rule as nodes applies (a relationship *about* a proposal can itself be an
authoritative record). Kind and state stay visible as their own label and badge.
Do not infer authority from endpoints — it is read only from the supplied field.

IncidentProgrammeView has separate currentProgrammeState/proposedProgrammeState
strings; the bilateral preview has current/proposed windows and participant verdicts
with `mutatesAuthoritativeState: false`. Neither supplies paired graph identities,
retired edges or generic graph-overlay lifecycle. No counterfactual engine is added.

## Presentation model and visual grammar

- Node: ref, entityKind (accepted graph category), semanticState, indicator,
  truthMode, changeState, focusRole, label/secondaryLabel, iconKind, and (FIG-7,
  resolved) `evaluationState` plus optional `caseRef` (FIG-4, resolved).
- Edge: renderKey (FIG-1: the producer's `LdgEdge.id`, resolved), sourceRef/targetRef,
  relationshipKind, optional semanticState, indicator, truthMode (FIG-2, resolved),
  changeState (FIG-2, resolved), focusRole and label.
- Graph: scope, unchanged source change metadata, nodes, edges.
- Focus: primary / causal / context, from explicit selections only. Edge focus
  is explicitly supplied by snapshot index; no path-finding or impact inference.
  `primary` may come from operator selection. `causal` asserts causality, so a product
  surface may populate it only from a backend-supplied path or a backend-scoped causal
  projection, never from adjacency (FIG-5b, still open). The Lab populates it from
  fixtures only.
- Node change: marked / not-marked, from `changedVisibleRefs` only. Edge change
  (FIG-2, resolved): marked / not-marked, from `changedEdgeIds` only — no longer
  always not-supplied. A CHANGED semantic state never sets the change marker on
  nodes or edges; AFFECTED stays a separate state.
- Indicator: label + glyph + tone; graph states retain their raw accepted values.
- Evaluation lifecycle (FIG-7, resolved): an independent `evaluationState`
  presentation dimension, exhaustively mapped from `AssessmentViewStatus`
  (`not-supplied` when the node has none). It is never emulated with
  `semanticState`, `changeState` or tone, and never changes them.

### LdgSemanticState is a mixed vocabulary

Three of its eight values overlap other dimensions: PROPOSED (truth), CHANGED (change)
and ACTIVE (processing; the case assembler emits ACTIVE for the case node). The adapter
preserves them as supplied semantic states and never derives truth, change or lifecycle
from them. Producers must not use ACTIVE, AFFECTED or UNKNOWN to signal "being evaluated"
(FIG-8).

### Evaluation lifecycle vs semantic truth (live demo)

The live demo needs potentially affected entities to read as *under evaluation*, then
clear or settle. The engine already has that truth: `currentAssessmentView`
(`persistence/postgres/world/pgAssessments.ts`) returns CURRENT, STALE,
PENDING_REASSESSMENT, UNAVAILABLE or NONE, backed by `scheduled_reassessments` work that
the M6 triggers enqueue for exactly the assessments that read a changed input.

**As of `lane/wit-live-readmodel-contract` (FIG-7, resolved):** `AssessmentViewStatus`
moved to `contracts/v2/product/readModels.ts` and `LdgNode`/`OperatorOverviewItem` gained
an optional `evaluation` field passed through from that same lookup — `loadRecoveryCaseFacts`
no longer collapses it away. `semanticState` still comes only from the subject's own CURRENT
verdict (FIG-6); `evaluation` is a wholly separate field the frontend renders as an
independent dimension, never a `semanticState`/`changeState`/tone stand-in. The
`AssessmentTone`/uncertainty-string collapse for non-CURRENT subjects is unchanged and
stays useful for the free-text detail; `evaluation` is what makes the lifecycle itself
(as opposed to the last-known verdict) observable. Cohort producers remain unchanged
(pure/caller-fed, not Postgres-backed — no `currentAssessmentView` to read from).

`ui/semantics/adapter.ts` is the single mapping boundary, including exhaustive typed
records for accepted unions. Unknown future enum values throw visibly with
`UNMAPPED SEMANTIC STATE`; schema-invalid graphs fail before rendering. No neutral
fallback for an unrecognized authoritative value. Existing M9 operator surfaces
(overview, incident programme) take tone **and** label from this boundary, and map tone
to theme dot/queue classes through exhaustive tone-keyed tables (`TONE_DOT_CLASS`,
overview `QUEUE_GLYPH`). They no longer use traveller copy that asserts a lifecycle
("Still checking", "May be affected") and no longer re-collapse ACTIVE/UNKNOWN into
brass or RECOVERING into a confirmed check.

`ui/semantics/grammar.ts` uses the existing theme's green/brass/vermilion/grey/ink
variables. Borders/connector patterns express truth; textual markers express change;
typographic weight expresses focus. State badges and icons preserve health without
large coloured fills. No perpetual effects or artificial activity.

## Frontend Integration Contract Gaps

FIG-1/2/3/4/6/7 are **resolved** (`lane/wit-live-readmodel-contract`, backend read-model
producer fixes plus the single frontend boundary follow-through). FIG-5b/5c/8/9 are
untouched, left for a future lane. The independent review re-triaged each against the
live-demo choreography (baseline -> disruption -> scope identified -> under evaluation ->
clear or settle failed -> escalate -> open case), asking: *can the UI be driven through it
without frontend invention if this stays unresolved?* — that question is now answered for
every "Act Now (prerequisite)" row below.

| ID / triage | Evidence and smallest change | Blocks |
|---|---|---|
| FIG-1 — **Resolved** | `LdgEdge.id` is now required, producer-owned and unique within a graph (`contracts/v2/product/readModels.ts` — a `superRefine` on `LiveDependencyGraphSchema` rejects duplicates loudly). `case_subjects` is queried with a deterministic `ORDER BY subject_kind, subject_id, role` (`pgFactAssembler.ts`). Ids are derived from the canonical relation (kind + endpoints), never array position. Adapter `renderKey` is now `edge.id`. Evidence: `test/ui-semantic-contract.test.ts` ("edge renderKey is the producer-owned stable id", "duplicate edge ids are refused loudly"); `postgres-integration/witLiveReadModelContract.pgtest.ts` asserts edge ids identical across every re-evaluation/settlement step. | Any edge transition across revisions |
| FIG-2 — **Resolved** | `LdgEdge.authority` mirrors node authority (required, backend-supplied). `ChangeAwareness.changedEdgeIds` is keyed by FIG-1 ids. The adapter's edge `truthMode`/`changeState` now come from these real fields, never inferred from edge kind or `semanticState`. Evidence: `test/ui-semantic-contract.test.ts` ("edge truth and change come only from authority/changedEdgeIds..."). | Authoritative edge styling; edge change marking |
| FIG-3 — **Resolved** | `projectionRevision` is now `MAX` of real per-node revision sources: each subject's and the case's own `EVALUATION_LIFECYCLE` `scope_generations` family (migrations 0121/0122), read via `last_advanced_xact` (`pg_current_xact_id()`, a per-database globally unique strictly-increasing xid8 — safe to `MAX`, unlike the small per-scope `generation` counter, which can tie and mask a real change; an initial sum-based design was tried and rejected for exactly that reason, caught by the proof test). `changedVisibleRefs` is exactly the refs whose own source exceeds a caller-supplied `sinceRevision` (omitted = first read = honestly empty, never "everything"). `changedEdgeIds` stays `[]` for the current AFFECTED_BY edges, which carry no independent state. `?sinceRevision=<n>` is wired through `targetHttpHandlers.ts`. Evidence: `postgres-integration/witLiveReadModelContract.pgtest.ts` (full 6-step proof: revision strictly increases at injection and at each settlement step; two quiet reads are identical). | Revision-driven updates and settle transitions |
| FIG-4 — **Resolved** (dashboard/overview scope only) | The overview producer now keys dashboard nodes by the canonical `<SUBJECT_KIND>:<id>` ref the case graph already uses (`loadOperatorOverviewFacts`), with `caseRef` as a separate optional linkage field. **Known limit, not closed by this lane:** the overview producer only lists items with an existing `recovery_cases` row, so no read model can render a subject's node before it is attached to a case — "no node before escalation, same ref after" could not be exercised end-to-end in the proof test; see the FIG-4 note in `docs/work/ACTIVE_TASK.md`. Cohort/incident-programme refs remain a separate identity space (caller-string `travellerRef`/`journeyRef`), unchanged and still explicitly accepted as a different scope. | Baseline -> escalation continuity; open-case selection |
| FIG-5a — Act Now (merged into FIG-7) | "Affected dependency scope identified" needs a backend candidate set. The M6 invalidation enqueue is that set (the subjects whose assessments read the changed input), so FIG-7 supplies it. Do not derive it from graph topology. | Under-evaluation scope |
| FIG-5b — Investigate Now | No backend focus/causal path. If the FOCUSED_CASE producer emits only the causal chain (frozen Sarah geometry), scope is the evidence and no `focusPath` is needed; if it emits a wider graph, add `focusPathEdgeIds` (FIG-1 ids). Until decided, product surfaces must not populate `causal`. | Focused causal emphasis |
| FIG-5c — Investigate Now | No paired current/proposed overlay. Needed only if the counterfactual is drawn on the graph rather than the existing mutation-free preview surface. If so, add `replacesEdgeId` pairing on proposed edges (requires FIG-1/FIG-2). | Counterfactual graph overlay |
| FIG-6 — **Resolved** | Case-subject and dashboard nodes now take each subject's own CURRENT-assessment verdict / operational status (`pgFactAssembler.ts` `TONE_TO_STATE`/`STATUS_TO_STATE` tables), not the case's aggregate verdict or a DISRUPTED-or-HEALTHY collapse. A PASS subject reads HEALTHY even when the case overall fails; AT_RISK/RECOVERING/UNKNOWN no longer render green. DTO unchanged, as specified. Evidence: `postgres-integration/witLiveReadModelContract.pgtest.ts` (the slack-connection subject clears to HEALTHY while the tight one settles FAILED, same case, same read). | Clear-to-healthy / settle-to-failed truth |
| FIG-7 — **Resolved** | `AssessmentViewStatus` moved to `contracts/v2/product/readModels.ts` (re-exported from `pgAssessments.ts` for existing consumers), so the frontend boundary can present it without importing persistence. `LdgNode`/`OperatorOverviewItem` gained an optional `evaluation` field, passed through from the same `currentAssessmentView` lookup the case assembler already performs — never fabricated for non-assessed nodes. The adapter gained an independent `evaluationState` dimension (`presentEvaluationState`, exhaustively mapped, `not-supplied` when absent) that never touches `semanticState`/`changeState`/tone; rendered as a `data-evaluation` attribute plus a plain-text `.sem-evaluation` marker only (amber/motion styling stays a design-lane decision). Contract Lab section F covers it. Progress is visible only through polled revisions (FIG-3) — no push channel was added, matching scope. | "Under evaluation" treatment |
| FIG-8 — Investigate Now (new) | `LdgSemanticState` mixes PROPOSED (truth), CHANGED (change) and ACTIVE (processing) with health. FIG-2/3/7 now exist; still Investigate Now — deciding per-value whether node producers may still emit it is a separate design pass, out of this lane's "smallest additive change" scope. | Long-term dimension hygiene |
| FIG-9 — Investigate Now (new) | Traveller-facing copy (`ui/copy.ts` `VIABILITY_LABEL`, `product-traveller-trip.ts`, `app/presentation.ts`) renders UNKNOWN as "Still checking", which asserts a lifecycle. Operator surfaces are fixed; FIG-7 can now say whether checking is actually happening, but traveller wording itself is unchanged — a copy decision for a future lane. | Traveller surface in the live demo |

Other triage:

- Act Now (closed in this lane): silent M9 mapping defaults (original lane); edge truth/change
  promotion from edge state/kind; operator surfaces bypassing the boundary for viability
  labels; tone re-collapse in the overview queue glyph and incident commitment dot.
- Park for Later: `HEALTHY` and `RECOVERED` share tone `ok` and glyph `check`. They remain
  distinct in the model (`semanticState`, label, `data-state`), so design can separate
  them by changing only `GRAPH_STATES`/`SemanticIndicator['glyph']` under DESIGN.md
  authority, with no read-model change.
- Park for Later: `projectLiveDependencyGraph` defaults an omitted fact authority to
  AUTHORITATIVE. Every current producer sets it explicitly; make it required before any
  proposed-node producer exists.
- Park for Later: `PresentationGraph.change` passes `previous/currentSemanticState` through
  raw. No surface renders it; map through `presentGraphState` if one ever does.
- Park for Later: Lab lacks panels for proposed+marked, recovered+marked and UNKNOWN vs
  omitted edge state. Unit tests now cover these combinations.
- Ignore / Accept Risk: focus refs or indices absent from a snapshot are ignored. This
  under-claims emphasis and never asserts state.
- Ignore / Accept Risk: the strict schema rejects additive backend fields until the shared
  schema is updated, which is the intended lockstep.
- Ignore / Accept Risk: legacy v1 `presentationState.ts` buckets are outside the M9 boundary.
- Ignore / Accept Risk: schema-supported static fixtures are not evidence that every
  kind/state is populated by a PostgreSQL producer.

## Contract Lab and verification

Development-only entry: `node --experimental-strip-types scripts/contract-lab-preview.ts --serve [--port N]`.
Local route: `/contract-lab` (loopback preview server only, default port 8790).
Static generation: `node --experimental-strip-types scripts/contract-lab-preview.ts`;
output `data/ui-preview/contract-lab.html`.
No route is added to application/target HTTP servers and no legacy shell scripts
or API action handlers are loaded. The build compiles this explicit dev entry but
does not import it into runtime. Named composition fixtures live outside `src/` in
`fixtures/ui/semantic-contract.json`; all verdicts are supplied test data.

The Lab covers all graph kinds/states, viability/assessment/operational/progression
families, independent truth/change/focus, all five relationship kinds and all optional
edge states. It includes booking-valid/trip-invalid and supplied connection-stage
compositions, an empty snapshot and a visible invalid-contract panel. Switching
fixtures selects existing static markup only; it does not evaluate or mutate a trip.
**As of `lane/wit-live-readmodel-contract`:** a new section F ("Evaluation lifecycle")
covers all five `AssessmentViewStatus` values plus the absent-field `not-supplied` case
(`presentEvaluationState`); Composed examples moved to section G. See
`test/ui-semantic-contract.test.ts` for the current coverage assertions.

Browser verification below predates that section (historical evidence, kept as-is). A
DOM/accessibility snapshot confirmed the seven sections that existed then (A states, B
change, C current/proposed, D focus, E relationships, F composed, plus the invalid panel),
every enum value, and both refusal strings render. The sample selector was exercised: five
samples visible by default, one visible when a single sample is chosen, five restored on
"All samples". The console was
clean and there was no horizontal overflow at a narrow 530x617 viewport. A computed-style
audit confirmed the four dimensions stay independently encoded rather than collapsing into
one status: state drives the border-inline-start tone colour and glyph, truth drives border
style (solid current / dashed proposed / dotted unspecified connector), focus drives
box-shadow ring (primary), 3px top border (causal) or recessed surface (context), and change
drives brass colour plus underline plus weight on the marker text. All sixteen connectors
render with their arrow. A pixel screenshot could not be captured because the in-app browser
surface remained hidden, so the visual claim rests on computed styles and structure, not on
a rendered image.

Evidence and exact commands are maintained in `work/ACTIVE_TASK.md`. Next tests must
exercise actual producer-to-adapter fidelity, UNKNOWN/mixed subjects, stable IDs,
parallel-edge changes and mutation-free current/proposed graphs before live wiring.
