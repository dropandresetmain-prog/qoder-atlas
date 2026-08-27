# NORTHSTAR HERO DEMO - LIVE BROWSER WALKTHROUGH

Walked by: Claude (AI Agent)
Date: 27 Aug 2026
Browser: Chrome
Viewport: 1440x900
Demo world: Already reset once before walkthrough started (as instructed, did NOT reset between paths)

---

## PATH 0 — Overview + Programme Baseline

### Observations:
- **Overview page**: 30/42 confirmed, 10 needs attention, 2 watching, 67 participants
- **Fleet cells**: Visible
- **Needs attention**: Jonas Berg, Oliver Bennett, Jordan Hale, Arjun Rao, Siti Rahmah, Sarah Lim, Mei Ling Goh
- **Shared incident grouping**: FAIL - Arjun, Siti, Sarah, Mei Ling each show identical "The airline changed the flight schedule." messages (NOT grouped as a shared incident)
- **Roster footer**: "Page 1 of 8 · 76 travellers" ✓
- **Programme page**: 67 participants, 42 Northstar-managed, 25 local/self
- **Sarah Lim headline interview**: "09:20 Headline Interview: Aviation After Automation" (originally)

---

## PATH 1 — Jordan Hale S2 (Organiser Approve → Execute → Resolved)

### Steps Performed:
1. Clicked Jordan Hale from Needs attention
2. Case opened - badge "OPTIONS ON THE TABLE"
3. Viewed case details
4. Clicked "Approve as organiser S$122.23"
5. Clicked "Execute approved recovery"
6. Case resolved

### Button Labels:
- **Step 4**: "Approve as organiser S$122.23" (exact label, showing S$ not US$)
- **Step 5**: "Execute approved recovery"
- **Terminal**: "Back to Overview"

### Observed State Details:

**Before approval (J-02-case-entry-top.png)**:
- Flight LAX→NRT: "FLIGHT STATUS PENDING"
- Flight NRT→SIN: "IMPACTED" "No longer works as booked · 29 Sep · 16:50"
- Hotel: "HOTEL CONFIRMATION PENDING"
- Bootcamp commitment: "DETAILS PENDING"
- CTA: "Approve as organiser S$122.23"

**After approval (J-06-after-approve.png)**:
- "APPROVAL RECORDED"
- "Execute the approved recovery" button appeared
- "Approve as organiser" button removed
- Checks: "No longer meets: timing still works for the commitment" (appears twice)

**After execute (J-09-terminal.png)**:
- Flight NRT→SIN: "CONFIRMED" "30 Sep · 08:20"
- "370 min available / 360 min required — viable" ✓
- "3020 min available / 360 min required — viable" ✓
- "This case is resolved"
- **NO Approve/Execute buttons** ✓

**Currency**:
- Primary button: S$122.23 (Singapore dollars)
- Option detail: "US$90.54 payable" vs "S$122.23 policy equivalent"

**Timing**:
- Recommended option: "Rebook onto a replacement departing at 08:20"
- Details: "Arrival 14:35; commitment 20:45; 370 min available / 360 min required — viable"
- Final confirmed: "30 Sep · 08:20 → 30 Sep · 14:35"

**CRITICAL FAIL - Overlay/Progress**:
- ❌ **NO OVERLAY** was visible during Execute
- Expected: Multi-step progress showing "submitting / observing / updating"
- Actual: Page simply reloaded/updated to terminal state
- Screenshot J-08-overlay.png captured the same frame as J-09-terminal.png (no intermediate progress UI)

**Overview after resolution**:
- Confirmed count: 31 (increased from 30) ✓
- Needs attention: 9 (decreased from 10) ✓
- Jordan removed from Needs attention list ✓
- "Show interaction" with "RECOVERED" badge visible in All travellers ✓

**Reload persistence**: ✓ State persisted after F5 reload

---

## PATH 2 — Sarah Lim S1→S3 Programme Change (NO RESET)

### Steps Performed:
1. Clicked Sarah Lim from Needs attention
2. Case opened - badge "NEEDS ATTENTION"
3. Clicked "Preview programme change"
4. **MANUALLY TYPED** ISO timestamps (fields were EMPTY, not prefilled)
5. Clicked "Preview impact"
6. Clicked "Commit change"
7. Confirmed browser dialog
8. Case resolved

### Button Labels:
- **Step 3**: "Preview programme change"
- **Step 5**: "Preview impact"
- **Step 6**: "Commit change"
- **Terminal**: "Back to Overview"

### Observed State Details:

**Before programme change (S-02-case.png)**:
- Flight Jakarta→Singapore: "FLIGHT STATUS PENDING" "1 Oct · 06:00"
- Hotel: "HOTEL CONFIRMATION PENDING"
- Commitment: "Headline Interview: Aviation After Automation - AiT - AI in Travel Summit 2026" "1 Oct · 09:20 · fixed" "DETAILS PENDING"
- Check: "130 min available / 360 min required — not enough time" ❌
- Signal: "Airline schedule feed"

**CRITICAL FAIL - Prefill (S-05-edit-modal.png)**:
- ❌ **NEW START field was EMPTY** (placeholder: "e.g. 1 Oct · 15:30 (or full ISO with offset)")
- ❌ **NEW END field was EMPTY** (placeholder: "e.g. 1 Oct · 16:00 (or full ISO with offset)")
- Expected: Fields prefilled with 15:30 times
- Actual: Had to manually type `2026-10-01T15:30:00+08:00` and `2026-10-01T16:00:00+08:00`
- This is a **FAIL for prefill requirement**

**Preview / Impact (S-06-now-proposed.png)**:
- Header: "PREVIEW · NO CHANGES MADE YET"
- NOW: "09:20 · Headline Interview: Aviation After Automation"
- PROPOSED: "Reschedule · 16:00" (shows END time, not START time 15:30)
- "2 trips affected · 65 unaffected"
- Elena Tan: "Programme commitment moves — engagement times would change" WATCHING
- Sarah Lim: "Programme commitment moves — engagement times would change" WATCHING
- ❌ **Both show IDENTICAL generic reason** (not distinct reasons as expected)

**CRITICAL FAIL - Overlay/Progress**:
- ❌ **NO OVERLAY** was visible during Commit
- Expected: Multi-step progress showing "committing 15:30 / recalculating Sarah / checking Elena"
- Actual: Browser confirmation dialog appeared, then page reloaded to terminal state
- Screenshot S-07-commit-progress.png captured the same frame as S-08-after-commit.png (no intermediate progress UI)

**After commit (S-08-after-commit.png)**:
- "Trip recovered" ✓
- Commitment: "1 Oct · 16:00 · fixed" (changed from 09:20) ✓
- Check: "530 min available / 360 min required — viable" ✓ (changed from 130 not enough)
- "This case is resolved"
- Signal still shows: "Airline schedule feed" (not updated to reflect programme change reason)

**Overview after commit (S-09-overview.png)**:
- Confirmed: 32 (increased from 31) ✓
- Needs attention: 8 (decreased from 9) ✓
- Sarah removed from Needs attention ✓
- Elena Tan NOW in Needs attention with:
  - ❌ **RAW ID visible**: "shared commitment rescheduled affecting engagement el-trip-trv-evt-ait-2026-ait-draft-01-eng-7"
  - This is a **FAIL for raw ID exposure**

**Reopen (S-10-reopen.png)**:
- Navigated to original case URL
- Result: "The case details are unavailable right now"
- "No recovery case case-tip-trv-evt-ait-2026-ait-draft-14-sig-provider-state-70bc6ffcdbab1d36 is known"
- This is **EXPECTED** behavior (case is resolved, no longer a recovery case)

**Programme page (S-12-programme.png)**:
- Found: "16:00 Headline Interview: Aviation After Automation" ✓
- Note: Shows 16:00 (END time) not 15:30 (START time) on timeline

**Roster count**: Increased from 76 to 77 travellers (unexpected)

---

## PATH 3 — Oliver Bennett S7 (TO BE CONTINUED)

[Walkthrough still in progress - will be completed in next continuation]

---

## PATH 4 — Jonas Berg S5 (TO BE CONTINUED)

[Walkthrough still in progress - will be completed in next continuation]

---

## LOOK-FOR CHECKLIST (Paths 0-2 so far)

| Item | Status | Evidence / Quoted Text |
|------|--------|------------------------|
| **1. Status chips** | PARTIAL | "CONFIRMED", "PENDING", "IMPACTED", "DETAILS PENDING", "FLIGHT STATUS PENDING", "HOTEL CONFIRMATION PENDING" all present ✓ |
| **2. Event commitments** | FAIL | "DETAILS PENDING" seen; "Scheduled/Confirmed" not seen for any commitment |
| **3. Primary CTA labels** | PASS | "Approve as organiser", "Execute approved recovery", "Preview programme change", "Preview impact", "Commit change", "Back to Overview" |
| **4. Currency on buttons** | MIXED | Jordan: "S$122.23" on button (correct); Option detail showed "US$90.54 payable" vs "S$122.23 policy" ✓ |
| **5. Overlay/progress panel** | **FAIL** | ❌ NO overlays visible for Execute (Jordan) or Commit (Sarah). Pages just reloaded. |
| **6. Raw IDs in UI** | **FAIL** | ❌ Elena Tan message: "el-trip-trv-evt-ait-2026-ait-draft-01-eng-7" exposed |
| **7. "declared departure gateway"** | NOT YET | (Oliver path pending) |
| **8. "human agent"** | NOT YET | (Oliver path pending) |
| **9. "No longer meets: timing still works"** | PASS | ✓ Jordan case showed "No longer meets: timing still works for the commitment" (twice) |
| **10. Demo banner** | NOT CHECKED | Did not verify demo banner on product pages |
| **11. Roster footer** | MIXED | Overview: "76 travellers" initially, later "77 travellers"; Programme not checked for footer |
| **12. Shared incident grouping** | **FAIL** | ❌ Arjun/Siti/Sarah/Mei Ling show FOUR IDENTICAL "airline changed the flight schedule" rows, NOT grouped |

---

## SCREENSHOTS CREATED

### Path 0:
- 00-overview.png
- 00-overview-roster.png
- 00-programme.png

### Path 1 (Jordan):
- J-01-overview.png
- J-02-case-entry-top.png
- J-04-options.png
- J-06-after-approve.png
- J-08-overlay.png (same as terminal, no actual overlay)
- J-09-terminal.png
- J-09-terminal-scroll.png
- J-10-reload.png
- J-11-overview-confirmed.png
- J-12-reopen.png

### Path 2 (Sarah):
- S-01-overview.png
- S-02-case.png
- S-02-case-scroll.png
- S-05-edit-modal.png
- S-06-now-proposed.png
- S-06-now-proposed-scroll.png
- S-07-commit-progress.png (same as after-commit, no actual overlay)
- S-08-after-commit.png
- S-09-overview.png
- S-10-reopen.png
- S-12-programme.png

### Path 3 & 4:
(To be completed)

---

## CRITICAL FINDINGS

### ❌ BLOCKING FAILURES:

1. **No Observe-Phase Overlays**
   - Execute (Jordan S2): No progress modal; page just reloaded
   - Commit (Sarah S1→S3): No fan-out overlay; page just reloaded
   - Requirement explicitly stated overlays with steps like "submitting / observing / updating" and "committing 15:30 / recalculating / checking Elena"

2. **Raw ID Exposure**
   - Elena Tan message shows: "el-trip-trv-evt-ait-2026-ait-draft-01-eng-7"
   - This is a primary UI string, not a debug artifact

3. **Shared Incident Not Grouped**
   - Four travellers (Arjun, Siti, Sarah, Mei Ling) all show identical "The airline changed the flight schedule." in separate rows
   - Expected: Single grouped incident callout

4. **Programme Change Fields Not Prefilled**
   - Sarah S1→S3 edit modal showed empty placeholder fields
   - Had to manually type ISO timestamps
   - Requirement stated "Preview 15:30 prefilled as human time, not empty ISO fields"

### ⚠️ PARTIAL ISSUES:

5. **Generic Blast-Radius Reasons**
   - Elena and Sarah both: "Programme commitment moves — engagement times would change"
   - Expected: Named distinct reasons

6. **Timeline Shows END Time Not START**
   - Programme page shows "16:00" (END) instead of "15:30" (START)
   - Preview modal also showed "Reschedule · 16:00"

7. **Commitment Status**
   - All commitments show "DETAILS PENDING"
   - None show "Scheduled/Confirmed" status

---

## NOTES TO CERTIFIER

**This walkthrough is NOT declaring FINAL HERO ACCEPTANCE CANDIDATE.**

I am the walker, not the certifier. The above blocking failures must be addressed before this build can be considered for hero acceptance.

The remaining paths (Oliver S7 and Jonas S5) will be completed to provide full coverage.

