/**
 * NORTHSTAR v2 — programme/geography reverse-lookup query seams (M4).
 *
 * Extends the M2 read-query seam (`repository/queries.ts`) with its own file
 * rather than editing that one, per its own doc comment: "a later milestone
 * (M3/M4/M5) extends this seam by adding its own contract + implementation
 * file." Answers M4 brief §H exactly — each method is the named reverse
 * lookup M6 will need, over an index a migration in 0050-0060 actually
 * creates.
 */
export interface AffectedParticipantHit {
  participationId: string;
  travellerId: string;
  obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  accepted: boolean;
}

/** A Journey that chose to reflect a Participation through its own ENGAGEMENT item (M2 intent, `engagement_item_details.participation_id`). */
export interface AffectedJourneyHit {
  journeyItemId: string;
  journeyId: string;
  travellerId: string;
  tripId: string;
}

export interface ProgrammeItemPlaceHit {
  programmeItemId: string;
  programmeId: string;
  lifecycleStatus: string;
}

export interface ResourceAssignmentHit {
  assignmentId: string;
  activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM';
  activityId: string;
  resourceId: string;
  quantity: number;
  lifecycleStatus: string;
}

export interface ProgrammeReadQueries {
  /** `idx_participations_item` — "which Participations reference this ProgrammeItem?" */
  participationsForProgrammeItem(workspaceId: string, programmeItemId: string): Promise<AffectedParticipantHit[]>;
  /** `idx_participations_traveller` — "which Travellers are affected by this programme change?" */
  travellersForProgrammeItem(workspaceId: string, programmeItemId: string): Promise<string[]>;
  /** `idx_engagement_item_details_participation` (M2 0023, FK-closed by 0061) — "which Trips/Journeys reference this Participation through M2 intent?" */
  journeysLinkedToParticipation(workspaceId: string, participationId: string): Promise<AffectedJourneyHit[]>;
  /** `idx_programme_items_place` — "which ProgrammeItems use this Place?" */
  programmeItemsUsingPlace(workspaceId: string, placeId: string): Promise<ProgrammeItemPlaceHit[]>;
  /** `idx_resource_assignments_activity` / `idx_resource_assignments_resource` — both directions of "which resources are assigned to this item?" */
  resourceAssignmentsForActivity(
    workspaceId: string,
    activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM',
    activityId: string,
  ): Promise<ResourceAssignmentHit[]>;
  itemsUsingResource(workspaceId: string, resourceId: string): Promise<ResourceAssignmentHit[]>;
  /** `idx_programme_items_external_authority` — reconciliation candidate set. */
  externallyAuthoredItemsForProgramme(workspaceId: string, programmeId: string): Promise<{ programmeItemId: string }[]>;
}

export interface AreaHit {
  areaId: string;
  areaVersionId: string;
  name: string;
  areaType: string;
}

export interface JurisdictionHit {
  jurisdictionId: string;
  name: string;
  regimeKind: 'COUNTRY' | 'SUPRANATIONAL' | 'SUBNATIONAL';
}

export interface GeographyReadQueries {
  /** GiST spatial join over `places.location`/`area_versions.geometry` — "which area contains this Place?" */
  areasContainingPlace(workspaceId: string, placeId: string, asOfDate: string): Promise<AreaHit[]>;
  /** places -> area_memberships -> jurisdiction_areas -> jurisdictions, each leg time-bounded — "which Jurisdictions apply to this Place at this time?" */
  jurisdictionsForPlace(workspaceId: string, placeId: string, asOfDate: string): Promise<JurisdictionHit[]>;
  /** jurisdiction_areas -> jurisdictions for one area edition directly. */
  jurisdictionsForAreaVersion(workspaceId: string, areaVersionId: string, asOfDate: string): Promise<JurisdictionHit[]>;
}
