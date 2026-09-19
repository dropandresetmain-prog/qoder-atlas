import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesiredChangeTargetSchema, targetLinksForDesiredChange } from '../src/contracts/v2/change/changeRequest.ts';

test('typed desired target rejects an empty desire and derives only target-native links', () => {
  assert.equal(DesiredChangeTargetSchema.safeParse({}).success, false);
  const target = DesiredChangeTargetSchema.parse({
    preferredStayPlaceId: '00000000-0000-4000-8000-000000000001',
    travelWithTravellerIds: ['00000000-0000-4000-8000-000000000002'],
    objectiveEffects: [{ objectiveId: '00000000-0000-4000-8000-000000000003', effect: 'WAIVE' }],
  });
  assert.deepEqual(targetLinksForDesiredChange(target), [
    { role: 'OBJECTIVE_EFFECT', targetRef: { kind: 'OBJECTIVE', id: '00000000-0000-4000-8000-000000000003' } },
    { role: 'STAY_PLACE', targetRef: { kind: 'PLACE', id: '00000000-0000-4000-8000-000000000001' } },
    { role: 'TRAVEL_WITH_TRAVELLER', targetRef: { kind: 'TRAVELLER', id: '00000000-0000-4000-8000-000000000002' } },
  ]);
});
