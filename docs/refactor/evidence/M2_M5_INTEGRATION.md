# M2–M5 domain integration evidence (Checkpoint A)

Status: **INTEGRATED — NOT WIRED INTO PRODUCTION**. One PostgreSQL/PostGIS schema
now carries all four domain lanes. No runtime SQLite cutover, no provider action,
no M6 evaluation in this checkpoint.

## 1. Exact identity

| Item | Value |
|---|---|
| Branch / worktree | `integration/m2-m6-domain-evaluation` / `C:/Dev/qoder-atlas-m6` |
| Base (`data-structure-refactor`) | `71f638ed30d01e65981bdd9e5e6128ad067fbf1d` |
| M3 `milestone-m3-recovered` | `959fff5f87ff0484cbd5eb9c128d508676e581f9` → merge `23b8bdc` |
| M4 `milestone-m4` | `cad6bb8bb3d08f80098fb6a013b4fff077fe3015` → merge `d6880c3` |
| M5 `milestone-m5-recovered` | `8e3dee0b699ccfacd86e2c942f18d5816e6c673c` → merge `bb2573a` |
| Checkpoint A commit | the commit that adds this document (SHA recorded in `docs/work/ACTIVE_TASK.md` and `evidence/M6.md`) |

All four SHAs were verified against `origin` before any merge; every lane had
the base as its merge-base (no drift). Merges are `--no-ff`, so each lane's own
history is preserved and reachable.

## 2. Merge order and conflict resolutions

Order M3 → M4 → M5. No conflict was resolved by taking one side wholesale.

| File | Lanes | Resolution |
|---|---|---|
| `postgres-integration/m2SubtypeIntegrity.pgtest.ts` | M3, M4, M5 | Each lane had rewritten the "later lanes stay closed" assertions for its own point in time. All four activation lists kept; a new `INTEGRATED_ACTIVATED_KINDS` union drives the installed-checker, leak and exact-activation assertions (previously only M2 kinds were checked as installed); "still pending"/fail-closed probes use `ASSESSMENT`, the only pre-registered kind no domain lane activates; all lanes' bounded-JSON allowlist entries kept; ordering pinned with `COLLATE "C"`. |
| `src/contracts/v2/repository/index.ts` | M3, M5 (M4 omitted itself) | Barrel exports M3 arrangement ports, M4 programme ports (never added by M4) and M5 knowledge ports. |
| `src/contracts/v2/repository/programmes.ts` | M4 vs M2 | `OptionalWindow` was an identical duplicate of `travel.ts`'s; now re-exported so the barrel has one symbol. |
| `postgres-integration/m2Seed.ts` (auto-merged) | M4, M5 | M4's real places (0061) and M5's evidence pool (0085) both retained. New `attachSeedSession` replaces three hand-built `SeedSession` literals (m2People/m2Travel/m4Geography) that lacked M5's evidence pool. Pool creation made set-based (3 statements, not 3×128). |
| `postgres-integration/m2People.pgtest.ts`, `m2Travel.pgtest.ts` (auto-merged) | M4, M5 | Follow-up seed sessions now use `attachSeedSession`. |
| `docs/work/ACTIVE_TASK.md` | M3 | Stale M3 cloud ledger preserved verbatim as `docs/work/M3_CLOUD_ACTIVE_TASK.md`; the path now holds the long-horizon ledger. `M3_ACTIVE_TASK.md`, `M4_ACTIVE_TASK.md`, `M5_ACTIVE_TASK.md` untouched. |

Repository implementations index (`src/persistence/postgres/repositories/index.ts`)
now exports every lane's classes (M3 had added only its own; M4/M5 none). Read
query classes have no barrel in any lane, so none was invented.

## 3. Migration chain

Proven from an **empty database** by `integrationCrossLane.pgtest.ts`
("0001-0087 apply in exact lane order"):

| Range | Owner | Applied |
|---|---|---|
| 0001–0009 | M1 | 0001–0009 |
| 0010–0029 | M2 | 0010–0029 |
| 0030–0049 | M3 | 0030–0049 |
| 0050–0069 | M4 | 0050–0062; **0063–0069 deliberately unused** (no filler) |
| 0070–0089 | M5 | 0070–0086 + integration closure **0087** |

Rerun on the migrated schema is a no-op (checksums unchanged).

## 4. Cross-lane FK reconciliation (`0087_cross_lane_fk_closure.sql`)

Found by a read-only audit then independently re-grepped (the audit missed the
M5→M4 and M3→M4 directions, which were added). Every row's target is the table
the source column's own lane schema/evidence already names; no ownership was
invented. All `DEFERRABLE INITIALLY DEFERRED`, workspace-leading composite.

| Direction | Columns closed | Source of deferral |
|---|---|---|
| M3 → M4 places | `transport_services.origin_place_id`, `.destination_place_id`, `resources.location_place_id`, `stay_line_details.place_id`, `resource_use_line_details.place_id`, `offer_items.place_id` | 0030/0031 comments; M3.md "place FKs not owned by M3" |
| M4 → M3 | `resource_assignments.resource_id` → `resources` | M4.md §15 (exact ALTER named) |
| M5 → M3 | `source_sync_state.external_connection_id` → `external_connections` | 0083 typed uuid + index |
| M5 → M4 | `objective_targets.place_id`, `rule_assignments.jurisdiction_id`, `regulatory_publications.jurisdiction_id`, `information_scopes.jurisdiction_id`, `information_scopes.area_version_id` | 0081/0082 comments; M5.md §3 |
| M3 → M5 evidence | `transport_services.{published,estimated,actual}_evidence_id`, `reservation_lines.observation_evidence_id`, `service_entitlements.observation_evidence_id`, `external_record_links.evidence_id`, `ownership_bindings.evidence_id`, `provider_capabilities.observation_evidence_id`, `budget_entries.evidence_id` | M3.md "M5 evidence ... remaining FKs" |
| M4 → M5 evidence | `area_versions.evidence_id`, `area_memberships.evidence_id` | 0051/0052 comments; M4.md §5 |
| M2 → M5 evidence | `authority_grants.evidence_id` | **Absent from M2.md §7A by omission**; same semantics as the eight M2 evidence citations 0085 closed |

Not FK candidates (verified): M3/M4 `source_id`/`source_ref` are `text`
external identifiers; polymorphic `(subject_id, subject_kind)` columns already
reference `domain_subjects (workspace_id, id, kind)`.

Seams that had to stay unenforced while isolated and are now proven:
**M3 Resource ↔ M4 ResourceAssignment**, **M4 geography ↔ M5 applicability**
(jurisdiction/area-version scopes, rule assignments, regulatory publications),
**M3 supplier state ↔ M5 evidence** (schedule/line/entitlement/link/capability
provenance).

Fixture consequence: lane fixtures that wrote placeholder UUIDs into these
columns now seed real rows (`m3Seed.ts` real places + evidence; `m4Seed.ts`
evidence; `m3Arrangements`/`m3IdentityMoney`/`m4Geography`/`m4Programmes`/
`m5Knowledge` tests use fixture places/evidence/jurisdictions/resources). No FK
was weakened to make a fixture pass.

## 5. Command-boundary reconciliation

- **M5 typed DB errors.** `knowledgeCommands.submitCommand` let a commit-time
  constraint violation escape as a raw driver error, unlike M2/M3/M4 which map
  `23503/23514/23502/23501/22P02/P0001 → VALIDATION_FAILED` and
  `23505 → DUPLICATE_REGISTRATION`. Now mapped identically; proven by the
  cross-workspace jurisdiction test.
- **G12** — see §6.

## 6. G12 closure

Decision (M2_INTEGRATION_DECISIONS.md): target PostgreSQL domain ids are UUIDs
at the persistence command boundary, before `UnitOfWork.execute`;
`SubjectIdSchema` is **not** narrowed.

- `travelCommands.ts` / `supportCommands.ts`: a local `PersistedId = z.uuid()`
  replaces `SubjectIdSchema` in every payload id field and in the ref/id gates.
  Ids nested inside frozen domain objects (JourneyItem place/participation/
  resource/service ids, IntendedVisit jurisdiction, support handoff travellers)
  are re-checked before execute. `addJourneyItem`, `addIntendedVisit` and
  `removeCredentialSelection` previously had no gate.
- Invalid id → typed `VALIDATION_FAILED`, **zero** `execute()` calls and no
  `command_receipts` row: `postgres-integration/g12UuidBoundary.pgtest.ts`
  (20 legacy-id rejections covering every exported travel/support command,
  proven by a spy UnitOfWork, plus 2 positive controls).
- Implemented by a delegated bounded task and reviewed line-by-line by the
  integrator before acceptance; behaviour for valid UUID input is unchanged
  (m2Travel/m2Support/m2People unchanged and green).

## 7. Subtype registry

All 37 activated kinds (M2 11, M3 11, M4 7, M5 8) coexist.
`postgres-integration/integrationSubtypeMatrix.pgtest.ts` proves, per kind:
valid registry+typed row commits; registry row without typed row fails at
COMMIT; a real typed row registered under a different activated kind fails;
a typed row in workspace A does not satisfy a same-id registration in
workspace B; plus 10 parent/owner FK redirection cases (JOURNEY, JOURNEY_ITEM,
PROGRAMME, PROGRAMME_ITEM, PARTICIPATION, RESERVATION_LINE, EXTERNAL_RECORD,
OWNERSHIP_BINDING, INFORMATION_VERSION). No kind under-enforces any property.
`m2SubtypeIntegrity.pgtest.ts` asserts the exact activated set and that
`ASSESSMENT` stays registered-but-unactivated (M6 owns it).

## 8. Verification (Checkpoint A)

Environment: PostgreSQL 16 + PostGIS 3.4 container `northstar-postgres-test`,
isolated fresh databases (`PGTEST_DB`), Node 24.15, Windows x64. No paid or
live provider call.

| Check | Command | Result |
|---|---|---|
| Canonical PostgreSQL suite (fresh DB) | `node --test --test-concurrency=1 --test-reporter=tap postgres-integration/*.pgtest.ts` (the `test:postgres` script plus a TAP reporter) | **345 tests, 54 suites, 345 pass, 0 fail** |
| Empty-DB migration order 0001–0087 | `integrationCrossLane.pgtest.ts` | PASS |
| Cross-lane FK proofs | `integrationCrossLane.pgtest.ts` | 9/9 |
| Subtype matrix | `integrationSubtypeMatrix.pgtest.ts` | 158/158 |
| G12 boundary | `g12UuidBoundary.pgtest.ts` | 22/22 |
| v2 contract + M2/M3 invariants | `node --test test/northstar-v2-*.test.ts` | 41/41 (was 39/41 — A-8) |
| Typecheck | `npm run typecheck` | clean |
| Build | `npm run build` | clean |
| Lint | `npm run lint` | clean |
| Anti-hardcoding | `npm run gate:anti-hardcoding` | VERDICT: CLEAN (257 files) |
| Legacy unit suite (regression only) | `npm test` | 889/890 — the one failure is pre-existing at base (A-10) |
| Runtime isolation | `git diff --stat 71f638e HEAD -- src/app src/engine src/operational src/providers src/server src/main.ts` | empty |

Remaining deliberate unknowns carried into M6: Traveller-payer home currency
(A-7); real entry/legal source licensing and interpretation (M5 Investigate
Now); scope generations are not yet propagated by M3/M4/M5 writes (M6 P2).

## 9. Findings and triage

| ID | Finding | Triage / disposition |
|---|---|---|
| A-1 | Cross-lane FKs (25) unenforced after isolated lanes | **Act Now** — closed by 0087 + proofs |
| A-2 | M5 commands threw raw driver errors on deferred constraint violations | **Act Now** — mapped to typed conflicts |
| A-3 | M4 ports/implementations missing from barrels | **Act Now** — exported |
| A-4 | `authority_grants.evidence_id` omitted from M2 §7A ledger | **Act Now** — closed in 0087, recorded here |
| A-5 | Intermittent file-level `node --test` failure with no subtest output (seen once each on `m2SubtypeIntegrity`, `migrate`; both pass on rerun and directly) | **Investigate Now** — canonical runs capture TAP + stderr; not reproduced in 3 targeted reruns |
| A-6 | Lane migration comments (0030/0081/0082) still say "no FK / deferred" | **Ignore / Accept Risk** — shipped migrations are checksummed; this document and 0087 are the record |
| A-7 | Traveller-payer home currency not authoritative (M3 gap) | **Park for Later** — carried to M6 as UNKNOWN/explicit input, not invented |
| A-8 | M3 made `ReservationAllocationSchema.reservationId` **required** — a non-additive change to a frozen C0 contract; the M0 contract acceptance suite (`test/northstar-v2-contracts.test.ts`) failed 2/21 on the M3 lane head itself and M3 evidence never ran it | **Act Now** — field made additive-optional (CONTRACTS.md §7); `PgArrangementRepositories.addReservationAllocation` refuses persistence without it; 0034 column stays NOT NULL; suite 41/41 |
| A-9 | `supportCommands.ts` let deferred-constraint violations escape raw (reachable since 0085 closed `accompaniment_requirements_provenance_fk`) | **Act Now** — typed mapping via a delegating UnitOfWork; proven by cross-lane test |
| A-10 | Legacy `test/integration.r1.test.ts` "runtime loop is deterministic" fails (wall-clock `observedAt` differs between runs) | **Park for Later** — fails identically at base `71f638e` with no legacy source changed by this integration; legacy SQLite runtime, retired at M11 |
