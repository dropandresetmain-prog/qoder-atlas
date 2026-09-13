-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3: each JourneyItem kind carries its own
-- typed detail, never a JSON bag ("Typed detail mandatory"). Exactly one
-- detail row per item, of the matching kind: the composite primary key makes
-- the relation 1:1, the discriminating foreign key
-- (workspace_id, journey_item_id, kind) -> journey_items (workspace_id, id, kind)
-- makes a STAY detail on a TRANSPORT item a key violation rather than a
-- application-layer convention, and the deferred assertion below makes a
-- missing detail a commit failure.
--
-- Place, participation and resource references are stored as NOT NULL/nullable
-- uuid columns with reverse-lookup indexes but NO foreign key in this range:
-- places/participations are M4-owned and transport_services/resources are
-- M3-owned. The exact ALTER TABLE statements that close these references are
-- listed in docs/refactor/MIGRATION_MAPPING.md so the integration pass applies
-- them; M2 does not create another lane's tables.

CREATE TABLE transport_item_details (
  workspace_id uuid NOT NULL,
  journey_item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'TRANSPORT'),
  desired_origin_place_id uuid NOT NULL,
  desired_destination_place_id uuid NOT NULL,
  -- Observed fulfilment context only: the service/schedule itself is M3's
  -- truth and is never copied into Journey intent.
  selected_service_id uuid,
  PRIMARY KEY (workspace_id, journey_item_id),
  CONSTRAINT transport_item_details_item_fk
    FOREIGN KEY (workspace_id, journey_item_id, kind)
    REFERENCES journey_items (workspace_id, id, kind),
  CONSTRAINT transport_item_details_not_same_place
    CHECK (desired_origin_place_id <> desired_destination_place_id)
);

CREATE INDEX idx_transport_item_details_origin
  ON transport_item_details (workspace_id, desired_origin_place_id);
CREATE INDEX idx_transport_item_details_destination
  ON transport_item_details (workspace_id, desired_destination_place_id);
CREATE INDEX idx_transport_item_details_service
  ON transport_item_details (workspace_id, selected_service_id)
  WHERE selected_service_id IS NOT NULL;

CREATE TABLE stay_item_details (
  workspace_id uuid NOT NULL,
  journey_item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'STAY'),
  intended_place_id uuid NOT NULL,
  required_nights integer NOT NULL CHECK (required_nights > 0),
  -- §10 bounded opaque payload: occupancy preference detail that nothing
  -- reverse-looks-up. A field anyone filters on must become a column.
  occupancy_needs jsonb,
  PRIMARY KEY (workspace_id, journey_item_id),
  CONSTRAINT stay_item_details_item_fk
    FOREIGN KEY (workspace_id, journey_item_id, kind)
    REFERENCES journey_items (workspace_id, id, kind),
  CONSTRAINT stay_item_details_occupancy_shape CHECK (
    occupancy_needs IS NULL OR (jsonb_typeof(occupancy_needs) = 'object'
                                AND pg_column_size(occupancy_needs) <= 8192)
  )
);

CREATE INDEX idx_stay_item_details_place ON stay_item_details (workspace_id, intended_place_id);

-- Engagement references EITHER a Programme Participation OR a standalone
-- appointment, never both and never neither (contract refine mirrored exactly:
-- the database must not reject data the accepted contract accepts).
CREATE TABLE engagement_item_details (
  workspace_id uuid NOT NULL,
  journey_item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'ENGAGEMENT'),
  participation_id uuid,
  standalone_title text,
  standalone_window_start timestamptz,
  standalone_window_end timestamptz,
  PRIMARY KEY (workspace_id, journey_item_id),
  CONSTRAINT engagement_item_details_item_fk
    FOREIGN KEY (workspace_id, journey_item_id, kind)
    REFERENCES journey_items (workspace_id, id, kind),
  CONSTRAINT engagement_item_details_source_xor
    CHECK ((participation_id IS NOT NULL) <> (
      standalone_title IS NOT NULL
      OR standalone_window_start IS NOT NULL
      OR standalone_window_end IS NOT NULL
    )),
  CONSTRAINT engagement_item_details_standalone_window_shape CHECK (
    (standalone_window_start IS NULL AND standalone_window_end IS NULL)
    OR (standalone_window_start IS NOT NULL AND standalone_window_end IS NOT NULL
        AND standalone_window_end > standalone_window_start)
  ),
  CONSTRAINT engagement_item_details_standalone_title_with_window CHECK (
    (standalone_window_start IS NULL AND standalone_window_end IS NULL)
    OR standalone_title IS NOT NULL
  )
);

CREATE INDEX idx_engagement_item_details_participation
  ON engagement_item_details (workspace_id, participation_id)
  WHERE participation_id IS NOT NULL;

CREATE TABLE resource_use_item_details (
  workspace_id uuid NOT NULL,
  journey_item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'RESOURCE_USE'),
  resource_id uuid,
  intended_location_place_id uuid,
  use_requirements jsonb,
  PRIMARY KEY (workspace_id, journey_item_id),
  CONSTRAINT resource_use_item_details_item_fk
    FOREIGN KEY (workspace_id, journey_item_id, kind)
    REFERENCES journey_items (workspace_id, id, kind),
  CONSTRAINT resource_use_item_details_requires_somewhere
    CHECK (resource_id IS NOT NULL OR intended_location_place_id IS NOT NULL),
  CONSTRAINT resource_use_item_details_requirements_shape CHECK (
    use_requirements IS NULL OR (jsonb_typeof(use_requirements) = 'object'
                                 AND pg_column_size(use_requirements) <= 8192)
  )
);

CREATE INDEX idx_resource_use_item_details_resource
  ON resource_use_item_details (workspace_id, resource_id)
  WHERE resource_id IS NOT NULL;
CREATE INDEX idx_resource_use_item_details_place
  ON resource_use_item_details (workspace_id, intended_location_place_id)
  WHERE intended_location_place_id IS NOT NULL;

CREATE FUNCTION assert_journey_item_has_typed_detail() RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT
      (SELECT COUNT(*) FROM transport_item_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.journey_item_id = NEW.id)
    + (SELECT COUNT(*) FROM stay_item_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.journey_item_id = NEW.id)
    + (SELECT COUNT(*) FROM engagement_item_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.journey_item_id = NEW.id)
    + (SELECT COUNT(*) FROM resource_use_item_details d
        WHERE d.workspace_id = NEW.workspace_id AND d.journey_item_id = NEW.id)
    INTO v_count;
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'journey_items % of kind % has no typed detail row (kind detail is mandatory)',
      NEW.id, NEW.kind;
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION
      'journey_items % has % typed detail rows; exactly one is permitted',
      NEW.id, v_count;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journey_items_typed_detail_assert
  AFTER INSERT OR UPDATE ON journey_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journey_item_has_typed_detail();
