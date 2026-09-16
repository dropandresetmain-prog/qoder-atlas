# Migration reconciliation — legacy-deployment-m10-restore-rehearsal

**Verdict: BLOCKED.** 1 exception(s) block cutover for their scope. Cutover must not proceed for the affected scope until an owner resolves these.

- Run `fcaafe52-7143-48ed-a8da-00c78b6d30df` (COMPLETED), generated 2026-03-02T09:00:00Z
- Dataset hash `3077f43e0d05f2c622b952a5227a7547ab0366427c85e6961273514d279a1596`
- Exporter `northstar-legacy-exporter/1.1.0`, importer `northstar-legacy-importer/1.0.0`, reconciler `northstar-migration-reconciler/1.0.0`
- 11 exported record(s), 11 mapping(s), 1 exception(s), 1 blocking cutover

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
- **PROVIDER_REFS_PRESERVED — PASS.** 1 legacy booking reference(s) in the bundle; 1 preserved as evidence against a migrated reservation; 1 element-level exception(s) account for the rest. Binding references as target external identity remains a documented open seam.
- **EVIDENCE_LINEAGE_INTACT — PASS.** all 11 mappings cite an evidence record that exists
- **OBLIGATIONS_COMPLETE — PASS.** 1 reservation(s), 0 holding no line
- **UNCERTAINTY_PRESERVED — PASS.** 0 reservation line(s) remain UNKNOWN; 0 uncertain external outcome(s) are explicitly preserved as unknown rather than resolved to failed or succeeded
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
| TRIP | MIGRATE_THEN_RECONCILE | 2 | 1 | 0 | 1 |
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

1 of 1 block cutover for their scope.

### QUARANTINED_MULTI_TRAVELLER_ALLOCATION — `trips/trip-multi`

- **Blocks cutover:** yes
- **Owner:** migration owner
- **Reason:** legacy trip carries 2 travellers and 2 element(s); TripElement has no travellerId and Stay.guests is a bare headcount, so element -> Journey ownership cannot be proven from source evidence
- **Affected scope:** trip trip-multi, travellers [trav-multi-a, trav-multi-b], 2 element(s)
- **Safety impact:** guessing allocation would attribute flights/stays to the wrong person, and recovery would act on the wrong traveller; source data is preserved unmigrated instead
