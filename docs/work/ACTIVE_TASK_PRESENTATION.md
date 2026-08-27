# ACTIVE_TASK — final/hero-presentation

**Branch:** `cursor/hero-presentation-a602` (implements requested `final/hero-presentation` lane; Cloud PR policy requires `cursor/*-a602`)  
**Base:** `origin/final/hero-integration` @ `18fefc8`  
**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`, `docs/UI_VISUAL_DIRECTION.md`, `docs/recovered_ui/`  
**Constraint:** Do NOT change accepted domain/business semantics. Presentation/copy/visual only.

## Goal

Judge-facing presentation convergence: money/copy/options/progress/visual + hero-specific content projection driven by structured data (no hero-ID UI branches).

## Checklist

### SHARED

- [x] One currency convention: `US$` / `S$`, no bare `$`
- [x] Payable vs policy equivalent clearly separated
- [x] Payer explicit beside amount/action
- [x] Primary options show pros, cons, commitment effect, authority, provenance, defensible recommendation reason
- [x] Page-by-page natural-language rewrite (hero surfaces)
- [x] Remove HUMAN_AGENT / internal / process wording
- [x] Correct programme engagement wording (Scheduled etc.) — retained from integration
- [x] Remove raw IDs / ISO / system tags where judge-facing

### PROGRESS

- [x] Generic structured progress/transition from choreography contract
- [x] Hero-specific content from structured data, not hero-ID UI branches
- [x] Visibly distinguish planning, authority, execution, observation, state update
- [x] Presentation smoothing OK; do not imply literal live tool trace
- [x] Reduced motion preserved

### VISUAL

- [x] Recovered composition as structural baseline (case two-column / programme / traveller hero)
- [x] Close remaining Overview / Programme / Case / Traveller layout gaps (structural; no redesign)
- [x] Fix remaining programme dedup / bleeding issues (`.tl-affected` containment)
- [x] Restore Singapore CBD/dusk traveller hero visual (`/assets/sg-dusk.png`)
- [x] Readable typography per UI_VISUAL_DIRECTION
- [x] Meaningful hover/focus/transitions beyond one modal
- [x] No demo banner on judge-facing product pages

### SPECIFIC CONTENT (browser-proven)

- [x] Jordan: 14:35 arrival / 20:45 showcase / 370 vs 360 — `output/hero-presentation/04-jordan-options.png`
- [x] Sarah preview: human times + named/distinct blast radius — `05-sarah-programme-preview.png`
- [x] Oliver: Tokyo inbound replaces obsolete London inbound; LHR return preserved — `07-oliver-options.png`
- [x] Jonas: extend Concorde, Jonas pays personal increment, no flight changes — `09-jonas-options.png`

### VERIFICATION

- [x] Focused UI tests — 52 pass (`presentation-lane`, `final-ui-backend-wiring`, `ui`, `ui-programme`)
- [x] Typecheck — pass
- [x] Lint — pass
- [x] Build — pass
- [x] Final hero screenshots in `output/hero-presentation/` (10 shots, 19/19 capture checks)

## Explicit non-goals

- Do not merge main
- Do not self-certify final acceptance
- Do not reintroduce stale lifecycle state solved by integration branch
- Do not change domain/recovery/authority/funding semantics

## Findings triage

| Finding | Class | Notes |
|---------|-------|-------|
| Programme page still has residual composition density vs recovered P1/P2 | Park for Later | Reconciliation §13 parks full Programme visual overhaul; Sarah Now/Proposed is the stronger proof |
| Oliver trip-status inbound still shows current London until execute updates state | Ignore / Accept Risk | Options/approval correctly show HND→SIN replacement; authoritative chain updates after execution (integration-proven) |
| Activity full redesign | Park for Later | Per reconciliation; keep out of hero video |
| Capture traveller hero opened Elena Tan default rather than Jonas | Park for Later | Asset wiring proven (`sg-dusk.png`); hero-specific traveller deep-link polish optional |

## Evidence

| Item | SHA / path | Result |
|------|------------|--------|
| Presentation commit | `91d3608` + follow-ups | pushed |
| Screenshots | `output/hero-presentation/*.png` | 10 shots |
| Capture checks | `output/hero-presentation/evidence.json` | 19/19 ok |
| Focused tests | presentation + ui suites | 52 pass |
