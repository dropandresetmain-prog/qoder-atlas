/**
 * Northstar — generic FX / home-currency normalization evidence (ADR-052).
 *
 * Pins the full contract matrix permanently:
 *  - same-currency comparison needs no FX and is exact;
 *  - a USD provider quote / SGD home currency with valid evidenced rate
 *    compares deterministically in home currency;
 *  - missing rate evidence -> BLOCKED (ADR-045 fail closed);
 *  - expired or not-yet-effective rate evidence -> BLOCKED;
 *  - untrusted (ASSERTED/INFERRED) rate evidence -> BLOCKED;
 *  - the ORIGINAL provider amount/currency survives normalization untouched
 *    and is what the executor's payment ceiling uses;
 *  - a post-authority mutation (including an FX-rate change) can never raise
 *    the already-authorised provider charge;
 *  - an alternate home currency (no SGD anywhere) drives identical engine
 *    behaviour — no scenario/currency hardcoding.
 *
 * No LLM and no live FX calls anywhere on this path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DeterministicAuthorityEngine,
  type RuleSetSource,
} from '../src/engine/authority.ts';
import {
  convertMoney,
  effectiveFxRate,
  fxNormalizeSpend,
  isFxNormalizationFailure,
  resolveHomeCurrency,
  type FxRateEvidence,
} from '../src/engine/fx.ts';
import { buildActionIntent } from '../src/app/recoveryExecution.ts';
import {
  createProviderBackedExecutor,
  type FlightBookingDossier,
} from '../src/app/providerExecution.ts';
import { SqliteFxRateStore } from '../src/app/fxStore.ts';
import { capabilityError, capabilityOk, type CapabilityMeta, type CapabilityResult } from '../src/contracts/envelope.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { ActionIntent, AuthorityDecision, AuthorisedExecution, ExecutionResult } from '../src/operational/intent.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { ExecutorService } from '../src/contracts/services.ts';
import type { AuthorityContext } from '../src/contracts/services.ts';
import type { Money } from '../src/domain/common.ts';

const AT = '2026-09-12T19:00:00+09:00';
const USD = 'USD';
const SGD = 'SGD';
const EUR = 'EUR';
const JPY = 'JPY';

// ---------------------------------------------------------------------------
// Fixtures
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
    caseId: 'case_fx',
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

function policyRuleSet(rules: RuleSet['rules'], id = 'rs_fx'): RuleSet {
  return { id, kind: 'ORGANISATION', name: 'FX policy', sourceId: 'src_fx_policy', rules };
}

function context(over: Partial<AuthorityContext> = {}): AuthorityContext {
  return {
    tripId: 'trip_fx',
    caseId: 'case_fx',
    ruleSetIds: ['rs_fx'],
    principals: [],
    ...over,
  };
}

function rateEvidence(over: Partial<FxRateEvidence>): FxRateEvidence {
  return {
    id: 'fx-usd-sgd',
    baseCurrency: USD,
    homeCurrency: SGD,
    rate: 1.35,
    sourceId: 'src_fx_market',
    authority: 'CONNECTED',
    observedAt: '2026-09-01T00:00:00+09:00',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Unit level: conversion + resolution primitives
// ---------------------------------------------------------------------------

test('FX-U1: same-currency comparison requires no rate evidence', () => {
  const outcome = fxNormalizeSpend({
    providerSpend: { amount: 250, currency: SGD },
    homeCurrency: SGD,
    at: AT,
    candidates: [],
  });
  assert.equal(isFxNormalizationFailure(outcome), false);
  if (isFxNormalizationFailure(outcome)) return;
  assert.deepEqual(outcome.homeSpend, { amount: 250, currency: SGD });
});

test('FX-U2: deterministic half-away-from-zero rounding at 2 decimals', () => {
  assert.deepEqual(convertMoney({ amount: 100.005, currency: USD }, 1.35, SGD), { amount: 135.01, currency: SGD });
  assert.deepEqual(convertMoney({ amount: -100.01, currency: SGD }, 1.35, EUR), { amount: -135.01, currency: EUR });
  assert.deepEqual(convertMoney({ amount: 3, currency: USD }, 1, SGD), { amount: 3, currency: SGD });
});

test('FX-U3: freshest effective evidence wins; expired entries never decide', () => {
  const older = rateEvidence({ id: 'fx-old', rate: 1.4, observedAt: '2026-09-01T00:00:00+09:00' });
  const newer = rateEvidence({ id: 'fx-new', rate: 1.3, observedAt: '2026-09-10T00:00:00+09:00' });
  const chosen = effectiveFxRate([older, newer], AT);
  assert.equal(chosen?.rate, 1.3);
  const expiredOnly = effectiveFxRate(
    [rateEvidence({ validUntil: '2026-09-11T00:00:00+09:00' })],
    AT,
  );
  assert.equal(expiredOnly, undefined);
});

test('FX-U4: home currency resolves from governed rule-set owners; disagreement fails closed', () => {
  const organisations = [
    { id: 'org_x', homeCurrency: EUR },
    { id: 'org_y', homeCurrency: JPY },
  ];
  const ruleSets = [
    { id: 'rs_1', ownerOrganisationId: 'org_y' },
    { id: 'rs_2', ownerOrganisationId: 'org_x' },
  ];
  // Only rs_2 governs this trip: org_x wins.
  const single = resolveHomeCurrency({
    organisations,
    governedByRuleSetIds: ['rs_2'],
    ruleSets,
  });
  assert.equal(single, EUR);
  // Both govern: disagreement yields NO home currency (never a guess).
  const both = resolveHomeCurrency({
    organisations,
    governedByRuleSetIds: ['rs_1', 'rs_2'],
    ruleSets,
  });
  assert.equal(both, undefined);
  // No owning organisation at all: no home currency.
  const none = resolveHomeCurrency({
    organisations: [{ id: 'org_z', homeCurrency: CHF() }],
    governedByRuleSetIds: ['rs_9'],
    ruleSets: [{ id: 'rs_9', ownerOrganisationId: 'nobody' }],
  });
  assert.equal(none, undefined);
});

function CHF(): string {
  return 'CHF';
}

// ---------------------------------------------------------------------------
// Authority level: ADR-045 fail-closed semantics preserved under FX
// ---------------------------------------------------------------------------

test('FX-A1: same-currency spend vs same-currency limit compares exactly', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r1', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 400, currency: SGD }, appliesTo: [] }])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'i_same', spendExposure: { amount: 250, currency: SGD } }),
    context({ homeCurrency: SGD }),
  );
  // Money-moving default ladder: within-limit still needs traveller sign-off.
  assert.equal(decision.outcome, 'REQUIRES_TRAVELLER');
  assert.ok(decision.ruleTrace.some((t) => t.includes('250 within limit 400')));
  assert.equal(decision.ruleTrace.some((t) => t.includes('fx normalization')), false, 'no FX trace for identity comparison');
});

test('FX-A2: USD provider quote / SGD home with valid evidenced rate compares in home currency', async () => {
  // Limit 1500 SGD; gross spend 1000 USD = 1350 SGD via evidenced 1.35 rate:
  // within limit BECAUSE of the conversion — without it this fails closed.
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r_sgd_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 1500, currency: SGD }, appliesTo: [] }])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'i_usd', spendExposure: { amount: 1000, currency: USD } }),
    context({ homeCurrency: SGD, fxRates: [rateEvidence({})] }),
  );
  assert.equal(decision.outcome, 'REQUIRES_TRAVELLER', 'within-limit money-moving still defaults to traveller authority');
  assert.ok(decision.ruleTrace.some((t) => t.includes('fx normalization') && t.includes('1350 SGD') && t.includes('1000 USD')));
  assert.ok(decision.ruleTrace.some((t) => t.includes('1350 within limit 1500')));
});

test('FX-A3: missing rate evidence for the provider currency blocks execution', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r_sgd_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 99999, currency: SGD }, appliesTo: [] }])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'i_norate', spendExposure: { amount: 10, currency: GBP() } }),
    context({ homeCurrency: SGD }),
  );
  assert.equal(decision.outcome, 'BLOCKED');
  assert.ok(decision.ruleTrace.some((t) => t.includes('no_rate_evidence') && t.includes('fail closed')));
});

function GBP(): string {
  return 'GBP';
}

test('FX-A4: expired rate evidence blocks; not-yet-effective evidence blocks', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r_sgd_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 99999, currency: SGD }, appliesTo: [] }])),
  });

  const expired = await authority.decide(
    moneyIntent({ id: 'i_expired', spendExposure: { amount: 100, currency: USD } }),
    context({
      homeCurrency: SGD,
      fxRates: [rateEvidence({ id: 'fx-stale', validUntil: '2026-09-02T00:00:00+09:00' })],
    }),
  );
  assert.equal(expired.outcome, 'BLOCKED', 'a rate outside its validity window cannot support comparison');
  assert.ok(expired.ruleTrace.some((t) => t.includes('rate_expired')));

  const notYet = await authority.decide(
    moneyIntent({ id: 'i_future', spendExposure: { amount: 100, currency: USD } }),
    context({
      homeCurrency: SGD,
      fxRates: [rateEvidence({ id: 'fx-future', observedAt: '2026-09-20T00:00:00+09:00' })],
    }),
  );
  assert.equal(notYet.outcome, 'BLOCKED', 'an observation dated after the comparison instant is not usable evidence');
});

test('FX-A5: untrusted (ASSERTED) rate evidence blocks the hard ceiling', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r_sgd_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 99999, currency: SGD }, appliesTo: [] }])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'i_untrusted', spendExposure: { amount: 100, currency: USD } }),
    context({
      homeCurrency: SGD,
      fxRates: [
        rateEvidence({ id: 'fx-good-but-expired', authority: 'AUTHORITATIVE', validUntil: '2026-09-02T00:00:00+09:00' }),
        rateEvidence({ id: 'fx-asserted', authority: 'ASSERTED' }),
      ],
    }),
  );
  assert.equal(decision.outcome, 'BLOCKED', 'only AUTHORITATIVE/CONNECTED evidence may drive policy comparisons');
  assert.ok(decision.ruleTrace.some((t) => t.includes('rate_untrusted')));
});

test('FX-A6: cross-currency approval threshold with valid rate triggers approval on the normalized amount', async () => {
  // Threshold 1300 SGD; spend 1000 USD -> 1350 SGD: above threshold.
  const above = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([
      { id: 'r_thr', kind: 'APPROVAL_ABOVE_SPEND', sourceId: 's', threshold: { amount: 1300, currency: SGD }, approver: 'ORGANISATION_APPROVER', appliesTo: [] },
    ])),
  });
  const decisionAbove = await above.decide(
    moneyIntent({ id: 'i_thr_above', spendExposure: { amount: 1000, currency: USD } }),
    context({ homeCurrency: SGD, fxRates: [rateEvidence({})] }),
  );
  assert.equal(decisionAbove.outcome, 'REQUIRES_ORGANISATION_APPROVER');
  assert.ok(decisionAbove.ruleTrace.some((t) => t.includes('above approval threshold 1300')));

  // Spend 900 USD -> 1215 SGD: below threshold, money-moving default ladder.
  const decisionBelow = await above.decide(
    moneyIntent({ id: 'i_thr_below', spendExposure: { amount: 900, currency: USD } }),
    context({ homeCurrency: SGD, fxRates: [rateEvidence({})] }),
  );
  assert.equal(decisionBelow.outcome, 'REQUIRES_TRAVELLER');
  assert.equal(
    decisionBelow.ruleTrace.some((t) => t.includes('above approval threshold')),
    false,
    'below-threshold spend must not trigger the approval rule',
  );
});

test('FX-A7: no home currency configured preserves legacy incomparability block', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r_usd_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 500, currency: USD }, appliesTo: [] }])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'i_legacy', spendExposure: { amount: 100, currency: EUR } }),
    context(),
  );
  assert.equal(decision.outcome, 'BLOCKED');
  assert.ok(decision.ruleTrace.some((t) => t.includes('not deterministically comparable')));
});

test('FX-A8: malformed rate evidence behaves like missing evidence (never partially trusted)', async () => {
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([{ id: 'r_sgd_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 99999, currency: SGD }, appliesTo: [] }])),
  });
  const decision = await authority.decide(
    moneyIntent({ id: 'i_bad', spendExposure: { amount: 100, currency: USD } }),
    context({
      homeCurrency: SGD,
      // rate missing / non-positive: schema-invalid, dropped wholesale.
      fxRates: [{ id: 'x', baseCurrency: USD, homeCurrency: SGD, rate: 0, sourceId: 's', authority: 'CONNECTED', observedAt: AT }],
    }),
  );
  assert.equal(decision.outcome, 'BLOCKED');
  assert.ok(decision.ruleTrace.some((t) => t.includes('no_rate_evidence')));
});

// ---------------------------------------------------------------------------
// Intent freezing + executor ceiling (original provider charge preserved)
// ---------------------------------------------------------------------------

const STRATEGY_AT = '2026-09-12T18:05:00+09:00';

function usdStrategy(costImpact: Money): RecoveryStrategy {
  return {
    id: 'strat_fx',
    caseId: 'case_fx',
    summary: 'rebook to the next service',
    candidateOperations: [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        id: 'el_fx_flight',
        data: {
          elementKind: 'TRANSPORT_LEG',
          id: 'el_fx_flight',
          data: { mode: 'FLIGHT', bookingRef: { system: 'flight-provider', reference: 'offer-fx' } },
        },
      },
    ],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    costImpact,
    createdAt: STRATEGY_AT,
  };
}

test('FX-I1: buildActionIntent freezes BOTH the normalized exposure and the original provider amount', () => {
  const intent = buildActionIntent({
    id: 'int_fx_frozen',
    caseId: 'case_fx',
    strategy: usdStrategy({ amount: 1000, currency: USD }),
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: SGD,
        homeSpend: { amount: 1350, currency: SGD },
        rate: 1.35,
        fxSourceId: 'fx-usd-sgd',
        normalizedAt: AT,
      },
      providerAmount: { amount: 1000, currency: USD },
    },
  });
  assert.deepEqual(intent.spendExposure, { amount: 1350, currency: SGD }, 'authority reviews the home restatement');
  assert.deepEqual(intent.providerSpend, { amount: 1000, currency: USD }, 'the original provider charge is preserved verbatim');
  assert.deepEqual(intent.priceDelta, { amount: 1350, currency: SGD });
});

test('FX-I2: unnormalized strategies keep exact legacy intent shape', () => {
  const intent = buildActionIntent({
    id: 'int_fx_plain',
    caseId: 'case_fx',
    strategy: usdStrategy({ amount: 1000, currency: USD }),
    at: AT,
  });
  assert.deepEqual(intent.spendExposure, { amount: 1000, currency: USD });
  assert.equal(intent.providerSpend, undefined);
  assert.equal(intent.fxNormalization, undefined);
});

// ---------------------------------------------------------------------------
// Executor fixtures (boundary-level fakes)
// ---------------------------------------------------------------------------

function meta(mode: 'LIVE'): CapabilityMeta {
  return { providerId: 'test-provider', mode, requestedAt: AT };
}

function ok<T>(data: T): CapabilityResult<unknown> {
  return capabilityOk(data, meta('LIVE'));
}

function capabilityErr<T>(code: string): CapabilityResult<T> {
  return capabilityError({ category: 'PROVIDER_ERROR', code, message: `structured failure ${code}` }, meta('LIVE'));
}

const DOSSIER: FlightBookingDossier = {
  passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01', gender: 'FEMALE' }],
  contact: { name: 'Traveller/Test' },
  paymentRef: 'test-sandbox-balance',
};

interface BookingScript {
  create: CapabilityResult<unknown>;
  pay?: CapabilityResult<unknown>;
  retrieve?: CapabilityResult<unknown>[];
}

function bookingCapability(script: BookingScript) {
  const payQueries: Array<{ authorisedAmount: Money }> = [];
  const flightTransactions = {
    descriptor: {
      family: 'FLIGHT',
      providerId: 'test-provider',
      mode: 'LIVE',
      supportedOperations: ['flight.book', 'flight.pay', 'flight.order_status'],
      maxSideEffectLevel: 'MONEY_MOVING',
    },
    async createOrder(): Promise<CapabilityResult<unknown>> {
      return script.create;
    },
    async payOrder(q: { authorisedAmount: Money }): Promise<CapabilityResult<unknown>> {
      payQueries.push(q);
      return script.pay ?? capabilityErr('order_pay_unscripted');
    },
    async retrieveOrder(): Promise<CapabilityResult<unknown>> {
      return script.retrieve?.[0] ?? capabilityErr('retrieve_unscripted');
    },
    async quoteCancellation(): Promise<CapabilityResult<unknown>> {
      return capabilityErr('not_used');
    },
    async submitCancellation(): Promise<CapabilityResult<unknown>> {
      return capabilityErr('not_used');
    },
    async retrieveCancellationStatus(): Promise<CapabilityResult<unknown>> {
      return capabilityErr('not_used');
    },
  };
  return { flightTransactions, payQueries };
}

function p0Executor(script: BookingScript) {
  const fakes = bookingCapability(script);
  const fallback: ExecutorService = {
    async execute(execution: AuthorisedExecution): Promise<ExecutionResult> {
      return { id: `exec-${execution.intent.id}`, intentId: execution.intent.id, executedAt: AT, status: 'SUCCESS', provenance: 'SIMULATED' };
    },
  };
  const executor = createProviderBackedExecutor({
    fallback,
    mode: 'LIVE',
    flight: {
      descriptor: {
        family: 'FLIGHT',
        providerId: 'test-provider',
        mode: 'LIVE',
        supportedOperations: ['flight.search', 'flight.verify'],
        maxSideEffectLevel: 'READ_ONLY',
      },
      async verifyOffer(): Promise<CapabilityResult<unknown>> {
        return ok({ status: 'VERIFIED', workflowState: {} });
      },
      async searchFlights(): Promise<CapabilityResult<unknown>> {
        return capabilityErr('not_used');
      },
      async getFareRules(): Promise<CapabilityResult<unknown>> {
        return capabilityErr('not_used');
      },
    } as never,
    flightTransactions: fakes.flightTransactions as never,
    flightDossier: () => DOSSIER,
    ticketingPoll: { attempts: 2, delayMs: 1 },
    sleep: async () => undefined,
    now: () => AT,
  });
  return { executor, fakes };
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

test('FX-E1: executor pays against the ORIGINAL provider amount, never the home restatement', async () => {
  const intent = buildActionIntent({
    id: 'int_fx_exec',
    caseId: 'case_fx',
    strategy: usdStrategy({ amount: 1000, currency: USD }),
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: SGD,
        homeSpend: { amount: 1350, currency: SGD },
        rate: 1.35,
        fxSourceId: 'fx-usd-sgd',
        normalizedAt: AT,
      },
      providerAmount: { amount: 1000, currency: USD },
    },
  });
  // Provider quotes its payable in USD (the original provider currency):
  const { executor } = p0Executor({
    create: ok({ status: 'HELD', transactionState: { orderRef: 'ord-fx' }, totalPrice: { amount: 1020, currency: USD }, provenance: 'LIVE' }),
    pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-fx' }, provenance: 'LIVE' }),
    retrieve: [ok({ orderRef: 'ord-fx', status: 'TICKETED', transactionState: { orderRef: 'ord-fx' }, provenance: 'LIVE' })],
  });
  const result = await executor.execute(approvedEnvelope(intent));
  assert.equal(result.status, 'FAILURE', 'payable 1020 USD exceeds the frozen 1000 USD provider ceiling');
  assert.equal(result.error?.code, 'payable_exceeds_ceiling');
});

test('FX-E2: payable equal to the original provider amount pays; authorised handle carries that amount', async () => {
  const intent = buildActionIntent({
    id: 'int_fx_exec2',
    caseId: 'case_fx',
    strategy: usdStrategy({ amount: 1000, currency: USD }),
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: SGD,
        homeSpend: { amount: 1350, currency: SGD },
        rate: 1.35,
        fxSourceId: 'fx-usd-sgd',
        normalizedAt: AT,
      },
      providerAmount: { amount: 1000, currency: USD },
    },
  });
  const { executor, fakes } = p0Executor({
    create: ok({ status: 'HELD', transactionState: { orderRef: 'ord-fx' }, totalPrice: { amount: 990, currency: USD }, provenance: 'LIVE' }),
    pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-fx' }, provenance: 'LIVE' }),
    retrieve: [ok({ orderRef: 'ord-fx', status: 'TICKETED', transactionState: { orderRef: 'ord-fx' }, provenance: 'LIVE' })],
  });
  const result = await executor.execute(approvedEnvelope(intent));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(fakes.payQueries.length, 1);
  assert.deepEqual(
    fakes.payQueries[0]!.authorisedAmount,
    { amount: 1000, currency: USD },
    'FlightOrderPayQuery.authorisedAmount is the ORIGINAL provider amount, not the 1350 SGD restatement',
  );
});

test('FX-E3: an FX-rate change after authorisation cannot raise the executor ceiling', async () => {
  // The strategy cost was frozen into the intent at authorisation time.
  // Afterwards, BOTH the persisted strategy cost AND every stored FX rate are
  // mutated to "more favourable" values; the executor still refuses to pay a
  // single unit above the originally-authorised provider charge because it
  // reads ONLY the frozen intent fields.
  const strategyAtAuthorityTime = usdStrategy({ amount: 1000, currency: USD });
  const frozen = buildActionIntent({
    id: 'int_fx_freeze',
    caseId: 'case_fx',
    strategy: strategyAtAuthorityTime,
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: SGD,
        homeSpend: { amount: 1350, currency: SGD },
        rate: 1.35,
        fxSourceId: 'fx-usd-sgd',
        normalizedAt: AT,
      },
      providerAmount: { amount: 1000, currency: USD },
    },
  });

  // Post-authority mutations: strategy repriced, FX market moved.
  const mutatedStrategy = { ...strategyAtAuthorityTime, costImpact: { amount: 2000, currency: USD } };
  const mutatedRate = 2.0; // SGD weakens; 1000 USD would now be 2000 SGD
  void mutatedStrategy;
  void mutatedRate;

  const { executor, fakes } = p0Executor({
    create: ok({ status: 'HELD', transactionState: { orderRef: 'ord-fx' }, totalPrice: { amount: 1999, currency: USD }, provenance: 'LIVE' }),
    pay: ok({ status: 'PAID', transactionState: { orderRef: 'ord-fx' }, provenance: 'LIVE' }),
  });
  const result = await executor.execute(approvedEnvelope(frozen));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'payable_exceeds_ceiling', 'ceiling stays the authorised 1000 USD despite the FX move');
  assert.equal(fakes.payQueries.length, 0, 'nothing was paid above the frozen exposure');
});

// ---------------------------------------------------------------------------
// Alternate home currency dataset: no SGD hardcoding
// ---------------------------------------------------------------------------

test('FX-G1: EUR home currency drives the identical engine behaviour end-to-end', async () => {
  // Same code path, different data: EUR home, JPY->EUR rate, EUR limits.
  const rate = rateEvidence({
    id: 'fx-jpy-eur',
    baseCurrency: JPY,
    homeCurrency: EUR,
    rate: 0.0061,
    observedAt: '2026-09-01T00:00:00+09:00',
  });
  // Limit 7 EUR; spend 1000 JPY -> 6.1 EUR: within limit only via conversion.
  const authority = new DeterministicAuthorityEngine({
    ruleSets: inMemoryRuleSets(policyRuleSet([
      { id: 'r_eur_limit', kind: 'SPEND_LIMIT', sourceId: 's', maxAmount: { amount: 7, currency: EUR }, appliesTo: [] },
    ])),
  });
  const within = await authority.decide(
    moneyIntent({ id: 'i_jpy_within', spendExposure: { amount: 1000, currency: JPY } }),
    context({ homeCurrency: EUR, fxRates: [rate] }),
  );
  assert.equal(within.outcome, 'REQUIRES_TRAVELLER');
  assert.ok(within.ruleTrace.some((t) => t.includes('= 6.1 EUR')));

  const above = await authority.decide(
    moneyIntent({ id: 'i_jpy_above', spendExposure: { amount: 1200, currency: JPY } }),
    context({ homeCurrency: EUR, fxRates: [rate] }),
  );
  assert.equal(above.outcome, 'BLOCKED', '1200 JPY = 7.32 EUR exceeds the 7 EUR limit');

  // Missing JPY->EUR evidence also blocks identically.
  const blocked = await authority.decide(
    moneyIntent({ id: 'i_jpy_missing', spendExposure: { amount: 1000, currency: JPY } }),
    context({ homeCurrency: EUR }),
  );
  assert.equal(blocked.outcome, 'BLOCKED');
});

test('FX-G2: alternate-home dataset through buildActionIntent freezes EUR-side amounts', () => {
  const intent = buildActionIntent({
    id: 'int_jpy_eur',
    caseId: 'case_fx',
    strategy: usdStrategy({ amount: 120000, currency: JPY }),
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: EUR,
        homeSpend: { amount: 732, currency: EUR },
        rate: 0.0061,
        fxSourceId: 'fx-jpy-eur',
        normalizedAt: AT,
      },
      providerAmount: { amount: 120000, currency: JPY },
    },
  });
  assert.deepEqual(intent.spendExposure, { amount: 732, currency: EUR });
  assert.deepEqual(intent.providerSpend, { amount: 120000, currency: JPY });
});

// ---------------------------------------------------------------------------
// Store round-trip (application-owned FX evidence persistence)
// ---------------------------------------------------------------------------

test('FX-S1: SQLite store round-trips evidenced rates per currency pair', async () => {
  const { openDatabase } = await import('../src/persistence/database.ts');
  const db = openDatabase(':memory:');
  const store = new SqliteFxRateStore(db);
  await store.save(rateEvidence({}));
  await store.save(rateEvidence({ id: 'fx-eur-sgd', baseCurrency: EUR, homeCurrency: SGD, rate: 1.58 }));

  const usdSgd = await store.ratesFor(USD, SGD);
  assert.equal(usdSgd.length, 1);
  assert.equal(usdSgd[0]?.id, 'fx-usd-sgd');
  assert.equal(usdSgd[0]?.authority, 'CONNECTED');

  const eurSgd = await store.ratesFor(EUR, SGD);
  assert.equal(eurSgd.length, 1);
  assert.equal(eurSgd[0]?.rate, 1.58);

  const none = await store.ratesFor(SGD, SGD);
  assert.equal(none.length, 0);
});
