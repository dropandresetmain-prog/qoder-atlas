# R3C — Screen-by-screen comparison

**Commit SHA at capture:** product baseline `d0520ba` (`origin/main`); branch head after preserve `28e1719` (+ later audit docs commit).  
**Capture tooling:** `scripts/r3c-ui-audit-capture.mjs` + `scripts/r3c-ui-audit-compose.mjs`  
**Runtime:** isolated `:memory:` SQLite · `adapterMode: REPLAY` · `POST /api/demo/reset` before captures  
**Evidence dir:** `output/r3c-ui-audit/` (uncommitted scratch) · durable contact sheet: `docs/ui-audit/R3C_SIDE_BY_SIDE_CONTACT_SHEET.png`

**Ignore for visual parity:** traveller names, 67/42/25 counts, statuses, costs, flights, suppliers, times, option counts, provenance labels — unless presentation/hierarchy itself is the issue.

Recommendations below are **advisory only**. Do not treat them as a freeze.

---

## Mapping summary

| Family | Recovered HTML | Current route / state | Viewport |
|--------|----------------|----------------------|----------|
| Overview | `o1-overview.html` | `/operator?event=evt-ait-2026` after reset | 1440×1000 |
| Programme | `p1-programme-healthy.html` | `/programme?event=evt-ait-2026` | 1440×1000 |
| Case | `c3-case-options.html` | Jordan Hale S2 case via Overview row click | 1440×1000 |
| Decisions | `d1-decisions.html` | `/decisions?event=evt-ait-2026` | 1440×1000 |
| Activity | `activity.html` | `/activity?event=evt-ait-2026` | 1440×1000 |
| Traveller | `t4-choice.html` | `/traveller?trip=trip-trv-evt-ait-2026-ait-draft-09` (Jordan) | 430×932 |
| Programme change | `e1-change-preview.html` | Sarah Lim case → Preview programme change → fill S3 reschedule → Preview | 1440×1000 |

**Images:** `output/r3c-ui-audit/{recovered,current,compare}-<family>.png`

---

## 1. Overview

| Field | Value |
|-------|-------|
| Recovered source | `o1-overview.html` |
| Current route | `/operator?event=evt-ait-2026` |
| Runtime state | Populated demo world after `POST /api/demo/reset` |
| Viewport | 1440×1000 (full-page shots) |
| Setup | Boot REPLAY in-memory → reset → goto overview |
| SHA | product `d0520ba` |

**Hierarchy:** Same scaffold — page-head → two-col readout (ink + fleet) → decisions queue → roster board. Current adds demo banner, Reset control, roster search, “Show interaction”, Confirmed vocabulary + scale line, local/unconfirmed fleet cells.

**Typography:** Same stacks; current body/page H1 larger (16/28 vs 15/24). Roster name/issue ~+1–1.5px.

**Spacing/density:** Current roster is longer (full populated world vs illustrative ~10 attention rows) — content volume, not layout family change. Row hover lift + actionable links.

**Surface/colour:** Shared tokens. State colours inherited. Fleet legend extended (Local / Unconfirmed).

**Missing vs recovered:** Recovered mini-chain uses state glyphs; current uses element-type icons at larger size.

**Extra vs recovered:** Demo banner, search, Show interaction, scale/Confirmed readout copy.

**Motion:** Shared stagger / settle / breathe; current reduced-motion kills wash.

**Ignore:** Exact 59/67 vs 38–42/67 style counts; names; which trips appear.

**Provisional recommendation:** **HYBRID** — keep current factual readout/fleet semantics; recover tighter density + glyph clarity where useful.

---

## 2. Programme

| Field | Value |
|-------|-------|
| Recovered source | `p1-programme-healthy.html` (note: `p2` is byte-identical — unusable as disrupted) |
| Current route | `/programme?event=evt-ait-2026` |
| Runtime state | Populated programme |
| Viewport | 1440×1000 |
| Setup | After reset (same world) |

**Hierarchy:** Same stacked order — tiles → timeline → gaps → traveller table → action row. Current tile vocabulary is managed-travel / on-track / watching / recovery / awaiting / planning vs recovered Ready/Unconfirmed.

**Typography / density:** Shared; current table rows taller (Show interaction under names); table-scroll chrome.

**Missing:** Recovered “Missing traveller information” panel may be empty/absent when no gaps — content-dependent.

**Extra:** Demo banner; Show interaction; Message affected travellers in btn-row; programme-scale banner.

**Ignore:** Timeline length, tile counts, status badge text reflecting live disruption vs healthy fixture story.

**Provisional recommendation:** **HYBRID** — inherit shell; decide tile vocabulary + missing-info prominence in R3D.

---

## 3. Case

| Field | Value |
|-------|-------|
| Recovered source | `c3-case-options.html` |
| Current route | `/operator/cases/...ait-draft-09...` (Jordan Hale / S2) |
| Runtime state | Populated S2 entry — options / approval pending |
| Viewport | 1440×1000 |
| Setup | Overview → click Jordan Hale row |

**Hierarchy:** Both two-col `.case-grid` + sticky rail. Recovered C3 is options-first then chain. Current inserts Trip status / primary-action / approval panel / checks / affected before or around options — denser workflow stack. Rail: ink commitment card shared; current rail sections more list-like.

**Typography / surfaces:** Shared option-card / recommended / rejected / why-not vocabulary. Current shows more rejected options (runtime count — ignore) and stronger primary-action yellow panel.

**Missing vs recovered C3:** Compact horizontal journey-chain footer presentation may be less prominent amid taller workflow stack.

**Extra:** Demo banner; primary-action / planning / funding / checks / “What this touches”.

**Note:** Recovered `c4-case-approval.html` is a duplicate of C3 — no separate approval layout in pack.

**Provisional recommendation:** **HYBRID** — keep workflow/action clarity from current; recover options visual hierarchy density from C3 where it aids scanning.

---

## 4. Decisions

| Field | Value |
|-------|-------|
| Recovered source | `d1-decisions.html` |
| Current route | `/decisions?event=evt-ait-2026` |
| Runtime state | Populated pending decisions |
| Viewport | 1440×1000 |

**Hierarchy:** Near-clone — Waiting now + Decided recently tables. Column rename: recovered `EXPIRE BY` → current `DECIDE BY`.

**Typography / surfaces:** Shared. Current may show empty “Decided recently” (runtime — ignore). Nav count badge present both.

**Extra:** Demo banner.

**Provisional recommendation:** **CURRENT** (or **HYBRID** if recovering decided-recently presentation polish) — structure already inherited.

---

## 5. Activity

| Field | Value |
|-------|-------|
| Recovered source | `activity.html` |
| Current route | `/activity?event=evt-ait-2026` |
| Runtime state | Populated activity feed |
| Viewport | 1440×1000 |

**Hierarchy:** Shared `.feed` / day headers / glyph rows. Current feed much longer (runtime volume — ignore).

**Typography / surfaces:** Inherited. Identity/provenance copy quality is an R3D content concern, not a missing CSS family.

**Extra:** Demo banner.

**Provisional recommendation:** **CURRENT** for shell; content/noise cleanup is R3D, not direction freeze.

---

## 6. Traveller

| Field | Value |
|-------|-------|
| Recovered source | `t4-choice.html` (richest decision structure; mobile-first) |
| Current route | `/traveller?trip=trip-trv-evt-ait-2026-ait-draft-09` |
| Runtime person | Jordan Hale (S2 entry) |
| Runtime state | **Recovery under way** — not a choice moment |
| Viewport | **430×932** both |

**Hierarchy:** Shared traveller-shell / t-topbar / dark hero / commit-card / t-cards / composer. State mismatch: recovered shows choice optcards + dual CTAs; current shows what-changed itinerary + progress (“Nothing needed from you yet”) + composer. **Do not treat missing choice cards as a design defect** — Jordan entry is not in traveller-choice state. For choice UI specifically, compare recovered T4 to a future S5/S2 post-offer state in R3D.

**Typography:** Serif hero H1 + mono kickers shared.

**Surface:** Recovered hero uses dusk image; current hero is solid ink (image not presented) — design presentation gap for R3D (`sg-dusk.png` is AI replacement, not original).

**Extra:** Demo banner on traveller surface.

**Provisional recommendation:** **HYBRID** — keep shell; restore hero imagery treatment + choice nesting from recovered when state warrants; confirm CTA pattern vs form buttons.

---

## 7. Programme change

| Field | Value |
|-------|-------|
| Recovered source | `e1-change-preview.html` |
| Current route | Sarah Lim case + `[data-programme-change-modal]` |
| Runtime state | S1→S3 preview: commitment `cmt-ait-d1-headline-interview` reschedule filled; Preview clicked |
| Viewport | 1440×1000 |
| Setup | Reset → Overview → Sarah → Preview programme change → fill fields → Preview |

**Hierarchy:** **Material difference.** Recovered: Now/Proposed `.change-compare` cards + impact rows + alternatives + Confirm/Cancel over dimmed programme. Current runtime: form fields (commitment/kind/start/end/place) + impact summary + Preview/Commit/Cancel; no Now/Proposed compare. SSOT helper `renderProgrammeChangePreview` still matches recovered DOM; live path uses `programme-change-interaction.ts`.

**Typography / surfaces:** Modal chrome / banner / AT RISK pills shared language.

**Provisional recommendation:** **RECOVERED** (or **HYBRID**) for the compare presentation; keep form entry if needed as a prior step — human must decide.

---

## Cross-cutting issues (triage)

| Issue | Classification | Why |
|-------|----------------|-----|
| Runtime programme-change ≠ E1 compare modal | Park for Later → R3D input | Design direction decision required |
| Traveller hero image absent on current | Park for Later → R3D | Presentation gap; `sg-dusk.png` is AI replacement |
| Recovered `p2`/`c4` duplicates | Park for Later | Pack integrity; do not invent missing layouts |
| Overview mini-chain icon language | Park for Later → R3D | Type icons vs state glyphs |
| Density/type scale-up (16/28 vs 15/24) | Park for Later → human gate | Intentional product readability vs recovered canvas |
| Demo banner on all current shots | Ignore / Accept Risk for R3C | Demo-only chrome; not design-system core |
| Wrong traveller trip on first capture attempt | Act Now (fixed) | Recaptured Jordan `draft-09`; script updated |
| Full-suite regression | Ignore | Out of R3C scope |

---

## Advisory direction matrix (not frozen)

| Family | Provisional |
|--------|-------------|
| Overview | HYBRID |
| Programme | HYBRID |
| Case | HYBRID |
| Decisions | CURRENT |
| Activity | CURRENT |
| Traveller | HYBRID |
| Programme change | RECOVERED / HYBRID |

Human owner decides screen-by-screen after reviewing contact sheet.
