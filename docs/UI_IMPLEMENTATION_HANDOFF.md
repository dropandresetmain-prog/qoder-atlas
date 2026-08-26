# UI Implementation Handoff — Approved NORTHSTAR Screens

**Branch:** `lane/ui-approved-screens`
**Worktree:** `C:\Dev\qoder-atlas\.worktrees\ui-approved`
**Latest commit:** `508e05c` — ui: case workspace to approved C1-C6 two-column design
**State at handoff:** `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 635/635 pass; no known errors.

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
| s3 | done | `src/ui/theme.ts`: all approved components from `renders.css` merged (case-grid, case-rail, rail-card, option-card opt-*, why-not, check-row, stepper s-dot/s-line, chain lk-*, chip-cost/chip-saving, splitbar sp-org/sp-trav, feed/frow/f-glyph, t-topbar, itin-row, viab, thread/composer…) |
| s4 | done | `src/ui/page.ts`: approved topbar (event-select, nav + decisions count, replay pill, avatar) |
| s5 | done | Operator overview O1: hero readout (ink), flip-dot fleet grid, decisions queue, roster rows with mini-chains |
| s6 | done | Programme P1/P2 + intake + E1/E2 change preview (`5bbc73a`) |
| s7 | done | **Case workspace C1–C6** (`508e05c`): `screens/operator-case.ts` fully rewritten — page-head badge-in-h1, `.case-grid` + sticky `.case-rail`, chain-as-cards, 5-step stepper (C2 only: RECOVERING/PLANNING, no options, no pending approval, no resolution), check-rows (done/doing/queued/failed), option-cards (opt-head/opt-body/opt-flags/why-not + Recommended badge + UNKNOWN "Still being checked"), skeleton "Options take shape here", splitbar funding (ink org vs brass traveller) in approval panel, rejected-options view, resolution callout (tone by outcome, `data-outcome` preserved), "What changed" section on resolved cases, rail: ink commitment card + generic kv rail-sections + authority card. New optional view fields on `CaseDetailView`: `affected?`, `commitment?`, `railSections?`, `RecoveryOptionView.flags?`, `ActionProgressView.detail?` — rendered when present, never fabricated. Case copy block in `copy.ts` (CASE_* constants, `caseOptionsHeading`, `PAYER_LABEL`). |

## 4. What's left

1. **s8 — Decisions D1 + activity feed.** New renderers needed (no current
   screen). Classes already in theme: `feed`, `frow`, `f-glyph`, `feed-day`.
   Source data: operator dashboard read model decisions/activity; keep generic.
2. **s9 — Traveller T1–T7.** `src/ui/screens/traveller.ts` +
   `traveller-presentation.ts`: t-topbar, hero with kicker tones
   (`k-ok`/`k-bad`), itinerary as `itin-row` list, `viab` remainder-viability
   block (component exists in `components.ts`), `check-row` progress, message
   thread + composer treatment. States: healthy, disrupted, recovering,
   decision-needed, recovered, resolved-with-loss, loading/error.
3. **s10 — Fixtures/preview demo data** for the new optional CaseDetailView
   fields (`affected`, `commitment`, `railSections`, option `flags`, action
   `detail`) in `src/ui/fixtures/readmodels.ts`, so the preview generator and
   ui tests exercise them. Also traveller fixtures for new T1–T7 shapes.
4. **s11 — Verify:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, lint,
   build; then screenshot inspection of rendered preview pages against
   `shots/*.png` (playwright-core exists in node_modules).
5. **s12 — Push branch** (`git push -u origin lane/ui-approved-screens`) and
   final report: branch/SHA + the read-model gap list below.

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
- PowerShell: no `&&`/`||`; quote regex args (`git grep -e 'pat'`,
  `Select-String 'pat'`); pipes in patterns need quoting.
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
