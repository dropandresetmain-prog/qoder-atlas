# ACTIVE TASK — Hero E2E recording closure (demo reset + Jordan economics)

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas-a5-hero-e2e-closure`
- Branch: `fix/a5-hero-e2e-closure`
- Starting SHA: `7d4b1f5e3525294ab0585d08ae40d49e7ba3da24`
- Current HEAD: `b4295a0` (pushed)
- Founder acceptance draft: see [Draft final PASS report](c52bb9ad-8869-4508-a0f2-78cba2173681) — clone IDs in JSON are mid-run; post-acceptance Reset left `ns_demo_cl_90dbd69cb03742ea`

## Mission

Close remaining demo/runtime defects for founder video recording.

## Checkpoint ledger

- [x] CP-A — Cancellation semantics + Jordan economic proof (`29e1ae1`)
- [x] CP-B/C — Shared production baseline clone + Reset (`17f62f9`)
- [x] CP-D runtime — wall grants + INPUT_CHANGED claim + quiesce swap (`b6651b9`, `2df12e4`, `eac5cc8`)
- [x] CP-D acceptance — 3× Sarah RESOLVED + Jordan REPLAY plan (evidence in `docs/work/a5-founder-acceptance-report.json`)

## Founder acceptance evidence (2026-09-22)

Reset times (ms): 6039 / 10474 / 3378 / Jordan 4880 — all CLONE_FROM_TEMPLATE.

Sarah ×3: PROGRAMME, exposure 0, blast 3, final RESOLVED, openCases=[], READY/VIABLE each time.

Jordan D2 AT_RISK → D3 DISRUPTED; recommendation AWAITING_AUTHORITY; `Cost not compared` absent;
CANCEL_STAY current penalty USD 0, freeCancellationUntil 2026-09-29T23:59:59Z,
scheduledCancellationPenalty USD 670.77; 167.69 absent.

Founder URL: `http://127.0.0.1:8787/`
Active clone (after hung-server restart, pristine TEMPLATE clone): `ns_demo_cl_f267d541469946d9`
Workspace: `b96791c7-189f-4a59-ae30-b7cb5e6068b4`

## Do not

- Reopen planner/RC-6/authority architecture
- Execute Jordan sandbox in this checkpoint
