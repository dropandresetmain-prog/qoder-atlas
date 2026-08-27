# ACTIVE_TASK — Hero business-truth (Lane ownership)

**Branch:** `final/hero-business-truth`  
**Base:** `origin/main` @ `73c577b4956f9fc9045521adb787e83c9bb81887`  
**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`, `docs/SCENARIOS.md`, `docs/FINAL_DEMO_CONTENT_SSOT.md`  
**Ownership:** hero data / business-truth only (not CTA lifecycle, CSS/theme, broad NL copy)

## Gate rule

Check an item only after focused tests/runtime evidence pass. Prefer deterministic mapping for structured provider data. No demo-specific branches in generic planner/domain logic.

---

## Jonas S5

- [ ] Canonical Concorde baseline checkout is `2026-10-03T11:00:00+08:00` (programme + data pack aligned; no Oct-2 drift)
- [ ] Request/planning produces same-property **extend** Concorde → `2026-10-04T11:00:00+08:00` (not Switch to Value/Sakura/J8)
- [ ] Traveller-funded increment allocation remains TRAVELLER; organiser baseline unchanged
- [ ] After simulated execution, persisted Stay `placeId` remains `place-hotel-bayview` (Concorde)
- [ ] No return-flight change in closed S5 path
- [ ] Option card provider/funding/cost fields come from same-property Concorde evidence (honest amount; do not misattribute Value Hotel `US$223.94` as Concorde)

## Oliver S7

- [ ] Explicit LHR return intent preserved as structured constraint / not silently dropped
- [ ] Recommended offer remains proven direct HND→SIN at `US$143.62` / policy `S$193.89`
- [ ] `US$163.98` is not exposed as direct HND/NRT→SIN unless normalized segments prove it (connection HND→SGN→SIN → full routing or omit from primary)

## Jordan S2

- [ ] Viable reported TR885 is never called inadequate in executable fixtures/titles/pack claims
- [ ] Desired inadequate-provider contrast either uses an honest labelled external fixture (e.g. TR867) **or** keeps truthful “unverified until checked” story
- [ ] Closed path still ranks evidenced TR885-class recovery when that is the boardable inventory

## Sarah S1→S3

- [ ] Exact affected preview set established: Elena (`ait-draft-01`) + Sarah (`ait-draft-14`) only
- [ ] Daniel is not invented into blast-radius affected rows
- [ ] Presentation/read-model can resolve named identities + distinct consequences for the exact affected set (no duplicate generic-only rows as product truth)

## Investigate / close

- [ ] Jonas checkout drift root cause closed
- [ ] Jonas Stay.placeId after execution verified
- [ ] Provider/funding/cost fields option cards need are available from read-model/strategies

## Verification

- [ ] Focused S5/S7/S2/S1–S3 / planner / provider / read-model tests
- [ ] Typecheck / build at end
- [ ] Checkpoints committed and pushed

## Explicit non-ownership

Case CTA lifecycle · generic execution/reopen state · CSS/theme/layout · broad natural-language copy

## Interface Lane C may rely on

(filled as fixes land)

## Checkpoint log

| When | SHA | Note |
|------|-----|------|
| start | `73c577b` | Branch created; checklist opened |
