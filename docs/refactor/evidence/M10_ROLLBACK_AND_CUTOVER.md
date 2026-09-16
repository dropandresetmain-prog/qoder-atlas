# M10 Phase 10 — rollback model and M11 cutover runbook

## The boundary that governs everything here

There is exactly one line that changes what rollback means:

> **Has the target performed its first externally consequential action?**

Before that line, the target holds a *copy* of the world's state and nothing outside NORTHSTAR knows
it exists. Restoring the legacy database loses nothing, because nothing new happened.

After that line, the target has changed something a supplier also believes — a booking held, changed
or cancelled; a ticket exchanged; money committed. Restoring the legacy database does **not** undo
that. It produces a NORTHSTAR that is confidently wrong about the world, which is more dangerous
than being down, because recovery decisions would then be made against a state the supplier has
already moved past.

Anyone who says "we can always roll back" after this line is mistaken, and the runbook below is
written so that nobody has to rely on remembering it.

## Rollback model

### Zone A — before the first target-side external action

| | |
| --- | --- |
| **Rollback** | Point traffic back at the legacy runtime; abandon the target database. |
| **Safe?** | Yes. |
| **Cost** | The migration run is discarded. Re-running it is cheap and deterministic: the same bundle yields the same dataset hash and the same target ids. |
| **Evidence it works** | `scripts/m10-cutover-and-restore-rehearsal.mjs` — backup, genuine destruction, restore, with mappings, run identity, obligations and recomputed state all verified intact. |

Deliberate property: the target's ids are **derived from the dataset hash**, not random. Re-importing
after a discarded attempt produces byte-identical identity, so a retry is a replay rather than a
second, divergent world.

### Zone B — after external provider effects have occurred

| | |
| --- | --- |
| **Rollback** | **Not available as a return to the legacy runtime.** |
| **Why** | Restoring an older database cannot retract a supplier-side change. The legacy runtime has no record of actions the target took, so it would present stale bookings as current truth. |
| **What you do instead** | Forward-recover on the target: freeze new consequential actions, re-observe affected external records, reconcile observed supplier state, and resume. |
| **Partial option** | Scope-level suspension. Because every reconciliation exception names its `affectedScope`, a single Journey or Trip can be held back without stopping the rest. |

The transition between zones is observable, not a matter of judgement: Zone B begins at the first row
in `execution_attempts`. The reconciliation report's `NO_PROVIDER_DISPATCH` check reports exactly
this, and it must read PASS at the moment of cutover.

## M11 cutover runbook

Each step states what must be true before moving on. A step that cannot be satisfied is a stop, not
a warning.

1. **Freeze the legacy source.** Stop legacy writes. Record the freeze instant; it becomes the
   export cutoff. *Gate:* no legacy write after the cutoff.
2. **Final export.** Run the offline exporter against the frozen SQLite file. *Gate:* export
   completes, and re-running it produces the identical `datasetHash`. Record the hash — it is the
   dataset's identity everywhere downstream.
3. **Back up the target before the import.** *Gate:* a restorable dump exists for the pre-import
   target.
4. **Import.** Run the importer into the target. *Gate:* run status `COMPLETED`, `recordsDeferred`
   is 0, and every conflict is absent (a conflict means the source changed after a prior import and
   must be resolved by an owner, never overwritten).
5. **Recompute derived state.** Run the real evaluator over migrated journeys. *Gate:* migrated
   subjects reach `CURRENT`; no legacy verdict was imported as an assessment.
6. **Reconcile.** Generate the report. *Gate:* every semantic check PASSes, and every exception
   carries a classification, reason, scope, safety impact, owner and cutover-blocking flag.
7. **Decide, scope by scope.** Cut over the scopes with no blocking exception. Hold back the scopes
   that have one. *Gate:* `NO_PROVIDER_DISPATCH` still PASSes — you are still in Zone A.
8. **Activate.** Point the product at the target. **This is the Zone A → Zone B boundary the moment
   the first consequential action runs.**
9. **Watch.** Confirm the first consequential actions observe and reconcile as expected before
   releasing the held-back scopes.

## Activation blockers carried into C5

These are the categories that, on current evidence, hold back their own scope rather than the whole
cutover. Each needs an owner decision, not more engineering discovery.

| finding | scope held back | owner | what unblocks it |
| --- | --- | --- | --- |
| `QUARANTINED_MULTI_TRAVELLER_ALLOCATION` | multi-traveller legacy trips | migration owner | source evidence proving element → traveller ownership, or an accepted manual allocation |
| `ARCHIVED_NOT_REPLAYED_AS_LIVE_STATE` (open cases) | journeys with unfinished recovery | operations owner | let the target re-derive the case from migrated state, and confirm it matches |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` (explicit preferences) | travellers with standing instructions | migration owner | an effective-window policy for migrated preferences |
| `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` (rule sets) | supplier/operational policy checks | policy owner | registered rule expressions authored against the predicate registry |
| `QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING` (engagements) | programme participation | migration owner | obligation level per participant, which the legacy engagement did not record |
| `ARCHIVED_REQUIRES_PROTECTED_CONTENT_STORE` (dossier PII) | traveller contact/payment | data protection owner | a real protected-content store to hold the values a `ProtectedDataRef` points at |
| `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` | specific bookings and deliveries | operations owner | re-observation of actual supplier state |

Note that none of these is a defect to fix in the migration. Each is a place where the legacy data
does not contain what the target needs, and the migration's job was to say so precisely rather than
guess.

## Open seam, documented rather than hidden

Provider booking references migrate as evidence bound to the migrated reservation. Binding them as
**target external identity** — so a provider event auto-correlates to a subject without being told
which one — needs the M3 external-identity resolution path. Explicit target subject identity is
sufficient for current product operation, so this is a post-M10 capability, not a migration defect.
It is why `PROVIDER_REFS_PRESERVED` says "preserved" and not "correlated".
