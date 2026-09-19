# `external:offer.select` — decision, contract and evidence (R4-F2)

Branch `r4f/f2-atlas-execution` (base `integration/r4-final-acceptance` `1375fde`).
Atlas bookings are **SANDBOX** (host `sandbox.atriptech.com`, test-balance payment only). Real sandbox calls are allowed and were made.

## FIRST ANSWER

**Can current PostgreSQL truth safely provide the provider identity / offer / order inputs required for `external:offer.select`?**

**NO.** Three inputs the provider order needs were absent from PG, one was unresolvable:

| Input | State in PG at `1375fde` | Evidence |
| --- | --- | --- |
| Raw provider offer identity (`routingIdentifier`) behind `SELECT_OFFER.offerId` | **Absent.** `offerId` is a SubjectId-safe hash (`transportProposer.ts` `transportOfferKey`). The raw id lived only in the ephemeral planning world (`WTransportService.researchedOffer`, "never writes PostgreSQL", `transportOfferMaterialization.ts`); the persisted attempt evidence is "projections, never transcripts" (0125). | grep `rawOfferId`/`researchedOffer`: only world.ts + proposer + materialization |
| Passenger gender (mandatory for Atlas) / DOB / nationality | **Absent** (`traveller_names` has given/family only; no gender/DOB column anywhere). | `validateCreateQuery`, migrations 0012-0016 |
| Booking contact | Contact channel values are **protected refs with no resolver** (0012). Atlas rejects an order without a valid email (**provider status 323**, observed live). | live recording, see below |
| Payment handle | No PG concept. The Atlas adapter accepts only its own approved sandbox handle `atlas-sandbox-balance`, which is an adapter constant, not identity. | `transactionAdapter.ts` `ATLAS_SANDBOX_BALANCE_PAYMENT_REF` |
| Budget for the costed intent | The approval path refused any costed intent (`BUDGET_HOLD_REQUIRED`), and `external:offer.select` was never declared supported to `compileActionPlan` (hence `CAPABILITY_UNSUPPORTED`). | recoveryApproval.ts (before), r1ConnectionRecovery.pgtest |
| Authority scope for OFFER/JOURNEY_ITEM | `requiredAuthorityScope` demanded exact grant coverage of the `OFFER` hash id and the `JOURNEY_ITEM`; neither is enumerable in a grant. | storedExecutionGate.ts `requiredAuthorityScope` |

So the smallest PG-native **protected execution input contract** was frozen first. No SQLite dossier state, no hardcoded Sarah/Atlas identities.

## Frozen protected-input contract (migrations 0128, 0129)

* `offer_execution_bindings` (immutable, `forbid_mutation`): `(workspace, strategy, journey_item, offer_key) -> provider_id, provider_offer_ref, research_mode, observed_at, quoted price, itinerary`. Written **only** by the planning coordinator in the same wake that persists the viable SELECT_OFFER strategy (`recoveryPlanningCoordinator.ts:334/397`). Never by an LLM, proposer or approval.
* `traveller_booking_identities`: `gender` (required), `contact_email` (required by Atlas), `date_of_birth`, `nationality`. Operator/authoritative input; absence refuses execution. Read only by the external execution boundary.
* Names come from the existing `traveller_names` given/family (LEGAL first). Contact **name** is derived (`Family/Given`). Passengers = reservation allocations for the item, else the journey's own traveller (same rule as the research party).
* Payment: the sandbox handle is injected by composition (`composeOfferExecution`) only when the base URL host is the Atlas sandbox; the adapter re-checks host and handle.

One probe, three consumers: `resolveOfferExecutionInputs*` (`providerExecutionInputs.ts`) is used by **approval** (refuse before minting authority), the **execution boundary** (refuse before any attempt), and the **read model** (`RecoveryStrategyView.executionBlocker`, so Recover is not offered as executable when it cannot run).

## Composition and truthfulness

* `composeOfferExecution` (`externalOfferExecution.ts`, boot: `composeTargetBoot.ts:271`) composes only when `ADAPTER_MODE` is **LIVE or RECORD**, Atlas credentials exist, and the host is the sandbox. In REPLAY nothing is advertised (REPLAY cannot prove a mutation) and approval returns `EXTERNAL_EXECUTION_NOT_COMPOSED` with an explicit reason. RECORD writes sanitized results under `recordings/`.
* Declared capability truth `external:offer.select` reaches `compileActionPlan` only via `runtimeHooks.externalCapabilities` (set only when composed).
* Sarah's winning path (two internal programme intents) is unchanged: `r3ComposedB1Full`, `b1RecoveryLoop`, `r1ComposedB1`, `r1UnknownOutcome`, `m8AuthorityExecution` all still pass.

## Code path map, proposal to reconcile (file:line at HEAD)

1. AI/proposal -> structural validation -> deterministic viability: `transportProposer.ts` (`createTransportProposer`) emits `SELECT_OFFER`; `coordinatorCore.ts` `evaluateRecoveryStrategy` (RC-6) decides VIABLE. **No provider mutation exists on this side** (`dispatch.ts` exposes only read ops: `retrieveOrder`, `quoteCancellation`, `retrieveCancellationStatus`).
2. Bind offer identity: `recoveryPlanningCoordinator.ts:397` -> `providerExecutionInputs.ts` `persistOfferExecutionBindings`.
3. Preflight + authority: `recoveryApproval.ts:212 approveRecoveryStrategy` -> `externalExecutionBlockerFor:145` -> `compileActionPlan:236` -> per intent `holdBudget:276` -> `issueAuthorityDecision:281` -> `recordApproval:292` (approver and executor grants verified first). Nothing executes here.
4. Execution candidates: `externalOfferExecution.ts:101 loadCandidates` — approved (decision+approval), no prior attempt except a never-claimed PREPARED one, prerequisites succeeded.
5. Inputs refusal (no attempt, no network): `externalOfferExecution.ts:372`.
6. Stored gate + **durable PREPARED attempt before network**: `createPreparedExecutionAttempt` (`m8AuthorityCommands.ts:548`) via `externalOfferExecution.ts:383` (re-derives authority, currentness, assessments CURRENT, HELD budget, DAG, blocking attempts).
7. Claim + **DISPATCHING committed before dispatcher runs**: `pgExecutionWorker.ts:109 claimPrepared`, `dispatchClaimed:176` (`to: 'DISPATCHING'` `:250`, dispatcher `:258`; a thrown error or lost response becomes OUTCOME_UNKNOWN, never retried).
8. Atlas sandbox dispatcher (the **only** mutation site, enforced by `test/r4-offer-execution-boundary.test.ts`): `externalOfferExecution.ts:142 buildAtlasOfferDispatcher` — verify (read) `:156`, `createOrder` `:163`, ceiling gate (payable vs authority-frozen intent cost), `payOrder` `:194`, read-only ticketing observation.
9. Classification: SUCCESS -> OBSERVED_SUCCESS + observation row (`external_record_id` = stable uuid of the order, raw ref in `source_owned_fields.providerOrderRef`); FAILURE -> OBSERVED_FAILURE; TIMEOUT/ticketing not yet observed -> OUTCOME_UNKNOWN with `request_ref = atlas:order:<ref>`.
10. Reconcile before retry: `runExternalReconciliation:419` -> `claimForReconciliation` (`pgExecutionWorker.ts:136`) -> `reconcileUnknown:341` with `buildAtlasReconcileLookup:223` (read-only `retrieveOrder`; no order ref => `STILL_UNKNOWN`, human-owned). Candidate query excludes any intent with a non-PREPARED attempt, so **there is no redispatch path at all**.
11. Canonical update: `applyCanonicalSelection:254` (source+evidence, transport service, CONFIRMED reservation+line+allocation, `updateJourneyItem.selectedServiceId`), idempotent, no provider call, re-run by `applyPendingCanonicalUpdates` until it lands.
12. Reassessment: M6 triggers on the mutated aggregates -> reassessment worker -> C4 `runRecoveryProgressionPass` resolves from CURRENT PASS.
13. Boot: `composeTargetBoot.ts:275` periodic `externalExecution` service; `afterApproval` (`:324`) runs it now; runs after every reassessment drain.

## Evidence

Focused (real PostgreSQL, scripted provider counting every call): `postgres-integration/r4AtlasOfferExecution.pgtest.ts` — 6/6.

* preflight refuses with explicit reasons (not composed / no identity / no email / no budget); read-model blocker uses the same probe; no plan, decision or attempt is created.
* happy path: approve -> DEFERRED while world reassessing -> durable `DISPATCHING` observed at both mutations -> exactly 1 `createOrder` + 1 `payOrder` -> observed -> CONFIRMED reservation + new selected service -> repeated passes do nothing -> reassessed PASS -> case RESOLVED.
* PRICE_CHANGED at verify -> OBSERVED_FAILURE, zero mutations, no retry, state unchanged, case unresolved.
* payable above ceiling -> order created, pay never issued.
* lost create response -> OUTCOME_UNKNOWN, 3 further passes make no call, reconcile without order ref stays unknown.
* lost pay response -> OUTCOME_UNKNOWN with order ref; reconcile PAID -> still unknown; reconcile TICKETED -> success + canonical update; reconcilers never mutate.

Real sandbox (`R4_ATLAS_SANDBOX=1 R4_ATLAS_DAY_OFFSET=47 npx tsx --test postgres-integration/r4AtlasSandboxLive.pgtest.ts`, mode RECORD, credentials from `.env.local`, none printed):

* Run A: search+verify passed; `order.do` -> provider status **323 (invalid contact email)** -> classified OBSERVED_FAILURE, no retry. Led to migration 0129.
* Run B (fresh order `TESTA20260919220034032`, USD 26.60): gate -> durable attempt -> real `order.do` + `pay.do` -> ticketing is asynchronous (~80 s) -> **OUTCOME_UNKNOWN** with the order ref persisted -> 9 read-only reconciliation lookups -> provider observed **TICKETED** -> OBSERVED_SUCCESS -> canonical update -> reassessed PASS -> case **RESOLVED**. Exactly one order per approved intent. Sanitized results recorded under `recordings/atlas/{search,verify,order_create,order_pay,order_retrieve}`.
* Run C (same day offset 45 rerun): Atlas duplicate detection (status 318) adopted the already-ticketed order `TESTA20260919215632741`; the adapter's pre-pay check short-circuited — no second charge. (Provider-native idempotency, kept as recorded evidence.)

## Remaining gaps (honest)

1. **Operator entry surface** for `traveller_booking_identities` (gender/email/DOB/nationality) does not exist; today it is populated by an operator/seed write (`recordTravellerBookingIdentity`). Without it the option is truthfully blocked (`CONTACT_EMAIL_MISSING` / `BOOKING_IDENTITY_MISSING`).
2. **UI**: `RecoveryStrategyView.executionBlocker` is populated by `serveCase`, but `caseWorkspacePresenter.ts` (owned by `r4f/f1-ui-language`) still computes `approvable` without it. Required one-liner there: `approvable = ... && !strategy.executionBlocker` and use `strategy.executionBlocker.message` as the `approverLine` reason. Until then a click is refused server-side with the explicit reason (HTTP 409).
3. Offer freshness: Atlas routing identifiers expire; approval hours after research will verify as `offer_unavailable`/`PRICE_CHANGED` -> honest OBSERVED_FAILURE requiring fresh research + re-approval.
4. Execution `flight` adapter is a separate instance from the research adapter, so verify does not carry the per-offer passenger count (single passenger proven; multi-passenger pricing at verify unproven).
5. Multi-effect / multi-intent transport plans and cancellation of the displaced booking are not executed (the seam books the selected offer only).
6. The provider order number is not stored as a canonical `external_records` link (only in the durable observation `source_owned_fields` and `request_ref`).
7. Authority scope: `OFFER` and `JOURNEY_ITEM` are no longer independent exact-coverage requirements (JOURNEY still is); the offer/price stay bound by the envelope's `offerFingerprint` and `requestFingerprint`.
8. A costed intent's own budget hold advances the Budget aggregate the strategy read; `evaluateStoredExecutionGate` now explains exactly that (own HELD commitment + only `BUDGET_HOLD_CREATED` revisions), and execution DEFERS until reassessment settles.
