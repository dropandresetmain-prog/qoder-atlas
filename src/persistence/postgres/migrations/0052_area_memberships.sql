-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5: `area_memberships` is the versioned
-- geographic association ("place/area, containing_area, valid range"). A
-- member is either a Place or a nested GeographicArea (never both), and it
-- points at the specific geometry *edition* it was found within
-- (`area_versions`), not the area's current-latest state, so a later
-- superseding edition cannot silently rewrite historical membership.
--
-- "Point matching can be derived but curated legal memberships remain
-- sourced" (§5): `evidence_id` records that sourcing. It is a deferred FK for
-- the same reason as `area_versions.evidence_id` — M5 owns `evidence_records`.

CREATE TABLE area_memberships (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  member_kind text NOT NULL CHECK (member_kind IN ('PLACE', 'AREA')),
  member_place_id uuid,
  member_area_id uuid,
  containing_area_version_id uuid NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT area_memberships_member_shape CHECK (
    (member_kind = 'PLACE' AND member_place_id IS NOT NULL AND member_area_id IS NULL)
    OR (member_kind = 'AREA' AND member_area_id IS NOT NULL AND member_place_id IS NULL)
  ),
  CONSTRAINT area_memberships_place_fk
    FOREIGN KEY (workspace_id, member_place_id) REFERENCES places (workspace_id, id),
  CONSTRAINT area_memberships_area_fk
    FOREIGN KEY (workspace_id, member_area_id) REFERENCES geographic_areas (workspace_id, id),
  CONSTRAINT area_memberships_containing_area_version_fk
    FOREIGN KEY (workspace_id, containing_area_version_id) REFERENCES area_versions (workspace_id, id),
  CONSTRAINT area_memberships_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX idx_area_memberships_place
  ON area_memberships (workspace_id, member_place_id, valid_from, valid_until)
  WHERE member_place_id IS NOT NULL;
CREATE INDEX idx_area_memberships_area
  ON area_memberships (workspace_id, member_area_id, valid_from, valid_until)
  WHERE member_area_id IS NOT NULL;
CREATE INDEX idx_area_memberships_containing
  ON area_memberships (workspace_id, containing_area_version_id);
