-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5 / F07: Programme is the coherent mutable
-- schedule aggregate — the ONE canonical owner of its ProgrammeItems and
-- Participations. "A programme move must become one canonical state change"
-- (M4 brief) means every schedule/participation mutation under this Programme
-- advances exactly this row's `aggregate_heads` revision; there is no second,
-- per-item revision counter (see 0056/0057).

CREATE TABLE programmes (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  event_id uuid NOT NULL,
  title text NOT NULL CHECK (title <> ''),
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT programmes_event_fk
    FOREIGN KEY (workspace_id, event_id) REFERENCES events (workspace_id, id)
);

CREATE INDEX idx_programmes_event ON programmes (workspace_id, event_id, lifecycle_status);

CREATE FUNCTION enforce_subject_subtype_programme(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PROGRAMME subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM programmes p WHERE p.workspace_id = p_workspace_id AND p.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PROGRAMME subject % has no programmes row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('PROGRAMME', 'enforce_subject_subtype_programme', 'M4');
