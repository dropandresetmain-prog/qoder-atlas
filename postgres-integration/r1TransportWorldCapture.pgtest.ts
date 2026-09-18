/** R1 PostgreSQL proof: provider-facing Place refs survive the real world read. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { seedJourney, seedTraveller, seedTrip, seedJurisdictionWithPlaces, seedTransportIntent } from './m6WorldSeed.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { airportResolverFromCapturedWorld } from '../src/resolution/planning/transportCorridors.ts';

after(async () => (await sharedTestPool()).end());

test('PgWorldReader preserves place external refs for generalized transport research', async () => {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'R1 transport world capture');
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin', places: [{ name: 'Origin airport', placeType: 'AIRPORT', timeZone: 'Asia/Singapore' }] });
  const destination = await seedJurisdictionWithPlaces(seed, { name: 'Destination', places: [{ name: 'Destination airport', placeType: 'AIRPORT', timeZone: 'Asia/Singapore' }] });
  await seed.client.query(
    `INSERT INTO place_external_refs (workspace_id, id, place_id, provider_namespace, external_key, created_by_actor_id)
     VALUES ($1,$2,$3,'IATA','AAA',$6), ($1,$4,$5,'airport-code','BBB',$6)`,
    [seed.workspaceId, randomUUID(), origin.placeIds[0], randomUUID(), destination.placeIds[0], seed.actorId],
  );
  const traveller = await seedTraveller(seed);
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
  await seedTransportIntent(seed, {
    journeyId, orderKey: '010', originPlaceId: origin.placeIds[0]!, destinationPlaceId: destination.placeIds[0]!,
    window: { start: '2032-01-02T00:00:00.000Z', end: '2032-01-02T04:00:00.000Z' },
  });
  await commitSeed(seed);

  const world = await captureWorld(pool, {
    workspaceId: seed.workspaceId,
    focus: [{ kind: 'JOURNEY', id: journeyId }],
    at: '2032-01-01T00:00:00.000Z',
    informationTopics: [],
  });
  assert.deepEqual(world.places.find((place) => place.id === origin.placeIds[0])?.externalRefs, [{ system: 'IATA', value: 'AAA' }]);
  assert.deepEqual(world.places.find((place) => place.id === destination.placeIds[0])?.externalRefs, [{ system: 'airport-code', value: 'BBB' }]);
  const resolveAirport = airportResolverFromCapturedWorld(world);
  assert.deepEqual(resolveAirport(origin.placeIds[0]!), { system: 'IATA', value: 'AAA' });
  assert.deepEqual(resolveAirport(destination.placeIds[0]!), { system: 'IATA', value: 'BBB' });
});
