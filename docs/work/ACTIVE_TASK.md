# ACTIVE TASK — A4 CHECKPOINT 3 HOTEL EXECUTION INTEGRATION

Live ledger for protected Nuitée stay book/cancel on the accepted CP2 continuation base.

## Identity

- Branch: `finish/a4-hotels`
- Base / starting SHA: `f7a497d984ea93fc6436c6c717a553db48602fa6` (`finish/a4-continuation` CP2 PASS tip)
- Implementation core: `c21867e` (continuation)
- Role: PRIMARY LOCAL IMPLEMENTER — A4 Checkpoint 3
- Scope: hotel-unique Nuitée book/cancel path through ActionPlan → authority → attempt → provider → observation → canonical application → continuation
- Do NOT: merge to main, live supplier mutation, generic hotel CRUD, modifyStay, V5.6/V7.2, A3 demo defects

## WIP source material (hotel-unique only; not blind merge)

- Hotel: `codex/a4-hotel-execution` @ `2e6cdae2ef632f62b4cfc72bdfdf6c0c920dc36b`
- Hotel-unique delta: `089db15..2e6cdae`
- Rejected: hotel fork’s stale continuation/compiler/`0133` copies — CP2 wins

## Port inventory (hotel-unique)

| File | Disposition |
|---|---|
| `migrations/0134_stay_execution_inputs.sql` | Ported |
| `execution/stayExecutionInputs.ts` | Ported + fixed BOOK INSERT |
| `commands/observedStayCancellationCommands.ts` | Ported + fixed optional canonical ID validation |
| `commands/observedStayCommands.ts` | Ported `canonicalApplication` hook only |
| `app/target/externalStayExecution.ts` | Ported + repaired defects 3–7 |
| `recoveryPlanningCoordinator.ts` | Binding persist hook only |
| `recoveryApproval.ts` | `reservation_allocations` ownership + stay preflight |
| `composeTargetBoot.ts` | Stay composition + capability statements |
| `a4ObservedStay.pgtest.ts` | +cancellation / optional-canonical cases |
| `a4StayExecution.pgtest.ts` | Binding + fail-closed resolve + successor gate |
| `r4-offer-execution-boundary.test.ts` | Stay boundary / match / side-effect tests |
| Stale `0133` / `selectedPlanContinuation` / compiler from hotel fork | **Rejected** |

## Checkpoint status

| CP | Goal | Result |
|---|---|---|
| 2 | Selected-plan continuation safety + Atlas handoff | **PASS** @ `c21867e` / tip `f7a497d` |
| 3 | Hotel execution integration | **PASS candidate** (no live sandbox) |

## Acceptance (Checkpoint 3)

- [x] BOOK binding INSERT persists all required identity/terms; incomplete/ambiguous → fail closed
- [x] CANCEL binding persists displaced stay identity + max-loss evidence
- [x] Optional canonicalApplication absent → valid; malformed supplied → rejected
- [x] Exact booking reconciliation (not status-alone); mismatch → no redispatch / no successor
- [x] Confirmed booking with term mismatch preserves side effect (`LOST_RESPONSE` → OUTCOME_UNKNOWN), not ordinary FAILURE
- [x] Receipt-backed idempotency (not entity-existence-only)
- [x] Execution cycle runs reconciliation under workspace lease
- [x] Successor requires canonical application (CP2 invariant preserved)
- [x] Cancellation ownership uses `reservation_allocations`
- [x] Replacement-before-cancellation verified via ActionPlan compiler deps (existing m7 tests)
- [x] Normal boot composes stay book/cancel/reconcile/canonical truthfully
- [x] Focused binding + successor-gate PG + unit proofs green
- [ ] Full four-action controlled mock hotel cycle — **Park for Later** (dependency prefix proved; physical path is CP4)
- [x] No live supplier mutations in this checkpoint

## Known defect dispositions

1. Broken BOOK INSERT — **fixed** (22 columns / 22 params)
2. Optional canonical IDs — **fixed** (absent OK; partial/malformed fail closed)
3. Exact booking reconciliation — **fixed** (`matchApprovedStayBooking` + retrieve field pass-through)
4. Known side effect ≠ FAILURE — **fixed** (confirmed+mismatch → `LOST_RESPONSE`)
5. Receipt-backed idempotency — **fixed** (entity alone refused)
6. Cycle reconciliation — **fixed** (`runExternalStayExecutionCycle` runs reconcile under lease)
7. Successor needs canonical application — **preserved** (candidates + m8 prepare)
8. Cancellation ownership — **fixed** (`reservation_allocations` in approval + cancel command)
9. Replacement before cancel — **verified** (compiler deps; m7 tests green)

## A3 conditional-pass defects (CARRY FORWARD — do not solve here)

- Disruption trigger / Jordan progressive delay stages not obvious in UI
- V5.6 graph semantic state wrong in some states (e.g. amber when connection impossible); missing/inconsistent edges
- Cost provenance of hotel/new-spend/cancellation SGD figures needs final quote+nights+FX trace
- Graphs should sit above other Case/Overview content; recovery copy needs another compression pass

## Checks

- `node --test test/r4-offer-execution-boundary.test.ts` — 9/9
- `node --test --test-concurrency=1 postgres-integration/a4StayExecution.pgtest.ts` — 3/3
- `node --test --test-concurrency=1 postgres-integration/a4ObservedStay.pgtest.ts` — 11/11
- `node --test --test-concurrency=1 postgres-integration/a4SelectedPlanContinuation.pgtest.ts` — 9/9
- `node --test test/northstar-v2-m7-recovery-planning.test.ts` — 26/26
- `npx tsc --noEmit -p tsconfig.json` — clean
- Not run: full `npm test`, `test:postgres`, migration suite (later gates)

## Next action

Commit + push `finish/a4-hotels`. Do **not** run the real four-action sandbox (CP4). Do **not** merge to main.
