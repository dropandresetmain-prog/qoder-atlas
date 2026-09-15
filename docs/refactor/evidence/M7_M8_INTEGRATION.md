# M7 + M8 → C3 candidate integration evidence

Status: **C3 TARGETED-FIX CANDIDATE — READY FOR REVIEWER CONFIRMATION** (not
C3 PASS). The original candidate evidence below is preserved; §11 records
targeted remediation for reviewer Act Now findings AN-1 … AN-6.

## 1. Identity

| Item | Value |
|---|---|
| Common accepted base | `integration/m2-m6-domain-evaluation` @ `a0843db73c5e4bd7fb5c1874391d7361b789aed1` (C2 PASS/ACCEPTED) |
| M7 lane | `milestone-m7-recovery-planning` @ `b38dbd82edf746faabb06f8e98f30019a005834b` |
| M8 lane | `milestone-m8-authority-execution` @ `c5779293d45ca740d07cedad168383fd16e1ef99` |
| Integration branch / worktree | `integration/m7-m8-c3` / `C:/Dev/qoder-atlas-m7-m8-c3` |
| Working ledger | `docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md` (full reasoning, empirically-derived viability recipe, subagent reports) |

All three refs were verified byte-for-byte against both the local clone and
`origin` before any work began.

## 2. Merge

M7 merged onto the base cleanly (no conflicts). M8 merged onto M7 with one
conflict in `docs/ROADMAP.md` (both lanes described the same M7/M8 state
from their own branch's perspective; hand-merged into one row set). No
other file outside the migrations directory was touched by both lanes.

## 3. The known critical collision — resolved

Both lanes independently created migrations `0100`-`010x` for overlapping
table families (`recovery_cases`, `action_plans`, `action_intents`). Since
the filenames differed (e.g. `0100_recovery_cases.sql` vs.
`0100_recovery_cases_minimal.sql`), git did not flag this as a text
conflict — both files existed simultaneously post-merge, which would have
thrown `duplicate migration version 0100` at apply time.

Resolution (source of truth: M7's own migration-header comment, "M8 owns
authority/execution tables in `0109+`", the most specific documented
allocation available — more specific than `MIGRATION_MAPPING.md`'s joint
`0100-0119` range):

- Deleted M8's provisional `0100_recovery_cases_minimal.sql` and
  `0101_action_plans_intents.sql` entirely.
- Renumbered M8's real authority/execution migrations `0102-0105` →
  `0109-0112`.
- M7's canonical `0100`-`0102` are the base, hand-amended (not recreated)
  for the seam:
  - `recovery_cases` gains `resolution_kind` (additive column) and a
    `SUPERSEDED` lifecycle value (additive lookup row) via `0109`.
  - `action_plans` gains `action_plans_case_version_uidx` (additive
    index) via `0109`.
  - `action_intents`'s opaque `cost_estimate`/`compensation_policy` jsonb
    columns were replaced with typed columns
    (`cost_amount`/`cost_currency`,
    `compensation_supported`/`compensation_requires_separate_authority`/
    `compensation_description`) matching the frozen `ExactMoneySchema`/
    `CompensationPolicySchema` field-for-field — a representation
    improvement on the same M7-owned table, not a new owner.
  - `action_intents` was also missing `created_at`/`created_by_actor_id`
    entirely (every sibling entity table in the same migration has both) —
    a genuine oversight in M7's original migration, only surfaced once a
    real INSERT actually ran against it for the first time; added.
  - `authority_decisions.action_intent_version` is always `1` (ActionIntent
    has no independent per-row version — immutable single-row identity;
    a superseding proposal is a new SubjectId, never a version bump in
    place), kept with a `CHECK (... = 1)` for contract-shape fidelity with
    the frozen `AuthorityDecision`/`AuthorityEnvelope` schemas.
  - `action_intents.basis_assessment_id` (M8's original) was dropped, not
    recreated — verified unread by `assessmentGate.ts`/`decisionGates.ts`,
    and the currentness-basis concept already lives correctly one layer up
    on `recovery_strategies`/`strategy_changes.basis_assessment_id`.

Proved clean: migrations `0001`-`0112` (90 files) apply in order from a
completely empty PostgreSQL/PostGIS database, twice, after every schema
edit that followed the initial reconciliation.

## 4. The ActionPlan → authority seam

M8 originally minted its own `ActionIntent` rows via
`createActionPlanWithIntent` (ad-hoc params, hardcoded defaults for fields
the compiler should own) and lazily bound dispatch identity via
`prepareActionIntentDispatchIdentity` — a second ActionIntent
representation the task explicitly forbids. Both are gone.

`persistActionPlan` (`src/persistence/postgres/commands/
m8AuthorityCommands.ts`) is the one seam function: it takes a fully
compiled M7 `ActionPlan` object (exactly what `compileActionPlan` produces)
and writes every intent and every dependency edge verbatim — one INSERT
per row, no re-derivation, no invented defaults. `createPreparedExecutionAttempt`
reads `logicalOperationKey`/`requestFingerprint` from the already-persisted
immutable intent row instead of trusting caller-supplied values.

Verified end-to-end (acceptance test #1, §6) that a real
`evaluateRecoveryStrategy` → `compileActionPlan` output persists into
`action_intents` field-for-field identical to the in-memory compiled
object: identity/logical-operation-key/request-fingerprint, subject scope,
expected revisions, capability requirement, authority scopes, cost/quote
context, expected observations, dependency ordering.

## 5. Status ownership

`action_intents.status` is write-once (M7's compiler sets it at compile
time via the `forbid_mutation` trigger already on the table) — the
immutable planning disposition. Two illegal `UPDATE action_intents SET
status = ...` statements were found and removed
(`createPreparedExecutionAttempt` setting `'EXECUTING'`,
`internalProgrammeExecutor.ts` setting `'COMPLETED'`) — both were dead
writes: canonical execution truth (`execution_attempts.status` /
`execution_observations`) was already fully committed one statement
earlier in both cases. This was a real duplicate-mutable-owner bug the
task's STATUS OWNERSHIP section warned about, not a hypothetical risk —
confirmed by grepping the entire execution path before removing either
statement. No architecture gap: the frozen contracts already express one
canonical execution-truth owner; the code just hadn't obeyed it in two
spots.

## 6. Cross-lane integration acceptance tests

Ten acceptance criteria required by the integration task; all ten are now
proven against the real compile → persist → authorize → execute pipeline
(never a hand-built stand-in `ActionPlan`), across four
`postgres-integration/m7m8*.pgtest.ts` files:

| # | Criterion | Result |
|---|---|---|
| 1 | Real M7-compiled ActionIntent shape == what M8 persists/authorizes | PASS |
| 2 | Approval doesn't survive a world change before dispatch (currentness re-checked live, not cached) | PASS |
| 3 | Programme recovery end-to-end through the real M4 `updateProgrammeItemSchedule` command | PASS |
| 4 | Objective-loss proposal viable only via M6's `waived_objectives` semantics; an unrelated mandatory HARD objective stays independently mandatory | PASS |
| 5 | Multi-intent DAG dependencies enforced at M8 execution time | PASS (real gap found and fixed, §7) |
| 6 | Shared-resource / cross-person strategy: every affected Journey independently assessed before authority | PASS |
| 7 | Budgeted paid action: real M7 cost/quote context feeds M8's exact-money budget hold, no duplicate cost representation | PASS (real gap found and fixed with user approval, §7) |
| 8 | Unsupported provider capability: planner compiles under a declared-supported statement, the executor's own observed-capability check still refuses truthfully | PASS |
| 9 | Unknown provider outcome: claim → `LOST_RESPONSE` → `OUTCOME_UNKNOWN` → blocked redispatch → reconcile, on a real compiled external intent | PASS |
| 10 | Same evaluate/compile/persist/authorize call sequence, zero scenario-specific branching, handles two materially different scenario kinds | PASS |

Test-writing was parallelized across three subagents once the seam (§3-§5)
was frozen and green, per the task's own parallelism guidance; each was
independently re-run and spot-reviewed by the primary integration owner
before being trusted.

## 7. Two real architecture gaps found by actually exercising the seam — both closed

Neither was visible from either lane's own isolated test suite; both only
surfaced once a real compiled plan was pushed through the real M8
execution path for the first time.

**DAG enforcement was entirely missing.** `action_dependencies` was
write-only — inserted by `persistActionPlan`, never read anywhere in
`pgExecutionWorker.ts`, `internalProgrammeExecutor.ts`, or
`createPreparedExecutionAttempt`. A downstream intent could dispatch
before its prerequisite completed. Fixed: `createPreparedExecutionAttempt`
now requires every prerequisite to have a terminal-success
`execution_attempts` row before preparing a new attempt; a failed
prerequisite blocks permanently, an in-progress one blocks until it
resolves.

**Cost/quote context never reached the compiled ActionIntent.**
`compileActionPlan`'s `intentForEffect` never set `costEstimate` for any
`ScenarioEffect` kind; `ResolvedOffer` carried no price field anywhere in
the frozen M7 seam. Fixed with the user's explicit approval (the change
touches a frozen M0 contract file): an additive `offerPrice` field on the
`SELECT_OFFER` `ScenarioEffect` variant, permitted under `CONTRACTS.md`'s
additive-only-after-C0 rule, plus one line in the compiler to carry it onto
`costEstimate`.

## 8. Verification (all run against this exact HEAD)

| Check | Result |
|---|---|
| Migrations `0001`-`0112` from an empty PostgreSQL/PostGIS DB | Clean, twice |
| `npm run typecheck` | Clean |
| `npm run build` | Clean |
| `npm run lint` | Clean |
| `npm run gate:anti-hardcoding` | CLEAN |
| `git diff --check` | Clean |
| Pure unit suite (M6/M7/M8/contracts, no DB) | 40/40 (re-run after the contract change) |
| `npm run test:postgres` (full suite, including all 10 cross-lane tests) | **403/403 pass, 0 skipped, 0 fail** |

## 9. Explicitly out of scope / not claimed

- C3 PASS — independent review, not claimed here.
- M9 (application composition/runtime/UI) — not started.
- Any live/paid provider call — none made; all verification uses the
  isolated Postgres test container.
- The M9-owned read-model projection of "effective ActionIntent status"
  (deriving AUTHORIZED/EXECUTING/COMPLETED for display from
  `execution_attempts`/`authority_decisions`) — the write-side status
  ownership is fixed (§5); building the read projection is M9's job per
  the plan, not this integration's.

## 10. Next dependency

Return the targeted-fix candidate to the **same C3 reviewer** for
confirmation. Do not begin M9 before C3 closes.

## 11. C3 targeted remediation (reviewer Act Now AN-1 … AN-6)

Reviewer base: `integration/m7-m8-c3` @ `ec5b07413168c2506473ae0c5220f97408db4108`.
Remediation continues on the same branch lineage.

### AN-1 — stored authority + live currentness gate

**Root cause:** `authorizeDispatch` accepted caller-built envelope/assessment
objects; `createPreparedExecutionAttempt` did not load `authority_decisions`,
approvals, revocations, grants, or live `currentAssessmentView`.

**Fix:** `src/persistence/postgres/execution/storedExecutionGate.ts`
(`evaluateStoredExecutionGate`) builds the envelope from stored
`action_intents` + `action_plans`, loads persisted authority bundle and grants,
requires live `currentAssessmentView` for assessable subjects, and is invoked
from `createPreparedExecutionAttempt` and `PgExecutionWorker.dispatchClaimed`.
`authority_decision_id` stored on new attempts (migration `0113`).

**Focused proof:** `postgres-integration/c3TargetedRemediation.pgtest.ts`
(AN-1 A/B/C). AN-1C advances an assessment aggregate after authority and
proves the same stored gate refuses prepare (live `currentAssessmentView`);
dispatch-time re-check uses the identical `evaluateStoredExecutionGate` path.

### AN-6 — budget hold from stored intent cost

**Root cause:** `holdBudgetForIntent` treated caller `requested` as authoritative.

**Fix:** `holdBudgetForIntent` loads `action_intents.cost_amount/cost_currency`
and uses those for admission; gate requires a HELD commitment matching stored
cost for costed intents.

**Focused proof:** `c3TargetedRemediation.pgtest.ts` (AN-6).

### AN-2 — internal programme executor bound to stored intent

**Root cause:** `executeInternalProgrammeItemSchedule` trusted caller
authorization/programmeItem/schedule; M4 failure left DISPATCHED attempts.

**Fix:** Executor loads schedule from `strategy_changes` (or embedded
`recovery_strategies.scenario_change`), runs canonical gate via prepare,
uses stored `PROGRAMME_ITEM` subject ref, records `OBSERVED_FAILURE` on M4
reject, uses real `programmeRevision` from command receipt.

**Focused proof:** `m7m8IntegrationSeam.pgtest.ts` programme path (updated).

### AN-3 — known success must not dispatch again

**Root cause:** Second prepare with new idempotency key could create a fresh
attempt after `OBSERVED_SUCCESS`.

**Fix:** `findKnownSuccessAttempt` replays; partial unique index
`execution_attempts_one_live_logical_op_uidx` on non-retryable statuses.

**Focused proof:** `c3TargetedRemediation.pgtest.ts` (AN-3).

### AN-4 — reconciliation honours fencing

**Root cause:** Reconcile path ignored failed transitions and could insert
observations after fence failure; crash states lacked claim path.

**Fix:** `PgExecutionWorker.reconcileUnknown` checks every transition;
atomic observation+terminal transition; `claimForReconciliation` for
DISPATCHING/DISPATCHED/OUTCOME_UNKNOWN; `DISPATCHING → RECONCILIATION_REQUIRED`
allowed in state machine.

**Focused proof:** `m7m8CurrentnessAndReconciliation.pgtest.ts` (updated).

### AN-5 — plan validation at persistence boundary

**Root cause:** `persistActionPlan` could store cyclic/cross-plan edges.

**Fix:** `ActionPlanSchema.parse` + `validateActionPlanAcyclic` at entry;
DB trigger `action_dependencies_same_plan`.

**Focused proof:** `c3TargetedRemediation.pgtest.ts` (AN-5).

### IN-1 — re-plan logical operation identity (Investigate Now → decision)

**Decision:** **Ignore / Accept Risk** for code change — existing identity is
sufficient when used as designed.

- **Identity rule:** `(workspace_id, logical_operation_key)` where the key
  embeds effect-specific ids (compiler) and `request_fingerprint` binds
  `strategyVersion` + effect payload hash.
- **Retry rule:** Same intent row ⇒ same key+fingerprint; safe retry after
  `OBSERVED_FAILURE`/`FAILED` only (partial unique index excludes those).
- **Re-plan rule:** Later strategy compiles a **new** `ActionIntent`
  SubjectId ⇒ new key/fingerprint; not blocked by prior failed attempt.
- **Duplicate irreversible action:** Prevented by success/in-flight partial
  unique index + prepare-time replay of known success.

M9 must not inherit an undecided identity — this decision closes IN-1.

### Verification (targeted remediation)

Ran on worktree `C:\Dev\qoder-atlas-m7-m8-c3`, branch `integration/m7-m8-c3`
(base `ec5b074…`; changes uncommitted at evidence write):

- `npm run typecheck` — pass
- `npm run build` — pass
- Focused PG suites (42 tests): `c3TargetedRemediation`, `m8AuthorityExecution`,
  four `m7m8*` seam files — **42/42 pass**
- `npm run test:postgres` — **415/416 pass** after registering migration `0113`
  in `integrationCrossLane.pgtest.ts`

**Park for Later:** `m2Travel.pgtest.ts` “every statement the read model emits
can use the index its port names” — planner chose
`idx_transport_item_details_destination` for an origin OR-query; unrelated to
the C3 execution gate. Revisit if it keeps failing on a clean DB.
