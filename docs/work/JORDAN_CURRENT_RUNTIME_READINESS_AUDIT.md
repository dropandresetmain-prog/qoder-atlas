# Jordan Current-Runtime Readiness Audit

Status: **READ-ONLY AUDIT**

Final-R4 reconciliation: accepted base is now `2baf1f6df484319e131590d37a0b026222324d03`.
R4/Sarah is accepted; the unfinished-R4 preconditions in section D are superseded.
Sarah proves programme recovery; external Atlas transport has separate sandbox
evidence. Jordan progression and resettable execution inputs remain pending.
See [A0](ASTRA_A0_CONVERGENCE.md), including the newly confirmed D1 buffer conflict.

Current date: **20 September 2026**

Repository: `dropandresetmain-prog/qoder-atlas`

## Audit snapshot

- Audited runtime branch: `integration/r4-final-acceptance`
- Exact audited SHA: `795f49e6a4a4efe6adb4f5e56a60c02a58ba089f`
- Documentation branch base at commit time: `integration/r4-final-acceptance` @ `462ea5e1d307ac806b1a3388baefa305a52e09c4`
- The active R4 branch moved after the runtime audit. This document preserves the evidence and verdict from the exact audited SHA above; it must not be read as an audit of later R4 commits unless re-verified.

## A. Current Jordan readiness verdict

**NOT CURRENTLY RUNNABLE.**

This does **not** mean Jordan needs a new architecture. Most of the core pieces already exist in the generalized PostgreSQL runtime.

What is true at the audited SHA:

- Jordan's real baseline exists in the current AiT programme dataset: Jordan Hale, SG nationality, ZG023 -> ZG053, PNR `ZGSYN09`, Concorde stay, finals at 20:45, and no morning lab obligation.
- Current Atlas REPLAY recordings contain ZG053, TR875, TR867 and TR885.
- The real evaluator has PostgreSQL evidence that TR867 fails the 150-minute arrival requirement and TR885 passes with about 370 minutes.
- R4 contains the generalized external flight execution chain NORTHSTAR needs: provider-backed offer binding -> protected booking input check -> budget/authority -> durable attempt -> Atlas verify/create/pay -> observation/reconciliation -> canonical journey update -> reassessment.
- That external chain was physically proven in-browser for Sarah at this branch lineage.
- PostgreSQL demo reset is real and physically exercised.

But the founder still cannot sit at the NORTHSTAR UI, press Reset, and run Jordan D1 -> D2 -> misconnect -> TR875 -> overnight -> TR867 -> TR885 -> approve -> execute -> observe -> resolve without API/DB/operator handwork.

The blockers are convergence gaps between existing generalized machinery and the S2 physical product flow:

1. **No product-operated D1-D4 choreography.** A generic transport-schedule ingestion command exists, but the founder does not have a Jordan progression control comparable to the current Sarah Apply flow.
2. **D1/D2 connection-state propagation is not currently proven through normal boot.** The S2 timeline itself admits the seeded legs have no dependency link that makes the progressive upstream change automatically produce the whole desired connection lifecycle.
3. **Jordan cannot pass the current protected execution gate from reset state.** The runtime dataset does not provision the booking identity fields the Atlas executor requires, nor the organiser travel budget. R4 had to enter these manually even for Sarah.
4. **REPLAY evidence cannot be executed.** Correctly, current R4 rejects REPLAY/SIMULATED offer bindings from money-moving execution. Jordan therefore needs a fresh LIVE/RECORD Atlas offer binding at approval time.
5. **Current Case graph semantics do not yet carry the complete Jordan causal chain cleanly.** Transport and stay nodes exist, but explicit connection/timing/transfer/objective representation is incomplete.
6. **No current PostgreSQL normal-boot Jordan physical acceptance test closes the whole sequence.** The strongest Jordan tests are mostly hand-seeded PG component evidence or retired SQLite/demo-harness evidence.

So the architecture is substantially closer than the verdict sounds. The missing work is a **Jordan convergence lane**, not a second recovery engine.

## B. Stage-by-stage acceptance map

| Stage | Current implementation | Input / provider evidence | PostgreSQL state | Product surface | Current proof | Status / gap |
|---|---|---|---|---|---|---|
| **RESET** | `src/app/demo/demoReset.ts` destroys one demo workspace and re-provisions through the normal PG dataset/bootstrap path | `fixtures/programmes/ait-summit-2026` | Real PG reset; R4 physically reset to 52 PASS / 0 FAIL / 15 UNKNOWN | Persistent Reset control | R4 physical evidence + reset gate/single-flight tests | **PROVEN CURRENT**, but reset deletes manually entered identity/budget; Jordan is not rerunnable from clean baseline yet |
| **BASELINE** | Normal dataset materializer builds traveller, trip/journey, ZG023/ZG053, stay, engagements, reservations | Current `programme.json` has Jordan, SG, ZG023/ZG053, PNR, Concorde, finals | Materialized through normal boot | Overview/Trip/Case read models can consume it | Current PG dataset path | **PROVEN CURRENT** for travel/programme baseline; **BLOCKED BY DATA** for executable identity/budget |
| **D1** | Generic `TRANSPORT_SCHEDULE_OBSERVED` ingress can write a changed transport observation and trigger reassessment | S2 D1 fixture: NRT arrival ~15:25, 85 min remaining | Generic canonical mutation exists | No founder-facing S2 D1 control | No current normal-boot Jordan D1 acceptance | **PARTIAL / BLOCKED BY PRODUCT UI**; safe result not physically proven |
| **D2** | Same generic transport observation path | S2 D2: NRT ~16:20, 30 min remaining | Same | No founder-facing D2 control | No current normal-boot Jordan D2 acceptance | **PARTIAL**; AT_RISK propagation needs present-runtime proof |
| **MISCONNECT** | Current ingress can mutate transport schedule; separate reprotection ingress exists for cancellation/reprotection | D3 makes ZG053 physically impossible; D4 explicit MISSED_CONNECTION exists only in scenario data | Case escalation/reassessment machinery is generic | No current one-click S2 progression | Historical/fixture evidence only | **PARTIAL/MISSING physical boundary** |
| **TEMP SAME NIGHT** | Planner can perform provider-neutral FLIGHT research | `rec_34518610...` contains TR875; `rec_71d6274...` also holds Jordan corridor inventory | Search candidates can become strategies | Case can show strategies | Recording exists; no current S2 normal-boot acceptance | **PARTIAL** |
| **OVERNIGHT** | Current ontology/read models can reason about stays; generic planning domains exist | Narita overnight fixtures/Nuitee captures exist | Normal boot does **not** compose Nuitee for execution | Case can present consequences if projected | Older Jordan hotel tests use retired/non-normal paths | **MUST REASON/PRESENT only**. Hotel booking is **not required for closed hero** |
| **AIRLINE DEFAULT** | Viability evaluator can compare candidate arrival to REQUIRED programme constraint | TR867 12:30->20:45 in source/provider fixtures | PG evaluator semantics support rejection | Can appear as rejected strategy/evidence | `m9JordanReplacementFlightViability.pgtest.ts` | **PARTIAL**: evaluation proven, normal product ingestion/reconciliation of airline-default TR867 not |
| **NORTHSTAR ALTERNATIVE** | Same planner/evaluator; current Atlas search seam | TR885 08:20->14:35 in checked-in recordings | PG evaluator proves 370 min slack | Case can recommend viable strategy | PG component proof | **PARTIAL**: current physical normal-boot path not proven; REPLAY binding cannot execute |
| **APPROVAL** | R4 `recoveryApproval.ts`: compiled plan, deterministic scope, authority, budget hold, external capability preflight | Needs LIVE/RECORD offer binding + booking inputs + budget | Real PG authority rows | Current Case approval CTA | R4 transport tests + Sarah physical run | **PROVEN CURRENT generalized**, **BLOCKED BY DATA for Jordan** |
| **EXECUTION** | R4 `externalOfferExecution.ts` | Atlas sandbox LIVE/RECORD only | Durable PREPARED -> DISPATCHING -> observed state | Current Case progress | Sarah browser proof + R4 PG/sandbox tests | **PROVEN CURRENT generalized**, Jordan itself unproven |
| **OBSERVATION** | Retrieve/reconcile without blind mutation retry | Atlas order state | Observations durable; UNKNOWN/RECONCILIATION_REQUIRED supported | Execution state surfaced | R4 crash/reconciliation tests | **PROVEN CURRENT generalized** |
| **REASSESSMENT** | Normal boot reassessment service + case lifecycle | Canonical selected replacement service after observed success | Current journey mutated only after observed success | Case/Traveller refresh | Sarah generalized proof | **PROVEN CURRENT generalized**, Jordan end-state not proven |
| **RESOLUTION** | Deterministic resolution gate | Must see current whole-trip PASS | Case moves RESOLVED, trip viable | Case terminal + Overview update | Sarah physical proof; hand-seeded Jordan evidence | **PARTIAL for Jordan** |

The key distinction is that **approval through resolution is now largely an R4 reuse problem**. The weak half is Jordan-specific **state progression into that machinery** and the clean executable data boundary.

## C. Exact minimum implementation gaps required for physical Jordan

| Gap | Why it is required | Classification |
|---|---|---|
| Data-driven founder-facing S2 stage controls for D1/D2/D3/D4 | Founder currently cannot physically perform the progressive story without direct API calls | **Act Now** |
| Current-runtime connection dependency/progression proof | D1 must remain viable, D2 become tight, D3 impossible from canonical facts rather than scripted labels | **Act Now** |
| Clean Jordan protected booking identity | `resolveOfferExecutionInputs` requires structured name + `traveller_booking_identities`, including gender and email | **Act Now** |
| Clean organiser travel budget | Costed Atlas option cannot obtain authority otherwise | **Act Now** |
| LIVE/RECORD Atlas search immediately before executable approval | REPLAY is deliberately blocked from money-moving execution | **Act Now** |
| Current Jordan planning path that retains TR867 as rejected and TR885/equivalent as viable | This is the core "booking recovery != whole-trip recovery" proof | **Act Now** |
| Current Case projection sufficient to show connection breakpoint and relevant downstream consequences | Without this the backend may work but the demo story is unreadable | **Act Now** |
| One current-PG S2 acceptance test plus physical browser run | Old SQLite/harness tests cannot be the acceptance gate | **Act Now** |
| Reset must restore all required executable inputs | Otherwise second rehearsal requires manual DB repair/re-entry | **Act Now** |
| Correct stale/conflicting Jordan data | Prevents contradictory nationality/lab facts contaminating future ingestion | **Act Now** |

Two data contradictions are specifically unsafe to inherit:

- `fixtures/programmes/ait-summit-2026/programme.json` correctly says **SG nationality**, finals at 20:45, **no morning lab**.
- `fixtures/programmes/ait-summit-2026/booking-dossiers.json` says Jordan nationality **US**.
- `data/.../traveller-report-message.json` says Jordan is supposed to be at the hackathon lab the next morning, contradicting the authoritative seed freeze.

The runtime programme truth wins. Do not reconcile those by changing engine logic.

There is another S2 source inconsistency: `baseline-itinerary.json` stores Concorde check-in as **29 Sep 15:00**, while its note says the baseline assumes Jordan's check-in is **30 Sep**. That needs source cleanup before stay consequences are presented as authoritative.

## D. Work split

### MUST FIX BEFORE ASTRA JORDAN

R4 should hand Astra a stable common engine, not unresolved common-runtime defects.

The audited R4 snapshot itself still reported Sarah programme-path acceptance unfinished, a repeated replan `SERIALIZATION_RETRY_EXHAUSTED` issue that doubled strategies, incomplete transport approval copy, stale post-recovery graph state, and broad acceptance gates not yet run.

Those are common-runtime problems. Astra should not be debugging them while simultaneously proving Jordan.

Minimum precondition: **finish R4 acceptance or explicitly freeze those remaining R4 defects as inherited known risks.**

### ASTRA IMPLEMENTATION WORK

Astra's Jordan lane should be narrowly:

`current dataset -> generalized progressive provider events -> real PG reassessment -> S2 planning -> current external execution -> observe -> resolve -> reset`

That includes the D1-D4 physical controls, connection propagation, executable input provisioning/operator path, Jordan current-PG acceptance, and the semantic projection necessary for V5.6/V7.2.

It should **not** implement a Jordan-specific controller or planner.

### STRETCH / NOT REQUIRED FOR CLOSED HERO

Per `docs/SCENARIOS.md`, do not make these Jordan acceptance blockers:

- booking the Narita hotel;
- cancel/rebooking the Singapore hotel;
- submitting an insurance claim;
- Google Routes live lookup;
- executing a transfer redispatch;
- composite flight + hotel + transfer execution in one authority cycle;
- full multi-provider partial-failure recovery;
- authoritative Japan entry decision machinery, provided NORTHSTAR does not assert a legal conclusion.

Those are legitimate future NORTHSTAR capabilities. They are not required to close this hero.

## E. Provider/data necessity matrix

| Provider / context | Closed-hero requirement | Current state | Verdict |
|---|---|---|---|
| **Atlas** | **Required** for transport research and executed replacement | REPLAY Jordan search evidence exists. Current R4 normal boot has Atlas search and sandbox external execution. LIVE/RECORD binding required to execute. | **MUST HAVE** |
| **Atlas verify** | **Required immediately before external execution** | Current R4 external dispatcher performs provider verification as part of the protected execution path | **MUST HAVE - current generalized support** |
| **Atlas fare/rules** | Useful for decision evidence; not intrinsically required to prove 150-minute viability | `withOfferEnrichment` exists, but normal `composeTargetBoot` does not currently enable that enrichment option | **SOURCE-ONLY / optional for closed hero unless policy decision depends on it** |
| **Atlas order create/pay/retrieve** | **Required** | Current R4 external execution composes these only for sandbox LIVE/RECORD | **MUST HAVE - generalized path exists** |
| **Nuitee** | Overnight context only | Adapter/captures exist; not composed in current target normal boot | **NOT REQUIRED for closed hero** |
| **Google Routes** | Transfer timing context only | Not current target-normal provider composition | **NOT REQUIRED** |
| **Entry/legal** | Only if NORTHSTAR presents an admissibility conclusion | S2 local research explicitly says `UNKNOWN_NEEDS_AUTHORITATIVE_SOURCE`; not auto-attached | **Do not block flight hero; show UNKNOWN if mentioned** |
| **Insurance** | Context / potential claim only | Scenario rules exist but are explicitly not auto-attached by current programme builder | **NOT REQUIRED** |
| **Transfer** | Consequence should be understandable; transaction need not execute | Current runtime has synthetic SIN transfer-duration constraints, but no required provider redispatch transaction | **REASON/PRESENT, not execute** |

On immigration specifically: the current synthetic note that an SG passport holder "typically" qualifies is **not sufficient authority for NORTHSTAR to make a legal entry claim**. Either preserve it as unresolved context or use an authoritative source at decision time. Do not turn the synthetic fixture into legal truth.

## F. Historical Jordan capability that must not be revived

The biggest trap is looking at the old S2 experience and thinking, "we already had this, restore it."

Do not.

The retired path includes the SQLite/demo-manifest runtime used by:

- `test/final-demo-runtime-convergence.test.ts`
- `test/final-demo-lifecycle-convergence.test.ts`
- `test/s2-overnight-hotel-closure.test.ts`
- `test/integration.r2-rehearsal.test.ts`
- `test/e2e/hero-lifecycle-rehearsal.test.ts`

Those tests demonstrate useful historical behavior, but they compose the old SQLite/demo machinery. They must not force:

- SQLite back into normal operation;
- scenario-manifest orchestration into production runtime;
- fake one-call coordinated recovery;
- a special Jordan hero controller;
- old provider executor composition;
- hotel execution merely because the old rehearsal executed it;
- timer-driven Jordan progression.

Likewise, `src/app/target/secondScenarioFoundation.ts` is mainly a compatibility/foundation declaration. Its comments about multi-action and multi-stay recovery do **not** prove those capabilities are current normal-boot behavior, nor do they override the narrower current closed-hero truth.

## G. Tests worth preserving as migration/generalization evidence

| Test | What it legitimately proves |
|---|---|
| `postgres-integration/m9JordanReplacementFlightViability.pgtest.ts` | Excellent proof that the real PG evaluator rejects TR867 and accepts TR885 on the generic 150-minute requirement |
| `postgres-integration/m9JordanMultiActionRecovery.pgtest.ts` | Generic PG ActionPlan dependencies, partial recovery and resolution gating; useful future evidence, broader than closed hero |
| `postgres-integration/r4AtlasOfferExecution.pgtest.ts` | Current external Atlas execution seam |
| `postgres-integration/r4AtlasCrashRecovery.pgtest.ts` | Durable attempt, crash/lost-response behavior, reconciliation and no blind retry |
| `postgres-integration/r4AtlasResearchModeGate.pgtest.ts` | Crucial proof that REPLAY cannot silently become live money-moving input |
| `postgres-integration/r4AtlasSandboxLive.pgtest.ts` | Closest machine proof to the final transport execution chain: search -> plan -> approve -> order/pay -> ticket observation -> canonical update -> resolved |
| `postgres-integration/eventOverview.pgtest.ts` | Current PG-backed bounded Event Overview projection |
| `test/r4-demo-reset-gate.test.ts` / `r4-demo-reset-single-flight.test.ts` | Current reset safety/product mechanics |

These are evidence to **reuse**, not a replacement for one new current-target Jordan E2E.

## H. Historical/stale tests that must not dictate architecture

`final-demo-runtime-convergence`, `final-demo-lifecycle-convergence`, `s2-overnight-hotel-closure`, `integration.r2-rehearsal`, and `hero-lifecycle-rehearsal` are **HISTORICAL-ONLY** for current architectural acceptance because they explicitly compose the SQLite/replay-era demo runtime.

`test/m9-jordan-s2-compatibility.test.ts` is useful contract evidence but not a runtime test. It proves generic enums can express Jordan. It does not prove Jordan runs.

`test/m9-jordan-partial-failure-acceptance.test.ts` uses the older `providerExecution.ts` hotel path and a fake `HotelCapability`. It is useful future multi-provider behavior evidence but should not drive the closed hero or current boot.

This distinction matters because otherwise Astra will waste time restoring a richer old demo on top of a newer, safer architecture.

## I. Anti-hardcoding acceptance

Jordan only counts as a generality proof if the application contains **zero Jordan-aware recovery behavior**.

The acceptance boundary should be:

`configured S2 source facts`
-> generic provider/simulated-provider event ingress
-> canonical TransportService mutation
-> generic dependency invalidation/reassessment
-> generic RecoveryCase
-> generic TRANSPORT planning
-> deterministic whole-trip viability
-> generic authority
-> `external:offer.select`
-> Atlas executor
-> observation
-> canonical state mutation
-> generic reassessment/resolution.

No application condition may key on:

- `Jordan`
- `ait-draft-09`
- `ZG023`
- `ZG053`
- `TR875`
- `TR867`
- `TR885`
- `NRT`
- `LAX`
- `SIN`
- `finals`
- S2 stage ids

Those facts belong in data/configuration/replay inputs.

The strongest acceptance is that **Sarah and Jordan can both start from Reset and traverse the same runtime with no application-code switch between them**. The only differences should be their source events, trip graph, policies, permissions and resulting strategy.

## J. Proposed Jordan physical acceptance script for Astra

| Beat | Founder action | Required visible/current truth |
|---|---|---|
| 1 | Click **Reset** | Clean AiT baseline; Jordan on track; no active S2 recovery |
| 2 | Trigger first disclosed provider update | ZG023 delayed; connection still viable; Jordan remains okay |
| 3 | Trigger second update | Connection visibly tight/at risk; no premature recovery |
| 4 | Trigger impossible-connection update | ZG053 can no longer be made; Case opens from generic reassessment |
| 5 | Find/check recovery | TR875 or same-night equivalent appears as viable while still boardable |
| 6 | Trigger further delay/clock boundary | Same-night option becomes invalid; Narita overnight consequence appears as context |
| 7 | Reconcile airline default | TR867/default morning option is shown but rejected because arrival fails the 150-minute finals requirement |
| 8 | Find recovery again | Current Atlas provider-backed search finds TR885 or an equivalent early-enough service; deterministic evaluator shows it preserves finals |
| 9 | Review | Flight, arrival, finals consequence, spend and authority are understandable; stay/transfer/entry context may be shown without pretending they were executed |
| 10 | Approve in Case UI | Exactly one approved external ActionIntent; no hidden direct API call |
| 11 | Execute | Durable attempt precedes network; Atlas verify/create/pay occurs once |
| 12 | Observe | TICKETED/confirmed provider result observed or safe reconciliation runs; canonical selected service changes only after observed success |
| 13 | Reassess | Jordan's current trip clears the 150-minute finals requirement |
| 14 | Resolve | Case terminal `RESOLVED`; trip `VIABLE`; Case has no recovery CTA |
| 15 | Overview | Jordan clears/fades back into healthy population; no stale disruption state |
| 16 | Reset and rerun | Same baseline returns without SQL repair, manual identity insertion, or budget insertion |

For acceptance, deliberately test one **lost-response/reconciliation** variation separately. Do not put it into the primary demo choreography.

## K. Recommended safe implementation sequence

1. **Close/freeze R4 first.** Resolve or explicitly park the common R4 issues before Jordan starts.
2. **Reconcile Jordan source truth.** Remove the SG/US, lab/no-lab and stay-date contradictions. Establish one runtime source.
3. **Make executable inputs durable and resettable generically.** Protected booking identity + organisation budget must come from a legitimate data/operator boundary. Do not teach the dataset materializer about Jordan.
4. **Build the generalized progressive event lane.** A data-carried sequence should invoke the existing generic provider-event commands. The UI control can say "Apply next update," but stage semantics live in the fixture.
5. **Prove connection propagation before touching recovery planning.** Focused PG tests: D1 SAFE, D2 AT_RISK, D3 impossible. This is the crucial missing deterministic foundation.
6. **Wire the D3/D4 boundary cleanly.** Decide whether "connection missed" is derived from canonical schedule/time state or ingested as a provider observation; do not fake it in UI.
7. **Prove Jordan through current planner in REPLAY first.** TR875 temporary viability, TR867 rejected, TR885 accepted. This phase does not execute.
8. **Switch only the executable selection to LIVE/RECORD provider evidence.** Fresh binding, verify, cost, budget, authority.
9. **Reuse R4 external executor unchanged unless a generalized contract gap is found.** Jordan should not add an Atlas execution branch.
10. **Close Case/V5.6 semantic gaps needed for Jordan.**
11. **Verify V7.2 projection transitions.**
12. **Add one current PostgreSQL Jordan acceptance plus browser physical run.**
13. **Reset -> Sarah -> Reset -> Jordan -> Reset -> Jordan again.** This is the anti-hidden-state gate.

That order keeps Astra checkpointable. It can be stopped after any phase without leaving a half-Jordan special architecture.

## V5.6 current Jordan fit

**Backend semantic fit: PARTIAL.**

`projectFocusedCaseGraph.ts` already enriches the current Case with transport services, stay nodes and programme commitments, generically. It also emits ordered `MUST_HAPPEN_BEFORE` relationships and does not branch on Jordan.

But Jordan exposes several real semantic gaps:

- there is no explicit objective node because current `LdgNodeKind` lacks `OBJECTIVE`; the implementation itself reports `objectiveContractGap`;
- comments promise meaningful `TIMING` nodes, but current enrichment does not actually produce a distinct connection/arrival timing node for this journey;
- two flight legs are mostly represented as ordered service bookings, not a first-class **connection dependency / breakpoint**;
- arrival transfer is not a normal materialized journey node, so the transfer consequence cannot appear as a fully grounded branch;
- an upstream flight delay therefore cannot simply be expected to produce the ideal V5.6 `travel -> connection -> stay/transfer/programme` causal display from existing projection alone.

That is a **backend semantic projection gap**, not a reason to hack the V5.6 renderer.

The visual renderer should remain generic. Fix the semantic inputs first.

## V7.2 expected Jordan behavior

There is more current implementation here than the roadmap wording alone suggests.

The audited branch already contains:

- `src/app/target/readmodels/eventOverview.ts`
- `src/ui/overview-graph/*`, including a normalized V7.2 presentation model
- `postgres-integration/eventOverview.pgtest.ts`

So the generalized bounded Overview projection is **current source with PostgreSQL test coverage**.

For Jordan, expected behavior is:

**healthy baseline** -> Jordan remains compressed in population/cohort

**individual flight change** -> relevant dependency can become changed and Jordan is promoted as the affected traveller exception

**AT_RISK/DISRUPTED** -> Jordan remains prominent and linked to the relevant programme landmark

**recovery observed + reassessment PASS** -> Jordan becomes CLEARED, visually settles/fades, then can return into the healthy population presentation.

What is missing is a current Jordan progression acceptance proving those transitions against D1-D4. Do not build special Overview behavior for Jordan.

## Authority / execution conclusion

The R4 branch has crossed an important threshold: **the generalized mechanism needed to execute Jordan's flight recovery exists.**

`composeTargetBoot.ts` composes the external Atlas executor only when truthful:

- `ADAPTER_MODE=LIVE|RECORD`
- Atlas credentials exist
- Atlas sandbox host is configured

`providerExecutionInputs.ts` blocks execution when the binding is replayed, passenger information is missing, booking identity is missing, or contact is missing.

`recoveryApproval.ts` blocks authority from being minted for an option that cannot execute.

`externalOfferExecution.ts` then provides the required:

**proposal -> validation -> deterministic viability -> authority -> durable attempt -> executor -> observe/reconcile -> canonical state update -> reassessment.**

That is exactly the right architecture for Jordan.

Astra's job is to **get Jordan into that pipe**, not replace the pipe.

## L. Known / Unknown / Key assumption / Next test

### Known

At audited SHA `795f49e6a4a4efe6adb4f5e56a60c02a58ba089f`:

- Jordan baseline data and Atlas recovery inventory exist.
- The PG evaluator can distinguish TR867/TR885.
- R4 contains and has physically exercised a generalized Atlas flight-execution path.
- Reset is real.
- V5.6 semantics are incomplete for Jordan's connection/transfer path.
- The current clean dataset does not provide enough protected execution inputs/budget to execute after Reset.

### Unknown

- Whether a clean current normal-boot Jordan D1 schedule mutation produces the intended SAFE assessment.
- Whether D2 produces AT_RISK.
- Precisely how D3 should deterministically establish the connection breakpoint without a scenario-specific missed-flight command.
- Whether Atlas LIVE/RECORD on the physical demo day returns TR885 itself versus another viable equivalent.

### Key assumption

Jordan remains a single-flight closed hero: the only consequential action that must execute is the selected next-morning replacement flight.

Overnight hotel, Singapore stay remediation, insurance and transfer execution remain context/deferred per the current `docs/SCENARIOS.md` boundary.

### Next test

Before Astra touches the UI or providers, create one focused current-PostgreSQL acceptance proving:

**clean configured AiT dataset -> identify Jordan/ZG023/ZG053 from canonical data -> D1 observation -> PASS/SAFE -> D2 observation -> AT_RISK -> D3 observation -> NOT_VIABLE + RecoveryCase opened.**

If that fails, stop there and fix the generalized connection dependency/evaluator path.

Do **not** compensate in the planner, graph or UI.

Once that passes, Jordan becomes mostly a convergence exercise over machinery R4 already built.

---

**JORDAN READINESS AUDIT COMPLETE — NOT CURRENTLY RUNNABLE**
