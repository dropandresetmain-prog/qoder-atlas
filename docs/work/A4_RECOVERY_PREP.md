# A4 recovery preparation — preserved WIP handoff

> **SUPERSEDED FOR IMPLEMENTATION.** This file preserves the recovered WIP archaeology that was used to restart A4. Its integration instructions are no longer current. Continuation safety passed on `f7a497d`; protected hotel execution passed on `0c177c8`; the controlled four-action seam passed on `5bdb652`; planner/provider/progression closure is on `c897d296`. Do not re-port or re-merge the preserved WIP branches unless a concrete regression requires archaeology. Current execution truth is `ACTIVE_TASK.md` and `A3_A5_FINISHING_IMPLEMENTATION_PLAN.md`.

Docs-only. Not acceptance. Do not integrate either WIP lane yet.

## Authoritative state

| Role | Branch | SHA | Worktree |
| --- | --- | --- | --- |
| Primary (WIP inspected against) | `integration/astra-post-r4` | `d6028791683f13ec73f3e45e4808ce66f5dc8e72` | `.worktrees/astra-post-r4` |
| Hotel WIP | `codex/a4-hotel-execution` | `2e6cdae2ef632f62b4cfc72bdfdf6c0c920dc36b` | `.worktrees/terra-a4-hotel-execution` |
| Continuation WIP | `codex/a4-selected-continuation` | `b911989406d070f4a48c9783614f8256f16eb83f` | `.worktrees/a4-selected-continuation` |
| Prior continuation candidate | same branch | `fb4ff1023f44b038da3c00484b4465c5a9c85ff6` | (ancestor of `b911989`) |

This docs commit advances primary HEAD after `d602879`; WIP SHAs above remain the preserved candidates.

Shared merge-base with primary: `af5ae95b592fcb267c6376c47e72d4aca1d3a178`.

**Critical ancestry fact:** hotel tip and continuation tip are **sibling forks**, not a linear stack. Hotel’s parent `089db15` has the same subject as `fb4ff10` but is a **different commit**. Prefer the continuation branch as the sole continuation authority; treat hotel’s pre-`2e6cdae` continuation commits as stale duplicates.

Contracts: [ASTRA_A4_SELECTED_PLAN_CONTINUATION.md](ASTRA_A4_SELECTED_PLAN_CONTINUATION.md), [ASTRA_HERO_DEPTH_SCOPE.md](ASTRA_HERO_DEPTH_SCOPE.md).

---

## 1. Hotel execution lane (`2e6cdae`)

### Purpose

Protected Nuitée stay book/cancel execution inputs + executor skeleton + atomic cancellation command, so selected overnight / destination book / old-stay cancel can later run behind durable attempts and canonical observation.

### Hotel-unique delta (`089db15..2e6cdae` — use this, not whole branch vs primary)

| File | Intent |
| --- | --- |
| `migrations/0134_stay_execution_inputs.sql` | Immutable `stay_execution_bindings` for BOOK/CANCEL terms |
| `execution/stayExecutionInputs.ts` | Persist bindings from viable strategies + quoted stays; resolve inputs for an intent |
| `commands/observedStayCancellationCommands.ts` | Atomic CANCELLED line + DROPPED item; optional selected-plan canonical application link |
| `commands/observedStayCommands.ts` | Optional `canonicalApplication` on attach (same-tx bridge) |
| `app/target/externalStayExecution.ts` | Nuitée dispatcher, reconcile lookup, execution/reconcile passes, canonical apply |
| `recoveryPlanningCoordinator.ts` | After viable planning, `persistStayExecutionBindings(...)` |
| `a4ObservedStay.pgtest.ts` | +2 cancellation PG cases |
| `r4-offer-execution-boundary.test.ts` | Stay boundary / quote-change / ambiguous-lookup unit tests |
| `a4SelectedPlanContinuation.pgtest.ts` | 1-line viability assert path fix only |

Whole-branch vs primary also shows continuation files (`0133`, `selectedPlanContinuation.ts`, compiler, gate, suites). Those are from the **stale hotel fork** — do not prefer them over `b911989`.

### Complete vs partial vs skeleton

| Piece | State |
| --- | --- |
| Migration `0134` + immutable trigger + BOOK/CANCEL CHECKs | **Complete enough** as schema draft |
| `persistStayExecutionBindings` / `resolveStayExecutionInputs` | **Partial** — works for quoted viable stays; hardcodes `provider_id='nuitee'`; connection pick is “exactly one nuitee connection or null” |
| `applyObservedStayCancellation` | **Mostly complete** command; PG cancel+refuse proofs authored |
| `attachObservedStay` + `canonicalApplication` | **Partial** — optional bridge wired; needs continuation’s `recordSelectedPlanCanonicalApplication` semantics from **continuation tip**, not hotel fork |
| `externalStayExecution.ts` | **Skeleton/near-complete module, uncomposed** — durable prepare→dispatch, quote refresh refuse, ceiling check, client-ref checkpoint, reconcile-without-redispatch, canonical retry path present in code |
| Boot / worker / runtime composition | **Missing** — no `composeTargetApplication` / pass wiring found |
| `candidates()` dependency check | **Unsafe relative to A4 contract** — treats `OBSERVED_SUCCESS|COMPLETED|RECONCILED` as enough; does **not** require `selected_plan_canonical_applications` for `external:*` |

### Known TODOs / missing behaviour

- Normal-boot composition of stay execution cycle (mirror `externalOfferExecution` pattern).
- Align dependency readiness with continuation’s external→canonical-application rule (m8 + executor `candidates()`).
- Focused PG for bindings persist/resolve, book→attach with `canonicalApplication`, cancel via executor (not only direct command).
- Rebase hotel-unique commit onto primary **after** continuation integration; drop hotel’s divergent `089db15` continuation stack.
- `recovery_case_id` on bindings has no FK (nullable uuid) — verify intentional before integrate.
- No LIVE/RECORD provider calls in lane proofs (correct); physical A4 later.

### Test evidence

| Check | Result |
| --- | --- |
| `node --test test/r4-offer-execution-boundary.test.ts` @ `2e6cdae` | **7/7 pass** (recovery session) |
| Cancellation PG cases in `a4ObservedStay.pgtest.ts` | **Authored, not re-run** in recovery prep |
| Bindings / executor / composition PG | **Missing** |

### Integration conflicts vs primary `d602879`

- Primary already has observed-stay attach (`f4230af`/`40e80d7`/`a662e1d`) through `0132`; hotel adds cancellation + canonicalApplication + `0134`.
- Primary has **no** `0133` / `selectedPlanContinuation` — hotel branch carries a divergent copy; conflict if whole hotel branch merged.
- Overlap with continuation tip on shared files (see §3).
- Coordinator already denser on primary (A3 LIVE path); hotel’s small binding hook must be rebased carefully.

### Dependencies on integrated A3/A4 contracts

- Observed-stay attach + approved visit (already on primary).
- Hotel companion planning / quoted stays / replacement linkage (A3 integrated).
- Selected-plan continuation + canonical applications (**not** on primary; required before external stay deps are safe).
- Stored execution gate / M8 prepare (exist; continuation changes satisfaction SQL).

### Acceptance before hotel may integrate

1. Continuation safety closed and on primary (or explicit temporary exception — none now).
2. Hotel-unique changes rebased onto that primary; stale continuation fork discarded.
3. Focused unit stay-boundary still green.
4. Focused PG: cancel command; bindings; at least one book/cancel path recording canonical application; dependency readiness refuses observed-success-without-canonical for external stays.
5. Executor not callable outside gated module (existing boundary test).
6. No boot-time LIVE mutation without authority; unknown outcome = lookup only.
7. Root review of composition seam only — no four-action physical run claimed by the lane alone.

---

## 2. Selected-plan continuation lane (`b911989`)

### Purpose

Bounded continuation of an already-authorized composite ActionPlan: checkpoint after canonical prerequisite application, fresh RC-6 on exact residual effects, gate next intent without a second planner.

### What `fb4ff102` already contained (candidate baseline)

Migration `0133`, `selectedPlanContinuation.ts`, compiler effect/fingerprint + stay replacement order, stored-gate continuation checks, approval/contracts/scenario wiring, 6 PG checkpoint tests (create/consume, expiry refresh, unrelated Journey refuse, UNKNOWN refuse, wrong-plan refuse, entry-terms invalidate). Ledger: “6PG pass” at `fb4ff10` — **not re-verified** here.

### What `b911989` changed (`fb4ff10..b911989`)

| Change | Effect |
| --- | --- |
| `m8AuthorityCommands.createPreparedExecutionAttempt` dependency SQL | External prereqs no longer satisfied by raw `OBSERVED_SUCCESS` / checkpoint JSON alone; require `selected_plan_canonical_applications` (+ live `command_receipts`). Internal (`capability_ref NOT LIKE 'external:%'`) keep prior observation/completion path |
| `recordSelectedPlanCanonicalApplication` | Source-kind mismatch guard: `external:*` requires `EXTERNAL_PROVIDER` observation; non-external must not claim provider observation |
| PG test helper `persistExternalDependencyPlan` | Builds external-capability two-intent plan for future proof |
| Setup return fields | Exposes `issuerPrincipalId` / `travellerId` for that helper |

### What `b911989` actually closes vs still open

| Finding (from ACTIVE_TASK / review) | Status at `b911989` |
| --- | --- |
| Observed-success dependency bypass for external actions | **Code attempted** in m8 SQL |
| Source-kind / observation bridge consistency | **Code attempted** in canonical-application recorder |
| Focused PG proving external dep refuses without canonical application / allows after | **Open** — helper added, **zero tests call it** |
| Authoritative fresh capture (trusted world/manifest) | **Open — root-owned**; module still takes caller-supplied `currentWorld` / `freshManifest` |
| Checkpoint JSON / receipt provenance / unstable hashes / unowned receipt links | **Not closed** by `b911989`; treat prior review as still binding |
| Atomic application integrated with hotel attach/cancel | **Open** — hotel WIP wires optional hook; not integrated |

### Dependency-satisfaction logic (current tip)

Prepare next attempt only if each prerequisite attempt is `OBSERVED_SUCCESS|COMPLETED|RECONCILED` **and**:

- intent is **not** `external:*`, **or**
- a `selected_plan_canonical_applications` row for that attempt joins a real `command_receipts` row.

### Safety properties still unproven

- External observed-success **cannot** unlock the next intent without canonical application (needs new PG test).
- Caller cannot lie about fresh capture / residual / viability (root capture owner + stronger proofs).
- Hotel executor `candidates()` cannot bypass the same rule (hotel still can).
- Full four-action sandbox path under continuation gates.

### Exact focused PG required before continuation integrates

1. Existing 6 checkpoint tests green on a rebase onto current primary.
2. **New:** external prereq with `OBSERVED_SUCCESS` but **no** canonical application → prepare/gate **refused**.
3. **New:** same after `recordSelectedPlanCanonicalApplication` with matching provider observation → next intent allowed (or checkpoint consumable).
4. **New:** source-kind mismatch refused (`CANONICAL_APPLICATION_SOURCE_KIND_MISMATCH`).
5. Root-owned capture proof or explicit fail-closed documentation if capture remains injected — do not integrate consequential use until decided.

---

## 3. Later integration order (do not perform now)

Verified from ancestry and overlaps:

1. **A3 formal desktop acceptance** on primary (attempt `3cdb224a…` visible proof) — product gate before consequential A4.
2. **Rebase/cherry-pick `codex/a4-selected-continuation` @ `b911989`** onto primary first (or replay its commits). Prefer this branch over hotel’s `089db15` fork.
3. **Close continuation safety** (external-dep PG + capture ownership) on that rebased line; push; root review.
4. **Port hotel-unique `2e6cdae` delta only** onto primary+continuation; discard hotel’s divergent continuation stack.
5. **Hotel safety/PG/composition closure** (align `candidates()` with m8; focused PG; boot wire without physical booking).
6. **Root integration review** of seams only.
7. **Four-action A4 physical sandbox execution** (Atlas flight, Narita book, SG replacement book, SG cancel) with observation/reassessment — never count baseline `c4NsnfT_N` as an A4 action.

### Overlapping / conflict hotspots

| Path | Hotel tip | Cont tip | Note |
| --- | --- | --- | --- |
| `selectedPlanContinuation.ts` | older fork | **`b911989` wins** | source-kind guard only on cont |
| `m8AuthorityCommands.ts` | older fork | **`b911989` wins** | external canonical-application SQL |
| `a4SelectedPlanContinuation.pgtest.ts` | tiny assert fix + no external tests | helper + 6 tests | merge carefully; add external tests on cont line |
| `0133_selected_plan_continuation.sql` | present on both forks | prefer cont | same migration number |
| `storedExecutionGate.ts` / `compiler.ts` / `suites.json` | divergent ancestry | prefer cont then re-apply hotel suites lines | |
| `observedStayCommands.ts` | hotel adds `canonicalApplication` | absent | apply after cont module exists |
| `recoveryPlanningCoordinator.ts` | hotel binding hook | cont may touch approval path separately | rebase hook onto primary coordinator |

### Frozen before integration

- [ASTRA_A4_SELECTED_PLAN_CONTINUATION.md](ASTRA_A4_SELECTED_PLAN_CONTINUATION.md)
- Hard scope lock [ASTRA_HERO_DEPTH_SCOPE.md](ASTRA_HERO_DEPTH_SCOPE.md)
- Existing M8 authority / stored-execution / observation model — extend, do not fork
- RC-6 residual evaluation ownership inside continuation module (no second planner)

### Root-owned

- Authoritative fresh world capture for continuation checkpoints
- Final composition into normal boot / worker passes
- A3 desktop acceptance judgement
- Four-action physical execution + product evidence
- Integration merge decisions (no blind WIP merge)

---

## 4. Scope check

Both WIP lanes stay inside the hard lock **if** kept to selected composite actions (Atlas flight already separate; Nuitée overnight + SG replacement + SG cancel; observations; continuation; atomic stay; whole-trip reassessment).

| Signal | Flag |
| --- | --- |
| Hardcoded `nuitee` in stay bindings/executor | **Allowed for A4 hero provider** — do not generalize into multi-hotel admin |
| `candidates()` as a mini orchestrator over stay intents | Borderline — keep stay.book/cancel only; **PARK** any generic multi-provider workflow framework |
| Request-planning / healthy-trip / mobile / immigration breadth / extra providers | **PARK / DO NOT CONTINUE** (rejected drafts already checkpointed elsewhere) |
| Frontend parity outside hero readability | **PARK** |
| Arbitrary itinerary/visit/credential management | **PARK** |

---

## 5. Exact next action for a fresh coding agent

**Do not start A4 implementation until A3 desktop acceptance is recorded.**

When A4 engineering resumes:

1. Read this file + `ASTRA_A4_SELECTED_PLAN_CONTINUATION.md` + current `ACTIVE_TASK.md`.
2. Work on a **new branch from primary**, not by merging hotel tip wholesale.
3. First task: **rebase `b911989` onto primary** and add the missing **external dependency PG proofs** (helper already present). Leave hotel source untouched until continuation is safe on primary.
4. Only then cherry-pick/port `2e6cdae` hotel-unique files and align executor dependency checks.

---

## 6. Recovery prep meta

- Written after preservation commits; no WIP source modified by this doc pass.
- Broad suites not run.
- Hotel unit 7/7 is the only execution evidence reconfirmed during recovery.
