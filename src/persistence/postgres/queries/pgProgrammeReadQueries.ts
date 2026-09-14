/**
 * PostgreSQL implementation of `ProgrammeReadQueries`/`GeographyReadQueries`
 * (src/contracts/v2/repository/programmeQueries.ts). Read-only; takes an
 * injected `Queryable` (Pool | PoolClient) like M2's read-query classes,
 * because the frozen `UnitOfWork` exposes no read-only transaction (M2 gap,
 * reused here rather than re-litigated — see docs/refactor/evidence/M4.md).
 */
import type { Pool, PoolClient } from '../pool.ts';
import type {
  AffectedJourneyHit,
  AffectedParticipantHit,
  AreaHit,
  GeographyReadQueries,
  JurisdictionHit,
  ProgrammeItemPlaceHit,
  ProgrammeReadQueries,
  ResourceAssignmentHit,
} from '../../../contracts/v2/repository/programmeQueries.ts';

export type Queryable = Pool | PoolClient;

export class PgProgrammeReadQueries implements ProgrammeReadQueries {
  constructor(private readonly db: Queryable) {}

  async participationsForProgrammeItem(workspaceId: string, programmeItemId: string): Promise<AffectedParticipantHit[]> {
    const result = await this.db.query<{ id: string; traveller_id: string; obligation: string; accepted: boolean }>(
      `SELECT id, traveller_id, obligation, accepted FROM participations
        WHERE workspace_id = $1 AND programme_item_id = $2 ORDER BY created_at`,
      [workspaceId, programmeItemId],
    );
    return result.rows.map((row) => ({
      participationId: row.id,
      travellerId: row.traveller_id,
      obligation: row.obligation as AffectedParticipantHit['obligation'],
      accepted: row.accepted,
    }));
  }

  async travellersForProgrammeItem(workspaceId: string, programmeItemId: string): Promise<string[]> {
    const result = await this.db.query<{ traveller_id: string }>(
      `SELECT DISTINCT traveller_id FROM participations WHERE workspace_id = $1 AND programme_item_id = $2`,
      [workspaceId, programmeItemId],
    );
    return result.rows.map((row) => row.traveller_id);
  }

  async journeysLinkedToParticipation(workspaceId: string, participationId: string): Promise<AffectedJourneyHit[]> {
    const result = await this.db.query<{ journey_item_id: string; journey_id: string; traveller_id: string; trip_id: string }>(
      `SELECT eid.journey_item_id, j.id AS journey_id, j.traveller_id, j.trip_id
         FROM engagement_item_details eid
         JOIN journey_items ji ON ji.workspace_id = eid.workspace_id AND ji.id = eid.journey_item_id
         JOIN journeys j ON j.workspace_id = ji.workspace_id AND j.id = ji.journey_id
        WHERE eid.workspace_id = $1 AND eid.participation_id = $2`,
      [workspaceId, participationId],
    );
    return result.rows.map((row) => ({
      journeyItemId: row.journey_item_id,
      journeyId: row.journey_id,
      travellerId: row.traveller_id,
      tripId: row.trip_id,
    }));
  }

  async programmeItemsUsingPlace(workspaceId: string, placeId: string): Promise<ProgrammeItemPlaceHit[]> {
    const result = await this.db.query<{ id: string; programme_id: string; lifecycle_status: string }>(
      `SELECT id, programme_id, lifecycle_status FROM programme_items WHERE workspace_id = $1 AND place_id = $2`,
      [workspaceId, placeId],
    );
    return result.rows.map((row) => ({ programmeItemId: row.id, programmeId: row.programme_id, lifecycleStatus: row.lifecycle_status }));
  }

  private async assignmentsBy(where: string, params: unknown[]): Promise<ResourceAssignmentHit[]> {
    const result = await this.db.query<{
      id: string;
      activity_kind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM';
      activity_id: string;
      resource_id: string;
      quantity: number;
      lifecycle_status: string;
    }>(`SELECT id, activity_kind, activity_id, resource_id, quantity, lifecycle_status FROM resource_assignments WHERE ${where}`, params);
    return result.rows.map((row) => ({
      assignmentId: row.id,
      activityKind: row.activity_kind,
      activityId: row.activity_id,
      resourceId: row.resource_id,
      quantity: row.quantity,
      lifecycleStatus: row.lifecycle_status,
    }));
  }

  resourceAssignmentsForActivity(
    workspaceId: string,
    activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM',
    activityId: string,
  ): Promise<ResourceAssignmentHit[]> {
    return this.assignmentsBy('workspace_id = $1 AND activity_kind = $2 AND activity_id = $3', [workspaceId, activityKind, activityId]);
  }

  itemsUsingResource(workspaceId: string, resourceId: string): Promise<ResourceAssignmentHit[]> {
    return this.assignmentsBy('workspace_id = $1 AND resource_id = $2', [workspaceId, resourceId]);
  }

  async externallyAuthoredItemsForProgramme(workspaceId: string, programmeId: string): Promise<{ programmeItemId: string }[]> {
    const result = await this.db.query<{ id: string }>(
      `SELECT pi.id FROM programme_items pi
        WHERE pi.workspace_id = $1 AND pi.programme_id = $2 AND pi.schedule_authority = 'EXTERNAL'`,
      [workspaceId, programmeId],
    );
    return result.rows.map((row) => ({ programmeItemId: row.id }));
  }
}

export class PgGeographyReadQueries implements GeographyReadQueries {
  constructor(private readonly db: Queryable) {}

  async areasContainingPlace(workspaceId: string, placeId: string, asOfDate: string): Promise<AreaHit[]> {
    const result = await this.db.query<{ area_id: string; area_version_id: string; name: string; area_type: string }>(
      `SELECT DISTINCT a.id AS area_id, av.id AS area_version_id, a.name, a.area_type
         FROM area_versions av
         JOIN geographic_areas a ON a.workspace_id = av.workspace_id AND a.id = av.area_id
         JOIN places p ON p.workspace_id = av.workspace_id AND p.id = $2
        WHERE av.workspace_id = $1
          AND av.valid_from <= $3::date AND (av.valid_until IS NULL OR av.valid_until > $3::date)
          AND p.location IS NOT NULL
          AND ST_Contains(av.geometry::geometry, p.location::geometry)`,
      [workspaceId, placeId, asOfDate],
    );
    return result.rows.map((row) => ({ areaId: row.area_id, areaVersionId: row.area_version_id, name: row.name, areaType: row.area_type }));
  }

  async jurisdictionsForPlace(workspaceId: string, placeId: string, asOfDate: string): Promise<JurisdictionHit[]> {
    const result = await this.db.query<{ id: string; name: string; regime_kind: JurisdictionHit['regimeKind'] }>(
      `SELECT DISTINCT j.id, j.name, j.regime_kind
         FROM area_memberships am
         JOIN jurisdiction_areas ja ON ja.workspace_id = am.workspace_id AND ja.area_version_id = am.containing_area_version_id
         JOIN jurisdictions j ON j.workspace_id = ja.workspace_id AND j.id = ja.jurisdiction_id
        WHERE am.workspace_id = $1 AND am.member_kind = 'PLACE' AND am.member_place_id = $2
          AND am.valid_from <= $3::date AND (am.valid_until IS NULL OR am.valid_until > $3::date)
          AND ja.valid_from <= $3::date AND (ja.valid_until IS NULL OR ja.valid_until > $3::date)`,
      [workspaceId, placeId, asOfDate],
    );
    return result.rows.map((row) => ({ jurisdictionId: row.id, name: row.name, regimeKind: row.regime_kind }));
  }

  async jurisdictionsForAreaVersion(workspaceId: string, areaVersionId: string, asOfDate: string): Promise<JurisdictionHit[]> {
    const result = await this.db.query<{ id: string; name: string; regime_kind: JurisdictionHit['regimeKind'] }>(
      `SELECT j.id, j.name, j.regime_kind
         FROM jurisdiction_areas ja
         JOIN jurisdictions j ON j.workspace_id = ja.workspace_id AND j.id = ja.jurisdiction_id
        WHERE ja.workspace_id = $1 AND ja.area_version_id = $2
          AND ja.valid_from <= $3::date AND (ja.valid_until IS NULL OR ja.valid_until > $3::date)`,
      [workspaceId, areaVersionId, asOfDate],
    );
    return result.rows.map((row) => ({ jurisdictionId: row.id, name: row.name, regimeKind: row.regime_kind }));
  }
}
