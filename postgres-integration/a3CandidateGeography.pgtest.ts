/** A3 proof: an explicitly requested canonical place enters the captured geography. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTestPool } from './harness.ts';
import { attachSeedSession, beginSeed, commitSeed, seedJourney, seedTraveller, seedTrip } from './m2Seed.ts';
import { KnowledgeFixture, seedJurisdictionWithPlaces, seedTransportIntent } from './m6WorldSeed.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';

const NOW = '2032-01-01T00:00:00.000Z';

after(async () => (await sharedTestPool()).end());

test('PgWorldReader captures an explicit place focus with scoped geography and coverage', async () => {
  const pool = await sharedTestPool();

  const seed = await beginSeed(pool, 'A3 candidate geography');
  const geography = await seedJurisdictionWithPlaces(seed, {
    name: 'Candidate geography',
    places: [
      { name: 'Journey airport', placeType: 'AIRPORT', timeZone: 'Asia/Singapore' },
      { name: 'Journey destination airport', placeType: 'AIRPORT', timeZone: 'Asia/Singapore' },
      { name: 'Unrelated proposed hotel', placeType: 'HOTEL', timeZone: 'Asia/Tokyo' },
    ],
  });
  const traveller = await seedTraveller(seed);
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  await seedTransportIntent(seed, {
    journeyId,
    orderKey: '010',
    originPlaceId: geography.placeIds[0]!,
    destinationPlaceId: geography.placeIds[1]!,
    window: { start: '2032-01-02T00:00:00.000Z', end: '2032-01-02T04:00:00.000Z' },
  });
  await commitSeed(seed);

  // The reader must expose the actual coverage record and provenance through
  // the same workspace, without making a place part of the Journey first.
  const evidenceSeed = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
  await commitSeed(evidenceSeed);
  const knowledge = new KnowledgeFixture(pool, evidenceSeed);
  await knowledge.coverage({ topic: 'entry', jurisdictionId: geography.jurisdictionId, completeness: 'COMPLETE', edition: 'entry:a3' });

  const normal = await captureWorld(pool, {
    workspaceId: seed.workspaceId,
    focus: [{ kind: 'JOURNEY', id: journeyId }],
    at: NOW,
    informationTopics: ['entry'],
  });
  assert.ok(normal.places.some((place) => place.id === geography.placeIds[0]));
  assert.ok(normal.places.some((place) => place.id === geography.placeIds[1]));
  assert.ok(!normal.places.some((place) => place.id === geography.placeIds[2]), 'unrelated hotel is excluded without explicit focus');

  const focused = await captureWorld(pool, {
    workspaceId: seed.workspaceId,
    focus: [
      { kind: 'JOURNEY', id: journeyId },
      { kind: 'PLACE', id: geography.placeIds[2]! },
    ],
    at: NOW,
    informationTopics: ['entry'],
  });
  assert.equal(focused.places.find((place) => place.id === geography.placeIds[2])?.name, 'Unrelated proposed hotel');
  assert.ok(focused.placeJurisdictions.some((membership) => membership.placeId === geography.placeIds[2] && membership.jurisdictionId === geography.jurisdictionId));
  assert.ok(focused.coverage.some((coverage) => coverage.topic === 'entry' && coverage.edition === 'entry:a3'));
  assert.ok(focused.manifest.aggregateReads.some((read) => read.aggregateRef.kind === 'PLACE' && read.aggregateRef.id === geography.placeIds[2]));
  assert.ok(focused.manifest.scopeReads.some((read) => read.scopeKind === 'GEOGRAPHY' && read.scopeId === `jurisdiction:${geography.jurisdictionId}`));
  assert.ok(focused.manifest.coverageReads.some((read) => read.readerId === 'm6.world.place-jurisdictions'));
  assert.ok(focused.manifest.coverageReads.some((read) => read.readerId === 'm6.world.knowledge-coverage:entry'));

  // A same-shaped focus from another workspace cannot cross the canonical
  // workspace predicate, even when the UUID is valid.
  const foreignSeed = await beginSeed(pool, 'A3 foreign geography');
  const foreign = await seedJurisdictionWithPlaces(foreignSeed, {
    name: 'Foreign geography',
    places: [{ name: 'Foreign hotel', placeType: 'HOTEL', timeZone: 'Asia/Tokyo' }],
  });
  await commitSeed(foreignSeed);
  const foreignFocused = await captureWorld(pool, {
    workspaceId: seed.workspaceId,
    focus: [{ kind: 'PLACE', id: foreign.placeIds[0]! }],
    at: NOW,
    informationTopics: [],
  });
  assert.ok(!foreignFocused.places.some((place) => place.id === foreign.placeIds[0]), 'foreign workspace place does not leak');
  assert.ok(!foreignFocused.jurisdictions.some((jurisdiction) => jurisdiction.id === foreign.jurisdictionId));
});
