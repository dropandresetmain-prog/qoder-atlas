-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5: Jurisdiction is a legal/administrative
-- regime — explicitly distinct from a geographic country polygon and from an
-- operational Place like an airport (M4 brief §G). `jurisdiction_areas` is the
-- effective m:n association to specific `area_versions` editions (matching the
-- frozen `JurisdictionAreaSchema.areaVersionId`,
-- src/domain/v2/programmes/programme.ts), so "which Jurisdictions apply to an
-- area/place at a given effective time" (reverse lookup H) is one indexed join,
-- not a parsed polygon comparison against the area's current-latest shape.

CREATE TABLE jurisdictions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  name text NOT NULL CHECK (name <> ''),
  regime_kind text NOT NULL CHECK (regime_kind IN ('COUNTRY', 'SUPRANATIONAL', 'SUBNATIONAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX idx_jurisdictions_regime ON jurisdictions (workspace_id, regime_kind);

CREATE TABLE jurisdiction_areas (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  area_version_id uuid NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT jurisdiction_areas_jurisdiction_fk
    FOREIGN KEY (workspace_id, jurisdiction_id) REFERENCES jurisdictions (workspace_id, id),
  CONSTRAINT jurisdiction_areas_area_version_fk
    FOREIGN KEY (workspace_id, area_version_id) REFERENCES area_versions (workspace_id, id),
  CONSTRAINT jurisdiction_areas_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX jurisdiction_areas_uidx
  ON jurisdiction_areas (workspace_id, jurisdiction_id, area_version_id, valid_from);
CREATE INDEX idx_jurisdiction_areas_area_version
  ON jurisdiction_areas (workspace_id, area_version_id, valid_from, valid_until);
CREATE INDEX idx_jurisdiction_areas_jurisdiction_window
  ON jurisdiction_areas (workspace_id, jurisdiction_id, valid_from, valid_until);

CREATE FUNCTION enforce_subject_subtype_jurisdiction(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: JURISDICTION subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jurisdictions j WHERE j.workspace_id = p_workspace_id AND j.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: JURISDICTION subject % has no jurisdictions row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('JURISDICTION', 'enforce_subject_subtype_jurisdiction', 'M4');
