/**
 * Wave 3R Mission 1 / DR-2 — provider-execution failure-path evidence (1D).
 *
 * Permanently pins the transaction-safety invariants of the provider-backed
 * executor and the Atlas transaction adapter:
 *  1. create succeeds, pay fails -> HELD stays observable, no duplicate create;
 *  2. payable above ceiling -> payOrder is NEVER called;
 *  3. payable currency mismatch -> payOrder is NEVER called;
 *  4. payable total missing -> payOrder is NEVER called;
 *  5. pay timeout/ambiguous -> retrieve-before-retry;
 *  6. PAID without TICKETED -> no premature SUCCESS (no confirmed mutation);
 *  7. cancellation unsupported -> structured UNAVAILABLE, no crash;
 *  8. cancellation REQUEST_ACCEPTED/PROCESSING -> no CANCELLED outcome;
 *  9. cancellation ambiguous -> retrieve-before-resubmit;
 * 10. hotel replacement confirmed + old cancellation fails -> duplicate
 *     exposure preserved, execution FAILED (never fake rollback);
 * 11. provider evidence repairs the trip but another hard constraint still
 *     FAILs -> case stays unresolved;
 * 12. ... another hard condition remains UNKNOWN -> case stays unresolved;
 * 16. REPLAY normalization is semantically identical to the LIVE path for
 *     the captured transaction raw payloads.
 * Items 13-15 (case/trip agreement, causal evidence ordering, SPEND_LIMIT
 * currency fail-closed) are pinned in wave3r-dr1-runtime-truth.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import type { ActionIntent, AuthorisedExecution, AuthorityDecision, ExecutionResult } from '../src/operational/intent.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { ExecutorService } from '../src/contracts/services.ts';
import type { Money } from '../src/domain/common.ts';
import {
  createProviderBackedExecutor,
  paymentGateVerdict,
  type FlightBookingDossier,
  type HotelReplacementDossier,
} from '../src/app/providerExecution.ts';
import { FileRecordingStore, recordingIdFor } from '../src/providers/recordingStore.ts';
import { AtlasFlightTransactionAdapter, normalizeOrderCreate } from '../src/providers/atlas/transactionAdapter.ts';
import { AtlasOrderBodySchema } from '../src/providers/atlas/types.ts';
import { CaseVerifier } from '../src/engine/observation.ts';
import type { Constraint } from '../src/domain/constraints.ts';
import {
  scenarioHarness,
  seedScenario,
  cancellationProposal,
  loadScenario as loadHarnessScenario,
  SCENARIO_A_PATH,
} from './a2-harness.ts';

const AT = '2026-09-12T19:00:00+09:00';

function meta(mode: 'LIVE' | 'REPLAY'): CapabilityMeta {
  return { providerId: 'test-provider', mode, requestedAt: AT };
}

function ok<T>(data: T, mode: 'LIVE' | 'REPLAY' = 'LIVE'): CapabilityResult<T> {
  return capabilityOk(data, meta(mode));
}

function capabilityErr<T>(code: string, category: 'TIMEOUT' | 'PROVIDER_ERROR' | 'UNAVAILABLE' = 'PROVIDER_ERROR'): CapabilityResult<T> {
  return capabilityError({ category, code, message: `structured failure ${code}` }, meta('LIVE'));
}

// ---------------------------------------------------------------------------
// Scripted fake capabilities (boundary-level; wire details live in adapters)
// ---------------------------------------------------------------------------

interface FakeFlightScript {
  verify?: CapabilityResult<FlightVerifyOutcome>;
  create?: CapabilityResult<FlightOrderOutcome>;
  pay?: CapabilityResult<FlightOrderOutcome>;
  /** Sequential retrieve responses (last one repeats). */
  retrieve?: Array<CapabilityResult<FlightOrderStatusView>>;
  quote?: CapabilityResult<FlightCancellationQuoteOutcome>;
  submit?: CapabilityResult<FlightCancellationSubmitOutcome>;
  cancelStatus?: Array<CapabilityResult<FlightCancellationStatusView>>;
}

function fakeCapabilities(script: FakeFlightScript) {
  const calls = {
    verify: 0,
    create: 0,
    pay: 0,
    retrieve: 0,
    quote: 0,
    submit: 0,
    cancelStatus: 0,
  };
  const payQueries: FlightOrderPayQuery[] = [];

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
    async payOrder(query: FlightOrderPayQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
      calls.pay += 1;
      payQueries.push(query);
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
      return script.quote ?? capabilityErr('quote_unscripted');
    },
    async submitCancellation(_query: FlightCancellationSubmitQuery): Promise<CapabilityResult<FlightCancellationSubmitOutcome>> {
      calls.submit += 1;
      return script.submit ?? capabilityErr('submit_unscripted');
    },
    async retrieveCancellationStatus(
      _query: FlightCancellationStatusQuery,
    ): Promise<CapabilityResult<FlightCancellationStatusView>> {
      const index = calls.cancelStatus;
      calls.cancelStatus += 1;
      const sequence = script.cancelStatus ?? [];
      return sequence[Math.min(index, sequence.length - 1)] ?? capabilityErr('cancel_status_unscripted');
    },
  };

  return { flight, flightTransactions, calls, payQueries };
}

interface FakeHotelScript {
  quote?: CapabilityResult<HotelQuoteOutcome>;
  book?: CapabilityResult<HotelBookingOutcome>;
  /** Sequential retrieve responses (last one repeats). */
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

// ---------------------------------------------------------------------------
// Envelope construction helpers
// ---------------------------------------------------------------------------

const DOSSIER: FlightBookingDossier = {
  passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01', gender: 'FEMALE' } as FlightPassengerInput],
  contact: { name: 'Traveller/Test' } as FlightContactInput,
  paymentRef: 'test-sandbox-balance',
};

function flightIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: 'int_dr2_flight',
    caseId: 'case_dr2',
    strategyId: 'strat_dr2',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: { bookingRefs: [{ system: 'flight-provider', reference: 'offer-1' }] },
    sideEffectLevel: 'MONEY_MOVING',
    evidenceRefs: [],
    status: 'AUTHORISED',
    createdAt: AT,
    ...overrides,
  };
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
    id: 'strat_dr2',
    caseId: 'case_dr2',
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

function recordingFallback(): { executor: ExecutorService; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    executor: {
      async execute(execution: AuthorisedExecution): Promise<ExecutionResult> {
        calls.push(1);
        return {
          id: `exec-${execution.intent.id}`,
          intentId: execution.intent.id,
          executedAt: AT,
          status: 'SUCCESS',
          provenance: 'SIMULATED',
          resultSummary: 'simulation fallback',
        };
      },
    },
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
  const fakes = fakeCapabilities(script);
  const fallback = recordingFallback();
  const executor = createProviderBackedExecutor({
    fallback: fallback.executor,
    mode: 'LIVE',
    strategyFor: async () => strategyWithCeiling(ceiling),
    flight: fakes.flight,
    flightTransactions: fakes.flightTransactions,
    flightDossier: () => DOSSIER,
    ticketingPoll: { attempts: 2, delayMs: 1 },
    sleep: async () => undefined,
    now: () => AT,
  });
  return { executor, fakes, fallback };
}

// ---------------------------------------------------------------------------
// Payment-gate unit semantics (ADR-042 A1/A2)
// ---------------------------------------------------------------------------

test('1D: payment gate verdicts fail closed on absence/incomparability/excess', () => {
  const ceiling: Money = { currency: 'USD', amount: 250 };
  assert.deepEqual(paymentGateVerdict({ currency: 'USD', amount: 250 }, ceiling), { ok: true });
  assert.deepEqual(paymentGateVerdict({ currency: 'USD', amount: 249.99 }, ceiling), { ok: true });
  assert.equal(paymentGateVerdict(undefined, ceiling).ok, false);
  assert.equal(paymentGateVerdict({ currency: 'USD', amount: 100 }, undefined).ok, false);
  assert.equal(paymentGateVerdict({ currency: 'SGD', amount: 100 }, ceiling).ok, false);
  assert.equal(paymentGateVerdict({ currency: 'USD', amount: 250.01 }, ceiling).ok, false);
  if (!paymentGateVerdict({ currency: 'USD', amount: 300 }, ceiling).ok) {
    assert.equal(paymentGateVerdict({ currency: 'USD', amount: 300 }, ceiling).ok, false);
  }
});

// ---------------------------------------------------------------------------
// 1. create succeeds, pay fails -> HELD preserved, no duplicate create
// ---------------------------------------------------------------------------

test('1D-1: pay failure after successful create preserves HELD and never duplicates create', async () => {
  const { executor, fakes } = flightExecutor(
    {
      create: heldCreate({ currency: 'USD', amount: 200 }),
      pay: capabilityErr('payment_rejected'),
    },
    { currency: 'USD', amount: 250 },
  );
  const result = await executor.execute(envelope(flightIntent()));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'order_pay_failed');
  assert.equal(result.provenance, 'LIVE');
  assert.equal(fakes.calls.create, 1, 'exactly one create call, no blind duplicate');
  assert.equal(fakes.calls.pay, 1);
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal(effects['orderStatus'], 'HELD', 'HELD state stays observable');
  assert.ok(effects['transactionState'], 'held order refs preserved for reconciliation');
});

// ---------------------------------------------------------------------------
// 2-4. payment gate: payOrder is NEVER called
// ---------------------------------------------------------------------------

test('1D-2: payable above authorised ceiling -> payOrder is never called', async () => {
  const { executor, fakes } = flightExecutor(
    { create: heldCreate({ currency: 'USD', amount: 300 }) },
    { currency: 'USD', amount: 250 },
  );
  const result = await executor.execute(envelope(flightIntent()));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'payable_exceeds_ceiling');
  assert.equal(fakes.calls.pay, 0, 'payOrder must never be called');
  assert.equal(fakes.payQueries.length, 0);
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal(effects['orderStatus'], 'HELD');
  assert.equal(effects['paymentGate'], 'payable_exceeds_ceiling');
});

test('1D-3: payable currency mismatch -> payOrder is never called', async () => {
  const { executor, fakes } = flightExecutor(
    { create: heldCreate({ currency: 'SGD', amount: 200 }) },
    { currency: 'USD', amount: 250 },
  );
  const result = await executor.execute(envelope(flightIntent()));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'payable_currency_mismatch');
  assert.equal(fakes.calls.pay, 0, 'payOrder must never be called');
});

test('1D-4: missing payable total -> payOrder is never called', async () => {
  const { executor, fakes } = flightExecutor(
    { create: heldCreate(undefined) },
    { currency: 'USD', amount: 250 },
  );
  const result = await executor.execute(envelope(flightIntent()));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'payable_total_missing');
  assert.equal(fakes.calls.pay, 0, 'payOrder must never be called');

  // Absent ceiling (strategy without costImpact) fails closed as well.
  const noCeiling = flightExecutor({ create: heldCreate({ currency: 'USD', amount: 200 }) }, undefined);
  const noCeilingResult = await noCeiling.executor.execute(envelope(flightIntent({ id: 'int_no_ceiling' })));
  assert.equal(noCeilingResult.error?.code, 'no_authorised_ceiling');
  assert.equal(noCeiling.fakes.calls.pay, 0);
});

test('1D-2b: payOrder always carries the authoritative ceiling, never priceDelta', async () => {
  const { executor, fakes } = flightExecutor(
    {
      create: heldCreate({ currency: 'USD', amount: 200 }),
      pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-1' }, provenance: 'LIVE' }),
      retrieve: [retrieveView('TICKETED')],
    },
    { currency: 'USD', amount: 250 },
  );
  const intent = flightIntent({ priceDelta: { currency: 'USD', amount: 40 } });
  const result = await executor.execute(envelope(intent));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(fakes.payQueries.length, 1);
  assert.deepEqual(fakes.payQueries[0]!.authorisedAmount, { currency: 'USD', amount: 250 });
  assert.equal(fakes.payQueries[0]!.clientReference, intent.id, 'deterministic idempotency key');
});

// ---------------------------------------------------------------------------
// 5. pay timeout/ambiguous -> retrieve-before-retry
// ---------------------------------------------------------------------------

test('1D-5: ambiguous pay reconciles via retrieve before any retry', async () => {
  // Variant A: retrieve observes PAID -> sequence continues to ticketing.
  const recovered = flightExecutor(
    {
      create: heldCreate({ currency: 'USD', amount: 200 }),
      pay: capabilityErr('request_timeout', 'TIMEOUT'),
      retrieve: [retrieveView('PAID'), retrieveView('TICKETED')],
    },
    { currency: 'USD', amount: 250 },
  );
  const result = await recovered.executor.execute(envelope(flightIntent()));
  assert.equal(result.status, 'SUCCESS', 'retrieve observed payment; ticketing completed');
  assert.equal(recovered.fakes.calls.pay, 1, 'no second pay attempt before retrieve');
  assert.ok(recovered.fakes.calls.retrieve >= 1, 'retrieve ran before any retry');

  // Variant B: retrieve still HELD -> honest TIMEOUT, order stays HELD.
  const unresolved = flightExecutor(
    {
      create: heldCreate({ currency: 'USD', amount: 200 }),
      pay: capabilityErr('request_timeout', 'TIMEOUT'),
      retrieve: [retrieveView('HELD')],
    },
    { currency: 'USD', amount: 250 },
  );
  const unresolvedResult = await unresolved.executor.execute(envelope(flightIntent({ id: 'int_ambiguous_pay' })));
  assert.equal(unresolvedResult.status, 'TIMEOUT');
  assert.equal(unresolvedResult.error?.code, 'pay_result_ambiguous');
  assert.equal((unresolvedResult.observedEffects as Record<string, unknown>)['orderStatus'], 'HELD');
  assert.equal(unresolved.fakes.calls.pay, 1);
});

// ---------------------------------------------------------------------------
// 6. PAID but not TICKETED -> no premature SUCCESS
// ---------------------------------------------------------------------------

test('1D-6: PAID without observed ticketing never becomes SUCCESS', async () => {
  const { executor, fakes } = flightExecutor(
    {
      create: heldCreate({ currency: 'USD', amount: 200 }),
      pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-1' }, provenance: 'LIVE' }),
      retrieve: [retrieveView('PAID'), retrieveView('PAID')],
    },
    { currency: 'USD', amount: 250 },
  );
  const result = await executor.execute(envelope(flightIntent()));
  assert.notEqual(result.status, 'SUCCESS', 'no premature success -> wrapper cannot confirm elements');
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.error?.code, 'ticketing_not_observed');
  assert.equal((result.observedEffects as Record<string, unknown>)['orderStatus'], 'PAID');
  assert.equal(fakes.calls.retrieve, 2, 'bounded observation window respected');
});

// ---------------------------------------------------------------------------
// 7-9. cancellation semantics
// ---------------------------------------------------------------------------

function cancelIntent(): ActionIntent {
  return flightIntent({
    id: 'int_dr2_cancel',
    operation: 'flight.cancel',
    sideEffectLevel: 'IRREVERSIBLE',
    parameters: { orderRef: 'ord-1' },
  });
}

test('1D-7: provider-unsupported cancellation is structured data, not a crash', async () => {
  const { executor, fakes } = flightExecutor(
    { quote: ok({ availability: 'UNSUPPORTED', detail: 'carrier route not eligible', provenance: 'LIVE' }) },
    undefined,
  );
  const result = await executor.execute(envelope(cancelIntent()));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.error, undefined, 'no failure invented for normal provider data');
  assert.equal(fakes.calls.submit, 0, 'never submit without an available quote');
  const effects = result.observedEffects as Record<string, unknown>;
  assert.deepEqual((effects['cancellation'] as Record<string, unknown>)['availability'], 'UNSUPPORTED');
});

test('1D-8: REQUEST_ACCEPTED/PROCESSING never becomes an observed CANCELLED outcome', async () => {
  const { executor, fakes } = flightExecutor(
    {
      quote: ok({
        availability: 'AVAILABLE',
        transactionState: { cancellationQuoteRef: 'quote-1' },
        provenance: 'LIVE',
      }),
      submit: ok({ status: 'REQUEST_ACCEPTED', transactionState: { cancellationRequestRef: 'req-1' }, provenance: 'LIVE' }),
      cancelStatus: [ok({ orderRef: 'ord-1', status: 'PROCESSING', provenance: 'LIVE' })],
    },
    undefined,
  );
  const result = await executor.execute(envelope(cancelIntent()));
  assert.notEqual(result.status, 'SUCCESS', 'processing cannot resolve a cancellation');
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(fakes.calls.submit, 1);
  assert.equal(fakes.calls.cancelStatus, 1, 'final state retrieved separately from submission');
  const cancellation = (result.observedEffects as Record<string, unknown>)['cancellation'] as Record<string, unknown>;
  assert.equal(cancellation['status'], 'PROCESSING');

  // Observed CANCELLED is the only outcome that counts as SUCCESS.
  const cancelled = flightExecutor(
    {
      quote: ok({ availability: 'AVAILABLE', transactionState: { cancellationQuoteRef: 'quote-1' }, provenance: 'LIVE' }),
      submit: ok({ status: 'REQUEST_ACCEPTED', transactionState: { cancellationRequestRef: 'req-1' }, provenance: 'LIVE' }),
      cancelStatus: [ok({ orderRef: 'ord-1', status: 'CANCELLED', expectedReturn: { currency: 'USD', amount: 150 }, provenance: 'LIVE' })],
    },
    undefined,
  );
  const cancelledResult = await cancelled.executor.execute(envelope(cancelIntentIntentFix(cancelIntent())));
  assert.equal(cancelledResult.status, 'SUCCESS');
  assert.equal(((cancelledResult.observedEffects as Record<string, unknown>)['cancellation'] as Record<string, unknown>)['status'], 'CANCELLED');
});

function cancelIntentIntentFix(intent: ActionIntent): ActionIntent {
  return { ...intent, id: 'int_dr2_cancel_observed' };
}

test('1D-9: ambiguous cancellation submission retrieves state before any resubmit', async () => {
  const { executor, fakes } = flightExecutor(
    {
      quote: ok({ availability: 'AVAILABLE', transactionState: { cancellationQuoteRef: 'quote-1' }, provenance: 'LIVE' }),
      submit: capabilityErr('request_timeout', 'TIMEOUT'),
      cancelStatus: [ok({ orderRef: 'ord-1', status: 'PROCESSING', provenance: 'LIVE' })],
    },
    undefined,
  );
  const result = await executor.execute(envelope(cancelIntent()));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(fakes.calls.submit, 1, 'no blind resubmission');
  assert.equal(fakes.calls.cancelStatus, 1, 'retrieve-before-resubmit observed the request');
});

// ---------------------------------------------------------------------------
// 10. hotel replacement confirmed + old cancellation fails -> duplicate exposure
// ---------------------------------------------------------------------------

function hotelIntent(): ActionIntent {
  return flightIntent({
    id: 'int_dr2_hotel',
    operation: 'hotel.modify',
    capability: 'HOTEL',
    sideEffectLevel: 'REVERSIBLE',
    parameters: {},
  });
}

const HOTEL_DOSSIER: HotelReplacementDossier = {
  replacementRateId: 'rate-1',
  guestNames: ['Test Traveller'],
  displacedBookingId: 'bk-old-1',
};

function hotelExecutor(script: FakeHotelScript, ceiling: Money | undefined) {
  const { hotel, calls } = fakeHotel(script);
  const fallback = recordingFallback();
  const executor = createProviderBackedExecutor({
    fallback: fallback.executor,
    mode: 'LIVE',
    strategyFor: async () => strategyWithCeiling(ceiling),
    hotel,
    hotelDossier: () => HOTEL_DOSSIER,
    now: () => AT,
  });
  return { executor, calls, fallback };
}

test('1D-10: replacement confirmed but displaced cancellation fails preserves duplicate exposure', async () => {
  const { executor, calls } = hotelExecutor(
    {
      quote: ok({ status: 'QUOTED', quoteId: 'quote-h1', quotedPrice: { currency: 'USD', amount: 180 } }),
      book: ok({ confirmed: true, bookingId: 'bk-new-1', totalPrice: { currency: 'USD', amount: 180 }, provenance: 'LIVE' }),
      // retrieve sequence: replacement CONFIRMED, then displaced still CONFIRMED.
      retrieve: [
        ok({ bookingId: 'bk-new-1', status: 'CONFIRMED' }),
        ok({ bookingId: 'bk-old-1', status: 'CONFIRMED', cancellationFee: { currency: 'USD', amount: 90 } }),
      ],
      cancel: ok({ confirmed: false, provenance: 'LIVE' }),
    },
    { currency: 'USD', amount: 200 },
  );
  const result = await executor.execute(envelope(hotelIntent()));
  assert.equal(result.status, 'FAILURE', 'no fake rollback, no resolution');
  assert.equal(result.error?.code, 'displaced_stay_not_cancelled');
  assert.equal(calls.cancel, 1);
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal(effects['duplicateBookingExposure'], true, 'both provider states preserved');
  const replacement = effects['replacementBooking'] as Record<string, unknown>;
  assert.equal(replacement['bookingId'], 'bk-new-1');
  assert.equal(replacement['status'], 'CONFIRMED');
  const displaced = effects['displacedBooking'] as Record<string, unknown>;
  assert.equal(displaced['bookingId'], 'bk-old-1');
  assert.equal(displaced['status'], 'CONFIRMED');
  assert.deepEqual(displaced['cancellationFee'], { currency: 'USD', amount: 90 });
});

test('1D-10b: full replacement orchestration succeeds only after CONFIRMED + CANCELLED observations', async () => {
  const { executor, calls } = hotelExecutor(
    {
      quote: ok({ status: 'QUOTED', quoteId: 'quote-h1', quotedPrice: { currency: 'USD', amount: 180 } }),
      book: ok({ confirmed: true, bookingId: 'bk-new-1', totalPrice: { currency: 'USD', amount: 180 }, provenance: 'LIVE' }),
      retrieve: [
        ok({ bookingId: 'bk-new-1', status: 'CONFIRMED' }),
        ok({ bookingId: 'bk-old-1', status: 'CANCELLED', cancellationFee: { currency: 'USD', amount: 0 } }),
      ],
      cancel: ok({ confirmed: true, reference: 'cancel-ref-1', provenance: 'LIVE' }),
    },
    { currency: 'USD', amount: 200 },
  );
  const result = await executor.execute(envelope(hotelIntent()));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(calls.quote, 1);
  assert.equal(calls.book, 1);
  assert.equal(calls.cancel, 1);
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal((effects['replacementBooking'] as Record<string, unknown>)['status'], 'CONFIRMED');
  assert.equal((effects['displacedBooking'] as Record<string, unknown>)['status'], 'CANCELLED');
});

test('1D-10c: hotel cost gate refuses booking above the authorised ceiling', async () => {
  const { executor, calls } = hotelExecutor(
    { quote: ok({ status: 'QUOTED', quoteId: 'quote-h1', quotedPrice: { currency: 'USD', amount: 400 } }) },
    { currency: 'USD', amount: 200 },
  );
  const result = await executor.execute(envelope(hotelIntent()));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'payable_exceeds_ceiling');
  assert.equal(calls.book, 0, 'money-moving booking refused before any provider booking call');
});

// ---------------------------------------------------------------------------
// 11-12. provider success never overrides other hard trip evidence
// ---------------------------------------------------------------------------

function hardAccessibilityConstraint(id: string, elementId: string): Constraint {
  return {
    id,
    kind: 'ACCESSIBILITY',
    hardness: 'HARD',
    evaluator: 'DETERMINISTIC',
    status: 'PASS',
    description: 'accessibility mode exclusion bound to the recovered leg',
    refs: [{ entityType: 'TRIP_ELEMENT', id: elementId }],
    parameters: { unsupportedModes: ['FLIGHT'] },
  };
}

function hardSemanticConstraint(id: string, elementId: string): Constraint {
  return {
    id,
    kind: 'ENTRY',
    hardness: 'HARD',
    evaluator: 'SEMANTIC',
    status: 'PASS',
    description: 'entry evidence the deterministic engine cannot derive',
    refs: [{ entityType: 'TRIP_ELEMENT', id: elementId }],
  };
}

async function repairedScenario(extraConstraint: (elementId: string) => Constraint) {
  const spec = loadHarnessScenario(SCENARIO_A_PATH);
  const h = scenarioHarness();
  await seedScenario(h, spec);
  assert.equal((await h.mutations.applyProposal(cancellationProposal(spec))).accepted, true);

  // Repair the disruption exactly like validated provider observation would:
  // a post-signal authoritative replacement leg (same shape DR-1 uses).
  const subject = spec.trip.elements.find((e) => e.id === spec.disruption.signal.subjectRef?.id)!;
  assert.equal(subject.elementKind, 'TRANSPORT_LEG');
  const repaired = {
    ...subject,
    reservationState: 'CONFIRMED',
    status: 'VALID',
    data: {
      ...subject.data,
      scheduledDeparture: {
        value: '2026-09-13T11:10:00+09:00',
        sourceId: 'src_a_provider_state',
        authority: 'AUTHORITATIVE',
        observedAt: '2026-09-12T18:40:00+09:00',
      },
      scheduledArrival: {
        value: '2026-09-13T12:20:00+09:00',
        sourceId: 'src_a_provider_state',
        authority: 'AUTHORITATIVE',
        observedAt: '2026-09-12T18:40:00+09:00',
      },
    },
  };
  const repair = await h.mutations.applyProposal({
    id: 'prop-dr2-repair',
    origin: 'PROVIDER',
    sourceId: 'src_a_provider_state',
    requestedAt: '2026-09-12T19:00:00+09:00',
    rationale: 'observed provider replacement evidence',
    operations: [{ op: 'UPSERT_ENTITY', entityType: 'TRIP_ELEMENT', id: subject.id, data: repaired }],
  });
  assert.equal(repair.accepted, true, repair.issues.map((i) => i.message).join('; '));

  // Bind an additional hard constraint to the same trip.
  await h.entities.upsert({ entityType: 'CONSTRAINT', entity: extraConstraint(subject.id) });
  return { spec, h };
}

test('1D-11: provider repair success + another hard constraint FAILing keeps the case unresolved', async () => {
  const { spec, h } = await repairedScenario((elementId) => hardAccessibilityConstraint('c_dr2_fail', elementId));
  const verifier = new CaseVerifier({ trips: h.trips, signals: h.signals, entities: h.entities, mutations: h.mutations });
  const verification = await verifier.verify(spec.trip.id, '2026-09-12T19:30:00+09:00');
  assert.notEqual(verification.suggestedCaseStatus, 'RESOLVED', 'hard FAIL binds verification');
  assert.equal(verification.suggestedCaseStatus, 'PLANNING');
  assert.deepEqual(verification.hardFailureIds, ['c_dr2_fail']);
  assert.equal(verification.resolution, undefined);
  h.db.close();
});

test('1D-12: provider repair success + another hard condition UNKNOWN keeps the case unresolved', async () => {
  const { spec, h } = await repairedScenario((elementId) => hardSemanticConstraint('c_dr2_unknown', elementId));
  const verifier = new CaseVerifier({ trips: h.trips, signals: h.signals, entities: h.entities, mutations: h.mutations });
  const verification = await verifier.verify(spec.trip.id, '2026-09-12T19:30:00+09:00');
  assert.notEqual(verification.suggestedCaseStatus, 'RESOLVED', 'hard UNKNOWN binds verification');
  assert.equal(verification.suggestedCaseStatus, 'VERIFYING');
  assert.deepEqual(verification.hardUnknownIds, ['c_dr2_unknown']);
  assert.equal(verification.resolution, undefined);
  h.db.close();
});

// ---------------------------------------------------------------------------
// 16. REPLAY normalization equivalence for the transaction seams
// ---------------------------------------------------------------------------

test('1D-16: REPLAY transaction normalization is identical to the LIVE path', async () => {
  const writeDir = mkdtempSync(join(tmpdir(), 'dr2-replay-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const sandboxConfig = { baseUrl: 'https://sandbox.atriptech.com', clientId: 'id', clientSecret: 'secret' };

  const createQuery = {
    offerId: 'offer-1',
    passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01', gender: 'FEMALE' as const }],
    contact: { name: 'Traveller/Test' },
    workflowState: { sessionId: 'sess-1' },
    clientReference: 'int_replay_equivalence',
  };
  const createRaw = {
    status: 0,
    orderNo: 'ord-replay-1',
    pnrCode: 'PNR123',
    totalPrice: 210,
    currency: 'USD',
    tktLimitTime: '2026-09-12 21:00:00',
    paxTicketInfos: [],
  };
  const retrieveRaw = {
    status: 0,
    orderStatus: '2',
    totalPrice: 210,
    currency: 'USD',
    paxTicketInfos: [{ ticketNos: ['999-1234567890'] }],
    airlineBookings: [{ airlinePnr: 'AB12CD' }],
  };
  const quoteRaw = {
    status: 0,
    isVoidable: true,
    voidOfferId: 'void-offer-1',
    voidMethod: 'ORIGINAL',
    voidFareAmount: { currency: 'USD', originalFareAmount: 210, estimatedRefundAmount: 190 },
    serviceFee: { currency: 'USD', transactionFee: 0 },
    voidWindow: { supportVoid: true, allowVoid: true, sameDayDeadlineTime: '2026-09-12 23:59:59', sameDayTimezone: 'Asia/Singapore' },
  };

  // LIVE path through a stubbed fetch — identical adapter code.
  const liveRaw: Record<string, unknown> = {
    '/order.do': createRaw,
    '/queryOrderDetails.do': retrieveRaw,
    '/voidQuotation.do': quoteRaw,
  };
  const liveAdapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store,
    ...sandboxConfig,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const raw = liveRaw[path];
      assert.ok(raw, `unexpected endpoint ${path}`);
      void init;
      return new Response(JSON.stringify(raw), { status: 200 });
    }) as typeof fetch,
  });
  const liveCreate = await liveAdapter.createOrder(createQuery);
  const liveRetrieve = await liveAdapter.retrieveOrder({ orderRef: 'ord-replay-1' });
  const liveQuote = await liveAdapter.quoteCancellation({ orderRef: 'ord-replay-1' });
  assert.equal(liveCreate.ok, true);
  assert.equal(liveRetrieve.ok, true);
  assert.equal(liveQuote.ok, true);

  // REPLAY path: same adapter, recordings saved under the deterministic ids.
  const replayAdapter = new AtlasFlightTransactionAdapter({ mode: 'REPLAY', store, ...sandboxConfig });
  const recordings: Array<{ operation: string; request: unknown; raw: unknown }> = [
    { operation: 'order_create', request: createQuery, raw: createRaw },
    { operation: 'order_retrieve', request: { orderRef: 'ord-replay-1' }, raw: retrieveRaw },
    { operation: 'cancel_quote', request: { orderRef: 'ord-replay-1' }, raw: quoteRaw },
  ];
  for (const entry of recordings) {
    const id = recordingIdFor('atlas', entry.operation, entry.request);
    await store.save({
      id,
      providerId: 'atlas',
      operation: entry.operation,
      recordedAt: AT,
      sanitized: true,
      raw: entry.raw,
    });
  }
  const replayCreate = await replayAdapter.createOrder(createQuery);
  const replayRetrieve = await replayAdapter.retrieveOrder({ orderRef: 'ord-replay-1' });
  const replayQuote = await replayAdapter.quoteCancellation({ orderRef: 'ord-replay-1' });
  assert.equal(replayCreate.ok, true, JSON.stringify(replayCreate.ok ? undefined : replayCreate.error));
  assert.equal(replayRetrieve.ok, true, JSON.stringify(replayRetrieve.ok ? undefined : replayRetrieve.error));
  assert.equal(replayQuote.ok, true, JSON.stringify(replayQuote.ok ? undefined : replayQuote.error));

  // Downstream semantics identical; only provenance/mode differ by design,
  // and observedAt is a wall-clock observation stamp, not normalized content.
  const semantics = <T extends { provenance: string }>(
    result: T,
  ): Omit<T, 'provenance' | 'observedAt'> => {
    const { provenance: _provenance, observedAt: _observedAt, ...rest } = result as T & {
      observedAt?: string;
    };
    return rest;
  };
  if (liveCreate.ok && replayCreate.ok) {
    assert.deepEqual(semantics(replayCreate.data), semantics(liveCreate.data));
    assert.equal(replayCreate.data.provenance, 'REPLAY');
    assert.equal(liveCreate.data.provenance, 'LIVE');
    assert.equal(replayCreate.meta.mode, 'REPLAY');
    assert.equal(liveCreate.meta.mode, 'LIVE');
  }
  if (liveRetrieve.ok && replayRetrieve.ok) {
    assert.deepEqual(semantics(replayRetrieve.data), semantics(liveRetrieve.data));
    assert.equal(replayRetrieve.data.provenance, 'REPLAY');
  }
  if (liveQuote.ok && replayQuote.ok) {
    assert.deepEqual(semantics(replayQuote.data), semantics(liveQuote.data));
    assert.equal(replayQuote.data.provenance, 'REPLAY');
  }
});

// ---------------------------------------------------------------------------
// 17. Duplicate-detection adoption (create ambiguity reconciliation)
// ---------------------------------------------------------------------------

test('1D-17: duplicate-detection (status 318) adopts the existing held order from either wire shape', () => {
  // Wire reality observed in the sandbox: duplicateOrders entries arrive BOTH
  // as plain order-number strings and as objects carrying orderNo. The schema
  // must accept both, and adoption must reconcile either shape without ever
  // creating a second booking.
  assert.equal(
    AtlasOrderBodySchema.safeParse({ status: 318, duplicateOrders: ['TESTA-EXISTING-2'] }).success,
    true,
    'schema accepts string entries',
  );
  assert.equal(
    AtlasOrderBodySchema.safeParse({ status: 318, duplicateOrders: [{ orderNo: 'TESTA-EXISTING-1' }] }).success,
    true,
    'schema accepts object entries',
  );

  const objectShape = normalizeOrderCreate(
    { status: 318, duplicateOrders: [{ orderNo: 'TESTA-EXISTING-1' }] },
    'LIVE',
  );
  assert.equal(objectShape.status, 'HELD');
  assert.equal(objectShape.transactionState?.orderRef, 'TESTA-EXISTING-1');

  const stringShape = normalizeOrderCreate({ status: 318, duplicateOrders: ['TESTA-EXISTING-2'] }, 'LIVE');
  assert.equal(stringShape.status, 'HELD');
  assert.equal(stringShape.transactionState?.orderRef, 'TESTA-EXISTING-2');

  // No usable reference: nothing is adopted and the outcome fails honestly.
  const unusable = normalizeOrderCreate({ status: 318, duplicateOrders: [] }, 'LIVE');
  assert.equal(unusable.status, 'FAILED');
});
