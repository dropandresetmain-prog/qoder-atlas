-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5: GeographicArea is a versioned spatial
-- root — explicitly distinct from Place (operational point) and Jurisdiction
-- (legal regime). `geographic_areas` is the stable area identity; `area_versions`
-- are its immutable geometry editions ("editions preserve geography history").
--
-- The frozen `GeographicAreaVersionSchema` (src/domain/v2/programmes/programme.ts)
-- already names `areaId`; M0 omitted the area's own root type, so
-- `GeographicAreaSchema` is added additively in that same file (CONTRACTS.md §7)
-- rather than repurposing the version shape as the root.
--
-- Real PostGIS geometry per the M4 brief ("Do not substitute arbitrary lat/lng
-- JSON for spatially queried area geometry") — `geography(MultiPolygon, 4326)`
-- covers both single- and multi-polygon jurisdiction/area shapes without a
-- second single-polygon column to keep in sync.

CREATE TABLE geographic_areas (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  name text NOT NULL CHECK (name <> ''),
  area_type text NOT NULL CHECK (area_type <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX idx_geographic_areas_type ON geographic_areas (workspace_id, area_type);

-- Append-only editions. `evidence_id` is a deferred FK: evidence_records is
-- M5-owned and does not exist on this branch yet (mirrors the M2 §7A ledger
-- pattern exactly — NOT NULL typed column + index now, M5 adds the constraint).
CREATE TABLE area_versions (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  area_id uuid NOT NULL,
  edition_number integer NOT NULL CHECK (edition_number > 0),
  valid_from date NOT NULL,
  valid_until date,
  geometry geography(MultiPolygon, 4326) NOT NULL,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT area_versions_area_fk
    FOREIGN KEY (workspace_id, area_id) REFERENCES geographic_areas (workspace_id, id),
  CONSTRAINT area_versions_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT area_versions_geometry_valid CHECK (ST_IsValid(geometry::geometry))
);

CREATE UNIQUE INDEX area_versions_area_edition_uidx ON area_versions (workspace_id, area_id, edition_number);
CREATE INDEX idx_area_versions_geometry ON area_versions USING GIST (geometry);
CREATE INDEX idx_area_versions_valid_range ON area_versions (workspace_id, area_id, valid_from, valid_until);
CREATE INDEX idx_area_versions_evidence ON area_versions (workspace_id, evidence_id);

-- Immutable: an edition is never corrected in place, only superseded by a new
-- one. Reuses the shared `forbid_mutation()` (0003) every M2 immutable table
-- already uses, rather than a bespoke duplicate.
CREATE TRIGGER area_versions_immutable
  BEFORE UPDATE OR DELETE ON area_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION enforce_subject_subtype_geographic_area(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: GEOGRAPHIC_AREA subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM geographic_areas a WHERE a.workspace_id = p_workspace_id AND a.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: GEOGRAPHIC_AREA subject % has no geographic_areas row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('GEOGRAPHIC_AREA', 'enforce_subject_subtype_geographic_area', 'M4');
