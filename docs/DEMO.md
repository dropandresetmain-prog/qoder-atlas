# Demo Requirements

This defines what product must demonstrate, not final video script.

## Core story

A replacement flight is not necessarily a recovered trip. The system maintains viability of the whole trip rather than returning a chatbot answer or list of alternatives.

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

## Demo readiness checklist
- deterministic reset to known starting state
- no manual database/state surgery
- no dependency on optional credentials for replay path
- obvious disrupted -> recovering -> resolved transition
- traveller decision/approval interaction works
- one rejected candidate demonstrates downstream viability
- audit/history exists
- README states which integrations are live-tested, replayed or simulated
