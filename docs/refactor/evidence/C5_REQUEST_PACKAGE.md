# C5 request package — M10 migration rehearsal

**This is a request for independent review, not a claim that C5 passed.** C5 is an
acceptance gate owned by a reviewer and an owner; this document assembles the evidence they need
and states plainly what is still outstanding.

**No production cutover has occurred.** Everything below was rehearsed against throwaway fixtures in
isolated environments.

## 1. Candidate identity

> **C5 re-review.** An independent C5 review of `m10-candidate-final` found two blockers:
> a fabricated organisation currency, and a fail-open `UNCERTAINTY_PRESERVED` check. Both are
> fixed in this candidate, which supersedes `m10-candidate-final`. §12 records what changed and
> what the previous candidate got wrong. The rest of M10 is unchanged.

| | |
| --- | --- |
| Branch | `milestone-m10-migration-rehearsal` |
| **Candidate under review** | tag **`m10-candidate-c5-remediation-2`** |
| Superseded candidates | `m10-candidate-c5-remediation` (`9486fc5`), `m10-candidate-final` (`eff19a9`), `m10-candidate` (`1d81dd7`) |
| Accepted M9/C4 base | `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` |

The candidate is identified by an annotated tag rather than a SHA written into this file, because a
document cannot contain the hash of the commit that contains it. Resolve it with
`git rev-list -n 1 m10-candidate-c5-remediation-2` (`git rev-parse` on an annotated tag returns the
tag object, not the commit).

Four tags exist deliberately. Earlier tags are never moved, so their history stays honest:

| tag | what it marks |
| --- | --- |
| `m10-candidate` | `1d81dd7` — implementation complete. |
| `m10-candidate-final` | `eff19a9` — plus an evidence-consistency pass. **Failed C5** on the two blockers in §12. |
| `m10-candidate-c5-remediation` | `9486fc5` — currency fixed and accepted, but the replacement uncertainty check was count-based. **Failed C5 re-review** on that. |
| **`m10-candidate-c5-remediation-2`** | **the commit under review** — uncertainty reconciliation is now identity-bound per source fact. |

Unlike the previous pass, this one **changes executable code**, so every result in §9 was re-run on
this candidate rather than carried forward.

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
| **Dataset hash** | **`6ebf05ce47554d8929a793d64882828d0cee895158ebb72047380827f528002d`** |
| Export cutoff | `2026-03-01T00:00:00Z` |
| Migration run | `18953aa8-8086-4dba-bf76-585f186bc3cf` |
| Produced at | this candidate, by `scripts/m10-cutover-and-restore-rehearsal.mjs` |

The hash is deterministic: re-exporting the same frozen source produces the same hash, and the same
hash produces the same target ids, which is what makes a re-import a replay rather than a second
divergent world.

### Superseded hashes, named so they cannot be confused

The dataset hash is the identity of the *fixture*, so changing the fixture changes it by design.
Two earlier hashes appear in the history and **describe no current evidence**:

| hash | run | why superseded |
| --- | --- | --- |
| `5da1d341…` | backup/restore only, at `edfe0fc` | The script later absorbed the cutover sequence, which required places and a booked leg in the fixture so the reconciliation checks were not vacuous. |
| `3077f43e…` | cutover + restore, at `1d81dd7`/`eff19a9` | The C5 remediation changed the fixture twice: the organisation gained an explicit `homeCurrency` (so the rehearsal proves real currency mapping instead of a fabricated default), and the single-traveller trip gained a `CHANGED` element (so `UNCERTAINTY_PRESERVED` has real uncertainty to account for instead of passing over an empty set). |

Both changes are fixture data, not application behaviour. Detail in `M10_BACKUP_RESTORE.md`
§superseded runs.

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

### 5A. Observed in the final rehearsal — two exceptions, one activation blocker

This is the complete list of what `m10-reconciliation-report.{md,json}` actually produced against
the final dataset.

**1. `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` — blocks cutover for its scope**

| | |
| --- | --- |
| Source | `trips/trip-multi` |
| Reason | the legacy trip carries 2 travellers and 2 elements; `TripElement` has no `travellerId` and `Stay.guests` is a bare headcount, so element → Journey ownership cannot be proven from source evidence |
| Affected scope | trip `trip-multi`, travellers `[trav-multi-a, trav-multi-b]`, 2 elements |
| Safety impact | guessing allocation would attribute flights and stays to the wrong person, and recovery would then act on the wrong traveller; the source data is preserved unmigrated instead |
| Owner | migration owner |

**2. `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` — does not block cutover**

| | |
| --- | --- |
| Source | `trips/trip-single`, element `el-single-return` |
| Reason | the element stood at legacy `CHANGED`: the supplier had moved it and the legacy runtime never reconciled the new state. It migrated as target `UNKNOWN`, because CONFIRMED and CANCELLED would each assert something never observed |
| Safety impact | the real supplier state must be re-observed before anyone relies on this booking; until then the target correctly reports that it does not know |
| Owner | operations owner |

This second exception is new in this candidate and is deliberate: the previous rehearsal fixture
contained **no** uncertainty, so `UNCERTAINTY_PRESERVED` was evaluating an empty set. It now has
real uncertainty to account for, and reports `1 uncertain source fact(s) in the bundle, all
accounted for: 1 migrated uncertain reservation(s) against 1 target UNKNOWN line(s), 1 named
PRESERVED_UNKNOWN_EXTERNAL_OUTCOME exception(s)`.

Two further facts about the final dataset, stated because their absence is itself evidence:
**zero** legacy FX observations were present, and **no** priced, held or settled budget commitment
existed to migrate.

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
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` | organisation with no usable `homeCurrency` | migration owner | yes |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` | latent (inferred) preferences | migration owner | no |
| `DEFERRED_NO_HANDLER` | any category with no registered handler | migration owner | yes |

None of these is a migration defect. Each is a place where the legacy data does not contain what the
target needs, and the migration's job was to say so precisely rather than guess. The M11 runbook
gates on `recordsDeferred == 0`, so a category arriving with no handler stops the cutover instead of
passing quietly.

## 6. Uncertain-operation disposition

Nothing unknown was resolved by migrating it, and **reconciliation can now prove that rather than
assert it** — see §12 blocker 2.

The final rehearsal exercises this for real: one legacy `CHANGED` element migrates to target
`UNKNOWN`, carries a named `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` exception, and
`UNCERTAINTY_PRESERVED` verifies the source fact against the target representation.

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

Run at this candidate, over the same single dataset `6ebf05ce…` as §3 and §4, migration run
`18953aa8-8086-4dba-bf76-585f186bc3cf`. **10/10 checks PASS**, including that the instance really is
volume-backed, that the database is genuinely destroyed before restore (0 tables remaining), that
all 11 `legacy_id_map` tuples and the migration run identity survive, that the recomputed assessment
survives, and that the append-only trigger is restored with the data rather than just the rows. Both
reconciliation exceptions survive the restore with their classifications intact.

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
| `postgres-integration/m10LegacyMigration.pgtest.ts` | **11/11 PASS** (7 + four C5 blocker tests) |
| `postgres-integration/m10RuntimePurgeBoot.pgtest.ts` | PASS |
| `test/m10-legacy-exporter.test.ts` + `test/m10-runtime-purge.test.ts` | 10/10 PASS |
| `npm run test:postgres` on a **fresh** database | **472/472 PASS**, exit 0 |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| `npm run lint` | clean |
| `npm run gate:anti-hardcoding` | CLEAN |

Sarah and Jordan were not modified to accommodate migration tooling; they remain independent
target-runtime regression evidence.

472 is the original 468 plus the four C5 blocker tests. Every result in this table was produced
on **this** candidate; unlike the previous evidence pass, nothing is carried forward, because this
candidate changes executable code.

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

The gate above was run on a freshly created `northstar_test` database and is 472/472, exit 0.

This suite has a low-rate, non-deterministic single-file failure that a reviewer should expect and
not mistake for a regression. Across five full runs it has landed on a **different file every
time**, never twice on the same one, and the last two runs were clean:

| run | database | result |
| --- | --- | --- |
| 1 | shared, accumulated | 1 failure: `m3IdentityMoney.pgtest.ts` |
| 2 | shared, accumulated | 1 failure: `m2Travel.pgtest.ts` |
| 3 | fresh | 1 failure: `m2SubtypeIntegrity.pgtest.ts` |
| 4 | fresh | 470/470 PASS |
| 5 | fresh | **472/472 PASS** (this candidate, after the identity-bound uncertainty fix) |

Two distinct causes are visible. The `m2Travel` failure is plan-sensitivity: it asserts a specific
query uses a specific index, and on an accumulated database the planner chose a *different* index
(still no sequential scan) because table statistics had shifted. The run-3 failure was different in
kind — `m2SubtypeIntegrity` failed at **file level in 547ms without executing a single subtest**,
which is a startup/connection failure rather than a failed assertion. It passes 15/15 in isolation,
61/61 when run with its alphabetical predecessor, and passed in run 4, so it is a connection-setup
race under a long sequential suite, not a broken invariant.

Neither cause is the carried `PG-ASSESS-SERIAL` concurrency risk, and neither is specific to the
M10 changes. Recorded here rather than buried because a reviewer who hits it should re-run the
affected file in isolation before treating it as a finding. The residual risk is accepted, not
fixed: chasing a connection-setup race in the test harness is out of M10's scope, and it is tracked
as `PGTEST-FILE-STARTUP-RACE`.

## 12. C5 remediation — what the previous candidate got wrong

Both findings were correct, and both were cases of the migration asserting something it had not
established. That is exactly the failure mode the rest of M10 is built to prevent, which is why
neither was acceptable as a documented caveat.

### Blocker 1 — organisation currency was invented

The importer read `payload.defaultCurrencyCode` and fell back to `'USD'`. Two things were wrong:

- `defaultCurrencyCode` is a **target** field name (`peopleCommands.ts`, `organisations`). It does
  not exist in the legacy model at all, so that branch could never be taken — **every** migrated
  organisation received a fabricated `USD`.
- The real legacy field is `homeCurrency` (`src/domain/entities.ts`), optional and guarded by
  `/^[A-Z]{3}$/`, and its documented semantics (ADR-045/052) are that **absent means the
  organisation had no home-currency normalisation**. Absence is a fact about the source, not a gap
  to fill.

Now: a valid `homeCurrency` maps straight to `default_currency_code`, preserving the exact code. An
absent or non-conforming value **fails closed** — the organisation is not created, its payload is
archived as `LEGACY_ORGANISATION` evidence so the lineage survives, and an
`ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` exception blocks cutover for that scope with owner, scope
and safety impact named. The target schema was not weakened: `default_currency_code` remains
`NOT NULL`, which is what forces the honest answer.

Dependent records already failed safely and this is now covered by a test: a trip whose
`operatorOrganisationId` has no migrated identity is quarantined as
`QUARANTINED_AMBIGUOUS_IDENTITY` and blocks cutover, rather than migrating without its business
party or attaching to invented state.

The rehearsal fixture's organisation now carries an explicit `homeCurrency: 'SGD'`, so the headline
rehearsal proves positive mapping instead of exercising a default. That is fixture data; no currency
is hardcoded in application logic, and `gate:anti-hardcoding` is clean.

### Blocker 2 — `UNCERTAINTY_PRESERVED` could not fail

The check passed a literal `'PASS'` and put its counts in the detail string. A dataset that lost or
falsely resolved uncertainty would still have reconciled green, which made the one check most
responsible for "we did not invent certainty" worthless.

It is now computed from the **source bundle**, because only the source can say what the old system
did not know. `src/migration/legacyUncertainty.ts` holds the single definition of uncertain legacy
state — `CHANGED` and `UNKNOWN` reservation states, and provider deliveries whose
`processedStatus` is not `PROCESSED`/`IGNORED`/`FAILED` — and **both the importer and the reconciler
read it**, so the two cannot drift into different interpretations of the same legacy row. Fixing
this also closed a real inconsistency: the importer previously raised its preserved-unknown
exception only for `CHANGED`, silently treating a legacy `UNKNOWN` as unremarkable.

#### Identity-bound, not aggregate

The first remediation attempt replaced the hard-coded `PASS` with a **count** comparison, and the
C5 re-review correctly rejected it: comparing the number of workspace-wide `UNKNOWN` reservation
lines against the number of migrated uncertain elements lets the wrong row satisfy the check.
Falsely resolve element A, leave an unrelated line B `UNKNOWN`, and the totals still balance. The
same hole existed for provider deliveries, where a single global "some delivery was archived" count
could stand in for a different delivery's lost accounting. A sensor that can be satisfied by
compensation is the exact class of aggregate reasoning M10 is built not to trust.

Each uncertain fact is now traced to **its own** target row. The importer derives every target id
from the source record (`migrationTargetId`, now exported from `migrationRunStore.ts` and used by
both sides so there is one derivation), and a trip element's rows are written under the
element-scoped source id `tripId:elementId`. So reconciliation recomputes the exact id and reads
that one row:

| uncertain source fact | accounted for only by |
| --- | --- |
| migrated reservation element | **that element's own** reservation line still reading `UNKNOWN` |
| element whose scope was held back | a named exception covering that scope |
| provider delivery | **that delivery's own** archived evidence id, or its own named exception |

`FAIL` is returned when a fact's own line exists but no longer reads `UNKNOWN`, when a fact has
neither a target row nor an exception holding it back, or when a delivery has neither its own
archive nor its own named exception. No other row can compensate, and the failure detail names the
specific source fact and the specific target id.

The PASS detail is correspondingly specific rather than a tally — the canonical rehearsal reports
`1 uncertain source fact(s) in the bundle, each traced to its own preservation:
trips/trip-single#el-single-return=target-line-UNKNOWN`.

Three negative tests, because a FAIL path alone was not enough:

| test | proves |
| --- | --- |
| falsely resolving a migrated `UNKNOWN` | the check has a real `FAIL` path at all |
| an unrelated `UNKNOWN` line cannot mask a specific falsely-resolved one | resolving element A while making unrelated line B `UNKNOWN` leaves the workspace-wide count **identical** — asserted in the test — and still `FAIL`s |
| another delivery archive cannot mask an unaccounted uncertain delivery | the settled delivery's archive does not account for the unsettled one |

The third builds its mismatch through a real failure mode rather than tampering: `evidence_records`
is append-only and correctly refuses deletion, so the test interrupts the import between the two
deliveries, leaving the settled one archived and the unsettled one with neither archive nor
exception. It then resumes and asserts the check returns to `PASS`, so the `FAIL` is attributable to
the real gap rather than to reconciling a partial run.

### Deliberately not changed

`QUARANTINED_MULTI_TRAVELLER_ALLOCATION` remains, as C5 accepted, and was not "solved" by guessing
traveller ownership. Provider-reference correlation, RecoveryCase/Signal/preference/rule-set
archive decisions, and the old SQLite UI routes were untouched.

## 13. What a reviewer should probe

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
4. **The organisation-currency disposition (new).** A legacy organisation with no `homeCurrency`
   now blocks its own scope rather than migrating. Is `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` with
   archived evidence the right disposition, or should M11 carry an operator-supplied currency input
   so such organisations can migrate? The deliberate choice here was *not* to invent a migration
   input mechanism for this one field.

### Verifying the two C5 fixes directly

```bash
# Blocker 1: the fabricated default is gone, and the real field is read.
rg -n "homeCurrency" src/migration/legacyImporter.ts
rg -n "USD" src/migration/            # expect no match

# Blocker 2: the status is computed, and one definition is shared.
rg -n "uncertaintyStatus" src/migration/reconcileMigration.ts
rg -n "legacyUncertainty" src/migration/   # importer and reconciler both read it

# Both, executed:
node --test postgres-integration/m10LegacyMigration.pgtest.ts   # 9/9
```

The second test deliberately falsifies target state and asserts the check turns `FAIL`, so it is
also the proof that the check *can* fail.
