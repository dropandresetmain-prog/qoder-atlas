-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5: Place is an operational point/location —
-- explicitly distinct from a GeographicArea (versioned spatial polygon) and a
-- Jurisdiction (legal/administrative regime). A city name, an airport code, a
-- polygon and a jurisdiction are never the same row (M4 brief §G).
--
-- `location` is a PostGIS `geography(Point,4326)` generated from optional
-- lat/lng, per the frozen `PlaceSchema.coordinates` shape
-- (src/domain/v2/programmes/programme.ts) round-tripping as plain numbers
-- while still giving reverse-lookup H ("which area contains/intersects a
-- Place?") a real spatial index instead of parsed JSON.

CREATE TABLE places (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  name text NOT NULL CHECK (name <> ''),
  place_type text NOT NULL CHECK (place_type <> ''),
  time_zone text NOT NULL,
  latitude double precision,
  longitude double precision,
  location geography(Point, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      ELSE NULL
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT places_coordinates_shape CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT places_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT places_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX idx_places_location ON places USING GIST (location) WHERE location IS NOT NULL;
CREATE INDEX idx_places_workspace_type ON places (workspace_id, place_type);

-- Provider-namespaced external identity, distinct rows per provider — the same
-- physical Place may be known under several provider locators.
CREATE TABLE place_external_refs (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  place_id uuid NOT NULL,
  provider_namespace text NOT NULL CHECK (provider_namespace <> ''),
  external_key text NOT NULL CHECK (external_key <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT place_external_refs_place_fk
    FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id)
);

CREATE UNIQUE INDEX place_external_refs_namespace_key_uidx
  ON place_external_refs (workspace_id, provider_namespace, external_key);
CREATE INDEX idx_place_external_refs_place ON place_external_refs (workspace_id, place_id);

-- Parent/operational association (e.g. "gate belongs to terminal belongs to
-- airport"). Deliberately carries no jurisdiction implication — §5 "associations
-- do not automatically imply legal jurisdiction" is enforced by this table simply
-- having no jurisdiction column at all, not by a convention.
CREATE TABLE place_associations (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  place_id uuid NOT NULL,
  related_place_id uuid NOT NULL,
  association_type text NOT NULL CHECK (association_type <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT place_associations_place_fk
    FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id),
  CONSTRAINT place_associations_related_place_fk
    FOREIGN KEY (workspace_id, related_place_id) REFERENCES places (workspace_id, id),
  CONSTRAINT place_associations_not_self CHECK (place_id <> related_place_id)
);

CREATE UNIQUE INDEX place_associations_uidx
  ON place_associations (workspace_id, place_id, related_place_id, association_type);
CREATE INDEX idx_place_associations_related ON place_associations (workspace_id, related_place_id);

CREATE FUNCTION enforce_subject_subtype_place(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PLACE subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM places p WHERE p.workspace_id = p_workspace_id AND p.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PLACE subject % has no places row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('PLACE', 'enforce_subject_subtype_place', 'M4');
