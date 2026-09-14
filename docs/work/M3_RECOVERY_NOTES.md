# M3 Recovery Notes

This note records recovery gaps from the interrupted Qoder Web Review dump. It is intentionally not an implementation plan.

## Recovered

- M3 task context was restored to docs/work/ACTIVE_TASK.md.
- Migration sections 0030–0038 and 0040–0049 were restored from the dump under src/persistence/postgres/migrations/.

## Unresolved or missing

- Migration 0039 was not present in the dump. No file was invented.
- The dump named these TypeScript files but did not contain their contents:
  - arrangements.ts
  - index.ts
  - pgArrangementRepositories.ts
  - pgArrangementReadQueries.ts
  - arrangementCommands.ts
  - m3Seed.ts
  - m3Arrangements.pgtest.ts
  - m3IdentityMoney.pgtest.ts
  Their exact repository paths are not established by the dump. Existing repository conventions suggest contracts/v2/repository, persistence/postgres/repositories, persistence/postgres/queries, persistence/postgres/commands, and postgres-integration, but no placeholder files were created.

## Follow-up required

- 0046_cost_allocations_fx.sql was preserved exactly as pasted. The cost_allocations definition contains visibly malformed SQL around the actual-evidence and FX-citation constraints, and the file later adds a duplicate FX foreign key. Do not treat this migration as verified or repair it as part of salvage until the missing source is recovered.
- Run the migration/typecheck/test gates only after the missing command, repository, query, seed, and integration-test sources are recovered or explicitly waived.

