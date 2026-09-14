/**
 * Direct-SQL fixtures for the M4 integration lane, mirroring m2Seed.ts's
 * pattern: seed through raw SQL rather than another lane's command handler,
 * so a bug in one lane's command code cannot mask another's, and pin the
 * write order the deferred constraints require (aggregate_heads before
 * domain_subjects for every root).
 */
import { randomUUID } from 'node:crypto';
import type { SeedSession } from './m2Seed.ts';
import { seedRootSubject, takeSeedEvidence } from './m2Seed.ts';

export async function seedEvent(seed: SeedSession, opts: { title?: string; lifecycleStatus?: string } = {}): Promise<string> {
  const eventId = await seedRootSubject(seed, { kind: 'EVENT' });
  await seed.client.query(
    `INSERT INTO events (workspace_id, id, title, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, COALESCE($4, 'DRAFT'), $5)`,
    [seed.workspaceId, eventId, opts.title ?? 'Seed Event', opts.lifecycleStatus ?? 'DRAFT', seed.actorId],
  );
  return eventId;
}

export async function seedProgramme(
  seed: SeedSession,
  params: { eventId: string; title?: string; lifecycleStatus?: string },
): Promise<string> {
  const programmeId = await seedRootSubject(seed, { kind: 'PROGRAMME' });
  await seed.client.query(
    `INSERT INTO programmes (workspace_id, id, event_id, title, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'DRAFT'), $6)`,
    [seed.workspaceId, programmeId, params.eventId, params.title ?? 'Seed Programme', params.lifecycleStatus ?? 'DRAFT', seed.actorId],
  );
  return programmeId;
}

export interface SeededProgrammeItem {
  programmeItemId: string;
}

export async function seedProgrammeItem(
  seed: SeedSession,
  params: {
    programmeId: string;
    title?: string;
    itemType?: string;
    placeId?: string | null;
    window?: { start: string; end: string } | null;
    lifecycleStatus?: string;
    scheduleAuthority?: 'INTERNAL' | 'EXTERNAL';
  },
): Promise<SeededProgrammeItem> {
  const programmeItemId = randomUUID();
  await seed.client.query(
    'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
    [seed.workspaceId, programmeItemId, 'PROGRAMME_ITEM', params.programmeId],
  );
  await seed.client.query(
    `INSERT INTO programme_items
       (workspace_id, id, programme_id, title, item_type, place_id, window_start, window_end,
        lifecycle_status, schedule_authority, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'DRAFT'), COALESCE($10, 'INTERNAL'), $11)`,
    [
      seed.workspaceId,
      programmeItemId,
      params.programmeId,
      params.title ?? 'Seed Programme Item',
      params.itemType ?? 'SESSION',
      params.placeId ?? null,
      params.window?.start ?? null,
      params.window?.end ?? null,
      params.lifecycleStatus ?? 'DRAFT',
      params.scheduleAuthority ?? 'INTERNAL',
      seed.actorId,
    ],
  );
  return { programmeItemId };
}

export async function seedParticipation(
  seed: SeedSession,
  params: { programmeItemId: string; travellerId: string; obligation?: string; accepted?: boolean },
): Promise<string> {
  const programmeIdRow = await seed.client.query<{ programme_id: string }>(
    'SELECT programme_id FROM programme_items WHERE workspace_id = $1 AND id = $2',
    [seed.workspaceId, params.programmeItemId],
  );
  const programmeId = programmeIdRow.rows[0]?.programme_id;
  if (!programmeId) throw new Error(`seedParticipation: programme item ${params.programmeItemId} not found`);
  const participationId = randomUUID();
  await seed.client.query(
    'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
    [seed.workspaceId, participationId, 'PARTICIPATION', programmeId],
  );
  await seed.client.query(
    `INSERT INTO participations (workspace_id, id, programme_item_id, traveller_id, obligation, accepted, created_by_actor_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'REQUIRED'), COALESCE($6, false), $7)`,
    [seed.workspaceId, participationId, params.programmeItemId, params.travellerId, params.obligation ?? 'REQUIRED', params.accepted ?? false, seed.actorId],
  );
  return participationId;
}

export async function seedPlace(
  seed: SeedSession,
  opts: { name?: string; placeType?: string; timeZone?: string; lat?: number; lng?: number } = {},
): Promise<string> {
  const placeId = await seedRootSubject(seed, { kind: 'PLACE' });
  await seed.client.query(
    `INSERT INTO places (workspace_id, id, name, place_type, time_zone, latitude, longitude, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [seed.workspaceId, placeId, opts.name ?? 'Seed Place', opts.placeType ?? 'VENUE', opts.timeZone ?? 'UTC', opts.lat ?? null, opts.lng ?? null, seed.actorId],
  );
  return placeId;
}

export async function seedJurisdiction(
  seed: SeedSession,
  opts: { name?: string; regimeKind?: 'COUNTRY' | 'SUPRANATIONAL' | 'SUBNATIONAL' } = {},
): Promise<string> {
  const jurisdictionId = await seedRootSubject(seed, { kind: 'JURISDICTION' });
  await seed.client.query(
    `INSERT INTO jurisdictions (workspace_id, id, name, regime_kind, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [seed.workspaceId, jurisdictionId, opts.name ?? 'Seed Jurisdiction', opts.regimeKind ?? 'COUNTRY', seed.actorId],
  );
  return jurisdictionId;
}

export interface SeededArea {
  areaId: string;
  areaVersionId: string;
}

/** Default geometry is a large box covering most of the globe so point-in-polygon tests are trivially satisfiable without real-world coordinates. */
export async function seedGeographicArea(
  seed: SeedSession,
  opts: { name?: string; areaType?: string; geometryWkt?: string; validFrom?: string } = {},
): Promise<SeededArea> {
  const areaId = await seedRootSubject(seed, { kind: 'GEOGRAPHIC_AREA' });
  await seed.client.query(
    `INSERT INTO geographic_areas (workspace_id, id, name, area_type, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [seed.workspaceId, areaId, opts.name ?? 'Seed Area', opts.areaType ?? 'COUNTRY', seed.actorId],
  );
  const areaVersionId = randomUUID();
  const evidenceId = takeSeedEvidence(seed); // real M5 evidence (0087 FK)
  const wkt = opts.geometryWkt ?? 'MULTIPOLYGON(((-179 -89, -179 89, 179 89, 179 -89, -179 -89)))';
  await seed.client.query(
    `INSERT INTO area_versions (workspace_id, id, area_id, edition_number, valid_from, geometry, evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, 1, $4, ST_SetSRID(ST_GeomFromText($5), 4326)::geography, $6, $7)`,
    [seed.workspaceId, areaVersionId, areaId, opts.validFrom ?? '2000-01-01', wkt, evidenceId, seed.actorId],
  );
  return { areaId, areaVersionId };
}

export async function seedJurisdictionArea(
  seed: SeedSession,
  params: { jurisdictionId: string; areaVersionId: string; validFrom?: string },
): Promise<string> {
  const linkId = randomUUID();
  await seed.client.query(
    `INSERT INTO jurisdiction_areas (workspace_id, id, jurisdiction_id, area_version_id, valid_from, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [seed.workspaceId, linkId, params.jurisdictionId, params.areaVersionId, params.validFrom ?? '2000-01-01', seed.actorId],
  );
  return linkId;
}

export async function seedAreaMembership(
  seed: SeedSession,
  params: { memberKind: 'PLACE' | 'AREA'; memberPlaceId?: string; memberAreaId?: string; containingAreaVersionId: string; validFrom?: string },
): Promise<string> {
  const membershipId = randomUUID();
  const evidenceId = takeSeedEvidence(seed); // real M5 evidence (0087 FK)
  await seed.client.query(
    `INSERT INTO area_memberships
       (workspace_id, id, member_kind, member_place_id, member_area_id, containing_area_version_id, valid_from, evidence_id, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      seed.workspaceId,
      membershipId,
      params.memberKind,
      params.memberPlaceId ?? null,
      params.memberAreaId ?? null,
      params.containingAreaVersionId,
      params.validFrom ?? '2000-01-01',
      evidenceId,
      seed.actorId,
    ],
  );
  return membershipId;
}
