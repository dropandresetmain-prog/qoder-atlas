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

- `docs/DEMO.md` — demo principles, provenance label definitions, runtime demo
  path and backup paths. Scenario definitions point here.
- `docs/PRODUCT_SPEC.md` — product model and requirements. Cases A/B/C remain
  frozen **engine acceptance cases** (historical proof paths); they are not the
  current final scenario source of truth.
- `docs/ROADMAP.md` — capability scope/status, including the MVP vs
  High-Priority Stretch recording of this catalogue.
- `docs/WAVE3R_DEMO_READINESS_PLAN.md` — its historical S1–S4 scenario families
  are superseded by this catalogue for scenario naming and intent.

## Tiering summary

### Tier A — MVP executable

| ID | Scenario |
|----|----------|
| S1 | Airline schedule change affects several speakers; one becomes critical |
| S2 | Traveller misses a connection; airline recovery is not good enough |
| S3 | Headline speaker needs to leave earlier; organiser previews consequences |
| S4 | "Can I arrive Thursday morning instead?" |
| S7 | "I'm actually flying from Tokyo, not London." |

These are intended to run through natural Northstar product/application
boundaries and the same generalized state/recovery/authority engine.

### High-Priority Stretch

| ID | Scenario |
|----|----------|
| S5 | "Can I stay until Sunday?" |
| S6 | "Can I switch hotels? My partner is joining." |
| S8 | "Can I travel with the other speakers?" |

These remain important product scenarios. For MVP/G3R they may be represented
using clearly disclosed SIMULATED scenario material where needed. They should
be revisited after the generalized Tier-A vertical loop and code-freeze
blockers are secure.

---

## S1 — Airline schedule change affects several speakers; one becomes critical

- **Trigger:** supplier/provider event
- **Stage:** post-booking, before travel
- **Priority:** Tier A — MVP executable
- **Demo role:** Main organiser hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable. A simulated external
  trigger is never presented as LIVE.

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

## S2 — Traveller misses a connection; airline recovery is not good enough

- **Trigger:** traveller-state report
- **Stage:** during travel
- **Priority:** Tier A — MVP executable
- **Demo role:** Traveller disruption hero / supporting hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

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

## S3 — Headline speaker needs to leave earlier; organiser previews consequences

- **Trigger:** organiser event-side change
- **Stage:** post-booking
- **Priority:** Tier A — MVP executable
- **Demo role:** Architectural / enterprise hero
- **Provenance:** REPLAY expected for routine demo runs, backed by existing
  LIVE/SANDBOX integration evidence where applicable.

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

The following is a **planning decision, not a permanently frozen video
script**.

**Primary heroes**

- S1 — airline disruption across several speakers
- S3 — event-side preview / programme consequences

**Strong breadth / possible third hero**

- S7 — origin change from London to Tokyo

**Supporting executable proof**

- S2 — missed connection
- S4 — Thursday-morning arrival request

**Stretch breadth**

- S5
- S6
- S8

Final video ordering and screen time are decided after G3R acceptance.
