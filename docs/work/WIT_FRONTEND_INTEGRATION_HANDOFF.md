# WiT frontend integration handoff

Packaging branch: `integration/wit-frontend-handoff`.

Its only purpose is to hand the accepted WiT frontend/design work to the main
refactor/integration lane. It adds **no runtime functionality**, no live wiring
and no new product screens. The main lane consumes this branch; this branch does
not merge itself to main.

## Provenance

| What | Branch | Exact SHA |
| --- | --- | --- |
| Frontend Semantic Contract — accepted final state | `review/wit-frontend-semantic-contract-opus` | `fe09c525528df67a0a5fb5df4811bb7d5feddd77` |
| Frontend Semantic Contract — lane milestone (superseded) | `lane/wit-frontend-semantic-contract` | `20b9b61c34f3f2d526dbe4e143aba6c8304adc9b` |
| Live Dependency Graph v5.6 — accepted design | `design/live-dependency-graph-v5-6` | `53fc33fe45c7f29eec2f6154363835d159ff72a9` |
| Underlying application base | `milestone-m9-product-integration` | `c45a928` |

**Read this before quoting a semantic-contract SHA.** The lane tip
`20b9b61` does **not** contain the independent review's corrections. The
correction commit `bf66455` ("stop promoting edge state into truth/change; route
operator surfaces through the boundary") and the review verdict `fe09c52` are
linear descendants of `20b9b61` on the review branch, and `20b9b61` is their
merge-base. The accepted final frontend state is therefore `fe09c52`, and that
is what this branch starts from. Review verdict: **PASS WITH TARGETED FIXES**.
Both source branches were clean and in sync with `origin` at integration time.

Ancestry note: the v5.6 design commit was authored on the M10 line, but it only
adds two new documentation files, so it was cherry-picked onto the M9-based
frontend state (`-x`, no conflict, content byte-identical to `53fc33f`). No M10
commit and no other historical branch was merged.

## INTEGRATED / ACCEPTED

### 1. Frontend semantic contract (production code)

The one-way boundary is:

`authoritative backend read model` → `frontend semantic adapter` →
`normalized presentation model` → `shared visual grammar` → `UI components`

- `src/ui/semantics/model.ts` — presentation model keeping four dimensions
  orthogonal: `semanticState`, `truthMode`, `changeState`, `focusRole`. They are
  never collapsed into one status.
- `src/ui/semantics/adapter.ts` — the single canonical mapping boundary. Every
  map is an exhaustive `Record` over the real enum; an unmapped value throws
  rather than defaulting. Schema-invalid input, duplicate node refs and dangling
  edge endpoints are refused loudly. Edge `renderKey` is snapshot-local
  position and is never presented as stable identity.
- `src/ui/semantics/grammar.ts` — central tokens/CSS. Each dimension is encoded
  independently via data attributes; state is never colour-only.
- `src/ui/semantics/components.ts` — components consume presentation objects,
  not raw domain objects. Hostile label text is escaped, never emitted as markup.
- `src/app/target/adapters/operatorOverviewAdapter.ts` — accepted cleanup:
  delegates to the single boundary instead of keeping its own silent-default
  palette; viability labels come from `presentViability`.
- `src/ui/screens/product-incident-programme.ts`, `src/ui/theme.ts` — accepted
  review fixes so no surface re-collapses tones downstream of the boundary.

### 2. Contract Lab (development-only)

- `src/ui/screens/contract-lab.ts`, `contract-lab-theme.ts`,
  `scripts/contract-lab-preview.ts` — renders every discovered presentation
  state: entity states, change semantics, current vs proposed, focus hierarchy,
  every real relationship kind/state, plus composed mini examples.
- `fixtures/ui/semantic-contract.json` — demo facts live only here, outside
  `src/`, which is the anti-hardcoding gate's excluded tier.
- Static render: `node --experimental-strip-types scripts/contract-lab-preview.ts`.
  Add `--serve` for `http://127.0.0.1:8790/contract-lab`. No database, no
  provider calls, no live read model.

### 3. Tests owned by the semantic lane

- `test/ui-semantic-contract.test.ts`
- `test/m9-product-surfaces.test.ts`

### 4. Documentation

- `docs/FRONTEND_SEMANTIC_CONTRACT.md` — authoritative/presentation/styling
  layer split, node and edge identity findings, and the Frontend Integration
  Contract Gaps FIG-1..FIG-9 with the smallest additive backend change per gap.
- `docs/work/WIT_DEMO_VISUAL_AND_PRODUCT_CONTRACT.md` — frozen WiT demo visual
  and product contract (carried from the lane).

### 5. Accepted graph visual reference (design, not product code)

- `docs/design/live-dependency-graph/README.md`
- `docs/design/live-dependency-graph/prototype/live-dependency-graph-v5.6.html`

What is accepted is the **visual/interaction language** and the documented
production direction:

`authoritative graph/read model` → `frontend semantic contract` →
`normalized presentation state` → `generic renderer`

The prototype's mock data is **not authoritative**. Persona, carrier, route,
timing and status facts inside that HTML are illustration only. The file is
self-contained: it imports nothing from `src/` and fetches nothing.

## NOT YET DONE

None of the following disappeared. None of them are implied by the existence of
the semantic layer.

### 1. Event Overview visual design — UNRESOLVED / REDESIGN REQUIRED

The first visual prototype did not meet the desired quality and was **not**
approved. It is deliberately absent from this repository and must not be turned
into product code, nor have its layout or data model frozen.

The broad product hypothesis is still under design: calm event-level overview,
disruption focus, affected cohort/reconciliation, settled outcome, Sarah
escalation. **No final Overview visual or layout is frozen.** Do not build
backend specifically around the rejected prototype.

### 2. Runtime UI wiring — not done

The semantic adapter has not been wired to live PostgreSQL/read-model updates.
No polling, no SSE, no projection-revision consumption, no presenter controls.

### 3. Event Overview backend/data integration — not done

The final design must be approved first, then mapped to authoritative backend
fields.

### 4. Focused Sarah v5.6 production renderer — design accepted, build not done

Production implementation and live-state wiring are outstanding.

### 5. Current vs proposed recovery UI — not wired

The semantic concepts exist and are under contract (`truthMode`
current/proposed/unspecified, dashed proposed treatment). The final production
case-preview experience is not wired.

### 6. Demo choreography implementation — not wired

The sequence is known conceptually: baseline → controlled flight disruption →
real backend processing → affected cohort → reconciliation/settling → Sarah
escalation → focused case → recovery → observation → resolved. Exact production
wiring is not implemented in this frontend handoff.

### 7. Full whole-event Live Dependency Graph — stretch

Not implemented, not on the core submission critical path.

### 8. Wider UI/product-language redesign — still required

The current operator/product UI still has weak hierarchy, block-heavy
composition and internal/backend language. A dedicated product UI/language pass
is outstanding. **Do not classify this as completed merely because the semantic
layer exists.**

## Visual decisions already made (design direction, not backend enums)

These are recorded as direction for the next design/implementation pass. They
introduce **no** canonical enums, and nothing in this branch encodes them.

- v5.6's visual energy/liveness is liked and wanted.
- Pulse is allowed and desired where it communicates live activity. Do not
  mechanically enforce the older `docs/DESIGN.md` anti-pulse clause against the
  accepted graph direction (that clause now carries an explicit exception).
- Amber is being explored as reconciliation / active uncertainty presentation.
- Red/vermilion means genuine failure / operator attention.
- Green means confirmed healthy/cleared.
- Proposed/counterfactual state must be distinguished **structurally**, not by
  amber hue alone.
- Temporary reconciliation presentation must stay distinct from authoritative
  semantic health.
- Visual transitions may stagger the presentation of one authoritative snapshot
  for clarity, but must never fabricate intermediate backend facts.

## Semantic/backend integrity rules to preserve

1. Every meaningful production visual state must trace to the correct
   presentation object and to an authoritative backend source.
2. The frontend must **not** calculate viability, blast radius, dependency
   failure, policy, authority, readiness-window validity or causal truth.
3. `changedVisibleRefs` (and any equivalent changed set) is a transition hint,
   not the sole source of truth. Today it is not even that: see FIG-3 — overview
   lists every case on every read and case refs are action ids that never match
   nodes.
4. Production UI applies **complete authoritative snapshots** and compares
   presented values to decide real visual transitions.
5. Focus/causal presentation must not be inferred from topology unless the
   approved contract explicitly supplies that meaning (FIG-5b). Product surfaces
   must not populate `focusRole: 'causal'` until then.

Live graph wiring stays blocked on the backend prerequisites recorded in
`docs/FRONTEND_SEMANTIC_CONTRACT.md`: FIG-1 (edge id), FIG-2 (edge authority +
changed edge ids), FIG-3 (monotonic revision), FIG-4 (subject-keyed node refs),
FIG-6 (producer fidelity), FIG-7 (assessment lifecycle).

## Conflicts between the semantic contract and the v5.6 design

Recorded, not resolved. Each needs an explicit decision before the v5.6
production renderer is built; none of them was decided during this
consolidation.

1. **Amber/brass meaning.** The frozen WiT contract uses brass for
   "proposed / changed / waiting / needs eyes". v5.6 narrows amber to "changed or
   degraded but still functioning" and explicitly excludes approval-pending and
   generic uncertainty. The current direction additionally explores amber for
   reconciliation / active uncertainty. Three different narrowings of one hue;
   the shipped grammar keeps proposed structurally distinct (dashed) but shares
   the `watch` tone.
2. **Liveness vs revision-driven motion — RESOLVED by R2 (2026-09-19, see
   `docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md` §5/§9).** No new backend
   presentation dimension is added. Ambient pulse is PURE FRONTEND animation
   derived from the semantic condition (tone): green normal / amber slower / red
   none. Snapshot-change animation is a separate concept driven by successive
   complete snapshots / `ChangeAwareness` hints. The v5.6 continuous heartbeat is
   allowed as frontend animation and is NOT a backend liveness claim. The WiT
   contract's revision-driven-motion prose is superseded for ambient pulse only.
3. **Focal card selection.** v5.6 makes the focal object the *first operational
   breakpoint*, which is a causal judgement. The contract and the review both
   forbid inferring that from topology; it requires FIG-5b.
4. **Status wording.** v5.6 wants travel-specific wording (`REBOOKED`, `LATE`,
   `MISSED`, `UNMET`). Current labels derive from `LdgSemanticState` plus
   `presentViability`, a mixed vocabulary (FIG-8), and review fix R2 forbids
   asserting lifecycle wording the read model never supplies. Per-item travel
   state must come from the backend, not from the adapter.
5. **Prototype guards are not production rules.** The prototype asserts
   invariants such as "red dependencies never pulse". Those are prototype
   guards; production liveness must come from the presentation model.

## Verification run on this branch

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `node --test test/ui-semantic-contract.test.ts test/m9-product-surfaces.test.ts` | 25 pass / 0 fail, exit 0 |
| `npm run gate:anti-hardcoding` | `VERDICT: CLEAN` — 352 TS files (strict 211 / app 122 / provider 16 / demo 3 / excluded 0) |
| Contract Lab render | exit 0 — 146296 bytes, 5 composed samples |
| v5.6 assets vs `53fc33f` | `git diff --name-only 53fc33f HEAD -- docs/design/` empty |

### Target PostgreSQL read-model gate

The read models that feed the semantic adapter were verified on the **target
PostgreSQL** database (`docker-compose.postgres-test.yml`, PostGIS 16-3.4,
port 55432, tmpfs/ephemeral). 8 pass / 0 fail, exit 0:

- `postgres-integration/m9ReadModelCurrentness.pgtest.ts` — current-assessment
  semantics and observation projection (superseded FAIL does not keep a case
  broken; no current assessment reports `UNKNOWN` rather than an invented
  verdict).
- `postgres-integration/m9SarahProgrammeLoop.pgtest.ts` — readiness fail →
  bilateral swap → PASS → case resolves.
- `postgres-integration/m9AuthoritativePreview.pgtest.ts` — server-built overlay
  through the real M6 evaluator; unknown item refs rejected.
- `postgres-integration/m9ConnectionProgression.pgtest.ts` — progressive
  connection state from the real evaluator, not a hint.
- `postgres-integration/m9JordanMultiActionRecovery.pgtest.ts` — coordinated
  multi-action recovery with truthful partial failure.

These matter because every presentation state in this handoff must trace to those
authoritative values. No provider or paid live calls were made.

### Not run, deliberately

The legacy SQLite full suite is **not** the acceptance gate for this work and was
not run for ceremony. Target PostgreSQL evidence above is the relevant gate.
This branch's tree is identical to the accepted review head `fe09c52` for every
`src/`, `test/` and `postgres-integration/` path — the only differences are the
two cherry-picked v5.6 design documents and three documentation edits — so the
source lane's accepted verification carries over unchanged.

## Anti-hardcoding

- No persona, carrier, route or scenario logic entered production frontend code.
  A word-bounded scan of `src/ui` and `src/app/target/adapters` returns one hit:
  a pre-existing JSDoc example string in `src/ui/case-view-model.ts:211`, present
  unchanged at base `c45a928` and not logic.
- v5.6 scenario facts stay inside the design-reference prototype HTML.
- Contract Lab demo facts stay in `fixtures/ui/semantic-contract.json`, outside
  `src/`.
- The rejected Event Overview prototype is not in the repository.
- No frontend business inference was added.

## Next dependency

The main refactor/integration lane owns repository convergence back onto the
authoritative base line, then consumes this branch. The next frontend-facing
dependency is the FIG-1/2/3/4/6/7 backend read-model prerequisites; live UI
wiring and the Event Overview redesign both remain unstarted by design.
