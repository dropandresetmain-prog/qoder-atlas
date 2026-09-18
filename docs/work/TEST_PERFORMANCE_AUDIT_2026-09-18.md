# Test and dev-startup performance audit

Date: 2026-09-18

Scope: read-only investigation on the B1 code line. No implementation was performed.

Status: **H1-H4 IMPLEMENTED** on `fix/test-dev-performance-h1-h4`. I1-I4 remain Investigate Now.

## Implementation measurements (H1-H4)

| Item | Before | After |
|---|---:|---:|
| CURRENT serial (`--test-concurrency=1`) | ~30.4s audit / 25.8s this machine (811 tests) | n/a (still available as override) |
| CURRENT bounded (`concurrency=4`) | n/a | **6.5s** duration / 811 pass |
| `npm test` wall (boundary + CURRENT) | ~37.5s (7.1s + 30.4s) | **13.8s** (198 files classified) |
| inboxOutbox claim/publish (clean) | drain-then-claim | **25ms** round-trip |
| inboxOutbox + 2000 residue rows | pathological row-by-row drain (~22.4 min at ~40k) | **592ms** isolate + real claim/publish |
| Same already-provisioned workspace boot | seconds (audit) | **230-382ms** |
| Fresh AiT workspace boot | ~1-2 min (audit) | **73.6s** materialize + 67-journey baseline |
| Repeat boot of that same new workspace | n/a | **377ms** |

This is not a product milestone. Current product sequencing remains Founder B1 -> B2.

## Executive diagnosis

Three separate clocks were being conflated:

1. **CURRENT**: 72 files / 802 tests, ~30.4s, plus ~7.1s import-graph boundary gate.
   Serial file execution is historical harness policy, not a current no-DB/no-browser
   correctness requirement.
2. **Clean PostgreSQL gate**: 56 files / 522 tests, ~21.4 min. Most cost is real,
   repeated AiT-world acceptance setup plus foundation integration tests.
3. **Dirty repeated PostgreSQL gate**: a long-lived shared test database accumulates global
   PENDING outbox rows. One run spent ~22.4 min inside `inboxOutbox.pgtest.ts` draining
   unrelated rows one-by-one.

Dev boot is separately slow only when a fresh AiT workspace is provisioned. Same database
+ same already-provisioned workspace boots in seconds.

## Key measurements

| Item | Measurement |
|---|---:|
| CURRENT | 72 files / 802 pass / ~30.4s |
| Boundary gate | 196 files classified / ~7.1s |
| Clean PostgreSQL gate | 56 files / 522 pass / ~21.4 min |
| Dirty outbox drain | ~22.4 min before kill |
| Live dirty DB at audit | ~40,137 PENDING outbox rows / ~1,200 workspaces |
| Per-file first `sharedTestPool()` | ~1.08s |
| Already-applied migration check | ~10ms |
| B1 real Sarah | ~117-155s |
| AiT 67-journey baseline | ~10.8s |
| Empty product boot | ~2.1s |
| Fresh AiT materialization | ~47s measured in product-baseline path |

## Clean PG gate attribution

Approximate expensive buckets:

- F1 three AiT crash worlds: ~180s;
- N1 two corridor worlds: ~131s;
- B1 Sarah real recovery: ~117s;
- T2 disruption world: ~74s;
- F3/F5/F7 repeated AiT setup: ~163s combined;
- product baseline + interrupt/replay: ~116s;
- migration DB proofs: ~39s;
- per-file readiness tax: ~60s;
- remaining M2-M8/other PG: ~362s.

This means the clean 21-minute gate is not primarily a Postgres engine defect. It is a mix
of intentional acceptance fidelity, repeated world construction and harness overhead.

## Outbox residue root cause

Every committed domain command writes transactional outbox rows. That is required
architecture.

Normal runtime currently has no outbox publisher, so tests leave those rows PENDING.

`claimNextOutboxRow` claims globally by created_at, not by workspace. The
`inboxOutbox.pgtest.ts` claim/publish test therefore drains all older unrelated PENDING
rows before it can deterministically claim its own row.

The drain performs roughly two database round trips per row: claim one, publish one.
At ~40k rows this becomes pathological.

Workspace IDs isolate domain state; they do **not** isolate this global queue claim.

## Dev startup

Normal boot performs before the real application server replaces the early health listener:

- PostgreSQL composition + migrations;
- workspace ensure;
- configured dataset provision;
- baseline evaluation for unassessed journeys;
- workspace authority provisioning;
- runtime-services startup.

Cases:

- fresh DB + fresh AiT workspace: full migration + materialize + baseline + authority,
  roughly 1-2 minutes;
- existing DB + same workspace: already provisioned, zero baseline work, seconds;
- existing DB + new workspace: full materialize + baseline again.

The old Founder recipe's fresh UUID intentionally forced the expensive case.

Current config caveat: PG target variables and `NORTHSTAR_DEMO_DATASET_DIR` are read from
`process.env`, not populated by the auxiliary `.env.local` merge.

## Triage

### Act Now

- **H1 / very high:** isolate `inboxOutbox.pgtest.ts` with test-only queue cleanup or an
  ephemeral DB. Preserve production global claim semantics.
- **H2 / very high:** sticky daily `PG_TARGET_WORKSPACE_ID`; make target/demo env loading
  convenient so normal restart does not accidentally create a new world.
- **H3 / high:** bounded CURRENT-suite concurrency (4-8), PG remains serial.
- **H4 / medium:** docs/scripts must not imply raw `node --test` is the canonical suite.

### Investigate Now

- **I1 / high:** F3/F5/F7 each pay a full AiT provision for bounded assertions.
- **I2 / medium:** `productBaselineWorld` second materialization/replay cost.
- **I3 / medium:** optional separate heavy `postgres-world` checkpoint list while
  preserving full coverage.
- **I4 / low-medium:** `waitUntilReady` ~750ms sleep per PG file after server is already
  healthy.

### Park

- **P1:** limited PostgreSQL file parallelism only after H1/isolation/connection budget.
- **P2:** materializer/SERIALIZABLE product tuning.
- **P3:** production outbox publisher; this is architecture/product work, not a test fix.

### Ignore / Accept Risk

- B1 Sarah real-world proof;
- F1 crash worlds;
- N1 corridor worlds;
- real evaluator/overlay closure;
- checksummed migrations and ephemeral migration DBs;
- SERIALIZABLE transaction correctness.

## Recommended engineering sequence

H1 -> H2 -> H3 -> H4, then remeasure before deciding whether I1-I4 justify implementation.

Do not run the 21-minute PG gate after every harness edit. Use focused tests for each
change and one coherent broader gate after the set is integrated.
