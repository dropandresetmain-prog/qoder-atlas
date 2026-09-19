# Demo reset performance (R)

Measured on the local Docker PostgreSQL (`northstar-postgres-test`), REPLAY, default pool. Phase timings now come back in the `POST /api/v2/demo/reset` response (`timingsMs`).

| phase | ms (typical of 5 runs) |
| --- | --- |
| lock + table discovery | 2-8 |
| delete workspace rows (148 tables, ~22k rows, one transaction) | 580-1150 |
| **provision dataset (materialize)** | **52,800-57,100** |
| baseline evaluation (67 journeys, 4 captures in parallel, serial persist) | 11,600-14,400 |
| workspace authority | 1,000-6,300 |
| **total** | **~67-83 s** (before change: 75.3 s; after: 67.2, 69.6, 71.3, 82.6 s under a 30-request burst) |

Where the time goes: `materializeDataset` issues about 1,900 individual SERIALIZABLE commands (`command_receipts` count 1,912), one at a time, about 28 ms each. That is 75% of the reset. Baseline evaluation is the next 17%.

## Improvement decision

No simple bounded speed-up without weakening truth. The only large lever is running `materializeDataset` commands in parallel; they are SERIALIZABLE, share scope-generation/revision rows through triggers, and rely on strict ordering for parents before children, so it is a design change with conflict/retry risk, not a bounded tweak. Not attempted. The test-fixture cloning infrastructure (`scripts/ait-fixture-suite.mjs`, `postgres-integration/aitFixtureClone.ts`) is test-only and was deliberately not used in product code. Recommended follow-up if 70 s is unacceptable: a per-phase parallelisation spike of the traveller loop (`materializeDataset.ts` lines ~649-860) with a determinism check on the resulting id set.

## What shipped instead (keep the user informed, prevent duplicates)

- Server single-flight: in-process guard in `resetDemoWorkspace` (a second reset for the same workspace answers `409 RESET_IN_PROGRESS` immediately, without a pool connection) on top of the existing cross-process advisory lock.
- Client single-flight: the delegated control already ignores clicks while the same action is pending; added a full-page busy overlay ("Resetting the demo. This takes about a minute; please keep this page open.") shown for the whole request, removed on failure so the user can retry, kept until the redirect on success.
- Test: `test/r4-demo-reset-single-flight.test.ts`.
