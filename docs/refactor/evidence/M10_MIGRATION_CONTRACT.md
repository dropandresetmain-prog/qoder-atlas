# M10 Migration Contract — frozen before broad implementation

Per `docs/IMPLEMENTATION_PLAN.md` §14 Phase 7 ("freeze the M10 migration
contract and acceptance criteria before implementing broad changes"). This
records what M10's exporter/importer/reconciliation work must do, based on
direct inspection of the actual legacy stores and target schema (not
inference), before Phases 3-10 are implemented.

## What already exists (verified, not assumed)

- `legacy_id_map` / `migration_runs` tables: **already materialized**,
  migration `0009_migration_infrastructure.sql` (M1, reserved range
  0001-0009). Schema matches `DATA_STRUCTURE_LOGICAL_SCHEMA.md` §8 exactly.
  `legacy_id_map` is append-only (`legacy_id_map_immutable` trigger).
  `migration_runs` has `status IN ('IN_PROGRESS','COMPLETED','FAILED')`,
  `progress`/`validations`/`reconciliation_exceptions` jsonb columns. **Zero
  rows have ever been written to either table** — this is schema only.
- `src/contracts/v2/migration/migrationEnvelope.ts`: zod schemas for
  `MigrationEnvelope`, `LegacyIdMapEntry`, and `migrationImportOutcome()`
  (pure function: NEW / IDEMPOTENT_REPLAY / CONFLICT_REQUIRES_RECONCILIATION
  by comparing source hash). Types only — nothing calls this yet.
- No exporter, importer, reconciliation tool, backup/restore automation, or
  AT23 integration-test coverage exists anywhere in the repo. One pure-unit
  test (`test/northstar-v2-contracts.test.ts`) exercises
  `migrationImportOutcome` in isolation.
- `src/persistence/postgres/migrate.ts` (the DDL schema-migration runner,
  not a data importer) is a useful **pattern reference** for
  idempotent/resumable execution and checksum-drift detection — reuse its
  shape for the data importer's own resume logic, not its code.

## Category decisions (frozen)

Per `docs/IMPLEMENTATION_PLAN.md` §16 migration decision matrix, applied to
the actual legacy stores this repo has (`docs/refactor/MIGRATION_MAPPING.md`
§1-§2):

| Legacy store | Decision | Target destination | Status |
|---|---|---|---|
| `entities.TRAVELLER` + `booking_dossiers` | MIGRATE_TRANSFORM | `travellers`/`traveller_names`/`traveller_contacts`/`profile_assertions`/`travel_credentials` (0012-0015) | Schema ready. **Importer must mint `ProtectedDataRef` triples** (content hash + storage ref + access policy id) for every contact/credential value — these columns are `NOT NULL` with no plaintext fallback. This is a build task, not a design gap. |
| `trips.data` (single-traveller) | MIGRATE_THEN_RECONCILE | `trips` (0020) + one `journeys` row (0021) | Deterministic — safe to automate. |
| `trips.data` (multi-traveller) | **INVESTIGATE_THEN_TRANSFORM — quarantine, do not guess** | `journeys`/`journey_items` (0021-0023) once allocation is known | **Confirmed unresolved**: `TripElementBaseSchema` carries no `travellerId` field, explicit or implicit, and `Stay.guests` is a bare headcount. The target schema can express correct per-element ownership once told, but legacy data supplies zero signal. Every multi-traveller trip's elements go to `migration_runs.reconciliation_exceptions`, never an inferred split. |
| `entities.CONSTRAINT` (`Constraint.status`) | ARCHIVE_AS_IMMUTABLE_HISTORY | New `assessment_kind` value (e.g. `LEGACY`) or a distinct legacy-evidence table | **Not yet wired**: `assessments`/`assessment_results` (0091) structurally forbid status-on-definition (good) but require `explanations`/`evaluated_at`/`created_by_actor_id` `NOT NULL` with real evaluator provenance legacy data won't have. Needs an explicit M10 decision: add a `LEGACY` assessment kind with synthesized/nullable-explanation handling, or a separate legacy-evidence table. **Open — do not build against `assessments` until this is decided.** |
| `entities.ORGANISATION` | MIGRATE_TRANSFORM | `organisations` | Direct fit, schema ready. |
| `signals.data` | MIGRATE_TRANSFORM | `change_signals`/`signal_subjects` | Not yet inspected against current schema — verify before building. |
| `cases.data` (`RecoveryCase`) | MIGRATE_THEN_RECONCILE | `recovery_cases` family (0100-0102) | Single case-wide approval envelope must project into per-intent `approvals` — a semantics decision, not a column rename (per MIGRATION_MAPPING.md §2). Not yet re-verified against the M7/M8-landed schema. |
| `audit` | ARCHIVE_AS_IMMUTABLE_HISTORY | `change_records` (0005) | Migrate as legacy evidence citing `legacy_id_map`; never back-fill `before_revision` values that never existed. |
| Derived/cached status (any store) | RECOMPUTE_DISCARD_CACHE_ROLE | `assessments` (0091), recomputed via real M6 evaluators only | Never migrate a legacy verdict as current truth. |

Unvisited stores (`sources`/`source_contents`, `provider_event_inbox`,
`fx_rates`, `preferences`) have a mapping recorded in
`docs/refactor/MIGRATION_MAPPING.md` §2 but were not re-verified against the
current (post-M5/M8) schema in this pass — do that before building their
importers.

## Evidence/provenance requirement (discovered, not previously documented)

Every M2 write command that creates durable state requires a real
`evidenceId` citing an existing `source_records`/evidence row (FK-enforced).
The importer cannot call `recordTraveller`/`createTrip`/etc. with a bare
migration marker string — it must first write a real evidence record (owned
by M5's `knowledgeCommands.ts` / `source_records` table, 0070-0071) whose
content documents "migrated from legacy dataset `<hash>`, run `<migration_runs.id>`,
source id `<legacy id>`", and cite that evidence row's id. This evidence
chain is what `legacy_id_map.mapping_evidence` and the migration decision
matrix's "preserve source/evidence lineage" requirement are pointing at —
it is not optional scaffolding.

## Build plan for Phases 3-10 (next session's starting point)

1. **`src/migration/legacyExporter.ts`** — read-only over
   `SqliteTripRepository`/`SqliteEntityStore`/`SqliteSourceRepository`
   (existing legacy read APIs, already safe to call). Deterministic JSON
   bundle: dataset identity, export cutoff, source hash (canonical
   sort+hash), full record set grouped by category above. No provider
   dispatch (trivially true — these are pure DB reads).
2. **`src/migration/legacyEvidence.ts`** — one shared helper that writes the
   "migrated from legacy dataset" evidence row once per `migration_runs`
   entry, returns its id for every subsequent command in that run to cite.
3. **`src/migration/legacyImporter.ts`** — for each record: look up
   `legacy_id_map` by `(source_dataset, source_type, source_id)`; if absent,
   apply the category decision above (single-traveller trip → real command
   call; multi-traveller trip → `migration_runs.reconciliation_exceptions`
   row, no command call); if present, compare hash via
   `migrationImportOutcome()` — `IDEMPOTENT_REPLAY` short-circuits,
   `CONFLICT_REQUIRES_RECONCILIATION` is a typed error, never a silent
   overwrite. Track progress in `migration_runs.progress` so a crash mid-run
   can resume from the last completed record rather than restart.
4. **Reconciliation report** — machine-readable (JSON matching
   `migration_runs.reconciliation_exceptions` shape) + a human-readable
   Markdown render, per `docs/IMPLEMENTATION_PLAN.md` §14's reconciliation
   checklist (identity, Trips/Journeys, provider refs, money, evidence
   lineage, quarantined records — not just row counts).
5. **Recompute step** — after import, for every migrated Journey, run the
   real M6 evaluator path (same one `composeTargetApplication` uses) to
   produce a fresh `CURRENT` assessment. Assert no legacy status ever lands
   directly in `assessments`.
6. **Interrupt/resume + restore drill** — kill the importer mid-run (a test
   harness concern: inject a failure after N records, assert `migration_runs`
   is `IN_PROGRESS` with correct `progress`, then resume and assert exactly
   the remaining records import, no duplicates). Restore drill: `pg_dump`
   the isolated candidate DB, drop/recreate, `pg_restore`, verify record
   counts + one recomputed assessment survive. `docker-compose.postgres-test.yml`
   uses `tmpfs` (deliberately non-durable) — the restore drill needs its own
   throwaway container or volume-backed instance, not the shared test
   container other worktrees rely on.
7. **Legacy retirement inventory** — the legacy-writer inventory already
   produced this session (file:line list of every SQLite write path,
   classified) is the starting input; turn it into the actual M10 Phase 8
   deliverable (disposition table + which routes get disabled).
8. **Cutover rehearsal + rollback runbook** — Phases 9-10, sequenced after
   1-7 land and pass their own focused tests.

## Acceptance criteria per phase (do not relax)

- No provider dispatch anywhere in export/import.
- Same dataset + same hash, re-imported: zero new rows, `IDEMPOTENT_REPLAY`.
- Same dataset identity + different hash: typed conflict, zero rows written
  for that record, nothing silently overwritten.
- Multi-traveller trip elements: always quarantined, never guessed.
- Derived assessments: never migrated as current; always recomputed via the
  real evaluator after import.
- Every migration exception carries classification + reason + affected scope
  + safety impact + owner/decision + cutover-blocking flag (per §14's
  reconciliation checklist) — not just a row count delta.
