/**
 * Wave 3R Mission 1 / G3R-R1 — regression evidence for three transaction-
 * safety fixes found by an independent review of the provider-backed
 * execution path.
 *
 * Permanently pins:
 *  - R1-A1: a STAY element replacement is classified MONEY_MOVING (never
 *    REVERSIBLE), and `createProviderBackedExecutor` structurally refuses to
 *    call a provider when the intent's declared sideEffectLevel is below
 *    the operation's real side effect.
 *  - R1-A2: provider SUCCESS alone never promotes a strategy's candidate
 *    operations into confirmed trip state; only a result explicitly marked
 *    CONFIRMS_CANDIDATE_STATE (or the ADR-007 SIMULATED boundary) does.
 *  - R1-I1: a consequential payment/booking is refused when the intent
 *    carries no priceDelta, because authority never evaluated spend rules
 *    against an absent value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { capabilityError, capabilityOk, type CapabilityMeta, type CapabilityResult } from '../src/contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  FareRulesOutcome,
  FlightCancellationQuoteOutcome,
  FlightCancellationQuoteQuery,
  FlightCancellationStatusQuery,
  FlightCancellationStatusView,
  FlightCancellationSubmitOutcome,
  FlightCancellationSubmitQuery,
  FlightContactInput,
  FlightOrderCreateQuery,
  FlightOrderOutcome,
  FlightOrderPayQuery,
  FlightOrderRetrieveQuery,
  FlightOrderStatusView,
  FlightPassengerInput,
  FlightSearchOutcome,
  FlightSearchQuery,
  FlightTransactionCapability,
  FlightVerifyOutcome,
  FlightVerifyQuery,
  HotelActionOutcome,
  HotelActionQuery,
  HotelBookQuery,
  HotelBookingOutcome,
  HotelBookingStatusView,
  HotelCapability,
  HotelQuoteOutcome,
  HotelQuoteQuery,
  HotelRetrieveQuery,
  HotelSearchOutcome,
  HotelSearchQuery,
  StayContext,
  StayContextQuery,
} from '../src/contracts/capabilities.ts';
import {
  CONFIRMS_CANDIDATE_STATE,
  confirmsCandidateOperations,
  type ActionIntent,
  type AuthorisedExecution,
  type AuthorityDecision,
  type ExecutionResult,
} from '../src/operational/intent.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { MutationOperation } from '../src/operational/mutation.ts';
import type { ExecutorService, AuthorityContext } from '../src/contracts/services.ts';
import type { Money } from '../src/domain/common.ts';
import {
  createProviderBackedExecutor,
  insufficientSideEffectLevel,
  type HotelReplacementDossier,
} from '../src/app/providerExecution.ts';
import { consequentialOperationFor, createRecoveryExecutor } from '../src/app/recoveryExecution.ts';
import { DeterministicAuthorityEngine } from '../src/engine/authority.ts';

const AT = '2026-09-12T19:00:00+09:00';

// ---------------------------------------------------------------------------
// Shared scripted fakes (boundary-level; adapted from
// wave3r-dr2-provider-execution.test.ts's conventions — module-local there,
// so reproduced here rather than imported).
// ---------------------------------------------------------------------------

function meta(mode: 'LIVE' | 'REPLAY'): CapabilityMeta {
  return { providerId: 'test-provider', mode, requestedAt: AT };
}

function ok<T>(data: T, mode: 'LIVE' | 'REPLAY' = 'LIVE'): CapabilityResult<T> {
  return capabilityOk(data, meta(mode));
}

function capabilityErr<T>(code: string, category: 'TIMEOUT' | 'PROVIDER_ERROR' | 'UNAVAILABLE' = 'PROVIDER_ERROR'): CapabilityResult<T> {
  return capabilityError({ category, code, message: `structured failure ${code}` }, meta('LIVE'));
}

interface FakeFlightScript {
  verify?: CapabilityResult<FlightVerifyOutcome>;
  create?: CapabilityResult<FlightOrderOutcome>;
  pay?: CapabilityResult<FlightOrderOutcome>;
  retrieve?: Array<CapabilityResult<FlightOrderStatusView>>;
}

function fakeFlight(script: FakeFlightScript) {
  const calls = { verify: 0, create: 0, pay: 0, retrieve: 0, quote: 0, submit: 0, cancelStatus: 0 };

  const flight = {
    descriptor: {
      family: 'FLIGHT',
      providerId: 'test-provider',
      mode: 'LIVE',
      supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'],
      maxSideEffectLevel: 'READ_ONLY',
    } as CapabilityDescriptor,
    async searchFlights(_query: FlightSearchQuery): Promise<CapabilityResult<FlightSearchOutcome>> {
      return capabilityError({ category: 'UNAVAILABLE', code: 'not_used', message: 'unused' }, meta('LIVE'));
    },
    async verifyOffer(_query: FlightVerifyQuery): Promise<CapabilityResult<FlightVerifyOutcome>> {
      calls.verify += 1;
      return script.verify ?? ok({ status: 'VERIFIED', workflowState: { sessionId: 'sess-1' } });
    },
    async getFareRules(_query: FlightVerifyQuery): Promise<CapabilityResult<FareRulesOutcome>> {
      return capabilityError({ category: 'UNAVAILABLE', code: 'not_used', message: 'unused' }, meta('LIVE'));
    },
  };

  const flightTransactions: FlightTransactionCapability = {
    descriptor: {
      family: 'FLIGHT',
      providerId: 'test-provider',
      mode: 'LIVE',
      supportedOperations: [
        'flight.book',
        'flight.pay',
        'flight.order_status',
        'flight.cancel_quote',
        'flight.cancel_status',
        'flight.cancel',
      ],
      maxSideEffectLevel: 'MONEY_MOVING',
    },
    async createOrder(_query: FlightOrderCreateQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
      calls.create += 1;
      return script.create ?? capabilityErr('order_create_unscripted');
    },
    async payOrder(_query: FlightOrderPayQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
      calls.pay += 1;
      return script.pay ?? capabilityErr('order_pay_unscripted');
    },
    async retrieveOrder(_query: FlightOrderRetrieveQuery): Promise<CapabilityResult<FlightOrderStatusView>> {
      const index = calls.retrieve;
      calls.retrieve += 1;
      const sequence = script.retrieve ?? [];
      return sequence[Math.min(index, sequence.length - 1)] ?? capabilityErr('retrieve_unscripted');
    },
    async quoteCancellation(_query: FlightCancellationQuoteQuery): Promise<CapabilityResult<FlightCancellationQuoteOutcome>> {
      calls.quote += 1;
      return capabilityErr('quote_unscripted');
    },
    async submitCancellation(_query: FlightCancellationSubmitQuery): Promise<CapabilityResult<FlightCancellationSubmitOutcome>> {
      calls.submit += 1;
      return capabilityErr('submit_unscripted');
    },
    async retrieveCancellationStatus(
      _query: FlightCancellationStatusQuery,
    ): Promise<CapabilityResult<FlightCancellationStatusView>> {
      calls.cancelStatus += 1;
      return capabilityErr('cancel_status_unscripted');
    },
  };

  return { flight, flightTransactions, calls };
}

interface FakeHotelScript {
  quote?: CapabilityResult<HotelQuoteOutcome>;
  book?: CapabilityResult<HotelBookingOutcome>;
  retrieve?: Array<CapabilityResult<HotelBookingStatusView>>;
  cancel?: CapabilityResult<HotelActionOutcome>;
}

function fakeHotel(script: FakeHotelScript) {
  const calls = { quote: 0, book: 0, retrieve: 0, cancel: 0 };
  const hotel: HotelCapability = {
    descriptor: {
      family: 'HOTEL',
      providerId: 'test-hotel',
      mode: 'LIVE',
      supportedOperations: ['hotel.quote', 'hotel.book', 'hotel.retrieve', 'hotel.cancel'],
      maxSideEffectLevel: 'MONEY_MOVING',
    },
    async getStayContext(_q: StayContextQuery): Promise<CapabilityResult<StayContext>> {
      return capabilityError({ category: 'UNAVAILABLE', code: 'not_used', message: 'unused' }, meta('LIVE'));
    },
    async searchHotels(_q: HotelSearchQuery): Promise<CapabilityResult<HotelSearchOutcome>> {
      return capabilityError({ category: 'UNAVAILABLE', code: 'not_used', message: 'unused' }, meta('LIVE'));
    },
    async quoteRate(_q: HotelQuoteQuery): Promise<CapabilityResult<HotelQuoteOutcome>> {
      calls.quote += 1;
      return script.quote ?? capabilityErr('hotel_quote_unscripted');
    },
    async bookStay(_q: HotelBookQuery): Promise<CapabilityResult<HotelBookingOutcome>> {
      calls.book += 1;
      return script.book ?? capabilityErr('hotel_book_unscripted');
    },
    async retrieveBooking(_q: HotelRetrieveQuery): Promise<CapabilityResult<HotelBookingStatusView>> {
      const index = calls.retrieve;
      calls.retrieve += 1;
      const sequence = script.retrieve ?? [];
      return sequence[Math.min(index, sequence.length - 1)] ?? capabilityErr('hotel_retrieve_unscripted');
    },
    async modifyStay(_q: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
      return capabilityError({ category: 'UNAVAILABLE', code: 'not_used', message: 'unused' }, meta('LIVE'));
    },
    async cancelStay(_q: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
      calls.cancel += 1;
      return script.cancel ?? capabilityErr('hotel_cancel_unscripted');
    },
  };
  return { hotel, calls };
}

/** Records whether the ADR-007 simulation fallback was ever reached. */
function fallbackSpy(): { executor: ExecutorService; calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    executor: {
      async execute(execution: AuthorisedExecution): Promise<ExecutionResult> {
        state.calls += 1;
        return {
          id: `exec-fallback-${execution.intent.id}`,
          intentId: execution.intent.id,
          executedAt: AT,
          status: 'SUCCESS',
          provenance: 'SIMULATED',
          resultSummary: 'simulation fallback (should not be reached in these tests)',
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Intent / envelope helpers
// ---------------------------------------------------------------------------

const FLIGHT_DOSSIER = {
  passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01', gender: 'FEMALE' } as FlightPassengerInput],
  contact: { name: 'Traveller/Test' } as FlightContactInput,
  paymentRef: 'test-sandbox-balance',
};

const HOTEL_DOSSIER: HotelReplacementDossier = {
  replacementRateId: 'rate-1',
  guestNames: ['Test Traveller'],
  displacedBookingId: 'bk-old-1',
};

function flightIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: 'int_r1_flight',
    caseId: 'case_r1',
    strategyId: 'strat_r1',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: { bookingRefs: [{ system: 'flight-provider', reference: 'offer-1' }] },
    sideEffectLevel: 'MONEY_MOVING',
    // Mirrors wave3r-dr2-provider-execution.test.ts's flightIntent() default;
    // R1-I1 tests must explicitly omit priceDelta to exercise the new gate.
    priceDelta: { currency: 'USD', amount: 250 },
    evidenceRefs: [],
    status: 'AUTHORISED',
    createdAt: AT,
    ...overrides,
  };
}

function hotelIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return flightIntent({
    id: 'int_r1_hotel',
    operation: 'hotel.modify',
    capability: 'HOTEL',
    sideEffectLevel: 'MONEY_MOVING',
    parameters: {},
    ...overrides,
  });
}

function authorityFor(intent: ActionIntent): AuthorityDecision {
  return {
    id: `auth_${intent.id}`,
    intentId: intent.id,
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: [],
    conditions: [],
  };
}

function envelope(intent: ActionIntent): AuthorisedExecution {
  return { intent, authority: authorityFor(intent) };
}

function strategyWithCeiling(ceiling: Money | undefined): RecoveryStrategy {
  return {
    id: 'strat_r1',
    caseId: 'case_r1',
    summary: 'test strategy',
    candidateOperations: [],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    ...(ceiling ? { costImpact: ceiling } : {}),
    createdAt: AT,
  };
}

function heldCreate(totalPrice?: Money): CapabilityResult<FlightOrderOutcome> {
  return ok({
    status: 'HELD',
    transactionState: { orderRef: 'ord-1', providerRecordLocator: 'PNR001', holdExpiresAt: '2026-09-12T21:00:00+08:00' },
    ...(totalPrice ? { totalPrice } : {}),
    provenance: 'LIVE',
  });
}

function retrieveView(status: FlightOrderStatusView['status']): CapabilityResult<FlightOrderStatusView> {
  return ok({
    orderRef: 'ord-1',
    status,
    transactionState: { orderRef: 'ord-1', ...(status === 'TICKETED' ? { ticketRefs: ['tkt-1'] } : {}) },
    observedAt: AT,
    provenance: 'LIVE',
  });
}

function flightExecutor(script: FakeFlightScript, ceiling: Money | undefined) {
  const fakes = fakeFlight(script);
  const fallback = fallbackSpy();
  const executor = createProviderBackedExecutor({
    fallback: fallback.executor,
    mode: 'LIVE',
    strategyFor: async () => strategyWithCeiling(ceiling),
    flight: fakes.flight,
    flightTransactions: fakes.flightTransactions,
    flightDossier: () => FLIGHT_DOSSIER,
    ticketingPoll: { attempts: 2, delayMs: 1 },
    sleep: async () => undefined,
    now: () => AT,
  });
  return { executor, fakes, fallback };
}

function hotelExecutor(script: FakeHotelScript, ceiling: Money | undefined) {
  const fakes = fakeHotel(script);
  const fallback = fallbackSpy();
  const executor = createProviderBackedExecutor({
    fallback: fallback.executor,
    mode: 'LIVE',
    strategyFor: async () => strategyWithCeiling(ceiling),
    hotel: fakes.hotel,
    hotelDossier: () => HOTEL_DOSSIER,
    now: () => AT,
  });
  return { executor, fakes, fallback };
}

// ===========================================================================
// R1-A1 — STAY replacement is MONEY_MOVING; misclassified intents are
// structurally refused before any provider call.
// ===========================================================================

function stayUpsert(): MutationOperation {
  return {
    op: 'UPSERT_ENTITY',
    entityType: 'TRIP_ELEMENT',
    id: 'el_r1_stay',
    data: {
      elementKind: 'STAY',
      id: 'el_r1_stay',
      reservationState: 'PROPOSED',
      status: 'UNKNOWN',
    },
  };
}

test('R1-A1: a STAY element replacement classifies MONEY_MOVING, never REVERSIBLE', () => {
  const classified = consequentialOperationFor([stayUpsert()]);
  assert.equal(classified.operation, 'hotel.modify');
  assert.equal(classified.capability, 'HOTEL');
  assert.equal(classified.sideEffectLevel, 'MONEY_MOVING');
  assert.notEqual(classified.sideEffectLevel, 'REVERSIBLE', 'a chargeable stay replacement is not reversible');
});

test('R1-A1: the resulting hotel.modify intent is never AUTO_APPROVED under an empty rule set', async () => {
  // The actual safety property is not the label — it is what authority does
  // with it. An EMPTY rule set exercises only the default policy ladder
  // (DeterministicAuthorityEngine step 5): MONEY_MOVING must fall through to
  // REQUIRES_TRAVELLER, never auto-approve like REVERSIBLE would have.
  const classified = consequentialOperationFor([stayUpsert()]);
  const intent: ActionIntent = {
    id: 'int_r1_stay_classified',
    caseId: 'case_r1',
    operation: classified.operation,
    capability: classified.capability,
    parameters: {},
    sideEffectLevel: classified.sideEffectLevel,
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: AT,
  };
  const authority = new DeterministicAuthorityEngine({ ruleSets: { getRuleSet: async () => undefined } });
  const context: AuthorityContext = { tripId: 'trip_r1', caseId: 'case_r1', ruleSetIds: [], principals: [] };
  const decision = await authority.decide(intent, context);
  assert.notEqual(decision.outcome, 'AUTO_APPROVED', 'a chargeable stay replacement must reach the traveller');
  assert.equal(decision.outcome, 'REQUIRES_TRAVELLER');
});

test('R1-A1: insufficientSideEffectLevel unit table', () => {
  function withLevel(operation: ActionIntent['operation'], sideEffectLevel: ActionIntent['sideEffectLevel']): ActionIntent {
    return {
      id: 'int_r1_level',
      caseId: 'case_r1',
      operation,
      capability: 'FLIGHT',
      parameters: {},
      sideEffectLevel,
      evidenceRefs: [],
      status: 'AUTHORISED',
      createdAt: AT,
    };
  }
  // hotel.modify actually books + cancels at a provider: REVERSIBLE is
  // insufficient; MONEY_MOVING (its real level) is enough.
  assert.equal(insufficientSideEffectLevel(withLevel('hotel.modify', 'REVERSIBLE')), 'MONEY_MOVING');
  assert.equal(insufficientSideEffectLevel(withLevel('hotel.modify', 'MONEY_MOVING')), undefined);
  // flight.pay moves money: IRREVERSIBLE is insufficient.
  assert.equal(insufficientSideEffectLevel(withLevel('flight.pay', 'IRREVERSIBLE')), 'MONEY_MOVING');
  // flight.cancel is IRREVERSIBLE and nothing more; IRREVERSIBLE covers it.
  assert.equal(insufficientSideEffectLevel(withLevel('flight.cancel', 'IRREVERSIBLE')), undefined);
  // An operation with no provider path in this executor has no required
  // level to fall short of.
  assert.equal(insufficientSideEffectLevel(withLevel('simulation.provider_action', 'READ_ONLY')), undefined);
});

test('R1-A1: hotel.modify declared REVERSIBLE is refused before any provider call, and never falls back to simulation', async () => {
  const { executor, fakes, fallback } = hotelExecutor(
    {
      // Scripted as if everything would succeed, to prove the refusal
      // happens BEFORE any of these are ever consulted.
      quote: ok({ status: 'QUOTED', quoteId: 'quote-h1', quotedPrice: { currency: 'USD', amount: 180 } }),
      book: ok({ confirmed: true, bookingId: 'bk-new-1', totalPrice: { currency: 'USD', amount: 180 }, provenance: 'LIVE' }),
      cancel: ok({ confirmed: true, reference: 'cancel-ref-1', provenance: 'LIVE' }),
    },
    { currency: 'USD', amount: 500 },
  );
  const result = await executor.execute(envelope(hotelIntent({ sideEffectLevel: 'REVERSIBLE' })));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'side_effect_level_misclassified');
  // The whole point: zero provider calls of any kind.
  assert.equal(fakes.calls.quote, 0, 'no quote call');
  assert.equal(fakes.calls.book, 0, 'no book call');
  assert.equal(fakes.calls.cancel, 0, 'no cancel call');
  assert.equal(fakes.calls.retrieve, 0, 'no retrieve call');
  assert.equal(fallback.calls, 0, 'a misclassified intent fails loud, it does not quietly simulate');
});

// ===========================================================================
// R1-A2 — provider SUCCESS alone never confirms candidate state.
// ===========================================================================

function baseResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    id: 'exec_r1_a2',
    intentId: 'int_r1_a2',
    executedAt: AT,
    status: 'SUCCESS',
    provenance: 'SIMULATED',
    ...overrides,
  };
}

test('R1-A2: confirmsCandidateOperations unit table', () => {
  assert.equal(confirmsCandidateOperations(baseResult({ provenance: 'SIMULATED', status: 'SUCCESS' })), true);
  assert.equal(
    confirmsCandidateOperations(baseResult({ provenance: 'LIVE', status: 'SUCCESS' })),
    false,
    'LIVE success without the marker (e.g. a flight.book hold) must not confirm',
  );
  assert.equal(
    confirmsCandidateOperations(
      baseResult({ provenance: 'LIVE', status: 'SUCCESS', observedEffects: { [CONFIRMS_CANDIDATE_STATE]: true } }),
    ),
    true,
  );
  for (const status of ['FAILURE', 'TIMEOUT', 'UNAVAILABLE'] as const) {
    assert.equal(
      confirmsCandidateOperations(baseResult({ provenance: 'SIMULATED', status })),
      false,
      `${status} must never confirm regardless of provenance`,
    );
    assert.equal(
      confirmsCandidateOperations(
        baseResult({ provenance: 'LIVE', status, observedEffects: { [CONFIRMS_CANDIDATE_STATE]: true } }),
      ),
      false,
      `${status} must never confirm even when the marker is present`,
    );
  }
});

/** A strategy carrying one candidate TRIP_ELEMENT upsert, so the gate has something to (not) inject. */
function strategyWithCandidateElement(): RecoveryStrategy {
  return {
    id: 'strat_r1_a2',
    caseId: 'case_r1',
    summary: 'candidate replacement stay',
    candidateOperations: [stayUpsert()],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    createdAt: AT,
  };
}

function innerReturning(result: ExecutionResult): ExecutorService {
  return { execute: async () => result };
}

test('R1-A2: a LIVE SUCCESS without the marker (a flight.book hold) never injects candidate operations', async () => {
  const holdResult: ExecutionResult = {
    id: 'exec_r1_hold',
    intentId: 'int_r1_a2',
    executedAt: AT,
    status: 'SUCCESS',
    provenance: 'LIVE',
    observedEffects: { orderStatus: 'HELD', holdOnly: true },
  };
  const wrapped = createRecoveryExecutor({
    inner: innerReturning(holdResult),
    strategyFor: async () => strategyWithCandidateElement(),
  });
  const result = await wrapped.execute(envelope(flightIntent({ id: 'int_r1_a2', operation: 'flight.book' })));
  // Gate not passed: the wrapper returns the inner result completely
  // untouched — no operations key was added.
  assert.equal(result, holdResult);
  assert.equal(result.observedEffects?.['operations'], undefined, 'candidate operations must NOT be injected on a hold');
});

test('R1-A2: a LIVE SUCCESS carrying the marker injects and confirms candidate operations', async () => {
  const ticketedResult: ExecutionResult = {
    id: 'exec_r1_ticketed',
    intentId: 'int_r1_a2',
    executedAt: AT,
    status: 'SUCCESS',
    provenance: 'LIVE',
    observedEffects: { orderStatus: 'TICKETED', [CONFIRMS_CANDIDATE_STATE]: true },
  };
  const wrapped = createRecoveryExecutor({
    inner: innerReturning(ticketedResult),
    strategyFor: async () => strategyWithCandidateElement(),
  });
  const result = await wrapped.execute(envelope(flightIntent({ id: 'int_r1_a2', operation: 'flight.book' })));
  const operations = result.observedEffects?.['operations'] as MutationOperation[] | undefined;
  assert.ok(operations, 'a terminal (ticketed) result must inject the candidate operations');
  assert.equal(operations.length, 1);
  const upserted = operations[0]!;
  assert.equal(upserted.op, 'UPSERT_ENTITY');
  assert.ok(upserted.op === 'UPSERT_ENTITY');
  const data = upserted.data as Record<string, unknown>;
  assert.equal(data['reservationState'], 'CONFIRMED');
  assert.equal(data['status'], 'VALID');
});

test('R1-A2: ADR-007 regression guard — a SIMULATED success without the marker still confirms candidate operations', async () => {
  const simulatedResult: ExecutionResult = {
    id: 'exec_r1_simulated',
    intentId: 'int_r1_a2',
    executedAt: AT,
    status: 'SUCCESS',
    provenance: 'SIMULATED',
    resultSummary: 'boundary simulation',
  };
  const wrapped = createRecoveryExecutor({
    inner: innerReturning(simulatedResult),
    strategyFor: async () => strategyWithCandidateElement(),
  });
  const result = await wrapped.execute(envelope(flightIntent({ id: 'int_r1_a2', operation: 'flight.book' })));
  const operations = result.observedEffects?.['operations'] as MutationOperation[] | undefined;
  assert.ok(operations, 'the historic ADR-007 simulation boundary behaviour must not regress');
  assert.equal(operations.length, 1);
});

// ===========================================================================
// R1-I1 — a consequential payment/booking is refused when authority reviewed
// no spend at all (intent.priceDelta absent).
// ===========================================================================

test('R1-I1: flight.change with priceDelta absent refuses payment before any pay call', async () => {
  const { executor, fakes } = flightExecutor(
    { create: heldCreate({ currency: 'USD', amount: 200 }) },
    { currency: 'USD', amount: 250 }, // a ceiling that would otherwise pass
  );
  const intent = flightIntent({ priceDelta: undefined });
  const result = await executor.execute(envelope(intent));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'authority_reviewed_no_spend');
  assert.equal(fakes.calls.pay, 0, 'payOrder must never be called when authority reviewed no spend');
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal(effects['orderStatus'], 'HELD', 'the hold remains observable for re-entry');
});

test('R1-I1: flight.change with priceDelta present proceeds past the spend-reviewed gate', async () => {
  const { executor, fakes } = flightExecutor(
    {
      create: heldCreate({ currency: 'USD', amount: 200 }),
      pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-1' }, provenance: 'LIVE' }),
      retrieve: [retrieveView('TICKETED')],
    },
    { currency: 'USD', amount: 250 },
  );
  // Same intent shape as the refused case above, but WITH priceDelta —
  // proving the new gate is not simply blocking every payment outright.
  const intent = flightIntent({ priceDelta: { currency: 'USD', amount: 40 } });
  const result = await executor.execute(envelope(intent));
  assert.notEqual(result.error?.code, 'authority_reviewed_no_spend');
  assert.equal(result.status, 'SUCCESS');
  assert.equal(fakes.calls.pay, 1, 'payOrder was reached and called exactly once');
});

test('R1-I1: hotel.modify with priceDelta absent refuses booking before any bookStay call', async () => {
  const { executor, fakes } = hotelExecutor(
    { quote: ok({ status: 'QUOTED', quoteId: 'quote-h1', quotedPrice: { currency: 'USD', amount: 180 } }) },
    { currency: 'USD', amount: 500 }, // a ceiling that would otherwise pass
  );
  const intent = hotelIntent({ priceDelta: undefined });
  const result = await executor.execute(envelope(intent));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'authority_reviewed_no_spend');
  assert.equal(fakes.calls.book, 0, 'bookStay must never be called when authority reviewed no spend');
  assert.equal(fakes.calls.quote, 1, 'the quote itself is read-only and still runs');
});
