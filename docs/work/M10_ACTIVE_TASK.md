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
| Programme import/upload/promotion (`programme.ts`, `programmeHttp.ts`, `uploadIntakeHttp.ts`) | PORT | **Done (bounded)** — `src/app/target/programmeImport.ts`, wired at `POST /api/v2/programme/import`. Real command pipeline (org → source/evidence → event/programme/items → travellers/trips/journeys/participations), generic bundle schema (no fixture-specific hardcoding). Not yet ported: AI-assisted roster/brief parsing (`map-roster`/`map-brief`) — those call an intelligence extraction client, not persistence, and were not in scope for this pass; the intake persistence path itself is real and PG-backed. |
| Demo reset/bootstrap (`demoWorld.ts`, `bootstrap.ts`, `programmeSeed.ts`) | PORT (the seeding *concept*, not the SQLite table-wipe mechanics) | **Done (bounded)** — `src/app/target/demoSeed.ts` (thin wrapper over `programmeImport.ts`), wired at `POST /api/v2/demo/reset`. Seeds a small coherent world (org, event/programme/item, 2 travellers/trips/journeys/participations), not the legacy's full 67-trip AiT programme — scope explicitly reduced, real and PG-backed either way. |
| Event ingestion + dedup inbox (`eventIngestHttp.ts`, `eventInboxStore.ts`) | PORT | **Partially closed — core mechanism already real, one genuine gap remains.** `acceptProviderShapedDemoEvent` → `recordTransportObservation` already proves real, working, idempotency-key-based dedup ingestion on PG (arguably stronger than the legacy `provider_event_inbox`'s plain insert-or-ignore, since it also detects changed-payload conflicts via canonical payload hashing) — this is not a missing-dedup gap. `AtlasFlightEventNormalizer` (`src/providers/atlas/eventNormalizer.ts`) is pure provider-adapter logic, reusable as-is (ADR-044 ASSERTED-authority ceiling carries over unchanged). **The actual remaining gap**: correlating an incoming provider event's `providerOrderRefs` (PNR/order number) to the right target `TRANSPORT_SERVICE`/journey subject — the legacy path does this via SQLite Trip.elements matching (`eventIngest.ts`, 413 lines, tightly coupled to the old aggregate model, not portable 1:1 per "do not recreate legacy aggregate behaviour"); the target side has real identity-linking infrastructure for exactly this (`external_connections`/`external_records`/`external_identity_links`, migration `0040-0042`, with `identity_state ∈ {LINKED, UNVERIFIED, QUARANTINED_UNKNOWN, QUARANTINED_AMBIGUOUS}`) but no code wiring a normalized Atlas event through it yet. This is genuine new design work (which correlation resolves LINKED vs. QUARANTINED, not just a rewire) — flagging precisely rather than rushing a version that guesses at correlation.|
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

### Phase 4 — Staging importer
- [ ] Idempotent by dataset+source identity; typed conflicts; no silent overwrite

### Phase 5 — Reconciliation
### Phase 6 — Recompute derived state
### Phase 7 — Interrupt/resume/restore
### Phase 8 — Legacy retirement rehearsal
### Phase 9 — Exact cutover rehearsal
### Phase 10 — Rollback model + runbook

## Blockers

None currently. Awaiting subagent inventory results before freezing the
migration contract (per task instructions: "freeze the M10 migration contract
and acceptance criteria before implementing broad changes").

## Next action

Continue Phase 1's remaining product-capability gaps in priority order:
programme import/upload, then event ingestion/dedup inbox. Demo
reset/bootstrap is done (`src/app/target/demoSeed.ts`, wired at
`POST /api/v2/demo/reset`). Reuse the same pattern proven for the demo
seeder: real PG commands, evidence-chain ordering (source → evidence citing
an already-registered subject → dependent records), focused pgtest per
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
| ORG-INHERIT | Park for Later (carried) | Exact grant match only |
| FABLE-POLISH | Park for Later (carried) | Visual refinement only |
| PG-ASSESS-SERIAL | Accept Risk (carried) | concurrency=1 + retry |
| SQLITE-LEGACY | Accept Risk until M10 closes it | Legacy app remains separately runnable; M10's job is to make this explicitly legacy-only, not delete it |

## Exact candidate state

Not yet finalized — M10 is not complete, Phases 3-10 remain. Current head
of `milestone-m10-migration-rehearsal`: `ea15a3a` (base
`c45a9289b7f7ff730cdce97ced6124b1a9332bf8`). This SHA closes Phase 2 in
full (real PostgreSQL evidence, 456/456 `npm run test:postgres` on a fresh
database, clean typecheck/build/lint/anti-hardcoding/diff-check) and
documents Phase 1's scope decision, but is **not** a candidate for C5 —
no migration rehearsal has been performed. Will record the final M10
candidate SHA, dataset/config identity, and migration tooling versions once
Phase 9 rehearsal actually completes in a future session.
