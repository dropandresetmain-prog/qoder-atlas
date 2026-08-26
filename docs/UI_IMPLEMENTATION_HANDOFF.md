# UI Implementation Handoff — Approved NORTHSTAR Screens

**Branch:** `lane/ui-approved-screens`
**Worktree:** `C:\Dev\qoder-atlas\.worktrees\ui-approved`
**Latest commit:** (see `git log -1`) — s8–s12: decisions, activity, traveller T1–T7, fixtures, visual verify
**State at handoff:** `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 635/635 pass; build clean; anti-hardcoding CLEAN. Repo-wide eslint still reports 3 pre-existing unused imports in `src/intelligence/schemas.ts` (outside UI ownership).

> To continue in Cursor: open the repo, `git worktree list` → the lane is at
> `.worktrees/ui-approved`, or `git checkout lane/ui-approved-screens` anywhere.
> All work stays in `src/ui/**` + its tests. Do NOT touch engine/domain/contracts.

---

## 1. Task (standing instruction)

Implement the approved NORTHSTAR visual designs. Own `src/ui/**`; small
presentation-boundary/read-model wiring allowed. No scenario-specific
branching (anti-hardcoding). Approved renders are visual truth. Build against
generic UI states/read models; do not wire final scenario choreography.

## 2. Reference material (visual truth — use these)

All in the sibling worktree `C:\Dev\qoder-atlas\.worktrees\ui-renders` (branch `lane/wave3-ui-renders`):

- **`docs/DESIGN.md`** — design charter: "cockpit daylight × concierge", state
  palette (green `#2F6B47` confirmed, brass `#96670F` proposed/waiting,
  vermilion `#C2431A` broken/decide, grey `#6B7280` unknown ALWAYS with `?`,
  ink `#14171C` = one ink-dark object per screen), type tiers, motion rules.
- **`docs/design-renders/*.html`** — 23 approved renders:
  - Shell/operator: overview `o1`, programme `p1/p2`, case `c1`–`c6`,
    decisions `d1`, activity feed.
  - Traveller: `t1`–`t7` (healthy, disrupted, recovering, decision, recovered…).
  - Programme-change preview `e1/e2`.
- **`docs/design-renders/renders.css`** — approved component CSS (already
  merged into `src/ui/theme.ts` in step s3; check here first for any missing class).
- **`docs/design-renders/shots/*.png`** — final reference screenshots.
- **`docs/design-renders/assets/sg-dusk.png`** — traveller hero photo.

## 3. Progress so far (all committed)

| Step | Status | What landed |
|---|---|---|
| s0–s2 | done | Worktree/render verification; render→screen mapping; gap list |
| s3 | done | `src/ui/theme.ts`: all approved components from `renders.css` merged |
| s4 | done | `src/ui/page.ts`: approved topbar |
| s5 | done | Operator overview O1 |
| s6 | done | Programme P1/P2 + intake + E1/E2 change preview (`5bbc73a`) |
| s7 | done | Case workspace C1–C6 (`508e05c`) |
| s8 | done | **Decisions D1 + Activity feed**: `screens/operator-decisions.ts`, `screens/operator-activity.ts`, UI-local `operator-surfaces-view-model.ts` |
| s9 | done | **Traveller T1–T7**: approved concierge layout — topbar, hero kickers, itin-row, commit-card, viab, check-row, optcards, thread, composer |
| s10 | done | Fixtures for optional case fields + decisions/activity + T1–T7 presentations; preview under `data/ui-preview/` |
| s11 | done | Playwright screenshots vs `docs/design-renders/shots/*.png` |
| s12 | done | typecheck / test / build / anti-hardcoding clean; push branch |

## 4. What's left

UI lane complete for approved screens. Next: **backend integration** onto
`244ea5b` (or current `integration/final-demo-backend`) — wire Decisions /
Activity / richer CaseDetailView / TravellerPresentation from app projections;
preserve FX fields (providerCost vs home-currency restatement).

## 5. Read-model gaps to report (integrator work, NOT UI)

UI renders these only when present — never fabricates:

- Structured commitment card: `commitment.title/body/ifMissed`.
- Rail sections: case facts (opened at, signal source), policy cap, decide-by,
  recovery pace, who decides, recovery timeline → `railSections[]`.
- Rich affected items with per-item state (`affected[]` with
  BROKEN/AT_RISK/UNKNOWN/INTACT) — today only flat `affectedItems: string[]`.
- Option `flags: string[]` (e.g. "Keeps the dinner", trade-off chips).
- Action `detail: string` (sub-line under check-rows).
- C5 "three honest ways forward" alt-rows have no field — candidate
  `manualAlternatives`.
- Page-head meta "Case opened … · Signal: …" needs `openedAt`/`signalSource`.
- Decisions page richer columns: `decideBy`, decided history, waiting-on person
  name beyond traveller/organisation generic labels.
- Programme-scale activity feed (day-grouped) beyond per-trip Wave activity.
- Traveller presentation projection: itinerary rows, progress rows, thread
  messages, hero photography URL, structured commitment card.

## 6. Test-contract notes (do not regress)

- `test/wave3r-dr8-projection-truth.test.ts:371` — resolved case HTML must keep
  `data-outcome="FULLY_RECOVERED"` (machine-readable, outside visible text).
- Jargon gate: `FORBIDDEN_UI_TERMS` scanned against VISIBLE text only; no raw
  enums/ids (`case-`, `strategy-`, `unknown`, `fully_recovered`…) in copy.
- G3R test: resolved visible text must include "your trip is back on track."
- `test/ui.test.ts` case assertions updated to approved vocabulary:
  'What this touches', 'Checks already run', stepper length = `CASE_STEPS.length`.
- DR-8.5 now asserts 'Waiting on a decision' (approved C4 wording) at
  RECOVERING + approval-PENDING.

## 7. Environment gotchas (Windows / PowerShell)

- Test runner is **`npm test`** (`node --test`, type-stripping) — NOT tsx,
  NOT vitest. `node --test --import tsx` fails with ERR_MODULE_NOT_FOUND.
- PowerShell: no `&&`/`||`; quote regex args.
- Multi-line commit messages: write to a file, `git commit -F file`, delete
  the file in a SEPARATE command (not same line).
- The git `post-commit` hook (qodercli) segfaults harmlessly — commits succeed.
- A terminal hang is not a code bug; reset the terminal once before retrying
  (see `.qoder/rules/environment-recovery.md`).

## 8. Invariants to respect

- Server-rendered HTML strings from pure functions of frozen read models; no
  framework; progressive-enhancement JS shim posts forms as JSON.
- Anti-hardcoding: no scenario/fixture/traveller/route branches in UI logic;
  demo facts live in `src/ui/fixtures/**`.
- UNKNOWN is valid and visible (`?`, never converted to certainty).
- Healthy = green, never grey; chromatic colour = state only.
- Do not modify engine/domain/contracts/provider code.

## 9. FX presentation wiring (when merging onto 244ea5b)

Do **not** collapse provider cost and home-currency restatement:

- Show `OptionView.providerCost` (provider amount + currency) when present.
- Show home-currency policy restatement / `costDelta` as a separate line.
- Intent surfaces: `intent.providerSpend` and `intent.spendExposure` stay
  conceptually distinct in operator option cards / approval panels.
- This older UI branch does not add those fields to contracts; keep option-card
  structure capable of two money lines once the integrator projects them.
