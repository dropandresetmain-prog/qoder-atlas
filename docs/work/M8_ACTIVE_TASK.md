# NORTHSTAR M8 active task — Scoped authority, durable execution, observation, reconciliation

## Identity

| Field | Value |
|---|---|
| Repository | `dropandresetmain-prog/qoder-atlas` |
| Worktree | `C:\Dev\qoder-atlas\.worktrees\m8-authority-execution` |
| Branch | `milestone-m8-authority-execution` |
| Authoritative base | `integration/m2-m6-domain-evaluation` @ `a0843db73c5e4bd7fb5c1874391d7361b789aed1` |
| C2 accepted | PASS at `82fa96827fc8d517145498a0ee258f5cdf34c30b` |

## Objective

Implement: validated ActionIntent → current viability → scoped authority → budget protection → durable execution claim → executor → observation → reconciliation → state update / reassessment.

Never: LLM → irreversible / money-moving API.

Do **not** implement M7 business logic or start M9. Do **not** claim C3 passed.

## Checklist

- [x] Checkpoint 0 green (I-10, G-B, assessment gate, complete requeue) — `81b3465`
- [x] Authority grants / approvals / envelope fingerprint binding
- [x] Durable budget commitment concurrency
- [x] Durable execution attempt state machine + fencing
- [x] Idempotency key + request fingerprint equality
- [x] Unknown-outcome reconciliation before retry
- [x] Capability separation (observe ≠ service ≠ authority)
- [x] Internal ProgrammeItem path via M4 commands
- [x] Observation → owner update (internal receipt / external observation)
- [x] Fault / concurrency PostgreSQL suite (20 M8 + 3 C0)
- [x] Candidate gates (typecheck/build/lint/anti-hardcoding/diff --check)
- [x] `docs/refactor/evidence/M8.md` + roadmap status
- [ ] Commit + push M8 candidate (no merge; no C3 claim)

## Explicit exclusions

M7 planner/scenario business logic; M9 runtime/UI; live paid provider calls; runtime SQLite cutover; inventing traveller home currency; case-wide reusable approval; blind retry of OUTCOME_UNKNOWN; fake capability success.

## Issue triage

| ID | Finding | Triage |
|---|---|---|
| G-B | No authoritative traveller home/payer currency | Architecture gap — blocking UNKNOWN at authority (never invent) |
| I-10 | Shared FX/money | Act Now — closed in Checkpoint 0 |
| Shared M7 seam | Minimal `recovery_cases` + extended execution statuses | Act Now for M8 — flag for integration owner; do not fork further |
| Post-observation M6 auto-enqueue | Successful execution observes + updates owner; full trip-recovered assertion remains M6 currentness | Park for Later — reassessment enqueue on observation seam can deepen at C3 |
| Late webhook path | Covered as reconcile/lookup after OUTCOME_UNKNOWN; dedicated webhook ingress table deferred | Park for Later — no M9 ingress |
