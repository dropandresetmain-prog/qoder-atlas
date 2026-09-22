/**
 * M2-M5 integration seam proofs (docs/refactor/evidence/M2_M5_INTEGRATION.md).
 *
 * Each domain lane was accepted in isolation, so none of its own suites can
 * prove what only exists once all four lanes share one schema:
 *  1. the combined migration chain applies from an EMPTY database in exact
 *     lane-allocation order, with unused ranges left unused;
 *  2. every cross-lane reference deferred while the lanes were isolated is a
 *     real, validated, deferrable foreign key after 0087;
 *  3. those FKs reject orphans and cross-workspace borrowing in each direction
 *     (M3->M4, M4->M3, M5->M4, M2/M3/M4->M5).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createEphemeralDatabase, MIGRATIONS_DIR, sharedTestPool } from './harness.ts';
import { runMigrations } from '../src/persistence/postgres/migrate.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { beginSeed, commitSeed, seedTraveller, takeSeedEvidence, type SeedSession } from './m2Seed.ts';
import { appendAccompanimentRequirement } from '../src/persistence/postgres/commands/supportCommands.ts';
import { seedResource, seedTransportService } from './m3Seed.ts';
import { seedEvent, seedGeographicArea, seedJurisdiction, seedPlace, seedProgramme, seedProgrammeItem } from './m4Seed.ts';
import { createResourceAssignment } from '../src/persistence/postgres/commands/programmeCommands.ts';
import { createOrganisation } from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  ingestInformationVersion,
  recordInformationRecord,
  recordInformationScope,
} from '../src/persistence/postgres/commands/knowledgeCommands.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

/** Lane migration allocation, docs/refactor/MIGRATION_MAPPING.md. */
const LANE_RANGES = [
  { lane: 'M1', from: 1, to: 9 },
  { lane: 'M2', from: 10, to: 29 },
  { lane: 'M3', from: 30, to: 49 },
  { lane: 'M4', from: 50, to: 69 },
  { lane: 'M5', from: 70, to: 89 },
  { lane: 'M6', from: 90, to: 99 },
  { lane: 'M7', from: 100, to: 108 },
  { lane: 'M8', from: 109, to: 119 },
  { lane: 'M9', from: 120, to: 139 },
] as const;

/** Every constraint 0087 adds: `table.constraint` (M2_M5_INTEGRATION.md §4). */
const CROSS_LANE_FKS = [
  'transport_services.transport_services_origin_place_fk',
  'transport_services.transport_services_destination_place_fk',
  'resources.resources_location_place_fk',
  'stay_line_details.stay_line_details_place_fk',
  'resource_use_line_details.resource_use_line_details_place_fk',
  'offer_items.offer_items_place_fk',
  'resource_assignments.resource_assignments_resource_fk',
  'source_sync_state.source_sync_state_external_connection_fk',
  'objective_targets.objective_targets_place_fk',
  'rule_assignments.rule_assignments_jurisdiction_fk',
  'regulatory_publications.regulatory_publications_jurisdiction_fk',
  'information_scopes.information_scopes_jurisdiction_fk',
  'information_scopes.information_scopes_area_version_fk',
  'authority_grants.authority_grants_evidence_fk',
  'transport_services.transport_services_published_evidence_fk',
  'transport_services.transport_services_estimated_evidence_fk',
  'transport_services.transport_services_actual_evidence_fk',
  'reservation_lines.reservation_lines_observation_evidence_fk',
  'service_entitlements.service_entitlements_observation_evidence_fk',
  'external_record_links.external_record_links_evidence_fk',
  'ownership_bindings.ownership_bindings_evidence_fk',
  'provider_capabilities.provider_capabilities_observation_evidence_fk',
  'budget_entries.budget_entries_evidence_fk',
  'area_versions.area_versions_evidence_fk',
  'area_memberships.area_memberships_evidence_fk',
];

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) assert.fail(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

async function expectCommitRejected(pool: Pool, body: (client: PoolClient) => Promise<void>, cause: RegExp): Promise<void> {
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
  assert.match((failure as Error).message, cause);
}

async function committedSeed(pool: Pool, build: (seed: SeedSession) => Promise<void>): Promise<SeedSession> {
  const seed = await beginSeed(pool, 'integration cross-lane fixture');
  await build(seed);
  await commitSeed(seed);
  return seed;
}

describe('M2-M5 integration: migration chain from an empty database', () => {
  test('0001-0124 domain lanes plus M6/M7/M8/M9 apply in exact lane order; unused allocations stay unused', async () => {
    const db = await createEphemeralDatabase();
    try {
      const applied = await runMigrations(db.pool, MIGRATIONS_DIR);
      void applied;
      const rows = await db.pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
      const versions = rows.rows.map((row) => Number(row.version));
      assert.ok(versions.length > 0, 'ledger must record applied migrations');
      assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'ledger order is numeric order');
      assert.equal(new Set(versions).size, versions.length, 'no duplicate version');

      const inLane = (lane: string) => {
        const range = LANE_RANGES.find((r) => r.lane === lane);
        if (!range) throw new Error(lane);
        return versions.filter((v) => v >= range.from && v <= range.to);
      };
      const contiguous = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
      assert.deepEqual(inLane('M1'), contiguous(1, 9));
      assert.deepEqual(inLane('M2'), contiguous(10, 29));
      assert.deepEqual(inLane('M3'), contiguous(30, 49));
      assert.deepEqual(inLane('M4'), contiguous(50, 62), 'M4 used 0050-0062; 0063-0069 are deliberately unused');
      assert.deepEqual(inLane('M5'), contiguous(70, 87), 'M5 range: lane 0070-0086 plus integration closure 0087');
      assert.deepEqual(inLane('M7'), contiguous(100, 102), 'M7 used 0100-0102; 0103-0108 reserved; 0109-0119 for M8');
      assert.deepEqual(inLane('M8'), contiguous(109, 114), 'M8 used 0109-0114; 0115-0119 reserved');
      assert.deepEqual(
        inLane('M9'),
        contiguous(120, 137),
        'M9 additive extensions through 0137: change requests, planning model activity, sandbox documents, selected-plan continuation, stay execution inputs, canonical receipts, evaluation clock, and planning evidence room',
      );
      assert.ok(versions.every((v) => LANE_RANGES.some((r) => v >= r.from && v <= r.to)), 'no migration outside an allocated range');

      // A rerun on the fully migrated schema is a no-op (checksums unchanged).
      await runMigrations(db.pool, MIGRATIONS_DIR);
      const again = await db.pool.query<{ count: string }>('SELECT count(*) FROM schema_migrations');
      assert.equal(Number(again.rows[0]?.count), versions.length);
    } finally {
      await db.drop();
    }
  });
});

describe('M2-M5 integration: cross-lane foreign keys are real (0087)', () => {
  test('every deferred cross-lane reference is a validated, deferrable, workspace-scoped FK', async () => {
    const pool = await sharedTestPool();
    const rows = await pool.query<{ table_name: string; conname: string; contype: string; condeferrable: boolean; convalidated: boolean; columns: string[] }>(
      `SELECT c.conrelid::regclass::text AS table_name, c.conname, c.contype, c.condeferrable, c.convalidated,
              ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS columns
         FROM pg_constraint c
        WHERE c.conname = ANY($1::text[])`,
      [CROSS_LANE_FKS.map((entry) => entry.split('.')[1])],
    );
    const found = new Map(rows.rows.map((row) => [`${row.table_name}.${row.conname}`, row]));
    for (const expected of CROSS_LANE_FKS) {
      const row = found.get(expected);
      assert.ok(row, `${expected} must exist`);
      assert.equal(row.contype, 'f', `${expected} must be a foreign key`);
      assert.equal(row.condeferrable, true, `${expected} must be deferrable`);
      assert.equal(row.convalidated, true, `${expected} must be validated`);
      assert.equal(row.columns[0], 'workspace_id', `${expected} must lead with workspace_id`);
    }
  });

  test('M3 -> M4: a supplier service cannot name a place that does not exist', async () => {
    const pool = await sharedTestPool();
    let evidenceId = '';
    const seed = await committedSeed(pool, async (s) => {
      evidenceId = takeSeedEvidence(s);
    });
    await expectCommitRejected(pool, async (client) => {
      const id = randomUUID();
      await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [seed.workspaceId, id]);
      await client.query("INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'TRANSPORT_SERVICE', $2)", [seed.workspaceId, id]);
      await client.query(
        `INSERT INTO transport_services (workspace_id, id, mode, operator, origin_place_id, destination_place_id,
            published_departure, published_arrival, published_observed_at, published_evidence_id, created_by_actor_id)
         VALUES ($1, $2, 'RAIL', 'integration', $3, $4, '2030-01-01T00:00:00Z', '2030-01-01T02:00:00Z', '2030-01-01T00:00:00Z', $5, 'principal:integration')`,
        [seed.workspaceId, id, randomUUID(), randomUUID(), evidenceId],
      );
    }, /transport_services_(origin|destination)_place_fk/);
  });

  test('M3 -> M4: a place from another workspace cannot be borrowed', async () => {
    const pool = await sharedTestPool();
    let foreignPlace = '';
    await committedSeed(pool, async (seed) => {
      foreignPlace = await seedPlace(seed, { name: 'Other workspace place' });
    });
    const seed = await committedSeed(pool, async () => undefined);
    await expectCommitRejected(pool, async (client) => {
      const id = randomUUID();
      await client.query('INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)', [seed.workspaceId, id]);
      await client.query("INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, 'RESOURCE', $2)", [seed.workspaceId, id]);
      await client.query(
        `INSERT INTO resources (workspace_id, id, resource_type, location_place_id, capacity, created_by_actor_id)
         VALUES ($1, $2, 'EQUIPMENT', $3, 1, 'principal:integration')`,
        [seed.workspaceId, id, foreignPlace],
      );
      await client.query("INSERT INTO equipment_resource_details (workspace_id, resource_id, resource_type) VALUES ($1, $2, 'EQUIPMENT')", [seed.workspaceId, id]);
    }, /resources_location_place_fk/);
  });

  test('M4 -> M3: a programme resource assignment must name a real M3 Resource', async () => {
    const pool = await sharedTestPool();
    let programmeItemId = '';
    let realResourceId = '';
    const seed = await committedSeed(pool, async (s) => {
      const eventId = await seedEvent(s);
      const programmeId = await seedProgramme(s, { eventId });
      programmeItemId = (await seedProgrammeItem(s, { programmeId })).programmeItemId;
      realResourceId = await seedResource(s, 'VEHICLE');
    });
    const identity = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
    const orphan = await createResourceAssignment(new PgUnitOfWork(pool, seed.workspaceId), {
      ...identity, idempotencyKey: randomUUID(), activityKind: 'PROGRAMME_ITEM', activityId: programmeItemId, resourceId: randomUUID(),
    });
    assert.equal(orphan.ok, false);
    if (!orphan.ok) {
      assert.equal(orphan.conflict.kind, 'VALIDATION_FAILED');
      assert.match(orphan.conflict.message, /resource_assignments_resource_fk/);
    }
    mustOk(await createResourceAssignment(new PgUnitOfWork(pool, seed.workspaceId), {
      ...identity, idempotencyKey: randomUUID(), activityKind: 'PROGRAMME_ITEM', activityId: programmeItemId, resourceId: realResourceId,
    }));
  });

  test('M4 -> M5: an area edition must cite real evidence', async () => {
    const pool = await sharedTestPool();
    let areaId = '';
    const seed = await committedSeed(pool, async (s) => {
      areaId = (await seedGeographicArea(s)).areaId;
    });
    await expectCommitRejected(pool, async (client) => {
      await client.query(
        `INSERT INTO area_versions (workspace_id, id, area_id, edition_number, valid_from, geometry, evidence_id, created_by_actor_id)
         VALUES ($1, $2, $3, 2, '2030-01-01', ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((0 0, 0 1, 1 1, 1 0, 0 0)))'), 4326)::geography, $4, 'principal:integration')`,
        [seed.workspaceId, randomUUID(), areaId, randomUUID()],
      );
    }, /area_versions_evidence_fk/);
  });

  test('M3 -> M5: supplier schedule provenance must be real evidence, and seeded evidence satisfies it', async () => {
    const pool = await sharedTestPool();
    let serviceId = '';
    const seed = await committedSeed(pool, async (s) => {
      serviceId = await seedTransportService(s);
    });
    await expectCommitRejected(pool, async (client) => {
      await client.query(
        'UPDATE transport_services SET estimated_departure = published_departure, estimated_observed_at = now(), estimated_evidence_id = $3 WHERE workspace_id = $1 AND id = $2',
        [seed.workspaceId, serviceId, randomUUID()],
      );
    }, /transport_services_estimated_evidence_fk/);
  });

  test('M5 -> M4: information applicability cannot name another workspace\'s jurisdiction', async () => {
    const pool = await sharedTestPool();
    let foreignJurisdiction = '';
    await committedSeed(pool, async (s) => {
      foreignJurisdiction = await seedJurisdiction(s, { name: 'Foreign regime' });
    });
    let ownJurisdiction = '';
    let evidenceId = '';
    const seed = await committedSeed(pool, async (s) => {
      ownJurisdiction = await seedJurisdiction(s, { name: 'Own regime' });
      evidenceId = takeSeedEvidence(s);
    });
    const uow = new PgUnitOfWork(pool, seed.workspaceId);
    const base = { workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId };
    const organisationId = randomUUID();
    mustOk(await createOrganisation(uow, { ...base, idempotencyKey: randomUUID(), organisationId, legalName: 'Integration Publisher', defaultCurrencyCode: 'EUR' }));
    const recordId = randomUUID();
    mustOk(await recordInformationRecord(uow, {
      ...base, idempotencyKey: randomUUID(), informationRecordId: recordId, publisherOrganisationId: organisationId,
      externalPublicationKey: `integration:${recordId}`, topic: 'ADVISORY',
    }));
    const version = mustOk(await ingestInformationVersion(uow, {
      ...base, idempotencyKey: randomUUID(), informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: 1,
      issuedAt: '2030-01-01T00:00:00.000Z', receivedAt: '2030-01-01T00:01:00.000Z', observedAt: '2030-01-01T00:00:00.000Z',
      effectiveWindow: { start: '2030-01-01T00:00:00.000Z', end: '2030-02-01T00:00:00.000Z' },
      evidenceId, normalizationVersion: 'integration/1', payloadHash: 'b'.repeat(64),
      detail: { sourceNativeSeverity: 'NOTICE', riskTopics: ['integration'], publisherMeanings: [], sourceNativeDetail: {}, detailSchemaVersion: 'advisory/1' },
      expectedRevision: 1,
    }));
    const exposure = { start: '2030-01-01T00:00:00.000Z', end: '2030-02-01T00:00:00.000Z' };
    const borrowed = await recordInformationScope(uow, {
      ...base, idempotencyKey: randomUUID(), informationRecordId: recordId, informationVersionId: version.informationVersionId,
      jurisdictionId: foreignJurisdiction, effectiveExposure: exposure, expectedRevision: 2,
    });
    assert.equal(borrowed.ok, false, 'a jurisdiction from another workspace must not be accepted');
    if (!borrowed.ok) assert.match(borrowed.conflict.message, /information_scopes_jurisdiction_fk/);
    mustOk(await recordInformationScope(uow, {
      ...base, idempotencyKey: randomUUID(), informationRecordId: recordId, informationVersionId: version.informationVersionId,
      jurisdictionId: ownJurisdiction, effectiveExposure: exposure, expectedRevision: 2,
    }));
  });

  test('M2 -> M5: a support requirement citing missing evidence is a typed conflict, not a raw driver error', async () => {
    const pool = await sharedTestPool();
    let supported = '';
    let supporter = '';
    let evidenceId = '';
    const seed = await committedSeed(pool, async (s) => {
      supported = (await seedTraveller(s)).travellerId;
      supporter = (await seedTraveller(s)).travellerId;
      evidenceId = takeSeedEvidence(s);
    });
    const base = {
      workspaceId: seed.workspaceId,
      actorPrincipalId: seed.actorId,
      supportedTravellerId: supported,
      requiredCoverage: { start: '2030-01-01T00:00:00.000Z', end: '2030-01-02T00:00:00.000Z' },
      minimumSimultaneousSupporters: 1,
      eligibleSupporterTravellerIds: [supporter],
    };
    const orphan = await appendAccompanimentRequirement(new PgUnitOfWork(pool, seed.workspaceId), {
      ...base, idempotencyKey: randomUUID(), provenanceEvidenceId: randomUUID(),
    });
    assert.equal(orphan.ok, false);
    if (!orphan.ok) {
      assert.equal(orphan.conflict.kind, 'VALIDATION_FAILED');
      assert.match(orphan.conflict.message, /accompaniment_requirements_provenance_fk/);
    }
    mustOk(await appendAccompanimentRequirement(new PgUnitOfWork(pool, seed.workspaceId), {
      ...base, idempotencyKey: randomUUID(), provenanceEvidenceId: evidenceId,
    }));
  });
});
