# Northstar Scenario Catalogue (Frozen)
> **Post-R4 founder supersession, 2026-09-20:** The active hackathon target is two rich
> desktop heroes, Sarah/S1 and Jordan/S2, under [the hero-depth contract](work/ASTRA_HERO_DEPTH_SCOPE.md).
> The eight-scenario catalogue below remains reference scope; earlier five-scenario video
> order and flight-only/context-only Jordan acceptance do not govern this convergence.
> Jordan requires live multi-domain research/planning, Narita overnight and authoritative
> entry feasibility, material Singapore stay/transfer/finals/insurance consequences, and
> real supported sandbox actions selected by the recovery. Nuitée has no modify operation:
> any required stay change is explicit cancel + rebook with separate observed outcomes.
> Historical provider proof is reusable; current PostgreSQL composition and fresh LIVE
> acceptance remain required. No broader parity or mobile work is implied.

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

- `data/ait-demo-input-pack/` — **final-demo world content** (event identity,
  venues, programme timings, population, hero cast, baseline flights/hotels,
  scenario↔person mapping) committed as JSON. This catalogue owns *what happens
  over time*; the input pack owns *who/where/when* of the synthetic world.
  Do not duplicate stable cast/venue facts here — reference the input pack.
- Demo principles and provenance label definitions are recorded in this
  catalogue's **Provenance** section; the runtime demo path and its repository
  fallbacks appear with the scenario table below.
- Cases A/B/C remain frozen **engine acceptance cases** (historical proof
  paths); they are not the current final scenario source of truth.
- `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md` — current generalized planning/evidence/B1-B2 behavioural contract; scenario choreography cannot override it.
- `docs/ROADMAP.md` — capability scope/status, including the MVP vs
  High-Priority Stretch recording of this catalogue.
- The earlier S1–S4 scenario families from superseded demo-readiness planning
  are replaced by this catalogue for scenario naming and intent. Final-video
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

All eight scenarios are intended to become runnable through the same
generalized Northstar application path. The final hero set is **S2, S1, S3,
S7, S5**; S5 is now proven executable for its **hotel-only personal extension**
path, while S6/S8 remain breadth/stretch. The only approved simulated external
seams are recorded in `docs/CAPABILITIES_AND_LIMITATIONS.md`; an internal
capability gap is not a simulation seam.

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

Northstar evaluates recovery possibilities across relevant domains rather than jumping
straight to a programme change. The generalized planning coordinator may investigate:

- transport alternatives and provider reprotection quality;
- connections and arrival buffers;
- hotel/transfer consequences where applicable;
- event commitments and programme-side alternatives;
- fare/change rules;
- policy, preferences and authority context.

Which domains are investigated and in what order must emerge from current state,
dependencies, evidence gaps and registered capabilities — never from an S1/Sarah branch.

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

Stable cast, flights, and slots: `data/ait-demo-input-pack/` (`global/` plus
`scenarios/s1-supplier-disruption/`; Sarah Lim critical; Wanderpay cohort;
CGK→SIN).

| Stage | What happens |
|-------|----------------|
| **Initial state** | Post-booking. Five CGK→SIN speakers share synthetic Batik ID7159 (30 Sep 17:45→20:30). Sarah’s hard commitment is Day-1 headline **11:30**. The 150-minute buffer is initially clear. |
| **Trigger** | Simulated airline schedule change / retime enters via the real flight-event ingress (`SIMULATED SOURCE EVENT` disclosed — not LIVE). |
| **Successive state changes** | Synthetic ID7159 is cancelled; all five tickets are involuntarily reprotected to synthetic ID7153 (1 Oct 07:45→10:30). Blast radius fans out per traveller. |
| **Provider/AI/tool evidence** | The provider reprotection remains truthfully sourced from the scenario input. Once Sarah still fails whole-trip assessment, the generalized coordinator gathers provider-neutral read-only travel evidence (LIVE/RECORD/REPLAY provenance stated truthfully) for materially relevant alternatives; no consequential provider action occurs in B1. |
| **Deterministic viability** | Felix’s later REQUIRED slot remains viable while Sarah’s 11:30 slot fails. Travel alternatives are evaluated through RC-6; material rejected/inferior travel-only alternatives remain explainable. Programme candidates are generated only when current evidence/dependencies make PROGRAMME applicable. |
| **Comparison/decision** | Only deterministically VIABLE strategies enter comparison. NORTHSTAR records a structured recommendation/trade-offs; organiser approval remains required for programme mutation. |
| **Surfaces** | Organiser Case shows investigated domains/evidence, rejected and viable material alternatives, recommendation, immediate proposed-change blast radius, broader reassessment closure and outcome delta; traveller surface shows current trip truth. |
| **Action/observation** | If the recommended B1 strategy is programme-side, approval executes through the existing internal ActionPlan/authority path, observes the canonical programme update and reassesses. No money-moving provider action occurs. |
| **Final state** | S1→S3 is one continuous RecoveryCase lifecycle. B1 closes only after Sarah is current PASS and the case resolution gate succeeds; unrelated FAIL/UNKNOWN remains truthful. |

## S2 — Traveller misses a connection; airline recovery is not good enough

> **Current S2 convergence boundary (2026-09-20):** The older flight-only/context-only Jordan closure below is superseded for A3/A4 by `docs/work/ASTRA_HERO_DEPTH_SCOPE.md`. Jordan's candidate world must compose replacement flight + Narita overnight + scoped authoritative entry evidence + required Singapore stay replacement/cancellation consequence + finals viability + FX. A4 executes the selected flight, Narita booking, Singapore replacement booking, then cancellation of the displaced Singapore booking after replacement confirmation. Transfer and insurance remain reasoning/context only. No Jordan-specific application branch.
>

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

The **product-level** recovery problem includes:
- replacement NRT→SIN flight
- transit hotel
- authoritative Japanese entry/immigration requirements for overnight landside stay
- traveller insurance missed-connection / emergency accommodation coverage where supplied
- Singapore hotel/stay consequences
- ground transfer
- event commitments

**Current final hero execution boundary:** A3 must produce one complete, physically visible
composite recommendation through the normal PostgreSQL runtime. The candidate world includes
replacement flight, Narita overnight stay, scoped authoritative Japan entry evidence, the
required Singapore stay replacement/cancellation consequence, Frankfurter/home-currency cost
comparison and finals viability. Transfer and insurance remain bounded reasoning/evidence only.

**Required A4 execution:** the selected protected ActionPlan executes four supported sandbox
actions: replacement flight, Narita hotel booking, Singapore replacement hotel booking, and
cancellation of the displaced Singapore booking. Because Nuitée does not support the required
date change as an in-place modification, the generic operation is replacement booking plus
cancellation; replacement confirmation must precede cancellation. Each action requires durable
attempt state, observation/reconciliation, canonical update and whole-trip reassessment.

**Product capability (reasoning):** whole-trip analysis across flight, overnight requirement,
entry/transit findings, insurance applicability, Singapore stay consequence, finals margin,
provider costs and home-currency comparison.

Pre-emptive connection failure: schedule-delay retimes may mark an onward leg
non-viable through generic CONNECTS_TO / connection-buffer assessment **before**
an explicit missed-flight POST; the traveller report may reconcile an already-open
condition rather than creating it.

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

**Capability proof (closed hero):**

- conversational/state ingestion;
- partially executed trips;
- provider-state reconciliation;
- downstream invalidation;
- progressive delay / connection-loss propagation;
- next-morning flight recovery search;
- deterministic event viability;
- organiser authority;
- execution + observation;
- resolved/viable final trip state.

**Current closed-hero claim:** the proposed Narita STAY and scoped Japanese entry evidence are
part of the evaluated composite world. Insurance remains contextual reasoning only; no claim
submission is executed.

**Core message:** Northstar reasons about whether what actually happened still
leaves the trip viable.

### Final-demo choreography (S2) — progressive delay stages

Stable cast and programme: Jordan Hale (`ait-draft-09`); hard finals showcase
**30 Sep 20:45–21:05**; baseline ZG023/ZG053 — see content SSOT §5.

| Stage id | What happens | Viability intent |
|----------|--------------|------------------|
| **initial_state** | In travel. LAX→NRT→SIN confirmed (PNR ZGSYN09). Connection 2h40m. SIN Concorde stay booked. Finals showcase next evening. | Baseline **VIABLE** |
| **trigger / delay_1** | Simulated Atlas schedule/delay notification on ZG023 — delay begins; connection still comfortable. | Still **VIABLE** |
| **delay_2_tight** | Further delay; NRT connection becomes tight but still theoretically makeable. | **VIABLE_TIGHT** / watch |
| **zg053_impossible** | Upstream delay makes ZG053 impossible; missed-connection signal; airline may still suggest same-night options. | Onward leg **failed**; recovery search opens |
| **same_night_temp** | Scoot **TR875** (NRT→SIN evening → arrive SIN ~05:20) still feasible for the evening showcase under 150. Jordan is not bound to the morning lab. | Same-night recovery **temporarily VIABLE** |
| **same_night_killed** | Further delay / misconnect eliminates last sensible same-night option. Overnight near Narita is required as known trip context. | Same-night **NOT_VIABLE** |
| **overnight_context** | Narita hotel options and landside-entry needs are composed into the candidate world; scoped authoritative entry evidence must support the overnight. Insurance remains context/evidence only. | Required composite dependency; no broad immigration/claims platform |
| **airline_morning** | Airline-default inventory includes Scoot **TR867** (~12:30→20:45); Northstar also sees TR885 (~08:20→14:35). | TR867 fails the 20:45 finals buffer; TR885 clears it under 150 |
| **northstar_morning** | Northstar ranks boardable next-morning flight inventory; TR885 or a current equivalent may be the transport component, but it is viable only as part of the complete flight + Narita stay + entry + Singapore-stay + finals candidate. | Complete composite must be **VIABLE** |
| **authority / surfaces** | Organiser Case exposes the complete composite recommendation, rejected alternatives, provider/FX provenance, uncertainty, costs and the four selected external actions. | **Organiser approval required** |
| **action / observation** | Organiser approves the selected plan; execute replacement flight, Narita booking, Singapore replacement booking, then displaced Singapore stay cancellation through protected provider paths; observe/reconcile each and update canonical state. | |
| **final_state** | Northstar candidate arrives SIN 14:35; 370-minute gap clears the 150-minute policy buffer; case **RESOLVED**, trip **VIABLE**. | **RESOLVED / VIABLE** |

Do **not** treat VietJet VJ823 as a direct NRT→SIN 12:55 hero option (recordings show NRT→SGN connections).

## S3 — Headline speaker needs to leave earlier; organiser previews consequences

- **Trigger:** organiser event-side change
- **Stage:** post-booking
- **Priority:** Tier A — MVP executable
- **Demo role:** Architectural / enterprise hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

**S1 → S3 Continuity:** S3 continues directly from S1 without reset and is the programme
domain of the same generalized planning lifecycle, not a second engine/stage hardcoded
after flight recovery.

Northstar may PROPOSE programme/non-travel recovery options but cannot autonomously mutate
the programme.

B1 acceptance requires:
- existing provider reprotection still fails Sarah's current whole-trip assessment;
- the coordinator identifies relevant domains/evidence gaps from current state;
- materially relevant travel alternatives are researched/evaluated first **only when the
  evidence gap requires that work** — there is no globally fixed travel-first order;
- material rejected/inferior travel-only alternatives remain explainable;
- programme candidates are generated and RC-6 evaluated;
- immediate programme-change blast radius, reassessment closure and outcome delta are
  separate;
- viable strategies are compared and a preferred strategy is recommended/explained;
- organiser previews/approves the exact selected change;
- programme state updates through the normal internal ActionPlan/authority/execution path;
- observation and reassessment establish Sarah PASS before the case resolves.

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
| **Initial state** | Continues from S1: Sarah **NOT_VIABLE** against the 11:30 headline after synthetic ID7153 arrival at 10:30. |
| **Trigger** | Organiser considers programme-side resolution (availability / slot move), not a new travel purchase. |
| **Successive state changes** | Counterfactual preview only — zero authoritative mutation until commit. |
| **Provider/AI/tool evidence** | Programme graph + trip constraints; optional travel alternatives remain visible but secondary. |
| **Deterministic viability (preview)** | Bilateral option set moves Sarah’s headline → **14:30–15:00** and Daniel’s local-host session → **11:30–12:00**. Sarah clears 150; preview lists Elena and Daniel in the blast radius. |
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
- **Priority:** Final hero — executable hotel-only extension path
- **Demo role:** Personal-extension / mixed-funding / traveller-authority hero
- **Provenance:** Nuitée **REPLAY** through the real hotel normalization/execution path; any unsupported provider boundary remains honestly labelled.

**Post-booking personal extension.**

Funding rule:
covered baseline = LOWER OF:
- eligible value of the already-booked event hotel/stay
- applicable organisation/event hotel allowance

Anything incremental due to the traveller's personal extension is traveller-funded.

**Closed final-demo scope:**
- hotel/stay extension only;
- deterministic funding split;
- traveller-funded increment;
- **no organiser approval**;
- authority result is `REQUIRES_TRAVELLER`;
- traveller approves their own self-funded increment;
- only then does Northstar execute → observe → resolve.

A combined automatic hotel + return-flight change is **not** part of the closed
S5 hero and remains parked.

The conference ends Friday and the traveller wants to extend the trip
personally.

Potential reasoning includes:

- return-flight rules;
- business-equivalent airfare;
- extra hotel nights;
- event-funded versus personal expenses;
- airport-transfer coverage;
- downstream commitments.

**Capability proof (closed hero):**

- accommodation date replanning;
- provider-backed hotel search/replacement/extension;
- business/personal cost attribution;
- deterministic funding calculation;
- traveller authority/approval;
- execution + observation;
- resolved/viable final trip.

Do not claim sophisticated multi-payer/cost-splitting execution beyond the
generic mixed-funding semantics genuinely implemented.

### Final-demo choreography (S5)

Cast/slot/hotel: Jonas Berg (`ait-draft-35`); fireside **14:30–14:50** Day 1;
Concorde `lp21d9f` — content SSOT §5.

| Stage | What happens |
|-------|----------------|
| **Initial state** | Post-booking. Event-funded hotel through **3 Oct 11:00**. Fireside commitment already satisfied by baseline stay. |
| **Trigger** | Traveller NL request: stay until Sunday (checkout **4 Oct**). |
| **Successive state changes** | Stay extension candidate; return-flight change remains parked unless separately proven safe. |
| **Provider/AI/tool evidence** | Nuitée `hotel.search` REPLAY for Concorde/SIN; generic hotel G1/G2; funding anchors from FUNDED_WINDOW. |
| **Deterministic viability** | Extension viable; covered baseline = MIN(eligible booked stay, allowance); incremental nights traveller-funded. |
| **Authority/decision** | `REQUIRES_TRAVELLER`: Jonas approves his own self-funded increment. **No organiser approval** is required. |
| **Surfaces** | Traveller chat + trip; organiser may observe activity without blocking. |
| **Action/observation** | After traveller approval, hotel extension executes through the provider boundary; observe; state updates. |
| **Final state** | Case **RESOLVED**; stay through Sunday; funding split recorded; trip **VIABLE**. |

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

**Not all catalogue breadth is executable in MVP.** Current proven final-hero
coverage is S2, S1→S3, S7, and the **hotel-only** S5 extension path described
above. S6/S8 and any broader combined-multi-element variants remain Stretch.
Do not claim behaviour outside those proven boundaries as implemented.

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

Provenance labels, carried forward unchanged from earlier demo planning, are
defined here:

- **LIVE** — real provider/model call;
- **SANDBOX** — provider test environment;
- **RECORD** — captured live/sandbox interaction;
- **REPLAY** — recorded responses through the same normalizer/engine;
- **SIMULATED** — external-boundary effect with no real provider — disclosed,
  core engine stays real.

Final hero execution is expected primarily through REPLAY for reliable demo
operation, backed by existing LIVE/SANDBOX integration evidence where
applicable. Do not imply that a simulated external trigger/action is LIVE.
Stretch scenarios may be represented with clearly disclosed SIMULATED material
where appropriate.

## Demo hierarchy

**Final video order (active):** **S2 → S1 → S3 → S7 → S5**.

| Beat | Role |
|------|------|
| S2 | Traveller progressive missed-connection / next-morning flight recovery hero |
| S1 | Organiser multi-traveller schedule-change blast radius |
| S3 | Continues S1 — programme counterfactual + commit |
| S7 | Pre-booking Tokyo-origin structural change |
| S5 | Post-booking personal Sunday hotel extension + traveller self-funded approval |

**Repository / fallback (not primary video):** S4, S6, S8, and S6-class breadth.

World cast, timings, and hotels: `data/ait-demo-input-pack/`.

---

## Status / Next Work

- Final demo content SSOT and programme fixture are reconciled on
  `content/final-demo-world`; S2/S5 demo claims are aligned to proven backend
  boundaries.
- Integrate content + final backend + approved UI.
- Execute browser rehearsal in exact order: S2 → reset → S1 → S3 without reset
  → reset → S7 → reset → S5.
- UI integrator consumes clickable Tier A cast + real hotel labels from content
  SSOT and must not fabricate unavailable read-model evidence.

Do not create a new formal milestone.
Do not reopen architecture.
