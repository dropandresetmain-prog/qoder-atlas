# ARCHIVED LEDGER — Live read-model contract lane

> Archived from `docs/work/ACTIVE_TASK.md` at `lane/wit-live-readmodel-contract@cbe5f83`
> during post-C5 convergence. Historical record only; not the current active task.

## Fixer lane: live read-model contract prerequisites (2026-09-17)

Branch `lane/wit-live-readmodel-contract` from `review/wit-frontend-semantic-contract-opus`
@ `fe09c525528df67a0a5fb5df4811bb7d5feddd77` (verified via `git rev-parse`), in worktree
`C:/Dev/qoder-atlas/.worktrees/wit-live-readmodel-contract`. Scope: FIG-1/2/3/4/6/7 from
`docs/FRONTEND_SEMANTIC_CONTRACT.md`'s gap table — backend read-model producer fixes plus
the single frontend boundary follow-through. Does not merge/depend on M10.

### Phase 1 investigation — key files and findings

- `LdgNode`/`LdgEdge`/`ChangeAwareness`/`LiveDependencyGraph` live in
  `src/contracts/v2/product/readModels.ts:65-90`. `LdgEdge` today is
  `{fromRef, toRef, kind, semanticState?}` — no id, no authority.
- Producer: `src/app/target/readmodels/pgFactAssembler.ts`. `loadRecoveryCaseFacts`
  (`:209-380`) queries `case_subjects` with no `ORDER BY` (`:263`), sets
  `projectionRevision = recoveryActions.length + subjects.rows.length` (`:333`),
  `changedVisibleRefs = recoveryActions.map(a => a.actionRef)` (`:334`, action ids that
  never match a graph node ref), builds case-subject nodes that all take the aggregate
  verdict (`:339-347`, FAILED if any subject fails else AFFECTED — a PASS subject can
  never read HEALTHY). `loadOperatorOverviewFacts` (`:382-453`) makes only case rows into
  nodes (`:443-449`, `ref = caseRef ?? tripRef`), collapses everything but DISRUPTED into
  HEALTHY (`:447`), revision = item count, changedVisibleRefs = every case every read.
- Pure projectors: `src/app/target/readmodels/liveDependencyGraph.ts` (defaults omitted
  node authority to AUTHORITATIVE at `:19`; drops dangling edges) and
  `changeAwareness.ts` (dedupes/sorts refs, passes revision through — no diff engine).
  Facts shape: `src/app/target/readmodels/types.ts` (`ProductNodeFact`/`ProductEdgeFact`
  `:21-35`, no id/authority on edges, no `evaluation` field).
- FIG-7 source of truth: `currentAssessmentView` in
  `src/persistence/postgres/world/pgAssessments.ts:195-227` returns
  `AssessmentViewStatus` (`CURRENT|STALE|PENDING_REASSESSMENT|UNAVAILABLE|NONE`, type
  defined at `:185`, not currently exported from any `contracts/` module — `src/ui` may
  not import `src/persistence`, so this needs a contracts-level re-export). Reassessment
  worker: `PgReassessmentWorker` same file `:271-422`, `runOnce(now, pipeline, workspaceId)`
  claims exactly one row (`SELECT ... FOR UPDATE SKIP LOCKED ... LIMIT 1`), driven directly
  in `postgres-integration/m6Reassessment.pgtest.ts`. Ingestion path:
  `acceptProviderShapedDemoEvent` (`src/app/target/applicationCommands.ts:183-246`) calls
  `recordTransportObservation` (`src/persistence/postgres/commands/arrangementCommands.ts`),
  whose transaction fires the M6 triggers in migration `0091` that enqueue
  `scheduled_reassessments` rows for every reached subject — proven end to end in
  `postgres-integration/m9DemoIngress.pgtest.ts` (ingress -> `currentAssessmentView` reads
  `PENDING_REASSESSMENT`).
- Frontend boundary: `src/ui/semantics/adapter.ts` (124 lines) — one exhaustive
  `Record<Enum, SemanticIndicator>` table per dimension via a `mapped()` helper that
  throws `UNMAPPED SEMANTIC STATE` on a miss (`:73-76`); `truthMode` from `AUTHORITY`
  table (`:69-71,105`); `changeState` from `changedVisibleRefs` set membership (`:93,106`,
  inline, not a table). `src/ui/semantics/model.ts` — `PresentationNode` fields at
  `:17-29`. `src/ui/semantics/grammar.ts` — label maps `:21-29`, `data-*` attribute CSS
  selectors `:44-55`. `src/ui/semantics/components.ts` — `semanticNode()` builds
  `data-*` attrs and marker spans, `:11-21`. `src/ui/screens/contract-lab.ts` — lettered
  panel sections A-F built via a `section()` helper (`:93-99`), registered in a nav array
  (`:298-302`).
- Edge identity source (FIG-1): `case_subjects` PK is
  `(workspace_id, recovery_case_id, subject_kind, subject_id, role)` — no serial column
  (`migrations/0100_recovery_cases.sql:25-40`). A canonical edge id can be derived as
  `${kind}:${fromRef}:${toRef}` (or with `role` where available) since the composite is
  already unique per relation; `ORDER BY subject_kind, subject_id, role` makes producer
  order deterministic without a schema change.

### FIG-3 revision design — durable sources found, gap identified

- `aggregate_heads.revision` (`migrations/0003_identity_registry.sql:37-44`, PK
  `(workspace_id, aggregate_id)`) is a real per-aggregate-root monotonic bigint, CAS-advanced
  by `advanceHead`/`createRoot` in `commandSupport.ts`. `RECOVERY_CASE` and `ACTION_PLAN`
  are each registered as their own aggregate root (`createRoot` calls at
  `m8AuthorityCommands.ts:118,163`), so a case's own lifecycle changes are already covered.
  **Confirmed gap:** `ACTION_INTENT` is a *child* subject under its `ACTION_PLAN` root
  (`registerChildSubject`, `commandSupport.ts:72-84`, "no aggregate_heads row: the root is
  the only revision counter"), and `execution_attempts`/`execution_observations` inserts in
  `m8AuthorityCommands.ts` never call `advanceHead` on that plan (`grep` for `advanceHead`
  in that file only hits the RESOURCE budget path at `:516`) — so a recovery action's
  execution/observation state changing does **not** advance any existing monotonic counter.
- `scope_generations.generation` (`migrations/0006`, extended `0090`) is monotonic per
  `(scope_kind, scope_id)`, trigger-advanced for ~50 owning tables, but has no scope kind
  for "this subject's assessment/evaluation lifecycle changed", and `assessments` /
  `scheduled_reassessments` have no serial/sequence column at all (`id` is a random uuid on
  both) — confirmed by grep across `migrations/` for `CREATE SEQUENCE|bigserial|GENERATED
  ALWAYS AS IDENTITY|serial`: no matches anywhere in the schema. So neither a subject's
  CURRENT-assessment verdict changing nor its `AssessmentViewStatus` transitioning
  (`CURRENT -> PENDING_REASSESSMENT -> CURRENT`) advances any existing counter — this is
  exactly the dimension the FIG-3/FIG-7 proof test needs to observe increasing.
- **Conclusion: an honest monotonic revision needs a new migration** (matches the lane's
  own stop condition). Smallest proposed shape — reuse the existing `scope_generations`
  machinery rather than inventing a new table: add one new `scope_kind`
  (`'EVALUATION_LIFECYCLE'`, scope_id = `<SUBJECT_KIND>:<subject_id>:<assessment_kind>`,
  deliberately not referenced by any `assessment_inputs` row so it cannot feed back into
  `m6_enqueue_reassessment_for_input` and cause invalidation loops), plus two small
  `AFTER INSERT`/`AFTER INSERT OR UPDATE OF state` triggers that bump it: one on
  `assessments` (new CURRENT verdict), one on `scheduled_reassessments` (state transitions
  PENDING/CLAIMED/DONE/UNAVAILABLE). A node/case revision reads as
  `GREATEST(aggregate_heads.revision for its own/plan aggregate, MAX(scope_generations.generation
  WHERE scope_kind='EVALUATION_LIFECYCLE' for each subject the node presents))`.
  **Paused per the lane's explicit stop condition — proposal sent to the user for approval
  before writing this migration.** FIG-1/2/4/6/7 (minus the revision-dependent parts of the
  proof test) do not depend on this and proceed in parallel.

### Commit plan (one FIG per commit where practical)

1. FIG-1: `LdgEdge.id` (contract + producers + adapter `renderKey`), deterministic
   `case_subjects` ORDER BY, duplicate-id rejection in the schema/adapter boundary.
2. FIG-2: `LdgEdge.authority`, `ChangeAwareness.changedEdgeIds`, adapter `truthMode`/
   `changeState` for edges.
3. FIG-4: subject-keyed node refs on dashboard/overview producer + `caseRef` linkage field.
4. FIG-6: per-subject CURRENT-verdict fidelity on case/overview node `semanticState`.
5. FIG-7 (contract + producer + frontend, minus revision): `AssessmentViewStatus` re-export,
   `evaluation` field on `LdgNode`/`OperatorOverviewItem`, adapter `evaluationState`
   dimension, grammar/components `data-evaluation` + marker, Contract Lab panel.
6. FIG-3 (blocked): migration (pending approval) + real revision on all producers +
   honest `changedVisibleRefs`/`changedEdgeIds` semantics.
7. Proof test: `postgres-integration/witLiveReadModelContract.pgtest.ts` per the required
   6-step sequence, plus unit tests for edge-id uniqueness, revision monotonicity, adapter
   mappings and Contract Lab rendering.

### Phase 2 checkpoint — all commits landed, FIG-3 design corrected during implementation

Commits on `lane/wit-live-readmodel-contract` (base `fe09c52`):
`61a7829` phase-1 plan, `837829e` FIG-3 migration 0121 (approved), `c4822f6` FIG-1/2/4/6/7,
`e9e3c95` FIG-3 revision engine + migration 0122 + proof test, `a782179` doc updates.

**FIG-3 design correction, found by the proof test itself.** The plan approved in the
"FIG-3 revision design" section above (`GREATEST(aggregate_heads.revision, MAX(scope_generations.generation ...))`)
had two bugs neither review caught until the pgtest exercised it:

1. A first attempt at `projectionRevision` **summed** the case's `aggregate_heads.revision`
   and every subject's small `EVALUATION_LIFECYCLE` `generation` counter (0121) into one
   scalar. Sum is safe against ties for "did anything change" (strictly increases whenever
   any component does), but `changedVisibleRefs` compared each subject's own small counter
   (starting near 1) against that combined scalar (starting near 4) — a settled subject
   still read `PENDING_REASSESSMENT` in the test because its own counter could never exceed
   the much larger sum. Caught by
   `postgres-integration/witLiveReadModelContract.pgtest.ts`'s "changed refs name exactly
   the dependent subjects" assertion.
2. Reverting to `MAX` (to keep the scale consistent) reintroduced the original tie hazard:
   in the test, after the worker settled the first of two pending subjects, the second
   subject's small `generation` counter caught up to (without exceeding) the first
   subject's already-recorded max, so the real second settlement was invisible —
   `revision must increase after step 1 (4 > 4)`.

**Fix (migration 0122, same commit as the revision engine):** read `last_advanced_xact`
(the `pg_current_xact_id()` xid8 stamp every `m6_bump_scope` call already writes, 0090)
instead of the small `generation` counter, and route `RECOVERY_CASE`'s own presented-content
changes through the same `EVALUATION_LIFECYCLE` scope family (new trigger on
`recovery_cases`) instead of `aggregate_heads.revision`, so every component is on the same
scale. xid8 is per-database, globally unique and strictly increasing, so `MAX` is safe (no
two different real transactions ever tie) and a caller's `sinceRevision` compares correctly
against every component. This did not require touching 0121 or re-approval — it reads an
existing column the approved migration's own trigger machinery (0090's `m6_bump_scope`)
already populated; 0122 only adds the `recovery_cases` trigger.

**FIG-4 known limit (not closed).** `loadOperatorOverviewFacts` only lists items with an
existing `recovery_cases` row, so no read model can render a subject's node before it is
attached to a case. The proof test's step 5 could not literally exercise "no node before
escalation, same ref after" for that reason; it instead asserts the ref-stability guarantee
that *is* real — the failed subject's ref is identical to the baseline read and to the case
graph's own ref, and it carries `caseRef` throughout. Flagged for a future lane; closing it
would mean a new pre-case-membership read model (out of "smallest additive change" scope
here) or opening the case earlier in the choreography (a product decision, not a read-model
bug).

**Verification run for this checkpoint:**
- `npm run typecheck` — exit 0, after every edit in this lane.
- Focused unit: `node --test test/ui-semantic-contract.test.ts test/m9-product-readmodels.test.ts
  test/m9-product-surfaces.test.ts test/m9-checkpoint2-unit.test.ts
  test/m9-jordan-partial-failure-acceptance.test.ts test/m9-vertical-loop.test.ts` — 47/47 pass.
- Focused Postgres: `postgres-integration/migrate.pgtest.ts` (0121+0122 apply cleanly from
  empty), all `postgres-integration/m9*.pgtest.ts` (23/23 pass) and
  `postgres-integration/witLiveReadModelContract.pgtest.ts` (the required proof, passing) —
  run together, 23/23 pass total, against a dedicated `witlivereadmodel` PGTEST_DB on the
  shared `northstar-postgres-test` container (this worktree's own `db:postgres:up` hit a
  container-name conflict with another worktree already using that container; reused it
  directly per the memory note on shared containers across worktrees).
- Full `npm test` / `npm run test:postgres`, `npm run lint`, `npm run build`,
  `npm run gate:anti-hardcoding` — not yet run at this checkpoint; scheduled next before
  push, per "Working rules" (full-suite runs reserved for one final pass).

### Next action (superseded — see "Post-review defect fixes" below)

Run the final gates (full unit suite with pre-existing-failure baseline comparison, full
`test:postgres`, lint, build, anti-hardcoding), scan added lines for persona/flight/airport
literals, commit-if-clean, push, verify with `git ls-remote`, then write the final report.

## Post-review defect fixes (2026-09-17)

An independent review of the pushed checkpoint (`4a04172`) found five defects in the
FIG-3/4/6/7 mechanism. Fixed on the same branch/worktree, not a new lane.

1. **Revision could permanently miss a change.** `stamp` (`pg_current_xact_id()`) is
   assigned at a transaction's first *write*, not at commit — an earlier-starting,
   later-committing transaction could be missed forever by `stamp > sinceRevision`, and
   independent autocommit `pool.query` calls within one logical read could mix snapshots.
   Fix: every PostgreSQL projection read (`loadRecoveryCaseFacts`, `loadOperatorOverviewFacts`,
   `loadIncidentProgrammeFacts`) now runs inside one `REPEATABLE READ READ ONLY` transaction on
   a single checked-out client (`withProjectionSnapshot`, `pgFactAssembler.ts`). Each read
   returns a new `ChangeAwareness.changeCursor` string field (that transaction's own
   `pg_snapshot_xmin`), accepted back as `sinceCursor` (`sinceRevision` retired), compared with
   `>=` — at-least-once, never a silent miss. Internal stamps are carried as `bigint`
   (`readEvaluationLifecycleStamp`, `::text` -> `BigInt`, never through a JS `Number`);
   `projectionRevision` stays a `number`, guarded by `checkedRevisionNumber` (throws rather than
   silently truncating — never fires in practice, xid8 is nowhere near 2^53).
   `?sinceCursor=<xid8>` replaces `?sinceRevision=<n>` in `targetHttpHandlers.ts`.
2. **Case revision ignored most case content.** Only `recovery_cases` row writes bumped the
   case's `EVALUATION_LIFECYCLE` scope (0122). Migration `0123` adds triggers on
   `action_plans`, `action_intents`, `action_dependencies`, `execution_attempts`,
   `execution_observations`, `recovery_strategies` and `case_subjects` that resolve the owning
   case (direct `recovery_case_id` column, or one/two joins through `action_plan_id`/
   `action_intent_id` — table shapes confirmed against `migrations/0100-0110`) and bump the same
   `EVALUATION_LIFECYCLE` scope family, never a new scope kind, never read by
   `assessment_inputs`.
3. **Incident/blast-radius view never converted.** `loadIncidentProgrammeFacts` delegated
   refs/revision/changed-refs to `loadIncidentProgrammeFactsFromCohort` (traveller-count
   revision, "every traveller changed" every read, raw traveller UUIDs as refs, no
   `evaluation`). Fixed: the PostgreSQL path now builds its own nodes/edges/change-metadata
   from `loadRecoveryCaseFactsInner`'s own per-subject facts (canonical `JOURNEY:<id>` refs,
   real `evaluation`, xid8 stamp) on the same shared snapshot; the pure cohort builder still
   backs `affectedSet` and remains unchanged for `primaryScenarioVerticalLoop.ts`'s in-memory
   path.
4. **Overview collapsed multi-subject cases.** `OperatorOverviewItem.evaluation` is now set
   only when the item maps to exactly one subject (never the case's first subject, never an
   invented aggregation).
5. **Nothing could render subjects before escalation.** `loadOperatorOverviewFacts`'s DASHBOARD
   graph nodes now come from the in-scope subject population, not `recovery_cases` rows — one
   node per subject, `caseRef` attached when a case exists. **Population scope key (documented
   decision):** every JOURNEY with an accepted REQUIRED `participations` row on a programme_item
   whose `programmes.lifecycle_status = 'ACTIVE'` (excluding only `journeys.lifecycle_status =
   'CANCELLED'`) — reuses the exact membership predicate `loadIncidentProgrammeFacts` already
   treats as authoritative; the schema has no single per-workspace "current programme" key
   (many events/programmes can exist per workspace), so this is the smallest bounded,
   authoritative population available pre-escalation. **Edges:** none shipped for this
   population graph — a subject's dependency on a transport service is real
   (`journey_items`/`transport_item_details`), but that service has no accepted `LdgNodeKind`
   category and no authoritative semantic state of its own to present as a node; per the fix's
   own fallback, the gap is reported (this note, plus `FRONTEND_SEMANTIC_CONTRACT.md`), not
   fabricated.

**Proof:** `postgres-integration/witLiveReadModelContract.pgtest.ts` was extended in place
(same file, corrected/expanded scenario) to cover all five defects, including an
overlapping-transactions step (two explicit `pool.connect()` clients, real `assessments`-insert
write path via the genuine `fig3_bump_on_assessment` trigger) that fails against pre-fix
`4a04172`.

**Verification for this checkpoint:**
- `npm run typecheck`, `npm run lint`, `npm run gate:anti-hardcoding` — all clean.
- Focused unit (47/47): `test/ui-semantic-contract.test.ts test/m9-product-readmodels.test.ts
  test/m9-product-surfaces.test.ts test/m9-checkpoint2-unit.test.ts
  test/m9-jordan-partial-failure-acceptance.test.ts test/m9-vertical-loop.test.ts`.
- Focused Postgres (23/23, `PGTEST_DB=witlivereadmodel`): `postgres-integration/migrate.pgtest.ts`
  (0123 applies cleanly from empty, re-run is a no-op, checksum drift still fails loudly),
  `postgres-integration/m9*.pgtest.ts` and the rewritten
  `postgres-integration/witLiveReadModelContract.pgtest.ts` together.
- Full `npm test` / `npm run test:postgres` — see the final report for this checkpoint's
  numbers (run once, at the very end, per the lane's own working rules).

### Next action

Push once the full-suite gates land clean; write the final report per the fixer brief's
five-point structure.

## Independent review of post-review fixes (Opus, 2026-09-17)

- Reviewed: the working tree committed as `f775abc` (identical per-file line counts, clean tree).
- Verdict: PASS WITH FOLLOW-UPS. Defects 1-5 are genuinely fixed; nothing found makes the
  read model report something false.
- Verified in code: single `REPEATABLE READ READ ONLY` snapshot per read; `pg_snapshot_xmin`
  cursor compared with `>=` (at-least-once); 0123 triggers on all seven case-content tables,
  bumping only `EVALUATION_LIFECYCLE`; incident view on `JOURNEY:<id>` refs with real
  `evaluation`; item `evaluation` only for single-subject items; DASHBOARD population nodes
  from accepted REQUIRED participation in ACTIVE programmes, `caseRef` when escalated.
- Evidence (isolated DB `witreviewopus`): typecheck OK; focused unit 50/50
  (`ui-semantic-contract`, `m9-product-readmodels`, `m9-product-surfaces`,
  `m9-checkpoint2-unit`, `m9-jordan-partial-failure-acceptance`, `m9-vertical-loop`,
  `m9-target-http`); focused Postgres 8/8 (`witLiveReadModelContract`, `migrate`,
  `m9ReadModelCurrentness`). Not run by the reviewer: lint, build, anti-hardcoding, full suites.

Act Now (before live wiring):

- R1. Proof test asserts exact changed sets ("exactly the dependent subjects", "exactly one
  subject should have settled"). The cursor is a cluster-wide snapshot xmin, so concurrent
  activity can legitimately add refs. Observed ~5 failures in ~15 executions, clustered, then
  8 consecutive passes. Likely cause of the fixer's test loop. Assert superset; prove
  "unchanged" through `evaluation`/`semanticState`.
- R2. Escalation is not reported as a change: a DASHBOARD node's stamp is only its subject's
  `VIABILITY` stamp, but escalation writes `case_subjects`, which bumps the case scope. The
  node gains `caseRef` without appearing in `changedVisibleRefs`. Use max(subject stamp,
  linked case stamp) and assert it in the escalation step (currently read without a cursor).
  Found by code reading; a probe was blocked by R1.
- R3. Every population node is labelled the literal `JOURNEY`. Use the traveller display-name
  join the overview items already use.

Investigate Now: how noisy changed sets are on the demo database cluster; `m2Travel` EXPLAIN
failure (pre-existing per this ledger, not verified by the reviewer).

Park for Later: `LIMIT 200` silent population truncation; graph-level
`currentSemanticState` still FAILED-or-HEALTHY; subject -> transport-service edges.

Renderer rule for the next milestone: apply every snapshot; changed sets are at-least-once
hints; animate a node only when its presented fields differ between two backend snapshots.

### Act Now closure R1/R2/R3 (on `3a45558`)

Scope: only R1/R2/R3. The Investigate Now / Park for Later items above stay open, and the
test-suite convergence lane is handled elsewhere.

- **R1 — exact changed-set assertions removed.** `witLiveReadModelContract.pgtest.ts` no
  longer asserts changed-set equality or cardinality on any cursor read. Expected refs are
  still proven present (`includes`); "unchanged" is now proven through each subject's own
  presented `evaluation`/`semanticState`; the reported set is additionally proven to contain
  only refs the projection actually presents. The two remaining `deepEqual(..., [])`
  assertions are on the *no-cursor* branch, which never compares stamps and so is
  deterministic. The late-commit / overlapping-transaction proof is retained unchanged.
- **R2 — escalation now reported as a change.** A DASHBOARD population node's effective
  stamp is `max(subject VIABILITY stamp, linked case CASE stamp)` in `pgFactAssembler.ts`.
  Opening/attaching a case bumps `RECOVERY_CASE:<id>:CASE` (0122/0123), not the subject's
  scope, so previously the next snapshot carried the new `caseRef` while the subject was
  absent from `changedVisibleRefs`. No business semantics changed: tone/evaluation still
  come only from the subject's own CURRENT assessment.
- **R3 — authoritative traveller labels.** The population query now carries
  `traveller_names.display_value` through the same `travellers`/`display_name_ref` join the
  overview queue already uses (both columns `NOT NULL`, 0012's subtype trigger guarantees
  exactly one name row per traveller, so it stays an inner join with no fabricated
  fallback and no second lookup path). The literal `JOURNEY` placeholder is gone.

Wording corrected (not reopened): `ChangeAwarenessSchema.changedVisibleRefs`/`changeCursor`
and the FIG-3 bullet in `FRONTEND_SEMANTIC_CONTRACT.md` had implied the changed set proves
what changed. Both now state the reviewed rule — apply every complete snapshot; the changed
set is an at-least-once hint for emphasis, and absence is not proof of unchanged.

Evidence (isolated database `witcloseout` on the shared test cluster):

- Failing-before, passing-after, proven separately per fix: R3's label assertion failed on
  `3a45558` (`actual: 'JOURNEY'`); with only the label fix applied, R2's escalation
  assertion then failed (`changedVisibleRefs` did not include the escalated subject); with
  the stamp fix applied, the test passes.
- R1 flake reproduced deterministically rather than by repetition: a concurrent *writing*
  transaction left open pins the cluster snapshot xmin (observed 114275), which is what
  lets unrelated refs satisfy `stamp >= sinceCursor`. Under that pinned xmin the pre-fix
  assertions fail exactly as the reviewer described (a third, untouched journey appears in
  "changed refs name exactly the dependent subjects"); the corrected test passes under the
  same pinned xmin. A read-only holder does not reproduce it — it is never assigned a real
  xid and so never holds the horizon back.
- `witLiveReadModelContract.pgtest.ts`: 8 consecutive passes (plus 8 earlier consecutive
  passes during the tally fix, and the two pinned-xmin runs).
- Focused units 36/36: `ui-semantic-contract`, `m9-product-readmodels`,
  `m9-product-surfaces`, `m9-target-http`. `npm run typecheck` clean. `eslint` clean on the
  three changed source/test files.
- Not run, deliberately: full unit suite, full Postgres suite, legacy suites, build,
  anti-hardcoding. No broad or unrelated failure was investigated.

## Independent review checkpoint (Opus, 2026-09-17)

- Reviewed: `lane/wit-frontend-semantic-contract` @ `20b9b61c34f3f2d526dbe4e143aba6c8304adc9b`
  (clean; accepted M9 `c45a928` is an ancestor; 5 commits on top). Not reviewed against M10.
- Fix branch: `review/wit-frontend-semantic-contract-opus` from the exact reviewed SHA.
- Evaluated against the frozen live-demo choreography (baseline -> disruption ->
  scope identified -> under evaluation -> clear / settle failed -> escalate -> open case).

Act Now, in this lane (fixed on the review branch):

- R1. Edge `truthMode` was inferred from `semanticState === PROPOSED` or kind
  `PROPOSED_CHANGE`, and edge `changeState` from `semanticState === CHANGED`. This
  promotes a semantic state into the truth/change dimensions, contradicting the node
  rule ("preserve both dimensions without promotion"). M9 edges carry no authority and
  no change set, so both are now always `unspecified` / `not-supplied`.
- R2. M9 operator surfaces bypassed the boundary for viability labels (`copy.ts`:
  UNKNOWN = "Still checking", AT_RISK = "May be affected"). Those phrases assert an
  evaluation lifecycle the read model never supplies. Operator surfaces now take the label
  from `presentViability`.
- R3. Tone re-collapse downstream of the boundary: overview queue glyph rendered
  RECOVERING as a green check; incident-programme commitment dot rendered UNKNOWN and
  ACTIVE as brass. Both now use exhaustive tone-keyed tables.
- R4. Contract doc: FIG re-triage against the live demo, new gaps FIG-7..FIG-9.

Act Now, blocking live wiring but outside this lane (backend read-model owners):
FIG-1 edge id, FIG-2 edge authority + changed edge ids, FIG-3 monotonic revision,
FIG-4 subject-keyed node refs, FIG-6 producer fidelity, FIG-7 assessment lifecycle.
See `docs/FRONTEND_SEMANTIC_CONTRACT.md` for the smallest additive change per gap.

Review verdict: PASS WITH TARGETED FIXES. The frontend boundary is a safe base to continue
from. Live `LiveDependencyGraph` wiring stays blocked on the backend prerequisites above.

Review verification (fix commit `bf66455`):

- Focused `ui-semantic-contract` + `m9-product-surfaces`: 25/25. The 6 new/changed
  defect tests fail against `20b9b61` (checked in a throwaway detached worktree).
- Relevant M9/read-model/UI files (15 files): 122/122.
- `typecheck`, `lint`, `build` exit 0; `gate:anti-hardcoding` CLEAN; a word-bounded scan
  of added lines finds no persona, flight, airport or timer literals.
- Rendered HTML for every legal status/viability/state/verdict combination differs
  from `20b9b61` only in operator viability wording, the RECOVERING queue glyph and
  the ACTIVE/UNKNOWN commitment dots.
- Full suite at `20b9b61`: 1134 tests, 1131 pass, 3 fail. At review head: 1140 tests,
  1137 pass, the identical 3 failures (R1 determinism, Jordan S2 browser approval,
  AiT seed promotion). No regression.

## Goal

Implement the accepted-M9 presentation contract, one adapter boundary, shared
visual grammar and a fixture-only Contract Lab. Stop before live graph wiring.
This lane supersedes the old M6 ledger here; that ledger remains in base history.

## Identity and preflight

- Milestone: WiT frontend semantic contract (independent of M10).
- Branch: `lane/wit-frontend-semantic-contract`.
- Worktree: `C:/Dev/qoder-atlas/.worktrees/wit-frontend-semantic-contract`.
- Exact base: `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` (accepted M9).
- Frozen `2728acd` -> `ffa77ace2014f597e465179b988a28e0a3d55e14`.
- Frozen `49e7b4d` -> `9efd57de4d7dc9deba99928be7eaf1e7beef30b1`.
- Frozen `e1eb5f4` -> `6ea0ea875a4cb90b1f798bbd670fa608b91c6c29`.
- `git diff --name-only c45a928 HEAD` = `docs/work/WIT_DEMO_VISUAL_AND_PRODUCT_CONTRACT.md`
  only, so the three cherry-picks touched no source file.
- No separate programme-seed merge; no moving M10 dependency.

## Acceptance checklist

- [x] Exact accepted M9 base, frozen commits, visual contract and clean preflight.
- [x] Inventory actual M9 enums, categories, relationships and metadata.
- [x] Record node identity, edge identity and bounded integration gaps (FIG-1..FIG-6).
- [x] Canonical small presentation model with independent dimensions (`model.ts`, 59 lines).
- [x] One pure adapter boundary; exhaustive mappings; loud invalid input (`adapter.ts`, 124 lines).
- [x] Central visual grammar following DESIGN and frozen WiT contract (`grammar.ts`, 71 lines).
- [x] Fixture-only Contract Lab: states, changes, truth, focus, edges, compositions.
- [x] Components consume presentation objects, not raw domain objects (`components.ts`).
- [x] Adapter/unit/render tests pass — `test/ui-semantic-contract.test.ts` 14/14.
- [x] Typecheck, build, lint, anti-hardcoding and regression checkpoint recorded below.
- [x] Browser desktop/mobile, controls, edge cases and console verified.
- [x] Anti-hardcoding / no business reasoning / unchanged ontology checked.
- [x] Contract doc, roadmap and evidence updated; no tracker/DECISIONS entry applies.
- [x] Exact-path commit and push verified; stop before next milestone — milestone
  commit `0f6f5500bc5c81c1910655a070d3cb3d4a8026ca`, 13 paths staged explicitly,
  `git ls-remote origin` == local `HEAD`, 0 ahead / 0 behind.

## Current checkpoint

Implementation and verification are complete. `operatorOverviewAdapter.ts` is the
only pre-existing source file touched: it now delegates to the single boundary
instead of keeping its own silent-default palette (+8/-46). The change is
behaviour-preserving for every legal enum value; the only semantic difference is
that an unmapped value now throws instead of returning `neutral`.

## Next action

None — this lane is closed. Milestone commit `0f6f5500` is pushed to
`origin/lane/wit-frontend-semantic-contract` and the working tree is clean. The
hand-off is independent review. Live `LiveDependencyGraph` wiring stays blocked
on FIG-1/FIG-2/FIG-6 and is explicitly out of scope here; do not start M10 or
any live-state integration from this branch.

## Critical constraints

- Backend remains semantic authority; no viability/time/policy/authority reasoning.
- Do not promote proposal health to authoritative truth.
- Preserve UNKNOWN and absent relation state distinctly.
- Never synthesize stable edge identity or infer changed edges from endpoints.
- No domain/schema/read-model behavior changes without stopping for approval.
- Use current theme and inline SVG vocabulary; no new framework or dependencies.
- No live provider calls, database, SQLite additions, M10 or runtime LDG wiring.
- No animation, revision transitions, layout engine or full demo flows.
- Fixture facts stay in dev/test data; generic components remain scenario-free.

## Verification actually run

- `npm run typecheck` exit 0; `npm run build` exit 0; `npm run lint` exit 0.
- `npm run gate:anti-hardcoding` -> `VERDICT: CLEAN`; 352 TS files
  (strict=211 app=122 provider=16 demo=3 excluded=0). `src/ui/` classifies as
  tier `app`, so the Lab and semantics modules were scanned; `fixtures/` is
  outside `src/` and therefore the permitted home for demo facts.
- `node --test test/ui-semantic-contract.test.ts` -> 14 pass / 0 fail, exit 0.
- Full suite `npm run test` -> exit 1: 1110 pass, **3 fail**.
- Browser: `/contract-lab` DOM snapshot covers all seven sections; fixture
  selector exercised 5 -> 1 -> 5; console clean; no overflow at 530x617;
  computed-style audits confirm all four dimensions encode independently and
  16/16 connectors render. No pixel screenshot: the in-app browser surface
  stayed `visibilityState=hidden`, so the visual claim rests on computed styles
  and structure, not on a rendered image.

## The three full-suite failures are pre-existing at base

Proven, not assumed. `operatorOverviewAdapter.ts` was temporarily replaced with
its exact base content (`git show c45a928:<path>`, verified
`git diff --quiet c45a928 -- <path>` -> `[adapter == base: YES]`) and the three
files re-run: same exit 1, same 3 fail / 8 pass, same three assertion messages.
My version was then restored and re-verified (+8/-46, typecheck 0, 14/14).

- `test/e2e/hero-lifecycle-rehearsal.test.ts:213` — no `RECOVERY_ENVELOPE_APPLIED`
  activity event for the Jordan S2 hotel intent. Server-side authority record;
  the file imports only `compose.ts`, `server/http.ts`, `config.ts`, `demoWorld.ts`.
- `test/integration.r1.test.ts:234` — determinism diff is confined to two
  wall-clock `observedAt` stamps ~2.2s apart; everything else byte-identical
  including `version: 6`. Time-dependent, not state-dependent.
- `test/wave3r-m1-ait-canonical-seed.test.ts:46` — harvested PNR `MNSYN03` not on
  a promoted leg. Seed/promotion data concern.

Triage: all three are **Park for Later** for this lane (out of scope, pre-existing,
no presentation coupling) and must be raised against M9/seed owners separately.
One **Investigate Now** design finding is recorded in
`docs/FRONTEND_SEMANTIC_CONTRACT.md`: `HEALTHY` and `RECOVERED` share tone `ok`
and glyph `check`, differing only by label — weak for the state the product
thesis turns on. Fixing it means extending the frozen `SemanticIndicator['glyph']`
set, which is DESIGN.md authority, so it is not a FIG entry and was not changed.

## Documentation scope note

`docs/ROADMAP.md` gained a lane row. `docs/IMPLEMENTATION_PLAN.md` has no
frontend/WiT tracker and this is not an M0-M11 package, so no tracker row was
invented. `docs/DECISIONS.md` does not exist in this tree and no architecture
invariant changed, so no decision entry was created.
