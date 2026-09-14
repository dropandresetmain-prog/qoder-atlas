# NORTHSTAR M0 — legacy inventory, migration mapping and DDL allocation

Status: **INVENTORY AND MAPPING RECORDED — NO MIGRATION EXECUTED**. This
package performs no runtime change, schema migration or data import
(`docs/IMPLEMENTATION_PLAN.md` §4 "Migration/reseed"). Personal traveller
data, secrets and raw provider content are not reproduced here — only
structural shapes and synthetic/demo identifiers already present in the
tracked repository fixtures.

## 1. Legacy store inventory

### 1.1 Frozen SQLite schema (`src/persistence/database.ts`, `SCHEMA_VERSION = 2`)

| Store | Shape today | Identity/versioning |
|---|---|---|
| `trips` | Single JSON blob (whole `Trip` aggregate: objectives, elements, relations, `governedByRuleSetIds`) + `id`, `version` int, `updated_at` | PK `id`; monotonic `version` guard rejects lower versions but **not** equal-version overwrites (not true CAS) |
| `cases` | JSON blob (`RecoveryCase`: strategies, authority decisions, action intents, execution results, resolution) + `id`, `trip_id`, `status`, `version` | PK `id`; unenforced `trip_id` reference; same version-guard pattern |
| `signals` | JSON blob (`TripSignal`) + `id`, `trip_id?`, `occurred_at` | PK `id`; effectively append-only, no versioning |
| `sources` | JSON blob (`SourceRecord`) + `id`, `kind`, `retrieved_at` | PK `id` |
| `source_contents` | Raw content string keyed by `source_id` | PK `source_id`, 1:1 with `sources` |
| `entities` | `(entity_type, id) -> data JSON`, holding `ORGANISATION`, `TRAVELLER`, `ANCHOR_EVENT`, `PLACE`, `RULE_SET`, `CONSTRAINT` | Composite PK `(entity_type, id)`, validated per-type on read/write — **this is exactly the universal object repository `domain_subjects` (Schema §1) explicitly excludes** |
| `audit` | Append-only `occurred_at, actor, action, subject, payload(JSON)` | Autoincrement PK; no revision linkage to the subject's aggregate version |

### 1.2 Application-owned stores (outside the frozen entity registry)

| Store | Shape | Notes |
|---|---|---|
| `booking_dossiers` (`src/app/dossierStore.ts`) | `traveller_id` PK, `flight_data`/`hotel_data` JSON | Only place given/family name, DOB, gender, payment ref currently live — **disconnected from `entities.TRAVELLER`** by anything but a shared string ID |
| `fx_rates` (`src/app/fxStore.ts`) | `base_currency, home_currency, rate_id` PK, `data` JSON | FX evidence with source/effective period |
| `provider_event_inbox` (`src/app/eventInboxStore.ts`) | `(provider_id, provider_event_id)` PK, `received_at`, `raw_payload`, `processed_status`, `processed_outcome` | Near 1:1 with target `inbox_deliveries`; `processed_status` should split into `inbox_work` state |
| `preferences` (`src/app/preferenceStore.ts`) | `id` PK, `traveller_id`, `trip_id?`, `data` JSON | Precedence computed at read time from `origin.kind`, not persisted as rank — acceptable per target's "explicit outranks inferred" wording |

## 2. Legacy → target table family mapping

| Legacy shape | Target family (Schema §2–§8) | Ambiguity / reconciliation flag |
|---|---|---|
| `trips.data` whole aggregate | `trips` (root) + `journeys` (one per `travellerIds[i]`) + typed `journey_items`/detail tables, split by `elementKind` | **Act Now / Investigate before migration rehearsal**: `Trip.travellerIds` is an unstructured array with no recorded per-traveller element ownership. Single-traveller trips migrate safely (one Journey); multi-traveller trips need explicit allocation review — never guess which Journey an element belongs to. |
| `Trip.objectives[]` | `objectives`, `objective_targets`, `objective_dispositions` | `linkedElementIds` need owner-kind resolution (Trip vs. Journey vs. JourneyItem) before FK assignment. |
| `Trip.relations[]` | `dependencies` (`CONNECTS_TO`/`REQUIRES` only) | `SHARES_RESOURCE_WITH` is not in the target's frozen dependency vocabulary — flag for explicit reclassification into a typed constraint/association, not a straight rename. |
| `Trip.governedByRuleSetIds` / element / Traveller / Stay policy IDs | `rule_assignments` | Multiple existing linkage points must reconcile into one assignment table — do not pick one source arbitrarily. |
| `elements[]` (`TransportLeg`, `Stay`, `Engagement`) | Typed item-detail tables + `reservations`/`reservation_lines`/`transport_services` where `bookingRef` present | `BookingRef{system, reference}` is a loose pointer, not a verified `external_record_links` FK. `Stay.guests` (occupancy) has no per-traveller allocation when a Stay serves multiple people — quarantine as ambiguous rather than assuming even split. |
| `cases.data` (`RecoveryCase`) | `recovery_cases`, `case_subjects`/`case_signals`, `recovery_strategies`/`strategy_changes`, `authority_decisions`/`approvals`, `action_intents`/`execution_attempts`/`execution_observations` | The single case-wide `recoveryApproval` envelope must project into the target's per-intent `approvals` model — a semantics decision, not a column rename. JSON policy (Schema §10) explicitly forbids "cases with nested action history" surviving as-is. |
| `signals.data` (`TripSignal`) | `change_signals`/`signal_subjects` | `payload: Record<string,unknown>` is untyped; `AnchorCommitmentChangePayloadSchema` is the one signal payload with real structure today and maps cleanest. |
| `sources` + `source_contents` | `source_records`/`source_content_refs` | Close 1:1 fit; `FactAuthority` enum aligns with target authority/freshness fields. |
| `entities.ORGANISATION` | `organisations` | Direct fit; `roles[]` is descriptive-only today and must **not** migrate as an authority mechanism (matches target's "roles are assignments, not a string that grants powers"). |
| `entities.TRAVELLER` | `travellers` + children | **Act Now / Investigate before migration**: current `Traveller` has a flat `name` (no given/family split — that lives only in `booking_dossiers`), `nationalityCodes`/`passports` as bare `Fact<>` arrays (not `travel_credentials`/`credential_versions`/typed detail tables), inline `accessibilityRequirements[]`, freeform `loyaltyContext`. Nothing today enforces one canonical identity across `entities.TRAVELLER` + `booking_dossiers` + `preferences`, which share only an unvalidated string ID. |
| `entities.ANCHOR_EVENT` (+ nested `commitments[]`) | `events` + `programmes` + `programme_items` | `AnchorEvent` conflates Event+Programme in one nested object (one Programme per Event by construction today); the split rule for which commitments become which Programme is a migration decision to record explicitly, not infer per-row. `Engagement.anchorCommitmentId` → `participations`. |
| `entities.PLACE` | `places`/`place_external_refs`/`place_associations` | `coordinates` are plain lat/lng and need a PostGIS geometry contract at M1; `externalRefs[]`/`servedByPlaceIds[]` map directly. |
| `entities.RULE_SET` | `rule_sets`/`rule_set_versions`/`rules` | Current single mutable row per rule set contradicts target's immutable published editions — needs an explicit "as-of" first edition on import. |
| `entities.CONSTRAINT` | `constraint_definitions`/`constraint_operands` | **Act Now / Investigate**: `Constraint.status` (PASS/FAIL/UNKNOWN) is currently stored **on the definition**, which the target explicitly forbids ("Definition does not own evaluation status" — that belongs to `assessments`/`assessment_results`). Historical stored statuses need an explicit decision on where they land (likely: archived as legacy evidence, never as a current assessment). |
| `audit` | `change_records` | Lacks before/after revision refs and typed subject; migrate as legacy evidence, not a drop-in replacement. |
| `booking_dossiers` | Merge into `travel_credentials`/`traveller_names`/`traveller_contacts` + `reservation_allocations`/offer context for `paymentRef` | Must be merged with `entities.TRAVELLER`, not dropped — currently the only source of legal given/family name, DOB, gender. |
| `fx_rates` | `fx_observations` | Close fit; `FxNormalizationRecordSchema` on `ActionIntent` also needs to land in `execution_observations`/`cost_allocations` evidence. |
| `provider_event_inbox` | `inbox_deliveries` (+ `inbox_work`) | Split `processed_status`/`processed_outcome` into proper `inbox_work` state transitions rather than one denormalized column. |
| `preferences` | `preferences` | Close fit; keep precedence computed rather than stored. |

## 3. Fixture/dataset categories (`fixtures/**`)

| Path | Contents | Migration posture |
|---|---|---|
| `fixtures/acceptance/{manifests,packs}` | S1–S8 scripted flows; synthetic `TripSignal`/context payloads with deterministic composed IDs (`trv-evt-w3-demo-draft-1`, `trip-trv-evt-w3-demo-draft-1`, `sig-s1-supplier-disruption`) | Scenarios themselves are schema-agnostic and reusable as-is; embedded flat `Trip`/`TripSignal` JSON needs reshaping to Trip+Journey once M2 lands. |
| `fixtures/programmes/ait-summit-2026` | `programme.json` (nested Organisation/AnchorEvent/commitments), `booking-dossiers.json`, `fx-rates.json` | `programme.json` splits into Event+Programme+ProgrammeItem+Place; `booking-dossiers.json` merges into Traveller identity per §2 above. |
| `fixtures/programmes-historical/synthetic-summit` | Same shape, frozen prior generation | Keep unedited as a migration-diff regression baseline. |
| `fixtures/recordings/{atlas,google-routes,nuitee}` | Raw provider HTTP recordings | Provider adapter boundary fixtures; unaffected by the data-structure refactor, reusable unchanged. |
| `fixtures/scenarios/{anchor-event-speaker,corporate-tmc,s1..s4}` | Per-scenario recordings + source documents | Feed `source_records` directly; reusable as-is. |
| `fixtures/ui` | Static image assets | Not part of the data model. |

## 4. Deterministic demo identity preservation

Composed, human-readable deterministic IDs recur across fixtures and
`src/app/demoWorld.ts`/`demoHeroes.ts` (e.g. `evt-w3-demo` →
`trv-evt-w3-demo-draft-1` → `trip-trv-evt-w3-demo-draft-1`;
`POPULATED_DEMO_BOOTSTRAP_VERSION = '2026-08-28-jordan-preemptive-entry'`).
Per the plan's "reseed verified demo identities explicitly, preserving
original mapping for audit tests" requirement, these strings populate
`legacy_id_map` (`src/contracts/v2/migration/migrationEnvelope.ts`
`LegacyIdMapEntry`) directly: `sourceId` is the existing deterministic string,
`targetId` is the newly minted UUID, `mappingEvidence` cites the
`migration_runs` record. Audit tests then assert
`legacy_id_map['trv-evt-w3-demo-draft-1'] == <target Traveller/Journey id>`
instead of re-deriving identity from fixture content at every run.

## 5. DDL specification / migration allocation ledger

M0 does not emit SQL DDL (that is M1's `src/persistence/postgres/**`
deliverable). This ledger reserves the migration numbering ranges and table
ownership so M1/M2–M5 do not collide when they materialize the logical
schema from `DATA_STRUCTURE_LOGICAL_SCHEMA.md`:

| Migration range | Owner | Table families |
|---|---|---|
| `0001`–`0009` | M1 (persistence foundation) | `workspaces`, `domain_subjects`, `aggregate_heads`, `schema_migrations`, `command_receipts`, `change_records`, `scope_generations`, `inbox_deliveries`/`inbox_work`, `outbox`, `legacy_id_map`, `migration_runs` |
| `0010`–`0029` | M2 (people/Journeys/coordination) | §2 people tables, §3 Trip/Journey/group tables |
| `0030`–`0049` | M3 (services/enterprise) | §4 services/arrangements/accounting tables |
| `0050`–`0069` | M4 (programme/geography) | §5 programmes/places/spatial tables |
| `0070`–`0089` | M5 (knowledge/requirements) | §6 requirements/provenance/external-information tables |
| `0090`–`0099` | M6 (world/evaluation, primary-owned) | `assessments`/`assessment_results`/`assessment_subjects`/`assessment_inputs`, `exposure_index` and other derived read-model tables |
| `0100`–`0119` | M7/M8 (planning/authority/execution) | §7 resolution/integration tables (`recovery_cases` … `execution_observations`). **M7 used `0100`–`0102`**; `0103`–`0108` reserved for M7 follow-ups; **`0109`–`0119` reserved for M8**. |
| `0120`+ | Additive extensions post-C0 (F16) | New typed detail tables registered via `ExtensionRegistration`; never renumber or reuse an earlier range |

Allocator rule (Schema §1): registration of a subject, its aggregate head and
its first typed row is atomic, with deferred constraints for the circular
identity relationship where needed. Each range above is owned by exactly one
milestone; a lane needing a table outside its range requests an allocation
from the architect rather than inventing a number.

## 6. AT01–AT24 mapping (no acceptance family orphaned)

| AT | Primary packages (plan) | M0 contract/fixture anchor |
|---|---|---|
| AT01 | M4/M6/M9 | `programme.ts` `ProgrammeItem`; `scenarioChange.ts` `CHANGE_PROGRAMME_ITEM_TIME`; example 3 in `test/northstar-v2-contracts.test.ts` |
| AT02 | M4/M6/M7/M9 | Same as AT01 plus `assessmentManifest.ts` per-subject PASS/FAIL divergence proof |
| AT03 | M2/M6/M7 | `trip/support.ts` `AccompanimentConstraintDefinition`/`SupportAssignment`; example 1 (family split/handoff) |
| AT04 | M2/M8 | `people/traveller.ts` `TravellerRelationship`/`ResponsibilityAssignment`/`AuthorityGrant` (three distinct concepts) |
| AT05 | M2/M3/M6 | `trip/trip.ts` `Journey`/`journeysAreUniquePerTraveller`; example 1 |
| AT06 | M3/M6/M9 | `arrangements/reservation.ts` `ReservationAllocation`; example 2 (shared booking across Trips) |
| AT07 | M7/M8/M9 | `action/actionPlan.ts` + `authority/authorityEnvelope.ts` joint-approval/compensation fields |
| AT08 | M2/M6/M9 | `assessmentManifest.ts` `AssessmentKind.ENTRY` + per-subject verdicts; example 5 |
| AT09 | M2/M6 | `trip/trip.ts` `CredentialSelection`; `people/traveller.ts` `CredentialLink`; example 5 (multi-passport transit) |
| AT10 | M5/M6 | `knowledge/information.ts` `InformationVersion`/`RuleSetVersion`; `scope/readScope.ts` scope-generation invalidation; `registry: WorldSnapshot currentness` test |
| AT11 | M5/M6/M9 | `knowledge/information.ts` `InformationRecord`/`InformationVersion` per-publisher lineage; example 4 (conflicting advisories) |
| AT12 | M1/M5/M6/M8 | `assessmentManifest.ts` `isAssessmentCurrent`; `authorityEnvelope.ts` `expiresAt`; time-only invalidation |
| AT13 | M4/M5/M6 | `programme.ts` `GeographicAreaVersion`/`Jurisdiction`; `knowledge/information.ts` `InformationScope` |
| AT14 | M1/M4/M6/M8 | `unitOfWork.ts` `AggregateHeadReader.lockHeads`/`ScopeGenerationLedger`; concurrency contract (M1 supplies real DB proof) |
| AT15 | M6/M7/M8 | `domainCommand.ts` `basisAssessmentId`/`basisPlanVersion`; `authorityEnvelope.ts` `approvalCoversEnvelope` |
| AT16 | M3/M4/M8 | `execution.ts` `ExecutionObservation` discriminated union (EXTERNAL_PROVIDER vs INTERNAL_COMMAND_RECEIPT) |
| AT17 | M1/M8 | `execution.ts` `ExecutionAttemptStatus.OUTCOME_UNKNOWN`/`canDispatchNewAttempt`; example 6 (supplier timeout) |
| AT18 | M1/M3/M5/M8 | `domainCommand.ts` `idempotentReplayIsSafe`; `informationIngestion.ts` `ingestionIsAcceptable`; `migrationEnvelope.ts` `migrationImportOutcome` |
| AT19 | M6/M7/M8 | `scenarioChange.ts` closed `ScenarioEffect` union (cannot rewrite judging rules/fabricate confirmation) |
| AT20 | M6/M8/M9 | `assessmentManifest.ts` `overallVerdictFromDimensions` (FAIL/UNKNOWN cannot be outvoted by unrelated PASS) |
| AT21 | M5/M6/M9 | `extension/extensionRegistration.ts` full protocol; example 7 (EV-charger-outage) |
| AT22 | M6–M9 | All `src/domain/v2/**`/`src/contracts/v2/**` — same contracts drive every scenario; anti-hardcoding gate extends to v2 paths |
| AT23 | M10 | `migrationEnvelope.ts` `MigrationEnvelope`/`LegacyIdMapEntry`/`migrationImportOutcome` |
| AT24 | M1–M3/M8/M9 | `shared/identity.ts` `WorkspaceId` scoping on every schema; `authorityEnvelope.ts`/`authorityGrant` represented-party checks |

No AT ID is unmapped. Where a package is listed as primary owner, this
package's contract is the shared surface that owner's fixtures will exercise
under real persistence/concurrency at M1+ — M0 proves the contract shape and
invariant-violating rejection only.

## 7. M2 landing — rules the schema now enforces

M2 materialized `0010`–`0029` (42 tables). **No import has run.** What changed
is that the §2 ambiguities below now have a named destination table, and the
ones marked "staged" have an explicit non-destination. Each rule states the
deterministic transform and the constraint that makes a wrong transform
unrepresentable rather than merely discouraged.

| Legacy shape | M2 destination | Deterministic rule | Enforcement |
|---|---|---|---|
| `entities.TRAVELLER` + same-id `booking_dossiers` | `travellers` + `traveller_names` + `traveller_contacts` + `profile_assertions` | One `travellers` row per shared legacy id — the two stores are one person, never two subjects. Flat `Traveller.name` → a `traveller_names` row; dossier given/family → a second row with `name_kind='LEGAL'`. DOB/gender/nationality → `profile_assertions`, not columns. | `travellers.id` is a `TRAVELLER` subject (`0012` + subtype checker), so a person exists only with its registry row; `display_name_ref` FK requires the display name to exist. |
| Conflicting name values between the two stores | two dated `traveller_names` rows | No guess-and-discard: keep both with `valid_from`/`evidence_id` and classify each by `name_kind`. Which one renders is a recorded pointer, not a query-order accident. | `travellers.display_name_ref` is a deferred FK at one `traveller_names` row, and `enforce_subject_subtype_traveller` rejects a pointer that selects another traveller's name — so a merge cannot leave a person rendering someone else's name. |
| Suspected duplicate people | `lifecycle_status='MERGED'` + `merged_into_traveller_id` | A merge is a recorded decision with a survivor pointer. Never a delete, never similarity auto-merge. | `0012` CHECK ties `MERGED` ⇔ survivor present, so half-recorded merges cannot commit. |
| `Traveller.passports[]` / `nationalityCodes[]` `Fact<>` arrays | `travel_credentials` → `credential_versions` → one typed detail row; nationality → `profile_assertions` | A credential is a document (typed, versioned, Traveller-owned); a nationality is an assertion about the person. The two are never the same row. | `0015` composite FK `(workspace_id, id, kind)` means a VISA edition cannot receive passport detail and vice versa; deferred trigger requires exactly one detail row. |
| Legacy credential document numbers, `paymentRef`, contact strings | detail-table `*_content_hash` / `*_storage_ref` / `*_access_policy_id` | Import the ProtectedDataRef triple only. A value with no storage ref and access policy does not enter the authoritative tables; it becomes a staged exception. | the three columns are `NOT NULL` with length/`btrim` CHECKs (`0012`/`0015`), which is deliberate: there is no "temporary plaintext" column to park a secret in. |
| `Trip.travellerIds[]` | one `journeys` row each | `travellerIds[i]` → Journey for that Traveller in that Trip. Trip participation is *derived* from Journeys; there is no second membership list to drift. | unique index `journeys_per_traveller_per_trip_uidx` (`0021`) + the deferred Trip-membership assertion, so "Trip with zero journeys" cannot commit either. |
| `elements[]` (`TransportLeg`/`Stay`/`Engagement`) per-traveller ownership | `journey_items` + `transport_item_details`/`stay_item_details`/`engagement_item_details` (`0022`/`0023`) | `elementKind` maps deterministically. **Owner does not** — see the staging rule below. | exactly one typed detail row per item (deferred assertion, `0023`), so an element cannot land as an untyped item. |
| `BookingRef{system,reference}`, `Stay.guests` | **not M2** | M2 has no booking, reservation, allocation or supplier column at all, so a shared booking cannot be copied into each Journey as it migrates. M3 creates one reservation subject plus N allocations; `occupancy_needs` stays a bounded need statement, not a per-person booking. | verified by `m2SubtypeIntegrity.pgtest.ts` (no catch-all/unapproved jsonb columns) — the duplication is structurally unavailable, not just discouraged. |
| Legacy inline `accessibilityRequirements[]` | `accompaniment_requirements` (`0027`) + `support_assignments` (`0028`) | The requirement migrates as the immutable governing definition; any already-selected supporter migrates as a separate assignment referencing it. Missing eligible-supporter data → no `accompaniment_eligible_supporters` rows, which reads as UNKNOWN, not "anyone". | `0028` requires an assignment to cite its governing requirement; `0027` is append-only, so an assignment can never rewrite what it satisfies. |
| Legacy actor strings (`audit.actor`, case approver) | `principals` + `authority_grants` + `grant_scopes` + `grant_actions` (`0011`/`0019`) | An actor migrates only when it resolves to a real `(workspace_id, id, kind)` subject. No synthetic subject is invented to absorb an unresolvable string. | `grant_scopes_subject_fk` / `authority_grants_represented_party_fk` reference `domain_subjects (workspace_id, id, kind)`, so a right-kind-only-or-wrong-id reference fails. |
| `audit` rows | `change_records` (M1) | Migrate as legacy evidence citing `legacy_id_map`; do not back-fill `before_revision` values that never existed. | `0005` has `before_revision bigint` nullable against `after_revision bigint NOT NULL` — an unknown prior revision is representable, a missing result revision is not. |

### 7.1 Staging and provenance

- Legacy→target identity resolution uses M1's `legacy_id_map` (append-only via
  `legacy_id_map_immutable`), so a resolved duplicate keeps both its original
  string and its survivor chain readable after the merge.
- Ambiguous records land in `migration_runs.reconciliation_exceptions` and
  **nothing else**. There is no M2 "quarantine" table, deliberately: staging is
  run-scoped evidence, not domain state a reader could mistake for a fact.
- No typed M2 table carries a legacy-source column. Fixture/scenario names,
  supplier locators and legacy string ids are rejected by the anti-leak
  assertions in `postgres-integration/m2SubtypeIntegrity.pgtest.ts`.

### 7.2 Deferred because M2 must not express it

| Not in M2 | Owner | Why it is a deferral, not an omission |
|---|---|---|
| `E_AUTHORISATION` typed detail table | architect (recorded in `evidence/M2.md`) | `CredentialKindSchema` admits the kind, but Schema §2's frozen detail inventory names no table for it. `0015`'s trigger is per-kind and deliberately silent here rather than inventing a column set. |
| `PLACE` / `JURISDICTION` referents | M4 | M2 stores opaque UUID refs and indexes them; the tables and PostGIS geometry contracts are M4's range (`0050`–`0069`). |
| Reservations, services, allocations | M3 | §4 range; see the booking-duplication rule above. |
| `ConstraintDefinition`, requirements knowledge, evidence freshness rules | M5 | M2's support requirement is the accompaniment case only, which §3 assigns to M2. |
| Entry/transit feasibility verdicts | M6 | A missing credential must remain a queryable absence; only M6's assessment layer may turn that into PASS/FAIL/UNKNOWN. |
