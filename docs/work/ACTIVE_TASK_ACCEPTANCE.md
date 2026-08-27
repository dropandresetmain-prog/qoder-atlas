# ACTIVE_TASK_ACCEPTANCE — independent NORTHSTAR hero acceptance

**Verdict: FIX REQUIRED**

This is an independent acceptance of the named hero-presentation candidate. It does **not** implement product fixes. It does **not** treat prior lane checklists, R3D matrix rows, or automated rehearsal PASS as evidence.

## Candidate under review

| Field | Value |
|---|---|
| Requested branch | `final/hero-presentation` |
| Actual candidate | `cursor/hero-presentation-a602` @ `2a24f6bcf0c517343dffd5a52690eb55670d28f3` |
| Why | No remote branch `final/hero-presentation` exists. PR #8 states Cloud PR policy required `cursor/*-a602` for this lane. |
| Base | `final/hero-integration` @ `18fefc8` |
| Contracts | `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md` |
| Runtime | Live UI at `http://127.0.0.1:8787/operator?event=evt-ait-2026` after `POST /api/demo/reset` |
| Method | Two real Chrome clickthroughs by a computer-use browser agent, then independent visual review of those screenshots (not the walker writeups). Playwright HTML capture was never the acceptance gate. |
| Screenshot pack (pass 1) | `output/hero-acceptance/browser/` |
| Screenshot pack (pass 2, this request) | `output/hero-acceptance/live/` |

Prior `ACTIVE_TASK_PRESENTATION.md` 19/19 capture checks and `hero-lifecycle-rehearsal` PASS are **not** accepted as proof. Those tests passed on this SHA while the live judge UI still fails Act Now items below.

---

## Verdict

**FIX REQUIRED.** A second live Chrome pass on the same SHA (fresh demo reset, no Playwright) reproduced the must-fix IDs. Jordan/Oliver/Sarah/Jonas can still be driven to a resolved Case and Overview Confirmed/green, but the judge-facing choreography is not closed. Do not certify `FINAL HERO ACCEPTANCE CANDIDATE`.

What already works (not sufficient for acceptance):

- Jordan and Oliver: organiser Approve is **not** recovery; **Execute approved recovery** appears and completes; reload/reopen stay resolved.
- Sarah S1→S3 with **no reset**: programme commit moves the headline to 15:30, same trip becomes viable, Case resolved, no second Resolve CTA.
- Jonas: same-property Concorde extension, traveller-funded US$541.83, terminal 4 Oct / 5 nights, Overview Confirmed after traveller Approve.
- No `HUMAN_AGENT` / “human agent” copy on the four hero Cases.
- No demo banner on Overview/Programme/Case.
- Singapore dusk traveller hero (`sg-dusk.png`) is present.

---

## Failed checklist IDs

IDs are the Act Now bullets in `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`. Choreography §11 items that fail are listed beside them.

### Must-fix (block hero acceptance)

| ID | Contract text | Evidence |
|---|---|---|
| **REC-2-trip-status** | Unaffected/known-good trip elements remain Confirmed. Only the genuinely impacted/unknown/pending element is shown as such. | All four heroes: LAX→NRT / AMS flights / Concorde (pre-Jonas-execute) / programme commitments render **FLIGHT STATUS PENDING**, **HOTEL CONFIRMATION PENDING**, **DETAILS PENDING**. Jordan execute still shows NRT→SIN **IMPACTED** (correct) while the inbound that still exists is Pending. Oliver terminal: HND inbound CONFIRMED but preserved LHR return stays **FLIGHT STATUS PENDING**. Screens: `J-02-case-entry-top.png`, `J-07-execute.png`, `O-02-case.png`, `O-09-terminal.png`, `V-02-operator.png`, `V-10-terminal.png`, `S-08-after-commit.png`. Choreography: **Commitment semantics**. |
| **REC-2-programme-engagement** | Event commitments use Scheduled / At risk / Preserved / Confirmed, not Not booked / pending merely because they are not supplier reservations. | Finals Showcase, Headline Interview, The Debate, Fireside all show **DETAILS PENDING** on entry **and** on recovered terminals. Screens: `J-09-terminal.png`, `S-08-after-commit.png`, `O-09-terminal.png`, `V-10-terminal.png`. |
| **REC-5-observe-update-visible** | Observation/state-update phase is visible after the external boundary: execute → observe → update graph → recheck trip. | Execute/commit form POST navigates away. No durable overlay was capturable for Jordan execute, Sarah commit, Oliver execute, or Jonas traveller Approve. Sarah commit still uses a ~220ms reload (`window.setTimeout(..., 220)` in programme-change interaction). Screens missing on purpose: no `J-08-progress`, `S-07-commit-progress`, `O-08-progress`. Terminal copy later says “simulated at provider boundary” — that is history, not the required live phase. Choreography: **Jordan/Oliver/Jonas execution and observation**, **Sarah commit propagation**. |
| **REC-7-shared-incident** | Initial shared incident is one source event with differentiated consequences; Sarah naturally discoverable. | Overview is a **flat** Needs Attention list. Sarah, Arjun Rao, Siti Rahmah, Mei Ling Goh all read “The airline changed the flight schedule.” No “One airline change. Four different trip consequences.” / 4 changed / 3 viable / Sarah critical. Screen: `00-overview.png`, `S-01-overview.png`. Choreography: **Shared incident**. |
| **REC-7-iso-prefill** | Programme preview uses human times 09:20–09:50 → 15:30–16:00; no raw ISO typing required for the hero path. | Preview modal New start / New end are **empty** placeholders `e.g. 1 Oct · 15:30 (or full ISO with offset)`. Browser agent had to type `2026-10-01T15:30:00+08:00`. Screen: `S-05-edit-modal.png`. After typing, Now/Proposed human times work (`S-06-now-proposed.png`). |
| **REC-7-named-distinct-blast** | Preview shows named/distinct affected people and reasons; no duplicate generic rows. | Elena Tan and Sarah Lim both **WATCHING** with identical “Programme commitment moves — engagement times would change.” Proposed does not show Sarah **VIABLE**. Screen: `S-06-now-proposed.png`. After commit, Elena appears in Needs Attention with raw id `el-trip-trv-evt-ait-2026-ait-draft-01-eng-7` (`S-09-overview.png`). |
| **REC-9-operator-cannot-approve-jonas** | Traveller authority only; operator cannot approve as Jonas. | Operator Case exposes traveller-decision **Approve traveller-funded S$731.47** + Decline. Badge is **OPTIONS ON THE TABLE**, not “Waiting for Jonas”. Waiting copy: “organisation or traveller approval”. Screens: `V-02-operator.png`, `V-04-options.png`. Choreography: **Role-correct action**. |
| **REC-9-traveller-exact-mutation** | Traveller decision states the exact mutation: extend Concorde to 4 Oct 11:00, payable, payer, no flight change. | Traveller prompt is “Approve the proposed change (extra cost 731.47 SGD)?” It does **not** say Sunday / 4 Oct. Payable split is present. Current stay still shows 3 Oct 11:00. Screen: `V-06-traveller.png`. |
| **REC-4-contradictory-checks** | Remove contradictory checks such as `No longer meets: timing still works`. | Jordan execute screen still shows two red checks: **“No longer meets: timing still works for the commitment.”** Screen: `J-07-execute.png`. Terminal later shows the good “370 min available / 360 min required — viable” (`J-09-terminal.png`). |
| **REC-3-cta-currency** | Provider payable vs home-policy equivalent are distinct; CTA uses the payable unit. | Labels exist (`US$90.54 payable` / `Approx. S$122.23 policy equivalent`) but primary Approve CTAs use the **policy** amount: `Approve as organiser S$122.23` / `S$193.89` / `Approve traveller-funded S$731.47`. Screens: `J-04-options.png`, `O-02-case.png`, `V-02-operator.png`. |
| **REC-3-options-hidden-until-plan** | Options stay hidden until the planning/reasoning stage unless already-planned is explicit. | Demo reset lands Jordan/Oliver/Jonas already in awaiting-authority with recommended option and “What Northstar is doing right now” leaking 08:20 / HND 02:20 / Concorde extension. No judge-visible baseline → Resolve → plan sequence. Screens: `J-02-case-entry-top.png`, `J-04-options.png`, `O-02-case.png`, `V-04-options.png`. |
| **REC-10-overview-76** | Overview fleet 67 cells; population truth 67 = 42 + 25; no 76 travellers / 67 managed arrivals. | Fleet header is **67 PARTICIPANTS** and readout is 42/25/67, but All travellers pagination copy is **“Page 1 of 8 · 76 travellers”** (DOM: `data-test="roster-page-label"`). Roster has extra `data-roster-name` rows vs 67 fleet cells. Visible if the roster footer is in view; confirmed in live HTML. |
| **REC-8-declared-gateway** | Recommended option names actual route/times; do not say vague `declared departure gateway`. | Oliver recommended title includes **“to fly from the declared departure gateway”**. Screen: `O-02-case.png` (options below the fold in that shot; full wording confirmed on the live Case and in `O-04` Playwright capture). |
| **REC-4-raw-ids-iso** | Remove raw IDs, enum names, raw ISO timestamps. | Elena Overview: `el-trip-trv-evt-ait-2026-ait-draft-01-eng-7` (`S-09-overview.png`). Jonas option title: `through 2026-10-04` (`V-04-options.png`). Sarah hero path required ISO typing (`S-05-edit-modal.png`). |
| **REC-2-browser-rehearsal-truth** | Hero tests assert exact CTA sequence, execute/commit receipt, observed values, terminal topology/stay/programme, reload. Generic words cannot false-pass. | `test/e2e/hero-lifecycle-rehearsal.test.ts` **4 pass** on this SHA while the live UI still shows the failures above. Tests do not assert 15:30 prefill, operator-cannot-approve-Jonas, trip-status Confirmed, execute overlay, or shared-incident grouping. |

### Partial / does not independently block if the rows above are fixed, but still FAIL vs contract

| ID | Why not a pass |
|---|---|
| **REC-5-execution-separate** | Execute CTA exists (good). Overlay does not stay on screen (fail, covered by REC-5-observe-update-visible). |
| **REC-7-commit-progress** | Same as Sarah 220ms flash. Covered by REC-5-observe-update-visible. |
| **REC-7-no-flight-purchase-copy** | Terminal does not claim a new flight purchase, but also does not say “no new flight was bought”; “What changed” still reads “The airline changed the flight schedule.” `S-08-after-commit.png`. |
| **REC-8-topology-delta** | Options describe HND→SIN; NOW chain still shows London inbound until execute. Accepted by presentation lane as risk; still not the required NOW/PROPOSED obsolete-vs-preserve diagram. `O-02-case.png` vs `O-09-terminal.png`. |
| **REC-9-3-oct-baseline-copy** | Traveller itinerary shows `29 Sep · 15:00 → 3 Oct · 11:00` (good). Operator stay card says “4 nights” without 3 Oct 11:00. |
| **REC-9-fireside-satisfied** | Fireside never appears `Not booked`, but it also never appears Scheduled/Confirmed; it stays **DETAILS PENDING** before and after. |
| **REC-10-hover-motion** | Browser agent did not capture hover/focus. Not used to fail the candidate by itself. |

### Pass on this browser pass (do not reopen without new evidence)

- REC-2-cta-exclusive for Jordan/Oliver (Approve vs Execute vs resolved Back to Overview).
- REC-2-resolved-persistence and Overview Confirmed/green for all four after their terminal action (`J-11-overview-confirmed.png`, `S-09-overview.png`, `O-11-overview.png`, `V-12-overview.png`).
- REC-2-deny-decline control present on organiser Cases (`J-04-options.png`); HTTP decline-does-not-execute proven in lifecycle tests and earlier Playwright, not re-clicked in the second browser session.
- REC-6 Jordan: missed NRT→SIN Impacted; TR885 not called inadequate; 08:20 / 14:35 / 20:45 / 370≥360; Approve→Execute→recovered sector CONFIRMED.
- REC-8 US$163.98 is shown as **HND–SGN–SIN (1 stop)**, not as a fake direct. Do not treat that Investigate Now item as a fail.
- REC-9 no “Switch stay to hotel”; no Value Hotel/Sakura/J8 as the hero option; Concorde remains the property; Jonas pays US$541.83; simulated stay update on terminal.
- No product-page demo banner.
- Programme scale 67 / 42 / 25 (`00-programme.png`). Same-named coffee breaks are **different days/IDs**, not venue/tag dupes of one session.
- Traveller dusk asset present (`V-06-traveller.png`).

---

## Four golden paths (browser)

### 1. Jordan Hale S2

| Gate | Result |
|---|---|
| Required initial state | Demo already awaiting organiser approval; NRT→SIN **IMPACTED**; inbound/stay/commitment Pending. No viable-tight-missed progression. |
| CTA sequence | Landed on Approve + Decline (Resolve/Begin already gone). Approve → **Execute approved recovery** → resolved **Back to Overview**. Exclusive. |
| Authority | Organisation approval required. Approve as organiser. Decline present. |
| Execution/commit | Execute clicked. Overlay not visible. |
| Observation/state update | Only visible after navigation as “Rebooking the flight (simulated at provider boundary)” on the resolved Case. |
| Terminal topology | NRT→SIN CONFIRMED 30 Sep 08:20 → 14:35. Showcase 370≥360. Commitment still DETAILS PENDING. |
| Overview | Jordan Confirmed/green; removed from Needs Attention. Search still lists historical NEEDS ATTENTION / RECOVERY UNDER WAY rows. |
| Reload/reopen | `J-10-reload.png`, `J-12-reopen.png`: still RECOVERED, no Resolve/Approve/Execute. |

Screens: `J-01-overview.png` … `J-12-reopen.png`.

### 2. Sarah Lim S1→S3 with NO reset

| Gate | Result |
|---|---|
| Required initial state | Sarah in Needs Attention without search. Shared incident **not grouped**. 09:20 headline, **130 min / 360 min — not enough time**. |
| CTA sequence | Preview programme change (no Resolve). Empty ISO fields. After manual ISO: Preview impact → Commit change (browser confirm) → resolved. **No reset** between S1 and S3. |
| Authority | Organiser commit. Mutation-free banner present. |
| Execution/commit | Commit HTTP 200. No fan-out progress UI. 220ms reload. |
| Observation/state update | Same-trip buffer becomes **500 min / 360 min — viable**. Headline **1 Oct · 15:30**. |
| Terminal programme | Programme timeline shows 15:30 (`S-12-programme.png`). Case resolved, no second Resolve. |
| Overview | Sarah Confirmed. Elena Needs Attention with raw engagement id. Wanderpay speakers remain equally red. |
| Reload/reopen | `S-10-reopen.png`: resolved, Back to Overview only. |

Screens: `S-01-overview.png` … `S-12-programme.png`.

### 3. Oliver Bennett S7

| Gate | Result |
|---|---|
| Required initial state | London inbound + SIN→LHR return both visible, both PENDING. Traveller message (HND, keep LHR) in the waiting banner. |
| CTA sequence | Approve as organiser → Execute approved recovery → resolved. |
| Authority | Organisation approval required. No HUMAN_AGENT string. CTA uses S$193.89. |
| Execution/commit | Execute clicked. Overlay not visible. |
| Observation/state update | Inbound becomes Tokyo Haneda 29 Sep 02:20 CONFIRMED. |
| Terminal topology | London inbound gone as current. LHR return **still present** but **PENDING**. Stay/commitment PENDING. |
| Overview | Oliver Confirmed/green. |
| Reload/reopen | `O-10-reload.png`, `O-12-reopen.png`: resolved. |

Screens: `O-01-overview.png` … `O-12-reopen.png`.

### 4. Jonas Berg S5

| Gate | Result |
|---|---|
| Required initial state | Needs Attention: stay approval S$731.47. Operator Case: extend Concorde, not hotel switch. |
| CTA sequence | **Wrong principal on operator** (Approve traveller-funded). Correct path used: Traveller Approve → Case already resolved (auto-execute). No separate Execute overlay. |
| Authority | Traveller required in copy, but operator can impersonate. |
| Execution/commit | Traveller POST auto-resolves. Overlay not visible. |
| Observation/state update | Stay CONFIRMED, **5 nights**, traveller itinerary **→ 4 Oct · 11:00**. |
| Terminal stay | Same Concorde. Jonas pays US$541.83. Simulated hotel update. Fireside DETAILS PENDING. No place-hotel- id. |
| Overview | Jonas Confirmed/green (`V-12-overview.png`). |
| Reload/reopen | `V-13-reopen.png`: no stale Approve/Decline/Resolve. |

Screens: `V-01-overview.png` … `V-13-reopen.png`.

---

## Act Now visual review (reconciliation §§2–10)

Reviewed against the live screenshots in `output/hero-acceptance/browser/`, not against lane self-certification.

| Section | Closed on this SHA? |
|---|---|
| §2 Lifecycle/state | **No.** Persistence/Execute reachability mostly yes; trip-status, programme engagement, observe-phase, rehearsal-truth no. |
| §3 Options/money | **No.** Structured option fields exist; CTA currency and option-leak fail. |
| §4 Natural language | **No.** HUMAN_AGENT gone; contradictory checks, raw IDs, ISO, generic Authority card remain. |
| §5 Progress | **No.** Overlay does not survive execute/commit navigation. |
| §6 Jordan golden path | **No.** Recovered sector yes; status semantics + observe phase + check copy no. |
| §7 Sarah golden path | **No.** Same-trip 15:30 resolve yes; grouping, prefill, blast-radius, commit progress no. |
| §8 Oliver golden path | **No.** Tokyo+LHR topology after execute yes; gateway wording, pending return, overlay no. |
| §9 Jonas golden path | **No.** Concorde extension + funding + revisit yes; operator impersonation + traveller mutation copy + fireside pending no. |
| §10 Overview/Programme/Traveller visual | **Partial.** 67 fleet, recovered two-column Case, dusk hero, no demo banner. 76-traveller footer, shared-incident grouping, hover not proven. |

§11 matrix-truth items remain **reopened**. Fresh browser evidence contradicts treating O1–O3 / C1 / J5 / S1–S3 / G2–G3 / T1 as PASS.

§12 Investigate Now: Jonas persistence regression **did not reproduce** (reopen stayed resolved). Stay remains Concorde. Sarah fan-out set is Elena + Sarah. Generic Authority card is still static policy copy. Jordan/Oliver option leak is precomputed already-planned state after demo reset. Oliver US$163.98 is 1-stop (do not fail as direct). Jordan inadequate-TR885 story correctly **not** claimed.

---

## Tests run after browser (not a substitute for the fails above)

On SHA `2a24f6b`, after the Chrome walkthrough:

```
node --experimental-strip-types --test \
  test/e2e/hero-lifecycle-rehearsal.test.ts \
  test/final-demo-lifecycle-convergence.test.ts \
  test/presentation-lane.test.ts \
  test/hero-business-truth.test.ts \
  test/final-demo-s1-s3-continuity.test.ts
```

**18 pass / 0 fail.**

`npm run typecheck` — pass.  
`npm run build` — pass.

These results prove engine/lifecycle wiring. They do **not** close REC-2-trip-status, REC-5-observe-update-visible, REC-7-*, REC-9-operator-cannot-approve-jonas, or REC-10-overview-76.

---

## Documentation / product code

- Product code: **not modified**.
- This file is the acceptance record.
- Browser evidence: `output/hero-acceptance/browser/*.png` (pass 1) and `output/hero-acceptance/live/*.png` (pass 2). Walker notes under `live/*.md` are **not** SSOT.

## Next dependent action

Return the presentation/lifecycle/hero-truth owners to the **FIX REQUIRED** IDs above on `2a24f6b` (or a successor SHA of this candidate). Independent acceptance should re-run **only** the failed checklist IDs in a live browser. Do not treat another test-suite green as closure.

---

## Second live Chrome pass (same SHA, fresh reset)

Clicked in Chrome by a Composer computer-use agent. Independently reviewed from the PNGs in `output/hero-acceptance/live/`, not from `FINAL-REPORT.md`.

Same-world order, no reset between paths: Overview/Programme → Jordan Approve→Execute → Sarah preview/commit → Oliver Approve→Execute → Jonas traveller Approve.

### Confirmed again from the pixels

| ID | Pass-2 evidence |
|---|---|
| **REC-2-trip-status** | Jordan entry: LAX→NRT **FLIGHT STATUS PENDING**, NRT→SIN **IMPACTED**, hotel **HOTEL CONFIRMATION PENDING**. Oliver terminal: HND→SIN **CONFIRMED** 02:20, SIN→LHR still **FLIGHT STATUS PENDING**. Jonas operator: AMS flights + Concorde **PENDING**. `J-02-case-entry-top.png`, `O-09-terminal.png`, `V-02-operator.png`. |
| **REC-2-programme-engagement** | Finals Showcase / Headline / Debate / Fireside remain **DETAILS PENDING** on entry and after recover. Sarah recovered commitment still **DETAILS PENDING** at 16:00. `J-02-case-entry-top.png`, `S-08-after-commit.png`, `O-09-terminal.png`, `V-02-operator.png`. |
| **REC-5-observe-update-visible** | Execute/commit overlay files are byte-identical to the terminal frames: `J-08-overlay.png`=`J-09-terminal.png`, `S-07-commit-progress.png`=`S-08-after-commit.png`, `O-08-progress.png`=`O-09-terminal.png`, `V-08-progress.png`=`V-07-traveller-after.png`. |
| **REC-7-shared-incident** | Needs Attention is a flat list. Arjun / Siti / Sarah / Mei Ling each: “The airline changed the flight schedule.” `00-overview.png`. |
| **REC-7-iso-prefill** | Preview modal New start/end empty; placeholders `e.g. 1 Oct · 15:30 (or full ISO with offset)`. Walker had to type ISO. `S-05-edit-modal.png`. |
| **REC-7-named-distinct-blast** | Elena and Sarah both **WATCHING** with identical “Programme commitment moves — engagement times would change.” Proposed shows **Reschedule · 16:00**, not Sarah **VIABLE**. After commit, Elena Needs Attention with raw id. `S-06-now-proposed.png`, `S-09-overview.png`. |
| **REC-9-operator-cannot-approve-jonas** | Operator Case badge **OPTIONS ON THE TABLE**. Primary button **Approve traveller-funded S$731.47** + Decline. `V-02-operator-scroll.png`. |
| **REC-9-traveller-exact-mutation** | Prompt: “Approve the proposed change (extra cost 731.47 SGD)?” Does not say Sunday / 4 Oct / Concorde. Payable split US$541.83 is on the card. Stay still 3 Oct until after Approve. `V-06-traveller.png`. |
| **REC-4-contradictory-checks** | After Jordan Approve: two red “No longer meets: timing still works for the commitment.” `J-06-after-approve.png`. |
| **REC-3-cta-currency** | Labels show US$ payable vs S$ policy, but primary buttons are **Approve as organiser S$122.23** / **S$193.89** / **Approve traveller-funded S$731.47**. `J-04-options.png`, `O-02-case.png`, `V-02-operator-scroll.png`. |
| **REC-3-options-hidden-until-plan** | Demo reset still lands Jordan/Oliver/Jonas on **OPTIONS ON THE TABLE** with recommended option already visible. `J-02-case-entry-top.png`, `O-02-case.png`, `V-02-operator.png`. |
| **REC-10-overview-76** | Fleet **67 PARTICIPANTS**; roster footer **Page 1 of 8 · 76 travellers**. `00-overview.png`, `00-overview-roster.png`. |
| **REC-8-declared-gateway** | Recommended title: “Rebook HND→SIN (direct) to fly from the **declared departure gateway**, departing at 02:20”. `O-02-case-scroll.png`. |
| **REC-4-raw-ids-iso** | Elena: `el-trip-trv-evt-ait-2026-ait-draft-01-eng-7` (`S-09-overview.png`). Jonas option: “through **2026-10-04**” (`V-04-options.png`). Sarah hero path required ISO typing. |

### What still works (still not enough)

- Jordan: Approve → **Execute approved recovery** → NRT→SIN **CONFIRMED** 08:20→14:35, 370≥360, Overview Confirmed 31/42, reload stays resolved (`J-09-terminal.png`, `J-10-reload.png`, `J-11-overview-confirmed.png`).
- Sarah, no reset: 130/360 fail → ISO typed 15:30–16:00 → commit → **530 min / 360 viable**, Case resolved, Sarah off Needs Attention (`S-02-case.png`, `S-08-after-commit.png`, `S-09-overview.png`). Proposed/timeline surface **16:00** (end), not 15:30 start.
- Oliver: Approve → Execute → Tokyo Haneda inbound **CONFIRMED** 02:20; LHR return still present; Overview 33/42 (`O-09-terminal.png`, `O-11-overview.png`). US$163.98 remains 1-stop in walker notes; not re-failed as a fake direct.
- Jonas: operator Approve **not clicked**; traveller Approve → Concorde **CONFIRMED** 29 Sep 15:00 → **4 Oct 11:00**; Overview 34/42, Jonas gone from Needs Attention (`V-07-traveller-after.png`, `V-12-overview.png`). Dusk hero present. No HUMAN_AGENT copy seen.

### Do not treat as product fails

- **S-10-reopen.png** “case details unavailable”: walker URL is `case-tip-trv-...` (typo) vs the live Case `case-trip-trv-...` in `S-05-edit-modal.png` / `S-08-after-commit.png`.
- **V-10-terminal.png** / **V-11-reload.png**: walker URL `...-cr-at-s5-001` vs the operator Case `...-cr-ait-s5-001` in `V-02-operator-scroll.png`. Traveller + Overview already show the stay resolved.

Pass 1 reopen via Overview for Jordan/Oliver/Jonas remains the persistence evidence. Pass 2 Jordan reload (`J-10-reload.png`) still holds.
