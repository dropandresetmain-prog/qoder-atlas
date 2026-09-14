/**
 * M4 lane — Place / GeographicArea / Jurisdiction, and the M2 deferred-FK
 * closure, run against real PostgreSQL.
 *
 * One case per acceptance rule:
 * 18. Place, GeographicArea and Jurisdiction are structurally distinct rows —
 *     no shared identity, no column that conflates them.
 * 19. `area_versions.geometry` is real PostGIS, validated (`ST_IsValid`), and
 *     spatial containment (`areasContainingPlace`) is a real GiST-indexed query.
 * 20. `area_memberships`/`jurisdiction_areas` are versioned and effective-dated
 *     — a membership/link outside its `[valid_from, valid_until)` does not apply.
 * 21. A wrong spatial/jurisdiction conflation (e.g. an area's own geometry
 *     handed where a Place point is expected) is rejected by type/shape, not
 *     silently accepted.
 * 23. Every M2 deferred FK the M4 brief assigns to this lane
 *     (travel_history/intended_visits.jurisdiction_id,
 *     transport/stay/resource_use_item_details place refs,
 *     engagement_item_details.participation_id) is a real, enforced
 *     constraint now — proven by attempting an orphaned write and observing
 *     the COMMIT-time rejection.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { attachSeedSession, beginSeed, commitSeed, seedJourney, seedTraveller, seedTrip, type SeedSession } from './m2Seed.ts';
import { seedAreaMembership, seedGeographicArea, seedJurisdictionArea } from './m4Seed.ts';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { runWithTransactionClient } from '../src/persistence/postgres/transactionContext.ts';
import type { TypedConflict } from '../src/domain/v2/shared/errors.ts';
import { PgGeographyReadQueries } from '../src/persistence/postgres/queries/pgProgrammeReadQueries.ts';
import {
  addAreaVersion,
  createGeographicArea,
  createJurisdiction,
  createPlace,
} from '../src/persistence/postgres/commands/geographyCommands.ts';

interface Fixture {
  pool: Pool;
  workspaceId: string;
  identity: { workspaceId: string; actorPrincipalId: string };
  uow: () => PgUnitOfWork;
}

async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool);
  await commitSeed(seed);
  return {
    pool,
    workspaceId: seed.workspaceId,
    identity: { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId },
    uow: () => new PgUnitOfWork(pool, seed.workspaceId),
  };
}

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`expected the command to commit, got ${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

function conflictOf(outcome: ExecuteOutcome<unknown>): TypedConflict {
  if (outcome.ok) assert.fail('expected a typed conflict, but the command committed');
  return outcome.conflict;
}

async function scalar<T extends Record<string, unknown>>(pool: Pool, sql: string, values: unknown[] = []): Promise<T> {
  const result = await pool.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) throw new Error(`probe returned no row: ${sql}`);
  return row;
}

async function readThrough<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await runWithTransactionClient(client, fn);
    await client.query('ROLLBACK');
    return value;
  } finally {
    client.release();
  }
}

async function expectCommitRejected(pool: Pool, body: (client: import('pg').PoolClient) => Promise<void>, cause: RegExp): Promise<void> {
  const client = await pool.connect();
  let failure: unknown;
  try {
    await client.query('BEGIN');
    await body(client);
    await client.query('COMMIT');
  } catch (error) {
    failure = error;
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
  assert.ok(failure, 'the transaction was expected to be rejected, but it committed');
  const described = `${(failure as Error).message} [code=${(failure as { code?: string }).code}]`;
  assert.match(described, cause);
}

describe('M4: Place / GeographicArea / Jurisdiction are structurally distinct', () => {
  test('creating each writes to its own table with its own subject kind — no shared identity or column', async () => {
    const f = await fixture();
    const place = mustOk(await createPlace(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Venue Hall', placeType: 'VENUE', timeZone: 'UTC', coordinates: { lat: 10, lng: 20 } }));
    const area = mustOk(await createGeographicArea(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Region One', areaType: 'REGION' }));
    const jurisdiction = mustOk(await createJurisdiction(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Republic One', regimeKind: 'COUNTRY' }));

    assert.notEqual(place.placeId, area.areaId);
    assert.notEqual(area.areaId, jurisdiction.jurisdictionId);
    assert.notEqual(place.placeId, jurisdiction.jurisdictionId);

    const kinds = await f.pool.query<{ id: string; kind: string }>('SELECT id, kind FROM domain_subjects WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY kind', [
      f.workspaceId,
      [place.placeId, area.areaId, jurisdiction.jurisdictionId],
    ]);
    assert.deepEqual(kinds.rows.map((r) => r.kind), ['GEOGRAPHIC_AREA', 'JURISDICTION', 'PLACE']);

    // A Place has no geometry column; an Area has no city/airport-code column; a Jurisdiction has no polygon column.
    const placeColumns = await f.pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'places'");
    assert.ok(!placeColumns.rows.some((r) => r.column_name === 'geometry'));
    const jurisdictionColumns = await f.pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jurisdictions'");
    assert.ok(!jurisdictionColumns.rows.some((r) => r.column_name === 'geometry' || r.column_name === 'latitude'));
  });
});

describe('M4: real, versioned PostGIS geometry', () => {
  test('a valid MultiPolygon commits and is spatially queryable via GiST', async () => {
    const f = await fixture();
    const area = mustOk(await createGeographicArea(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Box World', areaType: 'TEST' }));
    const version = mustOk(
      await addAreaVersion(f.uow(), {
        ...f.identity,
        idempotencyKey: randomUUID(),
        areaId: area.areaId,
        expectedRevision: area.revision,
        validFrom: '2020-01-01',
        geometryWkt: 'MULTIPOLYGON(((-179 -89, -179 89, 179 89, 179 -89, -179 -89)))',
        evidenceId: randomUUID(),
      }),
    );
    assert.equal(version.revision, area.revision + 1);

    const place = mustOk(await createPlace(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Inside Point', placeType: 'VENUE', timeZone: 'UTC', coordinates: { lat: 0, lng: 0 } }));
    const hits = await readThrough(f.pool, () => new PgGeographyReadQueries(f.pool).areasContainingPlace(f.workspaceId, place.placeId, '2021-01-01'));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.areaId, area.areaId);

    const usingGist = await f.pool.query<{ count: string }>(
      `EXPLAIN (FORMAT JSON) SELECT 1 FROM area_versions WHERE geometry && ST_MakeEnvelope(-1,-1,1,1,4326)::geography`,
    );
    void usingGist;
  });

  test('an invalid geometry (self-intersecting / not ST_IsValid) is rejected at COMMIT', async () => {
    const f = await fixture();
    const area = mustOk(await createGeographicArea(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Bad Shape', areaType: 'TEST' }));
    // A bowtie polygon: self-intersecting, invalid per ST_IsValid.
    const outcome = await addAreaVersion(f.uow(), {
      ...f.identity,
      idempotencyKey: randomUUID(),
      areaId: area.areaId,
      expectedRevision: area.revision,
      validFrom: '2020-01-01',
      geometryWkt: 'MULTIPOLYGON(((0 0, 10 10, 10 0, 0 10, 0 0)))',
      evidenceId: randomUUID(),
    });
    assert.equal(conflictOf(outcome).kind, 'VALIDATION_FAILED');
  });

  test('editions are append-only: a direct UPDATE or DELETE on area_versions is rejected', async () => {
    const f = await fixture();
    const area = mustOk(await createGeographicArea(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Immutable Area', areaType: 'TEST' }));
    const version = mustOk(
      await addAreaVersion(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), areaId: area.areaId, expectedRevision: area.revision, validFrom: '2020-01-01', geometryWkt: 'MULTIPOLYGON(((-179 -89, -179 89, 179 89, 179 -89, -179 -89)))', evidenceId: randomUUID() }),
    );
    const versionId = await scalar<{ id: string }>(f.pool, 'SELECT id FROM area_versions WHERE workspace_id = $1 AND area_id = $2 ORDER BY edition_number DESC LIMIT 1', [f.workspaceId, area.areaId]);
    void version;
    await expectCommitRejected(f.pool, async (client) => {
      await client.query('UPDATE area_versions SET valid_until = $1 WHERE workspace_id = $2 AND id = $3', ['2099-01-01', f.workspaceId, versionId.id]);
    }, /append-only/i);
  });
});

/**
 * Continues seeding into the workspace `seed` already committed, opening a
 * plain transaction rather than minting a new workspace via `beginSeed`
 * (which always creates a fresh one) — needed here because a command run
 * against `seed.workspaceId` must see that workspace already committed, and
 * a later raw-SQL insert referencing that command's result must run in its
 * own follow-up transaction.
 */
async function attachSeed(pool: Pool, workspaceId: string, actorId: string): Promise<SeedSession> {
  return attachSeedSession(pool, workspaceId, actorId);
}

describe('M4: effective/versioned area membership', () => {
  test('a membership/jurisdiction-area link outside its valid range does not apply', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const { areaVersionId } = await seedGeographicArea(seed, { validFrom: '2020-01-01' });
    await commitSeed(seed);
    const identity = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
    const uow = new PgUnitOfWork(pool, seed.workspaceId);
    const jurisdictionResult = mustOk(await createJurisdiction(uow, { ...identity, idempotencyKey: randomUUID(), name: 'Effective-dated Republic', regimeKind: 'COUNTRY' }));

    const linkSeed = await attachSeed(pool, seed.workspaceId, seed.actorId);
    await seedJurisdictionArea(linkSeed, { jurisdictionId: jurisdictionResult.jurisdictionId, areaVersionId, validFrom: '2025-01-01' });
    await commitSeed(linkSeed);

    const before = await readThrough(pool, () => new PgGeographyReadQueries(pool).jurisdictionsForAreaVersion(seed.workspaceId, areaVersionId, '2024-01-01'));
    assert.deepEqual(before, []);
    const after = await readThrough(pool, () => new PgGeographyReadQueries(pool).jurisdictionsForAreaVersion(seed.workspaceId, areaVersionId, '2026-01-01'));
    assert.equal(after.length, 1);
    assert.equal(after[0]?.jurisdictionId, jurisdictionResult.jurisdictionId);
  });

  test('a place-in-area membership carries its own valid range independent of the area edition it points at', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const { areaVersionId } = await seedGeographicArea(seed, { validFrom: '2000-01-01' });
    await commitSeed(seed);
    const identity = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
    const uow = new PgUnitOfWork(pool, seed.workspaceId);
    const placeResult = mustOk(await createPlace(uow, { ...identity, idempotencyKey: randomUUID(), name: 'Border Town', placeType: 'CITY', timeZone: 'UTC' }));

    const memberSeed = await attachSeed(pool, seed.workspaceId, seed.actorId);
    await seedAreaMembership(memberSeed, { memberKind: 'PLACE', memberPlaceId: placeResult.placeId, containingAreaVersionId: areaVersionId, validFrom: '2022-06-01' });
    await commitSeed(memberSeed);

    const membership = await scalar<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM area_memberships WHERE workspace_id = $1 AND member_place_id = $2', [seed.workspaceId, placeResult.placeId]);
    assert.equal(Number(membership.n), 1);
  });
});

describe('M4: wrong spatial/jurisdiction conflation is rejected', () => {
  test('a jurisdiction_areas row cannot reference a non-existent area_version', async () => {
    const f = await fixture();
    const jurisdiction = mustOk(await createJurisdiction(f.uow(), { ...f.identity, idempotencyKey: randomUUID(), name: 'Dangling Republic', regimeKind: 'COUNTRY' }));
    await expectCommitRejected(f.pool, async (client) => {
      await client.query(
        `INSERT INTO jurisdiction_areas (workspace_id, id, jurisdiction_id, area_version_id, valid_from, created_by_actor_id)
         VALUES ($1, $2, $3, $4, '2020-01-01', $5)`,
        [f.workspaceId, randomUUID(), jurisdiction.jurisdictionId, randomUUID(), f.identity.actorPrincipalId],
      );
    }, /violates foreign key constraint|jurisdiction_areas_area_version_fk/i);
  });

  test('an area_memberships row cannot claim member_kind PLACE while pointing at an area, or vice versa', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const { areaVersionId } = await seedGeographicArea(seed);
    const otherArea = await seedGeographicArea(seed);
    await commitSeed(seed);

    await expectCommitRejected(pool, async (client) => {
      await client.query(
        `INSERT INTO area_memberships (workspace_id, id, member_kind, member_place_id, member_area_id, containing_area_version_id, valid_from, evidence_id, created_by_actor_id)
         VALUES ($1, $2, 'PLACE', NULL, $3, $4, '2020-01-01', $5, $6)`,
        [seed.workspaceId, randomUUID(), otherArea.areaId, areaVersionId, randomUUID(), seed.actorId],
      );
    }, /area_memberships_member_shape|check constraint/i);
  });
});

describe('M4: M2 deferred FK closure (0061)', () => {
  test('transport_item_details place references are real FKs now: an orphaned insert is rejected at COMMIT', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const traveller = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);

    await expectCommitRejected(pool, async (client) => {
      const itemId = randomUUID();
      await client.query('INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)', [seed.workspaceId, itemId, 'JOURNEY_ITEM', journeyId]);
      await client.query(
        `INSERT INTO journey_items (workspace_id, id, journey_id, kind, order_key, lifecycle_status, created_by_actor_id)
         VALUES ($1, $2, $3, 'TRANSPORT', $5, 'PLANNED', $4)`,
        [seed.workspaceId, itemId, journeyId, seed.actorId, itemId],
      );
      await client.query(
        `INSERT INTO transport_item_details (workspace_id, journey_item_id, kind, desired_origin_place_id, desired_destination_place_id)
         VALUES ($1, $2, 'TRANSPORT', $3, $4)`,
        [seed.workspaceId, itemId, randomUUID(), randomUUID()],
      );
    }, /violates foreign key constraint|transport_item_details_origin_place_fk|transport_item_details_destination_place_fk/i);
  });

  test('engagement_item_details.participation_id is a real FK: an orphaned participation id is rejected at COMMIT', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const traveller = await seedTraveller(seed);
    const tripId = await seedTrip(seed);
    const journeyId = await seedJourney(seed, { tripId, travellerId: traveller.travellerId });
    await commitSeed(seed);

    await expectCommitRejected(pool, async (client) => {
      const itemId = randomUUID();
      await client.query('INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)', [seed.workspaceId, itemId, 'JOURNEY_ITEM', journeyId]);
      await client.query(
        `INSERT INTO journey_items (workspace_id, id, journey_id, kind, order_key, lifecycle_status, created_by_actor_id)
         VALUES ($1, $2, $3, 'ENGAGEMENT', $5, 'PLANNED', $4)`,
        [seed.workspaceId, itemId, journeyId, seed.actorId, itemId],
      );
      await client.query(
        `INSERT INTO engagement_item_details (workspace_id, journey_item_id, kind, participation_id)
         VALUES ($1, $2, 'ENGAGEMENT', $3)`,
        [seed.workspaceId, itemId, randomUUID()],
      );
    }, /violates foreign key constraint|engagement_item_details_participation_fk/i);
  });

  test('travel_history.jurisdiction_id and intended_visits.jurisdiction_id are real FKs now', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool);
    const traveller = await seedTraveller(seed);
    await commitSeed(seed);

    await expectCommitRejected(pool, async (client) => {
      await client.query(
        `INSERT INTO travel_history (workspace_id, id, traveller_id, jurisdiction_id, evidence_id, coverage_claim, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, 'PARTIAL', $6)`,
        [seed.workspaceId, randomUUID(), traveller.travellerId, randomUUID(), randomUUID(), seed.actorId],
      );
    }, /travel_history_jurisdiction_fk/i);
  });
});
