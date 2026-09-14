/**
 * Direct-SQL fixtures shared by the M2 integration lanes.
 *
 * Every M2 lane needs rows owned by another lane — a Journey test needs a
 * Traveller, a Support test needs a JourneyItem. Seeding through SQL instead of
 * through another lane's repository keeps one lane's bug from masking another's
 * and pins the write order the deferred constraints require.
 *
 * Aggregate policy these fixtures encode (docs/refactor/evidence/M2.md):
 * - a *root* subject (`TRAVELLER`, `TRIP`, `JOURNEY`, `COORDINATION_GROUP`,
 *   `SUPPORT_ASSIGNMENT`, …) owns one `aggregate_heads` row with
 *   `aggregate_id = id`;
 * - a *child* subject (`JOURNEY_ITEM`) registers in `domain_subjects` with
 *   `aggregate_id` pointing at its root and gets no counter of its own.
 * Because `domain_subjects` and `aggregate_heads` reference each other with
 * deferrable circular FKs, the head row must be inserted before the subject
 * row within the same transaction.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Pool } from '../src/persistence/postgres/pool.ts';

/** A ProtectedDataRef triple that satisfies the 0012/0015 column constraints. */
export const SEED_PROTECTED_REF = {
  contentHash: 'a'.repeat(64),
  storageRef: 'seed://protected/placeholder',
  accessPolicyId: 'policy:m2-seed',
} as const;

export interface SeedSession {
  client: PoolClient;
  workspaceId: string;
  actorId: string;
  /** Pre-registered provenance rows used by legacy M2 fixtures after 0085. */
  evidenceIds: string[];
  evidenceCursor: number;
}

export async function beginSeed(pool: Pool, workspaceName = 'M2 Seed Co'): Promise<SeedSession> {
  const client = await pool.connect();
  const workspaceId = randomUUID();
  await client.query('BEGIN');
  await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, workspaceName]);
  const evidenceIds: string[] = [];
  for (let index = 0; index < 128; index++) {
    const sourceId = randomUUID();
    const evidenceId = randomUUID();
    evidenceIds.push(evidenceId);
    await client.query(
      `INSERT INTO source_records
         (workspace_id, id, source_identity, received_at, content_hash, content_type,
          capture_metadata, capture_metadata_version, created_by_actor_id)
       VALUES ($1, $2, 'm2-fixture-source', '2000-01-01T00:00:00Z', $3, 'application/test', '{}', 'm2-fixture/1', $4)`,
      [workspaceId, sourceId, `${'e'.repeat(64)}${index.toString(16)}`.slice(0, 64), 'principal:m2-seed'],
    );
    await client.query(
      `INSERT INTO evidence_records
         (workspace_id, id, assertion_type, observed_at, schema_version, created_by_actor_id)
       VALUES ($1, $2, 'M2_FIXTURE_PROVENANCE', '2000-01-01T00:00:00Z', 'm2-fixture/1', $3)`,
      [workspaceId, evidenceId, 'principal:m2-seed'],
    );
    await client.query(
      `INSERT INTO evidence_sources (workspace_id, evidence_record_id, source_record_id)
       VALUES ($1, $2, $3)`,
      [workspaceId, evidenceId, sourceId],
    );
  }
  return { client, workspaceId, actorId: 'principal:m2-seed', evidenceIds, evidenceCursor: 0 };
}

export function takeSeedEvidence(seed: SeedSession): string {
  const evidenceId = seed.evidenceIds[seed.evidenceCursor++];
  if (!evidenceId) throw new Error('M2 fixture evidence pool exhausted');
  return evidenceId;
}

export async function commitSeed(seed: SeedSession): Promise<void> {
  await seed.client.query('COMMIT');
  seed.client.release();
}

export async function rollbackSeed(seed: SeedSession): Promise<void> {
  await seed.client.query('ROLLBACK');
  seed.client.release();
}

/**
 * Insert the registry pair for a root subject. Callers insert the typed row
 * afterwards — the subtype checker is a deferred constraint trigger, so either
 * order commits, but head-before-subject is mandatory.
 */
export async function seedRootSubject(
  seed: SeedSession,
  params: { id?: string; kind: string } = { kind: 'TRAVELLER' },
): Promise<string> {
  const id = params.id ?? randomUUID();
  await seed.client.query(
    'INSERT INTO aggregate_heads (workspace_id, aggregate_id, revision) VALUES ($1, $2, 1)',
    [seed.workspaceId, id],
  );
  await seed.client.query(
    'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
    [seed.workspaceId, id, params.kind, id],
  );
  return id;
}

/** Register a child subject under an existing root's aggregate. */
export async function seedChildSubject(
  seed: SeedSession,
  params: { id: string; kind: string; aggregateId: string },
): Promise<string> {
  await seed.client.query(
    'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
    [seed.workspaceId, params.id, params.kind, params.aggregateId],
  );
  return params.id;
}

export interface SeededTraveller {
  travellerId: string;
  displayNameId: string;
}

export async function seedTraveller(
  seed: SeedSession,
  opts: { displayName?: string; lifecycleStatus?: 'ACTIVE' | 'MERGED' | 'ARCHIVED' } = {},
): Promise<SeededTraveller> {
  const travellerId = await seedRootSubject(seed, { kind: 'TRAVELLER' });
  const displayNameId = randomUUID();
  await seed.client.query(
    `INSERT INTO travellers (workspace_id, id, display_name_ref, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, COALESCE($4, 'ACTIVE'), $5)`,
    [seed.workspaceId, travellerId, displayNameId, opts.lifecycleStatus ?? 'ACTIVE', seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO traveller_names
       (workspace_id, id, traveller_id, name_kind, display_value, valid_from, evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, 'DISPLAY', $4, '2000-01-01', $5, $6)`,
    [
      seed.workspaceId,
      displayNameId,
      travellerId,
      opts.displayName ?? 'Seed Traveller',
      takeSeedEvidence(seed),
      seed.actorId,
    ],
  );
  return { travellerId, displayNameId };
}

export interface SeededCredential {
  credentialId: string;
  versionId: string;
}

/**
 * A credential plus its first edition and the matching typed detail row.
 * `E_AUTHORISATION` deliberately has no detail table (see 0015 + the M2
 * evidence doc), so it is rejected here rather than silently half-seeded.
 */
export async function seedCredential(
  seed: SeedSession,
  params: {
    travellerId: string;
    kind?: 'PASSPORT' | 'VISA' | 'RESIDENCE_PERMIT' | 'HEALTH_CREDENTIAL';
    issuerCountry?: string;
    editionNumber?: number;
    issueDate?: string;
    expiryDate?: string | null;
  },
): Promise<SeededCredential> {
  const kind = params.kind ?? 'PASSPORT';
  const credentialId = randomUUID();
  const versionId = randomUUID();
  await seed.client.query(
    `INSERT INTO travel_credentials
       (workspace_id, id, traveller_id, kind, issuer_country, current_version_id, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      seed.workspaceId,
      credentialId,
      params.travellerId,
      kind,
      params.issuerCountry ?? 'NZ',
      versionId,
      seed.actorId,
    ],
  );
  await seed.client.query(
    `INSERT INTO credential_versions
       (workspace_id, id, credential_id, kind, edition_number, issue_date, expiry_date,
        physically_available, evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
    [
      seed.workspaceId,
      versionId,
      credentialId,
      kind,
      params.editionNumber ?? 1,
      params.issueDate ?? '2020-01-01',
      params.expiryDate === null ? null : (params.expiryDate ?? '2030-01-01'),
      takeSeedEvidence(seed),
      seed.actorId,
    ],
  );
  const detailSqlByKind: Record<NonNullable<typeof params.kind>, string> = {
    PASSPORT: `INSERT INTO passport_details
                 (workspace_id, credential_version_id, kind, issuing_state_code,
                  document_number_content_hash, document_number_storage_ref,
                  document_number_access_policy_id, created_by_actor_id)
               VALUES ($1, $2, 'PASSPORT', $3, $4, $5, $6, $7)`,
    VISA: `INSERT INTO visa_details
             (workspace_id, credential_version_id, kind, issuing_state_code,
              document_number_content_hash, document_number_storage_ref,
              document_number_access_policy_id, visa_class, created_by_actor_id)
           VALUES ($1, $2, 'VISA', $3, $4, $5, $6, 'TOURIST', $7)`,
    RESIDENCE_PERMIT: `INSERT INTO residence_credential_details
             (workspace_id, credential_version_id, kind, issuing_state_code,
              document_number_content_hash, document_number_storage_ref,
              document_number_access_policy_id, residence_type, created_by_actor_id)
           VALUES ($1, $2, 'RESIDENCE_PERMIT', $3, $4, $5, $6, 'PERMANENT', $7)`,
    HEALTH_CREDENTIAL: `INSERT INTO health_credential_details
             (workspace_id, credential_version_id, kind, issuing_state_code,
              document_number_content_hash, document_number_storage_ref,
              document_number_access_policy_id, product_name, created_by_actor_id)
           VALUES ($1, $2, 'HEALTH_CREDENTIAL', $3, $4, $5, $6, 'SEED-VACCINE', $7)`,
  };
  await seed.client.query(detailSqlByKind[kind], [
    seed.workspaceId,
    versionId,
    params.issuerCountry ?? 'NZ',
    SEED_PROTECTED_REF.contentHash,
    SEED_PROTECTED_REF.storageRef,
    SEED_PROTECTED_REF.accessPolicyId,
    seed.actorId,
  ]);
  return { credentialId, versionId };
}

export async function seedTrip(
  seed: SeedSession,
  opts: { purpose?: string; lifecycleStatus?: string } = {},
): Promise<string> {
  const tripId = await seedRootSubject(seed, { kind: 'TRIP' });
  await seed.client.query(
    `INSERT INTO trips (workspace_id, id, purpose, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, COALESCE($4, 'DRAFT'), $5)`,
    [seed.workspaceId, tripId, opts.purpose ?? 'Seed undertaking', opts.lifecycleStatus ?? 'DRAFT', seed.actorId],
  );
  return tripId;
}

/**
 * A Journey is one traveller's participation, so the Trip must already have
 * this Traveller's row (0021's uniqueness + membership assertions run at
 * commit).
 */
export async function seedJourney(
  seed: SeedSession,
  params: {
    tripId: string;
    travellerId: string;
    lifecycleStatus?: string;
    window?: { start: string; end: string } | null;
  },
): Promise<string> {
  const journeyId = await seedRootSubject(seed, { kind: 'JOURNEY' });
  await seed.client.query(
    `INSERT INTO journeys
       (workspace_id, id, trip_id, traveller_id, lifecycle_status,
        intended_window_start, intended_window_end, created_by_actor_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'DRAFT'), $6, $7, $8)`,
    [
      seed.workspaceId,
      journeyId,
      params.tripId,
      params.travellerId,
      params.lifecycleStatus ?? 'DRAFT',
      params.window?.start ?? null,
      params.window?.end ?? null,
      seed.actorId,
    ],
  );
  return journeyId;
}

export interface SeededJourneyItem {
  journeyItemId: string;
}

/**
 * Item + its mandatory typed detail row (0023 makes exactly one detail row a
 * deferred requirement) + the child registry row under the Journey aggregate.
 */
export async function seedJourneyItem(
  seed: SeedSession,
  params: {
    journeyId: string;
    kind: 'TRANSPORT' | 'STAY' | 'ENGAGEMENT' | 'RESOURCE_USE';
    orderKey?: string;
    lifecycleStatus?: string;
    window?: { start: string; end: string } | null;
  },
): Promise<SeededJourneyItem> {
  const journeyItemId = randomUUID();
  await seedChildSubject(seed, { id: journeyItemId, kind: 'JOURNEY_ITEM', aggregateId: params.journeyId });
  await seed.client.query(
    `INSERT INTO journey_items
       (workspace_id, id, journey_id, kind, order_key, lifecycle_status,
        intended_window_start, intended_window_end, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'PLANNED'), $7, $8, $9)`,
    [
      seed.workspaceId,
      journeyItemId,
      params.journeyId,
      params.kind,
      params.orderKey ?? journeyItemId,
      params.lifecycleStatus ?? 'PLANNED',
      params.window?.start ?? null,
      params.window?.end ?? null,
      seed.actorId,
    ],
  );
  const detailSql: Record<typeof params.kind, { sql: string; values: unknown[] }> = {
    TRANSPORT: {
      sql: `INSERT INTO transport_item_details
              (workspace_id, journey_item_id, kind, desired_origin_place_id, desired_destination_place_id)
            VALUES ($1, $2, 'TRANSPORT', $3, $4)`,
      values: [seed.workspaceId, journeyItemId, randomUUID(), randomUUID()],
    },
    STAY: {
      sql: `INSERT INTO stay_item_details
              (workspace_id, journey_item_id, kind, intended_place_id, required_nights)
            VALUES ($1, $2, 'STAY', $3, 1)`,
      values: [seed.workspaceId, journeyItemId, randomUUID()],
    },
    ENGAGEMENT: {
      sql: `INSERT INTO engagement_item_details
              (workspace_id, journey_item_id, kind, participation_id)
            VALUES ($1, $2, 'ENGAGEMENT', $3)`,
      values: [seed.workspaceId, journeyItemId, randomUUID()],
    },
    RESOURCE_USE: {
      sql: `INSERT INTO resource_use_item_details
              (workspace_id, journey_item_id, kind, intended_location_place_id)
            VALUES ($1, $2, 'RESOURCE_USE', $3)`,
      values: [seed.workspaceId, journeyItemId, randomUUID()],
    },
  };
  const detail = detailSql[params.kind];
  await seed.client.query(detail.sql, detail.values);
  return { journeyItemId };
}

/**
 * A Jurisdiction/Place reference is an opaque UUID until M4 owns those tables,
 * so tests can only assert that the value round-trips through an index.
 */
export function opaqueRef(): string {
  return randomUUID();
}
