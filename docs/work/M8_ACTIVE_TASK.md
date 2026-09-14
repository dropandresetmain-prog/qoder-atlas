# NORTHSTAR M8 active task — Scoped authority, durable execution, observation, reconciliation

## Identity

| Field | Value |
|---|---|
| Repository | `dropandresetmain-prog/qoder-atlas` |
| Worktree | `C:\Dev\qoder-atlas\.worktrees\m8-authority-execution` |
| Branch | `milestone-m8-authority-execution` |
| Authoritative base | `integration/m2-m6-domain-evaluation` @ `a0843db73c5e4bd7fb5c1874391d7361b789aed1` |
| C2 accepted | PASS at `82fa96827fc8d517145498a0ee258f5cdf34c30b` (pre-M8 conditions in M6.md §14) |

## Objective

Implement: validated ActionIntent → current viability → scoped authority → budget protection → durable execution claim → executor → observation → reconciliation → state update / reassessment.

Never: LLM → irreversible / money-moving API.

Do **not** implement M7 business logic or start M9. Do **not** claim C3 passed.

## Checkpoint 0 — mandatory pre-M8 conditions

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | **I-10** shared exact money / FX (0/2/3 decimals; funding + M8 budget use one seam) | **CLOSED** | `money.ts` `currencyExponent` / `multiplyExactDecimal` / `convertExactMoney`; funding uses shared seam; unit + L3 funding tests |
| 2 | **G-B** traveller payer currency UNKNOWN remains blocking at authority | **CLOSED** | `payerCurrencyGate.ts` + decisionGates; unit + composed gate tests |
| 3 | Authority/dispatch re-check `currentAssessmentView` at decision time | **CLOSED** | `assessmentGate.ts`; PG proof CURRENT→approve→change→PENDING→refuse |
| 4 | `PgReassessmentWorker.complete()` bounded retry / durable requeue | **CLOSED** | in-process retry then PENDING requeue; fencing preserved; PG 40001/23505 proofs |

Checkpoint 0 focused results (this worktree):

- `test/northstar-v2-m8-checkpoint0-*.test.ts` + L3 funding I-10 cases + contracts money: **pass**
- `postgres-integration/m8Checkpoint0.pgtest.ts`: **3/3 pass** (fresh PostGIS DB)
- `npm run typecheck`: clean

## M8 work checklist

- [x] Checkpoint 0 green (all four conditions)
- [ ] Authority grants / approvals / envelope fingerprint binding
- [ ] Durable budget commitment concurrency
- [ ] Durable execution attempt state machine + fencing
- [ ] Idempotency key + request fingerprint equality
- [ ] Unknown-outcome reconciliation before retry
- [ ] Capability separation (observe ≠ service ≠ authority)
- [ ] Internal ProgrammeItem path via M4 commands
- [ ] Observation → owner update → M6 reassessment
- [ ] Fault / concurrency PostgreSQL suite
- [ ] Candidate gates (typecheck/build/lint/anti-hardcoding/diff --check)
- [ ] `docs/refactor/evidence/M8.md` + roadmap status
- [ ] Commit + push M8 candidate (no merge; no C3 claim)

## Frozen contracts (do not silently diverge)

- F08 / F12 / F14 / F15 / F18
- M0 ActionPlan / ActionIntent / AuthorityEnvelope / Execution contracts
- M1 UoW / idempotency
- M3 provider capability / budget / FX observation
- M6 `currentAssessmentView` / reassessment worker

Shared M7 seam: use frozen ActionPlan/ActionIntent only. Minimal shared-contract changes must be flagged for integration owner — never fork locally.

## Explicit exclusions

M7 planner/scenario business logic; M9 runtime/UI; live paid provider calls; runtime SQLite cutover; inventing traveller home currency; case-wide reusable approval; blind retry of OUTCOME_UNKNOWN; fake capability success.

## Issue triage (running)

| ID | Finding | Triage |
|---|---|---|
| G-B | No authoritative traveller home/payer currency | Architecture gap — closed as blocking UNKNOWN at authority (never invent) |
| I-10 | Shared FX/money | Act Now — closed in Checkpoint 0 |
