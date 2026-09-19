import test from 'node:test';
import assert from 'node:assert/strict';
import { IntelligenceClient, ScriptedModelTransport } from '../src/intelligence/client.ts';
import { interpretTravellerRequest, TravellerInterpretationInputSchema } from '../src/app/target/changeRequestInterpretation.ts';

const now = '2031-05-01T00:00:00Z';
const basic = { sourceUtterance: 'Please find a later departure', idempotencyKey: 'request-one' };

test('unconfigured interpretation asks for clarification; explicit reviewed fields need no model', async () => {
  assert.equal((await interpretTravellerRequest(basic, undefined, now)).status, 'CLARIFICATION_REQUIRED');
  const input = TravellerInterpretationInputSchema.parse({ ...basic, intentKind: 'CHANGE_TRANSPORT_SCHEDULE', urgency: 'HARD_INSTRUCTION', desiredTarget: { departAfter: '2031-05-02T10:00:00+08:00' } });
  const result = await interpretTravellerRequest(input, undefined, now);
  assert.equal(result.status, 'READY');
  if (result.status === 'READY') assert.deepEqual(result.interpretation, input);
});

test('schema-validated model proposal preserves authored identity and explicit preference strength', async () => {
  const transport = new ScriptedModelTransport([JSON.stringify({ status: 'READY', intentKind: 'CHANGE_TRANSPORT_SCHEDULE', urgency: 'HARD_INSTRUCTION', desiredTarget: { transport: { preferDirect: true } } })]);
  const result = await interpretTravellerRequest({ ...basic, urgency: 'SOFT_PREFERENCE' }, new IntelligenceClient({ transport }), now);
  assert.equal(result.status, 'READY');
  if (result.status === 'READY') {
    assert.equal(result.interpretation.urgency, 'SOFT_PREFERENCE');
    assert.equal(result.interpretation.sourceUtterance, basic.sourceUtterance);
    assert.equal(result.interpretation.idempotencyKey, basic.idempotencyKey);
  }
});

test('invalid output and invented entity relations require clarification', async () => {
  for (const response of ['not-json', JSON.stringify({ status: 'READY', intentKind: 'CHANGE_STAY', urgency: 'SOFT_PREFERENCE', desiredTarget: { preferredStayPlaceId: '00000000-0000-4000-8000-000000000001' } })]) {
    const result = await interpretTravellerRequest(basic, new IntelligenceClient({ transport: new ScriptedModelTransport([response]) }), now);
    assert.equal(result.status, 'CLARIFICATION_REQUIRED');
  }
});
