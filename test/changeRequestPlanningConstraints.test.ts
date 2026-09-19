import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeRequestPlanningBasisSchema } from '../src/contracts/v2/planning/changeRequestPlanning.ts';
import { deriveRequestPlanningContext } from '../src/resolution/planning/changeRequestConstraints.ts';

const ids = {
  request: '00000000-0000-4000-8000-000000000001',
  journey: '00000000-0000-4000-8000-000000000002',
  traveller: '00000000-0000-4000-8000-000000000003',
  place: '00000000-0000-4000-8000-000000000004',
};

test('hard typed request maps supported transport fields to constraints and retains unsupported desire as evidence', () => {
  const basis = ChangeRequestPlanningBasisSchema.parse({
    changeRequestId: ids.request,
    journeyId: ids.journey,
    representedTravellerId: ids.traveller,
    contentRevision: 1,
    lifecycleRevision: 2,
    lifecycle: 'ACCEPTED_FOR_PLANNING',
    urgency: 'HARD_INSTRUCTION',
    desiredTarget: {
      arriveBy: '2030-01-02T12:00:00.000Z',
      transport: { preferDirect: true, earliestDeparture: '2030-01-02T08:00:00.000Z' },
      preferredStayPlaceId: ids.place,
    },
  });
  const context = deriveRequestPlanningContext({ basis, journeyId: ids.journey, representedTravellerId: ids.traveller });
  assert.deepEqual(context.constraints.map((value) => [value.code, value.mode]), [
    ['request_arrive_by', 'HARD'],
    ['request_prefer_direct', 'HARD'],
    ['request_earliest_departure', 'HARD'],
  ]);
  assert.deepEqual(context.unresolved.map((value) => value.code), ['request_stay_selection_unresolved']);
  assert.equal(context.comparatorPreferences.length, 0);
  assert.deepEqual(context.requestedSubjects, [
    { kind: 'JOURNEY', id: ids.journey },
    { kind: 'TRAVELLER', id: ids.traveller },
  ]);
});

test('soft typed request becomes comparator preference rather than a viability exclusion', () => {
  const basis = ChangeRequestPlanningBasisSchema.parse({
    changeRequestId: ids.request,
    journeyId: ids.journey,
    representedTravellerId: ids.traveller,
    contentRevision: 1,
    lifecycleRevision: 3,
    lifecycle: 'ACCEPTED_FOR_PLANNING',
    urgency: 'SOFT_PREFERENCE',
    desiredTarget: { departAfter: '2030-01-02T08:00:00.000Z' },
  });
  const context = deriveRequestPlanningContext({ basis, journeyId: ids.journey, representedTravellerId: ids.traveller });
  assert.deepEqual(context.constraints, [{ code: 'request_depart_after', domain: 'TRANSPORT', mode: 'SOFT' }]);
  assert.deepEqual(context.comparatorPreferences.map((value) => value.code), ['request_depart_after']);
  assert.equal(context.unresolved.length, 0);
});
