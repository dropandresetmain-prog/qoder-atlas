# Demo Requirements

This defines what product must demonstrate, not final video script.

**Scenario source of truth.** Scenario business narratives, capability claims,
implementation priority and demo intent are frozen in `docs/SCENARIOS.md`
(the 8-scenario Northstar catalogue, S1–S8). This document keeps demo
principles, provenance definitions, runtime demo path and historical/backup
paths; it is not the scenario catalogue.

## Core story

A replacement flight is not necessarily a recovered trip. The system maintains viability of the whole trip rather than returning a chatbot answer or list of alternatives.

## Northstar framing (primary, RV-N0 freeze)

Northstar — the AI resolution layer for event travel. The primary demo narrative is one event-travel programme (roughly 40–45 inbound travellers) run end to end through the real engine:

1. **Programme scale.** Operator view over the whole programme: per-status rollups, shared commitments, per-traveller importance — not 40 separate single-trip widgets.
2. **Initialisation.** Intake drafts (manual/bulk/LLM-assisted) are promoted through the validated path; trips start empty (zero elements, UNKNOWN viability) and initial planning builds them through the same engine that later handles disruptions.
3. **Current scenario set — see `docs/SCENARIOS.md`.** The frozen 8-scenario catalogue (S1–S8) defines the demo case selection: Tier A MVP-executable scenarios (S1 airline schedule change; S2 missed connection; S3 event-side preview; S4 Thursday-morning arrival; S7 London → Tokyo origin change) plus High-Priority Stretch scenarios (S5, S6, S8). The historical Case A/B/C wording below this list is retained as engine proof-path history only and is superseded by `docs/SCENARIOS.md` as the current scenario source of truth:
   - *(historical)* Case A — traveller change: declarative target → funding allocation → authority → execution → observed state; no booked state mutates until authorised.
   - *(historical)* Case B — hero recovery: provider disruption endangering a shared commitment; blast radius across Engagement-linked trips, deterministic viability, authority + execution, resolution judged by observed state.
   - *(historical)* Case C — event-side change: one `ANCHOR_COMMITMENT_CHANGE` signal fanning out to every linked traveller with differentiated handling by per-traveller importance.
4. **Recovered programme.** The programme read model returns to a consistent resolved state with every per-traveller case closed and the audit trail intact.

Case A/B/C semantics remain frozen in `PRODUCT_SPEC.md` ("Frozen acceptance Cases A/B/C") as historical engine acceptance cases; they are not the current final scenario source of truth (that is `docs/SCENARIOS.md`). Demo data is fixture content only.

**Provenance labels.** Every demo segment discloses its boundary exactly, using these labels: **LIVE** (real provider/model call), **SANDBOX** (provider test environment), **RECORD** (captured live/sandbox interaction), **REPLAY** (recorded responses through the same normalizer/engine), **SIMULATED** (external-boundary effect with no real provider — disclosed, core engine stays real). REPLAY is the default for routine runs; LIVE/SANDBOX only where budgeted and claimed.

The Checkpoint C single-traveller scenario shape below remains valid as the engine's historical proof path and backup narrative; the Northstar framing supersedes it as the primary story.

## Primary scenario shape

An organiser manages multiple invited travellers around an AnchorEvent. One traveller's trip becomes disrupted. Exact event/traveller/location remain input data, not application logic.

Expected visible flow:
1. Operator sees readiness across managed travellers.
2. TripSignal changes one traveller to disrupted/needs attention.
3. Product explains in user language what changed and what else is affected.
4. Blast radius includes relevant downstream items such as transfer, hotel timing, optional engagement and critical objective.
5. Recovery planner queries configured capabilities, including Atlas and dynamic local context where available.
6. Multiple whole-trip strategies are evaluated.
7. A superficially attractive option is rejected if it breaks a hard downstream objective.
8. Traveller can explicitly reprioritize/waive a soft objective while protecting a critical one.
9. Authority engine decides whether system can act or needs traveller/organisation/human approval.
10. Supported action executes through real adapter or clearly simulated provider boundary.
11. Result is observed and authoritative trip state changes.
12. Operator/traveller views visibly return to resolved/ready state.

## What judges should infer quickly
- graph/state represents operational dependencies
- product is not merely flight rebooking
- AI handles interpretation/planning rather than unsafe arithmetic/permissions
- deterministic checks validate recovery
- authority gates consequential actions
- state persists and updates after observation
- same engine supports event-organiser and TMC/corporate cases

## User-facing language
Avoid terms such as graph node, TripSignal, dependency propagation, RecoveryStrategy object and deterministic evaluator.

Prefer language such as:
- “Your trip needs attention.”
- “Your flight changed and your airport transfer no longer works.”
- “Your hotel is still okay.”
- “You can still make tomorrow's keynote.”
- “I need your approval because this option costs more than your travel policy allows.”

## Internal/developer visibility
A compact debug/demo visualization may expose dependency chain to make innovation legible. It is secondary to user-facing experience.

## LIVE / REPLAY / simulated boundaries
Final demo may use recorded/replayed API/model responses for reliability/cost provided corresponding LIVE integration has been tested where claimed, replay uses same normalizer/engine, simulated external actions are disclosed accurately, and core graph/propagation/planning/viability/authority/state update remain real.

## Backup scenario
Maintain a materially different TMC/corporate scenario through same engine for robustness and backup demo path.

## Current runtime demo path (Checkpoint C candidate)

The demo flow runs through the generic runtime API — no manual database surgery, no optional credentials, every stage carries an explicit instant:

```
POST /api/runtime/disruption   # TripSignal in -> case opened, impact reported
POST /api/runtime/plan         # capability-backed strategies + rejected candidates
POST /api/runtime/begin        # chosen strategy -> ActionIntent + authority outcome
POST /api/runtime/decide       # recorded APPROVED/DECLINED by the right principal
POST /api/runtime/execute      # approved execution -> observation -> verification
POST /api/runtime/reset        # audited wipe + reseed to the known starting state
GET  /api/runtime/state        # trips + open cases projection
```

All six stages go through the same application code the tests use (`src/app/compose.ts`); REPLAY recordings feed the real normalizer/engine, and provider order effects at the execution boundary are disclosed as simulated.

### Credential-free planner honesty (what the fallback planner does and does not do)

Without Model Studio credentials the runtime uses the deterministic fallback planner, and its limits are part of the honest demo story:

- It handles only disruptions whose impact assessment contains a directly-failed FLIGHT leg. A pure FLIGHT_DELAY (no cancellation, no failed leg) therefore produces zero strategies with an explicit HIGH uncertainty ("fallback planner failed closed; no strategies fabricated") — the delay-recovery case (G2-1) is exercised in tests with the scripted planner, not by the fallback planner.
- It never authors waivers or reprioritisations: it only enumerates one replacement strategy per normalized flight.search offer, with CONNECTED facts. Feasibility, rejection and ranking belong to the deterministic viability engine; waivers enter only through explicit traveller/planner evidence.
- Scenario B (corporate-tmc) credential-free: the disruption cancels the return leg and every replayed next-day replacement arrives after the 08:30 steering meeting plus buffer, so `c_b_return_buffer` stays unresolvable and planning honestly reports `bestStrategyId = undefined` — no fabricated waiver closes the case. The full RECOVERED_WITH_LOSS loop for Scenario B is proven in tests (G1) with a planner that carries the traveller's explicit steering evidence and a waiver.
- REV-C-FIX (WP-C2) effect on the delay case: candidate facts now enter planning at CONNECTED authority (honest provider evidence, never planner-claimed AUTHORITATIVE), are evaluated against the AUTHORITATIVE delay fact without rejection, and receive the CONNECTED → AUTHORITATIVE upgrade only at execution observation via `confirmedData()`.

## Demo readiness checklist
- deterministic reset to known starting state
- no manual database/state surgery
- no dependency on optional credentials for replay path
- obvious disrupted -> recovering -> resolved transition
- traveller decision/approval interaction works
- one rejected candidate demonstrates downstream viability
- audit/history exists
- README states which integrations are live-tested, replayed or simulated
