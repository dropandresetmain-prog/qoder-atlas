# M10 Phase 8 — runtime retirement inventory

## The claim being made

Normal NORTHSTAR runtime is **PostgreSQL only**. SQLite survives in exactly one role: **offline,
read-only migration input**. There is no compatibility runtime, no fallback and no demo runtime.

This is not an aspiration in a document — it is enforced structurally. `test/m10-runtime-purge.test.ts`
walks the real import graph from `src/main.ts` and fails if any listed SQLite module is reachable,
and `postgres-integration/m10RuntimePurgeBoot.pgtest.ts` boots the product with `SQLITE_PATH` unset.

## Disposition of every SQLite-touching module

A module is only allowed to exist in one of three states. "Still there, unclear" is not one of them.

| module | disposition | why |
| --- | --- | --- |
| `src/persistence/database.ts` | **Offline migration source only** | The legacy schema/DDL. Not opened by any runtime path; the exporter deliberately does *not* call `openDatabase` because opening it writes (WAL pragma, `CREATE TABLE IF NOT EXISTS`, `schema_meta` upsert). |
| `src/persistence/repositories.ts` | **Offline migration source only** | Legacy aggregate repositories. Replaced by the target repository/unit-of-work boundary. |
| `src/persistence/entityStore.ts` | **Offline migration source only** | Legacy context entities. Replaced by typed target ownership (people, geography, programme, arrangement tables). |
| `src/app/compose.ts` | **Retired from runtime** | The legacy composition root. `src/main.ts` composes `composeTargetBoot` only. |
| `src/app/runtime.ts` | **Retired from runtime** | Legacy aggregate-shaped runtime surface; not recreated in the target. |
| `src/engine/mutation.ts` | **Retired from runtime** | Legacy aggregate mutation. Replaced by the target command surface with expected-revision concurrency. |
| `src/app/dossierStore.ts` | **Migration source category** | Not a missing target capability. Dossier content migrates as `LEGACY_BOOKING_DOSSIER` evidence; contact/payment values are an owned exception pending a real protected-content store. |
| `src/app/preferenceStore.ts` | **Migration source category** | Target `preferences` already exists as a capability. Legacy rows migrate as `LEGACY_PREFERENCE` evidence because they carry no effective window. |
| `src/app/fxStore.ts` | **Migration source category** | No target FX table, and none is needed: rates are dated market observations, archived as `LEGACY_FX_RATE_OBSERVATION` and never used as a current conversion rate. |
| `src/app/eventInboxStore.ts` | **Migration source category** | Provider-shaped ingress already exists on PostgreSQL (`acceptProviderShapedDemoEvent` → `recordTransportObservation`). Legacy deliveries archive as `LEGACY_PROVIDER_EVENT_DELIVERY`; unprocessed ones keep `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME`. |
| `src/config/config.ts` (`sqlitePath`) | **Offline migration input only** | Still parsed, but no runtime path consumes it; the boot test runs with `SQLITE_PATH` unset. |
| `src/migration/legacySqliteSource.ts` | **Offline migration reader** | The only intentional SQLite reader. Opens with `readOnly: true`, so read-only is enforced by SQLite rather than by convention. |

None of these is left as "compatibility runtime".

## What the migration path may never become

Every migration module is in the purge test's forbidden list, so the exporter, importer,
reconciler, run store and recompute step are all structurally prevented from becoming reachable
from `src/main.ts`, `composeTargetBoot` or `composeTargetApplication`:

```
src/migration/legacySqliteSource.ts      src/migration/legacyImportContext.ts
src/migration/legacyCategories.ts        src/migration/legacyCategoryHandlers.ts
src/migration/legacyExporter.ts          src/migration/legacyImporter.ts
src/migration/migrationRunStore.ts       src/migration/recomputeMigratedState.ts
```

Adding a migration module without adding it to that list is the one way this could regress, which is
why the list is asserted rather than documented.

## Scope correction applied

Four legacy stores were **not** rebuilt as PostgreSQL subsystems: booking dossiers, preferences, FX
and the provider inbox. The question asked of each was "does the current target product require a
capability that is actually missing?", not "did this table exist?". In every case the answer was
that the data is a migration source category, and its destination is the exporter/importer mapping.
The legacy persistence architecture is not reproduced inside PostgreSQL.

## Verification

| evidence | what it proves |
| --- | --- |
| `test/m10-runtime-purge.test.ts` | no SQLite or migration module is reachable from `src/main.ts`, `composeTargetBoot` or `composeTargetApplication` |
| `postgres-integration/m10RuntimePurgeBoot.pgtest.ts` | the product boots against PostgreSQL with `SQLITE_PATH` unset |
| `test/m10-legacy-exporter.test.ts` | the exporter performs zero writes, and read-only is enforced by SQLite itself |
| `postgres-integration/m10LegacyMigration.pgtest.ts` | the migration path reaches PostgreSQL only through the normal command surface |
