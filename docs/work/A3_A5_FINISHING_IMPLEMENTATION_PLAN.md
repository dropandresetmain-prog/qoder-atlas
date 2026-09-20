# NORTHSTAR A3–A5 finishing implementation plan

This is the operational plan for finishing the hackathon candidate. It is intentionally much smaller than the Astra convergence charter.

Use it for **execution order, checkpoint ownership, model routing and stop conditions**. It does not replace the product/architecture contracts.

## Source-of-truth order

Read in this order before implementation:

1. `docs/work/ACTIVE_TASK.md`
2. `docs/work/A5_FOUNDER_QC_RECONCILIATION.md`
3. `docs/work/A5_1_FOUNDER_SARAH_QC_NOTES.md` (founder evidence; do not rewrite history)
4. this plan
5. `docs/work/ASTRA_HERO_DEPTH_SCOPE.md`
6. `docs/work/A4_PHYSICAL_SANDBOX_ACCEPTANCE.md`
7. `docs/SCENARIOS.md`
8. `docs/ROADMAP.md`
9. `docs/CAPABILITIES_AND_LIMITATIONS.md`

Older A3/A4 progress/prep documents remain historical evidence and must not override the accepted A4 result or the post-founder-QC A5 reconciliation.

Older audits and plans are historical/supporting evidence where they conflict with these files.

## Final status overlay — after A4 physical acceptance

This overlay supersedes older "future A4" language below.

- **A3 — CONDITIONAL PASS.** Recommendation and desktop surface were sufficient to continue; only bounded graph/progression/cost/copy truth debt remains.
- **A4 CP2 continuation — PASS** @ `f7a497d984ea93fc6436c6c717a553db48602fa6`.
- **A4 CP3 protected hotel execution — PASS** @ `0c177c830a8593899147f4227aa90b2cff327785`.
- **A4 CP3.5 controlled seam — PASS** @ `5bdb6527369a2a3c34957ce718b5f690ce50adf5`.
- **A4 physical sandbox — ACCEPTED** @ `546adf210db8ead343ecdac22b410515665c176a`.
- **A5 — ACTIVE, REBASED AFTER FOUNDER E2E.** A5.1 now has two parallel bounded lanes: visual-first Overview/Case redesign around accepted graphs + backend/read-model truth closure. Integrate and founder-QC once more, then A5.2 Sarah + Jordan physical proof on one candidate, then A5.3 gates/freeze.

Do not rerun or reimplement completed A4 checkpoints absent a demonstrated regression. Physical acceptance details live in `docs/work/A4_PHYSICAL_SANDBOX_ACCEPTANCE.md`.

## Current finish line

A0/A1/A2 are closed.

### A3

Close Jordan planning acceptance around the already-proven complete LIVE composite that reached `VIABLE / AWAITING_AUTHORITY`.

A3 is a **recommendation + deterministic evidence + desktop acceptance checkpoint**. Do not turn it into another architecture phase.

### A4

Execute exactly four selected Jordan sandbox actions through the existing generalized execution machinery:

1. replacement flight;
2. Narita hotel booking;
3. Singapore replacement hotel booking;
4. cancellation of the displaced Singapore hotel.

The replacement Singapore stay must be confirmed before the displaced stay is cancelled.

Each consequential action follows:

`approved intent -> durable attempt -> provider action -> observation/reconciliation -> canonical application -> reassessment`

Unknown provider outcome means **reconcile, never blind redispatch**.

A4 closes only when the four required actions are complete, canonical state reflects their observed outcomes, whole-trip assessment passes and the Case is visibly resolved.

### A5

A5 is now three consolidated checkpoints after founder E2E:

**A5.1 — convergence.** Run two bounded lanes in parallel:
- visual-first Overview + Case redesign: information architecture → image mockups → founder QC → static HTML → founder QC → production integration;
- backend truth closure: D1/D2/D3 GREEN→AMBER→RED, D3 causal failure, duplicate-edge cleanup if confirmed, D2 recommendation gating, exact approval blocker, Sarah+Jordan coexistence, suspicious Sarah FAILED states.

Then integrate and perform founder E2E again. Neither lane alone closes A5.1.

**A5.2 — final physical proof.** Sarah + Jordan on the same exact candidate SHA. Destructive Jordan provider setup may still require a fresh external baseline/workspace; that is not a product reset requirement.

**A5.3 — gates and freeze.** Run the canonical broad gates once, reconcile evidence/docs, boot-smoke normal PG, push and freeze.

Sarah remains the accepted programme-side recovery story. Do not force an external flight purchase into Sarah.

The UI lane may redesign all surrounding Overview/Case composition. V7.2 and V5.6 semantic systems remain binding and are not replaced.

See `docs/work/A5_FOUNDER_QC_RECONCILIATION.md` for the post-QC source-of-truth overlay.

---

# Operating rules for every finishing agent

## Architecture and scope

- One generalized PostgreSQL recovery engine. Sarah/Jordan are data worlds, not application branches.
- PostgreSQL is the only normal runtime. Do not add runtime SQLite paths.
- AI may interpret, research and propose. Deterministic code owns hard validation, viability, authority, state mutation and consequential side-effect gates.
- Never permit `LLM -> irreversible/provider action`.
- V5.6 and V7.2 preserve their accepted semantic meaning. They are not workflow diagrams.
- Legacy frontend is a product-quality/user-job floor, not a copy/layout/component/pixel restoration target.
- Desktop only for the hackathon finish.
- No provider success may be presented as trip recovery before canonical application and whole-trip reassessment.

## Hard scope lock

Do not reopen:

- healthy-trip request architecture or traveller composer;
- mobile;
- programme intake/management expansion;
- generic hotel administration;
- arbitrary itinerary/visit/credential management;
- broad immigration/legal crawling;
- transfer transactions;
- insurance claims;
- unrelated providers;
- extra scenarios or multi-centre V7.2 breadth; simultaneous Sarah + Jordan Cases in one product world are now required A5.1 behaviour;
- importer atomicity redesign;
- unrelated parity/refactors/infrastructure.

If a capability is not required to close one of the five checkpoints below, park it.

## Git and worktrees

- Create finishing work from the latest accepted checkpoint, not an older recovery branch.
- Exact-path stage only. Never stage unrelated files.
- Inspect diff/status before every checkpoint commit.
- No secrets, generated recordings, local keys, provider credentials or local DB config in Git.
- Commit and push every coherent verified checkpoint.
- Never leave substantial verified work local-only.
- Keep the preserved WIP branches as recovery anchors until their useful deltas are integrated and accepted.

Preserved WIP:

- continuation: `codex/a4-selected-continuation` @ `b911989`;
- hotel execution: `codex/a4-hotel-execution` @ `2e6cdae`.

They are sibling forks. **Do not merge either branch wholesale.**

## Testing

Use the strict hierarchy:

1. smallest focused test for the changed behavior;
2. adjacent/module tests;
3. relevant PG/service suite;
4. broader regression only when integration risk justifies it;
5. full/final gates only at A5 freeze or another genuine milestone boundary.

Do not use the full suite as a debugging loop.

When a focused test fails, debug that signal first.

Report exactly what was run and the result. If broader tests are skipped, say why.

## Long-horizon reliability

Keep `docs/work/ACTIVE_TASK.md` current.

Before major phases, after compaction/delegation and before completion, reread the ledger and this plan.

A checkpoint is not complete until acceptance evidence exists, the ledger is reconciled, and the coherent work is pushed.

Delegate bounded work where useful. Require delegated returns to contain only:

- finding;
- affected files;
- recommended action;
- evidence.

Keep architecture, integration, execution safety and milestone acceptance with the primary/root agent.

---

# Checkpoint 1 — A3 accepted

## Goal

Close Jordan recommendation/desktop acceptance without adding new planning architecture.

## Base

Latest `integration/astra-post-r4`.

## Required work

Physically run the current normal PostgreSQL product and verify the complete composite recommendation is clearly visible and truthful:

- replacement flight;
- Narita overnight stay;
- scoped authoritative Japan entry/landside evidence;
- Singapore replacement + displaced-stay cancellation consequence;
- finals/event objective;
- original provider currency and home-currency/Frankfurter comparison;
- material rejected alternatives and deterministic reasons;
- uncertainty and authority readiness.

Distinguish:

- new expenditure;
- possible displaced-booking loss/penalty;
- unresolved/unknown financial outcomes.

Do not claim A4 executability merely because the Case is `AWAITING_AUTHORITY`.

Investigate the current cancellation-ownership lookup only if it blocks truthful A3 authority presentation. Otherwise move that defect to Checkpoint 2/3.

## Acceptance

- one complete current LIVE recommendation is physically visible on desktop;
- alternatives, costs/FX, entry evidence, timing and authority are understandable;
- no A4 external action is required to close A3;
- no misleading claim of completed recovery;
- evidence records exact code candidate and runtime proof;
- A3 is explicitly marked accepted in the ledger.

## Tests

No broad suite merely to capture A3 evidence.

If a UI/authority defect is fixed, run only its focused/adjacent tests and the affected physical proof.

## Model routing

**Default:** human/operator for the physical run; Luna High for bounded UI/copy/evidence fixes.

**Alternative:** Cursor Auto Balance / Composer 2.5 for ordinary presentation fixes.

**Cost-conscious:** GLM-5.3-Flash or Qwen3.8-Flash for clearly bounded non-sensitive edits.

Astra is review-only if A3 exposes a genuine cross-contract or acceptance ambiguity.

## Stop condition

A3 is pushed and accepted. No more A3 feature work.

---

# Checkpoint 2 — A4 continuation safety

## Goal

Integrate the smallest safe selected-plan continuation mechanism and the flight-to-next-action canonical handoff.

This is a bounded four-action safety seam, **not a workflow/orchestration framework**.

## Base

Fresh finishing branch from accepted A3.

## WIP source

Use `b911989` as reviewed source material only. Selectively port the useful continuation delta; do not merge the branch wholesale.

Retain:

- source-effect identity/fingerprints;
- stored residual derivation from the persisted plan;
- external prerequisite requiring canonical application;
- source-kind guard;
- bounded continuation checkpoint;
- exact provider observation + canonical receipt linkage.

## Required safety properties

After one approved action mutates canonical state, only the exact remaining selected effects may continue when:

1. the prerequisite provider outcome is known-success;
2. its canonical application is committed;
3. the change is attributable to the same approved plan;
4. the exact residual is still deterministically viable under a fresh authoritative PostgreSQL capture;
5. authority, cost/terms and protected inputs remain valid.

Must refuse:

- provider observed success without canonical application;
- unrelated/interleaved Journey changes;
- forged or mismatched receipts;
- changed price/material provider terms requiring a new decision;
- unknown provider outcome except reconciliation;
- stale or mismatched plan/strategy/next-intent checkpoint.

The application/root owns fresh world capture and production evaluator selection. Do not expose arbitrary caller-constructed worlds/proofs as product authority.

Add the narrow canonical-application handoff to the existing Atlas selected-flight path. Do not rewrite Atlas execution.

## Highest-value proof

Use a focused PostgreSQL test with the real evaluator over the selected-plan prefix:

- observed success only -> successor blocked;
- observed + canonical application + viable residual -> correct successor allowed;
- unrelated change -> blocked;
- unknown outcome -> reconciliation only.

Add a materially different synthetic plan shape only where needed to prove the mechanism is not Jordan-specific.

Stop once these bounded properties pass.

## Model routing

**Default:** Terra High in a terminal-capable harness.

**Alternative:** Cursor Auto Intelligence / Grok 4.6 High or Sonnet High.

**Different-family alternative:** GLM-5.3 for complex integration.

Because this is execution/currentness/idempotency-sensitive, use **one** high-risk review after the focused evidence passes: Astra High, Sol High or Opus High. Choose one, not all three.

## Stop condition

Continuation safety is integrated, tested and pushed. Hotel execution remains uncomposed.

---

# Checkpoint 3 — A4 hotel integration

## Goal

Port and repair only the hotel-specific A4 execution delta, then compose the complete protected four-action runtime.

## Base

Accepted Checkpoint 2.

## WIP source

Port only the hotel-unique delta from the preserved hotel lane. Do not carry its older continuation/compiler copies forward.

Useful pieces include:

- migration `0134_stay_execution_inputs.sql`;
- immutable stay execution bindings;
- stay cancellation command;
- bounded Nuitée dispatcher/reconciliation;
- observed-stay canonical bridge;
- small coordinator binding hook;
- focused stay boundary/cancellation tests.

## Known defects to fix first

Do not rediscover these downstream:

1. booking binding INSERT currently has a columns/values mismatch;
2. cancellation validation treats absent optional canonical-application IDs as invalid UUIDs;
3. provider reconciliation must prove the observed booking matches approved identity/terms, not status alone;
4. a known external booking side effect followed by price/term mismatch must not be reported as ordinary no-side-effect failure;
5. entity-existence shortcuts must not masquerade as receipt-backed canonical replay;
6. the normal hotel execution cycle must actually run reconciliation for unknown/incomplete outcomes;
7. successor readiness must depend on canonical application, not provider success alone.

Also verify the cancellation-ownership query against canonical reservation allocation ownership before approval/execution.

## Normal-runtime integration

Compose only the hero-required protected capabilities:

- Atlas selected flight;
- Nuitée stay booking;
- Nuitée stay cancellation;
- observation/reconciliation;
- canonical stay application;
- fresh residual reassessment.

Complete preflight must check every selected external effect before consequential execution.

Do not add generic hotel management or provider orchestration.

## Focused acceptance evidence

At minimum:

- stay binding persistence/uniqueness;
- cancellation ownership/validation;
- booking exact-term reconciliation;
- unknown-outcome lookup without redispatch;
- canonical receipt-backed idempotency;
- replacement booking before displaced-stay cancellation;
- one focused four-action PostgreSQL seam using production evaluation and controlled provider outcomes.

During iteration, stay focused. Run the relevant PG/service checkpoint only after the seam works.

## Model routing

**Default bounded implementation:** Luna xHigh for the known hotel defects and focused tests.

**Integration owner:** Terra High for shared execution/boot/authority/currentness boundaries.

**Alternative:** Cursor Auto Intelligence / Composer 2.5 for fast local write-run-fix loops.

**Different-family alternative:** GLM-5.3 or Sonnet High for complex reversible integration.

Use Astra only if a concrete execution-safety contract remains ambiguous after runtime evidence.

## Stop condition

Normal boot can truthfully expose the protected four-action path, focused tests pass, and the candidate is ready for a real sandbox run. Do not call A4 accepted yet.

---

# Checkpoint 4 — A4 physical acceptance — ACCEPTED

## Goal

Physically execute Jordan through the real supported sandbox path and prove whole-trip recovery.

## Base

The exact pushed Checkpoint 3 candidate.

## Pre-run

Prepare a genuinely active sandbox Singapore baseline booking. Baseline setup is separate from the four recovery actions and must not be counted as an A4 action.

Verify current provider terms/quotes and required protected inputs before approval.

## Required action order

1. replacement flight;
2. canonical application + reassessment;
3. Narita booking;
4. canonical application + reassessment;
5. Singapore replacement booking;
6. canonical application + reassessment;
7. cancel displaced Singapore booking;
8. canonical application + final whole-trip reassessment.

The compiler may express dependencies, but the key invariant is:

**replacement Singapore accommodation confirmed and canonically applied before old accommodation cancellation.**

After every provider call:

`observe/reconcile -> canonical application -> reassess residual -> next action`

If the operator stops during the run, preserve attempts/provider refs/observations/receipts and resume via reconciliation. Never reset or redispatch merely to obtain a clean screen.

## Product evidence

The recording must visibly establish:

- what failed and why;
- why material alternatives fail;
- the selected complete recovery;
- costs, FX and possible cancellation loss;
- authority/approval;
- actual provider/model activity with honest provenance;
- four action outcomes;
- canonical state changes;
- final whole-trip PASS;
- Case RESOLVED / VIABLE;
- V7.2 population context without turning unrelated UNKNOWN travellers green.

V5.6 continues to describe trip causality, not execution workflow.

## Testing

Do not run the full suite during the physical run.

For a failure, reproduce and repair the smallest relevant seam, run focused tests, then repeat only the affected physical proof.

## Model routing

**Primary:** human/operator runs and records the sandbox acceptance.

**Debugging:** Terra High for demonstrated cross-contract/runtime blockers.

**Bounded fixes:** Luna High/xHigh or Cursor Auto Balance/Intelligence depending difficulty.

Astra reviews only a concrete unresolved safety/acceptance question.

## Stop condition

All four selected actions are complete, observed outcomes are canonically applied, current whole-trip assessment passes, Case is resolved, desktop evidence is captured, and A4 acceptance is committed/pushed.

---

# Checkpoint 5 — A5 repeat and freeze

## Goal

Prove repeatability on the final candidate, perform presentation-only corrections, run final gates and freeze.

## Hero repeats

On the **same code candidate**:

### Sarah

Healthy/resettable world -> disruption -> LIVE model/provider research -> generalized programme recovery -> authority/execution -> observation -> reassessment -> RESOLVED.

Do not add an external flight purchase.

### Jordan

Prepare genuine fresh sandbox baseline state where destructive provider actions require it.

Run the complete Jordan LIVE path through the four selected actions and final RESOLVED / VIABLE state.

A fresh PostgreSQL workspace does not recreate an external supplier booking that was previously cancelled. Treat provider baseline preparation as explicit setup.

## Allowed changes during A5

Only fix defects that:

- misstate product truth;
- block the hero;
- make evidence unreadable;
- break navigation/progress;
- undermine reliable recording/repeatability.

No new features, providers, scenarios, platform breadth or architecture.

Any code change that can alter hero behavior requires repeating the affected hero proof.

## Final gates

After both heroes pass on the final code candidate, run the canonical release checkpoint:

```bash
npm run typecheck
npm run build
npm run lint
npm test
npm run test:postgres
npm run test:migration
npm run gate:anti-hardcoding
```

Then perform one normal PostgreSQL boot smoke.

If a broad gate fails, classify and debug that signal. Do not immediately launch another broad testing campaign.

Do not revive historical behavior just to satisfy obsolete tests; classify tests as CURRENT_TARGET, MIGRATION_BOUNDARY or HISTORICAL_LEGACY where necessary.

## Model routing

**Physical proof/release decision:** human/operator.

**Presentation/mechanical fixes:** Luna High, Cursor Auto Balance/Composer, GLM-5.3-Flash or Qwen3.8-Flash.

**Complex final blocker:** Terra High / Cursor Auto Intelligence / Sonnet High.

**Final high-risk acceptance review:** one Astra High, Sol High or Opus High review only if a concrete unresolved risk remains. Runtime/DB/browser/provider evidence outranks model judgement.

## Freeze

Before final handoff:

- inspect diff/status;
- ensure no secrets/generated junk;
- reconcile `ACTIVE_TASK.md`, roadmap/evidence only where current truth changed;
- record final candidate SHA and hero evidence;
- commit and push;
- run final gates on that exact candidate;
- if unchanged after gates, freeze it as the submission candidate.

No further development without a demonstrated submission blocker.

---

# Remaining issue triage

## Act Now

- final A3 desktop acceptance;
- continuation canonical-application/currentness safety;
- flight-to-continuation handoff;
- broken hotel binding INSERT;
- optional cancellation validation;
- exact booking-term reconciliation;
- known-side-effect/unknown-outcome handling;
- receipt-backed canonical replay;
- hotel reconciliation composition;
- all-action preflight/authority/funding;
- four-action physical proof;
- final whole-trip resolution predicate.

## Investigate Now

- cancellation ownership query against canonical reservation allocation schema;
- current provider quote/cancellation/sandbox availability before physical run;
- budget/revision accounting across the actual four-action prefixes;
- idempotency stability only where focused evidence shows a problem.

## Park for Later

Everything in the hard scope lock above, plus broad test-performance work and unrelated historical failures.

## Ignore / Accept Risk

- narrative-only same-night-closure details not proven by authoritative runtime state;
- unproven insurance coverage beyond honest context/uncertainty;
- explicit manual sandbox baseline preparation for destructive demo repeats;
- inert legacy controls already accepted as non-blocking.

---

# Completion rule

NORTHSTAR is done for this hackathon when:

1. accepted A4 execution truth remains intact;
2. A5.1 visual redesign + backend truth closure are integrated and founder E2E is understandable/actionable;
3. Sarah and Jordan both pass A5.2 physical proof on the same final code candidate;
4. final A5.3 gates pass or any exception is explicitly classified and accepted;
5. the final candidate, recordings/evidence and claims agree;
6. the repository is frozen instead of expanded.
