# Testing Strategy

## Purpose

Tests must prove that the application is a generalized trip-resolution engine rather than a scripted demo.

Verification is **cumulative evidence**, not a ritual where every stage reruns every check.

- work packages run scoped tests for changed behavior and justified failure paths;
- integration reuses valid lane evidence and tests newly created seams;
- independent review primarily inspects existing evidence unless a concrete uncertainty needs new execution;
- the final candidate runs the canonical broad gate on the exact candidate SHA.

`docs/IMPLEMENTATION_PLAN.md` assigns these test IDs to work packages.

## Test IDs

### T-DOM — Domain/schema contracts
Validate:
- entity/operational schemas;
- invalid enum/type rejection;
- relationship/constraint reference integrity;
- source authority/provenance/freshness representation;
- explicit vs latent preference precedence;
- UNKNOWN representation;
- flexible required/unbooked transport;
- recovered-with-loss outcome.

### T-EVAL — Deterministic evaluators
Cover:
- timezone normalization;
- time-window arithmetic;
- duration/buffer envelopes;
- hotel/check-in/no-show windows required by scenarios;
- transfer/connectivity constraints;
- flexible `TransportLeg` fulfilment;
- accessibility requirements;
- policy/spend thresholds;
- PASS/FAIL/UNKNOWN distinction;
- irreversible loss without engine termination.

### T-PROP — Mutation and blast-radius propagation
Validate:
- only validated proposals mutate state;
- changed facts reevaluate relevant constraints;
- dependency propagation produces `ImpactAssessment`;
- downstream state is not blanket-invalidated;
- direct failures, at-risk items, safe objectives, unknowns, and irreversible losses remain distinguishable;
- audit/history is preserved.

### T-OVERLAY — Scenario overlays and viability
Validate:
- candidate changes never mutate authoritative state;
- overlay evaluation is deterministic;
- hard-constraint failures make a scenario infeasible;
- soft tradeoffs remain available for ranking;
- successful observed execution is required before authoritative replacement state appears.

### T-AUTH — Authority and case lifecycle
For identical `ActionIntent + policy/context`, authority outcome is deterministic.

Cover:
- AUTO_APPROVED;
- REQUIRES_TRAVELLER;
- REQUIRES_ORGANISATION_APPROVER;
- REQUIRES_HUMAN_AGENT;
- BLOCKED;
- executing/verifying loops;
- API success without restored viability does not resolve the case;
- FULLY_RECOVERED and RECOVERED_WITH_LOSS.

### T-AI — AI contracts
Use cheap Model Studio calls or saved outputs for plumbing where useful.

Validate:
- schema-constrained extraction;
- malformed output rejection;
- uncertainty surfaced rather than guessed;
- explicit instruction overriding latent preference;
- planner structured strategies/tool needs;
- legal/entry facts require authoritative sourcing;
- operational research estimates retain source/uncertainty;
- model output cannot bypass mutation/viability/authority/execution gates.

Prompt quality should not become an external-model rabbit hole before the integrated loop works.

### T-ADAPTER — External capability contracts
For each adapter validate:
- normalized success result;
- structured error/unavailable result;
- no secret leakage;
- LIVE/REPLAY same normalizer/downstream path where supported;
- provider failure does not crash RecoveryCase;
- replay data remains provider-shaped enough to exercise the real normalizer.

Mandatory Atlas:
- Search;
- Verify;
- fare/change/refund/no-show rule normalization required by the scenario.

Google Routes:
- route normalization;
- missing-credential/network fallback.

### T-PERSIST — Persistence/restart
Validate:
- Trip/Case survive process restart/reload;
- audit/source history persists;
- state transitions/versioning remain coherent;
- deterministic fixture/reset/reseed creates known demo state.

### T-GEN — Generalisation / anti-hardcoding
At least two materially different scenarios pass through the same application code:

**Scenario A — AnchorEvent speaker**
Event obligations, organiser policy, traveller interaction, disrupted flight, downstream transfer/hotel/event objectives.

**Scenario B — TMC/corporate traveller**
Different governance/policy, approval/spend path, objective, route/context, and supplier data.

Changing scenarios may change only source documents/pages, fixture/config data, traveller/organisation/AnchorEvent/policy values, and provider responses.

Search for:
- fixture/event/traveller names;
- city/airport/route constants;
- provider branches outside adapters;
- scenario-specific conditions in domain/recovery/application code.

Any genuine missing abstraction is an architecture gap, not permission to hardcode.

### T-E2E — Integrated recovery loop
Prove:

`source/profile -> validated persistent state -> TripSignal -> mutation -> ImpactAssessment -> RecoveryPlanner -> capability results -> scenario overlays -> deterministic viability -> authority -> action/simulation -> observation -> resolved state/read models`

No manual state edits are allowed between stages.

At least one development proof must show Atlas LIVE Search/Verify through the real adapter. Routine E2E may use replay.

### T-RELEASE — Final candidate gate
On the exact candidate SHA:
- build;
- typecheck;
- lint;
- full automated test suite appropriate to stack;
- Scenario A E2E/replay;
- Scenario B `T-GEN`;
- hardcoding audit/search;
- reset/reseed;
- persistence restart;
- provider/model fallback smoke tests;
- secret/sanitized-recording review.

## Robustness scenario pool

Do not require every robustness scenario before the core works. Select the highest-value subset in `IMPLEMENTATION_PLAN.md`.

Candidate scenarios:
- late arrival vs hotel reception/no-show;
- public transport unavailable; flexible taxi/private transfer remains viable;
- separately booked rail/ferry connection;
- visa/entry/immigration buffer invalidates nominal connection;
- accessibility invalidates cheaper recovery;
- shared transfer/resource affects another traveller;
- trip objective already lost; remainder recoverable;
- stale imported hotel data produces UNKNOWN/reverification rather than false PASS.

## Work-package verification rule

Before an implementer declares a work package implemented:
- run the `T-*` categories assigned in `IMPLEMENTATION_PLAN.md`;
- run build/typecheck/lint only when the changed package or repository baseline makes them useful, not automatically all three for every tiny task;
- verify relevant failure/fallback behavior;
- verify no scenario-specific domain branch was added;
- ensure no secret/unsafe raw provider data is committed;
- report exact commands/evidence honestly.

## Integration verification rule

The integrator:
- verifies lane branch/head evidence;
- reuses scoped lane tests that remain valid;
- tests newly created seams and conflict resolutions;
- runs `T-E2E` once the vertical loop exists;
- does not rerun every historical test after each merge by habit.

## Independent review rule

Independent review is not required for every work package or checkpoint.

Use it when:
- architecture/shared contracts changed materially after freeze;
- a real irreversible/provider-money boundary is introduced;
- persistence/auth/security work has meaningful destructive risk;
- integration failure suggests correlated blind spots;
- the final candidate is ready.

Review findings are triaged `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`. Fixes require targeted closure evidence.

## Demo-readiness definition

A demo is not ready merely because screens render.

Required:
- real internal pipeline (`T-E2E`);
- real Atlas adapter evidence plus reliable replay;
- second-scenario generalisation (`T-GEN`);
- deterministic viability/authority boundaries;
- persistent/resettably seeded state;
- UI reading real application state;
- external simulation only where provider transactions are unsupported/unavailable.
