import test from 'node:test';
import assert from 'node:assert/strict';
import { compileActionPlan } from '../src/resolution/planning/compiler.ts';
import type { RecoveryStrategy } from '../src/contracts/v2/scenario/recoveryStrategy.ts';

const NOW = '2026-09-29T12:30:00.000Z';

test('CANCEL_STAY with zero cancellation penalty omits intent costEstimate (action_intents_cost_shape)', () => {
  const journeyId = '11111111-1111-4111-8111-111111111111';
  const reservationId = '22222222-2222-4222-8222-222222222222';
  const lineId = '33333333-3333-4333-8333-333333333333';
  const stayItemId = '44444444-4444-4444-8444-444444444444';
  const strategy: RecoveryStrategy = {
    id: '55555555-5555-4555-8555-555555555555',
    recoveryCaseId: '66666666-6666-4666-8666-666666666666',
    strategyVersion: 1,
    basisAssessmentId: '77777777-7777-4777-8777-777777777777',
    scenarioChange: {
      id: '88888888-8888-4888-8888-888888888888',
      effects: [{
        effectKind: 'CANCEL_STAY',
        journeyItemId: stayItemId,
        reservationLineId: lineId,
        cancellationPenalty: { amount: '0', currency: 'USD' },
      }],
    },
    baseManifest: {
      aggregateReads: [
        { aggregateRef: { kind: 'JOURNEY', id: journeyId }, revision: 1 },
        { aggregateRef: { kind: 'RESERVATION', id: reservationId }, revision: 1 },
      ],
    },
    assumptions: [],
    requiredUnknowns: [],
    candidateAssessments: [],
    candidateAssessmentResults: [],
    viability: 'VIABLE',
    requiredAuthorityScopes: ['journey.stay.cancel'],
    createdAt: NOW,
  };
  const compiled = compileActionPlan({
    strategy,
    now: NOW,
    capabilities: [{ capabilityRef: 'external:stay.cancel', supported: true }],
    stayCancellationOwnership: new Map([[lineId, { journeyId, reservationId }]]),
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const intent = compiled.value.plan.intents[0]!;
  assert.equal(intent.capabilityRef, 'external:stay.cancel');
  assert.equal(intent.costEstimate, undefined);
});
