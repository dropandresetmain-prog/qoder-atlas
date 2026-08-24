# Northstar Wave 3 — UX Investigation & Remediation Plan

**Candidate:** branch `fix/rev2-r4-nuitee`, HEAD `eb33d87` · REPLAY mode · deterministic fallback planner
**Method:** app booted via `npm run dev`, probed over HTTP at `localhost:8787` (pages + every API surface), state forensics via `node:sqlite` against `data/app.sqlite`, code traced end-to-end. No calls to paid/live providers. Investigation was read-only: no code changed, nothing pushed.

---

## 1. Why the product is static — the interactivity map

| Visible element | Expected | Actual | Why |
|---|---|---|---|
| Dashboard trip rows (`.brow`) | Click → case | Static `<div>` with data-attrs, no link | `src/ui/screens/operator-dashboard.ts` renders divs; **there is no HTML case route to link to** |
| Dashboard decision rows (`.qrow`) | Click → decide | Static div | Same |
| Programme tiles / case cards | Click → case | Static | Same |
| Case screen | Operator's main working surface | **Unreachable** | `src/ui/screens/operator-case.ts` exists but `src/server/http.ts` defines only `/`, `/operator`, `/programme`, `/traveller`, `/demo` — no route ever renders it |
| Programme chips "Add one traveller" / "Bulk import" | Intake flows | **404** | Link to `/programme/intake`, `/programme/import` — routes do not exist (verified 404 live) |
| Traveller Approve/Decline buttons | Settle the pending decision | **POST → 404** | Form has no `action`; `src/ui/screens/traveller.ts` carries the comment "inert markup the integrator wires". The real endpoint `POST /api/cases/:id/traveller-decision` (JSON body) exists and works — the UI never calls it |
| Demo panel trigger/reset | Fire scenarios | **Works** — the only functional interactive loop | Posts to `/api/demo/trigger`, `/api/demo/reset` |

**Existing-but-unwired endpoints:** `/api/runtime/{plan,begin,decide,execute}`, `/api/programme/{import,context,commitment-change,map-roster,map-brief}`, `/api/resolution/{initial-plan,change-request}`, `/api/cases/:id/traveller-decision`, `/api/wave/*`.

**Missing entirely:** any operator surface to plan/begin/execute; any intake UI; any natural-language input surface.

**Why Overview "goes nowhere":** every row that should navigate targets a route that doesn't exist (the case page), so the dashboard is a dead-end render of projections.

---

## 2. State-transition chains — where they break

```text
Traveller decides:   button → (no action attr) → POST /traveller → 404          ✗ BROKEN at first hop
                     (real path: POST /api/cases/:id/traveller-decision → settleTravellerDecision
                      → recordApproval → executeApproved → observe → verify → read models)  ✓ EXISTS, never called
Operator opens case: click → ——— (no link, no route)                            ✗ MISSING
Operator plans:      ——— (no UI) → POST /api/runtime/plan (hand-built JSON + `at`) ✓ API-only
Organiser intake:    chip → /programme/intake → 404                             ✗ DEAD LINK
Demo trigger:        button → /api/demo/trigger → processDisruption
                     → signal→mutation→impact→case → read models → rerender     ✓ WORKS
```

### Decisive new finding — the approval chain loops back to PLANNING on wall-clock instants

Reproduced twice live, forensically confirmed in the audit table:

- **Fixture-aligned instants** (`plan`/`begin` at `2026-09-13T12:00Z`): full chain succeeds — `RESOLVED / FULLY_RECOVERED`, leg upserted `CONFIRMED`, dashboard flips to RESOLVED. **The engine chain is sound.**
- **Wall-clock instants** (what the UI path actually uses): `decision → 200 {"caseStatus":"PLANNING"}`, audit `CASE_VERIFIED {"suggestedCaseStatus":"PLANNING","hardFailureIds":[]}`, trip stays DISRUPTED forever.

**Root cause:** `BoundaryExecutor` (`src/engine/executor.ts`) stamps `executedAt = intent.createdAt` (= the begin/decision instant); `confirmedData` (`src/app/recoveryExecution.ts`) upgrades the rebooked leg's facts to `AUTHORITATIVE, observedAt = executedAt`. But `ImpactEngine.assess` (`src/engine/impact.ts`) only lets a confirmed rebooking outrank the cancellation signal when `observedAt >= signalInstant`. Fixture signals carry fixed Sept-2026 instants (`sig_a_cancel` received `2026-09-12`); today is 2026-08-24, and `traveller-decision` stamps `endpoints.now()` with no timeline coherence. So the verifier **honestly** loops the case back to PLANNING — and no projection explains why. **Until ~Sept 13, no case can resolve through any UI-reachable path.**

---

## 3. Kimi findings — verified, all 9

### 1. Change request → wrong DISRUPTED status — **ACT NOW**

- **Confirmed:** dashboard "Needs attention", programme tile, `Change requested=0`.
- **Root cause:** `statusFromCase` collapses DETECTED/ASSESSING/PLANNING → DISRUPTED; change requests open RECOVERY cases at DETECTED→ASSESSING.
- **Affected files:** `src/app/readmodels.ts` (`statusFromCase`), `src/app/changeRequest.ts`.
- **Smallest fix:** map change-request-originated cases to `CHANGE_REQUESTED` inside one shared derivation.
- **Test needed:** projection test: change request pending ⇒ dashboard + programme both CHANGE_REQUESTED.

### 2. Internal jargon leakage — **ACT NOW**

- **Confirmed** (5 distinct leaks live):
  - `ChangeRequest cr-demo-1 (ADJUST_TRIP_WINDOW/SOFT_PREFERENCE): …` as `whatChanged`
  - raw audit actions `CHANGE_REQUEST_RESOLVED` / `SCENARIO_SEEDED` / `RUNTIME_RESET` in systemActivity
  - option titles `Rebook el_a_flight_out on offer ATLSBX-…`
  - rejection reasons `hard constraint c_a_arrive_before_keynote FAILS …`
  - approval reason `irreversible/money-moving action defaults to traveller authority`
- **Root cause:** raw internal strings reach user fields: `changeRequest.ts` summary (L220) → whatChanged; `ACTIVITY_COPY` lacks CHANGE_REQUEST_RESOLVED/SCENARIO_SEEDED/RUNTIME_RESET → falls back to `entry.action`; strategy summary `Rebook ${leg.id} on offer ${offerId}` (fallbackPlanner L175) → option titles; viability rejection reasons; authority ruleTrace. The `FORBIDDEN_UI_TERMS` gate covers only static copy + UI fixtures, never live projections.
- **Affected files:** `src/app/changeRequest.ts`, `src/app/readmodels.ts`, `src/intelligence/fallbackPlanner.ts`, `src/ui/copy.ts`.
- **Smallest fix:** human copy map for audit actions + whatChanged; render option/rejection/approval strings through the copy layer; extend the forbidden-terms gate to live-projected JSON.
- **Test needed:** gate test that renders seeded + change-requested + resolved projections and asserts zero forbidden tokens.

### 3. Uncertainty not projected — **INVESTIGATE NOW**

- **Confirmed:** `/api/wave/trips/trip_a/uncertainties` → `[]` even mid-recovery.
- **Root cause:** planning-loop uncertainties are returned in the plan outcome/audit but never persisted where `projectTripUncertainties` reads.
- **Affected files:** `src/app/planningLoop.ts`, `src/app/readmodels.ts`.
- **Smallest fix:** persist planner uncertainties (UNCERTAINTY entities or table) during `runPlanningLoop`; projection reads them.
- **Test needed:** plan via `/api/runtime/plan` ⇒ GET uncertainties non-empty.

### 4. TravellerPresentation absent — **INVESTIGATE NOW**

- **Confirmed:** live page shows bare buttons, no hero/commitment card.
- **Root cause:** `GET /traveller` calls `renderTravellerTrip` with **no presentation argument**; nothing produces one at runtime — it exists only as UI fixtures.
- **Affected files:** `src/server/http.ts` (L275–288), `src/ui/traveller-presentation.ts`.
- **Smallest fix:** derive a minimal presentation (commitment card from objectives/elements) in the read model and pass it through; hero stays fixture-provided.
- **Test needed:** UI test asserting commitment-card fields on a live render.

### 5. Inconsistent status derivation — **ACT NOW**

- **Confirmed:** same 41 delegate trips render UNKNOWN on dashboard vs PLANNING on programme.
- **Root cause:** two divergent derivations: `statusFromCase`/trip derivation vs `programmeStatusFor`, which adds its own PLANNING rule.
- **Affected files:** `src/app/readmodels.ts`, `src/app/programmeReadmodel.ts`.
- **Smallest fix:** one shared status function consumed by both screens.
- **Test needed:** cross-screen consistency test over identical state.

### 6. Readout missing disrupted — **ACT NOW**

- **Confirmed:** readout sums 43 of 44 trips.
- **Root cause:** `readoutBlock` buckets onTrack/watching/working/unknown; DISRUPTED falls into no bucket.
- **Affected files:** `src/ui/screens/operator-dashboard.ts` (L64–82).
- **Smallest fix:** add a disrupted segment; assert Σ buckets = total.
- **Test needed:** read-model test with one DISRUPTED trip.

### 7. Baseline READY/UNKNOWN contradiction — **INVESTIGATE NOW**

- **Confirmed:** 41/44 trips "Unconfirmed" at rest.
- **Root cause:** programme-promoted trips carry itinerary but no confirmed evidence ⇒ trip derivation says UNKNOWN, programme tile says PLANNING; both "honest", mutually contradictory.
- **Affected files:** `src/app/readmodels.ts`, `src/app/programmeReadmodel.ts`.
- **Smallest fix:** product vocabulary decision: one label ("Planned — unconfirmed") or derive READY-with-unconfirmed-elements; implement in the shared derivation (folds into finding 5).
- **Test needed:** baseline snapshot test pinning the chosen vocabulary.

### 8. Case B outside main programme — **ACT NOW**

- **Confirmed:** hero case invisible on programme page.
- **Root cause:** fixture: `trip_a.anchorEventId = ev_a_devsummit` ≠ programme anchor `evt-w3-demo`; programme view filters by anchor event.
- **Affected files:** `fixtures/scenarios/anchor-event-speaker/scenario.json`, `fixtures/programmes/synthetic-summit/programme.json`.
- **Smallest fix:** fixture-only fix: programme page enumerates every anchor event that has trips (or bundle shares the anchor) — no domain-code scenario branching.
- **Test needed:** programme view contains a tile for every anchored trip.

### 9. Chain never populated — **ACT NOW**

- **Confirmed:** `chain` present only in UI fixtures, never projected.
- **Root cause:** `projectCaseDetail` never sets `chain`.
- **Affected files:** `src/app/readmodels.ts`.
- **Smallest fix:** derive chain from audit actions (SIGNAL_PROCESSED → PLANNING_COMPLETED → AUTHORITY_DECIDED → APPROVAL_RECORDED → EXECUTION_COMPLETED → CASE_VERIFIED) — the full audit trail already exists (proven in forensics).
- **Test needed:** projection test asserting chain after a full loop.

---

## 4. Input path — what actually runs today

- **Organiser intake (manual/bulk/messy):** seeding reads **structured JSON only** (`scenario.json`, `programme.json`). `POST /api/programme/import` exists and accepts a structured roster, but the parsers (`parseRosterCsv`, `parseXlsxRoster`, `tableRowsToDrafts` in `src/intake/`) are imported **only by tests**. No messy-input surface exists.
- **Model Studio extraction:** `modelStudioExtractionClient` (`src/app/extraction.ts`) is imported **only by tests**; the ingest pipeline's `extractionClient` is optional and `src/app/compose.ts` never supplies it. Zero runtime extraction.
- **Traveller natural-language request:** no endpoint accepts free text. `/api/resolution/change-request` requires fully structured JSON (`tripId`, `intentKind`, `urgency`…); `utterance` is stored but never interpreted.
- **Model Studio interpretation:** only the recovery planner (`ModelStudioRecoveryPlanner`, gated behind LIVE mode) — nothing interprets traveller/organiser language into state.
- **Promotion into state:** only `seedScenarioBundle` / `seedProgrammeBundle` / programme import handlers — all structured.

---

## 5. LIVE path — wiring proven (no calls made)

| Integration | Control flow | Fail-closed guard | Credentials |
|---|---|---|---|
| Atlas | `src/providers/runner.ts`: REPLAY loads recording; LIVE/RECORD → `adapter.obtainRaw` → identical `normalize` | NOT_CONFIGURED without clientId/secret | present in `.env.local` |
| Nuitée | same runner | NOT_CONFIGURED without `NUITEE_API_KEY` | present |
| Google Routes | same runner | NOT_CONFIGURED without API key | present |
| Model Studio | `useLivePlanner = adapterMode !== 'REPLAY' && modelClient.isConfigured()` (compose.ts) | `isConfigured()` false ⇒ deterministic fallback | present |

Switching `ATLAS_ADAPTER_MODE=LIVE` (etc.) is all that separates REPLAY from LIVE; LIVE and REPLAY share normalization. **Wiring is real; nobody has flipped the switch on the integrated runtime.**

---

# Remediation plan — work packages

## ACT NOW (blocks any credible human demo)

- **WP-1 Wire the traveller decision.** Give the form a real target: `POST /api/cases/:id/traveller-decision` (accept urlencoded or switch form to fetch). Files: `src/ui/screens/traveller.ts`, `src/server/http.ts`. Test: UI POST flips case to EXECUTING/RESOLVED and rerenders.
- **WP-2 Make the case reachable.** Add `GET /operator/cases/:id` rendering the *existing* `operator-case.ts` screen; link dashboard rows, decision rows, programme tiles to it. Files: `src/server/http.ts`, `src/ui/screens/operator-dashboard.ts`, `src/ui/screens/operator-programme.ts`. Test: navigation test row→case.
- **WP-3 Operator actuation on the case page.** Plan / choose strategy / begin buttons posting to the existing `/api/runtime/*` handlers, with the server owning `at`. Files: `src/ui/screens/operator-case.ts`, `src/server/http.ts`. Test: case page drives ASSESSING→AWAITING_TRAVELLER.
- **WP-4 Instant coherence (the PLANNING loop).** Runtime/demo/traveller-decision handlers must use a timeline-coherent instant — e.g. `max(now, latest signal receivedAt for the trip)` or an explicit demo clock seeded from the fixture timeline — instead of raw wall clock; and surface the verifier loop-back reason on the case view. Files: `src/server/http.ts`, `src/app/runtime.ts` / `src/app/runtimeHttp.ts`, case projection. Test: approved decision today resolves to FULLY_RECOVERED; regression test pins `observedAt >= signalInstant` semantics unchanged.
- **WP-5 One status derivation + readout.** Merge `statusFromCase` and `programmeStatusFor` into one function; add CHANGE_REQUESTED mapping (finding 1), fix the readout disrupted bucket (finding 6). Files: `src/app/readmodels.ts`, `src/app/programmeReadmodel.ts`, `src/ui/screens/operator-dashboard.ts`. Tests: per-finding projection tests.
- **WP-6 Jargon firewall.** Copy maps for audit actions, whatChanged, option titles, rejection + approval reasons; extend `FORBIDDEN_UI_TERMS` gate to live-projected payloads. Files: `src/app/readmodels.ts`, `src/app/changeRequest.ts`, `src/ui/copy.ts`, UI test harness. Test: rendered live projections contain zero forbidden tokens.
- **WP-7 Chain projection.** Derive `chain` from audit in `projectCaseDetail`. Files: `src/app/readmodels.ts`. Test: full-loop chain assertion.
- **WP-8 Case B programme membership.** Fixture-only change (anchor alignment or programme view enumerating all anchored events). Files: fixtures or `src/app/programmeReadmodel.ts`. Test: tile present.

## INVESTIGATE NOW (real defects, design choice needed first)

- **WP-9 Uncertainty persistence → projection** (finding 3). Decide storage (UNCERTAINTY entities vs table), then wire planner output through.
- **WP-10 TravellerPresentation from authoritative state** (finding 4) — commitment card derived from objectives/elements; hero stays fixture-provided.
- **WP-11 Baseline vocabulary** (finding 7) — settle READY vs UNKNOWN vs "Planned — unconfirmed" once, inside WP-5's shared derivation.
- **WP-12 Supervised LIVE/RECORD smoke pass** for Atlas + Nuitée + Google Routes + Model Studio (wiring proven, credentials present; one controlled run to convert "wired" into "demonstrated").

## PARK (scope decisions, not defects)

- **WP-13 Messy intake → Model Studio extraction → promotion** (endpoints `/programme/intake|import` UI + `extractionClient` wiring into compose). Revisit: required if the demo narrative demands live extraction; otherwise deferred with ROADMAP entry.
- **WP-14 Traveller natural-language change request** (interpretation endpoint over `utterance` before structured mapping). Revisit: same condition.

## IGNORE

- The verifier's PLANNING loop-back itself — the engine is honest and the e2e proves the chain; the defect is instant coherence + silent failure (fixed by WP-4). No engine change.
- The transient 404 on `POST /traveller` as a separate item — subsumed by WP-1.

## Suggested sequencing

**WP-4 → WP-1 → WP-2 → WP-3** first (they convert a static mockup into a drivable product in ~one lane); then **WP-5/6/7/8** as one projection-honestry package; INVESTIGATE items behind those. All ACT NOW packages touch disjoint files except `readmodels.ts` (WP-5/WP-7 share it) — sequence them or merge deliberately.

---

**Repo state after investigation:** unchanged (`git status` clean apart from pre-existing untracked dirs), server stopped, candidate still `eb33d87`.
