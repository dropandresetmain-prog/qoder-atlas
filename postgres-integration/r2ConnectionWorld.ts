/**
 * R2 second-generality world: a broken connection with NO programme (two air legs
 * through a hub, a minimum-connection rule). Shared by the focused-graph PG proof and
 * the local browser-acceptance harness so both exercise the identical world.
 */
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import {
  KnowledgeFixture, seedBooking, seedJourney, seedJurisdictionWithPlaces, seedService,
  seedTransportIntent, seedTraveller, seedTrip,
} from './m6WorldSeed.ts';
import { worldAt, type DisruptedWorld, type WorldSpec } from './r1ProgrammeWorld.ts';

export const CONN_SPEC: WorldSpec = {
  day: '2026-09-05',
  now: '2026-09-04T22:00:00.000Z',
  transport: { originIata: 'MNL', destinationIata: 'CEB', timeZone: 'Asia/Manila' },
};

export async function seedConnectionWorld(label: string, spec: WorldSpec): Promise<DisruptedWorld> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, label);
  const tz = spec.transport!.timeZone;
  const at = (hhmm: string) => worldAt(spec, hhmm);
  const observedAt = new Date(Date.parse(spec.now) - 3 * 86_400_000).toISOString();
  const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin', placeType: 'AIRPORT', timeZone: tz }] });
  const hub = await seedJurisdictionWithPlaces(seed, { name: 'Hub regime', places: [{ name: 'Hub', placeType: 'AIRPORT', timeZone: tz }] });
  const dest = await seedJurisdictionWithPlaces(seed, { name: 'Destination regime', places: [{ name: 'Destination', placeType: 'STATION', timeZone: tz }] });
  const [originId] = origin.placeIds as [string];
  const [hubId] = hub.placeIds as [string];
  const [destId] = dest.placeIds as [string];
  await seed.client.query(
    `INSERT INTO place_external_refs (workspace_id, id, place_id, provider_namespace, external_key, created_by_actor_id)
     VALUES ($1,$2,$3,'IATA',$4,$7), ($1,$5,$6,'IATA',$8,$7)`,
    [seed.workspaceId, randomUUID(), originId, spec.transport!.originIata, randomUUID(), hubId, seed.actorId, spec.transport!.destinationIata],
  );
  const traveller = await seedTraveller(seed, { displayName: 'Connection Traveller' });
  const tripId = await seedTrip(seed, { purpose: 'TEST', lifecycleStatus: 'ACTIVE' });
  const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId, lifecycleStatus: 'ACTIVE' });
  const inboundServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: originId, destinationPlaceId: hubId, published: { departure: at('05:00'), arrival: at('08:00'), observedAt } });
  const onwardServiceId = await seedService(seed, { mode: 'AIR', operator: 'Carrier', originPlaceId: hubId, destinationPlaceId: destId, published: { departure: at('12:00'), arrival: at('14:00'), observedAt } });
  const inboundItem = await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: originId, destinationPlaceId: hubId, selectedServiceId: inboundServiceId, window: { start: at('03:00'), end: at('06:00') } });
  const onwardItem = await seedTransportIntent(seed, { journeyId, orderKey: '020', originPlaceId: hubId, destinationPlaceId: destId, selectedServiceId: onwardServiceId, window: { start: at('11:00'), end: at('13:00') } });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: inboundServiceId, journeyItemId: inboundItem });
  await seedBooking(seed, { travellerId: traveller.travellerId, serviceId: onwardServiceId, journeyItemId: onwardItem });
  await commitSeed(seed);
  const knowledge = new KnowledgeFixture(pool, seed);
  for (const jurisdictionId of [origin.jurisdictionId, hub.jurisdictionId, dest.jurisdictionId]) {
    for (const topic of ['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT']) await knowledge.coverage({ topic, completeness: 'COMPLETE', jurisdictionId });
  }
  await knowledge.constraint({
    registeredType: 'minimum_connection_minutes', hardness: 'HARD', owner: { kind: 'PLACE', id: hubId },
    operands: [{ key: 'minutes', kind: 'NUMBER', value: 60 }],
  });
  return { spec, seed, workspaceId: seed.workspaceId, actorId: seed.actorId, people: [{ travellerId: traveller.travellerId, journeyId, tripId }], sharedServiceId: inboundServiceId };
}
