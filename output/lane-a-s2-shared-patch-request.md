# Lane A S2 — shared patch request (primary / integrator)

**From:** Lane A (`lane/final-demo-s2` @ worktree `.worktrees/final-s2`)  
**Against:** `b7d80aa` (authority/FX baseline; includes `place-lax` via `39a96fe`)  
**Do not apply from this lane:** `fixtures/programmes/**`, `data/ait-demo-input-pack/global/**`

Lane A has rewritten `data/ait-demo-input-pack/scenarios/s2-missed-connection/**` for the provider-locked LAX→NRT→SIN corridor. The build script harvests `draftId` + `inboundItinerary` + PNR from that pack. **Primary must rebuild the programme once** after applying roster (and optional policy) patches below.

---

## 1. Roster patch — `ait-draft-09` (Act Now)

**File:** `data/ait-demo-input-pack/global/roster.json`  
**Why:** Prefer non-stereotyped LAX-origin identity; home must match LAX corridor (currently Sydney / AU / Chloe Martin).

| Field | Current (frozen) | Requested |
|---|---|---|
| `draftId` | `ait-draft-09` | **unchanged** |
| `displayName` | Chloe Martin | **Jordan Hale** |
| `identity.email` | `chloe.martin@southernorbit.test` | `jordan.hale@pacificrim.test` (or equivalent synthetic) |
| `identity.lastName` | Martin | **Hale** |
| `homeLocationText` | `Sydney (SYD)` | **`Los Angeles (LAX)`** |
| `nationalityCodes` | `["AU"]` | **`["US"]`** |
| `notes` | Hackathon finalist (Team Waypoint)… | Keep hackathon finalist commitments; note LAX origin / ZIPAIR connection demo |
| `anchorCommitmentIds` | lab / finals / awards | **unchanged** |
| `travelArrangement` | `NORTHSTAR_ARRANGED` | **unchanged** |

Lane A does **not** edit roster.json.

---

## 2. Programme rebuild — declaredTravel harvest (Act Now)

**Action:** After roster patch (and any optional items below):

```bash
node --experimental-strip-types scripts/build-ait-canonical-programme.ts
```

**Expected harvest from S2 pack** (`scenarios/s2-missed-connection/inputs/`):

### `baseline-itinerary.json` → declaredTravel

1. **TRANSPORT_LEG** LAX→NRT `ZG023`  
   - dep `2026-09-28T10:55:00-07:00`  
   - arr `2026-09-29T14:10:00+09:00`  
   - bookingRef `ZGSYN09` (from provider-rebooking-state)

2. **TRANSPORT_LEG** NRT→SIN `ZG053`  
   - dep `2026-09-29T16:50:00+09:00`  
   - arr `2026-09-29T23:00:00+08:00`  
   - bookingRef `ZGSYN09`

3. **STAY** `place-hotel-bayview`  
   - checkIn `2026-09-29T15:00:00+08:00`  
   - checkOut `2026-10-03T11:00:00+08:00`

### PNR harvest — `provider-rebooking-state.json`

- `pnr` / `orderNo`: **`ZGSYN09`**
- Attach to both legs whose corridor matches segments (generic harvest — no scenario branching).

**Element ID expectations after rebuild** (unchanged patterns):

- Traveller: `trv-evt-ait-2026-ait-draft-09`
- Trip: `trip-trv-evt-ait-2026-ait-draft-09`
- Legs: `…-leg-1` (ZG023), `…-leg-2` (ZG053)
- Stay: `…-stay-3`

Lane acceptance manifests already target these IDs + PNR `ZGSYN09`.

**Places:** `place-lax` and `place-nrt` already present at `39a96fe` / current baseline — no places patch required unless gateway flags need refresh.

---

## 3. Programme-shaping / buffer tension (Act Now decide)

Verified on local harvest + acceptance (`output/acceptance-s2-lane-a/latest.json`):

| Offer (NRT→SIN REPLAY) | Dep | Arr | Viability vs eng-1 lab 11:15 / eng-2 finals 15:10 |
|---|---|---|---|
| ZG053 (baseline, still in inventory) | 16:50 | 23:00 same day | ranked feasible (cheapest) — **bestStrategyId strat-0001** |
| TR875 same-night | 21:15 | 05:20 next day | **FAIL** eng-1: `gap 355min < required 360min` (5min short of lab buffer) |
| TR885 08:20 class (same calendar day in 29 Sep search) | 08:20 | 14:35 | marked feasible (arrives day-before finals; does not model “already departed”) |
| Later next-day / stopover-class | various | various | mixed FAIL/PASS |

**Problems for the demo narrative:**

1. **TR875 does not clear the 360min buffer before PREFERRED lab** (355 < 360).  
2. **Airline morning TR885 on 30 Sep** still fails REQUIRED finals if judged on that date (`14:35` → `15:10`).  
3. Fallback planner does not filter offers whose departure is already past `at`, so same-day morning offers can rank as feasible.

| Option | Change | Triage |
|---|---|---|
| A | Soften lab buffer application for PREFERRED (or set draft-09 lab to not emit 360min arrival-before) so TR875 passes | **Act Now** (preferred for “same-night restores”) |
| B | Soften/move finals + keep lab PREFERRED without hard 360min | Investigate Now |
| C | Accept honest REPLAY: cheapest still-listed ZG053 wins; TR875 fails lab by 5min; tighten planner/time-filter later | **Park for Later** / Accept Risk for MVP demo copy |

Lane A manifests assert engine seams (ingress, miss, plan rounds, NOT_VIABLE remainder) — not a specific winning flight number — until primary chooses A/B/C.

---

## 4. Optional insurance / entry attach (Park for Later)

Scenario-local files (force-add under pack; **not** auto-harvested today):

- `inputs/insurance-coverage-rules.json` — `INSURANCE_COVERAGE` missed-connection + transit accommodation
- `inputs/entry-requirements-context.json` — JP landside overnight / `research.entry_requirements` hint

Builder only loads `global/organiser-policy.json` ruleSets. To make these live without domain hardcoding:

- Promote ruleSet into programme `context.ruleSets` **or**
- Wire intake/ingest of insurance document + research finding for draft-09  
- Link `insuranceRuleSetIds` on traveller (today always `[]` at promote)

**Triage:** Park for Later (Stretch immigration / richer insurance). Executable S2 REPLAY does not require them.

---

## 5. Architecture limits to freeze (document only)

| Limit | Impact on S2 progressive story |
|---|---|
| `flight_state_query` recording keyed only by `orderReference` | One CONNECTED retiming snapshot per PNR in REPLAY; cannot evolve multi-version arrivals mid-run |
| Seeded legs `dependsOn: []` | Upstream delay does **not** auto-miss connection — manifest uses `POST /api/runtime/missed-flight` on leg-2 |
| Deterministic fallback planner is flight-search only | No automatic NRT transit hotel strategy without Northstar/model tool requests + Nuitée REPLAY |
| ASSERTED push cannot outrank AUTHORITATIVE facts | Progressive retimes require CONNECTED reconciliation (S1 pattern) |

---

## 6. Integrator checklist

1. Apply roster patch (§1).  
2. Rebuild programme (§2); commit `fixtures/programmes/ait-summit-2026/programme.json` from primary.  
3. Decide finals shaping (§3) — default Accept Risk.  
4. Merge Lane A: scenario pack + `fixtures/acceptance/manifests/s2-*` + `packs/s2` + curated Atlas recordings + optional `scripts/wave4r-s2-promote-replay-recordings.ts`.  
5. Re-run:  
   `npm run acceptance:run -- --manifest fixtures/acceptance/manifests/s2-missed-connection.json`  
6. Optional RECORD: `s2-missed-connection-record.json` when Atlas + Model Studio keys available.

---

## 7. Lane-local already done (no primary edit)

- Scenario pack rewrite (LAX/NRT/SIN, progressive timeline, insurance/entry context files)
- Manifests `s2-missed-connection.json` + `s2-missed-connection-record.json`
- REPLAY recordings:  
  - `fixtures/recordings/atlas/search/rec_b92e556a…` (LAX→NRT)  
  - `fixtures/recordings/atlas/search/rec_34518610…` (NRT→SIN 29 Sep)  
  - `fixtures/recordings/atlas/search/rec_71d6274a…` (NRT→SIN 30 Sep)  
  - `fixtures/recordings/atlas/flight_state_query/rec_2b0e2a05…` (ZGSYN09 CONNECTED snapshot)
