# ACTIVE_TASK — Sarah S1→S3 production UI stabilisation

## Goal

Close integrated production UI gaps for Sarah S1→S3 and shared Overview presentation, using generic components only.

## Base / branch

- Base SHA: `4de3bf9a0dc3149eac49ad1c410ad1d94b6dabe5`
- Branch: `main`
- Production: https://qoder-atlas-production.up.railway.app

## Root-cause groups

| ID | Scope |
|----|--------|
| RC-1 | Overview shared-incident presentation |
| RC-2 | Overview roster layout |
| RC-3 | Case narrative copy |
| RC-4 | Programme-recovery lifecycle S-04→S-06 |
| RC-5 | Chain/mini-chain viability semantics |
| RC-6 | Programme preview modal E1 flow |
| RC-7 | Internal language cleanup |

## Implementation checklist

### Phase 1 — Overview (RC-1, RC-2)
- [x] Shared incident header: amber callout, non-clickable
- [x] Child rows nested; sorted critical → watching → workable
- [x] Outcome glyph/tone from shared outcome
- [x] Roster issue text wraps; status column stable

### Phase 2 — State semantics (RC-5)
- [x] NOT_VIABLE open case: transport/commitment not green when threatened
- [x] chainPresentation.ts + readmodels async constraint context
- [ ] Overview mini-chain agrees with case page (verify visually)

### Phase 3 — Lifecycle (RC-4)
- [x] Programme cases show travel-analysis CTA before programme recommendation
- [x] ~3s overlay choreography via case-resolution-interaction
- [x] sessionStorage stage advance; recommendation panel client reveal

### Phase 4 — Programme preview (RC-6)
- [x] E1-style Now/Proposed when proposal prefilled
- [x] Preview disabled until commitment loaded; human error text
- [x] ~3s staged preview processing overlay
- [x] In-app commit confirmation; no window.confirm

### Phase 5 — Copy (RC-3, RC-7)
- [x] presentDisruptedCaseSummary for whatChanged
- [x] Human checks title; human signal labels
- [x] Overlay execution labels humanized; pacing disclaimer removed

### Acceptance
- [ ] Focused tests pass
- [ ] Build/typecheck pass
- [ ] Local screenshots captured
- [ ] Railway Sarah S1→S3 path passes Section G checklist
- [ ] Jordan / Jonas / Oliver spot-check

## Current checkpoint

Committed `3beb0bf`, pushed to `origin/main`. Railway Sarah acceptance PASS.

## Next action

Investigate Jordan `el-trip-` terminal copy leak (pre-existing regression).

## Constraints

- No Sarah/demo-specific branches in domain or generic UI
- Provider booking status ≠ journey viability in presentation
- sessionStorage only for choreography stage within a case visit
