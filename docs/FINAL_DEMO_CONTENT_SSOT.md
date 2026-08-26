# Final Demo Content — Source of Truth

**Status:** Authoritative for final-demo *world content* (identity, venues, programme, population, travel baselines, scenario-to-person mapping).  
**Branch baseline:** `content/final-demo-world` atop `origin/integration/final-demo-backend` @ `5e5ad63cb505399ef8022cfff46da46848e755b3` (includes S2 overnight closure)  
**Date:** 26 Aug 2026  

## Authority boundaries

| Document | Owns |
|----------|------|
| **This file** | Event identity, venues, programme shape/timings, traveller population, hero cast, baseline flights/hotels, scenario↔person mapping |
| `docs/SCENARIOS.md` | **What happens over time** (triggers, stages, capability claims) |
| `fixtures/programmes/ait-summit-2026/programme.json` | Executable encoding of this SSOT |
| `docs/WAVE3R_DEMO_READINESS_PLAN.md` | Demo readiness doctrine and final-video order |

**Precedence for content conflicts:**

1. Hero-scenario correctness (S2 → S1 → S3 → S7 → S5)
2. Provider-backed travel/hotel reality (Atlas / Nuitée LIVE·RECORD·REPLAY)
3. Everything else (WiT-inspired session colour, inherited names/timings)

WiT remains **inspiration only** for Singapore conference setting, venue geography, session formats, and travel-industry subject matter. Old session names/timings are not preserved merely because they already exist.

---

## 1. Event identity

| Field | Value |
|-------|-------|
| Event id | `evt-ait-2026` |
| Name | **AiT — AI in Travel Summit 2026** |
| Positioning | Invitation-only industry summit for travel AI builders, operators, and investors (synthetic; WiT-inspired structure) |
| Window | `2026-09-30T09:00:00+08:00` → `2026-10-02T20:30:00+08:00` |
| Organiser | `org-ait-organiser` — AiT Summit Organising Committee (synthetic), home currency **SGD** |
| Timezone | Asia/Singapore (GMT+8) |

Keep AiT branding. Do not rebrand mid-freeze. Optional subtitle for judges: “in the spirit of WiT Singapore.”

---

## 2. Venue portfolio

### Event venues (not hotels)

| Place id | Name | Role |
|----------|------|------|
| `place-panpacific` | Pan Pacific Singapore | Day 0 Innovation / Bootcamp venue |
| `place-mbs` | Marina Bay Sands Expo & Convention Centre | Day 1–2 main stage |

MBS / Pan Pacific / Marina Bay geography belong to the **event/venue** world only.

### Stay portfolio (provider-backed, ~4★ business)

| Place id | Property | Nuitée id | Role | Evidence |
|----------|----------|-----------|------|----------|
| `place-hotel-bayview` | **Concorde Hotel Singapore**, 100 Orchard Road | `lp21d9f` | **Primary** event partner block | `fixtures/recordings/nuitee/search/rec_f90cef…`, `stay_context/rec_b3356c…`, S5 REPLAY |
| `place-hotel-harbourline` | **Hotel Grand Pacific**, 101 Victoria Street | `lp1e850` | **Overflow / alternate** | Same SIN search recordings |
| `place-hotel-orchard-ihg` *(optional place)* | Holiday Inn Singapore Orchard City Centre by IHG | `lp1a41a` | Overflow cohort | Same recordings |

**Do not** present Marina Bay Sands as the default hotel product.

### S2 transit (recovery only, not baseline programme stay)

| Property | Hub | Evidence |
|----------|-----|----------|
| Hilton Tokyo Narita Airport | NRT overnight landside | `output/wave4r-s2-hub-hotels.json` (parent RECORD probe) |
| HOTEL MYSTAYS PREMIER Narita | NRT alternate | same |

---

## 3. Population scale

| Cohort | Count | Rule |
|--------|------:|------|
| Total participants | **67** | Visible/static product scale |
| Northstar-managed travel | **42** | Require Northstar-arranged flights (and usually stay) |
| Local / self / unmanaged | **25** | Singapore-based or otherwise not Northstar-travel |

### Arrangement hygiene (this SSOT)

Three Singapore locals were incorrectly marked `NORTHSTAR_ARRANGED` without flights. Fix:

| Draft id | Name | Action |
|----------|------|--------|
| `ait-draft-01` | Elena Tan | → `SELF_OR_OTHER_ARRANGED` (local curator/host) |
| `ait-draft-02` | Daniel Ong | → `SELF_OR_OTHER_ARRANGED` (local co-host; S3 swap partner) |
| `ait-draft-05` | Owen Seah | → `SELF_OR_OTHER_ARRANGED` (local hackathon finalist) |

To keep **42 / 25**, rewrite three low-visibility former locals into managed international travellers (same draft ids, new identities/origins):

| Draft id | New identity | Origin | Corridor |
|----------|--------------|--------|----------|
| `ait-draft-65` | Maya Krishnan · Product lead, LotusFare | BKK | Scoot TR625-class |
| `ait-draft-66` | Tom Hughes · Partnerships, ReefPay | SYD | Scoot TR011-class |
| `ait-draft-67` | Lea Dubois · Investor, Meridian Ventures | HKG | AirAsia AK139-class / Scoot TR |

Net: still 67 people; 42 managed non-local travellers; 25 local/self (including Elena, Daniel, Owen + remaining Singapore roster).

---

## 4. Content tiers

### Tier A — Hero / directly affected (clickable)

Fully fleshed: name, company, title, origin, nationality, programme role, commitments, baseline flight, hotel, policy/preferences.

| Family | People | Overlap rule |
|--------|--------|--------------|
| **S2** | Jordan Hale only | No overlap with other families |
| **S1 → S3** | Sarah Lim (critical) + Wanderpay cohort + S3 locals | **Only** continuous story across S1 and S3 |
| **S7** | Oliver Bennett only | No overlap |
| **S5** | Jonas Berg only | No overlap |

### Tier B — Supporting programme / blast-radius faces

Enough for programme screens and S1/S3 preview: name, company/title, origin/local status, session assignment, baseline travel/hotel if managed.

Includes: Elena Tan, Daniel Ong, Wanderpay supporting faces already in Tier A table as cohort, other on-stage Day 0–2 speakers who appear near hero slots.

### Tier C — Background

Remaining roster: name, company/title, origin, managed/local, baseline flight/hotel if managed, headline trip status.

---

## 5. Tier A hero cast (detail)

### S2 — Jordan Hale (`ait-draft-09`)

| Field | Value |
|-------|-------|
| Company / title | Pacific Rim Labs · Hackathon finalist (Team Waypoint) |
| Origin / nationality | Los Angeles (LAX) · US |
| Programme role | Lab PARTICIPANT (soft); **Finals FINALIST REQUIRED/FIXED**; Day-2 Awards FINALIST REQUIRED/FIXED |
| Baseline flights | **ZIPAIR ZG023** LAX→NRT `2026-09-28T10:55:00-07:00` → `2026-09-29T14:10:00+09:00`; **ZIPAIR ZG053** NRT→SIN `2026-09-29T16:50:00+09:00` → `2026-09-29T23:00:00+08:00`; PNR **ZGSYN09** |
| Connection | Genuine **2h40m** at NRT |
| Hotel (SIN) | Concorde (`place-hotel-bayview` / `lp21d9f`) check-in evening 29 Sep → check-out 3 Oct |
| Policy | Event `MIN_BUFFER` **360** applies to **hard** finals/awards only; lab must **not** emit a hard 360 arrival-before |

**Hard commitment (programme):**  
`cmt-ait-d0-hackathon-finals` → **Finals Showcase at Opening Cocktails**  
`2026-09-30T20:45:00+08:00` – `2026-09-30T21:05:00+08:00` at `place-panpacific`  
(Aligned with S2 overnight-closure lane @ `5e5ad63`; former 15:10 slot vacated.)

Jordan is **not** bound to the morning hackathon lab (removed from `anchorCommitmentIds`) so overnight NRT recovery is not falsely killed by a soft morning session. SIN hotel check-in for Jordan is **`2026-09-30T15:00:00+08:00`** (post-overnight arrival day).

**Why these timings (provider math, Atlas RECORD + S2 overnight lane):**

| Option | Flight | Arr SIN | Gap to 20:45 @ 360 buffer |
|--------|--------|---------|---------------------------|
| Baseline | ZG053 | 29 Sep 23:00 | Viable (night before) |
| Same-night recovery | Scoot **TR875** | 30 Sep 05:20 | Viable until progressive delay kills it |
| Next-morning recovery | Scoot **TR885** (~08:20→14:35) | 30 Sep 14:35 | **370 min ≥ 360 → PASS** (airline desk *or* Northstar) |
| Later/slower morning | Scoot **TR867** | 30 Sep 20:45 | **FAIL** if ever offered as default |

With finals at **20:45**, the closed S2 acceptance path treats the next-morning **TR885-class** rebook as the boardable recovery that restores the evening showcase after overnight. “Airline not good enough” in this demo is primarily the **progressive miss + overnight whole-trip problem** (transit hotel, JP entry, insurance, SIN stay consequences)—not a claim that TR885 itself fails the 360 buffer. Keep **TR867** available as an inadequate slower alternative in inventory comparisons.

Evidence: `fixtures/recordings/atlas/search/rec_b92e556a…` (ZG023), `rec_34518610…` / `rec_71d6274a…` (ZG053, TR875, TR885, TR867), `output/wave4r-s2-nightly-hero-evidence.json`.

> Note: VietJet **VJ823** appears in NRT searches but is **NRT→SGN** connecting onward — do **not** treat it as a direct NRT→SIN 12:55 hero recovery.

### S1 critical — Sarah Lim (`ait-draft-14`) → continues as S3

| Field | Value |
|-------|-------|
| Company / title | CoralTree Air · CEO / headline speaker |
| Origin / nationality | Jakarta (CGK) · AU |
| Role | Headline Interview SPEAKER **REQUIRED/FIXED** |
| Baseline | CGK→SIN morning service (programme carrier **MN310** sandbox cohort / prefer live **QG/ID/TR** when harvested); `2026-09-30T05:15:00+07:00` → `2026-09-30T07:25:00+08:00`; PNR **MNSYN14** |
| Hotel | Concorde primary block, arrival eve of Day 0 / through event |
| Hard slot | `cmt-ait-d1-headline-interview` **`2026-10-01T09:20:00+08:00`–`09:50:00+08:00`** |

Disruption shape: supplier retime/rebook lands ~`2026-10-01T07:00` class → gap to 09:20 ≈ 130–140 min → **FAIL** 360 → `NOT_VIABLE`. Travel-only recovery insufficient for the morning slot.

### S1 cohort (same corridor, differentiated)

| Draft | Name | Company | Commitment | After ~07:00 Day-1 rebook |
|-------|------|---------|------------|---------------------------|
| `ait-draft-10` | Arjun Rao | Wanderpay · lead | Payments keynote 13:50–14:00 | PASS |
| `ait-draft-11` | Siti Rahmah | Wanderpay | Payments panel 14:00–14:30 | PASS |
| `ait-draft-30` | Mei Ling Goh | Wanderpay | Payments panel | PASS |
| `ait-draft-03` | Felix Hartono | (supporting) | Day-0 provocations | PASS / non-critical |

Shared baseline pattern: CGK→SIN morning, PNRs `MNSYN{10,11,14,30}`.

### S3 programme swap partners (locals)

| Draft | Name | Arrangement | Role in S3 |
|-------|------|-------------|------------|
| `ait-draft-02` | Daniel Ong | **SELF** (local) | Primary CHANGEABLE afternoon participant / interviewer who remains viable |
| `ait-draft-01` | Elena Tan | **SELF** (local) | Headline interviewer; stays in preview blast radius |

**S3 commit target (proven continuity):** reschedule Sarah’s headline to **`2026-10-01T15:30:00+08:00`–`16:00:00+08:00`**. Airline rebooking that failed 09:20 becomes viable against 15:30 under 360 buffer.

### S7 — Oliver Bennett (`ait-draft-38`)

| Field | Value |
|-------|-------|
| Company / title | Albion Agents · agency-commerce founder |
| Booked origin | London (LHR) · GB |
| Requested origin | Tokyo (HND/NRT) — pre-booking structural change |
| Role | Distribution debate PANELLIST PREFERRED/CHANGEABLE `15:50–16:20` Day 1 |
| Baseline | LHR→SIN + return (Atlas sandbox MN245/MN244 or RECORD HND **TR883** for Tokyo-leg evidence) |
| Hotel | Concorde; stay aligned to event window |
| Policy | Explicit **return to LHR**; FX USD→SGD; `flight.change` → HUMAN_AGENT |

Lifecycle: **pre-booking** (or not-yet-ticketed). No overlap with S2/S1/S5 people.

### S5 — Jonas Berg (`ait-draft-35`)

| Field | Value |
|-------|-------|
| Company / title | PolarTrip · recovery-platform founder |
| Origin / nationality | Amsterdam (AMS) · SE |
| Role | Recovery fireside SPEAKER REQUIRED/FIXED — **moved off 15:30** |
| New slot | `cmt-ait-d1-recovery-fireside` **`2026-10-01T14:30:00+08:00`–`14:50:00+08:00`** (swap with search-chat) so **15:30 is free for S3** |
| Baseline hotel | **Concorde `lp21d9f`** |
| Funded window | Event hotel funded through **`2026-10-03T11:00:00+08:00`** |
| Extension | Checkout **`2026-10-04T11:00:00+08:00`** — incremental nights **traveller-funded** (MIN of eligible booked stay vs allowance) |
| Authority | Hotel-only extension auto-resolves under traveller/self-funded authority; no organiser approval for incremental personal nights |

---

## 6. Programme timing changes required

| Commitment | Previous | SSOT target | Driver |
|------------|----------|-------------|--------|
| `cmt-ait-d0-hackathon-finals` | 30 Sep 15:10–15:30 | **20:45–21:05** (cocktails showcase; S2 lane) | S2 TR885 vs TR867 discrimination under 360 |
| `cmt-ait-d0-seedup-showcase` | 15:30–16:00 | Keep afternoon block or compress into 15:10–16:00 vacated by finals | Avoid double-booking |
| `cmt-ait-d0-hackathon-lab` | 11:15–12:00 | Keep session; **remove Jordan** from lab engagement | Overnight recovery must not die on morning lab |
| Jordan SIN hotel check-in | 29 Sep 15:00 | **30 Sep 15:00** | Arrives after NRT overnight |
| `cmt-ait-d1-headline-interview` | 09:20–09:50 | **Keep** | S1 critical FAIL after ~07:00 rebook |
| S3 reschedule target | 15:30–16:00 | **Keep** | Proven continuity |
| `cmt-ait-d1-recovery-fireside` | 15:30–15:50 | **14:30–14:50** | Clear S3 15:30; avoid Jonas↔Sarah collision |
| `cmt-ait-d1-search-chat` | 14:30–14:50 | **15:30–15:50** (swap) or adjacent | Free fireside’s old slot without orphaning search |

Day-0 late afternoon (`seedup` / coffee / thinktank) may be retitled; correctness outranks WiT name fidelity.

---

## 7. Scenario-to-person map (final video)

Video order: **S2 → S1 → S3 → S7 → S5**.

| Scenario | Primary person(s) | Supporting | Continuous? |
|----------|-------------------|------------|--------------|
| S2 | Jordan Hale (`09`) | — | No |
| S1 | Sarah Lim (`14`) + Wanderpay `10/11/30` | Felix optional | → S3 |
| S3 | Sarah Lim (`14`) | Daniel Ong (`02`), Elena Tan (`01`) | From S1 |
| S7 | Oliver Bennett (`38`) | — | No |
| S5 | Jonas Berg (`35`) | — | No |

**Forbidden overlaps:** Jordan ≠ Sarah ≠ Oliver ≠ Jonas; Wanderpay faces only in S1 family; S3 locals only as programme-side partners.

---

## 8. Provider coverage for the 42

### Flights — corridor portfolio (cohort reuse)

Prefer Atlas RECORD/LIVE evidence. Reuse routes; do not force 42 unique searches.

| Corridor | Carrier examples | Fixture / probe evidence | Typical assignees |
|----------|------------------|--------------------------|-------------------|
| LAX→NRT→SIN | ZIPAIR ZG023/ZG053 | `rec_b92e556a…`, `rec_34518610…` | Jordan (S2) |
| NRT→SIN recovery | TR875, TR885, TR867, ZG053 | same + nightly hero evidence | S2 recovery only |
| CGK→SIN | QG/ID/TR (live probe); MN sandbox cohort in programme | `wave4r-s2-corridor-deepdive` s1-cohort; programme MN310 | Sarah + Wanderpay + Felix |
| HND→SIN | Scoot TR883 | `rec_f23d573b…` | Kenji, Yuki, Hiroshi; S7 Tokyo request |
| KUL→SIN | MN228/230 sandbox; AK/OD/TR live | `rec_2d88df0f…`, deepdive | Mei Chen, Farah |
| CNX→SIN | MN235/237 | `rec_0b5ffacd…` | Ethan Yap |
| BKK→SIN | TR625/639/611 | deepdive | Aisha; Maya (`65`) |
| MNL→SIN | VJ/AK/TR | deepdive | Victor, Isabella |
| HKG→SIN | AK/TR/7C | deepdive | Anna, Priya; Lea (`67`) |
| SYD→SIN | TR011/015 | deepdive | David; Tom (`66`) |
| ICN→SIN | cohort reuse / prior probes | deepdive-adjacent | Wei Lin, Min-Jun |
| SGN→SIN | regional reuse | deepdive-adjacent | Lucas, Tuan |
| DEL/BOM→SIN | IndiGo/Atlas probes (hub hotels file) | wave4r hub probes | Ravi, Deepa, Liam, Zara |
| Long-haul AMS/FRA/LHR/CDG/MAD/AKL | Atlas sandbox **Meridian MN*** where assigned | programme + SIN→AMS `rec_678b3eb8…` | Jonas, Hannah, Oliver, Hugo, Sofia, Marcus, etc. |

**Provenance rule:** Meridian `MN*` = Atlas sandbox inventory (provider-backed RECORD path, not a real-world airline brand). Real brands (ZG/TR/VJ/AK/QG/…) preferred when recordings exist. Disclose in demo truth labels.

### Hotels — assignment rule for managed stays

| Segment | Property |
|---------|----------|
| Default managed stay | Concorde `lp21d9f` / `place-hotel-bayview` |
| Overflow cohort (~1/3 of managed) | Grand Pacific `lp1e850` / `place-hotel-harbourline` |
| S5 hero | Concorde (required for REPLAY `lp21d9f`) |
| Accessible / special | Prefer Concorde or Albert Court if needed later |

Every managed traveller with an overnight in Singapore should have a declared STAY against one of these provider-backed places (coordinates + `nuitee-hotel-id` externalRef).

---

## 9. Baseline viability (heroes, pre-disruption)

| Hero | Baseline must be |
|------|------------------|
| Jordan | ZG023+ZG053 arrives 29 Sep 23:00 → finals 30 Sep 20:45 with ≫360 buffer |
| Sarah | MN310-class arrives 30 Sep 07:25 → headline 1 Oct 09:20 with ≫360 buffer |
| Oliver | LHR inbound arrives before distribution debate with buffer |
| Jonas | AMS inbound + Concorde stay covers fireside; funded through 3 Oct checkout |

No impossible overlapping commitments for any Tier A person.

---

## 10. Executable reconciliation checklist

When editing `programme.json`:

1. Fetch latest `integration/final-demo-backend`; reconcile any newer S2 timing rather than blind overwrite.
2. Apply §6 timing moves.
3. Apply hotel place renames + externalRefs.
4. Reclassify Elena/Daniel/Owen; rewrite drafts 65–67.
5. Ensure all 42 managed have provider-shaped declared flights + stays.
6. Soften Jordan lab importance/flexibility as specified.
7. Run `scripts/validate-final-demo-content.mjs` + affected acceptance tests.

**Do not** modify engine/domain/provider/UI code in this content lane.

---

## 11. Known gaps (honest)

| Gap | Triage | Notes |
|-----|--------|-------|
| CGK exact MN310 vs live QG/ID/TR harvest | Act Now for S1 pack; Park for content display | Programme may keep MN310 sandbox ids until S1 lane harvests CGK RECORD |
| Long-haul real airline names (LHR/AMS/FRA/…) | Accept Risk / Park | Atlas sandbox Meridian used; real long-haul often thin in sandbox |
| VJ823-as-direct-SIN myth | Closed | Do not use; TR885/TR867 are the morning pair |
| `data/ait-demo-input-pack` gitignored | Investigate Now for acceptance runners | Lane tests expect pack on disk; content SSOT still governs programme.json |
| NRT transit hotel not a programme Place | Park | Recovery overlay only |

---

## 12. UI integrator notes

- Clickable hero people: drafts `09`, `14`, `10`, `11`, `30`, `38`, `35`, plus locals `01`, `02` for S3 context.
- Hotel labels must show **Concorde / Grand Pacific**, not “Bayview Grand” / “Harbourline Suites”.
- S2 traveller copy: finals are **evening cocktail showcase 20:45**, not “tomorrow afternoon”.
- S5 fireside is **14:30**, not 15:30; 15:30 is Sarah’s S3 target slot after commit.
- Do not imply MBS hotel stay.
