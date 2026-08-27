/**
 * Final demo S7 — FX / home-currency path evidence.
 *
 * Pins the S7 Atlas-shaped spend (USD provider quote vs SGD organisation
 * policy) through the same ADR-052 contracts the acceptance manifests assert:
 *  - providerSpend / providerCost preserve the Atlas currency+amount;
 *  - spendExposure / costDelta carry the home restatement;
 *  - authority can compare the restatement against SGD spend limits;
 *  - resolveHomeCurrency without an org homeCurrency still yields none
 *    (fail-closed posture when policy omits homeCurrency).
 *
 * No live Atlas / Frankfurter / Model Studio calls. Shared org homeCurrency
 * + flight.change approval vocabulary landed on b7d80aa — this file does not
 * re-implement those programme/policy fixes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DeterministicAuthorityEngine,
  type RuleSetSource,
} from '../src/engine/authority.ts';
import {
  convertMoney,
  fxNormalizeSpend,
  isFxNormalizationFailure,
  resolveHomeCurrency,
  type FxRateEvidence,
} from '../src/engine/fx.ts';
import { buildActionIntent } from '../src/app/recoveryExecution.ts';
import { LayeredFxRateResolver } from '../src/app/fxResolver.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { RecoveryStrategy } from '../src/operational/strategy.ts';
import type { Money } from '../src/domain/common.ts';

const AT = '2026-09-18T10:20:00+08:00';
const USD = 'USD';
const SGD = 'SGD';

/** Real Atlas HND→SIN offer amount from recordings/atlas/search (TR883-class). */
const ATLAS_HND_SIN_PROVIDER: Money = { amount: 143.62, currency: USD };
const BUDGET_USD_SGD_RATE = 1.35;
const EXPECTED_HOME: Money = convertMoney(ATLAS_HND_SIN_PROVIDER, BUDGET_USD_SGD_RATE, SGD);

const RATE: FxRateEvidence = {
  id: 'fx-usd-sgd-sept',
  baseCurrency: USD,
  homeCurrency: SGD,
  rate: BUDGET_USD_SGD_RATE,
  sourceId: 'src_a_organiser_policy',
  authority: 'CONNECTED',
  observedAt: '2026-09-01T00:00:00+09:00',
};

function s7Strategy(costImpact: Money): RecoveryStrategy {
  return {
    id: 'strat-s7-0001',
    caseId: 'case-s7-fx',
    summary: 'Rebook HND→SIN (direct) to fly from HND, departing at 02:20',
    candidateOperations: [
      {
        op: 'UPSERT_ENTITY',
        entityType: 'TRIP_ELEMENT',
        id: 'el-trip-trv-evt-ait-2026-ait-draft-38-leg-1',
        data: {
          elementKind: 'TRANSPORT_LEG',
          id: 'el-trip-trv-evt-ait-2026-ait-draft-38-leg-1',
          data: {
            mode: 'FLIGHT',
            bookingRef: { system: 'flight-provider', reference: 'atlas-hnd-sin-offer' },
          },
        },
      },
    ],
    toolRequests: [],
    assumptions: [],
    uncertainties: [],
    expectedOutcomes: [],
    costImpact,
    createdAt: AT,
  };
}

function aitPolicy(): RuleSet {
  return {
    id: 'rs-ait-organiser-policy',
    kind: 'ORGANISATION',
    name: 'AiT organiser policy (S7 FX fixture)',
    ownerOrganisationId: 'org-ait-organiser',
    sourceId: 'src-syn-ait-policy',
    rules: [
      {
        id: 'rule-ait-airfare-spend-limit',
        kind: 'SPEND_LIMIT',
        sourceId: 'src-syn-ait-policy',
        description: 'Per-traveller event-funded airfare ceiling',
        appliesTo: [],
        maxAmount: { amount: 1200, currency: SGD },
        period: 'TRIP',
      },
      {
        id: 'rule-ait-flight-change-approval',
        kind: 'APPROVAL_REQUIRED',
        sourceId: 'src-syn-ait-policy',
        description: 'Flight itinerary changes always require human approval',
        appliesTo: [],
        approver: 'HUMAN_AGENT',
        // Engine operation vocabulary is capability-style (flight.change), not FLIGHT_CHANGE.
        operations: ['flight.change', 'flight.cancel'],
      },
    ],
  };
}

function ruleSets(...sets: RuleSet[]): RuleSetSource {
  const byId = new Map(sets.map((rs) => [rs.id, rs]));
  return { getRuleSet: async (id) => byId.get(id) };
}

test('S7-FX-1: Atlas USD offer restates to SGD home via evidenced budget rate', () => {
  const outcome = fxNormalizeSpend({
    providerSpend: ATLAS_HND_SIN_PROVIDER,
    homeCurrency: SGD,
    at: AT,
    candidates: [RATE],
  });
  assert.equal(isFxNormalizationFailure(outcome), false);
  if (isFxNormalizationFailure(outcome)) return;
  assert.deepEqual(outcome.providerAmount, ATLAS_HND_SIN_PROVIDER);
  assert.deepEqual(outcome.homeSpend, EXPECTED_HOME);
  assert.equal(EXPECTED_HOME.amount, 193.89);
  assert.equal(outcome.fxSourceId, RATE.id);
});

test('S7-FX-2: buildActionIntent freezes providerCost-side amount and home spendExposure', () => {
  const outcome = fxNormalizeSpend({
    providerSpend: ATLAS_HND_SIN_PROVIDER,
    homeCurrency: SGD,
    at: AT,
    candidates: [RATE],
  });
  assert.equal(isFxNormalizationFailure(outcome), false);
  if (isFxNormalizationFailure(outcome)) return;

  const intent = buildActionIntent({
    id: 'intent-s7-fx',
    caseId: 'case-s7-fx',
    strategy: s7Strategy(ATLAS_HND_SIN_PROVIDER),
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: SGD,
        homeSpend: outcome.homeSpend,
        rate: outcome.rate!,
        fxSourceId: outcome.fxSourceId!,
        normalizedAt: AT,
      },
      providerAmount: outcome.providerAmount,
    },
  });

  assert.deepEqual(intent.providerSpend, ATLAS_HND_SIN_PROVIDER, 'providerCost contract source');
  assert.deepEqual(intent.spendExposure, EXPECTED_HOME, 'costDelta / authority restatement');
  assert.equal(intent.fxNormalization?.homeCurrency, SGD);
  assert.equal(intent.fxNormalization?.fxSourceId, RATE.id);
});

test('S7-FX-3: with homeCurrency + rates, SGD spend limit compares; flight change still needs approval', async () => {
  const outcome = fxNormalizeSpend({
    providerSpend: ATLAS_HND_SIN_PROVIDER,
    homeCurrency: SGD,
    at: AT,
    candidates: [RATE],
  });
  assert.equal(isFxNormalizationFailure(outcome), false);
  if (isFxNormalizationFailure(outcome)) return;

  const intent = buildActionIntent({
    id: 'intent-s7-fx-auth',
    caseId: 'case-s7-fx',
    strategy: s7Strategy(ATLAS_HND_SIN_PROVIDER),
    at: AT,
    fxNormalization: {
      record: {
        homeCurrency: SGD,
        homeSpend: outcome.homeSpend,
        rate: outcome.rate!,
        fxSourceId: outcome.fxSourceId!,
        normalizedAt: AT,
      },
      providerAmount: outcome.providerAmount,
    },
  });

  const engine = new DeterministicAuthorityEngine({ ruleSets: ruleSets(aitPolicy()) });
  const decision = await engine.decide(intent, {
    tripId: 'trip-trv-evt-ait-2026-ait-draft-38',
    caseId: 'case-s7-fx',
    ruleSetIds: ['rs-ait-organiser-policy'],
    principals: [
      {
        ref: { entityType: 'ORGANISATION', id: 'org-ait-organiser' },
        permissions: [],
      },
    ],
    homeCurrency: SGD,
    fxRates: [RATE],
  });

  assert.notEqual(decision.outcome, 'BLOCKED', 'FX makes SGD limit comparable — must not fail closed on currency');
  assert.equal(decision.outcome, 'REQUIRES_HUMAN_AGENT', 'organiser/human approval still required for flight change');
  assert.ok(
    decision.ruleTrace.some((line) => line.includes('rule-ait-airfare-spend-limit') && line.includes('within limit')),
    `expected within-limit spend trace, got: ${decision.ruleTrace.join(' | ')}`,
  );
});

test('S7-FX-4: without org homeCurrency, resolveHomeCurrency yields none (fail closed)', () => {
  const home = resolveHomeCurrency({
    organisations: [{ id: 'org-ait-organiser' }],
    governedByRuleSetIds: ['rs-ait-organiser-policy'],
    ruleSets: [{ id: 'rs-ait-organiser-policy', ownerOrganisationId: 'org-ait-organiser' }],
  });
  assert.equal(home, undefined);

  const withHome = resolveHomeCurrency({
    organisations: [{ id: 'org-ait-organiser', homeCurrency: SGD }],
    governedByRuleSetIds: ['rs-ait-organiser-policy'],
    ruleSets: [{ id: 'rs-ait-organiser-policy', ownerOrganisationId: 'org-ait-organiser' }],
  });
  assert.equal(withHome, SGD);
});

test('S7-FX-5: LayeredFxRateResolver prefers budget evidence for the S7 USD→SGD pair', async () => {
  const resolver = new LayeredFxRateResolver({
    budgetRates: {
      async ratesFor(base, home) {
        return base === USD && home === SGD ? [RATE] : [];
      },
    },
    external: {
      todayIsoDate: () => '2026-08-26',
      quote: async () => ({ ok: false as const }),
    },
  });
  const rates = await resolver.ratesFor(USD, SGD);
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.id, RATE.id);
  assert.equal(rates[0]?.authority, 'CONNECTED');
});
