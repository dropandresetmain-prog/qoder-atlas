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
- `ChangeAwareness` contains projectionRevision, changedVisibleRefs,
  currentSemanticState, optional previousSemanticState/changedAt/changeSource.
  Previous/current states describe the projection, not each node's history.
- No separate affected refs, changed edge refs, added/removed sets or focusPath.
  AFFECTED comes only from a supplied semantic state, not traversal.
- Exact membership in changedVisibleRefs is a node marker. Absence is **not marked**,
  not proof of unchanged. CHANGED is also an independent supplied semantic state.
- Producers use counts (case: actions + subjects; overview: items; cohort: people;
  traveller: constant 1). Equal revision does not guarantee unchanged content.
  Case changed refs are action IDs, potentially absent from graph nodes. Preserve
  these metadata values; do not manufacture an animation/diff clock.

### Current vs proposed

Node `authority` supplies the distinction independently of kind, semantic health,
change marker and focus. A proposed HEALTHY node must still have a brass dashed
boundary and proposal label; it cannot look committed. M9 allows proposal-related
semantic state on a current record; preserve both dimensions without promotion.

M9 edges carry no authority, so every edge truth mode is **unspecified**. A PROPOSED
edge state or the PROPOSED_CHANGE kind is not promoted to proposed truth: the same
no-promotion rule as nodes applies (a relationship *about* a proposal can itself be an
authoritative record). Kind and state stay visible as their own label and badge.
Do not infer authority from endpoints. Unspecified authority keeps a dotted grey
connector plus the separately supplied state badge. Solid-green/solid-vermilion
**authoritative** and dashed-brass **proposed** edges cannot honestly be produced
from this M9 DTO (FIG-2).

IncidentProgrammeView has separate currentProgrammeState/proposedProgrammeState
strings; the bilateral preview has current/proposed windows and participant verdicts
with `mutatesAuthoritativeState: false`. Neither supplies paired graph identities,
retired edges or generic graph-overlay lifecycle. No counterfactual engine is added.

## Presentation model and visual grammar

- Node: ref, entityKind (accepted graph category), semanticState, indicator,
  truthMode, changeState, focusRole, label/secondaryLabel and iconKind.
- Edge: snapshot-local renderKey, sourceRef/targetRef, relationshipKind,
  optional semanticState, indicator, truthMode, changeState, focusRole and label.
- Graph: scope, unchanged source change metadata, nodes, edges.
- Focus: primary / causal / context, from explicit selections only. Edge focus
  is explicitly supplied by snapshot index; no path-finding or impact inference.
  `primary` may come from operator selection. `causal` asserts causality, so a product
  surface may populate it only from a backend-supplied path or a backend-scoped causal
  projection, never from adjacency (FIG-5b). The Lab populates it from fixtures only.
- Node change: marked / not-marked, from `changedVisibleRefs` only. Edge change: always
  not-supplied (no changed-edge set, FIG-2). A CHANGED semantic state never sets the
  change marker on nodes or edges; AFFECTED stays a separate state.
- Indicator: label + glyph + tone; graph states retain their raw accepted values.
- No evaluation/processing dimension exists yet. It must not be emulated with
  `semanticState`, `changeState` or tone (FIG-7).

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
the M6 triggers enqueue for exactly the assessments that read a changed input. No read
model exposes it: `loadRecoveryCaseFacts` collapses every non-CURRENT status into
AssessmentTone UNKNOWN plus a free-text uncertainty string, and the overview/cohort
producers drop it. The frontend therefore cannot show "under evaluation" without
inventing it, and must not. See FIG-7.

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

No backend change is made in this lane. The original FIG-1..6 were all triaged Park for
Later before the live-demo choreography was frozen. The independent review re-triaged
each against that sequence (baseline -> disruption -> scope identified -> under
evaluation -> clear or settle failed -> escalate -> open case), asking: *can the UI
be driven through it without frontend invention if this stays unresolved?*

"Act Now (prerequisite)" means it blocks live graph wiring and is owned by the read-model
producer, not by this frontend lane. The static Lab can continue without any of them.

| ID / triage | Evidence and smallest change | Blocks |
|---|---|---|
| FIG-1 — Act Now (prerequisite) | `LdgEdge` has no id; the case producer's `case_subjects` query has no ORDER BY, so edge order (and every `renderKey`/`causalEdgeIndices`) can change between reads with no content change, causing false delete/recreate. Add a producer-owned `id` per edge, unique within the graph and stable across revisions for the same relation. Parallel edges keep distinct ids. | Any edge transition across revisions |
| FIG-2 — Act Now (prerequisite) | No edge authority and no changed-edge set, so every edge is dotted grey "authority not supplied". The frozen graph needs solid green/vermilion authoritative edges and dashed brass proposed edges. Add `authority: AUTHORITATIVE \| PROPOSED` to `LdgEdge` (mirroring nodes) and `changedEdgeIds` to `ChangeAwareness`, keyed by FIG-1. | Authoritative edge styling; edge change marking |
| FIG-3 — Act Now (prerequisite) | `projectionRevision` is a count (case: actions + subjects; overview: items; cohort: travellers; traveller: 1). Re-evaluation changes content without changing counts, so polled snapshots cannot be ordered or discarded as stale. Overview `changedVisibleRefs` lists every case on every read, so every node is permanently marked; case `changedVisibleRefs` are action ids that never match nodes. Define a monotonic per-scope revision from real sources, and define `changedVisibleRefs` as refs whose presented fields differ from the previous revision. | Revision-driven updates and settle transitions |
| FIG-4 — Act Now (prerequisite) | Overview node `ref` is the bare case id, and only cases produce overview nodes. A participant has no node before escalation and a different ref after it, so baseline -> escalate cannot keep one entity. Case graph uses `<SUBJECT_KIND>:<id>`; cohort refs are caller strings. Key dashboard and incident nodes by the canonical subject ref used by the case graph, and carry case linkage as a separate optional field (for example `caseRef`) instead of as identity. That field is also the escalation marker. | Baseline -> escalation continuity; open-case selection |
| FIG-5a — Act Now (merged into FIG-7) | "Affected dependency scope identified" needs a backend candidate set. The M6 invalidation enqueue is that set (the subjects whose assessments read the changed input), so FIG-7 supplies it. Do not derive it from graph topology. | Under-evaluation scope |
| FIG-5b — Investigate Now | No backend focus/causal path. If the FOCUSED_CASE producer emits only the causal chain (frozen Sarah geometry), scope is the evidence and no `focusPath` is needed; if it emits a wider graph, add `focusPathEdgeIds` (FIG-1 ids). Until decided, product surfaces must not populate `causal`. | Focused causal emphasis |
| FIG-5c — Investigate Now | No paired current/proposed overlay. Needed only if the counterfactual is drawn on the graph rather than the existing mutation-free preview surface. If so, add `replacesEdgeId` pairing on proposed edges (requires FIG-1/FIG-2). | Counterfactual graph overlay |
| FIG-6 — Act Now (prerequisite) | Producer fidelity, not additive. Overview nodes are FAILED only for DISRUPTED, otherwise HEALTHY, so UNKNOWN, AT_RISK and RECOVERING render green. Case subject nodes all take the aggregate (FAILED if any subject fails, else AFFECTED), so a PASS subject can never clear to HEALTHY and an unassessed subject reads AFFECTED. Use each subject's own CURRENT verdict; non-CURRENT stays UNKNOWN plus FIG-7. DTO unchanged. | Clear-to-healthy / settle-to-failed truth |
| FIG-7 — Act Now (prerequisite, new) | Assessment lifecycle is not in any read model (see *Evaluation lifecycle vs semantic truth*). Add an optional, non-domain `evaluation` on `LdgNode` (and `OperatorOverviewItem`) that passes through `AssessmentViewStatus` for that node's subject. The backend decides whether `semanticState` keeps the last CURRENT verdict or reads UNKNOWN while PENDING_REASSESSMENT. The frontend then adds an independent `evaluationState` presentation dimension (`not-supplied` when absent) and never changes `semanticState` to animate. No push channel exists (plain GET handlers; the demo event returns 202 and the worker reassesses asynchronously), so progress is visible only through polled revisions (FIG-3). | "Under evaluation" treatment |
| FIG-8 — Investigate Now (new) | `LdgSemanticState` mixes PROPOSED (truth), CHANGED (change) and ACTIVE (processing) with health. Once FIG-2/3/7 exist, decide per value whether node producers may still emit it; the frontend will not reinterpret it. | Long-term dimension hygiene |
| FIG-9 — Investigate Now (new) | Traveller-facing copy (`ui/copy.ts` `VIABILITY_LABEL`, `product-traveller-trip.ts`, `app/presentation.ts`) renders UNKNOWN as "Still checking", which asserts a lifecycle. Operator surfaces are fixed; decide traveller wording once FIG-7 can say whether checking is actually happening. | Traveller surface in the live demo |

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

Browser verification was run against the served page at `/contract-lab`. A DOM/accessibility
snapshot confirmed all seven sections (A states, B change, C current/proposed, D focus,
E relationships, F composed, plus the invalid panel), every enum value, and both refusal
strings render. The sample selector was exercised: five samples visible by default, one
visible when a single sample is chosen, five restored on "All samples". The console was
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
