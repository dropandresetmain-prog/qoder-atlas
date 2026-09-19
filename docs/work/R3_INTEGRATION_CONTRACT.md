# R3 — Full Rebased B1 Integration Contract & Acceptance Map

Status: **FROZEN FOR R3 IMPLEMENTATION** (C0)
Date: 2026-09-19
Branch: `feat/r3-full-rebased-b1-cloud`, base SHA `6118f427eb5fdaed4941e918276fa3260acd9d0c`
(`feat/r2-local-acceptance`, R2 accepted).

This is the smallest durable R3 contract. It does **not** reopen
`RECOVERY_PLANNING_CONTRACT_FREEZE.md` (C1–C10), which remains authoritative. It records
only what R3 must compose, the shared contract decisions taken at C0, and the acceptance
map the write lanes build against.

## 1. R3 scope

R3 is **composition + end-to-end product integration**, not a rebuild. The R1/R2 accepted
foundation is reused unchanged. Exactly two real composition gaps exist at the R2 base
(verified by recon, see §7):

1. normal boot composes the coordinator **without** transport research;
2. the product planning endpoint still calls the pre-R1 proposer seam.

Everything else in the B1 path already exists and is composed.

## 2. The seven "ONE" invariants

| Invariant | Owner | R3 obligation |
|---|---|---|
| ONE coordinator | `composeTargetBoot` | A single `createRecoveryPlanningCoordinator` instance serves **both** the C4 progression pass and the product HTTP planning trigger. The HTTP layer must never construct its own. |
| ONE current planning basis | `loadFailingCaseSubjects` (`recoveryPlanningCoordinator.ts:136`) | C4 and HTTP agree on "the current basis" because both reach the same coordinator, which uses this one function. |
| ONE provider-neutral read-only research path | `createPlanningToolTransport` → `dispatchToolRequest` | No second research engine. LIVE / RECORD / REPLAY share identical downstream coordinator code; only the injected capabilities differ. |
| ONE planning persistence path | `persistRecoveryPlanningCompletion` | Attempt + viable strategies + case phase advance in one UnitOfWork. |
| ONE C4 progression owner | `runRecoveryProgressionPass` | Unchanged; it keeps receiving `planner` from the composition root. |
| ONE authority/execution owner | `recoveryApproval.ts` + `executionPass.ts` | Unchanged. B1 executes **internal** programme intents only. |
| ONE Case read model | `loadRecoveryCaseFacts` → `projectRecoveryCase` | Unchanged; the R2 surface consumes the same planning truth the coordinator persisted. |

**No parallel legacy planning path may remain product-reachable after R3.**

## 3. Shared contract decision — passenger derivation (PRIMARY, overrides recon A3)

### Facts established from code

- `TransportPassengers` is `{ adults: number; children?: number; infants?: number }`
  (`transportCorridors.ts:41-45`) — a **provider search-request concept**, not a canonical
  traveller attribute.
- **Age categories are encoded nowhere** in canonical state. `travellers`
  (`0012_travellers.sql`) carries identity/lifecycle only: no `date_of_birth`, no age, no
  traveller type. `reservation_allocations.allocation_role` is free-form, not an age band.
  `dateOfBirth` exists only in intake/extraction/provider-transaction shapes and is never
  projected into `WTraveller` or the captured world.
- `journeys` is **one traveller per journey**: `traveller_id NOT NULL` with
  `UNIQUE (workspace_id, trip_id, traveller_id)` (`0021_journeys.sql:41-42`).
- `world.allocations: WAllocation[]` carries `travellerId` + `journeyItemId` +
  `quantity`, and the world reader expands **peer travellers on capacity-relevant lines**
  (`pgWorldReader.ts:258-366`).
- The coordinator's dependency is a **static value**
  (`transportPlanning.passengers`, `recoveryPlanningCoordinator.ts:93-98`) threaded
  unchanged into the corridor builder, the transport proposer and offer materialization.

### Rejected alternative (recon A3's recommendation)

Counting co-travellers on the same Trip is **rejected as unsafe**: `pgWorldReader.ts:100-104`
loads `journeys` only for ids in the manifest focus, so a Trip's sibling journeys are
generally **not** in the captured planning world. That derivation would silently return 1
in the common case — a hardcoded `adults: 1` disguised as state derivation. It must not be
shipped.

### Frozen decision

1. `passengers` becomes **per-corridor resolvable**, additively. The existing static field
   is retained so every current pure/integration call site and test keeps compiling
   unchanged; a new optional resolver wins when supplied:

   ```ts
   export type TransportPassengersResolver = (ctx: {
     journeyId: string;
     journeyItemId: string;
     world: CapturedWorld;
   }) => TransportPassengers | { unknown: true; reason: string };
   ```

2. Derivation order, all from authoritative state, all provider-neutral:
   - distinct `travellerId`s in `world.allocations` whose `journeyItemId` matches the
     corridor's item (this is the only place canonical state binds people to a journey
     item, and it includes peer-traveller expansion);
   - otherwise the corridor's own journey's single traveller, from
     `world.journeys[journeyId].travellerId` — legitimate **because the schema makes
     Journey:Traveller 1:1**, not because a constant says so;
   - otherwise fail closed: emit a `TransportCorridorGap` with
     `reasonCode: 'passengers_unknown'`. Never fabricate a corridor.
3. Each derived **person** maps to `adults`. `children`/`infants` stay `undefined`.
   Canonical state encodes no age category, so inventing one is forbidden; and the
   provider request schema requires `adults >= 1` (`dispatch.ts`
   `FLIGHT_SEARCH_PARAMETERS`), so a known person cannot be expressed otherwise. This
   mapping is an explicit, documented **uncertainty**, surfaced in planning evidence —
   never silent.
4. `composeTargetBoot` must **not** contain a passenger literal. It supplies the resolver.

## 4. Shared contract decision — provider capabilities in normal boot

`ToolDispatchCapabilities` is currently constructed **only** in `src/app/compose.ts:303` —
the legacy SQLite composition root that `composeTargetBoot` is forbidden to import, and
which the test-boundary gate treats as retired runtime. Therefore Lane A must build the
read-only FLIGHT capability **fresh** in the target boot, from config:

- mode from `config.adapterMode` (`AdapterModeSchema`, default `'REPLAY'`);
- recording store read dirs from config (`recordingsDir`, `fixturesDir`) — **not** from
  test-only paths;
- timezone resolver from **authoritative PostgreSQL places** (`places.time_zone` +
  `place_external_refs`), never from the SQLite `EntityStore`
  (`buildTimezoneResolver` in `planningLoop.ts:300` is legacy and must not be reused);
- provenance stays truthful: REPLAY evidence says `REPLAY`, RECORD says `RECORD`, LIVE says
  `LIVE` (`replayPlanningTransport.ts:38-47` already maps this). Provider failure remains
  visible `FAILED`/`UNAVAILABLE` evidence, never fabricated success, never a silent
  fallback to another provider;
- **absent capability fails closed**: no FLIGHT capability means the TRANSPORT domain is
  unavailable (already the coordinator's behaviour, `recoveryPlanningCoordinator.ts:271-273`)
  — it must not invent a provider.
- only **read-only** operations are reachable: the closed `ToolOperationSchema` vocabulary
  already makes consequential booking/payment unrepresentable, and Lane A must not widen it.

## 5. Shared contract decision — HTTP planning seam

- `POST /api/v2/cases/:id/strategies` (`targetHttpHandlers.ts:317-327`) must call the
  **shared** coordinator's `planCaseDetailed`, which currently has **zero** production
  callers (only `planCase`, from `recoveryProgressionPass.ts:237`).
- The coordinator reaches the handler through the existing boot→HTTP seam
  `TargetApplication.runtimeHooks` (`composeTargetApplication.ts:52-56`, already consumed at
  `targetHttpHandlers.ts:343,350`). No new injection pattern.
- Status mapping: `CASE_NOT_FOUND` → 404; `CASE_NOT_OPEN` (terminal) → 409;
  `PLAN_PERSIST_FAILED` → 409; success → 200. An honest planning outcome produced *despite*
  provider research failure is **200**, not 500 — provider failure is evidence.
  `STALE_RETRY_REQUIRED` is a success `outcome`, not an error code.
- Idempotency is inherited from deterministic attempt/strategy ids per
  (case, basis, candidate) plus the `planning:completion:<case>:<basis>` idempotency key.
  A duplicate product trigger on the same current basis must create **no** second attempt
  and **no** duplicate strategies.
- Response shape changes from `{ ok, report }` to the coordinator's structured
  `{ ok, result }`. Consequences that **must** be handled in Lane B:
  - the UI control (`product-recovery-case.ts:398-430`) reads `r.body.report` → update to
    the new contract; the control itself already exists and must not be duplicated;
  - `postgres-integration/b1RecoveryLoop.pgtest.ts:178-190` and
    `postgres-integration/b1SarahWorldRecovery.pgtest.ts:159-166` assert the legacy `report`
    shape and are **CURRENT_TARGET (postgres)** → they must be migrated to the new contract.
    Cloud cannot execute them; migration is typechecked in Cloud and proven locally.
- `proposeRecoveryStrategies` loses its only product caller (`targetHttpHandlers.ts:5` is
  the sole importer). It is **retired from the product path but not deleted**:
  `recoveryPlanning.ts` still owns `advanceCasePhase`, which is live in
  `recoveryApproval.ts:34` and `recoveryPlanningCoordinator.ts:64`. Disposition: keep the
  module, retire the seam, and add a static import guard so the target HTTP path cannot
  silently regress to it.
- "Act Now" behaviour: the product control must not be shown when planning is already
  complete for the current basis, the case awaits authority, is executing, or is terminal.
  Prefer the server/read-model's own status over browser inference. If C4 already plans
  automatically, the control's honest role is an operator-initiated **replan on the current
  basis**, and it must be documented as such rather than removed or duplicated.

## 6. Presentation decision — causal spine

`computeLayout` (`src/ui/graph/layout.ts:48`) ranks by longest path from source nodes, so a
traveller with only outgoing edges takes column 0 and the graph reads as a star.
`focusedGraph.causalNodeRefs` is **ordered** (evaluator order,
`projectFocusedGraph.ts:43-50`) and is already computed in the renderer
(`src/ui/graph/index.ts:53`) but is **not passed to `computeLayout`** (`index.ts:68`); it is
used only for `focusRole` classification (`primary|causal|context`, `adapter.ts:114`).

Frozen decision: presentation-only, opt-in second parameter. Causal refs take monotonically
increasing columns in backend order; context nodes hang off the spine at lower visual
weight. Absent/empty `causalNodeRefs` falls back to today's ranking, so existing tests stay
green. **Forbidden:** changing causality, reversing `fromRef`/`toRef` business meaning,
inventing edges, adding scenario geometry, hardcoding persona layout, or altering backend
semantic truth. Visual acceptance remains LOCAL.

## 7. Recon-verified acceptance map

| # | B1 step | Status at R2 base |
|---|---|---|
| 1 | provider-shaped airline change enters normal ingress | EXISTS |
| 2 | canonical state update | EXISTS |
| 3 | dependency invalidation + M6 reassessment | EXISTS |
| 4 | whole trip FAIL | EXISTS |
| 5 | RecoveryCase opens/attaches | EXISTS (`caseEscalation.ts`) |
| 6 | immutable Original focused-graph capture | EXISTS (`originalCaseGraphCapture.ts`, migration **0127** `recovery_case_graph_snapshots`) |
| 7 | C4 progression invokes runtime coordinator | EXISTS (`recoveryProgressionPass.ts:237`) |
| 8 | TRANSPORT + PROGRAMME activate from state/evidence | EXISTS (registry) — **TRANSPORT unreachable in normal boot: gap 1** |
| 9 | provider-neutral read-only research via REPLAY | EXISTS in tests — **not composed in boot: gap 1** |
| 10 | evidence materializes only into planning world | EXISTS (`transportOfferMaterialization.ts`) |
| 11 | RC-6 evaluates flight alternatives | EXISTS (`resolution/scenarios/evaluate.ts`) |
| 12 | material rejected travel alternative persisted + visible | EXISTS (hybrid evidence) |
| 13-15 | programme candidates, RC-6, three separate impact fields | EXISTS (`immediateChangeBlastRadius` / `reassessmentClosure` / `outcomeDelta`, `decisionEvidence.ts:186-188`) |
| 16 | viable-only recommendation | EXISTS (`comparator.ts`) |
| 17 | Case read model exposes planning evidence | EXISTS (`projectPlanningEvidence`) |
| 18-20 | operator approval, authority + ActionPlan, internal execution | EXISTS (`recoveryApproval.ts`, `executionPass.ts`) |
| 21-24 | observation, canonical update, reassessment, C4 PASS | EXISTS |
| 25 | case RESOLVES via deterministic gate | EXISTS (`recoveryCaseResolution.ts`) |
| 26-27 | Current graph healthy, Original unchanged | EXISTS (R2) |
| 28 | product planning trigger uses the coordinator | **MISSING: gap 2** |
| 29 | second non-programme case, same coordinator | EXISTS (`r1ConnectionRecovery.pgtest.ts`) — must keep using the same runtime composition |
| 30 | causal spine presentation | **PRESENTATION DEBT (R2 carry-forward)** |

## 8. Out of scope (unchanged)

B2 (external flight booking/payment, external `SELECT_OFFER` execution, provider mutation
retry, B2 reconciliation, Jordan consequential execution); Event Overview redesign; semantic
Activity redesign; whole-event graph; WebSockets/SSE; semantic history. If R3 reveals a B2
dependency it is recorded, not crossed.

## 9. Cloud limits

Qoder Cloud has no PostgreSQL, no Docker, no physical browser and no LIVE provider
credentials. Cloud may author PG tests, author runtime/provider composition, run pure tests,
use checked-in REPLAY recordings, typecheck, lint, run CURRENT_TARGET and the static
anti-hardcoding/boundary gates. Cloud must **never** claim PG E2E, migration/runtime
transaction behaviour, real browser flow, or LIVE Atlas passed.
