# ACTIVE TASK — Slice A: Earliest Testable NORTHSTAR

Working-memory ledger for the current delivery slice. Keep it short, reread before major phases, and close items only with evidence.

## Goal

Get the founder onto a real, repeatable NORTHSTAR product path as fast as safely possible:

`known Sarah baseline -> normal product UI -> provider-shaped disruption -> authoritative PostgreSQL mutation/evaluation -> five incident-linked outcomes -> four cleared / Sarah failed -> one Sarah RecoveryCase -> click/reload Sarah`

Stop and founder-test at that point before building Slice B.

## Current authoritative state

- Repository: `dropandresetmain-prog/qoder-atlas`
- Branch: `main`
- Post-C5 convergence complete.
- C5 accepted backend/refactor SHA: `87783c0bcbdc12cf263851a36e06b9d5255289ce`
- Accepted frontend handoff: `6a655ddc0d57d64595e7c8ab207ae8c6ebbb37ab`
- Accepted live read-model lane: `cbe5f837c3c4c45bec576f5ea1022b8a26871520`
- PostgreSQL + PostGIS is the sole normal runtime.
- SQLite is offline read-only migration input / historical only.
- Test topology converged: CURRENT_TARGET / MIGRATION_BOUNDARY / HISTORICAL_LEGACY.
- M11 readiness audit: **A — no meaningful legacy state identified**; bounded external legacy-file inventory is required only before final M11 activation.

## Delivery sequence

1. **Slice A** — current task.
2. **Founder Test A** — T1-T4 below.
3. **Slice B** — preview/approval/execution/recovery.
4. **Founder Test B** — T5-T6.
5. Submission rehearsal / repeatability / replay / failure recovery.
6. M11 operational activation / retirement.
7. UI polish/stretch.

Do not skip founder testing between slices.

## Slice A acceptance

From a clean supported baseline, without SQL intervention, manual case creation, legacy SQLite runtime or manual browser reload:

1. Founder restores/loads the real Sarah demo baseline.
2. Founder opens the real product surface.
3. Founder triggers the disclosed simulated/provider-shaped airline update through normal HTTP.
4. Canonical PostgreSQL state changes through accepted commands.
5. Evaluation/reassessment runs or is observed through normal application orchestration.
6. Exactly five incident-linked affected people are accounted for.
7. Four are viable/cleared and Sarah is disrupted.
8. Sarah's failure is backed by the real quantitative requirement (e.g. available vs required readiness), not frontend inference.
9. Exactly one Sarah RecoveryCase is opened/attached idempotently by backend/application orchestration.
10. Founder clicks Sarah and the focused case loads from authoritative state.
11. Reloading the page preserves the same case/outcome.
12. Repeating the same event does not create duplicate cases.

## Founder checkpoints

### T1 — Real baseline

Founder action:

`Restore demo baseline -> Open product/Event Overview surface`

Must prove:

- correct event/workspace;
- exact relevant programme/service/people membership;
- no pre-created Sarah disruption case;
- current assessments/unknowns are honest;
- reset/reseed is repeatable and does not accumulate duplicate state.

Known issue: current `/api/v2/demo/reset` historically seeded a generic two-traveller programme. Slice A must establish the real Sarah world through supported paths rather than assuming the endpoint name means the job is done.

### T2 — Trigger reaches canonical state

Founder action:

`Simulate airline update`

Must prove:

- command goes through normal HTTP/provider-event boundary;
- event identity/idempotency is real;
- UI acknowledgement matches the actual state change;
- page updates automatically via authoritative refetch/polling;
- no frontend timer manufactures business state.

If the UI says `ID7159 cancelled -> moved to ID7153`, the backend input/state must actually establish cancellation + replacement/current service semantics rather than merely changing an arrival timestamp.

### T3 — Correct cohort and escalation

Must prove:

- exactly five people were in the disruption's affected/evaluation scope;
- each displayed outcome incorporates the changed input;
- baseline PASS is not reused as checked-by-this-incident evidence;
- four are current PASS/viable;
- Sarah is current FAIL/disrupted with authoritative causal/quantitative reason;
- pending/UNKNOWN is never counted as cleared;
- exactly one Sarah case exists/attaches idempotently.

### T4 — Open and reload Sarah

Founder action:

`Click Sarah -> inspect case -> reload`

Must prove:

- navigation uses backend `caseRef`/stable identity;
- real traveller/service/commitment/current assessment state loads;
- causal focus/reason comes from backend/read model, not graph traversal guesswork;
- no dependency on cached prototype data;
- stay/hotel branch is shown only if target truth supports its state.

**T4 completes Slice A. Stop and founder-test before Slice B.**

## Required implementation work

### A1 — Reproducible Sarah baseline

Establish a supported PostgreSQL baseline containing the exact approved Sarah demo world.

Requirements:

- data/config/fixtures may contain Sarah/demo facts;
- domain/recovery code may not branch on Sarah/event IDs/routes;
- reset/reseed must return or expose actual event/person/service refs;
- establish baseline current assessments;
- no incident-created cases before the trigger;
- five displayed passengers/participants must be backed by actual membership/dependency truth.

### A2 — Truthful provider-shaped disruption

Use the existing external-input boundary where possible.

Requirements:

- provider/source evidence retained;
- idempotent event identity;
- exact affected/current service facts are represented;
- explicit target identity is acceptable for this disclosed simulation;
- do not invent generalized provider-reference auto-correlation merely for the demo.

### A3 — Application orchestration

Engine E2E tests currently prove components that test code helps assemble. Slice A must make the normal product lifecycle do the work.

At minimum:

- ingest event;
- schedule/run or observe reassessment;
- discover affected scope;
- persist current assessments;
- idempotently create/attach Sarah's RecoveryCase from the failed assessment;
- expose stable case identity to the UI.

Browser/frontend must not decide who deserves a case.

### A4 — Minimum event operational projection

The initial event/product surface must not depend on a RecoveryCase already existing.

Minimum truthful projection:

- event identity/timezone;
- relevant programme items;
- relevant transport/service groups;
- people/participation/service membership;
- current assessment state;
- incident/change identity;
- incident-linked affected membership;
- per-person current outcome;
- Sarah quantitative failure reason;
- `caseRef` when escalation exists.

Do not build a generic whole-event graph API.

### A5 — Frontend integration

Use the accepted semantic boundary:

`authoritative read model -> semantic adapter -> normalized presentation -> shared grammar -> UI`

Requirements:

- automatic sequential full-snapshot polling/refetch is acceptable;
- complete snapshot is authoritative;
- `changedVisibleRefs` is only an at-least-once emphasis hint;
- render PASS/FAIL/UNKNOWN/pending honestly;
- surface command/loading/stale-data failures;
- navigate to Sarah via backend identity;
- no business reasoning in components.

The final Event Overview layout remains unresolved. Use the thinnest presentable surface that allows founder testing; do not block the integrated spine on a perfect overview design.

## Investigate during Slice A

| Item | Triage | Required decision |
|---|---|---|
| Exact five-person incident provenance | **Investigate Now** | Prove all five are actually affected/evaluated because of the disruption. |
| Rebooking semantics | **Investigate Now** | Confirm actual commands/state behind any cancellation/rebooking UI claim. |
| Sarah stay consequence | **Investigate Now** | Query real target state/evaluator; expose truth, do not force green. |
| Felix programme linkage | **Investigate Now** | Use canonical PostgreSQL programme/requirement relationship, not old fixture assumptions. |
| Live read-model `LIMIT 200` / noisy changed sets / graph state simplification | **Park unless Slice A hits it** | Do not widen scope unless the actual slice fails because of it. |

## Prepare early for Slice B, but do not implement before Founder Test A

Investigate the no-Journey participant seam (Daniel/Elena equivalents):

- Participation may exist without Journey.
- Preview/strategy evaluation must not omit these people.
- Empty participant subsets must not create false `.every(...)` success.
- If omission is confirmed, classify **Act Now in Slice B**.

Do not create fake Journeys for local participants.

## Test discipline

During implementation:

1. smallest focused relevant test;
2. focused PostgreSQL seam test;
3. typecheck/build/lint only when the changed seam makes them useful.

Do **not** repeatedly run the broad suite as the debugging loop.

At the coherent Slice A checkpoint:

- relevant Slice A integration/E2E tests;
- Sarah/Jordan regressions where the changed seam could affect them;
- current target gate appropriate to the slice;
- fresh PostgreSQL broader gate once if this is the candidate for Founder Test A;
- anti-hardcoding.

Never run `npm run test:legacy` for Slice A acceptance.

## Hard constraints

- No SQLite runtime/fallback.
- No scenario-specific branches in domain/recovery/application logic.
- No frontend timers manufacturing recovery progress.
- No UI-derived viability/blast radius/causality/policy/authority.
- No `LLM -> irreversible/money-moving API`.
- No M11 activation before the product slices are proven unless the owner explicitly narrows activation scope.
- No whole-event LDG/semantic zoom/multi-focus stretch work before Slice A/B.
- Do not reopen F01-F18 absent a real architecture contradiction.

## Current parked scope

- progressive evaluation telemetry;
- rich rejected-option history;
- polished provider/tool activity;
- Before/After history;
- full whole-event LDG;
- deep Participants/Decisions/Activity functionality;
- traveller phone view;
- physical legacy-test directory reorganisation;
- retired SQLite dead-code deletion before M11/submission.

## Completion report for Slice A implementation

Return:

1. branch/worktree/base/head;
2. exact baseline/reset behaviour;
3. exact provider-shaped input used;
4. application orchestration added/changed;
5. event/read-model contract added/changed;
6. frontend integration added/changed;
7. T1/T2/T3/T4 evidence;
8. focused tests run;
9. broader checkpoint tests run, if any;
10. anti-hardcoding result;
11. all findings triaged;
12. exact instructions for the founder to perform Founder Test A manually.

## Next action

Implement the smallest integrated Slice A path from current `main` and get to T1/T2 as early as possible. Do not spend a multi-day backend stretch before the first founder-visible interaction.
