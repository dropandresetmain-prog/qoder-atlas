-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3 / F03: Trip is a shared undertaking that
-- travellers participate in; it is not anyone's itinerary and it holds no
-- averaged eligibility. Trip identity is never derived from an event name, a
-- supplier locator or a fixture label, so no such column exists here.
--
-- The "an ACTIVE Trip has at least one Journey" rule is cross-table and lives
-- in 0021_journeys.sql, where both sides of the invariant can be triggered.

CREATE TABLE trips (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose <> ''),
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  intended_window_start timestamptz,
  intended_window_end timestamptz,
  business_context_organisation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT trips_business_context_organisation_fk
    FOREIGN KEY (workspace_id, business_context_organisation_id)
    REFERENCES organisations (workspace_id, id),
  -- Half-open [start, end) per shared/time.ts InstantIntervalSchema: a window
  -- is either absent or complete and strictly ordered.
  CONSTRAINT trips_intended_window_shape CHECK (
    (intended_window_start IS NULL AND intended_window_end IS NULL)
    OR (intended_window_start IS NOT NULL AND intended_window_end IS NOT NULL
        AND intended_window_end > intended_window_start)
  )
);

CREATE INDEX idx_trips_workspace_lifecycle ON trips (workspace_id, lifecycle_status);
CREATE INDEX idx_trips_organisation ON trips (workspace_id, business_context_organisation_id)
  WHERE business_context_organisation_id IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_trip(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRIP subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM trips t WHERE t.workspace_id = p_workspace_id AND t.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRIP subject % has no trips row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('TRIP', 'enforce_subject_subtype_trip', 'M2');
