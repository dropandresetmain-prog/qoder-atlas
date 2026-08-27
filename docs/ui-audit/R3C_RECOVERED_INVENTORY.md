# R3C — Recovered UI inventory

**Source:** `docs/recovered_ui/`  
**Preserved on:** `audit/r3c-recovered-ui-direction`  
**Count:** **23** HTML files · **22** design screens + **1** index catalog  
**Shared system:** `renders.css`; operator shell `max-width: 1180px`; traveller shell `max-width: 480px` (mobile-first)

Static names/counts/times/facts inside these HTML files are **illustrative only**. Runtime truth remains application read models + content/scenario SSOTs.

---

## Integrity notes

| Issue | Detail | Triage |
|-------|--------|--------|
| `p2-programme-disrupted.html` ≡ `p1-programme-healthy.html` | Byte-identical (same SHA-256). Filename claims disrupted programme; content is healthy. | Park for Later (R3C evidence note; do not invent a disrupted programme layout) |
| `c4-case-approval.html` ≡ `c3-case-options.html` | Byte-identical. Dedicated approval surface is missing from the recovered set. | Park for Later (use C3 for Case family; note missing approval layout) |
| `assets/sg-dusk.png` | AI-generated replacement; not recovered original | Ignore / Accept Risk (already labelled in pack README) |

---

## Per-file inventory

### Catalog / meta

| File | Purpose | Structural regions | Layout notes | Family |
|------|---------|--------------------|--------------|--------|
| `index.html` | Link catalog for all renders | page-head, index-list | 1-col sheet | none |
| `states.html` | Loading / degraded / empty / unknown reference | sheet-grid, skeletons, state-panels | desktop 2-col sheet | none |
| `intake.html` | Programme intake (upload / open on file) | intake-grid, dropzone | desktop 2-col → 1-col &lt;900px | adjacent to Programme |

### Operator screens

| File | Purpose | Structural regions | Layout notes | Family |
|------|---------|--------------------|--------------|--------|
| `o1-overview.html` | Ops overview after disruption — fleet + attention board | topbar, readout (ink + fleet), decisions queue, trip board + mini-chain | desktop 2-col readout | **Overview** |
| `p1-programme-healthy.html` | Normal programme — healthy, fortnight out | tiles, timeline, missing-info, traveller table, btn-row | 1-col stacked | **Programme** |
| `p2-programme-disrupted.html` | *Intended* disrupted programme; **duplicate of P1** | same as P1 | same as P1 | unusable as disrupted |
| `c1-case-disrupted.html` | Case just opened — blast radius + early checks | case-grid, callout, chain, checks, case-rail | 2-col case workspace | Case (partial) |
| `c2-case-checking.html` | Recovery in progress — stepper + live checks | stepper, case-grid, check-rows, skeleton options, rail | 2-col | Case (partial) |
| `c3-case-options.html` | Options on table — recommended / alt / rejected | option-cards, chain, case-rail (commitment / cost / next) | 2-col; densest options layout | **Case** |
| `c4-case-approval.html` | *Intended* approval; **duplicate of C3** | identical to C3 | identical | missing approval UI |
| `c5-case-escalation.html` | No safe automatic fix — rejected + next paths | callout, rejected options, alt-rows, rail | 2-col | Case (partial) |
| `c6-case-recovered.html` | Recovered case — whole trip confirmed | success callout, chain, what-changed, rail | 2-col; calmer | Case (partial) |
| `d1-decisions.html` | Who Northstar is waiting on / recently decided | Waiting now + Decided recently tables | 1-col; wide tables | **Decisions** |
| `activity.html` | Plain-language audit trail | feed, day headers, glyph rows | 1-col chronological | **Activity** |
| `e1-change-preview.html` | Programme change preview — mutation-free modal | dimmed programme + modal-scrim + modal (compare / impact / alts) | modal over desktop shell | **Programme change** |
| `e2-after-commit.html` | After commit — fan-out + disrupted programme chrome | callout, tiles, endangered, timeline, affected table | best available disrupted programme layout | Programme change (E2) / disrupted Programme |

### Traveller screens (mobile-first)

All use `.traveller-shell` (`max-width: 480px`) + `.t-topbar` + composer.

| File | Purpose | Structural regions | Density | Family |
|------|---------|--------------------|---------|--------|
| `t1-ready.html` | Healthy “am I okay?” | t-hero, commit-card, itinerary | sparse | Traveller (healthy) |
| `t2-disrupted.html` | Disruption explained + recovery underway | hero, what-changed, commit-card, viab, checks | medium-high | Traveller (strong alt) |
| `t3-checking.html` | Options scoring — nothing needed yet | hero, checks, skeleton options | recovering | Traveller (partial) |
| `t4-choice.html` | Decision moment — two options + CTAs | hero, choice-form / optcards, t-btn | highest interactive | **Traveller** |
| `t5-need-info.html` | One known-vs-unknown question | hero, known itinerary, question | decision-lite | Traveller (partial) |
| `t6-recovered.html` | Payoff — all set | hero, ok commit, viab, itinerary | post-recovery | Traveller (end) |
| `t7-thread.html` | Full arc as chat | thread messages, composer (no hero) | conversation | Traveller (variant) |

---

## R3C representative selection (seven families)

| # | Family | Recovered file | Why |
|---|--------|----------------|-----|
| 1 | Overview | `o1-overview.html` | Only O1-style overview; readout + fleet + queue + board |
| 2 | Programme | `p1-programme-healthy.html` | Canonical normal programme; P2 unusable (duplicate) |
| 3 | Case | `c3-case-options.html` | Richest single file for options + recommendation + rail + chain |
| 4 | Decisions | `d1-decisions.html` | Sole decisions surface |
| 5 | Activity | `activity.html` | Sole activity feed |
| 6 | Traveller | `t4-choice.html` | Mobile-first decision state denser than healthy T1; viewport **430×932** |
| 7 | Programme change | `e1-change-preview.html` | Distinctive mutation-free preview modal (E1) |

**Also available if needed later:** `e2-after-commit.html` for post-commit / disrupted programme chrome; `t2-disrupted.html` as traveller alternate.
