/** M3 arrangement semantics against the real PostgreSQL/PostGIS target. */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed, seedJourney, seedM3TransportJourneyItem, seedOrganisation, seedTraveller, seedTrip, type SeedSession } from './m3Seed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { PgArrangementReadQueries } from '../src/persistence/postgres/queries/pgArrangementReadQueries.ts';
import {
  addReservationLine,
  addOfferItem,
  createCommercialAgreement,
  createOffer,
  createReservation,
  createResource,
  createTransportService,
  allocateReservationLine,
  recordReservationLineObservation,
  recordTransportObservation,
} from '../src/persistence/postgres/commands/arrangementCommands.ts';

const AT0 = '2030-01-01T00:00:00.000Z';
const AT1 = '2030-01-01T01:00:00.000Z';
const AT2 = '2030-01-01T02:00:00.000Z';
const AT3 = '2030-01-01T03:00:00.000Z';
const EARLY = '2029-12-31T23:00:00.000Z';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

function identity(seed: SeedSession) {
  return { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
}

function serviceInput(mode: 'AIR' | 'RAIL' | 'ROAD' | 'SEA') {
  const sourceId = randomUUID();
  return {
    mode,
    operator: 'operator',
    originPlaceId: randomUUID(),
    destinationPlaceId: randomUUID(),
    publishedDeparture: { value: AT0, observedAt: AT0, sourceId },
    publishedArrival: { value: AT2, observedAt: AT0, sourceId },
  } as const;
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>) {
  if (outcome.ok) assert.fail('expected a typed conflict');
  return outcome.conflict;
}

async function scalar<T extends Record<string, unknown>>(pool: Awaited<ReturnType<typeof sharedTestPool>>, sql: string, values: unknown[] = []): Promise<T> {
  const result = await pool.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) throw new Error('probe returned no row');
  return row;
}

async function setup() {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'M3 arrangement fixture');
  const organisationId = await seedOrganisation(seed, 'USD');
  const travellerA = await seedTraveller(seed);
  const travellerB = await seedTraveller(seed);
  const tripA = await seedTrip(seed);
  const tripB = await seedTrip(seed);
  const journeyA = await seedJourney(seed, { tripId: tripA, travellerId: travellerA.travellerId });
  const journeyB = await seedJourney(seed, { tripId: tripB, travellerId: travellerB.travellerId });
  const itemA = await seedM3TransportJourneyItem(seed, journeyA);
  const itemB = await seedM3TransportJourneyItem(seed, journeyB);
  await commitSeed(seed);
  return { pool, seed, organisationId, travellerA: travellerA.travellerId, travellerB: travellerB.travellerId, tripA, tripB, journeyA, journeyB, itemA, itemB };
}

describe('M3 services, reservations, allocations, and enterprise context', () => {
  test('service/resource subtype roots, supplier schedule ownership, and UUID boundary', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const invalid = await createTransportService(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(),
      service: { ...serviceInput('AIR'), id: 'not-a-uuid' },
    });
    assert.equal(conflictOf(invalid).kind, 'VALIDATION_FAILED');

    const service = mustOk(await createTransportService(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(),
      service: serviceInput('AIR'),
    }));
    const estimated = mustOk(await recordTransportObservation(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(), serviceId: service.id, expectedRevision: 1,
      observation: { field: 'ESTIMATED', departure: AT1, arrival: AT3, observedAt: AT1, evidenceId: randomUUID() },
    }));
    assert.equal(estimated.status, 'APPLIED');
    const times = await scalar<{ published_departure: Date; estimated_departure: Date; actual_departure: Date | null }>(f.pool, 'SELECT published_departure, estimated_departure, actual_departure FROM transport_services WHERE workspace_id=$1 AND id=$2', [f.seed.workspaceId, service.id]);
    assert.equal(times.published_departure.toISOString(), AT0);
    assert.equal(times.estimated_departure.toISOString(), AT1);
    assert.equal(times.actual_departure, null);

    const actual = mustOk(await recordTransportObservation(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(), serviceId: service.id, expectedRevision: 2,
      observation: { field: 'ACTUAL', departure: EARLY, arrival: AT1, observedAt: AT2, evidenceId: randomUUID() },
    }));
    assert.equal(actual.status, 'APPLIED');
    const early = await scalar<{ actual_departure: Date }>(f.pool, 'SELECT actual_departure FROM transport_services WHERE workspace_id=$1 AND id=$2', [f.seed.workspaceId, service.id]);
    assert.equal(early.actual_departure.toISOString(), EARLY);

    const resource = mustOk(await createResource(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(),
      resource: { resourceType: 'ROOM', placeId: randomUUID(), capacity: 2 }, detail: { resourceType: 'ROOM', bedConfiguration: 'double' },
    }));
    const kinds = await f.pool.query<{ kind: string; checker_function: string }>('SELECT kind, checker_function FROM subject_subtype_checkers WHERE kind IN ($1,$2) ORDER BY kind', ['RESOURCE', 'TRANSPORT_SERVICE']);
    assert.deepEqual(kinds.rows.map((row) => row.kind), ['RESOURCE', 'TRANSPORT_SERVICE']);
    const deferredM3Fks = await f.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conname = ANY($1::text[]) ORDER BY conname`,
      [['transport_item_details_selected_service_fk', 'resource_use_item_details_resource_fk']],
    );
    assert.deepEqual(
      deferredM3Fks.rows.map((row) => row.conname),
      ['resource_use_item_details_resource_fk', 'transport_item_details_selected_service_fk'],
    );
    assert.ok(resource.id);

    const client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM room_resource_details WHERE workspace_id = $1 AND resource_id = $2',
        [f.seed.workspaceId, resource.id],
      );
      await assert.rejects(
        () => client.query('COMMIT'),
        /typed detail rows/i,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  test('one shared reservation has explicit multi-Traveller allocations and rejects JourneyItem mismatch', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const foreignSeed = await beginSeed(f.pool, 'M3 foreign workspace fixture');
    const foreignTraveller = await seedTraveller(foreignSeed);
    await commitSeed(foreignSeed);
    const crossWorkspace = await createReservation(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(),
      reservation: { reservationType: 'TRANSPORT', responsibleTravellerId: foreignTraveller.travellerId },
    });
    assert.equal(conflictOf(crossWorkspace).kind, 'VALIDATION_FAILED');

    const serviceId = mustOk(await createTransportService(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(),
      service: serviceInput('RAIL'),
    })).id;
    const reservationId = mustOk(await createReservation(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(),
      reservation: { reservationType: 'TRANSPORT', responsibleOrganisationId: f.organisationId, observedStatus: 'UNKNOWN' },
    })).id;
    const lineId = mustOk(await addReservationLine(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(), reservationId, expectedRevision: 1,
      line: { productType: 'TRANSPORT', observedStatus: 'UNKNOWN' }, detail: { productType: 'TRANSPORT', transportServiceId: serviceId },
    })).lineId;
    const first = mustOk(await allocateReservationLine(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(), reservationId, expectedRevision: 2,
      allocation: { reservationLineId: lineId, travellerId: f.travellerA, journeyItemId: f.itemA, allocationRole: 'PRIMARY', quantity: 1 },
    }));
    assert.ok(first.allocationId);
    const second = mustOk(await allocateReservationLine(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(), reservationId, expectedRevision: 3,
      allocation: { reservationLineId: lineId, travellerId: f.travellerB, journeyItemId: f.itemB, allocationRole: 'COMPANION', quantity: 1 },
    }));
    assert.ok(second.allocationId);
    const mismatch = await allocateReservationLine(uow(), {
      ...identity(f.seed), idempotencyKey: randomUUID(), reservationId, expectedRevision: 4,
      allocation: { reservationLineId: lineId, travellerId: f.travellerB, journeyItemId: f.itemA, allocationRole: 'MISMATCH', quantity: 1 },
    });
    assert.equal(conflictOf(mismatch).kind, 'VALIDATION_FAILED');
    const reads = new PgArrangementReadQueries(f.pool);
    const allocations = await reads.allocationsForReservation(f.seed.workspaceId, reservationId);
    assert.equal(allocations.length, 2);
    assert.deepEqual(new Set(allocations.map((row) => row.travellerId)), new Set([f.travellerA, f.travellerB]));
    assert.equal((await scalar<{ n: string }>(f.pool, 'SELECT COUNT(*)::text AS n FROM reservations WHERE workspace_id=$1 AND id=$2', [f.seed.workspaceId, reservationId])).n, '1');
  });

  test('line observation is stale-safe and entitlement issuance remains separate from confirmation', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const serviceId = mustOk(await createTransportService(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), service: serviceInput('ROAD') })).id;
    const reservationId = mustOk(await createReservation(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), reservation: { reservationType: 'TRANSPORT', responsibleTravellerId: f.travellerA, observedStatus: 'CONFIRMED', observedStatusAt: AT1 } })).id;
    const evidence = randomUUID();
    const lineId = mustOk(await addReservationLine(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), reservationId, expectedRevision: 1, line: { productType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: AT1, observationEvidenceId: evidence }, detail: { productType: 'TRANSPORT', transportServiceId: serviceId } })).lineId;
    const stale = await recordReservationLineObservation(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), reservationId, lineId, expectedRevision: 2, observation: { observedStatus: 'HELD', observedStatusAt: AT0, observationEvidenceId: randomUUID() } });
    assert.equal(mustOk(stale).status, 'STALE');
    const query = new PgArrangementReadQueries(f.pool);
    assert.equal((await query.entitlementsForLine(f.seed.workspaceId, lineId)).length, 0, 'reservation confirmation must not create an entitlement');
  });

  test('commercial agreement versions are append-only and private offers expire', async () => {
    const f = await setup();
    const uow = () => new PgUnitOfWork(f.pool, f.seed.workspaceId);
    const agreementId = mustOk(await createCommercialAgreement(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), agreement: { organisationId: f.organisationId, publishedTerms: { rate: 'private' }, eligibleAccountIds: [], publishedAt: AT0 } })).id;
    const offerId = mustOk(await createOffer(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), offer: { sourceId: randomUUID(), accountId: f.organisationId, price: { amount: '123456789012345.67', currency: 'USD' }, quotedAt: AT0, expiresAt: AT2, fingerprint: randomUUID(), eligiblePartyRef: f.organisationId, eligiblePartyKind: 'ORGANISATION' } })).id;
    mustOk(await addOfferItem(uow(), { ...identity(f.seed), idempotencyKey: randomUUID(), offerId, expectedRevision: 1, detail: { productType: 'STAY', placeId: randomUUID(), stayInterval: { start: AT1, end: AT2 } }, amount: { amount: '123456789012345.67', currency: 'USD' } }));
    const eligible = await new PgArrangementReadQueries(f.pool).offersEligibleFor(f.seed.workspaceId, { at: AT1, organisationIds: [f.organisationId] });
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0]?.price.amount, '123456789012345.67');
    assert.equal((await new PgArrangementReadQueries(f.pool).offersEligibleFor(f.seed.workspaceId, { at: AT2, organisationIds: [f.organisationId] })).length, 0);
    assert.equal(agreementId.length, 36);
  });
});
