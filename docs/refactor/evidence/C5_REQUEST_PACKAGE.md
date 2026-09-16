# C5 request package — M10 migration rehearsal

**This is a request for independent review, not a claim that C5 passed.** C5 is an
acceptance gate owned by a reviewer and an owner; this document assembles the evidence they need
and states plainly what is still outstanding.

**No production cutover has occurred.** Everything below was rehearsed against throwaway fixtures in
isolated environments.

## 1. Candidate identity

> **C5 re-review.** An independent C5 review of `m10-candidate-final` found two blockers:
> a fabricated organisation currency, and a fail-open `UNCERTAINTY_PRESERVED` check. Both were fixed,
> but the fix for the second one was itself incomplete twice over: `m10-candidate-c5-remediation-2`
> **failed C5 re-review** because, when an uncertain element's reservation line was absent, it
> accepted any exception stamped at parent-record level rather than one bound to that fact; and
> `m10-candidate-c5-remediation-3` **failed C5 re-review** in turn, because binding was fixed while
> the disposition was still inferred — an exception naming the fact and carrying a
> classification on a hold-back allowlist was taken as proof that the line was held back, yet
> `TARGET_REJECTED_WRITE` is emitted both before any reservation line exists and after one was
> successfully written, so a post-line failure produced a false PASS. §12 records all four findings
> and what each candidate got wrong. The rest of M10 is unchanged.

| | |
| --- | --- |
| Branch | `milestone-m10-migration-rehearsal` |
| **Candidate under review** | tag **`m10-candidate-c5-remediation-4`** |
| Superseded candidates | `m10-candidate-c5-remediation-3` (`b18960f`), `m10-candidate-c5-remediation-2` (`b65a526`), `m10-candidate-c5-remediation` (`9486fc5`), `m10-candidate-final` (`eff19a9`), `m10-candidate` (`1d81dd7`) |
| Accepted M9/C4 base | `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` |

The candidate is identified by an annotated tag rather than a SHA written into this file, because a
document cannot contain the hash of the commit that contains it. Resolve it with
`git rev-list -n 1 m10-candidate-c5-remediation-4` (`git rev-parse` on an annotated tag returns the
tag object, not the commit).

Six tags exist deliberately. Earlier tags are never moved, so their history stays honest:

| tag | what it marks |
| --- | --- |
| `m10-candidate` | `1d81dd7` — implementation complete. |
| `m10-candidate-final` | `eff19a9` — plus an evidence-consistency pass. **Failed C5** on the two blockers in §12. |
| `m10-candidate-c5-remediation` | `9486fc5` — currency fixed and accepted, but the replacement uncertainty check was count-based. **Failed C5 re-review** on that. |
| `m10-candidate-c5-remediation-2` | `b65a526` — uncertainty reconciliation identity-bound per source fact. **Failed C5 re-review**: the absent-line case fell back to parent-record exceptions (Blocker 3). |
| `m10-candidate-c5-remediation-3` | `b18960f` — element findings carry an explicit fact identity. **Failed C5 re-review**: identity was correct, but the fact-scoped hold-back allowlist still inferred the structural disposition from a broad exception classification, and `TARGET_REJECTED_WRITE` occurs both before and after a reservation line exists. |
| **`m10-candidate-c5-remediation-4`** | **the commit under review** — the importer declares per finding whether it holds back that fact's reservation line, and `UNCERTAINTY_PRESERVED` reads only that declaration. |

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
| Migration run | `9b6e6cb1-b3d7-42fb-b373-bd07c574b9a8` |
| Produced at | this candidate, by `scripts/m10-cutover-and-restore-rehearsal.mjs` |

The hash is **byte-identical to the one `m10-candidate-c5-remediation-3` produced**, because this
fix changed no fixture and no migrated row: the same source exports the same dataset, so the same
target ids. What differs is the exception schema — a finding now carries the importer's own
declaration about the reservation line, only the paths that stop before the line is written make
that declaration, and `UNCERTAINTY_PRESERVED` reads the declaration instead of the classification.
A migration that changed state would have changed this hash.

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
`9b6e6cb1-b3d7-42fb-b373-bd07c574b9a8`. **10/10 checks PASS**, including that the instance really is
volume-backed, that the database is genuinely destroyed before restore (0 tables remaining), that
all 11 `legacy_id_map` tuples and the migration run identity survive, that the recomputed assessment
survives, and that the append-only trigger is restored with the data rather than just the rows.

Both reconciliation exceptions survive, and the check that judges them compares a **triple** rather
than a classification: `classification` + `factSourceId` + reservation-line disposition, rendered as
`PRESERVED_UNKNOWN_EXTERNAL_OUTCOME=trip-single:el-single-return#(no-line-claim)` and
`QUARANTINED_MULTI_TRAVELLER_ALLOCATION=(record-level)#(no-line-claim)`. That widening was necessary
rather than cosmetic. Blocker 3's fix is an exception-to-fact binding and blocker 4's is a
disposition carried on that same exception, and the rehearsal writes its reconciliation report
*before* the destroy/restore phase — so a classification-only comparison would have left "the binding
survives a restore" true in the data and unasserted in the evidence, which is the same gap the
blocker is about. A record-level finding renders explicitly as `(record-level)` and an unbounded
disposition as `(no-line-claim)` so a value silently dropped by the restore cannot compare equal to
an absent one.

Both canonical exceptions render `(no-line-claim)`, correctly: neither is a pre-line hold-back. So
this rehearsal proves the disposition **field** survives backup, destruction and restore; it does not
prove the `true` value survives, because the canonical fixture holds no fact-scoped hold-back. That
case is covered where it can be built — `m10LegacyMigration.pgtest.ts` reads the persisted run row
back through `readMigrationRun` and asserts `[classification, holdsBackReservationLine]` is
`[QUARANTINED_AMBIGUOUS_IDENTITY, true]`.

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
| `postgres-integration/m10LegacyMigration.pgtest.ts` | **15/15 PASS** (7 + four C5 blocker tests + three fact-identity tests + one hold-back-disposition test) |
| `postgres-integration/m10RuntimePurgeBoot.pgtest.ts` | PASS |
| `test/m10-legacy-exporter.test.ts` + `test/m10-runtime-purge.test.ts` | 10/10 PASS, exit 0 |
| `npm run test:postgres` on a **fresh** database | **475/476 PASS**, exit 1 — every M10 and M9 suite passes; the one failure is the pre-existing M2 access-path assertion analysed in §11, which is not an M10 test and reproduces without any M10 test running |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| `npm run lint` | clean |
| `npm run gate:anti-hardcoding` | CLEAN |

Sarah and Jordan were not modified to accommodate migration tooling; they remain independent
target-runtime regression evidence.

476 is the previous candidate's 475 plus exactly the one new hold-back-disposition test — no other
test counted, dropped or changed, and that new test is among the 475 that pass. Every result in this
table was produced on **this** candidate; nothing is carried forward, because this candidate changes
executable code.

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

## 11. Full-suite behaviour, disclosed rather than hidden

The gate above was run on a freshly created `northstar_test` database and is **476 tests, 475 pass,
1 fail, exit 1**. The failure is in `m2Travel.pgtest.ts`, which is not an M10 test — and it is
recorded here rather than smoothed over, because this time it is not transient and the honest
disclosure is stronger than "re-run the file and it passes".

Seven full runs are on record. Through run 5 the symptom looked like a low-rate single-file failure
landing on a different file each time:

| run | database | result |
| --- | --- | --- |
| 1 | shared, accumulated | 1 failure: `m3IdentityMoney.pgtest.ts` |
| 2 | shared, accumulated | 1 failure: `m2Travel.pgtest.ts` |
| 3 | fresh | 1 failure: `m2SubtypeIntegrity.pgtest.ts` |
| 4 | fresh | 470/470 PASS |
| 5 | fresh | 472/472 PASS (after the identity-bound uncertainty fix) |
| 6 | fresh | 475/475 PASS (after the fact-bound absent-line fix — `m10-candidate-c5-remediation-3`) |
| 7 | fresh | **475/476 PASS, exit 1** (this candidate: 1 failure, `m2Travel.pgtest.ts`) |

Two causes are in play, and run 7 separates them.

**`m2SubtypeIntegrity` (run 3) was a connection-setup race.** It failed at *file level in 547ms
without executing a single subtest*, then passed 15/15 in isolation, 61/61 with its alphabetical
predecessor and in the next full run. That one is genuinely intermittent and is tracked as
`PGTEST-FILE-STARTUP-RACE`.

**`m2Travel` is a reproducible planner assertion, and run 7 falsifies the "different file every
time, never twice on the same one" description this section carried.** The failing test,
`every statement the read model emits can use the index its port names`, asks each statement in the
M2 transport/stay `UNION ALL` whether it *can* use the index its port names. Statement 2 — the
`ORIGIN` branch — planned as an index scan on `idx_transport_item_details_destination` with a
`Filter:` on `desired_origin_place_id` at `rows=4`. There is still no sequential scan anywhere in
the plan, so the property the test guards may well hold, but the assertion as written is about a
named index and it did not hold. After the full-suite failure it was attempted three more times and
failed all three: once as the whole file (10/11 pass) and twice under `--test-name-pattern` executing
**only** that test — four consecutive failures, no clean run.

That last detail is what puts it outside this candidate. `m2Travel.pgtest.ts` contains no reference
to `src/migration`, so it loads none of the three source files this remediation changes, and the two
runs where only that single test executed had no M10 test in them at all. The status is therefore a
**reproducible pre-existing failure in this environment, not a green suite** — tracked as
`M2-ACCESS-PATH-PLANNER` for the M2 lane-T owner, with a proposed but unexecuted remedy (assert
"no sequential scan" instead of "uses this index name", or `ANALYZE` the detail tables after
seeding). Nothing here was re-run until it passed; it never passed.

Neither cause is the carried `PG-ASSESS-SERIAL` concurrency risk, and neither is specific to the M10
changes: every M10 and M9 suite in run 7 passed, including `m10LegacyMigration.pgtest.ts` at 15/15.

## 12. C5 remediation — what previous candidates got wrong

All four findings were correct, and all four were cases of the migration asserting something it had
not established. That is exactly the failure mode the rest of M10 is built to prevent, which is why
none of them was acceptable as a documented caveat.

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
| element whose scope was held back | a named exception covering that scope <sup>†</sup> |
| provider delivery | **that delivery's own** archived evidence id, or its own named exception |

<sup>†</sup> *This row is remediation-2 as reviewed. "A named exception covering that scope" was
implemented at **parent-record** granularity, and C5 re-review rejected it — see Blocker 3 below.
The rule as it now stands requires the exception to name the **fact**, not merely its trip.*

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

### Blocker 3 — C5 re-review of `m10-candidate-c5-remediation-2`

That candidate made each **present** row identity-bound, which was accepted. It left the **absent**
row case answering at the parent record: when the reservation line an uncertain element should have
written was missing, reconciliation passed the fact if *any* exception carried
`sourceType=trips, sourceId=<tripId>`.

Every element-level finding is stamped with its parent trip's identity, because
`importOneRecord()` re-stamps `categoryId`/`sourceType`/`sourceId` over whatever a handler returned.
So the fallback could be satisfied by `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` — an exception whose
entire meaning is *"this element migrated and stayed UNKNOWN."* Used to excuse a **missing** line,
it asserts the exact opposite of what the state shows. One unrelated trip-level exception could make
a silently-dropped uncertain element look accounted for, in the same class as the aggregate
reasoning re-review had already rejected.

**Fix — an explicit fact identity, not a reinterpretation of free text.**

`MigrationReconciliationExceptionSchema` gained an optional `factSourceId`, whose value is the same
`tripId:elementId` used to write the element's rows. The field is deliberately **not** inferred from
`affectedScope`, which is operator-facing free text and not an identity; parent-level exceptions are
left unbound rather than converted. Because exceptions live in `migration_runs.reconciliation_exceptions`
as JSONB under a `strictObject` schema, an optional key needs no database migration and rows written
by the previous candidate still parse.

One helper, `legacyTripElementSourceId()` in `legacyExportBundle.ts`, is now the only place that
format is built — importer target-id derivation, element exception stamping, uncertain-fact
collection and reconciliation all read it, so the four cannot drift apart.

`migrateTripElements()` stamps the identity on every element-scoped finding that means "this element
did not become the row you expected": `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME`, element-level
`TARGET_REJECTED_WRITE`, `QUARANTINED_AMBIGUOUS_IDENTITY` and
`QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING`. Findings about the trip as a whole keep no
`factSourceId` — inventing one for `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` would be the same
fabrication in a new costume.

**Absent-line semantics, matched to granularity.** The check now consults two allowlists derived
from the control flow of `migrateTripElements()` rather than from the reviewer's example list: every
classification in them is emitted on a path that `continue`s **before** any line is written.

| when the line is absent, PASS requires | classes |
| --- | --- |
| an exception bound to **that exact** `factSourceId` | `QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING`, `QUARANTINED_AMBIGUOUS_IDENTITY`, `TARGET_REJECTED_WRITE` |
| or a trip-level exception **and** that the trip itself never migrated | `QUARANTINED_MULTI_TRAVELLER_ALLOCATION`, `QUARANTINED_AMBIGUOUS_IDENTITY`, `QUARANTINED_UNREADABLE_SOURCE`, `TARGET_REJECTED_WRITE` |

<sup>‡</sup> *The fact-scoped row is remediation-3 as reviewed. Deriving the disposition from a
classification allowlist was **rejected by C5 re-review**: a classification says what went wrong, not
how far the element got, and `TARGET_REJECTED_WRITE` is emitted both before any line exists and after
one was written. See Blocker 4 below — the rule as it now stands reads the importer's own per-finding
declaration.*

`PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` is absent from both, by design: it is evidence the line
*exists*, so it can never excuse its absence. The second row keeps the accepted multi-traveller
quarantine working — a trip held back wholesale writes no reservation line and no id-map row — while
the `!mappedKeys.has(...)` guard closes the residual hole where a successfully-migrated trip's
unboundable parent exception excused one of its elements. When the line **is** present, `UNKNOWN`
passes and any other status fails with no exception able to override it.

**Evidence.** Three tests, and the third is what stops the fix being "absent line ⇒ always FAIL":

| test | proves |
| --- | --- |
| absent line while its own `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` stands | `UNCERTAINTY_PRESERVED` is `FAIL`, and the detail names the fact, the expected target line id and the reason the exception does not excuse it |
| a sibling element's legitimate hold-back | element B's fact-bound exception cannot account for element A's missing line — the ids differ, and the test asserts that |
| a genuinely fact-scoped hold-back | a real migration path (`QUARANTINED_AMBIGUOUS_IDENTITY` on a leg whose place has no zone) still yields `PASS` |

Non-vacuity was checked by mutation, not by reading: re-inserting the pre-fix parent-level fallback
makes all three new tests fail with their intended assertion messages. The mutation was reverted and
the suite re-run clean.

The canonical rehearsal exercises the persistence path end to end: the fact identity survives
append → JSONB → `readMigrationRun` → report MD/JSON → `pg_dump` → destroy → restore, and the report
still shows the trip-level quarantine with **no** `factSourceId`, i.e. no fabricated identities.

### Blocker 4 — C5 re-review of `m10-candidate-c5-remediation-3`

**What review found.** `m10-candidate-c5-remediation-3` failed C5 re-review because fact identity was
correct, but the fact-scoped hold-back allowlist still inferred structural disposition from broad
exception classification; `TARGET_REJECTED_WRITE` can occur after the reservation line already exists.

Remediation-3 asked the right question in the wrong place. It bound findings to facts properly, then
answered "was this line held back?" by looking up the finding's **classification**. A classification
records *what went wrong*; the absent-line question is about *how far the element got*, and the two
are not the same axis:

| when `TARGET_REJECTED_WRITE` fires | line state | does the finding explain its absence? |
| --- | --- | --- |
| a reservation write for the element was rejected before `addReservationLine` succeeded | never written | yes |
| archiving the element's provider booking reference failed **after** the line was written and mapped | present | no |

Both carry the same classification and both name the same `factSourceId`, so the allowlist read the
second as the first: deleting a migrated element's `UNKNOWN` line while its provider reference failed
to archive still returned `PASS`. The check was fail-open again through a narrower door, and
remediation-3 had no test for the post-line case, which is why it looked closed.

**Fix — the importer states the disposition, instead of the reconciler guessing it.**

`MigrationReconciliationExceptionSchema` gained an optional `holdsBackReservationLine: true`. It is
written only on the element paths that give up *before* `addReservationLine` succeeds, and read only
by `UNCERTAINTY_PRESERVED`. The reconciler's condition is now
`entry.factSourceId !== undefined && entry.holdsBackReservationLine === true`, keyed on
`sourceType/sourceId` plus `factSourceId`. `FACT_SCOPED_HOLD_BACK_CLASSIFICATIONS` is deleted, with a
comment in its place recording why a fact-level allowlist could never have been correct. The
record-level allowlist stays: for a wholesale quarantine the record genuinely has no children to
name, so the classification *is* the reason no line exists there.

Absent means "this finding makes no claim about the line", never "the line exists" — so an unbound
record-level quarantine or an archived-history finding simply omits the field, and the report renders
the two cases as different sentences rather than leaving a reviewer to guess.

| | |
| --- | --- |
| Paths that set it (`legacyCategoryHandlers.ts`) | engagement with no deterministic target mapping; unrecognised element kind; leg endpoint with an unresolvable place; `TRANSPORT_SERVICE_CREATED` write rejected; `RESERVATION_CREATED` write rejected; `RESERVATION_LINE_ADDED` write rejected |
| Paths that deliberately do not | provider booking reference archival failing **after** the line was written; `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME`, which is evidence the line exists; a `NONE` element's archived-history failure, where no line is expected by design rather than held back |

Still schema-only JSONB under a `strictObject`: no PostgreSQL migration, and exceptions written by
earlier candidates still parse. Historical tags and candidates are untouched.

**Evidence.** The negative test reproduces the reviewer's case through the real handler rather than a
hand-written exception: it pre-occupies the evidence id the importer derives for
`trip-solo:el-solo-stay`'s provider reference, so the genuine archival write inside
`migrateTripElements()` is rejected and produces its own `TARGET_REJECTED_WRITE`; the test then
asserts that finding names the fact **and carries no hold-back declaration**, deletes that element's
`UNKNOWN` reservation line, and requires `UNCERTAINTY_PRESERVED = FAIL` naming the fact and the
expected line. The positive regression now pins the other half: the `QUARANTINED_AMBIGUOUS_IDENTITY`
exception that legitimately accounts for an absent line is asserted to carry
`holdsBackReservationLine: true` *read back from the run row*, so the fix cannot collapse into
"missing line ⇒ always FAIL".

Non-vacuity was checked by mutation: restoring the pre-fix classification allowlist and running only
the new test yields `actual: 'PASS'` where it demands `FAIL` — the old logic does false-pass this
exact case — and the file was then restored byte-exact and re-verified against `git diff`.

Restore evidence now compares the disposition rather than the identity alone: each exception renders as
`classification=factSourceId#holds-line-back` or `#(no-line-claim)` in the pre-backup / post-restore
comparison, so a binding that survives with its meaning stripped off would fail the check.

### Deliberately not changed

`QUARANTINED_MULTI_TRAVELLER_ALLOCATION` remains, as C5 accepted, and was not "solved" by guessing
traveller ownership. Provider-reference correlation, RecoveryCase/Signal/preference/rule-set
archive decisions, and the old SQLite UI routes were untouched.

Provider-delivery reconciliation stayed as remediation-2 left it: a delivery is accounted for by its
own archived evidence id, and those records have no element children, so the new optional
`factSourceId` forced no mechanical change there. One test pins the resulting asymmetry — delivery
findings are deliberately record-level with no fact binding, trip element findings are bound.

## 13. What a reviewer should probe

Five judgement calls deserve independent scrutiny more than the code does:

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
4. **The organisation-currency disposition.** A legacy organisation with no `homeCurrency`
   now blocks its own scope rather than migrating. Is `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` with
   archived evidence the right disposition, or should M11 carry an operator-supplied currency input
   so such organisations can migrate? The deliberate choice here was *not* to invent a migration
   input mechanism for this one field.
5. **Whole-record hold-backs may still excuse an absent element line (new).** The trip-level
   allowlist accounts for a fact only when the trip itself never migrated, so a wholesale
   `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` still covers every element of that trip without naming
   them individually. That is what keeps the accepted multi-traveller quarantine passing, and the
   alternative — requiring an element-level exception per held-back trip — would mean fabricating
   per-element findings the importer never actually made. Is the granularity boundary drawn in the
   right place?

### Verifying the four C5 fixes directly

```bash
# Blocker 1: the fabricated default is gone, and the real field is read.
rg -n "homeCurrency" src/migration/legacyImporter.ts
rg -n "USD" src/migration/            # expect no match

# Blocker 2: the status is computed, and one definition is shared.
rg -n "uncertaintyStatus" src/migration/reconcileMigration.ts
rg -n "legacyUncertainty" src/migration/   # the trip handlers and the reconciler both read it

# Blocker 3: the fact identity exists as its own field, is stamped once from one helper,
# and PRESERVED_UNKNOWN_EXTERNAL_OUTCOME is not in either hold-back allowlist.
rg -n "factSourceId" src/migration/                     # schema, stamping, facts, reconciliation
rg -n "legacyTripElementSourceId" src/                  # one definition, three call sites
rg -n "PRESERVED_UNKNOWN" src/migration/reconcileMigration.ts   # only the delivery preserved-set + the comments; never in either allowlist

# Blocker 4: the disposition is written by the importer, not inferred from a classification.
rg -n "holdsBackReservationLine" src/migration/          # schema, the one writer, the reader, the report
rg -n "heldBack\(elementId" src/migration/legacyCategoryHandlers.ts   # exactly the six pre-line paths
rg -n "forElement\(elementId" src/migration/legacyCategoryHandlers.ts # plus three that name the fact without claiming the line
rg -n "FACT_SCOPED_HOLD_BACK" .                          # expect no match: allowlisting was deleted

# All four, executed:
node --test postgres-integration/m10LegacyMigration.pgtest.ts   # 15/15
```

The negative tests deliberately falsify target state and assert the check turns `FAIL`, so they are
also the proof that the check *can* fail.
