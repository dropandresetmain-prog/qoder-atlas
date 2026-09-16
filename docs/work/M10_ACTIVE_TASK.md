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

Phase 0 (setup), Phase 1 (documented, scoped decision — see below), and
Phase 2 (all four items closed with real PostgreSQL evidence) are done as
of `ea15a3a`. Phases 3-10 (the actual migration rehearsal pipeline) are
**not built** — see `docs/refactor/evidence/M10_MIGRATION_CONTRACT.md` for
the frozen contract and concrete build plan for the next session. This is a
genuine from-scratch build (confirmed by direct inventory: no exporter,
importer, reconciliation tool, or backup/restore automation exists anywhere
in the repo before this session), not something safely compressible into
the remainder of this one without corner-cutting the project's own evidence
standards (real PG persistence, typed commands, no hardcoding, comprehensive
focused tests per AT23).

## Checklist

### Phase 0 — Setup
- [x] Verify C4 accepted SHA exists on `origin/milestone-m9-product-integration` (confirmed: it is the exact tip)
- [x] Gate record: `docs/refactor/evidence/C4_ACCEPTANCE.md`
- [x] Worktree/branch created from exact SHA
- [x] Read AGENTS.md, IMPLEMENTATION_PLAN.md §14/§15/§16/§17, ROADMAP.md, MIGRATION_MAPPING.md (= M0 inventory/mapping), DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md F17/F18
- [ ] Read DATA_STRUCTURE_LOGICAL_SCHEMA.md §8 (legacy_id_map/migration_runs) in full
- [ ] Read current CI/acceptance scripts

### Phase 1 — Runtime convergence
- [x] Inventory: legacy writer/worker/entrypoint/reset-tool surface — complete (see "Legacy writer inventory" below).
- [x] Audit: no target path calls SQLite — **confirmed true**. Exhaustive grep of `src/app/target/**` and `src/persistence/postgres/**` for any legacy-store import returns zero hits (one doc-comment mention only). `composeTargetApplication`'s `sqliteAuthoritativeFallback: false` is a static literal, only read by the `/api/v2/health` response body, not a control-flow branch.
- [x] `src/main.ts`/`src/app/compose.ts` doc comments updated to state plainly which composition is legacy (frozen migration source) and which is the forward target runtime, and why.
- [ ] **Not done, deliberately: did not rewire the default boot path.** `composeAppRuntime` (legacy SQLite) remains the unconditional default for `npm run dev`/`npm start`; the target runtime stays opt-in behind `NORTHSTAR_ENABLE_TARGET_V2=1`. Reason: the target `/api/v2/*` HTTP surface (`targetHttpHandlers.ts`) does not have parity with the legacy surface — programme import/upload, demo reset, event ingestion, and several other legacy-only routes have no target-runtime equivalent yet (see legacy writer inventory below). Flipping the default now would silently break existing demo/product functionality, not just rename something. `docs/IMPLEMENTATION_PLAN.md` §15 assigns the actual "target becomes sole authoritative runtime" switch to **M11**, not M10 — M10's own §14 language ("construct a target candidate without legacy runtime writes") is about the final candidate configuration, which `NORTHSTAR_ENABLE_TARGET_V2=1` already achieves, not the whole milestone's default dev-boot behavior. Flagging this as a judgment call the user/reviewer may want to weigh in on if the M10 task's intent was actually the more aggressive reading.
- [ ] Forward test suite default (`npm test` vs `npm run test:postgres`) — not resolved, same parity blocker as above.

#### Legacy writer inventory (Phase 8 input, produced now)

Every legacy-SQLite write path is exhaustively enumerated with file:line and
a suggested M11-retirement disposition in the session transcript (produced
via direct repo inventory). Summary: all writes funnel through 8 files
(`src/persistence/{database,repositories,entityStore}.ts` +
`src/app/{preferenceStore,dossierStore,fxStore,eventInboxStore}.ts`), reachable
only via HTTP routes in `src/server/http.ts` (no CLI/worker/scheduled-job
legacy write path exists — `PgReassessmentWorker` is the only worker and it
is exclusively PostgreSQL). Two call sites in `src/engine/mutation.ts`
bypass the repository classes and write raw SQL directly to
`trips`/`entities`/`audit` — flagged separately since a PG port must
replicate that transactional behavior, not just the repository interfaces.
This inventory should be transcribed into a proper disposition table as the
actual Phase 8 deliverable once Phases 3-7 land.

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

Start Phase 3 (legacy exporter) per the build plan in
`docs/refactor/evidence/M10_MIGRATION_CONTRACT.md` §"Build plan for Phases
3-10". First concrete step: `src/migration/legacyEvidence.ts` (the shared
evidence-writing helper every subsequent command needs to cite), then
`src/migration/legacyExporter.ts` against a small synthetic fixture DB. Do
not start the importer until the Constraint-status archival destination
decision (flagged as **open** in the contract) is made — building against
`assessments` before that decision is finalized risks a rework.

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
| RUNTIME-DEFAULT-SQLITE | Act Now (new, M10 Phase 1) | `src/main.ts` boots legacy SQLite (`composeAppRuntime`) by default; target PG path exists (`composeTargetApplication`) but isn't the default entrypoint |
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
