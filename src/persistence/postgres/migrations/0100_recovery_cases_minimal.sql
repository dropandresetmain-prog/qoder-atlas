-- M8 (0100): minimal recovery_cases parent for action_plans.
--
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §7. M7 owns planner/scenario content; this
-- table is the smallest case root M8 needs so ActionPlan can be case-owned
-- without pulling M7 business logic. Integration owner may extend columns
-- when M7 lands — do not invent scenario/strategy payloads here.

CREATE TABLE recovery_cases (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'OPEN'
    CHECK (lifecycle_status IN ('OPEN', 'RESOLVED', 'CANCELLED', 'SUPERSEDED')),
  resolution_kind text
    CHECK (resolution_kind IS NULL OR resolution_kind IN (
      'RECOVERED', 'RECOVERED_WITH_LOSS', 'UNRESOLVED', 'CANCELLED'
    )),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT recovery_cases_closed_shape CHECK (
    (lifecycle_status = 'OPEN' AND closed_at IS NULL AND resolution_kind IS NULL)
    OR (lifecycle_status <> 'OPEN' AND closed_at IS NOT NULL)
  )
);

CREATE INDEX idx_recovery_cases_open
  ON recovery_cases (workspace_id, lifecycle_status)
  WHERE lifecycle_status = 'OPEN';

CREATE FUNCTION enforce_subject_subtype_recovery_case(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RECOVERY_CASE subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM recovery_cases c WHERE c.workspace_id = p_workspace_id AND c.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RECOVERY_CASE subject % has no recovery_cases row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('RECOVERY_CASE', 'enforce_subject_subtype_recovery_case', 'M8');
