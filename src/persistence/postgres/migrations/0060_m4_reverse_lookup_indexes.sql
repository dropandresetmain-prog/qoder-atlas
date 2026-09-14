-- M4 brief §H: M6 must resolve these reverse questions in SQL, not by parsing
-- JSON or walking every row. Most of them are already covered by the
-- per-table indexes 0050-0059 created for their own table's operations; this
-- file is the explicit cross-reference (so the coverage is provable) plus the
-- handful of genuinely cross-cutting indexes no single table migration could
-- justify on its own, following the same pattern as 0029 for M2.
--
-- "Which Participations reference this ProgrammeItem?"
--   -> idx_participations_item (0057).
-- "Which Travellers are affected by this programme change?"
--   -> idx_participations_traveller (0057) for the direct Participation link.
-- "Which Journeys are affected, where a Journey chose to reflect the
--  engagement?" / "which Trips/Journeys reference this Participation through
--  M2 intent?"
--   -> idx_engagement_item_details_participation (M2 0023), now FK-backed once
--      0061 closes the deferred constraint.
-- "Which ProgrammeItems use this Place?"
--   -> idx_programme_items_place (0056).
-- "Which resources are assigned to this item?" / "which items use this resource?"
--   -> idx_resource_assignments_activity, idx_resource_assignments_resource (0058).
-- "Which area contains/intersects a Place?"
--   -> idx_places_location, idx_area_versions_geometry (0050/0051), both GiST so
--      an ST_Contains/ST_Intersects probe from either side is indexed.
-- "Which Jurisdictions apply to an area/place at a given effective time?"
--   -> places -> area_memberships (idx_area_memberships_place) ->
--      jurisdiction_areas (idx_jurisdiction_areas_area_version) -> jurisdictions,
--      each leg time-bounded by its own valid_from/valid_until columns (0052/0053).

-- Net new: M6/M9 reconciliation needs to find every EXTERNAL-authority item
-- without scanning every Programme first (M4 brief §F/§H combined) — no
-- existing single-table index is keyed on schedule_authority alone.
CREATE INDEX idx_programme_items_external_authority
  ON programme_items (workspace_id, programme_id)
  WHERE schedule_authority = 'EXTERNAL';

-- "Which Participations does a Traveller hold that are REQUIRED but not yet
-- accepted?" is the bounded candidate set a later reminder/consequence pass
-- starts from; obligation and accepted are both selective enough to be worth a
-- dedicated partial index rather than a full traveller scan.
CREATE INDEX idx_participations_unaccepted_required
  ON participations (workspace_id, traveller_id)
  WHERE obligation = 'REQUIRED' AND accepted = false;
