# M7 + M8 → C3 candidate integration — active task ledger

Re-read this before every phase and after any compaction/delegation. Close
checklist items only with evidence. Do not claim C3 PASS — that is an
independent later review.

## 0. Verified refs (2026-09-15)

| Ref | Value | Verified |
|---|---|---|
| Common accepted base | `integration/m2-m6-domain-evaluation` | `a0843db73c5e4bd7fb5c1874391d7361b789aed1` — matches local + origin |
| M7 | `milestone-m7-recovery-planning` | `b38dbd82edf746faabb06f8e98f30019a005834b` — matches local + origin |
| M8 | `milestone-m8-authority-execution` | `c5779293d45ca740d07cedad168383fd16e1ef99` — matches local + origin |

Integration worktree: `C:/Dev/qoder-atlas-m7-m8-c3`, branch `integration/m7-m8-c3`,
created from the base SHA above (not from either lane branch).

Other existing worktrees for reference (do not edit): `C:/Dev/qoder-atlas-m7`
(M7 lane), `.worktrees/m8-authority-execution` (M8 lane), `C:/Dev/qoder-atlas-m6`
(the accepted base lane, memory `northstar-long-horizon-a`).

## 1. Collision surface (established by diffing each lane vs base)

- **Only non-migration file both lanes touch:** `docs/ROADMAP.md` (trivial
  reconcile).
- **`src/contracts/v2/action/actionPlan.ts`** (frozen M0 ActionIntent/Plan
  contract): **zero diff** on both lanes vs base — both consumed it as-is.
  No conflict.
- **`src/contracts/v2/authority/authorityEnvelope.ts` /
  `execution/execution.ts`**: M7 untouched; M8 +35 lines, additive only
  (`ExecutionAttemptStatus` gains CLAIMED/DISPATCHING/RECONCILIATION_REQUIRED/
  COMPLETED/FAILED). No conflict — M8's version carries forward as-is.
- **Real collision is entirely migrations `0100`–`0105`**: each lane created
  its own files at the same numbers with different table shapes (git will not
  flag this as a text conflict since filenames differ — `0100_recovery_cases.sql`
  vs `0100_recovery_cases_minimal.sql` — but both would apply if merged
  naively, corrupting the schema). No other TS file paths collide besides
  ROADMAP.md.

## 2. Migration numbering decision

M7's own migration file header (`0100_recovery_cases.sql` line 1-4) already
states the intended allocation: **"M7 `0100`–`0102`; M8 owns authority/
execution tables in `0109`+."** This is the most specific documented
source-of-truth (more specific than `MIGRATION_MAPPING.md`'s joint
`0100`–`0119` M7/M8 range, which this comment sub-divides). Decision: adopt
it exactly.

Final chain:

| Range | Content |
|---|---|
| `0100` | `recovery_cases`, `case_subjects`, `case_signals` (M7, unchanged) |
| `0101` | `recovery_strategies`, `strategy_changes` (M7, unchanged) |
| `0102` | `action_plans`, `action_intents`, `action_dependencies`, `case_action_links` (M7, **field-level amendments** — see §3) |
| `0103`–`0108` | reserved gap, unused (matches M7's own note) |
| `0109` | `authority_decisions`, `approval_requirements`, `approvals`, `approval_revocations` (was M8 `0102`) |
| `0110` | `execution_attempts`, `execution_observations` (was M8 `0103`) |
| `0111` | `budget_commitments` FK to `action_intents` + concurrency index (was M8 `0104`) |
| `0112` | `authority_action_kinds` closed vocabulary insert (was M8 `0105`) |

M8's `0100_recovery_cases_minimal.sql` and `0101_action_plans_intents.sql`
are **dropped entirely** (not renumbered) — their tables are superseded by
M7's canonical `0100`/`0102`.

## 3. Schema reconciliation decisions (recovery_cases / action_plans / action_intents)

Read both lanes' full SQL + the frozen `actionPlan.ts`/`money.ts` contracts
before deciding each field. Findings:

### 3a. `recovery_cases`
- Keep M7's table (7-value `lifecycle_status` via `recovery_case_lifecycles`
  lookup table: OPEN/PLANNING/AWAITING_AUTHORITY/EXECUTING/RESOLVED/CLOSED/
  CANCELLED — already a superset of M8's minimal 4-value inline CHECK).
- M8 needs `resolution_kind` (RECOVERED/RECOVERED_WITH_LOSS/UNRESOLVED/
  CANCELLED — AT20 recovered-with-loss disposition) which M7 has no
  equivalent for (M7 only has free-text `resolution_summary`). This is
  genuinely case-outcome state, not duplicated planner truth — **add it
  additively** as a nullable column in the M8 migration range (`0109`),
  `ALTER TABLE recovery_cases ADD COLUMN resolution_kind text CHECK (...)`.
  Do **not** re-create the table.
- If M8 code needs a `SUPERSEDED` lifecycle value not in M7's lookup table,
  add it via `INSERT INTO recovery_case_lifecycles (status) VALUES
  ('SUPERSEDED')` in the same migration — additive, no table recreation.
- Drop M8's own `enforce_subject_subtype_recovery_case` function/registration
  (`installed_by='M8'`) entirely — M7's version (`installed_by='M7'`) is
  functionally identical and already registered at `0100`. Do not register
  the RECOVERY_CASE subtype checker twice.

### 3b. `action_plans`
- Keep M7's table as base (immutable — `action_plans_immutable` trigger,
  `plan_version`, `scenario_change_id uuid`, `recovery_strategy_id uuid` FK
  to `recovery_strategies`).
- M8's version was mutable (`updated_at`, no immutability trigger) and used
  `scenario_change_id text` + `version` (not `plan_version`) with no
  `recovery_strategy_id` at all — this is the version to discard; an
  ActionPlan being mutable contradicts the frozen "selected strategy is
  immutable/versioned" acceptance criterion (`IMPLEMENTATION_PLAN.md` §11).
- M8's `action_plans_case_version_uidx UNIQUE (workspace_id,
  recovery_case_id, version)` is a genuinely useful invariant M7 lacks
  (nothing today stops two plans in one case sharing a `plan_version`).
  Add additively in `0109`:
  `CREATE UNIQUE INDEX action_plans_case_version_uidx ON action_plans
  (workspace_id, recovery_case_id, plan_version)`.

### 3c. `action_intents`
- Keep M7's table as base (immutable — `action_intents_immutable` trigger,
  status via `action_intent_statuses` lookup table not inline CHECK,
  16384-byte jsonb caps).
- **Money fields**: swap M7's `cost_estimate jsonb` for M8's typed
  `cost_amount numeric` / `cost_currency text CHECK (~ '^[A-Z]{3}$')` +
  `action_intents_cost_shape` CHECK. Reason: `ExactMoneySchema` (frozen,
  `money.ts`) is exactly `{amount: decimal string, currency: 3-letter}`;
  M8's typed columns match it precisely and use Postgres `numeric` (exact,
  no float) consistent with the I-10 exact-money invariant M8 already owns
  at Checkpoint 0. This is a field-representation improvement, not "M8
  wins the table" — table identity/ownership stays M7's.
- **Compensation fields**: swap M7's single `compensation_policy jsonb NOT
  NULL` for M8's three typed columns (`compensation_supported boolean`,
  `compensation_requires_separate_authority boolean DEFAULT true`,
  `compensation_description text`). Reason: `CompensationPolicySchema`
  (frozen) is exactly `{supported, requiresSeparateAuthority, description?}`
  — M8's decomposition matches the closed shape field-for-field with real
  constraints; M7's jsonb blob is opaque by comparison. Same table, same
  owner (M7/`0102`), better column typing.
- **`version integer DEFAULT 1`** (M8 only): **drop**. `ActionIntentSchema`
  has no per-row version field, and the row is immutable (one insert, no
  update) — "version" only means anything at the `action_plan.plan_version`
  granularity, which already exists. Not needed.
- **`basis_assessment_id uuid`** (M8 only, FK to `assessments`): **drop from
  `action_intents`**. `ActionIntentSchema` has no such field. The
  currentness-basis concept already exists one layer up, correctly, on
  M7's `recovery_strategies.basis_assessment_id` /
  `strategy_changes.basis_assessment_id` (planning-time basis). Verified
  M8's own gate code (`assessmentGate.ts`, `decisionGates.ts`) does **not**
  read `action_intents.basis_assessment_id` for the live currentness check
  — it was write-only/unused, populated only by the now-deleted
  `createActionPlanWithIntent` command (§4). Nothing to preserve.
- `logical_operation_key` / `request_fingerprint`: M7's compiler
  (`src/resolution/planning/compiler.ts`) **already computes both
  deterministically at compile time** for every ScenarioEffect kind (see
  `fingerprint()` calls, one per case in the switch) and inserts them
  immutably. M8's `prepareActionIntentDispatchIdentity` command assumed
  these were nullable/filled-in-later via `UPDATE` — that contradicts the
  immutability trigger and is now unnecessary. See §4.

## 4. ActionIntent → Authority/Execution seam — code changes required

Full read of `m8AuthorityCommands.ts` (512 lines), `pgExecutionWorker.ts`,
`internalProgrammeExecutor.ts`. Confirmed real bug, not just a schema
mismatch: **M8 currently mutates the immutable `action_intents` row in three
places**, all safe to remove because canonical truth is already recorded
elsewhere before each one fires:

| Location | Illegal write | Why removable |
|---|---|---|
| `m8AuthorityCommands.ts` `createActionPlanWithIntent` | `INSERT INTO action_plans` / `action_intents` — a **second ActionIntent creation path**, duplicating M7's compiler | Delete the function. M8 must consume plans/intents M7's compiler already produced, never mint its own. |
| `m8AuthorityCommands.ts` `prepareActionIntentDispatchIdentity` | `UPDATE action_intents SET logical_operation_key=…, request_fingerprint=…` | Dead once intents arrive pre-populated from the compiler. Replace with a pure equality check (read + compare, no write) if a caller still needs to assert the identity it's about to dispatch matches the compiled intent. |
| `m8AuthorityCommands.ts` `createPreparedExecutionAttempt` line ~458 | `UPDATE action_intents SET status='EXECUTING'` | Redundant: `execution_attempts_one_active_claim_uidx` (partial unique index on CLAIMED/DISPATCHING/DISPATCHED) plus this function's own prior-attempt lookup already prevent duplicate dispatch. Delete the statement. |
| `internalProgrammeExecutor.ts` ~line 149 | `UPDATE action_intents SET status='COMPLETED'` | Redundant: by this line, `execution_attempts.status='OBSERVED_SUCCESS'` and an `execution_observations` (INTERNAL_COMMAND_RECEIPT) row are already committed in the same transaction. Delete the statement. |

**Status ownership decision** (governs the above): `action_intents.status`
is write-once at compile time (M7's compiler sets PROPOSED/REJECTED/
SUPERSEDED only — verify exact set when reading `compiler.ts` status
assignment during implementation) and is the **immutable planning
disposition**. It is never updated after insert. The **execution truth**
(AUTHORIZED / EXECUTING / COMPLETED / FAILED, in effect) lives entirely in
`execution_attempts.status` (`ExecutionAttemptStatus`, already a proper
fenced state machine via `transitionExecutionAttempt`) plus
`authority_decisions`/`approvals` for the authorization state. Any reader
that wants "the current effective state of this intent" must derive it by
joining `action_intents` + latest `execution_attempts` row (+
`authority_decisions`/`approvals` satisfaction) — this projection is M9's
job per the plan (M7 evidence finding M7-1: "M9 will consume"); this
integration does not need to build the read-model view, only stop the
duplicate-write bug.

Still to verify while implementing: `budget/protect.ts`, `stateMachine.ts`,
`capability.ts`, `envelope.ts`, `authorize.ts`, `decisionGates.ts`,
`assessmentGate.ts`, `payerCurrencyGate.ts` for any further reference to the
dropped `action_intents` columns/functions, and every test file that
constructs an intent via the now-deleted `createActionPlanWithIntent`.

## 5. Progress log

Done (2026-09-15, this session):

1. ✅ Merged M7 lane into `integration/m7-m8-c3` — clean, no conflicts.
2. ✅ Merged M8 lane — only `docs/ROADMAP.md` conflicted (hand-resolved:
   merged both lanes' rows + added an "M7/M8 integration in progress" row).
   Migration-number collision confirmed present as expected (two files each
   claiming 0100/0101/0102 with different content — not a git conflict since
   filenames differ).
3. ✅ Applied §2 migration renumbering: deleted M8's `0100_recovery_cases_minimal.sql`
   and `0101_action_plans_intents.sql`; renamed M8's `0102-0105` →
   `0109-0112` (`git mv`, header comments updated).
4. ✅ Applied §3 field amendments: `0109` now ALTERs `recovery_cases` to add
   `resolution_kind` + `SUPERSEDED` lifecycle value, and adds
   `action_plans_case_version_uidx`. `0102_action_plans.sql` (M7, hand-edited)
   now uses typed `cost_amount`/`cost_currency` and
   `compensation_supported`/`compensation_requires_separate_authority`/
   `compensation_description` columns instead of the two opaque jsonb blobs.
   `authority_decisions.action_intent_version` kept with a
   `CHECK (... = 1)` + explanatory comment (no independent ActionIntent
   version exists; frozen AuthorityDecision/Envelope schemas still require
   the field for structural symmetry with actionPlanVersion).
5. ✅ Applied §4 code changes:
   - `m8AuthorityCommands.ts`: `createActionPlanWithIntent` +
     `prepareActionIntentDispatchIdentity` replaced by one
     `persistActionPlan(uow, {plan: ActionPlan, ...})` that writes a fully
     compiled M7 `ActionPlan` (all intents + dependencies) verbatim — no
     second ActionIntent representation, no field defaults invented here.
   - `createPreparedExecutionAttempt` no longer accepts
     `logicalOperationKey`/`requestFingerprint` as caller params — both are
     read from the already-persisted, immutable `action_intents` row. The
     `UPDATE action_intents SET status='EXECUTING'` statement is deleted.
   - `internalProgrammeExecutor.ts`: dropped the same two params from
     `executeInternalProgrammeItemSchedule`; deleted the
     `UPDATE action_intents SET status='COMPLETED'` statement (execution
     truth was already fully committed one statement earlier via
     `execution_attempts` + `execution_observations`).
   - `pgExecutionWorker.ts`: no `action_intents` references at all — untouched.
6. ✅ Rewrote `postgres-integration/m8AuthorityExecution.pgtest.ts` end to end
   for the new `persistActionPlan`/`createPreparedExecutionAttempt`
   signatures (added a `buildSingleIntentPlan` test helper). The internal-
   programme-execution test now asserts `action_intents.status` stays
   `'PROPOSED'` (the immutable planning disposition) instead of asserting it
   became `'COMPLETED'` — that assertion was testing the bug this
   integration removes.
7. ✅ `npm run typecheck` — clean (0 errors) after all of the above.
8. ✅ All 83 pure-unit tests across M6/M7/M8/contracts (`node --test` via
   `tsx`, no DB) still pass unchanged.
9. ✅ Proved migrations `0001`-`0112` (90 files) apply cleanly, in order,
   from a completely empty PostgreSQL/PostGIS database (`m7m8_empty_check`,
   dropped after). No duplicate-version error (the exact failure mode the
   pre-fix state would have hit).
10. Found and fixed two more integration seams while auditing cross-lane
    test infrastructure M7 had modified:
    - `postgres-integration/integrationCrossLane.pgtest.ts`: `LANE_RANGES`
      had no M8 entry (only went up to M7's `100-108`) — migrations
      `0109-0112` would have failed its "no migration outside an allocated
      range" assertion. Added `{ lane: 'M8', from: 109, to: 119 }` +
      an `inLane('M8')` contiguity assertion.
    - `postgres-integration/m2SubtypeIntegrity.pgtest.ts`: `INTEGRATED_ACTIVATED_KINDS`
      only listed M2-M7 kinds; M8's `AUTHORITY_DECISION`/`APPROVAL`/
      `EXECUTION_ATTEMPT` subtype-checker registrations would have failed
      the "only integrated-lane kinds have checkers" assertion as "leaked"
      kinds. Added `M8_ACTIVATED_KINDS` and included it. Also removed the
      now-nonexistent `action_intents.cost_estimate`/`compensation_policy`
      jsonb-column allowlist entries (§3c typed the columns instead).
    - `docs/refactor/MIGRATION_MAPPING.md` §5 table updated to record where
      M8 actually landed (`0109-0112`) instead of just "reserved".

In progress: full `npm run test:postgres` run against a fresh DB
(`m7m8fullrun`) to catch any further fallout — started **before** the two
cross-lane test fixes above landed, so it is expected to fail on those two
(already fixed) and needs a re-run once it finishes to get a clean signal.
Docker Desktop was not running at session start; started it + the existing
`northstar-postgres-test` container (already present, just stopped).

## 6. Remaining plan

1. Re-run `npm run test:postgres` clean (after the in-flight run reports
   back) — expect only the two already-fixed cross-lane issues, but verify
   no other fallout (e.g. anything else in `postgres-integration/` asserting
   on the dropped `basis_assessment_id`/`version` columns or the old
   `createActionPlanWithIntent`/`prepareActionIntentDispatchIdentity` names —
   grepped clean already, but the real DB run is the actual proof).
2. Write the 10 cross-lane integration acceptance tests (task's
   `INTEGRATION ACCEPTANCE TESTS` section) — delegate to subagents once
   `test:postgres` is fully green, per the task's parallelism rule. Test #1
   ("real M7 strategy compiles to the exact ActionIntent shape M8
   authorizes") should exercise the real pipeline:
   `evaluateRecoveryStrategy` → `compileActionPlan` (M7) →
   `persistActionPlan` (this integration's new seam function) →
   `issueAuthorityDecision`/`recordApproval` → `createPreparedExecutionAttempt`
   (M8) — not a hand-built fixture plan like the rewritten unit-style pgtest
   uses.
3. `npm run build`, `npm run lint`, `npm run gate:anti-hardcoding`,
   `git diff --check`.
4. `docs/refactor/evidence/M7_M8_INTEGRATION.md`, update `ROADMAP.md` only
   once gates are green, final verification sweep, checkpoint commits, push.
5. Completion report per the 26-point structure requested. Do not claim C3
   PASS. Do not start M9.

## 6. Test-DB / environment notes (carried from M2-M6 integration, memory
`northstar-long-horizon-a`)

- Container `northstar-postgres-test`; `PGTEST_DB` must be lowercase
  (uppercase silently fails every test after ~33s — unquoted `CREATE
  DATABASE` folds case).
- Test DB role is `northstar_test`, not `postgres`.
- Files are CRLF (`core.autocrlf=true`).
