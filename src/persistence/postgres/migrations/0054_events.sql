-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5 / F07: Event is context — an Event owns
-- zero or more Programmes and carries no schedule of its own. Event identity
-- carries no demo/fixture-derived column: the migration mapping's
-- "AnchorEvent -> Event + Programme" split happens at the command/migration-
-- import layer, never by hardcoding a name here.

CREATE TABLE events (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  title text NOT NULL CHECK (title <> ''),
  organiser_organisation_id uuid,
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT events_organiser_fk
    FOREIGN KEY (workspace_id, organiser_organisation_id) REFERENCES organisations (workspace_id, id)
);

CREATE INDEX idx_events_workspace_lifecycle ON events (workspace_id, lifecycle_status);
CREATE INDEX idx_events_organiser ON events (workspace_id, organiser_organisation_id)
  WHERE organiser_organisation_id IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_event(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EVENT subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM events e WHERE e.workspace_id = p_workspace_id AND e.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EVENT subject % has no events row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('EVENT', 'enforce_subject_subtype_event', 'M4');
