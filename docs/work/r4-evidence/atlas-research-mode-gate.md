# Research-mode gate for provider execution (R4-F2f, review N4)

## Problem
`offer_execution_bindings.research_mode` (SIMULATED / REPLAY / RECORD / LIVE) is durable, but nothing read it. A binding created from REPLAY recordings carries a replayed `routingIdentifier`; if the runtime later booted LIVE/RECORD the executor would have used it as a live money-moving input.

## Design
* One probe, three consumers (approval preflight, execution boundary, read model `executionBlocker`): `resolveOfferExecutionInputsForStrategy` returns `{ ready:false, reason:'FRESH_PROVIDER_QUOTE_REQUIRED' }` unless `research_mode IN ('RECORD','LIVE')` (`LIVE_RESEARCH_MODES`). Checked right after the binding is loaded, before anything else, so no replayed identifier is ever handed to a dispatcher.
  * read model / approval: structured blocker/refusal code `FRESH_PROVIDER_QUOTE_REQUIRED` (added to `ApplicationErrorCodeSchema`), plain message: "This fare was checked from saved records, not with the airline. A fresh live price check is needed before it can be booked." No plan, authority decision, budget hold or attempt is created.
  * execution: `runExternalOfferExecutionPass` reports the intent REFUSED (`FRESH_PROVIDER_QUOTE_REQUIRED: ...`) before any attempt row or provider call, even if an approval already exists.
* Executor side: a pass whose executor mode is not LIVE/RECORD refuses every candidate (`EXECUTOR_MODE_NOT_LIVE`), no attempt, no network. (`composeOfferExecution` already refuses to compose in REPLAY.)
* Price/offer drift is unchanged and re-proved: PRICE_CHANGED at verify -> zero mutation, OBSERVED_FAILURE, "re-enter viability/authority"; payable above the authority-frozen ceiling -> order held, pay never issued (r4AtlasOfferExecution.pgtest.ts).

## Path to a fresh quote
Bindings are immutable and per strategy. A LIVE/RECORD-composed runtime plans with live research (`composeTargetTransportResearch`), which writes a NEW binding stamped RECORD/LIVE for the new strategy in the same wake, and that strategy goes through viability -> authority -> currentness as usual (the new price/offer difference re-enters authority; it is never paid against stale terms). There is no automatic "supersede this replay-researched strategy" trigger yet: the blocked option stays visibly blocked until the case is re-planned.

## Fixtures
`plannedTransportCase` stamps scripted (REPLAY-recorded) research as `RECORD` by default (`stampBindingResearchMode`, superuser fixture write bypassing the immutability trigger) so the existing scripted executor tests model "a fresh provider quote"; `researchMode: 'REPLAY'` keeps the real stamp. The scripted executors now declare mode `RECORD`.

## Evidence
`postgres-integration/r4AtlasResearchModeGate.pgtest.ts` (3): REPLAY/SIMULATED blocked at read model + approval with nothing minted; RECORD/LIVE eligible; approved-intent + REPLAY binding refused at execution with zero attempts/calls, then executes once the binding is LIVE; non-live executor never mutates.
