# Post-C5 Demo Backend Completion — Mini Implementation Plan

## Status

Planning document for audit only. No implementation is authorized by this document.

- Repository: `dropandresetmain-prog/qoder-atlas`
- Base branch: `milestone-m10-migration-rehearsal`
- Exact C5-accepted base SHA: `87783c0bcbdc12cf263851a36e06b9d5255289ce`
- C5 verdict: **PASS — C5 ACCEPTED**
- Next major milestone remains M11 Controlled Cutover + Retirement.
- This bounded completion milestone exists because approved WiT design/frontend work exposed missing backend projections/capabilities that should be completed **before** M11, so M11 remains primarily operational rather than another product-development milestone.

## Objective

Make every meaningful WiT demo visual state traceable to authoritative PostgreSQL state without reopening the accepted ontology, migration architecture, or C5 decision.

The frontend remains a renderer. It must not calculate viability, blast radius, causal failure, policy, authority, readiness/buffer pass/fail, or recovery correctness.

This is **not another refactor**. The expected work is mainly bounded read-model/projection/API completion over the accepted PostgreSQL model, plus a small number of verification tasks.

## Frozen architecture constraints

1. PostgreSQL remains the sole NORTHSTAR runtime.
2. SQLite remains offline, read-only migration input only.
3. Do not reopen M0–M10 or rewrite C5 history unless implementation reveals a genuine architecture contradiction.
4. Do not add Sarah-, Felix-, Daniel-, Elena-, route-, supplier-, or fixture-specific branches to domain logic.
5. Do not create new scenario-specific ontology types.
6. If accepted domain state already contains the truth, expose/project it rather than duplicating it.
7. If the frontend wants a claim the backend cannot truthfully support, either add the smallest generalized backend capability or remove/reframe the frontend claim.
8. No LLM-to-irreversible-action path. Existing deterministic authority/execution gates remain unchanged.
9. M11 should begin only from a new exact post-C5 candidate whose required demo backend capabilities are complete and accepted.

## Source requirements and priority

The design/frontend gap report identified G1–G20. They are intentionally collapsed here into a small number of backend work packages rather than implemented as twenty separate features.

### Act Now before M11

- G1 — live refresh / projection revision delivery
- G2/G3/G4/G7 — structured incident, blast radius, checked/cleared provenance, and authoritative causal focus
- G8 — stable scoped graph identity/truth/change metadata
- G10/G11/G12 — counterfactual preview, approval/authority, execution/observation/reassessment receipt
- G15 — local/non-trip programme participants needed by the approved Sarah recovery
- G16 — reliable presenter baseline reset + provider-event injection
- G19/G20 — verify Sarah stay consequence and Felix programme linkage before building anything

### Investigate Now

- G6 — determine how much event/programme projection data already exists and expose only the minimum needed
- G9 — determine whether rejected/considered recovery candidates are already persisted; expose rather than redesign if present
- G19 — verify current PostgreSQL/evaluator truth for Sarah stay after rebooking
- G20 — verify Felix's actual authoritative programme requirement linkage
- `M2-ACCESS-PATH-PLANNER` — investigate outside M10/C5; resolve before final M11 production-style activation gate

### Park for Later unless nearly free

- G5 — progressive evaluation telemetry; authoritative atomic snapshots are sufficient for WiT
- G13 — polished provider/tool activity projection
- G17 — authoritative historical Before/After toggle
- G18 — full whole-event interactive Live Dependency Graph

These parked items do not block this milestone or M11.

---

# Work packages

## WP1 — Projection freshness and revision contract

### Covers

G1 and the revision/change portion of G8.

### Goal

Allow the frontend to move between authoritative snapshots without manual reloads or fake timers.

### Minimum capability

Provide a reliable freshness mechanism for the relevant WiT projections:

- monotonically distinguishable projection/data revision, or another deterministic version signal;
- stable projection identity/scope;
- changed refs where already cheap and reliable;
- polling is acceptable; SSE/WebSocket push is not required.

### Acceptance

A presenter can trigger a real backend change and an already-open frontend surface can detect and retrieve the newer authoritative projection without fabricated recovery progress.

No new business command is required.

---

## WP2 — Incident / blast-radius projection

### Covers

G2, G3, G4, G7, and the event-side portion of G20.

### Goal

Give Event Overview one authoritative projection answering:

- what changed;
- which service/change triggered evaluation;
- who was in the affected evaluation scope;
- who cleared and who failed;
- why the failed traveller failed;
- which commitment/breakpoint caused escalation;
- which RecoveryCase was created where applicable.

### Minimum fields/semantics

Use existing schema naming where possible, but the projection must contain enough structured data for:

- incident/signal/change ref;
- affected service ref;
- old/current service identifiers and times where represented;
- provider/source/evidence type and received/observed time;
- affected traveller/trip refs and display identity;
- authoritative final outcome per affected traveller;
- proof that a cleared traveller was actually evaluated because of this incident, rather than merely having no open issue;
- critical programme commitment ref/time;
- available readiness/buffer minutes and required minutes where the evaluator uses that rule;
- structured reason/breakpoint;
- explicit causal/focus refs;
- RecoveryCase ref where escalation occurs.

### Acceptance

The frontend can truthfully render the approved Sarah event sequence from backend data alone:

`shared change → 5 affected → 4 cleared → Sarah disrupted → quantitative reason → case created`

No topology traversal in the browser may decide blast radius or causality.

---

## WP3 — Stable scoped graph projection contract

### Covers

G8 and graph needs shared by G7, G10, and G12.

### Goal

Support revision-driven rendering and current/proposed overlays for the approved Event Overview and Sarah case without creating a general graph platform.

### Minimum capability

For the bounded projection lifecycle, provide:

- stable node refs;
- stable edge IDs **or** an explicit deterministic edge uniqueness/stability guarantee;
- authoritative node/edge semantic state;
- current versus proposed truth where meaningful;
- projection revision/order;
- explicit changed refs where animations depend on change identity;
- explicit focus/causal refs supplied by the backend when the UI claims causality.

### Non-goals

Do not build:

- a graph database;
- whole-event semantic zoom;
- arbitrary topology inference;
- multi-focus exploration;
- a generic graph query platform.

### Acceptance

The UI can move current → proposed → executed/recovered without snapshot-index edge keys causing false delete/recreate semantics and without inventing causal relationships.

---

## WP4 — Recovery Case presentation projection

### Covers

G9, G10, G11, G12, and G14 where the joins are naturally available.

### Goal

Expose one coherent authoritative case projection spanning:

`considered → previewed → approval required/approved → executing → observed → reassessed → recovered`

rather than forcing the browser to assemble business truth from unrelated endpoints.

### Minimum capability

Where the underlying target state exists, expose:

- considered recovery strategies/options;
- viability result and rejection reason for retained candidates;
- selected/recommended strategy;
- counterfactual programme changes;
- affected participant refs;
- per-person projected viability/outcome;
- current versus proposed commitments/times;
- cost and booking implications, including no-new-flight fact when supported;
- approval principal/role/status;
- policy/reason/source requiring approval;
- gated ActionIntent refs;
- action type/state/timestamps;
- executor/provider/source where represented;
- observation ref/status/time;
- reassessment result;
- final RecoveryCase state and trip/Journey viability;
- basic traveller/event/organisation/commitment context needed by the approved case UI.

### Important decision

If rejected recovery candidates are not currently retained anywhere, first determine whether a small generalized explanation projection can be derived safely from existing planner evidence. Do not invent rejected options solely to make the demo more dramatic.

### Acceptance

The approved Sarah case can show a truthful sequence from rejected travel recovery through programme preview, approval, execution, observation, and recovery without canned frontend text asserting facts absent from PostgreSQL.

---

## WP5 — Programme participants beyond trip-centric views

### Covers

G15 and the minimum necessary event/programme data from G6.

### Goal

Ensure people affected by programme recovery can appear in authoritative preview and event context even when they do not have an inbound Journey shaped like Sarah's.

### Required investigation

Confirm whether Daniel/Elena-equivalent local participants are already represented through accepted Programme/Participation structures and whether the current preview/evaluator includes them.

### Implementation rule

Prefer existing `Programme` / participant / participation concepts. Do not introduce a "local participant" scenario type.

### Acceptance

The programme-swap preview can authoritatively show every genuinely affected participant claimed by the approved UI, including their current/proposed commitment placement and projected outcome, independent of whether they have an inbound trip.

If the current backend cannot support a claimed participant effect, report the gap before changing the UI or ontology.

---

## WP6 — Presenter controls and truth verification

### Covers

G16, G19, G20.

### Goal

Make the WiT demo reproducible and verify two disputed visual facts before implementation makes assumptions.

### Presenter controls

Confirm and document reliable PostgreSQL-backed paths for:

- restore/reset known demo baseline;
- inject the frozen provider-shaped Sarah disruption through the normal external-event boundary;
- return sufficient acknowledgement/ref for the frontend presenter control.

LIVE / RECORD / REPLAY visibility is useful only if already available cheaply; do not build a new control plane for it.

### Truth checks before coding

1. **Sarah stay/hotel consequence** — after the rebooking changes arrival from 30 Sep to 1 Oct, inspect authoritative target state/evaluator output. The UI must show whatever the backend actually concludes.
2. **Felix programme linkage** — inspect the accepted PostgreSQL state and identify the actual commitment/requirement used in his cleared evaluation. Do not hardcode the historically drifted 16:30 relationship unless authoritative state supports it.

### Acceptance

The demo can be reset and triggered reproducibly, and the approved visuals do not claim stay or Felix relationships that contradict authoritative backend state.

---

# Sequencing and parallelisation

## Phase A — Contract audit and freeze

Before broad implementation, inspect current target APIs/read models and produce a compact matrix for the Act Now + Investigate Now requirements:

`requirement → already exposed / exists in PG but unexposed / genuinely missing / unnecessary because another authoritative field satisfies it`

Freeze additive projection contracts only after this audit.

Do not reopen ontology unless this audit proves the accepted model cannot represent a required product truth.

## Phase B — Parallel implementation after contract freeze

Safe bounded lanes may proceed in isolated worktrees once shared projection shapes are frozen:

- Lane 1: WP1 projection revision/freshness
- Lane 2: WP2 incident/blast-radius projection
- Lane 3: WP4 recovery-case projection
- Lane 4: WP5 participant/event projection + WP6 verification/presenter paths

WP3 graph semantics should be treated as a shared contract consumed by WP2/WP4, not independently reinvented by each lane.

Primary integration owner must reconcile the lanes before acceptance.

## Phase C — Product integration gate

Integrate against the accepted frontend semantic contract only after the independent frontend review produces its accepted head.

Do not couple backend implementation to the provisional frontend SHA `20b9b61c34f3f2d526dbe4e143aba6c8304adc9b` if that review supersedes it.

---

# Testing discipline

Do not repeat the M10 pattern of using broad suites as the debugging loop.

For each work package:

`focused failing/acceptance test → implementation → focused seam test → directly affected PG tests`

Run broader gates only at coherent checkpoints.

Final candidate should include, proportionate to what changed:

- focused projection/read-model tests;
- Sarah target PostgreSQL E2E;
- Jordan target PostgreSQL E2E as regression protection;
- runtime-purge/PostgreSQL-only boot check;
- authority/execution tests if WP4 touches write-path semantics rather than read models only;
- migration smoke/restore only if persistence or migration contracts are actually changed;
- one fresh-database `npm run test:postgres` final gate;
- typecheck;
- build;
- lint;
- anti-hardcoding gate.

Do not run or repair historical SQLite application-runtime suites.

## `M2-ACCESS-PATH-PLANNER`

Carry as **Investigate Now**, outside M10/C5.

Before final M11 activation, determine whether the real invariant is:

- no unacceptable sequential scan / appropriate indexed access;
- deterministic `ANALYZE` before a plan-sensitive assertion;
- or a genuinely required named-index plan.

Do not casually weaken the test merely to make it green. Record the decision and evidence.

---

# Exit criteria for this post-C5 milestone

This milestone is complete only when:

1. Every DEMO BLOCKER from the gap report is classified against actual target state.
2. Required authoritative projections/APIs are implemented without demo-specific domain branches.
3. The frontend no longer needs mock/hardcoded business truth for the approved Event Overview and Sarah Case sequence.
4. Blast radius and causal focus are backend-supplied, not browser-inferred.
5. Current/proposed graph semantics and cross-revision identity are sufficient for the chosen bounded animations.
6. Daniel/Elena-equivalent programme participants are either authoritatively supported or the unsupported UI claim is removed before demo integration.
7. Presenter reset + disruption injection are deterministic and documented.
8. Sarah stay and Felix linkage have been verified against PostgreSQL truth.
9. Parked G5/G13/G17/G18 work has not silently expanded into the milestone.
10. `M2-ACCESS-PATH-PLANNER` has a documented disposition before M11's final activation gate.
11. Relevant focused tests and one coherent final PostgreSQL gate pass.
12. Typecheck/build/lint/anti-hardcoding pass.
13. Exact post-C5 candidate SHA is committed and pushed.
14. M10/C5 historical evidence remains untouched except for additive references if genuinely required.
15. No production cutover has occurred.

After this gate, proceed to M11 Controlled Cutover + Retirement from the new exact accepted candidate.

---

# Audit questions for Astra

Astra should challenge this plan before implementation on the following points:

1. Are any of WP1–WP6 actually attempting to recreate information already exposed by the accepted target read models?
2. Does any proposed field require new domain truth rather than a projection of existing truth?
3. Is stable edge identity genuinely required for the chosen frontend transition approach, or can a smaller deterministic edge-key contract satisfy it?
4. Does WP4 accidentally become a new recovery engine/read-side duplicate rather than a presentation projection?
5. Are Daniel/Elena-like participants already representable and evaluated through existing Programme/Participation contracts?
6. Can G6/G9/G14 be absorbed cheaply into WP2/WP4 rather than becoming separate systems?
7. Are G19/G20 data/seed correctness issues rather than backend capability gaps?
8. Are any parked items actually required for truthful demo operation, or conversely are any Act Now items merely polish?
9. Does any implementation path risk reopening accepted M10 migration semantics or C5 decisions unnecessarily?
10. Is the proposed testing scope proportional to the actual code changes, with focused tests first and one broad final gate rather than repeated full-suite runs?

Astra should return each issue as **Act Now / Investigate Now / Park for Later / Ignore / Accept Risk**, and should identify the smallest required plan correction rather than redesigning NORTHSTAR.

---

## Decision record

### What we know

C5 accepted the PostgreSQL-only runtime, migration semantics, backup/restore, and controlled-cutover preparation. The design/frontend work has now exposed presentation/read-model gaps that should be closed before M11 so M11 stays operational rather than becoming another product implementation milestone.

### What we do not know

We do not yet know how many requested fields already exist in accepted PostgreSQL read models, whether rejected recovery candidates are retained, whether local programme participants are already fully evaluated, or what the current evaluator concludes for Sarah's stay and Felix's commitment linkage.

### Key assumption

Most missing demo capability is projection/exposure work over already-accepted target state, not an ontology failure.

### What should be tested next

Before implementation, audit the current target read models/APIs against WP1–WP6, verify G19/G20 against actual PostgreSQL state, and freeze the smallest additive backend contract needed for the approved WiT surfaces.