# Lane D (S5) — shared patch request

**From:** lane/final-demo-s5 @ worktree `.worktrees/final-s5`  
**Baseline:** `39a96fe` atop `244ea5b`  
**Date:** 2026-08-26  
**Scope:** patches required outside lane-owned paths for honest S5 final-demo closure. Do **not** weaken ADR-045 fail-closed or SPEND_LIMIT safety.

---

## 1. Act Now — restore hotel Place coordinates (programme / global places)

**Problem:** After the `b7d80aa` programme rebuild, both `place-hotel-bayview` and `place-hotel-harbourline` lack `coordinates` / usable `externalRefs`. G1/G2 cannot derive a coordinate `hotel.search` from Place evidence alone.

**Lane workaround (temporary):** acceptance ChangeRequest sets `stayPlaceRef: { system: "nuitee-hotel-id", value: "lp21d9f" }` (Concorde Hotel Singapore — real midscale ~4★ Downtown/Orchard) so `hotel.search` uses the provider hotel-id path without Place coordinates.

**Requested shared patch (primary owns):**

- `data/ait-demo-input-pack/global/places.json` — add Marina Bay / Downtown coordinates:
  - `place-hotel-bayview`: `{ "latitude": 1.2839, "longitude": 103.8607 }`
  - `place-hotel-harbourline`: `{ "latitude": 1.2789, "longitude": 103.8536 }` (restore; was present pre-rebuild)
- Rebuild `fixtures/programmes/ait-summit-2026/programme.json`.
- After that, S5 can search from incumbent Bayview coords and drop the hotel-id stayPlaceRef workaround.

**Do not:** invent MBS ultra-luxury identity.

---

## 2. Landed @ b7d80aa — `rule-ait-flight-change-approval` operations vocabulary

**Status:** CLOSED by shared fix. Operations now use CapabilityOperation ids (`flight.change`, `flight.cancel`). Traveller-initiated flight changes bind HUMAN_AGENT as intended. S5 hotel hero beat remains the auto-resolve path.

---

## 3. Partially landed @ b7d80aa — SPEND_LIMIT NIGHT scoping

**Status:** NIGHT hotel SPEND_LIMIT no longer blocks non-hotel (flight) spends; hotel APPROVAL_ABOVE_SPEND is scoped to `hotel.*` ops; org `homeCurrency` SGD enables ADR-052 FX.

**Remaining Investigate Now:** multi-night hotel gross totals can still exceed the nightly ceiling when compared as stay `totalPrice`. Lane selects cheapest midscale REPLAY rates that stay under SGD 320 after FX for honest auto-resolve. A future shared improvement may compare nightly rate for `period: NIGHT` rather than multi-night gross — without weakening ADR-045.

---

## 4. Park for Later — return-flight + hotel combined auto-resolve

S5 catalogue shape includes Sunday return. Final-demo hero is hotel-only auto-resolve under traveller authority. Combined flight+hotel automatic resolution without organiser remains blocked until items 2–3 are closed; then acceptance can add a secondary begin asserting HUMAN_AGENT for `flight.change`.

---

## Lane-local already done (no shared action required)

- S5 manifests rewired to G1/G2 `hotel.search` + traveller-funded begin → decide → execute.
- Nuitée REPLAY recording cloned for the Harbourline-coordinate Sunday-extension query hash (`rec_619b8b5d45d326d3391888bb1a8c3cbc`).
- Scenario data updated for MIN(eligible, allowance) covered baseline + midscale Downtown/Marina Bay evidence narrative.
