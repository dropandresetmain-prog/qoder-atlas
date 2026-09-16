# Migration reconciliation — legacy-deployment-m10-restore-rehearsal

**Verdict: BLOCKED.** 1 exception(s) block cutover for their scope. Cutover must not proceed for the affected scope until an owner resolves these.

- Run `18953aa8-8086-4dba-bf76-585f186bc3cf` (COMPLETED), generated 2026-03-02T09:00:00Z
- Dataset hash `6ebf05ce47554d8929a793d64882828d0cee895158ebb72047380827f528002d`
- Exporter `northstar-legacy-exporter/1.1.0`, importer `northstar-legacy-importer/1.0.0`, reconciler `northstar-migration-reconciler/1.0.0`
- 11 exported record(s), 11 mapping(s), 2 exception(s), 1 blocking cutover

## Semantic checks

| check | result | question |
| --- | --- | --- |
| `IDENTITY_ACCOUNTED` | PASS | Is every exported legacy record either represented in the target or named in an exception? |
| `JOURNEY_OWNERSHIP_PROVEN` | PASS | Does every migrated Journey name exactly one real traveller, with no allocation guessed? |
| `PROVIDER_REFS_PRESERVED` | PASS | Did every provider booking reference survive, or get named as lost? |
| `EVIDENCE_LINEAGE_INTACT` | PASS | Does every mapping point at a real evidence chain rather than a marker string? |
| `OBLIGATIONS_COMPLETE` | PASS | Does every migrated booking actually record what was booked? |
| `UNCERTAINTY_PRESERVED` | PASS | Did anything the old system did not know become certainty in the new one? |
| `MONEY_ACCOUNTED` | PASS | Did any money-bearing state migrate, and if so does it carry evidence? |
| `DERIVED_TRUTH_RECOMPUTED` | PASS | Is current health/viability computed from migrated state rather than carried over? |
| `NO_PROVIDER_DISPATCH` | PASS | Did the migration cause any external or money-moving action? |

- **IDENTITY_ACCOUNTED — PASS.** all 11 exported records are accounted for
- **JOURNEY_OWNERSHIP_PROVEN — PASS.** 1 migrated journey(ies), 0 without a traveller. Trips whose element ownership was unprovable were quarantined rather than allocated: 1 case(s).
- **PROVIDER_REFS_PRESERVED — PASS.** 2 legacy booking reference(s) in the bundle; 2 preserved as evidence against a migrated reservation; 2 element-level exception(s) account for the rest. Binding references as target external identity remains a documented open seam.
- **EVIDENCE_LINEAGE_INTACT — PASS.** all 11 mappings cite an evidence record that exists
- **OBLIGATIONS_COMPLETE — PASS.** 2 reservation(s), 0 holding no line
- **UNCERTAINTY_PRESERVED — PASS.** 1 uncertain source fact(s) in the bundle, each traced to its own preservation: trips/trip-single#el-single-return=target-line-UNKNOWN
- **MONEY_ACCOUNTED — PASS.** no budget commitment migrated: the legacy dataset held no priced, held or settled commitment. 0 legacy FX observation(s) are archived as dated history and are never used as a current conversion rate.
- **DERIVED_TRUTH_RECOMPUTED — PASS.** 1/1 assessment(s) were evaluated after the import began; legacy verdicts are archived as LEGACY_CONSTRAINT_STATUS evidence and are not assessments
- **NO_PROVIDER_DISPATCH — PASS.** no execution attempt exists in this workspace: the migration is provider-side-effect-free

## Category coverage

| category | decision | exported | mapped | archived | exceptions |
| --- | --- | --- | --- | --- | --- |
| ORGANISATION | MIGRATE_TRANSFORM | 1 | 1 | 0 | 0 |
| TRAVELLER | MIGRATE_TRANSFORM | 3 | 3 | 0 | 0 |
| PLACE | MIGRATE_TRANSFORM | 2 | 2 | 0 | 0 |
| ANCHOR_EVENT | MIGRATE_TRANSFORM | 0 | 0 | 0 | 0 |
| RULE_SET | ARCHIVE_AND_REGENERATE | 0 | 0 | 0 | 0 |
| TRIP | MIGRATE_THEN_RECONCILE | 2 | 1 | 0 | 2 |
| CONSTRAINT | TRANSFORM_AND_REASSESS | 1 | 1 | 0 | 0 |
| RECOVERY_CASE | ARCHIVE_AND_REGENERATE | 0 | 0 | 0 | 0 |
| SIGNAL | ARCHIVE_AS_IMMUTABLE_HISTORY | 0 | 0 | 0 | 0 |
| SOURCE_RECORD | MIGRATE_TRANSFORM | 1 | 1 | 0 | 0 |
| AUDIT_HISTORY | ARCHIVE_AS_IMMUTABLE_HISTORY | 1 | 0 | 1 | 0 |
| BOOKING_DOSSIER | QUARANTINE_ARCHIVE_REPAIR_WITH_EVIDENCE | 0 | 0 | 0 | 0 |
| PREFERENCE | QUARANTINE_ARCHIVE_REPAIR_WITH_EVIDENCE | 0 | 0 | 0 | 0 |
| FX_RATE_EVIDENCE | ARCHIVE_AS_IMMUTABLE_HISTORY | 0 | 0 | 0 | 0 |
| PROVIDER_EVENT_INBOX | ARCHIVE_AS_IMMUTABLE_HISTORY | 0 | 0 | 0 | 0 |

## Exceptions

1 of 2 block cutover for their scope.

### PRESERVED_UNKNOWN_EXTERNAL_OUTCOME — `trips/trip-single`

- **Blocks cutover:** no
- **Owner:** operations owner
- **Reason:** legacy element el-single-return stood at CHANGED — the supplier state was never reconciled by the legacy runtime. The target has no such status, and both CONFIRMED and CANCELLED would assert something never observed, so it migrated as UNKNOWN
- **Affected scope:** element el-single-return on trip trip-single, reservation d60b6843-2537-542b-844c-5af62cf77ce0
- **Safety impact:** the real supplier state must be re-observed before anyone relies on this booking; until then the target correctly reports that it does not know

### QUARANTINED_MULTI_TRAVELLER_ALLOCATION — `trips/trip-multi`

- **Blocks cutover:** yes
- **Owner:** migration owner
- **Reason:** legacy trip carries 2 travellers and 2 element(s); TripElement has no travellerId and Stay.guests is a bare headcount, so element -> Journey ownership cannot be proven from source evidence
- **Affected scope:** trip trip-multi, travellers [trav-multi-a, trav-multi-b], 2 element(s)
- **Safety impact:** guessing allocation would attribute flights/stays to the wrong person, and recovery would act on the wrong traveller; source data is preserved unmigrated instead
