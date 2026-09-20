# A5.1 founder QC notes — Sarah (2026-09-21)

Captured from founder narrated walkthrough. Do **not** treat as closed A5.1 defects until triage in main chat. Many items are UI overhaul / presentation (Park or Act Now depending on scope).

## Overview

1. **Overall UI weight/hierarchy needs a clean pass** — object visual weights feel unbalanced.
2. **Black readiness box (51/67)** — leftover old-UI feel; unclear why 51 not 67; “2 roles” vs full population not obvious.
3. **Desired layout:** header → **graph immediately under header** → then secondary info (not graph buried under summary tiles/blocks).
4. **Graph motion/look is good** (travelling pulses etc.).
5. **No visible real-time stage progression on simulate:** click Simulated airline update → everything appears at once; recovered cohort flips green instantly (“magic”) — want progressive/visible state change.
6. **Sarah highlight on Active Change is good.**

## Case navigation

7. **Clicking Sarah on the Overview graph does not open her Case** (Open case under Needs attention works).

## Case surface

8. **Desired layout:** graph **right at the top** under header.
9. **Graph size:** too wide/full; prefer ~70–80% width with something useful on the right (decision/summary).
10. **Overall Case UI needs overhaul** (same theme as Overview).

## V5.6 graph (Sarah Case)

11. **Icons (Changed / Recovered / Failed) overlap or block text.**
12. **Some “Failed” badges don’t make sense in this programme-recovery scenario.**
13. **Click/inspect uneven:** booking/flight/arrival timing/headline interview clickable; other nodes don’t open inspector/popup.

## Copy / recovery content

14. **“What this affects” wording is poor** (e.g. “no longer works” is meaningless).
15. **Recommended recovery is fairly detailed (good), but lead story looks like flight rebooking** — founder expected **programme/event rebooking** as the hero selling point; confusing if flight is the visual lead.
16. **Decision/approval panel:** unclear / hard to engage (“can’t click under decision because approval under”).
17. **Bottom of Case is a cluttered cluster** — unclear what blocks are for.
18. **Activity/event log of what happened is hard to find** (or missing as a clear operator timeline).

## Open questions from founder

19. **Was the LLM (Qwen/Model Studio) actually run this round, or not?**

## Cross-scenario / QC process (Jordan handoff)

20. **Switching scenarios must not require a demo reset.** Product should handle **Sarah + Jordan at once** (two open/visible stories on the same Overview). Resetting to clear Sarah so Jordan could be read was a QC/process failure, not acceptable product behaviour.
21. D1 matched after reset: Needs attention empty; delay viable; no Case yet.

## Jordan D2 (founder walkthrough)

22. **Auto-update without hard refresh worked** (good) — Overview updated on its own when D2 applied.
23. **Jordan already RED on Overview when D2 should be amber/watch** — connection should be AFFECTED/amber at D2, not definitive failure red. (Act Now — graph truth / Overview health presentation.)
24. **Case graph so far yellow** — acceptable for D2 causal story if Overview red is the mismatch.
25. **Case layout still wrong:** graph is **not** above everything; “how the trip is affected” / decision title still sits at the top (same hierarchy complaint as Sarah).
26. **Copy:** “Jordan Hale no longer works” / “Replace and travel” — same bad wording pattern as Sarah.
27. **Approval unavailable** at D2.
28. **Premature recommendation:** Case already recommending replace/travel **before D3** — founder expected progression to D3 before that sell; not the intended staged plan. Note and do not expand scope mid-QC; move on.

## Jordan D3 (founder walkthrough)

29. **Overview after D3 looks identical to D2** — no visible change when D3 applied (same “magic / skip” problem as Sarah simulate; progressive state not observable).
30. **Case after D3: little visible change** — block/node still amber; story does not clearly escalate to connection-broken / FAILED.
31. **Arrival timing has two outbound lines** — confusing / unclear why dual edges from arrival.
32. **Status chrome blocks text** (same as Sarah) — Changed/Failed/etc badges overlap labels.
33. **Still can’t click approval** — blocked from testing further (execution / authority path untestable in this QC pass).
34. **Desired Overview progression (explicit):** at each step traveller/connection goes **green → yellow → finally red**. Actual: **skips straight to red** (seen from D2) and then D3 adds no further Overview change. This is the core Jordan story failure for founder QC.
35. **Case story not clear** — soft spots / unclear narrative; founder cannot follow what changed and why.

## Triage seeds (for later main-chat pass)

| # | Likely class | Notes |
|---|---|---|
| 1,3,8–10,17 | Park / separate UI pass | Founder asked for overhaul; A5.1 was hierarchy-only |
| 2 | Investigate Now | Population accounting / readiness copy |
| 5 | Investigate Now | Overview progression visibility vs instantaneous settle |
| 7 | Act Now | Graph node → Case navigation |
| 11–13 | Act Now / Investigate | Graph chrome + inspector coverage |
| 14–16,18 | Act Now | Operator copy + decision/activity hierarchy |
| 15 | Investigate Now | Sarah recommendation lead must emphasise programme change |
| 19 | Investigate Now | Confirm LIVE Qwen evidence on this REPLAY boot |
| 20 | Act Now (product truth) | Multi-case coexistence — Sarah + Jordan must both be operable without reset |
| 22 | Ignore / Accept (positive) | Live Overview poll without refresh |
| 23 | Act Now | D2 Overview Jordan red vs expected amber/AFFECTED |
| 25–26 | Act Now | Case hierarchy + “no longer works” copy (Jordan) |
| 27–28 | Investigate Now | Approval unavailable + recommend-before-D3 staging |
| 29–30,34–35 | Act Now | Progressive green→amber→red story failed (Overview + Case); D3 no-op visually |
| 31–32 | Act Now | Dual edges from arrival + badge-over-text |
| 33 | Act Now | Approval unclickable — cannot complete Case QC |
