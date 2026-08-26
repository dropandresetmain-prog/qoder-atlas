# Northstar Scenario Catalogue (Frozen)

**Source of truth.** This document is the authoritative source of truth for
Northstar scenario business narratives, capability claims, implementation
priority and demo intent. It supersedes any older wording (including Case A/B/C
demo narratives and the earlier four-scenario family set) wherever those
documents describe the *current final scenario catalogue*.

Executable facts remain in fixtures/configuration. Generic application/domain
logic must never depend on scenario IDs or names (see Anti-hardcoding rule).

**Freeze status.** The final product scenario set is frozen at **8 scenarios**
(S1–S8). Changes to this catalogue require a deliberate supersession decision;
do not edit silently.

**Scope of this document.** This records product scenarios, MVP execution
status, stretch targets, demo provenance and the distinction between
illustrative and invariant outcomes. It is NOT a video script and NOT an
implementation plan.

## Relationship to other documents

- `docs/FINAL_DEMO_CONTENT_SSOT.md` — **final-demo world content** (event
  identity, venues, programme timings, population, hero cast, baseline
  flights/hotels, scenario↔person mapping). This catalogue owns *what happens
  over time*; the content SSOT owns *who/where/when* of the synthetic world.
  Do not duplicate stable cast/venue facts here — reference the content SSOT.
- `docs/DEMO.md` — demo principles, provenance label definitions, runtime demo
  path and backup paths. Scenario definitions point here.
- `docs/PRODUCT_SPEC.md` — product model and requirements. Cases A/B/C remain
  frozen **engine acceptance cases** (historical proof paths); they are not the
  current final scenario source of truth.
- `docs/ROADMAP.md` — capability scope/status, including the MVP vs
  High-Priority Stretch recording of this catalogue.
- `docs/WAVE3R_DEMO_READINESS_PLAN.md` — its historical S1–S4 scenario families
  are superseded by this catalogue for scenario naming and intent. Final-video
  order is **S2 → S1 → S3 → S7 → S5**.

## Tiering summary

### LIVE-readiness scope — In Progress

| ID | Scenario |
|----|----------|
| S1 | Airline schedule change affects several speakers; one becomes critical |
| S2 | Traveller misses a connection; airline recovery is not good enough |
| S3 | Headline speaker needs to leave earlier; organiser previews consequences |
| S4 | "Can I arrive Thursday morning instead?" |
| S7 | "I'm actually flying from Tokyo, not London." |

These are intended to run through natural Northstar product/application
boundaries and the same generalized state/recovery/authority engine.

| ID | Scenario |
|----|----------|
| S5 | "Can I stay until Sunday?" |
| S6 | "Can I switch hotels? My partner is joining." |
| S8 | "Can I travel with the other speakers?" |

All eight scenarios are now required to become runnable through the same
generalized Northstar application path. This supersedes the historical
Tier-A/Stretch execution split, but does not alter the catalogue's product
narratives. The only approved simulated external seams are recorded in
`docs/LIVE_SCENARIO_READINESS.md`; an internal capability gap is not a
simulation seam.

---

## S1 — Airline schedule change affects several speakers; one becomes critical

- **Trigger:** supplier/provider event
- **Stage:** post-booking, before travel
- **Priority:** Tier A — MVP executable
- **Demo role:** Main organiser hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable. A simulated external
  trigger is never presented as LIVE.

**Corridor:** CGK→SIN for the S1 regional cohort.

Reason:
- strong live Atlas inventory/timing diversity
- believable high-frequency regional organiser travel
- useful differentiated downstream outcomes

Do not encode any assumption about CGK delays in application logic.

An airline cancels or materially retimes a service used by multiple inbound
speakers.

Northstar evaluates affected travellers individually rather than assuming the
provider's replacement solves every trip.

The intended demo shape is that several speakers are affected differently:

- some remain viable;
- some may need minor downstream adjustment;
- at least one important speaker becomes materially disrupted.

The airline may already have automatically proposed replacement travel.

For the critical traveller, that replacement gets them to the destination but
violates downstream requirements such as rehearsal, rest or keynote timing.

Northstar evaluates alternatives across:

- transport;
- connections;
- arrival buffers;
- hotel;
- transfer;
- event commitments;
- fare/change rules;
- policy;
- authority.

**Core thesis:** Provider rebooked does not necessarily mean trip recovered.

**Capability proof:**

- programme-wide blast radius;
- differentiated traveller impact;
- provider-recovery validation;
- whole-trip viability;
- policy/authority;
- execution;
- observation.

Any exact affected-traveller counts are fixture/demo values, not domain
invariants.

### Final-demo choreography (S1)

Stable cast, flights, and slots: `docs/FINAL_DEMO_CONTENT_SSOT.md` §5–§7
(Sarah Lim critical; Wanderpay cohort; CGK→SIN).

| Stage | What happens |
|-------|----------------|
| **Initial state** | Post-booking. Multiple CGK→SIN speakers confirmed on shared morning service. Sarah’s hard commitment is Day-1 headline **09:20**. Baseline arrivals clear the 360-minute buffer. |
| **Trigger** | Simulated airline schedule change / retime enters via the real flight-event ingress (`SIMULATED SOURCE EVENT` disclosed — not LIVE). |
| **Successive state changes** | Shared inbound retimed; airline auto-rebooks cohort onto a later morning arrival (~07:00 Day 1 class). Blast radius fans out per traveller. |
| **Provider/AI/tool evidence** | Atlas schedule/search REPLAY for CGK→SIN alternatives; deterministic constraint eval against `MIN_BUFFER` 360; programme commitment graph. |
| **Deterministic viability** | Differentiated: Wanderpay afternoon speakers remain **VIABLE**; Sarah’s gap to 09:20 fails 360 → **NOT_VIABLE**. Travel-only strategies do not restore the morning slot. |
| **Authority/decision** | Organiser-facing recovery case; programme-side options may be **proposed** but not auto-committed. |
| **Surfaces** | Organiser blast-radius / case view; traveller trip view for Sarah. |
| **Action/observation** | No money-moving auto-act that “fixes” the headline; hand-off into **S3** on the **same trip** (no reset). |
| **Final state (of S1 alone)** | Critical case remains open / not fully resolved pending programme change. |

## S2 — Traveller misses a connection; airline recovery is not good enough

- **Trigger:** traveller-state report
- **Stage:** during travel
- **Priority:** Tier A — MVP executable
- **Demo role:** Traveller disruption hero / supporting hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

**Corridor:** LAX → NRT → SIN with ZIPAIR baseline evidence.

Baseline provider evidence:
- ZIPAIR ZG023 LAX→NRT
- ZIPAIR ZG053 NRT→SIN
- genuine 2h40m connection
- Atlas-backed recovery inventory includes later NRT→SIN options including Scoot services

The disruption should be PROGRESSIVE:
- upstream delay increases in multiple updates
- initially connection remains viable
- then becomes tight
- then ZG053 becomes impossible
- Northstar continues recalculating as evidence changes
- a later same-night recovery may temporarily remain feasible
- further delay eventually eliminates the last sensible same-night option
- traveller must overnight near Narita

Recovery must consider:
- replacement NRT→SIN flight
- transit hotel
- authoritative Japanese entry/immigration requirements for overnight landside stay
- traveller insurance missed-connection / emergency accommodation coverage where supplied
- Singapore hotel/stay consequences
- ground transfer
- event commitments

The synthetic event programme should be shaped AFTER provider timing is known:
- flexible enough that recovery is possible
- constrained enough that airline's slower/default reprotection may be inadequate
- Northstar-selected morning recovery can restore viability

Do not require Atlas to have sold every baseline ancillary/state fact if the capability is independently proven; synthetic booking/programme context is acceptable under the demo truth doctrine.

The traveller reports naturally that their first flight landed late, they
missed the connection, and the airline has moved them to another flight.

Northstar reconciles the report against authoritative/expected trip state.

The provider replacement may still invalidate downstream trip requirements
such as:

- hotel/no-show timing;
- airport transfer;
- baggage;
- required rest;
- rehearsal;
- keynote/fireside commitments.

Northstar compares provider state and alternatives and deterministically
rejects recoveries that do not preserve the trip's actual objectives.

**Capability proof:**

- conversational/state ingestion;
- partially executed trips;
- provider-state reconciliation;
- downstream invalidation;
- deterministic viability;
- recovery.

**Core message:** Northstar reasons about whether what actually happened still
leaves the trip viable.

### Final-demo choreography (S2) — progressive delay stages

Stable cast and programme: Jordan Hale (`ait-draft-09`); hard finals showcase
**30 Sep 20:45–21:05**; baseline ZG023/ZG053 — see content SSOT §5.

| Stage id | What happens | Viability intent |
|----------|--------------|------------------|
| **initial_state** | In travel. LAX→NRT→SIN confirmed (PNR ZGSYN09). Connection 2h40m. SIN Concorde stay booked (check-in 30 Sep after possible overnight). Finals showcase tomorrow evening. | Baseline **VIABLE** |
| **trigger / delay_1** | Simulated Atlas schedule/delay notification on ZG023 — delay begins; connection still comfortable. | Still **VIABLE** |
| **delay_2_tight** | Further delay; NRT connection becomes tight but still theoretically makeable. | **VIABLE_TIGHT** / watch |
| **zg053_impossible** | Upstream delay makes ZG053 impossible; missed-connection signal; airline may still suggest same-night options. | Onward leg **failed**; recovery search opens |
| **same_night_temp** | Scoot **TR875** (NRT→SIN evening → arrive SIN ~05:20) still feasible for the evening showcase under 360. Jordan is not bound to the morning lab. | Same-night recovery **temporarily VIABLE** |
| **same_night_killed** | Further delay / misconnect eliminates last sensible same-night option. Overnight landside at Narita required. | Same-night **NOT_VIABLE** |
| **overnight_recovery** | Transit hotel (Hilton Narita / MYSTAYS class), JP entry/immigration AUTHORITATIVE research, insurance missed-connection cover where supplied, SIN hotel/no-show consequences. | Planning overnight + morning |
| **airline_morning** | Airline default reprotection → Scoot **TR867** arrive SIN **20:45** — at/after the 20:45 showcase → deterministic **FAIL** vs 360/commitment. | Airline path **inadequate** |
| **northstar_morning** | Northstar selects Scoot **TR885** arrive SIN **14:35** → gap to 20:45 = **370 ≥ 360** → **PASS**. | Northstar path **VIABLE** |
| **authority / surfaces** | Traveller disruption + organiser case; provenance REPLAY/RECORD. | Approval as policy requires |
| **action / observation** | Permitted recovery actions through provider boundary where supported; observe; authoritative trip update. | |
| **final_state** | Trip remainder viable for finals showcase; overnight + morning recovery recorded. | **RESOLVED / VIABLE** |

Do **not** treat VietJet VJ823 as a direct NRT→SIN 12:55 hero option (recordings show NRT→SGN connections).

## S3 — Headline speaker needs to leave earlier; organiser previews consequences

- **Trigger:** organiser event-side change
- **Stage:** post-booking
- **Priority:** Tier A — MVP executable
- **Demo role:** Architectural / enterprise hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

**S1 → S3 Continuity:** S3 continues directly from S1 without reset.

Northstar may PROPOSE programme/non-travel recovery options but cannot autonomously mutate the programme.

Preferred resolution:
- critical traveller's existing airline rebooking does not satisfy current speaking slot
- Northstar proposes moving/swapping the slot with a later commitment held by a local/non-travel-dependent participant
- organiser previews impact with zero authoritative mutation
- organiser approves/commits
- programme state updates
- affected S1 case re-runs/re-evaluates
- previously insufficient airline rebooking becomes viable
- case resolves

A headline speaker's availability changes because of another commitment.

The organiser considers moving the speaker's programme commitment earlier so
they can take an earlier outbound flight.

Northstar must first perform a counterfactual preview rather than immediately
mutating the event.

The preview can reveal consequences across multiple linked travellers, for
example:

- headline speaker becomes viable;
- moderator remains viable;
- another participant becomes disrupted;
- transfer assumptions change;
- travel recovery may incur additional spend.

Northstar may compare strategies such as:

- reschedule the commitment and recover affected travel;
- swap programme blocks;
- change the headline speaker's outbound travel instead;
- leave the programme unchanged.

A programme-level change may solve the problem without purchasing travel.

**Capability proof:**

- AnchorEvent → Trip propagation;
- counterfactual blast radius;
- multi-traveller reasoning;
- programme-vs-travel strategy comparison;
- preview-before-commit.

**Core message:** Before changing the programme, know whose trip you are about
to break.

### Final-demo choreography (S1 → S3 continuity)

Same person/trip as S1: Sarah Lim / `ait-draft-14`. Locals Daniel Ong + Elena
Tan — content SSOT §5. **No runtime reset** between S1 and S3.

| Stage | What happens |
|-------|----------------|
| **Initial state** | Continues from S1: Sarah **NOT_VIABLE** against 09:20 headline after airline rebook ~07:00. |
| **Trigger** | Organiser considers programme-side resolution (availability / slot move), not a new travel purchase. |
| **Successive state changes** | Counterfactual preview only — zero authoritative mutation until commit. |
| **Provider/AI/tool evidence** | Programme graph + trip constraints; optional travel alternatives remain visible but secondary. |
| **Deterministic viability (preview)** | Proposed RESCHEDULE of headline → **15:30–16:00** Day 1: Sarah’s airline arrival clears 360; preview lists blast-radius faces (Elena interviewer; Daniel local CHANGEABLE). |
| **Authority/decision** | Organiser must explicitly **commit**; Northstar cannot auto-mutate programme. |
| **Surfaces** | Organiser event-change preview / commit; case view still on Sarah’s trip. |
| **Action/observation** | Commit → programme state updates → **same trip re-evaluates**. |
| **Final state** | Sarah **VIABLE**; S1 case can resolve without buying a new flight. |

## S4 — "Can I arrive Thursday morning instead?"

- **Trigger:** traveller-requested change
- **Stage:** pre-booking / before ticketing
- **Priority:** Tier A — MVP executable
- **Demo role:** Traveller preference / constrained optimisation
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

The proposed itinerary brings the speaker in Wednesday evening.

The traveller asks to arrive Thursday morning instead.

Northstar evaluates alternatives against:

- rehearsal/keynote timing;
- required arrival buffer;
- immigration/baggage assumptions;
- airport-to-venue travel;
- local travel uncertainty;
- accommodation implications;
- fare difference;
- organisation policy.

A cheaper or more convenient flight may be rejected because it creates
insufficient event buffer.

**Capability proof:**

- traveller preference interpretation;
- constrained optimisation;
- event-purpose-aware planning;
- deterministic viability.

**Core message:** A booking engine knows which flights exist. Northstar knows
which flights still make the trip work.

## S5 — "Can I stay until Sunday?"

- **Trigger:** traveller-requested change
- **Stage:** post-booking
- **Priority:** High-priority Stretch
- **MVP boundary:** May be simulated/catalogued; not required to be fully
  executable for G3R
- **Provenance:** SIMULATED material is acceptable for MVP/G3R demo
  representation and must be disclosed as such.

**Post-booking personal extension.**

Funding rule:
covered baseline = LOWER OF:
- eligible value of the already-booked event hotel/stay
- applicable organisation/event hotel allowance

Anything incremental due to the traveller's personal extension is traveller-funded.

Desired demo:
- hotel/stay extension
- return travel changed if necessary
- deterministic funding split
- within configured traveller/self-funded authority
- Northstar resolves automatically without organiser approval

The conference ends Friday and the traveller wants to extend the trip
personally.

Potential reasoning includes:

- return-flight rules;
- business-equivalent airfare;
- extra hotel nights;
- event-funded versus personal expenses;
- airport-transfer coverage;
- downstream commitments.

**Capability target:**

- business/personal trip boundary;
- cost attribution;
- policy interpretation;
- multi-element modification.

Do not claim sophisticated multi-payer/cost-splitting execution unless it is
genuinely implemented.

### Final-demo choreography (S5)

Cast/slot/hotel: Jonas Berg (`ait-draft-35`); fireside **14:30–14:50** Day 1;
Concorde `lp21d9f` — content SSOT §5.

| Stage | What happens |
|-------|----------------|
| **Initial state** | Post-booking. Event-funded hotel through **3 Oct 11:00**. Fireside commitment already satisfied by baseline stay. |
| **Trigger** | Traveller NL request: stay until Sunday (checkout **4 Oct**). |
| **Successive state changes** | Stay extension candidate; optional return-flight change parked if not auto-safe. |
| **Provider/AI/tool evidence** | Nuitée `hotel.search` REPLAY for Concorde/midscale SIN; funding anchors from FUNDED_WINDOW. |
| **Deterministic viability** | Extension viable; covered baseline = MIN(eligible booked stay, allowance); incremental nights traveller-funded. |
| **Authority/decision** | Within traveller/self-funded authority → **auto-resolve** (no organiser approval for personal incremental nights). |
| **Surfaces** | Traveller chat + trip; organiser may observe activity without blocking. |
| **Action/observation** | Hotel modify/extend through provider boundary where permitted; observe. |
| **Final state** | Stay through Sunday; funding split recorded; trip viable. |

## S6 — "Can I switch hotels? My partner is joining."

- **Trigger:** traveller-requested change
- **Stage:** post-booking
- **Priority:** High-priority Stretch
- **MVP boundary:** May be simulated/catalogued; not required to be fully
  executable for G3R
- **Provenance:** SIMULATED material is acceptable for MVP/G3R demo
  representation and must be disclosed as such.

The traveller wants to change hotel and potentially extend the stay because
their partner is joining.

Potential reasoning includes:

- current cancellation terms;
- replacement hotel rates;
- accommodation policy ceilings;
- second-occupant or room-upgrade costs;
- event versus personal nights;
- venue travel time;
- morning event buffers;
- transfer changes.

**Capability target:**

- accommodation modification;
- cancellation rules;
- personal/business cost attribution;
- local routing;
- event viability.

Do not add companion/occupancy/multi-payer ontology solely to make this
scenario executable during MVP closure.

## S7 — "I'm actually flying from Tokyo, not London."

- **Trigger:** traveller-requested change
- **Stage:** pre-booking or partially booked
- **Priority:** Tier A — MVP executable
- **Demo role:** Structural trip-change hero / breadth proof
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

Keep Tokyo-origin traveller request. Current HND/NRT→SIN Atlas evidence is acceptable; no need to redesign purely for novelty.

The original trip assumes the traveller will depart from London.

The traveller later says they will already be in Tokyo and asks to travel to
Singapore from there.

This changes the topology of the trip rather than merely modifying a flight.

Northstar must reason about:

- obsolete London-origin sectors;
- cancellation/change/refund rules where relevant;
- Tokyo-origin alternatives;
- organisation reimbursement/policy;
- hotel dates;
- transfer assumptions;
- event arrival objective;
- baggage;
- return destination.

Northstar should explicitly surface material uncertainty where required.

For example, if the return destination is no longer clear, the system should
ask/escalate rather than invent the answer.

**Capability proof:**

- structural trip mutation;
- cancellation/change reasoning;
- uncertainty handling;
- policy-aware replanning.

**Core message:** This is not "change flight." The shape of the trip has
changed.

### Final-demo choreography (S7)

Cast: Oliver Bennett (`ait-draft-38`) only — content SSOT §5. **Pre-booking**
(or not-yet-ticketed) lifecycle.

| Stage | What happens |
|-------|----------------|
| **Initial state** | Proposed/held trip assumes **LHR→SIN** (+ return LHR). Distribution debate Day 1 afternoon. |
| **Trigger** | Traveller: already in Tokyo; fly **HND/NRT→SIN** instead. Return intent remains LHR. |
| **Successive state changes** | London-origin sectors become obsolete; Tokyo-origin alternatives required; hotel/transfer assumptions rechecked. |
| **Provider/AI/tool evidence** | Atlas HND→SIN REPLAY (e.g. Scoot TR883); FX home-currency path; fare/change rules. |
| **Deterministic viability** | Tokyo-origin plan can meet debate buffer; uncertainty surfaced if return destination were unclear (here return LHR is explicit). |
| **Authority/decision** | Structural `flight.change` → **HUMAN_AGENT / organiser approval**. |
| **Surfaces** | Traveller request + organiser approval. |
| **Action/observation** | On approval, permitted search/change; observe. |
| **Final state** | Trip topology is Tokyo-origin inbound with LHR return intent preserved. |

## S8 — "Can I travel with the other speakers?"

- **Trigger:** traveller-requested change
- **Stage:** pre-booking or post-booking
- **Priority:** High-priority Stretch
- **MVP boundary:** May be simulated/catalogued; not required to be fully
  executable for G3R
- **Provenance:** SIMULATED material is acceptable for MVP/G3R demo
  representation and must be disclosed as such.

The traveller asks to join other speakers on the same transport service.

Potential reasoning includes:

- traveller identity/group matching;
- itinerary alignment;
- inventory;
- fare difference;
- arrival viability;
- policy;
- baggage/seating;
- programme-level concentration/correlated disruption risk.

**Capability target:**

- cross-traveller reasoning;
- shared programme context;
- correlated-risk constraints.

Do not claim correlated-risk policy enforcement unless the generic constraint
model genuinely supports it.

Do not introduce scenario-specific risk logic for MVP.

---

## Cross-scenario coverage

The catalogue collectively covers:

- supplier-originated change;
- traveller-reported disruption;
- organiser-originated change;
- traveller-requested change;
- pre-booking;
- post-booking;
- during travel;
- individual trip reasoning;
- multi-traveller reasoning;
- transport modification;
- accommodation modification;
- trip-topology modification;
- business/personal cost boundaries;
- event dependencies;
- policy;
- authority/approval;
- deterministic viability;
- provider recovery validation;
- counterfactual preview;
- uncertainty;
- execution and observation.

**Not all of this is executable in MVP.** The combined coverage list above is a
catalogue property, not an MVP capability claim. Current executable coverage is
limited to what the Tier A scenarios (S1, S2, S3, S4, S7) and the existing
generalized engine genuinely support today; items exercised only by Stretch
scenarios (S5, S6, S8) — such as business/personal cost boundaries, programme-
level correlated-risk reasoning and multi-element accommodation modification —
are Stretch capability targets, not implemented MVP behavior. Do not claim
Tier-B/C behavior as implemented when it is not.

## Anti-hardcoding rule

Scenario IDs such as S1, S2, etc. are catalogue/data identifiers only.

Generic application/domain logic must never branch on:

- scenario ID;
- scenario name;
- traveller name;
- event name;
- specific city;
- specific airport;
- supplier;
- route;
- fixture-specific count.

Scenario-specific facts belong in fixtures/configuration/source data.

If the ontology cannot represent a required scenario concept generically,
record an architecture/product gap rather than hardcoding a demo workaround.

Exact illustrative outcome counts are not acceptance invariants unless
executable fixture data is deliberately authored to produce them.

## Provenance

Provenance labels are defined in `docs/DEMO.md` and preserved here unchanged:

- **LIVE** — real provider/model call;
- **SANDBOX** — provider test environment;
- **RECORD** — captured live/sandbox interaction;
- **REPLAY** — recorded responses through the same normalizer/engine;
- **SIMULATED** — external-boundary effect with no real provider — disclosed,
  core engine stays real.

Tier-A execution is expected primarily through REPLAY for reliable demo
operation, backed by existing LIVE/SANDBOX integration evidence where
applicable. Do not imply that a simulated external trigger/action is LIVE.
High-Priority Stretch scenarios may be represented with clearly disclosed
SIMULATED material for MVP/G3R.

## Demo hierarchy

**Final video order (active):** **S2 → S1 → S3 → S7 → S5**.

| Beat | Role |
|------|------|
| S2 | Traveller progressive missed-connection / overnight recovery hero |
| S1 | Organiser multi-traveller schedule-change blast radius |
| S3 | Continues S1 — programme counterfactual + commit |
| S7 | Pre-booking Tokyo-origin structural change |
| S5 | Post-booking personal Sunday hotel extension |

**Repository / fallback (not primary video):** S4, S6, S8, and S6-class breadth.

World cast, timings, and hotels: `docs/FINAL_DEMO_CONTENT_SSOT.md`.

---

## Status / Next Work

- Final demo content SSOT authored; programme fixture reconciliation in progress
  on `content/final-demo-world`.
- Execute end-to-end S2 → S1 → S3 → S7 → S5 against reconciled fixtures.
- UI integrator consumes clickable Tier A cast + real hotel labels from content
  SSOT.

Do not create a new formal milestone.
Do not reopen architecture.
