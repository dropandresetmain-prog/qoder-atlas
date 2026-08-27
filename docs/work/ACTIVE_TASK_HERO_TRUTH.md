# ACTIVE_TASK — Hero business-truth (Lane ownership)

**Branch:** `final/hero-business-truth`  
**Base:** `origin/main` @ `73c577b4956f9fc9045521adb787e83c9bb81887`  
**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`, `docs/SCENARIOS.md`, `docs/FINAL_DEMO_CONTENT_SSOT.md`  
**Ownership:** hero data / business-truth only (not CTA lifecycle, CSS/theme, broad NL copy)

## Gate rule

Check an item only after focused tests/runtime evidence pass. Prefer deterministic mapping for structured provider data. No demo-specific branches in generic planner/domain logic.

---

## Jonas S5

- [x] Canonical Concorde baseline checkout is `2026-10-03T11:00:00+08:00` (programme + data pack aligned; no Oct-2 drift)
- [x] Request/planning produces same-property **extend** Concorde → `2026-10-04T11:00:00+08:00` (not Switch to Value/Sakura/J8)
- [x] Traveller-funded increment allocation remains TRAVELLER; organiser baseline unchanged
- [x] After simulated execution, persisted Stay `placeId` remains Concorde (`place-hotel-bayview` via same-property strategy; summary names Concorde)
- [x] No return-flight change in closed S5 path
- [x] Option card provider/funding/cost fields come from same-property Concorde evidence (`US$541.83` / policy `S$731.47`; Value Hotel `US$223.94` no longer misattributed)

## Oliver S7

- [x] Explicit LHR return intent preserved as structured `preserveReturnDestination` / no unverified-terminus uncertainty when home return matches
- [x] Recommended offer remains proven direct HND→SIN at `US$143.62` / policy `S$193.89` (summary: `Rebook HND→SIN (direct)…`)
- [x] `US$163.98` exposed as `HND→SGN→SIN (1 stop)` — not as direct HND/NRT→SIN

## Jordan S2

- [x] Viable reported TR885 is never called inadequate in executable fixtures/titles/pack claims
- [x] Desired inadequate-provider contrast kept honest: retain reported TR885; TR867 remains the failing late inventory alternative; presentation seam = reported/unverified until whole-trip checks
- [x] Closed path still ranks evidenced TR885-class recovery (S2 acceptance PASS)

## Sarah S1→S3

- [x] Exact affected preview set established: Elena (`ait-draft-01`) + Sarah (`ait-draft-14`) only
- [x] Daniel is not invented into blast-radius affected rows
- [x] Presentation/read-model can resolve named identities (`travellerNames`) for the exact affected set

## Investigate / close

- [x] Jonas checkout drift root cause closed (data-pack Oct-2 vs programme Oct-3; pack aligned)
- [x] Jonas Stay.placeId after execution verified (same-property strategy keeps Concorde place; S5 acceptance RESOLVED/VIABLE)
- [x] Provider/funding/cost fields option cards need are available from strategies/intents (`costImpact`, `providerCost`/`costDelta`, `costAllocation`)

## Verification

- [x] Focused S5/S7/S2/S1–S3 / planner / provider / read-model tests
- [x] Typecheck / build at end
- [x] Checkpoints committed and pushed

## Explicit non-ownership

Case CTA lifecycle · generic execution/reopen state · CSS/theme/layout · broad natural-language copy

## Interface Lane C may rely on

| Surface | Contract |
|---------|----------|
| Hotel strategies | Same-property extension summaries `Extend stay at {name} through {YYYY-MM-DD} — {amount} {ccy}`; switches remain `Switch stay to …` |
| Hotel REPLAY | hotel-id searches filter to requested `nuitee-hotel-id` only |
| S5 money | Concorde REPLAY provider `USD 541.83`; FX home `SGD 731.47`; allocation `incrementalPayer: TRAVELLER` |
| Flight strategies | Summaries include normalized route + `(direct\|N stop(s))`; sort prefers fewer segments then price |
| ChangeRequest | optional `preserveReturnDestination: { system, value }` |
| NL intake | Origin substitution extracts `return to XXX` → `preserveReturnDestination` |
| Programme preview | `affected[].travellerNames: string[]` alongside `travellerIds` / `reasons` |
| Sarah blast radius | Exact set `{ Elena Tan / ait-draft-01, Sarah Lim / ait-draft-14 }` — do not invent Daniel |

## Simulation seams retained

| Seam | Why |
|------|-----|
| S2 progressive delay + traveller report | Labelled `SIMULATED_EXTERNAL_EVENT`; TR885 remains reported reprotection, not falsely inadequate |
| S5/S7 provider execution | Simulated at provider boundary after real authority; disclosed in acceptance |
| S1 schedule-change ingress | Labelled simulated source event; preview/commit remain real |

## Checkpoint log

| When | SHA | Note |
|------|-----|------|
| start | `73c577b` | Branch created; checklist opened |
| impl-1 | `c69153d` | Core planner/fixture/truth fixes |
| close | _(this commit)_ | Authority traveller-funded hotel path; checklist closed |
