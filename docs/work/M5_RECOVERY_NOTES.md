# M5 Recovery Notes

This note records recovery gaps from the interrupted Qoder Web Review dump. It is intentionally not an implementation plan.

## Recovered

- Migration sections `0070` through `0086` were restored under `src/persistence/postgres/migrations/`.
- The pasted migration text was preserved as supplied wherever possible.
- The existing staged M3 recovery files were left untouched.

## Marked incomplete or malformed

The following migration files contain visibly incomplete or interleaved pasted content. A recovery comment was added at the top; no missing SQL was invented:

- `0074_rule_sets.sql`: rule-expression and publication-freeze function/trigger fragments are interleaved.
- `0077_information_records.sql`: only fragments of the information-record definition are present.
- `0078_information_versions.sql`: declarations and the information-version subtype checker are interleaved or incomplete.
- `0081_regulatory_publications.sql`: foreign-key constraint declarations are duplicated and mismatched.

These files must not be treated as migration-gate evidence until the original source is recovered.

## Unresolved path

The dump begins with an `M5_ACTIVE_TASK` document, but it does not identify a repository path. The conventional path is `docs/work/ACTIVE_TASK.md`; that file currently contains staged M3 recovery work, so it was not overwritten during this salvage. The M5 task document remains unresolved.

## Missing or unretrieved changes

The dump references these files, but their M5 changes were not included:

- `postgres-integration/m2Seed.ts` (baseline file exists; M5 evidence-pool changes are missing)
- `postgres-integration/m2People.pgtest.ts` (baseline file exists; M5 changes are missing)
- `postgres-integration/m2SubtypeIntegrity.pgtest.ts` (baseline file exists; M5 changes are missing)
- `src/domain/v2/knowledge/information.ts` (baseline file exists; M5 changes are missing)
- `index.ts` (path is ambiguous because several index files exist)
- `src/persistence/postgres/repositories/pgKnowledgeRepository.ts`
- `src/persistence/postgres/commands/knowledgeCommands.ts`
- `postgres-integration/m5SubtypeIntegrity.pgtest.ts`
- `postgres-integration/m5Knowledge.pgtest.ts`

No placeholder implementation files were created.

## Follow-up required

- Recover the exact M5 active-task path/content before replacing the current staged M3 active task.
- Recover the missing TypeScript and PostgreSQL-test changes.
- Re-run migration, typecheck, build, lint, anti-hardcoding, and PostgreSQL gates only after the malformed migrations and missing sources are resolved.
