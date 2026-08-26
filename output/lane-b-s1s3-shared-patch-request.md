# Lane B shared patch request — S1→S3 continuity (CGK cohort)

**From:** lane/final-demo-s1s3 (Lane B)  
**Base programme SHA frozen for this lane:** `b7d80aa`  
**Do not apply inside Lane B** — shared owner must patch `data/ait-demo-input-pack/global/**` and rebuild `fixtures/programmes/ait-summit-2026` via:

```bash
node --experimental-strip-types scripts/build-ait-canonical-programme.ts
```

Lane B already updated owned scenario inputs under `data/ait-demo-input-pack/scenarios/s1-supplier-disruption/**` (CGK→SIN MN310 baselines + inventory) and `s3-event-change-preview/**` (headline RESCHEDULE continuity). Runtime seed still reflects pre-rebuild KUL MN218 travel until this patch lands.

---

## 1. Roster rehomes (`global/roster.json`) — Act Now for CGK demo

| draftId | current homeLocationText | required homeLocationText | why |
|---------|--------------------------|---------------------------|-----|
| ait-draft-14 | Sydney (SYD) | Jakarta (CGK) | Group C hero; CGK→SIN inbound |
| ait-draft-10 | Bangkok (BKK) | Jakarta (CGK) | Group A shared MN310 |
| ait-draft-11 | Kuala Lumpur (KUL) | Jakarta (CGK) | Group A shared MN310 |
| ait-draft-30 | Kuala Lumpur (KUL) | Jakarta (CGK) | Group A shared MN310 |

**Already CGK (no change):** ait-draft-03 (Felix Hartono), ait-draft-19 (Nadia Rahman).

Optional note text updates on those drafts to mention Jakarta origin / MN310 cohort.

---

## 2. Programme rebuild from pack — Act Now

After roster patches (and with Lane B scenario baselines already CGK):

1. Run `build-ait-canonical-programme.ts` so `fixtures/programmes/ait-summit-2026/programme.json` picks up:
   - CGK→SIN `declaredTravel` for drafts 03/10/11/14/30 from `s1-supplier-disruption/inputs/baseline-itineraries.json`
   - PNRs MNSYN03/10/11/14/30 from `airline-schedule-change-mn310.json` `ticketedManagedTravellers`
2. Do **not** hand-edit the fixture; rebuild only.

Until rebuild, acceptance continuity on this lane is intentionally runnable against the **frozen b7d80aa KUL MN218 seed** (same tripId Sarah Lim / draft-14) so NOT_VIABLE→VIABLE can be proven without mutating shared programme files.

---

## 3. Programme-importance — Park for Later

No importance row changes required for the RESCHEDULE continuity path (`cmt-ait-d1-headline-interview` stays REQUIRED/FIXED for ait-draft-14).

If Group B (ait-draft-03 india-fireside) should use a different buffer/importance after CGK rehome, revisit then.

---

## 4. True bilateral engagement swap — Park for Later

HTTP preview/commit only support `RESCHEDULED|RELOCATED|CANCELLED|OTHER` on **one** `commitmentId`. Continuity approximates “move critical speaker into later local slot” by **RESCHEDULEing** `cmt-ait-d1-headline-interview` to `15:30–16:00`. A true two-commitment speaker swap API is out of scope.

---

## 5. Recordings — Investigate Now after rebuild

After CGK programme seed lands, add/RECORD Atlas `search` + `flight_state_query` for CGK→SIN / MNSYN03 (Group B). Lane B may ship hand-authored SIMULATED Atlas-shaped search recordings with honest provenance; never fake engine viability outcomes.

---

## Triage summary

| item | class |
|------|--------|
| Roster rehomes 14/10/11/30 → Jakarta (CGK) | Act Now |
| Rebuild programme fixture from pack | Act Now |
| programme-importance changes | Park for Later |
| Bilateral swap API | Park for Later |
| CGK Atlas RECORD refresh | Investigate Now (after rebuild) |
