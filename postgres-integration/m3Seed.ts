/** Direct SQL fixtures for M3 integration tests. M3 tests use commands for the
 * behavior under test and this file only supplies owned-by-another-lane facts. */
import { randomUUID } from 'node:crypto';
import {
  beginSeed,
  commitSeed,
  rollbackSeed,
  opaqueRef,
  seedChildSubject,
  seedJourney,
  seedJourneyItem,
  seedRootSubject,
  seedTrip,
  seedTraveller,
  type SeedSession,
  type SeededJourneyItem,
  type SeededTraveller,
} from './m2Seed.ts';

export { beginSeed, commitSeed, rollbackSeed, opaqueRef, seedJourney, seedJourneyItem, seedRootSubject, seedChildSubject, seedTraveller, seedTrip };
export type { SeedSession, SeededJourneyItem, SeededTraveller };

export async function seedOrganisation(seed: SeedSession, currency = 'USD'): Promise<string> {
  const id = await seedRootSubject(seed, { kind: 'ORGANISATION' });
  await seed.client.query(
    `INSERT INTO organisations (workspace_id, id, legal_name, display_name, default_currency_code, created_by_actor_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [seed.workspaceId, id, 'M3 Seed Organisation', 'M3 Seed Organisation', currency, seed.actorId],
  );
  return id;
}

export async function seedTransportService(seed: SeedSession, params: { departure?: string; arrival?: string } = {}): Promise<string> {
  const id = await seedRootSubject(seed, { kind: 'TRANSPORT_SERVICE' });
  const evidence = randomUUID();
  await seed.client.query(
    `INSERT INTO transport_services
       (workspace_id,id,mode,operator,origin_place_id,destination_place_id,
        published_departure,published_arrival,published_observed_at,published_evidence_id,created_by_actor_id)
     VALUES ($1,$2,'AIR','M3 Seed Operator',$3,$4,$5,$6,$7,$8,$9)`,
    [seed.workspaceId, id, opaqueRef(), opaqueRef(), params.departure ?? '2030-01-01T00:00:00Z', params.arrival ?? '2030-01-01T02:00:00Z', '2030-01-01T00:00:00Z', evidence, seed.actorId],
  );
  return id;
}

export async function seedResource(seed: SeedSession, resourceType: 'VEHICLE' | 'ROOM' | 'EQUIPMENT' = 'ROOM'): Promise<string> {
  const id = await seedRootSubject(seed, { kind: 'RESOURCE' });
  await seed.client.query(
    `INSERT INTO resources (workspace_id,id,resource_type,location_place_id,capacity,created_by_actor_id)
     VALUES ($1,$2,$3,$4,1,$5)`,
    [seed.workspaceId, id, resourceType, opaqueRef(), seed.actorId],
  );
  const table = resourceType === 'ROOM' ? 'room_resource_details' : resourceType === 'VEHICLE' ? 'vehicle_resource_details' : 'equipment_resource_details';
  const extra = resourceType === 'ROOM' ? ', bed_configuration' : '';
  const value = resourceType === 'ROOM' ? ", 'standard'" : '';
  await seed.client.query(
    `INSERT INTO ${table} (workspace_id,resource_id,resource_type${extra}) VALUES ($1,$2,$3${value})`,
    [seed.workspaceId, id, resourceType],
  );
  return id;
}

export async function seedReservation(seed: SeedSession, params: { organisationId?: string; travellerId?: string; reservationType?: 'TRANSPORT' | 'STAY' | 'RESOURCE_USE' | 'MIXED' }): Promise<string> {
  if (!params.organisationId && !params.travellerId) throw new Error('M3 reservation fixture requires a responsible party');
  const id = await seedRootSubject(seed, { kind: 'RESERVATION' });
  await seed.client.query(
    `INSERT INTO reservations
       (workspace_id,id,reservation_type,observed_status,responsible_organisation_id,responsible_traveller_id,created_by_actor_id)
     VALUES ($1,$2,$3,'UNKNOWN',$4,$5,$6)`,
    [seed.workspaceId, id, params.reservationType ?? 'TRANSPORT', params.organisationId ?? null, params.travellerId ?? null, seed.actorId],
  );
  return id;
}

export async function seedReservationLine(seed: SeedSession, params: { reservationId: string; productType: 'TRANSPORT' | 'STAY' | 'RESOURCE_USE'; transportServiceId?: string; resourceId?: string }): Promise<string> {
  const id = randomUUID();
  await seedChildSubject(seed, { id, kind: 'RESERVATION_LINE', aggregateId: params.reservationId });
  const evidence = randomUUID();
  await seed.client.query(
    `INSERT INTO reservation_lines (workspace_id,id,reservation_id,product_type,observed_status,observed_status_at,observation_evidence_id,created_by_actor_id)
     VALUES ($1,$2,$3,$4,'CONFIRMED','2030-01-01T00:00:00Z',$5,$6)`,
    [seed.workspaceId, id, params.reservationId, params.productType, evidence, seed.actorId],
  );
  if (params.productType === 'TRANSPORT') {
    await seed.client.query(
      `INSERT INTO transport_line_details (workspace_id,line_id,product_type,transport_service_id) VALUES ($1,$2,'TRANSPORT',$3)`,
      [seed.workspaceId, id, params.transportServiceId],
    );
  } else if (params.productType === 'STAY') {
    await seed.client.query(
      `INSERT INTO stay_line_details (workspace_id,line_id,product_type,stay_interval_start,stay_interval_end,resource_id,place_id,occupancy)
       VALUES ($1,$2,'STAY','2030-01-01T00:00:00Z','2030-01-02T00:00:00Z',$3,$4,$5)`,
      [seed.workspaceId, id, params.resourceId ?? null, opaqueRef(), JSON.stringify({ guests: 2 })],
    );
  } else {
    await seed.client.query(
      `INSERT INTO resource_use_line_details (workspace_id,line_id,product_type,resource_id) VALUES ($1,$2,'RESOURCE_USE',$3)`,
      [seed.workspaceId, id, params.resourceId],
    );
  }
  return id;
}

export async function seedReservationAllocation(seed: SeedSession, params: { reservationId: string; lineId: string; travellerId: string; journeyItemId?: string; role?: string }): Promise<string> {
  const id = randomUUID();
  await seed.client.query(
    `INSERT INTO reservation_allocations (workspace_id,id,reservation_id,line_id,traveller_id,journey_item_id,allocation_role,quantity,created_by_actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
    [seed.workspaceId, id, params.reservationId, params.lineId, params.travellerId, params.journeyItemId ?? null, params.role ?? 'PRIMARY', seed.actorId],
  );
  return id;
}

export async function seedExternalConnection(seed: SeedSession, organisationId?: string): Promise<string> {
  const id = await seedRootSubject(seed, { kind: 'EXTERNAL_CONNECTION' });
  await seed.client.query(
    `INSERT INTO external_connections (workspace_id,id,organisation_id,provider_kind,created_by_actor_id) VALUES ($1,$2,$3,'M3_SEED',$4)`,
    [seed.workspaceId, id, organisationId ?? null, seed.actorId],
  );
  return id;
}

/**
 * M3's allocation tests need JourneyItems, but the shared test database may
 * already contain a later M4 schema whose place FKs are present. This fixture
 * supplies only the minimum opaque place rows when that additive schema exists;
 * it does not import or depend on M4 implementation code.
 */
export async function seedM3TransportJourneyItem(seed: SeedSession, journeyId: string): Promise<string> {
  const id = randomUUID();
  const origin = randomUUID();
  const destination = randomUUID();
  const placeTable = await seed.client.query<{ name: string | null }>("SELECT to_regclass('public.places') AS name");
  if (placeTable.rows[0]?.name) {
    await seed.client.query(
      `INSERT INTO places (workspace_id,id,name,place_type,time_zone,created_by_actor_id)
       VALUES ($1,$2,'M3 Seed Place','M3_TEST','UTC',$3),($1,$4,'M3 Seed Place Two','M3_TEST','UTC',$3)`,
      [seed.workspaceId, origin, seed.actorId, destination],
    );
  }
  await seedChildSubject(seed, { id, kind: 'JOURNEY_ITEM', aggregateId: journeyId });
  await seed.client.query(
    `INSERT INTO journey_items (workspace_id,id,journey_id,kind,order_key,lifecycle_status,created_by_actor_id)
     VALUES ($1,$2,$3,'TRANSPORT',$4,'PLANNED',$5)`,
    [seed.workspaceId, id, journeyId, id, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO transport_item_details (workspace_id,journey_item_id,kind,desired_origin_place_id,desired_destination_place_id)
     VALUES ($1,$2,'TRANSPORT',$3,$4)`,
    [seed.workspaceId, id, origin, destination],
  );
  return id;
}
