# Operator Workspace V5 — visual acceptance (Opus convergence pass)

Physical evidence for the visual/UX convergence pass against the approved V5
references in `docs/design/operator-workspace-v5/`.

This pass is **presentation only**. No planner selection, recovery ranking,
deterministic viability, trip-health semantics, state transition, authority rule,
provider behaviour or graph node/edge semantics was changed. Production continues
to use `renderEventOverviewGraph()` and `renderFocusedCaseGraph()`.

## Runtime state

| | |
|---|---|
| Branch | `ui/operator-workspace-v5` |
| Base before this pass | `6a6abd2` |
| Runtime | normal product boot (`node src/main.ts`), `HTTP_PORT=8790` |
| Adapter mode | `REPLAY` (no fresh destructive bookings) |
| Database | PostgreSQL 16 on `localhost:55432`, `astra_a5_founder_qc_20260921` |
| Demo workspace | `b62c6b6b-4af1-4ea4-8314-588f119317d9` |
| Dataset | reused existing state — **no `demo/reset` was issued** |
| Sarah case | `d4ff8d2d-10ec-57cd-822b-e38cceb2c238` (AWAITING_AUTHORITY) |
| Jordan case | `8344fcd3-5d11-584d-9e3a-7bb07127b285` (AWAITING_AUTHORITY) |
| Viewport | 1440 × 900, deviceScaleFactor 1 |

## Screenshots

| # | File | What it proves |
|---|---|---|
| 1 | `01-overview-event-health-1440.png` | Event health is the default tab; V7.2 is the dominant visual; the focus topline names the traveller **and** what changed; readiness is compact and subordinate, spanning its own bar; the rail is hairline-separated stories (editorial lead, demoted sibling) with one status mark per row, followed by compact activity. No left sidebar, no readiness hero, no card around every item. |
| 2 | `02-overview-all-participants-1440.png` | All participants is a peer page tab, not a pane. Ten rows fit above the fold; status and actions sit in fixed columns; filters read as pills rather than a second row of page tabs; the status word no longer appears both in the context column and in the badge beside it. |
| 3 | `03-jordan-case-recommendation-1440.png` | Case composition on a second, non-programme case: compact header with breadcrumb above the title, named graph topline carrying the Current/Original control, V5.6 graph prominent and not squashed, sticky rail beside the graph carrying recommendation → decision → activity → whole-trip state. |
| 4 | `04-sarah-case-recommendation-1440.png` | Same composition on the programme case. Approval status is legible; new spend and displaced-booking loss stay separate and read "Not compared"; unknown stays unknown; whole trip reads "Not yet recovered" — recovery is not visually implied. |
| 5 | `05-sarah-case-full-page-1440.png` | Full scroll: Recommended recovery visually outranks Other options and Checks & sources; itinerary and commitment blocks are hairline-separated rather than nested panels; the rail stays useful while scrolling. |
| 6 | `06-sarah-case-other-options-1440.png` | Rejected options that present identically collapse into one row with a count ("Rejected · 4 options") and one grouped evaluation disclosure — presentation-only grouping, nothing dropped. Negative time is stated as a shortfall ("65 min short"). |

## Checks run at this state

- `test/operator-ui-convergence.test.ts` — 16/16 pass.
- `npm run typecheck` — clean.
- `npm run lint` — 225 pre-existing errors, **identical to the pristine base**; zero introduced.
- `node scripts/anti-hardcoding-gate.mjs` — `VERDICT: CLEAN`.
- `test/r4-f1-ui-language.test.ts`, `test/b1-product-acceptance.test.ts`,
  `test/r3d-user-contracts.test.ts` — 84/95 pass, 11 fail. The **same 11 tests fail
  at the pristine base `6a6abd2`**; they assert the pre-V5 case/overview markup and
  were not revived to satisfy them.

## Semantic issues visible in this evidence and deliberately NOT disguised

**ACT NOW — planner/comparator selection (unchanged from the prior evidence package).**
Sarah's selected recommendation is domain **TRANSPORT** ("Book replacement travel")
while viable **PROGRAMME** alternatives exist. Live candidate dispositions:

```
Transport / RECOMMENDED               1
Transport / VIABLE_NOT_RECOMMENDED    5
Programme / VIABLE_NOT_RECOMMENDED    2
Programme / REJECTED_DETERMINISTIC    4
```

Recommendation basis: `selected among viable candidates: 0 regression(s),
1 improvement(s), blast radius 3`.

The approved V5 reference shows "Move the programme commitment" for this case.
The strategy title was **not** frontend-relabelled and the candidates were **not**
reordered. This is planner selection, not presentation.

**INVESTIGATE — Overview graph framing.** In the graph's own "Active change" view,
6 of 30 nodes are cut mid-card at the viewport edges (4 left, 2 right), including a
required-attendee card sliced in half. Switching the graph to "Whole event" clips
nothing. This is the graph's own focus-framing rect, not a container-size problem,
so no page CSS was used to mask it.

**INVESTIGATE — Case graph vertical fit.** The V5.6 scene rect reserves roughly
190px of empty space above its content, so the nodes sit low in the viewport and the
faded context row meets the "drag to pan" hint at the bottom edge. Reducing the
container height clips content below ~470px, so the slack is in the scene rect, not
the container.

**PARK — activity entries carry no source or subject.** Overview rail entries such as
"Linked external record" / "Observed external record" are machine-derived fallbacks
for commands with no mapped phrase, and they arrive with no `reason`, so the rail can
only show a timestamp where the reference shows the provider ("Qwen / Model Studio").
The shared activity vocabulary was left untouched because `test/operator-ui-convergence.test.ts`
pins the fallback behaviour.

**PARK — event date and location are not in the contract.** `OperatorOverview.eventContext`
carries only `title` and `organiserLabel`, so the reference's "30 Sep — 02 Oct 2026 /
SINGAPORE · GMT+8" heading block cannot be produced without inventing data. The event
title is shown in that position instead.
