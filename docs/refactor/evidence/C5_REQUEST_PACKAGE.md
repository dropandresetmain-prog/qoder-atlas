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
| **Candidate under review** | tag **`m10-candidate-final`** |
| Accepted M9/C4 base | `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` |

The candidate is identified by an annotated tag rather than a SHA written into this file, because a
document cannot contain the hash of the commit that contains it. Resolve it with
`git rev-list -n 1 m10-candidate-final` (`git rev-parse` on an annotated tag returns the tag object,
not the commit).

Two tags exist deliberately, and only one of them is under review:

| tag | what it marks |
| --- | --- |
| `m10-candidate` | `1d81dd7` — implementation-complete. Published earlier; left where it is rather than moved, so earlier references stay honest. |
| **`m10-candidate-final`** | **the commit under review** — `m10-candidate` plus a documentation-only evidence-consistency pass. No runtime or migration behaviour differs between the two. |

The evidence-consistency pass changed documentation only. Everything executable below was produced
at `1d81dd7`, which is the parent content of the final candidate — so a reviewer can verify either
tag and get the same runtime behaviour. `git diff m10-candidate m10-candidate-final --stat` shows
`docs/` only, and that is the claim to check first.

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

**There is exactly one final rehearsal dataset.** The cutover rehearsal (Phase 9) and the
backup/restore rehearsal (Phase 7) are the same run of
`scripts/m10-cutover-and-restore-rehearsal.mjs`, because both need the same isolated, freshly
migrated target. So one dataset and one hash cover both.

| | |
| --- | --- |
| Source identity | `legacy-deployment-m10-restore-rehearsal` |
| **Dataset hash** | **`3077f43e0d05f2c622b952a5227a7547ab0366427c85e6961273514d279a1596`** |
| Export cutoff | `2026-03-01T00:00:00Z` |
| Migration run | `d5d72775-8b49-4157-8809-868cd8e6b298` |
| Produced at | the final candidate, 2026-09-16T12:35Z |

The hash is deterministic: re-exporting the same frozen source produces the same hash, and the same
hash produces the same target ids, which is what makes a re-import a replay rather than a second
divergent world. This was demonstrated across a tooling change — the importer changed between
`0c5015a` and `1d81dd7`, and re-running the rehearsal reproduced `3077f43e…` unchanged, because the
hash identifies the source dataset rather than the tool that reads it.

### One superseded hash, named so it cannot be confused

An earlier version of this document cited
`5da1d341b6067123ddebfaee1347599f0efaa1396a1776cb04be8fe844820c18`. **That hash is obsolete and
describes no current evidence.** It came from a backup/restore-only run at `edfe0fc` over a smaller
fixture (9 mappings). When the script was extended to also rehearse the cutover sequence, the
fixture had to gain places and a booked transport leg so the reconciliation checks were not vacuous
— a different fixture is a different dataset and therefore a different hash. Detail in
`M10_BACKUP_RESTORE.md` §superseded runs. Nothing in the current evidence set refers to
`5da1d341…` as live.

## 4. Reconciliation

Full report: `docs/refactor/evidence/m10-reconciliation-report.md` (machine-readable sibling
`.json`). Nine semantic checks, all PASS:

`IDENTITY_ACCOUNTED`, `JOURNEY_OWNERSHIP_PROVEN`, `PROVIDER_REFS_PRESERVED`,
`EVIDENCE_LINEAGE_INTACT`, `OBLIGATIONS_COMPLETE`, `UNCERTAINTY_PRESERVED`, `MONEY_ACCOUNTED`,
`DERIVED_TRUTH_RECOMPUTED`, `NO_PROVIDER_DISPATCH`.

Report verdict is **BLOCKED**, which is the correct answer while a multi-traveller trip remains
unallocated. Blocked does not mean broken: it means one scope is held back and named.

### What "11 exported / 11 mappings" does and does not mean

The report totals read `exportedRecords: 11, mappedRecords: 11`. **These are two different
elevens, and the coincidence is misleading — do not read it as "all 11 source records became live
target entities."** The semantic requirement is that every source record is *accounted for without
silent loss*, not that every source record became an active target entity.

The 11 exported records break down by disposition:

| disposition | count | what it means |
| --- | --- | --- |
| Transformed into active target domain state | 9 | organisation 1, travellers 3, places 2, trip 1, constraint 1, source record 1 |
| Archived as immutable historical evidence | 1 | the audit entry — preserved as an evidence record, deliberately not replayed as live state |
| Quarantined, represented only by a reconciliation exception | 1 | the multi-traveller trip, whose element ownership is unprovable |

The 11 `legacy_id_map` rows are counted differently again:

- 9 rows for the records that became live state;
- 1 row for the archived audit entry, keyed to the evidence record it became (`target_kind`
  `EVIDENCE_RECORD`), so a replay recognises it rather than re-archiving it;
- 1 synthetic row under derived source type `trips.journey`. The legacy model had **no Journey
  concept**, so the migrated Journey's only source identity is the legacy Trip id, and constraints
  and cases need to resolve it later.

The **quarantined trip has no mapping row at all** — only an owned exception. So "mapped" in the
totals means *accounted for*, spanning transformed state, archived evidence and quarantine
representation. The check that actually matters is `IDENTITY_ACCOUNTED`, which asserts every
exported record is either represented in the target or named in an exception; it reads PASS at
11/11 with nothing silently dropped.

## 5. Exceptions — observed, versus policies that may apply at M11

These are two different things and an earlier version of this document ran them together. A reviewer
should not have to infer which is which.

### 5A. Observed in the final rehearsal — exactly one

This is the complete list of what `m10-reconciliation-report.{md,json}` actually produced against
the final dataset. One exception, one activation blocker, nothing else:

| | |
| --- | --- |
| Classification | `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` |
| Source | `trips/trip-multi` |
| Reason | the legacy trip carries 2 travellers and 2 elements; `TripElement` has no `travellerId` and `Stay.guests` is a bare headcount, so element → Journey ownership cannot be proven from source evidence |
| Affected scope | trip `trip-multi`, travellers `[trav-multi-a, trav-multi-b]`, 2 elements |
| Safety impact | guessing allocation would attribute flights and stays to the wrong person, and recovery would then act on the wrong traveller; the source data is preserved unmigrated instead |
| Owner | migration owner |
| Blocks cutover | yes, for that scope only |

Three further facts about the final dataset, stated because their absence is itself evidence:
**zero** uncertain external outcomes occurred, **zero** legacy FX observations were present, and
**no** priced, held or settled budget commitment existed to migrate.

### 5B. Category policies that did not apply to this dataset

Each row below is a **decided policy** for a category, proven to work by
`postgres-integration/m10LegacyMigration.pgtest.ts` (7/7 PASS) against a deliberately richer
fixture. **None of them fired in the final rehearsal**, because the final dataset contains no rows
in those categories — the coverage table in the report shows `exported: 0` for each.

So these are neither observed exceptions nor speculation. They are the conditions that would hold
back a scope *if the real final export contains such rows*, and each needs an owner decision at M11
rather than more engineering.

| classification | category | owner | would block its scope |
| --- | --- | --- | --- |
| `ARCHIVED_NOT_REPLAYED_AS_LIVE_STATE` | open recovery cases | operations owner | yes |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` | explicit preferences | migration owner | yes |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` | rule sets | policy owner | yes |
| `QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING` | ambiguous engagements | migration owner | yes |
| `QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING` | constraints with no registered target expression | migration owner | no |
| `ARCHIVED_REQUIRES_PROTECTED_CONTENT_STORE` | protected dossier content (contact, payment) | data protection owner | no |
| `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` | uncertain provider outcomes | operations owner | no |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` | latent (inferred) preferences | migration owner | no |
| `DEFERRED_NO_HANDLER` | any category with no registered handler | migration owner | yes |

None of these is a migration defect. Each is a place where the legacy data does not contain what the
target needs, and the migration's job was to say so precisely rather than guess. The M11 runbook
gates on `recordsDeferred == 0`, so a category arriving with no handler stops the cutover instead of
passing quietly.

## 6. Uncertain-operation disposition

Nothing unknown was resolved by migrating it.

**In the final rehearsal dataset there were no uncertain external operations** — `UNCERTAINTY_PRESERVED`
reports `0 reservation line(s) remain UNKNOWN; 0 uncertain external outcome(s)`. There was nothing
uncertain to mishandle, which is a weaker statement than the behaviour being proven, so the proof
comes from the integration test rather than from this rehearsal.

The behaviour below is proven by `postgres-integration/m10LegacyMigration.pgtest.ts` against a
fixture built to contain uncertainty on purpose:

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

Run at the final candidate, over the same single dataset `3077f43e…` as §3 and §4, migration run
`d5d72775-8b49-4157-8809-868cd8e6b298`. **10/10 checks PASS**, including that the instance really is
volume-backed, that the database is genuinely destroyed before restore (0 tables remaining), that
all 11 `legacy_id_map` tuples and the migration run identity survive, that the recomputed assessment
survives, and that the append-only trigger is restored with the data rather than just the rows.

Because the script rehearses cutover and restore in one pass, the reconciliation evidence in §4 and
the restore evidence here describe the **same** migrated target, not two separately built ones.

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

Every executable result in this table was produced at `1d81dd7` (tag `m10-candidate`). The final
candidate `m10-candidate-final` adds a documentation-only evidence pass on top, so no test result
above needs re-running to apply to it — verify with
`git diff m10-candidate m10-candidate-final --stat`, which touches `docs/` only.

## 10. Cutover steps and rollback boundaries

`docs/refactor/evidence/M10_ROLLBACK_AND_CUTOVER.md` holds the nine-step M11 runbook with a stop
gate on each step, and the rollback model built around the single boundary that governs it:

- **Zone A**, before the target's first externally consequential action: recovery means abandoning
  the *migration attempt* — abort activation, freeze target consequential processing, optionally
  restore the verified pre-import PostgreSQL backup, then re-export and re-import deterministically
  from the frozen read-only source and retry once the gates pass.
- **Zone B**, after external provider effects: **no database restore is a recovery path.** Restoring
  an earlier database cannot retract a supplier-side change; it would produce a NORTHSTAR that is
  confidently wrong about the world. Forward-recovery on the target is the only honest path.

**Neither zone permits reactivating the old SQLite application.** PostgreSQL is the sole runtime and
the frozen SQLite file is protected read-only migration input, never a fallback runtime. "Rollback"
in this package always means rolling back the migration attempt, never reverting to a previous
system — there is no previous system left to revert to, which is what `M10_RUNTIME_RETIREMENT.md`
establishes.

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
