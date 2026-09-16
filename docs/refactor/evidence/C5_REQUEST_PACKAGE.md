# C5 request package — M10 migration rehearsal

**This is a request for independent review, not a claim that C5 passed.** C5 is an
acceptance gate owned by a reviewer and an owner; this document assembles the evidence they need
and states plainly what is still outstanding.

**No production cutover has occurred.** Everything below was rehearsed against throwaway fixtures in
isolated environments.

## 1. Candidate identity

| | |
| --- | --- |
| Branch | `milestone-m10-migration-rehearsal` |
| Candidate | tag **`m10-candidate`** |
| Accepted M9/C4 base | `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` |

The candidate is identified by an annotated tag rather than a SHA written into this file, because a
document cannot contain the hash of the commit that contains it. Resolve it with
`git rev-parse m10-candidate`; the tag is pushed alongside the branch and is what every result below
was produced against.

## 2. Tooling versions

| component | version | module |
| --- | --- | --- |
| Exporter | `northstar-legacy-exporter/1.1.0` | `src/migration/legacyExporter.ts` |
| Importer | `northstar-legacy-importer/1.0.0` | `src/migration/legacyImporter.ts` |
| Reconciler | `northstar-migration-reconciler/1.0.0` | `src/migration/reconcileMigration.ts` |

`1.1.0` of the exporter added `sourceTimestamp` to each record so archived history is asserted at
the instant it actually happened rather than at import wall-clock.

## 3. Dataset identity

The rehearsal dataset is a throwaway fixture, never a deployment name.

| | |
| --- | --- |
| Source identity | `legacy-deployment-m10-restore-rehearsal` |
| Dataset hash | `5da1d341b6067123ddebfaee1347599f0efaa1396a1776cb04be8fe844820c18` |
| Export cutoff | `2026-03-01T00:00:00Z` |

The hash is deterministic: re-exporting the same frozen source produces the same hash, and the same
hash produces the same target ids, which is what makes a re-import a replay rather than a second
divergent world.

## 4. Reconciliation

Full report: `docs/refactor/evidence/m10-reconciliation-report.md` (machine-readable sibling
`.json`). Nine semantic checks, all PASS:

`IDENTITY_ACCOUNTED`, `JOURNEY_OWNERSHIP_PROVEN`, `PROVIDER_REFS_PRESERVED`,
`EVIDENCE_LINEAGE_INTACT`, `OBLIGATIONS_COMPLETE`, `UNCERTAINTY_PRESERVED`, `MONEY_ACCOUNTED`,
`DERIVED_TRUTH_RECOMPUTED`, `NO_PROVIDER_DISPATCH`.

Report verdict is **BLOCKED**, which is the correct answer while a multi-traveller trip remains
unallocated. Blocked does not mean broken: it means one scope is held back and named.

## 5. Unresolved exceptions and owners

Full detail in `docs/refactor/evidence/M10_ROLLBACK_AND_CUTOVER.md` §activation blockers.

| classification | owner | blocks cutover for its scope |
| --- | --- | --- |
| `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` | migration owner | yes |
| `ARCHIVED_NOT_REPLAYED_AS_LIVE_STATE` (open recovery cases) | operations owner | yes |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` (explicit preferences) | migration owner | yes |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` (rule sets) | policy owner | yes |
| `QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING` (engagements, unmapped constraints) | migration owner | engagements yes; unmapped constraint no |
| `ARCHIVED_REQUIRES_PROTECTED_CONTENT_STORE` (dossier PII) | data protection owner | no |
| `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` | operations owner | no |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` (latent preferences) | migration owner | no |

None of these is a migration defect. Each is a place where the legacy data does not contain what the
target needs, and the migration's job was to say so precisely rather than guess.

## 6. Uncertain-operation disposition

Nothing unknown was resolved by migrating it.

- Legacy `reservationState: CHANGED` — the supplier had moved a booking and the legacy runtime never
  reconciled it — migrates as target **UNKNOWN**, never CONFIRMED and never CANCELLED, with the real
  legacy value archived as evidence and a `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` exception raised.
- A provider delivery the legacy inbox never finished processing keeps its unknown outcome.
- The target refuses a known reservation-line status without observation evidence; migrated known
  statuses cite the migration evidence explicitly, so nothing claims an observation that did not
  happen.

## 7. Backup / restore evidence

`docs/refactor/evidence/M10_BACKUP_RESTORE.md`, raw transcript in
`m10-backup-restore-output.txt`. Run by `scripts/m10-cutover-and-restore-rehearsal.mjs` against an
isolated, **volume-backed** instance — deliberately not the shared tmpfs test database, since
restoring into a RAM-backed non-durable data directory would prove nothing.

10/10 checks PASS, including that the instance really is volume-backed, that the database is
genuinely destroyed before restore, that every `legacy_id_map` tuple and the migration run identity
survive, and that the append-only trigger is restored with the data rather than just the rows.

## 8. Runtime retirement evidence

`docs/refactor/evidence/M10_RUNTIME_RETIREMENT.md`. Every SQLite-touching module has exactly one
disposition: retired, replaced by target capability, or offline migration-only. No unresolved
compatibility runtime remains. Enforced by `test/m10-runtime-purge.test.ts` (import-graph walk from
the real `src/main.ts`) and `postgres-integration/m10RuntimePurgeBoot.pgtest.ts` (boot with
`SQLITE_PATH` unset).

## 9. Target PostgreSQL regression evidence

| check | result |
| --- | --- |
| `postgres-integration/m9SarahTargetE2E.pgtest.ts` | PASS |
| `postgres-integration/m9JordanMultiActionRecovery.pgtest.ts` | PASS |
| `postgres-integration/m9JordanReplacementFlightViability.pgtest.ts` | PASS |
| `postgres-integration/m10LegacyMigration.pgtest.ts` | 7/7 PASS |
| `test/m10-legacy-exporter.test.ts` + `test/m10-runtime-purge.test.ts` | 10/10 PASS |
| `npm run test:postgres` on a **fresh** database | **468/468 PASS** |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| `npm run lint` | clean |
| `npm run gate:anti-hardcoding` | CLEAN |

Sarah and Jordan were not modified to accommodate migration tooling; they remain independent
target-runtime regression evidence.

## 10. Cutover steps and rollback boundaries

`docs/refactor/evidence/M10_ROLLBACK_AND_CUTOVER.md` holds the nine-step M11 runbook with a stop
gate on each step, and the rollback model built around the single boundary that governs it:

- **Zone A**, before the target's first externally consequential action: rollback to the legacy
  runtime is safe, and re-import is deterministic.
- **Zone B**, after external provider effects: rollback to the legacy runtime is **not available**.
  Restoring an older database cannot retract a supplier-side change; it would produce a NORTHSTAR
  that is confidently wrong about the world. Forward-recovery on the target is the only honest path.

The boundary is observable rather than a judgement call: Zone B begins at the first
`execution_attempts` row, which is exactly what the `NO_PROVIDER_DISPATCH` check reports.

## 11. Suite behaviour on an accumulated database, disclosed rather than hidden

The gate above was run on a freshly created `northstar_test` database and is 468/468.

Two earlier runs against the *shared, accumulated* test database each failed one test, and a
different one each time: `m3IdentityMoney.pgtest.ts` on the first, `m2Travel.pgtest.ts` on the
second. Both pass on a fresh database. The `m2Travel` failure is diagnostic of the cause — it
asserts that a specific query uses a specific index, and on an accumulated database the planner
chose a *different* index (still no sequential scan) because table statistics had shifted.

So this is a property of running the suite against a database that other worktrees have been filling
for hours, not a regression and not the carried `PG-ASSESS-SERIAL` concurrency risk. The exit gate
correctly requires a fresh database. A reviewer running against a reused database should expect
plan-sensitive assertions to be unreliable and should recreate the database first.

## 12. What a reviewer should probe

Three judgement calls deserve independent scrutiny more than the code does:

1. **Revising two frozen category decisions.** `RECOVERY_CASE` moved to `ARCHIVE_AND_REGENERATE` and
   `SIGNAL` to `ARCHIVE_AS_IMMUTABLE_HISTORY`, both on the evidence that the target has no authoring
   command because that state is derived, not authored. Is archiving an open case with a
   cutover-blocking exception the right call versus fabricating a case row?
2. **Preferences and rule sets archived rather than activated.** The target requires an input the
   legacy row never held. Is "preserve as evidence and make an owner supply the input" right, or
   should a default policy be agreed now?
3. **Provider references preserved but not correlated.** Binding them as target external identity
   needs the M3 external-identity resolution seam. Is deferring that acceptable for the M10
   candidate?
