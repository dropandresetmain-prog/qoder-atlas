# Atlas dispatch crash recovery (R4-F2d, review N1)

Branch `r4f/safety-n1-n4`. Reuses the existing `execution_attempts` state machine; **no migration**, no parallel state machine.

## Problem
Between `createOrder` and the dispatcher's return the provider `orderRef` lived only in process memory. A crash while the attempt was `DISPATCHING` left it stuck forever: `loadCandidates` excludes any non-`PREPARED` intent and the reconcile sweep only scanned `OUTCOME_UNKNOWN` / `RECONCILIATION_REQUIRED`.

## Design
1. **Durable checkpoint before pay.** `PgExecutionWorker.dispatchClaimed` hands the dispatcher a `DispatchControl.checkpointRequestRef(ref)`. It writes `execution_attempts.request_ref = 'atlas:order:<orderRef>'` (existing column, already the reconcile key) with `WHERE status='DISPATCHING' AND claim_token=$ AND fencing_token=$ AND (request_ref IS NULL OR request_ref=$ref)` and refreshes the lease. The dispatcher calls it right after `createOrder` returns an orderRef and **before** the ceiling gate and `payOrder`.
2. **Checkpoint failure => no pay.** If the write does not land (fenced / lease taken over / DB error) the dispatcher returns `LOST_RESPONSE(orderRef)` and never calls `payOrder`. The order stays HELD at the provider; the attempt goes `OUTCOME_UNKNOWN` (if its own transition still lands) or stays `DISPATCHING` and is swept.
3. **Stale DISPATCHING is reconcile-only.** `claimForReconciliation` now accepts `DISPATCHING`/`DISPATCHED` **only when `lease_expires_at` is NULL or past** (a live dispatcher is never taken over). It moves the attempt `DISPATCHING|DISPATCHED -> RECONCILIATION_REQUIRED`, bumps `fencing_token` (so the dead dispatcher's late writes are fenced) and stamps `last_error = 'stale_dispatch_lease_expired: ...'`. `runExternalReconciliation` scans such attempts. Nothing returns them to `PREPARED`/`CLAIMED`: `loadCandidates` still excludes them, `claimNext` only claims `PREPARED` / expired `CLAIMED` with `request_ref IS NULL`.
4. **Reconcile uses the durable reference, read-only** (`retrieveOrder` only). No reference (crash before/at create, or create timeout) => `STILL_UNKNOWN` (RECONCILIATION_REQUIRED, human/provider owned); no provider call at all.
5. **Truthful classification on reconcile:** TICKETED -> `OBSERVED_SUCCESS` (+ observation + canonical update); CANCELLED/FAILED -> `OBSERVED_FAILURE`; PAID/TICKETING/UNKNOWN -> unknown; **HELD -> unknown until the hold lapsed unpaid** (`holdExpiresAt + 60 s`), then `OBSERVED_FAILURE`. (Previously HELD was reported as a failure at once, which could not exclude a pay request that was in flight when the dispatcher died.)

## State transitions added or changed
| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| DISPATCHING | DISPATCHING (request_ref set) | `checkpointRequestRef` | claim_token + fencing_token match, request_ref NULL or identical |
| DISPATCHING / DISPATCHED | RECONCILIATION_REQUIRED | `claimForReconciliation` (sweep) | `lease_expires_at IS NULL OR < now()`; fencing_token + 1 |
| RECONCILIATION_REQUIRED | OBSERVED_FAILURE | reconcile HELD past hold expiry (new) | unchanged transition, new lookup rule |

`ExternalDispatcher` gained a second argument (`DispatchControl`); existing dispatchers ignore it.

## Fault injection
`ExternalOfferExecutionDeps.faultInjection` (TEST-ONLY, never set by `composeOfferExecution`): points `AFTER_CREATE`, `AFTER_CHECKPOINT`, `AFTER_PAY`, `BEFORE_FINAL_WRITE`. A never-resolving promise = process death. Proved by `postgres-integration/r4AtlasCrashRecovery.pgtest.ts` (A-E, G, H).

## Also fixed (N8)
Pending canonical updates are reported in `ExternalExecutionReport.canonicalPending` instead of a fake `FAILED attemptNumber 0` outcome, and `canonicalUpdates` counts only updates that actually landed (not idempotent re-checks).

## Remaining gaps
* A crash between the provider accepting `order.do` and the checkpoint (fault point A) leaves no reference: Atlas has no lookup by client reference (see `atlas-create-idempotency-decision.md`), so a human must find the order at the provider. The order is an unpaid hold and lapses on its own.
* A live dispatcher slower than the lease (60 s, refreshed at the checkpoint) could be swept; its later writes are fenced and it can no longer pay, so the failure mode is "unknown", never a double action.
