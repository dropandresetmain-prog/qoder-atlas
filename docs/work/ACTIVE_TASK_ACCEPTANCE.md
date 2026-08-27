# ACTIVE_TASK_ACCEPTANCE — successor SHA recheck

**Verdict: FIX REQUIRED**

Targeted independent recheck of previously failed REC IDs plus Jonas cost consistency. Real Chrome screenshots are the gate. Tests are supporting only.

## Candidate

| Field | Value |
|---|---|
| Prior candidate | `cursor/hero-presentation-a602` @ `2a24f6b` — **FIX REQUIRED** |
| Successor | `final/hero-acceptance-fixes` @ `3a923918017e4f6821b85bfa1f7d20d5fd404bf1` |
| Review branch | `cursor/hero-acceptance-recheck-599e` |
| Method | Chrome clickthrough on `http://127.0.0.1:8787` after `POST /api/demo/reset`; independent pixel review of `output/hero-acceptance/fixes/` |
| Walker notes | `fixes/RECHECK.md` is **not** SSOT. First `00-overview.png` was a stale tab (GENERATED 15:42 UTC, leftover 34/42 + Elena raw id). Fresh evidence is `S-01-overview.png` and `00b-overview-*.png`. |

Product code was not changed in this review.

---

## Verdict

**FIX REQUIRED.** Several prior fails are closed on this SHA. Three scoped items still fail in the live UI. Do not certify `FINAL HERO ACCEPTANCE CANDIDATE`.

---

## Rechecked IDs

### Still FAIL (Act Now)

| ID | Live evidence |
|---|---|
| **REC-7-shared-incident** | Group header exists, but consequences are **not** differentiated. `S-01-overview.png`: “One airline change · 4 different trip consequences · **0 still workable · 4 critical**”. Arjun / Siti / Sarah / Mei Ling all “Critical — travel cannot protect the commitment.” Contract: 3 remain viable, Sarah needs action. After Sarah commit (`S-09`, `00b-overview-fresh.png`): still **0 workable / 3 critical**. |
| **REC-3-options-hidden-until-plan** | Jordan Case opens **OPTIONS ON THE TABLE** with amount + approval already on screen. No judge-visible Resolve → plan. `J-03-case.png`, `J-04-approve.png`. Same for Oliver (`O-03-recommended.png`). |
| **Jonas cost consistency** | Payable **US$541.83** and policy **S$731.47** are correct on Case/Traveller body copy. Failures: recommended title **“US$542.00”** vs **US$541.83 payable** (`V-02-scroll.png`); Overview Needs Attention uses **S$731.47** as the amount, not payable US$ (`V-01.png`, `S-09-overview.png`). No US$223.94 seen. |
| **REC-2-browser-rehearsal-truth** | `hero-lifecycle-rehearsal.test.ts` **5/5 pass** on this SHA while the live UI still fails the three rows above. Tests do not catch 0-workable grouping, options-already-visible, or US$542.00 vs US$541.83. |

### PASS on this Chrome pass (do not reopen without new evidence)

| ID | Evidence |
|---|---|
| **REC-2-trip-status** | Unaffected LAX→NRT / hotel **CONFIRMED**; NRT→SIN **IMPACTED** then recovered **CONFIRMED**. Oliver HND inbound + LHR return **CONFIRMED**. `J-03-case.png`, `J-09-terminal.png`, `O-09-terminal.png`. |
| **REC-2-programme-engagement** | Showcase / Headline / Debate / Fireside **SCHEDULED**, not DETAILS PENDING. `J-03-case.png`, `S-08-after.png`, `O-09-terminal.png`, `V-02-scroll.png`. |
| **REC-5-observe-update-visible** | Jordan/Oliver execute overlay: Execution → Observation → State update → Recheck. Sarah commit overlay: “Rechecking downstream viability.” `J-08-overlay.png`, `O-08-overlay.png`, `S-07-overlay.png`. Overlay copy discloses presentation pacing. |
| **REC-7-iso-prefill** | New start/end **1 Oct · 15:30** / **1 Oct · 16:00**, not empty ISO. `S-05-prefill.png`. |
| **REC-7-named-distinct-blast** | Elena WATCHING “Programme commitment moves to 1 Oct · 15:30”; Sarah **VIABLE** “500 min available / 360 min required”. `S-06-blast.png`. |
| **REC-9-operator-cannot-approve-jonas** | Badge **WAITING FOR JONAS BERG**. No operator Approve traveller-funded control. `V-02-scroll.png`. |
| **REC-9-traveller-exact-mutation** | “Approve extending Concorde Hotel Singapore: 3 Oct · 11:00 → 4 Oct · 11:00. Traveller-funded increment US$541.83. No flight change.” `V-06.png`. |
| **REC-4-contradictory-checks** | No “No longer meets: timing still works”. Terminal 370≥360. `J-09-terminal.png`. |
| **REC-3-cta-currency** | Case primary buttons **Approve as organiser US$90.54** / **US$143.62**. Policy S$ is labelled equivalent. `J-04-approve.png`, `O-03-recommended.png`. Overview money line for Jonas/Oliver still uses S$ (covered under Jonas cost). |
| **REC-10-overview-76** | After hard refresh: **Page 1 of 8 · 67 participants**. `00b-overview-roster.png`. Ignore stale `00-overview-roster.png` (“77 travellers”) from an unreloaded tab. Header **All participants 67**. |
| **REC-8-declared-gateway** | “Rebook HND→SIN (direct) to fly from **HND**, departing at 02:20”. No “declared departure gateway”. `O-03-recommended.png`. |
| **REC-4-raw-ids-iso** | After commit, Elena: “Shared programme commitment rescheduled — Headline Interview: Aviation After Automation”. `S-09-overview.png`. Ignore stale `00-overview.png` Elena `el-trip-…` from the leftover tab. |

---

## Preserve (no regression seen)

Jordan Approve → Execute → 08:20/14:35 370≥360 resolved. Sarah no-reset commit → 15:30 Scheduled, 500/360 viable. Oliver Tokyo inbound + LHR return Confirmed. Jonas Concorde traveller authority, dusk hero. No HUMAN_AGENT. Fleet 67/42/25.

---

## Tests (supporting, not the gate)

On `3a92391`:

```
node --experimental-strip-types --test test/e2e/hero-lifecycle-rehearsal.test.ts
```

**5 pass / 0 fail.** Does not close the remaining live fails.

---

## Next action

Fix owners on `3a92391` (or a successor):

1. Shared incident: 3 Wanderpay viable vs Sarah critical, not 0 workable / all Critical.
2. Hide options/approval until the plan stage unless already-planned is explicit.
3. Jonas money: one payable figure **US$541.83** (no US$542.00 title); Overview row uses payable US$ not policy S$ as the amount.
4. Rehearsal tests must assert those three, or they will keep false-passing.

Independent acceptance should re-browser **only** those remaining IDs.
