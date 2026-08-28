# ACTIVE_TASK — Pass 2: shared UI structure + visual clarity

## Goal

Pass 1 frozen at `7622627`. Pass 2 improves information hierarchy, reusable Case
composition, visual state clarity, loading/analysis presentation, and hero
consistency — without the final writing pass.

## Base / branch

- Pass 1 base: `7622627`
- Branch: `main`
- Production: https://qoder-atlas-production.up.railway.app
- Populated entry: `POPULATED_DEMO_BOOTSTRAP_VERSION = 2026-08-28-jordan-preemptive-entry`

## Pass 1 closure (frozen)

| Area | Result |
|------|--------|
| Jordan pre-emptive lifecycle | PASS (hero e2e + RC-7) |
| Sarah programme recovery | PASS |
| Jonas traveller convergence | PASS |
| Oliver pending change | PASS |
| Hero browser e2e | 5/5 |
| Full suite (pre-Pass 2) | 794/815 |

### Railway Pass 1 spot-check (pre-Pass 2 deploy)

- Health: OK
- Reset: `POST /api/demo/reset` OK
- Jordan: red/needs attention, case opens, lifecycle path OK
- Deployed SHA: no `/version` endpoint; health returns `{ status: "ok" }` only

## Pass 2 issue groups

| Group | Status |
|-------|--------|
| 1 Downstream impact block (`What this affects`) before CTA | **DONE** |
| 2 Progressive status timeline from trip signals | **DONE** |
| 3 Selected recovery before What to do next | **DONE** |
| 4 Jordan whole-trip plan ordering + honest costs | **DONE** |
| 5 Sarah Now/Proposed Date/Time/Venue + no buffer on hero | **DONE** |
| 6 Oliver/shared card composition (same operator-case renderer) | **DONE** (shared path) |
| 7 Analysis loading semantic icons | **DONE** |
| 8 Solid hotel/stay icon `■` | **DONE** |
| 9 Terminal/watching visuals | **Verified** (no semantic change) |
| 10 Jonas traveller handoff link | **DONE** |

## Remaining test failures (20) — classification

| Class | Tests | Triage |
|-------|-------|--------|
| Dashboard trip row missing at READ_AT | T-E2E, G1, DR-8.1/8.2/8.6, i5×2, R1, Wave3 product | **STALE EXPECTATION / FIXTURE DRIFT** — harness dashboard projection returns 0 trips; not hero-path |
| Presentation fixture drift | r3a×3, r3d case options×3, r3d Jonas Approve | **STALE EXPECTATION / FIXTURE DRIFT** — HTML fixture contracts pre-Pass 2 |
| DR-4 clickthrough timeout | operator-clickthrough | **OBSOLETE DUPLICATE** — Jonas path uses traveller surface; waits wrong form |
| DR-5/DR-6 HTTP | change-intake, RELOCATED preview | **UNRELATED / ACCEPTED RISK** |
| Wave3 Gate2 activity copy | wave3-gate2 | **STALE EXPECTATION** |
| ui.test rejected-option | ui.test.ts | **STALE EXPECTATION** — NOT_VIABLE in collapsed more-options |

**Act Now:** none (no hero-visible regression found)

## Pass 2 verification

- Hero browser e2e: **5/5 PASS**
- Focused UI tests: case-lifecycle pass2 + presentation-lane **PASS**
- Full suite: **798/818** (20 failures, classified above)
- `npm run build`: **PASS**
- `gate:anti-hardcoding`: **CLEAN**
- Local screenshots: `output/pass2-screenshots/` (when populated-world script completes)
- Railway pre-deploy spot-check: Jordan OK; Sarah `What this affects` awaits Pass 2 deploy

## Next action

Commit + push Pass 2; confirm Railway deploy; re-run `scripts/pass2-railway-verify.mjs`; final writing pass (separate milestone).
