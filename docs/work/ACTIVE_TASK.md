# ACTIVE_TASK — Final Jordan S2 hotel-execution closure (NORTHSTAR)

## Goal

Jordan's recovery executes BOTH the replacement onward flight AND the required
Narita overnight through real provider paths, sequentially, in one RecoveryCase.
"Northstar recovered Jordan's trip, not just his flight."

## Base / branch

- Base HEAD: `fca63dc` (== origin/main at start)
- Branch: `main`
- Production: https://qoder-atlas-production.up.railway.app
- Completed checkpoints inherited: `6c7c893` (logo), `5d917fc` (hotel.book
  classification), `fca63dc` (genuine Nuitée evidence: Narita search 18
  properties/54 rates, quote `pF0VrYSRC`, book `Z6m40cM3X`, CONFIRMED, cleanup).

## Architecture decision (FROZEN — do not reopen)

Sequential single-action recovery cycles within the SAME RecoveryCase.
NO plural intent arrays, NO saga contract, NO HTTP-surface changes to arrays.

1. FLIGHT cycle: proposal → authority (REQUIRES_HUMAN_AGENT) → flight.change
   intent → Atlas executor → observed TICKETED → verifier.
2. Verifier: flight confirmed BUT required overnight unresolved → case returns
   to PLANNING (never FULLY_RECOVERED).
3. HOTEL cycle: plan again → hotel.search evidence round → hotel-only strategy
   (candidate STAY with `bookingRef {system:'hotel-provider', reference:rateId}`,
   PLACE upsert for provider property) → authority → `hotel.book` intent →
   Nuitée executor quote → payment gate → book → retrieve CONFIRMED → observed
   Stay promoted.
4. Verifier re-runs → FULLY_RECOVERED.

## Resolution gate (Phase 6) — generic derivation

CaseVerifier detects an unresolved required overnight from trip topology:
consecutive FLIGHT legs sharing a hub place whose local arrival day < local
departure day require nights [arrivalDay, departureDay) at the hub; covered
only by a STAY whose place IS the hub or is `servedBy` the hub and whose
check-in/out days span the nights. Uncovered => suggestedCaseStatus PLANNING.
No scenario/traveller/place-id branches anywhere in engine logic.

## Phase 2 — programme dossier + Narita place

- `programmeSeed.ts` gains optional `booking-dossiers.json` companion
  (same BookingDossierBundleSchema as scenario bundles), referential integrity
  against `trv-{anchorEventId}-{draftId}` derived from importDraft travellers.
  Wired through compose.ts boot + runtime.reset (dossiers store).
- Jordan hotel dossier: guestNames `["Jordan Hale"]` (existing conventions;
  no Traveller ontology change, no name branches in app logic).
- Narita Gateway Hotel (Nuitée `lp3a936`) added as a PLACE through pack
  places.json + committed programme.json (additive; survives rebuild path),
  `servedByPlaceIds: ['place-nrt']`, provider-normalized name/coordinates from
  the captured search recording.
- `place-nrt` gains coordinates (35.772, 140.3929 — the recorded search
  location) so hotel.search location mapping is deterministic and REPLAY-stable.
- NOTE: committed programme.json carries 156 hand patches beyond the pack —
  NO full rebuild; additive edits only.

## Phase 4 — app RECORD chain

Recordings hash = sha256(providerId|operation|canonicalJson(capability query)).
`executeHotelReplacement` uses `clientReference = intent.id`, so the standalone
script's book recording cannot satisfy the app's request — the real app must
record its own quote/book/retrieve in RECORD mode (`ADAPTER_MODE=RECORD`,
`NUITEE_API_KEY`), driving Jordan through HTTP: plan→begin→decide→execute
(flight) → plan→begin→decide→execute (hotel). Then cancel the live sandbox
booking; keep the CONFIRMED evidence recordings for REPLAY.
Search query must equal the captured shape (coordinates, 2026-09-29→30,
guests {adults:1}, rooms:1) to stay REPLAY-compatible with the fca63dc search.

## SSOT reconciliation (DONE)

- `data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/baseline-itinerary.json`:
  SIN hotelStay checkIn reconciled 29 Sep → **30 Sep 15:00** (+08:00);
  noShowCutoff moved to 2026-10-01T00:00+08:00 (post check-in date).
- `docs/FINAL_DEMO_CONTENT_SSOT.md` Jordan hotel row now says 30 Sep 15:00.
- Generated programme.json already carried the authoritative 30 Sep value.

## Tests asserting resolved-after-flight (must be UPDATED with the flow)

- fixtures/acceptance/manifests/s2-missed-connection.json (execute_recovery
  asserts RESOLVED; add hotel cycle steps after flight execution)
- test/integration.r2-rehearsal.test.ts (runs the manifest end-to-end)
- test/final-demo-lifecycle-convergence.test.ts (Jordan execute → RESOLVED)
- test/e2e/hero-lifecycle-rehearsal.test.ts (Jordan approve → execute →
  case-phase-resolved)
Known baseline: 15 unrelated failures; do not repair unless new regression.

## Workflow

Checkpoint commit per phase; exact-path staging only; push at the end; Railway
confirm; reset populated world; rehearse Jordan on production REPLAY; capture
final screenshots. STOP (hard stop) if the only path forward needs plural
intents/sagas/broad authority rewrite/scenario-specific engine logic.

## Status

- [x] Repo state confirmed; commits inspected; sources read
- [x] SSOT reconciliation (SIN check-in 30 Sep)
- [ ] Phase 2: programme hotel dossier + Narita place
- [ ] Phase 3: generic overnight hotel follow-up (planner + gate)
- [ ] Phase 4: app RECORD chain
- [ ] Phase 5: whole-trip plan presentation
- [ ] Phase 6: resolution gate (implemented with Phase 3)
- [ ] Tests + gates
- [ ] Ship: push, Railway, populated world, production rehearsal, screenshots
