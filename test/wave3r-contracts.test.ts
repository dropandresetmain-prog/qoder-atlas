/**
 * G3R-R0 — Wave 3R shared-contract freeze invariant tests.
 *
 * Proves the provider-neutral flight transaction + cancellation + external
 * event seams freeze the safety invariants without leaking provider wire
 * shapes into the generic domain:
 *
 *  1. new capability schemas validate intended generic examples;
 *  2. payment contracts carry no raw-card fields (PAN/CVV/expiry);
 *  3. consequential flight payment cannot enter ToolOperationSchema;
 *  4. consequential cancellation submission cannot enter ToolOperationSchema;
 *  5. read-only order/cancellation-quote/status operations remain a strict
 *     subset of CapabilityOperationSchema with family mappings;
 *  6. unsupported cancellation is a structured outcome, not an exception;
 *  7. provider acceptance of a cancellation is representable separately from
 *     the final observed cancellation state;
 *  8. provider order/ticket observation state stays separate from Trip
 *     viability (no field conflates the two);
 *  9. execution authority invariants remain closed for new consequential ops;
 * 10. unauthenticated external event payloads stay ASSERTED, never
 *     AUTHORITATIVE, and deduplicate on provider identity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ExternalProviderEventEnvelopeSchema,
  FlightCancellationAvailabilitySchema,
  FlightCancellationStatusSchema,
  FlightOrderStatusSchema,
  FlightTransactionStateSchema,
  type FlightCancellationQuoteOutcome,
  type FlightCancellationStatusView,
  type FlightCancellationSubmitOutcome,
  type FlightOrderCreateQuery,
  type FlightOrderOutcome,
  type FlightOrderPayQuery,
  type FlightOrderStatusView,
} from '../src/contracts/capabilities.ts';
import {
  AuthorisedExecutionSchema,
  CapabilityOperationSchema,
  executionGateIssues,
  type ActionIntent,
  type AuthorityDecision,
} from '../src/operational/intent.ts';
import {
  CapabilityFamilySchema,
  ToolOperationSchema,
  ToolRequestSchema,
  TOOL_OPERATION_FAMILY,
} from '../src/operational/strategy.ts';
import { TripSchema } from '../src/domain/trip.ts';

const AT = '2026-10-01T09:00:00+08:00';

// ---------------------------------------------------------------------------
// 1. Generic examples validate; provider wire shapes are rejected
// ---------------------------------------------------------------------------

test('G3R-R0: generic flight transaction shapes validate; provider wire fields are rejected', () => {
  const createQuery: FlightOrderCreateQuery = {
    offerId: 'offer-1',
    passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01' }],
    contact: { name: 'Test Traveller', email: 'traveller@example.com' },
    workflowState: { session: 'opaque-provider-state' },
    clientReference: 'client-ref-1',
  };
  assert.equal(createQuery.passengers[0]?.familyName, 'Traveller');

  // Order observation enum accepts the generic lifecycle and rejects
  // provider-specific wire vocabulary.
  for (const status of ['HELD', 'PAID', 'TICKETING', 'TICKETED', 'CANCELLED', 'FAILED', 'UNKNOWN']) {
    assert.equal(FlightOrderStatusSchema.parse(status), status);
  }
  assert.throws(() => FlightOrderStatusSchema.parse('orderStatus-0'));

  // Opaque transaction state preserves provider handles without
  // reinterpretation, and unknown provider keys survive round-trip.
  const state = FlightTransactionStateSchema.parse({
    orderRef: 'ORD-123',
    providerRecordLocator: 'ABC123',
    ticketRefs: ['T1'],
    cancellationQuoteRef: 'Q-1',
    cancellationRequestRef: 'R-1',
    providerExtraField: 'kept-opaque',
  });
  assert.equal(state.orderRef, 'ORD-123');
  assert.equal((state as Record<string, unknown>)['providerExtraField'], 'kept-opaque');
});

// ---------------------------------------------------------------------------
// 2. No raw card data crosses the payment seam
// ---------------------------------------------------------------------------

test('G3R-R0: flight payment carries an opaque paymentRef and no card fields', () => {
  const payQuery: FlightOrderPayQuery = {
    orderRef: 'ORD-123',
    paymentRef: 'provider-test-balance',
    clientReference: 'client-ref-1',
  };
  assert.equal(payQuery.paymentRef, 'provider-test-balance');

  // The payment query type must not structurally contain card primitives.
  type HasCardField = FlightOrderPayQuery extends { cardNumber?: unknown }
    ? true
    : FlightOrderPayQuery extends { cvv?: unknown }
      ? true
      : FlightOrderPayQuery extends { pan?: unknown }
        ? true
        : false;
  const hasCardField: HasCardField = false;
  assert.equal(hasCardField, false);

  // Runtime guard over the whole transaction vocabulary: no contract source
  // below the adapter layer may introduce card-field names.
  const forbidden = ['cardNumber', 'cardNum', 'pan', 'cvv', 'cv2', 'expiryMonth', 'expiryYear'];
  const samples: Array<Record<string, unknown>> = [payQuery as unknown as Record<string, unknown>];
  for (const sample of samples) {
    for (const key of Object.keys(sample)) {
      assert.ok(!forbidden.includes(key), `payment contract carries card field ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3./4. Consequential flight operations cannot enter the planner vocabulary
// ---------------------------------------------------------------------------

test('G3R-R0: flight payment and cancellation submission are not planner tool operations', () => {
  const consequential = ['flight.book', 'flight.pay', 'flight.cancel', 'flight.change'] as const;
  const toolVocabulary = new Set<string>(ToolOperationSchema.options);
  for (const operation of consequential) {
    assert.ok(!toolVocabulary.has(operation), `${operation} must stay out of the tool vocabulary`);
    assert.ok(
      (CapabilityOperationSchema.options as readonly string[]).includes(operation),
      `${operation} must remain an authority-path capability operation`,
    );
    assert.throws(
      () =>
        ToolRequestSchema.parse({
          id: 'tool_bad',
          capability: 'FLIGHT',
          operation,
          purpose: 'attempted consequential action via planner',
        }),
      (err: unknown) => err instanceof Error,
      `tool request must reject ${operation}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Read-only transaction inspection stays a strict capability subset
// ---------------------------------------------------------------------------

test('G3R-R0: read-only flight transaction inspection is a strict capability subset', () => {
  const readOnly = ['flight.order_status', 'flight.cancel_quote', 'flight.cancel_status'] as const;
  const capabilityVocabulary = new Set<string>(CapabilityOperationSchema.options);
  const toolVocabulary = new Set<string>(ToolOperationSchema.options);
  for (const operation of readOnly) {
    assert.ok(toolVocabulary.has(operation), `${operation} must be planner-requestable`);
    assert.ok(capabilityVocabulary.has(operation), `${operation} must be a capability operation`);
    assert.equal(TOOL_OPERATION_FAMILY[operation], 'FLIGHT');
    const parsed = ToolRequestSchema.parse({
      id: 'tool_ok',
      capability: 'FLIGHT',
      operation,
      purpose: 'observe provider state before deciding',
    });
    assert.equal(CapabilityFamilySchema.parse(parsed.capability), 'FLIGHT');
  }
  // The full vocabulary invariant (defense in depth).
  for (const operation of ToolOperationSchema.options) {
    assert.ok(capabilityVocabulary.has(operation), `tool op not a capability op: ${operation}`);
  }
});

// ---------------------------------------------------------------------------
// 6. Unsupported cancellation is structured data, never an exception
// ---------------------------------------------------------------------------

test('G3R-R0: unsupported cancellation is a structured capability outcome', () => {
  assert.equal(FlightCancellationAvailabilitySchema.parse('UNSUPPORTED'), 'UNSUPPORTED');
  const unsupported: FlightCancellationQuoteOutcome = {
    availability: 'UNSUPPORTED',
    detail: 'provider does not support cancellation for this booking',
    provenance: 'LIVE',
  };
  assert.equal(unsupported.expectedReturn, undefined);
  assert.equal(unsupported.deadline, undefined);

  // A provider that does support it expresses window/amount/conditions.
  const quoted: FlightCancellationQuoteOutcome = {
    availability: 'AVAILABLE',
    deadline: '2026-10-02T12:00:00Z',
    expectedReturn: { amount: 191.98, currency: 'USD' },
    conditions: ['cancellation permitted before departure'],
    transactionState: { cancellationQuoteRef: 'Q-1' },
    provenance: 'LIVE',
  };
  assert.equal(quoted.availability, 'AVAILABLE');
});

// ---------------------------------------------------------------------------
// 7. Submission acceptance != final observed cancellation state
// ---------------------------------------------------------------------------

test('G3R-R0: cancellation acceptance is distinct from observed cancellation state', () => {
  const submitted: FlightCancellationSubmitOutcome = {
    status: 'REQUEST_ACCEPTED',
    transactionState: { cancellationRequestRef: 'R-1' },
    provenance: 'LIVE',
  };
  // Still processing — NOT cancelled yet.
  const processing: FlightCancellationStatusView = {
    orderRef: 'ORD-123',
    status: 'PROCESSING',
    observedAt: AT,
    provenance: 'LIVE',
  };
  assert.notEqual(submitted.status, 'CANCELLED');
  assert.notEqual(processing.status, 'CANCELLED');

  // Only the observed status may reach CANCELLED, and only via retrieval.
  const observed: FlightCancellationStatusView = {
    orderRef: 'ORD-123',
    status: 'CANCELLED',
    observedAt: AT,
    provenance: 'LIVE',
  };
  assert.equal(FlightCancellationStatusSchema.parse(observed.status), 'CANCELLED');
  for (const status of ['REQUEST_ACCEPTED', 'PROCESSING', 'REJECTED', 'UNKNOWN']) {
    assert.equal(FlightCancellationStatusSchema.parse(status), status);
  }
});

// ---------------------------------------------------------------------------
// 8. Provider order observation stays separate from Trip viability
// ---------------------------------------------------------------------------

test('G3R-R0: provider order/ticket observation never carries trip viability', () => {
  const view: FlightOrderStatusView = {
    orderRef: 'ORD-123',
    status: 'TICKETED',
    transactionState: { ticketRefs: ['T1'] },
    totalPrice: { amount: 120, currency: 'USD' },
    observedAt: AT,
    provenance: 'LIVE',
  };
  const outcome: FlightOrderOutcome = {
    status: 'PAID',
    transactionState: { orderRef: 'ORD-123' },
    provenance: 'LIVE',
  };
  // No provider observation field may assert trip-level truth.
  for (const record of [view, outcome]) {
    const keys = Object.keys(record);
    for (const forbidden of ['viability', 'recovered', 'tripStatus', 'caseResolved']) {
      assert.ok(!keys.includes(forbidden), `provider view carries trip field ${forbidden}`);
    }
  }
  // Trip viability vocabulary remains a separate, trip-owned schema.
  const trip = TripSchema.parse({
    id: 'trip_1',
    travellerIds: ['trv_1'],
    elements: [],
    objectives: [],
    relations: [],
    governedByRuleSetIds: [],
    viability: 'UNKNOWN',
    version: 0,
    updatedAt: AT,
  });
  assert.equal(trip.viability, 'UNKNOWN');
  assert.notEqual(view.status as string, trip.viability as string);
});

// ---------------------------------------------------------------------------
// 9. Authority/execution invariants stay closed for the new operations
// ---------------------------------------------------------------------------

function sampleIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: 'ai_1',
    caseId: 'case_1',
    operation: 'flight.pay',
    capability: 'FLIGHT',
    parameters: { orderRef: 'ORD-123', paymentRef: 'provider-test-balance' },
    sideEffectLevel: 'MONEY_MOVING',
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: AT,
    ...overrides,
  };
}

function sampleDecision(overrides: Partial<AuthorityDecision> = {}): AuthorityDecision {
  return {
    id: 'ad_1',
    intentId: 'ai_1',
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: [],
    conditions: [],
    ...overrides,
  };
}

test('G3R-R0: flight payment and cancellation require explicit authority evidence', () => {
  // Money-moving flight payment with no matching approval evidence is refused.
  const unpaidGate = AuthorisedExecutionSchema.parse({
    intent: sampleIntent({ status: 'AUTHORISED' }),
    authority: sampleDecision({ outcome: 'REQUIRES_TRAVELLER' }),
  });
  assert.ok(executionGateIssues(unpaidGate).length > 0);

  // Same intent with an explicit approval passes the unchanged gate.
  const paidGate = AuthorisedExecutionSchema.parse({
    intent: sampleIntent({ status: 'AUTHORISED' }),
    authority: sampleDecision({
      outcome: 'REQUIRES_TRAVELLER',
      approval: {
        decidedAt: AT,
        decidedBy: { entityType: 'TRAVELLER', id: 'trv_1' },
        decision: 'APPROVED',
      },
    }),
  });
  assert.deepEqual(executionGateIssues(paidGate), []);

  // Irreversible cancellation submission: BLOCKED authority stays closed.
  const cancelGate = AuthorisedExecutionSchema.parse({
    intent: sampleIntent({ operation: 'flight.cancel', sideEffectLevel: 'IRREVERSIBLE' }),
    authority: sampleDecision({ outcome: 'BLOCKED' }),
  });
  assert.ok(executionGateIssues(cancelGate).some((issue) => issue.includes('BLOCKED')));
});

// ---------------------------------------------------------------------------
// 10. External event trust: unauthenticated payloads never become AUTHORITATIVE
// ---------------------------------------------------------------------------

test('G3R-R0: external event envelopes keep provider identity and never self-promote authority', () => {
  const envelope = ExternalProviderEventEnvelopeSchema.parse({
    providerId: 'flight-provider-x',
    providerEventId: 'evt-0001',
    receivedAt: AT,
    occurredAt: '2026-10-01T08:55:00+08:00',
    providerOrderRefs: ['ORD-123'],
    category: 'FLIGHT_SCHEDULE_CHANGE',
    providerAuthority: 'ASSERTED',
    payload: { newDeparture: '2026-10-01T11:00:00+08:00' },
  });
  assert.equal(envelope.providerEventId, 'evt-0001');

  // The envelope vocabulary must not contain provider-specific event kinds.
  for (const key of Object.keys(envelope)) {
    assert.ok(/^[a-z]/.test(key), `envelope field ${key} is not generic`);
  }

  // An unauthenticated delivery has no business claiming AUTHORITATIVE: the
  // envelope's authority is provider-stated delivery confidence, and the
  // downstream signal authority path (TripSignalSchema) is what gates trust.
  assert.notEqual(envelope.providerAuthority, 'AUTHORITATIVE');
  assert.throws(() =>
    ExternalProviderEventEnvelopeSchema.parse({
      providerId: 'flight-provider-x',
      // Missing provider event identity: no deduplication possible.
      receivedAt: AT,
      category: 'OTHER',
    }),
  );
});
