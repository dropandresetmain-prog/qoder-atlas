# AiT Demo Input Pack — Documentation

Companion document for `data/ait-demo-input-pack/`: the bounded demo input and
provenance pack for the NORTHSTAR demo. The pack is **data and documentation
only** — no `src/**` code changes, no recovery logic, no Model Studio or
Google Routes calls.

The synthetic event is **AiT — AI in Travel Summit 2026**, Singapore,
30 Sep – 2 Oct 2026 (Asia/Singapore, GMT+8), Marina Bay Sands Expo &
Convention Centre. Its programme structurally mirrors the publicly announced
upcoming **WiT Singapore 2026** (same day layout, session timing patterns,
role mix, shared-dependency patterns) without copying copyrighted prose.
**No private travel facts are invented for any real WiT speaker** — all
travel facts concern fully synthetic personas.

## Pack layout

| Path | Content |
| --- | --- |
| `sources/source-registry.json` | Provenance registry; every input cites source ids from here. |
| `sources/public-web/wit-singapore-2026-normalized.json` | PUBLIC_WEB structural normalization of WiT Singapore 2026 (dates, venues, day blocks, session times/formats, published speaker names/titles). No session prose copied. |
| `global/` | Machine-readable global inputs (see below). |
| `scenarios/s1-supplier-disruption/` … `s8-speaker-group-travel/` | Complete literal input packs for S1–S8. |
| `README.md` | Pack introduction, taxonomy table, feasibility record. |

Validation gate: `scripts/validate-ait-demo-inputs.mjs`
(`node --experimental-strip-types scripts/validate-ait-demo-inputs.mjs`).
Checks JSON parse, provenance taxonomy on every file, roster counts 67/42/25,
repo-schema validation (AnchorEventSchema, PlaceSchema,
ProgrammeImportDraftSchema, RuleSetSchema, Importance/Flexibility enums),
commitment/role/importance reference resolution, per-scenario manifest-vs-file
provenance agreement, sourceId→registry resolution for every citation, and a
real-name cross-check proving no roster identity collides with a real WiT
speaker name.

## Provenance summary

| Label | Meaning | Used in pack |
| --- | --- | --- |
| `PUBLIC_WEB` | Fetched from the public web; URL + fetch timestamp preserved. | `sources/public-web/` normalization; registry entries. |
| `ORGANISER_SUPPLIED_SYNTHETIC` | Synthetic organiser-authored input. | All `global/` artifacts; baseline/proposed itineraries in scenario packs. |
| `TRAVELLER_SUPPLIED_SYNTHETIC` | Synthetic traveller-authored input. | Traveller messages in S2/S4/S5/S6/S7/S8; S3 organiser change request. |
| `PROVIDER_LIVE` | Real provider data. | **Not used** — no live provider calls were made for this pack. |
| `NATIVE_UI` | Native Northstar actions (Preview/Commit). | S3 preview request + counterfactual preview; S8 disclosure-and-decision. |
| `SIMULATED_EXTERNAL_EVENT` | Simulated external-boundary effect, disclosed, never presented as LIVE. | All Meridian Airways (MN) artifacts; S6 hotel inventory feed. |

Synthetic facts are never labelled public or live. Simulated seams are
explicit in both data (`provenance` fields) and this documentation.

## Source inventory (11 sources)

From `sources/source-registry.json`:

| id | Provenance | Content |
| --- | --- | --- |
| `src-pub-wit2026-programme` | PUBLIC_WEB | WiT Singapore 2026 full programme (official site) — structural facts only. |
| `src-pub-wit2026-event` | PUBLIC_WEB | WiT Singapore event overview — dates/venue corroboration. |
| `src-pub-webintravel-dates` | PUBLIC_WEB | webintravel.com — independent date-window corroboration. |
| `src-repo-scenarios` | ORGANISER_SUPPLIED_SYNTHETIC | `docs/SCENARIOS.md` frozen S1–S8 catalogue the packs must serve. |
| `src-repo-atlas-sin-feasibility` | ORGANISER_SUPPLIED_SYNTHETIC | Atlas sandbox evidence (SIN inbound offers from KUL/BKK/MNL/HKG/CGK/SYD/TYO; KUL→SIN full order/pay/ticket chain) governing origin-city choice. |
| `src-syn-ait-event` | ORGANISER_SUPPLIED_SYNTHETIC | Synthetic AiT event definition (`global/anchor-event.json`). |
| `src-syn-ait-roster` | ORGANISER_SUPPLIED_SYNTHETIC | Synthetic 67-person operational roster (`global/roster.json`). |
| `src-syn-ait-policy` | ORGANISER_SUPPLIED_SYNTHETIC | Synthetic organiser travel policy (`global/organiser-policy.json`). |
| `src-sim-airline-mn` | SIMULATED_EXTERNAL_EVENT | Simulated carrier "Meridian Airways" (MN) schedule/inventory feeds. |
| `src-sim-hotel-partners` | SIMULATED_EXTERNAL_EVENT | Simulated partner-hotel availability/rate feed (Bayview Grand / Harbourline Suites). |
| `src-syn-traveller-messages` | TRAVELLER_SUPPLIED_SYNTHETIC | Synthetic traveller/operator message channels for S2/S4/S5/S6/S7/S8. |

## Global input inventory (`global/`)

| File | Provenance | Content |
| --- | --- | --- |
| `anchor-event.json` | ORGANISER_SUPPLIED_SYNTHETIC | `evt-ait-2026` AnchorEvent with AnchorCommitments for every session (no importance on commitments) — parses against `AnchorEventSchema`. |
| `places.json` | ORGANISER_SUPPLIED_SYNTHETIC | Place/venue context (MBS, partner hotels, Changi, gateway airports) incl. `gatewayFeasibility` flags for non-sandbox-proven origins — parses against `PlaceSchema`. |
| `roster.json` | ORGANISER_SUPPLIED_SYNTHETIC | 67 participants = **42 NORTHSTAR_ARRANGED + 25 SELF_OR_OTHER_ARRANGED** (explicit declarations only). Travel-managed origins concentrated on sandbox-proven gateways (KUL/BKK/MNL/HKG/CGK/SYD/HND); long-haul origins flagged. Carries an explicit `unresolvedStatements` entry (companion question) rather than inventing a draft. |
| `programme.json` | ORGANISER_SUPPLIED_SYNTHETIC | Normalized 3-day schedule + `roleAssignments` (draftId ↔ commitmentId ↔ role) + shared-dependency patterns (`SHARED_FLIGHT_GROUP` for the Wanderpay delegation, serial-host dependency for the curator). |
| `programme-importance.json` | ORGANISER_SUPPLIED_SYNTHETIC | Per-traveller per-engagement importance (`REQUIRED/PREFERRED/OPTIONAL`) and flexibility (`FIXED/CHANGEABLE/FLEXIBLE`) from repo enums; on-stage roles REQUIRED/FIXED, panellist/judge/dragon PREFERRED/CHANGEABLE, socials OPTIONAL/FLEXIBLE. |
| `organiser-policy.json` | ORGANISER_SUPPLIED_SYNTHETIC | All policy values in data: ruleSets (`rs-ait-event-funding`, parseable by `RuleSetSchema`: FUNDED_WINDOW, SPEND_LIMIT ×2, APPROVAL_ABOVE_SPEND ×2, APPROVAL_REQUIRED, MIN_BUFFER, CHANGE/CANCELLATION/NO_SHOW_TERMS) + narrative `clauses` with `machineHint`s + recorded `schemaGaps`. |
| `operational-constraints.json` | ORGANISER_SUPPLIED_SYNTHETIC | Demo timeline ("now" anchor + milestones), arrival/departure conventions, badge/check-in windows, ground-transfer `DurationEstimate`s (shape-compatible with `src/domain/rules.ts` MIN_BUFFER consumption), duty-of-care desk. |

## Per-scenario inventory (`scenarios/`)

Each pack = `scenario.json` manifest (provenance, sourceIds, trigger, stage,
tier, affectedTravellers with impactClass, expectedReasoningHooks, input list,
referenced draft/commitment ids) + `inputs/` literal artifacts. Manifest and
file provenance always agree (gate-enforced).

### S1 — Airline schedule change affects several speakers; one becomes critical
- Tier A · `SUPPLIER_EVENT` · POST_BOOKING_BEFORE_TRAVEL · main organiser hero. occurredAt 2026-09-21.
- Simulated carrier MN retimes shared KUL→SIN inbound **MN218** (30 Sep 06:15 → 1 Oct 06:00) and cancels MNL→SIN **MN204**; airline auto-rebooks everyone.
- Affected: Sarah Lim (draft-14, MATERIALLY_DISRUPTED — provider replacement leaves 2h10m vs 12h buffer), Mei Chen (draft-15, COMMITMENT_BROKEN — no earlier alternative exists), Arjun Rao (draft-10, VIABLE_TIGHT), Siti Rahmah + Mei Ling Goh (draft-11/30, VIABLE), Isabella Santos (draft-13, RECOVERABLE_BY_PROVIDER).
- Inputs (4): `airline-schedule-change-mn218.json` (SIMULATED), `airline-cancellation-mn204.json` (SIMULATED), `baseline-itineraries.json` (ORGANISER), `alternative-services-inventory.json` (SIMULATED).
- Hero line: rebook only Sarah's KUL→SIN segment onto **MN220** (30 Sep 14:10→15:20, same carrier, no fare increase) — provider rebooked ≠ trip recovered.

### S2 — Traveller misses a connection; airline recovery is not good enough
- Tier A · `TRAVELLER_STATE_REPORT` · DURING_TRAVEL · traveller disruption hero. occurredAt 2026-09-29.
- Chloe Martin (draft-09, SYD, hackathon finalist) misses her KUL connection; airline rebooking lands 30 Sep 09:20 — too late for REQUIRED/FIXED finals at 15:10.
- Inputs (4): `traveller-report-message.json` (TRAVELLER), `baseline-itinerary.json` (ORGANISER), `provider-rebooking-state.json` (SIMULATED), `recovery-options-inventory.json` (SIMULATED).
- Recovery: **MN224** (29 Sep 20:30→21:40) restores viability; arrival shift 3h50m exceeds the 3h delegated-authority bound → HUMAN_AGENT approval; supplier-caused → no cost to traveller.

### S3 — Headline speaker needs to leave earlier; organiser previews consequences
- Tier A · `ORGANISER_EVENT_SIDE_CHANGE` · POST_BOOKING · architectural/enterprise hero. occurredAt 2026-09-22.
- Grace Nakamura (draft-04, NRT) must depart SIN by ~10:30 on 1 Oct; organiser asks for a counterfactual PREVIEW of moving her commitment earlier — no authoritative mutation.
- Preview swaps future-provocation ↔ marketplace-chat: Grace becomes viable, Daniel Ong (draft-02, local) remains viable, Lucas Ferreira (draft-20) BECOMES_DISRUPTED (his same-day MN231 return collides; ~SGD 95 rebook).
- Inputs (4): `organiser-change-request.json` (ORGANISER/TRAVELLER-channel), `preview-request.json` (NATIVE_UI), `counterfactual-preview.json` (NATIVE_UI), `outbound-options-inventory.json` (SIMULATED).

### S4 — "Can I arrive Thursday morning instead?"
- Tier A · `TRAVELLER_REQUESTED_CHANGE` · PRE_BOOKING · preference/constrained optimisation. occurredAt 2026-09-08.
- Ethan Yap (draft-34, CNX, hackathon finalist) asks to arrive 1 Oct; the requested flight is cheaper (SGD 168 vs 205) and still must be rejected: commitments predate arrival; even the Wednesday compromise fails the 12h programme-critical buffer.
- Inputs (3): `traveller-request-message.json` (TRAVELLER), `proposed-itinerary.json` (ORGANISER), `requested-options-inventory.json` (SIMULATED).

### S5 — "Can I stay until Sunday?"
- High-priority Stretch · `TRAVELLER_REQUESTED_CHANGE` · POST_BOOKING. occurredAt 2026-09-18.
- Jonas Berg (draft-35, AMS, recovery-fireside REQUIRED/FIXED 1 Oct 15:30; business cabin inbound per cabinRules) requests a 4 Oct return.
- Business/personal split: fare delta +148 traveller; extension nights 2 Oct + 3 Oct = 570 traveller (incl. the in-window-but-extension-caused 2→3 Oct trap); out-of-window return transfer 38 traveller; event keeps the business-equivalent portion intact. Total traveller increment 756 + HUMAN_AGENT approval + explicit consent.
- Inputs (4): `traveller-extension-request.json` (TRAVELLER), `booked-itinerary.json` (ORGANISER), `return-options-inventory.json` (SIMULATED, MN240/244-style returns incl. Saturday alternative), `hotel-and-transfer-impact.json` (ORGANISER).

### S6 — "Can I switch hotels? My partner is joining."
- High-priority Stretch · `TRAVELLER_REQUESTED_CHANGE` · POST_BOOKING. occurredAt 2026-09-19.
- Hannah Weiss (draft-31, FRA, hospitality-interview REQUIRED/FIXED 1 Oct 10:30) switches Bayview single → Harbourline junior suite with partner joining.
- Discriminator inventory: JUNIOR_SUITE 318 ≤ 320 ceiling (admissible via `clauses.accommodationCeiling` preferredPlaces), ONE_BEDROOM_SUITE 355 must be rejected/needs approval, STANDARD_DOUBLE 298. Cancellation terms checked (free modification until 2026-09-27). Room increment 33×3 = 99 + companion seat (business 1160 / economy 540) all traveller-funded via explicit funding declaration. Morning buffer re-validated after the switch.
- No companion ontology added (catalogue MVP boundary); partner recorded as `NON_PARTICIPANT_NO_ROSTER_ENTRY`.
- Inputs (4): `traveller-hotel-change-request.json` (TRAVELLER), `current-booking.json` (ORGANISER), `harbourline-room-inventory.json` (SIMULATED, src-sim-hotel-partners), `companion-seat-inventory.json` (SIMULATED, src-sim-airline-mn).

### S7 — "I'm actually flying from Tokyo, not London."
- Tier A · `TRAVELLER_REQUESTED_CHANGE` · **PARTIALLY_BOOKED**. occurredAt 2026-09-18.
- Oliver Bennett (draft-38, distribution-debate PREFERRED/CHANGEABLE → standard 6h buffer, economy per cabinRules) will depart HND instead of LHR — a structural topology change, not a flight change.
- Obsolete LHR sector is past the refund deadline (abandoned sector non-refundable; reissue fee 75 traveller-funded). Only overnight **MN247** (30 Sep 23:40→1 Oct 06:00, 340, 9h50m > 6h) passes; MN249 fails the buffer (2h20m); MN251 infeasible. Return candidates for BOTH destinations supplied (keep MN244 LHR vs MN246 HND 355).
- Return destination is **NOT_STATED** → the engine must ask/escalate, never invent.
- Inputs (3): `traveller-origin-change-message.json` (TRAVELLER, carries the brief's quote verbatim), `booked-itinerary.json` (ORGANISER), `hnd-sin-options-inventory.json` (SIMULATED).

### S8 — "Can I travel with the other speakers?"
- High-priority Stretch · `TRAVELLER_REQUESTED_CHANGE` · PRE_BOOKING. occurredAt 2026-09-12.
- Mei Ling Goh (draft-30) requests the Wanderpay trio (draft-10 Arjun Rao REQUIRED keynote/moderator, draft-11 Siti Rahmah, draft-30) travel together. The `criticalParticipantTransportConcentration` clause fires: all-three-on-MN218 would strand the payments-keynote cast under a single disruption → operator proposes a split, discloses the trade-off (NATIVE_UI `disclosure-and-decision.json`, artifact `ait-s8-disclosure-001`); travellers explicitly choose TOGETHER_ON_MN218 after disclosure → honoured with consents and acceptedRisk recorded.
- Data cross-reference: S1 (21 Sep) later retimes exactly MN218 with all three aboard — the flag was prescient. Both services (MN218/MN220) same fare SGD 98 and viable for everyone; the decision is purely correlated-risk. No scenario-specific risk logic — clause + machineHint only.
- Inputs (4): `traveller-group-request.json` (TRAVELLER), `baseline-group-itineraries.json` (ORGANISER), `same-day-alternatives-inventory.json` (SIMULATED), `disclosure-and-decision.json` (NATIVE_UI).

## Schema gaps (for the primary integrator)

Recorded verbatim in `global/organiser-policy.json → schemaGaps`; each gap is
encoded as clause + `machineHint` in data rather than hardcoded logic:

1. **cabinRules** — no `PolicyRule` kind expresses cabin-class rules.
2. **accommodationCeiling** — `SPEND_LIMIT` has no recurrence semantics (per-trip vs per-night).
3. **delegatedAuthority** — no rule kind expresses delegated/pre-approved operator authority (same-carrier rebook, fare delta ≤ 0, arrival shift ≤ 180 min; same-block hotel swap; transfer re-dispatch).
4. **arrivalBuffer** — `MIN_BUFFER` has no importance-dependent variants; the 12h programme-critical buffer + 23:00 land-by live in the clause machineHint.
5. **criticalParticipantTransportConcentration** — no rule kind expresses transport concentration / correlated-risk (S8).
6. **standardOccupancy / companionAndUpgradeIncrement / rehearsalAndRestRules** — no rule kinds express occupancy, companion/upgrade funding increments, or rehearsal/rest windows.

## Demo date recommendation

Demo "now" anchor: **2026-08-25T10:00+08:00** (`operational-constraints.json →
demoTimeline`). At this anchor every policy deadline is still open: the
refundable-cancellation deadline (15 Sep) is ahead, booking decisions sit in
the pre-event window, and the Atlas sandbox KUL→SIN order/pay/ticket chain
remains usable for dates inside the window.

**The 30 Sep – 2 Oct 2026 event window is usable; no date adjustment is
recommended.**

## Integration notes

- **Runtime seams**: all `SIMULATED_EXTERNAL_EVENT` artifacts arrive at demo
  runtime as REPLAY recordings of the same shapes; nothing in the pack may be
  presented as LIVE. Tier A scenario S7 is REPLAY-expected per the catalogue.
- **No code changes required by this pack.** Transfer estimates are shaped to
  `DurationEstimateSchema`; policy ruleSets parse against `RuleSetSchema`;
  roster/anchor-event parse against intake/entity contracts — verified by the
  gate against the actual repo schemas.
- **`data/` is gitignored** in this repository; pack files are committed with
  narrow `git add -f <exact path>` staging. Integrators re-checking the pack
  should use the same discipline (never `git add .`).
- **Honest-capability boundaries preserved**: S6 adds no companion ontology;
  S8's correlated-risk constraint exists only as policy clause + machineHint;
  S7 pauses on UNKNOWN return destination (ask/escalate, never invent);
  Mei Chen (S1) has no flight-side recovery — the pack records the organiser
  decision surface instead of inventing certainty.
- **Validation**: `node --experimental-strip-types scripts/validate-ait-demo-inputs.mjs`
  — currently clean: `OK — 47 JSON files under data/ait-demo-input-pack validated.`
