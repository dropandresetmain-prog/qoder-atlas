-- M7 (0100): recovery_cases / case_subjects / case_signals.
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §7. Case coordinates multi-subject recovery;
-- it is not a second copy of world truth. M8 owns authority/execution tables
-- in 0109+.

CREATE TABLE recovery_case_lifecycles (status text PRIMARY KEY);
INSERT INTO recovery_case_lifecycles (status) VALUES
  ('OPEN'), ('PLANNING'), ('AWAITING_AUTHORITY'), ('EXECUTING'), ('RESOLVED'), ('CLOSED'), ('CANCELLED');

CREATE TABLE recovery_cases (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  lifecycle_status text NOT NULL REFERENCES recovery_case_lifecycles (status),
  resolution_summary text CHECK (resolution_summary IS NULL OR length(resolution_summary) <= 4096),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT recovery_cases_closed_complete CHECK (
    (lifecycle_status IN ('RESOLVED', 'CLOSED', 'CANCELLED')) = (closed_at IS NOT NULL)
  )
);

CREATE TABLE case_subjects (
  workspace_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  role text NOT NULL CHECK (length(btrim(role)) > 0 AND length(role) <= 128),
  PRIMARY KEY (workspace_id, recovery_case_id, subject_kind, subject_id, role),
  CONSTRAINT case_subjects_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT case_subjects_subject_fk
    FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind)
);

CREATE INDEX idx_case_subjects_subject
  ON case_subjects (workspace_id, subject_kind, subject_id);

CREATE TABLE case_signals (
  workspace_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  change_signal_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, recovery_case_id, change_signal_id),
  CONSTRAINT case_signals_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id)
  -- change_signals table is M8-adjacent; link validated when that table lands.
);

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
      'domain_subjects subtype violation: RECOVERY_CASE subject % has no recovery_cases row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
VALUES ('RECOVERY_CASE', 'enforce_subject_subtype_recovery_case', 'M7');
