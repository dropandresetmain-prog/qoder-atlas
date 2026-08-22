# Testing Strategy

## Purpose

Tests must prove that the application is a generalized trip-resolution engine rather than a scripted demo.

Verification is **cumulative evidence**, not a ritual where every stage reruns every check.

- work packages run scoped tests for changed behavior and justified failure paths;
- integration reuses valid lane evidence and tests newly created seams;
- **Checkpoint A, Checkpoint B, Checkpoint C, and Final Candidate each have an explicit independent review gate** with scope proportional to the risk at that stage;
- independent reviewers inspect existing evidence first and run additional checks only when a concrete uncertainty needs execution;
- the final candidate runs the canonical broad gate on the exact candidate SHA.

`docs/IMPLEMENTATION_PLAN.md` assigns these test IDs to work packages. Model selection for implementation/review remains owned by `docs/AGENT_MODEL_SELECTION.md`; this document defines **when and what to review**, not which model must do it.

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

### T-NORTHSTAR — Northstar contract and programme-scale families (RV-N0+)

Contract baseline: `test/northstar-contracts.test.ts` at `NORTHSTAR_CONTRACT_BASE_SHA`. Families below extend it in later RV-N packages without weakening the frozen contracts.

**Contract families (frozen at RV-N0):**
- commitment linkage: `AnchorCommitment` shared children, Engagement `anchorCommitmentId` fan-out, importance per traveller — never global hardness;
- intake equivalence: every `IntakeChannel` promotes `ProgrammeTravellerDraft` through the same validated mutation path with honest `PromotionOutcome` issues — no direct Trip/Booking writes;
- initial planning: zero-element trips with UNKNOWN viability are legal; `caseKind` defaults RECOVERY and legacy cases load unchanged;
- ChangeRequest variants: the three frozen shapes (window shift + self-funding, later/direct transport, stay proximity) validate; requests containing element mutations/booking ids/provider operations are rejected;
- funding: `FUNDED_WINDOW` rule + `CostAllocation` fields validate; payer vocabulary closed;
- event-side signal: `ANCHOR_COMMITMENT_CHANGE` payload validates; provider signal kinds never carry event-side facts;
- programme read model: `ProgrammeView` shape (status rollups, endangered commitments, active cases, decisions required, uncertainty);
- tool-vocabulary safety: extended `ToolOperationSchema` remains a strict subset of `CapabilityOperationSchema`; consequential hotel.book/transfer.* never appear as tool operations;
- temporal normalization: offset-qualified passthrough, naive values normalized only with explicit IANA timezone, absent timezone → uncertainty (undefined), never a guessed offset.

**Programme-scale families (RV-N1..N12):**
- commitment fan-out reaches every linked Engagement and only those;
- initial planning through the overlay engine reaches resolved trips without provider calls;
- Cases A/B/C as frozen in `PRODUCT_SPEC.md` ("Frozen acceptance Cases A/B/C"), each at programme scale;
- ~40–45 traveller scale smoke: seeding, fan-out, reset/reseed and restart remain deterministic and complete at that traveller count.

**Anti-hardcoding / alternate-data rule (Northstar):** every Northstar acceptance test must pass with an alternate fixture set — different event type, different cities/airports/hotels/dates, different traveller identities. No WiT/conference/speaker/SIN/KUL/route/airline/hotel/fixture/demo-date/Case-id logic may exist in `src/**`; the hardcoding search of T-GEN is extended with these families.

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

A work-package completion is **not** an independent review checkpoint unless it contains a material architecture/high-risk change that triggers an exceptional review under the rule below.

## Integration verification rule

The integrator:
- verifies lane branch/head evidence;
- reuses scoped lane tests that remain valid;
- tests newly created seams and conflict resolutions;
- runs `T-E2E` once the vertical loop exists;
- does not rerun every historical test after each merge by habit.

## Independent review checkpoints

Independent review is mandatory at the four formal gates below. This is deliberate risk control, not a request to re-review every package or every historical line of code.

A reviewer must inspect the **actual repository SHA and evidence**, not merely accept the implementer's report. Reviewer findings are triaged `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

A checkpoint passes when there are no unresolved **Act Now** findings and no unresolved **Investigate Now** finding that threatens that checkpoint's acceptance criteria. Parked/accepted hackathon risks do not block progress.

A targeted review fix requires targeted closure evidence. It does **not** automatically trigger another full review of unrelated areas.

### Review Gate A — contract freeze / fan-out

Runs after F0–F3 scoped verification and before downstream lane fan-out.

Review focus:
- runnable credential-free foundation;
- shared domain/operational/service/capability/read-model contracts;
- deterministic/AI safety boundaries;
- timezone/freshness and authority semantics in frozen shared code;
- two-scenario generality;
- anti-hardcoding;
- lane ownership/collision risk;
- whether tests meaningfully prove the contract claims.

The output is `PASS` or `FAIL — FIX REQUIRED` plus a safe fan-out SHA if passed.

Checkpoint A review may include static architecture/code review in addition to an independent coding-agent review because errors here multiply across all downstream lanes.

### Review Gate B — integrated vertical recovery loop

Runs after I1–I5 meet Checkpoint B acceptance and before treating the vertical loop as accepted.

Review focus is the **integrated high-risk path**, not a ceremonial re-review of every lane:
- validated mutation and persistence;
- impact/blast-radius propagation;
- scenario overlay isolation and deterministic viability;
- planner/capability separation;
- deterministic authority and irreversible-action gate;
- executor/observation/state-update loop;
- LIVE/RECORD/REPLAY equivalence and provider-boundary simulation truthfulness;
- UI consuming actual read models rather than bespoke demo data;
- Scenario A `T-E2E` evidence and restart/persistence behavior.

If a lane's previous scoped evidence remains valid, reuse it. Expand review into lane internals only when the integrated seam or evidence gives a concrete reason.

### Review Gate C — generalisation / reliability / demo candidate

Runs after G1–G3 and R1 meet Checkpoint C acceptance, before declaring the integrated SHA the demo candidate.

Review focus:
- Scenario B runs through the same application code;
- no scenario/event/traveller/city/route/fixture hardcoding in production logic;
- provider-specific logic remains inside adapters;
- selected robustness cases are real rather than scripted;
- reset/reseed and persistence restart are reliable;
- unavailable/provider/model fallback behavior is honest;
- replay and sanitized recordings are demo-safe;
- docs/README/demo claims match implemented reality;
- any shared-contract change since Checkpoint A was deliberately reconciled rather than hidden in a lane.

This is primarily a **generalisation + reliability audit**, not another full release audit.

### Review Gate Final — release/demo candidate

Runs on the exact final candidate SHA.

This is the broad independent release review plus `T-RELEASE` canonical verification.

Review focus includes:
- deterministic mutation/viability/authority safety boundaries;
- persistence;
- provider/action boundaries;
- LIVE/RECORD/REPLAY consistency;
- policy/constraint enforcement;
- AI schema boundaries;
- both accepted scenarios;
- hardcoding;
- reset/reseed and fallback behavior;
- secret/recording hygiene;
- user-facing claims vs implemented reality;
- demo flow readiness.

Only after this gate and `T-RELEASE` pass is the repository considered final-candidate complete.

## Exceptional review trigger

Outside the four mandatory gates, add a targeted independent review only when evidence warrants it, for example:
- architecture/shared contracts change materially after Checkpoint A freeze;
- a real irreversible/provider-money boundary is introduced or materially changed;
- persistence/auth/security work has meaningful destructive risk;
- integration failure suggests correlated blind spots;
- a reviewer identifies a cross-cutting issue whose closure cannot be established by targeted tests alone.

Do not add independent reviews merely because a package is important or because a model completed a large amount of code.

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
