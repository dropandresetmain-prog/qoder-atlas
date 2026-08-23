# Northstar Design System

Reference for anyone adding screens or components. The implementation lives in
`src/ui/theme.ts` (single inlined stylesheet, no build step); this document is
the *why* and the binding rules. When the two disagree, treat it as drift and
fix one side deliberately.

## 1. Product feeling

Northstar is **the calm, slightly obsessive fixer**. Two registers, one system:

- **Operator surfaces** feel like a *glass cockpit*: light, dense, tabular.
  Density is respect — the operator should be caught up in ten seconds. The
  product is ahead of them. Deciding is safe because every option carries its
  trade-offs.
- **Traveller surfaces** feel like a *concierge desk*: warm, minimal, one thing
  at a time, real photography, serif headlines. Someone competent has me.
  Nothing is sprung on me; I am asked, not notified.

Both registers share one surface language, one state palette, one type stack.

## 2. Colour

### 2.1 Neutral base ("cockpit daylight")

| Token | Value | Use |
|---|---|---|
| `--ns-bg` | `#F2F4F5` | page background (cool blue-grey fog) |
| `--ns-surface` | `#FFFFFF` | cards, panels |
| `--ns-surface-2` | `#F8F9FA` | recessed areas inside cards |
| `--ns-ink` | `#14171C` | primary text; the single dark punctuation object per screen |
| `--ns-paper` | `#F5F6F7` | text on ink |
| `--ns-paper-warm` | `#F4F0E6` | warm white, only inside ink objects |
| `--ns-line` | `rgba(20,23,28,.13)` | hairlines |
| `--ns-line-soft` | `rgba(20,23,28,.07)` | faint dividers |

No warm base tones. Warmth enters only through brass accents (below) and
traveller photography.

### 2.2 State palette — colour means *state*, never decoration

Chromatic colour is reserved for state. Interactive but neutral elements
(links, buttons, hover) stay in ink/grey. Four state hues, each with a text
variant (`-t`, for light backgrounds) and a fill variant (`-f`, for dots and
glyphs):

| Hue | Text | Fill | Meaning |
|---|---|---|---|
| Green | `#2F6B47` | `#4C9A6E` | **Confirmed, healthy, done.** The default state of anything that is booked and verified. |
| Brass | `#96670F` | `#D9A24A` | **Proposed, waiting, changed, needs eyes.** Awaiting a decision, a reply, or a confirmation; an option on the table; a value that just changed. |
| Vermilion | `#C2431A` | `#E0521F` | **Broken, blocked, decide now.** A component that no longer works; a case that cannot proceed without a human. |
| Grey | `#6B7280` | `#C6CBD2` | **Unknown, missing, unbooked.** Not "fine" — absent or unverified. |

Binding rules (user-directed, do not regress):

1. **A trip component with no problem is green, never grey.** Grey means the
   component is missing, unbooked, or unverifiable. Rendering a healthy
   booking grey is a bug.
2. **Grey is never a status of confidence.** `UNKNOWN` is rendered as grey
   *plus* an explicit `?` glyph or "unconfirmed" label — colour alone never
   carries the meaning.
3. **Brass is the only warm accent.** It marks proposals, pending human input,
   and freshly changed values. It never paints large surfaces.
4. **Vermilion is spent only on things that need a human now.** If everything
   on a screen is vermilion, the palette has failed — re-express severity
   through ordering and copy first.
5. **Ink is a state too**: it means *the system is working on it* (recovery
   under way, planning in progress) — active but not alarming.

### 2.3 Status → tone mapping

The `StatusTone` buckets in `src/ui/copy.ts` map onto the palette:

| Tone | Hue | Used for statuses |
|---|---|---|
| `ok`, `done` | green | `READY`, `RESOLVED` |
| `watch` | brass | `AT_RISK`, `NEEDS_TRAVELLER_INFO` |
| `alert` | vermilion | `DISRUPTED` |
| `active` | ink | `RECOVERING`, `PLANNING`, `CHANGE_REQUESTED` |
| `neutral` | grey | `UNKNOWN` |

"Decisions needed" counts/rows use vermilion when > 0: an undecided decision
blocks recovery, so it is the strongest signal on the page.

### 2.4 The ink punctuation object

Each screen may contain **at most one** ink-dark object. It is the anchor the
eye lands on first:

- Operator overview: the fleet readout (`34/42 on track`).
- Case view: none — the chain carries the story (the page already has one
  strong object if the traveller commitment card is shown; prefer the chain).
- Traveller: the commitment card ("the thing that must not be missed").

Everything else stays on the light surface.

## 3. Typography

Three clearly separated tiers — the failure mode to avoid is "section header
looks like body text".

| Tier | Spec | Use |
|---|---|---|
| Display | mono, 56–78px, 600 | the readout number |
| H1 | sans 24px / 700 | page title |
| Section title | **sans 17px / 650**, sentence case | "Decisions needed", "The trip as it stands" |
| Card title | sans 15px / 650 | option titles, traveller names |
| Body | sans 15px / 400–500, line-height 1.5 | prose |
| Meta / label | **mono 11px / 600**, uppercase, +0.08em tracking, dim | column labels, timestamps, badges |
| Data | mono, tabular-nums | times, counts, flight numbers |

Rules:

- **Section titles are sans, 17px, semibold.** Never set them in the 11px mono
  label style — that tier is for metadata only.
- Mono is for *data and labels*, sans for *sentences*, serif (Georgia stack)
  only for traveller-facing headlines.
- Numerals in data contexts use `font-variant-numeric: tabular-nums`.

## 4. Signature components

### 4.1 Fleet dot grid (operator overview)

One cell per traveller, sorted by urgency. Fill by status group:
green (ready/resolved) · brass (at risk / waiting on someone) · vermilion
(disrupted) · ink (system working) · hollow grey (unknown/unbooked).
Legend is mandatory. Cells animate in with a staggered settle (see §6).

### 4.2 Journey chain (case view)

The trip drawn as a chain of links: `flight — transfer — stay — ✦ commitment`.

- **Solid green link** — confirmed, healthy.
- **Dashed brass link** — proposed / awaiting confirmation or decision.
- **Solid vermilion link** — broken, no longer works.
- **Dotted grey link** — unbooked or unknown.
- The commitment link carries the ✦ mark and never disappears; if endangered
  it is brass, if missed it is vermilion.

The chain is the fastest answer to "is the trip still a trip?" — fixing one
booking is not fixing the trip.

### 4.3 Queue rows (operator)

`glyph · name · issue · time` in one line. Glyph shape encodes the needed
action (✕ decide, ▲ watch, ? unconfirmed), colour follows §2.2.

### 4.4 Traveller commitment card

Ink object on the traveller screen: the event that must not be missed, in
warm white with the brass ✦. Everything the screen asks is visibly checked
against this card.

### 4.5 Option cards (traveller + operator)

Each option states its route, its times, its cost delta, and — above all —
what it does to the commitment. Recommended option: green inset edge.
Commitment-breaking option: vermilion edge, and the reason in plain language.
A cheaper option that misses the event is never hidden; it is shown with its
rejection reason.

## 5. Layout & responsive

- Operator shell: max 1180px, 24px gutters. Readout row is 2-up (ink block +
  fleet grid) down to 900px, then stacked.
- Roster/queue rows collapse gracefully: issue text truncates, time drops
  below 560px, glyph and name never truncate.
- Tables scroll horizontally inside their panel below 720px instead of
  crushing columns.
- Traveller shell: max 480px, mobile-first, 16px gutters, 48px minimum touch
  targets.
- Screens render identically from static preview files and the app server:
  no layout may depend on runtime fetches.

## 6. Motion charter

Tasteful only. Motion communicates *state change* and *ordering*; it never
decorates for its own sake.

1. **The settle (signature).** When a value changes — a count, a status, a
   cell in the fleet grid — it does not snap; it *settles*: a 700ms
   split-flap-inspired flicker (`ns-settle`) plus a brief wash of the new
   state colour. Triggered by adding `.just-changed` to the element
   (integrator adds it server-side when a re-render carries a changed value).
   On first page load, the readout number plays the settle once to establish
   the metaphor — this is entry, not a fake update.
2. **Entry stagger.** Lists, grids and cards rise 6px and fade in with a
   45ms per-item stagger (`ns-rise`), so the screen assembles the way a
   split-flap board boots. Total stagger budget ≤ 600ms.
3. **Interaction micro-motion.** Hover/focus transitions run 140–180ms
   `ease-out`: background, border colour, translateY(−1px) on actionable
   rows. Nothing bounces; nothing eases longer than 200ms.
4. **Banned.** Scroll-jacking, parallax, cinematic entrances, autoplaying
   carousels, perpetual pulsing (a `LIVE` dot may breathe at 2.4s; nothing
   else loops).
5. **Reduced motion.** `prefers-reduced-motion: reduce` disables all
   keyframe animation and shortens transitions to 0.01ms. State is always
   legible without motion.

## 7. Loading, empty, error, unknown

- **Loading**: skeleton blocks with a slow shimmer; never a spinner alone,
  never fake data. `data-ui-state="loading"`.
- **Error**: a quiet ink-bordered panel saying what is unavailable and that
  the underlying trips are unchanged. `data-ui-state="error"`.
- **Empty**: a one-line `empty-note` in dim ink, italic. No illustrations.
- **Unknown data**: grey + explicit "unconfirmed"/"?" affordance (§2.2.2).
  Unknown is a rendered state, not an absence of one.

## 8. Voice

- Sentences, not labels, for anything the user must act on. "Lands 40
  minutes into your keynote", never "constraint violated".
- No internal vocabulary (the jargon gate test enforces the list in
  `src/ui/copy.ts`).
- Time is shown with its source timezone; "updated 41s ago" style for
  freshness; never claim freshness the data does not have.

## 9. Accessibility floor

- State is never carried by colour alone: every coloured element also has a
  glyph, label, or text.
- `role="status"` on badges, `role="alert"` on error panels, `aria-label` on
  the fleet grid and progress stepper.
- Focus-visible ring: 2px brass outline, 2px offset.
- Contrast: all text tokens meet WCAG AA on their surfaces.
