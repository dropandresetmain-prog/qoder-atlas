# M7 ACTIVE TASK — Multi-object Recovery Strategies and Typed Action Planning

Working-memory ledger. Close checklist items only with evidence.

## Goal

WorldSnapshot → typed RecoveryStrategy / ScenarioChanges → isolated proposed
world → deterministic M6 evaluation → viable/non-viable → typed ActionPlan /
ActionIntent DAG. Propose and compile only. Do not execute.

## Exact identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:/Dev/qoder-atlas-m7`
- Branch: `milestone-m7-recovery-planning`
- Base SHA: `a0843db73c5e4bd7fb5c1874391d7361b789aed1`
- Migration allocation: M7 `0100`–`0102` (leave `0109`–`0119` for M8)

## Checklist

- [x] Freeze RecoveryStrategy + scenario overlay + ActionPlan compiler contracts
- [x] Scenario overlay (isolated, no canonical mutation; same M6 registry)
- [x] Close I-7: objective targets command + proposed disposition/waiver
- [x] ActionPlan compiler (typed intents, capability reject, DAG cycle reject)
- [x] Stale-base manifest protection
- [x] ProgrammeItem recovery + shared-object / multi-person proofs
- [x] Unit + focused PostgreSQL tests
- [x] Evidence `docs/refactor/evidence/M7.md` + roadmap status
- [x] typecheck / build / lint / anti-hardcoding / diff --check
- [x] Canonical `test:postgres` 371/371 on fresh DB
- [ ] Commit + push (no merge)

## Current checkpoint

CP2 — verification green. Committing and pushing.

## Next action

Commit coherent M7 package and push branch. Do not merge. Do not start M8/M9.

## Critical constraints

- AI → schema → M6 viability → typed ActionPlan only.
- No provider execution / M8 authority / M9 UI.
- Candidate state separate from canonical PostgreSQL state.

## Issues / triage

| ID | Finding | Triage |
|---|---|---|
| M7-1 | ActionPlan UoW create/select not wired to runtime | Park for Later (M9) |
| M7-2 | Offers must be caller-resolved | Ignore / Accept Risk |
| M7-3 | Durable disposition needs M8 authority | Park for Later (M8) |
| I-7 | Closed | Act Now — done |
