# M10 ACTIVE TASK — Migration Rehearsal + Final Candidate

## Goal

Converge on PostgreSQL as the sole forward-development runtime, close the five
pre-M11 correctness conditions carried from C4, build+rehearse a legacy
export/import/reconcile/restore pipeline, and produce an exact deployable
candidate SHA plus a C5 cutover request. No production cutover in M10.

## Accepted base

- C4 accepted SHA: `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` (see
  `docs/refactor/evidence/C4_ACCEPTANCE.md` for the gate record — historical
  `docs/refactor/evidence/M9.md` / `docs/work/M9_ACTIVE_TASK.md` predate this
  gate and are retained as-is, not rewritten).
- Branch: `milestone-m10-migration-rehearsal`
- Worktree: `C:/Dev/qoder-atlas-m10`

## Current phase

**Correction (owner-directed, this pass):** the previous checkpoint's Phase 1
scope decision ("did not flip the default boot path... actual cutover
belongs to M11") was **wrong** and has been reversed. Runtime/code
convergence — making PostgreSQL the sole runtime `npm run dev`/`npm start`
can reach, with SQLite reduced to an explicit offline migration-only
reader — is M10's job, not M11's. M11 deploys/activates the already-PG-only
candidate and performs the controlled *data/authority* switch; it must not
become the milestone where remaining application behaviour finally gets
ported off SQLite. This correction is now in effect; do not reopen it
without concrete contradictory evidence.

Phase 0 (setup) and Phase 2 (all four items closed with real PostgreSQL
evidence) are done. Phase 1 (runtime convergence) is **substantially
complete**: the boot/composition boundary is PostgreSQL-only and
structurally proven (`npm run dev`/`npm start` cannot reach SQLite — proven
by a real import-graph walk plus a live boot-with-no-SQLite test, not
grep), and 2 of 3 named product-capability gaps are closed with real,
tested, PG-backed capability (programme import/upload, demo reset). Event
ingestion is precisely scoped but not finished — see the disposition table
for the exact remaining piece (provider-event-to-subject correlation via
the M3 external-identity tables, not a dedup-mechanism gap). The legacy
read-model/HTML surface (`/operator`, `/decisions`, etc.) is RETIRE, not
PORT — see below for why. Phases 3-10 (the migration rehearsal pipeline)
remain **not built** — see `docs/refactor/evidence/M10_MIGRATION_CONTRACT.md`.

## Checklist

### Phase 0 — Setup
- [x] Verify C4 accepted SHA exists on `origin/milestone-m9-product-integration` (confirmed: it is the exact tip)
- [x] Gate record: `docs/refactor/evidence/C4_ACCEPTANCE.md`
- [x] Worktree/branch created from exact SHA
- [x] Read AGENTS.md, IMPLEMENTATION_PLAN.md §14/§15/§16/§17, ROADMAP.md, MIGRATION_MAPPING.md (= M0 inventory/mapping), DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md F17/F18
- [ ] Read DATA_STRUCTURE_LOGICAL_SCHEMA.md §8 (legacy_id_map/migration_runs) in full
- [ ] Read current CI/acceptance scripts

### Phase 1 — Runtime convergence

- [x] Exhaustive SQLite-reachability inventory — **reads and writes both**,
  not just writes (the first pass only covered writes; corrected). Confirmed:
  `npm run dev`/`npm start` could not structurally boot without SQLite before
  this pass (no config path to skip `openDatabase`), 23+ `src/app/**` files
  reachable from `composeAppRuntime` touch SQLite reads/writes, and no
  differential/dual-read/dual-write compatibility adapter exists anywhere
  (confirmed clean). No offline exporter exists yet (confirms the migration
  contract's finding).
- [x] **Boot/composition boundary is now PostgreSQL-only.** New composition
  root `src/app/composeTargetBoot.ts` (zero SQLite imports, wires
  `composeTargetEndpoints` + a real M6-evaluator-backed reassessment pipeline
  — `captureWorld`/`createM6Registry`/`assessSubject`, the same pipeline
  `m9SarahTargetE2E.pgtest.ts` proves against real PostgreSQL, not test-only
  scaffolding). New minimal server `src/server/targetHttp.ts` (health, `/`
  redirect to the target operator overview, static assets, delegates
  everything else to `handleTargetProductHttp`). `src/main.ts` rewritten to
  call only these — verified by live boot: `/health` and `/api/v2/health`
  return 200, `/` redirects to `/api/v2/operator/overview?format=html`, and
  the old `/operator` route now genuinely 404s (not silently stubbed).
- [x] **Structural regression proof added** (not grep): `test/m10-runtime-purge.test.ts`
  walks the *real* import graph from `src/main.ts` (parses actual
  `import`/`export...from` specifiers, resolves relative paths, BFS) and
  asserts a forbidden-module list (`persistence/{database,repositories,entityStore}.ts`,
  the four app-owned SQLite stores, `compose.ts`, `runtime.ts`,
  `engine/mutation.ts`, `server/http.ts`, any `node:sqlite` import) is
  unreachable — verified this actually catches a violation by temporarily
  reintroducing one and confirming the test fails, then reverting.
  `postgres-integration/m10RuntimePurgeBoot.pgtest.ts` is the live
  companion: boots `composeTargetBoot` end-to-end against real PostgreSQL
  with `SQLITE_PATH` deliberately unset and asserts the full request cycle
  works and the legacy route is gone.
- [ ] **Still open — real product-capability gaps** confirmed by the
  inventory, not yet closed (legacy SQLite composition still exists as a
  *separate, non-default* module for these until ported): programme
  import/upload, demo reset/bootstrap (no production-grade PG world-seeder
  exists — Sarah/Jordan proofs seed via test-only harness helpers, not a
  product-facing capability), event ingestion/dedup inbox, and the full
  legacy read-model/HTML surface (`/operator`, `/decisions`, `/activity`,
  `/programme`, `/traveller` and their `/api/*` JSON equivalents). See the
  disposition table below. The target already has ITS OWN complete,
  differently-shaped, already-proven product surface (`/api/v2/*` — operator
  overview, case detail, incident/programme, traveller/trip, all with
  HTML+JSON, via `pgFactAssembler.ts` + `src/ui/screens/product-*.ts`) —
  these legacy routes are **RETIRE**, not 1:1-port, targets: recreating the
  old aggregate-shaped dashboard against Postgres would violate "do not
  recreate legacy aggregate behaviour inside PostgreSQL."
- [ ] Forward test suite default (`npm test` vs `npm run test:postgres`) — not resolved.

#### SQLite reachability disposition table (Phase 8 input)

| Capability | Disposition | Status |
|---|---|---|
| Boot/composition (`main.ts`/`compose.ts`) | PORT | **Done** — `composeTargetBoot.ts`/`targetHttp.ts` |
| Operator dashboard, case detail, decisions, activity, programme view, traveller trip (GET routes + HTML) | RETIRE (superseded by target's own `/api/v2/*` product surface, not ported 1:1) | Target equivalents already exist and work (`pgFactAssembler.ts` + `product-*.ts` screens); legacy routes simply unmounted in the new default boot |
| Runtime recovery lifecycle (`RuntimeOrchestrator.processDisruption/plan/begin/decide/execute`, `SqlMutationService`) | RETIRE (legacy aggregate model; superseded by the target's M6-M9 evaluate→strategy→plan→authority→execute→resolve pipeline, a different shape by design) | Not reachable from new boot |
| `RuntimeOrchestrator.reset()` raw `DELETE FROM`/`sqlite_master` table-wipe | RETIRE outright — do not resurrect this pattern in Postgres | N/A |
| Programme import/upload/promotion (`programme.ts`, `programmeHttp.ts`, `uploadIntakeHttp.ts`) | PORT | **Done (bounded)** — `src/app/target/programmeImport.ts`, wired at `POST /api/v2/programme/import`. Real command pipeline (org — source/evidence — event/programme/items — travellers/trips/journeys/participations), generic bundle schema (no fixture-specific hardcoding). Not yet ported: AI-assisted roster/brief parsing (`map-roster`/`map-brief`) — those call an intelligence extraction client, not persistence, and were not in scope for this pass; the intake persistence path itself is real and PG-backed. |
| Demo reset/bootstrap (`demoWorld.ts`, `bootstrap.ts`, `programmeSeed.ts`) | PORT (the seeding *concept*, not the SQLite table-wipe mechanics) | **Done (bounded)** — `src/app/target/demoSeed.ts` (thin wrapper over `programmeImport.ts`), wired at `POST /api/v2/demo/reset`. Seeds a small coherent world (org, event/programme/item, 2 travellers/trips/journeys/participations), not the legacy's full 67-trip AiT programme — scope explicitly reduced, real and PG-backed either way. |
| Event ingestion + dedup inbox (`eventIngestHttp.ts`, `eventInboxStore.ts`) | PORT | **Partially closed — core mechanism already real, one genuine gap remains.** `acceptProviderShapedDemoEvent` — `recordTransportObservation` already proves real, working, idempotency-key-based dedup ingestion on PG (arguably stronger than the legacy `provider_event_inbox`'s plain insert-or-ignore, since it also detects changed-payload conflicts via canonical payload hashing) — this is not a missing-dedup gap. `AtlasFlightEventNormalizer` (`src/providers/atlas/eventNormalizer.ts`) is pure provider-adapter logic, reusable as-is (ADR-044 ASSERTED-authority ceiling carries over unchanged). **The actual remaining gap**: correlating an incoming provider event's `providerOrderRefs` (PNR/order number) to the right target `TRANSPORT_SERVICE`/journey subject — the legacy path does this via SQLite Trip.elements matching (`eventIngest.ts`, 413 lines, tightly coupled to the old aggregate model, not portable 1:1 per "do not recreate legacy aggregate behaviour"); the target side has real identity-linking infrastructure for exactly this (`external_connections`/`external_records`/`external_identity_links`, migration `0040-0042`, with `identity_state — {LINKED, UNVERIFIED, QUARANTINED_UNKNOWN, QUARANTINED_AMBIGUOUS}`) but no code wiring a normalized Atlas event through it yet. This is genuine new design work (which correlation resolves LINKED vs. QUARANTINED, not just a rewire) — flagging precisely rather than rushing a version that guesses at correlation.|
| Preferences/booking-dossiers/FX evidence stores | PORT | **Not started** |
| `main.ts`'s direct `kvGet`/`kvSet`/raw `db.prepare` calls | RETIRE | Done — removed, new `main.ts` has none of this |
| `openDatabase`/repository **read** methods | MOVE TO OFFLINE MIGRATION TOOLING | Not built yet — Phase 3 (legacy exporter) owns this; must not be importable from `src/main.ts` or any `src/app/**`/`src/server/**` normal-execution file (structurally enforced by `test/m10-runtime-purge.test.ts` once the exporter exists — add its own module to the allowed-outside-the-graph list explicitly, never make it reachable from `main.ts`)

### Phase 2 — Close pre-M11 correctness debt
- [x] ISSUER-POL: closed at command level. `issueAuthorityGrant` (`src/persistence/postgres/commands/peopleCommands.ts`) now enforces self-issuance rejection + issuer-must-hold-covering-`authority.grant.write`-grant unconditionally, inside the transaction, for every caller (not just the `grantIssuance.ts` facade, which now just builds the scope union and lets the command enforce policy). Added a separate `bootstrapIssueAuthorityGrant` export: requires `SYSTEM`-typed issuer + zero pre-existing `authority_grants` rows in the workspace (new `PgGovernanceRepository.countGrantsInWorkspace`), so it can only seed a workspace's very first grant, ever. `grantIssuance.ts`'s `provisionOrganiserAuthority` routes through it via a dedicated bootstrap-seed principal (never the organiser). Verified: `m9Checkpoint1.pgtest.ts` (ISSUER-POL self-mint/unauthorised/authorised-organiser scenarios), `m9SarahTargetE2E.pgtest.ts` (flagship C4 evidence, full run), `m8AuthorityExecution.pgtest.ts` (20/20), `m2People.pgtest.ts` (46/46), `m9SameProgrammeSequentialActions.pgtest.ts` (3/3) — all green against real PostgreSQL. Fixed ~9 test fixtures across these files that took the old self-issuance shortcut (see `bootstrapTestGrantIssuer` helper in `postgres-integration/m8ExecutionGateHelpers.ts`). Remaining files (`c3TargetedRemediation.pgtest.ts`, `m7m8SharedResourceBudgetCapability/IntegrationSeam/DagAndGenericity/CurrentnessAndReconciliation.pgtest.ts`) dispatched to a subagent using the same proven pattern — verify its result before considering this fully closed.
- [x] STALE_BASE: reviewed in depth. The exemption (`storedExecutionGate.ts`) already keys on an actual DB-enforced same-plan `action_dependencies` edge (migration `0113`'s `action_dependencies_same_plan` trigger forbids cross-plan edges) to a genuinely completed prerequisite, combined with CAS-protected monotonic revisions — this is materially stronger than bare "observed == head" coincidence-checking, though the code comment didn't say so explicitly. Strengthened the comment to document the exact chain of guarantees (trigger + CAS + per-programme scoping) so the safety property is now legible instead of implicit. All 3 required scenarios already have real PG tests in `m9SameProgrammeSequentialActions.pgtest.ts` (valid sequential mutation, external concurrent mutation fails closed, replay/idempotency) — all pass. "Unrelated revision advance" is substantively the same as the external-mutation test since the compiler always creates dependency edges for same-aggregate intents (no way to construct a true in-plan "unrelated" advance).
- [x] Removed `expectedProgrammeRevision ?? 1` fallback (`src/persistence/postgres/execution/internalProgrammeExecutor.ts`). `StoredProgrammeSchedule.expectedProgrammeRevision` is now `number | undefined`; when none of prerequisite-observation/intent's captured revisions/strategy base manifest supplies one, `executeInternalProgrammeItemSchedule` returns an explicit `VALIDATION_FAILED` conflict citing the PROGRAMME ref instead of guessing `1`. Verified via `m9SameProgrammeSequentialActions.pgtest.ts` and `m9SarahTargetE2E.pgtest.ts` (both exercise this path with real PG).
- [x] WAVE3R (`test/wave3r-m1-ait-canonical-seed.test.ts`) — **Ignore / Accept Risk, investigated and closed.** Reproduced: `harvested PNR MNSYN03 must appear on a promoted leg` fails. Root cause confirmed by grep: `MNSYN03` does not exist anywhere in `fixtures/programmes/ait-summit-2026/programme.json` (0 occurrences), while the other 5 referenced PNRs do — a stale test expectation against fixture data that never contained it (or was regenerated without it), not a code path that drops/loses data. The test exercises the legacy SQLite path exclusively (`openDatabase(':memory:')`, `SqliteTripRepository`, zero PostgreSQL/target-runtime involvement), so it cannot indicate a migration/source-of-truth inconsistency and has no bearing on M10 candidate safety. Not fixed: doing so would mean editing a legacy-only fixture/test, which is out of scope per M10's "no bug fixes that only improve legacy runtime behavior."

### Phase 3 — Legacy export (offline, read-only)
- [ ] Build exporter; no provider dispatch; deterministic/resumable

**Contract correction (this pass, verified by probe):** the migration
contract's build plan said to read the legacy DB "over
`SqliteTripRepository`/`SqliteEntityStore`/`SqliteSourceRepository`
(already safe to call)". That is wrong on two counts and is superseded:
1. Obtaining a handle for those repositories means calling `openDatabase`,
   which **writes** — `PRAGMA journal_mode = WAL`, the full `CREATE TABLE IF
   NOT EXISTS` DDL, and a `schema_meta` upsert. That violates "zero SQLite
   writes" on the frozen source before a single row is read.
2. Those repositories zod-re-parse every row, so one corrupt legacy row
   aborts the whole export instead of becoming a quarantine candidate.

The exporter therefore opens the source with `new DatabaseSync(path,
{ readOnly: true })` and reads raw rows. Probed on Node v24.15.0: reads
succeed, and both `INSERT` and `PRAGMA journal_mode = WAL` fail with
`attempt to write a readonly database` — SQLite itself enforces the
read-only boundary, rather than us promising not to write. Unparseable
payloads are preserved verbatim and marked, never dropped and never
guessed.

### Phase 4 — Staging importer
- [x] Idempotent by dataset+source identity; typed conflicts; no silent overwrite.
  `src/migration/legacyImporter.ts` + `migrationRunStore.ts`. First writes ever
  to `migration_runs`/`legacy_id_map`. Imports through the real M2-M5 command
  surface (no migration-only write path), quarantines rather than guesses, and
  records every exception with classification/reason/scope/safety/owner/
  cutover-blocking. Handlers cover ORGANISATION, TRAVELLER, TRIP, CONSTRAINT,
  SOURCE_RECORD; uncovered categories are counted as `recordsDeferred`, never
  silently skipped (Phase 5 adds handlers; nothing else changes).

**Key correctness finding (fixed, not worked around):** every migrated target
id and the run's provenance source/evidence ids are now **derived** from
`(datasetHash, sourceType, sourceId, step)` rather than random. With random
ids, a command re-issued under the same deterministic idempotency key
presents a different canonical payload, and `PgUnitOfWork` correctly rejects
it as `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` — so the documented
crash-between-command-commit-and-mapping-insert recovery would have failed.
Derived ids make the migration content-addressed: the same dataset always
produces the same target ids, so a re-issued command is a true REPLAY. Ids are
only unique per workspace (`PRIMARY KEY (workspace_id, id)`), so the same
bundle still imports independently into two workspaces. The run's provenance
assertion describes the *dataset*, not the run, for the same reason.

### Phase 5 — Reconciliation
- [x] Every exported category now has a handler; `recordsDeferred` is 0.
  `src/migration/legacyCategoryHandlers.ts` (+ shared `legacyImportContext.ts`)
  covers PLACE, ANCHOR_EVENT, RULE_SET, RECOVERY_CASE, SIGNAL, AUDIT_HISTORY,
  BOOKING_DOSSIER, PREFERENCE, FX_RATE_EVIDENCE, PROVIDER_EVENT_INBOX, and
  legacy trip **elements** (the obligations, money and provider refs) into real
  Reservation/ReservationLine/TransportService state under the owning Journey.
- [x] `src/migration/reconcileMigration.ts` — nine semantic checks (identity
  accounted, journey ownership, provider refs, evidence lineage, obligations,
  uncertainty, money, derived truth, no provider dispatch), machine-readable
  JSON plus a report written for the cutover decision-maker. A check that
  cannot be evaluated reports ATTENTION rather than passing by default.

**Two frozen decisions revised on repo evidence, not preference:**

1. `RECOVERY_CASE`: `MIGRATE_THEN_RECONCILE` — `ARCHIVE_AND_REGENERATE`. The
   target has **no case-authoring command**. `recovery_cases` rows are created
   inside `m8AuthorityCommands` as the evaluate — strategy — plan — authority
   pipeline runs, because in the target a case is *derived*, not authored.
   Writing one by raw SQL would fabricate a case with no strategy, plan or
   authority lineage. Closed cases archive as history; an **open** case becomes
   a cutover-blocking owned exception for the target to re-derive.
2. `SIGNAL`: `MIGRATE_TRANSFORM` — `ARCHIVE_AS_IMMUTABLE_HISTORY`. Replaying
   historical provider signals into a live target would re-trigger recovery for
   disruptions that are long over. Archived with their real `observedAt`.

**Other honest-mapping outcomes** (content preserved, activation owned):
`PREFERENCE` and `RULE_SET` need a target input the legacy row never held (an
effective window; a registered rule expression) — explicit preferences block
cutover, latent ones do not, because explicit instructions outrank inferred
signals. `BOOKING_DOSSIER` contact/payment needs a real protected store to hold
a `ProtectedDataRef`; minting one over legacy plaintext would fabricate custody.
Legacy `reservationState: CHANGED` maps to **UNKNOWN**, never CONFIRMED or
CANCELLED. An unprocessed provider delivery keeps `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME`.

Exporter bumped to `1.1.0`: records now carry `sourceTimestamp`, so archived
history is asserted at the instant it actually happened rather than at import
wall-clock.

### Phase 6 — Recompute derived state
- [x] `src/migration/recomputeMigratedState.ts` runs the real `evaluateImpact`
  + `createM6Registry` path (the one `m9SarahTargetE2E.pgtest.ts` proves) over
  exactly the journeys `legacy_id_map` says were migrated. No legacy verdict is
  imported as current: import alone creates zero `assessments` rows, and the
  legacy `Constraint.status` is archived as `LEGACY_CONSTRAINT_STATUS` evidence
  instead. Verified: migrated journey reaches `CURRENT` via
  `currentAssessmentView`.

### Phase 7 — Interrupt/resume/restore
- [x] Interrupt/resume proven against real PostgreSQL (not a unit stub):
  `failAfterRecords` is a real code path that leaves the run `IN_PROGRESS`
  with accurate `progress`; the resumed run adopts the same `runId` and the
  final state matches a clean single-pass run table-for-table.
- [x] Backup/restore rehearsal on an isolated volume-backed instance —
  `scripts/m10-cutover-and-restore-rehearsal.mjs`, 10/10 PASS. Deliberately not
  the shared tmpfs test DB: restoring into a RAM-backed non-durable data
  directory would prove nothing. Evidence in
  `docs/refactor/evidence/M10_BACKUP_RESTORE.md`.

### Phase 8 — Legacy retirement rehearsal
- [x] `docs/refactor/evidence/M10_RUNTIME_RETIREMENT.md`. Every SQLite-touching
  module has exactly one disposition: retired, replaced by target capability, or
  offline migration-only. The four legacy stores (dossier, preferences, FX,
  provider inbox) are migration source categories, not subsystems to rebuild.

### Phase 9 — Exact cutover rehearsal
- [x] The same script runs the documented sequence on isolated data — freeze,
  final export, import, reconcile, recompute, verify, identify activation
  blockers — then proves restore against the same target. No production switch,
  no paid provider action.

### Phase 10 — Rollback model + runbook
- [x] `docs/refactor/evidence/M10_ROLLBACK_AND_CUTOVER.md`. Rollback is modelled
  around the one boundary that governs it: before the target's first externally
  consequential action, restoring the legacy DB is safe; after it, restoring
  does **not** retract supplier-side effects and would leave NORTHSTAR
  confidently wrong about the world. The boundary is observable (first
  `execution_attempts` row), not a judgement call.
- [x] `docs/refactor/evidence/C5_REQUEST_PACKAGE.md` — request for review, not a
  PASS claim.

## Environment hazard found (not a product defect)

The shared `northstar-postgres-test` container had `schema_migrations`
checksum drift for `0120_m9_replan_identity.sql`: recorded
`78b46c4c…` vs this worktree's file `2843cb27…`. Cause confirmed: the
**M9 worktree has that file checked out CRLF and the M10 worktree LF**
(content identical ignoring EOL), and `migrate.ts` hashes file bytes. So the
same commit in two worktrees cannot share one test database. Resolved by
recreating the `northstar_test` database (migration `0001` creates the
postgis/pgcrypto extensions itself, so a template1-based database is fine).
Classification: **Park for Later** — a multi-worktree developer-environment
hazard, not a runtime or cutover risk (one deployment has one checkout).
`ID: PGTEST-EOL-DRIFT`.

## Blockers

None currently. Awaiting subagent inventory results before freezing the
migration contract (per task instructions: "freeze the M10 migration contract
and acceptance criteria before implementing broad changes").

## Next action

Continue Phase 1's remaining product-capability gaps in priority order:
programme import/upload, then event ingestion/dedup inbox. Demo
reset/bootstrap is done (`src/app/target/demoSeed.ts`, wired at
`POST /api/v2/demo/reset`). Reuse the same pattern proven for the demo
seeder: real PG commands, evidence-chain ordering (source — evidence citing
an already-registered subject — dependent records), focused pgtest per
seam. After Phase 1's named gaps close, start Phase 3 (legacy exporter) per
`docs/refactor/evidence/M10_MIGRATION_CONTRACT.md`.

## Critical constraints

- PostgreSQL target = sole forward-development runtime from here on. No new
  product/demo behavior, bug fixes, or acceptance evidence on legacy SQLite.
  SQLite stays only as: read-only legacy export source, migration comparison,
  compatibility evidence, restore/rollback rehearsal input.
- Do not delete legacy source yet.
- No provider dispatch during any migration/export/import operation.
- Idempotent import by dataset+source identity; same identity + changed
  payload = explicit conflict, never silent overwrite.
- Unknown external outcome stays UNKNOWN — never simplified to failed.
- Derived health/viability/read-cache state is recomputed post-import, never
  migrated as current truth.
- M10 MUST NOT perform production cutover, freeze production writes, enable
  live target writers against real users, delete the legacy source, or
  trigger paid provider actions. C5 requires explicit owner approval.
- Do not merge to main automatically.
- Broad suites (`npm run test:postgres`, full typecheck/build/lint) are a
  final-candidate gate, not the debugging loop — use focused tests per seam.

## Issue triage (carried from M9 + new)

| ID | Class | Notes |
|---|---|---|
| ISSUER-POL | Act Now (M10 scope) | Facade-only closure in M9; command/table-level self-issuance still open |
| STALE_BASE | Act Now (M10 scope) | Exemption keys on observed==head; needs same-plan-chain attribution proof |
| EXPECTED-REV-FALLBACK | Act Now (M10 scope) | Remove `?? 1` fallback |
| WAVE3R-AIT-HARVESTED-PNR | Investigate Now | M9 evidence: fails on unmodified pre-remediation SHA too, pre-existing/unrelated — confirm before M10 close |
| RUNTIME-DEFAULT-SQLITE | **Closed** (M10 Phase 1) | `src/main.ts` now boots only `composeTargetBoot` (PostgreSQL-only); structurally proven by `test/m10-runtime-purge.test.ts` + `postgres-integration/m10RuntimePurgeBoot.pgtest.ts`. Remaining product-capability gaps (programme intake, event ingestion) tracked separately in the Phase 1 disposition table, not this line. |
| EVIDENCE-HASH-DRIFT | **Closed** (final evidence pass) | C5 §3 cited `5da1d341…` (superseded `edfe0fc` backup-only run) while the reconciliation report cited `3077f43e…`. Two different fixtures were both being called "the rehearsal dataset". Resolved by rerunning the combined rehearsal at the final candidate and naming the obsolete hash explicitly rather than deleting it. |
| EVIDENCE-EXCEPTION-CONFLATION | **Closed** (final evidence pass) | C5 §5 listed eight classifications as "unresolved exceptions" when the final rehearsal observed exactly one; the rest are category policies that exported zero rows. Split into §5A observed and §5B potential-at-M11, with the same split applied to the rollback doc's activation-blocker table. |
| EVIDENCE-MAPPING-SEMANTICS | **Closed** (final evidence pass) | "11 exported / 11 mappings" read as though all 11 source records became live target entities. They are two different elevens: 9 live + 1 archived-as-evidence + 1 quarantined-with-no-mapping-row, and the 11th mapping is a synthetic `trips.journey` row because the legacy model had no Journey concept. |
| EVIDENCE-SQLITE-FALLBACK | **Closed** (final evidence pass) | Rollback Zone A said "point traffic back at the legacy runtime", contradicting the frozen single-runtime rule. Rewritten as abort/freeze/restore-pre-import-backup/re-import/retry, with an explicit statement that neither zone permits reactivating the SQLite application. Historical M1/M2/M5/M7/M9 evidence left unedited — it described its own moment accurately. |
| DOC-ENCODING-DAMAGE | **Closed** (final evidence pass) | `M10_ACTIVE_TASK.md` had been written through a lossy single-byte encoding: 5 section signs decoded as U+FFFD and ~72 em dashes, 5 arrows and 2 ellipses flattened to literal `?`. Repaired to real UTF-8; the URL query and `?? 1` operator references were preserved. Meaning unchanged. |
| C5-ORG-CURRENCY | **Closed** (C5 remediation) | Blocker 1. The importer read `payload.defaultCurrencyCode` — a *target* field name absent from the legacy model — and fell back to `'USD'`, so every migrated organisation got a fabricated currency. Now maps legacy `homeCurrency` exactly when it matches /^[A-Z]{3}$/, and otherwise fails closed: no organisation row, payload archived as `LEGACY_ORGANISATION` evidence, `ARCHIVED_REQUIRES_TARGET_POLICY_INPUT` exception blocking that scope. Target schema unchanged (`default_currency_code NOT NULL` is what forces the honest answer). |
| C5-UNCERTAINTY-FAIL-OPEN | **Closed** (superseded by C5-UNCERTAINTY-AGGREGATE) | Blocker 2. `UNCERTAINTY_PRESERVED` passed a literal `'PASS'` with counts only in the detail string, so a dataset that lost or falsely resolved uncertainty still reconciled green. Now computed from the source bundle via the shared `legacyUncertainty.ts`, which the importer reads too so the two cannot drift. Returns FAIL on an unaccounted fact or when target UNKNOWN lines fall below migrated uncertain elements. Negative proof: tamper a migrated UNKNOWN to CONFIRMED, check flips to FAIL and verdict to BLOCKED. |
| C5-UNCERTAINTY-AGGREGATE | **Closed** (C5 re-review remediation) | The first fix for blocker 2 removed the hard-coded PASS but replaced it with a *count* comparison: workspace-wide UNKNOWN reservation lines against migrated uncertain elements, plus a single global archived-delivery count. The C5 re-review correctly rejected it — falsely resolve element A, leave unrelated line B UNKNOWN, totals balance, check passes. Same hole for deliveries, where one archive stood in for another. Now identity-bound: `migrationTargetId` is exported from `migrationRunStore.ts` and used by both the importer and the reconciler, so reconciliation recomputes each fact's own target id and reads that one row. Two further negative tests prove compensation cannot mask a loss. |
| C5-LEGACY-UNKNOWN-UNNAMED | **Closed** (C5 remediation) | Found while sharing the uncertainty definition: the importer raised `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` only for legacy `CHANGED`, treating a legacy `UNKNOWN` reservation as unremarkable even though it is equally an unresolved external outcome. Both now earn a named exception. |
| PGTEST-FILE-STARTUP-RACE | Ignore / Accept Risk | A full `test:postgres` run intermittently fails exactly one file, a different one each time (`m3IdentityMoney`, then `m2Travel`, then `m2SubtypeIntegrity`). The third failed at file level in 547ms with no subtest executed — a startup/connection failure, not an assertion — and passed 15/15 alone, 61/61 with its predecessor, and in the next full run (470/470). Two causes: planner plan-sensitivity on an accumulated database, and a connection-setup race under a long sequential suite. Neither is an M10 regression; chasing a harness race is out of scope. Re-run the affected file in isolation before treating it as a finding. |
| MIG-VERIFY-DUP | Park for Later | The rehearsal script's `snapshotMigratedState` and `reconcileMigration` each hand-roll their own mapping-tuple and run-identity reads. They check genuinely different invariants (restore fidelity vs. migration semantics), so this is duplication of SQL rather than of meaning — but a shared `summariseMigratedDataset` read would stop them drifting. Revisit if a third caller appears, or before M11 cutover verification is written. |
| ORG-INHERIT | Park for Later (carried) | Exact grant match only |
| FABLE-POLISH | Park for Later (carried) | Visual refinement only |
| PG-ASSESS-SERIAL | Accept Risk (carried) | concurrency=1 + retry |
| SQLITE-LEGACY | Accept Risk until M10 closes it | Legacy app remains separately runnable; M10's job is to make this explicitly legacy-only, not delete it |

## Exact candidate state

**Candidate under review: tag `m10-candidate-c5-remediation-2` on
`milestone-m10-migration-rehearsal`** (resolve with
`git rev-list -n 1 m10-candidate-c5-remediation-2`), base
`c45a9289b7f7ff730cdce97ced6124b1a9332bf8`.

Four tags, none ever moved, so each stays honest: `m10-candidate` = `1d81dd7`
(implementation complete); `m10-candidate-final` = `eff19a9` (evidence pass,
**failed C5**); `m10-candidate-c5-remediation` = `9486fc5` (currency fixed and
accepted, but the replacement uncertainty check was count-based — **failed the
C5 re-review** on that); `m10-candidate-c5-remediation-2` = this candidate,
where uncertainty reconciliation is identity-bound per source fact.

Phases 3-10 are implemented and rehearsed. **One** canonical rehearsal dataset,
covering cutover and restore in a single run of
`scripts/m10-cutover-and-restore-rehearsal.mjs`: identity
`legacy-deployment-m10-restore-rehearsal`, hash
`6ebf05ce47554d8929a793d64882828d0cee895158ebb72047380827f528002d`, run
`18953aa8-8086-4dba-bf76-585f186bc3cf`, exporter
`northstar-legacy-exporter/1.1.0`, importer `northstar-legacy-importer/1.0.0`,
reconciler `northstar-migration-reconciler/1.0.0`.

Two earlier hashes are **obsolete**, both because the fixture changed and the
hash is the fixture's identity: `5da1d341…` (backup/restore only, `edfe0fc`)
and `3077f43e…` (`1d81dd7`/`eff19a9`, before the organisation gained an
explicit `homeCurrency` and the single trip gained a `CHANGED` element).

Observed exceptions in the canonical rehearsal: **two**, one blocking.
`QUARANTINED_MULTI_TRAVELLER_ALLOCATION` (`trips/trip-multi`) blocks its scope;
`PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` (`trips/trip-single`, the `CHANGED`
element) does not. The second is new and deliberate: the previous fixture had
no uncertainty at all, so `UNCERTAINTY_PRESERVED` was evaluating an empty set.
Everything else in the category matrix is a *policy that did not apply* to this
dataset. C5 §5A/§5B keeps those two lists apart.

Evidence on this candidate: `npm run test:postgres` **472/472 on a fresh database**;
migration suite 11/11 including all four C5 blocker tests; cutover + restore
rehearsal 10/10; 9/9 semantic checks PASS with verdict BLOCKED (correct while
one scope is quarantined); Sarah and both Jordan PG regressions PASS;
exporter + runtime-purge 10/10; purge boot PASS; typecheck, build, lint and
anti-hardcoding all clean. The C5 request package is
`docs/refactor/evidence/C5_REQUEST_PACKAGE.md`, §12 records the remediation.

**C5 is not claimed** — it is an independent review and owner gate. **No
production cutover occurred.**

The previous checkpoint (`ea15a3a`) closed Phase 2 and is superseded by this
candidate.