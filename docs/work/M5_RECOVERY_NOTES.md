# M5 Recovery Notes

This note records recovery gaps from the interrupted Qoder Web Review dump. It is intentionally not an implementation plan.

## Historical recovery snapshot

- Migration sections `0070` through `0086` were restored under `src/persistence/postgres/migrations/`.
- The pasted migration text was preserved as supplied wherever possible.
- The existing staged M3 recovery files were left untouched.

## Historical gaps (closed below)

The following migration files contain visibly incomplete or interleaved pasted content. A recovery comment was added at the top; no missing SQL was invented:

- `0074_rule_sets.sql`: rule-expression and publication-freeze function/trigger fragments are interleaved.
- `0077_information_records.sql`: only fragments of the information-record definition are present.
- `0078_information_versions.sql`: declarations and the information-version subtype checker are interleaved or incomplete.
- `0081_regulatory_publications.sql`: foreign-key constraint declarations are duplicated and mismatched.

These files must not be treated as migration-gate evidence until the original source is recovered.

## Historical unresolved path (closed below)

The dump begins with an `M5_ACTIVE_TASK` document, but it does not identify a repository path. The conventional path is `docs/work/ACTIVE_TASK.md`; that file currently contains staged M3 recovery work, so it was not overwritten during this salvage. The M5 task document remains unresolved.

## Historical missing changes (recreated below)

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

## Recovery completed

The malformed SQL and missing M5 implementation were repaired on the isolated
`milestone-m5-recovered` branch from recovery SHA
`b2ed9b56da72cf71946fde6cc27da9dc56b45c97`. The missing active-task document
is now tracked separately at `docs/work/M5_ACTIVE_TASK.md`, and the package
evidence is in `docs/refactor/evidence/M5.md`. M2 evidence fixtures and subtype
assertions were updated for the additive `0085` FK closure. The shared
`docs/work/ACTIVE_TASK.md` was intentionally left untouched.

## Promotion follow-up

- Integrator must inspect the exact clean branch/head and reconcile the M5 read ports with M6.
- M5 source-sync-state mutation and richer objective target/disposition commands remain deferred, as recorded in `docs/refactor/evidence/M5.md`.
- The shared `docs/work/ACTIVE_TASK.md` remains intentionally untouched.
