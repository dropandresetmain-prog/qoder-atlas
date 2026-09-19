# Pool exhaustion after heavy reassessment: investigation (INVESTIGATE NOW)

Branch `r4f/f3-baseline-reliability`. Verdict: **exhaustion is not reproducible in the normal Sarah flow or in repeated reset/disrupt**; one real, related reliability defect was found and fixed (a dropped PostgreSQL connection killed the whole process).

## Method

Server: `node src/main.ts`, REPLAY, own database, default pool (`max` 10), Qwen composed LIVE. A sampler read `pg_stat_activity` (state counts and oldest `xact_start`) plus an Overview GET every ~2 s.

1. Single Sarah disrupt, 15 samples: <= 5 connections, all idle after ~3 s, no idle-in-transaction, GET / 0.2 s.
2. Three back-to-back cycles of `reset -> disrupt Sarah -> settle` with the sampler and Overview polling running: peak 8 connections (limit 10), `idle in transaction` seen only transiently (oldest xact age < 1 s, 13 of 60 samples, always one connection), connections drained back to 2-4 idle after each cycle. Overview latency rose to 6-8 s only while a reset was running.
3. Burst: 30 concurrent Overview requests fired while a reset was mid-provisioning: all 30 returned 200 in 1.0-2.2 s; the reset itself finished 200 in 82 s.
4. Static review of every `pool.connect()` site (`pgUnitOfWork`, `pgReadSession`, `pgAssessments`, `pgFactAssembler.withProjectionSnapshot`, `pgCurrentState`, `demoReset`, `inbox`, execution worker): every checkout is released in `finally`; no callback that holds a client acquires a second one (`PgCurrentState` explicitly reuses the ambient client); the planning coordinator calls Qwen/provider code outside any transaction; drain and baseline capture concurrency is 4 and each capture holds exactly one client.

## What can look like exhaustion

- `pg.Pool` has no `connectionTimeoutMillis`, so when demand exceeds `max` (reset holds 1 client for ~70 s, baseline capture 4, reassessment drain 4, HTTP polling 1-3) callers queue silently. It is saturation and slowness, not a leak; it clears by itself (verified in step 3). Not changed: adding a timeout would convert waits into errors.
- The reset deletes the workspace's rows while background workers (reassessment drain, case progression, Qwen) are still running against it.

## Real defect found and fixed: process crash on a dropped PG connection

During the investigation the shared test PostgreSQL server crashed a backend (`server process ... exited with exit code 2`, crash recovery, all backends terminated; cause outside this app, the container is shared by several agents). The app died with `Error: Connection terminated unexpectedly ... Emitted 'error' event on Client instance`. node-postgres only listens for `error` on idle clients; a checked-out client has no listener, so the unhandled event terminated Node. No `pool.on('error')` existed anywhere.

Fix: `attachPoolErrorGuards` in `src/persistence/postgres/pool.ts` (`pool.on('error')` and a per-client `error` listener on `connect`), applied in `createTargetPool`. Proof: with the guard, `pg_terminate_backend` on all app connections during a reset gave a 500 to that request (`terminating connection due to administrator command`), logged `[pg] ... client discarded`, the process stayed up, GET / kept returning 302, and a following reset returned 200 (reset is idempotent and recovers an interrupted run). Test: `test/pg-pool-error-guards.test.ts`.

## Disposition

Exhaustion itself: **PARK** (no repro after bounded diagnostics; evidence above). If it recurs, capture `pg_stat_activity` grouped by `state` and `wait_event` and `pool.totalCount/idleCount/waitingCount` at the time; a first mitigation to consider is a bounded `connectionTimeoutMillis` plus a lower reset/baseline concurrency, not a code path fix.
