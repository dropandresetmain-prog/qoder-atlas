# Capabilities and limitations

This is the technical truth sheet for the **currently implemented Northstar runtime**.

`IMPLEMENTED` means a runtime path exists; it does not imply every provider path is live in every environment. The existing local demo/runtime still uses the legacy SQLite-backed model and defaults to credential-free REPLAY where configured.

Northstar also has an **approved target data/state architecture** in `DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`, `DATA_STRUCTURE_LOGICAL_SCHEMA.md` and `IMPLEMENTATION_PLAN.md`. That target is **not implemented merely because it is documented**. Until the relevant M0-M11 milestones land, current-runtime truth below wins for capability claims.

## Current runtime capability matrix

| Capability | Current status | Provider / modes | Current limitation / approved direction |
|---|---|---|---|
| Dependency/state model | **IMPLEMENTED (legacy model).** Typed Trip aggregates, relationships, impact and overlays. | SQLite; all application modes. | Approved target separates Trip/Journey/services/reservations/programme/knowledge and migrates authority to PostgreSQL/PostGIS. |
| Signals and mutation | **IMPLEMENTED.** Validated signals enter the authoritative mutation path. | Internal inputs + provider normalization. | Current generic/aggregate mutation architecture will be replaced by typed commands/expected revisions. |
| Flight context | **IMPLEMENTED.** Search, verify, fare rules and provider-state observation. | Atlas LIVE/RECORD/REPLAY. | Atlas is sandbox constrained and not a universal GDS/TMC servicing path. |
| Flight transactions | **IMPLEMENTED, sandbox constrained.** Order/create, pay, retrieve and supported cancellation/void seams are authority-gated. | Atlas sandbox LIVE evidence + recordings. | Refund execution/provider capabilities remain bounded; target execution adds stronger attempt/reconciliation semantics. |
| Hotel lifecycle | **IMPLEMENTED.** Search, quote/prebook, book, retrieve and cancel. | Nuitée/liteAPI LIVE/RECORD/REPLAY. | No in-place date modification; changes use cancel/rebook. Target separates reservation truth from Journey intention. |
| FX and costs | **IMPLEMENTED.** Dated rates normalize comparable recovery costs/authority amounts. | Frankfurter ECB-reference LIVE/RECORD/REPLAY. | Not a payment FX service. Target financial model uses exact monetary boundaries/budget commitments where required. |
| Ground routing context | **PARTIAL.** Routing can inform deterministic transfer windows. | Google Routes REPLAY and LIVE-capable. | No transactional ground-transport provider; live coverage is not universal. |
| Programme/shared commitments | **IMPLEMENTED (legacy model).** AnchorEvent/commitment intake, fan-out and projections. | Internal supplied programme data. | Target replaces copied/embedded commitment truth with Event -> Programme -> ProgrammeItem + Participation and typed programme actions. |
| Traveller/group modelling | **PARTIAL.** Existing Trip can contain travellers and shared-resource relationships. | Internal domain. | Approved target adds shared Trip + one Journey per Traveller, explicit relationships/support requirements/CoordinationGroups and shared reservation allocations. Not implemented yet. |
| Preferences and policy | **IMPLEMENTED.** Explicit/latent preferences and supplier/organisation/insurance RuleSets. | Supplied/fixture sources. | Target adds versioned rule editions/assignments and revision-bound assessments. |
| Recovery planning | **IMPLEMENTED.** AI proposes; deterministic fallback remains available. | Model Studio/Qwen LIVE when configured; fallback/recordings otherwise. | Current planner reasons over the legacy snapshot model. Target planning becomes multi-object over ResolutionSnapshot/typed scenario changes. |
| Viability and authority | **IMPLEMENTED (legacy model).** Deterministic time/buffer/policy/funding/permission gates. | Internal engine. | Target removes editable/cached viability as canonical truth and binds approvals to exact plan/action scope and input revisions. |
| Execution / observation / reconciliation | **IMPLEMENTED.** Intent -> provider seam -> observation -> state update. | Atlas/Nuitée seams + recordings. | Target adds durable attempts, outcome-unknown reconciliation, scoped approvals and stronger cross-root concurrency handling. |
| Documents/email/web material | **PARTIAL.** Supplied text/structured material can be ingested with provenance and optional schema-bound extraction. | Internal source contracts / Model Studio. | No arbitrary crawler/Gmail/general PDF product integration is claimed. |
| Entry / visa / transit | **PARTIAL representation only.** Sourced claims/uncertainty can be represented; current evaluator coverage is not a legal-grade eligibility engine. | Research/source contracts / fixtures. | Approved target includes typed credentials, intended visits, document selection, route encounters, versioned requirements and deterministic three-valued EntryAssessment. Source/provider coverage still must be selected/proven. |
| Travel advisories / external conditions | **NOT IMPLEMENTED as the approved canonical subsystem.** Legacy sources/signals can carry contextual information. | No dedicated authoritative advisory integration. | Approved target includes publisher lineages/versions, geography/population/time applicability, coverage/freshness and organization-specific policy response. M5/M6 implementation pending. |
| Geographic applicability | **PARTIAL.** Places/timezones/routes exist. | Internal + provider context. | Approved target adds Place/GeographicArea/Jurisdiction + PostGIS applicability. Not implemented yet. |
| Insurance | **PARTIAL policy context.** Clauses/coverage terms can inform rules. | Supplied sources. | No insurer connection, claim decision or payment automation. |
| Notifications | **DEFERRED / NOT INTEGRATED.** In-app operational/traveller surfaces exist. | None for email/SMS/push/Slack. | Add only with auditable delivery/consent state and a validated product requirement. |
| Persistence | **IMPLEMENTED current runtime:** SQLite repositories + sanitized provider recordings. | SQLite + filesystem recordings. | Approved target is PostgreSQL + PostGIS with migrations, FKs, expected revisions, durable work and controlled cutover. Not active yet. |

## Provider evidence matrix

| Provider / service | Purpose | Implemented | LIVE proven | RECORD proven | REPLAY | Important limitation |
|---|---|:---:|:---:|:---:|:---:|---|
| Atlas | Flight search/verify/rules/state + sandbox transaction seams | Yes | Yes, sandbox | Yes | Yes | Not production airline/GDS servicing; sandbox and refund limits. |
| Alibaba Cloud Model Studio / Qwen | Extraction/programme mapping/strategy proposals | Yes | Yes when configured | N/A | Deterministic/fixture fallback | No claim of general live web research. |
| Nuitée / liteAPI | Hotel lifecycle | Yes | Yes, sandbox | Yes | Yes | Cancel/rebook for changes; provider constraints apply. |
| Google Routes | Ground-context estimation | Yes | Bounded/optional | Yes | Yes | No booking action. |
| Frankfurter | Dated ECB-reference FX | Yes | Yes | Yes | Yes | Comparison evidence, not payment FX. |
| Railway | Hosted runtime | Operational evidence | Deployment-dependent | N/A | N/A | Hosting, not a domain capability. |

## Approved target capabilities that are not yet current-runtime claims

The refactor has frozen the architecture for these concerns, but implementation/evidence remains required:

- PostgreSQL/PostGIS canonical persistence and migration/cutover;
- stable Traveller identity + shared Trip/per-person Journey/group/support semantics;
- independent services/reservations/allocations/entitlements/offers;
- mutable Programme/ProgrammeItem/Participation state through the recovery engine;
- source-specific advisories/conditions and geographic/population/time applicability;
- typed credentials and deterministic entry/transit assessment;
- multi-object scope discovery, revision/generation-bound Assessments and stale invalidation;
- scoped multi-party approvals, durable execution attempts and outcome-unknown reconciliation;
- provider/external-record ownership/servicing boundaries suitable for future agency/GDS/TMC integration.

Do not present any of these as live merely because their contracts are approved.

## Current open findings

Findings use `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

| Finding | Classification | Current handling |
|---|---|---|
| Current `Trip.viability` can be stale in read-only/test-harness verifier wiring and legacy evaluation stores derived judgement as state. | **Act Now through refactor** | Preserve regression evidence; target Assessment/manifest architecture removes editable viability as canonical truth. Do not invent an isolated legacy redesign unless required for current safety. |
| Existing SQLite operational incidents are not fully root-caused. | **Investigate Now** | Inspect deployment/volume/replica/log evidence so Postgres does not inherit application-level concurrency mistakes. Database change alone is not the fix. |
| Actual production data/obligations to migrate are not yet fully inventoried. | **Investigate Now** | M0/M10 migration mapping must classify real provider refs, traveller edits, approvals, open attempts and source material before cutover. |
| Entry/advisory source coverage/licensing and authoritative update semantics are provider-dependent. | **Investigate Now** | Architecture boundary is frozen; choose/prove sources before claiming live coverage. |
| Actual GDS/TMC/supplier servicing, idempotency and split-booking capabilities are unknown until partner/provider integration. | **Investigate Now** | ExternalRecord/capability/ownership boundaries must represent unsupported/manual outcomes honestly. |

## Truthfulness rule

Provider success is not recovered-trip proof. A recovery claim requires the relevant internally committed or externally observed state, reconciliation, and a current deterministic assessment of mandatory requirements.

Unsupported or stale information remains `UNKNOWN`/unresolved rather than being promoted into a confident PASS or product claim.
