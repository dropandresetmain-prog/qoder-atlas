# M4 — Mutable programme and geographic model — active task tracker

Working memory for this milestone only. Do not edit the shared
`docs/work/ACTIVE_TASK.md`. Re-read this file before major phases and before
completion; close checklist items only with evidence.

## Base

- Accepted common base: `data-structure-refactor`
- Exact base SHA: `71f638ed30d01e65981bdd9e5e6128ad067fbf1d`
- Worktree: `C:\Dev\qoder-atlas-m4`
- Branch: `milestone-m4`
- Verified: `git rev-parse origin/data-structure-refactor` == the exact SHA above before branching (confirmed).

## Checklist

- [x] Read AGENTS.md, IMPLEMENTATION_PLAN.md M4/M6, CONTRACTS.md, MIGRATION_MAPPING.md
      (incl. M4 allocation 0050-0069 and §7A deferred FK ledger), M2.md,
      M2_INTEGRATION_DECISIONS.md, closure §4.4, logical schema §5, frozen
      `programme.ts`, M2 subtype-dispatch pattern (0010), M2 command handler
      pattern (`travelCommands.ts`, `commandSupport.ts`, `pgUnitOfWork.ts`).
- [x] Domain additive extensions: `GeographicAreaSchema` root,
      `ProgrammeItemSchema.scheduleAuthority`/`externalSourceRef`.
- [x] Migrations 0050-0062 written (places, geographic_areas/area_versions,
      area_memberships, jurisdictions/jurisdiction_areas, events, programmes,
      programme_items, participations/participation_roles,
      resource_assignments, programme_item_external_observations, M4 reverse
      lookup indexes, M2 deferred FK closure, participation/journey
      consistency trigger).
- [x] Repository port (`contracts/v2/repository/programmes.ts`) + read-query
      port (`contracts/v2/repository/programmeQueries.ts`), additive new
      files, no edits to M2's `repository/queries.ts`/`repository/travel.ts`.
- [x] Repository implementations (`pgProgrammeRepository.ts`,
      `pgGeographyRepository.ts`, `pgResourceAssignmentRepository.ts`) +
      read-query implementation (`pgProgrammeReadQueries.ts`).
- [x] Command handlers (`programmeCommands.ts`, `geographyCommands.ts`)
      covering Event/Programme create+lifecycle, ProgrammeItem
      add/schedule-change/lifecycle/schedule-authority, external observation
      recording, Participation add/update/role, ResourceAssignment
      create/status, Place/GeographicArea/Jurisdiction create + children.
- [x] `npm run typecheck` clean at this checkpoint.
- [x] Checkpoint commit `a83e466` on `milestone-m4`.
- [x] Real-Postgres migration apply proof: `schema_migrations` contains
      `0001`-`0062` in order, no checksum drift (confirmed via direct query
      against the test container).
- [x] M4 postgres-integration test suite (`m4Programmes.pgtest.ts`,
      `m4Geography.pgtest.ts`) covering the 23 listed test areas / AT01, AT02,
      AT13, AT14, AT16 foundations. Written, then debugged against three real
      test runs (found and fixed: a parameter-property syntax Node's
      strip-types mode rejects; several test-fixture workspace-mismatch bugs
      of my own; and a real command-layer bug — see below).
- [x] Found and fixed a real bug: `updateProgrammeItemSchedule`,
      `setProgrammeItemLifecycleStatus`, `setProgrammeItemScheduleAuthority`,
      `addParticipation`, `updateParticipation`, `createResourceAssignment`
      all called `PgProgrammeRepository` methods (which require the ambient
      `uow.execute` transaction client) *before* entering `uow.execute`, to
      resolve the owning Programme for `expectedAggregateRevisions`. Fixed by
      requiring the caller to name `programmeId` explicitly (M2's own
      established pattern — `updateJourneyItem` takes `journeyId` from the
      caller, never discovers it), with an explicit ownership-mismatch check
      once the item is loaded inside the transaction. `createResourceAssignment`
      instead moved its owner-ref lookup inside the transaction (no revision
      is gated on it, so there was no reason to resolve it early).
- [x] M2 test-fixture fix for the newly-closed deferred FKs (background agent
      `a6467f19f512420a1`; diff reviewed — clean, well-reasoned, minimal).
- [x] `npm run test:postgres` full suite green (M2 + M4) — confirmed on a
      clean container after the command-layer fix: **144 tests, 42 suites,
      144 pass, 0 fail**.
- [x] `npm run lint` clean.
- [x] `npm run build` clean.
- [x] `npm run gate:anti-hardcoding` clean (247 files, 0 findings).
- [x] `docs/refactor/evidence/M4.md` written.
- [ ] Exact-path git add, commit, push `milestone-m4`. No merge.
- [ ] Completion report assembled per the 20-point structure in the
      milestone brief.

## Key architectural decisions this lane made (record now, restate in evidence)

1. **Aggregate ownership**: EVENT and PROGRAMME are independent roots.
   PROGRAMME_ITEM and PARTICIPATION are children of the PROGRAMME aggregate
   (no own `aggregate_heads` row), exactly like JOURNEY_ITEM under JOURNEY in
   M2. A schedule/place move, cancellation, reinstatement, or participation
   change therefore advances exactly one revision counter: the Programme's.
   This is the literal mechanism behind "one canonical programme change."
2. **PLACE/JURISDICTION have no revision** in the frozen contract (`PlaceSchema`/
   `JurisdictionSchema` carry no `revision` field) — they are create-once root
   subjects in M4's scope; additive children (external refs, associations,
   jurisdiction-area links) are appended without an expected-revision gate.
   GEOGRAPHIC_AREA *was* given `revision` (additive extension) because adding
   a geometry edition is a real state change of the area root.
3. **Schedule authority** (`programme_items.schedule_authority`) is an
   additive optional field on the frozen `ProgrammeItemSchema`. INTERNAL
   admits `updateProgrammeItemSchedule`; EXTERNAL causes that command to
   refuse with `AUTHORITY_DENIED` — only `recordExternalScheduleObservation`
   (an immutable, non-mutating capture) is accepted. `setProgrammeItemScheduleAuthority`
   is the explicit, separate command that changes who controls a schedule.
4. **M2 deferred FK closure requires fixing M2's own test fixtures.** Closing
   `transport_item_details`/`stay_item_details`/`resource_use_item_details`/
   `engagement_item_details`/`travel_history`/`intended_visits`'s deferred FKs
   for real means M2's `opaqueRef()`-based test fixtures (which deliberately
   wrote unresolvable placeholder UUIDs into these columns, per M2's own
   evidence doc) now fail at COMMIT. Fixing those fixtures is in-scope
   integration work for the lane that closes the FK (not an M2 migration/
   repository edit) — delegated to a background agent; reviewed before commit.
5. **`engagement_item_details.participation_id` traveller consistency** (M4
   brief §D) is enforced by an M4-owned deferred trigger (0062) rather than by
   editing M2's `travelCommands.ts`, since M2 command/repository files are not
   this lane's to edit.
6b. **Caller names the owning Programme explicitly.** `updateProgrammeItemSchedule`,
   `setProgrammeItemLifecycleStatus`, `setProgrammeItemScheduleAuthority`,
   `addParticipation` and `updateParticipation` all take `programmeId` as a
   required param, matching M2's `updateJourneyItem` (`journeyId` supplied by
   the caller, never DB-discovered before the transaction) — because
   `PgProgrammeRepository`'s methods require the ambient transaction client
   `uow.execute` installs, so a "resolve the parent aggregate" read cannot run
   before `execute` is even called. Each handler still re-verifies the claim
   once the item/participation is loaded inside the transaction, returning a
   typed `VALIDATION_FAILED` on mismatch rather than trusting the caller
   silently.
7. **ResourceAssignment does not advance its owner's revision.** It is its own
   row/lifecycle, not a rewrite of the schedule owner's time (§5 "not a second
   editable time"); capacity/exclusivity evaluation is explicitly out of scope
   (AT22 "reference seam only").

## Notes on environment

- Docker Desktop was not immediately reachable at task start (`npm run
  db:postgres:up` failed to connect to the docker API); it became reachable
  after several minutes. A stale `northstar-postgres-test` container from a
  prior session on this machine required `docker rm` before `up -d --wait`
  could recreate it (data is `tmpfs`-backed, so no state was lost).
