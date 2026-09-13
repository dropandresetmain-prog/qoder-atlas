# ACTIVE TASK — M2 People, Journeys, coordination and credentials

## Goal

Materialize the M2 target domain (stable Traveller identity, Organisation/
Principal governance, Trip/Journey ownership, JourneyItems and intended visits,
coordination groups, typed credentials, support requirement vs. assignment) on
top of the accepted C1 PostgreSQL foundation. Isolated: no production runtime
wiring, no dual-write, no cutover.

## Base

Branch `milestone-m2`, worktree `C:/Dev/qoder-atlas-m2`, exact base SHA
`aab3d9f0b7ec1a7c78451da3928d2f4a7d0a461d` (= `origin/data-structure-refactor`
at dispatch, verified; clean tree). C1's four closures must not regress:
typed `(kind,id)` identity, fail-closed subtype registration, retry-safe
`execute()` callbacks, JSON-compatible `CommandReceipt.resultRef`.

## Locked design decisions

1. **Subtype enforcement becomes a registry-dispatched extension point.** M1
   hard-coded one `ELSIF` branch and told M2-M5 to `CREATE OR REPLACE` the whole
   function. Parallel M3/M4/M5 lanes doing that would each delete the others'
   branches at integration. Migration `0010` replaces the body with a dispatcher
   over a new `subject_subtype_checkers(kind, checker_function)` registry; M1's
   WORKSPACE rule moves verbatim into `enforce_subject_subtype_workspace()`.
   Every later lane adds only its own checker function + one registry INSERT
   inside its own file. A kind with no registry row still fails closed.
2. **Children are registry subjects governed by their parent's head.**
   `JOURNEY_ITEM` gets a `domain_subjects` row whose `aggregate_id` is its
   Journey's id, so §9.3 "child updates require root revision" is expressed by
   the existing head machinery rather than a second version field. Its checker
   enforces `journey_items.journey_id = aggregate_id`.
3. **Workspace-scoped composite FKs everywhere**: PK `(workspace_id, id)` and
   every reference FK is `(workspace_id, <ref>_id)`, so a cross-workspace UUID
   cannot be inserted at all (§1).
4. **FK deferral is explicit, not silent.** `jurisdictions`, `places`,
   `transport_services`, `resources`, `participations`, `evidence_records`
   belong to M3/M4/M5's reserved ranges. M2 stores those references NOT NULL per
   the frozen v2 contracts with a type + reverse-lookup index and no FK; the
   owning lane adds the composite FK in its own migration. Every deferral is
   listed in `docs/refactor/evidence/M2.md` §7A "Deferred foreign keys ledger"
   with the exact `ALTER TABLE` to run. No placeholder table is created outside
   the 0010-0029 allocation and no range is borrowed.
5. **Support requirement vs. fulfilment is a database property.**
   `accompaniment_requirements` is append-only (PK `(workspace_id, id, version)`,
   `accompaniment_requirements_immutable` rejects UPDATE/DELETE via
   `forbid_mutation()`), `support_assignments` pins `(constraint_definition_id,
   constraint_definition_version)` through composite FK
   `support_assignments_requirement_fk` to that key, and the assignment tables
   carry no coverage/eligibility/minimum-count column at all. Deferred trigger
   `support_assignments_consistency_assert` rejects an empty assignee set and any
   assignee outside the pinned version's `accompaniment_eligible_supporters` row
   set. Weakening is therefore impossible in SQL, not just in the handler.
6. **M2's accompaniment requirement table is the §3 typed table for
   `src/domain/v2/trip/support.ts`** (which `docs/refactor/CONTRACTS.md` §2
   maps to "Schema §3" = M2's allocation). M5's generic
   `constraint_definitions`/`constraint_operands` (§6) stays untouched; whether
   the accompaniment type later registers as one of its typed kinds is an
   integration question recorded for M5/M6, not something M2 pre-empts.
7. **Retry-safe callbacks.** Every id, timestamp and derived value a handler
   writes is generated *before* `uow.execute()`, and the callback body is a
   deterministic function of `(envelope, ctx)`. **Proven, not just asserted:**
   `m2People.pgtest.ts` "a handler replayed after a forced 40001 leaves the same
   rows as one that never failed" wraps a real `UnitOfWork` so the first attempt
   of `APPEND_CREDENTIAL_VERSION` performs the handler's own writes and is then
   aborted by a server-raised `40001`; it asserts the callback ran exactly twice,
   the command still committed, and the resulting typed row set is identical to a
   control run that never conflicted. The companion concurrency case covers the
   race that produces such a conflict in practice. Residual, recorded as G7: one
   handler per aggregate family is instrumented, not all 34.
8. **Command result replay** uses the C1 convention unchanged:
   `serializeCommandResult(value)` into `resultRef`, replayed by
   `parseCommandResult`. No opaque references.
9. **Shared write helpers** live in
   `src/persistence/postgres/commandSupport.ts` (head create/advance CAS,
   subject registration, change record + outbox append, receipt build). M1's
   `workspaceCommands.ts` is deliberately left untouched so no accepted-C1 path
   changes; adopting the helper there is a later cleanup.
10. **Raw SQL stays inside `src/persistence/postgres/**`.** Repository/command
    *ports* are type-only modules under `src/contracts/v2/repository/**`, so
    nothing outside the persistence tree imports `pg` or `currentTransactionClient`.

## Migration allocation used (0010-0029, exactly)

`0010` subtype checker registry · `0011` organisations/principals/memberships ·
`0012` travellers/names/contacts · `0013` profile assertions ·
`0014` travel credentials/versions · `0015` typed credential details ·
`0016` credential links/travel history · `0017` traveller relationships ·
`0018` responsibility assignments · `0019` authority grants/actions/scopes ·
`0020` trips · `0021` journeys · `0022` journey items · `0023` item details ·
`0024` intended visits · `0025` credential selections/scopes ·
`0026` coordination groups/memberships/item links · `0027` accompaniment
requirements/eligible supporters · `0028` support assignments/assignees/scopes/
handoffs · `0029` M2 reverse-lookup index set.

## Activated SubjectKinds

ORGANISATION, PRINCIPAL, TRAVELLER, TRAVELLER_RELATIONSHIP,
RESPONSIBILITY_ASSIGNMENT, AUTHORITY_GRANT, TRIP, JOURNEY, JOURNEY_ITEM,
COORDINATION_GROUP, SUPPORT_ASSIGNMENT. All other non-WORKSPACE kinds remain
fail-closed.

## Checklist

- [x] Verify origin head == accepted C1 SHA; fresh worktree + branch.
- [x] Read AGENTS.md, plan M2, CONTRACTS.md, MIGRATION_MAPPING.md, M1.md,
      closure F03-F06/F10-F12/F15/F18, logical schema §1-§3/§9-§12, v2 contracts,
      M1 persistence code.
- [x] Migrations 0010-0029. Evidence: `npx tsx --test
      postgres-integration/migrate.pgtest.ts` -> 4/4 pass; the whole
      0001-0029 range applies to an empty database, re-run is a no-op, a failing
      migration rolls back, checksum drift detected.
- [x] Repositories + ports + command handlers. Evidence: `src/contracts/v2/
      repository/{people,travel,queries,index}.ts`; 6 repositories
      (`pg{Traveller,Governance,Trip,Journey,Coordination,Support}Repository`),
      7 read-query classes, `commands/{people,travel,support}Commands.ts` =
      34 handlers, `commandSupport.ts`.
- [x] `npm run typecheck` green. **0 errors, exit 0.** The 18 errors that were
      live in `postgres-integration/m2Travel.pgtest.ts` are fixed; the suite runs
      under `tsx`, which had been hiding them.
- [x] `postgres-integration/m2People.pgtest.ts` — written by this lane (the
      people/credential suite Lane P never produced). **38/38 pass**, including
      the G7 replay double and both credential kind/detail layers.
- [x] Unit tests (pure logic) + real-PostgreSQL integration tests.
      `test/northstar-v2-m2-invariants.test.ts` **12/12**; M2's four PostgreSQL
      suites (`m2People` 38, `m2SubtypeIntegrity` 15, `m2Support` 12,
      `m2Travel` 11) **76/76**.
- [x] M1 pgtest suite still green. Its 28 tests pass inside the canonical
      serial `npm run test:postgres`: **104 tests / 104 pass / 0 fail, exit 0**.
- [x] build / lint / gate:anti-hardcoding. `npm run build` exit 0, `npm run lint`
      exit 0, `npm run gate:anti-hardcoding` **VERDICT: CLEAN** (239 files) exit 0.
- [x] `docs/refactor/evidence/M2.md`, CONTRACTS.md C1-clarification note,
      MIGRATION_MAPPING.md deferral ledger, this file.
- [x] Legacy `npm test`, one uncontended run: **882 tests / 880 pass / 2 fail**,
      exit 1. `R1` is the pre-existing baseline failure the brief told this lane
      not to repair; the second is `R2.3: continue hero flows from populated
      entry` dying as `"change_request: fetch failed"` (`500 !== 200`). Three
      runs gave three different failure sets — recorded as gap **G9**, see
      `docs/refactor/evidence/M2.md` §11.
- [x] Exact-path stage: 52 named paths, index verified clean of anything
      unexpected.
- [x] Implementation commit `aae84a7ef5f974771b64faee92ccc83da8dfa074` on
      `milestone-m2`, parent `aab3d9f…` (the accepted C1 base). 52 files,
      +18413/−110.
- [ ] Publication of `milestone-m2` to origin is this lane's terminal step, so it
      is verified with `git ls-remote origin milestone-m2` in the completion
      report rather than claimed in a commit. No merge into
      `data-structure-refactor`.

## Critical constraints

- No M3 service/reservation, M4 programme/place/jurisdiction, M5
  knowledge/requirement/evidence table may be created.
- No production composition import (`src/app`, `src/main.ts`, `src/engine`,
  `src/server`, `src/operational`) may reference v2 or persistence/postgres.
- No scenario/demo facts: traveller ids are supplied UUIDs, never event- or
  fixture-derived.
- Migration range is 0010-0029 and nothing else.

## M2 execution log (facts that must survive compaction)

- Cross-lane shared files added, must be reported: `.gitattributes`
  (`*.sql text eol=lf`) — without it `core.autocrlf=true` makes a fresh Windows
  worktree hash M1's accepted migrations differently and every migrated database
  reports checksum drift; and `0019` adds
  `CREATE UNIQUE INDEX domain_subjects_workspace_id_id_kind_uidx` on M1's
  registry table so any lane can express a TypedRef as a discriminating FK
  (additive, no new data restriction).
- Naming convention: deferred `CREATE CONSTRAINT TRIGGER` names use the
  `_assert` suffix. `CREATE CONSTRAINT TRIGGER <table>_<col>_check` collides with
  PostgreSQL's auto-generated inline-CHECK constraint name
  (`pg_constraint_conrelid_contypid_conname_index`).
- Contract divergence to record: §3 names `purpose` on coordination_groups, the
  frozen `CoordinationGroupSchema` has no such field -> nullable column, left NULL
  by the repository.
- Architecture gaps reported, not worked around: (1) §2 "Grant issuer must have
  issuance authority" — no policy table in 0010-0029; hook = deferred trigger on
  `authority_grants` INSERT owned by M5/M6; (2) `E_AUTHORISATION` has no §2 typed
  detail table, so its subtype checker returns early; (3) `SubjectIdSchema` is a
  constrained string, not uuid, so `actorPrincipalId`/provenance columns are text
  without FK to `principals`.
- Deferred-FK ledger (no FK in this range, index present, the exact `ALTER TABLE`
  published in `evidence/M2.md` §7A): `jurisdictions`, `places`,
  `transport_services`, `resources`, `participations`, `evidence_records`.

- A green pgtest suite is **not** typecheck evidence. Those files run through
  `tsx`, which erases type errors, so `npm run typecheck` must be read separately
  before any completion claim. That is how `m2Travel.pgtest.ts` was simultaneously
  "11 pass" and carrying 18 `tsc` errors; the errors are now fixed and typecheck is
  0.
- Lane P (people / governance / credentials) stopped at its subagent turn limit
  **after** its code landed (`peopleCommands.ts`, `pgTravellerRepository`,
  `pgGovernanceRepository`, the three read-query classes) but **before** writing
  `postgres-integration/m2People.pgtest.ts`. This lane produced that file itself:
  38 tests, all passing.

## Next action

M2 is complete on this worktree. The only step left here is exact-path staging,
the two commits and `git push -u origin milestone-m2` (no merge into
`data-structure-refactor`). For the integrator: M2 is the base M3/M4/M5 branch
from, and the two decisions it deliberately leaves open are gap G1 (no read-only
transaction on `UnitOfWork`, so reads run outside the command's snapshot) and the
`G-P17` payload-error-shape divergence between the people lane and the
travel/support lanes.
