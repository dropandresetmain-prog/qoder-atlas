/**
 * PostgreSQL implementation of `PlaceRepository`/`GeographyRepository`
 * (src/contracts/v2/repository/programmes.ts) over `places`,
 * `place_external_refs`, `place_associations`, `geographic_areas`,
 * `area_versions`, `area_memberships`, `jurisdictions`, `jurisdiction_areas`
 * (migrations 0050-0053).
 *
 * `GeographicAreaVersion.geometryRef` (frozen contract, programme.ts) is an
 * "opaque pointer to the PostGIS geometry payload" — this implementation uses
 * the version's own row id, since the geometry now lives in that same row and
 * a caller resolves it by loading that version, not by parsing the pointer.
 */
import type { PoolClient } from 'pg';
import type { PlaceRepository, GeographyRepository } from '../../../contracts/v2/repository/programmes.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import {
  PlaceSchema,
  GeographicAreaSchema,
  GeographicAreaVersionSchema,
  JurisdictionSchema,
  type Place,
  type GeographicArea,
  type GeographicAreaVersion,
  type Jurisdiction,
  type JurisdictionArea,
} from '../../../domain/v2/programmes/programme.ts';
import { currentTransactionClient } from '../transactionContext.ts';

interface PlaceRow {
  name: string;
  place_type: string;
  time_zone: string;
  latitude: string | null;
  longitude: string | null;
}

const PLACE_SELECT = `SELECT name, place_type, time_zone, latitude, longitude FROM places`;

function toPlace(placeId: string, row: PlaceRow): Place {
  return PlaceSchema.parse({
    id: placeId,
    name: row.name,
    placeType: row.place_type,
    timeZone: row.time_zone,
    ...(row.latitude !== null && row.longitude !== null
      ? { coordinates: { lat: Number(row.latitude), lng: Number(row.longitude) } }
      : {}),
  });
}

export class PgPlaceRepository implements PlaceRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async create(params: { place: Place; actor: ActorContext }): Promise<void> {
    const { place } = params;
    const result = await this.client().query(
      `INSERT INTO places (workspace_id, id, name, place_type, time_zone, latitude, longitude, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.actor.workspaceId,
        place.id,
        place.name,
        place.placeType,
        place.timeZone,
        place.coordinates?.lat ?? null,
        place.coordinates?.lng ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`place ${place.id} was not inserted`);
  }

  async load(workspaceId: string, placeId: string): Promise<Place | undefined> {
    const result = await this.client().query<PlaceRow>(`${PLACE_SELECT} WHERE workspace_id = $1 AND id = $2`, [
      workspaceId,
      placeId,
    ]);
    const row = result.rows[0];
    return row ? toPlace(placeId, row) : undefined;
  }

  async addExternalRef(params: {
    workspaceId: string;
    id: string;
    placeId: string;
    providerNamespace: string;
    externalKey: string;
    actor: ActorContext;
  }): Promise<void> {
    await this.client().query(
      `INSERT INTO place_external_refs (workspace_id, id, place_id, provider_namespace, external_key, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.workspaceId,
        params.id,
        params.placeId,
        params.providerNamespace,
        params.externalKey,
        params.actor.actorPrincipalId,
      ],
    );
  }

  async addAssociation(params: {
    workspaceId: string;
    id: string;
    placeId: string;
    relatedPlaceId: string;
    associationType: string;
    actor: ActorContext;
  }): Promise<void> {
    await this.client().query(
      `INSERT INTO place_associations (workspace_id, id, place_id, related_place_id, association_type, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.workspaceId,
        params.id,
        params.placeId,
        params.relatedPlaceId,
        params.associationType,
        params.actor.actorPrincipalId,
      ],
    );
  }
}

interface AreaRow {
  name: string;
  area_type: string;
  revision: string;
}

const AREA_SELECT = `
  SELECT a.name, a.area_type, h.revision
    FROM geographic_areas a
    JOIN aggregate_heads h ON h.workspace_id = a.workspace_id AND h.aggregate_id = a.id`;

function toArea(areaId: string, row: AreaRow): GeographicArea {
  return GeographicAreaSchema.parse({
    id: areaId,
    revision: Number(row.revision),
    name: row.name,
    areaType: row.area_type,
  });
}

interface AreaVersionRow {
  id: string;
  area_id: string;
  valid_from: Date;
  valid_until: Date | null;
  evidence_id: string;
}

function toAreaVersion(row: AreaVersionRow): GeographicAreaVersion {
  return GeographicAreaVersionSchema.parse({
    id: row.id,
    areaId: row.area_id,
    validFrom: row.valid_from.toISOString().slice(0, 10),
    ...(row.valid_until ? { validUntil: row.valid_until.toISOString().slice(0, 10) } : {}),
    geometryRef: row.id,
    evidenceId: row.evidence_id,
  });
}

interface JurisdictionRow {
  name: string;
  regime_kind: string;
}

function toJurisdiction(jurisdictionId: string, row: JurisdictionRow): Jurisdiction {
  return JurisdictionSchema.parse({ id: jurisdictionId, name: row.name, regimeKind: row.regime_kind });
}

export class PgGeographyRepository implements GeographyRepository {
  private client(): PoolClient {
    return currentTransactionClient();
  }

  async createArea(params: { area: GeographicArea; actor: ActorContext }): Promise<void> {
    const { area } = params;
    const result = await this.client().query(
      `INSERT INTO geographic_areas (workspace_id, id, name, area_type, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.actor.workspaceId, area.id, area.name, area.areaType, params.actor.actorPrincipalId],
    );
    if (result.rowCount !== 1) throw new Error(`geographic area ${area.id} was not inserted`);
  }

  async loadArea(workspaceId: string, areaId: string): Promise<GeographicArea | undefined> {
    const result = await this.client().query<AreaRow>(`${AREA_SELECT} WHERE a.workspace_id = $1 AND a.id = $2`, [
      workspaceId,
      areaId,
    ]);
    const row = result.rows[0];
    return row ? toArea(areaId, row) : undefined;
  }

  async addAreaVersion(params: {
    version: GeographicAreaVersion;
    geometryWkt: string;
    actor: ActorContext;
  }): Promise<void> {
    const { version } = params;
    const editionResult = await this.client().query<{ next_edition: string }>(
      `SELECT COALESCE(MAX(edition_number), 0) + 1 AS next_edition FROM area_versions
        WHERE workspace_id = $1 AND area_id = $2`,
      [params.actor.workspaceId, version.areaId],
    );
    const editionNumber = Number(editionResult.rows[0]?.next_edition ?? 1);
    const result = await this.client().query(
      `INSERT INTO area_versions
         (workspace_id, id, area_id, edition_number, valid_from, valid_until, geometry, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_GeomFromText($7), 4326)::geography, $8, $9)`,
      [
        params.actor.workspaceId,
        version.id,
        version.areaId,
        editionNumber,
        version.validFrom,
        version.validUntil ?? null,
        params.geometryWkt,
        version.evidenceId,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`area version ${version.id} was not inserted`);
  }

  async listAreaVersions(workspaceId: string, areaId: string): Promise<GeographicAreaVersion[]> {
    const result = await this.client().query<AreaVersionRow>(
      `SELECT id, area_id, valid_from, valid_until, evidence_id FROM area_versions
        WHERE workspace_id = $1 AND area_id = $2 ORDER BY edition_number`,
      [workspaceId, areaId],
    );
    return result.rows.map(toAreaVersion);
  }

  async addAreaMembership(params: {
    workspaceId: string;
    id: string;
    memberKind: 'PLACE' | 'AREA';
    memberPlaceId?: string;
    memberAreaId?: string;
    containingAreaVersionId: string;
    validFrom: string;
    validUntil?: string;
    evidenceId: string;
    actor: ActorContext;
  }): Promise<void> {
    const result = await this.client().query(
      `INSERT INTO area_memberships
         (workspace_id, id, member_kind, member_place_id, member_area_id,
          containing_area_version_id, valid_from, valid_until, evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.workspaceId,
        params.id,
        params.memberKind,
        params.memberPlaceId ?? null,
        params.memberAreaId ?? null,
        params.containingAreaVersionId,
        params.validFrom,
        params.validUntil ?? null,
        params.evidenceId,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`area membership ${params.id} was not inserted`);
  }

  async createJurisdiction(params: { jurisdiction: Jurisdiction; actor: ActorContext }): Promise<void> {
    const { jurisdiction } = params;
    const result = await this.client().query(
      `INSERT INTO jurisdictions (workspace_id, id, name, regime_kind, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.actor.workspaceId, jurisdiction.id, jurisdiction.name, jurisdiction.regimeKind, params.actor.actorPrincipalId],
    );
    if (result.rowCount !== 1) throw new Error(`jurisdiction ${jurisdiction.id} was not inserted`);
  }

  async loadJurisdiction(workspaceId: string, jurisdictionId: string): Promise<Jurisdiction | undefined> {
    const result = await this.client().query<JurisdictionRow>(
      `SELECT name, regime_kind FROM jurisdictions WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, jurisdictionId],
    );
    const row = result.rows[0];
    return row ? toJurisdiction(jurisdictionId, row) : undefined;
  }

  async addJurisdictionArea(params: { link: JurisdictionArea; id: string; actor: ActorContext }): Promise<void> {
    const { link } = params;
    const result = await this.client().query(
      `INSERT INTO jurisdiction_areas (workspace_id, id, jurisdiction_id, area_version_id, valid_from, valid_until, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.actor.workspaceId,
        params.id,
        link.jurisdictionId,
        link.areaVersionId,
        link.validFrom,
        link.validUntil ?? null,
        params.actor.actorPrincipalId,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`jurisdiction area ${params.id} was not inserted`);
  }
}
