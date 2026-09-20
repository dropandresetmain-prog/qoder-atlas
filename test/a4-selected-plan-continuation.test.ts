import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedEffectFingerprint, selectedPlanFingerprint, capabilityForSelectedEffect } from '../src/resolution/execution/selectedPlanIdentity.ts';
import { selectedProviderTermsMatch } from '../src/app/target/selectedPlanEvaluationInputs.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { randomUUID } from 'node:crypto';

const effect = { effectKind: 'SELECT_OFFER' as const, journeyItemId: randomUUID(), offerId: randomUUID(), offerPrice: { amount: '10.00', currency: 'USD' } };

test('source fingerprint survives PostgreSQL JSONB object-key reordering, never array reordering', () => {
  assert.equal(selectedEffectFingerprint(effect), selectedPlanFingerprint({ offerPrice: { currency: 'USD', amount: '10.00' }, offerId: effect.offerId, journeyItemId: effect.journeyItemId, effectKind: 'SELECT_OFFER' }));
  assert.notEqual(selectedPlanFingerprint([effect, { kind: 'later' }]), selectedPlanFingerprint([{ kind: 'later' }, effect]));
  assert.notEqual(selectedEffectFingerprint(effect), selectedEffectFingerprint({ ...effect, offerId: randomUUID() }));
});

test('F: provider identity, price, currency, dates and cancellation material changes invalidate exact approval terms', () => {
  const approved = { providerId: 'provider', offerId: 'offer', propertyId: 'property', rateId: 'rate',
    amount: '10.00', currency: 'USD', arrival: '2030-02-01', departure: '2030-02-02', cancellation: 'FREE_BEFORE_DEADLINE' };
  assert.equal(selectedProviderTermsMatch(approved, JSON.parse(JSON.stringify(approved))), true);
  for (const field of Object.keys(approved)) assert.equal(selectedProviderTermsMatch(approved, { ...approved, [field]: 'changed' }), false, field);
});

test('four-action selected source identity preserves both bookings and displaced cancellation separately', () => {
  const journeyId = randomUUID(); const oldItem = randomUUID(); const lineId = randomUUID();
  const scenario = ScenarioChangeSchema.parse({ id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }], basisAssessmentId: randomUUID(), effects: [effect,
      { effectKind: 'ADD_JOURNEY_STAY', journeyId, proposedJourneyItemId: randomUUID(), orderKey: '020', offerId: randomUUID(), offerPrice: { amount: '30', currency: 'USD' }, visit: { kind: 'EXISTING', visitId: randomUUID() } },
      { effectKind: 'ADD_JOURNEY_STAY', journeyId, proposedJourneyItemId: randomUUID(), orderKey: '040', offerId: randomUUID(), offerPrice: { amount: '40', currency: 'USD' }, replacesReservationLineId: lineId, visit: { kind: 'EXISTING', visitId: randomUUID() } },
      { effectKind: 'CANCEL_STAY', journeyItemId: oldItem, reservationLineId: lineId, cancellationPenalty: { amount: '5', currency: 'USD' }, cancellationPenaltyBasis: 'PROVIDER_POLICY' },
    ] });
  assert.deepEqual(scenario.effects.map(capabilityForSelectedEffect), ['external:offer.select','external:stay.book','external:stay.book','external:stay.cancel']);
  assert.equal(new Set(scenario.effects.map(selectedEffectFingerprint)).size,4);
  const residual = scenario.effects.slice(1).map(selectedEffectFingerprint);
  assert.equal(residual.length,3);
  assert.notEqual(selectedPlanFingerprint(residual),selectedPlanFingerprint(residual.slice(0,2)));
});
