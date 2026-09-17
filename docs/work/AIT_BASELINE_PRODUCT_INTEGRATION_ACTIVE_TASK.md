# ACTIVE TASK — AiT baseline product integration (first post-C5 product increment)

Working-memory ledger (AGENTS.md "long-horizon work"). Reread before each major
phase and before declaring completion. Close an item only with evidence. The
completed post-C5 convergence ledger is archived at
`docs/work/POST_C5_CONVERGENCE_ACTIVE_TASK.md`, and the wider Slice A ledger this
increment is the first step of is at `docs/work/SLICE_A_ACTIVE_TASK.md`.

## Goal

`canonical AiT runtime bundle` -> `real PostgreSQL normalized state` ->
`real deterministic baseline evaluation where evidence permits` ->
`authoritative live read model` -> `integrated operator product shell` ->
`browser refresh/restart preserves the same world`.

**Stops before the Sarah disruption.** No recovery/case orchestration, no V5.6,
no Event Overview redesign, no M11, no SQLite, no database-wipe reset.

## Exact identity

- Repo `dropandresetmain-prog/qoder-atlas`; primary worktree `C:/Dev/qoder-atlas`
- Branch `feature/ait-baseline-product-integration`
- Base = authoritative `main` `8b02f1e4572d95071b15f59270ec97bdba36a6f2` (verified `origin/main` is exactly this SHA)

## Architecture decisions (frozen for this increment)

1. **Generic dataset boundary, not an AiT module.** A new demo/input-boundary
   tier `src/app/demo/**` loads a *configured* dataset directory
   (`NORTHSTAR_DEMO_DATASET_DIR`). No AiT/persona/place/carrier literal enters
   `src/`. The anti-hardcoding gate forbids `fixtures/programmes` in the
   strict/app tiers, so configuration is the only correct path anyway.
2. **`ProgrammeImportBundle` is NOT widened.** It stays the narrow generic
   intake contract. The rich runtime bundle gets its own boundary schema and
   materializer that calls the same real M2–M6 commands.
3. **Source identity -> UUID mapping uses the accepted F08 external-identity
   mechanism**: `external_connections` -> `external_records` (record_type +
   external_id) -> `external_record_links` (canonical subject kind+id,
   evidence-backed). No deterministic-UUID guessing, no display-name identity.
4. **Provisioning identity/consistency uses `source_records`**: one dataset
   capture row keyed `sourceIdentity = northstar:dataset:<datasetKey>` with
   `content_hash` = sha256 of the canonical bundle bytes. Same identity + same
   hash => already provisioned, reuse. Same identity + different hash => fail
   visibly (`DEMO_DATASET_CONTENT_CONFLICT`). Absent => materialize once.
5. **Baseline evaluation uses the real M6 pipeline** (`captureWorld` +
   `createM6Registry` + `assessSubject`) persisted through the accepted
   assessment path. No seeded verdicts.
6. **Overview population** is an additive `population[]` collection on
   `OperatorOverviewSchema`, fed from the read model's existing authoritative
   ACTIVE-programme population query (the one already producing `ldg.nodes`).
   `items` keeps its case-driven meaning.
7. **Operator shell** = existing `renderPage(...)`. Target HTML routes only.

## Phase checklist

- [x] P0 branch from authoritative main + ledger
- [x] P0b bundle inspection + gap analysis (AB-1, AB-8 closed by reconciled/authored fixture data)
- [x] P1 bundle schema + loader + content hash — `src/app/demo/{datasetSchema,datasetLoader}.ts`
- [x] P2 source/external identity mapping + resolution — `src/app/demo/{externalIdentity,datasetIds}.ts`
- [x] P3 materializer — `src/app/demo/{datasetMapping,materializeDataset}.ts`
- [x] P4 idempotent provisioning gate + boot wiring — `src/app/demo/provisionDataset.ts`, `composeTargetBoot.ts`
- [x] P5 baseline evaluation over materialized journeys — `src/app/demo/baselineEvaluation.ts`
- [x] P6 read-model population contract + operator shell routes
- [x] P7 focused tests — 14/14 `postgres-integration/productBaselineWorld.pgtest.ts`; 749/749 `npm test`; 17/17 Sarah/Jordan/read-model PG regressions
- [x] P8 typecheck / lint / build / anti-hardcoding / boundary gate — all clean
- [x] P9 commit + push — `feature/ait-baseline-product-integration` @ `57bcf06367097768164f0faf39c4909ceea4179d`, pushed and verified equal to `origin/feature/ait-baseline-product-integration`. Not merged to `main`.

## Executed evidence

Materialization into a fresh workspace, and identically after a process restart:
67 travellers / 67 trips / 67 journeys / 1 event / 1 programme / 61 programme items /
84 reservations / 67 assessments. Re-provisioning logs `ALREADY_PROVISIONED` and
changes no counts; a mid-way interrupted provision completes the same world rather
than a second one.

Baseline verdicts from the real M6 evaluator: **50 PASS / 14 UNKNOWN / 3 FAIL** over
67 journeys. Dimension spread is honestly mixed, e.g. `booking_validity` 42 PASS /
25 UNKNOWN, `connection_feasibility` 8 PASS / 59 UNKNOWN, `programme_participation`
22 PASS / 3 FAIL / 42 UNKNOWN, `credential_selection` and `overnight_accommodation`
67 UNKNOWN. No dimension is uniformly PASS by construction.

Constraints materialized: 7 `transfer_minutes`, 1 `minimum_connection_minutes`,
1 `programme_arrival_readiness_minutes`. Sarah resolves through source identity to a
shared inbound service carrying 6 travellers plus a required commitment; Jordan
resolves to a 3-leg journey governed by the connection constraint.

Operator shell on a real boot: `/` shows the AiT event context and a 50/67 readout,
`/programme` 61 items, `/decisions` 0 (no case exists), `/activity` 50 entries — all
inside the existing `renderPage` chrome. Three consecutive refreshes left
`change_records` at 1757, so refresh is read-only.

## Findings / triage

| ID | Finding | Triage |
|---|---|---|
| AB-1 | The runtime bundle carries no ground-transfer durations and no minimum-connection minutes, but `reachPlaceBy`/`connection` need registered `transfer_minutes` / `minimum_connection_minutes` constraints. Without them every inbound traveller's `programme_participation` is UNKNOWN (`transfer_time_unknown`) — an all-UNKNOWN population, not a truthful mixed one. The values exist verbatim in the upstream provenance material `data/ait-demo-input-pack/global/operational-constraints.json` (`groundTransfers.estimates`) and in the bundle's own `rule-ait-connection-buffer`. | **Act Now — CLOSED.** Reconciled the upstream `groundTransfers` block into the runtime bundle as `fixtures/programmes/ait-summit-2026/ground-transfers.json` (verbatim values + provenance header). Not invented data: same source ids, same numbers. Materialized as generic `transfer_minutes` constraint definitions. Connection minutes come from the bundle's own `CONNECTION_BUFFER` rule. |
| AB-2 | Clickable admin/profile "Reset scenario" control: `renderPage` already supports `profileResetAction`, but a truthful reset needs lifecycle semantics this increment deliberately does not own (no table wipe, no backwards mutation of observed history). | **Investigate Now** — next increment. Documented bounded developer path (fresh workspace id / fresh database) in `docs/TESTING.md`; no reset action wired. |
| AB-3 | `POST /api/v2/demo/reset` currently calls `seedDemoWorld` (the two-traveller placeholder world) and is named "reset" while actually appending a second world. | **Act Now — CLOSED.** Route removed; the placeholder `seedDemoWorld`/`demoSeed.ts` stays for `m10DemoSeed.pgtest.ts` but is no longer HTTP-reachable, so a browser can never provision. |
| AB-4 | 25 of 67 travellers carry no declared travel (self/other-arranged locals). Their `programme_participation` evaluates UNKNOWN (`no_route_to_place`). | **Ignore / Accept Risk** — this is the correct honest answer. The fixture supplies no travel evidence for them; inventing filler travel is explicitly forbidden. |
| AB-5 | `fx-rates.json` and `booking-dossiers.json` in the bundle hold one row each (Jordan FX, Jordan/Sarah dossiers) and describe money/contact detail whose target home is `cost_allocations`/`ProtectedDataRef`. Materializing dossier plaintext would fabricate custody (same reason M10 quarantined it). | **Park for Later** — not required by this baseline; recorded so it is not silently dropped. FX/dossier files are read and hashed into the dataset identity but not materialized as domain state. |
| AB-6 | The overview's population query uses `LIMIT 200`, inherited from the read-model lane (CV-7). 67 travellers is well inside it, but the truncation is still silent. | **Park for Later** — inherited item, unchanged by this increment. |
| AB-8 | Neither the runtime bundle nor the upstream input pack carries any place->jurisdiction attribution, and there are no jurisdictions, geographic areas or knowledge-coverage records. `m6.information` (`advisories`) and `m6.entry` (`entry_feasibility` / `transit_feasibility`) are blocking dimensions that can never be anything but UNKNOWN without it: an unresolved place always contributes its own UNKNOWN, and even with jurisdictions resolved, "no applicable advisory / no applicable requirement" only reaches PASS when unexpired **knowledge coverage** exists for the topic and jurisdiction. So every travelling Journey would be UNKNOWN regardless of how good its travel evidence is — an all-UNKNOWN population, not the truthful mixed one. | **Act Now — decided by product owner.** Author `fixtures/programmes/ait-summit-2026/jurisdictions.json` as new demo data: the jurisdictions the bundle's places sit in, coarse bounding geometry per jurisdiction, explicit place->area membership, and the demo dataset's own knowledge-coverage declaration for `ADVISORY`/`CONDITION`/`ENTRY_REQUIREMENT`/`TRANSIT_REQUIREMENT`. Demo facts stay in `fixtures/`; the materializer consumes it generically through `createJurisdiction`/`createGeographicArea`/`addAreaVersion`/`addJurisdictionArea`/`addAreaMembership`/`recordKnowledgeCoverage`. No verdict is seeded — the real evaluator still computes every dimension. |
| AB-9 | The bundle's `engagementImportance` has three tiers (`CRITICAL`/`PREFERRED`/`OPTIONAL`); the target `Participation.obligation` has `REQUIRED`/`OPTIONAL`/`INFORMED`. `PREFERRED` and `OPTIONAL` both map to `OPTIONAL`, losing the middle tier. | **Park for Later** — the distinction is presentational today and nothing in M6 reads it. Recorded so it is not mistaken for a faithful round-trip. |
| AB-10 | `entry_feasibility` and `credential_selection` are UNKNOWN for all 67 journeys: the dataset declares no intended visits/transit intent and no traveller credentials, so ENTRY encounters are not derivable at all. | **Ignore / Accept Risk** — UNKNOWN is the honest answer for absent evidence. Fabricating visits or passports to turn these green is exactly what the brief forbids. |
| AB-11 | Three travellers FAIL `programme_participation` (`arrives_after_deadline` / `insufficient_arrival_readiness`) against the organiser's own 150-minute buffer rule. | **Ignore / Accept Risk** — real evaluator output over real fixture data, not a defect. Notably these are *not* Sarah, so the baseline is not pre-disrupting the hero. |
| AB-12 | Travellers with no declared travel but only `PREFERRED`/`OPTIONAL` participation reach PASS, because no dimension has anything to fail on. Verdict is truthful per the current rules but arguably generous: "nothing required of them" reads as "ready". | **Park for Later** — changing it means changing evaluator semantics for empty requirement sets, which is M6 scope and out of bounds here. |
| AB-13 | An earlier step in this session overwrote `docs/work/POST_C5_CONVERGENCE_ACTIVE_TASK.md` with the previous Slice A ledger, re-encoded as UTF-16. | **Act Now — CLOSED.** Convergence archive restored from HEAD; the Slice A ledger it displaced is now preserved at `docs/work/SLICE_A_ACTIVE_TASK.md` in UTF-8. |
| AB-7 | `rule-ait-transport-concentration`, `rule-ait-*-spend-limit`, `APPROVAL_*`, `CHANGE_TERMS`, `CANCELLATION_TERMS`, `NO_SHOW_TERMS`, `INSURANCE_COVERAGE` and `ENTRY_REQUIREMENT` rules are materialized as real published `RuleSet` editions with their rules, but only `MIN_BUFFER` and `CONNECTION_BUFFER` additionally become evaluator-visible `ConstraintDefinition`s, because those are the only two registered constraint types the M6 registry reads today. | **Park for Later** — the policy survives with lineage; wiring spend/approval rules into authority evaluation is M7/M8 scope, not this baseline. |

## Critical constraints

- PostgreSQL is the sole runtime. No SQLite.
- No Sarah/Jordan/persona/carrier/route branching in domain or application code.
- Do not seed viability labels; use the real evaluator.
- Browser refresh performs reads only.
- Exact-path staging; no `git add .`.
