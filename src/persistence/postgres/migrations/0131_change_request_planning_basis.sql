-- A submitted ChangeRequest is planning context beside a truthful current
-- assessment. It is immutable with the planning attempt and participates in
-- the attempt identity, so lifecycle changes cannot replay an old desire.
ALTER TABLE recovery_planning_attempts
  ADD COLUMN request_change_request_id uuid,
  ADD COLUMN request_content_revision integer,
  ADD COLUMN request_lifecycle_revision integer,
  ADD COLUMN request_basis jsonb;

ALTER TABLE recovery_planning_attempts
  ADD CONSTRAINT recovery_planning_attempts_request_basis_shape_chk CHECK (
    (request_change_request_id IS NULL
      AND request_content_revision IS NULL
      AND request_lifecycle_revision IS NULL
      AND request_basis IS NULL)
    OR
    (request_change_request_id IS NOT NULL
      AND request_content_revision >= 1
      AND request_lifecycle_revision >= 1
      AND jsonb_typeof(request_basis) = 'object'
      AND pg_column_size(request_basis) <= 65536)
  ),
  ADD CONSTRAINT recovery_planning_attempts_request_fk
    FOREIGN KEY (workspace_id, request_change_request_id)
    REFERENCES change_requests (workspace_id, id);

DROP INDEX recovery_planning_attempts_case_basis_uidx;
CREATE UNIQUE INDEX recovery_planning_attempts_case_basis_request_uidx
  ON recovery_planning_attempts (
    workspace_id,
    recovery_case_id,
    basis_assessment_id,
    COALESCE(request_change_request_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(request_content_revision, 0),
    COALESCE(request_lifecycle_revision, 0)
  );
