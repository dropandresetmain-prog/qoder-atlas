# WiT DEMO WORLD / PROGRAMME SEED FREEZE v1

**Base:** `integration/m7-m8-c3` @ `f8103379ed2426d442d342895e9e1d1573f875da`  
**Principle:** freeze the world; do not freeze answers.  
**No files edited.**

---

## 1. Final organiser policy / readiness rule

| Field | Freeze |
|-------|--------|
| Rule id | `rule-ait-arrival-min-buffer` (replace current 360) |
| `minBufferMinutes` | **150** |
| Composition (documentation only) | 45 landside + 40 airportâ†’venue + 45 speaker-ready + 20 contingency |
| **Scope** | **REQUIRED on-stage participants only** â€” engagements with `importance = REQUIRED` and an on-stage role (`SPEAKER`, `INTERVIEWER`, `MODERATOR`, `HOST`, `FINALIST`, `PANELLIST` when REQUIRED, etc.) |
| Does **not** apply by | traveller name, route, scenario id, flight number, or nationality |
| Does **not** apply to | `PREFERRED` / `OPTIONAL` engagements (unless later elevated) |
| Retire | 360 standard, 720 programme-critical clause as demo policy; `REQUIRED_BUFFER_MIN = 360` hardcode |

**Scope confirmation:** one generic organiser MIN_BUFFER rule; applicability is importanceÃ—on-stage, never hero-specific.

---

## 2. Final complete programme schedule (demo-relevant sessions)

### Day 0 â€” 30 Sep (Jordan)

| Commitment | Time (SGT) | Place | Notes |
|------------|------------|-------|-------|
| `cmt-ait-d0-hackathon-lab` | 11:15â€“12:00 | keep | PREFERRED/CHANGEABLE for attendees; **Jordan not bound** |
| `cmt-ait-d0-seedup-showcase` | 15:10â€“15:50 | keep | **not** Jordanâ€™s gate |
| `cmt-ait-d0-hackathon-finals` | **20:45â€“21:05** | `place-mbs` | Jordan REQUIRED FINALIST |

### Day 1 â€” 1 Oct (Sarah arc) â€” frozen rebuild

| Commitment | Time | Occupant / change |
|------------|------|-------------------|
| Opening / early morning block | â‰¤11:00 | keep except Sarah leaves 09:20 |
| `cmt-ait-d1-coffee-1` | 11:00â€“11:30 | keep SOCIAL |
| **`cmt-ait-d1-headline-interview`** | **11:30â€“12:00** | **Sarah + Elena** (was 09:20; absorbs former 11:30 agentic window) |
| Post-headline / lunch lead-in | 12:00â€“13:30 | retime `ota-chat` so Elena is free 11:30â€“12:00 (see Â§20) |
| `cmt-ait-d1-build-interview` | 13:30â€“13:50 | keep |
| `cmt-ait-d1-payments-keynote` | 13:50â€“14:00 | Arjun REQUIRED |
| `cmt-ait-d1-payments-panel` | 14:00â€“14:30 | Arjun + Siti + Mei Ling (**all REQUIRED** under freeze) |
| **`cmt-ait-d1-local-host-session`** (new id or remapped Daniel session) | **14:30â€“15:00** | **Daniel Ong** LOCAL, REQUIRED, **CHANGEABLE** â€” swap counterpart |
| Coffee / trust research | 15:00â€“15:30 | adjust edges only |
| `cmt-ait-d1-recovery-fireside` | **15:30â€“16:00** | Jonas + Elena (moved off 14:30 for stage exclusivity) |
| `cmt-ait-d1-search-chat` | **16:05â€“16:25** (or next free main-stage slot) | Ethan + Elena â€” no overlap with fireside |
| Later Day 1 | keep | distribution / close |

**Retired Day 1 facts:** Sarah 09:20; S3 RESCHEDULE-to-15:30; Felix REQUIRED at 10:10 / 11:30 while on disrupted inbound.

---

## 3. Final participant / session assignments

| Person | draftId | Demo-critical assignments |
|--------|---------|---------------------------|
| Sarah Lim | `ait-draft-14` | SPEAKER REQUIRED/FIXED on headline 11:30â€“12:00 |
| Elena Tan | `ait-draft-01` | INTERVIEWER REQUIRED on headline; also fireside 15:30 + search later â€” **no simultaneous double-book** |
| Daniel Ong | `ait-draft-02` | LOCAL host SPEAKER/HOST on **14:30â€“15:00** CHANGEABLE (swap counterpart). Keep marketplace morning only if it does not collide |
| Arjun Rao | `ait-draft-10` | REQUIRED keynote 13:50 + panel mod 14:00 |
| Siti Rahmah | `ait-draft-11` | **Elevate** panel to REQUIRED |
| Mei Ling Goh | `ait-draft-30` | **Elevate** panel to REQUIRED |
| Felix Hartono | `ait-draft-03` | **Remove** Day 1 morning REQUIRED (india / agentic). Keep Day 2 ota-panel REQUIRED. Optionally PREFERRED only on Day 1 afternoon |
| Jonas Berg | `ait-draft-35` | recovery-fireside **15:30â€“16:00** (stage move only) |
| Ethan Yap | `ait-draft-34` | search-chat after fireside; finals FINALIST Day 0 |
| Jordan Hale | `ait-draft-09` | finals 20:45 REQUIRED; awards Day 2; **no lab** |
| Jeremy Teo | `ait-draft-43` | **not** Sarah swap counterpart (Day 2 only) |

India-fireside / agentic speakers: reassigned to **non-cohort locals** (not on Sarahâ€™s inbound). Exact names: implementer choice among existing locals; not Jeremy.

---

## 4. Local / inbound classification

| Person | Class | Basis |
|--------|-------|-------|
| Elena Tan | LOCAL | SG home, self-arranged |
| Daniel Ong | LOCAL | SG home, self-arranged |
| Jeremy Teo | LOCAL | SG, Day 2 only |
| Sarah, Felix, Arjun, Siti, Mei Ling | INBOUND managed | CGK, NORTHSTAR_ARRANGED |
| Jordan | INBOUND managed | LAX origin, NORTHSTAR_ARRANGED; **nationality SG** |
| Jonas | INBOUND | AMS (unchanged) |
| Owen / Ethan / finals judges | as today | finals blast radius only |

---

## 5. Sarah baseline travel

| Field | Freeze |
|-------|--------|
| Corridor | CGK â†’ SIN |
| **Intended original service** | **Batik Air ID7159**, 2026-09-30 **17:45 â†’ 20:30** |
| Fare / booking | ticketed CONFIRMED; per-person PNRs (separate booking refs) |
| Stay | partner hotel from **30 Sep evening** (arrival-driven) â†’ 3 Oct |
| Programme before trigger | headline 11:30 next day |
| Expected runtime (not seeded) | VIABLE under 150 |

### Provider evidence (critical)

| Candidate | Repo evidence |
|-----------|---------------|
| **ID7159 / ID7153 / Batik** | **None** â€” 0 hits |
| **TR279 â†’ ID7153** | **None** â€” 0 hits |
| Current pack/fixtures | Synthetic **MN310** CGK |
| Atlas REPLAY | Stale **MN218** KUL for MNSYN* |

**Freeze decision:** adopt Batik ID7159â†’ID7153 **times and same-carrier story** as the target world. **Do not claim provider-backed until Atlas Search/Verify recordings exist.** Do not fabricate. Fixture edit is **blocked** on evidence capture (or an explicit Accept Risk to keep synthetic flight numbers with these times).

---

## 6. Sarah five-person shared cohort

| Traveller | draftId | Earliest Day 1 REQUIRED after freeze | Gap after ID7153 10:30 | Expected runtime |
|-----------|---------|--------------------------------------|------------------------|------------------|
| Sarah Lim | 14 | 11:30 headline | 60 < 150 | NOT_VIABLE |
| Arjun Rao | 10 | 13:50 keynote | 200 â‰¥ 150 | VIABLE |
| Siti Rahmah | 11 | 14:00 panel REQUIRED | 210 â‰¥ 150 | VIABLE |
| Mei Ling Goh | 30 | 14:00 panel REQUIRED | 210 â‰¥ 150 | VIABLE |
| Felix Hartono | 03 | no Day 1 REQUIRED (Day 2 only) | n/a Day 1 | VIABLE |

**Demo counts:** 5 affected bookings; 1 disrupted (Sarah); 4 still on track.  
**Shared service:** same original + same involuntary replacement; distinct PNRs.

---

## 7. Sarah disruption input

| Step | Seed fact |
|------|-----------|
| Event | Synthetic cancellation of ID7159 (or frozen flight id once evidenced) |
| Airline action | Synthetic involuntary reprotection onto **ID7153** 2026-10-01 **07:45 â†’ 10:30** |
| Fare delta | 0 (disruption reprotection) |
| Booking state after | all five remain CONFIRMED / valid on replacement |
| Inventory for paid alternatives | may exist; higher cost â€” seed as provider offers, not â€œbest answerâ€ |

---

## 8. Sarah differentiated post-change invariants

Runtime-derived (do not seed labels):

- All five trips: booking valid  
- Sarah vs 11:30 + 150 â†’ NOT_VIABLE  
- Four others â†’ VIABLE  
- Blast radius from shared dependency, not hardcoded list in domain logic  

---

## 9. Sarah programme swap

| | Current | Proposed |
|--|---------|----------|
| 11:30â€“12:00 | Sarah headline | **Daniel** local host session |
| 14:30â€“15:00 | Daniel local host | **Sarah** headline |

**Jeremy Teo rejected:** only Day 2 `cmt-ait-d2-superapp-chat`; no Day 1 relationship; would invent linkage.  
**Daniel Ong selected:** existing local co-host; already annotated as S3 CHANGEABLE partner; no inbound dependency.

Avoid: third-speaker substitution; coffee moves; Jonas as swap partner.  
**Jonas 14:30â†’15:30** is allowed only as **stage exclusivity** for the Daniel slot (see Â§20), not as Sarahâ€™s swap counterpart.

S3 mechanism: bilateral programme change preview/commit (or RESCHEDULE pair encoded as two commitment moves). Retire single RESCHEDULE-to-15:30 story.

---

## 10. Sarah preview affected-person set

Must be in preview blast radius:

1. Sarah (`ait-draft-14`)  
2. Daniel (`ait-draft-02`)  
3. Elena on headline (moves with Sarahâ€™s session)  
4. Any interviewer/moderator on Danielâ€™s 14:30 session (if not Elena-only)  
5. Jonas + Elena on fireside **only if** fireside time also changes in the same preview (if fireside already at 15:30 in baseline, not affected by swap)

Not required solely because of Sarah travel: Wanderpay cohort, Felix (travel unchanged by programme swap).

Preview: **zero authoritative mutation** until commit.

---

## 11. Sarah final-state invariants

After commit + observe (runtime):

- Same Sarah trip id; **no new Sarah flight purchased**  
- Sarah VIABLE at 14:30 under 150 (gap from 10:30 = 240)  
- Daniel VIABLE (local)  
- Elena viable (no double-book)  
- Four cohort travellers remain VIABLE  
- Jonas remains VIABLE on 15:30 fireside  

---

## 12. Jordan baseline itinerary

| Leg | Freeze |
|-----|--------|
| ZG023 | LAXâ†’NRT 2026-09-28 10:55 âˆ’07 â†’ 2026-09-29 14:10 +09 |
| ZG053 | NRTâ†’SIN 2026-09-29 16:50 +09 â†’ 23:00 +08 |
| Connection | **160 min** |
| Evidence | Atlas Search `rec_34518610â€¦` (ZG053); accept unless new contradiction found |
| PNR | `ZGSYN09` |
| Nationality | **`["SG"]`** (retire US for WiT MVP) |
| Home / origin | Keep LAX as trip origin; do **not** seed visa/entry requirements |

---

## 13. Jordan progressive delay inputs

| Id | Arrival NRT | Connection left | Narrative |
|----|-------------|-----------------|-----------|
| D1 | ~15:25 | 85 | SAFE |
| D2 | ~16:20 | 30 | AT_RISK |
| D3 | ~17:55 | ZG053 impossible | TR875 available |
| D4 | ~20:40 / ops delay | TR875 21:15 unboardable | overnight NRT required |

Map onto existing stage file; retire conflicting â€œsame_night still viableâ€ as terminal if it contradicts D4. Status labels (SAFE/AT_RISK/â€¦) are **runtime-derived**.

---

## 14. Jordan airline-default recovery

| Field | Freeze |
|-------|--------|
| Flight | **TR867** NRTâ†’SIN 30 Sep **12:30 â†’ 20:45** |
| Role | Airline involuntary default (may be synthetic assignment onto real inventory) |
| Evidence | Atlas `rec_71d6274â€¦` Wave4 next-day search |
| vs finals 20:45 + 150 | gap **0** â†’ runtime NOT_VIABLE |

**Retire:** current pack role `AIRLINE_DEFAULT_MORNING` on **TR885**.

---

## 15. Jordan NORTHSTAR-selected recovery

| Field | Freeze |
|-------|--------|
| Flight | **TR885** 30 Sep **08:20 â†’ 14:35** |
| Role | NORTHSTAR-selected plan option (not airline default) |
| Evidence | same `rec_71d6274â€¦` |
| vs finals 20:45 + 150 | gap **370** â†’ runtime VIABLE |
| Side effects | Narita overnight required; Singapore stay date shift; transfer redispatch |

Temporary same-night: **TR875** 29 Sep 21:15 â†’ 30 Sep 05:20 â€” available after D3, eliminated after D4 (`rec_34518610â€¦`).

---

## 16. Jordan programme commitments

| Commitment | Importance | Freeze |
|------------|------------|--------|
| `cmt-ait-d0-hackathon-finals` 20:45â€“21:05 | REQUIRED/FIXED | keep |
| `cmt-ait-d0-hackathon-lab` | â€” | **Jordan unbound**; others PREFERRED/CHANGEABLE |
| Any 15:10 â€œJordan hard gateâ€ | â€” | **retire** (Seedup/pitch only) |
| `cmt-ait-d2-hack-awards` | REQUIRED | keep |

Linked finals cast (unchanged): Owen, Ethan finalists; judges Victor, Kenji, Wei Lin, Ingrid.

---

## 17. Jordan Narita stay

| Field | Freeze |
|-------|--------|
| Property | Narita Gateway Hotel |
| Provider id | `lp3a92f` |
| Dates | **29 Sep â†’ 30 Sep** |
| Rate evidence | USD **32.03**, RFN (sandbox) |
| Demo need | **book and keep** overnight â€” not cancel-for-demo |

---

## 18. Jordan Singapore baseline / recovered stay

| State | Property | Provider | Dates |
|-------|----------|----------|-------|
| Baseline | Concorde Hotel Singapore | `lp21d9f` | **29 Sep â†’ 3 Oct** |
| Recovered | same | `lp21d9f` | **30 Sep â†’ 3 Oct** |
| Mechanism | replacement book â†’ observe CONFIRMED â†’ cancel displaced original â†’ observe CANCELLED | | |

**Retire:** check-in 30 Sep baseline; â€œSingapore stay: no change requiredâ€ as the Jordan demo truth.

**Evidence-pending:** original total/refund, final booking ids, exact economics â€” do not invent.

---

## 19. Jordan ground-transfer timing

| State | Pickup |
|-------|--------|
| Baseline | Changi ~ **29 Sep 23:30** (after ZG053 23:00) |
| Recovered | Changi ~ **30 Sep 15:00â€“15:30** (after TR885 14:35) |

Dependency/state change required. Exact transfer-provider txn optional if generic support already covers redispatch.

---

## 20. Programme-wide collision / integrity audit

| Check | Result | Triage |
|-------|--------|--------|
| Sarah 11:30 vs Felix agentic 11:30 | Must displace Felix/agentic | **Act Now** |
| Elena headline 11:30â€“12:00 vs ota-chat 11:50 | Overlap | **Act Now** â€” move ota or reassign interviewer |
| Daniel 14:30 vs Jonas fireside 14:30 (fixtures) | Same `place-mbs` | **Act Now** â€” fireside â†’ 15:30 |
| Jonas 15:30 vs Ethan search 15:30 | Same stage | **Act Now** â€” shift search after fireside |
| Elena fireside 15:30 vs Sarah post-swap 14:30 | OK if fireside stays 15:30 | OK |
| Payments 14:00â€“14:30 vs Daniel 14:30 | Adjacent OK | OK |
| Cohort REQUIRED on afternoon vs 10:30 arrival | Pass margins â‰¥200 | OK |
| Felix morning REQUIRED + cohort | Would fail | **Act Now** â€” remove |
| Siti/Mei Ling PREFERRED only | Would escape 150 rule | **Act Now** â€” elevate REQUIRED |
| Jordan lab + TR885 14:35 | Lab 11:15 would fail | **Act Now** â€” keep unbound |
| Finals judges/finalists one slot | Shared by design | **Ignore / Accept Risk** |
| Transport concentration max 2 REQUIRED / booking_ref | Separate PNRs | OK |
| Rooms/tracks | Single `place-mbs` â€” exclusive | treat as exclusive resource |

---

## 21. Baseline viability audit

Before any trigger, under 150 + frozen times:

| Traveller | Baseline arrival | First REQUIRED | Expected |
|-----------|------------------|----------------|----------|
| Sarah | ID7159 20:30 on 30 Sep | 11:30 Day 1 | VIABLE |
| Arjun / Siti / Mei Ling / Felix | same | afternoon or Day 2 | VIABLE |
| Daniel | local | 14:30 | VIABLE |
| Elena | local | many | VIABLE |
| Jordan | ZG053 23:00 on 29 Sep | finals 20:45 Day 0 | VIABLE (â‰«150) |
| Jonas | AMS early 30 Sep | fireside 15:30 Day 1 | VIABLE |

Do not seed broken baselines.

---

## 22. Runtime-derived vs seeded facts

**Seed:** schedules, bookings, policies, roles/importance, source events, inventory offers, hotel reservations, transfer intents, programme constraints.

**Do not seed:** VIABLE/NOT_VIABLE/SAFE/AT_RISK labels; blast-radius membership as domain truth; best strategy; ranking; approval outcome; recovered status; case resolution.

---

## 23. Provider evidence / provenance matrix

| Fact | Provenance | Strength |
|------|------------|----------|
| ZG023/ZG053 times | Atlas Search recording | Strong |
| TR875 / TR885 / TR867 times | Atlas Search recordings | Strong |
| Narita `lp3a92f` 32.03 RFN | NuitÃ©e book/retrieve | Strong |
| Concorde `lp21d9f` identity | places + search samples | Strong for property |
| ID7159 / ID7153 | â€” | **None â€” pending** |
| TR279 | â€” | **None** |
| MN310 | Synthetic pack | Narrative only |
| MN218 | Atlas REPLAY | Strong but **wrong corridor** vs CGK target |
| Wave4 output JSONs cited in S2 pack | Missing from worktree | Weak / pending |
| Jordan Concorde economics after rebook | â€” | Pending |

---

## 24. Evidence-pending values

1. Atlas Search/Verify for **ID7159** and **ID7153** (or accept synthetic ids with frozen times â€” explicit risk)  
2. Jordan Concorde **baseline rate, refund, booking ids** after 29â†’3 Oct geometry  
3. Recovered Concorde booking ids / cancel observation payloads  
4. Private verify / `output/wave4r-s2-*` artifacts referenced but absent  
5. Optional live Timatic â€” out of scope (do not introduce)

---

## 25. Exact stale values to retire

- `minBufferMinutes` / `REQUIRED_BUFFER_MIN` / prose **360** and clause **720** as WiT demo policy  
- Sarah **09:20** headline  
- S3 target **15:30** RESCHEDULE-only recovery  
- **MN310** / **MN218** as final Sarah corridor story  
- Acceptance **4** travellers (drop Felix) vs scenario **5**  
- Jordan finals **15:10**; lab binding; nationality **US**  
- Airline-default **TR885**; TR867-as-mere-alternative  
- Jordan SIN stay start **30 Sep**; â€œno change requiredâ€ as S2 hero truth  
- Chloe Martin / Grace Nakamura S3-record hero leftovers  
- Input-pack vs fixtures afternoon order drift (fireside/search)

---

## 26. Exact repository files requiring changes

*(inventory only â€” not edited)*

**Policy / programme SSOT**  
- `data/ait-demo-input-pack/global/organiser-policy.json`  
- `data/ait-demo-input-pack/global/operational-constraints.json`  
- `data/ait-demo-input-pack/global/anchor-event.json`  
- `data/ait-demo-input-pack/global/programme.json`  
- `data/ait-demo-input-pack/global/programme-importance.json`  
- `data/ait-demo-input-pack/global/roster.json`  
- `data/ait-demo-input-pack/global/places.json` (Concorde naming)  
- `fixtures/programmes/ait-summit-2026/programme.json`  
- `fixtures/programmes/ait-summit-2026/booking-dossiers.json`  
- `scripts/reconcile-final-demo-content.mjs`

**S1 / S3 packs**  
- `data/ait-demo-input-pack/scenarios/s1-supplier-disruption/**`  
- `data/ait-demo-input-pack/scenarios/s3-event-change-preview/**`

**S2 packs**  
- `data/ait-demo-input-pack/scenarios/s2-missed-connection/**` (roles TR867/TR885, stay dates, D4, nationality notes)

**Acceptance / tests**  
- `fixtures/acceptance/manifests/s1-*.json`, `s1-s3-continuity.json`, `s3-*.json`, `s2-*.json`  
- `fixtures/acceptance/packs/s1|s2|s3/pack.json`  
- `test/final-demo-content-coherence.test.ts`  
- `test/final-demo-s2-pack.test.ts`  
- `test/hero-business-truth.test.ts`  
- `test/s2-overnight-hotel-closure.test.ts`  
- `test/presentation-lane.test.ts`  
- `test/case-lifecycle-state.test.ts`  
- `test/e2e/hero-lifecycle-rehearsal.test.ts`  
- related S1/S2/S3 lifecycle tests

**Application hardcode**  
- `src/app/eventChangePreview.ts` â€” `REQUIRED_BUFFER_MIN = 360` â†’ policy-driven  
- `src/app/wholeTripRecoveryPlan.ts` â€” Jordan path must allow stay **change** when check-in moves (generic behaviour, not hero hardcode)

**Docs**  
- `docs/SCENARIOS.md`  
- missing `docs/FINAL_DEMO_CONTENT_SSOT.md` (referenced by scripts)

**Evidence**  
- Rebuild/replace MN218 `recordings/atlas/flight_state_query/*` for Sarah corridor  
- Capture Batik Search recordings before claiming provider-backed  
- New NuitÃ©e recordings for Concorde 29â†’3 Oct / 30â†’3 Oct cancel+rebook

**Cross-scenario**  
- `data/ait-demo-input-pack/scenarios/s8-speaker-group-travel/**` (KUL MN218 vs CGK cohort)

---

## 27. Acceptance invariants

### Sarah
1. Baseline: five inbound VIABLE  
2. After cancel+reprotect: five bookings valid; Sarah NOT_VIABLE; four VIABLE  
3. Travel-buy option exists but programme swap preferred by evaluation (not hardcoded)  
4. Preview: no mutation; Sarah+Daniel(+linked mods) projected VIABLE  
5. Commit: Sarah trip VIABLE without new flight; cohort unchanged viable  

### Jordan
1. Baseline ZG023/ZG053 VIABLE  
2. D1 SAFE â†’ D2 AT_RISK â†’ D3 miss + TR875 â†’ D4 overnight  
3. Airline TR867 booking â†’ trip NOT_VIABLE vs 20:45 + 150  
4. NORTHSTAR TR885 plan â†’ flight viable; Narita required; SIN stay affected; transfer affected; finals viable  
5. Execute/observe: trip recovered only when all required observations succeed  

---

## 28. Risks / issues

| Issue | Class | Why |
|-------|-------|-----|
| No Batik/TR279 provider evidence | **Act Now** | Cannot freeze â€œprovider-backedâ€ flights without capture or explicit synthetic Accept Risk |
| Elena 11:30 vs ota-chat overlap | **Act Now** | Breaks interviewer integrity |
| Jonas/Ethan/Daniel main-stage collisions | **Act Now** | Must retimeslot before seeding |
| Felix morning REQUIRED on cohort flight | **Act Now** | Breaks â€œ4 viableâ€ |
| Siti/Mei Ling PREFERRED escapes 150 scope | **Act Now** | Weakens shared-rule demo |
| TR885 still labeled airline-default in pack | **Act Now** | Contradicts target story |
| Jordan stay 30 Sep + â€œno changeâ€ | **Act Now** | Hides stay consequence |
| Input pack vs fixtures dual SSOT | **Act Now** | Seed edits will diverge again |
| `REQUIRED_BUFFER_MIN = 360` in src | **Act Now** | Hardcodes retired policy |
| Missing Wave4 output / private verify files | **Investigate Now** | Cited evidence not in tree |
| S8 KUL vs S1 CGK for same drafts | **Investigate Now** | Cross-scenario collision |
| Transport concentration vs many REQUIRED on one service | **Park for Later** | Scope is booking_ref; separate PNRs OK |
| 720 clause leftover in prose | **Park for Later** | Remove with policy rewrite |
| Chloe/Grace leftover notes | **Park for Later** | Docs/debt |
| Three finalists one finals slot | **Ignore / Accept Risk** | By design |
| Narita stay kept (not cancelled) | **Ignore / Accept Risk** | Matches demo need |

---

## FINAL SEED CONTRACT

Machine-implementable freeze list:

1. `MIN_BUFFER.minimumMinutes = 150`, applies only to `importance=REQUIRED` on-stage engagements.  
2. Sarah headline `cmt-ait-d1-headline-interview` = **2026-10-01T11:30+08 â†’ 12:00+08**; Elena INTERVIEWER REQUIRED.  
3. Daniel local CHANGEABLE session = **14:30â€“15:00** same day; swap counterpart for S3.  
4. Jonas `cmt-ait-d1-recovery-fireside` = **15:30â€“16:00**; Ethan search after it; no main-stage double-book.  
5. Cohort flights (target): **ID7159** 2026-09-30 17:45â†’20:30; reprotect **ID7153** 2026-10-01 07:45â†’10:30; fareÎ”=0; five PNRs: drafts **14,03,10,11,30**.  
6. Evidence gate: Batik recordings **required** before calling flights provider-backed; else explicit synthetic Accept Risk.  
7. Cohort Day 1 REQUIRED earliest: Sarah 11:30; Arjun 13:50; Siti/Mei Ling 14:00 REQUIRED; Felix **no** Day 1 REQUIRED.  
8. S3 = bilateral time swap Sarahâ†”Daniel; not RESCHEDULE-to-15:30.  
9. Jordan nationality `SG`; itinerary ZG023/ZG053 as above; finals **20:45â€“21:05** REQUIRED; no lab.  
10. Delay stages D1â€“D4 as Â§13; TR875 temp; airline default **TR867**; NORTHSTAR pick **TR885**.  
11. Narita `lp3a92f` 29â†’30 Sep keep.  
12. Concorde `lp21d9f` baseline **29â†’3 Oct**; recovered **30â†’3 Oct**; cancel+rebook mechanism; economics pending.  
13. Transfer baseline ~29 Sep 23:30; recovered ~30 Sep 15:00â€“15:30.  
14. Seed no viability/strategy/approval outcomes.  
15. Retire 360/720 demo policy, Sarah 09:20, MN310/MN218 as final, 4-person manifests, Jordan 15:10/US/30-Sep-stay/TR885-as-default.

---

## IMPLEMENTATION DELTA FOR M9

Assumptions M9 must know that prior handoffs typically did **not** lock:

1. **Readiness is 150 + REQUIRED-on-stage only** â€” not 360/720; UI/read-models must not assume 6h/12h copy.  
2. **Sarah failure mode is â€œarrives before talk but fails bufferâ€** (10:30â†’11:30), not â€œlands after session.â€  
3. **S3 is a bilateral localâ†”inbound slot swap (Danielâ†”Sarah)**, not afternoon RESCHEDULE to 15:30 / Jonas window.  
4. **Five-person shared inbound**; acceptance â€œ4 affectedâ€ is wrong.  
5. **Jordan airline default is TR867 (fails); NORTHSTAR option is TR885 (passes)** â€” invert current pack roles in any recovery explanation UI.  
6. **Jordan Singapore stay is consequential** (29â†’3 Oct baseline â†’ 30â†’3 Oct recovered); do not assume â€œNo change requiredâ€ for the hero path.  
7. **Jordan is SG nationality** with no visa module in MVP.  
8. **Sarah Batik geometry is evidence-gated** â€” M9 must not present MN218/KUL or MN310 as the WiT truth.  
9. Preview affected set includes **Daniel + Elena (+ Daniel-session moderator if any)**, not only Sarahâ€™s trip.  
10. Programme stage is a **single exclusive `place-mbs` resource** for these sessions â€” read-models should not show overlapping main-stage blocks after seed.

---

**Next dependency:** evidence capture for ID7159/ID7153 (or written Accept Risk) â†’ then fixture/policy seed implementation pass (still not M9 product logic).
