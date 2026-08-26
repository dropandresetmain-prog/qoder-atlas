/**
 * Final-demo authority scoping: NIGHT spend ceilings and hotel approval
 * thresholds must not bind flight operations; flight-change approval uses
 * CapabilityOperation vocabulary (flight.change), not legacy FLIGHT_CHANGE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DeterministicAuthorityEngine, type RuleSetSource } from '../src/engine/authority.ts';
import type { RuleSet } from '../src/domain/rules.ts';
import type { ActionIntent } from '../src/operational/intent.ts';
import type { AuthorityContext } from '../src/contracts/services.ts';

function ruleSets(rules: RuleSet['rules']): RuleSetSource {
  const rs: RuleSet = {
    id: 'rs-test',
    kind: 'EVENT',
    name: 'test',
    ownerOrganisationId: 'org-test',
    sourceId: 'src-test',
    rules,
  };
  return { getRuleSet: async (id) => (id === rs.id ? rs : undefined) };
}

function flightIntent(spend: { amount: number; currency: string }): ActionIntent {
  return {
    id: 'intent-flight',
    caseId: 'case-1',
    strategyId: 'strat-1',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: {},
    sideEffectLevel: 'MONEY_MOVING',
    spendExposure: spend,
    providerSpend: spend,
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: '2026-09-18T12:00:00+08:00',
  };
}

function hotelIntent(spend: { amount: number; currency: string }): ActionIntent {
  return {
    id: 'intent-hotel',
    caseId: 'case-1',
    strategyId: 'strat-1',
    operation: 'hotel.modify',
    capability: 'HOTEL',
    parameters: {},
    sideEffectLevel: 'MONEY_MOVING',
    spendExposure: spend,
    providerSpend: spend,
    evidenceRefs: [],
    status: 'PROPOSED',
    createdAt: '2026-09-18T12:00:00+08:00',
  };
}

const ctx: AuthorityContext = {
  tripId: 'trip-1',
  caseId: 'case-1',
  ruleSetIds: ['rs-test'],
  principals: [],
  homeCurrency: 'SGD',
};

test('NIGHT SPEND_LIMIT does not block flight.change above the nightly hotel ceiling', async () => {
  const engine = new DeterministicAuthorityEngine({
    ruleSets: ruleSets([
      {
        id: 'rule-hotel-night',
        kind: 'SPEND_LIMIT',
        sourceId: 'src',
        appliesTo: [],
        maxAmount: { amount: 320, currency: 'SGD' },
        period: 'NIGHT',
      },
    ]),
  });
  const decision = await engine.decide(flightIntent({ amount: 468, currency: 'SGD' }), ctx);
  assert.notEqual(decision.outcome, 'BLOCKED');
  assert.ok(decision.ruleTrace.some((t) => /NIGHT spend limit skipped/.test(t)));
});

test('NIGHT SPEND_LIMIT still blocks hotel.modify above the nightly ceiling', async () => {
  const engine = new DeterministicAuthorityEngine({
    ruleSets: ruleSets([
      {
        id: 'rule-hotel-night',
        kind: 'SPEND_LIMIT',
        sourceId: 'src',
        appliesTo: [],
        maxAmount: { amount: 320, currency: 'SGD' },
        period: 'NIGHT',
      },
    ]),
  });
  const decision = await engine.decide(hotelIntent({ amount: 468, currency: 'SGD' }), ctx);
  assert.equal(decision.outcome, 'BLOCKED');
});

test('hotel APPROVAL_ABOVE_SPEND operations filter does not escalate flight.change', async () => {
  const engine = new DeterministicAuthorityEngine({
    ruleSets: ruleSets([
      {
        id: 'rule-hotel-approval',
        kind: 'APPROVAL_ABOVE_SPEND',
        sourceId: 'src',
        appliesTo: [],
        threshold: { amount: 320, currency: 'SGD' },
        approver: 'ORGANISATION_APPROVER',
        operations: ['hotel.book', 'hotel.modify', 'hotel.cancel'],
      },
    ]),
  });
  const decision = await engine.decide(flightIntent({ amount: 468, currency: 'SGD' }), ctx);
  assert.notEqual(decision.outcome, 'REQUIRES_ORGANISATION_APPROVER');
  assert.ok(decision.ruleTrace.some((t) => /operations .* do not include flight\.change/.test(t)));
});

test('flight.change APPROVAL_REQUIRED matches CapabilityOperation vocabulary', async () => {
  const engine = new DeterministicAuthorityEngine({
    ruleSets: ruleSets([
      {
        id: 'rule-flight-approval',
        kind: 'APPROVAL_REQUIRED',
        sourceId: 'src',
        appliesTo: [],
        approver: 'HUMAN_AGENT',
        operations: ['flight.change', 'flight.cancel'],
      },
    ]),
  });
  const decision = await engine.decide(flightIntent({ amount: 200, currency: 'SGD' }), ctx);
  assert.equal(decision.outcome, 'REQUIRES_HUMAN_AGENT');
});
