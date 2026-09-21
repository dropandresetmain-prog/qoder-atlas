# ACTIVE TASK — Sarah + Jordan hero E2E closure

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas-a5-hero-e2e-closure`
- Branch: `fix/a5-hero-e2e-closure`
- Required start: `787fb77bafea158be11981e47b9dcfb1fd08260c`

## Checkpoint ledger

- [x] CP1 — programme horizon, validation limit, cost-before-blast comparator, omit absent programme cost. SHA `787fb77bafea158be11981e47b9dcfb1fd08260c`. Focused tests: 23 PASS / 0 FAIL. Do not redesign unless a later focused test shows a concrete defect.
- [ ] CP2 — seed/world + Sarah/Jordan deterministic truth
- [ ] CP3 — backend/read-model/graph truth
- [ ] CP4 — Sarah full vertical
- [ ] CP5 — Jordan full vertical
- [ ] CP6 — same-world Sarah + Jordan product proof
- [ ] Final gates — only after both pass on one candidate SHA

## Exact next phase

Seed/world + Sarah/Jordan deterministic truth (CP2).

Sarah: healthy → 5 affected → synthetic reprotection → 4 PASS + Sarah FAIL(programme). Flight facts provider-backed; disruption event stays labelled synthetic. Programme times may move in seed so original flight is viable, reprotected arrival makes Sarah's slot infeasible, a later slot restores viability, and the counterpart stays viable.

Jordan: healthy → D1 viable (~95 min) → D2 AT_RISK (~80–85 min) → D3 NOT_VIABLE (physically impossible). Manual triggers. Classification from the evaluator. No stage-ID semantic logic.

Jordan immigration: reviewed static SG→JP entry data, not a hardcoded pass and not LIVE research.

Jordan hotel (locked): do not split the four-night stay and do not implement partial modification. Reseed the original four-night Singapore booking as penalty-free cancellable, then reuse the generalized replacement flow: book three-night replacement, observe it, then cancel the original. Penalty = 0. Replacement stay is not free.

## CP2 acceptance

Focused PostgreSQL/data tests prove the world sequence above, reviewed SG→JP evaluation, and zero hotel cancellation penalty. No full suite.
