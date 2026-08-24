/**
 * Wave 3R Mission 2 / Phase 0 — P0.1 financial authority semantics (ADR-048).
 *
 * Permanently pins the spendExposure contract:
 *  - `ActionIntent.spendExposure` (maximum gross provider charge) is what
 *    authority evaluates for SPEND_LIMIT / APPROVAL_ABOVE_SPEND — never the
 *    incremental `priceDelta`;
 *  - a MONEY_MOVING intent without a deterministic gross spend fails closed;
 *  - the executor's payment ceiling is the authority-frozen spendExposure on
 *    the intent — mutating persisted strategy state after authority can never
 *    raise the authorised spend;
 *  - incomparable currencies fail closed.
 *
 * Canonical numbers: incremental delta 40, gross 250, policy limit 100,
 * approval threshold 100.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DeterministicAuthorityEngine, type RuleSetSource } from '../src/engine/authority.ts';
import { buildActionIntent } from '../src/app/recoveryExecution.ts';
import {
  createProviderBackedExecutor,
  type FlightBookingDossier,
} from '../src/app/providerExecution.ts';
import { capabilityError, capabilityOk, type CapabilityMeta, type CapabilityResult } from '../src/contracts/envelope.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { ActionIntent, AuthorisedExecution, AuthorityDecision, ExecutionResult } from '../src/operational/intent.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { ExecutorService } from '../src/contracts/services.ts';
import type { AuthorityContext } from '../src/contracts/services.ts';
import type {
  CapabilityDescriptor,
  FareRulesOutcome,
  FlightCancellationQuoteQuery,
  FlightCancellationQuoteOutcome,
  FlightCancellationStatusQuery,
  FlightCancellationSubmitOutcome,
  FlightCancellationSubmitQuery,
  FlightCancellationStatusView,
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
} from '../src/contracts/capabilities.ts';
import type { Money } from '../src/domain/common.ts';

const AT = '2026-09-12T19:00:00+09:00';
const USD = 'USD';

// ---------------------------------------------------------------------------
// Authority fixtures
// ---------------------------------------------------------------------------

function inMemoryRuleSets(...ruleSets: RuleSet[]): RuleSetSource {
  const byId = new Map(ruleSets.map((rs) => [rs.id, rs]));
  return { getRuleSet: async (id) => byId.get(id) };
}

function moneyIntent(over: {
  id: string;
  priceDelta?: Money;
  spendExposure?: Money;
}): ActionIntent {
  return {
    id: over.id,
    caseId: 'case_p0',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: {},
    sideEffectLevel: 'MONEY_MOVING',
    ...(over.priceDelta ? { priceDelta: over.priceDelta } : {}),
    ...(over.spendExposure ? { spendExposure: over.spendExposure } : {}),
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: AT,
  };
}

const POLICY_CONTEXT: AuthorityContext = {
  tripId: 'trip_p0',
  caseId: 'case_p0',
  ruleSetIds: ['rs_p0'],
  principals: [],
};

function policyRuleSet(rules: RuleSet['rules']): RuleSet {
  return { id: 'rs_p0', kind: 'ORGANISATION', name: 'P0.1 policy', sourceId: 'src_p0_policy', rules };
}

// ---------------------------------------------------------------------------
// 1. Delta below the limit, gross above it: SPEND_LIMIT binds the gross spend
// ---------------------------------------------------------------------------

test('P0.1-1: delta 40 / gross 250 vs SPEND_LIMIT 100 cannot execute', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(
      policyRuleSet([
        {
          id: 'rule_p0_limit',
          kind: 'SPEND_LIMIT',
          sourceId: 'src_p0_policy',
          maxAmount: { amount: 100, currency: USD },
          appliesTo: [],
        },
      ]),
    ),
  });
  const decision = await authority.decide(
    moneyIntent({
      id: 'int_p0_limit',
      priceDelta: { amount: 40, currency: USD },
      spendExposure: { amount: 250, currency: USD },
    }),
    POLICY_CONTEXT,
  );
  assert.equal(decision.outcome, 'BLOCKED', 'the gross charge, not the delta, binds the hard limit');
  assert.ok(
    decision.ruleTrace.some((entry) => entry.includes('250') && entry.includes('100')),
    'the trace records gross 250 vs limit 100',
  );
  assert.ok(decision.conditions.some((c) => c.includes('spendExposure=250')), 'conditions record the reviewed gross spend');
});

// ---------------------------------------------------------------------------
// 2. Same numbers against an approval threshold: explicit approval required
// ---------------------------------------------------------------------------

test('P0.1-2: delta 40 / gross 250 vs threshold 100 requires explicit approval', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(
      policyRuleSet([
        {
          id: 'rule_p0_threshold',
          kind: 'APPROVAL_ABOVE_SPEND',
          sourceId: 'src_p0_policy',
          threshold: { amount: 100, currency: USD },
          approver: 'TRAVELLER',
          appliesTo: [],
        },
      ]),
    ),
  });
  const decision = await authority.decide(
    moneyIntent({
      id: 'int_p0_threshold',
      priceDelta: { amount: 40, currency: USD },
      spendExposure: { amount: 250, currency: USD },
    }),
    POLICY_CONTEXT,
  );
  assert.equal(
    decision.outcome,
    'REQUIRES_TRAVELLER',
    'a small delta never waives approval when the gross spend crosses the threshold',
  );
  assert.ok(decision.ruleTrace.some((entry) => entry.includes('250') && entry.includes('threshold')));
});

// ---------------------------------------------------------------------------
// 3. Missing gross spend on a money-moving intent fails closed
// ---------------------------------------------------------------------------

test('P0.1-3: a MONEY_MOVING intent without spendExposure is blocked, never auto-approved', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'int_p0_missing', priceDelta: { amount: 40, currency: USD } }),
    POLICY_CONTEXT,
  );
  assert.equal(decision.outcome, 'BLOCKED', 'unreviewed gross spend cannot execute');
  assert.ok(
    decision.ruleTrace.some((entry) => entry.includes('spendExposure') && entry.includes('fail closed')),
    'the refusal names the missing gross spend',
  );
});

// ---------------------------------------------------------------------------
// Executor fixtures (boundary-level fakes; wire details live in adapters)
// ---------------------------------------------------------------------------

function meta(mode: 'LIVE' | 'REPLAY'): CapabilityMeta {
  return { providerId: 'test-provider', mode, requestedAt: AT };
}

function ok<T>(data: T): CapabilityResult<T> {
  return capabilityOk(data, meta('LIVE'));
}

function capabilityErr<T>(code: string): CapabilityResult<T> {
  return capabilityError({ category: 'PROVIDER_ERROR', code, message: `structured failure ${code}` }, meta('LIVE'));
}

const DOSSIER: FlightBookingDossier = {
  passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01', gender: 'FEMALE' } as FlightPassengerInput],
  contact: { name: 'Traveller/Test' } as FlightContactInput,
  paymentRef: 'test-sandbox-balance',
};

interface BookingScript {
  create: CapabilityResult<FlightOrderOutcome>;
  pay?: CapabilityResult<FlightOrderOutcome>;
  retrieve?: CapabilityResult<FlightOrderStatusView>[];
}

function bookingCapability(script: BookingScript) {
  const calls = { verify: 0, create: 0, pay: 0, retrieve: 0 };
  const payQueries: FlightOrderPayQuery[] = [];
  const flight = {
    descriptor: {
      family: 'FLIGHT',
      providerId: 'test-provider',
      mode: 'LIVE',
      supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'],
      maxSideEffectLevel: 'READ_ONLY',
    } as CapabilityDescriptor,
    async searchFlights(_q: FlightSearchQuery): Promise<CapabilityResult<FlightSearchOutcome>> {
      return capabilityErr('not_used');
    },
    async verifyOffer(_q: FlightVerifyQuery): Promise<CapabilityResult<FlightVerifyOutcome>> {
      calls.verify += 1;
      return ok({ status: 'VERIFIED', workflowState: { sessionId: 'sess-p0' } });
    },
    async getFareRules(_q: FlightVerifyQuery): Promise<CapabilityResult<FareRulesOutcome>> {
      return capabilityErr('not_used');
    },
  };
  const flightTransactions: FlightTransactionCapability = {
    descriptor: {
      family: 'FLIGHT',
      providerId: 'test-provider',
      mode: 'LIVE',
      supportedOperations: ['flight.book', 'flight.pay', 'flight.order_status', 'flight.cancel_quote', 'flight.cancel_status', 'flight.cancel'],
      maxSideEffectLevel: 'MONEY_MOVING',
    },
    async createOrder(_q: FlightOrderCreateQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
      calls.create += 1;
      return script.create;
    },
    async payOrder(q: FlightOrderPayQuery): Promise<CapabilityResult<FlightOrderOutcome>> {
      calls.pay += 1;
      payQueries.push(q);
      return script.pay ?? capabilityErr('order_pay_unscripted');
    },
    async retrieveOrder(_q: FlightOrderRetrieveQuery): Promise<CapabilityResult<FlightOrderStatusView>> {
      const index = calls.retrieve;
      calls.retrieve += 1;
      const sequence = script.retrieve ?? [];
      return sequence[Math.min(index, sequence.length - 1)] ?? capabilityErr('retrieve_unscripted');
    },
    async quoteCancellation(_q: FlightCancellationQuoteQuery): Promise<CapabilityResult<FlightCancellationQuoteOutcome>> {
      return capabilityErr('not_used');
    },
    async submitCancellation(_q: FlightCancellationSubmitQuery): Promise<CapabilityResult<FlightCancellationSubmitOutcome>> {
      return capabilityErr('not_used');
    },
    async retrieveCancellationStatus(_q: FlightCancellationStatusQuery): Promise<CapabilityResult<FlightCancellationStatusView>> {
      return capabilityErr('not_used');
    },
  };
  return { flight, flightTransactions, calls, payQueries };
}

function heldCreate(totalPrice: Money): CapabilityResult<FlightOrderOutcome> {
  return ok({
    status: 'HELD',
    transactionState: { orderRef: 'ord-p0', providerRecordLocator: 'PNR001' },
    totalPrice,
    provenance: 'LIVE',
  });
}

function ticketedRetrieve(): CapabilityResult<FlightOrderStatusView> {
  return ok({
    orderRef: 'ord-p0',
    status: 'TICKETED',
    transactionState: { orderRef: 'ord-p0', ticketRefs: ['tkt-p0'] },
    observedAt: AT,
    provenance: 'LIVE',
  });
}

function p0Executor(script: BookingScript) {
  const fakes = bookingCapability(script);
  const fallbackCalls: number[] = [];
  const fallback: ExecutorService = {
    async execute(execution: AuthorisedExecution): Promise<ExecutionResult> {
      fallbackCalls.push(1);
      return { id: `exec-${execution.intent.id}`, intentId: execution.intent.id, executedAt: AT, status: 'SUCCESS', provenance: 'SIMULATED' };
    },
  };
  const executor = createProviderBackedExecutor({
    fallback,
    mode: 'LIVE',
    flight: fakes.flight,
    flightTransactions: fakes.flightTransactions,
    flightDossier: () => DOSSIER,
    ticketingPoll: { attempts: 2, delayMs: 1 },
    sleep: async () => undefined,
    now: () => AT,
  });
  return { executor, fakes, fallbackCalls };
}

function approvedEnvelope(intent: ActionIntent): AuthorisedExecution {
  const authority: AuthorityDecision = {
    id: `auth_${intent.id}`,
    intentId: intent.id,
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: [`reviewed gross spend ${intent.spendExposure?.amount ?? '-'} ${intent.spendExposure?.currency ?? ''}`],
    conditions: [],
  };
  return { intent, authority };
}

function flightIntent(over: Partial<ActionIntent>): ActionIntent {
  return {
    id: 'int_p0_exec',
    caseId: 'case_p0',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: { bookingRefs: [{ system: 'flight-provider', reference: 'offer-p0' }] },
    sideEffectLevel: 'MONEY_MOVING',
    evidenceRefs: [],
    status: 'AUTHORISED',
    createdAt: AT,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 4. Executor ceiling == authority-reviewed gross exposure
// ---------------------------------------------------------------------------

test('P0.1-4: the executor ceiling is the authority-frozen spendExposure on the intent', async () => {
  const { executor, fakes } = p0Executor({
    create: heldCreate({ currency: USD, amount: 220 }),
    pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-p0' }, provenance: 'LIVE' }),
    retrieve: [ticketedRetrieve()],
  });
  const intent = flightIntent({
    priceDelta: { currency: USD, amount: 40 }, // incremental delta
    spendExposure: { currency: USD, amount: 250 }, // authority-frozen gross
  });
  const result = await executor.execute(approvedEnvelope(intent));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(fakes.payQueries.length, 1);
  assert.deepEqual(
    fakes.payQueries[0]!.authorisedAmount,
    { currency: USD, amount: 250 },
    'FlightOrderPayQuery.authorisedAmount derives from the frozen gross exposure, never the delta',
  );
});

// ---------------------------------------------------------------------------
// 5. Post-authority strategy mutation cannot raise the authorised spend
// ---------------------------------------------------------------------------

test('P0.1-5: mutating the persisted strategy after authority cannot raise the executor ceiling', async () => {
  // buildActionIntent freezes the gross spend ONTO the intent at authority
  // time. Even if the persisted strategy is later mutated to a higher cost,
  // the executor (which holds no strategy resolver at all) pays at most the
  // frozen exposure.
  const originalStrategy: RecoveryStrategy = {
    id: 'strat_p0',
    caseId: 'case_p0',
    summary: 'rebook to the next service',
    candidateOperations: [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        id: 'el_p0_flight',
        data: {
          elementKind: 'TRANSPORT_LEG',
          id: 'el_p0_flight',
          data: { mode: 'FLIGHT', bookingRef: { system: 'flight-provider', reference: 'offer-p0' } },
        },
      },
    ],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    costImpact: { amount: 250, currency: USD },
    createdAt: AT,
  };
  const frozen = buildActionIntent({ id: 'int_p0_frozen', caseId: 'case_p0', strategy: originalStrategy, at: AT });
  assert.deepEqual(frozen.spendExposure, { amount: 250, currency: USD }, 'authority time freezes the gross exposure');

  // The persisted strategy is mutated AFTER authority: costImpact rises.
  const mutatedStrategy = { ...originalStrategy, costImpact: { amount: 900, currency: USD } };
  const refrozen = buildActionIntent({ id: 'int_p0_frozen', caseId: 'case_p0', strategy: mutatedStrategy, at: AT });
  assert.notDeepEqual(refrozen.spendExposure, frozen.spendExposure);

  // Executing the ORIGINAL envelope (the one authority approved) still pays
  // at most 250: the executor reads only intent.spendExposure.
  const { executor, fakes } = p0Executor({
    create: heldCreate({ currency: USD, amount: 220 }),
    pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-p0' }, provenance: 'LIVE' }),
    retrieve: [ticketedRetrieve()],
  });
  const result = await executor.execute(approvedEnvelope(frozen));
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(fakes.payQueries[0]!.authorisedAmount, { currency: USD, amount: 250 }, 'ceiling stays 250, not the mutated 900');

  // And a payable above the frozen exposure refuses: mutation cannot widen
  // the gate either.
  const { executor: strict, fakes: strictFakes } = p0Executor({
    create: heldCreate({ currency: USD, amount: 400 }),
  });
  const refused = await strict.execute(approvedEnvelope({ ...frozen, id: 'int_p0_strict' }));
  assert.equal(refused.status, 'FAILURE');
  assert.equal(refused.error?.code, 'payable_exceeds_ceiling');
  assert.equal(strictFakes.payQueries.length, 0, 'no payment above the frozen exposure');
});

// ---------------------------------------------------------------------------
// 6. Currency mismatch on the gross spend fails closed
// ---------------------------------------------------------------------------

test('P0.1-6: a gross spend incomparable to the policy currency fails closed', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(
      policyRuleSet([
        {
          id: 'rule_p0_limit_eur',
          kind: 'SPEND_LIMIT',
          sourceId: 'src_p0_policy',
          maxAmount: { amount: 1000, currency: 'EUR' },
          appliesTo: [],
        },
      ]),
    ),
  });
  const decision = await authority.decide(
    moneyIntent({
      id: 'int_p0_fx',
      priceDelta: { amount: 40, currency: USD },
      spendExposure: { amount: 250, currency: USD },
    }),
    POLICY_CONTEXT,
  );
  assert.equal(decision.outcome, 'BLOCKED', 'no FX invention: incomparable gross spend cannot execute');
  assert.ok(decision.ruleTrace.some((entry) => entry.includes('not deterministically') && entry.includes('fail closed')));
});
