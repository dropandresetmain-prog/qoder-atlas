# R3C — Code / design-system comparison

**Scope:** CURRENT HEAD `src/ui/**` vs `docs/recovered_ui/` (`renders.css` + representative HTML).  
**Baseline SHA at capture branch start:** `d0520ba0f95a69e20bdf6cfb5a1e389d5ab4cdf2` (`origin/main`)  
**Not in scope:** worktrees, product-code fixes, freezing visual direction.

Static recovered content (names, counts, flights) is **illustrative**. This report compares **design implementation**, not fake-data equality.

---

## Verdict

**Mixture, weighted toward inheritance.**

The current product UI is **mostly the recovered design system with additive product/runtime layers**, not a wholesale redesign. Shared CSS variables, operator shell, two-column case workspace, traveller concierge register, and core component classes (`.readout`, `.case-grid`, `.option-card`, `.feed`, `.t-hero`, `.optcard`, modal/E1 scaffold) are the same lineage.

What often *looks* like divergence in demos is **runtime projection/content**, not a replaced visual language. True design-implementation drift concentrates in:

1. **Density / type scale** — body `16px/1.55` vs recovered `15px/1.5`; page H1 `28px` vs `24px`; roster/queue ~+1px; mini-chain rewritten from state glyphs to element-type icons at larger size.
2. **Product-only chrome** on the same scaffolds — demo banner/controls, roster search, “Show interaction”, local/unconfirmed fleet cells, planning-progress UI, primary-action panel.
3. **Runtime programme-change modal** (`programme-change-interaction.ts`) — **materially different** from recovered `e1-change-preview.html` / SSOT `renderProgrammeChangePreview` (form-driven vs Now/Proposed compare).

**Bottom line:** treat current `src/ui` as **the same design-system lineage as `docs/recovered_ui`**, with **density + product-runtime overlays** — except the **live programme-change interaction**, which is a different UI than the recovered E1 render.

---

## Classification matrix

| Family | Classification |
|--------|----------------|
| Design tokens (`:root`) | **SUBSTANTIALLY SAME / INHERITED** |
| Motion primitives + reduced-motion | **PARTIALLY DRIFTED** |
| Operator topbar / page shell | **SUBSTANTIALLY SAME / INHERITED** |
| Overview | **PARTIALLY DRIFTED** |
| Programme | **PARTIALLY DRIFTED** |
| Case | **PARTIALLY DRIFTED** |
| Decisions | **SUBSTANTIALLY SAME / INHERITED** |
| Activity | **SUBSTANTIALLY SAME / INHERITED** |
| Traveller | **PARTIALLY DRIFTED** |
| Programme-change SSOT render helper | **SUBSTANTIALLY SAME / INHERITED** |
| Programme-change **runtime** script | **MATERIALLY DIFFERENT** |
| Recovered contact-sheet / index (`.sheet`, `.index-list`) | **MISSING** in product (catalog-only; not an operator gap) |

---

## A) Design tokens

### Matching (identical)

| Token | Value |
|-------|-------|
| `--bg` | `#F2F4F5` |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F8F9FA` |
| `--ink` / `--paper` / `--paper-warm` | `#14171C` / `#F5F6F7` / `#F4F0E6` |
| `--text` / soft / faint | `#14171C` / `rgba(20,23,28,0.62)` / `0.42` |
| `--border` / `--line-soft` | `0.13` / `0.07` alpha ink |
| State palette `--ok*` `--watch*` `--alert*` `--active*` `--neutral*` | identical hex sets |
| Font stacks | Segoe UI Variable / Cascadia / Georgia serif |
| `--radius` | `14px` |
| `--shadow` | shared multi-layer soft shadow |
| `--ease-out` | `cubic-bezier(0.2, 0.7, 0.2, 1)` |
| `.shell` | `max-width: 1180px`; padding `28px 24px 64px` |
| Traveller shell | `max-width: 480px` |

### Drifted / additive

| Item | Recovered | Current |
|------|-----------|---------|
| `body` font-size / line-height | `15px` / `1.5` | `16px` / `1.55` |
| `--done*` aliases | absent (tone-done uses `--ok*`) | present (= ok palette) |
| `.page-head` margin-bottom | `20px` | `22px` |
| `.page-head h1` | `24px` | `28px` |
| `.q-name` / `.b-name` | `14px` | `15.5px` |
| `.q-issue` / `.b-issue` | `13.5px` | `14.5px` |
| `.mini-chain` | mono `11px`, state glyphs | sans `16px`, type icons ✈⇄⌂✦ |

**Tokens:** SUBSTANTIALLY SAME / INHERITED (palette intact; density scaled up).

---

## B) CSS structure

| Metric (approx.) | Count |
|------------------|------:|
| Current `theme.ts` selectors | ~568 |
| Recovered `renders.css` selectors | ~397 |
| Shared | ~381 |

**Shared spine:** tokens; motion (`.stagger`, `.dotgrid`, `.big-settle`, `.just-changed`); topbar/nav; shell/page-head; cards/badges; readout/fleet; queue/board; chain; stepper; option-cards; case-grid/rail; tiles/timeline/table; modal/preview; feed; traveller register; `@media (max-width: 900px)`.

**Only recovered:** `.sheet` / `.sheet-grid` / `.index-list`; reduced-motion rule that **freezes** `.just-changed` wash for static renders.

**Only current (material):** demo banner/controls/reset; fleet `.d-local` / `.d-unconfirmed`; roster search; actionable row links + hover lift; `.section-primary-action` / planning / funding; table-scroll; `@media (max-width: 720px)` product floor; richer focus-visible.

**Material shared-selector drifts:** body/page/roster type; brow/qrow hover transform; `.btn` interactive (`pointer`, min-height); reduced-motion kills wash in current (recovered preserves tint).

Do **not** treat a CSS selector-overlap percentage as precision proof of visual parity — shared selectors can still render differently via DOM order and content.

---

## C) DOM / component structure

### Topbar / shell — SUBSTANTIALLY SAME
Brand ✦Northstar · event-select · Overview / Programme / Decisions(+count) / Activity · replay-pill + avatar. Case pages keep Overview active. Traveller pages omit operator chrome.

### Overview — PARTIALLY DRIFTED
Same columns: page-head → two-col readout → decisions queue → roster board. Drift: “Managed travel readiness” + Confirmed word + scale line; local/unconfirmed fleet cells; searchable roster; “Show interaction”; actionable rows; larger mini-chain type icons.

### Programme — PARTIALLY DRIFTED
Same stacked order: tiles → timeline → gaps → traveller table → actions. Drift: managed-travel first tile / scale banner; table-scroll; Show interaction; dynamic awaiting/planning tiles. Note: recovered `p2` is a duplicate of `p1` — disrupted programme chrome better shown by `e2-after-commit.html`.

### Case — PARTIALLY DRIFTED
Same two-col `.case-grid` + sticky `.case-rail`. Option cards / chain / rail inherited. Product inserts primary-action panel, planning/recovery forms, funding, checks, affected — hierarchy may differ from static C3 options-first narrative.

### Decisions — SUBSTANTIALLY SAME
Waiting now + Decided recently tables with same class vocabulary.

### Activity — SUBSTANTIALLY SAME
`.feed` day headers + glyph rows (`fg-signal|work|ask|done|info`).

### Traveller — PARTIALLY DRIFTED
Same mobile-first shell / hero / commit-card / viab / optcard / composer. Drift: choice nesting inside `.t-card` + form vs recovered root `.choice-form` + separate `.t-btn`s; hero image presentation-dependent.

### Programme change
| Path | Classification |
|------|----------------|
| Recovered `e1-change-preview.html` | Now/Proposed `.change-compare` modal over dimmed programme |
| Current `renderProgrammeChangePreview` | Same modal DOM contract |
| Current runtime `programme-change-interaction.ts` | **MATERIALLY DIFFERENT** — form fields; no `.change-compare`; “What-if check…” framing |

---

## D) Interaction / motion

| Behavior | Recovered | Current |
|----------|-----------|---------|
| Entry stagger | `.stagger` / `.dotgrid` | used on dashboard / programme / activity |
| Count settle | `.big-settle` | same on overview big number |
| Numeric count tween | absent both | absent |
| Change wash | `.just-changed` | programme rows when keys set |
| Reduced motion | kill anim; **keep** wash | kill **all** including wash |
| Hover / focus | lighter | product polish + focus-visible |
| Live breathe | `.fc-live::before` | same |

**Classification:** PARTIALLY DRIFTED.

---

## Explicit answer

**Is the current UI mostly the recovered design with bad runtime projection/content, or has its design implementation materially diverged?**

- **Mostly recovered design (inherited)**, with projection/content amplifying perceived gaps — Decisions, Activity, Case grid/rail/option-card/chain, Traveller shell CSS, token/shadow/radius system.
- **Partially drifted design implementation** — body/page/roster density, mini-chain language, overview readout structure, programme tile vocabulary, traveller choice nesting, hover/focus, reduced-motion wash.
- **Materially diverged** — **runtime programme-change modal** vs recovered E1.
- **Missing in product** — recovered contact-sheet/index only (not an operator/traveller product gap).
- **Additive supersets** — demo chrome, planning UI, roster search, Show interaction, local fleet cells.

R3C must not freeze direction here; the human owner decides RECOVERED / CURRENT / HYBRID per family after side-by-side evidence.
