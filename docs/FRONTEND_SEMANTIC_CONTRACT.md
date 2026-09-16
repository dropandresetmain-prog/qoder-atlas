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

Edges can explicitly signal proposal via PROPOSED state or PROPOSED_CHANGE kind;
otherwise their truth mode is **unspecified**, even with HEALTHY/RECOVERED state.
Do not infer authority from endpoints. Unspecified authority keeps a dotted grey
connector plus the separately supplied state badge. Solid-green/solid-vermilion
**authoritative** edge examples cannot honestly be produced from this M9 DTO.

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
- Focus: primary / causal / context, from explicit UI selections only. Edge focus
  is explicitly supplied by snapshot index; no path-finding or impact inference.
- Node change: marked / not-marked. Edge change: marked only for supplied CHANGED,
  otherwise not-supplied. AFFECTED stays a separate state, so affected+changed works.
- Indicator: label + glyph + tone; graph states retain their raw accepted values.

`ui/semantics/adapter.ts` is the single mapping boundary, including exhaustive typed
records for accepted unions. Unknown future enum values throw visibly with
`UNMAPPED SEMANTIC STATE`; schema-invalid graphs fail before rendering. No neutral
fallback for an unrecognized authoritative value. Existing M9 tone helpers delegate
to this boundary rather than maintaining another state palette.

`ui/semantics/grammar.ts` uses the existing theme's green/brass/vermilion/grey/ink
variables. Borders/connector patterns express truth; textual markers express change;
typographic weight expresses focus. State badges and icons preserve health without
large coloured fills. No perpetual effects or artificial activity.

## Frontend Integration Contract Gaps

No backend change is made. These are bounded follow-up requirements, not permission
to redesign the read model. All permit the static Lab to continue.

| ID / triage | Missing contract and minimal additive follow-up | Needed before |
|---|---|---|
| FIG-1 — Park for Later | `LdgEdge` lacks stable ID and tuple uniqueness. Add producer-owned stable `id`, with uniqueness scoped to projection; keep parallel edges distinct. | Edge reconciliation/transitions |
| FIG-2 — Park for Later | `LdgEdge` lacks authority and change identity. Add explicit authority and `changedEdgeRefs` keyed to FIG-1, only from backend evidence. | Authoritative edge styling/change animation |
| FIG-3 — Park for Later | `ChangeAwareness`/assemblers lack monotonic content revision and guaranteed visible changed refs. Define producer revision/delta semantics; optionally separate action refs from node refs. | Revision-driven live updates |
| FIG-4 — Park for Later | `LdgNode.ref` lacks cross-scope stability/uniqueness guarantee. Document/enforce projection scope + canonical identity, or add canonical subject reference separately. | Cross-view selection/transitions |
| FIG-5 — Park for Later | Graph has no paired overlay/current mapping, affected-ref set or backend focus path. Add only fields required by the next scoped graph use case. Existing preview API remains separate. | Runtime comparison/blast-radius focus |
| FIG-6 — Park for Later | Pg overview maps non-DISRUPTED nodes to HEALTHY; case subject nodes reuse aggregate verdict; sparse categories/relations lack per-entity detail. Preserve DTO here; correct producer fidelity and test UNKNOWN/mixed subjects before live graph use. | Live graph wiring, not this fixture contract |

Act Now: replace silent M9 graph/assessment/viability mapping defaults and test failure
(closed — `operatorOverviewAdapter.ts` now delegates to the single boundary).
Investigate Now: `HEALTHY` and `RECOVERED` both map to tone `ok` and glyph `check`, so
the two are distinguishable only by their text label. Because "recovered" is the state
the product thesis turns on, a shared encoding with ordinary "healthy" is a weakness
worth resolving. This is a visual-grammar / design-authority question, not a backend
contract gap, so it is deliberately not a FIG entry; the never-colour-only rule still
holds since the labels differ. Adding a distinct glyph means extending the frozen
`SemanticIndicator['glyph']` set, which belongs to DESIGN.md authority.
Ignore / Accept Risk: schema-supported static fixtures
are not evidence that every kind/state is populated by a PostgreSQL producer.

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
