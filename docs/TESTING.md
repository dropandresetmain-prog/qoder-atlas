# Testing Strategy

## Purpose
Tests must prove the application is a generalized trip-resolution engine rather than a scripted demo.

## Layers

### 1. Domain/schema tests
Validate entity/operational schemas, invalid enum/type rejection, relationship/constraint reference integrity, authority/ownership rules, explicit vs latent preference precedence, and uncertainty/provenance representation.

### 2. Deterministic evaluator tests
Cover timezone normalization, time-window arithmetic, duration/buffer envelopes, hotel/check-in cutoffs, transfer/connectivity constraints, flexible required TransportLeg fulfilment, accessibility constraints, policy/spend thresholds, PASS/FAIL/UNKNOWN distinction, and irreversible loss without engine termination.

### 3. Graph mutation/propagation tests
A changed fact should mutate only after validation, reevaluate directly referenced constraints, propagate through relevant dependencies, produce an ImpactAssessment, avoid automatically marking every downstream element invalid, and preserve audit/history.

### 4. Scenario overlay tests
Candidate recovery changes must not mutate authoritative state; must produce deterministic viability; hard-constraint failures reject scenarios; soft tradeoffs remain available for ranking; authoritative state changes only after observed execution success.

### 5. Authority tests
Given identical ActionIntent + policy/context, result is deterministic. Cover auto-approved, traveller approval, organisation approval, human escalation and blocked outcomes.

### 6. AI contract tests
Use cheap Model Studio model or saved outputs for plumbing. Validate schema-constrained extraction, malformed output rejection, uncertainty surfaced rather than guessed, explicit instruction overriding latent preference, planner structured strategies/tool needs, and inability to bypass authority/execution gates.

### 7. Adapter contract tests
For each adapter test normalization, structured errors, no secret leakage, LIVE/REPLAY equivalence where supported, and provider failure without RecoveryCase crash.

Atlas minimum: Search, Verify, fare/rule normalization.
Google Routes: route normalization + missing-credential/failure fallback.

### 8. Persistence tests
- Trip/Case survive restart
- audit/source history persists
- version/state transitions are retained
- fixture/reset process creates deterministic demo state

## Generalisation / anti-hardcoding gate

At least two materially different scenarios pass through same application code:

### Scenario A — AnchorEvent speaker
Event obligations, organiser policy, traveller interaction, disrupted flight, downstream transfer/hotel/event objectives.

### Scenario B — TMC/corporate traveller
Employer policy, spend threshold, corporate objective, TMC/operator role, different routing/supplier context.

Changing scenarios may change only source documents/pages, fixture/config data, traveller/organisation/event/policy values and provider responses. It must not require source-code edits.

Perform code search for fixture/event/traveller/city names in domain/recovery logic. Supplier names are allowed only in concrete adapters.

## Robustness scenarios
- late-night arrival vs hotel reception/no-show rule
- public transport unavailable; flexible taxi/private transfer remains viable
- flight -> separately booked rail/ferry connection
- visa/entry/immigration buffer invalidates nominal connection
- accessibility invalidates cheaper recovery
- shared transfer/resource affects another traveller
- trip objective already lost; remainder recoverable
- stale imported hotel data produces UNKNOWN/reverification rather than false PASS

## Pre-milestone checklist
- relevant tests pass
- build/typecheck/lint pass where configured
- failure/fallback paths tested
- no scenario-specific domain branch added
- roadmap/docs updated for scope/status changes
- issues classified Act Now / Investigate Now / Park for Later / Ignore or Accept Risk
- secrets and unsafe raw recordings absent from Git

## Demo-readiness gate

A demo is not ready merely because screens render. Required real internal pipeline:
`input/signal -> validated mutation -> impact/blast radius -> planner -> capability results -> scenario viability -> authority -> action/simulation -> observation -> updated resolved state`
