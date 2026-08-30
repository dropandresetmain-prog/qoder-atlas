# AiT LIVE Scenario Backend Readiness

**Status:** SEMANTIC READY (S1–S8 assert real engine semantics through declarative acceptance, REPLAY); LIVE/RECORD provider evidence remains the next milestone, pending credentials
**Integration branch:** `wave3r/live-integration`
**Base checkpoint:** `757243a0b01fd3ebd4b9bc0f4b0d4c95519fa47e` (partial cutover, now completed)

## Objective

Make S1–S8 runnable from a data-driven external scenario runner through
ordinary Northstar application boundaries. Scenario identifiers and all AiT
facts remain fixture/configuration data; `src/**` must not branch on them.

The required pipeline remains:

`state → constraints/dependencies → planning → deterministic viability → policy → authority → execution → observation → state update`

Model Studio and Google Routes LIVE calls are excluded from this work package.
Atlas and Nuitée sandbox preflight calls are permitted only as provider
readiness evidence, never as a replacement for missing internal behaviour.

## Baseline audit — 25 Aug 2026

- The exact requested base is healthy: `node --test` passes **587/587**.
  The global `npm` launcher is broken in this environment, so verification
  uses direct Node/package binaries without modifying project configuration.
- `fixtures/programmes/synthetic-summit/programme.json` already declares 67
  participants: 42 `NORTHSTAR_ARRANGED` and 25 self/local/other. The
  classification comes from explicit data, not location inference.
- The current `ScenarioSpec` is a legacy single-trip, disruption-centred
  fixture contract. It cannot describe runner metadata, multiple targets,
  UI actions, provider provenance, or the non-disruption scenario shapes.
- Existing natural paths provide useful foundations: provider-shaped schedule
  signals, missed-flight reports, event-change preview/commit, NL
  `ChangeRequest`, departure-origin substitution, funding-window allocation,
  and hotel replacement execution.
- The following generic concepts are absent and therefore cannot be claimed
  as executable yet: provider disruption correlation across multiple trips;
  stay occupancy/room requirements; a structured personal increment beyond
  a single dated allocation; cross-traveller travel association; and a
  configured programme transport-concentration constraint.

## Incremental evidence

- S1 provider ingress now fans a single normalized provider event to every
  canonical transport element whose booking reference matches, with stable
  per-impact signal identities and separate cases.
- S2 accepts an explicitly identified, post-departure missed connection at
  the ordinary HTTP boundary. Automatic matching remains safely restricted to
  upcoming flights.
- S3 can compare multiple named, counterfactual event-change options through
  a mutation-free HTTP surface; committing a selected option still uses the
  existing fan-out path.
- S4/S7 already traverse the shared ChangeRequest planner: window requests
  select transport legs by corridor direction and declared airport-origin
  substitution re-plans from known Place evidence. Existing focused tests
  prove both directions and explicit uncertainty for unresolved evidence.
- S5 has existing generic funding-window allocation for later return travel:
  costs outside the funded window deterministically attribute to the rule's
  incremental payer and remain authority-gated. It does **not** yet prove
  additional accommodation nights, so it is not complete.

## Provider preflight status

**Blocked — credentials absent (25 Aug 2026).** The isolated environment has
no `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET`, or `NUITEE_API_KEY`; `.env.example`
contains only empty placeholders. No Atlas/Nuitée LIVE or RECORD call was
made, no date was changed, and no Model Studio or Google Routes LIVE call was
made. A credentialed sandbox preflight remains required before readiness can
be declared.

## Work packages and acceptance

1. **LSR-0 — contract and canonical programme foundation.** Define one
   external scenario-input contract that invokes existing HTTP/application
   APIs without becoming a business engine. Add canonical AiT data with all
   67 participants and validate it through the same programme import path.
2. **LSR-1 — S1/S2/S3.** Add generic multi-trip supplier-effect handling;
   preserve partially executed traveller reports; make event preview compare
   alternatives, remain mutation-free until commit, then fan out correctly.
3. **LSR-2 — S4/S7.** Prove natural NL input through planning and viability,
   including rejection of available-but-unviable transport and generic origin
   substitution.
4. **LSR-3 — S5/S6.** Add only reusable funding, accommodation, occupancy,
   and payer/authority information necessary for personal increments and
   replacement stays. Refund execution remains an explicitly allowed Atlas
   simulation/unsupported seam.
5. **LSR-4 — S8 and generalisation gates.** Add a policy-data-driven
   programme concentration rule and cross-traveller association. Add the
   anti-hardcoding and alternate-data gate, then run the full readiness gate.

## Current issue triage

| Classification | Finding | Action / risk |
|---|---|---|
| Act Now | The inherited scenario bundle cannot orchestrate S1–S8. | Replace it with one additive, scenario-neutral runner contract; otherwise scripts would become a second business engine. |
| Act Now | S5/S6/S8 lack required generic ontology/contracts. | Implement the smallest reusable representations; deferral makes the required scenarios non-runnable. |
| Act Now | Existing documentation still calls S5/S6/S8 Stretch. | This tracker and the linked SSOT updates supersede that historical scope split for this branch. |
| Investigate Now | Initial 30 Sep–2 Oct 2026 provider inventory. | Probe Atlas/Nuitée only after scenario requests are data-complete; lack of inventory may require a documented date recommendation, not a silent fixture change. |
| Investigate Now | Credentialed Atlas/Nuitée preflight is unavailable in this worktree. | Supply sandbox credentials in the execution environment; without them route/hotel inventory and servicing evidence cannot be refreshed. |
| Park for Later | Production accounting and arbitrary city geocoding. | Explicitly excluded; neither is needed for the generic acceptance concepts. |
| Ignore / Accept Risk | Global `npm` launcher is missing its roaming installation. | Direct Node invocation is a safe bounded recovery. Do not alter project scripts for a host-level defect. |

## AiT acceptance cutover — evidence (25 Aug 2026)

The acceptance world is now the canonical AiT programme. All eight manifests
and packs reference `evt-ait-2026`, deterministic `trv-evt-ait-2026-*` /
`trip-trv-evt-ait-2026-*` identities, truthful AiT booking identities
(MNSYN13/14/15 and corridor evidence), and
`fixtures/programmes/ait-summit-2026`. No S1–S8 acceptance artifact requires
legacy `evt-w3-demo` / `trip_a` style identities; the legacy synthetic
programme remains only under `fixtures/programmes-historical/` and legacy
`fixtures/scenarios/*` rehearsal bundles, which no required gate depends on.

- **Preflight:** `acceptance:preflight` passes for all eight manifests.
- **Structural execution:** `acceptance:run` executes all eight through the
  generic runner with `ok=true`, truthful exit codes, and evidence written to
  `output/acceptance/`. Modes: S1 `SIMULATED_EXTERNAL_EVENT` (approved
  simulated Atlas ingress at `POST /api/events/atlas`, adapter REPLAY);
  S2–S8 `REPLAY`. No LIVE provider calls; no Model Studio or Google Routes
  spend.
- **Accepted simulation seams:** S1's three provider-shaped Atlas events
  (MNSYN14/MNSYN15 schedule change, MNSYN13 cancellation) enter through the
  real event ingress as `SIMULATED_EXTERNAL_EVENT`; S2's traveller report
  enters through `POST /api/runtime/missed-flight` with the DR-7 explicit
  `elementId` seam (report lands after the missed leg's scheduled
  departure); S3 exercises organiser preview/commit `ui_action`s through the
  programme HTTP surface; S4–S8 submit structured `ChangeRequest`s through
  `/api/resolution/change-request`.
- **Generic fixes landed during cutover (no scenario branches):** reset now
  clears the application-owned `provider_event_inbox` so deterministic reruns
  are not rejected as duplicate deliveries; runner failure records carry the
  HTTP response body for diagnosability; `acceptance-run` terminates without
  racing libuv teardown so exit codes are truthful.
- **Full non-paid gate:** `node --test` **617/617** (includes
  alternate-data/generalisation and deterministic reset/reseed families);
  typecheck, lint, build all pass; `gate:anti-hardcoding` CLEAN over
  `src/{app,engine,domain,intelligence,operational}`; recording/secret scan
  CLEAN (153 files).

**Verdict: READY** — S1–S8 structurally execute against the AiT canonical
programme through the generic acceptance runner with only the already-approved
simulated external-event seams, and the full non-paid gate passes. LIVE/RECORD
execution of S1 first (then S2–S8) remains the next milestone and still
requires sandbox credentials per the provider preflight section below.

## Completion gate

This work package is complete only when each S1–S8 input drives the same
canonical programme state and natural application paths; 67/42/25 is
explicit; test/typecheck/lint/build/browser/reset-reseed/secret/anti-hardcoding
checks pass; and no Model Studio or Google Routes LIVE spend occurred.

## Semantic acceptance closure — evidence (26 Aug 2026)

Independent review returned FIX REQUIRED: all eight manifests were
structurally green but asserted little engine behavior. Closure had three
problems, all landed on this branch (`78f9ede` .. `33e2d2a`):

1. **Generic declarative assertions** (`78f9ede`): the runner evaluates a
   step-level `assert` array with generic operators (`equals`, `truthy`,
   `falsy`, `exists`, `contains`, `gte`, array-length bounds, binding
   substitution). Scenario expectations live only in manifest data; failures
   report step, assertion, expected, actual, and response context.
2. **S1 real reconciliation** (`9a21093`): schedule-change REPLAY evidence
   reconciles against provider state; generic arrival-evidence + MIN_BUFFER
   judgment makes the retimed schedule produce a genuinely divergent impact
   instead of a silent pass.
3. **S1–S8 semantic manifests** — one-line proof per scenario:
   - **S1** retimed MNSYN14/15 schedule lands through provider-state
     reconciliation and the arrival-before-commitment check judges the new
     buffer deterministically.
   - **S2** missed KUL→SIN connection: direct-failure pinned to the missed
     leg, all three dependent-engagement arrival checks FAIL, both REPLAY
     rebook options rejected by explicit buffer arithmetic
     (-20min / 130min vs required 360min), `bestStrategyId` absent,
     `remainderViable = NOT_VIABLE`.
   - **S3** preview is counterfactual (67-trip blast radius, one affected by
     commitment linkage, intermediate observes prove zero mutation) and
     commit is real fan-out (linked/unlinked 1/66, exactly one traveller
     DISRUPTED); post-commit re-preview of the same proposal reports zero
     affected trips — authoritative state already equals the committed
     window.
   - **S4** NL intake → corridor planning → deterministic viability through
     the shared ChangeRequest planner.
   - **S5** Sunday extension priced 468 SGD from REPLAY; incremental payer
     TRAVELLER derived from `rule-ait-funded-window`; authority returns
     honest BLOCKED/ESCALATED against the global hotel-spend cap (fail-closed,
     no engine workaround).
   - **S6** declared replacement property joins snapshot scope (new generic
     `preferredStayPlaceId` seam); occupancy-aware `hotel.search` resolves a
     REPLAY recording (174 properties / 520 rates); zero fabricated
     strategies, three honest uncertainties.
   - **S7** Tokyo origin substitution re-plans from declared Place evidence
     with explicit return-leg uncertainty.
   - **S8** cross-traveller association assessed by the
     TRANSPORT_CONCENTRATION policy at change-request intake.

**Broken-expectation proofs:** every scenario failed the runner when one
expected value was flipped (e.g. S2 `remainderViable` VIABLE, S3
`summary.disrupted` 2, S5 payer flip, S6 property count), then restored to
green — assertions pin real behavior, not constants.

**Final gates on this branch:** `node --test` **622/622**; typecheck, lint,
build pass; `acceptance:preflight` 8/8; all eight manifests `ok=true` with
truthful exit codes; `gate:anti-hardcoding` CLEAN; recording/secret scan
CLEAN. Deterministic reset/reseed is exercised by every acceptance run.

**Triage (semantic closure findings):**

| Classification | Finding |
|---|---|
| Park for Later | `rule-ait-hotel-spend-limit` (NIGHT period, `appliesTo: []`) cross-applies to flight spend authority; fixture declares it a global cap and pinned tests agree — revisit if per-domain caps are needed. |
| Park for Later | `rule-ait-flight-change-approval` names operations `FLIGHT_CHANGE/FLIGHT_CANCEL` that never match engine vocabulary (`flight.change`) — dead rule; wire or remove when flight-change execution lands. |
| Park for Later | S2 luggage-ahead uncertainty not modeled (no luggage ontology in `src/`). |
| Park for Later | No read model exposes committed commitment timestamps (S3 uses idempotent re-preview as the witness). |
| Park for Later | No GET surface exposes element-level reservation state; missed legs are `CANCELLED` in the domain, pinned via activity trail + direct-failure ids. |
| Ignore / Accept Risk | Delegation ran in a sibling clone with `--permission-mode bypass_permissions` under a strict ownership brief; primary agent owned git and re-verified every artifact in the primary worktree. |

**Verdict: SEMANTIC READY** — each S1–S8 manifest now asserts engine-derived
semantics (impact propagation, viability arithmetic, funding/authority,
counterfactual preview, honest uncertainty) through the generic runner, with
broken-expectation failure proofs and the full non-paid gate green. LIVE/RECORD
execution remains the next milestone, still gated on sandbox credentials per
the provider preflight section.
