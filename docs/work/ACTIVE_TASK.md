# ACTIVE TASK — A5.1 PHASE 1 (V5 integration + control smoke)

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Writer worktree: `C:\Dev\qoder-atlas-a5-integration`
- Branch: `finish/a5-1-integration`
- **Canonical substrate SHA:** `80441cc5ca7112a09250972dd60ec3b8d7f59c21`
- **Frozen V5 source:** `ui/operator-workspace-v5` @ `dca9e6653cd8c6f019fda574093c1f541208e638`
- Common merge-base: `372a664041897ddb173aa12612307c759e060bc3`

## Critical rule

**Backend semantics on `80441cc` win over presentation expectations.**
Do not restore old semantic fields for V5. Port only generic projection needed for V5 to consume current backend truth.

## Current phase

**PHASE 1 — Frozen V5 integration onto canonical substrate + same-process Demo Console smoke.**

- Do NOT run full Sarah → Jordan hero E2E yet.
- Do NOT merge/rebase `ui/operator-workspace-v5`.
- Deliberate path/commit porting only.

## Status

- [ ] B — Port V5 presentation; reconcile shell; keep backend semantics
- [ ] C — Focused integration tests
- [ ] Checkpoint 1 — commit + push integrated candidate
- [ ] D — One canonical process boots (migration 0136 via normal boot)
- [ ] E — Supported reset baseline + preflight
- [ ] F — Same-process Sarah trigger/reset + Jordan D1→D2→D3→Overnight smoke + retrigger
- [ ] G — Overnight capability assessment (no hero run)

## Explicit blockers deferred to later hero runs

- Sarah recommendation selection — investigate only during Sarah hero unless it blocks this phase
- Jordan onward-flight usability — investigate only during Jordan hero unless it blocks this phase

## Exact next step

Integrate frozen V5 presentation onto `80441cc`, push Checkpoint 1, then normalize runtime and run control harness smoke.
