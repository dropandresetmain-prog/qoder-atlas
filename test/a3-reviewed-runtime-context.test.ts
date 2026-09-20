import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionRecoveryContext, deterministicInsertionOrder } from '../src/app/targetRecoveryContext.ts';
import { emptyWorld, id } from './support/m6World.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import { AssessmentResultSchema } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { FailingSubject } from '../src/resolution/planning/proposer.ts';

test('runtime context uses a deterministic order key strictly between captured neighbours', () => {
  const inserted = deterministicInsertionOrder('010', '020');
  assert.equal(inserted, '010.5');
  assert.ok(inserted! > '010' && inserted! < '020');
  assert.equal(deterministicInsertionOrder('010'), '010.5');
  assert.equal(deterministicInsertionOrder('010', '010.1'), undefined);
});

test('runtime context accepts only an exact current m6.connection break and anchors it at the upstream arrival', () => {
  const world = emptyWorld();
  const journeyId = id();
  const upstreamId = id();
  const downstreamId = id();
  const travellerId = id();
  const originId = id();
  const destinationId = id();
  world.journeys = [{ id: journeyId, revision: 1, tripId: id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null }];
  world.places = [
    { id: originId, revision: 1, name: 'origin', placeType: 'AIRPORT', timeZone: 'Asia/Tokyo', hasCoordinates: true },
    { id: destinationId, revision: 1, name: 'destination', placeType: 'AIRPORT', timeZone: 'Asia/Singapore', hasCoordinates: true },
  ];
  world.journeyItems = [
    { id: upstreamId, journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: true, intendedWindow: { start: '2026-09-29T00:00:00.000Z', end: '2026-09-29T09:00:00.000Z' }, desiredOriginPlaceId: originId, desiredDestinationPlaceId: originId, selectedServiceId: null, intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null },
    { id: downstreamId, journeyId, kind: 'TRANSPORT', orderKey: '020', lifecycleStatus: 'PLANNED', flexible: true, intendedWindow: { start: '2026-09-29T09:10:00.000Z', end: '2026-09-29T13:00:00.000Z' }, desiredOriginPlaceId: originId, desiredDestinationPlaceId: destinationId, selectedServiceId: null, intendedPlaceId: null, requiredNights: null, participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null },
  ];
  const subject = { kind: 'JOURNEY' as const, id: journeyId };
  const assessment = AssessmentResultSchema.parse({
    id: id(), kind: 'VIABILITY', evaluatedAt: '2026-09-29T00:00:00.000Z', manifest: world.manifest,
    subjects: [{ subjectRef: subject, role: 'PRIMARY' }], overallVerdict: 'FAIL',
    dimensions: [dimension({ dimension: 'connection_feasibility', explanations: [explain({
      evaluatorId: 'm6.connection', dimension: 'connection_feasibility', status: 'FAIL', reasonCode: 'connection_below_minimum',
      cause: { kind: 'WORLD_STATE' }, affectedSubject: subject,
      relatedSubjects: [{ kind: 'JOURNEY_ITEM', id: upstreamId }, { kind: 'JOURNEY_ITEM', id: downstreamId }],
      facts: { upstreamArrival: '2026-09-29T09:00:00.000Z', downstreamDeparture: '2026-09-29T09:10:00.000Z' },
    })] })],
  });
  const failing: FailingSubject[] = [{ subject, assessment }];
  const context = connectionRecoveryContext(world, failing, world.journeyItems[1]!, { timeZone: 'Asia/Tokyo' });
  assert.deepEqual(context, {
    upstreamJourneyItemId: upstreamId, downstreamJourneyItemId: downstreamId,
    upstreamArrival: '2026-09-29T09:00:00.000Z', downstreamDeparture: '2026-09-29T09:10:00.000Z',
    anchorDate: '2026-09-29', checkOutDate: '2026-09-30',
  });

  const generic = AssessmentResultSchema.parse({ ...assessment, id: id(), dimensions: [dimension({ dimension: 'supplier_fulfilment', explanations: [] })] });
  assert.equal(connectionRecoveryContext(world, [{ subject, assessment: generic }], world.journeyItems[1]!, { timeZone: 'Asia/Tokyo' }), undefined);
});
