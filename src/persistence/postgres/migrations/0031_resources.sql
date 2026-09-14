-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §4 lines "resources, typed resource details":
-- a Resource is a usable asset/capacity (vehicle, room, equipment). It is a root
-- subject; "which reservation lines use it" is the reservation family's reverse
-- link (idx on 0032). Resource identity is not an allocation: allocations name a
-- resource, they never define it.
--
-- The typed detail is exactly one row of the matching kind (same 1:1 + kind-
-- discriminating FK pattern 0023 established for JourneyItems) so a new resource
-- category (F16) extends additively in 0120+ with its own detail table.
--
-- places are M4-owned: location is an opaque uuid + reverse-lookup index with no
-- FK (documented deferral).

CREATE TABLE resources (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('VEHICLE', 'ROOM', 'EQUIPMENT')),
  location_place_id uuid,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  -- Referable target for the kind-discriminating detail FK below.
  CONSTRAINT resources_id_type_uidx UNIQUE (workspace_id, id, resource_type)
);

CREATE INDEX idx_resources_location ON resources (workspace_id, location_place_id)
  WHERE location_place_id IS NOT NULL;
CREATE INDEX idx_resources_type ON resources (workspace_id, resource_type);

CREATE TABLE vehicle_resource_details (
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type = 'VEHICLE'),
  PRIMARY KEY (workspace_id, resource_id),
  CONSTRAINT vehicle_resource_details_resource_fk
    FOREIGN KEY (workspace_id, resource_id, resource_type)
    REFERENCES resources (workspace_id, id, resource_type)
);

CREATE TABLE room_resource_details (
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type = 'ROOM'),
  -- §4: booked dates/occupancy live on reservation lines, never here. A room's
  -- static bed configuration is operating property, not occupancy truth.
  bed_configuration text,
  PRIMARY KEY (workspace_id, resource_id),
  CONSTRAINT room_resource_details_resource_fk
    FOREIGN KEY (workspace_id, resource_id, resource_type)
    REFERENCES resources (workspace_id, id, resource_type)
);

CREATE TABLE equipment_resource_details (
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type = 'EQUIPMENT'),
  PRIMARY KEY (workspace_id, resource_id),
  CONSTRAINT equipment_resource_details_resource_fk
    FOREIGN KEY (workspace_id, resource_id, resource_type)
    REFERENCES resources (workspace_id, id, resource_type)
);

CREATE FUNCTION assert_resource_has_typed_detail() RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT
      (SELECT COUNT(*) FROM vehicle_resource_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.resource_id = NEW.id)
    + (SELECT COUNT(*) FROM room_resource_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.resource_id = NEW.id)
    + (SELECT COUNT(*) FROM equipment_resource_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.resource_id = NEW.id)
    INTO v_count;
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'resources % of type % has no typed detail row (kind detail is mandatory)',
      NEW.id, NEW.resource_type;
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION
      'resources % has % typed detail rows; exactly one is permitted',
      NEW.id, v_count;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER resources_typed_detail_assert
  AFTER INSERT OR UPDATE ON resources
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_resource_has_typed_detail();

-- The parent trigger cannot see a detail row being deleted. A detail delete is
-- therefore checked explicitly so a valid Resource cannot be left untyped.
CREATE FUNCTION assert_resource_detail_parent_has_typed_detail() RETURNS trigger AS $$
DECLARE
  v_workspace_id uuid;
  v_resource_id uuid;
  v_count integer;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    v_workspace_id := OLD.workspace_id;
    v_resource_id := OLD.resource_id;
    IF EXISTS (SELECT 1 FROM resources r WHERE r.workspace_id = v_workspace_id AND r.id = v_resource_id) THEN
      SELECT
          (SELECT COUNT(*) FROM vehicle_resource_details d
            WHERE d.workspace_id = v_workspace_id AND d.resource_id = v_resource_id)
        + (SELECT COUNT(*) FROM room_resource_details d
            WHERE d.workspace_id = v_workspace_id AND d.resource_id = v_resource_id)
        + (SELECT COUNT(*) FROM equipment_resource_details d
            WHERE d.workspace_id = v_workspace_id AND d.resource_id = v_resource_id)
        INTO v_count;
      IF v_count <> 1 THEN
        RAISE EXCEPTION
          'resource % would have % typed detail rows after detail mutation', v_resource_id, v_count;
      END IF;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_workspace_id := NEW.workspace_id;
    v_resource_id := NEW.resource_id;
    SELECT
        (SELECT COUNT(*) FROM vehicle_resource_details d
          WHERE d.workspace_id = v_workspace_id AND d.resource_id = v_resource_id)
      + (SELECT COUNT(*) FROM room_resource_details d
          WHERE d.workspace_id = v_workspace_id AND d.resource_id = v_resource_id)
      + (SELECT COUNT(*) FROM equipment_resource_details d
          WHERE d.workspace_id = v_workspace_id AND d.resource_id = v_resource_id)
      INTO v_count;
    IF v_count <> 1 THEN
      RAISE EXCEPTION
        'resource % would have % typed detail rows after detail mutation', v_resource_id, v_count;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER vehicle_resource_details_parent_assert
  AFTER INSERT OR UPDATE OF workspace_id, resource_id OR DELETE ON vehicle_resource_details
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_resource_detail_parent_has_typed_detail();
CREATE CONSTRAINT TRIGGER room_resource_details_parent_assert
  AFTER INSERT OR UPDATE OF workspace_id, resource_id OR DELETE ON room_resource_details
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_resource_detail_parent_has_typed_detail();
CREATE CONSTRAINT TRIGGER equipment_resource_details_parent_assert
  AFTER INSERT OR UPDATE OF workspace_id, resource_id OR DELETE ON equipment_resource_details
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_resource_detail_parent_has_typed_detail();

CREATE FUNCTION enforce_subject_subtype_resource(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESOURCE subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM resources r WHERE r.workspace_id = p_workspace_id AND r.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESOURCE subject % has no resources row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('RESOURCE', 'enforce_subject_subtype_resource', 'M3');
