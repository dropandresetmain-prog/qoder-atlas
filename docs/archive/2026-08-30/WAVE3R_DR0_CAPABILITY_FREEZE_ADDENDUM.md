# Wave 3R — DR-0 Capability Freeze Addendum

**Status:** G3R-R0 ACCEPTED — independent review accepted the contract-freeze base at SHA `0c2f782ffbaf4fc569ab09f8ccad22e52c537516` (published as `origin/g3r-r0-fix`); see ADR-042..044 in `docs/DECISIONS.md` and `test/wave3r-contracts.test.ts`. Downstream DR-1/DR-2 (Wave 3R Mission 1) consume the frozen seam.  
**Date:** 24 Aug 2026  
**Parent execution contract:** `docs/WAVE3R_DEMO_READINESS_PLAN.md`  
**Evidence authority:** `docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md`  

> This is a narrow addendum to the Wave 3R execution plan, not a second roadmap. It supersedes only stale Atlas capability assumptions in Sections 6.1, 7, DR-0, DR-2, DR-9 and Section 19 of `WAVE3R_DEMO_READINESS_PLAN.md`. Accepted Checkpoints A/B/C, RV-N0, NS-G1, NS-G2 and the generalized domain/authority architecture remain unchanged. Shared executable contracts are **not** changed by this document; G3R-R0 must review and freeze any contract delta before implementation.

---

## 1. DR-0 final state

DR-0 is **PASS / capability investigation complete**.

Do not reopen broad Atlas capability discovery before Wave 3R implementation. The remaining Atlas research is scenario-selection sampling only, not architecture discovery.

The latest evidence materially changes two earlier assumptions:

1. the real sandbox search graph is much larger than the published Sandbox Test Routes page suggests;
2. Atlas sandbox **refund** and Atlas **cancellation/void** are distinct capabilities and must not be collapsed into one unsupported after-sales bucket.

---

## 2. Atlas sandbox coverage — planning truth

A broad empirical sweep covered **67 directional routes** and observed:

- **52 populated routes** (~78%);
- **28 distinct airlines**;
- **808 offers**.

The published 9-airline / 36-route test-page inventory is therefore **not an authoritative upper bound on the sandbox database** and must no longer constrain scenario design.

The observed network is strongest across Southeast and Northeast Asia, with thinner reach into the Middle East, Europe and the Americas. No legacy/full-service long-haul carrier appeared in the sweep.

### Planning decisions

- **Singapore remains the canonical summit location.** It is inside the well-populated sandbox core rather than an edge case.
- Demo/scenario research may use the broader empirically observed network, not only the published route table.
- **Directionality remains a hard caveat:** route population is not symmetric. Before DR-9 freezes any exact hero leg, probe the exact origin -> destination direction needed by that scenario.
- Provider coverage may shape fixture/scenario choices. It must never create route/carrier-specific branches in `src/**`.

---

## 3. Atlas forward transaction capability — proven

For this sandbox account, the following forward lifecycle is empirically proven:

`search -> verify -> create order -> sandbox/test-balance payment -> ticketed Atlas sandbox state -> retrieve/order status`

No real card data or production payment is involved.

This is sufficient to justify a provider-neutral forward flight transaction seam in Wave 3R, behind the existing deterministic authority/executor boundary.

Do not describe an Atlas sandbox ticket as a real airline-issued production ticket. It is genuine provider sandbox execution and provider-observed state.

---

## 4. Refund and cancellation are separate capabilities

### 4.1 Refund — excluded from the Wave 3R executable Atlas path

`refundQuotation.do` / `refund.do` failed consistently across two independent paid/ticketed sandbox bookings on unrelated carriers. The DR-0 report records the provider/sandbox explanation and repeated evidence.

Wave 3R decision:

- do **not** rely on Atlas refund execution for any demo claim;
- do **not** spend more critical-path time trying alternate refund request shapes;
- any demo step specifically requiring a provider refund remains `SIMULATED` / unsupported at the Atlas sandbox boundary and must be labelled honestly;
- do not add a new Atlas-backed refund executor merely to satisfy the demo.

This does not prevent the domain from representing refund rules/cost consequences or a future production provider from implementing refund capability.

### 4.2 Cancellation / void — real for supported carriers

Atlas cancellation is a separate `void` lifecycle.

Empirical evidence now includes both sides of the capability:

- **Volaris:** `voidQuotation.do` succeeded with an actual voidability decision/window and estimated return amount; `void.do` succeeded and returned an Atlas processing record; `queryVoidOrders.do` returned the submitted cancellation state.
- **Malindo/Batik Air:** void failed with a specific carrier/route support result (`843`), demonstrating that cancellation availability is provider/carrier dependent rather than globally unavailable.

Wave 3R decision:

> Provider-backed flight cancellation is **ADOPT NOW** as a generic capability. Unsupported-carrier/route results are normal structured capability outcomes, not application crashes and not reasons for scenario-specific branching.

A cancellation submission is not considered complete merely because Atlas accepted the request. Northstar must observe the provider cancellation state and must not declare recovery from submission success alone.

---

## 5. G3R-R0 contract-freeze implications

DR-0 has proven a genuine shared-contract gap. G3R-R0 is mandatory before DR-2.

The reviewer/architect must freeze the smallest provider-neutral flight transaction surface necessary to express the proven lifecycle without leaking Atlas endpoint names.

At minimum the design must cover these semantic stages:

### Forward booking

- create/hold a verified flight order;
- pay/fulfil using a provider-opaque approved payment reference or provider test-balance mechanism — never PAN/CVV/raw card credentials;
- retrieve/observe order/ticketing status.

### Cancellation

Cancellation must preserve the distinction between **pre-action quote/eligibility** and **irreversible submission**:

1. cancellation eligibility/quote — maps to Atlas `voidQuotation.do` in this adapter;
2. authorised cancellation submission — maps to Atlas `void.do`;
3. cancellation status/reconciliation — maps to Atlas `queryVoidOrders.do`.

The exact provider-neutral method/type names are a G3R-R0 decision, not frozen by this addendum.

The contract must make enough structured information available before authority evaluation to reason deterministically about, where provided:

- whether cancellation is supported/voidable;
- cancellation/void window or deadline;
- expected returned amount / cancellation financial consequence;
- provider limitations/conditions;
- current provider order state.

The cancellation action itself remains consequential and must pass the existing authority/execution gate. Adapter-private support tables or provider status codes must not become domain branches.

### Refund

Do not expand the Wave 3R executable Atlas contract around refund. Existing read-only fare/refund-rule reasoning may remain. Production refund execution is Deferred unless another proven provider later justifies it.

### Existing operation vocabulary

Before adding new operation enum values, inspect the existing `CapabilityOperationSchema` (which already contains `flight.cancel` and `flight.refund_quote`) and reuse/extend it deliberately. Do not create duplicate concepts simply because the provider uses the word `void`.

### Payment safety

G3R-R0 must decide whether create-order and payment are represented as distinct `ActionIntent`s or as an executor-managed sequence. The decision must preserve the invariant that the money-moving/fulfilment step cannot occur without deterministic authority over the verified final price and applicable payer allocation.

### Observation safety

For both ticketing and cancellation:

`provider accepted request != desired state achieved != trip recovered`

Observation/retrieval is mandatory before authoritative provider-result mutation, and whole-trip verification remains mandatory before a `RecoveryCase` resolves.

---

## 6. DR-2 scope correction

DR-2 must now implement, after G3R-R0 freeze:

- provider-neutral forward flight transaction semantics proven by DR-0;
- Atlas mapping for create/order, sandbox-safe payment/fulfilment, and retrieval;
- provider-neutral cancellation quote/eligibility, cancellation submission and status/reconciliation semantics as frozen by G3R-R0;
- Atlas `void` mapping for supported carriers;
- structured `UNSUPPORTED` / unavailable outcome for non-void-supported carrier/routes;
- truthful LIVE / REPLAY / SIMULATED provenance;
- authority enforcement, idempotency and ambiguous-result reconciliation;
- provider observation before authoritative result mutation;
- existing Nuitée safe replacement orchestration and partial-failure handling.

DR-2 must **not**:

- implement Atlas refund execution as if it were proven;
- hardcode Volaris, Malindo/Batik or any other carrier into domain/application decision logic;
- assume the carrier used in the synthetic hero fixture must be the same carrier used for independent capability proof;
- claim a cancellation is complete while provider status is still pending/processing.

G3R-R1 Transaction Safety Review must explicitly inspect the new cancellation path.

---

## 7. DR-9 scenario-selection correction

DR-9 may assume:

- Singapore as the canonical summit location;
- broad sandbox coverage beyond the published 9-airline/36-route page;
- exact route population must still be checked directionally;
- forward booking is proven;
- Atlas cancellation/void is real but carrier dependent;
- Atlas refund is not a Wave 3R executable capability.

Before locking an exact hero carrier for any scenario that wants **provider-executed Atlas cancellation**, run a small bounded LOCAL sampling pass against additional likely void-supported carriers/routes. Candidate examples from current provider evidence/documentation include Frontier, Wizz Air, Jeju Air and Norwegian. Do not perform another broad sweep.

The purpose of this sampling is only to obtain more than one proven void-capable option and, if possible, find a route topology that aligns naturally with the canonical Singapore/event story.

If the strongest Singapore hero fixture uses a carrier/route without sandbox void support, it remains valid to:

- use synthetic coherent hero data through the real generalized pipeline;
- label that exact cancellation boundary as simulated/unsupported where necessary;
- separately retain empirical provider evidence proving the generic cancellation capability on a different Atlas sandbox route/carrier.

The application must never branch on the scenario carrier to make this work.

---

## 8. Demo-claim correction

Allowed claim pattern:

> Atlas sandbox Search/Verify/order/payment/ticketing were exercised through the real provider sandbox, and Atlas cancellation/void was also exercised successfully on a supported carrier. The hero programme data may be synthetic where needed to keep the scenario coherent.

Do not claim:

- Atlas refund was successfully executed in sandbox;
- every Atlas carrier supports cancellation/void;
- the published 9-airline/36-route page represents the full sandbox dataset;
- a synthetic hero booking was literally cancelled by Atlas unless that exact booking was used for the provider action.

---

## 9. Updated decision state

### WHAT WE KNOW

- DR-0 is accepted as PASS.
- Atlas sandbox coverage is materially larger than the published test-route page: 28 carriers / 52 populated directional routes / 808 observed offers in the 67-route sweep.
- Singapore is a strong, provider-supported canonical summit location.
- Atlas forward order/payment/ticketing is proven in sandbox.
- Atlas cancellation via the void lifecycle is proven in sandbox for a supported carrier and explicitly unsupported for at least one other carrier.
- Atlas refund execution is not available for the Wave 3R sandbox path and should not be relied on.
- Nuitée replacement/cancellation observability is sufficient for safe hotel orchestration.
- Model Studio LIVE works on the international endpoint; one small schema-field prompt correction remains before product extraction depends on it. **Status triage (24 Aug 2026): ACT NOW IN MISSION 2** — the fix is deliberately NOT part of Wave 3R Mission 1 (runtime truth + provider execution) and must not be silently forgotten there.
- Google Routes LIVE is available.

### WHAT WE DO NOT KNOW

- which additional void-supported Atlas carriers/routes are most useful for the final Singapore-centred hero scenario;
- whether an actual Atlas-originated schedule-change webhook can be induced in sandbox;
- the exact provider-neutral transaction/cancellation type design until G3R-R0 freezes it.

### KEY ASSUMPTION

The domain remains provider-neutral. Atlas `void` is one adapter implementation of generic flight cancellation, not a new domain concept. Scenario data can be selected around proven provider capability without introducing scenario/carrier-specific product logic.

### WHAT TO TEST NEXT

**G3R-R0 — Capability / Architecture Contract Freeze.** Review the empirical DR-0 evidence, freeze the smallest generic forward-flight + cancellation + observation contract, preserve authority/idempotency/observation invariants, record the architecture decision, and stop before DR-2 implementation.

**G3R-R0 CANDIDATE COMPLETE (24 Aug 2026).** The contract-freeze candidate is committed on this branch: `FlightTransactionCapability` (create/pay/retrieve + cancel quote/submit/status) and `ExternalProviderEventEnvelopeSchema`/`ExternalFlightEventNormalizer` in `src/contracts/capabilities.ts`; vocabulary additions `flight.book`, `flight.pay`, `flight.order_status`, `flight.cancel_quote`, `flight.cancel_status` in `src/operational/intent.ts`; read-only subset and planner-prompt updates in `src/operational/strategy.ts`, `src/app/dispatch.ts`, `src/intelligence/planner.ts`; invariant tests in `test/wave3r-contracts.test.ts`; decisions recorded as ADR-042..044. Hotel decision (Decision 10) CONFIRMED: no new hotel contract needed (ADR-041 unchanged). Independent G3R-R0 review runs before DR-1/DR-2 consume the seam.
