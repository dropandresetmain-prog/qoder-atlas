-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3 / F03: Journey is exactly one Traveller's
-- independently managed participation in exactly one Trip. Two consequences
-- are enforced here rather than left to handlers:
--   * one Journey per (Trip, Traveller) - the UNIQUE key below, so a second
--     "shadow" itinerary for the same person in the same undertaking is a
--     constraint violation, not a design option;
--   * no Journey is a variant of another traveller's - there is no
--     main/sub/primary column because the frozen model forbids the concept.
-- Journey identity carries no route, event-name, supplier or fixture-derived
-- column, and Journey intent deliberately holds no supplier/service truth:
-- that belongs to M3's transport_services / reservations / allocations.

CREATE TABLE journeys (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  trip_id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  intended_window_start timestamptz,
  intended_window_end timestamptz,
  responsibility_organisation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT journeys_trip_fk
    FOREIGN KEY (workspace_id, trip_id) REFERENCES trips (workspace_id, id),
  CONSTRAINT journeys_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT journeys_responsibility_organisation_fk
    FOREIGN KEY (workspace_id, responsibility_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT journeys_intended_window_shape CHECK (
    (intended_window_start IS NULL AND intended_window_end IS NULL)
    OR (intended_window_start IS NOT NULL AND intended_window_end IS NOT NULL
        AND intended_window_end > intended_window_start)
  )
);

CREATE UNIQUE INDEX journeys_per_traveller_per_trip_uidx
  ON journeys (workspace_id, trip_id, traveller_id);
CREATE INDEX idx_journeys_traveller ON journeys (workspace_id, traveller_id, lifecycle_status);
CREATE INDEX idx_journeys_trip ON journeys (workspace_id, trip_id, lifecycle_status);

-- F03 membership invariant: a Trip cannot be ACTIVE with nobody participating.
-- Checked at COMMIT from both sides, so a command may create the Trip and its
-- first Journey in either statement order, while neither "Trip goes ACTIVE with
-- zero journeys" nor "the last participant is cancelled" can commit. A
-- CANCELLED Journey does not count as participation.
CREATE FUNCTION assert_trip_has_active_participation(p_workspace_id uuid, p_trip_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT lifecycle_status INTO v_status
    FROM trips WHERE workspace_id = p_workspace_id AND id = p_trip_id;
  IF v_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM journeys j
     WHERE j.workspace_id = p_workspace_id
       AND j.trip_id = p_trip_id
       AND j.lifecycle_status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION
      'trips % is ACTIVE but has no non-cancelled journey (F03: a Trip is a shared undertaking)',
      p_trip_id;
  END IF;
END;
$$;

CREATE FUNCTION assert_trip_membership_from_journey() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_trip_has_active_participation(NEW.workspace_id, NEW.trip_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM assert_trip_has_active_participation(NEW.workspace_id, NEW.trip_id);
    PERFORM assert_trip_has_active_participation(OLD.workspace_id, OLD.trip_id);
  ELSE
    PERFORM assert_trip_has_active_participation(OLD.workspace_id, OLD.trip_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journeys_membership_assert
  AFTER INSERT OR UPDATE OR DELETE ON journeys
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_trip_membership_from_journey();

CREATE FUNCTION assert_trip_membership_from_trip() RETURNS trigger AS $$
BEGIN
  PERFORM assert_trip_has_active_participation(NEW.workspace_id, NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trips_membership_assert
  AFTER INSERT OR UPDATE ON trips
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_trip_membership_from_trip();

CREATE FUNCTION enforce_subject_subtype_journey(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: JOURNEY subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM journeys j WHERE j.workspace_id = p_workspace_id AND j.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: JOURNEY subject % has no journeys row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('JOURNEY', 'enforce_subject_subtype_journey', 'M2');
