# M10 / C5 — backup + restore rehearsal

## What this proves

A migrated PostgreSQL target survives `pg_dump`, a genuine destruction of the database, and
`pg_restore` **with its migration identity intact** — not merely "rows came back". The dataset under
test is produced by the repo's real tooling, so the rehearsal exercises what a cutover would actually
restore:

- `runMigrations` (`src/persistence/postgres/migrate.ts`) builds the schema from
  `src/persistence/postgres/migrations/` — 93 migrations on the head used below;
- `exportLegacyDataset` reads a throwaway legacy SQLite fixture (one single-traveller trip that
  migrates deterministically, one multi-traveller trip whose element ownership is unprovable);
- `importLegacyBundle` writes target state, mappings, evidence and the quarantine;
- `recomputeMigratedState` derives a CURRENT assessment through the real M6 evaluator.

No target row is hand-written, because a hand-written row proves nothing about the migration.

## How to run it

```powershell
node scripts/m10-cutover-and-restore-rehearsal.mjs       # exits 0 on pass, 1 on any failed check
$env:M10_KEEP_RESTORE_ENV = '1'                          # leave the container+volume up afterwards
$env:M10_RESTORE_PORT = '55434'                          # if 55433 is taken
```

One script covers both Phase 9 (cutover rehearsal) and Phase 7 (backup/restore) because both need
the same isolated, freshly migrated target. That is why **there is exactly one final rehearsal
dataset**, not one per phase: the cutover sequence and the restore proof run against the same
imported state in a single pass.

Requires Docker. Takes ~60s. Output goes to stdout and to
`docs/refactor/evidence/m10-backup-restore-output.txt`. The container and its named volume are
removed in a `finally` block even on failure unless `M10_KEEP_RESTORE_ENV=1`.

## Why not the shared test container

`docker-compose.postgres-test.yml` (`northstar-postgres-test`, port 55432) mounts `tmpfs` over
`/var/lib/postgresql/data`. Restoring into a RAM-backed, deliberately non-durable data directory is
not restore evidence, and other worktrees run `npm run test:postgres` against that container
concurrently. So the script stands up its own instance — container
`northstar-postgres-m10-restore`, port 55433, database/user `northstar_m10_restore`, backed by the
named docker volume `northstar-m10-restore-data` — and points the repo's own config at it via
`PG_TARGET_*` (the tier `src/persistence/postgres/config.ts` reads first, so an operator's existing
`PGTEST_*` cannot drag the run back onto the shared box). The shared container is never touched.
Readiness uses the `postgres-integration/harness.ts` approach: a throwaway client per attempt and two
consecutive successes ~1s apart, because the postgis image's init-time temporary server can answer a
single ping before the real server is up.

## What each check verifies

| check | verifies |
| --- | --- |
| `isolated_instance_is_volume_backed` | the data directory really is the named volume, not tmpfs — otherwise a PASS would prove nothing |
| `target_database_destroyed_before_restore` | `legacy_id_map`/`migration_runs` are genuinely gone and `public` holds 0 tables, so the restore lands in an empty target |
| `pg_restore_completed_without_error` | `pg_restore --exit-on-error` exited 0 |
| `legacy_id_map_mappings_survive_identically` | every `(source_dataset, source_type, source_id, target_kind, target_id)` tuple is identical — the idempotency keys a re-import depends on |
| `migration_run_identity_survives` | same run id, `dataset_hash`, exporter/importer versions, status, and a `reconciliation_exceptions` array of the same length whose *classification + fact binding + reservation-line disposition* triples are identical. The binding is compared because blocker 3 is a binding: an element-scoped finding is only traceable to its fact if `factSourceId` survives the restore. The disposition is compared because blocker 4 is a claim: `holdsBackReservationLine` says whether that finding explains the fact's **absent** reservation line, and a binding restored with its meaning stripped off would otherwise still compare equal. Record-level findings render as `(record-level)` and findings that make no claim as `#(no-line-claim)`, so neither a dropped binding nor a dropped disposition can masquerade as the real thing |
| `imported_domain_state_row_counts_survive` | `organisations`, `travellers`, `trips`, `journeys`, `constraint_definitions`, `evidence_records`, `source_records` counts match pre-backup |
| `recomputed_assessment_survives` | the `assessments` count matches and one specific recomputed assessment id is present |
| `append_only_trigger_survives` | `pg_trigger` still carries `legacy_id_map_immutable` on `legacy_id_map`, so append-only enforcement is restored with the data, not just the rows |

## Observed result

Run on branch `milestone-m10-migration-rehearsal` at the blocker-4 remediation candidate
(`m10-candidate-c5-remediation-4`). Raw transcript: `m10-backup-restore-output.txt`. The previous
candidate (`m10-candidate-c5-remediation-3`) failed C5 re-review and is recorded in
`C5_REQUEST_PACKAGE.md` §12 Blocker 4; its rehearsal run `c06305bc-204c-4e81-985d-764fab26a5be` is
superseded by the one below.

| | |
| --- | --- |
| Dataset identity | `legacy-deployment-m10-restore-rehearsal` |
| Dataset hash | `6ebf05ce47554d8929a793d64882828d0cee895158ebb72047380827f528002d` |
| Migration run | `9b6e6cb1-b3d7-42fb-b373-bd07c574b9a8`, status `COMPLETED` |
| Tooling | exporter `1.1.0`, importer `1.0.0`, reconciler `1.0.0` |
| Import outcome | imported 10, quarantined 1, deferred 0, exceptions 2 |
| Reconciliation | 9/9 semantic checks PASS; report verdict `BLOCKED` solely because the accepted `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` blocks its own scope |
| Pre-backup state | 11 `legacy_id_map` mappings; organisations 1, travellers 3, trips 1, journeys 1, constraint_definitions 1, evidence_records 5, source_records 2, assessments 1 |

The hash and the pre-backup row counts are unchanged from the previous candidate: this fix changed
the exception schema, which paths declare a hold-back, and how a missing line is judged, so it moved
no fixture row and no migrated row. The run id is new because the import genuinely ran again.

The organisation migrated with `default_currency_code = SGD`, mapped from the fixture's explicit
legacy `homeCurrency` rather than defaulted — that is the C5 blocker-1 fix visible in the rehearsal.
After the restore the two exceptions read
`PRESERVED_UNKNOWN_EXTERNAL_OUTCOME=trip-single:el-single-return#(no-line-claim)` and
`QUARANTINED_MULTI_TRAVELLER_ALLOCATION=(record-level)#(no-line-claim)`, so each element-level binding
survives with its classification **and** its disposition. The asymmetry is deliberate: the `CHANGED`
element's finding names one fact and says nothing about its line (the line exists, and that finding
is evidence of it), while the multi-traveller quarantine is a finding about the whole trip and would
be dishonest to stamp with an element identity the importer never examined. Only the second blocks
cutover.

**What this run does and does not prove about the disposition.** Every fact-bound finding this
fixture produces is either a preserved `UNKNOWN` or a record-level quarantine, so both render
`#(no-line-claim)` and the rehearsal never writes a `true` disposition — by construction, because the
canonical fixture contains no element held back before its line. What the rehearsal proves is that
the compared key now includes the disposition, so a finding that gained or lost one across the dump
would fail `migration_run_identity_survives`. That a `true` disposition is stored and read back
intact through JSONB is proven where such a path exists: the migration pgtest asserts
`holdsBackReservationLine === true` on the exception returned by `readMigrationRun`, not merely on
the object the importer handed back.

```
VERDICT: PASS — 10/10 checks passed; migrated target state survived backup, destruction and restore
```

All ten: `isolated_instance_is_volume_backed`, `reconciliation_semantic_checks_pass`,
`every_exception_is_owned`, `target_database_destroyed_before_restore`,
`pg_restore_completed_without_error`, `legacy_id_map_mappings_survive_identically`,
`migration_run_identity_survives`, `imported_domain_state_row_counts_survive`,
`recomputed_assessment_survives`, `append_only_trigger_survives`.

### Superseded runs, recorded so the hashes are not confused

Three earlier runs of this rehearsal exist in the history and are **not** the final evidence:

- At `ed99079` (before Phase 5) the run recorded `recordsDeferred=1` with no reconciliation
  exception naming it — a counter said something was skipped without saying what, which from the
  restored state is indistinguishable from data loss. Both halves are now closed: Phase 5 registered
  handlers for every exported category, and a record with no handler now raises a
  `DEFERRED_NO_HANDLER` exception rather than only incrementing a counter.
- At `edfe0fc` (Phase 5 head) the run covered backup/restore only, over a smaller fixture: 9
  mappings and dataset hash `5da1d341b6067123ddebfaee1347599f0efaa1396a1776cb04be8fe844820c18`.
  That hash is **obsolete**. It changed because the script was later extended to also rehearse the
  cutover sequence, which required enriching the fixture with places and a booked transport leg so
  the reconciliation checks were not vacuous.
- At `1d81dd7`/`eff19a9` the combined run produced dataset hash `3077f43e…` with 1 exception. Also
  **obsolete**: the C5 remediation changed the fixture twice — the organisation gained an explicit
  `homeCurrency` so the rehearsal proves real currency mapping rather than a fabricated `USD`
  default, and the single-traveller trip gained a `CHANGED` element so `UNCERTAINTY_PRESERVED` has
  real uncertainty to verify instead of passing over an empty set.

A different fixture is a different dataset and therefore a different hash — by design, since the
hash is the dataset's identity, not the tooling's. Determinism was separately demonstrated when the
importer changed between `0c5015a` and `1d81dd7` and the hash did **not** move, because the fixture
had not.

The **run uuid is not a dataset identity**, and reviewers comparing transcripts should not read it as
one. Every execution of this rehearsal creates a new migration run, so the canonical hash above has
already appeared under `18953aa8…` (at `m10-candidate-c5-remediation-2`) and under `0cc316b1…` (this
candidate's first execution, before `migration_run_identity_survives` was extended to compare fact
bindings). Neither is a different dataset, and neither is the final evidence: the run id in the table
above is the one this page documents.
