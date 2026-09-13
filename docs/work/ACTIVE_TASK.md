# ACTIVE TASK — M1 PostgreSQL + durability foundation

## Goal
Implement the isolated PostgreSQL + PostGIS persistence foundation behind
the frozen C0 contracts (`src/contracts/v2/command/{domainCommand,unitOfWork}.ts`,
`src/domain/v2/shared/identity.ts`). SQLite stays the active legacy runtime;
no cutover/dual-write in M1.

## Base SHA
`b870abd6c172fc18e3b9e5d776526808a64417bf` (branch `data-structure-refactor`,
verified against `origin/data-structure-refactor` at dispatch — local HEAD
matched exactly, no drift).

## Key implementation decisions (recorded here so a resumed session doesn't
re-litigate them)

1. **Driver: `pg` (node-postgres) v8.23.0.** Maintained, explicit parameterized
   SQL (`$1..$n`), explicit `BEGIN/COMMIT/ROLLBACK` via a checked-out `Client`
   from a `Pool`, no query builder/ORM hiding invariants. `pg-format` not
   needed — every value goes through parameterization.
2. **No demo/M2 domain table created in M1's own migration range.** The
   `workspaces` table (already M1-owned per `MIGRATION_MAPPING.md` §5) plus
   `domain_subjects`/`aggregate_heads` IS the demonstration aggregate for
   revision/CAS/idempotency/concurrency proofs — a `RENAME_WORKSPACE` command
   exercises the full UoW path without preempting M2's `organisations` table.
3. **Idempotency claim without a mutable claim row:** `pg_advisory_xact_lock(hashtext(workspace||namespace||key))`
   at the top of `UnitOfWork.execute`, then `SELECT` existing `command_receipts`
   row; if absent, run `fn`, insert the (immutable) receipt. Advisory lock
   releases automatically at transaction end. Keeps `command_receipts`
   append-only per schema §8.
4. **Revision CAS:** `UPDATE aggregate_heads SET revision = revision + 1 WHERE
   workspace_id=$1 AND aggregate_id=$2 AND revision=$3 RETURNING revision` —
   zero rows back = `STALE_AGGREGATE_REVISION`. Heads locked first via
   `SELECT ... FOR UPDATE` in ascending `aggregate_id` order (deadlock-free
   stable ordering) inside the same transaction.
5. **SERIALIZABLE predicate-conflict/retry demonstration:** `ScopeGenerationLedger.advance`
   runs at `SERIALIZABLE` isolation; a `40001` SQLSTATE triggers bounded retry
   (3 attempts) with a fresh transaction and re-read state each time.
6. **Migration runner:** custom, in `src/persistence/postgres/migrate.ts`.
   Bootstraps `schema_migrations` via idempotent `CREATE TABLE IF NOT EXISTS`
   (not itself a numbered migration — nothing to checksum before it exists),
   then applies `migrations/000N_*.sql` in order inside one transaction each;
   sha256 checksum recorded; already-applied migrations are checksum-verified
   on every run and a mismatch throws (fails visibly, does not proceed).
7. **Migration numbering (M1's reserved 0001-0009 per `MIGRATION_MAPPING.md` §5):**
   0001 extensions (postgis, pgcrypto) · 0002 workspaces · 0003 domain_subjects
   + aggregate_heads (+ subtype-enforcement trigger, extension point documented
   for M2-M5) · 0004 command_receipts · 0005 change_records · 0006
   scope_generations · 0007 inbox_deliveries + inbox_work · 0008 outbox ·
   0009 legacy_id_map + migration_runs.
8. **Composition seam:** `src/persistence/postgres/composeTargetRuntime.ts` —
   NOT wired into `src/main.ts`/`src/app/compose.ts`. Only the isolated test
   harness and an explicit opt-in script import it. Default runtime composition
   is untouched.
9. **Test Postgres instance:** local Docker, `postgis/postgis:16-3.4` image,
   via `docker-compose.postgres-test.yml` (isolated port, isolated volume,
   torn down after test runs). Documented in `docs/ENVIRONMENT.md`.

## Checklist
- [x] Verify branch/head against origin; read AGENTS.md + M1 required docs.
- [x] Inspect current persistence/contracts seams (`src/persistence/**`,
      `src/contracts/repositories.ts`, `src/contracts/v2/command/**`,
      `src/domain/v2/shared/identity.ts`, `src/engine/mutation.ts`, `src/main.ts`).
- [x] Add `pg` dependency; record rationale (done above, needs package.json).
- [x] Docker Compose test Postgres+PostGIS service + npm scripts.
- [x] Ordered checksummed migrations 0001-0009.
- [x] Migration runner + checksum-drift/incomplete-migration failure tests.
- [x] `src/persistence/postgres/config.ts` (env validation, isolated from `loadConfig()`).
- [x] `src/persistence/postgres/pgUnitOfWork.ts` + head reader + idempotency ledger + scope ledger.
- [x] Reference `workspaces` command handler (no direct SQL outside persistence/postgres).
- [x] Inbox/outbox durable tables + claim/lease/fencing helpers.
- [x] Integration tests: FK/tenant/subtype, stale/equal revision, concurrent
      writers (2+ real connections), idempotency replay/hash-mismatch, atomic
      commit/rollback, inbox/outbox durability + claim races + fencing +
      expiry recovery, SERIALIZABLE retry, migration checksum/order failure.
      **24/24 pass against real PostgreSQL 16.4 + PostGIS 3.4.3 (two clean
      independent full runs).**
- [x] `npm run typecheck/build/lint/gate:anti-hardcoding` — all clean.
- [x] `docs/refactor/evidence/M1.md`, `docs/ENVIRONMENT.md` update.
- [x] Full SQLite/credential-free regression baseline (`npm test`) — 869/870,
      identical pre-existing failure to M0 (`integration.r1.test.ts`,
      unrelated clock-jitter). `postgres-integration/**` confirmed absent
      from default `npm test` discovery (Postgres container was stopped for
      this run to prove no accidental dependency).
- [ ] Commit (do not push without explicit ask — confirm with user first).

## Current checkpoint
M1 complete. All checks green: typecheck/build/lint/anti-hardcoding clean;
24/24 real-PostgreSQL integration tests pass (reproduced from a cold
container start after fixing a genuine startup-race bug in the test
harness); full SQLite baseline 869/870 (no regression vs. M0). Evidence
written to docs/refactor/evidence/M1.md. Ready to report completion and ask
about commit.

## Mid-course correction worth remembering
Naming Postgres-only test files `*.pgtest.ts` did NOT exclude them from the
default `npm test` — Node's `node --test` default discovery sweeps in every
file under any directory literally named `test`/`tests`, regardless of
filename. Had to relocate the whole suite to a repository-root
`postgres-integration/` directory (outside `test/`) and extend
`tsconfig.json`/`eslint.config.js` to still cover it. Verified by rerunning
the full baseline with the Postgres container stopped.

## Critical constraints
- Do not modify `src/main.ts` / `src/app/compose.ts` default composition.
- Do not create M2-M5 domain tables (organisations, travellers, trips, ...)
  in M1's migration range.
- No dual-write, no live SQLite data migration.
- External calls never inside DB transactions (N/A for M1 — no provider calls
  in persistence foundation, but keep UoW.execute's `fn` free of any I/O
  beyond the same Postgres transaction).
- Concurrency evidence must use 2+ genuinely independent `pg` connections
  (separate `Client`s from the `Pool`, or separate Node processes) — not
  simulated single-connection interleaving.

## Next action
Add `pg` to package.json, write docker-compose test service, write migrations
0001-0009, then the migration runner.
